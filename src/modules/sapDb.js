'use strict';

/**
 * sapDb.js
 *
 * SAP B1 MSSQL veritabanına direkt bağlantı.
 * Service Layer'ın desteklemediği JDT1/OJDT tabanlı sorgular için kullanılır.
 *
 * getCariEkstre → JDT1 satırlarını çeker, waterfall eşleştirme yapar,
 *                 sadece açık kalan kalemleri ve toplam bakiyeyi döndürür.
 */

const sql    = require('mssql');
const config = require('../config/config');

// Türkçe büyük harf: i→İ, ı→I + standart toUpperCase
function upperTR(s) {
  return String(s)
    .replace(/i/g, 'İ')
    .replace(/ı/g, 'I')
    .toUpperCase();
}

// ─── Bağlantı havuzu ─────────────────────────────────────────
const _pools = {};

async function getPool(dbName) {
  const db = dbName || config.sapDb.database;
  if (_pools[db] && _pools[db].connected) return _pools[db];

  const cfg = {
    server:   config.sapDb.server,
    database: db,
    user:     config.sapDb.user,
    password: config.sapDb.password,
    options: {
      encrypt:                false,
      trustServerCertificate: true,
      enableArithAbort:       true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };

  console.log(`[SapDb] Bağlanıyor → ${config.sapDb.server} / ${db}`);
  _pools[db] = await sql.connect(cfg);
  console.log(`[SapDb] Bağlantı başarılı → ${db}`);
  return _pools[db];
}

// ─────────────────────────────────────────────────────────────
// Waterfall Eşleştirme
//
// BE1_PROCORTALAMAVADE3 mantığı:
//   - Debits (borçlar): DueDate sırasına göre sıralı
//   - Credits (alacaklar): DueDate sırasına göre sıralı
//   - Her alacak, en eski borçtan itibaren düşülür
//   - TRY ve FC bağımsız hesaplanır
//   - Kalan açık borçlar = bakiye
// ─────────────────────────────────────────────────────────────
function calcWaterfall(rows) {
  // Borçlar (Debit > 0)
  const debits = rows
    .filter(r => Number(r.Debit) > 0 || Number(r.FCDebit) > 0)
    .sort((a, b) => new Date(a.DueDate) - new Date(b.DueDate) || a.TransId - b.TransId)
    .map(r => ({
      DueDate:    r.DueDate,
      RefDate:    r.RefDate,
      TransType:  r.TransType,
      BaseRef:    r.BaseRef,
      LineMemo:   r.LineMemo,
      FCCurrency: r.FCCurrency,
      debitTRY:   Number(r.Debit)   || 0,
      debitFC:    Number(r.FCDebit) || 0,
      kalanTRY:   Number(r.Debit)   || 0,   // waterfall sonrası kalan
      kalanFC:    Number(r.FCDebit) || 0,
    }));

  // Alacaklar (Credit > 0) — vadesi gelmemiş çekler zaten SQL'de filtrelendi
  const credits = rows
    .filter(r => Number(r.Credit) > 0 || Number(r.FCCredit) > 0)
    .sort((a, b) => new Date(a.DueDate) - new Date(b.DueDate) || a.TransId - b.TransId);

  // Vadesi gelmemiş bekleyen çekler
  const bekleyenCekler = rows.filter(r => r.BekleyenCek === 1 || r.BekleyenCek === true);

  // Waterfall: her alacağı en eski borçtan itibaren düş
  for (const credit of credits) {
    let kalanCreditTRY = Number(credit.Credit)   || 0;
    let kalanCreditFC  = Number(credit.FCCredit) || 0;

    for (const debit of debits) {
      // TRY eşleştirme
      if (kalanCreditTRY > 0.005 && debit.kalanTRY > 0.005) {
        const uygulanan = Math.min(kalanCreditTRY, debit.kalanTRY);
        debit.kalanTRY    = Math.round((debit.kalanTRY    - uygulanan) * 100) / 100;
        kalanCreditTRY    = Math.round((kalanCreditTRY    - uygulanan) * 100) / 100;
      }
      // FC eşleştirme (dövizli)
      if (kalanCreditFC > 0.005 && debit.kalanFC > 0.005) {
        const uygulanan = Math.min(kalanCreditFC, debit.kalanFC);
        debit.kalanFC  = Math.round((debit.kalanFC  - uygulanan) * 100) / 100;
        kalanCreditFC  = Math.round((kalanCreditFC  - uygulanan) * 100) / 100;
      }

      if (kalanCreditTRY <= 0.005 && kalanCreditFC <= 0.005) break;
    }
  }

  // Açık kalan borçlar
  const acikKalemler = debits
    .filter(d => d.kalanTRY > 0.01 || d.kalanFC > 0.01)
    .map(d => ({
      VadeTarihi:  d.DueDate,
      BelgeTarihi: d.RefDate,
      Aciklama:    d.LineMemo || d.BaseRef || '',
      ParaBirimi:  d.FCCurrency || 'TRY',
      KalanTRY:    d.kalanTRY,
      KalanFC:     d.kalanFC,
      GecikmeGun:  Math.max(0, Math.floor((new Date() - new Date(d.DueDate)) / 86400000)),
    }));

  const toplamTRY = acikKalemler.reduce((s, d) => s + d.KalanTRY, 0);
  const toplamFC  = acikKalemler.reduce((s, d) => s + d.KalanFC,  0);

  const bekleyenCekTRY = bekleyenCekler.reduce((s, r) => s + (Number(r.Credit)   || 0), 0);
  const bekleyenCekFC  = bekleyenCekler.reduce((s, r) => s + (Number(r.FCCredit) || 0), 0);

  return {
    acikKalemler,
    toplamTRY:      Math.round(toplamTRY * 100) / 100,
    toplamFC:       Math.round(toplamFC  * 100) / 100,
    bekleyenCekTRY: Math.round(bekleyenCekTRY * 100) / 100,
    bekleyenCekFC:  Math.round(bekleyenCekFC  * 100) / 100,
    bekleyenCekSayisi: bekleyenCekler.length,
    toplamKalemSayisi: acikKalemler.length,
  };
}

// ─────────────────────────────────────────────────────────────
// Cari Hesap Ekstresi — JDT1 + OJDT + OCHH + waterfall
// ─────────────────────────────────────────────────────────────
async function getCariEkstre({ cardCode, refDate, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  request.input('CardCode', sql.NVarChar(50), cardCode);
  request.input('RefDate',  sql.Date,         refDate);

  // TRY → Debit/Credit kullan
  // Dövizli → FCDebit/FCCredit kullan
  // Çek kuralı: TransType=24 + OCHH join → DueDate > RefDate ise BekleyenCek=1 (SQL'de filtrelenir)
  const query = `
    SELECT
      t0.ShortName,
      t0.Debit,
      t0.Credit,
      t0.FCDebit,
      t0.FCCredit,
      ISNULL(t0.FCCurrency, 'TRY') AS FCCurrency,
      t3.RefDate,
      t0.DueDate,
      t0.TransType,
      t0.BaseRef,
      t0.LineMemo,
      CASE
        WHEN t7.CheckKey IS NOT NULL AND t0.DueDate > @RefDate THEN 1
        ELSE 0
      END AS BekleyenCek
    FROM JDT1 t0 WITH(NOLOCK)
    INNER JOIN OJDT t3 WITH(NOLOCK) ON t3.TransId = t0.TransId
    OUTER APPLY (
      SELECT TOP 1 CheckKey
      FROM OCHH WITH(NOLOCK)
      WHERE RcptNum = t0.BaseRef
        AND t0.TransType = 24
      ORDER BY CheckKey DESC
    ) t7
    WHERE t0.ShortName = @CardCode
      AND (t0.Debit <> 0 OR t0.Credit <> 0 OR t0.FCDebit <> 0 OR t0.FCCredit <> 0)
      AND (
        -- Normal kayıtlar: kayıt tarihi <= referans tarihi
        (t7.CheckKey IS NULL AND t3.RefDate <= @RefDate)
        OR
        -- Vadesi gelen çekler: çek vadesi <= referans tarihi
        (t7.CheckKey IS NOT NULL AND t0.DueDate <= @RefDate)
        OR
        -- Vadesi gelmemiş çekler: göster ama BekleyenCek=1 işaretle
        (t7.CheckKey IS NOT NULL AND t0.DueDate > @RefDate AND t3.RefDate <= @RefDate)
      )
    ORDER BY t0.DueDate, t0.TransId, t0.Line_ID
  `;

  const result = await request.query(query);
  const rows   = result.recordset;

  if (!rows.length) {
    return {
      acikKalemler:      [],
      toplamTRY:         0,
      toplamFC:          0,
      bekleyenCekTRY:    0,
      bekleyenCekFC:     0,
      bekleyenCekSayisi: 0,
      toplamKalemSayisi: 0,
    };
  }

  return calcWaterfall(rows);
}

// ─────────────────────────────────────────────────────────────
// Vadesi geçmiş tüm müşteriler (özet)
// ─────────────────────────────────────────────────────────────
async function getVadesiGecenler({ refDate, cardType, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  request.input('RefDate',  sql.Date,       refDate);
  request.input('CardType', sql.VarChar(1), cardType || 'C');

  const query = `
    SELECT
      t0.ShortName        AS CardCode,
      t5.CardName,
      t5.Currency,
      SUM(CASE WHEN t0.Debit  > 0 THEN t0.Debit  ELSE 0 END) AS ToplamBorc,
      SUM(CASE WHEN t0.Credit > 0 THEN t0.Credit ELSE 0 END) AS ToplamAlacak,
      SUM(t0.Debit) - SUM(t0.Credit)                         AS BakiyeTRY,
      SUM(t0.FCDebit) - SUM(t0.FCCredit)                     AS BakiyeFC,
      MIN(t0.DueDate)                                         AS EnEskiVade
    FROM JDT1 t0 WITH(NOLOCK)
    INNER JOIN OJDT t3 WITH(NOLOCK) ON t3.TransId = t0.TransId
    INNER JOIN OCRD t5 WITH(NOLOCK) ON t0.ShortName = t5.CardCode
    WHERE t5.CardType = @CardType
      AND t3.RefDate <= @RefDate
      AND (t0.Debit <> 0 OR t0.Credit <> 0)
    GROUP BY t0.ShortName, t5.CardName, t5.Currency
    HAVING SUM(t0.Debit) - SUM(t0.Credit) > 0
    ORDER BY BakiyeTRY DESC
  `;

  const result = await request.query(query);
  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Teknik Servis Hizmet Çağrıları — BE1_B2BLASTHIZMETSTATUS view
//
// Parametreler (hepsi opsiyonel, en az biri verilmeli):
//   cardCode   → müşteri kodu (customer)
//   serialNo   → seri no (internalSN)
//   callId     → servis çağrı no (srvcCallID)
//   statusFilter → 'open' | 'closed' | null (hepsi)
//   top        → kaç kayıt (default 20)
// ─────────────────────────────────────────────────────────────
async function getHizmetDurumu({ cardCode, serialNo, callId, statusFilter, top = 20, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('Top', sql.Int, top);

  const conditions = [];

  if (cardCode) {
    request.input('CardCode', sql.NVarChar(50), cardCode);
    conditions.push('customer = @CardCode');
  }
  if (serialNo) {
    request.input('SerialNo', sql.NVarChar(50), `%${serialNo}%`);
    conditions.push('internalSN LIKE @SerialNo');
  }
  if (callId) {
    request.input('CallId', sql.Int, parseInt(callId));
    conditions.push('srvcCallID = @CallId');
  }
  if (statusFilter === 'open') {
    conditions.push("status = -1");   // -1 = açık
  } else if (statusFilter === 'closed') {
    conditions.push("status = 0");    // 0 = kapalı
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT TOP (@Top)
      customer        AS Musteri,
      srvcCallID      AS CagriNo,
      internalSN      AS SeriNo,
      itemName        AS UrunAdi,
      GelenBelge      AS GelenBelge,
      BelgeTarih      AS BelgeTarihi,
      KargoNo         AS GelenKargo,
      AdresSube       AS Sube,
      createDate      AS AcilisTarihi,
      Cozum           AS Cozum,
      Durum           AS Durum,
      TeslimBelgeNo   AS TeslimBelge,
      TeslimTarihi    AS TeslimTarihi,
      TeslimKargo     AS TeslimKargo,
      status          AS StatusKod,
      Telephone       AS Telefon,
      Aciklama        AS Aciklama
    FROM BE1_B2BLASTHIZMETSTATUS WITH(NOLOCK)
    ${where}
    ORDER BY createDate DESC
  `;

  const result = await request.query(query);
  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Cari Adından CardCode Çözümle
//
// Kullanıcı CardCode yerine isim verdiğinde (ör: "ABC Teknoloji")
// OCRD'de CardName LIKE araması yapar, ilk eşleşeni döndürür.
//
// currency verilmişse (ör: "USD") yalnızca o para birimiyle kayıtlı cariyi getirir.
// ─────────────────────────────────────────────────────────────
// Döndürür:
//   { found: 'one',  record: { CardCode, CardName, Currency } }  → tek eşleşme
//   { found: 'many', records: [...] }                            → birden fazla
//   { found: 'none' }                                            → bulunamadı
async function resolveCardCode({ cardName, currency, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  // Üç varyant: orijinal + Türkçe büyük (İ) + ASCII büyük (I)
  // Collation farkından bağımsız, mutlaka biri eşleşir
  request.input('Name1', sql.NVarChar(100), `%${cardName}%`);
  request.input('Name2', sql.NVarChar(100), `%${upperTR(cardName)}%`);
  request.input('Name3', sql.NVarChar(100), `%${cardName.toUpperCase()}%`);

  let currencyClause = '';
  if (currency) {
    request.input('Currency', sql.NVarChar(10), currency.toUpperCase());
    currencyClause = 'AND Currency = @Currency';
  }

  const query = `
    SELECT TOP 10 CardCode, CardName, Currency
    FROM OCRD WITH(NOLOCK)
    WHERE (CardName LIKE @Name1 OR CardName LIKE @Name2 OR CardName LIKE @Name3)
      ${currencyClause}
    ORDER BY CardName
  `;

  const result  = await request.query(query);
  const records = result.recordset;

  if (records.length === 0) return { found: 'none' };
  if (records.length === 1) return { found: 'one', record: records[0] };
  return { found: 'many', records };
}

// ─────────────────────────────────────────────────────────────
// Servis Bildirim Polling — Tüm servis çağrılarının anlık durumu
//
// Sadece serviceNotifier.js tarafından kullanılır.
// Durum değişikliği karşılaştırması için tüm kayıtları döndürür.
// ─────────────────────────────────────────────────────────────
async function getServisGuncellemeleri({ dbName } = {}) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  const query = `
    SELECT TOP 500
      srvcCallID  AS CagriNo,
      customer    AS Musteri,
      internalSN  AS SeriNo,
      itemName    AS UrunAdi,
      status      AS StatusKod,
      Durum       AS Durum,
      Telephone   AS Telefon,
      createDate  AS AcilisTarihi
    FROM BE1_B2BLASTHIZMETSTATUS WITH(NOLOCK)
    ORDER BY createDate DESC
  `;

  const result = await request.query(query);
  return result.recordset;
}

module.exports = { getCariEkstre, getVadesiGecenler, getHizmetDurumu, getServisGuncellemeleri, resolveCardCode };
