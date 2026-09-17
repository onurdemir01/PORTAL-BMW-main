// src/components/denetim/NginxProdMigration.tsx — Nginx SPA > "Production Taşımaları".
//
// Soru (kullanici, 2026-09-14): eski GBRVP* sunucularinin location'larinda proxy_pass
// ile tanimli uygulamalar, yeni GBNGXP4x/5x sunucularinda
//   /hysdeploy/<ns>/<app>/  ve  /usr/nginx/applications/<ns>/<app>/
// olarak var mi? Her satir bir uygulama, her sutun bir YENI sunucu. Hesap sunucuda
// (nginx-migration.cjs); burada yalnizca gosterim.
import React, { useEffect, useMemo, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
// Ham tarih bicimlendirme YOK: bicim tek yerden gelir (bekci G19).
import { fmtDateTime } from '@/utils/datetime';
import { ArrowDownTrayIcon, ArrowPathIcon, DocumentPlusIcon, CalendarDaysIcon, TrashIcon } from '@heroicons/react/24/outline';
import {
  nginxMigrationApi,
  nginxMigrationTrackingApi,
  type NginxMigrationConfig,
  type MigrationTracking,
  type MigrationTrackState,
} from '@/api/nginxMigrationApi';
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
import { DirCell, HacLegend } from './HacCell';

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
  const [sortBy, setSortBy] = useState<'status' | 'team' | 'app' | 'plan'>('status');
  const [q, setQ] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [config, setConfig] = useState<NginxMigrationConfig>({ awxServerId: 0, templateId: 0, deleteTemplateId: 0 });
  // Silme onayi (eski sunucudan location + upstream; nginx_ops 23:00'e zamanlar)
  const [pendingDelete, setPendingDelete] = useState<{ group: NginxMigrationGroup; app: NginxMigrationApp; pathIdx: number } | null>(null);
  // Onay penceresi: hangi satir, hangi location (birden fazla olabilir)
  const [pending, setPending] = useState<{ group: NginxMigrationGroup; app: NginxMigrationApp; pathIdx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // GECIS TAKIBI (kullanici, 2026-09-14): uygulama basina planlanan/gecis tarihi + not.
  // Anahtar "group|ns/app". Ayri uctan gelir; ana veri yuklenmese de takip listesi okunur.
  const [tracking, setTracking] = useState<Map<string, MigrationTracking>>(new Map());
  const [trackingReady, setTrackingReady] = useState(true);
  const [editing, setEditing] = useState<{ group: NginxMigrationGroup; app: NginxMigrationApp } | null>(null);
  const [trackFilter, setTrackFilter] = useState<'all' | 'open' | 'planned' | 'migrated'>('all');
  // Gruplar SEKME (kullanici, 2026-09-17): Glomo / Openbanking-Saklama-Webforms alt alta degil,
  // sekmeyle gecilir. Ilk grup varsayilan.
  const [groupId, setGroupId] = useState<string>('');

  const loadTracking = async () => {
    try {
      const r = await nginxMigrationTrackingApi.list();
      if (r.ok) {
        setTracking(new Map(r.rows.map((t) => [trackKey(t.group, t.namespace, t.application), t])));
        setTrackingReady(true);
      } else setTrackingReady(false);
    } catch {
      setTrackingReady(false);
    }
  };

  const loadConfig = async () => {
    try {
      const r = await nginxMigrationApi.config();
      if (r.ok) setConfig(r.config);
    } catch {
      /* yapilandirma okunamazsa dugme 'yapilandirilmamis' uyarisi verir */
    }
  };

  // `useAsyncEffect`: is mikro-goreve ertelenir, yani `setLoading(true)` effect
  // govdesinde SENKRON degildir; iptal bayragi da hook'tan gelir (`alive()`).
  useAsyncEffect(async (alive) => {
    setLoading(true);
    loadConfig();
    loadTracking();
    (async () => {
      try {
        const r = await denetimApi.nginxMigration(tick > 0); // Yenile (tick>0): onbellegi atla
        if (!alive()) return;
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive()) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive()) setLoading(false);
      }
    })();
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
      loadTracking();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const path = pendingDelete.app.paths[pendingDelete.pathIdx];
    setBusy(true);
    try {
      const r = await nginxMigrationApi.remove({
        group: pendingDelete.group.id, namespace: pendingDelete.app.namespace, application: pendingDelete.app.application,
        service: path.service, inputPath: path.location,
      });
      if (r.ok) {
        setResult({
          tone: 'ok',
          text: `${pendingDelete.app.application} için kaldırma işi başlatıldı${r.job?.id ? ` (job ${r.job.id})` : ''}: ${path.service}-PROD.conf içindeki ${path.location} location'ı ve (başka tanım kullanmıyorsa) upstream'i. PROD kuralı: iş şimdi yalnızca doğrular ve 23:00 kesinti penceresine ZAMANLAR; gerçek silmeyi nginx_scheduled_ops yapar. Eski sunucular: ${(r.oldHosts || []).join(', ')}. Teams'ten izleyin.`,
        });
      } else setResult({ tone: 'bad', text: r.message || 'İş başlatılamadı.' });
    } catch (e: unknown) {
      setResult({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPendingDelete(null);
      loadTracking();
    }
  }

  if (loading && !data) return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  const configured = config.awxServerId > 0 && config.templateId > 0;
  const deleteConfigured = config.awxServerId > 0 && (config.deleteTemplateId || 0) > 0;

  return (
    <div className="space-y-3">
      {/* "Bu ekran ne gosteriyor" notu KALDIRILDI (kullanici, 2026-09-17: kafa karistiriyor);
          aciklamalar sutun ipuclarinda ve sozlukte (kapali). */}
      <HacLegend defaultOpen={false} />

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
          onChange={(e) => setSortBy(e.target.value as 'status' | 'team' | 'app' | 'plan')}
          className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
          title="Sıralama"
        >
          <option value="status">sırala: durum (sorunlu üstte)</option>
          <option value="team">sırala: ekip (çok uygulaması olan üstte)</option>
          <option value="app">sırala: uygulama adı</option>
          <option value="plan">sırala: geçiş tarihi</option>
        </select>
        <select
          value={trackFilter}
          onChange={(e) => setTrackFilter(e.target.value as 'all' | 'open' | 'planned' | 'migrated')}
          className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
          title="Geçiş durumuna göre süz"
        >
          <option value="all">geçiş: hepsi</option>
          <option value="open">geçiş: henüz geçmedi</option>
          <option value="planned">geçiş: planlandı</option>
          <option value="migrated">geçiş: geçti</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={onlyProblem} onChange={(e) => setOnlyProblem(e.target.checked)} />
          Sadece hazır olmayanlar
        </label>
        <button
          onClick={() =>
            csvDownload(
              'nginx_prod_tasima',
              ['grup', 'namespace', 'prod_eki_eklendi', 'uygulama', 'ekip', 'gecis_durumu', 'planlanan_tarih', 'gecis_tarihi', 'gecis_notu', 'yazim', 'yazilan_ad', 'durum', 'hazir_sunucu', 'taranan_sunucu', 'eski_sunucular', 'servis', 'location_sayisi', 'eski_locationlar', 'hedef', ...data.groups.flatMap((g) => g.newHosts)],
              data.groups.flatMap((g) =>
                g.apps.map((a) => [
                  g.label, a.namespace, a.suffixAdded ? 'evet' : '', a.application, a.owner?.groups.join(' | ') || '',
                  TRACK_LABEL[tracking.get(trackKey(g.id, a.namespace, a.application))?.state || 'none'].label,
                  tracking.get(trackKey(g.id, a.namespace, a.application))?.plannedDate || '',
                  tracking.get(trackKey(g.id, a.namespace, a.application))?.migratedDate || '',
                  tracking.get(trackKey(g.id, a.namespace, a.application))?.note || '',
                  a.forms.join('+'), a.written.join(' '), STATUS[a.status].label, a.readyHosts, a.scannedHosts,
                  a.oldHosts.join(' '), a.services.join(' '), a.locationCount, a.paths.map((p) => p.service + ' ' + p.location).join(' | '), a.target,
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

      <div className="flex gap-1 flex-wrap border-b border-[var(--border)]">
        {data.groups.map((g) => {
          const active = (groupId || data.groups[0]?.id) === g.id;
          const loc = g.totals.locations;
          return (
            <button
              key={g.id}
              onClick={() => setGroupId(g.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                active ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title={`${g.oldHosts.length} eski → ${g.newHosts.length} yeni sunucu · ${nf(loc.defined)}/${nf(loc.total)} location yeni sunucularda tanımlı`}
            >
              {g.label}
              <span className="ml-1.5 text-[10px] font-normal tabular-nums text-[var(--text-muted)]">{nf(loc.defined)}/{nf(loc.total)}</span>
            </button>
          );
        })}
      </div>

      {data.groups.filter((g) => g.id === (groupId || data.groups[0]?.id)).map((g) => (
        <GroupPanel
          key={g.id}
          g={g}
          onlyProblem={onlyProblem}
          q={q}
          sortBy={sortBy}
          ownersReady={data.ownersReady !== false}
          canCreate={configured}
          onCreate={(app) => setPending({ group: g, app, pathIdx: 0 })}
          canDelete={deleteConfigured}
          onDelete={(app) => setPendingDelete({ group: g, app, pathIdx: 0 })}
          tracking={tracking}
          trackingReady={trackingReady}
          trackFilter={trackFilter}
          onTrack={(app) => setEditing({ group: g, app })}
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

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Eski sunucudaki tanımı kaldır"
        subtitle={pendingDelete ? `${pendingDelete.app.application} · ${pendingDelete.app.namespace}` : undefined}
        icon={TrashIcon}
        dismissOnBackdrop={false}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setPendingDelete(null)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]">İptal</button>
            <button onClick={confirmDelete} disabled={busy} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--status-danger)' }}>
              {busy ? 'Başlatılıyor…' : 'Evet, kaldırmayı zamanla'}
            </button>
          </div>
        }
      >
        {pendingDelete && (() => {
          const path = pendingDelete.app.paths[pendingDelete.pathIdx];
          const t = tracking.get(trackKey(pendingDelete.group.id, pendingDelete.app.namespace, pendingDelete.app.application));
          return (
            <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {pendingDelete.app.paths.length > 1 && (
                <div>
                  Bu uygulama eski sunucuda <b>{pendingDelete.app.paths.length}</b> location'dan sunuluyor; hangisi kaldırılsın?
                  <div className="mt-1 space-y-0.5">
                    {pendingDelete.app.paths.map((p, i) => (
                      <label key={p.service + p.location} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="delpath" checked={i === pendingDelete.pathIdx} onChange={() => setPendingDelete({ ...pendingDelete, pathIdx: i })} />
                        <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{p.service}-PROD.conf · {p.location}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <p>Eski sunucularda (<span className="font-mono">{pendingDelete.group.oldHosts.join(', ')}</span>) şunlar kaldırılacak:</p>
              <div className="font-mono text-[11px] space-y-0.5 rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                <div>/usr/nginx/conf.d/{path.service}-PROD.conf → <span className="text-[var(--text-muted)]">location {path.location} {'{ proxy_pass … }'}</span></div>
                <div>upstream {pendingDelete.app.written.join(' / ')} <span className="text-[var(--text-muted)]">— yalnızca başka hiçbir location kullanmıyorsa</span></div>
              </div>
              {t?.state !== 'migrated' && (
                <Note tone="warning" title="Geçiş kaydı 'geçti' değil">
                  Bu uygulamanın geçiş takibi <b>{t ? TRACK_LABEL[t.state].label : 'kayıtsız'}</b>. Trafik yeni sunuculara alınmadan eski tanım kaldırılırsa uygulama <b>erişilemez</b> olur. Emin değilseniz iptal edin.
                </Note>
              )}
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                PROD kuralı (nginx_ops): iş şimdi yalnızca <b>doğrular</b> ve <b>23:00</b> kesinti penceresine zamanlar; gerçek silmeyi{' '}
                <Code>nginx_scheduled_ops</Code> yapar — location bloğu çıkarılır, upstream başka tanım kullanmıyorsa çıkarılır,{' '}
                <Code>nginx -t</Code> düşerse geri alınır, geçerse reload. Yeni sunuculara dokunulmaz. İptal için AWX'teki schedule silinir.
              </p>
            </div>
          );
        })()}
      </Modal>

      {editing && (
        <TrackingModal
          group={editing.group}
          app={editing.app}
          current={tracking.get(trackKey(editing.group.id, editing.app.namespace, editing.app.application)) || null}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setTracking((m) => new Map(m).set(trackKey(row.group, row.namespace, row.application), row));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

const trackKey = (group: string, ns: string, app: string) => `${group}|${ns}/${app}`;
// DUZ TARIH (YYYY-MM-DD) — ortak `fmtDate` DEGIL, bilerek. Bu degerler DB'den
// SAATSIZ gelir; ortak yardimci onlari Date'e cevirip saat dilimine gore
// bicimler ve bos degerde '—' doner. Burada istenen yalniz gun.ay.yil ve bosta
// BOS metin. Ham `toLocale*` kullanmadigi icin G19'u da ihlal etmez.
const fmtPlainDate = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '');
const TRACK_LABEL: Record<MigrationTrackState, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  none: { label: 'geçmedi', tone: 'neutral' },
  planned: { label: 'planlandı', tone: 'warning' },
  migrated: { label: 'geçti', tone: 'success' },
  cancelled: { label: 'iptal', tone: 'danger' },
};

/** Gecis hucresi: durum + tarih; tiklaninca duzenleme penceresi. */
function TrackCell({ t, ready, onEdit }: { t: MigrationTracking | null; ready: boolean; onEdit: () => void }) {
  const st = t?.state || 'none';
  const meta = TRACK_LABEL[st];
  const date = st === 'migrated' ? t?.migratedDate : st === 'planned' ? t?.plannedDate : null;
  const title = [
    t?.plannedDate ? `planlanan: ${fmtPlainDate(t.plannedDate)}` : '',
    t?.migratedDate ? `geçiş: ${fmtPlainDate(t.migratedDate)}` : '',
    t?.note ? `not: ${t.note}` : '',
    t?.configJobId ? `tanım job ${t.configJobId} (${t.configCreatedAt ? fmtDateTime(t.configCreatedAt) : ''}${t.configCreatedBy ? ', ' + t.configCreatedBy : ''})` : '',
    t?.deleteJobId ? `eski tanım kaldırma job ${t.deleteJobId} (${t.deleteRequestedAt ? fmtDateTime(t.deleteRequestedAt) : ''}${t.deleteRequestedBy ? ', ' + t.deleteRequestedBy : ''}) — 23:00'e zamanlandı` : '',
    t?.updatedBy ? `son güncelleyen: ${t.updatedBy}` : '',
    'düzenlemek için tıklayın',
  ].filter(Boolean).join('\n');
  return (
    <button onClick={onEdit} disabled={!ready} className="inline-flex items-center gap-1 disabled:opacity-40" title={ready ? title : 'takip tablosu okunamadı'}>
      <Pill tone={meta.tone}>{meta.label}{date ? ` ${fmtPlainDate(date)}` : ''}</Pill>
      {t?.configJobId && <span className="text-[9px] text-[var(--text-muted)]" title="Tanım oluştur job'ı koşturuldu">⚙{t.configJobId}</span>}
      {t?.deleteJobId && <span className="text-[9px] text-red-600" title="Eski tanımı kaldırma job'ı koşturuldu (23:00'e zamanlandı)">🗑{t.deleteJobId}</span>}
      <CalendarDaysIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
    </button>
  );
}

function TrackingModal({ group, app, current, onClose, onSaved }: {
  group: NginxMigrationGroup; app: NginxMigrationApp; current: MigrationTracking | null;
  onClose: () => void; onSaved: (row: MigrationTracking) => void;
}) {
  const [state, setState] = useState<MigrationTrackState>(current?.state || 'none');
  const [plannedDate, setPlannedDate] = useState(current?.plannedDate || '');
  const [migratedDate, setMigratedDate] = useState(current?.migratedDate || '');
  const [note, setNote] = useState(current?.note || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await nginxMigrationTrackingApi.save({
        group: group.id, namespace: app.namespace, application: app.application,
        state, plannedDate: plannedDate || null, migratedDate: migratedDate || null, note: note || null,
      });
      if (r.ok && r.row) onSaved(r.row);
      else setMsg(r.message || 'Kaydedilemedi.');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const inputCls = 'px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]';
  return (
    <Modal
      open
      onClose={onClose}
      title="Geçiş takibi"
      subtitle={`${app.application} · ${app.namespace} · ${group.label}`}
      icon={CalendarDaysIcon}
      dismissOnBackdrop={false}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]">İptal</button>
          <button onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex flex-wrap gap-3">
          {(['none', 'planned', 'migrated', 'cancelled'] as MigrationTrackState[]).map((st) => (
            <label key={st} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="state" checked={state === st} onChange={() => setState(st)} />
              <Pill tone={TRACK_LABEL[st].tone}>{TRACK_LABEL[st].label}</Pill>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Planlanan tarih{state === 'planned' ? ' *' : ''}</span>
            <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Geçiş tarihi{state === 'migrated' ? ' *' : ''}</span>
            <input type="date" value={migratedDate} onChange={(e) => setMigratedDate(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Not (OCO no, sorumlu, koşul…)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3} className={inputCls} />
        </label>
        {current?.configJobId && (
          <div className="text-[11px] text-[var(--text-muted)]">
            Tanım oluştur job&apos;ı: <b>{current.configJobId}</b>{current.configCreatedAt ? ` · ${fmtDateTime(current.configCreatedAt)}` : ''}{current.configCreatedBy ? ` · ${current.configCreatedBy}` : ''}
          </div>
        )}
        {current?.updatedBy && (
          <div className="text-[11px] text-[var(--text-muted)]">Son güncelleme: {current.updatedBy}{current.updatedAt ? ` · ${fmtDateTime(current.updatedAt)}` : ''}</div>
        )}
        {msg && <div className="text-[11px] text-red-600">{msg}</div>}
      </div>
    </Modal>
  );
}

/** Yoneticiye ozel: bu ekranin hangi AWX job template'ini calistiracagi (nginx-expose ile ayni desen). */
function MigrationConfigPanel({ config, onSaved }: { config: NginxMigrationConfig; onSaved: () => void }) {
  const [servers, setServers] = useState<AwxServer[]>([]);
  const [awxServerId, setAwxServerId] = useState(config.awxServerId || 0);
  const [templateId, setTemplateId] = useState(String(config.templateId || ''));
  const [deleteTemplateId, setDeleteTemplateId] = useState(String(config.deleteTemplateId || ''));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // PROP DEGISINCE STATE'I AYARLA — EFFECT DEGIL, RENDER SIRASINDA. Effect'te
  // yapmak ESKI degerlerle BIR RENDER daha uretiyordu ve React 19 bunu
  // `set-state-in-effect` ile isaretliyordu. Kosul bir sonraki render'da yanlis
  // olur, yani yakinsar (React'in belgeledigi desen).
  const propKey = `${config.awxServerId || 0}|${config.templateId || ''}|${config.deleteTemplateId || ''}`;
  const [prevPropKey, setPrevPropKey] = useState(propKey);
  if (prevPropKey !== propKey) {
    setPrevPropKey(propKey);
    setAwxServerId(config.awxServerId || 0);
    setTemplateId(String(config.templateId || ''));
    setDeleteTemplateId(String(config.deleteTemplateId || ''));
  }
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
      const r = await nginxMigrationApi.saveConfig({ awxServerId, templateId: tid, deleteTemplateId: Number(deleteTemplateId) || 0 });
      if (r.ok) { setMsg({ tone: 'ok', text: 'Kaydedildi. Düğme artık çalışır.' }); onSaved(); }
      else setMsg({ tone: 'bad', text: r.message || 'Kaydedilemedi.' });
    } catch (e: unknown) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const inputCls = 'px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]';
  return (
    <Panel title="Job yapılandırması (yönetici)" description="Tanım oluştur: nginx_ops/nginx_prod_migration.yml template'i · Eski tanımı kaldır: mevcut nginx_ops (Nginx Reverse Proxy Operations, survey'li) template'i — action=delete, env=prod ile koşar, 23:00'e zamanlar" dense>
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
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Silme job'ı (nginx_ops) ID</span>
          <input value={deleteTemplateId} onChange={(e) => setDeleteTemplateId(e.target.value.replace(/[^0-9]/g, ''))} placeholder="isteğe bağlı" inputMode="numeric" className={`${inputCls} w-28`} />
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

/** Location'in YENI sunuculardaki tanim durumu (nginx-migration.cjs newLocStatus). */
const NEW_LOC: Record<'defined' | 'partial' | 'none' | 'not-scanned', { mark: string; color: string; hint: string }> = {
  defined: { mark: '✓', color: 'var(--status-success)', hint: 'her yeni sunucuda tanımlı' },
  partial: { mark: '◐', color: 'var(--status-warning)', hint: 'bazı yeni sunucularda tanımlı' },
  none: { mark: '✗', color: 'var(--status-danger)', hint: 'hiçbir yeni sunucuda tanım yok' },
  'not-scanned': { mark: '?', color: 'var(--text-muted)', hint: 'yeni sunucular taranmadı' },
};

/**
 * LOCATION ILERLEMESI (kullanici, 2026-09-17: "ilerleme raporunu location'lar uzerinden takip
 * edecegim"). Eski sunuculardaki her location (SPA + SPA-disi + cozulemeyen) yeni sunucularda
 * tanimli mi: hepsinde / bazisinda / hicbirinde. Servis (vhost) basina kirilim.
 */
function LocationProgress({ g }: { g: NginxMigrationGroup }) {
  const t = g.totals.locations;
  const p = (n: number) => (t.total ? Math.round((n / t.total) * 1000) / 10 : 0);
  const seg = (n: number, color: string, label: string) =>
    n > 0 ? <span className="h-full" style={{ width: `${p(n)}%`, background: color }} title={`${label}: ${nf(n)}`} /> : null;
  return (
    <div className="rounded-xl border px-4 py-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Taşıma ilerlemesi — location bazında</div>
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
            <b className="text-lg tabular-nums">{nf(t.defined)}</b> / {nf(t.total)} location yeni sunucularda tanımlı
            <span className="ml-2 text-base font-semibold tabular-nums" style={{ color: p(t.defined) >= 90 ? 'var(--status-success)' : p(t.defined) >= 50 ? 'var(--status-warning)' : 'var(--status-danger)' }}>
              %{nf(p(t.defined))}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--status-success)' }} />hepsinde {nf(t.defined)}</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--status-warning)' }} />bazısında {nf(t.partial)}</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--status-danger)' }} />hiçbirinde {nf(t.none)}</span>
          {t.notScanned > 0 && <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--border)' }} />taranmadı {nf(t.notScanned)}</span>}
        </div>
      </div>
      <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-surface)' }}>
        {seg(t.defined, 'var(--status-success)', 'her yeni sunucuda tanımlı')}
        {seg(t.partial, 'var(--status-warning)', 'bazı yeni sunucularda tanımlı')}
        {seg(t.none, 'var(--status-danger)', 'hiçbir yeni sunucuda tanım yok')}
        {seg(t.notScanned, 'var(--border)', 'yeni sunucular taranmadı')}
      </div>
      {g.serviceLocations.length > 1 && (
        <table className="text-[11px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left pr-4 pb-0.5 font-semibold">Vhost</th>
              <th className="text-right pr-4 pb-0.5 font-semibold">location</th>
              <th className="text-right pr-4 pb-0.5 font-semibold">hepsinde</th>
              <th className="text-right pr-4 pb-0.5 font-semibold">bazısında</th>
              <th className="text-right pr-4 pb-0.5 font-semibold">hiçbirinde</th>
              <th className="text-right pb-0.5 font-semibold">ilerleme</th>
            </tr>
          </thead>
          <tbody>
            {g.serviceLocations.map((x) => {
              const pp = x.locations ? Math.round((x.defined / x.locations) * 1000) / 10 : 0;
              return (
                <tr key={x.service} className="border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  <td className="pr-4 py-0.5 font-mono" style={{ color: 'var(--text-primary)' }}>{x.service}-PROD.conf</td>
                  <td className="pr-4 py-0.5 text-right tabular-nums">{nf(x.locations)}</td>
                  <td className="pr-4 py-0.5 text-right tabular-nums" style={{ color: 'var(--status-success)' }}>{nf(x.defined)}</td>
                  <td className="pr-4 py-0.5 text-right tabular-nums" style={{ color: x.partial ? 'var(--status-warning)' : undefined }}>{nf(x.partial)}</td>
                  <td className="pr-4 py-0.5 text-right tabular-nums" style={{ color: x.none ? 'var(--status-danger)' : undefined }}>{nf(x.none)}</td>
                  <td className="py-0.5 text-right tabular-nums font-semibold">%{nf(pp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Sayım vhost başına farklı location; SPA olmayan (API) ve çözülemeyen hedefler de dâhil — vhost'un tamamı. “Tanımlı” = yeni sunucunun <Code>{'<SERVIS>'}-PROD.conf</Code> dosyasında aynı location var (include ya da proxy). Uygulama satırlarındaki H/A/C ise dosyaların hazır olup olmadığını gösterir.
      </div>
    </div>
  );
}

function GroupPanel({
  g, onlyProblem, q, sortBy, ownersReady, canCreate, onCreate, tracking, trackingReady, trackFilter, onTrack, canDelete, onDelete,
}: {
  g: NginxMigrationGroup;
  onlyProblem: boolean;
  q: string;
  sortBy: 'status' | 'team' | 'app' | 'plan';
  ownersReady: boolean;
  canCreate: boolean;
  onCreate: (app: NginxMigrationApp) => void;
  tracking: Map<string, MigrationTracking>;
  trackingReady: boolean;
  trackFilter: 'all' | 'open' | 'planned' | 'migrated';
  onTrack: (app: NginxMigrationApp) => void;
  canDelete: boolean;
  onDelete: (app: NginxMigrationApp) => void;
}) {
  const trackOf = (a: NginxMigrationApp) => tracking.get(trackKey(g.id, a.namespace, a.application)) || null;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = g.apps.filter((a) => {
      if (onlyProblem && a.status === 'ready') return false;
      const ts = trackOf(a)?.state || 'none';
      if (trackFilter === 'open' && (ts === 'migrated' || ts === 'cancelled')) return false;
      if (trackFilter === 'planned' && ts !== 'planned') return false;
      if (trackFilter === 'migrated' && ts !== 'migrated') return false;
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
    } else if (sortBy === 'plan') {
      // Gecis tarihi: planlanan/gecis tarihi olanlar tarihe gore, tarihsizler sona.
      const d = (a: NginxMigrationApp) => { const t = trackOf(a); return t?.migratedDate || t?.plannedDate || ''; };
      list = [...list].sort((a, b) => { const da = d(a), db = d(b); if (!da !== !db) return da ? -1 : 1; return da.localeCompare(db) || a.application.localeCompare(b.application); });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, onlyProblem, q, sortBy, tracking, trackFilter]);
  const trackTotals = useMemo(() => {
    const c = { planned: 0, migrated: 0, cancelled: 0, none: 0 };
    for (const a of g.apps) c[trackOf(a)?.state || 'none'] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, tracking]);
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
        // Eski ve yeni sunucu listeleri ALT ALTA (kullanici, 2026-09-17)
        <span className="block space-y-0.5">
          <span className="block"><span className="inline-block w-9 font-semibold">eski</span><span className="font-mono">{g.oldHosts.join(', ')}</span></span>
          <span className="block"><span className="inline-block w-9 font-semibold">yeni</span><span className="font-mono">{g.newHosts.join(', ')}</span></span>
        </span>
      }
      dense
    >
      <div className="p-3 space-y-3">
        <LocationProgress g={g} />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="uygulama" value={nf(g.totals.apps)} hint="eski sunuculardaki SPA hedefleri" />
          <StatTile label="hazır" value={nf(g.totals.ready)} tone={g.totals.ready === g.totals.apps && g.totals.apps > 0 ? 'success' : 'neutral'} hint={STATUS.ready.hint} />
          <StatTile label="kısmi" value={nf(g.totals.partial)} tone={g.totals.partial ? 'warning' : 'neutral'} hint={STATUS.partial.hint} />
          <StatTile label="eksik" value={nf(g.totals.missing)} tone={g.totals.missing ? 'danger' : 'neutral'} hint={STATUS.missing.hint} />
          <StatTile label="SPA değil" value={nf(g.totals.nonSpa)} hint="API/arka uç hedefi — dizin beklenmez" />
          <StatTile label="çözülemedi" value={nf(g.totals.unresolved)} tone={g.totals.unresolved ? 'warning' : 'neutral'} hint="hedef (ns, app)'a eşlenemedi — aşağıda" />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <StatTile label="geçti" value={nf(trackTotals.migrated)} tone={trackTotals.migrated ? 'success' : 'neutral'} hint={`${g.totals.apps} uygulamanın ${trackTotals.migrated} tanesi yeni sunuculara geçti (takip kaydı)`} />
          <StatTile label="planlandı" value={nf(trackTotals.planned)} tone={trackTotals.planned ? 'warning' : 'neutral'} hint="geçiş tarihi belirlenmiş, henüz geçmedi" />
          <StatTile label="henüz planı yok" value={nf(trackTotals.none)} hint={`${trackTotals.cancelled} iptal · Geçiş sütunundaki rozete tıklayarak planlayın`} />
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
                <th className="text-left pr-3 pb-1" title="geçiş takibi: planlandı / geçti / iptal + tarih; tıklayarak düzenleyin">Geçiş</th>
                <th className="text-left pr-3 pb-1">Durum</th>
                <th className="text-left pr-3 pb-1" title="eski sunucudaki vhost ve location tanımları (proxy_pass ile). Sondaki işaret: bu location YENİ sunucularda tanımlı mı (✓ hepsinde, ◐ bazısında, ✗ hiçbirinde, ? taranmadı)">Location (eski → yeni)</th>
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
                    <button
                      onClick={() => onDelete(a)}
                      disabled={!canDelete}
                      className="mt-1 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg border disabled:opacity-40 whitespace-nowrap"
                      style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
                      title={!canDelete ? 'Silme job\'ı yapılandırılmamış (yönetici paneli: nginx_ops template)' : `Eski sunucudaki ${a.paths.map((p) => p.service + '-PROD.conf ' + p.location).join(' / ')} tanımını (ve kullanılmayan upstream'i) kaldır — 23:00'e zamanlanır`}
                    >
                      <TrashIcon className="w-3.5 h-3.5" /> Eski tanımı kaldır
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
                  <td className="pr-3 py-1"><TrackCell t={trackOf(a)} ready={trackingReady} onEdit={() => onTrack(a)} /></td>
                  <td className="pr-3 py-1">
                    <Pill tone={STATUS[a.status].tone} title={STATUS[a.status].hint}>
                      {STATUS[a.status].label} {a.status !== 'not-scanned' && `${a.readyHosts}/${g.newHosts.length}`}
                    </Pill>
                  </td>
                  <td className="pr-3 py-1" title={`eski sunucular: ${a.oldHosts.join(', ')}`}>
                    {/* Eski sunucudaki location tanimlari GORUNUR (kullanici, 2026-09-14): her cip
                        bir (vhost, location) cifti - "Tanim olustur" bunlardan birini secer. */}
                    <div className="flex flex-wrap gap-1 max-w-[22rem]">
                      {a.paths.map((p) => (
                        <span
                          key={p.service + p.location}
                          className="text-[10px] px-1.5 py-0.5 rounded border font-mono whitespace-nowrap inline-flex items-center gap-1"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                          title={`${p.service}-PROD.conf · location ${p.location}\neski: ${p.hosts.join(', ')}\nyeni sunucuda tanım: ${NEW_LOC[p.newStatus].hint}${p.newHosts.length ? ` (${p.newHosts.join(', ')})` : ''}`}
                        >
                          <span className="text-[var(--text-muted)]">{p.service}</span> {p.location}
                          {/* yeni sunucudaki tanim durumu (location ilerlemesi, 2026-09-17) */}
                          <span className="font-sans font-semibold" style={{ color: NEW_LOC[p.newStatus].color }}>{NEW_LOC[p.newStatus].mark}</span>
                        </span>
                      ))}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{a.oldHosts.length} sunucu</div>
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
                <tr><td colSpan={8 + g.newHosts.length} className="py-2 text-[var(--text-muted)]">
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
