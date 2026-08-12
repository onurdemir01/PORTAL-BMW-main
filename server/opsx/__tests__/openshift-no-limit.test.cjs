// server/opsx/__tests__/openshift-no-limit.test.cjs — Openshift dalinda AWX `limit`
// GONDERILMEZ.
//
// GERCEK ARIZA (2026-08-12, uretim): bir tenant/env grubuna birden fazla gercek cluster
// bagli (ark_qa -> gbocptest4,gbocpqa1,gbocpqa2,gbocpankqa2) ve kullanici yalnizca birini
// hedeflemek istedi. Secilen ad AWX'in `limit` alanina konuldu. Portal DOGRU gonderdi
// (HAR: "limit":"gbocpankqa2") ama AWX, job template'inde Limit icin "Prompt on launch"
// KAPALI oldugu icin alani SESSIZCE YOK SAYDI: job detayinda limit gorunmedi ve is DORT
// host'ta birden kostu. Kullanici secim yaptigini sandi — yaniltici bir "calisiyor" hissi.
//
// Ayni tuzagin extra_vars kardesi icin bkz. server/ansible/template-preflight.cjs.
// Repo bunu baska bir yerde zaten biliyor: runner.cjs, `ask_limit_on_launch` acikken
// limit gonderiyor (bkz. `if (detail?.ask_limit_on_launch && limit)`).
//
// Bu test, ozelligi "belki calisir" umuduyla geri koymaya karsi bir bekcidir: AWX'te kutu
// acilmadan limit gondermek, kullaniciya yalan soylemektir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OPSX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const TELNET = fs.readFileSync(path.join(__dirname, '..', '..', 'telnet', 'index.cjs'), 'utf8');

test('OpsX Openshift dalinda limitValue DOLDURULMAZ', () => {
  // Legacy dali limit'i mesru olarak kullanir (o template'te kutu ACIK); yasak olan,
  // Openshift dalinda limit uretmek.
  assert.ok(!/ocClusters/.test(OPSX), 'ocClusters geri gelmis — AWX bu limiti yutuyor');
  assert.ok(!/ocClusterLimit/.test(OPSX), 'Openshift dalinda limit hesabi geri gelmis');
});

test('Telnet OCP dalinda launchJobOnServer bos limit ile cagrilir', () => {
  assert.match(
    TELNET,
    /namespace: ns[\s\S]{0,600}launchJobOnServer\(serverId, templateId, extraVars, ''\)/,
    'Telnet OCP job\'i limit ile baslatiliyor — AWX onu yok sayar, kullanici yanilir'
  );
  assert.ok(!/clusterLimit/.test(TELNET), 'clusterLimit geri gelmis');
});

test('pod kesfi tenant\'in TUM cluster\'larina bakar (fan-out daraltilmaz)', () => {
  // Bu yol AWX limit'ini kullanmiyor (kendi playbook'umuza ocp_clusters[] gidiyor) ama
  // kullanici karariyla o da eski davranisina donduruldu: daraltma yok.
  assert.match(OPSX, /fanout = await resolveOcpClusterFanout\(envKey, tenantKey, clusterNames\)/);
  assert.ok(!/pickClusterSubset/.test(OPSX), 'cluster alt kumesi yardimcisi geri gelmis');
});
