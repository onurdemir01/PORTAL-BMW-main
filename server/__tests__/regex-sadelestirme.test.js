// server/__tests__/regex-sadelestirme.test.js — Sonar S5843 (regex karmasikligi > 20) ve S5869 (sinifta
// kopya) duzeltmeleri davranisi degistirmez (kurumsal is #52, 2026-11-20). Ayni dosyanin baska desenleri
// kendi modul testlerinde: Crypto Hub CR1, DB DR1, Ansible AR4-AR6, log LM6, Yuk Testi PB1-PB3.
//
//   RS1 sir taramasi yer tutucu: tek desen (33) yer tutucu listesi oldu (biri tum degerle eslesirse
//       yer tutucu); /i altinda `[A-Za-z_]` -> `[a-z_]`. Eski desenle ayni sonuc.
//   RS2 nginx rate limit `zone=`: /i altinda `[A-Za-z0-9_.\-]` -> `[\w.-]`; gruplar ayni.
//   RS3 degisen her karakter sinifi, bayraklariyla, BMP'nin tamaminda (vekil yarimlar dahil) ayni
//       karakterleri secer.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./fixtures/regex-esdeger.cjs');
const { yerTutucuMu } = require('../../scripts/sir-tarama.cjs');

const RATELIMIT = H.kaynak('server/nginx-console/ratelimit.cjs');
const HARF_UC = ['K', 'ſ', 'İ', 'ı', 'ş', 'K', 'k'];

test('RS1 sir taramasi yer tutucu listesi eski tek desenle ayni sonuc', () => {
  const eski =
    /^(?:\*+|x+|\.{3}|<[^>]*>|\$.*|\{\{.*\}\}|%[A-Za-z_]+%|changeme|example|ornek|dummy|placeholder|secret|password|parola|sifre|redacted|gizli)$/i;
  H.esdeger({
    eski: (s) => eski.test(s),
    yeni: yerTutucuMu,
    kip: 'fn',
    tokenlar: [
      '*',
      'x',
      'X',
      '.',
      '<',
      '>',
      '$',
      '{',
      '}',
      '%',
      'AB',
      '_',
      '1',
      'changeme',
      'Example',
      'ornek',
      'dummy',
      'placeholder',
      'secret',
      'PASSWORD',
      'parola',
      'sifre',
      'redacted',
      'gizli',
      ' ',
      '\n',
      ...HARF_UC,
    ],
    el: ['***', 'xxx', '...', '....', '<parola>', '$HOME', '{{ s }}', '%APPDATA%', '%A1%', 'Gizli'],
    adet: 30000,
    maks: 4,
    enAzEslesen: 3000,
  });
});

test('RS2 rate limit zone gruplari ayni', () => {
  const yeni = H.literalAl(RATELIMIT, '  zone: ');
  H.esdeger({
    eski: /zone=([A-Za-z0-9_.\-]+)(?::([0-9]+[kmg]?))?/i,
    yeni,
    tokenlar: ['zone=', 'ZONE=', 'api_1', 'a.b', '-', ':', '10', 'm', 'K', ' ', ';', ...HARF_UC],
    adet: 8000,
    enAzEslesen: 2000,
  });
});

test('RS3 degisen karakter siniflari BMP boyunca ayni karakterleri secer', () => {
  const ciftler = [
    ['[A-Za-z_]', '[a-z_]', 'i'], // sir-tarama yer tutucu
    ['[A-Za-z0-9_]', '\\w', 'i'], // degisken-gizle sir degeri
    ['[A-Za-z0-9._~+/-]', '[\\w.~+/-]', 'i'], // degisken-gizle Bearer
    ['[A-Za-z0-9+/]', '[a-z0-9+/]', 'i'], // degisken-gizle Basic
    ['[A-Za-z0-9._~+/=-]', '[\\w.~+/=-]', 'i'], // runner + log Bearer / Basic
    ['[A-Za-z0-9_.\\-]', '[\\w.-]', 'i'], // ratelimit zone
    ['[^\\S\\n\\r\\u2028\\u2029]', '(?![\\n\\r\\u2028\\u2029])\\s', ''], // Crypto Hub bos deger
  ];
  for (const [e, y, b] of ciftler) {
    const eski = new RegExp(`^${e}$`, b);
    const yeni = new RegExp(`^(?:${y})$`, b);
    let secilen = 0;
    for (let k = 0; k <= 0xffff; k += 1) {
      const c = String.fromCharCode(k);
      const a = eski.test(c);
      if (a !== yeni.test(c)) assert.fail(`${e} /${b} -> ${y}: U+${k.toString(16)} farkli`);
      if (a) secilen += 1;
    }
    assert.ok(secilen > 20, `${e}: ${secilen}`);
  }
});
