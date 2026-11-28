'use strict';
// SMART TALEP DEPOSU (server/smart/store.cjs) — smart_tickets CRUD ve durum gecisleri. Gercek DB yok:
// db.query cagri aninda okunur, yerinde sahtelenir; sorgu metni ve parametreler dogrulanir.
//   ST1 createTicket: INSERT parametreleri (flowKey yoksa null, pendingLaunch JSON); satir eslemesi
//       (pendingLaunch ayristirilir, sonradan eklenen kolonlar yoksa null).
//   ST2 getTicket / listPending / listByUsername (harf duyarsiz).
//   ST3 listAll: filtreler parametreli (LIKE), sayfa degerleri tamsayiya zorlanir ve sinirlanir.
//   ST4 statusSummary sayilari Number'a cevirir.
//   ST5 cancelTicket: yalniz PENDING; kullanici yalniz kendi talebini, admin herkesinkini iptal
//       eder; not 1000 karaktere kirpilir; iptal eden kisi yazilir.
//   ST6 claimForLaunch / claimTimeoutForRetrigger: yalniz beklenen durumdan LAUNCHING'e (CAS).
//   ST7 markApproved yalniz bir kez; markState kosulsuz ya da beklenen durum(lar)da yazar.
//   ST8 findByOcoRecordIds: kesin esleme (12 ile 123 karismaz), en yeni bilet, bozuk JSON atlanir.
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/index.cjs');
const store = require('../store.cjs');

const SATIR = {
  id: 7,
  external_ticket_id: '4711',
  username: 'Ali',
  awx_server_id: 2,
  awx_template_id: 33,
  flow_key: 'AKIS-1',
  status: 'PENDING',
  smart_state_name: 'Onay Bekliyor',
  pending_launch_json: '{"extraVars":{"a":1},"ocoRecordId":12}',
  awx_job_id: null,
  error_message: null,
  created_at: 'c',
  updated_at: 'u',
  resolved_at: null,
};

const BILET = {
  id: 7,
  externalTicketId: '4711',
  username: 'Ali',
  awxServerId: 2,
  awxTemplateId: 33,
  flowKey: 'AKIS-1',
  status: 'PENDING',
  smartStateName: 'Onay Bekliyor',
  pendingLaunch: { extraVars: { a: 1 }, ocoRecordId: 12 },
  awxJobId: null,
  awxScheduleId: null,
  errorMessage: null,
  cancelNote: null,
  cancelledBy: null,
  approvedAt: null,
  createdAt: 'c',
  updatedAt: 'u',
  resolvedAt: null,
};

/** Yanitlar sirayla doner; cagrilar { sql (bosluklari tek), params } olarak kaydedilir. */
function sahteDb(t, ...yanitlar) {
  const cagrilar = [];
  t.mock.method(db, 'query', async (sql, params) => {
    cagrilar.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return yanitlar.shift() ?? { rows: [] };
  });
  return cagrilar;
}

test('ST1 createTicket parametreleri ve satir eslemesi', async (t) => {
  const c = sahteDb(t, { rows: [SATIR] });
  const bilet = await store.createTicket({
    externalTicketId: '4711',
    username: 'Ali',
    awxServerId: 2,
    awxTemplateId: 33,
    flowKey: '',
    pendingLaunch: { extraVars: { a: 1 } },
  });
  assert.deepEqual(bilet, BILET);
  assert.match(
    c[0].sql,
    /^INSERT INTO smart_tickets \(.*status, pending_launch_json\) OUTPUT INSERTED\.\* VALUES \(\$1, \$2, \$3, \$4, \$5, 'PENDING', \$6\)$/,
  );
  assert.deepEqual(c[0].params, ['4711', 'Ali', 2, 33, null, '{"extraVars":{"a":1}}']);

  // Sonradan eklenen kolonlar doluysa tasinir.
  sahteDb(t, {
    rows: [
      {
        ...SATIR,
        awx_schedule_id: 91,
        cancel_note: 'gerek yok',
        cancelled_by: 'admin',
        approved_at: 'a',
      },
    ],
  });
  const dolu = await store.getTicket(7);
  assert.deepEqual(
    [dolu.awxScheduleId, dolu.cancelNote, dolu.cancelledBy, dolu.approvedAt],
    [91, 'gerek yok', 'admin', 'a'],
  );
});

test('ST2 getTicket, listPending, listByUsername', async (t) => {
  const c = sahteDb(
    t,
    { rows: [SATIR] },
    { rows: [] },
    { rows: [SATIR, SATIR] },
    { rows: [SATIR] },
  );
  assert.deepEqual(await store.getTicket(7), BILET);
  assert.equal(await store.getTicket(8), null);
  assert.deepEqual(await store.listPending(), [BILET, BILET]);
  assert.deepEqual(await store.listByUsername('ALI'), [BILET]);
  assert.deepEqual(
    c.map((x) => [x.sql, x.params]),
    [
      ['SELECT * FROM smart_tickets WHERE id = $1', [7]],
      ['SELECT * FROM smart_tickets WHERE id = $1', [8]],
      ["SELECT * FROM smart_tickets WHERE status = 'PENDING'", undefined],
      [
        'SELECT * FROM smart_tickets WHERE LOWER(username) = LOWER($1) ORDER BY created_at DESC',
        ['ALI'],
      ],
    ],
  );
});

test('ST3 listAll filtreleri parametreli, sayfa degerleri sinirli', async (t) => {
  let c = sahteDb(t, { rows: [{ n: '42' }] }, { rows: [SATIR] });
  let r = await store.listAll();
  assert.deepEqual(r, { total: 42, tickets: [BILET] });
  assert.deepEqual(c[0], { sql: 'SELECT COUNT(*) AS n FROM smart_tickets', params: [] });
  assert.equal(
    c[1].sql,
    'SELECT * FROM smart_tickets ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY',
  );

  c = sahteDb(t, { rows: [] }, { rows: [] });
  r = await store.listAll({
    status: 'TIMEOUT',
    username: 'ali',
    q: "4711' OR 1=1",
    offset: 20,
    limit: 50,
  });
  assert.equal(r.total, 0, 'sayim satiri yoksa 0');
  const kosul =
    'WHERE status = $1 AND username LIKE $2 AND (external_ticket_id LIKE $3 OR pending_launch_json LIKE $3)';
  assert.equal(c[0].sql, `SELECT COUNT(*) AS n FROM smart_tickets ${kosul}`);
  assert.deepEqual(c[0].params, ['TIMEOUT', '%ali%', "%4711' OR 1=1%"]);
  assert.equal(
    c[1].sql,
    `SELECT * FROM smart_tickets ${kosul} ORDER BY created_at DESC OFFSET 20 ROWS FETCH NEXT 50 ROWS ONLY`,
  );
  assert.deepEqual(c[1].params, c[0].params);

  const sayfa = async (offset, limit) => {
    const k = sahteDb(t, { rows: [{ n: 0 }] }, { rows: [] });
    await store.listAll({ offset, limit });
    return /OFFSET (\S+) ROWS FETCH NEXT (\S+) ROWS ONLY/.exec(k[1].sql).slice(1);
  };
  assert.deepEqual(await sayfa(-5, 0), ['0', '100']);
  assert.deepEqual(await sayfa('abc', 'x; DROP'), ['0', '100']);
  assert.deepEqual(await sayfa(2.7, 9999), ['2', '500']);
  assert.deepEqual(await sayfa('10', 0.5), ['10', '1']);
  assert.deepEqual(await sayfa(0, 7.9), ['0', '7']);
});

test('ST4 statusSummary', async (t) => {
  sahteDb(t, {
    rows: [
      { status: 'PENDING', n: '3' },
      { status: 'LAUNCHED', n: 10 },
    ],
  });
  assert.deepEqual(await store.statusSummary(), { PENDING: 3, LAUNCHED: 10 });
});

test('ST5 cancelTicket sahiplik, not ve iptal eden', async (t) => {
  let c = sahteDb(t, { rows: [{ ...SATIR, status: 'CANCELLED' }] });
  const r = await store.cancelTicket(7, 'ali', false);
  assert.equal(r.status, 'CANCELLED');
  assert.match(c[0].sql, /SET status = 'CANCELLED', .*cancel_note = \$3, cancelled_by = \$4 /);
  assert.match(
    c[0].sql,
    /WHERE id = \$1 AND status = 'PENDING' AND LOWER\(username\) = LOWER\(\$2\)$/,
  );
  assert.deepEqual(c[0].params, [7, 'ali', null, 'ali']);

  c = sahteDb(t, { rows: [] });
  const uzun = 'n'.repeat(1500);
  assert.equal(await store.cancelTicket(7, 'ali', true, uzun, 'yonetici'), null);
  assert.match(c[0].sql, /cancel_note = \$2, cancelled_by = \$3 /);
  assert.match(c[0].sql, /WHERE id = \$1 AND status = 'PENDING'$/);
  assert.deepEqual(c[0].params, [7, 'n'.repeat(1000), 'yonetici']);

  c = sahteDb(t, { rows: [] });
  await store.cancelTicket(7, '', true);
  assert.deepEqual(c[0].params, [7, null, null]);
});

test('ST6 durum sahiplenme yalniz beklenen durumdan', async (t) => {
  const c = sahteDb(
    t,
    { rows: [{ ...SATIR, status: 'LAUNCHING' }] },
    { rows: [] },
    { rows: [SATIR] },
    { rows: [] },
  );
  assert.equal((await store.claimForLaunch(7)).status, 'LAUNCHING');
  assert.equal(await store.claimForLaunch(7), null);
  assert.ok(await store.claimTimeoutForRetrigger(7));
  assert.equal(await store.claimTimeoutForRetrigger(7), null);
  for (const [i, durum] of [
    [0, 'PENDING'],
    [1, 'PENDING'],
    [2, 'TIMEOUT'],
    [3, 'TIMEOUT'],
  ]) {
    assert.match(
      c[i].sql,
      /SET status = 'LAUNCHING', updated_at = GETUTCDATE\(\) OUTPUT INSERTED\.\*/,
    );
    assert.match(c[i].sql, new RegExp(`WHERE id = \\$1 AND status = '${durum}'$`));
    assert.deepEqual(c[i].params, [7]);
  }
});

test('ST7 markApproved bir kez; markState kosullu yazim', async (t) => {
  let c = sahteDb(t, { rows: [{ id: 7 }] }, { rows: [] });
  assert.equal(await store.markApproved(7, 'Onaylandi'), true);
  assert.equal(await store.markApproved(7), false);
  assert.match(c[0].sql, /WHERE id = \$1 AND status = 'PENDING' AND approved_at IS NULL$/);
  assert.deepEqual(c[0].params, [7, 'Onaylandi']);
  assert.deepEqual(c[1].params, [7, null]);

  c = sahteDb(t, { rows: [{ id: 7 }] }, { rows: [] }, { rows: [{ id: 7 }] });
  assert.equal(await store.markState(7, { status: 'LAUNCHED', awxJobId: 900 }), true);
  assert.match(c[0].sql, /resolved_at = resolved_at OUTPUT INSERTED\.id WHERE id = \$5$/);
  assert.deepEqual(c[0].params, ['LAUNCHED', null, 900, null, 7]);

  assert.equal(
    await store.markState(7, {
      status: 'FAILED',
      errorMessage: 'is dustu',
      resolved: true,
      expected: 'LAUNCHING',
    }),
    false,
  );
  assert.match(
    c[1].sql,
    /resolved_at = GETUTCDATE\(\) OUTPUT INSERTED\.id WHERE id = \$5 AND status IN \(\$6\)$/,
  );
  assert.deepEqual(c[1].params, ['FAILED', null, null, 'is dustu', 7, 'LAUNCHING']);

  await store.markState(7, {
    status: 'TIMEOUT',
    smartStateName: 'S',
    expected: ['PENDING', 'LAUNCHING'],
  });
  assert.match(c[2].sql, /WHERE id = \$5 AND status IN \(\$6, \$7\)$/);
  assert.deepEqual(c[2].params, ['TIMEOUT', 'S', null, null, 7, 'PENDING', 'LAUNCHING']);
});

test('ST8 findByOcoRecordIds kesin esleme ve en yeni bilet', async (t) => {
  let c = sahteDb(t);
  for (const ids of [[], undefined, ['x', 1.5, Number.NaN]]) {
    const m = await store.findByOcoRecordIds(ids);
    assert.equal(m.size, 0);
  }
  assert.equal(c.length, 0, 'gecerli kimlik yokken sorgu atildi');

  const satir = (id, json) => ({ ...SATIR, id, pending_launch_json: json });
  c = sahteDb(t, {
    rows: [
      satir(30, '{"ocoRecordId":123}'),
      satir(29, '{bozuk'),
      satir(28, '{"ocoRecordId":"12"}'),
      satir(27, '{"ocoRecordId":12}'),
      satir(26, 'null'),
      satir(25, '{"ocoRecordId":99}'),
    ],
  });
  const m = await store.findByOcoRecordIds(['12', 123, 7]);
  assert.deepEqual([...m.keys()].sort(), [12, 123]);
  assert.equal(m.get(12).id, 28, 'en yeni bilet secilmedi');
  assert.equal(m.get(123).id, 30);
  assert.match(
    c[0].sql,
    /WHERE pending_launch_json LIKE '%"ocoRecordId":%' AND created_at >= DATEADD\(day, -90, GETUTCDATE\(\)\) ORDER BY id DESC$/,
  );
});
