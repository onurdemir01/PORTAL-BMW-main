// server/opsx/__tests__/was-genel-uclar.test.cjs - GENEL durum uclari WAS isini nasil
// gosteriyor (2026-10-02 duzeltici turu, dogrulanmis bulgu "eski uclar fail-open ve MASKESIZ").
//
// WAS'in kendi durum uclari (server/opsx/was.cjs) sahipligi FAIL-CLOSED denetler ve ciktiyi
// maskeler. Ayni AWX job id'siyle iki genel uc bunu atliyordu:
//   GU1 /api/ansible/ss/job-status (runner.cjs; Self Service Gecmis): WAS isinde sahiplik
//       FAIL-CLOSED (DB hatasinda 503), kaydi olmayan WAS isi yalniz Admin'e, cikti ekrana da
//       arsive de MASKELI. WAS olmayan islerde davranis DEGISMEDI (fail-open korunur).
//   GU2 /api/opsx/job-status (JBoss akisi): WAS isi bu uctan HIC okunmaz (409 was_ucu) -
//       DB okunamasa bile AWX playbook adindan taninir.
//
// Rotalar Express'e baglanmadan KAYNAKTAN cikarilan gercek handler govdesiyle kosulur
// (server/ansible/__tests__/job-stdout-artimli.test.cjs deseni): ag, AWX ve DB enjekte edilir.
// Cikarim bozulursa test DUSER (sessizce bos govde uretmez).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRV = path.join(__dirname, '..', '..');
const RUNNER_SRC = fs.readFileSync(path.join(SRV, 'ansible', 'runner.cjs'), 'utf8');
const OPSX_SRC = fs.readFileSync(path.join(SRV, 'opsx', 'index.cjs'), 'utf8');
const WAS_PATH = path.join(SRV, 'opsx', 'was.cjs');
const WS_PATH = path.join(SRV, 'opsx', 'was-state.cjs');

// `app.get('<rota>', requireAuth, async (req, res) => { ... });` -> handler kaynagi.
function handlerKaynagi(src, rota) {
  const i = src.indexOf(`app.get('${rota}'`);
  assert.ok(i > 0, `rota bulunamadi: ${rota}`);
  const bas = src.indexOf('async (req, res) => {', i);
  assert.ok(bas > i && bas - i < 200, `handler baslangici bulunamadi: ${rota}`);
  let derinlik = 0;
  for (let k = src.indexOf('{', bas); k < src.length; k++) {
    if (src[k] === '{') derinlik++;
    else if (src[k] === '}' && --derinlik === 0) return src.slice(bas, k + 1);
  }
  throw new Error(`handler sonu bulunamadi: ${rota}`);
}

const GIZLI = 'Gizli123';
const HAM = `TASK [x]\nstopServer.sh app1 -password ${GIZLI} password=abc\nRESULT\tstop\tOK\n`;

function sahteDb(dunya) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM ansible_job_history WHERE job_id = \$1 AND awx_server_id = \$2/.test(s) && /^SELECT TOP 1/.test(s)) {
        if (dunya.dbHata) throw new Error('DB erisilemiyor (test)');
        return { rows: dunya.gecmis ? [{ ...dunya.gecmis }] : [] };
      }
      if (/^UPDATE ansible_job_history/.test(s)) return { rows: [], rowCount: 0 };
      if (/^SELECT 1 FROM ansible_job_output/.test(s)) return { rows: [] };
      if (/^INSERT INTO ansible_job_output/.test(s)) {
        dunya.arsiv.push(String(params[2]));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`beklenmeyen sorgu: ${s.slice(0, 120)}`);
    },
  };
}

function yanit() {
  const r = { kod: 200, govde: null };
  r.status = (k) => {
    r.kod = k;
    return r;
  };
  r.json = (g) => {
    r.govde = g;
    return r;
  };
  return r;
}

function dunyaKur({ gecmis, playbook, durum = 'successful', dbHata = false } = {}) {
  return { gecmis, playbook, durum, dbHata, arsiv: [] };
}

function sahteRequire(dunya, ek = {}) {
  return (ad) => {
    if (ad === '../db/index.cjs') return sahteDb(dunya);
    if (ad === '../audit/index.cjs') return { auditPortal() {} };
    if (ad === '../opsx/was.cjs' || ad === './was.cjs') return require(WAS_PATH);
    if (ad === '../opsx/was-state.cjs') return require(WS_PATH);
    if (ek[ad]) return ek[ad];
    throw new Error(`beklenmeyen require: ${ad}`);
  };
}

const sessiz = { log() {}, warn() {}, error() {} };

// GU1: runner.cjs ss/job-status
const SS_KAYNAK = handlerKaynagi(RUNNER_SRC, '/api/ansible/ss/job-status/:serverId/:jobId');
async function ssJobStatus(dunya, user) {
  const handler = new Function(
    'require', 'getServerById', 'getTokenForServer', 'awxRequestToServer', 'getJobOutputOnServer',
    'stdoutCache', 'readCustom', 'applyOutputFilter', 'console',
    `return (${SS_KAYNAK});`,
  )(
    sahteRequire(dunya),
    () => ({ id: 1, url: 'https://awx.test' }),
    async () => 'tok',
    async () => ({ id: 77, status: dunya.durum, playbook: dunya.playbook, finished: '2026-10-02T10:00:00Z', failed: false }),
    async () => ({ output: HAM }),
    { sil() {} },
    () => ({}),
    () => ({ filtered: false }),
    sessiz,
  );
  const res = yanit();
  await handler({ params: { serverId: '1', jobId: '77' }, session: { user } }, res);
  return res;
}

// GU2: opsx/index.cjs job-status
const OPSX_KAYNAK = handlerKaynagi(OPSX_SRC, '/api/opsx/job-status/:serverId/:jobId');
async function opsxJobStatus(dunya, user) {
  const runner = {
    getJobStatusOnServer: async () => ({ status: dunya.durum, playbook: dunya.playbook, finished: null, failed: false }),
    getJobOutputOnServer: async () => ({ output: HAM }),
  };
  const handler = new Function('require', 'console', `return (${OPSX_KAYNAK});`)(
    sahteRequire(dunya, { '../ansible/runner.cjs': runner }),
    sessiz,
  );
  const res = yanit();
  await handler({ params: { serverId: '1', jobId: '77' }, session: { user } }, res);
  return res;
}

const ALI = { username: 'ali', role: 'User' };
const VELI = { username: 'veli', role: 'User' };
const ADMIN = { username: 'admin1', role: 'Admin' };
const WAS_OP_YML = 'bmw_portal/opsx_was/opsx_was_operation.yml';
const gecmisWas = (platform = 'was-operation') => ({
  username: 'ali',
  template_id: 102,
  params: JSON.stringify({ platform, app: 'APPX', host: 'GBWASP01', server: 'APPX' }),
});

test('GU1a ss/job-status WAS isi: sahibine 200 ama cikti EKRANDA ve ARSIVDE maskeli', async () => {
  const d = dunyaKur({ gecmis: gecmisWas(), playbook: WAS_OP_YML });
  const r = await ssJobStatus(d, ALI);
  assert.equal(r.kod, 200, JSON.stringify(r.govde));
  assert.doesNotMatch(r.govde.output, new RegExp(GIZLI), 'WAS ciktisi ekrana maskesiz gitti');
  assert.doesNotMatch(r.govde.output, /password=abc/);
  assert.equal(d.arsiv.length, 1, 'terminal iste arsiv yazilmadi');
  assert.doesNotMatch(d.arsiv[0], new RegExp(GIZLI), 'WAS ciktisi arsive maskesiz yazildi');
  // Platform gecmisten okundu: AWX playbook adi gelmese de maskelenir.
  const d2 = dunyaKur({ gecmis: gecmisWas('was-discover'), playbook: undefined });
  const r2 = await ssJobStatus(d2, ALI);
  assert.doesNotMatch(r2.govde.output, new RegExp(GIZLI), 'platformdan taninan WAS isi maskelenmedi');
});

test('GU1b ss/job-status WAS isi: sahiplik FAIL-CLOSED (DB hatasi 503, kayitsiz is yalniz Admin)', async () => {
  let r = await ssJobStatus(dunyaKur({ gecmis: gecmisWas(), playbook: WAS_OP_YML }), VELI);
  assert.equal(r.kod, 403, JSON.stringify(r.govde));
  for (const user of [VELI, ALI, ADMIN]) {
    r = await ssJobStatus(dunyaKur({ gecmis: gecmisWas(), playbook: WAS_OP_YML, dbHata: true }), user);
    assert.equal(r.kod, 503, `${user.username}: DB hatasinda WAS isi acildi: ${JSON.stringify(r.govde)}`);
  }
  r = await ssJobStatus(dunyaKur({ gecmis: null, playbook: WAS_OP_YML }), VELI);
  assert.equal(r.kod, 403, `kaydi olmayan WAS isi herkese acildi: ${JSON.stringify(r.govde)}`);
  r = await ssJobStatus(dunyaKur({ gecmis: null, playbook: WAS_OP_YML }), ADMIN);
  assert.equal(r.kod, 200, JSON.stringify(r.govde));
  assert.doesNotMatch(r.govde.output, new RegExp(GIZLI));
});

test('GU1c ss/job-status WAS OLMAYAN isde davranis degismedi (fail-open, maskesiz ham cikti)', async () => {
  const sonuc = await ssJobStatus(dunyaKur({ gecmis: null, playbook: 'bmw_portal/java_app_ops/java_app_ops.yml', dbHata: true }), VELI);
  assert.equal(sonuc.kod, 200, JSON.stringify(sonuc.govde));
  assert.match(sonuc.govde.output, new RegExp(GIZLI), 'WAS disi isin ciktisi degisti (kapsam disi)');
});

test('GU2 /api/opsx/job-status WAS isini HIC vermez (409 was_ucu), DB okunamasa bile', async () => {
  for (const user of [ALI, ADMIN, VELI]) {
    const r = await opsxJobStatus(dunyaKur({ gecmis: gecmisWas(), playbook: undefined }), user);
    assert.equal(r.kod, 409, `${user.username}: ${JSON.stringify(r.govde)}`);
    assert.equal(r.govde.code, 'was_ucu');
    assert.doesNotMatch(JSON.stringify(r.govde), new RegExp(GIZLI));
  }
  const r = await opsxJobStatus(dunyaKur({ gecmis: null, playbook: WAS_OP_YML, dbHata: true }), VELI);
  assert.equal(r.kod, 409, `DB hatasinda WAS isi eski uctan acildi: ${JSON.stringify(r.govde)}`);
  // JBoss isi etkilenmez.
  const j = await opsxJobStatus(
    dunyaKur({ gecmis: { username: 'ali', params: JSON.stringify({ platform: 'legacy' }) }, playbook: 'bmw_portal/java_app_ops/java_app_ops.yml' }),
    ALI,
  );
  assert.equal(j.kod, 200, JSON.stringify(j.govde));
});
