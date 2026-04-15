'use strict';

/**
 * support.js
 *
 * Kullanıcının SAP ile ilgili sorularını Claude AI ile yanıtlar.
 * - SAP hata çözümleri
 * - Nasıl yapılır soruları
 * - Genel SAP B1 desteği
 *
 * Context kaynakları:
 *   src/docs/sap-errors.md   → Hata kataloğu
 *   src/docs/sap-context.md  → API referansı
 *   src/docs/scenarios.md    → Kullanıcı senaryoları
 */

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const config = require('../config/config');               // FIX: ../config/config
const { sendText } = require('../services/whatsappService'); // FIX: ../services/

// ─── Dokümanları oku (uygulama başında bir kere yükle) ────────
const DOCS_DIR = path.join(__dirname, '../docs');          // FIX: modules/ → docs/ bir üst

function loadDoc(filename) {
  try {
    return fs.readFileSync(path.join(DOCS_DIR, filename), 'utf8');
  } catch (err) {
    console.warn(`[Support] Doküman okunamadı: ${filename}`);
    return '';
  }
}

const SAP_ERRORS_DOC  = loadDoc('sap-errors.md');
const SAP_CONTEXT_DOC = loadDoc('sap-context.md');
const SCENARIOS_DOC   = loadDoc('scenarios.md');

// ─── Claude sistem promptu ────────────────────────────────────
const SYSTEM_PROMPT = `Sen SAP Business One konusunda uzman bir asistansın.
WhatsApp üzerinden kullanıcılara SAP B1 destek hizmet veriyorsun.

GÖREVLERIN:
1. SAP hata mesajlarını açıkla ve adım adım çözüm yolu sun
2. SAP B1'de nasıl yapılır sorularını yanıtla
3. Menü yollarını ve adımları net anlat
4. Teknik olmayan kullanıcılara sade Türkçe ile açıkla

YANITLAMA KURALLARI:
- Kısa ve öz yaz (WhatsApp formatı)
- Adımları numaralandır
- Gerekirse emoji kullan ama abartma
- Türkçe yaz
- Emin olmadığın şeyleri uydurma, "SAP yöneticinize danışın" de
- Maksimum 400 kelime

SAP B1 HATA KATALOĞU:
${SAP_ERRORS_DOC}

SAP SERVICE LAYER API REFERANSI:
${SAP_CONTEXT_DOC}

KULLANICI SENARYOLARI:
${SCENARIOS_DOC}`;

// ─────────────────────────────────────────────────────────────
// Throttle: Aynı numaradan art arda gelen destek isteklerini sınırla
// ─────────────────────────────────────────────────────────────
const _lastRequest = new Map(); // phone → timestamp
const THROTTLE_MS  = 3000;     // 3 saniye içinde ikinci istek atlanır

function _isThrottled(phone) {
  const last = _lastRequest.get(phone);
  if (last && Date.now() - last < THROTTLE_MS) return true;
  _lastRequest.set(phone, Date.now());
  return false;
}

// ─────────────────────────────────────────────────────────────
// Ana fonksiyon
// ─────────────────────────────────────────────────────────────
async function handleSupport({ from, question }) {
  if (!question || question.trim() === '') {
    return await sendText(from,
      '🛠 *SAP Destek*\n\nSorunuzu yazın, yardımcı olayım.\n\nÖrnek: _"Stok girişi yaparken -10 hatası alıyorum"_'
    );
  }

  if (_isThrottled(from)) {
    console.log(`[Support] Throttle → ${from}`);
    return; // Çok hızlı ardışık istek, sessizce atla
  }

  console.log(`[Support] Soru (${from}): ${question}`);

  // Kullanıcıya "işleniyor" bildirimi
  await sendText(from, '⏳ Sorunuz inceleniyor...');

  try {
    const answer = await askClaude(question);
    await sendText(from, `🛠 *SAP Destek*\n\n${answer}`);
  } catch (err) {
    console.error('[Support] Claude hatası:', err.message);
    await sendText(from,
      '⚠️ Şu an yanıt üretemiyorum. Lütfen SAP yöneticinize danışın.'
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Claude API çağrısı
// ─────────────────────────────────────────────────────────────
async function askClaude(question) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: question }
      ],
    },
    {
      headers: {
        'x-api-key':         config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
    }
  );

  const content = response.data?.content;
  if (!content || content.length === 0) throw new Error('Claude boş yanıt döndü');

  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

module.exports = { handleSupport, askClaude };
