// src/components/denetim/NginxProxy.tsx — "Nginx SPA Audit > Proxy Tanımları (PROD)".
//
// NEDEN AYRI GÖRÜNÜM: production nginx, SPA include desenini KULLANMAZ. Tanımlar
// proxy_pass/upstream şeklindedir:
//     upstream <ad> { server <url>:443 resolve; }
//     location <path> { proxy_pass https://<ad>/; proxy_ssl_name <url>; }
// Denetim uzun süre yalnızca include desenini kaydettiği için PROD ortamı boş
// görünüyordu — sunucular zaten taranıyordu, eksik olan tarayıcının bu deseni
// tanımamasıydı. SPA'ya özgü alanlar (include, deploy modu, paket var mı) burada
// ANLAMSIZ olduğu için hiç gösterilmez; sahte değer üretmek yerine ayrı bir görünüm.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { denetimApi, type NginxProxyResult } from '@/api/denetimApi';
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

export function NginxProxy() {
  const [data, setData] = useState<NginxProxyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxProxy();
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
        const r = await denetimApi.nginxProxy();
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

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (env && r.env !== env) return false;
      if (
        needle &&
        !`${r.locationPath} ${r.targetUrl || ''} ${r.upstreamName || ''} ${r.vhost}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      if (onlyProblem && r.status === 'OK' && r.upstreamDefined) return false;
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

  // Şema hazır değil ≠ "hiç tanım yok". İkisini karıştırmamak için ayrı mesaj.
  if (!data.schemaReady) {
    return (
      <Note tone="warning" title="Proxy denetimi henüz açık değil">
        Bu görünüm <Code>dbo.Nginx_Config_Audit</Code> tablosundaki <Code>kind</Code>,{' '}
        <Code>upstream_name</Code>, <Code>target_url</Code> ve <Code>upstream_defined</Code>{' '}
        kolonlarını kullanır; bunlar henüz eklenmemiş. Tek seferlik DDL:{' '}
        <Code>bmw_nginx/nginx_config_audit/files/nginx_config_audit_migrate_proxy.sql</Code>.
        Çalıştırıldıktan sonra <Code>nginx_config_audit</Code> job&apos;ının bir sonraki koşusunda
        burası dolar. <b>Mevcut SPA ekranları bu adımdan etkilenmez.</b>
      </Note>
    );
  }

  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz proxy kaydı yok">
        Şema hazır ancak <Code>nginx_config_audit</Code> job&apos;ı DDL sonrası henüz çalışmamış
        olabilir. Bir sonraki taramadan sonra burası dolar.
      </Note>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu görünüm ne gösteriyor?">
        Production nginx, SPA include desenini kullanmaz; tanımlar{' '}
        <Code>location … &#123; proxy_pass https://&lt;upstream&gt;/; &#125;</Code> şeklindedir. Her
        satır bir tanımdır ve prod&apos;da aynı tanım birden çok sunucuda aynadır — <b>Sunucu</b>{' '}
        sütunu kaçında görüldüğünü söyler, eksik kalan bir sunucu buradan fark edilir. SPA&apos;ya
        özgü alanlar (include dosyası, deploy modu, paket var mı) proxy tanımında anlamsız olduğu
        için gösterilmez.
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="proxy tanımı" value={nf(t.rows)} />
        <StatTile label="vhost" value={nf(t.vhosts)} />
        <StatTile
          label="non-prod adrese giden"
          value={nf(t.nonProdTarget)}
          tone={t.nonProdTarget ? 'danger' : 'neutral'}
          hint="PROD vhost'u dev/test/qa ya da apps-t adresine yönlendiriyor"
        />
        <StatTile
          label="tanımsız upstream"
          value={nf(t.undefinedUpstream)}
          tone="neutral"
          hint="proxy_pass hedefi aynı dosyada upstream olarak tanımlı değil — doğrudan DNS adına gidiyor olabilir, tek başına hata değildir"
        />
      </div>

      <Panel
        title="Proxy tanımları"
        description={`${nf(rows.length)} tanım gösteriliyor · tarama ${data.scanDate}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
            >
              <option value="">tüm ortamlar</option>
              {data.envs.map((e) => (
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
                placeholder="path, adres, upstream ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
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
                  'nginx_proxy_tanimlari',
                  [
                    'servis',
                    'ortam',
                    'vhost',
                    'path',
                    'upstream',
                    'hedef_adres',
                    'upstream_tanimli',
                    'sunucular',
                    'durum',
                  ],
                  rows.map((r) => [
                    r.service,
                    r.env,
                    r.vhost,
                    r.locationPath,
                    r.upstreamName || '',
                    r.targetUrl || '',
                    r.upstreamDefined ? 'EVET' : 'HAYIR',
                    r.hosts.join(' '),
                    r.status,
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
        <TableShell maxHeight="34rem">
          <thead>
            <tr>
              <Th>Servis</Th>
              <Th>Ortam</Th>
              <Th>Context path</Th>
              <Th>Hedef adres</Th>
              <Th>Upstream</Th>
              <Th align="right">Sunucu</Th>
              <Th>Durum</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.vhost}|${r.locationPath}|${r.targetUrl}`}>
                <Td className="whitespace-nowrap">{r.service}</Td>
                <Td className="whitespace-nowrap">{r.env}</Td>
                <Td className="font-mono whitespace-nowrap" title={r.locationPath}>
                  {r.locationPath}
                </Td>
                <Td className="font-mono whitespace-nowrap" title={r.targetUrl || ''}>
                  {r.targetUrl || <span className="text-[var(--text-muted)]">—</span>}
                </Td>
                <Td className="font-mono whitespace-nowrap">
                  {r.upstreamName || <span className="text-[var(--text-muted)]">—</span>}
                  {!r.upstreamDefined && r.upstreamName && (
                    <span
                      className="ml-1.5 text-[10px] text-[var(--text-muted)]"
                      title="Aynı dosyada upstream bloğu yok — doğrudan DNS adına gidiyor olabilir"
                    >
                      (blok yok)
                    </span>
                  )}
                </Td>
                <Td align="right" className="tabular-nums" title={r.hosts.join(', ')}>
                  {r.hosts.length}
                </Td>
                <Td>
                  {r.status === 'NON_PROD_TARGET' ? (
                    <Pill tone="danger">non-prod adres</Pill>
                  ) : (
                    <Pill tone="success">sorunsuz</Pill>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>
    </div>
  );
}
