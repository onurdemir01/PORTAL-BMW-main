// server/server-hub/__tests__/ear-envanter-awx.test.cjs - AWX'ten (Limit ile) elle baslatilan islerin alimi.
//
//   EAX1  sablon tanimsizsa AWX'e gidilmez; tarama en cok 2 dk'da bir
//   EAX2  is secimi: Portal'in kendi isi (detay okunmaz), set_stats yok, Portal kipi, baska sablon ALINMAZ;
//         Limit kipi isi tek partili AWX kosusu olur (hostlar BUYUK harf, tekil, gecerli; ortam envanterden);
//         alinmayacagi kesin is yeniden okunmaz, AWX okunamazsa sonraki turda yeniden denenir
//   EAX3  SQL: ayni is iki kez alinmaz (awx_job_id UPDLOCK + HOLDLOCK); calisan Portal kosusunu beklemez;
//         yazilan kolonlar DDL'de var
//   EAX4  alim: AWX kosusu ham dosyayi awx-<is>/raw'dan okur; set_stats AWX is numarasiyla eslesir
//   EAX5  limitDenetimi: sablon Limit'i doluysa 409; bos / olculemedi / sablon yok -> engellemez
//   EAX6  Portal kipi: sablon Limit'i doluyken parti BASLATILMAZ, kosu nedeniyle BASARISIZ kapanir
//   EAX7  poller turu AWX islerini alir (2 dk'da bir); AWX hatasi turu dusurmez
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const F = require('./fixtures/ear-envanter.cjs');

const REG_YOLU = path.join(__dirname, '..', '..', 'ansible', 'playbook-registry.cjs');
const INV_YOLU = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
const RUNNER_YOLU = path.join(__dirname, '..', '..', 'ansible', 'runner.cjs');
const DDL = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');

const sahteModul = (yol, exports) => {
  require.cache[yol] = { id: yol, filename: yol, loaded: true, exports };
};

let awx;
let poller;
let alim;
beforeEach(() => {
  for (const k of Object.keys(require.cache))
    if (/ear-envanter-(awx|poller|ayar|alim|saklama)\.cjs$/.test(k)) delete require.cache[k];
  awx = require('../ear-envanter-awx.cjs');
  poller = require('../ear-envanter-poller.cjs');
  alim = require('../ear-envanter-alim.cjs');
});
afterEach(() => {
  poller._durdurForTest();
  F.dbKaldir();
  for (const y of [REG_YOLU, INV_YOLU, RUNNER_YOLU]) delete require.cache[y];
});

const sablonVar = (templateId = 4242, awxServerId = 2) =>
  sahteModul(REG_YOLU, {
    getByKey: async () => ({ enabled: true, awxServerId }),
    getEffectiveTemplateId: () => templateId,
  });

const awxStats = (ek = {}) => ({
  kaynak: 'AWX',
  awx_job_id: '901',
  kosu_no: '0',
  parti_no: '0',
  kip: 'TAM',
  limit: 'appsrv01,hostc.ornek.local',
  hostlar: [
    { host: 'APPSRV01', durum: 'SONUC', paket: 'True' },
    { host: 'appsrv01', durum: 'SONUC', paket: 'True' },
    { host: 'HOSTC', durum: 'ULASILAMADI', paket: 'False' },
    { host: 'bad host', durum: 'SONUC' },
  ],
  ...ek,
});

test('EAX1 sablon yoksa AWX cagrilmaz; 2 dk kisitlamasi', async () => {
  let liste = 0;
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    listTemplateJobsOnServer: async () => ((liste += 1), []),
  });
  sahteModul(REG_YOLU, { getByKey: async () => null, getEffectiveTemplateId: () => null });
  F.dbKur(F.sahteDb());
  assert.deepEqual(await awx.awxIsleriniAl({ simdi: 1_000_000 }), { atlandi: 'template_yok' });
  assert.equal(liste, 0);

  sablonVar();
  assert.equal(await awx.awxIsleriniAl({ simdi: 1_000_000 + 60_000 }), null, '2 dk dolmadan yok');
  assert.deepEqual(await awx.awxIsleriniAl({ simdi: 1_000_000 + awx.ARALIK_MS }), { alinan: [] });
  assert.equal(liste, 1);
});

test('EAX2 is secimi ve kosu acma', async () => {
  sablonVar(4242, 2);
  const detay = [];
  const listeArg = [];
  const isler = {
    905: null, // Portal'in kendi isi: detay hic okunmamali
    904: { status: 'failed', templateId: 4242, artifacts: {} },
    903: {
      status: 'successful',
      templateId: 4242,
      artifacts: { ear_envanter_result: awxStats({ kaynak: 'PORTAL', awx_job_id: '903' }) },
    },
    902: {
      status: 'successful',
      templateId: 99,
      artifacts: { ear_envanter_result: awxStats({ awx_job_id: '902' }) },
    },
    901: {
      status: 'successful',
      templateId: 4242,
      launchedBy: 'ayse',
      artifacts: { ear_envanter_result: awxStats() },
    },
  };
  let okunamaz = true;
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    listTemplateJobsOnServer: async (...a) => (
      listeArg.push(a),
      [905, 904, 903, 902, 901, 900].map((id) => ({ id, status: 'successful' }))
    ),
    getJobStatusOnServer: async (sid, id) => {
      detay.push([sid, id]);
      if (id === 900 && okunamaz) throw new Error('AWX zaman asimi');
      if (id === 900) return { status: 'failed', templateId: 4242, artifacts: {} };
      return { jobId: id, ...isler[id] };
    },
  });
  sahteModul(INV_YOLU, { query: async () => ({ recordset: [{ host: 'appsrv01', env: 'PROD' }] }) });
  const db = F.sahteDb([
    [
      /SELECT TOP 1 kosu_id FROM ear_envanter_partileri/,
      (p) => ({ rows: p[1] === 905 ? [{ kosu_id: 3 }] : [] }),
    ],
    [/INSERT INTO ear_envanter_kosulari/, () => ({ rows: [{ id: 88 }] })],
  ]);
  F.dbKur(db);
  const simdi = Date.parse('2026-11-05T12:00:00Z');
  const r = await awx.awxIsleriniAl({ simdi });
  assert.deepEqual(r, { alinan: [88] });
  assert.equal(listeArg[0][0], 2);
  assert.equal(listeArg[0][1], 4242);
  assert.equal(listeArg[0][2].finishedAfter, '2026-10-29T12:00:00.000Z', '7 gun geriye');
  assert.ok(!detay.some(([, id]) => id === 905), "Portal'in kendi isinin detayi okunmamali");
  const ins = db.cagrilar.filter((c) => c.sql === awx.AWX_KOSU_SQL);
  assert.equal(ins.length, 1, 'yalniz Limit kipi isi alinir');
  const [kip, beklenen, param, baslatan, sid, jid, hostlar, durum] = ins[0].params;
  assert.equal(kip, 'TAM');
  assert.equal(beklenen, 2);
  assert.deepEqual(JSON.parse(param), {
    dizin: alim.earDizin(),
    awx_job_id: 901,
    limit: 'appsrv01,hostc.ornek.local',
    awx_baslatan: 'ayse',
  });
  assert.equal(baslatan, 'awx:ayse');
  assert.equal(sid, 2);
  assert.equal(jid, 901);
  assert.deepEqual(JSON.parse(hostlar), [
    { host: 'APPSRV01', ortam: 'PROD' },
    { host: 'HOSTC', ortam: '' },
  ]);
  assert.equal(durum, 'successful');
  assert.equal(ins[0].opts.tekrar, false, 'kosu acma yeniden denenmemeli');

  // Ikinci tur: kesin kararli isler yeniden okunmaz; okunamayan 900 yeniden denenir.
  detay.length = 0;
  okunamaz = false;
  await awx.awxIsleriniAl({ simdi: simdi + awx.ARALIK_MS });
  assert.deepEqual(detay, [[2, 900]]);
  assert.equal(db.cagrilar.filter((c) => c.sql === awx.AWX_KOSU_SQL).length, 1);
});

test('EAX3 SQL sozlesmesi', () => {
  const sql = awx.AWX_KOSU_SQL;
  assert.match(
    sql,
    /WHERE NOT EXISTS \(SELECT 1 FROM ear_envanter_partileri WITH \(UPDLOCK, HOLDLOCK\)\s+WHERE awx_server_id = \$5 AND awx_job_id = \$6\)/,
  );
  assert.ok(
    !/CALISIYOR'\s*OR|durum = 'CALISIYOR'/.test(sql.split('IF @@ROWCOUNT')[0]),
    'calisan Portal kosusunu beklememeli',
  );
  assert.match(sql, /SELECT \$1, 'AWX', 'SECILI', 'CALISIYOR'/);
  const kolonlar = (tablo) => {
    const m = new RegExp(`CREATE TABLE ${tablo} \\(([\\s\\S]*?)\\n\\s*\\)\``).exec(DDL);
    assert.ok(m, `${tablo} DDL yok`);
    return new Set([...m[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[A-Z]/gm)].map((x) => x[1]));
  };
  for (const [tablo, liste] of [
    ['ear_envanter_kosulari', /INSERT INTO ear_envanter_kosulari \(([^)]*)\)/],
    ['ear_envanter_partileri', /INSERT INTO ear_envanter_partileri \(([^)]*)\)/],
  ]) {
    const var_ = kolonlar(tablo);
    for (const k of liste
      .exec(sql)[1]
      .split(',')
      .map((s) => s.trim()))
      assert.ok(var_.has(k), `${tablo}.${k} DDL'de yok`);
  }
});

test("EAX4 AWX kosusunun alimi awx-<is>/raw'dan", async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-awx-')));
  fs.mkdirSync(path.join(d, 'awx-901', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'awx-901', 'raw', 'APPSRV01.out'), F.paketYap(F.ornekYuk()));
  // Ayni numarali Portal kosusunun dizini okunmamali.
  fs.mkdirSync(path.join(d, 'kosu-88', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'kosu-88', 'raw', 'HOSTC.out'), F.paketYap(F.ornekYuk()));
  const kosu = {
    id: 88,
    kip: 'TAM',
    kaynak: 'AWX',
    kapsam: 'SECILI',
    durum: 'CALISIYOR',
    parametreler: JSON.stringify({ dizin: d, awx_job_id: 901 }),
  };
  const parti = {
    id: 5,
    kosu_id: 88,
    parti_no: 1,
    durum: 'ALINIYOR',
    awx_job_id: 901,
    hostlar: JSON.stringify([
      { host: 'APPSRV01', ortam: 'PROD' },
      { host: 'HOSTC', ortam: '' },
    ]),
  };
  const db = F.sahteDb([
    [/^SET XACT_ABORT ON;\nBEGIN TRAN;\nDELETE FROM ear_envanter_warlari/, () => ({ rowCount: 1 })],
    [/SET durum = 'BITTI'/, () => ({ rowCount: 1 })],
  ]);
  F.dbKur(db);
  await poller.partiyiAl(kosu, parti, {
    status: 'successful',
    artifacts: { ear_envanter_result: awxStats() },
  });
  const yazilan = db.cagrilar
    .filter((c) => c.sql === alim.HOST_YAZ_SQL)
    .map((c) => [c.params[1], JSON.parse(c.params[2])[0].durum]);
  assert.deepEqual(yazilan, [
    ['APPSRV01', 'TAM'],
    ['HOSTC', 'ULASILAMADI'],
  ]);
  const bitti = db.cagrilar.find((c) => /SET durum = 'BITTI'/.test(c.sql));
  assert.equal(bitti.params[2], null, 'set_stats AWX is numarasiyla eslesmeli (not yok)');

  // Baska AWX isinin set_stats'i kullanilmaz.
  const yanlis = poller.statsHaritasi(awxStats({ awx_job_id: 902 }), kosu, parti);
  assert.equal(yanlis.harita.size, 0);
  assert.match(yanlis.uyusmazlik, /başka bir AWX işine ait/);
  // Portal kosusu AWX set_stats'ini (kosu_no 0) kabul etmez.
  assert.match(
    poller.statsHaritasi(awxStats(), { ...kosu, id: 41, kaynak: 'ELLE' }, { parti_no: 3 })
      .uyusmazlik,
    /başka bir koşuya ait/,
  );
});

test('EAX5 limitDenetimi', async () => {
  let ayar = 'all';
  let okuma = 0;
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    getTemplateDefaultLimitOnServer: async (sid, tid) => {
      okuma += 1;
      assert.deepEqual([sid, tid], [2, 4242]);
      if (ayar instanceof Error) throw ayar;
      return ayar;
    },
  });
  sablonVar();
  await assert.rejects(awx.limitDenetimi(), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, 'sablon_limit_dolu');
    assert.match(e.message, /Limit alanı dolu \("all"\)/);
    return true;
  });
  for (ayar of ['', '   ', undefined, new Error('AWX yok')]) await awx.limitDenetimi();
  assert.equal(okuma, 5);

  sahteModul(REG_YOLU, { getByKey: async () => null, getEffectiveTemplateId: () => null });
  okuma = 0;
  await awx.limitDenetimi();
  assert.equal(okuma, 0, 'sablon yoksa AWX okunmaz (launch 501 der)');
});

test('EAX6 Portal kipi: sablon Limit dolu iken parti baslatilmaz', async () => {
  sablonVar();
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    getTemplateDefaultLimitOnServer: async () => 'HOSTA',
  });
  let cagri = 0;
  poller.kur({
    launch: async () => ((cagri += 1), { jobId: 1, awxServerId: 2, status: 'pending' }),
  });
  const db = F.sahteDb([
    [
      /SELECT TOP 1 \* FROM ear_envanter_partileri WHERE kosu_id = \$1 AND durum = 'BEKLIYOR'/,
      () => ({
        rows: [
          {
            id: 7,
            kosu_id: 41,
            parti_no: 1,
            hostlar: '[{"host":"APPSRV01"}]',
            host_sayisi: 1,
            durum: 'BEKLIYOR',
            baslatma_denemesi: 0,
          },
        ],
      }),
    ],
    [
      /SET durum = 'CALISIYOR', baslatma_denemesi = baslatma_denemesi \+ 1/,
      () => ({ rowCount: 1 }),
    ],
    [
      /FROM ear_envanter_kosulari k LEFT JOIN ear_envanter_hostlari/,
      () => ({ rows: [{ beklenen: 1 }] }),
    ],
  ]);
  F.dbKur(db);
  const kosu = { id: 41, kip: 'OZET', kaynak: 'ELLE', baslatan: 'ayse', parametreler: '{}' };
  const r = await poller.siradakiPartiyiBaslat(kosu);
  assert.equal(cagri, 0, 'AWX isi baslatilmamali');
  assert.match(r.hata, /Limit alanı dolu \("HOSTA"\)/);
  const bitir = db.cagrilar.find((c) =>
    /UPDATE ear_envanter_kosulari\s+SET durum = \$2/.test(c.sql),
  );
  assert.equal(bitir.params[1], 'BASARISIZ');
  assert.match(bitir.params[6], /Limit alanı dolu/);
});

test('EAX7 poller turu AWX islerini alir; AWX hatasi turu dusurmez', async (t) => {
  t.mock.method(console, 'warn', () => {});
  sablonVar();
  let liste = 0;
  let patla = false;
  sahteModul(RUNNER_YOLU, {
    redactSecrets: (s) => s,
    listTemplateJobsOnServer: async () => {
      liste += 1;
      if (patla) throw new Error('AWX yok');
      return [];
    },
  });
  F.dbKur(F.sahteDb([[/FROM ear_envanter_ayarlar/, () => ({ rows: [] })]]));
  await poller.tick(new Date('2026-11-05T12:00:00Z'));
  assert.equal(liste, 1, 'tur AWX islerini sormadi');
  await poller.tick(new Date('2026-11-05T12:00:30Z'));
  assert.equal(liste, 1, '2 dk dolmadan yeniden sorulmamali');
  patla = true;
  await poller.tick(new Date('2026-11-05T12:03:00Z'));
  assert.equal(liste, 2);
});
