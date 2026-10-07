// server/retirement/__tests__/rollback.test.cjs — GA1..GA10 (2026-10-07).
//
// KULLANICI TALEBI: "Server Hub > uygulama retirement'da eger belli bir t sure sonra,
// uygulama daha SILINMEDEN sorun olursa geri donebilmek icin bir ozellik yapmaliyiz.
// Uygulamami geri aktif et vs ve yaptigimiz degisiklikler geri alinmali."
//
// ── EN PAHALI YANLIS: GERI ALINMIS BIR UYGULAMANIN SILINMESI ────────────────────────
// `deleteTick` YALNIZ `status='stopped'` hedeflere bakiyor. Geri alma durumu bundan
// farkli oldugu surece zamanlanmis silme KENDILIGINDEN devre disi kalir - ayri bir
// "iptal" cagrisi yok (iki ayri yerden yurutulen bir kural, biri unutulunca geri aktif
// edilmis bir uygulamayi silerdi).
//
// Bu yuzden asagidaki uc sey AYNI DERECEDE kritik ve ucu de kilitli:
//   1. deleteTick 'rolling_back' / 'active' / 'rollback_failed' hedefi ALMAZ
//   2. Geri alma BASARISIZ olursa durum 'stopped'a DONMEZ ('rollback_failed' kalir) -
//      yarim kalmis bir geri almayi silinebilir duruma dondurmek en kotu sonuc
//   3. Basarili bir GERI ALMA kaydi 'deleted' YAPMAZ (adim dallanmasi acik yazilmali)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const DB_YOL = path.join(__dirname, '..', '..', 'db', 'index.cjs');
const sahteDb = { query: async () => ({ rows: [], rowCount: 0 }) };
require.cache[Module._resolveFilename(DB_YOL, module)] = { id: DB_YOL, filename: DB_YOL, loaded: true, exports: sahteDb };

const poller = require('../poller.cjs');

const POLLER_SRC = fs.readFileSync(path.join(__dirname, '..', 'poller.cjs'), 'utf8');
const IDX_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const TAB_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementTab.tsx'),
  'utf8',
);

function dbKur(okumalar, { claimTutar = true } = {}) {
  const yazilan = [];
  sahteDb.query = async (sql, params) => {
    const t = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT/i.test(t.trim())) {
      for (const [desen, rows] of okumalar) if (t.includes(desen)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    }
    yazilan.push({ sql: t, params });
    return { rows: [], rowCount: claimTutar ? 1 : 0 };
  };
  return yazilan;
}

const N = new Date('2026-11-20T12:00:00Z');

/** Silme zamani GELMIS bir hedef — tek degisken `status`. */
const silinebilir = (status) => ({
  id: 7, record_id: 3, host: 'GBJBOP01', app_name: 'CRM', jboss_gen: 7, app_path: '/hysdeploy/CRM.ear',
  env: 'PROD', smart_no: '123', planned_delete_at: '2026-11-01', stop_at: '2026-10-01', delete_after_days: 45,
  status,
});

test('GA1 deleteTick GERI ALINMIS hedefi ALMAZ (sorgu seviyesinde)', async () => {
  // Bu testin SAHTE DB'si durum filtresini UYGULAMAZ - gercek filtre SQL'de. Bu yuzden
  // iki yonlu olculur: (a) sorgu metni status='stopped' sartini tasiyor mu,
  // (b) 'stopped' bir hedef GERCEKTEN tetikleniyor mu (filtre tersine donmemis).
  const kaynak = POLLER_SRC.slice(POLLER_SRC.indexOf('async function deleteTick'), POLLER_SRC.indexOf('const ADIMLAR'));
  assert.match(kaynak, /WHERE t\.status = 'stopped'/, "deleteTick 'stopped' sartini kaybetti");
  for (const d of ['rolling_back', 'active', 'rollback_failed']) {
    assert.ok(!new RegExp(`status\\s*=\\s*'${d}'`).test(kaynak), `deleteTick '${d}' durumunu da aliyor`);
  }

  const yazilan = dbKur([['FROM retirement_targets t JOIN retirement_records r', [silinebilir('stopped')]]]);
  const cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 42 }; });
  const r = await poller._deleteTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 1, "'stopped' hedef tetiklenmedi - filtre tersine donmus olabilir");
  assert.equal(cagri[0].kind, 'delete');
  assert.ok(yazilan.some((w) => /status = 'deleting'/.test(w.sql) && /status = 'stopped'/.test(w.sql)), 'claim deseni kayboldu');
});

test('GA2 geri alma adimi var ve BASARISIZLIKTA durum stopped/failed OLMAZ', async () => {
  const adimlar = POLLER_SRC.slice(POLLER_SRC.indexOf('const ADIMLAR'), POLLER_SRC.indexOf('async function finalizeAdim'));
  assert.match(adimlar, /durum: 'rolling_back'/, 'geri alma adimi yok');
  assert.match(adimlar, /isAlani: 'rollback_job_id'/, 'geri alma AYRI is alani kullanmiyor');
  assert.match(adimlar, /basarili: 'active'/, 'basarili geri alma durumu yok');
  assert.match(adimlar, /basarisiz: 'rollback_failed'/, "basarisiz geri alma 'rollback_failed' degil");
  // 'stopped' BASARISIZLIK durumu olarak gecmemeli: silme kapisini yeniden acardi
  assert.ok(!/basarisiz: 'stopped'/.test(adimlar));
});

test('GA3 BASARISIZ geri alma hedefi rollback_failed yapar (davranissal)', async () => {
  // En pahali yanlis: yarim kalmis bir geri almayi 'stopped'a dondurup silinebilir hale
  // getirmek. Burada GERCEKTEN yazilan SQL olculur, kaynak metni degil.
  const yazilan = dbKur([
    ["FROM retirement_targets WHERE status = 'rolling_back'", [{ id: 7, record_id: 3, host: 'GBJBOP01', app_name: 'CRM', env: 'PROD', job_id: 55 }]],
  ]);
  poller.startPoller(
    async () => ({ jobId: 1 }),
    async () => ({ terminal: true, ok: false, message: 'JVM 180s icinde ayaga kalkmadi' }),
  );
  await poller._finalizeTick();
  poller.stopPoller();
  const u = yazilan.filter((w) => /UPDATE retirement_targets SET status/.test(w.sql));
  assert.ok(u.length > 0, 'hic durum yazilmadi');
  assert.ok(u.some((w) => /status = 'rollback_failed'/.test(w.sql)), 'rollback_failed yazilmadi');
  assert.ok(!u.some((w) => /status = 'stopped'/.test(w.sql) && /SET status/.test(w.sql)), "basarisizlikta 'stopped' yazildi - silme yeniden acilirdi");
});

test('GA4 BASARILI geri alma kaydi deleted YAPMAZ, open\'a dondurur', async () => {
  const yazilan = dbKur([
    ["FROM retirement_targets WHERE status = 'rolling_back'", [{ id: 7, record_id: 3, host: 'GBJBOP01', app_name: 'CRM', env: 'PROD', job_id: 55 }]],
    ['COUNT(*) AS n FROM retirement_targets', [{ n: 0 }]],
  ]);
  poller.startPoller(
    async () => ({ jobId: 1 }),
    async () => ({ terminal: true, ok: true, message: 'CRM geri aktif edildi' }),
  );
  await poller._finalizeTick();
  poller.stopPoller();
  const kayit = yazilan.filter((w) => /UPDATE retirement_records SET status/.test(w.sql));
  assert.ok(!kayit.some((w) => /status = 'deleted'/.test(w.sql)), "geri alma kaydi 'deleted' yapti");
  assert.ok(kayit.some((w) => /status = 'open'/.test(w.sql)), "kayit 'open'a dondurulmedi");
  // stop_at TEMIZLENMELI: silme saati stop_at'ten sayiliyor (schedule.etkinSilmeGunu)
  assert.ok(kayit.some((w) => /stop_at = NULL/.test(w.sql)), 'stop_at temizlenmedi - silme saati eski stop\'tan sayilmaya devam ederdi');
  assert.ok(yazilan.some((w) => /status = 'active'/.test(w.sql)), "hedef 'active' yapilmadi");
});

test('GA5 adim dallanmasi ACIK: else dali DELETE varsaymiyor', async () => {
  const f = POLLER_SRC.slice(POLLER_SRC.indexOf('async function finalizeAdim'), POLLER_SRC.indexOf('// ── WEB KATMANI'));
  assert.match(f, /adim\.kind === 'stop'/, 'stop dali yok');
  assert.match(f, /else if \(adim\.kind === 'delete'\)/, 'delete dali ACIK yazilmamis - ucuncu adim oraya duser');
  assert.match(f, /else if \(adim\.kind === 'rollback'\)/, 'rollback dali yok');
});

test('GA6 finalize ADIMIN KENDI is alanini okur (delete_job_id SABIT yazilmamis)', () => {
  // ORIJINAL HATA (2026-10-07'de bulundu): finalize `Number(t.delete_job_id)` yaziyordu
  // ama `finalizeAdim` kolonu `${adim.isAlani} AS job_id` takma adiyla donduruyor. Yani
  // HER adimda `undefined` -> `Number(undefined)` = NaN -> AWX'e NaN is numarasi.
  // Poller tabanli sonuclandirma HIC calismiyordu.
  assert.match(POLLER_SRC, /\$\{adim\.isAlani\} AS job_id/, 'finalizeAdim takma ad sozlesmesi degismis');
  // `const TERMINAL` dosyada IKI yerde (job-status route'u + finalize); slice sinirini
  // ona baglamak yanlis bolgeyi secer. Gereken desen dogrudan aranir.
  assert.match(IDX_SRC, /const jobId = Number\(t\.job_id \?\? t\.delete_job_id\);/, 'finalize adimin kendi is alanini okumuyor');
  assert.match(IDX_SRC, /getJobStatusOnServer\(serverId, jobId\)/, 'okunan is numarasi kullanilmiyor');
  assert.ok(!/getJobStatusOnServer\(serverId, Number\(t\.delete_job_id\)\)/.test(IDX_SRC), 'delete_job_id hala SABIT yazili');
});

test('GA7 her adim KENDI set_stats anahtarini okur', () => {
  const i = IDX_SRC.indexOf('const STATS = {');
  assert.ok(i > 0, 'STATS esleme tablosu yok - anahtar yine ucluye gore dallanıyor olabilir');
  const blok = IDX_SRC.slice(i, i + 400);
  assert.match(blok, /rollback: 'app_retirement_rollback_result'/, 'geri alma sonucu okunmuyor');
  assert.match(blok, /stop: 'app_retirement_stop_result'/);
  assert.match(blok, /delete: 'app_retirement_delete_result'/);
});

test('GA8 SILINMIS hedef geri ALINAMAZ, silme SURERKEN de baslatilamaz', () => {
  const ep = IDX_SRC.slice(IDX_SRC.indexOf("router.post('/:id/targets/:tid/rollback'"), IDX_SRC.indexOf('// Is durumu: bitince'));
  assert.ok(ep.length > 0, 'rollback endpoint bulunamadi');
  assert.match(ep, /t\.deletedAt \|\| t\.status === 'deleted'/, 'silinmis hedef kontrolu yok');
  assert.match(ep, /yedekten restore/, 'silinmis hedef icin NE YAPILACAGI yazili degil');
  assert.match(ep, /t\.status === 'deleting'/, 'silme surerken geri alma engellenmiyor');
  assert.match(ep, /t\.status === 'rolling_back'/, 'cift geri alma engellenmiyor');
  // 'rollback_failed' TEKRAR DENEMEYE ACIK olmali
  assert.match(ep, /new Set\(\['stopped', 'rollback_failed'\]\)/, 'rollback_failed tekrar denenemiyor');
  // DURUM once yazilmali: arada gececek bir deleteTick hedefi 'stopped' gormemeli
  const i = ep.indexOf("status = 'rolling_back'");
  const j = ep.indexOf('webGeriAl(');
  assert.ok(i > 0 && j > i, "durum degisikligi web geri almadan SONRA yapiliyor - arada silme tetiklenebilir");
});

test('GA9 deletedAt sunucudan DONER (kapi olu kod degil)', () => {
  // Kapi `t.deletedAt` okuyor ama `loadRecord` bu alani DONDURMUYORDU: kontrol hep
  // undefined ile kosuyordu, yani YARIM bir kapiydi (yalniz status eslemesi tutuyordu).
  assert.match(IDX_SRC, /deletedAt: t\.deleted_at \?\? null/, 'deletedAt donmuyor - kapinin yarisi olu kod');
  assert.match(IDX_SRC, /rolledBackAt: t\.rolled_back_at \?\? null/);
});

test('GA10 vhost geri acma YAPILMAYANI basari saymaz; ekran durumlari eksiksiz', () => {
  const w = IDX_SRC.slice(IDX_SRC.indexOf('async function webGeriAl'), IDX_SRC.indexOf("// AWX (Server Hub ile ayni desen)"));
  assert.ok(w.length > 0, 'webGeriAl bulunamadi');
  // Kaldirilmamis ('manual'/'failed') girdide geri acilacak bir sey YOK
  assert.match(w, /w\.status !== 'ok'/, 'yalniz gercekten kaldirilmis vhost geri acilmiyor');
  assert.match(w, /APACHE_URUN_GERI/, 'urun kontrolu yok - NGINX icin apache eylemi cagrilirdi');
  // Template tanimsizsa SESSIZ gecmez
  assert.match(w, /restore_manual/, 'template yoksa durum isaretlenmiyor');
  assert.match(w, /ELLE geri açılmalı/, 'elle yapilmasi gerektigi yazili degil');

  // Ekran: her hedef durumu bir etikete sahip olmali (eksikse ekranda BOS gorunur)
  for (const d of ['rolling_back', 'active', 'rollback_failed', 'deleting', 'deleted', 'stop_scheduled']) {
    assert.ok(new RegExp(`${d}: \\{ label:`).test(TAB_SRC), `${d} durumunun ekran etiketi yok`);
  }
  assert.match(TAB_SRC, /Geri aktif et/, 'geri alma dugmesi yok');
  assert.match(TAB_SRC, /Zamanlanmış silme devre dışı kalır|Zamanlanmış silme devre dışı/, 'onay penceresi silmenin iptal oldugunu soylemiyor');
});
