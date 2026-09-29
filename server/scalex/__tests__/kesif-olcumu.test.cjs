// server/scalex/__tests__/kesif-olcumu.test.cjs
//
// PR-0 — KESIF OLCUM TABANI ve BEDAVA KAZANCLAR.
//
// NEDEN: "ScaleX kesfi cok yavas" sikayeti aylarca NEREDE yavas oldugu
// bilinmeden tartisildi ve bir kez yanlis kaldiraca yatirim yapildi. Bu turun
// urunu bir hizlandirma DEGIL, hizlandirmayi OLCEBILME yetenegi; asagidaki
// bekciler olcumun anlamli kaldigini ve yoklamanin ucuzladigini kilitler.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');

// Yorumlar CIKARILIR: bir bekcinin kendi gerekcesini okuyup yesile donmesi bu
// depodaki bekci korlugu desenlerinden BIRINCISI.
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const IX = kodOnly(oku('server/scalex/index.cjs'));

/** Bir rota govdesini, yolun kendisinden SONRAKI ilk `router.` tanimina kadar alir. */
function rota(yol) {
  const i = IX.indexOf(`'${yol}'`);
  assert.ok(i > 0, `rota bulunamadi: ${yol}`);
  const j = IX.indexOf('\n  router.', i);
  assert.ok(j > i, `rota sonu bulunamadi: ${yol}`);
  return IX.slice(i, j);
}

const RESULT = require('../result.cjs');

// ══ T3: OLCULEMEDI ile SIFIR AYRI ═══════════════════════════════════════════
//
// Betik olcemedigi degeri '-' ile bildirir. Onu 0'a cevirmek, bir adimi
// "bedava" gostermek ve yanlis kaldiraca yatirim yaptirmak olurdu.
test('T3 `-` olcumu NULL olur, SIFIR olmaz', () => {
  const r = RESULT.extractDiscoveryResult({
    scalex_discovery_result: {
      mode: 'workloads',
      items: [
        {
          cluster: 'c1',
          step: 'TIMING',
          status: 'INFO',
          detail:
            'phase=discover mode=workloads namespace=ns1 kinds=6 cached=no ' +
            'setup_ms=- discover_ms=1200 elapsed_ms=1500',
        },
      ],
    },
  });
  assert.equal(r.timing.length, 1);
  assert.equal(r.timing[0].setupMs, null, "'-' sifira cevrilmis");
  assert.equal(r.timing[0].discoverMs, 1200);
  assert.equal(r.timing[0].elapsedMs, 1500);
  assert.equal(r.timing[0].kinds, 6);
  assert.equal(r.timing[0].cached, false);
});

// UC DURUM: tuttu / tutmadi / o modda HIC SORULMADI. `cached`i iki durumlu
// yapmak, "sorulmadi"yi "tutmadi" gibi gosterir ve onbellek isabet oranini
// oldugundan kotu okutur.
test('T3b `cached` UC durumlu (yes/no/olculmedi)', () => {
  const uret = (d) =>
    RESULT.extractDiscoveryResult({
      scalex_discovery_result: {
        mode: 'state',
        items: [{ cluster: 'c1', step: 'TIMING', status: 'INFO', detail: d }],
      },
    }).timing[0];
  assert.equal(uret('cached=yes elapsed_ms=1').cached, true);
  assert.equal(uret('cached=no elapsed_ms=1').cached, false);
  assert.equal(uret('cached=- elapsed_ms=1').cached, null, "'-' false sayilmis");
  assert.equal(uret('elapsed_ms=1').cached, null, 'eksik alan false sayilmis');
});

// TIMING satiri basmayan ESKI paket: dizi BOS kalir, ekran "olculmedi" der.
test('T3c TIMING satiri yoksa dizi BOS (uydurulmus satir yok)', () => {
  const r = RESULT.extractDiscoveryResult({
    scalex_discovery_result: {
      mode: 'workloads',
      items: [{ cluster: 'c1', step: 'WORKLOAD_KIND', status: 'OK', detail: 'kind=deploy found=1' }],
    },
  });
  assert.deepEqual(r.timing, []);
});

// ══ T4: IS BITMEDEN STDOUT INDIRILMEZ ═══════════════════════════════════════
//
// OLCULEN ISRAF: `/discover/:s/:j/status` her 3 saniyede bir yoklaniyordu ve her
// yoklamada isin TUM stdout'u indiriliyordu — oysa kesif yolunda ciktiyi OKUYAN
// KIMSE YOK (`WorkloadStep.poll`, `ScaleXPage` saglik dongusu ve `StoppedPanel`
// `finished` gelene kadar yanitin geri kalanini atiyor).
test('T4 kesif yoklamasi is BITMEDEN stdout indirmiyor', () => {
  const g = rota('/discover/:serverId/:jobId/status');
  assert.ok(
    !/Promise\.all\(\[[\s\S]{0,200}getJobOutputOnServer/.test(g),
    'durum ve cikti hala AYNI ANDA cekiliyor — yoklama basina tam stdout indirilir',
  );
  assert.match(g, /getJobStatusOnServer/, 'durum hic cekilmiyor');
  // KARAR NOKTASI: cikti cagrisi `status.finished` kosuluna BAGLI olmali.
  // Yalnizca "Promise.all yok" demek, cagriyi kosulsuz bir satira tasiyarak da
  // gecerdi.
  const c = /status\.finished\s*\?[\s\S]{0,300}?getJobOutputOnServer/.test(g);
  assert.ok(c, 'stdout cekimi `status.finished` kosuluna bagli degil');
  // Durum ciktidan ONCE gelmeli; sonra gelseydi kosul degerlendirilemezdi.
  assert.ok(
    g.indexOf('getJobStatusOnServer') < g.indexOf('getJobOutputOnServer'),
    'cikti cekimi durum cekiminden ONCE — kosul anlamsiz',
  );
});

// ══ T5: ISLEM YOLUNDA CANLI TERMINAL KORUNUR ════════════════════════════════
//
// `/run/:s/:j/status` ciktisi `AnsibleLogTerminal`de CANLI gosteriliyor; kesif
// yolundaki "bitmeden indirme" cozumu burada terminali BOSALTIRDI. Onun yerine
// `runner.cjs`in `ss/job-status` ucunda kanitlanmis desen: kosarken ARTIMLI,
// bitince TAM cekim (arsiv ve kullanicinin gordugu son metin artimlardan
// TUREMEZ).
test('T5 islem yoklamasi kosarken ARTIMLI, bitince TAM cekiyor', () => {
  const g = rota('/run/:serverId/:jobId/status');
  assert.match(
    g,
    /getJobOutputOnServer\([\s\S]{0,120}artimli:\s*!status\.finished/,
    'islem yoklamasi hala her turda TAM stdout indiriyor',
  );
  // Terminal bos kalmamali: cikti KOSULSUZ cekiliyor olmali (yalnizca BICIMI
  // degisiyor). `status.finished ?` deseni buraya sizarsa canli log olurdu.
  assert.ok(
    !/status\.finished\s*\?[\s\S]{0,200}getJobOutputOnServer/.test(g),
    'islem yolunda cikti kosullu cekiliyor — canli terminal bosalir',
  );
});

// ══ T6: OLCUM KAYDEDILIYOR ve HER MODDA ═════════════════════════════════════
test('T6 kesif suresi HER modda kaydediliyor', () => {
  const g = rota('/discover/:serverId/:jobId/status');
  assert.match(g, /discoveryTiming\.record\(/, 'olcum hic kaydedilmiyor');
  const i = g.indexOf('discoveryTiming.record(');
  // Kosul `status.finished` olmali; `parsed.mode === '...'` ile daraltmak
  // tabanin yarisini gormemek olurdu (AWX + login sabit maliyeti HER modda var).
  const onceki = g.slice(Math.max(0, i - 400), i);
  assert.match(onceki, /status\.finished/, 'olcum bitmemis isten de yaziliyor');
  assert.ok(
    !/parsed\.mode === '/.test(onceki),
    'olcum tek bir modla sinirlandirilmis — AWX/login sabit maliyeti gorunmez olur',
  );
});

// ══ T7: OLCUM YAZIMI ═══════════════════════════════════════════════════════
//
// Sahte bir `db` ile GERCEK modul kosturulur: metin denetimi "null yaziliyor
// mu" sorusunu cevaplayamaz.
function sahteDb(kayit) {
  const yol = require.resolve('../../db/index.cjs');
  const onceki = require.cache[yol];
  require.cache[yol] = {
    id: yol,
    filename: yol,
    loaded: true,
    exports: {
      async query(sql, params) {
        kayit.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    },
  };
  const timingYol = require.resolve('../discovery-timing.cjs');
  delete require.cache[timingYol];
  const mod = require('../discovery-timing.cjs');
  return {
    mod,
    geriAl() {
      if (onceki) require.cache[yol] = onceki;
      else delete require.cache[yol];
      delete require.cache[timingYol];
    },
  };
}

test('T7 olculemeyen alan NULL yazilir, SIFIR yazilmaz', async () => {
  const kayit = [];
  const { mod, geriAl } = sahteDb(kayit);
  try {
    await mod.record({
      env: 'lab',
      tenant: 'gar',
      namespace: 'ns1',
      awxJobId: 42,
      timing: [
        {
          cluster: 'c1',
          mode: 'workloads',
          namespace: 'ns1',
          kinds: 6,
          cached: true,
          setupMs: null,
          discoverMs: 900,
          elapsedMs: 1100,
        },
      ],
    });
  } finally {
    geriAl();
  }
  const ins = kayit.find((k) => /INSERT INTO scalex_discovery_timing/.test(k.sql));
  assert.ok(ins, 'olcum INSERT edilmedi');
  // Sutun sirasi: env, tenant, cluster, namespace, mode, kinds, cached,
  // setup_ms, discover_ms, elapsed_ms, awx_job_id
  assert.equal(ins.params[5], 6, 'kinds');
  assert.equal(ins.params[6], 1, 'cached=true 1 olmali');
  assert.equal(ins.params[7], null, 'olculemeyen setup_ms SIFIRA cevrilmis');
  assert.equal(ins.params[8], 900, 'discover_ms');
  assert.equal(ins.params[9], 1100, 'elapsed_ms');
  assert.equal(ins.params[10], 42, 'awx_job_id');
});

test('T7b `cached` UC durumu DB`ye de UC durum olarak gider', async () => {
  const kayit = [];
  const { mod, geriAl } = sahteDb(kayit);
  try {
    await mod.record({
      env: 'lab',
      tenant: 'gar',
      timing: [
        { cluster: 'c1', mode: 'capabilities', cached: null, elapsedMs: 10 },
        { cluster: 'c2', mode: 'workloads', cached: false, elapsedMs: 10 },
      ],
    });
  } finally {
    geriAl();
  }
  const ins = kayit.filter((k) => /INSERT INTO scalex_discovery_timing/.test(k.sql));
  assert.equal(ins.length, 2);
  assert.equal(ins[0].params[6], null, 'sorulmamis onbellek `false` yazilmis');
  assert.equal(ins[1].params[6], 0, 'tutmayan onbellek 0 yazilmali');
});

// SINIRSIZ BIRIKIM bu depoda bir sisme/OOM sinifiydi; olcum tablosu istisna degil.
test('T7c yazimdan SONRA eski olcumler budaniyor', async () => {
  const kayit = [];
  const { mod, geriAl } = sahteDb(kayit);
  try {
    await mod.record({
      env: 'lab',
      tenant: 'gar',
      timing: [{ cluster: 'c1', mode: 'workloads', elapsedMs: 10 }],
    });
  } finally {
    geriAl();
  }
  const sil = kayit.findIndex((k) => /DELETE FROM scalex_discovery_timing/.test(k.sql));
  const ins = kayit.findIndex((k) => /INSERT INTO scalex_discovery_timing/.test(k.sql));
  assert.ok(sil >= 0, 'budama hic yapilmiyor — tablo sinirsiz buyur');
  assert.ok(ins >= 0 && sil > ins, 'budama yazimdan ONCE — yeni satir da silinebilirdi');
});

// Yazacak bir sey yoksa DB'ye HIC gidilmemeli: her yoklamada bos bir DELETE
// kostururmak, olcumun kendisini bir maliyet haline getirirdi.
test('T7d bos olcum listesi DB`ye HIC gitmez', async () => {
  const kayit = [];
  const { mod, geriAl } = sahteDb(kayit);
  try {
    await mod.record({ env: 'lab', tenant: 'gar', timing: [] });
  } finally {
    geriAl();
  }
  assert.equal(kayit.length, 0, 'bos listede DB sorgusu calisti');
});

// ══ T8: TABLO ve UC ════════════════════════════════════════════════════════
test('T8 olcum tablosu CREATE + INDEX ile tanimli', () => {
  const setup = oku('server/db/mssql-setup.cjs');
  assert.match(setup, /CREATE TABLE scalex_discovery_timing \(/, 'tablo tanimi yok');
  assert.match(
    setup,
    /table: 'scalex_discovery_timing'/,
    'index yok — "son N kesif" sorgusu tablo taramasi olur',
  );
  // NULL KABUL EDEN sutunlar: "olculmedi" ile 0 ayri kalmali.
  const t = setup.slice(
    setup.indexOf('CREATE TABLE scalex_discovery_timing ('),
    setup.indexOf('created_at     DATETIME2', setup.indexOf('CREATE TABLE scalex_discovery_timing (')),
  );
  for (const sutun of ['kinds', 'cached', 'setup_ms', 'discover_ms', 'elapsed_ms']) {
    assert.ok(
      new RegExp(`${sutun}\\s+[A-Z0-9()]+\\s+NULL`).test(t),
      `${sutun} NOT NULL — "olculmedi" hali kaybolur`,
    );
  }
});

test('T8b olcum ucu YALNIZCA Admin`e acik', () => {
  const g = rota('/admin/discovery-timing');
  assert.match(
    g,
    /currentUser\(req\)\.role !== 'Admin'[\s\S]{0,200}?res\.status\(403\)/,
    'yetki kapisi yok — cluster adlari ve is numaralari herkese acilir',
  );
  // Kapi LISTEDEN ONCE olmali; sonra olsaydi hic ates almazdi.
  assert.ok(
    g.indexOf("!== 'Admin'") < g.indexOf('discoveryTiming.list'),
    'yetki kontrolu listeden SONRA — kapi hic ates almaz',
  );
});
