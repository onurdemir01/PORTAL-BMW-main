// server/retirement/__tests__/is-ciktisi.test.cjs - RC1..RC7, RC9, RC10, RC12..RC23 (2026-10-26).
//
// Retirement "Is ciktisi": hedefin bilinen AWX isleri (hedefIsleri) + salt okunur cikti ucu
// (GET /:id/targets/:tid/is-ciktisi). Kurallar (bkz. ../is-ciktisi.cjs):
//   - istemci sunucu / is numarasi vermez; is hedef alanindan, sunucu saklanan kayittan ya da TEK gecmis satirindan
//   - isin playbook'u (ve gecmisteki template'i) adimla eslesmeli
//   - surerken artimli, bitince onbellek silinir + tam cekim + MASKELI arsiv
//   - cikti her yolda maskeli (canli, arsive giden, arsivden okunan)
//   - hedefe / olaylara / gecmise YAZMAZ; 409 kalici, 424 gecici
// Uc, bagimliliklari enjekte edilerek kosulur (db / runner / onbellek sahte); MASKE GERCEK zincirdir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../is-ciktisi.cjs');
const { BEKLENEN_PLAYBOOK } = require('../../ansible/template-preflight.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const MOD = fs.readFileSync(path.join(__dirname, '..', 'is-ciktisi.cjs'), 'utf8');
const RUNNER = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');
const dilim = (src, bas, son) => {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `bulunamadi: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `son bulunamadi: ${son}`);
  return src.slice(i, j);
};

const IZIN = ['onay:A|JBoss8|GBJBOT01', 'mv:/vhosting8/A.ear'];
const WEB = [
  { host: 'GBWEB01', serverName: 'a.x.com', product: 'IHS', confFile: 'a.conf', status: 'ok', jobId: 510, awxServerId: 1, message: 'is #510', basladi: '2026-10-21T10:01:00Z', bitti: '2026-10-21T10:03:00Z' },
  { host: 'GBWEB02', serverName: 'b.x.com', product: 'NGINX', confFile: 'b.conf', status: 'manual', jobId: null, message: 'elle' },
  { host: 'GBWEB03', serverName: 'c.x.com', product: 'IHS', confFile: 'c.conf', status: 'running', jobId: 511, message: 'is #511' },
];
const hedef = (o = {}) => ({
  id: 9, record_id: 5, host: 'GBJBOT01', app_name: 'A', jboss_gen: 8, status: 'stopped',
  last_job_id: 500, stop_izin_json: JSON.stringify({ jobId: 400, at: '2026-10-20T10:00:00Z', izinler: IZIN }),
  delete_job_id: null, rollback_job_id: null, delete_onkontrol_json: null, rollback_onkontrol_json: null,
  web_result_json: JSON.stringify(WEB), stopped_at: '2026-10-21T10:05:00Z', deleted_at: null, rolled_back_at: null, ...o,
});
const gs = (jobId, sunucu, planOnly, o = {}) => ({
  job_id: jobId, awx_server_id: sunucu, template_id: o.template_id ?? 77,
  template_name: o.template_name ?? (planOnly ? 'Retirement: plan A @ GBJBOT01' : 'Retirement: STOP A @ GBJBOT01'),
  username: o.username ?? 'onur', started_at: new Date('2026-10-21T09:00:00Z'),
  // Retirement launch'inin yazdigi bicim: sunucu + uygulama + JBoss surumu (index.cjs extraVars).
  params: JSON.stringify(o.params ?? { target_host: o.host ?? 'GBJBOT01', application: o.app ?? 'A', jboss_gen: o.gen ?? '8', plan_only: planOnly }),
});
const STANDART_GECMIS = [gs(400, 1, true), gs(500, 1, false)];

function sahteRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

/** Ucu sahte bagimliliklarla kurar. `dbHata`: SQL'i eslesen sorgu firlatir. */
function kur({ t = hedef(), gecmis = STANDART_GECMIS, arsiv = null, dbHata = null, durum = 'successful', durumHata = null,
  cikti = 'PLAY RECAP ok=3', playbook = 'app_retirement_stop.yml', templateId = 77, aciklama = '', epf, sunucular = { 1: { id: 1, name: 'maestro', url: 'https://awx1.test/' } } } = {}) {
  const sorgular = [];
  const cagri = { durum: [], cikti: [], sil: [], audit: [] };
  const db = {
    query: async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      sorgular.push({ sql: s, params });
      if (dbHata && dbHata.test(s)) throw new Error('baglanti koptu');
      if (/^SELECT \* FROM retirement_targets/.test(s)) {
        // SQL'IN KENDISI OLCULUR: record_id kosulu kalkarsa baska kaydin hedefi de doner.
        const kayitKosulu = /record_id = \$2/.test(s);
        const ok = t && Number(params[0]) === t.id && (!kayitKosulu || Number(params[1]) === t.record_id);
        return { rows: ok ? [t] : [] };
      }
      if (s.includes('FROM ansible_job_history')) return { rows: gecmis.filter((g) => params.map(Number).includes(g.job_id)) };
      if (/^SELECT TOP 1 stdout/.test(s)) return { rows: arsiv ? [arsiv] : [] };
      if (/^SELECT 1 FROM ansible_job_output/.test(s)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };
  const runner = {
    getJobStatusOnServer: async (sid, jid) => {
      cagri.durum.push([sid, jid]);
      if (durumHata) throw durumHata;
      return { status: durum, playbook: `bmw_automation_folder/${playbook}`, templateId, started: '2026-10-21T09:00:05Z', finished: null, elapsed: 12.5, jobExplanation: aciklama, resultTraceback: aciklama, eventProcessingFinished: epf };
    },
    getJobOutputOnServer: async (sid, jid, o) => {
      cagri.cikti.push([sid, jid, o]);
      return { output: cikti };
    },
    getServerById: (sid) => sunucular[sid] || null,
  };
  const stdoutCache = { sil: (sid, jid) => cagri.sil.push({ sid, jid, ciktiSayisi: cagri.cikti.length }) };
  let isleyici = null;
  M.mount({ get: (yol, h) => { assert.equal(yol, '/:id/targets/:tid/is-ciktisi'); isleyici = h; } }, {
    db: () => db, runner: () => runner, stdoutCache: () => stdoutCache, beklenenPlaybook: () => BEKLENEN_PLAYBOOK,
    audit: (_req, d) => cagri.audit.push(d),
  });
  const istek = async (query, params = { id: '5', tid: '9' }) => {
    const res = sahteRes();
    await isleyici({ params, query }, res);
    return res;
  };
  const yazimlar = () => sorgular.filter((x) => !/^SELECT/.test(x.sql));
  return { istek, sorgular, cagri, yazimlar };
}

test('RC1 baska kaydin hedefi 409 hedef_yok ve AWX HIC cagrilmaz; istemcinin jobId / serverId parametresi yok sayilir', async () => {
  const k = kur();
  const r = await k.istek({ adim: 'stop' }, { id: '6', tid: '9' });
  assert.equal(r.statusCode, 409);
  assert.deepEqual([r.body.ok, r.body.code, r.body.kalici], [false, 'hedef_yok', true]);
  assert.equal(k.cagri.durum.length + k.cagri.cikti.length, 0, 'yabanci hedefin isi icin AWX okundu');
  assert.deepEqual(k.cagri.audit.map((a) => a.code), ['hedef_yok'], 'reddedilen erisim denetime yazilmadi');

  const k2 = kur();
  const r2 = await k2.istek({ adim: 'stop', jobId: '999', serverId: '7', awxServerId: '7' });
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(k2.cagri.durum, [[1, 500]], 'istemcinin verdigi is / sunucu okundu');
  assert.equal(r2.body.jobId, 500);
  assert.equal(r2.body.awxServerId, 1);
  assert.ok(!/jobId|serverId/.test(dilim(MOD, 'async function isCiktisi', 'const db = d.db();').replace(/web/g, '')), 'uc istemciden is / sunucu okuyor');
});

test('RC2 sunucu kayittan / TEK gecmis satirindan; belirsizse ya da playbook / template tutmazsa cikti OKUNMAZ', async () => {
  // (a) ayni numara baska sunucuda BASKA hedefin isi: hedef sunucusu params'ta degil -> karismaz.
  const a = kur({ gecmis: [...STANDART_GECMIS, gs(500, 2, false, { host: 'GBJBOT77' })] });
  const ra = await a.istek({ adim: 'stop' });
  assert.equal(ra.statusCode, 200, JSON.stringify(ra.body));
  assert.deepEqual(a.cagri.durum, [[1, 500]]);
  // (b) ayni hedef, ayni is no, IKI sunucu -> belirsiz, AWX hic okunmaz (tahmin yok).
  const b = kur({ gecmis: [...STANDART_GECMIS, gs(500, 2, false)] });
  const rb = await b.istek({ adim: 'stop' });
  assert.deepEqual([rb.statusCode, rb.body.code, rb.body.kalici], [409, 'sunucu_belirsiz', true]);
  assert.equal(b.cagri.durum.length + b.cagri.cikti.length, 0);
  // (c) gecmis yok -> sunucu kanitlanamaz (Playbook Kayitlarina DUSULMEZ).
  const c = kur({ gecmis: [] });
  const rc = await c.istek({ adim: 'onkontrol' });
  assert.deepEqual([rc.statusCode, rc.body.code], [409, 'sunucu_belirsiz']);
  assert.equal(c.cagri.durum.length, 0);
  // (d) AWX'teki is baska playbook -> 409, stdout istenmez.
  const d = kur({ playbook: 'app_retirement_rollback.yml' });
  const rd = await d.istek({ adim: 'stop' });
  assert.deepEqual([rd.statusCode, rd.body.code], [409, 'template_uyusmuyor']);
  assert.equal(d.cagri.cikti.length, 0, 'baska playbook kosan isin ciktisi istendi');
  // (e) gecmisteki template ile AWX'inki farkli -> 409.
  const e = kur({ templateId: 88 });
  const re = await e.istek({ adim: 'stop' });
  assert.deepEqual([re.statusCode, re.body.code], [409, 'template_uyusmuyor']);
  assert.equal(e.cagri.cikti.length, 0);
  // (f) web: sunucu girdinin KENDI awxServerId'si; yoksa belirsiz.
  const f = kur({ playbook: 'server_hub_fix.yml' });
  const rf = await f.istek({ adim: 'web', web: '0' });
  assert.equal(rf.statusCode, 200, JSON.stringify(rf.body));
  assert.deepEqual(f.cagri.durum, [[1, 510]]);
  const rf2 = await f.istek({ adim: 'web', web: '2' });
  assert.deepEqual([rf2.statusCode, rf2.body.code], [409, 'sunucu_belirsiz'], 'awxServerId olmayan web isi tahminle okundu');
  // (g) adimin isi yoksa 409 is_yok; web sirasi aralik disi / adimsiz web 400.
  const g = kur();
  assert.deepEqual([(await g.istek({ adim: 'delete' })).body.code], ['is_yok']);
  assert.equal((await g.istek({ adim: 'web', web: '1' })).body.code, 'is_yok');
  for (const q of [{ adim: 'web', web: '3' }, { adim: 'web' }, { adim: 'stop', web: '0' }, { adim: 'bilinmeyen' }, { adim: 'web', web: '-1' }]) {
    const r = await g.istek(q);
    assert.deepEqual([r.statusCode, r.body.code, r.body.kalici], [400, 'gecersiz', true], JSON.stringify(q));
  }
  assert.equal(g.cagri.durum.length, 0);
  assert.deepEqual(b.cagri.audit.map((x) => x.code), ['sunucu_belirsiz']);
  assert.deepEqual(d.cagri.audit.map((x) => x.code), ['template_uyusmuyor']);
});

test('RC3 DB okunamazsa 424 olculemedi (gecici) ve AWX okunmaz; arsiv okunamazsa da 424', async () => {
  for (const desen of [/FROM retirement_targets/, /FROM ansible_job_history/]) {
    const k = kur({ dbHata: desen });
    const r = await k.istek({ adim: 'stop' });
    assert.deepEqual([r.statusCode, r.body.code, r.body.kalici], [424, 'olculemedi', false], String(desen));
    assert.equal(k.cagri.durum.length, 0, `${desen}: DB okunamadi ama AWX okundu`);
  }
  const k = kur({ dbHata: /FROM ansible_job_output/, durumHata: Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' }) });
  const r = await k.istek({ adim: 'stop' });
  assert.deepEqual([r.statusCode, r.body.code, r.body.kalici], [424, 'olculemedi', false]);
});

test('RC4 cikti MASKELI: canli yanit, arsive giden ve arsivden okunan; sunucu tokeni, parola desenleri, Bearer', async () => {
  const eski = [process.env.AWX_7_URL, process.env.AWX_7_TOKEN];
  process.env.AWX_7_URL = 'https://awx7.test';
  process.env.AWX_7_TOKEN = 'SunucuTokeni7xyz';
  try {
    const sirli = [
      'TASK [x] password=Gizli1Parola',
      "<host> EXEC /bin/sh -c 'TBMWANS_PWD='Gizli2Parola' python3 loader.py'",
      'Authorization: Bearer Gizli3Token',
      'token SunucuTokeni7xyz',
      '"environment": {"TBMWANS_PWD": "Gizli5Parola"}',
    ].join('\n');
    const SIRLAR = ['Gizli1Parola', 'Gizli2Parola', 'Gizli3Token', 'SunucuTokeni7xyz', 'Gizli5Parola'];
    const temiz = (s, ne) => { for (const x of SIRLAR) assert.ok(!String(s).includes(x), `${ne}: ${x} maskelenmedi`); };
    // canli + arsive giden
    const k = kur({ cikti: sirli, durum: 'failed' });
    const r = await k.istek({ adim: 'stop' });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    temiz(r.body.output, 'ekran');
    assert.match(r.body.output, /\*\*\*/);
    const ins = k.yazimlar().find((x) => /^INSERT INTO ansible_job_output/.test(x.sql));
    assert.ok(ins, 'biten is arsivlenmedi');
    temiz(ins.params[2], 'arsiv');
    // arsivden okunan (ss/job-status daha once HAM yazmis olabilir)
    const a = kur({ arsiv: { stdout: sirli, fetched_at: new Date('2026-10-22T00:00:00Z') }, durumHata: Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' }) });
    const ra = await a.istek({ adim: 'stop' });
    assert.equal(ra.body.kaynak, 'arsiv');
    temiz(ra.body.output, 'arsivden okunan');
    // AWX'in hata alanlari da (erken hatada stdout bos, sebep bu alanlarda)
    const h = kur({ durum: 'error', cikti: '', aciklama: sirli });
    const rh = await h.istek({ adim: 'stop' });
    assert.equal(rh.statusCode, 200);
    temiz(rh.body.jobExplanation, 'jobExplanation');
    temiz(rh.body.resultTraceback, 'resultTraceback');
    assert.equal(h.yazimlar().length, 0, 'bos cikti arsivlendi');
  } finally {
    if (eski[0] === undefined) delete process.env.AWX_7_URL; else process.env.AWX_7_URL = eski[0];
    if (eski[1] === undefined) delete process.env.AWX_7_TOKEN; else process.env.AWX_7_TOKEN = eski[1];
  }
});

test('RC5 surerken artimli ve onbellek SILINMEZ; bitince once onbellek silinir, sonra TAM cekim ve tek arsiv', async () => {
  const s = kur({ durum: 'running' });
  const r = await s.istek({ adim: 'stop' });
  assert.equal(r.body.bitti, false);
  assert.deepEqual(s.cagri.cikti, [[1, 500, { artimli: true }]]);
  assert.equal(s.cagri.sil.length, 0, 'suren isin onbellegi silindi');
  assert.equal(s.yazimlar().length, 0, 'suren is arsivlendi');

  const b = kur({ durum: 'successful' });
  const rb = await b.istek({ adim: 'stop' });
  assert.equal(rb.body.bitti, true);
  assert.deepEqual(b.cagri.cikti, [[1, 500, { artimli: false }]]);
  assert.deepEqual(b.cagri.sil, [{ sid: 1, jid: 500, ciktiSayisi: 0 }], 'onbellek tam cekimden ONCE silinmedi');
  assert.equal(b.yazimlar().filter((x) => /^INSERT INTO ansible_job_output/.test(x.sql)).length, 1);
});

test('RC6 AWX sunucusu kapali / is AWX\'te yok: arsiv varsa kaynak arsiv, yoksa 409 kalici; baska hata 424', async () => {
  const kapali = () => Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' });
  const ARSIV = { stdout: 'eski cikti', fetched_at: new Date('2026-10-22T08:00:00Z') };
  const a = kur({ durumHata: kapali(), arsiv: ARSIV });
  const ra = await a.istek({ adim: 'stop' });
  assert.equal(ra.statusCode, 200);
  assert.deepEqual([ra.body.ok, ra.body.kaynak, ra.body.status, ra.body.bitti, ra.body.output, ra.body.awxUrl], [true, 'arsiv', null, true, 'eski cikti', null]);
  assert.equal(ra.body.arsivTarihi, '2026-10-22T08:00:00.000Z');
  assert.match(ra.body.uyari, /devre dışı bırakıldı/);
  assert.equal(a.cagri.cikti.length, 0);

  const b = kur({ durumHata: kapali() });
  const rb = await b.istek({ adim: 'stop' });
  assert.deepEqual([rb.statusCode, rb.body.code, rb.body.kalici], [409, 'awx_server_missing', true]);
  assert.match(rb.body.message, /devre dışı bırakıldı.*arşivinde de yok/);

  const c = kur({ durumHata: Object.assign(new Error('AWX HTTP 404: Not found'), { status: 404 }) });
  const rc = await c.istek({ adim: 'stop' });
  assert.deepEqual([rc.statusCode, rc.body.code, rc.body.kalici], [409, 'awx_job_missing', true]);
  const c2 = kur({ durumHata: Object.assign(new Error('AWX HTTP 404'), { status: 404 }), arsiv: ARSIV });
  assert.equal((await c2.istek({ adim: 'stop' })).body.kaynak, 'arsiv');

  const d = kur({ durumHata: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  const rd = await d.istek({ adim: 'stop' });
  assert.deepEqual([rd.statusCode, rd.body.code, rd.body.kalici], [424, 'awx_okunamadi', false]);
  // Beklenmeyen hata 500 (gecitte HTML) degil 424.
  const e = kur({ sunucular: new Proxy({}, { get: () => { throw new Error('beklenmeyen'); } }) });
  const re = await e.istek({ adim: 'stop' });
  assert.deepEqual([re.statusCode, re.body.code, re.body.kalici], [424, 'olculemedi', false]);
});

test('RC7 uc hedefe, olaylara ve is gecmisine YAZMAZ; tek yazim arsiv INSERT\'u', async () => {
  const senaryolar = [
    kur({ durum: 'successful' }), kur({ durum: 'running' }), kur({ playbook: 'x.yml' }),
    kur({ durumHata: Object.assign(new Error('x'), { status: 404, code: 'awx_server_missing' }), arsiv: { stdout: 'a', fetched_at: null } }),
  ];
  for (const k of senaryolar) {
    await k.istek({ adim: 'stop' });
    await k.istek({ adim: 'onkontrol' });
    for (const y of k.yazimlar()) assert.match(y.sql, /^INSERT INTO ansible_job_output \(awx_server_id, job_id, stdout\)/, `yasak yazim: ${y.sql}`);
  }
  const kod = MOD.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/UPDATE\s|DELETE\s+FROM|INSERT INTO (?!ansible_job_output)/.test(kod), 'modulde arsiv disi yazim var');
  assert.ok(!/addEvent|retirement_events|launchJobOnServer|cancelJob/.test(kod), 'modul olay yaziyor ya da is baslatiyor');
});

test('RC9 hedefIsleri: kaynak alanlar, pipeline sirasi, durum, kaynak ve sunucu kapali; sunucu numarasi istemciye gitmez', () => {
  const t = hedef({
    status: 'deleting', delete_job_id: 700,
    delete_onkontrol_json: JSON.stringify({ jobId: 650, awxServerId: 2, durum: 'ok', at: '2026-10-25T19:45:00Z', kaynak: 'zamanlayici', kullanildi: true }),
    rollback_onkontrol_json: JSON.stringify({ jobId: 600, awxServerId: 1, durum: 'running', at: '2026-10-24T10:00:00Z', kaynak: 'elle' }),
  });
  const gecmis = [...STANDART_GECMIS, gs(700, 2, false, { template_name: 'Retirement: DELETE A @ GBJBOT01', username: 'Portal (zamanlanmis)' })];
  const { awxIsleri, awxIsleriEksik } = M.hedefIsleri(t, gecmis, { sunucuVar: (id) => id === 1 });
  assert.equal(awxIsleriEksik, undefined);
  assert.deepEqual(awxIsleri.map((x) => [x.adim, x.web ?? null, x.jobId, x.durum]), [
    ['onkontrol', null, 400, 'basarili'],
    ['stop', null, 500, 'basarili'],
    ['web', 0, 510, 'basarili'],
    ['web', 2, 511, 'suruyor'],
    ['delete_onkontrol', null, 650, 'basarili'],
    ['delete', null, 700, 'suruyor'],
    ['rollback_onkontrol', null, 600, 'suruyor'],
  ]);
  const by = (a) => awxIsleri.find((x) => x.adim === a);
  assert.equal(by('delete').kaynak, 'zamanlayici');
  assert.equal(by('stop').kaynak, 'elle');
  assert.equal(by('delete_onkontrol').kaynak, 'zamanlayici');
  assert.equal(by('delete').sunucuKapali, true, 'kapali sunucudaki is isaretlenmedi');
  assert.equal(by('stop').sunucuKapali, false);
  assert.equal(awxIsleri.find((x) => x.jobId === 511).sunucuKapali, undefined, 'sunucusu bilinmeyen is icin kapali/acik uyduruldu');
  assert.equal(by('stop').bitti, '2026-10-21T10:05:00Z');
  assert.equal(by('stop').basladi, '2026-10-21T09:00:00.000Z');
  assert.equal(by('rollback_onkontrol').bitti, null);
  assert.ok(awxIsleri.every((x) => !('awxServerId' in x) && !('_sunucu' in x) && !('serverId' in x)), 'sunucu numarasi istemciye gidiyor');
  // durumlar
  const d = (o, g = STANDART_GECMIS) => M.hedefIsleri(hedef(o), g).awxIsleri;
  assert.equal(d({ status: 'planning', last_job_id: 401, stop_izin_json: null }, [gs(401, 1, true)]).find((x) => x.adim === 'onkontrol').durum, 'suruyor');
  assert.equal(d({ status: 'failed', last_job_id: 402, stop_izin_json: null }, [gs(402, 1, true)]).find((x) => x.adim === 'onkontrol').durum, 'basarisiz');
  assert.equal(d({ status: 'failed' }).find((x) => x.adim === 'stop').durum, 'basarisiz');
  assert.equal(d({ status: 'stopping' }).find((x) => x.adim === 'stop').durum, 'suruyor');
  assert.equal(d({ status: 'rolling_back', rollback_job_id: 800 }, [...STANDART_GECMIS, gs(800, 1, false, { template_name: 'Retirement: GERI AL A @ GBJBOT01' })]).find((x) => x.adim === 'rollback').durum, 'suruyor');
  // restore_manual / restore_failed: geri acma baslamadi, is no hala BASARILI kaldirma isi
  const webR = JSON.stringify([{ ...WEB[0], status: 'restore_failed' }, { ...WEB[0], status: 'restoring', jobId: 900, awxServerId: 3 }]);
  assert.deepEqual(d({ web_result_json: webR }).filter((x) => x.adim === 'web').map((x) => x.durum), ['basarili', 'suruyor']);
});

test('RC10 KANITLANAMAYAN is listeye konmaz: gecmis yok ve kod degismezi yok -> awxIsleriEksik; celiskili gecmis de', () => {
  // claim penceresi: 'stopping' ama last_job_id gecmiste yok ve izin listesi baska iste
  const a = M.hedefIsleri(hedef({ status: 'stopping', last_job_id: 555 }), STANDART_GECMIS);
  assert.equal(a.awxIsleriEksik, true);
  assert.ok(!a.awxIsleri.some((x) => x.jobId === 555), 'kanitlanamayan is listede');
  assert.ok(a.awxIsleri.some((x) => x.adim === 'onkontrol' && x.jobId === 400), 'izin listesindeki on kontrol de dustu');
  // ayni is hem plan hem STOP diye yazilmis -> celiski
  const b = M.hedefIsleri(hedef(), [gs(400, 1, true), gs(500, 1, false), gs(500, 1, true)]);
  assert.equal(b.awxIsleriEksik, true);
  assert.ok(!b.awxIsleri.some((x) => x.jobId === 500));
  // gecmis okunamadi (null): kod degismezleri yine kanit (izin listesinin isi = on kontrol; 'planning' = on kontrol)
  const c = M.hedefIsleri(hedef({ status: 'planning', last_job_id: 401, stop_izin_json: null }), null);
  assert.deepEqual(c.awxIsleri.map((x) => [x.adim, x.jobId]).slice(0, 1), [['onkontrol', 401]]);
  assert.equal(c.awxIsleriEksik, undefined);
  const e = M.hedefIsleri(hedef({ last_job_id: 400 }), null);
  assert.deepEqual(e.awxIsleri.filter((x) => x.adim === 'onkontrol' || x.adim === 'stop').map((x) => [x.adim, x.jobId]), [['onkontrol', 400]]);
  // vhost plani / trafik isleri (ayni numara) aileye girmez
  const f = M.hedefIsleri(hedef({ status: 'stopping', last_job_id: 555 }), [gs(555, 1, true, { template_name: 'Retirement: vhost plani a.x.com @ GBWEB01', params: { target_host: 'GBJBOT01', plan_only: true } })]);
  assert.equal(f.awxIsleriEksik, true, 'vhost plani isi on kontrol sayildi');
});

test('RC12 kirpma izi runner.cjs AWX_TRUNCATION_NOTICE ile ayni (metin degisirse kirpildi sessizce false olur)', () => {
  const n = dilim(RUNNER, 'const AWX_TRUNCATION_NOTICE =', ';');
  assert.ok(n.replace(/'\s*\+\s*'/g, '').includes(M.KIRPMA_IZI), 'kirpma izi runner notunda yok');
});

test('RC13 getJobStatusOnServer resultTraceback / jobExplanation doner (ekleme; eski alanlar yerinde)', () => {
  const f = dilim(RUNNER, 'async function getJobStatusOnServer', '\n}\n');
  assert.match(f, /resultTraceback: data\.result_traceback \|\| ''/);
  assert.match(f, /jobExplanation: data\.job_explanation \|\| ''/);
  assert.match(f, /templateId: Number\.isInteger\(data\.job_template\)/);
});

test('RC14 eski job-status ucu da AYNI maskeyle doner (yoksa yeni uctaki maske islevsiz)', () => {
  const js = dilim(IDX, "router.get('/:id/targets/:tid/job-status", '// ── POLLER');
  assert.match(js, /output: maskele\(outputInfo\.output \|\| ''\)/);
  assert.ok(!/output: outputInfo\.output/.test(js), 'job-status ham cikti donduruyor');
});

// ── DUSMANCA DENETIM DUZELTMELERI (2026-10-26, tur 2) ──────────────────────────────────────────
//   RC15 gecmis baglamasi host + uygulama + JBoss surumu (denetim G1: ayni host'taki BASKA kaydin satiri baglaniyordu)
//   RC16 eski 'restoring' web girdisi (isaretsiz): sunucu ESKI kaldirma isinin -> belirsiz; AWX ve arsiv OKUNMAZ (G3/G4)
//   RC17 maske: become_pass / ssh_pass / client_secret / api_key / token / X-Auth-Token / Basic / URL kimligi /
//        kacisli ve bosluklu tirnakli deger (G5); "passed" / "bypass" maskelenmez
//   RC18 AWX olay islemesi bitmeden (event_processing_finished false) is bitmis SAYILMAZ: artimli, arsiv yok
//   RC19 onayli GERI AL isi ('Retirement: GERI AL ...') sunucuya baglanir; 'canceled' terminal (bitti + arsiv)
//   RC20 AWX'te ac adresi: AAP 2.5 (/api/controller/v2) /execution/jobs/..., klasik /#/jobs/...
//   RC21 arsiv yolu yalniz kanitli bagla: template'siz gecmis satiri -> arsiv okunmaz
//   RC22 SOZLESME: sunucunun 409 mesajlari istemcinin kaliciMesaj'inda cumle tekrarlamaz, ayrinti kaybolmaz
//   RC23 eski job-status result / fixResult de maskeli; ansible_job_history is numarasi indeksi
test("RC15 gecmis baglamasi host + uygulama + JBoss surumu: ayni host'taki baska uygulama / surumun satiri baglanmaz", async () => {
  // Hedefin kendi STOP satiri yok; ayni host'ta BASKA uygulamanin (B) ve BASKA surumun (7) satiri var.
  const yabanci = [gs(400, 1, true), gs(500, 2, false, { app: 'B', template_name: 'Retirement: STOP B @ GBJBOT01' }), gs(500, 3, false, { gen: '7' })];
  const k = kur({ gecmis: yabanci });
  const r = await k.istek({ adim: 'stop' });
  assert.notEqual(r.statusCode, 200, 'baska uygulamanin / surumun isi bu hedefe baglandi');
  assert.equal(k.cagri.durum.length, 0, 'yabanci satirin sunucusunda AWX okundu');
  const liste = M.hedefIsleri(hedef(), yabanci).awxIsleri;
  assert.ok(!liste.some((x) => x.adim === 'stop'), 'yabanci satir STOP isi olarak listelendi');
  // Toplu is (rt_hedefler): ayni uygulama + surum baglanir (buyuk/kucuk harf duyarsiz).
  const toplu = gs(500, 1, false, { params: { rt_hedefler: [{ host: 'GBJBOT99', application: 'A', jboss_gen: '8' }, { host: 'gbjbot01', application: 'a', jboss_gen: '8' }], smart_no: '1', plan_only: false } });
  const t2 = kur({ gecmis: [gs(400, 1, true), toplu] });
  assert.equal((await t2.istek({ adim: 'stop' })).statusCode, 200);
  assert.deepEqual(t2.cagri.durum, [[1, 500]]);
  // Uygulama / surum alani olmayan satir kanit degil (is turu de kanitlanamaz: listede yok, AWX okunmaz).
  const eksik = kur({ gecmis: [gs(400, 1, true), gs(500, 1, false, { params: { target_host: 'GBJBOT01', plan_only: false } })] });
  assert.equal((await eksik.istek({ adim: 'stop' })).body.code, 'is_yok');
  assert.equal(eksik.cagri.durum.length, 0);
});

test('RC16 isaretsiz eski "restoring" girdisi: sunucu belirsiz, AWX ve arsiv OKUNMAZ; isaretliyse ve kaldirma isinde baglanir', async () => {
  const web = (o) => JSON.stringify([{ ...WEB[0], ...o }]);
  const kapali = () => Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' });
  const eski = kur({ t: hedef({ status: 'rolling_back', web_result_json: web({ status: 'restoring', jobId: 900, awxServerId: 1 }) }), playbook: 'server_hub_fix.yml',
    durumHata: kapali(), arsiv: { stdout: 'PLAY [opsx_was_restart]', fetched_at: null } });
  const r = await eski.istek({ adim: 'web', web: '0' });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'sunucu_belirsiz'], 'eski kaldirma isinin sunucusunda geri acma isi okundu');
  assert.equal(eski.cagri.durum.length, 0);
  assert.ok(!eski.sorgular.some((x) => /ansible_job_output/.test(x.sql)), 'kanitsiz bagla arsiv okundu');
  const li = M.hedefIsleri(hedef({ web_result_json: web({ status: 'restoring', jobId: 900, awxServerId: 1 }) }), [], { sunucuVar: () => true }).awxIsleri.find((x) => x.adim === 'web');
  assert.deepEqual([li.jobId, li.durum, li.sunucuKapali], [900, 'suruyor', undefined], 'belirsiz sunucu icin kapali/acik uyduruldu');
  // webGeriAl'in isaretiyle (sunucuIsi = is no) baglanir; isaret baska is ise belirsiz.
  const yeni = kur({ t: hedef({ status: 'rolling_back', web_result_json: web({ status: 'restoring', jobId: 900, awxServerId: 1, sunucuIsi: 900 }) }), playbook: 'server_hub_fix.yml', durum: 'running' });
  assert.equal((await yeni.istek({ adim: 'web', web: '0' })).statusCode, 200);
  assert.deepEqual(yeni.cagri.durum, [[1, 900]]);
  const yanlis = kur({ t: hedef({ web_result_json: web({ status: 'ok', jobId: 510, awxServerId: 1, sunucuIsi: 400 }) }), playbook: 'server_hub_fix.yml' });
  assert.equal((await yanlis.istek({ adim: 'web', web: '0' })).body.code, 'sunucu_belirsiz');
  // Kaldirma isi (poller is no + sunucuyu birlikte yazar): isaretsiz de baglanir.
  const kal = kur({ playbook: 'server_hub_fix.yml' });
  assert.equal((await kal.istek({ adim: 'web', web: '0' })).statusCode, 200);
});

test('RC17 maske: ek anahtarlar, tirnakli / kacisli / bosluklu degerler, Basic ve URL kimligi; zararsiz kelimeler degismez', () => {
  const sirli = [
    ['ansible_become_pass=GZ01 x', 'GZ01'], ['"ansible_become_pass": "GZ02"', 'GZ02'], ["'ansible_ssh_pass': 'GZ03'", 'GZ03'],
    ['client_secret=GZ04', 'GZ04'], ['"api_key": "GZ05"', 'GZ05'], ['{"token": "GZ06"}', 'GZ06'], ['X-Auth-Token: GZ07', 'GZ07'],
    ['Authorization: Basic R1owOA==', 'R1owOA=='], ['https://kullanici:GZ09@awx.test/api', 'GZ09'],
    ['"password": "Giz\\"liGZ10"', 'liGZ10'], ['"password": "it\'s GZ11"', 'GZ11'], ['password: "a GZ12"', 'GZ12'], ["cmd -password 'a GZ13' -x", 'GZ13'],
    ['--password=GZ14', 'GZ14'],
  ];
  for (const [g, s] of sirli) assert.ok(!M.maskele(g).includes(s), `${g} -> ${M.maskele(g)}`);
  for (const z of ['All assertions passed', 'bypass: yes', 'passed=3', 'GBJBOT01 : ok=3 changed=0 unreachable=0 failed=1', 'msg: Token expired', 'url: https://awx.test/api/v2/'])
    assert.equal(M.maskele(z), z, `zararsiz metin degisti: ${z}`);
});

test('RC18 olay islemesi bitmeden is bitmis sayilmaz: artimli okuma, onbellek silinmez, arsiv yok; bitince arsivlenir', async () => {
  const yarim = kur({ durum: 'successful', epf: false });
  const r = await yarim.istek({ adim: 'stop' });
  assert.equal(r.body.bitti, false, 'olaylar islenmeden is bitti sayildi (eksik cikti kalici arsivlenir)');
  assert.deepEqual(yarim.cagri.cikti, [[1, 500, { artimli: true }]]);
  assert.equal(yarim.cagri.sil.length, 0);
  assert.equal(yarim.yazimlar().length, 0, 'eksik cikti arsivlendi');
  const tam = kur({ durum: 'successful', epf: true });
  const rt = await tam.istek({ adim: 'stop' });
  assert.equal(rt.body.bitti, true);
  assert.equal(tam.yazimlar().filter((x) => /^INSERT INTO ansible_job_output/.test(x.sql)).length, 1);
  const f = dilim(RUNNER, 'async function getJobStatusOnServer', '\n}\n');
  assert.match(f, /eventProcessingFinished: typeof data\.event_processing_finished === 'boolean'/, 'runner alani dondurmuyor (uc hep bitmis sanar)');
});

test("RC19 onayli GERI AL isi gecmisten sunucuya baglanir; 'canceled' terminal (bitti + arsiv)", async () => {
  const t = hedef({ status: 'rolling_back', rollback_job_id: 800 });
  const gecmis = [...STANDART_GECMIS, gs(800, 2, false, { template_name: 'Retirement: GERI AL A @ GBJBOT01' }), gs(801, 2, true, { template_name: 'Retirement: geri alma ön kontrolü A @ GBJBOT01' })];
  const k = kur({ t, gecmis, playbook: 'app_retirement_rollback.yml', durum: 'running', sunucular: { 2: { id: 2, name: 'maestro2', url: 'https://awx2.test' } } });
  const r = await k.istek({ adim: 'rollback' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(k.cagri.durum, [[2, 800]]);
  const ok = M.hedefIsleri(hedef({ rollback_onkontrol_json: JSON.stringify({ jobId: 801, durum: 'ok', at: '2026-10-24T10:00:00Z' }) }), gecmis, { sunucuVar: () => true }).awxIsleri.find((x) => x.adim === 'rollback_onkontrol');
  assert.equal(ok.sunucuKapali, false, 'geri alma on kontrolu gecmisten sunucuya baglanmadi');
  const iptal = kur({ durum: 'canceled' });
  const ri = await iptal.istek({ adim: 'stop' });
  assert.equal(ri.body.bitti, true, "iptal edilen is 'suruyor' kaldi");
  assert.equal(iptal.yazimlar().filter((x) => /^INSERT INTO ansible_job_output/.test(x.sql)).length, 1, 'iptal edilen is arsivlenmedi');
});

test("RC20 AWX'te ac adresi: AAP 2.5 gateway /execution/jobs, klasik /#/jobs; sunucu yoksa null", async () => {
  assert.equal(M._awxIsAdresi({ url: 'https://aap.test/', apiBase: '/api/controller/v2' }, 7), 'https://aap.test/execution/jobs/playbook/7/output');
  assert.equal(M._awxIsAdresi({ url: 'https://awx.test', apiBase: '/api/v2' }, 7), 'https://awx.test/#/jobs/playbook/7/output');
  assert.equal(M._awxIsAdresi({ url: 'https://awx.test' }, 7), 'https://awx.test/#/jobs/playbook/7/output');
  assert.equal(M._awxIsAdresi(null, 7), null);
  const k = kur({ sunucular: { 1: { id: 1, name: 'aap', url: 'https://aap.test', apiBase: '/api/controller/v2' } } });
  assert.equal((await k.istek({ adim: 'stop' })).body.awxUrl, 'https://aap.test/execution/jobs/playbook/500/output');
});

test("RC21 arsiv yolu yalniz kanitli bagla: template_id'siz gecmis satiri ile arsiv okunmaz", async () => {
  const kapali = () => Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' });
  const k = kur({ gecmis: [gs(400, 1, true), gs(500, 1, false, { template_id: 0 })], durumHata: kapali(), arsiv: { stdout: 'baska is', fetched_at: null } });
  const r = await k.istek({ adim: 'stop' });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'sunucu_belirsiz']);
  assert.ok(!k.sorgular.some((x) => /ansible_job_output/.test(x.sql)), 'kanitsiz bagla arsiv okundu');
  // Kanitli (kayitli on kontrol sunucusu) bagla arsiv okunur.
  const k2 = kur({ t: hedef({ delete_onkontrol_json: JSON.stringify({ jobId: 650, awxServerId: 1, durum: 'ok', at: null }) }), playbook: 'app_retirement_delete.yml', durumHata: kapali(), arsiv: { stdout: 'silme listesi', fetched_at: null } });
  assert.equal((await k2.istek({ adim: 'delete_onkontrol' })).body.kaynak, 'arsiv');
});

// TS modulunu typescript ile CommonJS'e cevirir (ithal adlar sahte; yalniz saf yardimcilar cagrilir).
function istemciModulu(rel) {
  const ts = require('typescript');
  const yol = path.join(__dirname, '..', '..', '..', rel);
  const cikti = ts.transpileModule(fs.readFileSync(yol, 'utf8'), { fileName: yol, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', cikti)(m, m.exports, () => ({}));
  return m.exports;
}

test("RC22 SOZLESME: sunucunun 409 mesajlari istemcinin kaliciMesaj'inda cumle tekrarlamaz, teshis ayrintisi kaybolmaz", async () => {
  const { kaliciMesaj } = istemciModulu('src/components/server_hub/retirementCikti.ts');
  const kapali = Object.assign(new Error('AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), { status: 404, code: 'awx_server_missing' });
  const r = await kur({ durumHata: kapali }).istek({ adim: 'stop' });
  assert.equal(r.body.code, 'awx_server_missing');
  const m = kaliciMesaj(r.body.code, r.body.message, { jobId: 500 });
  assert.equal(m.split('Portal arşivinde de yok').length - 1, 1, `cumle tekrarlaniyor: ${m}`);
  assert.match(m, /devre dışı bırakıldı/);
  // Eki tasimayan (eski) sunucu mesaji icin istemci eki yine gelir.
  assert.match(kaliciMesaj('awx_server_missing', 'AWX sunucusu #1 (maestro) devre dışı bırakıldı.'), /devre dışı bırakıldı\. Bu işin çıktısı Portal arşivinde de yok\.$/);
  const t = await kur({ playbook: 'app_retirement_rollback.yml' }).istek({ adim: 'stop' });
  assert.equal(t.body.code, 'template_uyusmuyor');
  assert.match(kaliciMesaj(t.body.code, t.body.message, { jobId: 500 }), /app_retirement_rollback\.yml; beklenen app_retirement_stop\.yml/, 'teshis ayrintisi atildi');
});

test('RC23 eski job-status result / fixResult maskeli; is gecmisi is numarasi indeksi tanimli', () => {
  const js = dilim(IDX, "router.get('/:id/targets/:tid/job-status", '// ── POLLER');
  assert.match(js, /result: maskeleDerin\(result\), fixResult: maskeleDerin\(fixResult\)/);
  const d = M.maskeleDerin({ line: 'PLAN\tpassword=GZ1', blok: ['ProxyPass / https://u:GZ2@h/', 'ok'], n: 3, yok: null });
  assert.ok(!JSON.stringify(d).includes('GZ1') && !JSON.stringify(d).includes('GZ2'));
  assert.deepEqual([d.n, d.yok, d.blok[1]], [3, null, 'ok']);
  const SETUP = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(SETUP, /\{ name: 'IX_ajh_job', table: 'ansible_job_history', cols: 'job_id, awx_server_id' \}/, 'ansible_job_history indekssiz (her kayit ekrani tam tarama)');
});
