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
const config = require('../config/config');               // FIX: ../config/config
const { sendText } = require('../services/whatsappService'); // FIX: ../services/

// Modüller lazy-load → döngüsel bağımlılık riski yok
let cashflow, approval, support;
function getModules() {
  if (!cashflow) cashflow = require('../modules/cashflow');   // FIX: ../modules/
  if (!approval) approval = require('../modules/approval');
  if (!support)  support  = require('../modules/support');
}

// ─── Claude: Intent belirleme promptu ────────────────────────
const INTENT_SYSTEM = `Sen SAP Business One WhatsApp asistanının yönlendirici katmanısın.
Kullanıcının mesajını analiz et ve hangi modüle yönlendirileceğini belirle.

MODÜLLER:
- "cashflow"  → SAP veri sorguları ve listeleme: bakiye, fatura, stok, nakit akışı, cari bilgisi, sipariş listesi, ödeme, tahsilat, raporlar, veri görüntüleme
- "approval"  → Satın alma SİPARİŞİ ONAYLAMA veya REDDETME aksiyonu (aksiyon kelimesi gerekir)
- "support"   → SAP hata mesajları, nasıl yapılır soruları, menü yolları, teknik destek
- "help"      → Genel yardım menüsü istekleri (yardım, menü, ne yapabilirsin gibi)

KRİTİK AYRIMI — cashflow vs approval:
- Kullanıcı sadece LİSTELEMEK / GÖRMEK istiyorsa → cashflow
  Örnekler: "bekleyen siparişler", "siparişleri getir", "siparişleri göster", "açık siparişler"
- Kullanıcı ONAYLAMAK veya REDDETMEK istiyorsa → approval
  Örnekler: "siparişi onayla", "siparişi reddet", "onay ver", "onaylıyorum"

YANIT FORMATI (sadece JSON):
{
  "intent": "cashflow" | "approval" | "support" | "help",
  "confidence": 0.0-1.0,
  "reason": "Kısa açıklama"
}

ÖRNEKLER:
- "C001 bakiyesi nedir" → cashflow
- "Bu hafta vadesi gelen ödemeler" → cashflow
- "Stokta vida var mı" → cashflow
- "Stok bakiyesi en yüksekten 5 kalem getir" → cashflow
- "En çok stokta olan ürünler" → cashflow
- "Stok durumu listele" → cashflow
- "Hangi ürünlerin stoğu az" → cashflow
- "Fatura listesi" → cashflow
- "Son faturaları getir" → cashflow
- "Bekleyen siparişler neler" → cashflow (listeleme)
- "Bekleyen siparişlerden 5 tanesi ver" → cashflow (listeleme)
- "Açık satın alma siparişleri" → cashflow (listeleme)
- "456 numaralı siparişi onayla" → approval (onay aksiyonu)
- "Siparişi reddet" → approval (red aksiyonu)
- "-10 hatası aldım" → support
- "Fatura nasıl iptal edilir" → support
- "SAP'ta dönem nasıl kapatılır" → support
- "Yardım" → help
- "Ne yapabilirsin" → help

NOT: Kullanıcı "getir", "listele", "göster", "ver", "kaç tane" gibi kelimeler kullanıyorsa → cashflow.
     Kullanıcı "nasıl", "nerede", "ne zaman", "hata" gibi kelimeler kullanıyorsa → support.`;

// ─────────────────────────────────────────────────────────────
// Ana yönlendirici
// ─────────────────────────────────────────────────────────────
async function handleIncoming({ from, text, message, value }) {
  getModules();

  const upper = text.toUpperCase().trim();

  try {
    // ── 1. Buton / liste cevapları → direkt yönlendir ────────
    if (upper.startsWith('APPROVE:')) {
      const docEntry = upper.replace('APPROVE:', '').trim();
      return await approval.confirmApproval({ from, docEntry, action: 'approve' });
    }
    if (upper.startsWith('REJECT:')) {
      const docEntry = upper.replace('REJECT:', '').trim();
      return await approval.confirmApproval({ from, docEntry, action: 'reject' });
    }

    // ── 2. Claude ile intent belirle ─────────────────────────
    const intent = await detectIntent(text);
    console.log(`[Router] (${from}) "${text}" → ${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`);

    // ── 3. Modüle yönlendir ───────────────────────────────────
    switch (intent.intent) {

      case 'cashflow':
        // FIX: getCashflow yerine handleQuery kullan (tam doğal dil desteği)
        return await cashflow.handleQuery({ from, question: text });

      case 'approval': {
        // FIX: case bloğu {} ile sarıldı → const scope hatası giderildi
        const docMatch = text.match(/\d+/);
        const docEntry = docMatch ? docMatch[0] : null;

        if (/onayla/i.test(text)) {
          return await approval.confirmApproval({ from, docEntry, action: 'approve' });
        }
        if (/reddet/i.test(text)) {
          return await approval.confirmApproval({ from, docEntry, action: 'reject' });
        }
        return await approval.handleApproval({ from, docEntry });
      }

      case 'support':
        return await support.handleSupport({ from, question: text });

      case 'help':
      default:
        return await sendHelpMenu(from);
    }

  } catch (err) {
    console.error(`[Router] Hata (${from}):`, err.message);
    await sendText(from, '⚠️ Bir hata oluştu. Lütfen tekrar deneyin veya *yardım* yazın.');
  }
}

// ─────────────────────────────────────────────────────────────
// Claude: Intent tespiti  (Haiku – hızlı ve ucuz)
// ─────────────────────────────────────────────────────────────
async function detectIntent(text) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system:     INTENT_SYSTEM,
        messages: [{ role: 'user', content: text }],
      },
      {
        headers: {
          'x-api-key':         config.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
      }
    );

    const raw = response.data?.content
      ?.filter(b => b.type === 'text')
      ?.map(b => b.text)
      ?.join('') || '{}';

    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);

  } catch (err) {
    console.warn('[Router] Intent tespiti başarısız, support\'a düşüyor:', err.message);
    return { intent: 'support', confidence: 0.5, reason: 'fallback' };
  }
}

// ─────────────────────────────────────────────────────────────
// Yardım menüsü
// ─────────────────────────────────────────────────────────────
async function sendHelpMenu(to) {
  const msg = [
    '👋 *SAP B1 WhatsApp Asistanı*',
    '',
    'Bana doğal dille sorabilirsiniz:',
    '',
    '📊 *Sorgulama*',
    '  • "C001 carisinin bakiyesi nedir?"',
    '  • "Bu hafta vadesi gelen ödemeler"',
    '  • "Vida ürününün stok miktarı"',
    '  • "Bugün vadesi gelen tahsilatlar"',
    '',
    '✅ *Onay İşlemleri*',
    '  • "Bekleyen onaylarım var mı?"',
    '  • "456 numaralı siparişi onayla"',
    '',
    '🛠 *SAP Destek*',
    '  • "-10 hatası nasıl çözülür?"',
    '  • "Fatura nasıl iptal edilir?"',
    '  • "Dönem kapalı hatası aldım"',
    '',
    '❓ *yardım* → Bu menü',
  ].join('\n');

  await sendText(to, msg);
}

module.exports = { handleIncoming };
