import React, { createContext, useState, useEffect, useCallback, useContext } from "react";
import { nobetciApi, type NobetciResult } from "@/api/nobetciApi";
import { dynatraceApi } from "@/api/dynatraceApi";
import { ansibleApi } from "@/api/ansibleApi";

interface AppContextType {
  nobetci:          NobetciResult | null;
  nobetciLoading:   boolean;
  refreshNobetci:   () => void;

  dtHealth:         { ok?: boolean; configured: boolean; reachable?: boolean; mcpConnected?: boolean; environment?: string | null; message?: string } | null;
  dtHealthLoading:  boolean;

  /** `null` = katalog OKUNAMADI (0 = okundu ve yayında servis yok). */
  selfSrvCount:     number | null;
  selfSrvLoading:   boolean;
}

const AppContext = createContext<AppContextType>({
  nobetci: null, nobetciLoading: true, refreshNobetci: () => {},
  dtHealth: null, dtHealthLoading: true,
  selfSrvCount: 0, selfSrvLoading: true,
});

export const useAppData = () => useContext(AppContext);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nobetci, setNobetci]           = useState<NobetciResult | null>(null);
  const [nobetciLoading, setNobetciL]   = useState(true);

  const [dtHealth, setDtHealth]         = useState<{ ok?: boolean; configured: boolean; reachable?: boolean; mcpConnected?: boolean; environment?: string | null; message?: string } | null>(null);
  const [dtHealthLoading, setDtHealthL] = useState(true);

  // Self Service KPI'si (Dashboard "Durum" karti) — Smart/Diğerleri katalogu kaldirildigi
  // icin artik Ansible sekmesindeki (AWX'ten kayitli) servis sayisini gosterir.
  const [selfSrvCount, setSelfSrvCount] = useState<number | null>(0);
  const [selfSrvLoading, setSelfL]      = useState(true);

  const loadNobetci = useCallback(() => {
    setNobetciL(true);
    nobetciApi.today()
      .then(setNobetci)
      // Eskiden hata yutuluyor, `nobetci` null kaliyor ve kart SONSUZA DEK iskelet
      // gosteriyordu. Okunamadiysa bunu soyleyen bir sonuc yazilir.
      .catch((e: unknown) =>
        setNobetci({
          ok: false,
          message: e instanceof Error && e.message ? e.message : "Nöbet bilgisi alınamadı.",
        } as NobetciResult),
      )
      .finally(() => setNobetciL(false));
  }, []);

  useEffect(() => {
    loadNobetci();

    dynatraceApi.health()
      .then(setDtHealth)
      .catch(() => {})
      .finally(() => setDtHealthL(false));

    ansibleApi.ssItems()
      .then((r) => setSelfSrvCount((r.items || []).length))
      // OKUNAMADI != "0 servis". Eskiden hata yutuluyor, sayi 0 kaliyor ve Dashboard
      // "Yayinda servis yok" diyordu; oradaki "Katalog okunamadi" dali hic calisamiyordu.
      .catch(() => setSelfSrvCount(null))
      .finally(() => setSelfL(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContext.Provider value={{
      nobetci, nobetciLoading, refreshNobetci: loadNobetci,
      dtHealth, dtHealthLoading,
      selfSrvCount, selfSrvLoading,
    }}>
      {children}
    </AppContext.Provider>
  );
};
