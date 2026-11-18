// server/server-hub/__tests__/regex-dogrusal.test.js — Sonar S8786: Server Hub sondaki dizi kirpma
// desenleri dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI ciktiyi verir.
//
//   SH1 `X+$` -> `(?<!X)X+$` (assess urun tabani rakam soneki, capraz / ear-envanter-alim '/'): replace'in
//       en soldaki eslesmesi zaten sondaki X dizisinin basinda baslar (bir onceki karakter X degil);
//       geri bakis yalniz dizinin icinden yeniden denemeyi keser. Eski desen X...X + 'a' girdisinde
//       her X'ten sona tarar: karesel.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const ASSESS = H.kaynak('server/server-hub/assess.cjs');
const CAPRAZ = H.kaynak('server/server-hub/capraz.cjs');
const ALIM = H.kaynak('server/server-hub/ear-envanter-alim.cjs');

test('SH1 sondaki dizi kirpma: 4 nokta eskisiyle ayni, kotu girdide hizli', () => {
  const noktalar = [
    [ASSESS, 'const base = U(sp).replace(', /[0-9]+$/, '7'],
    [CAPRAZ, "String(y || '')\n    .replace(", /\/+$/, '/'],
    [ALIM, "String(env.EAR_ENVANTER_DIR || '')\n    .trim()\n    .replace(", /\/+$/, '/'],
    [ALIM, "const s = String(kok || '').replace(", /\/+$/, '/'],
  ];
  for (const [metin, capa, eski, x] of noktalar) {
    const yeni = H.literalAl(metin, capa);
    H.esdeger({
      eski,
      yeni,
      kip: 'replace',
      tokenlar: [x, x, x, '0', 'JBOSS', 'was', '/sw/app', '.', ' ', '\t', '\n', 'ş', '\u0663'],
      enAzEslesen: 500,
    });
    H.hizli(yeni, `${x.repeat(50000)}a`, { kip: 'replace' });
  }
});
