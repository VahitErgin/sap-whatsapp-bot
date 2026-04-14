'use strict';
const express     = require('express');
const session     = require('express-session');
const path        = require('path');
const config      = require('./config/config');
const { handleIncoming } = require('./router/intentRouter');
const adminRouter = require('./admin/adminRouter');

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
    const from    = message.from;     // Gönderenin telefon numarası
    const msgType = message.type;     // text | interactive | ...

    // Sadece metin ve buton cevaplarını işle
    if (msgType !== 'text' && msgType !== 'interactive') return;

    const text = msgType === 'text'
      ? message.text.body.trim()
      : message.interactive?.button_reply?.id ||  // Buton tıklaması
        message.interactive?.list_reply?.id;       // Liste seçimi

    if (!text) return;

    console.log(`[Mesaj] ${from}: ${text}`);

    await handleIncoming({ from, text, message, value });
  } catch (err) {
    console.error('[Webhook] İşleme hatası:', err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Sağlık kontrolü
// ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(config.port, () => {
  console.log(`[Sunucu] http://localhost:${config.port} üzerinde çalışıyor`);
});
