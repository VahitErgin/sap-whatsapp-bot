'use strict';

/**
 * ohemService.js
 *
 * OHEM (Çalışan Ana Veri) erişim ayarlarını yönetir.
 * data/ohem-settings.json dosyasında kullanıcı bazlı lisans ve aktiflik tutulur.
 */

const fs   = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../data/ohem-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return { enabled: false, users: [] };
  }
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// OHEM erişimi genel olarak açık mı?
function isEnabled() {
  return loadSettings().enabled === true;
}

// Aktif kullanıcı listesi
function getEnabledUsers() {
  const { enabled, users = [] } = loadSettings();
  if (!enabled) return [];
  return users.filter(u => u.enabled !== false);
}

// Telefon ile kullanıcı bul (son 10 hane karşılaştırma)
function getUserByPhone(phone10) {
  return getEnabledUsers().find(u => {
    const p = String(u.phone || '').replace(/\D/g, '').slice(-10);
    return p === phone10;
  }) || null;
}

module.exports = { loadSettings, saveSettings, isEnabled, getEnabledUsers, getUserByPhone };
