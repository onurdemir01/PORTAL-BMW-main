// server/inventory/__tests__/query-guard.test.cjs — /api/inventory/query'nin SQL
// sertlestirmesi (kurumsal AI kod incelemesi, review.md #3/#4). DB gerektirmeyen SAF
// fonksiyon testleri: isSelectOnly (banned-keyword + coklu-ifade reddi) ve
// extractReferencedTables (FROM/JOIN sonrasi tablo adi cikarimi — /query route'unun
// tablo-whitelist uygulamasinin girdisi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../db/index.cjs');
const {
  _isSelectOnly: isSelectOnly, _extractReferencedTables: extractReferencedTables,
  _writeSavedQueries: writeSavedQueries, _buildAdvancedWhereClause: buildAdvancedWhereClause,
  _setSqCache: setSqCache, _getSqCache: getSqCache,
} = require('../index.cjs');

test('isSelectOnly(): SELECT olmayan ifadeler reddedilir', () => {
  assert.equal(isSelectOnly('DROP TABLE users'), false);
  assert.equal(isSelectOnly('INSERT INTO x VALUES (1)'), false);
});

test('isSelectOnly(): banned-list icindeki anahtar kelimeler (SELECT icinde bile) reddedilir', () => {
  assert.equal(isSelectOnly("SELECT * FROM x WHERE 1=1; EXEC xp_cmdshell('dir')"), false);
  assert.equal(isSelectOnly('SELECT * FROM OPENQUERY(srv, \'SELECT 1\')'), false);
});

test('isSelectOnly(): coklu ifade (noktali virgul) reddedilir — tek-ifade zorunlulugu (review.md #4)', () => {
  assert.equal(isSelectOnly('SELECT * FROM users; SELECT * FROM secrets'), false);
});

// ai_review_3.md #6: OPENQUERY zaten banned-list'te vardi (dogrulandi); genisletme:
// OPENDATASOURCE eklendi + 4-parcali linked-server adlandirmasi (OPENQUERY/OPENDATASOURCE
// disindaki tek linked-server erisim yolu) ayrica reddedilir.
test('isSelectOnly(): OPENDATASOURCE reddedilir', () => {
  assert.equal(isSelectOnly("SELECT * FROM OPENDATASOURCE('SQLNCLI', '...').db.schema.table"), false);
});

test('isSelectOnly(): 4-parcali linked-server adlandirmasi (sunucu.db.sema.tablo) reddedilir', () => {
  assert.equal(isSelectOnly('SELECT * FROM LinkedServer.SomeDb.dbo.SomeTable'), false);
  assert.equal(isSelectOnly('SELECT * FROM users u JOIN LinkedServer.SomeDb.dbo.SomeTable t ON 1=1'), false);
});

test('isSelectOnly(): tek noktali (dbo.Tablo) yerel referanslar linked-server olarak yanlislikla reddedilmez', () => {
  assert.equal(isSelectOnly('SELECT * FROM dbo.users'), true);
});

test('isSelectOnly(): sondaki tek noktali virgul (trailing) kabul edilir', () => {
  assert.equal(isSelectOnly('SELECT * FROM users;'), true);
});

test('isSelectOnly(): mesru tek SELECT kabul edilir', () => {
  assert.equal(isSelectOnly('SELECT id, name FROM users WHERE active = 1'), true);
  assert.equal(isSelectOnly('select * from dbo.users u join apps a on a.id = u.app_id'), true);
});

test('extractReferencedTables(): basit FROM/JOIN tablo adlarini cikarir', () => {
  const tables = extractReferencedTables('SELECT * FROM users u JOIN apps a ON a.id = u.app_id');
  assert.deepEqual(new Set(tables), new Set(['users', 'apps']));
});

test('extractReferencedTables(): schema-onekli (dbo.Table) ve koseli parantezli isimleri de yakalar', () => {
  const tables = extractReferencedTables('SELECT * FROM dbo.portal_env_overrides p JOIN [dbo].[logx_audit_logs] l ON 1=1');
  assert.deepEqual(new Set(tables), new Set(['portal_env_overrides', 'logx_audit_logs']));
});

test('extractReferencedTables(): FROM/JOIN yoksa bos liste doner (ör. SELECT 1)', () => {
  assert.deepEqual(extractReferencedTables('SELECT 1 AS ok'), []);
});

// ── buildAdvancedWhereClause(): artik WHERE oneki YOK (review.md #8) ──────────────────
test('buildAdvancedWhereClause(): WHERE oneki olmadan yalniz kosul metnini doner', () => {
  const fakeReq = { input: () => {} };
  const clause = buildAdvancedWhereClause(
    { mode: 'AND', filters: [{ col: 'name', op: 'equals', value: 'x' }] },
    ['name'],
    fakeReq
  );
  assert.equal(clause.startsWith('WHERE'), false);
  assert.match(clause, /^CAST\(\[name\] AS NVARCHAR\(MAX\)\) = @af0$/);
});

test('buildAdvancedWhereClause(): filterGroup boşsa bos string doner', () => {
  const fakeReq = { input: () => {} };
  assert.equal(buildAdvancedWhereClause(null, [], fakeReq), '');
  assert.equal(buildAdvancedWhereClause({ filters: [] }, [], fakeReq), '');
});

// ── writeSavedQueries(): delete-all+reinsert yerine fark-bazli UPSERT (review.md #12/#13) ──
test('writeSavedQueries(): sadece DEGISEN kayitlar UPSERT edilir, degismeyenler atlanir', async (t) => {
  setSqCache([
    { name: 'q1', sql: 'SELECT 1', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
    { name: 'q2', sql: 'SELECT 2', isPublished: false, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
  ]);
  const writes = [];
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) { writes.push(params[params.length - 1]); return { rowCount: 1 }; }
    if (/^DELETE/.test(sql)) { writes.push('DELETE:' + JSON.stringify(params)); return { rowCount: 0 }; }
    return { rows: [], rowCount: 0 };
  });
  // q1 aynen kaliyor, q2'nin sql'i degisiyor
  await writeSavedQueries([
    { name: 'q1', sql: 'SELECT 1', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
    { name: 'q2', sql: 'SELECT 2 CHANGED', isPublished: false, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
  ]);
  assert.deepEqual(writes, ['q2'], 'yalniz degisen q2 UPDATE edilmeli, degismeyen q1 atlanmali, hicbir DELETE calismamali (ikisi de listede kaliyor)');
});

test('writeSavedQueries(): listeden CIKARILAN kayit silinir, hicbir sey once toptan silinmez', async (t) => {
  setSqCache([
    { name: 'keep', sql: 'SELECT 1', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
    { name: 'drop', sql: 'SELECT 2', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
  ]);
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push(sql.trim().split(/\s+/)[0]);
    if (/^DELETE/.test(sql)) { assert.deepEqual(params, ['drop']); return { rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });
  // 'keep' de bilerek DEGISTIRILIYOR (aksi halde diff hicbir UPDATE tetiklemez) — boylece
  // hem UPDATE hem DELETE calisiyor ve DELETE'in upsert dongusunden SONRA geldigi dogrulanabilir.
  await writeSavedQueries([
    { name: 'keep', sql: 'SELECT 1 CHANGED', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
  ]);
  assert.deepEqual(calls, ['UPDATE', 'DELETE'], 'once degisen kaydin UPSERT\'i, SONRA kaldirilanin DELETE\'i calismali — hicbir zaman once toptan silme yok');
});

test('writeSavedQueries(): bos cache ile ilk yazim tum kayitlari yeni sayar (migrasyon senaryosu)', async (t) => {
  setSqCache(null);
  let updateCount = 0;
  t.mock.method(db, 'query', async (sql) => {
    if (/^UPDATE/.test(sql)) { updateCount++; return { rowCount: 0 }; } // hicbiri yok, INSERT'e duser
    return { rows: [], rowCount: 1 };
  });
  await writeSavedQueries([
    { name: 'n1', sql: 'SELECT 1', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
    { name: 'n2', sql: 'SELECT 2', isPublished: true, isDefault: false, publishedBy: 'a', description: '', savedAt: '2026-01-01' },
  ]);
  assert.equal(updateCount, 2);
  assert.equal(getSqCache().length, 2);
});
