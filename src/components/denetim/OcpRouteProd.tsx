// src/components/denetim/OcpRouteProd.tsx — "Denetim > OpenShift Route" (2026-10-14).
//
// YALNIZ PRODUCTION. Kullanici: "dev'de olan bir route'un test'te veya prod'da olmasini beklemeyiz
// ... onemli olan production". Ilk hali OpenShift sekmesinin aynisiydi (ortamlar yan yana) ve her
// dev route'u "prod'da eksik" gorunuyordu. Artik satir = -prod namespace tabani + route adi, her prod
// cluster bir SUTUN; soru "bu route prod cluster'larinin hangisinde var".
//
// Sunucu: GET /api/denetim/ocp-route-coverage (envs=['prod'], server/audit/ocp-kapsam.cjs). Sutunlar
// envClusters.prod'dan: ARK'ta resmi prod listesi + varsa "beklenmeyen" cluster'lar. Hic kaydi
// gelmeyen cluster "veri yok" (olculemedi != yok) - n'ye katilmaz, filtrelenemez.
//
// Filtreler (kullanici: "filtre koymani rica edecegim") her sutunun altinda: route / namespace metni,
// her cluster icin var / yok, kapsam turu. Ozet sayilar filtreden ETKILENMEZ (tum satirlar).
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Select } from '@/components/ui/Form';
import { denetimApi, type OcpCoverageResult } from '@/api/denetimApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';
import { downloadCsv as csvDownload } from '@/utils/csv';

type KapsamTur = 'tam' | 'kismi' | 'hicbiri';
type VarYok = '' | 'var' | 'yok';

const KAPSAM_ETIKET: Record<KapsamTur, string> = {
  tam: 'Tam',
  kismi: 'Kısmi',
  hicbiri: "Resmi cluster'da yok",
};

// Turkce I: tr klavyeden gelen "I"/"İ"/"ı" hepsi "i"ye iner (route adlari ASCII kucuk harf).
const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i');

const SATIR_SINIRI = 500;

export default function OcpRouteProd() {
  const [platform, setPlatform] = useState('ark');
  const [data, setData] = useState<OcpCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [fRoute, setFRoute] = useState('');
  const [fNs, setFNs] = useState('');
  const [fKume, setFKume] = useState<Record<string, VarYok>>({});
  const [fKapsam, setFKapsam] = useState<'' | KapsamTur>('');

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.ocpRouteCoverage(p);
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

  useAsyncEffect(async () => {
    await load(platform);
  }, [platform, load]);

  const kumeler = useMemo(() => data?.envClusters?.prod ?? [], [data]);
  // n: olculmus RESMI cluster'lar (beklenmeyen ve veri yok haric).
  const resmi = useMemo(
    () => kumeler.filter((c) => !c.beklenmeyen && !c.veriYok).map((c) => c.cluster),
    [kumeler],
  );
  const veriYok = useMemo(() => kumeler.filter((c) => c.veriYok).map((c) => c.cluster), [kumeler]);

  const satirlar = useMemo(
    () =>
      (data?.rows ?? []).map((r) => {
        const on = new Set((r.envs.prod ?? []).map((h) => h.cluster));
        const k = resmi.filter((c) => on.has(c)).length;
        const n = resmi.length;
        const tur: KapsamTur = k === 0 ? 'hicbiri' : k < n ? 'kismi' : 'tam';
        const beklenmeyende = kumeler.some((c) => c.beklenmeyen && on.has(c.cluster));
        return { r, on, k, n, tur, beklenmeyende };
      }),
    [data, resmi, kumeler],
  );

  const gorunen = useMemo(() => {
    const rq = norm(fRoute.trim());
    const nq = norm(fNs.trim());
    return satirlar.filter(({ r, on, tur }) => {
      if (rq && !norm(r.application).includes(rq)) return false;
      if (nq && !norm(r.alt ?? '').includes(nq)) return false;
      if (fKapsam && tur !== fKapsam) return false;
      for (const [c, v] of Object.entries(fKume)) {
        if (v === 'var' && !on.has(c)) return false;
        if (v === 'yok' && on.has(c)) return false;
      }
      return true;
    });
  }, [satirlar, fRoute, fNs, fKume, fKapsam]);

  const ozet = useMemo(
    () => ({
      tam: satirlar.filter((s) => s.tur === 'tam').length,
      kismi: satirlar.filter((s) => s.tur === 'kismi').length,
      hicbiri: satirlar.filter((s) => s.tur === 'hicbiri').length,
      beklenmeyen: satirlar.filter((s) => s.beklenmeyende).length,
    }),
    [satirlar],
  );

  const filtreVar = !!(fRoute || fNs || fKapsam || Object.values(fKume).some(Boolean));
  const temizle = () => {
    setFRoute('');
    setFNs('');
    setFKume({});
    setFKapsam('');
  };

  if (loading && !data) return <LoadingLogo />;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );

  const kapsamCls = (tur: KapsamTur) =>
    tur === 'tam'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tur === 'kismi'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-600 border-red-200';
  const girdi =
    'w-full px-2 py-1 text-[11px] font-normal border border-[var(--border)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)]';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          sizeVariant="sm"
          value={platform}
          aria-label="Platform"
          onChange={(e) => {
            setFKume({});
            setPlatform(e.target.value);
          }}
        >
          {(data?.platforms || ['ark']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {fmtNumber(gorunen.length)} / {fmtNumber(satirlar.length)} prod route
        </span>
        {filtreVar && (
          <button
            onClick={temizle}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <XMarkIcon className="w-3.5 h-3.5" /> Filtreleri temizle
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() =>
              csvDownload(
                `ocp_route_prod_${platform}`,
                ['route', 'namespace', ...kumeler.map((c) => c.cluster), 'kapsam'],
                gorunen.map(({ r, on, k, n }) => [
                  r.application,
                  r.alt ?? '',
                  ...kumeler.map((c) => (c.veriYok ? 'veri yok' : on.has(c.cluster) ? 'var' : 'yok')),
                  `${k}/${n}`,
                ]),
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => load(platform)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Yalnız production. Kaynak: dbo.BMW_Openshift_Route_Inventory (route_inventory job'ı; her
        koşuda baştan yazılır). Satır = -prod namespace tabanı + route adı; her sütun bir prod
        cluster'ı. Kapsam k/n: route'un resmi prod cluster'larının kaçında olduğu.
      </p>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Stat n={satirlar.length} l="prod route" />
        <Stat n={ozet.tam} l={`tüm prod cluster'larında (${resmi.length})`} tone="ok" />
        <Stat n={ozet.kismi} l="kısmi (bazı cluster'larda yok)" tone={ozet.kismi ? 'warn' : undefined} />
        <Stat n={ozet.hicbiri} l="resmi cluster'da yok" tone={ozet.hicbiri ? 'warn' : undefined} />
        <Stat n={ozet.beklenmeyen} l="beklenmeyen cluster'da" tone={ozet.beklenmeyen ? 'warn' : undefined} />
      </div>

      {veriYok.length > 0 && (
        <div className="text-xs rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-secondary)]">
          <b>Veri yok:</b> <span className="font-mono">{veriYok.join(', ')}</span> — bu cluster'lardan
          hiç kayıt gelmedi (job giriş yapamamış olabilir). Ölçülemedi; kapsam hesabına (n) katılmadı.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-elevated)] text-left">
              <th className="px-3 pt-2 pb-1 text-xs font-semibold text-[var(--text-muted)]">Route</th>
              <th className="px-3 pt-2 pb-1 text-xs font-semibold text-[var(--text-muted)]">Namespace</th>
              {kumeler.map((c) => (
                <th
                  key={c.cluster}
                  className="px-2 pt-2 pb-1 text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap"
                  title={
                    c.veriYok
                      ? 'Veri yok: bu cluster’dan hiç kayıt gelmedi — ölçülemedi'
                      : c.beklenmeyen
                        ? 'Beklenmeyen: resmi prod listesinde yok ama prod route’u var'
                        : `${fmtNumber(c.apps)} prod route`
                  }
                >
                  <span className="font-mono">{c.cluster}</span>
                  <div className="text-[10px] font-normal tabular-nums">
                    {c.veriYok ? (
                      <span>veri yok</span>
                    ) : (
                      <>
                        {fmtNumber(c.apps)} route
                        {c.beklenmeyen && (
                          <span className="ml-1 px-1 rounded border bg-amber-50 text-amber-800 border-amber-300">
                            beklenmeyen
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </th>
              ))}
              <th className="px-3 pt-2 pb-1 text-xs font-semibold text-[var(--text-muted)]">Kapsam</th>
            </tr>
            <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <th className="px-3 pb-2">
                <input
                  value={fRoute}
                  onChange={(e) => setFRoute(e.target.value)}
                  placeholder="route ara"
                  aria-label="Route adına göre süz"
                  className={girdi}
                />
              </th>
              <th className="px-3 pb-2">
                <input
                  value={fNs}
                  onChange={(e) => setFNs(e.target.value)}
                  placeholder="namespace ara"
                  aria-label="Namespace adına göre süz"
                  className={girdi}
                />
              </th>
              {kumeler.map((c) => (
                <th key={c.cluster} className="px-2 pb-2">
                  <select
                    value={fKume[c.cluster] ?? ''}
                    disabled={!!c.veriYok}
                    onChange={(e) => setFKume((m) => ({ ...m, [c.cluster]: e.target.value as VarYok }))}
                    aria-label={`${c.cluster} sütununa göre süz`}
                    className={girdi}
                  >
                    <option value="">Hepsi</option>
                    <option value="var">Var</option>
                    <option value="yok">Yok</option>
                  </select>
                </th>
              ))}
              <th className="px-3 pb-2">
                <select
                  value={fKapsam}
                  onChange={(e) => setFKapsam(e.target.value as '' | KapsamTur)}
                  aria-label="Kapsama göre süz"
                  className={girdi}
                >
                  <option value="">Hepsi</option>
                  {(Object.keys(KAPSAM_ETIKET) as KapsamTur[]).map((t) => (
                    <option key={t} value={t}>
                      {KAPSAM_ETIKET[t]}
                    </option>
                  ))}
                </select>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {gorunen.length === 0 && <TableEmptyRow colSpan={kumeler.length + 3} />}
            {gorunen.slice(0, SATIR_SINIRI).map(({ r, on, k, n, tur }) => (
              <tr key={r.key ?? r.application} className="hover:bg-[var(--bg-elevated)]/60">
                <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]">{r.application}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-secondary)]">{r.alt}</td>
                {kumeler.map((c) => (
                  <td key={c.cluster} className="px-2 py-1.5">
                    {c.veriYok ? (
                      <span className="text-[11px] text-[var(--text-muted)]" title="Veri yok — ölçülemedi">
                        —
                      </span>
                    ) : on.has(c.cluster) ? (
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded-md border ${c.beklenmeyen ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
                      >
                        var
                      </span>
                    ) : (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md border bg-red-50 text-red-600 border-red-200">
                        yok
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-lg border tabular-nums ${kapsamCls(tur)}`}>
                    {k}/{n}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gorunen.length > SATIR_SINIRI && (
        <p className="text-xs text-[var(--text-muted)]">
          İlk {SATIR_SINIRI} satır gösteriliyor — sütun filtreleriyle daraltın ya da CSV indirin
          (CSV filtrelenmiş satırların tamamını içerir).
        </p>
      )}
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: 'ok' | 'warn' }) {
  const color =
    tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{fmtNumber(n)}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{l}</div>
    </div>
  );
}
