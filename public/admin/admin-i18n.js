'use strict';
/* Admin Panel – TR / EN i18n
   - Nav linkleri href'e göre otomatik çevrilir (HTML değişikliği gerekmez)
   - Sayfa başlıkları ve kartlar [data-i18n] attribute'u ile çevrilir
   - Dil tercihi localStorage'da saklanır: admin_lang = 'tr' | 'en'
*/

const ADMIN_DICT = {
  tr: {
    // Sidebar
    sidebar_sub:   'Yönetim Paneli',
    logout:        'Çıkış Yap',

    // Nav – href eşleşmesi
    nav_dashboard: 'Dashboard',
    nav_approvers: 'Onay Yetkilileri',
    nav_templates: 'Şablonlar',
    nav_tasks:     'Zamanlanmış Görevler',
    nav_logs:      'Mesaj Logları',
    nav_settings:  'Ayarlar',

    // Sayfa başlıkları
    page_dashboard: 'Dashboard',
    page_approvers: 'Onay Yetkilileri',
    page_templates: 'WhatsApp Şablonları',
    page_tasks:     'Zamanlanmış Görevler',
    page_logs:      'Mesaj Logları',
    page_settings:  'Ayarlar',

    // Kart başlıkları
    card_sap:       'SAP Service Layer Bağlantısı',
    card_wa:        'WhatsApp Business API',
    card_sql:       'SAP SQL Veritabanı (Direkt Bağlantı)',
    card_ai:        'Claude AI (Anthropic)',
    card_crm:       'CRM & Oturum Ayarları',
    card_edoc:      'E-Belge Entegrasyonu',
    card_lang_pref: 'Kullanıcı Dil Tercihleri',
    card_password:  'Panel Şifresi',
    card_approvers: 'Kayıtlı Yetkililer',
    card_status:    'Sistem Durumu',
    card_filter:    'Filtre',
    card_logs:      'Mesaj Listesi',

    // Butonlar
    btn_refresh:      'Yenile',
    btn_new:          'Yeni Ekle',
    btn_new_template: 'Yeni Şablon',
    btn_new_task:     'Yeni Görev',
    btn_save:         'Kaydet',
    btn_cancel:       'İptal',
    btn_test_sap:     'Bağlantıyı Test Et',
    btn_change_pw:    'Şifreyi Güncelle',
    btn_filter:       'Filtrele',

    // Form etiketleri – Dashboard
    lbl_sap_status:   'SAP Bağlantısı',
    lbl_server:       'Sunucu',
    lbl_approver_cnt: 'Onay Yetkilisi',
    lbl_uptime:       'Çalışma Süresi',

    // Form etiketleri – Settings
    lbl_session_timeout: 'Oturum Süresi (dakika)',
    lbl_attach_mb:       'Maks. Dosya Boyutu (MB)',
    lbl_crm_types:       'Aktif Aktivite Tipleri',
    lbl_crm_subjects:    'Aktivite Konuları',
    lbl_efatura:         'E-Fatura Görüntüleme URL',
    lbl_earsiv:          'E-Arşiv Görüntüleme URL',
    lbl_eirsaliye:       'E-İrsaliye Görüntüleme URL',
    lbl_lang_note:       'Kayıtlı tercih yok (hepsi varsayılan TR)',
    lbl_cur_pw:          'Mevcut Şifre',
    lbl_new_pw:          'Yeni Şifre',
    lbl_new_pw2:         'Yeni Şifre (Tekrar)',

    // Approvers
    lbl_phone:       'Telefon',
    lbl_name:        'İsim',
    lbl_actions:     'İşlem',

    // Tasks
    lbl_task_type:    'Görev Tipi',
    lbl_task_name:    'Görev Adı',
    lbl_task_time:    'Gönderim Saati',
    lbl_task_active:  'Aktif',
    lbl_task_phones:  'Telefon Numaraları',
    lbl_task_query:   'SQL Sorgusu',
    btn_edit:         'Düzenle',

    // Logs
    lbl_date_from: 'Başlangıç Tarihi',
    lbl_date_to:   'Bitiş Tarihi',
    lbl_direction: 'Yön',
    lbl_dir_all:   'Tümü',
    lbl_dir_in:    'Gelen',
    lbl_dir_out:   'Giden',
  },

  en: {
    // Sidebar
    sidebar_sub:   'Admin Panel',
    logout:        'Logout',

    // Nav
    nav_dashboard: 'Dashboard',
    nav_approvers: 'Approvers',
    nav_templates: 'Templates',
    nav_tasks:     'Scheduled Tasks',
    nav_logs:      'Message Logs',
    nav_settings:  'Settings',

    // Page titles
    page_dashboard: 'Dashboard',
    page_approvers: 'Approvers',
    page_templates: 'WhatsApp Templates',
    page_tasks:     'Scheduled Tasks',
    page_logs:      'Message Logs',
    page_settings:  'Settings',

    // Cards
    card_sap:       'SAP Service Layer Connection',
    card_wa:        'WhatsApp Business API',
    card_sql:       'SAP SQL Database (Direct Connection)',
    card_ai:        'Claude AI (Anthropic)',
    card_crm:       'CRM & Session Settings',
    card_edoc:      'E-Document Integration',
    card_lang_pref: 'User Language Preferences',
    card_password:  'Admin Password',
    card_approvers: 'Registered Approvers',
    card_status:    'System Status',
    card_filter:    'Filter',
    card_logs:      'Message List',

    // Buttons
    btn_refresh:      'Refresh',
    btn_new:          'Add New',
    btn_new_template: 'New Template',
    btn_new_task:     'New Task',
    btn_save:         'Save',
    btn_cancel:       'Cancel',
    btn_test_sap:     'Test Connection',
    btn_change_pw:    'Update Password',
    btn_filter:       'Filter',

    // Dashboard labels
    lbl_sap_status:   'SAP Connection',
    lbl_server:       'Server',
    lbl_approver_cnt: 'Approvers',
    lbl_uptime:       'Uptime',

    // Settings labels
    lbl_session_timeout: 'Session Timeout (min)',
    lbl_attach_mb:       'Max File Size (MB)',
    lbl_crm_types:       'Active Activity Types',
    lbl_crm_subjects:    'Activity Subjects',
    lbl_efatura:         'E-Invoice View URL',
    lbl_earsiv:          'E-Archive View URL',
    lbl_eirsaliye:       'E-Waybill View URL',
    lbl_lang_note:       'No saved preferences (all default TR)',
    lbl_cur_pw:          'Current Password',
    lbl_new_pw:          'New Password',
    lbl_new_pw2:         'Confirm New Password',

    // Approvers
    lbl_phone:   'Phone',
    lbl_name:    'Name',
    lbl_actions: 'Actions',

    // Tasks
    lbl_task_type:   'Task Type',
    lbl_task_name:   'Task Name',
    lbl_task_time:   'Send Time',
    lbl_task_active: 'Active',
    lbl_task_phones: 'Phone Numbers',
    lbl_task_query:  'SQL Query',
    btn_edit:        'Edit',

    // Logs
    lbl_date_from: 'Start Date',
    lbl_date_to:   'End Date',
    lbl_direction: 'Direction',
    lbl_dir_all:   'All',
    lbl_dir_in:    'Incoming',
    lbl_dir_out:   'Outgoing',
  },
};

// href → dict key eşlemesi
const NAV_HREF_MAP = {
  '/admin':           'nav_dashboard',
  '/admin/approvers': 'nav_approvers',
  '/admin/templates': 'nav_templates',
  '/admin/tasks':     'nav_tasks',
  '/admin/logs':      'nav_logs',
  '/admin/settings':  'nav_settings',
};

// ─── Genel yardımcılar ─────────────────────────────────────
function getAdminLang() {
  return localStorage.getItem('admin_lang') || 'tr';
}

window.setAdminLang = function(lang) {
  localStorage.setItem('admin_lang', lang);
  applyAdminI18n();
};

function t(key) {
  const lang = getAdminLang();
  return (ADMIN_DICT[lang] || ADMIN_DICT.tr)[key] || (ADMIN_DICT.tr)[key] || key;
}
window.adminT = t;

// ─── Uygulama ──────────────────────────────────────────────
function applyAdminI18n() {
  const lang = getAdminLang();

  // Sidebar alt başlık
  const sub = document.querySelector('.sidebar-sub');
  if (sub) sub.textContent = t('sidebar_sub');

  // Sidebar logout linki
  const logoutLink = document.querySelector('.sidebar-footer > a');
  if (logoutLink) {
    const icon = logoutLink.querySelector('i');
    logoutLink.textContent = ' ' + t('logout');
    if (icon) logoutLink.prepend(icon);
  }

  // Sidebar nav linkleri – href'e göre çevir, ikonu koru
  document.querySelectorAll('#sidebar nav a.nav-link').forEach(a => {
    const href = a.getAttribute('href');
    const key  = NAV_HREF_MAP[href];
    if (!key) return;
    const icon = a.querySelector('i');
    a.textContent = ' ' + t(key);
    if (icon) a.prepend(icon);
  });

  // data-i18n attribute'lu elemanlar – ikonu koru
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (!val || val === el.dataset.i18n) return;
    const icon = el.querySelector('i');
    el.textContent = val;
    if (icon) el.prepend(icon);
  });

  // Dil toggle butonlarını güncelle
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.classList.toggle('active-lang', btn.dataset.langBtn === lang);
  });
}

// ─── Dil toggle butonunu sidebar footer'a ekle ─────────────
function injectLangToggle() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer || footer.querySelector('.admin-lang-toggle')) return;

  const div = document.createElement('div');
  div.className = 'admin-lang-toggle mb-2 d-flex gap-1';
  div.innerHTML = `
    <button data-lang-btn="tr" onclick="setAdminLang('tr')"
      style="flex:1;padding:3px 0;font-size:.72rem;border-radius:4px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#94a3b8;cursor:pointer">
      🇹🇷 TR
    </button>
    <button data-lang-btn="en" onclick="setAdminLang('en')"
      style="flex:1;padding:3px 0;font-size:.72rem;border-radius:4px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#94a3b8;cursor:pointer">
      🇬🇧 EN
    </button>`;
  footer.prepend(div);
}

// ─── Başlat ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  injectLangToggle();
  applyAdminI18n();

  // Aktif dil butonunu vurgula için CSS
  const style = document.createElement('style');
  style.textContent = '.admin-lang-toggle button.active-lang{background:rgba(107,178,235,.2)!important;color:#6cb2eb!important;border-color:#6cb2eb!important}';
  document.head.appendChild(style);
});
