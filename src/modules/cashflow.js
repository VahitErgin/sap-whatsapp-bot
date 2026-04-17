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
const config = require('../config/config');
const { getConnection }                             = require('./sapClient');
const { getCariEkstre, getVadesiGecenler, getHizmetDurumu, resolveCardCode } = require('./sapDb');
const { sendText, sendList }         = require('../services/whatsappService');
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
      "description": "Ne yapılıyor (Türkçe açıklama)",
      "endpoint": "Invoices",
      "method": "GET",
      "params": {
        "$filter": "DocumentStatus eq 'bost_Open' and CardCode eq 'C001'",
        "$select": "DocNum,CardName,DocTotal,DocDueDate",
        "$orderby": "DocDueDate asc",
        "$top": "10"
      },
      "body": null
    }
  ],
  "clarification_needed": false,
  "clarification_message": ""
}

method: "GET" → veri çek (varsayılan)
method: "POST" → yeni kayıt oluştur (body dolu olmalı, params boş)
method: "PATCH" → güncelle (endpoint içinde key var: BusinessPartners('L00001'))

KRİTİK KURALLAR (asla ihlal etme):
1. Bakiye / borç / alacak / ekstre / cari hesap / yürüyen bakiye sorgularında
   KESİNLİKLE "BusinessPartners", "Invoices", "IncomingPayments", "JournalEntries" KULLANMA.
   Bu sorgular için SADECE endpoint: "SQL_CARI_EKSTRE" kullan.

2. Tüm carilerin genel borç durumu için SADECE endpoint: "SQL_VADESI_GECENLER" kullan.

3. "BusinessPartners" sadece cari arama (CardName, CardCode bulmak) için kullan.
   Balance alanını HİÇBİR ZAMAN $select'e ekleme.

4. CARİ TANIMLAMA KURALI — CardCode vs cardName:
   - Kullanıcı "C001", "MB00006" gibi bir kod verdiyse → params.cardCode kullan
   - Kullanıcı firma/kişi ismi verdiyse (ör: "ABC Teknoloji", "Endeks") → params.cardName kullan
   - Döviz de belirtildiyse (ör: "USD hesabı") → params.currency ekle
   - cardCode ve cardName'i ASLA aynı anda kullanma
   - cardName verildiğinde sistem otomatik olarak OCRD'den CardCode'u bulur

ÖZEL SQL ENDPOİNTLERİ:

Tek cari bakiye / ekstre / yürüyen bakiye:
  endpoint: "SQL_CARI_EKSTRE"
  params: { "cardCode": "CARDCODE", "refDate": "YYYY-MM-DD" }   ← CardCode biliniyorsa
     veya: { "cardName": "ABC Teknoloji", "refDate": "YYYY-MM-DD" }  ← isimden ara
     veya: { "cardName": "ABC", "currency": "USD", "refDate": "YYYY-MM-DD" }  ← isim + döviz
  → Kullanım: "... bakiyesi", "... hesap durumu", "... borcu ne kadar", "... alacağı"

Tüm carilerin bakiye özeti:
  endpoint: "SQL_VADESI_GECENLER"
  params: { "refDate": "YYYY-MM-DD", "cardType": "C" }
  → cardType: C=müşteri, S=tedarikçi

Teknik servis / hizmet çağrısı sorguları:
  endpoint: "SQL_HIZMET"
  params: {
    "cardCode": "CARDCODE",      (opsiyonel - kod biliniyorsa)
    "cardName": "ABC Firma",     (opsiyonel - isimden ara, cardCode yerine kullan)
    "serialNo": "SN123",         (opsiyonel - seri no ile filtrele)
    "callId": "14",              (opsiyonel - çağrı numarası ile filtrele)
    "statusFilter": "open",      (opsiyonel - "open"=açık, "closed"=kapalı, boş=hepsi)
    "top": "10"                  (opsiyonel - kaç kayıt, default 20)
  }
  → Kullanım: "servis çağrıları", "hizmet durumu", "teknik servis", "seri no ile sorgula", "açık servisler"

KURALLAR:
- Birden fazla sorgu gerekiyorsa queries dizisine ekle (max 3)
- Eğer kullanıcıdan ek bilgi gerekiyorsa clarification_needed: true yap ve mesajı yaz
- Parametre yoksa params: {} bırak
- Tarih belirtilmemişse refDate: "${new Date().toISOString().split('T')[0]}" kullan
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
- Veri yoksa "Kayıt bulunamadı" de

Veri yoksa "Kayıt bulunamadı" de`;

// ─── Çoklu cari seçimi için bekleyen sorgular (5 dakika TTL) ─
const _pending = new Map(); // phone → { question, cardName, dbName, expiresAt }

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
    const results = await executeQueries(sl, plan.queries, dbName || config.sap.companyDb);

    // 4. Çoklu cari eşleşmesi? → liste göster, bekle
    const multiMatch = Object.values(results).find(r => r.error === 'multiple_matches');
    if (multiMatch) {
      const cardName = plan.queries.find(q => q.params?.cardName)?.params?.cardName || '';
      _pending.set(from, { question, cardName, dbName, expiresAt: Date.now() + 5 * 60 * 1000 });
      return await sendCardSelectionList(from, multiMatch.data);
    }

    // 4b. BusinessPartners çoklu sonuç → seçim listesi (isimden arama yapıldıysa)
    const bpMulti = Object.values(results).find(r => r.endpoint === 'BusinessPartners' && r.count > 1);
    if (bpMulti) {
      const records = bpMulti.data.map(r => ({ CardCode: r.CardCode, CardName: r.CardName, Currency: r.Currency || '' }));
      _pending.set(from, { question, cardName: '', dbName, expiresAt: Date.now() + 5 * 60 * 1000 });
      return await sendCardSelectionList(from, records);
    }

    // 5. Claude ile sonuçları formatla
    const formatted = await formatResults(question, plan.queries, results);
    await sendText(from, formatted);

  } catch (err) {
    console.error('[Cashflow] Hata:', err.message);
    await sendText(from,
      '⚠️ SAP sorgusu sırasında hata oluştu. Lütfen tekrar deneyin.'
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Çoklu cari listesini WhatsApp liste mesajı olarak gönder
// ─────────────────────────────────────────────────────────────
async function sendCardSelectionList(to, records) {
  const rows = records.slice(0, 10).map(r => {
    const code     = r.CardCode || r.cardCode || '';
    const name     = r.CardName || r.cardName || '';
    const currency = r.Currency || r.currency || '';
    const desc     = [name, currency].filter(Boolean).join(' | ').substring(0, 72);
    return {
      id:          `CARI_SEL:${code}|${name.substring(0, 60)}`,
      title:       code,
      description: desc,
    };
  });

  return sendList(
    to,
    '🔍 Birden fazla cari bulundu',
    'Hangi cariyi kastediyordunuz? Seçin, sorgunuz otomatik çalışır:',
    'Carileri Gör',
    [{ title: 'Eşleşen Cariler', rows }]
  );
}

// ─────────────────────────────────────────────────────────────
// Kullanıcı listeden bir cari seçti → bekleyen sorguyu çalıştır
// ─────────────────────────────────────────────────────────────
async function handleCardSelection({ from, cardCode, cardName }) {
  const pending = _pending.get(from);
  _pending.delete(from);

  if (!pending || Date.now() > pending.expiresAt) {
    return sendText(from, '⏱️ Seçim süresi doldu. Lütfen sorunuzu tekrar yazın.');
  }

  // Orijinal sorguda geçen cari adını CardCode ile değiştir
  const newQuestion = pending.cardName
    ? pending.question.replace(new RegExp(pending.cardName, 'gi'), cardCode)
    : `${cardCode} için: ${pending.question}`;

  console.log(`[Cashflow] Cari seçildi: ${cardCode} (${cardName}) → "${newQuestion}"`);
  return handleQuery({ from, question: newQuestion, dbName: pending.dbName });
}

// ─── Eski getCashflow interface'ini koru (geriye dönük uyumluluk) ───
async function getCashflow({ from, cardCode }) {
  const question = cardCode
    ? `${cardCode} carisinin nakit durumu: açık faturalar, bakiye ve vadeye göre özet`
    : 'Genel nakit akışı durumu: bugün vadesi gelen tahsilatlar ve ödemeler';
  return handleQuery({ from, question });
}

// ─────────────────────────────────────────────────────────────
// Claude: Sorgu planı oluştur (Haiku — hızlı ve düşük token)
// ─────────────────────────────────────────────────────────────
async function buildQueryPlan(question, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model:      'claude-haiku-4-5-20251001',  // Planlama için Haiku yeterli
          max_tokens: 512,
          system:     QUERY_PLANNER_PROMPT,
          messages: [{ role: 'user', content: question }],
        },
        {
          headers: {
            'x-api-key':         config.anthropic.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          timeout: 30000,
        }
      );

      const raw = response.data?.content
        ?.filter(b => b.type === 'text')
        ?.map(b => b.text)
        ?.join('') || '{}';

      const cleaned = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 3000;
        console.warn(`[Cashflow] 429 rate limit, ${wait}ms bekle (deneme ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error('[Cashflow] Plan hatası:', err.response?.data || err.message);
      throw new Error('Sorgu planı oluşturulamadı');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SAP sorgularını çalıştır
// SQL_ prefix'li endpoint'ler direkt DB'ye, diğerleri Service Layer'a gider
// ─────────────────────────────────────────────────────────────
async function executeQueries(sl, queries, dbName) {
  const results = {};

  for (const q of queries) {
    try {
      // ── CardCode çözümleme: cardName varsa önce OCRD'den CardCode bul ──
      if (q.params?.cardName && !q.params?.cardCode) {
        const resolved = await resolveCardCode({
          cardName: q.params.cardName,
          currency: q.params.currency || null,
          dbName,
        });

        if (resolved.found === 'none') {
          console.warn(`[Cashflow] CardCode bulunamadı: "${q.params.cardName}"`);
          results[q.id] = {
            description: q.description,
            endpoint:    q.endpoint,
            data:        [],
            count:       0,
            error:       `"${q.params.cardName}" adında cari bulunamadı`,
          };
          continue;

        } else if (resolved.found === 'many') {
          // Birden fazla eşleşme → kullanıcıya listele, sorguyu çalıştırma
          console.warn(`[Cashflow] Birden fazla cari: "${q.params.cardName}" → ${resolved.records.length} sonuç`);
          results[q.id] = {
            description: q.description,
            endpoint:    q.endpoint,
            data:        resolved.records,
            count:       resolved.records.length,
            error:       'multiple_matches',
          };
          continue;

        } else {
          // Tek eşleşme → devam et
          console.log(`[Cashflow] CardCode çözümlendi: "${q.params.cardName}" → ${resolved.record.CardCode}`);
          q.params.cardCode = resolved.record.CardCode;
        }
      }

      console.log(`[Cashflow] SAP → ${q.endpoint}`, q.params);

      let data;

      if (q.endpoint === 'SQL_CARI_EKSTRE') {
        // Direkt SQL: JDT1 + OJDT + OCHH (waterfall bakiye)
        const rows = await getCariEkstre({
          cardCode: q.params.cardCode,
          refDate:  q.params.refDate,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_VADESI_GECENLER') {
        const rows = await getVadesiGecenler({
          refDate:  q.params.refDate,
          cardType: q.params.cardType || 'C',
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_HIZMET') {
        // Direkt SQL: BE1_B2BLASTHIZMETSTATUS view
        const rows = await getHizmetDurumu({
          cardCode:     q.params.cardCode     || null,
          serialNo:     q.params.serialNo     || null,
          callId:       q.params.callId       || null,
          statusFilter: q.params.statusFilter || null,
          top:          parseInt(q.params.top) || 20,
          dbName,
        });
        data = rows;
      } else {
        // Service Layer (OData)
        const method = (q.method || 'GET').toUpperCase();
        if (method === 'POST') {
          const res = await sl.post(q.endpoint, q.body || {});
          data = [res];
        } else if (method === 'PATCH') {
          // endpoint içinde key zaten var: BusinessPartners('L00001')
          await sl._ensureSession();
          const res = await sl._http.patch(q.endpoint, q.body || {}, { headers: sl._cookieHeader() });
          data = [{ success: true, status: res.status }];
        } else {
          const res = await sl.get(q.endpoint, q.params || {});
          data = res?.value || res || [];
        }
      }

      results[q.id] = {
        description: q.description,
        endpoint:    q.endpoint,
        data:        Array.isArray(data) ? data : [data],
        count:       Array.isArray(data) ? data.length : 1,
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
async function formatResults(originalQuestion, queries, results, retries = 2) {
  const dataForClaude = queries.map(q => ({
    sorgu:  q.description,
    sonuc:  results[q.id]?.data,
    toplam: results[q.id]?.count,
    hata:   results[q.id]?.error,
  }));

  const userMessage = `Kullanıcı sorusu: "${originalQuestion}"\n\nSAP'tan gelen veriler:\n${JSON.stringify(dataForClaude, null, 2)}\n\nBu veriyi kullanıcıya WhatsApp mesajı olarak formatla.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model:      'claude-haiku-4-5-20251001',
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
          timeout: 30000,
        }
      );

      return response.data?.content
        ?.filter(b => b.type === 'text')
        ?.map(b => b.text)
        ?.join('') || '⚠️ Sonuç formatlanamadı.';
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 3000;
        console.warn(`[Cashflow] Formatter 429, ${wait}ms bekle (deneme ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error('[Cashflow] Formatter hatası:', err.response?.data || err.message);
      return '⚠️ Sonuç formatlanamadı.';
    }
  }
}

module.exports = { getCashflow, handleQuery, handleCardSelection };
