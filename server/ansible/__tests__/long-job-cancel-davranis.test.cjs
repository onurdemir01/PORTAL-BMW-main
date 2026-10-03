// server/ansible/__tests__/long-job-cancel-davranis.test.cjs
//
// URETIM OLAYI (2026-10-03, kullanici): "Belirledigim surede bitmeyen, izin listesindeki
// job'lar kesilmiyor; gelistirme tamamlandi diye rapor yazdim." 20 Eylul logunda 8 x
// `POST /api/v2/jobs/N/cancel/ -> 403`; basarisizlik YALNIZ console.warn'a gidiyordu.
//
// Bu dosyadaki testler KAYNAK METNI degil DAVRANISI olcer: gercek runner.cjs
// (listLongJobCandidatesAcrossServers, cancelJobOnServer, getTemplateCapabilitiesOnServer,
// awxRequestToServer + AAP esleme) yerel bir SAHTE AWX'e, gercek Teams gonderimi yerel bir
// SAHTE webhook'a konusur. Denetim ve DB enjekte edilir.
//
//   LJ1  403 -> Teams "IPTAL EDILEMEDI" + denetim fail + durum kirmizi; tekrar denenmez
//   LJ2  workflow job listelenir ve iptal /api/v2/workflow_jobs/<id>/cancel/ ucuna gider
//   LJ3  en eski once + TUM sayfalar: ikinci sayfadaki eski is bulunur; ust sinir uyarisi
//   LJ4  iptal 202 ama is durmadi -> 2 tarama sonra alarm (Teams + denetim + durum)
//   LJ5  tarama eksikken _done SILINMEZ (bilinmiyor); is gercekten bitince silinir
//   LJ6  DB okunamazsa son gecerli yapilandirma; hic yoksa kapali + "okunamadi"
//   LJ7  kuru calistirma HICBIR iptal istegi gondermez (statik token: hic POST yok), durum
//        makinesine dokunmaz (fonksiyon + uc); kullanici/sifreli kurulum LJ28'de
//   LJ8  yetki on kontrolu: edit=false -> EDEMEZ; okunamazsa OLCULEMEDI (yok DEGIL)
//   LJ9  kuyruk secenegi kapaliyken pending iptal edilmez, acikken created'a gore edilir
//   LJ10 uclar yalniz Admin: requireAdmin reddederse AWX'e de DB'ye de gidilmez
//   LJ11 sirlar (token) durum/denetim/Teams/HTTP yanitina SIZMAZ
//   LJ12 gecici hata 3 deneme; son denemede tek Teams karti
//   LJ13 watcher: ust uste binen tick atlanir; kapali/bos listede AWX'e hic gidilmez
//   LJ14 AAP 2.5 api tabani: tarama/sayfalama/iptal/yetki onekli yoldan (awxRequestToServer)
//
// DOGRULAYICI TURU (2026-10-03) — sahte AWX GERCEK iptal semantigiyle (awx/api/permissions.py
// + access.py JobAccess.can_cancel): superuser OLMAYAN kullanici BITMIS ise 403 alir, 405
// yalniz superuser'a doner; is detayi GET /api/v2/{jobs|workflow_jobs}/<id>/.
//   LJ15 tarama->is biter->POST yarisi ve iki Portal ornegi: 403 "zaten bitmis" sayilir, alarm YOK
//   LJ16 tarama sagligi: AWX taranamazsa (401) 3 tick sonra TEK kart + denetim fail; duzelince kayit
//   LJ17 405 dogrulamasiz kabul edilmez: vekil 405'i + is aktif -> IPTAL EDILEMEDI; durum okunamazsa
//        "zaten bitmis" kaydi da dogrulanir (hala aktifse alarm)
//   LJ18 ofset sayfa kaymasi: "listede yok" is durumu okunmadan "bitti" SAYILMAZ; kendiliginden
//        biten is "iptal edildi" gorunmez; durum okunamazsa kayit korunur
//   LJ19 Kaydet (writeConfig) sonrasi 403 almis is YENIDEN denenir
//   LJ20 otomatik iptal kapatilsa da (webhooksuz) bekleyen dogrulama/alarm surer
//   LJ21 sunucu son tarihi ve beklenmedik tarama hatasi listeyi TAM saydirmaz
//   LJ22 taranamayan sunucuda _failed korunur ve o sunucuya durum istegi yagdirilmaz
//   LJ23 kuru calistirma iptal edilemeyen isi "iptal edilirdi" GOSTERMEZ
//   LJ24 30 dk bildirimi: tarama hatasinda ayni is yeniden bildirilmez
//   LJ25 sayfalar arasi tekrar ayiklanir
//   LJ26 403 ipucu tek nedene baglanmaz (Portal'in kendi isi -> token kapsami); ortak mesajda
//        Admin ipucu yok; statik token'da "Admin" rozeti token kapsamini "olculemedi" der
//   LJ27 workflow iptali alt isleri de keser: kart/denetim/durum bunu soyler
//   LJ28 kullanici/sifreli AWX: kuru calistirma /cancel/'a SIFIR POST; token kapsami 'write'
//   LJ29 tarama hic bitmiyorsa (in-flight) tek Teams karti + denetim fail
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TOKEN = 'SIR-TOKEN-7f3a9c2e51';

// Gelistirici ortamindan sizabilecek AWX/vekil degiskenleri testi baska yere goturmesin.
for (const k of Object.keys(process.env)) {
  if (/^AWX_/.test(k) || /^(HTTPS?_PROXY|https?_proxy)$/.test(k)) delete process.env[k];
}
delete process.env.TEAMS_LONGJOB_THRESHOLD_MINUTES;
delete process.env.TEAMS_LONGJOB_POLL_INTERVAL_SECONDS;

const ACTIVE = ['new', 'pending', 'waiting', 'running'];
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
// Turkce harfleri ASCII'ye katlar: kart metni bicimden bagimsiz karsilastirilir.
const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/’/g, "'");

// ── SAHTE AWX ────────────────────────────────────────────────────────────────
const awx = {
  srv: null,
  port: 0,
  // id -> { id, kind, status, started, created, tpl, tplName, cancel, createdBy, parentWf }
  // cancel: 'ok' | '403' (is aktif, yetki yok) | '500' | 'ignore' (202 ama durmaz) | 'proxy405'
  jobs: new Map(),
  templates: new Map(), // `${kind}:${id}` -> { name, caps }
  pageSize: 2,
  istekler: [],
  listFail: false, // liste uclari 500
  listStatus: 0, // liste uclari bu HTTP koduyla reddedilir (or. 401)
  listFailKind: null, // yalniz bu turun listesi basarisiz ('job' | 'workflow')
  stateFail: false, // is detayi (GET .../<id>/) 500
  detail404: new Set(), // bu id'lerin detayi 404 (gateway/yol tuhafligi kurgusu)
  superuser: false, // Portal AWX kullanicisi superuser mi (405 yalniz ona)
  me: 'portal_svc', // GET /api/v2/me/
  onListPage: null, // (kind, page) => void : sayfa sunulmadan once (kayma kurgusu)
  gate: null, // Promise: cozulene kadar tum istekler bekler (tarama-bitmiyor kurgusu)
  echoAuth: false,
  delayMs: 0,
  prefix: '', // AAP 2.5: '/api/controller/v2'
};

function awxSifirla() {
  awx.jobs.clear();
  awx.templates.clear();
  awx.pageSize = 2;
  awx.istekler.length = 0;
  awx.listFail = false;
  awx.listStatus = 0;
  awx.listFailKind = null;
  awx.stateFail = false;
  awx.detail404.clear();
  awx.superuser = false;
  awx.me = 'portal_svc';
  awx.onListPage = null;
  awx.gate = null;
  awx.echoAuth = false;
  awx.delayMs = 0;
  awx.prefix = '';
}

function isEkle(j) {
  awx.jobs.set(j.id, { kind: 'job', status: 'running', created: j.started || ago(1), cancel: 'ok', tplName: `tpl-${j.tpl}`, ...j });
}

function siralama(order) {
  const fields = order.filter(Boolean);
  return (a, b) => {
    for (const f of fields) {
      const desc = f.startsWith('-');
      const k = desc ? f.slice(1) : f;
      const va = a[k] ?? null;
      const vb = b[k] ?? null;
      if (va === vb) continue;
      // PostgreSQL: ASC'de NULL sonda, DESC'de basta.
      if (va === null) return desc ? -1 : 1;
      if (vb === null) return desc ? 1 : -1;
      const c = va < vb ? -1 : 1;
      return desc ? -c : c;
    }
    return 0;
  };
}

function awxJson(j) {
  const tplField = j.kind === 'workflow' ? 'workflow_job_template' : 'job_template';
  return {
    id: j.id,
    name: j.tplName,
    status: j.status,
    started: j.started || null,
    created: j.created || null,
    [tplField]: j.tpl,
    summary_fields: {
      [tplField]: { id: j.tpl, name: j.tplName },
      created_by: { username: j.createdBy || 'ayse' },
      ...(j.parentWf ? { source_workflow_job: { id: j.parentWf, name: 'ust-wf' } } : {}),
    },
  };
}

function awxIstegi(req, res) {
  const u = new URL(req.url, 'http://x');
  awx.istekler.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams) });
  // AAP 2.5: API yalniz gateway onekinin altinda; /api/v2 404 doner.
  let yol = u.pathname;
  if (awx.prefix) {
    if (!yol.startsWith(awx.prefix + '/')) return void (res.writeHead(404), res.end('{}'));
    yol = '/api/v2' + yol.slice(awx.prefix.length);
  }
  const v2 = (x) => (awx.prefix ? x.replace(/^\/api\/v2/, awx.prefix) : x);
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  // Kullanici/sifreli kurulum: Portal token'i Basic auth ile kendisi alir (fetchTokenV2).
  if (req.method === 'POST' && yol === '/api/v2/tokens/') {
    const basic = 'Basic ' + Buffer.from('portal_svc:gizli-sifre-123').toString('base64');
    if (req.headers.authorization !== basic) return send(401, { detail: 'Invalid username/password.' });
    return send(201, { token: TOKEN, expires: new Date(Date.now() + 3600e3).toISOString() });
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { detail: 'Authentication credentials were not provided.' });
  let m;
  if (req.method === 'GET' && yol === '/api/v2/me/') return send(200, { count: 1, results: [{ id: 9, username: awx.me }] });
  if (req.method === 'GET' && (m = yol.match(/^\/api\/v2\/(jobs|workflow_jobs)\/$/))) {
    const kind = m[1] === 'jobs' ? 'job' : 'workflow';
    if (awx.listStatus) return send(awx.listStatus, { detail: 'Invalid token.' });
    if (awx.listFail || awx.listFailKind === kind) return send(500, { detail: 'veritabani gecici olarak yok' });
    if (awx.onListPage) awx.onListPage(kind, Number(u.searchParams.get('page') || 1));
    const st = (u.searchParams.get('status__in') || u.searchParams.get('status') || '').split(',').filter(Boolean);
    const rows = [...awx.jobs.values()]
      .filter((j) => j.kind === kind && (!st.length || st.includes(j.status)))
      .sort(siralama((u.searchParams.get('order_by') || 'id').split(',')));
    const page = Number(u.searchParams.get('page') || 1);
    const ps = awx.pageSize;
    const nq = new URLSearchParams(u.searchParams);
    nq.set('page', String(page + 1));
    // job listesi GORELI, workflow listesi MUTLAK `next` doner (AWX ikisini de yapabilir).
    const next =
      page * ps < rows.length
        ? kind === 'job'
          ? v2(`/api/v2/jobs/?${nq}`)
          : `http://127.0.0.1:${awx.port}${v2(`/api/v2/workflow_jobs/?${nq}`)}`
        : null;
    return send(200, { count: rows.length, next, results: rows.slice((page - 1) * ps, page * ps).map(awxJson) });
  }
  if (req.method === 'GET' && (m = yol.match(/^\/api\/v2\/(jobs|workflow_jobs)\/(\d+)\/$/))) {
    const kind = m[1] === 'jobs' ? 'job' : 'workflow';
    if (awx.stateFail) return send(500, { detail: 'is detayi gecici olarak okunamiyor' });
    const j = awx.jobs.get(Number(m[2]));
    if (!j || j.kind !== kind || awx.detail404.has(j.id)) return send(404, { detail: 'Not found.' });
    return send(200, awxJson(j));
  }
  if (req.method === 'POST' && (m = yol.match(/^\/api\/v2\/(jobs|workflow_jobs)\/(\d+)\/cancel\/$/))) {
    const kind = m[1] === 'jobs' ? 'job' : 'workflow';
    const j = awx.jobs.get(Number(m[2]));
    if (!j || j.kind !== kind) return send(404, { detail: 'Not found.' });
    // Araya giren vekil/WAF: POST'u AWX'e iletmeden 405 doner (is durumundan bagimsiz).
    if (j.cancel === 'proxy405') return send(405, { detail: 'Method Not Allowed (proxy)' });
    const denied = () =>
      send(403, {
        detail: 'You do not have permission to perform this action.' + (awx.echoAuth ? ` (got ${req.headers.authorization})` : ''),
      });
    // GERCEK AWX: superuser her zaman gecer; degilse JobAccess.can_cancel ilk satiri
    // `if not obj.can_cancel: return False` -> BITMIS ise 403 (405 DEGIL).
    if (!awx.superuser && (!ACTIVE.includes(j.status) || j.cancel === '403')) return denied();
    if (j.cancel === '500') return send(500, { detail: 'gecici AWX hatasi' });
    // GenericCancelView.post: superuser + bitmis is -> 405
    if (!ACTIVE.includes(j.status)) return send(405, { detail: 'Method "POST" not allowed.' });
    if (j.cancel !== 'ignore') j.status = 'canceled';
    return send(202);
  }
  if (req.method === 'GET' && (m = yol.match(/^\/api\/v2\/(job_templates|workflow_job_templates)\/(\d+)\/$/))) {
    const kind = m[1] === 'job_templates' ? 'job' : 'workflow';
    const t = awx.templates.get(`${kind}:${m[2]}`);
    if (!t) return send(404, { detail: 'Not found.' });
    if (t.caps === 'error') return send(500, { detail: 'gecici AWX hatasi' });
    return send(200, { id: Number(m[2]), name: t.name, summary_fields: t.caps === null ? {} : { user_capabilities: t.caps } });
  }
  return send(404, { detail: 'Not found.' });
}

// ── SAHTE TEAMS ──────────────────────────────────────────────────────────────
const teams = { srv: null, url: '', kartlar: [] };
const kartBaslik = (k) => k?.attachments?.[0]?.content?.body?.[0]?.items?.[0]?.text || '';
const basarisizKartlar = () => teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
const durmadiKartlar = () => teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL ISTENDI AMA IS DURMADI'));
const iptalKartlari = () => teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('Portal tarafindan iptal edildi'));
const taramaKartlari = () => teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('OTOMATIK IPTAL CALISMIYOR'));

before(async () => {
  awx.srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const run = () => (awx.delayMs ? setTimeout(() => awxIstegi(req, res), awx.delayMs) : awxIstegi(req, res));
      if (awx.gate) awx.gate.then(run);
      else run();
    });
  });
  await new Promise((r) => awx.srv.listen(0, '127.0.0.1', r));
  awx.port = awx.srv.address().port;
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.port}`;
  process.env.AWX_1_TOKEN = TOKEN;
  process.env.AWX_1_NAME = 'maestro-test';

  teams.srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        teams.kartlar.push(JSON.parse(b));
      } catch {
        teams.kartlar.push({ ham: b });
      }
      res.writeHead(200);
      res.end('1');
    });
  });
  await new Promise((r) => teams.srv.listen(0, '127.0.0.1', r));
  teams.url = `http://127.0.0.1:${teams.srv.address().port}/webhook`;
});

after(async () => {
  await new Promise((r) => awx.srv.close(r));
  await new Promise((r) => teams.srv.close(r));
});

const runner = require('../runner.cjs');
const ljc = require('../long-job-cancel.cjs');
const watcher = require('../long-job-watcher.cjs');

const CFG = (over = {}) => ({
  enabled: true,
  thresholdMinutes: 60,
  templates: [{ serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit' }],
  ...over,
});
function dbOf(cfg) {
  const d = { sorgular: 0 };
  d.query = async (sql) => {
    d.sorgular++;
    if (/SELECT data/.test(sql)) return { rows: [{ data: JSON.stringify(cfg) }] };
    return { rows: [] };
  };
  return d;
}
const brokenDb = {
  query: async () => {
    throw new Error('ConnectionError: Failed to connect to MSSQL TBMWPRT:1433');
  },
};
let audits = [];
const audit = (action, opts) => audits.push({ action, ...opts });
const posts = () => awx.istekler.filter((r) => r.method === 'POST');

async function cycle(db, extra = {}) {
  const scan = await runner.listLongJobCandidatesAcrossServers(extra.scanOpts || {});
  return ljc.runCycle(scan, { db, runner, webhookUrl: teams.url, audit, ...extra });
}

beforeEach(() => {
  awxSifirla();
  ljc._reset();
  teams.kartlar.length = 0;
  audits = [];
  delete process.env.TEAMS_LONGJOB_WEBHOOK_URL;
});

// ── LJ1 ──────────────────────────────────────────────────────────────────────
test('LJ1 403: Teams IPTAL EDILEMEDI karti + denetim fail + durum kirmizi; ikinci tick tekrar DENEMEZ', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  process.env.TEAMS_LONGJOB_WEBHOOK_URL = teams.url;
  isEkle({ id: 700, tpl: 42, tplName: 'nginx_config_audit', started: ago(120), cancel: '403' });
  const db = dbOf(CFG());

  await watcher.tick({ db, runner, audit });

  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/700/cancel/']);
  const kart = basarisizKartlar();
  assert.equal(kart.length, 1, 'IPTAL EDILEMEDI karti gitmedi — basarisizlik yine SESSIZ');
  const metin = fold(JSON.stringify(kart[0]));
  assert.match(metin, /CALISMAYA DEVAM EDIYOR/);
  assert.match(metin, /Ne yapilmali/);
  assert.match(metin, /Admin rolu/, 'ne yapilmali: Portal AWX kullanicisina template Admin rolu');
  assert.match(metin, /#700/);

  const fails = audits.filter((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail');
  assert.equal(fails.length, 1, 'denetimde fail kaydi yok');
  assert.equal(JSON.parse(fails[0].detail).httpStatus, 403);
  assert.equal(audits.filter((a) => a.result === 'ok').length, 0, 'basarisiz iptal ok diye denetlendi');

  const st = ljc.getStatus();
  const row = st.lastTick.jobs.find((j) => j.jobId === 700);
  assert.equal(row.decision, 'cancel_failed');
  assert.equal(row.problem, true, 'IPTAL EDILEMEDI satiri kirmizi isaretlenmiyor');
  assert.match(fold(row.reason), /IPTAL EDILEMEDI \(AWX 403\)/);
  assert.equal(st.attempts[0].outcome, 'failed');
  assert.equal(st.attempts[0].teams, 'gonderildi');
  assert.equal(st.lastTick.servers[0].ok, true, 'sunucu tarandi bilgisi yok');

  // ikinci tick: kalici red tekrar denenmez, ikinci kart gitmez, satir hala kirmizi
  await watcher.tick({ db, runner, audit });
  assert.equal(posts().length, 1, 'kalici 403 tekrar denendi');
  assert.equal(basarisizKartlar().length, 1, 'ayni basarisizlik icin ikinci kart');
  assert.equal(ljc.getStatus().lastTick.jobs.find((j) => j.jobId === 700).decision, 'cancel_failed');
});

// ── LJ2 ──────────────────────────────────────────────────────────────────────
test('LJ2 workflow job listelenir ve iptal /api/v2/workflow_jobs/<id>/cancel/ ucuna gider; tur eslesmesi zorunlu', async (t) => {
  t.mock.method(console, 'warn', () => {});
  isEkle({ id: 800, kind: 'workflow', tpl: 55, tplName: 'gece_bakim_wf', started: ago(120) });
  isEkle({ id: 801, kind: 'job', tpl: 55, tplName: 'baska_job_tpl', started: ago(120) }); // ayni id, JOB template
  const db = dbOf(CFG({ templates: [{ serverId: 1, templateId: 55, kind: 'workflow', name: 'gece_bakim_wf' }] }));

  const s = await cycle(db);

  assert.ok(awx.istekler.some((r) => r.method === 'GET' && r.path === '/api/v2/workflow_jobs/'), 'workflow job listesi hic istenmedi');
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/workflow_jobs/800/cancel/'], 'workflow iptali yanlis uca gitti');
  assert.equal(awx.jobs.get(800).status, 'canceled');
  assert.equal(awx.jobs.get(801).status, 'running', 'ayni id li JOB template i workflow izni ile iptal edildi');
  const wf = s.jobs.find((j) => j.jobId === 800);
  assert.equal(wf.kind, 'workflow');
  assert.equal(wf.decision, 'cancel_requested');
  assert.equal(s.jobs.find((j) => j.jobId === 801).decision, 'not_listed');
  assert.match(wf.url, /#\/jobs\/workflow\/800\/output$/);
});

// ── LJ3 ──────────────────────────────────────────────────────────────────────
test('LJ3 en eski once + TUM sayfalar: ikinci sayfadaki izinli eski is bulunur; ust sinirda uyari', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  // sayfa boyu 2. Eski (en eski once) sirada: 901, 902 | 900, 903 | 904
  // Eski kod (TEK sayfa, EN YENI once) 904, 903'u gorur, 900'u HIC gormezdi.
  isEkle({ id: 901, tpl: 99, started: ago(300) });
  isEkle({ id: 902, tpl: 99, started: ago(200) });
  isEkle({ id: 900, tpl: 42, started: ago(120) });
  isEkle({ id: 903, tpl: 99, started: ago(10) });
  isEkle({ id: 904, tpl: 99, started: ago(5) });
  const db = dbOf(CFG());

  const s = await cycle(db);

  const listeler = awx.istekler.filter((r) => r.method === 'GET' && r.path === '/api/v2/jobs/');
  assert.match(listeler[0].query.order_by, /^started/, `en eski once degil: ${listeler[0].query.order_by}`);
  assert.ok(listeler.some((r) => r.query.page === '2'), 'ikinci sayfa istenmedi');
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/900/cancel/'], 'ikinci sayfadaki izinli eski is iptal edilmedi');
  assert.equal(s.jobsTotal, 5, 'tum sayfalar okunmadi');
  assert.equal(s.servers[0].kinds.job.pages, 3);
  assert.equal(s.servers[0].truncated, false);

  // ust sinir: 1 sayfada kesilirse SESSIZ DEGIL — sunucu satirinda uyari
  awx.istekler.length = 0;
  ljc._reset();
  const kirpik = await runner.listLongJobCandidatesAcrossServers({ maxPages: 1 });
  assert.equal(kirpik.servers[0].truncated, true);
  assert.equal(kirpik.servers[0].complete.job, false, 'kirpik liste TAM sayildi');
  assert.match(fold(kirpik.servers[0].error), /kesildi/);
});

// ── LJ4 ──────────────────────────────────────────────────────────────────────
test('LJ4 iptal 202 ama is durmadi: 2 tarama sonra TEK alarm (Teams + denetim + durum); is bitince kayit temizlenir', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  isEkle({ id: 1000, tpl: 42, started: ago(120), cancel: 'ignore' });
  const db = dbOf(CFG());

  let s = await cycle(db); // POST, 202
  assert.equal(s.jobs[0].decision, 'cancel_requested');
  assert.equal(teams.kartlar.length, 1, 'iptal karti');
  s = await cycle(db); // hala running (1)
  assert.equal(durmadiKartlar().length, 0, 'erken alarm');
  s = await cycle(db); // hala running (2) -> alarm
  assert.equal(durmadiKartlar().length, 1, 'iptal istendi ama durmadi alarmi gitmedi');
  assert.match(fold(JSON.stringify(durmadiKartlar()[0])), /CALISMAYA DEVAM EDIYOR/);
  const row = s.jobs.find((j) => j.jobId === 1000);
  assert.equal(row.decision, 'still_running');
  assert.equal(row.problem, true);
  const vf = audits.filter((a) => a.result === 'fail' && JSON.parse(a.detail).phase === 'verify');
  assert.equal(vf.length, 1, 'durmadi alarmi denetime fail yazilmadi');
  assert.equal(ljc.getStatus().open.stillRunning, 1);

  await cycle(db); // alarm tekrar ETMEZ, iptal tekrar DENENMEZ
  assert.equal(durmadiKartlar().length, 1);
  assert.equal(posts().length, 1, 'durmayan is icin iptal tekrar gonderildi');

  awx.jobs.get(1000).status = 'canceled'; // sonunda durdu
  s = await cycle(db);
  assert.equal(ljc.getStatus().open.stillRunning, 0, '_done is bitince temizlenmedi');
  assert.equal(ljc.hasOpenWork(), false);
  assert.equal(s.attempts.at(-1).outcome, 'stopped');
});

// ── LJ5 ──────────────────────────────────────────────────────────────────────
test('LJ5 tarama eksikken _done SILINMEZ (bilinmiyor != bitti); tarama geri gelince is bitmisse silinir', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  isEkle({ id: 1100, tpl: 42, started: ago(120), cancel: 'ignore' });
  const db = dbOf(CFG());

  await cycle(db);
  assert.equal(ljc.hasOpenWork(), true);
  awx.listFail = true; // AWX listesi 500
  const s = await cycle(db);
  assert.equal(s.servers[0].ok, false, 'taranamayan sunucu ok gorundu');
  assert.match(fold(s.servers[0].error), /alinamadi/);
  assert.equal(ljc.hasOpenWork(), true, 'tarama hatasi "is bitti" sayildi — dogrulama kayboldu');
  assert.equal(ljc.getStatus().attempts.filter((a) => a.outcome === 'stopped').length, 0);

  awx.listFail = false;
  awx.jobs.get(1100).status = 'canceled';
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), false);
  assert.equal(ljc.getStatus().attempts[0].outcome, 'stopped');
});

// ── LJ6 ──────────────────────────────────────────────────────────────────────
test('LJ6 DB okunamazsa son gecerli yapilandirmayla devam eder; hic yoksa KAPALI + "okunamadi" (sessiz degil)', async (t) => {
  const errs = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  // Son gecerli durum GERCEK bir turla kurulur: tur hem yapilandirmayi hem iptal token
  // kaydini okur (ikisi de son gecerli kayitla devam eder). Token kaydi bu surecte HIC
  // okunamadiysa iptal denenmez ("olculemedi" != "token yok"): long-job-cancel-token TK18.
  await cycle(dbOf(CFG())); // son gecerli (henuz is yok)
  isEkle({ id: 1200, tpl: 42, started: ago(120) });
  ljc._expireCache();
  const s = await cycle(brokenDb);
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/1200/cancel/'], 'DB hatasinda otomatik iptal sessizce kapandi');
  assert.match(s.configError.message, /Failed to connect/);
  assert.equal(s.usingLastGoodConfig, true);
  assert.ok(
    errs.mock.calls.some((c) => /yapilandirma okunamadi/.test(String(c.arguments[0]))),
    'console.error yazilmadi',
  );

  // hic gecerli yapilandirma yok -> kapali, ama durum "okunamadi" der
  ljc._reset();
  awxSifirla();
  isEkle({ id: 1201, tpl: 42, started: ago(120) });
  const s2 = await cycle(brokenDb);
  assert.equal(posts().length, 0);
  assert.equal(s2.jobs[0].decision, 'disabled');
  assert.ok(s2.configError, 'yapilandirma okunamadi bilgisi durumda yok');
  assert.equal(s2.usingLastGoodConfig, false);
  assert.ok(ljc.getStatus().configError);

  // watcher seviyesi: DB yok + yapilandirma yok -> tick durum kaydi yazar, AWX'e gitmez
  ljc._reset();
  awxSifirla();
  await watcher.tick({ db: brokenDb, runner, audit });
  assert.equal(awx.istekler.length, 0);
  assert.ok(ljc.getStatus().configError, 'watcher tickinde okunamadi bilgisi kayboldu');
  assert.match(fold(ljc.getStatus().lastTick.skipped), /KAPALI/);
});

// ── LJ7 ──────────────────────────────────────────────────────────────────────
test('LJ7 kuru calistirma HICBIR iptal istegi gondermez (statik token: sifir POST), Teams/denetim yazmaz, durum makinesine dokunmaz', async (t) => {
  t.mock.method(console, 'warn', () => {});
  isEkle({ id: 1300, tpl: 42, started: ago(120) });
  const db = dbOf(CFG());

  const s = await cycle(db, { dryRun: true });
  assert.equal(posts().length, 0, 'kuru calistirma AWX e POST yapti');
  assert.equal(teams.kartlar.length, 0);
  assert.equal(audits.length, 0);
  assert.equal(s.dryRun, true);
  assert.equal(s.jobs[0].decision, 'would_cancel');
  assert.equal(ljc.getStatus().lastTick, null, 'kuru calistirma gercek tick ozetinin yerine yazildi');
  assert.equal(ljc.getStatus().lastDryRun.jobs[0].jobId, 1300);

  // durum makinesi isaretlenmedi: gercek tur ayni isi iptal eder
  await cycle(db);
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/1300/cancel/']);

  // HTTP ucu da ayni sozu verir
  awxSifirla();
  ljc._reset();
  isEkle({ id: 1301, tpl: 42, started: ago(120) });
  const { base, kapat } = await uygulama({ db });
  try {
    const r = await fetch(`${base}/api/ansible/longjob-cancel/dry-run`, { method: 'POST' }).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.equal(r.result.jobs.find((j) => j.jobId === 1301).decision, 'would_cancel');
    assert.equal(posts().length, 0, 'dry-run ucu AWX e POST yapti');
  } finally {
    await kapat();
  }
});

// ── LJ8 ──────────────────────────────────────────────────────────────────────
test('LJ8 yetki on kontrolu: edit=false -> EDEMEZ; okunamazsa / alan yoksa OLCULEMEDI (yok DEGIL); workflow dogru uca', async () => {
  awx.templates.set('job:42', { name: 'nginx_config_audit', caps: { edit: false, start: true } });
  awx.templates.set('job:43', { name: 'sahip_oldugum', caps: { edit: true, start: true } });
  awx.templates.set('workflow:55', { name: 'gece_bakim_wf', caps: { edit: true } });
  awx.templates.set('job:44', { name: 'patlayan', caps: 'error' });
  awx.templates.set('job:45', { name: 'alansiz', caps: null });
  const p = await ljc.checkPermissions(
    [
      { serverId: 1, templateId: 42, kind: 'job' },
      { serverId: 1, templateId: 43, kind: 'job' },
      { serverId: 1, templateId: 55, kind: 'workflow' },
      { serverId: 1, templateId: 44, kind: 'job' },
      { serverId: 1, templateId: 45, kind: 'job' },
      { serverId: 7, templateId: 1, kind: 'job' }, // tanimsiz sunucu
    ],
    { runner },
  );
  assert.deepEqual(p.map((x) => x.state), ['no_admin', 'admin', 'admin', 'unknown', 'unknown', 'unknown']);
  assert.match(fold(p[0].message), /BASKALARININ .*iptal EDEMEZ/);
  assert.match(fold(p[0].message), /Admin rolu/);
  for (const u of p.slice(3)) assert.match(fold(u.message), /Olculemedi/);
  assert.ok(
    awx.istekler.some((r) => r.path === '/api/v2/workflow_job_templates/55/'),
    'workflow template yetkisi workflow_job_templates ucundan okunmadi',
  );

  // Kaydederken UYARI (engelleme degil) + ?t= ile secili-ama-kaydedilmemis template
  const db = dbOf(CFG());
  db.query = async () => ({ rows: [] }); // INSERT yolu
  const { base, kapat } = await uygulama({ db });
  try {
    const put = await fetch(`${base}/api/ansible/longjob-cancel`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CFG()),
    }).then((x) => x.json());
    assert.equal(put.ok, true, 'yetki eksigi kaydi ENGELLEDI (uyari olmaliydi)');
    assert.equal(put.permissions[0].state, 'no_admin');
    assert.match(fold(put.warnings.join(' ')), /EDEMEZ/);
    const g = await fetch(`${base}/api/ansible/longjob-cancel/permissions?t=1:44:job`).then((x) => x.json());
    assert.equal(g.permissions[0].state, 'unknown');
  } finally {
    await kapat();
  }
});

// ── LJ9 ──────────────────────────────────────────────────────────────────────
test('LJ9 kuyruk secenegi KAPALIYKEN pending iptal edilmez; ACIKKEN created a gore edilir (esik altindaki dokunulmaz)', async (t) => {
  t.mock.method(console, 'warn', () => {});
  isEkle({ id: 1400, tpl: 42, status: 'pending', started: null, created: ago(120) });
  isEkle({ id: 1401, tpl: 42, status: 'waiting', started: null, created: ago(10) });

  let s = await cycle(dbOf(CFG()));
  assert.equal(posts().length, 0, 'secenek kapaliyken kuyruktaki is iptal edildi');
  assert.equal(s.jobs.find((j) => j.jobId === 1400).decision, 'queued_option_off');

  ljc._reset();
  s = await cycle(dbOf(CFG({ cancelQueued: true })));
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/1400/cancel/']);
  assert.equal(s.jobs.find((j) => j.jobId === 1401).decision, 'below_threshold');
  assert.equal(awx.jobs.get(1401).status, 'waiting');
});

// ── LJ10 ─────────────────────────────────────────────────────────────────────
async function uygulama({ db, requireAdmin } = {}) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  const kayit = [];
  const gercekApp = {
    get: (p, ...h) => (kayit.push({ m: 'get', p, h }), app.get(p, ...h)),
    put: (p, ...h) => (kayit.push({ m: 'put', p, h }), app.put(p, ...h)),
    post: (p, ...h) => (kayit.push({ m: 'post', p, h }), app.post(p, ...h)),
    // Iptal token'i silme ucu (DELETE /api/ansible/longjob-cancel/tokens/:serverId).
    delete: (p, ...h) => (kayit.push({ m: 'delete', p, h }), app.delete(p, ...h)),
  };
  const requireAuth = (_q, _s, n) => n();
  const adm = requireAdmin || ((_q, _s, n) => n());
  ljc.registerRoutes(gercekApp, {
    requireAuth,
    requireAdmin: adm,
    getRunner: () => runner,
    getDb: () => db,
    getWatcherInfo: () => watcher.getWatcherInfo(),
    audit: () => {},
  });
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    kayit,
    requireAuth,
    requireAdmin: adm,
    kapat: () => new Promise((r) => srv.close(r)),
  };
}

test('LJ10 uclarin TAMAMI requireAuth + requireAdmin: Admin degilse AWX e de DB ye de gidilmez', async () => {
  isEkle({ id: 1500, tpl: 42, started: ago(120) });
  const db = dbOf(CFG());
  const red = (_q, res) => res.status(403).json({ ok: false, message: 'Admin gerekli' });
  const { base, kayit, requireAuth, requireAdmin, kapat } = await uygulama({ db, requireAdmin: red });
  try {
    assert.ok(kayit.length >= 6, `uc sayisi beklenenden az: ${kayit.length}`);
    for (const k of kayit) {
      assert.match(k.p, /^\/api\/ansible\/longjob-cancel/);
      assert.equal(k.h[0], requireAuth, `${k.m} ${k.p}: ilk bekci requireAuth degil`);
      assert.equal(k.h[1], requireAdmin, `${k.m} ${k.p}: ikinci bekci requireAdmin degil`);
    }
    for (const k of kayit) {
      const r = await fetch(`${base}${k.p}`, {
        method: k.m.toUpperCase(),
        headers: { 'content-type': 'application/json' },
        body: k.m === 'get' ? undefined : '{}',
      });
      assert.equal(r.status, 403, `${k.m} ${k.p} Admin olmadan acik`);
    }
    assert.equal(awx.istekler.length, 0, 'yetkisiz istek AWX e ulasti');
    assert.equal(db.sorgular, 0, 'yetkisiz istek DB ye ulasti');
  } finally {
    await kapat();
  }
  assert.throws(() => ljc.registerRoutes({ get() {}, put() {}, post() {} }, { requireAuth: () => {} }), /requireAdmin/);

  // runner.cjs uclari GERCEK bekcilerle kaydeder (bicimden bagimsiz metin bekcisi)
  const { normalize } = require('../../util/guard-text.cjs');
  const src = normalize(fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8'));
  assert.match(src, /registerRoutes\(app, \{ requireAuth, requireAdmin, getRunner: \(\) => module\.exports,/);
  assert.doesNotMatch(src, /app\.(get|put|post)\('\/api\/ansible\/longjob-cancel/, 'runner.cjs te bekcisiz eski uc kaldi');
});

// ── LJ11 ─────────────────────────────────────────────────────────────────────
test('LJ11 token durum/denetim/Teams/HTTP yanitina SIZMAZ (AWX hata govdesi Authorization u yansitsa bile)', async (t) => {
  t.mock.method(console, 'error', () => {});
  awx.echoAuth = true;
  isEkle({ id: 1600, tpl: 42, started: ago(120), cancel: '403' });
  const db = dbOf(CFG());
  await cycle(db);
  assert.equal(posts().length, 1);
  const hepsi = JSON.stringify({ st: ljc.getStatus(), audits, kartlar: teams.kartlar });
  assert.ok(hepsi.includes('You do not have permission'), 'test kurgusu: AWX hatasi kayda gecmedi');
  assert.ok(!hepsi.includes(TOKEN), 'TOKEN durum/denetim/Teams metnine sizdi');
  const { base, kapat } = await uygulama({ db });
  try {
    const body = await fetch(`${base}/api/ansible/longjob-cancel/status`).then((x) => x.text());
    assert.ok(body.includes('"jobId":1600'));
    assert.ok(!body.includes(TOKEN), 'TOKEN durum ucunun yanitina sizdi');
  } finally {
    await kapat();
  }
});

// ── LJ12 ─────────────────────────────────────────────────────────────────────
// (Eski LJ12 ayrica "405 = baska Portal ornegi iptal etmis" varsayiyordu; gercek AWX'te
// superuser olmayan Portal bitmis ise 403 alir. O senaryo artik LJ15'te GERCEK semantikle.)
test('LJ12 gecici hata en fazla 3 deneme, SON denemede tek Teams karti', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  isEkle({ id: 1700, tpl: 42, started: ago(120), cancel: '500' });
  const db = dbOf(CFG());
  for (let i = 0; i < 5; i++) await cycle(db);
  assert.equal(posts().filter((p) => p.path === '/api/v2/jobs/1700/cancel/').length, 3);
  assert.equal(basarisizKartlar().length, 1, 'tukenen gecici hata icin tek kart beklenir');
  assert.match(fold(JSON.stringify(basarisizKartlar()[0])), /#1700/);
  assert.equal(audits.filter((a) => a.result === 'fail').length, 3, 'her basarisiz deneme denetime fail yazmali');
  const st = ljc.getStatus().lastTick;
  assert.equal(st.jobs.find((j) => j.jobId === 1700).decision, 'cancel_failed');
  assert.match(fold(st.jobs.find((j) => j.jobId === 1700).reason), /tekrar denenmiyor/);
});

// ── LJ13 ─────────────────────────────────────────────────────────────────────
test('LJ13 watcher: ust uste binen tick atlanir; kapali ya da BOS izin listesinde AWX e hic gidilmez', async (t) => {
  const warns = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  isEkle({ id: 1800, tpl: 42, started: ago(120) });
  awx.delayMs = 150;
  const db = dbOf(CFG());
  const [a, b] = await Promise.all([watcher.tick({ db, runner, audit }), watcher.tick({ db, runner, audit })]);
  assert.deepEqual([a.skipped, b.skipped].sort(), ['in-flight', null].sort());
  assert.equal(posts().length, 1, 'ust uste binen tick ayni isi iki kez iptal etti');
  assert.ok(warns.mock.calls.some((c) => /onceki tarama hala suruyor/.test(String(c.arguments[0]))));

  for (const cfg of [CFG({ enabled: false }), CFG({ templates: [] })]) {
    awxSifirla();
    ljc._reset();
    isEkle({ id: 1801, tpl: 42, started: ago(120) });
    await watcher.tick({ db: dbOf(cfg), runner, audit });
    assert.equal(awx.istekler.length, 0, 'kapali/bos listede AWX taranmamaliydi');
    assert.ok(ljc.getStatus().lastTick.skipped, 'atlanan tick durum ekraninda gorunmuyor');
  }
  assert.match(fold(ljc.getStatus().lastTick.skipped), /BOS/);
});

// ── LJ14 ─────────────────────────────────────────────────────────────────────
test('LJ14 AAP 2.5 (api tabani /api/controller/v2): tarama, sayfalama, workflow iptali ve yetki okuma onekli yoldan gider', async (t) => {
  t.mock.method(console, 'warn', () => {});
  process.env.AWX_1_API_BASE = '/api/controller/v2';
  awx.prefix = '/api/controller/v2';
  try {
    isEkle({ id: 1901, kind: 'workflow', tpl: 99, started: ago(300) });
    isEkle({ id: 1902, kind: 'workflow', tpl: 99, started: ago(200) });
    isEkle({ id: 1900, kind: 'workflow', tpl: 55, started: ago(120) }); // 2. sayfa
    awx.templates.set('workflow:55', { name: 'gece_bakim_wf', caps: { edit: false } });
    const db = dbOf(CFG({ templates: [{ serverId: 1, templateId: 55, kind: 'workflow', name: 'gece_bakim_wf' }] }));
    const s = await cycle(db);
    assert.equal(s.servers[0].ok, true, `AAP 2.5 sunucusu taranamadi: ${s.servers[0].error}`);
    assert.deepEqual(posts().map((p) => p.path), ['/api/controller/v2/workflow_jobs/1900/cancel/']);
    assert.ok(awx.istekler.every((r) => r.path.startsWith('/api/controller/v2/')), 'onek disi istek gitti');
    const p = await ljc.checkPermissions([{ serverId: 1, templateId: 55, kind: 'workflow' }], { runner });
    assert.equal(p[0].state, 'no_admin');
  } finally {
    delete process.env.AWX_1_API_BASE;
  }
});

// ══ DOGRULAYICI TURU: GERCEK AWX SEMANTIGI ══════════════════════════════════

function sifirlaHepsi() {
  awxSifirla();
  ljc._reset();
  teams.kartlar.length = 0;
  audits = [];
}

// Ikinci Portal ornegi: modul durumunun AYRI bir kopyasi (ayni runner, ayni AWX).
function ikinciOrnek() {
  const p = require.resolve('../long-job-cancel.cjs');
  const saved = require.cache[p];
  delete require.cache[p];
  const b = require(p);
  require.cache[p] = saved;
  return b;
}

const sus = (t, ...names) => {
  for (const n of names.length ? names : ['error', 'warn', 'log']) t.mock.method(console, n, () => {});
};
const detay = (a) => JSON.parse(a.detail);

// ── LJ15 ─────────────────────────────────────────────────────────────────────
test('LJ15 tarama->is biter->POST yarisi ve iki Portal ornegi: gercek AWX 403 "zaten bitmis" sayilir, yanlis alarm YOK', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  const kos = (scan, mod = ljc) => mod.runCycle(scan, { db, runner, webhookUrl: teams.url, audit });

  // A) tek ornek: tarama aktif gordu, POST'tan once is kendiliginden bitti (superuser degil -> 403)
  isEkle({ id: 1950, tpl: 42, started: ago(120) });
  let scan = await runner.listLongJobCandidatesAcrossServers();
  awx.jobs.get(1950).status = 'successful';
  let s = await kos(scan);
  let row = s.jobs.find((j) => j.jobId === 1950);
  assert.equal(row.decision, 'already_terminal', `bitmis is icin karar ${row.decision}`);
  assert.equal(row.problem, false);
  assert.ok(awx.istekler.some((r) => r.method === 'GET' && r.path === '/api/v2/jobs/1950/'), '403 sonrasi isin durumu okunmadi');
  assert.equal(basarisizKartlar().length, 0, 'bitmis is icin "IPTAL EDILEMEDI - CALISMAYA DEVAM EDIYOR" karti gitti');
  assert.equal(audits.filter((a) => a.result === 'fail').length, 0);
  await cycle(db); // sonraki tur: listede yok, durum terminal -> kayit sessizce silinir
  assert.equal(ljc.hasOpenWork(), false);
  assert.equal(teams.kartlar.length, 0);

  // B) iki ornek ayni anda taradi; A iptal etti (is canceled), B'nin POST'u 403 aldi
  sifirlaHepsi();
  const B = ikinciOrnek();
  B._reset();
  isEkle({ id: 1951, tpl: 42, started: ago(120) });
  const scanA = await runner.listLongJobCandidatesAcrossServers();
  const scanB = await runner.listLongJobCandidatesAcrossServers();
  await kos(scanA);
  assert.equal(awx.jobs.get(1951).status, 'canceled');
  const sB = await kos(scanB, B);
  assert.equal(sB.jobs.find((j) => j.jobId === 1951).decision, 'already_terminal', 'coklu ornek "zararsiz" degil');
  assert.equal(basarisizKartlar().length, 0, 'ikinci ornek yanlis IPTAL EDILEMEDI alarmi verdi');
  assert.equal(iptalKartlari().length, 1);
  assert.deepEqual(audits.map((a) => a.result), ['ok']);

  // C) superuser: bitmis ise 405 -> durum okunur -> zaten bitmis
  sifirlaHepsi();
  awx.superuser = true;
  isEkle({ id: 1952, tpl: 42, started: ago(120) });
  scan = await runner.listLongJobCandidatesAcrossServers();
  awx.jobs.get(1952).status = 'failed';
  s = await kos(scan);
  assert.equal(s.jobs.find((j) => j.jobId === 1952).decision, 'already_terminal');
  assert.equal(teams.kartlar.length, 0);

  // D) 403 + is durumu OKUNAMIYOR: "calismaya devam ediyor" DENMEZ, kalici sayilmaz
  sifirlaHepsi();
  isEkle({ id: 1953, tpl: 42, started: ago(120), cancel: '403' });
  awx.stateFail = true;
  s = await cycle(db);
  row = s.jobs.find((j) => j.jobId === 1953);
  assert.equal(row.decision, 'cancel_failed');
  assert.match(fold(row.reason), /OLCULEMEDI/);
  assert.doesNotMatch(fold(row.reason), /CALISMAYA DEVAM/);
  await cycle(db);
  await cycle(db);
  assert.equal(posts().length, 3, 'durumu olculemeyen 403 kalici sayildi');
  assert.equal(basarisizKartlar().length, 1);
  const baslik = fold(kartBaslik(basarisizKartlar()[0]));
  assert.match(baslik, /OLCULEMEDI/);
  assert.doesNotMatch(baslik, /CALISMAYA DEVAM/);

  // E) 403 + saniyeler once aktif listelenen isin detayi 404: "silinmis = bitti" DENMEZ
  sifirlaHepsi();
  isEkle({ id: 1954, tpl: 42, started: ago(120), cancel: '403' });
  awx.detail404.add(1954);
  s = await cycle(db);
  row = s.jobs.find((j) => j.jobId === 1954);
  assert.equal(row.decision, 'cancel_failed', `403 + detay 404 icin karar ${row.decision}`);
  assert.match(fold(row.reason), /OLCULEMEDI/);
});

// ── LJ16 ─────────────────────────────────────────────────────────────────────
test('LJ16 tarama sagligi: AWX taranamazsa SCAN_FAIL_TICKS sonra TEK kart + denetim fail; duzelince kayit', async (t) => {
  sus(t);
  process.env.TEAMS_LONGJOB_WEBHOOK_URL = teams.url;
  const db = dbOf(CFG());
  awx.listStatus = 401; // token iptal edildi / suresi doldu
  isEkle({ id: 1960, tpl: 42, started: ago(600) });
  for (let i = 0; i < ljc.SCAN_FAIL_TICKS - 1; i++) await watcher.tick({ db, runner, audit });
  assert.equal(taramaKartlari().length, 0, 'erken alarm');
  // kuru calistirma sayaci ILERLETMEZ (alarmi yutmaz / one cekmez)
  await cycle(db, { dryRun: true });
  assert.equal(ljc.getStatus().scanHealth[0].fails, ljc.SCAN_FAIL_TICKS - 1, 'kuru calistirma tarama sagligi sayacina dokundu');
  await watcher.tick({ db, runner, audit });
  assert.equal(taramaKartlari().length, 1, 'AWX taranamiyor ama Teams e haber yok — SESSIZ');
  assert.match(fold(JSON.stringify(taramaKartlari()[0])), /401/);
  assert.equal(audits.filter((a) => a.result === 'fail' && detay(a).phase === 'scan').length, 1, 'denetimde scan fail yok');
  let st = ljc.getStatus();
  assert.equal(st.open.scanFailing, 1);
  assert.equal(st.attempts[0].outcome, 'scan_failed');
  assert.equal(st.attempts[0].ok, false);
  await watcher.tick({ db, runner, audit });
  assert.equal(taramaKartlari().length, 1, 'ayni kesinti icin ikinci kart');
  assert.equal(posts().length, 0);

  awx.listStatus = 0; // duzeldi
  await watcher.tick({ db, runner, audit });
  assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/1960/cancel/']);
  assert.ok(audits.some((a) => a.result === 'ok' && detay(a).phase === 'scan' && detay(a).recovered), 'duzelme denetime yazilmadi');
  st = ljc.getStatus();
  assert.equal(st.open.scanFailing, 0);
  assert.ok(st.attempts.some((a) => a.outcome === 'scan_recovered'));

  // yalniz workflow listesi bozuk: izin listesinde workflow YOKSA alarm yok, VARSA var
  for (const [templates, beklenen] of [
    [[{ serverId: 1, templateId: 42, kind: 'job' }], 0],
    [[{ serverId: 1, templateId: 42, kind: 'job' }, { serverId: 1, templateId: 55, kind: 'workflow' }], 1],
  ]) {
    sifirlaHepsi();
    awx.listFailKind = 'workflow';
    for (let i = 0; i < ljc.SCAN_FAIL_TICKS; i++) await watcher.tick({ db: dbOf(CFG({ templates })), runner, audit });
    assert.equal(taramaKartlari().length, beklenen, `workflow listesi hatasi, izin listesi ${JSON.stringify(templates)}`);
  }

  // otomatik iptal KAPALI: tarama hatasi alarm uretmez
  sifirlaHepsi();
  awx.listStatus = 401;
  for (let i = 0; i < ljc.SCAN_FAIL_TICKS; i++) await watcher.tick({ db: dbOf(CFG({ enabled: false })), runner, audit });
  assert.equal(taramaKartlari().length, 0);

  // tarama TAMAMEN patlarsa (istisna) da sayilir; durum kaydi korunur
  sifirlaHepsi();
  const patlak = {
    ...runner,
    listLongJobCandidatesAcrossServers: async () => {
      throw new Error('beklenmedik tarama hatasi');
    },
  };
  for (let i = 0; i < ljc.SCAN_FAIL_TICKS; i++) await watcher.tick({ db, runner: patlak, audit });
  assert.equal(taramaKartlari().length, 1, 'tarama istisnasi sessiz kaldi');
  assert.match(fold(JSON.stringify(taramaKartlari()[0])), /beklenmedik tarama hatasi/);

  // izin listesindeki template'in sunucusu Portal'da TANIMLI DEGIL
  sifirlaHepsi();
  for (let i = 0; i < ljc.SCAN_FAIL_TICKS; i++) {
    await watcher.tick({ db: dbOf(CFG({ templates: [{ serverId: 7, templateId: 1, kind: 'job' }] })), runner, audit });
  }
  assert.equal(taramaKartlari().length, 1, 'tanimsiz sunucu sessiz kaldi');
  assert.match(fold(JSON.stringify(taramaKartlari()[0])), /tanimli degil/);
});

// ── LJ17 ─────────────────────────────────────────────────────────────────────
test('LJ17 405 dogrulamasiz kabul edilmez: vekil 405 + is aktif -> IPTAL EDILEMEDI; durum okunamazsa "zaten bitmis" de dogrulanir', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  // A) vekil 405, is AKTIF
  isEkle({ id: 1965, tpl: 42, started: ago(120), cancel: 'proxy405' });
  let s = await cycle(db);
  let row = s.jobs.find((j) => j.jobId === 1965);
  assert.equal(row.decision, 'cancel_failed', '405 dogrulanmadan "zaten bitmis" sayildi');
  assert.equal(row.problem, true);
  await cycle(db);
  await cycle(db);
  assert.equal(posts().length, 3);
  assert.equal(basarisizKartlar().length, 1);
  const kart = fold(JSON.stringify(basarisizKartlar()[0]));
  assert.match(kart, /CALISMAYA DEVAM EDIYOR/);
  assert.match(kart, /vekil/);
  assert.equal(audits.filter((a) => a.result === 'fail').length, 3);

  // B) vekil 405 + durum OKUNAMIYOR: eski davranis (zaten bitmis) ama DOGRULANIR
  sifirlaHepsi();
  isEkle({ id: 1966, tpl: 42, started: ago(120), cancel: 'proxy405' });
  awx.stateFail = true;
  s = await cycle(db);
  assert.equal(s.jobs.find((j) => j.jobId === 1966).decision, 'already_terminal');
  assert.equal(ljc.hasOpenWork(), true, '"zaten bitmis" kaydi dogrulamaya girmedi');
  await cycle(db);
  s = await cycle(db);
  row = s.jobs.find((j) => j.jobId === 1966);
  assert.equal(row.decision, 'still_running', 'is calisiyor ama "zaten bitmis" diye SESSIZ');
  assert.equal(row.problem, true);
  assert.equal(teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL EDILMEDI')).length, 1);
  const vf = audits.filter((a) => a.result === 'fail' && detay(a).phase === 'verify');
  assert.equal(vf.length, 1);
  assert.equal(detay(vf[0]).awxSaidTerminal, true);
  assert.equal(ljc.getStatus().open.stillRunning, 1);
  assert.equal(posts().length, 1, 'iptal tekrar gonderildi');
});

// ── LJ18 ─────────────────────────────────────────────────────────────────────
test('LJ18 ofset sayfa kaymasi: "listede yok" durumu okunmadan "bitti" sayilmaz; kendiliginden biten is "iptal edildi" gorunmez', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  const kaydir = (eskiId) => {
    let fired = false;
    awx.onListPage = (kind, page) => {
      if (kind === 'job' && page === 2 && !fired) {
        fired = true;
        awx.jobs.get(eskiId).status = 'successful';
      }
    };
    return () => fired;
  };

  // A) _done: 43 icin iptal kabul edildi ama durmuyor; 2. turda sayfa 1 okunduktan sonra 41 biter
  isEkle({ id: 41, tpl: 99, started: ago(300) });
  isEkle({ id: 42, tpl: 99, started: ago(200) });
  isEkle({ id: 43, tpl: 42, started: ago(120), cancel: 'ignore' });
  isEkle({ id: 44, tpl: 99, started: ago(10) });
  await cycle(db);
  const oldu = kaydir(41);
  const s2 = await cycle(db);
  awx.onListPage = null;
  assert.ok(oldu(), 'kurgu: kayma tetiklenmedi');
  assert.equal(s2.servers[0].kinds.job.truncated, false);
  assert.ok(!s2.jobs.some((j) => j.jobId === 43), 'kurgu: kayma isi dusurmedi');
  assert.ok(awx.istekler.some((r) => r.method === 'GET' && r.path === '/api/v2/jobs/43/'), '"listede yok" durum okunarak teyit edilmedi');
  assert.equal(ljc.getStatus().attempts.filter((a) => a.jobId === 43 && a.outcome === 'stopped').length, 0, 'CALISAN is "iptal dogrulandi" yazildi');
  assert.equal(ljc.hasOpenWork(), true);
  await cycle(db);
  assert.equal(posts().filter((p) => p.path === '/api/v2/jobs/43/cancel/').length, 1, 'kayan is yeniden iptal edildi');
  assert.equal(iptalKartlari().length, 1, 'ikinci "iptal edildi" karti');
  assert.equal(durmadiKartlar().length, 1, '"durmadi" alarmi kayma yuzunden sifirlandi');

  // B) _failed: 403 almis is kayma yuzunden gorunmezse yeniden DENENMEZ, ikinci kart gitmez
  sifirlaHepsi();
  isEkle({ id: 51, tpl: 99, started: ago(300) });
  isEkle({ id: 52, tpl: 99, started: ago(200) });
  isEkle({ id: 53, tpl: 42, started: ago(120), cancel: '403' });
  isEkle({ id: 54, tpl: 99, started: ago(10) });
  await cycle(db);
  const oldu2 = kaydir(51);
  await cycle(db);
  awx.onListPage = null;
  assert.ok(oldu2());
  await cycle(db);
  assert.equal(posts().filter((p) => p.path === '/api/v2/jobs/53/cancel/').length, 1, 'kalici 403 kayma sonrasi tekrar denendi');
  assert.equal(basarisizKartlar().length, 1);

  // C) 202 sonrasi is iptalle degil KENDILIGINDEN bitti -> "iptal edildi" DENMEZ
  sifirlaHepsi();
  isEkle({ id: 1970, tpl: 42, started: ago(120), cancel: 'ignore' });
  await cycle(db);
  awx.jobs.get(1970).status = 'successful';
  await cycle(db);
  const a = ljc.getStatus().attempts[0];
  assert.equal(a.jobId, 1970);
  assert.equal(a.outcome, 'finished', `kendiliginden biten is ${a.outcome} diye raporlandi`);
  assert.match(fold(a.message), /kendiliginden/);
  assert.equal(ljc.hasOpenWork(), false);

  // D) durum OKUNAMAZSA kayit korunur; okununca silinir
  sifirlaHepsi();
  isEkle({ id: 1971, tpl: 42, started: ago(120) });
  await cycle(db);
  awx.stateFail = true;
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), true, 'durum okunamadan kayit silindi');
  assert.equal(ljc.getStatus().attempts.filter((x) => x.outcome === 'stopped').length, 0);
  assert.equal(ljc.getStatus().lastTick.verify.unmeasured, 1);
  awx.stateFail = false;
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), false);
  assert.equal(ljc.getStatus().attempts[0].outcome, 'stopped');

  // E) kayma + o isin detayi TEK SEFER 404: "silinmis = bitti" SAYILMAZ; is gercekten
  //    silinirse (iki tam taramada da 404) kayit kapanir
  sifirlaHepsi();
  isEkle({ id: 61, tpl: 99, started: ago(300) });
  isEkle({ id: 62, tpl: 99, started: ago(200) });
  isEkle({ id: 63, tpl: 42, started: ago(120), cancel: 'ignore' });
  isEkle({ id: 64, tpl: 99, started: ago(10) });
  await cycle(db);
  const oldu3 = kaydir(61);
  awx.detail404.add(63);
  await cycle(db);
  awx.onListPage = null;
  awx.detail404.clear();
  assert.ok(oldu3());
  assert.equal(ljc.hasOpenWork(), true, 'tek 404 "silinmis = bitti" sayildi');
  assert.equal(ljc.getStatus().attempts.filter((x) => x.jobId === 63 && x.outcome !== 'requested').length, 0);
  await cycle(db);
  assert.equal(posts().filter((p) => p.path === '/api/v2/jobs/63/cancel/').length, 1);
  awx.jobs.delete(63); // AWX'ten silindi
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), true, 'ilk 404 te kapandi');
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), false, 'iki tam taramada 404 olan kayit kapanmadi');
  assert.match(fold(ljc.getStatus().attempts[0].message), /silinmis/);
});

// ── LJ19 ─────────────────────────────────────────────────────────────────────
test('LJ19 AWX te yetki verilip Kaydet e basilinca 403 almis is YENIDEN denenir (kartin vaadi)', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  isEkle({ id: 1975, tpl: 42, started: ago(120), cancel: '403' });
  await cycle(db);
  await cycle(db);
  assert.equal(posts().length, 1);
  assert.match(fold(JSON.stringify(basarisizKartlar()[0])), /Kaydet/, 'kart yeniden deneme yolunu soylemiyor');
  awx.jobs.get(1975).cancel = 'ok'; // AWX'te Admin rolu verildi
  await ljc.writeConfig(db, CFG());
  await cycle(db);
  assert.equal(posts().length, 2, 'Kaydet sonrasi yeniden deneme yok');
  assert.equal(awx.jobs.get(1975).status, 'canceled');
});

// ── LJ20 ─────────────────────────────────────────────────────────────────────
test('LJ20 otomatik iptal kapatilsa da (Teams webhook yokken) bekleyen dogrulama ve alarm surer', async (t) => {
  sus(t);
  isEkle({ id: 1980, tpl: 42, started: ago(120), cancel: 'ignore' });
  await watcher.tick({ db: dbOf(CFG()), runner, audit });
  assert.equal(posts().length, 1);
  const kapali = dbOf(CFG({ enabled: false }));
  await ljc.writeConfig(kapali, CFG({ enabled: false }));
  await watcher.tick({ db: kapali, runner, audit });
  await watcher.tick({ db: kapali, runner, audit });
  assert.equal(ljc.getStatus().open.stillRunning, 1, 'kapatinca dogrulama birakildi');
  assert.equal(audits.filter((a) => a.result === 'fail' && detay(a).phase === 'verify').length, 1);
});

// ── LJ21 ─────────────────────────────────────────────────────────────────────
test('LJ21 sunucu son tarihi ve beklenmedik tarama hatasi listeyi TAM saydirmaz (dogrulama kaydi korunur)', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  isEkle({ id: 1985, tpl: 42, started: ago(120) }); // 202 -> canceled
  await cycle(db);
  assert.equal(ljc.hasOpenWork(), true);

  awx.delayMs = 300;
  let s = await cycle(db, { scanOpts: { deadlineMs: 60 } });
  awx.delayMs = 0;
  assert.equal(s.servers[0].ok, false);
  assert.match(fold(s.servers[0].error), /taranamadi/);
  assert.equal(ljc.hasOpenWork(), true, 'son tarih asimi "liste tam" sayildi');
  await new Promise((r) => setTimeout(r, 800)); // arkada kalan tarama bitsin

  s = await cycle(db, {
    scanOpts: {
      onServerScan: () => {
        throw new Error('beklenmedik kanca hatasi');
      },
    },
  });
  assert.equal(s.servers[0].ok, false);
  assert.match(s.servers[0].error, /beklenmedik kanca hatasi/);
  assert.equal(ljc.hasOpenWork(), true, 'beklenmedik tarama hatasi "liste tam" sayildi');

  await cycle(db);
  assert.equal(ljc.hasOpenWork(), false);
});

// ── LJ22 ─────────────────────────────────────────────────────────────────────
test('LJ22 taranamayan sunucuda _failed korunur ve o sunucuya is durumu istegi yagdirilmaz', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  isEkle({ id: 1990, tpl: 42, started: ago(120), cancel: '403' });
  await cycle(db);
  assert.equal(basarisizKartlar().length, 1);
  awx.listFail = true;
  awx.istekler.length = 0;
  await cycle(db);
  assert.equal(awx.istekler.filter((r) => r.path === '/api/v2/jobs/1990/').length, 0, 'listesi okunamayan sunucuya durum istegi gitti');
  awx.listFail = false;
  await cycle(db);
  assert.equal(posts().length, 0, 'kalici 403 tarama hatasindan sonra yeniden denendi');
  assert.equal(basarisizKartlar().length, 1);
  assert.equal(ljc.getStatus().lastTick.jobs.find((j) => j.jobId === 1990).decision, 'cancel_failed');
});

// ── LJ23 ─────────────────────────────────────────────────────────────────────
test('LJ23 kuru calistirma iptal EDILEMEYEN isi "iptal edilirdi" gostermez', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  isEkle({ id: 1995, tpl: 42, started: ago(120), cancel: '403' });
  await cycle(db);
  const s = await cycle(db, { dryRun: true });
  const row = s.jobs.find((j) => j.jobId === 1995);
  assert.equal(row.decision, 'cancel_failed', `kuru calistirma ${row.decision} dedi; gercek tick tekrar denemez`);
  assert.equal(row.problem, true);
  assert.equal(posts().length, 1);
});

// ── LJ24 ─────────────────────────────────────────────────────────────────────
test('LJ24 30 dk bildirimi: tarama hatasinda ayni is TEKRAR bildirilmez', async (t) => {
  sus(t);
  process.env.TEAMS_LONGJOB_WEBHOOK_URL = teams.url;
  const db = dbOf(CFG({ enabled: false }));
  const uzunKartlar = () => teams.kartlar.filter((k) => fold(JSON.stringify(k)).includes('Uzun Suredir Calisan'));
  isEkle({ id: 2005, tpl: 99, started: ago(45) });
  await watcher.tick({ db, runner, audit });
  assert.equal(uzunKartlar().length, 1);
  awx.listFail = true;
  await watcher.tick({ db, runner, audit });
  awx.listFail = false;
  await watcher.tick({ db, runner, audit });
  assert.equal(uzunKartlar().length, 1, 'tarama hatasi sonrasi ayni is yeniden bildirildi');
});

// ── LJ25 ─────────────────────────────────────────────────────────────────────
test('LJ25 sayfalar arasi kayma ayni isi iki kez listelemez', async () => {
  isEkle({ id: 2011, tpl: 99, started: ago(300) });
  isEkle({ id: 2012, tpl: 99, started: ago(200) });
  isEkle({ id: 2013, tpl: 99, started: ago(100) });
  let fired = false;
  awx.onListPage = (kind, page) => {
    if (kind === 'job' && page === 2 && !fired) {
      fired = true;
      isEkle({ id: 2010, tpl: 99, started: ago(400) }); // sayfa 1'in ONUNE eklenir
    }
  };
  const scan = await runner.listLongJobCandidatesAcrossServers();
  assert.ok(fired);
  const ids = scan.jobs.map((j) => j.jobId);
  assert.equal(ids.filter((x) => x === 2012).length, 1, `ayni is iki kez listelendi: ${ids}`);
  assert.equal(new Set(ids).size, ids.length);
});

// ── LJ26 ─────────────────────────────────────────────────────────────────────
test('LJ26 403 ipucu tek nedene baglanmaz; ortak mesajda Admin ipucu yok; statik token da Admin rozeti token kapsamini olcemez', async (t) => {
  sus(t);
  const db = dbOf(CFG());
  // A) baskasinin isi: iki olasi neden birlikte
  isEkle({ id: 2020, tpl: 42, started: ago(120), cancel: '403' });
  await cycle(db);
  let kart = fold(JSON.stringify(basarisizKartlar()[0]));
  assert.match(kart, /Admin rolu/);
  assert.match(kart, /'write' kapsami/, 'token kapsami olasi neden olarak yazilmadi');

  // B) Portal'in KENDI baslattigi is: Admin rolu sebep DEGIL
  sifirlaHepsi();
  isEkle({ id: 2021, tpl: 42, started: ago(120), cancel: '403', createdBy: 'portal_svc' });
  const s = await cycle(db);
  assert.ok(awx.istekler.some((r) => r.path === '/api/v2/me/'), 'Portal AWX kullanicisi olculmedi');
  kart = fold(JSON.stringify(basarisizKartlar()[0]));
  assert.match(kart, /sebep template Admin rolu DEGIL/);
  assert.match(kart, /'write' kapsami/);
  assert.doesNotMatch(kart, /Admin rolu verin/, 'Portal in kendi isi icin yanlis cozum (Admin rolu) onerildi');
  assert.match(fold(s.jobs.find((j) => j.jobId === 2021).reason), /token'da 'write' kapsami yok/);

  // C) ortak cancelJobOnServer (Telnet/ScaleX/LogX de cagirir): Admin ipucu YOK, is calisiyor denir
  sifirlaHepsi();
  isEkle({ id: 2022, tpl: 42, started: ago(1), cancel: '403', createdBy: 'portal_svc' });
  const err = await runner.cancelJobOnServer(1, 2022).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, 'kurgu: 403 hata vermedi');
  assert.doesNotMatch(err.message, /Admin rol/);
  assert.match(err.message, /ÇALIŞMAYA DEVAM/);
  assert.equal(err.permanent, true);
  assert.equal(err.createdByPortal, true);

  // D) statik token + edit=true: "admin" ama token kapsami OLCULEMEDI ("iptal edebilir" DENMEZ)
  awx.templates.set('job:42', { name: 'nginx_config_audit', caps: { edit: true } });
  const p = await ljc.checkPermissions([{ serverId: 1, templateId: 42, kind: 'job' }], { runner });
  assert.equal(p[0].state, 'admin');
  assert.equal(p[0].tokenScope, 'unknown');
  assert.match(fold(p[0].message), /Token kapsami OLCULEMEDI/);
  assert.doesNotMatch(fold(p[0].message), /tum islerini iptal edebilir/);
  assert.match(fold(ljc.permissionWarnings(p).join(' ')), /token kapsami olculemedi/);
});

// ── LJ27 ─────────────────────────────────────────────────────────────────────
test('LJ27 workflow iptali alt isleri de keser: kart, denetim ve durum bunu soyler; "hicbir zaman" denmez', async (t) => {
  sus(t);
  const db = dbOf(CFG({ templates: [{ serverId: 1, templateId: 55, kind: 'workflow', name: 'gece_bakim_wf' }] }));
  isEkle({ id: 2030, kind: 'workflow', tpl: 55, tplName: 'gece_bakim_wf', started: ago(120) });
  isEkle({ id: 2031, kind: 'job', tpl: 77, tplName: 'db_upgrade', started: ago(110), parentWf: 2030 });
  isEkle({ id: 2032, kind: 'job', tpl: 78, tplName: 'alakasiz', started: ago(110) });
  const s = await cycle(db);
  assert.equal(iptalKartlari().length, 1);
  assert.match(fold(JSON.stringify(iptalKartlari()[0])), /alt islerini de keser/);
  const ok = audits.find((a) => a.result === 'ok');
  assert.equal(detay(ok).childJobsCanceledToo, true);
  assert.match(fold(s.jobs.find((j) => j.jobId === 2031).reason), /ust workflow #2030 izin listesinde/);
  const alakasiz = fold(s.jobs.find((j) => j.jobId === 2032).reason);
  assert.doesNotMatch(alakasiz, /hicbir zaman/);
  assert.doesNotMatch(alakasiz, /ust workflow/);
});

// ── LJ28 ─────────────────────────────────────────────────────────────────────
test('LJ28 kullanici/sifreli AWX: kuru calistirma /cancel/ ucuna SIFIR POST (yalniz token); token kapsami write', async (t) => {
  sus(t);
  delete process.env.AWX_1_TOKEN;
  process.env.AWX_1_USER = 'portal_svc';
  process.env.AWX_1_PASSWORD = 'gizli-sifre-123';
  runner.clearTokenCache();
  try {
    isEkle({ id: 2040, tpl: 42, started: ago(120) });
    const db = dbOf(CFG());
    const { base, kapat } = await uygulama({ db });
    try {
      const r = await fetch(`${base}/api/ansible/longjob-cancel/dry-run`, { method: 'POST' }).then((x) => x.json());
      assert.equal(r.ok, true, r.message);
      assert.equal(r.result.jobs.find((j) => j.jobId === 2040).decision, 'would_cancel');
    } finally {
      await kapat();
    }
    assert.equal(posts().filter((p) => /\/cancel\/$/.test(p.path)).length, 0, 'kuru calistirma iptal istegi gonderdi');
    assert.deepEqual(posts().map((p) => p.path), ['/api/v2/tokens/'], 'kurgu: token kullanici/sifreyle alinmadi');
    assert.equal(awx.jobs.get(2040).status, 'running');
    awx.templates.set('job:42', { name: 'nginx_config_audit', caps: { edit: true } });
    const p = await ljc.checkPermissions([{ serverId: 1, templateId: 42, kind: 'job' }], { runner });
    assert.equal(p[0].tokenScope, 'write');
    assert.doesNotMatch(fold(p[0].message), /OLCULEMEDI/);
  } finally {
    process.env.AWX_1_TOKEN = TOKEN;
    delete process.env.AWX_1_USER;
    delete process.env.AWX_1_PASSWORD;
    runner.clearTokenCache();
  }
});

// ── LJ29 ─────────────────────────────────────────────────────────────────────
test('LJ29 tarama hic bitmiyorsa (in-flight) tarama basina TEK Teams karti + denetim fail', async (t) => {
  sus(t);
  process.env.TEAMS_LONGJOB_WEBHOOK_URL = teams.url;
  isEkle({ id: 2050, tpl: 42, started: ago(120) });
  const db = dbOf(CFG());
  let ac;
  awx.gate = new Promise((r) => (ac = r));
  const ilk = watcher.tick({ db, runner, audit });
  await new Promise((r) => setTimeout(r, 50));
  const takildi = () => teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('tarama bitmiyor'));
  for (let i = 0; i < 2; i++) assert.equal((await watcher.tick({ db, runner, audit })).skipped, 'in-flight');
  assert.equal(takildi().length, 0, 'erken alarm');
  await watcher.tick({ db, runner, audit });
  assert.equal(takildi().length, 1, 'tarama bitmiyor ama kimseye haber yok');
  await watcher.tick({ db, runner, audit });
  assert.equal(takildi().length, 1, 'ayni takilma icin ikinci kart');
  assert.equal(audits.filter((a) => a.result === 'fail' && detay(a).phase === 'watcher').length, 1);
  assert.equal(ljc.getStatus().attempts[0].outcome, 'watcher_stuck');
  const gate = ac;
  awx.gate = null;
  gate();
  await ilk;
  assert.equal(watcher.getWatcherInfo().skippedWhileInFlight, 0);
});
