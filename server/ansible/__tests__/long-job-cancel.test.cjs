// server/ansible/__tests__/long-job-cancel.test.cjs — uzun suren job'larin otomatik iptali.
// Kullanici kararlari (2026-09-14): esik 60 dk, YALNIZCA izin listesindeki template'ler,
// dogrudan iptal + Teams.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ljc = require('../long-job-cancel.cjs');

const T0 = Date.parse('2026-09-14T10:00:00Z');
const job = (over = {}) => ({
  serverId: 1, serverName: 'maestro2', jobId: 500, jobName: 'nginx_config_audit', templateId: 42,
  executer: 'odemir', started: '2026-09-14T08:00:00Z', url: 'https://maestro2/#/jobs/500', ...over,
});
const CFG = ljc.normalizeConfig({ enabled: true, thresholdMinutes: 60, templates: [{ serverId: 1, templateId: 42, name: 'nginx_config_audit' }] });

test('normalizeConfig: varsayilan kapali, esik 5..1440 arasi, gecersiz template atilir', () => {
  const c = ljc.normalizeConfig(null);
  assert.deepEqual(c, { enabled: false, thresholdMinutes: 60, templates: [] });
  const d = ljc.normalizeConfig({ enabled: 'true', thresholdMinutes: 2, templates: [{ serverId: 0, templateId: 5 }, { serverId: '1', templateId: '7', name: 'x' }] });
  assert.equal(d.enabled, false, "'true' metni true DEGIL - yalnizca boolean");
  assert.equal(d.thresholdMinutes, 5);
  assert.deepEqual(d.templates, [{ serverId: 1, templateId: 7, name: 'x' }]);
});

test('shouldCancel: esik + izin listesi + started; liste disi ASLA iptal edilmez', () => {
  assert.equal(ljc.shouldCancel(CFG, job(), T0).cancel, true, '120 dk, listede -> iptal');
  assert.equal(ljc.shouldCancel(CFG, job({ started: '2026-09-14T09:30:00Z' }), T0).cancel, false, '30 dk -> esik altinda');
  assert.equal(ljc.shouldCancel(CFG, job({ templateId: 99 }), T0).reason, 'izin listesinde degil');
  assert.equal(ljc.shouldCancel(CFG, job({ serverId: 2 }), T0).reason, 'izin listesinde degil', 'ayni template id BASKA sunucuda sayilmaz');
  assert.equal(ljc.shouldCancel({ ...CFG, enabled: false }, job(), T0).reason, 'kapali');
  assert.equal(ljc.shouldCancel(CFG, job({ started: null }), T0).reason, 'started yok');
  // tam esik: 60 dk -> iptal (>=)
  assert.equal(ljc.shouldCancel(CFG, job({ started: '2026-09-14T09:00:00Z' }), T0).cancel, true);
});

test('processJobs: iptal + audit + Teams; ayni job ikinci tick te TEKRAR iptal edilmez; zaten bitmis sessiz', async () => {
  ljc._reset();
  const db = { query: async (sql) => (sql.includes('SELECT data') ? { rows: [{ data: JSON.stringify(CFG) }] } : { rows: [] }) };
  const calls = [];
  const runner = { cancelJobOnServer: async (sid, jid) => { calls.push([sid, jid]); return jid === 501 ? { canceled: false, alreadyTerminal: true } : { canceled: true }; } };
  const audits = [];
  const jobs = [job(), job({ jobId: 501 }), job({ jobId: 502, templateId: 99 })];
  const r1 = await ljc.processJobs(jobs, { db, runner, webhookUrl: '', audit: (a, o) => audits.push([a, o]) });
  assert.deepEqual(calls, [[1, 500], [1, 501]], 'liste disi 502 dokunulmaz');
  assert.equal(r1.filter((x) => x.ok).length, 2);
  assert.equal(audits.length, 1, 'zaten bitmis job icin audit yazilmaz');
  assert.equal(audits[0][0], 'awx_long_job_cancel');
  // ikinci tick: ayni job hala listedeyse (AWX cancel gecikmeli) tekrar cancel CAGRILMAZ
  await ljc.processJobs(jobs, { db, runner, webhookUrl: '', audit: () => {} });
  assert.equal(calls.length, 2);
  ljc._reset();
});

test('processJobs: cancel hatasi tekrar denenir ama en fazla 3 kez', async () => {
  ljc._reset();
  const db = { query: async () => ({ rows: [{ data: JSON.stringify(CFG) }] }) };
  let n = 0;
  const runner = { cancelJobOnServer: async () => { n++; throw new Error('AWX 500'); } };
  for (let i = 0; i < 5; i++) await ljc.processJobs([job()], { db, runner, webhookUrl: '' });
  assert.equal(n, 3);
  ljc._reset();
});

test('Teams karti: sunucu, job, baslatan, sure ve esik yazar', () => {
  const card = ljc.teamsCard(job(), 125.7, CFG);
  const txt = JSON.stringify(card);
  for (const s of ['maestro2', '#500', 'nginx_config_audit', 'odemir', '125 dk', 'eşik 60 dk', 'iptal edildi']) assert.ok(txt.includes(s), `kartta yok: ${s}`);
});
