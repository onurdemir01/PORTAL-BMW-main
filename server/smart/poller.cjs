// server/smart/poller.cjs — bekleyen Smart taleplerini periyodik olarak kontrol eder.
//
// REFERANS KOD TABANINDAN BILINCLI SAPMA: kardes ekibin kodu, onay bekleyen HER islem
// icin "while True: time.sleep(10)" ile SINIRSIZ bir dongu calistiriyordu — hem bir
// worker'i sonsuza dek isgal edebiliyordu (dis periyodik senkron isi calismazsa asla
// bitmiyordu) hem de o dis senkron isin NEREDE/NASIL zamanlandigi koddan gorunmuyordu
// (arastirma sirasinda dogrulanamadi). Burada TEK bir zamanlanmis interval, TUM
// bekleyen taleplere bakar.
//
// SURE SINIRI (2026-09-24, kullanici): varsayilan olarak SINIRSIZ. Onceki 15 dakikalik sinir,
// onay akisi birden fazla kisiden geciyorsa ya da kullanici sayfayi kapatip sonra onayladiysa
// talebi sessizce iptal ediyordu. Artik talep, onaylanana / reddedilene / elle iptal edilene
// kadar bekler. IKI istisna:
//   * OCO'dan dogan (production) talep: sinir kesinti penceresinin SONU - o saatten sonra is
//     zaten calismamali.
//   * SMART_TICKET_TIMEOUT_MINUTES ortam degiskeni verilmisse o sure.
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
      await ocoStore.markApprovalResolved(ocoId, {
        status: outcome.status,
        message: outcome.message,
      });
    }
  } catch (e) {
    // OCO kaydi guncellenemezse BILET yine dogru sonuclanmistir — tetikleme karari
    // bilete bagli. Burasi yalnizca gorunurluk; sessizce yutmak yerine uyar.
    console.warn(
      `[Smart] ticket #${ticket.id} sonucu OCO #${ocoId} kaydina yazilamadi:`,
      e.message,
    );
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
    // SURE SINIRI: varsayilan SINIRSIZ (null). OCO'dan dogan talepte sinir, kesinti
    // penceresinin SONUDUR: o saatten sonra is zaten calismamali, talebi acik tutmak
    // kullaniciya yanlis umut verir. Ortam degiskeni verilmisse ikisinin BUYUGU alinir -
    // pencere sonuna kadar onaylayabilmek, kisa bir genel sinir yuzunden kaybolmasin.
    const ageMinutes = (Date.now() - new Date(ticket.createdAt).getTime()) / 60000;
    let timeoutMinutes = cfg.ticketTimeoutMinutes; // null = sinirsiz
    const winEndIso = ticket?.pendingLaunch?.ocoWindowEndIso;
    if (winEndIso) {
      const until = new Date(winEndIso).getTime();
      const allowed = (until - new Date(ticket.createdAt).getTime()) / 60000;
      if (Number.isFinite(allowed)) {
        timeoutMinutes = timeoutMinutes == null ? allowed : Math.max(timeoutMinutes, allowed);
      }
    }
    if (timeoutMinutes != null && ageMinutes > timeoutMinutes) {
      await store
        .markState(ticket.id, {
          status: 'TIMEOUT',
          smartStateName: ticket.smartStateName,
          errorMessage: winEndIso
            ? `Kesinti penceresi (${new Date(winEndIso).toISOString()}) kapandi, Smart onayi gelmedi - is tetiklenmedi.`
            : `${Math.round(timeoutMinutes)} dakika icinde Smart onayi alinmadi - talep iptal edildi, otomasyon tetiklenmedi.`,
          resolved: true,
          expected: 'PENDING', // arada iptal edildiyse CANCELLED korunur
        })
        .catch((e) => console.warn('[Smart] TIMEOUT yazilamadi:', e.message));
      await syncOcoRecord(ticket, {
        status: 'FAILED',
        message: winEndIso
          ? 'Kesinti penceresi kapandi, Smart onayi gelmedi — is tetiklenmedi.'
          : `Smart onayi ${Math.round(timeoutMinutes)} dakikada gelmedi — is tetiklenmedi.`,
      });
      console.log(
        `[Smart] ticket #${ticket.id} ZAMAN ASIMI (${Math.round(timeoutMinutes)} dk) - otomasyon tetiklenmedi.`,
      );
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
      await store
        .markState(ticket.id, {
          status: 'REJECTED',
          smartStateName: status.stateName,
          resolved: true,
          expected: 'PENDING',
        })
        .catch((e) => console.warn('[Smart] REJECTED yazilamadi:', e.message));
      await syncOcoRecord(ticket, {
        status: 'FAILED',
        message: 'Smart onayi REDDEDILDI — is tetiklenmedi.',
      });
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
        await syncOcoRecord(ticket, {
          status: 'CANCELLED',
          message: 'Onay geldi ama talep bu arada iptal edilmisti — is tetiklenmedi.',
        });
        console.log(
          `[Smart] ticket #${ticket.id} onaylandi ama artik PENDING degil (iptal edilmis olabilir) — TETIKLENMEDI.`,
        );
        continue;
      }

      try {
        // Sonuc IKI turlu olabilir (2026-09-22): is hemen tetiklendi (jobId) ya da OCO
        // kesinti penceresine zamanlandi (scheduled: true) — ikincisinde job numarasi yok,
        // bilet "SCHEDULED" olarak kapanir ve OCO kaydi zamanlanmis olarak kalir.
        const outcome = (await _onApproved(ticket)) || {};
        const { jobId } = outcome;
        if (outcome.scheduled) {
          await store.markState(ticket.id, {
            status: 'SCHEDULED',
            smartStateName: status.stateName,
            errorMessage: `Onay alındı; iş ${outcome.runAtText || 'kesinti penceresine'} zamanlandı.`,
            resolved: true,
            expected: 'LAUNCHING',
          });
          console.log(`[Smart] ticket #${ticket.id} onaylandi -> is ${outcome.runAtText || ''} zamanlandi (AWX schedule ${outcome.awxScheduleId || '?'}).`);
          continue;
        }
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
        await store
          .markState(ticket.id, {
            status: 'ERROR',
            smartStateName: status.stateName,
            errorMessage: e.message,
            resolved: true,
            expected: 'LAUNCHING',
          })
          .catch(() => {});
        await syncOcoRecord(ticket, {
          status: 'FAILED',
          message: `Onay alindi ama AWX tetiklenemedi: ${e.message}`,
        });
        console.warn(`[Smart] ticket #${ticket.id} onaylandi ama launch basarisiz:`, e.message);
      }
      continue;
    }

    // Hala bekliyor — sadece guncel durum adini yaz (teshis icin), status PENDING kalir.
    if (status.stateName && status.stateName !== ticket.smartStateName) {
      await store
        .markState(ticket.id, {
          status: 'PENDING',
          smartStateName: status.stateName,
          expected: 'PENDING',
        })
        .catch(() => {});
    }
  }
}

// onApproved: talep onaylandiginda GERCEK AWX job'ini tetikleyecek fonksiyon —
// dongusel require'dan kacinmak icin runner.cjs disaridan enjekte eder.
function startPoller(onApproved) {
  _onApproved = onApproved;
  if (_timer) return; // zaten calisiyor (or. hot-reload/test ortami) — ikinci kez baslatma
  const cfg = getConfig();
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[Smart] poller tick hatasi:', e.message));
  }, cfg.pollIntervalSeconds * 1000);
  _timer.unref?.(); // process'in kapanmasini engellemesin
}

function stopPoller() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { startPoller, stopPoller, tick };
