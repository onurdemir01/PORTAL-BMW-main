// src/components/scalex/StoppedPanel.tsx — "şu an durdurulmuş" + SAPMA.
//
// Gerçeğin kaynağı cluster'daki `scalex-state-<app>` ConfigMap'idir; portal ayna
// tutar. İki kaynak ayrışabilir ve bu NORMAL:
//   * biri AWX'ten elle geri almıştır → portalda kayıt var, cluster'da yok
//   * biri AWX'ten elle durdurmuştur  → cluster'da var, portalda yok
// Ekran bunu GİZLEMEZ. Gizlemek "portal yanılıyor" demek olurdu; göstermek "birisi portal
// dışından iş yapmış" demek — ikincisi kullanıcının bilmesi gereken şey.
import React, { useEffect, useRef, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXStoppedItem } from "@/api/scalexApi";
import { fmtRelative } from "@/utils/datetime";

interface Props {
  env: string; tenant: string;
  onRestore?: (item: ScaleXStoppedItem) => void;
}

// Bu esigi asan bir durdurma "unutulmus" olabilir. Sert bir kural degil, bir hatirlatma:
// kimse bir uygulamayi haftalarca kapali birakmayi planlamaz, ama olur.
const STALE_DAYS = 7;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const DRIFT_TEXT: Record<string, string> = {
  missing_on_cluster: "Portal kaydı var, cluster'da ConfigMap YOK — biri elle geri almış olabilir.",
  unknown_to_portal: "Cluster'da durdurulmuş ama portal kaydı yok — AWX'ten elle durdurulmuş.",
};

const StoppedPanel: React.FC<Props> = ({ env, tenant, onRestore }) => {
  const [items, setItems] = useState<ScaleXStoppedItem[]>([]);
  // Yetki nedeniyle gizlenen ve sinir nedeniyle kirpilan kayit sayilari. Bunlari
  // SOYLEMEDEN "kayit yok" demek, kullaniciya YANLIS bilgi vermek olurdu — aynen
  // NamespaceStep'in yaptigi gibi acikca yaziyoruz.
  const [hiddenCount, setHiddenCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Durumu tazele" ONCEDEN yalnizca portal aynasini yeniden okuyordu — ayna kendi
  // kendine sapma KESFEDEMEZ. Gercek tazeleme, cluster'da `state` kesfi kosturup
  // aynayi cluster gercegiyle karsilastirmak demek.
  const [auditing, setAuditing] = useState(false);
  const [auditNote, setAuditNote] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const busyRef = useRef(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await scalexApi.stopped(env, tenant);
      if (r.ok) {
        setItems(r.items || []);
        setHiddenCount(r.hiddenCount || 0);
        setTruncated(r.truncated === true);
      } else setError(r.message || "Liste alınamadı.");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  useEffect(() => { if (env && tenant) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [env, tenant]);

  // GERCEK sapma taramasi: her cluster/namespace icin `state` keşfi koşar, sunucu iş
  // bitince aynayı cluster gerçeğiyle karşılaştırıp `drift_status`u günceller.
  async function runAudit() {
    if (busyRef.current || !items.length) return;
    busyRef.current = true; setAuditing(true); setAuditNote(null); setError(null);
    try {
      const groups = new Map<string, { cluster: string; namespace: string }>();
      for (const it of items) groups.set(`${it.clusterName}|${it.namespace}`, { cluster: it.clusterName, namespace: it.namespace });
      for (const g of groups.values()) {
        const launched = await scalexApi.discover(
          { env, tenant, namespace: g.namespace, clusters: [g.cluster] }, "state"
        );
        if (!launched.ok) continue;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await scalexApi.discoverStatus(launched.serverId, launched.jobId);
          if (st.finished) break;
        }
      }
      await load();
      setAuditNote("Cluster'lar tarandı, sapma durumu güncellendi.");
    } catch (e) {
      setError(`Sapma taraması tamamlanamadı: ${(e as Error).message}`);
    } finally {
      busyRef.current = false; setAuditing(false);
    }
  }

  async function runRestoreAll() {
    if (busyRef.current) return;
    busyRef.current = true; setBulkBusy(true); setError(null);
    try {
      const r = await scalexApi.restoreAll({ env, tenant, reason: bulkReason.trim() });
      if (!r.ok) { setError(r.message || "Toplu geri alma başlatılamadı."); return; }
      setShowBulk(false); setBulkReason("");
      // UC AYRI SONUC, UC AYRI CUMLE. Prod'da toplu geri alma da SMART onayindan
      // geciyor: o gruplar icin AWX'te HENUZ IS YOK. Hepsini "baslatildi" diye
      // ozetlemek, kullaniciya calismayan bir isi calisiyor gostermek olurdu.
      const parts: string[] = [];
      if (r.launched?.length) parts.push(`${r.launched.length} iş başlatıldı`);
      if (r.pendingApproval?.length) parts.push(`${r.pendingApproval.length} grup için SMART onayı bekleniyor (onay gelince otomatik başlar)`);
      if (r.blocked?.length) parts.push(`${r.blocked.length} grup başlatılamadı: ${r.blocked.map((b) => `${b.namespace}@${b.cluster} — ${b.message}`).join(" · ")}`);
      setAuditNote(parts.length
        ? `${parts.join(" · ")} — sonuçlar “İşlerim” panelinde.`
        : "Geri alınacak kayıt bulunamadı.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false; setBulkBusy(false);
    }
  }

  if (!env || !tenant) return null;
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Durdurulmuş uygulamalar yükleniyor…</p>;
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }
  if (!items.length) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Bu ortam/tenant için portalda durdurulmuş uygulama kaydı yok.
        {hiddenCount > 0 && ` (${hiddenCount} kayıt yetki kısıtı nedeniyle görünmüyor.)`}
      </p>
    );
  }

  const drifted = items.filter((i) => i.driftStatus !== "in_sync");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Şu an durdurulmuş <span className="text-xs font-normal text-[var(--text-muted)]">({items.length})</span>
          {hiddenCount > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
              · {hiddenCount} kayıt yetki kısıtı nedeniyle görünmüyor
            </span>
          )}
          {truncated && (
            <span className="ml-2 text-xs font-normal text-amber-700">
              · liste kırpıldı, cluster seçerek daraltın
            </span>
          )}
        </p>
        <span className="flex items-center gap-3">
          {items.some((i) => i.driftStatus === "in_sync") && (
            <button type="button" onClick={() => setShowBulk((v) => !v)} disabled={auditing || bulkBusy}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
              <ArrowUturnLeftIcon aria-hidden="true" className="w-3.5 h-3.5" /> Tümünü geri al
            </button>
          )}
          <button type="button" onClick={runAudit} disabled={auditing || bulkBusy || !items.length}
            title="Cluster'ları tarayıp portal kaydıyla karşılaştırır"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline disabled:opacity-50">
            <ArrowPathIcon aria-hidden="true" className={`w-3.5 h-3.5 ${auditing ? "animate-spin" : ""}`} />
            {auditing ? "Taranıyor…" : "Durumu tazele"}
          </button>
        </span>
      </div>

      {auditNote && <p className="text-xs text-[var(--text-muted)]">{auditNote}</p>}

      {showBulk && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs text-amber-900">
            Cluster gerçeğiyle uyumlu <strong>{items.filter((i) => i.driftStatus === "in_sync").length}</strong> kayıt
            geri alınacak. Geri alma bir <strong>onarım</strong> işlemidir: OCO penceresi dışında da çalışır,
            ama gerekçe zorunludur ve SMART kaydına da yazılır.
          </p>
          <input type="text" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}
            disabled={bulkBusy} aria-label="Toplu geri alma gerekçesi"
            placeholder="INC0042311 — ödeme servisi kesintisi"
            className="w-full px-3 py-2 text-sm rounded-lg border border-amber-300 bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={bulkBusy}
              onClick={() => { setShowBulk(false); setBulkReason(""); }}>İptal</button>
            <button type="button" className="btn-primary" disabled={bulkBusy || !bulkReason.trim()}
              onClick={runRestoreAll}>{bulkBusy ? "Başlatılıyor…" : "Tümünü geri al"}</button>
          </div>
        </div>
      )}

      {drifted.length > 0 && (
        <p className="text-xs text-amber-800">
          {drifted.length} kayıt cluster gerçeğiyle ayrışmış — aşağıda işaretli.
        </p>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
        {items.map((it) => (
          <div key={it.id} className="px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="min-w-0 flex items-center gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={it.appName}>{it.appName}</span>
                {/* `title` KESILEN OGENIN KENDISINDE (bkz. D7 bekcisi). */}
                <span className="text-xs text-[var(--text-muted)] truncate"
                  title={`${it.clusterName}/${it.namespace}`}>{it.clusterName}/{it.namespace}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                {(() => {
                  const d = daysSince(it.stoppedAt);
                  return d != null && d >= STALE_DAYS
                    ? <span className="pf-label pf-label--gold">{d} gündür durdurulmuş</span>
                    : null;
                })()}
                {it.previousReplicas != null && <span className="tabular-nums">{it.previousReplicas} → 0</span>}
                {it.stoppedBy && <span>· {it.stoppedBy}</span>}
                {it.stoppedAt && <span>· {fmtRelative(it.stoppedAt)}</span>}
                {it.driftStatus === "in_sync" && onRestore && (
                  <button type="button" onClick={() => onRestore(it)}
                    className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                    <ArrowUturnLeftIcon aria-hidden="true" className="w-3.5 h-3.5" /> Geri Al
                  </button>
                )}
              </span>
            </div>
            {DRIFT_TEXT[it.driftStatus] && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
                <ExclamationTriangleIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {DRIFT_TEXT[it.driftStatus]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StoppedPanel;
