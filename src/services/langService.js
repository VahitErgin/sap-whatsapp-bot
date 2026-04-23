'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../data/lang-prefs.json');

const SUPPORTED = ['tr', 'en', 'ar'];

function getLang(phone) {
  const prefs   = _read();
  const phone10 = _norm(phone);
  return prefs[phone10] || 'tr';
}

function setLang(phone, lang) {
  if (!SUPPORTED.includes(lang)) return;
  const prefs   = _read();
  const phone10 = _norm(phone);
  prefs[phone10] = lang;
  _write(prefs);
}

function deleteLang(phone) {
  const prefs   = _read();
  const phone10 = _norm(phone);
  delete prefs[phone10];
  _write(prefs);
}

// Açıkça seçilmişse dil döndürür, seçilmemişse null
function getExplicitLang(phone) {
  const prefs   = _read();
  const phone10 = _norm(phone);
  return prefs[phone10] || null;
}

function getAllPrefs() {
  return _read();
}

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function _read() {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function _write(data) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { getLang, getExplicitLang, setLang, deleteLang, getAllPrefs, SUPPORTED };
