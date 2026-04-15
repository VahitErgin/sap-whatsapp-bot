'use strict';
const fs   = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');

function readEnv() {
  const content = fs.readFileSync(envPath, 'utf8');
  const result  = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    result[trimmed.substring(0, idx)] = trimmed.substring(idx + 1);
  }
  return result;
}

function updateEnv(updates) {
  let content = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(envPath, content);
  // Runtime'da da güncelle — sunucu yeniden başlatmaya gerek kalmasın
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

module.exports = { readEnv, updateEnv };
