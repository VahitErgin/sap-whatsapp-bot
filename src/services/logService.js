'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../data/logs');

function _ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function _filePath(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${y}-${m}-${day}.log`);
}

function writeLog(entry) {
  try {
    _ensureDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(_filePath(), line, 'utf8');
  } catch {
    // loglama hatası uygulamayı durdurmamalı
  }
}

function readLogs(fromDate, toDate) {
  _ensureDir();
  const from = new Date(fromDate);
  const to   = new Date(toDate);
  to.setHours(23, 59, 59, 999);

  const entries = [];
  const cursor  = new Date(from);

  while (cursor <= to) {
    const file = _filePath(cursor);
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const t = new Date(e.ts);
          if (t >= from && t <= to) entries.push(e);
        } catch { /* bozuk satır */ }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

module.exports = { writeLog, readLogs };
