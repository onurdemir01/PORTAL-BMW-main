// server/audit/__tests__/envanter-jboss78.test.cjs - Envanter metrikleri: JBoss 7 / 8 ayri kirilim (2026-11-12).
//
// Kullanici: middleware_inventory artik dbo.Inventory'ye jboss7_version / jboss8_version yaziyor
// (jboss_version degismedi); "metrik kirilimlarini ekle".
//   EJ1 kolonlar varsa iki yeni kirilim + iki urun karti ("JBoss 7", "JBoss 8"); eski JBoss kirilimi durur
//   EJ2 kolonlar YOKSA sorgu bozulmaz: yeni kirilimlar SQL'e girmez, eksikBoyutlar listede
//   EJ3 kolon listesi okunamazsa da sayfa calisir (istege bagli boyutlar cikar)
//   EJ4 pivot: olmayan kolon istenirse SQL'e girmez (varsayilana duser)
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const durum = { kolonlar: ['host', 'jboss_version', 'jboss7_version', 'jboss8_version'], kolonHata: false, sorgular: [] };
sahte(require.resolve('../../inventory/mssql.cjs'), {
  sql: { NVarChar: () => 'nv' },
  query: async (text) => {
    durum.sorgular.push(text);
    if (/sys\.columns/.test(text)) {
      if (durum.kolonHata) throw new Error('izin yok');
      return { recordset: durum.kolonlar.map((name) => ({ name })) };
    }
    if (/UNION ALL/.test(text) || /SELECT '/.test(text)) {
      const rs = [];
      if (text.includes("'jboss7_version'")) rs.push({ dim: 'jboss7_version', val: '7.3.5', n: 1, hosts: 1 });
      if (text.includes("'jboss8_version'")) rs.push({ dim: 'jboss8_version', val: '8.1.6.1', n: 1, hosts: 1 });
      rs.push({ dim: 'jboss_version', val: '7.3.5 8.1.6.1', n: 1, hosts: 1 });
      return { recordset: rs };
    }
    if (/COUNT\(\*\) AS rows_total/.test(text)) return { recordset: [{ rows_total: 1, host_total: 1 }] };
    return { recordset: [] };
  },
});

const em = require('../envanter-metrics.cjs');

async function getir(yol) {
  const app = express();
  const r = express.Router();
  em.registerEnvanterMetrics(r);
  app.use('/api/denetim', r);
  const srv = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/denetim${yol}`);
    return await res.json();
  } finally {
    srv.close();
  }
}

beforeEach(() => {
  em._kolonOnbellek.clear();
  durum.sorgular = [];
  durum.kolonHata = false;
  durum.kolonlar = ['host', 'jboss_version', 'jboss7_version', 'jboss8_version'];
});

test('EJ1 kolonlar varsa JBoss 7 / 8 kirilimi ve urun kartlari; eski JBoss kirilimi durur', async () => {
  const b = await getir('/envanter/summary?source=hosts');
  assert.equal(b.ok, true);
  const anahtarlar = b.dims.map((d) => d.key);
  for (const k of ['jboss_version', 'jboss7_version', 'jboss8_version']) assert.ok(anahtarlar.includes(k), k);
  const urun = Object.fromEntries(b.products.map((p) => [p.label, p.installed]));
  assert.equal(urun['JBoss 7'], 1);
  assert.equal(urun['JBoss 8'], 1);
  assert.equal(urun.JBoss, 1);
  assert.deepEqual(b.eksikBoyutlar, []);
});

test('EJ2 kolonlar YOKSA sorgu bozulmaz; yeni kirilimlar SQL e girmez, eksik olarak bildirilir', async () => {
  durum.kolonlar = ['host', 'jboss_version'];
  const b = await getir('/envanter/summary?source=hosts');
  assert.equal(b.ok, true);
  assert.ok(!durum.sorgular.some((s) => /jboss7_version|jboss8_version/.test(s) && !/sys\.columns/.test(s)), 'olmayan kolon SQL e girdi');
  assert.deepEqual(b.eksikBoyutlar, ['JBoss 7 sürümü', 'JBoss 8 sürümü']);
  assert.ok(b.dims.some((d) => d.key === 'jboss_version'));
});

test('EJ3 kolon listesi okunamazsa sayfa yine calisir (istege bagli boyutlar cikar)', async () => {
  durum.kolonHata = true;
  const b = await getir('/envanter/summary?source=hosts');
  assert.equal(b.ok, true);
  assert.equal(b.eksikBoyutlar.length, 2);
});

test('EJ4 pivot: olmayan kolon istenirse SQL e girmez', async () => {
  durum.kolonlar = ['host', 'jboss_version'];
  await getir('/envanter/pivot?source=hosts&x=domain&y=jboss7_version');
  const pv = durum.sorgular.filter((s) => !/sys\.columns/.test(s));
  assert.ok(pv.length > 0);
  assert.ok(!pv.some((s) => /jboss7_version/.test(s)), 'olmayan kolon pivot SQL ine girdi');
});
