// src/components/denetim/NginxProdMigration.tsx — Nginx SPA > "Prod Taşıma".
//
// Soru (kullanici, 2026-09-14): eski GBRVP* sunucularinin location'larinda proxy_pass
// ile tanimli uygulamalar, yeni GBNGXP4x/5x sunucularinda
//   /hysdeploy/<ns>/<app>/  ve  /usr/nginx/applications/<ns>/<app>/
// olarak var mi? Her satir bir uygulama, her sutun bir YENI sunucu. Hesap sunucuda
// (nginx-migration.cjs); burada yalnizca gosterim.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxMigrationApp,
  type NginxMigrationGroup,
  type NginxMigrationOther,
  type NginxMigrationResult,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, Code, Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

const STATUS: Record<NginxMigrationApp['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; hint: string }> = {
  ready: { label: 'hazır', tone: 'success', hint: 'Yeni sunucuların HEPSİNDE hysdeploy + applications dizini var' },
  partial: { label: 'kısmi', tone: 'warning', hint: 'Bazı yeni sunucularda var, bazılarında yok (ya da bazıları henüz taranmadı)' },
  missing: { label: 'EKSİK', tone: 'danger', hint: 'Taranan hiçbir yeni sunucuda yok — taşıma öncesi deploy gerekli' },
  'not-scanned': { label: 'taranmadı', tone: 'neutral', hint: 'Yeni sunucuların hiçbiri henüz taranmadı (nginx_config_audit job’ı koşmalı)' },
};

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NginxProdMigration() {
  const [data, setData] = useState<NginxMigrationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const [onlyProblem, setOnlyProblem] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await denetimApi.nginxMigration();
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
  }, [tick]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu ekran ne gösteriyor?">
        Eski prod sunucularının (<Code>GBRVP*</Code>) vhost&apos;larındaki her <Code>proxy_pass</Code> hedefi
        OpenShift route envanteriyle <i>(namespace, uygulama)</i>&apos;ya çözülür; sonra <b>her yeni sunucuda</b>{' '}
        <Code>/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</Code> ve <Code>/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/</Code>{' '}
        var mı bakılır. Hücre: <b>H</b> = hysdeploy, <b>A</b> = applications, <b>C</b> = application-confs.
        Bir uygulama <b>hazır</b> sayılır ancak yeni sunucuların <b>hepsinde</b> H ve A varsa.
        <div className="mt-1.5 text-[var(--text-muted)]">
          Eski sunucu verisi: <Code>nginx_config_audit</Code> ({data.proxyScanDate || '—'}) · yeni sunucu dizinleri:
          aynı job ({data.dirScanDate || '—'}). SPA olmayan hedefler (API/arka uç) dizin beklemez, ayrı listelenir.
        </div>
      </Note>

      {!data.proxyReady && (
        <Note tone="warning" title="Eski sunucu proxy verisi yok">
          <Code>dbo.Nginx_Config_Audit</Code>&apos;te proxy satırı yok (DDL <Code>nginx_config_audit_migrate_proxy.sql</Code>{' '}
          ya da job henüz koşmamış).
        </Note>
      )}

      <div className="flex items-center gap-2 justify-end">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={onlyProblem} onChange={(e) => setOnlyProblem(e.target.checked)} />
          Sadece hazır olmayanlar
        </label>
        <button
          onClick={() =>
            csvDownload(
              'nginx_prod_tasima',
              ['grup', 'namespace', 'uygulama', 'durum', 'hazir_sunucu', 'taranan_sunucu', 'eski_sunucular', 'servis', 'location_sayisi', 'hedef', ...data.groups.flatMap((g) => g.newHosts)],
              data.groups.flatMap((g) =>
                g.apps.map((a) => [
                  g.label, a.namespace, a.application, STATUS[a.status].label, a.readyHosts, a.scannedHosts,
                  a.oldHosts.join(' '), a.services.join(' '), a.locationCount, a.target,
                  ...data.groups.flatMap((gg) => gg.newHosts.map((h) => (gg.id !== g.id ? '' : cellText(a.perHost[h])))),
                ]),
              ),
            )
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={() => setTick((t) => t + 1)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {data.groups.map((g) => (
        <GroupPanel key={g.id} g={g} onlyProblem={onlyProblem} />
      ))}
    </div>
  );
}

function cellText(f: { hys: boolean; app: boolean; conf: boolean } | null | undefined): string {
  if (f === null) return 'taranmadi';
  if (!f) return '';
  return (f.hys ? 'H' : '-') + (f.app ? 'A' : '-') + (f.conf ? 'C' : '-');
}

function GroupPanel({ g, onlyProblem }: { g: NginxMigrationGroup; onlyProblem: boolean }) {
  const rows = useMemo(() => (onlyProblem ? g.apps.filter((a) => a.status !== 'ready') : g.apps), [g, onlyProblem]);
  const notScanned = g.newHosts.filter((h) => !g.newHostsScanned.includes(h));
  const oldNotSeen = g.oldHosts.filter((h) => !g.oldHostsSeen.includes(h));
  return (
    <Panel
      title={`${g.label} — ${g.oldHosts.length} eski → ${g.newHosts.length} yeni sunucu`}
      description={
        <>
          eski: <span className="font-mono">{g.oldHosts.join(', ')}</span> · yeni:{' '}
          <span className="font-mono">{g.newHosts.join(', ')}</span>
        </>
      }
      dense
    >
      <div className="p-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="uygulama" value={nf(g.totals.apps)} hint="eski sunuculardaki SPA hedefleri" />
          <StatTile label="hazır" value={nf(g.totals.ready)} tone={g.totals.ready === g.totals.apps && g.totals.apps > 0 ? 'success' : 'neutral'} hint={STATUS.ready.hint} />
          <StatTile label="kısmi" value={nf(g.totals.partial)} tone={g.totals.partial ? 'warning' : 'neutral'} hint={STATUS.partial.hint} />
          <StatTile label="eksik" value={nf(g.totals.missing)} tone={g.totals.missing ? 'danger' : 'neutral'} hint={STATUS.missing.hint} />
          <StatTile label="SPA değil" value={nf(g.totals.nonSpa)} hint="API/arka uç hedefi — dizin beklenmez" />
          <StatTile label="çözülemedi" value={nf(g.totals.unresolved)} tone={g.totals.unresolved ? 'warning' : 'neutral'} hint="hedef (ns, app)'a eşlenemedi — aşağıda" />
        </div>

        {notScanned.length > 0 && (
          <Note tone="warning" title={`${notScanned.length} yeni sunucu henüz taranmadı`}>
            <span className="font-mono">{notScanned.join(', ')}</span> için dizin verisi yok; bu sütunlar{' '}
            <i>taranmadı</i> görünür ve hiçbir uygulama &quot;hazır&quot; sayılmaz. <Code>nginx_config_audit</Code>{' '}
            job&apos;ının bu sunucuları kapsayan sürümü koşmalı (Ansible 13f48b054).
          </Note>
        )}
        {oldNotSeen.length > 0 && g.oldHostsSeen.length > 0 && (
          <div className="text-[11px] text-[var(--text-muted)]">
            Eski sunuculardan tarama verisi olmayanlar: <span className="font-mono">{oldNotSeen.join(', ')}</span>
          </div>
        )}
        {g.oldHostsSeen.length === 0 && (
          <Note tone="warning" title="Eski sunuculardan proxy kaydı yok">
            Bu gruptaki hiçbir eski sunucu için proxy satırı bulunamadı; karşılaştırılacak uygulama listesi boş.
          </Note>
        )}

        <div className="overflow-x-auto">
          <table className="text-[11px] w-full">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="text-left pr-3 pb-1">Uygulama</th>
                <th className="text-left pr-3 pb-1">Namespace</th>
                <th className="text-left pr-3 pb-1">Durum</th>
                <th className="text-left pr-3 pb-1" title="eski sunucudaki vhost / location sayısı">Eski taraf</th>
                {g.newHosts.map((h) => (
                  <th key={h} className="text-center px-1.5 pb-1 font-mono whitespace-nowrap" title={g.newHostsScanned.includes(h) ? 'tarandı' : 'henüz taranmadı'}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.namespace + '/' + a.application} className="border-t border-[var(--border-subtle)]">
                  <td className="pr-3 py-1 font-mono whitespace-nowrap" title={`hedef: ${a.target} · çözüm: ${a.how === 'route' ? 'route adresi (kesin)' : 'OpenShift envanter çifti'}`}>
                    {a.application}
                  </td>
                  <td className="pr-3 py-1 font-mono text-[var(--text-muted)] whitespace-nowrap">{a.namespace}</td>
                  <td className="pr-3 py-1">
                    <Pill tone={STATUS[a.status].tone} title={STATUS[a.status].hint}>
                      {STATUS[a.status].label} {a.status !== 'not-scanned' && `${a.readyHosts}/${g.newHosts.length}`}
                    </Pill>
                  </td>
                  <td className="pr-3 py-1 text-[var(--text-muted)] whitespace-nowrap" title={`${a.oldHosts.join(', ')}\n${a.locations.join('\n')}`}>
                    {a.services.join(', ')} · {nf(a.locationCount)} location · {a.oldHosts.length} sunucu
                  </td>
                  {g.newHosts.map((h) => (
                    <td key={h} className="text-center px-1.5 py-1">
                      <DirCell f={a.perHost[h]} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4 + g.newHosts.length} className="py-2 text-[var(--text-muted)]">
                  {onlyProblem ? 'Hazır olmayan uygulama yok.' : 'Uygulama yok.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {g.unresolved.length > 0 && (
          <OtherList
            title={`Çözülemeyen hedefler (${nf(g.unresolved.length)})`}
            hint="SPA kalıbında ama ne route envanterinde ne OpenShift envanterinde karşılığı var — kaldırılmış olabilir ya da envanter eksik"
            rows={g.unresolved}
            tone="warning"
          />
        )}
        {g.nonSpa.length > 0 && (
          <OtherList
            title={`SPA olmayan hedefler (${nf(g.nonSpa.length)})`}
            hint="API / arka uç servisleri: yeni sunucuda dizin beklenmez, proxy tanımıyla taşınır"
            rows={g.nonSpa}
            tone="neutral"
          />
        )}
      </div>
    </Panel>
  );
}

function DirCell({ f }: { f: { hys: boolean; app: boolean; conf: boolean } | null | undefined }) {
  if (f === null) return <span className="text-[10px] text-[var(--text-muted)]" title="bu sunucu henüz taranmadı">taranmadı</span>;
  if (!f) return <span className="text-[var(--text-muted)]">—</span>;
  const ok = f.hys && f.app;
  const flag = (v: boolean, ch: string, what: string) => (
    <span className={v ? 'text-emerald-700 font-semibold' : 'text-red-600'} title={`${what}: ${v ? 'var' : 'YOK'}`}>
      {v ? ch : ch.toLowerCase()}
    </span>
  );
  return (
    <span className={`inline-flex gap-0.5 font-mono text-[11px] px-1 rounded ${ok ? 'bg-emerald-50' : 'bg-red-50'}`} title={ok ? 'hazır' : 'eksik'}>
      {flag(f.hys, 'H', '/hysdeploy/<ns>/<app>')}
      {flag(f.app, 'A', '/usr/nginx/applications/<ns>/<app>')}
      {flag(f.conf, 'C', 'application-confs/<app>-<ns>.conf')}
    </span>
  );
}

function OtherList({ title, hint, rows, tone }: { title: string; hint: string; rows: NginxMigrationOther[]; tone: 'warning' | 'neutral' }) {
  return (
    <details>
      <summary className={`text-[11px] cursor-pointer select-none ${tone === 'warning' ? 'text-amber-700' : 'text-[var(--text-muted)]'}`}>
        {title} — {hint}
      </summary>
      <table className="text-[11px] w-full mt-1">
        <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="text-left pr-3 pb-1">Hedef</th>
            <th className="text-left pr-3 pb-1">Çözüm</th>
            <th className="text-left pr-3 pb-1">Servis</th>
            <th className="text-left pb-1">Eski sunucu / location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.target} className="border-t border-[var(--border-subtle)]">
              <td className="pr-3 py-0.5 font-mono break-all">{r.target}</td>
              <td className="pr-3 py-0.5 text-[var(--text-muted)]">
                {r.namespace && r.application ? `${r.namespace}/${r.application}` : r.how === 'ambiguous' ? `belirsiz: ${(r.candidates || []).join(' | ')}` : 'eşleşme yok'}
              </td>
              <td className="pr-3 py-0.5">{r.services.join(', ')}</td>
              <td className="py-0.5 text-[var(--text-muted)]" title={r.locations.join('\n')}>{r.oldHosts.length} sunucu · {nf(r.locationCount)} location</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
