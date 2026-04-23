'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../data/edoc-config.json');

const DEFAULTS = { efatura: '', earsiv: '', eirsaliye: '' };

function getEdocConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

function saveEdocConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// type: 'efatura' | 'earsiv' | 'eirsaliye'
// Fatura tipi için efatura yoksa earsiv'i fallback olarak dener.
function buildEdocUrl(type, numAtCard) {
  if (!numAtCard) return null;
  const cfg   = getEdocConfig();
  const order = type === 'efatura' ? ['efatura', 'earsiv'] : [type];
  for (const t of order) {
    const tpl = cfg[t];
    if (tpl) return tpl.replace(/\{0\}/g, encodeURIComponent(numAtCard));
  }
  return null;
}

module.exports = { getEdocConfig, saveEdocConfig, buildEdocUrl };
