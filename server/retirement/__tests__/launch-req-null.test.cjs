// server/retirement/__tests__/launch-req-null.test.cjs — RQ1 (uretim 2026-10-08).
//
// "GBSVCVOICEORDER @ GBJBOQ04: DELETE baslatilamadi — Cannot read properties of null (reading
// 'session')". Zamanlayici DELETE'i ve zamanlanmis STOP'u launch(null, ...) ile baslatir; launch()
// `req.session` okuyordu ve zamanlayicinin baslattigi HER is dusuyordu. launch() ve onun cagirdigi
// her yerde `req` null olabilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function govde(ad) {
  const i = SRC.indexOf(`async function ${ad}(`);
  assert.ok(i >= 0, `${ad} yok`);
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j);
}

test('RQ1 launch() req null iken patlamaz: req yalniz req?. ile okunur', () => {
  const b = govde('launch');
  const ciplak = [...b.matchAll(/(?<![?\w.])req\.(\w+)/g)].map((m) => m[0]);
  assert.deepEqual(ciplak, [], `launch() icinde null'a dayaniksiz req erisimi: ${ciplak.join(', ')}`);
  assert.match(b, /req\?\.session\?\.user \|\| \{ username: 'Portal \(zamanlanmis\)' \}/, 'zamanlayici isinde kullanici adi bos kaliyor');
});

test('RQ2 zamanlayici gercekten launch(null, ...) ile cagiriyor (RQ1 bunun icin var)', () => {
  const i = SRC.indexOf("require('./poller.cjs').startPoller(");
  const blok = SRC.slice(i, i + 3000);
  assert.ok((blok.match(/return launch\(\s*null,/g) || []).length >= 2, 'STOP ve DELETE launch(null, ...) ile baslatilmiyor - RQ1 varsayimi degisti');
});
