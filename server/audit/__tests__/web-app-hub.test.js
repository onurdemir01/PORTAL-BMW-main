// server/audit/__tests__/web-app-hub.test.js — Denetim > Web-App: Server Hub + AJP (2026-10-13).
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
    if (t.includes('sys.columns'))
      return {
        recordset: [{ name: 'host' }, { name: 'jvm' }, { name: 'ports' }, { name: 'cfg_ports' }],
      };
    if (t.includes('FROM dbo.Server_Hub_Vhosts')) {
      if (veri.hubHata) throw new Error('tablo yok');
      return { recordset: veri.vhosts || [] };
    }
    if (t.includes('FROM dbo.Server_Hub_Jvms')) return { recordset: veri.jvms || [] };
    if (t.includes('FROM dbo.Server_Hub_Ips')) return { recordset: veri.ips || [] };
    return { recordset: [] };
  },
};
require.cache[Module._resolveFilename(MSSQL, module)] = {
  id: MSSQL,
  filename: MSSQL,
  loaded: true,
  exports: sahte,
};

const { registerWebApp } = require('../web-app.cjs');

async function getir() {
  const app = express();
  app.disable('x-powered-by');
  const r = express.Router();
  registerWebApp(r);
  app.use(r);
  const s = app.listen(0);
  await new Promise((ok) => s.once('listening', ok));
  try {
    return await fetch(`http://127.0.0.1:${s.address().port}/web-app?source=mw`).then((x) =>
      x.json(),
    );
  } finally {
    s.close();
  }
}

test('WH1 3-tier OPJBAB03: sertifikada yok, Server Hub OPJBWP03 vhostu bulunur ve eslesmis sayilir', async () => {
  veri = {
    apps: [{ app: 'gfysvc-d', host: 'OPJBAB03', env: 'DEV', domain: 'odmz.invalid' }],
    vhosts: [
      {
        host: 'OPJBWP03',
        server_name: 'gfysvc-d.odmz.invalid',
        aliases: '',
        listen: '*:443',
        conf_file: '/x/a.conf',
        product: 'IHS',
        proxy_targets: '',
      },
    ],
  };
  const j = await getir();
  assert.equal(j.ok, true);
  const r = j.rows[0];
  assert.equal(r.matched, true, r.how);
  assert.equal(r.web[0].host, 'OPJBWP03');
  assert.match(r.how, /Server Hub/);
  assert.equal(j.matchedTotal, 1);
});

test('WH2 ad tutmuyor ama vhost JkMount hedefi uygulamanin JVM portu: AJP ile bulunur', async () => {
  veri = {
    apps: [{ app: 'onur', host: 'ORCJAP01', env: 'PROD', domain: 'fw.sirket.invalid' }],
    vhosts: [
      {
        host: 'ORCJAP01',
        server_name: 'cansu.fw.sirket.invalid',
        aliases: '',
        listen: '*:80',
        conf_file: '/c.conf',
        product: 'IHS',
        proxy_targets: 'localhost:8159',
      },
    ],
    jvms: [{ host: 'ORCJAP01', jvm: 'onur', ports: '', cfg_ports: '8159,8230' }],
  };
  const j = await getir();
  const r = j.rows[0];
  assert.equal(r.matched, true, r.how);
  assert.equal(r.web[0].serverName, 'cansu.fw.sirket.invalid');
  assert.equal(r.web[0].kaynak, 'ajp');
  assert.ok(
    j.matchSummary.some((m) => m.how === 'AJP/proxy hedefi = JVM portu'),
    JSON.stringify(j.matchSummary),
  );
});

test('WH3 Server Hub okunamazsa sertifika eslemesi calisir ve sebep doner (olculemedi != yok)', async () => {
  veri = {
    apps: [{ app: 'crm', host: 'ORCRAP01', env: 'PROD', domain: 'odmz.invalid' }],
    certs: [
      {
        host: 'ORCRWP01',
        ip: '10.0.0.1',
        port: '443',
        server_name: 'crm.odmz.invalid',
        conf_file: '/c',
        product: 'IHS',
        env: 'PROD',
      },
    ],
    hubHata: true,
  };
  const j = await getir();
  assert.equal(j.rows[0].matched, true);
  assert.equal(j.rows[0].web[0].host, 'ORCRWP01');
  assert.match(String(j.hubHata), /vhost/);
});

// ── DNS -> LB VIP (2026-10-13): site bazli cozum ─────────────────────────────────────
// DNS sunuculari ayardan (WEB_APP_DNS_SUNUCULARI; gercek adresler repoda degil). Testte belge araligi.
process.env.WEB_APP_DNS_SUNUCULARI = JSON.stringify({
  dmz: { Pendik: ['192.0.2.22'], Ankara: ['198.51.100.22'] },
  fw: { Pendik: ['192.0.2.1'], Ankara: ['198.51.100.1'] },
});
const { dnsCozumle } = require('../web-app.cjs');

test('WH4 bolge + site: dmz/fw icin kullanicinin verdigi DNS sunuculari; Ankara VIP Pendik ile karismaz; onbellek', async () => {
  const { dnsBolgeleri, dnsBolgesi } = require('../web-app.cjs');
  assert.deepEqual(dnsBolgeleri().dmz, { Pendik: ['192.0.2.22'], Ankara: ['198.51.100.22'] });
  assert.deepEqual(dnsBolgeleri().fw, { Pendik: ['192.0.2.1'], Ankara: ['198.51.100.1'] });
  assert.equal(dnsBolgesi('odmz.invalid'), 'dmz');
  assert.equal(dnsBolgesi('fw.sirket.invalid'), 'fw');
  assert.equal(dnsBolgesi('ornekbanka.invalid'), null);
  const cagri = [];
  const cozucu = async (ad, sunucular) => {
    cagri.push(`${ad}@${sunucular.join(',')}`);
    return { ips: [`VIP-${sunucular[0]}`] };
  };
  const r = await dnsCozumle(
    [
      { ad: 'App.odmz.invalid', bolge: 'dmz' },
      { ad: 'x.fw.sirket.invalid', bolge: 'fw' },
    ],
    { cozucu },
  );
  assert.deepEqual(r.sonuc['dmz|app.odmz.invalid'].Pendik.ips, ['VIP-192.0.2.22']);
  assert.deepEqual(r.sonuc['dmz|app.odmz.invalid'].Ankara.ips, ['VIP-198.51.100.22']);
  assert.equal(r.sonuc['dmz|app.odmz.invalid'].Ankara.dnsSunucusu, '198.51.100.22');
  assert.deepEqual(r.sonuc['fw|x.fw.sirket.invalid'].Pendik.ips, ['VIP-192.0.2.1']);
  assert.deepEqual(r.sonuc['fw|x.fw.sirket.invalid'].Ankara.ips, ['VIP-198.51.100.1']);
  assert.equal(cagri.length, 4);
  await dnsCozumle([{ ad: 'app.odmz.invalid', bolge: 'dmz' }], { cozucu });
  assert.equal(cagri.length, 4, 'onbellek calismiyor');
});

test('WH5 bolge bilinmiyorsa Portal cozucusu (varsayilan); site DNS ulasilamazsa diger siteye DUSULMEZ; joker/IP cozulmez', async () => {
  const cagri = [];
  const cozucu = async (ad, s) => {
    cagri.push([ad, s]);
    if (s && s[0] === '198.51.100.1') return { hata: 'zaman aşımı' };
    return { ips: ['1.2.3.4'] };
  };
  const r = await dnsCozumle(
    [
      { ad: 'y.example.com', bolge: null },
      { ad: '*.example.com', bolge: null },
      { ad: '10.1.2.3', bolge: null },
      { ad: 'z.fw.sirket.invalid', bolge: 'fw' },
    ],
    { cozucu },
  );
  assert.deepEqual(r.sonuc['-|y.example.com'].varsayilan.ips, ['1.2.3.4']);
  assert.match(r.sonuc['-|*.example.com'].varsayilan.hata, /joker/);
  assert.deepEqual(r.sonuc['-|10.1.2.3'].varsayilan.ips, ['10.1.2.3']);
  assert.equal(
    r.sonuc['fw|z.fw.sirket.invalid'].Ankara.hata,
    'zaman aşımı',
    'Ankara hatasi Pendik cevabiyla ortulmemeli',
  );
  assert.deepEqual(r.sonuc['fw|z.fw.sirket.invalid'].Pendik.ips, ['1.2.3.4']);
  assert.ok(
    cagri.some(([a, s]) => a === 'y.example.com' && s === null),
    'bolgesiz ad Portal cozucusuna gitmedi',
  );
});

test('WH6 web girdileri sitesini tasir (Ankara 7 harf, Pendik 6 harf)', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'ORCRAP01', env: 'PROD', domain: 'odmz.invalid' },
      { app: 'crm', host: 'ORCRAAP01', env: 'PROD', domain: 'odmz.invalid' },
    ],
    certs: [
      {
        host: 'ORCRWP01',
        ip: '10.0.0.1',
        port: '443',
        server_name: 'crm.odmz.invalid',
        conf_file: '/c',
        product: 'IHS',
        env: 'PROD',
      },
      {
        host: 'ORCRWAP01',
        ip: '20.0.0.1',
        port: '443',
        server_name: 'crm.odmz.invalid',
        conf_file: '/c',
        product: 'IHS',
        env: 'PROD',
      },
    ],
  };
  const j = await getir();
  const site = Object.fromEntries(j.rows.flatMap((r) => r.web.map((w) => [w.host, w.site])));
  assert.deepEqual(site, { ORCRWP01: 'Pendik', ORCRWAP01: 'Ankara' });
  assert.ok(
    j.rows.every((r) => r.dnsBolge === 'dmz'),
    'satir DNS bolgesini tasimiyor',
  );
});

// ── 2026-10-16: topoloji kanittan, DNS bolgesi vhost basina, satir basina aciklama ─────────────────
const cert = (host, sn) => ({
  host,
  ip: '10.0.0.9',
  port: '443',
  server_name: sn,
  conf_file: '/c',
  product: 'IHS',
  env: 'PROD',
});

test('WH7 domain BOS: topoloji eslesme kanitindan (ayri host 3-tier, ayni host 2-tier, aday hostta vhost 3-tier, kanit yok bilinmiyor)', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'ORCRAP01', env: 'PROD', domain: '' },
      { app: 'ikili', host: 'ORIKAP01', env: 'PROD', domain: null },
      { app: 'adsiz', host: 'ORADAP01', env: 'PROD', domain: '' },
      { app: 'yok', host: 'ORYKAP01', env: 'PROD', domain: '' },
    ],
    certs: [
      cert('ORCRWP01', 'crm.odmz.invalid'),
      cert('ORIKAP01', 'ikili.fw.sirket.invalid'),
      cert('ORADWP01', 'baska.odmz.invalid'),
    ],
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
      { app: 'crm', host: 'ORCRAP01', env: 'PROD', domain: '' },
      { app: 'ters', host: 'ORTRAP01', env: 'PROD', domain: 'fw.sirket.invalid' },
      { app: 'dis', host: 'ORDSAP01', env: 'PROD', domain: 'odmz.invalid' },
    ],
    certs: [
      cert('ORCRWP01', 'crm.odmz.invalid'),
      cert('ORTRAP01', 'ters.odmz.invalid'),
      cert('ORDSWP01', 'dis.example.com'),
    ],
  };
  const j = await getir();
  const b = Object.fromEntries(j.rows.map((r) => [r.app, r.web.map((w) => w.dnsBolge)]));
  assert.deepEqual(
    b.crm,
    ['dmz'],
    'domain bos ama server_name dmz: bolge null kaliyordu (Ankara Ankara DNS ine sorulmuyordu)',
  );
  assert.deepEqual(b.ters, ['dmz'], 'adin kendi alani uygulama domain inden once gelmeli');
  assert.deepEqual(b.dis, ['dmz'], 'alansiz ad uygulama domain ine dusmeli');
  assert.equal(
    j.rows.find((r) => r.app === 'crm').dnsBolge,
    null,
    'satir bolgesi (eski alan) domain den kalir',
  );
});

test('WH9 satir basina aciklama: Ankara 7 harf kurali, sertifika + mod_cluster kaynagi, topoloji nedeni; eslesmeyende sebep', async () => {
  veri = {
    apps: [
      { app: 'crm', host: 'ODCRAAB01', env: 'PROD', domain: 'odmz.invalid' },
      { app: 'yalniz', host: 'ORYLAP01', env: 'PROD', domain: '' },
    ],
    certs: [
      cert('ODCRWAP01', 'crm.odmz.invalid'),
      cert('ORYLWP01', 'baska.odmz.invalid'),
      cert('ORYLWP01', 'diger.odmz.invalid'),
    ],
    vhosts: [
      {
        host: 'ODCRWAB02',
        server_name: 'x.odmz.invalid',
        aliases: '',
        listen: '*:443',
        conf_file: '/m.conf',
        product: 'RH Apache',
        proxy_targets: 'crm',
      },
    ],
  };
  const j = await getir();
  const crm = j.rows.find((r) => r.app === 'crm');
  assert.ok(Array.isArray(crm.nasil) && crm.nasil.length >= 3, JSON.stringify(crm.nasil));
  assert.equal(crm.nasil[0], 'Topoloji 3-tier: envanterdeki domain odmz.invalid');
  assert.ok(
    crm.nasil.some(
      (s) =>
        s.startsWith('ODCRAAB01 → ODCRWAP01: 5. harf A→W + son harf P (7 harf = Ankara)') &&
        s.includes('server_name\'de "crm" geçiyor (tam ad; sertifika envanteri)'),
    ),
    JSON.stringify(crm.nasil),
  );
  assert.ok(
    crm.nasil.some(
      (s) =>
        s.startsWith('ODCRWAB02: ad kuralı dışında') &&
        s.includes('mod_cluster balancer adı = uygulama adı (balancer://crm)'),
    ),
    JSON.stringify(crm.nasil),
  );
  const yal = j.rows.find((r) => r.app === 'yalniz');
  assert.equal(yal.matched, false);
  assert.ok(
    yal.nasil.some(
      (s) =>
        s.includes('ORYLAP01 → ORYLWP01: 5. harf A→W') &&
        s.includes('2 vhost var ama hiçbirinin server_name\'i "yalniz" içermiyor'),
    ),
    JSON.stringify(yal.nasil),
  );
});
