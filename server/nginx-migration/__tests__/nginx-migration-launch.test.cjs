// server/nginx-migration/__tests__/nginx-migration-launch.test.cjs
// "Tanim olustur": extra_vars sozlesmesi (playbook girdi kapisiyla ayni) ve anti-tamper.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExtraVars, validateRequest, isDefinitionConfirmed } = require('../index.cjs');
const fs = require('node:fs');
const path = require('node:path');

// 2026-09-23 (job 3343114): env/action/app_type ARTIK GONDERILIR. Eskiden "playbook sabitler"
// deniyordu; ama playbook'un girdi dogrulama play'inde bu degiskenlerin play vars'i yok ve AWX
// survey VARSAYILANLARINI extra_vars'a koyuyor - is "env prod degil" diye ilk gorevde dusuyordu.
test('extra_vars: playbookun bekledigi 4 alan + akis sabitleri + requester', () => {
  const v = buildExtraVars({
    service: 'glomo', application: 'base-app-v0', namespace: 'digital-banking-ch-prod', inputPath: '/base/',
    user: { displayName: 'Onur Demir', username: 'odemir', email: 'o@x' },
  });
  assert.deepEqual(v, {
    service: 'GLOMO', application: 'base-app-v0', namespace: 'digital-banking-ch-prod', input_path: '/base/',
    env: 'prod', action: 'create', app_type: 'spa', migration_mode: true,
    requester_name: 'Onur Demir', requester_email: 'o@x',
    fetch_package: false, ocp_cluster: '', pod_webroot: '',
    apply_now: false, migration_template_id: null,
  });
  // Playbook'un kapisi (assert) bu degerleri bekler; survey varsayilani karisirsa is duser.
  assert.equal(v.env, 'prod');
  assert.equal(v.action, 'create');
  assert.equal(v.app_type, 'spa');
});

// MG4 (2026-09-26): "Paketi getir" secilmediyse cekme ALANLARI DA GONDERILIR, bos olarak.
// Sebep yukaridakiyle ayni: gondermezsek AWX survey varsayilani devreye girer ve kimsenin
// istemedigi bir paket cekme baslar. Bos deger, varsayilani EZER.
test('MG4 paket cekme alanlari: istenmediginde bos GONDERILIR, istendiginde dolar', () => {
  const kapali = buildExtraVars({ service: 'glomo', application: 'a', namespace: 'n', inputPath: '/x/', user: {} });
  assert.equal(kapali.fetch_package, false);
  assert.equal(kapali.ocp_cluster, '');
  assert.ok('fetch_package' in kapali, 'alan hic gonderilmezse survey varsayilani devreye girer');

  const acik = buildExtraVars({
    service: 'glomo', application: 'a', namespace: 'n', inputPath: '/x/', user: {},
    fetchPackage: true, ocpCluster: 'gbocp3rdprod1', podWebroot: '/app/dist',
  });
  assert.equal(acik.fetch_package, true);
  assert.equal(acik.ocp_cluster, 'gbocp3rdprod1');
  assert.equal(acik.pod_webroot, '/app/dist');

  // Cekme KAPALIYKEN cluster/webroot sizmamali: playbook bu alanlara bakarak karar verir.
  const sizinti = buildExtraVars({
    service: 'glomo', application: 'a', namespace: 'n', inputPath: '/x/', user: {},
    fetchPackage: false, ocpCluster: 'gbocp3rdprod1', podWebroot: '/app/dist',
  });
  assert.equal(sizinti.ocp_cluster, '');
  assert.equal(sizinti.pod_webroot, '');
});

// MG7 (2026-09-26): 23:00 KESINTI PENCERESI. Yeni Ankara sunuculari (GBNGXAP3x) artik
// CANLI trafik tasiyor, yani tasima da PROD kuralina tabi. Portal isi ANINDA uygulatmaz:
// apply_now=false gonderir, playbook kendini 23:00'e zamanlar.
test('MG7 pencere: apply_now ACIKCA false gider, template id tahmin edilmez', () => {
  const v = buildExtraVars({
    service: 'glomo', application: 'a', namespace: 'n', inputPath: '/x/', user: {}, templateId: 412,
  });
  // Alani hic gondermezsek AWX survey varsayilani devreye girip aninda uygulamaya duserdi.
  assert.ok('apply_now' in v, 'apply_now hic gonderilmiyor: survey varsayilani devreye girer');
  assert.equal(v.apply_now, false);
  // Playbook hangi template'i zamanlayacagini TAHMIN ETMEMELI: isim aramasi iki
  // template'de yanilir, yanlis is zamanlanir.
  assert.equal(v.migration_template_id, 412);

  // Template tanimli degilse null gider ve playbook'un girdi kapisi bunu REDDEDER -
  // sessizce 0 ya da '' gondermek yanlis template'i zamanlama riski yaratirdi.
  const yok = buildExtraVars({ service: 'glomo', application: 'a', namespace: 'n', inputPath: '/x/', user: {} });
  assert.equal(yok.migration_template_id, null);

  // Sunucu kodu template id'sini YAPILANDIRMADAN almali, istekten DEGIL.
  const fs = require('node:fs');
  const path = require('node:path');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(srv, /templateId: cfg\.templateId/, 'template id yapilandirmadan gelmiyor');
  assert.ok(!/templateId: req\.body/.test(srv), 'template id istemciden aliniyor (anti-tamper)');
});

// MG5: cluster TAHMIN EDILMEZ. Playbook'un cekme play'i `name == ocp_cluster` ile suzulur;
// yanlis ya da belirsiz bir deger verirsek hicbir jump server kosmaz ve is "paket gelmemis"
// halde YESIL biter. Belirsizlikte cekmeyi hic baslatmamak dogru davranistir.
test('MG5 cluster cozumu: tek sonuc secilir, belirsiz/yok ise secilmez', async () => {
  const mig = require('../index.cjs');
  const path = require('node:path');
  const mssqlPath = require.resolve('../../inventory/mssql.cjs');
  const onceki = require.cache[mssqlPath];
  const sahte = (rows) => ({
    exports: {
      sql: { NVarChar: () => 'nvarchar' },
      query: async () => ({ recordset: rows }),
    },
    id: mssqlPath, filename: mssqlPath, loaded: true, paths: [], children: [],
  });
  try {
    require.cache[mssqlPath] = sahte([{ cluster: 'gbocp3rdprod1' }]);
    assert.equal((await mig.resolveCluster('n', 'a')).cluster, 'gbocp3rdprod1');

    require.cache[mssqlPath] = sahte([{ cluster: 'gbocp3rdprod1' }, { cluster: 'giocp3rdprod2' }]);
    const iki = await mig.resolveCluster('n', 'a');
    assert.equal(iki.cluster, null, 'iki cluster varsa birini SECMEK tahmin olurdu');
    assert.equal(iki.clusters.length, 2, 'kullaniciya hangileri oldugu soylenebilmeli');

    require.cache[mssqlPath] = sahte([]);
    assert.equal((await mig.resolveCluster('n', 'a')).cluster, null);

    // Bos/bosluklu cluster degeri "bulundu" sayilmamali.
    require.cache[mssqlPath] = sahte([{ cluster: '   ' }]);
    assert.equal((await mig.resolveCluster('n', 'a')).cluster, null);
  } finally {
    if (onceki) require.cache[mssqlPath] = onceki;
    else delete require.cache[mssqlPath];
    void path;
  }
});

const groups = [{
  id: 'glomo',
  newHosts: ['GBNGXP40'],
  apps: [
    { namespace: 'digital-banking-ch-prod', application: 'base-app-v0', status: 'partial',
      paths: [{ service: 'GLOMO', location: '/base/', hosts: ['GBRVPP07'] }, { service: 'GLOMO', location: '/base2/', hosts: ['GBRVPP08'] }] },
    { namespace: 'glomo-prod', application: 'eksik-app-v1', status: 'missing', paths: [{ service: 'GLOMO', location: '/e/', hosts: [] }] },
    { namespace: 'glomo-prod', application: 'ns-app-v1', status: 'not-scanned', paths: [{ service: 'GLOMO', location: '/n/', hosts: [] }] },
  ],
}];

test('anti-tamper: yalnizca tasima gorunumundeki (grup, ns, app, servis, location) kabul edilir', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'glomo', inputPath: '/base2/' });
  assert.equal(r.ok, true);
  assert.equal(r.path.location, '/base2/');
  r = validateRequest(groups, { group: 'other', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'GLOMO', inputPath: '/base/' });
  assert.equal(r.ok, false); // yanlis grup
  r = validateRequest(groups, { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'GLOMO', inputPath: '/uydurma/' });
  assert.equal(r.ok, false); // listede olmayan location
  r = validateRequest(groups, { group: 'glomo', namespace: 'hayalet', application: 'x', service: 'GLOMO', inputPath: '/base/' });
  assert.equal(r.ok, false); // listede olmayan uygulama
});

test('deploy edilmemis (missing) ve taranmamis uygulama icin job KOSTURULMAZ (409, acik mesaj)', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/e/' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.message, /deploy/);
  r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'ns-app-v1', service: 'GLOMO', inputPath: '/n/' });
  assert.equal(r.status, 409);
  assert.match(r.message, /taranmadı/);
});

// ── Gecis takibi (2026-09-14): planlandi / gecti / iptal + tarihler ─────────────────
const { normalizeTracking, rowToTracking } = require('../index.cjs');

test('takip kaydi: durumlar ve tarih zorunluluklari', () => {
  const ok = normalizeTracking({ group: 'glomo', namespace: 'Glomo-Prod', application: 'X-App-V1', state: 'planned', plannedDate: '2026-09-20', note: ' oco 1234 ' });
  assert.deepEqual(ok, { group: 'glomo', namespace: 'glomo-prod', application: 'x-app-v1', state: 'planned', plannedDate: '2026-09-20', migratedDate: null, note: 'oco 1234' });
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'planned' }), /planlanan tarih/i);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'migrated' }), /gecis tarihi/i);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'migrated', migratedDate: '20.09.2026' }), /YYYY-AA-GG/);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'bilinmez' }), /Gecersiz durum/);
  assert.throws(() => normalizeTracking({ group: '', namespace: 'a', application: 'b' }), /zorunlu/);
  // durum 'none' tarihsiz olabilir; not 500 ile kesilir
  const n = normalizeTracking({ group: 'g', namespace: 'a', application: 'b', note: 'x'.repeat(600) });
  assert.equal(n.state, 'none');
  assert.equal(n.note.length, 500);
});

test('DB satiri -> API sekli (tarihler YYYY-AA-GG, Date nesnesi de string de olsa)', () => {
  const r = rowToTracking({ group_id: 'glomo', namespace: 'ns', application: 'app', state: 'migrated', planned_date: new Date('2026-09-20T00:00:00Z'), migrated_date: '2026-09-25', note: null, config_job_id: '77', config_created_at: '2026-09-14T10:00:00Z', updated_at: null });
  assert.equal(r.plannedDate, '2026-09-20');
  assert.equal(r.migratedDate, '2026-09-25');
  assert.equal(r.configJobId, 77);
  assert.equal(r.updatedAt, null);
});

// ── Eski sunucudan silme (2026-09-14): nginx_ops action=delete env=prod ─────────────
const { buildDeleteExtraVars } = require('../index.cjs');

test('silme extra_vars: nginx_ops sozlesmesi (action=delete, env=prod, service, input_path, email)', () => {
  const v = buildDeleteExtraVars({ service: 'glomo', inputPath: '/base/', user: { displayName: 'Onur', username: 'od', email: 'o@x' } });
  assert.deepEqual(v, { action: 'delete', env: 'prod', service: 'GLOMO', input_path: '/base/', email: 'o@x', requester_name: 'Onur', requester_email: 'o@x' });
});

test('silme dogrulamasi: yeni sunucu hazirligi ONEMSIZ (eksik/taranmadi satir da silinebilir), listede olmayan yine reddedilir', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/e/' }, { ignoreStatus: true });
  assert.equal(r.ok, true);
  r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/yok/' }, { ignoreStatus: true });
  assert.equal(r.ok, false);
});

// ── Job izleme + ekrana yansima (2026-09-18) ────────────────────────────────────────
// launchJobOnServer { jobId, status } dondurur; onceki kod job.id okuyup damgayi NULL
// birakiyordu. Simdi jobShape ile { id, status, awxServerId }; job-status ucu terminal
// durumu takip tablosuna isler; /tracking canli job'lari AWX'ten uzlastirir.
test('JT1 jobShape: launchJobOnServer ciktisindan id/status/awxServerId', () => {
  const { jobShape } = require('../index.cjs');
  assert.deepEqual(jobShape({ jobId: 4242, status: 'pending' }, 3), { id: 4242, status: 'pending', awxServerId: 3 });
  assert.deepEqual(jobShape(null, 3), { id: null, status: 'pending', awxServerId: 3 });
});

test('JT2 syncJobStatusToTracking: config_job_id ve delete_job_id eslesen satirlar, terminalde bitis zamani', async () => {
  const { syncJobStatusToTracking } = require('../index.cjs');
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await syncJobStatusToTracking(db, 77, 'successful');
  // 2026-09-23: YOL BAZLI kayit da guncellenir (dugmenin pasif olmasi ona bakar), bu yuzden
  // sorgular SIRAYA degil ICERIGE gore aranir - yeni bir tablo eklenince test kirilmasin.
  const find = (re) => calls.find((c) => re.test(c.sql));
  assert.equal(calls.length, 3);
  const cfg = find(/config_job_status = \$2/);
  assert.ok(cfg, 'tracking config_job_status guncellenmedi');
  assert.match(cfg.sql, /config_job_finished_at = COALESCE/);
  assert.deepEqual(cfg.params, [77, 'successful']);
  assert.ok(find(/delete_job_status = \$2/), 'tracking delete_job_status guncellenmedi');
  const pathq = find(/nginx_migration_path_jobs/);
  assert.ok(pathq, 'yol bazli job kaydi guncellenmedi');
  assert.match(pathq.sql, /finished_at = COALESCE/);
  calls.length = 0;
  await syncJobStatusToTracking(db, 77, 'running');
  for (const c of calls) assert.doesNotMatch(c.sql, /finished_at = COALESCE/); // canli durumda bitis yazilmaz
  calls.length = 0;
  await syncJobStatusToTracking(db, null, 'running');
  assert.equal(calls.length, 0);
});

test('JT3 kaynak sozlesme: job.id okunmaz, job-status ucu var, /tracking uzlastirir, kolonlar seed\'de', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.doesNotMatch(src, /job\?\.id \|\| null/);
  assert.match(src, /router\.get\('\/job-status\/:jobId'/);
  assert.match(src, /config_job_status IS NULL OR config_job_status IN \('pending','waiting','running','new'\)/);
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const c of ['config_job_status', 'config_job_finished_at', 'config_service', 'config_location', 'delete_job_status']) {
    assert.match(setup, new RegExp(`ALTER TABLE nginx_migration_tracking ADD ${c} `), `${c} kolonu seed'de yok`);
  }
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(ui, /useJobTracker/);
  assert.match(ui, /trackMigrationJob\(/);
  assert.match(ui, /configJobStatus === 'successful'/);
});

// 2026-09-23 (kullanici): "tasinan uygulamalar icin bir daha tanim olusturma dugmesi aktif
// olmasin. Ama unutma ANCAK VE ANCAK tanimlama jobu basarili bittiyse VE bir sonraki
// veritabani dongusunde tanimin gercekten yapildigini goruyorsan."
test('MG1 tanim dogrulama: IKI kanit birden (job successful + tarama defined)', () => {
  assert.equal(isDefinitionConfirmed({ status: 'successful' }, 'defined'), true, 'ikisi de varken pasif olmali');

  // Tek basina hicbiri yetmez:
  assert.equal(isDefinitionConfirmed(null, 'defined'), false, 'job kaydi yokken (elle yazilmis olabilir) dugme ACIK kalmali');
  assert.equal(isDefinitionConfirmed({ status: 'successful' }, 'partial'), false, 'tarama YALNIZ BAZI sunucularda gormus');
  assert.equal(isDefinitionConfirmed({ status: 'successful' }, 'none'), false, 'tarama tanimi hic gormemis');
  assert.equal(isDefinitionConfirmed({ status: 'successful' }, 'not-scanned'), false, 'yeni sunucular taranmamis');
  assert.equal(isDefinitionConfirmed({ status: 'failed' }, 'defined'), false, 'job dusmus');
  assert.equal(isDefinitionConfirmed({ status: 'running' }, 'defined'), false, 'job hala kosuyor');
  assert.equal(isDefinitionConfirmed({ status: null }, 'defined'), false, 'durum bilinmiyor');
});

test('MG2 sozlesme: sunucu kapisi ve ekran AYNI kurali uygular', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  // Sunucu: create ucu, dogrulanmis yol icin 409 doner (bayat sekme / dogrudan istek).
  assert.ok(/isDefinitionConfirmed\(\(pj\.rows \|\| \[\]\)\[0\] \|\| null, v\.path\.newStatus\)/.test(srv), 'create ucunda kapi yok');
  assert.ok(/status\(409\)/.test(srv), 'tekrar tetiklemede 409 donmeli');
  // Yol basina kayit tutulmali (uygulama basina tek satir cok yollu uygulamada yetmez).
  assert.ok(/nginx_migration_path_jobs/.test(srv), 'yol bazli job kaydi yok');

  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  // TANIMLI SAYILMA OLCUTU TARAMADIR (2026-09-26, kullanici: "tanimli uygulamalarda
  // 'Tanim olustur' butonu aktif"). Job kaydi SART KOSULURSA elle ya da baska akisla
  // acilmis tanimlar "tanimsiz" gorunur ve ustune bir kez daha yazilir.
  assert.ok(/const isPathDefined = \(p: \{ newStatus\?: string \| null \}\) => p\.newStatus === 'defined'/.test(ui),
    'ekranda tarama temelli kural yok');
  assert.ok(/const isDefinitionConfirmed = \(job: MigrationPathJob \| undefined, newStatus/.test(ui), 'ekranda kural yok');
  assert.ok(/disabled=\{!canCreate \|\| allDone/.test(ui), 'dugme tanimli satirda pasif degil');
  assert.ok(/isPathDefined\(pp\) \|\| isDefinitionConfirmed/.test(ui), 'toplu secim tanimli yollari atlamiyor');
  assert.ok(/'Tanımlı' : 'Tanım oluştur'/.test(ui), 'pasif dugme neden pasif oldugunu soylemeli');
  // Sunucu: tarama tanimli diyorsa 409; force ile bilincli yeniden olusturma acik kalir.
  assert.ok(/!force && p\.newStatus === 'defined'/.test(srv), 'sunucu kapisi tarama temelli degil');
  assert.ok(/force ile gönderin/.test(srv), 'yeniden olusturma yolu belgelenmeli');

  const ddl = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.ok(/CREATE TABLE nginx_migration_path_jobs/.test(ddl), 'tablo seed edilmemis');
  assert.ok(/UQ_nginx_migration_path UNIQUE \(group_id, namespace, application, service, location\)/.test(ddl), 'yol basina tekillik yok');
});

// BULK1 (2026-09-24, kullanici: "toplu uygulama secip gecis tarihi ve planlama tarihi
// girebilmek istiyorum"). Toplu uc, YARIM UYGULAMA birakmamali: bir ogede dogrulama
// hatasi varsa HICBIRI yazilmaz - aksi halde kullanici hangi kaydin gecтigini bilemez.
test('BULK1 toplu takip ucu: once tumu dogrulanir, sonra yazilir; sinir ve denetim kaydi', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /router\.put\('\/tracking\/bulk'/, 'toplu uc yok');
  assert.match(src, /BULK_MAX = \d+/, 'toplu istege ust sinir konmali');
  // dogrulama dongusu YAZMA dongusunden ONCE gelmeli
  const iValidate = src.indexOf('norm.push(normalizeTracking(');
  const iWrite = src.indexOf('written.push(it)');
  assert.ok(iValidate > 0 && iWrite > iValidate, 'once TUM ogeler dogrulanmali, sonra yazilmali');
  assert.match(src, /nginx_prod_migration_track_bulk/, 'toplu islem denetim kaydina girmeli');
});

// BULK2: ekran sozlesmesi - secim kutulari, islem cubugu, toplu modal ve "ustune yazilir" uyarisi.
test('BULK2 ekran: satir secimi, toplu cubuk, onay listesi ve uzerine yazma uyarisi', () => {
  const page = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(page, /function BulkTrackingModal/, 'toplu modal yok');
  assert.match(page, /Toplu geçiş takibi gir/, 'toplu islem dugmesi yok');
  assert.match(page, /saveBulk\(/, 'toplu uc cagrilmiyor');
  assert.match(page, /Seçimi temizle/, 'secimi temizleme yok');
  assert.match(page, /el\.indeterminate/, 'kismi secimde baslik kutusu belirsiz gorunmeli');
  // yikici davranis EKRANDA yazmali: not bos birakilirsa mevcut notlar silinir
  assert.match(page, /mevcut notlar silinir/, 'uzerine yazma uyarisi yok');
  assert.match(page, /Bu \{apps\.length\} uygulamaya yazılacak/, 'yazilacak uygulama listesi gosterilmiyor');
});

// VIS1 (2026-09-24, kullanici: "gecis yapildi diye isaretlemezsem sunucuda tanim olup
// olmadigi gorunmuyor gibi; tik/carpi daha gorunur olsun").
// Sozlesme: "yeni sunucularda tanimli mi" sutunu TARAMADAN gelir (newStatus), elle takip
// (planlandi/gecti) bu karari ETKILEMEZ; durum ayri bir sutunda rozet olarak durur, ayrica
// suzgec ve CSV'de yer alir.
test('VIS1 ekran: yeni sunuculardaki tanim durumu TARAMADAN gelir, ayri sutun/suzgec/CSV', () => {
  const page = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(page, /function newSideStatus/, 'ozet durum fonksiyonu yok');
  // karar YALNIZ newStatus'a bakar; tracking/state'e bakmamali
  const fn = page.slice(page.indexOf('function newSideStatus'), page.indexOf('const NEW_SIDE'));
  assert.ok(!/tracking|trackOf|\.state\b/.test(fn), 'durum elle takipten etkilenmemeli');
  assert.match(fn, /newStatus === 'defined'/);
  assert.match(page, /Yeni sunucularda<\/th>/, 'ayri sutun yok');
  assert.match(page, /sideFilter/, 'taramaya gore suzgec yok');
  assert.match(page, /'yeni_sunucularda'/, 'CSV sutunu yok');
  // "taranmadi" ile "yok" AYRI kalmali
  assert.match(page, /TARANMADI/);
  assert.ok(page.includes('"yok" demek DEĞİLDİR'), 'taranmadi ile yok ayrimi aciklanmali');
});

// RS1 (2026-09-24, kullanici: "yeni gelen uygulamalar tasimalarda direkt gozuksun").
// Ekran verisi nginx_config_audit taramasindan gelir ve o is gunde bir kosar. Portal artik
// ayni isi target_hosts ile ANINDA kosturabiliyor - kendi "beklemede" kaydini UYDURMUYOR,
// tek dogruluk kaynagi yine tarama.
test('RS1 tarama tazeleme: uc, katalog kaydi ve ekran dugmesi', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /router\.post\('\/rescan'/, 'tazeleme ucu yok');
  assert.match(src, /AUDIT_KEY = 'nginx_config_audit'/, 'katalog anahtari yok');
  assert.match(src, /target_hosts/, 'yalniz secili sunucular taranmali');
  assert.match(src, /assertTemplateAcceptsExtraVars/, 'template on kontrolu yok');

  const setup = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(setup, /key_name: 'nginx_config_audit'/, 'katalog kaydi seed edilmemis');
  assert.match(setup, /NGINX_CONFIG_AUDIT_TEMPLATE_ID/, 'env_var adi yok');

  const page = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(page, /Taramayı tazele/, 'ekranda tazeleme dugmesi yok');
  assert.match(page, /nginxMigrationScanApi\.rescan/, 'dugme ucu cagirmiyor');
  // yalniz o grubun sunuculari taranmali (tum filo degil)
  assert.match(page, /\[\.\.\.grp\.oldHosts, \.\.\.grp\.newHosts\]/, 'tarama grubun sunucularina daraltilmali');
});

// BC1 (2026-09-24, kullanici (a) secenegi): "secilenlerden HAZIR olanlar icin toplu tanim
// olustur". Yeni sunuculara tanim, uygulama ORAYA DEPLOY EDILMEDEN yazilamaz (SPA akisi
// "once deploy ediniz" ile durur); bu yuzden toplu islem hazir olmayani DENEMEZ, atlar ve
// NEDENINI yazar - aksi halde islerin cogu bosuna kirmizi biterdi.
test('BC1 toplu tanim olusturma: hazir olmayan ATLANIR, sebebi yazilir, isler sirayla', () => {
  const page = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  const plan = page.slice(page.indexOf('const bulkPlan'), page.indexOf('const runBulkCreate'));
  assert.match(plan, /status === 'missing'/, 'deploy edilmemis uygulama atlanmali');
  assert.match(plan, /status === 'not-scanned'/, 'taranmamis uygulama atlanmali');
  assert.match(plan, /deploy edilmemiş/, 'atlama sebebi yazilmali');
  assert.match(plan, /isDefinitionConfirmed/, 'zaten tanimli yol tekrar olusturulmamali');
  // sirayla: paralel Promise.all DEGIL, for dongusu icinde await
  const run = page.slice(page.indexOf('const runBulkCreate'), page.indexOf('const loadTracking'));
  assert.ok(!/Promise\.all/.test(run), 'isler sirayla baslatilmali (AWX/nginx bosuna yorulmasin)');
  assert.match(run, /for \(const it of bulkPlan\.yapilacak\)/);
  assert.match(page, /Seçilenler için tanım oluştur/, 'cubukta dugme yok');
});

test('MG3 yeniden olustur: ekranda ACIK bir yol var ve uyari veriyor', () => {
  // Kullanici (2026-09-26): "bozuk tanimi duzeltmek icin ekrana da 'yeniden olustur'
  // ekler misin". Sunucu tarafi zaten force'u kabul ediyordu; ekranda karsiligi olmayinca
  // bozuk bir tanimi duzeltmenin yolu yoktu.
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  // Dugme YALNIZ tanimli satirda cikmali (kazara tetiklenmesin).
  assert.match(ui, /\{allDone && canCreate && \(/, 'yeniden olustur yalniz tanimli satirda gorunmeli');
  assert.match(ui, /Yeniden oluştur/, 'dugme yok');
  assert.match(ui, /onCreate\(a, true\)/, 'force gecirilmiyor');
  // Onay penceresi "yeni tanim" ile "ustune yazma"yi AYNI cumleyle anlatmamali.
  assert.match(ui, /Tanımı YENİDEN oluştur/, 'pencere basligi force durumunu soylemeli');
  assert.match(ui, /yeniden oluşturulur ve üzerine yazılır/, 'ustune yazma uyarisi yok');
  assert.match(ui, /Evet, üzerine yaz/, 'onay dugmesi ne yaptigini soylemeli');
  // force YALNIZCA kullanici sectiginde gitmeli - varsayilan istekte olmamali.
  assert.match(ui, /\.\.\.\(pending\.force \? \{ force: true \} : \{\}\)/, 'force kosulsuz gonderiliyor');
});

// MG6: ekran sozlesmesi. "Paketi getir" YALNIZ paketi olmayan satirda cikmali - hazir bir
// uygulamada cikarsa, calisan bir deployment'in uzerine pod'dan kazinmis kopya cekmeyi
// teklif etmis oluruz (playbook 71 ile durdurur ama dugmeyi hic gostermemek daha dogru).
test('MG6 ekran: paket getirme dugmesi yalniz eksik/kismi satirda', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(ui, /a\.status === 'missing' \|\| a\.status === 'partial'/,
    'dugme durum suzgeci olmadan gosteriliyor');
  assert.match(ui, /onCreate\(a, false, true\)/, 'dugme fetchPackage bayragini gondermiyor');
  assert.match(ui, /fetchPackage: true/, 'istek govdesinde fetchPackage yok');
  // Normal "Tanim olustur" akisi bayragi GONDERMEMELI.
  const normal = ui.slice(ui.indexOf('onClick={() => onCreate(a)}'), ui.indexOf('Tanım oluştur'));
  assert.ok(!/fetchPackage/.test(normal), 'normal tanim olusturma da paket cekiyor');
});
