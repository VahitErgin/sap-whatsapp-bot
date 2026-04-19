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
const {
  handleCreateActivity, handleWizardInput,
  handleWizardTypeSelection, handleWizardCategorySelection, handleWizardSubjectSelection,
  handleWizardFirmSelection,
  getWizardState, confirmActivity,
  handleCreateLead, handleLeadWizardInput, getLeadWizardState, confirmLead,
} = require('../modules/crmActivity');

// Modüller lazy-load → döngüsel bağımlılık riski yok
let cashflow, approval, support;
function getModules() {
  if (!cashflow) cashflow = require('../modules/cashflow');
  if (!approval) approval = require('../modules/approval');
  if (!support)  support  = require('../modules/support');
}

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
    if (upper === 'ACT_SAVE')    return await confirmActivity(from);
    if (upper === 'LEAD_SAVE')   return await confirmLead(from);
    if (upper === 'LEAD_CANCEL') return await sendText(from, '🚫 Aday müşteri ekleme iptal edildi.');
    if (upper === 'ACT_CANCEL')  return await sendText(from, '🚫 Aktivite iptal edildi.');
    if (text.startsWith('ACT_FIRM:')) {
      const payload  = text.slice('ACT_FIRM:'.length);
      const sepIdx   = payload.indexOf('|');
      const cardCode = sepIdx >= 0 ? payload.slice(0, sepIdx).trim() : payload.trim();
      const cardName = sepIdx >= 0 ? payload.slice(sepIdx + 1).trim() : '';
      return await handleWizardFirmSelection(from, cardCode, cardName);
    }
    if (text.startsWith('ACT_TYPE:')) {
      return await handleWizardTypeSelection(from, text.replace('ACT_TYPE:', '').trim());
    }
    if (text.startsWith('ACT_CAT:')) {
      return await handleWizardCategorySelection(from, text.replace('ACT_CAT:', '').trim());
    }
    if (text.startsWith('ACT_SUB:')) {
      return await handleWizardSubjectSelection(from, text.replace('ACT_SUB:', '').trim());
    }

    // ── 4. Wizard modu ───────────────────────────────────────
    if (getLeadWizardState(from)) return await handleLeadWizardInput(from, text);
    if (getWizardState(from))     return await handleWizardInput(from, text);

    // ── 5. Intent belirle (keyword → Claude Haiku fallback) ──
    const intent = await detectIntentLocal(text);
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

      case 'lead': {
        const session = getSession(from);
        if (!session) {
          return await sendText(from,
            '🔐 *Aday müşteri eklemek için giriş yapmanız gerekiyor.*\n\n' +
            'SAP B1 hesabınızla giriş yapmak için *giriş yap* yazın.'
          );
        }
        return await handleCreateLead({ from, session, dbName: user.dbName });
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
// Intent tespiti: kesin keyword → direkt, belirsiz → Claude Haiku
// ─────────────────────────────────────────────────────────────
async function detectIntentLocal(text) {
  const fast = _keywordIntent(text);
  if (fast) return fast;
  return await _claudeIntent(text);
}

// Yüksek güvenli keyword eşleşmeleri — yanlış pozitif riski sıfır
// NOT: Türkçe ş,ğ,ı,ö,ü,ç karakterleri JS \b ile çalışmaz → includes/indexOf kullan
function _keywordIntent(text) {
  const t = text.toLowerCase().trim();

  if (t.includes('giriş') || t.includes('login') || t.includes('oturum aç'))
    return { intent: 'login', confidence: 0.97, reason: 'keyword' };

  if (t.includes('çıkış') || t.includes('logout') || t.includes('oturumu kapat') || t.includes('oturum kapat'))
    return { intent: 'logout', confidence: 0.97, reason: 'keyword' };

  if (t === 'yardım' || t === 'menü' || t === 'yardım?' || t === 'ne yapabilirsin' || t === 'ne yapabilirsin?')
    return { intent: 'help', confidence: 0.97, reason: 'keyword' };

  if (t.includes('onayla') || t.includes('reddet') || t.includes('bekleyen onay'))
    return { intent: 'approval', confidence: 0.93, reason: 'keyword' };

  // Lead: aday müşteri / lead ekleme
  if (
    /aday\s+müşteri\s+(ekle|oluştur|kaydet|tanımla)/.test(t) ||
    /lead\s+(ekle|oluştur|kaydet)/.test(t) ||
    /yeni\s+(aday|müşteri\s+aday)/.test(t) ||
    /(potansiyel|prospekt)\s+müşteri\s+ekle/.test(t)
  )
    return { intent: 'lead', confidence: 0.95, reason: 'keyword' };

  // CRM: açık oluşturma fiilleri veya 1. şahıs geçmiş zaman
  if (
    /aktivite\s+(oluştur|ekle|yaz|kaydet)/.test(t) ||
    /toplantı\s+(yaptık|ekle|oluştur|kaydı)/.test(t) ||
    /telefon görüşmesi (ekle|yaptım|kaydı|oluştur)/.test(t) ||
    /(not|görev) ekle/.test(t) ||
    /(aradım|ziyaret ettim|görüştük|konuştuk|toplantı yaptık)/.test(t)
  )
    return { intent: 'crm', confidence: 0.90, reason: 'keyword' };

  // SAP hata kodları
  if (/-\d+ (hatası|kodu)/.test(t) || t.includes('dönem kapalı'))
    return { intent: 'support', confidence: 0.92, reason: 'keyword' };

  return null; // belirsiz → Claude'a git
}

// Claude Haiku — belirsiz mesajlar için
const INTENT_SYSTEM = `Sen SAP Business One WhatsApp asistanının yönlendirici katmanısın.
Kullanıcının mesajını analiz et ve hangi modüle yönlendirileceğini JSON olarak döndür.

MODÜLLER:
- "cashflow"  → SAP veri sorgulama: bakiye, fatura, stok, sipariş, ödeme, tahsilat, rapor, aktivite/fırsat GÖRÜNTÜLEME
- "approval"  → Satın alma siparişi ONAYLAMA veya REDDETME
- "crm"       → Aktivite/toplantı/görüşme KAYDETME veya OLUŞTURMA (geçmişte olan)
- "lead"      → Yeni aday müşteri / lead / potansiyel müşteri EKLEME veya TANIMLAMA
- "support"   → SAP hata mesajları, nasıl yapılır soruları, teknik destek
- "help"      → Yardım menüsü

KRİTİK: Aktivite/toplantı GÖRME → cashflow | Aktivite OLUŞTURMA → crm | Aday müşteri ekleme → lead

YANIT (sadece JSON):
{"intent":"cashflow","confidence":0.9,"reason":"kısa açıklama"}`;

async function _claudeIntent(text) {
  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system:     INTENT_SYSTEM,
        messages:   [{ role: 'user', content: text }],
      },
      {
        headers: {
          'x-api-key':         config.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 10000,
      }
    );
    const raw     = res.data?.content?.filter(b => b.type === 'text')?.map(b => b.text)?.join('') || '{}';
    const matched = raw.match(/\{[\s\S]*?\}/);
    return JSON.parse(matched ? matched[0] : '{}');
  } catch (err) {
    console.warn('[Router] Claude intent hatası, cashflow\'a düşüyor:', err.message);
    return { intent: 'cashflow', confidence: 0.5, reason: 'fallback' };
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
