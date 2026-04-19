'use strict';

// ─────────────────────────────────────────────────────────────
// crmActivity.js
//
// WhatsApp'tan CRM aktivitesi oluşturma.
// Kullanıcı doğal dille yazar → Claude parse eder → SAP'a kaydeder.
// HandledBy = login olan SAP kullanıcısının employee ID'si
// ─────────────────────────────────────────────────────────────

const axios  = require('axios');
const config = require('../config/config');
const { getConnection } = require('./sapClient');
const { resolveCardCode } = require('./sapDb');
const { sendText, sendButtons } = require('../services/whatsappService');

// Onay bekleme: phone10 → { activityData, expiresAt }
const _pendingActivity = new Map();
const PENDING_TTL = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// SAP'tan aktif aktivite tiplerini getir (OCLG)
// Admin panelden filtrelenmiş liste veya tümü
// ─────────────────────────────────────────────────────────────
async function getActivityTypes(dbName) {
  const sl   = getConnection(dbName || config.sap.companyDb);
  const data = await sl.get('ActivityTypes', { '$orderby': 'Name' });
  return data?.value || [];
}

// OCLS - Konular
async function getActivitySubjects(dbName) {
  const sl   = getConnection(dbName || config.sap.companyDb);
  const data = await sl.get('ActivitySubjects', { '$orderby': 'Name' });
  return data?.value || [];
}

// ─────────────────────────────────────────────────────────────
// Claude ile doğal dil → aktivite alanları
// ─────────────────────────────────────────────────────────────
async function parseActivityFromText(text, activeTypes, activeSubjects) {
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `Sen SAP B1 CRM aktivite asistanısın.
Kullanıcının mesajından aktivite bilgilerini JSON olarak çıkar.

AKTİVİTE TİPLERİ (Action enum değerleri):
- "Phone Call" → telefon görüşmesi, arama
- "Meeting" → toplantı, görüşme, ziyaret
- "Task" → görev, yapılacak iş
- "Note" → not, hatırlatma
- "Email" → e-posta

KONU SEÇENEKLERİ (admin tanımlı):
${activeSubjects.length ? activeSubjects.map(s => `- ${s.Code}: ${s.Name}`).join('\n') : '- Genel'}

YANIT FORMATI (sadece JSON):
{
  "cardName": "firma veya kişi adı (varsa)",
  "action": "Phone Call | Meeting | Task | Note | Email",
  "subjectCode": "konu kodu (yoksa null)",
  "notes": "aktivite açıklaması / konuşulan konular",
  "activityDate": "YYYY-MM-DD (belirtilmemişse bugün: ${today})",
  "details": "toplantı notu veya ek detay (varsa)"
}

Eksik bilgi için makul varsayım yap, sormadan devam et.`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: text }],
    },
    {
      headers: {
        'x-api-key':         config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 15000,
    }
  );

  const raw      = response.data?.content?.filter(b => b.type === 'text')?.map(b => b.text)?.join('') || '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
}

// ─────────────────────────────────────────────────────────────
// Ana işleyici: mesaj → parse → özet → onay bekle
// ─────────────────────────────────────────────────────────────
async function handleCreateActivity({ from, text, session, dbName }) {
  await sendText(from, '⏳ Aktivite oluşturuluyor...');

  try {
    // Admin'den aktif tip/konu listesi
    const activeSubjects = _getAdminSubjects();
    const activeTypes    = _getAdminTypes();

    // Claude ile parse et
    const parsed = await parseActivityFromText(text, activeTypes, activeSubjects);

    // cardName varsa CardCode'a çevir
    let cardCode = null;
    let cardName = parsed.cardName || '';
    if (cardName) {
      const resolved = await resolveCardCode({ cardName, dbName });
      if (resolved.found === 'one') {
        cardCode = resolved.record.CardCode;
        cardName = resolved.record.CardName;
      } else if (resolved.found === 'many') {
        cardCode = null; // onay aşamasında uyar
      }
    }

    const activityData = {
      cardCode,
      cardName,
      action:       parsed.action       || 'Phone Call',
      subjectCode:  parsed.subjectCode  || null,
      notes:        parsed.notes        || text,
      details:      parsed.details      || '',
      activityDate: parsed.activityDate || new Date().toISOString().split('T')[0],
      employeeId:   session.employeeId,
      userName:     session.userName,
    };

    // Özet göster → Kaydet / İptal butonu
    const summary = [
      `👤 *Kullanıcı:* ${session.userName}`,
      cardName ? `🏢 *Muhatap:* ${cardName}` : '',
      `📋 *Tip:* ${activityData.action}`,
      activityData.subjectCode ? `📌 *Konu:* ${activityData.subjectCode}` : '',
      `📅 *Tarih:* ${activityData.activityDate}`,
      `📝 *Not:* ${activityData.notes}`,
      activityData.details ? `📄 *Detay:* ${activityData.details}` : '',
    ].filter(Boolean).join('\n');

    _pendingActivity.set(_norm(from), { activityData, dbName, expiresAt: Date.now() + PENDING_TTL });

    await sendButtons(from, '✅ Aktivite Özeti', summary, [
      { id: 'ACT_SAVE',   title: '💾 Kaydet' },
      { id: 'ACT_CANCEL', title: '🚫 İptal'  },
    ]);

  } catch (err) {
    console.error('[CRM] Parse hatası:', err.message);
    await sendText(from, '⚠️ Aktivite bilgileri işlenemedi. Lütfen tekrar deneyin.');
  }
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
      Details:      activityData.details || undefined,
    };

    if (activityData.cardCode)   payload.CardCode         = activityData.cardCode;
    if (activityData.subjectCode) payload.ActivitySubject  = Number(activityData.subjectCode);
    if (activityData.employeeId) payload.HandledBy         = activityData.employeeId;

    await sl.post('Activities', payload);

    await sendText(from,
      `✅ *Aktivite kaydedildi!*\n\n` +
      `🏢 ${activityData.cardName || '—'}\n` +
      `📋 ${activityData.action} · ${activityData.activityDate}\n` +
      `📝 ${activityData.notes}`
    );
    console.log(`[CRM] Aktivite oluşturuldu: ${activityData.userName} → ${activityData.cardName}`);

  } catch (err) {
    console.error('[CRM] Kayıt hatası:', err.message);
    await sendText(from, `⚠️ SAP'a kaydedilemedi: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────
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

module.exports = { handleCreateActivity, confirmActivity, getActivityTypes, getActivitySubjects };
