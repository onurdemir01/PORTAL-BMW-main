// src/components/opsx/steps/LegacyJvmSelectStep.tsx — Legacy dump bacağında JVM seçimi.
//
// NEDEN AYRI BİR KEŞİF ADIMI: aynı uygulamaya ait bir host'ta BİRDEN FAZLA JVM çalışıyor
// olabilir — eskiden dump playbook'u PID'i körlemesine (ilk eşleşen JBoss/WildFly/EAP
// prosesi) alıyordu, uygulama adını hiç kullanmıyordu. Artık OcpPodSelectStep'teki AYNI
// desen: adım açılır açılmaz bir AWX job'ı (opsx_legacy_jvm_discover.yml) tetiklenir, iş
// bitene kadar beklenir, seçili host'larda application adına çalışan JVM'ler (PID + komut
// satırı) HOST BAZINDA gruplu listelenir — namespace/pod'un aksine burada birden fazla
// host aynı anda söz konusu olduğu için gruplama gerekli (pod keşfinde tek namespace vardı).
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxJvm, type OpsxPidSelection } from "@/api/opsxApi";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

function jvmKey(host: string, pid: string): string {
  return `${host}::${pid}`;
}

// Playbook her zaman '7'/'8' etiketlemeli (bkz. opsx_legacy_jvm_discover.yml) — ama AWX'teki
// job template hâlâ ESKİ (jbossMajor'sız) sürümü çalıştırıyorsa bu alan boş/eksik gelebilir.
// Böyle bir JVM SEÇİLEMEZ hale getirilir (dump playbook'u hangi SABİT JDK yolunu kullanacağını
// bilemez) — backend'in kriptik "Geçersiz JBoss sürümü: undefined" hatasına düşmek yerine
// sorun burada, net bir mesajla gösterilir.
function isKnownMajor(j: OpsxJvm): boolean {
  return j.jbossMajor === "7" || j.jbossMajor === "8";
}

const LegacyJvmSelectStep: React.FC<{
  application: string;
  hosts: string[];
  /** Kullanicinin isaretledigi JBoss majorleri — kesif YALNIZCA bu
   *  majorlerin kurulum yollarina bakar (bkz. server/opsx jbossMajorsFor). */
  hostMajors?: string[];
  busy?: boolean;
  onSubmit: (v: { pidMap: Record<string, OpsxPidSelection[]> }) => void;
}> = ({ application, hosts, hostMajors, busy, onSubmit }) => {
  const [jvms, setJvms] = useState<OpsxJvm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);

  // Keşif job'ı: tetikle → terminal duruma gelene kadar poll et → listeyi göster.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    setLoading(true);
    setError(null);
    setJvms([]);
    setSelected(new Set());

    async function poll(awxServerId: number, jobId: number) {
      try {
        const r = await opsxApi.legacyJvmStatus(awxServerId, jobId);
        if (cancelled) return;
        if (!TERMINAL.has(r.status)) {
          timer = window.setTimeout(() => poll(awxServerId, jobId), 3000);
          return;
        }
        if (r.jvms) {
          setJvms(r.jvms);
          // Bir host'ta TAM 1 JVM bulunduysa ön-işaretli gelir — kullanıcı yine de
          // "Devam Et"e basmalı, adım hiçbir zaman otomatik atlanmaz.
          const byHost = new Map<string, OpsxJvm[]>();
          for (const j of r.jvms) {
            (byHost.get(j.host) || byHost.set(j.host, []).get(j.host)!).push(j);
          }
          const preselected = new Set<string>();
          for (const list of byHost.values()) {
            if (list.length === 1 && isKnownMajor(list[0])) preselected.add(jvmKey(list[0].host, list[0].pid));
          }
          setSelected(preselected);
        } else {
          setError(r.message || "JVM listesi alınamadı.");
        }
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    opsxApi.discoverLegacyJvms(application, hosts, hostMajors)
      .then((r) => {
        if (cancelled) return;
        if (r.jobId == null) {
          setError(r.message || "JVM keşfi işi başlatılamadı.");
          setLoading(false);
          return;
        }
        poll(r.awxServerId, r.jobId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application, hosts.join(","), nonce]);

  const grouped = useMemo(() => {
    const g: Record<string, OpsxJvm[]> = {};
    for (const j of jvms) (g[j.host] ||= []).push(j);
    return g;
  }, [jvms]);

  function toggle(host: string, pid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = jvmKey(host, pid);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function submit() {
    const pidMap: Record<string, OpsxPidSelection[]> = {};
    for (const j of jvms) {
      if (!selected.has(jvmKey(j.host, j.pid)) || !isKnownMajor(j)) continue;
      (pidMap[j.host] ||= []).push({ pid: j.pid, jbossMajor: j.jbossMajor });
    }
    onSubmit({ pidMap });
  }

  if (loading) {
    return (
      <div className="py-8 text-center space-y-2">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-mono text-[var(--text-primary)]">{application}</span> için seçili sunucularda çalışan JVM'ler taranıyor…
        </p>
        <p className="text-xs text-[var(--text-muted)]">Bunun için bir Ansible işi çalıştırılıyor, birkaç saniye sürebilir.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn-secondary w-full text-sm">
          <ArrowPathIcon className="w-4 h-4" />
          Tekrar dene
        </button>
      </div>
    );
  }

  if (jvms.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Seçili sunucularda <strong>{application}</strong> adına çalışan bir JVM bulunamadı.</span>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn-secondary w-full text-sm">
          <ArrowPathIcon className="w-4 h-4" />
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Hangi JVM'(ler)den dump alınsın?</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{application}</span>
          {" · "}birden fazla JVM seçilebilir
        </p>
      </div>

      {jvms.some((j) => !isKnownMajor(j)) && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Bazı JVM'ler için sürüm belirlenemedi, bunlardan dump alınamaz. Bu genelde AWX'teki
            "OpsX — Legacy JVM Keşfi" job template'inin henüz güncel playbook'u çalıştırmadığını
            gösterir — yöneticinize bildirin.
          </span>
        </div>
      )}

      {hosts.filter((h) => !grouped[h.toUpperCase()]?.length).length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Şu sunucularda çalışan JVM bulunamadı, dump alınamayacak:{" "}
            {hosts.filter((h) => !grouped[h.toUpperCase()]?.length).join(", ")}
          </span>
        </div>
      )}

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {Object.keys(grouped).sort().map((host) => (
          <div key={host}>
            <label className="text-xs font-medium text-[var(--text-secondary)]">{host}</label>
            <div className="mt-1 space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[host].map((j) => {
                const known = isKnownMajor(j);
                return (
                  <label
                    key={j.pid}
                    title={known ? undefined : "Bu JVM için JBoss sürümü belirlenemedi (AWX'teki job template güncel olmayabilir) — dump alınamaz."}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] ${known ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(jvmKey(j.host, j.pid))}
                      onChange={() => toggle(j.host, j.pid)}
                      disabled={busy || !known}
                      className="rounded"
                    />
                    <span className="text-xs text-[var(--text-muted)] font-mono flex-shrink-0">PID {j.pid}</span>
                    <span className="flex-1 text-sm text-[var(--text-primary)] font-mono truncate" title={j.cmd}>{j.cmd}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                        known ? "bg-gray-50 text-gray-500 border-gray-200" : "bg-red-50 text-red-700 border-red-100"
                      }`}
                    >
                      {known ? `JBoss ${j.jbossMajor}` : "Sürüm belirlenemedi"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{selected.size} JVM seçildi</span>
        <button
          onClick={submit}
          disabled={selected.size === 0 || busy}
          className="btn-primary"
        >
          Dump Al
        </button>
      </div>
    </div>
  );
};

export default LegacyJvmSelectStep;
