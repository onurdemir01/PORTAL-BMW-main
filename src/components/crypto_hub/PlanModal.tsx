// src/components/crypto_hub/PlanModal.tsx — Crypto Hub ön onay penceresi (2026-09-26).
//
// Kullanıcı: "installation/upgrade veya herhangi bir değişiklikte kullanıcıya uygulanacak
// komutları gösteren bir ön onay penceresi hazırlayalım."
//
// 2026-09-26 GERİ BİLDİRİMİ ÜZERİNE YENİDEN TASARIM:
//   * "mevcut durumun görüntülenmesi ve upgrade ayrılmalı" → pencere İKİ ADIM: önce HEDEF
//     SÜRÜM (koşan sürüm ve seçenekler yan yana), sonra UYGULANACAK KOMUTLAR. Upgrade gibi
//     bir işlem, tek satırlık bir metin kutusuna sıkıştırılmayacak kadar büyük bir karar.
//   * "Metaco'da yeni versiyon gelirse elle girilmesi gerekiyor" → sürümler LİSTELENİR
//     (chart deposundan ve bastion arşivinden, kaynağı yazılı), listede olmayan için
//     "başka bir sürüme geçeceğim" seçeneği serbest metin açar. Ölçülemeyen bir depo,
//     kullanıcıyı sürüm girmekten alıkoymamalı.
//
// PENCERENİN SÖZLEŞMESİ:
//   * Komutlar SUNUCUDA üretilir (shared/cryptoHubActions.cjs) — aynı plan yarın playbook'a
//     girdi olacak; iki ayrı yerde yazılırsa ayrışır.
//   * YAZAN adımlar görsel olarak ayrılır; "kaç komut kümeye dokunuyor" onaydan önce
//     tek bakışta görünür.
//   * Portal dışı adımlar (LinuxOne, Jenkins, iş birimi) gizlenmez — sırası önemli.
//   * Onay şimdilik KAPALI: yazan playbook bağlanana kadar bu ekran yalnızca gösterir.
import React, { useMemo, useState } from 'react';
import {
  ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon,
  CommandLineIcon, HandRaisedIcon, MagnifyingGlassIcon, PencilSquareIcon,
  ArrowRightIcon, ArrowLeftIcon, ArchiveBoxIcon, CloudArrowDownIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { cryptoHubApi, type CryptoActionDef, type CryptoPlan, type CryptoPlanStep } from '@/api/cryptoHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { toast } from '@/hooks/useToast';

export interface KnownVersion { version: string; source: 'depo' | 'arsiv' }

const KIND: Record<CryptoPlanStep['kind'], { label: string; color: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  command: { label: 'komut', color: 'var(--text-secondary)', Icon: CommandLineIcon },
  check: { label: 'kontrol', color: 'var(--status-info)', Icon: MagnifyingGlassIcon },
  manual: { label: 'Portal dışı', color: 'var(--status-warning)', Icon: HandRaisedIcon },
};

const VER_RE = /^[0-9][0-9A-Za-z._-]{0,63}$/;

function CopyButton({ text, label = 'Kopyala' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 h-7 px-2 text-[11px] rounded-md border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { toast.error('Panoya kopyalanamadı.'); }
      }}
    >
      {done ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
      {done ? 'kopyalandı' : label}
    </button>
  );
}

function Step({ s }: { s: CryptoPlanStep }) {
  const k = KIND[s.kind];
  return (
    <li
      className="rounded-xl border px-4 py-3 space-y-2"
      style={{
        borderColor: s.writes ? 'var(--status-danger)' : 'var(--border-subtle)',
        background: s.writes ? 'var(--status-danger-bg)' : 'var(--bg-surface)',
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="tabular-nums text-[11px] font-semibold h-6 w-6 rounded-full inline-flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >{s.n}</span>
        <k.Icon className="h-4 w-4 shrink-0" style={{ color: k.color }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: k.color }}>{k.label}</span>
        {s.writes && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
            <PencilSquareIcon className="h-3 w-3" /> değiştirir
          </span>
        )}
        {s.unknown && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>
            doğrulanmalı
          </span>
        )}
        <span className="flex-1" />
        {s.command && <CopyButton text={s.command} />}
      </div>

      {s.command && (
        <pre
          className="text-[12px] leading-relaxed rounded-lg px-3 py-2.5 overflow-x-auto"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >{s.command}</pre>
      )}

      {s.note && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{s.note}</div>}
      {s.source && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>kaynak: {s.source}</div>}
    </li>
  );
}

/** 1. ADIM — hedef sürüm. Koşan sürüm solda, seçenekler sağda; listede yoksa serbest metin. */
function VersionStep({ running, known, value, onChange, onNext }: {
  running: string;
  known: KnownVersion[];
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const [manual, setManual] = useState(false);
  const liste = useMemo(() => {
    const m = new Map<string, Set<KnownVersion['source']>>();
    for (const k of known) {
      if (!k.version) continue;
      if (!m.has(k.version)) m.set(k.version, new Set());
      m.get(k.version).add(k.source);
    }
    return [...m.entries()]
      .map(([version, kaynaklar]) => ({ version, kaynaklar: [...kaynaklar] }))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  }, [known]);

  const gecerli = !value || VER_RE.test(value.trim());

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Şu an koşan</div>
          <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>{running || '—'}</div>
        </section>
        <section className="rounded-xl border p-4" style={{ borderColor: value ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Geçilecek sürüm</div>
          <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: value ? 'var(--accent)' : 'var(--text-muted)' }}>
            {value || 'seçilmedi'}
          </div>
        </section>
      </div>

      {liste.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Bilinen sürümler</div>
          <div className="flex flex-wrap gap-1.5">
            {liste.map((k) => {
              const secili = value === k.version && !manual;
              return (
                <button
                  key={k.version}
                  type="button"
                  onClick={() => { setManual(false); onChange(k.version); }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] tabular-nums"
                  style={secili
                    ? { borderColor: 'var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600 }
                    : { borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                  title={k.kaynaklar.includes('depo') ? 'Chart deposunda mevcut' : 'Bastion\'da indirilmiş'}
                >
                  {k.kaynaklar.includes('depo')
                    ? <CloudArrowDownIcon className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                    : <ArchiveBoxIcon className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />}
                  {k.version}
                  {k.version === running && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>koşan</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span className="inline-flex items-center gap-1"><CloudArrowDownIcon className="h-3.5 w-3.5" /> chart deposunda</span>
            <span className="inline-flex items-center gap-1"><ArchiveBoxIcon className="h-3.5 w-3.5" /> bastion'da indirilmiş</span>
          </div>
        </div>
      )}

      {/* LISTEDE OLMAYAN SURUM: Metaco'da chart deposu sorgulanamiyor; yeni bir surum
          listede HIC gorunmeyebilir. Serbest metin olmazsa ekran, kullanicinin bildigi bir
          gercegi reddetmis olurdu. */}
      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: manual ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={manual}
            onChange={(e) => { setManual(e.target.checked); if (e.target.checked) onChange(''); }}
          />
          Listede olmayan bir sürüme geçeceğim
        </label>
        {manual && (
          <div className="space-y-1">
            <input
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="örn. 1.35.0"
              className="h-9 px-3 text-sm rounded-lg border w-56 tabular-nums"
              style={{ borderColor: gecerli ? 'var(--border)' : 'var(--status-danger)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
            {!gecerli && (
              <div className="text-[11px]" style={{ color: 'var(--status-danger)' }}>
                Sürüm rakamla başlamalı; yalnız harf, rakam, nokta, tire ve alt çizgi içerebilir.
              </div>
            )}
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {liste.length === 0
                ? 'Chart deposu sorgulanamadığı için liste boş — sürümü elle girmeniz normal.'
                : 'Deponun listelemediği yeni bir sürüm için kullanın.'}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!value.trim() || !gecerli}
          onClick={onNext}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
        >
          Komutları göster <ArrowRightIcon className="h-4 w-4" />
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Bu adımda hiçbir şey çalışmaz; yalnızca plan üretilir.
        </span>
      </div>
    </div>
  );
}

export function PlanModal({ tenantKey, tenantLabel, action, running = '', known = [], onClose }: {
  tenantKey: string;
  tenantLabel: string;
  action: CryptoActionDef;
  running?: string;
  known?: KnownVersion[];
  onClose: () => void;
}) {
  const needsVersion = action.params.some((p) => p.key === 'version');
  const [version, setVersion] = useState('');
  // Surum isteyen islemlerde once SURUM adimi; digerlerinde dogrudan plan.
  const [step, setStep] = useState<'version' | 'plan'>(needsVersion ? 'version' : 'plan');
  const [plan, setPlan] = useState<CryptoPlan | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useAsyncEffect(async (alive) => {
    if (step !== 'plan') return;
    setLoading(true); setErr('');
    try {
      const r = await cryptoHubApi.plan(tenantKey, action.key, version);
      if (!alive()) return;
      if (!r.ok || !r.plan) { setErr(r.message || 'Plan üretilemedi.'); setPlan(null); return; }
      setPlan(r.plan);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); } finally { if (alive()) setLoading(false); }
  }, [tenantKey, action.key, step, reload]);

  const tumKomutlar = useMemo(
    () => (plan?.steps || []).filter((s) => s.command).map((s) => `# ${s.n}. ${s.title}\n${s.command}`).join('\n\n'),
    [plan],
  );

  const altBaslik = needsVersion && version
    ? `${tenantLabel} · ${running || '—'} → ${version}`
    : `${tenantLabel} · uygulanacak adımlar`;

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      dismissOnBackdrop={false}
      title={`${action.label} — ön onay`}
      subtitle={altBaslik}
      footer={(
        <div className="flex items-center gap-2 flex-wrap w-full">
          {step === 'plan' && needsVersion && (
            <button
              type="button"
              className="inline-flex items-center gap-1 h-9 px-3 text-xs font-medium rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={() => setStep('version')}
            >
              <ArrowLeftIcon className="h-4 w-4" /> Sürüm seçimine dön
            </button>
          )}
          {step === 'plan' && (
            <>
              {/* ONAY ŞİMDİLİK KAPALI: yazan playbook yok. Aktif ama hiçbir şey yapmayan bir
                  buton, onaya basıldı sanılmasına yol açardı. */}
              <button
                type="button"
                disabled
                title={plan?.runnableNote}
                className="inline-flex items-center gap-1 h-9 px-4 text-sm font-medium rounded-lg border opacity-50 cursor-not-allowed"
                style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
              >
                Onayla ve çalıştır
              </button>
              {tumKomutlar && <CopyButton text={tumKomutlar} label="Tüm komutları kopyala" />}
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className="h-9 px-3 text-xs font-medium rounded-lg border"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {needsVersion && (
          <ol className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <li style={step === 'version' ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>1. Hedef sürüm</li>
            <li>›</li>
            <li style={step === 'plan' ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>2. Uygulanacak komutlar</li>
          </ol>
        )}

        {step === 'version' ? (
          <VersionStep
            running={running}
            known={known}
            value={version}
            onChange={setVersion}
            onNext={() => { setStep('plan'); setReload((n) => n + 1); }}
          />
        ) : (
          <>
            {plan && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  {plan.steps.length} adım
                </span>
                <span className="px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                  {plan.writeCount} adım kümeyi değiştirir
                </span>
                {plan.unknownCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
                    {plan.unknownCount} adım doğrulanmalı
                  </span>
                )}
                {plan.scannedAt && (
                  <span style={{ color: 'var(--text-muted)' }}>plan, son taramadaki bileşenlerden üretildi</span>
                )}
              </div>
            )}

            <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
              style={{ color: 'var(--status-info)', background: 'var(--status-info-bg)', borderColor: 'var(--status-info)' }}>
              <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{plan?.runnableNote || 'Bu ekran yalnızca uygulanacak komutları gösterir; hiçbir şey çalıştırmaz.'}</span>
            </div>

            {(plan?.warnings || []).map((w, i) => (
              <div key={i} className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
                style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
                <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}

            {err && (
              <div className="text-sm rounded-lg px-3 py-2 border"
                style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>
            )}

            {loading && !plan ? <LoadingLogo compact /> : (
              <ol className="space-y-2">
                {(plan?.steps || []).map((s) => <Step key={s.n} s={s} />)}
              </ol>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default PlanModal;
