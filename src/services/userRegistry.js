'use strict';

/**
 * userRegistry.js
 *
 * WhatsApp bot'una erişim izni olan telefon numaralarını yönetir.
 * Lisans limiti .env MAX_USERS ile belirlenir — müşteri değiştiremez.
 *
 * MAX_USERS tanımlı değilse kayıt kontrolü devre dışı (geriye dönük uyumluluk).
 */

const fs   = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '../../data/users.json');
const DATA_DIR      = path.join(__dirname, '../../data');

// ─── Dosya CRUD ───────────────────────────────────────────────
function readRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return { users: [] };
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch { return { users: [] }; }
}

function saveRegistry(reg) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf8');
}

// ─── Limit ───────────────────────────────────────────────────
function getMaxUsers() {
  const v = parseInt(process.env.MAX_USERS || '0');
  return v > 0 ? v : null; // null = sınırsız / kontrol yok
}

// Kayıt kontrolü aktif mi?
function isEnabled() {
  return getMaxUsers() !== null;
}

// ─── Sorgular ────────────────────────────────────────────────
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function isAllowed(phone) {
  if (!isEnabled()) return true; // MAX_USERS yoksa herkese açık
  const phone10 = normalizePhone(phone);
  if (!phone10) return false;
  const reg = readRegistry();
  return reg.users.some(u => u.enabled !== false && normalizePhone(u.phone) === phone10);
}

function getStats() {
  const reg  = readRegistry();
  const max  = getMaxUsers();
  const active = reg.users.filter(u => u.enabled !== false);
  return {
    count:   active.length,
    max:     max ?? '∞',
    limited: max !== null,
    users:   reg.users,
  };
}

// ─── Mutasyon ────────────────────────────────────────────────
function addUser({ phone, name }) {
  const phone10 = normalizePhone(phone);
  if (!phone10 || phone10.length < 10) throw new Error('Geçersiz telefon numarası');

  const reg     = readRegistry();
  const max     = getMaxUsers();
  const active  = reg.users.filter(u => u.enabled !== false);

  if (reg.users.some(u => normalizePhone(u.phone) === phone10)) {
    throw new Error('Bu numara zaten kayıtlı');
  }
  if (max !== null && active.length >= max) {
    throw new Error(`Lisans limitine ulaşıldı (${max} kullanıcı). Paketi yükseltin.`);
  }

  const user = {
    phone:   phone10,
    name:    (name || '').trim() || phone10,
    enabled: true,
    addedAt: new Date().toISOString(),
  };
  reg.users.push(user);
  saveRegistry(reg);
  return user;
}

function updateUser(phone, updates) {
  const phone10 = normalizePhone(phone);
  const reg     = readRegistry();
  const idx     = reg.users.findIndex(u => normalizePhone(u.phone) === phone10);
  if (idx === -1) throw new Error('Kullanıcı bulunamadı');
  reg.users[idx] = { ...reg.users[idx], ...updates };
  saveRegistry(reg);
  return reg.users[idx];
}

function removeUser(phone) {
  const phone10 = normalizePhone(phone);
  const reg     = readRegistry();
  const next    = reg.users.filter(u => normalizePhone(u.phone) !== phone10);
  if (next.length === reg.users.length) throw new Error('Kullanıcı bulunamadı');
  reg.users = next;
  saveRegistry(reg);
  return { ok: true };
}

module.exports = { isAllowed, isEnabled, getStats, addUser, updateUser, removeUser };
