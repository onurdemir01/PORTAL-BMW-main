// src/components/common/pencereKlavye.ts - kendi yazilmis katman / pencerelerin klavye davranisi.
//
// Ortak Modal (common/Modal.tsx) ESC'yi ve odagi zaten yonetiyor. Bu dosya, Modal kullanmayan
// (ekranin icinde `fixed inset-0` ile cizilen) onay katmanlari ve kullanici eylemiyle acilan
// adimlar icin iki yardimci verir:
//
//   useEscIleKapat(acik, kapat)  katman acikken ESC onu kapatir. Arka plana tiklayinca kapanan
//                                bir katman klavyeyle de kapanabilmeli (fare kullanicisinin
//                                sahip oldugu cikisin klavye esi).
//   acilincaOdakla               `autoFocus` yerine ref geri cagirimi. WAI-ARIA dialog deseni:
//                                kullanici bir pencere / adim actiginda odak onun ilk alanina
//                                tasinir. `autoFocus` (Sonar S9379) bunu sayfa ILK yuklenirken de
//                                yapar ve ekran okuyucu kullanicisi sayfanin basini atlar; bu
//                                yardimci, kullanici sayfada henuz hicbir sey yapmadiysa odagi
//                                TASIMAZ.
import { useEffect, useLayoutEffect, useRef } from 'react';

// UST USTE KATMAN: yalniz EN USTTEKI katman ESC'ye yanit verir (Modal.tsx'teki yiginla ayni
// fikir). Dinleyici YAKALAMA evresinde ve `window` uzerinde: bir Modal'in icinde acilan katmanda
// ESC once buraya gelir, katmani kapatir ve olayi durdurur; alttaki Modal acik kalir.
const acikKatmanlar: object[] = [];

export function useEscIleKapat(acik: boolean, kapat: () => void) {
  const kapatRef = useRef(kapat);
  useEffect(() => {
    kapatRef.current = kapat;
  }, [kapat]);

  // ILK KAREDEN itibaren (2026-11-27): kayit LAYOUT efektinde, tarayici katmani cizmeden once.
  // Pasif efekt (useEffect) cizimden SONRA kosar; arada basilan ESC alttaki pencereyi kapatiyordu.
  useLayoutEffect(() => {
    if (!acik) return;
    const kimlik = {};
    acikKatmanlar.push(kimlik);
    function tus(e: KeyboardEvent) {
      if (e.key !== 'Escape' || acikKatmanlar[acikKatmanlar.length - 1] !== kimlik) return;
      e.stopPropagation();
      kapatRef.current();
    }
    window.addEventListener('keydown', tus, true);
    return () => {
      window.removeEventListener('keydown', tus, true);
      const i = acikKatmanlar.indexOf(kimlik);
      if (i >= 0) acikKatmanlar.splice(i, 1);
    };
  }, [acik]);
}

// Kullanici sayfada bir kez tikladi ya da bir tusa bastiysa artik "sayfa yukleniyor" degiliz.
let kullaniciEylemiVar = false;
if (typeof window !== 'undefined') {
  const isaretle = () => {
    kullaniciEylemiVar = true;
  };
  window.addEventListener('pointerdown', isaretle, { capture: true, once: true });
  window.addEventListener('keydown', isaretle, { capture: true, once: true });
}

/** Ref geri cagirimi: oge DOM'a girdigi anda odaklanir (React'in autoFocus'uyla ayni an).
 *  Modul duzeyinde SABIT bir fonksiyon oldugu icin her render'da yeniden cagrilmaz; yalniz
 *  oge ilk kez yerlestiginde calisir, kullanici baska alana gectiyse odagi geri cekmez. */
export function acilincaOdakla(el: HTMLElement | null) {
  if (el && kullaniciEylemiVar) el.focus();
}
