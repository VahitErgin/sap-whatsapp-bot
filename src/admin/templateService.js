'use strict';
const axios  = require('axios');
const config = require('../config/config');

const BASE     = config.whatsapp.apiUrl;
const PHONE_ID = config.whatsapp.phoneNumberId;

function headers() {
  return { Authorization: `Bearer ${config.whatsapp.accessToken}` };
}

async function listTemplates() {
  const res = await axios.get(
    `${BASE}/${PHONE_ID}/message_templates`,
    {
      params: { fields: 'name,status,category,language,components', limit: 100 },
      headers: headers(),
    }
  );
  return res.data.data || [];
}

async function createTemplate(data) {
  const res = await axios.post(
    `${BASE}/${PHONE_ID}/message_templates`,
    data,
    { headers: { ...headers(), 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function deleteTemplate(name) {
  const res = await axios.delete(
    `${BASE}/${PHONE_ID}/message_templates`,
    { params: { name }, headers: headers() }
  );
  return res.data;
}

module.exports = { listTemplates, createTemplate, deleteTemplate };
