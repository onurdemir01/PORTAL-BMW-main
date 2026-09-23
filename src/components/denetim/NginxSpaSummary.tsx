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
import { Modal } from '@/components/common/Modal';
import { toast } from '@/hooks/useToast';
import { OwnerCell } from './OwnerCell';
import { UsersIcon, ArrowDownTrayIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import type { SpaMissingApp, NginxMigrationApp, NginxMigrationGroup, RouteOfIp } from '@/api/denetimApi';
import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { downloadCsv as csvIndir } from '@/utils/csv';

/** Pencerede listelenen satir: (uygulama, namespace'ler, ekip, eksik ne) - uc kaynak tek sekle iner. */
interface MissingRow {
  app: string;
  namespaces: string[];
  owner: SpaMissingApp['owner'];
  what: string;
  detail?: string;
  /** Tum ortamlari birlestiren pencerede satirin ortami / katmani (2026-09-17) */
  env?: string;
  tier?: string;
}

/**
 * "Deploy olmamis uygulamalar + sahiplik" penceresi (kullanici, 2026-09-17: "tanimsiz
 * uygulamalarin sahiplerine gidip deployment gecmelerini isteyecegim"). Arama, CSV,
 * e-postalari tek tikla panoya (noktali virgulle - Outlook'a yapistirilir).
 */
function MissingAppsModal({ title, subtitle, rows, ownersReady, onClose }: {
  title: string; subtitle: string; rows: MissingRow[]; ownersReady: boolean; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const hasEnv = rows.some((r) => r.env);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => !n || r.app.toLowerCase().includes(n) || r.namespaces.some((x) => x.includes(n)) || r.owner.groups.some((g) => g.toLowerCase().includes(n)) || r.owner.emails.some((e) => e.toLowerCase().includes(n)) || (r.env || '').toLowerCase().includes(n) || (r.tier || '').toLowerCase().includes(n));
  }, [rows, q]);
  const emails = useMemo(() => [...new Set(list.flatMap((r) => r.owner.emails))], [list]);
  const teams = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of list) m.set(r.owner.groups[0] || '(ekip bilinmiyor)', (m.get(r.owner.groups[0] || '(ekip bilinmiyor)') || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(emails.join('; '));
      toast.success(`${emails.length} e-posta adresi panoya kopyalandı.`);
    } catch {
      toast.error('Panoya kopyalanamadı; CSV indirip oradan alın.');
    }
  };
  const csv = () =>
    csvIndir(
      title.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      ['ortam', 'katman', 'uygulama', 'namespace', 'ekip', 'eposta', 'eksik', 'ayrinti'],
      list.map((r) => [
        r.env || '', r.tier || '', r.app, r.namespaces.join(' '),
        r.owner.groups.join(' | '), r.owner.emails.join(' | '), r.what, r.detail || '',
      ]),
    );
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={UsersIcon}
      size="wide"
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {fmtNumber(list.length)} uygulama · {fmtNumber(emails.length)} farklı e-posta
            {!ownersReady && <span style={{ color: 'var(--status-warning)' }}> · sahiplik tablosu okunamadı (dbo.Openshift_Namespace_Owners)</span>}
          </span>
          <div className="flex gap-2">
            <button onClick={csv} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]">
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={copyEmails} disabled={emails.length === 0} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
              <ClipboardDocumentIcon className="w-3.5 h-3.5" /> E-postaları kopyala
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama, namespace, ekip ya da e-posta ara" className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-72 bg-[var(--bg-surface)]" />
          <span className="flex flex-wrap gap-1 text-[11px]">
            {teams.slice(0, 8).map(([t, n]) => (
              <button key={t} onClick={() => setQ(t === '(ekip bilinmiyor)' ? '' : t)} className="px-1.5 py-0.5 rounded border hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }} title="bu ekibe süz">
                {t} <b>{n}</b>
              </button>
            ))}
          </span>
        </div>
        <div className="overflow-auto max-h-[70vh] rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <tr>
                {hasEnv && <th className="text-left px-2 py-1.5 font-semibold">Ortam</th>}
                <th className="text-left px-2 py-1.5 font-semibold">Uygulama</th>
                <th className="text-left px-2 py-1.5 font-semibold">Namespace</th>
                <th className="text-left px-2 py-1.5 font-semibold" title="namespace'in CMDB sahibi (dbo.Openshift_Namespace_Owners)">Ekip</th>
                <th className="text-left px-2 py-1.5 font-semibold">E-posta</th>
                <th className="text-left px-2 py-1.5 font-semibold">Eksik olan</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={(r.env || '') + (r.tier || '') + r.app + r.namespaces.join()} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  {hasEnv && <td className="px-2 py-1 whitespace-nowrap"><b style={{ color: 'var(--text-primary)' }}>{r.env}</b> <span style={{ color: 'var(--text-muted)' }}>{r.tier}</span></td>}
                  <td className="px-2 py-1 font-mono whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.app}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{r.namespaces.join(', ') || '—'}</td>
                  <td className="px-2 py-1"><OwnerCell owner={r.owner} ready={ownersReady} /></td>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-muted)' }}>{r.owner.emails.join(', ') || '—'}</td>
                  <td className="px-2 py-1 whitespace-nowrap" title={r.detail}>
                    <span>{r.what}</span>
                    {r.detail && <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.detail}</div>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={hasEnv ? 6 : 5} className="px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>{rows.length ? 'Aramaya uyan uygulama yok.' : 'Eksik uygulama yok — hepsi deploy olmuş.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

/** Bir IP'ye cozen route'lar: ortamla suzulu, SPA / SPA-disi / hepsi, arama, CSV. */
function IpRoutesModal({ ip, env, onClose }: { ip: string; env: string; onClose: () => void }) {
  const [rows, setRows] = useState<RouteOfIp[] | null>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<'all' | 'spa' | 'nonSpa'>('all');
  const [q, setQ] = useState('');
  // `useAsyncEffect`: `setRows(null)` effect govdesinde SENKRON calismasin
  // (React 19 `set-state-in-effect`). Iptal bayragi hook'tan gelir.
  useAsyncEffect(async (alive) => {
    setRows(null);
    await denetimApi.routesOfIp({ ip, env, kind: 'all' })
      .then((r) => { if (!alive()) return; if (r.ok) setRows(r.rows); else setErr(r.message || 'Route listesi alınamadı.'); })
      .catch((e: unknown) => alive() && setErr(e instanceof Error ? e.message : String(e)));
  }, [ip, env]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => (kind === 'all' || r.kind === kind) && (!n || r.namespace.includes(n) || r.address.toLowerCase().includes(n) || r.route.toLowerCase().includes(n)));
  }, [rows, kind, q]);
  const counts = useMemo(() => ({ all: rows?.length || 0, spa: rows?.filter((r) => r.kind === 'spa').length || 0, nonSpa: rows?.filter((r) => r.kind === 'nonSpa').length || 0 }), [rows]);
  const csv = () =>
    csvIndir(
      `${env}_${ip}_route`,
      ['ip', 'ortam', 'namespace', 'route', 'adres', 'tip', 'tur'],
      list.map((r) => [ip, env, r.namespace, r.route, r.address, r.type, r.kind]),
    );
  const KIND_LABEL = { all: 'hepsi', spa: 'SPA', nonSpa: 'SPA değil' } as const;
  return (
    <Modal open onClose={onClose} title={`${ip} → route’lar`} subtitle={`${env} ortamında bu IP’ye çözen route’lar (route_inventory nslookup)`} icon={GlobeAltIcon} size="wide"
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{rows ? `${fmtNumber(list.length)} route` : ''}</span>
          <button onClick={csv} disabled={!rows} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-50"><ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV</button>
        </div>
      }
    >
      <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="namespace, route ya da adres ara" className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-64 bg-[var(--bg-surface)]" />
          <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)]">
            {(['all', 'spa', 'nonSpa'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`px-2 py-0.5 text-[11px] rounded-md ${kind === k ? 'bg-[var(--bg-surface)] shadow-sm font-semibold' : ''}`} style={{ color: kind === k ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {KIND_LABEL[k]} <span className="tabular-nums">{fmtNumber(counts[k])}</span>
              </button>
            ))}
          </div>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        {!rows && !err && <LoadingLogo compact />}
        {rows && (
          <div className="overflow-auto max-h-[70vh] rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Namespace</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Route</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Adres</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Tip</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Tür</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={r.namespace + r.address + i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-2 py-1 font-mono whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{r.namespace}</td>
                    <td className="px-2 py-1 font-mono whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.route}</td>
                    <td className="px-2 py-1 font-mono">{r.address}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.type}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.kind === 'spa' ? 'SPA' : r.kind === 'nonSpa' ? 'SPA değil' : 'sınıflanamadı'}</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Route yok.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

const rowsFromCoverage = (list: SpaMissingApp[]): MissingRow[] =>
  list.map((x) => ({
    app: x.app, namespaces: x.namespaces, owner: x.owner,
    what: x.kind === 'partial' ? 'yarım kurulum'
      : x.kind === 'noroute' ? 'route bilgisi yok'
      : x.kind === 'notdeployed' ? 'deploy edilmemiş (H+A yok)'
      : x.kind === 'notdefined' ? 'deploy edilmiş, servis tanımı yok'
      : x.kind === 'nopackage' ? 'tanımı var, paketi yok (404)'
      : 'hiç deploy olmamış',
    detail: x.kind === 'partial'
      ? (x.hosts || []).map((h) => `${h.host}: ${h.missing.join(', ')} yok`).join(' · ')
      : x.kind === 'noroute' ? (x.inNginx ? 'nginx’te yine de tanımlı (eski sunucuda proxy / include)' : 'nginx’te tanımı da yok')
      : x.kind === 'notdeployed' ? (x.defined ? 'servis tanımı var — paket gelince yük alır' : 'servis tanımı da yok')
      : x.kind === 'notdefined' ? 'paket olan sunucular: ' + (x.hosts || []).map((h) => h.host).join(', ')
      : undefined,
  }));

/** "route'suz N" baglantisi: OpenShift'te olup route envanterinde kaydi olmayan SPA'lar (sahiplikle). */
function NoRouteLink({ c, env, onOpen }: { c: SpaCoverageRow; env: string; onOpen: (o: { title: string; subtitle: string; rows: MissingRow[] }) => void }) {
  return (
    <button
      onClick={() => onOpen({
        title: `${env} · route’suz SPA’lar`,
        subtitle: `${fmtNumber(c.unknownTotal)} uygulama OpenShift envanterinde var ama route envanterinde (route_inventory) kaydı yok — internet/intranet sınıflandırılamıyor, kapsam hesabına girmiyor`,
        rows: rowsFromCoverage(c.missingDetail?.noRoute || []),
      })}
      className="underline decoration-dotted"
      style={{ color: 'var(--status-warning)' }}
      title="tıklayın: route’suz SPA’lar sahipleriyle listelensin"
    >
      route’suz {fmtNumber(c.unknownTotal)}
    </button>
  );
}
const rowsFromMigration = (groups: NginxMigrationGroup[]): MissingRow[] =>
  groups.flatMap((g) => g.apps.filter((a: NginxMigrationApp) => a.status !== 'ready').map((a) => ({
    app: a.application, namespaces: [a.namespace], owner: a.owner || { groups: [], emails: [], unknownNs: [a.namespace] },
    what: a.status === 'missing' ? 'hiçbir yeni sunucuda yok' : a.status === 'partial' ? `kısmi (${a.readyHosts}/${g.newHosts.length} sunucu hazır)` : 'yeni sunucular taranmadı',
    detail: g.newHosts.filter((h) => { const f = a.perHost[h]; return !(f && f.hys && f.app); }).map((h) => `${h}${a.perHost[h] === null ? ' (taranmadı)' : ''}`).join(', '),
  })));

const ENV_ORDER = ['DEV', 'TEST', 'QA', 'EDU', 'PROD'];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const pctText = (p: number | null) => (p === null ? '—' : `%${fmtNumber(p)}`);
const toneOf = (p: number | null) =>
  p === null ? 'var(--text-muted)' : p >= 90 ? 'var(--status-success)' : p >= 60 ? 'var(--status-warning)' : 'var(--status-danger)';

/** Oran cubugu: dolu kisim + yuzde. Olculemediyse tarali. */
function Bar({ value, total, measured = true, title }: { value: number; total: number; measured?: boolean; title?: string }) {
  const p = measured ? pct(value, total) : null;
  return (
    <span className="inline-flex items-center gap-2 w-full" title={title}>
      <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)', minWidth: 48 }}>
        {measured ? (
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p || 0)}%`, background: toneOf(p) }} />
        ) : (
          <span
            className="block h-full w-full"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--border) 0 4px, transparent 4px 8px)' }}
          />
        )}
      </span>
      <span className="text-[11px] font-semibold tabular-nums w-12 text-right" style={{ color: measured ? toneOf(p) : 'var(--text-muted)' }}>
        {measured ? pctText(p) : 'ölçülemedi'}
      </span>
    </span>
  );
}

/** Servis paletleri: sabit sira, farkli tonlar (GLOMO her ortamda ayni renk olsun diye ada gore). */
const SERVICE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563', '#65a30d'];
function serviceColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}

/** Internet SPA'larinin nginx SERVISI (vhost) kirilimi: bolunmus cubuk + etiketler.
 *  Genislik internete acik toplam SPA'ya gore (bos kalan = tanimsiz). */
function ServiceBar({ total, services, multi }: { total: number; services: { service: string; count: number }[]; multi: number }) {
  const sum = services.reduce((a, x) => a + x.count, 0);
  return (
    <div className="mt-1" title="servise tanımlı SPA’lar hangi vhost’un (GLOMO, WEBFORMS, SAKLAMA…) altında; % = internete açık SPA’ların payı">
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>servis kırılımı <span className="normal-case">(% = internete açık SPA’ların payı)</span></div>
      <div className="h-2 rounded-full overflow-hidden flex mt-0.5" style={{ background: 'var(--bg-elevated)' }}>
        {services.map((x) => (
          <span key={x.service} className="h-full" style={{ width: `${total ? Math.min(100, (x.count / total) * 100) : 0}%`, background: serviceColor(x.service) }} title={`${x.service}: ${fmtNumber(x.count)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {services.map((x) => (
          <span key={x.service} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: serviceColor(x.service) }} />
            {x.service} <b className="tabular-nums">{fmtNumber(x.count)}</b>
            <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>({pctText(pct(x.count, total))})</span>
          </span>
        ))}
        {multi > 0 && (
          <span style={{ color: 'var(--text-muted)' }} title="bu uygulamalar birden fazla servisin altında tanımlı; her serviste sayıldı">
            ({fmtNumber(multi)} uygulama birden fazla serviste; servis toplamı {fmtNumber(sum)})
          </span>
        )}
      </div>
    </div>
  );
}

/** Tiklanabilir hucre govdesi: eksik varsa "N <missingLabel> → listele" ipucu, yoksa duz.
 *  missingLabel (2026-09-18): uc internet satirinin "eksik"i farkli seydir (deploy edilmemis /
 *  deploy edilmis ama tanimsiz / tanimli ama paketi yok) - ayni "N eksik" yazisi kafa karistirdi. */
function ClickCell({ count, disabled = false, onClick, children, missingLabel = 'eksik' }: { count: number; disabled?: boolean; onClick: () => void; children: React.ReactNode; missingLabel?: string }) {
  if (disabled) return <div className="space-y-1">{children}</div>;
  return (
    <button
      onClick={onClick}
      className="block w-full text-left space-y-1 rounded-lg -mx-1 px-1 py-0.5 hover:bg-[var(--bg-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      title={count > 0 ? `${fmtNumber(count)} uygulama ${missingLabel} — tıklayın, sahipleriyle listelensin` : 'eksik yok'}
    >
      {children}
      {count > 0 && (
        <span className="block text-[11px] underline decoration-dotted" style={{ color: 'var(--accent)' }}>{fmtNumber(count)} {missingLabel} → sahipleriyle listele</span>
      )}
    </button>
  );
}

/** Olcunun SUNUCUDA hangi dosyaya baktigi — kullanici (2026-09-21) sayilarin anlamini dosya
 *  duzeyinde gormek istedi. Her barin altinda tek satir, monospace. */
function Where({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-mono leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

function Big({ n, of, label }: { n: number; of?: number; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <b className="text-base tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtNumber(n)}</b>
      {of !== undefined && <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>/ {fmtNumber(of)}</span>}
      {label && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</span>}
    </span>
  );
}

function IpCell({ e, onPick }: { e: RouteStatsEnv; onPick: (ip: string) => void }) {
  const [open, setOpen] = useState(false);
  const ips = e.spaIps;
  if (ips.length === 0 && !e.unresolvedIp.spa) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const shown = open ? ips : ips.slice(0, 3);
  return (
    <div className="space-y-0.5">
      {shown.map((x) => (
        // IP tiklanir: bu IP'ye cozen route'lar pencerede (kullanici, 2026-09-17)
        <button key={x.ip} onClick={() => onPick(x.ip)} className="flex items-center gap-1.5 whitespace-nowrap rounded px-0.5 hover:bg-[var(--bg-elevated)]" title={`örnek: ${x.samples.join(', ')} — tıklayın, bu IP’ye çözen route’lar listelensin`}>
          <span className="font-mono text-[11px] underline decoration-dotted" style={{ color: 'var(--text-primary)' }}>{x.ip}</span>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>×{fmtNumber(x.count)}</span>
        </button>
      ))}
      {e.unresolvedIp.spa > 0 && (
        <div className="text-[11px]" style={{ color: 'var(--status-warning)' }} title="nslookup sonucu boş">çözülmeyen {fmtNumber(e.unresolvedIp.spa)}</div>
      )}
      {ips.length > 3 && (
        <button onClick={() => setOpen(!open)} className="text-[11px] underline decoration-dotted" style={{ color: 'var(--text-muted)' }}>
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
  // Tiklanan hucre -> eksik uygulamalar penceresi
  const [open, setOpen] = useState<{ title: string; subtitle: string; rows: MissingRow[] } | null>(null);
  const [ipOpen, setIpOpen] = useState<{ ip: string; env: string } | null>(null);

  // `useAsyncEffect`: is effect flush'indan SONRAKI mikro-goreve ertelenir, yani
  // `setLoading(true)` effect govdesinde SENKRON degildir (React 19'un
  // `set-state-in-effect` kurali bunu isaretliyordu). Iptal de hook'tan gelir.
  useAsyncEffect(async (alive) => {
    setLoading(true);
    // Uc uc BAGIMSIZ: biri dusse de digerleri gosterilir (route tablosu yoksa sutun "—").
    await Promise.allSettled([denetimApi.spaCoverage('ark'), denetimApi.routeStats('ark'), denetimApi.nginxMigration()])
      .then(([c, r, m]) => {
        if (!alive()) return;
        if (c.status === 'fulfilled' && c.value.ok) setCov(c.value);
        else setErr(c.status === 'fulfilled' ? c.value.message || 'Kapsam verisi alınamadı.' : String(c.reason));
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
        const ia = ENV_ORDER.indexOf(a[0]), ib = ENV_ORDER.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
      })
      .map(([env, v]) => ({ env, ...v }));
  }, [cov, routes]);

  // PROD: yeni sunucularda yuk almaya hazir olanlar (Production Tasimalari ile ayni hesap)
  const prodNew = useMemo(() => {
    if (!mig) return null;
    const t = { apps: 0, ready: 0, locTotal: 0, locDefined: 0, scanned: false, unscanned: [] as string[] };
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
  // Tum ortamlar + iki katman + PROD yeni sunucular tek listede (sahiplerine ulasmak icin)
  const allMissing = useMemo<MissingRow[]>(() => {
    const out: MissingRow[] = [];
    for (const { env, cov: c } of rows) {
      if (!c) continue;
      // internet: deploy edilmemisler (ekibin isi). Dizin taramasi yoksa eski olcu (tanimi olmayanlar).
      if (c.internetDirsMeasured) out.push(...rowsFromCoverage(c.missingDetail?.notDeployed || []).map((x) => ({ ...x, env, tier: 'internet' })));
      else if (c.measured) out.push(...rowsFromCoverage(c.missingDetail?.internet || []).map((x) => ({ ...x, env, tier: 'internet' })));
      if (c.measuredIntranet) out.push(...rowsFromCoverage(c.missingDetail?.intranet || []).map((x) => ({ ...x, env, tier: 'intranet' })));
    }
    if (mig) out.push(...rowsFromMigration(mig.groups).map((x) => ({ ...x, env: 'PROD', tier: 'yeni sunucu' })));
    return out;
  }, [rows, mig]);

  if (err && !cov)
    return <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (loading && !cov)
    return <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Ortam özeti yükleniyor…</div>;
  if (!cov) return null;

  const isIntra = tier === 'intranet';
  // Secili katmanin sutunu vurgulu; digeri soluk (ama gorunur - iki katman tek tabloda).
  const hl = (col: 'internet' | 'intranet') =>
    (col === 'intranet') === isIntra ? undefined : { opacity: 0.55 };
  const th = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-left whitespace-nowrap';

  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <header className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ortam özeti — SPA’lar nerede?</h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            OpenShift’teki SPA sayısı → nginx’e çıkmış olanlar → route’lar. Toplam <b>{fmtNumber(spaAll)}</b> SPA (uygulama × ortam), ARK cluster’ları
            {cov.scanDate ? ` · nginx taraması ${cov.scanDate}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Katman fark etmeksizin TUM deploy olmamis / sorunlu uygulamalar + sahipleri
              (kullanici, 2026-09-17: "internet veya intranet fark etmez, sahiplerine ulasmak istiyorum") */}
          <button
            onClick={() => setOpen({ title: 'Deploy olmamış / sorunlu tüm SPA’lar ve sahipleri', subtitle: 'tüm ortamlar · internet (deploy edilmemiş: H+A yok) + intranet (hiç yok / yarım) + PROD yeni sunucular (hazır değil)', rows: allMissing })}
            disabled={allMissing.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
            title="Katman fark etmeksizin, tüm ortamlarda henüz deploy olmamış uygulamalar ve sahipleri (ekip, e-posta)"
          >
            <UsersIcon className="w-3.5 h-3.5" /> Sahiplerine ulaş · {fmtNumber(allMissing.length)}
          </button>
          {/* Katman adi KALIN ve renkli (kullanici, 2026-09-17): Internet mavi, Intranet yesil. */}
          <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
            vurgulu sütun:{' '}
            <b style={{ color: isIntra ? 'var(--status-success)' : 'var(--accent)' }}>{isIntra ? 'İntranet' : 'İnternet'}</b>
          </span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <th className={th}>Ortam</th>
              <th className={th} title="OpenShift’teki SPA uygulaması sayısı (adında -app-v / -app-emb-v geçenler) ve ortamdaki tüm uygulamalar içindeki payı">
                OpenShift SPA
              </th>
              <th className={th} style={hl('internet')} title="İnternete açık (route tipi passthrough) SPA’lar: kaçı internet nginx’lerine deploy edilmiş (H+A), kaçı servise tanımlı (location/include), kaçı ikisi birden (yük alıyor)">
                İnternet · deploy / tanım / çalışıyor
              </th>
              <th className={th} style={hl('intranet')} title="İntranet (route tipi reencrypt) SPA’ların kaçı intranet nginx’lerine TAM kurulu (hysdeploy + applications + conf)">
                İntranet · nginx’e kurulu
              </th>
              <th className={th} title="Ortamdaki route sayısı, kaçı SPA uygulamasına ait ve payı">Route’lar</th>
              <th className={th} title="SPA route’larının çözdüğü IP’ler (route_inventory nslookup) ve her IP’ye düşen route sayısı">SPA route → IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ env, cov: c, route: r }) => {
              const spaShare = c ? pct(c.spaTotal, c.ocpApps) : null;
              return (
                <tr key={env} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{env}</td>
                  <td className="px-3 py-2.5">
                    {c ? (
                      <div className="space-y-0.5">
                        <Big n={c.spaTotal} label="SPA" />
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          OpenShift envanterindeki <b style={{ color: 'var(--text-secondary)' }}>{fmtNumber(c.ocpApps)}</b> uygulamanın <b style={{ color: 'var(--text-secondary)' }}>{pctText(spaShare)}</b>’i SPA
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          internete açık {fmtNumber(c.internetTotal)} · iç ağda {fmtNumber(c.intranetTotal)}
                          {c.unknownTotal ? <> · <NoRouteLink c={c} env={env} onOpen={setOpen} /></> : null}
                        </div>
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5 min-w-[13rem]" style={hl('internet')}>
                    {c ? (
                      <div className="space-y-1">
                        {/* UC AYRI OLCU (kullanici, 2026-09-18): deploy edilmis (H+A) / servise tanimli / yuk aliyor.
                            Eskiden yalniz "tanimli" vardi ve deploy sanilip yanlis okunuyordu. */}
                        <ClickCell
                          disabled={!c.internetDirsMeasured}
                          count={c.internetNotDeployedCount || 0}
                          missingLabel="paketi hiçbir sunucuda yok (ilgili ekip dağıtmalı)"
                          onClick={() => setOpen({ title: `${env} · deploy edilmemiş internet SPA’ları`, subtitle: `${fmtNumber(c.internetNotDeployedCount || 0)} uygulama · internete açık hiçbir nginx sunucusunda /hysdeploy/<ns>/<app>/ + /usr/nginx/applications/<ns>/<app>/ (H+A) yok — ekipler deployment geçmeli`, rows: rowsFromCoverage(c.missingDetail?.notDeployed || []) })}
                        >
                          <Big n={c.internetDirsMeasured ? (c.internetDeployed || 0) : 0} of={c.internetTotal} label="paketi sunucuda duran uygulama" />
                          <Bar value={c.internetDeployed || 0} total={c.internetTotal} measured={!!c.internetDirsMeasured} title="internete açık nginx sunucusunda paket + dosyalar var / internete açık SPA" />
                          <Where>Uygulamanın paketi, {env === 'PROD' ? 'yeni GBNGX prod' : 'internete açık'} sunucuların en az birinde duruyor: <b>/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</b> ve <b>/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/</b> dizinlerinin ikisi de var.</Where>
                        </ClickCell>
                        <ClickCell
                          disabled={!c.measured}
                          count={c.internetDeployedNotDefinedCount || 0}
                          missingLabel="paketi var ama nginx tanımı yok (bizde)"
                          onClick={() => setOpen({ title: `${env} · deploy edilmiş ama servise tanımlanmamış SPA’lar`, subtitle: `${fmtNumber(c.internetDeployedNotDefinedCount || 0)} uygulama · paket sunucuda var (H+A) ama vhost’ta location/include tanımı yok — bizim işimiz: tanım oluştur`, rows: rowsFromCoverage(c.missingDetail?.deployedNotDefined || []) })}
                        >
                          <Big n={c.measured ? c.internetInNginx : 0} of={c.internetTotal} label={env === 'PROD' ? 'eski sunucuda nginx tanımı olan uygulama' : 'nginx tanımı olan uygulama'} />
                          <Bar value={c.internetInNginx} total={c.internetTotal} measured={c.measured} title="vhost’ta location/include tanımı var / internete açık SPA" />
                          <Where>{env === 'PROD'
                            ? <>Nginx, isteği bu uygulamaya yönlendirecek tanımı taşıyor: eski GBRVP sunucusundaki <b>/usr/nginx/conf.d/&lt;SERVİS&gt;-PROD.conf</b> dosyasında <b>location … {'{'} proxy_pass … {'}'}</b> bloğu var. Trafik hâlâ eski sunucudan geçiyor.</>
                            : <>Nginx, isteği bu uygulamaya yönlendirecek tanımı taşıyor: <b>/usr/nginx/conf.d/&lt;SERVİS&gt;-{env}.conf</b> dosyasında <b>location … {'{'} include application-confs/&lt;servis&gt;-&lt;app&gt;-&lt;ns&gt;.conf {'}'}</b> bloğu var.</>}</Where>
                          {c.measured && (c.internetServices || []).length > 0 && (
                            <ServiceBar total={c.internetTotal} services={c.internetServices || []} multi={c.internetMultiService || 0} />
                          )}
                        </ClickCell>
                        <ClickCell
                          disabled={!c.measured || !c.internetDirsMeasured}
                          count={c.internetDefinedNotDeployedCount || 0}
                          missingLabel="tanımı var ama paketi yok → 404 (ilgili ekip)"
                          onClick={() => setOpen({ title: `${env} · tanımı var ama paketi olmayan SPA’lar (404 riski)`, subtitle: `${fmtNumber(c.internetDefinedNotDeployedCount || 0)} uygulama · vhost’ta tanım var, internete açık sunucularda H+A yok — adres 404 döner`, rows: rowsFromCoverage(c.missingDetail?.definedNotDeployed || []) })}
                        >
                          <Big n={c.measured && c.internetDirsMeasured ? (c.internetServing || 0) : 0} of={c.internetTotal} label="hem paketi hem tanımı olan uygulama (hizmet veriyor)" />
                          <Bar value={c.internetServing || 0} total={c.internetTotal} measured={!!(c.measured && c.internetDirsMeasured)} title="ilk iki satırın kesişimi: paket sunucuda var VE vhost’ta tanımı var → istek gerçekten uygulamaya gidiyor / internete açık SPA" />
                          <Where>Üstteki iki ölçünün kesişimi: istek nginx’e ulaşır, tanım isteği karşılar, paket de yerindedir; kullanıcı sayfayı açabilir. Paket yoksa adres 404 döner (ilgili ekip dağıtım yapmalı), tanım yoksa istek uygulamaya hiç ulaşmaz (bizim işimiz).</Where>
                        </ClickCell>
                        {env === 'PROD' && prodNew && (
                          <div className="rounded-lg px-2 py-1.5 mt-1 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                            <div className="text-[11px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Yeni GBNGX sunucularına taşınma hazırlığı <span className="normal-case font-normal">— <b>ayrı bir liste</b></span></div>
                            <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                              Yukarıdaki üç ölçü <b>OpenShift’te internete açık {fmtNumber(c.internetTotal)} uygulamayı</b> anlatır. Buradaki sayılar ise farklı bir listeden gelir:
                              eski GBRVP sunucularının <b>proxy_pass</b> satırlarından çözülen <b>{fmtNumber(prodNew.apps)} (namespace, uygulama) çifti</b> — route kaydı olmayanlar da dâhildir ve
                              bir uygulama iki ayrı namespace’te geçiyorsa iki kez sayılır. Bu yüzden iki bölümdeki toplamlar birbirini tutmaz.
                            </div>
                            {prodNew.scanned ? (
                              <>
                                <ClickCell
                                  count={prodNew.apps - prodNew.ready}
                                  onClick={() => setOpen({ title: 'PROD · yeni sunuculara deploy olmamış SPA’lar', subtitle: `${fmtNumber(prodNew.apps - prodNew.ready)} uygulama · eski GBRVP* sunucusunda proxy ile sunuluyor, yeni GBNGXP* sunucularının hepsinde hysdeploy + applications dizini yok`, rows: rowsFromMigration(mig?.groups || []) })}
                                >
                                  <Big n={prodNew.ready} of={prodNew.apps} label="paketi, taranan tüm yeni sunucularda hazır" />
                                  <Bar value={prodNew.ready} total={prodNew.apps} title="Hazır sayılması için paketin, o servise ait taranmış her yeni sunucuda hem hysdeploy hem applications dizininde bulunması gerekir." />
                                </ClickCell>
                                <Where>Sayım evreni: eski GBRVP sunucularının proxy_pass listesi ({fmtNumber(prodNew.apps)} çift, route kaydı olmayanlar dâhil). “Hazır”, taşımadan sonra hiçbir yeni sunucuda 404 alınmayacağı anlamına gelir.</Where>
                                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                  Yeni sunucularda location tanımı yazılmış olan: <b style={{ color: 'var(--text-secondary)' }}>{fmtNumber(prodNew.locDefined)}</b> / {fmtNumber(prodNew.locTotal)} (ayrıntı: Production Taşımaları sekmesi)
                                </div>
                                {prodNew.unscanned.length > 0 && (
                                  <div className="text-[11px]" style={{ color: 'var(--status-warning)' }}>Henüz taranmayan sunucular: {prodNew.unscanned.join(', ')}</div>
                                )}
                              </>
                            ) : (
                              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Yeni sunucular henüz taranmadı.</div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5 min-w-[13rem]" style={hl('intranet')}>
                    {c ? (
                      <div className="space-y-1">
                        <ClickCell
                          disabled={!c.measuredIntranet}
                          count={c.intranetMissingCount + c.intranetPartialCount}
                          onClick={() => setOpen({ title: `${env} · intranet nginx’lerine kurulmamış SPA’lar`, subtitle: `${fmtNumber(c.intranetMissingCount)} hiç yok · ${fmtNumber(c.intranetPartialCount)} yarım (üç dizinden biri eksik)`, rows: rowsFromCoverage(c.missingDetail?.intranet || []) })}
                        >
                          <Big n={c.measuredIntranet ? c.intranetFull : 0} of={c.intranetTotal} label="kurulumu tamam olan uygulama" />
                          <Bar value={c.intranetFull} total={c.intranetTotal} measured={c.measuredIntranet} title="Gerekli üç dizin de yerinde olan iç ağ (intranet) uygulamaları." />
                        </ClickCell>
                        {c.measuredIntranet && (c.intranetPartialCount > 0 || c.intranetMissingCount > 0) && (
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {c.intranetPartialCount > 0 && <span style={{ color: 'var(--status-warning)' }} title="Üç dizinden en az biri eksik.">yarım kurulu: {fmtNumber(c.intranetPartialCount)}</span>}
                            {c.intranetPartialCount > 0 && c.intranetMissingCount > 0 && ' · '}
                            {c.intranetMissingCount > 0 && <span style={{ color: 'var(--status-danger)' }} title="Hiçbir dizini bulunamadı.">hiç kurulmamış: {fmtNumber(c.intranetMissingCount)}</span>}
                          </div>
                        )}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {r ? (
                      <div className="space-y-0.5">
                        <Big n={r.spa} of={r.routes} label="SPA uygulamasına ait route" />
                        <Bar value={r.spa} total={r.routes} title="SPA uygulamalarına ait route sayısının, ortamdaki tüm route’lara oranı." />
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          SPA olmayan route: {fmtNumber(r.nonSpa)}
                          {r.unclassified ? ` · sınıflandırılamayan: ${fmtNumber(r.unclassified)}` : ''}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {fmtNumber(r.namespaces)} namespace · TLS sonlandırma: {r.terminations.map((t) => (
                            // "yok" = route VAR ama TLS sonlandirma tipi bos; route'suz SPA ile karistirilmasin
                            <span key={t.type} title={t.type === 'yok' ? 'route var ama termination_type boş (TLS sonlandırma tanımsız)' : `termination_type = ${t.type}`}>{t.type === 'yok' ? 'TLS tipi yok' : t.type} {fmtNumber(t.count)} </span>
                          ))}
                        </div>
                        {c && c.unknownTotal > 0 && (
                          <div className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
                            <NoRouteLink c={c} env={env} onOpen={setOpen} /> — OpenShift’te bulunuyor ama route envanterinde kaydı yok
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }} title="route envanteri yok ya da bu ortamda route bulunamadı">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{r ? <IpCell e={r} onPick={(ip) => setIpOpen({ ip, env })} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Veri yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ipOpen && <IpRoutesModal ip={ipOpen.ip} env={ipOpen.env} onClose={() => setIpOpen(null)} />}
      {open && <MissingAppsModal title={open.title} subtitle={open.subtitle} rows={open.rows} ownersReady={cov.ownersReady !== false} onClose={() => setOpen(null)} />}
      <div className="px-4 py-2 border-t text-[11px] leading-relaxed" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
        <b>Tıklayın:</b> sayıya tıklayınca o ortamda henüz deploy olmamış uygulamalar ve sahipleri (ekip, e-posta), IP’ye tıklayınca o IP’ye çözen route’lar listelenir. <b>SPA</b> = OpenShift’te adında <code>-app-v</code>/<code>-app-emb-v</code> geçen uygulama; sayım uygulama × ortam. <b>İnternet</b> = route tipi passthrough; <b>deploy edilmiş</b> = internete açık sunucuda /hysdeploy + /usr/nginx/applications dizinleri (H+A), <b>servise tanımlı</b> = vhost’ta location/include (PROD’da eski GBRVP* sunucularının proxy_pass’i), <b>çalışıyor</b> = ikisi birden (kesişim; “deploy edilmiş − çalışıyor” = tanımsız olanlar, “servise tanımlı − çalışıyor” = paketi olmayanlar). <b>İntranet</b> = route tipi reencrypt, intranet nginx’lerinde üç dizin de yerindeyse “tam kurulu”. <b>Taralı</b> = o ortam için nginx kaydı yok, ölçülemedi.
        {routes?.routeTableMissing && <span style={{ color: 'var(--status-warning)' }}> Route envanteri okunamadı (route_inventory job’ı koşmalı).</span>}
      </div>
    </section>
  );
}
