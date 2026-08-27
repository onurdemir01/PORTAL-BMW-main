// server/db/full-backup.cjs — TBMWANS veritabanindaki HER tabloyu gunluk olarak ayri
// bir CSV dosyasina yedekler. Portal sunucusunun /sw/WAS_IMAGES/... yoluna DOGRUDAN
// (ayni NFS/paylasimli mount, kullanici tarafindan dogrulandi) yazma erisimi oldugu
// icin bu is bir AWX/Ansible job'i DEGIL — Portal'in kendi surecinde calisan basit bir
// zamanlanmis gorev (bkz. server/smart/poller.cjs / server/ansible/long-job-watcher.cjs
// ile AYNI setInterval deseni).
//
// Tablo kesfi INFORMATION_SCHEMA.TABLES uzerinden OTOMATIK yapilir — yeni bir tablo
// eklendiginde bu dosyanin GUNCELLENMESINE gerek yoktur. Buyuk tablolar (ör. audit_log)
// icin bellek sismesin diye node-mssql'in DUSUK SEVIYELI streaming Request API'si
// kullanilir (satir satir diske yazilir, TUM recordset bellekte tutulmaz).
'use strict';

const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('./portal-mssql.cjs');

const BLOB_NAME = 'db_full_backup:last_run';

// SAYISAL ENV DOGRULAMASI (2026-08-28): `Number('abc')` NaN doner ve
// `setInterval(fn, NaN)` Node'da **1 ms'de bir** tick demektir — yanlis yazilmis tek bir
// env degeri portali kilitlerdi. Ayrica sinirlar makul araliga kelepcelenir: tick araligi
// 60 dk'yi ASARSA `getHours() === cfg.hour` penceresi hic yakalanamaz ve yedek SESSIZCE
// hic alinmaz (bu, hatadan daha kotudur — kimse fark etmez).
function numEnv(raw, fallback, { min, max }) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function getConfig() {
  return {
    dir: process.env.DB_FULL_BACKUP_DIR || '/sw/WAS_IMAGES/Ansible/Middleware_Inventory/backup/daily_full',
    // Ana backup/ klasoru zaten diger job'larin (mwapps_backup.py, inventory_backup.py, ...)
    // TEK tablo yedekleriyle dolu — bilerek bir alt klasorde tutulur, hangi dosyanin
    // hangi ise ait oldugu KARISMASIN.
    retentionDays: numEnv(process.env.DB_FULL_BACKUP_RETENTION_DAYS, 14, { min: 1, max: 3650 }),
    // 0-23 arasi, gunun hangi SAATINDE (sunucu yerel saati) calisilsin.
    hour: numEnv(process.env.DB_FULL_BACKUP_HOUR, 2, { min: 0, max: 23 }),
    // Ust sinir 60: tick saatlik pencereyi HER ZAMAN yakalayabilmeli.
    checkIntervalMinutes: numEnv(process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES, 15, { min: 1, max: 60 }),
  };
}

// Bellek-ici anlik durum — admin ekrani "Şimdi Çalıştır" sonrasi bunu polling eder.
const state = {
  status: 'idle', // idle | running | done | error
  startedAt: null,
  finishedAt: null,
  tableCount: 0,
  doneCount: 0,
  currentTable: null,
  failedTables: [],
  totalRows: 0,
  removedFiles: 0,
  lastError: null,
};

let _timer = null;
let _lastRunDateStr = null; // 'YYYY-MM-DD' — ayni gun icinde ikinci kez tetiklenmesin

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s.includes('~') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function timestampStr(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

// SIR TASIYAN KOLONLAR (2026-08-28). Yedek `INFORMATION_SCHEMA` uzerinden ISTISNASIZ her
// tabloyu `SELECT *` edip PAYLASIMLI NFS'e duz metin CSV yaziyor ve dosyalar 14 gun orada
// duruyordu. Icinde: `ansible_awx_servers.token/password/client_secret` (AWX'i tam yetkiyle
// kullanmaya yeter), `ocp_cluster_index.token`, `session_token` (oturum calmaya yeter) ve
// `pending_launch_json` (ham extraVars — survey'deki password alanlari dahil).
//
// Repo kurali "parolalar DB'ye yazilmaz, yalnizca vault degiskeninin ADI tutulur" — ama
// DB'de zaten duran bu sirlar mount'a erisen herkese aciliyordu. Tablo bazli bir allowlist
// yerine KOLON ADI bazli maskeleme secildi: yeni bir tablo eklendiginde de otomatik
// kapsanir (allowlist'i guncellemeyi unutmak sessiz bir sizinti olurdu) ve yedek YINE
// eksiksiz kalir — yalnizca hassas HUCRELER maskelenir.
const SECRET_COLUMN_RE = /(^|_)(token|password|passwd|secret|credential|api_key|apikey)($|_)|pending_launch_json/i;
const MASK = '***maskelendi***';

// node-mssql'in streaming Request API'si — buyuk tablolarda TUM sonucu belleğe
// yuklemek yerine satir satir diske yazar.
function backupTable(pool, schema, table, dir, tsStr) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(dir, `${table}.${tsStr}.csv`);
    const ws = fs.createWriteStream(outFile, { encoding: 'utf-8' });
    let rowCount = 0;
    let settled = false;
    let maskedCols = new Set();

    const fail = (err) => {
      if (settled) return;
      settled = true;
      ws.end();
      reject(err);
    };

    // DISK DOLARSA/NFS DUSERSE SUREC COKMESIN: 'error' dinleyicisi olmayan bir
    // WriteStream'de Node `unhandled 'error' event` ile process'i dusurur — gece calisan
    // bir yedek isinin portali komple indirmesi kabul edilemez.
    ws.on('error', fail);

    const request = new sql.Request(pool);
    request.stream = true;

    request.on('recordset', (columns) => {
      const names = Object.keys(columns);
      maskedCols = new Set(names.filter((n) => SECRET_COLUMN_RE.test(n)));
      if (maskedCols.size > 0) {
        console.log(`[DBFullBackup] ${table}: maskelenen kolon(lar) — ${[...maskedCols].join(', ')}`);
      }
      ws.write(names.map(csvEscape).join('~') + '\n');
    });
    request.on('row', (row) => {
      const cells = Object.entries(row).map(([k, v]) => (
        // NULL maskelenmez: "deger yok" bilgisi sir degil ve yedegin butunlugu icin anlamli.
        maskedCols.has(k) && v !== null && v !== undefined ? MASK : csvEscape(v)
      ));
      ws.write(cells.join('~') + '\n');
      rowCount++;
    });
    request.on('error', fail);
    request.on('done', () => {
      if (settled) return;
      settled = true;
      ws.end(() => resolve(rowCount));
    });

    request.query(`SELECT * FROM [${schema}].[${table}]`);
  });
}

async function cleanupOldFiles(dir, cutoffMs) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    const p = path.join(dir, name);
    try {
      const st = await fs.promises.stat(p);
      if (st.isFile() && st.mtimeMs < cutoffMs) {
        await fs.promises.unlink(p);
        removed++;
      }
    } catch {
      /* yoksay — bir sonraki calismada tekrar denenir */
    }
  }
  return removed;
}

async function persistLastRun() {
  try {
    const db = require('./index.cjs');
    const payload = JSON.stringify(state);
    const upd = await db.query(`UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`, [payload, BLOB_NAME]);
    if (!upd.rowCount) {
      await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, payload]);
    }
  } catch (e) {
    console.warn('[DBFullBackup] son calisma durumu kaydedilemedi:', e.message);
  }
}

async function loadPersistedState() {
  try {
    const db = require('./index.cjs');
    const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
    if (rows.length) Object.assign(state, JSON.parse(rows[0].data));
  } catch {
    /* ilk calisma / DB henuz hazir degil — varsayilan idle state kalir */
  }
}

async function runBackup() {
  if (state.status === 'running') return state;
  const cfg = getConfig();
  const pool = await getPool();
  if (!pool) {
    state.status = 'error';
    state.lastError = 'Portal DB bağlantısı yok.';
    await persistLastRun();
    return state;
  }

  state.status = 'running';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.failedTables = [];
  state.totalRows = 0;
  state.doneCount = 0;
  state.currentTable = null;
  state.lastError = null;

  try {
    await fs.promises.mkdir(cfg.dir, { recursive: true });
    const tsStr = timestampStr(new Date());

    const result = await pool.request().query(
      `SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`
    );
    const tables = result.recordset || [];
    state.tableCount = tables.length;

    for (const t of tables) {
      state.currentTable = t.TABLE_NAME;
      try {
        state.totalRows += await backupTable(pool, t.TABLE_SCHEMA, t.TABLE_NAME, cfg.dir, tsStr);
      } catch (e) {
        state.failedTables.push(t.TABLE_NAME);
        console.error(`[DBFullBackup] ${t.TABLE_NAME} yedeklenemedi:`, e.message);
      }
      state.doneCount++;
    }

    state.removedFiles = await cleanupOldFiles(cfg.dir, Date.now() - cfg.retentionDays * 86_400_000);

    state.status = state.failedTables.length > 0 ? 'error' : 'done';
    if (state.failedTables.length > 0) {
      state.lastError = `${state.failedTables.length} tablo yedeklenemedi: ${state.failedTables.join(', ')}`;
    }
    console.log(`[DBFullBackup] tamamlandi — ${state.tableCount} tablo, ${state.totalRows} satir, ${state.failedTables.length} basarisiz.`);
  } catch (e) {
    state.status = 'error';
    state.lastError = e.message;
    console.error('[DBFullBackup] genel hata:', e.message);
  } finally {
    state.currentTable = null;
    state.finishedAt = new Date().toISOString();
    _lastRunDateStr = new Date().toISOString().slice(0, 10);
    await persistLastRun();
  }
  return state;
}

function scheduleTick() {
  const cfg = getConfig();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (now.getHours() !== cfg.hour) return;
  if (_lastRunDateStr === todayStr) return; // bugun zaten calisti
  if (state.status === 'running') return;
  runBackup().catch((e) => console.error('[DBFullBackup] zamanlanmis calisma hatasi:', e.message));
}

function startScheduler() {
  if (_timer) return;
  // Onceki calismalarin tarihini bilelim ki restart sonrasi ayni gun icinde IKINCI
  // kez tetiklenmesin (finishedAt'ten gunu cikar).
  if (state.finishedAt) _lastRunDateStr = state.finishedAt.slice(0, 10);
  const cfg = getConfig();
  _timer = setInterval(scheduleTick, cfg.checkIntervalMinutes * 60 * 1000);
  _timer.unref?.();
}

function initDbFullBackup(app) {
  loadPersistedState().finally(startScheduler);

  app.get('/api/admin/db-full-backup/status', (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    res.json({ ok: true, config: getConfig(), state });
  });

  app.post('/api/admin/db-full-backup/run', (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    if (state.status === 'running') {
      return res.status(409).json({ ok: false, message: 'Zaten çalışıyor.' });
    }
    runBackup().catch((e) => console.error('[DBFullBackup] manuel calisma hatasi:', e.message));
    try {
      require('../audit/index.cjs').auditPortal(req, 'db_full_backup_manual_run', { detail: '' });
    } catch { /* yoksay */ }
    res.json({ ok: true, started: true });
  });

  console.log('[DBFullBackup] endpoints mounted at /api/admin/db-full-backup');
}

module.exports = { initDbFullBackup, runBackup, getConfig };
