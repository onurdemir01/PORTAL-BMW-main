// src/components/denetim/NginxAuditHostPage.tsx — Nginx Audit > TEK SUNUCU sayfası.
//
// Kullanici bildirimi (2026-09-14): listede satiri acmak yetmiyor, "sunucu ozelinde ne
// oluyor" icin ayri bir sayfa istendi. Rota: /denetim/nginx-audit/:host — kendi URL'i
// var (paylasilabilir, yeni sekmede acilabilir), geri donus Nginx Audit sekmesine.
//
// Bes bolum: server bloklari, location'lar (dosya basina), upstream'ler, ayarlar
// (kurulum referansi), kurulum dosyasi uyumu (direktif bazinda fark). Veri tek uctan:
// GET /api/denetim/nginx-audit/host/:host (SQL'de suzulur, tum filo cekilmez).
import React, { useEffect, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
// Ham tarih bicimlendirme YOK: bicim tek yerden gelir (bekci G19).
import { fmtDateTime } from '@/utils/datetime';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon, ArrowPathIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { denetimApi, type NginxAuditHost, type NginxAuditRefFile } from '@/api/denetimApi';
import { Panel, StatTile, Pill, Code, Note } from './ui';
import { AuditGlossary, termHint } from './nginxAuditGlossary';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
// Nginx Audit sekmesi 2026-09-22'de Nginx Hub'a tasindi; geri donus oraya.
const BACK = '/nginx-console?tab=audit';

function YesNo({ v, bad }: { v: boolean; bad?: boolean }) {
  if (v) return <span className="text-emerald-600 font-semibold">✓</span>;
  return <span className={bad ? 'text-red-600 font-semibold' : 'text-[var(--text-muted)]'}>✗</span>;
}

export default function NginxAuditHostPage() {
  const { host: rawHost } = useParams();
  const hostName = String(rawHost || '').trim().toUpperCase();
  const [data, setData] = useState<NginxAuditHost | null>(null);
  const [meta, setMeta] = useState<{ scanDate: string | null; filesReady: boolean; schemaReady: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  // `useAsyncEffect`: is effect flush'indan SONRAKI mikro-goreve ertelenir, yani
  // `setLoading(true)` effect govdesinde SENKRON degildir (React 19'un
  // `set-state-in-effect` kurali bunu isaretliyordu). Iptal de hook'tan gelir.
  useAsyncEffect(async (alive) => {
    setLoading(true);
    (async () => {
      try {
        const r = await denetimApi.nginxAuditHost(hostName);
        if (!alive()) return;
        if (r.ok) {
          setData(r.host);
          setMeta({ scanDate: r.scanDate, filesReady: r.filesReady, schemaReady: r.schemaReady });
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive()) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive()) setLoading(false);
      }
    })();
  }, [hostName, tick]);

  return (
    <div className="space-y-4">
      <header
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap px-5 pt-4 pb-4">
          <div className="min-w-0">
            <Link
              to={BACK}
              className="inline-flex items-center gap-1 text-xs mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Denetim › Nginx Audit
            </Link>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="grid place-items-center w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'var(--accent-bg)' }}>
                <ServerStackIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              </span>
              <h1 className="text-lg font-bold leading-tight font-mono" style={{ color: 'var(--text-primary)' }}>
                {hostName}
              </h1>
              {data && (
                <>
                  <Pill tone="neutral" title={envSourceHint(data.envSource)}>{data.env}</Pill>
                  {data.site && <Pill tone="neutral">{data.site}</Pill>}
                  <Pill tone="neutral">{data.tier === 'intranet' ? 'Intranet' : 'Internet'}</Pill>
                  {data.status === 'ok' ? (
                    <Pill tone="success">nginx -T geçerli</Pill>
                  ) : (
                    <Pill tone="danger" title={termHint('Konfigürasyon geçersiz')}>nginx -T HATA</Pill>
                  )}
                </>
              )}
            </div>
            <p className="text-[12px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {meta?.scanDate ? `Tarama: ${meta.scanDate}` : ''} · Konfigürasyon <Code>nginx -T</Code> ile
              okunur (include&apos;lar dahil, nginx&apos;in gördüğü hâliyle).
            </p>
          </div>
          <button
            onClick={() => setTick((t) => t + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border flex-shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </header>

      {loading && !data && (
        <LoadingLogo />
      )}
      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>
      )}
      {!loading && !err && meta && !data && (
        <Note tone="warning" title="Bu sunucu son taramada yok">
          <Code>{hostName}</Code> son <Code>nginx_audit</Code> koşusunda görünmüyor: envanterde nginx
          sürümü yok, sunucuya ulaşılamadı ya da ad yanlış.{' '}
          <Link to={BACK} className="underline">Listeye dön</Link>.
        </Note>
      )}

      {data && (
        <>
          {data.exception && (
            <Note tone="warning" title="Bu sunucu denetim istisnası">
              {data.exception.note}
              <div className="mt-1 text-[var(--text-muted)]">
                {data.exception.by ? `${data.exception.by}` : ''}{data.exception.at ? ` · ${fmtDateTime(data.exception.at)}` : ''} — listede metrikler gösterilmez ve toplamlara girmez; bu sayfa ham veriyi göstermeye devam eder.
              </div>
            </Note>
          )}
          {data.status !== 'ok' && (
            <Note tone="danger" title="nginx -T hata verdi — konfigürasyon reload edilemez">
              <span className="font-mono">{data.statusMsg}</span>
              <div className="mt-1">
                nginx şu an çalışıyor olabilir ama bir sonraki reload <b>başarısız</b> olur. Aşağıdaki
                sayılar kısmi olabilir.
              </div>
            </Note>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="server bloğu" value={nf(data.serverBlocks)} hint={`${nf(data.files)} konfigürasyon dosyası`} />
            <StatTile label="location" value={nf(data.locations)} hint={`${nf(data.locationsProxy)} tanesi proxy_pass taşıyor`} />
            <StatTile
              label="upstream"
              value={nf(data.upstreams)}
              hint={`${nf(data.upsNoResolve)} resolve yok · ${nf(data.upsNoKeepalive)} keepalive yok · ${nf(data.unusedUpstreams)} kullanılmıyor`}
            />
            <StatTile
              label="hedefi tanımsız location"
              value={nf(data.proxyUndefined)}
              tone={data.proxyUndefined ? 'danger' : 'neutral'}
              hint={termHint('Tanımsız')}
            />
            <StatTile
              label="upstream'i atlayan location"
              value={nf(data.proxyFqdn)}
              tone={data.proxyFqdn ? 'warning' : 'neutral'}
              hint={termHint('Atlayan')}
            />
            <StatTile
              label="ayar sapması"
              value={nf(data.settingsMismatch)}
              tone={data.settingsMismatch ? 'danger' : 'neutral'}
              hint={termHint('Ayar sapması')}
            />
            <StatTile
              label="referanstan farklı kurulum dosyası"
              value={meta?.filesReady ? nf(data.refFilesDiff) : '—'}
              tone={data.refFilesDiff ? 'warning' : 'neutral'}
              hint={meta?.filesReady ? `${nf(data.refFiles.length)} dosya kontrol edildi · ${nf(data.refFilesMissing)} sunucuda yok` : 'DDL henüz uygulanmadı'}
            />
            <StatTile label="yerel override" value={nf(data.settingsOverrides.length)} hint="bulgu değil, bilgi — aşağıda" />
          </div>

          <AuditGlossary />

          {/* 1) SERVER BLOKLARI */}
          <Panel title="Server blokları" description="Hangi ip:port dinleniyor, hangi sertifika sunuluyor, her blokta kaç location var" dense>
            <div className="overflow-x-auto p-3">
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
                  {data.servers.map((s) => (
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
                  {data.servers.length === 0 && (
                    <tr><td colSpan={7} className="py-1 text-[var(--text-muted)]">server bloğu yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* 2) LOCATION'LAR */}
          <Panel
            title="Location'lar (dosya başına)"
            description="proxy_pass var mı; varsa tanımlı bir upstream'e mi, doğrudan DNS adına mı (atlayan), yoksa tanımsız bir hedefe mi gidiyor"
            dense
          >
            <div className="overflow-x-auto p-3">
              <table className="text-[11px] w-full">
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="text-left pr-3 pb-1">Dosya</th>
                    <th className="text-right pr-3 pb-1">location</th>
                    <th className="text-right pr-3 pb-1">proxy_pass</th>
                    <th className="text-right pr-3 pb-1">→ upstream</th>
                    <th className="text-right pr-3 pb-1" title={termHint('Atlayan')}>→ DNS (atlayan)</th>
                    <th className="text-right pr-3 pb-1" title={termHint('Tanımsız')}>→ tanımsız</th>
                    <th className="text-right pb-1" title="deny / return / rewrite / static">diğer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.locationsByFile.map((f) => (
                    <React.Fragment key={f.filePath}>
                      <tr className="border-t border-[var(--border-subtle)]">
                        <td className="pr-3 py-1 font-mono whitespace-nowrap" title={f.filePath}>{f.file}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{nf(f.total)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{nf(f.proxy)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums text-emerald-700">{nf(f.toUpstream)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{f.toFqdn ? <span className="text-amber-700">{nf(f.toFqdn)}</span> : '—'}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{f.undefined ? <span className="text-red-600 font-semibold">{nf(f.undefined)}</span> : '—'}</td>
                        <td className="py-1 text-right tabular-nums text-[var(--text-muted)]">{nf(f.other)}</td>
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
                              {f.fqdnList.map((x, i) => (
                                <span key={'f' + i} className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-amber-50 text-amber-700 border-amber-200" title={`doğrudan DNS adına gidiyor: ${x.target}`}>
                                  {x.location} → {x.target}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {data.locationsByFile.length === 0 && (
                    <tr><td colSpan={7} className="py-1 text-[var(--text-muted)]">location yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* 3) UPSTREAM'LER */}
          <Panel
            title={`Upstream'ler (${nf(data.upstreamList.length)})`}
            description="resolve: adres canlı çözülür · keepalive: bağlantı yeniden kullanılır · zone: resolve için paylaşımlı bellek · kullanımda: en az bir location gidiyor"
            dense
          >
            <div className="p-3">
              {data.upstreamList.length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)]">Bu sunucuda upstream tanımı yok.</div>
              ) : (
                <div className="overflow-auto max-h-[28rem]">
                  <table className="text-[11px] w-full">
                    <thead className="sticky top-0 bg-[var(--bg-surface)]">
                      <tr className="text-[var(--text-muted)]">
                        <th className="text-left pr-3 pb-1">Ad</th>
                        <th className="text-left pr-3 pb-1">server</th>
                        <th className="text-left pr-3 pb-1">Dosya</th>
                        <th className="text-center pr-3 pb-1" title={termHint('resolve yok')}>resolve</th>
                        <th className="text-center pr-3 pb-1">keepalive</th>
                        <th className="text-center pr-3 pb-1">zone</th>
                        <th className="text-center pb-1" title={termHint('Kullanılmayan upstream')}>kullanımda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.upstreamList.map((u) => (
                        <tr key={u.name} className="border-t border-[var(--border-subtle)]">
                          <td className="pr-3 py-0.5 font-mono whitespace-nowrap">{u.name}</td>
                          <td className="pr-3 py-0.5 font-mono text-[var(--text-muted)] whitespace-nowrap">{u.server || '—'}</td>
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
            </div>
          </Panel>

          {/* 4) AYARLAR */}
          <Panel
            title="Ayarlar — kurulum referansıyla karşılaştırma"
            description={termHint('Ayar sapması') + '. Referans: nginx_installation dosyaları (bmw_defaults.conf, proxy_settings.conf, rate_limits.conf, nginx.conf)'}
            dense
          >
            <div className="p-3">
              {/* TUM standart degerler alt alta (kullanici, 2026-09-16): uyumlu olanlar dahil.
                  Sapma olanlar kirmizi, tanimsiz olanlar italik; yalniz sapmalari gormek icin
                  ust sutun basligindaki suzgec. */}
              <div className="text-[11px] mb-1.5 flex items-center justify-between gap-2">
                <span className={data.settingsMismatched.length === 0 ? 'text-emerald-700' : 'text-red-700 font-semibold'}>
                  {data.settingsMismatched.length === 0
                    ? `Global ayarların tamamı referansla uyumlu (${nf((data.settingsAll || []).length)} direktif).`
                    : `${nf(data.settingsMismatched.length)} / ${nf((data.settingsAll || []).length)} direktif referanstan sapıyor.`}
                </span>
              </div>
              {(data.settingsAll || []).length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)]">Bu taramada referans karşılaştırması yok.</div>
              ) : (
                <table className="text-[11px] w-full mb-2">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="text-left pr-3 pb-1">Direktif</th>
                      <th className="text-left pr-3 pb-1">Bağlam</th>
                      <th className="text-left pr-3 pb-1">Standart (referans)</th>
                      <th className="text-left pr-3 pb-1">Sunucudaki değer</th>
                      <th className="text-left pr-3 pb-1">Durum</th>
                      <th className="text-left pb-1">Dosya</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.settingsAll || []).map((m, i) => (
                      <tr key={i} className={`border-t border-[var(--border-subtle)] ${m.matches ? '' : 'bg-red-50/50'}`}>
                        <td className="pr-3 py-1 font-mono whitespace-nowrap">{m.directive}</td>
                        <td className="pr-3 py-1 font-mono text-[var(--text-muted)]">{m.context}</td>
                        <td className="pr-3 py-1 font-mono text-emerald-700 break-all">{m.reference}</td>
                        <td className={`pr-3 py-1 font-mono break-all ${m.matches ? '' : 'text-red-700'}`}>
                          {m.value === null ? <i>tanımlı değil</i> : m.value}
                        </td>
                        <td className="pr-3 py-1 whitespace-nowrap">
                          {m.matches ? <span className="text-emerald-700">✓ uyumlu</span> : m.value === null ? <span className="text-red-700">✗ eksik</span> : <span className="text-red-700">✗ sapma</span>}
                        </td>
                        <td className="py-1 font-mono text-[var(--text-muted)]">{m.file || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.settingsOverrides.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
                    Yerel override&apos;lar ({nf(data.settingsOverrides.length)}) — bulgu değil, bilgi: server/location içinde referanstan farklı değer
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {data.settingsOverrides.map((o, i) => (
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
            </div>
          </Panel>

          {/* 5) KURULUM DOSYASI UYUMU */}
          <Panel
            title="Kurulum dosyası uyumu"
            description="nginx_installation/operations/files (licences hariç) sunucuya olduğu gibi kopyalanır; sunucudaki kopya referansla birebir olmalı. Fark direktif bazında."
            dense
          >
            <div className="p-3">
              {!meta?.filesReady ? (
                <Note tone="warning" title="Henüz açık değil">
                  <Code>dbo.Nginx_Audit_Files</Code> tablosu yok. <Code>bmw_nginx/nginx_audit/files/nginx_audit_schema.sql</Code>{' '}
                  yeniden çalıştırılmalı (IF NOT EXISTS korumalı); sonraki <Code>nginx_audit</Code> koşusunda burası dolar.
                </Note>
              ) : data.refFiles.length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)]">Bu tarama dosya uyumu verisi taşımıyor (job eski sürümle koşmuş olabilir).</div>
              ) : (
                <div className="space-y-2">
                  {data.refFiles.map((f) => <RefFileRow key={f.path} f={f} />)}
                </div>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function envSourceHint(src: string): string {
  if (src === 'name') return 'Ortam sunucu adı kalıbından türetildi';
  if (src === 'inventory') return 'Ortam dbo.Inventory (middleware_inventory) kaydından alındı';
  if (src === 'inventory-unknown') return 'Envanter kaydı var ama ortam değeri tanınmıyor';
  return 'Ne ad kalıbı ne envanter ortamı biliyor';
}

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  missing: { label: 'eksik', cls: 'text-red-700' },
  changed: { label: 'değişmiş', cls: 'text-amber-700' },
  extra: { label: 'fazla', cls: 'text-[var(--text-secondary)]' },
};

function RefFileRow({ f }: { f: NginxAuditRefFile }) {
  const status = !f.exists ? (
    <Pill tone="danger">sunucuda YOK</Pill>
  ) : f.identical === null ? (
    <Pill tone="neutral" title="referans dosyası bulunamadı">hüküm yok</Pill>
  ) : f.identical ? (
    <Pill tone="success">birebir</Pill>
  ) : (
    <Pill tone="warning">{`${nf(f.missing)} eksik · ${nf(f.changed)} değişmiş · ${nf(f.extra)} fazla`}</Pill>
  );
  const hasDetails = f.exists && f.identical === false && f.details.length > 0;
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-mono font-semibold">{f.refFile}</span>
        <span className="font-mono text-[var(--text-muted)]">{f.path}</span>
        <span className="ml-auto">{status}</span>
      </div>
      {hasDetails && (
        <table className="text-[11px] w-full mt-2">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="text-left pr-3 pb-1">Fark</th>
              <th className="text-left pr-3 pb-1">Direktif</th>
              <th className="text-left pr-3 pb-1">Referans</th>
              <th className="text-left pb-1">Sunucu</th>
            </tr>
          </thead>
          <tbody>
            {f.details.map((d, i) => {
              const k = KIND_LABEL[d.kind] || { label: d.kind, cls: '' };
              return (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className={`pr-3 py-0.5 font-semibold ${k.cls}`}>{k.label}</td>
                  <td className="pr-3 py-0.5 font-mono">{d.key}</td>
                  <td className="pr-3 py-0.5 font-mono text-emerald-700 break-all">{d.ref ?? <i className="text-[var(--text-muted)]">—</i>}</td>
                  <td className="py-0.5 font-mono text-red-700 break-all">{d.server ?? <i className="text-[var(--text-muted)]">—</i>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
