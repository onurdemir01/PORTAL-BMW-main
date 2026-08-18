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

  selfSrvCount:     number;
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
  const [selfSrvCount, setSelfSrvCount] = useState(0);
  const [selfSrvLoading, setSelfL]      = useState(true);

  const loadNobetci = useCallback(() => {
    setNobetciL(true);
    nobetciApi.today()
      .then(setNobetci)
      .catch(() => {})
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
      .catch(() => {})
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
