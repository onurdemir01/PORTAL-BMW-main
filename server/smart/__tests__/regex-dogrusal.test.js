// server/smart/__tests__/regex-dogrusal.test.js — Sonar S8786: SMART ayar / metadata desenleri dogrusal
// yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI ciktiyi verir, kotu girdide hizli biter.
//
//   SM1 sondaki dizi kirpma `X+$` -> `(?<!X)X+$` (baseUrl '/', blok satiri sonu bosluk/sekme).
//   SM2 satir sonu oncesi bosluk/sekme silme (g): `[ \t]+\n` -> `(?<![ \t])[ \t]+\n`. Eslesme her zaman
//       bosluk dizisinin basinda baslar (onceki eslesme '\n' ile biter); dizi '\n' ile bitmiyorsa eski
//       desen dizinin her konumundan yeniden tarardi.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const CONFIG = H.kaynak('server/smart/config.cjs');
const META = H.kaynak('server/smart/metadata.cjs');

test('SM1 sondaki dizi kirpma: cikti ayni, kotu girdide hizli', () => {
  const noktalar = [
    [CONFIG, "baseUrl: (process.env.SMART_API_URL || '').replace(", /\/+$/, ['/']],
    [META, 'b.slice(indent).replace(', /[ \t]+$/, [' ', '\t']],
  ];
  for (const [metin, capa, eski, x] of noktalar) {
    const yeni = H.literalAl(metin, capa);
    H.esdeger({
      eski,
      yeni,
      kip: 'replace',
      tokenlar: [...x, ...x, ...x, 'a', 'https://smart', ':', '\n', '\r', '\u00a0', 'ş'],
      enAzEslesen: 500,
    });
    H.hizli(yeni, `${x.join('').repeat(25000)}a`, { kip: 'replace' });
  }
});

test('SM2 metadata satir sonu oncesi bosluk silme (g): cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(META, String.raw`.replace(/\\n/g, '\n')` + '\n        .replace(');
  H.esdeger({
    eski: /[ \t]+\n/g,
    yeni,
    kip: 'replace',
    yerine: '\n',
    tokenlar: [' ', ' ', '\t', '\n', '\n', 'a', 'NS: x', '\r', '\u00a0', 'ş'],
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `${' '.repeat(50000)}a`, { kip: 'replace', yerine: '\n' });
  H.hizli(yeni, `${' \t'.repeat(25000)}a\n`, { kip: 'replace', yerine: '\n' });
});
