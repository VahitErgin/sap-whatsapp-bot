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

const { sendText, sendTemplate } = require('./whatsappService');
const { getOnayBekleyenler, getVadesiGecenler, getCustomerByPhone, runRawQuery } = require('../modules/sapDb');

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
  custom_query:       'Özel SQL Sorgusu',
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

function createTask({ name, type, time, phones, query, enabled = true, templateName, templateLang }) {
  if (!TASK_TYPES[type])  throw new Error('Geçersiz görev tipi');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Saat HH:MM formatında olmalı');
  if (!phones?.length)    throw new Error('En az bir telefon numarası gerekli');
  if (type === 'custom_query' && !query?.trim()) throw new Error('SQL sorgusu gerekli');

  const tasks = readTasks();
  const task  = {
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name:      name || TASK_TYPES[type],
    type,
    time,
    phones:    phones.map(p => String(p).replace(/\D/g, '')),
    enabled:   Boolean(enabled),
    createdAt: new Date().toISOString(),
    ...(type === 'custom_query' ? { query: query.trim() } : {}),
    ...(templateName ? { templateName, templateLang: templateLang || 'tr' } : {}),
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
  const effectiveType = updates.type || tasks[idx].type;
  if (effectiveType === 'custom_query' && updates.query !== undefined && !updates.query?.trim()) {
    throw new Error('SQL sorgusu gerekli');
  }

  const merged = { ...tasks[idx], ...updates, id };
  // Şablon kaldırıldıysa (boş string geldi) alanı sil
  if (updates.templateName === '') {
    delete merged.templateName;
    delete merged.templateLang;
  }
  tasks[idx] = merged;
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

// Şablon seçiliyse sendTemplate, yoksa sendText kullan.
// components: Meta template body parametreleri dizisi — [{ type:'text', text:'...' }, ...]
async function _dispatch(phone, task, text, components) {
  if (task.templateName) {
    await sendTemplate(phone, task.templateName, task.templateLang || 'tr', components);
  } else {
    await sendText(phone, text);
  }
}

async function runPendingApprovals(phone, task) {
  const phone10 = phone.slice(-10);
  const all     = await getOnayBekleyenler();
  const mine    = all.filter(r => String(r.OnaylayanTelefon || '').replace(/\D/g, '').slice(-10) === phone10);

  if (mine.length === 0) return; // onay yoksa sessiz geç

  const lines = mine.slice(0, 5).map(o =>
    `• ${o.BelgeTipi} #${o.DocNum} — ${_fmt(o.DocTotal)} ${o.ParaBirimi}`
  );
  if (mine.length > 5) lines.push(`+ ${mine.length - 5} belge daha...`);

  const text = `📋 *Bekleyen Onaylarınız* (${mine.length} adet)\n\n${lines.join('\n')}\n\n_Detay için "bekleyen onaylar" yazın._`;
  // Şablon parametreleri: {{1}} = adet, {{2}} = belge listesi
  const components = [
    { type: 'text', text: String(mine.length) },
    { type: 'text', text: lines.join('\n') },
  ];
  await _dispatch(phone, task, text, components);
}

async function runOverdueBalances(phone, task) {
  const today   = new Date().toISOString().split('T')[0];
  const phone10 = phone.slice(-10);
  const bp      = await getCustomerByPhone(phone10).catch(() => null);

  let rows;
  if (bp?.CardCode) {
    const data = await getVadesiGecenler({ refDate: today, cardType: 'C' });
    rows = data.filter(r => r.CardCode === bp.CardCode);
  } else {
    rows = (await getVadesiGecenler({ refDate: today, cardType: 'C' })).slice(0, 5);
  }

  if (!rows.length) return;

  const lines = rows.map(r =>
    `• ${r.CardName || r.CardCode}: ${_fmt(r.BakiyeTRY)} TRY`
  );
  const text = `💰 *Vadesi Yaklaşan Bakiyeler*\n\n${lines.join('\n')}`;
  // Şablon parametreleri: {{1}} = müşteri/kişi sayısı, {{2}} = bakiye listesi
  const components = [
    { type: 'text', text: String(rows.length) },
    { type: 'text', text: lines.join('\n') },
  ];
  await _dispatch(phone, task, text, components);
}

async function runCustomQuery(phone, task) {
  const rows = await runRawQuery(task.query);
  if (!rows.length) {
    await _dispatch(phone, task,
      `📊 *${task.name}*\n\nSorgu sonucu boş döndü.`,
      [{ type: 'text', text: task.name }, { type: 'text', text: 'Sonuç bulunamadı.' }]
    );
    return;
  }

  const cols    = Object.keys(rows[0]);
  const display = rows.slice(0, 10);
  const lines   = display.map(r =>
    cols.map(c => `${c}: ${r[c] ?? '—'}`).join(' | ')
  );
  const footer = rows.length > 10 ? `\n_...toplam ${rows.length} kayıt, ilk 10 gösteriliyor_` : '';
  const text   = `📊 *${task.name}*\n\n${lines.join('\n')}${footer}`;
  // Şablon parametreleri: {{1}} = görev adı, {{2}} = sorgu sonucu (ilk 10 satır)
  const components = [
    { type: 'text', text: task.name },
    { type: 'text', text: lines.join('\n') + (footer || '') },
  ];
  await _dispatch(phone, task, text, components);
}

async function runPlaceholder(phone, task) {
  await sendText(phone,
    `📊 *${task.name}* raporu hazırlanıyor.\n\nBu rapor tipi yakında aktif olacaktır.`
  );
}

async function runTask(task) {
  for (const phone of task.phones) {
    try {
      switch (task.type) {
        case 'pending_approvals': await runPendingApprovals(phone, task); break;
        case 'overdue_balances':  await runOverdueBalances(phone, task);  break;
        case 'custom_query':      await runCustomQuery(phone, task);      break;
        default:                  await runPlaceholder(phone, task);      break;
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
