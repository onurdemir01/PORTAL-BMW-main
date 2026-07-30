import React, { createContext, useState, useEffect, useCallback, useContext } from "react";
import { nobetciApi, type NobetciResult } from "@/api/nobetciApi";
import { dynatraceApi } from "@/api/dynatraceApi";
import { selfServiceApi } from "@/api/selfServiceApi";
import type { SelfServiceStore } from "@/types";

interface AppContextType {
  nobetci:          NobetciResult | null;
  nobetciLoading:   boolean;
  refreshNobetci:   () => void;

  dtHealth:         { ok?: boolean; configured: boolean; reachable?: boolean; mcpConnected?: boolean; environment?: string | null; message?: string } | null;
  dtHealthLoading:  boolean;

  selfSrvStore:     SelfServiceStore | null;
  selfSrvCount:     number;
  selfSrvLoading:   boolean;
}

const AppContext = createContext<AppContextType>({
  nobetci: null, nobetciLoading: true, refreshNobetci: () => {},
  dtHealth: null, dtHealthLoading: true,
  selfSrvStore: null, selfSrvCount: 0, selfSrvLoading: true,
});

export const useAppData = () => useContext(AppContext);

function countSsItems(store: SelfServiceStore | null): number {
  if (!store) return 0;
  let n = 0;
  for (const tab of store.tabs ?? []) {
    for (const sub of tab.subTabs ?? []) {
      n += sub.items?.length ?? 0;
    }
  }
  return n;
}

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nobetci, setNobetci]           = useState<NobetciResult | null>(null);
  const [nobetciLoading, setNobetciL]   = useState(true);

  const [dtHealth, setDtHealth]         = useState<{ ok?: boolean; configured: boolean; reachable?: boolean; mcpConnected?: boolean; environment?: string | null; message?: string } | null>(null);
  const [dtHealthLoading, setDtHealthL] = useState(true);

  const [selfSrvStore, setSelfSrvStore] = useState<SelfServiceStore | null>(null);
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

    selfServiceApi.get()
      .then((d) => setSelfSrvStore(d.store))
      .catch(() => {})
      .finally(() => setSelfL(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selfSrvCount = countSsItems(selfSrvStore);

  return (
    <AppContext.Provider value={{
      nobetci, nobetciLoading, refreshNobetci: loadNobetci,
      dtHealth, dtHealthLoading,
      selfSrvStore, selfSrvCount, selfSrvLoading,
    }}>
      {children}
    </AppContext.Provider>
  );
};
