// scripts/ascii-kurali.cjs — ASCII kuralinin (lint:ascii) TEK tanimi: hangi dosyalar, satirin hangi bolumu.
//
// check-ascii.cjs denetler, fix-ascii.cjs duzeltir; ikisi de bunu kullanir. Eskiden tespit iki dosyada
// kopyaydi ve ayrismisti (2026-11-28, PR-2 testleri buldu):
//   - duzeltici yalniz .cjs / .mjs geziyordu: Node testleri *.test.js adina gecince (kurumsal is #49)
//     denetleyicinin buldugu test dosyasi ihlallerini hic duzeltmiyordu;
//   - blok yorumunu kapatan satir `ascii-ok` tasiyinca ikisi de yorumu ACIK sayiyordu: sonraki
//     koddaki Turkce dizgi ihlal gorunuyor, duzeltici "yorum DISINA tasti" deyip duruyordu.
//
// Kural: server/ ve scripts/ altindaki .cjs / .mjs / .test.js dosyalarinda YORUM bolumleri ve
// console.* satirlari ASCII olur. Dizgi literalleri kapsam disi (urun dili Turkce kalir).
// Bir satiri bilerek haric tutmak icin satir sonuna `ascii-ok` yazilir.
'use strict';

const fs = require('fs');
const path = require('path');

const TR_RE = /[çğıöşüÇĞİÖŞÜ]/; // cgiosu buyuk/kucuk
const CONSOLE_RE = /^\s*console\.(log|warn|error|info|debug)\b/;
const KOKLER = ['server', 'scripts'];
const DOSYA_RE = /\.(cjs|mjs)$|\.test\.js$/;
const ISTISNA_RE = /ascii-ok\s*$/;

function gez(dizin, out) {
  for (const ad of fs.readdirSync(dizin)) {
    if (ad === 'node_modules' || ad === '.git') continue;
    const p = path.join(dizin, ad);
    if (fs.statSync(p).isDirectory()) gez(p, out);
    else if (DOSYA_RE.test(ad)) out.push(p);
  }
  return out;
}

/** Kuralin kapsadigi dosyalar; yollar calisma dizinine gore (`server/a.cjs`). */
function kaynakDosyalari() {
  const out = [];
  for (const kok of KOKLER) if (fs.existsSync(kok)) gez(kok, out);
  return out;
}

// Satirdaki dizgi disi ilk yorum acilisinin konumu (satir ya da blok yorumu); `http://` gibi iki
// noktadan sonra gelen cift egik cizgi yorum sayilmaz. Sezgisel: tirnaklari izler, duzenli ifade
// literallerini tanimaz.
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
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      if (i > 0 && line[i - 1] === ':') {
        i++;
        continue;
      }
      return i;
    } else if (ch === '/' && line[i + 1] === '*') {
      return i;
    }
  }
  return -1;
}

/**
 * Satirlarin kuralin denetledigi bolumleri: yorum kismi ya da console.* satirinin tamami.
 * `ascii-ok` ile biten satir listeye girmez, ama blok yorum durumu o satira gore de ilerler.
 * @param {string[]} satirlar
 * @returns {{ satir: number, bas: number, son: number }[]} satir indeksi ve [bas, son) araligi
 */
function denetlenenBolumler(satirlar) {
  const out = [];
  let blokta = false;
  satirlar.forEach((line, satir) => {
    let bas = -1;
    let son = line.length;
    if (blokta) {
      bas = 0;
      const bitis = line.indexOf('*/');
      if (bitis >= 0) {
        son = bitis + 2;
        blokta = false;
      }
    } else if (CONSOLE_RE.test(line)) {
      bas = 0;
    } else {
      const ci = findCommentStart(line);
      if (ci >= 0) {
        bas = ci;
        const yorum = line.slice(ci);
        if (yorum.startsWith('/*') && !yorum.includes('*/')) blokta = true;
      }
    }
    if (bas >= 0 && !ISTISNA_RE.test(line)) out.push({ satir, bas, son });
  });
  return out;
}

module.exports = { TR_RE, CONSOLE_RE, kaynakDosyalari, findCommentStart, denetlenenBolumler };
