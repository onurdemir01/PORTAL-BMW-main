// src/components/scalex/StoppedPanel.tsx — "şu an durdurulmuş" + SAPMA.
//
// Gerçeğin kaynağı cluster'daki `scalex-state-<app>` ConfigMap'idir; portal ayna
// tutar. İki kaynak ayrışabilir ve bu NORMAL:
//   * biri AWX'ten elle geri almıştır → portalda kayıt var, cluster'da yok
//   * biri AWX'ten elle durdurmuştur  → cluster'da var, portalda yok
// Ekran bunu GİZLEMEZ. Gizlemek "portal yanılıyor" demek olurdu; göstermek "birisi portal
// dışından iş yapmış" demek — ikincisi kullanıcının bilmesi gereken şey.
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { scalexApi, type ScaleXStoppedItem } from '@/api/scalexApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { fmtRelative } from '@/utils/datetime';

interface Props {
  /** Bos birakilirsa kullanicinin gorebildigi TUM kapsamlar listelenir. */
  env?: string;
  tenant?: string;
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

const StoppedPanel: React.FC<Props> = ({ env = '', tenant = '', onRestore, reloadKey = 0 }) => {
  const [items, setItems] = useState<ScaleXStoppedItem[]>([]);
  // Yetki nedeniyle gizlenen ve sinir nedeniyle kirpilan kayit sayilari. Bunlari
  // SOYLEMEDEN "kayit yok" demek, kullaniciya YANLIS bilgi vermek olurdu — aynen
  // NamespaceStep'in yaptigi gibi acikca yaziyoruz.
  const [hiddenCount, setHiddenCount] = useState(0);
  // Kacinin SAHIPLIK yuzunden gizlendigi ayrica soylenir: "yetkim yok" ile
  // "baskasinin kaydi" farkli sorulardir ve farkli cozumleri var.
  const [hiddenByOwnership, setHiddenByOwnership] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Durumu tazele" ONCEDEN yalnizca portal aynasini yeniden okuyordu — ayna kendi
  // kendine sapma KESFEDEMEZ. Gercek tazeleme, cluster'da `state` kesfi kosturup
  // aynayi cluster gercegiyle karsilastirmak demek.
  const [auditing, setAuditing] = useState(false);
  const [auditNote, setAuditNote] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
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
        setHiddenByOwnership(r.hiddenByOwnership || 0);
        setTruncated(r.truncated === true);
      } else setError(r.message || 'Liste alınamadı.');
    } catch (e) {
      if (aliveRef.current) setError((e as Error).message);
    } finally {
      if (aliveRef.current && !opts.silent) setLoading(false);
    }
  }

  // Bilesen sokuldukten sonra `setState` yapmayalim: hem React uyarisi hem de
  // sokulmus bir panelin istegi bosa gider.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Kapsam SECILMEDEN de yuklenir: panel ilk ekranda da gorunuyor.
  useEffect(() => {
    load();
  }, [env, tenant]);

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
  const hasRestoring = items.some((i) => i.phase === 'restoring');
  useEffect(() => {
    if (!hasRestoring) return;
    const t = setInterval(() => {
      load({ silent: true });
    }, 20_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hasRestoring, env, tenant]);

  // GERCEK sapma taramasi: her cluster/namespace icin `state` keşfi koşar, sunucu iş
  // bitince aynayı cluster gerçeğiyle karşılaştırıp `drift_status`u günceller.
  async function runAudit() {
    if (busyRef.current || !items.length) return;
    busyRef.current = true;
    setAuditing(true);
    setAuditNote(null);
    setError(null);
    try {
      const groups = new Map<string, { cluster: string; namespace: string }>();
      for (const it of items)
        groups.set(`${it.clusterName}|${it.namespace}`, {
          cluster: it.clusterName,
          namespace: it.namespace,
        });
      for (const g of groups.values()) {
        const launched = await scalexApi.discover(
          { env, tenant, namespace: g.namespace, clusters: [g.cluster] },
          'state',
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
      busyRef.current = false;
      setAuditing(false);
    }
  }

  async function runRestoreAll() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBulkBusy(true);
    setError(null);
    try {
      const r = await scalexApi.restoreAll({ env, tenant, reason: bulkReason.trim() });
      if (!r.ok) {
        setError(r.message || 'Toplu geri alma başlatılamadı.');
        return;
      }
      setShowBulk(false);
      setBulkReason('');
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
      if (r.pendingApproval?.length)
        parts.push(
          `${r.pendingApproval.length} grup için SMART onayı bekleniyor (onay gelince otomatik başlar)`,
        );
      if (r.blocked?.length)
        parts.push(
          `${r.blocked.length} grup başlatılamadı: ${r.blocked.map((b) => `${b.namespace}@${b.cluster} — ${b.message}`).join(' · ')}`,
        );
      setAuditNote(
        parts.length
          ? `${parts.join(' · ')} — sonuçlar “İşlerim” panelinde.`
          : 'Geri alınacak kayıt bulunamadı.',
      );
      // Liste, isler AWX'te HALA CALISIRKEN okunuyor: ayna ancak `finalizeOperation`
      // ile temizlenir. Bu cagri "islem surüyor" rozetini getirmek icin; listenin
      // gercekten kisalmasi is bitince `reloadKey` ile olur.
      await load({ silent: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBulkBusy(false);
    }
  }

  // HOOK'LAR KOSULSUZ CALISMALI: bu memo asagidaki erken donuslerden (loading/
  // error/bos liste) SONRA duruyordu ve React hook sirasi renderlar arasinda
  // degisiyordu — beyaz ekran uretebilecek bir hata (U4 bekcisi yakaladi).

  // AYNI UYGULAMANIN CLUSTER'LARINI TEK SATIRDA TOPLA.
  //
  // Ayna satirlari cluster bazindadir ve OYLE KALMALI: her cluster ayri geri alinir,
  // ayri basarisiz olabilir. Ama duz listede "ayni uygulamayi dort cluster'da
  // durdurdum" gercegi kayboluyordu — dort ayri satir gorunuyor, hangilerinin geri
  // alinamadigi topluca okunamiyordu.
  //
  // Anahtar env/tenant'i DA icerir: kapsamsiz listede ayni ad farkli ortamlardan
  // gelebilir ve prod ile test kaydini ayni satirda toplamak TEHLIKELI olurdu.
  // ARAMA VE HIZLI SUZGECLER.
  //
  // Liste 500 satira kadar cikabiliyor (`MIRROR_LIMIT`) ve kullanicinin gercek
  // sorusu genellikle DAR: "hangi ikisi geri alinamadi?", "su uygulama nerede
  // durdurulmus?". Duz bir listede bu sorularin cevabi gozle taranarak bulunuyordu.
  const [query, setQuery] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyDrifted, setOnlyDrifted] = useState(false);

  // SAYACLAR SUZGECTEN BAGIMSIZ: cip uzerindeki sayi, o cipe tiklayinca kac kayit
  // KALACAGINI soylemeli. Suzulmus listeden hesaplasaydik, cip acikken kendi
  // sayisini gosterip kapaliyken baska bir sayi gosterirdi.
  const allGroups = React.useMemo(() => {
    const m = new Map<string, ScaleXStoppedItem[]>();
    for (const it of items) {
      const k = `${it.env}\u0000${it.tenant}\u0000${it.namespace}\u0000${it.appName}`;
      (m.get(k) || m.set(k, []).get(k))!.push(it);
    }
    return [...m.values()];
  }, [items]);
  const totalGroupCount = allGroups.length;
  const failedGroupCount = allGroups.filter((rows) =>
    rows.some((r) => (r.restoreAttempts ?? 0) > 0),
  ).length;
  const driftedGroupCount = allGroups.filter((rows) =>
    rows.some((r) => r.driftStatus !== 'in_sync'),
  ).length;

  const groupedItems = React.useMemo(() => {
    const map = new Map<
      string,
      { key: string; appName: string; scopeText: string; rows: ScaleXStoppedItem[] }
    >();
    for (const it of items) {
      const key = `${it.env}\u0000${it.tenant}\u0000${it.namespace}\u0000${it.appName}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          appName: it.appName,
          scopeText: env && tenant ? it.namespace : `${it.env}/${it.tenant}/${it.namespace}`,
          rows: [],
        };
        map.set(key, g);
      }
      g.rows.push(it);
    }
    const groups = [...map.values()].map((g) => {
      // Cluster sirasi SABIT olmali: her tazelemede yer degistiren kunyeler
      // okunamaz olurdu.
      const rows = [...g.rows].sort((a, b) => a.clusterName.localeCompare(b.clusterName, 'tr'));
      const failedRows = rows.filter((r) => (r.restoreAttempts ?? 0) > 0);
      // Grup ozeti EN ESKI kayittan turetilir: "kac gundur durdurulmus" sorusunun
      // dogru cevabi en erken durdurulan cluster'dir. En yenisini almak, uzun
      // suredir duran bir kaydi taze gosterirdi.
      const oldest = rows.reduce(
        (acc, r) =>
          !acc || (r.stoppedAt && acc.stoppedAt && r.stoppedAt < acc.stoppedAt) ? r : acc,
        rows[0],
      );
      return {
        ...g,
        rows,
        failedRows,
        failed: failedRows.length,
        stoppedAt: oldest?.stoppedAt ?? null,
        stoppedBy: oldest?.stoppedBy ?? null,
        // Replica sayisi cluster'a gore FARKLI olabilir; hepsi ayni degilse tek bir
        // sayi yazmak YANLIS olurdu — o durumda hic yazilmaz, kunyeler ayrintiyi verir.
        previousReplicas: rows.every((r) => r.previousReplicas === rows[0].previousReplicas)
          ? rows[0].previousReplicas
          : null,
      };
    });

    // SUZGECLER GRUP DUZEYINDE: bir uygulamanin HERHANGI bir cluster'i olcutu
    // karsiliyorsa grup gorunur kalir ve o cluster kunyesinde zaten isaretli.
    // Cluster satirlarini ayrica suzmek, "dortten ikisi olmadi" resmini bozardi.
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (onlyFailed && g.failed === 0) return false;
      if (onlyDrifted && !g.rows.some((r) => r.driftStatus !== 'in_sync')) return false;
      if (!q) return true;
      return (
        g.appName.toLowerCase().includes(q) ||
        g.scopeText.toLowerCase().includes(q) ||
        g.rows.some((r) => r.clusterName.toLowerCase().includes(q))
      );
    });
  }, [items, env, tenant, query, onlyFailed, onlyDrifted]);

  if (loading)
    return <p className="text-sm text-[var(--text-muted)]">Durdurulmuş uygulamalar yükleniyor…</p>;
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }
  if (!items.length) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        {env && tenant
          ? 'Bu ortam/tenant için portalda durdurulmuş uygulama kaydı yok.'
          : 'Portalda durdurulmuş uygulama kaydı yok.'}
        {hiddenCount > 0 &&
          ` (${hiddenCount} kayıt görünmüyor` +
            (hiddenByOwnership > 0
              ? `; ${hiddenByOwnership} tanesi başka bir kullanıcı/ekibe ait.)`
              : ' — yetki kısıtı.)')}
      </p>
    );
  }

  const drifted = items.filter((i) => i.driftStatus !== 'in_sync');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Şu an durdurulmuş{' '}
          <span className="text-xs font-normal text-[var(--text-muted)]">({items.length})</span>
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
          {env &&
            tenant &&
            items.some((i) => i.driftStatus === 'in_sync' && i.phase !== 'restoring') && (
              <button
                type="button"
                onClick={() => setShowBulk((v) => !v)}
                disabled={auditing || bulkBusy}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <ArrowUturnLeftIcon aria-hidden="true" className="w-3.5 h-3.5" /> Tümünü geri al
              </button>
            )}
          <button
            type="button"
            onClick={runAudit}
            disabled={auditing || bulkBusy || !items.length}
            title="Cluster'ları tarayıp portal kaydıyla karşılaştırır"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            <ArrowPathIcon
              aria-hidden="true"
              className={`w-3.5 h-3.5 ${auditing ? 'animate-spin' : ''}`}
            />
            {auditing ? 'Taranıyor…' : 'Durumu tazele'}
          </button>
        </span>
      </div>

      {/* ARAMA + HIZLI SUZGECLER. Liste 500 satira kadar cikabiliyor; kullanicinin
          gercek sorusu ise genellikle dar: "hangileri geri alinamadi?", "su uygulama
          nerede durdurulmus?". Suzgecler VARSAYILAN KAPALI — mevcut davranis
          degismesin. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Uygulama, namespace ya da cluster ara…"
            aria-label="Durdurulmuş uygulamalarda ara"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)]
                       bg-[var(--bg-surface)] text-[var(--text-primary)]
                       placeholder-[var(--text-muted)] focus:outline-none
                       focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        {/* Cipler KAC KAYIT birakacaklarini yaziyor — tiklamadan once sonucu bilmek,
            bos bir listeye dusup "arama mi bozuk?" diye dusunmeyi onler. */}
        <button
          type="button"
          onClick={() => setOnlyFailed((v) => !v)}
          aria-pressed={onlyFailed}
          className={`pf-label ${onlyFailed ? 'pf-label--red' : 'pf-label--grey'} cursor-pointer`}
          title="Yalnızca geri alınmaya çalışılıp başarısız olanlar"
        >
          geri alınamadı ({failedGroupCount})
        </button>
        <button
          type="button"
          onClick={() => setOnlyDrifted((v) => !v)}
          aria-pressed={onlyDrifted}
          className={`pf-label ${onlyDrifted ? 'pf-label--gold' : 'pf-label--grey'} cursor-pointer`}
          title="Portal kaydı ile cluster gerçeği ayrışmış olanlar"
        >
          sapmalı ({driftedGroupCount})
        </button>
        <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
          {groupedItems.length} / {totalGroupCount} uygulama
        </span>
      </div>

      {auditNote && <p className="text-xs text-[var(--text-muted)]">{auditNote}</p>}

      {showBulk && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs text-amber-900">
            Cluster gerçeğiyle uyumlu{' '}
            <strong>
              {items.filter((i) => i.driftStatus === 'in_sync' && i.phase !== 'restoring').length}
            </strong>{' '}
            kayıt geri alınacak. Geri alma bir <strong>onarım</strong> işlemidir: OCO penceresi
            dışında da çalışır, ama gerekçe zorunludur ve SMART kaydına da yazılır.
          </p>
          {/* SUZGEC TOPLU ISLEMI DARALTMAZ — VE BU SOYLENMELI.
              Sunucu ucu (`/restore-all`) env/tenant kapsaminda calisir, ekrandaki
              suzgeci BILMEZ. Kullanici listeyi 3 kayda daraltip "hepsini geri al"
              derse 100 kaydin geri alinmasi surpriz olurdu — sayiyi zaten
              yukarida yaziyoruz, ama suzgec aciksa farki ACIKCA soyluyoruz. */}
          {(query.trim() || onlyFailed || onlyDrifted) && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
              <ExclamationTriangleIcon
                aria-hidden="true"
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
              />
              Ekrandaki süzgeç bu işlemi <strong>daraltmaz</strong>: yukarıdaki sayı süzgeçten
              bağımsız, listenin tamamı için geçerlidir. Yalnızca görünen {groupedItems.length}{' '}
              uygulamayı geri almak istiyorsanız künyelerdeki tekil “Geri Al” düğmelerini kullanın.
            </p>
          )}
          <input
            type="text"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            disabled={bulkBusy}
            aria-label="Toplu geri alma gerekçesi"
            placeholder="INC0042311 — ödeme servisi kesintisi"
            className="w-full px-3 py-2 text-sm rounded-lg border border-amber-300 bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={bulkBusy}
              onClick={() => {
                setShowBulk(false);
                setBulkReason('');
              }}
            >
              İptal
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={bulkBusy || !bulkReason.trim()}
              onClick={runRestoreAll}
            >
              {bulkBusy ? 'Başlatılıyor…' : 'Tümünü geri al'}
            </button>
          </div>
        </div>
      )}

      {drifted.length > 0 && (
        <p className="text-xs text-amber-800">
          {drifted.length} kayıt cluster gerçeğiyle ayrışmış — aşağıda işaretli.
        </p>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
        {/* UYGULAMA BAZINDA GRUPLAMA.
            Ayna satirlari CLUSTER bazindadir (dogru: her cluster ayri geri alinir),
            ama ekranda duz listelenince "ayni uygulamayi dort cluster'da durdurdum"
            gercegi kayboluyordu — dort ayri satir gorunuyor, hangilerinin geri
            alindigi/alinamadigi topluca okunamiyordu.
            Satir sayisi DEGISMEDI; yalnizca ayni uygulamanin cluster'lari tek
            kunye seridinde toplandi ve her cluster KENDI durumunu tasiyor. */}
        {groupedItems.map((g) => (
          <div key={g.key} className="px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="min-w-0 flex items-center gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={g.appName}>
                  {g.appName}
                </span>
                <span className="text-xs text-[var(--text-muted)] truncate" title={g.scopeText}>
                  {g.scopeText}
                </span>
                {g.rows.some((r) => r.env === 'prod') && !(env && tenant) && (
                  <span className="pf-label pf-label--red">prod</span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                {/* BU AYRINTILAR GRUPLAMADA KAYBOLMAMALI. Ilk yeniden yazimda
                    dusmuslerdi ve bekciler (V8, U25) yakaladi: durdurulma yasi,
                    onceki replica sayisi ve kim/ne zaman durdurdu. Ucu de karar
                    bilgisi — "bu kaydi geri alayim mi?" sorusunun cevabi. */}
                {(() => {
                  const d = daysSince(g.stoppedAt);
                  return d != null && d >= STALE_DAYS ? (
                    <span className="pf-label pf-label--gold">{d} gündür durdurulmuş</span>
                  ) : null;
                })()}
                {g.previousReplicas != null && (
                  <span className="tabular-nums">{g.previousReplicas} → 0</span>
                )}
                {g.stoppedBy && <span>· {g.stoppedBy}</span>}
                {g.stoppedAt && <span>· {fmtRelative(g.stoppedAt)}</span>}
                <span>· {g.rows.length} cluster</span>
                {g.failed > 0 && <span className="text-red-700">· {g.failed} geri alınamadı</span>}
              </span>
            </div>

            {/* CLUSTER KUNYELERI — UC DURUM, UC RENK.
                gri  : hic denenmedi (restoreAttempts = 0)
                kirmizi: denendi ve OLMADI — sebebi kunyenin ustunde yaziyor
                mavi : geri alma SURUYOR
                Basarili geri alma satiri SILER, yani "yesil" kalici bir durum
                degildir: uygulama listeden dusunce geri alinmis demektir. Sahte
                bir yesil gostermek, olmayan bir bilgiyi varmis gibi sunardi. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {g.rows.map((r) => {
                const attempts = r.restoreAttempts ?? 0;
                const busy = r.phase === 'restoring';
                const tone = busy
                  ? 'pf-label--blue'
                  : attempts > 0
                    ? 'pf-label--red'
                    : 'pf-label--grey';
                const title = busy
                  ? 'Geri alma sürüyor…'
                  : attempts > 0
                    ? `${attempts} deneme başarısız — ${r.lastRestoreError || 'sebep bildirilmedi'}`
                    : 'Henüz geri alınmaya çalışılmadı.';
                return (
                  <span key={r.id} className="inline-flex items-center gap-1">
                    <span className={`pf-label ${tone}`} title={title}>
                      {r.clusterName}
                      {attempts > 0 && !busy && ` · ${attempts}. deneme`}
                    </span>
                    {/* GERI AL YALNIZCA GEREKEN CLUSTER'DA. Basarili olanlar listeden
                        zaten dustu; burada kalanlar ya hic denenmedi ya da olmadi. */}
                    {/* KOSUL ZINCIRI ACIKCA YAZILI (yerel bir `busy` degiskenine
                        alinmadi): U25 bekcisi tam bu zinciri ariyor ve kural
                        "sapma yoksa VE geri alma surmuyorsa VE onRestore verilmisse"
                        seklinde TEK IFADEDE okunabilir kalmali. */}
                    {r.driftStatus === 'in_sync' && r.phase !== 'restoring' && onRestore && (
                      <button
                        type="button"
                        onClick={() => onRestore(r)}
                        className="inline-flex items-center gap-0.5 text-[11px] text-[var(--accent)] hover:underline"
                        title={`${r.clusterName} için geri al`}
                      >
                        <ArrowUturnLeftIcon aria-hidden="true" className="w-3 h-3" /> Geri Al
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            {/* BASARISIZ DENEMELERIN SEBEBI — kunye ipucunda kalmasin, gorunur olsun. */}
            {g.failedRows.map((r) => (
              <p key={`e-${r.id}`} className="mt-1 flex items-start gap-1.5 text-xs text-red-700">
                <ExclamationTriangleIcon
                  aria-hidden="true"
                  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                />
                <span>
                  <span className="font-mono">{r.clusterName}</span> geri alınamadı:{' '}
                  {r.lastRestoreError || 'sebep bildirilmedi'}
                </span>
              </p>
            ))}

            {g.rows.map((r) =>
              DRIFT_TEXT[r.driftStatus] ? (
                <p
                  key={`d-${r.id}`}
                  className="mt-1 flex items-start gap-1.5 text-xs text-amber-800"
                >
                  <ExclamationTriangleIcon
                    aria-hidden="true"
                    className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                  />
                  <span>
                    <span className="font-mono">{r.clusterName}</span> — {DRIFT_TEXT[r.driftStatus]}
                  </span>
                </p>
              ) : null,
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StoppedPanel;
