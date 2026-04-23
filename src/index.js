'use strict';
const express     = require('express');
const session     = require('express-session');
const path        = require('path');
const config      = require('./config/config');
const { handleIncoming } = require('./router/intentRouter');
const adminRouter = require('./admin/adminRouter');

const serviceNotifier  = require('./jobs/serviceNotifier');
const approvalNotifier = require('./jobs/approvalNotifier');
const taskService      = require('./services/taskService');
const { logMessage }  = require('./services/messageLogger');
const { transcribeVoice } = require('./services/voiceHandler');
const { sendText }    = require('./services/whatsappService');

const app = express();

// ── Statik dosyalar (admin paneli CSS/HTML) ────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── JSON body parser ───────────────────────────────────────────
app.use(express.json());

// ── Session ────────────────────────────────────────────────────
app.use(session({
  secret:            config.admin.sessionSecret,
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 8 * 60 * 60 * 1000 }, // 8 saat
}));

// ── Yönetim Paneli ─────────────────────────────────────────────
app.use('/admin', adminRouter);

// ─────────────────────────────────────────────────────────────
// GET /webhook  → Meta'nın ilk doğrulama isteği (bir kere çalışır)
// ─────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[Webhook] Meta doğrulama başarılı');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Doğrulama başarısız – token eşleşmedi');
  res.sendStatus(403);
});

// ─────────────────────────────────────────────────────────────
// POST /webhook → Gelen her WhatsApp mesajı buraya düşer
// ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Meta 200 alamazsa mesajı tekrar gönderir – hemen 200 dön
  res.sendStatus(200);

  try {
    const body = req.body;

    const entry   = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value?.messages) return; // Okundu bildirimi vs. – atla

    const message = value.messages[0];
    const from    = message.from;
    const msgType = message.type; // text | interactive | audio

    // ── Konum mesajı — session'a kaydet, sessizce geç ──────────
    if (msgType === 'location') {
      const loc = message.location;
      if (loc?.latitude && loc?.longitude) {
        const { setLocation }        = require('./modules/sessionManager');
        const { writeLog }           = require('./services/logService');
        const { handleWizardLocation } = require('./modules/crmActivity');

        // Her durumda session'a kaydet
        setLocation(from, loc);
        writeLog({
          phone:     from,
          dir:       'in',
          type:      'location',
          latitude:  loc.latitude,
          longitude: loc.longitude,
          name:      loc.name    || null,
          address:   loc.address || null,
          text:      `📍 ${loc.latitude}, ${loc.longitude}${loc.name ? ' – ' + loc.name : ''}`,
        });
        console.log(`[Konum] ${from}: ${loc.latitude}, ${loc.longitude}`);

        // Wizard konum adımını bekliyor ise ilerlet
        await handleWizardLocation(from, loc);
      }
      return;
    }

    // ── Sesli mesaj ────────────────────────────────────────────
    if (msgType === 'audio') {
      const mediaId = message.audio?.id;
      if (!mediaId) return;

      console.log(`[Mesaj] ${from}: [sesli mesaj] mediaId=${mediaId}`);
      const t0 = Date.now();

      try {
        await sendText(from, '🎙️ Sesli mesajınız transkribe ediliyor...');
        const transcribed = await transcribeVoice(mediaId);

        if (!transcribed || transcribed.trim() === '') {
          logMessage({ from, type: 'audio', text: '', error: 'transkripsiyon boş' });
          return await sendText(from, '⚠️ Sesli mesajınız anlaşılamadı. Lütfen yazarak tekrar deneyin.');
        }

        console.log(`[Mesaj] ${from}: [sesli→metin] "${transcribed}"`);
        await sendText(from, `🎙️ _"${transcribed}"_`); // Kullanıcıya ne anlaşıldığını göster

        await handleIncoming({ from, text: transcribed, message, value });
        logMessage({ from, type: 'audio', text: transcribed, processingMs: Date.now() - t0 });

      } catch (err) {
        console.error(`[Webhook] Sesli mesaj hatası (${from}):`, err.message);
        logMessage({ from, type: 'audio', text: '', error: err.message });
        await sendText(from, '⚠️ Sesli mesaj işlenirken hata oluştu. Lütfen yazarak deneyin.');
      }
      return;
    }

    // ── Görsel / Belge (aktiviteye dosya ekleme) ──────────────
    if (msgType === 'image' || msgType === 'document') {
      const media   = message[msgType];
      const mediaId = media?.id;
      if (!mediaId) return;

      const mimeType = media.mime_type || 'application/octet-stream';
      const fileName = msgType === 'document'
        ? (media.filename || `dosya.${_mimeExt(mimeType)}`)
        : `gorsel.${_mimeExt(mimeType)}`;

      const { writeLog } = require('./services/logService');
      const { handleMediaAttachment } = require('./modules/crmActivity');
      writeLog({ phone: from, dir: 'in', type: msgType, text: fileName });
      console.log(`[Medya] ${from}: [${msgType}] ${fileName}`);

      try {
        const handled = await handleMediaAttachment(from, mediaId, mimeType, fileName);
        if (!handled) {
          await sendText(from,
            '📎 Dosya eklemek için önce bir aktivite oluşturun ve *Dosya Ekle* seçeneğini seçin.'
          );
        }
      } catch (err) {
        console.error(`[Medya] Hata (${from}):`, err.message);
        await sendText(from, `⚠️ Dosya işlenemedi: ${err.message}`);
      }
      return;
    }

    // ── Metin ve buton cevapları ───────────────────────────────
    if (msgType !== 'text' && msgType !== 'interactive') return;

    const text = msgType === 'text'
      ? message.text.body.trim()
      : message.interactive?.button_reply?.id ||
        message.interactive?.list_reply?.id;

    if (!text) return;

    console.log(`[Mesaj] ${from}: ${text}`);
    const t0 = Date.now();

    try {
      await handleIncoming({ from, text, message, value });
      logMessage({ from, type: msgType, text, processingMs: Date.now() - t0 });
    } catch (err) {
      logMessage({ from, type: msgType, text, error: err.message });
      throw err;
    }

  } catch (err) {
    console.error('[Webhook] İşleme hatası:', err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Sağlık kontrolü
// ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

function _mimeExt(mimeType) {
  const map = {
    'image/jpeg':  'jpg',  'image/png':  'png',  'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
  };
  return map[mimeType] || 'bin';
}

app.listen(config.port, () => {
  console.log(`[Sunucu] http://localhost:${config.port} üzerinde çalışıyor`);
  serviceNotifier.start();
  approvalNotifier.start();
  taskService.start();
});
