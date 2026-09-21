// server/db/housekeeping.cjs — TBMWANS doluluk gozlemi + gece temizligi + Teams uyarisi.
//
// NEDEN (2026-09-18): Veri dosyasi (TBMWANS_FG_DATA.ndf, 10 GB ust sinir) %96'ya, log
// dosyasi iki gun ust uste %100'e geldi; is ancak "log full" hatasiyla dusunce fark edildi.
// Bu modul uc sey yapar:
//   1. Doluluk: sys.database_files + FILEPROPERTY('SpaceUsed') ile veri/log dosyalarinin
//      dolulugu, ust siniri, (izin varsa) diskteki bos alan, log_reuse_wait_desc ve en buyuk
//      tablolar — Admin > DB Yedekleme ekraninda gosterilir (GET /api/admin/db-usage).
//   2. Uyari: herhangi bir dosya esigi (DB_USAGE_ALERT_PERCENT, varsayilan %85) asarsa
//      Teams webhook'una kart gider — dosya basina GUNDE BIR kez (spam degil, hatirlatma).
//      Webhook: DB_USAGE_ALERT_WEBHOOK_URL, yoksa TEAMS_LONGJOB_WEBHOOK_URL (ayni kanal).
//   3. Temizlik: logx_v2_jobs/requests satirlari 8 bin satirla 1,1 GB tutuyordu — satir
//      basina ~70 KB JSON (discovery/artifact blob'lari) ve HIC saklama yoktu. Gece
//      (DB_HOUSEKEEPING_HOUR) once eski JSON kolonlari NULL'lanir (LOGX_V2_BLOB_RETENTION_DAYS),
//      daha eski satirlar silinir (LOGX_V2_ROW_RETENTION_DAYS; jobs/downloads/ingest
//      ON DELETE CASCADE). Her adim KUCUK PARTILERLE (TOP N) yapilir — tek buyuk
//      DELETE/UPDATE transaction log'unu doldurur (Ansible nginx_audit'te yasandi).
//
// Zamanlayici deseni server/db/full-backup.cjs ile AYNI (setInterval + saat penceresi +
// portal_config_blobs'ta son calisma). Buradaki numEnv() de oradaki ile ayni tuzaklari
// (NaN -> 1 ms tick, '' -> 0) kapatir.
'use strict';

const { getPool, sql } = require('./portal-mssql.cjs');

const BLOB_NAME = 'db_housekeeping:last_run';

function numEnv(raw, fallback, { min, max }) {
  const text = String(raw ?? '').trim();
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function getConfig() {
  return {
    hour: numEnv(process.env.DB_HOUSEKEEPING_HOUR, 3, { min: 0, max: 23 }),
    checkIntervalMinutes: numEnv(process.env.DB_HOUSEKEEPING_CHECK_INTERVAL_MINUTES, 15, { min: 1, max: 60 }),
    alertPercent: numEnv(process.env.DB_USAGE_ALERT_PERCENT, 85, { min: 50, max: 99 }),
    webhookUrl: (process.env.DB_USAGE_ALERT_WEBHOOK_URL || process.env.TEAMS_LONGJOB_WEBHOOK_URL || '').trim(),
    logxBlobRetentionDays: numEnv(process.env.LOGX_V2_BLOB_RETENTION_DAYS, 30, { min: 1, max: 3650 }),
    logxRowRetentionDays: numEnv(process.env.LOGX_V2_ROW_RETENTION_DAYS, 180, { min: 7, max: 3650 }),
    batchSize: numEnv(process.env.DB_HOUSEKEEPING_BATCH, 2000, { min: 100, max: 50000 }),
  };
}

const state = {
  status: 'idle', // idle | running | done | error
  startedAt: null,
  finishedAt: null,
  logxBlobsCleared: 0,
  logxRequestsDeleted: 0,
  lastError: null,
  alertsSent: {}, // { [fileName]: 'YYYY-MM-DD' } — dosya basina gunde bir uyari
  lastUsage: null, // son okunan doluluk ozeti (ekran icin, DB'ye gitmeden)
};

let _timer = null;
let _lastRunDateStr = null;

// ── Doluluk ──────────────────────────────────────────────────────────────────────

// Sayfa = 8 KB; size/128 = MB. max_size: -1 sinirsiz, 0 buyumez, aksi halde sayfa.
// (Log dosyasinda "sinirsiz" 268435456 sayfa = 2 TB olarak gelir — o da sinirsiz sayilir.)
const UNLIMITED_PAGES = 268435456;

function fileCapMb(row) {
  if (row.max_size === -1 || row.max_size >= UNLIMITED_PAGES) return null;
  if (row.max_size === 0) return row.size_mb; // buyumez: mevcut boyut tavan
  return row.max_size / 128;
}

// Uyari yuzdesi: ust sinir varsa ona gore; yoksa diskteki bos alana gore
// (kullanilan / (dosya + bos disk)). Disk bilgisi yoksa dosya ici doluluk.
function effectivePercent(f) {
  if (f.cap_mb) return (100 * f.used_mb) / f.cap_mb;
  if (f.volume_free_mb != null) return (100 * f.used_mb) / (f.size_mb + f.volume_free_mb);
  return f.pct_of_file;
}

async function readUsage() {
  const pool = await getPool();
  if (!pool) throw new Error('Portal DB bağlantısı yok.');

  const filesRs = await pool.request().query(`
    SELECT f.name, f.type_desc, f.physical_name,
           CAST(f.size / 128.0 AS DECIMAL(12,1)) AS size_mb,
           CAST(FILEPROPERTY(f.name, 'SpaceUsed') / 128.0 AS DECIMAL(12,1)) AS used_mb,
           f.max_size, f.growth, f.is_percent_growth
    FROM sys.database_files f`);

  // Disk bos alani VIEW SERVER STATE ister — TBMWANS_usr'da olmayabilir; olmazsa null.
  let volumes = new Map();
  try {
    const volRs = await pool.request().query(`
      SELECT mf.name, vs.volume_mount_point,
             CAST(vs.total_bytes / 1048576.0 AS DECIMAL(14,1)) AS total_mb,
             CAST(vs.available_bytes / 1048576.0 AS DECIMAL(14,1)) AS free_mb
      FROM sys.master_files mf
      CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
      WHERE mf.database_id = DB_ID()`);
    for (const r of volRs.recordset) volumes.set(r.name, r);
  } catch {
    /* izin yok — dosya ici dolulukla yetinilir */
  }

  let dbInfo = { log_reuse_wait_desc: null, recovery_model_desc: null };
  try {
    const rs = await pool.request().query(
      `SELECT log_reuse_wait_desc, recovery_model_desc FROM sys.databases WHERE name = DB_NAME()`,
    );
    if (rs.recordset[0]) dbInfo = rs.recordset[0];
  } catch {
    /* yoksay */
  }

  // En buyuk tablolar — TUM indeksler dahil ayrilmis alan (yalniz clustered degil).
  const topRs = await pool.request().query(`
    SELECT TOP 15 t.name,
           SUM(CASE WHEN i.index_id IN (0,1) THEN p.rows ELSE 0 END) AS rows_count,
           CAST(SUM(a.total_pages) * 8 / 1024.0 AS DECIMAL(12,1)) AS reserved_mb
    FROM sys.tables t
    JOIN sys.indexes i ON t.object_id = i.object_id
    JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
    JOIN sys.allocation_units a ON p.partition_id = a.container_id
    GROUP BY t.name
    ORDER BY reserved_mb DESC`);

  const files = filesRs.recordset.map((r) => {
    const size_mb = Number(r.size_mb);
    const used_mb = Number(r.used_mb);
    const vol = volumes.get(r.name);
    const f = {
      name: r.name,
      kind: r.type_desc === 'LOG' ? 'log' : 'data',
      physical_name: r.physical_name,
      size_mb,
      used_mb,
      cap_mb: fileCapMb({ ...r, size_mb }),
      pct_of_file: size_mb > 0 ? (100 * used_mb) / size_mb : 0,
      growth: r.is_percent_growth ? `%${r.growth}` : `${Math.round(r.growth / 128)} MB`,
      volume: vol ? vol.volume_mount_point : null,
      volume_free_mb: vol ? Number(vol.free_mb) : null,
      volume_total_mb: vol ? Number(vol.total_mb) : null,
    };
    f.alert_pct = effectivePercent(f);
    return f;
  });

  return {
    readAt: new Date().toISOString(),
    database: process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || null,
    files,
    logReuseWait: dbInfo.log_reuse_wait_desc,
    recoveryModel: dbInfo.recovery_model_desc,
    topTables: topRs.recordset.map((r) => ({
      name: r.name,
      rows: Number(r.rows_count),
      reserved_mb: Number(r.reserved_mb),
    })),
  };
}

// ── Uyari ────────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Esigi asan dosyalar (saf fonksiyon — test edilir). Dosya basina gunde bir.
function filesNeedingAlert(usage, cfg, alertsSent, today = todayStr()) {
  return (usage?.files || []).filter(
    (f) => f.alert_pct >= cfg.alertPercent && alertsSent[f.name] !== today,
  );
}

function buildAlertCard(usage, files, cfg) {
  const fmt = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
  const facts = files.map((f) => ({
    title: `${f.name} (${f.kind === 'log' ? 'log' : 'veri'})`,
    value:
      `%${f.alert_pct.toFixed(1)} — ${fmt(f.used_mb)} / ` +
      (f.cap_mb ? `${fmt(f.cap_mb)} üst sınır` : f.volume_free_mb != null ? `disk boş ${fmt(f.volume_free_mb)}` : `${fmt(f.size_mb)} dosya`),
  }));
  if (usage.logReuseWait && usage.logReuseWait !== 'NOTHING') {
    facts.push({ title: 'Log neden boşalmıyor', value: usage.logReuseWait });
  }
  const hints = [];
  if (files.some((f) => f.kind === 'log')) {
    hints.push('Log: `BACKUP LOG ... TO DISK` (AG üyesi — yalnız log backup boşaltır); kalıcı çözüm 15 dk\'lık Agent log backup job\'ı.');
  }
  if (files.some((f) => f.kind === 'data' && f.cap_mb)) {
    hints.push('Veri: `ALTER DATABASE ... MODIFY FILE (NAME=..., MAXSIZE=UNLIMITED, FILEGROWTH=512MB)` ve Admin › DB Yedekleme ekranındaki büyük tablolara bak.');
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'Container',
              style: 'attention',
              bleed: true,
              items: [
                { type: 'TextBlock', text: `🛢️ Veritabanı doluluk uyarısı — ${usage.database || 'Portal DB'}`, weight: 'Bolder', size: 'Large', wrap: true },
                { type: 'TextBlock', text: `Eşik %${cfg.alertPercent} aşıldı. Bu uyarı dosya başına günde bir kez gelir.`, isSubtle: true, wrap: true, spacing: 'none' },
              ],
            },
            { type: 'FactSet', spacing: 'Medium', facts },
            ...hints.map((h) => ({ type: 'TextBlock', text: h, wrap: true, spacing: 'Small' })),
          ],
        },
      },
    ],
  };
}

async function postTeams(cfg, body) {
  const { buildDispatcher } = require('../mcp/client.cjs');
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    dispatcher: buildDispatcher(cfg.webhookUrl, 'teams-dbusage'),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // SINIRLI OKUMA: `.text()` govdenin TAMAMINI bellege alir; ardindan gelen
    // `slice(0, 200)` HICBIR SEY KURTARMAZ — veri o noktada zaten bellektedir
    // (bkz. server/util/bounded-read.cjs, 2 numarali ders). Araya giren bir
    // kurumsal vekil sunucu bu uca MB'larca HTML hata sayfasi donebilir ve bu
    // yol her basarisiz webhook'ta calisir.
    const { readBodyPreview } = require('../util/bounded-read.cjs');
    const text = await readBodyPreview(res.body, { maxBytes: 1024 });
    throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function checkAndAlert(usage) {
  const cfg = getConfig();
  const due = filesNeedingAlert(usage, cfg, state.alertsSent);
  if (!due.length) return 0;
  for (const f of due) {
    console.warn(`[DBHousekeeping] DOLULUK UYARISI ${f.name}: %${f.alert_pct.toFixed(1)} (eşik %${cfg.alertPercent})`);
  }
  if (!cfg.webhookUrl) return 0; // webhook yoksa yalniz log + ekran
  await postTeams(cfg, buildAlertCard(usage, due, cfg));
  const today = todayStr();
  for (const f of due) state.alertsSent[f.name] = today;
  await persistState();
  return due.length;
}

// ── Temizlik ─────────────────────────────────────────────────────────────────────

// TOP (N) dongusu — her tur kendi (autocommit) transaction'i; toplam etkilenen satir.
async function batched(pool, text, batchSize, params = {}) {
  let total = 0;
  for (;;) {
    const req = pool.request().input('n', sql.Int, batchSize);
    for (const [k, v] of Object.entries(params)) req.input(k, sql.Int, v);
    const rs = await req.query(text);
    const n = rs.rowsAffected?.[0] ?? 0;
    total += n;
    if (n < batchSize) return total;
  }
}

async function runHousekeeping() {
  if (state.status === 'running') return state;
  const cfg = getConfig();
  state.status = 'running';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;
  state.logxBlobsCleared = 0;
  state.logxRequestsDeleted = 0;
  try {
    const pool = await getPool();
    if (!pool) throw new Error('Portal DB bağlantısı yok.');

    // 1) Eski JSON blob'lari NULL — satir kalir (kim/ne zaman/hangi job), sadece gövde gider.
    state.logxBlobsCleared += await batched(
      pool,
      `UPDATE TOP (@n) logx_v2_jobs SET artifacts_json = NULL, extra_vars_redacted = NULL
        WHERE created_at < DATEADD(day, -@d, GETUTCDATE())
          AND (artifacts_json IS NOT NULL OR extra_vars_redacted IS NOT NULL)`,
      cfg.batchSize,
      { d: cfg.logxBlobRetentionDays },
    );
    state.logxBlobsCleared += await batched(
      pool,
      `UPDATE TOP (@n) logx_v2_requests
          SET discovery_result_json = NULL, selected_files_json = NULL, input_json = NULL
        WHERE created_at < DATEADD(day, -@d, GETUTCDATE())
          AND expires_at < GETUTCDATE()
          AND (discovery_result_json IS NOT NULL OR selected_files_json IS NOT NULL OR input_json IS NOT NULL)`,
      cfg.batchSize,
      { d: cfg.logxBlobRetentionDays },
    );

    // 2) Cok eski istekler tamamen silinir (jobs/downloads/ingest CASCADE).
    state.logxRequestsDeleted = await batched(
      pool,
      `DELETE TOP (@n) FROM logx_v2_requests
        WHERE created_at < DATEADD(day, -@d, GETUTCDATE()) AND expires_at < GETUTCDATE()`,
      Math.min(cfg.batchSize, 500), // cascade ile satir basina daha cok is
      { d: cfg.logxRowRetentionDays },
    );

    state.status = 'done';
    console.log(
      `[DBHousekeeping] tamam: logx blob=${state.logxBlobsCleared} istek=${state.logxRequestsDeleted}`,
    );
  } catch (e) {
    state.status = 'error';
    state.lastError = e.message;
    console.error('[DBHousekeeping] hata:', e.message);
  } finally {
    state.finishedAt = new Date().toISOString();
    _lastRunDateStr = state.finishedAt.slice(0, 10);
    await persistState();
  }
  return state;
}

// ── Kalicilik + zamanlayici ──────────────────────────────────────────────────────

async function persistState() {
  try {
    const db = require('./index.cjs');
    // lastUsage buyuk olabilir (tablo listesi) — DB'ye yazilmaz, bellek-ici kalir.
    const { lastUsage, ...persisted } = state;
    const payload = JSON.stringify(persisted);
    const upd = await db.query(
      `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
      [payload, BLOB_NAME],
    );
    if (!upd.rowCount) {
      await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, payload]);
    }
  } catch (e) {
    console.warn('[DBHousekeeping] durum kaydedilemedi:', e.message);
  }
}

async function loadPersistedState() {
  try {
    const db = require('./index.cjs');
    const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
    if (rows.length) {
      const saved = JSON.parse(rows[0].data);
      if (saved.status === 'running') saved.status = 'idle'; // restart ortasinda kalmis
      Object.assign(state, saved);
      if (!state.alertsSent || typeof state.alertsSent !== 'object') state.alertsSent = {};
    }
  } catch {
    /* ilk calisma */
  }
}

async function tick() {
  const cfg = getConfig();
  try {
    const usage = await readUsage();
    state.lastUsage = usage;
    await checkAndAlert(usage);
  } catch (e) {
    console.warn('[DBHousekeeping] doluluk okunamadi:', e.message);
  }
  const now = new Date();
  const today = todayStr();
  if (now.getHours() === cfg.hour && _lastRunDateStr !== today && state.status !== 'running') {
    await runHousekeeping();
  }
}

function startScheduler() {
  if (_timer) return;
  if (state.finishedAt) _lastRunDateStr = state.finishedAt.slice(0, 10);
  const cfg = getConfig();
  _timer = setInterval(() => tick().catch(() => {}), cfg.checkIntervalMinutes * 60 * 1000);
  _timer.unref?.();
  // Acilista bir kez oku ki ekran ilk bakista dolu olsun, esik asilmissa uyari beklemesin.
  setTimeout(() => tick().catch(() => {}), 20_000).unref?.();
}

function initDbHousekeeping(app) {
  loadPersistedState().finally(startScheduler);

  app.get('/api/admin/db-usage', async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    try {
      const usage = await readUsage();
      state.lastUsage = usage;
      res.json({ ok: true, usage, config: getConfig(), state: stateForClient() });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, state: stateForClient() });
    }
  });

  app.post('/api/admin/db-housekeeping/run', (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    if (state.status === 'running') return res.status(409).json({ ok: false, message: 'Zaten çalışıyor.' });
    runHousekeeping().catch((e) => console.error('[DBHousekeeping] manuel calisma hatasi:', e.message));
    try {
      require('../audit/index.cjs').auditPortal(req, 'db_housekeeping_manual_run', { detail: '' });
    } catch {
      /* yoksay */
    }
    res.json({ ok: true, started: true });
  });

  console.log('[DBHousekeeping] endpoints mounted at /api/admin/db-usage, /api/admin/db-housekeeping');
}

function stateForClient() {
  const { lastUsage, ...rest } = state;
  return rest;
}

module.exports = {
  initDbHousekeeping,
  runHousekeeping,
  readUsage,
  getConfig,
  // test
  fileCapMb,
  effectivePercent,
  filesNeedingAlert,
  buildAlertCard,
};
