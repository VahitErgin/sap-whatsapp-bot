'use strict';

// ─────────────────────────────────────────────────────────────
// sapAuth.js
//
// WhatsApp kullanıcısının SAP B1 şifresiyle kimliğini doğrular.
// Doğrulama başarılıysa employee ID'yi de döndürür (HandledBy için).
// ─────────────────────────────────────────────────────────────

const axios  = require('axios');
const https  = require('https');
const sql    = require('mssql');
const config = require('../config/config');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─────────────────────────────────────────────────────────────
// SAP'a kullanıcı adı + şifre ile login dene
// Döndürür: { success: true, employeeId } | { success: false, error }
// ─────────────────────────────────────────────────────────────
async function loginUser(userCode, password, dbName) {
  const baseUrl = config.sap.serviceLayerUrl.replace(/\/$/, '');
  const db      = dbName || config.sap.companyDb;

  try {
    const res = await axios.post(
      `${baseUrl}/Login`,
      { CompanyDB: db, UserName: userCode, Password: password },
      { httpsAgent, timeout: 10000 }
    );
    // B1SESSION cookie'yi al
    const setCookie = res.headers['set-cookie'] || [];
    const b1Cookie  = setCookie.find(c => c.startsWith('B1SESSION'));
    const b1session = b1Cookie ? b1Cookie.split(';')[0].replace('B1SESSION=', '') : null;

    const employeeId = await _getEmployeeId(userCode, db);
    return { success: true, employeeId, b1session };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 400) {
      return { success: false, error: 'Kullanıcı adı veya şifre hatalı.' };
    }
    console.error('[SapAuth] Login hatası:', err.message);
    return { success: false, error: 'SAP bağlantı hatası. Lütfen tekrar deneyin.' };
  }
}

// OHEM tablosundan employee ID — HandledBy alanı için
async function _getEmployeeId(userCode, dbName) {
  try {
    const cfg = {
      server:   config.sapDb.server,
      database: dbName || config.sapDb.database,
      user:     config.sapDb.user,
      password: config.sapDb.password,
      options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    };
    const pool    = await sql.connect(cfg);
    const request = pool.request();
    request.input('UserCode', sql.NVarChar(50), userCode);

    const result = await request.query(`
      SELECT TOP 1 e.empID
      FROM OHEM e WITH(NOLOCK)
      INNER JOIN OUSR u WITH(NOLOCK) ON e.userId = u.userSign
      WHERE u.USER_CODE = @UserCode
    `);
    await pool.close();
    return result.recordset[0]?.empID || null;
  } catch {
    return null;
  }
}

module.exports = { loginUser };
