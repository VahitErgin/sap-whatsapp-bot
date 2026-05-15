'use strict';

/**
 * sapDb.js
 *
 * SAP B1 veritabanına direkt bağlantı (MSSQL veya HANA).
 * Sürücü seçimi: SAP_DB_TYPE=mssql (varsayılan) | hana
 *
 * getCariEkstre → JDT1 satırlarını çeker, waterfall eşleştirme yapar,
 *                 sadece açık kalan kalemleri ve toplam bakiyeyi döndürür.
 */

const { execute } = require('./sapDbDriver');

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

  // Döviz bazlı toplamlar: { 'USD': 500, 'EUR': 200 }
  const toplamFC = {};
  acikKalemler.forEach(d => {
    if (d.KalanFC > 0.01 && d.ParaBirimi && d.ParaBirimi !== 'TRY') {
      toplamFC[d.ParaBirimi] = Math.round(((toplamFC[d.ParaBirimi] || 0) + d.KalanFC) * 100) / 100;
    }
  });

  const bekleyenCekTRY = bekleyenCekler.reduce((s, r) => s + (Number(r.Credit) || 0), 0);
  const bekleyenCekFC  = {};
  bekleyenCekler.forEach(r => {
    const cur = r.FCCurrency;
    if (cur && cur !== 'TRY' && Number(r.FCCredit) > 0) {
      bekleyenCekFC[cur] = Math.round(((bekleyenCekFC[cur] || 0) + Number(r.FCCredit)) * 100) / 100;
    }
  });

  return {
    acikKalemler,
    toplamTRY:         Math.round(toplamTRY * 100) / 100,
    toplamFC,                                             // { 'USD': 500 } | {}
    bekleyenCekTRY:    Math.round(bekleyenCekTRY * 100) / 100,
    bekleyenCekFC,                                        // { 'USD': 100 } | {}
    bekleyenCekSayisi: bekleyenCekler.length,
    toplamKalemSayisi: acikKalemler.length,
  };
}

// ─────────────────────────────────────────────────────────────
// Cari Hesap Ekstresi — JDT1 + OJDT + OCHH + waterfall
// ─────────────────────────────────────────────────────────────
async function getCariEkstre({ cardCode, refDate, dbName }) {
  // TRY → Debit/Credit kullan
  // Dövizli → FCDebit/FCCredit kullan
  // Çek kuralı: TransType=24 + OCHH join → DueDate > RefDate ise BekleyenCek=1
  const rows = await execute(`
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
        (t7.CheckKey IS NULL AND t3.RefDate <= @RefDate)
        OR
        (t7.CheckKey IS NOT NULL AND t0.DueDate <= @RefDate)
        OR
        (t7.CheckKey IS NOT NULL AND t0.DueDate > @RefDate AND t3.RefDate <= @RefDate)
      )
    ORDER BY t0.DueDate, t0.TransId, t0.Line_ID
  `, { CardCode: cardCode, RefDate: refDate }, dbName);

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
  return await execute(`
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
  `, { RefDate: refDate, CardType: cardType || 'C' }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Teknik Servis Hizmet Çağrıları — BE1_B2BLASTHIZMETSTATUS view
//
// Parametreler (hepsi opsiyonel, en az biri verilmeli):
//   cardCode     → müşteri kodu (customer)
//   serialNo     → seri no (internalSN)
//   callId       → servis çağrı no (srvcCallID)
//   statusFilter → 'open' | 'closed' | null (hepsi)
//   top          → kaç kayıt (default 20)
// ─────────────────────────────────────────────────────────────
async function getHizmetDurumu({ cardCode, serialNo, callId, statusFilter, dateFrom, dateTo, top = 20, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = [];

  if (cardCode) {
    params.CardCode = cardCode;
    conditions.push('customer = @CardCode');
  }
  if (serialNo) {
    params.SerialNo = `%${serialNo}%`;
    conditions.push('internalSN LIKE @SerialNo');
  }
  if (callId) {
    params.CallId = parseInt(callId);
    conditions.push('srvcCallID = @CallId');
  }
  if (dateFrom) {
    params.DateFrom = new Date(dateFrom);
    conditions.push('createDate >= @DateFrom');
  }
  if (dateTo) {
    params.DateTo = new Date(dateTo);
    conditions.push('createDate <= @DateTo');
  }
  // OSCS: -3=Açık(İşleniyor), -2=Beklemede, -1=Kapalı
  if (statusFilter === 'closed') {
    conditions.push('status = -1');
  } else {
    conditions.push('status IN (-3, -2)');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return await execute(`
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
    FROM (
      SELECT
        T1.customer,
        T0.srvcCallID,
        T1.internalSN,
        T1.itemName,
        NULL          AS GelenBelge,
        NULL          AS BelgeTarih,
        NULL          AS KargoNo,
        NULL          AS AdresSube,
        T1.createDate,
        T4.Descriptio AS Cozum,
        T3.Subject    AS Durum,
        NULL          AS TeslimBelgeNo,
        NULL          AS TeslimTarihi,
        NULL          AS TeslimKargo,
        T1.status,
        T1.Telephone,
        NULL          AS Aciklama
      FROM SCL1 T0 WITH(NOLOCK)
      INNER JOIN OSCL T1 WITH(NOLOCK) ON T0.srvcCallID = T1.callID
      LEFT JOIN OSLT T3 WITH(NOLOCK) ON T0.solutionID = T3.SltCode
      LEFT JOIN OSST T4 WITH(NOLOCK) ON T3.StatusNum = T4.Number
    ) v
    ${where}
    ORDER BY createDate DESC
  `, params, dbName);
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
  // Üç varyant: orijinal + Türkçe büyük (OKSİD) + ASCII büyük (OKSID)
  const params = {
    Name1: `%${cardName}%`,
    Name2: `%${upperTR(cardName)}%`,
    Name3: `%${cardName.toUpperCase()}%`,
  };

  let currencyClause = '';
  if (currency) {
    params.Currency = currency.toUpperCase();
    currencyClause = 'AND Currency = @Currency';
  }

  const records = await execute(`
    SELECT TOP 10 CardCode, CardName, Currency
    FROM OCRD WITH(NOLOCK)
    WHERE (CardName LIKE @Name1 OR CardName LIKE @Name2 OR CardName LIKE @Name3)
      ${currencyClause}
    ORDER BY CardName
  `, params, dbName);

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
  return await execute(`
    SELECT TOP 500
      callID     AS CagriNo,
      customer   AS Musteri,
      internalSN AS SeriNo,
      itemName   AS UrunAdi,
      status     AS StatusKod,
      CASE status
        WHEN -3 THEN 'Açık'
        WHEN -2 THEN 'Beklemede'
        WHEN -1 THEN 'Kapalı'
        ELSE 'Güncellendi'
      END        AS Durum,
      Telephone  AS Telefon,
      createDate AS AcilisTarihi
    FROM OSCL WITH(NOLOCK)
    ORDER BY createDate DESC
  `, {}, dbName);
}

// ─────────────────────────────────────────────────────────────
// Onay Yetkilileri — WST1 + OUSR (şablon tablosundan)
// ─────────────────────────────────────────────────────────────
async function getOnayYetkilileri({ dbName } = {}) {
  return await execute(`
    SELECT DISTINCT
      u.USERID  AS UserKod,
      u.U_Name  AS Ad,
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        ISNULL(u.PortNum, ''), ' ',''),'-',''),'+',''),'(',''),')','') AS Telefon
    FROM WST1 w WITH(NOLOCK)
    INNER JOIN OUSR u WITH(NOLOCK) ON w.UserID = u.USERID
    WHERE ISNULL(u.PortNum, '') <> ''
  `, {}, dbName);
}

// ─────────────────────────────────────────────────────────────
// Telefon → aktif WDD1 onay yetkisi kontrolü
//
// wddCode verilirse o belge için, verilmezse herhangi bir
// bekleyen onay için kontrol yapar.
// Döndürür: { UserKod, Ad } veya null
// ─────────────────────────────────────────────────────────────
async function getOnaylayanByPhone(phone10, wddCode, dbName) {
  const docFilter = wddCode ? 'AND w.WddCode = @wddCode' : '';
  const rows = await execute(`
    SELECT TOP 1
      u.USERID AS UserKod,
      ISNULL(u.U_Name, u.USERID) AS Ad
    FROM WDD1 w WITH(NOLOCK)
    INNER JOIN OWDD d WITH(NOLOCK) ON d.WddCode = w.WddCode
    INNER JOIN OUSR u WITH(NOLOCK) ON u.USERID  = w.UserID
    WHERE d.Status = 'W'
      AND w.Status = 'W'
      ${docFilter}
      AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ISNULL(u.PortNum,''),' ',''),'-',''),'+',''),'(',''),')',''), 10) = @phone10
  `, { phone10, wddCode: wddCode || null }, dbName);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Onay Bekleyen Belgeler — OWDD + WDD1 + OUSR
//
// SAP B1 onay sürecinde "W" (Waiting) durumundaki tüm belgeleri
// ve atanmış onaylayıcı kullanıcıları döndürür.
// ─────────────────────────────────────────────────────────────
async function getOnayBekleyenler({ dbName } = {}) {
  return await execute(`
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
      AND CAST(d.CreateDate AS DATE) >= CAST(DATEADD(DAY, -30, GETDATE()) AS DATE)
    ORDER BY d.CreateDate DESC
  `, {}, dbName);
}

// ─────────────────────────────────────────────────────────────
// OCPR İlgili Kişiler: Cellolar/Tel1/Tel2 → CardCode bul
//
// SAP'a boşluklu/tireli kaydedilebilir (ör: "90 553 667 69 34").
// REPLACE zinciriyle boşluk, tire, artı, parantez soyularak
// son 10 rakamla LIKE karşılaştırması yapılır.
// ─────────────────────────────────────────────────────────────
async function getCustomerByPhone(phone10, dbName) {
  const rows = await execute(`
    SELECT TOP 1 c.CardCode, c.Name AS ContactName, bp.CardName
    FROM OCPR c WITH(NOLOCK)
    LEFT JOIN OCRD bp WITH(NOLOCK) ON c.CardCode = bp.CardCode
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.Cellolar,
            ' ',''),'-',''),'+',''),'(',''),')','') LIKE @Phone
       OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.Tel1,
            ' ',''),'-',''),'+',''),'(',''),')','') LIKE @Phone
       OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.Tel2,
            ' ',''),'-',''),'+',''),'(',''),')','') LIKE @Phone
  `, { Phone: `%${phone10}` }, dbName);

  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Telefon numarasına göre OUSR kaydını getir
// ─────────────────────────────────────────────────────────────
async function getUserByPhone(phone10, dbName) {
  const rows = await execute(`
    SELECT TOP 1 USER_CODE, U_NAME, PortNum, Language
    FROM OUSR WITH(NOLOCK)
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(PortNum,
            ' ',''),'-',''),'+',''),'(',''),')','') LIKE @Phone
  `, { Phone: `%${phone10}` }, dbName);

  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Ürün kategorisine göre satış tutarları — OINV + INV1 + OITM + OITB
// ─────────────────────────────────────────────────────────────
async function getSatisByKategori({ startDate, endDate, top = 5, dbName }) {
  return await execute(`
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
    WHERE h.DocDate >= ISNULL(@StartDate, DATEADD(YEAR, -1, GETDATE()))
      AND h.DocDate <= ISNULL(@EndDate, GETDATE())
      AND h.CANCELED = 'N'
    GROUP BY g.ItmsGrpNam, s.SlpName
    ORDER BY ToplamSatis DESC
  `, { StartDate: startDate, EndDate: endDate, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Marka bazlı satış tutarları — OINV + INV1 + OITM (U_BE1_MARKAKODU)
// ─────────────────────────────────────────────────────────────
async function getSatisByMarka({ startDate, endDate, top = 5, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      ISNULL(i.U_BE1_MARKAKODU, 'Belirtilmemiş') AS Marka,
      ISNULL(s.SlpName, 'Belirtilmemiş')          AS SatisTemsilcisi,
      SUM(l.LineTotal)                             AS ToplamSatis,
      COUNT(DISTINCT h.DocEntry)                   AS BelgeSayisi
    FROM OINV h WITH(NOLOCK)
    INNER JOIN INV1 l WITH(NOLOCK) ON h.DocEntry = l.DocEntry
    LEFT  JOIN OITM i WITH(NOLOCK) ON l.ItemCode  = i.ItemCode
    LEFT  JOIN OSLP s WITH(NOLOCK) ON h.SlpCode   = s.SlpCode
    WHERE h.DocDate >= ISNULL(@StartDate, DATEADD(YEAR, -1, GETDATE()))
      AND h.DocDate <= ISNULL(@EndDate, GETDATE())
      AND h.CANCELED = 'N'
    GROUP BY i.U_BE1_MARKAKODU, s.SlpName
    ORDER BY ToplamSatis DESC
  `, { StartDate: startDate, EndDate: endDate, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Satış temsilcisi bazlı satış tutarları — OINV + OSLP
// ─────────────────────────────────────────────────────────────
async function getSatisByTemsilci({ startDate, endDate, top = 10, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      ISNULL(s.SlpName, 'Belirtilmemiş') AS SatisTemsilcisi,
      SUM(h.DocTotal)                     AS ToplamSatis,
      COUNT(h.DocEntry)                   AS BelgeSayisi
    FROM OINV h WITH(NOLOCK)
    LEFT JOIN OSLP s WITH(NOLOCK) ON h.SlpCode = s.SlpCode
    WHERE h.DocDate >= ISNULL(@StartDate, DATEADD(YEAR, -1, GETDATE()))
      AND h.DocDate <= ISNULL(@EndDate, GETDATE())
      AND h.CANCELED = 'N'
    GROUP BY s.SlpName
    ORDER BY ToplamSatis DESC
  `, { StartDate: startDate, EndDate: endDate, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Stokta olan ama belirtilen dönemde satışı olmayan ürünler
// startDate/endDate verilmezse tüm zamanlar kontrol edilir
// ─────────────────────────────────────────────────────────────
async function getStokSatissiz({ startDate, endDate, top = 20, dbName }) {
  const params     = { Top: Number(top) };
  let   dateFilter = '';

  if (startDate && endDate) {
    params.StartDate = startDate;
    params.EndDate   = endDate;
    dateFilter = 'AND h.DocDate >= @StartDate AND h.DocDate <= @EndDate';
  }

  return await execute(`
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
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Stokta olan ürünlerin fiyat listesi — OITM + OITW + ITM1
//
// Parametreler:
//   filter     → ItemName / Marka / ItemCode içeren metin (ör: "AMD")
//   priceList  → Fiyat listesi numarası (default 1)
//   top        → Kaç kayıt (default 30)
// ─────────────────────────────────────────────────────────────
async function getStokFiyatListesi({ filter, priceList = 1, top = 30, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      i.ItemCode,
      i.ItemName,
      ISNULL(i.U_BE1_MARKAKODU, '')    AS Marka,
      SUM(ISNULL(w.OnHand, 0))         AS StokMiktar,
      i.SalUnitMsr                     AS Birim,
      ISNULL(p.Price, 0)               AS Fiyat,
      ISNULL(p.Currency, 'TRY')        AS FiyatPB
    FROM OITM i WITH(NOLOCK)
    LEFT JOIN OITW w WITH(NOLOCK) ON i.ItemCode   = w.ItemCode
    LEFT JOIN ITM1 p WITH(NOLOCK) ON i.ItemCode   = p.ItemCode
                                 AND p.PriceList  = @PriceList
    WHERE i.InvntItem = 'Y'
      AND i.Canceled  = 'N'
      AND i.validFor  = 'Y'
      AND (
        i.ItemName          LIKE @Filter
        OR i.ItemCode       LIKE @Filter
        OR ISNULL(i.U_BE1_MARKAKODU, '') LIKE @Filter
      )
    GROUP BY i.ItemCode, i.ItemName, i.U_BE1_MARKAKODU, i.SalUnitMsr, p.Price, p.Currency
    HAVING SUM(ISNULL(w.OnHand, 0)) > 0
    ORDER BY i.ItemName
  `, { Filter: `%${filter || ''}%`, PriceList: Number(priceList) || 1, Top: Number(top) || 30 }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Seri bazlı depo stok listesi — BE1_STOKSERILISTE_ALL view
//
// Parametreler:
//   cardCode  → müşteri kodu (zorunlu)
//   whsCode   → depo kodu, ör: "M1" (zorunlu)
//   top       → kaç kayıt (default 200)
// ─────────────────────────────────────────────────────────────
async function getStokSeriListesi({ cardCode, whsCode, top = 200, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      CardCode,
      CardName,
      ItemCode,
      ItemName,
      DistNumber,
      DocType,
      DocEntry,
      DocLine,
      WhsCode,
      SysNumber
    FROM (
      SELECT
        LEFT(ISNULL(MAX(T0.CardCode),(
          SELECT TOP 1 T0.CardCode FROM OITL T0 WITH(NOLOCK)
          INNER JOIN ITL1 T1 WITH(NOLOCK) ON T0.LogEntry=T1.LogEntry
          INNER JOIN OSRN T2 WITH(NOLOCK) ON T1.ItemCode=T2.ItemCode AND T1.SysNumber=T2.SysNumber
          WHERE T2.ItemCode=T0.ItemCode AND T2.DistNumber=T3.DistNumber AND StockQty<0
          ORDER BY T0.LogEntry DESC
        )),7) AS CardCode,
        MAX(T4.CardName)     AS CardName,
        T0.ItemCode,
        MAX(T0.ItemName)     AS ItemName,
        T3.DistNumber,
        MAX(T0.DocType)      AS DocType,
        MAX(T0.DocEntry)     AS DocEntry,
        MAX(T0.DocLine)      AS DocLine,
        T0.LocCode           AS WhsCode,
        T2.SysNumber
      FROM OITL T0 WITH(NOLOCK)
      INNER JOIN ITL1 T1 WITH(NOLOCK) ON T0.LogEntry=T1.LogEntry
      INNER JOIN OSRQ T2 WITH(NOLOCK) ON T1.ItemCode=T2.ItemCode AND T1.SysNumber=T2.SysNumber AND T0.LocCode=T2.WhsCode
      INNER JOIN OSRN T3  WITH(NOLOCK) ON T2.ItemCode=T3.ItemCode AND T2.SysNumber=T3.SysNumber
      LEFT OUTER JOIN OCRD T4 WITH(NOLOCK) ON LEFT(T0.CardCode,7)=LEFT(T4.CardCode,7)
      WHERE T2.Quantity > 0
      GROUP BY T0.ItemCode, T3.DistNumber, T0.LocCode, T2.SysNumber, T0.CardCode
    ) v
    WHERE CardCode = @CardCode
      AND WhsCode  = @WhsCode
    ORDER BY ItemCode, DistNumber
  `, { CardCode: cardCode, WhsCode: whsCode, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Banka hesabı bakiyeleri — OBNK + JDT1 (kapanış bakiyesi)
//
// refDate → bakiye tarihi (YYYY-MM-DD; verilmezse bugün)
// ─────────────────────────────────────────────────────────────
async function getBankaBakiye({ refDate, dbName }) {
  const params = { RefDate: refDate || new Date().toISOString().split('T')[0] };
  // Banka/kasa hesapları: ORCT ve OVPM'de kullanılan ödeme G/L hesapları
  // (TrsfrAcct = EFT/havale, CashAcct = nakit, CheckAcct = çek)
  return await execute(`
    SELECT
      oa.AcctCode,
      oa.AcctName                                             AS HesapAdi,
      ISNULL(j.FCCurrency, 'TRY')                            AS Para,
      SUM(ISNULL(j.Debit,   0)) - SUM(ISNULL(j.Credit,  0)) AS BakiyeTRY,
      SUM(ISNULL(j.FCDebit, 0)) - SUM(ISNULL(j.FCCredit,0)) AS BakiyeFC
    FROM OACT oa WITH(NOLOCK)
    INNER JOIN JDT1 j  WITH(NOLOCK) ON j.Account  = oa.AcctCode
    INNER JOIN OJDT jh WITH(NOLOCK) ON jh.TransId = j.TransId
    WHERE oa.AcctCode IN (
      SELECT DISTINCT TrsfrAcct FROM ORCT WITH(NOLOCK) WHERE TrsfrAcct IS NOT NULL AND TrsfrAcct <> ''
      UNION
      SELECT DISTINCT CashAcct  FROM ORCT WITH(NOLOCK) WHERE CashAcct  IS NOT NULL AND CashAcct  <> ''
      UNION
      SELECT DISTINCT CheckAcct FROM ORCT WITH(NOLOCK) WHERE CheckAcct IS NOT NULL AND CheckAcct <> ''
      UNION
      SELECT DISTINCT TrsfrAcct FROM OVPM WITH(NOLOCK) WHERE TrsfrAcct IS NOT NULL AND TrsfrAcct <> ''
      UNION
      SELECT DISTINCT CashAcct  FROM OVPM WITH(NOLOCK) WHERE CashAcct  IS NOT NULL AND CashAcct  <> ''
      UNION
      SELECT DISTINCT CheckAcct FROM OVPM WITH(NOLOCK) WHERE CheckAcct IS NOT NULL AND CheckAcct <> ''
    )
    AND jh.RefDate <= @RefDate
    GROUP BY oa.AcctCode, oa.AcctName, j.FCCurrency
    ORDER BY oa.AcctCode, Para
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Tahsilat listesi — ORCT (gelen ödemeler)
//
// cardCode  → müşteri kodu (opsiyonel)
// startDate / endDate → tarih filtresi (opsiyonel)
// top       → kaç kayıt (default 20)
// ─────────────────────────────────────────────────────────────
async function getTahsilatlar({ cardCode, startDate, endDate, top = 20, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = ["h.Canceled = 'N'"];

  if (cardCode)  { params.CardCode  = cardCode;  conditions.push('h.CardCode = @CardCode'); }
  if (startDate) { params.StartDate = startDate; conditions.push('h.DocDate >= @StartDate'); }
  if (endDate)   { params.EndDate   = endDate;   conditions.push('h.DocDate <= @EndDate'); }

  return await execute(`
    SELECT TOP (@Top)
      h.DocNum,
      h.CardCode,
      h.CardName,
      CONVERT(VARCHAR(10), h.DocDate, 23)    AS DocDate,
      ISNULL(h.CashSum,   0)                 AS Nakit,
      ISNULL(h.CheckSum,  0)                 AS Cek,
      ISNULL(h.TrsfrSum,  0)                 AS Transfer,
      ISNULL(h.CreditSum, 0)                 AS KrediKarti,
      ISNULL(h.DocTotal,  0)                 AS Toplam,
      ISNULL(h.DocCurr, 'TRY')              AS DocCur,
      ISNULL(h.Comments, '')                 AS Aciklama
    FROM ORCT h WITH(NOLOCK)
    WHERE ${conditions.join(' AND ')}
    ORDER BY h.DocDate DESC, h.DocNum DESC
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Ürün bazlı satış tutarları — OINV + INV1 + OITM
//
// startDate / endDate verilmezse tüm zamanlar
// cardCode verilirse yalnızca o müşteri
// top: kaç ürün (default 10)
// ─────────────────────────────────────────────────────────────
async function getSatisByUrun({ startDate, endDate, cardCode, top = 10, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = ["h.CANCELED = 'N'"];

  if (startDate) { params.StartDate = startDate; conditions.push('h.DocDate >= @StartDate'); }
  if (endDate)   { params.EndDate   = endDate;   conditions.push('h.DocDate <= @EndDate');   }
  if (cardCode)  { params.CardCode  = cardCode;  conditions.push('h.CardCode = @CardCode');  }

  return await execute(`
    SELECT TOP (@Top)
      l.ItemCode,
      ISNULL(i.ItemName, l.Dscription)         AS UrunAdi,
      ISNULL(i.U_BE1_MARKAKODU, '')            AS Marka,
      ISNULL(g.ItmsGrpNam, '')                 AS Kategori,
      SUM(l.Quantity)                          AS ToplamMiktar,
      ISNULL(l.UomCode, l.unitMsr)             AS Birim,
      SUM(l.LineTotal)                         AS ToplamSatis,
      COUNT(DISTINCT h.DocEntry)               AS FaturaSayisi
    FROM OINV h WITH(NOLOCK)
    INNER JOIN INV1 l WITH(NOLOCK) ON h.DocEntry  = l.DocEntry
    LEFT  JOIN OITM i WITH(NOLOCK) ON l.ItemCode   = i.ItemCode
    LEFT  JOIN OITB g WITH(NOLOCK) ON i.ItmsGrpCod = g.ItmsGrpCod
    WHERE ${conditions.join(' AND ')}
    GROUP BY l.ItemCode, i.ItemName, l.Dscription, i.U_BE1_MARKAKODU, g.ItmsGrpNam, l.UomCode, l.unitMsr
    ORDER BY ToplamSatis DESC
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Açık Satış Siparişleri — ORDR + RDR1 (ürün bazlı)
//
// cardCode  → müşteri kodu (opsiyonel)
// itemCode  → ürün kodu (LIKE ile arar, opsiyonel)
// top       → kaç kayıt (default 50)
// ─────────────────────────────────────────────────────────────
async function getAcikSiparisler({ cardCode, itemCode, docDate, top = 50, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = ["h.DocStatus = 'O'", "h.CANCELED = 'N'", 'l.OpenQty > 0'];

  if (cardCode) {
    params.CardCode = cardCode;
    conditions.push('h.CardCode = @CardCode');
  }
  if (itemCode) {
    params.ItemCode = `%${itemCode}%`;
    conditions.push('l.ItemCode LIKE @ItemCode');
  }
  if (docDate) {
    params.DocDate = docDate;
    conditions.push('CAST(h.DocDate AS DATE) = CAST(@DocDate AS DATE)');
  }

  return await execute(`
    SELECT TOP (@Top)
      h.DocNum,
      h.CardCode,
      h.CardName,
      CONVERT(VARCHAR(10), h.DocDate,    23) AS DocDate,
      CONVERT(VARCHAR(10), h.DocDueDate, 23) AS DocDueDate,
      h.DocTotal,
      ISNULL(h.DocCur, 'TRY')               AS DocCur,
      l.LineNum,
      l.ItemCode,
      l.Dscription                           AS ItemName,
      l.Quantity,
      l.OpenQty,
      ISNULL(l.UnitMsr, '')                  AS Birim,
      l.Price,
      l.LineTotal,
      CONVERT(VARCHAR(10), l.ShipDate, 23)   AS ShipDate
    FROM ORDR h WITH(NOLOCK)
    INNER JOIN RDR1 l WITH(NOLOCK) ON h.DocEntry = l.DocEntry
    WHERE ${conditions.join(' AND ')}
    ORDER BY h.DocDate DESC, h.DocNum, l.LineNum
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// İrsaliye Satır Detayı — ODLN + DLN1 (ürün bazlı)
//
// cardCode  → müşteri kodu (opsiyonel)
// itemCode  → ürün kodu LIKE (opsiyonel)
// docDate   → irsaliye tarihi (YYYY-MM-DD, opsiyonel; verilmezse bugün)
// top       → kaç kayıt (default 50)
// ─────────────────────────────────────────────────────────────
async function getIrsaliyeSatir({ cardCode, itemCode, docDate, top = 50, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = ["h.CANCELED = 'N'"];

  if (cardCode) {
    params.CardCode = cardCode;
    conditions.push('h.CardCode = @CardCode');
  }
  if (itemCode) {
    params.ItemCode = `%${itemCode}%`;
    conditions.push('l.ItemCode LIKE @ItemCode');
  }
  // Tarih belirtilmezse bugünü kullan
  params.DocDate = docDate || new Date().toISOString().split('T')[0];
  conditions.push('CAST(h.DocDate AS DATE) = CAST(@DocDate AS DATE)');

  return await execute(`
    SELECT TOP (@Top)
      h.DocNum,
      h.CardCode,
      h.CardName,
      CONVERT(VARCHAR(10), h.DocDate,    23) AS DocDate,
      CONVERT(VARCHAR(10), h.DocDueDate, 23) AS DocDueDate,
      h.DocTotal,
      ISNULL(h.DocCur, 'TRY')               AS DocCur,
      l.LineNum,
      l.ItemCode,
      l.Dscription                           AS ItemName,
      l.Quantity,
      ISNULL(l.UnitMsr, '')                  AS Birim,
      l.Price,
      l.LineTotal,
      CONVERT(VARCHAR(10), l.ShipDate, 23)   AS ShipDate
    FROM ODLN h WITH(NOLOCK)
    INNER JOIN DLN1 l WITH(NOLOCK) ON h.DocEntry = l.DocEntry
    WHERE ${conditions.join(' AND ')}
    ORDER BY h.DocDate DESC, h.DocNum, l.LineNum
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// GL Hesap Bakiyesi / Dönem Hareketi — OACT + JDT1 + OJDT
//
// acctPrefix → hesap kod öneki, ör: '102', '600', '102.01' (zorunlu)
// startDate  → dönem başlangıcı (verilirse + endDate → ciro/dönem hareketi)
// endDate    → dönem sonu
// refDate    → startDate/endDate yoksa: bu tarihe kadar bakiye (default: bugün)
//
// AcctCode hem 102, hem 102.01.001 formatına uyacak şekilde LIKE prefix.
// ─────────────────────────────────────────────────────────────
async function getGlHesap({ acctPrefix, startDate, endDate, refDate, dbName }) {
  const params = { AcctPrefix: `${acctPrefix}%` };
  let dateCondition = '';

  if (startDate && endDate) {
    params.StartDate = startDate;
    params.EndDate   = endDate;
    dateCondition    = 'AND jh.RefDate >= @StartDate AND jh.RefDate <= @EndDate';
  } else {
    params.RefDate = refDate || new Date().toISOString().split('T')[0];
    dateCondition  = 'AND jh.RefDate <= @RefDate';
  }

  return await execute(`
    SELECT
      oa.AcctCode,
      ISNULL(oa.FormatCode, oa.AcctCode)                       AS FormatCode,
      oa.AcctName                                              AS HesapAdi,
      ISNULL(j.FCCurrency, 'TRY')                              AS Para,
      SUM(ISNULL(j.Debit,    0))                               AS ToplamBorc,
      SUM(ISNULL(j.Credit,   0))                               AS ToplamAlacak,
      SUM(ISNULL(j.Debit,    0)) - SUM(ISNULL(j.Credit,    0)) AS Bakiye,
      SUM(ISNULL(j.FCDebit,  0))                               AS ToplamBorcFC,
      SUM(ISNULL(j.FCCredit, 0))                               AS ToplamAlacakFC,
      SUM(ISNULL(j.FCDebit,  0)) - SUM(ISNULL(j.FCCredit,  0)) AS BakiyeFC,
      COUNT(*)                                                 AS HareketSayisi
    FROM OACT oa WITH(NOLOCK)
    INNER JOIN JDT1 j  WITH(NOLOCK) ON j.Account  = oa.AcctCode
    INNER JOIN OJDT jh WITH(NOLOCK) ON jh.TransId = j.TransId
    WHERE (oa.AcctCode LIKE @AcctPrefix OR ISNULL(oa.FormatCode, '') LIKE @AcctPrefix)
      ${dateCondition}
    GROUP BY oa.AcctCode, oa.FormatCode, oa.AcctName, j.FCCurrency
    HAVING ABS(SUM(ISNULL(j.Debit,   0)) - SUM(ISNULL(j.Credit,   0))) > 0.01
        OR ABS(SUM(ISNULL(j.FCDebit, 0)) - SUM(ISNULL(j.FCCredit, 0))) > 0.01
    ORDER BY oa.AcctCode, Para
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Fatura Satır Detayı — OINV + INV1 (ürün/satır bazlı)
//
// docNum    → fatura numarası (opsiyonel — "72197 nolu fatura")
// cardCode  → müşteri kodu (opsiyonel)
// itemCode  → ürün kodu LIKE (opsiyonel)
// docDate   → fatura tarihi (opsiyonel)
// top       → kaç kayıt (default 50)
// ─────────────────────────────────────────────────────────────
async function getFaturaSatir({ docNum, cardCode, itemCode, docDate, top = 50, dbName }) {
  const params     = { Top: Number(top) };
  const conditions = ["h.CANCELED = 'N'"];

  if (docNum) {
    params.DocNum = parseInt(docNum);
    conditions.push('h.DocNum = @DocNum');
  }
  if (cardCode) {
    params.CardCode = cardCode;
    conditions.push('h.CardCode = @CardCode');
  }
  if (itemCode) {
    params.ItemCode = `%${itemCode}%`;
    conditions.push('l.ItemCode LIKE @ItemCode');
  }
  if (docDate) {
    params.DocDate = docDate;
    conditions.push('CAST(h.DocDate AS DATE) = CAST(@DocDate AS DATE)');
  }

  return await execute(`
    SELECT TOP (@Top)
      h.DocNum,
      h.CardCode,
      h.CardName,
      CONVERT(VARCHAR(10), h.DocDate,    23) AS DocDate,
      CONVERT(VARCHAR(10), h.DocDueDate, 23) AS DocDueDate,
      h.DocTotal,
      ISNULL(h.DocTotalFC, 0)                AS DocTotalFC,
      ISNULL(h.DocCur, 'TRY')                AS DocCur,
      l.LineNum,
      l.ItemCode,
      l.Dscription                           AS ItemName,
      l.Quantity,
      ISNULL(l.UnitMsr, '')                  AS Birim,
      l.Price,
      l.LineTotal,
      ISNULL(l.TotalFrgn, 0)                 AS LineTotalFC,
      CONVERT(VARCHAR(10), l.ShipDate, 23)   AS ShipDate
    FROM OINV h WITH(NOLOCK)
    INNER JOIN INV1 l WITH(NOLOCK) ON h.DocEntry = l.DocEntry
    WHERE ${conditions.join(' AND ')}
    ORDER BY h.DocDate DESC, h.DocNum, l.LineNum
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Belirtilen tablodaki en son belge tarihini döndürür
// tableName: OINV, ODLN, ORDR, OPOR, OPCH, ORIN, OITW …
// Sonuç boş sorgularda "son kayıt: X tarihinde kesildi" bilgisi için kullanılır
// ─────────────────────────────────────────────────────────────
async function getLastDocDate({ tableName, cardCode, dbName } = {}) {
  const where = cardCode ? "WHERE h.CardCode = @cardCode" : '';
  const rows  = await execute(
    `SELECT TOP 1 CONVERT(VARCHAR(10), h.DocDate, 23) AS LastDate
     FROM ${tableName} h WITH(NOLOCK)
     ${where}
     ORDER BY h.DocDate DESC`,
    { cardCode: cardCode || null },
    dbName
  );
  return rows[0]?.LastDate || null;
}

// ─────────────────────────────────────────────────────────────
// Ham SQL sorgusu çalıştır (sadece SELECT — admin zamanlanmış görevler için)
// ─────────────────────────────────────────────────────────────
async function runRawQuery(queryText, dbName) {
  const upper = queryText.trim().toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    throw new Error('Güvenlik: Yalnızca SELECT ve WITH sorguları çalıştırılabilir.');
  }
  return await execute(queryText, {}, dbName);
}

// ─────────────────────────────────────────────────────────────
// OHEM: Çalışan ana verisinden telefon ile arama
// Mobile veya Tel1 alanının son 10 hanesiyle eşleştirir
// ─────────────────────────────────────────────────────────────
async function getEmployeeByPhone(phone10, dbName) {
  const rows = await execute(`
    SELECT TOP 1
      e.empID                                                AS EmpId,
      LTRIM(RTRIM(ISNULL(e.firstName,''))) + ' ' +
      LTRIM(RTRIM(ISNULL(e.lastName,'')))                    AS FullName,
      ISNULL(e.userId, '')                                   AS UserCode
    FROM OHEM e WITH(NOLOCK)
    WHERE e.Active = 'Y'
      AND (
        RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(e.mobil,''),' ',''),'-',''),'+',''),'(',''), 10) = @phone10
        OR
        RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(e.phone1,''),' ',''),'-',''),'+',''),'(',''), 10) = @phone10
      )
  `, { phone10 }, dbName);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// OHEM: Tüm aktif çalışanları listele (admin panel için)
// ─────────────────────────────────────────────────────────────
async function getAllOhemEmployees({ dbName } = {}) {
  return await execute(`
    SELECT
      e.empID                                  AS EmpId,
      ISNULL(e.Code,  '')                      AS Code,
      ISNULL(e.firstName,  '')                 AS FirstName,
      ISNULL(e.middleName, '')                 AS MiddleName,
      ISNULL(e.lastName,   '')                 AS LastName,
      ISNULL(e.jobTitle,   '')                 AS JobTitle,
      RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        ISNULL(e.mobile,''),' ',''),'-',''),'+',''),'(',''),')',''), 10) AS Mobile,
      ISNULL(e.userId, '')                     AS UserCode
    FROM OHEM e WITH(NOLOCK)
    WHERE e.Active = 'Y'
    ORDER BY e.lastName, e.firstName
  `, {}, dbName);
}

// ─────────────────────────────────────────────────────────────
// Cari arama — salesDocWizard için (CardType filtreli)
// cardType: 'C' = müşteri, 'S' = tedarikçi
// ─────────────────────────────────────────────────────────────
async function searchPartners({ query, cardType = 'C', top = 10, dbName }) {
  const params = {
    Name1: `%${query}%`,
    Name2: `%${upperTR(query)}%`,
    Name3: `%${query.toUpperCase()}%`,
    CardType: cardType,
    Top: Number(top),
  };
  const records = await execute(`
    SELECT TOP (@Top)
      CardCode,
      ISNULL(CardName, '') AS CardName,
      ISNULL(Currency, '') AS Currency
    FROM OCRD WITH(NOLOCK)
    WHERE (CardCode LIKE @Name1 OR CardName LIKE @Name1 OR CardName LIKE @Name2 OR CardName LIKE @Name3)
      AND CardType  = @CardType
      AND frozenFor = 'N'
    ORDER BY CardName
  `, params, dbName);
  if (records.length === 0) return { found: 'none' };
  if (records.length === 1) return { found: 'one', record: records[0] };
  return { found: 'many', records };
}

// ─────────────────────────────────────────────────────────────
// Ürün arama — kod veya ad LIKE (seri/parti bilgisiyle)
// itemType: 'sales' (SellItem) | 'purchase' (PrchseItem)
// ─────────────────────────────────────────────────────────────
async function searchItems({ query, itemType = 'sales', top = 10, dbName }) {
  const typeFilter = itemType === 'purchase' ? "AND i.PrchseItem = 'Y'" : "AND i.SellItem = 'Y'";
  const params = {
    Q1: `%${query}%`,
    Q2: `%${upperTR(query)}%`,
    Top: Number(top),
  };
  // Stok filtresi: envanter kalemi değilse (hizmet) stok şartı aranmaz;
  // envanter kalemiyse en az bir depoda OnHand > 0 olmalı.
  return await execute(`
    SELECT TOP (@Top)
      i.ItemCode,
      ISNULL(i.ItemName,    '') AS ItemName,
      ISNULL(i.ManSerNum,   'N') AS ManSerNum,
      ISNULL(i.ManBtchNum,  'N') AS ManBatchNum,
      ISNULL(i.InvntryUom,  'Adet') AS InvntryUom
    FROM OITM i WITH(NOLOCK)
    WHERE (i.ItemCode LIKE @Q1 OR i.ItemName LIKE @Q1 OR i.ItemName LIKE @Q2)
      ${typeFilter}
      AND i.Canceled = 'N'
      AND i.validFor = 'Y'
      AND (
        i.InvntItem = 'N'
        OR EXISTS (
          SELECT 1 FROM OITW w WITH(NOLOCK)
          WHERE w.ItemCode = i.ItemCode AND w.OnHand > 0
        )
      )
    ORDER BY i.ItemCode
  `, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// Cari bilgisi — fiyat listesi ve para birimi (OCRD)
// ─────────────────────────────────────────────────────────────
async function getPartnerInfo({ cardCode, dbName }) {
  const rows = await execute(`
    SELECT TOP 1
      CardCode,
      ISNULL(CardName, '') AS CardName,
      ISNULL(ListNum,  1)  AS ListNum,
      ISNULL(Currency, '') AS Currency
    FROM OCRD WITH(NOLOCK)
    WHERE CardCode = @CardCode
  `, { CardCode: cardCode }, dbName);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Fiyat listesinden ürün fiyatı — ITM1
// ─────────────────────────────────────────────────────────────
async function getItemPrice({ itemCode, priceList = 1, dbName }) {
  const rows = await execute(`
    SELECT TOP 1
      ISNULL(Price,    0)   AS Price,
      ISNULL(Currency, '')  AS Currency
    FROM ITM1 WITH(NOLOCK)
    WHERE ItemCode  = @ItemCode
      AND PriceList = @PriceList
  `, { ItemCode: itemCode, PriceList: Number(priceList) }, dbName);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Mevcut seri numaraları — OSRN (Status=0 → depoda)
// ─────────────────────────────────────────────────────────────
async function getAvailableSerials({ itemCode, top = 10, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      SysNumber,
      ISNULL(DistNumber, '') AS DistNumber
    FROM OSRN WITH(NOLOCK)
    WHERE ItemCode = @ItemCode
      AND Status   = 0
    ORDER BY SysNumber DESC
  `, { ItemCode: itemCode, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// Mevcut parti numaraları — OBTN (Status=0 → depoda)
// ─────────────────────────────────────────────────────────────
async function getAvailableBatches({ itemCode, top = 10, dbName }) {
  return await execute(`
    SELECT TOP (@Top)
      ISNULL(DistNumber, '') AS DistNumber,
      ISNULL(Quantity,   0)  AS Quantity,
      CONVERT(VARCHAR(10), ExpDate, 23) AS ExpDate
    FROM OBTN WITH(NOLOCK)
    WHERE ItemCode = @ItemCode
      AND Status   = 0
      AND ISNULL(Quantity, 0) > 0
    ORDER BY ExpDate ASC, DistNumber
  `, { ItemCode: itemCode, Top: Number(top) }, dbName);
}

// ─────────────────────────────────────────────────────────────
// OCLA Aktivite Durumları — activityUpdater için
// ─────────────────────────────────────────────────────────────
async function getOclaStatuses({ dbName } = {}) {
  const rows = await execute(`SELECT * FROM OCLA WITH(NOLOCK)`, {}, dbName);
  if (!rows.length) return [];
  const sample = rows[0];
  const keys   = Object.keys(sample);
  // Kolon adları SAP versiyonuna göre değişir — otomatik tespit
  const codeKey = keys.find(k => Number.isInteger(sample[k])) || keys[0];
  const nameKey = keys.find(k => typeof sample[k] === 'string' && k !== codeKey) || keys[1];
  return rows.map(r => ({ Code: r[codeKey], Name: r[nameKey] }));
}

module.exports = { getCariEkstre, getVadesiGecenler, getTahsilatlar, getBankaBakiye, getGlHesap, getHizmetDurumu, getServisGuncellemeleri, resolveCardCode, getOnayBekleyenler, getOnayYetkilileri, getOnaylayanByPhone, getUserByPhone, getCustomerByPhone, getEmployeeByPhone, getAllOhemEmployees, getSatisByKategori, getSatisByMarka, getSatisByTemsilci, getSatisByUrun, getStokSatissiz, getStokFiyatListesi, getStokSeriListesi, getAcikSiparisler, getIrsaliyeSatir, getFaturaSatir, getLastDocDate, runRawQuery, searchPartners, searchItems, getPartnerInfo, getItemPrice, getAvailableSerials, getAvailableBatches, getOclaStatuses };
