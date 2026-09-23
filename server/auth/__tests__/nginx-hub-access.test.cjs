// server/auth/__tests__/nginx-hub-access.test.cjs — Nginx Hub sekme bazlı erişim (2026-09-23).
//
// Kullanıcı: "Nginx Hub'a da istediğim kullanıcıları sokmak istiyorum ama yine sadece
// istediğim sayfaları görsünler — CIS, SPA, API Envanteri, Envanter, Audit gibi."
//
// Model Denetim ile aynıdır (kullanıcı kararı, 2026-09-23): sayfa da sekmeler de VARSAYILAN
// KAPALI; erişim Admin > "Nginx Hub Erişimi" panelinden sayfa + seçilen sekmeler olarak verilir.
// Varsayılan bir tur ÖNCE 1'di; kapatırken sayfaya zaten erişimi olanlar boş ekran görmesin
// diye tek seferlik migration onlara tüm sekmeleri açar — o migration da burada kilitlidir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

const TABS = ['dashboard', 'instances', 'config', 'changes', 'certs', 'orphans', 'drift', 'cis', 'spa', 'api', 'envanter', 'audit'];

test('NH-A1 seed: her sekme element olarak kayıtlı, parent NginxConsole, varsayılan KAPALI', () => {
  const src = read('server/db/mssql-setup.cjs');
  for (const t of TABS) {
    const i = src.indexOf(`element_key: 'tab:nginx:${t}',`);
    assert.ok(i > 0, `tab:nginx:${t} seed yok`);
    const blk = src.slice(i, i + 300);
    assert.ok(blk.includes("parent_key: 'NginxConsole'"), `tab:nginx:${t} parent yanlış`);
    assert.ok(blk.includes('default_visible: 0'), `tab:nginx:${t} varsayılanı AÇIK — sayfayı gören herkes tüm sekmeleri görür`);
  }
  assert.ok(src.includes("element_key: 'admintab:nginxaccess'"), 'admin sekmesi seed yok');
  // Kapatma turunda mevcut erisim sahipleri bos ekranda kalmasin: tek seferlik migration.
  assert.ok(src.includes('migration:nginx-hub-tabs-default-closed-2026-09-23'), 'kapatma migration isareti yok');
  assert.ok(/WHERE element_key = 'NginxConsole' AND allow = 1 AND principal_type IN \('user', 'group'\)/.test(src), 'migration mevcut erisim sahiplerini bulmuyor');
  assert.ok(read('src/config/elements.ts').includes("{ id: 'admintab:nginxaccess', label: 'Nginx Hub Erişimi' }"), 'elements.ts admintab kaydı yok');
});

test('NH-A2 panel uçları: sayfaya + seçilen sekmelere allow yazılır (seçilmeyene kural yok)', () => {
  const routes = read('server/auth/visibility-routes.cjs');
  for (const s of ['router.get("/nginx-access", requireAdmin', 'router.put("/nginx-access", requireAdmin', 'router.delete("/nginx-access", requireAdmin']) {
    assert.ok(routes.includes(s), `uç yok: ${s}`);
  }
  const i = routes.indexOf('router.put("/nginx-access"');
  const blk = routes.slice(i, i + 2000);
  assert.ok(blk.includes("const allow = key === 'NginxConsole' ? true : want.includes(tab);"), 'seçim kuralı yok');
  assert.ok(blk.includes("(key === 'NginxConsole' || allow) ? [{ principalType: pt, principalId: pid, allow: true }] : []"), 'seçilmeyen sekmeye kural yazılmamalı (varsayılan kapalı)');
  for (const t of TABS) assert.ok(new RegExp(`'${t}'`).test(routes.slice(routes.indexOf('const NGINX_TAB_KEYS'), routes.indexOf('const NGINX_TAB_KEYS') + 400)), `NGINX_TAB_KEYS içinde ${t} yok`);
});

test('NH-A3 sunucu kapıları: uçlar sayfa + sekme kapısından geçer', () => {
  const con = read('server/nginx-console/index.cjs');
  assert.ok(con.includes("requireVisiblePrefix('NginxConsole')"), 'sayfa kapısı yok');
  assert.ok(con.includes("requireVisible('tab:nginx:' + hit[1])"), 'sekme kapısı yok');
  for (const t of ['config', 'certs', 'changes', 'orphans', 'drift']) {
    assert.ok(new RegExp(`'${t}'\\]`).test(con), `yol eşlemesinde ${t} yok`);
  }
  // /hosts BİLEREK sayfa kapısında: dashboard/instances/config aynı listeyi okur.
  assert.ok(!/\^\\\/hosts/.test(con), '/hosts bir sekmeye bağlanmış — diğer sekmeler kırılır');

  const cis = read('server/nginx-cis/index.cjs');
  assert.ok(cis.includes("requireVisible('tab:nginx:cis')"), 'CIS uçları sekme kapısında değil');

  const den = read('server/audit/denetim.cjs');
  assert.ok(den.includes("requireVisible('tab:nginx:' + nx[1])"), 'denetim nginx yolları sekme kapısında değil');
  for (const t of ['spa', 'api', 'envanter', 'audit']) {
    assert.ok(new RegExp(`'${t}'\\]`).test(den), `denetim yol eşlemesinde ${t} yok`);
  }
});

test('NH-A4 istemci: sekmeler canSee ile süzülür, içerik de kapalı, boş durumda mesaj', () => {
  const page = read('src/components/nginx_console/NginxConsolePage.tsx');
  assert.ok(page.includes('HUB_TABS.filter((x) => canSee(`tab:nginx:${x.id}`))'), 'üst sekme grubu süzülmüyor');
  assert.ok(page.includes('HUB_AUDIT_TABS.filter((x) => canSee(`tab:nginx:${x.id}`))'), 'denetim sekme grubu süzülmüyor');
  // İçerik de kapalı olmalı: görünmeyen sekmenin bileşeni render EDİLMEMELİ.
  for (const t of TABS) {
    assert.ok(page.includes(`{tab === '${t}' && canSee('tab:nginx:${t}')`), `${t} içeriği koşulsuz render ediliyor`);
  }
  assert.ok(page.includes('Bu sayfada size açık bir bölüm yok'), 'boş durum mesajı yok');
  assert.ok(/if \(visibleIds\.length && !visibleIds\.includes\(tab\)\) setTab\(visibleIds\[0\]\)/.test(page), 'kapalı sekmede kalınca ilk görünür sekmeye geçilmiyor');

  const admin = read('src/components/admin/AdminPage.tsx');
  assert.ok(admin.includes("{ id: 'nginxaccess', label: 'Nginx Hub Erişimi'") && admin.includes("{activeTab === 'nginxaccess' && <NginxAccessTab />}"), 'admin sekmesi bağlı değil');
  const tab = read('src/components/admin/tabs/NginxAccessTab.tsx');
  assert.ok(tab.includes('nginxAccessApi') && tab.includes('TabAccessPanel'), 'panel/API bağlı değil');
  // Kullanıcının saydığı sekmeler etiketli olmalı (ekranda anlaşılır adlar).
  for (const s of ['CIS', 'SPA', 'API Envanteri', 'Envanter', 'Audit']) {
    assert.ok(tab.includes(s), `etiket eksik: ${s}`);
  }
});
