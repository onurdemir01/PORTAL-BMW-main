// server/auth/__tests__/ldap-grup-arama.test.cjs
//
// Self Service erisimi icin LDAP grup aramasi (2026-10-26). Gercek searchLdapGroups kosturulur;
// ldapts.Client sahtesiyle (ag yok).
//   LG1 ilk deneme ONEK aramasidir (objectClass=group, cn / sAMAccountName); ICEREN yok
//   LG2 onek bos donerse ICEREN aramasina dusulur
//   LG3 sorgu kacisa sokulur (enjeksiyon yok); 3 karakterden kisa sorgu LDAP'a gitmez
//   LG4 hata yukari cikar (bos liste DEGIL); hata onbelleklenmez, basari onbelleklenir
//   LG5 uc yalniz admin'e acik ve en az 3 karakter ister
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ldaptsYol = require.resolve('ldapts');
const LDAP_YOL = path.join(__dirname, '..', 'ldap.cjs');

let filtreler;
let yanit;
class SahteClient {
  async bind() {}
  async unbind() {}
  async search(_base, opts) {
    filtreler.push(opts.filter);
    return { searchEntries: yanit(opts.filter) };
  }
}

function yukle() {
  require.cache[ldaptsYol] = { id: ldaptsYol, filename: ldaptsYol, loaded: true, exports: { Client: SahteClient } };
  delete require.cache[LDAP_YOL];
  return require(LDAP_YOL);
}

const GRUP = { dn: 'CN=GT-Middleware,OU=Groups,DC=fw', cn: 'GT-Middleware', description: ['Middleware ekibi'] };

beforeEach(() => {
  process.env.LDAP_URL = 'ldaps://sahte';
  process.env.LDAP_BASE_DN = 'DC=fw';
  process.env.LDAP_BIND_DN = 'CN=svc';
  filtreler = [];
  yanit = () => [GRUP, { ...GRUP }];
});

test('LG1 onek aramasi; sonuc tekil ve dn/cn/aciklama ile', async () => {
  const { searchLdapGroups } = yukle();
  const g = await searchLdapGroups('GT-Mid');
  assert.deepEqual(g, [{ dn: GRUP.dn, cn: 'GT-Middleware', description: 'Middleware ekibi' }]);
  assert.equal(filtreler.length, 1);
  assert.match(filtreler[0], /\(objectClass=group\)/);
  assert.match(filtreler[0], /\(cn=GT-Mid\*\)/);
  assert.doesNotMatch(filtreler[0], /cn=\*/);
});

test('LG2 onek bos donerse ICEREN aramasi', async () => {
  yanit = (f) => (f.includes('cn=*') ? [GRUP] : []);
  const { searchLdapGroups } = yukle();
  assert.equal((await searchLdapGroups('middleware')).length, 1);
  assert.equal(filtreler.length, 2);
  assert.match(filtreler[1], /\(cn=\*middleware\*\)/);
});

test('LG3 kacis; kisa sorgu LDAP a gitmez', async () => {
  const { searchLdapGroups } = yukle();
  await searchLdapGroups('a*)(x');
  assert.ok(filtreler.every((f) => !f.includes('a*)(x')), filtreler.join(' | '));
  const once = filtreler.length;
  assert.deepEqual(await searchLdapGroups('gt'), []);
  assert.equal(filtreler.length, once);
});

test('LG4 hata yukari cikar ve onbelleklenmez; basari onbelleklenir', async () => {
  yanit = () => {
    throw new Error('baglanti yok');
  };
  const m = yukle();
  await assert.rejects(m.searchLdapGroups('network'), /LDAP grup araması yapılamadı/);
  yanit = () => [GRUP];
  await m.searchLdapGroups('network');
  const sonra = filtreler.length;
  await m.searchLdapGroups('NETWORK');
  assert.equal(filtreler.length, sonra, 'ayni sorgu ikinci kez LDAP a gitti');
});

test('LG5 uc admin e acik ve en az 3 karakter ister', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'visibility-routes.cjs'), 'utf8');
  const i = s.indexOf("router.get('/ldap-groups'");
  assert.ok(i > 0, 'uc yok');
  const b = s.slice(i, i + 700);
  assert.match(b, /^router\.get\('\/ldap-groups', requireAdmin,/);
  assert.match(b, /q\.length < 3/);
  assert.match(b, /status\(502\)/);
});
