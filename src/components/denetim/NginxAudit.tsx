// src/components/denetim/NginxAudit.tsx — "Nginx Audit".
//
// TUM nginx sunucularinin `nginx -T` tabanli denetimi. Veriyi bmw_nginx/nginx_audit
// isi uretir (bes tablo). Her satir bir SUNUCU; acilinca dort bolum:
//   1) server bloklari (listen, server_name, sertifika)
//   2) location'lar dosya bazinda (kac tane, kaci proxy, kaci upstream'e gidiyor)
//   3) upstream'ler (resolve / keepalive / zone / kullanimda mi)
//   4) ayarlar (kurulum referansiyla karsilastirma)
//
// Legacy denetiminden AYRIDIR: o, 12 prod sunucusunu servis tanesinde ve eslenik
// karsilastirmasiyla olcer. Bu, tum filoyu sunucu tanesinde olcer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxAuditHost,
  type NginxAuditResult,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

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

/** Evet/hayir hucreleri: tik yesil, capraz kirmizi; "yok" hicbir zaman sessiz kalmasin. */
function YesNo({ v, bad }: { v: boolean; bad?: boolean }) {
  if (v) return <span className="text-emerald-600 font-semibold">✓</span>;
  return <span className={bad ? 'text-red-600 font-semibold' : 'text-[var(--text-muted)]'}>✗</span>;
}

export function NginxAudit() {
  const [data, setData] = useState<NginxAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxAudit();
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

  // Ilk yukleme effect ICINDE kurulur (React 19 set-state-in-effect kurali).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await denetimApi.nginxAudit();
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

  const envs = useMemo(
    () => (data ? [...new Set(data.hosts.map((h) => h.env))].sort() : []),
    [data],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.hosts.filter((h) => {
      if (env && h.env !== env) return false;
      if (needle && !h.host.toLowerCase().includes(needle)) return false;
      if (onlyProblem && h.issues === 0) return false;
      return true;
    });
  }, [data, q, env, onlyProblem]);

  if (loading && !data)
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data) return null;

  if (!data.schemaReady) {
    return (
      <Note tone="warning" title="Nginx Audit henüz açık değil">
        Bu görünüm <Code>dbo.Nginx_Audit_*</Code> tablolarını kullanır; henüz yoklar. Tek
        seferlik DDL: <Code>bmw_nginx/nginx_audit/files/nginx_audit_schema.sql</Code>.
        Çalıştırıldıktan sonra <Code>nginx_audit</Code> job&apos;ının ilk koşusunda burası dolar.{' '}
        <b>Diğer ekranlar etkilenmez.</b>
      </Note>
    );
  }
  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz tarama kaydı yok">
        Şema hazır ancak <Code>nginx_audit</Code> job&apos;ı henüz çalışmamış.
      </Note>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu ekran ne gösteriyor?">
        Her satır bir nginx sunucusu. Konfigürasyon <Code>nginx -T</Code> ile okunur — yani
        include&apos;lar dahil, nginx&apos;in kendi gördüğü hâliyle. Satırı açınca dört bölüm:
        server blokları (ip:port, sertifika), location&apos;lar (dosya başına), upstream&apos;ler
        (resolve / keepalive / zone / kullanımda mı) ve kurulum referansıyla ayar karşılaştırması.
        <div className="mt-1.5">
          <b>Referans</b> = <Code>nginx_installation</Code> job&apos;ının dosyaları
          (bmw_defaults.conf, proxy_settings.conf…). Sunucudaki <b>global</b> değer
          referanstan farklıysa bulgudur; bir location&apos;ın kendi içinde farklı değer vermesi
          (örn. 60s timeout) bulgu değil, yerel ayardır — ayrı listelenir.
        </div>
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="sunucu"
          value={nf(t?.hosts || 0)}
          hint={`${nf(t?.serverBlocks || 0)} server bloğu · ${nf(t?.locations || 0)} location · ${nf(t?.upstreams || 0)} upstream`}
        />
        <StatTile
          label="konfigürasyonu geçersiz"
          value={nf(t?.configInvalid || 0)}
          tone={t?.configInvalid ? 'danger' : 'neutral'}
          hint="nginx -T hata verdi — bu sunucu reload edilemez"
        />
        <StatTile
          label="hedefi tanımsız location"
          value={nf(t?.proxyUndefined || 0)}
          tone={t?.proxyUndefined ? 'danger' : 'neutral'}
          hint="proxy_pass ne upstream'e ne çözümlenebilir bir adrese gidiyor — nginx başlamaz"
        />
        <StatTile
          label="referanstan sapan ayar"
          value={nf(t?.settingsMismatch || 0)}
          tone={t?.settingsMismatch ? 'danger' : 'neutral'}
          hint={`${nf(t?.hostsWithMismatch || 0)} sunucuda; global bağlamda referansla eşleşmeyen direktif`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="upstream'i atlayan location"
          value={nf(t?.proxyFqdn || 0)}
          tone="neutral"
          hint="doğrudan DNS adına gidiyor; çalışır ama resolve/keepalive/zone devre dışı"
        />
        <StatTile
          label="resolve olmayan upstream"
          value={nf(t?.upsNoResolve || 0)}
          tone="neutral"
          hint="adres yalnızca başlangıçta çözülür; arka uç IP değişirse eskisine gider"
        />
        <StatTile
          label="kullanılmayan upstream"
          value={nf(t?.unusedUpstreams || 0)}
          tone="neutral"
          hint="tanımlı ama hiçbir location proxy_pass ile kullanmıyor — temizlik adayı"
        />
      </div>

      <Panel
        title="Sunucular"
        description={`${nf(rows.length)} sunucu gösteriliyor · tarama ${data.scanDate} · sorunlu olanlar üstte`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value)}
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
                placeholder="sunucu ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-44"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={onlyProblem}
                onChange={(e) => setOnlyProblem(e.target.checked)}
              />
              Sadece sorunlular
            </label>
            <button
              onClick={() =>
                csvDownload(
                  'nginx_audit_' + (data.scanDate || ''),
                  [
                    'sunucu',
                    'ortam',
                    'lokasyon',
                    'nginx_-T',
                    'server_blogu',
                    'location',
                    'location_proxy',
                    'upstream',
                    'resolve_yok',
                    'keepalive_yok',
                    'zone_yok',
                    'kullanilmayan_upstream',
                    'upstream_atlayan',
                    'hedef_tanimsiz',
                    'referanstan_sapan_ayar',
                  ],
                  rows.map((h) => [
                    h.host,
                    h.env,
                    h.site,
                    h.status,
                    h.serverBlocks,
                    h.locations,
                    h.locationsProxy,
                    h.upstreams,
                    h.upsNoResolve,
                    h.upsNoKeepalive,
                    h.upsNoZone,
                    h.unusedUpstreams,
                    h.proxyFqdn,
                    h.proxyUndefined,
                    h.settingsMismatch,
                  ]),
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
        <TableShell maxHeight="40rem">
          <thead>
            <tr>
              <Th>Sunucu</Th>
              <Th>Ortam</Th>
              <Th>nginx -T</Th>
              <Th align="right">Server</Th>
              <Th align="right">Location</Th>
              <Th align="right">Upstream</Th>
              <Th align="right">resolve yok</Th>
              <Th align="right">Atlayan</Th>
              <Th align="right">Tanımsız</Th>
              <Th align="right">Ayar sapması</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <HostRow
                key={h.host}
                h={h}
                open={open === h.host}
                onToggle={() => setOpen(open === h.host ? null : h.host)}
              />
            ))}
          </tbody>
        </TableShell>
      </Panel>
    </div>
  );
}

function HostRow({ h, open, onToggle }: { h: NginxAuditHost; open: boolean; onToggle: () => void }) {
  const dash = <span className="text-[var(--text-muted)]">—</span>;
  const numCell = (n: number, bad?: boolean) =>
    n ? <span className={bad ? 'text-red-600 font-semibold' : ''}>{nf(n)}</span> : dash;
  return (
    <>
      <tr className="hover:bg-[var(--bg-elevated)]/60 cursor-pointer" onClick={onToggle} title="Ayrıntı için tıklayın">
        <Td className="whitespace-nowrap font-mono font-medium">{h.host}</Td>
        <Td className="whitespace-nowrap">
          {h.env}
          {h.site && <span className="text-[var(--text-muted)]"> · {h.site}</span>}
          {h.tier === 'intranet' && <span className="text-[var(--text-muted)]"> · intranet</span>}
        </Td>
        <Td>
          {h.status === 'ok' ? (
            <Pill tone="success">geçerli</Pill>
          ) : (
            <Pill tone="danger">HATA</Pill>
          )}
        </Td>
        <Td align="right" className="tabular-nums">{nf(h.serverBlocks)}</Td>
        <Td align="right" className="tabular-nums" title={`${nf(h.locationsProxy)} tanesi proxy_pass taşıyor`}>
          {nf(h.locations)}
        </Td>
        <Td align="right" className="tabular-nums">{nf(h.upstreams)}</Td>
        <Td align="right" className="tabular-nums">{numCell(h.upsNoResolve)}</Td>
        <Td align="right" className="tabular-nums">{numCell(h.proxyFqdn)}</Td>
        <Td align="right" className="tabular-nums">{numCell(h.proxyUndefined, true)}</Td>
        <Td align="right" className="tabular-nums">{numCell(h.settingsMismatch, true)}</Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="px-3 py-3 bg-[var(--bg-elevated)]/40 space-y-4">
            {h.status !== 'ok' && (
              <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <b>nginx -T hata verdi:</b> <span className="font-mono">{h.statusMsg}</span>
                <div className="mt-0.5">
                  Diskteki konfigürasyon ayrıştırılamıyor. nginx şu an çalışıyor olabilir ama bir
                  sonraki reload <b>başarısız</b> olur. Aşağıdaki sayılar kısmi olabilir.
                </div>
              </div>
            )}

            {/* 1) SERVER BLOKLARI — ip:port + sertifika */}
            <Section title="Server blokları" hint="Hangi ip:port dinleniyor, hangi sertifika sunuluyor">
              <table className="text-[11px] w-full">
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="text-left pr-3 pb-1">#</th>
                    <th className="text-left pr-3 pb-1">Dosya</th>
                    <th className="text-left pr-3 pb-1">listen</th>
                    <th className="text-left pr-3 pb-1">server_name</th>
                    <th className="text-left pr-3 pb-1">SSL</th>
                    <th className="text-left pr-3 pb-1">Sertifika</th>
                    <th className="text-right pb-1">location</th>
                  </tr>
                </thead>
                <tbody>
                  {h.servers.map((s) => (
                    <tr key={s.seq} className="border-t border-[var(--border-subtle)]">
                      <td className="pr-3 py-1 tabular-nums">{s.seq}</td>
                      <td className="pr-3 py-1 font-mono whitespace-nowrap" title={s.filePath}>{s.file}</td>
                      <td className="pr-3 py-1 font-mono whitespace-nowrap">{s.listen || '—'}</td>
                      <td className="pr-3 py-1 font-mono">{s.serverName || '—'}</td>
                      <td className="pr-3 py-1"><YesNo v={s.ssl} /></td>
                      <td className="pr-3 py-1 font-mono whitespace-nowrap" title={s.certPath}>
                        {s.cert || (s.ssl ? <span className="text-red-600">yok!</span> : '—')}
                      </td>
                      <td className="py-1 text-right tabular-nums">{nf(s.locations)}</td>
                    </tr>
                  ))}
                  {h.servers.length === 0 && (
                    <tr><td colSpan={7} className="py-1 text-[var(--text-muted)]">server bloğu yok</td></tr>
                  )}
                </tbody>
              </table>
            </Section>

            {/* 2) LOCATION'LAR — dosya bazinda */}
            <Section
              title="Location'lar (dosya başına)"
              hint="proxy_pass var mı, varsa tanımlı bir upstream'e mi gidiyor"
            >
              <table className="text-[11px] w-full">
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="text-left pr-3 pb-1">Dosya</th>
                    <th className="text-right pr-3 pb-1">location</th>
                    <th className="text-right pr-3 pb-1">proxy_pass</th>
                    <th className="text-right pr-3 pb-1">→ upstream</th>
                    <th className="text-right pr-3 pb-1">→ DNS (atlayan)</th>
                    <th className="text-right pr-3 pb-1">→ tanımsız</th>
                    <th className="text-right pb-1">diğer</th>
                  </tr>
                </thead>
                <tbody>
                  {h.locationsByFile.map((f) => (
                    <React.Fragment key={f.filePath}>
                      <tr className="border-t border-[var(--border-subtle)]">
                        <td className="pr-3 py-1 font-mono whitespace-nowrap" title={f.filePath}>{f.file}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{nf(f.total)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{nf(f.proxy)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums text-emerald-700">{nf(f.toUpstream)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{f.toFqdn ? <span className="text-amber-700">{nf(f.toFqdn)}</span> : '—'}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{f.undefined ? <span className="text-red-600 font-semibold">{nf(f.undefined)}</span> : '—'}</td>
                        <td className="py-1 text-right tabular-nums text-[var(--text-muted)]" title="deny / return / rewrite / static">{nf(f.other)}</td>
                      </tr>
                      {(f.undefinedList.length > 0 || f.fqdnList.length > 0) && (
                        <tr>
                          <td colSpan={7} className="pb-1.5 pl-3">
                            <div className="flex flex-wrap gap-1">
                              {f.undefinedList.map((x, i) => (
                                <span key={'u' + i} className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-red-50 text-red-700 border-red-200" title={`hedef: ${x.target} — ne upstream ne çözümlenebilir ad`}>
                                  {x.location} → {x.target}
                                </span>
                              ))}
                              {f.fqdnList.slice(0, 40).map((x, i) => (
                                <span key={'f' + i} className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-amber-50 text-amber-700 border-amber-200" title={`doğrudan DNS adına gidiyor: ${x.target}`}>
                                  {x.location}
                                </span>
                              ))}
                              {f.fqdnList.length > 40 && (
                                <span className="text-[10px] text-[var(--text-muted)]">+{nf(f.fqdnList.length - 40)} tane daha</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {h.locationsByFile.length === 0 && (
                    <tr><td colSpan={7} className="py-1 text-[var(--text-muted)]">location yok</td></tr>
                  )}
                </tbody>
              </table>
            </Section>

            {/* 3) UPSTREAM'LER */}
            <Section
              title={`Upstream'ler (${nf(h.upstreamList.length)})`}
              hint="resolve: adres canlı çözülür · keepalive: bağlantı yeniden kullanılır · zone: resolve için paylaşımlı bellek · kullanımda: en az bir location gidiyor"
            >
              {h.upstreamList.length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)]">Bu sunucuda upstream tanımı yok.</div>
              ) : (
                <div className="overflow-auto max-h-72">
                  <table className="text-[11px] w-full">
                    <thead className="sticky top-0 bg-[var(--bg-elevated)]">
                      <tr className="text-[var(--text-muted)]">
                        <th className="text-left pr-3 pb-1">Ad</th>
                        <th className="text-left pr-3 pb-1">Dosya</th>
                        <th className="text-center pr-3 pb-1">resolve</th>
                        <th className="text-center pr-3 pb-1">keepalive</th>
                        <th className="text-center pr-3 pb-1">zone</th>
                        <th className="text-center pb-1">kullanımda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.upstreamList.map((u) => (
                        <tr key={u.name} className="border-t border-[var(--border-subtle)]">
                          <td className="pr-3 py-0.5 font-mono whitespace-nowrap" title={u.server}>{u.name}</td>
                          <td className="pr-3 py-0.5 font-mono text-[var(--text-muted)] whitespace-nowrap">{u.file}</td>
                          <td className="pr-3 py-0.5 text-center"><YesNo v={u.resolve} /></td>
                          <td className="pr-3 py-0.5 text-center"><YesNo v={u.keepalive} /></td>
                          <td className="pr-3 py-0.5 text-center"><YesNo v={u.zone} /></td>
                          <td className="py-0.5 text-center"><YesNo v={u.used} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* 4) AYARLAR */}
            <Section
              title="Ayarlar — kurulum referansıyla karşılaştırma"
              hint="Referans: nginx_installation dosyaları (bmw_defaults.conf, proxy_settings.conf, rate_limits.conf, nginx.conf)"
            >
              {h.settingsMismatched.length === 0 ? (
                <div className="text-[11px] text-emerald-700">Global ayarların tamamı referansla uyumlu.</div>
              ) : (
                <table className="text-[11px] w-full mb-2">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="text-left pr-3 pb-1">Direktif</th>
                      <th className="text-left pr-3 pb-1">Sunucudaki değer</th>
                      <th className="text-left pr-3 pb-1">Referans</th>
                      <th className="text-left pb-1">Dosya</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.settingsMismatched.map((m, i) => (
                      <tr key={i} className="border-t border-[var(--border-subtle)]">
                        <td className="pr-3 py-1 font-mono">{m.directive}</td>
                        <td className="pr-3 py-1 font-mono text-red-700">{m.missing ? <i>tanımlı değil</i> : m.value}</td>
                        <td className="pr-3 py-1 font-mono text-emerald-700">{m.reference ?? '—'}</td>
                        <td className="py-1 font-mono text-[var(--text-muted)]">{m.file || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {h.settingsOverrides.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
                    Yerel override&apos;lar ({nf(h.settingsOverrides.length)}) — bulgu değil, bilgi
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.settingsOverrides.map((o, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)]"
                        title={`${o.context} bağlamında; referans: ${o.reference ?? '—'}`}
                      >
                        {o.directive} {o.value} <span className="text-[var(--text-muted)]">×{nf(o.count)}</span>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </Section>
          </td>
        </tr>
      )}
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-semibold text-[var(--text-primary)]">{title}</span>
        {hint && <span className="text-[10px] text-[var(--text-muted)]">{hint}</span>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
