// server/audit/__tests__/web-app-hub.test.cjs — Denetim > Web-App: Server Hub + AJP (2026-10-13).
//
// Kullanici: "Uygulama Retirement'ta web host iliskisi icin yaptigimiz gelistirmeyi Denetim > Web-App
// sekmesinde de yapabilir miyiz?" Web-App artik retirement kesfiyle AYNI zenginlestirmeyi kullanir:
// sertifika envanteri + Server Hub vhost taramasi + AJP/proxy hedefi = JVM portu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const MSSQL = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
let veri = {};
const sahte = {
  sql: {},
  query: async (q) => {
    const t = String(q).replace(/\s+/g, ' ');
    if (t.includes('FROM dbo.MWAppsInventory')) return { recordset: veri.apps || [] };
    if (t.includes('FROM dbo.BMW_Certificates_Inventory')) return { recordset: veri.certs || [] };
    if (t.includes('sys.columns')) return { recordset: [{ name: 'host' }, { name: 'jvm' }, { name: 'ports' }, { name: 'cfg_ports' }] };
    if (t.includes('FROM dbo.Server_Hub_Vhosts')) {
      if (veri.hubHata) throw new Error('tablo yok');
      return { recordset: veri.vhosts || [] };
    }
    if (t.includes('FROM dbo.Server_Hub_Jvms')) return { recordset: veri.jvms || [] };
    if (t.includes('FROM dbo.Server_Hub_Ips')) return { recordset: veri.ips || [] };
    return { recordset: [] };
  },
};
require.cache[Module._resolveFilename(MSSQL, module)] = { id: MSSQL, filename: MSSQL, loaded: true, exports: sahte };

const { registerWebApp } = require('../web-app.cjs');

async function getir() {
  const app = express();
  const r = express.Router();
  registerWebApp(r);
  app.use(r);
  const s = app.listen(0);
  await new Promise((ok) => s.once('listening', ok));
  try {
    return await fetch(`http://127.0.0.1:${s.address().port}/web-app?source=mw`).then((x) => x.json());
  } finally {
    s.close();
  }
}

test('WH1 3-tier GOJBAB03: sertifikada yok, Server Hub GOJBWP03 vhostu bulunur ve eslesmis sayilir', async () => {
  veri = {
    apps: [{ app: 'gfysvc-d', host: 'GOJBAB03', env: 'DEV', domain: 'gtdmz.com.tr' }],
    vhosts: [{ host: 'GOJBWP03', server_name: 'gfysvc-d.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/x/a.conf', product: 'IHS', proxy_targets: '' }],
  };
  const j = await getir();
  assert.equal(j.ok, true);
  const r = j.rows[0];
  assert.equal(r.matched, true, r.how);
  assert.equal(r.web[0].host, 'GOJBWP03');
  assert.match(r.how, /Server Hub/);
  assert.equal(j.matchedTotal, 1);
});

test('WH2 ad tutmuyor ama vhost JkMount hedefi uygulamanin JVM portu: AJP ile bulunur', async () => {
  veri = {
    apps: [{ app: 'onur', host: 'GBCJAP01', env: 'PROD', domain: 'fw.garanti.com.tr' }],
    vhosts: [{ host: 'GBCJAP01', server_name: 'cansu.fw.garanti.com.tr', aliases: '', listen: '*:80', conf_file: '/c.conf', product: 'IHS', proxy_targets: 'localhost:8159' }],
    jvms: [{ host: 'GBCJAP01', jvm: 'onur', ports: '', cfg_ports: '8159,8230' }],
  };
  const j = await getir();
  const r = j.rows[0];
  assert.equal(r.matched, true, r.how);
  assert.equal(r.web[0].serverName, 'cansu.fw.garanti.com.tr');
  assert.equal(r.web[0].kaynak, 'ajp');
  assert.ok(j.matchSummary.some((m) => m.how === 'AJP/proxy hedefi = JVM portu'), JSON.stringify(j.matchSummary));
});

test('WH3 Server Hub okunamazsa sertifika eslemesi calisir ve sebep doner (olculemedi != yok)', async () => {
  veri = {
    apps: [{ app: 'crm', host: 'GBCRAP01', env: 'PROD', domain: 'gtdmz.com.tr' }],
    certs: [{ host: 'GBCRWP01', ip: '10.0.0.1', port: '443', server_name: 'crm.gtdmz.com.tr', conf_file: '/c', product: 'IHS', env: 'PROD' }],
    hubHata: true,
  };
  const j = await getir();
  assert.equal(j.rows[0].matched, true);
  assert.equal(j.rows[0].web[0].host, 'GBCRWP01');
  assert.match(String(j.hubHata), /vhost/);
});

// ── DNS -> LB VIP (2026-10-13): site bazli cozum ─────────────────────────────────────
const { dnsCozumle } = require('../web-app.cjs');

test('WH4 bolge + site: gtdmz/fw icin kullanicinin verdigi DNS sunuculari; Ankara VIP Pendik ile karismaz; onbellek', async () => {
  const { DNS_BOLGELER, dnsBolgesi } = require('../web-app.cjs');
  assert.deepEqual(DNS_BOLGELER.gtdmz, { Pendik: ['10.230.238.22'], Ankara: ['10.236.238.22'] });
  assert.deepEqual(DNS_BOLGELER.fw, { Pendik: ['10.230.238.1'], Ankara: ['10.236.238.1'] });
  assert.equal(dnsBolgesi('gtdmz.com.tr'), 'gtdmz');
  assert.equal(dnsBolgesi('fw.garanti.com.tr'), 'fw');
  assert.equal(dnsBolgesi('garantibbva.com.tr'), null);
  const cagri = [];
  const cozucu = async (ad, sunucular) => { cagri.push(`${ad}@${sunucular.join(',')}`); return { ips: [`VIP-${sunucular[0]}`] }; };
  const r = await dnsCozumle([{ ad: 'App.GTDMZ.com.tr', bolge: 'gtdmz' }, { ad: 'x.fw.garanti.com.tr', bolge: 'fw' }], { cozucu });
  assert.deepEqual(r.sonuc['gtdmz|app.gtdmz.com.tr'].Pendik.ips, ['VIP-10.230.238.22']);
  assert.deepEqual(r.sonuc['gtdmz|app.gtdmz.com.tr'].Ankara.ips, ['VIP-10.236.238.22']);
  assert.equal(r.sonuc['gtdmz|app.gtdmz.com.tr'].Ankara.dnsSunucusu, '10.236.238.22');
  assert.deepEqual(r.sonuc['fw|x.fw.garanti.com.tr'].Pendik.ips, ['VIP-10.230.238.1']);
  assert.deepEqual(r.sonuc['fw|x.fw.garanti.com.tr'].Ankara.ips, ['VIP-10.236.238.1']);
  assert.equal(cagri.length, 4);
  await dnsCozumle([{ ad: 'app.gtdmz.com.tr', bolge: 'gtdmz' }], { cozucu });
  assert.equal(cagri.length, 4, 'onbellek calismiyor');
});

test('WH5 bolge bilinmiyorsa Portal cozucusu (varsayilan); site DNS ulasilamazsa diger siteye DUSULMEZ; joker/IP cozulmez', async () => {
  const cagri = [];
  const cozucu = async (ad, s) => {
    cagri.push([ad, s]);
    if (s && s[0] === '10.236.238.1') return { hata: 'zaman aşımı' };
    return { ips: ['1.2.3.4'] };
  };
  const r = await dnsCozumle([{ ad: 'y.example.com', bolge: null }, { ad: '*.example.com', bolge: null }, { ad: '10.1.2.3', bolge: null }, { ad: 'z.fw.garanti.com.tr', bolge: 'fw' }], { cozucu });
  assert.deepEqual(r.sonuc['-|y.example.com'].varsayilan.ips, ['1.2.3.4']);
  assert.match(r.sonuc['-|*.example.com'].varsayilan.hata, /joker/);
  assert.deepEqual(r.sonuc['-|10.1.2.3'].varsayilan.ips, ['10.1.2.3']);
  assert.equal(r.sonuc['fw|z.fw.garanti.com.tr'].Ankara.hata, 'zaman aşımı', 'Ankara hatasi Pendik cevabiyla ortulmemeli');
  assert.deepEqual(r.sonuc['fw|z.fw.garanti.com.tr'].Pendik.ips, ['1.2.3.4']);
  assert.ok(cagri.some(([a, s]) => a === 'y.example.com' && s === null), 'bolgesiz ad Portal cozucusuna gitmedi');
});

test('WH6 web girdileri sitesini tasir (Ankara 7 harf, Pendik 6 harf)', async () => {
  veri = {
    apps: [{ app: 'crm', host: 'GBCRAP01', env: 'PROD', domain: 'gtdmz.com.tr' }, { app: 'crm', host: 'GBCRAAP01', env: 'PROD', domain: 'gtdmz.com.tr' }],
    certs: [
      { host: 'GBCRWP01', ip: '10.0.0.1', port: '443', server_name: 'crm.gtdmz.com.tr', conf_file: '/c', product: 'IHS', env: 'PROD' },
      { host: 'GBCRWAP01', ip: '20.0.0.1', port: '443', server_name: 'crm.gtdmz.com.tr', conf_file: '/c', product: 'IHS', env: 'PROD' },
    ],
  };
  const j = await getir();
  const site = Object.fromEntries(j.rows.flatMap((r) => r.web.map((w) => [w.host, w.site])));
  assert.deepEqual(site, { GBCRWP01: 'Pendik', GBCRWAP01: 'Ankara' });
  assert.ok(j.rows.every((r) => r.dnsBolge === 'gtdmz'), 'satir DNS bolgesini tasimiyor');
});
