'use strict';
const fs   = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../../data/approvers.json');

function ensureFile() {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]');
}

function readApprovers() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeApprovers(list) {
  ensureFile();
  fs.writeFileSync(dataFile, JSON.stringify(list, null, 2));
}

function addApprover(phone, name) {
  const list = readApprovers();
  if (list.find(a => a.phone === phone)) throw new Error('Bu telefon zaten kayıtlı');
  list.push({ phone, name });
  writeApprovers(list);
  return list;
}

function removeApprover(phone) {
  const list = readApprovers().filter(a => a.phone !== phone);
  writeApprovers(list);
  return list;
}

module.exports = { readApprovers, addApprover, removeApprover };
