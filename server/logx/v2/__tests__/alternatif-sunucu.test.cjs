// server/logx/v2/__tests__/alternatif-sunucu.test.cjs - LogX, kayitli AWX sunucusu yoksa
// (kapatilmis ya da tanimsiz) AYNI NUMARALI template'i baska sunucuda DOGRULAMADAN
// baslatmaz (2026-10-26, maestro 1 kapatma incelemesi).
//
// AWX template numaralari sunucuya ozgudur. Eski yol kayitli sunucu "yok" deyince numarayi
// diger sunucuda bulup baslatiyor ve kayda kalici yaziyordu; playbook karsilastirmasi fail-open
// oldugu icin (template okunamazsa / kayitta yol bossa) maestro2'deki BASKA bir is LogX
// degiskenleriyle kosabiliyordu.
//
// Testler GERCEK runner'i iki sahte AWX'e karsi kosturur (AWX_1, AWX_2); kayit AWX 3'u
// gosterir (tanimsiz sunucu = kapatilmis sunucuyla ayni yol: getServerById null).
//   AS1 alternatifte AYNI playbook: baslar ve kayit duzeltilir (iyilestirme korunur)
//   AS2 alternatifte BASKA playbook: 409, is BASLATILMAZ, kayit degismez
//   AS3 alternatif template okunamiyor (listede var, ayrinti 500): 409, BASLATILMAZ
//   AS4 kayitta playbook yolu bos: 409, BASLATILMAZ (eskiden kor baslatiliyordu)
//   AS5 template hicbir yerde yok: hata "sunucu yok" der, "job template bulunamadi" DEMEZ
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const istekler = [];
const sunucular = {}; // no -> { sablonlar: Map(id -> {durum, govde}), liste: [{id, playbook}] }

function sahteAwx(no) {
  sunucular[no] = { sablonlar: new Map(), liste: [] };
  return http.createServer((q, r) => {
    istekler.push(`${no} ${q.method} ${q.url}`);
    const gonder = (kod, govde) => {
      r.writeHead(kod, { 'content-type': 'application/json' });
      r.end(JSON.stringify(govde));
    };
    const s = sunucular[no];
    let m = /^\/api\/v2\/job_templates\/(\d+)\/$/.exec(q.url);
    if (q.method === 'GET' && m) {
      const t = s.sablonlar.get(Number(m[1]));
      return t ? gonder(t.durum, t.govde) : gonder(404, { detail: 'Not found.' });
    }
    if (q.method === 'GET' && /^\/api\/v2\/job_templates\/\?/.test(q.url)) {
      return gonder(200, { count: s.liste.length, next: null, results: s.liste });
    }
    m = /^\/api\/v2\/job_templates\/(\d+)\/survey_spec\/$/.exec(q.url);
    if (q.method === 'GET' && m) return gonder(200, {});
    m = /^\/api\/v2\/job_templates\/(\d+)\/launch\/$/.exec(q.url);
    if (q.method === 'POST' && m) {
      q.resume();
      return q.on('end', () => gonder(201, { job: 7000 + no, id: 7000 + no, status: 'pending' }));
    }
    gonder(404, { detail: `sahte AWX tanimiyor: ${q.method} ${q.url}` });
  });
}

const awx = [];
before(async () => {
  for (const no of [1, 2]) {
    const srv = sahteAwx(no);
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    awx.push(srv);
    process.env[`AWX_${no}_URL`] = `http://127.0.0.1:${srv.address().port}`;
    process.env[`AWX_${no}_TOKEN`] = `logx-alt-token-${no}`;
    process.env[`AWX_${no}_NAME`] = `awx-${no}`;
  }
});
after(() => awx.forEach((s) => s.close()));

let kayit;
const guncellenen = [];
beforeEach(() => {
  istekler.length = 0;
  guncellenen.length = 0;
  for (const s of Object.values(sunucular)) {
    s.sablonlar = new Map();
    s.liste = [];
  }
  kayit = { templateId: 501, playbookPath: 'logx/logx_legacy_discovery.yml', awxServerId: 3 };
});

const yer = (p, exports) => {
  const tam = require.resolve(p);
  require.cache[tam] = { id: tam, filename: tam, loaded: true, exports };
};
yer('../../../db/index.cjs', {
  query: async (sql, params) => {
    if (/^\s*SELECT \* FROM logx_v2_jobs WHERE request_id/.test(sql)) return { rows: [] };
    if (/^\s*INSERT INTO logx_v2_jobs/.test(sql)) {
      return {
        rows: [{ id: 1, request_id: 'R1', job_type: 'legacy_discovery', awx_server_id: params[2], awx_job_id: params[3], status: 'pending' }],
      };
    }
    throw new Error(`taklit DB tanimiyor: ${sql.slice(0, 80)}`);
  },
});
yer('../../../ansible/playbook-registry.cjs', {
  getByKey: async (k) => (k === 'logx_legacy_discovery' ? { keyName: k, displayName: k, enabled: true, ...kayit } : null),
  getEffectiveTemplateId: (row) => row.templateId,
  updateServerId: async (k, no) => {
    guncellenen.push([k, no]);
    return true;
  },
});
yer('../requests.cjs', { getRequestRow: async () => ({ username: 'kullanici1' }) });
yer('../../../auth/users.cjs', {
  getUserIdentity: async () => ({ username: 'kullanici1', displayName: 'Kullanici Bir', mail: 'k1@ornek.test' }),
});
yer('../../audit.cjs', {});

const jobs = require('../jobs.cjs');

function sablon(no, id, playbook, durum = 200) {
  sunucular[no].liste.push({ id, name: `Sablon ${id}`, playbook });
  sunucular[no].sablonlar.set(id, {
    durum,
    govde: { id, name: `Sablon ${id}`, playbook, ask_variables_on_launch: true, survey_enabled: false },
  });
}
const baslatma = (no) => istekler.filter((i) => i.startsWith(`${no} POST`) && i.endsWith('/launch/'));

test('AS1 alternatifte ayni playbook: baslar, kayit duzeltilir', async () => {
  sablon(2, 501, 'roles/logx/logx_legacy_discovery.yml');
  const is = await jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' });
  assert.equal(is.awxJobId, 7002);
  assert.equal(baslatma(2).length, 1);
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(guncellenen, [['logx_legacy_discovery', 2]]);
});

test('AS2 alternatifte baska playbook: 409, baslatilmaz, kayit degismez', async () => {
  sablon(2, 501, 'retirement/app_retirement_stop.yml');
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'awx_alternatif_dogrulanamadi');
      assert.match(e.message, /başka bir playbook/);
      assert.match(e.message, /İş başlatılmadı/);
      return true;
    },
  );
  assert.equal(baslatma(2).length, 0, 'baska is LogX degiskenleriyle baslatildi');
  assert.deepEqual(guncellenen, []);
});

test('AS3 alternatif template okunamiyor: 409, baslatilmaz', async () => {
  sablon(2, 501, 'logx/logx_legacy_discovery.yml', 500);
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => e.status === 409 && /okunamadı/.test(e.message),
  );
  assert.equal(baslatma(2).length, 0);
});

test('AS4 kayitta playbook yolu bos: 409, baslatilmaz', async () => {
  kayit.playbookPath = '';
  sablon(2, 501, 'herhangi/bir_is.yml');
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => e.status === 409 && /playbook yolu boş/.test(e.message),
  );
  assert.equal(baslatma(2).length, 0);
});

test('AS5 template hicbir yerde yok: "sunucu yok" denir, "template bulunamadi" denmez', async () => {
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => {
      assert.equal(e.code, 'awx_server_missing');
      assert.match(e.message, /AWX sunucusu bulunamadı/);
      assert.match(e.message, /logx_legacy_discovery/);
      assert.doesNotMatch(e.message, /job template bulunamadı/);
      return true;
    },
  );
  assert.equal(baslatma(1).length + baslatma(2).length, 0);
});
