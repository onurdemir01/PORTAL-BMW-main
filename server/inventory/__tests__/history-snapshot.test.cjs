// server/inventory/__tests__/history-snapshot.test.cjs
//
// Envanter geçmişi (SCD-2) motorunun davranış testleri. DB yerine bellek içi sahte bir
// `db` modülü enjekte edilir (history.cjs `require`'ı tembel yaptığı için mümkün) —
// böylece gerçek MSSQL olmadan TÜM diff mantığı çalıştırılır.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// ── Sahte DB ───────────────────────────────────────────────────────────────────
function makeFakeDb() {
  const state = { source: [], history: [], runs: [], sourceExists: true, nextId: 1 };

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES')) {
      return { rows: state.sourceExists ? [{ ok: 1 }] : [], rowCount: 0 };
    }
    if (/^SELECT \* FROM dbo\./.test(s)) {
      return { rows: state.source.map((r) => ({ ...r })), rowCount: state.source.length };
    }
    if (s.startsWith('SELECT row_key, row_hash FROM inventory_history')) {
      const t = params[0];
      const rows = state.history
        .filter((h) => h.table_name === t && h.valid_to === null)
        .map((h) => ({ row_key: h.row_key, row_hash: h.row_hash }));
      return { rows, rowCount: rows.length };
    }
    if (s.startsWith('SELECT row_key, row_json FROM inventory_history')) {
      const [t, at] = params;
      const rows = state.history
        .filter((h) => h.table_name === t && h.valid_from <= at && (h.valid_to === null || h.valid_to > at))
        .map((h) => ({ row_key: h.row_key, row_json: h.row_json }));
      return { rows, rowCount: rows.length };
    }
    if (s.startsWith('UPDATE inventory_history SET valid_to')) {
      const [validTo, t, ...keys] = params;
      let n = 0;
      for (const h of state.history) {
        if (h.table_name === t && h.valid_to === null && keys.includes(h.row_key)) {
          h.valid_to = validTo;
          n++;
        }
      }
      return { rows: [], rowCount: n };
    }
    if (s.startsWith('INSERT INTO inventory_history (')) {
      for (let i = 0; i < params.length; i += 5) {
        state.history.push({
          id: state.nextId++,
          table_name: params[i], row_key: params[i + 1], row_hash: params[i + 2],
          row_json: params[i + 3], valid_from: params[i + 4], valid_to: null,
        });
      }
      return { rows: [], rowCount: params.length / 5 };
    }
    if (s.startsWith('INSERT INTO inventory_history_runs')) {
      state.runs.push({
        table_name: params[0], started_at: params[1], finished_at: params[2],
        source_rows: params[3], added: params[4], changed: params[5],
        removed: params[6], status: params[7], message: params[8],
      });
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('FROM inventory_history_runs')) {
      return { rows: state.runs.slice().reverse(), rowCount: state.runs.length };
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM inventory_history')) {
      const [t, at] = params;
      const n = state.history.filter(
        (h) => h.table_name === t && h.valid_from <= at && (h.valid_to === null || h.valid_to > at),
      ).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    throw new Error('Sahte DB bu sorguyu bilmiyor: ' + s.slice(0, 90));
  }

  return { query, isAvailable: async () => true, __state: state };
}

// history.cjs'in gorecegi `../db/index.cjs`i sahtesiyle degistir.
const DB_PATH = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.cjs'));
const fake = makeFakeDb();
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: fake };

const history = require('../history.cjs');
const { getTable } = require('../history-config.cjs');

const DEF = getTable('Inventory');
const T0 = new Date('2026-09-01T00:00:00Z');
const T1 = new Date('2026-09-02T00:00:00Z');
const T2 = new Date('2026-09-03T00:00:00Z');

function reset() {
  fake.__state.source = [];
  fake.__state.history = [];
  fake.__state.runs = [];
  fake.__state.sourceExists = true;
}

// ── Saf yardimcilar ────────────────────────────────────────────────────────────

test('last_seen_at DEGISSE BILE icerik hash-i AYNI kalir (en kritik ayar)', () => {
  const a = { host: 'H1', os: 'RHEL8', last_seen_at: new Date('2026-09-01') };
  const b = { host: 'H1', os: 'RHEL8', last_seen_at: new Date('2026-09-07') };
  const ha = history._sha256(JSON.stringify(history._contentOf(a, DEF.volatile)));
  const hb = history._sha256(JSON.stringify(history._contentOf(b, DEF.volatile)));
  assert.strictEqual(ha, hb,
    'last_seen_at hash-e girseydi HER satir HER gece "degisti" sayilirdi');
});

test('gercek veri degisirse hash DEGISIR', () => {
  const a = { host: 'H1', os: 'RHEL8', last_seen_at: new Date('2026-09-01') };
  const b = { host: 'H1', os: 'RHEL9', last_seen_at: new Date('2026-09-01') };
  assert.notStrictEqual(
    history._sha256(JSON.stringify(history._contentOf(a, DEF.volatile))),
    history._sha256(JSON.stringify(history._contentOf(b, DEF.volatile))),
  );
});

test('NULL ile bos dize AYNI sayilir (yukleyiciler ikisini de yaziyor)', () => {
  assert.strictEqual(history._normValue(null), history._normValue(''));
  assert.strictEqual(history._normValue(undefined), '');
});

test('uzun anahtarlar kisaltilir ama CAKISMAZ', () => {
  const long = (suffix) => ({ host: 'x'.repeat(500) + suffix });
  const k1 = history._rowKeyOf(long('A'), ['host']);
  const k2 = history._rowKeyOf(long('B'), ['host']);
  assert.ok(k1.length <= 450, 'row_key indekslenebilir sinirin altinda olmali');
  assert.notStrictEqual(k1, k2, 'kisaltma iki farkli satiri ayni anahtara dusurmemeli');
});

test('tablo adi allowlist DISINDAN gelemez (SQL enjeksiyonu)', () => {
  assert.throws(() => history._safeTableName({ table: 'Inventory; DROP TABLE x--' }));
  assert.strictEqual(history._safeTableName({ table: 'Inventory' }), 'Inventory');
});

// ── Anlik goruntu akisi ────────────────────────────────────────────────────────

test('ILK calistirma: tum satirlar "eklendi" olarak acilir', async () => {
  reset();
  fake.__state.source = [
    { host: 'H1', os: 'RHEL8', last_seen_at: T0 },
    { host: 'H2', os: 'RHEL9', last_seen_at: T0 },
  ];
  const r = await history.snapshotTable(DEF, T0);
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual([r.added, r.changed, r.removed], [2, 0, 0]);
  assert.strictEqual(fake.__state.history.filter((h) => h.valid_to === null).length, 2);
});

test('DEGISIKLIK YOKSA hicbir sey yazilmaz (tekrar calistirma guvenli)', async () => {
  // Yalnizca last_seen_at ilerledi — gercek hayatta HER GECE olan sey budur.
  fake.__state.source = [
    { host: 'H1', os: 'RHEL8', last_seen_at: T1 },
    { host: 'H2', os: 'RHEL9', last_seen_at: T1 },
  ];
  const before = fake.__state.history.length;
  const r = await history.snapshotTable(DEF, T1);
  assert.deepStrictEqual([r.added, r.changed, r.removed], [0, 0, 0]);
  assert.strictEqual(fake.__state.history.length, before, 'gecmise satir EKLENMEMELI');
});

test('DEGISEN satir: eskisi kapatilir, yenisi acilir; SILINEN satir kapatilir', async () => {
  fake.__state.source = [
    { host: 'H1', os: 'RHEL9', last_seen_at: T2 }, // degisti
    { host: 'H3', os: 'RHEL9', last_seen_at: T2 }, // yeni
    // H2 kayboldu
  ];
  const r = await history.snapshotTable(DEF, T2);
  assert.deepStrictEqual([r.added, r.changed, r.removed], [1, 1, 1]);

  const open = fake.__state.history.filter((h) => h.valid_to === null).map((h) => h.row_key);
  assert.deepStrictEqual(open.sort(), ['H1', 'H3']);
  const h2 = fake.__state.history.find((h) => h.row_key === 'H2');
  assert.deepStrictEqual(h2.valid_to, T2, 'kaybolan satir kapatilmali');
});

test('GECMISE BAKIS: her tarih kendi dogru halini verir', async () => {
  const a0 = await history.rowsAt('Inventory', new Date('2026-09-01T12:00:00Z'));
  assert.deepStrictEqual(a0.map((r) => r.key).sort(), ['H1', 'H2']);
  assert.strictEqual(a0.find((r) => r.key === 'H1').data.os, 'RHEL8', '1 Eylul-de H1 RHEL8-di');

  const a2 = await history.rowsAt('Inventory', new Date('2026-09-03T12:00:00Z'));
  assert.deepStrictEqual(a2.map((r) => r.key).sort(), ['H1', 'H3']);
  assert.strictEqual(a2.find((r) => r.key === 'H1').data.os, 'RHEL9');
});

test('FARK: eklenen / silinen / degisen alan alan cikar', async () => {
  const d = await history.diff('Inventory',
    new Date('2026-09-01T12:00:00Z'), new Date('2026-09-03T12:00:00Z'));
  assert.deepStrictEqual(d.added.map((r) => r.key), ['H3']);
  assert.deepStrictEqual(d.removed.map((r) => r.key), ['H2']);
  assert.strictEqual(d.changed.length, 1);
  assert.deepStrictEqual(d.changed[0].fields.os, { before: 'RHEL8', after: 'RHEL9' });
});

test('ANI DUSUS: bozuk tarama gecmise KITLESEL SILME yazmaz', async () => {
  reset();
  fake.__state.source = Array.from({ length: 100 }, (_, i) => ({ host: 'S' + i, os: 'RHEL8' }));
  await history.snapshotTable(DEF, T0);
  assert.strictEqual(fake.__state.history.filter((h) => h.valid_to === null).length, 100);

  // Envanter job-i yarim kaldi: 100 satirin yalnizca 10-u geldi.
  fake.__state.source = fake.__state.source.slice(0, 10);
  const r = await history.snapshotTable(DEF, T1);
  assert.strictEqual(r.status, 'aborted');
  assert.deepStrictEqual([r.added, r.changed, r.removed], [0, 0, 0]);
  assert.strictEqual(fake.__state.history.filter((h) => h.valid_to === null).length, 100,
    'hicbir satir kapatilmamali — geri alinamaz veri kaybi olurdu');
  assert.match(fake.__state.runs.at(-1).message, /ani dustu/i);
});

test('KAYNAK TABLO YOKSA hata degil, "skipped" kaydi', async () => {
  reset();
  fake.__state.sourceExists = false;
  const r = await history.snapshotTable(DEF, T0);
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(fake.__state.history.length, 0);
});

test('her calistirma "Tarama Sagligi" icin kaydediliyor', async () => {
  const runs = await history.recentRuns(10);
  assert.ok(runs.length > 0);
  assert.ok('status' in runs[0] && 'source_rows' in runs[0]);
});
