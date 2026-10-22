// server/retirement/__tests__/silme-geri-al-onkontrol.test.cjs — SG1..SG14 (2026-10-22).
//
// Kullanici: "DELETE ve GERI AL icin de on kontrol listesini yap lutfen" (STOP'taki on kontrolun devami:
// "hangi komutlarin uygulanacagi ... acik acik yazdiralim ve bunlarin disinda hicbir seye dokunulmadigindan
// emin olalim").
//   GERI AL: insan onayli. "Geri aktif et" once on kontrolu kosar; onay YALNIZ o on kontrolun izin
//            listesiyle gider, bir liste bir onaya.
//   SILME:   EKSTRA ONAY YOK kurali (2026-10-06) korunur; zamanlayici silme saatinden bir saat once on
//            kontrolu kosar, silmeyi YALNIZ taze ve basarili on kontrolun listesiyle baslatir.
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
const so = require('../stop-sonuc.cjs');
const sched = require('../schedule.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const dilim = (bas, son) => {
  const i = IDX.indexOf(bas);
  assert.ok(i >= 0, `bulunamadi: ${bas}`);
  const j = IDX.indexOf(son, i + bas.length);
  return IDX.slice(i, j > i ? j : undefined);
};

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

// 2026-10-06 TR: 22:30 = on kontrol penceresi, 23:30 = silme penceresi, 15:00 = ikisi de degil.
const OK_ANI = new Date('2026-10-06T19:30:00Z');
const SIL_ANI = new Date('2026-10-06T20:30:00Z');
const GUNDUZ = new Date('2026-10-06T12:00:00Z');
const IZIN = ['onay:sil:A|JBoss8|H:9998', 'rm:/vhosting8/A.ear.1.old', 'cli:/host=primary/server-config=A:remove'];
const plan = (o = {}) => JSON.stringify({ jobId: 70, at: '2026-10-06T19:45:00Z', durum: 'ok', izinler: IZIN, ...o });
const hedef = (o = {}) => ({
  id: 9, record_id: 4, host: 'H', app_name: 'A', jboss_gen: 8, app_path: '/vhosting8/A.ear', env: 'TEST',
  smart_no: '1', planned_delete_at: '2026-10-05', stop_at: '2026-09-01', delete_after_days: 45, delete_onkontrol_json: null, ...o,
});
const SEC = 'FROM retirement_targets t JOIN retirement_records r';

test('SG1 onay kimligi ISE OZEL: STOP / silme / geri alma listeleri birbirinin yerine gecmez', () => {
  const stopL = JSON.stringify({ jobId: 5, izinler: ['onay:A|JBoss7|H', 'mv:/vhosting/A.ear'] });
  const silL = JSON.stringify({ jobId: 5, izinler: ['onay:sil:A|JBoss7|H', 'rm:/vhosting/A.ear.1.old'] });
  const geriL = JSON.stringify({ jobId: 5, izinler: ['onay:geri-al:A|JBoss7|H'] });
  assert.ok(so.onKontrolIzinleri(stopL, 5));
  assert.equal(so.onKontrolIzinleri(silL, 5), null, 'silme listesi STOP onayi sayildi');
  assert.equal(so.onKontrolIzinleri(geriL, 5), null, 'geri alma listesi STOP onayi sayildi');
  const ok = (j) => JSON.stringify({ ...JSON.parse(j), durum: 'ok' });
  assert.ok(so.onKontrolGecerli(ok(silL), 'delete'));
  assert.equal(so.onKontrolGecerli(ok(stopL), 'delete'), null, 'STOP listesi silmeyi aciyor');
  assert.equal(so.onKontrolGecerli(ok(geriL), 'delete'), null, 'geri alma listesi silmeyi aciyor');
  assert.ok(so.onKontrolGecerli(ok(geriL), 'rollback'));
  assert.equal(so.onKontrolGecerli(ok(silL), 'rollback'), null, 'silme listesi geri almayi aciyor');
  assert.equal(so.onKontrolGecerli(ok(stopL), 'rollback'), null, 'STOP listesi geri almayi aciyor');
});

test('SG2 gecerlilik: yalniz BASARILI, KULLANILMAMIS, (istenirse) ayni is ve TAZE', () => {
  const now = new Date('2026-10-06T20:30:00Z');
  assert.deepEqual(so.onKontrolGecerli(plan(), 'delete', { maxYasDk: 180, now }), IZIN);
  for (const [o, neden] of [
    [{ durum: 'running' }, 'suren on kontrol'],
    [{ durum: 'failed' }, 'basarisiz on kontrol'],
    [{ kullanildi: true }, 'kullanilmis on kontrol'],
    [{ at: '2026-10-06T16:00:00Z' }, 'bayat (4.5 saat) on kontrol'],
    [{ at: 'bozuk' }, 'tarihi okunamayan on kontrol'],
    [{ at: '2026-10-07T20:30:00Z' }, 'gelecek tarihli on kontrol'],
  ])
    assert.equal(so.onKontrolGecerli(plan(o), 'delete', { maxYasDk: 180, now }), null, `${neden} kabul edildi`);
  assert.equal(so.onKontrolGecerli(plan(), 'delete', { jobId: 71 }), null, 'baska on kontrol isi kabul edildi');
  assert.equal(so.onKontrolGecerli('{bozuk', 'delete'), null);
});

test('SG3 onKontrolSonucu: PLAN + onay = hazir; PLAN ama onay yok (eski betik) BASARISIZ ve sebebi yazar; liste kisalsa da izinler KESILMEZ', () => {
  const sonuc = { line: 'RESULT\tdelete\tPLAN\tPLAN (HENUZ HICBIR SEY SILINMEDI)', onkontrol: ['ONKONTROL\tozet\t1\tx'], izinler: IZIN };
  const k = JSON.parse(so.onKontrolSonucu('delete', 'successful', sonuc, 70, { kaynak: 'zamanlayici', kullanildi: true }));
  assert.equal(k.durum, 'ok');
  assert.deepEqual(k.izinler, IZIN);
  assert.equal(k.kaynak, 'zamanlayici', 'onceki kaydin bilgisi kayboldu');
  assert.equal(k.kullanildi, undefined, 'yeni sonuc eski kullanildi isaretini tasiyor');
  const eski = JSON.parse(so.onKontrolSonucu('delete', 'successful', { ...sonuc, izinler: undefined }, 70));
  assert.equal(eski.durum, 'failed');
  assert.match(eski.mesaj, /izin listesi gelmedi/);
  const yanlis = JSON.parse(so.onKontrolSonucu('delete', 'successful', { ...sonuc, izinler: ['onay:A|JBoss8|H'] }, 70));
  assert.equal(yanlis.durum, 'failed', 'STOP onayli liste silme on kontrolu sayildi');
  const fail = JSON.parse(so.onKontrolSonucu('rollback', 'failed', { line: 'RESULT\trollback\tFAIL\tON KONTROL: hedef var', izinler: IZIN }, 8));
  assert.equal(fail.durum, 'failed');
  assert.deepEqual(fail.izinler, [], 'basarisiz on kontrolde izin saklandi');
  const cokIzin = Array.from({ length: 50 }, (_, i) => `rm:/vhosting8/x${i}.ear.1.old`);
  const uzun = JSON.parse(so.onKontrolSonucu('delete', 'successful', { ...sonuc, izinler: [IZIN[0], ...cokIzin], onkontrol: Array.from({ length: 3000 }, (_, i) => `ONKONTROL\tdosya\t${'y'.repeat(30)}${i}\tSILINECEK`) }, 70));
  assert.equal(uzun.kisaltildi, true);
  assert.equal(uzun.izinler.length, 51, 'kisaltmada izinler kesildi');
});

test('SG4 silme on kontrolu silme saatinden BIR SAAT once baslar; gun gelmeden / gunduz baslamaz; beklemeyi atla beklemez', () => {
  const b = { plannedDeleteAt: '2026-10-06', stopAt: '2026-09-01', deleteAfterDays: 45 };
  assert.equal(sched.silmeOnKontrolZamaniGeldi(b, new Date('2026-10-06T18:59:00Z')), false, '21:59 TR on kontrol basladi');
  assert.equal(sched.silmeOnKontrolZamaniGeldi(b, new Date('2026-10-06T19:00:00Z')), true, '22:00 TR on kontrol baslamadi');
  assert.equal(sched.silmeOnKontrolZamaniGeldi({ ...b, plannedDeleteAt: '2026-10-07' }, OK_ANI), false, 'silme gunu gelmeden on kontrol');
  assert.equal(sched.silmeOnKontrolZamaniGeldi({ ...b, deleteNowAt: '2026-10-06T08:00:00Z' }, GUNDUZ), true, 'beklemeyi atla on kontrolu beklemeli degil');
  assert.equal(sched.silmePlanTazeDk(), 180);
});

test('SG5 on kontrol penceresinde listesi olmayan hedefe ON KONTROL baslar (plan_only), SILME BASLAMAZ; claim launch ONCESI', async () => {
  const yazilan = dbKur([[SEC, [hedef()]]]);
  const cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t, yazilanSayisi: yazilan.length }); return { jobId: 81, awxServerId: 2 }; });
  const r = await poller._deleteTick(OK_ANI);
  poller.stopPoller();
  assert.equal(r.kosan, 0, 'listesiz silme baslatildi');
  assert.equal(r.planlanan, 1);
  assert.equal(cagri.length, 1);
  assert.equal(cagri[0].kind, 'delete');
  assert.equal(cagri[0].t.planOnly, true, 'on kontrol plan_only ile gitmiyor');
  assert.equal(cagri[0].t.izinler, undefined);
  assert.ok(!yazilan.some((w) => /SET status = 'deleting'/.test(w.sql)), 'on kontrol icin hedef silmeye alindi');
  const claim = yazilan.findIndex((w) => /SET delete_onkontrol_json = \$1/.test(w.sql) && /delete_onkontrol_json IS NULL/.test(w.sql));
  assert.ok(claim >= 0 && claim < cagri[0].yazilanSayisi, 'on kontrol claim launch sonrasina kalmis - cift is riski');
  const son = yazilan.filter((w) => /SET delete_onkontrol_json/.test(w.sql)).pop();
  const k = JSON.parse(son.params[0]);
  assert.equal(k.durum, 'running');
  assert.equal(k.jobId, 81);
  assert.equal(k.awxServerId, 2);
});

test('SG6 taze BASARILI on kontrol: silme saatinden ONCE bekler, silme aninda YALNIZ onun listesiyle siler ve listeyi tuketir', async () => {
  dbKur([[SEC, [hedef({ delete_onkontrol_json: plan({ at: '2026-10-06T19:10:00Z' }) })]]]);
  let cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 90 }; });
  let r = await poller._deleteTick(OK_ANI);
  poller.stopPoller();
  assert.equal(cagri.length, 0, '23:00 olmadan silme ya da gereksiz ikinci on kontrol baslatildi');

  const yazilan = dbKur([[SEC, [hedef({ delete_onkontrol_json: plan() })]]]);
  cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 90 }; });
  r = await poller._deleteTick(SIL_ANI);
  poller.stopPoller();
  assert.equal(r.kosan, 1);
  assert.equal(cagri[0].t.planOnly, false);
  assert.deepEqual(cagri[0].t.izinler, IZIN, 'silme on kontrolun izin listesini tasimiyor');
  const is = yazilan.find((w) => /SET delete_job_id = \$1, delete_onkontrol_json = \$2/.test(w.sql));
  assert.ok(is, 'liste silme isiyle ayni yazimda tuketilmiyor');
  assert.equal(JSON.parse(is.params[1]).kullanildi, true);
});

test('SG7 bayat / kullanilmis on kontrol ile SILINMEZ, yeni on kontrol baslar; taze suren / basarisiz on kontrolde yeni is YOK', async () => {
  for (const [o, beklenen] of [
    [{ at: '2026-10-06T16:00:00Z' }, 'plan'],
    [{ kullanildi: true }, 'plan'],
    [{ durum: 'running' }, 'yok'],
    [{ durum: 'baslatiliyor', jobId: null }, 'yok'],
    [{ durum: 'failed', izinler: [] }, 'yok'],
    [{ izinler: ['onay:A|JBoss8|H:9998', 'rm:/x'] }, 'yok'],
  ]) {
    const yazilan = dbKur([[SEC, [hedef({ delete_onkontrol_json: plan(o) })]]]);
    const cagri = [];
    poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 91 }; });
    const r = await poller._deleteTick(SIL_ANI);
    poller.stopPoller();
    assert.equal(r.kosan, 0, `gecersiz on kontrolle silindi: ${JSON.stringify(o)}`);
    assert.ok(!yazilan.some((w) => /SET status = 'deleting'/.test(w.sql)), `hedef silmeye alindi: ${JSON.stringify(o)}`);
    if (beklenen === 'plan') assert.ok(cagri.length === 1 && cagri[0].t.planOnly === true, `yeni on kontrol baslamadi: ${JSON.stringify(o)}`);
    else assert.equal(cagri.length, 0, `ayni gece gereksiz is baslatildi: ${JSON.stringify(o)}`);
  }
});

test('SG8 on kontrol launch duserse claim GERI ALINIR (sonraki tur tekrar dener) ve olay yazilir', async () => {
  const eski = plan({ at: '2026-10-05T19:45:00Z' });
  const yazilan = dbKur([[SEC, [hedef({ delete_onkontrol_json: eski })]]]);
  poller.startPoller(async () => { throw new Error('AWX 500'); });
  const r = await poller._deleteTick(SIL_ANI);
  poller.stopPoller();
  assert.equal(r.planlanan, 0);
  const geri = yazilan.find((w) => /SET delete_onkontrol_json = \$1/.test(w.sql) && w.params[0] === eski);
  assert.ok(geri, 'claim geri alinmadi - hedef on kontrol sanilip bekler');
  assert.ok(yazilan.some((w) => /INSERT INTO retirement_events/.test(w.sql) && /AWX 500/.test(String(w.params[3]))), 'hata olaya yazilmadi');
});

test('SG9 gercek silme launcher\'i izin listesi olmadan BASLATMAZ; on kontrol plan_only=true gider', () => {
  const ln = dilim("require('./poller.cjs').startPoller(", 'SONLANDIRICI');
  const kapi = ln.indexOf("if (!t.planOnly && !(Array.isArray(t.izinler) && t.izinler.length))");
  assert.ok(kapi > 0, 'launcher izinsiz gercek silmeyi reddetmiyor');
  assert.ok(kapi < ln.indexOf('DELETE_REGISTRY_KEY'), 'kapi launch sonrasinda');
  assert.match(ln, /plan_only: !!t\.planOnly, \.\.\.\(t\.planOnly \? \{\} : \{ izinler: t\.izinler \}\)/);
});

test('SG10 on kontrol sonucu (zamanlayici): biten is listeyi ve izinleri yazar; bitmeyen / okunamayan dokunulmaz', async () => {
  const kayit = JSON.stringify({ jobId: 70, at: '2026-10-06T19:00:00Z', durum: 'running', kaynak: 'zamanlayici' });
  const satir = [{ id: 9, record_id: 4, host: 'H', app_name: 'A', delete_onkontrol_json: kayit, rollback_onkontrol_json: null }];
  const sonuc = { line: 'RESULT\tdelete\tPLAN\tPLAN', onkontrol: ['ONKONTROL\tdosya\t/x\tSILINECEK'], izinler: IZIN };
  let yazilan = dbKur([['delete_onkontrol_json LIKE', satir]]);
  poller.startPoller(async () => ({ jobId: 1 }), async (kind, t) => {
    assert.equal(kind, 'delete'); assert.equal(t.job_id, 70);
    return { terminal: true, ok: false, awxStatus: 'successful', sonuc };
  });
  let r = await poller._onKontrolTick();
  poller.stopPoller();
  assert.equal(r.kapanan, 1);
  const w = yazilan.find((x) => /SET delete_onkontrol_json = \$1/.test(x.sql));
  assert.ok(w && /AND delete_onkontrol_json = \$3/.test(w.sql), 'sonuc kosulsuz yaziliyor (yaris)');
  const k = JSON.parse(w.params[0]);
  assert.equal(k.durum, 'ok'); assert.deepEqual(k.izinler, IZIN); assert.equal(k.kaynak, 'zamanlayici');
  for (const fin of [async () => ({ terminal: false, awxStatus: 'running' }), async () => { throw new Error('AWX yok'); }]) {
    yazilan = dbKur([['delete_onkontrol_json LIKE', satir]]);
    poller.startPoller(async () => ({ jobId: 1 }), fin);
    r = await poller._onKontrolTick();
    poller.stopPoller();
    assert.equal(r.kapanan, 0);
    assert.ok(!yazilan.some((x) => /SET delete_onkontrol_json/.test(x.sql)), 'bitmemis / okunamayan on kontrol sonuclandirildi');
  }
  const tick = fs.readFileSync(path.join(__dirname, '..', 'poller.cjs'), 'utf8');
  const tk = tick.slice(tick.indexOf('async function tick('), tick.indexOf('function startPoller('));
  assert.ok(tk.indexOf('onKontrolTick()') > 0 && tk.indexOf('onKontrolTick()') < tk.indexOf('deleteTick(now)'), 'on kontrol sonucu silme turundan ONCE okunmuyor');
});

test('SG11 GERI AL: onay yalniz hazir on kontrolle; izin listesi CLAIM ile tuketilir (launch ONCESI), launch duserse geri verilir', () => {
  const ep = dilim("router.post('/:id/targets/:tid/rollback'", '// Is durumu: bitince');
  const kapi = ep.indexOf('if (confirmed && !gok?.hazir)');
  const claim = ep.indexOf("SET status = 'rolling_back', rollback_job_id = NULL, result_text = NULL, rollback_onkontrol_json = $1");
  const ln = ep.indexOf('r = await launch(');
  assert.ok(kapi > 0, 'onay kapisi yok');
  assert.ok(claim > kapi && claim < ln, 'liste ve hedef durumu launch ONCESI tek kosullu yazimla claim edilmiyor (cift onay / silme ile yaris)');
  assert.match(ep.slice(claim, ln), /WHERE id = \$2 AND status = \$3 AND rollback_onkontrol_json = \$4`,\s+\[kullanildi, tid, t\.status, hamOk\]/, 'claim durum + liste kosullu degil');
  // Onay ekranda GORULEN on kontrole bagli (bagimsiz inceleme 2026-10-22): arada biten baska bir liste onaylanmaz.
  assert.match(ep, /const gorulen = Number\(req\.body\?\.onKontrolJobId\);/);
  assert.match(ep, /onKontrolGecerli\(hamOk, 'rollback', \{ jobId: gorulen \}\)/, 'onay gorulen on kontrol isine bagli degil');
  assert.match(ep, /\.\.\.\(confirmed \? \{ izinler \} : \{\}\)/, 'onayli geri almaya izin listesi gitmiyor');
  assert.match(ep, /if \(confirmed\)\s+await db\(\)\.query\(\s*`UPDATE retirement_targets SET status = \$1, rollback_onkontrol_json = \$2, updated_at = GETUTCDATE\(\)\s+WHERE id = \$3 AND status = 'rolling_back' AND rollback_job_id IS NULL AND rollback_onkontrol_json = \$4`,\s+\[t\.status, hamOk, tid, kullanildi\],\s+\);\s+throw e;/, 'launch duserse durum ve liste geri verilmiyor');
  assert.match(ep, /SET rollback_job_id = \$1, rollback_onkontrol_json = \$3, updated_at = GETUTCDATE\(\) WHERE id = \$2 AND status = 'rolling_back'`/, 'is numarasi kosulsuz yaziliyor');
  // On kontrol yolu suren geri almanin kaydini EZMEZ ve rollback_job_id'ye dokunmaz.
  assert.match(ep, /SET rollback_onkontrol_json = \$3, updated_at = GETUTCDATE\(\) WHERE id = \$2 AND status = \$1`,\s+\[t\.status, tid, onKontrolBasladi\(r\.jobId,/, 'on kontrol kaydi durum kosulsuz yaziliyor');
  assert.match(ep, /Geri alma ön kontrolü zaten sürüyor/, 'suren on kontrolun ustune ikincisi baslatilabiliyor');
});

test('SG12 job-status: hedefin silme / geri alma on kontrol isi ayni AWX sunucusundaysa sonucu YALNIZ kendi kaydina yazar', () => {
  const js = dilim("router.get('/:id/targets/:tid/job-status", '// ── POLLER');
  assert.match(js, /\['rollback', 'rollback_onkontrol_json', 'app_retirement_rollback_result'\]/);
  assert.match(js, /\['delete', 'delete_onkontrol_json', 'app_retirement_delete_result'\]/);
  assert.match(js, /o\.awxServerId == null \|\| Number\(o\.awxServerId\) === serverId/, 'baska AWX sunucusundaki ayni numarali is karisabilir');
  assert.match(js, /if \(o\.durum === 'running'\)/, 'bitmis on kontrol yeniden yaziliyor');
  assert.match(js, /WHERE id = \$2 AND \$\{alan\} = \$3`/, 'sonuc kosulsuz yaziliyor');
  assert.ok(js.indexOf("} else if (TERMINAL.has(statusInfo.status)) {") > js.indexOf('okTur) {'), 'on kontrol isi STOP sonuclandirmasina da giriyor');
});

test('SG13 elle silme on kontrolu: yalniz durdurulmus hedefte, plan_only=true, hicbir durum degistirmez', () => {
  const ep = dilim("router.post('/:id/targets/:tid/delete-plan'", '\n  });\n');
  assert.match(ep, /t\.status !== 'stopped' \|\| t\.deletedAt/);
  assert.match(ep, /plan_only: true/);
  assert.ok(!/izinler/.test(ep.slice(ep.indexOf('await launch('), ep.indexOf('DELETE_REGISTRY_KEY'))), 'on kontrole izin listesi gidiyor');
  assert.ok(!/SET status/.test(ep), 'on kontrol hedef durumunu degistiriyor');
  assert.match(ep, /Silme ön kontrolü zaten sürüyor/);
});

test('SG15 ekran: "Geri aktif et" once ON KONTROLU baslatir; onay dugmesi yalniz hazir listeyle acik; iptal+geri al da on kontrolden gecer', () => {
  const TAB = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementTab.tsx'), 'utf8');
  assert.match(TAB, /onClick=\{\(\) => rollback\(t, false\)\}[^\n]*> Geri aktif et<\/button>/, '"Geri aktif et" on kontrolsuz onay penceresi aciyor');
  assert.match(TAB, /disabled=\{!geriAlHazir\(gt\) \|\| !geriAlinabilir\(gt\) \|\| busy != null\} onClick=\{\(\) => rollback\(gt, true, k\?\.jobId \?\? null\)\}/, 'onay dugmesi listesiz / gecersiz durumda acik ya da gorulen on kontrol gonderilmiyor');
  // Bekleyen kuyrugu BASLATILAN isin sonucunu bekler; on kontrol baslatmak acik pencereyi kapatmaz.
  assert.match(TAB, /\(b\.jobId != null && k\.jobId !== b\.jobId\) \|\| onKontrolSuruyor\(k\)/, 'kuyruk eski kayitla acilabiliyor');
  assert.match(TAB, /if \(confirmed\) setGeriAl\(null\);/, 'on kontrol baslatmak acik onay penceresini kapatiyor');
  assert.match(TAB, /for \(const t of durdurulmus\) if \(await rollback\(t, false\)\) basladi \+= 1;/, 'iptal + geri al kac hedefin basladigini saymiyor');
  assert.match(TAB, /<OnKontrolGorunumu satirlar=\{k\?\.onkontrol\} hazir=\{geriAlHazir\(gt\)\} kip="geri-al"/, 'geri alma penceresinde liste yok');
  assert.match(TAB, /for \(const t of durdurulmus\) if \(await rollback\(t, false\)\)/, 'iptal + geri al on kontrolsuz onay gonderiyor');
  assert.ok(!/rollback\(t, true\)/.test(TAB), 'ekranda on kontrolsuz onayli geri alma cagrisi kaldi');
  assert.match(TAB, /kip="silme"/, 'silme listesi ekranda gosterilmiyor');
  assert.match(TAB, /retirementApi\.deletePlan\(id, t\.id\)/, 'elle silme on kontrolu yok');
});

test('SG14 hedef satiri silme listesini zamanlayiciyla AYNI tazelikle, geri alma listesini gorunum olarak dondurur', () => {
  const rt = dilim('function rowTarget(t) {', '\n}\n');
  assert.match(rt, /silmeOnKontrol: onKontrolGorunum\(t\.delete_onkontrol_json, 'delete', \{ maxYasDk: _sched\.silmePlanTazeDk\(\) \}\)/);
  assert.match(rt, /geriAlOnKontrol: onKontrolGorunum\(t\.rollback_onkontrol_json, 'rollback'\)/);
  const g = so.onKontrolGorunum(plan({ kullanildi: true }), 'delete');
  assert.equal(g.hazir, false); assert.deepEqual(g.izinler, []);
  assert.equal(so.onKontrolGorunum(plan(), 'delete').hazir, true);
});
