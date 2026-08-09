// server/opsx/__tests__/operations.test.cjs — OpsX islem beyaz listesi ve playbook modu.
//
// EN KRITIK GARANTILER:
//   (1) Openshift'in genisletilmis islem kumesi Legacy'ye SIZMAZ (legacy playbook'u
//       `podrestart` gibi bir degeri anlamaz ve sessizce yanlis bir sey yapabilir).
//   (2) Yikici islemler `destructive` bayragi tasir — onyuz bunlara ek onay koyar.
//   (3) Varsayilan playbook modu 'external': bu surum canliya ciktiginda OpsX'in
//       OpenShift davranisi DEGISMEZ.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const opsxConfig = require('../config.cjs');

// index.cjs bir Express uygulamasi bekliyor; islem tablosu modulun kaynagindan okunur.
// (Tabloyu disari acmak yalnizca test icin genel bir yuzey eklerdi.)
const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

function operationKeys(platform) {
  const start = INDEX_SRC.indexOf(`${platform}: Object.freeze({`);
  assert.ok(start > 0, `${platform} islem tablosu bulunamadi`);
  const end = INDEX_SRC.indexOf('}),', start);
  return [...INDEX_SRC.slice(start, end).matchAll(/^\s{4}([a-z]+):\s*\{/gm)].map((m) => m[1]);
}

test('legacy islem kumesi DEGISMEDI (5 islem)', () => {
  assert.deepEqual(
    operationKeys('legacy').sort(),
    ['heapdump', 'restart', 'start', 'stop', 'threaddump']
  );
});

test('openshift kumesi: legacy karsiliklari + salt-okunur teshis + pod silme', () => {
  assert.deepEqual(
    operationKeys('openshift').sort(),
    [
      'describe', 'events', 'heapdump', 'podlist', 'podrestart',
      'restart', 'rolloutstatus', 'start', 'stop', 'threaddump',
    ]
  );
});

test("'scale' KULLANICIYA sunulmaz — playbook destekler ama UI kumesinde yoktur", () => {
  // Kullanici karari: "Rollout yonetimi" (undo/pause/serbest scale) bu surumde YOK.
  // `scale` playbook'ta start/stop mekanizmasi olarak durur; menude gorunmez ki
  // operator yanlislikla replica sayisini elle degistirmesin.
  assert.ok(!operationKeys('openshift').includes('scale'));
  const playbook = fs.readFileSync(
    path.join(__dirname, '..', '..', 'ansible', 'playbooks', 'opsx_ocp_operation.yml'), 'utf8'
  );
  assert.match(playbook, /start\|scale\)/, 'playbook scale dalini korumali');
});

test("'rollout undo/pause' HICBIR yerde yok (kapsam disi)", () => {
  const playbook = fs.readFileSync(
    path.join(__dirname, '..', '..', 'ansible', 'playbooks', 'opsx_ocp_operation.yml'), 'utf8'
  );
  assert.ok(!/rollout undo|rollout pause|rollout resume/.test(playbook));
  for (const key of ['rolloutundo', 'rolloutpause', 'rolloutresume']) {
    assert.ok(!operationKeys('openshift').includes(key));
  }
});

test('OCP-ozgu islemler legacy kumesine SIZMAZ', () => {
  const legacy = new Set(operationKeys('legacy'));
  for (const key of ['podlist', 'describe', 'events', 'rolloutstatus', 'podrestart', 'scale']) {
    assert.ok(!legacy.has(key), `'${key}' legacy'de olmamali`);
  }
});

test('yikici islemler destructive bayragi tasir', () => {
  // stop / heapdump / podrestart / restart calisan uygulamayi etkiler.
  for (const key of ['stop', 'heapdump', 'podrestart', 'restart']) {
    const line = INDEX_SRC.split('\n').find((l) => new RegExp(`^\\s{4}${key}:`).test(l) && l.includes('destructive'));
    assert.ok(line && /destructive:\s*true/.test(line), `'${key}' destructive: true olmali`);
  }
});

test('salt-okunur teshis islemleri readOnly VE destructive DEGIL', () => {
  for (const key of ['podlist', 'describe', 'events', 'rolloutstatus']) {
    const line = INDEX_SRC.split('\n').find((l) => new RegExp(`^\\s{4}${key}:`).test(l));
    assert.ok(line, `'${key}' tanimli olmali`);
    assert.match(line, /readOnly:\s*true/, `'${key}' readOnly olmali`);
    assert.match(line, /destructive:\s*false/, `'${key}' yikici sayilmamali`);
  }
});

// ── Playbook modu ────────────────────────────────────────────────────────────

test('varsayilan playbook modu external — bu surum davranisi DEGISTIRMEZ', () => {
  assert.equal(opsxConfig.DEFAULTS.openshift.playbookMode, 'external');
  assert.equal(opsxConfig.DEFAULTS.openshift.clusterListStyle, 'joined');
  assert.equal(opsxConfig.REGISTRY_KEY_BY_MODE.external, 'opsx_openshift_operation');
  assert.equal(opsxConfig.REGISTRY_KEY_BY_MODE.portal, 'opsx_ocp_operation');
});

test('portal modu cluster listesi bicimini ZORLAR (joined secilse bile)', async () => {
  // Iki ayri kutunun tutturulmasi gerekmesin: mod secimi stili de belirler. Yanlis
  // yapilandirilmis bir blob yuzunden portal playbook'una BIRLESIK cluster adi giderse
  // is sessizce yanlis hedefte calisirdi.
  const db = require('../../db/index.cjs');
  const origQuery = db.query;
  db.query = async () => ({ rowCount: 1 });
  try {
    const saved = await opsxConfig.saveConfig({
      openshift: { playbookMode: 'portal', clusterListStyle: 'joined' },
    });
    assert.equal(saved.openshift.playbookMode, 'portal');
    assert.equal(saved.openshift.clusterListStyle, 'perCluster');
  } finally {
    db.query = origQuery;
    opsxConfig.invalidate();
  }
});

test('external mod secildiginde stil admin ne dediyse o kalir', async () => {
  const db = require('../../db/index.cjs');
  const origQuery = db.query;
  db.query = async () => ({ rowCount: 1 });
  try {
    const saved = await opsxConfig.saveConfig({
      openshift: { playbookMode: 'external', clusterListStyle: 'perCluster' },
    });
    assert.equal(saved.openshift.clusterListStyle, 'perCluster');
  } finally {
    db.query = origQuery;
    opsxConfig.invalidate();
  }
});
