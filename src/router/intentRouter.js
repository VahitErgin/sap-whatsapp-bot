'use strict';

/**
 * intentRouter.js
 *
 * Kullanıcının doğal dil mesajını Claude AI ile analiz eder
 * ve ilgili modüle yönlendirir.
 *
 * Modüller:
 *   cashflow  → SAP veri sorguları (bakiye, fatura, stok, nakit...)
 *   approval  → Satın alma onay işlemleri
 *   support   → SAP hata/destek soruları
 *
 * Buton cevapları (interactive) direkt yönlendirilir:
 *   APPROVE:<BELGE_NO> → approval
 *   REJECT:<BELGE_NO>  → approval
 */

const axios  = require('axios');
const config = require('../config/config');
const { sendText } = require('../services/whatsappService');
const { resolveUser, canAccessIntent } = require('../modules/userAuth');
const { loginUser }  = require('../modules/sapAuth');
const { createSession, getSession, deleteSession, setAwaitingPassword, getAwaitingPassword, clearAwaitingPassword } = require('../modules/sessionManager');
const { handleCreateActivity, confirmActivity } = require('../modules/crmActivity');

// Modüller lazy-load → döngüsel bağımlılık riski yok
let cashflow, approval, support;
function getModules() {
  if (!cashflow) cashflow = require('../modules/cashflow');
  if (!approval) approval = require('../modules/approval');
  if (!support)  support  = require('../modules/support');
}

// ─── Claude: Intent belirleme promptu ────────────────────────
const INTENT_SYSTEM = `Sen SAP Business One WhatsApp asistanının yönlendirici katmanısın.
Kullanıcının mesajını analiz et ve hangi modüle yönlendirileceğini belirle.

MODÜLLER:
- "cashflow"  → SAP veri sorguları ve listeleme: bakiye, fatura, stok, nakit akışı, cari bilgisi, sipariş listesi, ödeme, tahsilat, raporlar, veri görüntüleme
- "approval"  → Satın alma SİPARİŞİ ONAYLAMA veya REDDETME aksiyonu (aksiyon kelimesi gerekir)
- "crm"       → Aktivite OLUŞTURMA: toplantı notu, telefon görüşmesi kaydı, görev ekleme, aktivite ekle
- "login"     → Sisteme giriş: "giriş yap", "login", "oturum aç"
- "logout"    → Çıkış: "çıkış yap", "logout", "oturumu kapat"
- "support"   → SAP hata mesajları, nasıl yapılır soruları, menü yolları, teknik destek
- "help"      → Genel yardım menüsü istekleri (yardım, menü, ne yapabilirsin gibi)

KRİTİK AYRIMI:
- Aktivite GÖRME/LİSTELEME → cashflow | Aktivite OLUŞTURMA/EKLEME → crm
- Sipariş GÖRME → cashflow | Sipariş ONAYLAMA → approval

YANIT FORMATI (sadece JSON):
{
  "intent": "cashflow" | "approval" | "crm" | "login" | "logout" | "support" | "help",
  "confidence": 0.0-1.0,
  "reason": "Kısa açıklama"
}

ÖRNEKLER:
- "C001 bakiyesi nedir" → cashflow
- "Stokta vida var mı" → cashflow
- "MB00001'in aktiviteleri" → cashflow
- "ABC ile bugün toplantı yaptık, teklif konuştuk" → crm
- "Telefon görüşmesi ekle: Endeks firmasını aradım" → crm
- "Aktivite oluştur" → crm
- "456 numaralı siparişi onayla" → approval
- "Giriş yap" → login
- "Çıkış yap" → logout
- "-10 hatası aldım" → support
- "Yardım" → help`;

// ─────────────────────────────────────────────────────────────
// Ana yönlendirici
// ─────────────────────────────────────────────────────────────
async function handleIncoming({ from, text }) {
  getModules();
  const upper = text.toUpperCase().trim();

  try {
    // ── 1. Şifre bekleme modu — Claude'a gitmeden yakala ─────
    const awaitingPw = getAwaitingPassword(from);
    if (awaitingPw) {
      clearAwaitingPassword(from);
      const result = await loginUser(awaitingPw.userCode, text.trim());
      if (result.success) {
        createSession(from, {
          userCode:   awaitingPw.userCode,
          employeeId: result.employeeId,
          userName:   awaitingPw.userName,
        });
        const ttl = Math.round(parseInt(process.env.SESSION_TIMEOUT_MINUTES || '480') / 60);
        return await sendText(from,
          `✅ *Giriş başarılı!*\n\n` +
          `Hoş geldiniz, *${awaitingPw.userName}*\n` +
          `Oturum ${ttl} saat geçerli.\n\n` +
          `Aktivite oluşturmak için doğal dille yazabilirsiniz.\nÖrnek: _"ABC ile toplantı yaptık, teklif konuştuk"_`
        );
      }
      return await sendText(from, `❌ *Giriş başarısız*\n\n${result.error}\n\nTekrar denemek için *giriş yap* yazın.`);
    }

    // ── 2. Yetki kontrolü (OUSR veya OCPR) ───────────────────
    const user = await resolveUser(from);
    if (!user) {
      return await sendText(from,
        '⛔ *Yetkiniz Bulunmamaktadır*\n\n' +
        'Bu botu kullanabilmek için SAP B1 sistemine tanımlı olmanız gerekmektedir.\n\n' +
        'Lütfen sistem yöneticinizle iletişime geçin.'
      );
    }

    // ── 3. Buton cevapları → direkt yönlendir ────────────────
    if (upper.startsWith('APPROVE:')) {
      return await approval.confirmApproval({ from, docEntry: upper.replace('APPROVE:', '').trim(), action: 'approve' });
    }
    if (upper.startsWith('REJECT:')) {
      return await approval.confirmApproval({ from, docEntry: upper.replace('REJECT:', '').trim(), action: 'reject' });
    }
    if (text.startsWith('CARI_SEL:')) {
      const payload  = text.slice('CARI_SEL:'.length);
      const sepIdx   = payload.indexOf('|');
      const cardCode = sepIdx >= 0 ? payload.slice(0, sepIdx).trim() : payload.trim();
      const cardName = sepIdx >= 0 ? payload.slice(sepIdx + 1).trim() : '';
      return await cashflow.handleCardSelection({ from, cardCode, cardName });
    }
    if (upper === 'ACT_SAVE')   return await confirmActivity(from);
    if (upper === 'ACT_CANCEL') return await sendText(from, '🚫 Aktivite iptal edildi.');

    // ── 4. Claude ile intent belirle ─────────────────────────
    const intent = await detectIntent(text);
    console.log(`[Router] (${from}/${user.license}) "${text}" → ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`);

    // ── 5. Lisans kontrolü ───────────────────────────────────
    if (!canAccessIntent(user, intent.intent)) {
      return await sendText(from,
        `⛔ *Yetersiz Lisans*\n\n*${user.license}* lisansınız bu işlem için yeterli değil.\n\nKullanabileceğiniz özellikler için *yardım* yazın.`
      );
    }

    // ── 6. Modüle yönlendir ───────────────────────────────────
    switch (intent.intent) {

      case 'login': {
        if (!user.userCode) {
          return await sendText(from, '⛔ Müşteri hesapları için oturum açma özelliği bulunmamaktadır.');
        }
        setAwaitingPassword(from, { userCode: user.userCode, userName: user.name });
        return await sendText(from,
          `🔐 *SAP Girişi*\n\nMerhaba *${user.name}*,\nLütfen SAP B1 şifrenizi yazın.\n\n_⚠️ Mesajınız 2 dakika içinde işlenecektir._`
        );
      }

      case 'logout': {
        const session = getSession(from);
        if (session) {
          deleteSession(from);
          return await sendText(from, `👋 Oturum kapatıldı. Görüşmek üzere, *${session.userName}*!`);
        }
        return await sendText(from, 'ℹ️ Zaten aktif bir oturumunuz bulunmuyor.');
      }

      case 'crm': {
        const session = getSession(from);
        if (!session) {
          return await sendText(from,
            '🔐 *Aktivite oluşturmak için giriş yapmanız gerekiyor.*\n\n' +
            'SAP B1 hesabınızla giriş yapmak için *giriş yap* yazın.'
          );
        }
        return await handleCreateActivity({ from, text, session });
      }

      case 'cashflow':
        return await cashflow.handleQuery({ from, question: text, licenseRestriction: user.cashflowRestriction, customerCardCode: user.customerCardCode });

      case 'approval': {
        const docMatch = text.match(/\d+/);
        const docEntry = docMatch ? docMatch[0] : null;
        if (/onayla/i.test(text)) return await approval.confirmApproval({ from, docEntry, action: 'approve' });
        if (/reddet/i.test(text)) return await approval.confirmApproval({ from, docEntry, action: 'reject' });
        return await approval.handleApproval({ from, docEntry });
      }

      case 'support':
        return await support.handleSupport({ from, question: text });

      case 'help':
      default:
        return await sendHelpMenu(from);
    }

  } catch (err) {
    console.error(`[Router] Hata (${from}):`, err.message);
    await sendText(from, '⚠️ Bir hata oluştu. Lütfen tekrar deneyin veya *yardım* yazın.');
  }
}

// ─────────────────────────────────────────────────────────────
// Claude: Intent tespiti  (Haiku – hızlı ve ucuz)
// ─────────────────────────────────────────────────────────────
async function detectIntent(text) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system:     INTENT_SYSTEM,
        messages: [{ role: 'user', content: text }],
      },
      {
        headers: {
          'x-api-key':         config.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
      }
    );

    const raw = response.data?.content
      ?.filter(b => b.type === 'text')
      ?.map(b => b.text)
      ?.join('') || '{}';

    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);

  } catch (err) {
    console.warn('[Router] Intent tespiti başarısız, support\'a düşüyor:', err.message);
    return { intent: 'support', confidence: 0.5, reason: 'fallback' };
  }
}

// ─────────────────────────────────────────────────────────────
// Yardım menüsü
// ─────────────────────────────────────────────────────────────
async function sendHelpMenu(to) {
  const msg = [
    '👋 *SAP B1 WhatsApp Asistanı*',
    '',
    'Bana doğal dille sorabilirsiniz:',
    '',
    '📊 *Sorgulama*',
    '  • "C001 carisinin bakiyesi nedir?"',
    '  • "Bu hafta vadesi gelen ödemeler"',
    '  • "Vida ürününün stok miktarı"',
    '  • "Bugün vadesi gelen tahsilatlar"',
    '',
    '✅ *Onay İşlemleri*',
    '  • "Bekleyen onaylarım var mı?"',
    '  • "456 numaralı siparişi onayla"',
    '',
    '🔧 *Teknik Servis*',
    '  • "MB00001 müşterisinin servis çağrıları"',
    '  • "Açık servis çağrıları"',
    '  • "SN12345 seri nolu cihazın durumu"',
    '  • "Hizmet çağrısı 14 nedir?"',
    '',
    '🤝 *CRM*',
    '  • "MB00001\'in aktiviteleri"',
    '  • "MB00001 için telefon görüşmesi aktivitesi ekle"',
    '  • "Yeni aday müşteri ekle: ABC Firma, 05001234567"',
    '  • "Açık satış fırsatları"',
    '  • "Yeni fırsat ekle: MB00001, Sunucu Satışı"',
    '',
    '🛠 *SAP Destek*',
    '  • "-10 hatası nasıl çözülür?"',
    '  • "Fatura nasıl iptal edilir?"',
    '  • "Dönem kapalı hatası aldım"',
    '',
    '❓ *yardım* → Bu menü',
  ].join('\n');

  await sendText(to, msg);
}

module.exports = { handleIncoming };
