// server/db/__tests__/mssql-setup-kurulum.test.js - Portal tablo kurulumu (setupTables) sahte havuzla (2026-11-24,
// kapsam PR-2). setupTables acilista bir kez kosar; testlerde hic kosmuyordu (1370 satir).
//   MK1 havuz yok / null / alinamiyor: kurulum atlanir, firlatmaz
//   MK2 BOS veritabani: her TABLES girdisi icin CREATE; eksik kolonlar ALTER; seed'ler yazar; kurulum biter
//   MK3 KURULU veritabani: hicbir tablo yeniden olusturulmaz; var olan kolona ALTER ADD gitmez
//   MK4 tek bir sorgunun hatasi kurulumu durdurmaz (uyari yazilir, sonraki adimlar kosar)
//   MK5 olu LogX tablolari varsa dusurulur; kullanici adi normalizasyonu cakismayi silmez, uyarir
//   MK6 dis veritabani tablolarina DDL yok (yalniz Portal'in kendi tablolari; dis DB'de DDL yasak)
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const durum = { pool: null, havuzHatasi: null };
function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('../../inventory/mssql.cjs', {
  getPool: async () => {
    if (durum.havuzHatasi) throw durum.havuzHatasi;
    return durum.pool;
  },
  sql: {},
});
const indeksCagrilari = [];
stub('../external-indexes.cjs', {
  ensureExternalIndexes: async (pool) => {
    indeksCagrilari.push(pool);
    return [];
  },
});

const kurulum = require('../mssql-setup.cjs');

/**
 * Sahte havuz. kurulu: INFORMATION_SCHEMA / sys / OBJECT_ID varlik sorgulari "var" der.
 * hataDeseni: eslesen sorgu firlatir. Her sorgu metni `sorgular`a yazilir.
 */
function havuz({ kurulu = false, hataDeseni = null, yanit = (_metin, _girdiler) => null } = {}) {
  const sorgular = [];
  return {
    sorgular,
    request() {
      const girdiler = {};
      const r = {
        input(ad, a, b) {
          girdiler[ad] = b === undefined ? a : b;
          return r;
        },
        async query(sql) {
          const metin = String(sql);
          sorgular.push({ metin, girdiler: { ...girdiler } });
          if (hataDeseni && hataDeseni.test(metin)) throw new Error('sahte DB hatasi');
          const ozel = yanit(metin, girdiler);
          if (ozel) return ozel;
          const varlik =
            /INFORMATION_SCHEMA\.(TABLES|COLUMNS)|sys\.(indexes|columns|objects|tables)|OBJECT_ID\(|COL_LENGTH\(/i.test(
              metin,
            ) && /^\s*SELECT/i.test(metin);
          if (varlik && kurulu)
            return { recordset: [{ x: 1, len: 4000, cnt: 1 }], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  };
}

const sessiz = (t) => {
  const uyarilar = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', (...a) => uyarilar.push(a.join(' ')));
  return uyarilar;
};

beforeEach(() => {
  durum.pool = null;
  durum.havuzHatasi = null;
  indeksCagrilari.length = 0;
});

test('MK1 havuz alinamazsa ya da null ise kurulum atlanir', async (t) => {
  const uyarilar = sessiz(t);
  durum.havuzHatasi = new Error('baglanti yok');
  await kurulum.setupTables();
  durum.havuzHatasi = null;
  durum.pool = null;
  await kurulum.setupTables();
  assert.deepEqual(uyarilar, [
    '[DB] Tablo kurulumu atlandi — MSSQL baglantisi yok.',
    '[DB] Tablo kurulumu atlandi — MSSQL pool null.',
  ]);
});

test('MK2 bos veritabani: tablolar olusturulur, kolonlar eklenir, seedler yazar', async (t) => {
  const uyarilar = sessiz(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = havuz();
  durum.pool = p;
  await kurulum.setupTables();
  const creates = p.sorgular.filter((q) => /^\s*CREATE TABLE/i.test(q.metin));
  assert.ok(creates.length >= 100, `CREATE TABLE sayisi ${creates.length}`);
  const tablolar = new Set(creates.map((q) => /CREATE TABLE\s+(?:dbo\.)?(\w+)/i.exec(q.metin)[1]));
  for (const ad of ['inventory_hosts', 'ansible_job_history', 'portal_elements'])
    assert.ok(tablolar.has(ad), `${ad} olusturulmadi`);
  assert.ok(
    p.sorgular.some((q) => /ALTER TABLE \w+ ADD /i.test(q.metin)),
    'eksik kolon ALTER ADD ile eklenmedi',
  );
  assert.ok(
    p.sorgular.some((q) => /INSERT INTO ansible_playbook_registry/i.test(q.metin)),
    'playbook kayit seedi yazilmadi',
  );
  assert.ok(
    p.sorgular.some((q) => /INSERT INTO portal_elements/i.test(q.metin)),
    'portal ogeleri seedi yazilmadi',
  );
  // Tablo olusturma hatasi yok (sahte DB her sorguya cevap verdi).
  assert.equal(
    uyarilar.filter((u) => /Tablo olusturulamadi/.test(u)).length,
    0,
    uyarilar.slice(0, 5).join('\n'),
  );
  // Dis tablo indeksleri boot'u bloklamadan 15 sn sonra.
  assert.equal(indeksCagrilari.length, 0);
  t.mock.timers.tick(14999);
  assert.equal(indeksCagrilari.length, 0, 'indeks denetimi 15 sn dolmadan basladi');
  t.mock.timers.tick(1);
  assert.equal(indeksCagrilari.length, 1);
  assert.equal(indeksCagrilari[0], p);
});

test('MK3 kurulu veritabani: CREATE TABLE ve var olan kolona ALTER ADD gitmez', async (t) => {
  sessiz(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = havuz({ kurulu: true });
  durum.pool = p;
  await kurulum.setupTables();
  assert.equal(p.sorgular.filter((q) => /^\s*CREATE TABLE/i.test(q.metin)).length, 0);
  assert.ok(p.sorgular.length > 100, `sorgu sayisi ${p.sorgular.length}`);
});

test('MK4 tek sorgunun hatasi kurulumu durdurmaz', async (t) => {
  const uyarilar = sessiz(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = havuz({
    hataDeseni: /CREATE TABLE inventory_hosts|INSERT INTO ansible_playbook_registry/,
  });
  durum.pool = p;
  await kurulum.setupTables();
  assert.ok(
    uyarilar.some((u) => /Tablo olusturulamadi \(inventory_hosts\)/.test(u)),
    uyarilar.join('\n'),
  );
  // Sonraki tablolar yine olusturuldu.
  assert.ok(p.sorgular.some((q) => /CREATE TABLE ansible_job_history/i.test(q.metin)));
});

test('MK5 olu LogX tablolari dusurulur; kullanici adi cakismasi silinmez, uyarilir', async (t) => {
  const uyarilar = sessiz(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = havuz({
    yanit: (sql) => {
      if (/TABLE_NAME = 'logx_(sessions|permissions)'/.test(sql)) return { recordset: [{ x: 1 }] };
      if (/WHERE a\.username <> LOWER\(a\.username\)/.test(sql))
        return { recordset: [{ username: 'OrnekKisi' }] };
      if (/UPDATE user_role_overrides SET username = LOWER/.test(sql))
        return { recordset: [], rowsAffected: [2] };
      return null;
    },
  });
  durum.pool = p;
  await kurulum.setupTables();
  assert.ok(p.sorgular.some((q) => q.metin === 'DROP TABLE logx_sessions'));
  assert.ok(p.sorgular.some((q) => q.metin === 'DROP TABLE logx_permissions'));
  assert.ok(uyarilar.some((u) => /'OrnekKisi' icin kucuk harfli satir ZATEN VAR/.test(u)));
  assert.ok(!p.sorgular.some((q) => /DELETE FROM user_role_overrides/i.test(q.metin)));
});

test('MK6 dis veritabani tablolarina DDL gitmez', async (t) => {
  sessiz(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = havuz();
  durum.pool = p;
  await kurulum.setupTables();
  // Dis (TBMWANS) tablolari Ansible loader'larinin; Portal onlara CREATE / ALTER / DROP gondermez.
  const dis =
    /\b(Server_Hub_\w+|Nginx_\w+|MWAppsInventory|Openshift_Inventory|BMW_\w+|Inventory)\b/;
  const ddl = p.sorgular.filter(
    (q) =>
      /^\s*(CREATE|ALTER|DROP)\s+(TABLE|INDEX)/i.test(q.metin) && dis.test(q.metin.split('(')[0]),
  );
  assert.deepEqual(
    ddl.map((q) => q.metin.slice(0, 80)),
    [],
  );
});
