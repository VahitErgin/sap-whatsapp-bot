'use strict';

/**
 * salesDocWizard.js
 *
 * Pazarlama belgesi oluşturma wizard'ı (satış/alım belgesi).
 * Desteklenen tipler: Teklif, Sipariş, Fatura, İrsaliye, Alım Siparişi, Alım Faturası
 *
 * Adımlar:
 *   1. docType   → belge tipi seçimi
 *   2. partner   → müşteri/tedarikçi arama
 *   3. itemSearch → ürün arama + seçim
 *   4. itemQty   → miktar
 *   5. itemPrice → fiyat onayı (varsayılan fiyat listesi)
 *   6. serialCollect / batchCollect / batchQty  (seri/parti varsa)
 *   7. addMore   → başka ürün veya özet
 *   8. summary   → onay/iptal
 */

const { sendText, sendButtons, sendList } = require('../services/whatsappService');
const { searchPartners, searchItems, getPartnerInfo, getItemPrice,
        getAvailableSerials, getAvailableBatches } = require('./sapDb');
const { getConnection } = require('./sapClient');
const config = require('../config/config');

const WIZARD_TTL  = 15 * 60 * 1000;
const PENDING_TTL =  5 * 60 * 1000;

const _wizard  = new Map();
const _pending = new Map();

function _norm(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

// ─── Belge tipi kataloğu ────────────────────────────────────────────
// draftCode → SAP B1 SL /Drafts endpoint'inde DocObjectCode (BoObjectTypes enum, plural)
const DOC_TYPES = [
  { id: 'Quotations',       label: 'Satış Teklifi',       icon: '📋', isBuy: false, draftCode: 'oQuotations'       },
  { id: 'Orders',           label: 'Satış Siparişi',      icon: '📦', isBuy: false, draftCode: 'oOrders'           },
  { id: 'Invoices',         label: 'Satış Faturası',      icon: '🧾', isBuy: false, draftCode: 'oInvoices'         },
  { id: 'DeliveryNotes',    label: 'Müşteri İrsaliyesi',  icon: '🚚', isBuy: false, draftCode: 'oDeliveryNotes'    },
  { id: 'CreditNotes',      label: 'İade Talebi',         icon: '↩️', isBuy: false, draftCode: 'oCreditNotes'      },
  { id: 'PurchaseOrders',   label: 'Alım Siparişi',       icon: '🛒', isBuy: true,  draftCode: 'oPurchaseOrders'   },
  { id: 'PurchaseInvoices', label: 'Alım Faturası',       icon: '📑', isBuy: true,  draftCode: 'oPurchaseInvoices' },
];

// ─── Yardımcılar ────────────────────────────────────────────────────
const CANCEL_RE = /^(iptal|vazgeç|vazgec|cancel|çıkış|cikis|dur|kapat)$/i;

function _fmtNum(n) { return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function _cartSummary(state) {
  return state.items.map((it, i) => {
    let line = `${i + 1}. *${it.itemName}* × ${it.qty} ${it.unitMsr} — ${_fmtNum(it.unitPrice * it.qty)} ${it.currency}`;
    if (it.isSerial && it.serials.length) line += `\n   🔢 ${it.serials.map(s => s.sn).join(', ')}`;
    if (it.isBatch  && it.batches.length) line += `\n   📦 ${it.batches.map(b => `${b.batchNo}(${b.qty})`).join(', ')}`;
    return line;
  }).join('\n');
}

function _totalLine(state) {
  const tot = state.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
  return `💰 *Toplam: ${_fmtNum(tot)} ${state.currency || 'TRY'}*`;
}

// ─── Durum kontrol ──────────────────────────────────────────────────
function hasWizard(phone)  { return _wizard.has(_norm(phone));  }
function hasPending(phone) { return _pending.has(_norm(phone)); }

function _state(phone) {
  const k = _norm(phone);
  return _wizard.get(k) || _pending.get(k) || null;
}

function _touch(k, state) {
  state.expiresAt = Date.now() + WIZARD_TTL;
  if (_pending.has(k)) _pending.set(k, state);
  else                  _wizard.set(k, state);
}

// ─── İptal ──────────────────────────────────────────────────────────
async function cancelDocWizard(phone) {
  const k = _norm(phone);
  _wizard.delete(k);
  _pending.delete(k);
  await sendText(phone, '❌ Belge oluşturma iptal edildi.');
}

// ─── Wizard başlat ──────────────────────────────────────────────────
async function startDocWizard(phone, user) {
  const k = _norm(phone);
  _wizard.set(k, {
    step:      'docType',
    user,
    items:     [],
    dbName:    user.dbName || null,
    currency:  'TRY',
    expiresAt: Date.now() + WIZARD_TTL,
  });

  await sendList(
    phone,
    '📄 Pazarlama Belgesi',
    'Oluşturmak istediğiniz belge tipini seçin:',
    'Belge Seç',
    [
      {
        title: 'Satış',
        rows: DOC_TYPES.filter(d => !d.isBuy).map(d => ({
          id: `DOC_TYPE:${d.id}`, title: `${d.icon} ${d.label}`, description: '',
        })),
      },
      {
        title: 'Alım',
        rows: DOC_TYPES.filter(d => d.isBuy).map(d => ({
          id: `DOC_TYPE:${d.id}`, title: `${d.icon} ${d.label}`, description: '',
        })),
      },
    ]
  );
}

// ─── Buton/liste cevabı ─────────────────────────────────────────────
async function handleDocButton(phone, btnId, user) {
  const k     = _norm(phone);
  const state = _state(phone);
  if (!state || state.expiresAt < Date.now()) {
    _wizard.delete(k); _pending.delete(k);
    return false;
  }
  _touch(k, state);

  const sep     = btnId.indexOf(':');
  const prefix  = sep >= 0 ? btnId.slice(0, sep) : btnId;
  const payload = sep >= 0 ? btnId.slice(sep + 1) : '';

  switch (prefix) {
    case 'DOC_TYPE':     return _onDocType(phone, k, state, payload);
    case 'DOC_PART':     return _onPartnerSelected(phone, k, state, payload);
    case 'DOC_ITEM':     return _onItemSelected(phone, k, state, payload);
    case 'DOC_PRICE_OK': return _afterPrice(phone, k, state);
    case 'DOC_SRL':      return _addSerial(phone, k, state, payload);
    case 'DOC_SRL_DONE': return _onSerialDone(phone, k, state);
    case 'DOC_BAT':      return _pickBatch(phone, k, state, payload);
    case 'DOC_MORE':     return _onAddMore(phone, k, state);
    case 'DOC_DONE':     return _onSummary(phone, k, state);
    case 'DOC_SAVE':     return _onSave(phone, k, state, user);
    case 'DOC_CANCEL':   return cancelDocWizard(phone);
    default:             return false;
  }
}

// ─── Metin girişi ───────────────────────────────────────────────────
async function handleDocText(phone, text, _user) {
  const k     = _norm(phone);
  const state = _wizard.get(k);
  if (!state || state.expiresAt < Date.now()) { _wizard.delete(k); return false; }
  if (CANCEL_RE.test(text.trim())) { await cancelDocWizard(phone); return true; }
  _touch(k, state);

  // Pending (özet) modunda metin gelirse butonu hatırlat
  if (_pending.has(k)) {
    await sendText(phone, '👆 Lütfen *💾 Kaydet* veya *❌ İptal* butonuna basın.');
    return true;
  }

  switch (state.step) {
    case 'partner':       return _partnerSearch(phone, k, state, text);
    case 'itemSearch':    return _itemSearch(phone, k, state, text);
    case 'itemQty':       return _onQty(phone, k, state, text);
    case 'itemPrice':     return _onPriceText(phone, k, state, text);
    case 'serialCollect': return _addSerial(phone, k, state, text.trim());
    case 'batchCollect':  return _pickBatch(phone, k, state, text.trim());
    case 'batchQty':      return _onBatchQty(phone, k, state, text);
    default:              return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ADIMLAR
// ═══════════════════════════════════════════════════════════════════

// ── 1. Belge tipi ───────────────────────────────────────────────────
async function _onDocType(phone, k, state, typeId) {
  const dt = DOC_TYPES.find(d => d.id === typeId);
  if (!dt) return false;

  Object.assign(state, { docTypeId: dt.id, draftCode: dt.draftCode, docTypeLabel: dt.label, docTypeIcon: dt.icon, isBuy: dt.isBuy, step: 'partner' });
  _wizard.set(k, state);

  const pLabel = dt.isBuy ? 'Tedarikçi' : 'Müşteri';
  await sendText(phone, `${dt.icon} *${dt.label}*\n\n👤 ${pLabel} adını veya kodunu yazın:\n_("* " yazarsanız genel listeye bakar)_`);
  return true;
}

// ── 2. Cari arama ───────────────────────────────────────────────────
async function _partnerSearch(phone, k, state, text) {
  const q        = text.trim();
  const cardType = state.isBuy ? 'S' : 'C';
  let result;
  try {
    result = await searchPartners({ query: q, cardType, top: 10, dbName: state.dbName });
  } catch (err) {
    await sendText(phone, `⚠️ Arama hatası: ${err.message}`);
    return true;
  }

  if (result.found === 'none') {
    await sendText(phone, '❌ Eşleşen kayıt bulunamadı. Farklı bir isim veya kod deneyin.');
    return true;
  }
  if (result.found === 'one') return _setPartner(phone, k, state, result.record.CardCode, result.record.CardName);

  // Birden fazla sonuç → liste göster
  const rows = result.records.slice(0, 10).map(r => ({
    id: `DOC_PART:${r.CardCode}|${r.CardName}`,
    title: r.CardName.slice(0, 24),
    description: r.CardCode,
  }));
  await sendList(phone, '👥 Eşleşenler', 'Birini seçin:', 'Seç', [{ title: 'Sonuçlar', rows }]);
  return true;
}

async function _onPartnerSelected(phone, k, state, payload) {
  const sep      = payload.indexOf('|');
  const cardCode = sep >= 0 ? payload.slice(0, sep) : payload;
  const cardName = sep >= 0 ? payload.slice(sep + 1) : payload;
  return _setPartner(phone, k, state, cardCode, cardName);
}

async function _setPartner(phone, k, state, cardCode, cardName) {
  let priceList = 1, currency = 'TRY';
  try {
    const info = await getPartnerInfo({ cardCode, dbName: state.dbName });
    priceList  = info?.ListNum  ?? 1;
    currency   = info?.Currency || 'TRY';
  } catch (err) {
    console.warn('[DocWizard] getPartnerInfo:', err.message);
  }

  Object.assign(state, { cardCode, cardName, priceList, currency, step: 'itemSearch' });
  _wizard.set(k, state);

  await sendText(phone, `✅ *${cardName}* seçildi.\n\n🔍 Ürün kodunu veya adını yazın:\n_("* " yazarsanız tüm ürünleri listeler)_`);
  return true;
}

// ── 3. Ürün arama ───────────────────────────────────────────────────
async function _itemSearch(phone, k, state, text) {
  let results;
  try {
    results = await searchItems({ query: text.trim(), itemType: state.isBuy ? 'purchase' : 'sales', top: 10, dbName: state.dbName });
  } catch (err) {
    await sendText(phone, `⚠️ Ürün arama hatası: ${err.message}`);
    return true;
  }

  if (!results || results.length === 0) {
    await sendText(phone, '❌ Ürün bulunamadı. Farklı arama terimi deneyin.');
    return true;
  }
  if (results.length === 1) return _setItem(phone, k, state, results[0]);

  state.itemResults = results;
  _wizard.set(k, state);

  const rows = results.map(r => ({
    id: `DOC_ITEM:${r.ItemCode}`,
    title: r.ItemName.slice(0, 24),
    description: r.ItemCode,
  }));
  await sendList(phone, '📦 Ürünler', 'Birini seçin:', 'Seç', [{ title: 'Sonuçlar', rows }]);
  return true;
}

async function _onItemSelected(phone, k, state, itemCode) {
  const found = (state.itemResults || []).find(r => r.ItemCode === itemCode);
  if (found) return _setItem(phone, k, state, found);

  // Direkt arama dene
  try {
    const rows = await searchItems({ query: itemCode, itemType: state.isBuy ? 'purchase' : 'sales', top: 1, dbName: state.dbName });
    if (rows && rows.length > 0) return _setItem(phone, k, state, rows[0]);
  } catch { /* ignore */ }

  await sendText(phone, '❌ Ürün bulunamadı. Tekrar arayın.');
  return true;
}

async function _setItem(phone, k, state, item) {
  let unitPrice = 0, currency = state.currency || 'TRY';
  try {
    const pr = await getItemPrice({ itemCode: item.ItemCode, priceList: state.priceList, dbName: state.dbName });
    if (pr) { unitPrice = pr.Price || 0; currency = pr.Currency || currency; }
  } catch (err) {
    console.warn('[DocWizard] getItemPrice:', err.message);
  }

  state.currentItem = {
    itemCode:  item.ItemCode,
    itemName:  item.ItemName,
    isSerial:  item.ManSerNum === 'Y',
    isBatch:   item.ManBatchNum === 'Y',
    unitMsr:   item.InvntryUom || 'Adet',
    unitPrice,
    currency,
    qty:       0,
    serials:   [],
    batches:   [],
  };
  state.itemResults = null;
  state.step = 'itemQty';
  _wizard.set(k, state);

  const priceStr = unitPrice > 0
    ? `💰 Birim fiyat: *${_fmtNum(unitPrice)} ${currency}*`
    : '💰 Fiyat listesinde tanımlı değil — 0 ile devam edilecek';

  await sendText(phone,
    `📦 *${item.ItemName}* (${item.ItemCode})\n${priceStr}\n\n` +
    `Kaç ${state.currentItem.unitMsr} girilsin?\n_(0 yazarsanız bu ürün eklenmez)_`
  );
  return true;
}

// ── 4. Miktar ───────────────────────────────────────────────────────
async function _onQty(phone, k, state, text) {
  const qty = parseFloat(text.replace(',', '.'));
  if (isNaN(qty) || qty < 0) {
    await sendText(phone, '⚠️ Geçerli bir miktar girin (örn: 5 veya 2.5)');
    return true;
  }
  if (qty === 0) {
    state.currentItem = null;
    state.step = 'itemSearch';
    _wizard.set(k, state);
    await sendText(phone, '↩️ Ürün eklenmedi. Başka bir ürün arayın:');
    return true;
  }

  state.currentItem.qty = qty;
  state.step = 'itemPrice';
  _wizard.set(k, state);

  const ci    = state.currentItem;
  const total = _fmtNum(ci.unitPrice * qty);

  await sendButtons(phone,
    '💰 Fiyat Onayı',
    `*${ci.itemName}* × ${qty} ${ci.unitMsr}\n` +
    `Birim: ${_fmtNum(ci.unitPrice)} ${ci.currency}\n` +
    `Toplam: *${total} ${ci.currency}*\n\n` +
    `Farklı birim fiyat yazabilir veya onaylayabilirsiniz:`,
    [
      { id: 'DOC_PRICE_OK', title: '✅ Onayla' },
      { id: 'DOC_CANCEL',   title: '❌ İptal'  },
    ]
  );
  return true;
}

// ── 5. Fiyat ────────────────────────────────────────────────────────
async function _onPriceText(phone, k, state, text) {
  const price = parseFloat(text.replace(',', '.'));
  if (isNaN(price) || price < 0) {
    await sendText(phone, '⚠️ Geçerli bir fiyat girin veya *Onayla* butonuna basın.');
    return true;
  }
  state.currentItem.unitPrice = price;
  return _afterPrice(phone, k, state);
}

async function _afterPrice(phone, k, state) {
  const ci = state.currentItem;
  if (ci.isSerial) {
    ci.serials = [];
    state.step = 'serialCollect';
    _wizard.set(k, state);
    return _askNextSerial(phone, k, state);
  }
  if (ci.isBatch) {
    ci.batches          = [];
    ci.batchRemaining   = ci.qty;
    ci.pendingBatch     = null;
    state.step = 'batchCollect';
    _wizard.set(k, state);
    return _askNextBatch(phone, k, state);
  }
  return _addToCart(phone, k, state);
}

// ── 6a. Seri numarası toplama ────────────────────────────────────────
async function _askNextSerial(phone, _k, state) {
  const ci        = state.currentItem;
  const collected = ci.serials.length;
  const needed    = Math.round(ci.qty);

  let rows = [];
  try {
    const available = await getAvailableSerials({ itemCode: ci.itemCode, top: 10, dbName: state.dbName });
    const used      = new Set(ci.serials.map(s => s.sn));
    rows = available
      .filter(s => !used.has(s.DistNumber))
      .slice(0, 8)
      .map(s => ({ id: `DOC_SRL:${s.DistNumber}`, title: s.DistNumber.slice(0, 24), description: `Sys: ${s.SysNumber}` }));
  } catch (err) {
    console.warn('[DocWizard] getAvailableSerials:', err.message);
  }

  const header = `🔢 Seri [${collected + 1}/${needed}]`;
  const body   = `*${ci.itemName}* seri numarası seçin veya yazın:`;

  if (rows.length > 0) {
    await sendList(phone, header, body, 'Seç',
      [{ title: 'Mevcut Seriler', rows }]
    );
  } else {
    await sendText(phone, `${header}\n${body}`);
  }
  // Hem listeden hem yazarak gelebilir → step serialCollect'te kalır
  return true;
}

async function _addSerial(phone, k, state, sn) {
  if (!sn) return true;
  const ci      = state.currentItem;
  const needed  = Math.round(ci.qty);

  if (ci.serials.some(s => s.sn === sn)) {
    await sendText(phone, `⚠️ "${sn}" zaten eklendi. Farklı seri giriniz.`);
    return _askNextSerial(phone, k, state);
  }

  ci.serials.push({ sn });

  if (ci.serials.length >= needed) return _addToCart(phone, k, state);
  return _askNextSerial(phone, k, state);
}

async function _onSerialDone(phone, k, state) {
  const ci = state.currentItem;
  if (ci.serials.length === 0) {
    await sendText(phone, '⚠️ En az bir seri numarası girilmeli.');
    return _askNextSerial(phone, k, state);
  }
  ci.qty = ci.serials.length;
  return _addToCart(phone, k, state);
}

// ── 6b. Parti toplama ────────────────────────────────────────────────
async function _askNextBatch(phone, _k, state) {
  const ci        = state.currentItem;
  const remaining = ci.batchRemaining;

  let rows = [];
  try {
    const available = await getAvailableBatches({ itemCode: ci.itemCode, top: 10, dbName: state.dbName });
    const used      = new Set(ci.batches.map(b => b.batchNo));
    rows = available
      .filter(b => !used.has(b.DistNumber))
      .slice(0, 8)
      .map(b => ({
        id:          `DOC_BAT:${b.DistNumber}`,
        title:       b.DistNumber.slice(0, 24),
        description: `Mevcut: ${b.Quantity ?? '?'}${b.ExpDate ? ` | SKT: ${b.ExpDate}` : ''}`,
      }));
  } catch (err) {
    console.warn('[DocWizard] getAvailableBatches:', err.message);
  }

  const header = `📦 Parti Seçimi (Kalan: ${remaining} ${ci.unitMsr})`;
  const body   = `*${ci.itemName}* — parti seçin veya yazın:`;

  if (rows.length > 0) {
    await sendList(phone, header, body, 'Seç', [{ title: 'Mevcut Partiler', rows }]);
  } else {
    await sendText(phone, `${header}\n${body}`);
  }
  return true;
}

async function _pickBatch(phone, k, state, batchNo) {
  if (!batchNo) return true;
  state.currentItem.pendingBatch = batchNo;
  state.step = 'batchQty';
  _wizard.set(k, state);

  const ci = state.currentItem;
  await sendText(phone, `📦 *${batchNo}* — kaç ${ci.unitMsr}?\n_(Kalan: ${ci.batchRemaining} ${ci.unitMsr})_`);
  return true;
}

async function _onBatchQty(phone, k, state, text) {
  const qty = parseFloat(text.replace(',', '.'));
  const ci  = state.currentItem;

  if (isNaN(qty) || qty <= 0) {
    await sendText(phone, '⚠️ Geçerli miktar girin.');
    return true;
  }
  if (qty > ci.batchRemaining + 0.001) {
    await sendText(phone, `⚠️ En fazla ${ci.batchRemaining} ${ci.unitMsr} girebilirsiniz.`);
    return true;
  }

  ci.batches.push({ batchNo: ci.pendingBatch, qty });
  ci.batchRemaining -= qty;
  delete ci.pendingBatch;

  if (ci.batchRemaining <= 0.001) return _addToCart(phone, k, state);

  state.step = 'batchCollect';
  _wizard.set(k, state);
  return _askNextBatch(phone, k, state);
}

// ── 7. Sepete ekle / Devam ────────────────────────────────────────────
async function _addToCart(phone, k, state) {
  const ci = { ...state.currentItem };
  state.items.push(ci);
  state.currentItem    = null;
  state.step           = 'addMore';
  _wizard.set(k, state);

  const summary = _cartSummary(state);
  const total   = _totalLine(state);

  await sendButtons(phone,
    '✅ Ürün Eklendi',
    `${summary}\n\n${total}\n\nDevam:`,
    [
      { id: 'DOC_MORE', title: '➕ Ürün Ekle' },
      { id: 'DOC_DONE', title: '✅ Tamamla'   },
    ]
  );
  return true;
}

async function _onAddMore(phone, k, state) {
  state.step = 'itemSearch';
  _wizard.set(k, state);
  await sendText(phone, '🔍 Eklemek istediğiniz ürünü arayın:');
  return true;
}

// ── 8. Özet ──────────────────────────────────────────────────────────
async function _onSummary(phone, k, state) {
  if (state.items.length === 0) {
    state.step = 'itemSearch';
    _wizard.set(k, state);
    await sendText(phone, '⚠️ Henüz ürün eklenmedi. Ürün arayın:');
    return true;
  }

  const today   = new Date().toLocaleDateString('tr-TR');
  const summary = _cartSummary(state);
  const total   = _totalLine(state);

  const summaryText =
    `${state.docTypeIcon} *${state.docTypeLabel}*\n` +
    `👤 *${state.cardName}* (${state.cardCode})\n` +
    `📅 ${today}\n\n` +
    `📋 *Kalemler:*\n${summary}\n\n${total}`;

  // Wizard → Pending
  _wizard.delete(k);
  _pending.set(k, { ...state, step: 'pending', expiresAt: Date.now() + PENDING_TTL });

  await sendButtons(phone, '📄 Özet — Onaylıyor musunuz?', summaryText,
    [
      { id: 'DOC_SAVE',   title: '💾 Kaydet' },
      { id: 'DOC_CANCEL', title: '❌ İptal'  },
    ]
  );
  return true;
}

// ── 9. SAP'a kaydet ──────────────────────────────────────────────────
async function _onSave(phone, k, _state, _user) {
  const pnd = _pending.get(k);
  if (!pnd) {
    await sendText(phone, '⚠️ Oturum süresi dolmuş. Lütfen baştan başlayın.');
    return true;
  }

  await sendText(phone, '⏳ Taslak kaydediliyor...');

  try {
    const sl    = getConnection(pnd.dbName || config.sap.companyDb);
    const today = new Date().toISOString().slice(0, 10);

    // Taslakta seri/parti ataması yapılmaz — finalize sırasında SAP'ta girilir
    const documentLines = pnd.items.map(it => ({
      ItemCode:  it.itemCode,
      Quantity:  it.qty,
      UnitPrice: it.unitPrice,
    }));

    const payload = {
      DocObjectCode: pnd.draftCode,   // Drafts endpoint: hangi belge tipi
      CardCode:      pnd.cardCode,
      DocDate:       today,
      DocDueDate:    today,
      DocumentLines: documentLines,
    };
    const session = pnd.user;
    if (session?.employeeId) payload.SalesPersonCode = session.employeeId;

    // Tüm belgeler taslak olarak kaydedilir — SAP'ta yetkili onaylayıp finalize eder
    const result  = await sl.post('Drafts', payload);
    const docEntry = result.DocEntry || '?';

    _pending.delete(k);

    const tot = pnd.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    await sendText(phone,
      `✅ *${pnd.docTypeLabel}* taslak olarak kaydedildi!\n\n` +
      `📋 Taslak No: *${docEntry}*\n` +
      `👤 ${pnd.cardName}\n` +
      `💰 Toplam: ${_fmtNum(tot)} ${pnd.currency}\n` +
      `📅 ${new Date().toLocaleDateString('tr-TR')}\n\n` +
      `_SAP B1'de Taslaklar menüsünden inceleyip onaylayabilirsiniz._`
    );
  } catch (err) {
    console.error('[DocWizard] Kayıt hatası:', err.message);
    _pending.delete(k);
    await sendText(phone,
      `❌ Belge oluşturulamadı:\n_${err.message}_\n\nSAP'ta kontrol edin veya tekrar deneyin.`
    );
  }
  return true;
}

module.exports = { hasWizard, hasPending, startDocWizard, handleDocButton, handleDocText, cancelDocWizard };
