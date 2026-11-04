// server/nginx-loadtest/__tests__/db-tekrar.test.cjs - db.query yeniden deneme secenegi (2026-11-04, kosu silme incelemesi).
//
//   DBT1 varsayilan: gecici baglanti hatasinda (ECONNRESET) sorgu BIR KEZ yeniden calisir (eski davranis aynen)
//   DBT2 { tekrar: false }: yeniden calismaz, hata cagirana gider (kosu silme: COMMIT'ten sonra kopan baglantida ikinci
//        calisma 0 satir bulup silinmis kaydi "kosu_yok" diye raporlardi); kalici hata zaten yeniden denenmez
//   DBT3 kosu INSERT'i (OUTPUT INSERTED.id + SELECT ... WHERE EXISTS) adaptSql'den bozulmadan gecer (RETURNING yok)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const cagri = [];
let hatalar = [];
const p = Module._resolveFilename(path.join(__dirname, '../../db/portal-mssql.cjs'), module);
require.cache[p] = {
  id: p, filename: p, loaded: true,
  exports: {
    getPool: async () => ({
      request: () => ({
        input() {},
        query: async (sql) => {
          cagri.push(sql);
          const h = hatalar.shift();
          if (h) throw h;
          return { recordset: [{ id: 1 }], rowsAffected: [1] };
        },
      }),
    }),
  },
};
const db = require('../../db/index.cjs');
const kopma = () => Object.assign(new Error('Connection lost - read ECONNRESET'), { code: 'ECONNRESET' });

test('DBT1 varsayilan: gecici hata bir kez yeniden denenir', { timeout: 5000 }, async () => {
  cagri.length = 0;
  hatalar = [kopma()];
  const r = await db.query('SELECT 1 AS id', []);
  assert.deepEqual([r.rows, cagri.length], [[{ id: 1 }], 2]);
});

test('DBT2 { tekrar: false }: yeniden calismaz, hata cagirana gider', { timeout: 5000 }, async () => {
  cagri.length = 0;
  hatalar = [kopma()];
  await assert.rejects(db.query('DELETE FROM t WHERE id = $1', [1], { tekrar: false }), /ECONNRESET/);
  assert.equal(cagri.length, 1);
  // Bos secenek nesnesi varsayilan gibi davranir.
  cagri.length = 0;
  hatalar = [kopma()];
  await db.query('SELECT 1 AS id', [], {});
  assert.equal(cagri.length, 2);
  // Kalici (gecici olmayan) hata hic yeniden denenmez.
  cagri.length = 0;
  hatalar = [new Error('Invalid column name')];
  await assert.rejects(db.query('SELECT x', []), /Invalid column/);
  assert.equal(cagri.length, 1);
});

test('DBT3 kosu INSERT ... OUTPUT ... SELECT ... WHERE EXISTS adaptSql ile bozulmaz', () => {
  const sql = `INSERT INTO nginx_loadtest_kosular (senaryo_id, on_kontrol_kosu_id) OUTPUT INSERTED.id SELECT $1, $2 WHERE $2 IS NULL OR EXISTS (SELECT 1 FROM nginx_loadtest_kosular o WITH (UPDLOCK, HOLDLOCK) WHERE o.id = $2 AND o.islem = 'on_kontrol')`;
  assert.equal(db._adaptSql(sql), sql.replace(/\$(\d+)/g, '@p$1'));
});
