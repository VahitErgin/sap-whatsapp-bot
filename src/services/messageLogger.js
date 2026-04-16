'use strict';

/**
 * messageLogger.js
 *
 * Gelen her WhatsApp mesajını ve bot cevabını JSONL formatında loglar.
 * Her satır bağımsız bir JSON nesnesidir → kolay parse, büyük dosyalarda sorun yok.
 *
 * Dosya: data/message-log.jsonl
 *
 * Örnek satır:
 * {"ts":"2026-04-16T10:23:01.123Z","from":"905321234567","type":"text",
 *  "text":"C001 bakiyesi","intent":"cashflow","processingMs":1842,"error":null}
 */

const fs   = require('fs');
const path = require('path');

const LOG_FILE    = path.join(__dirname, '../../data/message-log.jsonl');
const MAX_TEXT_LEN = 500; // Log'a yazılacak max metin uzunluğu

// ─── Mesaj logla ─────────────────────────────────────────────
function logMessage({ from, type, text, intent, processingMs, error }) {
  const entry = {
    ts:          new Date().toISOString(),
    from:        from        || '',
    type:        type        || 'text',
    text:        (text || '').substring(0, MAX_TEXT_LEN),
    intent:      intent      || null,
    processingMs: processingMs != null ? processingMs : null,
    error:       error       || null,
  };

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[Logger] Log yazma hatası:', err.message);
  }
}

// ─── Son N kaydı oku (admin panel için) ─────────────────────
function getRecentLogs(limit = 50) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines   = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(l => JSON.parse(l))
      .reverse(); // En yeni önce
  } catch {
    return [];
  }
}

module.exports = { logMessage, getRecentLogs };
