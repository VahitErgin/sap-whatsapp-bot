'use strict';

/**
 * approval.js
 *
 * Satın alma siparişi onay iş akışı.
 *
 * Akış:
 *   1. Kullanıcı "bekleyen onaylar" → açık sipariş listesi gelir (WhatsApp liste)
 *   2. Kullanıcı bir siparişi seçer → detay + Onayla/Reddet butonları gelir
 *   3. Kullanıcı butona basar → SAP Service Layer ile onay/red yapılır
 *
 * Yetki:
 *   Sadece approverService'te kayıtlı numaralar onay yapabilir.
 */

const axios  = require('axios');
const https  = require('https');
const config = require('../config/config');

const { sendText, sendButtons, sendList } = require('../services/whatsappService');
const { readApprovers }                   = require('../admin/approverService');
const { getOnayBekleyenler }              = require('./sapDb');
const { getSession }                      = require('./sessionManager');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─────────────────────────────────────────────────────────────
// 1. Bekleyen onayları listele veya belge detayı göster
// ─────────────────────────────────────────────────────────────
async function handleApproval({ from, docEntry }) {
  if (docEntry) {
    return showOrderDetail({ from, wddCode: docEntry });
  }
  return listPendingOrders({ from });
}

// ─────────────────────────────────────────────────────────────
// 2. Bekleyen siparişleri listele
// ─────────────────────────────────────────────────────────────
async function listPendingOrders({ from }) {
  try {
    const orders = await getOnayBekleyenler();

    if (orders.length === 0) {
      return sendText(from, '✅ Bekleyen onayınız bulunmamaktadır.');
    }

    const rows = orders.slice(0, 10).map(o => ({
      id:          `ONAY_DETAIL:${o.WddCode}`,
      title:       `#${o.DocNum} ${o.BelgeTipi}`.substring(0, 24),
      description: `${_truncate(o.CardName || o.BelgeTipi, 30)} | ${_formatMoney(o.DocTotal)}`,
    }));

    await sendList(
      from,
      '📋 Bekleyen Onaylar',
      `Bugün ${orders.length} belge onay bekliyor:\nBir belge seçerek onayla veya reddet.`,
      'Listele',
      [{ title: 'Belgeler', rows }]
    );

  } catch (err) {
    console.error('[Approval] Listeleme hatası:', err.message);
    await sendText(from, '⚠️ Onay listesi alınamadı. Lütfen tekrar deneyin.');
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Belge detayı + Onayla/Reddet butonları
// ─────────────────────────────────────────────────────────────
async function showOrderDetail({ from, wddCode }) {
  try {
    const all   = await getOnayBekleyenler();
    const order = all.find(r => String(r.WddCode) === String(wddCode));

    if (!order) {
      return sendText(from, '⚠️ Onay kaydı bulunamadı.');
    }

    const bodyText = [
      order.CardName ? `🏢 *Muhatap:* ${order.CardName}` : '',
      `📄 *Tür:* ${order.BelgeTipi}`,
      `📅 *Tarih:* ${order.TalepTarihi}`,
      `💰 *Tutar:* ${_formatMoney(order.DocTotal)} ${order.ParaBirimi}`,
      order.Aciklama ? `📝 *Açıklama:* ${_truncate(order.Aciklama, 80)}` : '',
    ].filter(Boolean).join('\n');

    if (isApprover(from)) {
      await sendButtons(
        from,
        `Belge #${order.DocNum}`,
        bodyText,
        [
          { id: `APPROVE:${wddCode}`, title: '✅ Onayla' },
          { id: `REJECT:${wddCode}`,  title: '❌ Reddet' },
        ]
      );
    } else {
      await sendText(from, `📄 *Belge #${order.DocNum}*\n\n${bodyText}\n\n🔒 Bu belge için onay yetkiniz bulunmamaktadır.`);
    }

  } catch (err) {
    console.error('[Approval] Detay hatası:', err.message);
    await sendText(from, '⚠️ Belge detayı alınamadı. Lütfen tekrar deneyin.');
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Onayla veya Reddet — SAP Service Layer
// ─────────────────────────────────────────────────────────────
async function confirmApproval({ from, docEntry, action }) {
  if (!isApprover(from)) {
    return sendText(from, '🚫 Onay/red yetkisine sahip değilsiniz.');
  }

  if (!docEntry) {
    return sendText(from, '❓ Belge numarası belirtilmedi.');
  }

  try {
    const all     = await getOnayBekleyenler();
    const onayRow = all.find(r => String(r.WddCode) === String(docEntry));

    if (!onayRow) {
      return sendText(from, '⚠️ Onay kaydı bulunamadı.');
    }

    const session   = getSession(from);
    const b1session = session?.b1session;
    if (!b1session) {
      return sendText(from,
        '🔐 Onay işlemi için SAP oturumunuz gerekiyor.\n*giriş yap* yazarak tekrar giriş yapın.'
      );
    }

    // SAP SL: PATCH /ApprovalRequests({WddCode})
    // ApprovalRequestLines → onaylayan kullanıcının satırını güncelle
    const baseUrl   = config.sap.serviceLayerUrl.replace(/\/$/, '');
    const slStatus  = action === 'approve' ? 'ardApproved' : 'ardNotApproved';
    const remarks   = action === 'approve'
      ? 'WhatsApp üzerinden onaylandı'
      : 'WhatsApp üzerinden reddedildi';

    console.log(`[Approval] PATCH ApprovalRequests(${onayRow.WddCode}) | Status:${slStatus}`);

    await axios.patch(
      `${baseUrl}/ApprovalRequests(${onayRow.WddCode})`,
      {
        ApprovalRequestDecisions: [
          {
            Status:  slStatus,
            Remarks: remarks,
          },
        ],
      },
      {
        headers:    { Cookie: `B1SESSION=${b1session}`, 'Content-Type': 'application/json' },
        httpsAgent,
        timeout:    15000,
      }
    );

    const emoji = action === 'approve' ? '✅' : '❌';
    const verb  = action === 'approve' ? 'onaylandı' : 'reddedildi';
    await sendText(from,
      `${emoji} *${onayRow.BelgeTipi} #${onayRow.DocNum}* başarıyla *${verb}*!\n\n` +
      `📅 ${_formatDateTime(new Date())}`
    );

  } catch (err) {
    const sapErr = err.response?.data?.error?.message || err.message;
    console.error(`[Approval] ${action} hatası (${docEntry}):`, sapErr);
    console.error(`[Approval] SAP detay:`, JSON.stringify(err.response?.data || {}).substring(0, 400));
    await sendText(from,
      `⚠️ İşlem gerçekleştirilemedi: ${sapErr}\n\nLütfen SAP üzerinden manuel kontrol edin.`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Yardımcı fonksiyonlar
// ─────────────────────────────────────────────────────────────

function isApprover(phoneNumber) {
  return readApprovers().some(a => a.phone === phoneNumber);
}

function _formatMoney(amount) {
  if (amount == null) return '—';
  return Number(amount).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function _formatDateTime(date) {
  return date.toLocaleString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function _truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

module.exports = { handleApproval, confirmApproval, showOrderDetail };
