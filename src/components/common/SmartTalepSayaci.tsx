// src/components/common/SmartTalepSayaci.tsx — bir Smart talebi icin zaman asimi sayaci KAPISI.
//
// Sayac (SmartBeklemeSayaci) yalniz talep Smart'ta ONAY BEKLERKEN (PENDING) cizilir. Ekranlarin
// her biri (OpsX, Self Servis, Taleplerim, Admin > Smart Talepleri) bu kurali ayri ayri yazmasin
// diye tek yer burasi (2026-10-15).
// NEDEN LAUNCHING'de YOK: sunucu LAUNCHING'de de deadline donuyor (sozlesme), ama poller sureyi
// yalniz PENDING talepte uygular (store.listPending). LAUNCHING'de onay gelmistir, is saniyeler
// icinde baslar; "Kalan 03:12" yazmak talebin hala zaman asimina dusebilecegini ima ederdi.
import SmartBeklemeSayaci from './SmartBeklemeSayaci';

export interface SmartTalepSayaciProps {
  talep:
    | { status?: string | null; createdAt?: string | null; deadline?: string | null }
    | null
    | undefined;
  /** Talebin geldigi yanitin sunucu saati (saat kaymasi duzeltmesi). */
  serverNow?: string | null;
  /** O yanitin istemciye ulastigi yerel an (Date.now()); bayat yanitla kurulan sayac icin. */
  alindiMs?: number | null;
  kompakt?: boolean;
  className?: string;
}

export default function SmartTalepSayaci({ talep, serverNow, alindiMs, kompakt, className }: SmartTalepSayaciProps) {
  if (talep?.status !== 'PENDING') return null;
  return (
    <SmartBeklemeSayaci
      createdAt={talep.createdAt}
      deadline={talep.deadline}
      serverNow={serverNow}
      alindiMs={alindiMs}
      kompakt={kompakt}
      className={className}
    />
  );
}
