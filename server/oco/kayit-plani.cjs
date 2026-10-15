// server/oco/kayit-plani.cjs — OCO zamanlayicisinin tetikledigi kaydin OYNATMA PAKETI (2026-10-15).
//
// Kesinti penceresinin TEK dogru kaynagi kaydin kolonlaridir (run_at / window_end / oco_number):
// OCO poller'i tetikleme ve EXPIRED kararini bunlarla verir, ScaleX "/oco-schedules/:id/update"
// de YALNIZ bu kolonlari gunceller - pending_launch_json'a dokunmaz. Paket olduğu gibi
// oynatilirsa OCO numarasi degistirilmis kayitta Smart bileti ESKI pencereyi tasir:
//   * yeni pencere eskisinden sonraysa bilet ilk poller turunda TIMEOUT olur, is hic calismaz;
//   * yeni pencere eskisinden onceyse onay isi AWX'te ESKI pencereye (vazgecilen OCO'nun
//     saatine) zamanlar.
// Bu yuzden paketteki pencere alanlari ve OCO numarasi kayittan yeniden yazilir.
// Bkz. server/smart/__tests__/oco-yedek-yol-son-tarih.test.cjs (OY3).
'use strict';

function isoYap(d) {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * @param {{ runAt?: Date|string|null, windowEnd?: Date|string|null, ocoNumber?: string|null,
 *           pendingLaunch?: object }} rec
 * @returns {object} oynatilacak paket (rec.pendingLaunch DEGISTIRILMEZ)
 */
function ocoKaydiPlani(rec) {
  const plan = { ...(rec?.pendingLaunch || {}) };
  const bas = isoYap(rec?.runAt);
  const son = isoYap(rec?.windowEnd);
  if (bas && son) {
    plan.ocoWindowStartIso = bas;
    plan.ocoWindowEndIso = son;
  }
  const numara = rec?.ocoNumber ? String(rec.ocoNumber) : '';
  if (numara) {
    plan.ocoNumber = numara;
    if (plan.extraVars && typeof plan.extraVars === 'object' && 'oco_number' in plan.extraVars) {
      plan.extraVars = { ...plan.extraVars, oco_number: numara };
    }
  }
  return plan;
}

module.exports = { ocoKaydiPlani };
