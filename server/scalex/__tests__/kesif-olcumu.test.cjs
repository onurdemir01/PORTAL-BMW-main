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
      items: [
        { cluster: 'c1', step: 'WORKLOAD_KIND', status: 'OK', detail: 'kind=deploy found=1' },
      ],
    },
  });
  assert.deepEqual(r.timing, []);
});

// ══ T4: KESIF YOKLAMASI STDOUT INDIRMEZ — BITMIS ISTE DE ═══════════════════
//
// ILK ADIM (PR-0): `/discover/:s/:j/status` her yoklamada TUM stdout'u
// indiriyordu; is bitene kadar indirmez oldu. IKINCI ADIM (2026-10): bitmis
// iste de indirmez. Uc cagiran (`WorkloadStep.poll`, `ScaleXPage` saglik
// dongusu, `StoppedPanel`) yalnizca `finished` ve `result` okuyor; tam cekim
// SONUCU kullaniciya gecikmeyle veriyordu (stdout indirmesi uretimde ~20 sn).
test('T4 kesif durum ucu AWX stdout`unu HIC indirmiyor (sonuc artifact`tan)', () => {
  const g = rota('/discover/:serverId/:jobId/status');
  assert.match(g, /getJobStatusOnServer/, 'durum hic cekilmiyor');
  assert.match(g, /extractDiscoveryResult\(status\.artifacts\)/, 'sonuc artifact`tan okunmuyor');
  assert.doesNotMatch(g, /getJobOutputOnServer/, 'kesif durum ucu stdout indiriyor');
  // Istemci tipi de alani tasimaz: bir ekran onu okumaya kalkarsa tsc duser.
  const api = oku('src/api/scalexApi.ts');
  const tip = api.slice(
    api.indexOf('async discoverStatus('),
    api.indexOf('async discoverStatus(') + 600,
  );
  assert.doesNotMatch(
    tip.slice(0, tip.indexOf('}>;')),
    /\boutput:/,
    'discoverStatus tipi `output` tasiyor',
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
    setup.indexOf(
      'created_at     DATETIME2',
      setup.indexOf('CREATE TABLE scalex_discovery_timing ('),
    ),
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

// ══ T9: IS DUZEYI SURE KIRILIMI (PR-O) ═════════════════════════════════════
//
// "40 sn nerede" sorusu AWX 3365168/81/88'de loglardan ELLE cevaplandi: asil
// kayip runner degil SSH tasimasiydi. Kirilim artik her iste kendiliginden
// yazilir; bekciler NULL/sifir ayrimini ve hesabin yonunu kilitler.
test('T9a jobBreakdown: kuyruk/acilis/toplam AWX zamanlarindan, paylar playbook`tan', () => {
  const { jobBreakdown } = require('../discovery-timing.cjs');
  const started = Date.parse('2026-10-01T10:00:05.000Z');
  const k = jobBreakdown(
    {
      created: '2026-10-01T10:00:00.000Z',
      started: '2026-10-01T10:00:05.000Z',
      finished: '2026-10-01T10:00:25.500Z',
    },
    { startEpochMs: started + 9000, prepMs: 2500, transportMs: 4000, publishMs: 800 },
  );
  assert.deepStrictEqual(k, {
    queueMs: 5000,
    bootMs: 9000,
    prepMs: 2500,
    transportMs: 4000,
    publishMs: 800,
    jobMs: 20500,
  });
});

test('T9b jobBreakdown: eksik damga ve saat kaymasi NULL, sifir DEGIL', () => {
  const { jobBreakdown } = require('../discovery-timing.cjs');
  const k = jobBreakdown(
    { created: null, started: '2026-10-01T10:00:05Z', finished: null },
    { startEpochMs: Date.parse('2026-10-01T10:00:04Z'), prepMs: null, transportMs: -1 },
  );
  assert.equal(k.queueMs, null, 'created yokken kuyruk uydurulmus');
  assert.equal(k.bootMs, null, 'negatif acilis (saat kaymasi) yazilmis');
  assert.equal(k.transportMs, null, '-1 sifira/negatife cevrilmis');
  assert.equal(k.jobMs, null);
  assert.deepStrictEqual(jobBreakdown(null, null), {
    queueMs: null,
    bootMs: null,
    prepMs: null,
    transportMs: null,
    publishMs: null,
    jobMs: null,
  });
});

test('T9c record kirilimi HER cluster satirina yazar (sutun sirasi sabit)', async () => {
  const kayit = [];
  const { mod, geriAl } = sahteDb(kayit);
  try {
    await mod.record({
      env: 'lab',
      tenant: 'gar',
      awxJobId: 42,
      job: {
        created: '2026-10-01T10:00:00Z',
        started: '2026-10-01T10:00:02Z',
        finished: '2026-10-01T10:00:12Z',
      },
      playbookTiming: {
        startEpochMs: Date.parse('2026-10-01T10:00:05Z'),
        prepMs: 1000,
        transportMs: 3000,
        publishMs: 500,
      },
      timing: [
        { cluster: 'c1', mode: 'workloads', elapsedMs: 10 },
        { cluster: 'c2', mode: 'workloads', elapsedMs: 20 },
      ],
    });
  } finally {
    geriAl();
  }
  const ins = kayit.filter((k) => /INSERT INTO scalex_discovery_timing/.test(k.sql));
  assert.equal(ins.length, 2);
  assert.match(ins[0].sql, /queue_ms, boot_ms, prep_ms, transport_ms, publish_ms, job_ms\)/);
  for (const i of ins)
    assert.deepStrictEqual(i.params.slice(11), [2000, 3000, 1000, 3000, 500, 10000]);
});

test('T9d sonuc ayristirma: playbook_timing -1 -> NULL, alan yoksa null', () => {
  const r = RESULT.extractDiscoveryResult({
    scalex_discovery_result: {
      mode: 'workloads',
      items: [],
      playbook_timing: {
        start_epoch_ms: '1790000000000',
        prep_ms: -1,
        transport_ms: '1500',
        publish_ms: 40,
      },
    },
  });
  assert.deepStrictEqual(r.playbookTiming, {
    startEpochMs: 1790000000000,
    prepMs: null,
    transportMs: 1500,
    publishMs: 40,
  });
  const eski = RESULT.extractDiscoveryResult({
    scalex_discovery_result: { mode: 'workloads', items: [] },
  });
  assert.equal(eski.playbookTiming, null);
});

test('T9e durum ucu kirilimi record`a GERCEKTEN geciriyor + AWX `created` okunuyor', () => {
  const g = rota('/discover/:serverId/:jobId/status');
  const i = g.indexOf('discoveryTiming.record(');
  const cagri = g.slice(i, g.indexOf('});', i));
  assert.match(cagri, /created:\s*status\.created/);
  assert.match(cagri, /started:\s*status\.started/);
  assert.match(cagri, /finished:\s*status\.finished/);
  assert.match(cagri, /playbookTiming:\s*parsed\.playbookTiming/);
  const runner = kodOnly(oku('server/ansible/runner.cjs'));
  const f = runner.slice(runner.indexOf('async function getJobStatusOnServer'));
  assert.match(f.slice(0, f.indexOf('\n}\n')), /created:\s*data\.created/);
});

test('T9f kirilim sutunlari CREATE + ALTER ile tanimli ve NULL', () => {
  const setup = oku('server/db/mssql-setup.cjs');
  const bas = setup.indexOf('CREATE TABLE scalex_discovery_timing (');
  const t = setup.slice(bas, setup.indexOf(')`', bas));
  for (const c of ['queue_ms', 'boot_ms', 'prep_ms', 'transport_ms', 'publish_ms', 'job_ms']) {
    assert.match(t, new RegExp(`${c}\\s+INT NULL`), `${c} CREATE'te yok/NOT NULL`);
    assert.ok(
      setup.includes(`ALTER TABLE scalex_discovery_timing ADD ${c} INT NULL`),
      `${c} mevcut kurulumlara ALTER ile eklenmiyor`,
    );
  }
});
