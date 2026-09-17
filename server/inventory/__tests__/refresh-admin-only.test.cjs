// server/inventory/__tests__/refresh-admin-only.test.cjs
//
// "Envanteri Yenile" (Urun Envanteri) YALNIZ ADMIN icindir (kullanici, 2026-09-17):
// dugme normal kullaniciya gorunmez VE sunucu ucu 403 doner (dugmeyi gizlemek yetmez,
// API dogrudan cagrilabilir). Kaynak dosyalari okur; DB/AWX gerekmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

test('POST /api/inventory/refresh/run admin disinda 403', () => {
  const src = read('server/inventory/index.cjs');
  const i = src.indexOf("router.post('/refresh/run'");
  assert.ok(i > 0, 'uc yok');
  const body = src.slice(i, i + 600);
  assert.ok(/if \(!isAdmin\(req\)\) return res\.status\(403\)/.test(body), 'admin kapisi ucun ILK satirinda olmali');
  // kapi, govde ayristirmadan (choices) ONCE gelmeli
  assert.ok(body.indexOf('!isAdmin(req)') < body.indexOf('const { choices }'), 'kapi govdeden once');
});

test('"Envanteri Yenile" dugmesi yalniz isAdmin ile render edilir', () => {
  const src = read('src/components/EnvanterPage.tsx');
  assert.ok(src.includes("{activeTable === 'Inventory' && isAdmin && ("), 'dugme isAdmin kosulu tasimali');
  assert.ok(src.includes("const isAdmin = user?.role === 'Admin';"), 'isAdmin oturumdaki rolden');
});
