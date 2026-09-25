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
  CheckCircleIcon, StopCircleIcon, CubeTransparentIcon, ArrowUpCircleIcon, QuestionMarkCircleIcon,
  LockClosedIcon, PlayCircleIcon,
} from '@heroicons/react/24/outline';
import {
  cryptoHubApi, type CryptoApp, type CryptoEnvOption, type CryptoOverview, type CryptoComponent,
  type CryptoActionDef,
} from '@/api/cryptoHubApi';
import { PlanModal } from './PlanModal';
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

  // KAPALI ORTAM GIZLENMEZ, KILITLENIR: menuden yok olsaydi kullanici "production nerede?"
  // diye arardi; burada duruyor ve neden girilemedigi yaziyor.
  const Card = ({ title, sub, onClick, tone, closed }: { title: string; sub?: string; onClick: () => void; tone?: 'prod'; closed?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={closed}
      title={closed ? 'Bu ortam şimdilik kapalı' : undefined}
      className={`text-left rounded-xl border px-4 py-3 w-full ${closed ? 'cursor-not-allowed opacity-60' : 'hover:shadow-sm'}`}
      style={{ borderColor: tone === 'prod' && !closed ? 'var(--status-danger)' : 'var(--border-subtle)', background: closed ? 'var(--bg-elevated)' : 'var(--bg-surface)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: closed ? 'var(--text-muted)' : tone === 'prod' ? 'var(--status-danger)' : 'var(--text-primary)' }}>{title}</span>
        {closed
          ? <LockClosedIcon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          : <ChevronRightIcon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />}
      </div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <header className="text-center space-y-1">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Crypto Hub</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Hangi uygulamada, hangi domainde ve hangi ortamda çalışacağınızı seçin.
        </p>
        {kapali > 0 && (
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Production ortamları ({kapali}) şimdilik kapalı.
          </p>
        )}
      </header>

      <ol className="flex items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <li style={app ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>1. Uygulama</li>
        <li>›</li>
        <li style={dom ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>2. Domain</li>
        <li>›</li>
        <li>3. Ortam</li>
      </ol>

      {!app && (
        <div className="grid sm:grid-cols-2 gap-3">
          {apps.map((a) => (
            <Card
              key={a.app}
              title={a.label}
              sub={a.domains.length + ' domain · ' + a.domains.reduce((n, d) => n + d.envs.length, 0) + ' ortam'}
              onClick={() => { setApp(a); setDomain(null); }}
            />
          ))}
        </div>
      )}

      {app && !dom && (
        <div className="space-y-3">
          <button type="button" className="text-[11px] underline" style={{ color: 'var(--text-muted)' }} onClick={() => setApp(null)}>‹ uygulama seçimine dön</button>
          <div className="grid sm:grid-cols-2 gap-3">
            {app.domains.map((d) => (
              <Card key={d.domain} title={d.label} sub={d.envs.length + ' ortam'} onClick={() => setDomain(d.domain)} />
            ))}
          </div>
        </div>
      )}

      {app && dom && (
        <div className="space-y-3">
          <button
            type="button"
            className="text-[11px] underline"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => { setDomain(null); if (app.domains.length === 1) setApp(null); }}
          >‹ geri</button>
          <div className="grid sm:grid-cols-2 gap-3">
            {dom.envs.map((e) => (
              <Card
                key={e.key}
                title={e.label}
                sub={e.open === false
                  ? e.cluster + ' · şimdilik kapalı'
                  : e.ready ? e.cluster : e.cluster + ' · yapılandırma eksik'}
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
  const [scope, setScope] = useState<{ env: CryptoEnvOption; appLabel: string; domainLabel: string } | null>(null);
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
    setScope({ env, appLabel: app.label, domainLabel });
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
        <CubeTransparentIcon className="h-5 w-5 shrink-0" style={{ color: prod ? 'var(--status-danger)' : 'var(--accent)' }} />
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

      {/* ISLEMLER: her biri once ON ONAY PENCERESI acar - hicbiri dogrudan calismaz. */}
      {!data?.notConfigured && actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>İşlemler</span>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={SM_BTN}
              style={btnStyle()}
              title={a.hint + ' — önce uygulanacak komutlar gösterilir'}
              onClick={() => setPlanFor(a)}
            >
              <PlayCircleIcon className="h-3.5 w-3.5" /> {a.label}
            </button>
          ))}
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            komutlar önce onay penceresinde gösterilir
          </span>
        </div>
      )}

      {planFor && (
        <PlanModal
          tenantKey={scope.env.key}
          tenantLabel={`${scope.appLabel} · ${scope.env.label}`}
          action={planFor}
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
