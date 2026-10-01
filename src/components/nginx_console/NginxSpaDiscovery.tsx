// src/components/nginx_console/NginxSpaDiscovery.tsx — Nginx Hub > "Gerçek SPA Keşfi".
//
// Kullanıcı (2026-10-01): "gerçekten SPA olan tüm uygulamaların çekilmesi, bu uygulamalara
// nazaran route envanterinin karşılaştırılması ve route'larının yazılması, aynı zamanda
// uygulama trafiğinin de yanlarına işlenmesi."
//
// SADELEŞTİRME (kullanıcı, aynı gün): "her uygulama için tek satır olsun; route adresleri ve
// cluster isimleri aynı satıra yazılsın; iş yükü kolonuna gerek yok; SPA, ad kalıbı ve istek
// kolonları önemli; 'kalıp kaçırdı' ne demek anlamadım." Satırlar sunucuda uygulama başına
// gruplanır (spa-discovery.cjs uygulamalar()); bu bileşen yalnız gösterir ve süzer.
//
// ÜÇ KAYNAK, ÜÇ AYRI SORU — hiçbiri ötekini düzeltmez, fark bilgidir:
//   keşif           → kabinde gerçekten nginx var mı (SPA kolonu)
//   route envanteri → route'u envanterde kayıtlı mı (Route envanteri kolonu)
//   Dynatrace       → uygulama istek alıyor mu (İstek kolonu)
import { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  nginxConsoleApi,
  type NgSpaApp,
  type NgSpaCoverage,
  type NgSpaDiscovery,
} from '@/api/nginxConsoleApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { downloadCsv } from '@/utils/csv';

const nf = (n: number) => n.toLocaleString('tr-TR');

const DURUM_ETIKETI: Record<string, { t: string; renk: string }> = {
  ok: { t: 'tarandı', renk: 'var(--status-success)' },
  kismi: { t: 'kısmi', renk: 'var(--status-warning)' },
  login: { t: 'giriş yapılamadı', renk: 'var(--status-danger)' },
  hata: { t: 'taranamadı', renk: 'var(--status-danger)' },
  erisilemedi: { t: 'sonuç gelmedi', renk: 'var(--status-danger)' },
  bilinmiyor: { t: 'durum bilinmiyor', renk: 'var(--text-muted)' },
};

/**
 * CLUSTER KAPSAMI (2026-10-01, ilk üretim koşusu): 43 cluster'ın 27'si hiç veri üretmedi
 * ama ekran yalnızca "0 SPA" diyordu. "Taranamadı" ile "SPA'sı yok" burada AYRILIR.
 * Kovalar AYRIKTIR: her cluster tek sayıda geçer, toplamları cluster sayısıdır.
 */
function Kapsam({ k }: { k: NgSpaCoverage }) {
  if (k.error)
    return (
      <div className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
        Kapsam ölçülemedi: {k.error} — hangi cluster'ların taranamadığı şu an bilinmiyor.
      </div>
    );
  if (!k.measured)
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Cluster tarama durumu kaydı yok (yükleyicinin eski sürümüyle yüklenmiş veri) — hangi
        cluster'ların taranamadığı bilinmiyor.
      </div>
    );
  const sorunlu = k.clusters.filter((c) => c.bucket !== 'guncel');
  return (
    <details open={k.failed > 0} className="text-[11px]">
      <summary
        className="cursor-pointer"
        style={{ color: k.failed ? 'var(--status-danger)' : 'var(--text-secondary)' }}
      >
        Kapsam ({nf(k.total)} cluster): {nf(k.ok)} son koşuda tam tarandı
        {k.older > 0 && <> · {nf(k.older)} önceki koşudan</>}
        {k.partial > 0 && <> · {nf(k.partial)} kısmi</>}
        {k.failed > 0 && (
          <>
            {' '}
            · <b>{nf(k.failed)} taranamadı</b>
          </>
        )}
        {k.unknown > 0 && <> · {nf(k.unknown)} durumu bilinmiyor</>}
        {k.noData > 0 && <> (bunların {nf(k.noData)} tanesinin ekranda hiç verisi yok)</>}
      </summary>
      {sorunlu.length > 0 && (
        <table className="mt-1.5 w-full">
          <tbody>
            {sorunlu.map((c) => {
              const e =
                c.bucket === 'onceki'
                  ? {
                      t: `son koşuya dahil değildi (son tarama ${c.runDate})`,
                      renk: 'var(--text-muted)',
                    }
                  : DURUM_ETIKETI[c.status] || DURUM_ETIKETI.bilinmiyor;
              return (
                <tr
                  key={c.cluster}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="py-0.5 pr-2 font-mono">{c.cluster}</td>
                  <td
                    className="py-0.5 pr-2 whitespace-nowrap"
                    style={{ color: e.renk, fontWeight: 600 }}
                  >
                    {e.t}
                  </td>
                  <td
                    className="py-0.5 pr-2 whitespace-nowrap"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {c.noData
                      ? 'ekranda verisi yok'
                      : c.stale
                        ? `ekrandaki veri ${c.dataDate} tarihli, önceki koşudan`
                        : `veri ${c.dataDate}`}
                  </td>
                  <td className="py-0.5 break-all" style={{ color: 'var(--text-secondary)' }}>
                    {c.reason || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </details>
  );
}

/** SPA kolonu. ÜÇ DURUM AYRI: hiçbir route eşleşmediyse "bilinmiyor" — "hayır" DEĞİL. */
function SpaHucre({ a }: { a: NgSpaApp }) {
  if (a.spa === 'evet')
    return (
      <span
        style={{ color: 'var(--status-success)', fontWeight: 600 }}
        title={`Kabinde nginx çalışıyor · kanıt: ${a.signals.join(', ') || '—'}`}
      >
        Evet
        {a.weakEvidence && (
          <span
            className="ml-1 text-[10px] font-normal"
            style={{ color: 'var(--status-warning)' }}
            title="Servis okunamadı; route, servisle aynı adı taşıyan iş yüküne bağlandı. Selector eşleşmesinden zayıf bir kanıt."
          >
            (zayıf kanıt)
          </span>
        )}
      </span>
    );
  if (a.spa === 'hayir')
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="Route'un ardındaki iş yükünde nginx bulunamadı"
      >
        Hayır
      </span>
    );
  return (
    <span
      style={{ color: 'var(--status-warning)' }}
      title={`Hiçbir route bir iş yüküne eşlenemedi — SPA olup olmadığı ölçülemedi.\n${a.notes.join('\n')}`}
    >
      Bilinmiyor
    </span>
  );
}

/** Ad kalıbı kolonu: uygulama adı -app-v / -app-emb-v kuralına uyuyor mu. */
function KalipHucre({ a }: { a: NgSpaApp }) {
  if (a.patternMiss)
    return (
      <span
        style={{ color: 'var(--status-danger)', fontWeight: 600 }}
        title="Gerçekten SPA ama adı -app-v / -app-emb-v kuralına uymuyor. Eski (ada bakan) yöntem bu uygulamayı SPA saymıyordu."
      >
        uymuyor
      </span>
    );
  if (a.patternFalse)
    return (
      <span
        style={{ color: 'var(--status-warning)' }}
        title="Adı SPA kuralına uyuyor ama kabinde nginx bulunamadı."
      >
        uyuyor · nginx yok
      </span>
    );
  return <span style={{ color: 'var(--text-secondary)' }}>{a.pattern}</span>;
}

/** İstek kolonu. DÖRT DURUM AYRI: istek var ≠ istek yok ≠ ölçülemedi ≠ ölçüm yok. */
function IstekHucre({ a }: { a: NgSpaApp }) {
  if (a.istek === 'olcum-yok')
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="Bu uygulama için Dynatrace ölçümü bulunamadı — “istek almıyor” DEMEK DEĞİL."
      >
        ölçüm yok
      </span>
    );
  if (a.istek === 'olculemedi')
    return (
      <span
        style={{ color: 'var(--status-warning)' }}
        title={`Ölçüm denendi ama düştü${a.usage?.note ? ': ' + a.usage.note : ''}. “0 istek” anlamına GELMEZ.`}
      >
        ölçülemedi
      </span>
    );
  const pencere = a.usage
    ? `Dynatrace servis çağrıları · son ${a.usage.windowDays} gün · ${a.usage.services} servis · ölçüm ${a.usage.scanDate}`
    : '';
  if (a.istek === 'yok')
    return (
      <span style={{ color: 'var(--status-warning)' }} title={pencere}>
        istek yok
      </span>
    );
  return (
    <span style={{ color: 'var(--text-primary)' }} title={pencere}>
      {nf(a.reqShown || 0)}
    </span>
  );
}

/** Route envanteri kolonu: uygulamanın route'u Openshift route envanterinde kayıtlı mı. */
function EnvanterHucre({ a }: { a: NgSpaApp }) {
  const title =
    "Bu uygulamanın route'u Openshift route envanterinde (dbo.BMW_Openshift_Route_Inventory) kayıtlı mı";
  if (a.inventory === 'kayitli')
    return (
      <span style={{ color: 'var(--text-secondary)' }} title={title}>
        kayıtlı
      </span>
    );
  if (a.inventory === 'kismen')
    return (
      <span style={{ color: 'var(--status-warning)' }} title={title}>
        kısmen ({a.invRoutes}/{a.routeCount})
      </span>
    );
  return (
    <span
      style={{ color: a.spa === 'evet' ? 'var(--status-warning)' : 'var(--text-muted)' }}
      title={title}
    >
      kayıtlı değil
    </span>
  );
}

type SpaSecim = 'tumu' | NgSpaApp['spa'];
type KalipSecim = 'tumu' | NgSpaApp['pattern'];
type IstekSecim = 'tumu' | NgSpaApp['istek'];

const sayac = <K extends string>(apps: NgSpaApp[], f: (a: NgSpaApp) => K) =>
  apps.reduce<Record<string, number>>((m, a) => {
    const k = f(a);
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

export default function NginxSpaDiscovery() {
  const [data, setData] = useState<NgSpaDiscovery | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [q, setQ] = useState('');
  const [ns, setNs] = useState('tumu');
  const [spa, setSpa] = useState<SpaSecim>('tumu');
  const [kalip, setKalip] = useState<KalipSecim>('tumu');
  const [istek, setIstek] = useState<IstekSecim>('tumu');
  const [cluster, setCluster] = useState('tumu');

  // HATA GORUNUR: uc nokta 500 ya da ag hatasi verdiginde ekran "bu suzgeclerle satir yok"
  // DEMEZ (dusmanca dogrulama bulgusu - hata "yok" gibi sunuluyordu).
  const [hata, setHata] = useState('');
  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const d = await nginxConsoleApi.spaDiscovery();
      if (d && d.ok === false) {
        setHata(d.message || 'SPA keşfi okunamadı.');
        setData(null);
      } else setData(d);
    } catch (e: unknown) {
      setHata(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await yukle();
  }, [yukle]);

  const apps = useMemo(() => data?.apps || [], [data]);
  const say = useMemo(
    () => ({
      spa: sayac(apps, (a) => a.spa),
      kalip: sayac(apps, (a) => a.pattern),
      istek: sayac(apps, (a) => a.istek),
    }),
    [apps],
  );

  const satirlar = useMemo(() => {
    const ara = q.trim().toLowerCase();
    return apps.filter((a) => {
      if (ns !== 'tumu' && a.namespace !== ns) return false;
      if (spa !== 'tumu' && a.spa !== spa) return false;
      if (kalip !== 'tumu' && a.pattern !== kalip) return false;
      if (istek !== 'tumu' && a.istek !== istek) return false;
      if (cluster !== 'tumu' && !a.clusters.includes(cluster)) return false;
      if (!ara) return true;
      return (
        a.application.toLowerCase().includes(ara) ||
        a.namespace.toLowerCase().includes(ara) ||
        a.hosts.some((h) => h.toLowerCase().includes(ara)) ||
        a.routes.some((r) => r.toLowerCase().includes(ara))
      );
    });
  }, [apps, q, ns, spa, kalip, istek, cluster]);

  const suzgecVar =
    !!q ||
    ns !== 'tumu' ||
    spa !== 'tumu' ||
    kalip !== 'tumu' ||
    istek !== 'tumu' ||
    cluster !== 'tumu';
  const temizle = () => {
    setQ('');
    setNs('tumu');
    setSpa('tumu');
    setKalip('tumu');
    setIstek('tumu');
    setCluster('tumu');
  };

  const csv = useCallback(() => {
    downloadCsv(
      'gercek_spa_kesfi',
      [
        'uygulama',
        'namespace',
        'ortam',
        'spa',
        'kanit',
        'ad_kalibi',
        'istek',
        'olcum_penceresi_gun',
        'route_envanteri',
        'adresler',
        'clusterlar',
        'not',
      ],
      satirlar.map((a) => [
        a.application,
        a.namespace,
        a.env || '',
        a.spa === 'evet' ? 'evet' : a.spa === 'hayir' ? 'hayır' : 'bilinmiyor',
        a.signals.join(' ') + (a.weakEvidence ? ' (zayıf kanıt)' : ''),
        a.patternMiss ? 'uymuyor (SPA)' : a.pattern,
        // OLCULEMEYEN SATIRA 0 YAZILMAZ: elektronik tabloda toplanip "istek yok" okunurdu.
        a.istek === 'var' || a.istek === 'yok' ? (a.reqShown ?? '') : a.istek,
        a.usage?.windowDays ?? '',
        a.inventory === 'kismen' ? `kısmen (${a.invRoutes}/${a.routeCount})` : a.inventory,
        a.hosts.join(' '),
        a.clusters.join(' '),
        a.notes.join(' | '),
      ]),
    );
  }, [satirlar]);

  const s = data?.appSummary;
  const rs = data?.summary;
  // HICBIR route ESLESMEDI: "SPA yok" DEGIL, "bakamadik". Ilk uretim kosusunda 4532 route'un
  // tamami eslesmesizdi (servis yetkisi) ve ekran yalnizca "0 SPA" diyordu.
  const hepsiEslesmesiz = !!rs && rs.routes > 0 && rs.unmatched === rs.routes;
  const kovalar = Object.entries(rs?.unmatchedReasons || {}).sort((a, b) => b[1] - a[1]);
  // TARAMA EKSIGI: "adi kurala uymayan SPA yok" cumlesi ancak tam taramada nitelemesiz soylenir.
  const cv = data?.coverage;
  const eksikTarama = [
    cv && cv.failed > 0 ? `${nf(cv.failed)} cluster taranamadı` : '',
    cv && cv.partial > 0 ? `${nf(cv.partial)} cluster kısmi tarandı` : '',
    cv && (cv.error || (!cv.measured && (s?.apps || 0) > 0)) ? 'cluster kapsamı bilinmiyor' : '',
    s && s.unknown > 0 ? `${nf(s.unknown)} uygulamada SPA olup olmadığı ölçülemedi` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const SELECT = 'px-2 py-1.5 text-xs border rounded-lg';
  const selStyle = { borderColor: 'var(--border)', background: 'var(--bg-surface)' };
  const sec = (n?: number) => (n != null ? ` (${nf(n)})` : '');

  return (
    <div className="space-y-3">
      {hata && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          SPA keşfi okunamadı: {hata}
        </div>
      )}

      {data?.tableMissing && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }}
        >
          {data.message}
        </div>
      )}

      {hepsiEslesmesiz && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          <b>Hiçbir route bir iş yüküne eşlenemedi</b> — bu “SPA yok” demek DEĞİL, keşif route'ların
          arkasına bakamadı. Sebep: {kovalar.map(([k, v]) => `${k} (${nf(v)})`).join(' · ') || '—'}.
        </div>
      )}

      {s && (
        <div
          className="rounded-xl border p-3 space-y-1"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="text-sm">
            <b>{nf(s.apps)}</b> uygulama tarandı; <b>{nf(s.spa)}</b> tanesi gerçekten SPA (kabinde
            nginx çalışıyor).{' '}
            {s.patternMiss > 0 ? (
              <b style={{ color: 'var(--status-danger)' }}>
                Bunların {nf(s.patternMiss)} tanesinin adı -app-v / -app-emb-v kuralına uymuyor —
                eski yöntem bunları SPA saymıyordu.
              </b>
            ) : hepsiEslesmesiz ? null : s.apps === 0 ? (
              // VERI YOKKEN "KACIRILAN YOK" DENMEZ: olculmemis sey yok diye sunulmaz.
              <>Keşif verisi yok.</>
            ) : eksikTarama ? (
              <>Taranabilen kısımda adı kurala uymayan SPA yok ({eksikTarama}).</>
            ) : (
              <>Adı kurala uymayan SPA yok.</>
            )}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            SPA'lardan {nf(s.spaRequestActive)} tanesi istek alıyor · {nf(s.spaRequestIdle)} istek
            almıyor · {nf(s.spaRequestUnknown)} ölçülemedi/ölçüm yok
            {s.spaNotInInventory > 0 && (
              <> · {nf(s.spaNotInInventory)} SPA route envanterinde tam kayıtlı değil</>
            )}
            {s.unknown > 0 && <> · {nf(s.unknown)} uygulamada SPA olup olmadığı ölçülemedi</>}
            {data?.scanDate ? ` · keşif ${data.scanDate}` : ''}
          </div>
          {!!data?.platformHidden?.routes && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              OpenShift platform namespace'leri (openshift-*, kube-*, default) kapsam dışı:{' '}
              {nf(data.platformHidden.namespaces)} namespace, {nf(data.platformHidden.routes)} route
              gösterilmiyor (konsol, oauth, monitoring gibi platform route'ları; uygulama değil).
            </div>
          )}
          {data?.coverage && <Kapsam k={data.coverage} />}
        </div>
      )}

      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <b>SPA</b>: kabinde nginx çalışıyor mu · <b>Ad kalıbı</b>: uygulama adı -app-v / -app-emb-v
        kuralına uyuyor mu (eski yöntem SPA'yı yalnız adından tanıyordu) · <b>İstek</b>: Dynatrace'e
        göre istek alıyor mu · <b>Route envanteri</b>: route'u envanterde kayıtlı mı.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uygulama, namespace ya da adres"
            className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-56"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
        <select
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          className={SELECT}
          style={selStyle}
          title="Namespace"
        >
          <option value="tumu">tüm namespace'ler</option>
          {(data?.namespaces || []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={spa}
          onChange={(e) => setSpa(e.target.value as SpaSecim)}
          className={SELECT}
          style={selStyle}
          title="SPA"
        >
          <option value="tumu">SPA: tümü</option>
          <option value="evet">SPA: evet{sec(say.spa.evet)}</option>
          <option value="hayir">SPA: hayır{sec(say.spa.hayir)}</option>
          <option value="bilinmiyor">SPA: bilinmiyor{sec(say.spa.bilinmiyor)}</option>
        </select>
        <select
          value={kalip}
          onChange={(e) => setKalip(e.target.value as KalipSecim)}
          className={SELECT}
          style={selStyle}
          title="Ad kalıbı"
        >
          <option value="tumu">ad kalıbı: tümü</option>
          <option value="uyuyor">ad kalıbı: uyuyor{sec(say.kalip.uyuyor)}</option>
          <option value="uymuyor">ad kalıbı: uymuyor{sec(say.kalip.uymuyor)}</option>
        </select>
        <select
          value={istek}
          onChange={(e) => setIstek(e.target.value as IstekSecim)}
          className={SELECT}
          style={selStyle}
          title="İstek"
        >
          <option value="tumu">istek: tümü</option>
          <option value="var">istek alıyor{sec(say.istek.var)}</option>
          <option value="yok">istek almıyor{sec(say.istek.yok)}</option>
          <option value="olculemedi">istek ölçülemedi{sec(say.istek.olculemedi)}</option>
          <option value="olcum-yok">istek ölçümü yok{sec(say.istek['olcum-yok'])}</option>
        </select>
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className={SELECT}
          style={selStyle}
          title="Cluster"
        >
          <option value="tumu">tüm cluster'lar</option>
          {(data?.clusters || []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {suzgecVar && (
          <button
            onClick={temizle}
            className="px-2 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            süzgeçleri temizle
          </button>
        )}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {nf(satirlar.length)} uygulama
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={csv}
            disabled={!satirlar.length}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV ({nf(satirlar.length)})
          </button>
          <button
            onClick={() => void yukle()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-[12px]">
          <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
            <tr style={{ color: 'var(--text-muted)' }}>
              {[
                'Uygulama',
                'Namespace',
                'SPA',
                'Ad kalıbı',
                'İstek',
                'Route envanteri',
                'Adresler',
                "Cluster'lar",
              ].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {satirlar.map((a) => (
              <tr
                key={`${a.namespace}|${a.application}`}
                className="border-t align-top"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <td className="px-2 py-1 font-mono font-medium">{a.application}</td>
                <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {a.namespace}
                  {a.env && (
                    <span
                      className="ml-1 text-[10px] uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {a.env}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <SpaHucre a={a} />
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <KalipHucre a={a} />
                </td>
                <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                  <IstekHucre a={a} />
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <EnvanterHucre a={a} />
                </td>
                <td className="px-2 py-1 font-mono text-[11px] break-all">
                  {a.hosts.length
                    ? a.hosts.map((h) => <div key={h}>{h}</div>)
                    : a.routes.map((r) => <div key={r}>{r}</div>)}
                </td>
                <td className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {/* ESKI VERI SUNUCUDAN: son kosusu basarisiz cluster'in satiri onceki bir
                      kosudan (staleClusters, kapsamdan turetilir). */}
                  {a.clusters.map((c) =>
                    a.staleClusters.includes(c) ? (
                      <div
                        key={c}
                        style={{ color: 'var(--status-warning)' }}
                        title="Bu cluster son koşusunda taranamadı; veri önceki bir koşudan."
                      >
                        {c} · önceki koşudan
                      </div>
                    ) : (
                      <div key={c}>{c}</div>
                    ),
                  )}
                </td>
              </tr>
            ))}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={8} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
                  {hata ? (
                    // HATA "SATIR YOK" DEGIL: ust bantta sebep yazar; burada da bos sonuc
                    // gibi konusulmaz.
                    <span style={{ color: 'var(--status-danger)' }}>
                      Veri okunamadı — sebep yukarıda.
                    </span>
                  ) : apps.length ? (
                    <>
                      Bu süzgeçlerle uygulama yok; toplam {nf(apps.length)} uygulama var.{' '}
                      <button
                        onClick={temizle}
                        className="ml-1 px-1.5 py-0.5 text-[11px] border rounded"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        süzgeçleri temizle
                      </button>
                    </>
                  ) : (
                    'Keşif verisi yok.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
