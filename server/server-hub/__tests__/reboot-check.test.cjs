// server/server-hub/__tests__/reboot-check.test.cjs — RC1..RC5 (2026-10-08).
//
// Reboot Kontrolu: "once" goruntusu Portal'da saklanir ve "sonra" job'ina Portal verir; sunucu
// SORUNSUZ ancak son goruntu OLCULDU ve once ile farki yoksa. Duzeltme JVM/web baslatir ve durdurur;
// onaysiz baslamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const http = require('node:http');

const { sonraDegerlendir, onceGirdisi } = require('../reboot-check.cjs');

test('RC1 sorunsuz yalniz: son goruntu olculdu VE fark yok', () => {
  const d = sonraDegerlendir({
    A: { once_var: true, son_olculdu: true, son_fark: [], islemler: ['SONUC|baslat|JBOSS8_JVM|x|OK|ok'] },
    B: { once_var: true, son_olculdu: true, son_fark: ['FARK|DOWN|JBOSS8_JVM|y|d'], islemler: ['SONUC|baslat|JBOSS8_JVM|y|FAIL|hata'] },
    C: { once_var: true, son_olculdu: false, son_fark: [] },
    D: { sonuc_yok: true },
    E: { once_var: false, son_olculdu: true, son_fark: [] },
  }, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(d.A.durum, 'sorunsuz');
  assert.deepEqual([d.B.durum, d.B.kalan, d.B.hatali], ['sorunlu', 1, 1]);
  for (const h of ['C', 'D', 'E', 'F']) assert.equal(d[h].durum, 'olculemedi', `${h} olculemedigi halde sorunsuz/sorunlu sayildi`);
});

test('RC2 "sonra" girdisi yalniz goruntusu ALINAN sunuculari tasir', () => {
  const g = onceGirdisi({
    A: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] },
    B: { goruntu_ok: false, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] },
    C: { goruntu_ok: true, goruntu: [] },
    D: { sonuc_yok: true },
  });
  assert.deepEqual(Object.keys(g), ['A']);
});

// --- uc testi: sahte db + sahte launch
function sahteDb(satir) {
  const yaz = [];
  const p = require.resolve('../../db/index.cjs');
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.loaded = true;
  m.exports = {
    query: async (sql, params) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT \* FROM reboot_checks WHERE id/.test(t.trim())) return { rows: satir ? [satir] : [] };
      yaz.push({ sql: t, params });
      return { rows: [{ id: 7 }] };
    },
  };
  require.cache[p] = m;
  return { yaz, geri: () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; } };
}
async function istek(router, yol, govde) {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => { req.session = { user: { username: 'onur', role: 'Admin' } }; n(); });
  app.use('/x', router);
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/x${yol}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde) });
    return { status: res.status, body: await res.json() };
  } finally { srv.close(); }
}
function routerKur(launchlar) {
  const r = express.Router();
  delete require.cache[require.resolve('../reboot-check.cjs')];
  require('../reboot-check.cjs').mount(r, {
    HOST_RE: /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/,
    launch: async (_req, key, _ad, ev) => { launchlar.push({ key, ev }); return { jobId: 55, awxServerId: 1 }; },
  });
  return r;
}

test('RC3 reboot oncesi: target_hosts + rc_faz=once; kayit acilir', async () => {
  const d = sahteDb(null);
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check', { hosts: ['gbjbop18', 'GBJBOP18', 'gbjboap18'] });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0], { key: 'reboot_check', ev: { rc_faz: 'once', target_hosts: 'GBJBOP18,GBJBOAP18' } });
    assert.ok(d.yaz.some((y) => /INSERT INTO reboot_checks/.test(y.sql)));
    const bos = await istek(routerKur(l), '/reboot-check', { hosts: [] });
    assert.equal(bos.status, 400);
  } finally { d.geri(); }
});

test('RC4 reboot sonrasi ONAYSIZ baslamaz', async () => {
  const d = sahteDb({ id: 7, status: 'once_hazir', hosts_json: '["A"]', once_json: JSON.stringify({ sunucular: { A: { goruntu_ok: true, goruntu: ['X|y|1|1|u|d'] } } }) });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', {});
    assert.equal(r.status, 400);
    assert.equal(l.length, 0, 'onaysiz is baslatildi');
  } finally { d.geri(); }
});

test('RC5 reboot sonrasi: "once" goruntusu Portal\'dan rc_once ile gider; goruntusu olmayan sunucu hedeflenmez', async () => {
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|app|1|1|was|d'] }, B: { goruntu_ok: false, goruntu: [] } } };
  const d = sahteDb({ id: 7, status: 'once_hazir', hosts_json: '["A","B"]', once_json: JSON.stringify(once) });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0].ev, { rc_faz: 'sonra', target_hosts: 'A', rc_once: { A: ['JBOSS8_JVM|app|1|1|was|d'] } });
    assert.deepEqual(r.body.disarida, ['B']);
    const durum = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(durum.status, 200);
  } finally { d.geri(); }
});

test('RC6 once job bitince sonuc kayda yazilir: goruntu alinan varsa once_hazir, hic yoksa once_hata', async () => {
  const sahte = (yol, exp) => {
    const p = require.resolve(yol); const eski = require.cache[p];
    const m = new Module(p, null); m.loaded = true; m.exports = exp; require.cache[p] = m;
    return () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; };
  };
  for (const [sunucular, beklenen] of [
    [{ A: { goruntu_ok: true, goruntu: ['X|y|1|1|u|d'] } }, 'once_hazir'],
    [{ A: { goruntu_ok: false, goruntu: [] } }, 'once_hata'],
  ]) {
    const d = sahteDb({ id: 7, status: 'once_kosuyor', hosts_json: '["A"]', once_job_id: 55, once_server_id: 1 });
    const g1 = sahte('../../ansible/runner.cjs', { getJobStatusOnServer: async () => ({ status: 'successful', artifacts: {} }) });
    const g2 = sahte('../../opsx/index.cjs', { extractStatsKey: () => ({ faz: 'once', sunucular }) });
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express(); app.use('/x', r);
      const srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
      try { await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`); } finally { srv.close(); }
      const upd = d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim()));
      assert.ok(upd, 'kayit guncellenmedi');
      assert.equal(upd.params[0], beklenen);
    } finally { g2(); g1(); d.geri(); }
  }
});
