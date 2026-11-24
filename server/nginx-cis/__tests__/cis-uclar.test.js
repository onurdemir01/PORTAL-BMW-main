// server/nginx-cis/__tests__/cis-uclar.test.js - Nginx Hub CIS HTTP yuzeyi gercek express ile (2026-11-24,
// kapsam PR-2). Sahte olan: dis DB (Nginx_Cis_*), portal DB, eski-sunucu suzgeci, AWX runner.
//   NC1 yetki: Admin olmayan yalniz GET /overview ve /host/:h okur; yazma ve rescan 403
//   NC2 /overview: tablo yoksa acik mesaj; varsa skor, istisna ve referans; eski sunucu dusurulur
//   NC3 onbellek: ayni kural damgasiyla ikinci istek dis DB'ye gitmez; ?fresh=1 ve kural degisimi gider
//   NC4 /host/:h: gecersiz ad 400, taramasi olmayan 404, olan sunucu ayrintisi
//   NC5 istisna: dogrulama (madde, '*' sunucusuz, ad, not), ekle / guncelle, sil, denetim kaydi
//   NC6 referans: dogrulama, ayni deger guncellenir, farkli deger eklenir, sil
//   NC7 rescan: kayit yok 501, preflight reddi durumu tasir, tetik + is gecmisi, gecmis hatasi yutulur
//   NC8 job-status: gecersiz numara 400, terminal durumda onbellek duser, hata 500
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
function sahte(rel, exports) {
  const p = require.resolve(path.join(KOK, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const H1 = 'ORNGXP01';
const H2 = 'ORNGXP02';
const ESKI = 'ORNGXP99';

const D = {
  tabloVar: true,
  disSorgu: 0,
  hosts: [],
  results: [],
  exceptions: [],
  overrides: [],
  portal: [],
  portalHata: null,
  stampEk: 0,
  reg: null,
  preflightHata: null,
  launch: null,
  launchCagri: [],
  status: 'running',
  statusHata: null,
  audit: [],
};

sahte('inventory/mssql.cjs', {
  query: async (sql) => {
    D.disSorgu++;
    if (/OBJECT_ID/.test(sql)) return { recordset: [{ oid: D.tabloVar ? 1 : null }] };
    if (/FROM dbo\.Nginx_Cis_Results/.test(sql)) return { recordset: D.results };
    if (/FROM dbo\.Nginx_Cis_Hosts/.test(sql)) return { recordset: D.hosts };
    throw new Error(`beklenmeyen dis sorgu: ${sql}`);
  },
});
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    D.portal.push({ sql, params });
    if (D.portalHata && D.portalHata.test(sql)) throw new Error('portal db hatasi');
    if (/COUNT\(\*\) FROM nginx_cis_exceptions/.test(sql))
      return {
        rows: [{ ec: D.exceptions.length + D.stampEk, oc: D.overrides.length, em: '', om: '' }],
      };
    if (/^SELECT id, item_id, host, note/.test(sql)) return { rows: D.exceptions };
    if (/^SELECT id, item_id, expected/.test(sql)) return { rows: D.overrides };
    if (/SELECT id FROM nginx_cis_exceptions/.test(sql))
      return {
        rows: D.exceptions
          .filter((e) => e.item_id === params[0] && (e.host || '') === params[1])
          .map((e) => ({ id: e.id })),
      };
    if (/SELECT id FROM nginx_cis_overrides/.test(sql))
      return {
        rows: D.overrides
          .filter((o) => o.item_id === params[0] && o.expected === params[1])
          .map((o) => ({ id: o.id })),
      };
    return { rows: [], rowCount: 1 };
  },
});
sahte('auth/index.cjs', {
  requireAuth: (req, res, next) => {
    const rol = req.headers['x-rol'];
    if (!rol) return res.status(401).json({ ok: false });
    req.session = { user: { username: 'ornek', role: rol } };
    next();
  },
});
sahte('auth/visibility.cjs', {
  requireVisiblePrefix: () => (req, res, next) => next(),
  requireVisible: () => (req, res, next) => next(),
});
const temizlikler = [];
sahte('nginx-console/eski-sunucu.cjs', {
  onTemizlik: (fn) => temizlikler.push(fn),
  suzgec: async (req) => {
    const goster = req.query.eskiler === '1';
    const gizli = new Set();
    return {
      damga: goster ? 'g' : 'e',
      ayir: (rows) =>
        goster
          ? rows
          : rows.filter((r) => {
              if (r.host !== ESKI) return true;
              gizli.add(r.host);
              return false;
            }),
      bilgi: () => ({ sayi: gizli.size, hostlar: [...gizli], gosteriliyor: goster }),
    };
  },
});
sahte('ansible/playbook-registry.cjs', {
  getByKey: async () => D.reg,
  getEffectiveTemplateId: (row) => row.templateId,
});
sahte('ansible/template-preflight.cjs', {
  assertTemplateAcceptsExtraVars: async () => {
    if (D.preflightHata) throw D.preflightHata;
  },
});
sahte('ansible/runner.cjs', {
  launchJobOnServer: async (...a) => {
    D.launchCagri.push(a);
    return D.launch;
  },
  getJobStatusOnServer: async () => {
    if (D.statusHata) throw D.statusHata;
    return { status: D.status };
  },
  getJobOutputOnServer: async () => ({ output: 'PLAY RECAP' }),
});
sahte('audit/index.cjs', { auditPortal: (req, olay, ek) => D.audit.push({ olay, ek }) });

const cis = require('../index.cjs');

let srv;
let base;
before(async () => {
  const app = express();
  cis.initNginxCis(app);
  await new Promise((r) => {
    srv = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${srv.address().port}/api/nginx-cis`;
});
after(() => srv.close());

const tara = (host, ek = {}) => ({
  host,
  nginx_version: '1.24.0',
  t_state: 'OK',
  msg: null,
  scan_date: '2026-11-20',
  scanned_at: '2026-11-20T03:15:00Z',
  ...ek,
});
const sonuc = (host, item_id, status, observed = '') => ({ host, item_id, status, observed });

beforeEach(() => {
  Object.assign(D, {
    tabloVar: true,
    disSorgu: 0,
    hosts: [tara(H1), tara(H2), tara(ESKI)],
    results: [
      sonuc(H1, '1.1.1', 'PASS'),
      sonuc(H1, '2.1.3', 'FAIL', 'on'),
      sonuc(H2, '1.1.1', 'PASS'),
      sonuc(H2, '2.1.3', 'PASS', 'off'),
      sonuc(ESKI, '1.1.1', 'FAIL'),
    ],
    exceptions: [],
    overrides: [],
    portal: [],
    portalHata: null,
    stampEk: 0,
    reg: null,
    preflightHata: null,
    launch: null,
    launchCagri: [],
    status: 'running',
    statusHata: null,
    audit: [],
  });
  for (const fn of temizlikler) fn();
});

async function istek(yol, { rol = 'Admin', method = 'GET', body } = {}) {
  const r = await fetch(base + yol, {
    method,
    headers: { 'x-rol': rol, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

test('NC1 yetki: Admin olmayan yalniz okur, yazamaz ve tarama tetikleyemez', async () => {
  assert.equal((await istek('/overview', { rol: 'User' })).status, 200);
  assert.equal((await istek(`/host/${H1}`, { rol: 'User' })).status, 200);
  for (const [yol, method, body] of [
    ['/exceptions', 'PUT', { itemId: '1.1.1', note: 'n' }],
    ['/exceptions/1', 'DELETE'],
    ['/overrides', 'PUT', { itemId: '2.1.3', expected: 'on' }],
    ['/overrides/1', 'DELETE'],
    ['/rescan', 'POST', {}],
    ['/job-status/1/2', 'GET'],
  ]) {
    const r = await istek(yol, { rol: 'User', method, body });
    assert.equal(r.status, 403, `${method} ${yol}`);
    assert.equal(r.body.message, 'CIS denetimi yalnız Admin.');
  }
  assert.equal((await fetch(`${base}/overview`)).status, 401);
  assert.equal(D.launchCagri.length, 0);
});

test('NC2 /overview: tablo yoksa acik mesaj; varsa skor, eski sunucu dusurulur', async () => {
  D.tabloVar = false;
  let r = await istek('/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.tableMissing, true);
  assert.match(r.body.message, /nginx_cis job'ı bir kez koşmalı/);
  assert.equal(r.body.catalog.length > 0, true);

  D.tabloVar = true;
  for (const fn of temizlikler) fn();
  D.exceptions = [{ id: 1, item_id: '2.1.3', host: null, note: 'kurum gzip acik' }];
  r = await istek('/overview?fresh=1');
  assert.equal(r.body.tableMissing, false);
  const adlar = r.body.hosts.map((h) => h.host).sort();
  assert.deepEqual(adlar, [H1, H2]);
  assert.deepEqual(r.body.eskiGizli.hostlar, [ESKI]);
  const h1 = r.body.hosts.find((h) => h.host === H1);
  assert.equal(h1.excepted, 1);
  assert.equal(h1.failed, 0);
  assert.equal(h1.scannedAt, '2026-11-20T03:15:00.000Z');
  assert.equal(r.body.exceptions.length, 1);
  // Eski sunucular istenirse gorunur.
  r = await istek('/overview?eskiler=1');
  assert.deepEqual(r.body.hosts.map((h) => h.host).sort(), [H1, H2, ESKI]);
});

test('NC3 onbellek: ayni damgada dis DB tekrar okunmaz; fresh ve kural degisimi okur', async () => {
  await istek(`/host/${H1}`);
  const ilk = D.disSorgu;
  assert.ok(ilk >= 3);
  await istek(`/host/${H2}`);
  assert.equal(D.disSorgu, ilk, 'ayni damgada yeniden okundu');
  await istek(`/host/${H2}?fresh=1`);
  assert.equal(D.disSorgu, ilk * 2);
  D.stampEk = 1; // baska bir surec istisna ekledi
  await istek(`/host/${H1}`);
  assert.equal(D.disSorgu, ilk * 3);
  // Suzgecli (Nginx Hub) ve suzgecsiz (Server Hub) onbellek ayri yuvada.
  await istek('/overview');
  const sonra = D.disSorgu;
  await istek('/overview');
  await istek(`/host/${H1}`);
  assert.equal(D.disSorgu, sonra);
  // Kural damgasi okunamazsa da cevap verilir.
  D.portalHata = /COUNT\(\*\)/;
  assert.equal((await istek(`/host/${H1}`)).status, 200);
});

test('NC4 /host/:h: gecersiz ad 400, taranmamis 404, taranmis ayrinti', async () => {
  assert.equal((await istek('/host/-kotu')).status, 400);
  const yok = await istek('/host/ornxyz01');
  assert.equal(yok.status, 404);
  assert.match(yok.body.message, /ORNXYZ01 için CIS taraması yok/);
  const r = await istek(`/host/${H1.toLowerCase()}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.host.host, H1);
  assert.equal(r.body.host.failed, 1);
  assert.ok(Array.isArray(r.body.host.items));
});

test('NC5 istisna: dogrulama, ekle, guncelle, sil', async () => {
  const kotu = [
    [{ itemId: '9.9.9', note: 'n' }, /Bilinmeyen CIS maddesi/],
    [{ itemId: '*', note: 'n' }, /sunucu adı zorunlu/],
    [{ itemId: '1.1.1', host: 'x', note: 'n' }, /Geçersiz sunucu adı/],
    [{ itemId: '1.1.1', note: '   ' }, /Not zorunlu/],
  ];
  for (const [body, re] of kotu) {
    const r = await istek('/exceptions', { method: 'PUT', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, re);
  }
  let r = await istek('/exceptions', {
    method: 'PUT',
    body: { itemId: '*', host: H1.toLowerCase(), note: '  devreden cikiyor ' },
  });
  assert.equal(r.status, 200);
  const ins = D.portal.find((q) => /INSERT INTO nginx_cis_exceptions/.test(q.sql));
  assert.deepEqual(ins.params, ['*', H1, 'devreden cikiyor', 'ornek']);
  assert.equal(D.audit[0].olay, 'nginx_cis_exception_set');

  D.exceptions = [{ id: 7, item_id: '2.1.3', host: null, note: 'eski' }];
  D.portal = [];
  r = await istek('/exceptions', { method: 'PUT', body: { itemId: '2.1.3', note: 'yeni not' } });
  assert.equal(r.status, 200);
  const upd = D.portal.find((q) => /UPDATE nginx_cis_exceptions/.test(q.sql));
  assert.deepEqual(upd.params, [7, 'yeni not', 'ornek']);
  assert.ok(!D.portal.some((q) => /INSERT INTO nginx_cis_exceptions/.test(q.sql)));

  assert.equal((await istek('/exceptions/0', { method: 'DELETE' })).status, 400);
  assert.equal((await istek('/exceptions/abc', { method: 'DELETE' })).status, 400);
  r = await istek('/exceptions/7', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(D.portal.at(-1).params, [7]);
  D.portalHata = /DELETE FROM nginx_cis_exceptions/;
  r = await istek('/exceptions/7', { method: 'DELETE' });
  assert.equal(r.status, 500);
  D.portalHata = /SELECT id FROM nginx_cis_exceptions/;
  r = await istek('/exceptions', { method: 'PUT', body: { itemId: '2.1.3', note: 'n' } });
  assert.equal(r.status, 500);
});

test('NC6 referans: dogrulama, ayni deger guncellenir, yeni deger eklenir, sil', async () => {
  let r = await istek('/overrides', { method: 'PUT', body: { itemId: '9.9.9', expected: 'x' } });
  assert.equal(r.status, 400);
  r = await istek('/overrides', { method: 'PUT', body: { itemId: '2.1.3', expected: ' ' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Beklenen değer zorunlu/);

  D.overrides = [{ id: 3, item_id: '2.1.3', expected: 'on', note: '' }];
  r = await istek('/overrides', {
    method: 'PUT',
    body: { itemId: '2.1.3', expected: 'on', note: 'kurum karari' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(D.portal.find((q) => /UPDATE nginx_cis_overrides/.test(q.sql)).params, [
    3,
    'kurum karari',
    'ornek',
  ]);
  r = await istek('/overrides', { method: 'PUT', body: { itemId: '2.1.3', expected: 'static' } });
  assert.equal(r.status, 200);
  assert.deepEqual(D.portal.find((q) => /INSERT INTO nginx_cis_overrides/.test(q.sql)).params, [
    '2.1.3',
    'static',
    '',
    'ornek',
  ]);
  assert.equal(D.audit.at(-1).olay, 'nginx_cis_override_set');
  // Referans skora yansir: H1'in 'on' degeri kabul edilen degerle gecer.
  r = await istek(`/host/${H1}?fresh=1`);
  assert.equal(r.body.host.failed, 0);

  assert.equal((await istek('/overrides/-1', { method: 'DELETE' })).status, 400);
  assert.equal((await istek('/overrides/3', { method: 'DELETE' })).status, 200);
  D.portalHata = /DELETE FROM nginx_cis_overrides/;
  assert.equal((await istek('/overrides/3', { method: 'DELETE' })).status, 500);
  D.portalHata = /SELECT id FROM nginx_cis_overrides/;
  r = await istek('/overrides', { method: 'PUT', body: { itemId: '2.1.3', expected: 'on' } });
  assert.equal(r.status, 500);
});

test('NC7 rescan: kayit yok 501, preflight reddi, tetik ve is gecmisi', async (t) => {
  let r = await istek('/rescan', { method: 'POST', body: {} });
  assert.equal(r.status, 501);
  assert.match(r.body.message, /nginx_cis_scan/);
  D.reg = { templateId: 41, awxServerId: 2, enabled: false };
  assert.equal((await istek('/rescan', { method: 'POST', body: {} })).status, 501);

  D.reg = { templateId: 41, awxServerId: 2 };
  D.preflightHata = Object.assign(new Error('Prompt on launch kapali'), { status: 409 });
  r = await istek('/rescan', { method: 'POST', body: { hosts: [H1] } });
  assert.equal(r.status, 409);
  assert.equal(D.launchCagri.length, 0);

  D.preflightHata = null;
  D.launch = { jobId: 901, status: 'pending' };
  r = await istek('/rescan', {
    method: 'POST',
    body: { hosts: [H1.toLowerCase(), ' bad host ', H2] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    ok: true,
    jobId: 901,
    status: 'pending',
    awxServerId: 2,
    hosts: [H1, H2],
  });
  assert.deepEqual(D.launchCagri[0].slice(0, 3), [2, 41, { target_hosts: `${H1},${H2}` }]);
  const gecmis = D.portal.find((q) => /INSERT INTO ansible_job_history/.test(q.sql));
  assert.equal(gecmis.params[3], `Nginx CIS: ${H1},${H2}`);

  // Bos liste tum filo; gecmis yazilamazsa da tetik basarili doner.
  const uyari = t.mock.method(console, 'warn', () => {});
  D.portalHata = /INSERT INTO ansible_job_history/;
  D.reg = { templateId: 41, awxServerId: null };
  D.launch = null;
  r = await istek('/rescan', { method: 'POST', body: { hosts: 'hepsi' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.jobId, null);
  assert.equal(r.body.awxServerId, 0);
  assert.deepEqual(D.launchCagri.at(-1)[2], {});
  assert.equal(uyari.mock.callCount(), 1);
});

test('NC8 job-status: gecersiz numara 400, terminal durumda onbellek duser, hata 500', async () => {
  assert.equal((await istek('/job-status/x/1')).status, 400);
  assert.equal((await istek('/job-status/1/0')).status, 400);
  await istek(`/host/${H1}`);
  const ilk = D.disSorgu;
  let r = await istek('/job-status/2/901');
  assert.deepEqual(r.body, { ok: true, status: 'running', output: 'PLAY RECAP' });
  await istek(`/host/${H1}`);
  assert.equal(D.disSorgu, ilk, 'kosan is onbellegi dusurmemeli');
  D.status = 'successful';
  await istek('/job-status/2/901');
  await istek(`/host/${H1}`);
  assert.equal(D.disSorgu, ilk * 2, 'biten is onbellegi dusurmeli');
  D.statusHata = new Error('AWX yanit vermedi');
  r = await istek('/job-status/2/901');
  assert.equal(r.status, 500);
  assert.equal(r.body.message, 'AWX yanit vermedi');
});
