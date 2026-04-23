'use strict';

// {key} → vars nesnesinden değer alır
const S = {
  unknown_user: {
    tr: '⛔ Bu numara sistemde kayıtlı değil. Yöneticinizle iletişime geçin.',
    en: '⛔ This number is not registered. Please contact your administrator.',
    ar: '⛔ هذا الرقم غير مسجل في النظام. يرجى التواصل مع المسؤول.',
  },
  login_required: {
    tr: '🔐 Bu işlem için giriş yapmanız gerekiyor.\n\nSAP B1 hesabınızla giriş yapmak için *giriş yap* yazın.',
    en: '🔐 You need to log in for this action.\n\nWrite *login* to sign in with your SAP B1 account.',
    ar: '🔐 تحتاج إلى تسجيل الدخول لهذه العملية.\n\nاكتب *دخول* لتسجيل الدخول.',
  },
  login_prompt: {
    tr: '🔐 *SAP Girişi*\n\nMerhaba *{name}*,\nLütfen SAP B1 şifrenizi yazın.\n\n_⚠️ Mesajınız 2 dakika içinde işlenecektir._',
    en: '🔐 *SAP Login*\n\nHello *{name}*,\nPlease enter your SAP B1 password.\n\n_⚠️ Your message will be processed within 2 minutes._',
    ar: '🔐 *تسجيل دخول SAP*\n\nمرحباً *{name}*،\nالرجاء إدخال كلمة مرور SAP B1.\n\n_⚠️ ستتم معالجة رسالتك خلال دقيقتين._',
  },
  login_success: {
    tr: '✅ Giriş başarılı! Hoş geldiniz, *{name}*!\n\nSize nasıl yardımcı olabilirim? _yardım_ yazın.',
    en: '✅ Login successful! Welcome, *{name}*!\n\nHow can I help you? Type _help_.',
    ar: '✅ تم تسجيل الدخول بنجاح! أهلاً بك، *{name}*!\n\nكيف يمكنني مساعدتك؟ اكتب _مساعدة_.',
  },
  login_failed: {
    tr: '❌ Şifre hatalı. Lütfen tekrar deneyin.',
    en: '❌ Incorrect password. Please try again.',
    ar: '❌ كلمة المرور غير صحيحة. يرجى المحاولة مرة أخرى.',
  },
  login_expired: {
    tr: '⏰ Şifre girişi süresi doldu. Tekrar denemek için *giriş yap* yazın.',
    en: '⏰ Password entry timed out. Write *login* to try again.',
    ar: '⏰ انتهت مهلة إدخال كلمة المرور. اكتب *دخول* للمحاولة مرة أخرى.',
  },
  logout_success: {
    tr: '👋 Oturum kapatıldı. Görüşmek üzere, *{name}*!',
    en: '👋 Logged out. See you, *{name}*!',
    ar: '👋 تم تسجيل الخروج. إلى اللقاء، *{name}*!',
  },
  no_session: {
    tr: 'ℹ️ Zaten aktif bir oturumunuz bulunmuyor.',
    en: 'ℹ️ You don\'t have an active session.',
    ar: 'ℹ️ ليس لديك جلسة نشطة حالياً.',
  },
  license_denied: {
    tr: '⛔ *Yetersiz Lisans*\n\n*{license}* lisansınız bu işlem için yeterli değil.\n\nKullanabileceğiniz özellikler için *yardım* yazın.',
    en: '⛔ *Insufficient License*\n\nYour *{license}* license is not sufficient for this operation.\n\nType *help* to see available features.',
    ar: '⛔ *ترخيص غير كافٍ*\n\nترخيص *{license}* الخاص بك غير كافٍ لهذه العملية.\n\nاكتب *مساعدة* لعرض الميزات المتاحة.',
  },
  error_general: {
    tr: '⚠️ Bir hata oluştu. Lütfen tekrar deneyin veya *yardım* yazın.',
    en: '⚠️ An error occurred. Please try again or type *help*.',
    ar: '⚠️ حدث خطأ. يرجى المحاولة مرة أخرى أو اكتب *مساعدة*.',
  },
  lang_changed: {
    tr: '🌐 Dil Türkçe olarak ayarlandı.',
    en: '🌐 Language set to English.',
    ar: '🌐 تم تعيين اللغة إلى العربية.',
  },
  lang_select: {
    tr: '🌐 *Dil Seçimi*\nTercih ettiğiniz dili seçin:',
    en: '🌐 *Language Selection*\nChoose your preferred language:',
    ar: '🌐 *اختيار اللغة*\nاختر لغتك المفضلة:',
  },
  help_menu: {
    tr: [
      '📋 *SAP WhatsApp Bot — Yardım*\n',
      '💼 *Sorgulama*',
      '  • Bakiye, açık fatura, ekstre',
      '  • Stok durumu, sipariş takip',
      '  • Servis çağrıları\n',
      '✅ *Onay İşlemleri*',
      '  • Bekleyen onayları görüntüle',
      '  • Onayla / Reddet\n',
      '📝 *Aktivite Kaydı*',
      '  • "aktivite oluştur" → CRM wizard\n',
      '🔧 *Servis Çağrısı*',
      '  • "arıza bildir" → Servis wizard\n',
      '🆕 *Aday Müşteri*',
      '  • "aday müşteri ekle" → Lead wizard\n',
      '🌐 Dil: *dil seç*  |  🚪 Çıkış: *çıkış yap*',
    ].join('\n'),
    en: [
      '📋 *SAP WhatsApp Bot — Help*\n',
      '💼 *Queries*',
      '  • Balance, open invoices, statement',
      '  • Stock status, order tracking',
      '  • Service calls\n',
      '✅ *Approval*',
      '  • View pending approvals',
      '  • Approve / Reject\n',
      '📝 *Activity*',
      '  • "create activity" → CRM wizard\n',
      '🔧 *Service Call*',
      '  • "report issue" → Service wizard\n',
      '🆕 *Lead*',
      '  • "add lead" → Lead wizard\n',
      '🌐 Language: *select language*  |  🚪 Logout: *logout*',
    ].join('\n'),
    ar: [
      '📋 *SAP WhatsApp Bot — مساعدة*\n',
      '💼 *الاستفسارات*',
      '  • الرصيد والفواتير المفتوحة وكشف الحساب',
      '  • حالة المخزون وتتبع الطلبات',
      '  • طلبات الخدمة\n',
      '✅ *الموافقات*',
      '  • عرض الموافقات المعلقة',
      '  • موافقة / رفض\n',
      '📝 *نشاط CRM*',
      '  • "إنشاء نشاط" ← معالج CRM\n',
      '🔧 *طلب الخدمة*',
      '  • "الإبلاغ عن عطل" ← معالج الخدمة\n',
      '🌐 اللغة: *اختر اللغة*  |  🚪 خروج: *خروج*',
    ].join('\n'),
  },
};

// Anahtar metni döndürür; {var} placeholderlarını vars ile doldurur
function t(lang, key, vars = {}) {
  const l   = lang && ['tr', 'en', 'ar'].includes(lang) ? lang : 'tr';
  const str = S[key]?.[l] ?? S[key]?.tr ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

// Claude'a dil talimatı (cashflow/support prompt'larına eklenir)
function langInstruction(lang) {
  if (lang === 'en') return 'Respond entirely in English.';
  if (lang === 'ar') return 'أجب بالكامل باللغة العربية.';
  return '';
}

module.exports = { t, langInstruction };
