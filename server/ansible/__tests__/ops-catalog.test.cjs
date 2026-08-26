// Operasyon Katalogu: satir uretimi ve CSV. DB'siz calisir - listApprovers() tablo
// yoksa bos harita donduruyor, bu yuzden onay mercii kolonu bos gelir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildCatalog, toCsv } = require('../ops-catalog.cjs');

const ITEMS = [
  { id: 'a1', title: 'Nginx - RVP Operations', awxServerId: 1, awxTemplateId: 10, enabled: true },
  { id: 'a2', title: 'Sadece PROD onayli is', awxServerId: 1, awxTemplateId: 11, enabled: true },
  { id: 'a3', title: 'Onaysiz is', awxServerId: 1, awxTemplateId: 12, enabled: false },
];
const CUSTOM = {
  10: { smartApproval: { enabled: true, flowKey: 'ESKI_FLOW' }, ocoCheck: { enabled: true } },
  11: { smartApproval: { enabled: true, flowKey: 'VARSAYILAN', envs: ['prod'], flowKeyByEnv: { prod: 'PROD_FLOW' } } },
  12: {},
};

const deps = {
  readSsItems: () => ITEMS,
  readCustom: (_s, tpl) => CUSTOM[Number(tpl)] || {},
  getServerById: () => ({ name: 'AWX-1' }),
};

const rowsFor = (rows, service) => rows.filter((r) => r.service === service);

test('her servis icin 4 ortam satiri uretilir', async () => {
  const rows = await buildCatalog(deps);
  assert.strictEqual(rowsFor(rows, 'Nginx - RVP Operations').length, 4);
  assert.deepStrictEqual(
    rowsFor(rows, 'Nginx - RVP Operations').map((r) => r.env),
    ['dev', 'test', 'qa', 'prod']
  );
});

test('envs verilmemis servis: Smart TUM ortamlarda istenir (eski davranis)', async () => {
  const rows = await buildCatalog(deps);
  for (const r of rowsFor(rows, 'Nginx - RVP Operations')) {
    assert.strictEqual(r.smartRequired, true, r.env);
    assert.strictEqual(r.flowKey, 'ESKI_FLOW', r.env);
  }
});

test('envs: ["prod"] olan servis: yalniz PROD satirinda Smart var', async () => {
  const rows = await buildCatalog(deps);
  const byEnv = Object.fromEntries(rowsFor(rows, 'Sadece PROD onayli is').map((r) => [r.env, r]));
  assert.strictEqual(byEnv.dev.smartRequired, false);
  assert.strictEqual(byEnv.test.smartRequired, false);
  assert.strictEqual(byEnv.qa.smartRequired, false);
  assert.strictEqual(byEnv.prod.smartRequired, true);
  // Ortam bazli flow override'i raporda da gorunmeli.
  assert.strictEqual(byEnv.prod.flowKey, 'PROD_FLOW');
  // Smart istenmeyen ortamlarda flowKey YAZILMAZ - yaniltici olurdu.
  assert.strictEqual(byEnv.test.flowKey, '');
});

test('OCO yalnizca PROD satirinda gerekli, ama yapilandirildigi her satirda gorunur', async () => {
  const rows = await buildCatalog(deps);
  const byEnv = Object.fromEntries(rowsFor(rows, 'Nginx - RVP Operations').map((r) => [r.env, r]));
  assert.strictEqual(byEnv.prod.ocoRequired, true);
  assert.strictEqual(byEnv.test.ocoRequired, false);
  // ocoConfigured, "bu serviste OCO hic yok" ile "var ama bu ortamda gecerli degil"i ayirir.
  assert.strictEqual(byEnv.test.ocoConfigured, true);
});

test('hicbir kapisi olmayan servis her ortamda kapisiz gorunur', async () => {
  const rows = await buildCatalog(deps);
  for (const r of rowsFor(rows, 'Onaysiz is')) {
    assert.strictEqual(r.smartRequired, false);
    assert.strictEqual(r.ocoRequired, false);
    assert.strictEqual(r.ocoConfigured, false);
  }
});

test('LogX/OpsX/FileX/Telnet katalogda "kapi yok" olarak yer alir', async () => {
  const rows = await buildCatalog(deps);
  for (const m of ['LogX', 'OpsX', 'FileX', 'Telnet']) {
    const mr = rows.filter((r) => r.module === m);
    assert.strictEqual(mr.length, 4, m);
    assert.ok(mr.every((r) => r.smartRequired === false && r.ocoRequired === false), m);
    assert.match(mr[0].note, /onay kapisi tanimli degil/);
  }
});

test('CSV: BOM + noktali virgul + Evet/Hayir', async () => {
  const csv = toCsv(await buildCatalog(deps));
  assert.ok(csv.startsWith('﻿'), 'BOM ile baslamali');
  const head = csv.split('\r\n')[0];
  assert.ok(head.includes(';'), 'noktali virgulle ayrilmali');
  assert.ok(head.includes('"Onay mercii"'));
  assert.ok(csv.includes('"Evet"') && csv.includes('"Hayır"'));
});

test('CSV: formul enjeksiyonu notrlenir', async () => {
  const csv = toCsv([{ module: 'X', service: '=cmd|calc', envLabel: 'DEV', smartRequired: false }]);
  assert.ok(csv.includes('"\'=cmd|calc"'), 'bastaki = kacirilmali');
});

test('CSV: cift tirnak kacirilir', async () => {
  const csv = toCsv([{ module: 'X', service: 'a"b', envLabel: 'DEV', smartRequired: false }]);
  assert.ok(csv.includes('"a""b"'));
});
