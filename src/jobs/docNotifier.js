'use strict';

/**
 * docNotifier.js
 *
 * Her 3 dakikada OINV (fatura) ve ODLN (irsaliye) tablolarını poll eder.
 * Yeni belge varsa OCRD.Cellular alanından telefonu alır,
 * Meta onaylı template ile WhatsApp bildirimi gönderir.
 *
 * Profile enum (SAP B1):
 *   1=TEMELFATURA  2=TICARIFATURA  3=IHRACAT  4=YOLCUBERABERFATURA
 *   5=EARSIVFATURA  6=TEMELIRSALIYE  7=ILAC_TIBBICIHAZ
 *   → 5 ise earsiv, diğerleri efatura; ODLN her zaman irsaliye
 *
 * State: data/doc-notifier-state.json
 */

const fs   = require('fs');
const path = require('path');

const { execute }       = require('../modules/sapDbDriver');
const { sendTemplate }  = require('../services/whatsappService');
const { buildEdocUrl }  = require('../services/edocumentService');
const config            = require('../config/config');

const STATE_FILE    = path.join(__dirname, '../../data/doc-notifier-state.json');
const DATA_DIR      = path.join(__dirname, '../../data');
const POLL_INTERVAL = 3 * 60 * 1000; // 3 dakika

// ─── SAP B1 Profile Enum ─────────────────────────────────────
const PROFILE = {
  1: 'TEMELFATURA',
  2: 'TICARIFATURA',
  3: 'IHRACAT',
  4: 'YOLCUBERABERFATURA',
  5: 'EARSIVFATURA',
  6: 'TEMELIRSALIYE',
  7: 'ILAC_TIBBICIHAZ',
};

function invoiceDocType(profileCode) {
  return (PROFILE[Number(profileCode)] === 'EARSIVFATURA') ? 'earsiv' : 'efatura';
}

// ─── State ───────────────────────────────────────────────────
const DEFAULT_STATE = {
  enabled:           false,
  excludedPhones:    [],
  templates: {
    efatura:   '',
    earsiv:    '',
    irsaliye:  '',
  },
  lastInvoiceEntry:  0,
  lastDeliveryEntry: 0,
  lastRun:           null,
};

function loadState() {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (err) { console.error('[DocNotifier] State kayıt hatası:', err.message); }
}

// ─── Telefon Normalize ────────────────────────────────────────
// "0532 123 45 67" | "5321234567" | "+905321234567" → "905321234567"
function formatPhone(raw) {
  if (!raw) return null;
  let num = String(raw).replace(/[\s\-\(\)\+\.]/g, '');
  if (num.startsWith('0')) num = '90' + num.slice(1);
  if (num.length === 10 && num.startsWith('5')) num = '90' + num;
  return /^\d{10,15}$/.test(num) ? num : null;
}

// ─── Tek Belge Bildirimi ──────────────────────────────────────
async function notify(doc, docType, state, dbName) {
  // Müşteri cep telefonu — OCRD.Cellular
  const phonRows = await execute(
    `SELECT ISNULL(Cellular, '') AS Cellular FROM OCRD WITH(NOLOCK) WHERE CardCode = @CardCode`,
    { CardCode: doc.CardCode },
    dbName
  );
  const phone = formatPhone(phonRows[0]?.Cellular);

  if (!phone) {
    console.log(`[DocNotifier] Cellular yok → ${doc.CardCode} | ${doc.DocNum}`);
    return;
  }

  // Hariç tutulacak numaralar kontrolü
  const excluded = (state.excludedPhones || []).map(formatPhone).filter(Boolean);
  if (excluded.includes(phone)) {
    console.log(`[DocNotifier] Hariç tutuldu → ${phone} | ${doc.DocNum}`);
    return;
  }

  // Template adı
  const templateName = state.templates?.[docType];
  if (!templateName) {
    console.log(`[DocNotifier] Template tanımlı değil: ${docType}`);
    return;
  }

  // Görüntüleme URL — U_BE1_UUID, edoc-config.json'daki pattern kullanılır
  const url = buildEdocUrl(docType, doc.UUID) || '';

  // Para formatı
  const total = `${Number(doc.DocTotal || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${doc.DocCur || 'TRY'}`;

  // Template parametreleri:
  // {{1}} = Müşteri adı, {{2}} = Belge no, {{3}} = Tutar, {{4}} = Görüntüleme linki
  const components = [
    { type: 'text', text: doc.CardName || doc.CardCode },
    { type: 'text', text: String(doc.DocNum) },
    { type: 'text', text: total },
    { type: 'text', text: url || '-' },
  ];

  try {
    await sendTemplate(phone, templateName, 'tr', components);
    console.log(`[DocNotifier] ✓ ${docType.toUpperCase()} → ${phone} | Belge: ${doc.DocNum}`);
  } catch (err) {
    console.error(`[DocNotifier] ✗ ${phone} | ${doc.DocNum}:`, err.message);
  }
}

// ─── Ana Tick ─────────────────────────────────────────────────
async function tick() {
  const state  = loadState();
  if (!state.enabled) return;

  const today  = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let   dirty  = false;

  // Gece yarısı geçilmişse sayaçları sıfırla — sadece o günün belgeleri işlensin
  if (state.lastRunDate !== today) {
    state.lastInvoiceEntry  = 0;
    state.lastDeliveryEntry = 0;
    state.lastRunDate       = today;
    dirty = true;
  }

  const dbName = config.sapDb.database;

  // OINV: bugünkü yeni faturalar
  try {
    const invoices = await execute(`
      SELECT DocEntry, DocNum, CardCode, CardName, DocDate, DocTotal, DocCur,
             ISNULL(U_BE1_UUID, '') AS UUID,
             ISNULL(Profile, 0)     AS Profile
      FROM OINV WITH(NOLOCK)
      WHERE DocEntry > @LastEntry
        AND CANCELED = 'N'
        AND CAST(DocDate AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY DocEntry ASC
    `, { LastEntry: state.lastInvoiceEntry || 0 }, dbName);

    for (const doc of invoices) {
      const docType = invoiceDocType(doc.Profile);
      await notify(doc, docType, state, dbName);
      if (doc.DocEntry > (state.lastInvoiceEntry || 0)) {
        state.lastInvoiceEntry = doc.DocEntry;
        dirty = true;
      }
    }
    if (invoices.length) console.log(`[DocNotifier] OINV işlendi: ${invoices.length} belge`);
  } catch (err) {
    console.error('[DocNotifier] OINV poll hatası:', err.message);
  }

  // ODLN: bugünkü yeni irsaliyeler
  try {
    const deliveries = await execute(`
      SELECT DocEntry, DocNum, CardCode, CardName, DocDate, DocTotal, DocCur,
             ISNULL(U_BE1_UUID, '') AS UUID,
             ISNULL(Profile, 0)     AS Profile
      FROM ODLN WITH(NOLOCK)
      WHERE DocEntry > @LastEntry
        AND CANCELED = 'N'
        AND CAST(DocDate AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY DocEntry ASC
    `, { LastEntry: state.lastDeliveryEntry || 0 }, dbName);

    for (const doc of deliveries) {
      await notify(doc, 'irsaliye', state, dbName);
      if (doc.DocEntry > (state.lastDeliveryEntry || 0)) {
        state.lastDeliveryEntry = doc.DocEntry;
        dirty = true;
      }
    }
    if (deliveries.length) console.log(`[DocNotifier] ODLN işlendi: ${deliveries.length} belge`);
  } catch (err) {
    console.error('[DocNotifier] ODLN poll hatası:', err.message);
  }

  if (dirty) {
    state.lastRun = new Date().toISOString();
    saveState(state);
  }
}

// ─── Servis Başlat ────────────────────────────────────────────
function start() {
  setInterval(() => {
    tick().catch(err => console.error('[DocNotifier] Tick hatası:', err.message));
  }, POLL_INTERVAL);
  console.log('[DocNotifier] Belge bildirim servisi başlatıldı (her 3 dk)');
}

module.exports = { start, loadState, saveState };
