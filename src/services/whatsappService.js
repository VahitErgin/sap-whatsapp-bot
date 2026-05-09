'use strict';
const axios  = require('axios');
const config = require('../config/config');
const { writeLog } = require('./logService');

const BASE = `${config.whatsapp.apiUrl}/${config.whatsapp.phoneNumberId}/messages`;
const HEADERS = {
  Authorization: `Bearer ${config.whatsapp.accessToken}`,
  'Content-Type': 'application/json',
};

// ─────────────────────────────────────────────────────────────
// Düz metin mesajı
// ─────────────────────────────────────────────────────────────
async function sendText(to, body) {
  return _send(to, {
    type: 'text',
    text: { body, preview_url: false },
  });
}

// ─────────────────────────────────────────────────────────────
// Butonlu mesaj (max 3 buton)
// buttons: [{ id: 'APPROVE:123', title: '✅ Onayla' }, ...]
// ─────────────────────────────────────────────────────────────
async function sendButtons(to, headerText, bodyText, buttons) {
  return _send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: headerText },
      body:   { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type:  'reply',
          reply: { id: b.id, title: b.title.substring(0, 20) }, // max 20 karakter
        })),
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Liste mesajı (max 10 satır)
// sections: [{ title: 'Bekleyen', rows: [{ id, title, description }] }]
// ─────────────────────────────────────────────────────────────
async function sendList(to, headerText, bodyText, buttonLabel, sections) {
  return _send(to, {
    type: 'interactive',
    interactive: {
      type:   'list',
      header: { type: 'text', text: headerText },
      body:   { text: bodyText },
      action: {
        button: buttonLabel.substring(0, 20),
        sections,
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Yardım menüsü kısayolu (alias)
// ─────────────────────────────────────────────────────────────
async function sendMenu(to, text) {
  return sendText(to, text);
}

// ─────────────────────────────────────────────────────────────
// Template mesajı (business-initiated / proaktif bildirim)
//
// components: [{ type: 'text', text: '...' }, ...]  → body parametreleri
// Örnek: sendTemplate('905001234567', 'servis_durum_guncelleme', 'tr',
//          [{ type: 'text', text: '14' }, { type: 'text', text: 'Teslim Edildi' }])
// ─────────────────────────────────────────────────────────────
async function sendTemplate(to, templateName, language, components) {
  return _send(to, {
    type: 'template',
    template: {
      name:     templateName,
      language: { code: language || 'tr' },
      components: components && components.length ? [
        { type: 'body', parameters: components },
      ] : [],
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Dahili gönderici
// ─────────────────────────────────────────────────────────────
async function _send(to, messagePayload) {
  if (process.env.NOTIF_MODE === 'test') {
    const testPhone = (process.env.NOTIF_TEST_PHONE || '').trim();
    if (testPhone && to !== testPhone) {
      console.log(`[WA] TEST MODU → ${to} yerine ${testPhone} adresine yönlendirildi`);
      to = testPhone;
    }
  }

  try {
    const res = await axios.post(BASE, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...messagePayload,
    }, { headers: HEADERS });

    console.log(`[WA] Gönderildi → ${to} | msgId: ${res.data?.messages?.[0]?.id}`);
    writeLog({ phone: to, dir: 'out', type: messagePayload.type, preview: _preview(messagePayload) });
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WA] Gönderme hatası → ${to}:`, JSON.stringify(detail));
    throw err;
  }
}

function _preview(payload) {
  if (payload.type === 'text') return (payload.text?.body || '').substring(0, 120);
  if (payload.type === 'interactive') {
    const h = payload.interactive?.header?.text || '';
    const b = payload.interactive?.body?.text   || '';
    return `${h} | ${b}`.substring(0, 120);
  }
  if (payload.type === 'template') return payload.template?.name || '';
  return '';
}

// ─────────────────────────────────────────────────────────────
// Meta'dan medya (görsel/belge) indir
// ─────────────────────────────────────────────────────────────
async function downloadMedia(mediaId) {
  // 1. URL'yi al
  const infoRes = await axios.get(
    `${config.whatsapp.apiUrl}/${mediaId}`,
    { headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` } }
  );
  const { url, mime_type, file_size } = infoRes.data;

  // 2. Binary indir
  const fileRes = await axios.get(url, {
    headers:      { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    responseType: 'arraybuffer',
  });

  return {
    buffer:   Buffer.from(fileRes.data),
    mimeType: mime_type,
    fileSize: file_size || fileRes.data.byteLength,
  };
}

module.exports = { sendText, sendButtons, sendList, sendMenu, sendTemplate, downloadMedia };
