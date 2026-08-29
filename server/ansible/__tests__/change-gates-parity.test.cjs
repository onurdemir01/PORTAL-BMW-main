// server/ansible/__tests__/change-gates-parity.test.cjs — CIKARMANIN PARITY TESTI.
//
// 2026-08-29'da OCO + Smart kapilari `runner.cjs`'teki `launch-ss` handler'inin
// govdesinden `change-gates.cjs`'e tasindi. Bu bir DAVRANIS DEGISIKLIGI DEGILDI —
// ama "degildi" demek yetmez, KANITLANMASI gerekir: bu kapilar bir prod kesintisini
// engelleyen tek sey ve calisan Self Service akisina dokunuldu.
//
// Bu test, cikarma ONCESI kodun ureteceği HTTP durumunu ve govde alanlarini tek tek
// sayar. Beklenen degerler `runner.cjs`'in cikarmadan onceki halinden (main@49ad3ed,
// satir 2437-2600) BIREBIR okunmustur; bir reviewer `git show 49ad3ed:server/ansible/
// runner.cjs | sed -n '2437,2600p'` ile karsilastirabilir.
//
// DB/AWX/ag gerektirmez: oco ve smart modulleri require cache'ten degistirilir
// (server/oco/__tests__/poller-approval-race.test.cjs ile AYNI desen).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const GATES_PATH = require.resolve('../change-gates.cjs');

// Kapinin dokundugu her dis modul burada sahtelenir. Varsayilanlar "mutlu yol"dur;
// her senaryo yalnizca ilgilendigi parcayi ezer — boylece bir testin kurdugu durum
// digerine sizmaz.
// `async` OLMAK ZORUNDA. Ilk yazimda senkrondu ve `fn` bir promise donduruyordu:
// `finally` promise OLUSUNCA calisiyor, promise COZULUNCE degil. Yani mock'lar test
// govdesinin ilk `await`inden hemen sonra geri aliniyor ve testin geri kalani GERCEK
// modullerle kosuyordu — dogru sebeple gecmis gibi gorunen testler uretiyordu.
async function withMocks(overrides, fn) {
  const paths = {
    prodDetect: require.resolve('../../oco/prod-detect.cjs'),
    ocoClient: require.resolve('../../oco/client.cjs'),
    ocoWindow: require.resolve('../../oco/window.cjs'),
    ocoStore: require.resolve('../../oco/store.cjs'),
    smartClient: require.resolve('../../smart/client.cjs'),
    smartStore: require.resolve('../../smart/store.cjs'),
    audit: require.resolve('../../audit/index.cjs'),
    smartGate: require.resolve('../smart-gate.cjs'),
  };
  const saved = {};
  for (const [k, p] of Object.entries(paths)) saved[k] = require.cache[p];

  const calls = [];
  const defaults = {
    prodDetect: { isProductionRequest: () => true },
    ocoClient: { getChangeOrder: async () => ({ payload: {}, result: { Subject: 'Test degisikligi' } }) },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: '01.09.2026 14:00:00', endDate: '01.09.2026 16:00:00' }),
      evaluateWindow: () => ({
        ok: true, phase: 'inside', equal: false,
        startText: '01.09.2026 14:00:00', endText: '01.09.2026 16:00:00',
        windowStartText: '01.09.2026 14:00:00', windowEndText: '01.09.2026 16:00:00',
        windowStart: new Date('2026-09-01T14:00:00'), windowEnd: new Date('2026-09-01T16:00:00'),
        message: 'pencere acik',
      }),
    },
    ocoStore: {
      create: async (a) => { calls.push(['oco.create', a]); return { id: 77 }; },
      createAwxScheduled: async (a) => { calls.push(['oco.createAwxScheduled', a]); return { id: 88 }; },
    },
    smartClient: { createTicket: async (a) => { calls.push(['smart.createTicket', a]); return { ticketId: 'WF-1', raw: {} }; } },
    smartStore: { createTicket: async (a) => { calls.push(['smart.storeTicket', a]); return { id: 42 }; } },
    audit: { auditPortal: (req, action, o) => { calls.push(['audit', action, o]); } },
    smartGate: { isSmartRequired: () => false },
  };

  for (const [k, p] of Object.entries(paths)) {
    const mod = new Module(p, null);
    mod.exports = { ...defaults[k], ...(overrides[k] || {}) };
    mod.loaded = true;
    require.cache[p] = mod;
  }
  delete require.cache[GATES_PATH];
  const gates = require(GATES_PATH);

  try {
    return await fn(gates, calls);
  } finally {
    for (const [k, p] of Object.entries(paths)) {
      if (saved[k]) require.cache[p] = saved[k]; else delete require.cache[p];
    }
    delete require.cache[GATES_PATH];
  }
}

function baseCtx(extra = {}) {
  return {
    server: { id: 1 },
    templateId: 55,
    username: 'hakanisc',
    req: { session: { user: { mail: 'h@x.tr' } }, body: {} },
    overrides: { ocoCheck: { enabled: true }, smartApproval: { flowKey: 'FLOW-1' } },
    extraVars: { env: 'prod' },
    gateVars: { env: 'prod' },
    detail: { id: 55 },
    resolvedLaunchOptions: {},
    specFields: [],
    templateName: 'Test Template',
    createOcoAwxSchedule: async () => ({ scheduleId: 9, scheduleName: 'SCHED', rrule: 'RRULE:...' }),
    friendlyAwxError: (e) => ({ status: 502, message: e.message }),
    buildSmartMetadata: () => [{ key: 'app', value: 'x' }],
    ...extra,
  };
}

// ── OCO kapisi: dokuz dal ────────────────────────────────────────────────────

test('OCO: kapi kapali (ocoCheck.enabled=false) → hic calismaz', async () => {
  await withMocks({}, (gates) => {
    assert.equal(gates.isOcoGateApplicable({ ocoCheck: { enabled: false } }, { env: 'prod' }), false);
  });
});

test('OCO: production DEGILSE kapi hic calismaz', async () => {
  await withMocks({ prodDetect: { isProductionRequest: () => false } }, (gates) => {
    assert.equal(gates.isOcoGateApplicable({ ocoCheck: { enabled: true } }, { env: 'test' }), false);
  });
});

test('OCO: numara yoksa → 400 { ocoRequired: true }', async () => {
  await withMocks({}, async (gates) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '   ' }));
    assert.equal(d.outcome, 'error');
    assert.equal(d.status, 400);
    assert.equal(d.body.ocoRequired, true);
    assert.equal(d.body.ok, false);
  });
});

test('OCO: servis hatasi → hatanin kendi statusu + ocoRequired', async () => {
  await withMocks({
    ocoClient: { getChangeOrder: async () => { throw Object.assign(new Error('OCO kaydi bulunamadi'), { status: 404 }); } },
  }, async (gates) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.status, 404);
    assert.equal(d.body.ocoRequired, true);
    assert.match(d.body.message, /bulunamadi/);
  });
});

test('OCO: PlannedInterruption yoksa → 400, ocoRequired YOK', async () => {
  await withMocks({ ocoWindow: { extractPlannedInterruption: () => null, evaluateWindow: () => ({ ok: true }) } },
    async (gates) => {
      const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
      assert.equal(d.status, 400);
      assert.equal(d.body.ocoRequired, undefined, 'bu dalda ocoRequired GONDERILMEZ (eski davranis)');
      assert.match(d.body.message, /PlannedInterruption/);
    });
});

test('OCO: pencere gecersizse (evaluateWindow.ok=false) → 400', async () => {
  await withMocks({
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: false, message: 'Bitis baslangictan once' }),
    },
  }, async (gates) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.status, 400);
    assert.equal(d.body.message, 'Bitis baslangictan once');
  });
});

test('OCO: pencere DOLMUS → 400 { ocoExpired } + selfservice_oco_expired denetimi', async () => {
  await withMocks({
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: true, phase: 'expired', windowEndText: '01.09.2026 16:00:00', message: 'Pencere doldu' }),
    },
  }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.status, 400);
    assert.equal(d.body.ocoExpired, true);
    assert.equal(d.body.oco.ocoNumber, '123');
    assert.ok(calls.some((c) => c[0] === 'audit' && c[1] === 'selfservice_oco_expired'));
  });
});

test('OCO: pencere HENUZ baslamadi + karar yok → 400 { ocoDecisionRequired }', async () => {
  await withMocks({
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: true, phase: 'before', message: 'Pencere 14:00\'te aciliyor' }),
    },
  }, async (gates) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.status, 400);
    assert.equal(d.body.ocoDecisionRequired, true);
    assert.equal(d.body.oco.phase, 'before');
  });
});

test("OCO: ocoAction='later' → HTTP 200 { ocoDeferred }, hicbir kayit acilmaz", async () => {
  await withMocks({
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: true, phase: 'before', message: '...' }),
    },
  }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123', ocoAction: 'later' }));
    assert.equal(d.outcome, 'respond');
    assert.equal(d.body.ocoDeferred, true);
    assert.equal(calls.filter((c) => c[0].startsWith('oco.')).length, 0, 'later hicbir kayit ACMAMALI');
    assert.equal(calls.filter((c) => c[0].startsWith('smart.')).length, 0);
  });
});

test("OCO: ocoAction='schedule' + Smart GEREKMIYOR → AWX-native schedule", async () => {
  await withMocks({
    smartGate: { isSmartRequired: () => false },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({
        ok: true, phase: 'before', windowStart: new Date('2026-09-01T14:00:00'),
        windowEnd: new Date('2026-09-01T16:00:00'), windowStartText: '01.09.2026 14:00:00', message: '...',
      }),
    },
  }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123', ocoAction: 'schedule' }));
    assert.equal(d.outcome, 'respond');
    assert.equal(d.body.ocoScheduled, true);
    assert.equal(d.body.awxScheduleId, 9);
    assert.ok(calls.some((c) => c[0] === 'oco.createAwxScheduled'));
    assert.ok(!calls.some((c) => c[0] === 'oco.create'), 'portal poller kaydi ACILMAMALI');
    assert.ok(calls.some((c) => c[0] === 'audit' && c[1] === 'selfservice_oco_awx_scheduled'));
  });
});

test("OCO: ocoAction='schedule' + Smart GEREKIYOR → AWX'e DEVREDILMEZ (onay kapisi atlanmasin)", async () => {
  // Bu, testin en kritik maddesi: AWX schedule'i hicbir onaya BAKMADAN job baslatir.
  await withMocks({
    smartGate: { isSmartRequired: () => true },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({
        ok: true, phase: 'before', windowStart: new Date('2026-09-01T14:00:00'),
        windowEnd: new Date('2026-09-01T16:00:00'), windowStartText: '01.09.2026 14:00:00', message: '...',
      }),
    },
  }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123', ocoAction: 'schedule' }));
    assert.equal(d.body.ocoScheduled, true);
    assert.equal(d.body.viaSmart, true);
    assert.ok(calls.some((c) => c[0] === 'oco.create'), 'portal poller kaydi ACILMALI');
    assert.ok(!calls.some((c) => c[0] === 'oco.createAwxScheduled'), 'AWX-native schedule ACILMAMALI — onay atlanirdi');
  });
});

test('OCO: AWX schedule kurulamazsa → hata, kayit acilmaz', async () => {
  await withMocks({
    smartGate: { isSmartRequired: () => false },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: true, phase: 'before', windowStart: new Date(), windowEnd: new Date(), windowStartText: 'x', message: '...' }),
    },
  }, async (gates, calls) => {
    const ctx = baseCtx({ ocoNumber: '123', ocoAction: 'schedule' });
    ctx.createOcoAwxSchedule = async () => { throw new Error('AWX 500'); };
    const d = await gates.runChangeGates(ctx);
    assert.equal(d.outcome, 'error');
    assert.equal(d.status, 502);
    assert.match(d.body.message, /AWX zamanlaması oluşturulamadı/);
    assert.ok(!calls.some((c) => c[0].startsWith('oco.')), 'schedule kurulamadiysa DB kaydi ACILMAMALI');
  });
});

test('OCO: pencere ACIK → akis devam eder + selfservice_oco_ok denetimi', async () => {
  await withMocks({ smartGate: { isSmartRequired: () => false } }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.outcome, 'proceed');
    assert.ok(calls.some((c) => c[0] === 'audit' && c[1] === 'selfservice_oco_ok'));
  });
});

// ── Smart kapisi ─────────────────────────────────────────────────────────────

test('Smart: gerekmiyorsa bilet ACILMAZ', async () => {
  await withMocks({ smartGate: { isSmartRequired: () => false } }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.outcome, 'proceed');
    assert.equal(calls.filter((c) => c[0].startsWith('smart.')).length, 0);
  });
});

test('Smart: gerekiyorsa bilet acilir → 200 { pendingApproval } + denetim', async () => {
  await withMocks({ smartGate: { isSmartRequired: () => true } }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.outcome, 'respond');
    assert.equal(d.body.pendingApproval, true);
    assert.equal(d.body.ticketId, 42);
    assert.equal(d.body.externalTicketId, 'WF-1');
    assert.ok(calls.some((c) => c[0] === 'audit' && c[1] === 'selfservice_smart_ticket_open'));
  });
});

test('Smart: flowKey bos → 400, bilet ACILMAZ', async () => {
  await withMocks({ smartGate: { isSmartRequired: () => true } }, async (gates, calls) => {
    const ctx = baseCtx({ ocoNumber: '123' });
    ctx.overrides = { ocoCheck: { enabled: false }, smartApproval: { flowKey: '  ' } };
    const d = await gates.runChangeGates(ctx);
    assert.equal(d.status, 400);
    assert.match(d.body.message, /Smart Flow Key tanımlanmamış/);
    assert.equal(calls.filter((c) => c[0].startsWith('smart.')).length, 0);
  });
});

test('Smart: createTicket hatasi → hatanin statusu, is TETIKLENMEZ', async () => {
  await withMocks({
    smartGate: { isSmartRequired: () => true },
    smartClient: { createTicket: async () => { throw Object.assign(new Error('Smart talebi reddedildi'), { status: 502 }); } },
  }, async (gates, calls) => {
    const ctx = baseCtx({ ocoNumber: '123' });
    ctx.overrides = { ocoCheck: { enabled: false }, smartApproval: { flowKey: 'F' } };
    const d = await gates.runChangeGates(ctx);
    assert.equal(d.outcome, 'error');
    assert.equal(d.status, 502);
    assert.match(d.body.message, /Smart talebi açılamadı/);
    assert.ok(!calls.some((c) => c[0] === 'smart.storeTicket'), 'Smart reddettiyse DB kaydi ACILMAMALI');
  });
});

test('Smart: OCO kapisi SMART\'TAN ONCE calisir', async () => {
  // Penceresi gecmis bir OCO icin Smart'ta bosuna talep acmak, kullaniciyi bekletip
  // sonra reddetmek olurdu.
  await withMocks({
    smartGate: { isSmartRequired: () => true },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({ ok: true, phase: 'expired', windowEndText: 'x', message: 'doldu' }),
    },
  }, async (gates, calls) => {
    const d = await gates.runChangeGates(baseCtx({ ocoNumber: '123' }));
    assert.equal(d.body.ocoExpired, true);
    assert.equal(calls.filter((c) => c[0].startsWith('smart.')).length, 0, 'OCO dustuyse Smart bileti ACILMAMALI');
  });
});

// ── pendingLaunch paketinin sekli (cagirma yerine gore FARKLI, bilincli) ──────

test('openSmartTicket: pendingLaunchExtras verilmezse gateVars pakete GIRMEZ', async () => {
  await withMocks({}, async (gates, calls) => {
    await gates.openSmartTicket({
      server: { id: 1 }, templateId: 55, username: 'u', email: 'e',
      templateName: 'T',
      overrides: { smartApproval: { flowKey: 'F' } },
      extraVars: { a: 1 }, detail: {}, resolvedLaunchOptions: {}, specFields: [],
      buildSmartMetadata: () => [],
    });
    const stored = calls.find((c) => c[0] === 'smart.storeTicket')[1];
    assert.equal('gateVars' in stored.pendingLaunch, false,
      'launch-ss / ss-test paketinde gateVars YOKTUR — o kayitlar performSsLaunch ile dogrudan oynatilir');
  });
});

test('openSmartTicket: pendingLaunchExtras ile gateVars + ocoRecordId pakete girer', async () => {
  await withMocks({}, async (gates, calls) => {
    await gates.openSmartTicket({
      server: { id: 1 }, templateId: 55, username: 'u', email: '',
      templateName: 'T',
      overrides: { smartApproval: { flowKey: 'F' } },
      extraVars: { a: 1 }, detail: {}, resolvedLaunchOptions: {}, specFields: [],
      buildSmartMetadata: () => [],
      pendingLaunchExtras: { gateVars: { env: 'prod' }, ocoRecordId: 7 },
    });
    const stored = calls.find((c) => c[0] === 'smart.storeTicket')[1];
    // Bu paket ileride launchOrRequestApproval ile oynatilir; kapi YENIDEN calisir.
    // gateVars olmasaydi bos nesneye duser ve onay HER ZAMAN gerekli olurdu.
    assert.deepEqual(stored.pendingLaunch.gateVars, { env: 'prod' });
    assert.equal(stored.pendingLaunch.ocoRecordId, 7);
  });
});

test('openSmartTicket: auditAction verilmezse denetim kaydi YAZILMAZ', async () => {
  await withMocks({}, async (gates, calls) => {
    await gates.openSmartTicket({
      server: { id: 1 }, templateId: 55, username: 'u', email: '',
      templateName: 'T',
      overrides: { smartApproval: { flowKey: 'F' } },
      extraVars: {}, detail: {}, resolvedLaunchOptions: {}, specFields: [],
      buildSmartMetadata: () => [],
    });
    assert.equal(calls.filter((c) => c[0] === 'audit').length, 0,
      'ss/test/run ve poller yolu bu denetimi yazMAZ — eski davranis');
  });
});
