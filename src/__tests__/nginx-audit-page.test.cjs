// src/__tests__/nginx-audit-page.test.cjs
//
// Denetim > Nginx Audit (2026-09-14): sozluk, sunucu sayfasi, ?tab= donusu.
// Kullanici bildirimi: "Atlayan / Tanimsiz / Ayar sapmasi ne demek", "sunucuya
// tiklayinca yeni sayfa acilsin". Bu kilitler kaynak metin uzerinden calisir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('sozluk kullanicinin sordugu uc terimi ve dosya uyumunu ACIKLIYOR', () => {
  const src = read('components/denetim/nginxAuditGlossary.tsx');
  for (const term of ['Atlayan', 'Tanımsız', 'Ayar sapması', 'Dosya uyumu', 'resolve yok']) {
    assert.ok(src.includes(`term: '${term}'`), `sozlukte yok: ${term}`);
  }
  // Her terimin "ne yapmali" satiri var
  const terms = (src.match(/term: '/g) || []).length;
  const actions = (src.match(/action: '/g) || []).length;
  assert.equal(actions, terms, 'her terimin bir "Ne yapmali" satiri olmali');
});

test('liste ve sunucu sayfasi AYNI sozlugu kullanir; sutun basliklari ipucu tasir', () => {
  const list = read('components/denetim/NginxAudit.tsx');
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  assert.ok(list.includes('<AuditGlossary'), 'listede sozluk yok');
  assert.ok(page.includes('<AuditGlossary'), 'sunucu sayfasinda sozluk yok');
  for (const t of ['Atlayan', 'Tanımsız', 'Ayar sapması', 'Dosya uyumu']) {
    assert.ok(list.includes(`termHint('${t}')`), `liste sutunu ipucusuz: ${t}`);
  }
});

test('sunucu satiri kendi sayfasina gider; rota tanimli; geri donus Nginx Audit sekmesine', () => {
  const list = read('components/denetim/NginxAudit.tsx');
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  const app = read('App.tsx');
  const denetim = read('components/DenetimPage.tsx');
  assert.ok(
    /hostPagePath = \(host: string\) => `\/denetim\/nginx-audit\/\$\{encodeURIComponent\(host\)\}`/.test(
      list,
    ),
  );
  // BOSLUK/SATIR SARMASI SERBEST: prettier ozellikleri alt alta yazdiginda bu
  // birebir dize eslesmesi kiriliyor. Olculen sey BICIM degil KURAL: sunucu adi
  // gercek bir <Link>.
  assert.match(
    list.replace(/\s+/g, ' '),
    /<Link to=\{to\}/,
    'sunucu adi gercek bir Link olmali (yeni sekmede acilabilsin)',
  );
  assert.ok(!/onToggle|open === h\.host/.test(list), 'eski satir-ici acilir bolum kalmamali');
  assert.ok(app.includes('path="/denetim/nginx-audit/:host"'), 'App.tsx rotasi yok');
  assert.ok(
    page.includes("'/denetim?tab=nginxaudit'"),
    'geri baglantisi Nginx Audit sekmesine gitmeli',
  );
  assert.ok(denetim.includes("searchParams.get('tab')"), 'DenetimPage ?tab= okumali');
  assert.ok(
    /DENETIM_TABS\.includes\(v\) \? v : 'nginx'/.test(denetim),
    'taninmayan tab ilk sekmeye dusmeli',
  );
});

test('sunucu sayfasi bes bolumu ve dosya uyumu DDL uyarisini tasir', () => {
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  for (const s of [
    'Server blokları',
    "Location'lar (dosya başına)",
    "Upstream'ler",
    'Ayarlar — kurulum referansıyla',
    'Kurulum dosyası uyumu',
  ]) {
    assert.ok(page.includes(s), `bolum yok: ${s}`);
  }
  assert.ok(page.includes('dbo.Nginx_Audit_Files'), 'tablo yokken DDL uyarisi olmali');
  // Ortam kaynagi gorunur (BILINMIYOR sessiz degil)
  assert.ok(page.includes('envSourceHint(data.envSource)'));
});

test('Nginx SPA > Prod Tasima sekmesi bagli ve kapsam paneli o sekmede gizli', () => {
  const denetim = read('components/DenetimPage.tsx');
  assert.ok(
    denetim.includes("{ id: 'tasima', label: 'Production Taşımaları' }"),
    'Production Tasimalari secenegi yok',
  );
  assert.ok(
    denetim.includes("{tier === 'tasima' && <NginxProdMigration />}"),
    'NginxProdMigration render edilmiyor',
  );
  // 2026-09-17: kapsam cubuklari artik katlanir ayrinti (CoverageDetails); tasima sekmesinde yine gizli
  assert.ok(!denetim.includes('SpaCoverage'), 'kapsam paneli kaldirildi (2026-09-17)');
  const api = read('api/denetimApi.ts');
  assert.ok(api.includes('nginxMigration: (fresh = false)'), 'API ucu yok');
});

test('Production Tasimalari: Tanim olustur dugmesi, ekip siralamasi, H/A/C sozlugu', () => {
  const src = read('components/denetim/NginxProdMigration.tsx');
  // dugme: yapilandirma yoksa / eksik / taranmadi -> pasif; onay penceresi formlu -> arka plan tiklamasi kapali
  assert.ok(
    src.includes("disabled={!canCreate || a.status === 'missing' || a.status === 'not-scanned'}"),
  );
  assert.ok(src.includes('dismissOnBackdrop={false}'), 'onay penceresi surukleme ile kapanmamali');
  assert.ok(src.includes('nginxMigrationApi.create({'), 'launch ucu cagrilmiyor');
  // ekip siralamasi: cok uygulamasi olan ekip ustte, ekipsizler en sona
  assert.ok(src.includes('<option value="team">'), 'ekip siralamasi secenegi yok');
  assert.ok(/if \(!ta !== !tb\) return ta \? -1 : 1;/.test(src), 'ekipsizler en sona dusmeli');
  // H/A/C sozlugu ust tarafta, acik
  assert.ok(src.includes('<HacLegend defaultOpen={false} />'), 'sozluk render edilmiyor'); // tanim HacCell.tsx'te (ortak); 2026-09-17: kapali
  const hac = read('components/denetim/HacCell.tsx');
  for (const s of [
    '/hysdeploy/&lt;ns&gt;/&lt;app&gt;/',
    '/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/',
    'application-confs/&lt;app&gt;-&lt;ns&gt;.conf',
  ]) {
    assert.ok(hac.includes(s), `sozlukte yok: ${s}`);
  }
  // yonetici paneli + rota
  assert.ok(src.includes('<MigrationConfigPanel'));
  const idx = read('../server/index.cjs');
  assert.ok(
    idx.includes("require('./nginx-migration/index.cjs').initNginxMigration(app)"),
    'server modulu kayitli degil',
  );
});

test('H/A/C gosterimi ORTAK (HacCell) ve Nginx SPA matrisi de kullaniyor', () => {
  const hac = read('components/denetim/HacCell.tsx');
  assert.ok(hac.includes('export function DirCell(') && hac.includes('export function HacLegend('));
  const mig = read('components/denetim/NginxProdMigration.tsx');
  assert.ok(
    mig.includes("from './HacCell'") && !mig.includes('function DirCell('),
    'tasima sayfasi kendi kopyasini tutmamali',
  );
  const den = read('components/DenetimPage.tsx');
  assert.ok(den.includes('<DirCell f={d.flags} />'), 'matris hucresinde H/A/C yok');
  assert.ok(den.includes('<HacLegend defaultOpen={false} />'), 'matriste sozluk yok');
  const srv = read('../server/audit/denetim.cjs');
  const spa = srv.slice(
    srv.indexOf("router.get('/nginx-spa'"),
    srv.indexOf("router.get('/nginx-spa-coverage'"),
  );
  assert.ok(
    spa.includes('FROM dbo.Nginx_Intranet_Audit') &&
      spa.includes('cell.dirs = dirHostsOfCell(cell).map('),
    '/nginx-spa dizin bayraklarini eklemeli',
  );
});

test('Production Tasimalari: gecis takibi (planlandi/gecti + tarih) ve sema', () => {
  const src = read('components/denetim/NginxProdMigration.tsx');
  assert.ok(src.includes('<TrackCell t={trackOf(a)}'), 'Gecis sutunu yok');
  assert.ok(src.includes('function TrackingModal('), 'takip penceresi yok');
  assert.ok(/name="state"/.test(src) && src.includes('type="date"'), 'durum + tarih alanlari yok');
  assert.ok(src.includes('<option value="plan">'), 'gecis tarihine gore siralama yok');
  assert.ok(src.includes('value="open">geçiş: henüz geçmedi'), 'gecis suzgeci yok');
  const schema = read('../server/db/mssql-setup.cjs');
  assert.ok(
    schema.includes('CREATE TABLE nginx_migration_tracking') &&
      schema.includes('UNIQUE(group_id, namespace, application)'),
  );
  const api = read('api/nginxMigrationApi.ts');
  assert.ok(api.includes('nginxMigrationTrackingApi'));
});

test('Nginx SPA: ORTAM OZETI en ustte (SPA sayisi + envanter payi, nginx ilerlemesi, PROD yeni sunucu hazirligi, route + IP); Location Detayi / Proxy Tanimlari / ayri route paneli KALDIRILDI (2026-09-17)', () => {
  const den = read('components/DenetimPage.tsx');
  const sum = read('components/denetim/NginxSpaSummary.tsx');
  assert.ok(
    den.includes("{tier !== 'tasima' && <NginxSpaSummary tier={tier} />}"),
    'ortam ozeti internet/intranet katmaninda yok',
  );
  // 2026-09-17 (ikinci tur): "Ayrinti" katlanir kapsam paneli de kaldirildi (kafa karistiriyordu)
  assert.ok(
    !den.includes('CoverageDetails') && !den.includes('function SpaCoverage'),
    'kapsam cubuklari kaldirilmis olmali',
  );
  // eksik uygulamalar + sahiplik penceresi: hucreye tiklaninca
  for (const s of [
    'function MissingAppsModal(',
    'E-postaları kopyala',
    'rowsFromCoverage(c.missingDetail?.internet',
    'rowsFromCoverage(c.missingDetail?.intranet',
    'rowsFromMigration(mig?.groups',
  ]) {
    assert.ok(sum.includes(s), `eksik uygulama penceresi: ${s}`);
  }
  const covSrv = read('../server/audit/denetim.cjs');
  assert.ok(
    covSrv.includes('missingDetail: {') && covSrv.includes('ownersFor(owners.byNs, nss)'),
    'kapsam ucu eksik uygulamalari sahiplikle vermeli',
  );
  for (const gone of [
    '<RouteStats />',
    '<NginxLocations />',
    '<NginxProxy />',
    "label: 'Location Detayı'",
    "label: 'Proxy Tanımları (PROD)'",
  ]) {
    assert.ok(!den.includes(gone), `kaldirilmis olmali: ${gone}`);
  }
  for (const s of [
    'OpenShift SPA',
    'İnternet · nginx’te tanımlı',
    'İntranet · nginx’e kurulu',
    'Route’lar',
    'SPA route → IP',
    'Yeni sunucularda yük almaya hazır',
    'spaTotal',
    'ocpApps',
  ]) {
    assert.ok(sum.includes(s), `ozette yok: ${s}`);
  }
  assert.ok(sum.includes("['DEV', 'TEST', 'QA', 'EDU', 'PROD']"), 'EDU ortami sirada yok');
  const plat = read('../server/audit/ocp-platforms.cjs');
  assert.ok(
    plat.includes("const ENVS = ['dev', 'test', 'qa', 'edu', 'prod'];"),
    "EDU namespace eki ('-edu') ortam sayilmali",
  );
  // "Sorunsuz" ama dizin eksik -> "Dizin eksik"; PROD: Eski / Yeni ayri kutular
  assert.ok(
    den.includes("cell.status === 'OK' && dirsIncomplete") && den.includes("label: 'Dizin eksik'"),
    'hAC hucresi Sorunsuz yazmamali',
  );
  assert.ok(
    den.includes('uppercase tracking-wide opacity-70">Eski</span>') &&
      den.includes('uppercase tracking-wide opacity-70">Yeni</span>'),
    'PROD hucresinde Eski/Yeni ayri kutular yok',
  );
  // Production Tasimalari: grup sekmeleri, location ilerlemesi, "Bu ekran ne gosteriyor" yok
  const mig = read('components/denetim/NginxProdMigration.tsx');
  assert.ok(!mig.includes('title="Bu ekran ne gösteriyor?"'), 'aciklama notu kaldirilmali');
  assert.ok(mig.includes('onClick={() => setGroupId(g.id)}'), 'grup sekmeleri yok');
  assert.ok(
    mig.includes('function LocationProgress(') && mig.includes('<LocationProgress g={g} />'),
    'location ilerleme panosu yok',
  );
  assert.ok(mig.includes('NEW_LOC[p.newStatus].mark'), 'path cipinde yeni sunucu durumu yok');
  const srvm = read('../server/audit/nginx-migration.cjs');
  assert.ok(
    srvm.includes('newLocRows') &&
      srvm.includes("'defined' : on.length === 0 ? 'none' : 'partial'"),
    'yeni sunucu location durumu hesaplanmali',
  );
  const srv = read('../server/audit/denetim.cjs');
  const cov = srv.slice(
    srv.indexOf("router.get('/nginx-spa-coverage'"),
    srv.indexOf('// ── 2) OPENSHIFT ORTAM KAPSAMI'),
  );
  assert.ok(
    cov.includes("kind = 'proxy' AND UPPER(env) = 'PROD'"),
    'kapsam PROD proxy satirlarini okumali',
  );
  assert.ok(
    cov.includes("ngx.get('PROD').set(res.application"),
    'cozulen proxy uygulamalari PROD nginx kumesine girmeli',
  );
  assert.ok(srv.includes("router.get('/route-stats'"), 'route-stats ucu yok');
});

test('Nginx SPA matrisi: PROD proxy satirlari PROXY durumuyla girer; H/A/C yeni prod sunuculardan', () => {
  const srv = read('../server/audit/denetim.cjs');
  const spa = srv.slice(
    srv.indexOf("router.get('/nginx-spa'"),
    srv.indexOf("router.get('/route-stats'"),
  );
  assert.ok(
    spa.includes("status: 'PROXY', _proxyTarget: target"),
    'proxy satiri PROXY durumuyla haritaya girmeli',
  );
  assert.ok(
    spa.includes("if (cell.status !== 'PROXY') return cell.hosts;"),
    'PROXY hucresinin dizinleri yeni sunuculardan okunmali',
  );
  assert.ok(
    spa.includes('MIGRATION_GROUPS.flatMap((g) => g.newHosts)'),
    'yeni prod sunucular dizin sorgusuna girmeli',
  );
  const den = read('components/DenetimPage.tsx');
  assert.ok(den.includes("PROXY: { label: 'Proxy (eski sunucu)'"), 'PROXY durum etiketi yok');
});

test('Nginx SPA matrisi: PROD hucresinde eski/yeni ayrimi, NEW_ONLY, ortam farki suzgeci', () => {
  const den = read('components/DenetimPage.tsx');
  // 2026-09-17: eski ve yeni AYRI kucuk kutular (ayni sutunda)
  assert.ok(
    den.includes(
      "{oldHas ? `proxy · ${cell.hosts.length}/${oldExpected.length} sunucu` : 'tanım yok'}",
    ),
    'PROD hucresinde eski sunucu kutusu yok (8/8 sunucu)',
  );
  // 2026-09-17: PROXY sorun DEGIL; sorun = OK/PROXY disi durum, eksik eski sunucu, eksik dizin
  assert.ok(
    den.includes('function cellHasProblem(') &&
      den.includes("if (c.status !== 'OK' && c.status !== 'PROXY') return true;"),
    '"Sadece sorunlular" PROXY hucresini sorun saymamali',
  );
  const srv2 = read('../server/audit/denetim.cjs');
  assert.ok(
    srv2.includes('cell.oldMissing = expected.filter((h) => !have.has(h));'),
    'eski sunucu eksik listesi hesaplanmali',
  );
  assert.ok(den.includes("NEW_ONLY: { label: 'Yalnız yeni sunucuda'"), 'NEW_ONLY etiketi yok');
  assert.ok(
    den.includes('function envGapOf(') &&
      den.includes('value="prod-only"') &&
      den.includes('value="no-prod"'),
    'ortam farki suzgeci yok',
  );
  const srv = read('../server/audit/denetim.cjs');
  assert.ok(
    srv.includes("status: 'NEW_ONLY'"),
    'yeni sunucuda dizin olup eski sunucuda proxy olmayan uygulama matrise girmeli',
  );
  // Kural: NEW_ONLY yalnizca zaten gorunen satira eklenir; yeni satir ACILMAZ
  assert.ok(
    srv.includes('if (!row) continue; // baska ortamda yok -> gosterilmez'),
    'yalniz yeni sunucudaki uygulama satir olusturmamali',
  );
  assert.ok(
    !srv.includes('row = { service, application: e.application, envs: {} };'),
    'NEW_ONLY icin satir olusturma kalmis',
  );
});

test('Production Tasimalari: "Eski tanimi kaldir" dugmesi - nginx_ops delete akisi, 23:00 uyarisi, gecmemis uyarisi', () => {
  const src = read('components/denetim/NginxProdMigration.tsx');
  assert.ok(src.includes('nginxMigrationApi.remove({'), 'silme ucu cagrilmiyor');
  assert.ok(src.includes('Eski tanımı kaldır'), 'dugme yok');
  assert.ok(
    src.includes("t?.state !== 'migrated'") && src.includes("Geçiş kaydı 'geçti' değil"),
    'gecmemis uygulamada uyari yok',
  );
  assert.ok(src.includes('23:00'), '23:00 zamanlama bilgisi yok');
  assert.ok(
    src.includes("Silme job'ı (nginx_ops) ID"),
    'yonetici panelinde silme template alani yok',
  );
  const srv = read('../server/nginx-migration/index.cjs');
  assert.ok(
    srv.includes("router.post('/delete'") &&
      srv.includes("action: 'delete'") &&
      srv.includes("env: 'prod'"),
  );
  assert.ok(srv.includes('{ ignoreStatus: true }'), 'silmede yeni sunucu hazirligi aranmamali');
});

test('Nginx Audit istisna: YALNIZ atlayan/tanimsiz gri, ayar sapmasi + dosya farki gorunur, iyimser guncelleme, Admin duzenler', () => {
  const list = read('components/denetim/NginxAudit.tsx');
  // Ikinci tur (2026-09-15): istisna yalniz proxy hucrelerini griler; ayar sapmasi ve dosya farki
  // normal hucre. Kaydettikten sonra tam yeniden yukleme ("Yukleniyor...") YOK, satir aninda guncellenir.
  assert.ok(
    list.includes('proxyCell(h.proxyFqdn)') && list.includes('proxyCell(h.proxyUndefined, true)'),
    'atlayan/tanimsiz istisnada gri olmali',
  );
  assert.ok(
    list.includes('numCell(h.settingsMismatch, true)'),
    'ayar sapmasi istisnada da gosterilmeli',
  );
  assert.ok(
    !/\{exc \? \(\s*muted\s*\) : !filesReady/.test(list),
    'dosya farki istisnada gizlenmemeli',
  );
  assert.ok(
    list.includes('applyExceptionLocally(excEdit.host') && list.includes('void refreshQuietly()'),
    'kaydettikten sonra iyimser guncelleme + sessiz tazeleme olmali',
  );
  assert.ok(
    !/nginxAuditExceptionSet\([\s\S]{0,200}await load\(\)/.test(list),
    'kaydettikten sonra tam yeniden yukleme (spinner) olmamali',
  );
  // Ayni sebeple bosluk-toleransli (prettier <Th> ve <span>'i ayri satirlara alir).
  assert.match(list.replace(/\s+/g, ' '), /<Th> ?<span title="İstisna:/, 'Istisna sutunu yok');
  assert.ok(
    list.includes('denetimApi.nginxAuditExceptionSet(') &&
      list.includes('denetimApi.nginxAuditExceptionClear('),
    'kaydet/kaldir uclari cagrilmiyor',
  );
  assert.ok(list.includes('disabled={excBusy || !excEdit?.note.trim()}'), 'not zorunlu olmali');
  assert.ok(list.includes('canEdit={isAdmin}'), 'yalniz Admin duzenler');
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  assert.ok(page.includes('Bu sunucu denetim istisnası'), 'sunucu sayfasinda bant yok');
  const srv = read('../server/audit/denetim.cjs');
  assert.ok(
    srv.includes("router.put('/nginx-audit/exceptions/:host', requireAdmin") &&
      srv.includes("router.delete('/nginx-audit/exceptions/:host', requireAdmin"),
  );
  assert.ok(
    srv.includes('responseCache.clear();'),
    'istisna yazilinca yanit onbellegi temizlenmeli',
  );
  const schema = read('../server/db/mssql-setup.cjs');
  assert.ok(schema.includes('CREATE TABLE nginx_audit_exceptions'));
});

test('Nginx Audit standart degerler: liste sekmesinde referans paneli, sunucu sayfasinda TUM direktifler alt alta', () => {
  const list = read('components/denetim/NginxAudit.tsx');
  assert.ok(
    list.includes('<ReferenceValuesPanel items={data?.reference || []} />'),
    'liste sekmesinde standart degerler paneli yok',
  );
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  assert.ok(
    page.includes('(data.settingsAll || []).map('),
    'sunucu sayfasi yalniz sapmalari degil TUM direktifleri listelemeli',
  );
  assert.ok(
    page.includes('Standart (referans)') && page.includes('✓ uyumlu') && page.includes('✗ eksik'),
    'durum sutunu yok',
  );
  const srv = read('../server/audit/nginx-audit.cjs');
  assert.ok(
    srv.includes('settingsAll') && srv.includes('return { hosts: list, totals, reference }'),
    'sunucu settingsAll/reference uretmiyor',
  );
});
