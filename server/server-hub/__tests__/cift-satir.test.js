// server/server-hub/__tests__/cift-satir.test.js - Server_Hub_* cift satir ayiklama (uretim 2026-11-14).
//
// Uretim: dbo.Server_Hub_Jvms ayni (host, gen, jvm, scan_date) icin iki satir (id 408954 + 408983,
// ORSTPQ01/8/ORSTPMAINWEB); degerlendirme JVM'i iki kez listeledi, Toplu Auto-Start reddedildi.
//   CS1 tekillestir: dogal anahtar ayni -> tek satir, EN BUYUK id kalir (sira ne olursa olsun), sayilir
//   CS2 id yoksa (eski sema) SON gorulen kalir; __sh_id hic sizmaz; farkli anahtar (gen/jvm) dokunulmaz
//   CS3 her tablonun anahtari: Init root+file, Vhosts listen+server_name+aliases+conf_file, Ips ip+iface, ...
//   CS4 loadLatest: id secilir (sys.columns'ta varsa), cift JVM tek doner, data.ciftSatir sayar
//   CS5 getAssessment: summary.ciftSatir + value.ciftSatir; sayi degismedikce log tekrarlanmaz
//   CS6 id kolonu semada yoksa sorguya GIRMEZ (eski kurulum dusmez), ayiklama yine calisir
//   CS7 loader bilgi satiri DUPLICATE_ROWS_DROPPED sunucuyu LOAD_EXCLUDED yapmaz
//   CS8 sayi 0a inince bir kez loglanir; CS9 loadJvmAgir ORDER BY id; CS10 ekranda cift satir bandi
'use strict';
const { esnek } = require('../../__tests__/fixtures/kod-deseni.cjs');

const { test: nodeTest, beforeEach } = require('node:test');
const test = (ad, fn) => nodeTest(ad, { timeout: 10000 }, fn);
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

const C = require('../cift-satir.cjs');

const gun = new Date().toISOString().slice(0, 10);
let idVar = true;
let temiz = false; // CS8: DB temizlendi (cift yok)
const sorgular = [];
const JVMS = () => [
  {
    host: 'ORSTPQ01',
    scan_date: gun,
    gen: 8,
    jvm: 'ORSTPMAINWEB',
    grp: 'g',
    running: 1,
    auto_start: 'true',
    __sh_id: 408954,
  },
  {
    host: 'ORSTPQ01',
    scan_date: gun,
    gen: 8,
    jvm: 'ORSTPTELLER',
    grp: 'g',
    running: 1,
    auto_start: 'true',
    __sh_id: 408957,
  },
  {
    host: 'ORSTPQ01',
    scan_date: gun,
    gen: 8,
    jvm: 'ORSTPMAINWEB',
    grp: 'g',
    running: 0,
    auto_start: 'false',
    __sh_id: 408983,
  },
  {
    host: 'ORSTPQ01',
    scan_date: gun,
    gen: 8,
    jvm: 'ORSTPTELLER',
    grp: 'g',
    running: 1,
    auto_start: 'true',
    __sh_id: 408986,
  },
  {
    host: 'ORSTPQ01',
    scan_date: gun,
    gen: 7,
    jvm: 'ORSTPMAINWEB',
    grp: 'g',
    running: 1,
    auto_start: 'true',
    __sh_id: 408990,
  },
];
const KOLONLAR = {
  Server_Hub_Hosts: ['id', 'host', 'scan_date', 'products', 'wall_s', 'cpu_s', 'note'],
  Server_Hub_Jvms: [
    'id',
    'host',
    'scan_date',
    'gen',
    'jvm',
    'grp',
    'running',
    'auto_start',
    'server_state',
    'ports',
  ],
};
stub('../../inventory/mssql.cjs', {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (s) => {
    const q = String(s);
    sorgular.push(q);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(q)) return { recordset: [{ oid: 1 }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(q)) {
      const out = [];
      for (const [t, cols] of Object.entries(KOLONLAR))
        for (const c of cols) if (c !== 'id' || idVar) out.push({ tbl: t, name: c });
      return { recordset: out };
    }
    if (/FROM dbo\.Server_Hub_Jvms t/.test(q)) {
      const rows = temiz
        ? JVMS().filter((r) => r.__sh_id !== 408954 && r.__sh_id !== 408957)
        : JVMS();
      if (!idVar) for (const r of rows) delete r.__sh_id;
      return { recordset: rows };
    }
    if (/FROM dbo\.Server_Hub_Hosts t/.test(q)) {
      const r = [
        { host: 'ORSTPQ01', scan_date: gun, products: 'JBOSS8', note: '', __sh_id: 10 },
        { host: 'ORSTPQ01', scan_date: gun, products: 'JBOSS8', note: 'yeni', __sh_id: 11 },
      ];
      if (temiz) r.shift();
      if (!idVar) for (const x of r) delete x.__sh_id;
      return { recordset: r };
    }
    return { recordset: [] };
  },
});
stub('../../db/index.cjs', { query: async () => ({ rows: [] }) });
stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
const gercek = require('../assess.cjs');
let sonData = null;
stub('../assess.cjs', {
  ...gercek,
  assess: (data) => {
    sonData = data;
    return {
      hosts: [],
      summary: { scanVersion: {} },
      latestScan: null,
      staleFleet: null,
      schemaUnknown: false,
    };
  },
});
const SH = require('../index.cjs');

const uyarilar = [];
const asilWarn = console.warn;
beforeEach(() => {
  idVar = true;
  temiz = false;
  sorgular.length = 0;
  sonData = null;
  uyarilar.length = 0;
  console.warn = (...a) => uyarilar.push(a.join(' '));
  SH._onbellekSifirlaForTest();
});
process.on('exit', () => {
  console.warn = asilWarn;
});

test('CS1 dogal anahtar ayni -> tek satir, en buyuk id kalir, sayilir', () => {
  const ters = JVMS().reverse();
  for (const giris of [JVMS(), ters]) {
    const r = C.tekillestir('dbo.Server_Hub_Jvms', giris);
    assert.equal(r.atilan, 2);
    assert.equal(r.satirlar.length, 3);
    const mw8 = r.satirlar.find((x) => x.gen === 8 && x.jvm === 'ORSTPMAINWEB');
    assert.equal(mw8.auto_start, 'false', 'en son yukleme (408983) kalmali');
    assert.ok(
      r.satirlar.every((x) => !('__sh_id' in x)),
      '__sh_id sizdi',
    );
  }
});

test('CS2 id yoksa son gorulen kalir; farkli gen/jvm dokunulmaz; buyuk/kucuk harf ve bosluk ayni anahtar', () => {
  const rows = [
    { host: 'H1', gen: 8, jvm: 'App', v: 1 },
    { host: 'h1', gen: 8, jvm: 'app ', v: 2 },
    { host: 'H1', gen: 7, jvm: 'App', v: 3 },
    { host: 'H1', gen: 8, jvm: 'App2', v: 4 },
  ];
  const r = C.tekillestir('dbo.Server_Hub_Jvms', rows);
  assert.equal(r.atilan, 1);
  assert.deepEqual(
    r.satirlar.map((x) => x.v),
    [2, 3, 4],
  );
  // bilinmeyen tabloya dokunulmaz
  const b = C.tekillestir('dbo.Server_Hub_Bilinmeyen', [
    { host: 'A', __sh_id: 1 },
    { host: 'A', __sh_id: 2 },
  ]);
  assert.equal(b.atilan, 0);
  assert.equal(b.satirlar.length, 2);
  assert.ok(b.satirlar.every((x) => !('__sh_id' in x)));
});

test('CS3 her tablonun dogal anahtari', () => {
  const say = (t, rows) => C.tekillestir(t, rows).atilan;
  assert.equal(say('dbo.Server_Hub_Hosts', [{ host: 'A' }, { host: 'A' }]), 1);
  assert.equal(
    say('dbo.Server_Hub_Init', [
      { host: 'A', root: '/v', file: 'a' },
      { host: 'A', root: '/v', file: 'b' },
      { host: 'A', root: '/v', file: 'a' },
    ]),
    1,
  );
  assert.equal(
    say('dbo.Server_Hub_Jboss', [
      { host: 'A', gen: 7 },
      { host: 'A', gen: 8 },
      { host: 'A', gen: 8 },
    ]),
    1,
  );
  assert.equal(
    say('dbo.Server_Hub_Web', [
      { host: 'A', product: 'NGINX' },
      { host: 'A', product: 'IHS' },
      { host: 'A', product: 'NGINX' },
    ]),
    1,
  );
  const v = (listen, sn, cf, al = '') => ({
    host: 'A',
    product: 'NGINX',
    listen,
    server_name: sn,
    aliases: al,
    conf_file: cf,
  });
  assert.equal(
    say('dbo.Server_Hub_Vhosts', [
      v('443', 'a', 'x.conf'),
      v('443', 'a', 'y.conf'),
      v('80', 'a', 'x.conf'),
      v('443', 'b', 'x.conf'),
      v('443', 'a', 'x.conf'),
    ]),
    1,
  );
  // nginx: conf_file bos, server_name yalniz ILK ad - farkli aliases iki AYRI blok (ikisi de trafik alir)
  const nx = C.tekillestir('dbo.Server_Hub_Vhosts', [
    v('443', 'api.x.com', '', 'b.x.com'),
    v('443', 'api.x.com', '', 'c.x.com'),
  ]);
  assert.equal(nx.atilan, 0, 'farkli alias li vhost kopya sayildi');
  assert.deepEqual(
    nx.satirlar.map((x) => x.aliases),
    ['b.x.com', 'c.x.com'],
  );
  assert.equal(
    say('dbo.Server_Hub_Vhosts', [
      v('443', 'api.x.com', '', 'b.x.com'),
      v('443', 'api.x.com', '', 'b.x.com'),
    ]),
    1,
  );
  assert.equal(
    say('dbo.Server_Hub_Ips', [
      { host: 'A', ip: '1', iface: 'e0' },
      { host: 'A', ip: '1', iface: 'e1' },
      { host: 'A', ip: '1', iface: 'e0' },
    ]),
    1,
  );
  assert.equal(say('dbo.Server_Hub_Sshd', [{ host: 'A' }, { host: 'A' }]), 1);
  // loadLatest'in okudugu her tablonun anahtari tanimli (yeni tablo eklenirse burasi kirmizi olur)
  for (const t of Object.keys(SH.SH_KOLONLAR)) {
    assert.ok(C.DOGAL_ANAHTAR[t], `${t} icin dogal anahtar yok`);
    for (const k of C.DOGAL_ANAHTAR[t])
      assert.ok(SH.SH_KOLONLAR[t].includes(k), `${t}.${k} filo sorgusunda secilmiyor`);
  }
});

test('CS4 loadLatest: id secilir, cift JVM tek doner, ciftSatir sayilir', async () => {
  const { data } = await SH.loadLatest();
  const jq = sorgular.find((q) => /FROM dbo\.Server_Hub_Jvms t/.test(q));
  assert.match(jq, /t\.\[id\] AS \[__sh_id\]/);
  assert.equal(data.jvms.length, 3);
  assert.equal(data.jvms.filter((j) => j.jvm === 'ORSTPMAINWEB' && Number(j.gen) === 8).length, 1);
  assert.equal(
    data.jvms.find((j) => j.jvm === 'ORSTPMAINWEB' && Number(j.gen) === 8).auto_start,
    'false',
  );
  assert.equal(data.hosts.length, 1);
  assert.equal(data.hosts[0].note, 'yeni');
  assert.ok([...data.jvms, ...data.hosts].every((x) => !('__sh_id' in x)));
  assert.deepEqual(data.ciftSatir, {
    toplam: 3,
    tablolar: { Server_Hub_Jvms: 2, Server_Hub_Hosts: 1 },
  });
});

test('CS5 getAssessment: summary.ciftSatir; ayni sayi ikinci kez loglanmaz', async () => {
  const a = await SH.getAssessment(true);
  assert.equal(sonData.jvms.length, 3, 'assess tekil satirlari gormeli');
  assert.equal(a.summary.ciftSatir.toplam, 3);
  assert.equal(a.ciftSatir.toplam, 3);
  const ilk = uyarilar.filter((u) => /cift satir ayiklandi/.test(u)).length;
  await SH.getAssessment(true);
  const ikinci = uyarilar.filter((u) => /cift satir ayiklandi/.test(u)).length;
  assert.ok(ilk === 1 && ikinci === 1, `log tekrarlandi: ${ilk} -> ${ikinci}`);
});

test('CS8 sayi 0a inince bir kez "0a indi" loglanir (temizlik etkisi gorunur)', async () => {
  const asilLog = console.log;
  const loglar = [];
  console.log = (...a) => loglar.push(a.join(' '));
  try {
    await SH.getAssessment(true);
    temiz = true;
    SH._onbellekSifirlaForTest();
    const a = await SH.getAssessment(true);
    assert.equal(a.summary.ciftSatir.toplam, 0);
    assert.equal(loglar.filter((l) => /cift satir 0a indi/.test(l)).length, 1);
    SH._onbellekSifirlaForTest();
    await SH.getAssessment(true);
    assert.equal(
      loglar.filter((l) => /cift satir 0a indi/.test(l)).length,
      1,
      '0a indi tekrarlandi',
    );
  } finally {
    console.log = asilLog;
  }
});

test('CS9 loadJvmAgir: id varsa ORDER BY t.[id] (Map son = en buyuk id), yoksa siralama eklenmez', async () => {
  KOLONLAR.Server_Hub_Jvms.push('jvm_args');
  try {
    await SH.loadJvmAgir('ORSTPQ01');
    let jq = sorgular.filter((q) => /FROM dbo\.Server_Hub_Jvms t/.test(q)).pop();
    assert.match(jq, /ORDER BY t\.\[id\]\s*$/);
    idVar = false;
    sorgular.length = 0;
    await SH.loadJvmAgir('ORSTPQ01');
    jq = sorgular.filter((q) => /FROM dbo\.Server_Hub_Jvms t/.test(q)).pop();
    assert.doesNotMatch(jq, esnek(/ORDER BY/));
  } finally {
    KOLONLAR.Server_Hub_Jvms.pop();
  }
});

test('CS10 ekran: ozet seridinde cift satir bandi (sessiz degil)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kok = path.join(__dirname, '..', '..', '..');
  const sayfa = fs.readFileSync(
    path.join(kok, 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
    'utf8',
  );
  const api = fs.readFileSync(path.join(kok, 'src', 'api', 'serverHubApi.ts'), 'utf8');
  assert.match(sayfa, /<CiftSatirBandi c=\{data\.summary\?\.ciftSatir\} \/>/);
  // Toplam 0 / tanimsiz / NaN iken bant cizilmez (ters karsilastirma yerine adli kosul; Sonar S1940).
  assert.match(sayfa, /const ciftVar = c != null && c\.toplam > 0;\s*if \(!ciftVar\) return null;/);
  assert.match(api, /ciftSatir\?: \{ toplam: number; tablolar: Record<string, number> \};/);
});

test('CS6 id kolonu yoksa sorguya girmez; ayiklama son goruleni tutar', async () => {
  idVar = false;
  const { data } = await SH.loadLatest();
  const jq = sorgular.find((q) => /FROM dbo\.Server_Hub_Jvms t/.test(q));
  assert.doesNotMatch(jq, /__sh_id/);
  assert.equal(data.jvms.length, 3);
  assert.equal(data.ciftSatir.toplam, 3);
});

test('CS7 loader bilgi satiri DUPLICATE_ROWS_DROPPED sunucuyu LOAD_EXCLUDED yapmaz (run_at > loaded_at olsa da)', () => {
  const t0 = new Date(`${gun}T10:00:00Z`);
  const t1 = new Date(`${gun}T10:05:00Z`);
  const girdi = {
    hosts: [
      {
        host: 'ORSTPQ01',
        scan_date: gun,
        products: 'JBOSS8',
        wall_s: 1,
        cpu_s: 0.1,
        note: '',
        loaded_at: t0,
      },
    ],
    init: [],
    jboss: [],
    jvms: [],
    web: [],
    vhosts: [],
    ips: [],
    sshd: [],
    mwApps: [],
    invEnv: [],
    invProductUnknown: {},
    schemaUnknown: false,
    loadIssues: [
      {
        host: 'ORSTPQ01',
        scan_date: gun,
        issue: 'DUPLICATE_ROWS_DROPPED',
        detail: 'JVM=2',
        run_at: t1,
      },
    ],
  };
  const a = gercek.assess(girdi, {});
  const h = a.hosts.find((x) => x.host === 'ORSTPQ01');
  assert.equal(h.loadExcluded, false);
  // ayni zamanlamada gercek bir dislama satiri LOAD_EXCLUDED olur (bekci kor degil)
  girdi.loadIssues[0].issue = 'FORMAT';
  assert.equal(
    gercek.assess(girdi, {}).hosts.find((x) => x.host === 'ORSTPQ01').loadExcluded,
    true,
  );
});
