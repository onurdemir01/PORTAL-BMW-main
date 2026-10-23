// server/__tests__/fixtures/modul-taklit.cjs — `mock.module` icin Node surumunden BAGIMSIZ secenek.
//
// OLCULDU (2026-10-23, nodejs.org resmi ikilileri, SHA256 dogrulandi):
//   22.22.2 / 22.23.4  `options.exports`u SESSIZCE yok sayar: modul BOS doner ("query is not a
//                      function"), test yanlis yerde kirilir. `namedExports` calisir.
//   24.22.1 / 26.12.1  ikisini de kabul eder; IKISI BIRLIKTE verilirse ERR_INVALID_ARG_VALUE.
// `exports` yeni API'dir (`namedExports` ileride kalkabilir): 24+ onu, 22 `namedExports`u alir.
//
// Yardimci yalnizca SECENEK nesnesini uretir; `mock.module` cagrisini test dosyasi kendisi yapar,
// cunku belirtec (or. '../mssql.cjs') CAGIRAN dosyaya gore cozulur. Bekci: modul-taklit.test.cjs.
'use strict';

function modulTaklitSecenegi(disaAktarim, surum = process.versions.node) {
  const ana = Number(String(surum).replace(/^v/, '').split('.')[0]);
  return ana >= 24 ? { exports: disaAktarim } : { namedExports: disaAktarim };
}

module.exports = { modulTaklitSecenegi };
