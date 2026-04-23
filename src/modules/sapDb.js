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
async function getHizmetDurumu({ cardCode, serialNo, callId, statusFilter, dateFrom, dateTo, top = 20, dbName }) {
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
  if (dateFrom) {
    request.input('DateFrom', sql.Date, new Date(dateFrom));
    conditions.push('createDate >= @DateFrom');
  }
  if (dateTo) {
    request.input('DateTo', sql.Date, new Date(dateTo));
    conditions.push('createDate <= @DateTo');
  }
  // OSCS: -3=Açık(İşleniyor), -2=Beklemede, -1=Kapalı
  if (statusFilter === 'closed') {
    conditions.push("status = -1");
  } else {
    // open veya filtre yok → kapalıları getirme
    conditions.push("status IN (-3, -2)");
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
// "OKSID" → "OKSİD": önce lowercase yapıp i→İ dönüşümü sağlıklı çalışır
function upperTR(s) {
  return String(s)
    .toLowerCase()
    .replace(/i/g, 'İ')
    .replace(/ı/g, 'I')
    .toUpperCase();
}

async function resolveCardCode({ cardName, currency, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  // Üç varyant: orijinal + Türkçe büyük (OKSİD) + ASCII büyük (OKSID)
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

// ─────────────────────────────────────────────────────────────
// Onay Bekleyen Belgeler — OWDD + WDD1 + OUSR
//
// SAP B1 onay sürecinde "W" (Waiting) durumundaki tüm belgeleri
// ve atanmış onaylayıcı kullanıcıları döndürür.
// ─────────────────────────────────────────────────────────────
async function getOnayBekleyenler({ dbName } = {}) {
  const pool    = await getPool(dbName);
  const request = pool.request();

  const query = `
    SELECT
      d.WddCode,
      ISNULL(dr.DocNum, d.WddCode)                     AS DocNum,
      d.ObjType,
      CAST(ISNULL(dr.DocTotal, 0) AS DECIMAL(18,2))   AS DocTotal,
      ISNULL(dr.DocCur, 'TRY')                         AS ParaBirimi,
      ISNULL(dr.CardCode, '')                          AS CardCode,
      ISNULL(dr.CardName, '')                          AS CardName,
      CONVERT(VARCHAR(10), d.CreateDate, 23)           AS TalepTarihi,
      ISNULL(d.Remarks, '')                            AS Aciklama,
      w.UserID                                         AS OnaylayanKod,
      w.StepCode                                       AS Stage,
      ISNULL(u.U_Name, w.UserID)                       AS OnaylayanAd,
      ISNULL(u.PortNum, '')                            AS OnaylayanTelefon,
      CASE d.ObjType
        WHEN '23'          THEN 'Satış Teklifi'
        WHEN '17'          THEN 'Satış Siparişi'
        WHEN '15'          THEN 'Teslimat'
        WHEN '234000031'   THEN 'İade Talebi'
        WHEN '16'          THEN 'İade'
        WHEN '203'         THEN 'Müşteri Avans Ödemesi'
        WHEN '13'          THEN 'Satış Faturası'
        WHEN '165'         THEN 'Satış Düzeltme Faturası'
        WHEN '166'         THEN 'Satış Düzeltme Faturası İptali'
        WHEN '14'          THEN 'Satış Alacak Dekontu'
        WHEN '132'         THEN 'Düzeltme Faturası'
        WHEN '1470000113'  THEN 'Satın Alma Talebi'
        WHEN '540000006'   THEN 'Satın Alma Teklifi'
        WHEN '22'          THEN 'Satın Alma Siparişi'
        WHEN '20'          THEN 'Mal Kabul'
        WHEN '234000032'   THEN 'Mal İade Talebi'
        WHEN '21'          THEN 'Mal İadesi'
        WHEN '204'         THEN 'Tedarikçi Avans Ödemesi'
        WHEN '18'          THEN 'Alış Faturası'
        WHEN '163'         THEN 'Alış Düzeltme Faturası'
        WHEN '164'         THEN 'Alış Düzeltme Faturası İptali'
        WHEN '19'          THEN 'Alış Alacak Dekontu'
        WHEN '59'          THEN 'Mal Girişi'
        WHEN '60'          THEN 'Mal Çıkışı'
        WHEN '1250000001'  THEN 'Stok Transfer Talebi'
        WHEN '67'          THEN 'Stok Transferi'
        WHEN '310000001'   THEN 'Stok Açılış Bakiyesi'
        WHEN '46'          THEN 'Giden Ödeme'
        WHEN '1250000026'  THEN 'Satış Çerçeve Sözleşmesi'
        WHEN '1250000027'  THEN 'Satın Alma Çerçeve Sözleşmesi'
        WHEN '1470000065'  THEN 'Stok Sayımı'
        WHEN '10000071'    THEN 'Stok Deftere Nakli'
        WHEN '112'         THEN 'Taslak Belge'
        WHEN '140'         THEN 'Ödeme Taslağı'
        WHEN '1470000109'  THEN 'Stok Sayımı Taslağı'
        WHEN '1470000136'  THEN 'Stok Nakil Taslağı'
        WHEN '1470000131'  THEN 'Stok Açılış Taslağı'
        ELSE 'Belge (' + d.ObjType + ')'
      END AS BelgeTipi
    FROM OWDD d WITH(NOLOCK)
    INNER JOIN WDD1 w WITH(NOLOCK) ON d.WddCode = w.WddCode
    LEFT  JOIN OUSR u WITH(NOLOCK) ON w.UserID   = u.USERID
    LEFT  JOIN ODRF dr WITH(NOLOCK) ON d.DraftEntry = dr.DocEntry
    WHERE d.Status = 'W'
      AND w.Status = 'W'
      AND u.PortNum IS NOT NULL
      AND u.PortNum <> ''
      AND CAST(d.CreateDate AS DATE) >= CAST(GETDATE() AS DATE)
    ORDER BY d.CreateDate DESC
  `;

  const result = await request.query(query);
  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// OCPR İlgili Kişiler: Cellolar/Tel1/Tel2 → CardCode bul
// ─────────────────────────────────────────────────────────────
async function getCustomerByPhone(phone10, dbName) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('Phone', sql.NVarChar(20), `%${phone10}`);

  const result = await request.query(`
    SELECT TOP 1 c.CardCode, c.Name AS ContactName, bp.CardName
    FROM OCPR c WITH(NOLOCK)
    LEFT JOIN OCRD bp WITH(NOLOCK) ON c.CardCode = bp.CardCode
    WHERE c.Cellolar LIKE @Phone
       OR c.Tel1     LIKE @Phone
       OR c.Tel2     LIKE @Phone
  `);

  return result.recordset[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Telefon numarasına göre OUSR kaydını getir
// ─────────────────────────────────────────────────────────────
async function getUserByPhone(phone10, dbName) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('Phone', sql.NVarChar(20), `%${phone10}`);

  const result = await request.query(`
    SELECT TOP 1 USER_CODE, U_NAME, PortNum, Language
    FROM OUSR WITH(NOLOCK)
    WHERE PortNum LIKE @Phone
  `);

  return result.recordset[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Ürün kategorisine göre satış tutarları — OINV + INV1 + OITM + OITB
// ─────────────────────────────────────────────────────────────
async function getSatisByKategori({ startDate, endDate, top = 5, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('StartDate', sql.Date, startDate);
  request.input('EndDate',   sql.Date, endDate);
  request.input('Top',       sql.Int,  Number(top));

  const result = await request.query(`
    SELECT TOP (@Top)
      ISNULL(g.ItmsGrpNam, 'Diğer')        AS Kategori,
      ISNULL(s.SlpName, 'Belirtilmemiş')    AS SatisTemsilcisi,
      SUM(l.LineTotal)                       AS ToplamSatis,
      COUNT(DISTINCT h.DocEntry)             AS BelgeSayisi
    FROM OINV h WITH(NOLOCK)
    INNER JOIN INV1 l WITH(NOLOCK) ON h.DocEntry  = l.DocEntry
    LEFT  JOIN OITM i WITH(NOLOCK) ON l.ItemCode   = i.ItemCode
    LEFT  JOIN OITB g WITH(NOLOCK) ON i.ItmsGrpCod = g.ItmsGrpCod
    LEFT  JOIN OSLP s WITH(NOLOCK) ON h.SlpCode    = s.SlpCode
    WHERE h.DocDate >= @StartDate
      AND h.DocDate <= @EndDate
      AND h.CANCELED = 'N'
    GROUP BY g.ItmsGrpNam, s.SlpName
    ORDER BY ToplamSatis DESC
  `);

  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Marka bazlı satış tutarları — OINV + INV1 + OITM (U_BE1_MARKAKODU)
// ─────────────────────────────────────────────────────────────
async function getSatisByMarka({ startDate, endDate, top = 5, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('StartDate', sql.Date, startDate);
  request.input('EndDate',   sql.Date, endDate);
  request.input('Top',       sql.Int,  Number(top));

  const result = await request.query(`
    SELECT TOP (@Top)
      ISNULL(i.U_BE1_MARKAKODU, 'Belirtilmemiş') AS Marka,
      ISNULL(s.SlpName, 'Belirtilmemiş')          AS SatisTemsilcisi,
      SUM(l.LineTotal)                             AS ToplamSatis,
      COUNT(DISTINCT h.DocEntry)                   AS BelgeSayisi
    FROM OINV h WITH(NOLOCK)
    INNER JOIN INV1 l WITH(NOLOCK) ON h.DocEntry = l.DocEntry
    LEFT  JOIN OITM i WITH(NOLOCK) ON l.ItemCode  = i.ItemCode
    LEFT  JOIN OSLP s WITH(NOLOCK) ON h.SlpCode   = s.SlpCode
    WHERE h.DocDate >= @StartDate
      AND h.DocDate <= @EndDate
      AND h.CANCELED = 'N'
    GROUP BY i.U_BE1_MARKAKODU, s.SlpName
    ORDER BY ToplamSatis DESC
  `);

  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Satış temsilcisi bazlı satış tutarları — OINV + OSLP
// ─────────────────────────────────────────────────────────────
async function getSatisByTemsilci({ startDate, endDate, top = 10, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('StartDate', sql.Date, startDate);
  request.input('EndDate',   sql.Date, endDate);
  request.input('Top',       sql.Int,  Number(top));

  const result = await request.query(`
    SELECT TOP (@Top)
      ISNULL(s.SlpName, 'Belirtilmemiş') AS SatisTemsilcisi,
      SUM(h.DocTotal)                     AS ToplamSatis,
      COUNT(h.DocEntry)                   AS BelgeSayisi
    FROM OINV h WITH(NOLOCK)
    LEFT JOIN OSLP s WITH(NOLOCK) ON h.SlpCode = s.SlpCode
    WHERE h.DocDate >= @StartDate
      AND h.DocDate <= @EndDate
      AND h.CANCELED = 'N'
    GROUP BY s.SlpName
    ORDER BY ToplamSatis DESC
  `);

  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Stokta olan ama belirtilen dönemde satışı olmayan ürünler
// startDate/endDate verilmezse tüm zamanlar kontrol edilir
// ─────────────────────────────────────────────────────────────
async function getStokSatissiz({ startDate, endDate, top = 20, dbName }) {
  const pool    = await getPool(dbName);
  const request = pool.request();
  request.input('Top', sql.Int, Number(top));

  let dateFilter = '';
  if (startDate && endDate) {
    request.input('StartDate', sql.Date, startDate);
    request.input('EndDate',   sql.Date, endDate);
    dateFilter = 'AND h.DocDate >= @StartDate AND h.DocDate <= @EndDate';
  }

  const result = await request.query(`
    SELECT TOP (@Top)
      i.ItemCode,
      i.ItemName                             AS UrunAdi,
      ISNULL(g.ItmsGrpNam, 'Diğer')         AS Kategori,
      ISNULL(i.U_BE1_MARKAKODU, '')          AS Marka,
      SUM(ISNULL(w.OnHand, 0))               AS StokMiktari,
      i.SalUnitMsr                           AS Birim
    FROM OITM i WITH(NOLOCK)
    LEFT JOIN OITW w WITH(NOLOCK) ON i.ItemCode    = w.ItemCode
    LEFT JOIN OITB g WITH(NOLOCK) ON i.ItmsGrpCod  = g.ItmsGrpCod
    WHERE i.InvntItem = 'Y'
      AND i.Canceled  = 'N'
      AND i.validFor  = 'Y'
      AND NOT EXISTS (
        SELECT 1
        FROM INV1 l WITH(NOLOCK)
        INNER JOIN OINV h WITH(NOLOCK) ON l.DocEntry = h.DocEntry
        WHERE l.ItemCode  = i.ItemCode
          AND h.CANCELED  = 'N'
          ${dateFilter}
      )
    GROUP BY i.ItemCode, i.ItemName, g.ItmsGrpNam, i.U_BE1_MARKAKODU, i.SalUnitMsr
    HAVING SUM(ISNULL(w.OnHand, 0)) > 0
    ORDER BY StokMiktari DESC
  `);

  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// Ham SQL sorgusu çalıştır (sadece SELECT — admin zamanlanmış görevler için)
// ─────────────────────────────────────────────────────────────
async function runRawQuery(queryText, dbName) {
  const upper = queryText.trim().toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    throw new Error('Güvenlik: Yalnızca SELECT ve WITH sorguları çalıştırılabilir.');
  }
  const pool    = await getPool(dbName);
  const request = pool.request();
  const result  = await request.query(queryText);
  return result.recordset;
}

module.exports = { getCariEkstre, getVadesiGecenler, getHizmetDurumu, getServisGuncellemeleri, resolveCardCode, getOnayBekleyenler, getUserByPhone, getCustomerByPhone, getSatisByKategori, getSatisByMarka, getSatisByTemsilci, getStokSatissiz, runRawQuery };
