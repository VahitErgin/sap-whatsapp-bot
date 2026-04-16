'use strict';

/**
 * voiceHandler.js
 *
 * WhatsApp'tan gelen sesli mesajı metne çevirir.
 *
 * Akış:
 *   1. WhatsApp Media API'den ses dosyasının URL'ini al
 *   2. Ses dosyasını buffer'a indir
 *   3. OpenAI Whisper API'ye gönder → Türkçe transkripsiyon
 *   4. Metin döndür → intentRouter'a aktar
 *
 * Gereksinim: .env → OPENAI_API_KEY
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const OpenAI = require('openai');
const config = require('../config/config');

// OpenAI client (lazy: sadece sesli mesaj gelince kullanılır)
let _openai;
function getOpenAI() {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY tanımlı değil → sesli mesaj desteği kapalı');
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

// ─────────────────────────────────────────────────────────────
// Sesli mesajı metne çevir
//
// mediaId: WhatsApp'ın verdiği audio media ID
// Döndürür: transkripsiyon metni (string)
// ─────────────────────────────────────────────────────────────
async function transcribeVoice(mediaId) {
  // 1. Media URL'i al
  const metaRes = await axios.get(
    `${config.whatsapp.apiUrl}/${mediaId}`,
    { headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` } }
  );
  const mediaUrl = metaRes.data?.url;
  if (!mediaUrl) throw new Error('Media URL alınamadı');

  // 2. Ses dosyasını indir (arraybuffer)
  const audioRes = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    timeout: 30000,
  });

  // 3. Geçici .ogg dosyasına yaz
  const tmpFile = path.join(os.tmpdir(), `wa-voice-${Date.now()}.ogg`);
  fs.writeFileSync(tmpFile, Buffer.from(audioRes.data));

  // 4. Whisper ile Türkçe transkripsiyon
  try {
    const result = await getOpenAI().audio.transcriptions.create({
      file:     fs.createReadStream(tmpFile),
      model:    'whisper-1',
      language: 'tr',
    });
    console.log(`[Voice] Transkripsiyon: "${result.text}"`);
    return result.text;
  } finally {
    // Geçici dosyayı sil
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { transcribeVoice };
