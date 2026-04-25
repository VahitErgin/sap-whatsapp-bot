'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');
const config   = require('../config/config');
const { requireAuth }                      = require('./authMiddleware');
const { readApprovers, addApprover, removeApprover } = require('./approverService');
const { listTemplates, createTemplate, deleteTemplate } = require('./templateService');
const { getConnection, reinit: reinitSap }  = require('../modules/sapClient');
const { readEnv, updateEnv }               = require('./configService');
const { readLogs }                         = require('../services/logService');
const { readTasks, createTask, updateTask, deleteTask, TASK_TYPES } = require('../services/taskService');
const { getEdocConfig, saveEdocConfig } = require('../services/edocumentService');
const { getAllPrefs, setLang, deleteLang } = require('../services/langService');
const { testConnection: graphTestConnection } = require('../services/graphService');
const { getStats, addUser, updateUser, removeUser } = require('../services/userRegistry');
const { getLicenseInfo, importLicense, getFingerprint } = require('../services/licenseService');

const router  = express.Router();
const viewDir = path.join(__dirname, '../../public/admin');

// ─── Admin şifre dosyası ──────────────────────────────────────
const adminCfgFile = path.join(__dirname, '../../data/admin-config.json');

function getAdminCfg() {
  if (fs.existsSync(adminCfgFile)) {
    return JSON.parse(fs.readFileSync(adminCfgFile, 'utf8'));
  }
  // İlk çalışmada .env şifresini hash'le ve kaydet
  const cfg = {
    username:     config.admin.username,
    passwordHash: bcrypt.hashSync(config.admin.password, 10),
  };
  const dir = path.dirname(adminCfgFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(adminCfgFile, JSON.stringify(cfg, null, 2));
  return cfg;
}

function saveAdminCfg(cfg) {
  fs.writeFileSync(adminCfgFile, JSON.stringify(cfg, null, 2));
}

// ─────────────────────────────────────────────────────────────
// HTML Sayfaları
// ─────────────────────────────────────────────────────────────

router.get('/users', requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'users.html')));

router.get('/login', (req, res) => {
  if (req.session?.admin) return res.redirect('/admin');
  res.sendFile(path.join(viewDir, 'login.html'));
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/',          requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'dashboard.html')));
router.get('/approvers', requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'approvers.html')));
router.get('/templates', requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'templates.html')));
router.get('/settings',  requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'settings.html')));
router.get('/logs',      requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'logs.html')));
router.get('/tasks',     requireAuth, (req, res) => res.sendFile(path.join(viewDir, 'tasks.html')));

// ─────────────────────────────────────────────────────────────
// Kimlik Doğrulama
// ─────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const cfg = getAdminCfg();

  if (username === cfg.username && bcrypt.compareSync(password || '', cfg.passwordHash)) {
    req.session.admin    = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
});

// ─────────────────────────────────────────────────────────────
// API – Sistem Durumu
// ─────────────────────────────────────────────────────────────

router.get('/api/status', requireAuth, async (req, res) => {
  let sapStatus = 'ok';
  let sapDetail = '';

  try {
    const conn = getConnection(config.sap.companyDb);
    await conn.get('BusinessPartners', { $top: 1, $select: 'CardCode' });
  } catch (err) {
    sapStatus = 'error';
    sapDetail = err.message;
  }

  const dbList = config.sap.databases
    ? config.sap.databases.split(';').map(d => d.trim()).filter(Boolean)
    : [config.sap.companyDb];

  res.json({
    server:        'ok',
    sap:           sapStatus,
    sapDetail,
    approverCount: readApprovers().length,
    nodeVersion:   process.version,
    uptime:        Math.floor(process.uptime()),
    companyDb:     config.sap.companyDb,
    databases:     dbList,
  });
});

// ─────────────────────────────────────────────────────────────
// API – SAP Bağlantı Testi
// ─────────────────────────────────────────────────────────────

router.post('/api/test-sap', requireAuth, async (req, res) => {
  const { db } = req.body || {};
  try {
    const conn   = getConnection(db || config.sap.companyDb);
    const result = await conn.get('BusinessPartners', { $top: 1, $select: 'CardCode,CardName' });
    res.json({ ok: true, sample: result.value?.[0] || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Onay Yetkilileri
// ─────────────────────────────────────────────────────────────

router.get('/api/approvers', requireAuth, (req, res) => {
  res.json(readApprovers());
});

router.post('/api/approvers', requireAuth, (req, res) => {
  const { phone, name } = req.body || {};
  if (!phone || !name) return res.status(400).json({ error: 'Telefon ve isim zorunlu' });
  if (!/^\d{10,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Geçersiz telefon (ülke kodu dahil, + olmadan, 10-15 hane)' });
  }
  try {
    res.json(addApprover(phone.trim(), name.trim()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/approvers/:phone', requireAuth, (req, res) => {
  res.json(removeApprover(req.params.phone));
});

// ─────────────────────────────────────────────────────────────
// API – WhatsApp Şablonları
// ─────────────────────────────────────────────────────────────

router.get('/api/templates', requireAuth, async (req, res) => {
  try {
    res.json(await listTemplates());
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

router.post('/api/templates', requireAuth, async (req, res) => {
  try {
    res.json(await createTemplate(req.body));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

router.delete('/api/templates/:name', requireAuth, async (req, res) => {
  try {
    res.json(await deleteTemplate(req.params.name));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Uygulama Ayarları (WA token, API key vb.)
// ─────────────────────────────────────────────────────────────

router.get('/api/settings', requireAuth, (req, res) => {
  const env = readEnv();
  res.json({
    // SAP Service Layer
    SAP_SERVICE_LAYER_URL:   env.SAP_SERVICE_LAYER_URL    || '',
    SAP_COMPANY_DB:          env.SAP_COMPANY_DB            || '',
    SAP_DATABASES:           env.SAP_DATABASES             || '',
    SAP_USERNAME:            env.SAP_USERNAME              || '',
    SAP_PASSWORD_SET:        !!env.SAP_PASSWORD,
    // WhatsApp
    WA_PHONE_NUMBER_ID:      env.WA_PHONE_NUMBER_ID        || '',
    WA_VERIFY_TOKEN:         env.WA_VERIFY_TOKEN            || '',
    WA_ACCESS_TOKEN_SET:     !!env.WA_ACCESS_TOKEN,
    // SQL
    SAP_DB_TYPE:             env.SAP_DB_TYPE               || 'mssql',
    SAP_DB_SERVER:           env.SAP_DB_SERVER             || '',
    SAP_DB_PORT:             env.SAP_DB_PORT               || '',
    SAP_DB_NAME:             env.SAP_DB_NAME               || '',
    SAP_DB_USER:             env.SAP_DB_USER               || '',
    SAP_DB_PASSWORD_SET:     !!env.SAP_DB_PASSWORD,
    // API Keys
    ANTHROPIC_API_KEY_SET:   !!env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY_SET:      !!env.OPENAI_API_KEY,
    // CRM & Oturum
    SESSION_TIMEOUT_MINUTES: env.SESSION_TIMEOUT_MINUTES   || '480',
    CRM_ACTIVE_TYPES:        env.CRM_ACTIVE_TYPES          || '',
    CRM_ACTIVE_SUBJECTS:     env.CRM_ACTIVE_SUBJECTS       || '',
    ATTACHMENT_MAX_MB:       env.ATTACHMENT_MAX_MB         || '5',
    // Bildirim & Diğer
    SERVIS_NOTIF_TEMPLATE:   env.SERVIS_NOTIF_TEMPLATE     || '',
    STOCK_PRICE_LIST:        env.STOCK_PRICE_LIST           || '1',
    MAX_USERS:               env.MAX_USERS                  || '',
    // Admin
    ADMIN_USERNAME:          getAdminCfg().username        || 'admin',
  });
});

router.post('/api/settings', requireAuth, (req, res) => {
  const allowed = [
    'SAP_SERVICE_LAYER_URL', 'SAP_COMPANY_DB', 'SAP_DATABASES', 'SAP_USERNAME', 'SAP_PASSWORD',
    'WA_PHONE_NUMBER_ID', 'WA_VERIFY_TOKEN', 'WA_ACCESS_TOKEN',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
    'SAP_DB_TYPE', 'SAP_DB_SERVER', 'SAP_DB_PORT', 'SAP_DB_NAME', 'SAP_DB_USER', 'SAP_DB_PASSWORD',
    'SESSION_TIMEOUT_MINUTES', 'CRM_ACTIVE_TYPES', 'CRM_ACTIVE_SUBJECTS', 'ATTACHMENT_MAX_MB',
    'SERVIS_NOTIF_TEMPLATE', 'STOCK_PRICE_LIST',
  ];
  const sensitiveKeys = new Set(['WA_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SAP_PASSWORD', 'SAP_DB_PASSWORD']);
  const updates = {};
  for (const key of allowed) {
    if (sensitiveKeys.has(key)) {
      if (req.body[key]) updates[key] = req.body[key];
    } else if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Güncellenecek alan yok' });

  updateEnv(updates);

  // Runtime güncelle
  if (updates.SAP_SERVICE_LAYER_URL) config.sap.serviceLayerUrl = updates.SAP_SERVICE_LAYER_URL;
  if (updates.SAP_COMPANY_DB)        config.sap.companyDb       = updates.SAP_COMPANY_DB;
  if (updates.SAP_DATABASES !== undefined) config.sap.databases = updates.SAP_DATABASES || null;
  if (updates.SAP_USERNAME)          config.sap.username        = updates.SAP_USERNAME;
  if (updates.SAP_PASSWORD)          config.sap.password        = updates.SAP_PASSWORD;
  if (updates.WA_ACCESS_TOKEN)       config.whatsapp.accessToken   = updates.WA_ACCESS_TOKEN;
  if (updates.WA_PHONE_NUMBER_ID)    config.whatsapp.phoneNumberId = updates.WA_PHONE_NUMBER_ID;
  if (updates.WA_VERIFY_TOKEN)       config.whatsapp.verifyToken   = updates.WA_VERIFY_TOKEN;
  if (updates.ANTHROPIC_API_KEY)     config.anthropic.apiKey       = updates.ANTHROPIC_API_KEY;
  if (updates.SAP_DB_TYPE)           process.env.SAP_DB_TYPE       = updates.SAP_DB_TYPE;
  if (updates.SAP_DB_SERVER)         config.sapDb.server           = updates.SAP_DB_SERVER;
  if (updates.SAP_DB_PORT)           process.env.SAP_DB_PORT       = updates.SAP_DB_PORT;
  if (updates.SAP_DB_NAME)           config.sapDb.database         = updates.SAP_DB_NAME;
  if (updates.SAP_DB_USER)           config.sapDb.user             = updates.SAP_DB_USER;
  if (updates.SAP_DB_PASSWORD)       config.sapDb.password         = updates.SAP_DB_PASSWORD;
  if (updates.SESSION_TIMEOUT_MINUTES) process.env.SESSION_TIMEOUT_MINUTES = updates.SESSION_TIMEOUT_MINUTES;
  if (updates.CRM_ACTIVE_TYPES !== undefined)    process.env.CRM_ACTIVE_TYPES    = updates.CRM_ACTIVE_TYPES;
  if (updates.CRM_ACTIVE_SUBJECTS !== undefined) process.env.CRM_ACTIVE_SUBJECTS = updates.CRM_ACTIVE_SUBJECTS;
  if (updates.ATTACHMENT_MAX_MB !== undefined)   process.env.ATTACHMENT_MAX_MB   = updates.ATTACHMENT_MAX_MB;
  if (updates.SERVIS_NOTIF_TEMPLATE !== undefined) process.env.SERVIS_NOTIF_TEMPLATE = updates.SERVIS_NOTIF_TEMPLATE;
  if (updates.STOCK_PRICE_LIST !== undefined)      process.env.STOCK_PRICE_LIST      = updates.STOCK_PRICE_LIST;

  // SAP bağlantı bilgileri değiştiyse connection pool'u yenile
  const sapChanged = ['SAP_SERVICE_LAYER_URL','SAP_COMPANY_DB','SAP_DATABASES','SAP_USERNAME','SAP_PASSWORD'].some(k => k in updates);
  if (sapChanged) reinitSap();

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// API – Zamanlanmış Görevler
// ─────────────────────────────────────────────────────────────
router.get('/api/tasks', requireAuth, (req, res) => {
  res.json({ tasks: readTasks(), types: TASK_TYPES });
});

router.post('/api/tasks', requireAuth, (req, res) => {
  try {
    res.json(createTask(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    res.json(updateTask(req.params.id, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    res.json(deleteTask(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – E-Belge Entegrasyonu
// ─────────────────────────────────────────────────────────────
router.get('/api/edoc-settings', requireAuth, (_req, res) => {
  res.json(getEdocConfig());
});

router.post('/api/edoc-settings', requireAuth, (req, res) => {
  const { efatura, earsiv, eirsaliye } = req.body || {};
  saveEdocConfig({
    efatura:   (efatura   || '').trim(),
    earsiv:    (earsiv    || '').trim(),
    eirsaliye: (eirsaliye || '').trim(),
  });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// API – Dil Tercihleri
// ─────────────────────────────────────────────────────────────
router.get('/api/lang-settings', requireAuth, (_req, res) => {
  res.json(getAllPrefs());
});

router.post('/api/lang-settings', requireAuth, (req, res) => {
  const { phone, lang } = req.body || {};
  if (!phone || !lang) return res.status(400).json({ error: 'phone ve lang zorunlu' });
  setLang(phone, lang);
  res.json({ ok: true });
});

router.delete('/api/lang-settings/:phone', requireAuth, (req, res) => {
  deleteLang(req.params.phone);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// API – Kullanıcı Kayıt Defteri
// ─────────────────────────────────────────────────────────────
router.get('/api/users', requireAuth, (_req, res) => {
  res.json(getStats());
});

router.post('/api/users', requireAuth, (req, res) => {
  const { phone, name } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Telefon numarası zorunlu' });
  try {
    res.json(addUser({ phone, name }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/users/:phone', requireAuth, (req, res) => {
  try {
    res.json(updateUser(req.params.phone, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/users/:phone', requireAuth, (req, res) => {
  try {
    res.json(removeUser(req.params.phone));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Lisans
// ─────────────────────────────────────────────────────────────
router.get('/api/license', requireAuth, (_req, res) => {
  res.json({ ...getLicenseInfo(), fingerprint: getFingerprint() });
});

router.post('/api/license', requireAuth, (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Lisans içeriği (base64) zorunlu' });
  try {
    const payload = importLicense(content.trim());
    res.json({ ok: true, payload });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Microsoft Graph / Outlook Takvim
// ─────────────────────────────────────────────────────────────
router.get('/api/graph-settings', requireAuth, (_req, res) => {
  res.json({
    GRAPH_ENABLED:      process.env.GRAPH_ENABLED      === 'true',
    GRAPH_TENANT_ID:    process.env.GRAPH_TENANT_ID    || '',
    GRAPH_CLIENT_ID:    process.env.GRAPH_CLIENT_ID    || '',
    GRAPH_SECRET_SET:   !!(process.env.GRAPH_CLIENT_SECRET || ''),
    GRAPH_USER_DOMAIN:  process.env.GRAPH_USER_DOMAIN  || '',
  });
});

router.post('/api/graph-settings', requireAuth, (req, res) => {
  const { GRAPH_ENABLED, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_USER_DOMAIN } = req.body || {};
  const updates = {};
  if (GRAPH_ENABLED    !== undefined)        updates.GRAPH_ENABLED      = GRAPH_ENABLED ? 'true' : 'false';
  if (GRAPH_TENANT_ID  !== undefined)        updates.GRAPH_TENANT_ID    = GRAPH_TENANT_ID;
  if (GRAPH_CLIENT_ID  !== undefined)        updates.GRAPH_CLIENT_ID    = GRAPH_CLIENT_ID;
  if (GRAPH_CLIENT_SECRET)                   updates.GRAPH_CLIENT_SECRET = GRAPH_CLIENT_SECRET;
  if (GRAPH_USER_DOMAIN !== undefined)       updates.GRAPH_USER_DOMAIN  = GRAPH_USER_DOMAIN;

  updateEnv(updates);
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;

  res.json({ ok: true });
});

router.post('/api/graph-test', requireAuth, async (_req, res) => {
  try {
    const result = await graphTestConnection();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Mesaj Logları
// ─────────────────────────────────────────────────────────────
router.get('/api/logs', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const from  = req.query.from || today;
  const to    = req.query.to   || today;
  try {
    const entries = readLogs(from, to);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – SQL DB Bağlantı Testi
// ─────────────────────────────────────────────────────────────
router.post('/api/test-sqldb', requireAuth, async (req, res) => {
  try {
    const { getCariEkstre } = require('../modules/sapDb');
    // Basit test: rastgele bir cari kodu ile bağlantıyı dene
    await getCariEkstre({ cardCode: 'TEST_PING', refDate: new Date().toISOString().split('T')[0] });
    res.json({ ok: true });
  } catch (err) {
    // Bağlantı kurulduysa ama cari bulunamadıysa yine başarılı say
    const connected = !err.message.includes('ECONNREFUSED') && !err.message.includes('Login failed');
    res.json({ ok: connected, error: connected ? null : err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// API – Şifre Değiştir
// ─────────────────────────────────────────────────────────────

router.post('/api/change-admin-username', requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: 'Kullanıcı adı en az 2 karakter olmalı' });
  }
  const cfg = getAdminCfg();
  cfg.username = username.trim();
  saveAdminCfg(cfg);
  res.json({ ok: true });
});

router.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const cfg = getAdminCfg();

  if (!bcrypt.compareSync(currentPassword || '', cfg.passwordHash)) {
    return res.status(400).json({ error: 'Mevcut şifre hatalı' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Yeni şifre en az 4 karakter olmalı' });
  }

  cfg.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveAdminCfg(cfg);
  res.json({ ok: true });
});

module.exports = router;
