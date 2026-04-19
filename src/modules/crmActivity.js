'use strict';

// ─────────────────────────────────────────────────────────────
// crmActivity.js  —  Adım adım wizard akışı
//
// 1. firma adı
// 2. aktivite tipi  (Toplantı/Telefon/...)   ACT_TYPE:xxx
// 3. tür            (OCLG)                   ACT_CAT:xxx
// 4. konu           (OCLS)                   ACT_SUB:xxx
// 5. not metni
// 6. özet → Kaydet / İptal
//
// Claude API kullanılmaz.
// ─────────────────────────────────────────────────────────────

const config = require('../config/config');
const { getConnection }  = require('./sapClient');
const { resolveCardCode } = require('./sapDb');
const { sendText, sendButtons, sendList } = require('../services/whatsappService');

// ── Wizard durumu ─────────────────────────────────────────────
const _wizard    = new Map();
const WIZARD_TTL = 10 * 60 * 1000;

// ── Onay bekleme ──────────────────────────────────────────────
const _pendingActivity = new Map();
const PENDING_TTL      = 5 * 60 * 1000;

// Aktivite tipi listesi (Activity enum)
const ALL_TYPES = [
  { id: 'ACT_TYPE:Meeting',    label: 'Toplantı',  desc: 'Yüz yüze / online görüşme' },
  { id: 'ACT_TYPE:Phone Call', label: 'Telefon',   desc: 'Telefon görüşmesi'         },
  { id: 'ACT_TYPE:Task',       label: 'Görev',     desc: 'Yapılacak iş / hatırlatma' },
  { id: 'ACT_TYPE:Note',       label: 'Not',       desc: 'Genel not'                 },
  { id: 'ACT_TYPE:Email',      label: 'E-posta',   desc: 'E-posta yazışması'         },
];

// ─────────────────────────────────────────────────────────────
// Admin panel: OCLG / OCLS listeleri
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
// getWizardState — intentRouter'da kontrol için
// ─────────────────────────────────────────────────────────────
function getWizardState(phone) {
  const k = _norm(phone);
  const e = _wizard.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { _wizard.delete(k); return null; }
  return e;
}

// ─────────────────────────────────────────────────────────────
// handleCreateActivity — CRM intent giriş noktası
// ─────────────────────────────────────────────────────────────
async function handleCreateActivity({ from, text, session, dbName }) {
  // SAP'tan tür ve konu listelerini önceden çek
  const [actTypes, actSubjects] = await Promise.all([
    getActivityTypes(dbName).catch(() => []),
    getActivitySubjects(dbName).catch(() => []),
  ]);

  const prefill = _prefillFromText(text);
  const state   = {
    step:        'firm',
    session,
    dbName,
    cardName:    '',
    cardCode:    null,
    action:      null,
    activityType: null,
    subjectCode:  null,
    notes:        '',
    actTypes,    // OCLG kayıtları
    actSubjects, // OCLS kayıtları
    expiresAt:   Date.now() + WIZARD_TTL,
  };

  if (prefill.cardName) {
    state.cardName = prefill.cardName;
    state.step     = 'type';
    _wizard.set(_norm(from), state);
    await _sendTypeList(from, prefill.cardName);
  } else {
    _wizard.set(_norm(from), state);
    await sendText(from,
      `📝 *Aktivite Oluştur*\n\n` +
      `🏢 Firma veya kişi adını yazın:\n` +
      `_(Atlamak için * yazın)_`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// handleWizardInput — wizard içindeki metin mesajları (firm, note)
// ─────────────────────────────────────────────────────────────
async function handleWizardInput(from, text) {
  const state = getWizardState(from);
  if (!state) return;
  _refreshTTL(from, state);

  if (state.step === 'firm') {
    if (text.trim() !== '*') {
      state.cardName = text.trim();
      try {
        const resolved = await resolveCardCode({ cardName: state.cardName, dbName: state.dbName });
        if (resolved.found === 'one') {
          state.cardCode = resolved.record.CardCode;
          state.cardName = resolved.record.CardName;
        }
      } catch { /* yoksay */ }
    }
    state.step = 'type';
    _wizard.set(_norm(from), state);
    await _sendTypeList(from, state.cardName);

  } else if (state.step === 'note') {
    state.notes = text.trim();
    _wizard.delete(_norm(from));
    await _showSummary(from, state);
  }
}

// ─────────────────────────────────────────────────────────────
// handleWizardTypeSelection — ACT_TYPE:xxx
// ─────────────────────────────────────────────────────────────
async function handleWizardTypeSelection(from, actionId) {
  const state = getWizardState(from);
  if (!state) return;

  state.action = actionId;
  _refreshTTL(from, state);

  if (state.actTypes.length > 0) {
    state.step = 'category';
    _wizard.set(_norm(from), state);
    await _sendCategoryList(from, state.actTypes);
  } else {
    // Tür yok → konu adımına geç
    await _nextAfterCategory(from, state);
  }
}

// ─────────────────────────────────────────────────────────────
// handleWizardCategorySelection — ACT_CAT:xxx  (OCLG)
// ─────────────────────────────────────────────────────────────
async function handleWizardCategorySelection(from, code) {
  const state = getWizardState(from);
  if (!state) return;

  if (code !== 'skip') state.activityType = code;
  _refreshTTL(from, state);
  await _nextAfterCategory(from, state);
}

async function _nextAfterCategory(from, state) {
  if (state.actSubjects.length > 0) {
    state.step = 'subject';
    _wizard.set(_norm(from), state);
    await _sendSubjectList(from, state.actSubjects);
  } else {
    state.step = 'note';
    _wizard.set(_norm(from), state);
    await sendText(from, `📝 Aktivite notunu yazın:`);
  }
}

// ─────────────────────────────────────────────────────────────
// handleWizardSubjectSelection — ACT_SUB:xxx  (OCLS)
// ─────────────────────────────────────────────────────────────
async function handleWizardSubjectSelection(from, code) {
  const state = getWizardState(from);
  if (!state) return;

  if (code !== 'skip') state.subjectCode = code;
  state.step = 'note';
  _refreshTTL(from, state);
  _wizard.set(_norm(from), state);
  await sendText(from, `📝 Aktivite notunu yazın:`);
}

// ─────────────────────────────────────────────────────────────
// confirmActivity — Kaydet butonu
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
      Activity:     _actionEnum(activityData.action),
      ActivityDate: activityData.activityDate,
      Notes:        activityData.notes,
    };

    if (activityData.cardCode)     payload.CardCode         = activityData.cardCode;
    if (activityData.activityType) payload.ActivityType     = Number(activityData.activityType);
    if (activityData.subjectCode)  payload.ActivitySubject  = Number(activityData.subjectCode);
    if (activityData.employeeId)   payload.HandledBy        = activityData.employeeId;

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

async function _sendTypeList(from, cardName) {
  const activeTypes = _getAdminTypes();
  const rows = (activeTypes.length
    ? ALL_TYPES.filter(t => activeTypes.some(at => t.label.toLowerCase().includes(at.toLowerCase()) || t.id.includes(at)))
    : ALL_TYPES
  ).map(t => ({ id: t.id, title: t.label, description: t.desc }));

  const header = cardName ? `🏢 *${cardName}*\n\nAktivite tipini seçin:` : 'Aktivite tipini seçin:';
  await sendList(from, '📋 Aktivite Tipi', header, 'Tip Seç', [{ title: 'Tipler', rows }]);
}

async function _sendCategoryList(from, actTypes) {
  const rows = [
    { id: 'ACT_CAT:skip', title: '— Atla —', description: 'Tür seçmeden devam et' },
    ...actTypes.slice(0, 9).map(t => ({
      id:          `ACT_CAT:${t.Code}`,
      title:       t.Name,
      description: t.Code,
    })),
  ];
  await sendList(from, '🗂 Tür Seçin', 'Aktivite türünü seçin:', 'Tür Seç', [{ title: 'Türler', rows }]);
}

async function _sendSubjectList(from, subjects) {
  const rows = [
    { id: 'ACT_SUB:skip', title: '— Atla —', description: 'Konu seçmeden devam et' },
    ...subjects.slice(0, 9).map(s => ({
      id:          `ACT_SUB:${s.Code}`,
      title:       s.Name,
      description: String(s.Code),
    })),
  ];
  await sendList(from, '📌 Konu Seçin', 'Aktivite konusunu seçin:', 'Konu Seç', [{ title: 'Konular', rows }]);
}

async function _showSummary(from, state) {
  const today = new Date().toISOString().split('T')[0];
  const catName = state.activityType
    ? (state.actTypes.find(t => String(t.Code) === String(state.activityType))?.Name || state.activityType)
    : null;
  const subName = state.subjectCode
    ? (state.actSubjects.find(s => String(s.Code) === String(state.subjectCode))?.Name || state.subjectCode)
    : null;

  const activityData = {
    cardCode:     state.cardCode,
    cardName:     state.cardName,
    action:       state.action || 'Meeting',
    activityType: state.activityType,
    subjectCode:  state.subjectCode,
    notes:        state.notes,
    activityDate: today,
    employeeId:   state.session.employeeId,
    userName:     state.session.userName,
  };

  const summary = [
    `👤 *Kullanıcı:* ${state.session.userName}`,
    state.cardName ? `🏢 *Muhatap:* ${state.cardName}` : '',
    `📋 *Tip:* ${activityData.action}`,
    catName  ? `🗂 *Tür:* ${catName}`   : '',
    subName  ? `📌 *Konu:* ${subName}`  : '',
    `📅 *Tarih:* ${today}`,
    `📝 *Not:* ${activityData.notes}`,
  ].filter(Boolean).join('\n');

  _pendingActivity.set(_norm(from), { activityData, dbName: state.dbName, expiresAt: Date.now() + PENDING_TTL });

  await sendButtons(from, '✅ Aktivite Özeti', summary, [
    { id: 'ACT_SAVE',   title: '💾 Kaydet' },
    { id: 'ACT_CANCEL', title: '🚫 İptal'  },
  ]);
}

function _prefillFromText(text) {
  let cardName = '';
  const m = text.match(/^(.+?)\s+ile\b/i);
  if (m) cardName = m[1].trim();
  return { cardName };
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

function _getAdminTypes() {
  try {
    const raw = process.env.CRM_ACTIVE_TYPES || '';
    return raw ? raw.split(',').map(t => t.trim()) : [];
  } catch { return []; }
}

function _refreshTTL(from, state) {
  state.expiresAt = Date.now() + WIZARD_TTL;
  _wizard.set(_norm(from), state);
}

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

module.exports = {
  handleCreateActivity,
  handleWizardInput,
  handleWizardTypeSelection,
  handleWizardCategorySelection,
  handleWizardSubjectSelection,
  getWizardState,
  confirmActivity,
  getActivityTypes,
  getActivitySubjects,
};
