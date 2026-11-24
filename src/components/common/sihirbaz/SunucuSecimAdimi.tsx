// src/components/common/sihirbaz/SunucuSecimAdimi.tsx — Telnet ve FileX sihirbazlarinin ORTAK sunucu secimi
// (2026-11-24; iki kopyaydi): secilen uygulamanin bulundugu sunucular arasindan coklu secim, ortama gore
// gruplu. Bu ekran bir kolaylik katmanidir, guvenlik siniri degil: sunucu, secilen host'larin gercekten o
// uygulamaya ait oldugunu yine dogrular (anti-TOCTOU, server/telnet ve server/filex).
//
// SATIR KIMLIGI (host, majör) CIFTIDIR: envanter ayni host icin hem JBoss 7 hem JBoss 8 satiri dondurebilir;
// kimlik yalniz host adiyken iki satir tek onay kutusunu paylasiyor, birine tiklamak ikisini seciyordu. Her
// satir JBoss rozetiyle gelir (src/utils/jboss.ts). SUNUCUYA YINE YALNIZ HOST ADI GIDER: bu modullerin
// playbook'lari majörü almaz (extra_vars'ta yok); secim gonderilirken adlar tekillestirilir. OpsX'in sunucu
// adimi ayridir: orada kimlik kurulum dizinidir ve secilen majörler de gonderilir.
import React, { useMemo, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import type { JbossSunucu } from './tipler';
import { hostKey, majorOfHost, normalizeJbossVersion, parseHostKey } from '@/utils/jboss';
import JbossTag from '@/components/common/JbossTag';

const SunucuSecimAdimi: React.FC<{
  app: string;
  jbossVersions: string[];
  busy?: boolean;
  onSubmit: (hosts: string[]) => void;
  /** Modulun sunucu listesi ucu (getHosts). */
  sunuculariGetir: (app: string) => Promise<{ hosts?: JbossSunucu[] }>;
  /** Kullaniciya sorulan soru (modulun isi). */
  soru: string;
}> = ({ app, jbossVersions, busy, onSubmit, sunuculariGetir, soru }) => {
  const [hosts, setHosts] = useState<JbossSunucu[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAsyncEffect(
    async (alive) => {
      setLoading(true);
      setError(null);
      try {
        const r = await sunuculariGetir(app);
        if (alive()) setHosts(r.hosts ?? []);
      } catch (err) {
        if (alive()) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [app],
  );

  // Onceki adimda secilen MAJÖR surumlere gore suzulur (tam surum degil; bkz. JbossSurumAdimi).
  const filteredHosts = useMemo(() => {
    const wanted = new Set(jbossVersions);
    return hosts.filter((h) => wanted.has(majorOfHost(h)));
  }, [hosts, jbossVersions]);

  const grouped = useMemo(() => {
    const g: Record<string, JbossSunucu[]> = {};
    for (const h of filteredHosts) {
      const key = h.env || '(ortam belirtilmemiş)';
      (g[key] ||= []).push(h);
    }
    return g;
  }, [filteredHosts]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Sunucuya BENZERSIZ host adlari gider (bkz. dosya basi): ayni host'un iki kurulumu da isaretliyse tek ad.
  const selectedHostNames = useMemo(
    () => [...new Set([...selected].map((k) => parseHostKey(k).host))],
    [selected],
  );

  function toggleAllIn(envKey: string) {
    const keys = grouped[envKey].map((h) => hostKey(h.host, majorOfHost(h)));
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  if (loading)
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)]">
        Sunucular yükleniyor...
      </div>
    );
  if (error)
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
        {error}
      </div>
    );

  if (filteredHosts.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>{app}</strong> için seçilen JBoss sürümünde (
          {jbossVersions.map((v) => (v ? `JBoss ${v}` : 'Bilinmiyor')).join(', ')}) sunucu
          bulunamadı.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">{soru}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
        </p>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {Object.keys(grouped)
          .sort((a, b) => a.localeCompare(b))
          .map((envKey) => (
            <div key={envKey}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">{envKey}</label>
                <button
                  onClick={() => toggleAllIn(envKey)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {grouped[envKey].every((h) => selected.has(hostKey(h.host, majorOfHost(h))))
                    ? 'Seçimi kaldır'
                    : 'Tümünü seç'}
                </button>
              </div>
              <div className="space-y-1 border border-[var(--border)] rounded-xl p-1.5">
                {grouped[envKey].map((h) => {
                  const major = majorOfHost(h);
                  const key = hostKey(h.host, major);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggle(key)}
                        className="rounded"
                      />
                      <span className="text-sm text-[var(--text-primary)] font-mono flex-1">
                        {h.host}
                      </span>
                      <JbossTag major={major} version={normalizeJbossVersion(h.jbossVersion)} />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">
          {selectedHostNames.length} sunucu seçildi
          {selectedHostNames.length !== selected.size && (
            <> · {selected.size} kurulum (aynı sunucunun iki JBoss sürümü)</>
          )}
        </span>
        <button
          onClick={() => onSubmit(selectedHostNames)}
          disabled={selectedHostNames.length === 0 || busy}
          className="btn-primary"
        >
          Devam Et
        </button>
      </div>
    </div>
  );
};

export default SunucuSecimAdimi;
