'use strict';

/**
 * sapClient.js
 *
 * C# B1SLayer / SLConnection mantığını Node.js'e taşır.
 * Her şirket DB'si için ayrı session tutulur (Dictionary<string, SLConnection>).
 *
 * Kullanım:
 *   const { getConnection } = require('./sapClient');
 *   const sl = getConnection('TESTFKC');
 *   const orders = await sl.get('PurchaseOrders', { $filter: "DocumentStatus eq 'bost_Open'" });
 *   await sl.patch('PurchaseOrders', docEntry, { Comments: 'Onaylandı' });
 */

const axios  = require('axios');
const https  = require('https');
const config = require('../config/config');  // FIX: modules/ → config/ iki üst değil bir üst

// ─── SSL: Self-signed sertifikayı atla ───────────────────────
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─── Dictionary: dbName → SLConnection instance ──────────────
const _connections = {};

// ─────────────────────────────────────────────────────────────
// SLConnection: Tek bir şirkete ait session + HTTP istemcisi
// ─────────────────────────────────────────────────────────────
class SLConnection {
  constructor(serviceLayerUrl, companyDb, username, password) {
    this.baseUrl    = serviceLayerUrl.replace(/\/$/, ''); // trailing slash kaldır
    this.companyDb  = companyDb;
    this.username   = username;
    this.password   = password;
    this._cookie    = null;   // B1SESSION cookie
    this._loginTime = null;   // Son login zamanı
    this._sessionTtl = 25 * 60 * 1000; // 25 dakika (SAP default 30dk)

    // Her bağlantı kendi axios instance'ına sahip
    // baseURL: SAP_SERVICE_LAYER_URL zaten /b1s/v1/ veya /b1s/v2/ içeriyor,
    // trailing slash'i normalize edip doğrudan kullan
    this._http = axios.create({
      baseURL:    `${this.baseUrl}/`,
      httpsAgent,
      headers:    { 'Content-Type': 'application/json' },
      timeout:    30000,
    });
  }

  // ── Session geçerli mi? ──────────────────────────────────
  _isSessionValid() {
    return (
      this._cookie !== null &&
      this._loginTime !== null &&
      Date.now() - this._loginTime < this._sessionTtl
    );
  }

  // ── SAP'a login ol, cookie al ────────────────────────────
  async _login() {
    console.log(`[SAP] Login → ${this.companyDb}`);
    const res = await this._http.post('Login', {
      CompanyDB: this.companyDb,
      UserName:  this.username,
      Password:  this.password,
    });

    // Cookie'yi header'dan çek
    const setCookie = res.headers['set-cookie'];
    if (!setCookie) throw new Error(`[SAP] Login başarılı ama cookie gelmedi – ${this.companyDb}`);

    // B1SESSION=xxx; path=/ formatından değeri al
    const b1Cookie = setCookie.find(c => c.startsWith('B1SESSION'));
    if (!b1Cookie) throw new Error(`[SAP] B1SESSION cookie bulunamadı – ${this.companyDb}`);

    this._cookie    = b1Cookie.split(';')[0]; // sadece "B1SESSION=xxx"
    this._loginTime = Date.now();
    console.log(`[SAP] Login başarılı → ${this.companyDb}`);
  }

  // ── Session'ı garantile (gerekirce login yap) ────────────
  async _ensureSession() {
    if (!this._isSessionValid()) {
      await this._login();
    }
  }

  // ── Cookie header'ını hazırla ────────────────────────────
  _cookieHeader() {
    return { Cookie: this._cookie };
  }

  // ─────────────────────────────────────────────────────────
  // Public API – C# B1SLayer'daki Request() metoduna karşılık
  // ─────────────────────────────────────────────────────────

  /**
   * GET  → sl.get('PurchaseOrders', { $filter: "...", $select: "..." })
   */
  async get(resource, params = {}) {
    await this._ensureSession();
    try {
      const res = await this._http.get(resource, {
        params,
        headers: this._cookieHeader(),
      });
      return res.data;
    } catch (err) {
      return this._handleError(err, 'GET', resource);
    }
  }

  /**
   * GET tek kayıt → sl.getOne('PurchaseOrders', docEntry)
   */
  async getOne(resource, key) {
    return this.get(`${resource}(${key})`);
  }

  /**
   * POST (yeni kayıt) → sl.post('PurchaseOrders', payload)
   */
  async post(resource, data) {
    await this._ensureSession();
    try {
      const res = await this._http.post(resource, data, {
        headers: this._cookieHeader(),
      });
      return res.data;
    } catch (err) {
      return this._handleError(err, 'POST', resource);
    }
  }

  /**
   * PATCH (güncelle) → sl.patch('PurchaseOrders', docEntry, payload)
   */
  async patch(resource, key, data) {
    await this._ensureSession();
    try {
      const res = await this._http.patch(`${resource}(${key})`, data, {
        headers: this._cookieHeader(),
      });
      // PATCH başarılı → SAP genellikle 204 No Content döner
      return { success: true, status: res.status };
    } catch (err) {
      return this._handleError(err, 'PATCH', resource);
    }
  }

  /**
   * Action (özel SAP aksiyonları) → sl.action('PurchaseOrders', docEntry, 'Close')
   */
  async action(resource, key, actionName) {
    await this._ensureSession();
    try {
      const res = await this._http.post(`${resource}(${key})/${actionName}`, {}, {
        headers: this._cookieHeader(),
      });
      return { success: true, status: res.status };
    } catch (err) {
      return this._handleError(err, 'ACTION', `${resource}/${actionName}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Hata yönetimi – Session süresi dolduysa yeniden login
  // ─────────────────────────────────────────────────────────
  async _handleError(err, method, resource) {
    const status = err.response?.status;
    const sapMsg = err.response?.data?.error?.message?.value || err.message;

    // 401 → session süresi dolmuş, cookie sıfırla
    if (status === 401) {
      console.warn(`[SAP] Session sona erdi (${this.companyDb}), yeniden login...`);
      this._cookie    = null;
      this._loginTime = null;
      throw new Error(`SAP session sona erdi, tekrar dene`);
    }

    console.error(`[SAP] ${method} ${resource} → ${status}: ${sapMsg}`);
    throw new Error(sapMsg || 'SAP Service Layer hatası');
  }

  // ─────────────────────────────────────────────────────────
  // Logout (isteğe bağlı – sunucu kapanırken çağır)
  // ─────────────────────────────────────────────────────────
  async logout() {
    if (!this._cookie) return;
    try {
      await this._http.post('Logout', {}, { headers: this._cookieHeader() });
      console.log(`[SAP] Logout → ${this.companyDb}`);
    } catch (_) { /* sessiz geç */ }
    this._cookie    = null;
    this._loginTime = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton başlatıcı – config.js'ten DB listesini okur
// C# ServiceLayer static constructor'ına karşılık gelir
// ─────────────────────────────────────────────────────────────
function _init() {
  const { serviceLayerUrl, username, password, databases } = config.sap;

  // .env'de SAP_DATABASES=TESTFKC;B2B;PROD şeklinde tanımla
  // Tek DB varsa SAP_COMPANY_DB'yi de destekle (geriye dönük uyumluluk)
  const dbList = databases
    ? databases.split(';').map(d => d.trim()).filter(Boolean)
    : [config.sap.companyDb];

  for (const dbName of dbList) {
    _connections[dbName] = new SLConnection(serviceLayerUrl, dbName, username, password);
    console.log(`[SAP] Bağlantı tanımlandı → ${dbName}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Public: C# GetConnection(dbName) karşılığı
// ─────────────────────────────────────────────────────────────
function getConnection(dbName) {
  const db = dbName || config.sap.companyDb; // dbName verilmezse default DB

  if (_connections[db]) return _connections[db];

  throw new Error(
    `'${db}' isminde bir SAP bağlantısı bulunamadı. ` +
    `SAP_DATABASES veya SAP_COMPANY_DB env değişkenini kontrol et.`
  );
}

// ─────────────────────────────────────────────────────────────
// Uygulama başlarken init çalıştır
// ─────────────────────────────────────────────────────────────
_init();

module.exports = { getConnection, SLConnection };
