'use strict';

/**
 * approvalNotifier.js
 *
 * SAP B1 onay bekleyen belgelerini her 2 dakikada bir kontrol eder.
 * Yeni onay talebi geldiğinde kayıtlı tüm onay yetkililerine WhatsApp bildirimi gönderir.
 *
 * Akış:
 *   OWDD polling → yeni W durumu → readApprovers() listesindeki tüm telefonlara
 *   → sendButtons (Onayla / Reddet) → kullanıcı tap'lar
 *   → APPROVE:/REJECT: intentRouter'a düşer
 *
 * State : data/approval-notif-state.json
 */

const fs   = require('fs');
const path = require('path');

const { getOnayBekleyenler } = require('../modules/sapDb');
const { sendButtons } = require('../services/whatsappService');
const config = require('../config/config');

const DATA_DIR   = path.join(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'approval-notif-state.json');
const POLL_INTERVAL = 2 * 60 * 1000; // 2 dakika

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Dosya okuma/yazma ───────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {
    console.error('[ApprovalNotifier] State kayıt hatası:', e.message);
  }
}
// ─── Telefon normaliz: rakamları al, son 10 hane ─────────────
function normPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-10);
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
    { id: `APPROVE:${row.WddCode}`, title: '✅ Onayla' },
    { id: `REJECT:${row.WddCode}`,  title: '❌ Reddet' },
  ]);
}

// ─── Ana kontrol ─────────────────────────────────────────────
async function checkOnaylar() {
  try {
    const rows  = await getOnayBekleyenler({ dbName: config.sapDb.database || undefined });
    const state = loadState();

    const newState = {};
    let sent = 0;

    for (const row of rows) {
      const key = `${row.WddCode}_${row.OnaylayanKod}`;
      newState[key] = { docNum: row.DocNum, belgeTipi: row.BelgeTipi, notifiedAt: state[key]?.notifiedAt || null };

      if (state[key]?.notifiedAt) continue;

      // OUSR.PortNum → uluslararası formata çevir (90XXXXXXXXXX)
      const raw10 = normPhone(row.OnaylayanTelefon);
      if (!raw10) {
        console.warn(`[ApprovalNotifier] OUSR.PortNum boş: ${row.OnaylayanKod} (${row.OnaylayanAd})`);
        continue;
      }
      const phone = raw10.startsWith('90') ? raw10 : '90' + raw10;

      try {
        await sendApprovalNotification(phone, row);
        newState[key].notifiedAt = new Date().toISOString();
        console.log(`[ApprovalNotifier] ✓ ${row.BelgeTipi} #${row.DocNum} → ${phone} (${row.OnaylayanAd} / ${row.OnaylayanKod})`);
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
