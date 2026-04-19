'use strict';

// ─────────────────────────────────────────────────────────────
// sessionManager.js
//
// WhatsApp kullanıcı oturumlarını bellekte tutar.
// Sunucu yeniden başladığında oturumlar sıfırlanır → tekrar giriş gerekir.
// ─────────────────────────────────────────────────────────────

// Aktif oturumlar: phone10 → { userCode, employeeId, userName, expiresAt }
const _sessions = new Map();

// Şifre bekleme durumu: phone10 → { userCode, userName, expiresAt }
// Kullanıcı "giriş yap" deyince bu moda girer, sonraki mesaj şifre olarak alınır
const _awaitingPassword = new Map();

const PASSWORD_WAIT_MS = 2 * 60 * 1000; // 2 dakika şifre bekleme süresi

// ─── Session timeout: .env'den veya default 480 dakika (8 saat) ───
function getSessionTtlMs() {
  const minutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '480', 10);
  return minutes * 60 * 1000;
}

// ─────────────────────────────────────────────────────────────
// Oturum işlemleri
// ─────────────────────────────────────────────────────────────
function createSession(phone, { userCode, employeeId, userName }) {
  const phone10 = _normalize(phone);
  _sessions.set(phone10, {
    userCode,
    employeeId,
    userName,
    expiresAt: Date.now() + getSessionTtlMs(),
  });
  console.log(`[Session] Açıldı: ${phone10} → ${userCode} (${userName})`);
}

function getSession(phone) {
  const phone10 = _normalize(phone);
  const session = _sessions.get(phone10);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    _sessions.delete(phone10);
    return null;
  }
  return session;
}

function deleteSession(phone) {
  const phone10 = _normalize(phone);
  _sessions.delete(phone10);
  console.log(`[Session] Kapatıldı: ${phone10}`);
}

// ─────────────────────────────────────────────────────────────
// Şifre bekleme durumu
// ─────────────────────────────────────────────────────────────
function setAwaitingPassword(phone, { userCode, userName }) {
  const phone10 = _normalize(phone);
  _awaitingPassword.set(phone10, {
    userCode,
    userName,
    expiresAt: Date.now() + PASSWORD_WAIT_MS,
  });
}

function getAwaitingPassword(phone) {
  const phone10 = _normalize(phone);
  const entry   = _awaitingPassword.get(phone10);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    _awaitingPassword.delete(phone10);
    return null;
  }
  return entry;
}

function clearAwaitingPassword(phone) {
  _awaitingPassword.delete(_normalize(phone));
}

// ─────────────────────────────────────────────────────────────
// Yardımcı
// ─────────────────────────────────────────────────────────────
function _normalize(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

module.exports = { createSession, getSession, deleteSession, setAwaitingPassword, getAwaitingPassword, clearAwaitingPassword };
