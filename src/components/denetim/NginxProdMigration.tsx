// src/components/denetim/NginxProdMigration.tsx — Nginx SPA > "Production Taşımaları".
//
// Soru (kullanici, 2026-09-14): eski GBRVP* sunucularinin location'larinda proxy_pass
// ile tanimli uygulamalar, yeni GBNGXP4x/5x sunucularinda
//   /hysdeploy/<ns>/<app>/  ve  /usr/nginx/applications/<ns>/<app>/
// olarak var mi? Her satir bir uygulama, her sutun bir YENI sunucu. Hesap sunucuda
// (nginx-migration.cjs); burada yalnizca gosterim.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, DocumentPlusIcon } from '@heroicons/react/24/outline';
import { nginxMigrationApi, type NginxMigrationConfig } from '@/api/nginxMigrationApi';
import { ansibleApi, type AwxServer } from '@/api/ansibleApi';
import { Modal } from '@/components/common/Modal';
import { useAuth } from '@/contexts/AuthContext';
import {
  denetimApi,
  type NginxMigrationApp,
  type NginxMigrationGroup,
  type NginxMigrationOther,
  type NginxMigrationResult,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, Code, Note } from './ui';
import { OwnerCell, ownerText } from './OwnerCell';

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
  // Siralama (kullanici, 2026-09-14): 'status' (sorunlu ustte) | 'team' (cok uygulamasi
  // olan ekip ustte, ekip icinde uygulama adi) | 'app' (ad)
  const [sortBy, setSortBy] = useState<'status' | 'team' | 'app'>('status');
  const [q, setQ] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [config, setConfig] = useState<NginxMigrationConfig>({ awxServerId: 0, templateId: 0 });
  // Onay penceresi: hangi satir, hangi location (birden fazla olabilir)
  const [pending, setPending] = useState<{ group: NginxMigrationGroup; app: NginxMigrationApp; pathIdx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const loadConfig = async () => {
    try {
      const r = await nginxMigrationApi.config();
      if (r.ok) setConfig(r.config);
    } catch {
      /* yapilandirma okunamazsa dugme 'yapilandirilmamis' uyarisi verir */
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadConfig();
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

  async function confirmCreate() {
    if (!pending) return;
    const path = pending.app.paths[pending.pathIdx];
    setBusy(true);
    try {
      const r = await nginxMigrationApi.create({
        group: pending.group.id,
        namespace: pending.app.namespace,
        application: pending.app.application,
        service: path.service,
        inputPath: path.location,
      });
      if (r.ok) {
        setResult({
          tone: 'ok',
          text: `${pending.app.application} için tanım işi başlatıldı${r.job?.id ? ` (job ${r.job.id})` : ''}: ${path.service}-PROD.conf içinde ${path.location} → application-confs/${path.service.toLowerCase()}-${pending.app.application}-${pending.app.namespace}.conf · hedef: ${(r.targetHosts || []).join(', ')}. Sonucu Teams / AWX'ten izleyin.`,
        });
      } else setResult({ tone: 'bad', text: r.message || 'İş başlatılamadı.' });
    } catch (e: unknown) {
      setResult({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (loading && !data) return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  const configured = config.awxServerId > 0 && config.templateId > 0;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu ekran ne gösteriyor?">
        Eski prod sunucularının (<Code>GBRVP*</Code>) vhost&apos;larındaki her <Code>proxy_pass</Code> hedefi
        OpenShift route envanteriyle <i>(namespace, uygulama)</i>&apos;ya çözülür; sonra <b>her yeni sunucuda</b>{' '}
        <Code>/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</Code> ve <Code>/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/</Code>{' '}
        var mı bakılır (hücre gösterimi için aşağıdaki sözlük).
        <div className="mt-1">
          <Code>proxy_pass</Code> iki biçimde yazılmış olabilir: doğrudan <b>FQDN</b>{' '}
          (<Code>https://&lt;app&gt;-&lt;ns&gt;.apps.fw.garanti.com.tr/</Code>) ya da bir <b>upstream</b> adı{' '}
          (<Code>https://&lt;app&gt;-&lt;ns&gt;/</Code>) — ikisi de aynı uygulamaya çözülür; upstream takma adlıysa
          (<Code>onur</Code> gibi) gerçek adres upstream bloğunun <Code>server</Code> satırından alınır.
          &quot;Yazım&quot; sütunu hangisinin kullanıldığını gösterir. Eski yazımda namespace çoğunlukla{' '}
          <b>-prod eksiz</b>dir (<Code>…-digital-banking-ch</Code>); ad olduğu gibi tutmazsa <Code>-prod</Code>{' '}
          eklenerek eşlenir ve satırda <b>+prod</b> olarak işaretlenir — ekip ve dizin kontrolü gerçek
          (<Code>-prod</Code>&apos;lu) namespace üzerinden yapılır.
        </div>
        Bir uygulama <b>hazır</b> sayılır ancak yeni sunucuların <b>hepsinde</b> H ve A varsa.
        <div className="mt-1.5 text-[var(--text-muted)]">
          Eski sunucu verisi: <Code>nginx_config_audit</Code> ({data.proxyScanDate || '—'}) · yeni sunucu dizinleri:
          aynı job ({data.dirScanDate || '—'}). SPA olmayan hedefler (API/arka uç) dizin beklemez, ayrı listelenir.
        </div>
      </Note>

      <HacLegend />

      {result && (
        <Note tone={result.tone === 'ok' ? 'success' : 'danger'} title={result.tone === 'ok' ? 'İş başlatıldı' : 'İş başlatılamadı'}>
          {result.text}
        </Note>
      )}

      {!configured && (
        <Note tone="warning" title="&quot;Tanım oluştur&quot; henüz çalışmıyor — yapılandırma eksik">
          <Code>bmw_nginx/nginx_ops/nginx_prod_migration.yml</Code> için AWX&apos;te bir job template açılıp
          Portal&apos;a tanıtılması gerekiyor. Bu yapılana kadar düğme açık bir hata döndürür.
          {!isAdmin && <div className="mt-1">Bu ayarı yalnızca <b>yönetici</b> yapabilir.</div>}
        </Note>
      )}
      {isAdmin && <MigrationConfigPanel config={config} onSaved={loadConfig} />}

      {!data.proxyReady && (
        <Note tone="warning" title="Eski sunucu proxy verisi yok">
          <Code>dbo.Nginx_Config_Audit</Code>&apos;te proxy satırı yok (DDL <Code>nginx_config_audit_migrate_proxy.sql</Code>{' '}
          ya da job henüz koşmamış).
        </Note>
      )}

      <div className="flex items-center gap-2 justify-end flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="uygulama, namespace ya da ekip ara"
          className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'status' | 'team' | 'app')}
          className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
          title="Sıralama"
        >
          <option value="status">sırala: durum (sorunlu üstte)</option>
          <option value="team">sırala: ekip (çok uygulaması olan üstte)</option>
          <option value="app">sırala: uygulama adı</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={onlyProblem} onChange={(e) => setOnlyProblem(e.target.checked)} />
          Sadece hazır olmayanlar
        </label>
        <button
          onClick={() =>
            csvDownload(
              'nginx_prod_tasima',
              ['grup', 'namespace', 'prod_eki_eklendi', 'uygulama', 'ekip', 'yazim', 'yazilan_ad', 'durum', 'hazir_sunucu', 'taranan_sunucu', 'eski_sunucular', 'servis', 'location_sayisi', 'hedef', ...data.groups.flatMap((g) => g.newHosts)],
              data.groups.flatMap((g) =>
                g.apps.map((a) => [
                  g.label, a.namespace, a.suffixAdded ? 'evet' : '', a.application, a.owner?.groups.join(' | ') || '', a.forms.join('+'), a.written.join(' '), STATUS[a.status].label, a.readyHosts, a.scannedHosts,
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
        <GroupPanel
          key={g.id}
          g={g}
          onlyProblem={onlyProblem}
          q={q}
          sortBy={sortBy}
          ownersReady={data.ownersReady !== false}
          canCreate={configured}
          onCreate={(app) => setPending({ group: g, app, pathIdx: 0 })}
        />
      ))}

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title="Yeni sunucularda tanım oluştur"
        subtitle={pending ? `${pending.app.application} · ${pending.app.namespace}` : undefined}
        icon={DocumentPlusIcon}
        dismissOnBackdrop={false}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setPending(null)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]">İptal</button>
            <button
              onClick={confirmCreate}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Başlatılıyor…' : 'Evet, tanımı oluştur'}
            </button>
          </div>
        }
      >
        {pending && (() => {
          const path = pending.app.paths[pending.pathIdx];
          const svc = path.service;
          return (
            <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {pending.app.paths.length > 1 && (
                <div>
                  Bu uygulama eski sunucuda <b>{pending.app.paths.length}</b> farklı location&apos;dan sunuluyor; hangisi taşınsın?
                  <div className="mt-1 space-y-0.5">
                    {pending.app.paths.map((p, i) => (
                      <label key={p.service + p.location} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="path" checked={i === pending.pathIdx} onChange={() => setPending({ ...pending, pathIdx: i })} />
                        <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{p.service}-PROD.conf · {p.location}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">({p.hosts.join(', ')})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <p>Yeni sunucularda (<span className="font-mono">{pending.group.newHosts.join(', ')}</span>) şunlar oluşturulacak:</p>
              <div className="font-mono text-[11px] space-y-0.5 rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                <div>/usr/nginx/conf.d/{svc}-PROD.conf → <span className="text-[var(--text-muted)]">location {path.location} {'{'} include …/{svc.toLowerCase()}-{pending.app.application}-{pending.app.namespace}.conf; {'}'}</span></div>
                <div>/usr/nginx/conf.d/application-confs/{svc.toLowerCase()}-{pending.app.application}-{pending.app.namespace}.conf</div>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Non-prod SPA oluşturma akışının aynısı: uygulama dizini yoksa durur; aynı context path zaten tanımlıysa durur;
                aynı ad varsa dosya <Code>-N</Code> eki alır; <Code>nginx -t</Code> düşerse değişiklik geri alınır, geçerse reload.
                Eski sunucudaki proxy_pass tanımına <b>dokunulmaz</b>; trafik geçişi ayrıca planlanır.
              </p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/** H/A/C gosterimi sozlugu: her harf bir dizin/dosya; buyuk harf = var, kucuk = YOK. */
function HacLegend() {
  const Ex = ({ f, label }: { f: { hys: boolean; app: boolean; conf: boolean }; label: string }) => (
    <div className="flex items-center gap-2">
      <DirCell f={f} />
      <span>{label}</span>
    </div>
  );
  return (
    <details className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }} open>
      <summary className="text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-primary)' }}>
        Hücre gösterimi — H A C ne demek?
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="space-y-1">
          <div>Her yeni sunucu sütununda üç harf; <b>büyük harf = var</b>, <b>küçük harf = YOK</b>. Yeşil zemin = taşımaya hazır (H ve A var), kırmızı zemin = eksik.</div>
          <table className="mt-1">
            <tbody>
              <tr><td className="pr-2 font-mono font-semibold">H</td><td><Code>/hysdeploy/&lt;ns&gt;/&lt;app&gt;/</Code> — dağıtım paketinin açıldığı dizin (deploy job&apos;ı bırakır)</td></tr>
              <tr><td className="pr-2 font-mono font-semibold">A</td><td><Code>/usr/nginx/applications/&lt;ns&gt;/&lt;app&gt;/</Code> — nginx&apos;in servis ettiği dosyalar; <b>tanım için şart</b></td></tr>
              <tr><td className="pr-2 font-mono font-semibold">C</td><td><Code>application-confs/&lt;app&gt;-&lt;ns&gt;.conf</Code> — per-uygulama nginx konfigürasyonu; &quot;Tanım oluştur&quot; bunu yazar</td></tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-1.5">
          <Ex f={{ hys: true, app: true, conf: true }} label="üçü de var — tanım yapılmış, hazır" />
          <Ex f={{ hys: true, app: true, conf: false }} label={'paket ve dosyalar var, konfigürasyon YOK — "Tanım oluştur" ile tamamlanır'} />
          <Ex f={{ hys: true, app: false, conf: false }} label="yalnız paket dizini var, uygulama dosyaları YOK — deploy yarım kalmış; tanım yazılamaz" />
          <Ex f={{ hys: false, app: true, conf: true }} label="paket dizini yok ama dosyalar ve conf var — elle konulmuş olabilir; çalışır" />
          <div className="flex items-center gap-2"><span className="text-[var(--text-muted)]">—</span><span>uygulama bu sunucuda hiç yok</span></div>
          <div className="flex items-center gap-2"><span className="text-[10px] text-[var(--text-muted)]">taranmadı</span><span>sunucu henüz taranmadı, bilinmiyor</span></div>
        </div>
      </div>
    </details>
  );
}

/** Yoneticiye ozel: bu ekranin hangi AWX job template'ini calistiracagi (nginx-expose ile ayni desen). */
function MigrationConfigPanel({ config, onSaved }: { config: NginxMigrationConfig; onSaved: () => void }) {
  const [servers, setServers] = useState<AwxServer[]>([]);
  const [awxServerId, setAwxServerId] = useState(config.awxServerId || 0);
  const [templateId, setTemplateId] = useState(String(config.templateId || ''));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => {
    setAwxServerId(config.awxServerId || 0);
    setTemplateId(String(config.templateId || ''));
  }, [config.awxServerId, config.templateId]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await ansibleApi.servers();
        if (alive && r.ok) setServers(r.servers || []);
      } catch {
        if (alive) setMsg({ tone: 'bad', text: 'AWX sunucu listesi alınamadı; ID elle girilebilir.' });
      }
    })();
    return () => { alive = false; };
  }, []);
  const save = async () => {
    const tid = Number(templateId) || 0;
    if (awxServerId <= 0 || tid <= 0) { setMsg({ tone: 'bad', text: 'AWX sunucusu ve job template ID zorunlu.' }); return; }
    setBusy(true);
    try {
      const r = await nginxMigrationApi.saveConfig({ awxServerId, templateId: tid });
      if (r.ok) { setMsg({ tone: 'ok', text: 'Kaydedildi. Düğme artık çalışır.' }); onSaved(); }
      else setMsg({ tone: 'bad', text: r.message || 'Kaydedilemedi.' });
    } catch (e: unknown) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const inputCls = 'px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]';
  return (
    <Panel title="Tanım oluşturma job'ı (yönetici)" description="nginx_ops/nginx_prod_migration.yml için AWX template" dense>
      <div className="flex flex-wrap items-end gap-3 px-3 py-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">AWX sunucusu</span>
          <select value={awxServerId} onChange={(e) => setAwxServerId(Number(e.target.value))} className={inputCls}>
            <option value={0}>seçiniz…</option>
            {servers.map((sv) => (<option key={sv.id} value={sv.id}>{sv.name}{sv.configured ? '' : ' (yapılandırılmamış)'}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Job template ID</span>
          <input value={templateId} onChange={(e) => setTemplateId(e.target.value.replace(/[^0-9]/g, ''))} placeholder="örn. 412" inputMode="numeric" className={`${inputCls} w-28`} />
        </label>
        <button onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {msg && <span className={`text-[11px] ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  'upstream-server': 'upstream bloğunun server satırı',
  proxy_ssl_name: 'location’daki proxy_ssl_name',
  proxy_pass: 'proxy_pass’teki adın kendisi',
};

function FormCell({ forms, written, source, target }: { forms: string[]; written: string[]; source: string; target: string }) {
  const title = [`yazılan: ${written.join(', ')}`, `gerçek hedef: ${target}`, `kaynak: ${SOURCE_LABEL[source] || source}`].join('\n');
  return (
    <span className="inline-flex gap-1" title={title}>
      {forms.map((f) => (
        <span key={f} className="text-[10px] px-1.5 py-0.5 rounded border font-mono" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {f === 'fqdn' ? 'FQDN' : 'upstream'}
        </span>
      ))}
    </span>
  );
}

function cellText(f: { hys: boolean; app: boolean; conf: boolean } | null | undefined): string {
  if (f === null) return 'taranmadi';
  if (!f) return '';
  return (f.hys ? 'H' : '-') + (f.app ? 'A' : '-') + (f.conf ? 'C' : '-');
}

const STATUS_ORDER: Record<NginxMigrationApp['status'], number> = { missing: 0, partial: 1, 'not-scanned': 2, ready: 3 };

function GroupPanel({
  g, onlyProblem, q, sortBy, ownersReady, canCreate, onCreate,
}: {
  g: NginxMigrationGroup;
  onlyProblem: boolean;
  q: string;
  sortBy: 'status' | 'team' | 'app';
  ownersReady: boolean;
  canCreate: boolean;
  onCreate: (app: NginxMigrationApp) => void;
}) {
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = g.apps.filter((a) => {
      if (onlyProblem && a.status === 'ready') return false;
      if (needle && !a.application.includes(needle) && !a.namespace.includes(needle) && !ownerText(a.owner).includes(needle)) return false;
      return true;
    });
    if (sortBy === 'team') {
      // Ekip = ilk grup adi; ekibin uygulama sayisi (bu grupta) cok olan ustte, ekipsizler EN SONA.
      const teamOf = (a: NginxMigrationApp) => a.owner?.groups[0] || '';
      const count = new Map<string, number>();
      for (const a of g.apps) count.set(teamOf(a), (count.get(teamOf(a)) || 0) + 1);
      list = [...list].sort((a, b) => {
        const ta = teamOf(a), tb = teamOf(b);
        if (!ta !== !tb) return ta ? -1 : 1;
        return (count.get(tb) || 0) - (count.get(ta) || 0) || ta.localeCompare(tb) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.application.localeCompare(b.application);
      });
    } else if (sortBy === 'app') {
      list = [...list].sort((a, b) => a.application.localeCompare(b.application));
    }
    return list;
  }, [g, onlyProblem, q, sortBy]);
  // Ekip bazli ozet (siralama 'ekip' iken baslikta gosterilir)
  const teamSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of g.apps) { const t = a.owner?.groups[0] || '(ekip bilinmiyor)'; m.set(t, (m.get(t) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [g]);
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

        {sortBy === 'team' && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {teamSummary.map(([t, n]) => (
              <span key={t} className="px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                {t} <b>{n}</b>
              </span>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-[11px] w-full">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="pr-2 pb-1" />
                <th className="text-left pr-3 pb-1">Uygulama</th>
                <th className="text-left pr-3 pb-1">Namespace</th>
                <th className="text-left pr-3 pb-1" title="namespace'in CMDB sahibi">Ekip</th>
                <th className="text-left pr-3 pb-1">Durum</th>
                <th className="text-left pr-3 pb-1" title="eski sunucudaki vhost / location sayısı">Eski taraf</th>
                <th className="text-left pr-3 pb-1" title="proxy_pass yazımı: FQDN ya da upstream adı; ipucunda yazılan ad(lar) ve gerçek hedefin kaynağı">Yazım</th>
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
                  <td className="pr-2 py-1">
                    <button
                      onClick={() => onCreate(a)}
                      disabled={!canCreate || a.status === 'missing' || a.status === 'not-scanned'}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg text-white disabled:opacity-40 whitespace-nowrap"
                      style={{ background: 'var(--accent)' }}
                      title={
                        !canCreate ? 'Job yapılandırılmamış (yönetici paneli)'
                          : a.status === 'missing' ? 'Taranan hiçbir yeni sunucuda uygulama dizini yok — önce deploy'
                          : a.status === 'not-scanned' ? 'Yeni sunucular henüz taranmadı'
                          : `Yeni sunucularda ${a.paths.map((p) => p.service + '-PROD.conf ' + p.location).join(' / ')} tanımını oluştur`
                      }
                    >
                      <DocumentPlusIcon className="w-3.5 h-3.5" /> Tanım oluştur
                    </button>
                  </td>
                  <td className="pr-3 py-1 font-mono whitespace-nowrap" title={`hedef: ${a.target} · çözüm: ${a.how === 'route' ? 'route adresi (kesin)' : 'OpenShift envanter çifti'}`}>
                    {a.application}
                  </td>
                  <td className="pr-3 py-1 font-mono text-[var(--text-muted)] whitespace-nowrap">
                    {a.namespace}
                    {a.suffixAdded && (
                      <span className="ml-1 text-[9px] px-1 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }} title="proxy_pass yazımında -prod yoktu; eklenerek eşlendi">+prod</span>
                    )}
                  </td>
                  <td className="pr-3 py-1"><OwnerCell owner={a.owner} ready={ownersReady} /></td>
                  <td className="pr-3 py-1">
                    <Pill tone={STATUS[a.status].tone} title={STATUS[a.status].hint}>
                      {STATUS[a.status].label} {a.status !== 'not-scanned' && `${a.readyHosts}/${g.newHosts.length}`}
                    </Pill>
                  </td>
                  <td className="pr-3 py-1 text-[var(--text-muted)] whitespace-nowrap" title={`${a.oldHosts.join(', ')}\n${a.locations.join('\n')}`}>
                    {a.services.join(', ')} · {nf(a.locationCount)} location · {a.oldHosts.length} sunucu
                  </td>
                  <td className="pr-3 py-1 whitespace-nowrap"><FormCell forms={a.forms} written={a.written} source={a.targetSource} target={a.target} /></td>
                  {g.newHosts.map((h) => (
                    <td key={h} className="text-center px-1.5 py-1">
                      <DirCell f={a.perHost[h]} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7 + g.newHosts.length} className="py-2 text-[var(--text-muted)]">
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
