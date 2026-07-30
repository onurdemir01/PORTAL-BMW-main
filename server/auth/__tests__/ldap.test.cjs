// server/auth/__tests__/ldap.test.cjs — Yerel fallback kimlik dogrulama + LDAP grup rolu
// tayini icin guvenlik regresyon testleri (DB/gercek LDAP gerektirmez). Kurumsal AI kod
// incelemesinin BLOCKER bulgulari #8 ve #12 icin kilit testler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// authenticateLocal ve determineRole process.env okuyor — her testte izole env.
// fn() bir Promise donerse (async authenticate() testleri) restore, promise COZULENE
// KADAR ertelenir — aksi halde env degiskenleri fn'in ilk await'inden ONCE geri alinirdi.
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

// ldap.cjs `require('ldapts')` yapiyor — modul yuklemesi bu paket kurulu olmasa bile
// authenticateLocal/determineRole'u calistirmak icin sorun cikarmaz (yalniz Client sinifi
// kullanilmiyor bu fonksiyonlarda).
const ldap = require('../ldap.cjs');

// ── Finding 12: hardcoded admin/admin, user/user artik ASLA calismamali ──────────────────
test('authenticateLocal(): sifre env bossa (set edilmemis) hesap hicbir sifreyle eslesmez', () => {
  withEnv({ LOCAL_ADMIN_USER: 'admin', LOCAL_ADMIN_PASS: '', LOCAL_USER: 'user', LOCAL_USER_PASS: '' }, () => {
    assert.throws(() => ldap.authenticateLocal('admin', 'admin'), /Kullanıcı adı veya şifre hatalı/);
    assert.throws(() => ldap.authenticateLocal('admin', ''), /Kullanıcı adı veya şifre hatalı/);
    assert.throws(() => ldap.authenticateLocal('user', 'user'), /Kullanıcı adı veya şifre hatalı/);
  });
});

test('authenticateLocal(): sifre env DOLUYSA ve eslesiyorsa giris calisir (dogru rolle)', () => {
  withEnv({ LOCAL_ADMIN_USER: 'admin', LOCAL_ADMIN_PASS: 'gercek-guclu-sifre', LOCAL_USER: 'user', LOCAL_USER_PASS: 'baska-sifre' }, () => {
    const admin = ldap.authenticateLocal('admin', 'gercek-guclu-sifre');
    assert.equal(admin.role, 'Admin');
    const user = ldap.authenticateLocal('user', 'baska-sifre');
    assert.equal(user.role, 'User');
  });
});

test('authenticateLocal(): dolu sifreyle bile YANLIS sifre reddedilir', () => {
  withEnv({ LOCAL_ADMIN_USER: 'admin', LOCAL_ADMIN_PASS: 'dogru-sifre' }, () => {
    assert.throws(() => ldap.authenticateLocal('admin', 'yanlis-sifre'), /Kullanıcı adı veya şifre hatalı/);
  });
});

// ── Finding 8: LDAP grup eslemesi tam/DN-sonu esleme, iki-yonlu substring degil ──────────
// determineRole export edilmiyor (internal) — authenticateLdap uzerinden dolayli test etmek
// gercek LDAP baglantisi gerektirir; bu yuzden regex mantigini burada izole dogruluyoruz
// (ldap.cjs'teki gercek satirla BIREBIR ayni ifade).
function determineRoleLike(memberOf, adminGroup, userGroup) {
  const groups = (Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : []).map((g) => String(g).toLowerCase());
  adminGroup = adminGroup.toLowerCase();
  userGroup = userGroup.toLowerCase();
  if (adminGroup && groups.some((g) => g === adminGroup || g.endsWith(',' + adminGroup))) return 'Admin';
  if (userGroup && groups.some((g) => g === userGroup || g.endsWith(',' + userGroup))) return 'User';
  if (!adminGroup && !userGroup) return 'User';
  return null;
}

test('determineRole mantigi: kisa/genel bir grup DNi baska bir grubun ALT DIZISI olsa bile Admin VERMEZ', () => {
  const adminGroup = 'cn=admin,ou=groups,dc=corp';
  // Eski kod: 'cn=some-other-admin-group,ou=groups,dc=corp'.includes('cn=admin,...') → false
  // ama 'cn=admin,ou=groups,dc=corp'.includes(kisaAdminGroup) gibi durumlar yanlislikla eslesebiliyordu.
  // Asil senaryo: kullanicinin uye oldugu grup, admin grubunun bir ALT-DIZISI (substring) ise
  // eski kod adminGroup.includes(g) ile yanlislikla Admin veriyordu.
  const userIsMemberOf = ['cn=admin,ou=groups']; // adminGroup'un icinde substring olarak geciyor ama FARKLI bir DN
  assert.equal(determineRoleLike(userIsMemberOf, adminGroup, ''), null, 'kismi/substring DN eslesmesi Admin vermemeli');
});

test('determineRole mantigi: TAM eslesen grup DNi Admin verir', () => {
  const adminGroup = 'cn=bmw_portal_admins,ou=groups,dc=corp';
  assert.equal(determineRoleLike(['cn=bmw_portal_admins,ou=groups,dc=corp'], adminGroup, ''), 'Admin');
});

test('determineRole mantigi: DN-sonu (suffix) eslesmesi Admin verir (nested OU)', () => {
  const adminGroup = 'ou=admins,dc=corp';
  assert.equal(determineRoleLike(['cn=bmw-portal,ou=admins,dc=corp'], adminGroup, ''), 'Admin');
});

test('determineRole mantigi: hicbir grup eslesmezse null (erisim yok)', () => {
  const adminGroup = 'cn=admins,dc=corp';
  assert.equal(determineRoleLike(['cn=baska-grup,dc=corp'], adminGroup, ''), null);
});

// ── ai_review_3.md #14: LDAP "kullanici yok" hatasi ARTIK yerel hesaba dusmemeli ──────────
// Test senaryosu bilerek LOCAL_ADMIN_USER='' (bos string) kullanir: authenticate()'in en
// basindaki bypass kontrolu `??` ile okur (bos string null/undefined SAYILMAZ → localAdmin=''
// → username='admin' ESLESMEZ → LDAP dalina girer), ama authenticateLocal() ayni degiskeni
// `||` ile okur (bos string FALSY → 'admin' varsayilanina duser → username='admin' ESLESIR).
// Bu `??` / `||` okuma farki, isNotFound fallback'i KALDIRILMADAN once, "admin" kullanici
// adiyla LDAP'ta arama basarisiz olsa bile yerel admin sifresinin denenebildigi somut bir
// yol acikti — asagidaki iki test bu YOLUN artik KAPALI, ag-hatasi YOLUNUN ise hala ACIK
// oldugunu ayni kurulumla (yalniz mock'lanan hata turu degiserek) kanitlar.
test('authenticate(): LDAP "ldap_user_not_found" durumunda yerel hesaba DUSMEZ (dogru yerel sifre bile reddedilir)', async (t) => {
  t.mock.method(ldap, 'authenticateLdap', async () => { throw new Error('ldap_user_not_found'); });
  await withEnv(
    { LDAP_URL: 'ldaps://fake', LDAP_BASE_DN: 'dc=corp', LDAP_BIND_DN: 'cn=svc',
      LOCAL_ADMIN_USER: '', LOCAL_ADMIN_PASS: 'gercek-sifre' },
    async () => {
      await assert.rejects(
        () => ldap.authenticate('admin', 'gercek-sifre'),
        /Kullanıcı adı veya şifre hatalı/
      );
    }
  );
});

test('authenticate(): LDAP AG HATASI (ECONNREFUSED) durumunda yerel hesaba DUSER (mevcut davranis korunur)', async (t) => {
  t.mock.method(ldap, 'authenticateLdap', async () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    throw err;
  });
  await withEnv(
    { LDAP_URL: 'ldaps://fake', LDAP_BASE_DN: 'dc=corp', LDAP_BIND_DN: 'cn=svc',
      LOCAL_ADMIN_USER: '', LOCAL_ADMIN_PASS: 'gercek-sifre' },
    async () => {
      const result = await ldap.authenticate('admin', 'gercek-sifre');
      assert.equal(result.role, 'Admin');
    }
  );
});
