'use strict';

/**
 * tools/generate-license.js
 *
 * Müşteri başına lisans dosyası üretir (.lic).
 * Ed25519 private key ile imzalar → müşteri değiştiremez.
 *
 * Kullanım:
 *   node tools/generate-license.js [seçenekler]
 *
 * Seçenekler:
 *   --customer  "Firma Adı"          (zorunlu)
 *   --maxUsers  20                   (zorunlu)
 *   --fingerprint <sha256hex>        (müşteriden alınır — boş = fingerprint bağlaması yok)
 *   --expires   2026-12-31           (boş = sınırsız)
 *   --out       ./output.lic         (varsayılan: <customer>.lic)
 *
 * Örnek:
 *   node tools/generate-license.js --customer "Acme A.Ş." --maxUsers 10 --fingerprint abc123 --expires 2027-01-01
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─── Argüman Parse ───────────────────────────────────────────
function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const customer    = arg('customer');
const maxUsers    = parseInt(arg('maxUsers') || '0');
const fingerprint = arg('fingerprint') || null;
const expires     = arg('expires')     || null;
const outArg      = arg('out')         || null;

if (!customer) { console.error('Hata: --customer gerekli'); process.exit(1); }
if (!maxUsers || maxUsers <= 0) { console.error('Hata: --maxUsers gerekli (> 0)'); process.exit(1); }

// ─── Private Key ─────────────────────────────────────────────
const PRIV_FILE = path.join(__dirname, 'keys', 'private.pem');
if (!fs.existsSync(PRIV_FILE)) {
  console.error('Hata: tools/keys/private.pem bulunamadı. Önce generate-keypair.js çalıştırın.');
  process.exit(1);
}
const privateKey = fs.readFileSync(PRIV_FILE, 'utf8');

// ─── Payload ─────────────────────────────────────────────────
const payload = {
  customer,
  maxUsers,
  issuedAt: new Date().toISOString(),
};
if (fingerprint) payload.fingerprint = fingerprint;
if (expires)     payload.expiresAt   = new Date(expires).toISOString();

// ─── İmzala ──────────────────────────────────────────────────
const payloadBuf = Buffer.from(JSON.stringify(payload));
const keyObj     = crypto.createPrivateKey(privateKey);
const sig        = crypto.sign(null, payloadBuf, keyObj).toString('base64');

const licContent = Buffer.from(JSON.stringify({ payload, sig })).toString('base64');

// ─── Kaydet ──────────────────────────────────────────────────
const safeName = customer.replace(/[^a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '_');
const outFile  = outArg || path.join(process.cwd(), `${safeName}.lic`);
fs.writeFileSync(outFile, licContent, 'utf8');

console.log('\n✓ Lisans oluşturuldu:\n');
console.log('  Müşteri :', customer);
console.log('  Max Kul. :', maxUsers);
console.log('  Fingerpr.:', fingerprint || '(bağlamasız — herhangi sisteme kurulabilir)');
console.log('  Bitiş   :', expires || '∞ (sınırsız)');
console.log('  Dosya   :', outFile);
console.log('\n  Müşteriye gönderin → Admin Panel → Kullanıcılar → Lisans İçe Aktar\n');
