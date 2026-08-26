// server/oco/window.cjs — OCO "planlanan kesinti penceresi" hesabi. SAF FONKSIYON:
// ne ag ne DB dokunur, bu yuzden kural birebir test edilebilir (bkz. __tests__).
//
// KURAL (kullanici tarafindan 2026-08-26'da tanimlandi):
//   * PlannedInterruption.InterruptionStartDate == InterruptionEndDate ise, OCO'da tek
//     bir AN verilmis demektir; otomasyon o andan itibaren 2 SAAT boyunca tetiklenebilir.
//   * Iki deger FARKLI ise, OCO gercek bir ARALIK vermistir; pencere aynen o aralik olur.
//   * Pencerenin SONU gectiyse islem YAPILMAZ: "OCO kaydinizi kacirdiniz" uyarisi.
//   * Pencere HENUZ BASLAMADIYSA kullaniciya iki secenek sunulur (scheduled tetikleme
//     ya da o saatte tekrar gelme) - bu karar UI'da verilir, burada yalnizca "before"
//     asamasi bildirilir.
'use strict';

// Varsayilan pencere genisligi: baslangic ve bitis AYNI oldugunda uygulanir.
const EQUAL_DATE_WINDOW_MS = 2 * 60 * 60 * 1000;

// OCO "dd.MM.yyyy HH:mm:ss" formatinda dizi doner (ornek: "25.08.2026 22:00:00").
// Date(string) ile AYRISTIRILMAZ: bu format standart degil, V8 onu ya reddeder ya da
// platforma gore FARKLI yorumlar (ay/gun yer degistirebilir). Alanlar tek tek okunup
// yerel saatte kurulur - OCO tarihleri kurum saatiyle (Europe/Istanbul) verilir ve
// Portal sunucusu da o saat diliminde calisir.
function parseOcoDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, dd, MM, yyyy, HH, mm, ss] = m;
  const d = new Date(Number(yyyy), Number(MM) - 1, Number(dd), Number(HH), Number(mm), Number(ss || 0), 0);
  // Tasma kontrolu: "31.02.2026" gibi bir deger JS'te 3 Mart'a KAYAR. Geri okuyup
  // dogrulamazsak gecersiz bir OCO tarihi sessizce baska bir gune oturur.
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(MM) - 1 || d.getDate() !== Number(dd)) return null;
  return d;
}

function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// { startDate, endDate } ham OCO dizileri; now test edilebilirlik icin disaridan gelir.
// Donen `phase`:
//   'before'  -> pencere baslamadi (kullaniciya secenek sorulur)
//   'inside'  -> pencere acik (hemen calistirilabilir)
//   'expired' -> pencere kapandi (islem YAPILMAZ)
function evaluateWindow({ startDate, endDate, now = new Date() }) {
  const start = parseOcoDate(startDate);
  if (!start) {
    return { ok: false, reason: 'PARSE', message: `OCO kaydindaki kesinti baslangic tarihi okunamadi: "${startDate}".` };
  }
  // Bitis okunamazsa baslangica esit SAYILIR (2 saatlik pencere) - "bitis yok" diye
  // sinirsiz izin vermek, kacirilmis bir OCO ile prod'a dokunmak demek olurdu.
  const endParsed = parseOcoDate(endDate);
  const end = endParsed || start;

  const equal = end.getTime() === start.getTime();
  const windowStart = start;
  const windowEnd = equal ? new Date(start.getTime() + EQUAL_DATE_WINDOW_MS) : end;

  // Bozuk kayit: bitis baslangictan ONCE. Pencere hesaplanamaz, izin verilmez.
  if (windowEnd.getTime() < windowStart.getTime()) {
    return {
      ok: false, reason: 'INVALID_RANGE',
      message: `OCO kaydindaki kesinti araligi gecersiz: bitis (${fmt(end)}) baslangictan (${fmt(start)}) once.`,
    };
  }

  const t = now.getTime();
  let phase;
  if (t < windowStart.getTime()) phase = 'before';
  else if (t <= windowEnd.getTime()) phase = 'inside';
  else phase = 'expired';

  return {
    ok: true,
    equal,
    phase,
    start, end, windowStart, windowEnd,
    startText: fmt(start),
    endText: fmt(end),
    windowStartText: fmt(windowStart),
    windowEndText: fmt(windowEnd),
    canRunNow: phase === 'inside',
    canSchedule: phase === 'before',
    message:
      phase === 'expired'
        ? 'OCO kaydınızı kaçırdınız. Lütfen yeni bir OCO veya Problem kaydı açarak tekrar işlem deneyiniz.'
        : phase === 'inside'
          ? `OCO kesinti penceresi AÇIK (${fmt(windowStart)} — ${fmt(windowEnd)}). İşlem şimdi çalıştırılabilir.`
          : `OCO'da belirtilen kesinti ${fmt(windowStart)} tarihinde başlıyor.`,
  };
}

// OCO cevabinin govdesinden PlannedInterruption alanini cikarir. Servis alan adlarini
// bazen farkli kasada donduruyor olabilir diye anahtar eslemesi harf duyarsiz yapilir.
function extractPlannedInterruption(payload) {
  const result = payload?.GetChangeOrderByWfInstanceIdResult?.Result;
  if (!result) return null;
  const pi = result.PlannedInterruption;
  if (!pi || typeof pi !== 'object') return null;
  const pick = (name) => {
    const key = Object.keys(pi).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? pi[key] : undefined;
  };
  return {
    startDate: pick('InterruptionStartDate'),
    endDate: pick('InterruptionEndDate'),
  };
}

module.exports = { parseOcoDate, evaluateWindow, extractPlannedInterruption, fmt, EQUAL_DATE_WINDOW_MS };
