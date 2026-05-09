'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Eksik ortam değişkeni: ${key}`);
  return val;
}

module.exports = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',

  whatsapp: {
    phoneNumberId:  required('WA_PHONE_NUMBER_ID'),
    wabaId:         process.env.WA_WABA_ID || '',   // WhatsApp Business Account ID (şablon yönetimi için)
    accessToken:    required('WA_ACCESS_TOKEN'),
    verifyToken:    required('WA_VERIFY_TOKEN'),
    apiUrl:         'https://graph.facebook.com/v19.0',
  },

  sap: {
    serviceLayerUrl: required('SAP_SERVICE_LAYER_URL'),
    companyDb:       required('SAP_COMPANY_DB'),        // tek DB (default)
    databases:       process.env.SAP_DATABASES || null, // çoklu DB: "TESTFKC;B2B;PROD"
    username:        required('SAP_USERNAME'),
    password:        required('SAP_PASSWORD'),
  },

  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },

  sapDb: {
    server:   process.env.SAP_DB_SERVER   || '',
    database: process.env.SAP_DB_NAME     || '',
    user:     process.env.SAP_DB_USER     || '',
    password: process.env.SAP_DB_PASSWORD || '',
  },

  graph: {
    tenantId:     process.env.GRAPH_TENANT_ID     || '',
    clientId:     process.env.GRAPH_CLIENT_ID     || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    userDomain:   process.env.GRAPH_USER_DOMAIN   || '',
    enabled:      process.env.GRAPH_ENABLED === 'true',
  },

  // Satın alma onayı yapabilecek telefon numaraları (başında ülke kodu, + yok)
  approverPhones: (process.env.APPROVER_PHONES || '').split(',').map(p => p.trim()).filter(Boolean),

  admin: {
    username:      process.env.ADMIN_USERNAME       || 'admin',
    password:      process.env.ADMIN_PASSWORD       || 'admin',
    sessionSecret: process.env.ADMIN_SESSION_SECRET || 'sawbot-admin-default-secret',
  },
};
