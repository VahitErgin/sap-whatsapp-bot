'use strict';

/**
 * taskService.js
 *
 * Zamanlanmış görev yönetimi.
 * Görevler data/scheduled-tasks.json'da saklanır.
 * Her dakika tick atılır; saat eşleşen etkin görevler çalıştırılır.
 */

const fs   = require('fs');
const path = require('path');

const { sendText }           = require('./whatsappService');
const { getOnayBekleyenler, getVadesiGecenler, getCustomerByPhone } = require('../modules/sapDb');

const TASKS_FILE = path.join(__dirname, '../../data/scheduled-tasks.json');
const DATA_DIR   = path.join(__dirname, '../../data');

// ─────────────────────────────────────────────────────────────
// Görev tipleri
// ─────────────────────────────────────────────────────────────
const TASK_TYPES = {
  pending_approvals:  'Bekleyen Onaylar',
  overdue_balances:   'Vadesi Yaklaşan Bakiyeler',
  overdue_orders:     'Gecikmiş Siparişler',
  sales_performance:  'Satış Temsilcisi Performansı',
  collection_target:  'Günün Tahsilat Hedefi',
};

// ─────────────────────────────────────────────────────────────
// Dosya CRUD
// ─────────────────────────────────────────────────────────────
function readTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch { return []; }
}

function saveTasks(tasks) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

function createTask({ name, type, time, phones, enabled = true }) {
  if (!TASK_TYPES[type])  throw new Error('Geçersiz görev tipi');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Saat HH:MM formatında olmalı');
  if (!phones?.length)    throw new Error('En az bir telefon numarası gerekli');

  const tasks = readTasks();
  const task  = {
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name:      name || TASK_TYPES[type],
    type,
    time,
    phones:    phones.map(p => String(p).replace(/\D/g, '')),
    enabled:   Boolean(enabled),
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

function updateTask(id, updates) {
  const tasks = readTasks();
  const idx   = tasks.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Görev bulunamadı');

  if (updates.type && !TASK_TYPES[updates.type]) throw new Error('Geçersiz görev tipi');
  if (updates.time && !/^\d{2}:\d{2}$/.test(updates.time)) throw new Error('Saat HH:MM formatında olmalı');

  tasks[idx] = { ...tasks[idx], ...updates, id };
  saveTasks(tasks);
  return tasks[idx];
}

function deleteTask(id) {
  const tasks = readTasks();
  const next  = tasks.filter(t => t.id !== id);
  if (next.length === tasks.length) throw new Error('Görev bulunamadı');
  saveTasks(next);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Görev çalıştırıcılar
// ─────────────────────────────────────────────────────────────
async function runPendingApprovals(phone) {
  const phone10 = phone.slice(-10);
  const all     = await getOnayBekleyenler();
  const mine    = all.filter(r => String(r.OnaylayanTelefon || '').replace(/\D/g, '').slice(-10) === phone10);

  if (mine.length === 0) return; // onay yoksa sessiz geç

  const lines = mine.slice(0, 5).map(o =>
    `• ${o.BelgeTipi} #${o.DocNum} — ${_fmt(o.DocTotal)} ${o.ParaBirimi}`
  );
  if (mine.length > 5) lines.push(`+ ${mine.length - 5} belge daha...`);

  await sendText(phone,
    `📋 *Bekleyen Onaylarınız* (${mine.length} adet)\n\n${lines.join('\n')}\n\n` +
    `_Detay için "bekleyen onaylar" yazın._`
  );
}

async function runOverdueBalances(phone) {
  const today = new Date().toISOString().split('T')[0];
  // Telefona göre müşteri bul
  const phone10 = phone.slice(-10);
  const bp = await getCustomerByPhone(phone10).catch(() => null);

  let rows;
  if (bp?.CardCode) {
    // Müşterinin kendi bakiyesi
    const data = await getVadesiGecenler({ refDate: today, cardType: 'C' });
    rows = data.filter(r => r.CardCode === bp.CardCode);
  } else {
    // Genel rapor — ilk 5 müşteri
    rows = (await getVadesiGecenler({ refDate: today, cardType: 'C' })).slice(0, 5);
  }

  if (!rows.length) return;

  const lines = rows.map(r =>
    `• ${r.CardName || r.CardCode}: ${_fmt(r.BakiyeTRY)} TRY`
  );
  await sendText(phone,
    `💰 *Vadesi Yaklaşan Bakiyeler*\n\n${lines.join('\n')}`
  );
}

async function runPlaceholder(phone, taskName) {
  await sendText(phone,
    `📊 *${taskName}* raporu hazırlanıyor.\n\nBu rapor tipi yakında aktif olacaktır.`
  );
}

async function runTask(task) {
  for (const phone of task.phones) {
    try {
      switch (task.type) {
        case 'pending_approvals': await runPendingApprovals(phone); break;
        case 'overdue_balances':  await runOverdueBalances(phone);  break;
        default:                  await runPlaceholder(phone, task.name); break;
      }
      console.log(`[Scheduler] ✓ ${task.name} → ${phone}`);
    } catch (err) {
      console.error(`[Scheduler] ✗ ${task.name} → ${phone}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Yardımcı
// ─────────────────────────────────────────────────────────────
function _fmt(n) {
  return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────
// Scheduler — her dakika tick
// ─────────────────────────────────────────────────────────────
let _lastTick = '';

function tick() {
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (hhmm === _lastTick) return; // aynı dakikayı iki kez çalıştırma
  _lastTick = hhmm;

  const tasks = readTasks().filter(t => t.enabled && t.time === hhmm);
  for (const task of tasks) {
    console.log(`[Scheduler] Çalıştırılıyor: "${task.name}" (${hhmm})`);
    runTask(task).catch(err => console.error('[Scheduler] Hata:', err.message));
  }
}

function start() {
  setInterval(tick, 60 * 1000);
  console.log('[Scheduler] Zamanlanmış görev servisi başlatıldı');
}

module.exports = { start, readTasks, createTask, updateTask, deleteTask, TASK_TYPES };
