// server/__tests__/regex-dogrusal.test.js — Sonar S8786: tek desenli kucuk moduller (audit, auth,
// duty-roster, dynatrace, mcp, nginx-console). Yeni desen KAYNAKTAN okunur, eskisiyle AYNI sonucu verir.
//
//   SV1 sondaki dizi kirpma `X+$` -> `(?<!X)X+$` (origin listesi / CORS '/', HMAC imzasi '=', mcp ve
//       nginx-console dizin '/'): replace'in en soldaki eslesmesi zaten dizinin basinda baslar.
//   SV2 duty-roster e-posta (test): alan adi = ilk karakter + '.' icermeyen kosu + ilk '.' + kalan;
//       eski "konum 1..son-1 arasinda '.'" kosuluyla ayni, '.' dahil sinif takasi yok.
//   SV3 dynatrace `anahtar: deger`: `:\s*(.*)$` -> `:\s*(?!\s)(.*)$`. Eski desen yalniz en uzun bosluk
//       bolmesinde basarili olabilirdi; ileri bakis onu zorlar, basarisizlikta geri izleme O(1).
//   SV4 audit hostOf: `.replace(/\/.*$/, '')` yerine son satirdaki ilk '/' indexOf ile; ayni sonuc.
'use strict';

const { test } = require('node:test');
const H = require('./fixtures/regex-esdeger.cjs');
const { hostOf } = require('../audit/nginx-app-routes.cjs');

const ORIGIN = H.kaynak('server/auth/origin-kontrolu.cjs');
const BELIRTEC = H.kaynak('server/auth/oturum-belirteci.cjs');
const MCP = H.kaynak('server/mcp/client.cjs');
const NGINX = H.kaynak('server/nginx-console/index.cjs');
const DUTY = H.kaynak('server/duty-roster/index.cjs');
const DYNA = H.kaynak('server/dynatrace/index.cjs');

test('SV1 sondaki dizi kirpma: 5 nokta eskisiyle ayni, kotu girdide hizli', () => {
  const noktalar = [
    [ORIGIN, 's.trim().toLowerCase().replace(', /\/+$/, '/'],
    [ORIGIN, "'http://localhost:3000').toLowerCase().replace(", /\/+$/, '/'],
    [BELIRTEC, ".digest('base64').replace(", /=+$/, '='],
    [MCP, 'const base = url.replace(', /\/+$/, '/'],
    [NGINX, 'return dizin.replace(', /\/+$/, '/'],
  ];
  for (const [metin, capa, eski, x] of noktalar) {
    const yeni = H.literalAl(metin, capa);
    H.esdeger({
      eski,
      yeni,
      kip: 'replace',
      tokenlar: [x, x, x, 'a', 'https:', 'host:3000', 'Zm9v', '+', ' ', '\n', 'ş'],
      enAzEslesen: 500,
    });
    H.hizli(yeni, `${x.repeat(50000)}a`, { kip: 'replace' });
  }
});

test('SV2 duty-roster e-posta: test() sonucu ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DUTY, 'if (x.email && !');
  H.esdeger({
    eski: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    yeni,
    kip: 'test',
    tokenlar: ['a', 'b', 'com', 'tr', 'ş', '.', '.', '.', 'x.y', '@', ' ', '\t'],
    el: ['a@b.c', 'a@.b.c', 'a@b.', 'a@.b', 'a@b..c', 'a@b@c.d', 'nobet.ci@sirket.invalid'],
    onek: ['ali@', 'a.b@', 'ş@'],
    maks: 6,
    enAzEslesen: 150,
  });
  H.hizli(yeni, `a@${'.a'.repeat(25000)} `, { kip: 'test' });
});

test('SV3 dynatrace anahtar: deger gruplari ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DYNA, 'const m = line.match(');
  H.esdeger({
    eski: /^\s*([A-Za-z_][A-Za-z0-9_ ]*?):\s*(.*)$/,
    yeni,
    tokenlar: [
      'Key',
      'a b',
      ':',
      ':',
      '_',
      '9',
      'x',
      'v v',
      ' ',
      ' ',
      '\t',
      '\r',
      '\u00a0',
      '\u2028',
      'ş',
    ],
    onek: ['  displayId:', 'Severity Level: ', 'status:\t'],
    adet: 6000,
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `k:${' '.repeat(50000)}x\ry`);
});

test('SV4 audit hostOf: eski replace zinciriyle ayni sonuc, kotu girdide hizli', () => {
  const eski = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
  H.esdeger({
    eski,
    yeni: hostOf,
    kip: 'fn',
    tokenlar: [
      'https://',
      'HTTP://',
      '/',
      '/',
      'App.Example.com',
      ':443',
      '?q',
      ' ',
      '\n',
      '\r',
      '\u2028',
      '\u2029',
      'ş',
    ],
    el: ['a/b\nc/d', 'x\n/y', '/a', 'https://h/p\n'],
    adet: 6000,
    enAzEslesen: 2000,
  });
  H.hizli(hostOf, `${'/'.repeat(50000)}\n`, { kip: 'fn' });
  H.hizli(hostOf, `${'a/'.repeat(25000)}\nx`, { kip: 'fn' });
});
