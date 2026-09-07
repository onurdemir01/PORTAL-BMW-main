// server/inventory/history-scheduler.cjs — Envanter geçmişi günlük anlık görüntü zamanlayıcısı.
//
// TASARIM: "her gün saat X'te çalıştır" yerine "bugün için henüz çalışmadıysa çalıştır"
// denetimi yapılır ve bu denetim yarım saatte bir tekrarlanır. Sabit saatli bir kurulum,
// Portal o saatte kapalıysa (release, restart, bakım) O GÜNÜ TAMAMEN KAYBEDERDİ ve
// kaybedilen gün geriye dönük üretilemez. Bu kurgu kendi kendini onarır: sunucu gün
// içinde ne zaman ayağa kalkarsa kalksın, o günün anlık görüntüsü alınır.
//
// Anlık görüntü almak ucuzdur: değişiklik yoksa kaynak tablo + açık satırlar okunur ve
// HİÇBİR ŞEY yazılmaz (bkz. history.cjs). Yine de günde bir kez çalışması yeterlidir.
'use strict';

const CHECK_MS = 30 * 60 * 1000; // yarim saat
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // acilistan 2 dk sonra — boot yukunu bindirme

let _timer = null;

// RE-ENTRANCY GUARD: buyuk bir tabloda anlik goruntu on saniyeleri bulabilir. Bayrak
// olmadan ikinci bir tick ayni tabloyu paralel isler ve ayni degisikligi IKI KEZ yazabilir
// (ayni satir icin iki acik kayit). `finally` ile mutlaka birakilir.
let _running = false;

function todayUtcStart(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Bugun (UTC) icin basarili/atlanmis bir calistirma kaydi var mi? */
async function alreadyRanToday(now = new Date()) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 1 1 AS ok FROM inventory_history_runs
     WHERE started_at >= $1 AND status IN ('ok', 'skipped')`,
    [todayUtcStart(now)],
  );
  return rows.length > 0;
}

/**
 * Bir tur. `force` true ise "bugun zaten calisti mi" denetimi atlanir (elle tetikleme).
 * @returns {Promise<null|Array>} calistirilmadiysa null, calistiysa sonuc listesi
 */
async function tick({ force = false, now = new Date() } = {}) {
  if (_running) {
    console.warn('[EnvanterGecmis] onceki tur hala calisiyor — bu tur atlandi.');
    return null;
  }
  _running = true;
  try {
    if (!force) {
      try {
        if (await alreadyRanToday(now)) return null;
      } catch (e) {
        // Denetim sorgusu patlarsa (tablo henuz yok, DB kesintisi) anlik goruntu
        // ALINMAZ. Denetimi atlayip devam etmek, her turda tekrar tekrar calistirma
        // riski tasirdi.
        console.warn('[EnvanterGecmis] gunluk denetim yapilamadi:', e.message);
        return null;
      }
    }
    const res = await require('./history.cjs').snapshotAll(now);
    const ozet = res
      .map((r) => `${r.table}=${r.status}(+${r.added ?? 0}/~${r.changed ?? 0}/-${r.removed ?? 0})`)
      .join(' ');
    console.log("[EnvanterGecmis] anlik goruntu:", ozet);
    return res;
  } catch (e) {
    console.warn('[EnvanterGecmis] tur hatasi:', e.message);
    return null;
  } finally {
    _running = false;
  }
}

function start() {
  if (_timer) return;
  if (String(process.env.INVENTORY_HISTORY_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[EnvanterGecmis] INVENTORY_HISTORY_ENABLED=false — zamanlayici kapali.');
    return;
  }
  setTimeout(() => { tick().catch(() => {}); }, FIRST_RUN_DELAY_MS).unref?.();
  _timer = setInterval(() => { tick().catch(() => {}); }, CHECK_MS);
  _timer.unref?.();
  console.log('[EnvanterGecmis] zamanlayici basladi (yarim saatte bir "bugun calisti mi" denetimi).');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, tick, _alreadyRanToday: alreadyRanToday, _todayUtcStart: todayUtcStart };
