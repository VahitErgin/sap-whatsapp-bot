'use strict';

/**
 * approvalNotifier.js
 *
 * SAP B1 onay bekleyen belgelerini her 2 dakikada bir kontrol eder.
 * Yeni onay talebi geldiğinde ilgili onaylayıcıya WhatsApp bildirimi gönderir.
 *
 * Akış:
 *   OWDD + WDD1 polling → yeni W durumu → approver-phones.json'dan telefon bul
 *   → sendButtons (Onayla / Reddet) → kullanıcı tap'lar
 *   → APPROVE:/REJECT: intentRouter'a düşer → confirmApproval çağrılır
 *
 * State  : data/approval-notif-state.json
 * Phones : data/approver-phones.json  (SAP UserCode → WA numarası)
 */

const fs   = require('fs');
const path = require('path');

const { getOnayBekleyenler } = require('../modules/sapDb');
const { sendButtons } = require('../services/whatsappService');
const config = require('../config/config');

const DATA_DIR    = path.join(__dirname, '../../data');
const STATE_FILE  = path.join(DATA_DIR, 'approval-notif-state.json');
const PHONES_FILE = path.join(DATA_DIR, 'approver-phones.json');
const POLL_INTERVAL = 2 * 60 * 1000; // 2 dakika

// data/ ve phones dosyası yoksa oluştur
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PHONES_FILE)) {
  fs.writeFileSync(PHONES_FILE, JSON.stringify({
    '_comment': 'SAP UserCode → WhatsApp telefon (ülke kodu dahil, + olmadan)',
    'manager': '905001234567',
  }, null, 2), 'utf8');
}

// ─── Dosya okuma/yazma ───────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {
    console.error('[ApprovalNotifier] State kayıt hatası:', e.message);
  }
}
function loadPhones() {
  try {
    const data = JSON.parse(fs.readFileSync(PHONES_FILE, 'utf8'));
    delete data._comment;
    return data; // { userCode: phone }
  } catch { return {}; }
}

// ─── Para formatı ────────────────────────────────────────────
function formatMoney(amount, currency) {
  const num = Number(amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${num} ${currency || 'TRY'}`;
}

// ─── Onay bildirimi gönder ───────────────────────────────────
async function sendApprovalNotification(phone, row) {
  const header = `📋 Onay Talebi: ${row.BelgeTipi}`;
  const body   = [
    `📄 *Belge No:* ${row.DocNum}`,
    row.CardName ? `🏢 *Firma:* ${row.CardName}` : '',
    `💰 *Tutar:* ${formatMoney(row.DocTotal, row.ParaBirimi)}`,
    `📅 *Tarih:* ${row.TalepTarihi}`,
    row.Aciklama ? `📝 *Açıklama:* ${row.Aciklama}` : '',
    '',
    'Onaylamak istiyor musunuz?',
  ].filter(Boolean).join('\n');

  await sendButtons(phone, header, body, [
    { id: `APPROVE:${row.DocEntry}`, title: '✅ Onayla' },
    { id: `REJECT:${row.DocEntry}`,  title: '❌ Reddet' },
  ]);
}

// ─── Ana kontrol ─────────────────────────────────────────────
async function checkOnaylar() {
  try {
    const rows   = await getOnayBekleyenler({ dbName: config.sapDb.database || undefined });
    const phones = loadPhones();
    const state  = loadState();

    const newState = {};
    let sent = 0;

    for (const row of rows) {
      const key  = `${row.DocEntry}_${row.OnaylayanKod}`;
      newState[key] = { docNum: row.DocNum, belgeTipi: row.BelgeTipi, notifiedAt: state[key]?.notifiedAt || null };

      // Daha önce bildirim gönderildi mi?
      if (state[key]?.notifiedAt) continue;

      const phone = phones[row.OnaylayanKod];
      if (!phone) {
        console.warn(`[ApprovalNotifier] Telefon bulunamadı: ${row.OnaylayanKod} → approver-phones.json'a ekleyin`);
        newState[key].notifiedAt = new Date().toISOString(); // tekrar uyarma
        continue;
      }

      try {
        await sendApprovalNotification(phone, row);
        newState[key].notifiedAt = new Date().toISOString();
        console.log(`[ApprovalNotifier] ✓ ${row.BelgeTipi} #${row.DocNum} → ${phone} (${row.OnaylayanKod})`);
        sent++;
      } catch (err) {
        console.error(`[ApprovalNotifier] ✗ Gönderim hatası (${phone}):`, err.message);
      }
    }

    saveState(newState);
    if (sent > 0) console.log(`[ApprovalNotifier] ${sent} onay bildirimi gönderildi`);

  } catch (err) {
    console.error('[ApprovalNotifier] Kontrol hatası:', err.message);
  }
}

// ─── Başlat ─────────────────────────────────────────────────
function start() {
  if (!config.sapDb.database) {
    console.warn('[ApprovalNotifier] SAP_DB_NAME tanımlı değil → onay bildirimleri devre dışı');
    return;
  }
  console.log(`[ApprovalNotifier] Onay polling başlatıldı (her ${POLL_INTERVAL / 60000} dakika)`);
  checkOnaylar();
  setInterval(checkOnaylar, POLL_INTERVAL);
}

module.exports = { start };
