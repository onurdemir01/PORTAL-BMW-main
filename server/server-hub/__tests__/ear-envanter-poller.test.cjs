// server/server-hub/__tests__/ear-envanter-poller.test.cjs - Uygulama Envanteri kosu yurutucusu.
//
//   EPO1  hedefler: tekil, BUYUK harf, gecersiz ad dislanir ve sayilir, ortamlar birlesir
//   EPO2  partiler: boyut 1..100, son parti kalan kadar
//   EPO3  SOZLESME: extraVars anahtarlari playbook basliginda belgeli ve playbook'un assert regex'lerini gecer
//   EPO4  set_stats baska kosu / partiye aitse kullanilmaz; 2.16 metin sayilari kabul
//   EPO5  host sonucu: dosya -> veri; dosya yok + playbook "paket yazdim" -> OKUNAMADI; PYTHON_YOK
//         korunur; hic sonuc yok -> SONUC_YOK (nedeniyle); bozuk dosya -> OKUNAMADI
//   EPO6  kosu sonucu: eksik ya da gelmeyen host varken TAMAMLANDI yok; hic veri -> BASARISIZ
//   EPO7  parti baslatma: CAS tutmazsa AWX'e gidilmez; yapilandirma hatasi kosuyu durdurur;
//         gecici hata yeniden denenir, 3. denemede parti HATA ve hostlari SONUC_YOK;
//         launch sirasinda iptal/persistence hatasi dis AWX isini iptal edip kimligini kaydeder
//   EPO8  alim: her beklenen host bir satir alir (veri, PYTHON_YOK, SONUC_YOK); yazilamayan veri
//         partiyi kilitlemez (OKUNAMADI); parti BITTI yalniz ALINIYOR'dan
//   EPO9  zamanlayici (iki plan): kapali -> yok; template yoksa kosu ACILMAZ; plan anahtari P1-<TR tarihi>,
//         eski H- anahtari da engeller; ayni gunun OZET'i TAM ile birlesir (kosu acilmaz), TAM acilir;
//         acilamayan plan 10 dk bekler
//   EPO10 sozde istek: AWX'e giden kimlik hic bos degil; zamanlayici gercek bir kisi adi tasimaz
//   EPO11 kosu acma: calisan kosu varsa 409 (zamanlayicida sessiz null); ilk parti istek icinde baslar
//   EPO15 kapsam: ORTAM birebir + normalize (cok ortamli sunucu), SORUNLU = son denemesi TAM / KOK_YOK
//         olmayan + hic taranmamis; ortam listesi ve onizleme kosu acmaz
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
const PLAYBOOK = path.join(
  __dirname,
  '..',
  '..',
  'ansible',
  'bmw_portal',
  'ear_envanter',
  'ear_envanter.yml',
);

const sahteModul = (yol, exports) => {
  require.cache[yol] = { id: yol, filename: yol, loaded: true, exports };
};

let poller;
let alim;
// Ayar modulunun 30 sn'lik onbellegi testler arasinda tasinmasin: moduller her adimda tazelenir.
function yenidenYukle() {
  for (const k of Object.keys(require.cache))
    if (/ear-envanter-(poller|ayar|alim|saklama)\.cjs$/.test(k)) delete require.cache[k];
  poller = require('../ear-envanter-poller.cjs');
  alim = require('../ear-envanter-alim.cjs');
}
beforeEach(yenidenYukle);
afterEach(() => {
  poller._durdurForTest();
  F.dbKaldir();
  for (const y of [REG_YOLU, INV_YOLU, RUNNER_YOLU]) delete require.cache[y];
});

const kosu = (ek = {}) => ({
  id: 41,
  kip: 'TAM',
  kaynak: 'ELLE',
  kapsam: 'SECILI',
  durum: 'CALISIYOR',
  baslatan: 'ayse',
  parametreler: JSON.stringify({
    kokler: '/vhosting:/vhosting8',
    okuma_kullanicisi: 'was',
    dizin: '/sw/ORNEK/ear',
  }),
  ...ek,
});
const parti = (ek = {}) => ({
  id: 7,
  kosu_id: 41,
  parti_no: 3,
  hostlar: JSON.stringify([
    { host: 'APPSRV01', ortam: 'PROD' },
    { host: 'APPSRV02', ortam: 'PROD' },
  ]),
  host_sayisi: 2,
  durum: 'BEKLIYOR',
  baslatma_denemesi: 0,
  alim_denemesi: 0,
  ...ek,
});

test('EPO1 hedefleri duzle', () => {
  const r = poller.hedefleriDuzle([
    { host: 'appsrv01', ortam: 'PROD' },
    { host: 'APPSRV01', ortam: 'DR' },
    { host: 'bad host', ortam: 'X' },
    { host: '', ortam: 'X' },
    { host: 'appsrv02' },
  ]);
  assert.deepEqual(r.hedefler, [
    { host: 'APPSRV01', ortam: 'DR,PROD' },
    { host: 'APPSRV02', ortam: '' },
  ]);
  assert.equal(r.gecersiz, 1);
});

test('EPO2 partilere bol', () => {
  const h = Array.from({ length: 230 }, (_, i) => ({ host: `H${i}` }));
  assert.deepEqual(
    poller.partilereBol(h, 100).map((p) => p.host_sayisi),
    [100, 100, 30],
  );
  assert.deepEqual(
    poller.partilereBol(h, 500).map((p) => p.host_sayisi),
    [100, 100, 30],
    'ust sinir 100',
  );
  assert.deepEqual(
    poller.partilereBol(h.slice(0, 3), 2).map((p) => [p.parti_no, p.host_sayisi]),
    [
      [1, 2],
      [2, 1],
    ],
  );
});

test('EPO3 SOZLESME: extraVars playbook basligi ve assert regexleri', () => {
  const yml = fs.readFileSync(PLAYBOOK, 'utf8');
  const belgeli = new Set([...yml.matchAll(/^#\s{1,4}([a-z_]+):\s/gm)].map((m) => m[1]));
  const ev = poller.extraVarsOf(kosu(), parti());
  for (const k of Object.keys(ev))
    assert.ok(belgeli.has(k), `${k} playbook basliginda belgeli degil`);
  const regexler = [
    ...yml.matchAll(/\((\w+) \| default\([^)]*\)(?: \| string)?\) is match\('([^']+)'\)/g),
  ];
  assert.ok(regexler.length >= 5, 'assert regexleri okunamadi (kor)');
  for (const [, ad, re] of regexler) {
    if (!(ad in ev)) continue;
    assert.match(String(ev[ad]), new RegExp(re), `${ad}=${ev[ad]} playbook assert'ini gecmez`);
  }
  assert.deepEqual(ev.hedefler, ['APPSRV01', 'APPSRV02']);
  assert.ok(ev.hedefler.every((h) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(h)));
  assert.equal(typeof ev.ear_kosu_no, 'string');
  // FAZ 2: deployment kontrolu yalniz kosu parametresi ACIK iken gonderilir (kapaliyken eskisiyle birebir).
  assert.ok(!('ear_deployment_kontrol' in ev), 'kapali kosuda Faz 2 degiskeni gitti');
  const acik = poller.extraVarsOf(
    kosu({ parametreler: JSON.stringify({ kokler: '/vhosting', okuma_kullanicisi: 'was', deployment_kontrolu: 'ACIK' }) }),
    parti(),
  );
  assert.equal(acik.ear_deployment_kontrol, true);
  assert.ok(belgeli.has('ear_deployment_kontrol'), 'Faz 2 degiskeni playbook basliginda belgeli degil');
});

test('EPO4 set_stats eslesmesi', () => {
  const ok = poller.statsHaritasi(
    {
      kosu_no: '41',
      parti_no: '3',
      hostlar: [{ host: 'appsrv01', durum: 'SONUC', paket: 'True' }],
    },
    kosu(),
    parti(),
  );
  assert.equal(ok.uyusmazlik, null);
  assert.equal(ok.harita.get('APPSRV01').durum, 'SONUC');
  const yanlis = poller.statsHaritasi(
    { kosu_no: 40, parti_no: 3, hostlar: [{ host: 'APPSRV01' }] },
    kosu(),
    parti(),
  );
  assert.equal(yanlis.harita.size, 0);
  assert.match(yanlis.uyusmazlik, /başka bir koşuya ait/);
});

test('EPO5 host sonucu kaynaklari', async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-pol-')));
  fs.mkdirSync(path.join(d, 'kosu-41', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'kosu-41', 'raw', 'APPSRV01.out'), F.paketYap(F.ornekYuk()));
  fs.writeFileSync(path.join(d, 'kosu-41', 'raw', 'APPSRV03.out'), 'yarim cikti');
  const k = kosu();
  const p = parti();
  const al = (host, stats, isNotu) =>
    poller.hostuAl(k, p, { host, ortam: 'PROD' }, stats, d, isNotu);
  const veri = await al('APPSRV01', { durum: 'SONUC', paket: true });
  assert.equal(veri.host.veri_var, 1);
  assert.equal(veri.host.playbook_durum, 'SONUC');
  assert.equal((await al('APPSRV02', { durum: 'SONUC', paket: 'True' })).host.durum, 'OKUNAMADI');
  assert.equal(
    (await al('APPSRV02', { durum: 'PYTHON_YOK', paket: false })).host.durum,
    'PYTHON_YOK',
  );
  const yok = await al('APPSRV02', null, 'AWX işi failed');
  assert.equal(yok.host.durum, 'SONUC_YOK');
  assert.equal(yok.host.veri_var, 0);
  assert.match(yok.host.hata, /AWX işi failed/);
  assert.equal((await al('APPSRV03', null)).host.durum, 'OKUNAMADI');
});

test('EPO6 kosu sonucu', () => {
  const s = (tam, kokYok, kismi, basarisiz) => poller.kosuSonucu({ tam, kokYok, kismi, basarisiz });
  assert.equal(s(10, 2, 0, 0), 'TAMAMLANDI');
  assert.equal(s(10, 0, 1, 0), 'KISMI');
  assert.equal(s(10, 0, 0, 1), 'KISMI', 'gelmeyen host varken TAMAMLANDI olmaz');
  assert.equal(s(0, 0, 0, 5), 'BASARISIZ');
  assert.equal(s(0, 3, 0, 0), 'TAMAMLANDI');
});

function partiDb({ cas = 1, ek = [] } = {}) {
  return F.sahteDb([
    [
      /SELECT TOP 1 \* FROM ear_envanter_partileri WHERE kosu_id = \$1 AND durum = 'BEKLIYOR'/,
      () => ({ rows: [parti()] }),
    ],
    [
      /SET durum = 'CALISIYOR', baslatma_denemesi = baslatma_denemesi \+ 1/,
      () => ({ rowCount: cas }),
    ],
    ...ek,
    [/UPDATE p\s+SET awx_server_id/, () => ({ rowCount: 1 })],
  ]);
}

test('EPO7 parti baslatma kurallari', async () => {
  // CAS tutmadi: AWX'e gidilmez.
  let cagri = 0;
  poller.kur({ launch: async () => (cagri += 1) });
  F.dbKur(partiDb({ cas: 0 }));
  assert.deepEqual(await poller.siradakiPartiyiBaslat(kosu()), { bekliyor: true });
  assert.equal(cagri, 0);

  // Basari: is numarasi yazilir, extraVars dogru.
  let gelen;
  poller.kur({
    launch: async (req, key, ad, ev) => (
      (gelen = { req, key, ev }),
      { jobId: 900, awxServerId: 2, status: 'pending' }
    ),
  });
  const db1 = partiDb();
  F.dbKur(db1);
  assert.deepEqual(await poller.siradakiPartiyiBaslat(kosu()), { partiNo: 3, jobId: 900 });
  assert.equal(gelen.key, 'server_hub_ear_envanter');
  assert.equal(gelen.req.session.user.username, 'ayse');
  assert.ok(
    db1.cagrilar.some(
      (c) => /SET awx_server_id = \$2, awx_job_id = \$3/.test(c.sql) && c.params[2] === 900,
    ),
  );

  // Yapilandirma hatasi (template yok): kosu BASARISIZ, istek sahibine hata.
  poller.kur({
    launch: async () => {
      throw Object.assign(new Error('template yok'), { status: 501 });
    },
  });
  const db2 = partiDb({
    ek: [
      [
        /FROM ear_envanter_kosulari k LEFT JOIN ear_envanter_hostlari/,
        () => ({ rows: [{ beklenen: 2 }] }),
      ],
    ],
  });
  F.dbKur(db2);
  await assert.rejects(
    poller.siradakiPartiyiBaslat(kosu(), { session: { user: { username: 'ayse' } } }),
    /template yok/,
  );
  const bitir = db2.cagrilar.find((c) =>
    /UPDATE ear_envanter_kosulari\s+SET durum = \$2/.test(c.sql),
  );
  assert.equal(bitir.params[1], 'BASARISIZ');
  assert.ok(
    db2.cagrilar.some((c) => /SET durum = 'IPTAL'.*durum = 'BEKLIYOR'/s.test(c.sql)),
    'bekleyen partiler iptal edilmedi',
  );

  // Gecici hata: yeniden denenecek (BEKLIYOR), elle istekte bile FIRLATILMAZ.
  poller.kur({
    launch: async () => {
      throw Object.assign(new Error('AWX zaman asimi'), { status: 424 });
    },
  });
  const db3 = partiDb();
  F.dbKur(db3);
  const r3 = await poller.siradakiPartiyiBaslat(kosu(), {
    session: { user: { username: 'ayse' } },
  });
  assert.equal(r3.yenidenDenenecek, true);
  assert.equal(
    db3.cagrilar.find((c) => /SET durum = \$2, hata = \$3/.test(c.sql)).params[1],
    'BEKLIYOR',
  );

  // Ucuncu deneme: parti HATA, hostlari SONUC_YOK satiri alir.
  const db4 = F.sahteDb([
    [
      /SELECT TOP 1 \* FROM ear_envanter_partileri/,
      () => ({ rows: [parti({ baslatma_denemesi: 2 })] }),
    ],
    [/SET durum = 'CALISIYOR'/, () => ({ rowCount: 1 })],
  ]);
  F.dbKur(db4);
  const r4 = await poller.siradakiPartiyiBaslat(kosu());
  assert.equal(r4.yenidenDenenecek, false);
  assert.equal(
    db4.cagrilar.find((c) => /SET durum = \$2, hata = \$3/.test(c.sql)).params[1],
    'HATA',
  );
  const yazilan = db4.cagrilar
    .filter((c) => c.sql === alim.HOST_YAZ_SQL)
    .map((c) => [c.params[1], JSON.parse(c.params[2])[0].durum]);
  assert.deepEqual(yazilan, [
    ['APPSRV01', 'SONUC_YOK'],
    ['APPSRV02', 'SONUC_YOK'],
  ]);
});

test('EPO7b launch-iptal yarisi ve job-ID yazim hatasi fail-closed uzlasir', async () => {
  let parent = 'CALISIYOR';
  let partiDurum = 'BEKLIYOR';
  let kayit = null;
  let launchCoz;
  const launchBekle = new Promise((resolve) => {
    launchCoz = resolve;
  });
  const launchGirdi = new Promise((resolve) => {
    poller.kur({
      launch: async () => {
        resolve();
        return launchBekle;
      },
    });
  });
  const iptaller = [];
  sahteModul(RUNNER_YOLU, {
    cancelJobOnServer: async (serverId, jobId) => iptaller.push([serverId, jobId]),
    redactSecrets: (s) => s,
  });
  const db = F.sahteDb([
    [/SELECT TOP 1 \* FROM ear_envanter_partileri/, () => ({ rows: [parti({ durum: partiDurum })] })],
    [
      /SET durum = 'CALISIYOR', baslatma_denemesi/,
      () => ((partiDurum = 'CALISIYOR'), { rowCount: 1 }),
    ],
    [/SELECT \* FROM ear_envanter_kosulari WHERE id/, () => ({ rows: [kosu({ durum: parent })] })],
    [/FROM ear_envanter_kosulari k LEFT JOIN ear_envanter_hostlari/, () => ({ rows: [{ beklenen: 2 }] })],
    [/SET durum = 'IPTAL'.*durum = 'BEKLIYOR'/s, () => ({ rowCount: 0 })],
    [
      /UPDATE ear_envanter_kosulari\s+SET durum = \$2/,
      () => ((parent = 'IPTAL'), { rowCount: 1 }),
    ],
    [/SELECT awx_server_id, awx_job_id FROM ear_envanter_partileri/, () => ({ rows: [] })],
    [
      /UPDATE p\s+SET awx_server_id/,
      () => ({ rowCount: parent === 'CALISIYOR' && partiDurum === 'CALISIYOR' ? 1 : 0 }),
    ],
    [
      /SET awx_server_id = \$2, awx_job_id = \$3, awx_durum = \$4, hata = \$5/,
      (p) => ((kayit = { serverId: p[1], jobId: p[2], hata: p[4] }), { rowCount: 1 }),
    ],
  ]);
  F.dbKur(db);
  const baslat = poller.siradakiPartiyiBaslat(kosu());
  await launchGirdi;
  const iptal = await poller.kosuIptal(41, 'admin');
  assert.deepEqual(iptal.awxIptal, [], 'job ID henuz yokken Admin iptali dis isi goremez');
  launchCoz({ jobId: 900, awxServerId: 2, status: 'pending' });
  const sonuc = await baslat;
  assert.equal(sonuc.sahiplikKaybi, true);
  assert.equal(sonuc.awxIptal, true);
  assert.equal(sonuc.uzlasmaKaydi, true);
  assert.deepEqual(iptaller, [[2, 900]]);
  assert.deepEqual([kayit.serverId, kayit.jobId], [2, 900]);
  assert.match(kayit.hata, /sahipliği kaybedildi.*iptali istendi/);
  const cas = db.cagrilar.find((c) => /UPDATE p\s+SET awx_server_id/.test(c.sql));
  assert.match(cas.sql, /p\.durum = 'CALISIYOR'/);
  assert.match(cas.sql, /k\.id = \$5 AND k\.durum = 'CALISIYOR'/);

  // Normal job-ID yazimi throw ederse yeniden BEKLIYOR'a donup duplicate launch yapma:
  // dis isi iptal et ve ikinci dar yazimla job kimligi + belirsizlik notunu koru.
  yenidenYukle();
  const iptaller2 = [];
  sahteModul(RUNNER_YOLU, {
    cancelJobOnServer: async (serverId, jobId) => iptaller2.push([serverId, jobId]),
    redactSecrets: (s) => s,
  });
  poller.kur({ launch: async () => ({ jobId: 901, awxServerId: 3, status: 'pending' }) });
  let kurtarma = null;
  const db2 = partiDb({
    ek: [
      [/UPDATE p\s+SET awx_server_id/, () => { throw new Error('DB write timeout'); }],
      [
        /SET awx_server_id = \$2, awx_job_id = \$3, awx_durum = \$4, hata = \$5/,
        (p) => ((kurtarma = p), { rowCount: 1 }),
      ],
    ],
  });
  F.dbKur(db2);
  const r2 = await poller.siradakiPartiyiBaslat(kosu());
  assert.equal(r2.sahiplikKaybi, true);
  assert.equal(r2.awxIptal, true);
  assert.equal(r2.uzlasmaKaydi, true);
  assert.deepEqual(iptaller2, [[3, 901]]);
  assert.deepEqual(kurtarma.slice(1, 4), [3, 901, 'pending']);
  assert.match(kurtarma[4], /job kimliği normal yoldan yazılamadı.*iptali istendi/);
  assert.ok(
    !db2.cagrilar.some((c) => /SET durum = \$2, hata = \$3/.test(c.sql)),
    'launch sonrasi persistence hatasi parti claimini BEKLIYOR yapti',
  );

  // Timeout commit SONRASI geldiyse ayni job zaten kayitlidir. Cancel da duserse hata notu
  // ayni controller-local kimlige yazilmali; `awx_job_id IS NULL` korlugu notu yutmamali.
  yenidenYukle();
  sahteModul(RUNNER_YOLU, {
    cancelJobOnServer: async () => { throw new Error('AWX cancel timeout'); },
    redactSecrets: (s) => s,
  });
  poller.kur({ launch: async () => ({ jobId: 902, awxServerId: 4, status: 'pending' }) });
  let kaliciJob = null;
  let kaliciHata = null;
  const db3 = partiDb({
    ek: [
      [
        /UPDATE p\s+SET awx_server_id/,
        () => {
          kaliciJob = { serverId: 4, jobId: 902 };
          throw new Error('timeout after commit');
        },
      ],
      [
        /COALESCE\(awx_server_id, 0\) = \$2 AND awx_job_id = \$3/,
        (p) => {
          if (kaliciJob.serverId !== p[1] || kaliciJob.jobId !== p[2]) return { rowCount: 0 };
          kaliciHata = p[4];
          return { rowCount: 1 };
        },
      ],
    ],
  });
  F.dbKur(db3);
  const r3 = await poller.siradakiPartiyiBaslat(kosu());
  assert.equal(r3.awxIptal, false);
  assert.equal(r3.uzlasmaKaydi, true);
  assert.deepEqual(kaliciJob, { serverId: 4, jobId: 902 });
  assert.match(kaliciHata, /timeout after commit.*AWX iptali başarısız: AWX cancel timeout/);

  // Satirda farkli job varsa kimligini ezme; rowCount=0'i yutma ve collision notunu ayri yaz.
  yenidenYukle();
  sahteModul(RUNNER_YOLU, {
    cancelJobOnServer: async () => { throw new Error('cancel reddedildi'); },
    redactSecrets: (s) => s,
  });
  poller.kur({ launch: async () => ({ jobId: 903, awxServerId: 5, status: 'pending' }) });
  const mevcut = { serverId: 8, jobId: 999 };
  let cakismaNotu = null;
  const db4 = partiDb({
    ek: [
      [/UPDATE p\s+SET awx_server_id/, () => { throw new Error('write belirsiz'); }],
      [/COALESCE\(awx_server_id, 0\) = \$2 AND awx_job_id = \$3/, () => ({ rowCount: 0 })],
      [
        /UPDATE ear_envanter_partileri SET hata = \$2 WHERE id = \$1/,
        (p) => ((cakismaNotu = p[1]), { rowCount: 1 }),
      ],
    ],
  });
  F.dbKur(db4);
  const r4 = await poller.siradakiPartiyiBaslat(kosu());
  assert.equal(r4.uzlasmaKaydi, true);
  assert.deepEqual(mevcut, { serverId: 8, jobId: 999 }, 'farkli controller-local job ezildi');
  assert.match(cakismaNotu, /farklı AWX job kimliği bulundu, mevcut kimlik ezilmedi/);
});

test('EPO8 parti alimi', async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-alim2-')));
  fs.mkdirSync(path.join(d, 'kosu-41', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'kosu-41', 'raw', 'APPSRV01.out'), F.paketYap(F.ornekYuk()));
  const k = kosu({ parametreler: JSON.stringify({ dizin: d }) });
  const p = parti({
    durum: 'ALINIYOR',
    hostlar: JSON.stringify([{ host: 'APPSRV01' }, { host: 'APPSRV02' }, { host: 'APPSRV03' }]),
  });
  let ilkYazim = true;
  const db = F.sahteDb([
    [
      /^SET XACT_ABORT ON;\nBEGIN TRAN;\nDELETE FROM ear_envanter_warlari/,
      (params) => {
        // Verili hostun ilk yazimi patlar (ornegin beklenmeyen veri); bos satir yazimi gecer.
        if (params[1] === 'APPSRV01' && ilkYazim) {
          ilkYazim = false;
          throw new Error('String or binary data would be truncated');
        }
        return { rowCount: 1 };
      },
    ],
    [/SET durum = 'BITTI'/, () => ({ rowCount: 1 })],
  ]);
  F.dbKur(db);
  const st = {
    status: 'failed',
    jobExplanation: '',
    artifacts: {
      ear_envanter_result: {
        kosu_no: 41,
        parti_no: 3,
        hostlar: [{ host: 'APPSRV02', durum: 'PYTHON_YOK', paket: false }],
      },
    },
  };
  const r = await poller.partiyiAl(k, p, st);
  assert.equal(r.toplam, 3);
  const yazilan = db.cagrilar
    .filter((c) => c.sql === alim.HOST_YAZ_SQL)
    .map((c) => [c.params[1], JSON.parse(c.params[2])[0].durum]);
  assert.deepEqual(yazilan, [
    ['APPSRV01', 'TAM'],
    ['APPSRV01', 'OKUNAMADI'],
    ['APPSRV02', 'PYTHON_YOK'],
    ['APPSRV03', 'SONUC_YOK'],
  ]);
  const bitti = db.cagrilar.find((c) => /SET durum = 'BITTI'/.test(c.sql));
  assert.match(bitti.sql, /WHERE id = \$1 AND durum = 'ALINIYOR'/);
  assert.match(bitti.params[2], /AWX işi failed/);
});

test('EPO9 zamanlayici (iki plan)', async () => {
  const ayarDb = (rows) =>
    F.sahteDb([
      [/FROM ear_envanter_ayarlar/, () => ({ rows })],
      [/INSERT INTO ear_envanter_kosulari/, () => ({ rows: [{ id: 77 }] })],
    ]);
  const pazar = new Date('2026-11-07T23:30:00Z'); // TR: Pazar 8 Kasim 02:30 (P1 ornegi)
  F.dbKur(ayarDb([]));
  assert.equal(await poller.zamanlayiciyiKontrolEt(pazar), null, 'varsayilan KAPALI');

  yenidenYukle();
  F.dbKur(ayarDb([{ anahtar: 'p1_acik', deger: 'ACIK' }]));
  sahteModul(REG_YOLU, { getByKey: async () => ({ enabled: true }), getEffectiveTemplateId: () => null });
  assert.deepEqual(await poller.zamanlayiciyiKontrolEt(pazar), { atlandi: 'template_yok' });

  yenidenYukle();
  const db = ayarDb([{ anahtar: 'p1_acik', deger: 'ACIK' }]);
  F.dbKur(db);
  sahteModul(REG_YOLU, { getByKey: async () => ({ enabled: true }), getEffectiveTemplateId: () => 55 });
  sahteModul(INV_YOLU, {
    query: async () => ({ recordset: [{ host: 'appsrv01', env: 'PROD' }, { host: 'appsrv02', env: 'TEST' }] }),
  });
  const k = await poller.zamanlayiciyiKontrolEt(pazar);
  assert.equal(k.id, 77);
  const ins = db.cagrilar.find((c) => /INSERT INTO ear_envanter_kosulari/.test(c.sql));
  assert.deepEqual([ins.params[0], ins.params[1], ins.params[2]], ['OZET', 'ZAMANLAYICI', 'FILO'], 'P1 OZET filo');
  assert.equal(ins.params[7], 'P1-2026-11-08', 'anahtar plan + TR tarihi');
  assert.deepEqual(JSON.parse(ins.params[9]), ['H-2026-11-08'], 'eski haftalik anahtar da engeller');
  assert.match(ins.sql, /zamanlayici_anahtari IN \(SELECT value FROM OPENJSON\(\$10\)\)/);
  assert.equal(ins.opts.tekrar, false, 'kosu acma yeniden denenmemeli');

  // 3 Ocak 2027 02:30: P1 OZET ornegi P2 TAM ile birlesir -> kosu ACILMAZ.
  yenidenYukle();
  const db2 = ayarDb([{ anahtar: 'p1_acik', deger: 'ACIK' }, { anahtar: 'p2_acik', deger: 'ACIK' }]);
  F.dbKur(db2);
  sahteModul(REG_YOLU, { getByKey: async () => ({ enabled: true }), getEffectiveTemplateId: () => 55 });
  const b = await poller.zamanlayiciyiKontrolEt(new Date('2027-01-02T23:30:00Z'));
  assert.deepEqual(b, { atlandi: 'tam_ile_birlesti', anahtar: 'P1-2027-01-03' });
  assert.ok(!db2.cagrilar.some((c) => /INSERT INTO ear_envanter_kosulari/.test(c.sql)));
  // 03:30: P2 TAM acilir.
  sahteModul(INV_YOLU, { query: async () => ({ recordset: [{ host: 'appsrv01', env: 'PROD' }] }) });
  const t = await poller.zamanlayiciyiKontrolEt(new Date('2027-01-03T00:30:00Z'));
  assert.equal(t.id, 77);
  const ins2 = db2.cagrilar.find((c) => /INSERT INTO ear_envanter_kosulari/.test(c.sql));
  assert.deepEqual([ins2.params[0], ins2.params[7], ins2.params[9]], ['TAM', 'P2-2027-01-03', null]);

  // Acilamayan plan (hedef yok): 10 dk beklenir, her turda yeniden denenmez.
  yenidenYukle();
  const db3 = ayarDb([{ anahtar: 'p1_acik', deger: 'ACIK' }, { anahtar: 'p1_kapsam', deger: 'ORTAM:YOK' }]);
  F.dbKur(db3);
  sahteModul(REG_YOLU, { getByKey: async () => ({ enabled: true }), getEffectiveTemplateId: () => 55 });
  sahteModul(INV_YOLU, { query: async () => ({ recordset: [{ host: 'appsrv01', env: 'PROD' }] }) });
  const h = await poller.zamanlayiciyiKontrolEt(pazar);
  assert.match(h.hata, /Seçilen ortamlarda sunucu yok \(YOK\)/);
  assert.equal(await poller.zamanlayiciyiKontrolEt(new Date(pazar.getTime() + 60000)), null, 'bekleme suresi');
  assert.ok((await poller.zamanlayiciyiKontrolEt(new Date(pazar.getTime() + 11 * 60000))).hata, '10 dk sonra yeniden');
});

test('EPO15 kapsam cozucu', async () => {
  sahteModul(INV_YOLU, {
    query: async () => ({
      recordset: [
        { host: 'appsrv01', env: 'PROD' },
        { host: 'appsrv02', env: 'test' },
        { host: 'appsrv03', env: 'PREPROD' },
        { host: 'appsrv04', env: 'PROD' },
        { host: 'appsrv04', env: 'TEST' },
        { host: 'appsrv05', env: null },
      ],
    }),
  });
  F.dbKur(
    F.sahteDb([
      [/WITH son AS \(SELECT host, MAX\(kosu_id\) AS kosu_id FROM ear_envanter_hostlari GROUP BY host\)/, () => ({
        rows: [
          { host: 'APPSRV01', durum: 'TAM' },
          { host: 'APPSRV02', durum: 'ULASILAMADI' },
          { host: 'APPSRV03', durum: 'KOK_YOK' },
          { host: 'APPSRV04', durum: 'KISMI' },
        ],
      })],
      [/INSERT INTO ear_envanter_kosulari/, () => ({ rows: [{ id: 5 }] })],
    ]),
  );
  const adlar = async (k) => (await poller.kapsamHedefleri(k)).hedefler.map((x) => x.host);
  assert.deepEqual(await adlar('ORTAM:TEST'), ['APPSRV02', 'APPSRV04'], 'birebir + normalize + cok ortamli sunucu');
  assert.deepEqual(await adlar('ORTAM:PROD'), ['APPSRV01', 'APPSRV04'], 'PREPROD gelmez');
  assert.deepEqual(await adlar('SORUNLU'), ['APPSRV02', 'APPSRV04', 'APPSRV05'], 'TAM / KOK_YOK olmayan + hic taranmamis');
  assert.equal((await adlar('FILO')).length, 5);
  await assert.rejects(poller.kapsamHedefleri('HEPSI'), (e) => e.status === 400);
  assert.deepEqual(await poller.ortamlar(), [
    { ortam: 'PROD', sunucu: 2 },
    { ortam: 'TEST', sunucu: 2 },
    { ortam: 'PREPROD', sunucu: 1 },
  ]);
  const o = await poller.kapsamOnizleme('ORTAM:PROD', 'TAM');
  assert.deepEqual([o.sunucu, o.parti, o.ornek], [2, 1, ['APPSRV01', 'APPSRV04']]);
  const k = await poller.kosuOlustur({ kip: 'OZET', kapsam: 'ORTAM:test,PROD', baslatan: 'ayse' });
  assert.equal(k.beklenen, 3);
  await assert.rejects(poller.kosuOlustur({ kip: 'OZET', kapsam: 'ORTAM:', baslatan: 'ayse' }), (e) => e.status === 400);
});

test('EPO10 sozde istek', () => {
  const z = poller.sozdeIstek(
    kosu({ kaynak: 'ZAMANLAYICI', baslatan: 'ear-envanter-zamanlayici' }),
  );
  assert.equal(z.session.user.username, 'ear-envanter-zamanlayici');
  assert.equal(z.session.user.role, 'system');
  const e = poller.sozdeIstek(kosu({ baslatan: '' }));
  assert.equal(e.session.user.username, 'unknown');
  assert.ok(e.session && e.session.user, 'launch req.session.user ister');
});

test('EPO11 kosu acma', async () => {
  sahteModul(INV_YOLU, { query: async () => ({ recordset: [] }) });
  F.dbKur(F.sahteDb([[/INSERT INTO ear_envanter_kosulari/, () => ({ rows: [{ id: null }] })]]));
  await assert.rejects(
    poller.kosuOlustur({ kip: 'TAM', hedefler: [{ host: 'APPSRV01' }], baslatan: 'ayse' }),
    (e) => e.status === 409,
  );
  assert.equal(
    await poller.kosuOlustur({
      kip: 'TAM',
      hedefler: [{ host: 'APPSRV01' }],
      baslatan: 'x',
      zamanlayiciAnahtari: 'H-2026-11-08',
    }),
    null,
  );
  await assert.rejects(
    poller.kosuOlustur({ kip: 'HIZLI', hedefler: [{ host: 'A1' }] }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    poller.kosuOlustur({ kip: 'TAM', hedefler: [{ host: 'kotu ad' }] }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    poller.kosuOlustur({ kip: 'OZET', hedefler: null }),
    (e) => e.status === 422,
    'bos filo',
  );

  let baslatildi = null;
  poller.kur({
    launch: async (req, key, ad, ev) => ((baslatildi = ev), { jobId: 5, awxServerId: 0 }),
  });
  const db = F.sahteDb([
    [/INSERT INTO ear_envanter_kosulari/, () => ({ rows: [{ id: 41 }] })],
    [/SELECT \* FROM ear_envanter_kosulari WHERE id = \$1/, () => ({ rows: [kosu()] })],
    [/SELECT TOP 1 \* FROM ear_envanter_partileri/, () => ({ rows: [parti({ parti_no: 1 })] })],
    [/SET durum = 'CALISIYOR'/, () => ({ rowCount: 1 })],
    [/UPDATE p\s+SET awx_server_id/, () => ({ rowCount: 1 })],
  ]);
  F.dbKur(db);
  const r = await poller.kosuOlustur({
    kip: 'TAM',
    hedefler: [{ host: 'appsrv01' }, { host: 'appsrv02' }],
    baslatan: 'ayse',
    req: { session: { user: { username: 'ayse' } } },
  });
  assert.equal(r.id, 41);
  assert.deepEqual(r.ilkParti, { partiNo: 1, jobId: 5 });
  assert.deepEqual(baslatildi.hedefler, ['APPSRV01', 'APPSRV02']);
  const ins = db.cagrilar.find((c) => /INSERT INTO ear_envanter_kosulari/.test(c.sql));
  assert.equal(ins.params[2], 'SECILI');
  assert.match(
    poller.KOSU_OLUSTUR_SQL,
    /WITH \(UPDLOCK, HOLDLOCK\)\s+WHERE durum = 'CALISIYOR' OR \(\$8 IS NOT NULL AND zamanlayici_anahtari = \$8\)/,
  );
});
