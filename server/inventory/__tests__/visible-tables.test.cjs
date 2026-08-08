// server/inventory/__tests__/visible-tables.test.cjs — actions.md #12 (Bolum K) kullanici
// tablo gorunurlugu yeniden tasarimi: eski 2-satirlik CSV modeli yerine her tablo icin bir
// satir + coklu-satirli rol/kullanici/kolon kurallari. mssql.cjs'in `query`'si module-mock
// ile taklit edilir (inventory/index.cjs onu DESTRUCTURE ettigi icin t.mock.method degil,
// mock.module GEREKIR — modul yuklenmeden ONCE devreye girer).
'use strict';

const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tv, rv, ov, legacy, nextId;

function resetFakeDb() {
  tv = [];      // { id, table_name, is_active }
  rv = [];      // { table_visibility_id, role_name, can_view }
  ov = [];      // { table_visibility_id, username, override_type }
  legacy = [];  // { role_name, tables }
  nextId = 1;
}

function paramVal(params, name) {
  const p = (params || []).find((x) => x.name === name);
  return p ? p.value : undefined;
}

async function fakeQuery(sqlText, params) {
  const s = String(sqlText).replace(/\s+/g, ' ').trim();

  if (s.includes("IF NOT EXISTS (SELECT 1 FROM inventory_table_visibility WHERE table_name = '*')")) {
    if (!tv.find((r) => r.table_name === '*')) tv.push({ id: nextId++, table_name: '*', is_active: true });
    return { recordset: [] };
  }
  if (s.startsWith('SELECT table_name, is_active FROM inventory_table_visibility')) {
    return { recordset: tv.map((r) => ({ table_name: r.table_name, is_active: r.is_active })) };
  }
  if (s.startsWith("SELECT table_name FROM inventory_table_visibility WHERE is_active = 0")) {
    return { recordset: tv.filter((r) => r.table_name !== '*' && !r.is_active).map((r) => ({ table_name: r.table_name })) };
  }
  if (s.startsWith('INSERT INTO inventory_table_visibility (table_name) VALUES')) {
    tv.push({ id: nextId++, table_name: paramVal(params, 't'), is_active: true });
    return { recordset: [] };
  }
  if (s.startsWith('UPDATE inventory_table_visibility SET is_active = 1')) {
    const row = tv.find((r) => r.table_name === paramVal(params, 't'));
    if (row) row.is_active = true;
    return { recordset: [] };
  }
  if (s.startsWith('UPDATE inventory_table_visibility SET is_active = 0')) {
    const row = tv.find((r) => r.table_name === paramVal(params, 't'));
    if (row) row.is_active = false;
    return { recordset: [] };
  }
  if (s.startsWith('SELECT COUNT(*) AS n FROM inventory_table_role_visibility')) {
    return { recordset: [{ n: rv.length }] };
  }
  if (s.startsWith('SELECT role_name, tables FROM inventory_visible_tables')) {
    return { recordset: legacy.slice() };
  }
  if (s.startsWith('SELECT id, table_name FROM inventory_table_visibility')) {
    return { recordset: tv.map((r) => ({ id: r.id, table_name: r.table_name })) };
  }
  if (s.startsWith('INSERT INTO inventory_table_role_visibility')) {
    rv.push({ table_visibility_id: paramVal(params, 'id'), role_name: paramVal(params, 'r'), can_view: true });
    return { recordset: [] };
  }
  if (s.startsWith('DELETE FROM inventory_table_role_visibility WHERE role_name')) {
    const role = paramVal(params, 'r');
    rv = rv.filter((r) => r.role_name !== role);
    return { recordset: [] };
  }
  if (s.includes('FROM inventory_table_role_visibility rv') && s.includes('JOIN inventory_table_visibility tv')) {
    const results = [];
    for (const r of rv) {
      if (!r.can_view) continue;
      const t = tv.find((x) => x.id === r.table_visibility_id);
      if (!t) continue;
      if (t.table_name !== '*' && !t.is_active) continue;
      results.push({ role_name: r.role_name, table_name: t.table_name });
    }
    return { recordset: results };
  }
  if (s.includes('FROM inventory_table_user_override o') && s.includes('JOIN inventory_table_visibility tv')) {
    const username = paramVal(params, 'u');
    const results = [];
    for (const o of ov) {
      if (o.username !== username) continue;
      const t = tv.find((x) => x.id === o.table_visibility_id);
      if (!t) continue;
      results.push({ table_name: t.table_name, override_type: o.override_type });
    }
    return { recordset: results };
  }
  throw new Error(`fakeQuery: karsilanmayan SQL: ${s.slice(0, 100)}`);
}

mock.module('../mssql.cjs', {
  exports: {
    query: (sqlText, params) => fakeQuery(sqlText, params),
    sql: { NVarChar: () => 'nvarchar', Int: 'int', MAX: 'max' },
    isAvailable: () => true,
    getPool: async () => null,
    poolStats: () => ({}),
  },
});

const inv = require('../index.cjs');

beforeEach(() => {
  resetFakeDb();
  inv._resetVisibleTablesTestState();
});

test('reconcileTableVisibility(): her canli tablo icin bir satir olusturur + sentinel ekler', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps']);
  const names = tv.map((r) => r.table_name).sort();
  assert.deepEqual(names, ['*', 'EnvanterApps', 'Inventory']);
});

test('reconcileTableVisibility(): artik canli olmayan tablo SILINMEZ, is_active=0 yapilir', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps']);
  inv._resetVisibleTablesTestState(); // TTL guard'i atlamak icin
  await inv._reconcileTableVisibility(['Inventory']); // EnvanterApps artik yok
  const envRow = tv.find((r) => r.table_name === 'EnvanterApps');
  assert.ok(envRow, 'satir hala var (silinmedi)');
  assert.equal(envRow.is_active, false);
});

test('migrateLegacyVisibleTablesIfNeeded(): eski tablo da BOSSA DEFAULT_VISIBLE yeni semaya yazilir', async () => {
  // DEFAULT_VISIBLE (inventory/index.cjs) kurumsal envanter tablosu adiyla birlikte
  // guncellendi: EnvanterApps -> MWAppsInventory. Test o listeyi TAKIP eder.
  await inv._reconcileTableVisibility(['Inventory', 'MWAppsInventory', 'OpenshiftInventory']);
  await inv._migrateLegacyVisibleTablesIfNeeded();
  const userRows = rv.filter((r) => r.role_name === 'User').map((r) => tv.find((t) => t.id === r.table_visibility_id)?.table_name).sort();
  assert.deepEqual(userRows, ['Inventory', 'MWAppsInventory', 'OpenshiftInventory']);
  const adminIsStar = rv.some((r) => r.role_name === 'Admin' && tv.find((t) => t.id === r.table_visibility_id)?.table_name === '*');
  assert.ok(adminIsStar, 'Admin varsayilan olarak * (tum tablolar) olmali');
});

test('migrateLegacyVisibleTablesIfNeeded(): eski CSV satirlari (hem "*" hem liste) dogru gocurulur', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps', 'Secret']);
  legacy.push({ role_name: 'User', tables: 'Inventory,EnvanterApps' });
  legacy.push({ role_name: 'Admin', tables: '*' });
  await inv._migrateLegacyVisibleTablesIfNeeded();

  const userTables = rv.filter((r) => r.role_name === 'User').map((r) => tv.find((t) => t.id === r.table_visibility_id)?.table_name).sort();
  assert.deepEqual(userTables, ['EnvanterApps', 'Inventory']);
  assert.ok(!userTables.includes('Secret'));

  const adminRow = rv.find((r) => r.role_name === 'Admin');
  assert.equal(tv.find((t) => t.id === adminRow.table_visibility_id)?.table_name, '*');
});

test('migrateLegacyVisibleTablesIfNeeded(): rol-gorunurlugu ZATEN doluysa TEKRAR calismaz (idempotent)', async () => {
  await inv._reconcileTableVisibility(['Inventory']);
  legacy.push({ role_name: 'User', tables: 'Inventory' });
  await inv._migrateLegacyVisibleTablesIfNeeded();
  const countAfterFirst = rv.length;

  inv._resetVisibleTablesTestState();
  legacy.push({ role_name: 'User', tables: 'Inventory' }); // tekrar eklense bile
  await inv._migrateLegacyVisibleTablesIfNeeded();
  assert.equal(rv.length, countAfterFirst, 'zaten dolu oldugu icin ikinci cagri hicbir sey degistirmemeli');
});

test('readVisibleTables(): eski API seklini ({User:[...], Admin:"*"}) BIREBIR korur', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'MWAppsInventory']);
  await inv._migrateLegacyVisibleTablesIfNeeded();
  const config = await inv._readVisibleTables();
  assert.deepEqual([...config.User].sort(), ['Inventory', 'MWAppsInventory']);
  assert.equal(config.Admin, '*');
});

test('writeVisibleTablesForRole(): "*" yazilinca readVisibleTables sentinel uzerinden "*" doner', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps']);
  await inv._writeVisibleTablesForRole('User', '*');
  const config = await inv._readVisibleTables();
  assert.equal(config.User, '*');
});

test('writeVisibleTablesForRole(): dizi yazilinca ONCEKI kurallar TEMIZLENIR, sadece yeni liste kalir', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps', 'OpenshiftInventory']);
  await inv._writeVisibleTablesForRole('User', ['Inventory', 'EnvanterApps']);
  await inv._writeVisibleTablesForRole('User', ['OpenshiftInventory']); // ustune yaz
  const config = await inv._readVisibleTables();
  assert.deepEqual(config.User, ['OpenshiftInventory']);
});

test('filterTablesByRole(): kullanici override YOKSA sadece rol kurali uygulanir (geriye donuk uyumlu)', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps', 'Secret']);
  await inv._writeVisibleTablesForRole('User', ['Inventory']);
  const result = await inv._filterTablesByRole(['Inventory', 'EnvanterApps', 'Secret'], 'User');
  assert.deepEqual(result, ['Inventory']);
});

test('filterTablesByRole(): "allow" override rol kuralinin USTUNE gecip gormedigi tabloyu ACAR', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'Secret']);
  await inv._writeVisibleTablesForRole('User', ['Inventory']);
  const secretId = tv.find((t) => t.table_name === 'Secret').id;
  ov.push({ table_visibility_id: secretId, username: 'ahmet', override_type: 'allow' });

  const result = await inv._filterTablesByRole(['Inventory', 'Secret'], 'User', 'ahmet');
  assert.deepEqual(result.sort(), ['Inventory', 'Secret']);
});

test('filterTablesByRole(): "deny" override rol kuralinin USTUNE gecip gordugu tabloyu KAPAR', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps']);
  await inv._writeVisibleTablesForRole('User', ['Inventory', 'EnvanterApps']);
  const invId = tv.find((t) => t.table_name === 'Inventory').id;
  ov.push({ table_visibility_id: invId, username: 'ahmet', override_type: 'deny' });

  const result = await inv._filterTablesByRole(['Inventory', 'EnvanterApps'], 'User', 'ahmet');
  assert.deepEqual(result, ['EnvanterApps']);
});

test('filterTablesByRole(): is_active=0 (admin tarafindan Pasif yapilmis) tablo "*" rolu icin bile HARIC tutulur', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'EnvanterApps']);
  await inv._writeVisibleTablesForRole('User', '*');
  const row = tv.find((t) => t.table_name === 'EnvanterApps');
  row.is_active = false; // admin "Pasif yap" ile isaretledi

  const result = await inv._filterTablesByRole(['Inventory', 'EnvanterApps'], 'User');
  assert.deepEqual(result, ['Inventory']);
});

test('filterTablesByRole(): override BASKA bir kullaniciyi ETKILEMEZ', async () => {
  await inv._reconcileTableVisibility(['Inventory', 'Secret']);
  await inv._writeVisibleTablesForRole('User', ['Inventory']);
  const secretId = tv.find((t) => t.table_name === 'Secret').id;
  ov.push({ table_visibility_id: secretId, username: 'ahmet', override_type: 'allow' });

  const result = await inv._filterTablesByRole(['Inventory', 'Secret'], 'User', 'mehmet');
  assert.deepEqual(result, ['Inventory']);
});
