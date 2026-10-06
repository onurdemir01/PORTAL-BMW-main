// src/components/denetim/RouteTraffic.tsx — "Denetim > Route Trafiği".
//
// Kullanici: "SPA uygulamalari var ama kullaniliyor mu? atil mi, emekli mi olmus?"
//
// 2026-09-30'DA BIRIM DEGISTI: ekran ROUTE bazliydi, artik UYGULAMA bazli.
// Kullanici: "Prometheus'tan cektigimiz metrikler calismiyor. Orayi bos ver. Biz sadece
// application usage playbook'unu kullanalim ve Dynatrace metriklerine bakalim. Hata
// oranlarini bos ver."
//
// Kaynak: application_usage job'i (Dynatrace servis istekleri) -> BMW_Application_Usage;
// siniflama sunucuda (server/audit/app-traffic.cjs). Burasi yalnizca gosterir/suzer.
//
// KALDIRILAN KOLONLAR: 7/30/90 gun, gun/ort, 4xx, 5xx, son istek. Hepsi Thanos
// kirilimiydi; Dynatrace vermiyor. Bos kolon gostermek yerine kaldirildi.
import React, { useCallback, useEffect, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  SignalIcon,
  QuestionMarkCircleIcon,
  MoonIcon,
} from '@heroicons/react/24/outline';
import {
  denetimApi,
  type AppTrafficResult,
  type AppTrafficRow,
  type AppTrafficStatus,
} from '@/api/denetimApi';
import { Select } from '@/components/ui/Form';
import { fmtNumber, fmtDate } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { StatTile, Pill, TableShell, Th, Td, Note, type Tone } from '@/components/denetim/ui';
import { downloadCsv as csvDownload } from '@/utils/csv';

const nf = (n: number) => fmtNumber(n);

// UC DURUM, IKI DEGIL. "olculemedi" ile "istek yok" ayni sey degildir: olcemedigimiz bir
// uygulamayi emekli aday saymak, bu ekranin verebilecegi en pahali yanlis karardir.
const STATUS: Record<
  AppTrafficStatus,
  { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  active: {
    label: 'aktif',
    tone: 'success',
    icon: SignalIcon,
    hint: 'ölçüm penceresinde istek aldı',
  },
  idle: {
    label: 'istek yok',
    tone: 'warning',
    icon: MoonIcon,
    hint: 'ölçüldü ve pencerede hiç istek almadı — atıl/emekli adayı',
  },
  unmeasured: {
    label: 'ölçülemedi',
    tone: 'neutral',
    icon: QuestionMarkCircleIcon,
    hint: 'ölçüm denendi ama düştü — "istek almıyor" ANLAMINA GELMEZ',
  },
  // ESLESMEDI, OLCULMEDI DEGIL (kullanici 2026-10-06): envanterde route var ama hicbir
  // Dynatrace uygulamasina baglanamadi. Satir GIZLENMEZ; "istek yok" ile ayni kovaya
  // konmasi, hic olculmemis bir route'u emekli aday gosterirdi.
  unmatched: {
    label: 'eşleşmedi',
    tone: 'neutral',
    icon: QuestionMarkCircleIcon,
    hint: 'route envanterde var ama Dynatrace karşılığı bulunamadı — ölçüm YAPILMADI, "istek yok" DEĞİL',
  },
};

/**
 * Istek hucresi.
 *
 * Sayi YALNIZ olculduyse yazilir. Olculemeyen satira "0" yazmak, calisan bir uygulamayi
 * "kullanilmiyor" diye okutur.
 */
function istek(r: AppTrafficRow) {
  if (r.reqShown == null) {
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title={`Ölçüm denendi ama düştü${r.note ? ': ' + r.note : ''}. "0 istek" anlamına GELMEZ.`}
      >
        ölçülemedi
      </span>
    );
  }
  return (
    <span
      style={{ color: r.reqShown ? 'var(--text-primary)' : 'var(--status-warning)' }}
      title={`Dynatrace servis çağrıları · son ${r.windowDays} gün · ${r.servicesMeasured}/${r.services} servis ölçüldü${
        r.servicesSkipped
          ? ` (${r.servicesSkipped} tanesi yalnızca altyapı servisi çağırdığı için sayılmadı)`
          : ''
      } · ölçüm ${r.scanDate}`}
    >
      {nf(r.reqShown)}
    </span>
  );
}

export default function RouteTraffic() {
  const [data, setData] = useState<AppTrafficResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('all');
  const [kind, setKind] = useState<'all' | 'spa' | 'nonspa'>('all');
  const [status, setStatus] = useState<'all' | AppTrafficStatus>('all');
  const [routeFilter, setRouteFilter] = useState<'all' | 'with' | 'without'>('all');

  // SUZGECLER SUNUCUDA UYGULANIR (2026-09-30). Kullanici: "sayfa dondu ve hicbir sey
  // yuklenmiyor". Olculdu: 70.059 uygulama = 20,9 MB JSON ve 70.059 x 8 hucre DOM;
  // yanit 8 MB'lik onbellek tavanini da astigi icin her acilis bastan hesaplaniyordu.
  // Artik sunucu suzer ve tavana kadar kirpar; ozet TUM kumeden gelir.
  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      try {
        const r = await denetimApi.routeTraffic({ q, env, kind, status, routes: routeFilter }, fresh);
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [q, env, kind, status, routeFilter],
  );

  // SUZGEC DEGISIMI GECIKMELI: her tus vurusunda sunucuya gitmek, 70.000 satirlik
  // kumeyi tekrar tekrar suzdururdu. Onbellek 60 sn oldugu icin ayni bilesim ikinci
  // kez aninda doner.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 300);
    return () => window.clearTimeout(t);
  }, [load]);

  const envs = data?.envs || [];
  const rows = data?.rows || [];

  // CSV TUM SUZGEC SONUCUNU indirir, ekrandaki kirpilmis listeyi DEGIL. Kirpilmis
  // listeyi CSV'ye yazmak, elektronik tabloda "bu kadar uygulama var" diye okunurdu.
  const [csvBusy, setCsvBusy] = useState(false);
  const csvIndir = useCallback(async () => {
    setCsvBusy(true);
    try {
      const r = await denetimApi.routeTraffic({
        q,
        env,
        kind,
        status,
        routes: routeFilter,
        limit: 100000,
      });
      csvDownload(
        'uygulama_trafigi',
        [
          'namespace',
          'uygulama',
          'ortam',
          'spa',
          'cluster',
          'durum',
          'istek',
          'pencere_gun',
          'servis',
          'servis_olculen',
          'servis_atlanan',
          'route',
          'adres',
          'olcum_tarihi',
          'not',
        ],
        (r.rows || []).map((x) => [
          x.namespace,
          x.application,
          x.env || '',
          x.spa ? 'evet' : 'hayır',
          x.cluster,
          STATUS[x.status].label,
          // OLCULEMEYEN SATIRA 0 YAZILMAZ: CSV'de de "ölçülemedi" ile "istek yok"
          // ayri kalmali, yoksa elektronik tabloda toplanip yanlis okunur.
          x.reqShown == null ? '' : x.reqShown,
          x.windowDays,
          x.services,
          x.servicesMeasured,
          x.servicesSkipped,
          x.route || '',
          x.address || '',
          x.apps.join(' '),
          x.scanDate,
          x.note,
        ]),
      );
    } catch {
      /* indirme hatasi ekranin geri kalanini bozmaz */
    } finally {
      setCsvBusy(false);
    }
  }, [q, env, kind, status, routeFilter]);

  if (loading && !data) return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-3">
      {data.tableMissing && <Note tone="warning">{data.message}</Note>}

      {/* KIRPMA SESSIZ OLMAZ: ekran 1.000 satir gosterip 70.059 uygulamalik bir kumeyi
          "hepsi bu" gibi okutamaz. Kullanici suzgeci daraltarak ya da CSV ile tamamina
          ulasir. */}
      {data.truncated && (
        <Note tone="info">
          Süzgece <b>{nf(data.totalMatched)}</b> uygulama uyuyor; ekranda <b>ilk {nf(data.limit)}</b>{' '}
          gösteriliyor (istek sayısına göre azalan). Tamamı için süzgeci daraltın ya da{' '}
          <b>CSV</b> indirin — CSV süzgece uyan <b>tüm</b> satırları yazar.
        </Note>
      )}

      {/* KOR NOKTA GORUNUR OLSUN: envanterdeki her route bir uygulamaya baglanamaz
          (route "apigw", uygulamalar "apigw-1-prod"...). Sayiyi yazmazsak "hepsini gordum"
          yanilgisi olusur. */}
      {(s.unmatched > 0 || s.routeless > 0) && (
        <Note tone="info">
          Bu ekran <b>route</b> bazlıdır: her satır bir route&apos;tur.{' '}
          {s.unmatched > 0 && (
            <>
              <b>{nf(s.unmatched)}</b> route hiçbir uygulamaya bağlanamadı (&quot;eşleşmedi&quot;) —
              adı eşleşmeyenler ya da Dynatrace&apos;in hiç görmediği route&apos;lar. Bunlar{' '}
              <b>gizlenmez</b>, çünkü eşleşmemek ölçülüp istek almamakla aynı şey değildir.{' '}
            </>
          )}
          {s.routeless > 0 && (
            <>
              Ayrıca <b>{nf(s.routeless)}</b> uygulamanın dışarıya açık route&apos;u yok; onlar da
              listede durur (servisten servise çağrılan backend&apos;ler).{' '}
            </>
          )}
          <b>İstek</b> kolonu Dynatrace&apos;in <b>uygulama</b> ölçümüdür: bir uygulamanın birden
          çok route&apos;u varsa aynı sayı her satırda görünür (satırda &quot;paylaşık&quot; yazar).
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatTile
          label="route"
          value={nf(s.routes)}
          hint={`envanterdeki route sayısı · ${nf(s.apps)} uygulama ölçüldü · son tarama ${
            data.latestScan ? fmtDate(data.latestScan) : '—'
          }`}
        />
        <StatTile
          label="aktif"
          value={nf(s.active)}
          tone="success"
          icon={SignalIcon}
          hint={STATUS.active.hint}
        />
        <StatTile
          label="istek yok"
          value={nf(s.idle)}
          tone="warning"
          icon={MoonIcon}
          hint={STATUS.idle.hint}
        />
        <StatTile
          label="ölçülemedi"
          value={nf(s.unmeasured)}
          tone={s.unmeasured ? 'warning' : 'neutral'}
          icon={QuestionMarkCircleIcon}
          hint={STATUS.unmeasured.hint}
        />
        <StatTile
          label="eşleşmedi"
          value={nf(s.unmatched)}
          tone={s.unmatched ? 'warning' : 'neutral'}
          hint="envanterde route var ama hiçbir Dynatrace uygulamasına bağlanamadı — ölçülmedi demek, istek yok demek DEĞİL"
        />
        <StatTile
          label="route'u yok"
          value={nf(s.routeless)}
          hint="dışarıya açık adresi olmayan uygulamalar — route bazlı listenin göremediği küme"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="namespace, uygulama, route ya da adres"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-72"
          />
        </div>
        <Select sizeVariant="sm" value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="all">tüm ortamlar</option>
          {envs.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
        <Select
          sizeVariant="sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="all">SPA + diğer</option>
          <option value="spa">sadece SPA</option>
          <option value="nonspa">SPA olmayan</option>
        </Select>
        <Select
          sizeVariant="sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">tüm durumlar</option>
          <option value="idle">istek yok (atıl aday)</option>
          <option value="active">aktif</option>
          <option value="unmeasured">ölçülemedi</option>
        </Select>
        <Select
          sizeVariant="sm"
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value as typeof routeFilter)}
        >
          <option value="all">route farkı yok</option>
          <option value="with">route&apos;u olanlar</option>
          <option value="without">route&apos;u olmayanlar</option>
        </Select>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {nf(rows.length)} / {nf(data.totalMatched)} uygulama
          {data.totalMatched !== data.total && <> (toplam {nf(data.total)})</>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void csvIndir()}
            disabled={csvBusy}
            title="Süzgece uyan TÜM satırlar indirilir (ekrandaki kırpılmış liste değil)."
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> {csvBusy ? 'CSV…' : 'CSV'}
          </button>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      <TableShell maxHeight="40rem">
        <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
          <tr>
            <Th>Namespace</Th>
            <Th>Uygulama</Th>
            <Th>Ortam</Th>
            <Th>Durum</Th>
            <Th align="right">İstek</Th>
            <Th align="right">Servis</Th>
            <Th>Route</Th>
            <Th>Cluster</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            // SUZGEC ARTIK SUNUCUDA: bos liste "veri yok" DEMEK DEGIL. Karar
            // `data.total`a bakar (olculen tum uygulama sayisi); `rows` zaten
            // suzulmus ve kirpilmis geldigi icin ona bakmak, suzgece uymayan her
            // aramayi "job hic kosmamis" gibi okuturdu.
            <TableEmptyRow
              colSpan={8}
              title={data.total ? 'Süzgeçle eşleşen uygulama yok.' : 'Henüz kullanım verisi yok.'}
              description={
                data.total ? undefined : 'application_usage job’ı bir kez koşunca burası dolar.'
              }
            />
          ) : (
            rows.map((r: AppTrafficRow) => {
              const st = STATUS[r.status];
              return (
                <tr
                  key={r.namespace + '|' + r.application}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <Td>
                    <span className="font-mono text-[11px]">{r.namespace}</span>
                  </Td>
                  <Td>
                    {r.application ? (
                      <div
                        className="font-medium truncate max-w-[16rem]"
                        title={r.apps.length > 1 ? r.apps.join(', ') : r.application}
                      >
                        {r.application}
                        {r.appCount > 1 && (
                          <span style={{ color: 'var(--text-muted)' }}> +{r.appCount - 1}</span>
                        )}
                      </div>
                    ) : (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                        title="Bu route hiçbir Dynatrace uygulamasına bağlanamadı. ÖLÇÜLMEDİ demektir; istek almadığı anlamına GELMEZ."
                      >
                        eşleşmedi
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="uppercase text-[10px] font-semibold">{r.env || '—'}</span>
                    {r.spa && (
                      <span
                        className="ml-1 text-[10px] px-1 rounded border"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                      >
                        SPA
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Pill tone={st.tone} icon={st.icon} title={st.hint}>
                      {st.label}
                    </Pill>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {istek(r)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    <span
                      title={`${r.servicesMeasured} servis ölçüldü, ${r.servicesSkipped} tanesi sayılmadı`}
                    >
                      {nf(r.servicesMeasured)}
                      {r.servicesSkipped > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}> +{nf(r.servicesSkipped)}</span>
                      )}
                    </span>
                  </Td>
                  <Td>
                    {r.kind === 'app' ? (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                        title="Bu uygulamanın dışarıya açık route'u yok — servisten servise çağrılan bir backend olabilir."
                      >
                        route yok
                      </span>
                    ) : (
                      <div
                        className="text-[10px] font-mono truncate max-w-[18rem]"
                        title={[r.route, r.address].filter(Boolean).join('\n')}
                      >
                        {r.address || r.route}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {r.cluster || '—'}
                    </span>
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableShell>

      <p className="text-[11px] max-w-4xl" style={{ color: 'var(--text-muted)' }}>
        Sayılar Dynatrace&apos;in uygulama başına <b>servis isteği</b> ölçümünden gelir
        (application_usage job&apos;ı, pencere {data.rows[0]?.windowDays || 7} gün) — OCP
        router&apos;ından değil. Bu yüzden route&apos;u olmayan backend&apos;ler de görünür.
        &quot;İstek yok&quot; ölçülmüş bir sıfırdır; &quot;ölçülemedi&quot; ise hüküm değildir —
        emeklilik kararında ikisini karıştırmayın.
      </p>
    </div>
  );
}
