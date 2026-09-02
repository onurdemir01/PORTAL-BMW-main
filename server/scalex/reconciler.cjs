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
const { auditPortal } = require('../audit/index.cjs');

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
  // IZ: bir isin "bilinmiyor" isaretlenmesi kullanicinin gorecegi son durumdur ve
  // sunucu tarafinda, kimse bakmadan olur. Denetim kaydinda gorunmezse "bu is neden
  // UNKNOWN?" sorusunun cevabi hicbir yerde olmaz.
  auditPortal(null, 'scalex_reconcile_stale', {
    username: 'system:scalex-reconciler', result: 'fail',
    detail: JSON.stringify({ serverId, jobId, reason: String(reason).slice(0, 400) }),
  });
  await db.query(
    `UPDATE scalex_operations
        SET status = 'UNKNOWN', error_message = $3, updated_at = GETUTCDATE()
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
    [serverId, jobId, String(reason).slice(0, 500)]
  );
}


// ── SMART ONAYI BEKLEYEN SATIRLAR ───────────────────────────────────────────
//
// Onay bekleyen bir ScaleX istegi icin `scalex_operations`ta `PENDING_APPROVAL`
// satirlari vardir ama AWX'te henuz is YOKTUR. Onay gelince isi SMART poller'i
// `runner.performSsLaunch` ile baslatir — ve o yol ScaleX'i BILMEZ, yalnizca
// `ansible_job_history`ye yazar. Yani satiri RUNNING'e cekecek kimse yoktu:
// uzlastirici `RUNNING` sorgusuna takilmadigi icin `finalizeOperation` hic calismaz,
// `scalex_state_mirror` guncellenmez ve GERI ALMA YOLU KAPANIR.
//
// NEDEN BURADA, `smart/poller.cjs` ICINDE DEGIL: poller ve `performSsLaunch` ortak
// Self Service yolu; oraya ScaleX bilgisi koymak, kapinin cikarilma gerekcesinin
// (tek govde, modul basina kopya yok) tersi olurdu. Uzlastirici zaten tam da bu is
// icin var — "kimse bakmadi" durumunu sunucu tarafinda toplamak — ve portal yeniden
// baslasa bile calisir.
//
// IDEMPOTENT: her UPDATE `WHERE status = 'PENDING_APPROVAL'` kosuluyla yazar.
async function pendingApprovalTickets(limit) {
  const { rows } = await db.query(
    `SELECT TOP 50 smart_ticket_id, MIN(created_at) AS created_at
       FROM scalex_operations
      WHERE status = 'PENDING_APPROVAL' AND smart_ticket_id IS NOT NULL
      GROUP BY smart_ticket_id
      ORDER BY MIN(created_at) ASC`
  );
  return rows.slice(0, Math.min(limit, HARD_TOP));
}

// Bilet cozulmusse (onaylandi / reddedildi / zaman asimi) satirlari ilerlet.
// Bilet HALA bekliyorsa hicbir sey yapilmaz — 15 dakikalik SMART timeout'u
// poller'in isi, burada tekrar karar verilmez.
async function adoptApprovedTickets(cfg) {
  const tickets = await pendingApprovalTickets(cfg.batchSize);
  if (!tickets.length) return { adopted: 0, cancelled: 0 };

  const smartStore = require('../smart/store.cjs');
  let adopted = 0, cancelled = 0;

  for (const t of tickets) {
    const ticketId = Number(t.smart_ticket_id);
    let ticket = null;
    try {
      ticket = await smartStore.getTicket(ticketId);
    } catch (e) {
      console.warn(`[ScaleX] uzlastirici: Smart bileti #${ticketId} okunamadi:`, e.message);
      continue;
    }

    // Bilet YOK (silinmis / hic yazilamamis). Sonsuza dek PENDING_APPROVAL'da
    // asili kalmasin — ama yalnizca yeterince eskiyse; taze bir satir, biletin
    // yazilmasiyla ayni tick'e denk gelmis olabilir.
    if (!ticket) {
      const ageHours = t.created_at ? (Date.now() - new Date(t.created_at).getTime()) / 3600000 : 0;
      if (ageHours >= cfg.staleHours) {
        await resolveApproval(ticketId, 'CANCELLED', 'ORPHANED',
          'Smart bileti bulunamadi; onay durumu ogrenilemedi.');
        cancelled++;
      }
      continue;
    }

    if (ticket.status === 'LAUNCHED' && ticket.awxJobId) {
      await db.query(
        `UPDATE scalex_operations
            SET status = 'RUNNING', awx_job_id = $2, awx_server_id = COALESCE(awx_server_id, $3),
                request_key = CONCAT(CAST(COALESCE(awx_server_id, $3) AS NVARCHAR(20)), ':', CAST($2 AS NVARCHAR(20))),
                approval_state = 'APPROVED', approved_at = GETUTCDATE(), updated_at = GETUTCDATE()
          WHERE smart_ticket_id = $1 AND status = 'PENDING_APPROVAL'`,
        [ticketId, Number(ticket.awxJobId), Number(ticket.awxServerId)]
      );
      // IZ: onaylanmis bir prod islemi TAM BURADA baslamis sayilir — kullanicinin
      // "Calistir"a bastigi andan saatler sonra olabilir. Denetim kaydinda bu gecis
      // yoksa, isin ne zaman gercekten calistigi hicbir yerden okunamaz.
      auditPortal(null, 'scalex_approval_adopted', {
        username: ticket.username || 'system:scalex-reconciler',
        detail: JSON.stringify({ ticketId, awxServerId: ticket.awxServerId, awxJobId: ticket.awxJobId }),
      });
      adopted++;
      continue;
    }

    if (['REJECTED', 'TIMEOUT', 'CANCELLED', 'ERROR'].includes(ticket.status)) {
      await resolveApproval(ticketId, 'CANCELLED', ticket.status,
        ticket.errorMessage || `Smart bileti ${ticket.status} — is tetiklenmedi.`);
      auditPortal(null, 'scalex_approval_resolved', {
        username: ticket.username || 'system:scalex-reconciler', result: 'fail',
        detail: JSON.stringify({ ticketId, smartStatus: ticket.status }),
      });
      cancelled++;
    }
    // PENDING / LAUNCHING → hala bekliyor, dokunma.
  }
  return { adopted, cancelled };
}

async function resolveApproval(ticketId, status, approvalState, message) {
  await db.query(
    `UPDATE scalex_operations
        SET status = $2, approval_state = $3, error_message = $4, updated_at = GETUTCDATE()
      WHERE smart_ticket_id = $1 AND status = 'PENDING_APPROVAL'`,
    [ticketId, status, approvalState, String(message).slice(0, 500)]
  );
}

// ── YETIM GERI ALMA KILITLERI ───────────────────────────────────────────────
//
// Geri alma baslatilirken ayna satiri `restoring` fazina cekilir (bkz.
// state.tryLockRestore). Kilit normalde ya basarili geri almada satirin SILINMESIYLE
// ya da `finalizeOperation`/kapi reddi yollarinda ACIKCA birakilir. Ama portal tam o
// anda yeniden baslarsa ya da bir yol atlanirsa satir kilitli kalir ve kullanici o
// uygulamayi BIR DAHA HIC geri alamaz.
//
// ZAMAN PENCERESI KULLANILMAZ — kaynak `scalex_operations.status`tur: kilitli bir
// satirin karsiliginda calisan (RUNNING ya da PENDING_APPROVAL) bir geri alma islemi
// yoksa kilit yetimdir. Bir zaman esigi ya uzun bir isi erken serbest birakir ya da
// asili kalmis bir kilidi gereksiz yere tutar.
//
// Kesisim SQL'de DEGIL JS'te: `app_names_json` bir JSON dizi ve `OPENJSON` hem
// uyumluluk seviyesi 130+ ister hem SARGable degildir (ayni gerekce:
// server/logx/v2/restrictions.cjs).
async function releaseOrphanRestoreLocks() {
  const state = require('./state.cjs');
  const locked = await state.listLockedRestores();
  if (!locked.length) return { releasedLocks: 0 };

  const { rows } = await db.query(
    `SELECT env, tenant, cluster_name, namespace, app_names_json
       FROM scalex_operations
      WHERE action = 'restore' AND status IN ('RUNNING', 'PENDING_APPROVAL')`
  );
  const active = new Set();
  for (const r of rows) {
    let apps = [];
    // Bozuk JSON tum turu dusurmemeli: o satir icin "aktif is yok" varsaymak,
    // kilidi birakmak demek — guvenli taraf (kullanici tekrar deneyebilir).
    try { apps = JSON.parse(r.app_names_json || '[]'); } catch { apps = []; }
    for (const app of Array.isArray(apps) ? apps : []) {
      active.add([r.env, r.tenant, r.cluster_name, r.namespace, app].join('\u001f'));
    }
  }

  let releasedLocks = 0;
  for (const l of locked) {
    const key = [l.env, l.tenant, l.clusterName, l.namespace, l.appName].join('\u001f');
    if (active.has(key)) continue;
    if (await state.unlockRestore(l)) releasedLocks++;
  }
  if (releasedLocks) {
    console.log(`[ScaleX] uzlastirici: ${releasedLocks} yetim geri alma kilidi birakildi.`);
    auditPortal(null, 'scalex_lock_released', {
      username: 'system:scalex-reconciler',
      detail: JSON.stringify({ released: releasedLocks }),
    });
  }
  return { releasedLocks };
}

async function tick() {
  const cfg = getConfig();

  // ONCE onay bekleyen satirlar: onaylanmis bir bilet bu turda RUNNING'e cekilirse
  // ayni tick'in ilerleyen kisminda zaten sonuclandirilabilir hale gelir.
  // Bu tur PATLASA BILE asagidaki sonuclandirma calismali — ikisi bagimsiz.
  let approval = { adopted: 0, cancelled: 0 };
  try {
    approval = await adoptApprovedTickets(cfg);
  } catch (e) {
    console.warn('[ScaleX] uzlastirici: onay turu basarisiz:', e.message);
  }
  if (approval.adopted || approval.cancelled) {
    console.log(`[ScaleX] uzlastirici: ${approval.adopted} onayli is devralindi, ${approval.cancelled} onay kaydi kapatildi.`);
  }

  // Yetim kilitler: bu tur PATLASA BILE asagidaki sonuclandirma calismali.
  let locks = { releasedLocks: 0 };
  try {
    locks = await releaseOrphanRestoreLocks();
  } catch (e) {
    console.warn('[ScaleX] uzlastirici: kilit turu basarisiz:', e.message);
  }

  const jobs = await pendingJobs(cfg.batchSize);
  if (!jobs.length) return { checked: 0, finalized: 0, stale: 0, ...approval, ...locks };

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
  return { checked: jobs.length, finalized, stale, ...approval, ...locks };
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
module.exports = { tick, startReconciler, getConfig, pendingJobs, pendingApprovalTickets, adoptApprovedTickets, releaseOrphanRestoreLocks, HARD_TOP };
