'use strict';

/**
 * approval.js
 *
 * Satın alma siparişi onay iş akışı.
 *
 * Akış:
 *   1. Kullanıcı "bekleyen onaylar" → açık sipariş listesi gelir (WhatsApp liste)
 *   2. Kullanıcı bir siparişi seçer → detay + Onayla/Reddet butonları gelir
 *   3. Kullanıcı butona basar → SAP'ta onay/red işlemi yapılır
 *
 * Yetki:
 *   Sadece config.approverPhones listesindeki numaralar onay yapabilir.
 */

const { getConnection }                    = require('./sapClient');
const { sendText, sendButtons, sendList }  = require('../services/whatsappService'); // FIX: ../services/
const { readApprovers }                    = require('../admin/approverService');

// ─────────────────────────────────────────────────────────────
// 1. Bekleyen onayları listele veya belge detayı göster
// ─────────────────────────────────────────────────────────────
async function handleApproval({ from, docEntry }) {
  // Yetki kontrolü
  if (!isApprover(from)) {
    return await sendText(from,
      '🚫 Satın alma onayı için yetkiniz bulunmamaktadır.\nLütfen sistem yöneticinizle iletişime geçin.'
    );
  }

  // Belge numarası verilmişse detay göster
  if (docEntry) {
    return await showOrderDetail({ from, docEntry });
  }

  // Verilmemişse bekleyen onayları listele
  return await listPendingOrders({ from });
}

// ─────────────────────────────────────────────────────────────
// 2. Bekleyen siparişleri listele
// ─────────────────────────────────────────────────────────────
async function listPendingOrders({ from }) {
  try {
    const sl = getConnection();

    const data = await sl.get('PurchaseOrders', {
      '$filter': "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'",
      '$select': 'DocEntry,DocNum,CardName,DocTotal,DocDate,DocDueDate,Comments',
      '$orderby': 'DocDate desc',
      '$top': '10',
    });

    const orders = data?.value || [];

    if (orders.length === 0) {
      return await sendText(from, '✅ Onay bekleyen satın alma siparişi bulunmamaktadır.');
    }

    // WhatsApp liste mesajı formatına çevir
    const rows = orders.map(o => ({
      id:          `DETAIL:${o.DocEntry}`,
      title:       `#${o.DocNum} – ${_truncate(o.CardName, 20)}`,
      description: `${_formatMoney(o.DocTotal)} | Vade: ${_formatDate(o.DocDueDate)}`,
    }));

    await sendList(
      from,
      '📋 Bekleyen Onaylar',
      `${orders.length} adet sipariş onay bekliyor.\nDetay için birini seçin:`,
      'Siparişleri Gör',
      [{ title: 'Satın Alma Siparişleri', rows }]
    );

  } catch (err) {
    console.error('[Approval] Listeleme hatası:', err.message);
    await sendText(from, '⚠️ Onay listesi alınamadı. Lütfen tekrar deneyin.');
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Sipariş detayını göster + Onayla/Reddet butonları
// ─────────────────────────────────────────────────────────────
async function showOrderDetail({ from, docEntry }) {
  try {
    const sl    = getConnection();
    const order = await sl.getOne('PurchaseOrders', docEntry);

    if (!order || order.error) {
      return await sendText(from, `❌ ${docEntry} numaralı sipariş bulunamadı.`);
    }

    // Sipariş kalemlerini formatla (max 5 kalem)
    const lines    = order.DocumentLines || [];
    const lineText = lines.slice(0, 5).map((l, i) =>
      `  ${i + 1}. ${l.ItemDescription || l.ItemCode} – ${l.Quantity} ${l.UnitOfMeasure || 'adet'} × ${_formatMoney(l.UnitPrice)}`
    ).join('\n');
    const moreLines = lines.length > 5 ? `\n  ...ve ${lines.length - 5} kalem daha` : '';

    const bodyText = [
      `🏢 *Tedarikçi:* ${order.CardName}`,
      `📅 *Tarih:* ${_formatDate(order.DocDate)}`,
      `⏰ *Vade:* ${_formatDate(order.DocDueDate)}`,
      `💰 *Toplam:* ${_formatMoney(order.DocTotal)} ${order.DocCurrency || 'TRY'}`,
      order.Comments ? `📝 *Not:* ${_truncate(order.Comments, 80)}` : '',
      '',
      '*Kalemler:*',
      lineText + moreLines,
    ].filter(Boolean).join('\n');

    await sendButtons(
      from,
      `Sipariş #${order.DocNum}`,
      bodyText,
      [
        { id: `APPROVE:${docEntry}`, title: '✅ Onayla' },
        { id: `REJECT:${docEntry}`,  title: '❌ Reddet' },
      ]
    );

  } catch (err) {
    console.error('[Approval] Detay hatası:', err.message);
    await sendText(from, '⚠️ Sipariş detayı alınamadı. Lütfen tekrar deneyin.');
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Onayla veya Reddet
// ─────────────────────────────────────────────────────────────
async function confirmApproval({ from, docEntry, action }) {
  // Yetki kontrolü
  if (!isApprover(from)) {
    return await sendText(from,
      '🚫 Onay/red yetkisine sahip değilsiniz.'
    );
  }

  if (!docEntry) {
    return await sendText(from,
      '❓ Belge numarası belirtilmedi. Örnek: "456 numaralı siparişi onayla"'
    );
  }

  try {
    const sl         = getConnection();
    const actionName = action === 'approve' ? 'Approve' : 'Reject';
    const result     = await sl.action('PurchaseOrders', docEntry, actionName);

    if (result?.success) {
      const emoji = action === 'approve' ? '✅' : '❌';
      const verb  = action === 'approve' ? 'onaylandı' : 'reddedildi';

      // Sipariş bilgisini al (bildirim için)
      let orderInfo = '';
      try {
        const order = await sl.getOne('PurchaseOrders', docEntry);
        orderInfo = ` (${order.CardName} – ${_formatMoney(order.DocTotal)})`;
      } catch { /* bilgi alınamazsa boş geç */ }

      await sendText(from,
        `${emoji} *Sipariş #${docEntry}* başarıyla *${verb}*!${orderInfo}\n\n` +
        `📅 İşlem zamanı: ${_formatDateTime(new Date())}`
      );
    } else {
      throw new Error('SAP işlem başarısız döndü');
    }

  } catch (err) {
    console.error(`[Approval] ${action} hatası (${docEntry}):`, err.message);
    await sendText(from,
      `⚠️ İşlem gerçekleştirilemedi: ${err.message}\n\nLütfen SAP üzerinden manuel kontrol edin.`
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

function _formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
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

module.exports = { handleApproval, confirmApproval };
