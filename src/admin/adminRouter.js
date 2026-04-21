'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');
const config   = require('../config/config');
const { requireAuth }                      = require('./authMiddleware');
const { readApprovers, addApprover, removeApprover } = require('./approverService');
const { listTemplates, createTemplate, deleteTemplate } = require('./templateService');
const { getConnection }                    = require('../modules/sapClient');
const { readEnv, updateEnv }               = require('./configService');
const { readLogs }                         = require('../services/logService');

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
    WA_PHONE_NUMBER_ID:      env.WA_PHONE_NUMBER_ID      || '',
    WA_VERIFY_TOKEN:         env.WA_VERIFY_TOKEN          || '',
    WA_ACCESS_TOKEN_SET:     !!env.WA_ACCESS_TOKEN,
    ANTHROPIC_API_KEY_SET:   !!env.ANTHROPIC_API_KEY,
    SAP_DB_SERVER:           env.SAP_DB_SERVER            || '',
    SAP_DB_NAME:             env.SAP_DB_NAME              || '',
    SAP_DB_USER:             env.SAP_DB_USER              || '',
    SAP_DB_PASSWORD_SET:     !!env.SAP_DB_PASSWORD,
    SESSION_TIMEOUT_MINUTES: env.SESSION_TIMEOUT_MINUTES  || '480',
    CRM_ACTIVE_TYPES:        env.CRM_ACTIVE_TYPES         || '',
    CRM_ACTIVE_SUBJECTS:     env.CRM_ACTIVE_SUBJECTS      || '',
  });
});

router.post('/api/settings', requireAuth, (req, res) => {
  const allowed = [
    'WA_PHONE_NUMBER_ID', 'WA_VERIFY_TOKEN', 'WA_ACCESS_TOKEN', 'ANTHROPIC_API_KEY',
    'SAP_DB_SERVER', 'SAP_DB_NAME', 'SAP_DB_USER', 'SAP_DB_PASSWORD',
    'SESSION_TIMEOUT_MINUTES', 'CRM_ACTIVE_TYPES', 'CRM_ACTIVE_SUBJECTS',
  ];
  const updates = {};
  for (const key of allowed) {
    // Şifre/token alanları: boş gelirse atla; diğerleri: boş string de kaydedilebilir (örn. CRM_ACTIVE_SUBJECTS)
    const sensitiveKeys = ['WA_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'SAP_DB_PASSWORD'];
    if (sensitiveKeys.includes(key)) {
      if (req.body[key]) updates[key] = req.body[key];
    } else if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Güncellenecek alan yok' });

  updateEnv(updates);

  // Runtime güncelle (yeniden başlatma gerektirmez)
  if (updates.WA_ACCESS_TOKEN)        config.whatsapp.accessToken   = updates.WA_ACCESS_TOKEN;
  if (updates.WA_PHONE_NUMBER_ID)     config.whatsapp.phoneNumberId = updates.WA_PHONE_NUMBER_ID;
  if (updates.WA_VERIFY_TOKEN)        config.whatsapp.verifyToken   = updates.WA_VERIFY_TOKEN;
  if (updates.ANTHROPIC_API_KEY)      config.anthropic.apiKey       = updates.ANTHROPIC_API_KEY;
  if (updates.SAP_DB_SERVER)          config.sapDb.server           = updates.SAP_DB_SERVER;
  if (updates.SAP_DB_NAME)            config.sapDb.database         = updates.SAP_DB_NAME;
  if (updates.SAP_DB_USER)            config.sapDb.user             = updates.SAP_DB_USER;
  if (updates.SAP_DB_PASSWORD)        config.sapDb.password         = updates.SAP_DB_PASSWORD;
  if (updates.SESSION_TIMEOUT_MINUTES) process.env.SESSION_TIMEOUT_MINUTES = updates.SESSION_TIMEOUT_MINUTES;
  if (updates.CRM_ACTIVE_TYPES !== undefined)    process.env.CRM_ACTIVE_TYPES    = updates.CRM_ACTIVE_TYPES;
  if (updates.CRM_ACTIVE_SUBJECTS !== undefined) process.env.CRM_ACTIVE_SUBJECTS = updates.CRM_ACTIVE_SUBJECTS;

  res.json({ ok: true });
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
