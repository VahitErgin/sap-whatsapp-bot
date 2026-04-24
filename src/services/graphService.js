'use strict';

const axios = require('axios');

let _token      = null;
let _tokenExp   = 0;

function _cfg() {
  return {
    tenantId:     process.env.GRAPH_TENANT_ID     || '',
    clientId:     process.env.GRAPH_CLIENT_ID     || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    userDomain:   process.env.GRAPH_USER_DOMAIN   || '',
    enabled:      process.env.GRAPH_ENABLED === 'true',
  };
}

async function _getToken() {
  if (_token && Date.now() < _tokenExp) return _token;

  const cfg = _cfg();
  const res = await axios.post(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      scope:         'https://graph.microsoft.com/.default',
    }),
    { timeout: 10000 }
  );

  _token    = res.data.access_token;
  _tokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
  return _token;
}

function _userEmail(sapUserCode) {
  const domain = (process.env.GRAPH_USER_DOMAIN || '').trim();
  if (!domain || !sapUserCode) return null;
  return `${sapUserCode}${domain.startsWith('@') ? domain : '@' + domain}`;
}

// ─────────────────────────────────────────────────────────────
// createCalendarEvent
// activityData: { action, cardName, notes, activityDate, location, userName }
// Döner: Outlook event id (string) | null
// ─────────────────────────────────────────────────────────────
async function createCalendarEvent(sapUserCode, activityData) {
  const cfg = _cfg();
  if (!cfg.enabled || !cfg.tenantId || !cfg.clientId || !cfg.clientSecret) return null;

  const email = _userEmail(sapUserCode);
  if (!email) return null;

  const token = await _getToken();

  // Aktivite tipi → Outlook kategori etiketi
  const categoryMap = {
    'Phone Call': 'SAP Telefon',
    'Meeting':    'SAP Toplantı',
    'Task':       'SAP Görev',
    'Note':       'SAP Not',
    'Email':      'SAP E-posta',
  };

  const startDt = new Date();
  const endDt   = new Date(startDt.getTime() + 30 * 60 * 1000);

  function toLocalIso(dt) {
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
           `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }

  const loc = activityData.location;
  const subject = [
    activityData.action ? `[${activityData.action}]` : '',
    activityData.cardName || '',
  ].filter(Boolean).join(' – ') || 'SAP Aktivite';

  const body = [
    activityData.cardName ? `Muhatap: ${activityData.cardName}` : '',
    activityData.notes    ? `Not: ${activityData.notes}`        : '',
    loc ? `Konum: ${loc.latitude}, ${loc.longitude}${loc.name ? ' – ' + loc.name : ''}` : '',
    `Kaydeden: ${activityData.userName || sapUserCode}`,
  ].filter(Boolean).join('\n');

  const event = {
    subject,
    body:  { contentType: 'text', content: body },
    start: { dateTime: toLocalIso(startDt), timeZone: 'Turkey Standard Time' },
    end:   { dateTime: toLocalIso(endDt),   timeZone: 'Turkey Standard Time' },
    categories: [categoryMap[activityData.action] || 'SAP WhatsApp Bot'],
  };

  if (loc) {
    event.location = {
      displayName: loc.name || `${loc.latitude}, ${loc.longitude}`,
      coordinates: { latitude: loc.latitude, longitude: loc.longitude },
    };
  }

  const res = await axios.post(
    `https://graph.microsoft.com/v1.0/users/${email}/events`,
    event,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );

  return res.data?.id || null;
}

// ─────────────────────────────────────────────────────────────
// testConnection — sadece token alınıp alınamadığını dener
// ─────────────────────────────────────────────────────────────
async function testConnection() {
  const cfg = _cfg();
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'GRAPH_TENANT_ID, GRAPH_CLIENT_ID veya GRAPH_CLIENT_SECRET eksik' };
  }
  try {
    _token = null; // force fresh token
    await _getToken();
    return { ok: true };
  } catch (e) {
    const msg = e.response?.data?.error_description || e.response?.data?.error || e.message;
    return { ok: false, error: msg };
  }
}

module.exports = { createCalendarEvent, testConnection };
