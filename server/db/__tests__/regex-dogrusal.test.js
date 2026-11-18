// server/db/__tests__/regex-dogrusal.test.js — Sonar S8786: handleReturning'in RETURNING desenleri
// dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI sonucu verir, kotu girdide hizli biter.
//
//   DR1 kolon yakalama (match): eski `\s+([^;]+?)\s*(?:;\s*)?$` uc niceleyici bosluk takas ediyordu
//       (kolon icindeki uzun bosluk dizisinde karesel). Yeni grup: bosluksuz / ';'siz baslayip biten
//       kolon metni `[^\s;](?:[^;]*[^\s;])?`; kolon hic yoksa (RETURNING + bosluk + istege bagli ';')
//       eskinin geri izleyip sectigi SON bosluk karakteri: `\s(?=(?:;\s*)?$)`. Grup 1 birebir ayni.
//   DR2 cumleyi silme (replace): eslesme hep metnin sonuna uzanir, yalniz BASLANGICI onemli. Varlik
//       kosulu `\s+[^;]+?\s*(;\s*)?$` == `\s[^;]+(;\s*)?$` (bosluk [^;] icinde); bastaki `\s*` geri bakisla
//       bosluk dizisinin basina capali (her bosluktan yeniden deneme yok).
//   Not: cok sayida ayni bolumde tekrar eden "RETURNING" sozcugu eski ve yeni desende ayni sekilde
//   (sozcuk basina bir tarama) kalir; girdi kodda yazili SQL'dir.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const DB = H.kaynak('server/db/index.cjs');

const SQL = [
  'RETURNING',
  'returning',
  'xRETURNING',
  'RETURNINGx',
  ' ',
  ' ',
  ' ',
  ';',
  'id',
  't.id',
  'a, b',
  '[id]',
  '*',
  '\t',
  '\n',
  'ş',
];
const SQL_ONEK = [
  'INSERT INTO t (a) VALUES ($1) ',
  'UPDATE t SET a = 1 ',
  'DELETE FROM t WHERE id = 2 ',
];
const SQL_UC = [
  'INSERT INTO t (a) VALUES (1) RETURNING id',
  'INSERT INTO t (a) VALUES (1) RETURNING id;',
  'INSERT INTO t (a) VALUES (1) RETURNING  t.id , b ;  ',
  'UPDATE t SET a=1 RETURNING   ',
  'UPDATE t SET a=1 RETURNING  ;',
  'UPDATE t SET a=1 RETURNING ;',
  'RETURNING a; RETURNING b',
  'RETURNING a RETURNING b;',
  'x RETURNING\n\tid\n',
];

test('DR1 RETURNING kolon yakalama: grup ve eslesme ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DB, 'const m = sql.match(');
  H.esdeger({
    eski: /\bRETURNING\b\s+([^;]+?)\s*(?:;\s*)?$/i,
    yeni,
    tokenlar: SQL,
    el: SQL_UC,
    onek: SQL_ONEK,
    adet: 6000,
    enAzEslesen: 500,
  });
  H.hizli(yeni, `RETURNING a${' '.repeat(50000)}b;x`);
  H.hizli(yeni, `RETURNING ${'a '.repeat(25000)};;`);
});

test('DR2 RETURNING cumlesini silme: replace ciktisi ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DB, '// Remove RETURNING clause\n  sql = sql.replace(');
  H.esdeger({
    eski: /\s*\bRETURNING\b\s+[^;]+?\s*(?:;\s*)?$/i,
    yeni,
    kip: 'replace',
    tokenlar: SQL,
    el: SQL_UC,
    onek: SQL_ONEK,
    adet: 6000,
    enAzEslesen: 500,
  });
  H.hizli(yeni, `RETURNING a${' '.repeat(50000)}b;x`, { kip: 'replace' });
  H.hizli(yeni, `${' '.repeat(50000)}x`, { kip: 'replace' });
});
