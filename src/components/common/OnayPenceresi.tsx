// src/components/common/OnayPenceresi.tsx — portal ici onay penceresi (2026-11-08).
//
// 12 yerde `window.confirm` vardi: tarayicinin gri kutusu portal temasina ve koyu temaya
// uymuyor, dugmeleri tarayici dilinde ("OK" / "Cancel") yaziyor, tehlikeli islemle zararsiz
// olani ayirmiyordu. Bu kanca ayni akisi korur - `if (!(await onayla(...))) return;` - ama
// pencereyi ortak Modal ile cizer (odak tuzagi, ESC = iptal, kapaninca odak tetikleyen dugmeye).
//
// Provider YOK: kancayi kullanan bilesen `{onayPenceresi}`ni kendisi cizer; testlerde bilesen
// tek basina render edilir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export interface OnaySecenekleri {
  /** Sorulan sey. Satir sonlari korunur. */
  metin: string;
  baslik?: string;
  /** Onay dugmesinin metni; eylemi soyleyen fiil ("Sil", "Geri yükle"). */
  onayMetni?: string;
  /** Vazgecme dugmesinin metni (varsayilan "İptal"). Onaylanan eylemin kendisi bir iptalse
   *  ("Zamanlamayı iptal et") iki dugme ayni kelimeyi tasimasin diye ("Zamanlamayı koru").
   *  "Kapat" VERILMEZ: pencerenin X dugmesinin adi zaten "Kapat". */
  iptalMetni?: string;
  /** Geri alinamayan islem: onay dugmesi kirmizi. */
  tehlikeli?: boolean;
}

export function useOnay() {
  const [secenek, setSecenek] = useState<OnaySecenekleri | null>(null);
  const cozRef = useRef<((sonuc: boolean) => void) | null>(null);

  // Bekleyen soru varken bilesen kalkarsa soru IPTAL sayilir; bekleyen `await` asili kalmaz.
  useEffect(
    () => () => {
      cozRef.current?.(false);
      cozRef.current = null;
    },
    [],
  );

  const onayla = useCallback(
    (s: OnaySecenekleri | string) =>
      new Promise<boolean>((resolve) => {
        // Ust uste ikinci soru: oncekini iptal say (iki pencere ayni anda acik kalmaz).
        cozRef.current?.(false);
        cozRef.current = resolve;
        setSecenek(typeof s === 'string' ? { metin: s } : s);
      }),
    [],
  );

  // Tek sonuc: Promise zaten bir kez cozulur (cift tiklama / ESC + tiklama ikinci kez cozemez).
  // Ref yine de bosaltilir: kapanmis sorunun cozucusu bellekte tutulmasin.
  const kapat = (sonuc: boolean) => {
    const coz = cozRef.current;
    cozRef.current = null;
    setSecenek(null);
    coz?.(sonuc);
  };

  const onayPenceresi = (
    <Modal
      open={secenek !== null}
      onClose={() => kapat(false)}
      title={secenek?.baslik ?? 'Onay'}
      size="md"
      footer={
        <>
          <button
            type="button"
            className={secenek?.tehlikeli ? 'btn-danger' : 'btn-primary'}
            onClick={() => kapat(true)}
          >
            {secenek?.onayMetni ?? 'Devam'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => kapat(false)}>
            {secenek?.iptalMetni ?? 'İptal'}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line">{secenek?.metin}</p>
    </Modal>
  );

  return { onayla, onayPenceresi };
}
