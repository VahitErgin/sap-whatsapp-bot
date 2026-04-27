'use strict';

// ─────────────────────────────────────────────────────────────
// serviceCallWizard.js — Servis çağrısı oluşturma wizard'ı
//
// Adımlar:
//   1. customer  → Müşteri/CardCode
//   2. serial    → Seri numarası (opsiyonel)
//   3. description → Açıklama/belirti
//   4. priority  → Normal / Yüksek / Kritik
//   5. Özet → Kaydet / İptal
// ─────────────────────────────────────────────────────────────

const config = require('../config/config');
const { getConnection }   = require('./sapClient');
const { resolveCardCode } = require('./sapDb');
const { sendText, sendButtons, sendList } = require('../services/whatsappService');

const _wizard  = new Map();
const WIZ_TTL  = 10 * 60 * 1000;

const _pending  = new Map();
const PEND_TTL  = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Giriş noktası
// ─────────────────────────────────────────────────────────────
async function handleCreateServiceCall({ from, session, dbName }) {
  const state = {
    step:        'customer',
    session,
    dbName,
    cardCode:    null,
    cardName:    '',
    serialNo:    '',
    description: '',
    priority:    'scp_Normal',
    expiresAt:   Date.now() + WIZ_TTL,
  };
  _wizard.set(_norm(from), state);
  await sendText(from,
    `🔧 *Servis Çağrısı Oluştur*\n\n` +
    `🏢 Müşteri adı veya cari kodunu yazın:\n` +
    `_(Atlamak için * yazın)_`
  );
}

// ─────────────────────────────────────────────────────────────
// Metin mesajlarını işle
// ─────────────────────────────────────────────────────────────
async function handleServiceWizardInput(from, text) {
  const state = getServiceWizardState(from);
  if (!state) return;
  _refreshTTL(from, state);

  if (state.step === 'customer') {
    if (text.trim() === '*') {
      state.cardCode = null;
      state.cardName = '';
      return await _goToSerial(from, state);
    }
    const input = text.trim();
    await sendText(from, '🔍 Müşteri aranıyor...');

    const isCode = /^[A-Za-z]{1,6}\d+$/i.test(input);
    if (isCode) {
      try {
        const sl  = getConnection(state.dbName || config.sap.companyDb);
        const res = await sl.get(`BusinessPartners('${input.toUpperCase()}')`, { $select: 'CardCode,CardName' });
        if (res?.CardCode) {
          state.cardCode = res.CardCode;
          state.cardName = res.CardName;
          return await _goToSerial(from, state);
        }
      } catch { /* CardCode bulunamadı, isimle ara */ }
    }

    try {
      const resolved = await resolveCardCode({ cardName: input, dbName: state.dbName });
      if (resolved.found === 'one') {
        state.cardCode = resolved.record.CardCode;
        state.cardName = resolved.record.CardName;
        return await _goToSerial(from, state);
      } else if (resolved.found === 'many') {
        _wizard.set(_norm(from), state);
        return await _sendCustomerList(from, resolved.records);
      }
    } catch { /* yoksay */ }

    await sendText(from, `⚠️ *"${input}"* bulunamadı.\n\nTekrar deneyin veya * ile atlayın.`);

  } else if (state.step === 'serial') {
    if (text.trim() !== '*') state.serialNo = text.trim();
    await _goToDescription(from, state);

  } else if (state.step === 'description') {
    state.description = text.trim();
    await _askPriority(from, state);
  }
}

// ─────────────────────────────────────────────────────────────
// Buton / liste cevapları
// ─────────────────────────────────────────────────────────────
async function handleServiceCustomerSelection(from, cardCode, cardName) {
  const state = getServiceWizardState(from);
  if (!state) return;
  state.cardCode = cardCode;
  state.cardName = cardName;
  _refreshTTL(from, state);
  await _goToSerial(from, state);
}

async function handleServicePriority(from, priority) {
  const state = getServiceWizardState(from);
  if (!state) return;
  state.priority = priority;
  _wizard.delete(_norm(from));
  await _showSummary(from, state);
}

async function confirmServiceCall(from) {
  const pending = _pending.get(_norm(from));
  _pending.delete(_norm(from));

  if (!pending) {
    return await sendText(from, '⚠️ Kaydedilecek servis çağrısı bulunamadı.');
  }

  const { data, dbName } = pending;
  try {
    const sl      = getConnection(dbName || config.sap.companyDb);
    const payload = {
      Status:      -3,  // Açık
      Priority:    data.priority,
      Description: data.description,
      CreationDate: data.creationDate,
    };
    if (data.cardCode)  payload.CardCode          = data.cardCode;
    if (data.serialNo)  payload.InternalSerialNum = data.serialNo;
    if (data.employeeId) payload.HandledBy        = data.employeeId;

    const saved = await sl.post('ServiceCalls', payload);
    const callId = saved?.ServiceCallID || saved?.CallID || '—';

    await sendText(from,
      `✅ *Servis çağrısı oluşturuldu!*\n\n` +
      `🔢 Çağrı No: *${callId}*\n` +
      `🏢 ${data.cardName || '—'}\n` +
      `📝 ${data.description}\n` +
      `🚦 ${_priorityLabel(data.priority)}`
    );
    console.log(`[SVC] Çağrı oluşturuldu: #${callId} – ${data.cardName} – ${data.session.userName}`);

  } catch (err) {
    console.error('[SVC] Kayıt hatası:', err.message);
    await sendText(from, `⚠️ SAP'a kaydedilemedi: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// State erişimi
// ─────────────────────────────────────────────────────────────
function getServiceWizardState(from) {
  const k = _norm(from);
  const e = _wizard.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { _wizard.delete(k); return null; }
  return e;
}

// ─────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────
async function _goToSerial(from, state) {
  state.step = 'serial';
  _wizard.set(_norm(from), state);
  await sendButtons(from,
    '🔢 Seri Numarası',
    `${state.cardName ? `🏢 *${state.cardName}*\n\n` : ''}Cihaz/ürün seri numarasını yazın:`,
    [{ id: 'SVC_SERIAL:skip', title: '— Seri No Atla' }]
  );
}

async function _goToDescription(from, state) {
  state.step = 'description';
  _wizard.set(_norm(from), state);
  await sendText(from,
    `📝 *Arıza/Talep Açıklaması*\n\n` +
    `Sorun veya talebi kısaca yazın:`
  );
}

async function _askPriority(from, state) {
  state.step = 'priority';
  _wizard.set(_norm(from), state);
  await sendButtons(from,
    '🚦 Öncelik',
    `📝 *${state.description}*\n\nBu çağrının önceliği nedir?`,
    [
      { id: 'SVC_PRI:scp_Normal', title: '🟢 Normal'  },
      { id: 'SVC_PRI:scp_High',   title: '🟡 Yüksek'  },
      { id: 'SVC_PRI:scp_Urgent', title: '🔴 Kritik'  },
    ]
  );
}

async function _showSummary(from, state) {
  const today = new Date().toISOString().split('T')[0];
  const data  = {
    cardCode:    state.cardCode,
    cardName:    state.cardName,
    serialNo:    state.serialNo,
    description: state.description,
    priority:    state.priority,
    creationDate: today,
    employeeId:  state.session.employeeId,
    session:     state.session,
  };

  const summary = [
    `👤 *Ekleyen:* ${state.session.userName}`,
    state.cardName  ? `🏢 *Müşteri:* ${state.cardName}` : '',
    state.serialNo  ? `🔢 *Seri No:* ${state.serialNo}` : '',
    `📝 *Açıklama:* ${state.description}`,
    `🚦 *Öncelik:* ${_priorityLabel(state.priority)}`,
    `📅 *Tarih:* ${today}`,
  ].filter(Boolean).join('\n');

  _pending.set(_norm(from), { data, dbName: state.dbName, expiresAt: Date.now() + PEND_TTL });

  await sendButtons(from, '🔧 Servis Çağrısı Özeti', summary, [
    { id: 'SVC_SAVE',   title: '💾 Kaydet' },
    { id: 'SVC_CANCEL', title: '🚫 İptal'  },
  ]);
}

async function _sendCustomerList(from, records) {
  const rows = (records || []).slice(0, 10).map(r => ({
    id:          `SVC_CUST:${r.CardCode}|${String(r.CardName).substring(0, 60)}`,
    title:       r.CardCode,
    description: String(r.CardName).substring(0, 72),
  }));
  await sendList(from, '🔍 Müşteri Seçin', 'Birden fazla cari bulundu:', 'Seç',
    [{ title: 'Cariler', rows }]
  );
}

function _priorityLabel(p) {
  if (p === 'scp_High')   return '🟡 Yüksek';
  if (p === 'scp_Urgent') return '🔴 Kritik';
  return '🟢 Normal';
}

function _refreshTTL(from, state) {
  state.expiresAt = Date.now() + WIZ_TTL;
  _wizard.set(_norm(from), state);
}

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function cancelServiceWizard(from) {
  _wizard.delete(_norm(from));
  _pending.delete(_norm(from));
}

module.exports = {
  handleCreateServiceCall,
  handleServiceWizardInput,
  handleServiceCustomerSelection,
  handleServicePriority,
  getServiceWizardState,
  confirmServiceCall,
  cancelServiceWizard,
};
