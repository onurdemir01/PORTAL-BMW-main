// src/components/nginx_console/NginxSpaDiscovery.tsx — Nginx Hub > "Gerçek SPA Keşfi".
//
// Kullanıcı (2026-10-01): "gerçekten SPA olan tüm uygulamaların çekilmesi, bu uygulamalara
// nazaran route envanterinin karşılaştırılması ve route'larının yazılması, aynı zamanda
// uygulama trafiğinin de yanlarına işlenmesi."
//
// EKRANIN VARLIK SEBEBİ: SPA'yı bugüne kadar ADINDAN tanıyorduk (`-app-v` / `-app-emb-v`).
// Bu bir TAHMİN; kurala uymayan uygulama görünmez kalıyordu. Bu sayfa tahmini bırakıp canlı
// duruma bakar (kabinde nginx koşuyor mu) ve ikisi ARASINDAKİ FARKI öne çıkarır.
//
// ÜÇ KAYNAK, ÜÇ AYRI SORU — hiçbiri ötekini düzeltmez, fark bilgidir:
//   keşif         → kabinde gerçekten nginx var mı
//   route envanteri → bu route kayıtlı mı
//   Dynatrace     → uygulama istek alıyor mu
import { useCallback, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  nginxConsoleApi,
  type NgSpaCoverage,
  type NgSpaDiscovery,
  type NgSpaDiscoveryRow,
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

/** Trafik hücresi. ÜÇ DURUM AYRI: ölçülemedi ≠ istek yok ≠ ölçüm yok. */
function Trafik({ r }: { r: NgSpaDiscoveryRow }) {
  if (!r.usage)
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="Bu uygulama için Dynatrace ölçümü bulunamadı — “istek almıyor” DEMEK DEĞİL."
      >
        ölçüm yok
      </span>
    );
  if (!r.usage.measured)
    return (
      <span
        style={{ color: 'var(--status-warning)' }}
        title={`Ölçüm denendi ama düştü${r.usage.note ? ': ' + r.usage.note : ''}. “0 istek” anlamına GELMEZ.`}
      >
        ölçülemedi
      </span>
    );
  return (
    <span
      style={{ color: r.reqShown ? 'var(--text-primary)' : 'var(--status-warning)' }}
      title={`Dynatrace servis çağrıları · son ${r.usage.windowDays} gün · ${r.usage.services} servis · ölçüm ${r.usage.scanDate}`}
    >
      {nf(r.reqShown || 0)}
    </span>
  );
}

export default function NginxSpaDiscovery() {
  const [data, setData] = useState<NgSpaDiscovery | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('all');
  const [cluster, setCluster] = useState('all');
  // VARSAYILAN SUZGEC "kacanlar": sayfanin sebebi bu kume. Kullanici isterse hepsini acar.
  const [gorunum, setGorunum] = useState<'miss' | 'spa' | 'all' | 'false' | 'noinv' | 'unmatched'>(
    'miss',
  );

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

  const satirlar = useMemo(() => {
    const ara = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (env !== 'all' && (r.env || '') !== env) return false;
      if (cluster !== 'all' && r.cluster !== cluster) return false;
      if (gorunum === 'miss' && !r.patternMiss) return false;
      if (gorunum === 'spa' && !r.isSpa) return false;
      if (gorunum === 'false' && !r.patternFalse) return false;
      if (gorunum === 'noinv' && !(r.isSpa && !r.inInventory)) return false;
      if (gorunum === 'unmatched' && !r.note) return false;
      if (!ara) return true;
      return (
        r.application.toLowerCase().includes(ara) ||
        r.namespace.toLowerCase().includes(ara) ||
        r.host.toLowerCase().includes(ara) ||
        r.route.toLowerCase().includes(ara)
      );
    });
  }, [data, q, env, cluster, gorunum]);

  const csv = useCallback(() => {
    downloadCsv(
      'gercek_spa_kesfi',
      [
        'cluster',
        'namespace',
        'route',
        'host',
        'termination',
        'uygulama',
        'is_yuku_turu',
        'is_yuku',
        'ortam',
        'spa_mi',
        'sinyal',
        'imaj',
        'eslesme_kaniti',
        'tarama_tarihi',
        'ad_kalibina_uyuyor',
        'kalibin_kacirdigi',
        'envanterde_var',
        'istek',
        'olcum_penceresi_gun',
        'not',
      ],
      satirlar.map((r) => [
        r.cluster,
        r.namespace,
        r.route,
        r.host,
        r.termination,
        r.application,
        r.workloadKind,
        r.workload,
        r.env || '',
        r.isSpa ? 'evet' : 'hayır',
        r.signal,
        r.image,
        r.matchBy || '',
        r.scanDate || '',
        r.patternMatch ? 'evet' : 'hayır',
        r.patternMiss ? 'EVET' : '',
        r.inInventory ? 'evet' : 'hayır',
        // OLCULEMEYEN SATIRA 0 YAZILMAZ: elektronik tabloda toplanip "istek yok" okunurdu.
        r.reqShown == null ? '' : r.reqShown,
        r.usage?.windowDays ?? '',
        r.note,
      ]),
    );
  }, [satirlar]);

  const s = data?.summary;
  // HICBIR route ESLESMEDI: "SPA yok" DEGIL, "bakamadik". Ilk uretim kosusunda 4532 route'un
  // tamami eslesmesizdi (servis yetkisi) ve ekran yalnizca "0 SPA" diyordu.
  const hepsiEslesmesiz = !!s && s.routes > 0 && s.unmatched === s.routes;
  const kovalar = Object.entries(s?.unmatchedReasons || {}).sort((a, b) => b[1] - a[1]);
  // TARAMA EKSIGI: "kacirilan yok" cumlesi ancak tam taramada nitelemesiz soylenir.
  const cv = data?.coverage;
  const eksikTarama = [
    cv && cv.failed > 0 ? `${nf(cv.failed)} cluster taranamadı` : '',
    cv && cv.partial > 0 ? `${nf(cv.partial)} cluster kısmi tarandı` : '',
    cv && (cv.error || (!cv.measured && (s?.routes || 0) > 0)) ? 'cluster kapsamı bilinmiyor' : '',
    s && s.unmatched > 0 ? `${nf(s.unmatched)} route eşleşmedi` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const SELECT = 'px-2 py-1.5 text-xs border rounded-lg';
  const selStyle = { borderColor: 'var(--border)', background: 'var(--bg-surface)' };

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
          Keşif job'ının son sürümü bir kez koşunca bu ekran dolar.
        </div>
      )}

      {s && (
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-sm">
            Keşif <b>{nf(s.routes)}</b> route inceledi; <b>{nf(s.spa)}</b> tanesinin ardındaki
            kabinde <b>gerçekten nginx</b> koşuyor.{' '}
            {s.patternMiss > 0 ? (
              <b style={{ color: 'var(--status-danger)' }}>
                Bunların {nf(s.patternMiss)} tanesini ad kalıbı (-app-v / -app-emb-v) kaçırıyordu.
              </b>
            ) : hepsiEslesmesiz ? null : eksikTarama ? (
              <>Taranabilen kısımda ad kalıbının kaçırdığı uygulama yok ({eksikTarama}).</>
            ) : (
              <>
                Ad kalıbının kaçırdığı uygulama <b>yok</b>.
              </>
            )}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {s.patternFalse > 0 && (
              <>
                {nf(s.patternFalse)} uygulama ada göre SPA görünüyor ama kabinde nginx <b>yok</b>
                .{' '}
              </>
            )}
            {s.spaNotInInventory > 0 && (
              <>
                {nf(s.spaNotInInventory)} SPA route'u <b>route envanterinde yok</b>.{' '}
              </>
            )}
            {s.unmatched > 0 && (
              <>
                {nf(s.unmatched)} route'ta iş yükü eşleşmedi
                {kovalar.length > 0
                  ? ` (${kovalar.map(([k, v]) => `${k}: ${nf(v)}`).join(' · ')})`
                  : ''}
                .{' '}
              </>
            )}
            {(s.byMatch?.ad || 0) > 0 && (
              <>
                {nf(s.byMatch?.ad || 0)} route servis okunamadığı için <b>ad eşleşmesiyle</b>{' '}
                bağlandı (daha zayıf kanıt).{' '}
              </>
            )}
            Sinyal kırılımı:{' '}
            {Object.entries(s.bySignal)
              .map(([k, v]) => `${k}=${nf(v)}`)
              .join(' · ') || '—'}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Trafik: {nf(s.trafficActive)} istek alıyor · {nf(s.trafficIdle)} istek yok ·{' '}
            {nf(s.trafficUnmeasured)} ölçülemedi · {nf(s.trafficNone)} ölçüm yok
            {data?.scanDate ? ` · keşif ${data.scanDate}` : ''}
          </div>
          {data?.coverage && (
            <div className="mt-2">
              <Kapsam k={data.coverage} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={gorunum}
          onChange={(e) => setGorunum(e.target.value as typeof gorunum)}
          className={SELECT}
          style={selStyle}
        >
          {/* SAYILAR SECENEKTE: bos bir gorunumun BOS oldugu acmadan gorunsun. */}
          <option value="miss">kalıbın KAÇIRDIKLARI{s ? ` (${nf(s.patternMiss)})` : ''}</option>
          <option value="spa">gerçek SPA'ların hepsi{s ? ` (${nf(s.spa)})` : ''}</option>
          <option value="false">
            ada göre SPA ama nginx yok{s ? ` (${nf(s.patternFalse)})` : ''}
          </option>
          <option value="noinv">
            SPA ama envanterde yok{s ? ` (${nf(s.spaNotInInventory)})` : ''}
          </option>
          <option value="unmatched">eşleşmeyen route'lar{s ? ` (${nf(s.unmatched)})` : ''}</option>
          <option value="all">hepsi{s ? ` (${nf(s.routes)})` : ''}</option>
        </select>
        <select
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          className={SELECT}
          style={selStyle}
        >
          <option value="all">tüm ortamlar</option>
          {(data?.envs || []).map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className={SELECT}
          style={selStyle}
        >
          <option value="all">tüm cluster'lar</option>
          {(data?.clusters || []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="relative">
          <MagnifyingGlassIcon
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uygulama, namespace, route ya da adres"
            className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-64"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {nf(satirlar.length)} satır
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
                'Route / Adres',
                'SPA?',
                'Ad kalıbı',
                'Envanter',
                'İstek',
                'İş yükü',
                'Cluster',
              ].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r, i) => (
              <tr
                key={`${r.cluster}|${r.namespace}|${r.route}|${i}`}
                className="border-t"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <td className="px-2 py-1 font-mono font-medium">
                  {r.application}
                  {r.patternMiss && (
                    <span
                      className="ml-1.5 text-[9px] px-1 rounded"
                      style={{ background: 'var(--status-danger)', color: 'white' }}
                      title="Gerçekten SPA ama ad kalıbına uymuyor — eski yöntem bunu kaçırıyordu."
                    >
                      KALIP KAÇIRDI
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {r.namespace}
                  <span
                    className="ml-1 text-[10px] uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {r.env || ''}
                  </span>
                </td>
                <td className="px-2 py-1 font-mono text-[11px] break-all">
                  {r.host || r.route}
                  {r.termination && (
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {r.termination}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {r.note ? (
                    <span style={{ color: 'var(--text-muted)' }} title={r.note}>
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 inline" /> eşleşmedi
                    </span>
                  ) : r.isSpa ? (
                    <span
                      style={{ color: 'var(--status-success)', fontWeight: 600 }}
                      title={`Kanıt: ${r.signal}${r.image ? ` · ${r.image}` : ''}`}
                    >
                      evet
                      <span
                        className="ml-1 text-[10px] font-normal"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {r.signal}
                      </span>
                      {r.matchBy === 'ad' && (
                        <span
                          className="ml-1 text-[9px] px-1 rounded font-normal"
                          style={{
                            border: '1px solid var(--status-warning)',
                            color: 'var(--status-warning)',
                          }}
                          title="Servis okunamadı (yetki); route, servisle AYNI ADI taşıyan iş yüküne bağlandı. Selector eşleşmesinden zayıf bir kanıt."
                        >
                          ad eşleşmesi
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>hayır</span>
                  )}
                </td>
                <td
                  className="px-2 py-1"
                  style={{
                    color: r.patternFalse ? 'var(--status-warning)' : 'var(--text-secondary)',
                  }}
                >
                  {r.patternMatch ? 'uyuyor' : 'uymuyor'}
                </td>
                <td
                  className="px-2 py-1"
                  style={{
                    color:
                      r.isSpa && !r.inInventory ? 'var(--status-warning)' : 'var(--text-secondary)',
                  }}
                >
                  {r.inInventory ? 'var' : 'yok'}
                </td>
                <td className="px-2 py-1 tabular-nums">
                  <Trafik r={r} />
                </td>
                <td className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {r.workloadKind ? `${r.workloadKind} · ${r.workload}` : '—'}
                </td>
                <td className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {r.cluster}
                  {/* ESKI VERI: bu cluster son kosuda taranamadi, satir onceki taramadan. */}
                  {r.scanDate && data?.scanDate && r.scanDate < data.scanDate && (
                    <span
                      className="ml-1 text-[10px]"
                      style={{ color: 'var(--status-warning)' }}
                      title="Bu cluster son koşuda taranamadı; satır önceki taramadan."
                    >
                      {r.scanDate}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={9} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
                  {/* BOS GORUNUM SEBEBINI SOYLER: varsayilan gorunum "kacanlar"; keşif hic SPA
                      bulamadiysa ekran "veri yok" gibi gorunuyordu (2026-10-01). */}
                  {data?.rows?.length ? (
                    <>
                      Bu görünümde satır yok; keşifte toplam {nf(data.rows.length)} satır var.{' '}
                      {(['spa', 'unmatched', 'all'] as const)
                        .filter((g) => g !== gorunum)
                        .map((g) => (
                          <button
                            key={g}
                            onClick={() => setGorunum(g)}
                            className="ml-1 px-1.5 py-0.5 text-[11px] border rounded"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            {g === 'spa'
                              ? `gerçek SPA'lar (${nf(s?.spa || 0)})`
                              : g === 'unmatched'
                                ? `eşleşmeyenler (${nf(s?.unmatched || 0)})`
                                : `hepsi (${nf(s?.routes || 0)})`}
                          </button>
                        ))}
                    </>
                  ) : (
                    'Bu süzgeçlerle satır yok.'
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
