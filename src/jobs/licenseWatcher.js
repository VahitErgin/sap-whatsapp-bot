'use strict';

/**
 * licenseWatcher.js
 *
 * Lisans bitiş tarihine göre otomatik WhatsApp uyarısı gönderir.
 * Son 10 günde her gün bir kez LICENSE_NOTIF_PHONE numarasına bildirim gider.
 * Kontrol saatte bir yapılır; aynı gün içinde ikinci bildirim gönderilmez.
 *
 * State: data/license-notif-state.json  { lastSentDate: "YYYY-MM-DD" }
 */

const fs   = require('fs');
const path = require('path');

const { getLicenseInfo } = require('../services/licenseService');
const { sendText }       = require('../services/whatsappService');

const STATE_FILE     = path.join(__dirname, '../../data/license-notif-state.json');
const CHECK_INTERVAL = 60 * 60 * 1000; // Saatte bir
const WARN_DAYS      = 10;             // Son 10 günde uyar

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (err) { console.error('[LicenseWatcher] State kayıt hatası:', err.message); }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatPhone(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[\s\-\(\)\+]/g, '');
  if (n.startsWith('0')) n = '90' + n.slice(1);
  if (n.length === 10 && n.startsWith('5')) n = '90' + n;
  return /^\d{10,15}$/.test(n) ? n : null;
}

async function checkLicense() {
  const rawPhone = process.env.LICENSE_NOTIF_PHONE;
  const phone    = formatPhone(rawPhone);
  if (!phone) return;

  const licInfo = getLicenseInfo();
  if (!licInfo.active || !licInfo.expiresAt) return;

  const expiresAt = new Date(licInfo.expiresAt);
  const now       = new Date();
  const daysLeft  = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0 || daysLeft > WARN_DAYS) return;

  const state = loadState();
  if (state.lastSentDate === todayStr()) return;

  const expStr = expiresAt.toLocaleDateString('tr-TR');
  const msg = daysLeft <= 3
    ? `🚨 *SAWBot Lisans Kritik Uyarı*\n\nSistem lisansı *${daysLeft} gün* içinde sona eriyor!\n📅 Bitiş: *${expStr}*\n\nListanızı hemen yenileyin.`
    : `⚠️ *SAWBot Lisans Uyarısı*\n\nSistem lisansı *${daysLeft} gün* içinde sona eriyor.\n📅 Bitiş: *${expStr}*\n\nLütfen lisansı yenileyin.`;

  try {
    await sendText(phone, msg);
    state.lastSentDate = todayStr();
    saveState(state);
    console.log(`[LicenseWatcher] Uyarı gönderildi → ${phone} (${daysLeft} gün kaldı)`);
  } catch (err) {
    console.error('[LicenseWatcher] Mesaj gönderilemedi:', err.message);
  }
}

function start() {
  console.log('[LicenseWatcher] Başlatıldı – lisans kontrolü her saat');
  setTimeout(checkLicense, 5000); // Başlangıçta 5sn bekle (SAP bağlantısı kurulsun)
  setInterval(checkLicense, CHECK_INTERVAL);
}

module.exports = { start };
