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
import { fmtDateTime } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';
// Ham tarih bicimlendirme YOK: bicim tek yerden gelir (bekci G19).
import { fmtDate } from '@/utils/datetime';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxAuditHost,
  type NginxAuditResult,
  type NginxAuditAllowedValue,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from './ui';
import { Modal } from '@/components/common/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/useToast';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { AuditGlossary, ReferenceValuesPanel, termHint } from './nginxAuditGlossary';
import { downloadCsv as csvDownload } from '@/utils/csv';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export const hostPagePath = (host: string) => `/denetim/nginx-audit/${encodeURIComponent(host)}`;


export function NginxAudit() {
  const [data, setData] = useState<NginxAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  // HIZLI SORUN SUZGECI (kullanici, 2026-09-22): "hangi sunucular sorunlu, hizli goremiyorum" -
  // tek tikla resolve/keepalive/zone/tanimsiz/ayar/-T sorunlu sunucular, o sayiya gore sirali.
  const [issue, setIssue] = useState<'' | 'upsNoResolve' | 'upsNoKeepalive' | 'upsNoZone' | 'proxyUndefined' | 'settingsMismatch' | 'tfail' | 'compliance'>('');
  // Kabul edilen degerler (Admin): referans disinda gecerli sayilan direktif degerleri
  const [allowed, setAllowed] = useState<NginxAuditAllowedValue[]>([]);
  const [allowedOpen, setAllowedOpen] = useState(false);
  const [allowedForm, setAllowedForm] = useState({ directive: '', value: '', note: '' });
  const [allowedBusy, setAllowedBusy] = useState(false);
  const loadAllowed = useCallback(async () => { try { const r = await denetimApi.nginxAuditAllowed(); if (r.ok) setAllowed(r.rows || []); } catch { /* panel bos kalir */ } }, []);
  useEffect(() => { loadAllowed(); }, [loadAllowed]);
  const addAllowed = async () => {
    if (!allowedForm.directive.trim() || !allowedForm.value.trim()) return;
    setAllowedBusy(true);
    try {
      const r = await denetimApi.nginxAuditAllowedAdd(allowedForm.directive.trim(), allowedForm.value.trim(), allowedForm.note.trim());
      if (!r.ok) { toast.error(r.message || 'Eklenemedi.'); return; }
      toast.success('Kabul edilen değer eklendi; liste yeniden hesaplanıyor.');
      setAllowedForm({ directive: '', value: '', note: '' });
      await loadAllowed();
      try { const d = await denetimApi.nginxAudit(true); if (d.ok) setData(d); } catch { /* eski liste kalir */ }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setAllowedBusy(false); }
  };
  const removeAllowed = async (id: number) => {
    setAllowedBusy(true);
    try {
      const r = await denetimApi.nginxAuditAllowedRemove(id);
      if (!r.ok) { toast.error(r.message || 'Silinemedi.'); return; }
      await loadAllowed();
      try { const d = await denetimApi.nginxAudit(true); if (d.ok) setData(d); } catch { /* eski liste kalir */ }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setAllowedBusy(false); }
  };
  // ISTISNA (kullanici, 2026-09-15): yonetici bir sunucuyu not ile istisna yapar; o satirda
  // metrikler gri, en sagda rozet + not; toplamlar onu saymaz. Herkes gorur, Admin duzenler.
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [excEdit, setExcEdit] = useState<{ host: string; note: string; existing: boolean } | null>(null);
  const [excBusy, setExcBusy] = useState(false);
  const [excMsg, setExcMsg] = useState('');

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

  // IYIMSER GUNCELLEME (2026-09-15 kullanici bildirimi: "hemen eklemiyor, cok bekletiyor"):
  // kaydettikten sonra tum denetim (agir sorgu) yeniden yuklenip tablo "Yukleniyor…"a
  // dusuyordu. Simdi satir ANINDA yerel olarak guncellenir; tam veri arka planda,
  // yukleme gostergesi olmadan tazelenir (toplam kartlari o zaman oturur).
  function applyExceptionLocally(host: string, exception: NginxAuditHost['exception']) {
    setData((prev) => {
      if (!prev) return prev;
      const hosts = prev.hosts.map((h) => {
        if (h.host !== host) return h;
        const raw = { fqdn: h.proxyFqdnRaw ?? h.proxyFqdn, undef: h.proxyUndefinedRaw ?? h.proxyUndefined };
        return {
          ...h,
          exception,
          proxyFqdnRaw: raw.fqdn,
          proxyUndefinedRaw: raw.undef,
          proxyFqdn: exception ? 0 : raw.fqdn,
          proxyUndefined: exception ? 0 : raw.undef,
        };
      });
      const excepted = hosts.filter((h) => h.exception).length;
      return { ...prev, hosts, totals: { ...prev.totals, excepted } };
    });
  }
  async function refreshQuietly() {
    try {
      const r = await denetimApi.nginxAudit(true);
      if (r.ok) setData(r);
    } catch {
      /* iyimser durum zaten ekranda; bir sonraki Yenile duzeltir */
    }
  }
  async function saveException() {
    if (!excEdit) return;
    setExcBusy(true);
    setExcMsg('');
    try {
      const r = await denetimApi.nginxAuditExceptionSet(excEdit.host, excEdit.note.trim());
      if (r.ok) {
        applyExceptionLocally(excEdit.host, { note: excEdit.note.trim(), by: r.by ?? null, at: new Date().toISOString() });
        setExcEdit(null);
        void refreshQuietly();
      } else setExcMsg(r.message || 'Kaydedilemedi.');
    } catch (e: unknown) {
      setExcMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExcBusy(false);
    }
  }
  async function clearException() {
    if (!excEdit) return;
    setExcBusy(true);
    try {
      const r = await denetimApi.nginxAuditExceptionClear(excEdit.host);
      if (r.ok) {
        applyExceptionLocally(excEdit.host, null);
        setExcEdit(null);
        void refreshQuietly();
      } else setExcMsg(r.message || 'Kaldırılamadı.');
    } catch (e: unknown) {
      setExcMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExcBusy(false);
    }
  }

  const envs = useMemo(
    () => (data ? [...new Set(data.hosts.map((h) => h.env))].sort() : []),
    [data],
  );

  // Uyum skoruna gore siralama (kullanici, 2026-09-24). Baslik tikladikca: kotuden iyiye ->
  // iyiden kotuye -> kapali. VERISI OLMAYAN sunucu (compliance == null) HER IKI yonde de
  // SONA yazilir: "—" bir skor degildir, listenin basinda durursa gercek en kotuyu gizler.
  const [sortCompliance, setSortCompliance] = useState<'none' | 'asc' | 'desc'>('none');

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.hosts.filter((h) => {
      if (env && h.env !== env) return false;
      if (needle && !h.host.toLowerCase().includes(needle)) return false;
      if (onlyProblem && h.issues === 0) return false;
      if (issue === 'tfail' && h.status === 'ok') return false;
      if (issue === 'compliance' && !(h.compliance != null && h.compliance < 90)) return false;
      if (issue && issue !== 'tfail' && issue !== 'compliance' && !(Number(h[issue]) > 0)) return false;
      return true;
    });
    // Kullanicinin actigi siralama, suzgecin ortuk siralamasini EZER.
    if (sortCompliance !== 'none') {
      const yok = sortCompliance === 'asc' ? Infinity : -Infinity;
      list.sort((a, b) => {
        const x = a.compliance ?? yok;
        const y = b.compliance ?? yok;
        return (sortCompliance === 'asc' ? x - y : y - x) || a.host.localeCompare(b.host);
      });
    } else if (issue === 'compliance') list.sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101) || a.host.localeCompare(b.host));
    else if (issue && issue !== 'tfail') list.sort((a, b) => Number(b[issue]) - Number(a[issue]) || a.host.localeCompare(b.host));
    return list;
  }, [data, q, env, onlyProblem, issue, sortCompliance]);
  const issueCounts = useMemo(() => {
    const hs = data?.hosts || [];
    return {
      upsNoResolve: hs.filter((h) => h.upsNoResolve > 0).length, upsNoKeepalive: hs.filter((h) => h.upsNoKeepalive > 0).length, upsNoZone: hs.filter((h) => h.upsNoZone > 0).length,
      proxyUndefined: hs.filter((h) => h.proxyUndefined > 0).length, settingsMismatch: hs.filter((h) => h.settingsMismatch > 0).length, tfail: hs.filter((h) => h.status !== 'ok').length,
      compliance: hs.filter((h) => h.compliance != null && h.compliance < 90).length,
    };
  }, [data]);

  if (loading && !data)
    return <LoadingLogo />;
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
      <ReferenceValuesPanel items={data?.reference || []} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="sunucu"
          value={nf(t?.hosts || 0)}
          hint={`${nf(t?.serverBlocks || 0)} server bloğu · ${nf(t?.locations || 0)} location · ${nf(t?.upstreams || 0)} upstream${t?.excepted ? ` · ${nf(t.excepted)} sunucu istisna (aşağıdaki sayılara dâhil değil)` : ''}`}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] mr-1" style={{ color: 'var(--text-muted)' }}>Hızlı süzgeç (sunucu sayısı):</span>
        {([['', 'hepsi', data.hosts.length], ['upsNoResolve', 'upstream resolve yok', issueCounts.upsNoResolve], ['upsNoKeepalive', 'keepalive yok', issueCounts.upsNoKeepalive], ['upsNoZone', 'zone yok', issueCounts.upsNoZone], ['proxyUndefined', 'tanımsız hedef', issueCounts.proxyUndefined], ['settingsMismatch', 'ayar sapması', issueCounts.settingsMismatch], ['tfail', 'nginx -T hatalı', issueCounts.tfail], ['compliance', 'uyum < %90', issueCounts.compliance]] as const).map(([id, label, n]) => (
          <button key={id || 'all'} onClick={() => setIssue(id)} className="px-2.5 py-1 rounded-full border text-[11px]" style={{ borderColor: issue === id ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)', color: issue === id ? 'var(--text-primary)' : 'var(--text-secondary)' }} title={id === 'upsNoResolve' ? 'Standart: upstream bloğunda resolve (dinamik DNS) olmalı' : id === 'upsNoKeepalive' ? 'Standart: upstream bloğunda keepalive olmalı' : id === 'upsNoZone' ? 'Standart: upstream bloğunda zone (paylaşımlı bellek) olmalı' : undefined}>{label} <b className="tabular-nums">{nf(n)}</b></button>
        ))}
      </div>

      <Panel
        title="Kabul edilen değerler"
        description="Referans dışında da geçerli sayılan direktif değerleri (ör. client_max_body_size → 1m ve 10m). Listedeki değer 'ayar sapması' sayılmaz; büyük/küçük harf ve noktalı virgül farkı gözetilmez."
        actions={<button onClick={() => setAllowedOpen((v) => !v)} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>{allowedOpen ? 'Gizle' : `Göster (${allowed.length})`}</button>}
      >
        {allowedOpen && (
          <div className="space-y-2">
            {isAdmin && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Direktif<br /><input list="nginx-audit-directives" value={allowedForm.directive} onChange={(e) => setAllowedForm({ ...allowedForm, directive: e.target.value })} placeholder="client_max_body_size" className="mt-0.5 px-2 py-1.5 text-xs border rounded-lg w-56 font-mono" style={{ borderColor: 'var(--border)' }} /></label>
                <datalist id="nginx-audit-directives">{(data.reference || []).map((r) => <option key={r.directive + r.context} value={r.directive} />)}</datalist>
                <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Kabul edilen değer<br /><input value={allowedForm.value} onChange={(e) => setAllowedForm({ ...allowedForm, value: e.target.value })} placeholder="10m" className="mt-0.5 px-2 py-1.5 text-xs border rounded-lg w-40 font-mono" style={{ borderColor: 'var(--border)' }} /></label>
                <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Not<br /><input value={allowedForm.note} onChange={(e) => setAllowedForm({ ...allowedForm, note: e.target.value })} placeholder="neden kabul?" className="mt-0.5 px-2 py-1.5 text-xs border rounded-lg w-64" style={{ borderColor: 'var(--border)' }} /></label>
                <button onClick={addAllowed} disabled={allowedBusy || !allowedForm.directive.trim() || !allowedForm.value.trim()} className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}>Ekle</button>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs">
                <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}><th className="px-3 py-1.5">Direktif</th><th className="px-3 py-1.5">Değer</th><th className="px-3 py-1.5">Referans</th><th className="px-3 py-1.5">Not</th><th className="px-3 py-1.5">Ekleyen</th>{isAdmin && <th className="px-3 py-1.5" />}</tr></thead>
                <tbody>
                  {allowed.map((a) => (
                    <tr key={a.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-1.5 font-mono">{a.directive}</td>
                      <td className="px-3 py-1.5 font-mono">{a.value}</td>
                      <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{(data.reference || []).find((r) => r.directive === a.directive)?.value ?? '—'}</td>
                      <td className="px-3 py-1.5"><div className="truncate max-w-[24rem]" title={a.note || ''}>{a.note || ''}</div></td>
                      <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{a.created_by || ''}</td>
                      {isAdmin && <td className="px-3 py-1.5 text-right"><button onClick={() => removeAllowed(a.id)} disabled={allowedBusy} className="text-[11px] underline" style={{ color: 'var(--status-danger)' }}>Kaldır</button></td>}
                    </tr>
                  ))}
                  {allowed.length === 0 && <TableEmptyRow colSpan={isAdmin ? 6 : 5} title="Kabul edilen değer yok." description={isAdmin ? 'Direktif + değer ekleyin; o değer artık sapma sayılmaz.' : undefined} />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Sunucular"
        description={`${nf(rows.length)} sunucu gösteriliyor · tarama ${data.scannedAt ? fmtDateTime(data.scannedAt) : data.scanDate} · ${issue ? 'seçilen soruna göre sıralı' : 'sorunlu olanlar üstte'} · satıra tıklayınca sunucu sayfası açılır`}
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
                    'uyum_yuzde',
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
                    h.compliance ?? '',
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
              <Th align="right">
                <button
                  type="button"
                  onClick={() => setSortCompliance((s) => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none'))}
                  className="inline-flex items-center gap-1 font-semibold hover:underline"
                  style={{ color: sortCompliance === 'none' ? 'inherit' : 'var(--accent)' }}
                  title="Uyum oranı: denetlenen kontrollerin kaçı geçti — upstream resolve/keepalive/zone/kullanım, proxy hedefi, global ayarlar, kurulum dosyaları. nginx -T düşen sunucu %0; veri yoksa —. Tıklayınca sırala: önce en düşük, sonra en yüksek, sonra kapalı."
                  aria-label="Uyum skoruna göre sırala"
                >
                  Uyum
                  <span aria-hidden="true">{sortCompliance === 'asc' ? '↑' : sortCompliance === 'desc' ? '↓' : '↕'}</span>
                </button>
              </Th>
              <Th>nginx -T</Th>
              <Th align="right">Server</Th>
              <Th align="right">Location</Th>
              <Th align="right">Upstream</Th>
              <Th align="right"><span title={termHint('resolve yok')}>resolve yok</span></Th>
              <Th align="right"><span title={termHint('Atlayan')}>Atlayan</span></Th>
              <Th align="right"><span title={termHint('Tanımsız')}>Tanımsız</span></Th>
              <Th align="right"><span title={termHint('Ayar sapması')}>Ayar sapması</span></Th>
              <Th align="right"><span title={termHint('Dosya uyumu')}>Dosya farkı</span></Th>
              <Th><span title="İstisna: bu sunucuda denetim metrikleri gösterilmez ve toplamlara girmez; not zorunlu">İstisna</span></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <HostRow
                key={h.host}
                h={h}
                filesReady={data.filesReady}
                canEdit={isAdmin}
                onEditException={() => setExcEdit({ host: h.host, note: h.exception?.note || '', existing: !!h.exception })}
              />
            ))}
          </tbody>
        </TableShell>
      </Panel>

      <Modal
        open={!!excEdit}
        onClose={() => setExcEdit(null)}
        title={excEdit?.existing ? 'İstisnayı düzenle' : 'İstisna tanımla'}
        subtitle={excEdit?.host}
        dismissOnBackdrop={false}
        footer={
          <div className="flex justify-between gap-2 w-full">
            <div>
              {excEdit?.existing && (
                <button onClick={clearException} disabled={excBusy} className="px-3 py-1.5 text-xs rounded-lg border" style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}>
                  İstisnayı kaldır
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setExcEdit(null)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]">İptal</button>
              <button onClick={saveException} disabled={excBusy || !excEdit?.note.trim()} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {excBusy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        }
      >
        {excEdit && (
          <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <p>
              <b>{excEdit.host}</b> istisna olarak işaretlenince yalnızca <b>Atlayan</b> ve <b>Tanımsız</b> sıfırlanır (upstream
              katmanı bilerek yok sayılır); <b>Ayar sapması</b> ve <b>Dosya farkı</b> gösterilmeye ve sayılmaya devam eder. Sunucu
              sayfası ham veriyi göstermeye devam eder.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Not (zorunlu — neden istisna?)</span>
              <textarea
                value={excEdit.note}
                onChange={(e) => setExcEdit({ ...excEdit, note: e.target.value.slice(0, 500) })}
                rows={3}
                placeholder="örn. Eski reverse proxy, kurulum referansı uygulanmaz; 2026 Q4'te kapatılacak"
                className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]"
              />
            </label>
            {excMsg && <div className="text-[11px] text-red-600">{excMsg}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function envSourceHint(src: string): string {
  if (src === 'name') return 'Ortam sunucu adı kalıbından türetildi';
  if (src === 'inventory') return 'Ortam dbo.Inventory (middleware_inventory) kaydından alındı';
  if (src === 'inventory-unknown') return 'Envanter kaydı var ama ortam değeri tanınmıyor';
  return 'Ne ad kalıbı ne envanter ortamı biliyor';
}

function HostRow({ h, filesReady, canEdit, onEditException }: { h: NginxAuditHost; filesReady: boolean; canEdit: boolean; onEditException: () => void }) {
  const navigate = useNavigate();
  const dash = <span className="text-[var(--text-muted)]">—</span>;
  // Istisnali sunucuda YALNIZ atlayan/tanimsiz hucreleri gri (upstream katmani bilerek yok);
  // ayar sapmasi ve dosya farki normal gosterilir (kullanici karari, 2026-09-15).
  const exc = !!h.exception;
  const muted = <span className="text-[var(--text-muted)] opacity-50" title="istisna: bu metrik sayılmıyor">—</span>;
  const numCell = (n: number, bad?: boolean) =>
    n ? <span className={bad ? 'text-red-600 font-semibold' : ''}>{nf(n)}</span> : dash;
  const proxyCell = (n: number, bad?: boolean) => (exc ? muted : numCell(n, bad));
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
      <Td align="right" className="tabular-nums">
        {h.compliance == null ? dash : (
          <span title={(h.complianceParts || []).map((p) => `${p.label}: ${p.ok}/${p.total}${p.pct == null ? '' : ` (%${p.pct})`}`).join('\n') || undefined}>
            <span className="font-semibold" style={{ color: h.compliance >= 95 ? 'var(--status-success)' : h.compliance >= 80 ? 'var(--status-warning)' : 'var(--status-danger)' }}>%{h.compliance}</span>
            <span className="inline-block align-middle ml-1.5 w-12 h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}>
              <span className="block h-full rounded-full" style={{ width: `${h.compliance}%`, background: h.compliance >= 95 ? 'var(--status-success)' : h.compliance >= 80 ? 'var(--status-warning)' : 'var(--status-danger)' }} />
            </span>
          </span>
        )}
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
      <Td align="right" className="tabular-nums">{proxyCell(h.proxyFqdn)}</Td>
      <Td align="right" className="tabular-nums">{proxyCell(h.proxyUndefined, true)}</Td>
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
      <Td className="whitespace-nowrap">
        {h.exception ? (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Pill tone="warning" title={`${h.exception.note}${h.exception.by ? `\n— ${h.exception.by}` : ''}${h.exception.at ? ` · ${fmtDate(h.exception.at)}` : ''}`}>istisna</Pill>
            <span className="text-[10px] text-[var(--text-muted)] max-w-[14rem] truncate" title={h.exception.note}>{h.exception.note}</span>
            {canEdit && (
              <button onClick={onEditException} className="text-[10px] underline decoration-dotted text-[var(--text-muted)]" title="istisnayı düzenle / kaldır">✎</button>
            )}
          </span>
        ) : canEdit ? (
          <button onClick={(e) => { e.stopPropagation(); onEditException(); }} className="text-[10px] text-[var(--text-muted)] underline decoration-dotted" title="bu sunucuyu istisna yap">istisna ekle</button>
        ) : (
          dash
        )}
      </Td>
    </tr>
  );
}
