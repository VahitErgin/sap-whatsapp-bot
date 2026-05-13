'use strict';

/**
 * activityUpdater.js
 *
 * Mevcut aktivitelerin durum (OCLA) ve not güncellemesi.
 *
 * Adımlar:
 *   1. actSelect  → son aktiviteler listelenir (veya ACT_UPD:docEntry ile direkt atlanır)
 *   2. statSelect → OCLA durum listesi
 *   3. noteInput  → opsiyonel açıklama (mevcut Notes üzerine eklenir)
 *   4. Kaydet     → PATCH /Activities(docEntry)
 */

const { sendText, sendButtons, sendList } = require('../services/whatsappService');
const { getOclaStatuses } = require('./sapDb');
const { getConnection } = require('./sapClient');
const config = require('../config/config');

const TTL = 10 * 60 * 1000;
const _state = new Map();

function _norm(phone) { return String(phone || '').replace(/\D/g, '').slice(-10); }

function hasUpdWizard(phone) { return _state.has(_norm(phone)); }

function cancelUpdWizard(phone) { _state.delete(_norm(phone)); }

// ─── Başlat ────────────────────────────────────────────────────────
async function startUpdateWizard(phone, user, session) {
  const k = _norm(phone);
  _state.set(k, {
    step:      'actSelect',
    user,
    session,
    expiresAt: Date.now() + TTL,
  });
  await _showActivities(phone, k, user, session);
}

// ─── Buton cevapları ────────────────────────────────────────────────
async function handleUpdButton(phone, btnId, user, session) {
  const k  = _norm(phone);
  const st = _state.get(k);

  // ACT_UPD:docEntry — wizard dışından da gelebilir (direkt aktivite seçimi)
  if (btnId.startsWith('ACT_UPD:')) {
    const docEntry = btnId.slice('ACT_UPD:'.length).trim();
    if (!_state.has(k)) {
      _state.set(k, { step: 'actSelect', user, session, expiresAt: Date.now() + TTL });
    }
    return _onActSelect(phone, k, _state.get(k), docEntry, session);
  }

  if (!st || st.expiresAt < Date.now()) { _state.delete(k); return false; }
  st.expiresAt = Date.now() + TTL;

  if (btnId.startsWith('ACT_STAT:'))    return _onStatSelect(phone, k, st, btnId.slice('ACT_STAT:'.length));
  if (btnId === 'ACT_NOTE_SKIP')         return _doSave(phone, k, st, session);
  if (btnId === 'ACT_UPD_CANCEL')        { _state.delete(k); await sendText(phone, '❌ Güncelleme iptal edildi.'); return true; }

  return false;
}

// ─── Metin girişi ────────────────────────────────────────────────────
async function handleUpdText(phone, text, session) {
  const k  = _norm(phone);
  const st = _state.get(k);
  if (!st || st.expiresAt < Date.now()) { _state.delete(k); return false; }

  if (/^(iptal|vazgeç|vazgec|cancel|çıkış|dur|kapat)$/i.test(text.trim())) {
    _state.delete(k);
    await sendText(phone, '❌ Güncelleme iptal edildi.');
    return true;
  }

  if (st.step === 'noteInput') return _onNoteText(phone, k, st, text, session);
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// ADIMLAR
// ═══════════════════════════════════════════════════════════════════

async function _showActivities(phone, k, user, session) {
  const sl = getConnection(user.dbName || config.sap.companyDb);

  // Sadece açık görev tipi aktiviteler; varsa employee bazlı filtre
  let filter = "Closed eq 'tNO' and Activity eq 'cn_Task'";
  if (session?.employeeId) filter += ` and HandledBy eq ${session.employeeId}`;

  let acts = [];
  try {
    const res = await sl.get('Activities', {
      '$filter':  filter,
      '$orderby': 'DocEntry desc',
      '$top':     '8',
    });
    acts = res?.value || [];
  } catch (err) {
    await sendText(phone, `⚠️ Aktiviteler alınamadı: ${err.message}`);
    _state.delete(k);
    return;
  }

  if (!acts.length) {
    await sendText(phone, '📋 Güncel açık aktivite bulunamadı.');
    _state.delete(k);
    return;
  }

  const st = _state.get(k);
  st.activities = acts;
  _state.set(k, st);

  // DocEntry yoksa ActivityCode'a düş (SAP SL bazı sürümlerde farklı key döner)
  const seen = new Set();
  const rows = acts
    .map((a, i) => {
      const key = a.DocEntry ?? a.ActivityCode ?? i;
      return {
        id:          `ACT_UPD:${key}`,
        title:       `#${key} ${(a.CardCode || '—')}`.substring(0, 24),
        description: (a.Notes || '').slice(0, 72),
      };
    })
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  await sendList(phone, '📋 Aktivite Güncelle',
    'Durumunu güncellemek istediğiniz aktiviteyi seçin:',
    'Seç', [{ title: 'Son Aktiviteler', rows }]
  );
}

async function _onActSelect(phone, k, st, docEntry, _session) {
  st.docEntry    = docEntry;
  st.currentNotes = (st.activities || []).find(a => String(a.DocEntry) === String(docEntry))?.Notes || '';
  st.step = 'statSelect';
  _state.set(k, st);

  // OCLA durum listesi
  let statuses = [];
  try {
    statuses = await getOclaStatuses({ dbName: st.user?.dbName });
  } catch (err) {
    await sendText(phone, `⚠️ Durum listesi alınamadı: ${err.message}`);
    return true;
  }

  if (!statuses.length) {
    await sendText(phone, '⚠️ OCLA tablosunda tanımlı durum bulunamadı.');
    _state.delete(k);
    return true;
  }

  st.statuses = statuses;
  _state.set(k, st);

  const rows = statuses.slice(0, 10).map(s => ({
    id:          `ACT_STAT:${s.Code}`,
    title:       String(s.Name).slice(0, 24),
    description: '',
  }));

  await sendList(phone, '📊 Durum Seçimi',
    `Aktivite *#${docEntry}* için yeni durum:`,
    'Seç', [{ title: 'Durumlar', rows }]
  );
  return true;
}

async function _onStatSelect(phone, k, st, code) {
  const found = (st.statuses || []).find(s => String(s.Code) === String(code));
  st.newStatus     = Number(code);
  st.newStatusName = found?.Name || code;
  st.step = 'noteInput';
  _state.set(k, st);

  await sendButtons(phone, '📝 Not Ekle',
    `Durum: *${st.newStatusName}*\n\n` +
    `İsteğe bağlı açıklama girin (önceki nota eklenir):\n_ya da Atla butonuna basın_`,
    [
      { id: 'ACT_NOTE_SKIP',   title: '⏭️ Atla'   },
      { id: 'ACT_UPD_CANCEL',  title: '❌ İptal'  },
    ]
  );
  return true;
}

async function _onNoteText(phone, k, st, text, session) {
  st.appendNote = text.trim();
  return _doSave(phone, k, st, session);
}

async function _doSave(phone, k, st, session) {
  try {
    const sl = getConnection(st.user?.dbName || config.sap.companyDb);

    // Güncel Notes'u SAP'tan çek (arada değişmiş olabilir)
    let currentNotes = st.currentNotes || '';
    try {
      const live = await sl.getOne('Activities', st.docEntry);
      currentNotes = live?.Notes ?? currentNotes;
    } catch { /* mevcut değeri kullan */ }

    const patch = { Status: st.newStatus };

    if (st.appendNote) {
      const ts   = new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      const name = st.user?.name || session?.userName || 'WhatsApp';
      patch.Notes = (currentNotes ? currentNotes + '\n' : '') +
                    `[${ts} – ${name}] ${st.appendNote}`;
    }

    await sl.patch('Activities', st.docEntry, patch);
    _state.delete(k);

    await sendText(phone,
      `✅ Aktivite güncellendi!\n\n` +
      `📋 #${st.docEntry}\n` +
      `📊 Durum: *${st.newStatusName}*` +
      (st.appendNote ? `\n📝 Not eklendi.` : '')
    );
  } catch (err) {
    console.error('[ActUpdater] Güncelleme hatası:', err.message);
    _state.delete(k);
    await sendText(phone, `❌ Güncellenemedi: ${err.message}`);
  }
  return true;
}

module.exports = { hasUpdWizard, cancelUpdWizard, startUpdateWizard, handleUpdButton, handleUpdText };
