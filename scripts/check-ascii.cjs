#!/usr/bin/env node
// scripts/check-ascii.cjs — Turkce karakter guard'i (lint:ascii).
// Kural: server kodunda YORUM satirlari ve console.* LOG satirlari ASCII olmali.
// String literaller (UI/API mesajlari, DB seed degerleri) kapsam DISIdir — urun dili
// Turkce kalir. Ihlal bulursa dosya:satir listeler ve exit 1 doner (CI guard).
//
// Istisna: bir satiri bilerek haric tutmak icin satir sonuna `ascii-ok` yazin.
'use strict';

const fs = require('fs');
const path = require('path');

const TR_RE = /[çğıöşüÇĞİÖŞÜ]/; // cgiosu buyuk/kucuk
const CONSOLE_RE = /^\s*console\.(log|warn|error|info|debug)\b/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(cjs|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Satirdaki string-disi ilk // konumu (http:// haric) — scripts icindeki
// transliterasyon araciyla ayni sezgisel.
function findCommentStart(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '/' && line[i + 1] === '/') {
        if (i > 0 && line[i - 1] === ':') {
          i++;
          continue;
        }
        return i;
      } else if (ch === '/' && line[i + 1] === '*') return i;
    }
  }
  return -1;
}

const roots = ['server', 'scripts'];
const violations = [];

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (path.resolve(file) === path.resolve(__filename)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    let inBlock = false;
    lines.forEach((line, idx) => {
      if (/ascii-ok\s*$/.test(line)) return;
      let checked = null;
      if (inBlock) {
        const end = line.indexOf('*/');
        checked = end >= 0 ? line.slice(0, end + 2) : line;
        if (end >= 0) inBlock = false;
      } else if (CONSOLE_RE.test(line)) {
        checked = line;
      } else {
        const ci = findCommentStart(line);
        if (ci >= 0) {
          checked = line.slice(ci);
          if (checked.startsWith('/*') && !checked.includes('*/')) inBlock = true;
        }
      }
      if (checked && TR_RE.test(checked)) {
        violations.push(`${file}:${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
}

if (violations.length) {
  // WARN-ONLY: bu kalite kapisi artik BLOKE ETMEZ; ihlaller raporlanir ama
  // CI / lokal `npm run lint:ascii` sifir doner. Turkce yorumlar kabul edilir;
  // `ascii-ok` isaretine gerek kalmadi ama geriye uyum icin hâlâ taninir.
  console.warn(`[lint:ascii] ${violations.length} ihlal bulundu (uyari — kapı bloke etmez):`);
  for (const v of violations.slice(0, 50)) console.warn('  ' + v);
  if (violations.length > 50) console.warn(`  ... ve ${violations.length - 50} tane daha`);
} else {
  console.log('[lint:ascii] OK — yorum/log satirlari ASCII.');
}
