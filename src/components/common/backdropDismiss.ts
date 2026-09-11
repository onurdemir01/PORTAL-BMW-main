// src/components/common/backdropDismiss.ts — "arka plana tiklayinca kapat" DOGRU HALI.
//
// TUZAK (kullanici bildirimi, 2026-09-11): pencereler
//     onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
// ile kapaniyordu. Tarayicida `click` olayi farenin BIRAKILDIGI ogeye gider. Kullanici
// YAML editorunde metin secmeye baslayip fareyi panelin DISINDA birakinca tarayici bunu
// "arka plana tiklandi" sayiyor, pencere kapaniyor ve girilen her sey gidiyordu.
//
// DOGRU KURAL: kapatma yalnizca basma (mousedown) VE birakma (click) IKISI DE arka
// planin kendisinde olduysa. Panelde baslayan bir surukleme asla kapatmaz.
//
// NEDEN HOOK (useRef): basma-birakma arasinda bir re-render olabilir (is ciktisi
// penceresi log'u periyodik ceker). Durum bir closure'da tutulsaydi re-render'da
// sifirlanir, mesru arka plan tiklamasi da kapatmazdi.
//
// Kullanim:
//   const bd = useBackdropDismiss(onClose);           // ya da (onClose, false)
//   <div onMouseDown={bd.onMouseDown} onClick={bd.onClick}>...</div>
//
// `enabled=false` ile arka plan tiklamasi TAMAMEN devre disi kalir: formu olan
// pencereler (is baslatma) icin dogru olan bu - kapatma yalnizca X / Iptal ile.
import { useCallback, useRef } from "react";
import type React from "react";

export function useBackdropDismiss(onClose: () => void, enabled = true) {
  const downOnBackdrop = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const upOnBackdrop = e.target === e.currentTarget;
      const both = downOnBackdrop.current && upOnBackdrop;
      downOnBackdrop.current = false;
      if (enabled && both) onClose();
    },
    [onClose, enabled],
  );

  return { onMouseDown, onClick };
}

/** Saf karar fonksiyonu - test edilebilsin diye hook'tan ayri. */
export function shouldDismiss(downOnBackdrop: boolean, upOnBackdrop: boolean, enabled = true) {
  return enabled && downOnBackdrop && upOnBackdrop;
}
