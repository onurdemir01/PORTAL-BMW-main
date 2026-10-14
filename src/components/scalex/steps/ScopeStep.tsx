// src/components/scalex/steps/ScopeStep.tsx — ortam → tenant → cluster (çoklu seçim).
//
// LogX'in ClusterSelectStep deseni: env çipleri → tenant çipleri → cluster checkbox'ları.
// Fark: burada seçim ÇOKLU ve seçim değiştikçe "kaç hedef" sayacı canlı güncelleniyor —
// kullanıcı bir sonraki adıma geçmeden kapsamı görüyor.
import React, { useEffect, useMemo, useState } from 'react';
import { ExclamationTriangleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { scalexApi, type ScaleXClusterTree, type ScaleXGateSummary } from '@/api/scalexApi';
import { isProdEnv } from '@/utils/env';
import LoadError from '@/components/common/LoadError';
import { degisiklikKurali } from '../kapiMetni';

interface Props {
  busy: boolean;
  initial?: { env: string; tenant: string; clusters: string[] };
  onSubmit: (v: { env: string; tenant: string; clusters: string[] }) => void;
}

const chip = (active: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
    active
      ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--accent)]'
      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--border-strong)]'
  }`;

const ScopeStep: React.FC<Props> = ({ busy, initial, onSubmit }) => {
  const [tree, setTree] = useState<ScaleXClusterTree>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState(initial?.env || '');
  const [tenant, setTenant] = useState(initial?.tenant || '');
  const [selected, setSelected] = useState<string[]>(initial?.clusters || []);

  // `deneme` artinca liste yeniden cekilir ("Tekrar dene"). Eskiden hata kutusunda cikis
  // yoktu: gecici bir hatadan sonra tek yol sayfayi yenilemekti.
  const [deneme, setDeneme] = useState(0);
  useEffect(() => {
    let alive = true;
    scalexApi
      .clusters()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setTree(r.tree || {});
        else setError(r.message || 'Cluster listesi alınamadı.');
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [deneme]);
  const tekrarDene = () => {
    setError(null);
    setLoading(true);
    setDeneme((n) => n + 1);
  };

  const envs = useMemo(() => Object.keys(tree).sort(), [tree]);
  const tenants = useMemo(() => (env ? Object.keys(tree[env] || {}).sort() : []), [tree, env]);
  const clusters = useMemo(
    () => (env && tenant ? [...(tree[env]?.[tenant] || [])].sort() : []),
    [tree, env, tenant],
  );

  // PROD ayrı bir görsel ağırlık taşır — kullanıcı hangi ortamda olduğunu kaza eseri
  // öğrenmemeli. Ama seçimi ENGELLEMEZ; yalnızca görünür kılar.
  //
  // TANIM ORTAK MODÜLDEN: aynı soru artık her adımdaki künyede de soruluyor. İkinci
  // bir kopya, birinin değişip diğerinin sessizce eskimesi demekti.
  const isProd = isProdEnv(env);

  // ONAY KURALI SUNUCUDAN (2026-10-14). Uyarı eskiden SABİTTİ ("OCO kontrol edilecek,
  // SMART kaydı açılacak, ikinci kişi onayı istenir"): admin "yalnız OCO" dese de aynı
  // cümle yazıyordu ve "ikinci kişi onayı" sunucuda hiç yoktu. Artık `/preview` ile AYNI
  // çözücünün kararı okunur; seçim değiştikçe (istisna kuralı tenant / cluster sayısına
  // bakabilir) kısa bir gecikmeyle tazelenir, geç dönen eski yanıt atılır.
  const [kural, setKural] = useState<{ env: string; ozet: ScaleXGateSummary | null } | null>(null);
  useEffect(() => {
    if (!env) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => scalexApi.gateSummary(env, tenant, selected))
        .then((ozet) => alive && setKural({ env, ozet }))
        .catch(() => alive && setKural({ env, ozet: null }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [env, tenant, selected]);
  const kuralBu = kural && kural.env === env ? kural : null;
  const kuralMetni = kuralBu?.ozet
    ? degisiklikKurali(kuralBu.ozet.change, { secimeBagli: kuralBu.ozet.secimeBagliKural })
    : null;

  if (loading)
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)]">
        Cluster listesi yükleniyor…
      </div>
    );
  if (error) {
    // NEYIN okunamadigi soylenir: ScaleX acilisinda uc ayri istek gider ve ucu de dustugunde
    // ekranda birbirinden ayirt edilemeyen uc "Sunucu hatasi" kutusu duruyordu.
    return (
      <LoadError
        compact
        title="Cluster listesi okunamadı"
        message={error}
        onRetry={tekrarDene}
        testId="scalex-cluster-hatasi"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Ortam</p>
        <div className="flex flex-wrap gap-2">
          {envs.map((e) => (
            // Secim yalnizca renkle anlatiliyordu; ekran okuyucu hangi ortamin secili
            // oldugunu anlayamiyordu (bkz. OperationStep'teki ayni duzeltme).
            <button
              key={e}
              type="button"
              disabled={busy}
              className={chip(env === e)}
              aria-pressed={env === e}
              onClick={() => {
                setEnv(e);
                setTenant('');
                setSelected([]);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {env && (
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Tenant / İş Birimi</p>
          <div className="flex flex-wrap gap-2">
            {tenants.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                className={chip(tenant === t)}
                aria-pressed={tenant === t}
                onClick={() => {
                  setTenant(t);
                  setSelected([]);
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {env && tenant && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              Cluster ({clusters.length})
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(clusters)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Tümünü seç
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected([])}
                className="text-xs text-[var(--text-muted)] hover:underline"
              >
                Temizle
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-72 overflow-y-auto">
            {clusters.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-inset)]"
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(c)}
                  onChange={(ev) =>
                    setSelected((prev) =>
                      ev.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                    )
                  }
                />
                <span className="font-mono text-[var(--text-primary)]">{c}</span>
              </label>
            ))}
            {clusters.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                Bu grupta aktif cluster yok.
              </p>
            )}
          </div>
        </div>
      )}

      {selected.length > 0 && kuralMetni && (
        <div
          data-testid="scalex-kapsam-kurali"
          role={kuralMetni.ton === 'engel' ? 'alert' : undefined}
          className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
            kuralMetni.ton === 'engel'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{isProd ? 'Prod ortamı.' : `${env} ortamı.`}</strong> Gerçek bir değişiklik
            uygularsan: {kuralMetni.satirlar.join(' ')}
          </span>
        </div>
      )}
      {/* KURAL OKUNAMADIYSA VAAT YOK: yalnız prod vurgusu ve nerede görüleceği. */}
      {selected.length > 0 && isProd && kuralBu && !kuralBu.ozet && (
        <div
          data-testid="scalex-kapsam-kurali"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Prod ortamı.</strong> Onay kuralları şu an okunamadı; geçerli kural
            önizleme adımında gösterilir.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <ServerStackIcon aria-hidden="true" className="w-4 h-4" />
          {selected.length} cluster seçildi
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !selected.length}
          onClick={() => onSubmit({ env, tenant, clusters: selected })}
        >
          Devam
        </button>
      </div>
    </div>
  );
};

export default ScopeStep;
