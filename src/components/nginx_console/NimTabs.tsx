// src/components/nginx_console/NimTabs.tsx — Nginx Hub "Dashboard" ve "Instances" (2026-09-21).
//
// Kullanici: "F5'in NIM'deki Overview > Dashboard ve Manage > Instances ekranlarini Nginx Hub'a
// getir; UI/UX direkt o ekrana benzesin." NIM'de CPU/bellek/disk trendleri var; bizde canli metrik
// yok (Portal sunuculara yalniz Ansible ile ulasir). Onun yerine elimizdeki gercek veriler:
// sertifikalar (saglikli / suresi yaklasan / dolmus), surum dagilimi (Plus / Open Source), sunucu
// sayisi ve dokum tazeligi (Online = 2 gun icinde dokum), nginx -t, son degisiklikler.
// Gorsel dil NIM: beyaz kartlar, ince cerceve, baslik + bilgi simgesi, sol renkli dikey cubuklu
// buyuk sayilar, sagda "See all ->" baglantisi; Instances: onay kutulu tablo, Type/System Tags/
// Status/Last Status Report/Actions sutunlari, altta "N instances · Show 25 · sayfa".
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowDownTrayIcon, InformationCircleIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowRightIcon, EllipsisHorizontalIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { nginxConsoleApi, type NcHost, type NcCertsResult, type NcChange } from '@/api/nginxConsoleApi';
import { fmtRelative, fmtNumber, fmtDateTime } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const ONLINE_MS = 2 * 24 * 3600 * 1000;
const nf = (n: number) => fmtNumber(n);

/** "nginx/1.29.3 (nginx-plus-r35)" -> { type: 'NGINX Plus', version: '1.29.3', release: 'r35' } */
export function parseNginxVersion(v: string | null | undefined): { type: 'NGINX Plus' | 'Open Source' | 'Bilinmiyor'; version: string | null; release: string | null } {
  const s = String(v || '');
  if (!s || s === 'unknown') return { type: 'Bilinmiyor', version: null, release: null };
  const version = (s.match(/(\d+\.\d+\.\d+)/) || [])[1] || null;
  const release = (s.match(/plus[- ]?(r\d+(?:-p\d+)?)/i) || [])[1] || null;
  return { type: /plus/i.test(s) ? 'NGINX Plus' : 'Open Source', version, release: release ? release.toLowerCase() : null };
}
/** Online = son 2 gun icinde GORULDU (fetch job'i ulasti: _seen.json ya da yeni dokum). Onceden
 *  yalniz dokum mtime'ina bakiliyordu; parmak izi degismeyen sunucuda dokum yeniden yazilmadigi
 *  icin konfigurasyonu 2 gundur degismeyen her sunucu Offline gorunuyordu (kullanici, 2026-09-22). */
export function lastSeen(h: NcHost): string | null {
  const a = h.seenAt ? new Date(h.seenAt).getTime() : 0;
  const b = h.dumpedAt ? new Date(h.dumpedAt).getTime() : 0;
  const m = Math.max(a || 0, b || 0);
  return m > 0 ? new Date(m).toISOString() : null;
}
export function isOnline(h: NcHost, now = Date.now()): boolean {
  const s = lastSeen(h);
  return !!s && now - new Date(s).getTime() <= ONLINE_MS;
}
export const isProdEnv = (env: string | null | undefined) => /^prod/i.test(String(env || ''));
/** Sunucu adindan lokasyon (sunucu `site` vermediyse): tier harfinden sonra fazladan A = Ankara. */
export function siteOf(h: NcHost): 'Pendik' | 'Ankara' | null {
  if (h.site === 'Pendik' || h.site === 'Ankara') return h.site;
  const m = /^GBNG[WX](A?)[DTQP]/i.exec(h.host) || /^GBRVP(A?)P/i.exec(h.host);
  if (!m) return null;
  return m[1] ? 'Ankara' : 'Pendik';
}
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (typeof x === 'number' && Number.isFinite(x) ? x : 0), 0);

/** Halka grafik (Server Hub ile ayni cizim) */
function Donut({ parts, size = 104, label, sub }: { parts: { value: number; color: string; title: string }[]; size?: number; label: string; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 40, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="12" />
        {parts.filter((p) => p.value > 0).map((p, i) => {
          const len = (p.value / total) * c;
          const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)"><title>{p.title}: {p.value}</title></circle>;
          acc += len;
          return el;
        })}
        <text x="50" y="47" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)">{label}</text>
        {sub && <text x="50" y="62" textAnchor="middle" fontSize="8" fill="var(--text-muted)">{sub}</text>}
      </svg>
      <ul className="text-[11px] space-y-0.5">
        {parts.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} /> <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span> <b className="tabular-nums">{nf(p.value)}</b></li>
        ))}
      </ul>
    </div>
  );
}
const SITE_COLOR: Record<string, string> = { Pendik: 'var(--nginx-green)', Ankara: 'var(--accent)', Bilinmiyor: 'var(--status-warning)' };
function MiniBar({ value, total, color }: { value: number; total: number; color: string }) {
  return <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}><div className="h-full rounded-full" style={{ width: `${Math.round((value / Math.max(1, total)) * 100)}%`, background: color }} /></div>;
}

// ── NIM kart kabugu ─────────────────────────────────────────────────────────────────
function Card({ title, info, action, children, className = '' }: { title: string; info?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border flex flex-col ${className}`} style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <header className="flex items-center gap-2 px-5 pt-4 pb-2">
        <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {info && <InformationCircleIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} aria-label={info}><title>{info}</title></InformationCircleIcon>}
        <span className="ml-auto" />
        {action}
      </header>
      <div className="px-5 pb-4 flex-1">{children}</div>
    </section>
  );
}
function SeeAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="border-t px-5 py-2.5 text-right" style={{ borderColor: 'var(--border-subtle)' }}>
      <button onClick={onClick} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{label} <ArrowRightIcon className="w-3.5 h-3.5" /></button>
    </div>
  );
}
/** NIM sertifika karti: sol renkli dikey cubuk + buyuk sayi + etiket */
function BigStat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="flex items-stretch gap-3">
      <div className="w-1 rounded-sm" style={{ background: color }} />
      <div><div className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>{nf(n)}</div><div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div></div>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 text-[12px] font-semibold ${right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>{children}</th>;
}
const StatusCell = ({ online }: { online: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-[13px]">
    {online ? <CheckCircleIcon className="w-4 h-4" style={{ color: 'var(--status-success)' }} /> : <ExclamationTriangleIcon className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />}
    {online ? 'Online' : 'Offline'}
  </span>
);

// ── Dashboard ───────────────────────────────────────────────────────────────────────
export function DashboardTab({ hosts, onGo }: { hosts: NcHost[]; onGo: (tab: 'instances' | 'certs' | 'changes' | 'config', host?: string) => void }) {
  const [certs, setCerts] = useState<NcCertsResult | null>(null);
  const [changes, setChanges] = useState<NcChange[]>([]);
  useEffect(() => {
    nginxConsoleApi.certs().then((r) => r.ok && setCerts(r)).catch(() => {});
    nginxConsoleApi.changes({ limit: 8 }).then((r) => r.ok && setChanges(r.changes || [])).catch(() => {});
  }, []);
  const now = Date.now();
  const online = hosts.filter((h) => isOnline(h, now)).length;
  const tFail = hosts.filter((h) => h.nginxT === 'fail');
  const noDump = hosts.filter((h) => !h.dumpedAt).length;
  const unknownT = hosts.filter((h) => h.dumpedAt && h.nginxT !== 'ok' && h.nginxT !== 'fail').length;
  // Kaynaklar (dbo.Inventory cpu/memory): ortam bazinda toplam vCPU / GB; verisi olmayanlar sayilir
  const res = useMemo(() => {
    const m = new Map<string, { n: number; cpu: number; mem: number; missing: number }>();
    for (const h of hosts) { const k = h.env || '—'; const e = m.get(k) || { n: 0, cpu: 0, mem: 0, missing: 0 }; e.n += 1; e.cpu += sum([h.cpu]); e.mem += sum([h.memoryGb]); if (h.cpu == null && h.memoryGb == null) e.missing += 1; m.set(k, e); }
    return [...m.entries()].sort((a, b) => b[1].cpu - a[1].cpu);
  }, [hosts]);
  const totCpu = sum(hosts.map((h) => h.cpu)), totMem = sum(hosts.map((h) => h.memoryGb)), resMissing = hosts.filter((h) => h.cpu == null && h.memoryGb == null).length;
  const oses = useMemo(() => { const m = new Map<string, number>(); for (const h of hosts) { const k = h.os || 'bilinmiyor'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [hosts]);
  // Production: Pendik / Ankara
  const prod = useMemo(() => hosts.filter((h) => isProdEnv(h.env)), [hosts]);
  const sites = useMemo(() => {
    const m = new Map<string, { n: number; online: number; cpu: number; mem: number; tFail: number }>();
    for (const h of prod) { const k = siteOf(h) || 'Bilinmiyor'; const e = m.get(k) || { n: 0, online: 0, cpu: 0, mem: 0, tFail: 0 }; e.n += 1; if (isOnline(h, now)) e.online += 1; e.cpu += sum([h.cpu]); e.mem += sum([h.memoryGb]); if (h.nginxT === 'fail') e.tFail += 1; m.set(k, e); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [prod, now]);
  const oss = hosts.filter((h) => parseNginxVersion(h.nginxVersion).type === 'Open Source').length;
  const versions = useMemo(() => {
    const m = new Map<string, { type: string; version: string; n: number }>();
    for (const h of hosts) { const p = parseNginxVersion(h.nginxVersion); const key = `${p.type}|${p.version || '?'}${p.release ? ' ' + p.release : ''}`; const e = m.get(key) || { type: p.type, version: `${p.version || '?'}${p.release ? ` (${p.release})` : ''}`, n: 0 }; e.n += 1; m.set(key, e); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [hosts]);
  const plus = hosts.filter((h) => parseNginxVersion(h.nginxVersion).type === 'NGINX Plus').length;
  const envs = useMemo(() => {
    const m = new Map<string, { n: number; online: number }>();
    for (const h of hosts) { const k = h.env || '—'; const e = m.get(k) || { n: 0, online: 0 }; e.n += 1; if (isOnline(h, now)) e.online += 1; m.set(k, e); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [hosts, now]);
  const soon = useMemo(() => (certs?.certs || []).filter((c) => c.daysLeft != null).sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number)).slice(0, 5), [certs]);
  const healthy = certs ? certs.summary.total - certs.summary.expired - certs.summary.within30 - certs.summary.missing : 0;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Sertifikalar" info="Dokumu alınan tüm sunuculardaki sertifikalar (aynı sertifika birden çok sunucuda tek sayılır).">
        {!certs ? <LoadingLogo compact /> : (
          <div className="space-y-5 py-1">
            <BigStat n={Math.max(0, healthy)} label="Sağlıklı" color="var(--status-success)" />
            <BigStat n={certs.summary.within30} label="Süresi yaklaşan (≤30 gün)" color="var(--status-warning)" />
            <BigStat n={certs.summary.expired} label="Süresi dolmuş" color="var(--status-danger)" />
            {certs.summary.missing > 0 && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{certs.summary.missing} sertifika dosyası konfigürasyonda geçiyor ama sunucuda yok.</div>}
          </div>
        )}
        <div className="-mx-5 -mb-4 mt-2"><SeeAll label="Tüm sertifikalar" onClick={() => onGo('certs')} /></div>
      </Card>

      <Card title="Süresi yaklaşan sertifikalar" info="En yakın bitiş tarihine göre ilk 5." className="xl:col-span-2">
        <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr><Th>Sertifika (CN)</Th><Th>Veren</Th><Th>Sunucu</Th><Th right>Kalan gün</Th></tr></thead>
            <tbody>
              {soon.length === 0 ? <TableEmptyRow colSpan={4} title="Sertifika verisi yok." /> : soon.map((c) => (
                <tr key={c.fingerprint || c.cn || String(c.hosts[0]?.path)} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2"><div className="truncate max-w-[18rem]" title={c.cn || c.subject || ''}>{c.cn || c.subject || (c.hosts[0]?.path ?? '—')}</div></td>
                  <td className="px-3 py-2"><div className="truncate max-w-[12rem]" title={c.issuerCn || c.issuer || ''} style={{ color: 'var(--text-secondary)' }}>{c.issuerCn || c.issuer || '—'}</div></td>
                  <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{c.hosts.length === 1 ? c.hosts[0].host : `${c.hosts.length} sunucu`}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: (c.daysLeft as number) < 0 ? 'var(--status-danger)' : (c.daysLeft as number) <= 30 ? 'var(--status-warning)' : 'var(--status-success)' }}>{c.daysLeft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="-mx-5 -mb-4 mt-3"><SeeAll label="Daha fazla" onClick={() => onGo('certs')} /></div>
      </Card>

      <Card title="Sunucular" info="Envanterdeki nginx sunucuları; Online = fetch job'ı son 2 gün içinde ulaştı (konfigürasyon değişmese de). nginx -t sonucu son dokumdan.">
        <div className="space-y-5 py-1">
          <BigStat n={hosts.length} label="Toplam sunucu" color="var(--accent)" />
          <BigStat n={online} label="Online (dokum ≤ 2 gün)" color="var(--status-success)" />
          <BigStat n={hosts.length - online} label="Offline (2 gündür ulaşılamadı)" color="var(--status-warning)" />
          <BigStat n={tFail.length} label="nginx -t başarısız" color="var(--status-danger)" />
          {(noDump > 0 || unknownT > 0) && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{noDump > 0 && <>{nf(noDump)} sunucunun dokumu hiç alınmamış. </>}{unknownT > 0 && <>{nf(unknownT)} dokumda nginx -t sonucu yok.</>}</div>}
        </div>
        <div className="-mx-5 -mb-4 mt-2"><SeeAll label="Tüm sunucular" onClick={() => onGo('instances')} /></div>
      </Card>

      <Card title="Sürümler" info="Envanter nginx -v çıktısından: NGINX Plus / Open Source ve sürüm dağılımı.">
        <div className="mb-3"><Donut label={nf(hosts.length)} sub="sunucu" parts={[{ value: plus, color: 'var(--nginx-green)', title: 'NGINX Plus' }, { value: oss, color: 'var(--accent)', title: 'Open Source' }, { value: hosts.length - plus - oss, color: 'var(--status-warning)', title: 'Bilinmiyor' }]} /></div>
        <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr><Th>Tür</Th><Th>Sürüm</Th><Th right>Sunucu</Th><Th>Dağılım</Th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.type + v.version} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2">{v.type}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{v.version}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(v.n)}</td>
                  <td className="px-3 py-2 w-32"><div className="h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}><div className="h-full rounded-full" style={{ width: `${Math.round((v.n / Math.max(1, hosts.length)) * 100)}%`, background: 'var(--nginx-green)' }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Ortamlar" info="Envanter env alanına göre sunucu sayısı ve online oranı.">
        <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr><Th>Ortam</Th><Th right>Sunucu</Th><Th right>Online</Th><Th>Oran</Th></tr></thead>
            <tbody>
              {envs.map(([env, e]) => (
                <tr key={env} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold">{env}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(e.n)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(e.online)}</td>
                  <td className="px-3 py-2 w-32"><div className="h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}><div className="h-full rounded-full" style={{ width: `${Math.round((e.online / Math.max(1, e.n)) * 100)}%`, background: 'var(--status-success)' }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Kaynaklar" info="dbo.Inventory (middleware_inventory) cpu/memory alanlarından: nginx sunucularının toplam vCPU ve bellek dağılımı, ortam bazında. Verisi olmayan sunucu toplama girmez.">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <BigStat n={totCpu} label="toplam vCPU" color="var(--nginx-green)" />
          <BigStat n={Math.round(totMem)} label="toplam bellek (GB)" color="var(--accent)" />
        </div>
        {resMissing > 0 && <div className="text-[11px] mb-2" style={{ color: 'var(--status-warning)' }}>{nf(resMissing)} sunucunun kaynak verisi envanterde yok.</div>}
        <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr><Th>Ortam</Th><Th right>Sunucu</Th><Th right>vCPU</Th><Th right>GB</Th><Th>Pay</Th></tr></thead>
            <tbody>
              {res.map(([env, e]) => (
                <tr key={env} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold">{env}{e.missing > 0 && <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--text-muted)' }} title={`${e.missing} sunucunun kaynak verisi yok`}>({e.missing} eksik)</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(e.n)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(e.cpu)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(Math.round(e.mem))}</td>
                  <td className="px-3 py-2 w-28"><MiniBar value={e.cpu} total={totCpu} color="var(--nginx-green)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {oses.length > 0 && <div className="mt-3 text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--text-secondary)' }}>{oses.slice(0, 6).map(([os, n]) => <span key={os}><b className="tabular-nums">{nf(n)}</b> {os}</span>)}</div>}
      </Card>

      <Card title="Production: Pendik / Ankara" info="Ortamı production olan nginx sunucularının lokasyon dağılımı. Lokasyon envanterden, yoksa sunucu adından (tier harfinden sonra fazladan A = Ankara: GBNGXAP34 Ankara, GBNGXP40 Pendik).">
        {prod.length === 0 ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Envanterde production nginx sunucusu yok.</div> : (
          <>
            <div className="mb-3"><Donut label={nf(prod.length)} sub="prod sunucu" parts={sites.map(([k, e]) => ({ value: e.n, color: SITE_COLOR[k] || 'var(--text-muted)', title: k }))} /></div>
            <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-[13px] border-collapse">
                <thead><tr><Th>Lokasyon</Th><Th right>Sunucu</Th><Th right>Online</Th><Th right>vCPU</Th><Th right>GB</Th><Th right>nginx -t ✗</Th></tr></thead>
                <tbody>
                  {sites.map(([k, e]) => (
                    <tr key={k} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 font-semibold"><span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: SITE_COLOR[k] || 'var(--text-muted)' }} />{k}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(e.n)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: e.online < e.n ? 'var(--status-warning)' : 'var(--status-success)' }}>{nf(e.online)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(e.cpu)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(Math.round(e.mem))}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: e.tFail ? 'var(--status-danger)' : 'var(--text-muted)' }}>{nf(e.tFail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="Son değişiklikler" info="Konfigürasyon geçmişi: son 8 değişiklik (sunucu taraması ya da Portal push)." className="xl:col-span-3">
        <div className="overflow-auto rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr><Th>Sunucu</Th><Th>Dosya</Th><Th>Kaynak</Th><Th>İsteyen</Th><Th>Zaman</Th></tr></thead>
            <tbody>
              {changes.length === 0 ? <TableEmptyRow colSpan={5} title="Değişiklik kaydı yok." /> : changes.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2"><button className="underline" style={{ color: 'var(--accent)' }} onClick={() => onGo('config', c.host)}>{c.host.toLowerCase()}</button></td>
                  <td className="px-3 py-2 font-mono text-[12px]"><div className="truncate max-w-[26rem]" title={c.path}>{c.path}</div></td>
                  <td className="px-3 py-2 text-[12px]">{c.source}</td>
                  <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{c.requester || '—'}</td>
                  <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }} title={fmtDateTime(c.seenAt || c.dumpTime)}>{fmtRelative(c.seenAt || c.dumpTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="-mx-5 -mb-4 mt-3"><SeeAll label="Daha fazla" onClick={() => onGo('changes')} /></div>
      </Card>
    </div>
  );
}

// ── Instances ───────────────────────────────────────────────────────────────────────
export function InstancesTab({ hosts, loading, onRefreshHosts, onOpen, onReload }: { hosts: NcHost[]; loading: boolean; onRefreshHosts: (hosts: string[]) => void; onOpen: (host: string) => void; onReload: () => void }) {
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [menu, setMenu] = useState<string | null>(null);
  // Durum suzgeci (kullanici, 2026-09-22): "offline'lari / surumu bilinmeyenleri nasil yakalarim?"
  const [only, setOnly] = useState<'all' | 'offline' | 'tfail' | 'nodump' | 'unknownver'>('all');
  const now = Date.now();
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return hosts.filter((h) => {
      if (only === 'offline' && isOnline(h, now)) return false;
      if (only === 'tfail' && h.nginxT !== 'fail') return false;
      if (only === 'nodump' && h.dumpedAt) return false;
      if (only === 'unknownver' && parseNginxVersion(h.nginxVersion).type !== 'Bilinmiyor') return false;
      return !n || h.host.toLowerCase().includes(n) || (h.env || '').toLowerCase().includes(n) || (h.services || []).some((s) => s.toLowerCase().includes(n)) || String(h.nginxVersion || '').toLowerCase().includes(n);
    });
  }, [hosts, q, only, now]);
  const cnt = useMemo(() => ({
    offline: hosts.filter((h) => !isOnline(h, now)).length, tfail: hosts.filter((h) => h.nginxT === 'fail').length,
    nodump: hosts.filter((h) => !h.dumpedAt).length, unknownver: hosts.filter((h) => parseNginxVersion(h.nginxVersion).type === 'Bilinmiyor').length,
  }), [hosts, now]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages);
  const view = rows.slice((cur - 1) * size, cur * size);
  const allChecked = view.length > 0 && view.every((h) => checked.has(h.host));
  const csv = () => {
    const header = ['hostname', 'type', 'version', 'env', 'site', 'services', 'nginx_t', 'status', 'last_seen', 'last_dump', 'cpu', 'memory_gb', 'ip'];
    const body = [header, ...rows.map((h) => { const p = parseNginxVersion(h.nginxVersion); return [h.host, p.type, p.version || '', h.env || '', siteOf(h) || '', (h.services || []).join(' '), h.nginxT || '', isOnline(h, now) ? 'Online' : 'Offline', lastSeen(h) || '', h.dumpedAt || '', h.cpu ?? '', h.memoryGb ?? '', h.ip || '']; })]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `nginx_instances_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const btn = 'inline-flex items-center gap-1 h-8 px-3 text-[12px] rounded-md border';
  const btnStyle: React.CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-3" onClick={() => menu && setMenu(null)}>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="sunucu, ortam, servis ya da sürüm ara" className="h-8 px-3 text-[12px] border rounded-md w-72" style={btnStyle} />
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {([['all', 'Hepsi', hosts.length], ['offline', 'Offline', cnt.offline], ['tfail', 'nginx -t FAIL', cnt.tfail], ['nodump', 'Dokumu yok', cnt.nodump], ['unknownver', 'Sürüm bilinmiyor', cnt.unknownver]] as const).map(([id, label, n]) => (
            <button key={id} onClick={() => { setOnly(id); setPage(1); }} className={`px-2.5 py-1 text-[11px] rounded-md ${only === id ? 'shadow-sm' : ''}`} style={{ background: only === id ? 'var(--bg-surface)' : 'transparent', color: only === id ? 'var(--text-primary)' : 'var(--text-muted)' }} title={id === 'offline' ? 'Son 2 gündür fetch job\'ı ulaşamadı (ssh/dzdo) ya da hiç dokum alınmadı' : id === 'unknownver' ? 'Envanter nginx_version boş: nginx_metadata job\'ı bu sunucuda nginx -v okuyamadı' : undefined}>{label} <b className="tabular-nums">{n}</b></button>
          ))}
        </div>
        <span className="ml-auto" />
        <button onClick={onReload} className={btn} style={btnStyle}><ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        <button onClick={csv} className={btn} style={btnStyle}><ArrowDownTrayIcon className="w-3.5 h-3.5" /> Export</button>
        <button disabled={checked.size === 0} onClick={() => { onRefreshHosts([...checked]); setChecked(new Set()); }} className={`${btn} disabled:opacity-40`} style={{ background: 'var(--nginx-green)', borderColor: 'var(--nginx-green)', color: 'var(--accent-fg, #fff)' }} title="Seçili sunucuların dokumunu Ansible ile yenile"><ArrowPathIcon className="w-3.5 h-3.5" /> Seçilileri yenile{checked.size ? ` (${checked.size})` : ''}</button>
      </div>
      <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <table className="w-full text-[13px] border-collapse">
          <thead><tr>
            <th className="px-3 py-2 w-8" style={{ background: 'var(--bg-elevated)' }}><input type="checkbox" checked={allChecked} onChange={(e) => { const s = new Set(checked); view.forEach((h) => (e.target.checked ? s.add(h.host) : s.delete(h.host))); setChecked(s); }} aria-label="sayfadakileri seç" /></th>
            <Th>Hostname</Th><Th>Type</Th><Th>System Tags</Th><Th>nginx -t</Th><Th>Status</Th><Th>Son görülme</Th><Th>Son dokum</Th><Th right>Actions</Th>
          </tr></thead>
          <tbody>
            {view.length === 0 ? <TableEmptyRow colSpan={9} title={hosts.length ? 'Süzgeçle eşleşen sunucu yok.' : 'Envanterde nginx sunucusu yok.'} /> : view.map((h) => {
              const p = parseNginxVersion(h.nginxVersion); const online = isOnline(h, now);
              return (
                <tr key={h.host} className="border-t hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2.5"><input type="checkbox" checked={checked.has(h.host)} onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(h.host) : s.delete(h.host); setChecked(s); }} aria-label={h.host} /></td>
                  <td className="px-3 py-2.5"><button className="underline font-medium" style={{ color: 'var(--accent)' }} onClick={() => onOpen(h.host)}>{h.host.toLowerCase()}</button>{h.inventoryMissing && <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>(envanterde yok)</span>}</td>
                  <td className="px-3 py-2.5"><div className="truncate max-w-[16rem]" title={h.nginxVersion || ''}>{p.type}{p.version ? ` - ${p.version}` : ''}{p.release ? ` (${p.release})` : ''}</div></td>
                  <td className="px-3 py-2.5"><div className="flex gap-1 flex-wrap">{[h.env, isProdEnv(h.env) ? siteOf(h) : null, ...(h.services || [])].filter(Boolean).slice(0, 3).map((t) => <span key={t as string} className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{t}</span>)}{(h.services || []).length > 2 && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>+{(h.services || []).length - 2}</span>}{!h.env && !(h.services || []).length && '-'}</div></td>
                  <td className="px-3 py-2.5">{h.nginxT === 'ok' ? <span style={{ color: 'var(--status-success)' }}>Syntax OK</span> : h.nginxT === 'fail' ? <span className="font-semibold" style={{ color: 'var(--status-danger)' }}>FAIL</span> : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}</td>
                  <td className="px-3 py-2.5"><StatusCell online={online} /></td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }} title={lastSeen(h) ? fmtDateTime(lastSeen(h) as string) : ''}>{lastSeen(h) ? fmtRelative(lastSeen(h) as string) : 'hiç görülmedi'}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }} title={h.dumpedAt ? fmtDateTime(h.dumpedAt) : ''}>{h.dumpedAt ? fmtRelative(h.dumpedAt) : 'dokum yok'}</td>
                  <td className="px-3 py-2.5 text-right relative" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setMenu(menu === h.host ? null : h.host)} className="p-1 rounded" aria-label={`${h.host} eylemler`}><EllipsisHorizontalIcon className="w-5 h-5" /></button>
                    {menu === h.host && (
                      <div className="absolute right-3 top-9 z-10 w-44 rounded-md border shadow-md text-left text-[12px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                        <button onClick={() => { setMenu(null); onOpen(h.host); }} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-elevated)]">Konfigürasyonu aç</button>
                        <button onClick={() => { setMenu(null); onRefreshHosts([h.host]); }} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-elevated)]">Dokumu yenile</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center gap-3 px-3 py-2 border-t text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <span><b>{nf(rows.length)}</b> instances</span>
          <span className="ml-auto">Show</span>
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} className="h-7 px-2 border rounded-md text-[12px]" style={btnStyle}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <button disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="p-1 rounded border disabled:opacity-40" style={btnStyle} aria-label="önceki"><ChevronLeftIcon className="w-4 h-4" /></button>
          <span className="tabular-nums">{cur} / {pages}</span>
          <button disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="p-1 rounded border disabled:opacity-40" style={{ ...btnStyle, background: 'var(--nginx-green)', color: 'var(--accent-fg, #fff)', borderColor: 'var(--nginx-green)' }} aria-label="sonraki"><ChevronRightIcon className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}
