#!/usr/bin/env node
// scripts/fix-ascii.cjs — `lint:ascii` ihlallerini otomatik duzeltir.
//
// NEDEN VAR: `check-ascii.cjs` artik BLOKE EDIYOR (exit 1). Bir kaliteyi kapisi
// yalnizca YASANABILIR oldugunda kalici olur: gelistirici 122 satiri elle
// duzeltmek zorunda kalirsa kapi ilk firsatta tekrar gevsetilir — nitekim
// 2026-09-04'te tam olarak bu oldu.
//
// KAPSAM: `check-ascii.cjs` ile BIREBIR AYNI. Yalnizca YORUM bolumleri ve
// `console.*` satirlari donusturulur; STRING LITERALLER'e DOKUNULMAZ (urun dili
// Turkce kalir). Tespit mantigi oradan kopyalanmistir — ikisi ayrisirsa duzeltici
// bir seyi kacirir ya da dokunmamasi gereken yere dokunur.
//
// GUVENLIK: donusturmeden once ve sonra "yorumlari atilmis kod" karsilastirilir;
// bir string literal degistiyse betik HATA verip HICBIR SEY yazmaz.
'use strict';

const fs = require('fs');
const path = require('path');

const TR_MAP = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};
const TR_RE = /[çğıöşüÇĞİÖŞÜ]/;
const TR_RE_G = /[çğıöşüÇĞİÖŞÜ]/g;
const CONSOLE_RE = /^\s*console\.(log|warn|error|info|debug)\b/;

const translit = (s) => s.replace(TR_RE_G, (c) => TR_MAP[c] || c);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(cjs|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// `check-ascii.cjs` ile AYNI sezgisel — degistirilirse ikisi birden degismeli.
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

// Yorumlari CIKARIR — donusum oncesi/sonrasi karsilastirma icin. Kod ayni kalmali.
function stripComments(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        inBlock = false;
        out.push(line.slice(end + 2));
      }
      continue;
    }
    if (CONSOLE_RE.test(line)) {
      out.push('<console>');
      continue;
    }
    const ci = findCommentStart(line);
    if (ci < 0) {
      out.push(line);
      continue;
    }
    const rest = line.slice(ci);
    if (rest.startsWith('/*') && !rest.includes('*/')) inBlock = true;
    out.push(line.slice(0, ci));
  }
  return out.join('\n');
}

function fixFile(file) {
  const original = fs.readFileSync(file, 'utf-8');
  const lines = original.split('\n');
  let inBlock = false;
  let changed = 0;

  const fixed = lines.map((line) => {
    if (/ascii-ok\s*$/.test(line)) return line;
    if (inBlock) {
      const end = line.indexOf('*/');
      const head = end >= 0 ? line.slice(0, end + 2) : line;
      const tail = end >= 0 ? line.slice(end + 2) : '';
      if (end >= 0) inBlock = false;
      if (!TR_RE.test(head)) return line;
      changed++;
      return translit(head) + tail;
    }
    if (CONSOLE_RE.test(line)) {
      if (!TR_RE.test(line)) return line;
      changed++;
      return translit(line);
    }
    const ci = findCommentStart(line);
    if (ci < 0) return line;
    const head = line.slice(0, ci);
    const comment = line.slice(ci);
    if (comment.startsWith('/*') && !comment.includes('*/')) inBlock = true;
    if (!TR_RE.test(comment)) return line;
    changed++;
    return head + translit(comment);
  });

  if (!changed) return 0;
  const result = fixed.join('\n');

  // GUVENLIK KAPISI: yorumlar disinda hicbir sey degismemeli.
  if (stripComments(original) !== stripComments(result)) {
    throw new Error(`${file}: donusum yorum DISINA tasti — hicbir sey yazilmadi`);
  }
  fs.writeFileSync(file, result);
  return changed;
}

let total = 0;
let files = 0;
for (const root of ['server', 'scripts']) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (path.resolve(file) === path.resolve(__filename)) continue;
    const n = fixFile(file);
    if (n) {
      total += n;
      files++;
    }
  }
}
console.log(`[fix:ascii] ${files} dosyada ${total} satir donusturuldu.`);
