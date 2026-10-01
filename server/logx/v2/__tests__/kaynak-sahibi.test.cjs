// server/logx/v2/__tests__/kaynak-sahibi.test.cjs
//
// LogX KAYNAK SAHIBI (L4, 2026-10-01). Kullanici karari: Admin yonetir; istenirse bir
// kaynaga sahip atanir, sahip YALNIZCA o kaynagin kisitini ve izinlerini yonetir.
// Baslangicta kimse sahip degil. Sahip ekleme/silme yalnizca Admin.
//
// Gercek LogX router + DURUMLU sahte DB (sahip/kisit/izin tablolari bellekte):
// akislar uctan uca kosar, SQL metnine degil DAVRANISA bakilir.
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../../../db/index.cjs');
const restrictions = require('../restrictions.cjs');
const owners = require('../owners.cjs');

const SAHIP_GRUP = 'CN=odeme-lider,OU=Groups,DC=example,DC=com';

// ── Durumlu sahte DB ────────────────────────────────────────────────────────
let T;
let dbHata = false;
const portalDenetim = [];
function sifirla() {
  T = { owners: [], restrictions: [], grants: [], groupGrants: [], seq: 1 };
  dbHata = false;
  portalDenetim.length = 0;
}
async function sahteSorgu(sql, p = []) {
  const s = String(sql).replace(/\s+/g, ' ');
  if (dbHata && /logx_v2_restriction_owners/.test(s)) throw new Error('db down');
  if (/INSERT INTO portal_audit_logs/.test(s)) {
    portalDenetim.push(p);
    return { rows: [] };
  }
  if (/FROM portal_audit_logs/.test(s)) return { rows: [] };
  // sahipler
  if (/INSERT INTO logx_v2_restriction_owners/.test(s)) {
    const [rt, rk, pt, pr, cb] = p;
    if (
      T.owners.some(
        (o) =>
          o.resource_type === rt &&
          o.resource_key === rk &&
          o.principal_type === pt &&
          o.principal === pr,
      )
    )
      throw Object.assign(new Error('Violation of UNIQUE KEY'), { number: 2627 });
    const row = {
      id: T.seq++,
      resource_type: rt,
      resource_key: rk,
      principal_type: pt,
      principal: pr,
      created_by: cb,
    };
    T.owners.push(row);
    return { rows: [row] };
  }
  if (/DELETE FROM logx_v2_restriction_owners WHERE id/.test(s)) {
    const n = T.owners.length;
    T.owners = T.owners.filter((o) => String(o.id) !== String(p[0]));
    return { rows: [], rowCount: n - T.owners.length };
  }
  if (/FROM logx_v2_restriction_owners WHERE resource_type = \$1 AND resource_key = \$2/.test(s))
    return { rows: T.owners.filter((o) => o.resource_type === p[0] && o.resource_key === p[1]) };
  if (/FROM logx_v2_restriction_owners/.test(s)) return { rows: [...T.owners] };
  // kisitlamalar
  if (/INSERT INTO logx_v2_restrictions/.test(s)) {
    const row = {
      id: T.seq++,
      resource_type: p[0],
      resource_key: p[1],
      description: p[2],
      created_by: p[3],
    };
    T.restrictions.push(row);
    return { rows: [row] };
  }
  if (/DELETE FROM logx_v2_restrictions WHERE id/.test(s)) {
    const n = T.restrictions.length;
    T.restrictions = T.restrictions.filter((r) => String(r.id) !== String(p[0]));
    return { rows: [], rowCount: n - T.restrictions.length };
  }
  if (/FROM logx_v2_restrictions WHERE id = \$1/.test(s))
    return { rows: T.restrictions.filter((r) => String(r.id) === String(p[0])) };
  if (/INSERT INTO logx_v2_restriction_grants/.test(s)) {
    const row = { id: T.seq++, restriction_id: Number(p[0]), username: p[1] };
    T.grants.push(row);
    return { rows: [row] };
  }
  if (/INSERT INTO logx_v2_restriction_group_grants/.test(s)) {
    const row = { id: T.seq++, restriction_id: Number(p[0]), group_dn: p[1] };
    T.groupGrants.push(row);
    return { rows: [row] };
  }
  if (/FROM logx_v2_restrictions r/.test(s)) {
    const satirlar = [];
    const izin = (r) => [
      ...T.grants
        .filter((g) => g.restriction_id === r.id)
        .map((g) => ({ username: g.username, group_dn: null })),
      ...T.groupGrants
        .filter((g) => g.restriction_id === r.id)
        .map((g) => ({ username: null, group_dn: g.group_dn })),
    ];
    let liste = T.restrictions;
    if (/r.resource_key = \$2/.test(s))
      liste = liste.filter((r) => r.resource_type === p[0] && r.resource_key === p[1]);
    for (const r of liste) {
      const iz = izin(r);
      const temel = { ...r, id: r.id };
      if (!iz.length)
        satirlar.push({
          ...temel,
          username: null,
          group_dn: null,
          grant_username: null,
          grant_group: null,
        });
      for (const g of iz)
        satirlar.push({ ...temel, ...g, grant_username: g.username, grant_group: g.group_dn });
    }
    return { rows: satirlar };
  }
  return { rows: [] };
}

// ── Birim ───────────────────────────────────────────────────────────────────
const yedekQuery = db.query;

test('S0 addOwner dogrulamasi: ikisi birden/hicbiri 400; env anahtari BUYUK harf', async () => {
  sifirla();
  db.query = sahteSorgu;
  try {
    for (const govde of [
      { resourceType: 'legacy_app', resourceKey: 'X' },
      { resourceType: 'legacy_app', resourceKey: 'X', username: 'a', groupDn: SAHIP_GRUP },
      { resourceType: 'yok', resourceKey: 'X', username: 'a' },
      { resourceType: 'legacy_app', resourceKey: ' ', username: 'a' },
    ]) {
      const e = await owners.addOwner(govde, 'admin').then(
        () => null,
        (x) => x,
      );
      assert.equal(e?.status, 400, JSON.stringify(govde));
    }
    const o = await owners.addOwner(
      { resourceType: 'env', resourceKey: ' prod ', username: 'ali' },
      'admin',
    );
    assert.equal(o.resourceKey, 'PROD');
    assert.equal(await owners.canManage({ username: 'ALI', role: 'User' }, 'env', 'prod'), true);
  } finally {
    db.query = yedekQuery;
  }
});

test('S0b sahip tablosu okunamazsa yonetim KAPALI (yazma yetkisi; bilmiyorum = hayir)', async () => {
  sifirla();
  db.query = sahteSorgu;
  try {
    T.owners.push({
      id: 1,
      resource_type: 'legacy_app',
      resource_key: 'X',
      principal_type: 'user',
      principal: 'ali',
    });
    dbHata = true;
    assert.equal(
      await owners.canManage({ username: 'ali', role: 'User' }, 'legacy_app', 'X'),
      false,
    );
    assert.equal(
      await owners.canManage({ username: 'boss', role: 'Admin' }, 'legacy_app', 'X'),
      true,
    );
  } finally {
    db.query = yedekQuery;
  }
});

// ── Rota katmani ────────────────────────────────────────────────────────────
let server;
let base;
let oturum = null;

before(async () => {
  db.query = sahteSorgu;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oturum) req.session = { user: oturum };
    next();
  });
  require('../index.cjs').initLogXv2(app);
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  db.query = yedekQuery;
  server && server.close();
});
beforeEach(() => {
  sifirla();
  db.query = sahteSorgu;
});

function istek(method, yol, user, body) {
  oturum = user;
  return new Promise((resolve, reject) => {
    const r = http.request(
      `${base}/api/logx/v2${yol}`,
      { method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      },
    );
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const kim = (username, extra = {}) => ({
  username,
  role: 'User',
  authSource: 'ldap',
  groups: [],
  ...extra,
});
const admin = kim('boss', { role: 'Admin' });
const ali = kim('ali');
const veli = kim('veli');
const lider = kim('lider', { groups: [SAHIP_GRUP] });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

test('S1 baslangicta KIMSE sahip degil: admin-disi kullanici hicbir kaynagi yonetemez', async () => {
  const l = await istek('GET', '/manage/resources', ali);
  assert.equal(l.status, 200);
  assert.deepEqual(l.body.resources, []);
  assert.equal(l.body.isAdmin, false);
  const k = await istek('POST', '/manage/restrictions', ali, {
    resourceType: 'legacy_app',
    resourceKey: 'X',
  });
  assert.equal(k.status, 403, JSON.stringify(k.body));
  assert.equal(T.restrictions.length, 0);
});

test('S2 sahip ekleme/silme YALNIZCA admin; sahip bile sahip ekleyemez', async () => {
  const a = await istek('POST', '/manage/owners', admin, {
    resourceType: 'legacy_app',
    resourceKey: 'X',
    username: 'ali',
  });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const b = await istek('POST', '/manage/owners', ali, {
    resourceType: 'legacy_app',
    resourceKey: 'X',
    username: 'veli',
  });
  assert.equal(b.status, 403, 'sahip sahip ekleyebildi');
  const c = await istek('DELETE', `/manage/owners/${a.body.owner.id}`, ali);
  assert.equal(c.status, 403, 'sahip sahip silebildi');
  assert.equal(T.owners.length, 1);
  await bekle(20);
  assert.ok(portalDenetim.length >= 1, 'sahip ekleme portal denetimine yazilmadi');
  const d = await istek('DELETE', `/manage/owners/${a.body.owner.id}`, admin);
  assert.equal(d.status, 200);
  assert.equal(T.owners.length, 0);
});

test('S3 sahip KENDI kaynagini kisitlar ve izinlerini yonetir; baskasininkine dokunamaz', async () => {
  await owners.addOwner({ resourceType: 'legacy_app', resourceKey: 'X', username: 'ali' }, 'admin');
  const k = await istek('POST', '/manage/restrictions', ali, {
    resourceType: 'legacy_app',
    resourceKey: 'X',
  });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  const id = k.body.restriction.id;
  assert.equal(
    (await istek('POST', `/manage/restrictions/${id}/grants`, ali, { username: 'veli' })).status,
    200,
  );
  assert.equal(
    (await istek('POST', `/manage/restrictions/${id}/group-grants`, ali, { groupDn: SAHIP_GRUP }))
      .status,
    200,
  );
  assert.equal(T.grants.length, 1);
  assert.equal(T.groupGrants.length, 1);
  // Baska kaynak: 403, hicbir sey yazilmaz.
  const y = await istek('POST', '/manage/restrictions', ali, {
    resourceType: 'legacy_app',
    resourceKey: 'Y',
  });
  assert.equal(y.status, 403);
  // Admin'in olusturdugu baska bir kisitlamanin izinleri: 403.
  const z = (
    await istek('POST', '/manage/restrictions', admin, {
      resourceType: 'legacy_app',
      resourceKey: 'Z',
    })
  ).body.restriction.id;
  assert.equal(
    (await istek('POST', `/manage/restrictions/${z}/grants`, ali, { username: 'ali' })).status,
    403,
  );
  assert.equal((await istek('DELETE', `/manage/restrictions/${z}`, ali)).status, 403);
  assert.equal(T.grants.length, 1, 'yetkisiz izin yazildi');
  // Kendi kisitini kaldirabilir.
  assert.equal((await istek('DELETE', `/manage/restrictions/${id}`, ali)).status, 200);
});

test('S4 GRUP sahibi oturumdaki gruplarla eslesir', async () => {
  await owners.addOwner({ resourceType: 'env', resourceKey: 'PROD', groupDn: SAHIP_GRUP }, 'admin');
  const r = await istek('POST', '/manage/restrictions', lider, {
    resourceType: 'env',
    resourceKey: 'prod',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(T.restrictions[0].resource_key, 'PROD');
  assert.equal(
    (
      await istek('POST', '/manage/restrictions', veli, {
        resourceType: 'env',
        resourceKey: 'PROD',
      })
    ).status,
    403,
  );
});

test('S5 kaynak listesi: sahip yalniz KENDININKI, admin hepsini (sahipli ama kisitsiz dahil)', async () => {
  await owners.addOwner({ resourceType: 'legacy_app', resourceKey: 'X', username: 'ali' }, 'admin');
  await owners.addOwner(
    { resourceType: 'legacy_app', resourceKey: 'Y', username: 'veli' },
    'admin',
  );
  await restrictions.createRestriction({ resourceType: 'legacy_app', resourceKey: 'Z' }, 'admin');
  const a = await istek('GET', '/manage/resources', ali);
  assert.deepEqual(
    a.body.resources.map((r) => r.resourceKey),
    ['X'],
  );
  assert.equal(a.body.resources[0].restriction, null, 'sahipli ama kisitsiz kaynak');
  const b = await istek('GET', '/manage/resources', admin);
  assert.deepEqual(b.body.resources.map((r) => r.resourceKey).sort(), ['X', 'Y', 'Z']);
  assert.equal(b.body.isAdmin, true);
});

test('S6 ret mesaji kaynak SAHIPLERINI basvuru yolu olarak soyler', async () => {
  await owners.addOwner({ resourceType: 'legacy_app', resourceKey: 'X', username: 'ali' }, 'admin');
  await owners.addOwner(
    { resourceType: 'legacy_app', resourceKey: 'X', groupDn: SAHIP_GRUP },
    'admin',
  );
  await restrictions.createRestriction({ resourceType: 'legacy_app', resourceKey: 'X' }, 'admin');
  const e = await restrictions.assertAllowed('legacy_app', 'X', veli).then(
    () => null,
    (x) => x,
  );
  assert.ok(e);
  assert.match(
    e.message,
    /Erişim için: kaynak sahipleri \(.*ali.*\) ya da LogX yöneticisi \(Admin\)\./,
  );
  assert.match(e.message, /grup odeme-lider/);
  assert.deepEqual(e.restriction.owners.sort(), ['ali', 'grup odeme-lider'].sort());
});
