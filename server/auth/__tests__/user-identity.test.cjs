// server/auth/__tests__/user-identity.test.cjs — IS ATFI kimlik cozumu (DAVRANIS).
//
// URETIM (2026-09-07): kullanici kendi actigi LogX isinde AWX extra_vars'inda
// baska bir calisanin adresini gordu:
//
//   "requester_email": "onurdemir3@garantibbva.com.tr",
//   "requester_name":  "Onur Demir"
//
// Ilk duzeltme `launchJob`e `{ username: row.username }` gecirdi ve kaynak tarayan
// bekci (RA1) YESILE dondu — ama sorun DURUYORDU: `withRequesterVars` e-postayi
// `user.mail`den okur ve `logx_v2_requests` tablosunda MAIL KOLONU YOKTUR. Yani
// `requester_email` yine varsayilana dusuyordu.
//
// Bu dosya kaynak metnini DEGIL DAVRANISI olcer: kimlik cozulup `withRequesterVars`e
// verildiginde AWX'e giden extra_vars'ta GERCEK adresin cikip cikmadigini.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const DB_PATH = require.resolve('../../db/index.cjs');
const LDAP_PATH = require.resolve('../ldap.cjs');
const USERS_PATH = require.resolve('../users.cjs');

/** db ve ldap modullerini sahteleyip users.cjs'i tazeden yukler. */
async function withStubs({ rows, ldapUser }, fn) {
  const saved = {};
  for (const p of [DB_PATH, LDAP_PATH, USERS_PATH]) saved[p] = require.cache[p];

  const db = new Module(DB_PATH, null);
  db.exports = { query: async () => ({ rows: rows || [] }) };
  db.loaded = true;
  require.cache[DB_PATH] = db;

  const ldap = new Module(LDAP_PATH, null);
  let ldapCalls = 0;
  ldap.exports = {
    findLdapUserByUsername: async () => {
      ldapCalls++;
      return ldapUser || null;
    },
  };
  ldap.loaded = true;
  require.cache[LDAP_PATH] = ldap;

  delete require.cache[USERS_PATH];
  try {
    return await fn(require(USERS_PATH), () => ldapCalls);
  } finally {
    for (const p of [DB_PATH, LDAP_PATH, USERS_PATH]) {
      if (saved[p]) require.cache[p] = saved[p];
      else delete require.cache[p];
    }
  }
}

test("UI1 onbellekte e-posta VARSA LDAP'a HIC gidilmez (launch yolunda ag cagrisi yok)", async () => {
  await withStubs(
    { rows: [{ display_name: 'Hakan İşçi', mail: 'hakan@ornek.com.tr' }] },
    async (users, calls) => {
      const id = await users.getUserIdentity('hknisci');
      assert.deepEqual(id, {
        username: 'hknisci',
        displayName: 'Hakan İşçi',
        mail: 'hakan@ornek.com.tr',
      });
      assert.equal(calls(), 0, 'onbellek yeterliyken LDAP cagrildi — launch yolu yavaslar');
    },
  );
});

test("UI2 onbellekte E-POSTA yoksa LDAP'a gidilir (asil duzeltilen dal)", async () => {
  // portal_users satiri VAR ama mail bos: LDAP'ta 'mail' bos olan AD hesaplari ya da
  // recordLogin'in bos yazdigi eski satirlar. Ad dolu diye yetinmek, tam da e-postayi
  // varsayilana dusuren davranisti.
  await withStubs(
    {
      rows: [{ display_name: 'Hakan İşçi', mail: '' }],
      ldapUser: { username: 'hknisci', displayName: 'Hakan İşçi', mail: 'hakan@ornek.com.tr' },
    },
    async (users, calls) => {
      const id = await users.getUserIdentity('hknisci');
      assert.equal(id.mail, 'hakan@ornek.com.tr', "e-posta LDAP'tan alinmadi");
      assert.equal(calls(), 1, "LDAP'a gidilmedi");
    },
  );
});

test('UI3 hicbir kaynak vermiyorsa null doner (cagiran taraf varsayilana duser)', async () => {
  await withStubs({ rows: [] }, async (users) => {
    assert.equal(await users.getUserIdentity('kimsesiz'), null);
  });
});

test('UI4 DB patlasa bile ATIF ISI DURDURMAZ', async () => {
  const saved = require.cache[DB_PATH];
  const savedU = require.cache[USERS_PATH];
  const savedL = require.cache[LDAP_PATH];
  const db = new Module(DB_PATH, null);
  db.exports = {
    query: async () => {
      throw new Error('DB kapali');
    },
  };
  db.loaded = true;
  require.cache[DB_PATH] = db;
  const ldap = new Module(LDAP_PATH, null);
  ldap.exports = {
    findLdapUserByUsername: async () => ({ username: 'x', displayName: 'X', mail: 'x@y.z' }),
  };
  ldap.loaded = true;
  require.cache[LDAP_PATH] = ldap;
  delete require.cache[USERS_PATH];
  try {
    const users = require(USERS_PATH);
    const id = await users.getUserIdentity('x');
    assert.equal(id.mail, 'x@y.z', 'DB dusunce LDAP yedegi devreye girmedi');
  } finally {
    if (saved) require.cache[DB_PATH] = saved;
    else delete require.cache[DB_PATH];
    if (savedL) require.cache[LDAP_PATH] = savedL;
    else delete require.cache[LDAP_PATH];
    delete require.cache[USERS_PATH];
    if (savedU) require.cache[USERS_PATH] = savedU;
  }
});

test("UI5 SONUC: cozulen kimlik AWX extra_vars'ta GERCEK adresi uretiyor", async () => {
  // Bu testin butun anlami bu: zincirin ucu AWX'e giden `requester_email`dir.
  const runner = require('../../ansible/runner.cjs');
  const { withRequesterVars } = runner;
  assert.ok(withRequesterVars, 'withRequesterVars test icin disa acilmamis');

  const cozulen = { username: 'hknisci', displayName: 'Hakan İşçi', mail: 'hakan@ornek.com.tr' };
  const vars = withRequesterVars({ foo: 1 }, cozulen);
  assert.equal(vars.requester_email, 'hakan@ornek.com.tr');
  assert.equal(vars.requester_name, 'Hakan İşçi');
  assert.equal(vars.requester_username, 'hknisci');
  assert.equal(vars.requester_is_fallback, false, 'gercek kimlik varken varsayilana dusuldu');

  // KARSILASTIRMA: yalnizca kullanici adi gecirilirse (ilk, YARIM duzeltme)
  // e-posta VARSAYILANA duser — uretimde gorulen satir tam olarak budur.
  const yarim = withRequesterVars({ foo: 1 }, { username: 'hknisci' });
  assert.notEqual(yarim.requester_email, 'hakan@ornek.com.tr');
  assert.equal(
    yarim.requester_is_fallback,
    true,
    'yarim kimlikte bayrak kalkmiyor — yanlis atif GORUNMEZ olur',
  );
});
