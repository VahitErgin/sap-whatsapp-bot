'use strict';

/**
 * tools/generate-keypair.js
 *
 * SADECE ENDEKS'TE BİR KEZ çalıştırılır.
 * Ed25519 anahtar çifti üretir:
 *   tools/keys/private.pem  → asla paylaşılmaz, commit edilmez
 *   tools/keys/public.pem   → licenseService.js içine yapıştırılır
 *
 * Kullanım:
 *   node tools/generate-keypair.js
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const KEYS_DIR  = path.join(__dirname, 'keys');
const PRIV_FILE = path.join(KEYS_DIR, 'private.pem');
const PUB_FILE  = path.join(KEYS_DIR, 'public.pem');

if (fs.existsSync(PRIV_FILE)) {
  console.error('HATA: private.pem zaten var. Yeni çift üretmek tüm mevcut lisansları geçersiz kılar.');
  console.error('Devam etmek için önce tools/keys/private.pem dosyasını silin.');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
});

if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
fs.writeFileSync(PRIV_FILE, privateKey,  { mode: 0o600 });
fs.writeFileSync(PUB_FILE,  publicKey);

console.log('\n✓ Anahtar çifti oluşturuldu:\n');
console.log('  Private key (SADECE ENDEKS — asla paylaşma):');
console.log('  ', PRIV_FILE);
console.log('\n  Public key (licenseService.js → PUBLIC_KEY_PEM alanına yapıştır):');
console.log('─'.repeat(60));
console.log(publicKey.trim());
console.log('─'.repeat(60));
console.log('\nNOT: tools/keys/ klasörünü .gitignore\'a ekle!\n');
