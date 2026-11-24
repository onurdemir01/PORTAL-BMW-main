// server/retirement/__tests__/web-kesif-uc.test.js - Retirement "web kesfini yenile" ucu gercek router ile
// (2026-11-24, kapsam PR-2). web-kesif.test.js ad varyantlarini ve hedef kurulumunu sinar; ucun hedef durumuna gore
// karari ve yazimlari testsizdi. Sahte: kesif, Portal DB.
//   WK-U1 kayit yok / iptal; onizleme (uygula=false) hicbir sey yazmaz ama karari gosterir
//   WK-U2 durum matrisi: degisiklik yok / silinmis / is suruyor / durdurulmus / zamanlanmis STOP / duzenlenebilir /
//         dokunulmayan durum; kesifte olmayan hedef
//   WK-U3 uygula: durdurulmusa web_json + 'skip' sonucu, zamanlanmis STOP'a web_json + 'pending' sonucu,
//         duzenlenebilire yalniz web_json (kosullu yazim); olay ozeti
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const D = { kayit: null, hedefler: [], yazim: [], olaylar: [] };
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM retirement_records WHERE id = $1'))
      return { rows: D.kayit && D.kayit.id === params[0] ? [D.kayit] : [] };
    if (s.startsWith('SELECT * FROM retirement_targets WHERE record_id = $1'))
      return { rows: D.hedefler };
    if (s.startsWith('SELECT TOP 200 * FROM retirement_events')) return { rows: [] };
    if (s.startsWith('INSERT INTO retirement_events')) {
      D.olaylar.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE retirement_targets')) {
      D.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: () => (req, res, next) => next(),
  canSee: async () => true,
});
sahte('../poller.cjs', {
  startPoller() {},
  kayitCanli: async () => ({}),
  zamanlayici: () => ({}),
  awxDurumu: () => null,
  webSimdi: async () => ({ kosan: 0 }),
  pollSaniye: () => 300,
});
sahte('../../audit/index.cjs', { auditPortal: () => {} });
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => ({ id: 2 }),
  launchJobOnServer: async () => ({ jobId: 1 }),
  getJobStatusOnServer: async () => ({ status: 'running' }),
});
// Kesif: gercek modulun diger islevleri korunur, yalniz discover() sahte (index.cjs onu ust duzeyde alir).
const KESIF = { hedefler: [], cagri: [] };
const gercekKesif = require('../discover.cjs');
sahte('../discover.cjs', {
  ...gercekKesif,
  discover: async (app) => {
    KESIF.cagri.push(app);
    return { targets: KESIF.hedefler };
  },
});

const { initRetirement } = require('../index.cjs');
let router = null;
initRetirement({
  use: (yol, r) => {
    if (yol === '/api/retirement') router = r;
  },
});
function istek(url, body = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
      setHeader() {},
      getHeader() {},
    };
    router.handle(
      {
        method: 'POST',
        url,
        headers: {},
        body,
        session: { user: { username: 'adm1', role: 'Admin' } },
        query: {},
      },
      res,
      (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }),
    );
  });
}

const vh = (host, serverName) => ({
  host,
  serverName,
  product: 'IHS',
  port: '443',
  confFile: 'mod-jk.conf',
});
const ESKI = vh('ORJEXW01', 'pos.ornek.invalid');
const YENI = vh('ORJEXW02', 'pos.ornek.invalid');
let sira = 0;
const hedef = (status, ek = {}) => {
  sira += 1;
  return {
    id: sira,
    record_id: 37,
    host: `ORJEXP0${sira}`,
    site: 'Pendik',
    env: 'PROD',
    app_name: 'ORPOSWEBAPI',
    jboss_gen: 7,
    app_path: '/vhosting/ORPOSWEBAPI.ear',
    status,
    web_json: JSON.stringify([ESKI]),
    deleted_at: null,
    ...ek,
  };
};
const kesif = (h, web) => ({
  host: h.host,
  appName: h.app_name,
  gen: 7,
  web,
  webHow: 'sertifika + Server Hub',
});

beforeEach(() => {
  sira = 0;
  D.kayit = {
    id: 37,
    app: 'ORPOSWEBAPI',
    smart_no: '364244',
    status: 'open',
    created_at: '2026-11-20T10:00:00Z',
  };
  Object.assign(D, { hedefler: [], yazim: [], olaylar: [] });
  KESIF.cagri = [];
});

function kur(durumlar) {
  D.hedefler = durumlar.map(([st, ek]) => hedef(st, ek));
  KESIF.hedefler = D.hedefler.map((h) => kesif(h, [ESKI, YENI]));
}

test('WK-U1 kayit denetimi; onizleme yazmaz', async () => {
  assert.equal((await istek('/99/web-kesif')).body.message, 'Kayıt yok.');
  D.kayit.status = 'cancelled';
  assert.equal((await istek('/37/web-kesif')).body.message, 'Kayıt iptal edilmiş.');
  D.kayit.status = 'open';
  kur([['stopped']]);
  const r = await istek('/37/web-kesif', { uygula: 'evet' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.uygulandi, false, 'yalniz true uygular');
  assert.equal(r.body.eklenenToplam, 1);
  assert.equal(r.body.record, undefined);
  assert.deepEqual(KESIF.cagri, ['ORPOSWEBAPI']);
  assert.equal(D.yazim.length, 0);
  assert.equal(D.olaylar.length, 0);
});

test('WK-U2 hedef durumuna gore karar', async () => {
  kur([
    ['active'],
    ['deleted', { deleted_at: '2026-11-24T10:00:00Z' }],
    ['stopping'],
    ['stopped'],
    ['stop_scheduled'],
    ['rolled_back'],
  ]);
  // Ilk hedefte yeni vhost yok; sonuncu kesifte bulunamadi.
  KESIF.hedefler[0] = kesif(D.hedefler[0], [ESKI]);
  D.hedefler.push(hedef('pending'));
  const r = await istek('/37/web-kesif');
  const islem = r.body.hedefler.map((h) => [h.status, h.islem]);
  assert.deepEqual(islem, [
    ['active', 'degisiklik yok'],
    ['deleted', 'silinmiş hedef - vhost elle kapatılmalı'],
    ['stopping', 'iş sürüyor - bitince yeniden deneyin'],
    ['stopped', 'eklenecek (durdurulmuş: "Web adımını yeniden dene" ile kapatılır)'],
    ['stop_scheduled', 'eklenecek (zamanlanmış STOP bunları da kapatır)'],
    ['rolled_back', 'durum rolled_back - dokunulmadı'],
    ['pending', 'degisiklik yok'],
  ]);
  assert.equal(r.body.hedefler.at(-1).webHow, 'kesifte hedef yok');
  assert.equal(r.body.eklenenToplam, 2, 'yalniz eklenecek hedefler sayilir');
  assert.equal(r.body.hedefler[3].eklenen[0].host, 'ORJEXW02');
});

test('WK-U3 uygula: duruma gore yazimlar ve olay', async () => {
  kur([
    [
      'stopped',
      { web_result_json: JSON.stringify([{ ...ESKI, status: 'ok', jobId: 9, message: null }]) },
    ],
    ['stop_scheduled'],
    ['planned'],
  ]);
  const r = await istek('/37/web-kesif', { uygula: true });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.uygulandi, true);
  assert.ok(r.body.record);
  const [durdurulmus, zamanliWeb, zamanliSonuc, planli] = D.yazim;
  assert.match(durdurulmus.s, /web_json = \$1, web_result_json = \$2,.* AND status = 'stopped'/);
  assert.equal(JSON.parse(durdurulmus.params[0]).length, 2);
  const sonuc = JSON.parse(durdurulmus.params[1]);
  assert.deepEqual(
    sonuc.map((w) => [w.host, w.status]),
    [
      ['ORJEXW01', 'ok'],
      ['ORJEXW02', 'skip'],
    ],
  );
  assert.match(
    zamanliWeb.s,
    /SET web_json = \$1, updated_at = GETUTCDATE\(\) WHERE id = \$2 AND status = \$3/,
  );
  assert.equal(zamanliWeb.params[2], 'stop_scheduled');
  assert.match(
    zamanliSonuc.s,
    /web_result_json = \$1 WHERE id = \$2 AND status = 'stop_scheduled'/,
  );
  assert.deepEqual(
    JSON.parse(zamanliSonuc.params[0]).map((w) => [w.host, w.status]),
    [['ORJEXW02', 'pending']],
  );
  assert.equal(planli.params[2], 'planned');
  assert.equal(D.yazim.length, 4, 'duzenlenebilir hedefe web sonucu yazildi');
  assert.equal(D.olaylar.length, 1);
  assert.match(
    D.olaylar[0][3],
    /Web kesfi yenilendi: 3 vhost eklendi - ORJEXP01: ORJEXW02\/pos.ornek.invalid/,
  );
});
