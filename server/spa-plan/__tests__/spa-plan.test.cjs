// server/spa-plan/__tests__/spa-plan.test.cjs — SPA Taşıma Planı bekçileri (2026-09-26).
//
// SP1 ekip beyanı: tarih biçimi, "kullanımdaysa tarih zorunlu", yalnız izinli alanlar
// SP2 sahiplik: sahibi ÇÖZÜLEMEYEN uygulama gizlenmez (planlama kör noktası olmasın)
// SP3 ölçüm: "ölçülemedi" ile "yük yok" AYRI
// SP4 ekip "geçti" işaretini KOYAMAZ / KALDIRAMAZ
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeDeclaration, ownedBy, trafficOfApp, groupKeysOf, IN_USE } = require('../index.cjs');

test('SP1: ekip beyanı yalnız izinli alanları alır', () => {
  const taban = { group: 'glomo', namespace: 'ns-prod', application: 'app' };

  assert.throws(() => normalizeDeclaration({ ...taban, plannedDate: '26.09.2026' }), /YYYY-AA-GG/);
  assert.throws(() => normalizeDeclaration({ ...taban, inUse: 'belki' }), /Geçersiz kullanım/);
  // "Kullaniyoruz" deyip tarih vermemek, e-postadaki belirsizligin ta kendisi.
  assert.throws(() => normalizeDeclaration({ ...taban, inUse: 'yes' }), /tarihi zorunlu/);
  assert.throws(() => normalizeDeclaration({ namespace: 'x', application: 'y' }), /zorunlu/);

  const ok = normalizeDeclaration({ ...taban, inUse: 'yes', plannedDate: '2026-10-15', note: ' taşındı mı bak ' });
  assert.deepEqual(ok, {
    group: 'glomo', namespace: 'ns-prod', application: 'app',
    inUse: 'yes', plannedDate: '2026-10-15', note: 'taşındı mı bak',
  });

  // Kullanilmiyorsa tarih ISTENMEZ.
  assert.equal(normalizeDeclaration({ ...taban, inUse: 'no' }).plannedDate, null);

  // Gövdeye state/migratedDate koysalar bile SONUCA GECMEZ.
  const kotu = normalizeDeclaration({ ...taban, inUse: 'no', state: 'migrated', migratedDate: '2026-01-01' });
  assert.equal(kotu.state, undefined);
  assert.equal(kotu.migratedDate, undefined);
  assert.deepEqual(IN_USE, ['yes', 'no', 'unknown']);
});

test('SP2: sahibi çözülemeyen uygulama gizlenmez', () => {
  const keys = groupKeysOf({ groups: ['CN=GT_ARK_EKIP,OU=x,DC=y', 'gt_baska'] });
  assert.ok(keys.has('gt_ark_ekip'));

  assert.equal(ownedBy({ owner: { groups: ['GT_ARK_EKIP'] } }, keys), true);
  assert.equal(ownedBy({ owner: { groups: ['GT_YABANCI'] } }, keys), false);
  // null = "sahibi bilinmiyor" -> ekranda GORUNUR. false ile karistirilmamali.
  assert.equal(ownedBy({ owner: { groups: [] } }, keys), null);
  assert.equal(ownedBy({}, keys), null);
});

test('SP3: ölçülemedi ile "yük yok" ayrı', () => {
  const app = { paths: [{ service: 'GLOMO', location: '/a' }, { service: 'GLOMO', location: '/b' }] };
  const t = new Map([
    ['GLOMO|/a', { req24: 0, req7: 12, hosts: 2, unknown: 0, sampled: false, lastSeen: '2026-09-25' }],
    ['GLOMO|/b', { req24: 0, req7: 0, hosts: 2, unknown: 0, sampled: false, lastSeen: null }],
  ]);
  assert.equal(trafficOfApp(app, t).state, 'active', 'bir yol bile yuk aliyorsa uygulama aktiftir');

  const bos = new Map([['GLOMO|/a', { req24: 0, req7: 0, hosts: 0, unknown: 1, sampled: false, lastSeen: null }]]);
  assert.equal(trafficOfApp(app, bos).state, 'unknown', 'log okunamadi -> olculemedi');

  const ornek = new Map([['GLOMO|/a', { req24: 0, req7: 0, hosts: 1, unknown: 0, sampled: true, lastSeen: null }]]);
  assert.equal(trafficOfApp({ paths: [{ service: 'GLOMO', location: '/a' }] }, ornek).state, 'unknown',
    'log kuyrugu 7 gunu kapsamiyorsa "atil" DENMEZ');

  const idle = new Map([['GLOMO|/a', { req24: 0, req7: 0, hosts: 3, unknown: 0, sampled: false, lastSeen: '2026-08-01' }]]);
  assert.equal(trafficOfApp({ paths: [{ service: 'GLOMO', location: '/a' }] }, idle).state, 'idle');

  // Trafik tablosu YOKSA null doner - ekran "olculemedi" gosterir.
  assert.equal(trafficOfApp(app, null), null);
});

test('SP4: ekip "geçti" işaretine dokunamaz', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  // /declare, migrated_date'e HIC yazmamali.
  const declare = src.slice(src.indexOf("router.put('/declare'"));
  assert.ok(!/migrated_date\s*=/.test(declare), 'ekip beyani migrated_date yazamaz');
  assert.ok(declare.includes("state === 'migrated'"), 'mevcut "gecti" durumu korunmali');
  // Gövdeden gelen state DOGRUDAN kullanilmamali.
  assert.ok(!/req\.body\?\.state/.test(src), 'istemciden gelen state kullanilmamali');
});
