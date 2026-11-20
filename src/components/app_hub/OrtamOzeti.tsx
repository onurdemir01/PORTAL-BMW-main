// src/components/app_hub/OrtamOzeti.tsx — Application Hub: ortam başına özet tablosu.
//
// Kullanıcı (2026-11-12): "Sunucu / JBoss Sürümü / JVM / Web sunucusu / Yük / Toplam kapasite kartları
// gözüme hoş gözükmüyor... JBoss sürümleri dip dibe yazılmış, kafa karıştırıyor. Hangi ortam hangi
// JBoss sürümünde vs ayrı ayrı gösterilebilir." Altı kart yerine ortam başına bir satır: sunucu
// sayısı, sürüm(ler) her biri ayrı rozet ve kaç sunucuda olduğu, Java, JVM çalışan / toplam, toplam
// kapasite. Satır seçimi sunucu tablosunu o ortama süzer.
import React from 'react';
import type { JbossRetirement, Kapasite } from '@/api/appHubApi';
import { fmtNumber } from '@/utils/datetime';
import { TD, TH, retireDurumu } from './ortak';

export interface OrtamSatiri {
  host: string;
  ortam: string | null;
  surum: string | null;
  java: string | null;
  jvmler: { calisiyor: boolean | null; retirement?: JbossRetirement | null }[];
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
  /** Kapalı ve Retirement ile STOP edilmiş / silinmiş (kapalı sayısına girmez, kırmızı değil). */
  retire: number;
  /** Retirement hedefi kapatılmış ama Server Hub STOP sonrası taramada çelişki kanıtladı (kırmızı; çalışan / kapalı sayımına da girer). */
  celiski: number;
  /** Retirement hedefi kapatılmış, JVM çalışıyor görünüyor, STOP sonrası doğrulanmadı (sarı; çalışan sayımına da girer). */
  dogrulama: number;
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
      m.set(o, {
        ortam: o,
        hostlar: new Set(),
        surumler: new Map(),
        javalar: new Set(),
        calisan: 0,
        kapali: 0,
        retire: 0,
        celiski: 0,
        dogrulama: 0,
        olculemedi: 0,
        cpu: 0,
        bellekGb: 0,
      });
    const g = m.get(o)!;
    g.hostlar.add(s.host);
    const surum = s.surum || '—';
    if (!g.surumler.has(surum)) g.surumler.set(surum, new Set());
    g.surumler.get(surum)!.add(s.host);
    if (s.java) g.javalar.add(s.java);
    for (const j of s.jvmler) {
      // Sunucu satiri ve JVM hapiyla AYNI kural (retireDurumu).
      const rd = retireDurumu(j);
      if (rd === 'celiski') g.celiski += 1;
      if (rd === 'dogrulama') g.dogrulama += 1;
      if (j.calisiyor === true) g.calisan += 1;
      else if (rd === 'retire') g.retire += 1;
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
  seciliSurum = '',
  onSurumSec,
}: {
  satirlar: OrtamSatiri[];
  surumBasligi: string;
  secili: string;
  onSec: (ortam: string) => void;
  /** Seçili sürüm (yalnız `secili` ortamında anlamlı); '' = sürüm süzgeci yok. Sürümsüz satır '—'. */
  seciliSurum?: string;
  /** Verilirse sürüm rozetleri tıklanır: (ortam, sürüm) — sürüm '' ise yalnız sürüm süzgeci kalkar. */
  onSurumSec?: (ortam: string, surum: string) => void;
  altBilgi?: React.ReactNode;
  /** WAS'ta çalışma durumu ölçülmüyor: JVM kolonu gösterilmez ("yok" sanılmasın). */
  jvmGoster?: boolean;
}) {
  const gruplar = ortamGruplari(satirlar);
  if (!gruplar.length) return null;
  const tumHost = new Set(satirlar.map((s) => s.host)).size;
  return (
    <section className="card p-0 overflow-hidden" data-testid="ortam-ozeti">
      <header
        className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h2
          className="text-[15px] font-semibold"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
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
              <th className={TH} title="Sunucuların toplam CPU / belleği; anlık kullanım değil">
                Kapasite
              </th>
            </tr>
          </thead>
          <tbody>
            {gruplar.map((g) => {
              const sec = secili === g.ortam;
              const toplamJvm = g.calisan + g.kapali + g.retire + g.olculemedi;
              // RETIREMENT (2026-11-16): retire edilmis kapali JVM kirmizi "kapali"ya girmez; ayri notr "N retire".
              const ekler: { k: string; n: number; metin: string; renk: string; title?: string }[] =
                [
                  { k: 'kapali', n: g.kapali, metin: 'kapalı', renk: 'var(--status-danger)' },
                  {
                    k: 'celiski',
                    n: g.celiski,
                    metin: 'Retirement çelişkisi',
                    renk: 'var(--status-danger)',
                    title:
                      'Retirement hedefi STOP edilmiş / silinmiş ama STOP sonrası Server Hub taraması aksini gösteriyor',
                  },
                  {
                    k: 'dogrulama',
                    n: g.dogrulama,
                    metin: 'doğrulama bekliyor',
                    renk: 'var(--status-warning-text)',
                    title:
                      "Retirement hedefi STOP edilmiş; JVM çalışıyor görünüyor ama tarama STOP'tan sonra değil",
                  },
                  {
                    k: 'retire',
                    n: g.retire,
                    metin: 'retire',
                    renk: 'var(--text-muted)',
                    title: 'Retirement ile STOP edilmiş / silinmiş JVM (beklenen kapanma)',
                  },
                  {
                    k: 'olculemedi',
                    n: g.olculemedi,
                    metin: 'ölçülemedi',
                    renk: 'var(--text-muted)',
                  },
                ].filter((e) => e.n > 0);
              return (
                <tr
                  key={g.ortam || 'bilinmiyor'}
                  onClick={() => onSec(sec ? '' : g.ortam)}
                  aria-selected={sec}
                  className="cursor-pointer hover:bg-[var(--bg-inset)]"
                  style={{
                    borderTop: '1px solid var(--border-subtle)',
                    background: sec ? 'var(--ah-hue-soft)' : undefined,
                  }}
                  title={sec ? 'Süzgeci kaldır' : 'Sunucu tablosunu bu ortama süz'}
                  data-testid="ortam-satiri"
                >
                  <td className={TD}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {g.ortam || 'Bilinmiyor'}
                    </span>
                  </td>
                  <td className={`${TD} tabular-nums`}>{fmtNumber(g.hostlar.size)}</td>
                  <td className={TD}>
                    <div className="flex flex-col gap-1">
                      {[...g.surumler.entries()]
                        .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
                        .map(([surum, hostlar]) => {
                          // SURUM SUZGECI (kullanici, 2026-11-16): surume tiklamak tabloyu o ortam + o surume suzer;
                          // ayni surume yeniden tiklamak surum suzgecini kaldirir (ortam kalir).
                          const surumSecili = sec && seciliSurum === surum;
                          const icerik = (
                            <>
                              <code
                                className="px-1.5 py-0.5 rounded"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  background: surumSecili
                                    ? 'var(--ah-hue-soft)'
                                    : 'var(--bg-inset)',
                                  border: `1px solid ${surumSecili ? 'var(--ah-hue)' : 'var(--border-subtle)'}`,
                                  color: 'var(--text-primary)',
                                  fontWeight: surumSecili ? 600 : 400,
                                }}
                              >
                                {surum}
                              </code>
                              {g.surumler.size > 1 && (
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {hostlar.size} sunucu
                                </span>
                              )}
                            </>
                          );
                          return onSurumSec ? (
                            <button
                              key={surum}
                              type="button"
                              aria-pressed={surumSecili}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSurumSec(g.ortam, surumSecili ? '' : surum);
                              }}
                              className="inline-flex items-center gap-1.5 text-[12px] self-start rounded hover:underline focus-visible:outline focus-visible:outline-2"
                              title={
                                surumSecili
                                  ? 'Sürüm süzgecini kaldır'
                                  : `Sunucu tablosunu ${g.ortam || 'Bilinmiyor'} · ${surum} sunucularına süz`
                              }
                              data-testid="surum"
                            >
                              {icerik}
                            </button>
                          ) : (
                            <span
                              key={surum}
                              className="inline-flex items-center gap-1.5 text-[12px]"
                              data-testid="surum"
                            >
                              {icerik}
                            </span>
                          );
                        })}
                    </div>
                  </td>
                  <td className={`${TD} text-[12px]`}>
                    {g.javalar.size ? (
                      [...g.javalar]
                        .sort((a, b) => a.localeCompare(b))
                        .map((j) => <div key={j}>{j}</div>)
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  {jvmGoster && (
                    <td className={`${TD} text-[12px] tabular-nums`}>
                      {toplamJvm ? (
                        <div className="space-y-0.5">
                          <div style={{ color: 'var(--text-primary)' }}>
                            {g.calisan} / {toplamJvm} çalışıyor
                          </div>
                          {ekler.length > 0 && (
                            <div>
                              {ekler.map((e, i) => (
                                <React.Fragment key={e.k}>
                                  {i > 0 && ' · '}
                                  <span
                                    style={{ color: e.renk }}
                                    title={e.title}
                                    data-testid={`ortam-${e.k}`}
                                  >
                                    {e.n} {e.metin}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Server Hub'da yok</span>
                      )}
                    </td>
                  )}
                  <td className={`${TD} text-[12px] tabular-nums`}>
                    {g.cpu || g.bellekGb ? (
                      `${fmtNumber(g.cpu)} vCPU · ${fmtNumber(Math.round(g.bellekGb * 10) / 10)} GB`
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
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
