'use strict';
// DENETIM > UYGULAMA ORTAMLARI (server/audit/app-envs.cjs) — gercek express, envanter sorgusu
// (inventory/mssql.cjs `query`, cagri aninda okunur) yerinde sahte.
//   AE1 parseApp: son eksiz ad PROD; -D/-T/-Q; kucuk harfli ek sapma (ortam yine atanir);
//       taninmayan tek harf sapma ve ortamsiz.
//   AE2 matris: taban ada gore satir, ortam basina sunucular ve satir sayisi, eksik ortamlar,
//       tam uygulama sayisi, en sik 8 eksik deseni.
//   AE3 sapmalar: ortam sozcuguyle biten ad, kucuk harfli ek, taninmayan ek; ortamsiz ad matrise
//       girmez; bos ad atlanir.
//   AE4 celiski: ad ortami ile env sutunu (hostname'den) ayrisirsa; -D Test sunucusunda celiski
//       DEGIL (env sutunu D ile T'yi ayirmaz).
//   AE5 kapsam disi env degerleri (Alpha / ODM bilinen, digerleri bilinmeyen) celiski sayilmaz,
//       uygulama sayisiyla raporlanir.
//   AE6 kaynak secimi: was; yok, bilinmeyen ya da prototip adi (toString) -> mw.
//   AE7 DB hatasi 500 ve ileti.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const envanter = require('../../inventory/mssql.cjs');
const { registerAppEnvs, parseApp } = require('../app-envs.cjs');

async function sunucu(t, satirlar) {
  const sorgular = [];
  t.mock.method(envanter, 'query', async (metin) => {
    sorgular.push(metin);
    if (satirlar instanceof Error) throw satirlar;
    return { recordset: satirlar };
  });
  const router = express.Router();
  registerAppEnvs(router);
  const app = express();
  app.use('/api/denetim', router);
  const s = app.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => new Promise((r) => s.close(r)));
  const al = async (yol) => {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/denetim${yol}`);
    return { status: r.status, govde: await r.json() };
  };
  return { al, sorgular };
}

const satir = (app, env, host) => ({ app, env, host, domain: 'd1' });

test('AE1 parseApp ad kurali', () => {
  assert.deepEqual(parseApp('odeme'), { base: 'odeme', env: 'PROD', standard: true, reason: null });
  assert.deepEqual(parseApp('odeme-D'), {
    base: 'odeme',
    env: 'DEV',
    standard: true,
    reason: null,
  });
  assert.deepEqual(parseApp('odeme-T'), {
    base: 'odeme',
    env: 'TEST',
    standard: true,
    reason: null,
  });
  assert.deepEqual(parseApp('odeme-Q'), { base: 'odeme', env: 'QA', standard: true, reason: null });
  assert.deepEqual(parseApp('odeme-q'), {
    base: 'odeme',
    env: 'QA',
    standard: false,
    reason: 'Küçük harfli son ek',
  });
  assert.deepEqual(parseApp('odeme-X'), {
    base: 'odeme',
    env: null,
    standard: false,
    reason: 'Tanınmayan son ek: -X',
  });
  assert.deepEqual(parseApp('a-b-T').base, 'a-b');
  assert.equal(parseApp('odeme-TT').env, 'PROD', 'iki harfli ek ortam eki sayildi');
});

test('AE2 matris, eksik ortamlar ve desenler', async (t) => {
  const { al, sorgular } = await sunucu(t, [
    satir('odeme', 'Production', 'H2'),
    satir('odeme', 'Production', 'H1'),
    satir('odeme', 'Production', 'H1'),
    satir('odeme-T', 'Test', 'T1'),
    satir('odeme-D', 'Test', 'T2'),
    satir('odeme-Q', 'QA', 'Q1'),
    satir('cari', 'Production', 'H3'),
    satir('cari-T', 'Test', 'T3'),
    satir('borc-Q', 'QA', 'Q2'),
  ]);
  const { status, govde } = await al('/app-envs?source=mw');
  assert.equal(status, 200);
  assert.match(sorgular[0], /FROM dbo\.MWAppsInventory WHERE app IS NOT NULL AND app <> ''$/);
  assert.equal(govde.ok, true);
  assert.equal(govde.source, 'mw');
  assert.equal(govde.label, 'JBoss uygulamalari');
  assert.deepEqual(govde.sources, [
    { key: 'mw', label: 'JBoss uygulamalari' },
    { key: 'was', label: 'WAS uygulamalari' },
  ]);
  assert.deepEqual(govde.envs, ['DEV', 'TEST', 'QA', 'PROD']);
  assert.equal(govde.totalRows, 9);
  assert.equal(govde.totalApps, 3);
  assert.equal(govde.completeCount, 1);
  assert.deepEqual(
    govde.rows.map((r) => r.base),
    ['borc', 'cari', 'odeme'],
  );
  const odeme = govde.rows.find((r) => r.base === 'odeme');
  assert.deepEqual(odeme.envs.PROD, { hosts: ['H1', 'H2'], rows: 3 });
  assert.deepEqual(odeme.envs.DEV, { hosts: ['T2'], rows: 1 });
  assert.deepEqual(odeme.missing, []);
  const borc = govde.rows.find((r) => r.base === 'borc');
  assert.deepEqual(borc.present, ['QA']);
  assert.deepEqual(borc.missing, ['DEV', 'TEST', 'PROD']);
  assert.equal(borc.missingCount, 3);
  assert.equal(borc.envs.PROD, null);
  assert.deepEqual(govde.patterns, [
    { missing: ['DEV', 'TEST', 'PROD'], count: 1 },
    { missing: ['DEV', 'QA'], count: 1 },
  ]);
  assert.deepEqual(govde.nonStandard, []);
  assert.deepEqual(govde.conflicts, []);
  assert.deepEqual(govde.outOfScopeEnvColumns, []);
});

test('AE2b en sik eksik desenleri 8 ile sinirli ve sayiya gore sirali', async (t) => {
  // 9 farkli eksik deseni: her taban ad farkli bir ortam altkumesinde.
  const altkumeler = [
    ['D'],
    ['T'],
    ['Q'],
    [''],
    ['D', 'T'],
    ['D', 'Q'],
    ['T', 'Q'],
    ['D', ''],
    ['T', ''],
  ];
  const satirlar = [];
  altkumeler.forEach((ekler, i) => {
    for (const ek of ekler) satirlar.push(satir(ek ? `u${i}-${ek}` : `u${i}`, '', 'H'));
  });
  // Ayni desen (yalniz PROD) iki kez daha: en sik desen bu olmali. Adlar alfabede SONDA: desen
  // ilk gorulme sirasiyla degil sayiyla siralanmali.
  satirlar.push(satir('zz1', 'Production', 'H'), satir('zz2', 'Production', 'H'));
  const { govde } = await al2(t, satirlar);
  assert.equal(govde.patterns.length, 8);
  assert.deepEqual(govde.patterns[0], { missing: ['DEV', 'TEST', 'QA'], count: 3 });
  for (let i = 1; i < govde.patterns.length; i++)
    assert.ok(govde.patterns[i - 1].count >= govde.patterns[i].count);
});

async function al2(t, satirlar) {
  const { al } = await sunucu(t, satirlar);
  return al('/app-envs?source=mw');
}

test('AE3 sapmalar; ortamsiz ad matrise girmez, bos ad atlanir', async (t) => {
  const { govde } = await al2(t, [
    satir('fatura-PROD', 'Production', 'H2'),
    satir('fatura-PROD', 'Test', 'H1'),
    satir('kredi-uat', '', 'H3'),
    satir('rapor-d', 'Test', 'T1'),
    satir('arsiv-X', 'Production', 'H4'),
    satir('   ', 'Production', 'H5'),
    { app: null, env: 'Production', host: 'H6' },
  ]);
  assert.equal(govde.totalRows, 7);
  assert.deepEqual(govde.nonStandard, [
    { app: 'arsiv-X', reason: 'Tanınmayan son ek: -X', hosts: ['H4'], envColumn: ['Production'] },
    {
      app: 'fatura-PROD',
      reason: 'Ortam sözcüğüyle biten ad: -PROD',
      hosts: ['H1', 'H2'],
      envColumn: ['Production', 'Test'],
    },
    { app: 'kredi-uat', reason: 'Ortam sözcüğüyle biten ad: -uat', hosts: ['H3'], envColumn: [] },
    { app: 'rapor-d', reason: 'Küçük harfli son ek', hosts: ['T1'], envColumn: ['Test'] },
  ]);
  // Ortam sozcugu tek harf kuralina takilmaz: ad PROD sayilir; -X matrise hic girmez.
  assert.deepEqual(
    govde.rows.map((r) => r.base),
    ['fatura-PROD', 'kredi-uat', 'rapor'],
  );
  assert.ok(!govde.rows.some((r) => r.base === 'arsiv'), 'ortami cozulemeyen ad matrise girdi');
});

test('AE4 ad ortami ile env sutunu celiskisi', async (t) => {
  const { govde } = await al2(t, [
    satir('odeme-T', 'Production', 'P2'),
    satir('odeme-T', 'Production', 'P1'),
    satir('odeme-D', 'Test', 'T1'),
    satir('odeme-Q', 'QA', 'Q1'),
    satir('odeme', 'Test', 'T9'),
    satir('cari-Q', 'Test', 'T5'),
  ]);
  assert.deepEqual(govde.conflicts, [
    { app: 'cari-Q', base: 'cari', nameEnv: 'QA', envColumn: 'Test', hosts: ['T5'] },
    { app: 'odeme', base: 'odeme', nameEnv: 'PROD', envColumn: 'Test', hosts: ['T9'] },
    {
      app: 'odeme-T',
      base: 'odeme',
      nameEnv: 'TEST',
      envColumn: 'Production',
      hosts: ['P1', 'P2'],
    },
  ]);
});

test('AE5 kapsam disi env degerleri celiski sayilmaz, raporlanir', async (t) => {
  const { govde } = await al2(t, [
    satir('odeme', 'Alpha', 'A1'),
    satir('cari', 'Alpha', 'A2'),
    satir('cari', 'Alpha', 'A3'),
    satir('borc-T', 'ODM', 'O1'),
    satir('kasa', 'Gelistirme', 'G1'),
  ]);
  assert.deepEqual(govde.conflicts, []);
  assert.deepEqual(govde.outOfScopeEnvColumns, [
    { envColumn: 'Alpha', appCount: 2, known: true },
    { envColumn: 'ODM', appCount: 1, known: true },
    { envColumn: 'Gelistirme', appCount: 1, known: false },
  ]);
});

test('AE6 kaynak secimi: was; yok, bilinmeyen ya da prototip adi mw', async (t) => {
  const { al, sorgular } = await sunucu(t, []);
  let r = await al('/app-envs?source=was');
  assert.equal(r.govde.source, 'was');
  assert.equal(r.govde.label, 'WAS uygulamalari');
  assert.match(sorgular.at(-1), /FROM dbo\.WASAppsInventory /);
  for (const yol of [
    '/app-envs',
    '/app-envs?source=',
    '/app-envs?source=xyz',
    '/app-envs?source=toString',
  ]) {
    r = await al(yol);
    assert.equal(r.status, 200, `${yol}: ${JSON.stringify(r.govde)}`);
    assert.equal(r.govde.source, 'mw', yol);
    assert.match(sorgular.at(-1), /FROM dbo\.MWAppsInventory /, yol);
  }
});

test('AE7 DB hatasi 500 ve ileti', async (t) => {
  let { al } = await sunucu(t, new Error('Envanter DB yok'));
  let r = await al('/app-envs?source=mw');
  assert.equal(r.status, 500);
  assert.deepEqual(r.govde, { ok: false, message: 'Envanter DB yok' });
  ({ al } = await sunucu(t, new Error('')));
  r = await al('/app-envs?source=mw');
  assert.deepEqual(r.govde, { ok: false, message: 'Uygulama ortam verisi alınamadı.' });
});
