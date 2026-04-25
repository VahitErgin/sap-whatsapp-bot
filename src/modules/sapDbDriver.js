'use strict';

/**
 * sapDbDriver.js
 *
 * MSSQL ve SAP HANA için birleşik veritabanı sürücü katmanı.
 *
 * SAP_DB_TYPE=mssql  (varsayılan) → Microsoft SQL Server — mssql paketi
 * SAP_DB_TYPE=hana               → SAP HANA           — hdb paketi
 *
 * Kullanım (sapDb.js içinden):
 *   const { execute, dbType } = require('./sapDbDriver');
 *   const rows = await execute(sql, { CardCode: 'C001', Top: 10 }, dbName);
 *
 * SQL MSSQL lehçesinde yazılır (@Param, TOP (@N), WITH(NOLOCK) vb.).
 * HANA modunda otomatik transpile edilir.
 *
 * HANA kurulumu (müşteri sunucusunda):
 *   npm install hdb
 *   .env → SAP_DB_TYPE=hana, SAP_DB_PORT=30015 (HANA default port)
 */

const config = require('../config/config');

const DB_TYPE = (process.env.SAP_DB_TYPE || 'mssql').toLowerCase();

// ─────────────────────────────────────────────────────────────
// Dışarıya açık: hangi sürücü aktif
// ─────────────────────────────────────────────────────────────
const dbType = DB_TYPE; // 'mssql' | 'hana'

// ─────────────────────────────────────────────────────────────
// SQL Transpiler: MSSQL → HANA
// ─────────────────────────────────────────────────────────────
function _toHana(sql) {
  return sql
    // WITH(NOLOCK) HANA'da desteklenmiyor — kaldır
    .replace(/\bWITH\s*\(\s*NOLOCK\s*\)/gi, '')
    // ISNULL → IFNULL
    .replace(/\bISNULL\s*\(/gi, 'IFNULL(')
    // GETDATE() → CURRENT_TIMESTAMP
    .replace(/\bGETDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
    // DATEADD(YEAR,  n, expr) → ADD_YEARS(expr,  n)
    .replace(/DATEADD\s*\(\s*YEAR\s*,\s*(-?\d+)\s*,\s*([^)]+)\)/gi,   'ADD_YEARS($2, $1)')
    // DATEADD(MONTH, n, expr) → ADD_MONTHS(expr, n)
    .replace(/DATEADD\s*\(\s*MONTH\s*,\s*(-?\d+)\s*,\s*([^)]+)\)/gi,  'ADD_MONTHS($2, $1)')
    // DATEADD(DAY,   n, expr) → ADD_DAYS(expr,   n)
    .replace(/DATEADD\s*\(\s*DAY\s*,\s*(-?\d+)\s*,\s*([^)]+)\)/gi,    'ADD_DAYS($2, $1)')
    // SELECT TOP (@N) → SELECT TOP <N değeri runtime'da enjekte edilir>
    // TOP ile çalışan HANA sürümlerinde TOP desteklenir; eski sürümlerde LIMIT gerekir.
    // Positional param dönüşümü _namedToPositional() ile yapılır.
    .replace(/SELECT\s+TOP\s+\(@(\w+)\)/gi, 'SELECT TOP ?__$1__?');
}

// Named params (@Name) → positional (?) + değer dizisi
// sql içindeki ?__Name__? veya @Name kalıplarını sırayla değiştirir
function _namedToPositional(sql, params) {
  const values = [];

  // Önce TOP placeholder'larını çöz: ?__Name__? → ?
  let out = sql.replace(/\?__(\w+)__\?/g, (_, name) => {
    values.push(params[name]);
    return '?';
  });

  // Sonra kalan @Name parametrelerini çöz
  out = out.replace(/@(\w+)/g, (_, name) => {
    values.push(params[name]);
    return '?';
  });

  return { sql: out, values };
}

// ─────────────────────────────────────────────────────────────
// MSSQL sürücüsü
// ─────────────────────────────────────────────────────────────
const _mssqlPools = {};

async function _getMssqlPool(dbName) {
  const mssql = require('mssql');
  const db    = dbName || config.sapDb.database;
  if (_mssqlPools[db] && _mssqlPools[db].connected) return _mssqlPools[db];

  const cfg = {
    server:   config.sapDb.server,
    database: db,
    user:     config.sapDb.user,
    password: config.sapDb.password,
    options:  { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
  console.log(`[SapDb/MSSQL] Bağlanıyor → ${config.sapDb.server} / ${db}`);
  _mssqlPools[db] = await mssql.connect(cfg);
  console.log(`[SapDb/MSSQL] Bağlantı başarılı → ${db}`);
  return _mssqlPools[db];
}

async function _executeMssql(rawSql, params, dbName) {
  const mssql = require('mssql');
  const pool  = await _getMssqlPool(dbName);
  const req   = pool.request();

  // Named param'ları mssql tipine göre ekle
  for (const [key, val] of Object.entries(params || {})) {
    if (val === null || val === undefined) {
      req.input(key, null);
    } else if (typeof val === 'number' && Number.isInteger(val)) {
      req.input(key, mssql.Int, val);
    } else if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val))) {
      req.input(key, mssql.Date, val);
    } else {
      req.input(key, mssql.NVarChar(500), val);
    }
  }

  const result = await req.query(rawSql);
  return result.recordset;
}

// ─────────────────────────────────────────────────────────────
// HANA sürücüsü
// ─────────────────────────────────────────────────────────────
let _hanaClient = null;

async function _getHanaConn() {
  if (_hanaClient && _hanaClient.readyState === 'connected') return _hanaClient;

  // hdb paketi opsiyonel — yalnızca HANA modunda gerekli
  let hdb;
  try { hdb = require('hdb'); } catch {
    throw new Error('HANA modu için "npm install hdb" gerekli (SAP_DB_TYPE=hana)');
  }

  const cfg = {
    host:     config.sapDb.server,
    port:     parseInt(process.env.SAP_DB_PORT || '30015'),
    user:     config.sapDb.user,
    password: config.sapDb.password,
    databaseName: config.sapDb.database,
  };

  console.log(`[SapDb/HANA] Bağlanıyor → ${cfg.host}:${cfg.port} / ${cfg.databaseName}`);
  _hanaClient = hdb.createClient(cfg);

  await new Promise((resolve, reject) => {
    _hanaClient.connect(err => err ? reject(err) : resolve());
  });

  console.log(`[SapDb/HANA] Bağlantı başarılı → ${cfg.databaseName}`);
  return _hanaClient;
}

async function _executeHana(rawSql, params, _dbName) {
  const conn = await _getHanaConn();

  // SQL'i HANA lehçesine çevir, named → positional
  const hanaSql             = _toHana(rawSql);
  const { sql: finalSql, values } = _namedToPositional(hanaSql, params || {});

  const rows = await new Promise((resolve, reject) => {
    conn.exec(finalSql, values, (err, result) => err ? reject(err) : resolve(result));
  });

  return rows;
}

// ─────────────────────────────────────────────────────────────
// Birleşik execute — dışarıya açık tek fonksiyon
// ─────────────────────────────────────────────────────────────
async function execute(sql, params, dbName) {
  if (DB_TYPE === 'hana') return await _executeHana(sql, params, dbName);
  return await _executeMssql(sql, params, dbName);
}

// ─────────────────────────────────────────────────────────────
// MSSQL için geriye dönük uyumluluk: getPool()
// sapDb.js içindeki eski request.input() tabanlı kodlar için
// ─────────────────────────────────────────────────────────────
async function getPool(dbName) {
  if (DB_TYPE === 'hana') throw new Error('getPool() HANA modunda kullanılamaz — execute() kullanın');
  return await _getMssqlPool(dbName);
}

module.exports = { execute, getPool, dbType };
