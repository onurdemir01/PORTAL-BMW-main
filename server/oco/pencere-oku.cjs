// server/oco/pencere-oku.cjs - OCO kaydini okur ve kesinti penceresini hesaplar.
//
// Ayni uc adim (getChangeOrder, extractPlannedInterruption, evaluateWindow) change-gates, runner,
// scalex ve retirement icinde kopya duruyor; yeni cagiran buradan gecer, kopyalar bilincli olarak bu
// degisiklikte tasinmadi. window.cjs saf kalsin diye ag erisimi burada.
'use strict';

/**
 * @param {string} rawNumber
 * @param {{now?: Date}} [o]
 * @returns {Promise<{ok: true, ocoNumber: string, order: object, pencere: object}
 *   | {ok: false, status: number, message: string}>}
 *   status: ocoClient.httpStatus; nginx'in yakaladigi kodlar 400'e cevrilir, kullanici metni gorur.
 */
async function ocoPenceresiOku(rawNumber, { now = new Date() } = {}) {
  const ocoClient = require('./client.cjs');
  const ocoWindow = require('./window.cjs');
  const ocoNumber = String(rawNumber == null ? '' : rawNumber).trim();
  let order;
  try {
    order = await ocoClient.getChangeOrder(ocoNumber);
  } catch (e) {
    return { ok: false, status: ocoClient.httpStatus(e), message: e.message };
  }
  const pi = ocoWindow.extractPlannedInterruption(order.payload);
  if (!pi?.startDate) {
    return {
      ok: false,
      status: 400,
      message: `OCO ${ocoNumber} kaydında planlanan kesinti tarihi yok (PlannedStartDate/PlannedEndDate ya da PlannedInterruption) — işlem yapılmadı.`,
    };
  }
  const pencere = ocoWindow.evaluateWindow({ startDate: pi.startDate, endDate: pi.endDate, now });
  if (!pencere.ok) return { ok: false, status: 400, message: pencere.message };
  return { ok: true, ocoNumber, order, pencere };
}

module.exports = { ocoPenceresiOku };
