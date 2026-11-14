// src/components/server_hub/KodRehberi.tsx — Bulgular sayfasının kod rehberi (2026-11-11).
//
// Kullanıcı: "Kurallar listesini ince, güzel, şık bir UI/UX ile karşımıza çıkan sayfaya da işler misin?
// Bakmak isteyen insanlar hangi kod neydi diye Kurallar ve Limitler sayfasına geçip durmasın."
// Sağdan açılan bir panel: bulgu kodları alana göre gruplu, okunur ad + ne zaman çıkar + geçerli seviye
// + bu listedeki sayı. Koda tıklayınca Bulgular o koda süzülür. Retirement etiket kuralları (R1–R12)
// bulgu DEĞİLDİR; altta ayrı, katlanır bir bölümde ve nerede kullanıldıklarıyla durur.
// Veri: GET /api/server-hub/kurallar (Kurallar & Limitler ile aynı tek kaynak); panel ilk açılışta indirir.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { serverHubApi, type ShKurallar, type ShSeverity } from '@/api/serverHubApi';
import { fmtNumber } from '@/utils/datetime';
import { SeviyeRozeti, SEVIYE } from './KurallarTab';

const SIRA: Record<ShSeverity, number> = { danger: 0, warning: 1, info: 2, ok: 3 };

interface Props {
  acik: boolean;
  onKapat: () => void;
  /** Kodun okunur adı (Bulgular'daki KOD_ETIKET). */
  ad: (kod: string) => string;
  /** Şu anki listede kod başına bulgu sayısı. */
  listede: Map<string, number>;
  seciliKod: string;
  onSec: (kod: string) => void;
}

export default function KodRehberi({ acik, onKapat, ad, listede, seciliKod, onSec }: Props) {
  const [veri, setVeri] = useState<ShKurallar | null>(null);
  const [hata, setHata] = useState('');
  const [ara, setAra] = useState('');
  const [yalnizListede, setYalnizListede] = useState(true);
  const kapatRef = useRef<HTMLButtonElement>(null);

  const panelRef = useRef<HTMLElement>(null);
  const kapatFn = useRef(onKapat);
  useEffect(() => {
    kapatFn.current = onKapat;
  }, [onKapat]);
  // Odak yalniz ACILISTA kapat dugmesine gider; kapaninca acan dugmeye doner. Tab panel icinde doner.
  useEffect(() => {
    if (!acik) return;
    const onceki = document.activeElement as HTMLElement | null;
    kapatRef.current?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') kapatFn.current();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const odak = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, summary, [tabindex]:not([tabindex="-1"])');
      if (!odak.length) return;
      const ilk = odak[0];
      const son = odak[odak.length - 1];
      if (e.shiftKey && document.activeElement === ilk) {
        e.preventDefault();
        son.focus();
      } else if (!e.shiftKey && document.activeElement === son) {
        e.preventDefault();
        ilk.focus();
      }
    };
    window.addEventListener('keydown', tus);
    return () => {
      window.removeEventListener('keydown', tus);
      onceki?.focus?.();
    };
  }, [acik]);

  useEffect(() => {
    if (!acik || veri) return;
    let canli = true;
    serverHubApi
      .kurallar(false)
      .then((r) => {
        if (!canli) return;
        if (r.ok) {
          setVeri(r);
          setHata('');
        }
        else setHata(r.message || 'Kurallar okunamadı.');
      })
      .catch((e: unknown) => canli && setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      canli = false;
    };
  }, [acik, veri]);

  const gruplar = useMemo(() => {
    if (!veri) return [];
    const n = ara.trim().toLocaleLowerCase('tr');
    const m = new Map<string, { alanAd: string; kodlar: { kod: string; kosul: string; gecerli: ShSeverity; varsayilan: ShSeverity; madde: string }[] }>();
    for (const md of veri.maddeler) {
      for (const c of md.ciktilar) {
        if (!c.kod) continue;
        if (yalnizListede && !listede.has(c.kod)) continue;
        const metin = `${c.kod} ${ad(c.kod)} ${c.kosul} ${md.ad}`.toLocaleLowerCase('tr');
        if (n && !metin.includes(n)) continue;
        const g = m.get(md.alan) || { alanAd: md.alanAd || md.alan, kodlar: [] };
        g.kodlar.push({ kod: c.kod, kosul: c.kosul, gecerli: c.gecerli, varsayilan: c.varsayilan, madde: md.ad });
        m.set(md.alan, g);
      }
    }
    return [...m.values()]
      .map((g) => ({ ...g, kodlar: g.kodlar.sort((a, b) => SIRA[a.gecerli] - SIRA[b.gecerli] || ad(a.kod).localeCompare(ad(b.kod), 'tr')) }))
      .sort((a, b) => a.alanAd.localeCompare(b.alanAd, 'tr'));
  }, [veri, ara, yalnizListede, listede, ad]);
  const kodSayisi = gruplar.reduce((t, g) => t + g.kodlar.length, 0);

  if (!acik) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={(e) => e.target === e.currentTarget && onKapat()} style={{ background: 'color-mix(in srgb, var(--bg-base, #000) 35%, transparent)' }}>
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kod-rehberi-baslik"
        className="h-full w-full max-w-[440px] flex flex-col shadow-2xl border-l"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <header className="px-4 pt-4 pb-3 border-b space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-start gap-2">
            <BookOpenIcon className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="flex-1 min-w-0">
              <h2 id="kod-rehberi-baslik" className="text-sm font-semibold">Kod rehberi</h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Her bulgu kodunun anlamı ve şu anki seviyesi. Bir koda tıklayınca liste o koda süzülür.
              </p>
            </div>
            <button
              ref={kapatRef}
              type="button"
              onClick={onKapat}
              aria-label="Kod rehberini kapat"
              className="p-1 rounded-md focus-visible:outline focus-visible:outline-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={ara}
              onChange={(e) => setAra(e.target.value)}
              placeholder="kod ya da anlam ara"
              aria-label="Kod rehberinde ara"
              className="w-full h-8 pl-8 pr-2 text-xs border rounded-lg"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]" role="radiogroup" aria-label="Hangi kodlar">
            {(
              [
                [true, 'Bu listedekiler'],
                [false, 'Tüm kodlar'],
              ] as const
            ).map(([v, etiket]) => (
              <button
                key={etiket}
                type="button"
                role="radio"
                aria-checked={yalnizListede === v}
                onClick={() => setYalnizListede(v)}
                className="px-2.5 py-1 rounded-full border"
                style={{
                  borderColor: yalnizListede === v ? 'var(--accent)' : 'var(--border-subtle)',
                  color: yalnizListede === v ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: yalnizListede === v ? 'var(--bg-elevated)' : 'transparent',
                }}
              >
                {etiket}
              </button>
            ))}
            {veri && (
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {fmtNumber(kodSayisi)} kod
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {!veri && !hata && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kurallar yükleniyor…</p>}
          {hata && (
            <p className="text-xs" role="alert" style={{ color: 'var(--status-danger)' }}>
              Kurallar okunamadı: {hata}
            </p>
          )}
          {veri && !kodSayisi && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {ara ? 'Aramayla eşleşen kod yok.' : 'Bu listede bulgu kodu yok.'}
            </p>
          )}
          {gruplar.map((g) => (
            <section key={g.alanAd} aria-label={g.alanAd}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                {g.alanAd}
              </h3>
              <ul className="space-y-1">
                {g.kodlar.map((k) => {
                  const sec = seciliKod === k.kod;
                  const n = listede.get(k.kod) || 0;
                  return (
                    <li key={k.kod}>
                      <button
                        type="button"
                        onClick={() => onSec(sec ? 'all' : k.kod)}
                        aria-pressed={sec}
                        disabled={!n && !sec}
                        title={!n && !sec ? 'Şu anki süzgeçlerle bu kodda bulgu yok' : undefined}
                        className="w-full text-left rounded-lg border px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2"
                        style={{
                          borderColor: sec ? 'var(--accent)' : 'var(--border-subtle)',
                          background: sec ? 'var(--bg-elevated)' : 'transparent',
                          opacity: !n && !sec ? 0.6 : 1,
                          cursor: !n && !sec ? 'default' : 'pointer',
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium leading-snug">{ad(k.kod)}</div>
                            <div className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                              {k.kosul}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <SeviyeRozeti s={k.gecerli} kucuk />
                              {k.gecerli !== k.varsayilan && (
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  varsayılan {SEVIYE[k.varsayilan].etiket}
                                </span>
                              )}
                              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {k.kod}
                              </span>
                            </div>
                          </div>
                          {n > 0 && (
                            <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }} title="bu listedeki bulgu sayısı">
                              {fmtNumber(n)}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {veri?.etiketKurallari && veri.etiketKurallari.length > 0 && (
            <details className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <summary className="cursor-pointer text-[12px] font-medium">
                R1–R{veri.etiketKurallari.length} kodları nedir?
              </summary>
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>
                Bunlar bulgu değil, <b>retirement etiket kuralları</b>: “bu uygulama emekli edilebilir mi” sorusunu
                işaretler. Bulgular listesinde çıkmazlar; Retirement Analizi › Retirement etiketleri listesinde ve
                sunucu panelinde görünürler.
              </p>
              <ul className="mt-2 space-y-1">
                {veri.etiketKurallari.map((r) => (
                  <li key={r.kural} className="text-[11px] flex gap-2">
                    <span className="font-mono w-8 shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {r.kural}
                    </span>
                    <span className="flex-1">{r.ad}</span>
                    <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {r.gecerli === 'KESIN' ? 'kesin' : r.gecerli === 'SUPHELI' ? 'şüpheli' : 'kapalı'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <footer className="px-4 py-2 border-t text-[10px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
          Seviyeler Kurallar &amp; Limitler sekmesinden değiştirilir.
        </footer>
      </aside>
    </div>
  );
}
