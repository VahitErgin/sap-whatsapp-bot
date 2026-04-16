'use strict';

/**
 * serviceNotifier.js
 *
 * SAP B1 servis çağrılarının durumunu her 2 dakikada bir kontrol eder.
 * Durum değişikliği tespit edildiğinde müşteriye WhatsApp template bildirimi gönderir.
 *
 * Yöntem  : Polling (setInterval, 2 dakika)
 * State   : data/service-notif-state.json
 * Template: Meta'da onaylı "servis_durum_guncelleme" şablonu
 *           Body: "... {{1}} numaralı servis çağrınızın durumu güncellendi: *{{2}}*"
 *           {{1}} = Çağrı No, {{2}} = Yeni Durum
 */

const fs   = require('fs');
const path = require('path');

const { getServisGuncellemeleri } = require('../modules/sapDb');
const { sendTemplate }            = require('../services/whatsappService');
const config                      = require('../config/config');

const STATE_FILE    = path.join(__dirname, '../../data/service-notif-state.json');
const POLL_INTERVAL = 2 * 60 * 1000; // 2 dakika (ms)
const TEMPLATE_NAME = process.env.SERVIS_NOTIF_TEMPLATE || 'servis_durum_guncelleme';

// ─── State dosyası ────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[Notifier] State kayıt hatası:', err.message);
  }
}

// ─── Türk telefon numarasını WhatsApp formatına çevir ─────────
// Girdi: "0532 123 4567" | "05321234567" | "+905321234567" | "5321234567"
// Çıktı: "905321234567"  veya null (geçersizse)
function formatPhone(raw) {
  if (!raw) return null;
  let num = String(raw).replace(/[\s\-\(\)\.]/g, '');
  if (num.startsWith('+')) num = num.slice(1);
  if (num.startsWith('0')) num = '90' + num.slice(1);
  if (num.length === 10 && num.startsWith('5')) num = '90' + num;
  if (!/^\d{10,15}$/.test(num)) return null;
  return num;
}

// ─── Ana kontrol ──────────────────────────────────────────────
async function checkServisChanges() {
  try {
    const rows = await getServisGuncellemeleri({
      dbName: config.sapDb.database || undefined,
    });

    if (!rows || rows.length === 0) return;

    const state    = loadState();
    const newState = { ...state };
    const toNotify = [];

    for (const row of rows) {
      const key    = String(row.CagriNo);
      const durum  = row.Durum   || '';
      const status = row.StatusKod;
      const prev   = state[key];

      if (!prev) {
        // İlk kez görülen çağrı → state'e yaz, bildirim gönderme
        newState[key] = { durum, status };
        continue;
      }

      // Durum değişti mi?
      if (prev.durum !== durum || prev.status !== status) {
        newState[key] = { durum, status };

        const telefon = formatPhone(row.Telefon);
        if (telefon) {
          toNotify.push({ key, durum, telefon });
        } else {
          console.warn(`[Notifier] Çağrı ${key}: geçerli telefon yok → bildirim atlandı`);
        }
      }
    }

    // Bildirimleri sırayla gönder (rate limit riski azaltmak için)
    for (const n of toNotify) {
      try {
        await sendTemplate(n.telefon, TEMPLATE_NAME, 'tr', [
          { type: 'text', text: n.key   },   // {{1}} Çağrı No
          { type: 'text', text: n.durum },   // {{2}} Yeni Durum
        ]);
        console.log(`[Notifier] ✓ Çağrı ${n.key} → ${n.telefon} | ${n.durum}`);
      } catch (err) {
        console.error(`[Notifier] ✗ Çağrı ${n.key} gönderim hatası:`, err.message);
      }
    }

    saveState(newState);

    if (toNotify.length > 0) {
      console.log(`[Notifier] ${toNotify.length} bildirim gönderildi`);
    }

  } catch (err) {
    console.error('[Notifier] Kontrol hatası:', err.message);
  }
}

// ─── Başlat ───────────────────────────────────────────────────
function start() {
  // Önce DB ve template adı yapılandırılmış mı kontrol et
  if (!config.sapDb.database) {
    console.warn('[Notifier] SAP_DB_NAME tanımlı değil → servis bildirimleri devre dışı');
    return;
  }

  console.log(`[Notifier] Servis bildirim polling başlatıldı`);
  console.log(`[Notifier] Template: ${TEMPLATE_NAME} | Aralık: ${POLL_INTERVAL / 60000} dakika`);

  // İlk çalışma: mevcut durumu state'e yaz (bildirim gönderme)
  checkServisChanges();

  // Periyodik kontrol
  setInterval(checkServisChanges, POLL_INTERVAL);
}

module.exports = { start };
