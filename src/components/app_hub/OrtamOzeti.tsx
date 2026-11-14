// src/components/app_hub/OrtamOzeti.tsx — Application Hub: ortam başına özet tablosu.
//
// Kullanıcı (2026-11-12): "Sunucu / JBoss Sürümü / JVM / Web sunucusu / Yük / Toplam kapasite kartları
// gözüme hoş gözükmüyor... JBoss sürümleri dip dibe yazılmış, kafa karıştırıyor. Hangi ortam hangi
// JBoss sürümünde vs ayrı ayrı gösterilebilir." Altı kart yerine ortam başına bir satır: sunucu
// sayısı, sürüm(ler) her biri ayrı rozet ve kaç sunucuda olduğu, Java, JVM çalışan / toplam, toplam
// kapasite. Satır seçimi sunucu tablosunu o ortama süzer.
import React from 'react';
import type { Kapasite } from '@/api/appHubApi';
import { fmtNumber } from '@/utils/datetime';
import { TD, TH } from './ortak';

export interface OrtamSatiri {
  host: string;
  ortam: string | null;
  surum: string | null;
  java: string | null;
  jvmler: { calisiyor: boolean | null }[];
  kapasite: Kapasite | null;
}

const ORTAM_SIRA = ['PROD', 'PRP', 'PREPROD', 'UAT', 'QA', 'TEST', 'DEV', 'EDU'];
const BILINMIYOR = '';

function ortamSirasi(a: string, b: string) {
  const ia = ORTAM_SIRA.indexOf(a.toUpperCase());
  const ib = ORTAM_SIRA.indexOf(b.toUpperCase());
  if (a === BILINMIYOR) return 1;
  if (b === BILINMIYOR) return -1;
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** Aynı anahtar birden çok kez geçerse sona #2, #3 eklenir: React anahtarı ve açık/kapalı durumu benzersiz. */
export function satirAnahtarlari(anahtarlar: string[]): string[] {
  const say = new Map<string, number>();
  return anahtarlar.map((k) => {
    const n = (say.get(k) || 0) + 1;
    say.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  });
}

interface Grup {
  ortam: string;
  hostlar: Set<string>;
  surumler: Map<string, Set<string>>;
  javalar: Set<string>;
  calisan: number;
  kapali: number;
  olculemedi: number;
  cpu: number;
  bellekGb: number;
}

export function ortamGruplari(satirlar: OrtamSatiri[]): Grup[] {
  const m = new Map<string, Grup>();
  const kapasiteSayildi = new Set<string>();
  for (const s of satirlar) {
    const o = s.ortam || BILINMIYOR;
    if (!m.has(o))
      m.set(o, { ortam: o, hostlar: new Set(), surumler: new Map(), javalar: new Set(), calisan: 0, kapali: 0, olculemedi: 0, cpu: 0, bellekGb: 0 });
    const g = m.get(o)!;
    g.hostlar.add(s.host);
    const surum = s.surum || '—';
    if (!g.surumler.has(surum)) g.surumler.set(surum, new Set());
    g.surumler.get(surum)!.add(s.host);
    if (s.java) g.javalar.add(s.java);
    for (const j of s.jvmler) {
      if (j.calisiyor === true) g.calisan += 1;
      else if (j.calisiyor === false) g.kapali += 1;
      else g.olculemedi += 1;
    }
    // Ayni sunucu (birden cok satir) kapasiteye bir kez girer.
    const kk = `${o}|${s.host}`;
    if (s.kapasite && !kapasiteSayildi.has(kk)) {
      kapasiteSayildi.add(kk);
      g.cpu += s.kapasite.cpu || 0;
      g.bellekGb += s.kapasite.bellekGb || 0;
    }
  }
  return [...m.values()].sort((a, b) => ortamSirasi(a.ortam, b.ortam));
}

export function OrtamOzeti({
  satirlar,
  surumBasligi,
  secili,
  onSec,
  altBilgi,
  jvmGoster = true,
}: {
  satirlar: OrtamSatiri[];
  surumBasligi: string;
  secili: string;
  onSec: (ortam: string) => void;
  altBilgi?: React.ReactNode;
  /** WAS'ta çalışma durumu ölçülmüyor: JVM kolonu gösterilmez ("yok" sanılmasın). */
  jvmGoster?: boolean;
}) {
  const gruplar = ortamGruplari(satirlar);
  if (!gruplar.length) return null;
  const tumHost = new Set(satirlar.map((s) => s.host)).size;
  return (
    <section className="card p-0 overflow-hidden" data-testid="ortam-ozeti">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          Ortamlar
        </h2>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {fmtNumber(tumHost)} sunucu · {gruplar.length} ortam{altBilgi ? <> · {altBilgi}</> : null}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }}>
              <th className={TH}>Ortam</th>
              <th className={TH}>Sunucu</th>
              <th className={TH}>{surumBasligi}</th>
              <th className={TH}>Java</th>
              {jvmGoster && <th className={TH}>JVM</th>}
              <th className={TH} title="Sunucuların toplam CPU / belleği; anlık kullanım değil">Kapasite</th>
            </tr>
          </thead>
          <tbody>
            {gruplar.map((g) => {
              const sec = secili === g.ortam;
              const toplamJvm = g.calisan + g.kapali + g.olculemedi;
              return (
                <tr
                  key={g.ortam || 'bilinmiyor'}
                  onClick={() => onSec(sec ? '' : g.ortam)}
                  aria-selected={sec}
                  className="cursor-pointer hover:bg-[var(--bg-inset)]"
                  style={{ borderTop: '1px solid var(--border-subtle)', background: sec ? 'var(--ah-hue-soft)' : undefined }}
                  title={sec ? 'Süzgeci kaldır' : 'Sunucu tablosunu bu ortama süz'}
                  data-testid="ortam-satiri"
                >
                  <td className={TD}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{g.ortam || 'Bilinmiyor'}</span>
                  </td>
                  <td className={`${TD} tabular-nums`}>{fmtNumber(g.hostlar.size)}</td>
                  <td className={TD}>
                    <div className="flex flex-col gap-1">
                      {[...g.surumler.entries()]
                        .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
                        .map(([surum, hostlar]) => (
                          <span key={surum} className="inline-flex items-center gap-1.5 text-[12px]" data-testid="surum">
                            <code className="px-1.5 py-0.5 rounded" style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                              {surum}
                            </code>
                            {g.surumler.size > 1 && (
                              <span style={{ color: 'var(--text-muted)' }}>{hostlar.size} sunucu</span>
                            )}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className={`${TD} text-[12px]`}>
                    {g.javalar.size ? [...g.javalar].sort((a, b) => a.localeCompare(b)).map((j) => <div key={j}>{j}</div>) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  {jvmGoster && (
                  <td className={`${TD} text-[12px] tabular-nums`}>
                    {toplamJvm ? (
                      <div className="space-y-0.5">
                        <div style={{ color: 'var(--text-primary)' }}>
                          {g.calisan} / {toplamJvm} çalışıyor
                        </div>
                        {(g.kapali > 0 || g.olculemedi > 0) && (
                          <div>
                            {g.kapali > 0 && <span style={{ color: 'var(--status-danger)' }}>{g.kapali} kapalı</span>}
                            {g.kapali > 0 && g.olculemedi > 0 && ' · '}
                            {g.olculemedi > 0 && <span style={{ color: 'var(--text-muted)' }}>{g.olculemedi} ölçülemedi</span>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Server Hub'da yok</span>
                    )}
                  </td>
                  )}
                  <td className={`${TD} text-[12px] tabular-nums`}>
                    {g.cpu || g.bellekGb ? `${fmtNumber(g.cpu)} vCPU · ${fmtNumber(Math.round(g.bellekGb * 10) / 10)} GB` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
