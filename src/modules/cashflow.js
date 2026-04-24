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
const { getCariEkstre, getVadesiGecenler, getHizmetDurumu, resolveCardCode, getSatisByKategori, getSatisByMarka, getSatisByTemsilci, getStokSatissiz, getStokFiyatListesi, getStokSeriListesi } = require('./sapDb');
const { sendText, sendList }         = require('../services/whatsappService');
const { buildEdocUrl }               = require('../services/edocumentService');
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

Ürün kategorisine göre satış tutarları:
  endpoint: "SQL_SATIS_KATEGORI"
  params: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "top": "5" }
  → Kullanım: "kategori bazlı satış", "ürün grubu satışları", "en çok satan kategori"

Marka bazlı satış tutarları (SatisTemsilcisi dahil):
  endpoint: "SQL_SATIS_MARKA"
  params: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "top": "5" }
  → Kullanım: "marka bazlı satış", "markaya göre satış", "en çok satan marka"

Satış temsilcisi bazlı satış tutarları:
  endpoint: "SQL_SATIS_TEMSILCI"
  params: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "top": "10" }
  → Kullanım: "temsilci bazlı satış", "satış personeli raporu", "en çok satan temsilci", "çalışan bazlı satış"

Stokta olup satışı olmayan ürünler:
  endpoint: "SQL_STOK_SATISSIZ"
  params: { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "top": "20" }
  startDate/endDate opsiyonel — verilmezse tüm zamanlar kontrol edilir
  → Kullanım: "satılmayan stoklar", "stokta olup satışı olmayan", "hareketsiz stok", "ölü stok"

Müşteriye ait seri bazlı depo stok listesi (BE1_STOKSERILISTE_ALL):
  endpoint: "SQL_STOK_SERI"
  params: { "cardCode": "MB00119", "whsCode": "M1" }
  cardCode zorunlu — kullanıcının kendi kodu (sistem otomatik kilitler)
  whsCode zorunlu — kullanıcının mesajından çıkar (M1, M2, vs.)
  → Kullanım: "M1 depo stoğum", "depodaki mallarım", "M1 warehouse stoğu", "depo stok listesi M1"

Stokta olan ürünlerin fiyat listesi (OITM + OITW + ITM1):
  endpoint: "SQL_STOK_FIYAT"
  params: { "filter": "AMD", "priceList": "1", "top": "30" }
  filter: ürün adı / marka / ItemCode içindeki arama terimi (ör: "AMD", "SAMSUNG", "NOTEBOOK")
  priceList: fiyat listesi numarası — belirtilmezse 1 kullan
  top: kaç kayıt — varsayılan 30
  → Kullanım: "AMD fiyat listesi", "AMD ürünleri fiyatı", "stokta olan ürünler fiyatıyla",
              "fiyat listesi", "hangi ürünler var fiyatıyla", "stok fiyatları"
  KRİTİK: Items endpoint KULLANMA — fiyat için SAP SL Items'da Price alanı yoktur, $expand desteklenmez

KURALLAR:
- Birden fazla sorgu gerekiyorsa queries dizisine ekle (max 3)
- Cari adından CardCode bulmak için BusinessPartners + başka endpoint şeklinde 2 sorgu YAZMA.
  Bunun yerine tek sorguda cardName parametresi kullan — sistem CardCode'u otomatik çözer.
  Örnek: Activities için cardName: "OKSİD" yaz; $filter içine CARDCODE_FROM_Q1 placeholder YAZMA.
  Zorunlu durumlarda placeholder kullanacaksan: CARDCODE_FROM_Q1, CARDCODE_FROM_Q2 formatını koru.
- Parametre yoksa params: {} bırak
- Tarih belirtilmemişse refDate: "${new Date().toISOString().split('T')[0]}" kullan
- Sadece JSON döndür, açıklama ekleme
- $expand KULLANMA — SAP B1 Service Layer desteklemiyor
- Fatura satır detayı (DocumentLines, ItemCode, Quantity vb.) gereken sorgular için SQL endpoint kullan

KRİTİK — clarification_needed KULLANIM KURALI:
clarification_needed: true SADECE şu durumda kullan:
  → Sorgu tipi tamamen belirsiz VE isim/kod/konu yoksa (ör: sadece "bilgi ver")
clarification_needed: false kullan (ZORUNLU) şu durumlarda:
  → Kullanıcı bir firma/kişi adı verdiyse → cardName kullan, SOR MA
  → Kullanıcı CardCode verdiyse (C001, MB001 gibi) → cardCode kullan, SOR MA
  → Kullanıcı konu belirttiyse (bakiye, fatura, stok vb.) → sorgula, SOR MA

ÖRNEKLER — clarification_needed: false:
- "OKSİD bakiyesi" → SQL_CARI_EKSTRE, cardName: "OKSİD"
- "Endeks firması" → BusinessPartners, $filter: contains(CardName,'Endeks')
- "ABC Teknoloji servisi" → SQL_HIZMET, cardName: "ABC Teknoloji"
- "Veli Bey'in faturaları" → Invoices, $filter: contains(CardName,'Veli')
- "C001" → SQL_CARI_EKSTRE, cardCode: "C001"  (tek kelime = bakiye sorgula)`;

// ─── Yerel formatter yardımcıları ─────────────────────────────
const MONTHS_TR = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];

function fmtDate(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).substring(0, 10);
    return `${d.getDate()} ${MONTHS_TR[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return String(val).substring(0, 10); }
}

function fmtMoney(val, currency) {
  const n   = parseFloat(val) || 0;
  const abs = Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = (currency && currency !== 'TRY') ? ` ${currency}` : ' ₺';
  return (n < 0 ? '-' : '') + abs + cur;
}

// ─── Çoklu cari seçimi için bekleyen sorgular (5 dakika TTL) ─
const _pending = new Map(); // phone → { question, cardName, dbName, expiresAt }

// ─── Sorgu sonuç cache'i (2 dk TTL) ──────────────────────────
// Aynı kullanıcının aynı sorusunu tekrar Claude+SAP'a göndermez.
const _resultCache = new Map();
const _CACHE_TTL   = 2 * 60 * 1000;
const _CACHE_MAX   = 300;

function _cacheKey(from, q)  { return `${from}::${q.trim().toLowerCase()}`; }
function _cacheGet(from, q) {
  const hit = _resultCache.get(_cacheKey(from, q));
  return (hit && Date.now() - hit.ts < _CACHE_TTL) ? hit.text : null;
}
function _cacheSet(from, q, text) {
  if (_resultCache.size >= _CACHE_MAX) _resultCache.delete(_resultCache.keys().next().value);
  _resultCache.set(_cacheKey(from, q), { text, ts: Date.now() });
}
// "yenile / güncelle / taze / refresh" içeriyorsa cache atlanır
function _bypassCache(q) { return /yenile|güncelle|taze|refresh/i.test(q); }

// ─────────────────────────────────────────────────────────────
// Ana fonksiyon – Cashflow ve genel SAP sorguları
// ─────────────────────────────────────────────────────────────
async function handleQuery({ from, question, dbName, _skipFallback = false, licenseRestriction = null, customerCardCode = null, lang = 'tr' }) {
  if (!question || question.trim() === '') {
    return await sendText(from,
      '📊 *SAP Sorgulama*\n\nNe öğrenmek istersiniz?\n\nÖrnek:\n• _"C001 carisinin bakiyesi"_\n• _"Bu hafta vadesi gelen ödemeler"_\n• _"Stokta azalan ürünler"_'
    );
  }

  console.log(`[Cashflow] Sorgu (${from}): ${question}`);

  // Cache kontrolü — yenileme isteği veya cari-seçim sonrası atla
  if (!_skipFallback && !_bypassCache(question)) {
    const hit = _cacheGet(from, question);
    if (hit) {
      console.log(`[Cashflow] Cache hit → ${from}`);
      return await sendText(from, hit);
    }
  }

  await sendText(from, '⏳ SAP sorgulanıyor...');

  try {
    // 1. Claude'a sor: hangi SAP sorgusunu çalıştıralım?
    const { langInstruction } = require('../services/i18n');
    const langNote     = langInstruction(lang);
    const planQuestion = [
      licenseRestriction ? `[LİSANS KISITLAMASI: ${licenseRestriction}]` : '',
      langNote           ? `[YANIT DİLİ: ${langNote}]` : '',
      question,
    ].filter(Boolean).join('\n\n');
    const plan = await buildQueryPlan(planQuestion);

    // Müşteri kullanıcıysa tüm sorguları kendi CardCode'una kilitle
    if (customerCardCode && Array.isArray(plan.queries)) {
      plan.queries.forEach(q => {
        q.params = q.params || {};
        if (['SQL_HIZMET', 'SQL_CARI_EKSTRE', 'SQL_STOK_SERI'].includes(q.endpoint)) {
          q.params.cardCode = customerCardCode;
          delete q.params.cardName;
        } else if (q.method !== 'POST' && q.method !== 'PATCH') {
          // OData GET sorgularına CardCode filtresi ekle
          const existing = q.params['$filter'];
          const cardFilter = `CardCode eq '${customerCardCode}'`;
          q.params['$filter'] = existing ? `(${existing}) and ${cardFilter}` : cardFilter;
        }
      });
    }

    // 2. Ek bilgi gerekiyor mu?
    // Planner clarification istedi ama soru içinde isim/harf dizisi varsa
    // → direkt BusinessPartners'da cardName araması yap (hatalı clarification kurtarma)
    // _skipFallback=true ise (cari seçimi sonrası) bu bloğu atla → sonsuz döngü önlenir
    if (plan.clarification_needed && !_skipFallback) {
      const nameMatch = question.match(/([A-ZÇĞİÖŞÜa-zçğışöşü]{3,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöşü]{2,})*)/);
      if (nameMatch) {
        const cardName      = nameMatch[1].trim();
        const cardNameTR    = cardName.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
        const cardNameASCII = cardName.toUpperCase();
        const escaped       = (s) => s.replace(/'/g, "''");
        const variants      = [...new Set([cardName, cardNameTR, cardNameASCII])];
        const filter        = variants.map(v => `contains(CardName,'${escaped(v)}')`).join(' or ');
        console.log(`[Cashflow] clarification fallback → BusinessPartners: "${cardName}" / "${cardNameTR}" / "${cardNameASCII}"`);
        const sl       = getConnection(dbName || config.sap.companyDb);
        const fallback = await executeQueries(sl, [{
          id: 'q1', description: 'Cari arama', endpoint: 'BusinessPartners', method: 'GET',
          params: { '$filter': filter, '$select': 'CardCode,CardName,Currency,CardType', '$top': '10' },
        }], dbName || config.sap.companyDb);
        const bpRes = fallback['q1'];
        if (bpRes?.count === 1) {
          const found = bpRes.data[0];
          return handleQuery({ from, question: `${found.CardCode} : ${question}`, dbName, _skipFallback: true });
        } else if (bpRes?.count > 1) {
          const records = bpRes.data.map(r => ({ CardCode: r.CardCode, CardName: r.CardName, Currency: r.Currency || '' }));
          _pending.set(from, { question, searchTerm: cardName, dbName, expiresAt: Date.now() + 5 * 60 * 1000 });
          return await sendCardSelectionList(from, records);
        }
      }
      return await sendText(from, `❓ ${plan.clarification_message}`);
    }

    if (!plan.queries || plan.queries.length === 0) {
      return await sendText(from, '⚠️ Bu sorgu için uygun bir SAP verisi bulunamadı.');
    }

    // 3. SAP sorgularını çalıştır
    const sl      = getConnection(dbName || config.sap.companyDb);
    const results = await executeQueries(sl, plan.queries, dbName || config.sap.companyDb);

    // 4. Çoklu cari eşleşmesi? → liste göster, bekle (seçim sonrası tekrar sorma)
    if (!_skipFallback) {
      const multiMatch = Object.values(results).find(r => r.error === 'multiple_matches');
      if (multiMatch) {
        const searchTerm = plan.queries.find(q => q.params?.cardName)?.params?.cardName || '';
        _pending.set(from, { question, searchTerm, dbName, expiresAt: Date.now() + 5 * 60 * 1000 });
        return await sendCardSelectionList(from, multiMatch.data);
      }

      const bpMulti = Object.values(results).find(r => r.endpoint === 'BusinessPartners' && r.count > 1);
      if (bpMulti) {
        const bpFilter   = plan.queries.find(q => q.endpoint === 'BusinessPartners')?.params?.['$filter'] || '';
        const termMatch  = bpFilter.match(/contains\(CardName,'([^']+)'\)/i);
        const searchTerm = termMatch?.[1] || '';
        const records    = bpMulti.data.map(r => ({ CardCode: r.CardCode, CardName: r.CardName, Currency: r.Currency || '' }));
        _pending.set(from, { question, searchTerm, dbName, expiresAt: Date.now() + 5 * 60 * 1000 });
        return await sendCardSelectionList(from, records);
      }
    }

    // 5. Sonuçları formatla
    const formatted = formatResultsLocal(question, plan.queries, results);
    if (!_skipFallback) _cacheSet(from, question, formatted);
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

  // Orijinal sorgudaki cari adını/arama terimini CardCode ile değiştir
  // searchTerm biliniyorsa yerine koy, bilinmiyorsa başa ekle
  let newQuestion;
  if (pending.searchTerm) {
    const esc = pending.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newQuestion = pending.question.replace(new RegExp(esc, 'gi'), cardCode);
    if (newQuestion === pending.question) newQuestion = `${cardCode} : ${pending.question}`;
  } else {
    newQuestion = `${cardCode} : ${pending.question}`;
  }

  console.log(`[Cashflow] Cari seçildi: ${cardCode} (${cardName}) → "${newQuestion}"`);
  return handleQuery({ from, question: newQuestion, dbName: pending.dbName, _skipFallback: true });
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
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 512,
          // system dizi formatında — büyük dokümanlar (SAP context + scenarios) cache'lenir
          system: [{ type: 'text', text: QUERY_PLANNER_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: question }],
        },
        {
          headers: {
            'x-api-key':         config.anthropic.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'prompt-caching-2024-07-31',
            'content-type':      'application/json',
          },
          timeout: 30000,
        }
      );

      const raw = response.data?.content
        ?.filter(b => b.type === 'text')
        ?.map(b => b.text)
        ?.join('') || '{}';

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
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
  const resolvedCodes = {}; // queryId → CardCode (cross-query substitution için)

  for (const q of queries) {
    try {
      // ── Cross-query substitution: CARDCODE_FROM_Qx placeholder'larını çöz ──
      for (const key of Object.keys(q.params || {})) {
        if (typeof q.params[key] === 'string') {
          q.params[key] = q.params[key].replace(/CARDCODE_FROM_(Q\d+)/gi, (match, qId) => {
            return resolvedCodes[qId.toUpperCase()] || match;
          });
        }
      }

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
          const cc = resolved.record.CardCode;
          console.log(`[Cashflow] CardCode çözümlendi: "${q.params.cardName}" → ${cc}`);
          q.params.cardCode = cc;
          resolvedCodes[q.id.toUpperCase()] = cc;
          // OData $filter'ı da güncelle (cardName placeholder yerine gerçek CardCode)
          if (q.params['$filter']) {
            q.params['$filter'] = q.params['$filter']
              .replace(/contains\s*\(\s*CardName\s*,[^)]+\)/gi, `CardCode eq '${cc}'`)
              .replace(/CardName\s+eq\s+'[^']*'/gi, `CardCode eq '${cc}'`);
          } else {
            q.params['$filter'] = `CardCode eq '${cc}'`;
          }
          delete q.params.cardName;
        }
      }

      // Activities endpoint: CardName $filter içinde geçersiz → CardCode'a çevir
      if (q.endpoint === 'Activities' && q.params?.['$filter']) {
        const filterStr = q.params['$filter'];
        const nameMatch = filterStr.match(/contains\s*\(\s*CardName\s*,\s*'([^']+)'\s*\)/i)
                       || filterStr.match(/CardName\s+eq\s+'([^']+)'/i);
        if (nameMatch) {
          const nameVal  = nameMatch[1];
          const resolved = await resolveCardCode({ cardName: nameVal, dbName });
          if (resolved.found === 'one') {
            const cc = resolved.record.CardCode;
            console.log(`[Cashflow] Activities CardName→CardCode: "${nameVal}" → ${cc}`);
            q.params['$filter'] = filterStr
              .replace(/contains\s*\(\s*CardName\s*,[^)]+\)/gi, `CardCode eq '${cc}'`)
              .replace(/CardName\s+eq\s+'[^']*'/gi, `CardCode eq '${cc}'`);
            resolvedCodes[q.id.toUpperCase()] = cc;
          } else if (resolved.found === 'many') {
            results[q.id] = { description: q.description, endpoint: q.endpoint,
              data: resolved.records, count: resolved.records.length, error: 'multiple_matches' };
            continue;
          } else {
            results[q.id] = { description: q.description, endpoint: q.endpoint,
              data: [], count: 0, error: `"${nameVal}" adında cari bulunamadı` };
            continue;
          }
        }
      }

      // Action/CardName field Activities GET sorgularında geçersiz — otomatik temizle
      if (q.endpoint === 'Activities' && q.params?.['$select']) {
        q.params['$select'] = q.params['$select'].split(',')
          .filter(f => !['Action', 'CardName'].includes(f.trim())).join(',');
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
      } else if (q.endpoint === 'SQL_SATIS_KATEGORI') {
        const rows = await getSatisByKategori({
          startDate: q.params.startDate,
          endDate:   q.params.endDate,
          top:       parseInt(q.params.top) || 5,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_SATIS_MARKA') {
        const rows = await getSatisByMarka({
          startDate: q.params.startDate,
          endDate:   q.params.endDate,
          top:       parseInt(q.params.top) || 5,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_SATIS_TEMSILCI') {
        const rows = await getSatisByTemsilci({
          startDate: q.params.startDate,
          endDate:   q.params.endDate,
          top:       parseInt(q.params.top) || 10,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_STOK_SATISSIZ') {
        const rows = await getStokSatissiz({
          startDate: q.params.startDate || null,
          endDate:   q.params.endDate   || null,
          top:       parseInt(q.params.top) || 20,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_STOK_FIYAT') {
        const rows = await getStokFiyatListesi({
          filter:    q.params.filter    || '',
          priceList: parseInt(q.params.priceList || process.env.STOCK_PRICE_LIST || '1'),
          top:       parseInt(q.params.top)       || 30,
          dbName,
        });
        data = rows;
      } else if (q.endpoint === 'SQL_STOK_SERI') {
        const rows = await getStokSeriListesi({
          cardCode: q.params.cardCode,
          whsCode:  q.params.whsCode,
          top:      parseInt(q.params.top) || 200,
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
          // Pazarlama belgelerinde NumAtCard'ı otomatik ekle (e-belge linki için)
          if (_edocTypeForEndpoint(q.endpoint) && q.params?.['$select'] && !q.params['$select'].includes('NumAtCard')) {
            q.params['$select'] += ',NumAtCard';
          }
          const res = await sl.get(q.endpoint, q.params || {});
          data = res?.value || res || [];
        }
      }

      const dataArr = Array.isArray(data) ? data : [data];
      // Sonraki sorgular için CardCode'u kaydet
      if (dataArr.length === 1 && dataArr[0]?.CardCode) {
        resolvedCodes[q.id.toUpperCase()] = dataArr[0].CardCode;
      }

      results[q.id] = {
        description: q.description,
        endpoint:    q.endpoint,
        data:        dataArr,
        count:       dataArr.length,
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
// Yerel formatter – Claude API kullanılmaz
// ─────────────────────────────────────────────────────────────
function formatResultsLocal(_question, queries, results) {
  const parts = [];

  for (const q of queries) {
    const r  = results[q.id];
    if (!r) continue;

    if (r.error && r.error !== 'multiple_matches') {
      parts.push(`⚠️ *${r.description}*\n${r.error}`);
      continue;
    }

    const ep   = q.endpoint;
    const data = r.data || [];
    const sec  = [];

    if (ep === 'SQL_CARI_EKSTRE') {
      const eks = data[0] || {};
      sec.push(`💼 *${r.description || 'Cari Hesap Durumu'}*\n`);
      if (!eks.acikKalemler?.length && !eks.toplamTRY) {
        sec.push('✅ Açık bakiye yok.');
      } else {
        if (eks.toplamTRY > 0) sec.push(`🔴 *Borç (TRY): ${fmtMoney(eks.toplamTRY)}*`);
        if (eks.toplamFC  > 0) sec.push(`🔴 *Borç (Döviz): ${fmtMoney(eks.toplamFC, eks.acikKalemler[0]?.ParaBirimi)}*`);
        if (eks.bekleyenCekSayisi > 0) sec.push(`🗓 Bekleyen çek: ${eks.bekleyenCekSayisi} adet (${fmtMoney(eks.bekleyenCekTRY)})`);
        const items = eks.acikKalemler || [];
        if (items.length) {
          sec.push('\n*Açık Kalemler:*');
          items.slice(0, 8).forEach(k => {
            const gec  = k.GecikmeGun > 0 ? ` ⚠️ ${k.GecikmeGun}g geç` : '';
            const acik = k.KalanTRY > 0 ? fmtMoney(k.KalanTRY) : fmtMoney(k.KalanFC, k.ParaBirimi);
            sec.push(`• ${fmtDate(k.VadeTarihi)} — ${String(k.Aciklama || '').substring(0, 28)} — *${acik}*${gec}`);
          });
          if (items.length > 8) sec.push(`_... ve ${items.length - 8} kalem daha_`);
        }
      }

    } else if (ep === 'SQL_VADESI_GECENLER') {
      sec.push(`📋 *${r.description}* (${r.count} cari)\n`);
      let total = 0;
      data.slice(0, 10).forEach(row => {
        const bal = parseFloat(row.BakiyeTRY || 0);
        total += bal;
        sec.push(`• *${row.CardName}*: ${fmtMoney(bal)}${row.EnEskiVade ? ` · en eski: ${fmtDate(row.EnEskiVade)}` : ''}`);
      });
      if (data.length > 10) sec.push(`_... ve ${data.length - 10} cari daha_`);
      sec.push(`\n💰 *Toplam Açık: ${fmtMoney(total)}*`);

    } else if (ep === 'SQL_SATIS_KATEGORI') {
      sec.push(`📊 *${r.description}* (${r.count} kategori)\n`);
      let total = 0;
      data.forEach((row, i) => {
        const amt = parseFloat(row.ToplamSatis || 0);
        total += amt;
        sec.push(`${i + 1}. *${row.Kategori}* · ${row.SatisTemsilcisi}\n   ${fmtMoney(amt)} (${row.BelgeSayisi} fatura)`);
      });
      sec.push(`\n💰 *Toplam: ${fmtMoney(total)}*`);

    } else if (ep === 'SQL_SATIS_MARKA') {
      sec.push(`🏷 *${r.description}* (${r.count} marka)\n`);
      let total = 0;
      data.forEach((row, i) => {
        const amt = parseFloat(row.ToplamSatis || 0);
        total += amt;
        sec.push(`${i + 1}. *${row.Marka}* · ${row.SatisTemsilcisi}\n   ${fmtMoney(amt)} (${row.BelgeSayisi} fatura)`);
      });
      sec.push(`\n💰 *Toplam: ${fmtMoney(total)}*`);

    } else if (ep === 'SQL_SATIS_TEMSILCI') {
      sec.push(`👤 *${r.description}* (${r.count} temsilci)\n`);
      let total = 0;
      data.forEach((row, i) => {
        const amt = parseFloat(row.ToplamSatis || 0);
        total += amt;
        sec.push(`${i + 1}. *${row.SatisTemsilcisi}*: ${fmtMoney(amt)} (${row.BelgeSayisi} fatura)`);
      });
      sec.push(`\n💰 *Toplam: ${fmtMoney(total)}*`);

    } else if (ep === 'SQL_STOK_SATISSIZ') {
      sec.push(`📦 *${r.description}* (${r.count} ürün)\n`);
      data.slice(0, 15).forEach((row, i) => {
        const miktar = parseFloat(row.StokMiktari || 0).toLocaleString('tr-TR');
        sec.push(`${i + 1}. *${row.UrunAdi}* (${row.ItemCode})\n   Stok: ${miktar} ${row.Birim || ''} · ${row.Kategori || ''}`);
      });
      if (data.length > 15) sec.push(`_... ve ${data.length - 15} ürün daha_`);

    } else if (ep === 'SQL_STOK_FIYAT') {
      if (!data.length) {
        sec.push(`📭 *${r.description}*\nStokta eşleşen ürün bulunamadı.`);
      } else {
        sec.push(`🏷 *${r.description}* (${r.count} ürün)\n`);
        data.forEach(row => {
          const stok   = parseFloat(row.StokMiktar || 0).toLocaleString('tr-TR');
          const fiyat  = parseFloat(row.Fiyat || 0);
          const fiyatS = fiyat > 0 ? fmtMoney(fiyat, row.FiyatPB !== 'TRY' ? row.FiyatPB : null) : '—';
          const marka  = row.Marka ? ` [${row.Marka}]` : '';
          sec.push(
            `▸ *${row.ItemCode}*${marka}\n` +
            `  ${String(row.ItemName).substring(0, 55)}\n` +
            `  Stok: ${stok} ${row.Birim || ''} · Fiyat: *${fiyatS}*`
          );
        });
      }

    } else if (ep === 'SQL_STOK_SERI') {
      if (!data.length) {
        sec.push(`📭 *${r.description}*\nBu depoda kayıtlı ürün bulunamadı.`);
      } else {
        // Kalem bazlı grupla
        const byItem = {};
        data.forEach(row => {
          const key = row.ItemCode;
          if (!byItem[key]) byItem[key] = { name: row.ItemName || row.ItemCode, serials: [] };
          if (row.DistNumber) byItem[key].serials.push(row.DistNumber);
        });
        const items = Object.entries(byItem);
        const whsCode = data[0]?.WhsCode || '';
        sec.push(`📦 *${r.description}* — Depo: ${whsCode}\n${items.length} ürün, ${data.length} seri\n`);
        items.forEach(([itemCode, info]) => {
          sec.push(`▸ *${itemCode}* – ${String(info.name).substring(0, 50)}`);
          info.serials.slice(0, 8).forEach(s => sec.push(`  • ${s}`));
          if (info.serials.length > 8) sec.push(`  _... +${info.serials.length - 8} seri_`);
        });
      }

    } else if (ep === 'SQL_HIZMET') {
      if (!data.length) {
        sec.push(`📭 *${r.description}*\nKayıt bulunamadı.`);
      } else {
        sec.push(`🔧 *${r.description}* (${r.count} çağrı)\n`);
        data.slice(0, 8).forEach(row => {
          sec.push(
            `#${row.CagriNo} *${row.Musteri}* [${row.Durum || row.StatusKod || ''}]` +
            (row.SeriNo ? ` · SN: ${row.SeriNo}` : '') +
            `\n   📅 ${fmtDate(row.AcilisTarihi)}` +
            (row.Aciklama ? ` · ${String(row.Aciklama).substring(0, 40)}` : '')
          );
        });
        if (data.length > 8) sec.push(`_... ve ${data.length - 8} çağrı daha_`);
      }

    } else {
      // OData generic
      if (!data.length) {
        sec.push(`📭 *${r.description}*\nKayıt bulunamadı.`);
      } else {
        sec.push(`📋 *${r.description}* (${r.count} kayıt)\n`);
        let totalDoc = 0;
        const edocType = _edocTypeForEndpoint(ep);
        data.slice(0, 10).forEach(row => {
          const line = _fmtODataRow(row);
          if (!line) return;
          let rowText = `• ${line}`;
          if (edocType && row.NumAtCard) {
            const url = buildEdocUrl(edocType, row.NumAtCard);
            if (url) rowText += `\n  📄 ${url}`;
          }
          sec.push(rowText);
          totalDoc += parseFloat(row.DocTotal || 0);
        });
        if (data.length > 10) sec.push(`_... ve ${data.length - 10} kayıt daha_`);
        if (totalDoc > 0) sec.push(`\n💰 *Toplam: ${fmtMoney(totalDoc)}*`);
      }
    }

    if (sec.length) parts.push(sec.join('\n'));
  }

  return parts.join('\n\n') || '📭 Sonuç bulunamadı.';
}

function _edocTypeForEndpoint(endpoint) {
  if (!endpoint) return null;
  if (/^Invoices$/i.test(endpoint))      return 'efatura';   // OINV → efatura (yoksa earsiv fallback)
  if (/DeliveryNote/i.test(endpoint))    return 'eirsaliye'; // ODLN
  if (/^Returns$/i.test(endpoint))       return 'earsiv';    // ORDN
  if (/^CreditNote/i.test(endpoint))     return 'earsiv';    // ORIN
  return null;
}

function _fmtODataRow(row) {
  const p = [];
  if (row.DocNum)    p.push(`#${row.DocNum}`);
  if (row.CardName)  p.push(`*${row.CardName}*`);
  if (row.DocDate)   p.push(fmtDate(row.DocDate));
  if (row.DocDueDate) p.push(`Vade: ${fmtDate(row.DocDueDate)}`);
  if (row.DocTotal)  p.push(fmtMoney(row.DocTotal, row.DocCurrency));
  if (row.DocumentStatus) p.push(row.DocumentStatus === 'bost_Open' ? '🟢 Açık' : '⚫ Kapalı');
  if (p.length) return p.join(' · ');

  // Hiçbir bilinen alan yoksa ilk 4 non-null alanı yaz
  let n = 0;
  for (const [k, v] of Object.entries(row)) {
    if (!v || typeof v === 'object' || k.includes('odata')) continue;
    p.push(`${k}: ${v}`);
    if (++n >= 4) break;
  }
  return p.join(' · ');
}

module.exports = { getCashflow, handleQuery, handleCardSelection };
