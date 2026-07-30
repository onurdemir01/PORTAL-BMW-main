// server/ai-analyst/__tests__/portal-tools.test.cjs — waitForJob'un "hemen tamamlanmadiysa
// jobId don, LLM portal_logx_job_result ile takip etsin" kalici cozumu (kurumsal AI kod
// incelemesi, review.md #23 — onceki iki turde ertelenmisti). Gercek AWX/DB gerektirmez;
// server/ansible/runner.cjs mock'lanir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const runnerMod = require('../../ansible/runner.cjs');
const { getPortalTools, _setQuickCheckDelayMs } = require('../portal-tools.cjs');

// Gercek 2s'lik gecikmeleri beklemeden "hic terminal olmuyor" senaryolarini hizli test et.
_setQuickCheckDelayMs(5);

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  };
  let result;
  try { result = fn(); } catch (err) { restore(); throw err; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

async function findTool(name, user) {
  const tools = await getPortalTools(user || { username: 'tester', role: 'User' });
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} toolset icinde bulunmali`);
  return tool;
}

test('portal_logx_fetch_log: is HIZLI biterse (QUICK_CHECK_RETRIES icinde) pending DONMEZ, dogrudan sonuc gelir', async (t) => {
  t.mock.method(runnerMod, 'isConfigured', () => true);
  t.mock.method(runnerMod, 'launchJob', async () => ({ jobId: 1001, status: 'pending' }));
  t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'successful' }));
  t.mock.method(runnerMod, 'getJobOutput', async () => ({ output: 'line1\nline2\nline3' }));

  await withEnv({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    const tool = await findTool('portal_logx_fetch_log');
    const text = await tool.exec({ hostname: 'host1', logFilePath: '/var/log/x.log' });
    assert.match(text, /host1:\/var\/log\/x\.log/);
    assert.match(text, /line1/);
    assert.doesNotMatch(text, /henüz tamamlanmadı/);
  });
});

test('portal_logx_fetch_log: is QUICK_CHECK_RETRIES icinde bitmezse pending doner (jobId ile), SSE bloklamaz', async (t) => {
  t.mock.method(runnerMod, 'isConfigured', () => true);
  t.mock.method(runnerMod, 'launchJob', async () => ({ jobId: 2002, status: 'pending' }));
  // hicbir zaman terminal olmayan bir durum — waitForJob'un kisa kontrolu tukenmeli
  t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'running' }));

  await withEnv({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    const tool = await findTool('portal_logx_fetch_log');
    const text = await tool.exec({ hostname: 'host1', logFilePath: '/var/log/x.log' });
    assert.match(text, /henüz tamamlanmadı/);
    assert.match(text, /jobId=2002/);
    // Uretimde QUICK_CHECK_RETRIES=3 x delayMs=2000 = ~6s (60s DEGIL) — test hizinin
    // dogrulanmasi icin ayrica bkz. server/ansible/__tests__ altindaki gercek-sure testleri
    // gerekmez; buradaki asil garanti "pending path'e dusuluyor" olmasidir.
  });
});

test('portal_logx_job_result: bekleyen bir fetch job\'i tamamlaninca formatFetchResult ile ayni bicimde doner', async (t) => {
  t.mock.method(runnerMod, 'isConfigured', () => true);
  t.mock.method(runnerMod, 'launchJob', async () => ({ jobId: 3003, status: 'pending' }));
  t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'running' }));

  await withEnv({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    const fetchTool = await findTool('portal_logx_fetch_log');
    const pendingText = await fetchTool.exec({ hostname: 'host2', logFilePath: '/var/log/y.log' });
    const jobId = Number(pendingText.match(/jobId=(\d+)/)[1]);
    assert.equal(jobId, 3003);

    // Simdi job bitti — job-result aracini AYNI jobId ile cagir
    t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'successful' }));
    t.mock.method(runnerMod, 'getJobOutput', async () => ({ output: 'sonuc satiri' }));

    const resultTool = await findTool('portal_logx_job_result');
    const out = await resultTool.exec({ jobId });
    assert.match(out.text, /host2:\/var\/log\/y\.log/);
    assert.match(out.text, /sonuc satiri/);
  });
});

test('portal_logx_job_result: bilinmeyen/suresi dolmus jobId icin acikca bilgilendirir (crash etmez)', async (t) => {
  const resultTool = await findTool('portal_logx_job_result');
  const out = await resultTool.exec({ jobId: 999999 });
  assert.match(out.text, /bekleyen bir kayıt bulunamadı/);
});

test('portal_logx_job_result: job hala calisiyorsa "tekrar deneyin" doner, kayit SILINMEZ', async (t) => {
  t.mock.method(runnerMod, 'isConfigured', () => true);
  t.mock.method(runnerMod, 'launchJob', async () => ({ jobId: 4004, status: 'pending' }));
  t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'running' }));

  await withEnv({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    const fetchTool = await findTool('portal_logx_fetch_log');
    await fetchTool.exec({ hostname: 'host3', logFilePath: '/var/log/z.log' });

    const resultTool = await findTool('portal_logx_job_result');
    const out = await resultTool.exec({ jobId: 4004 });
    assert.match(out.text, /hâlâ çalışıyor/);

    // hala calisiyor oldugu icin ikinci bir sorguda da kayit bulunmali
    const out2 = await resultTool.exec({ jobId: 4004 });
    assert.match(out2.text, /hâlâ çalışıyor/);
  });
});

test('portal_logx_analyze_log: pending oldugunda mode="analyze" baglami dogru saklanir ve sonradan kullanilir', async (t) => {
  t.mock.method(runnerMod, 'isConfigured', () => true);
  t.mock.method(runnerMod, 'launchJob', async () => ({ jobId: 5005, status: 'pending' }));
  t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'running' }));

  const aiAnalyzer = require('../../logx/ai-analyzer.cjs');
  t.mock.method(aiAnalyzer, 'analyze', async () => ({
    provider: 'anthropic', model: 'test-model', maskedCount: 0,
    summary: 'test-ozet', severity: 'low', possibleCauses: [], recommendations: [],
  }));

  await withEnv({ AWX_LOG_FETCH_TEMPLATE_ID: '42' }, async () => {
    const analyzeTool = await findTool('portal_logx_analyze_log');
    const pending = await analyzeTool.exec({ hostname: 'host4', logFilePath: '/var/log/a.log', context: 'test-context' });
    assert.match(pending.text, /henüz tamamlanmadı/);
    const jobId = Number(pending.text.match(/jobId=(\d+)/)[1]);

    t.mock.method(runnerMod, 'getJobStatus', async () => ({ status: 'successful' }));
    t.mock.method(runnerMod, 'getJobOutput', async () => ({ output: 'ham log' }));

    const resultTool = await findTool('portal_logx_job_result');
    const out = await resultTool.exec({ jobId });
    assert.match(out.text, /test-ozet/);
    assert.match(out.text, /LogX AI analizi/);
  });
});
