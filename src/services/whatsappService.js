'use strict';
const axios  = require('axios');
const config = require('../config/config');

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
// Dahili gönderici
// ─────────────────────────────────────────────────────────────
async function _send(to, messagePayload) {
  try {
    const res = await axios.post(BASE, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...messagePayload,
    }, { headers: HEADERS });

    console.log(`[WA] Gönderildi → ${to} | msgId: ${res.data?.messages?.[0]?.id}`);
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WA] Gönderme hatası → ${to}:`, JSON.stringify(detail));
    throw err;
  }
}

module.exports = { sendText, sendButtons, sendList, sendMenu };
