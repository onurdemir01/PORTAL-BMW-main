// server/logx/v2/__tests__/restrictions-group-grant.test.cjs
//
// 2026-08-29: yetki satiri artik bir AD GRUBUNA da verilebiliyor (`group_dn`). Uyelik
// AD'de yonetilir, portalda ikinci bir kopya tutulmaz ve kisi ekipten cikinca erisimi
// kendiliginden biter.
//
// BU TABLO PAYLASILIYOR: LogX, OpsX, Telnet ve ScaleX ayni `logx_v2_restrictions`
// satirlarini okuyor. Dolayisiyla buradaki her degisiklik CALISAN uc modulu etkiler.
// Bu testin ASIL ISI, degisikligin YALNIZCA GENISLETICI oldugunu kilitlemek: bugun
// izin verilen hicbir durum kapanmamali.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const restrictions = require('../restrictions.cjs');

function withDb(rows, fn) {
  const orig = db.query;
  const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}

const KEY = 'ark/prod/c1/odeme-prod';
const GROUP = 'CN=odeme-ekibi,OU=Groups,DC=garanti,DC=com,DC=tr';

// ── GERILEME KORUMASI: eski davranis birebir duruyor mu ─────────────────────

test('kisitlama satiri YOKSA herkese acik (varsayilan-ACIK degismedi)', async () => {
  await withDb([], async () => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User' }), true);
  });
});

test('KULLANICI ADI grant\'i eskisi gibi calisir (grup alani bos)', async () => {
  await withDb([{ id: 1, username: 'ali', group_dn: null }], async () => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User' }), true);
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'veli', role: 'User' }), false);
  });
});

test('Admin her zaman gecer ve DB\'ye HIC gitmez', async () => {
  await withDb([], async (calls) => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'x', role: 'Admin' }), true);
    assert.equal(calls.length, 0);
  });
});

test('grant OLMAYAN kisitli kaynak kapali kalir (grup ozelligi bunu ACMAZ)', async () => {
  await withDb([{ id: 1, username: null, group_dn: null }], async () => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User', groups: ['CN=baska,OU=x'] }), false);
  });
});

// ── YENI: grup grant'i ──────────────────────────────────────────────────────

test('GRUP grant\'i: uye gecer, uye olmayan gecemez', async () => {
  await withDb([{ id: 1, username: null, group_dn: GROUP }], async () => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User', groups: [GROUP] }), true);
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'veli', role: 'User', groups: ['CN=baska,OU=x'] }), false);
  });
});

test('grup karsilastirmasi BUYUK/KUCUK HARF ve BOSLUK duyarsiz', async () => {
  // AD DN'leri kaynaga gore farkli yaziliyor ("CN=" / "cn=", bastan/sondan bosluk).
  // Duyarli bir karsilastirma, dogru gruptaki bir kisiyi SESSIZCE disarida birakirdi.
  await withDb([{ id: 1, username: null, group_dn: GROUP }], async () => {
    const user = { username: 'ali', role: 'User', groups: ['  cn=odeme-ekibi,ou=groups,dc=garanti,dc=com,dc=tr  '] };
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, user), true);
  });
});

test('oturumda grup YOKSA (LDAP kapali / yerel kullanici) kullanici adi grant\'i calismaya devam eder', async () => {
  await withDb([{ id: 1, username: 'ali', group_dn: null }], async () => {
    // `groups` alani HIC yok — eski oturumlar ve yerel kullanicilar boyle.
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User' }), true);
  });
});

test('grup grant\'i kullanici adi grant\'ini EZMEZ — ikisi de gecerlidir', async () => {
  await withDb([
    { id: 1, username: 'ali', group_dn: null },
    { id: 1, username: null, group_dn: GROUP },
  ], async () => {
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User', groups: [] }), true, 'kullanici adiyla');
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'veli', role: 'User', groups: [GROUP] }), true, 'grupla');
    assert.equal(await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ayse', role: 'User', groups: [] }), false, 'ikisi de degilse');
  });
});

test('filterAllowed grup grant\'ini AYNI semantikle uygular', async () => {
  const keys = ['ark/prod/c1/acik', 'ark/prod/c1/kisitli'];
  await withDb([{ resource_key: 'ark/prod/c1/kisitli', username: null, group_dn: GROUP }], async () => {
    const uye = await restrictions.filterAllowed('ocp_namespace', keys, { username: 'ali', role: 'User', groups: [GROUP] });
    assert.deepEqual(uye, keys, 'grup uyesi ikisini de gormeli');
    const yabanci = await restrictions.filterAllowed('ocp_namespace', keys, { username: 'veli', role: 'User', groups: [] });
    assert.deepEqual(yabanci, ['ark/prod/c1/acik'], 'kisitli olan dusmeli, kisitsiz olan KALMALI');
  });
});

// ── `ocp_app` kaynak tipi ───────────────────────────────────────────────────

test('ocp_app kisiti namespace kisitindan BAGIMSIZ degerlendirilir', async () => {
  // "Bu namespace'e girebilsin ama SU uygulamaya dokunamasin" diyebilmek icin. Iki tip
  // ayri sorgu; birinin gecmesi digerini ACMAZ.
  const nsKey = 'ark/prod/c1/odeme-prod';
  const appKey = 'ark/prod/c1/odeme-prod/payment-api';
  const orig = db.query;
  const seen = [];
  db.query = async (sql, params) => {
    seen.push(params[0]);
    // namespace: kisit YOK (acik) · uygulama: kisit VAR, ali listede DEGIL
    if (params[0] === 'ocp_namespace') return { rows: [] };
    return { rows: [{ id: 9, username: 'baskasi', group_dn: null }] };
  };
  try {
    const user = { username: 'ali', role: 'User', groups: [] };
    assert.equal(await restrictions.isAllowed('ocp_namespace', nsKey, user), true);
    assert.equal(await restrictions.isAllowed('ocp_app', appKey, user), false);
    assert.deepEqual(seen, ['ocp_namespace', 'ocp_app']);
  } finally {
    db.query = orig;
  }
});

// ── Sorgu sekli ─────────────────────────────────────────────────────────────

test('tek sorgu, anahtarlar parametreye KONMAZ, iki grant tablosu da okunur', async () => {
  await withDb([], async (calls) => {
    await restrictions.isAllowed('ocp_namespace', KEY, { username: 'ali', role: 'User', groups: [GROUP] });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /logx_v2_restriction_grants/);
    assert.match(calls[0].sql, /logx_v2_restriction_group_grants/);
    // Grup listesi SQL'e degil JS'e gidiyor: degisken uzunlukta bir IN listesini
    // parametrelemek MSSQL'de STRING_SPLIT'e (uyumluluk seviyesi 130+) bagimlilik
    // yaratirdi.
    assert.ok(!calls[0].params.includes(GROUP), 'grup listesi SQL parametresi olmamali');
  });
});
