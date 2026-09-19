// server/audit/__tests__/audit-spool.test.cjs
// DENETIM KAYDI KAYBOLMASIN — 2026-09-18 uretim olayinin birebir testi.
//
// O gun `portal_audit_logs`a yazim bes saat dustu ve 25 kayit KALICI OLARAK
// KAYBOLDU:
//     [ERROR] [audit:portal_audit_logs] write failed:
//             The transaction log for database '...' is full due to 'LOG_BACKUP'
// `writeEntry` hatayi loglayip yutuyordu. `docs/DEPLOYMENT.md` ise "AUDIT hicbir
// sey kaybolmaz" diyor.
//
// Bu testler GERCEK zinciri sahte bir DB ile kosturur: kaynak taramasi bu sinifi
// goremez — kapinin var olmasi yetmez, DB dustugunde CALISMASI gerekir.
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Spool dosyasi LOG_DIR'e yazilir; testler gercek `logs/` dizinini KIRLETMEZ.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-spool-'));
process.env.LOG_DIR = TMP;

// Sahte DB: `dbBozuk` true iken her sorgu patlar (uretimdeki "log is full" hali).
let tablo = [];
let dbBozuk = false;
let sonrakiId = 1;
const db = require('../../db/index.cjs');
db.query = async (sql, params) => {
  if (dbBozuk) throw new Error("The transaction log for database 'TBMWANS' is full due to 'LOG_BACKUP'");
  const s = String(sql).replace(/\s+/g, ' ');
  if (s.includes('SELECT TOP 1 entry_hash')) {
    return { rows: tablo.length ? [{ entry_hash: tablo[tablo.length - 1].entry_hash }] : [] };
  }
  if (s.startsWith('INSERT INTO')) {
    tablo.push({
      id: sonrakiId++,
      username: params[1], action: params[6], detail: params[8],
      prev_hash: params[10], entry_hash: params[11],
    });
    return { rowCount: 1 };
  }
  if (s.includes('COUNT')) return { rows: [{ n: tablo.length }] };
  return { rows: tablo.map((r) => ({ ...r })) };
};

const { createAuditChain } = require('../index.cjs');
const spool = require('../spool.cjs');

const TABLO = 'test_audit_logs';
let zincir;

beforeEach(() => {
  tablo = [];
  sonrakiId = 1;
  dbBozuk = false;
  try {
    fs.unlinkSync(spool.spoolPath(TABLO));
  } catch {
    /* yoksay */
  }
  zincir = createAuditChain(TABLO);
});
afterEach(() => {
  try {
    fs.unlinkSync(spool.spoolPath(TABLO));
  } catch {
    /* yoksay */
  }
});

// AS1 — ASIL OLAY. DB dustugunde kayit KAYBOLMAZ, diske alinir.
test('AS1 DB dustugunde kayit SPOOL`a aliniyor, kaybolmuyor', async () => {
  dbBozuk = true;
  await zincir.log({ username: 'uxmid', action: 'scalex_stop', detail: 'prod' });
  assert.equal(tablo.length, 0, 'DB bozukken tabloya yazilmis');
  assert.equal(zincir.spoolDepth(), 1, 'kayit spool`a ALINMADI — KAYIP');
});

// AS2 — DB DONUNCE AKTARILIYOR ve icerik KORUNUYOR.
test('AS2 DB donunce bekleyen kayitlar aktariliyor', async () => {
  dbBozuk = true;
  for (const a of ['scalex_stop', 'scalex_restore', 'logx_download']) {
    await zincir.log({ username: 'uxmid', action: a, detail: 'd-' + a });
  }
  assert.equal(zincir.spoolDepth(), 3);

  dbBozuk = false;
  const r = await zincir.drainSpool();
  assert.equal(r.drained, 3, 'hepsi aktarilmadi');
  assert.equal(zincir.spoolDepth(), 0, 'spool bosalmadi');
  assert.deepEqual(
    tablo.map((x) => x.action),
    ['scalex_stop', 'scalex_restore', 'logx_download'],
    'SIRA bozuldu — hash zinciri sirali bir yapidir',
  );
});

// AS3 — EN KRITIK: aktarim sonrasi HASH ZINCIRI SAGLAM.
// Spool hesaplanmis hash saklasaydi, beklerken yazilan kayitlar yuzunden
// `prev_hash` ZATEN YANLIS olurdu ve zincir KIRIK raporlanirdi.
test('AS3 spool aktariminda hash zinciri KIRILMIYOR', async () => {
  await zincir.log({ username: 'a', action: 'once', detail: '1' });

  dbBozuk = true;
  await zincir.log({ username: 'b', action: 'bekleyen', detail: '2' });

  dbBozuk = false;
  // Spool beklerken BASKA bir kayit DB'ye giriyor — `prev_hash` degisiyor.
  await zincir.log({ username: 'c', action: 'arada', detail: '3' });
  await zincir.drainSpool();

  const v = await zincir.verifyChain();
  assert.equal(v.broken, 0, `zincir KIRIK: ilk bozuk id=${v.firstBrokenId}`);
  assert.equal(tablo.length, 3);
  // Bekleyen kayit EN SONA girer (aktarim anindaki gercek prev_hash ile).
  assert.equal(tablo[2].action, 'bekleyen');
  assert.equal(tablo[2].prev_hash, tablo[1].entry_hash, 'prev_hash aktarim aninda hesaplanmamis');
});

// AS4 — `getLastHash` HATADA FIRLAMALI. Onceden '' donuyordu: SELECT dusup
// INSERT basarili oldugunda `prev_hash=''` yazilir ve zincir SESSIZCE kirilirdi.
test('AS4 hash okunamazsa yazim DUSER (sessiz kirik zincir uretmez)', async () => {
  await zincir.log({ username: 'a', action: 'ilk', detail: '1' });
  const ilkHash = tablo[0].entry_hash;

  // SELECT dusuyor ama INSERT calisiyor olsa bile yazim tumuyle dusmeli.
  const gercek = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes('SELECT TOP 1 entry_hash')) throw new Error('SELECT dustu');
    return gercek(sql, params);
  };
  try {
    await zincir.log({ username: 'b', action: 'ikinci', detail: '2' });
  } finally {
    db.query = gercek;
  }

  assert.equal(tablo.length, 1, 'bos prev_hash ile kayit YAZILDI — zincir kirildi');
  assert.equal(zincir.spoolDepth(), 1, 'kayit spool`a alinmadi');

  await zincir.drainSpool();
  assert.equal(tablo.length, 2);
  assert.equal(tablo[1].prev_hash, ilkHash, 'prev_hash bos yazilmis');
  assert.equal((await zincir.verifyChain()).broken, 0);
});

// AS5 — GEVSEMEDIGINI KANITLA: DB saglamken spool HIC kullanilmamali.
test('AS5 DB saglamken spool BOS kaliyor', async () => {
  await zincir.log({ username: 'a', action: 'normal', detail: '1' });
  assert.equal(tablo.length, 1, 'saglam DB`de kayit yazilmadi');
  assert.equal(zincir.spoolDepth(), 0, 'gereksiz yere spool`a yazildi');
});

// AS6 — KISMI AKTARIM: ortada DB yine duserse KALANLAR KORUNUR.
test('AS6 aktarim ortasinda DB duserse kalanlar spool`da KALIYOR', async () => {
  dbBozuk = true;
  for (const a of ['bir', 'iki', 'uc']) await zincir.log({ username: 'u', action: a, detail: a });

  dbBozuk = false;
  let sayac = 0;
  const gercek = db.query;
  db.query = async (sql, params) => {
    if (String(sql).startsWith('INSERT INTO') && ++sayac > 1) throw new Error('DB yine dustu');
    return gercek(sql, params);
  };
  try {
    await zincir.drainSpool();
  } finally {
    db.query = gercek;
  }

  assert.equal(tablo.length, 1, 'yalnizca ilki yazilmaliydi');
  assert.equal(zincir.spoolDepth(), 2, 'kalan iki kayit KAYBOLDU');
  await zincir.drainSpool();
  assert.equal(tablo.length, 3, 'ikinci turda kalanlar aktarilmadi');
  assert.deepEqual(tablo.map((x) => x.action), ['bir', 'iki', 'uc'], 'SIRA bozuldu');
});
