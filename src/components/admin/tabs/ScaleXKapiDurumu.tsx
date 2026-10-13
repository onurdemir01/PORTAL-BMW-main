// src/components/admin/tabs/ScaleXKapiDurumu.tsx — ScaleX onay kapılarının DURUM KARTI.
//
// NEDEN VAR (2026-10-13 üretim olayı). Prod'da doğru OCO numarası giren kullanıcılar
// "SMART yapılandırılmamış" reddi aldı. Ayar aylardır eksikti ama hiçbir ekran bunu
// söylemiyordu: admin sekmesinde yalnızca bir "düzenle" düğmesi ve genel bir açıklama vardı.
// "SMART gerekli mi, tanımlı mı, eksik olan ne, kullanıcı bugün ne görür" sorularının
// cevabı ancak bir kullanıcı hata aldığında öğreniliyordu.
//
// Bu kart o dört soruyu SUNUCUDAN okur (`GET /api/scalex/admin/gate-status`) ve SMART
// kuralı anahtarını taşır. Anahtar tek tıkla değişir, restart istemez ve önceki/yeni
// değerle denetime yazılır (`scalex_smart_mode_changed`); "yalnız OCO" kipinde başlayan
// her prod işlemi ayrıca `scalex_smart_gate_disabled` olarak izlenir.
import React, { useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { scalexApi, type ScaleXGateStatus } from '@/api/scalexApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';

interface Props {
  /** Dışarıdan tazeleme jetonu: SMART / OCO ayar penceresi kapanınca artar. */
  reloadKey?: number;
  /** Şablondaki `scalex.*` değişkenleri öğrenildiğinde üst bileşene verilir (ayar penceresi için). */
  onOrnekBaglam?: (b: Record<string, string | number>) => void;
}

const KIP_METNI: Record<ScaleXGateStatus['smartMode'], { baslik: string; aciklama: string }> = {
  required: {
    baslik: 'Gerekli',
    aciklama: 'Prod değişiklikleri SMART onayı bekler. SMART tanımlı değilse değişiklik başlamaz.',
  },
  oco_only: {
    baslik: 'Gerekli değil — yalnız OCO',
    aciklama: 'SMART kaydı açılmaz; yalnızca OCO penceresi denetlenir. Her işlem denetime yazılır.',
  },
};

/** Sıradan bir kullanıcının bugün prod'da alacağı karar — tek cümle. */
function kullaniciKarari(d: ScaleXGateStatus): { ton: 'ok' | 'uyari' | 'engel'; metin: string } {
  if (d.configError) return { ton: 'engel', metin: `ScaleX şablonu çözülemiyor: ${d.configError}` };
  const s = d.policy.smartStatus;
  const oco =
    d.policy.oco === 'require'
      ? 'OCO numarası istenir'
      : d.policy.ocoGateDisabled
        ? 'OCO kapısı KAPALI'
        : 'OCO istenmez';
  if (s === 'not_configured') {
    return {
      ton: 'engel',
      metin:
        'Prod değişiklikleri BAŞLAMIYOR: SMART gerekli ama ScaleX için tanımlı değil. Ön kontrol (değişiklik yapmayan çalışma) kullanılabilir.',
    };
  }
  if (s === 'disabled_by_admin') {
    return { ton: 'uyari', metin: `Prod değişiklikleri SMART onayı OLMADAN başlar; ${oco}.` };
  }
  return {
    ton: 'ok',
    metin: `Prod değişikliklerinde ${oco}, ardından SMART kaydı açılır ve onay beklenir.`,
  };
}

const TON: Record<'ok' | 'uyari' | 'engel', string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  uyari: 'border-amber-200 bg-amber-50 text-amber-900',
  engel: 'border-red-200 bg-red-50 text-red-800',
};

const ScaleXKapiDurumu: React.FC<Props> = ({ reloadKey = 0, onOrnekBaglam }) => {
  const [durum, setDurum] = useState<ScaleXGateStatus | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kayitHatasi, setKayitHatasi] = useState<string | null>(null);

  async function yukle() {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await scalexApi.gateStatus();
      if (!r.ok) {
        setHata(r.message || 'Onay kapılarının durumu okunamadı.');
        return;
      }
      setDurum(r);
      onOrnekBaglam?.(r.ornekBaglam || {});
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }
  useAsyncEffect(
    async (alive) => {
      if (alive()) await yukle();
    },
    [reloadKey],
  );

  async function kipSec(kip: ScaleXGateStatus['smartMode']) {
    if (!durum || kaydediliyor || kip === durum.smartMode) return;
    setKaydediliyor(true);
    setKayitHatasi(null);
    try {
      const r = await scalexApi.setSmartMode(kip);
      if (!r.ok) {
        setKayitHatasi(r.message || 'Ayar kaydedilemedi.');
        return;
      }
      await yukle();
    } catch (e) {
      setKayitHatasi((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  }

  if (yukleniyor && !durum) return <LoadingLogo compact />;
  // "Okunamadı" ile "tanımlı değil" AYRI: okunamayan durumu "eksik" diye göstermek, admin'i
  // olmayan bir sorunu düzeltmeye gönderirdi.
  if (hata && !durum) {
    return (
      <LoadError compact title="Onay kapılarının durumu okunamadı" message={hata} onRetry={yukle} />
    );
  }
  if (!durum) return null;

  const karar = kullaniciKarari(durum);
  const smartGerekli = durum.smartMode === 'required';
  const parcalar: { ad: string; tamam: boolean; not?: string }[] = [
    { ad: 'SMART onayı ScaleX şablonu için açık', tamam: durum.smart.enabled },
    { ad: 'Flow Key', tamam: !!durum.smart.flowKey, not: durum.smart.flowKey || undefined },
    { ad: 'Alan eşlemesi (metadata)', tamam: durum.smart.hasMetadata },
    {
      ad: 'SMART bağlantı ayarları (Admin > Sistem)',
      tamam: !durum.smart.missing.some((m) => m.startsWith('SMART bağlantı')),
    },
  ];

  return (
    <div className="space-y-3" data-testid="scalex-kapi-durumu">
      {/* SIRADAN KULLANICININ BUGÜN GÖRDÜĞÜ — kartın en üstünde, tek cümle. */}
      <div
        role="status"
        data-testid="scalex-kullanici-karari"
        className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${TON[karar.ton]}`}
      >
        {karar.ton === 'ok' ? (
          <CheckCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <span>
          <strong>Kullanıcılar bugün:</strong> {karar.metin}
        </span>
      </div>

      {/* SMART KURALI ANAHTARI */}
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Prod'da SMART onayı</p>
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Prod'da SMART onayı">
          {(Object.keys(KIP_METNI) as ScaleXGateStatus['smartMode'][]).map((kip) => {
            const secili = durum.smartMode === kip;
            return (
              <button
                key={kip}
                type="button"
                aria-pressed={secili}
                disabled={kaydediliyor}
                onClick={() => kipSec(kip)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  secili
                    ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                } ${kaydediliyor ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="block text-sm font-semibold text-[var(--text-primary)]">
                  {KIP_METNI[kip].baslik}
                </span>
                <span className="block mt-1 text-xs text-[var(--text-muted)]">
                  {KIP_METNI[kip].aciklama}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">
          Değişiklik hemen geçerli olur (yeniden başlatma gerekmez) ve denetime yazılır.
          {durum.smartModeSource === 'default' && ' Şu an hiç ayarlanmamış: varsayılan “Gerekli”.'}
        </p>
        {durum.smartModeProblem && (
          <p role="alert" className="mt-1 text-xs text-amber-800">
            {durum.smartModeProblem}
          </p>
        )}
        {kayitHatasi && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {kayitHatasi}
          </p>
        )}
      </div>

      {/* SMART TANIMI — kural "gerekli değil" iken de gösterilir: anahtar geri açıldığında
          neyin eksik olduğu önceden bilinsin. */}
      <div className="rounded-lg bg-[var(--bg-inset)] p-3 space-y-1.5">
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          SMART tanımı {smartGerekli ? '' : '(şu an kullanılmıyor)'}
        </p>
        <ul className="space-y-1">
          {parcalar.map((p) => (
            <li key={p.ad} className="flex items-start gap-1.5 text-xs">
              {p.tamam ? (
                <CheckCircleIcon
                  aria-hidden="true"
                  className="w-4 h-4 flex-shrink-0 text-emerald-600"
                />
              ) : (
                <XCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 text-red-600" />
              )}
              <span className={p.tamam ? 'text-[var(--text-secondary)]' : 'text-red-800'}>
                {p.ad}
                {p.tamam ? '' : ' — eksik'}
                {p.not && (
                  <span className="ml-1.5 font-mono text-[var(--text-muted)]">{p.not}</span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {durum.smart.onizlemeHatasi && (
          <p role="alert" className="text-xs text-red-800">
            Alan eşlemesi render edilemiyor: {durum.smart.onizlemeHatasi} — bu hâliyle SMART kaydı
            açılamaz.
          </p>
        )}
        {durum.smart.onizleme && (
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              SMART'a gidecek alanlar (örnek bir durdurma işlemiyle):
            </p>
            <dl className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
              {Object.entries(durum.smart.onizleme).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2 px-2 py-1 text-xs">
                  <dt className="font-mono flex-shrink-0 text-[var(--text-secondary)]">{k}</dt>
                  <dd className="min-w-0 truncate text-[var(--text-muted)]" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {(durum.smart.skipRules.length > 0 || durum.smart.skipRulesInvalid.length > 0) && (
          <div className="text-xs">
            <p className="text-[var(--text-secondary)]">
              <strong>İstisna kuralları</strong> — eşleşen işlem SMART kaydı açmadan başlar
              (denetime yazılır):
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {durum.smart.skipRules.map((r) => (
                <li key={r.field} className="font-mono text-[var(--text-muted)]">
                  {r.field}: {r.values.join(', ')}
                </li>
              ))}
            </ul>
            {durum.smart.skipRulesInvalid.length > 0 && (
              <p role="alert" className="mt-0.5 text-amber-800">
                Okunamayan kural satırı (yok sayılıyor):{' '}
                <span className="font-mono">{durum.smart.skipRulesInvalid.join(' | ')}</span>
              </p>
            )}
            <p className="mt-0.5 text-[var(--text-muted)]">
              ScaleX'te eşleşebilen alanlar: <span className="font-mono">action</span> (stop /
              restore / scale), <span className="font-mono">namespace</span>,{' '}
              <span className="font-mono">tenant</span>, <span className="font-mono">env</span>,{' '}
              <span className="font-mono">cluster_count</span>.
            </p>
          </div>
        )}
      </div>

      {durum.policy.ocoGateDisabled && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-800">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>OCO kapısı prod'da KAPALI.</strong> Değişiklik kaydı sorulmuyor; her işlem
            denetime <span className="font-mono">scalex_oco_gate_disabled</span> olarak yazılıyor.
          </span>
        </p>
      )}

      {durum.adminSkipSelf && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
          <InformationCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Kişisel tercihiniz gereği <strong>sizin</strong> başlattığınız prod işlemlerinde SMART
            onayı atlanır (OCO yine sorulur, işlem denetime yazılır). Yukarıdaki durum diğer
            kullanıcılar içindir.
          </span>
        </p>
      )}
    </div>
  );
};

export default ScaleXKapiDurumu;
