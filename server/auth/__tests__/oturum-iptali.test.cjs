// server/auth/__tests__/oturum-iptali.test.cjs
//
// OTURUM IPTALI VE ROL DEGISIKLIGI (Faz A, 2026-10-02). Sahte DB ile:
//
//   OI1 iptal `username` SUTUNUYLA eslesir (eskiden sess JSON'unda LIKE: `_`/`%` iceren
//       ad baska kullanicilarin oturumunu da silerdi); LIKE yalnizca sutunu bos eski satirlar icin
//   OI2 sutunlar yoksa (ALTER calismadi) giris KIRILMAZ: eski sema ile yazilir
//   OI3 satir omru kunyeden: mutlak bitis (bosta kalma middleware'de, sebep soylenebilsin)
//   OI4 rol YUKSELTMESI oturumu dusurmez, yerinde yansir; DUSURME oturumlari sonlandirir
//   OI5 yukseltme kaydi yalnizca kayittan ONCE acilmis oturuma uygulanir; dusurme kaydi siler
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const express = require('express');

const db = require('../../db/index.cjs');
const store = require('../mssql-session-store.cjs');
const policy = require('../session-policy.cjs');

function withMock(impl, fn) {
  const orig = db.query;
  db.query = impl;
  store._kolonDurumuSifirla();
  return Promise.resolve(fn()).finally(() => {
    db.query = orig;
    store._kolonDurumuSifirla();
  });
}

test('OI1 iptal username sutunuyla eslesir; LIKE yalnizca sutunu bos satirlar icin', async () => {
  const cagri = [];
  await withMock(
    async (sql, params) => {
      cagri.push({ sql, params });
      return { rowCount: 2 };
    },
    async () => {
      assert.equal(await store.revokeSessionsForUser('Ali_Veli'), 2);
    },
  );
  assert.equal(cagri.length, 1);
  assert.match(cagri[0].sql, /WHERE username = \$1 OR \(username IS NULL AND LOWER\(sess\) LIKE \$2\)/);
  assert.equal(cagri[0].params[0], 'ali_veli', 'kullanici adi kucuk harfe indirilmeli');
  assert.equal(cagri[0].params[1], '%"username":"ali_veli"%');
});

test('OI2 yeni sutunlar yoksa giris kirilmaz (eski sema ile yazilir)', async () => {
  const cagri = [];
  await withMock(
    async (sql) => {
      cagri.push(sql);
      if (/username = \$3|username, created_at/.test(sql)) throw new Error("Invalid column name 'username'.");
      return { rowCount: 1 };
    },
    () =>
      new Promise((resolve, reject) => {
        const s = store.createMssqlSessionStore(session);
        s.set('sid-x', { user: { username: 'u' }, cookie: {} }, (err) => (err ? reject(err) : resolve()));
      }),
  );
  assert.match(cagri.at(-1), /^UPDATE portal_sessions SET sess = \$1, expires = \$2 WHERE sid = \$3$/);

  // Iptal de eski LIKE yoluna duser (0 sessizce donmez).
  const iptal = [];
  await withMock(
    async (sql) => {
      iptal.push(sql);
      if (/username = \$1/.test(sql)) throw new Error("Invalid column name 'username'.");
      return { rowCount: 3 };
    },
    async () => assert.equal(await store.revokeSessionsForUser('u'), 3),
  );
  assert.match(iptal.at(-1), /DELETE FROM portal_sessions WHERE LOWER\(sess\) LIKE \$1/);
});

test('OI3 satir omru kunyeden: mutlak bitis', () => {
  const t = Date.UTC(2026, 9, 2, 8, 0, 0);
  const e = store.expiryFrom({ meta: { createdAt: t, lastSeenAt: t + 1000, remember: false }, cookie: {} });
  assert.equal(e.getTime(), t + 12 * 3600e3);
  const r = store.expiryFrom({ meta: { createdAt: t, lastSeenAt: t, remember: true }, cookie: {} });
  assert.equal(r.getTime(), t + 7 * 24 * 3600e3);
});

function rolUygulamasi(sorgular) {
  const orig = db.query;
  db.query = async (sql, params) => {
    sorgular.push({ sql, params });
    if (/^SELECT sid, sess FROM portal_sessions/.test(sql)) {
      return {
        rows: [
          { sid: 's1', sess: JSON.stringify({ user: { username: 'ayse', role: 'User' }, meta: {} }) },
          { sid: 's2', sess: JSON.stringify({ user: { username: 'ayse', role: 'Admin' }, meta: {} }) },
        ],
      };
    }
    return { rows: [], rowCount: 1 };
  };
  const app = express();
  require('../roles-routes.cjs').initRolesRoutes(app, { requireAdmin: (_q, _s, n) => n() });
  const srv = app.listen(0);
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    kapat: () => {
      srv.close();
      db.query = orig;
    },
  };
}

test('OI4 yukseltme oturumu dusurmez (yerinde yazar); dusurme ve kaldirma sonlandirir', async () => {
  const q = [];
  const { url, kapat } = rolUygulamasi(q);
  try {
    store._kolonDurumuSifirla();
    const up = await (
      await fetch(`${url}/api/roles/Ayse`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'Admin' }),
      })
    ).json();
    assert.equal(up.sessionsRevoked, 0, 'yukseltme kullaniciyi atti');
    assert.equal(up.sessionsRefreshed, 1, 'yalnizca rolu farkli olan oturum yazilmali');
    assert.ok(!q.some((x) => /^DELETE FROM portal_sessions/.test(x.sql)), 'yukseltmede oturum silindi');
    const yaz = q.find((x) => /^UPDATE portal_sessions SET sess = \$1 WHERE sid = \$2/.test(x.sql));
    assert.ok(yaz, 'oturum satiri yeniden yazilmadi');
    assert.equal(JSON.parse(yaz.params[0]).user.role, 'Admin');
    assert.ok(policy._rolYukseltmeleri.has('ayse'), 'bellek kaydi yok (yarisa karsi)');

    q.length = 0;
    const down = await (
      await fetch(`${url}/api/roles/Ayse`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'User' }),
      })
    ).json();
    assert.ok(q.some((x) => /^DELETE FROM portal_sessions WHERE username = \$1/.test(x.sql)), 'dusurmede oturum kaldi');
    assert.equal(down.sessionsRevoked, 1);
    assert.ok(!policy._rolYukseltmeleri.has('ayse'), 'dusurmeden sonra eski yukseltme kaydi kaldi — yeni giris yeniden Admin olurdu');

    policy.rolYukseltmesiKaydet('ayse', 'Admin');
    q.length = 0;
    await fetch(`${url}/api/roles/Ayse`, { method: 'DELETE' });
    assert.ok(q.some((x) => /^DELETE FROM portal_sessions WHERE username = \$1/.test(x.sql)), 'kaldirmada oturum kaldi');
    assert.ok(!policy._rolYukseltmeleri.has('ayse'));
  } finally {
    kapat();
  }
});

test('OI5 yukseltme kaydi yalnizca kayittan ONCE acilmis oturuma uygulanir', () => {
  const t = Date.UTC(2026, 9, 2, 8, 0, 0);
  policy._saatAyarla(() => t + 1000);
  try {
    policy.rolYukseltmesiKaydet('veli', 'Admin', t);
    const mw = policy.oturumYaptirimi();
    const res = { setHeader() {} };
    const eski = { user: { username: 'Veli', role: 'User' }, meta: { createdAt: t - 1000, lastSeenAt: t, remember: false }, cookie: {} };
    mw({ session: eski, headers: {}, method: 'GET', path: '/api/x' }, res, () => {});
    assert.equal(eski.user.role, 'Admin', 'acik oturuma yukseltme yansimadi');
    const yeni = { user: { username: 'veli', role: 'User' }, meta: { createdAt: t + 500, lastSeenAt: t + 500, remember: false }, cookie: {} };
    mw({ session: yeni, headers: {}, method: 'GET', path: '/api/x' }, res, () => {});
    assert.equal(yeni.user.role, 'User', 'kayittan SONRA acilan oturumun rolu ezildi');
  } finally {
    policy.rolKaydiniSil('veli');
    policy._saatAyarla(null);
  }
});
