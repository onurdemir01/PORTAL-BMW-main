// server/smart/deadline.cjs — bekleyen bir Smart talebinin SON TARIHI (zaman asimi ani).
//
// NEDEN AYRI DOSYA (2026-10-15): kural eskiden yalnizca poller.cjs'in icindeydi. Istemci
// "Zaman asimina kalan" sayacini gosterecek; sayacin dayandigi tarih poller'in GERCEKTEN
// TIMEOUT yazacagi andan farkli hesaplanirsa ekran "12 dk kaldi" derken talep iptal olur
// (ya da tersi). Tek kaynak burasi: poller da HTTP uclari da bu fonksiyonu cagirir.
//
// KURAL (bkz. config.cjs 2026-09-24 notu ve poller.cjs dosya basi):
//   * Varsayilan SINIRSIZ (cfg.ticketTimeoutMinutes null).
//   * SMART_TICKET_TIMEOUT_MINUTES verilmisse genel sinir o kadar dakika ('genel').
//   * Talep OCO'dan dogduysa (pendingLaunch.ocoWindowEndIso) sinir kesinti penceresinin
//     SONUDUR ('oco') - genel sinir ne olursa olsun:
//       - genel < pencere: pencere sonuna kadar onaylayabilmek, kisa bir genel sinir
//         yuzunden kaybolmasin.
//       - genel > pencere (2026-10-15 denetim): eski kural ikisinin BUYUGUNU aliyordu; talep
//         pencere kapandiktan sonra da PENDING kaliyor, gelen onay ise runner'daki
//         oco/window.nextRunAt kapisinda 'none' ile ERROR'a dusuyordu (is zaten calismaz).
//         Ekrandaki sayac olu bir talep icin "kalan sure" gosteriyordu. Artik pencere sonu.
//   * Okunamayan pencere tarihi YOK SAYILIR (poller'daki Number.isFinite kontrolu) - talep
//     genel sinira (ya da sinirsiza) duser.
//   * ISLEMIN KENDI KURALI ('islem', 2026-10-15, kullanici: "OpsX'deki Legacy ve Openshift fark
//     etmez prod islemleri icin 15 dakika zaman asimi kurali"): talebi acan modul
//     `pendingLaunch.onayZamanAsimiDk` koyarsa sinir createdAt + o kadar dakikadir. Genel sinirin
//     YERINE gecer (genel daha uzun ya da sinirsiz olsa bile - kural zaten "en gec bu kadar"
//     demektir). OCO penceresiyle birlikteyse ERKEN olan gecerlidir: pencere kapandiktan sonra is
//     zaten calismaz, kural dolduktan sonra da calismamali. Gecersiz/0/negatif deger YOK SAYILIR.
'use strict';

// Son tarih yalnizca bu durumlarda anlamli: talep hala onay bekliyor ya da onay gelmis,
// is tetiklenmek uzere sahiplenilmis. Diger durumlarda (LAUNCHED/REJECTED/TIMEOUT/...)
// talep kapanmistir; sayac gosterilmez.
const SURELI_DURUMLAR = new Set(['PENDING', 'LAUNCHING']);

/**
 * @param {{ createdAt: string|Date, pendingLaunch?: { ocoWindowEndIso?: string|null, onayZamanAsimiDk?: number|null } }} ticket
 * @param {{ ticketTimeoutMinutes?: number|null }} cfg  getConfig() ciktisi
 * @returns {{ deadline: Date|null, deadlineKaynak: 'oco'|'genel'|'islem'|null, timeoutMinutes: number|null }}
 *   timeoutMinutes: poller'in `yas > timeoutMinutes` karsilastirmasinda kullandigi deger
 *   (davranis birebir korunur). deadline: talebin bu andan SONRA TIMEOUT olacagi an.
 */
function talepSonTarihi(ticket, cfg) {
  const genel = cfg?.ticketTimeoutMinutes ?? null; // null = sinirsiz
  const createdMs = new Date(ticket?.createdAt).getTime();
  let timeoutMinutes = genel;
  let deadlineKaynak = genel != null ? 'genel' : null;
  let pencereSonuMs = null;

  const winEndIso = ticket?.pendingLaunch?.ocoWindowEndIso;
  if (winEndIso) {
    const until = new Date(winEndIso).getTime();
    const allowed = (until - createdMs) / 60000;
    if (Number.isFinite(allowed)) {
      timeoutMinutes = allowed;
      deadlineKaynak = 'oco';
      pencereSonuMs = until;
    }
  }

  const islemDk = Number(ticket?.pendingLaunch?.onayZamanAsimiDk);
  if (Number.isFinite(islemDk) && islemDk > 0) {
    const islemSonMs = createdMs + islemDk * 60000;
    // NaN createdMs: karsilastirma false; asagidaki kontrol zaten "sinir yok" doner.
    if (deadlineKaynak !== 'oco' || islemSonMs < pencereSonuMs) {
      timeoutMinutes = islemDk;
      deadlineKaynak = 'islem';
      pencereSonuMs = null;
    }
  }

  // NEDEN: createdAt okunamazsa poller'in yas hesabi NaN olur ve `NaN > x` hep false -
  // talep HIC zaman asimina dusmez. Ekran da "sure siniri yok" demeli, uydurma tarih degil.
  if (timeoutMinutes == null || !Number.isFinite(createdMs)) {
    return { deadline: null, deadlineKaynak: null, timeoutMinutes };
  }
  // NEDEN: 'oco'da tarih dogrudan pencere sonudur; createdAt + dakika geri donusumu
  // kayan nokta yuzunden milisaniye kaydirabilirdi.
  const deadline = new Date(pencereSonuMs != null ? pencereSonuMs : createdMs + timeoutMinutes * 60000);
  return { deadline, deadlineKaynak, timeoutMinutes };
}

/**
 * HTTP yanitlari icin: { deadline: ISO|null, deadlineKaynak }. Yalnizca PENDING/LAUNCHING
 * talepte hesaplanir; kapanmis talepte ikisi de null.
 */
function talepSonTarihiAlanlari(ticket, cfg) {
  if (!ticket || !SURELI_DURUMLAR.has(ticket.status)) {
    return { deadline: null, deadlineKaynak: null };
  }
  const { deadline, deadlineKaynak } = talepSonTarihi(ticket, cfg);
  return { deadline: deadline ? deadline.toISOString() : null, deadlineKaynak };
}

module.exports = { talepSonTarihi, talepSonTarihiAlanlari, SURELI_DURUMLAR };
