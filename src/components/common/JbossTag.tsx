// src/components/common/JbossTag.tsx — sunucu satirindaki JBoss surum rozeti.
//
// NEDEN AYRI BILESEN: dort modulun (LogX, OpsX, Telnet, FileX) sunucu secim
// ekraninda da ayni rozet gerekiyor ve kopyalanan bir rozet, birinde yapilan
// duzeltmenin digerlerinde sessizce eskimesi demekti — bu depoda tam olarak bu
// yasandi (bkz. JbossVersionStep'in uc ayri kopyasi).
//
// RENK STATU DEGIL, DONEM BILDIRIR: JBoss 8 guncel kurulum (mavi/vurgu), JBoss 7
// eski (notr gri). Yesil/kirmizi/sari KULLANILMAZ — onlar bu ekranda "calisiyor /
// durmus" durumunun rengi ve surum bilgisine tasinmasi iki farkli seyi ayni dile
// sokardi. Ayirt etme yalnizca renge de birakilmaz: majör surum METIN olarak yazar.
import React from "react";
import { jbossLabel } from "@/utils/jboss";

interface Props {
  /** Majör surum ("7" / "8" / "" = bilinmiyor). */
  major: string;
  /** Envanterdeki TAM surum ("8.0.7"). Gosterilir cunku hangi sunucunun hangi
   *  yamada oldugunu gizlemek, ekrani anlamsizlastirirdi. */
  version?: string;
}

const JbossTag: React.FC<Props> = ({ major, version }) => (
  <span
    className={`pf-label ${major === "8" ? "pf-label--blue" : "pf-label--grey"}`}
    title={version ? `Envanterdeki sürüm: ${version}` : "Envanterde JBoss sürümü yok"}
  >
    {jbossLabel(major)}
    {version ? <span className="ml-1 font-mono opacity-70">{version}</span> : null}
  </span>
);

export default JbossTag;
