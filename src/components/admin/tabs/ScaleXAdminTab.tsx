// src/components/admin/tabs/ScaleXAdminTab.tsx — ScaleX yönetimi.
//
// NEDEN AYRI BİR SAYFA: ScaleX'in SMART/OCO ayarı `ansible_ss_customizations` tablosunda,
// ScaleX'in kendi `(awx_server_id, template_id)` satırında duruyor — Self Service'teki
// nginx işleriyle AYNI yerde ve bu doğru. Ama o satırı düzenleyen tek ekran
// `FieldOverridesModal` idi ve yalnızca Self Service kataloğundan ya da Ansible
// sayfasından açılabiliyordu. Sonuç: admin, ScaleX'in SMART ayarını yapabilmek için
// ScaleX'in AWX template'ini **Self Service kataloğuna item olarak eklemek** zorundaydı.
// Sunucudaki hata mesajı da bunu itiraf ediyordu ("Admin > Ansible > Self Servis
// Özelleştirmeleri ekranından ScaleX şablonu için SMART onayını tanımlayın").
//
// YENİ TABLO YOK, YENİ UÇ YOK: aynı satır, aynı uçlar, aynı modal — yalnızca template
// kimliği `scalex_run` kaydından çözülüp doğru yerden açılıyor.
import React, { useCallback, useMemo, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { playbookRegistryApi, type PlaybookRegistryEntry } from '@/api/playbookRegistryApi';
import {
  scalexApi,
  type ScaleXRbacFinding,
  type ScaleXClusterTree,
  type ScaleXHistoryRow,
} from '@/api/scalexApi';
import { downloadCsv } from '@/utils/csv';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime } from '@/utils/datetime';
import FieldOverridesModal from '@/components/self_service/FieldOverridesModal';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const RUN_KEY = 'scalex_run';
const DISCOVERY_KEY = 'scalex_discovery';

// ── OKUNAMAYAN NESNE TIPLERI (RBAC BULGULARI) ────────────────────────────────
//
// NEDEN BURADA: kesif bunlari zaten raporluyordu ama rapor yalnizca o anki
// KULLANICININ ekraninda kaliyordu. Sonuc: 12 tiplik bir uyari duvari her kullaniciya
// her keside gosteriliyor, ayni talep platform ekibine tekrar tekrar aciliyor ve
// hangi namespace'te neyin eksik oldugu hicbir yerde TOPLU durmuyordu.
//
// IKI NEDEN AYRI GOSTERILIR — bu ayrimin kendisi bu ekranin var olus sebebi:
//   `no_permission` → platformdan ISTENEBILIR (genellikle `view` ClusterRole binding)
//   `api_absent`    → o tip cluster'da kurulu DEGIL; yapilacak bir sey YOK.
// Ikisini karistirmak, asla cozulmeyecek bir RBAC talebi acmak demektir.
const RbacFindings: React.FC = () => {
  const [rows, setRows] = useState<ScaleXRbacFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await scalexApi.rbacFindings();
      if (!r.ok) setErr(r.message || 'Bulgular okunamadi.');
      else setRows(r.findings || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // `useAsyncEffect`: efekt icinde dogrudan `load()` cagirmak
  // `react-hooks/set-state-in-effect` uyarisi uretiyor (ESLint ozel hook'larin
  // ICINE bakmaz; erteleme hook'un kendisinde). DIKKAT: `alive()` yalnizca ISTEK
  // BASLAMADAN once bakilir — `load()` icindeki `setState`ler sokme sonrasi yine
  // calisabilir. Hook'un garantisi "sokulmus bilesende istek BASLATMA"dir,
  // "cevabi yut" degil. React 19 bu durumda uyari uretmiyor.
  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, []);

  const askable = useMemo(() => rows.filter((r) => r.reason === 'no_permission'), [rows]);
  const absent = useMemo(() => rows.filter((r) => r.reason === 'api_absent'), [rows]);

  // PLATFORM EKIBINE GIDECEK METIN. Kullanicidan bunu kendi cumleleriyle yazmasini
  // beklemek, yanlis kaynak adiyla acilan ve asla cozulmeyen talepler uretiyordu.
  // TAM KAYNAK ADI sart: `sts` degil `statefulsets.apps`.
  const requestText = useMemo(() => {
    if (askable.length === 0) return '';
    const byNs = new Map<string, ScaleXRbacFinding[]>();
    for (const r of askable) {
      const key = `${r.cluster} / ${r.namespace}`;
      const arr = byNs.get(key);
      if (arr) arr.push(r);
      else byNs.set(key, [r]);
    }
    const lines = [
      'OpenShift yetki talebi — BMW Portal (ScaleX) servis kullanicisi',
      '',
      "Asagidaki namespace'lerde portalin OCP kullanicisi bu kaynaklari LISTELEYEMIYOR.",
      'Genellikle namespace basina bir `view` ClusterRole binding yeterlidir.',
      '',
    ];
    for (const [key, items] of byNs) {
      lines.push(`- ${key}`);
      for (const it of items) {
        lines.push(`    ${it.verb || 'list'} ${it.resource || it.kind}`);
      }
    }
    return lines.join('\n');
  }, [askable]);

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(requestText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano yoksa sessiz gec — metin zaten ekranda */
    }
  }

  async function clearOne(id: number) {
    await scalexApi.clearRbacFinding(id).catch(() => null);
    await load();
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <ExclamationTriangleIcon
          aria-hidden="true"
          className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--status-warning)]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Okunamayan nesne tipleri
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Keşif sırasında bakılamayan tipler burada birikir. Kullanıcı ekranında yalnızca tek
            satırlık bir özet var — bu bir kullanıcı görevi değil, bir platform talebi.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-secondary text-xs">
          <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" />
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <LoadingLogo compact />
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          Kayıt yok — keşiflerde okunamayan bir tip görülmedi.
        </p>
      ) : (
        <>
          {askable.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  Platformdan istenebilir ({askable.length})
                </p>
                <button
                  type="button"
                  onClick={() => void copyRequest()}
                  className="btn-secondary text-xs ml-auto"
                >
                  {copied ? 'Kopyalandı' : 'Talep metnini kopyala'}
                </button>
              </div>
              <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-64 overflow-y-auto">
                {askable.map((r) => (
                  <div key={r.id} className="px-2.5 py-1.5 text-xs flex items-center gap-2">
                    <span className="font-mono text-[var(--text-secondary)] truncate">
                      {r.cluster} / {r.namespace}
                    </span>
                    <span className="font-mono text-[var(--text-primary)] truncate">
                      {r.verb || 'list'} {r.resource || r.kind}
                    </span>
                    <button
                      type="button"
                      title="Çözüldü — listeden düşür"
                      onClick={() => void clearOne(r.id)}
                      className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {absent.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Bu cluster'da kurulu değil ({absent.length})
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                O nesne türünün API/CRD'si yok. <strong>Yapılacak bir şey yok</strong> — bunlar için
                RBAC talebi açmayın, asla çözülmez.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ScaleXAdminTab: React.FC = () => {
  const [rows, setRows] = useState<PlaybookRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGates, setShowGates] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await playbookRegistryApi.list();
      if (!r.ok) {
        setError(r.message || 'Playbook kayıtları okunamadı.');
        return;
      }
      setRows(
        (r.playbooks || []).filter((p) => p.keyName === RUN_KEY || p.keyName === DISCOVERY_KEY),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  // `useAsyncEffect`: efekt icinde dogrudan `load()` cagirmak
  // `react-hooks/set-state-in-effect` uyarisi uretiyor (ESLint ozel hook'larin
  // ICINE bakmaz; erteleme hook'un kendisinde). DIKKAT: `alive()` yalnizca ISTEK
  // BASLAMADAN once bakilir — `load()` icindeki `setState`ler sokme sonrasi yine
  // calisabilir. Hook'un garantisi "sokulmus bilesende istek BASLATMA"dir,
  // "cevabi yut" degil. React 19 bu durumda uyari uretmiyor.
  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, []);

  const run = useMemo(() => rows.find((r) => r.keyName === RUN_KEY) || null, [rows]);
  const discovery = useMemo(() => rows.find((r) => r.keyName === DISCOVERY_KEY) || null, [rows]);

  // SMART ayarı `(awx_server_id, template_id)` çiftine bağlı. Template ID yoksa
  // düzenlenecek bir satır da yok — modalı açmak, boşluğa yazmak olurdu.
  const runTemplateId = run?.effectiveTemplateId ?? run?.awxTemplateId ?? null;
  const runServerId = run?.awxServerId ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5">
        <ShieldCheckIcon
          aria-hidden="true"
          className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-secondary)]"
        />
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">ScaleX yönetimi</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Onay kapıları ve AWX bağlantısı. Cluster / vault anahtarı / jump server bilgisi
            <strong> burada değil</strong>: onlar OCP Yapılandırma sekmesinde, tek yerde tutulur ve
            LogX, OpsX, Telnet ile <strong>paylaşılır</strong>.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <LoadingLogo compact />
      ) : (
        <>
          {/* ── AWX bağlantısı ── */}
          <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">AWX bağlantısı</p>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" /> Yenile
              </button>
            </div>
            <div className="space-y-2">
              {[
                { e: run, label: 'Replica işlemi', key: RUN_KEY },
                { e: discovery, label: 'Keşif (salt okunur)', key: DISCOVERY_KEY },
              ].map(({ e, label, key }) => (
                <div key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-[var(--text-primary)]">{label}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">{key}</span>
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                    {/* KAYNAK GÖRÜNÜR: değer DB'den mi geldi, `.env` yedeğinden mi?
                        Bu ayrım bir üretim arızasında doğrudan işe yarar. */}
                    {e?.awxTemplateId ? (
                      <span className="pf-label pf-label--green">DB: #{e.awxTemplateId}</span>
                    ) : e?.effectiveTemplateId ? (
                      <span className="pf-label pf-label--blue">.env: {e.envVarName}</span>
                    ) : (
                      <span className="pf-label pf-label--red">Tanımsız</span>
                    )}
                    <span className="text-[var(--text-muted)]">
                      AWX sunucusu: {e?.awxServerId ?? 'varsayılan (1)'}
                    </span>
                    {e && !e.enabled && <span className="pf-label pf-label--gold">pasif</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
              <InformationCircleIcon
                aria-hidden="true"
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
              />
              Template ID ve AWX sunucusu <strong>Playbook Kayıtları</strong> sekmesinden girilir;
              burası yalnızca durumu gösterir. Tanımsızken ScaleX ekranı çalışmaz (
              <span className="font-mono">501</span>).
            </p>
          </section>

          {/* ── Onay kapıları ── */}
          <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Onay kapıları (SMART / OCO)
            </p>
            <div className="rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-secondary)] space-y-1">
              <p>
                <strong>Yalnızca production.</strong> Prod dışı{' '}
                <span className="font-mono">apply</span> işlemleri OCO numarası istemez ve SMART
                kaydı açmaz. Değişiklik izi her ortamda tutulur.
              </p>
              <p>
                <strong>Ortam bilinmiyorsa prod sayılır</strong> — bilgi yokluğu kapıyı açar.
              </p>
              <p>
                <span className="font-mono">dry_run</span> hiçbir kapıdan geçmez;{' '}
                <strong>Geri Al</strong> prod'da OCO'yu uyarı olarak geçer (gerekçe zorunlu) ama
                SMART kaydı açar.
              </p>
              <p className="text-amber-800">
                SMART yapılandırılmadan prod'da <span className="font-mono">apply</span> çalışmaz —
                sunucu <span className="font-mono">503 smart_not_configured</span> ile reddeder.
              </p>
            </div>
            {runTemplateId ? (
              <button type="button" className="btn-secondary" onClick={() => setShowGates(true)}>
                SMART / OCO ayarlarını düzenle
              </button>
            ) : (
              <p className="text-xs text-amber-800">
                Önce <strong>Playbook Kayıtları</strong>'nda{' '}
                <span className="font-mono">{RUN_KEY}</span> satırına AWX Template ID girin — SMART
                ayarı o template'e bağlı tutulur.
              </p>
            )}
          </section>

          <ClusterCapsPanel />

          <OcoDiagnosePanel />
        </>
      )}

      <IsGecmisiPanel />

      <RbacFindings />

      {/* AYNI MODAL, AYNI TABLO, AYNI UÇLAR — yalnızca doğru yerden açılıyor. */}
      {showGates && runTemplateId != null && (
        <FieldOverridesModal
          item={{
            awxServerId: runServerId,
            awxTemplateId: runTemplateId,
            title: 'ScaleX — Replica İşlemi',
          }}
          onClose={() => setShowGates(false)}
        />
      )}
    </div>
  );
};

// ── OCO TANI PANELI ──────────────────────────────────────────────────────────
//
// "Bir örnek OCO girince ne çıkıyor, hangisi nasıl dikkate alınıyor?" sorusunun
// cevabı bugün hiçbir yerde görünmüyor. Portal, servisin döndürdüğü gövdeden
// YALNIZCA ÜÇ şey okuyor: kayıt var mı, planlanan kesinti saatleri, başlık.
// Onay durumu / statü / hedef sistemler HİÇ okunmuyor — yani bugünkü "OCO
// kontrolü" gerçekte bir TAKVİM kontrolü.
//
// Bu panel o gerçeği görünür yapar: gelen HER alan listelenir ve "okunuyor /
// yok sayılıyor" diye işaretlenir. Amaç, alan kurallarını tahminle değil
// GERÇEK ÇIKTIYLA yazabilmek. HİÇBİR ŞEY BAŞLATMAZ.
function OcoDiagnosePanel() {
  const [num, setNum] = useState('');
  const [env, setEnv] = useState('prod');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof scalexApi.ocoDiagnose>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hepsi, setHepsi] = useState(false);

  async function sorgula() {
    if (!num.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await scalexApi.ocoDiagnose({ number: num.trim(), env });
      setRes(r);
      if (!r.ok && !r.lookupFailed && !r.notConfigured) setErr(r.message || 'Sorgu başarısız.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const gosterilen = res?.fields
    ? hepsi
      ? res.fields
      : res.fields.filter((f) => f.type !== 'object')
    : [];

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">OCO Tanı</p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Bir OCO numarası girin; servisin döndürdüğü <strong>her alan</strong> listelenir ve
          portalın hangisini okuduğu işaretlenir. <strong>Hiçbir şey başlatılmaz</strong> — salt
          okunur bir sorgudur ve denetime yazılır.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            OCO numarası
          </span>
          <input
            value={num}
            onChange={(e) => setNum(e.target.value)}
            inputMode="numeric"
            placeholder="22502813"
            className="w-44 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Simülasyon ortamı
          </span>
          <input
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            className="w-32 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          />
        </label>
        <button type="button" className="btn-primary" disabled={busy || !num.trim()} onClick={sorgula}>
          {busy ? 'Sorgulanıyor…' : 'Sorgula'}
        </button>
      </div>

      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}

      {/* "AYAR YOK" ile "SERVİS ÇÖKMÜŞ" AYRI EKRANLAR. Eskiden `OCO_API_URL`in
          kod içinde bir varsayılanı vardı ve ikisi aynı mesajı veriyordu. */}
      {res?.notConfigured && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          OCO servisi <strong>yapılandırılmamış</strong>. Admin &gt; Sistem &gt;{' '}
          <code>OCO_API_URL</code> girin. Bu, servisin çökmüş olmasından <strong>farklı</strong> bir
          durumdur.
        </div>
      )}

      {res?.lookupFailed && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <strong>Kayıt okunamadı:</strong> {res.message}
        </div>
      )}

      {res?.ok && (
        <div className="space-y-3">
          {/* KAPI SİMÜLASYONU — "bu numarayla apply denesen ne olurdu" */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-inset)] p-3 text-xs space-y-1">
            <p className="font-semibold text-[var(--text-primary)]">
              Kapı simülasyonu ({res.scope?.env} · {res.scope?.action} · apply)
            </p>
            <p className="text-[var(--text-secondary)]">
              <span className="font-mono">{res.simulation?.outcome}</span> — {res.simulation?.message}
            </p>
            {res.window && (
              <p className="text-[var(--text-muted)]">
                Pencere: {res.window.windowStartText} → {res.window.windowEndText}
                {res.window.equal && ' (başlangıç = bitiş verilmiş, 2 saat sayıldı)'}
                {res.plannedSource === 'interruption' &&
                  ' · kaynak: PlannedInterruption (Planned* alanları yoktu)'}
              </p>
            )}
            {res.gatePolicy?.ocoGateDisabled && (
              <p className="text-red-700">
                <strong>Not:</strong> bu ortamda OCO kapısı admin tarafından KAPATILMIŞ.
              </p>
            )}
          </div>

          {/* EKSİK ALANLAR — "kapı neden çalışmadı"nın doğrudan cevabı */}
          {res.missing && res.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <p className="font-semibold">Portalın beklediği ama yanıtta OLMAYAN alanlar:</p>
              <ul className="mt-1 space-y-0.5">
                {res.missing.map((m) => (
                  <li key={m.path}>
                    <code>{m.path.split('.').pop()}</code> — {m.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-muted)]">
              {res.fields?.length} alan geldi · <strong>{res.ignoredCount}</strong> tanesi
              portal tarafından <strong>yok sayılıyor</strong>
              {res.fieldsTruncated && ' · liste kırpıldı'}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" checked={hepsi} onChange={(e) => setHepsi(e.target.checked)} />
              iç nesneleri de göster
            </label>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {gosterilen.map((f) => (
              <div key={f.path} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                <span
                  className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    f.read ? 'bg-green-100 text-green-800' : 'bg-[var(--bg-inset)] text-[var(--text-muted)]'
                  }`}
                >
                  {f.read ? 'OKUNUYOR' : 'yok sayılıyor'}
                </span>
                <span className="font-mono text-[var(--text-primary)] break-all">
                  {f.path.replace('GetChangeOrderByWfInstanceIdResult.', '')}
                </span>
                <span className="ml-auto font-mono text-[var(--text-muted)] break-all text-right max-w-[40%]">
                  {f.value ?? '—'}
                </span>
              </div>
            ))}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--text-muted)]">
              Portal hangi alanı NEDEN okuyor?
            </summary>
            <ul className="mt-1.5 space-y-1">
              {res.readFields?.map((f) => (
                <li key={f.path} className="text-[var(--text-secondary)]">
                  <code>{f.path.split('.').pop()}</code>{' '}
                  <span className="text-[var(--text-muted)]">({f.reader})</span> — {f.why}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

// ── CLUSTER YETENEK ENVANTERI ────────────────────────────────────────────────
//
// Keşfin ölçülen maliyeti cluster başına ~110 `oc` çağrısı (~30 sn) ve bunun
// %80'i API grubu sayımı + CRD tip probe'ları. İkisi de NAMESPACE'TEN,
// UYGULAMADAN ve KULLANICIDAN BAĞIMSIZ; bir operator kurulmadıkça aylarca
// değişmez. Admin cluster başına BİR KEZ tarar, keşifler oradan okur.
//
// ÜÇ DURUM AYRI GÖSTERİLİR — ikisini birleştirmek bu depoda iki ayrı arıza
// üretti: "hiç taranmadı" / "tarandı, ekstra CRD yok" / "okunamadı".
/** `UNKNOWN` = uzlastirici 24 saat boyunca isin durumunu OKUYAMADI — "basarisiz" DEGIL. */
const DURUM_TONU: Record<string, string> = {
  successful: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  canceled: 'bg-[var(--bg-inset)] text-[var(--text-muted)]',
  UNKNOWN: 'bg-amber-100 text-amber-900',
};

function uygulamalariCoz(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * IS GECMISI — `GET /api/scalex/history`.
 *
 * NEDEN VAR: uc PR #115'ten beri yaziliydi ve `scalexApi.history()` sarmalayicisi
 * da vardi, ama HICBIR BILESEN cagirmiyordu. Sonuclari:
 *   * uzlastiricinin `UNKNOWN` yazdigi isler kullaniciya HIC gorunmuyordu,
 *   * SMART onay zinciri (approval_state / approved_by / approved_at) yalniz DB'deydi,
 *   * tarayici sekmesi kapandiktan sonra bir isin sonucuna ulasmanin yolu yoktu
 *     (`JobTrackerContext` oturum-omurlu).
 *
 * Sunucuda SIFIR degisiklik: yalnizca ekran.
 */
function IsGecmisiPanel() {
  const [rows, setRows] = useState<ScaleXHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [durum, setDurum] = useState('');
  const [islem, setIslem] = useState('');
  const [acik, setAcik] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await scalexApi.history();
      if (r.ok) {
        setRows(r.items || []);
        setErr(null);
      } else setErr(r.message || 'İş geçmişi okunamadı.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, []);

  const durumlar = useMemo(
    () => [...new Set(rows.map((r) => r.status).filter(Boolean))] as string[],
    [rows],
  );
  const islemler = useMemo(
    () => [...new Set(rows.map((r) => r.action).filter(Boolean))] as string[],
    [rows],
  );

  const suzulmus = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (durum && r.status !== durum) return false;
      if (islem && r.action !== islem) return false;
      if (!needle) return true;
      const alan = [
        r.username, r.env, r.tenant, r.cluster_name, r.namespace,
        r.oco_number, r.smart_ticket_id, r.awx_job_id, r.app_names_json,
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return alan.includes(needle);
    });
  }, [rows, q, durum, islem]);

  const csv = () =>
    downloadCsv(
      'scalex_is_gecmisi',
      ['Tarih', 'Kullanıcı', 'Ortam', 'Tenant', 'Cluster', 'Namespace', 'İşlem', 'Mod',
       'Uygulamalar', 'Durum', 'Sonuç', 'AWX işi', 'SMART', 'OCO', 'Onay', 'Onaylayan', 'Gerekçe'],
      // SUZULMUS satirlar disa aktarilir — ekranda gordugunu indirir.
      suzulmus.map((r) => [
        r.created_at, r.username, r.env, r.tenant, r.cluster_name, r.namespace,
        r.action, r.execution_mode, uygulamalariCoz(r.app_names_json).join(' '),
        r.status, r.overall_status, r.awx_job_id, r.smart_ticket_id, r.oco_number,
        r.approval_state, r.approved_by, r.reason,
      ]),
    );

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">İş geçmişi</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Son 200 ScaleX işlemi. Admin tümünü, diğer kullanıcılar yalnızca kendi
            işlerini görür. <strong>UNKNOWN</strong> = uzlaştırıcı 24 saat boyunca işin
            durumunu okuyamadı — “başarısız” demek <em>değil</em>.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button type="button" onClick={csv} disabled={!suzulmus.length}
            className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50">
            CSV
          </button>
          <button type="button" onClick={load}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
            <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" /> Yenile
          </button>
        </div>
      </div>

      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="kullanıcı, cluster, namespace, OCO, iş no…"
          className="w-64 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]" />
        <select value={islem} onChange={(e) => setIslem(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
          <option value="">tüm işlemler</option>
          {islemler.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={durum} onChange={(e) => setDurum(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
          <option value="">tüm durumlar</option>
          {durumlar.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {suzulmus.length} / {rows.length}
          {rows.length >= 200 && ' · liste 200 satırda kırpılıyor'}
        </span>
      </div>

      {loading && !rows.length ? (
        <LoadingLogo compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="py-1.5 pr-3 font-medium">Tarih</th>
                <th className="py-1.5 pr-3 font-medium">Kullanıcı</th>
                <th className="py-1.5 pr-3 font-medium">Kapsam</th>
                <th className="py-1.5 pr-3 font-medium">İşlem</th>
                <th className="py-1.5 pr-3 font-medium">Durum</th>
                <th className="py-1.5 pr-3 font-medium">Onay</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {!suzulmus.length && (
                <TableEmptyRow
                  colSpan={7}
                  title={rows.length ? 'Süzgece uyan kayıt yok.' : 'Henüz ScaleX işlemi yok.'}
                  description={
                    rows.length
                      ? 'Arama metnini ya da süzgeçleri gevşetin.'
                      : 'Bir ScaleX işlemi çalıştırıldığında burası dolar.'
                  }
                />
              )}
              {suzulmus.map((r) => {
                const uygulamalar = uygulamalariCoz(r.app_names_json);
                return (
                  <React.Fragment key={r.id}>
                    <tr className="align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--text-muted)]">
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="py-1.5 pr-3">{r.username || '—'}</td>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono">{r.cluster_name || '—'}</span>
                        <span className="text-[var(--text-muted)]">
                          {' '}/ {r.namespace || '—'}
                        </span>
                        <div className="text-[var(--text-muted)]">
                          {r.tenant} / {r.env}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {r.action}
                        {r.execution_mode === 'dry_run' && (
                          <span className="ml-1 text-[10px] text-[var(--text-muted)]">(prova)</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          DURUM_TONU[r.status || ''] || 'bg-[var(--bg-inset)] text-[var(--text-muted)]'
                        }`}>
                          {r.status || '—'}
                        </span>
                        {r.overall_status && r.overall_status !== r.status && (
                          <div className="mt-0.5 text-[var(--text-muted)]">{r.overall_status}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">
                        {/* SMART/OCO zinciri: bugune kadar YALNIZ DB'deydi. */}
                        {r.smart_ticket_id ? `SMART #${r.smart_ticket_id}` : null}
                        {r.oco_number ? <div>OCO {r.oco_number}</div> : null}
                        {r.approval_state ? <div>{r.approval_state}</div> : null}
                        {!r.smart_ticket_id && !r.oco_number && !r.approval_state && '—'}
                      </td>
                      <td className="py-1.5 text-right">
                        <button type="button" onClick={() => setAcik(acik === r.id ? null : r.id)}
                          className="text-[var(--accent)] hover:underline">
                          {acik === r.id ? 'gizle' : 'ayrıntı'}
                        </button>
                      </td>
                    </tr>
                    {acik === r.id && (
                      <tr>
                        <td colSpan={7} className="pb-3">
                          <div className="rounded-lg bg-[var(--bg-inset)] p-2.5 space-y-1">
                            <p>
                              <span className="text-[var(--text-muted)]">Uygulamalar: </span>
                              {uygulamalar.length ? uygulamalar.join(', ') : '—'}
                            </p>
                            {r.target_replicas != null && (
                              <p>
                                <span className="text-[var(--text-muted)]">Hedef replika: </span>
                                {r.target_replicas}
                              </p>
                            )}
                            <p>
                              <span className="text-[var(--text-muted)]">AWX: </span>
                              {r.awx_job_id ? `sunucu ${r.awx_server_id} / iş #${r.awx_job_id}` : '—'}
                            </p>
                            {r.approved_by && (
                              <p>
                                <span className="text-[var(--text-muted)]">Onaylayan: </span>
                                {r.approved_by}
                                {r.approved_at && ` · ${fmtDateTime(r.approved_at)}`}
                              </p>
                            )}
                            {r.reason && (
                              <p>
                                <span className="text-[var(--text-muted)]">Gerekçe: </span>
                                {r.reason}
                              </p>
                            )}
                            <p className="text-[var(--text-muted)]">
                              Tam çıktı ve hedef bazlı sonuç bu listede taşınmaz (tek işin
                              sonucu yüz binlerce karakter olabiliyor); AWX iş numarasından
                              Otomasyon ekranında okunabilir.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ClusterCapsPanel() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof scalexApi.clusterCaps>>['items']>([]);
  const [ttl, setTtl] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Kapsam süzgeci: uç `env`/`tenant` parametrelerini ZATEN destekliyordu, ekran
  // parametresiz çağırıyordu. Çok cluster'lı kurulumda 500 satırlık düz liste oluyordu.
  const [tree, setTree] = useState<ScaleXClusterTree>({});
  const [env, setEnv] = useState('');
  const [tenant, setTenant] = useState('');
  const [tarayan, setTarayan] = useState(false);
  const [taramaNotu, setTaramaNotu] = useState<string | null>(null);

  const load = useCallback(async (kapsam?: { env: string; tenant: string }) => {
    setLoading(true);
    try {
      const r = await scalexApi.clusterCaps(
        kapsam?.env && kapsam?.tenant ? { env: kapsam.env, tenant: kapsam.tenant } : {},
      );
      if (r.ok) {
        setRows(r.items || []);
        setTtl(r.ttlDays ?? null);
        setErr(null);
      } else setErr(r.message || 'Yetenek envanteri okunamadı.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async (alive) => {
    if (!alive()) return;
    await load();
    try {
      const t = await scalexApi.clusters();
      if (alive() && t.ok) setTree(t.tree || {});
    } catch {
      /* kapsam süzgeci olmadan da panel çalışır */
    }
  }, []);

  const tenantlar = useMemo(() => Object.keys(tree[env] || {}), [tree, env]);
  const clusterlar = useMemo(
    () => (env && tenant ? tree[env]?.[tenant] || [] : []),
    [tree, env, tenant],
  );

  /**
   * TARAMAYI BURADAN BAŞLAT.
   *
   * Bu düğme olmadan tabloyu dolduran hiçbir yol yoktu: `capabilities` keşfi
   * sunucuda tanımlıydı ama istemci tipinde yoktu ve doğrulayıcı namespace'i
   * koşulsuz zorunlu kıldığı için API'den de çağrılamıyordu.
   *
   * Tarama bir AWX işidir — SONUCU ANINDA GELMEZ. Bu yüzden iş numarası
   * yazılır ve "bitince Yenile" denir; sahte bir ilerleme çubuğu gösterilmez.
   */
  const tara = useCallback(async () => {
    if (!env || !tenant || !clusterlar.length) return;
    setTarayan(true);
    setTaramaNotu(null);
    setErr(null);
    try {
      const r = await scalexApi.discover(
        { env, tenant, namespace: '', clusters: clusterlar, apps: [] },
        'capabilities',
      );
      if (r.ok) {
        setTaramaNotu(
          `Tarama başlatıldı — AWX işi #${r.jobId} (${clusterlar.length} cluster). ` +
            'İş bitince "Yenile" ile listeyi tazeleyin.',
        );
      } else {
        setErr(r.message || 'Tarama başlatılamadı.');
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTarayan(false);
    }
  }, [env, tenant, clusterlar]);

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Cluster yetenekleri</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Ölçeklenebilir CRD listesi ve yetki taraması. Keşfin en pahalı iki kalemi burada{' '}
            <strong>bir kez</strong> hesaplanır; sonraki keşifler bunu okuyup cluster başına
            ~50 API çağrısını atlar.
            {ttl != null && ` Kayıt ${ttl} gün geçerli sayılır.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(env && tenant ? { env, tenant } : undefined)}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline flex-shrink-0"
        >
          <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>

      {/* KAPSAM + TARAMA. Taramayı başlatan tek yer burası. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--text-muted)]">
          Ortam
          <select
            value={env}
            onChange={(e) => {
              setEnv(e.target.value);
              setTenant('');
              setTaramaNotu(null);
            }}
            className="mt-0.5 block w-36 px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          >
            <option value="">tümü</option>
            {Object.keys(tree).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--text-muted)]">
          Tenant
          <select
            value={tenant}
            onChange={(e) => {
              setTenant(e.target.value);
              setTaramaNotu(null);
            }}
            disabled={!env}
            className="mt-0.5 block w-36 px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">seçin</option>
            {tenantlar.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={tara}
          disabled={tarayan || !env || !tenant || !clusterlar.length}
          className="btn-primary text-xs py-1.5 disabled:opacity-50"
        >
          {tarayan ? 'Başlatılıyor…' : `Tara${clusterlar.length ? ` (${clusterlar.length} cluster)` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => load(env && tenant ? { env, tenant } : undefined)}
          disabled={!env || !tenant}
          className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          bu kapsamı listele
        </button>
      </div>

      {taramaNotu && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
          {taramaNotu}
        </div>
      )}

      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}

      {loading && !rows.length && (
        <p className="text-sm text-[var(--text-muted)]">Envanter okunuyor…</p>
      )}

      {!loading && !rows.length && !err && (
        <p className="text-xs text-[var(--text-muted)]">
          Bu kapsamda taranmış cluster yok. Yukarıdan ortam + tenant seçip{' '}
          <strong>Tara</strong> deyin — liste ancak bu taramayla dolar. O ana kadar keşif{' '}
          <strong>eski (yavaş) yolu</strong> kullanır, sonuç yine doğrudur.
        </p>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-[var(--border)]">
          {rows.map((r) => {
            const okunamadi = !r.resourcesReadable;
            const hicTaranmadi = r.kinds === null;
            const rbacEksik = Object.entries(r.rbac || {})
              .filter(([, v]) => !v)
              .map(([k]) => k);
            return (
              <div key={`${r.env}|${r.tenant}|${r.clusterName}`} className="py-2.5 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-[var(--text-primary)]">{r.clusterName}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {r.tenant} / {r.env}
                  </span>
                  {/* UC DURUM AYRI ROZET. "okunamadi"yi "CRD yok" gibi gostermek,
                      olceklenebilir operator nesnelerinin sessizce dusmesi demekti. */}
                  {okunamadi ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800">
                      OKUNAMADI — hızlandırma için kullanılmıyor
                    </span>
                  ) : hicTaranmadi ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-inset)] text-[var(--text-muted)]">
                      hiç taranmadı
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800">
                      {r.kinds!.length} ölçeklenebilir CRD
                    </span>
                  )}
                  {r.stale && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900">
                      bayat
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {fmtDateTime(r.fetchedAt)}
                  {r.scannedBy && ` · ${r.scannedBy}`}
                  {/* HANGI IS TARADI: bayat/yanlis bir satirin izini surebilmek icin. */}
                  {r.awxJobId != null && ` · AWX #${r.awxJobId}`}
                  {r.expiresAt && ` · geçerlilik ${fmtDateTime(r.expiresAt)}`}
                </p>
                {rbacEksik.length > 0 && (
                  <p className="text-xs text-amber-800">
                    Okunamayan kaynaklar: <span className="font-mono">{rbacEksik.join(', ')}</span>
                  </p>
                )}
                {!hicTaranmadi && r.kinds!.length > 0 && (
                  <p className="text-xs font-mono text-[var(--text-muted)] break-all">
                    {r.kinds!.join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default ScaleXAdminTab;
