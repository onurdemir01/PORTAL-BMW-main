// src/components/crypto_hub/CryptoHubPage.tsx — Crypto Hub (2026-09-25).
//
// Kullanici: "ekibimizin yonettigi ucuncu parti uygulamalar (Metaco, Wyden) gelistirici ve
// rezilyans ekiplerince Portal'dan yonetilsin; kullanici once HANGI DOMAIN ve HANGI ORTAM
// diye secsin, sonra kosan surumu ve depodaki surumleri gorsun."
//
// FAZ 1 = DURUM + SURUMLER, SALT OKUNUR. Kapatma/upgrade/konfigurasyon sonraki fazlar.
//
// IKI TASARIM KARARI:
//  1) SECILEN ORTAM HER ZAMAN EKRANDA. Ayni Hub'da hem test hem production var; kullanici
//     "hangi cluster'a bakiyorum" sorusunu bir daha sormasin diye kapsam seridi sabit durur
//     ve production kirmizi gosterilir.
//  2) "OLCULEMEDI" != "YENI SURUM YOK". Registry kimligi verilmediyse surum listesi BOS gelir;
//     ekran bunu acikca "olculemedi" yazar. Bos listeyi "guncelsiniz" diye gostermek,
//     kullaniciya yanlis guven verirdi.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowPathIcon, ChevronRightIcon, ExclamationTriangleIcon, InformationCircleIcon,
  CheckCircleIcon, StopCircleIcon, ArrowUpCircleIcon, QuestionMarkCircleIcon,
  LockClosedIcon, PlayCircleIcon, PowerIcon,
} from '@heroicons/react/24/outline';
import {
  cryptoHubApi, type CryptoApp, type CryptoEnvOption, type CryptoOverview, type CryptoComponent,
  type CryptoActionDef,
} from '@/api/cryptoHubApi';
import { PlanModal } from './PlanModal';
import { BitcoinIcon, AppIcon } from '@/components/common/BrandIcons';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btnStyle = (): React.CSSProperties => ({ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });

const STATE: Record<CryptoComponent['state'], { label: string; color: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  running: { label: 'çalışıyor', color: 'var(--status-success)', Icon: CheckCircleIcon },
  degraded: { label: 'eksik replika', color: 'var(--status-warning)', Icon: ExclamationTriangleIcon },
  stopped: { label: 'kapalı', color: 'var(--text-muted)', Icon: StopCircleIcon },
};

function Pill({ tone, children, title }: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'accent'; children: React.ReactNode; title?: string }) {
  const map = {
    ok: ['var(--status-success)', 'var(--status-success-bg)'],
    warn: ['var(--status-warning)', 'var(--status-warning-bg)'],
    danger: ['var(--status-danger)', 'var(--status-danger-bg)'],
    muted: ['var(--text-muted)', 'var(--bg-elevated)'],
    accent: ['var(--accent)', 'var(--accent-bg)'],
  } as const;
  const [color, bg] = map[tone];
  return (
    <span title={title} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium leading-none" style={{ color, background: bg, border: '1px solid ' + color }}>
      {children}
    </span>
  );
}

// ── Secim: uygulama -> domain -> ortam ────────────────────────────────────────────────
function Picker({ apps, onPick }: { apps: CryptoApp[]; onPick: (env: CryptoEnvOption, app: CryptoApp, domainLabel: string) => void }) {
  const [app, setApp] = useState<CryptoApp | null>(apps.length === 1 ? apps[0] : null);
  const [domain, setDomain] = useState<string | null>(null);
  const dom = app?.domains.find((d) => d.domain === domain) || (app && app.domains.length === 1 ? app.domains[0] : null);
  const kapali = apps.reduce((n, a) => n + a.domains.reduce((m, d) => m + d.envs.filter((e) => e.open === false).length, 0), 0);

  // GIRIS EKRANI (2026-09-26, kullanici: "bu pencere cok kucuk gozukuyor"): kartlar
  // dar bir sutuna sikismis kucuk dugmelerdi. Artik sayfanin genisligini kullanan,
  // tiklama alani buyuk kartlar - bu ekran Hub'a girisin TEK kapisi, ufak durmamali.
  //
  // KAPALI ORTAM GIZLENMEZ, KILITLENIR: menuden yok olsaydi kullanici "production nerede?"
  // diye arardi; burada duruyor ve neden girilemedigi yaziyor.
  const Card = ({ title, sub, meta, onClick, tone, closed, icon }: {
    title: string; sub?: string; meta?: string; onClick: () => void;
    tone?: 'prod'; closed?: boolean; icon?: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={closed}
      title={closed ? 'Bu ortam şimdilik kapalı' : undefined}
      className={`group text-left rounded-2xl border p-5 w-full transition-shadow ${closed ? 'cursor-not-allowed opacity-70' : 'hover:shadow-md'}`}
      style={{
        borderColor: closed ? 'var(--border-subtle)' : tone === 'prod' ? 'var(--status-danger)' : 'var(--border-subtle)',
        background: closed ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        minHeight: '6.5rem',
      }}
    >
      <div className="flex items-start gap-4">
        {icon && (
          <span className="h-12 w-12 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: 'var(--bg-elevated)' }}>
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold truncate" style={{ color: closed ? 'var(--text-muted)' : tone === 'prod' ? 'var(--status-danger)' : 'var(--text-primary)' }}>
              {title}
            </span>
            {tone === 'prod' && !closed && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>production</span>
            )}
          </span>
          {sub && <span className="block text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{sub}</span>}
          {meta && <span className="block text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{meta}</span>}
        </span>
        {closed
          ? <LockClosedIcon className="h-5 w-5 shrink-0 mt-1" style={{ color: 'var(--text-muted)' }} />
          : <ChevronRightIcon className="h-5 w-5 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--text-muted)' }} />}
      </div>
    </button>
  );

  const Adim = ({ n, label, aktif, tamam }: { n: number; label: string; aktif: boolean; tamam: boolean }) => (
    <li className="flex items-center gap-2">
      <span
        className="h-6 w-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
        style={aktif || tamam
          ? { background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
          : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
      >{n}</span>
      <span className="text-[12px]" style={{ color: aktif ? 'var(--accent)' : 'var(--text-muted)', fontWeight: aktif ? 600 : 400 }}>{label}</span>
    </li>
  );

  const geriBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 h-8 px-3 text-[12px] rounded-lg border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
    >
      ‹ {label}
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto py-10 space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-semibold inline-flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
          <BitcoinIcon className="h-9 w-9" /> Crypto Hub
        </h1>
        <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
          Hangi uygulamada, hangi domainde ve hangi ortamda çalışacağınızı seçin.
        </p>
        {kapali > 0 && (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Production ortamları ({kapali}) şimdilik kapalı.
          </p>
        )}
      </header>

      <ol className="flex items-center justify-center gap-4">
        <Adim n={1} label="Uygulama" aktif={!app} tamam={!!app} />
        <span style={{ color: 'var(--text-muted)' }}>›</span>
        <Adim n={2} label="Domain" aktif={!!app && !dom} tamam={!!dom} />
        <span style={{ color: 'var(--text-muted)' }}>›</span>
        <Adim n={3} label="Ortam" aktif={!!app && !!dom} tamam={false} />
      </ol>

      {!app && (
        <div className="grid sm:grid-cols-2 gap-4">
          {apps.map((a) => (
            <Card
              key={a.app}
              icon={<AppIcon app={a.app} className="h-8 w-8" />}
              title={a.label}
              sub={a.domains.map((d) => d.label).join(' · ')}
              meta={a.domains.reduce((n, d) => n + d.envs.length, 0) + ' ortam'}
              onClick={() => { setApp(a); setDomain(null); }}
            />
          ))}
        </div>
      )}

      {app && !dom && (
        <div className="space-y-4">
          {geriBtn('uygulama seçimine dön', () => setApp(null))}
          <div className="grid sm:grid-cols-2 gap-4">
            {app.domains.map((d) => (
              <Card
                key={d.domain}
                icon={<AppIcon app={app.app} className="h-8 w-8" />}
                title={d.label}
                sub={d.envs.map((e) => e.label).join(' · ')}
                meta={d.envs.length + ' ortam'}
                onClick={() => setDomain(d.domain)}
              />
            ))}
          </div>
        </div>
      )}

      {app && dom && (
        <div className="space-y-4">
          {geriBtn('geri', () => { setDomain(null); if (app.domains.length === 1) setApp(null); })}
          <div className="grid sm:grid-cols-2 gap-4">
            {dom.envs.map((e) => (
              <Card
                key={e.key}
                icon={<AppIcon app={app.app} className="h-8 w-8" />}
                title={e.label}
                sub={e.cluster}
                meta={e.open === false
                  ? 'şimdilik kapalı'
                  : e.ready ? (e.namespace || '') : 'yapılandırma eksik'}
                tone={e.production ? 'prod' : undefined}
                closed={e.open === false}
                onClick={() => onPick(e, app, dom.label)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sekme: Durum ──────────────────────────────────────────────────────────────────────
function DurumTab({ data }: { data: CryptoOverview }) {
  const comps = data.components || [];
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="accent">{s?.total ?? 0} bileşen</Pill>
        <Pill tone="ok">{s?.running ?? 0} çalışıyor</Pill>
        {(s?.degraded ?? 0) > 0 && <Pill tone="warn">{s?.degraded} eksik replika</Pill>}
        {(s?.stopped ?? 0) > 0 && <Pill tone="muted">{s?.stopped} kapalı</Pill>}
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                <th className="text-left font-medium px-3 py-2">Bileşen</th>
                <th className="text-left font-medium px-3 py-2">Tür</th>
                <th className="text-right font-medium px-3 py-2">Hazır / İstenen</th>
                <th className="text-left font-medium px-3 py-2">Sürüm</th>
                <th className="text-left font-medium px-3 py-2">İmaj</th>
                <th className="text-left font-medium px-3 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {comps.length === 0 && <TableEmptyRow colSpan={6} title="Tarama kaydı yok" description="Bu ortam için henüz bir tarama koşmamış. “Taramayı tazele” ile başlatabilirsiniz." />}
              {comps.map((c) => {
                const st = STATE[c.state];
                return (
                  <tr key={c.kind + '/' + c.name} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.kind}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.ready ?? '—'} / {c.want ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{c.version || '—'}</td>
                    <td className="px-3 py-2 text-[11px] break-all" style={{ color: 'var(--text-secondary)' }}>{c.image || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: st.color }}>
                        <st.Icon className="h-3.5 w-3.5" /> {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Sekme: Surumler ───────────────────────────────────────────────────────────────────
function SurumTab({ data }: { data: CryptoOverview }) {
  const v = data.versions;
  const releases = data.releases || [];
  // ANA release: Wyden namespace'inde wydenapp yaninda keycloak + vault release'leri de var;
  // listenin ilkini almak, Wyden surumu yerine Keycloak surumunu gosterirdi.
  const main = releases.find((r) => r.name === v?.release) || releases[0];
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Şu an koşan chart sürümü</div>
          <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>{v?.running || '—'}</div>
          {main && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {main.name} · {main.chart} · uygulama {main.appVersion || '—'} · {main.status}
            </div>
          )}
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Depoda en yeni</div>
          {!v?.measured ? (
            // OLCULEMEDI: bos etiket listesi "guncelsiniz" DEMEK DEGIL.
            <div className="mt-1 space-y-1">
              <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
                <QuestionMarkCircleIcon className="h-4 w-4" /> ölçülemedi
              </span>
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Chart deposu sorgulanamadı (kimlik girilmemiş olabilir). Bu, “yeni sürüm yok” anlamına <b>gelmez</b>.
              </div>
            </div>
          ) : (
            <>
              <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: v.newer.length ? 'var(--status-warning)' : 'var(--text-primary)' }}>{v.latest || '—'}</div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {v.newer.length ? v.newer.length + ' yeni sürüm var' : 'Koşan sürüm en güncel.'}
              </div>
            </>
          )}
        </section>
      </div>

      {v?.measured && v.available.length > 0 && (
        <section className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Depodaki sürümler</div>
          <div className="flex flex-wrap gap-1.5">
            {v.available.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-md text-[11px] tabular-nums border"
                style={t === v.running
                  ? { color: 'var(--accent)', background: 'var(--accent-bg)', borderColor: 'var(--accent)', fontWeight: 600 }
                  : v.newer.includes(t)
                    ? { color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }
                    : { color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                title={t === v.running ? 'şu an koşan' : v.newer.includes(t) ? 'koşandan yeni' : 'eski'}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--accent)' }} /> koşan</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--status-warning)' }} /> daha yeni</span>
          </div>
        </section>
      )}

      {/* BASTION'DAKI ARSIV: Metaco'da chart deposu sorgulanamadigi icin SOMUT surum gecmisi
          burasi. "Depoda mevcut" ile AYNI SEY DEGIL - ayri baslik altinda duruyor. */}
      {(data.archives || []).length > 0 && (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
            Bastion'da hazır sürümler ({(data.archives || []).length}) — indirilmiş chart + values dosyaları
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  <th className="text-left font-medium px-3 py-2">Sürüm</th>
                  <th className="text-left font-medium px-3 py-2">Chart paketi</th>
                  <th className="text-left font-medium px-3 py-2">values dosyaları</th>
                  <th className="text-left font-medium px-3 py-2">Dizin</th>
                </tr>
              </thead>
              <tbody>
                {(data.archives || []).map((a) => (
                  <tr key={a.version + a.dir} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 tabular-nums font-medium" style={{ color: a.version === v?.running ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {a.version}{a.version === v?.running && <span className="ml-1 text-[10px]">koşan</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{a.chart || '—'}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {a.values.length === 0 ? '—' : (
                        <ul className="space-y-0.5">
                          {a.values.map((f) => (
                            <li key={f.file} className="flex items-center gap-2">
                              <span>{f.file}</span>
                              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{Math.round(f.size / 102.4) / 10} KB</span>
                              <span style={{ color: 'var(--text-muted)' }}>{f.mtime}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] break-all" style={{ color: 'var(--text-muted)' }}>{a.dir}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-[11px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
            Dosya içerikleri Portal'a alınmaz — values dosyalarında parola bulunabiliyor; yalnızca ad, boyut ve tarih tutulur.
          </div>
        </section>
      )}

      {releases.length > 0 && (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  <th className="text-left font-medium px-3 py-2">Helm release</th>
                  <th className="text-left font-medium px-3 py-2">Chart</th>
                  <th className="text-left font-medium px-3 py-2">Chart sürümü</th>
                  <th className="text-left font-medium px-3 py-2">Uygulama sürümü</th>
                  <th className="text-left font-medium px-3 py-2">Durum</th>
                  <th className="text-left font-medium px-3 py-2">Son güncelleme</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.name} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                    <td className="px-3 py-2">{r.chart || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.chartVersion || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.appVersion || '—'}</td>
                    <td className="px-3 py-2">{r.status || '—'}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.updatedAt || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sayfa ─────────────────────────────────────────────────────────────────────────────
export default function CryptoHubPage() {
  const { addJob } = useJobTracker();
  const [apps, setApps] = useState<CryptoApp[] | null>(null);
  const [scope, setScope] = useState<{ env: CryptoEnvOption; app: string; appLabel: string; domainLabel: string } | null>(null);
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [tab, setTab] = useState<'durum' | 'surumler'>('durum');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<CryptoActionDef[]>([]);
  const [planFor, setPlanFor] = useState<CryptoActionDef | null>(null);

  useAsyncEffect(async (alive) => {
    try {
      const r = await cryptoHubApi.tenants();
      if (!alive()) return;
      if (!r.ok) { setErr(r.message || 'Kiracı listesi alınamadı.'); return; }
      setApps(r.apps);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); }
    // Islem katalogu: ekran hangi islemleri sunacagini SUNUCUDAN ogrenir; yeni islem
    // eklendiginde arayuz degismek zorunda kalmasin.
    try {
      const a = await cryptoHubApi.actions();
      if (alive() && a.ok) setActions(a.actions);
    } catch { /* islem listesi alinamazsa ekran calismaya devam eder */ }
  }, []);

  const load = useCallback(async (key: string, fresh = false) => {
    setLoading(true); setErr('');
    try {
      const r = await cryptoHubApi.overview(key, fresh);
      if (!r.ok) { setErr(r.message || 'Veri alınamadı.'); setData(null); return; }
      setData(r);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); setData(null); } finally { setLoading(false); }
  }, []);

  const pick = (env: CryptoEnvOption, app: CryptoApp, domainLabel: string) => {
    setScope({ env, app: app.app, appLabel: app.label, domainLabel });
    setTab('durum');
    void load(env.key);
  };

  const rescan = async () => {
    if (!scope) return;
    const key = scope.env.key;
    setBusy(true);
    try {
      const r = await cryptoHubApi.rescan(key);
      if (!r.ok) { toast.error(r.message || 'Tarama başlatılamadı.'); return; }
      toast.success('Tarama başladı (iş #' + r.jobId + '). Bitince ekran yenilenir.');
      if (r.jobId != null && r.awxServerId != null) {
        const serverId = r.awxServerId;
        const jobId = r.jobId;
        let done = false;
        addJob({
          title: 'Crypto Hub: tara ' + key,
          fetchStatus: async () => {
            const s = await cryptoHubApi.jobStatus(serverId, jobId);
            if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
            if (TERMINAL.has(s.status) && !done) { done = true; void load(key, true); }
            return { status: s.status, output: s.output || '' };
          },
        });
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const notes = useMemo(() => data?.notes || [], [data]);

  if (err && !apps) return <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>;
  if (!apps) return <LoadingLogo compact />;
  if (!scope) return <Picker apps={apps} onPick={pick} />;

  const prod = scope.env.production;
  return (
    <div className="space-y-4">
      {/* KAPSAM SERIDI - her zaman gorunur; production kirmizi. */}
      <div
        className="rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2"
        style={{ borderColor: prod ? 'var(--status-danger)' : 'var(--border-subtle)', background: prod ? 'var(--status-danger-bg)' : 'var(--bg-surface)' }}
      >
        <AppIcon app={scope.app} className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{scope.appLabel}</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{scope.domainLabel}</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <Pill tone={prod ? 'danger' : 'ok'}>{scope.env.label}</Pill>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{scope.env.cluster} / {scope.env.namespace || '—'}</span>
        <span className="flex-1" />
        {data?.scannedAt && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>son tarama: {fmtDateTime(data.scannedAt)}</span>}
        <button type="button" className={SM_BTN} style={btnStyle()} onClick={rescan} disabled={busy || !!data?.notConfigured}>
          <ArrowPathIcon className={'h-3.5 w-3.5 ' + (busy ? 'animate-spin' : '')} /> Taramayı tazele
        </button>
        <button type="button" className={SM_BTN} style={btnStyle()} onClick={() => { setScope(null); setData(null); setErr(''); }}>
          Ortamı değiştir
        </button>
      </div>

      {/* ISLEMLER (2026-09-26 yeniden tasarim): kullanici "ac/kapa gorunumu amator duruyor"
          dedi. Kucuk butonlar yerine, her islem KENDI KARTI: ne yapacagi bir cumleyle yazili,
          kumeye dokunanlar isaretli. Hicbiri dogrudan calismaz - once on onay penceresi. */}
      {!data?.notConfigured && actions.length > 0 && (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-secondary)' }}>İşlemler</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              her işlem önce uygulanacak komutları gösterir; onaysız hiçbir şey çalışmaz
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-px" style={{ background: 'var(--border-subtle)' }}>
            {actions.map((a) => {
              const Icon = a.key === 'upgrade' ? ArrowUpCircleIcon : a.key === 'stop' ? PowerIcon : PlayCircleIcon;
              const tone = a.key === 'upgrade' ? 'var(--accent)' : a.key === 'stop' ? 'var(--status-danger)' : 'var(--status-success)';
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setPlanFor(a)}
                  className="text-left px-4 py-3 flex items-start gap-3 hover:brightness-[0.98] focus:outline-none focus-visible:ring-2"
                  style={{ background: 'var(--bg-surface)' }}
                >
                  <span className="mt-0.5 h-8 w-8 rounded-lg inline-flex items-center justify-center shrink-0"
                    style={{ background: 'var(--bg-elevated)', color: tone }}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
                    <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.hint}</span>
                    {a.writes && (
                      <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                        kümeyi değiştirir
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {planFor && (
        <PlanModal
          tenantKey={scope.env.key}
          tenantLabel={`${scope.appLabel} · ${scope.env.label}`}
          action={planFor}
          running={data?.versions?.running || ''}
          known={[
            ...(data?.versions?.available || []).map((v) => ({ version: v, source: 'depo' as const })),
            ...(data?.archives || []).map((a) => ({ version: a.version, source: 'arsiv' as const })),
          ]}
          onClose={() => setPlanFor(null)}
        />
      )}

      {err && <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>}

      {data?.notConfigured && (
        <div className="text-sm rounded-xl px-3 py-2 border flex items-start gap-2" style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{data.message}</span>
        </div>
      )}

      {data?.tableMissing && (
        <div className="text-sm rounded-xl px-3 py-2 border flex items-start gap-2" style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Crypto Hub tabloları bu veritabanında yok — <code>crypto_hub_schema.sql</code> henüz çalıştırılmamış olabilir. Bu, “bileşen yok” anlamına gelmez.</span>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n, i) => (
            <li
              key={i}
              className="text-[12px] rounded-lg px-3 py-1.5 border flex items-start gap-2"
              style={n.level === 'ERR'
                ? { color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }
                : { color: 'var(--text-secondary)', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              {n.level === 'ERR' ? <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" /> : <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />}
              <span><b>{n.stage || n.level}</b> — {n.message}</span>
            </li>
          ))}
        </ul>
      )}

      {!data?.notConfigured && (
        <>
          <nav className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            {([['durum', 'Durum'], ['surumler', 'Sürümler']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="px-3 py-2 text-sm font-medium -mb-px border-b-2"
                style={tab === id
                  ? { color: 'var(--accent)', borderColor: 'var(--accent)' }
                  : { color: 'var(--text-muted)', borderColor: 'transparent' }}
              >
                {label}
                {id === 'surumler' && data?.versions?.measured && data.versions.newer.length > 0 && (
                  <ArrowUpCircleIcon className="h-3.5 w-3.5 inline-block ml-1" style={{ color: 'var(--status-warning)' }} />
                )}
              </button>
            ))}
          </nav>

          {loading && !data ? <LoadingLogo compact /> : data ? (tab === 'durum' ? <DurumTab data={data} /> : <SurumTab data={data} />) : null}
        </>
      )}
    </div>
  );
}
