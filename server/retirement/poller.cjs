// server/retirement/poller.cjs — zamani gelen retirement adimlarini tetikler.
//
// IKI IS, IKI AYRI KURAL (kullanici karari 2026-10-06):
//   1. STOP — OCO kesinti penceresi acilinca ('stop_scheduled' hedefler)
//   2. DELETE — kaydin silme tarihi gelince ('stopped' hedefler, ekstra onay YOK:
//      "delete kismi icin ekstra talep olmaz, otomatik olarak is scheduled edilir ve
//      tarih geldiginde is yapilir")
//
// ── DESEN: oco/poller.cjs ILE AYNI ──────────────────────────────────────────────────
// TEK zamanlanmis interval TUM bekleyenlere bakar. Kardes ekibin kodundaki "her bekleyen
// islem icin while True: sleep" dongusu BILINCLI OLARAK kopyalanmadi (bkz. smart/poller.cjs
// basi): bir worker'i sonsuza dek isgal ediyordu.
//
// LAUNCHER ENJEKTE EDILIR: bu modul AWX'i tanimaz, `startPoller(launch)` ile verilen
// fonksiyonu cagirir. Dongusel require yok ve birim testi aga cikmaz.
//
// ── NEDEN PORTAL ZAMANLAYICISI, AWX-NATIVE SCHEDULE DEGIL ───────────────────────────
// Kaydi Portal tutuyor: iptal ("Kaydi iptal et"), gorunurluk ve olay gecmisi burada.
// AWX-native bir schedule'i guncellemek AWX API'sinden silip yeniden kurmayi gerektirir
// ve kayit ile AWX arasinda ayrisma riski dogurur (ayni gerekce ScaleX'te de yazili).
'use strict';

const db = require('../db/index.cjs');
const { stopZamani, etkinSilmeGunu, silmeZamaniGeldi } = require('./schedule.cjs');

let _timer = null;
let _launch = null;
// DELETE'I KIMSE IZLEMIYOR: isi poller basliyor, ekranda bekleyen bir insan yok. STOP'ta
// sonucu onyuzun job-status yoklamasi yaziyordu; burada o yok. Bu yuzden poller isi
// SONLANDIRMAK da zorunda - yoksa hedef sonsuza dek 'deleting'de asili kalir ve kimse
// silmenin tutup tutmadigini gormez. (Ayni gerekce ScaleX uzlastiricisinda da yazili.)
let _finalize = null;
let _ticking = false;

function cfg() {
  const n = Number(process.env.RETIREMENT_POLL_INTERVAL_SECONDS);
  return { intervalMs: (Number.isFinite(n) && n >= 30 ? n : 300) * 1000 };
}

async function olay(recordId, kind, text) {
  try {
    await db.query(
      `INSERT INTO retirement_events (record_id, username, kind, text) VALUES ($1, $2, $3, $4)`,
      [recordId, null, kind, String(text || '').slice(0, 1000)],
    );
  } catch (e) {
    console.warn('[Retirement poller] olay yazilamadi:', e.message);
  }
}

/** Penceresi acilan zamanlanmis STOP'lar. Penceresi KACIRILANLAR 'failed' yazilir. */
async function stopTick(now) {
  const { rows } = await db.query(
    `SELECT t.id, t.record_id, t.host, t.app_name, t.jboss_gen, t.app_path, t.env,
            t.scheduled_at, t.window_end,
            r.smart_no, r.oco_no, r.status AS rec_status
       FROM retirement_targets t
       JOIN retirement_records r ON r.id = t.record_id
      WHERE t.status = 'stop_scheduled' AND r.status <> 'cancelled'`,
  );
  let kosan = 0;
  let gecen = 0;
  for (const t of rows || []) {
    const k = stopZamani({ scheduledAt: t.scheduled_at, windowEnd: t.window_end }, now);
    if (k.durum === 'wait') continue;
    if (k.durum === 'expired') {
      // SESSIZ GECME YOK: kayit 'stop_scheduled'da sonsuza dek asili kalirsa kimse
      // penceresinin kacirildigini gormez.
      const u = await db.query(
        `UPDATE retirement_targets SET status = 'failed', result_text = $1, updated_at = GETUTCDATE()
          WHERE id = $2 AND status = 'stop_scheduled'`,
        [k.sebep.slice(0, 1000), t.id],
      );
      if (u.rowCount) {
        gecen += 1;
        await olay(t.record_id, 'schedule-expired', `${t.app_name} @ ${t.host}: ${k.sebep}`);
      }
      continue;
    }
    // CLAIM: durumu ONCE degistir, sonra tetikle. Iki tick ust uste binerse ayni hedef
    // iki kez baslatilmasin (re-entrancy guard trafigi keser, claim DB tarafinda kesin).
    const claim = await db.query(
      `UPDATE retirement_targets SET status = 'stopping', updated_at = GETUTCDATE()
        WHERE id = $1 AND status = 'stop_scheduled'`,
      [t.id],
    );
    if (!claim.rowCount) continue;
    try {
      const r = await _launch('stop', {
        recordId: t.record_id,
        targetId: t.id,
        host: t.host,
        application: t.app_name,
        gen: t.jboss_gen,
        appPath: t.app_path,
        env: t.env,
        smartNo: t.smart_no,
        ocoNo: t.oco_no,
      });
      await db.query(`UPDATE retirement_targets SET last_job_id = $1, updated_at = GETUTCDATE() WHERE id = $2`, [r?.jobId ?? null, t.id]);
      await db.query(`UPDATE retirement_records SET status = 'stopping', updated_at = GETUTCDATE() WHERE id = $1 AND status = 'open'`, [t.record_id]);
      await olay(t.record_id, 'stop', `${t.app_name} @ ${t.host}: kesinti penceresi acildi, STOP isi #${r?.jobId ?? '?'}`);
      kosan += 1;
    } catch (e) {
      // CLAIM GERI ALINIR: launch dustuyse hedef 'stopping'de kalmamali, yoksa pencere
      // icinde bir daha denenmez.
      await db.query(
        `UPDATE retirement_targets SET status = 'stop_scheduled', result_text = $1, updated_at = GETUTCDATE()
          WHERE id = $2 AND status = 'stopping' AND last_job_id IS NULL`,
        [`STOP baslatilamadi: ${e.message}`.slice(0, 1000), t.id],
      );
      await olay(t.record_id, 'error', `${t.app_name} @ ${t.host}: STOP baslatilamadi — ${e.message}`);
    }
  }
  return { kosan, gecen };
}

/** Silme tarihi gelen hedefler. Yalniz 'stopped' olanlar: durdurulmamis uygulama silinmez. */
async function deleteTick(now) {
  const { rows } = await db.query(
    `SELECT t.id, t.record_id, t.host, t.app_name, t.jboss_gen, t.app_path, t.env,
            r.smart_no, r.planned_delete_at, r.stop_at, r.delete_after_days
       FROM retirement_targets t
       JOIN retirement_records r ON r.id = t.record_id
      WHERE t.status = 'stopped' AND t.deleted_at IS NULL AND r.status NOT IN ('cancelled', 'deleted')`,
  );
  let kosan = 0;
  for (const t of rows || []) {
    const bilgi = {
      plannedDeleteAt: t.planned_delete_at,
      stopAt: t.stop_at,
      deleteAfterDays: t.delete_after_days,
    };
    if (!silmeZamaniGeldi(bilgi, now)) continue;
    const claim = await db.query(
      `UPDATE retirement_targets SET status = 'deleting', updated_at = GETUTCDATE()
        WHERE id = $1 AND status = 'stopped'`,
      [t.id],
    );
    if (!claim.rowCount) continue;
    try {
      // EKSTRA ONAY YOK ama PLAN DA YOK: kullanici karari "tarih geldiginde is yapilir".
      // plan_only=false dogrudan gider; plan asamasi insan onayi icindi, burada insan yok.
      const r = await _launch('delete', {
        recordId: t.record_id,
        targetId: t.id,
        host: t.host,
        application: t.app_name,
        gen: t.jboss_gen,
        appPath: t.app_path,
        env: t.env,
        smartNo: t.smart_no,
      });
      await db.query(`UPDATE retirement_targets SET delete_job_id = $1, updated_at = GETUTCDATE() WHERE id = $2`, [r?.jobId ?? null, t.id]);
      await olay(
        t.record_id,
        'delete',
        `${t.app_name} @ ${t.host}: silme tarihi geldi (${etkinSilmeGunu(bilgi)}), DELETE isi #${r?.jobId ?? '?'}`,
      );
      kosan += 1;
    } catch (e) {
      await db.query(
        `UPDATE retirement_targets SET status = 'stopped', result_text = $1, updated_at = GETUTCDATE()
          WHERE id = $2 AND status = 'deleting' AND delete_job_id IS NULL`,
        [`DELETE baslatilamadi: ${e.message}`.slice(0, 1000), t.id],
      );
      await olay(t.record_id, 'error', `${t.app_name} @ ${t.host}: DELETE baslatilamadi — ${e.message}`);
    }
  }
  return { kosan };
}

/** Bitmis DELETE islerini sonuclandirir: 'deleted' ya da 'failed'. */
async function finalizeTick() {
  if (typeof _finalize !== 'function') return { kapanan: 0 };
  const { rows } = await db.query(
    `SELECT id, record_id, host, app_name, delete_job_id
       FROM retirement_targets
      WHERE status = 'deleting' AND delete_job_id IS NOT NULL`,
  );
  let kapanan = 0;
  for (const t of rows || []) {
    let o;
    try {
      o = await _finalize(t);
    } catch (e) {
      // OKUNAMADI != BASARISIZ: AWX'e ulasilamadiysa hedef 'deleting'de KALIR ve bir
      // sonraki tick tekrar bakar. 'failed' yazmak, aslinda basarili olmus bir silmeyi
      // basarisiz gostermek olurdu.
      console.warn(`[Retirement poller] is #${t.delete_job_id} durumu okunamadi:`, e.message);
      continue;
    }
    if (!o || !o.terminal) continue;
    if (o.ok) {
      await db.query(
        `UPDATE retirement_targets SET status = 'deleted', result_text = $1, deleted_at = GETUTCDATE(), updated_at = GETUTCDATE()
          WHERE id = $2 AND status = 'deleting'`,
        [String(o.message || '').slice(0, 1000), t.id],
      );
      await olay(t.record_id, 'delete-result', `${t.app_name} @ ${t.host}: ${o.message || 'silindi'}`);
      // KAYIT KAPANISI: tum hedefler silindiyse kaydin kendisi 'deleted' olur.
      const kalan = await db.query(
        `SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status NOT IN ('deleted', 'skipped')`,
        [t.record_id],
      );
      if (Number(kalan.rows?.[0]?.n) === 0)
        await db.query(`UPDATE retirement_records SET status = 'deleted', updated_at = GETUTCDATE() WHERE id = $1`, [t.record_id]);
    } else {
      await db.query(
        `UPDATE retirement_targets SET status = 'failed', result_text = $1, updated_at = GETUTCDATE()
          WHERE id = $2 AND status = 'deleting'`,
        [String(o.message || 'silme basarisiz').slice(0, 1000), t.id],
      );
      await olay(t.record_id, 'delete-result', `${t.app_name} @ ${t.host}: BASARISIZ — ${o.message || ''}`);
    }
    kapanan += 1;
  }
  return { kapanan };
}

async function tick(now = new Date()) {
  if (typeof _launch !== 'function') return { skipped: 'launcher yok' };
  const s = await stopTick(now);
  const d = await deleteTick(now);
  const f = await finalizeTick();
  if (s.kosan || s.gecen || d.kosan || f.kapanan)
    console.log(
      `[Retirement poller] STOP kosan=${s.kosan} penceresi-gecen=${s.gecen} · DELETE kosan=${d.kosan} kapanan=${f.kapanan}`,
    );
  return { stop: s, delete: d, finalize: f };
}

function startPoller(launch, finalize) {
  _launch = launch;
  _finalize = finalize || null;
  if (_timer) return;
  const { intervalMs } = cfg();
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[Retirement poller] tick hatasi:', e.message))
      .finally(() => {
        _ticking = false;
      });
  }, intervalMs);
  if (_timer.unref) _timer.unref();
  console.log(`[Retirement poller] basladi (${Math.round(intervalMs / 1000)} sn)`);
}

function stopPoller() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _launch = null;
  _finalize = null;
}

module.exports = { startPoller, stopPoller, tick, _stopTick: stopTick, _deleteTick: deleteTick, _finalizeTick: finalizeTick };
