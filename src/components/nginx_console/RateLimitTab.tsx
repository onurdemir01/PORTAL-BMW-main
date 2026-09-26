// src/components/nginx_console/RateLimitTab.tsx — Nginx Hub › Rate Limit (v2, 2026-09-26).
//
// İKİ DÜZELTME (kullanıcı geri bildirimi):
//
// 1) YANLIŞ KAYNAK. İlk sürüm APIGW'lerin API location limitlerini gösteriyordu
//    (dbo.NginxRateLimitInventory). İstenen: TÜM nginx sunucularındaki
//    /usr/nginx/conf/rate_limits.conf değerleri. Kaynak artık dbo.Nginx_Audit_Settings —
//    nginx_audit her sunucuda `nginx -T` koşuyor, yani DOSYAYI değil ÇALIŞAN
//    konfigürasyonu okuyoruz: "tanımlı mı" ve "runtime'da uygulanıyor mu" aynı veriden.
//
// 2) OOM. İlk sürüm ~50.000 location satırını tarayıcıya yığıyordu ve sayfa çöküyordu.
//    Bu sürüm SUNUCU BAŞINA tek satır gösterir (~300). Ham direktifler yalnızca bir
//    sunucu AÇILDIĞINDA görünür ve sunucu başına 20 satırla sınırlıdır.
//
// ÜÇ DURUM AYRI: "standart" · "farklı" (değer estate'ten başka) · "eksik" (zone yok YA DA
// tanımlı ama uygulanmıyor). Sonuncusu sessiz ve tehlikelidir: zone bellekte durur ama
// hiçbir isteği sınırlamaz — bu yüzden ayrı bir durum.
import React, { useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon, ShieldExclamationIcon,
  InformationCircleIcon, ChevronRightIcon, ChevronDownIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { nginxConsoleApi, type NginxRateLimitResult, type NginxRateLimitHost } from '@/api/nginxConsoleApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { toast } from '@/hooks/useToast';

const SM = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });

const DURUM: Record<NginxRateLimitHost['durum'], { label: string; color: string; bg: string }> = {
  standart: { label: 'standart', color: 'var(--status-success)', bg: 'var(--status-success-bg)' },
  farkli: { label: 'farklı', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)' },
  eksik: { label: 'eksik', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
  bilinmiyor: { label: 'ölçülmedi', color: 'var(--text-muted)', bg: 'var(--bg-elevated)' },
  // SUNUCUNUN KENDI DURUMU (2026-09-26): bunlar bir limit bulgusu DEGIL, olcumun
  // neden yapilamadiginin sebebidir. 'eksik' ile ayni renkte gosterilmezler.
  kurulumyok: { label: 'nginx kurulu değil', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
  calismiyor: { label: 'nginx çalışmıyor', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)' },
  configbozuk: { label: 'konfigürasyon geçersiz', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
};

export function RateLimitTab() {
  const [data, setData] = useState<NginxRateLimitResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [scanDate, setScanDate] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('all');
  const [durum, setDurum] = useState<'all' | 'standart' | 'farkli' | 'eksik' | 'bilinmiyor' | 'kurulumyok' | 'calismiyor' | 'configbozuk'>('all');
  const [acik, setAcik] = useState<string | null>(null);

  useAsyncEffect(async (alive) => {
    setLoading(true); setErr('');
    try {
      const r = await nginxConsoleApi.rateLimit(scanDate || undefined);
      if (!alive()) return;
      if (!r.ok && !r.tableMissing) { setErr(r.message || 'Rate limit verisi alınamadı.'); setData(null); return; }
      setData(r);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); } finally { if (alive()) setLoading(false); }
  }, [scanDate, tick]);

  const hosts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.hosts || []).filter((h) => {
      if (durum !== 'all' && h.durum !== durum) return false;
      if (env !== 'all' && h.env !== env) return false;
      if (!needle) return true;
      return h.host.toLowerCase().includes(needle)
        || (h.requestRate || '').includes(needle)
        || (h.serverRate || '').includes(needle);
    });
  }, [data, q, env, durum]);

  const s = data?.summary;
  const envler = useMemo(() => Object.keys(s?.byEnv || {}).sort(), [s]);

  const indir = () => {
    const qs = scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : '';
    window.location.href = `/api/nginx-console/ratelimit.csv${qs}`;
    toast.success('Rapor indiriliyor (CSV).');
  };

  if (loading && !data) return <LoadingLogo compact />;
  if (err) {
    return <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>;
  }

  return (
    <div className="space-y-3">
      {data?.directivesMissing && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}
        >
          <span>{data.message}</span>
        </div>
      )}
      {data?.tableMissing && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{data.message}</span>
        </div>
      )}

      {/* ESTATE STANDARDI: uc tanim da http seviyesinde, her location miras alir. */}
      {data?.catalog && (
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
            Estate standardı — <code>{data.catalog.file}</code> · http seviyesinde tanımlanır ve uygulanır, tüm server/location miras alır
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            {data.catalog.zones.map((z) => (
              <div key={z.key} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{z.label}</div>
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--accent)' }}>
                  {z.rate || `${z.conn} bağlantı`}{z.burst != null ? ` · burst ${z.burst}${z.nodelay ? ' nodelay' : ''}` : ''}
                </div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  zone <code>{z.key}</code> · {z.variable} · {z.size}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {s && (
        <div className="grid sm:grid-cols-5 gap-3">
          <Kpi title="Sunucu" value={s.hosts} />
          <Kpi title="Standart" value={s.standart} tone="ok" />
          <Kpi title="Farklı" value={s.farkli} tone={s.farkli > 0 ? 'warn' : undefined} />
          <Kpi title="Eksik" value={s.eksik} tone={s.eksik > 0 ? 'danger' : undefined} />
          {s.bilinmiyor > 0 && <Kpi title="Ölçülmedi" value={s.bilinmiyor} />}
          {s.kurulumyok > 0 && <Kpi title="nginx kurulu değil" value={s.kurulumyok} tone="danger" />}
          {s.calismiyor > 0 && <Kpi title="nginx çalışmıyor" value={s.calismiyor} tone="warn" />}
          {s.configbozuk > 0 && <Kpi title="Konfigürasyon geçersiz" value={s.configbozuk} tone="danger" />}
          <Kpi title="Dosya yüklü değil" value={s.dosyaYuklenmemis} tone={s.dosyaYuklenmemis > 0 ? 'danger' : undefined} />
        </div>
      )}

      {/* FILO TEK TIP MI: kac farkli limit kombinasyonu kosuyor. */}
      {s && s.rates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>filodaki limit kombinasyonları (IP / sunucu adı):</span>
          {s.rates.map((r) => (
            <span key={r.combo} className="px-2 py-0.5 rounded-md border tabular-nums"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {r.combo} <b>{r.hosts}</b> sunucu
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-1.5" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sunucu ya da oran ara"
            className="h-7 pl-7 pr-2 text-[12px] rounded-lg border w-64"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
        </div>
        <select value={env} onChange={(e) => setEnv(e.target.value)} className="h-7 text-[12px] rounded-lg border px-1.5"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <option value="all">tüm ortamlar</option>
          {envler.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={durum} onChange={(e) => setDurum(e.target.value as typeof durum)} className="h-7 text-[12px] rounded-lg border px-1.5"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <option value="all">tüm durumlar</option>
          <option value="eksik">yalnız eksik</option>
          <option value="farkli">yalnız farklı</option>
          <option value="standart">yalnız standart</option>
          <option value="bilinmiyor">yalnız ölçülmeyenler</option>
          <option value="kurulumyok">yalnız nginx kurulu olmayanlar</option>
          <option value="calismiyor">yalnız nginx çalışmayanlar</option>
          <option value="configbozuk">yalnız konfigürasyonu geçersizler</option>
        </select>
        {(data?.availableDates || []).length > 1 && (
          <select value={scanDate} onChange={(e) => setScanDate(e.target.value)} className="h-7 text-[12px] rounded-lg border px-1.5"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
            <option value="">son tarama ({data?.scanDate})</option>
            {(data?.availableDates || []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <span className="flex-1" />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{hosts.length} / {data?.hosts?.length ?? 0} sunucu</span>
        <button type="button" className={SM} style={btn()} onClick={() => setTick((n) => n + 1)}>
          <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
        <button type="button" className={SM} style={btn(true)} disabled={!data?.hosts?.length} onClick={indir}>
          <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Rapor indir (CSV)
        </button>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto" style={{ maxHeight: '58vh' }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
              <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <th className="w-6" />
                <th className="text-left font-medium px-3 py-2">Sunucu</th>
                <th className="text-left font-medium px-3 py-2">Ortam</th>
                <th className="text-left font-medium px-3 py-2">IP istek limiti/kullanıcı başına</th>
                <th className="text-left font-medium px-3 py-2">Sunucu limiti</th>
                <th className="text-right font-medium px-3 py-2">Concurrent bağlantı limiti/kullanıcı başına</th>
                <th className="text-left font-medium px-3 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {hosts.length === 0 && (
                <TableEmptyRow colSpan={7}
                  title={(data?.hosts?.length ?? 0) === 0 ? 'Rate limit verisi yok' : 'Süzgece uyan sunucu yok'}
                  description={(data?.hosts?.length ?? 0) === 0
                    ? 'nginx_audit job\'ı henüz koşmamış olabilir. Bu, "limit yok" anlamına GELMEZ.'
                    : 'Arama, ortam ya da durum süzgecini gevşetin.'} />
              )}
              {hosts.map((h) => {
                const d = DURUM[h.durum];
                const open = acik === h.host;
                return (
                  <React.Fragment key={h.host}>
                    <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => setAcik(open ? null : h.host)}>
                      <td className="pl-2">
                        {open ? <ChevronDownIcon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                          : <ChevronRightIcon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />}
                      </td>
                      <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {h.host}
                        {h.calisiyor === false && h.durum !== 'kurulumyok' && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                            style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
                            title={h.hostDurumMsg || 'nginx ayakta degil: buradaki degerler DOSYADA yazan degerler, su an uygulanmiyor.'}>
                            durdurulmus
                          </span>
                        )}
                        {!h.fileLoaded && h.durum !== 'kurulumyok' && (
                          <span className="ml-2 text-[10px]" style={{ color: 'var(--status-danger)' }}
                            title="nginx -T çıktısında rate_limits.conf görünmüyor — dosya yüklenmemiş olabilir">
                            rate_limits.conf yok
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{h.env}</td>
                      <td className="px-3 py-1.5 text-[11px] tabular-nums">{h.requestRate || '—'}</td>
                      <td className="px-3 py-1.5 text-[11px] tabular-nums">{h.serverRate || '—'}</td>
                      <td className="px-3 py-1.5 text-[11px] tabular-nums text-right">{h.connLimit ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ color: d.color, background: d.bg, border: `1px solid ${d.color}` }}>
                          {h.durum === 'standart' ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <ShieldExclamationIcon className="h-3.5 w-3.5" />}
                          {d.label}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ background: 'var(--bg-elevated)' }}>
                        <td colSpan={7} className="px-4 py-3">
                          {(h.eksikler.length > 0 || h.farklar.length > 0) && (
                            <ul className="mb-2 space-y-0.5 text-[12px]">
                              {h.eksikler.map((x, i) => <li key={`e${i}`} style={{ color: 'var(--status-danger)' }}>• {x}</li>)}
                              {h.farklar.map((x, i) => <li key={`f${i}`} style={{ color: 'var(--status-warning)' }}>• {x}</li>)}
                            </ul>
                          )}
                          <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                            nginx -T çıktısındaki limit direktifleri
                          </div>
                          <pre className="text-[11.5px] leading-relaxed rounded-lg px-3 py-2 overflow-auto"
                            style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', maxHeight: '30vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {h.detay.length === 0 ? '(limit direktifi bulunamadı)' : h.detay.map((x) => `${x.context} · ${x.directive} ${x.value}`).join('\n')}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Kaynak: <code>dbo.Nginx_Audit_Settings</code> — <b>nginx_audit</b> job'ı her sunucuda <code>nginx -T</code> koşar,
        yani burada gördüğünüz <b>çalışan</b> konfigürasyondur, diskteki dosya değil.
        <b> Eksik</b> = zone hiç yok <i>ya da</i> tanımlı ama <code>limit_req</code>/<code>limit_conn</code> ile uygulanmıyor.
        Tarama: {data?.scanDate || '—'}
      </p>
    </div>
  );
}

function Kpi({ title, value, tone }: { title: string; value: number; tone?: 'ok' | 'danger' | 'warn' }) {
  const color = tone === 'danger' ? 'var(--status-danger)'
    : tone === 'warn' ? 'var(--status-warning)'
    : tone === 'ok' ? 'var(--status-success)' : 'var(--text-primary)';
  return (
    <section className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{title}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5" style={{ color }}>{value}</div>
    </section>
  );
}

export default RateLimitTab;
