// src/components/server_hub/sekmeGorunurlugu.tsx — Server Hub sekmeleri açık kalır, gizliyken susar (2026-11-05).
//
// Kullanıcı: "server hub çok yavaş her tıkladığımda bir şeyler yüklüyor". Sekme değişince bileşen sökülüp
// yeniden kuruluyor ve verisini baştan indiriyordu. Ziyaret edilen sekme artık AÇIK kalır, yalnız gizlenir
// (veri, süzgeç ve kaydırma konumu korunur). Gizli sekme bugünkü (kapalı) davranışı korur: ağ yoklaması
// yapmaz ve kendiliğinden pencere açmaz — useSekmeGorunur() false iken bu işler bekler.
import React, { createContext, useContext } from 'react';

const SekmeGorunurContext = createContext(true);

/** Bu bileşenin bulunduğu Server Hub sekmesi şu an görünür mü (sekme dışında hep true). */
export const useSekmeGorunur = () => useContext(SekmeGorunurContext);

/** Ziyaret edilmiş sekmenin kabı: görünür değilse gizlenir ama sökülmez. */
export function SekmeKabi({
  id,
  etkin,
  children,
}: {
  id: string;
  etkin: string;
  children: React.ReactNode;
}) {
  const gorunur = id === etkin;
  return (
    <div hidden={!gorunur} data-sekme={id}>
      <SekmeGorunurContext.Provider value={gorunur}>{children}</SekmeGorunurContext.Provider>
    </div>
  );
}
