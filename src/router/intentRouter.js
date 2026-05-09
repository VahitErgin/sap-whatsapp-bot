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
const { sendText, sendButtons } = require('../services/whatsappService');
const { writeLog }   = require('../services/logService');
const { resolveUser, canAccessIntent } = require('../modules/userAuth');
const { isAllowed, isEnabled }         = require('../services/userRegistry');
const { loginUser }  = require('../modules/sapAuth');
const { t } = require('../services/i18n');
const { getLang, setLang }   = require('../services/langService');
const { createSession, getSession, deleteSession, setAwaitingPassword, getAwaitingPassword, clearAwaitingPassword } = require('../modules/sessionManager');
const {
  handleCreateActivity, handleWizardInput,
  handleWizardTypeSelection, handleWizardCategorySelection, handleWizardSubjectSelection,
  handleWizardFirmSelection, handleWizardDateSelection, handleWizardTimeSelection,
  getWizardState, confirmActivity, skipLocation,
  cancelAttachment,
  cancelActivityWizard,
  handleCreateLead, handleLeadWizardInput, getLeadWizardState, confirmLead,
  cancelLeadWizard,
} = require('../modules/crmActivity');

const {
  handleCreateServiceCall, handleServiceWizardInput,
  handleServiceCustomerSelection, handleServicePriority,
  getServiceWizardState, confirmServiceCall,
  cancelServiceWizard,
} = require('../modules/serviceCallWizard');

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
  writeLog({ phone: from, dir: 'in', text: text.substring(0, 500) });
  const upper = text.toUpperCase().trim();

  try {
    // ── 1. Şifre bekleme modu — Claude'a gitmeden yakala ─────
    const awaitingPw = getAwaitingPassword(from);
    if (awaitingPw) {
      clearAwaitingPassword(from);
      const result = await loginUser(awaitingPw.userCode, text.trim());
      const lang = getLang(from);
      if (result.success) {
        createSession(from, {
          userCode:   awaitingPw.userCode,
          employeeId: result.employeeId,
          userName:   awaitingPw.userName,
          b1session:  result.b1session,
        });
        return await sendText(from, t(lang, 'login_success', { name: awaitingPw.userName }));
      }
      return await sendText(from, t(lang, 'login_failed'));
    }

    // ── 2. Yetki kontrolü (OUSR veya OCPR) ───────────────────
    const user = await resolveUser(from);
    if (!user) {
      return await sendText(from, t(getLang(from), 'unknown_user'));
    }

    // ── 2a. Kayıt defteri — sadece OUSR (dahili) kullanıcılar ─
    // OCPR (müşteri ilgili kişi) lisans limitinin dışındadır.
    if (!user.isCustomer && isEnabled() && !isAllowed(from)) {
      console.log(`[Router] OUSR kayıt dışı: ${from}`);
      return await sendText(from,
        '🔒 Bot erişiminiz aktif değil.\nYöneticinizle iletişime geçin.'
      );
    }

    // ── 3. Buton cevapları → direkt yönlendir ────────────────
    if (text.startsWith('PERIOD:')) {
      return await cashflow.handleQuery({ from, question: text, dbName: user.dbName, lang: user.lang,
        licenseRestriction: user.cashflowRestriction, customerCardCode: user.customerCardCode });
    }
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
    if (text.startsWith('ONAY_DETAIL:')) {
      const wddCode = text.slice('ONAY_DETAIL:'.length).trim();
      return await approval.showOrderDetail({ from, wddCode });
    }
    if (text.startsWith('LANG:')) {
      const lang = text.slice('LANG:'.length).trim().toLowerCase();
      setLang(from, lang);
      return await sendText(from, t(lang, 'lang_changed'));
    }
    if (upper === 'SVC_SAVE')      return await confirmServiceCall(from);
    if (upper === 'SVC_CANCEL')    { cancelServiceWizard(from); return await sendText(from, '🚫 Servis çağrısı iptal edildi.'); }
    if (upper === 'SVC_SERIAL:SKIP') {
      const ss = getServiceWizardState(from);
      if (ss) return await handleServiceWizardInput(from, '*');
    }
    if (text.startsWith('SVC_CUST:')) {
      const payload  = text.slice('SVC_CUST:'.length);
      const sepIdx   = payload.indexOf('|');
      const cardCode = sepIdx >= 0 ? payload.slice(0, sepIdx).trim() : payload.trim();
      const cardName = sepIdx >= 0 ? payload.slice(sepIdx + 1).trim() : '';
      return await handleServiceCustomerSelection(from, cardCode, cardName);
    }
    if (text.startsWith('SVC_PRI:')) {
      return await handleServicePriority(from, text.slice('SVC_PRI:'.length).trim());
    }
    if (upper === 'ACT_SAVE')      return await confirmActivity(from);
    if (upper === 'ACT_LOC:SKIP')  return await skipLocation(from);
    if (upper === 'ACT_ATTACH') {
      return await sendText(from,
        '📎 Dosyanızı veya fotoğrafınızı gönderin.\n' +
        '_(PDF, Word, Excel, görsel desteklenir — 5 dk içinde gönderilmeli)_'
      );
    }
    if (upper === 'ACT_DONE') {
      cancelAttachment(from);
      return;
    }
    if (upper === 'LEAD_SAVE')     return await confirmLead(from);
    if (upper === 'LEAD_CANCEL')   { cancelLeadWizard(from); return await sendText(from, '🚫 Aday müşteri ekleme iptal edildi.'); }
    if (upper === 'ACT_CANCEL')    { cancelActivityWizard(from); return await sendText(from, '🚫 Aktivite iptal edildi.'); }
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
    if (text.startsWith('ACT_DATE:')) {
      return await handleWizardDateSelection(from, text.replace('ACT_DATE:', '').trim());
    }
    if (text.startsWith('ACT_TIME:')) {
      return await handleWizardTimeSelection(from, text.replace('ACT_TIME:', '').trim());
    }

    // ── 4. Wizard modu ───────────────────────────────────────
    // Herhangi bir adımda "iptal / vazgeç / cancel" → wizard'ı temizle
    const _inWizard = getLeadWizardState(from) || getWizardState(from) || getServiceWizardState(from);
    if (_inWizard && /^(iptal|vazgeç|vazgec|cancel|çıkış|cikis|dur|kapat)$/i.test(upper)) {
      cancelLeadWizard(from);
      cancelActivityWizard(from);
      cancelServiceWizard(from);
      return await sendText(from, '🚫 İşlem iptal edildi.');
    }

    if (getLeadWizardState(from))    return await handleLeadWizardInput(from, text);
    if (getWizardState(from))        return await handleWizardInput(from, text);
    if (getServiceWizardState(from)) return await handleServiceWizardInput(from, text);

    // ── 5. Intent belirle (keyword → Claude Haiku fallback) ──
    const intent = await detectIntentLocal(text);
    console.log(`[Router] (${from}/${user.license}) "${text}" → ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`);

    // ── 5. Lisans kontrolü ───────────────────────────────────
    if (!canAccessIntent(user, intent.intent)) {
      return await sendText(from, t(user.lang, 'license_denied', { license: user.license }));
    }

    // ── 6. Modüle yönlendir ───────────────────────────────────
    switch (intent.intent) {

      case 'login': {
        if (!user.userCode) {
          return await sendText(from, '⛔ Müşteri hesapları için oturum açma özelliği bulunmamaktadır.');
        }
        setAwaitingPassword(from, { userCode: user.userCode, userName: user.name });
        return await sendText(from, t(user.lang, 'login_prompt', { name: user.name }));
      }

      case 'logout': {
        const session = getSession(from);
        if (session) {
          deleteSession(from);
          return await sendText(from, t(user.lang, 'logout_success', { name: session.userName }));
        }
        return await sendText(from, t(user.lang, 'no_session'));
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
        return await cashflow.handleQuery({ from, question: text, licenseRestriction: user.cashflowRestriction, customerCardCode: user.customerCardCode, lang: user.lang });

      case 'approval': {
        const docMatch = text.match(/\d+/);
        const docEntry = docMatch ? docMatch[0] : null;
        if (/onayla/i.test(text)) return await approval.confirmApproval({ from, docEntry, action: 'approve' });
        if (/reddet/i.test(text)) return await approval.confirmApproval({ from, docEntry, action: 'reject' });
        return await approval.handleApproval({ from, docEntry });
      }

      case 'service_call': {
        const session = getSession(from);
        if (!session) {
          return await sendText(from, t(user.lang, 'login_required'));
        }
        return await handleCreateServiceCall({ from, session, dbName: user.dbName });
      }

      case 'lang':
        return await sendButtons(from,
          t(user.lang, 'lang_select'),
          '🇹🇷 Türkçe  |  🇬🇧 English  |  🇸🇦 العربية',
          [
            { id: 'LANG:tr', title: '🇹🇷 Türkçe'  },
            { id: 'LANG:en', title: '🇬🇧 English'  },
            { id: 'LANG:ar', title: '🇸🇦 العربية' },
          ]
        );

      case 'support':
        return await support.handleSupport({ from, question: text });

      case 'help':
      default:
        return await sendText(from, t(user.lang, 'help_menu'));
    }

  } catch (err) {
    console.error(`[Router] Hata (${from}):`, err.message);
    await sendText(from, t(getLang(from), 'error_general'));
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

  if (t === 'yardım' || t === 'menü' || t === 'yardım?' || t === 'ne yapabilirsin' || t === 'ne yapabilirsin?' ||
      t === 'help' || t === 'مساعدة')
    return { intent: 'help', confidence: 0.97, reason: 'keyword' };

  if (t === 'dil seç' || t === 'select language' || t === 'اختر اللغة' || t === '/dil' || t === '/lang')
    return { intent: 'lang', confidence: 0.99, reason: 'keyword' };

  if (t.includes('onayla') || t.includes('reddet') || t.includes('bekleyen onay') || t.includes('onay bekleyen'))
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
    /aktivite\s+(oluştur|ekle|yaz|kaydet|gir|aç|başlat)/.test(t) ||
    /(oluştur|ekle|yaz|kaydet|gir|aç)\s+aktivite/.test(t) ||
    /aktivite\s+gir/.test(t) ||
    /toplantı\s+(yaptık|ekle|oluştur|kaydı|gir)/.test(t) ||
    /telefon görüşmesi (ekle|yaptım|kaydı|oluştur|gir)/.test(t) ||
    /(not|görev) ekle/.test(t) ||
    /(aradım|ziyaret ettim|görüştük|konuştuk|toplantı yaptık)/.test(t)
  )
    return { intent: 'crm', confidence: 0.90, reason: 'keyword' };

  // Depo seri stok sorgusu
  if (
    /depo\s*(stoğ|stoku|listesi|sorgula|mallar)/.test(t) ||
    /depodaki\s*(mal|ürün|stok)/.test(t) ||
    /\b[a-z]\d+\s+depo/.test(t)
  )
    return { intent: 'cashflow', confidence: 0.93, reason: 'keyword-warehouse-stock' };

  // Servis listeleme / sorgulama (cashflow'a gitmeli)
  if (
    /(serviste|servislerde)\s*(bekleyen|açık|devam|liste)/.test(t) ||
    /bekleyen\s+servis/.test(t) ||
    /servis\s+(listesi|kayıtları|durumu|sorgula|göster|sorgulama)/.test(t) ||
    /teknik\s+servis\s+(listesi|kayıt|bekleyen|açık|sorgula)/.test(t)
  )
    return { intent: 'cashflow', confidence: 0.93, reason: 'keyword-service-list' };

  // Servis çağrısı oluşturma
  if (
    /servis\s+(çağrısı|çagri)\s*(oluştur|aç|ekle|kaydet|bildir)/.test(t) ||
    /arıza\s*(bildir|kaydı|aç|oluştur)/.test(t) ||
    /teknik\s+destek\s*(talebi|oluştur|aç)/.test(t) ||
    t === 'servis çağrısı' || t === 'arıza bildir'
  )
    return { intent: 'service_call', confidence: 0.95, reason: 'keyword' };

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
- "crm"          → Aktivite/toplantı/görüşme KAYDETME veya OLUŞTURMA (geçmişte olan)
- "lead"         → Yeni aday müşteri / lead / potansiyel müşteri EKLEME veya TANIMLAMA
- "service_call" → Servis çağrısı / arıza bildirimi / teknik destek talebi OLUŞTURMA
- "support"      → SAP hata mesajları, nasıl yapılır soruları, teknik destek
- "help"      → Yardım menüsü

KRİTİK: Aktivite/toplantı GÖRME → cashflow | Aktivite OLUŞTURMA → crm | Aday müşteri ekleme → lead
KRİTİK: Bekleyen/açık servis GÖRME/LISTELEME → cashflow | Servis çağrısı OLUŞTURMA/AÇMA → service_call

YANIT (sadece JSON):
{"intent":"cashflow","confidence":0.9,"reason":"kısa açıklama"}`;

async function _claudeIntent(text) {
  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system: [{ type: 'text', text: INTENT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages:   [{ role: 'user', content: text }],
      },
      {
        headers: {
          'x-api-key':         config.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'prompt-caching-2024-07-31',
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

module.exports = { handleIncoming };
