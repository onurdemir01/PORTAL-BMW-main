// src/components/crypto_hub/PlanModal.tsx — Crypto Hub ön onay penceresi (2026-09-26).
//
// Kullanıcı: "installation/upgrade veya herhangi bir değişiklikte kullanıcıya uygulanacak
// komutları gösteren bir ön onay penceresi hazırlayalım — Metaco upgrade seçti, çalıştırılacak
// komutlar bu şekildedir vs."
//
// PENCERENİN SÖZLEŞMESİ:
//  * Komutlar SUNUCUDA üretilir (shared/cryptoHubActions.cjs), ekranda değil — aynı plan
//    yarın playbook'a girdi olacak; iki ayrı yerde yazılırsa ayrışır.
//  * YAZAN adımlar görsel olarak ayrılır. "Kaç komut kümeye dokunuyor" sorusu, onaydan önce
//    tek bakışta cevaplanabilmeli.
//  * Portal dışı adımlar (LinuxOne, Jenkins, iş birimi) gizlenmez — PLANIN PARÇASI olarak
//    durur, çünkü sırası önemli: Metaco'da LinuxOne podlardan ÖNCE açılır.
//  * Onay şimdilik KAPALI: yazan playbook bağlanana kadar bu ekran yalnızca gösterir.
import React, { useMemo, useState } from 'react';
import {
  ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon,
  CommandLineIcon, HandRaisedIcon, MagnifyingGlassIcon, PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { cryptoHubApi, type CryptoActionDef, type CryptoPlan, type CryptoPlanStep } from '@/api/cryptoHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { toast } from '@/hooks/useToast';

const KIND: Record<CryptoPlanStep['kind'], { label: string; color: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  command: { label: 'komut', color: 'var(--text-secondary)', Icon: CommandLineIcon },
  check: { label: 'kontrol', color: 'var(--status-info)', Icon: MagnifyingGlassIcon },
  manual: { label: 'Portal dışı', color: 'var(--status-warning)', Icon: HandRaisedIcon },
};

function CopyButton({ text, label = 'Kopyala' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border"
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
      className="rounded-lg border px-3 py-2 space-y-1.5"
      style={{
        borderColor: s.writes ? 'var(--status-danger)' : 'var(--border-subtle)',
        background: s.writes ? 'var(--status-danger-bg)' : 'var(--bg-surface)',
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="tabular-nums text-[11px] font-semibold w-5 shrink-0" style={{ color: 'var(--text-muted)' }}>{s.n}</span>
        <k.Icon className="h-4 w-4 shrink-0" style={{ color: k.color }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
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
          className="text-[11px] leading-relaxed rounded-md px-2.5 py-2 overflow-x-auto"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >{s.command}</pre>
      )}

      {s.note && <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.note}</div>}
      {s.source && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>kaynak: {s.source}</div>}
    </li>
  );
}

export function PlanModal({ tenantKey, tenantLabel, action, onClose }: {
  tenantKey: string;
  tenantLabel: string;
  action: CryptoActionDef;
  onClose: () => void;
}) {
  const needsVersion = action.params.some((p) => p.key === 'version');
  const [version, setVersion] = useState('');
  const [plan, setPlan] = useState<CryptoPlan | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useAsyncEffect(async (alive) => {
    setLoading(true); setErr('');
    try {
      const r = await cryptoHubApi.plan(tenantKey, action.key, version);
      if (!alive()) return;
      if (!r.ok || !r.plan) { setErr(r.message || 'Plan üretilemedi.'); setPlan(null); return; }
      setPlan(r.plan);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); } finally { if (alive()) setLoading(false); }
  }, [tenantKey, action.key, reload]);

  const tumKomutlar = useMemo(
    () => (plan?.steps || []).filter((s) => s.command).map((s) => `# ${s.n}. ${s.title}\n${s.command}`).join('\n\n'),
    [plan],
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      dismissOnBackdrop={false}
      title={`${action.label} — ön onay`}
      subtitle={`${tenantLabel} · uygulanacak adımlar`}
      footer={(
        <div className="flex items-center gap-2 flex-wrap w-full">
          {/* ONAY ŞİMDİLİK KAPALI: yazan playbook yok. Butonu "aktif ama hiçbir şey yapmıyor"
              göstermek, onaya basıldı sanılmasına yol açardı. */}
          <button
            type="button"
            disabled
            title={plan?.runnableNote}
            className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-lg border opacity-50 cursor-not-allowed"
            style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
          >
            Onayla ve çalıştır
          </button>
          {tumKomutlar && <CopyButton text={tumKomutlar} label="Tüm komutları kopyala" />}
          <span className="flex-1" />
          <button
            type="button"
            className="h-8 px-3 text-xs font-medium rounded-lg border"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        {needsVersion && (
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Hedef sürüm
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={action.params.find((p) => p.key === 'version')?.placeholder || ''}
                className="block mt-1 h-8 px-2 text-sm rounded-lg border w-44"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
            </label>
            <button
              type="button"
              className="h-8 px-3 text-xs font-medium rounded-lg border"
              style={{ borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
              onClick={() => setReload((n) => n + 1)}
            >
              Planı güncelle
            </button>
          </div>
        )}

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
              <span style={{ color: 'var(--text-muted)' }}>plan, {plan.scannedAt} taramasındaki bileşenlerden üretildi</span>
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
      </div>
    </Modal>
  );
}

export default PlanModal;
