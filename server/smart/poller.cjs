// server/smart/poller.cjs — bekleyen Smart taleplerini periyodik olarak kontrol eder.
//
// REFERANS KOD TABANINDAN BILINCLI SAPMA: kardes ekibin kodu, onay bekleyen HER islem
// icin "while True: time.sleep(10)" ile SINIRSIZ bir dongu calistiriyordu — hem bir
// worker'i sonsuza dek isgal edebiliyordu (dis periyodik senkron isi calismazsa asla
// bitmiyordu) hem de o dis senkron isin NEREDE/NASIL zamanlandigi koddan gorunmuyordu
// (arastirma sirasinda dogrulanamadi). Burada TEK bir zamanlanmis interval, TUM
// bekleyen taleplere bakar; her talebin ayrica bir SURE SINIRI (SMART_TICKET_TIMEOUT_HOURS)
// vardir — bu sure asilirsa talep TIMEOUT olarak isaretlenir, is akisi acikca
// "onay alinamadi" der, sonsuza dek beklemez.
'use strict';

const store = require('./store.cjs');
const client = require('./client.cjs');
const { getConfig, isConfigured } = require('./config.cjs');

let _timer = null;
let _onApproved = null; // (ticket) => Promise<{ jobId }> — runner.cjs'in gercek AWX launch fonksiyonu

async function tick() {
  if (!isConfigured()) return;
  const cfg = getConfig();
  let pending;
  try {
    pending = await store.listPending();
  } catch (e) {
    console.warn('[Smart] bekleyen talepler okunamadi:', e.message);
    return;
  }

  for (const ticket of pending) {
    const ageHours = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000;
    if (ageHours > cfg.ticketTimeoutHours) {
      await store.markState(ticket.id, {
        status: 'TIMEOUT',
        smartStateName: ticket.smartStateName,
        errorMessage: `${cfg.ticketTimeoutHours} saat icinde Smart onayi alinamadi.`,
        resolved: true,
      }).catch((e) => console.warn('[Smart] TIMEOUT yazilamadi:', e.message));
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
      }).catch((e) => console.warn('[Smart] REJECTED yazilamadi:', e.message));
      continue;
    }

    if (status.completed) {
      if (typeof _onApproved !== 'function') {
        console.warn(`[Smart] ticket #${ticket.id} onaylandi ama launch callback tanimli degil.`);
        continue;
      }
      try {
        const { jobId } = await _onApproved(ticket);
        await store.markState(ticket.id, {
          status: 'LAUNCHED',
          smartStateName: status.stateName,
          awxJobId: jobId,
          resolved: true,
        });
        console.log(`[Smart] ticket #${ticket.id} onaylandi -> AWX job #${jobId} tetiklendi.`);
      } catch (e) {
        await store.markState(ticket.id, {
          status: 'ERROR',
          smartStateName: status.stateName,
          errorMessage: e.message,
          resolved: true,
        }).catch(() => {});
        console.warn(`[Smart] ticket #${ticket.id} onaylandi ama launch basarisiz:`, e.message);
      }
      continue;
    }

    // Hala bekliyor — sadece guncel durum adini yaz (teshis icin), status PENDING kalir.
    if (status.stateName && status.stateName !== ticket.smartStateName) {
      await store.markState(ticket.id, { status: 'PENDING', smartStateName: status.stateName })
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
