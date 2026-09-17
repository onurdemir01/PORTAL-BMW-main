// server/auth/__tests__/denetim-access.test.cjs
//
// Denetim sayfasi YALNIZ Admin (2026-09-17); Admin > "Denetim Erisimi" paneli kullanici ya da
// AD grubu bazinda sekme acar. Kilitlenen iddialar:
//   1. gorunurluk motoru GRUP kuralini uygular: user > group > role > default; grup DN ya da CN
//   2. seed: Denetim roles=['Admin'], tab:denetim:* elementleri default kapali, migration isareti
//   3. /api/denetim yol -> sekme kapisi ve panel uclari (GET/PUT/DELETE denetim-access)
//   4. istemci: DenetimPage sekmeleri canSee('tab:denetim:<id>') ile suzer; Admin sekmesi kayitli
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

// decide() dosya-ici; kaynaktan cikarip gercekten kosturuyoruz (davranis, bicim degil)
function loadDecide() {
  const src = read('server/auth/visibility.cjs');
  const a = src.indexOf('function truthy(');
  const b = src.indexOf('// Parent → child kaskadi');
  assert.ok(a > 0 && b > a, 'decide/groupKeysOf bulunamadi');
  return new Function(`${src.slice(a, b)}; return { decide, groupKeysOf, buildRuleIndex };`)();
}

test('grup kurali: DN ya da CN ile eslesir; user kurali gruptan, grup rolden ustun; bir allow yeter', () => {
  const { decide, groupKeysOf, buildRuleIndex } = loadDecide();
  const el = { element_key: 'Denetim', enabled: 1, default_visible: 0 };
  const user = { username: 'ademir', role: 'User', groups: ['CN=GT-Middleware,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr', 'CN=Herkes,OU=Groups,DC=x'] };
  const gk = groupKeysOf(user);
  assert.ok(gk.has('gt-middleware') && gk.has('cn=gt-middleware,ou=groups,dc=fw,dc=garanti,dc=com,dc=tr'), 'CN ve tam DN anahtarlari');
  const idx = (rules) => buildRuleIndex(rules);
  // varsayilan kapali, kural yok -> gizli
  assert.equal(decide(el, idx([]), 'User', 'ademir', gk), false);
  // grup CN ile allow -> gorunur
  assert.equal(decide(el, idx([{ element_key: 'Denetim', principal_type: 'group', principal_id: 'GT-Middleware', allow: 1 }]), 'User', 'ademir', gk), true);
  // grup tam DN ile allow -> gorunur
  assert.equal(decide(el, idx([{ element_key: 'Denetim', principal_type: 'group', principal_id: 'cn=gt-middleware,ou=groups,dc=fw,dc=garanti,dc=com,dc=tr', allow: 1 }]), 'User', 'ademir', gk), true);
  // iki grup: biri deny biri allow -> allow kazanir
  assert.equal(decide(el, idx([
    { element_key: 'Denetim', principal_type: 'group', principal_id: 'herkes', allow: 0 },
    { element_key: 'Denetim', principal_type: 'group', principal_id: 'gt-middleware', allow: 1 },
  ]), 'User', 'ademir', gk), true);
  // yalniz deny -> gizli (role allow olsa bile grup rolden ustun)
  assert.equal(decide(el, idx([
    { element_key: 'Denetim', principal_type: 'group', principal_id: 'herkes', allow: 0 },
    { element_key: 'Denetim', principal_type: 'role', principal_id: 'User', allow: 1 },
  ]), 'User', 'ademir', gk), false);
  // user deny, grup allow -> user kazanir (gizli)
  assert.equal(decide(el, idx([
    { element_key: 'Denetim', principal_type: 'user', principal_id: 'ademir', allow: 0 },
    { element_key: 'Denetim', principal_type: 'group', principal_id: 'gt-middleware', allow: 1 },
  ]), 'User', 'ademir', gk), false);
  // uyesi olmadigi grup -> etkisiz
  assert.equal(decide(el, idx([{ element_key: 'Denetim', principal_type: 'group', principal_id: 'baska', allow: 1 }]), 'User', 'ademir', gk), false);
  // Admin her zaman
  assert.equal(decide(el, idx([]), 'Admin', 'root', new Set()), true);
});

test('seed: Denetim yalniz Admin; sekme elementleri varsayilan kapali; tek seferlik kapatma migration; admintab kayitli', () => {
  const src = read('server/db/mssql-setup.cjs');
  const i = src.indexOf("element_key: 'Denetim',");
  assert.ok(/roles: \['Admin'\],/.test(src.slice(i, i + 600)), 'Denetim seed roles Admin olmali');
  for (const t of ['nginx', 'nginxapi', 'nginxenv', 'nginxaudit', 'ocp', 'init', 'envanter', 'degisim', 'appenvs', 'webapp']) {
    const j = src.indexOf(`element_key: 'tab:denetim:${t}',`);
    assert.ok(j > 0, `tab:denetim:${t} seed yok`);
    const blk = src.slice(j, j + 300);
    assert.ok(blk.includes("parent_key: 'Denetim'") && blk.includes('default_visible: 0'), `tab:denetim:${t} parent/default yanlis`);
  }
  assert.ok(src.includes("migration:denetim-admin-only-2026-09-17") && src.includes("DELETE FROM portal_element_visibility WHERE element_key = 'Denetim' AND principal_type = 'role' AND principal_id = 'User'"), 'kapatma migration yok');
  assert.ok(src.includes("element_key: 'admintab:denetimaccess'"), 'admin sekmesi seed yok');
  const els = read('src/config/elements.ts');
  assert.ok(els.includes("{ id: 'admintab:denetimaccess', label: 'Denetim Erişimi' }"), 'elements.ts admintab kaydi yok');
  const store = read('server/auth/elements.cjs');
  assert.ok(store.includes("r.principalType === 'group' ? 'group'"), 'setElementRules group principal kabul etmeli');
});

test('sunucu: /api/denetim yol -> sekme kapisi; panel uclari', () => {
  const den = read('server/audit/denetim.cjs');
  assert.ok(den.includes("requireVisiblePrefix('Denetim')"), 'sayfa kapisi');
  assert.ok(den.includes("requireVisible('tab:denetim:' + hit[1])"), 'sekme kapisi yok');
  for (const t of ['nginx', 'nginxapi', 'nginxenv', 'nginxaudit', 'ocp', 'init', 'envanter', 'appenvs', 'webapp']) {
    assert.ok(new RegExp(`'${t}'\\]`).test(den), `yol eslemesinde ${t} yok`);
  }
  const routes = read('server/auth/visibility-routes.cjs');
  for (const s of ['router.get("/denetim-access", requireAdmin', 'router.put("/denetim-access", requireAdmin', 'router.delete("/denetim-access", requireAdmin']) {
    assert.ok(routes.includes(s), `uc yok: ${s}`);
  }
  assert.ok(routes.includes("visibilityEngine.bumpVersion()"), 'degisiklik yayilmali');
});

test('istemci: DenetimPage sekmeleri canSee ile suzer, hic yoksa mesaj; Admin sekmesi bagli', () => {
  const page = read('src/components/DenetimPage.tsx');
  assert.ok(page.includes(".filter((t) => canSee(`tab:denetim:${t.id}`))"), 'sekme suzgeci yok');
  assert.ok(page.includes('Bu sayfada size açılmış bir bölüm yok'), 'bos durum mesaji yok');
  assert.ok(page.includes("{tabAllowed && tab === 'nginx' && <NginxSpaAudit />}"), 'icerik de kapali olmali');
  const admin = read('src/components/admin/AdminPage.tsx');
  assert.ok(admin.includes("{ id: 'denetimaccess', label: 'Denetim Erişimi'") && admin.includes("{activeTab === 'denetimaccess' && <DenetimAccessTab />}"), 'admin sekmesi bagli degil');
  const tab = read('src/components/admin/tabs/DenetimAccessTab.tsx');
  assert.ok(tab.includes('denetimAccessApi.set(') && tab.includes("<option value=\"group\">"), 'panelde grup secenegi / kayit yok');
});
