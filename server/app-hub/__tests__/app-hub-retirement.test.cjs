// server/app-hub/__tests__/app-hub-retirement.test.cjs - RH7..RH11 (2026-11-16).
//
// Kullanici: "Retirement job'ina girmis JBoss uygulamalari neden kritik durumda gorunuyor?"
// Kilitler:
//   RH7  jbossDetay her JVM'e retirement { kayit, hedef, durum, kapatildi, durduruldu, celiski } tasir:
//        esleme Server Hub degerlendirmesinden (j.retirement), durum + STOP ANI (tam zaman, ISO UTC;
//        gece STOP'u UTC gunune kirpilmaz) retirement_targets canli okumasindan, celiski Server Hub'in
//        kararindan (j.capraz.celiski; App Hub tarih karsilastirmaz). Iptal edilmis hedef tasinmaz.
//        Kullanilmayan ozet.retireJvm sozlesmeden kalkti.
//   RH8  degerlendirmede retirement okunamadi -> her JVM'de null, kaynaklar.retirement.hata + okunamadi
//   RH9  canli okuma dustu -> degerlendirmedeki durum, tarih null, hata notu (sessiz basari yok);
//        Server Hub'in kanitli celiskisi korunur (gercek alarm bastirilmaz)
//   RH10 retirementSec: once STOP / silme yapilmis hedef, sonra en yeni kayit
//   RH11 kapatildi yalniz stopped / deleted: failed / rolling_back / rollback_failed / deleting /
//        active / pending / stop_scheduled kapatilmis SAYILMAZ; kapatilmamis hedefin celiskisi tasinmaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const SQL = { NVarChar: () => 'nvarchar' };
sahte(require.resolve('../../inventory/mssql.cjs'), {
  sql: SQL,
  query: async (t) => {
    if (t.includes('FROM dbo.MWAppsInventory'))
      return {
        recordset: [
          { app: 'MUSTERI', host: 'gojbap01', env: 'Production', jboss_version: 'EAP 8.0' },
        ],
      };
    return { recordset: [] };
  },
});
const portalDb = { satirlar: [], hata: null, sorgular: [] };
sahte(require.resolve('../../db/index.cjs'), {
  query: async (t) => {
    portalDb.sorgular.push(t);
    if (portalDb.hata) throw new Error(portalDb.hata);
    return { rows: t.includes('retirement_targets') ? portalDb.satirlar : [] };
  },
});
sahte(require.resolve('../../config/apps-table.cjs'), {
  getAppsTable: () => 'MWAppsInventory',
  getWasAppsTable: () => 'WASAppsInventory',
});
const hub = { capraz: null, jvms: [] };
sahte(require.resolve('../../server-hub/index.cjs'), {
  getAssessment: async () => ({
    hosts: [{ host: 'GOJBAP01', fresh: true, scanDate: '2026-11-15', jvms: hub.jvms }],
    latestScan: '2026-11-15',
    capraz: hub.capraz,
  }),
  loadJvmAgir: async () => new Map(),
  hostDetail: (h) => ({ jvms: h.jvms.map((j) => ({ ...j })) }),
});
sahte(require.resolve('../../retirement/discover.cjs'), {
  parseAppName: (a) => ({ base: String(a), env: 'PROD' }),
  discover: async () => ({ targets: [], summary: null }),
});

const V = require('../veri.cjs');

const RET_OK = { retirement: { okunamadi: false, hata: '', hedef: 3 } };
const hedefSatiri = (o) => ({
  id: 71,
  record_id: 24,
  host: 'GOJBAP01',
  app_name: 'MUSTERI',
  jboss_gen: 8,
  app_path: '/vhosting8/MUSTERI.ear',
  status: 'stopped',
  stopped_at: new Date('2026-10-13T21:30:00Z'),
  kayit_durum: 'open',
  ...o,
});
const jvmBul = (d, ad) => d.sunucular[0].jvmler.find((j) => j.ad === ad);

test('RH7 JVM retirement alani tasinir: esleme degerlendirmeden, durum + STOP ani canli okumadan, celiski Server Hub kararindan', async () => {
  hub.capraz = RET_OK;
  hub.jvms = [
    {
      name: 'MUSTERI',
      gen: 8,
      running: false,
      runningKnown: true,
      retirement: [{ kayit: 24, hedef: 71, durum: 'stop_scheduled' }],
    },
    {
      name: 'MUSTERI2',
      invApp: 'MUSTERI',
      gen: 8,
      running: true,
      runningKnown: true,
      retirement: [{ kayit: 25, hedef: 72, durum: 'stopped' }],
      capraz: {
        celiski: [
          { kayit: 25, hedef: 72, durum: 'stopped', nedenler: ['autostart', 'calisiyor'] },
          { kayit: 99, hedef: 999, durum: 'stopped', nedenler: ['paket'] },
        ],
      },
    },
    {
      name: 'MUSTERI3',
      invApp: 'MUSTERI',
      gen: 8,
      running: false,
      runningKnown: true,
      retirement: [{ kayit: 30, hedef: 90, durum: 'stopped' }],
    },
    { name: 'MUSTERI4', invApp: 'MUSTERI', gen: 8, running: false, runningKnown: true },
    {
      name: 'MUSTERI5',
      invApp: 'MUSTERI',
      gen: 8,
      running: true,
      runningKnown: true,
      retirement: [{ kayit: 26, hedef: 73, durum: 'stopped' }],
    },
  ];
  portalDb.hata = null;
  portalDb.satirlar = [
    hedefSatiri({}),
    hedefSatiri({
      id: 72,
      record_id: 25,
      app_name: 'MUSTERI2',
      stopped_at: new Date('2026-11-01T08:00:00Z'),
    }),
    hedefSatiri({
      id: 73,
      record_id: 26,
      app_name: 'MUSTERI5',
      stopped_at: new Date('2026-10-13T22:30:00Z'),
    }),
  ];
  const d = await V.jbossDetay('MUSTERI');
  assert.ok(
    portalDb.sorgular.some((t) => t.includes('FROM retirement_targets')),
    'mevcut retirementHedefleri sorgusu kullanilmadi',
  );
  assert.deepEqual(
    jvmBul(d, 'MUSTERI').retirement,
    {
      kayit: 24,
      hedef: 71,
      durum: 'stopped',
      kapatildi: true,
      durduruldu: '2026-10-13T21:30:00.000Z',
      celiski: [],
    },
    'canli durum (stopped) ve STOP ani tasinmadi; degerlendirmedeki eski durum kaldi',
  );
  assert.deepEqual(
    jvmBul(d, 'MUSTERI2').retirement,
    {
      kayit: 25,
      hedef: 72,
      durum: 'stopped',
      kapatildi: true,
      durduruldu: '2026-11-01T08:00:00.000Z',
      celiski: ['calisiyor', 'autostart'],
    },
    'Server Hub celiski karari tasinmadi ya da baska hedefin (999) nedeni karisti',
  );
  // Gece STOP'u (yerel 14.10 01:30): tam an tasinir, UTC gunune ('2026-10-13') kirpilmaz. Server Hub
  // celiski kanitlamadiysa (STOP gunu / oncesi tarama) celiski bos: ekran sari "dogrulama bekliyor".
  assert.equal(jvmBul(d, 'MUSTERI5').retirement.durduruldu, '2026-10-13T22:30:00.000Z');
  assert.deepEqual(jvmBul(d, 'MUSTERI5').retirement.celiski, []);
  assert.equal(
    jvmBul(d, 'MUSTERI3').retirement,
    null,
    'canli okumada olmayan (iptal edilmis) hedef tasindi',
  );
  assert.equal(jvmBul(d, 'MUSTERI4').retirement, null);
  assert.equal('retireJvm' in d.ozet, false, 'kullanilmayan ozet.retireJvm sozlesmede kaldi');
  assert.deepEqual(d.kaynaklar.retirement, { hata: null, okunamadi: false });
});

test('RH8 degerlendirmede retirement okunamadi: JVM alani null, kaynak hatasi ve okunamadi dolu', async () => {
  hub.capraz = { retirement: { okunamadi: true, hata: 'retirement_targets yok', hedef: 0 } };
  hub.jvms = [{ name: 'MUSTERI', gen: 8, running: false, runningKnown: true }];
  portalDb.hata = null;
  portalDb.satirlar = [hedefSatiri({})];
  const d = await V.jbossDetay('MUSTERI');
  assert.equal(jvmBul(d, 'MUSTERI').retirement, null);
  assert.equal(d.kaynaklar.retirement.okunamadi, true);
  assert.match(d.kaynaklar.retirement.hata, /retirement_targets yok/);

  hub.capraz = null;
  const d2 = await V.jbossDetay('MUSTERI');
  assert.equal(
    d2.kaynaklar.retirement.okunamadi,
    true,
    'degerlendirme retirement tasimiyorsa "okundu" sayildi',
  );
  assert.match(d2.kaynaklar.retirement.hata, /retirement durumunu taşımıyor/);
});

test('RH9 canli okuma dustu: degerlendirmedeki durum gosterilir, tarih null, hata notu dolu; Server Hub celiskisi korunur', async () => {
  hub.capraz = RET_OK;
  hub.jvms = [
    {
      name: 'MUSTERI',
      gen: 8,
      running: true,
      runningKnown: true,
      retirement: [{ kayit: 24, hedef: 71, durum: 'stopped' }],
      capraz: { celiski: [{ kayit: 24, hedef: 71, durum: 'stopped', nedenler: ['calisiyor'] }] },
    },
  ];
  portalDb.hata = 'Portal DB baglantisi yok';
  const d = await V.jbossDetay('MUSTERI');
  assert.deepEqual(
    jvmBul(d, 'MUSTERI').retirement,
    {
      kayit: 24,
      hedef: 71,
      durum: 'stopped',
      kapatildi: true,
      durduruldu: null,
      celiski: ['calisiyor'],
    },
    'canli okuma dusunce Server Hub kanitli celiski kayboldu (gercek alarm bastirildi)',
  );
  assert.equal(d.kaynaklar.retirement.okunamadi, false);
  assert.match(d.kaynaklar.retirement.hata, /STOP tarihi okunamadı \(Portal DB baglantisi yok\)/);
  portalDb.hata = null;
});

test('RH10 retirementSec: once STOP / silme yapilmis hedef, sonra en yeni kayit', () => {
  const { retirementSec } = V._ic;
  assert.equal(retirementSec([], null), null);
  assert.equal(retirementSec(undefined, null), null);
  const bagli = [
    { kayit: 40, hedef: 5, durum: 'pending' },
    { kayit: 24, hedef: 3, durum: 'stopped' },
    { kayit: 30, hedef: 4, durum: 'deleted' },
  ];
  assert.deepEqual(retirementSec(bagli, null), {
    kayit: 30,
    hedef: 4,
    durum: 'deleted',
    kapatildi: true,
    durduruldu: null,
    celiski: [],
  });
  const taze = new Map([
    [3, { hedef: 3, durum: 'stopped', durdurulduMs: Date.parse('2026-10-13T22:30:00Z') }],
    [5, { hedef: 5, durum: 'pending', durdurulduMs: null }],
  ]);
  assert.deepEqual(retirementSec(bagli, taze), {
    kayit: 24,
    hedef: 3,
    durum: 'stopped',
    kapatildi: true,
    durduruldu: '2026-10-13T22:30:00.000Z',
    celiski: [],
  });
  assert.equal(retirementSec([{ kayit: 40, hedef: 5, durum: 'pending' }], taze).durum, 'pending');
});

test('RH11 kapatildi yalniz stopped / deleted; kapatilmamis hedefin celiskisi tasinmaz', () => {
  const { retirementSec } = V._ic;
  for (const durum of [
    'failed',
    'rolling_back',
    'rollback_failed',
    'deleting',
    'active',
    'pending',
    'stop_scheduled',
  ]) {
    const r = retirementSec([{ kayit: 1, hedef: 1, durum }], null, [
      { hedef: 1, nedenler: ['calisiyor'] },
    ]);
    assert.equal(r.kapatildi, false, `${durum} kapatilmis sayildi (gercek alarm bastirilir)`);
    assert.deepEqual(r.celiski, [], `${durum}: kapatilmamis hedefin celiskisi tasindi`);
  }
  for (const durum of ['stopped', 'deleted', 'STOPPED'])
    assert.equal(retirementSec([{ kayit: 1, hedef: 1, durum }], null).kapatildi, true, durum);
  // Iki kapatilmis hedef: nedenler birlesir, sabit sira (calisiyor, autostart, paket); bagli olmayan
  // hedefin (3) nedeni karismaz.
  const r = retirementSec(
    [
      { kayit: 2, hedef: 2, durum: 'stopped' },
      { kayit: 1, hedef: 1, durum: 'deleted' },
    ],
    null,
    [
      { hedef: 1, nedenler: ['paket'] },
      { hedef: 2, nedenler: ['autostart'] },
      { hedef: 3, nedenler: ['calisiyor'] },
    ],
  );
  assert.deepEqual(r.celiski, ['autostart', 'paket']);
});
