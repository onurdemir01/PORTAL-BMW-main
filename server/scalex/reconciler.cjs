// server/scalex/reconciler.cjs — yarim kalmis ScaleX islemlerini SUNUCU TARAFINDA
// sonuclandirir.
//
// COZDUGU SORUN: `finalizeOperation` TEK bir yerden cagriliyordu —
// `GET /run/:serverId/:jobId/status`, yani TARAYICININ yoklamasindan. Sonuc:
// `scalex_operations` satirlarinin RUNNING → FINISHED gecisi ve `scalex_state_mirror`
// guncellemesi tamamen kullanicinin sekmesini acik tutmasina bagliydi.
//
// 10 dakikalik bir `stop` isinde kullanici sekmeyi kapatirsa:
//   1. AWX isi calismaya devam eder ve uygulamalari GERCEKTEN durdurur.
//   2. Portal bunu HIC ogrenmez: islem sonsuza dek RUNNING, ayna bos kalir.
//   3. Kullanici geri geldiginde "Su an durdurulmus" paneli "kayit yok" der —
//      DUPEDUZ YANLIS bilgi.
//   4. `Geri Al` kisayolu hic cikmaz; unutulmus bir kesinti olusur.
//
// Bu, urunun temel vaadini ("safe olmali, geri donebilir olmali") dogrudan kiriyordu:
// portal geri alinabilirligi kendi kaydina dayandiriyor ama o kaydi yazmayi tarayiciya
// birakiyordu.
//
// TASARIM: server/ansible/long-job-watcher.cjs ile AYNI periyodik-tick deseni
// (setInterval + unref, tek zamanlayici tum sunuculara bakar). Uzlastirici YALNIZCA
// `finalizeOperation`i cagirir — sonuclandirma mantigi TEK yerde kalir, iki kopya
// arasinda ayrisma olmaz.
//
// IDEMPOTENT: `finalizeOperation` basta `status !== 'RUNNING'` satirlari eler ve
// `UPDATE ... WHERE status = 'RUNNING'` kosuluyla yazar. Tarayici ve uzlastirici ayni
// anda calissa bile ikinci calisan hicbir sey yapmaz.
'use strict';

const db = require('../db/index.cjs');

const HARD_TOP = 50;

function getConfig() {
  return {
    // Sik yoklamaya gerek yok: bu bir EMNIYET AGI, birincil yol hala tarayicinin
    // yoklamasi (kullanici sonucu aninda gorur). Uzlastirici yalnizca "kimse
    // bakmadi" durumunu toplar.
    intervalSeconds: Number(process.env.SCALEX_RECONCILE_INTERVAL_SECONDS || 120),
    // Tek tick'te en fazla kac is sorgulanir — AWX'i dovmemek icin. Geri kalanlar
    // sonraki tick'te alinir.
    // SQL tavani 50; daha buyugunu istemek SESSIZCE 50'de kalirdi, o yuzden kenetli.
    batchSize: Math.min(Number(process.env.SCALEX_RECONCILE_BATCH || 20), HARD_TOP),
    // Bu yasi gecen ve AWX'te bulunamayan isler ARTIK BEKLENMEZ. Sonsuza dek RUNNING
    // kalan satirlar listeyi kirletir ve "hala calisiyor" yanilgisi yaratir.
    staleHours: Number(process.env.SCALEX_RECONCILE_STALE_HOURS || 24),
  };
}

// Yarim kalmis islerin (serverId, jobId) ciftleri. Bir istek CLUSTER BASINA bir satir
// urettigi icin DISTINCT sart — yoksa ayni is bes kez sorgulanirdi.
// SQL'deki `TOP 50` KATI TAVANDIR (HARD_TOP); `batchSize` bunun ICINDE kirpar.
async function pendingJobs(limit) {
  const { rows } = await db.query(
    `SELECT TOP 50 awx_server_id, awx_job_id, MIN(created_at) AS created_at
       FROM scalex_operations
      WHERE status = 'RUNNING' AND awx_server_id IS NOT NULL AND awx_job_id IS NOT NULL
      GROUP BY awx_server_id, awx_job_id
      ORDER BY MIN(created_at) ASC`
  );
  return rows.slice(0, Math.min(limit, HARD_TOP));
}

async function markStale(serverId, jobId, reason) {
  await db.query(
    `UPDATE scalex_operations
        SET status = 'UNKNOWN', error_message = $3, updated_at = GETUTCDATE()
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
    [serverId, jobId, String(reason).slice(0, 500)]
  );
}

async function tick() {
  const cfg = getConfig();
  const jobs = await pendingJobs(cfg.batchSize);
  if (!jobs.length) return { checked: 0, finalized: 0, stale: 0 };

  // Gec require: modul yuklenme sirasi dongusune girmemek icin (index.cjs bu dosyayi
  // cagiriyor, bu dosya da index.cjs'in `finalizeOperation`ini kullaniyor).
  const { finalizeOperation } = require('./index.cjs');
  const runner = require('../ansible/runner.cjs');
  const result = require('./result.cjs');

  let finalized = 0, stale = 0;
  for (const j of jobs) {
    const serverId = Number(j.awx_server_id);
    const jobId = Number(j.awx_job_id);
    try {
      const status = await runner.getJobStatusOnServer(serverId, jobId);
      if (!status || !status.finished) continue;
      const parsed = result.extractScaleXResult(status.artifacts);
      await finalizeOperation({ serverId, jobId, status, parsed });
      finalized++;
    } catch (e) {
      // AWX isi bulunamiyorsa (silinmis, temizlenmis) sonsuza dek beklemenin anlami
      // yok — ama YALNIZCA yeterince eskiyse. Gecici bir AWX kesintisinde taze
      // isleri "bilinmiyor" yapmak, calisan bir isi kayip ilan etmek olurdu.
      const ageHours = j.created_at ? (Date.now() - new Date(j.created_at).getTime()) / 3600000 : 0;
      if (ageHours >= cfg.staleHours) {
        await markStale(serverId, jobId, `AWX durumu okunamadi (${ageHours.toFixed(0)} saattir bekliyor): ${e.message}`);
        stale++;
      }
    }
  }
  if (finalized || stale) {
    console.log(`[ScaleX] uzlastirici: ${finalized} is sonuclandirildi, ${stale} is "bilinmiyor" isaretlendi.`);
  }
  return { checked: jobs.length, finalized, stale };
}

let _timer = null;

function startReconciler() {
  if (_timer) return; // zaten calisiyor (hot-reload/test ortami)
  const cfg = getConfig();
  const run = () => tick().catch((e) => console.warn('[ScaleX] uzlastirici tick hatasi:', e.message));
  _timer = setInterval(run, cfg.intervalSeconds * 1000);
  _timer.unref?.();
  // Ilk tur GECIKMELI: sunucu acilisinda DB ve AWX baglantilari daha hazir olmayabilir.
  const kick = setTimeout(run, 15_000);
  kick.unref?.();
}

// `stopReconciler` BILEREK YOK: zamanlayici `unref`'li, yani surecin kapanmasini
// engellemiyor ve depoda cagrilacagi bir kapanis yolu da yok. Cagrilmayan bir
// "temizlik" fonksiyonu birakmak, ileride birinin onun gercekten kullanildigini
// sanmasina yol acardi (J1 bekcisi bu spekulatif olu kodu zaten reddediyor).
module.exports = { tick, startReconciler, getConfig, pendingJobs, HARD_TOP };
