// server/opsx/__tests__/was-state.test.cjs - OpsX WAS saf yardimcilari (2026-10-02).
//
// En kritik kural: "olculemedi" ile "durdu" ASLA karismaz. Bu dosya tasarim (3)
// tablosunu satir satir kilitler ve playbook'tan gelen bildirimin ham olcumle CAPRAZ
// kontrol edildigini dogrular (bildirilen STOPPED + surec var = OLCULEMEDI).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../was-state.cjs');

test('WT1 durum tablosu (tasarim 3) satir satir', () => {
  const t = [
    [1, 'UP', 'RUNNING'],
    [0, 'ULASILAMIYOR', 'STOPPED'],
    [1, 'ULASILAMIYOR', 'ASKIDA'],
    [2, 'UP', 'COKLU_SUREC'],
    [3, 'ULASILAMIYOR', 'COKLU_SUREC'],
    [2, '?', 'COKLU_SUREC'],
    [0, 'UP', 'OLCULEMEDI'],
    [0, '?', 'OLCULEMEDI'],
    [1, '?', 'OLCULEMEDI'],
    [-1, 'UP', 'OLCULEMEDI'],
    [-1, 'ULASILAMIYOR', 'OLCULEMEDI'],
    [0, 'TANIMSIZ', 'OLCULEMEDI'],
    [1, 'TANIMSIZ', 'OLCULEMEDI'],
    [Number.NaN, 'UP', 'OLCULEMEDI'],
  ];
  for (const [pids, ss, beklenen] of t) {
    assert.equal(ws.classify(pids, ss), beklenen, `pids=${pids} ss=${ss}`);
  }
});

test('WT2 bildirilen durum ham olcumle celisirse OLCULEMEDI (asla STOPPED)', () => {
  const host = (servers, extra = {}) => ({
    hosts: [
      {
        host: 'h1',
        overall: 'ok',
        reason: '',
        profiles: [{ profile: 'AppSrv01', cell: 'C', node: 'N', kimlik: 'var', servers }],
        ...extra,
      },
    ],
  });
  const tek = (s, extra) => ws.parseDiscoverResult(host([s], extra)).hosts[0].profiles[0].servers[0];

  assert.equal(tek({ server: 'A', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' }).state, 'STOPPED');
  // ADMU0509I tek basina STOPPED degil: surec varsa ASKIDA olmaliydi; playbook STOPPED
  // dediyse tutarsiz -> OLCULEMEDI.
  assert.equal(tek({ server: 'A', state: 'STOPPED', pids: 1, ss: 'ULASILAMIYOR' }).state, 'OLCULEMEDI');
  assert.equal(tek({ server: 'A', state: 'STOPPED', pids: -1, ss: 'ULASILAMIYOR' }).state, 'OLCULEMEDI');
  assert.equal(tek({ server: 'A', state: 'STOPPED', pids: 0, ss: '?' }).state, 'OLCULEMEDI');
  assert.equal(tek({ server: 'A', state: 'RUNNING', pids: 0, ss: 'UP' }).state, 'OLCULEMEDI');
  // Bilinmeyen durum adi / eksik alanlar
  assert.equal(tek({ server: 'A', state: 'stopped', pids: 0, ss: 'ULASILAMIYOR' }).state, 'OLCULEMEDI');
  assert.equal(tek({ server: 'A' }).state, 'OLCULEMEDI');
  assert.equal(tek({ server: 'A', state: 'RUNNING', pids: '1', ss: 'UP' }).state, 'RUNNING');
  assert.equal(tek({ server: 'A', state: 'RUNNING', pids: 1, ss: 'up' }).state, 'OLCULEMEDI');
  // Host olculemediyse altindaki her sey OLCULEMEDI
  const s = tek({ server: 'A', state: 'RUNNING', pids: 1, ss: 'UP' }, { overall: 'olculemedi', reason: 'ssh' });
  assert.equal(s.state, 'OLCULEMEDI');
  assert.match(s.reason, /ssh/);
  // Bilinmeyen overall / kimlik degeri
  const r = ws.parseDiscoverResult(host([{ server: 'A', state: 'RUNNING', pids: 1, ss: 'UP' }], { overall: 'OK' }));
  assert.equal(r.hosts[0].overall, 'olculemedi');
  const r2 = ws.parseDiscoverResult({
    hosts: [{ host: 'h1', overall: 'ok', profiles: [{ profile: 'p', cell: 'c', node: 'n', kimlik: 'evet', servers: [] }] }],
  });
  assert.equal(r2.hosts[0].profiles[0].kimlik, 'olculemedi');
});

test('WT3 istenen ama sonucta olmayan host listeden DUSMEZ', () => {
  const r = ws.parseDiscoverResult({ hosts: [{ host: 'h1', overall: 'ok', profiles: [] }] }, ['H1', 'h2', 'H3']);
  assert.deepEqual(
    r.hosts.map((h) => [h.host, h.overall]),
    [
      ['H1', 'ok'],
      ['H2', 'olculemedi'],
      ['H3', 'olculemedi'],
    ],
  );
  const bos = ws.parseDiscoverResult(null, ['h9']);
  assert.equal(bos.hosts[0].overall, 'olculemedi');
});

test('WT4 islem-durum kapisi', () => {
  const t = (state, extra = {}) => ({ host: 'H', server: 'A', state, kimlik: 'var', hostOverall: 'ok', ...extra });
  assert.equal(ws.gateOperation(t('RUNNING'), 'stop').ok, true);
  assert.equal(ws.gateOperation(t('RUNNING'), 'restart').ok, true);
  assert.equal(ws.gateOperation(t('RUNNING'), 'start').status, 409);
  assert.equal(ws.gateOperation(t('STOPPED'), 'start').ok, true);
  assert.equal(ws.gateOperation(t('STOPPED'), 'stop').status, 409);
  assert.equal(ws.gateOperation(t('STOPPED'), 'restart').status, 409);
  assert.equal(ws.gateOperation(t('ASKIDA'), 'stop').ok, true);
  assert.equal(ws.gateOperation(t('ASKIDA'), 'restart').ok, true);
  assert.equal(ws.gateOperation(t('ASKIDA'), 'start').status, 409);
  for (const op of ['stop', 'start', 'restart']) {
    assert.equal(ws.gateOperation(t('OLCULEMEDI'), op).status, 409);
    assert.equal(ws.gateOperation(t('COKLU_SUREC'), op).status, 409);
    assert.equal(ws.gateOperation(t('RUNNING', { kimlik: 'yok' }), op).status, 409);
    assert.equal(ws.gateOperation(t('RUNNING', { kimlik: 'olculemedi' }), op).status, 409);
    assert.equal(ws.gateOperation(t('RUNNING', { hostOverall: 'olculemedi' }), op).status, 409);
    assert.equal(ws.gateOperation(null, op).status, 409);
  }
  assert.equal(ws.gateOperation(t('RUNNING'), 'kill').status, 400);
});

test('WT5 uyarilar: ASKIDA ve son calisan ornek', () => {
  const kesif = (ikinci) =>
    ws.parseDiscoverResult({
      hosts: [
        {
          host: 'H1',
          overall: 'ok',
          profiles: [
            {
              profile: 'P',
              cell: 'C1',
              node: 'N1',
              kimlik: 'var',
              servers: [{ server: 'APP', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' }],
            },
          ],
        },
        {
          host: 'H2',
          overall: 'ok',
          profiles: [{ profile: 'P', cell: 'C2', node: 'N2', kimlik: 'var', servers: [ikinci] }],
        },
      ],
    });
  const hedef = (d) => ws.findTarget(d, { host: 'h1', profile: 'P', cell: 'C1', node: 'N1', server: 'APP' });
  let d = kesif({ server: 'APP', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' });
  assert.deepEqual(ws.computeWarnings(d, hedef(d), 'stop'), []);
  d = kesif({ server: 'APP', cluster: 'CL', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' });
  assert.deepEqual(ws.computeWarnings(d, hedef(d), 'stop').map((w) => w.code), ['SON_CALISAN']);
  assert.deepEqual(ws.computeWarnings(d, hedef(d), 'restart').map((w) => w.code), ['SON_CALISAN']);
  // Karsilik OLCULEMEDI: "calisiyor" sayilmaz -> yine uyari
  d = kesif({ server: 'APP', cluster: 'CL', state: 'OLCULEMEDI', pids: -1, ss: '?' });
  const w = ws.computeWarnings(d, hedef(d), 'stop');
  assert.deepEqual(w.map((x) => x.code), ['SON_CALISAN']);
  assert.match(w[0].message, /ölçülemedi/);
  // Baska uygulamanin ayni hosttaki JVM'i karsilik DEGIL
  d = kesif({ server: 'BASKA', cluster: '', state: 'RUNNING', pids: 1, ss: 'UP' });
  assert.deepEqual(ws.computeWarnings(d, hedef(d), 'stop').map((x) => x.code), ['SON_CALISAN']);
  // start'ta uyari yok
  assert.deepEqual(ws.computeWarnings(d, hedef(d), 'start'), []);
});

test('WT6 hedef satirlari yalniz server === app; diger JVM adlari disari cikmaz', () => {
  const d = ws.parseDiscoverResult({
    hosts: [
      {
        host: 'H1',
        overall: 'ok',
        profiles: [
          {
            profile: 'P',
            cell: 'C',
            node: 'N',
            kimlik: 'var',
            servers: [
              { server: 'APP', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' },
              { server: 'APP_KARDES', cluster: 'CL', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' },
              { server: 'APP1', cluster: '', state: 'RUNNING', pids: 1, ss: 'UP' },
            ],
          },
        ],
      },
    ],
  });
  const rows = ws.targetsForApp(d, 'APP');
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /APP_KARDES|APP1/);
  assert.deepEqual(rows[0].peers, { total: 1, running: 0, unknown: 0, clusterKnown: true });
  assert.deepEqual(rows[0].allowedOps, ['stop', 'restart']);
  assert.equal(rows[0].warnings.stop[0].code, 'SON_CALISAN');
});

test('WT7 ortam normalizasyonu, NOAPP, OS', () => {
  assert.equal(ws.normalizeEnv('PROD'), 'Production');
  assert.equal(ws.normalizeEnv(' prod '), 'Production');
  assert.equal(ws.normalizeEnv('Production'), 'Production');
  assert.equal(ws.normalizeEnv('TEST'), 'Test');
  assert.equal(ws.normalizeEnv('ALPHA'), 'Alpha');
  assert.equal(ws.normalizeEnv('QA'), 'QA');
  assert.equal(ws.normalizeEnv('ODM'), 'ODM');
  assert.equal(ws.normalizeEnv(''), '');
  assert.equal(ws.normalizeEnv('SANDBOX'), 'SANDBOX');
  assert.equal(ws.isProdEnv('PROD'), true);
  assert.equal(ws.isNoApp(' noapp '), true);
  assert.equal(ws.isSelectableOs('Linux'), true);
  assert.equal(ws.isSelectableOs('AIX'), false);
  const hosts = ws.shapeInventoryHosts([
    { host: 'gb01', env: 'PROD', os: 'LINUX' },
    { host: 'GB01', env: 'TEST', os: 'LINUX' },
    { host: 'gb02', env: 'PROD', os: 'AIX' },
    { host: 'gb;03', env: 'PROD', os: 'LINUX' },
  ]);
  assert.deepEqual(
    hosts.map((h) => [h.host, h.env, h.selectable]),
    [
      ['GB01', 'Production', true],
      ['GB02', 'Production', false],
      ['GB;03', 'Production', false],
    ],
  );
});

test('WT8 kesif yasi: 15 dk siniri, okunamayan zaman GECERSIZ', () => {
  const now = Date.parse('2026-10-02T10:00:00Z');
  assert.equal(ws.discoveryAge('2026-10-02T09:50:00Z', now).ok, true);
  assert.equal(ws.discoveryAge('2026-10-02T09:44:59Z', now).ok, false);
  assert.equal(ws.discoveryAge(null, now).ok, false);
  assert.equal(ws.discoveryAge('dun', now).ok, false);
  assert.equal(ws.discoveryAge('2026-10-02T11:00:00Z', now).ok, false);
});

test('WT9 islem sonucu: tanimsiz sonuc OLCULEMEDI, sirlar maskelenir', () => {
  assert.equal(ws.parseOpResult(null), null);
  const r = ws.parseOpResult({
    result: 'BASARILI',
    before: 'RUNNING',
    after: 'stopped',
    steps: [{ step: 'stop', status: 'OK', msg: 'stopServer -password S3cr3t -user x' }],
    line: 'RESULT\tstop\tOK\tRUNNING\tSTOPPED\tpassword=abc',
  });
  assert.equal(r.result, 'OLCULEMEDI');
  assert.equal(r.before, 'RUNNING');
  assert.equal(r.after, 'OLCULEMEDI');
  assert.doesNotMatch(JSON.stringify(r), /S3cr3t|=abc/);
  // Playbook'un geri donus yolu (girdi kapisi / erisilemeyen host) once/sonra icin '-'
  // yazar: olcum yapilmadi -> bos; asla STOPPED ya da RUNNING degil.
  const fb = ws.parseOpResult({ result: 'FAIL', before: '-', after: ' - ', steps: [] });
  assert.equal(fb.before, '');
  assert.equal(fb.after, '');
  assert.equal(ws.parseOpResult({ result: 'OK', before: 'RUNNING', after: 'STOPPED' }).after, 'STOPPED');
  assert.equal(ws.resultSeverity('OK'), 'ok');
  assert.equal(ws.resultSeverity('SKIP'), 'skip');
  assert.equal(ws.resultSeverity('FAIL'), 'fail');
  assert.equal(ws.resultSeverity('OLCULEMEDI'), 'unknown');
  assert.equal(ws.resultSeverity(undefined), 'unknown');
  assert.equal(ws.auditResultOf('SKIP'), 'ok');
  assert.equal(ws.auditResultOf('OLCULEMEDI'), 'fail');
});

test('WT10 kilit suresi template timeout\'undan UZUN', () => {
  assert.ok(ws.DEFAULT_LOCK_TTL_MIN > ws.TEMPLATE_TIMEOUT_MIN);
  assert.equal(ws.lockTtlMinutes({}), ws.DEFAULT_LOCK_TTL_MIN);
  assert.ok(ws.lockTtlMinutes({ OPSX_WAS_LOCK_TTL_MIN: '10' }) > ws.TEMPLATE_TIMEOUT_MIN);
  assert.equal(ws.lockTtlMinutes({ OPSX_WAS_LOCK_TTL_MIN: 'abc' }), ws.DEFAULT_LOCK_TTL_MIN);
  assert.equal(ws.lockTtlMinutes({ OPSX_WAS_LOCK_TTL_MIN: '90' }), 90);
  assert.deepEqual(ws.lockKeys({ app: 'APP', host: 'h1', cell: 'C', node: 'N', server: 'APP' }), {
    app: 'A|APP',
    target: 'T|H1|C|N|APP',
  });
});

// Kucuk sahte kilit tablosu: was-run.test.cjs'tekiyle ayni anlam.
function sahteDb() {
  const rows = new Map();
  const log = [];
  return {
    rows,
    log,
    async query(sql, p = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      log.push(s.slice(0, 60));
      if (/^IF NOT EXISTS/.test(s)) {
        if (!rows.has(p[0])) rows.set(p[0], { held: 0 });
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE opsx_was_locks SET held = 1/.test(s)) {
        const r = rows.get(p[0]);
        const free = !r.held || r.locked_until < Date.now();
        if (!free) return { rows: [], rowCount: 0 };
        Object.assign(r, { held: 1, holder: p[1], lock_id: p[2], locked_until: Date.now() + p[4] * 60000, awx_server_id: null, awx_job_id: null });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT TOP 1 lock_key/.test(s)) {
        return { rows: rows.has(p[0]) ? [{ lock_key: p[0], ...rows.get(p[0]) }] : [] };
      }
      if (/^UPDATE opsx_was_locks SET held = 0, updated_at = GETUTCDATE\(\).* WHERE lock_key = \$1 AND lock_id = \$2/.test(s)) {
        const r = rows.get(p[0]);
        if (r && r.held && r.lock_id === p[1]) {
          r.held = 0;
          if (/last_op_finished_at = CASE/.test(s) && p[2] && (!r.last_op_finished_at || r.last_op_finished_at < p[2])) {
            r.last_op_finished_at = p[2];
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE opsx_was_locks SET awx_server_id/.test(s)) {
        const r = rows.get(p[0]);
        if (r && r.held && r.lock_id === p[1]) Object.assign(r, { awx_server_id: p[2], awx_job_id: p[3] });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`beklenmeyen: ${s}`);
    },
  };
}

test('WT11 kilit TUMU YA DA HICBIRI: hedef doluysa uygulama kilidi geri birakilir', async () => {
  const db = sahteDb();
  const k1 = ws.lockKeys({ app: 'APP', host: 'H1', cell: 'C', node: 'N', server: 'APP' });
  // Baska bir surec AYNI hedefi tutuyor (uygulama kilidi bos).
  db.rows.set(k1.target, { held: 1, lock_id: 'eski', locked_until: Date.now() + 60_000 });
  const r = await ws.acquireLocks(db, k1, { lockId: 'yeni', holder: 'ali', desc: 'x', ttlMin: 60 });
  assert.equal(r.ok, false);
  assert.equal(r.busyKey, k1.target);
  assert.equal(db.rows.get(k1.app).held, 0, 'uygulama kilidi asili kaldi');
  assert.equal(db.rows.get(k1.target).lock_id, 'eski', 'baskasinin kilidi ezildi');
});

test('WT12 bayat kilit: bagli is TERMINAL ise birakilir; AWX sorgusu hata verirse DOLU kalir', async () => {
  const db = sahteDb();
  const k = ws.lockKeys({ app: 'APP', host: 'H1', cell: 'C', node: 'N', server: 'APP' });
  db.rows.set(k.app, { held: 1, lock_id: 'eski', locked_until: Date.now() + 60_000, awx_server_id: 1, awx_job_id: 77 });
  let r = await ws.acquireLocks(db, k, {
    lockId: 'yeni',
    holder: 'ali',
    desc: 'x',
    ttlMin: 60,
    isJobTerminal: async () => {
      throw new Error('AWX yok');
    },
  });
  assert.equal(r.ok, false, 'AWX okunamadiginda kilit ACILDI (fail-open)');
  r = await ws.acquireLocks(db, k, { lockId: 'yeni', holder: 'ali', desc: 'x', ttlMin: 60, isJobTerminal: async () => false });
  assert.equal(r.ok, false);
  r = await ws.acquireLocks(db, k, { lockId: 'yeni', holder: 'ali', desc: 'x', ttlMin: 60, isJobTerminal: async (sid, jid) => sid === 1 && jid === 77 });
  assert.equal(r.ok, true);
  assert.equal(db.rows.get(k.app).lock_id, 'yeni');
  // Nesne donen imza: bayat kilit birakilirken bagli isin AWX bitis zamani kaydedilir.
  db.rows.set(k.app, { held: 1, lock_id: 'eski2', locked_until: Date.now() + 60_000, awx_server_id: 1, awx_job_id: 78 });
  db.rows.set(k.target, { held: 0 });
  r = await ws.acquireLocks(db, k, {
    lockId: 'yeni2',
    holder: 'ali',
    desc: 'x',
    ttlMin: 60,
    isJobTerminal: async () => ({ terminal: true, finished: '2026-10-02T10:00:00.123456Z' }),
  });
  assert.equal(r.ok, true);
  assert.equal(db.rows.get(k.app).last_op_finished_at, '2026-10-02T10:00:00.123Z', 'bayat kilit yolunda son islem zamani yazilmadi');
  r = await ws.acquireLocks(db, ws.lockKeys({ app: 'APP2', host: 'H1', cell: 'C', node: 'N', server: 'APP2' }), {
    lockId: 'y3', holder: 'ali', desc: 'x', ttlMin: 60, isJobTerminal: async () => ({ terminal: false, finished: null }),
  });
  assert.equal(r.ok, true);
});

// GERCEK betik ciktisi (2026-10-02 capraz denetim: sahte WAS'ta kosan opsx_was.sh ->
// playbook yorumlayicisi -> set_stats). GBWAST01'de CL2/cluster.xml okunamadi: app10 ve app3'un
// kumesi '?'. app3 RUNNING, app10'un baska RUNNING ornegi yok. '?' kume ADI gibi gruplaninca
// app3 app10'un "kardesi" sayiliyor ve SON_CALISAN uyarisi CIKMIYORDU.
const CAPRAZ = {
  hosts: [
    {
      host: 'GBWAST01',
      overall: 'ok',
      reason: '',
      profiles: [
        {
          profile: 'AppSrv01', cell: 'C1', node: 'N1', kimlik: 'var',
          reason: 'soap.client.props loginUserid satiri: 1; cluster bilgisi olculemedi (CL2/cluster.xml okunamadi)',
          servers: [
            { server: 'app1', cluster: 'CL1', state: 'RUNNING', pids: 1, ss: 'UP', reason: 'pid 1395954; serverStatus rc 0, ADMU0508I' },
            { server: 'app10', cluster: '?', state: 'RUNNING', pids: 1, ss: 'UP', reason: 'pid 1395958; cluster bilgisi olculemedi (CL2/cluster.xml okunamadi)' },
            { server: 'app3', cluster: '?', state: 'RUNNING', pids: 1, ss: 'UP', reason: 'pid 1395960; cluster bilgisi olculemedi (CL2/cluster.xml okunamadi)' },
          ],
        },
      ],
    },
    { host: 'GBWAST02', overall: 'olculemedi', reason: 'hedefe ulasilamadi: Failed to connect to the host via ssh: timed out', profiles: [] },
    {
      host: 'GBWAST04',
      overall: 'ok',
      reason: '',
      profiles: [
        {
          profile: 'AppSrv01', cell: 'C1', node: 'N1', kimlik: 'var', reason: '',
          servers: [
            { server: 'app1', cluster: 'CL1', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR', reason: 'surec yok; ADMU0509I' },
            { server: 'app10', cluster: '', state: 'COKLU_SUREC', pids: 2, ss: 'UP', reason: '2 surec' },
            { server: 'app3', cluster: '', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR', reason: 'surec yok; ADMU0509I' },
          ],
        },
      ],
    },
  ],
  reason: '',
};

test("WT14 kume '?' = BILINMIYOR: ad gibi gruplanmaz, hedefin kumesi '?' ise SON_CALISAN her zaman sorulur", () => {
  const d = ws.parseDiscoverResult(CAPRAZ, ['GBWAST01', 'GBWAST02', 'GBWAST04']);
  const hedef = (server, host = 'GBWAST01') => ws.findTarget(d, { host, profile: 'AppSrv01', cell: 'C1', node: 'N1', server });
  const app10 = hedef('app10');
  const s = ws.peerSummary(d, app10);
  // app3 ('?') kardes SAYILMAZ; yalniz ayni adli app10 (GBWAST04, COKLU_SUREC).
  assert.deepEqual(s, { total: 1, running: 0, unknown: 1, clusterKnown: false });
  for (const op of ['stop', 'restart']) {
    const w = ws.computeWarnings(d, app10, op);
    assert.deepEqual(w.map((x) => x.code), ['SON_CALISAN'], `${op}: kume bilinmezken uyari yok`);
    assert.match(w[0].message, /küme bilgisi ölçülemedi/);
    assert.doesNotMatch(w[0].message, /"\?"/, "'?' kume adi gibi gosterildi");
  }
  assert.deepEqual(ws.computeWarnings(d, app10, 'start'), []);
  // Ayni adli ornek baska hostta CALISIYOR olsa bile kume bilinmiyorsa yine sorulur (muhafazakar).
  const c2 = JSON.parse(JSON.stringify(CAPRAZ));
  Object.assign(c2.hosts[2].profiles[0].servers[1], { state: 'RUNNING', pids: 1 });
  const d2 = ws.parseDiscoverResult(c2);
  const t2 = ws.findTarget(d2, { host: 'GBWAST01', profile: 'AppSrv01', cell: 'C1', node: 'N1', server: 'app10' });
  const w2 = ws.computeWarnings(d2, t2, 'stop');
  assert.deepEqual(w2.map((x) => x.code), ['SON_CALISAN']);
  assert.match(w2[0].message, /Aynı adlı 1 örnek/);
  // Bilinen kume (CL1) bozulmadi: app1'in tek kardesi GBWAST04'teki app1 (durmus) -> son calisan.
  const w1 = ws.computeWarnings(d, hedef('app1'), 'stop');
  assert.deepEqual(w1.map((x) => x.code), ['SON_CALISAN']);
  assert.match(w1[0].message, /"CL1" kümesinin/);
  // UI satiri: peers.clusterKnown false
  const row = ws.targetsForApp(d, 'app10').find((r) => r.host === 'GBWAST01');
  assert.equal(row.peers.clusterKnown, false);
  assert.equal(row.cluster, '?');
});

test('WT15 kume kardesligi: farkli hucrede ayni kume adi ve bos kume kardes DEGIL; virgullu kume listesi kesisir', () => {
  const kesif = (ikinci) =>
    ws.parseDiscoverResult({
      hosts: [
        { host: 'H1', overall: 'ok', profiles: [{ profile: 'P', cell: 'C1', node: 'N1', kimlik: 'var', servers: [
          { server: 'A', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' },
          ikinci,
        ] }] },
      ],
    });
  const peers = (ikinci) => {
    const d = kesif(ikinci);
    return ws.peerSummary(d, ws.findTarget(d, { host: 'H1', profile: 'P', cell: 'C1', node: 'N1', server: 'A' }));
  };
  assert.equal(peers({ server: 'B', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' }).running, 1);
  assert.equal(peers({ server: 'B', cluster: '', state: 'RUNNING', pids: 1, ss: 'UP' }).total, 0);
  assert.equal(peers({ server: 'B', cluster: '?', state: 'RUNNING', pids: 1, ss: 'UP' }).total, 0);
  assert.equal(peers({ server: 'B', cluster: 'X,CL', state: 'RUNNING', pids: 1, ss: 'UP' }).running, 1);
  // farkli hucre: ayni profil altinda olamaz; iki host ile kur
  const d = ws.parseDiscoverResult({
    hosts: [
      { host: 'H1', overall: 'ok', profiles: [{ profile: 'P', cell: 'C1', node: 'N1', kimlik: 'var', servers: [{ server: 'A', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' }] }] },
      { host: 'H2', overall: 'ok', profiles: [{ profile: 'P', cell: 'C2', node: 'N2', kimlik: 'var', servers: [{ server: 'B', cluster: 'CL', state: 'RUNNING', pids: 1, ss: 'UP' }] }] },
    ],
  });
  const t = ws.findTarget(d, { host: 'H1', profile: 'P', cell: 'C1', node: 'N1', server: 'A' });
  assert.equal(ws.peerSummary(d, t).total, 0, 'baska hucredeki ayni adli kume kardes sayildi');
  assert.deepEqual(ws.clusterInfo('?'), { known: false, names: [] });
  assert.deepEqual(ws.clusterInfo(' CL1 , ? '), { known: false, names: [] });
  assert.deepEqual(ws.clusterInfo(''), { known: true, names: [] });
});

test("WT16 islem adimlari: bilinmeyen durum OLCULEMEDI; 'UYARI:' ile baslayan OK adim uyari isaretli", () => {
  const p = ws.parseOpResult({
    result: 'OK',
    request_id: ' r-1 ',
    steps: [
      { step: 'x', status: 'BELKI', msg: '' },
      { step: 'y', status: 'ok', msg: '' },
      { step: 'nodeagent', status: 'OK', msg: 'UYARI: nodeagent sureci yok' },
      { step: 'stabilite', status: 'OK', msg: 'UYARI: JVM 60s icinde kendiliginden geri geldi' },
      { step: 'stop_dogrulama', status: 'OK', msg: 'STOPPED: surec yok' },
      { step: 'kill', status: 'FAIL', msg: 'UYARI degil' },
    ],
  });
  assert.deepEqual(p.steps.map((s) => s.status), ['OLCULEMEDI', 'OLCULEMEDI', 'OK', 'OK', 'OK', 'FAIL']);
  assert.deepEqual(p.steps.map((s) => s.warning), [false, false, true, true, false, false]);
  assert.equal(p.requestId, 'r-1');
});

test('WT17 sonuc istege ait mi: request_id / host / JVM uyusmazligi', () => {
  const p = (x) => ws.parseOpResult({ result: 'OK', host: 'gbwasp01', server: 'APPX', request_id: 'r1', ...x });
  const params = { host: 'GBWASP01', server: 'APPX', request_id: 'r1' };
  assert.equal(ws.opResultMismatch(p({}), params), '');
  assert.match(ws.opResultMismatch(p({ request_id: 'r2' }), params), /istek/);
  assert.match(ws.opResultMismatch(p({ host: 'GBWASP02' }), params), /sunucu/);
  assert.match(ws.opResultMismatch(p({ server: 'APPY' }), params), /JVM/);
  // Eski playbook request_id basmiyorsa o alan icin karar verilmez.
  assert.equal(ws.opResultMismatch(p({ request_id: '' }), params), '');
  assert.equal(ws.opResultMismatch(null, params), '');
});

test('WT18 bayat kesif: kesif son islem BITMEDEN baslamissa red', () => {
  assert.equal(ws.staleDiscovery('2026-10-02T10:00:00Z', null), '');
  assert.equal(ws.staleDiscovery('2026-10-02T10:00:01Z', '2026-10-02T10:00:00.000Z'), '');
  assert.match(ws.staleDiscovery('2026-10-02T10:00:00Z', '2026-10-02T10:00:00.000Z'), /bitmeden/);
  assert.match(ws.staleDiscovery('2026-10-02T09:59:00Z', '2026-10-02T10:00:00.000Z'), /bitmeden/);
  assert.match(ws.staleDiscovery(null, '2026-10-02T10:00:00.000Z'), /okunamadı/);
  // AWX'in mikro saniyeli bicimi de ayni sekilde karsilastirilir.
  assert.equal(ws.staleDiscovery('2026-10-02T10:00:00.500123Z', '2026-10-02T10:00:00.400Z'), '');
});

test('WT13 kilit SQL: CAS kosulu ve DELETE yok', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'was-state.cjs'), 'utf8');
  const flat = src.replace(/\s+/g, ' ');
  assert.match(
    flat,
    /UPDATE opsx_was_locks SET held = 1, .*? WHERE lock_key = \$1 AND \(held IS NULL OR held = 0 OR locked_until IS NULL OR locked_until < GETUTCDATE\(\)\)/,
    'CAS kosulu yok - kilit kosulsuz yaziliyor',
  );
  assert.match(flat, /WHERE lock_key = \$1 AND lock_id = \$2 AND held = 1/, 'birakma baskasinin kilidini da birakabilir');
});
