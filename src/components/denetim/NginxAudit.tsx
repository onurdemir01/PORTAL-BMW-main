// src/components/denetim/NginxAudit.tsx — "Nginx Audit" (liste).
//
// TUM nginx sunucularinin `nginx -T` tabanli denetimi. Veriyi bmw_nginx/nginx_audit
// isi uretir (alti tablo). Her satir bir SUNUCU; satira tiklayinca sunucunun KENDI
// SAYFASI acilir (/denetim/nginx-audit/:host — NginxAuditHostPage): server bloklari,
// location'lar, upstream'ler, ayarlar, kurulum dosyasi uyumu.
//
// Kullanici bildirimi (2026-09-14): "Atlayan / Tanimsiz / Ayar sapmasi ne demek" ->
// sozluk (nginxAuditGlossary.tsx) hem burada hem sunucu sayfasinda; sutun basliklari
// ayni kisa aciklamayi ipucu olarak tasir.
//
// Legacy denetiminden AYRIDIR: o, 12 prod sunucusunu servis tanesinde ve eslenik
// karsilastirmasiyla olcer. Bu, tum filoyu sunucu tanesinde olcer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxAuditHost,
  type NginxAuditResult,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from './ui';
import { AuditGlossary, termHint } from './nginxAuditGlossary';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export const hostPagePath = (host: string) => `/denetim/nginx-audit/${encodeURIComponent(host)}`;

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

export function NginxAudit() {
  const [data, setData] = useState<NginxAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxAudit(true); // Yenile: sunucu onbellegini atla
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
        include&apos;lar dahil, nginx&apos;in kendi gördüğü hâliyle. <b>Satıra tıklayınca sunucunun
        kendi sayfası açılır</b>: server blokları (ip:port, sertifika), location&apos;lar (dosya
        başına), upstream&apos;ler (resolve / keepalive / zone / kullanımda mı), kurulum
        referansıyla ayar karşılaştırması ve kurulum dosyalarının birebir uyumu.
      </Note>

      <AuditGlossary />

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
          hint={termHint('Konfigürasyon geçersiz')}
        />
        <StatTile
          label="hedefi tanımsız location"
          value={nf(t?.proxyUndefined || 0)}
          tone={t?.proxyUndefined ? 'danger' : 'neutral'}
          hint={termHint('Tanımsız')}
        />
        <StatTile
          label="referanstan sapan ayar"
          value={nf(t?.settingsMismatch || 0)}
          tone={t?.settingsMismatch ? 'danger' : 'neutral'}
          hint={`${nf(t?.hostsWithMismatch || 0)} sunucuda · ${termHint('Ayar sapması')}`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="referanstan farklı kurulum dosyası"
          value={data.filesReady ? nf(t?.refFilesDiff || 0) : '—'}
          tone={t?.refFilesDiff ? 'warning' : 'neutral'}
          hint={
            data.filesReady
              ? `${nf(t?.hostsWithFileDiff || 0)} sunucuda · ${nf(t?.refFilesMissing || 0)} dosya sunucuda yok · ${termHint('Dosya uyumu')}`
              : 'DDL henüz uygulanmadı (nginx_audit_schema.sql yeniden çalıştırılmalı)'
          }
        />
        <StatTile
          label="upstream'i atlayan location"
          value={nf(t?.proxyFqdn || 0)}
          tone="neutral"
          hint={termHint('Atlayan')}
        />
        <StatTile
          label="resolve olmayan upstream"
          value={nf(t?.upsNoResolve || 0)}
          tone="neutral"
          hint={termHint('resolve yok')}
        />
        <StatTile
          label="kullanılmayan upstream"
          value={nf(t?.unusedUpstreams || 0)}
          tone="neutral"
          hint={termHint('Kullanılmayan upstream')}
        />
      </div>

      {(t?.hostsEnvUnknown || 0) > 0 && (
        <Note tone="warning" title={`${nf(t?.hostsEnvUnknown || 0)} sunucunun ortamı bilinmiyor`}>
          Ortam önce sunucu adı kalıbından (GBNGX…/GBNGW…/GBRVP…), tutmazsa{' '}
          <Code>dbo.Inventory.env</Code> kaydından alınır. İkisi de bilmiyorsa sessizce bir ortama
          atanmaz, <b>BILINMIYOR</b> görünür — sunucu <Code>middleware_inventory</Code> job&apos;ında
          yoksa oraya girmesi gerekir.
        </Note>
      )}

      <Panel
        title="Sunucular"
        description={`${nf(rows.length)} sunucu gösteriliyor · tarama ${data.scanDate} · sorunlu olanlar üstte · satıra tıklayınca sunucu sayfası açılır`}
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
                    'ortam_kaynagi',
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
                    'referanstan_farkli_dosya',
                    'sunucuda_olmayan_dosya',
                  ],
                  rows.map((h) => [
                    h.host,
                    h.env,
                    h.envSource,
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
                    h.refFilesDiff,
                    h.refFilesMissing,
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
              <Th align="right"><span title={termHint('resolve yok')}>resolve yok</span></Th>
              <Th align="right"><span title={termHint('Atlayan')}>Atlayan</span></Th>
              <Th align="right"><span title={termHint('Tanımsız')}>Tanımsız</span></Th>
              <Th align="right"><span title={termHint('Ayar sapması')}>Ayar sapması</span></Th>
              <Th align="right"><span title={termHint('Dosya uyumu')}>Dosya farkı</span></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <HostRow key={h.host} h={h} filesReady={data.filesReady} />
            ))}
          </tbody>
        </TableShell>
      </Panel>
    </div>
  );
}

function envSourceHint(src: string): string {
  if (src === 'name') return 'Ortam sunucu adı kalıbından türetildi';
  if (src === 'inventory') return 'Ortam dbo.Inventory (middleware_inventory) kaydından alındı';
  if (src === 'inventory-unknown') return 'Envanter kaydı var ama ortam değeri tanınmıyor';
  return 'Ne ad kalıbı ne envanter ortamı biliyor';
}

function HostRow({ h, filesReady }: { h: NginxAuditHost; filesReady: boolean }) {
  const navigate = useNavigate();
  const dash = <span className="text-[var(--text-muted)]">—</span>;
  const numCell = (n: number, bad?: boolean) =>
    n ? <span className={bad ? 'text-red-600 font-semibold' : ''}>{nf(n)}</span> : dash;
  const to = hostPagePath(h.host);
  // Satirin tamami tiklanabilir; sunucu adi gercek bir <Link> - orta tik / ctrl+tik
  // yeni sekmede acar (kullanici bircok sunucuyu yan yana bakmak isteyebilir).
  return (
    <tr
      className="hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.button !== 0) return;
        navigate(to);
      }}
      title="Sunucu sayfasını aç"
    >
      <Td className="whitespace-nowrap font-mono font-medium">
        <Link to={to} className="underline decoration-dotted underline-offset-2" onClick={(e) => e.stopPropagation()}>
          {h.host}
        </Link>
      </Td>
      <Td className="whitespace-nowrap">
        <span title={envSourceHint(h.envSource)} className={h.env === 'BILINMIYOR' ? 'text-amber-700' : ''}>
          {h.env}
        </span>
        {h.site && <span className="text-[var(--text-muted)]"> · {h.site}</span>}
        {h.tier === 'intranet' && <span className="text-[var(--text-muted)]"> · intranet</span>}
      </Td>
      <Td>
        {h.status === 'ok' ? (
          <Pill tone="success">geçerli</Pill>
        ) : (
          <Pill tone="danger" title={h.statusMsg}>HATA</Pill>
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
      <Td align="right" className="tabular-nums">
        {!filesReady ? (
          dash
        ) : h.refFilesMissing ? (
          <span className="text-red-600 font-semibold" title={`${nf(h.refFilesMissing)} dosya sunucuda yok`}>
            {nf(h.refFilesDiff)}
          </span>
        ) : h.refFilesDiff ? (
          <span className="text-amber-700 font-semibold">{nf(h.refFilesDiff)}</span>
        ) : (
          dash
        )}
      </Td>
    </tr>
  );
}
