// src/components/opsx/steps/WasBadges.tsx — WAS adımlarının ortam ve durum rozetleri.
import React from "react";
import { envBadgeClass, wasStateInfo } from "./wasLabels";

export const WasEnvBadge: React.FC<{ env: string }> = ({ env }) => (
  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${envBadgeClass(env)}`}>
    {env || "ortam yok"}
  </span>
);

export const WasStateBadge: React.FC<{ state: string }> = ({ state }) => {
  const info = wasStateInfo(state);
  return (
    <span
      title={info.hint}
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${info.cls}`}
    >
      {info.label}
    </span>
  );
};
