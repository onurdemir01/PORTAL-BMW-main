// src/components/denetim/RouteTraffic.tsx — "Denetim ▸ Uygulama Trafiği".
//
// Kullanıcının istediği tablo, kendi sözleriyle (2026-10-06):
//   "ekrandaki veriler şöyle olmalı: Namespace - Uygulama - Ortam/SPA - İstek - Route - Cluster"
//   "her bir uygulama için tek satır olmalı"
//   "uygulamanın pod ismi değil direkt kendi ismi yazılmalı"
//   "ilgili route hangi cluster'larda var ise Kısmi veya Tam olarak gösterilmeli...
//    4 prod cluster'ın 4'ünde de varsa 4/4 Tam, 3'ünde varsa 3/4 Kısmi"
//
// ÖNCEKİ HALİ ÜÇ KEZ YANLIŞTI ve üçünün kökü aynıydı: ekran yanlış tablodan besleniyordu
// (route envanteri + Dynatrace displayName). Uygulama adı POD adı çıkıyor, route boş
// kalıyor, SPA ad kalıbından tahmin ediliyordu. Doğru omurga `dbo.BMW_Spa_Discovery`
// (openshift_spa_discovery job'ı): route → Service → Deployment/DeploymentConfig/Rollout
// zincirini ÇÖZMÜŞ ve SPA'yı kabinde nginx sinyaliyle ÖLÇMÜŞ. Sınıflama sunucuda
// (server/audit/app-traffic.cjs); burası yalnızca gösterir ve süzer.
//
// ÜÇ YERDE "ÖLÇÜLEMEDİ" AYRI GÖSTERİLİR — üçü de "yok" değildir:
//   İstek  : ölçülemeyen uygulamayı "0 istek" göstermek, onu emekli adayı yapardı
//   SPA    : eşleşemeyen route "SPA değil" değil, "bilinmiyor"
//   Cluster: erişilemeyen cluster "Kısmi" damgası vermez; ayrıca sayılır
import React, { useCallback, useEffect, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  SignalIcon,
  QuestionMarkCircleIcon,
  MoonIcon,
  ExclamationTriangleIcon,
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

// ÜÇ DURUM, İKİ DEĞİL. "ölçülemedi" ile "istek yok" aynı şey değildir: ölçemediğimiz bir
// uygulamayı emekli adayı saymak, bu ekranın verebileceği en pahalı yanlış karardır.
const STATUS: Record<
  AppTrafficStatus,
  { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  active: {
    label: 'İstek alıyor',
    tone: 'success',
    icon: SignalIcon,
    hint: 'Ölçüm penceresinde Dynatrace isteği görüldü.',
  },
  idle: {
    label: 'İstek almıyor',
    tone: 'warning',
    icon: MoonIcon,
    hint: 'Ölçüm YAPILDI ve sonuç sıfır — atıl aday.',
  },
  unmeasured: {
    label: 'Ölçülemedi',
    tone: 'info',
    icon: QuestionMarkCircleIcon,
    hint:
      'Uygulamanın istek ölçümü alınamadı (application_usage satırı yok ya da servisleri ' +
      'ölçülemedi). "İstek almıyor" DEĞİL — atıl sanıp emekli etmeyin.',
  },
};

const SPA_ETIKET: Record<string, { label: string; tone: Tone; hint: string }> = {
  yes: {
    label: 'SPA',
    tone: 'success',
    hint: 'Kabinde nginx sinyali (nginx-start.sh) ÖLÇÜLDÜ — ad kalıbı tahmini değil.',
  },
  no: {
    label: 'SPA değil',
    tone: 'neutral',
    hint: 'Kabin tarandı, nginx sinyali bulunamadı.',
  },
  unknown: {
    label: 'SPA ölçülemedi',
    tone: 'info',
    hint:
      'Route bir iş yüküne eşleşemedi (çoğunlukla servis okuma yetkisi yok), bu yüzden ' +
      'kabine bakılamadı. "SPA değil" DEMEK DEĞİL.',
  },
};

/** Cluster kapsamı: "4/4 Tam", "3/4 Kısmi". Payda yalnız TARANABİLEN cluster'lar. */
function kapsamMetni(r: AppTrafficRow): { text: string; tone: Tone; hint: string } {
  if (r.coverage === 'unknown' || r.coverageTotal === 0)
    return {
      text: 'ölçülemedi',
      tone: 'info',
      hint:
        'Bu uygulamanın ortamı için katalogda taranabilen cluster yok — kapsam oranı ' +
        'hesaplanamaz. Ortam çözülemediyse de böyle görünür.',
    };
  const oran = `${r.coveragePresent}/${r.coverageTotal}`;
  const ek = r.coverageUnmeasured
    ? ` · ${r.coverageUnmeasured} cluster ölçülemedi`
    : '';
  if (r.coverage === 'full')
    return {
      text: `${oran} Tam${ek}`,
      tone: 'success',
      hint:
        'Route, ortamın taranabilen tüm cluster’larında var.' +
        (r.coverageUnmeasured
          ? ' Erişilemeyen cluster’lar paydaya GİRMEZ — orada var mı yok mu bilinmiyor.'
          : ''),
    };
  if (r.coverage === 'partial')
    return {
      text: `${oran} Kısmi${ek}`,
      tone: 'warning',
      hint: 'Route ortamın bazı cluster’larında YOK — dağıtım eksik olabilir.',
    };
  return {
    text: `0/${r.coverageTotal}`,
    tone: 'danger',
    hint: 'Route ortamın taranan hiçbir cluster’ında bulunamadı.',
  };
}

const RouteTraffic: React.FC = () => {
  const [data, setData] = useState<AppTrafficResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('all');
  const [spa, setSpa] = useState('all');
  const [status, setStatus] = useState('all');
  const [coverage, setCoverage] = useState('all');

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await denetimApi.routeTraffic({ q, env, spa, status, coverage }, fresh);
        if (!r.ok) throw new Error(r.message || 'Veri alınamadı.');
        setData(r);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [q, env, spa, status, coverage],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const rows = data?.rows ?? [];
  const s = data?.summary;
  const f = data?.freshness ?? null;

  function csv() {
    csvDownload(
      'uygulama-trafigi.csv',
      ['Namespace', 'Uygulama', 'Tür', 'Ortam', 'SPA', 'İstek', 'Durum', 'Route', 'Cluster'],
      rows.map((r) => [
        r.namespace,
        r.app ?? '(eşleşmedi)',
        r.kind ?? '',
        r.env ?? '',
        SPA_ETIKET[r.spa]?.label ?? r.spa,
        r.req == null ? 'ölçülemedi' : String(r.req),
        STATUS[r.reqStatus].label,
        r.routes.map((x) => x.route).join(' | '),
        kapsamMetni(r).text,
      ]),
    );
  }

  if (loading && !data) return <LoadingLogo />;

  return (
    <div className="space-y-4">
      {/* VERİ TAZELİĞİ EN ÜSTTE. Kullanıcı "ortalık karıştı, çok fazla job'ımız oldu"
          dedi; iki kaynağın tarihini ve SPA keşfinin cluster durumunu GÖRMEDEN bu
          tablonun hiçbir sayısı yorumlanamaz. Sessizce harmanlamak o karışıklığın
          kendisiydi. */}
      {f && (
        <div
          className="rounded-xl border px-3 py-2 text-[11px] space-y-1"
          style={{
            borderColor: f.clusters.unreachable ? 'var(--status-warning)' : 'var(--border-subtle)',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            <b>SPA keşfi</b> (openshift_spa_discovery):{' '}
            {f.spaScan ? fmtDate(f.spaScan) : 'hiç koşmadı'} · {f.clusters.total} cluster ·{' '}
            <b>{f.clusters.ok}</b> tam, {f.clusters.partial} kısmi
            {f.clusters.unreachable > 0 && (
              <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>
                {' '}
                · {f.clusters.unreachable} erişilemedi
              </span>
            )}
          </div>
          <div>
            <b>İstek ölçümü</b> (application_usage):{' '}
            {f.usageTableMissing
              ? 'tablo yok — job bir kez koşmalı'
              : f.usageScan
                ? fmtDate(f.usageScan)
                : 'veri yok'}
          </div>
          {f.spaScan && f.usageScan && f.spaScan !== f.usageScan && (
            <div style={{ color: 'var(--status-warning)' }}>
              İki kaynağın tarihi FARKLI. Satırlar iki ayrı günün verisini birleştiriyor;
              AWX workflow&apos;u (SPA Discovery → Application Usage) ikisini aynı pencereye
              getirir.
            </div>
          )}
          {f.clusters.unreachable > 0 && (
            <details>
              <summary className="cursor-pointer" style={{ color: 'var(--status-warning)' }}>
                Erişilemeyen / kısmi cluster&apos;lar ve sebepleri
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {f.clusterDetail.map((c) => (
                  <li key={c.cluster}>
                    <span className="font-mono">{c.cluster}</span> · {c.durum}
                    {c.reason ? ` — ${c.reason}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {data?.tableMissing && <Note tone="warning">{data.message}</Note>}

      {s && (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Uygulama" value={nf(s.apps)} />
          <StatTile label="Route" value={nf(s.routes)} />
          <StatTile label="SPA" value={nf(s.spa)} hint={`${nf(s.spaUnknown)} ölçülemedi`} />
          <StatTile label="İstek alıyor" value={nf(s.active)} tone="success" />
          <StatTile label="İstek almıyor" value={nf(s.idle)} tone="warning" />
          <StatTile
            label="Ölçülemedi"
            value={nf(s.unmeasured)}
            tone="info"
            hint="İstek ölçümü alınamayan uygulama — atıl DEĞİL"
          />
        </div>
      )}

      {s && s.unmatched > 0 && (
        <Note tone="info">
          <b>{nf(s.unmatched)}</b> route bir iş yüküne eşleşemedi ve listede
          &quot;eşleşmedi&quot; olarak <b>en üstte</b> duruyor — gizlenmiyor. Sebep çoğunlukla
          servis okuma yetkisi: SPA keşfi o namespace&apos;lerin servislerini okuyamadığında
          route&apos;un hangi uygulamaya ait olduğu çözülemiyor.
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="namespace, uygulama ya da route ara..."
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border bg-[var(--bg-surface)]"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </div>
        <Select value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="all">Tüm ortamlar</option>
          {(data?.envs ?? []).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
        <Select value={spa} onChange={(e) => setSpa(e.target.value)}>
          <option value="all">SPA: hepsi</option>
          <option value="yes">SPA</option>
          <option value="no">SPA değil</option>
          <option value="unknown">SPA ölçülemedi</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">İstek: hepsi</option>
          <option value="active">İstek alıyor</option>
          <option value="idle">İstek almıyor</option>
          <option value="unmeasured">Ölçülemedi</option>
        </Select>
        <Select value={coverage} onChange={(e) => setCoverage(e.target.value)}>
          <option value="all">Cluster: hepsi</option>
          <option value="full">Tam</option>
          <option value="partial">Kısmi</option>
          <option value="none">Hiçbirinde</option>
          <option value="unknown">Ölçülemedi</option>
        </Select>
        <button
          onClick={() => void load(true)}
          className="px-2.5 py-1.5 text-sm rounded-lg border inline-flex items-center gap-1.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <ArrowPathIcon className="w-4 h-4" /> Yenile
        </button>
        <button
          onClick={csv}
          disabled={!rows.length}
          className="px-2.5 py-1.5 text-sm rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <ArrowDownTrayIcon className="w-4 h-4" /> CSV
        </button>
      </div>

      {err && <Note tone="danger">{err}</Note>}

      {data?.truncated && (
        <Note tone="info">
          Liste {nf(data.limit)} satırda kesildi ({nf(data.filtered)} satır süzgece uyuyor).
          Süzgeçleri daraltın.
        </Note>
      )}

      <TableShell>
        <thead>
          <tr>
            <Th>Namespace</Th>
            <Th>Uygulama</Th>
            <Th>Ortam / SPA</Th>
            <Th align="right">İstek</Th>
            <Th>Route</Th>
            <Th>Cluster</Th>
          </tr>
        </thead>
        <tbody>
          {!rows.length && <TableEmptyRow colSpan={6} title="Süzgece uyan uygulama yok." />}
          {rows.map((r) => {
            const st = STATUS[r.reqStatus];
            const Icon = st.icon;
            const kap = kapsamMetni(r);
            const sp = SPA_ETIKET[r.spa] ?? SPA_ETIKET.unknown;
            return (
              <tr key={`${r.namespace}/${r.app ?? r.routes[0]?.route ?? '?'}`}>
                <Td className="font-mono">{r.namespace}</Td>
                <Td className="font-mono">
                  {r.app ?? (
                    <span
                      style={{ color: 'var(--status-warning)' }}
                      title="Route bir iş yüküne eşleşemedi — SPA keşfi o namespace'in servislerini okuyamadı. Satır gizlenmiyor."
                    >
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 inline mr-1" />
                      eşleşmedi
                    </span>
                  )}
                  {r.kind && (
                    <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {r.kind}
                    </span>
                  )}
                </Td>
                <Td>
                  <span className="text-xs">{r.env ?? '—'}</span>
                  <Pill tone={sp.tone} title={sp.hint}>
                    {sp.label}
                  </Pill>
                </Td>
                <Td align="right">
                  {/* Ikon tipi yalniz className aliyor (ComponentType<{className}>);
                      rengi SARMALAYICIDAN miras alir. */}
                  <span
                    className="inline-flex items-center gap-1 tabular-nums"
                    title={st.hint + (r.reqNote ? ` — ${r.reqNote}` : '')}
                    style={{
                      color:
                        st.tone === 'success'
                          ? 'var(--status-ok)'
                          : st.tone === 'warning'
                            ? 'var(--status-warning)'
                            : 'var(--text-secondary)',
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {r.req == null ? (
                      <span style={{ color: 'var(--text-muted)' }}>ölçülemedi</span>
                    ) : (
                      nf(r.req)
                    )}
                  </span>
                </Td>
                <Td className="font-mono">
                  {r.routes.length === 0 && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  {r.routes.map((x) => (
                    <div key={x.route} title={x.host ?? undefined} className="truncate max-w-[280px]">
                      {x.route}
                    </div>
                  ))}
                </Td>
                <Td>
                  <Pill tone={kap.tone} title={kap.hint}>
                    {kap.text}
                  </Pill>
                  {r.clusters.length > 0 && (
                    <div
                      className="text-[10px] mt-0.5 truncate max-w-[220px]"
                      style={{ color: 'var(--text-muted)' }}
                      title={r.clusters.join(', ')}
                    >
                      {r.clusters.join(', ')}
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      <Note>
        <b>Veri kaynağı — iki job.</b> Omurga <code>openshift_spa_discovery</code>: route&apos;un
        ardındaki iş yükünü (Deployment / DeploymentConfig / Argo Rollout) çözer ve SPA&apos;yı
        kabinde nginx sinyaliyle <b>ölçer</b> — ad kalıbı tahmini kullanılmaz, uygulama adı pod
        adı değil iş yükünün kendi adıdır. &quot;İstek&quot; kolonu{' '}
        <code>application_usage</code>: Dynatrace <code>requestCount.total</code>, 7 günlük
        pencere, uygulamanın servisleri üzerinden toplanır. Cluster kolonundaki payda, ortamın
        katalogdaki <b>taranabilen</b> cluster sayısıdır; erişilemeyen cluster paydaya girmez ve
        &quot;Kısmi&quot; damgası vermez — orada var mı yok mu bilinmiyor.
      </Note>
    </div>
  );
};

export default RouteTraffic;
