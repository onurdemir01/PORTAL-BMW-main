// server/logx/v2/__tests__/restrictions-filter.test.cjs
//
// `filterAllowed` liste uclari icindir (`GET /ocp/cache/namespaces`). Iki sey onemli:
//   1) VARSAYILAN-ACIK semantigi `isAllowed` ile BIREBIR ayni olmali — kisitlama satiri
//      olmayan kaynak herkese acik, satiri olan yalniz grant sahiplerine.
//   2) TEK sorgu ile calismali: 1000 namespace'lik bir cluster'da dongude `isAllowed`
//      cagirmak 1000 sorgu demekti.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const restrictions = require('../restrictions.cjs');

function withDb(rows, fn) {
  const orig = db.query;
  const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}

const KEYS = ['ark/prod/c1/acik-ns', 'ark/prod/c1/kisitli-ns', 'ark/prod/c1/baska-ns'];

test('filterAllowed(): kisitlama satiri OLMAYAN kaynak listede kalir (varsayilan-acik)', async () => {
  await withDb([], async () => {
    const out = await restrictions.filterAllowed('ocp_namespace', KEYS, { username: 'ali', role: 'User' });
    assert.deepEqual(out, KEYS, 'hic kisitlama yoksa liste aynen donmeli');
  });
});

test('filterAllowed(): kisitli ve grant ALMAMIS kaynak listeden DUSER', async () => {
  // Kisitlama satiri var, bu kullaniciya grant yok → LEFT JOIN username NULL doner.
  await withDb([{ resource_key: 'ark/prod/c1/kisitli-ns', username: null }], async () => {
    const out = await restrictions.filterAllowed('ocp_namespace', KEYS, { username: 'ali', role: 'User' });
    assert.deepEqual(out, ['ark/prod/c1/acik-ns', 'ark/prod/c1/baska-ns']);
  });
});

test('filterAllowed(): kisitli ama grant ALMIS kaynak listede kalir', async () => {
  await withDb([{ resource_key: 'ark/prod/c1/kisitli-ns', username: 'ali' }], async () => {
    const out = await restrictions.filterAllowed('ocp_namespace', KEYS, { username: 'ali', role: 'User' });
    assert.deepEqual(out, KEYS);
  });
});

test('filterAllowed(): Admin hicbir sorgu yapmadan tam listeyi alir', async () => {
  await withDb([], async (calls) => {
    const out = await restrictions.filterAllowed('ocp_namespace', KEYS, { username: 'admin', role: 'Admin' });
    assert.deepEqual(out, KEYS);
    assert.equal(calls.length, 0, 'Admin icin veritabanina gidilmemeli');
  });
});

test('filterAllowed(): 500 anahtar icin TEK sorgu yapilir (N+1 yok)', async () => {
  const many = Array.from({ length: 500 }, (_, i) => `ark/prod/c1/ns-${i}`);
  await withDb([], async (calls) => {
    await restrictions.filterAllowed('ocp_namespace', many, { username: 'ali', role: 'User' });
    assert.equal(calls.length, 1, 'anahtar sayisindan bagimsiz tek sorgu');
    // ASIL KURAL: anahtarlar parametreye KONMAZ (MSSQL'de 2100 parametre siniri var ve
    // 500 namespace'lik bir cluster o siniri zorlar). Onceki hali `params.length === 2`
    // diye SIHIRLI BIR SAYIYA baglanmisti; grup grant'i eklendiginde kullanici adi
    // SQL'den cikip JS'e tasindigi icin sayi 1'e dustu ve test, kural hala saglanirken
    // kirmizi verdi. Artik kuralin KENDISI olculuyor.
    assert.ok(calls[0].params.length <= 2, `parametre sayisi anahtar sayisiyla buyumemeli: ${calls[0].params.length}`);
    for (const key of many) {
      assert.ok(!calls[0].params.includes(key), `anahtar parametre olarak gonderilmis: ${key}`);
    }
  });
});

test('filterAllowed(): bos liste sorgu yapmadan doner', async () => {
  await withDb([], async (calls) => {
    assert.deepEqual(await restrictions.filterAllowed('ocp_namespace', [], { username: 'ali', role: 'User' }), []);
    assert.equal(calls.length, 0);
  });
});
