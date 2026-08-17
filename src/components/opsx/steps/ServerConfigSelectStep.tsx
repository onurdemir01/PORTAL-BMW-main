// src/components/opsx/steps/ServerConfigSelectStep.tsx — Legacy restart/stop/start
// bacağında JVM (server-config) seçimi.
//
// NEDEN AYRI BİR KEŞİF ADIMI: eskiden `application`'ın TEK bir server-config/server-group
// adı olduğu varsayılıp `/server-group={{ application }}_Group:stop-servers` ile GRUBUN
// TAMAMI hedefleniyordu. Bir uygulamaya birden fazla JVM (server-config) bağlı olabiliyor —
// LegacyJvmSelectStep.tsx (dump'ın PID keşfi) ile AYNI desen: adım açılır açılmaz bir AWX
// job'ı (bmw_portal/java_app_check/java_app_check.yml) tetiklenir, iş bitene kadar
// beklenir, seçili host'larda application adına uyan server-config'ler HOST BAZINDA
// gruplu, GÜNCEL STARTED/STOPPED durumlarıyla listelenir.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxServerConfig, type OpsxServerConfigSelection, type OpsxOperation } from "@/api/opsxApi";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

function cfgKey(host: string, name: string): string {
  return `${host}::${name}`;
}

const OPERATION_LABELS: Record<string, string> = {
  restart: "Restart Et",
  stop: "Durdur",
  start: "Başlat",
};

const ServerConfigSelectStep: React.FC<{
  application: string;
  hosts: string[];
  operation: OpsxOperation;
  busy?: boolean;
  onSubmit: (v: { serverConfigMap: Record<string, OpsxServerConfigSelection[]> }) => void;
}> = ({ application, hosts, operation, busy, onSubmit }) => {
  const [configs, setConfigs] = useState<OpsxServerConfig[]>([]);
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
    setConfigs([]);
    setSelected(new Set());

    async function poll(awxServerId: number, jobId: number) {
      try {
        const r = await opsxApi.legacyServerConfigStatus(awxServerId, jobId);
        if (cancelled) return;
        if (!TERMINAL.has(r.status)) {
          timer = window.setTimeout(() => poll(awxServerId, jobId), 3000);
          return;
        }
        if (r.serverConfigs) {
          setConfigs(r.serverConfigs);
          // Bir host'ta TAM 1 JVM bulunduysa ön-işaretli gelir — kullanıcı yine de
          // "Devam Et"e basmalı, adım hiçbir zaman otomatik atlanmaz.
          const byHost = new Map<string, OpsxServerConfig[]>();
          for (const c of r.serverConfigs) {
            (byHost.get(c.host) || byHost.set(c.host, []).get(c.host)!).push(c);
          }
          const preselected = new Set<string>();
          for (const list of byHost.values()) {
            if (list.length === 1) preselected.add(cfgKey(list[0].host, list[0].serverConfig));
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

    opsxApi.discoverLegacyServerConfigs(application, hosts)
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
    const g: Record<string, OpsxServerConfig[]> = {};
    for (const c of configs) (g[c.host] ||= []).push(c);
    return g;
  }, [configs]);

  function toggle(host: string, name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = cfgKey(host, name);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(configs.map((c) => cfgKey(c.host, c.serverConfig))));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function submit() {
    const serverConfigMap: Record<string, OpsxServerConfigSelection[]> = {};
    for (const c of configs) {
      if (!selected.has(cfgKey(c.host, c.serverConfig))) continue;
      (serverConfigMap[c.host] ||= []).push({ name: c.serverConfig, jbossMajor: c.jbossMajor });
    }
    onSubmit({ serverConfigMap });
  }

  if (loading) {
    return (
      <div className="py-8 text-center space-y-2">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-mono text-[var(--text-primary)]">{application}</span> için seçili sunucularda JVM'ler taranıyor…
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

  if (configs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Seçili sunucularda <strong>{application}</strong> adına uyan bir JVM (server-config) bulunamadı.</span>
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Hangi JVM'(ler) {OPERATION_LABELS[operation] || operation} edilsin?</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Uygulama: <span className="font-mono text-[var(--text-primary)]">{application}</span>
            {" · "}birden fazla veya tümü seçilebilir
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={selectAll} disabled={busy} className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
            Tümünü Seç
          </button>
          <button onClick={clearAll} disabled={busy} className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
            Temizle
          </button>
        </div>
      </div>

      {hosts.filter((h) => !grouped[h.toUpperCase()]?.length).length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Şu sunucularda uyan JVM bulunamadı, işlem uygulanamayacak:{" "}
            {hosts.filter((h) => !grouped[h.toUpperCase()]?.length).join(", ")}
          </span>
        </div>
      )}

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {Object.keys(grouped).sort().map((host) => (
          <div key={host}>
            <label className="text-xs font-medium text-[var(--text-secondary)]">{host}</label>
            <div className="mt-1 space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[host].map((c) => {
                const running = c.status === "running";
                return (
                  <label
                    key={c.serverConfig}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(cfgKey(c.host, c.serverConfig))}
                      onChange={() => toggle(c.host, c.serverConfig)}
                      disabled={busy}
                      className="rounded"
                    />
                    <span className="flex-1 text-sm text-[var(--text-primary)] font-mono truncate" title={c.serverConfig}>{c.serverConfig}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 bg-gray-50 text-gray-500 border-gray-200">
                      JBoss {c.jbossMajor}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                        running ? "bg-green-50 text-green-700 border-green-100" : "bg-gray-50 text-gray-500 border-gray-200"
                      }`}
                    >
                      {running ? "Çalışıyor" : "Durdurulmuş"}
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
          {OPERATION_LABELS[operation] || "Devam Et"}
        </button>
      </div>
    </div>
  );
};

export default ServerConfigSelectStep;
