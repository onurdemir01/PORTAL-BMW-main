// src/components/logx_v2/steps/legacy/AppSearchStep.tsx — uygulama envanterine dayalı aranabilir
// uygulama seçimi. DB erişilemezse (fallbackMode) otomatik olarak son bilinen snapshot'a
// düşer ve kullanıcıya bunu açıkça bildirir (plan dosyası karar §2 — sayfa-geneli otomatik
// fallback).
import React, { useEffect, useState } from 'react';
import {
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { logxV2Api } from '@/api/logxV2Api';

const AppSearchStep: React.FC<{ onSelect: (app: string) => void; busy?: boolean }> = ({
  onSelect,
  busy,
}) => {
  const [search, setSearch] = useState('');
  const [apps, setApps] = useState<string[]>([]);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      logxV2Api
        .searchLegacyApps(search)
        .then((r) => {
          setApps(r.apps);
          setFallbackMode(r.fallbackMode);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // GONDERILECEK DEGER: envanterle ayni bicimde olmasi icin BUYUK HARF.
  const typed = search.trim().toUpperCase();
  // Listede zaten varsa serbest metin dugmesi CIKMAZ — kullanici ayni adi iki
  // farkli yoldan girip yinelenen kayit uretmesin.
  const exactExists = apps.some((a) => a.toUpperCase() === typed);
  const canAddFreeText = typed.length >= 2 && !loading && !exactExists;

  return (
    <div className="space-y-3">
      {fallbackMode && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Envanter veritabanına şu an erişilemiyor — son bilinen uygulama listesi (snapshot)
            gösteriliyor.
          </span>
        </div>
      )}
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Uygulama adı ara..."
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* LISTEDE OLMAYAN UYGULAMA — SERBEST METIN.
          Uygulama SADECE envanter listesinden secilebiliyordu; envantere henuz
          girmemis (ya da adi farkli kaydedilmis) bir uygulama icin kullanicinin
          hicbir yolu yoktu ve akis orada BITIYORDU.

          ONGORULUR: dugmenin uzerinde tam olarak NE gonderilecegi (BUYUK HARFE
          cevrilmis hali) yaziyor — kullanici yazdigini degil GONDERILECEGI goruyor.
          Ayrica listede zaten varsa dugme HIC cikmaz (yinelenen giris uretmesin). */}
      {canAddFreeText && (
        <button
          type="button"
          onClick={() => onSelect(typed)}
          disabled={busy}
          className="w-full flex items-start gap-2 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent-bg)] p-3 text-left disabled:opacity-50"
        >
          <PlusIcon
            aria-hidden="true"
            className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm text-[var(--text-primary)]">
              Listede yok — <span className="font-mono font-semibold">{typed}</span> adıyla devam et
            </span>
            <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
              Bu ad envanterde bulunamadı. Yazdığınız değer büyük harfe çevrilerek gönderilir;
              sonraki adımda sunucuyu da elle girebilirsiniz.
            </span>
            {/* NE OLACAGINI SOYLE. Kullanici elle yazdigi adin envantere KAYDEDILDIGINI
                sanabilir — hicbir yerde aksi yazmiyordu. Portal envanter tablosuna
                (MWAppsInventory, kurumsal DB) YAZMAZ; oraya duzenli tarama yazar. */}
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Bu değer <strong>envantere kaydedilmez</strong>. Envanter düzenli taramayla
              güncellenir; ad eklendiğinde listede kendiliğinden görünür.
            </span>
          </span>
        </button>
      )}

      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Aranıyor...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          apps.map((app) => (
            <button
              key={app}
              onClick={() => onSelect(app)}
              disabled={busy}
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors active:bg-[var(--bg-elevated)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {app}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default AppSearchStep;
