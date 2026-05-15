'use strict';

/**
 * urlShortener.js
 *
 * E-belge ve diğer uzun URL'leri kısaltır.
 * "https://mobile.elogo.com.tr/.../UUID.pdf" → "https://wa.endeks.com.tr/r/aB3xY"
 *
 * Aynı URL ikinci kez kısaltılırsa eski code döner (dedup).
 * Disk: data/url-shortener.json — { byCode: {code: {url,ts,hits}}, byUrl: {url:code} }
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config = require('../config/config');

const DB_FILE = path.join(__dirname, '../../data/url-shortener.json');

// 6 karakter base57 (karıştırılabilir 0/O, 1/I/l çıkarıldı)
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

let _db = null;

function _load() {
  if (_db) return _db;
  try {
    _db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!_db.byCode) _db.byCode = {};
    if (!_db.byUrl)  _db.byUrl  = {};
  } catch {
    _db = { byCode: {}, byUrl: {} };
  }
  return _db;
}

function _save() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8');
  } catch (err) {
    console.error('[Shortener] Disk yazma hatası:', err.message);
  }
}

function _genCode() {
  const db = _load();
  let code;
  do {
    const buf = crypto.randomBytes(6);
    code = '';
    for (let i = 0; i < 6; i++) code += ALPHA[buf[i] % ALPHA.length];
  } while (db.byCode[code]);
  return code;
}

/**
 * Uzun URL'i kısalt. Daha önce kısaltıldıysa aynı code'u döndürür.
 * @param {string} longUrl
 * @returns {string|null} tam kısa URL (https://host/r/code) veya null (geçersiz girdi)
 */
function shorten(longUrl) {
  if (!longUrl || typeof longUrl !== 'string') return null;
  if (longUrl.length < 30) return longUrl; // zaten kısa, dokunma

  const db = _load();
  let code = db.byUrl[longUrl];
  if (!code) {
    code = _genCode();
    db.byCode[code] = { url: longUrl, ts: Date.now(), hits: 0 };
    db.byUrl[longUrl] = code;
    _save();
  }

  const base = (config.publicUrl || '').replace(/\/$/, '');
  return base ? `${base}/r/${code}` : `/r/${code}`;
}

/**
 * Code'u uzun URL'e çöz, hit sayacını arttır.
 * @param {string} code
 * @returns {string|null}
 */
function resolve(code) {
  const db = _load();
  const entry = db.byCode[code];
  if (!entry) return null;
  entry.hits = (entry.hits || 0) + 1;
  entry.lastHit = Date.now();
  _save();
  return entry.url;
}

/**
 * Admin panel için: tüm kısa URL'leri listele (yeni → eski sırayla)
 */
function list() {
  const db = _load();
  return Object.entries(db.byCode)
    .map(([code, entry]) => ({
      code,
      url:     entry.url,
      ts:      entry.ts || null,
      hits:    entry.hits || 0,
      lastHit: entry.lastHit || null,
    }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/**
 * Admin panel için: bir kısa URL'i sil
 */
function remove(code) {
  const db = _load();
  const entry = db.byCode[code];
  if (!entry) return false;
  delete db.byCode[code];
  if (db.byUrl[entry.url] === code) delete db.byUrl[entry.url];
  _save();
  return true;
}

module.exports = { shorten, resolve, list, remove };
