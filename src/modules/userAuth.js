'use strict';

const { getUserByPhone, getCustomerByPhone } = require('./sapDb');
const { getConnection }  = require('./sapClient');
const config             = require('../config/config');

// SAP B1 lisans tipi → bot erişim konfigürasyonu
const LICENSE_CONFIG = {
  'Professional': {
    allowedIntents:      null,   // null = tüm intentler
    cashflowRestriction: null,
  },
  'Limited Financial': {
    allowedIntents:      null,
    cashflowRestriction: 'KRİTİK KURAL: Kullanıcı Limited Financial lisansına sahip. ' +
      'SADECE finansal sorgulara izin ver: bakiye, fatura, ödeme, tahsilat, nakit akışı, cari hesap. ' +
      'Stok miktarı/fiyatı, lojistik, teslimat, satın alma sipariş içeriği YASAKTIR. ' +
      'Yasak sorgu gelirse kullanıcıya "Bu lisans tipiyle erişemezsiniz" de.',
  },
  'Limited Logistics': {
    allowedIntents:      null,
    cashflowRestriction: 'KRİTİK KURAL: Kullanıcı Limited Logistics lisansına sahip. ' +
      'SADECE lojistik sorgulara izin ver: stok MİKTARI, servis, teslimat, satın alma. ' +
      'Ürün FİYATLARINI asla gösterme. Finansal veriler (bakiye, fatura, nakit akışı) YASAKTIR. ' +
      'Yasak sorgu gelirse kullanıcıya "Bu lisans tipiyle erişemezsiniz" de.',
  },
  'Limited CRM': {
    allowedIntents:      null,
    cashflowRestriction: 'KRİTİK KURAL: Kullanıcı Limited CRM lisansına sahip. ' +
      'SADECE CRM sorgularına izin ver: müşteri bilgisi, aktivite, fırsat, servis çağrısı. ' +
      'Finansal veriler (bakiye, fatura) ve stok fiyatları YASAKTIR. ' +
      'Yasak sorgu gelirse kullanıcıya "Bu lisans tipiyle erişemezsiniz" de.',
  },
  'Starter Pack': {
    allowedIntents:      ['approval', 'support', 'help'],
    cashflowRestriction: null,
  },
};

// Tanımsız lisans → sadece temel işlemler
const DEFAULT_CONFIG = {
  allowedIntents:      ['approval', 'support', 'help'],
  cashflowRestriction: null,
};

// 10 dakika önbellek: phone10 → { user, expiresAt }
const _cache  = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Telefon → SAP kullanıcısı + lisans çözümleme
// Döndürür: user objesi veya null (OUSR'da bulunamadı)
// ─────────────────────────────────────────────────────────────
async function resolveUser(phone, dbName) {
  const phone10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!phone10) return null;

  const cached = _cache.get(phone10);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  // 1. OUSR: telefon → SAP dahili kullanıcı (çalışan)
  const ousr = await getUserByPhone(phone10, dbName);
  if (ousr) {
    let license = 'Professional';
    try {
      const sl       = getConnection(dbName || config.sap.companyDb);
      const userData = await sl.get(`Users('${ousr.USER_CODE}')`);
      license        = userData.UserLicense || 'Professional';
    } catch (err) {
      console.warn(`[UserAuth] SL lisans alınamadı (${ousr.USER_CODE}):`, err.message);
    }

    const licCfg = LICENSE_CONFIG[license] || DEFAULT_CONFIG;
    const user = {
      userCode:            ousr.USER_CODE,
      name:                ousr.U_NAME || ousr.USER_CODE,
      license,
      isCustomer:          false,
      customerCardCode:    null,
      allowedIntents:      licCfg.allowedIntents,
      cashflowRestriction: licCfg.cashflowRestriction,
    };

    _cache.set(phone10, { user, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[UserAuth] ${phone10} → ${user.userCode} (${license})`);
    return user;
  }

  // 2. OCPR: telefon → müşteri ilgili kişi (harici kullanıcı)
  const ocpr = await getCustomerByPhone(phone10, dbName);
  if (ocpr) {
    const user = {
      userCode:            null,
      name:                ocpr.ContactName || ocpr.CardName || phone10,
      license:             'Customer',
      isCustomer:          true,
      customerCardCode:    ocpr.CardCode,
      allowedIntents:      ['cashflow', 'support', 'help'],
      cashflowRestriction: null,
    };

    _cache.set(phone10, { user, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[UserAuth] ${phone10} → Müşteri ${ocpr.CardCode} (${ocpr.CardName})`);
    return user;
  }

  _cache.set(phone10, { user: null, expiresAt: Date.now() + CACHE_TTL });
  return null;
}

// ─────────────────────────────────────────────────────────────
// Kullanıcının verilen intent'e erişim izni var mı?
// ─────────────────────────────────────────────────────────────
function canAccessIntent(user, intent) {
  if (!user.allowedIntents) return true;
  return user.allowedIntents.includes(intent);
}

// Önbelleği temizle (test/admin amaçlı)
function clearCache(phone) {
  if (phone) {
    const phone10 = String(phone).replace(/\D/g, '').slice(-10);
    _cache.delete(phone10);
  } else {
    _cache.clear();
  }
}

module.exports = { resolveUser, canAccessIntent, clearCache };
