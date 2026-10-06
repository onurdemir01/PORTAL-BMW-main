// server/oco/__tests__/oco-record-and-window-sync.test.cjs — OW1..OW7 (2026-10-06).
//
// IKI AYRI HATA, IKISI DE "is kosuyor ama ekran/sinir yanlis" sinifindan.
//
// ── HATA 1: VAR OLMAYAN TABLO ADI ──────────────────────────────────────────────
// `markAwxScheduledAfterApproval` `oco_scheduled_jobs` tablosuna yaziyordu; gercek tablo
// `oco_scheduled_launches` (migration: db/mssql-setup.cjs). Sorgu "Invalid object name"
// ile patliyor, cagiran (runner.cjs smart poller callback'i) hatayi `console.warn` ile
// yutuyordu. AWX zamanlamasi KURULUYOR ve is pencerede kosuyor - ama OCO kaydi
// PENDING_APPROVAL'da KALICI olarak takili kaliyor ve "Zamanlanmis Isler" ekrani, onay
// gelmis ve is zamanlanmis olmasina ragmen "onay bekleniyor" gosteriyor.
// O yolda kaydi guncelleyen BASKA mekanizma YOK: smart/poller.cjs'in `outcome.scheduled`
// dali `syncOcoRecord` CAGIRMAZ, dogrudan `continue` eder.
//
// ── HATA 2: PENCERE ACIKKEN SINIRSIZ ONAY ──────────────────────────────────────
// `ocoWindowStartIso/EndIso` yalnizca `phase === 'before'` dalinda pakete giriyordu.
// Oysa Smart biletinin SURE SINIRINI belirleyen alan tam bu: smart/poller.cjs
// `ticket.pendingLaunch.ocoWindowEndIso` okur, bulamazsa genel varsayilana (SINIRSIZ)
// duser. Somut sonuc: OCO penceresi 14:00-16:00, talep 15:00'te girilir (pencere ACIK,
// `inside` dali), onay gece 03:00'te gelir -> IS CALISIR. Pencere saatler once kapanmisti.
// `extraVars.oco_window_end` doluydu ama poller `extraVars`a DEGIL `pendingLaunch`a bakar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SERVER = path.join(__dirname, '..', '..');
const STORE_SRC = fs.readFileSync(path.join(SERVER, 'oco', 'store.cjs'), 'utf8');
const RUNNER_SRC = fs.readFileSync(path.join(SERVER, 'ansible', 'runner.cjs'), 'utf8');
const GATES_SRC = fs.readFileSync(path.join(SERVER, 'ansible', 'change-gates.cjs'), 'utf8');

// Bu modulun DOKUNMAYA IZINLI oldugu tablolar. Migration'da tanimli olan tek tablo
// `oco_scheduled_launches`; `portal_*` gibi baska bir sey eklenirse bilincli bir karardir
// ve bu listeye de yazilmalidir.
const BILINEN_TABLOLAR = new Set(['oco_scheduled_launches']);

// ── Sahte DB: MSSQL'in bilinmeyen tablo davranisini TAKLIT EDER ───────────────
// Bekcinin korudugu sey tam olarak bu: yanlis tablo adi SESSIZ kalmaz, sorgu PATLAR.
// Sahte DB bunu modellemezse (her sorguya basarili demek), tablo adi testinden gecerdi -
// kardes testlerde yasanmis bir korluk (RP9/RP10).
function sahteDb(satirlar) {
  const sorgular = [];
  return {
    sorgular,
    query: async (sql, params = []) => {
      sorgular.push({ sql, params });
      const m = /\b(?:UPDATE|FROM|INTO)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
      const tablo = m && m[1];
      if (!tablo || !BILINEN_TABLOLAR.has(tablo)) {
        throw new Error(`Invalid object name '${tablo || '?'}'.`);
      }
      if (!/^\s*UPDATE/i.test(sql)) return { rows: [], rowCount: 0 };

      // WHERE id = $1 [AND status = 'X']
      const id = params[0];
      const durumSarti = /status\s*=\s*'([A-Z_]+)'\s*$/i.exec(sql.split(/WHERE/i)[1] || '');
      const yeniDurum = /SET\s+status\s*=\s*'([A-Z_]+)'/i.exec(sql);
      const satir = satirlar.find((r) => r.id === id);
      if (!satir) return { rows: [], rowCount: 0 };
      if (durumSarti && satir.status !== durumSarti[1]) return { rows: [], rowCount: 0 };
      if (yeniDurum) satir.status = yeniDurum[1];
      satir.awx_schedule_id = params[1] ?? null;
      satir.run_at = params[2] ?? null;
      return { rows: [{ id: satir.id }], rowCount: 1 };
    },
  };
}

async function storeIle(satirlar, fn) {
  const dbPath = require.resolve('../../db/index.cjs');
  const storePath = require.resolve('../store.cjs');
  const kayitliDb = require.cache[dbPath];
  const kayitliStore = require.cache[storePath];

  const db = sahteDb(satirlar);
  const mod = new Module(dbPath, null);
  mod.exports = db;
  mod.loaded = true;
  require.cache[dbPath] = mod;
  delete require.cache[storePath];

  try {
    return await fn(require('../store.cjs'), db);
  } finally {
    if (kayitliDb) require.cache[dbPath] = kayitliDb;
    else delete require.cache[dbPath];
    if (kayitliStore) require.cache[storePath] = kayitliStore;
    else delete require.cache[storePath];
  }
}

test('OW1 onay sonrasi zamanlama kaydi GERCEKTEN yazilir (var olmayan tabloya gitmez)', async () => {
  const satirlar = [{ id: 77, status: 'PENDING_APPROVAL' }];
  await storeIle(satirlar, async (store) => {
    // Yanlis tablo adiyla bu cagri "Invalid object name" FIRLATIR - bekcinin asil kancasi.
    const yazildi = await store.markAwxScheduledAfterApproval(77, {
      awxScheduleId: 9,
      runAt: new Date('2026-10-08T22:00:00Z'),
    });
    assert.equal(yazildi, true, 'kayit guncellenmedi');
    assert.equal(satirlar[0].status, 'AWX_SCHEDULED', 'kayit PENDING_APPROVAL\'da takili kaldi');
    assert.equal(satirlar[0].awx_schedule_id, 9, 'AWX schedule id yazilmadi');
  });
});

test('OW2 IPTAL EDILMIS kayit AWX_SCHEDULED\'a geri dondurulmez', async () => {
  // Kosulsuz `WHERE id = $1` yazmak, kullanicinin iptalini EZERDI - kardes
  // fonksiyonlarda (claimForLaunch, update, markApprovedLaunched) ayni desen var.
  const satirlar = [{ id: 77, status: 'CANCELLED' }];
  await storeIle(satirlar, async (store) => {
    const yazildi = await store.markAwxScheduledAfterApproval(77, { awxScheduleId: 9, runAt: new Date() });
    assert.equal(yazildi, false, 'iptal edilmis kayit icin true donuldu');
    assert.equal(satirlar[0].status, 'CANCELLED', 'iptal EZILDI');
  });
});

test('OW3 store.cjs BILINMEYEN hicbir tabloya dokunmaz', async () => {
  // OW1 yalnizca TEK fonksiyonu kosturur. Bu bekci dosyadaki TUM sorgulari tarar:
  // ayni yazim hatasi baska bir fonksiyonda tekrarlanirsa burada yakalanir.
  const bulunan = new Set();
  const re = /\b(?:UPDATE|FROM|INTO)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(STORE_SRC)) !== null) bulunan.add(m[1]);
  const yabanci = [...bulunan].filter((t) => !BILINEN_TABLOLAR.has(t));
  assert.deepEqual(yabanci, [], `store.cjs tanimsiz tablo(lar)a yaziyor: ${yabanci.join(', ')}`);
});

test('OW4 runner, kaydin yazilmadigini SESSIZCE gecmez', async () => {
  // Asil hata tek bir yazim hatasi DEGILDI: hatayi yutan `catch` yuzunden 14 gun sessiz
  // kaldi. Donus degeri artik `false` olabiliyor (iptal) ve bu da loglanmali.
  const cb = RUNNER_SRC.slice(
    RUNNER_SRC.indexOf('startPoller(async (ticket)'),
    RUNNER_SRC.indexOf('launchOrRequestApproval'),
  );
  assert.ok(cb.length > 0, 'smart poller callback bulunamadi');
  assert.match(
    cb,
    /=\s*await\s+require\('\.\.\/oco\/store\.cjs'\)\.markAwxScheduledAfterApproval\(/,
    'donus degeri hic alinmiyor - yazilamadi durumu olculemez',
  );
  assert.match(cb, /if\s*\(!\s*yazildi\)/, 'yazilamadi durumu kontrol edilmiyor');
});

// ── HATA 2 ────────────────────────────────────────────────────────────────────

// change-gates'i mock'lanmis bagimliliklarla yukler. `phase` disaridan verilir: ayni
// harness hem 'inside' hem 'before' dalini kosturur.
async function kapiIle({ phase }, fn) {
  const gatesPath = require.resolve('../../ansible/change-gates.cjs');
  const yollar = {
    prodDetect: require.resolve('../prod-detect.cjs'),
    ocoClient: require.resolve('../client.cjs'),
    ocoWindow: require.resolve('../window.cjs'),
    ocoStore: require.resolve('../store.cjs'),
    smartClient: require.resolve('../../smart/client.cjs'),
    smartStore: require.resolve('../../smart/store.cjs'),
    audit: require.resolve('../../audit/index.cjs'),
    smartGate: require.resolve('../../ansible/smart-gate.cjs'),
  };
  const kayitli = {};
  for (const [k, p] of Object.entries(yollar)) kayitli[k] = require.cache[p];

  const windowStart = new Date('2026-10-06T14:00:00Z');
  const windowEnd = new Date('2026-10-06T16:00:00Z');
  const cagrilar = [];
  const mocklar = {
    prodDetect: { isProductionRequest: () => true, readEnvLabel: () => 'prod' },
    ocoClient: {
      getChangeOrder: async () => ({ payload: {}, result: { Subject: 'Test' } }),
      httpStatus: () => 400,
    },
    ocoWindow: {
      extractPlannedInterruption: () => ({ startDate: 'x', endDate: 'y' }),
      evaluateWindow: () => ({
        ok: true, phase, equal: false,
        startText: 's', endText: 'e', windowStartText: 'ws', windowEndText: 'we',
        windowStart, windowEnd, message: 'm',
      }),
    },
    ocoStore: {
      create: async () => ({ id: 77 }),
      createAwxScheduled: async () => ({ id: 88 }),
      markPendingApproval: async () => true,
    },
    smartClient: { createTicket: async () => ({ ticketId: 'WF-1' }) },
    smartStore: {
      createTicket: async (a) => { cagrilar.push(a); return { id: 42 }; },
    },
    audit: { auditPortal: () => {} },
    smartGate: { isSmartRequired: () => true },
  };
  for (const [k, p] of Object.entries(yollar)) {
    const mod = new Module(p, null);
    mod.exports = mocklar[k];
    mod.loaded = true;
    require.cache[p] = mod;
  }
  delete require.cache[gatesPath];

  try {
    return await fn(require(gatesPath), cagrilar, { windowStart, windowEnd });
  } finally {
    for (const [k, p] of Object.entries(yollar)) {
      if (kayitli[k]) require.cache[p] = kayitli[k];
      else delete require.cache[p];
    }
    delete require.cache[gatesPath];
  }
}

function ctx(extra = {}) {
  return {
    server: { id: 1 },
    templateId: 55,
    username: 'onurd',
    req: { session: { user: { mail: 'o@x.tr' } }, body: {} },
    overrides: { ocoCheck: { enabled: true }, smartApproval: { flowKey: 'FLOW-1' } },
    extraVars: { env: 'prod' },
    gateVars: { env: 'prod' },
    detail: { id: 55 },
    resolvedLaunchOptions: {},
    specFields: [],
    templateName: 'Nginx Ops',
    ocoNumber: 'OCO-123',
    createOcoAwxSchedule: async () => ({ scheduleId: 9, scheduleName: 'S', rrule: 'R' }),
    friendlyAwxError: (e) => ({ status: 502, message: e.message }),
    buildSmartMetadata: () => ({ app: 'x' }),
    ...extra,
  };
}

test('OW5 pencere ACIKKEN acilan Smart biletine kesinti penceresi GOMULUR', async () => {
  // Bu olmadan bilet sinirsiz bekler: pencere 16:00'da kapanir, onay 03:00'te gelir ve
  // is CALISIR. Poller sinirini `pendingLaunch.ocoWindowEndIso`dan okur.
  await kapiIle({ phase: 'inside' }, async (gates, cagrilar, w) => {
    const d = await gates.runChangeGates(ctx());
    assert.equal(d.outcome, 'respond', 'pencere acikken Smart bileti acilmali');
    assert.equal(cagrilar.length, 1, 'bilet kaydi olusmadi');
    const pl = cagrilar[0].pendingLaunch;
    assert.equal(
      pl.ocoWindowEndIso, w.windowEnd.toISOString(),
      'pencere SONU pakete girmedi - bilet sinirsiz bekler',
    );
    assert.equal(pl.ocoWindowStartIso, w.windowStart.toISOString(), 'pencere BASI pakete girmedi');
    assert.equal(pl.ocoNumber, 'OCO-123', 'OCO numarasi pakete girmedi');
  });
});

test('OW6 pencere ACIKKEN kapi yine PROCEED eder (kullaniciya soru SORULMAZ)', async () => {
  // Hata 2'nin duzeltmesi `inside` dalinin donusunu degistirdi. Davranisin GERI KALANI
  // aynen kalmali: pencere acikken OCO karari sorulmaz, akis Smart'a devreder.
  await kapiIle({ phase: 'inside' }, async (gates) => {
    const d = await gates.runChangeGates(ctx({ ocoAction: '' }));
    assert.ok(d.body && !d.body.ocoDecisionRequired, 'pencere acikken karar soruldu');
    assert.ok(!d.body.ocoScheduled, 'pencere acikken is zamanlandi - hemen kosmaliydi');
    assert.equal(d.body.pendingApproval, true, 'onay bekleniyor bildirilmedi');
  });
});

test('OW7 pencere ACILMADIYSA eski davranis korunur (bilet simdi acilir, is zamanlanir)', async () => {
  // Regresyon kilidi: `before` dali 2026-09-22 kullanici kararini uyguluyor ve pencereyi
  // ZATEN tasiyordu. Hata 2'nin duzeltmesi oraya dokunmamali.
  await kapiIle({ phase: 'before' }, async (gates, cagrilar, w) => {
    const d = await gates.runChangeGates(ctx({ ocoAction: 'schedule' }));
    assert.equal(d.body.ocoScheduled, true, 'is pencereye zamanlanmadi');
    assert.equal(d.body.smartFirst, true, 'bilet talep aninda acilmadi');
    assert.equal(cagrilar.length, 1);
    assert.equal(cagrilar[0].pendingLaunch.ocoWindowEndIso, w.windowEnd.toISOString());
  });
  // Kaynak duzeyinde: `before` dalinda pencere atamalari HALA duruyor mu.
  assert.match(GATES_SRC, /pendingLaunch\.ocoWindowStartIso\s*=/, 'before dali pencere basini yazmiyor');
  assert.match(GATES_SRC, /pendingLaunch\.ocoWindowEndIso\s*=/, 'before dali pencere sonunu yazmiyor');
});
