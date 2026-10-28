// server/selfservice/__tests__/nginx-tanim-okuma.test.cjs - Self Servis > Nginx - RVP Operations
// "read" (2026-10-20).
//
// Kullanici: "Read job'ini silme islemini yaparken okudugun ise cevirelim, Ansible job'ini
// tetiklememize gerek yok. Read isteyen kisiye mevcut tanimlar / tanimlardan hangi location'a
// hangi uygulama cevap veriyor bunu gosterelim."
//   NT1 sablon tanima playbook'tan (nginx_ops/nginx_ops.yml); eylem alani / degeri harf duyarsiz
//   NT2 tablo: location basina uygulama + namespace + sunucular; ayni location'a farkli uygulama
//       -> tutarsiz; namespace / uygulama suzgeci; siralama; tekil sunucu
//   NT3 PROD: sunucu filosu; GLOMO prod yalniz YENI filo (eski filo sayilir, listelenmez); GLOMO
//       disi prod iki filo da etiketli; eski filo proxy satirinda uygulama TAHMIN + hedef
//   NT4 okuyucu: tarama hic yok / okunamadi -> olculemedi (0 / yok DEGIL); taramada satir yok ->
//       yok; kind kolonu yoksa kolonsuz okunur; gecersiz ortam / servis 400; sorgu parametreli
//   NT5 GERCEK selfservice ucu GET /nginx-tanimlar (giris yapmis herkes, Admin sart degil)
//   NT6 runner: survey yaniti yerelOkuma tasir (iki dal); launch-ss read'i kapilardan ONCE
//       reddeder (AWX'e ve Smart / OCO'ya gitmez)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SERVER = path.join(__dirname, '..', '..');
const stub = (rel, exports) => {
  const file = path.join(SERVER, rel);
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
};

const ok = require('../nginx-tanim-okuma.cjs');

const GROUPS = [
  { id: 'glomo', oldHosts: ['GBRVPP07', 'GBRVPAP03'], newHosts: ['GBNGXP40', 'GBNGXAP34'] },
  { id: 'other', oldHosts: ['GBRVPP01'], newHosts: ['GBNGXP44'] },
];
const R = (host, loc, app, ns, o = {}) => ({ host, location_path: loc, application: app, namespace: ns, ...o });

test('NT1 sablon tanima ve eylem alani', () => {
  for (const p of ['bmw_nginx/nginx_ops/nginx_ops.yml', 'nginx_ops/nginx_ops.yaml', 'NGINX_OPS/NGINX_OPS.YML'])
    assert.ok(ok.yerelOkumaOf({ playbook: p }), p);
  for (const p of ['bmw_nginx/nginx_ops/nginx_prod_migration.yml', 'bmw_nginx/nginx_ops/nginx_ops.yml.bak', 'x/nginx_ops.yml', '', null])
    assert.equal(ok.yerelOkumaOf({ playbook: p }), null, String(p));
  assert.equal(ok.yerelOkumaOf(null), null);
  for (const v of [{ action: 'read' }, { Action: ' READ ' }, { op_selection: 'Read' }]) assert.equal(ok.eylemReadMi(v), true);
  for (const v of [{ action: 'delete' }, { other: 'read' }, {}, null]) assert.equal(ok.eylemReadMi(v), false);
  const nx = { playbook: 'bmw_nginx/nginx_ops/nginx_ops.yml' };
  assert.equal(ok.yerelOkumaMi(nx, { action: 'read' }), true);
  assert.equal(ok.yerelOkumaMi(nx, { action: 'create' }), false);
  assert.equal(ok.yerelOkumaMi({ playbook: 'x/opsx.yml' }, { action: 'read' }), false);
});

test('NT2 tablo: location -> uygulama, tutarsizlik, suzgec, siralama', () => {
  const rows = [
    R('GBNGXT33', '/b/', 'b-app-v1', 'kart-test'),
    R('GBNGXT33', '/a/', 'a-app-v1', 'kart-test'),
    R('GBNGXT34', '/a/', 'a-app-v1', 'kart-test'),
    R('GBNGXT34', '/a/', 'a-app-v1', 'kart-test'),
    R('GBNGXT35', '/a/', 'a2-app-v1', 'kart-test'),
    R('GBNGXT33', '', 'x', 'y'),
  ];
  const t = ok.tanimTablosu(rows, { env: 'test', service: 'glomo', groups: GROUPS });
  assert.deepEqual(t.satirlar.map((s) => s.location), ['/a/', '/b/']);
  const a = t.satirlar[0];
  assert.equal(a.tutarsiz, true, 'ayni location farkli uygulama isaretlenmedi');
  assert.deepEqual(a.cevaplar.map((c) => [c.application, c.namespace, c.sunucular.map((h) => h.host)]), [
    ['a-app-v1', 'kart-test', ['GBNGXT33', 'GBNGXT34']],
    ['a2-app-v1', 'kart-test', ['GBNGXT35']],
  ]);
  assert.equal(a.cevaplar[0].sunucular[0].filo, null, 'non-prod filo etiketi tasimamali');
  assert.equal(t.satirlar[1].tutarsiz, false);
  const f = ok.tanimTablosu(rows, { env: 'test', service: 'glomo', application: 'A-APP-V1', groups: GROUPS });
  assert.deepEqual(f.satirlar.map((s) => [s.location, s.cevaplar.length, s.tutarsiz]), [['/a/', 1, false]]);
  const n = ok.tanimTablosu(rows, { env: 'test', service: 'glomo', namespace: 'baska', groups: GROUPS });
  assert.equal(n.satirlar.length, 0);
});

test('NT3 PROD filolari; GLOMO prod yalniz yeni filo; proxy tahmini', () => {
  const rows = [
    R('GBNGXP40', '/g/', 'g-app-v1', 'g-prod'),
    R('GBNGXAP34', '/g/', 'g-app-v1', 'g-prod'),
    R('GBRVPP07', '/g/', 'g-app-v1', null, { kind: 'proxy', target_url: 'https://g-app-v1-g-prod.apps.fw' }),
    R('GBRVPAP03', '/eski/', 'e', null, { kind: 'proxy' }),
  ];
  const g = ok.tanimTablosu(rows, { env: 'PROD', service: 'GLOMO', groups: GROUPS });
  assert.equal(g.glomoProd, true);
  assert.equal(g.eskiFiloGizli, 2);
  assert.deepEqual(g.satirlar.map((s) => s.location), ['/g/'], 'eski filo location GLOMO prod okumasina girdi');
  assert.deepEqual(g.satirlar[0].cevaplar[0].sunucular, [{ host: 'GBNGXAP34', filo: 'yeni' }, { host: 'GBNGXP40', filo: 'yeni' }]);
  const rows2 = [
    R('GBNGXP44', '/w/', 'w-app-v1', 'w-prod'),
    R('GBRVPP01', '/w/', 'w-app-v1', null, { kind: 'proxy', target_url: 'https://w-app-v1-w-prod.apps.fw' }),
    R('GBXYZP99', '/z/', 'z-app-v1', 'z-prod'),
  ];
  const w = ok.tanimTablosu(rows2, { env: 'prod', service: 'webforms', groups: GROUPS });
  assert.equal(w.glomoProd, false);
  assert.equal(w.eskiFiloGizli, 0);
  const wc = w.satirlar.find((s) => s.location === '/w/').cevaplar;
  const proxy = wc.find((c) => c.tahmin);
  assert.ok(proxy, 'eski filo proxy satiri yok');
  assert.deepEqual([proxy.hedef, proxy.namespace, proxy.sunucular[0].filo], ['https://w-app-v1-w-prod.apps.fw', null, 'eski']);
  assert.deepEqual(wc.find((c) => !c.tahmin).sunucular, [{ host: 'GBNGXP44', filo: 'yeni' }]);
  assert.equal(w.satirlar.find((s) => s.location === '/w/').tutarsiz, true, 'namespace farki (proxy tahmini) isaretlenmeli');
  assert.equal(w.satirlar.find((s) => s.location === '/z/').cevaplar[0].sunucular[0].filo, 'bilinmiyor');
});

function sahteSql(davranis) {
  const sorgular = [];
  return {
    sorgular,
    mssql: {
      sql: { NVarChar: () => 'nv' },
      query: async (q, params) => {
        sorgular.push({ q: String(q), params });
        return davranis(String(q), params);
      },
    },
  };
}

test('NT4 okuyucu: olculemedi / yok / var, kolon yedegi, dogrulama', async () => {
  let s = sahteSql(() => ({ recordset: [{ d: null }] }));
  let r = await ok.nginxTanimlari({ env: 'prod', service: 'glomo' }, { mssql: s.mssql, groups: GROUPS });
  assert.deepEqual([r.ok, r.durum], [true, 'olculemedi']);
  assert.match(r.sebep, /henüz hiç koşmadı/);
  s = sahteSql(() => {
    throw new Error('baglanti koptu');
  });
  r = await ok.nginxTanimlari({ env: 'prod', service: 'glomo' }, { mssql: s.mssql, groups: GROUPS });
  assert.deepEqual([r.durum, /baglanti koptu/.test(r.sebep)], ['olculemedi', true]);
  s = sahteSql((q) => (q.includes('MAX(scan_date)') ? { recordset: [{ d: '2026-10-19' }] } : { recordset: [] }));
  r = await ok.nginxTanimlari({ env: 'test', service: 'webforms' }, { mssql: s.mssql, groups: GROUPS });
  assert.deepEqual([r.durum, r.taramaTarihi, r.satirlar.length], ['yok', '2026-10-19', 0]);
  const q = s.sorgular.find((x) => x.q.includes('location_path'));
  assert.ok(q.params.some((p) => p.name === 'e' && p.value === 'TEST') && q.params.some((p) => p.name === 's' && p.value === 'WEBFORMS'));
  assert.ok(!q.q.includes('WEBFORMS') && !q.q.includes("'TEST'"), 'ortam / servis sorguya metin olarak gomuldu');
  // Eski semada opsiyonel kolon yok: yalniz SQL Server 207 ile kolonsuz sorguya duser.
  s = sahteSql((q2) => {
    if (q2.includes('MAX(scan_date)')) return { recordset: [{ d: '2026-10-19' }] };
    if (q2.includes('kind')) throw Object.assign(new Error("Invalid column name 'kind'."), { code: 'EREQUEST', number: 207 });
    return { recordset: [R('GBNGXT33', '/a/', 'a-app-v1', 'kart-test')] };
  });
  r = await ok.nginxTanimlari({ env: 'test', service: 'glomo' }, { mssql: s.mssql, groups: GROUPS });
  assert.deepEqual([r.durum, r.satirlar.length], ['var', 1]);
  assert.equal(s.sorgular.length, 3, 'dogrulanmis eski sema hatasi kolonsuz sorguya dusmedi');
  for (const [env, service] of [['', 'glomo'], ['prod', ''], ["prod'; drop", 'glomo'], ['prod', 'gl omo']]) {
    const g = await ok.nginxTanimlari({ env, service }, { mssql: s.mssql, groups: GROUPS });
    assert.deepEqual([g.ok, g.status], [false, 400], `${env}/${service}`);
  }
});

test('NT4b kolon yedegi baglanti, yetki veya ilgisiz sema hatasini gizlemez', async () => {
  const hatalar = [
    Object.assign(new Error('request timeout'), { code: 'ETIMEOUT' }),
    Object.assign(new Error('login failed'), { code: 'ELOGIN' }),
    Object.assign(new Error('socket closed'), { code: 'ESOCKET' }),
    Object.assign(new Error('SELECT permission denied'), { code: 'EREQUEST', number: 229 }),
    Object.assign(new Error("Invalid column name 'service_typo'."), { code: 'EREQUEST', number: 207 }),
    new Error("Invalid column name 'kind'."),
    Object.assign(new Error('request timeout'), {
      code: 'ETIMEOUT',
      originalError: { info: { number: 207, message: "Invalid column name 'kind'." } },
    }),
  ];
  for (const hata of hatalar) {
    const s = sahteSql((q) => {
      if (q.includes('MAX(scan_date)')) return { recordset: [{ d: '2026-10-19' }] };
      throw hata;
    });
    const r = await ok.nginxTanimlari({ env: 'test', service: 'glomo' }, { mssql: s.mssql, groups: GROUPS });
    assert.equal(r.durum, 'olculemedi', `${hata.code || 'metadata-yok'} hatasi gizlendi`);
    assert.match(r.sebep, new RegExp(hata.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(s.sorgular.length, 2, `${hata.code || 'metadata-yok'} icin kolonsuz sorgu calisti`);
  }
});

test('NT4c target_url ve ic ice mssql SQL207 hatasi eski sema yedegini acar', async () => {
  for (const hata of [
    Object.assign(new Error("Invalid column name 'target_url'."), { code: 'EREQUEST', number: 207 }),
    Object.assign(new Error('Invalid column'), {
      code: 'EREQUEST',
      originalError: { info: { number: 207, message: "Invalid column name 'kind'." } },
    }),
  ]) {
    const s = sahteSql((q) => {
      if (q.includes('MAX(scan_date)')) return { recordset: [{ d: '2026-10-19' }] };
      if (q.includes('kind')) throw hata;
      return { recordset: [R('GBNGXT33', '/a/', 'a-app-v1', 'kart-test')] };
    });
    const r = await ok.nginxTanimlari({ env: 'test', service: 'glomo' }, { mssql: s.mssql, groups: GROUPS });
    assert.deepEqual([r.durum, r.satirlar.length, s.sorgular.length], ['var', 1, 3]);
  }
});

test('NT5 GERCEK selfservice ucu', async (t) => {
  stub('auth/index.cjs', {
    requireAuth: (req, res, next) => (req.headers['x-oturum'] ? next() : res.status(401).json({ ok: false })),
    requireAdmin: (_q, res) => res.status(403).json({ ok: false }),
  });
  stub('auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  stub('audit/index.cjs', { auditMutations: () => (_q, _s, n) => n() });
  stub('selfservice/store.cjs', { loadSelfServiceStore: async () => {}, readGroups: () => [], updateGroup: async () => null });
  stub('inventory/mssql.cjs', {
    sql: { NVarChar: () => 'nv' },
    query: async (q) =>
      String(q).includes('MAX(scan_date)')
        ? { recordset: [{ d: '2026-10-19' }] }
        : { recordset: [R('GBNGXP40', '/g/', 'g-app-v1', 'g-prod'), R('GBRVPP07', '/g/', 'g', null, { kind: 'proxy' })] },
  });
  const express = require('express');
  const app = express();
  const log = console.log;
  console.log = () => {};
  try {
    require('../index.cjs').initSelfService(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  t.after(() => srv.close());
  const kok = `http://127.0.0.1:${srv.address().port}/api/selfservice`;
  const H = { 'x-oturum': '1' };
  let r = await fetch(`${kok}/nginx-tanimlar?env=prod&service=glomo`, { headers: H });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([j.durum, j.glomoProd, j.eskiFiloGizli, j.satirlar[0].cevaplar[0].sunucular[0].host], ['var', true, 1, 'GBNGXP40']);
  r = await fetch(`${kok}/nginx-tanimlar?env=prod`, { headers: H });
  assert.equal(r.status, 400);
  r = await fetch(`${kok}/nginx-tanimlar?env=prod&service=glomo`);
  assert.equal(r.status, 401, 'oturumsuz okunabildi');
});

test('NT6 runner: survey yerelOkuma tasir; launch-ss read i kapilardan once reddeder', () => {
  const src = fs.readFileSync(path.join(SERVER, 'ansible', 'runner.cjs'), 'utf8');
  const s0 = src.indexOf("app.get('/api/ansible/survey/:serverId/:templateId'");
  const s1 = src.indexOf('app.', s0 + 10);
  const survey = src.slice(s0, src.indexOf('\n  });', s0));
  assert.ok(s0 > 0 && s1 > s0);
  assert.match(survey, /const yerelOkuma = require\('\.\.\/selfservice\/nginx-tanim-okuma\.cjs'\)\.yerelOkumaOf\(detail\);/);
  assert.equal((survey.match(/\n\s+yerelOkuma,\n/g) || []).length, 2, 'survey yanitlarinin ikisi de yerelOkuma tasimali');
  const kapi = src.indexOf("require('../selfservice/nginx-tanim-okuma.cjs').yerelOkumaMi(detail, extraVars)");
  const gates = src.indexOf("require('./change-gates.cjs').runChangeGates(");
  const plan = src.indexOf('await resolveSsLaunchPlan(server, templateId, {');
  assert.ok(kapi > plan && kapi < gates, 'read kapisi change-gates (OCO / Smart) oncesinde degil');
  const blok = src.slice(kapi - 40, kapi + 600);
  // kosul kendisi (yanina "false &&" gibi bir sey eklenmemis) ve dogrudan 400 doner
  assert.match(blok, /\n\s+if \(require\('\.\.\/selfservice\/nginx-tanim-okuma\.cjs'\)\.yerelOkumaMi\(detail, extraVars\)\) \{\n\s+return res\.status\(400\)\.json\(\{\s*ok: false,\s*yerelOkuma: true/);
});
