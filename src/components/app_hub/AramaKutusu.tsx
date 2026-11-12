// src/components/app_hub/AramaKutusu.tsx — Uygulama adıyla JBoss / WebSphere / OpenShift araması.
// Application Hub sayfası ve Dashboard (ana karşılama) aynı kutuyu kullanır.
import React, { useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { appHubApi, type AppAramaSonucu, type AppTip } from '@/api/appHubApi';
import { TipHap, TIP_AD } from './ortak';

export default function AramaKutusu({ ilk, onSec, buyuk }: { ilk: string; onSec: (s: AppAramaSonucu) => void; buyuk: boolean }) {
  const [q, setQ] = useState(ilk);
  const [sonuclar, setSonuclar] = useState<AppAramaSonucu[]>([]);
  const [okunamayan, setOkunamayan] = useState<{ tip: AppTip; hata: string }[]>([]);
  const [acik, setAcik] = useState(false);
  const [ariyor, setAriyor] = useState(false);
  const [vurgu, setVurgu] = useState(0);
  const istekNo = useRef(0);
  const kutu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return undefined;
    const no = ++istekNo.current;
    const zam = setTimeout(async () => {
      setAriyor(true);
      try {
        const r = await appHubApi.ara(t);
        if (no !== istekNo.current) return;
        setSonuclar(r.sonuclar || []);
        setOkunamayan(r.okunamayan || []);
        setVurgu(0);
      } catch {
        if (no === istekNo.current) setSonuclar([]);
      } finally {
        if (no === istekNo.current) setAriyor(false);
      }
    }, 250);
    return () => clearTimeout(zam);
  }, [q]);

  useEffect(() => {
    const kapat = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener('mousedown', kapat);
    return () => document.removeEventListener('mousedown', kapat);
  }, []);

  const gorunen = q.trim().length >= 2 ? sonuclar : [];
  const sec = (s: AppAramaSonucu) => {
    setAcik(false);
    setQ(s.ad);
    onSec(s);
  };

  return (
    <div ref={kutu} className={`relative w-full ${buyuk ? 'max-w-2xl mx-auto' : 'max-w-xl'}`}>
      <MagnifyingGlassIcon className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${buyuk ? 'w-6 h-6' : 'w-5 h-5'}`} style={{ color: 'var(--text-muted)' }} />
      <input
        type="search"
        role="combobox"
        aria-expanded={acik && gorunen.length > 0}
        aria-controls="apphub-sonuclar"
        aria-label="Uygulama adı"
        autoFocus={buyuk}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAcik(true);
        }}
        onFocus={() => setAcik(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setVurgu((v) => Math.min(v + 1, gorunen.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setVurgu((v) => Math.max(v - 1, 0));
          } else if (e.key === 'Enter' && gorunen[vurgu]) {
            e.preventDefault();
            sec(gorunen[vurgu]);
          } else if (e.key === 'Escape') setAcik(false);
        }}
        placeholder="Uygulama adını yazın (ör. GFYINTERNETBRANCH, musteri-api)"
        className={`w-full rounded-full border outline-none transition-shadow focus:ring-2 ${buyuk ? 'pl-14 pr-5 py-4 text-[17px]' : 'pl-11 pr-4 py-2.5 text-[14px]'}`}
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)', boxShadow: buyuk ? 'var(--shadow-md)' : undefined }}
      />
      {acik && q.trim().length >= 2 && (
        <div
          id="apphub-sonuclar"
          role="listbox"
          className="absolute z-30 mt-2 w-full rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
        >
          {ariyor && !gorunen.length && <div className="px-4 py-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>Aranıyor…</div>}
          {!ariyor && !gorunen.length && <div className="px-4 py-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>Bu adla JBoss, WebSphere ya da OpenShift uygulaması bulunamadı.</div>}
          <ul className="max-h-[22rem] overflow-y-auto">
            {gorunen.map((s, i) => (
              <li key={`${s.tip}-${s.ad}`} role="option" aria-selected={i === vurgu}>
                <button
                  type="button"
                  onMouseEnter={() => setVurgu(i)}
                  onClick={() => sec(s)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
                  style={{ background: i === vurgu ? 'var(--ah-hue-soft)' : 'transparent' }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[14px]" title={s.ad} style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{s.ad}</span>
                    {s.varyantlar && s.varyantlar.length > 1 && (
                      <span className="block truncate text-[11px]" title={s.varyantlar.join(', ')} style={{ color: 'var(--text-muted)' }}>{s.varyantlar.join(', ')}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{s.ozet}</span>
                    <TipHap tip={s.tip} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {okunamayan.length > 0 && (
            <div className="px-4 py-2 text-[12px] flex items-center gap-1.5" style={{ color: 'var(--status-warning-text)', borderTop: '1px solid var(--border-subtle)' }}>
              <ExclamationTriangleIcon className="w-4 h-4" /> {okunamayan.map((o) => TIP_AD[o.tip]).join(', ')} envanteri okunamadı; sonuçlar eksik olabilir.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
