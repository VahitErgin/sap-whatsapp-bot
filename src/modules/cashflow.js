'use strict';

/**
 * cashflow.js
 *
 * Kullanıcının doğal dil sorgularını Claude AI ile SAP sorgularına çevirir.
 * Sabit komut değil, generic yapı:
 *
 * Kullanıcı: "C001 carisinin bu ayki açık faturaları"
 *     ↓
 * Claude → hangi endpoint, hangi filtre?
 *     ↓
 * SAP sorgusu çalıştır
 *     ↓
 * Claude → sonucu WhatsApp'a uygun formatla
 *     ↓
 * Kullanıcıya gönder
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('../config/config');               // FIX: ../config/config
const { getConnection } = require('./sapClient');
const { sendText }      = require('../services/whatsappService'); // FIX: ../services/
// FIX: support'tan askClaude import'u kaldırıldı (kullanılmıyordu, döngüsel bağımlılık riski)

// ─── Dokümanları oku ──────────────────────────────────────────
const DOCS_DIR = path.join(__dirname, '../docs');          // FIX: modules/ → docs/ bir üst

function loadDoc(f) {
  try { return fs.readFileSync(path.join(DOCS_DIR, f), 'utf8'); }
  catch { return ''; }
}
const SAP_CONTEXT_DOC = loadDoc('sap-context.md');
const SCENARIOS_DOC   = loadDoc('scenarios.md');

// ─── Claude: Sorguyu analiz et, SAP planı üret ───────────────
const QUERY_PLANNER_PROMPT = `Sen SAP Business One Service Layer uzmanısın.
Kullanıcının doğal dil isteğini analiz edip hangi SAP API sorgularının çalıştırılacağını belirle.

BUGÜNÜN TARİHİ: ${new Date().toISOString().split('T')[0]}

SAP SERVICE LAYER API REFERANSI:
${SAP_CONTEXT_DOC}

KULLANICI SENARYOLARI:
${SCENARIOS_DOC}

GÖREV:
Kullanıcı isteğini analiz et ve çalıştırılacak SAP sorgularını JSON formatında döndür.

YANIT FORMATI (sadece JSON, başka hiçbir şey yazma):
{
  "queries": [
    {
      "id": "q1",
      "description": "Ne sorgulanıyor (Türkçe açıklama)",
      "endpoint": "Invoices",
      "params": {
        "$filter": "DocumentStatus eq 'bost_Open' and CardCode eq 'C001'",
        "$select": "DocNum,CardName,DocTotal,DocDueDate",
        "$orderby": "DocDueDate asc",
        "$top": "10"
      }
    }
  ],
  "clarification_needed": false,
  "clarification_message": ""
}

KURALLAR:
- Birden fazla sorgu gerekiyorsa queries dizisine ekle (max 3)
- Eğer kullanıcıdan ek bilgi gerekiyorsa clarification_needed: true yap ve mesajı yaz
- Parametre yoksa params: {} bırak
- Tarih filtrelerinde BUGÜNÜN TARİHİNİ kullan
- Sadece JSON döndür, açıklama ekleme`;

// ─── Claude: Sonuçları formatla ───────────────────────────────
const FORMATTER_PROMPT = `Sen SAP Business One asistanısın.
SAP'tan gelen ham veriyi kullanıcıya WhatsApp mesajı olarak formatla.

KURALLAR:
- Kısa ve öz yaz
- Sayıları düzgün formatla (1.250,50 TL)
- Tarihleri Türkçe yaz (15 Ocak 2024)
- Emoji kullan ama abartma
- Liste uzunsa max 10 satır göster, "ve X tane daha..." ekle
- Toplam/özet bilgisi ekle
- Türkçe yaz
- Veri yoksa "Kayıt bulunamadı" de`;

// ─────────────────────────────────────────────────────────────
// Ana fonksiyon – Cashflow ve genel SAP sorguları
// ─────────────────────────────────────────────────────────────
async function handleQuery({ from, question, dbName }) {
  if (!question || question.trim() === '') {
    return await sendText(from,
      '📊 *SAP Sorgulama*\n\nNe öğrenmek istersiniz?\n\nÖrnek:\n• _"C001 carisinin bakiyesi"_\n• _"Bu hafta vadesi gelen ödemeler"_\n• _"Stokta azalan ürünler"_'
    );
  }

  console.log(`[Cashflow] Sorgu (${from}): ${question}`);
  await sendText(from, '⏳ SAP sorgulanıyor...');

  try {
    // 1. Claude'a sor: hangi SAP sorgusunu çalıştıralım?
    const plan = await buildQueryPlan(question);

    // 2. Ek bilgi gerekiyor mu?
    if (plan.clarification_needed) {
      return await sendText(from, `❓ ${plan.clarification_message}`);
    }

    if (!plan.queries || plan.queries.length === 0) {
      return await sendText(from, '⚠️ Bu sorgu için uygun bir SAP verisi bulunamadı.');
    }

    // 3. SAP sorgularını çalıştır
    const sl      = getConnection(dbName || config.sap.companyDb);
    const results = await executeQueries(sl, plan.queries);

    // 4. Claude ile sonuçları formatla
    const formatted = await formatResults(question, plan.queries, results);
    await sendText(from, formatted);

  } catch (err) {
    console.error('[Cashflow] Hata:', err.message);
    await sendText(from,
      '⚠️ SAP sorgusu sırasında hata oluştu. Lütfen tekrar deneyin.'
    );
  }
}

// ─── Eski getCashflow interface'ini koru (geriye dönük uyumluluk) ───
async function getCashflow({ from, cardCode }) {
  const question = cardCode
    ? `${cardCode} carisinin nakit durumu: açık faturalar, bakiye ve vadeye göre özet`
    : 'Genel nakit akışı durumu: bugün vadesi gelen tahsilatlar ve ödemeler';
  return handleQuery({ from, question });
}

// ─────────────────────────────────────────────────────────────
// Claude: Sorgu planı oluştur
// ─────────────────────────────────────────────────────────────
async function buildQueryPlan(question) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     QUERY_PLANNER_PROMPT,
      messages: [{ role: 'user', content: question }],
    },
    {
      headers: {
        'x-api-key':         config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
    }
  );

  const raw = response.data?.content
    ?.filter(b => b.type === 'text')
    ?.map(b => b.text)
    ?.join('') || '{}';

  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[Cashflow] Plan parse hatası:', raw);
    throw new Error('Sorgu planı oluşturulamadı');
  }
}

// ─────────────────────────────────────────────────────────────
// SAP sorgularını çalıştır
// ─────────────────────────────────────────────────────────────
async function executeQueries(sl, queries) {
  const results = {};

  for (const q of queries) {
    try {
      console.log(`[Cashflow] SAP → ${q.endpoint}`, q.params);
      const data = await sl.get(q.endpoint, q.params || {});
      results[q.id] = {
        description: q.description,
        endpoint:    q.endpoint,
        data:        data?.value || data || [],
        count:       data?.value?.length ?? (data ? 1 : 0),
        error:       null,
      };
    } catch (err) {
      console.error(`[Cashflow] SAP hata (${q.endpoint}):`, err.message);
      results[q.id] = {
        description: q.description,
        endpoint:    q.endpoint,
        data:        [],
        count:       0,
        error:       err.message,
      };
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Claude: Sonuçları WhatsApp formatına çevir
// ─────────────────────────────────────────────────────────────
async function formatResults(originalQuestion, queries, results) {
  const dataForClaude = queries.map(q => ({
    sorgu:  q.description,
    sonuc:  results[q.id]?.data,
    toplam: results[q.id]?.count,
    hata:   results[q.id]?.error,
  }));

  const userMessage = `
Kullanıcı sorusu: "${originalQuestion}"

SAP'tan gelen veriler:
${JSON.stringify(dataForClaude, null, 2)}

Bu veriyi kullanıcıya WhatsApp mesajı olarak formatla.`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     FORMATTER_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'x-api-key':         config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
    }
  );

  return response.data?.content
    ?.filter(b => b.type === 'text')
    ?.map(b => b.text)
    ?.join('') || '⚠️ Sonuç formatlanamadı.';
}

module.exports = { getCashflow, handleQuery };
