// server/oco/poller.cjs — OCO penceresi icin ZAMANLANMIS Self Service tetiklemeleri.
//
// server/smart/poller.cjs ile AYNI desen (tek interval, tum bekleyen kayitlara bakar,
// runner.cjs launch fonksiyonunu disaridan ENJEKTE eder — dongusel require olmasin).
// Fark: burada beklenen sey bir INSAN ONAYI degil, bir SAAT.
//
// IKI YONLU KORUMA:
//   * run_at gelmeden ASLA tetiklenmez.
//   * window_end gectiyse ARTIK tetiklenmez, EXPIRED yazilir. Portal kapaliyken pencere
//     tamamen gecmisse kayit acilista sessizce calismaz - OCO'nun izin vermedigi bir
//     saatte prod'a dokunmak, hic dokunmamaktan kotudur.
'use strict';

const store = require('./store.cjs');
const { getConfig } = require('./config.cjs');

let _timer = null;
let _launch = null; // (rec) => Promise<{ jobId }> — runner.cjs enjekte eder

// RE-ENTRANCY GUARD (2026-08-28): tick bir AWX cagrisinda 20+ saniye bekleyebilir;
// poll araligi bundan kisaysa `setInterval` ikinci bir tick baslatir ve AYNI kayit
// listesi ikinci kez islenir. Claim deseni bunu DB tarafinda zaten yakalar, ama guard
// gereksiz AWX trafigini ve log gurultusunu bastan onler. Test edilebilirlik icin tick
// yine disaridan cagrilabilir; bayrak `finally`de mutlaka birakilir.
let _ticking = false;

async function tick(now = new Date()) {
  if (!_launch) return;
  if (_ticking) {
    console.warn('[OCO] onceki tick hala calisiyor — bu tur atlandi.');
    return;
  }
  _ticking = true;
  try {
    await _tickBody(now);
  } finally {
    _ticking = false;
  }
}

async function _tickBody(now) {
  let scheduled;
  try {
    scheduled = await store.listScheduled();
  } catch (e) {
    console.warn('[OCO] zamanlanmis tetiklemeler okunamadi:', e.message);
    return;
  }

  for (const rec of scheduled) {
    const runAt = new Date(rec.runAt);
    const windowEnd = new Date(rec.windowEnd);

    if (now.getTime() > windowEnd.getTime()) {
      await store.markExpired(rec.id).catch((e) => console.warn('[OCO] EXPIRED yazilamadi:', e.message));
      console.log(`[OCO] #${rec.id} penceresi kapandi (OCO ${rec.ocoNumber}) - tetiklenmedi.`);
      continue;
    }
    if (now.getTime() < runAt.getTime()) continue; // henuz saati gelmedi

    // CLAIM (2026-08-28): AWX cagrisi ag uzerinde saniyeler surer. Once kaydi
    // SCHEDULED -> LAUNCHING yapip KAZANIRSAK tetikleriz. Kaybedersek (kullanici bu
    // arada iptal etti ya da portalin ikinci ornegi kapti) hicbir sey yapmayiz.
    // Eski kod kosulsuz `markLaunched` yaziyordu: iptal EZILIYOR, cok ornekli kurulumda
    // ayni is IKI KEZ tetiklenebiliyordu.
    const claimed = await store.claimForLaunch(rec.id).catch((e) => {
      console.warn(`[OCO] #${rec.id} claim edilemedi:`, e.message);
      return null;
    });
    if (!claimed) {
      console.log(`[OCO] #${rec.id} atlandi — kayit artik SCHEDULED degil (iptal edilmis ya da baska bir ornek kapmis).`);
      continue;
    }

    try {
      const result = await _launch(rec);
      // ONAY BEKLIYOR: Smart onayi acikken `_launch` job DEGIL, bilet doner. Bunu
      // LAUNCHED yazmak paneli yalan soyletirdi (yesil "Tetiklendi", ortada job yok).
      if (result?.pendingApproval) {
        await store.markPendingApproval(rec.id, {
          smartTicketId: result.ticketId,
          externalTicketId: result.externalTicketId,
        });
        console.log(`[OCO] #${rec.id} icin Smart onay talebi acildi (bilet #${result.externalTicketId}) — is HENUZ tetiklenmedi.`);
        continue;
      }
      const written = await store.markLaunched(rec.id, result?.jobId ?? null);
      if (!written) {
        // Job AWX'te BASLADI ama kayit arada iptal edilmis. Sessizce yutulmaz —
        // operatorun calisan job'i bilmesi gerekir.
        console.warn(`[OCO] #${rec.id} AWX job ${result?.jobId} BASLATILDI ama kayit arada iptal edilmis — job AWX'te calisiyor.`);
      } else {
        console.log(`[OCO] #${rec.id} tetiklendi (OCO ${rec.ocoNumber}) -> AWX job ${result?.jobId}`);
      }
    } catch (e) {
      // Tetikleme hatasi TEKRAR DENENMEZ: pencere daralirken her tick'te yeniden
      // denemek, ayni isi birden fazla kez baslatma riski tasir. Kayit FAILED yazilir,
      // kullanici "Zamanlanmis Isler" ekraninda sebebi gorur.
      await store.markFailed(rec.id, e.message).catch(() => {});
      console.warn(`[OCO] #${rec.id} tetiklenemedi:`, e.message);
    }
  }
}

function startPoller(launchFn) {
  _launch = launchFn;
  if (_timer) return;
  const cfg = getConfig();
  _timer = setInterval(() => { tick().catch((e) => console.warn('[OCO] poller tick hatasi:', e.message)); }, cfg.pollIntervalSeconds * 1000);
  _timer.unref?.();
}

function stopPoller() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startPoller, stopPoller, tick };
