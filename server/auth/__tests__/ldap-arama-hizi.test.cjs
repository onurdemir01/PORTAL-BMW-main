// server/auth/__tests__/ldap-arama-hizi.test.cjs
//
// Yetki ekraninda LDAP kullanici aramasi (kullanici, 2026-10-14: "sorgu biraz gec calisiyor").
// Gercek searchLdapUsers kosturulur; ldapts.Client sahtesiyle (ag yok).
//   LH1 ilk deneme DIZINLI aramadir: ANR + objectCategory=person; ICEREN (displayName=*q*) YOK
//   LH2 ANR sonuc vermezse eski ICEREN aramasina dusulur (eski sonuclar kaybolmaz)
//   LH3 ANR desteklenmezse (hata) yine genis arama; ikisi de duserse hata yukari cikar (bos liste DEGIL)
//   LH4 ayni sorgu 60 sn icinde LDAP'a ikinci kez gitmez; hata onbelleklenmez
//   LH5 sorgu kacisa sokulur (enjeksiyon yok)
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
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

const KISI = { sAMAccountName: 'OnurDemir', displayName: 'Onur Demir', mail: 'onurdemir@garantibbva.com.tr' };

beforeEach(() => {
  process.env.LDAP_URL = 'ldaps://sahte';
  process.env.LDAP_BASE_DN = 'DC=fw';
  process.env.LDAP_BIND_DN = 'CN=svc';
  filtreler = [];
  yanit = () => [KISI];
});

test('LH1 ilk deneme dizinli (ANR + person), ICEREN arama yok', async () => {
  const { searchLdapUsers } = yukle();
  const u = await searchLdapUsers('onur dem');
  assert.equal(u[0].username, 'onurdemir');
  assert.equal(filtreler.length, 1);
  assert.match(filtreler[0], /\(anr=onur dem\)/);
  assert.match(filtreler[0], /\(objectCategory=person\)/);
  assert.doesNotMatch(filtreler[0], /displayName=\*/);
});

test('LH2 ANR bos donerse genis (ICEREN) aramaya dusulur', async () => {
  yanit = (f) => (f.includes('anr=') ? [] : [KISI]);
  const { searchLdapUsers } = yukle();
  const u = await searchLdapUsers('nur de');
  assert.equal(u.length, 1);
  assert.equal(filtreler.length, 2);
  assert.match(filtreler[1], /\(displayName=\*nur de\*\)/);
});

test('LH3 ANR hata verirse genis arama; ikisi de duserse hata yukari cikar', async () => {
  yanit = (f) => {
    if (f.includes('anr=')) throw new Error('unsupported');
    return [KISI];
  };
  let m = yukle();
  assert.equal((await m.searchLdapUsers('onur')).length, 1);
  yanit = () => {
    throw new Error('baglanti yok');
  };
  m = yukle();
  await assert.rejects(m.searchLdapUsers('onur'), /LDAP araması yapılamadı/);
});

test('LH4 ayni sorgu onbellekten; hata onbelleklenmez', async () => {
  const { searchLdapUsers } = yukle();
  await searchLdapUsers('onur');
  await searchLdapUsers('ONUR');
  assert.equal(filtreler.length, 1, 'ikinci arama LDAP a gitti');
  await searchLdapUsers('osman');
  assert.equal(filtreler.length, 2);

  yanit = () => {
    throw new Error('gecici');
  };
  const m2 = yukle();
  await assert.rejects(m2.searchLdapUsers('kemal'));
  yanit = () => [KISI];
  const once = filtreler.length;
  await m2.searchLdapUsers('kemal');
  assert.ok(filtreler.length > once, 'hata onbelleklendi');
});

test('LH5 sorgu kacisa sokulur', async () => {
  const { searchLdapUsers } = yukle();
  await searchLdapUsers('a*)(x');
  assert.ok(filtreler.every((f) => !f.includes('a*)(x')), filtreler.join(' | '));
});
