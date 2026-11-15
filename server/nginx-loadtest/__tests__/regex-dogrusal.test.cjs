// server/nginx-loadtest/__tests__/regex-dogrusal.test.cjs — Sonar S8786: yuk testi dogrulama / poller
// desenleri dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI ciktiyi verir.
//
//   NL1 sondaki dizi kirpma `X+$` -> `(?<!X)X+$` (dizin '/', server_name ';'): replace'in en soldaki
//       eslesmesi zaten dizinin basinda baslar; geri bakis dizinin icinden yeniden denemeyi keser.
//   NL2 server_name tirnaklari `^["']+|["']+$` (g): ikinci kola ayni geri bakis. Bastaki kol tirnak
//       dizisini butun yuttugu icin sonraki arama tirnakla komsu konumdan baslamaz; cikti ayni.
//   NL3 agirlik metni `\.?0+$` -> `\.?(?<!0)0+$`: eslesme ya '.' + sondaki sifirlar ya da sondaki sifir
//       dizisinin basi; geri bakis sifirlar dizisinin icinden yeniden denemeyi keser.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const DOGRULA = H.kaynak('server/nginx-loadtest/dogrula.cjs');
const POLLER = H.kaynak('server/nginx-loadtest/poller.cjs');

test('NL1 dizin / server_name sondaki dizi kirpma: cikti ayni, kotu girdide hizli', () => {
  const noktalar = [
    [DOGRULA, "String(env.NGINX_LOADTEST_DIR ?? '').trim().replace(", /\/+$/, '/'],
    [POLLER, 'String(kosuBolumu.sw_dizin).replace(', /\/+$/, '/'],
    [DOGRULA, "String(ad ?? '').trim().toLowerCase().replace(", /;+$/, ';'],
  ];
  for (const [metin, capa, eski, x] of noktalar) {
    const yeni = H.literalAl(metin, capa);
    H.esdeger({
      eski,
      yeni,
      kip: 'replace',
      tokenlar: [x, x, x, 'a', '/sw/yuk', 'b.c', ' ', '"', "'", '\t', '\n', 'ş'],
      enAzEslesen: 500,
    });
    H.hizli(yeni, `${x.repeat(50000)}a`, { kip: 'replace' });
  }
});

test('NL2 server_name tirnak kirpma (g): cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DOGRULA, "replace(/(?<!;);+$/, '').replace(");
  H.esdeger({
    eski: /^["']+|["']+$/g,
    yeni,
    kip: 'replace',
    tokenlar: ['"', "'", '"', 'a', 'www.x.com', '*', ';', ' ', '\t', 'ş'],
    el: ['"a"', "''", '"', '"\'a\'"', 'a"b"', '""""'],
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `a${'"'.repeat(50000)}a`, { kip: 'replace' });
  H.hizli(yeni, `"${"'".repeat(50000)}`, { kip: 'replace' });
});

test('NL3 agirlik metni sondaki sifir kirpma: cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(DOGRULA, 'return r.toFixed(6).replace(');
  const sayilar = [];
  const r = H.rastgele(7);
  for (let i = 0; i < 2000; i += 1) sayilar.push((r(2000000) / 10 ** r(7)).toFixed(6));
  H.esdeger({
    eski: /\.?0+$/,
    yeni,
    kip: 'replace',
    tokenlar: ['0', '0', '0', '1', '5', '.', '.', 'e', '+', '-'],
    el: [
      '1.500000',
      '2.000000',
      '100.000000',
      '0.000100',
      '0.000000',
      '1e+21',
      'NaN',
      '100',
      ...sayilar,
    ],
    enAzEslesen: 2000,
  });
  H.hizli(yeni, `${'0'.repeat(50000)}1`, { kip: 'replace' });
  H.hizli(yeni, `1${'.0'.repeat(25000)}x`, { kip: 'replace' });
});
