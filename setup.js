#!/usr/bin/env node
'use strict';

/**
 * SAP WhatsApp Bot — Kurulum Sihirbazı
 * Kullanım: node setup.js
 */

const readline    = require('readline');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');
const crypto      = require('crypto');
const { execSync } = require('child_process');

const ROOT           = __dirname;
const ENV_PATH       = path.join(ROOT, '.env');
const ADMIN_CFG_PATH = path.join(ROOT, 'data', 'admin-config.json');

// ─── Renk kodları ────────────────────────────────────────────
const clr = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m',
};
const G = s => `${clr.green}${s}${clr.reset}`;
const R = s => `${clr.red}${s}${clr.reset}`;
const Y = s => `${clr.yellow}${s}${clr.reset}`;
const C = s => `${clr.cyan}${s}${clr.reset}`;
const B = s => `${clr.bold}${s}${clr.reset}`;
const D = s => `${clr.dim}${s}${clr.reset}`;

const OK   = msg => console.log(`  ${G('✓')} ${msg}`);
const ERR  = msg => console.log(`  ${R('✗')} ${msg}`);
const INFO = msg => console.log(`  ${C('ℹ')} ${msg}`);
const WARN = msg => console.log(`  ${Y('⚠')} ${msg}`);

// ─── node_modules kontrolü ───────────────────────────────────
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.error(R('\n  HATA: node_modules bulunamadı. Önce "npm install" çalıştırın.\n'));
  process.exit(1);
}

// ─── Readline ────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt, defaultVal = '') {
  return new Promise(resolve => {
    const hint = defaultVal ? ` ${D(`[${defaultVal}]`)}` : '';
    rl.question(`  ${prompt}${hint}: `, ans => resolve(ans.trim() || defaultVal));
  });
}

function askSecret(prompt) {
  return new Promise(resolve => {
    process.stdout.write(`  ${prompt}: `);
    let input = '';

    if (process.stdin.isTTY) {
      rl.pause();
      process.stdin.setEncoding('utf8');
      process.stdin.setRawMode(true);
      process.stdin.resume();

      function handler(ch) {
        if (ch === '\r' || ch === '\n' || ch === '') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          rl.resume();
          resolve(input);
        } else if (ch === '') {
          process.stdout.write('\n');
          process.exit(0);
        } else if (ch === '' || ch === '\b') {
          if (input.length) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          input += ch;
          process.stdout.write('*');
        }
      }
      process.stdin.on('data', handler);
    } else {
      rl.once('line', line => resolve(line.trim()));
    }
  });
}

async function confirm(prompt, defaultYes = true) {
  const hint = defaultYes ? 'E/h' : 'e/H';
  const ans  = await ask(`${prompt} [${hint}]`, defaultYes ? 'e' : 'h');
  return ans.toLowerCase().startsWith('e');
}

// ─── Adım başlığı ────────────────────────────────────────────
function step(n, title) {
  console.log();
  console.log(`${C(B(`  ─── Adım ${n}:`))} ${B(title)}`);
  console.log();
}

// ─── Bağlantı testleri ───────────────────────────────────────
async function testSapSl(url, db, username, password) {
  const axios = require('axios');
  const agent = new https.Agent({ rejectUnauthorized: false });
  const base  = url.replace(/\/$/, '');
  const res   = await axios.post(`${base}/Login`,
    { CompanyDB: db, UserName: username, Password: password },
    { httpsAgent: agent, timeout: 15000, validateStatus: null }
  );
  if (res.status === 200) return { ok: true };
  const detail = res.data?.error?.message || res.data?.message || `HTTP ${res.status}`;
  return { ok: false, error: detail };
}

async function testSqlDb(server, database, user, password) {
  const sql  = require('mssql');
  const pool = await sql.connect({
    server, database, user, password,
    options: { encrypt: false, trustServerCertificate: true },
    connectTimeout: 10000, requestTimeout: 5000,
  });
  await pool.close();
  return { ok: true };
}

async function testAnthropicKey(apiKey) {
  const axios = require('axios');
  const res   = await axios.post('https://api.anthropic.com/v1/messages',
    { model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] },
    {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 15000, validateStatus: null,
    }
  );
  if (res.status === 200) return { ok: true };
  return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` };
}

async function testOpenAiKey(apiKey) {
  const axios = require('axios');
  const res   = await axios.get('https://api.openai.com/v1/models',
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000, validateStatus: null }
  );
  if (res.status === 200) return { ok: true };
  return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` };
}

// ─── Bağlantı test wrapper ───────────────────────────────────
async function tryConnect(fn, retryMsg) {
  while (true) {
    process.stdout.write('  Bağlantı test ediliyor...');
    try {
      const result = await fn();
      if (result.ok) {
        process.stdout.write(`\r  ${G('✓')} Bağlantı başarılı!                              \n`);
        return true;
      }
      process.stdout.write(`\r  ${R('✗')} ${result.error}                                   \n`);
    } catch (e) {
      process.stdout.write(`\r  ${R('✗')} ${e.message}                                      \n`);
    }
    if (!await confirm(retryMsg || '  Tekrar denemek ister misiniz?')) return false;
    console.log();
  }
}

// ─── Windows Görev Zamanlayıcı ───────────────────────────────
function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function createWindowsTask() {
  const nodePath   = process.execPath.replace(/\\/g, '\\\\');
  const scriptPath = path.join(ROOT, 'src', 'index.js').replace(/\\/g, '\\\\');
  const workDir    = ROOT.replace(/\\/g, '\\\\');
  const taskName   = 'SAP WhatsApp Bot';

  const ps = [
    `$action    = New-ScheduledTaskAction -Execute '${nodePath}' -Argument '"${scriptPath}"' -WorkingDirectory '${workDir}'`,
    `$trigger   = New-ScheduledTaskTrigger -AtStartup`,
    `$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest`,
    `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`,
    `Write-Output 'OK'`,
  ].join('\n');

  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const result  = execSync(`powershell -NonInteractive -EncodedCommand ${encoded}`,
    { encoding: 'utf8', timeout: 20000 });
  return result.trim().includes('OK');
}

// ─── .env yazar ──────────────────────────────────────────────
function writeEnv(cfg) {
  const lines = [
    '# ─── WhatsApp Business API (Meta) ───────────────────────────',
    `WA_PHONE_NUMBER_ID=${cfg.WA_PHONE_NUMBER_ID}`,
    `WA_ACCESS_TOKEN=${cfg.WA_ACCESS_TOKEN}`,
    `WA_VERIFY_TOKEN=${cfg.WA_VERIFY_TOKEN}`,
    '',
    '# ─── SAP B1 Service Layer ────────────────────────────────────',
    `SAP_SERVICE_LAYER_URL=${cfg.SAP_SERVICE_LAYER_URL}`,
    `SAP_COMPANY_DB=${cfg.SAP_COMPANY_DB}`,
    `SAP_DATABASES=${cfg.SAP_DATABASES}`,
    `SAP_USERNAME=${cfg.SAP_USERNAME}`,
    `SAP_PASSWORD=${cfg.SAP_PASSWORD}`,
    '',
    '# ─── SAP B1 Direkt SQL (MSSQL) ───────────────────────────────',
    `SAP_DB_SERVER=${cfg.SAP_DB_SERVER}`,
    `SAP_DB_NAME=${cfg.SAP_DB_NAME}`,
    `SAP_DB_USER=${cfg.SAP_DB_USER}`,
    `SAP_DB_PASSWORD=${cfg.SAP_DB_PASSWORD}`,
    '',
    '# ─── Claude AI API (Anthropic) ──────────────────────────────',
    `ANTHROPIC_API_KEY=${cfg.ANTHROPIC_API_KEY}`,
    '',
    '# ─── OpenAI Whisper (Sesli mesaj transkripsiyon) ─────────────',
    `OPENAI_API_KEY=${cfg.OPENAI_API_KEY}`,
    '',
    '# ─── Uygulama ────────────────────────────────────────────────',
    `PORT=${cfg.PORT}`,
    `NODE_ENV=${cfg.NODE_ENV}`,
    '',
    '# ─── Onay Yetkilileri ─────────────────────────────────────────',
    `APPROVER_PHONES=${cfg.APPROVER_PHONES}`,
    '',
    '# ─── Servis Bildirimleri ──────────────────────────────────────',
    `SERVIS_NOTIF_TEMPLATE=${cfg.SERVIS_NOTIF_TEMPLATE}`,
    '',
    '# ─── Yönetim Paneli ───────────────────────────────────────────',
    `ADMIN_USERNAME=${cfg.ADMIN_USERNAME}`,
    `ADMIN_PASSWORD=${cfg.ADMIN_PASSWORD}`,
    `ADMIN_SESSION_SECRET=${cfg.ADMIN_SESSION_SECRET}`,
    '',
    '# ─── Microsoft Graph / Outlook Takvim ─────────────────────────',
    `GRAPH_ENABLED=${cfg.GRAPH_ENABLED || 'false'}`,
    `GRAPH_TENANT_ID=${cfg.GRAPH_TENANT_ID || ''}`,
    `GRAPH_CLIENT_ID=${cfg.GRAPH_CLIENT_ID || ''}`,
    `GRAPH_CLIENT_SECRET=${cfg.GRAPH_CLIENT_SECRET || ''}`,
    `GRAPH_USER_DOMAIN=${cfg.GRAPH_USER_DOMAIN || ''}`,
    '',
    '# ─── CRM / Oturum Ayarları ────────────────────────────────────',
    `SESSION_TIMEOUT_MINUTES=${cfg.SESSION_TIMEOUT_MINUTES}`,
    `CRM_ACTIVE_TYPES=${cfg.CRM_ACTIVE_TYPES}`,
    `CRM_ACTIVE_SUBJECTS=`,
    `ATTACHMENT_MAX_MB=${cfg.ATTACHMENT_MAX_MB}`,
  ];
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

// ─── Ana sihirbaz ────────────────────────────────────────────
async function main() {
  console.clear();
  console.log();
  console.log(B('  ╔═══════════════════════════════════════════════╗'));
  console.log(B('  ║    SAP WhatsApp Bot  —  Kurulum Sihirbazı    ║'));
  console.log(B('  ╚═══════════════════════════════════════════════╝'));
  console.log();
  INFO('Bu sihirbaz .env dosyanızı oluşturacak ve bağlantıları test edecektir.');
  INFO('İptal etmek için Ctrl+C kullanın.');

  // ── Mevcut .env kontrolü ─────────────────────────────────
  if (fs.existsSync(ENV_PATH)) {
    console.log();
    WARN('.env dosyası zaten mevcut — üzerine yazılacak.');
    if (!await confirm('  Devam edilsin mi?', false)) {
      INFO('Kurulum iptal edildi.'); rl.close(); process.exit(0);
    }
  }

  const cfg = {};

  // ══════════════════════════════════════════════════════════
  // ADIM 1 — SAP Service Layer
  // ══════════════════════════════════════════════════════════
  step(1, 'SAP B1 Service Layer');
  INFO('Sunucu adresini, şirket DB adını ve SAP kullanıcı bilgilerini girin.');
  INFO('Self-signed sertifika varsa otomatik kabul edilir.');
  console.log();

  let slDone = false;
  while (!slDone) {
    cfg.SAP_SERVICE_LAYER_URL = await ask('Service Layer URL', 'https://SAP-SUNUCU:50000/b1s/v2/');
    cfg.SAP_COMPANY_DB        = await ask('Şirket DB adı');
    cfg.SAP_DATABASES         = await ask('Ek DB\'ler (noktalı virgülle, boş bırakılabilir)', '');
    cfg.SAP_USERNAME          = await ask('SAP kullanıcı adı', 'manager');
    cfg.SAP_PASSWORD          = await askSecret('SAP şifresi');
    console.log();
    slDone = await tryConnect(
      () => testSapSl(cfg.SAP_SERVICE_LAYER_URL, cfg.SAP_COMPANY_DB, cfg.SAP_USERNAME, cfg.SAP_PASSWORD),
      '  Bilgileri düzeltip tekrar denemek ister misiniz?'
    );
    if (!slDone && !await confirm('  SAP bilgilerini yeniden girin?')) {
      WARN('SAP Service Layer bağlantısı doğrulanamadı — bilgiler kaydedilecek.');
      slDone = true;
    }
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 2 — SAP SQL Veritabanı
  // ══════════════════════════════════════════════════════════
  step(2, 'SAP SQL Veritabanı (Direkt MSSQL)');
  INFO('Cari ekstre, bakiye ve raporlar için direkt MSSQL bağlantısı gereklidir.');
  INFO('Bu adımı atlamak için Sunucu alanını boş bırakın.');
  console.log();

  cfg.SAP_DB_SERVER   = await ask('SQL Server (IP veya hostname)', '');
  cfg.SAP_DB_NAME     = await ask('Veritabanı adı', cfg.SAP_COMPANY_DB);
  cfg.SAP_DB_USER     = await ask('SQL kullanıcısı', 'sa');
  cfg.SAP_DB_PASSWORD = await askSecret('SQL şifresi');
  console.log();

  if (!cfg.SAP_DB_SERVER) {
    WARN('SQL bağlantısı atlandı — direkt sorgular çalışmayacak.');
  } else {
    const sqlOk = await tryConnect(
      () => testSqlDb(cfg.SAP_DB_SERVER, cfg.SAP_DB_NAME, cfg.SAP_DB_USER, cfg.SAP_DB_PASSWORD),
      '  Tekrar denemek ister misiniz?'
    );
    if (!sqlOk) WARN('SQL bağlantısı doğrulanamadı — bilgiler kaydedilecek.');
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 3 — WhatsApp Business API
  // ══════════════════════════════════════════════════════════
  step(3, 'WhatsApp Business API (Meta Cloud API)');
  INFO('Meta Developer Console → Sol menü WhatsApp → API Setup');
  console.log();

  cfg.WA_PHONE_NUMBER_ID = await ask('Phone Number ID');
  cfg.WA_ACCESS_TOKEN    = await askSecret('Access Token (EAAxxxx...)');
  console.log();
  INFO('Verify Token: webhook doğrulaması için belirlediğiniz herhangi bir kelime.');
  cfg.WA_VERIFY_TOKEN    = await ask('Verify Token', 'sawbot-webhook-2024');
  OK('WhatsApp bilgileri kaydedildi (bağlantı kurulumdan sonra test edilebilir).');

  // ══════════════════════════════════════════════════════════
  // ADIM 4 — Anthropic (Claude AI)
  // ══════════════════════════════════════════════════════════
  step(4, 'Claude AI — Anthropic API');
  INFO('console.anthropic.com adresinden API key oluşturun.');
  console.log();

  let anthropicDone = false;
  while (!anthropicDone) {
    cfg.ANTHROPIC_API_KEY = await askSecret('API Key (sk-ant-...)');
    console.log();
    const ok = await tryConnect(
      () => testAnthropicKey(cfg.ANTHROPIC_API_KEY),
      '  Tekrar denemek ister misiniz?'
    );
    if (!ok && !await confirm('  Farklı bir key ile tekrar deneyin?')) {
      WARN('Anthropic key doğrulanamadı — bilgiler kaydedilecek.');
      anthropicDone = true;
    } else if (ok) {
      anthropicDone = true;
    }
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 5 — OpenAI Whisper (isteğe bağlı)
  // ══════════════════════════════════════════════════════════
  step(5, 'OpenAI Whisper — Sesli Mesaj (isteğe bağlı)');
  INFO('WhatsApp sesli mesajlarını metne çevirmek için kullanılır.');
  console.log();

  cfg.OPENAI_API_KEY = '';
  if (await confirm('  OpenAI entegrasyonu aktif edilsin mi?', false)) {
    let openaiDone = false;
    while (!openaiDone) {
      cfg.OPENAI_API_KEY = await askSecret('OpenAI API Key (sk-proj-...)');
      console.log();
      const ok = await tryConnect(
        () => testOpenAiKey(cfg.OPENAI_API_KEY),
        '  Tekrar denemek ister misiniz?'
      );
      if (!ok && !await confirm('  Farklı key ile deneyin?')) {
        WARN('OpenAI key doğrulanamadı — bilgiler kaydedilecek.');
        openaiDone = true;
      } else if (ok) {
        openaiDone = true;
      }
    }
  } else {
    INFO('Sesli mesaj desteği devre dışı bırakıldı.');
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 6 — Yönetim Paneli
  // ══════════════════════════════════════════════════════════
  step(6, 'Yönetim Paneli Kimlik Bilgileri');
  INFO(`Admin panel adresi: http://SUNUCU:PORT/admin`);
  console.log();

  cfg.ADMIN_USERNAME       = await ask('Admin kullanıcı adı', 'admin');
  cfg.ADMIN_PASSWORD       = await askSecret('Admin şifresi');
  cfg.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.log();
  OK(`Session secret otomatik oluşturuldu.`);

  // ══════════════════════════════════════════════════════════
  // ADIM 7 — Uygulama Ayarları
  // ══════════════════════════════════════════════════════════
  step(7, 'Uygulama Ayarları');

  cfg.PORT                    = await ask('Port numarası', '3000');
  cfg.NODE_ENV                = await ask('Ortam', 'production');
  cfg.SESSION_TIMEOUT_MINUTES = await ask('SAP oturum süresi (dakika)', '480');
  cfg.ATTACHMENT_MAX_MB       = await ask('Maks. dosya boyutu MB (aktivite ekiği)', '5');
  cfg.SERVIS_NOTIF_TEMPLATE   = await ask('Servis bildirim WhatsApp şablon adı', 'servis_durum_guncelleme');
  cfg.CRM_ACTIVE_TYPES        = 'Phone Call,Meeting,Task,Note,Email';
  console.log();
  INFO('Onay yetkilileri kurulumdan sonra admin panelden de eklenebilir.');
  cfg.APPROVER_PHONES         = await ask('Onay yetkilisi numaraları (virgülle, 905XXXXXXXXX)', '');

  // ══════════════════════════════════════════════════════════
  // .env yaz
  // ══════════════════════════════════════════════════════════
  console.log();
  INFO('.env dosyası yazılıyor...');
  try {
    writeEnv(cfg);
    OK('.env başarıyla oluşturuldu.');
  } catch (e) {
    ERR(`.env yazılamadı: ${e.message}`); rl.close(); process.exit(1);
  }

  // Eski admin-config.json varsa sil (yeni şifreyi alsın)
  if (fs.existsSync(ADMIN_CFG_PATH)) {
    try { fs.unlinkSync(ADMIN_CFG_PATH); INFO('Eski admin-config.json silindi.'); }
    catch { /* kritik değil */ }
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 8 — Microsoft Graph / Outlook Takvim (isteğe bağlı)
  // ══════════════════════════════════════════════════════════
  step(8, 'Microsoft Outlook Takvim (isteğe bağlı)');
  INFO('SAP aktiviteleri Outlook takvimine otomatik eklensin mi?');
  INFO('Azure AD App Registration + Calendars.ReadWrite yetkisi gereklidir.');
  console.log();

  cfg.GRAPH_ENABLED      = 'false';
  cfg.GRAPH_TENANT_ID    = '';
  cfg.GRAPH_CLIENT_ID    = '';
  cfg.GRAPH_CLIENT_SECRET = '';
  cfg.GRAPH_USER_DOMAIN  = '';

  if (await confirm('  Outlook entegrasyonu aktif edilsin mi?', false)) {
    INFO('Azure Portal → App registrations → uygulamanızı seçin → Overview sekmesi');
    console.log();
    cfg.GRAPH_TENANT_ID     = await ask('Tenant ID (Directory ID)');
    cfg.GRAPH_CLIENT_ID     = await ask('Client ID (Application ID)');
    cfg.GRAPH_CLIENT_SECRET = await askSecret('Client Secret');
    cfg.GRAPH_USER_DOMAIN   = await ask('Kullanıcı domain\'i', '@company.com');
    console.log();

    const axios = require('axios');
    const graphOk = await tryConnect(async () => {
      const res = await axios.post(
        `https://login.microsoftonline.com/${cfg.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
          grant_type: 'client_credentials', client_id: cfg.GRAPH_CLIENT_ID,
          client_secret: cfg.GRAPH_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default',
        }),
        { timeout: 10000, validateStatus: null }
      );
      if (res.status === 200 && res.data.access_token) return { ok: true };
      return { ok: false, error: res.data?.error_description || `HTTP ${res.status}` };
    }, '  Bilgileri düzeltip tekrar denemek ister misiniz?');

    if (graphOk) {
      cfg.GRAPH_ENABLED = 'true';
      OK('Outlook Takvim entegrasyonu aktifleştirildi.');
    } else {
      WARN('Graph bağlantısı doğrulanamadı — bilgiler kaydedilecek, panelden aktif edebilirsiniz.');
      cfg.GRAPH_ENABLED = 'false';
    }
  } else {
    INFO('Outlook entegrasyonu devre dışı bırakıldı.');
  }

  // ══════════════════════════════════════════════════════════
  // ADIM 9 — Windows Görev Zamanlayıcı
  // ══════════════════════════════════════════════════════════
  step(9, 'Windows Görev Zamanlayıcı (isteğe bağlı)');
  INFO('Bot, Windows başladığında otomatik başlasın mı?');
  INFO('Bu adım yönetici (Administrator) yetkisi gerektirir.');
  console.log();

  let taskRegistered = false;
  if (await confirm('  Görev Zamanlayıcıya kaydet?', true)) {
    if (!isAdmin()) {
      WARN('Yönetici yetkisi algılanamadı.');
      WARN('setup.bat\'ı "Yönetici olarak çalıştır" ile açarsanız bu adım çalışır.');
      WARN('Şimdilik atlanıyor — admin panelinden veya Task Scheduler\'dan manuel eklenebilir.');
    } else {
      process.stdout.write('  Görev oluşturuluyor...');
      try {
        const ok = createWindowsTask();
        if (ok) {
          process.stdout.write(`\r  ${G('✓')} "SAP WhatsApp Bot" görevi oluşturuldu.              \n`);
          taskRegistered = true;
        } else {
          process.stdout.write(`\r  ${R('✗')} Görev oluşturulamadı (PowerShell çıktısı beklenmedik).\n`);
        }
      } catch (e) {
        process.stdout.write(`\r  ${R('✗')} Hata: ${e.message}\n`);
      }
    }
  } else {
    INFO('Görev Zamanlayıcı adımı atlandı.');
  }

  // ══════════════════════════════════════════════════════════
  // SONRAKI ADIMLAR
  // ══════════════════════════════════════════════════════════
  console.log();
  console.log(B(`  ${G('═══════════════════════════════════════════════')}`));
  console.log(B(`  ${G('   ✓  Kurulum tamamlandı!')}`));
  console.log(B(`  ${G('═══════════════════════════════════════════════')}`));
  console.log();
  console.log(B('  Sonraki Adımlar'));
  console.log();

  if (taskRegistered) {
    console.log(`  ${C('1.')} Bot artık Windows başlangıcında otomatik başlayacak.`);
    console.log(`     Yönetmek için: ${C('Görev Zamanlayıcı')} → ${C('"SAP WhatsApp Bot"')}`);
    console.log(`     Manuel başlatmak için: ${C('start.bat')} ${D('veya')} ${C('node src/index.js')}`);
  } else {
    console.log(`  ${C('1.')} Sunucuyu başlatın:`);
    console.log(`     ${C('node src/index.js')}  ${D('veya')}  ${C('start.bat')}`);
  }
  console.log();

  console.log(`  ${C('2.')} WhatsApp Webhook yapılandırması:`);
  console.log(`     Meta Developer Console → WhatsApp → Configuration → Webhook`);
  console.log(`     ${D('Callback URL  :')}`);
  console.log(`       ${C(`https://ALAN-ADINIZ:${cfg.PORT}/webhook`)}`);
  console.log(`     ${D('Verify Token  :')}`);
  console.log(`       ${C(cfg.WA_VERIFY_TOKEN)}`);
  console.log(`     ${D('Subscribe     :')} ${C('messages')}`);
  console.log();

  console.log(`  ${C('3.')} SAP'ta kullanıcı telefon numaralarını tanımlayın:`);
  console.log(`     Administration → Setup → General → Users`);
  console.log(`     Her kullanıcının ${C('Mobile Phone')} alanına WhatsApp numarasını girin`);
  console.log(`     Format: ${C('905XXXXXXXXX')} ${D('(ülke koduyla, + işareti olmadan)')}`);
  console.log();

  console.log(`  ${C('4.')} Müşteri ilgili kişilerini (OCPR) tanımlayın:`);
  console.log(`     Business Partners → ilgili kişi → İletişim Bilgileri → Cep Telefonu`);
  console.log();

  console.log(`  ${C('5.')} Yönetim paneline girin:`);
  console.log(`     ${C(`http://localhost:${cfg.PORT}/admin`)}`);
  console.log(`     Kullanıcı: ${C(cfg.ADMIN_USERNAME)}`);
  console.log();

  console.log(D('  ─────────────────────────────────────────────────'));
  console.log(D('  Not: HTTPS için sunucunuza bir reverse proxy'));
  console.log(D('  (nginx/IIS/Cloudflare Tunnel) kurmanız önerilir.'));
  console.log(D('  WhatsApp webhook HTTPS gerektirmektedir.'));
  console.log();

  rl.close();
}

main().catch(e => {
  console.error('\n' + R('  Beklenmeyen hata:'), e.message);
  rl.close();
  process.exit(1);
});
