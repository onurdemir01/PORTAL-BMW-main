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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await denetimApi.routeTraffic(fresh);
      if (r.ok) {
        setData(r);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const envs = useMemo(() => {
    const s = new Set<string>();
    for (const r of data?.rows || []) if (r.env) s.add(r.env);
    return [...s].sort();
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (env !== 'all' && (r.env || '') !== env) return false;
      if (kind === 'spa' && !r.spa) return false;
      if (kind === 'nonspa' && r.spa) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (routeFilter === 'with' && !r.routes.length) return false;
      if (routeFilter === 'without' && r.routes.length) return false;
      if (
        needle &&
        !(
          r.namespace.toLowerCase().includes(needle) ||
          r.application.toLowerCase().includes(needle) ||
          r.routes.some(
            (x) =>
              x.route.toLowerCase().includes(needle) || x.address.toLowerCase().includes(needle),
          )
        )
      )
        return false;
      return true;
    });
  }, [data, q, env, kind, status, routeFilter]);

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

      {/* KOR NOKTA GORUNUR OLSUN: envanterdeki her route bir uygulamaya baglanamaz
          (route "apigw", uygulamalar "apigw-1-prod"...). Sayiyi yazmazsak "hepsini gordum"
          yanilgisi olusur. */}
      {s.routesWithoutUsage > 0 && (
        <Note tone="info">
          Dynatrace <b>{nf(s.apps)}</b> uygulama ölçtü. Envanterdeki{' '}
          <b>{nf(s.routesWithoutUsage)}</b> route hiçbir uygulamaya bağlanamadı — adı eşleşmeyenler
          ya da Dynatrace&apos;in hiç görmediği route&apos;lar. Bu ekran <b>uygulama</b> bazlıdır:
          route&apos;u olmayan backend&apos;ler de listede vardır ({nf(s.routeless)} satır).
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="uygulama"
          value={nf(s.apps)}
          hint={`Dynatrace ölçümü · son tarama ${data.latestScan ? fmtDate(data.latestScan) : '—'}`}
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
          label="route'u yok"
          value={nf(s.routeless)}
          hint="dışarıya açık adresi olmayan uygulamalar — eski route bazlı ekranın göremediği küme"
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
          {nf(rows.length)} / {nf(data.rows.length)} uygulama
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() =>
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
                rows.map((r) => [
                  r.namespace,
                  r.application,
                  r.env || '',
                  r.spa ? 'evet' : 'hayır',
                  r.cluster,
                  STATUS[r.status].label,
                  // OLCULEMEYEN SATIRA 0 YAZILMAZ: CSV'de de "ölçülemedi" ile "istek yok"
                  // ayri kalmali, yoksa elektronik tabloda toplanip yanlis okunur.
                  r.reqShown == null ? '' : r.reqShown,
                  r.windowDays,
                  r.services,
                  r.servicesMeasured,
                  r.servicesSkipped,
                  r.routes.map((x) => x.route).join(' '),
                  r.routes.map((x) => x.address).join(' '),
                  r.scanDate,
                  r.note,
                ]),
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
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
            <TableEmptyRow
              colSpan={8}
              title={
                data.rows.length ? 'Süzgeçle eşleşen uygulama yok.' : 'Henüz kullanım verisi yok.'
              }
              description={
                data.rows.length
                  ? undefined
                  : 'application_usage job’ı bir kez koşunca burası dolar.'
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
                    <div className="font-medium truncate max-w-[18rem]" title={r.application}>
                      {r.application}
                    </div>
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
                    {r.routes.length === 0 ? (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                        title="Envanterde bu uygulamaya bağlanan route yok — servisten servise çağrılan bir backend olabilir."
                      >
                        yok
                      </span>
                    ) : (
                      <div
                        className="text-[10px] font-mono truncate max-w-[18rem]"
                        title={r.routes.map((x) => x.address || x.route).join('\n')}
                      >
                        {r.routes[0].address || r.routes[0].route}
                        {r.routes.length > 1 && (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' '}
                            +{r.routes.length - 1}
                          </span>
                        )}
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
