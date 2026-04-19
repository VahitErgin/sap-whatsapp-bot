'use strict';

// ─────────────────────────────────────────────────────────────
// crmActivity.js  —  Adım adım wizard akışı
//
// 1. CRM intent → firma adı sor  (veya prefill'den atla)
// 2. Firma alındı → aktivite tipi LIST'i göster
// 3. Kullanıcı tipten tap eder  (ACT_TYPE:xxx)
// 4. Not sor
// 5. Not alındı → özet + Kaydet/İptal butonu
// 6. Kaydet → SAP Activities POST
//
// Claude API kullanılmaz.
// ─────────────────────────────────────────────────────────────

const config = require('../config/config');
const { getConnection }  = require('./sapClient');
const { resolveCardCode } = require('./sapDb');
const { sendText, sendButtons, sendList } = require('../services/whatsappService');

// ── Wizard durumu ─────────────────────────────────────────────
// phone10 → { step:'firm'|'note', session, dbName, cardName, cardCode, action, expiresAt }
const _wizard      = new Map();
const WIZARD_TTL   = 10 * 60 * 1000;

// ── Onay bekleme ──────────────────────────────────────────────
const _pendingActivity = new Map();
const PENDING_TTL      = 5 * 60 * 1000;

// Tüm aktivite tipleri
const ALL_TYPES = [
  { id: 'ACT_TYPE:Meeting',    label: 'Toplantı',  desc: 'Yüz yüze / online görüşme' },
  { id: 'ACT_TYPE:Phone Call', label: 'Telefon',   desc: 'Telefon görüşmesi'         },
  { id: 'ACT_TYPE:Task',       label: 'Görev',     desc: 'Yapılacak iş / hatırlatma' },
  { id: 'ACT_TYPE:Note',       label: 'Not',       desc: 'Genel not'                 },
  { id: 'ACT_TYPE:Email',      label: 'E-posta',   desc: 'E-posta yazışması'         },
];

// ─────────────────────────────────────────────────────────────
// Admin panel: OCLG / OCLS listesi (yönetim için)
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
// getWizardState — intentRouter'da mesajın wizard'a ait olup
//                  olmadığını kontrol eder
// ─────────────────────────────────────────────────────────────
function getWizardState(phone) {
  const k = _norm(phone);
  const e = _wizard.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { _wizard.delete(k); return null; }
  return e;
}

// ─────────────────────────────────────────────────────────────
// handleCreateActivity — CRM intent'in giriş noktası
// Prefill: ilk mesajdan firma/tip çıkarılabiliyorsa adım atla
// ─────────────────────────────────────────────────────────────
async function handleCreateActivity({ from, text, session, dbName }) {
  const prefill = _prefillFromText(text);

  if (prefill.cardName) {
    // Firma tespit edildi → tip seçimine geç
    const state = _newState(session, dbName);
    state.cardName = prefill.cardName;
    state.step     = 'type';
    _wizard.set(_norm(from), state);
    await _sendTypeList(from, prefill.cardName);
  } else {
    // Firma bilinmiyor → önce sor
    const state = _newState(session, dbName);
    state.step   = 'firm';
    _wizard.set(_norm(from), state);
    await sendText(from,
      `📝 *Aktivite Oluştur*\n\n` +
      `🏢 Firma veya kişi adını yazın:\n` +
      `_(Atlamak için * yazın)_`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// handleWizardInput — wizard içindeki metin mesajları
// ─────────────────────────────────────────────────────────────
async function handleWizardInput(from, text) {
  const state = getWizardState(from);
  if (!state) return;

  _refreshTTL(from, state);

  if (state.step === 'firm') {
    if (text.trim() !== '*') {
      state.cardName = text.trim();
      // CardCode çözümlemeyi dene (başarısız olsa da devam et)
      try {
        const resolved = await resolveCardCode({ cardName: state.cardName, dbName: state.dbName });
        if (resolved.found === 'one') {
          state.cardCode = resolved.record.CardCode;
          state.cardName = resolved.record.CardName;
        }
      } catch { /* yoksay */ }
    } else {
      state.cardName = '';
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
// handleWizardTypeSelection — ACT_TYPE:xxx list seçimi
// ─────────────────────────────────────────────────────────────
async function handleWizardTypeSelection(from, actionId) {
  const state = getWizardState(from);
  if (!state) return;

  state.action = actionId;
  state.step   = 'note';
  _refreshTTL(from, state);
  _wizard.set(_norm(from), state);

  const label = ALL_TYPES.find(t => t.id === `ACT_TYPE:${actionId}`)?.label || actionId;
  await sendText(from, `📋 *${label}* seçildi.\n\n📝 Aktivite notunu yazın:`);
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

function _newState(session, dbName) {
  return { session, dbName, cardName: '', cardCode: null, action: null, notes: '', expiresAt: Date.now() + WIZARD_TTL };
}

function _refreshTTL(from, state) {
  state.expiresAt = Date.now() + WIZARD_TTL;
  _wizard.set(_norm(from), state);
}

async function _sendTypeList(from, cardName) {
  const activeTypes = _getAdminTypes();
  const rows = (activeTypes.length
    ? ALL_TYPES.filter(t => activeTypes.some(at => t.label.toLowerCase().includes(at.toLowerCase()) || t.id.includes(at)))
    : ALL_TYPES
  ).map(t => ({ id: t.id, title: t.label, description: t.desc }));

  const header = cardName ? `🏢 *${cardName}*\n\nAktivite tipini seçin:` : 'Aktivite tipini seçin:';
  await sendList(from, '📋 Aktivite Tipi', header, 'Tip Seç', [{ title: 'Tipler', rows }]);
}

async function _showSummary(from, state) {
  const today = new Date().toISOString().split('T')[0];
  const activityData = {
    cardCode:     state.cardCode,
    cardName:     state.cardName,
    action:       state.action || 'Meeting',
    subjectCode:  null,
    notes:        state.notes,
    details:      '',
    activityDate: today,
    employeeId:   state.session.employeeId,
    userName:     state.session.userName,
  };

  const summary = [
    `👤 *Kullanıcı:* ${state.session.userName}`,
    state.cardName ? `🏢 *Muhatap:* ${state.cardName}` : '',
    `📋 *Tip:* ${activityData.action}`,
    `📅 *Tarih:* ${today}`,
    `📝 *Not:* ${activityData.notes}`,
  ].filter(Boolean).join('\n');

  _pendingActivity.set(_norm(from), { activityData, dbName: state.dbName, expiresAt: Date.now() + PENDING_TTL });

  await sendButtons(from, '✅ Aktivite Özeti', summary, [
    { id: 'ACT_SAVE',   title: '💾 Kaydet' },
    { id: 'ACT_CANCEL', title: '🚫 İptal'  },
  ]);
}

// İlk mesajdan firma/tip tahmin et
function _prefillFromText(text) {
  const t = text.toLowerCase();
  let action = null;
  if (/(toplantı|görüşme|ziyaret|buluştuk)/.test(t)) action = 'Meeting';
  else if (/(aradım|arama|telefon)/.test(t))          action = 'Phone Call';
  else if (/(görev|yapılacak)/.test(t))               action = 'Task';
  else if (/(mail|e-posta|eposta)/.test(t))           action = 'Email';

  let cardName = '';
  const m = text.match(/^(.+?)\s+ile\b/i);
  if (m) cardName = m[1].trim();

  return { cardName, action };
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

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

module.exports = {
  handleCreateActivity,
  handleWizardInput,
  handleWizardTypeSelection,
  getWizardState,
  confirmActivity,
  getActivityTypes,
  getActivitySubjects,
};
