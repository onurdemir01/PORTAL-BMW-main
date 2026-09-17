// src/components/denetim/NginxSpaSummary.tsx — Nginx SPA > "Ortam özeti" (2026-09-17).
//
// Kullanici: "sayfaya girdigimde gormek istediklerim" — ortam basina (DEV/TEST/QA/EDU/PROD)
// TEK tabloda: kac SPA var ve envanterin yuzde kaci; kaci nginx'e cikmis (internet: tanim
// var / intranet: uc dizin de yerinde) ve ilerleme yuzdesi; PROD icin yeni sunucularda
// yuk almaya hazir olanlar; kac route var, kaci SPA, hangi IP'lere cozuyor.
// Uc ucun (spa-coverage, route-stats, nginx-migration) verisi burada BIRLESTIRILIR;
// hesap sunucuda, burada yalnizca gosterim. "Insanlara gosterdigimde anlamiyorlar"
// sikayetine cevap: buyuk sayi + oran cubugu, her sutun tek soruya cevap verir.
import React, { useEffect, useMemo, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  denetimApi,
  type SpaCoverageResult,
  type SpaCoverageRow,
  type RouteStatsResult,
  type RouteStatsEnv,
  type NginxMigrationResult,
} from '@/api/denetimApi';
import { fmtNumber } from '@/utils/datetime';

const ENV_ORDER = ['DEV', 'TEST', 'QA', 'EDU', 'PROD'];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const pctText = (p: number | null) => (p === null ? '—' : `%${fmtNumber(p)}`);
const toneOf = (p: number | null) =>
  p === null
    ? 'var(--text-muted)'
    : p >= 90
      ? 'var(--status-success)'
      : p >= 60
        ? 'var(--status-warning)'
        : 'var(--status-danger)';

/** Oran cubugu: dolu kisim + yuzde. Olculemediyse tarali. */
function Bar({
  value,
  total,
  measured = true,
  title,
}: {
  value: number;
  total: number;
  measured?: boolean;
  title?: string;
}) {
  const p = measured ? pct(value, total) : null;
  return (
    <span className="inline-flex items-center gap-2 w-full" title={title}>
      <span
        className="flex-1 h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-elevated)', minWidth: 48 }}
      >
        {measured ? (
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.min(100, p || 0)}%`, background: toneOf(p) }}
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--border) 0 4px, transparent 4px 8px)',
            }}
          />
        )}
      </span>
      <span
        className="text-[11px] font-semibold tabular-nums w-12 text-right"
        style={{ color: measured ? toneOf(p) : 'var(--text-muted)' }}
      >
        {measured ? pctText(p) : 'ölçülemedi'}
      </span>
    </span>
  );
}

function Big({ n, of, label }: { n: number; of?: number; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <b className="text-base tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {fmtNumber(n)}
      </b>
      {of !== undefined && (
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          / {fmtNumber(of)}
        </span>
      )}
      {label && (
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      )}
    </span>
  );
}

function IpCell({ e }: { e: RouteStatsEnv }) {
  const [open, setOpen] = useState(false);
  const ips = e.spaIps;
  if (ips.length === 0 && !e.unresolvedIp.spa)
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const shown = open ? ips : ips.slice(0, 3);
  return (
    <div className="space-y-0.5">
      {shown.map((x) => (
        <div
          key={x.ip}
          className="flex items-center gap-1.5 whitespace-nowrap"
          title={`örnek: ${x.samples.join(', ')}`}
        >
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>
            {x.ip}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            ×{fmtNumber(x.count)}
          </span>
        </div>
      ))}
      {e.unresolvedIp.spa > 0 && (
        <div
          className="text-[10px]"
          style={{ color: 'var(--status-warning)' }}
          title="nslookup sonucu boş"
        >
          çözülmeyen {fmtNumber(e.unresolvedIp.spa)}
        </div>
      )}
      {ips.length > 3 && (
        <button
          onClick={() => setOpen(!open)}
          className="text-[10px] underline decoration-dotted"
          style={{ color: 'var(--text-muted)' }}
        >
          {open ? 'daha az' : `+${ips.length - 3} IP`}
        </button>
      )}
    </div>
  );
}

export default function NginxSpaSummary({ tier }: { tier: 'internet' | 'intranet' }) {
  const [cov, setCov] = useState<SpaCoverageResult | null>(null);
  const [routes, setRoutes] = useState<RouteStatsResult | null>(null);
  const [mig, setMig] = useState<NginxMigrationResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // `useAsyncEffect`: is effect flush'indan SONRAKI mikro-goreve ertelenir, yani
  // asagidaki `setLoading(true)` effect govdesinde SENKRON degildir (React 19'un
  // `set-state-in-effect` kurali bunu isaretliyordu). Iptal de hook'tan gelir:
  // `alive()` sokulmus bilesende false doner.
  useAsyncEffect(async (alive) => {
    setLoading(true);
    // Uc uc BAGIMSIZ: biri dusse de digerleri gosterilir (route tablosu yoksa sutun "—").
    Promise.allSettled([
      denetimApi.spaCoverage('ark'),
      denetimApi.routeStats('ark'),
      denetimApi.nginxMigration(),
    ])
      .then(([c, r, m]) => {
        if (!alive()) return;
        if (c.status === 'fulfilled' && c.value.ok) setCov(c.value);
        else
          setErr(
            c.status === 'fulfilled'
              ? c.value.message || 'Kapsam verisi alınamadı.'
              : String(c.reason),
          );
        if (r.status === 'fulfilled' && r.value.ok) setRoutes(r.value);
        if (m.status === 'fulfilled' && m.value.ok) setMig(m.value);
      })
      .finally(() => alive() && setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const byEnv = new Map<string, { cov?: SpaCoverageRow; route?: RouteStatsEnv }>();
    for (const r of cov?.rows || []) byEnv.set(r.env, { ...byEnv.get(r.env), cov: r });
    for (const e of routes?.envs || []) byEnv.set(e.env, { ...byEnv.get(e.env), route: e });
    return [...byEnv.entries()]
      .sort((a, b) => {
        const ia = ENV_ORDER.indexOf(a[0]),
          ib = ENV_ORDER.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
      })
      .map(([env, v]) => ({ env, ...v }));
  }, [cov, routes]);

  // PROD: yeni sunucularda yuk almaya hazir olanlar (Production Tasimalari ile ayni hesap)
  const prodNew = useMemo(() => {
    if (!mig) return null;
    const t = {
      apps: 0,
      ready: 0,
      locTotal: 0,
      locDefined: 0,
      scanned: false,
      unscanned: [] as string[],
    };
    for (const g of mig.groups) {
      t.apps += g.totals.apps;
      t.ready += g.totals.ready;
      t.locTotal += g.totals.locations?.total || 0;
      t.locDefined += g.totals.locations?.defined || 0;
      // Bir grup bile taranmissa sayilar anlamli; taranmayan grup ayrica yazilir.
      if (g.newHostsScanned.length > 0) t.scanned = true;
      else t.unscanned.push(g.label);
    }
    return t;
  }, [mig]);

  const spaAll = rows.reduce((a, r) => a + (r.cov?.spaTotal || 0), 0);

  if (err && !cov)
    return (
      <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (loading && !cov)
    return (
      <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Ortam özeti yükleniyor…
      </div>
    );
  if (!cov) return null;

  const isIntra = tier === 'intranet';
  // Secili katmanin sutunu vurgulu; digeri soluk (ama gorunur - iki katman tek tabloda).
  const hl = (col: 'internet' | 'intranet') =>
    (col === 'intranet') === isIntra ? undefined : { opacity: 0.55 };
  const th =
    'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-left whitespace-nowrap';

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <header
        className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Ortam özeti — SPA’lar nerede?
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            OpenShift’teki SPA sayısı → nginx’e çıkmış olanlar → route’lar. Toplam{' '}
            <b>{fmtNumber(spaAll)}</b> SPA (uygulama × ortam), ARK cluster’ları
            {cov.scanDate ? ` · nginx taraması ${cov.scanDate}` : ''}.
          </p>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full border"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          vurgulu sütun: {isIntra ? 'İntranet' : 'İnternet'}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <th className={th}>Ortam</th>
              <th
                className={th}
                title="OpenShift’teki SPA uygulaması sayısı (adında -app-v / -app-emb-v geçenler) ve ortamdaki tüm uygulamalar içindeki payı"
              >
                OpenShift SPA
              </th>
              <th
                className={th}
                style={hl('internet')}
                title="İnternete açık (route tipi passthrough) SPA’ların kaçının internet nginx’lerinde location tanımı var"
              >
                İnternet · nginx’te tanımlı
              </th>
              <th
                className={th}
                style={hl('intranet')}
                title="İntranet (route tipi reencrypt) SPA’ların kaçı intranet nginx’lerine TAM kurulu (hysdeploy + applications + conf)"
              >
                İntranet · nginx’e kurulu
              </th>
              <th className={th} title="Ortamdaki route sayısı, kaçı SPA uygulamasına ait ve payı">
                Route’lar
              </th>
              <th
                className={th}
                title="SPA route’larının çözdüğü IP’ler (route_inventory nslookup) ve her IP’ye düşen route sayısı"
              >
                SPA route → IP
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ env, cov: c, route: r }) => {
              const spaShare = c ? pct(c.spaTotal, c.ocpApps) : null;
              return (
                <tr
                  key={env}
                  className="border-t align-top"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td
                    className="px-3 py-2.5 font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {env}
                  </td>
                  <td className="px-3 py-2.5">
                    {c ? (
                      <div className="space-y-0.5">
                        <Big n={c.spaTotal} label="SPA" />
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          envanterin{' '}
                          <b style={{ color: 'var(--text-secondary)' }}>{pctText(spaShare)}</b>’i (
                          {fmtNumber(c.ocpApps)} uygulama)
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          internet {fmtNumber(c.internetTotal)} · intranet{' '}
                          {fmtNumber(c.intranetTotal)}
                          {c.unknownTotal ? ` · route’suz ${fmtNumber(c.unknownTotal)}` : ''}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 min-w-[13rem]" style={hl('internet')}>
                    {c ? (
                      <div className="space-y-1">
                        <Big
                          n={c.measured ? c.internetInNginx : 0}
                          of={c.internetTotal}
                          label={env === 'PROD' ? 'eski sunucuda proxy' : 'tanımlı'}
                        />
                        <Bar
                          value={c.internetInNginx}
                          total={c.internetTotal}
                          measured={c.measured}
                          title="nginx’te tanımlı / internete açık SPA"
                        />
                        {env === 'PROD' && prodNew && (
                          <div
                            className="rounded-lg px-2 py-1.5 mt-1 border"
                            style={{
                              borderColor: 'var(--border-subtle)',
                              background: 'var(--bg-elevated)',
                            }}
                          >
                            <div
                              className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Yeni sunucularda yük almaya hazır
                            </div>
                            {prodNew.scanned ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <Big n={prodNew.ready} of={prodNew.apps} label="uygulama" />
                                </div>
                                <Bar
                                  value={prodNew.ready}
                                  total={prodNew.apps}
                                  title="hazır = her yeni sunucuda hysdeploy + applications dizini var"
                                />
                                <div
                                  className="text-[10px] mt-0.5"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  location tanımı yazılmış:{' '}
                                  <b style={{ color: 'var(--text-secondary)' }}>
                                    {fmtNumber(prodNew.locDefined)}
                                  </b>{' '}
                                  / {fmtNumber(prodNew.locTotal)} (Production Taşımaları)
                                </div>
                                {prodNew.unscanned.length > 0 && (
                                  <div
                                    className="text-[10px]"
                                    style={{ color: 'var(--status-warning)' }}
                                  >
                                    taranmadı: {prodNew.unscanned.join(', ')}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                yeni sunucular henüz taranmadı
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 min-w-[13rem]" style={hl('intranet')}>
                    {c ? (
                      <div className="space-y-1">
                        <Big
                          n={c.measuredIntranet ? c.intranetFull : 0}
                          of={c.intranetTotal}
                          label="tam kurulu"
                        />
                        <Bar
                          value={c.intranetFull}
                          total={c.intranetTotal}
                          measured={c.measuredIntranet}
                          title="üç dizin de yerinde / intranet SPA"
                        />
                        {c.measuredIntranet &&
                          (c.intranetPartialCount > 0 || c.intranetMissingCount > 0) && (
                            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                              {c.intranetPartialCount > 0 && (
                                <span style={{ color: 'var(--status-warning)' }}>
                                  yarım {fmtNumber(c.intranetPartialCount)}
                                </span>
                              )}
                              {c.intranetPartialCount > 0 && c.intranetMissingCount > 0 && ' · '}
                              {c.intranetMissingCount > 0 && (
                                <span style={{ color: 'var(--status-danger)' }}>
                                  hiç yok {fmtNumber(c.intranetMissingCount)}
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r ? (
                      <div className="space-y-0.5">
                        <Big n={r.routes} label="route" />
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          SPA <b style={{ color: 'var(--text-secondary)' }}>{fmtNumber(r.spa)}</b> (
                          {pctText(pct(r.spa, r.routes))}) · SPA değil {fmtNumber(r.nonSpa)}
                          {r.unclassified ? ` · sınıflanamadı ${fmtNumber(r.unclassified)}` : ''}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {fmtNumber(r.namespaces)} namespace ·{' '}
                          {r.terminations.map((t) => `${t.type} ${fmtNumber(t.count)}`).join(' · ')}
                        </div>
                      </div>
                    ) : (
                      <span
                        style={{ color: 'var(--text-muted)' }}
                        title="route envanteri yok ya da bu ortamda route bulunamadı"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r ? <IpCell e={r} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Veri yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div
        className="px-4 py-2 border-t text-[10px] leading-relaxed"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        <b>SPA</b> = OpenShift’te adında <code>-app-v</code>/<code>-app-emb-v</code> geçen uygulama;
        sayım uygulama × ortam. <b>İnternet</b> = route tipi passthrough, nginx’te location tanımı
        aranır (PROD’da eski GBRVP* sunucularının proxy_pass’i). <b>İntranet</b> = route tipi
        reencrypt, intranet nginx’lerinde üç dizin de yerindeyse “tam kurulu”. <b>Taralı</b> = o
        ortam için nginx kaydı yok, ölçülemedi.
        {routes?.routeTableMissing && (
          <span style={{ color: 'var(--status-warning)' }}>
            {' '}
            Route envanteri okunamadı (route_inventory job’ı koşmalı).
          </span>
        )}
      </div>
    </section>
  );
}
