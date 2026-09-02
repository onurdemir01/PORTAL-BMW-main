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
import { useJobTracker } from "@/contexts/JobTrackerContext";
import { fmtRelative } from "@/utils/datetime";

interface Props {
  /** Bos birakilirsa kullanicinin gorebildigi TUM kapsamlar listelenir. */
  env?: string; tenant?: string;
  onRestore?: (item: ScaleXStoppedItem) => void;
  /** Degeri her degistiginde liste sessizce tazelenir (is bitiminde sayfa artirir). */
  reloadKey?: number;
}

// Bu esigi asan bir durdurma "unutulmus" olabilir. Sert bir kural degil, bir hatirlatma:
// kimse bir uygulamayi haftalarca kapali birakmayi planlamaz, ama olur.
const STALE_DAYS = 7;

// Ardisik hata siniri: sapma taramasi yoklamasi bir ucta kalici olarak patliyorsa
// sekme sonsuza dek istek atmasin (WorkloadStep ile AYNI kural).
const MAX_POLL_ERRORS = 3;

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

const StoppedPanel: React.FC<Props> = ({ env = "", tenant = "", onRestore, reloadKey = 0 }) => {
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
  const aliveRef = useRef(true);
  const { addJob } = useJobTracker();

  // `silent` OLMADAN her tazeleme paneli DOM'DAN KALDIRIYORDU: `loading` true olunca
  // asagidaki erken `return` tum govdeyi "yukleniyor…" ile degistiriyor. Sonuc, toplu
  // gerekce yazarken input'un REMOUNT olmasi ve kullanicinin IMLECI KAYBETMESI olurdu.
  // Bu yuzden `loading` yalnizca ILK yuklemede kullanilir; sonraki tazelemeler sessiz.
  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const r = await scalexApi.stopped(env, tenant);
      if (!aliveRef.current) return;
      if (r.ok) {
        setItems(r.items || []);
        setHiddenCount(r.hiddenCount || 0);
        setTruncated(r.truncated === true);
      } else setError(r.message || "Liste alınamadı.");
    } catch (e) { if (aliveRef.current) setError((e as Error).message); }
    finally { if (aliveRef.current && !opts.silent) setLoading(false); }
  }

  // Bilesen sokuldukten sonra `setState` yapmayalim: hem React uyarisi hem de
  // sokulmus bir panelin istegi bosa gider.
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Kapsam SECILMEDEN de yuklenir: panel ilk ekranda da gorunuyor.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [env, tenant]);

  // DIS TETIKLEYICI: bir ScaleX isi bitince sayfa bu sayaci artirir ve liste
  // KENDILIGINDEN tazelenir. Once yalnizca `env`/`tenant` degisiminde yukleniyordu,
  // yani bir geri alma bittiginde panel ESKI halini gostermeye devam ediyordu ve
  // kullanici ayni satira tekrar basabiliyordu.
  useEffect(() => {
    if (!reloadKey) return;
    load({ silent: true });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [reloadKey]);

  // SUREN ISLEM VARKEN yoklama. Yalnizca kilitli satir varken kosar; yoksa hic
  // istek atilmaz — degismesi beklenmeyen bir listeyi surekli yoklamak bosa trafik.
  // Aralik uzun (20 sn) cunku durumu degistiren sey `finalizeOperation` ve o da
  // "Islerim" yoklamasindan ya da uzlastiricidan geliyor.
  const hasRestoring = items.some((i) => i.phase === "restoring");
  useEffect(() => {
    if (!hasRestoring) return;
    const t = setInterval(() => { load({ silent: true }); }, 20_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hasRestoring, env, tenant]);

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
        let pollErrors = 0;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          // Panel sokulduyse dongu SUSMALI — yoksa her 3 saniyede bir bosa istek.
          if (!aliveRef.current) return;
          try {
            const st = await scalexApi.discoverStatus(launched.serverId, launched.jobId);
            pollErrors = 0;
            if (st.finished) break;
          } catch {
            // Gecici bir hata dongulu yoklamayi bitirmemeli, ama KALICI bir hata da
            // sonsuza dek istek attirmamali.
            if (++pollErrors >= MAX_POLL_ERRORS) break;
          }
        }
      }
      if (!aliveRef.current) return;
      await load({ silent: true });
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
      // ISLERIM'E KAYDET. Bu yol uzun sure `addJob` cagirmiyordu ve asagidaki
      // "sonuclar Islerim panelinde" cumlesi YANLIStI: isler o panelde hic
      // gorunmuyordu. Daha kotusu, `finalizeOperation` yalnizca uzlastiricidan
      // (120 sn) tetikleniyordu — ayna o kadar gecikmeyle guncelleniyor, panel de
      // "hala durdurulmus" gostermeye devam ediyordu.
      for (const j of r.launched || []) {
        addJob({
          title: `ScaleX geri alma — ${j.namespace} @ ${j.cluster}`,
          fetchStatus: async () => {
            const st = await scalexApi.runStatus(j.serverId, j.jobId);
            return { status: st.status, output: st.output, result: st.result };
          },
        });
      }

      const parts: string[] = [];
      if (r.launched?.length) parts.push(`${r.launched.length} iş başlatıldı`);
      if (r.pendingApproval?.length) parts.push(`${r.pendingApproval.length} grup için SMART onayı bekleniyor (onay gelince otomatik başlar)`);
      if (r.blocked?.length) parts.push(`${r.blocked.length} grup başlatılamadı: ${r.blocked.map((b) => `${b.namespace}@${b.cluster} — ${b.message}`).join(" · ")}`);
      setAuditNote(parts.length
        ? `${parts.join(" · ")} — sonuçlar “İşlerim” panelinde.`
        : "Geri alınacak kayıt bulunamadı.");
      // Liste, isler AWX'te HALA CALISIRKEN okunuyor: ayna ancak `finalizeOperation`
      // ile temizlenir. Bu cagri "islem surüyor" rozetini getirmek icin; listenin
      // gercekten kisalmasi is bitince `reloadKey` ile olur.
      await load({ silent: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false; setBulkBusy(false);
    }
  }

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
        {env && tenant
          ? "Bu ortam/tenant için portalda durdurulmuş uygulama kaydı yok."
          : "Portalda durdurulmuş uygulama kaydı yok."}
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
          {/* Toplu geri alma ucu kapsam ZORUNLU istiyor; kapsamsiz listede tek tek geri alinir. */}
          {env && tenant && items.some((i) => i.driftStatus === "in_sync" && i.phase !== "restoring") && (
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
            Cluster gerçeğiyle uyumlu <strong>{items.filter((i) => i.driftStatus === "in_sync" && i.phase !== "restoring").length}</strong> kayıt
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
                {/* KAPSAMSIZ listede satirlar farkli ortam/tenant'lardan gelir —
                    yalnizca cluster/namespace yazmak, hangi ORTAMDA oldugunu
                    gizlerdi ve prod ile test kaydi ayirt edilemezdi. */}
                {(() => {
                  const scopeText = env && tenant
                    ? `${it.clusterName}/${it.namespace}`
                    : `${it.env}/${it.tenant}/${it.clusterName}/${it.namespace}`;
                  return (
                    <span className="text-xs text-[var(--text-muted)] truncate" title={scopeText}>
                      {scopeText}
                    </span>
                  );
                })()}
                {!(env && tenant) && it.env === "prod" && (
                  <span className="pf-label pf-label--red">prod</span>
                )}
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
                {/* SUREN ISLEM: sunucu ayni hedefe ikinci bir geri almayi 409 ile
                    reddediyor (ayna kilidi). Butonu acik birakmak, kullaniciyi
                    reddedilecek bir istege gondermek olurdu. */}
                {it.phase === "restoring" && (
                  <span className="pf-label pf-label--blue">Geri alma sürüyor…</span>
                )}
                {it.driftStatus === "in_sync" && it.phase !== "restoring" && onRestore && (
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
