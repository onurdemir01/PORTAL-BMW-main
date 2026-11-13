// src/components/app_hub/AppHubPage.tsx — Application Hub (2026-11-08).
//
// Kullanıcı: "Bağlanan kişi sadece uygulamasının ismini yazıp bu uygulamaya dair her şey
// gözüksün. JBoss ise hangi versiyonlarda, hangi sunucularda, hangi JVM parametreleriyle
// koştuğu, ne kadar yük aldığı, Apache sunucularının isimleri, sunucuda ne kadar kapasite
// olduğu; OpenShift ise namespace, cluster, replika, Deployment mı Argo Rollout mu, JVM
// parametreleri, node'lar, root adres. Buradan OpsX'e, LogX'e uygulaması girili gitsin."
//
// Adres: /application-hub?tip=jboss|was|ocp&ad=<ad> (Dashboard araması buraya getirir).
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowPathIcon, Squares2X2Icon, WrenchScrewdriverIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';
import { appHubApi, type AppAramaSonucu, type AppDetay, type AppTip, type OcpDetay } from '@/api/appHubApi';
import LoadError from '@/components/common/LoadError';
import Button from '@/components/common/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtRelative, fmtDateTime } from '@/utils/datetime';
import { TipHap } from './ortak';
import AramaKutusu from './AramaKutusu';
import JbossGorunum from './JbossGorunum';
import WasGorunum from './WasGorunum';
import OcpGorunum from './OcpGorunum';
import { CreateModal as RetirementKayitPenceresi } from '@/components/server_hub/RetirementTab';
import { retirementApi } from '@/api/retirementApi';

const TIPLER: AppTip[] = ['jboss', 'was', 'ocp'];

/** OpsX / LogX'e uygulaması seçili gidiş adresleri (sözleşme: OpsX ve LogX sayfaları bu parametreleri okur). */
function derinLinkler(d: AppDetay, ocpHedef: number) {
  const q = (o: Record<string, string | null | undefined>) =>
    Object.entries(o)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
  if (d.tip === 'jboss') return { opsx: `/opsx?${q({ platform: 'jboss', app: d.varyantlar.length === 1 ? d.varyantlar[0] : d.ad })}`, logx: `/logx?${q({ platform: 'legacy', app: d.varyantlar.length === 1 ? d.varyantlar[0] : d.ad })}` };
  if (d.tip === 'was') return { opsx: `/opsx?${q({ platform: 'was', app: d.ad })}`, logx: null };
  const y = (d as OcpDetay).yerler.filter((x) => x.katalogda)[ocpHedef];
  if (!y) return { opsx: null, logx: null };
  const ortak = { app: d.ad, env: y.ortam, tenant: y.tenant, namespace: y.namespace, cluster: y.cluster };
  return { opsx: `/opsx?${q({ platform: 'ocp', ...ortak })}`, logx: `/logx?${q({ platform: 'openshift', ...ortak })}` };
}

export default function AppHubPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { canViewPage, user } = useAuth();
  // RETIREMENT (kullanici, 2026-11-13): "Application Hub'da uygulama sayfasina 'uygulamami retire et' butonu;
  // bu ekrandan retirement talebi baslatilsin. Simdilik SADECE Admin." Sunucu (/api/retirement) zaten yalniz
  // Admin'e acik. Retirement motoru JBoss hedefleriyle calisir (sunucu + uygulama + surum): buton yalniz JBoss'ta.
  const isAdmin = user?.role === 'Admin';
  const [retire, setRetire] = useState<{ gun: number } | null>(null);
  const [retireYukleniyor, setRetireYukleniyor] = useState(false);
  const [acilanKayit, setAcilanKayit] = useState<number | null>(null);
  const retireAc = async () => {
    setRetireYukleniyor(true);
    try {
      const c = await retirementApi.config();
      setRetire({ gun: c && c.ok && Number(c.defaultDays) > 0 ? Number(c.defaultDays) : 45 });
    } catch {
      setRetire({ gun: 45 });
    } finally {
      setRetireYukleniyor(false);
    }
  };
  const tipP = params.get('tip') as AppTip | null;
  const tip = tipP && TIPLER.includes(tipP) ? tipP : null;
  const ad = (params.get('ad') || '').trim();

  const [detay, setDetay] = useState<AppDetay | null>(null);
  const [okundu, setOkundu] = useState<string | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yenileNo, setYenileNo] = useState(0);
  const [ocpHedef, setOcpHedef] = useState(0);
  const tazeIste = useRef(false);

  useAsyncEffect(
    async (alive) => {
      if (!tip || !ad) {
        setDetay(null);
        setHata('');
        return;
      }
      setYukleniyor(true);
      setHata('');
      const fresh = tazeIste.current;
      tazeIste.current = false;
      try {
        const r = await appHubApi.detay(tip, ad, fresh);
        if (!alive()) return;
        setDetay(r.uygulama);
        setOkundu(r.okundu);
        setOcpHedef(0);
      } catch (e) {
        if (!alive()) return;
        setDetay(null);
        setHata((e as Error).message);
      } finally {
        if (alive()) setYukleniyor(false);
      }
    },
    [tip, ad, yenileNo],
  );

  const sec = (s: AppAramaSonucu) => setParams({ tip: s.tip, ad: s.ad });
  const yenile = () => {
    tazeIste.current = true;
    setYenileNo((n) => n + 1);
  };

  const linkler = useMemo(() => (detay ? derinLinkler(detay, ocpHedef) : null), [detay, ocpHedef]);
  const ocpYerleri = detay && detay.tip === 'ocp' ? detay.yerler.filter((y) => y.katalogda) : [];

  if (!tip || !ad) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
            <Squares2X2Icon className="w-9 h-9" style={{ color: 'var(--ah-hue)' }} />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 500 }}>
              Application <span style={{ color: 'var(--ah-hue)' }}>Hub</span>
            </h1>
          </div>
          <p className="max-w-xl text-[14px]" style={{ color: 'var(--text-muted)', textWrap: 'balance' as React.CSSProperties['textWrap'] }}>
            Uygulamanız ne ve nerede olursa olsun tüm bilgilerine ulaşın
          </p>
        </div>
        <AramaKutusu ilk="" onSec={sec} buyuk />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AramaKutusu key={`${tip}-${ad}`} ilk={ad} onSec={sec} buyuk={false} />
        <Button variant="ghost" size="sm" onClick={() => navigate('/application-hub')}>Yeni arama</Button>
      </div>

      <header className="card px-5 py-4 flex flex-wrap items-center justify-between gap-4" style={{ borderTop: '3px solid var(--ah-hue)' }}>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate" title={detay?.ad || ad} style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>{detay?.ad || ad}</h1>
            <TipHap tip={tip} />
            {detay && detay.tip === 'jboss' && detay.varyantlar.length > 1 && (
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{detay.varyantlar.join(' · ')}</span>
            )}
          </div>
          {okundu && (
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }} title={fmtDateTime(okundu)}>
              Veriler {fmtRelative(okundu)} okundu · envanter ve tarama kaynaklarının kendi tazeliği bölümlerde yazar
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ocpYerleri.length > 1 && (
            <label className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              Hedef
              <select
                value={ocpHedef}
                onChange={(e) => setOcpHedef(Number(e.target.value))}
                className="rounded border px-2 py-1 text-[12px]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {ocpYerleri.map((y, i) => (
                  <option key={`${y.cluster}|${y.namespace}`} value={i}>
                    {y.ortam} · {y.cluster} / {y.namespace}
                  </option>
                ))}
              </select>
            </label>
          )}
          {linkler?.opsx && canViewPage('OpsX') && (
            <Button variant="primary" icon={<WrenchScrewdriverIcon className="w-4 h-4" />} onClick={() => navigate(linkler.opsx!)}>
              OpsX'te işlem yap
            </Button>
          )}
          {linkler?.logx && canViewPage('LogX') && (
            <Button variant="secondary" icon={<DocumentTextIcon className="w-4 h-4" />} onClick={() => navigate(linkler.logx!)}>
              LogX'te log al
            </Button>
          )}
          {isAdmin && detay?.tip === 'jboss' && (
            <Button variant="danger" icon={<TrashIcon className="w-4 h-4" />} onClick={() => void retireAc()} loading={retireYukleniyor}
              title="Retirement kaydı açar (Smart silme kaydı gerekir). Yalnız Admin.">
              Uygulamamı retire et
            </Button>
          )}
          <Button variant="ghost" icon={<ArrowPathIcon className={`w-4 h-4 ${yukleniyor ? 'animate-spin' : ''}`} />} onClick={yenile} disabled={yukleniyor}>
            Yenile
          </Button>
        </div>
      </header>

      {acilanKayit != null && (
        <div role="status" className="card px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]" style={{ borderLeft: '3px solid var(--status-success)' }}>
          <span style={{ color: 'var(--text-primary)' }}>
            Retirement kaydı <b>#{acilanKayit}</b> açıldı. STOP, silme ve IP/LB/DNS adımları BMW Hub › Retirement'tan yürür.
          </span>
          <Button variant="secondary" size="sm" onClick={() => navigate('/retirement')}>BMW Hub'da aç</Button>
        </div>
      )}

      {retire && detay?.tip === 'jboss' && isAdmin && (
        <RetirementKayitPenceresi
          defaultDays={retire.gun}
          baslangic={{ uygulama: detay.ad, not: `Application Hub'dan açıldı (${detay.ad}).` }}
          onClose={() => setRetire(null)}
          onCreated={(id) => {
            setRetire(null);
            setAcilanKayit(id);
          }}
        />
      )}

      {hata ? (
        <LoadError title={`${ad} yüklenemedi`} message={hata} onRetry={yenile} retrying={yukleniyor} />
      ) : !detay ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-20 card skeleton" />
            ))}
          </div>
          <div className="h-64 card skeleton" />
        </div>
      ) : detay.tip === 'jboss' ? (
        <JbossGorunum key={`${detay.ad}-${okundu}`} d={detay} onYenile={yenile} />
      ) : detay.tip === 'was' ? (
        <WasGorunum d={detay} />
      ) : (
        <OcpGorunum key={`${detay.ad}-${okundu}`} d={detay} onYenile={yenile} />
      )}
    </div>
  );
}
