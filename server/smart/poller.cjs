// server/smart/poller.cjs — bekleyen Smart taleplerini periyodik olarak kontrol eder.
//
// REFERANS KOD TABANINDAN BILINCLI SAPMA: kardes ekibin kodu, onay bekleyen HER islem
// icin "while True: time.sleep(10)" ile SINIRSIZ bir dongu calistiriyordu — hem bir
// worker'i sonsuza dek isgal edebiliyordu (dis periyodik senkron isi calismazsa asla
// bitmiyordu) hem de o dis senkron isin NEREDE/NASIL zamanlandigi koddan gorunmuyordu
// (arastirma sirasinda dogrulanamadi). Burada TEK bir zamanlanmis interval, TUM
// bekleyen taleplere bakar; her talebin ayrica bir SURE SINIRI
// (SMART_TICKET_TIMEOUT_MINUTES, varsayilan 15 DAKIKA) vardir — bu sure asilirsa talep
// TIMEOUT olarak isaretlenip IPTAL edilir, otomasyon ASLA tetiklenmez, sonsuza dek beklemez.
'use strict';

const store = require('./store.cjs');
const client = require('./client.cjs');
const { getConfig, isConfigured } = require('./config.cjs');

let _timer = null;
let _onApproved = null; // (ticket) => Promise<{ jobId }> — runner.cjs'in gercek AWX launch fonksiyonu

// RE-ENTRANCY GUARD (2026-08-28): tek bir tick, N bekleyen bilet icin N ag cagrisi
// yapar; Smart yavaslarsa tick, poll araligindan uzun surer ve `setInterval` ikinci bir
// tick baslatir — ayni biletler iki kez islenir. Claim deseni cift TETIKLEMEYI DB
// tarafinda zaten engelliyor; guard gereksiz trafigi bastan keser.
let _ticking = false;

// ── OCO KAYDINI SENKRONLA (2026-08-28) ──────────────────────────────────────────
// Bilet bir OCO zamanlanmis kaydindan dogduysa (`pendingLaunch.ocoRecordId`), biletin
// sonucu OCO kaydina da yazilir. Yazilmazsa kayit PENDING_APPROVAL'da SONSUZA DEK
// asili kalir: kullanici "Zamanlanmis Isler" ekraninda ne calistigini ne de iptal
// edildigini gorur. Dongusel require yok — oco/store yalnizca db'ye bagli.
async function syncOcoRecord(ticket, outcome) {
  const ocoId = ticket?.pendingLaunch?.ocoRecordId;
  if (!ocoId) return;
  try {
    const ocoStore = require('../oco/store.cjs');
    if (outcome.launched) {
      await ocoStore.markApprovedLaunched(ocoId, outcome.jobId ?? null);
    } else {
      await ocoStore.markApprovalResolved(ocoId, { status: outcome.status, message: outcome.message });
    }
  } catch (e) {
    // OCO kaydi guncellenemezse BILET yine dogru sonuclanmistir — tetikleme karari
    // bilete bagli. Burasi yalnizca gorunurluk; sessizce yutmak yerine uyar.
    console.warn(`[Smart] ticket #${ticket.id} sonucu OCO #${ocoId} kaydina yazilamadi:`, e.message);
  }
}

async function tick() {
  if (!isConfigured()) return;
  if (_ticking) {
    console.warn('[Smart] onceki tick hala calisiyor — bu tur atlandi.');
    return;
  }
  _ticking = true;
  try {
    await _tickBody();
  } finally {
    _ticking = false;
  }
}

async function _tickBody() {
  const cfg = getConfig();
  let pending;
  try {
    pending = await store.listPending();
  } catch (e) {
    console.warn('[Smart] bekleyen talepler okunamadi:', e.message);
    return;
  }

  for (const ticket of pending) {
    // SURE SINIRI EN BASTA kontrol edilir: suresi dolmus bir talep, Smart o sirada
    // "Tamamlandi" donse BILE asagidaki launch blogunа HIC ULASMAZ (continue). TIMEOUT
    // yazildiktan sonra listPending() yalnizca status='PENDING' dondurdugu icin talep
    // bir daha hic islenmez - otomasyon ASLA tetiklenmez.
    const ageMinutes = (Date.now() - new Date(ticket.createdAt).getTime()) / 60000;
    if (ageMinutes > cfg.ticketTimeoutMinutes) {
      await store.markState(ticket.id, {
        status: 'TIMEOUT',
        smartStateName: ticket.smartStateName,
        errorMessage: `${cfg.ticketTimeoutMinutes} dakika icinde Smart onayi alinmadi - talep iptal edildi, otomasyon tetiklenmedi.`,
        resolved: true,
        expected: 'PENDING',   // arada iptal edildiyse CANCELLED korunur
      }).catch((e) => console.warn('[Smart] TIMEOUT yazilamadi:', e.message));
      await syncOcoRecord(ticket, { status: 'FAILED', message: `Smart onayi ${cfg.ticketTimeoutMinutes} dakikada gelmedi — is tetiklenmedi.` });
      console.log(`[Smart] ticket #${ticket.id} ZAMAN ASIMI (${cfg.ticketTimeoutMinutes} dk) - otomasyon tetiklenmedi.`);
      continue;
    }

    let status;
    try {
      status = await client.checkTicketStatus(ticket.externalTicketId);
    } catch (e) {
      // Gecici bir Smart API hatasi butun bekleyen taleplerin surecini bozmasin —
      // bir sonraki tick'te tekrar denenir; talep PENDING kalir.
      console.warn(`[Smart] ticket #${ticket.id} durum sorgusu basarisiz:`, e.message);
      continue;
    }

    if (status.rejected) {
      await store.markState(ticket.id, {
        status: 'REJECTED',
        smartStateName: status.stateName,
        resolved: true,
        expected: 'PENDING',
      }).catch((e) => console.warn('[Smart] REJECTED yazilamadi:', e.message));
      await syncOcoRecord(ticket, { status: 'FAILED', message: 'Smart onayi REDDEDILDI — is tetiklenmedi.' });
      continue;
    }

    if (status.completed) {
      if (typeof _onApproved !== 'function') {
        console.warn(`[Smart] ticket #${ticket.id} onaylandi ama launch callback tanimli degil.`);
        continue;
      }
      // SAHIPLEN, SONRA TETIKLE. `checkTicketStatus` ag uzerinde bekledi; bu arada
      // kullanici iptal etmis olabilir. Claim'i kaybedersek is TETIKLENMEZ.
      const claimed = await store.claimForLaunch(ticket.id).catch((e) => {
        console.warn(`[Smart] ticket #${ticket.id} claim edilemedi:`, e.message);
        return null;
      });
      if (!claimed) {
        await syncOcoRecord(ticket, { status: 'CANCELLED', message: 'Onay geldi ama talep bu arada iptal edilmisti — is tetiklenmedi.' });
        console.log(`[Smart] ticket #${ticket.id} onaylandi ama artik PENDING degil (iptal edilmis olabilir) — TETIKLENMEDI.`);
        continue;
      }

      try {
        const { jobId } = await _onApproved(ticket);
        await store.markState(ticket.id, {
          status: 'LAUNCHED',
          smartStateName: status.stateName,
          awxJobId: jobId,
          resolved: true,
          expected: 'LAUNCHING',
        });
        await syncOcoRecord(ticket, { launched: true, jobId });
        console.log(`[Smart] ticket #${ticket.id} onaylandi -> AWX job #${jobId} tetiklendi.`);
      } catch (e) {
        await store.markState(ticket.id, {
          status: 'ERROR',
          smartStateName: status.stateName,
          errorMessage: e.message,
          resolved: true,
          expected: 'LAUNCHING',
        }).catch(() => {});
        await syncOcoRecord(ticket, { status: 'FAILED', message: `Onay alindi ama AWX tetiklenemedi: ${e.message}` });
        console.warn(`[Smart] ticket #${ticket.id} onaylandi ama launch basarisiz:`, e.message);
      }
      continue;
    }

    // Hala bekliyor — sadece guncel durum adini yaz (teshis icin), status PENDING kalir.
    if (status.stateName && status.stateName !== ticket.smartStateName) {
      await store.markState(ticket.id, { status: 'PENDING', smartStateName: status.stateName, expected: 'PENDING' })
        .catch(() => {});
    }
  }
}

// onApproved: talep onaylandiginda GERCEK AWX job'ini tetikleyecek fonksiyon —
// dongusel require'dan kacinmak icin runner.cjs disaridan enjekte eder.
function startPoller(onApproved) {
  _onApproved = onApproved;
  if (_timer) return; // zaten calisiyor (ör. hot-reload/test ortami) — ikinci kez baslatma
  const cfg = getConfig();
  _timer = setInterval(() => { tick().catch((e) => console.warn('[Smart] poller tick hatasi:', e.message)); }, cfg.pollIntervalSeconds * 1000);
  _timer.unref?.(); // process'in kapanmasini engellemesin
}

function stopPoller() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startPoller, stopPoller, tick };
