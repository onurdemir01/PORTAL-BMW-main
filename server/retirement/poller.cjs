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
let _web = null;
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
            r.smart_no, r.planned_delete_at, r.stop_at, r.delete_after_days, r.delete_now_at
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
      // ADMIN "beklemeyi atla": 23:00 kuralini atlar (bkz. schedule.cjs madde 3).
      deleteNowAt: t.delete_now_at,
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

// Sonuclandirilacak adimlar. STOP ve DELETE AYRI alanlarda is numarasi tasiyor
// (last_job_id / delete_job_id) ve ayri hedef durumlarina gidiyor.
//
// STOP'U DA POLLER SONUCLANDIRIR (2026-10-06): onyuzun job-status yoklamasi yalnizca
// ekranda bekleyen bir insan varken calisir. STOP artik OCO penceresine zamanlaniyor,
// yani is gece 02:00'de poller tarafindan baslatiliyor ve o anda kimse yok. Bu
// sonlandirma olmadan hedef sonsuza dek 'stopping'de kalirdi - silme de hic
// tetiklenmezdi (deleteTick yalniz 'stopped' hedefe bakar).
//
// GERI ALMA (2026-10-07, kullanici): "uygulamami geri aktif et vs ve yaptigimiz
// degisiklikler geri alinmali." Ucuncu adim.
//
// `basarisiz` ALANI ADIMA OZEL VE BU KRITIK: eskiden basarisizlik dali kosulsuz
// 'failed' yaziyordu. Geri alma icin 'failed' YETERSIZ degil TEHLIKELI de olabilirdi -
// 'stopped' yazilmasi gerektigi dusunulse, yarim kalmis bir geri alma SILINEBILIR
// duruma geri donerdi (deleteTick yalniz 'stopped' hedefe bakar). 'rollback_failed'
// hicbir tick tarafindan alinmaz; insan mudahalesi bekler.
const ADIMLAR = Object.freeze([
  { durum: 'stopping', isAlani: 'last_job_id', kind: 'stop', basarili: 'stopped', basarisiz: 'failed', zamanAlani: 'stopped_at' },
  { durum: 'deleting', isAlani: 'delete_job_id', kind: 'delete', basarili: 'deleted', basarisiz: 'failed', zamanAlani: 'deleted_at' },
  { durum: 'rolling_back', isAlani: 'rollback_job_id', kind: 'rollback', basarili: 'active', basarisiz: 'rollback_failed', zamanAlani: 'rolled_back_at' },
]);

async function finalizeAdim(adim) {
  const { rows } = await db.query(
    `SELECT id, record_id, host, app_name, env, ${adim.isAlani} AS job_id
       FROM retirement_targets
      WHERE status = '${adim.durum}' AND ${adim.isAlani} IS NOT NULL`,
  );
  let kapanan = 0;
  for (const t of rows || []) {
    let o;
    try {
      o = await _finalize(adim.kind, t);
    } catch (e) {
      // OKUNAMADI != BASARISIZ: AWX'e ulasilamadiysa hedef 'deleting'de KALIR ve bir
      // sonraki tick tekrar bakar. 'failed' yazmak, aslinda basarili olmus bir silmeyi
      // basarisiz gostermek olurdu.
      console.warn(`[Retirement poller] is #${t.job_id} durumu okunamadi:`, e.message);
      continue;
    }
    if (!o || !o.terminal) continue;
    if (o.ok) {
      await db.query(
        `UPDATE retirement_targets SET status = '${adim.basarili}', result_text = $1, ${adim.zamanAlani} = GETUTCDATE(), updated_at = GETUTCDATE()
          WHERE id = $2 AND status = '${adim.durum}'`,
        [String(o.message || '').slice(0, 1000), t.id],
      );
      await olay(t.record_id, `${adim.kind}-result`, `${t.app_name} @ ${t.host}: ${o.message || adim.basarili}`);
      if (adim.kind === 'stop') {
        // STOP'ta kayit 'stopped' olur ve stop_at ILK stop'ta yazilir - silme tarihi
        // buradan sayilir (bkz. schedule.etkinSilmeGunu).
        await db.query(
          `UPDATE retirement_records SET stop_at = COALESCE(stop_at, GETUTCDATE()), updated_at = GETUTCDATE() WHERE id = $1`,
          [t.record_id],
        );
        const kalan = await db.query(
          `SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status NOT IN ('stopped', 'deleting', 'deleted', 'skipped')`,
          [t.record_id],
        );
        if (Number(kalan.rows?.[0]?.n) === 0)
          await db.query(`UPDATE retirement_records SET status = 'stopped', updated_at = GETUTCDATE() WHERE id = $1 AND status = 'stopping'`, [t.record_id]);
      } else if (adim.kind === 'delete') {
        const kalan = await db.query(
          `SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status NOT IN ('deleted', 'skipped')`,
          [t.record_id],
        );
        if (Number(kalan.rows?.[0]?.n) === 0)
          await db.query(`UPDATE retirement_records SET status = 'deleted', updated_at = GETUTCDATE() WHERE id = $1`, [t.record_id]);
      } else if (adim.kind === 'rollback') {
        // DALLANMA ACIK YAZILDI. Eskiden `else` dali DELETE varsayiyordu; ucuncu adim
        // eklenince geri alma oraya duser ve basarili bir GERI ALMA kaydi 'deleted'
        // yapabilirdi - hic silinmemis bir uygulama silinmis gorunurdu.
        //
        // Hicbir hedef artik 'stopped'/'deleting' degilse retirement YURURLUKTE DEGIL:
        // kayit 'open'a doner ve istenirse yeniden stop edilebilir. 'deleted' ya da
        // 'cancelled' kayitlara DOKUNULMAZ.
        const kalan = await db.query(
          `SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status IN ('stopped', 'stopping', 'stop_scheduled', 'deleting')`,
          [t.record_id],
        );
        if (Number(kalan.rows?.[0]?.n) === 0)
          await db.query(
            `UPDATE retirement_records SET status = 'open', stop_at = NULL, updated_at = GETUTCDATE()
              WHERE id = $1 AND status NOT IN ('deleted', 'cancelled')`,
            [t.record_id],
          );
      }
    } else {
      await db.query(
        `UPDATE retirement_targets SET status = '${adim.basarisiz}', result_text = $1, updated_at = GETUTCDATE()
          WHERE id = $2 AND status = '${adim.durum}'`,
        [String(o.message || `${adim.kind} basarisiz`).slice(0, 1000), t.id],
      );
      await olay(t.record_id, `${adim.kind}-result`, `${t.app_name} @ ${t.host}: BASARISIZ — ${o.message || ''}`);
    }
    kapanan += 1;
  }
  return kapanan;
}

// ── WEB KATMANI (kullanici karari 2026-10-06) ───────────────────────────────────────
// "Direkt STOP'ta kalkacak" + "dondur, bulunamayani atla". Liste onay aninda dondurulur
// (index.cjs webDondur); burada DONMUS liste uygulanir.
//
// STOP BASARILI OLDUKTAN SONRA: hedef 'stopped' olmadan vhost kaldirilmaz. Once vhost'u
// kaldirip sonra STOP'un dusmesi, calisan bir uygulamayi erisilemez birakmak olurdu.
//
// URUN BASINA AYRI YOL (bugun Server Hub'da ogrenildi: nginx ve Apache ayni komutu
// PAYLASMIYOR). apache_retire_vhost yalniz Apache/IHS icin; NGINX hedefleri 'manual'
// isaretlenir ve SEBEBI yazilir - sessizce atlamak "kaldirildi" izlenimi verirdi.
const APACHE_URUN = new Set(['RHA', 'IHS', 'APACHE', 'IBMIHS']);

async function webTick() {
  if (typeof _web !== 'function') return { kosan: 0, elle: 0 };
  const { rows } = await db.query(
    `SELECT id, record_id, host, app_name, web_result_json
       FROM retirement_targets
      WHERE status = 'stopped' AND web_result_json IS NOT NULL AND web_result_json LIKE '%"pending"%'`,
  );
  let kosan = 0;
  let elle = 0;
  for (const t of rows || []) {
    let liste;
    try {
      liste = JSON.parse(t.web_result_json);
    } catch {
      continue;
    }
    if (!Array.isArray(liste)) continue;
    let degisti = false;
    for (const w of liste) {
      if (w.status !== 'pending') continue;
      if (!APACHE_URUN.has(String(w.product || '').toUpperCase())) {
        w.status = 'manual';
        w.message = `${w.product || 'bilinmeyen urun'}: otomatik kaldirma yok (apache_retire_vhost yalniz Apache/IHS). Nginx icin nginx_ops action=delete ile elle yapilmali.`;
        degisti = true;
        elle += 1;
        continue;
      }
      if (!w.confFile || !w.serverName) {
        w.status = 'manual';
        w.message = 'conf dosyasi ya da ServerName kesifte cozulemedi; elle kaldirilmali.';
        degisti = true;
        elle += 1;
        continue;
      }
      try {
        const r = await _web({ webHost: w.host, product: w.product, confFile: w.confFile, serverName: w.serverName });
        w.jobId = r?.jobId ?? null;
        w.status = 'running';
        w.message = `is #${w.jobId ?? '?'}`;
        degisti = true;
        kosan += 1;
        await olay(t.record_id, 'web', `${t.app_name}: ${w.host} / ${w.serverName} vhost kaldirma isi #${w.jobId ?? '?'}`);
      } catch (e) {
        // 'pending' KALIR: bir sonraki tick tekrar dener. 'failed' yazmak, hic
        // denenmemis bir kaldirmayi basarisiz gostermek olurdu.
        await olay(t.record_id, 'error', `${t.app_name}: ${w.host} / ${w.serverName} vhost isi baslatilamadi — ${e.message}`);
      }
    }
    if (degisti)
      await db.query(`UPDATE retirement_targets SET web_result_json = $1, updated_at = GETUTCDATE() WHERE id = $2`, [JSON.stringify(liste).slice(0, 60000), t.id]);
  }
  return { kosan, elle };
}

// ── WEB (vhost) ISLERININ SONUCU (2026-10-08 uretim bulgusu) ────────────────────────
// Kullanici: "web adimi calisti gozukuyor ama mod_jk.conf'a bakiyorum halen ilgili satirlar
// aktif." webTick vhost kaldirma isini baslatip durumu 'running' yapiyordu ve SONRA HICBIR
// KOD onu 'ok'/'failed'a cevirmiyordu; Akis paneli tanimadigi 'running'i "bitti" diye
// gosteriyordu - sonucu bilinmeyen bir isi BASARILI saymak. Simdi her turda 'running'
// girdilerin AWX isi okunur (STOP/DELETE ile AYNI sonuclandirici, kind='web'):
//   RESULT ... OK   -> 'ok'
//   RESULT ... SKIP -> 'skip'  (yapilacak bir sey bulunmadi; "kaldirildi" DEGIL)
//   diger / sonuc yok -> 'failed'  (set_stats yoksa ne yapildigi bilinmiyor)
// OKUNAMADI != BASARISIZ: AWX'e ulasilamazsa 'running' KALIR, sonraki tur tekrar bakar.
async function webSonucTick() {
  if (typeof _finalize !== 'function') return { kapanan: 0 };
  const { rows } = await db.query(
    `SELECT id, record_id, app_name, web_result_json FROM retirement_targets
      WHERE web_result_json IS NOT NULL AND web_result_json LIKE '%"running"%'`,
  );
  let kapanan = 0;
  for (const t of rows || []) {
    let liste;
    try { liste = JSON.parse(t.web_result_json); } catch { continue; }
    if (!Array.isArray(liste)) continue;
    let degisti = false;
    for (const w of liste) {
      if (w.status !== 'running') continue;
      // IZ BIRAKMADAN BEKLEMEK YOK: is numarasi yoksa sonuc hic okunamaz; okuma hatasi da
      // sessiz kalmamali - ekran "suruyor" derken sebebi logda olmali.
      if (!w.jobId) { console.warn(`[Retirement poller] #${t.record_id} ${w.host} / ${w.serverName}: web isi 'running' ama is numarasi yok - sonuc okunamaz (elle kontrol)`); continue; }
      let s;
      try { s = await _finalize('web', { job_id: w.jobId }); } catch (e) {
        console.warn(`[Retirement poller] #${t.record_id} ${w.host} / ${w.serverName}: web isi #${w.jobId} sonucu OKUNAMADI (sonraki tur tekrar): ${e.message}`);
        continue;
      }
      if (!s || !s.terminal) continue;
      w.status = s.ok ? 'ok' : s.skip ? 'skip' : 'failed';
      w.message = `is #${w.jobId}: ${s.message || ''}`.slice(0, 500);
      degisti = true;
      kapanan += 1;
      await olay(t.record_id, w.status === 'failed' ? 'error' : 'web',
        `${t.app_name}: ${w.host} / ${w.serverName} vhost kaldirma ${w.status === 'ok' ? 'TAMAM' : w.status === 'skip' ? 'ATLANDI (yapilacak sey bulunmadi)' : 'BASARISIZ'} - ${w.message}`);
    }
    if (degisti)
      await db.query(`UPDATE retirement_targets SET web_result_json = $1, updated_at = GETUTCDATE() WHERE id = $2`, [JSON.stringify(liste).slice(0, 60000), t.id]);
  }
  return { kapanan };
}

/** Hem STOP hem DELETE islerini sonuclandirir. */
async function finalizeTick() {
  if (typeof _finalize !== 'function') return { kapanan: 0 };
  let kapanan = 0;
  for (const adim of ADIMLAR) kapanan += await finalizeAdim(adim);
  return { kapanan };
}

async function tick(now = new Date()) {
  if (typeof _launch !== 'function') return { skipped: 'launcher yok' };
  const s = await stopTick(now);
  const d = await deleteTick(now);
  const f = await finalizeTick();
  const w = await webTick();
  const ws = await webSonucTick();
  if (s.kosan || s.gecen || d.kosan || f.kapanan || w.kosan || w.elle || ws.kapanan)
    console.log(
      `[Retirement poller] STOP kosan=${s.kosan} penceresi-gecen=${s.gecen} · DELETE kosan=${d.kosan} · kapanan=${f.kapanan} · WEB kosan=${w.kosan} elle=${w.elle} sonuclanan=${ws.kapanan}`,
    );
  return { stop: s, delete: d, finalize: f, web: w, webSonuc: ws };
}

function startPoller(launch, finalize, web) {
  _launch = launch;
  _finalize = finalize || null;
  _web = web || null;
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
  _web = null;
}

module.exports = { startPoller, stopPoller, tick, _stopTick: stopTick, _deleteTick: deleteTick, _finalizeTick: finalizeTick, _webTick: webTick, _webSonucTick: webSonucTick };
