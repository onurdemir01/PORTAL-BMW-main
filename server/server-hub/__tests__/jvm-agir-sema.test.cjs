// server/server-hub/__tests__/jvm-agir-sema.test.cjs - loadJvmAgir sema paylasimi (2026-11-12).
//
//   JA1 opts verilmezse sema her cagrida okunur (eski davranis)
//   JA2 opts.kol (sonuc ya da soz) verilirse sys.columns sorgusu ATILMAZ, ayni satirlar doner
//   JA3 opts.kol bos (null) cozulurse sema yine okunur (paylasim dusse de sonuc degismez)
//   JA4 semaOku() hata firlatmaz; DB duserse { ok:false } -> loadJvmAgir bos Map
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

const sorgular = [];
let dbDustu = false;
stub('../../inventory/mssql.cjs', {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (s, p) => {
    sorgular.push({ s: String(s), p });
    if (dbDustu) throw new Error('DB yok');
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s))
      return { recordset: SH.JVM_AGIR_KOLONLAR.map((name) => ({ tbl: 'Server_Hub_Jvms', name })) };
    if (/FROM dbo\.Server_Hub_Jvms t/.test(s))
      return { recordset: [{ gen: 8, jvm: ' Musteri ', jvm_args: '-Xmx1g' }] };
    return { recordset: [] };
  },
});

const SH = require('../index.cjs');
const semaSayisi = () => sorgular.filter((x) => /FROM sys\.columns/.test(x.s)).length;

test('JA1 opts yoksa sema her cagrida okunur', async () => {
  sorgular.length = 0;
  const a = await SH.loadJvmAgir('APPSRV01');
  await SH.loadJvmAgir('APPSRV02');
  assert.equal(semaSayisi(), 2);
  assert.equal(a.get('8|musteri').jvm_args, '-Xmx1g');
});

test('JA2 paylasilan sema: sys.columns tekrar okunmaz, sonuc ayni', async () => {
  sorgular.length = 0;
  assert.equal(typeof SH.loadJvmAgir.semaOku, 'function');
  const kolP = SH.loadJvmAgir.semaOku();
  const kol = await kolP;
  assert.equal(semaSayisi(), 1);
  const a = await SH.loadJvmAgir('APPSRV01', { kol: kolP });
  const b = await SH.loadJvmAgir('APPSRV02', { kol });
  assert.equal(semaSayisi(), 1, 'sema yeniden okundu');
  assert.deepEqual([...a.keys()], ['8|musteri']);
  assert.deepEqual([...b.keys()], ['8|musteri']);
  const jvmSorgulari = sorgular.filter((x) => /FROM dbo\.Server_Hub_Jvms t/.test(x.s));
  assert.deepEqual(
    jvmSorgulari.map((x) => x.p[0].value),
    ['APPSRV01', 'APPSRV02'],
  );
});

test('JA3 bos cozulen paylasim: sema yerinde okunur', async () => {
  sorgular.length = 0;
  const a = await SH.loadJvmAgir('APPSRV01', { kol: Promise.resolve(null) });
  assert.equal(semaSayisi(), 1);
  assert.equal(a.size, 1);
});

test('JA4 DB duserse semaOku firlatmaz, loadJvmAgir bos Map', async () => {
  dbDustu = true;
  try {
    const kol = await SH.loadJvmAgir.semaOku();
    assert.equal(kol.ok, false);
    const a = await SH.loadJvmAgir('APPSRV01', { kol });
    assert.equal(a.size, 0);
  } finally {
    dbDustu = false;
  }
});
