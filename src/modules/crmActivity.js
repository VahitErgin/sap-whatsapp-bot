'use strict';

// ─────────────────────────────────────────────────────────────
// crmActivity.js
//
// WhatsApp'tan CRM aktivitesi oluşturma — şablon tabanlı akış.
//
// 1. CRM intent → bot şablon gönderir (ön-doldurulmuş)
// 2. Kullanıcı düzenleyip gönderir
// 3. Bot parse eder → özet gösterir → Kaydet / İptal
// 4. Kaydet → SAP Activities POST
//
// Claude API kullanılmaz.
// ─────────────────────────────────────────────────────────────

const config = require('../config/config');
const { getConnection } = require('./sapClient');
const { resolveCardCode } = require('./sapDb');
const { sendText, sendButtons } = require('../services/whatsappService');

const _pendingActivity  = new Map();
const PENDING_TTL       = 5  * 60 * 1000;

const _awaitingTemplate = new Map();
const TEMPLATE_TTL      = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// SAP'tan aktif aktivite/konu listelerini getir (admin panel için)
// ─────────────────────────────────────────────────────────────
async function getActivityTypes(dbName) {
  const sl   = getConnection(dbName || config.sap.companyDb);
  const data = await sl.get('ActivityTypes', { '$orderby': 'Name' });
  return data?.value || [];
}

async function getActivitySubjects(dbName) {
  const sl   = getConnection(dbName || config.sap.companyDb);
  const data = await sl.get('ActivitySubjects', { '$orderby': 'Name' });
  return data?.value || [];
}

// ─────────────────────────────────────────────────────────────
// getAwaitingTemplate — intentRouter'da kontrol için
// ─────────────────────────────────────────────────────────────
function getAwaitingTemplate(phone) {
  const k = _norm(phone);
  const e = _awaitingTemplate.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { _awaitingTemplate.delete(k); return null; }
  return e;
}

// ─────────────────────────────────────────────────────────────
// Ana işleyici: CRM intent tetiklenince şablon gönder
// İlk mesajdan firma/tip/tarih bilgisi varsa ön-doldur
// ─────────────────────────────────────────────────────────────
async function handleCreateActivity({ from, text, session, dbName }) {
  const prefill = _prefillFromText(text);

  _awaitingTemplate.set(_norm(from), {
    session,
    dbName,
    expiresAt: Date.now() + TEMPLATE_TTL,
  });

  const subjects     = _getAdminSubjects();
  const subjectHint  = subjects.length
    ? `Konu: ${subjects.map(s => s.Name).join(' / ')}\n`
    : '';
  const typeHint     = _getAdminTypes().join(' / ') || 'Toplantı / Telefon / Görev / Not / Email';

  const tpl = [
    `📝 *Aktivite Oluştur*`,
    ``,
    `Aşağıdaki şablonu düzenleyip gönderin:`,
    ``,
    `Firma: ${prefill.cardName}`,
    `Tip: ${prefill.action}`,
    `Tarih: ${prefill.date}`,
    subjectHint ? `Konu: ` : '',
    `Not: ${prefill.notes}`,
    ``,
    `_Tip seçenekleri: ${typeHint}_`,
    subjects.length ? `_Konu seçenekleri: ${subjects.map(s => s.Name).join(', ')}_` : '',
    `_Tarih: bugün, dün, YYYY-MM-DD veya GG.MM.YYYY_`,
  ].filter(l => l !== null && l !== undefined).join('\n');

  await sendText(from, tpl);
}

// ─────────────────────────────────────────────────────────────
// Şablon doldurulmuş mesajı işle
// ─────────────────────────────────────────────────────────────
async function handleTemplateInput(from, text) {
  const entry = _awaitingTemplate.get(_norm(from));
  _awaitingTemplate.delete(_norm(from));

  if (!entry) return;
  const { session, dbName } = entry;

  const fields = _parseTemplate(text);

  if (!fields.not && !fields.firma) {
    return await sendText(from, '⚠️ Şablon anlaşılamadı. Lütfen "Not:" satırını doldurun ve tekrar gönderin.');
  }

  const today = new Date().toISOString().split('T')[0];

  // CardCode çözümle
  let cardCode = null;
  let cardName = fields.firma || '';
  if (cardName) {
    const resolved = await resolveCardCode({ cardName, dbName });
    if (resolved.found === 'one') {
      cardCode = resolved.record.CardCode;
      cardName = resolved.record.CardName;
    }
    // found='many' → cardCode null kalır, özet gösterilir, kullanıcı görecek
  }

  const activityDate = _parseDate(fields.tarih) || today;
  const action       = _mapAction(fields.tip) || 'Meeting';
  const subjectCode  = _findSubjectCode(fields.konu);

  const activityData = {
    cardCode,
    cardName,
    action,
    subjectCode,
    notes:        fields.not || text.trim(),
    details:      '',
    activityDate,
    employeeId:   session.employeeId,
    userName:     session.userName,
  };

  const summary = [
    `👤 *Kullanıcı:* ${session.userName}`,
    cardName ? `🏢 *Muhatap:* ${cardName}` : '',
    `📋 *Tip:* ${action}`,
    subjectCode ? `📌 *Konu:* ${fields.konu}` : '',
    `📅 *Tarih:* ${activityDate}`,
    `📝 *Not:* ${activityData.notes}`,
  ].filter(Boolean).join('\n');

  _pendingActivity.set(_norm(from), { activityData, dbName, expiresAt: Date.now() + PENDING_TTL });

  await sendButtons(from, '✅ Aktivite Özeti', summary, [
    { id: 'ACT_SAVE',   title: '💾 Kaydet' },
    { id: 'ACT_CANCEL', title: '🚫 İptal'  },
  ]);
}

// ─────────────────────────────────────────────────────────────
// Kaydet butonuna basıldı → SAP'a POST
// ─────────────────────────────────────────────────────────────
async function confirmActivity(from) {
  const pending = _pendingActivity.get(_norm(from));
  _pendingActivity.delete(_norm(from));

  if (!pending) {
    return await sendText(from, '⚠️ Kaydedilecek aktivite bulunamadı. Lütfen tekrar deneyin.');
  }

  const { activityData, dbName } = pending;

  try {
    const sl      = getConnection(dbName || config.sap.companyDb);
    const payload = {
      Activity:     'cn_Task',
      Action:       _actionEnum(activityData.action),
      ActivityDate: activityData.activityDate,
      Notes:        activityData.notes,
    };

    if (activityData.cardCode)    payload.CardCode        = activityData.cardCode;
    if (activityData.subjectCode) payload.ActivitySubject = Number(activityData.subjectCode);
    if (activityData.employeeId)  payload.HandledBy       = activityData.employeeId;

    await sl.post('Activities', payload);

    await sendText(from,
      `✅ *Aktivite kaydedildi!*\n\n` +
      `🏢 ${activityData.cardName || '—'}\n` +
      `📋 ${activityData.action} · ${activityData.activityDate}\n` +
      `📝 ${activityData.notes}`
    );
    console.log(`[CRM] Aktivite: ${activityData.userName} → ${activityData.cardName || '—'}`);

  } catch (err) {
    console.error('[CRM] Kayıt hatası:', err.message);
    await sendText(from, `⚠️ SAP'a kaydedilemedi: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────

// İlk mesajdan ön-dolgu çıkar (regex, Claude yok)
function _prefillFromText(text) {
  const t = text.toLowerCase();

  let action = 'Toplantı';
  if (/(telefon|aradım|arama|call)/.test(t))        action = 'Telefon';
  else if (/(görev|yapılacak|task)/.test(t))         action = 'Görev';
  else if (/(not|yazdım|kaydet)/.test(t))            action = 'Not';
  else if (/(mail|e-posta|eposta|email)/.test(t))    action = 'Email';

  // Firma: "X ile" kalıbı
  let cardName = '';
  const m = text.match(/^(.+?)\s+ile\b/i) || text.match(/\b([A-ZÇĞİÖŞÜ][a-zA-ZÇĞİÖŞÜçğışöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zA-ZÇĞİÖŞÜçğışöşü]{1,})*)\s+ile\b/i);
  if (m) cardName = m[1].trim();

  // Not: virgül sonrasındaki kısım
  const commaIdx = text.indexOf('.');
  const notes = commaIdx > 0 ? text.slice(commaIdx + 1).trim() : '';

  return { cardName, action, date: 'bugün', notes };
}

// "Firma: OKSİD\nTip: Toplantı\n..." → { firma, tip, tarih, konu, not }
function _parseTemplate(text) {
  const fields = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.substring(0, colon).trim().toLowerCase()
      .replace(/[^a-zçğışöşü]/g, '');
    const val = line.substring(colon + 1).trim();
    if (val) fields[key] = val;
  }
  return fields;
}

function _mapAction(val) {
  if (!val) return null;
  const v = val.toLowerCase();
  if (/(toplantı|meeting|görüşme|ziyaret)/.test(v))  return 'Meeting';
  if (/(telefon|phone|arama|call)/.test(v))           return 'Phone Call';
  if (/(görev|task)/.test(v))                         return 'Task';
  if (/(not|note)/.test(v))                           return 'Note';
  if (/(mail|email|e-posta|eposta)/.test(v))          return 'Email';
  return null;
}

function _parseDate(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  if (s === 'bugün' || s === 'today' || s === '')
    return new Date().toISOString().split('T')[0];
  if (s === 'dün' || s === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function _findSubjectCode(val) {
  if (!val) return null;
  const subjects = _getAdminSubjects();
  const v = val.toLowerCase().trim();
  const found = subjects.find(s => s.Name.toLowerCase() === v || s.Code.toLowerCase() === v);
  return found?.Code || null;
}

function _actionEnum(action) {
  const map = {
    'Phone Call': 'cn_Conversation',
    'Meeting':    'cn_Meeting',
    'Task':       'cn_Task',
    'Note':       'cn_Note',
    'Email':      'cn_EMail',
  };
  return map[action] || 'cn_Task';
}

function _getAdminSubjects() {
  try {
    const raw = process.env.CRM_ACTIVE_SUBJECTS || '';
    return raw ? raw.split(',').map(s => ({ Code: s.trim(), Name: s.trim() })) : [];
  } catch { return []; }
}

function _getAdminTypes() {
  try {
    const raw = process.env.CRM_ACTIVE_TYPES || '';
    return raw ? raw.split(',').map(t => t.trim()) : [];
  } catch { return []; }
}

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

module.exports = {
  handleCreateActivity,
  handleTemplateInput,
  getAwaitingTemplate,
  confirmActivity,
  getActivityTypes,
  getActivitySubjects,
};
