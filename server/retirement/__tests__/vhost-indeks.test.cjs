// server/retirement/__tests__/vhost-indeks.test.cjs — aday vhost indeksi (2026-10-23).
//
// Kullanici: "denetim -> web-app envanteri vb. sayfalar cok gec yukleniyor". ajpWeb / mcWeb her uygulama
// satiri icin filonun TUM vhost'larini tariyordu (uygulama x vhost; sentetik 5000 x 20000 = 25,6 sn, olay
// dongusu kilitli). Indeks yalniz aday secer; esleme kurali degismez.
//   VI1 ESDEGERLIK: rastgele (tohumlu) filoda her uygulama icin ajpWeb / mcWeb aday kumesiyle ve tum
//       listeyle BIREBIR ayni (sira dahil) - IP hedefi (tek / iki sahip), localhost, '~DYNAMIC', cok hedefli
//       vhost, ad varyantli balancer, JBoss 7 / 8 / surumsuz, WAS (mod_cluster kapali)
//   VI2 KARMASIKLIK: 300 uygulama x 3000 vhost'ta vhost alanlari uygulama x vhost kez degil, ~vhost kez
//       okunur (indeks istek basina bir kez kurulur ve paylasilir)
//   VI3 webZenginlestir sonucu (kaynak etiketleri dahil) aday kumesiyle tum liste ile ayni
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ajpWeb, mcWeb, adayVhostlar, webZenginlestir, ipSahipleri } = require('../discover.cjs');

function rastgele(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function filo(tohum, nApp, nVhost) {
  const r = rastgele(tohum);
  const sec = (l) => l[Math.floor(r() * l.length)];
  const hostlar = Array.from({ length: 40 }, (_, i) => (i % 2 ? `GBJBOP${10 + i}` : `GBJBOAP${10 + i}`));
  const webHostlar = hostlar.map((h) => h.replace(/^(GBJB)O/, '$1W'));
  const adlar = Array.from({ length: Math.max(5, Math.floor(nApp / 3)) }, (_, i) => (i % 5 === 0 ? `app_${i}_svc` : `app${i}`));
  const ips = [];
  hostlar.forEach((h, i) => ips.push({ host: h, ip: `10.1.0.${i}` }));
  ips.push({ host: hostlar[0], ip: '10.9.9.9' }, { host: hostlar[1], ip: '10.9.9.9' });
  const ipMap = ipSahipleri(ips);
  const portlar = ['8009', '8109', '8209', '8309'];
  const vhostRows = Array.from({ length: nVhost }, (_, i) => {
    const vh = r() < 0.5 ? sec(hostlar) : sec(webHostlar);
    const hedefler = [];
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const tur = r();
      if (tur < 0.35) hedefler.push(`${sec(hostlar).toLowerCase()}.fw.garanti.com.tr:${sec(portlar)}`);
      else if (tur < 0.5) hedefler.push(`localhost:${sec(portlar)}`);
      else if (tur < 0.62) hedefler.push(`10.1.0.${Math.floor(r() * 40)}:${sec(portlar)}`);
      else if (tur < 0.67) hedefler.push(`10.9.9.9:${sec(portlar)}`);
      else if (tur < 0.75) hedefler.push('~DYNAMIC');
      else if (tur < 0.9) { const ad = sec(adlar); hedefler.push(r() < 0.5 ? ad.replace(/_/g, '-') : ad.toUpperCase()); }
      else hedefler.push(` ${sec(adlar)} `);
    }
    return { host: vh, server_name: `v${i}.fw.garanti.com.tr`, aliases: '', listen: `*:${r() < 0.5 ? 80 : 443}`, conf_file: `/c/${i}.conf`, product: r() < 0.5 ? 'IHS' : 'RHA', proxy_targets: hedefler.join(',') };
  });
  const apps = Array.from({ length: nApp }, (_, i) => ({
    app: sec(adlar),
    host: sec(hostlar),
    gen: sec([7, 8, null]),
    jvm: r() < 0.85 ? { cfg_ports: [sec(portlar), sec(portlar)].join(','), ports: r() < 0.3 ? sec(portlar) : '' } : null,
    modCluster: r() < 0.8,
  }));
  return { vhostRows, ipMap, apps };
}

test('VI1 esdegerlik: aday kumesiyle ajpWeb / mcWeb tum listeyle birebir ayni (sira dahil)', () => {
  let eslesen = 0;
  for (const tohum of [1, 7, 2026, 1023, 99991]) {
    const { vhostRows, ipMap, apps } = filo(tohum, 400, 1500);
    for (const a of apps) {
      const ctx = { vhostRows, ipMap, jvm: a.jvm, gen: a.gen, modCluster: a.modCluster };
      const aday = adayVhostlar(a.app, a.host, ctx);
      const tamAjp = ajpWeb(a.host, a.jvm, vhostRows, ipMap);
      assert.deepEqual(ajpWeb(a.host, a.jvm, aday, ipMap), tamAjp, `ajp fark: tohum ${tohum} ${a.app}@${a.host}`);
      eslesen += tamAjp.length;
      if (a.modCluster) {
        const tamMc = mcWeb(a.app, a.host, a.gen, vhostRows);
        assert.deepEqual(mcWeb(a.app, a.host, a.gen, aday), tamMc, `mc fark: tohum ${tohum} ${a.app}@${a.host}`);
        eslesen += tamMc.length;
      }
    }
  }
  assert.ok(eslesen > 200, `test verisi yeterince eslesme uretmiyor (${eslesen}) - bekci kor kalir`);
});

test('VI2 karmasiklik: vhost alanlari uygulama x vhost kez degil, ~vhost kez okunur', () => {
  const { vhostRows, ipMap, apps } = filo(42, 300, 3000);
  let okuma = 0;
  const sayan = vhostRows.map((v) => {
    const o = { ...v };
    Object.defineProperty(o, 'proxy_targets', { get() { okuma += 1; return v.proxy_targets; }, enumerable: true });
    return o;
  });
  for (const a of apps) {
    webZenginlestir(a.app, a.host, { matched: true, how: 'x', web: [] },
      { hubVhostsByHost: new Map(), vhostRows: sayan, ipMap, jvm: a.jvm, gen: a.gen, modCluster: a.modCluster });
  }
  assert.ok(okuma < 3 * sayan.length + apps.length * 60, `proxy_targets ${okuma} kez okundu (uygulama x vhost = ${apps.length * sayan.length})`);
});

test('VI3 webZenginlestir sonucu tum liste ile ayni', () => {
  const { vhostRows, ipMap, apps } = filo(5, 200, 800);
  for (const a of apps) {
    const bas = { matched: true, how: 'x', web: [] };
    const ctx = { hubVhostsByHost: new Map(), vhostRows, ipMap, jvm: a.jvm, gen: a.gen, modCluster: a.modCluster };
    const gercek = webZenginlestir(a.app, a.host, bas, ctx).web;
    const beklenen = [...ajpWeb(a.host, a.jvm, vhostRows, ipMap), ...(a.modCluster ? mcWeb(a.app, a.host, a.gen, vhostRows) : [])];
    assert.deepEqual(gercek.map((w) => `${w.host}|${w.serverName}|${w.port}|${w.confFile}`).sort(),
      [...new Set(beklenen.map((w) => `${w.host}|${w.serverName}|${w.port}|${w.confFile}`))].sort(), `${a.app}@${a.host}`);
  }
});
