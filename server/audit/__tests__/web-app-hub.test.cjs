// server/audit/__tests__/web-app-hub.test.cjs — Denetim > Web-App: Server Hub + AJP (2026-10-13).
//
// Kullanici: "Uygulama Retirement'ta web host iliskisi icin yaptigimiz gelistirmeyi Denetim > Web-App
// sekmesinde de yapabilir miyiz?" Web-App artik retirement kesfiyle AYNI zenginlestirmeyi kullanir:
// sertifika envanteri + Server Hub vhost taramasi + AJP/proxy hedefi = JVM portu.
'use strict';

// Hesap onbellegi (WEBAPP_ONBELLEK_MS) bu dosyada KAPALI: her test kendi verisiyle yeniden hesaplar.
process.env.WEBAPP_ONBELLEK_MS = '0';
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

// ── 2026-10-16: topoloji kanittan, DNS bolgesi vhost basina, satir basina aciklama ─────────────────
const cert = (host, sn) => ({ host, ip: '10.0.0.9', port: '443', server_name: sn, conf_file: '/c', product: 'IHS', env: 'PROD' });

test('WH7 domain BOS: topoloji eslesme kanitindan (ayri host 3-tier, ayni host 2-tier, aday hostta vhost 3-tier, kanit yok bilinmiyor)', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'GBCRAP01', env: 'PROD', domain: '' },
      { app: 'ikili', host: 'GBIKAP01', env: 'PROD', domain: null },
      { app: 'adsiz', host: 'GBADAP01', env: 'PROD', domain: '' },
      { app: 'yok', host: 'GBYKAP01', env: 'PROD', domain: '' },
    ],
    certs: [cert('GBCRWP01', 'crm.gtdmz.com.tr'), cert('GBIKAP01', 'ikili.fw.garanti.com.tr'), cert('GBADWP01', 'baska.gtdmz.com.tr')],
  };
  const j = await getir();
  const by = Object.fromEntries(j.rows.map((r) => [r.app, r]));
  assert.deepEqual([by.crm.tier, by.crm.tierKaynak], ['3-tier', 'eşleşme']);
  assert.deepEqual([by.ikili.tier, by.ikili.tierKaynak], ['2-tier', 'eşleşme']);
  assert.deepEqual([by.adsiz.tier, by.adsiz.tierKaynak], ['3-tier', 'aday web sunucusu']);
  assert.deepEqual([by.yok.tier, by.yok.tierKaynak], ['bilinmiyor', '']);
  const tier = Object.fromEntries(j.tierSummary.map((t) => [t.tier, t.count]));
  assert.deepEqual(tier, { '3-tier': 2, '2-tier': 1, bilinmiyor: 1 });
});

test('WH8 DNS bolgesi vhost basina: server_name alani kazanir, yoksa uygulama domain i', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'GBCRAP01', env: 'PROD', domain: '' },
      { app: 'ters', host: 'GBTRAP01', env: 'PROD', domain: 'fw.garanti.com.tr' },
      { app: 'dis', host: 'GBDSAP01', env: 'PROD', domain: 'gtdmz.com.tr' },
    ],
    certs: [cert('GBCRWP01', 'crm.gtdmz.com.tr'), cert('GBTRAP01', 'ters.gtdmz.com.tr'), cert('GBDSWP01', 'dis.example.com')],
  };
  const j = await getir();
  const b = Object.fromEntries(j.rows.map((r) => [r.app, r.web.map((w) => w.dnsBolge)]));
  assert.deepEqual(b.crm, ['gtdmz'], 'domain bos ama server_name gtdmz: bolge null kaliyordu (Ankara Ankara DNS ine sorulmuyordu)');
  assert.deepEqual(b.ters, ['gtdmz'], 'adin kendi alani uygulama domain inden once gelmeli');
  assert.deepEqual(b.dis, ['gtdmz'], 'alansiz ad uygulama domain ine dusmeli');
  assert.equal(j.rows.find((r) => r.app === 'crm').dnsBolge, null, 'satir bolgesi (eski alan) domain den kalir');
});

test('WH9 satir basina aciklama: Ankara 7 harf kurali, sertifika + mod_cluster kaynagi, topoloji nedeni; eslesmeyende sebep', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'DACRAAB01', env: 'PROD', domain: 'gtdmz.com.tr' },
      { app: 'yalniz', host: 'GBYLAP01', env: 'PROD', domain: '' },
    ],
    certs: [cert('DACRWAP01', 'crm.gtdmz.com.tr'), cert('GBYLWP01', 'baska.gtdmz.com.tr'), cert('GBYLWP01', 'diger.gtdmz.com.tr')],
    vhosts: [{ host: 'DACRWAB02', server_name: 'x.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/m.conf', product: 'RH Apache', proxy_targets: 'crm' }],
  };
  const j = await getir();
  const crm = j.rows.find((r) => r.app === 'crm');
  assert.ok(Array.isArray(crm.nasil) && crm.nasil.length >= 3, JSON.stringify(crm.nasil));
  assert.equal(crm.nasil[0], 'Topoloji 3-tier: envanterdeki domain gtdmz.com.tr');
  assert.ok(crm.nasil.some((s) => s.startsWith('DACRAAB01 → DACRWAP01: 5. harf A→W + son harf P (7 harf = Ankara)') && s.includes('server_name\'de "crm" geçiyor (tam ad; sertifika envanteri)')), JSON.stringify(crm.nasil));
  assert.ok(crm.nasil.some((s) => s.startsWith('DACRWAB02: ad kuralı dışında') && s.includes('mod_cluster balancer adı = uygulama adı (balancer://crm)')), JSON.stringify(crm.nasil));
  const yal = j.rows.find((r) => r.app === 'yalniz');
  assert.equal(yal.matched, false);
  assert.ok(yal.nasil.some((s) => s.includes('GBYLAP01 → GBYLWP01: 5. harf A→W') && s.includes('2 vhost var ama hiçbirinin server_name\'i "yalniz" içermiyor')), JSON.stringify(yal.nasil));
});
