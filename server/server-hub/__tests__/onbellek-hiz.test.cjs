// server/server-hub/__tests__/onbellek-hiz.test.cjs - Server Hub degerlendirme onbellegi ve hiz uclari (2026-11-05).
//
// Kullanici: "server hub cok yavas her tikladigimda bir seyler yukluyor".
//   HZ1 60 sn icinde ikinci istek DB'ye gitmez
//   HZ2 60 sn - 15 dk: BAYAT deger HEMEN doner, arkada TEK tazeleme baslar (ayni anda bircok istek -> bir okuma)
//   HZ3 15 dk'dan eski ya da silinmis onbellek / fresh=true: istek tam okumayi bekler
//   HZ4 TEK UCUS: soguk onbellekte ayni anda uc istek -> tek loadLatest
//   HZ5 NESIL: silmeden once baslamis okuma onbellege YAZILMAZ ve fresh istek ona katilmaz
//   HZ6 arka plan tazelemesi duserse bayat deger kalir, yakalanmamis reddetme yok; sonraki istek yeniden dener
//   HZ7 /overview /findings /host Server-Timing tasir (onbellek | bayat | taze + sureler)
//   HZ8 /host-adlari: /overview ile ayni kume (taramadan dusen haric); Admin olmayana 403
//   HZ9 tek sunucu JVM agir sorgusu MAX(scan_date) alt sorgusunu da o sunucuyla daraltir
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// Sahte envanter DB'si: her TAM okuma OBJECT_ID sorgusuyla baslar (sayilir); kapi verilirse onu bekler.
let okuma = 0;
let kapi = null;
let hataVer = false;
const sorgular = [];
stub('../../inventory/mssql.cjs', {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (s, p) => {
    sorgular.push({ s: String(s), p });
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) {
      okuma += 1;
      if (kapi) await kapi;
      if (hataVer) throw new Error('DB yok');
      return { recordset: [{ oid: 1 }] };
    }
    return { recordset: [] };
  },
});
stub('../../db/index.cjs', { query: async () => ({ rows: [] }) });
stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
// GERCEK assess, iki sunuculuk gecerli girdiyle (her okumada yeni nesne: hangi okumanin dondugu gorulur);
// APPSRV02 "taramadan dustu" isaretlenir (/overview ve /host-adlari onu listelemez).
const gercek = require('../assess.cjs');
let uretim = 0;
const gun = new Date().toISOString().slice(0, 10);
const girdi = {
  hosts: [
    {
      id: 1,
      scan_date: gun,
      host: 'APPSRV01',
      products: 'JBOSS7',
      wall_s: 1,
      cpu_s: 0.1,
      note: '',
    },
    { id: 2, scan_date: gun, host: 'APPSRV02', products: 'IHS', wall_s: 1, cpu_s: 0.1, note: '' },
  ],
  init: [],
  jboss: [],
  jvms: [],
  web: [],
  vhosts: [],
  ips: [],
  sshd: [],
  loadIssues: [],
  mwApps: [],
  invEnv: [],
  invProductUnknown: {},
  schemaUnknown: false,
};
stub('../assess.cjs', {
  ...gercek,
  assess: (_data, o) => {
    uretim += 1;
    const r = gercek.assess(girdi, o);
    r.hosts.find((h) => h.host === 'APPSRV02').taramadanDustu = true;
    return r;
  },
});

const SH = require('../index.cjs');

let saat = Date.parse('2026-11-05T12:00:00Z');
const asilNow = Date.now;
beforeEach(() => {
  SH._onbellekSifirlaForTest();
  okuma = 0;
  uretim = 0;
  kapi = null;
  hataVer = false;
  sorgular.length = 0;
  saat = Date.parse('2026-11-05T12:00:00Z');
  Date.now = () => saat;
});
afterEach(() => {
  Date.now = asilNow;
});
const bekle = () => new Promise((r) => setImmediate(r));

test('HZ1 60 sn icinde ikinci istek DB ye gitmez', async () => {
  const a = await SH.getAssessment(false);
  saat += 59 * 1000;
  const b = await SH.getAssessment(false);
  assert.equal(okuma, 1);
  assert.equal(a, b);
});

test('HZ2 bayat deger hemen doner, arkada tek tazeleme', async () => {
  const ilk = await SH.getAssessment(false);
  saat += 5 * 60 * 1000;
  let coz;
  kapi = new Promise((r) => (coz = r));
  const o = {};
  const [x, y, z] = await Promise.all([
    SH.getAssessment(false, o),
    SH.getAssessment(false),
    SH.getAssessment(false),
  ]);
  assert.equal(o.kaynak, 'bayat');
  assert.ok(x === ilk && y === ilk && z === ilk, 'bayat deger hemen dondu (okuma beklenmedi)');
  assert.equal(okuma, 2, 'uc bayat istek tek arka plan okumasi baslatir');
  coz();
  kapi = null;
  await bekle();
  await bekle();
  const yeni = await SH.getAssessment(false);
  assert.notEqual(yeni, ilk, 'arka plan sonucu onbellege yazildi');
  assert.equal(okuma, 2);
});

test('HZ3 15 dk dan eski, silinmis ya da fresh: bekler', async () => {
  const ilk = await SH.getAssessment(false);
  saat += 16 * 60 * 1000;
  const o = {};
  const b = await SH.getAssessment(false, o);
  assert.notEqual(b, ilk);
  assert.equal(o.kaynak, 'taze');
  assert.equal(okuma, 2);
  SH.onbellekSil();
  const c = await SH.getAssessment(false);
  assert.notEqual(c, b, 'silinen onbellek bayat da donmez');
  const d = await SH.getAssessment(true);
  assert.notEqual(d, c, 'fresh hep taze');
  assert.equal(okuma, 4);
});

test('HZ4 tek ucus', async () => {
  let coz;
  kapi = new Promise((r) => (coz = r));
  const p = Promise.all([SH.getAssessment(false), SH.getAssessment(false), SH.getAssessment(true)]);
  await bekle();
  coz();
  const [a, b, c] = await p;
  assert.equal(okuma, 1);
  assert.ok(a === b && b === c);
});

test('HZ5 nesil: silmeden once baslamis okuma yazilmaz', async () => {
  let coz;
  kapi = new Promise((r) => (coz = r));
  const eski = SH.getAssessment(false);
  await bekle();
  SH.onbellekSil(); // is bitti
  kapi = null;
  const yeni = SH.getAssessment(true); // eski ucusa katilmaz
  await bekle();
  assert.equal(okuma, 2, 'fresh istek silmeden onceki okumaya katilmadi');
  coz();
  const [e, y] = await Promise.all([eski, yeni]);
  assert.notEqual(e, y);
  const sonra = await SH.getAssessment(false);
  assert.equal(sonra, y, 'onbellekte yeni nesil var (eski okuma yazmadi)');
  assert.equal(okuma, 2);
});

test('HZ6 arka plan hatasi bayat degeri silmez', async () => {
  const ilk = await SH.getAssessment(false);
  const reddetme = [];
  const dinle = (e) => reddetme.push(e);
  process.on('unhandledRejection', dinle);
  const uyari = console.warn;
  const uyarilar = [];
  console.warn = (...a) => uyarilar.push(a.join(' '));
  try {
    saat += 2 * 60 * 1000;
    hataVer = true;
    assert.equal(await SH.getAssessment(false), ilk);
    await bekle();
    await bekle();
    assert.equal(await SH.getAssessment(false), ilk, 'hata sonrasi bayat deger yerinde');
    assert.equal(okuma, 3, 'her bayat istek yeniden dener (tek ucus bitince)');
    assert.deepEqual(reddetme, []);
    assert.ok(uyarilar.some((x) => /arka plan tazelemesi dustu/.test(x)));
  } finally {
    process.off('unhandledRejection', dinle);
    console.warn = uyari;
  }
});

async function httpIle(fn, rol = 'Admin') {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: rol, username: 'test' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    SH.initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
}

test('HZ7 Server-Timing', async () => {
  Date.now = asilNow;
  await httpIle(async (kok) => {
    const a = await fetch(`${kok}/overview`);
    assert.match(a.headers.get('server-timing'), /^sh;desc="taze", db;dur=\d+, assess;dur=\d+$/);
    const b = await fetch(`${kok}/findings`);
    assert.equal(b.headers.get('server-timing'), 'sh;desc="onbellek"');
    const c = await fetch(`${kok}/host/APPSRV01`);
    assert.equal(c.status, 200);
    assert.equal(c.headers.get('server-timing'), 'sh;desc="onbellek"');
  });
});

test('HZ8 /host-adlari', async () => {
  Date.now = asilNow;
  await httpIle(async (kok) => {
    const r = await (await fetch(`${kok}/host-adlari`)).json();
    const o = await (await fetch(`${kok}/overview`)).json();
    assert.deepEqual(r.hosts, ['APPSRV01'], 'taramadan dusen haric');
    assert.deepEqual(
      r.hosts,
      o.hosts.map((h) => h.host),
      '/overview ile ayni kume',
    );
  });
  await httpIle(async (kok) => {
    assert.equal((await fetch(`${kok}/host-adlari`)).status, 403);
  }, 'User');
});

test('HZ9 JVM agir sorgusu sunucuyla daraltilir', async () => {
  sorgular.length = 0;
  await SH.loadJvmAgir('APPSRV01');
  const s = sorgular.find((x) => /FROM dbo\.Server_Hub_Jvms t/.test(x.s));
  // Sema bos dondugu icin agir kolon yoksa sorgu atilmaz; kolonlu semayla dene.
  if (!s) {
    const asil = require.cache[require.resolve('../../inventory/mssql.cjs')].exports.query;
    require.cache[require.resolve('../../inventory/mssql.cjs')].exports.query = async (q, p) => {
      sorgular.push({ s: String(q), p });
      if (/FROM sys\.columns c WHERE c\.object_id IN/.test(q))
        return {
          recordset: SH.JVM_AGIR_KOLONLAR.map((name) => ({ tbl: 'Server_Hub_Jvms', name })),
        };
      return { recordset: [] };
    };
    try {
      await SH.loadJvmAgir('APPSRV01');
    } finally {
      require.cache[require.resolve('../../inventory/mssql.cjs')].exports.query = asil;
    }
  }
  const j = sorgular.find((x) => /FROM dbo\.Server_Hub_Jvms t/.test(x.s));
  assert.ok(j, 'agir JVM sorgusu atildi');
  assert.match(
    j.s,
    /\(SELECT host, MAX\(scan_date\) AS d FROM dbo\.Server_Hub_Hosts\s+WHERE host = @h OR host LIKE @h \+ '\.%' GROUP BY host\) m/,
    'alt sorgu tum filoyu taramaz',
  );
});
