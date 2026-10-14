// src/components/opsx/useOnaySonrasiTakip.ts — Smart onayi bekleyen OpsX talebini izler.
//
// Kullanici (2026-10-14): "Smart kaydini onayladigim halde ... ana pencerede halen Smart talebi
// bekleniyormus gibi gozukuyor." Sagdaki "Taleplerim" paneli talebin durumunu soruyordu; OpsX ekrani
// talep acildigi anki gorunumde kaliyordu. Self Servis'teki desen (SelfServicePage pendingTicket):
// talep beklerken durum aralikla sorulur; LAUNCHED olunca `onBasladi` cagrilir (is takibine gecilir),
// reddedilen / iptal / zaman asimi / hata `talepSonu` olarak doner. Gecici ag hatasi takibi DURDURMAZ.
import { useEffect, useRef, useState } from "react";
import { ansibleApi } from "@/api/ansibleApi";

const BEKLEYEN = ["PENDING", "LAUNCHING"];

export interface TalepSonu {
  status: string;
  errorMessage?: string | null;
}

export function useOnaySonrasiTakip(
  ticketId: number | null | undefined,
  onBasladi: (is: { jobId: number; awxServerId: number }) => void,
  { ilkMs = 3000, aralikMs = 5000 }: { ilkMs?: number; aralikMs?: number } = {},
): { talepSonu: TalepSonu | null; sifirla: () => void } {
  const [talepSonu, setTalepSonu] = useState<TalepSonu | null>(null);
  // Geri cagrinin EN GUNCEL hali (effect her render'da yeniden kurulmasin).
  const basladiRef = useRef(onBasladi);
  useEffect(() => {
    basladiRef.current = onBasladi;
  });

  useEffect(() => {
    if (!ticketId || talepSonu) return;
    let cancelled = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const r = await ansibleApi.smartTicketStatus(ticketId as number);
        if (cancelled) return;
        if (r.ok && r.status === "LAUNCHED" && r.jobId) {
          basladiRef.current({ jobId: r.jobId, awxServerId: Number(r.awxServerId ?? 0) });
          return;
        }
        if (r.ok && !BEKLEYEN.includes(r.status)) {
          setTalepSonu({ status: r.status, errorMessage: r.errorMessage });
          return;
        }
      } catch {
        /* gecici hata: bir sonraki turda yeniden denenir */
      }
      if (!cancelled) timer = window.setTimeout(tick, aralikMs);
    }
    timer = window.setTimeout(tick, ilkMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [ticketId, talepSonu, ilkMs, aralikMs]);

  return { talepSonu, sifirla: () => setTalepSonu(null) };
}
