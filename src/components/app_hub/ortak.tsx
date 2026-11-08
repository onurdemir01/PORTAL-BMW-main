// src/components/app_hub/ortak.tsx — Uygulama Hub ortak parçaları: bölüm çerçevesi, JVM
// parametre görüntüleyici, kapasite hücresi, kaynak notu, durum hapı.
import React, { useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import type { Kapasite, KaynakDurumu } from '@/api/appHubApi';
import { fmtNumber } from '@/utils/datetime';

export const TIP_AD: Record<string, string> = { jboss: 'JBoss', was: 'WebSphere', ocp: 'OpenShift' };

export function TipHap({ tip }: { tip: string }) {
  const renk = tip === 'ocp' ? 'var(--status-danger)' : tip === 'was' ? 'var(--status-info)' : 'var(--ah-hue)';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ color: renk, border: `1px solid ${renk}`, background: 'var(--bg-surface)' }}
    >
      {TIP_AD[tip] || tip}
    </span>
  );
}

export function Hap({ ton, children, title }: { ton: 'iyi' | 'uyari' | 'kritik' | 'notr' | 'bilgi'; children: React.ReactNode; title?: string }) {
  const t = {
    iyi: { fg: 'var(--status-success)', bg: 'var(--status-success-bg)' },
    uyari: { fg: 'var(--status-warning-text)', bg: 'var(--status-warning-bg)' },
    kritik: { fg: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
    notr: { fg: 'var(--status-neutral)', bg: 'var(--status-neutral-bg)' },
    bilgi: { fg: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  }[ton];
  return (
    <span title={title} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ color: t.fg, background: t.bg, border: `1px solid ${t.fg}` }}>
      {children}
    </span>
  );
}

export function CalismaHap({ calisiyor }: { calisiyor: boolean | null | undefined }) {
  if (calisiyor === true) return <Hap ton="iyi">Çalışıyor</Hap>;
  if (calisiyor === false) return <Hap ton="kritik">Kapalı</Hap>;
  return <Hap ton="notr" title="Server Hub taramasında çalışma durumu ölçülemedi">Ölçülemedi</Hap>;
}

export function Bolum({ baslik, aciklama, sag, children }: { baslik: string; aciklama?: React.ReactNode; sag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{baslik}</h2>
          {aciklama && <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{aciklama}</p>}
        </div>
        {sag && <div className="flex items-center gap-2">{sag}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

/** Kaynak okunamadıysa bölümün başında açık uyarı: "yok" ile "okunamadı" ayrı. */
export function KaynakUyarisi({ kaynaklar, adlar }: { kaynaklar: Record<string, KaynakDurumu>; adlar: Record<string, string> }) {
  const hatali = Object.entries(kaynaklar || {}).filter(([, v]) => v && v.hata);
  if (!hatali.length) return null;
  return (
    <div className="rounded px-3 py-2 text-[12px] space-y-1" role="alert" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)', border: '1px solid var(--status-warning)' }}>
      {hatali.map(([k, v]) => (
        <div key={k} className="flex items-start gap-1.5">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{adlar[k] || k} okunamadı.</strong> Bu bölümdeki boşluk "yok" anlamına gelmez. <span className="opacity-80">({String(v.hata).slice(0, 200)})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function KapasiteHucresi({ k }: { k: Kapasite | null }) {
  if (!k) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div className="leading-tight tabular-nums text-[12px]">
      <div style={{ color: 'var(--text-primary)' }}>
        {k.cpu != null ? `${k.cpu} vCPU` : '? vCPU'} · {k.bellekGb != null ? `${fmtNumber(k.bellekGb)} GB` : '? GB'}
      </div>
      {(k.os || k.osSurum) && (
        <div style={{ color: 'var(--text-muted)' }}>
          {[k.os, k.osSurum].filter(Boolean).join(' ')}
        </div>
      )}
    </div>
  );
}

// ── JVM parametreleri ─────────────────────────────────────────────────────────

type Grup = 'Bellek' | 'GC' | 'Sistem özellikleri' | 'Ajan / tanılama' | 'Diğer';
const GRUP_SIRA: Grup[] = ['Bellek', 'GC', 'Sistem özellikleri', 'Ajan / tanılama', 'Diğer'];

export function argGrubu(tok: string): Grup {
  if (/^-X(ms|mx|ss|mn)/.test(tok) || /^-XX:[+-]?(Max|Initial|Min)?(RAM|Metaspace|MetaspaceSize|HeapSize|NewSize|DirectMemorySize|RAMPercentage|PermSize|MaxPermSize)/i.test(tok) || /^-XX:(Max|Initial|Min)RAMPercentage/.test(tok)) return 'Bellek';
  if (/^-XX:[+-]?Use\w*GC|^-XX:[+-]?(G1|CMS|Parallel|ZGC|Shenandoah|GC|MaxGCPause|InitiatingHeap|ParallelGCThreads|ConcGCThreads)|^-Xlog:gc|^-verbose:gc/i.test(tok)) return 'GC';
  if (tok.startsWith('-D')) return 'Sistem özellikleri';
  if (/^-javaagent|^-agentlib|^-agentpath|^-XX:[+-]?HeapDump|^-XX:HeapDumpPath|^-XX:ErrorFile|^-XX:[+-]?FlightRecorder|^-XX:StartFlightRecording/i.test(tok)) return 'Ajan / tanılama';
  return 'Diğer';
}

export function argBol(s: string | null | undefined): string[] {
  return String(s || '')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function Kopyala({ metin }: { metin: string }) {
  const [tamam, setTamam] = useState(false);
  return (
    <button
      type="button"
      className="pf-btn-link text-[12px] inline-flex items-center gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(metin);
          setTamam(true);
          setTimeout(() => setTamam(false), 1500);
        } catch {
          /* pano izni yoksa sessiz */
        }
      }}
    >
      {tamam ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
      {tamam ? 'Kopyalandı' : 'Kopyala'}
    </button>
  );
}

/**
 * Maskeli JVM argümanlarını gruplayarak gösterir. Değer "***" ise maskelendiği yazılır.
 * `bosMetin`: argüman yoksa ne söyleneceği (ölçülmedi ile toplanmadı farklıdır).
 */
export function JvmArglari({ args, bosMetin, baslik }: { args: string | null | undefined; bosMetin: React.ReactNode; baslik?: string }) {
  const tok = argBol(args);
  if (!tok.length) {
    return (
      <p className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <InformationCircleIcon className="w-4 h-4 flex-shrink-0" /> {bosMetin}
      </p>
    );
  }
  const gruplar = new Map<Grup, string[]>();
  for (const t of tok) {
    const g = argGrubu(t);
    if (!gruplar.has(g)) gruplar.set(g, []);
    gruplar.get(g)!.push(t);
  }
  const maskeli = tok.filter((t) => t.includes('***')).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {baslik && <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{baslik}</span>}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {tok.length} parametre{maskeli ? ` · ${maskeli} değer maskelendi` : ''}
        </span>
        <Kopyala metin={tok.join(' ')} />
      </div>
      {GRUP_SIRA.filter((g) => gruplar.has(g)).map((g) => (
        <div key={g} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 items-start">
          <span className="text-[11px] uppercase tracking-wide pt-1" style={{ color: 'var(--text-muted)' }}>{g}</span>
          <div className="flex flex-wrap gap-1">
            {gruplar.get(g)!.map((t, i) => (
              <code
                key={`${t}-${i}`}
                title={t.includes('***') ? 'Değer gizli bilgi taşıyabileceği için maskelendi' : undefined}
                className="px-1.5 py-0.5 rounded text-[11.5px] break-all"
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-inset)',
                  color: t.includes('***') ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {t}
              </code>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Sayi({ v, birim }: { v: number | null | undefined; birim?: string }) {
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span className="tabular-nums">
      {fmtNumber(v)}
      {birim ? ` ${birim}` : ''}
    </span>
  );
}

export function OzetKutusu({ etiket, deger, alt }: { etiket: string; deger: React.ReactNode; alt?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3 min-w-0">
      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{etiket}</div>
      <div className="mt-1 truncate" title={typeof deger === 'string' ? deger : undefined} style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)' }}>
        {deger}
      </div>
      {alt && <div className="mt-0.5 text-[11px] truncate" title={typeof alt === 'string' ? alt : undefined} style={{ color: 'var(--text-muted)' }}>{alt}</div>}
    </div>
  );
}

export const TH = 'px-3 py-2 text-left text-[12px] font-semibold whitespace-nowrap';
export const TD = 'px-3 py-2 align-top text-[13px]';
