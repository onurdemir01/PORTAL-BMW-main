// server/retirement/__tests__/regex-dogrusal.test.cjs — Sonar S8786: Retirement e-posta adresi ve AWX
// adres desenleri dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI sonucu verir.
//
//   RT1 ADRES_RE (test): eski `@[^...]+\.[^...]+$` alan adinda '.' dahil sinifla takas ediyordu (uzun
//       '.a.a...' + gecersiz son karakterde karesel). Yeni: alan adi = ilk karakter + '.' icermeyen
//       kosu + ilk '.' (konum >= 1) + kalan. Eski kosul "konum 1..son-1 arasinda bir '.'" ile ayni:
//       boyle bir '.' varsa ilk '.' de uygundur.
//   RT2 awxIsAdresi sondaki '/' kirpma: `\/+$` -> `(?<!\/)\/+$`.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const AYAR = H.kaynak('server/retirement/ayar.cjs');
const CIKTI = H.kaynak('server/retirement/is-ciktisi.cjs');

test('RT1 ADRES_RE: test() sonucu ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(AYAR, 'const ADRES_RE = ');
  H.esdeger({
    eski: /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/,
    yeni,
    kip: 'test',
    tokenlar: ['a', 'b', 'com', 'tr', 'ş', '.', '.', '.', 'x.y', '@', ' ', ',', ';<"\''],
    el: [
      'a@b.c',
      'a@.b.c',
      'a@b.',
      'a@.b',
      'a@b..c',
      '.a@b.c',
      'a@b@c.d',
      'ali.veli@sirket.com.tr',
      'a@b.c,d@e.f',
      'a <a@b.c>',
      '"a"@b.c',
    ],
    onek: ['ali@', 'a.b@', 'x_1@', 'ş@'],
    maks: 6,
    enAzEslesen: 150,
  });
  H.hizli(yeni, `a@${'.a'.repeat(25000)} `, { kip: 'test' });
  H.hizli(yeni, `a@a${'.'.repeat(50000)}`, { kip: 'test' });
});

test('RT2 awxIsAdresi sondaki egik cizgi kirpma: cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(CIKTI, 'const kok = String(server.url).replace(');
  H.esdeger({
    eski: /\/+$/,
    yeni,
    kip: 'replace',
    tokenlar: ['/', '/', '/', 'https:', 'awx.local', ':8043', 'a', ' ', '\n', 'ş'],
    enAzEslesen: 500,
  });
  H.hizli(yeni, `${'/'.repeat(50000)}a`, { kip: 'replace' });
});
