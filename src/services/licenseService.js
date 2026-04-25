'use strict';

/**
 * licenseService.js
 *
 * İmzalı lisans dosyasını (.lic) doğrular ve uygulama kısıtlamalarını
 * (maxUsers, expiresAt) buradan okur.
 *
 * Güvenlik modeli:
 *  - Endeks → Ed25519 private key ile imzalar  (private.pem asla paylaşılmaz)
 *  - Uygulama → aşağıdaki public key ile doğrular
 *  - Müşteri → .lic içeriğini değiştiremez; imza bozulur
 *
 * Public key'i güncellemek için: tools/generate-keypair.js çalıştırın.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ─── Endeks'in Ed25519 public key'i ──────────────────────────
// tools/generate-keypair.js çıktısından buraya yapıştırın.
// Bu key değişirse mevcut tüm .lic dosyaları geçersiz olur.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbI9WKCjvtQFBsJ9Ok6aQQQQ+BQDaL7H+QP0AVGaZmNE=
-----END PUBLIC KEY-----`;

const LICENSE_FILE = path.join(__dirname, '../../data/license.lic');

// ─── Fingerprint ─────────────────────────────────────────────
// Lisansı bu kuruluma özgü kılar. Müşteri fingerprint'ini
// admin panelden kopyalayıp Endeks'e gönderir.
function getFingerprint() {
  const parts = [
    os.hostname(),
    process.env.SAP_COMPANY_DB || '',
    process.env.SAP_DB_NAME    || '',
  ];
  return crypto.createHash('sha256').update(parts.join('::')).digest('hex');
}

// ─── Lisans yükle & doğrula ──────────────────────────────────
let _cache    = null;   // { payload, loadedAt }
let _cacheErr = null;

function loadLicense() {
  if (_cache) return _cache.payload;

  if (!fs.existsSync(LICENSE_FILE)) return null;

  try {
    const raw     = fs.readFileSync(LICENSE_FILE, 'utf8').trim();
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const { payload, sig } = decoded;

    if (!payload || !sig) throw new Error('Geçersiz lisans formatı');

    // İmzayı doğrula
    const payloadBuf = Buffer.from(JSON.stringify(payload));
    const sigBuf     = Buffer.from(sig, 'base64');

    let keyObj;
    try {
      keyObj = crypto.createPublicKey(PUBLIC_KEY_PEM);
    } catch {
      throw new Error('Public key geçersiz — generate-keypair.js ile güncelleyin');
    }

    const valid = crypto.verify(null, payloadBuf, keyObj, sigBuf);
    if (!valid) throw new Error('Lisans imzası geçersiz');

    // Fingerprint kontrolü
    const fp = getFingerprint();
    if (payload.fingerprint && payload.fingerprint !== fp) {
      throw new Error(`Lisans bu sisteme ait değil (fingerprint uyuşmuyor)`);
    }

    // Süre kontrolü
    if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
      throw new Error(`Lisans süresi dolmuş (${payload.expiresAt})`);
    }

    _cache    = { payload, loadedAt: Date.now() };
    _cacheErr = null;
    console.log(`[License] ✓ ${payload.customer} — max ${payload.maxUsers} kullanıcı, bitiş: ${payload.expiresAt || '∞'}`);
    return payload;

  } catch (err) {
    _cacheErr = err.message;
    console.error('[License] ✗', err.message);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────
function getMaxUsers() {
  const lic = loadLicense();
  if (lic) return lic.maxUsers;
  // .lic yoksa env fallback (geliştirme / Endeks iç kullanım)
  const v = parseInt(process.env.MAX_USERS || '0');
  return v > 0 ? v : null;
}

function getLicenseInfo() {
  const lic = loadLicense();
  return {
    active:      !!lic,
    error:       _cacheErr || null,
    customer:    lic?.customer    || null,
    maxUsers:    lic?.maxUsers    || getMaxUsers(),
    expiresAt:   lic?.expiresAt   || null,
    issuedAt:    lic?.issuedAt    || null,
    fingerprint: getFingerprint(),
  };
}

// Lisans dosyasını kaydet (admin panel import)
function importLicense(base64Content) {
  // Önce doğrula
  const raw     = base64Content.trim();
  const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const { payload, sig } = decoded;
  if (!payload || !sig) throw new Error('Geçersiz lisans formatı');

  const payloadBuf = Buffer.from(JSON.stringify(payload));
  const sigBuf     = Buffer.from(sig, 'base64');
  const keyObj     = crypto.createPublicKey(PUBLIC_KEY_PEM);
  const valid      = crypto.verify(null, payloadBuf, keyObj, sigBuf);
  if (!valid) throw new Error('İmza geçersiz — bu lisans Endeks tarafından oluşturulmamış');

  if (payload.fingerprint && payload.fingerprint !== getFingerprint()) {
    throw new Error('Bu lisans başka bir sisteme ait (fingerprint uyuşmuyor)');
  }
  if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
    throw new Error(`Lisans süresi dolmuş (${payload.expiresAt})`);
  }

  const dir = path.dirname(LICENSE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LICENSE_FILE, raw, 'utf8');

  // Cache temizle → bir sonraki loadLicense yeniden okur
  _cache    = null;
  _cacheErr = null;

  return payload;
}

module.exports = { getMaxUsers, getLicenseInfo, importLicense, getFingerprint };
