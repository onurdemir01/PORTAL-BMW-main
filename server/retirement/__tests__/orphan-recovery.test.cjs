'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecovery } = require('../orphan-recovery.cjs');

const target = {
  id: 7,
  recordId: 3,
  status: 'stopping',
  host: 'GBJBOP01',
  appName: 'CRM',
  gen: 7,
  appPath: '/app',
};
const record = { smartNo: 'SM-42' };
const history = {
  awx_server_id: 2,
  template_id: 55,
  template_name: 'Retirement: STOP CRM @ GBJBOP01 (zamanlanmis)',
  job_id: 900,
  started_at: '2026-10-16T18:00:30Z',
  params: JSON.stringify({
    target_host: 'GBJBOP01',
    application: 'CRM',
    jboss_gen: '7',
    app_path: '/app',
    smart_no: 'SM-42',
    plan_only: false,
  }),
};
const job = {
  jobId: 900,
  templateId: 55,
  playbook: 'bmw_automation_folder/app_retirement/app_retirement_stop.yml',
  created: '2026-10-16T18:00:00Z',
};
const claimEvents = [
  {
    at: '2026-10-16T18:00:45Z',
    text: 'CRM @ GBJBOP01: STOP isi #900 basladi ancak Portal kaydi tamamlanamadi — DB',
  },
];
const base = {
  kind: 'stop',
  target,
  record,
  history,
  job,
  expectedServerId: 2,
  expectedTemplateId: 55,
  expectedPlaybook: 'app_retirement_stop.yml',
  claimEvents,
};

test('OR1 tam server/template/hedef/eylem/zaman kaniti orphan STOP job ID baglar', () => {
  assert.deepEqual(validateRecovery(base), {
    ok: true,
    field: 'last_job_id',
    status: 'stopping',
    jobId: 900,
  });
});

test('OR2 toplu STOP kismi persistence ayni kayitta ortak job ile uzlastirilir', () => {
  const grouped = {
    ...history,
    params: JSON.stringify({
      rt_hedefler: [
        { host: 'GBJBOP01', application: 'CRM', jboss_gen: '7', app_path: '/app' },
        { host: 'GBJBOP02', application: 'CRM', jboss_gen: '7', app_path: '/app' },
      ],
      smart_no: 'SM-42',
      plan_only: false,
    }),
  };
  const result = validateRecovery({
    ...base,
    history: grouped,
    existingBindings: [
      {
        id: 8,
        record_id: 3,
        host: 'GBJBOP02',
        app_name: 'CRM',
        jboss_gen: 7,
        app_path: '/app',
      },
    ],
  });
  assert.equal(result.ok, true);
});

test('OR3 yanlis server/template/hedef/eylem/zaman ve plan fail-closed reddedilir', () => {
  const cases = [
    { history: { ...history, awx_server_id: 9 } },
    { job: { ...job, templateId: 99 } },
    { job: { ...job, playbook: 'wrong.yml' } },
    { history: { ...history, params: history.params.replace('GBJBOP01', 'WRONG') } },
    { history: { ...history, template_name: 'Retirement: DELETE CRM @ GBJBOP01' } },
    { job: { ...job, created: '2026-10-16T19:00:00Z' } },
    { history: { ...history, started_at: '2026-10-16T19:00:00Z' } },
    { claimEvents: [] },
    { claimEvents: [{ ...claimEvents[0], text: claimEvents[0].text.replace('#900', '#901') }] },
    { claimEvents: [{ ...claimEvents[0], at: '2026-10-16T19:00:00Z' }] },
    { history: { ...history, params: history.params.replace('false', 'true') } },
  ];
  for (const change of cases) assert.equal(validateRecovery({ ...base, ...change }).ok, false);
});

test('OR4 DELETE yalniz tek hedefi ve baska kayitta kullanilmamis job IDyi kabul eder', () => {
  const delTarget = { ...target, status: 'deleting', lastJobId: null, deleteJobId: null };
  const delHistory = { ...history, template_name: 'Retirement: DELETE CRM @ GBJBOP01' };
  const delJob = { ...job, playbook: 'app_retirement_delete.yml' };
  const ok = validateRecovery({
    ...base,
    kind: 'delete',
    target: delTarget,
    history: delHistory,
    job: delJob,
    expectedPlaybook: 'app_retirement_delete.yml',
    claimEvents: [
      {
        at: '2026-10-16T18:00:45Z',
        text: 'CRM @ GBJBOP01: DELETE isi #900 basladi ancak Portal kaydi tamamlanamadi — DB',
      },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(
    validateRecovery({
      ...base,
      kind: 'delete',
      target: delTarget,
      history: delHistory,
      job: delJob,
      expectedPlaybook: 'app_retirement_delete.yml',
      claimEvents: [
        {
          at: '2026-10-16T18:00:45Z',
          text: 'CRM @ GBJBOP01: DELETE isi #900 basladi ancak Portal kaydi tamamlanamadi — DB',
        },
      ],
      existingBindings: [{ id: 8, record_id: 3 }],
    }).ok,
    false,
  );
});

test('OR4b ayni kayittaki baska hedef ancak toplu STOP kanitinda varsa ortak job kullanir', () => {
  const sibling = {
    id: 8,
    record_id: 3,
    host: 'GBJBOP02',
    app_name: 'CRM',
    jboss_gen: 7,
    app_path: '/app',
  };
  assert.equal(validateRecovery({ ...base, existingBindings: [sibling] }).ok, false);
});

test('OR5 route yalniz ID baglar; yeni AWX launch veya claim reset cagirmaz', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const start = src.indexOf("router.post('/:id/targets/:tid/reconcile-job'");
  const end = src.indexOf("router.post('/:id/targets/:tid/refresh-status'", start);
  assert.ok(start > 0 && end > start, 'reconcile-job route yok');
  const route = src.slice(start, end);
  assert.match(route, /validateRecovery/);
  assert.match(route, /FROM retirement_events/);
  assert.match(route, /AND \$\{karar\.field\} IS NULL/);
  assert.match(route, /NOT EXISTS/);
  assert.match(route, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(route, /\$5 = 'delete' OR record_id <> \$3/);
  assert.doesNotMatch(route, /launchJob|\blaunch\(|status = 'stop_scheduled'|status = 'stopped'/);
});
