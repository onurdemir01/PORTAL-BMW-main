// src/components/admin/tabs/logxv2/OcpRuntimeSettings.tsx — OCP playbook'larının çalışma
// zamanı ayarları: `oc` ikilisinin aranacağı yollar ve zaman aşımları.
//
// NEDEN VAR: playbook'ta oc yolu SABİT idi; sunucularda oc farklı bir konumda olduğu için
// tüm jump server'lar aynı anda düştü ve iş hiç sonuç üretemedi. Artık playbook oc'yi kendi
// keşfediyor; bu ekran o keşfin sırasını ve zaman aşımlarını deploy gerektirmeden değiştirir.
//
// Satır CRUD'u olmadığı için SimpleCrudTable uygun değil; yükle/kaydet
// desenini izleyen düz bir form.
import React, { useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  PlusIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { logxV2Api, type OcpRuntimeConfig } from '@/api/logxV2Api';
import { useToast } from '@/hooks/useToast';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const TIMEOUTS: { key: keyof OcpRuntimeConfig; label: string; help: string }[] = [
  {
    key: 'ocAsyncTimeout',
    label: 'Namespace keşfi (sn)',
    help: 'oc login + proje listeleme için üst sınır.',
  },
  {
    key: 'ocListTimeout',
    label: 'Pod listeleme (sn)',
    help: "Namespace içindeki pod'ların taranması.",
  },
  {
    key: 'ocLogTimeout',
    label: 'Log çekme (sn)',
    help: 'Pod loglarının indirilmesi — büyük loglarda artırın.',
  },
];

export default function OcpRuntimeSettings() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<OcpRuntimeConfig | null>(null);
  const [defaults, setDefaults] = useState<OcpRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await logxV2Api.admin.getOcpRuntimeConfig();
      setCfg(r.config);
      setDefaults(r.defaults);
    } catch (e) {
      setError((e as Error).message || 'Ayarlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }
  useAsyncEffect(async () => {
    await load();
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await logxV2Api.admin.saveOcpRuntimeConfig(cfg);
      setCfg(r.config); // sunucu normalize eder — geçersiz girdiler düzeltilmiş döner
      toast.success('OCP çalıştırma ayarları kaydedildi.');
    } catch (e) {
      toast.error((e as Error).message || 'Kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  function patch(p: Partial<OcpRuntimeConfig>) {
    setCfg((c) => (c ? { ...c, ...p } : c));
  }

  function moveCandidate(i: number, dir: -1 | 1) {
    if (!cfg) return;
    const list = [...cfg.ocBinaryCandidates];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ ocBinaryCandidates: list });
  }

  function addCandidate() {
    const v = newPath.trim();
    if (!v || !cfg) return;
    if (cfg.ocBinaryCandidates.includes(v)) {
      toast.error('Bu yol zaten listede.');
      return;
    }
    patch({ ocBinaryCandidates: [...cfg.ocBinaryCandidates, v] });
    setNewPath('');
  }

  if (loading) return <LoadingLogo compact />;
  if (error) return <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{error}</div>;
  if (!cfg) return null;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
        Playbook, <span className="font-mono">oc</span> komutunu her jump server'da{' '}
        <strong>kendisi arar</strong>: önce aşağıdaki yollar sırayla denenir, hiçbiri bulunamazsa
        sunucunun <span className="font-mono">PATH</span>'ine bakılır. Bu yüzden farklı sunucularda
        farklı kurulumlar sorun çıkarmaz.
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          Aranacak yollar (sırayla denenir)
        </label>
        <div className="space-y-1">
          {cfg.ocBinaryCandidates.map((p, i) => (
            <div
              key={p}
              className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-2.5 py-1.5"
            >
              <span className="text-xs text-[var(--text-muted)] w-4">{i + 1}.</span>
              <span className="flex-1 text-sm font-mono text-[var(--text-secondary)]">{p}</span>
              <button
                onClick={() => moveCandidate(i, -1)}
                disabled={i === 0}
                aria-label={`${p} yolunu yukarı taşı`}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 disabled:hover:text-[var(--text-muted)]"
              >
                <ArrowUpIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => moveCandidate(i, 1)}
                disabled={i === cfg.ocBinaryCandidates.length - 1}
                aria-label={`${p} yolunu aşağı taşı`}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 disabled:hover:text-[var(--text-muted)]"
              >
                <ArrowDownIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() =>
                  patch({ ocBinaryCandidates: cfg.ocBinaryCandidates.filter((x) => x !== p) })
                }
                aria-label={`${p} yolunu sil`}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--status-danger)]"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCandidate();
            }}
            placeholder="/usr/local/bin/oc"
            aria-label="Yeni oc yolu"
            className="flex-1 px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={addCandidate}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <PlusIcon className="w-3.5 h-3.5" /> Ekle
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Mutlak yol olmalı (ör. <span className="font-mono">/bin/oc</span>). Geçersiz girdiler
          kaydedilirken elenir.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          Kesin yol (opsiyonel)
        </label>
        <input
          value={cfg.ocBinary}
          onChange={(e) => patch({ ocBinary: e.target.value })}
          placeholder="boş = otomatik ara (önerilen)"
          className="w-full px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Doldurulursa <strong>ilk sırada denenir</strong> — sunucuda varsa otomatik aramanın önüne
          geçer. Bu yol o sunucuda bulunamazsa aşağıdaki adaylara düşülür (işlem yolsuzluktan dolayı
          durmaz). Yalnızca otomatik arama yanlış bir sürüm buluyorsa gerekir.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          OCP kullanıcı adı — genel varsayılan
        </label>
        <input
          value={cfg.defaultOcpUsername}
          onChange={(e) => patch({ defaultOcpUsername: e.target.value })}
          placeholder="uxmid"
          className="w-full px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
        />
        {/* Bu alan olmadığında playbook `username` değerini yalnızca AWX'teki
            openshift_inventory_vars.yaml dosyasından okuyabiliyordu; o dosya AWX'te
            bulunmadığı için 2026-08-09'da tüm cluster'lar düştü. */}
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Playbook'un <span className="font-mono">oc login --username</span> değeri.
          <strong> OCP Cluster Hiyerarşisi</strong> sekmesinde bir cluster'a özel değer girilmişse
          <strong> o kazanır</strong>; burası yalnızca boş bırakılan satırlar için geçerlidir. Boş
          bırakırsanız cluster satırında da değer yoksa o cluster keşifte anlaşılır bir hatayla
          elenir (diğerleri çalışmaya devam eder). PAROLA DEĞİLDİR.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TIMEOUTS.map(({ key, label, help }) => (
          <div key={key}>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">{label}</label>
            <input
              type="number"
              min={10}
              max={3600}
              value={cfg[key] as number}
              onChange={(e) =>
                patch({ [key]: Number(e.target.value) } as Partial<OcpRuntimeConfig>)
              }
              className="w-full px-2.5 py-1.5 text-sm border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">{help}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {defaults && (
          <button
            onClick={() => setCfg({ ...defaults })}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" /> Varsayılanlara dön
          </button>
        )}
      </div>
    </div>
  );
}
