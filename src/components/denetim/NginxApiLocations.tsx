// src/components/denetim/NginxApiLocations.tsx — "Nginx API Envanteri > API Bazlı".
//
// Konfigürasyon karşılaştırma görünümü "dosya her yerde aynı mı" sorusunu cevaplar.
// Bu görünüm farklı bir soruyu cevaplar: "ŞU API hangi ortamda, hangi sunucularda var?"
//
// Rate limit farkı iki ayrı şeydir ve ayrı işaretlenir:
//   · sunucu farkı — AYNI ortamdaki sunucular farklı limit taşıyor → genelde hata
//   · ortam farkı  — ortamlar arası limit farkı → kasıtlı olabilir (test 50, prod 300)
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxApiLocationsResult,
  type NginxApiLocationRow,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, TableShell, Th, Td, Note } from './ui';
import { API_CLUSTERS, clusterCoverage } from '../../../shared/nginxApiClusters.cjs';
import { downloadCsv as csvDownload } from '@/utils/csv';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);


export function NginxApiLocations() {
  const [data, setData] = useState<NginxApiLocationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [envFilter, setEnvFilter] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxApiLocations();
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

  // ILK YUKLEME EFFECT ICINDE: istek BURADA kurulur, `load()` cagrilmaz.
  //
  // NEDEN: `load` ilk isi olarak `setLoading(true)` cagiriyor ve React 19'un
  // `set-state-in-effect` kurali, effect'ten cagrilan bir fonksiyonun ICINDEKI
  // setState'i de "effect'te senkron" sayiyor — `setLoading(true)`'yu cikarmak
  // BILE yetmiyor (olculdu). Burada ilk ifade `await`, yani hicbir setState
  // senkron degil. `loading` zaten `true` basladigi icin ilk yuklemede bayragi
  // ayrica kaldirmaya gerek de yok.
  //
  // `alive` bayragi ayri bir kazanc: sekme yanit gelmeden kapanirsa cozulmus
  // istegin sonucu artik olmayan bir bilesene yazilmaz.
  // `load` KALIYOR: Yenile dugmesi onu cagiriyor ve olay isleyicisinde
  // setState tamamen mesru.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await denetimApi.nginxApiLocations();
        if (!alive) return;
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ARAMA ERTELENIR (2026-09-23): her tus vurusunda binlerce satir yeniden suzulup
  // ciziliyordu; useDeferredValue ile yazma akici kalir, liste bir tik geriden gelir.
  const qDeferred = useDeferredValue(q);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = qDeferred.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (needle && !`${r.location} ${r.config}`.toLowerCase().includes(needle)) return false;
      if (envFilter && !r.presentEnvs.includes(envFilter)) return false;
      if (onlyProblem && !(r.limitDrift || r.envLimitDrift || r.missingEnvs.length > 0))
        return false;
      return true;
    });
  }, [data, qDeferred, envFilter, onlyProblem]);

  // KUME KAPSAMI SATIR BASINA BIR KEZ (2026-09-23): eskiden her cizimde, her satir icin
  // yeniden hesaplaniyordu (suzgec degisince de). Artik yalnizca VERI degisince hesaplanir.
  const coverageByRow = useMemo(() => {
    const m = new Map<string, ReturnType<typeof clusterCoverage>>();
    for (const r of data?.rows || []) {
      const hosts: string[] = [];
      for (const e of r.presentEnvs) for (const h of r.envs[e]?.hosts || []) hosts.push(h);
      m.set(`${r.config}|${r.location}`, clusterCoverage(hosts));
    }
    return m;
  }, [data]);

  // Cok satirda tarayici zorlaniyor: once ilk dilim cizilir, kullanici isterse buyutur.
  const [limit, setLimit] = useState(300);
  useEffect(() => {
    setLimit(300);
  }, [qDeferred, envFilter, onlyProblem]);

  if (loading && !data)
    return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data) return null;
  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz tarama kaydı yok">
        <code className="font-mono">nginx_ratelimit_inventory</code> job&apos;ı çalıştıktan sonra
        burası dolacak.
      </Note>
    );
  }

  const envs = data.envs;
  const driftCount = data.rows.filter((r) => r.limitDrift).length;
  const envDriftCount = data.rows.filter((r) => r.envLimitDrift).length;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu tablo nasıl okunur?">
        Her satır <b>tek bir API yolu</b>dur (location). Hücredeki sayı, o yolun o ortamda kaç
        sunucuda bulunduğudur; <b>—</b> o ortamda hiç bulunmadığı anlamına gelir. Bir satıra
        tıklayınca sunucu adları, o ortamdaki rate limit değerleri ve <b>sunucu kümesi kırılımı</b>
        (mblcustomers / customers / mcustomers — hangi gateway&apos;de var, hangisinde yok) açılır.
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Pill tone="danger">sunucu farkı</Pill>
          <span>aynı ortamdaki sunucular farklı limit taşıyor ·</span>
          <Pill tone="warning">ortam farkı</Pill>
          <span>ortamlar arası limit farkı (kasıtlı olabilir)</span>
        </div>
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="API yolu (location)" value={nf(data.rows.length)} tone="accent" />
        <StatTile label="ortam" value={nf(envs.length)} hint={envs.join(', ')} />
        <StatTile
          label="sunucu farkı olan"
          value={nf(driftCount)}
          tone={driftCount ? 'danger' : 'neutral'}
          hint="Aynı ortamdaki sunucular farklı rate limit taşıyor"
        />
        <StatTile
          label="ortam farkı olan"
          value={nf(envDriftCount)}
          tone={envDriftCount ? 'warning' : 'neutral'}
          hint="Ortamlar arası rate limit farkı"
        />
      </div>

      <Panel
        title="API bazlı dağılım"
        description={`${nf(Math.min(rows.length, limit))} / ${nf(rows.length)} yol gösteriliyor · tarama ${data.scanDate}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
            >
              <option value="">tüm ortamlar</option>
              {envs.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="yol ya da dosya ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-52"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={onlyProblem}
                onChange={(e) => setOnlyProblem(e.target.checked)}
              />
              Sadece bulgular
            </label>
            <button
              onClick={() =>
                csvDownload(
                  'nginx_api_bazli',
                  [
                    'konfigurasyon',
                    'yol',
                    ...envs,
                    ...API_CLUSTERS.map((c) => c.label + '_var'),
                    ...API_CLUSTERS.map((c) => c.label + '_eksik'),
                    'eksik_ortam',
                    'sunucu_farki',
                    'ortam_farki',
                  ],
                  rows.map((r) => {
                    const cov = coverageByRow.get(`${r.config}|${r.location}`);
                    const covRows = cov ? cov.rows : [];
                    return [
                    r.config,
                    r.location,
                    ...envs.map((e) => (r.envs[e] ? r.envs[e].hosts.join(' ') : '')),
                    ...covRows.map((c) => `${c.present.length}/${c.cluster.hosts.length}`),
                    ...covRows.map((c) => c.missing.join(' ')),
                    r.missingEnvs.join(' '),
                    r.limitDrift ? 'EVET' : '',
                    r.envLimitDrift ? 'EVET' : '',
                    ];
                  }),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
            </button>
          </div>
        }
        dense
      >
        <TableShell maxHeight="34rem">
          <thead>
            <tr>
              <Th>API yolu</Th>
              <Th>Dosya</Th>
              <Th>Sunucu kümeleri</Th>
              {envs.map((e) => (
                <Th key={e} align="right">
                  {e}
                </Th>
              ))}
              <Th>Bulgu</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const key = `${r.config}|${r.location}`;
              return (
                <LocationRow
                  key={key}
                  rowKey={key}
                  row={r}
                  envs={envs}
                  coverage={coverageByRow.get(key)}
                  open={open === key}
                  onToggle={setOpen}
                />
              );
            })}
            {rows.length > limit && (
              <tr>
                <td colSpan={envs.length + 4} className="p-0">
                  <button
                    onClick={() => setLimit((n) => n + 500)}
                    className="w-full px-3 py-2 text-xs border-t hover:bg-[var(--bg-elevated)]"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
                  >
                    {nf(rows.length - limit)} satır daha var — devamını göster
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </TableShell>
      </Panel>
    </div>
  );
}

const LocationRow = React.memo(function LocationRow({
  row,
  rowKey,
  envs,
  coverage,
  open,
  onToggle,
}: {
  row: NginxApiLocationRow;
  rowKey: string;
  envs: string[];
  coverage?: ReturnType<typeof clusterCoverage>;
  open: boolean;
  onToggle: (key: string | null) => void;
}) {
  // Kume kapsami ust bilesende, VERI BASINA BIR KEZ hesaplanir (bkz. coverageByRow).
  const rowsCov = coverage ? coverage.rows : [];

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[var(--bg-elevated)]/60"
        onClick={() => onToggle(open ? null : rowKey)}
      >
        <Td className="font-mono whitespace-nowrap" title={row.location}>
          {row.location}
        </Td>
        <Td className="font-mono text-[11px] whitespace-nowrap" title={row.config}>
          {row.config}
        </Td>
        <Td>
          <span className="flex flex-wrap gap-1">
            {rowsCov.map(({ cluster, present }) => {
              const tone = present.length === 0
                ? 'neutral'
                : present.length === cluster.hosts.length
                  ? 'success'
                  : 'warning';
              return (
                <Pill key={cluster.key} tone={tone}>
                  {cluster.label} {present.length}/{cluster.hosts.length}
                </Pill>
              );
            })}
          </span>
        </Td>
        {envs.map((e) => {
          const cell = row.envs[e];
          if (!cell)
            return (
              <Td key={e} align="right" className="text-[var(--text-muted)]" title="bu ortamda yok">
                —
              </Td>
            );
          return (
            <Td key={e} align="right" className="tabular-nums" title={cell.hosts.join(', ')}>
              {cell.hosts.length}
            </Td>
          );
        })}
        <Td>
          <span className="flex flex-wrap gap-1">
            {row.missingEnvs.length > 0 && (
              <Pill tone="info">eksik: {row.missingEnvs.join(', ')}</Pill>
            )}
            {row.limitDrift && <Pill tone="danger">sunucu farkı</Pill>}
            {row.envLimitDrift && <Pill tone="warning">ortam farkı</Pill>}
          </span>
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={envs.length + 4} className="p-0">
            <div
              className="px-4 py-3 border-t"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="mb-3">
                <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Sunucu kümeleri — bu API hangi gateway&apos;lerde var, hangilerinde yok?
                </div>
                <div className="space-y-1.5">
                  {rowsCov.map(({ cluster, present, missing }) => (
                    <div key={cluster.key} className="flex flex-wrap items-start gap-2 text-[11px]">
                      <span
                        className="w-28 shrink-0 font-semibold"
                        style={{ color: 'var(--text-secondary)' }}
                        title={`${cluster.label} kümesi: ${cluster.hosts.join(', ')}`}
                      >
                        {cluster.label}
                      </span>
                      <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {present.length}/{cluster.hosts.length}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {present.length === 0 ? (
                          <Pill tone="neutral">hiçbir sunucuda yok</Pill>
                        ) : (
                          present.map((h) => (
                            <span
                              key={h}
                              className="px-1.5 py-0.5 rounded font-mono"
                              style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)' }}
                              title="bu sunucuda VAR"
                            >
                              {h.toLowerCase()}
                            </span>
                          ))
                        )}
                        {missing.length > 0 && present.length > 0 && (
                          <span className="mx-1" style={{ color: 'var(--text-muted)' }}>
                            · eksik:
                          </span>
                        )}
                        {present.length > 0 &&
                          missing.map((h) => (
                            <span
                              key={h}
                              className="px-1.5 py-0.5 rounded font-mono"
                              style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}
                              title="bu sunucuda YOK"
                            >
                              {h.toLowerCase()}
                            </span>
                          ))}
                      </span>
                    </div>
                  ))}
                  {(coverage?.outside.length || 0) > 0 && (
                    <div className="flex flex-wrap items-start gap-2 text-[11px]">
                      <span className="w-28 shrink-0 font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        liste dışı
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {(coverage?.outside || []).map((h) => (
                          <span
                            key={h}
                            className="px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                            title="Bu sunucu tanımlı kümelerin hiçbirinde yok — küme listesi güncellenmeli olabilir."
                          >
                            {h.toLowerCase()}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {row.presentEnvs.map((e) => {
                  const c = row.envs[e];
                  return (
                    <div key={e} className="flex flex-wrap items-start gap-2 text-[11px]">
                      <span
                        className="w-16 shrink-0 font-semibold"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {e}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {c.hosts.map((h) => (
                          <span
                            key={h}
                            className="px-1.5 py-0.5 rounded font-mono"
                            style={{
                              background: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {h}
                          </span>
                        ))}
                        {c.ipRateLimits.length > 0 && (
                          <Pill tone={c.ipRateLimits.length > 1 ? 'danger' : 'info'}>
                            IP: {c.ipRateLimits.join(' / ')}
                          </Pill>
                        )}
                        {c.serverRateLimits.length > 0 && (
                          <Pill tone={c.serverRateLimits.length > 1 ? 'danger' : 'info'}>
                            location: {c.serverRateLimits.join(' / ')}
                          </Pill>
                        )}
                        {c.ipRateLimits.length === 0 && c.serverRateLimits.length === 0 && (
                          <Pill tone="warning">rate limit yok</Pill>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});
