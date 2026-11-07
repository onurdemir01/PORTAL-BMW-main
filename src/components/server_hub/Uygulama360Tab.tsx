// src/components/server_hub/Uygulama360Tab.tsx — Server Hub > Uygulama 360 (2026-11-07).
//
// Kullanıcı: "basitleştirilmiş görünümden istedikçe açılan, özelleşen, bilgi veren, filtrelenen ekranlar".
// Basit başlar: uygulama başına tek satır, 6 kolon (uygulama, ortamlar, etiket, risk, OpenShift,
// Retirement). "Ayrıntılı kolonlar" ölçümlerin hepsini açar (kolon seçicisi ve süzgeçleri ayrı kalır).
// Satır açılınca ortam × sunucu matrisi; sunucuya tıklayınca Bulgular'daki sunucu paneli; altında
// etiketler, OpenShift kanıtı ve Retirement kaydı. Veri tek uçtan (uygulama-360.cjs); yeni tarama yok.
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type Sh360Ayrinti,
  type Sh360Ozet,
  type Sh360Sonuc,
  type ShRetireSonuc,
} from '@/api/serverHubApi';
import { fmtNumber } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { EarTablo, type EarKolon } from './EarTablo';
import { BTN, btnStil, EtiketRozeti } from './RetireEtiketleri';
import { ETIKET_SEVIYE, KONTROL_DURUM, konuMetni, retirementMetni } from './retireEtiket';
import SunucuPaneli from './SunucuPaneli';
import { useSekmeGorunur } from './sekmeGorunurlugu';
import {
  DEPLOYMENT_METNI,
  TRAFIK_METNI,
  U360_HIZLI,
  kopyaRozetleri,
  matris,
  ocpMetni,
  ortamRozeti,
  u360Say,
  u360Suz,
  type U360Hizli,
  type U360Ton,
} from './uygulama360';

const TON_STIL: Record<U360Ton, React.CSSProperties> = {
  iyi: {
    background: 'var(--status-success-bg)',
    color: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
  },
  uyari: { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' },
  kotu: { background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
  notr: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};
const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };
const AYRINTILI_ANAHTAR = 'uygulama-360:ayrintili';

function Rozet({ metin, ton, title }: { metin: string; ton: U360Ton; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 text-[10px] font-semibold whitespace-nowrap"
      style={TON_STIL[ton]}
    >
      {metin}
    </span>
  );
}
const Bos = () => <span style={MUTED}>—</span>;
const riskTitle = (u: Sh360Ozet) =>
  `auto-start uyumsuz ${u.autostartUyumsuz} · kopyalardan farklı ${u.kopyaTutarsiz} · prod’da yok ${u.kalinti} · Retirement çelişkisi ${u.celiski}`;

function kolonlarOf(ayrintili: boolean, ocpOkunamadi: boolean): EarKolon<Sh360Ozet>[] {
  const ek = (k: EarKolon<Sh360Ozet>): EarKolon<Sh360Ozet> => ({ ...k, varsayilan: ayrintili });
  const sayi = (
    anahtar: string,
    baslik: string,
    aciklama: string,
    f: (u: Sh360Ozet) => number | null,
  ) =>
    ek({
      anahtar,
      baslik,
      aciklama,
      suzgec: 'sayi',
      sirala: true,
      deger: f,
      hucre: (u) => {
        const v = f(u);
        return v == null ? <Bos /> : <span className="tabular-nums">{fmtNumber(v)}</span>;
      },
    });
  return [
    {
      anahtar: 'ad',
      baslik: 'Uygulama',
      aciklama: 'Taban uygulama adı: <APP>, <APP>-D, -T ve -Q aynı uygulamanın ortamlarıdır.',
      suzgec: 'metin',
      sirala: true,
      deger: (u) => u.ad,
      hucre: (u) => (
        <div>
          <span className="font-mono font-semibold">{u.ad}</span>
          <div className="text-[10px]" style={MUTED}>
            {u.sunucuSayisi} sunucu · {u.kopyaSayisi} kopya · JBoss {u.nesiller.join('/')}
          </div>
        </div>
      ),
    },
    {
      anahtar: 'ortamlar',
      baslik: 'Ortamlar',
      aciklama: 'Ortam başına çalışan / toplam kopya. Ölçülemeyen kopya varsa rozet gri.',
      suzgec: 'secim',
      deger: (u) => u.ortamlar.map((o) => o.ortam),
      hucre: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.ortamlar.map((o) => (
            <Rozet key={o.ortam} {...ortamRozeti(o)} />
          ))}
        </div>
      ),
    },
    {
      anahtar: 'etiket',
      baslik: 'Etiket',
      aciklama: 'En yüksek Retirement etiketi ve onu koyan kurallar.',
      suzgec: 'secim',
      secenekler: [
        { deger: 'KESIN', etiket: 'kesin' },
        { deger: 'SUPHELI', etiket: 'şüpheli' },
      ],
      deger: (u) => u.etiket?.seviye ?? null,
      hucre: (u) =>
        u.etiket?.seviye ? (
          <div className="flex items-center gap-1.5">
            <EtiketRozeti b={ETIKET_SEVIYE[u.etiket.seviye]} kucuk />
            <span className="text-[10px] font-mono" style={MUTED}>
              {u.etiket.kurallar.join(' ')}
            </span>
          </div>
        ) : (
          <Bos />
        ),
    },
    {
      anahtar: 'risk',
      baslik: 'Risk',
      aciklama:
        'Riskli kopya sayısı: auto-start uyumsuz, aynı ortamdaki kopyalardan farklı, prod’da yok ya da Retirement kaydıyla çelişen.',
      suzgec: 'sayi',
      sirala: true,
      deger: (u) => u.riskliKopya,
      hucre: (u) =>
        u.riskliKopya ? (
          <span
            title={riskTitle(u)}
            className="font-semibold tabular-nums"
            style={{ color: 'var(--status-warning-text)' }}
          >
            {u.riskliKopya} kopya
          </span>
        ) : (
          <Bos />
        ),
    },
    {
      anahtar: 'ocp',
      baslik: 'OpenShift',
      aciklama:
        'Aynı uygulama OpenShift envanterinde aynı ortamda var mı (namespace son eki); Dynatrace isteği. Okunamadıysa "okunamadı" yazar, "yok" demez.',
      suzgec: 'secim',
      deger: (u) => ocpMetni(u, ocpOkunamadi),
      hucre: (u) =>
        u.ocp ? (
          <div className="text-[11px]">
            <span
              style={
                u.ocp.tasinmisOlabilir
                  ? { color: 'var(--status-warning-text)', fontWeight: 600 }
                  : undefined
              }
            >
              {ocpMetni(u, ocpOkunamadi)}
            </span>
            <div className="text-[10px]" style={MUTED}>
              {u.ocp.yerler[0]?.namespace}
              {u.ocp.yerSayisi > 1 ? ` +${u.ocp.yerSayisi - 1}` : ''} ·{' '}
              {u.ocp.istek == null ? 'istek ölçülemedi' : `${fmtNumber(u.ocp.istek)} istek`}
            </div>
          </div>
        ) : (
          <span style={MUTED}>{ocpOkunamadi ? 'okunamadı' : '—'}</span>
        ),
    },
    {
      anahtar: 'retirement',
      baslik: 'Retirement',
      aciklama:
        'Kopyaların Retirement kaydı (#kayıt · hedef durumu); kayıtla çelişen kopya varsa ayrıca yazılır.',
      suzgec: 'secim',
      deger: (u) => [...u.retirement.map(retirementMetni), ...(u.celiski ? ['çelişki var'] : [])],
      hucre: (u) =>
        u.retirement.length || u.celiski ? (
          <div className="text-[11px] whitespace-normal min-w-[9rem]">
            {u.retirement.map((r) => (
              <div key={r.hedef} title={r.host || ''}>
                {retirementMetni(r)}
              </div>
            ))}
            {u.celiski > 0 && (
              <div style={{ color: 'var(--status-danger-text)' }}>
                {u.celiski} kopya kayıtla çelişiyor
              </div>
            )}
          </div>
        ) : (
          <Bos />
        ),
    },
    ek({
      anahtar: 'nesil',
      baslik: 'JBoss',
      aciklama: 'Kopyaların JBoss nesilleri (7, 8).',
      suzgec: 'secim',
      deger: (u) => u.nesiller.map(String),
      hucre: (u) => u.nesiller.join(' / '),
    }),
    ek({
      anahtar: 'tier',
      baslik: 'Tier',
      aciklama: 'MWAppsInventory tier.',
      suzgec: 'secim',
      deger: (u) => u.tier,
      hucre: (u) => (u.tier.length ? u.tier.join(' / ') : <Bos />),
    }),
    sayi('sunucu', 'Sunucu', 'Kopyaların bulunduğu sunucu sayısı.', (u) => u.sunucuSayisi),
    sayi('kapali', 'Kapalı', 'Kapalı kopya (ölçülemeyen sayılmaz).', (u) => u.kapali),
    sayi(
      'olculemeyen',
      'Ölçülemeyen',
      'Çalışması ölçülemeyen kopya (hidepid / ps körlüğü).',
      (u) => u.olculemeyen,
    ),
    sayi(
      'autostart',
      'Auto-start uyumsuz',
      'Çalışıyor + auto-start kapalı ya da kapalı + auto-start açık kopya.',
      (u) => u.autostartUyumsuz,
    ),
    sayi(
      'kopyaTutarsiz',
      'Kopyalardan farklı',
      'Aynı ortamdaki eşlenik kopyalardan sapan kopya.',
      (u) => u.kopyaTutarsiz,
    ),
    sayi(
      'kalinti',
      'Prod’da yok',
      'Prod’da çalışan kopyası olmayan uygulamanın çalışan non-prod kopyası.',
      (u) => u.kalinti,
    ),
    sayi(
      'ear',
      'EAR',
      'Kopyalara bağlı EAR sayısı (Uygulama Envanteri). Boş: EAR verisi yok.',
      (u) => u.ear?.sayi ?? null,
    ),
    sayi('war', 'WAR', 'Bağlı EAR’lardaki WAR toplamı.', (u) => u.ear?.war ?? null),
    ek({
      anahtar: 'deployment',
      baslik: 'Deployment',
      aciklama: 'Faz 2 deployment kontrolünün en kötü sonucu (çalışan kopyalarda). Boş: ölçülmedi.',
      suzgec: 'secim',
      secenekler: Object.entries(DEPLOYMENT_METNI).map(([deger, etiket]) => ({ deger, etiket })),
      deger: (u) => u.deployment,
      hucre: (u) => (u.deployment ? DEPLOYMENT_METNI[u.deployment] : <Bos />),
    }),
    ek({
      anahtar: 'trafik',
      baslik: 'JBoss trafik',
      aciklama:
        'Web katmanı (IHS / Nginx) trafiği: biri varsa var; hepsi ölçülüp boşsa yok; aksi halde ölçülemedi.',
      suzgec: 'secim',
      secenekler: ['ACTIVE', 'NO_RECENT_TRAFFIC', 'OLCULEMEDI'].map((d) => ({
        deger: d,
        etiket: TRAFIK_METNI[d],
      })),
      deger: (u) => u.trafik,
      hucre: (u) => TRAFIK_METNI[u.trafik] || u.trafik,
    }),
    sayi(
      'istek',
      'JBoss istek (7 gün)',
      'Ölçülen vhost’ların 7 günlük istek toplamı (hc hariç).',
      (u) => u.istek7g,
    ),
    sayi(
      'ocpIstek',
      'OpenShift istek',
      'Dynatrace isteği (ortam grubu başına bir kez).',
      (u) => u.ocp?.istek ?? null,
    ),
    ek({
      anahtar: 'kurallar',
      baslik: 'Kurallar',
      aciklama: 'Uygulamanın etiketlerini koyan kurallar.',
      suzgec: 'secim',
      deger: (u) => u.etiket?.kurallar ?? [],
      hucre: (u) =>
        u.etiket ? (
          <span className="font-mono text-[11px]">{u.etiket.kurallar.join(' ')}</span>
        ) : (
          <Bos />
        ),
    }),
    ek({
      anahtar: 'sonTarama',
      baslik: 'Son tarama',
      aciklama: 'Kopyaların en yeni tarama günü.',
      suzgec: 'tarih',
      sirala: true,
      deger: (u) => u.sonTarama,
      hucre: (u) => u.sonTarama || <Bos />,
    }),
    sayi(
      'bayat',
      'Bayat kopya',
      'Taraması bayat sunucudaki kopya: karar vermez.',
      (u) => u.bayatKopya,
    ),
  ];
}

function Kutu({ baslik, children }: { baslik: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: 'var(--border-subtle)' }}
      aria-label={baslik}
    >
      <div className="font-semibold mb-1">{baslik}</div>
      {children}
    </section>
  );
}

function UygulamaAyrinti({
  anahtar,
  ocpOkunamadi,
  onListeYenile,
  onRetirementAc,
}: {
  anahtar: string;
  ocpOkunamadi: boolean;
  onListeYenile: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const [d, setD] = useState<Sh360Ayrinti | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  const [host, setHost] = useState<string | null>(null);
  const [retire, setRetire] = useState<ShRetireSonuc | null>(null);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await serverHubApi.uygulama360(anahtar);
        if (!alive()) return;
        if (r.ok && r.uygulama) setD(r.uygulama);
        else {
          setHata(r.message || 'Uygulama ayrıntısı okunamadı.');
          // 409: uygulama artık listede yok (tarama değişti) — liste de tazelensin.
          if (r._httpStatus === 409) onListeYenile();
        }
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [anahtar, tazele],
  );
  // Sunucu paneli etiket verisini ister; yalnız bir sunucu açılınca indirilir.
  const retireYukle = useCallback(async (fresh = false) => {
    try {
      const r = await serverHubApi.retireEtiketleri(fresh);
      if (r.ok) setRetire(r);
      else toast.error(r.message || 'Retirement etiketleri alınamadı.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(
    async (alive) => {
      if (host && !retire && alive()) await retireYukle();
    },
    [host, retire, retireYukle],
  );

  if (hata)
    return (
      <LoadError
        title="Uygulama ayrıntısı okunamadı"
        message={hata}
        onRetry={() => setTazele((n) => n + 1)}
        compact
      />
    );
  if (!d)
    return (
      <div className="text-xs py-3" style={MUTED}>
        yükleniyor…
      </div>
    );
  const ocpAd = d.kopyalar.find((k) => k.capraz?.ocp)?.capraz?.ocp?.ad || null;
  const celiskiler = d.kopyalar.flatMap((k) =>
    (k.capraz?.celiski || []).map((c) => ({ ...c, host: k.host })),
  );
  return (
    <div className="space-y-3" data-testid="uygulama-360-ayrinti">
      <section aria-label="Ortam × sunucu">
        <div className="text-xs font-semibold mb-1">
          Ortam × sunucu ({d.kopyaSayisi} kopya){' '}
          <span className="font-normal" style={MUTED}>
            — sunucuya tıklayınca sunucu paneli açılır
          </span>
        </div>
        {matris(d.kopyalar).map((s) => (
          <div
            key={s.ortam}
            className="flex items-start gap-2 py-1.5 border-t"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="w-16 shrink-0 text-[11px] font-semibold pt-1">{s.ortam}</div>
            <div className="flex flex-wrap gap-2">
              {s.hucreler.map((c) => (
                <button
                  key={c.host}
                  type="button"
                  aria-pressed={host === c.host}
                  aria-label={`${c.host} sunucu paneli`}
                  onClick={() => setHost(host === c.host ? null : c.host)}
                  className="text-left rounded-lg border px-2 py-1.5 min-w-[12rem]"
                  style={{
                    borderColor: host === c.host ? 'var(--accent)' : 'var(--border-subtle)',
                    background: 'var(--bg-surface)',
                  }}
                >
                  <span className="block text-[11px] font-mono font-semibold">{c.host}</span>
                  {c.kopyalar.map((k) => (
                    <span key={`${k.gen}|${k.ad}`} className="block mt-1">
                      <span className="block text-[10px]" style={MUTED}>
                        JBoss {k.gen} · {k.ad}
                        {k.tier ? ` · tier ${k.tier}` : ''}
                      </span>
                      <span className="flex flex-wrap gap-1 mt-0.5">
                        {kopyaRozetleri(k).map((r) => (
                          <Rozet key={r.metin} {...r} />
                        ))}
                      </span>
                      {k.retirement.length > 0 && (
                        <span className="block text-[10px] mt-0.5">
                          {k.retirement.map(retirementMetni).join(' · ')}
                        </span>
                      )}
                    </span>
                  ))}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      {host && (
        <div data-testid="uygulama-360-panel">
          <SunucuPaneli
            host={host}
            retire={retire}
            onEtiketDegisti={() => void retireYukle(true)}
            onRetirementAc={onRetirementAc}
          />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <Kutu baslik={`Etiketler (${d.etiketler.length})`}>
          {d.etiketler.length ? (
            <ul className="space-y-1">
              {d.etiketler.map((e) => (
                <li key={e.anahtar} className="flex flex-wrap items-center gap-1.5">
                  <EtiketRozeti b={ETIKET_SEVIYE[e.seviye]} kucuk />
                  <span className="font-mono">{konuMetni(e)}</span>
                  <span className="font-mono text-[10px]" style={MUTED}>
                    {e.kurallar.join(' ')}
                  </span>
                  <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />
                </li>
              ))}
            </ul>
          ) : (
            <span style={MUTED}>Retirement etiketi yok.</span>
          )}
        </Kutu>
        <Kutu baslik="OpenShift">
          {d.ocp ? (
            <div className="space-y-1">
              {d.ocp.yerler.map((y) => (
                <div key={`${y.namespace}@${y.cluster}`} className="font-mono">
                  {y.namespace} @ {y.cluster}
                </div>
              ))}
              {d.ocp.yerSayisi > d.ocp.yerler.length && (
                <div style={MUTED}>+{d.ocp.yerSayisi - d.ocp.yerler.length} yer daha</div>
              )}
              <div>
                Dynatrace: {d.ocp.istek == null ? 'ölçülemedi' : `${fmtNumber(d.ocp.istek)} istek`}
                {d.ocp.tasinmisOlabilir ? ' — JBoss kopyası boşta, taşınmış olabilir' : ''}
              </div>
              {ocpAd && ocpAd.jboss !== ocpAd.ocp && (
                <div style={MUTED}>
                  ad eşleşmesi: {ocpAd.jboss} ↔ {ocpAd.ocp}
                </div>
              )}
            </div>
          ) : (
            <span style={MUTED}>
              {ocpOkunamadi
                ? 'OpenShift envanteri okunamadı.'
                : 'OpenShift envanterinde aynı ortamda yok.'}
            </span>
          )}
        </Kutu>
        <Kutu baslik="Retirement">
          {d.retirement.length ? (
            <ul className="space-y-0.5">
              {d.retirement.map((r) => (
                <li key={r.hedef}>
                  {retirementMetni(r)} <span style={MUTED}>· {r.host}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={MUTED}>Retirement kaydı yok.</span>
          )}
          {celiskiler.map((c) => (
            <div
              key={`${c.host}|${c.hedef}`}
              className="mt-1"
              style={{ color: 'var(--status-danger-text)' }}
            >
              {c.host}: #{c.kayit} {c.durum === 'deleted' ? 'silindi' : 'STOP edildi'} ama{' '}
              {c.nedenler
                .map((n) =>
                  n === 'calisiyor'
                    ? 'JVM çalışıyor'
                    : n === 'autostart'
                      ? 'auto-start açık'
                      : 'paket diskte',
                )
                .join(', ')}
            </div>
          ))}
        </Kutu>
      </div>
    </div>
  );
}

export default function Uygulama360Tab({
  onRetirementAc,
}: {
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const gorunur = useSekmeGorunur();
  const [veri, setVeri] = useState<Sh360Sonuc | null>(null);
  const [hata, setHata] = useState('');
  const [yuk, setYuk] = useState(false);
  const [hizli, setHizli] = useState<U360Hizli>('hepsi');
  const [ayrintili, setAyrintili] = useState(() => {
    try {
      return window.localStorage.getItem(AYRINTILI_ANAHTAR) === '1';
    } catch {
      return false;
    }
  });
  const yukle = useCallback(async (fresh = false) => {
    setYuk(true);
    try {
      const r = await serverHubApi.uygulamalar360(fresh);
      if (r.ok) {
        setVeri(r);
        setHata('');
      } else setHata(r.message || 'Uygulama 360 okunamadı.');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYuk(false);
    }
  }, []);
  useAsyncEffect(async () => {
    if (gorunur && !veri && !hata) await yukle();
  }, [gorunur, veri, hata, yukle]);
  const liste = useMemo(() => veri?.uygulamalar || [], [veri]);
  const satirlar = useMemo(() => u360Suz(liste, hizli), [liste, hizli]);
  const sayilar = useMemo(() => u360Say(liste), [liste]);
  const ocpOkunamadi = !!veri?.capraz?.ocp.okunamadi;
  const kolonlar = useMemo(() => kolonlarOf(ayrintili, ocpOkunamadi), [ayrintili, ocpOkunamadi]);
  const ayrintiliDegistir = () => {
    const y = !ayrintili;
    setAyrintili(y);
    try {
      window.localStorage.setItem(AYRINTILI_ANAHTAR, y ? '1' : '0');
    } catch {
      /* depolama kapali: tercih yalniz bu oturumda */
    }
  };

  if (!veri && hata)
    return (
      <LoadError
        title="Uygulama 360 okunamadı"
        message={hata}
        onRetry={() => setHata('')}
        retrying={yuk}
      />
    );
  if (!veri)
    return (
      <div className="py-10 flex justify-center">
        <LoadingLogo />
      </div>
    );
  const okunamayan = [
    veri.capraz?.ocp.okunamadi && 'OpenShift envanteri (OpenShift kolonu “okunamadı” yazar)',
    veri.capraz?.kullanim.okunamadi && 'Dynatrace kullanımı (OpenShift isteği ölçülemedi)',
    veri.capraz?.retirement.okunamadi && 'Retirement kayıtları (Retirement kolonu boş)',
    veri.ear?.okunamadi && 'Uygulama Envanteri (EAR / WAR / Deployment boş)',
  ].filter(Boolean);
  return (
    <div className="space-y-3" data-testid="uygulama-360">
      <p className="text-xs" style={MUTED}>
        Uygulama başına tek satır: bütün sunucu ve ortamlardaki kopyalar, Uygulama Envanteri,
        OpenShift, Retirement ve etiketler bir arada. Satıra tıklayınca ortam × sunucu matrisi
        açılır.
      </p>
      {okunamayan.length > 0 && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--status-warning-text)',
          }}
        >
          Okunamayan kaynak: {okunamayan.join(', ')}. Bu kaynağa dayanan sütunlar “temiz” demek
          değil.
        </div>
      )}
      {veri.tableMissing ? (
        <div className="text-xs" style={MUTED}>
          Server Hub tarama tabloları yok: önce günlük tarama çalışmalı.
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-2 text-xs"
            role="group"
            aria-label="Hızlı süzgeç"
          >
            {U360_HIZLI.map((h) => (
              <button
                key={h.id}
                type="button"
                title={h.aciklama}
                aria-pressed={hizli === h.id}
                onClick={() => setHizli(h.id)}
                className="px-2.5 py-1 rounded-lg border"
                style={{
                  borderColor: hizli === h.id ? 'var(--accent)' : 'var(--border-subtle)',
                  background: hizli === h.id ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                }}
              >
                {h.etiket} <b className="tabular-nums">{fmtNumber(sayilar[h.id])}</b>
              </button>
            ))}
          </div>
          <EarTablo<Sh360Ozet>
            key={ayrintili ? 'ayrintili' : 'basit'}
            kimlik={ayrintili ? 'uygulama-360-ayrintili' : 'uygulama-360'}
            kolonlar={kolonlar}
            satirlar={satirlar}
            satirAnahtari={(u) => u.anahtar}
            acilir={(u) => (
              <UygulamaAyrinti
                anahtar={u.anahtar}
                ocpOkunamadi={ocpOkunamadi}
                onListeYenile={() => void yukle(true)}
                onRetirementAc={onRetirementAc}
              />
            )}
            csvAdi="uygulama-360_secili"
            yerelCsv="uygulama-360"
            araEtiketi="uygulama, ortam ya da kural ara"
            bosMetin={
              liste.length ? 'Süzgeçle eşleşen uygulama yok.' : 'Server Hub taramasında JVM yok.'
            }
            ustSag={
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={ayrintili}
                  className={BTN}
                  style={btnStil(ayrintili)}
                  onClick={ayrintiliDegistir}
                  title="Bütün ölçüm kolonlarını göster / gizle"
                >
                  Ayrıntılı kolonlar
                </button>
                <button
                  type="button"
                  onClick={() => void yukle(true)}
                  className={BTN}
                  style={btnStil()}
                >
                  <ArrowPathIcon className={`w-3.5 h-3.5 ${yuk ? 'animate-spin' : ''}`} /> Yenile
                </button>
              </span>
            }
          />
        </>
      )}
    </div>
  );
}
