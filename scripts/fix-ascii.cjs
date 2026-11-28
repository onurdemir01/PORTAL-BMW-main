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
// Turkce kalir). Dosya kumesi ve bolum tespiti ikisinde ORTAK (scripts/ascii-kurali.cjs):
// eskiden kopyaydi, ayristi ve duzeltici *.test.js dosyalarini hic gezmiyordu.
//
// GUVENLIK: donusturmeden once ve sonra "yorumlari atilmis kod" karsilastirilir;
// bir string literal degistiyse betik HATA verip HICBIR SEY yazmaz.
'use strict';

const fs = require('fs');
const {
  TR_RE,
  CONSOLE_RE,
  kaynakDosyalari,
  findCommentStart,
  denetlenenBolumler,
} = require('./ascii-kurali.cjs');

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
const TR_RE_G = /[çğıöşüÇĞİÖŞÜ]/g;

const translit = (s) => s.replace(TR_RE_G, (c) => TR_MAP[c] || c);

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
  let changed = 0;
  for (const { satir, bas, son } of denetlenenBolumler(lines)) {
    const line = lines[satir];
    const bolum = line.slice(bas, son);
    if (!TR_RE.test(bolum)) continue;
    lines[satir] = line.slice(0, bas) + translit(bolum) + line.slice(son);
    changed++;
  }

  if (!changed) return 0;
  const result = lines.join('\n');

  // GUVENLIK KAPISI: yorumlar disinda hicbir sey degismemeli.
  if (stripComments(original) !== stripComments(result)) {
    throw new Error(`${file}: donusum yorum DISINA tasti — hicbir sey yazilmadi`);
  }
  fs.writeFileSync(file, result);
  return changed;
}

let total = 0;
let files = 0;
for (const file of kaynakDosyalari()) {
  const n = fixFile(file);
  if (n) {
    total += n;
    files++;
  }
}
console.log(`[fix:ascii] ${files} dosyada ${total} satir donusturuldu.`);
