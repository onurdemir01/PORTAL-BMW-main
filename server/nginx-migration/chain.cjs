// server/nginx-migration/chain.cjs — "paket getir → tanımla" zinciri.
//
// NEDEN PORTAL ZINCIRLIYOR (2026-09-26, kullanici karari): iki is AYRI template'lerde
// kosmak ZORUNDA - tasima DINAMIK envanterde, OpenShift jump server'lari STATIK
// envanterde (job 3352755). Zinciri Ansible tarafinda kurmak, cekme isinin AWX REST
// API'sini cagirmasini gerektiriyordu; o da bir API jetonu demekti ve jeton depoda duz
// metin tutulmak zorunda kalacakti. Portal'in AWX kimligi ZATEN yapilandirilmis
// (awxServerId), dolayisiyla zinciri burada kurmak jeton ihtiyacini TAMAMEN kaldirir.
//
// TASARIM: server/ansible/long-job-watcher.cjs ile ayni periyodik-tick deseni
// (setInterval + unref). Tarayiciya BAGLI DEGIL: kullanici pencereyi kapatsa da zincir
// tamamlanir.
//
// COKLU KOPYA: birden fazla Portal ornegi kosuyorsa ayni kaydi iki kez baslatmamak icin
// is "sahiplenilir" - durum guncellemesi rowCount ile dogrulanir, kazanan tek olandir.
'use strict';

const TABLE = 'nginx_migration_chain';
const POLL_MS = Number(process.env.NGINX_CHAIN_POLL_MS || 30_000);
// Cekme isi bu sureyi asarsa zincir "zaman asimi" ile kapanir; sonsuza kadar bekleyen
// kayit, ekranda "surekli beklemede" gorunen bir hayalet uretirdi.
const TIMEOUT_MS = Number(process.env.NGINX_CHAIN_TIMEOUT_MS || 60 * 60_000);

const TERMINAL_OK = new Set(['successful']);
const TERMINAL_BAD = new Set(['failed', 'error', 'canceled', 'cancelled']);

let _timer = null;

async function ensureTable(db) {
  await db.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${TABLE}')
    CREATE TABLE ${TABLE} (
      id             BIGINT IDENTITY(1,1) PRIMARY KEY,
      fetch_job_id   BIGINT        NOT NULL,
      awx_server_id  INT           NOT NULL,
      template_id    INT           NOT NULL,
      extra_vars     NVARCHAR(MAX) NOT NULL,
      status         NVARCHAR(16)  NOT NULL,
      migration_job_id BIGINT      NULL,
      message        NVARCHAR(600) NULL,
      requested_by   NVARCHAR(128) NULL,
      created_at     DATETIME2     NOT NULL CONSTRAINT DF_${TABLE}_created DEFAULT SYSUTCDATETIME(),
      finished_at    DATETIME2     NULL
    )`);
}

/** Cekme isi basladiktan sonra "bittiginde sunu kostur" kaydi. */
async function enqueue(db, { fetchJobId, awxServerId, templateId, extraVars, requestedBy }) {
  await ensureTable(db);
  await db.query(
    `INSERT INTO ${TABLE} (fetch_job_id, awx_server_id, template_id, extra_vars, status, requested_by)
     VALUES ($1, $2, $3, $4, 'waiting', $5)`,
    [Number(fetchJobId), Number(awxServerId), Number(templateId), JSON.stringify(extraVars || {}), requestedBy || null],
  );
}

/** Kaydi SAHIPLEN: yalnizca hala 'waiting' ise kazanir. Coklu Portal ornegi korumasi. */
async function claim(db, id) {
  const r = await db.query(
    `UPDATE ${TABLE} SET status = 'launching' WHERE id = $1 AND status = 'waiting'`,
    [id],
  );
  return (r.rowCount || 0) === 1;
}

async function finish(db, id, status, { migrationJobId = null, message = null } = {}) {
  await db.query(
    `UPDATE ${TABLE} SET status = $2, migration_job_id = $3, message = $4, finished_at = SYSUTCDATETIME()
      WHERE id = $1`,
    [id, status, migrationJobId, message ? String(message).slice(0, 600) : null],
  );
}

/**
 * Bekleyen zincirleri bir kez yoklar.
 * @returns {{checked:number, launched:number, failed:number, timedOut:number}}
 */
async function tick(db, deps = {}) {
  const runner = deps.runner || require('../ansible/runner.cjs');
  const out = { checked: 0, launched: 0, failed: 0, timedOut: 0 };
  let rows;
  try {
    await ensureTable(db);
    const r = await db.query(
      `SELECT TOP 50 id, fetch_job_id, awx_server_id, template_id, extra_vars, created_at, requested_by
         FROM ${TABLE} WHERE status = 'waiting' ORDER BY id`,
    );
    rows = r.rows || [];
  } catch (e) {
    console.warn('[nginx-chain] bekleyenler okunamadi:', e.message);
    return out;
  }

  for (const row of rows) {
    out.checked += 1;
    const yas = Date.now() - new Date(row.created_at).getTime();
    if (yas > TIMEOUT_MS) {
      if (await claim(db, row.id)) {
        out.timedOut += 1;
        await finish(db, row.id, 'timeout', {
          message: `Paket getirme isi ${Math.round(TIMEOUT_MS / 60000)} dakikada bitmedi; `
            + 'zincir kapatildi. Tanimi elle olusturabilirsiniz.',
        });
      }
      continue;
    }

    let durum;
    try {
      durum = await runner.getJobStatusOnServer(Number(row.awx_server_id), Number(row.fetch_job_id));
    } catch (e) {
      // AWX'e ULASILAMADI: kayit 'waiting' KALIR ve bir sonraki tick'te tekrar denenir.
      // Burada 'failed' yazmak, gecici bir ag hatasini kalici bir basarisizliga cevirirdi.
      console.warn('[nginx-chain] job durumu okunamadi:', row.fetch_job_id, e.message);
      continue;
    }

    const st = String(durum?.status || '').toLowerCase();
    if (!TERMINAL_OK.has(st) && !TERMINAL_BAD.has(st)) continue; // hala kosuyor

    if (TERMINAL_BAD.has(st)) {
      if (await claim(db, row.id)) {
        out.failed += 1;
        await finish(db, row.id, 'fetch_failed', {
          message: `Paket getirme isi ${st} ile bitti; tanim islemi BASLATILMADI. `
            + 'Paket gelmeden tanim olusturmak, bos bir dizine yol acardi.',
        });
      }
      continue;
    }

    // Cekme BASARILI: tasimayi baslat.
    if (!(await claim(db, row.id))) continue; // baska bir ornek aldi
    try {
      const extra = typeof row.extra_vars === 'string' ? JSON.parse(row.extra_vars) : (row.extra_vars || {});
      const launched = await runner.launchJobOnServer(
        Number(row.awx_server_id), Number(row.template_id), extra, '', row.requested_by || null,
      );
      const jid = launched?.jobId ?? null;
      await finish(db, row.id, 'launched', { migrationJobId: jid });
      out.launched += 1;
      if (deps.onLaunched) await deps.onLaunched(row, jid, extra);
    } catch (e) {
      await finish(db, row.id, 'launch_failed', { message: e.message });
      out.failed += 1;
    }
  }
  return out;
}

function startWatcher(db, deps) {
  if (_timer) return _timer;
  _timer = setInterval(() => {
    tick(db, deps).catch((e) => console.warn('[nginx-chain] tick hatasi:', e.message));
  }, POLL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  return _timer;
}

function stopWatcher() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { enqueue, tick, startWatcher, stopWatcher, ensureTable, TABLE, POLL_MS, TIMEOUT_MS };
