// src/components/opsx/steps/WasJvmSelectStep.tsx — canlı WAS keşfi ve TEK JVM seçimi.
//
// TOPLU İŞLEM YOK: seçim radyo düğmesiyle yapılır, aynı anda yalnız BİR (sunucu, JVM)
// seçilebilir. Sunucu da tek host + tek JVM dışında bir şey kabul etmez.
//
// "ÖLÇÜLEMEDİ" AYRI GÖSTERİLİR: keşif bir JVM'in durumunu ölçemediyse (kimlik yok,
// serverStatus yanıtsız, süreç sayısı ile serverStatus çelişkili, sunucuya erişilemedi)
// satır sarı "Ölçülemedi" rozetiyle görünür ve SEÇİLEMEZ. Asla "durmuş" gösterilmez.
//
// İşlemler duruma göre açılır (sunucu da aynı kapıyı uygular):
//   Çalışıyor → Durdur / Restart Et     Durmuş → Başlat     Askıda → Durdur / Restart Et (uyarıyla)
//
// Keşif sonucu 15 dakika geçerlidir; süre dolunca devam edilemez, keşif yenilenir.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import {
  opsxWasApi,
  type WasHost,
  type WasTarget,
  type WasOperation,
  type WasDiscoverStatus,
} from "@/api/opsxApi";
import { fmtTime } from "@/utils/datetime";
import { WasEnvBadge, WasStateBadge } from "./WasBadges";
import { WAS_OP_LABELS, wasClusterLabel, wasTargetKey } from "./wasLabels";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);
const OPS: WasOperation[] = ["restart", "stop", "start"];

export interface WasDiscoveryRef {
  jobId: number;
  awxServerId: number;
  finishedAt: string | null;
  validUntil: string | null;
}

interface Props {
  app: string;
  hosts?: string[];
  hostInfo: WasHost[];
  busy?: boolean;
  // Onay ekranından "Geri" ile dönülünce sihirbaz bu adımı yeniden kurar. `resume` verilirse
  // YENİ bir AWX keşif işi açılmaz, aynı keşfin sonucu yeniden okunur (süresi dolmuşsa ekran
  // bunu söyler). "Keşfi yenile" her zaman yeni iş açar.
  resume?: { jobId: number; awxServerId: number } | null;
  onSubmit: (v: { target: WasTarget; operation: WasOperation; discovery: WasDiscoveryRef }) => void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function blockedReason(t: WasTarget): string {
  if (t.hostOverall !== "ok") return `Sunucu ölçülemedi — gerçek durum bilinmiyor${t.reason ? ` (${t.reason})` : ""}.`;
  if (t.state === "OLCULEMEDI") return `Durum ölçülemedi — gerçek durum bilinmiyor${t.reason ? ` (${t.reason})` : ""}.`;
  if (t.state === "COKLU_SUREC") return "Birden fazla süreç eşleşti — hangisine dokunulacağı belirsiz.";
  if (t.kimlik !== "var") return `Profil kimliği (soap.client.props) ${t.kimlik === "yok" ? "bulunamadı" : "ölçülemedi"} — işlem yapılmaz.`;
  return t.reason || "Bu JVM üzerinde işlem yapılamaz.";
}

const WasJvmDiscovery: React.FC<Props & { onRefresh: () => void }> = ({ app, hosts, hostInfo, busy, resume, onSubmit, onRefresh }) => {
  // Keşif yalnız ilk açılışta başlar; "Keşfi yenile" bileşeni yeniden kurar (key).
  const initial = useRef({ app, hosts, resume });
  const [phase, setPhase] = useState<"running" | "done" | "error">("running");
  const [error, setError] = useState<string | null>(null);
  const [disc, setDisc] = useState<{ jobId: number; awxServerId: number } | null>(resume ?? null);
  const [result, setResult] = useState<WasDiscoverStatus | null>(null);
  const [expired, setExpired] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [operation, setOperation] = useState<WasOperation | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;
    let expiryTimer: number | undefined;
    const { app: a, hosts: h, resume: prev } = initial.current;

    const fail = (msg: string) => {
      setError(msg);
      setPhase("error");
    };

    const poll = async (awxServerId: number, jobId: number) => {
      try {
        const r = await opsxWasApi.discoverStatus(awxServerId, jobId);
        if (cancelled) return;
        if (!r.ok) return fail(r.message || "Keşif durumu alınamadı.");
        if (!TERMINAL.has(r.status)) {
          pollTimer = window.setTimeout(() => poll(awxServerId, jobId), 3000);
          return;
        }
        if (!r.targets) return fail(r.message || "Keşif sonucu alınamadı.");
        setResult(r);
        setPhase("done");
        const kalan = r.validUntil ? Date.parse(r.validUntil) - Date.now() : 0;
        if (!(kalan > 0)) setExpired(true);
        else expiryTimer = window.setTimeout(() => setExpired(true), Math.min(kalan, 2147483000));
      } catch (e: unknown) {
        if (!cancelled) fail(errText(e));
      }
    };

    if (prev) {
      poll(prev.awxServerId, prev.jobId);
      return () => {
        cancelled = true;
        if (pollTimer) window.clearTimeout(pollTimer);
        if (expiryTimer) window.clearTimeout(expiryTimer);
      };
    }

    opsxWasApi
      .discover(a, h)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok || r.jobId == null || r.awxServerId == null) return fail(r.message || "Keşif işi başlatılamadı.");
        setDisc({ jobId: r.jobId, awxServerId: r.awxServerId });
        poll(r.awxServerId, r.jobId);
      })
      .catch((e: unknown) => {
        if (!cancelled) fail(errText(e));
      });

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (expiryTimer) window.clearTimeout(expiryTimer);
    };
  }, []);

  const envOf = useMemo(() => new Map(hostInfo.map((h) => [h.host, h.env])), [hostInfo]);
  const targets = useMemo(() => result?.targets || [], [result]);
  const selected = targets.find((t) => wasTargetKey(t) === selectedKey) || null;

  if (phase === "running") {
    return (
      <div className="py-8 text-center space-y-2">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-mono text-[var(--text-primary)]">{app}</span> için WAS JVM'leri taranıyor…
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Salt okunur bir Ansible işi (was kullanıcısıyla ps + serverStatus) çalışıyor; hiçbir şey değiştirilmez.
          {disc ? ` AWX #${disc.jobId}` : ""}
        </p>
      </div>
    );
  }

  if (phase === "error" || !result || !disc) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error || "Keşif sonucu alınamadı."}</span>
        </div>
        <button onClick={onRefresh} className="btn-secondary w-full text-sm">
          <ArrowPathIcon className="w-4 h-4" />
          Tekrar dene
        </button>
      </div>
    );
  }

  const olculemeyen = (result.hosts || []).filter((h) => h.overall !== "ok");
  const uygulamasiz = (result.hosts || []).filter((h) => h.overall === "ok" && !h.hasApp);
  const warnings = selected && operation ? selected.warnings[operation] || [] : [];
  const canContinue = !!selected && !!operation && !expired && !result.appLock && !busy;

  function submit() {
    if (!selected || !operation || !disc || !result) return;
    onSubmit({
      target: selected,
      operation,
      discovery: { ...disc, finishedAt: result.finishedAt || null, validUntil: result.validUntil || null },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Hangi JVM üzerinde işlem yapılsın? (tek seçim)</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
            {" · "}keşif {fmtTime(result.finishedAt)}'de tamamlandı, {fmtTime(result.validUntil)}'e kadar geçerli
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={busy}
          className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 flex-shrink-0"
        >
          Keşfi yenile
        </button>
      </div>

      {result.appLock && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Bu uygulamada süren bir WAS işlemi var
            {result.appLock.holder ? ` (${result.appLock.holder}` : " ("}
            {result.appLock.target ? ` · ${result.appLock.target}` : ""}
            {result.appLock.jobId ? ` · AWX #${result.appLock.jobId}` : ""}). Aynı uygulamanın iki sunucusu aynı anda
            indirilmez — işlem bitince keşfi yenileyin.
          </span>
        </div>
      )}

      {expired && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Keşif sonucu 15 dakikayı geçti; işlem için keşfi yenileyin.</span>
        </div>
      )}

      {olculemeyen.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800 space-y-1">
          <div className="font-semibold">Ölçülemeyen sunucular — gerçek durum bilinmiyor:</div>
          {olculemeyen.map((h) => (
            <div key={h.host}>
              <span className="font-mono">{h.host}</span>
              {h.reason ? ` — ${h.reason}` : ""}
            </div>
          ))}
        </div>
      )}

      {uygulamasiz.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Şu sunucularda <span className="font-mono">{app}</span> adlı bir JVM bulunamadı:{" "}
          {uygulamasiz.map((h) => h.host).join(", ")}
        </p>
      )}

      {targets.length === 0 ? (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Keşfedilen sunucularda <strong>{app}</strong> adlı ölçülebilir bir WAS JVM'i yok.
          </span>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto" role="radiogroup" aria-label="WAS JVM seçimi">
          {targets.map((t) => {
            const k = wasTargetKey(t);
            const env = envOf.get(t.host) || "";
            return (
              <div key={k} className="border border-[var(--border)] rounded-xl">
                <label
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl ${t.selectable ? "cursor-pointer hover:bg-[var(--bg-elevated)]" : "cursor-not-allowed opacity-70"}`}
                >
                  <input
                    type="radio"
                    name="was-jvm"
                    value={k}
                    checked={selectedKey === k}
                    onChange={() => {
                      setSelectedKey(k);
                      setOperation(null);
                    }}
                    disabled={busy || !t.selectable}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-mono text-[var(--text-primary)] truncate">
                      {t.host} · {t.server}
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)] truncate">
                      {t.profile} · {t.node}
                      {t.cluster ? ` · ${wasClusterLabel(t.cluster)}` : ""}
                      {t.peers.total > 0 ? ` · diğer örnekler: ${t.peers.running}/${t.peers.total} çalışıyor` : ""}
                      {t.peers.unknown > 0 ? `, ${t.peers.unknown} ölçülemedi` : ""}
                    </span>
                  </span>
                  <WasEnvBadge env={env} />
                  <WasStateBadge state={t.state} />
                </label>
                {!t.selectable && <p className="px-3 pb-2 text-[11px] text-[var(--text-muted)]">{blockedReason(t)}</p>}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">İşlem (JVM'in ölçülen durumuna göre açılır):</p>
          <div className="grid grid-cols-3 gap-2">
            {OPS.map((op) => {
              const allowed = selected.allowedOps.includes(op);
              return (
                <button
                  key={op}
                  onClick={() => setOperation(op)}
                  disabled={busy || !allowed}
                  title={allowed ? undefined : "Bu JVM'in ölçülen durumunda bu işlem izinli değil."}
                  className={`px-3 py-2 text-sm rounded-xl border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                    operation === op
                      ? "border-[var(--accent)] text-[var(--text-primary)] bg-[var(--bg-elevated)] font-semibold"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]"
                  }`}
                >
                  {WAS_OP_LABELS[op]}
                </button>
              );
            })}
          </div>
          {warnings.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
              <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Bu işlem için onay ekranında ayrıca kabul edilmesi gereken {warnings.length} uyarı var.</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button onClick={submit} disabled={!canContinue} className="btn-primary">
          Devam — onay
        </button>
      </div>
    </div>
  );
};

const WasJvmSelectStep: React.FC<Props> = (props) => {
  const [nonce, setNonce] = useState(0);
  // `resume` yalnız ilk kurulumda geçerli; "Keşfi yenile" / "Tekrar dene" yeni iş açar.
  return (
    <WasJvmDiscovery
      key={nonce}
      {...props}
      resume={nonce === 0 ? props.resume : null}
      onRefresh={() => setNonce((n) => n + 1)}
    />
  );
};

export default WasJvmSelectStep;
