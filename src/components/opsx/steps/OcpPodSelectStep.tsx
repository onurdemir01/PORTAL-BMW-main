// src/components/opsx/steps/OcpPodSelectStep.tsx — Openshift dump bacağında pod seçimi.
//
// NEDEN AYRI BİR KEŞİF JOB'I: pod adları efemeraldir (her deploy'da değişir), portalın
// envanterinde tutulamaz. Bu adım açılır açılmaz bir AWX job'ı (opsx_openshift_pods.yaml)
// tetiklenir, iş bitene kadar beklenir ve çıkan liste kullanıcıya sunulur — namespace/
// uygulama seçiminin aksine burada ÖNBELLEK YOKTUR, liste her zaman canlıdır.
//
// COK-CLUSTER x COK-NAMESPACE: bir tenant'a birden fazla gerçek OCP cluster'ı bağlı
// olabilir VE kullanıcı OcpTargetStep'te birden fazla (namespace,uygulama) çifti seçmiş
// olabilir — keşif ARTIK HEPSİNİN ÇAPRAZ ÇARPIMINA bakıyor (bkz. server/opsx/index.cjs
// resolveOcpClusterFanout + opsx_openshift_pods.yaml), bu yüzden pod'lar "cluster/namespace"
// birleşik etiketiyle GRUPLANIR (LegacyJvmSelectStep'in host bazlı gruplamasıyla AYNI
// desen) ve seçim {cluster,namespace,pod} üçlüsü olarak backend'e gider — dump playbook'u
// her pod'u KENDİ cluster'ına ve namespace'ine göre alır.
//
// Thread dump seçildiyse ayrıca "kaç dump, kaç saniye arayla" sorulur (varsayılan 1 dump,
// beklemesiz; sınırlar backend ve playbook ile AYNI: 1-100 adet, 0-3600 sn).
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { OCP_TUM_PODLAR, opsxApi, type OpsxPod, type OpsxDumpType, type OpsxOcpPair } from "@/api/opsxApi";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

// BATCH / JOB POD'U TAHMINI (2026-10-14): `oc get pods` ciktisi sahibi (owner kind) tasimaz; batch
// pod'u ADINDAN ve DURUMUNDAN tahmin edilir. CronJob pod'u: <cronjob>-<zamanlama sayisi (7+ hane)>-
// <5 karakter>; bitmis is pod'u: Completed / Error / OOMKilled ... Tahmin oldugu ekranda yazar.
const BATCH_AD_RE = /-\d{7,}-[a-z0-9]{5}$/i;
const BATCH_DURUM = new Set(["Completed", "Succeeded", "Error", "Failed", "OOMKilled", "DeadlineExceeded"]);
export function batchPodMu(p: Pick<OpsxPod, "name" | "status">): boolean {
  return BATCH_AD_RE.test(p.name) || BATCH_DURUM.has(p.status);
}
type PodSuzgec = "hepsi" | "batch" | "calisan";

function podKey(cluster: string, namespace: string, name: string): string {
  return `${cluster}::${namespace}::${name}`;
}

function groupLabel(cluster: string, namespace: string): string {
  return `${cluster} / ${namespace}`;
}

const OcpPodSelectStep: React.FC<{
  env: string;
  tenant: string;
  pairs: OpsxOcpPair[];
  dumpType: OpsxDumpType;
  /** 'poddelete' (2026-09-18): ayni kesif/secim, ama dump secenekleri yerine ONAY kutusu ve
   *  "Pod'lari sil" dugmesi. Varsayilan 'dump'. */
  mode?: "dump" | "poddelete";
  busy?: boolean;
  onSubmit: (v: { pods: { cluster: string; namespace: string; pod: string }[]; threadDumpCount: number; threadDumpInterval: number; consent: boolean }) => void;
}> = ({ env, tenant, pairs, dumpType, mode = "dump", busy, onSubmit }) => {
  const isDelete = mode === "poddelete";
  const [consent, setConsent] = useState(false);
  const [pods, setPods] = useState<OpsxPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kısmi başarı: bazı (cluster,namespace) çiftleri başarısız olsa da başarılı olanların
  // pod'ları gösterilir, bu sadece bir UYARI olarak eklenir (r.pods VE r.message BİRLİKTE gelebilir).
  const [warning, setWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Tüm pod'lar" seçiliyse arama BOŞ başlar: uygulama adıyla dolu arama batch pod'larını gizliyordu.
  const tumPodlar = pairs.some((p) => p.application === OCP_TUM_PODLAR);
  const [search, setSearch] = useState(tumPodlar ? "" : pairs[0]?.application || "");
  const [suzgec, setSuzgec] = useState<PodSuzgec>("hepsi");
  const [nonce, setNonce] = useState(0);

  const [threadDumpCount, setThreadDumpCount] = useState(1);
  const [threadDumpInterval, setThreadDumpInterval] = useState(0);

  const namespaceList = useMemo(() => [...new Set(pairs.map((p) => p.namespace))], [pairs]);
  const pairsKey = pairs.map((p) => p.namespace).sort().join(",");

  // Keşif job'ı: tetikle → terminal duruma gelene kadar poll et → listeyi göster.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    setLoading(true);
    setError(null);
    setWarning(null);
    setPods([]);
    setSelected(new Set());

    async function poll(awxServerId: number, jobId: number) {
      try {
        const r = await opsxApi.ocpPodsStatus(awxServerId, jobId);
        if (cancelled) return;
        if (!TERMINAL.has(r.status)) {
          timer = window.setTimeout(() => poll(awxServerId, jobId), 3000);
          return;
        }
        if (r.pods && r.pods.length > 0) {
          setPods(r.pods);
          if (r.message) setWarning(r.message);
        } else {
          setError(r.message || "Pod listesi alınamadı.");
        }
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    opsxApi.discoverOcpPods(env, tenant, pairs)
      .then((r) => {
        if (cancelled) return;
        if (r.jobId == null) {
          setError(r.message || "Pod keşfi işi başlatılamadı.");
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
  }, [env, tenant, pairsKey, nonce]);

  const filteredPods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pods.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (suzgec === "batch" && !batchPodMu(p)) return false;
      if (suzgec === "calisan" && p.status !== "Running") return false;
      return true;
    });
  }, [pods, search, suzgec]);
  const batchSayisi = useMemo(() => pods.filter(batchPodMu).length, [pods]);
  const gizli = pods.length - filteredPods.length;
  const seciliBatch = pods.some((p) => batchPodMu(p) && selected.has(podKey(p.cluster, p.namespace, p.name)));

  const grouped = useMemo(() => {
    const g: Record<string, OpsxPod[]> = {};
    for (const p of filteredPods) (g[groupLabel(p.cluster, p.namespace)] ||= []).push(p);
    return g;
  }, [filteredPods]);

  function toggle(cluster: string, namespace: string, name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = podKey(cluster, namespace, name);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const invalidCount = !Number.isInteger(threadDumpCount) || threadDumpCount < 1 || threadDumpCount > 100;
  const invalidInterval = !Number.isInteger(threadDumpInterval) || threadDumpInterval < 0 || threadDumpInterval > 3600;
  const threadOptionsInvalid = dumpType === "threaddump" && (invalidCount || invalidInterval);
  const ready = selected.size > 0 && !threadOptionsInvalid;

  function submit() {
    const targets = pods
      .filter((p) => selected.has(podKey(p.cluster, p.namespace, p.name)))
      .map((p) => ({ cluster: p.cluster, namespace: p.namespace, pod: p.name }));
    onSubmit({ pods: targets, threadDumpCount, threadDumpInterval, consent });
  }

  if (loading) {
    return (
      <div className="py-8 text-center space-y-2">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-mono text-[var(--text-primary)]">{namespaceList.join(", ")}</span> tüm cluster'larda taranıyor…
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

  if (pods.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Seçili namespace'lerde (<strong>{namespaceList.join(", ")}</strong>) çalışan pod bulunamadı.</span>
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
        <p className="text-sm text-[var(--text-secondary)]">
          {isDelete
            ? "Hangi pod'lar silinsin (OpenShift yeniden ayağa kaldırır)?"
            : `Hangi pod'lardan ${dumpType === "heapdump" ? "heap" : "thread"} dump alınsın?`}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Namespace{namespaceList.length > 1 ? "'ler" : ""}: <span className="font-mono text-[var(--text-primary)]">{namespaceList.join(", ")}</span>
          {" · "}birden fazla pod seçilebilir
        </p>
      </div>

      {warning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Bazılarına ulaşılamadı: {warning}. Aşağıda erişilebilenlerin pod'ları listelendi.</span>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pod adında ara…"
        aria-label="Pod adında ara"
        className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
      />

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {(
          [
            ["hepsi", `Tümü (${pods.length})`],
            ["batch", `Batch / job (${batchSayisi})`],
            ["calisan", "Çalışanlar (Running)"],
          ] as const
        ).map(([id, etiket]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSuzgec(id)}
            aria-pressed={suzgec === id}
            className={`px-2.5 py-1 rounded-lg border ${suzgec === id ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "border-[var(--border)] text-[var(--text-secondary)]"}`}
            title={id === "batch" ? "Adından (CronJob: ...-<sayı>-<5 karakter>) ya da durumundan (Completed / Error ...) tahmin edilir" : undefined}
          >
            {etiket}
          </button>
        ))}
        {gizli > 0 && (
          <span className="text-[var(--text-muted)]" data-testid="gizli-pod">
            · {gizli} pod gizli (arama / süzgeç)
            {search.trim() && (
              <button type="button" onClick={() => setSearch("")} className="ml-1 text-[var(--accent)] hover:underline">
                aramayı temizle
              </button>
            )}
          </span>
        )}
      </div>

      <div className="space-y-3 max-h-[70vh] overflow-y-auto">
        {Object.keys(grouped).length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] px-2 py-3 text-center">Aramayla eşleşen pod yok.</p>
        ) : Object.keys(grouped).sort().map((label) => (
          <div key={label}>
            <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
            <div className="mt-1 space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[label].map((p) => (
                <label
                  key={p.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(podKey(p.cluster, p.namespace, p.name))}
                    onChange={() => toggle(p.cluster, p.namespace, p.name)}
                    disabled={busy}
                    className="rounded"
                  />
                  <span className="flex-1 text-sm text-[var(--text-primary)] font-mono break-all whitespace-normal" title={p.name}>{p.name}</span>
                  {batchPodMu(p) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)]" title="Batch / job pod'u (adından ya da durumundan tahmin)">
                      batch
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.ready}</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      p.status === "Running"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : "bg-amber-50 text-amber-700 border-amber-100"
                    }`}
                  >
                    {p.status}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Çoklu thread dump — YALNIZ thread dump için anlamlı (heap dump'ta pod başına
          tek dosya üretilir). Sınırlar backend + playbook ile aynı. */}
      {isDelete && (
        <div className="space-y-2 border border-amber-200 bg-amber-50 rounded-xl p-3">
          <p className="text-xs text-amber-900">
            Seçilen pod'lar <b>silinir</b>; OpenShift her biri için yeni bir pod ayağa kaldırır. O sırada
            uygulama kısa süreli kesinti yaşayabilir. Deployment/rollout'a dokunulmaz. Yeni pod'un adını
            Dynatrace'ten, loglarını Kibana'dan takip edebilirsiniz. Sonuç e-posta ile de gelir.
          </p>
          {seciliBatch && (
            <p className="text-xs text-amber-900" data-testid="batch-uyari">
              <b>Batch / job pod'u seçtiniz:</b> bu pod'lar silindiğinde genelde <b>yeniden oluşturulmaz</b>
              {" "}— tamamlanmış ya da hatalı iş pod'u yalnız temizlenir. Çalışmakta olan bir Job pod'u silinirse
              Job kendi yeniden deneme ayarına (backoffLimit) göre yeni bir pod açabilir.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
            Yaptığım işlemin sonuçlarını kabul ediyorum.
          </label>
        </div>
      )}

      {!isDelete && dumpType === "threaddump" && (
        <div className="space-y-2 border border-[var(--border)] rounded-xl p-3">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Çoklu Thread Dump</p>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Adet:
              <input
                type="number"
                min={1}
                max={100}
                value={threadDumpCount}
                onChange={(e) => setThreadDumpCount(Number(e.target.value))}
                disabled={busy}
                className={`w-20 px-2 py-1 text-xs font-mono border rounded-lg outline-none focus:border-[var(--accent)] ${invalidCount ? "border-red-400" : "border-[var(--border)]"}`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Aralık (sn):
              <input
                type="number"
                min={0}
                max={3600}
                value={threadDumpInterval}
                onChange={(e) => setThreadDumpInterval(Number(e.target.value))}
                disabled={busy}
                className={`w-20 px-2 py-1 text-xs font-mono border rounded-lg outline-none focus:border-[var(--accent)] ${invalidInterval ? "border-red-400" : "border-[var(--border)]"}`}
              />
            </label>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Varsayılan tek dump. Örnek: 10 adet / 10 sn aralık → her pod için 10 saniye arayla 10 thread dump alınır.
            {threadDumpCount > 1 && threadDumpInterval > 0 && (
              <> Tahmini süre: ~{Math.round(((threadDumpCount - 1) * threadDumpInterval) / 60 * 10) / 10} dk.</>
            )}
          </p>
          {threadOptionsInvalid && (
            <p className="text-[11px] text-red-600">Adet 1-100, aralık 0-3600 saniye arasında olmalı.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{selected.size} pod seçildi</span>
        <button
          onClick={submit}
          disabled={!ready || busy || (isDelete && !consent)}
          className="btn-primary"
          title={isDelete && !consent ? "Önce onay kutusunu işaretleyin" : undefined}
        >
          {isDelete ? "Pod'ları Sil / Restart Et" : "Dump Al"}
        </button>
      </div>
    </div>
  );
};

export default OcpPodSelectStep;
