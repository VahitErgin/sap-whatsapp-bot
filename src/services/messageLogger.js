'use strict';

/**
 * messageLogger.js
 *
 * Gelen her WhatsApp mesajını JSONL formatında loglar.
 * Günlük rotasyon: data/logs/message-log-YYYY-MM-DD.jsonl
 *
 * Örnek satır:
 * {"ts":"2026-04-16T10:23:01.123Z","from":"905321234567","type":"text",
 *  "text":"C001 bakiyesi","intent":"cashflow","processingMs":1842,"error":null}
 */

const fs   = require('fs');
const path = require('path');

const LOG_DIR      = path.join(__dirname, '../../data/logs');
const MAX_TEXT_LEN = 500;

// data/logs/ klasörü yoksa oluştur
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Bugünün log dosyası: message-log-2026-04-16.jsonl
function getLogFile() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `message-log-${today}.jsonl`);
}

// ─── Mesaj logla ─────────────────────────────────────────────
function logMessage({ from, type, text, intent, processingMs, error }) {
  const entry = {
    ts:           new Date().toISOString(),
    from:         from        || '',
    type:         type        || 'text',
    text:         (text || '').substring(0, MAX_TEXT_LEN),
    intent:       intent      || null,
    processingMs: processingMs != null ? processingMs : null,
    error:        error       || null,
  };

  try {
    fs.appendFileSync(getLogFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[Logger] Log yazma hatası:', err.message);
  }
}

// ─── Belirli bir günün loglarını oku ─────────────────────────
// date: 'YYYY-MM-DD' | undefined → bugün
function getLogsForDate(date, limit = 100) {
  const d    = date || new Date().toISOString().split('T')[0];
  const file = path.join(LOG_DIR, `message-log-${d}.jsonl`);
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines   = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  } catch {
    return [];
  }
}

// ─── Mevcut log dosyalarını listele ──────────────────────────
function getLogDates() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('message-log-') && f.endsWith('.jsonl'))
      .map(f => f.replace('message-log-', '').replace('.jsonl', ''))
      .sort()
      .reverse(); // En yeni önce
  } catch {
    return [];
  }
}

module.exports = { logMessage, getLogsForDate, getLogDates };
