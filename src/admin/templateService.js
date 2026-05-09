'use strict';
const axios  = require('axios');
const config = require('../config/config');

const BASE = config.whatsapp.apiUrl;

function headers() {
  return { Authorization: `Bearer ${config.whatsapp.accessToken}` };
}

function wabaId() {
  const id = config.whatsapp.wabaId || process.env.WA_WABA_ID || '';
  if (!id) throw new Error('WA_WABA_ID tanımlı değil. Admin Panel → Ayarlar → WhatsApp bölümünden girin.');
  return id;
}

async function listTemplates() {
  const res = await axios.get(
    `${BASE}/${wabaId()}/message_templates`,
    {
      params: { fields: 'name,status,category,language,components', limit: 100 },
      headers: headers(),
    }
  );
  return res.data.data || [];
}

async function createTemplate(data) {
  const res = await axios.post(
    `${BASE}/${wabaId()}/message_templates`,
    data,
    { headers: { ...headers(), 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function deleteTemplate(name) {
  const res = await axios.delete(
    `${BASE}/${wabaId()}/message_templates`,
    { params: { name }, headers: headers() }
  );
  return res.data;
}

module.exports = { listTemplates, createTemplate, deleteTemplate };
