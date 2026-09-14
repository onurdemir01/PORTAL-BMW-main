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
