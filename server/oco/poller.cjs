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

async function tick(now = new Date()) {
  if (!_launch) return;
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

    try {
      const result = await _launch(rec);
      await store.markLaunched(rec.id, result?.jobId ?? null);
      console.log(`[OCO] #${rec.id} tetiklendi (OCO ${rec.ocoNumber}) -> AWX job ${result?.jobId}`);
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
