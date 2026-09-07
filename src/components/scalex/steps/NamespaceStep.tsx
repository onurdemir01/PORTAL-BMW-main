// src/components/scalex/steps/NamespaceStep.tsx — namespace seçimi (tek).
//
// Liste `ocp-catalog`tan gelir: dbo.Openshift_Inventory ∪ tarama önbelleği. Yetki
// kısıtıyla düşen namespace'ler GİZLENİR ama SAYISI söylenir — "neden göremiyorum?"
// sorusu cevapsız kalmasın.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { scalexApi, type ScaleXNamespaceList } from '@/api/scalexApi';

interface Props {
  env: string;
  tenant: string;
  clusters: string[];
  busy: boolean;
  initial?: string;
  onSubmit: (namespace: string) => void;
}

// Sistem namespace'leri listenin SONUNA — kullanıcı %99 kendi uygulamasını arıyor.
const SYSTEM_RE = /^(openshift|kube)(-|$)/;

const NamespaceStep: React.FC<Props> = ({ env, tenant, clusters, busy, initial, onSubmit }) => {
  const [data, setData] = useState<ScaleXNamespaceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(initial || '');

  // CANLI TARAMA DURUMU. Katalogda olmayan bir namespace'e ulasmanin tek yolu.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await scalexApi.namespaces(env, tenant, clusters);
      if (!aliveRef.current) return;
      if (r.ok) {
        setData(r);
        setError(null);
      } else setError(r.message || 'Namespace listesi alınamadı.');
    } catch (e) {
      if (aliveRef.current) setError((e as Error).message);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [env, tenant, clusters.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadList();
  }, [loadList]);

  // TARAMA. Sonuc PAYLASILAN onbellege yazilir (sunucu tarafinda, durum ucunda) —
  // yani bu tarama LogX'i de besler. Bitince liste yeniden okunur.
  async function runScan() {
    if (scanning || busy) return;
    setScanning(true);
    setScanNote(null);
    try {
      const launched = await scalexApi.discoverNamespaces(env, tenant, clusters);
      if (!launched.ok) throw new Error(launched.message || 'Tarama başlatılamadı.');
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!aliveRef.current) return;
        const st = await scalexApi.discoverNamespacesStatus(
          launched.serverId,
          launched.jobId,
          env,
          tenant,
        );
        if (!st.finished) continue;
        const okClusters = st.clusters.filter((c) => c.status === 'ok');
        const failed = st.clusters.filter((c) => c.status !== 'ok');
        // "HICBIRI TARANAMADI" ile "NAMESPACE YOK" AYNI EKRAN DEGILDIR.
        if (okClusters.length === 0) {
          setScanNote(
            failed.length
              ? `Hiçbir cluster taranamadı: ${failed.map((c) => c.cluster).join(', ')}. ` +
                  'Bu, namespace olmadığı anlamına GELMEZ.'
              : st.message || 'Tarama sonuç döndürmedi.',
          );
        } else {
          const total = okClusters.reduce((n, c) => n + c.count, 0);
          setScanNote(
            `${okClusters.length} cluster tarandı, ${total} namespace bulundu` +
              (failed.length ? ` · ${failed.length} cluster taranamadı` : '') +
              '. Liste yenilendi.',
          );
          await loadList();
        }
        return;
      }
    } catch (e) {
      if (aliveRef.current) setScanNote(`Tarama başarısız: ${(e as Error).message}`);
    } finally {
      if (aliveRef.current) setScanning(false);
    }
  }

  const list = useMemo(() => {
    const items = data?.items || [];
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((n) => n.toLowerCase().includes(q)) : items;
    return [...filtered].sort((a, b) => {
      const sa = SYSTEM_RE.test(a) ? 1 : 0;
      const sb = SYSTEM_RE.test(b) ? 1 : 0;
      return sa !== sb ? sa - sb : a.localeCompare(b, 'tr');
    });
  }, [data, query]);

  if (loading)
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)]">
        Namespace listesi yükleniyor…
      </div>
    );
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  // Liste BOS olmasa bile eksik olabilir: bir kaynak okunamadiysa oradaki
  // namespace'ler hic gelmemis olur ve kullanici aradigini bulamaz.
  const unreadable = data?.unreadableSources || [];

  return (
    <div className="space-y-4">
      {unreadable.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {unreadable.includes('inventory')
              ? 'Envanter tablosu okunamadı'
              : 'Tarama önbelleği okunamadı'}
            {' — liste eksik olabilir. Aradığın namespace görünmüyorsa yok demek değildir.'}
          </span>
        </div>
      )}
      <div className="relative">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          placeholder="Namespace ara…"
          aria-label="Namespace ara"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                     text-[var(--text-primary)] placeholder-[var(--text-muted)]
                     focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {/* TARAMA DUGMESI HER ZAMAN GORUNUR — yalnizca liste bosken degil.
          Envanter gecikmeli yazildigi icin liste DOLU olsa bile aranan namespace
          eksik olabilir; dugmeyi bos-durum blogunun icine koymak, tam o durumda
          kullaniciyi caresiz birakirdi. */}
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={runScan}
          disabled={busy || scanning}
          className="inline-flex items-center gap-1.5 text-[var(--accent)] hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <ArrowPathIcon
            aria-hidden="true"
            className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`}
          />
          {scanning ? 'Cluster’lar taranıyor…' : 'Listede yok mu? Cluster’ları tara'}
        </button>
        <span className="text-[var(--text-muted)]">
          Katalog gecikmeli yazılır; yeni açılmış bir namespace burada görünmeyebilir.
        </span>
      </div>

      {scanNote && (
        <p role="status" className="text-xs text-[var(--text-secondary)]">
          {scanNote}
        </p>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-80 overflow-y-auto">
        {list.map((ns) => {
          const count = data?.counts?.[ns];
          // UC DURUM, UC CUMLE. Ekran bu ayrimi yapmiyordu: `count` tanimsizken
          // "uygulama kaydi yok" yaziyordu — YANI SAYILMAMIS bir namespace icin
          // SIFIR IDDIA EDIYORDU. Kullanici bos sanip atlayabilirdi.
          //
          // Sunucu sozlesmesi bunu acikca soyluyor (ocp-catalog.cjs): "onbellekten
          // gelen namespace'ler icin sayi bilinmez — undefined kalir ve onyuz
          // 'bilinmiyor' gosterir; 0 ile karistirilmamalidir". LogX'in ayni ekrani
          // (NamespacePickerStep) bunu dogru yapiyordu, ScaleX yapmiyordu.
          const countLabel =
            typeof count === 'number'
              ? count === 0
                ? 'uygulama kaydı yok'
                : `${count} uygulama`
              : 'sayı bilinmiyor';
          const countTitle =
            typeof count === 'number'
              ? count === 0
                ? 'Envanterde bu namespace için uygulama kaydı yok — boş olabilir.'
                : 'Envanterdeki uygulama sayısı'
              : data?.sources?.[ns] === 'discovery'
                ? 'Bu namespace canlı taramadan geldi; envanterde kaydı yok, uygulamaları sayılmadı. Boş olduğu anlamına GELMEZ.'
                : 'Uygulama sayısı bu namespace için okunamadı — boş olduğu anlamına gelmez.';
          return (
            <label
              key={ns}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-inset)]"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <input
                  type="radio"
                  name="scalex-ns"
                  disabled={busy}
                  checked={picked === ns}
                  onChange={() => setPicked(ns)}
                />
                <span className="font-mono truncate text-[var(--text-primary)]" title={ns}>
                  {ns}
                </span>
              </span>
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                <span
                  className={typeof count === 'number' ? undefined : 'italic'}
                  title={countTitle}
                >
                  {countLabel}
                </span>
              </span>
            </label>
          );
        })}
        {list.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
            {/* "OKUNAMADI" ile "YOK" AYNI EKRAN DEGILDIR. Katalog iki kaynaktan
                okur ve biri patlarsa digeriyle devam eder; liste o zaman bos
                donebilir ama `ok: true` gelir. Eskiden ekran bu durumda
                "namespace bulunamadi" yaziyordu — kullanici dogru cluster'i
                sectigi halde yanlis sectigini sanip oradan ayrilabiliyordu. */}
            {query
              ? 'Aramanla eşleşen namespace yok.'
              : unreadable.length > 0
                ? 'Namespace kataloğu okunamadı — bu, cluster grubunun boş olduğu anlamına GELMEZ.'
                : 'Bu cluster grubunda namespace bulunamadı.'}
          </p>
        )}
      </div>

      {!!data?.hiddenCount && (
        <p className="text-xs text-[var(--text-muted)]">
          {data.hiddenCount} namespace yetki kısıtı nedeniyle listede görünmüyor.
        </p>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !picked}
          onClick={() => onSubmit(picked)}
        >
          Devam
        </button>
      </div>
    </div>
  );
};

export default NamespaceStep;
