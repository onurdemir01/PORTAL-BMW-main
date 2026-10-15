// server/smart/__tests__/oco-yedek-yol-son-tarih.test.cjs — OCO zamanlayicisinin YEDEK yolu
// (launchOrRequestApproval) ile acilan Smart biletinin son tarihi (2026-10-15).
//
// HATA: change-gates 'before' dalinda Smart bileti talep aninda ACILAMAZSA kayit SCHEDULED kalir;
// pencere saatinde OCO poller'i `launchOrRequestApproval(server, tpl, rec.pendingLaunch, ...)`
// cagirir ve bilet ORADA acilir. `rec.pendingLaunch` kesinti penceresini (ocoWindowStartIso /
// ocoWindowEndIso / ocoNumber) TASIR ama launchOrRequestApproval bunlari bilete AKTARMIYORDU:
//   * bilet sinirsiz bekliyordu (ekranda "Süre sınırı yok"),
//   * onay pencere kapandiktan GUNLER sonra gelse bile runner.cjs'in onay anindaki `nextRunAt`
//     kapisi (yalniz ocoWindowStartIso && ocoWindowEndIso doluysa calisir) atlaniyor ve is
//     OCO penceresi DISINDA prod'da kosuyordu.
//
//   OY1 yedek yolla acilan biletin son tarihi pencere SONU (deadlineKaynak 'oco'); onay anindaki
//       kapi pencere kapandiktan sonra 'none' doner (is calismaz)
//   OY2 OCO'suz plan (pencere alani yok) davranisi aynen: bilet sinirsiz, pencere alani uydurulmaz
//
// NEDEN davranis (dizgi aramasi degil): alan adi kodda gecse de bilete ulasmazsa test kirmizi
// olmali. launchOrRequestApproval runner.cjs'ten GERCEK haliyle cikarilir, change-gates'in GERCEK
// openSmartTicket'i kosar; yalniz Smart istemcisi / deposu sahtedir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const { talepSonTarihi, talepSonTarihiAlanlari } = require('../deadline.cjs');
const { nextRunAt } = require('../../oco/window.cjs');

const RUNNER_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');

const DK = 60000;
const PENCERE_BAS = '2026-10-15T20:00:00.000Z';
const PENCERE_SON = '2026-10-15T22:00:00.000Z';

/**
 * runner.cjs'teki GERCEK launchOrRequestApproval govdesi + gercek change-gates.openSmartTicket.
 * Fail-closed: fonksiyon bulunamazsa test duser, bos dilimle sessizce gecmez.
 */
async function yedekYolla(plan, opts, fn) {
  const bas = RUNNER_SRC.indexOf('  async function launchOrRequestApproval(');
  assert.ok(bas > 0, 'launchOrRequestApproval runner.cjs icinde bulunamadi');
  const son = RUNNER_SRC.indexOf('\n  }\n', bas);
  assert.ok(son > bas, 'launchOrRequestApproval sonu bulunamadi');
  const kod = RUNNER_SRC.slice(bas, son + '\n  }'.length);

  const yollar = {
    smartClient: require.resolve('../client.cjs'),
    smartStore: require.resolve('../store.cjs'),
    audit: require.resolve('../../audit/index.cjs'),
  };
  const gatesPath = require.resolve('../../ansible/change-gates.cjs');
  const kayitli = {};
  for (const [k, p] of Object.entries(yollar)) kayitli[k] = require.cache[p];
  const acilan = [];
  const mocklar = {
    smartClient: { createTicket: async () => ({ ticketId: 'WF-9' }) },
    smartStore: {
      createTicket: async (a) => {
        acilan.push(a);
        return { id: 91 };
      },
    },
    audit: { auditPortal: () => {} },
  };
  for (const [k, p] of Object.entries(yollar)) {
    const m = new Module(p, null);
    m.exports = mocklar[k];
    m.loaded = true;
    require.cache[p] = m;
  }
  delete require.cache[gatesPath];
  const gates = require(gatesPath);
  const baslatilan = [];
  try {
    const launchOrRequestApproval = new Function(
      'require',
      'performSsLaunch',
      'buildSmartMetadata',
      `${kod}\nreturn launchOrRequestApproval;`,
    )(
      (m) => {
        if (m === './change-gates.cjs') return gates;
        throw new Error(`beklenmeyen require: ${m}`);
      },
      async (...a) => {
        baslatilan.push(a);
        return { jobId: 1 };
      },
      () => ({}),
    );
    const sonuc = await launchOrRequestApproval({ id: 1 }, 55, plan, opts);
    return await fn({ sonuc, acilan, baslatilan });
  } finally {
    for (const [k, p] of Object.entries(yollar)) {
      if (kayitli[k]) require.cache[p] = kayitli[k];
      else delete require.cache[p];
    }
    delete require.cache[gatesPath];
  }
}

// change-gates 'before' dalinin OCO kaydina yazdigi paket (pendingLaunch) - ayni alanlar.
function ocoPlani(over = {}) {
  return {
    detail: { id: 55 },
    extraVars: { env: 'prod' },
    resolvedLaunchOptions: {},
    specFields: [],
    overrides: { smartApproval: { enabled: true, flowKey: 'FLOW-1' } },
    username: 'onurd',
    templateName: 'Nginx Ops',
    ocoWindowStartIso: PENCERE_BAS,
    ocoWindowEndIso: PENCERE_SON,
    ocoNumber: 'OCO-123',
    ...over,
  };
}

test('OY1 yedek yolla acilan bilet: son tarih pencere SONU, onay kapisi pencereden sonra calistirmaz', async () => {
  await yedekYolla(ocoPlani(), { ocoRecordId: 7 }, async ({ sonuc, acilan, baslatilan }) => {
    assert.equal(sonuc.pendingApproval, true, 'Smart bileti acilmadi');
    assert.equal(baslatilan.length, 0, 'onay beklenmeden is baslatildi');
    assert.equal(acilan.length, 1);
    const pl = acilan[0].pendingLaunch;
    assert.equal(pl.ocoRecordId, 7, 'OCO kaydi bilete baglanmadi');

    // Bilet, deposuna yazildigi haliyle: poller ve uclar bu nesneden okur.
    const bilet = { status: 'PENDING', createdAt: '2026-10-15T20:05:00.000Z', pendingLaunch: pl };
    const r = talepSonTarihi(bilet, { ticketTimeoutMinutes: null });
    assert.equal(r.deadlineKaynak, 'oco', 'bilet sinirsiz bekliyor - pencere kapaninca TIMEOUT olmaz');
    assert.equal(r.deadline.toISOString(), PENCERE_SON);
    assert.deepEqual(talepSonTarihiAlanlari(bilet, { ticketTimeoutMinutes: null }), {
      deadline: PENCERE_SON,
      deadlineKaynak: 'oco',
    });

    // Onay anindaki ikinci kapi (runner.cjs smart poller geri cagrisi) yalniz iki alan da
    // doluysa calisir. Pencere kapandiktan bir gun sonra gelen onay: is CALISMAMALI.
    assert.ok(pl.ocoWindowStartIso && pl.ocoWindowEndIso, 'onay anindaki nextRunAt kapisi atlanir');
    const gec = nextRunAt({
      windowStart: new Date(pl.ocoWindowStartIso),
      windowEnd: new Date(pl.ocoWindowEndIso),
      now: new Date(Date.parse(PENCERE_SON) + 24 * 60 * DK),
    });
    assert.equal(gec.mode, 'none');
    assert.equal(pl.ocoNumber, 'OCO-123', 'zamanlama adi icin OCO numarasi tasinmali');
  });
});

test('OY2 OCO\'suz plan: bilet sinirsiz kalir, pencere alani uydurulmaz', async () => {
  const plan = ocoPlani();
  delete plan.ocoWindowStartIso;
  delete plan.ocoWindowEndIso;
  delete plan.ocoNumber;
  await yedekYolla(plan, {}, async ({ acilan }) => {
    const pl = acilan[0].pendingLaunch;
    assert.equal('ocoWindowStartIso' in pl, false);
    assert.equal('ocoWindowEndIso' in pl, false);
    assert.equal('ocoNumber' in pl, false);
    assert.equal('ocoRecordId' in pl, false);
    const r = talepSonTarihi({ status: 'PENDING', createdAt: '2026-10-15T20:05:00.000Z', pendingLaunch: pl }, {});
    assert.equal(r.deadline, null);
  });
});

// OY3 (2026-10-15 yeniden denetim): ScaleX "/oco-schedules/:id/update" yalniz kaydin kolonlarini
// (oco_number / run_at / window_end) gunceller, pending_launch_json ESKI pencereyi tasir. OCO
// poller'inin geri cagrisi paketi KAYITTAN yeniden kurmazsa bilet eski pencereyle acilir.
test('OY3 guncellenmis kayit: bilet KAYDIN guncel penceresini ve numarasini tasir', async () => {
  const { ocoKaydiPlani } = require('../../oco/kayit-plani.cjs');
  const YENI_BAS = '2026-10-16T20:00:00.000Z';
  const YENI_SON = '2026-10-16T22:00:00.000Z';
  const paket = ocoPlani({ extraVars: { env: 'prod', oco_number: 'OCO-123' } });
  const rec = {
    id: 7,
    ocoNumber: 'OCO-456',
    runAt: new Date(YENI_BAS),
    windowEnd: new Date(YENI_SON),
    pendingLaunch: paket,
  };
  const plan = ocoKaydiPlani(rec);
  assert.equal(paket.ocoWindowEndIso, PENCERE_SON, 'kaydin paketi yerinde degistirildi');
  assert.equal(paket.extraVars.oco_number, 'OCO-123', 'kaydin extraVars nesnesi yerinde degistirildi');
  await yedekYolla(plan, { ocoRecordId: 7 }, async ({ acilan }) => {
    const pl = acilan[0].pendingLaunch;
    assert.equal(pl.ocoWindowStartIso, YENI_BAS);
    assert.equal(pl.ocoWindowEndIso, YENI_SON, 'bilet ESKI pencereyi tasiyor');
    assert.equal(pl.ocoNumber, 'OCO-456');
    const r = talepSonTarihi({ status: 'PENDING', createdAt: '2026-10-16T20:01:00.000Z', pendingLaunch: pl }, {});
    assert.equal(r.deadline.toISOString(), YENI_SON);
    const icinde = nextRunAt({
      windowStart: new Date(pl.ocoWindowStartIso),
      windowEnd: new Date(pl.ocoWindowEndIso),
      now: new Date('2026-10-16T20:10:00.000Z'),
    });
    assert.equal(icinde.mode, 'now', 'yeni pencere icindeki onay isi hemen calistirmali');
  });
  assert.equal(plan.extraVars.oco_number, 'OCO-456', 'is degiskenindeki OCO numarasi eski kaldi');

  // Pencere kolonu okunamazsa paketteki pencere korunur (uydurulmaz).
  const bozuk = ocoKaydiPlani({ ...rec, windowEnd: 'bozuk' });
  assert.equal(bozuk.ocoWindowEndIso, PENCERE_SON);
  assert.equal(bozuk.ocoWindowStartIso, PENCERE_BAS);

  // Geri cagri yardimciyi kullanir (paket olduğu gibi oynatilmaz).
  const bas = RUNNER_SRC.indexOf("require('../oco/poller.cjs').startPoller(");
  assert.ok(bas > 0, 'OCO poller geri cagrisi bulunamadi');
  const geriCagri = RUNNER_SRC.slice(bas, RUNNER_SRC.indexOf('});', bas));
  assert.match(geriCagri, /launchOrRequestApproval\(server, rec\.awxTemplateId, require\('\.\.\/oco\/kayit-plani\.cjs'\)\.ocoKaydiPlani\(rec\),/);
  assert.doesNotMatch(geriCagri, /rec\.pendingLaunch/);
});
