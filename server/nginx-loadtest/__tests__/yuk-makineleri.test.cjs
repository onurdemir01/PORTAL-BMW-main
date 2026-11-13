// server/nginx-loadtest/__tests__/yuk-makineleri.test.cjs - yuk makinesi listesi Portal'dan (2026-11-13).
//   YM1 tablo bos: ortam listesi (env / varsayilan) gecer, kaynak 'ortam'
//   YM2 ilk ekleme ortam listesini tasir; kapi reddederse hicbir sey yazilmaz
//   YM3 son makine cikarilamaz; tasima + silme; listede olmayan 404
//   YM4 tablo okunamazsa 424 (ortam listesine sessizce donmez)
//   YM5 kablolama: kosu plani ve /hedefler listeyi Portal'dan okur; yazma uclari Admin; tablo kurulumda
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ym = require('../yuk-makineleri.cjs');

function sahteDb({ bozuk = false } = {}) {
  const tablo = new Map();
  return {
    tablo,
    async query(q, p = []) {
      if (bozuk) throw new Error('baglanti yok');
      if (/^SELECT host, note/.test(q)) {
        return { rows: [...tablo.values()].sort((a, b) => a.host.localeCompare(b.host)) };
      }
      if (/^INSERT INTO/.test(q)) {
        if (!tablo.has(p[0])) tablo.set(p[0], { host: p[0], note: p[1], created_by: p[2], created_at: new Date(0) });
        return { rows: [] };
      }
      if (/^DELETE FROM/.test(q)) {
        tablo.delete(p[0]);
        return { rows: [] };
      }
      throw new Error('beklenmeyen sorgu: ' + q);
    },
  };
}

const ok = async () => ({ ok: true });

test('YM1 tablo bos: ortam listesi', async (t) => {
  const eski = process.env.NGINX_LOADTEST_YUK_HOSTLARI;
  t.after(() => {
    if (eski === undefined) delete process.env.NGINX_LOADTEST_YUK_HOSTLARI;
    else process.env.NGINX_LOADTEST_YUK_HOSTLARI = eski;
  });
  delete process.env.NGINX_LOADTEST_YUK_HOSTLARI;
  const r = await ym.oku(sahteDb());
  assert.deepEqual(r.hostlar, ['GBNGXT34']);
  assert.equal(r.kaynak, 'ortam');
  process.env.NGINX_LOADTEST_YUK_HOSTLARI = 'gbngxt34, GBNGXD02';
  assert.deepEqual((await ym.oku(sahteDb())).hostlar, ['GBNGXT34', 'GBNGXD02']);
});

test('YM2 ilk ekleme ortam listesini tasir; kapi reddi yazmaz', async () => {
  delete process.env.NGINX_LOADTEST_YUK_HOSTLARI;
  const db = sahteDb();
  await assert.rejects(
    ym.ekle(db, { host: 'GBNGXP01' }, 'onur', async () => ({ ok: false, code: 'yuk_host_izinsiz', message: 'GBNGXP01 ortamı PROD' })),
    (e) => e.status === 409 && /PROD/.test(e.message),
  );
  assert.equal(db.tablo.size, 0, 'reddedilen ekleme tabloya dokunmamali');
  const r = await ym.ekle(db, { host: 'gbngxt33', not: ' RP degil ' }, 'onur', ok);
  assert.deepEqual(r.hostlar, ['GBNGXT33', 'GBNGXT34']);
  assert.equal(r.kaynak, 'portal');
  assert.equal(db.tablo.get('GBNGXT33').note, 'RP degil');
  assert.match(db.tablo.get('GBNGXT34').note, /taşındı/);
  await assert.rejects(ym.ekle(db, { host: 'GBNGXT33' }, 'onur', ok), (e) => e.code === 'zaten_var');
  await assert.rejects(ym.ekle(db, { host: 'a b' }, 'onur', ok), (e) => e.status === 400);
});

test('YM3 cikarma: son makine kalir; tasima once', async () => {
  delete process.env.NGINX_LOADTEST_YUK_HOSTLARI;
  const db = sahteDb();
  await assert.rejects(ym.cikar(db, 'GBNGXT34', 'onur'), (e) => e.code === 'son_makine');
  assert.equal(db.tablo.size, 0);
  await ym.ekle(db, { host: 'GBNGXT33' }, 'onur', ok);
  const r = await ym.cikar(db, 'gbngxt34', 'onur');
  assert.deepEqual(r.hostlar, ['GBNGXT33']);
  await assert.rejects(ym.cikar(db, 'GBNGXT33', 'onur'), (e) => e.code === 'son_makine');
  await assert.rejects(ym.cikar(db, 'GBNGXT99', 'onur'), (e) => e.status === 404);
});

test('YM4 tablo okunamazsa kapali (424)', async () => {
  await assert.rejects(ym.oku(sahteDb({ bozuk: true })), (e) => e.status === 424 && e.code === 'yuk_makineleri_okunamadi');
});

test('YM5 kablolama', () => {
  const kok = path.join(__dirname, '..', '..', '..');
  const idx = fs.readFileSync(path.join(kok, 'server', 'nginx-loadtest', 'index.cjs'), 'utf8');
  const plan = idx.slice(idx.indexOf('async function kosuPlani('), idx.indexOf('const yukKapisi = (hedef)'));
  assert.match(plan, /const izinli = \(await yukMakineleri\.oku\(db\(\)\)\)\.hostlar;/);
  assert.doesNotMatch(idx, /dg\.yukHostlari\(\)/, 'liste hala yalniz ortamdan okunuyor');
  for (const uc of ["router.post('/yuk-makineleri'", "router.delete('/yuk-makineleri/:host'"]) {
    const i = idx.indexOf(uc);
    assert.ok(i > 0, uc);
    assert.match(idx.slice(i, i + 400), /adminSart\(req\);/, `${uc} Admin istemiyor`);
  }
  const kurulum = fs.readFileSync(path.join(kok, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(kurulum, /CREATE TABLE nginx_loadtest_yuk_hostlari \(/);
});
