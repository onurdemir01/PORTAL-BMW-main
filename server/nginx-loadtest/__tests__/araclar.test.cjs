// server/nginx-loadtest/__tests__/araclar.test.cjs - Yuk Testi arac setleri (tur 4, 2026-11-02;
// arac_sozlesme.md 2.2, 2.3, 2.7, 3.7, 4.1). araclar.cjs + index.cjs router'i GERCEK; db / AWX / kimlik /
// gorunurluk / denetim sahte (require.cache). Sahte arac tablosu WHERE / ORDER / TOP'u SQL metninden uygular.
//
//   AR1 ortam: derleme listesi (varsayilan / gecersiz atilir / bossa GBLABT02), vekil (varsayilan, 'yok',
//       kucuk harf, kimlik / https / yol -> hata), k6 surumu (1.x -> varsayilan), ZORUNLU sabit ozet env'leri
//   AR2 aracEkstraDegiskenler TAM 10 anahtar, sira, hepsi metin; aracEkstraDegiskenleriDenetle her kural (bos
//       arsiv ozeti dahil: D1)
//   AR3 POST /araclar: 403 / 400 / 409 izinsiz / 409 vekil / 409 ozet sabit yok (D1; is, kilit, satir yok) /
//       409 kilit dolu; basari (kilitler A|araclar + L|<HOST>, satir, istenen = env ozetleri, extra_vars,
//       bindLocks 'araclar', RUNNING); AWX kesin red kilidi birakir + FAILED; belirsiz hata kilidi TTL'e
//       birakir; son kapi ihlali
//   AR4 sonuclandirma: DONE (kolonlar), set_stats HATA + gecerli araclar -> FAILED (PU3), istenen ozet yok ->
//       FAILED, uyusmazlik, /sw dizini farkli, sabit ozet farkli, surum satiri farkli, iptal, set_stats yok,
//       deneme > 3, eski playbook notu, ozet farkli notu (PU1), kilit karari, bayat kuyruk, 404, uzun sure
//       okunamayan AWX -> OKUNAMADI (PU2), olay islemesi beklenir (PU4), TOP 5 sirasi (aclik kalkani)
//   AR5 etkinAracSeti (en yeni DONE + geri cekilmemis + env ozetleriyle ayni; FAILED / geri cekilmis / baska
//       ozetli atlanir; env degisince set yok); GET /araclar etkin / calisan / gecmis / ayar / kapi, Admin
//       disina vekil adresi null
//   AR6 POST /araclar/:id/geri-cek (D2): 403 / 400 / 409 yok / DONE degil / zaten; basari (satir, denetim,
//       etkin set bir onceki uygun sete duser, yoksa kapi araclar_geri_cekildi); yaris; eski /onayla ucu yok
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { aracSatiri, aracSorgusu, ozetEnvKur, SHA_K6, SHA_WRK, SHA_K6_ARSIV, SHA_WRK_KAYNAK } = require('./arac-sahte-tablo.cjs');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const D = {};
function sifirla(ek = {}) {
  Object.assign(D, {
    sorgular: [],
    araclar: [],
    aracDbHata: null,
    aracInsertHata: null,
    aracSorgular: [],
    aracSahiplenmez: false,
    kilitler: new Map(),
    gecmis: [],
    arsiv: [],
    denetim: [],
    launch: [],
    iptal: [],
    launchHata: null,
    sonrakiIs: 950,
    registry: { enabled: true, awxTemplateId: 44, awxServerId: 3 },
    awx: { status: 'successful', artifacts: {}, finished: '2026-11-02T10:30:00Z' },
    awxHata: null,
    awxFn: null,
    aracGeriCekYarisi: false,
    ...ek,
  });
  for (const k of ['NGINX_LOADTEST_DERLEME_HOSTLARI', 'NGINX_LOADTEST_ARAC_PROXY', 'NGINX_LOADTEST_K6_SURUM', 'NGINX_LOADTEST_K6_ARSIV_SHA256', 'NGINX_LOADTEST_WRK_KAYNAK_SHA256', 'NGINX_LOADTEST_DIR']) {
    delete process.env[k];
  }
  // D1: iki ozet sabit (sahte tablonun arsiv ozetleri); testler ayrica bozar / siler.
  ozetEnvKur();
}
sifirla();

// Kilit tablosu (kilit.cjs CAS sorgularinin anlami; kapi.test.cjs ile ayni kurallar, hata enjeksiyonsuz).
function kilitSorgusu(q, params) {
  const s = D.kilitler;
  if (/^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/.test(q)) {
    if (!s.has(params[0])) s.set(params[0], { id: s.size + 1, lock_key: params[0], held: 0 });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 1/.test(q)) {
    const r = s.get(params[0]);
    if (!r || r.held) return { rows: [], rowCount: 0 };
    Object.assign(r, { held: 1, holder: params[1], lock_id: params[2], target_desc: params[3], awx_server_id: null, awx_job_id: null, bag_turu: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT TOP 1 lock_key/.test(q)) return { rows: s.has(params[0]) ? [{ ...s.get(params[0]) }] : [] };
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE lock_key = \$1 AND lock_id = \$2/.test(q)) {
    const r = s.get(params[0]);
    if (!r || r.lock_id !== params[1] || !r.held) return { rows: [], rowCount: 0 };
    r.held = 0;
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND held = 1$/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
        r.held = 0;
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$3, awx_job_id = \$4, bag_turu = \$5/.test(q)) {
    const r = s.get(params[0]);
    if (r && r.lock_id === params[1] && r.held) Object.assign(r, { awx_server_id: params[2], awx_job_id: params[3], bag_turu: params[4] });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
        Object.assign(r, { awx_server_id: null, awx_job_id: null, bag_turu: null });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  return null;
}

sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    const k = kilitSorgusu(q, params);
    if (k) return k;
    const a = aracSorgusu(D, q, params);
    if (a) return a;
    if (/^INSERT INTO ansible_job_history/.test(q)) {
      D.gecmis.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT 1 AS x FROM ansible_job_output/.test(q)) return { rows: D.arsiv.filter((x) => x[0] === params[0] && x[1] === params[1]).map(() => ({ x: 1 })) };
    if (/^INSERT INTO ansible_job_output/.test(q)) {
      D.arsiv.push(params);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`beklenmeyen Portal sorgusu: ${q}`);
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false })) });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next(), requireVisible: () => (req, res, next) => next() });
sahte('../../audit/index.cjs', { auditPortal: (req, eylem, o) => D.denetim.push({ eylem, ...o }) });
sahte('../../ansible/playbook-registry.cjs', { getByKey: async () => D.registry, getEffectiveTemplateId: (r) => r.awxTemplateId || null });
sahte('../../ansible/template-preflight.cjs', {
  BEKLENEN_PLAYBOOK: { nginx_loadtest_run: 'nginx_loadtest.yml' },
  assertRegistryPlaybook: async () => {},
  assertTemplatePlaybook: async () => {},
  assertTemplateAcceptsExtraVars: async () => {},
  promptKapaliHatasi: () => Object.assign(new Error('prompt kapali'), { status: 409, code: 'awx_prompt_on_launch_disabled' }),
});
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: (id) => (id === 3 ? { id: 3, url: 'https://awx.test.local/', apiBase: '/api/v2' } : null),
  launchJobOnServer: async (...a) => {
    D.launch.push(a);
    if (D.launchHata) throw D.launchHata;
    return { jobId: D.sonrakiIs++, status: 'pending' };
  },
  getJobStatusOnServer: async (sid, jid) => {
    if (D.awxFn) return D.awxFn(sid, jid);
    if (D.awxHata) throw D.awxHata;
    return { jobId: jid, ...D.awx };
  },
  getJobOutputOnServer: async () => ({ output: 'PLAY [araclar]\npassword=gizli ok\n' }),
  cancelJobOnServer: async (sid, jid) => {
    D.iptal.push([sid, jid]);
    return { canceled: true };
  },
});
sahte('../../ansible/job-stdout-cache.cjs', { sil: () => {} });

const ar = require('../araclar.cjs');
const dg = require('../dogrula.cjs');
const yt = require('../index.cjs');
const router = yt._yonlendiriciKurForTest();

const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const KULLANICI = { user: { username: 'veli', role: 'User' } };
function istek(method, url, { session = ADMIN, body } = {}) {
  const [yol] = url.split('?');
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, body, query: {}, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}

const SIMDI = 1793000000;
const tutulan = () => [...D.kilitler.entries()].filter(([, v]) => v.held).map(([k]) => k).sort();

test('AR1 ortam: derleme listesi, vekil, k6 surumu, sabit ozetler', () => {
  assert.deepEqual(ar.derlemeHostlari({}), ['GBLABT02']);
  assert.deepEqual(ar.derlemeHostlari({ NGINX_LOADTEST_DERLEME_HOSTLARI: ' gbngxt34; GBLABT02,GBNGXT34 ' }), ['GBNGXT34', 'GBLABT02']);
  assert.equal(ar.varsayilanDerlemeHost({ NGINX_LOADTEST_DERLEME_HOSTLARI: 'GBNGXT34 GBLABT02' }), 'GBNGXT34');
  // Uretim, EDU, ortami bilinmeyen ad ve bicimsiz girdi atilir; hepsi atilirsa GBLABT02.
  assert.deepEqual(ar.derlemeHostlari({ NGINX_LOADTEST_DERLEME_HOSTLARI: 'GBNGXP01,GBNGXT51,GBXYZ01,x;y,GBNGWAQ02' }), ['GBNGWAQ02']);
  assert.deepEqual(ar.derlemeHostlari({ NGINX_LOADTEST_DERLEME_HOSTLARI: 'GBNGXP01 GBNGXT51' }), ['GBLABT02']);
  // Vekil.
  assert.deepEqual(ar.aracProxy({}), { proxy: 'http://tekprxv2.fw.garanti.com.tr:80', hata: null });
  assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: '  ' }), { proxy: 'http://tekprxv2.fw.garanti.com.tr:80', hata: null });
  assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: 'yok' }), { proxy: '', hata: null });
  assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: 'YOK' }), { proxy: '', hata: null });
  assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: 'HTTP://X:80' }), { proxy: 'http://x:80', hata: null });
  assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: 'http://px.kurum.local:3128' }), { proxy: 'http://px.kurum.local:3128', hata: null });
  for (const kotu of ['http://u:p@x:80', 'http://u@x:80', 'https://x:80', 'http://x:80/y', 'http://x', 'x:80', 'http://x :80', 'http://-x:80', 'http://x:123456']) {
    assert.deepEqual(ar.aracProxy({ NGINX_LOADTEST_ARAC_PROXY: kotu }), { proxy: null, hata: 'NGINX_LOADTEST_ARAC_PROXY geçersiz' }, kotu);
  }
  // k6 surumu: v0.45..v0.59; 1.x ve bicimsiz -> varsayilan.
  assert.equal(ar.k6Surum({}), 'v0.49.0');
  assert.equal(ar.k6Surum({ NGINX_LOADTEST_K6_SURUM: 'v0.52.1' }), 'v0.52.1');
  for (const kotu of ['v1.0.0', 'v0.44.0', '0.49.0', 'v0.49', 'v0.60.0', 'v0.49.0-rc1']) assert.equal(ar.k6Surum({ NGINX_LOADTEST_K6_SURUM: kotu }), 'v0.49.0', kotu);
  // Sabit ozet env'leri: buyuk harf kucultulur, bozuk yok sayilir.
  assert.equal(ar.sabitOzetEnv({ X: 'AB'.repeat(32) }, 'X'), 'ab'.repeat(32));
  assert.equal(ar.sabitOzetEnv({ X: 'a'.repeat(63) }, 'X'), null);
  assert.equal(ar.sabitOzetEnv({}, 'X'), null);
  // D1: iki ozet ZORUNLU; eksik / gecersiz olan adiyla ve nedeniyle listelenir (TAM 64 hex; 65, bosluklu, g yok).
  const K = 'NGINX_LOADTEST_K6_ARSIV_SHA256';
  const W = 'NGINX_LOADTEST_WRK_KAYNAK_SHA256';
  assert.deepEqual(ar.sabitOzetler({ [K]: ` ${'A'.repeat(64)} `, [W]: 'b'.repeat(64) }), { k6Arsiv: 'a'.repeat(64), wrkKaynak: 'b'.repeat(64), eksikler: [] });
  assert.deepEqual(ar.sabitOzetler({}), { k6Arsiv: '', wrkKaynak: '', eksikler: [`${K} tanımlı değil`, `${W} tanımlı değil`] });
  for (const kotu of ['a'.repeat(65), 'g'.repeat(64), `${'a'.repeat(32)} ${'a'.repeat(31)}`, `sha256:${'a'.repeat(64)}`]) {
    assert.deepEqual(ar.sabitOzetler({ [K]: 'a'.repeat(64), [W]: kotu }).eksikler, [`${W} 64 hex değil`], kotu);
  }
  assert.deepEqual(ar.sabitOzetler({ [K]: '  ', [W]: 'b'.repeat(64) }).eksikler, [`${K} tanımlı değil`]);
  assert.match(ar.ozetSabitYokMesaji([`${K} tanımlı değil`]), /^Yük aracı arşiv özetleri sabitlenmemiş \(NGINX_LOADTEST_K6_ARSIV_SHA256 tanımlı değil\): .*“Arşiv özetlerini sabitleme”/);
  assert.equal(ar.WRK_SURUM, '4.2.0');
  assert.equal(ar.WRK_SURUM, dg.WRK_SURUM);
});

test('AR2 extra_vars: 10 anahtar, sira, metin; son kapi her kurali yakalar', () => {
  assert.deepEqual([...ar.ARAC_EKSTRA_ANAHTARLAR], [
    'yuk_islem', 'yuk_run_id', 'yuk_derleme_host', 'yuk_k6_surum', 'yuk_wrk_surum',
    'yuk_k6_arsiv_sha256', 'yuk_wrk_kaynak_sha256', 'yuk_proxy', 'yuk_cikti_kok', 'yuk_son_epoch',
  ]);
  const bosOzetli = ar.aracEkstraDegiskenler({ aracId: 7, derlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', proxy: '', kok: '/sw/BMW_PORTAL/nginx_loadtest', simdiSn: SIMDI });
  assert.deepEqual([bosOzetli.yuk_k6_arsiv_sha256, bosOzetli.yuk_wrk_kaynak_sha256], ['', '']);
  // D1: bos arsiv ozeti (ilk-kullanimda-guven) son kapidan GECMEZ.
  assert.deepEqual(ar.aracEkstraDegiskenleriDenetle(bosOzetli, { simdiSn: SIMDI }), ['yuk_k6_arsiv_sha256', 'yuk_wrk_kaynak_sha256']);
  const ev = ar.aracEkstraDegiskenler({ aracId: 7, derlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', k6ArsivSha256: SHA_K6_ARSIV, wrkKaynakSha256: SHA_WRK_KAYNAK, proxy: 'http://tekprxv2.fw.garanti.com.tr:80', kok: '/sw/BMW_PORTAL/nginx_loadtest', simdiSn: SIMDI });
  assert.deepEqual(Object.keys(ev), [...ar.ARAC_EKSTRA_ANAHTARLAR]);
  for (const [k, v] of Object.entries(ev)) assert.equal(typeof v, 'string', k);
  assert.deepEqual(ev, {
    yuk_islem: 'araclar', yuk_run_id: '7', yuk_derleme_host: 'GBLABT02', yuk_k6_surum: 'v0.49.0', yuk_wrk_surum: '4.2.0',
    yuk_k6_arsiv_sha256: SHA_K6_ARSIV, yuk_wrk_kaynak_sha256: SHA_WRK_KAYNAK, yuk_proxy: 'http://tekprxv2.fw.garanti.com.tr:80', yuk_cikti_kok: '/sw/BMW_PORTAL/nginx_loadtest',
    yuk_son_epoch: String(SIMDI + 900),
  });
  const den = (ek) => ar.aracEkstraDegiskenleriDenetle({ ...ev, ...ek }, { simdiSn: SIMDI });
  assert.deepEqual(den({}), []);
  for (const ek of [{ yuk_derleme_host: 'GBNGXT34' }, { yuk_proxy: '' }, { yuk_k6_arsiv_sha256: 'a'.repeat(64), yuk_wrk_kaynak_sha256: 'b'.repeat(64) }, { yuk_cikti_kok: '/sw/BMW_PORTAL_DEV/nginx_loadtest' }, { yuk_k6_surum: 'v0.59.12' }]) {
    assert.deepEqual(den(ek), [], JSON.stringify(ek));
  }
  for (const [ek, anahtar] of [
    [{ yuk_islem: 'kosu' }, 'yuk_islem'],
    [{ yuk_run_id: 'x' }, 'yuk_run_id'],
    [{ yuk_run_id: 7 }, 'yuk_run_id'],
    [{ yuk_derleme_host: 'GBNGXP01' }, 'yuk_derleme_host'],
    [{ yuk_derleme_host: 'GBNGXT51' }, 'yuk_derleme_host'],
    [{ yuk_derleme_host: 'gblabt02' }, 'yuk_derleme_host'],
    [{ yuk_derleme_host: 'GBXYZ01' }, 'yuk_derleme_host'],
    [{ yuk_derleme_host: '' }, 'yuk_derleme_host'],
    [{ yuk_k6_surum: 'v1.0.0' }, 'yuk_k6_surum'],
    [{ yuk_k6_surum: 'v0.44.0' }, 'yuk_k6_surum'],
    [{ yuk_k6_surum: '0.49.0' }, 'yuk_k6_surum'],
    [{ yuk_k6_surum: 'v0.49' }, 'yuk_k6_surum'],
    [{ yuk_wrk_surum: '4.1.0' }, 'yuk_wrk_surum'],
    [{ yuk_wrk_surum: '4.2' }, 'yuk_wrk_surum'],
    [{ yuk_k6_arsiv_sha256: 'AB'.repeat(32) }, 'yuk_k6_arsiv_sha256'],
    [{ yuk_k6_arsiv_sha256: '' }, 'yuk_k6_arsiv_sha256'],
    [{ yuk_wrk_kaynak_sha256: 'a'.repeat(63) }, 'yuk_wrk_kaynak_sha256'],
    [{ yuk_wrk_kaynak_sha256: '' }, 'yuk_wrk_kaynak_sha256'],
    [{ yuk_proxy: 'http://u:p@h:80' }, 'yuk_proxy'],
    [{ yuk_proxy: 'https://h:80' }, 'yuk_proxy'],
    [{ yuk_proxy: 'http://h' }, 'yuk_proxy'],
    [{ yuk_proxy: 'http://h:80/x' }, 'yuk_proxy'],
    [{ yuk_proxy: 'HTTP://H:80' }, 'yuk_proxy'],
    [{ yuk_proxy: 'http://h:80 ' }, 'yuk_proxy'],
    [{ yuk_cikti_kok: ['', 'tmp', 'x'].join('/') }, 'yuk_cikti_kok'],
    [{ yuk_cikti_kok: '/sw/BMW_PORTAL/../etc' }, 'yuk_cikti_kok'],
    [{ yuk_cikti_kok: '/sw/BMW_PORTAL' }, 'yuk_cikti_kok'],
    [{ yuk_son_epoch: String(SIMDI - 1) }, 'yuk_son_epoch'],
    [{ yuk_son_epoch: String(SIMDI + 1801) }, 'yuk_son_epoch'],
    [{ http_proxy: 'http://h:80' }, 'http_proxy'],
    [{ limit: 'GBLABT02' }, 'limit'],
  ]) assert.ok(den(ek).includes(anahtar), `${JSON.stringify(ek)} -> ${anahtar}: ${JSON.stringify(den(ek))}`);
  const eksik = { ...ev };
  delete eksik.yuk_proxy;
  assert.deepEqual(ar.aracEkstraDegiskenleriDenetle(eksik, { simdiSn: SIMDI }), ['yuk_proxy']);
});

test('AR3 POST /araclar: kapilar, kilit, satir, sabit ozet devamliligi, AWX hata yollari', { timeout: 20000 }, async () => {
  sifirla();
  let r = await istek('POST', '/araclar', { session: KULLANICI, body: {} });
  assert.equal(r.statusCode, 403, 'Admin olmayan gecti');
  assert.equal(D.sorgular.length, 0);
  r = await istek('POST', '/araclar', { body: { derlemeHost: 'GB LAB' } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [400, 'gecersiz_istek', 'Geçersiz derleme makinesi adı.']);
  r = await istek('POST', '/araclar', { body: { derlemeHost: 'gbngxt34' } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'derleme_host_izinsiz', 'GBNGXT34 derleme makinesi izin listesinde değil (NGINX_LOADTEST_DERLEME_HOSTLARI).']);
  process.env.NGINX_LOADTEST_ARAC_PROXY = 'http://u:p@px:80';
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'arac_proxy_gecersiz', 'NGINX_LOADTEST_ARAC_PROXY geçersiz (yalnız http://<ad>:<port>, kimlik bilgisi yok); araçlar hazırlanamaz.']);
  assert.ok(!JSON.stringify(r.body).includes('u:p@'), 'vekil kimligi yanita sizdi');
  delete process.env.NGINX_LOADTEST_ARAC_PROXY;
  assert.deepEqual([D.launch.length, D.kilitler.size, D.araclar.length], [0, 0, 0]);
  // Ret denetime yazilir (409).
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_araclar_hazirla' && x.result === 'fail' && x.targetHost === 'GBNGXT34'));
  // D1: sabit ozetlerden biri eksik / gecersiz -> 409 arac_ozet_sabit_yok; DB, kilit, satir, AWX YOK (onceki
  // DONE setin ozeti DEVRALINMAZ). Ret denetime yazilir.
  for (const [ad, kur, eksik] of [
    ['ikisi yok', () => ozetEnvKur({ k6: null, wrk: null }), 'NGINX_LOADTEST_K6_ARSIV_SHA256 tanımlı değil, NGINX_LOADTEST_WRK_KAYNAK_SHA256 tanımlı değil'],
    ['wrk yok (onceki set var)', () => ozetEnvKur({ wrk: null }), 'NGINX_LOADTEST_WRK_KAYNAK_SHA256 tanımlı değil'],
    ['k6 gecersiz', () => ozetEnvKur({ k6: 'z'.repeat(64) }), 'NGINX_LOADTEST_K6_ARSIV_SHA256 64 hex değil'],
  ]) {
    sifirla({ araclar: [aracSatiri()] });
    kur();
    r = await istek('POST', '/araclar', { body: {} });
    assert.deepEqual([r.statusCode, r.body.code], [409, 'arac_ozet_sabit_yok'], ad);
    assert.equal(r.body.message, `Araçlar hazırlanamaz: ${ar.ozetSabitYokMesaji(eksik.split(', '))}`, ad);
    assert.deepEqual([D.launch.length, D.kilitler.size, D.araclar.length, D.aracSorgular.length], [0, 0, 1, 0], ad);
    assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_araclar_hazirla' && x.result === 'fail' && JSON.parse(x.detail).code === 'arac_ozet_sabit_yok'), ad);
  }

  // Basari: istenen ozetler = env sabitleri (onceki DONE setlerin ozetleri KULLANILMAZ).
  sifirla({ araclar: [aracSatiri(), aracSatiri({ id: 6, istenen_k6_arsiv_sha256: '9'.repeat(64), k6_arsiv_sha256: '9'.repeat(64), wrk_kaynak_sha256: '8'.repeat(64) })] });
  r = await istek('POST', '/araclar', { body: {} });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, aracId: 7, jobId: 950, awxServerId: 3 });
  const s = D.araclar.find((x) => x.id === 7);
  assert.deepEqual([s.durum, s.derleme_host, s.k6_surum, s.wrk_surum, s.istenen_k6_arsiv_sha256, s.istenen_wrk_kaynak_sha256, s.sw_dizin, s.awx_server_id, s.awx_job_id, s.created_by],
    ['RUNNING', 'GBLABT02', 'v0.49.0', '4.2.0', SHA_K6_ARSIV, SHA_WRK_KAYNAK, '/sw/BMW_PORTAL/nginx_loadtest/araclar/7', 3, 950, 'onur']);
  assert.deepEqual(tutulan(), ['A|araclar', 'L|GBLABT02']);
  for (const k of ['A|araclar', 'L|GBLABT02']) {
    const kl = D.kilitler.get(k);
    assert.deepEqual([kl.awx_server_id, kl.awx_job_id, kl.bag_turu, kl.target_desc], [3, 950, 'araclar', 'araç hazırlama GBLABT02'], k);
  }
  const [sid, tid, ev, limit] = D.launch[0];
  assert.deepEqual([sid, tid, limit], [3, 44, '']);
  assert.deepEqual(Object.keys(ev), [...ar.ARAC_EKSTRA_ANAHTARLAR]);
  assert.deepEqual([ev.yuk_islem, ev.yuk_run_id, ev.yuk_derleme_host, ev.yuk_k6_arsiv_sha256, ev.yuk_wrk_kaynak_sha256, ev.yuk_proxy, ev.yuk_cikti_kok],
    ['araclar', '7', 'GBLABT02', SHA_K6_ARSIV, SHA_WRK_KAYNAK, 'http://tekprxv2.fw.garanti.com.tr:80', '/sw/BMW_PORTAL/nginx_loadtest']);
  assert.deepEqual(ar.aracEkstraDegiskenleriDenetle(ev), []);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_araclar_hazirla' && !x.result);
  assert.ok(d, 'basari denetime yazilmadi');
  assert.deepEqual(JSON.parse(d.detail), { aracId: 7, islem: 'araclar', derlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', wrkSurum: '4.2.0', k6ArsivSha256: SHA_K6_ARSIV, wrkKaynakSha256: SHA_WRK_KAYNAK, jobId: 950, awxServerId: 3, templateId: 44 });
  assert.match(D.gecmis[0][3], /^Nginx Yük Testi: araç hazırlama A7 GBLABT02$/);
  // Ikinci istek A|araclar'da durur (baska derleme makinesi de olsa; bagli is suruyor).
  D.awx = { status: 'running', artifacts: {} };
  process.env.NGINX_LOADTEST_DERLEME_HOSTLARI = 'GBLABT02,GBNGXT34';
  r = await istek('POST', '/araclar', { body: { derlemeHost: 'GBNGXT34' } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.kilit], [409, 'kilit_dolu', 'A|araclar']);
  assert.equal(r.body.message, 'Başka bir araç hazırlama işi sürüyor (onur: araç hazırlama GBLABT02, AWX iş #950). İş bitince kilit kendiliğinden bırakılır.');
  // Derleme makinesi bir yuk makinesiyse L| kilidi o makinedeki yuk isini bekletir.
  sifirla();
  process.env.NGINX_LOADTEST_DERLEME_HOSTLARI = 'GBNGXT34';
  D.kilitler.set('L|GBNGXT34', { id: 1, lock_key: 'L|GBNGXT34', held: 1, holder: 'ali', lock_id: 'baska', target_desc: 'yük testi GBNGXT33 <- GBNGXT34' });
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.kilit], [409, 'kilit_dolu', 'L|GBNGXT34']);
  assert.equal(D.kilitler.get('A|araclar').held, 0, 'alinan A|araclar birakilmadi');
  assert.deepEqual([D.launch.length, D.araclar.length], [0, 0]);
  // Env ozetleri buyuk harfli / bosluklu: kucuk harfe cevrilip gonderilir; vekilsiz. Hic set yokken de ayni.
  sifirla();
  ozetEnvKur({ k6: ` ${'AA'.repeat(32)}`, wrk: 'BB'.repeat(32) });
  process.env.NGINX_LOADTEST_ARAC_PROXY = 'yok';
  r = await istek('POST', '/araclar', { body: { derlemeHost: 'GBLABT02' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const s2 = D.araclar.find((x) => x.id === r.body.aracId);
  assert.deepEqual([s2.istenen_k6_arsiv_sha256, s2.istenen_wrk_kaynak_sha256], ['aa'.repeat(32), 'bb'.repeat(32)]);
  assert.deepEqual([D.launch[0][2].yuk_k6_arsiv_sha256, D.launch[0][2].yuk_wrk_kaynak_sha256, D.launch[0][2].yuk_proxy], ['aa'.repeat(32), 'bb'.repeat(32), '']);
  // AWX kesin red (4xx): kilit birakilir, satir FAILED.
  sifirla();
  D.launchHata = Object.assign(new Error('400 bad request'), { status: 400 });
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.deepEqual(tutulan(), []);
  assert.deepEqual([D.araclar[0].durum, D.araclar[0].awx_job_id], ['FAILED', null]);
  assert.match(D.araclar[0].hata, /AWX işi başlatılamadı/);
  // Belirsiz hata (ag / 5xx): is baslamis olabilir, kilit TTL'e kalir; satir FAILED.
  sifirla();
  D.launchHata = Object.assign(new Error('socket hang up'), {});
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.deepEqual(tutulan(), ['A|araclar', 'L|GBLABT02']);
  assert.equal(D.araclar[0].durum, 'FAILED');
  // Son kapi: kok /sw disinda (playbook kurali) -> 409 sinir_asildi, kilit birakilir, AWX'e gitmez.
  sifirla();
  process.env.NGINX_LOADTEST_DIR = '/data/nginx_loadtest';
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'sinir_asildi', 'Gönderilecek değişkenler son denetimi geçemedi: yuk_cikti_kok.']);
  assert.deepEqual([tutulan(), D.launch.length, D.araclar[0].durum, D.araclar[0].hata], [[], 0, 'FAILED', 'son kapı: yuk_cikti_kok']);
  // Satir yazilamadi: kilit birakilir, 424.
  sifirla();
  D.aracInsertHata = new Error('INSERT reddedildi');
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, tutulan(), D.launch.length], [424, 'db_okunamadi', [], 0]);
  // Sablon yoksa ne kilit ne satir.
  sifirla({ registry: null });
  r = await istek('POST', '/araclar', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, D.kilitler.size, D.araclar.length], [409, 'sablon_yok', 0, 0]);
});

// Sonuclandirma: calisan satir + set_stats.
function calisanSatir(ek = {}) {
  return {
    ...aracSatiri({ id: 7 }), durum: 'RUNNING', k6_sha256: null, wrk_sha256: null, k6_arsiv_sha256: null, wrk_kaynak_sha256: null, kaynak_onay: 0,
    onaylayan: null, onay_at: null, derleme_rhel: null, derleme_glibc: null, wrk_glibc_gerekli: null, sonuc: null, awx_server_id: 3, awx_job_id: 960,
    sonuclandirma_denemesi: 0, finished_at: null, finalized_at: null, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/7', created_at: new Date(), calisma_yas_sn: 300,
    ...ek,
  };
}
function aracStats(ek = {}, aek = {}) {
  return {
    surum: 2, run_id: '7', islem: 'araclar', durum: 'OK', hata: null, hedef_turu: null, motor: null, on_kontrol: null, kosu: null, durdur: null,
    araclar: {
      arac_id: 7, derleme_host: 'GBLABT02', derleme_rhel: '9', derleme_glibc: '2.34', derleme_os: 'Red Hat Enterprise Linux 9.4 (Plow)',
      k6_surum: 'v0.49.0', k6_surum_satiri: 'k6 v0.49.0 (go1.21.6, linux/amd64)', k6_sha256: SHA_K6, k6_arsiv_sha256: SHA_K6_ARSIV, k6_statik: true,
      wrk_surum: '4.2.0', wrk_surum_satiri: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: SHA_WRK, wrk_kaynak_sha256: SHA_WRK_KAYNAK, wrk_kaynak_sabit: false,
      wrk_glibc_gerekli: '2.34', wrk_openssl: 'OpenSSL 1.1.1i  8 Dec 2020', wrk_luajit: 'LuaJIT 2.1.0-beta3', wrk_kutuphaneler: 'linux-vdso.so.1,libm.so.6,libc.so.6',
      sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/7', ...aek,
    },
    ...ek,
  };
}
function kilitBagla(jid = 960) {
  for (const k of ['A|araclar', 'L|GBLABT02']) D.kilitler.set(k, { id: D.kilitler.size + 1, lock_key: k, held: 1, lock_id: 'arac-7', awx_server_id: 3, awx_job_id: jid, bag_turu: 'araclar' });
}

test('AR4 sonuclandirma: DONE / FAILED / CANCELED / OKUNAMADI, kaynak onayi, eski playbook, kilit karari', { timeout: 20000 }, async () => {
  const sonuc = async (satirEk, awx, kur = () => {}) => {
    sifirla({ araclar: [calisanSatir(satirEk)] });
    kilitBagla();
    D.awx = { status: 'successful', finished: '2026-11-02T10:30:00Z', ...awx };
    kur();
    const o = await ar.araclariSonuclandir();
    return { o, s: D.araclar[0] };
  };
  // DONE: kolonlar set_stats'tan (onay toreni yok: kaynak_onay yazilmaz).
  let { o, s } = await sonuc({}, { artifacts: { nginx_loadtest_result: aracStats() } });
  assert.deepEqual(o, { bayat: 0, kapanan: 1 });
  assert.deepEqual([s.durum, s.k6_sha256, s.wrk_sha256, s.k6_arsiv_sha256, s.wrk_kaynak_sha256, s.derleme_rhel, s.derleme_glibc, s.wrk_glibc_gerekli, s.hata],
    ['DONE', SHA_K6, SHA_WRK, SHA_K6_ARSIV, SHA_WRK_KAYNAK, '9', '2.34', '2.34', null]);
  assert.ok(!D.sorgular.some((x) => /kaynak_onay/.test(x.q)), 'DONE yazimi kaynak_onay e dokundu');
  assert.equal(JSON.parse(s.sonuc).araclar.wrk_openssl, 'OpenSSL 1.1.1i  8 Dec 2020');
  assert.deepEqual(tutulan(), [], 'basarili isin kilitleri birakilmadi');
  assert.equal(D.arsiv.length, 1);
  assert.doesNotMatch(D.arsiv[0][2], /gizli/, 'arsiv maskelenmedi');
  // PU3: AWX successful ama playbook durum HATA (araclar bolumu tam ve gecerli): FAILED, sha kolonlari NULL.
  ({ s } = await sonuc({}, { artifacts: { nginx_loadtest_result: aracStats({ durum: 'HATA', hata: 'rescue: /sw geri okumasi yarim' }) } }));
  assert.deepEqual([s.durum, s.hata, s.k6_sha256, s.wrk_sha256], ['FAILED', 'rescue: /sw geri okumasi yarim', null, null]);
  assert.ok(ar.aracGecerli(aracStats().araclar, calisanSatir()).ok, 'PU3 vakasinin araclar bolumu gecerli olmali');
  // D1: sabit ozetsiz baslatilmis eski is (istenen NULL) DONE olmaz.
  for (const ek of [{ istenen_wrk_kaynak_sha256: null }, { istenen_k6_arsiv_sha256: null }]) {
    ({ s } = await sonuc(ek, { artifacts: { nginx_loadtest_result: aracStats() } }));
    assert.deepEqual([s.durum, s.hata, s.k6_sha256], ['FAILED', 'iş sabit arşiv özetleri olmadan başlatılmış', null], JSON.stringify(ek));
  }
  // Gecersiz araclar bolumu -> FAILED + Turkce neden; sha kolonlari NULL kalir.
  for (const [ad, satirEk, aek, neden] of [
    ['sw dizini farkli', {}, { sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/8' }, '/sw dizini beklenenden farklı'],
    ['sw dizini yok', {}, { sw_dizin: null }, '/sw dizini beklenenden farklı'],
    ['sabit wrk kaynagi farkli', { istenen_wrk_kaynak_sha256: '1'.repeat(64) }, {}, 'wrk kaynak özeti sabit değerden farklı'],
    ['sabit k6 arsivi farkli', { istenen_k6_arsiv_sha256: '2'.repeat(64) }, {}, 'k6 arşiv özeti sabit değerden farklı'],
    ['k6 surum satiri', {}, { k6_surum_satiri: 'k6 v0.50.0 (go1.21.6, linux/amd64)' }, 'sürüm satırı beklenenle uyuşmuyor'],
    ['k6 surum satiri bitisik', {}, { k6_surum_satiri: 'k6 v0.49.01' }, 'sürüm satırı beklenenle uyuşmuyor'],
    ['wrk surum satiri', {}, { wrk_surum_satiri: 'wrk  [epoll] Copyright (C) 2012 Will Glozer' }, 'sürüm satırı beklenenle uyuşmuyor'],
    ['sha bozuk', {}, { wrk_sha256: 'X'.repeat(64) }, 'sha256 değerleri geçersiz'],
    ['arsiv sha yok', {}, { k6_arsiv_sha256: null }, 'sha256 değerleri geçersiz'],
    ['baska arac', {}, { arac_id: 8 }, 'araç sonucu eksik ya da bu işe ait değil'],
    ['baska derleme makinesi', {}, { derleme_host: 'GBNGXT34' }, 'araç sonucu eksik ya da bu işe ait değil'],
  ]) {
    ({ s } = await sonuc(satirEk, { artifacts: { nginx_loadtest_result: aracStats({}, aek) } }));
    assert.deepEqual([s.durum, s.hata, s.k6_sha256, s.wrk_sha256], ['FAILED', neden, null, null], ad);
  }
  ({ s } = await sonuc({}, { artifacts: { nginx_loadtest_result: { ...aracStats(), araclar: null } } }));
  assert.deepEqual([s.durum, s.hata], ['FAILED', 'araç sonucu eksik ya da bu işe ait değil']);
  // Playbook FAIL: hata metni playbook'tan; basarisiz isin kilitleri birakilir.
  ({ s } = await sonuc({}, { status: 'failed', artifacts: { nginx_loadtest_result: aracStats({ durum: 'FAIL', hata: 'derleme makinesi GBLABT02: indirme basarisiz (k6 arsivi): Request failed: <urlopen error Tunnel connection failed: 407>', araclar: null }) } }));
  assert.deepEqual([s.durum, s.hata], ['FAILED', 'derleme makinesi GBLABT02: indirme basarisiz (k6 arsivi): Request failed: <urlopen error Tunnel connection failed: 407>']);
  assert.deepEqual(tutulan(), []);
  // Eski playbook (araclar kipi yok): 1. assert yuk_islem'i reddeder -> ek not.
  ({ s } = await sonuc({}, { status: 'failed', artifacts: { nginx_loadtest_result: { surum: 2, run_id: '7', islem: 'araclar', durum: 'FAIL', hata: 'girdi reddedildi, hicbir sey yapilmadi: yuk_islem on_kontrol|kosu|durdur, yuk_run_id rakam, ...; hicbir sey yapilmadi.' } } }));
  assert.equal(s.durum, 'FAILED');
  assert.ok(s.hata.endsWith(' (Ansible deposu güncel değil: araclar kipi yok)'), s.hata);
  // PU1: arsiv sabit ozetle tutmadi (get_url / playbook metni) -> cikis yolu notu; ilgisiz indirme hatasina not YOK.
  for (const hm of [
    'derleme makinesi GBLABT02: indirme basarisiz (wrk kaynagi): The checksum for /sw/x/indir/wrk.tar.gz did not match ' + '1'.repeat(64) + '; it was ' + '2'.repeat(64) + '.',
    // Playbook fail_msg metinleri birebir (asagidaki ayna denetimi kaymayi yakalar).
    "derleme makinesi GBLABT02: k6 checksums dosyasinda k6-v0.49.0-linux-amd64.tar.gz icin tek satir yok ya da Portal'in sabit arsiv ozetiyle (NGINX_LOADTEST_K6_ARSIV_SHA256) farkli; hicbir sey indirilmedi ya da derlenmedi",
    'derleme makinesi GBLABT02: arsiv ozeti sabit degerden farkli (k6 aaaaaaaaaaaa... / beklenen bbbbbbbbbbbb..., wrk cccccccccccc... / beklenen dddddddddddd...); hicbir sey acilmadi, derlenmedi ya da calistirilmadi',
  ]) {
    ({ s } = await sonuc({}, { status: 'failed', artifacts: { nginx_loadtest_result: aracStats({ durum: 'FAIL', hata: hm, araclar: null }) } }));
    assert.deepEqual([s.durum, s.hata], ['FAILED', `${hm}${ar.OZET_FARKLI_NOTU}`]);
  }
  assert.match(ar.OZET_FARKLI_NOTU, /NGINX_LOADTEST_K6_ARSIV_SHA256 \/ NGINX_LOADTEST_WRK_KAYNAK_SHA256/);
  // Ayna playbook'taki iki "ozet farkli" fail_msg'i hala bu metinlerle duruyor mu (metin kayarsa not sessizce kaybolur).
  const yml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../ansible/bmw_portal/nginx_loadtest/nginx_loadtest.yml'), 'utf8');
  assert.ok(yml.includes("Portal'in sabit arsiv ozetiyle (NGINX_LOADTEST_K6_ARSIV_SHA256) farkli; hicbir sey indirilmedi ya da derlenmedi"), 'k6 checksums fail_msg degisti');
  assert.ok(yml.includes('fail_msg: "arsiv ozeti sabit degerden farkli (k6 '), 'arsiv yeniden denetim fail_msg degisti');
  // Uzun hata: not kesilmez, toplam <= 1000.
  ({ s } = await sonuc({}, { status: 'failed', artifacts: { nginx_loadtest_result: aracStats({ durum: 'FAIL', hata: `indirme basarisiz (k6 arsivi): did not match ${'x'.repeat(1500)}`, araclar: null }) } }));
  assert.ok(s.hata.endsWith(ar.OZET_FARKLI_NOTU) && s.hata.length <= 1000, String(s.hata.length));
  // Uyusmazlik: baska isin sonucu -> kullanilmaz (successful ise OKUNAMADI).
  ({ s } = await sonuc({}, { artifacts: { nginx_loadtest_result: aracStats({ run_id: '8' }) } }));
  assert.deepEqual([s.durum, s.hata], ['OKUNAMADI', 'yayınlanan sonuç bu işe ait değil (run_id 8)']);
  ({ s } = await sonuc({}, { artifacts: { nginx_loadtest_result: aracStats({ islem: 'on_kontrol' }) } }));
  assert.deepEqual([s.durum, s.hata], ['OKUNAMADI', 'yayınlanan sonuç bu işe ait değil (islem on_kontrol)']);
  // set_stats yok: successful -> OKUNAMADI, failed -> FAILED (jobExplanation).
  ({ s } = await sonuc({}, { artifacts: {} }));
  assert.deepEqual([s.durum, s.hata], ['OKUNAMADI', 'set_stats sonucu (nginx_loadtest_result) yok']);
  ({ s } = await sonuc({}, { status: 'failed', artifacts: {}, jobExplanation: 'Job terminated' }));
  assert.deepEqual([s.durum, s.hata], ['FAILED', 'Job terminated']);
  // Iptal: CANCELED; kilit TUTULUR (isten cozulur), uzakta derleme surebilir.
  ({ s } = await sonuc({}, { status: 'canceled', artifacts: {}, jobExplanation: 'iptal' }));
  assert.equal(s.durum, 'CANCELED');
  assert.deepEqual(tutulan(), ['A|araclar', 'L|GBLABT02']);
  assert.equal(D.kilitler.get('A|araclar').awx_job_id, null, 'iptal edilen isin kilidi isten cozulmedi');
  // error: FAILED + kilit tutulur.
  ({ s } = await sonuc({}, { status: 'error', artifacts: {} }));
  assert.equal(s.durum, 'FAILED');
  assert.deepEqual(tutulan(), ['A|araclar', 'L|GBLABT02']);
  // Deneme > 3: OKUNAMADI.
  ({ s } = await sonuc({ durum: 'FINALIZING', sonuclandirma_denemesi: 3 }, { artifacts: { nginx_loadtest_result: aracStats() } }));
  assert.deepEqual([s.durum, s.hata], ['OKUNAMADI', 'sonuç 3 denemede okunamadı']);
  // Suren is: QUEUED -> RUNNING, sahiplenme yok.
  sifirla({ araclar: [calisanSatir({ durum: 'QUEUED' })] });
  D.awx = { status: 'running', artifacts: {} };
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 0 });
  assert.equal(D.araclar[0].durum, 'RUNNING');
  // AWX okunamazsa satir degismez; 404 yalniz satir 1800 + 600 sn'den eskiyse "is yok" (OKUNAMADI).
  sifirla({ araclar: [calisanSatir()] });
  D.awxHata = Object.assign(new Error('not found'), { status: 404 });
  await ar.araclariSonuclandir();
  assert.equal(D.araclar[0].durum, 'RUNNING');
  sifirla({ araclar: [calisanSatir({ calisma_yas_sn: 2401 })] });
  D.awxHata = Object.assign(new Error('not found'), { status: 404 });
  await ar.araclariSonuclandir();
  assert.deepEqual([D.araclar[0].durum, D.araclar[0].hata], ['OKUNAMADI', 'AWX iş #960 artık yok']);
  // PU2: 404 disi okuma hatasi / AWX sunucusu yapilandirmadan kalkti: butce + pay + 12 sa'e dek satir RUNNING
  // (dugme kapali kalir), esigi gecince OKUNAMADI (kilit isten cozulur; 12 sa devralma zaten acmistir).
  assert.equal(ar.OKUNAMAZ_SURE_SN, 1800 + 600 + 12 * 3600);
  for (const [ad, hataNesnesi, kod] of [
    ['403', Object.assign(new Error('403 forbidden'), { status: 403 }), '403 forbidden'],
    ['sunucu yok', Object.assign(new Error('AWX sunucusu yok'), { status: 404, code: 'awx_server_missing' }), 'awx_server_missing'],
  ]) {
    sifirla({ araclar: [calisanSatir({ calisma_yas_sn: ar.OKUNAMAZ_SURE_SN })] });
    kilitBagla();
    D.awxHata = hataNesnesi;
    await ar.araclariSonuclandir();
    assert.equal(D.araclar[0].durum, 'RUNNING', `${ad}: esikte sonuclandi`);
    D.araclar[0].calisma_yas_sn = ar.OKUNAMAZ_SURE_SN + 1;
    await ar.araclariSonuclandir();
    assert.deepEqual([D.araclar[0].durum, D.araclar[0].hata], ['OKUNAMADI', `AWX iş #960 durumu 12 saatten uzun süredir okunamıyor (${kod})`], ad);
    assert.equal(D.arsiv.length, 0, `${ad}: okunamayan isin ciktisi arsivlenmeye calisildi`);
    assert.equal(D.kilitler.get('A|araclar').awx_job_id, null, `${ad}: kilit isten cozulmedi`);
  }
  // PU4: terminal is olay islemesini bitirmedi: 10 dk'dan yeni bittiyse beklenir (satir degismez, arsiv yok);
  // daha eskiyse sonuclandirilir. Bitis zamani yoksa satir butce + pay'i gecene dek beklenir.
  const olayli = (finished, yasSn = 300) => {
    sifirla({ araclar: [calisanSatir({ calisma_yas_sn: yasSn })] });
    kilitBagla();
    D.awx = { status: 'successful', eventProcessingFinished: false, finished, artifacts: { nginx_loadtest_result: aracStats() } };
  };
  olayli(new Date(Date.now() - 60 * 1000).toISOString());
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 0 });
  assert.deepEqual([D.araclar[0].durum, D.araclar[0].sonuclandirma_denemesi, D.arsiv.length, tutulan()], ['RUNNING', 0, 0, ['A|araclar', 'L|GBLABT02']]);
  olayli(new Date(Date.now() - 11 * 60 * 1000).toISOString());
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 1 });
  assert.deepEqual([D.araclar[0].durum, D.arsiv.length], ['DONE', 1]);
  olayli(null, 2400);
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 0 });
  olayli(null, 2401);
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 1 });
  // QUEUED satir olay beklerken RUNNING'e gecer.
  sifirla({ araclar: [calisanSatir({ durum: 'QUEUED' })] });
  D.awx = { status: 'failed', eventProcessingFinished: false, finished: new Date().toISOString(), artifacts: {} };
  await ar.araclariSonuclandir();
  assert.equal(D.araclar[0].durum, 'RUNNING');
  // Olay islemesi bitti (true) ya da alan yok: beklemez.
  sifirla({ araclar: [calisanSatir()] });
  D.awx = { status: 'successful', eventProcessingFinished: true, finished: new Date().toISOString(), artifacts: { nginx_loadtest_result: aracStats() } };
  assert.equal((await ar.araclariSonuclandir()).kapanan, 1);
  // TOP 5 sirasi (aclik kalkani): AWX'i okunamayan 6 ESKI satir yeni isi geride birakmaz; genc once, sonra en eski.
  sifirla({ araclar: [
    ...[1, 2, 3, 4, 5, 6].map((id) => calisanSatir({ id, awx_job_id: 800 + id, calisma_yas_sn: 5000 + id })),
    calisanSatir({ id: 9, awx_job_id: 960, calisma_yas_sn: 30 }),
    calisanSatir({ id: 8, awx_job_id: 959, calisma_yas_sn: 60 }),
  ] });
  const okunan = [];
  D.awxFn = (sid, jid) => {
    okunan.push(jid);
    if (jid > 900) return { jobId: jid, status: 'running', artifacts: {} };
    throw Object.assign(new Error('503'), { status: 503 });
  };
  await ar.araclariSonuclandir();
  assert.deepEqual(okunan, [960, 959, 801, 802, 803], 'genc isler once (en yeni once), sonra eskiler (en eski once)');
  // Eski satirlar esigi gecince en eskisi once kuyruktan cikar.
  for (const r of D.araclar) if (r.id <= 6) r.calisma_yas_sn = ar.OKUNAMAZ_SURE_SN + 10 - r.id;
  okunan.length = 0;
  await ar.araclariSonuclandir();
  assert.deepEqual(D.araclar.filter((x) => x.durum === 'OKUNAMADI').map((x) => x.id), [1, 2, 3]);
  // Sahiplenme CAS'i alinamazsa hicbir sey yazilmaz.
  sifirla({ araclar: [calisanSatir()], aracSahiplenmez: true });
  D.awx = { status: 'successful', artifacts: { nginx_loadtest_result: aracStats() } };
  assert.deepEqual(await ar.araclariSonuclandir(), { bayat: 0, kapanan: 0 });
  assert.equal(D.araclar[0].durum, 'RUNNING');
  // Bayat kuyruk: 15 dk'dan eski, is numarasiz QUEUED satir FAILED.
  sifirla({ araclar: [calisanSatir({ durum: 'QUEUED', awx_job_id: null, awx_server_id: null, created_at: new Date(Date.now() - 16 * 60000) }), calisanSatir({ id: 8, durum: 'QUEUED', awx_job_id: null, created_at: new Date() })] });
  assert.equal((await ar.araclariSonuclandir()).bayat, 1);
  assert.deepEqual(D.araclar.map((x) => [x.id, x.durum]), [[7, 'FAILED'], [8, 'QUEUED']]);
  assert.equal(D.araclar[0].hata, 'Başlatma tamamlanmadı (AWX iş numarası kaydedilemedi).');
  // aracGecerli saf: dogru durumda ok.
  assert.deepEqual(ar.aracGecerli(aracStats().araclar, calisanSatir()), { ok: true, neden: null });
});

test('AR5 etkinAracSeti ve GET /araclar: etkin / calisan / gecmis / ayar / kapi, vekil yalniz Admin', { timeout: 20000 }, async () => {
  sifirla({ araclar: [aracSatiri({ id: 2, istenen_k6_arsiv_sha256: '7'.repeat(64), k6_arsiv_sha256: '7'.repeat(64) }), aracSatiri({ id: 3 }),
    aracSatiri({ id: 4, durum: 'FAILED', k6_sha256: null, wrk_sha256: null, hata: 'derleme: make basarisiz (rc 2): x' }),
    aracSatiri({ id: 5, geri_ceken: 'ali', geri_cekme_at: new Date('2026-11-02T07:00:00Z') }), calisanSatir({ id: 6 })] });
  const vt = require('../../db/index.cjs');
  const e = await ar.etkinAracSeti(vt);
  assert.equal(e.id, 3, 'geri cekilmis / FAILED / baska ozetli set etkin sayildi');
  // env ozeti degisince #2 (o ozetle hazirlanmis) etkin olur; ikisi de tutmazsa set yok; ozet yoksa DB okunmaz.
  ozetEnvKur({ k6: '7'.repeat(64) });
  assert.equal((await ar.etkinAracSeti(vt)).id, 2);
  ozetEnvKur({ k6: '6'.repeat(64) });
  assert.equal(await ar.etkinAracSeti(vt), null);
  ozetEnvKur({ k6: null });
  const n0 = D.aracSorgular.length;
  assert.equal(await ar.etkinAracSeti(vt), null);
  assert.equal(D.aracSorgular.length, n0, 'ozet yokken arac tablosu okundu');
  ozetEnvKur();
  // Istenen VE kaydedilen ozetlerin dordu de esit olmali (biri NULL / farkliysa daha yeni set atlanir).
  for (const ek of [{ istenen_k6_arsiv_sha256: null }, { istenen_wrk_kaynak_sha256: null }, { k6_arsiv_sha256: '5'.repeat(64) }, { wrk_kaynak_sha256: '5'.repeat(64) }, { sw_dizin: null }]) {
    sifirla({ araclar: [aracSatiri({ id: 3 }), aracSatiri({ id: 4, ...ek })] });
    assert.equal((await ar.etkinAracSeti(vt)).id, 3, JSON.stringify(ek));
  }
  sifirla({ araclar: [aracSatiri({ id: 2, istenen_k6_arsiv_sha256: '7'.repeat(64), k6_arsiv_sha256: '7'.repeat(64) }), aracSatiri({ id: 3 }),
    aracSatiri({ id: 4, durum: 'FAILED', k6_sha256: null, wrk_sha256: null, hata: 'derleme: make basarisiz (rc 2): x' }),
    aracSatiri({ id: 5, geri_ceken: 'ali', geri_cekme_at: new Date('2026-11-02T07:00:00Z') }), calisanSatir({ id: 6 })] });
  let r = await istek('GET', '/araclar');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.etkin.id, 3);
  assert.equal(r.body.calisan.id, 6);
  assert.deepEqual(r.body.gecmis.map((x) => x.id), [6, 5, 4, 3, 2]);
  const g5 = r.body.gecmis.find((x) => x.id === 5);
  assert.deepEqual([g5.geriCekildi, g5.geriCeken, g5.geriCekmeAt, g5.ozetlerGuncel], [true, 'ali', '2026-11-02T07:00:00.000Z', true]);
  assert.equal(r.body.gecmis.find((x) => x.id === 2).ozetlerGuncel, false);
  assert.deepEqual(r.body.kapi, { kod: null, mesaj: null });
  assert.deepEqual(r.body.etkin, {
    id: 3, durum: 'DONE', derlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', wrkSurum: '4.2.0', k6Sha256: SHA_K6, wrkSha256: SHA_WRK, k6ArsivSha256: SHA_K6_ARSIV,
    wrkKaynakSha256: SHA_WRK_KAYNAK, ozetlerGuncel: true, geriCekildi: false, geriCeken: null, geriCekmeAt: null, calismaYasSn: 600, swDizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/3',
    derlemeRhel: '8', derlemeGlibc: '2.28', wrkGlibcGerekli: '2.17', wrkOpenssl: 'OpenSSL 1.1.1i  8 Dec 2020', wrkLuajit: 'LuaJIT 2.1.0-beta3', hata: null,
    awxServerId: 3, awxJobId: 703, awxUrl: 'https://awx.test.local/#/jobs/playbook/703/output', createdBy: 'onur', createdAt: '2026-11-01T08:00:00.000Z',
    startedAt: '2026-11-01T08:00:05.000Z', finishedAt: '2026-11-01T08:10:00.000Z',
  });
  // swDizin yalniz DONE iken; FAILED satirin hatasi gorunur.
  const f = r.body.gecmis.find((x) => x.id === 4);
  assert.deepEqual([f.swDizin, f.hata, r.body.calisan.swDizin], [null, 'derleme: make basarisiz (rc 2): x', null]);
  assert.deepEqual(r.body.ayar, {
    derlemeHostlari: ['GBLABT02'], varsayilanDerlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', wrkSurum: '4.2.0', proxyTanimli: true,
    proxy: 'http://tekprxv2.fw.garanti.com.tr:80', proxyHatasi: null, k6ArsivSha256: SHA_K6_ARSIV, wrkKaynakSha256: SHA_WRK_KAYNAK, ozetEksikleri: [],
    isSuresiSn: 2400,
  });
  // Admin disi okur ama vekil adresi null.
  r = await istek('GET', '/araclar', { session: KULLANICI });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.body.ayar.proxy, r.body.ayar.proxyTanimli, r.body.etkin.id], [null, true, 3]);
  // Hatali vekil: proxyHatasi, adres yok; vekilsiz: proxyTanimli false.
  process.env.NGINX_LOADTEST_ARAC_PROXY = 'https://x:80';
  r = await istek('GET', '/araclar');
  assert.deepEqual([r.body.ayar.proxy, r.body.ayar.proxyTanimli, r.body.ayar.proxyHatasi], [null, false, 'NGINX_LOADTEST_ARAC_PROXY geçersiz']);
  process.env.NGINX_LOADTEST_ARAC_PROXY = 'yok';
  r = await istek('GET', '/araclar');
  assert.deepEqual([r.body.ayar.proxy, r.body.ayar.proxyTanimli, r.body.ayar.proxyHatasi], [null, false, null]);
  // Hic set yok: etkin / calisan null, gecmis bos; kapi hazir degil.
  sifirla();
  r = await istek('GET', '/araclar');
  assert.deepEqual([r.body.etkin, r.body.calisan, r.body.gecmis, r.body.kapi.kod], [null, null, [], 'araclar_hazir_degil']);
  // Ozet env'i yok: ayar eksikleri ve kapi metni; set ozetleri guncel degil.
  sifirla({ araclar: [aracSatiri({ id: 3 })] });
  ozetEnvKur({ wrk: null });
  r = await istek('GET', '/araclar');
  assert.deepEqual([r.body.etkin, r.body.ayar.k6ArsivSha256, r.body.ayar.wrkKaynakSha256, r.body.ayar.ozetEksikleri, r.body.kapi.kod, r.body.gecmis[0].ozetlerGuncel],
    [null, SHA_K6_ARSIV, null, ['NGINX_LOADTEST_WRK_KAYNAK_SHA256 tanımlı değil'], 'araclar_ozet_sabit_yok', false]);
  assert.equal(r.body.kapi.mesaj, ar.ozetSabitYokMesaji(['NGINX_LOADTEST_WRK_KAYNAK_SHA256 tanımlı değil']));
  // Gecmis en cok 10.
  sifirla({ araclar: Array.from({ length: 12 }, (_, i) => aracSatiri({ id: i + 1, durum: 'FAILED' })) });
  r = await istek('GET', '/araclar');
  assert.deepEqual(r.body.gecmis.map((x) => x.id), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  // DB okunamazsa 424.
  sifirla();
  D.aracDbHata = new Error('x');
  r = await istek('GET', '/araclar');
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
});

test('AR6 POST /araclar/:id/geri-cek: retler, basari, denetim, etkin set duser, yaris', { timeout: 20000 }, async () => {
  const vt = require('../../db/index.cjs');
  sifirla({ araclar: [aracSatiri({ id: 4, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/4' }), aracSatiri({ id: 7, sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/7' }), aracSatiri({ id: 8, durum: 'FAILED' })] });
  let r = await istek('POST', '/araclar/7/geri-cek', { session: KULLANICI, body: {} });
  assert.equal(r.statusCode, 403, 'Admin olmayan gecti');
  assert.equal(D.araclar[1].geri_cekme_at, null);
  r = await istek('POST', '/araclar/x/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek']);
  r = await istek('POST', '/araclar/9/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'arac_yok', 'Araç seti bulunamadı.']);
  r = await istek('POST', '/araclar/8/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'arac_geri_cekilemez', 'Yalnız başarıyla hazırlanmış (DONE) bir araç seti geri çekilebilir.']);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_araclar_geri_cek' && x.result === 'fail'), 'ret denetime yazilmadi');
  assert.equal((await ar.etkinAracSeti(vt)).id, 7);
  // Basari: etkin #7 geri cekilir, etkin set #4'e duser.
  r = await istek('POST', '/araclar/7/geri-cek', { body: {} });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.arac.id, r.body.arac.geriCekildi, r.body.arac.geriCeken], [true, 7, true, 'onur']);
  assert.deepEqual(r.body.kapi, { hazir: true, aracId: 4, kod: null, mesaj: null });
  assert.equal(D.araclar[1].geri_ceken, 'onur');
  assert.ok(D.araclar[1].geri_cekme_at instanceof Date);
  assert.equal(D.araclar[1].durum, 'DONE', 'satirin durumu degisti');
  assert.equal((await ar.etkinAracSeti(vt)).id, 4);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_araclar_geri_cek' && !x.result);
  assert.ok(d, 'basari denetime yazilmadi');
  assert.equal(d.targetHost, 'GBLABT02');
  assert.deepEqual(JSON.parse(d.detail), { aracId: 7, etkindi: true, yeniEtkinAracId: 4, kapiKodu: null, k6Sha256: SHA_K6, wrkSha256: SHA_WRK });
  // Ikinci kez: zaten_geri_cekildi.
  r = await istek('POST', '/araclar/7/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'zaten_geri_cekildi', 'Bu araç seti zaten geri çekildi.']);
  // Son uygun set de geri cekilince set yok: kapi araclar_geri_cekildi; etkin olmayan setin denetiminde etkindi true.
  r = await istek('POST', '/araclar/4/geri-cek', { body: {} });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.kapi, { hazir: false, aracId: null, kod: 'araclar_geri_cekildi', mesaj: ar.MESAJ.geriCekildi });
  assert.equal(JSON.parse(D.denetim.filter((x) => x.eylem === 'nginx_loadtest_araclar_geri_cek' && !x.result).at(-1).detail).etkindi, true);
  assert.equal(await ar.etkinAracSeti(vt), null);
  // Etkin olmayan (baska ozetli) DONE set de geri cekilebilir (etkindi false).
  sifirla({ araclar: [aracSatiri({ id: 3 }), aracSatiri({ id: 6, istenen_k6_arsiv_sha256: '9'.repeat(64), k6_arsiv_sha256: '9'.repeat(64) })] });
  r = await istek('POST', '/araclar/6/geri-cek', { body: {} });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.kapi, { hazir: true, aracId: 3, kod: null, mesaj: null });
  assert.equal(JSON.parse(D.denetim.find((x) => x.eylem === 'nginx_loadtest_araclar_geri_cek' && !x.result).detail).etkindi, false);
  // Yaris: okuma geri cekilmemis gordu, UPDATE 0 satir -> zaten_geri_cekildi, denetim basarisi yok.
  sifirla({ araclar: [aracSatiri({ id: 7 })], aracGeriCekYarisi: true });
  r = await istek('POST', '/araclar/7/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'zaten_geri_cekildi']);
  assert.ok(!D.denetim.some((x) => x.eylem === 'nginx_loadtest_araclar_geri_cek' && !x.result));
  // DB okunamazsa 424.
  sifirla({ araclar: [aracSatiri({ id: 7 })] });
  D.aracDbHata = new Error('x');
  r = await istek('POST', '/araclar/7/geri-cek', { body: {} });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
  // Eski onay toreni ucu yok (yonlendirici eslemez), modulde aracOnayla yok.
  sifirla({ araclar: [aracSatiri({ id: 7 })] });
  r = await istek('POST', '/araclar/7/onayla', { body: { onayMetni: 'ffffffffffff' } });
  assert.equal(r.statusCode, 'sonraki');
  assert.equal(ar.aracOnayla, undefined);
});

test('AR7 DB kurulumu (Portal DB): nginx_loadtest_araclar kolonlari, kosular.arac_id CREATE + ALTER, IX_nlarac_job', () => {
  const kod = require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const tablo = (ad) => {
    const m = new RegExp(`name: '${ad}',\\s*sql: \`\\s*CREATE TABLE ${ad} \\(([\\s\\S]*?)\\n\\s*\\)\``).exec(kod);
    assert.ok(m, `${ad} CREATE TABLE bulunamadi`);
    return m[1].split('\n').map((x) => x.trim().replace(/,$/, '')).filter(Boolean);
  };
  // Kilit tablosunun ARDINDAN (setup INFORMATION_SCHEMA ile var olani atlar).
  assert.ok(kod.indexOf("name: 'nginx_loadtest_araclar'") > kod.indexOf("name: 'nginx_loadtest_kilitleri'"), 'tablo kilit tablosundan once');
  assert.deepEqual(tablo('nginx_loadtest_araclar').map((x) => x.replace(/\s+/g, ' ')), [
    'id INT IDENTITY(1,1) PRIMARY KEY', 'durum NVARCHAR(20) NOT NULL', 'derleme_host NVARCHAR(64) NOT NULL', 'k6_surum NVARCHAR(20) NOT NULL',
    'wrk_surum NVARCHAR(20) NOT NULL', 'istenen_k6_arsiv_sha256 CHAR(64) NULL', 'istenen_wrk_kaynak_sha256 CHAR(64) NULL', 'k6_sha256 CHAR(64) NULL',
    'wrk_sha256 CHAR(64) NULL', 'k6_arsiv_sha256 CHAR(64) NULL', 'wrk_kaynak_sha256 CHAR(64) NULL', 'kaynak_onay BIT NOT NULL DEFAULT 0',
    'onaylayan NVARCHAR(100) NULL', 'onay_at DATETIME2 NULL', 'sw_dizin NVARCHAR(400) NULL', 'derleme_rhel NVARCHAR(8) NULL', 'derleme_glibc NVARCHAR(16) NULL',
    'wrk_glibc_gerekli NVARCHAR(16) NULL', 'hata NVARCHAR(1000) NULL', 'sonuc NVARCHAR(MAX) NULL', 'awx_server_id INT NULL', 'awx_job_id INT NULL',
    'kilit_id NVARCHAR(64) NULL', 'sonuclandirma_denemesi INT NOT NULL DEFAULT 0', 'created_by NVARCHAR(100) NULL',
    'created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()', 'started_at DATETIME2 NULL', 'finished_at DATETIME2 NULL', 'finalized_at DATETIME2 NULL',
    'geri_ceken NVARCHAR(100) NULL', 'geri_cekme_at DATETIME2 NULL',
  ]);
  // D2 kolonlari onceki surumle yaratilmis tabloya da eklenir (idempotent ALTER; yikici goc yok).
  assert.match(kod, /table: 'nginx_loadtest_araclar',\s*col: 'geri_ceken',\s*sql: `ALTER TABLE nginx_loadtest_araclar ADD geri_ceken NVARCHAR\(100\) NULL`/);
  assert.match(kod, /table: 'nginx_loadtest_araclar',\s*col: 'geri_cekme_at',\s*sql: `ALTER TABLE nginx_loadtest_araclar ADD geri_cekme_at DATETIME2 NULL`/);
  // Kodun okudugu her kolon tabloda var (ARAC_KOLONLARI).
  const kolonlar = new Set(tablo('nginx_loadtest_araclar').map((x) => x.split(/\s+/)[0]));
  for (const k of ar.ARAC_KOLONLARI.replace(/DATEDIFF\(.*$/s, '').split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(kolonlar.has(k), `kolon yok: ${k}`);
  assert.ok(tablo('nginx_loadtest_kosular').map((x) => x.replace(/\s+/g, ' ')).includes('arac_id INT NULL'), 'kosular CREATE arac_id yok');
  assert.match(kod, /table: 'nginx_loadtest_kosular',\s*col: 'arac_id',\s*sql: `ALTER TABLE nginx_loadtest_kosular ADD arac_id INT NULL`/);
  assert.match(kod, /\{ name: 'IX_nlarac_job', table: 'nginx_loadtest_araclar', cols: 'awx_server_id, awx_job_id' \}/);
  // TBMWANS'a yazilmaz: arac modulu envanter (TBMWANS) baglantisini kullanmaz.
  const arKod = require('node:fs').readFileSync(path.join(__dirname, '..', 'araclar.cjs'), 'utf8');
  assert.doesNotMatch(arKod, /inventory\/mssql\.cjs|dbo\./, 'arac modulu TBMWANS e dokunuyor');
});
