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
  assert.ok(/hostPagePath = \(host: string\) => `\/denetim\/nginx-audit\/\$\{encodeURIComponent\(host\)\}`/.test(list));
  assert.ok(list.includes('<Link to={to}'), 'sunucu adi gercek bir Link olmali (yeni sekmede acilabilsin)');
  assert.ok(!/onToggle|open === h\.host/.test(list), 'eski satir-ici acilir bolum kalmamali');
  assert.ok(app.includes('path="/denetim/nginx-audit/:host"'), 'App.tsx rotasi yok');
  assert.ok(page.includes("'/denetim?tab=nginxaudit'"), 'geri baglantisi Nginx Audit sekmesine gitmeli');
  assert.ok(denetim.includes("searchParams.get('tab')"), 'DenetimPage ?tab= okumali');
  assert.ok(/DENETIM_TABS\.includes\(v\) \? v : 'nginx'/.test(denetim), 'taninmayan tab ilk sekmeye dusmeli');
});

test('sunucu sayfasi bes bolumu ve dosya uyumu DDL uyarisini tasir', () => {
  const page = read('components/denetim/NginxAuditHostPage.tsx');
  for (const s of ['Server blokları', "Location'lar (dosya başına)", "Upstream'ler", 'Ayarlar — kurulum referansıyla', 'Kurulum dosyası uyumu']) {
    assert.ok(page.includes(s), `bolum yok: ${s}`);
  }
  assert.ok(page.includes('dbo.Nginx_Audit_Files'), 'tablo yokken DDL uyarisi olmali');
  // Ortam kaynagi gorunur (BILINMIYOR sessiz degil)
  assert.ok(page.includes('envSourceHint(data.envSource)'));
});

test('Nginx SPA > Prod Tasima sekmesi bagli ve kapsam paneli o sekmede gizli', () => {
  const denetim = read('components/DenetimPage.tsx');
  assert.ok(denetim.includes("{ id: 'tasima', label: 'Production Taşımaları' }"), 'Production Tasimalari secenegi yok');
  assert.ok(denetim.includes("{tier === 'tasima' && <NginxProdMigration />}"), 'NginxProdMigration render edilmiyor');
  assert.ok(denetim.includes("{tier !== 'tasima' && <SpaCoverage tier={tier} />}"), 'kapsam paneli tasima sekmesinde gizlenmeli');
  const api = read('api/denetimApi.ts');
  assert.ok(api.includes('nginxMigration: ()'), 'API ucu yok');
});

test('Production Tasimalari: Tanim olustur dugmesi, ekip siralamasi, H/A/C sozlugu', () => {
  const src = read('components/denetim/NginxProdMigration.tsx');
  // dugme: yapilandirma yoksa / eksik / taranmadi -> pasif; onay penceresi formlu -> arka plan tiklamasi kapali
  assert.ok(src.includes("disabled={!canCreate || a.status === 'missing' || a.status === 'not-scanned'}"));
  assert.ok(src.includes('dismissOnBackdrop={false}'), 'onay penceresi surukleme ile kapanmamali');
  assert.ok(src.includes('nginxMigrationApi.create({'), 'launch ucu cagrilmiyor');
  // ekip siralamasi: cok uygulamasi olan ekip ustte, ekipsizler en sona
  assert.ok(src.includes("<option value=\"team\">"), 'ekip siralamasi secenegi yok');
  assert.ok(/if \(!ta !== !tb\) return ta \? -1 : 1;/.test(src), 'ekipsizler en sona dusmeli');
  // H/A/C sozlugu ust tarafta, acik
  assert.ok(src.includes('<HacLegend />'), 'sozluk render edilmiyor'); // tanim HacCell.tsx'te (ortak)
  const hac = read('components/denetim/HacCell.tsx');
  for (const s of ['/hysdeploy/&lt;ns&gt;/&lt;app&gt;/', '/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/', 'application-confs/&lt;app&gt;-&lt;ns&gt;.conf']) {
    assert.ok(hac.includes(s), `sozlukte yok: ${s}`);
  }
  // yonetici paneli + rota
  assert.ok(src.includes('<MigrationConfigPanel'));
  const idx = read('../server/index.cjs');
  assert.ok(idx.includes("require('./nginx-migration/index.cjs').initNginxMigration(app)"), 'server modulu kayitli degil');
});

test('H/A/C gosterimi ORTAK (HacCell) ve Nginx SPA matrisi de kullaniyor', () => {
  const hac = read('components/denetim/HacCell.tsx');
  assert.ok(hac.includes('export function DirCell(') && hac.includes('export function HacLegend('));
  const mig = read('components/denetim/NginxProdMigration.tsx');
  assert.ok(mig.includes("from './HacCell'") && !mig.includes('function DirCell('), 'tasima sayfasi kendi kopyasini tutmamali');
  const den = read('components/DenetimPage.tsx');
  assert.ok(den.includes('<DirCell f={d.flags} />'), 'matris hucresinde H/A/C yok');
  assert.ok(den.includes('<HacLegend defaultOpen={false} />'), 'matriste sozluk yok');
  const srv = read('../server/audit/denetim.cjs');
  const spa = srv.slice(srv.indexOf("router.get('/nginx-spa'"), srv.indexOf("router.get('/nginx-spa-coverage'"));
  assert.ok(spa.includes('FROM dbo.Nginx_Intranet_Audit') && spa.includes('cell.dirs = cell.hosts.map('), '/nginx-spa dizin bayraklarini eklemeli');
});
