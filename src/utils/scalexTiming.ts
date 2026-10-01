// ScaleX keşif SÜRE KIRILIMI — iş başına "40 sn nerede" cevabı.
//
// AWX 3365168/81/88 (2026-09-30): runner 3–8 sn sürerken iş 40+ sn sürüyordu ve
// fark loglardaki zaman damgalarından ELLE çıkarıldı (asıl kayıp SSH modül
// turlarıydı). Bu yardımcı aynı soruyu her iş için kendiliğinden cevaplar.
//
// Ölçüm satırları cluster başınadır; iş düzeyi paylar (kuyruk, açılış,
// hazırlık, taşıma, yayın, toplam) her satırda aynı tekrar eder. Runner payı
// cluster'ların EN UZUNU: cluster'lar aynı anda koşar.
import type { ScaleXDiscoveryTiming } from '@/api/scalexApi';

export interface ScaleXJobBreakdown {
  awxJobId: number;
  createdAt: string;
  clusters: number;
  queueMs: number | null;
  bootMs: number | null;
  prepMs: number | null;
  transportMs: number | null;
  /** Cluster'ların `elapsedMs` en büyüğü (runner'ın kendi ölçümü). */
  runnerMaxMs: number | null;
  publishMs: number | null;
  /**
   * Toplamdan ölçülen payların düşülmesiyle kalan (AWX olay yazımı, istatistik
   * yükleme). Paylardan biri ölçülmediyse `null` — eksik bir payı sıfır sayıp
   * "kalan"ı şişirmek yanlış yere bakmaya yollar.
   */
  restMs: number | null;
  jobMs: number | null;
}

export function jobBreakdowns(rows: ScaleXDiscoveryTiming[]): ScaleXJobBreakdown[] {
  const isler = new Map<number, ScaleXDiscoveryTiming[]>();
  for (const r of rows) {
    if (r.awxJobId === null || r.awxJobId === undefined) continue;
    const l = isler.get(r.awxJobId);
    if (l) l.push(r);
    else isler.set(r.awxJobId, [r]);
  }
  const out: ScaleXJobBreakdown[] = [];
  for (const [awxJobId, l] of isler) {
    const ilk = l[0];
    // Kırılım alanı hiç yoksa (eski playbook / eski satır) iş listelenmez.
    if (ilk.jobMs == null && ilk.transportMs == null && ilk.queueMs == null) continue;
    const runner = l
      .map((r) => r.elapsedMs)
      .filter((v): v is number => v !== null && v !== undefined);
    const paylar = [ilk.bootMs, ilk.prepMs, ilk.transportMs, ilk.publishMs];
    const tam = ilk.jobMs != null && paylar.every((v) => v != null);
    const rest = tam
      ? (ilk.jobMs as number) - paylar.reduce<number>((a, b) => a + (b as number), 0)
      : null;
    out.push({
      awxJobId,
      createdAt: ilk.createdAt,
      clusters: new Set(l.map((r) => r.clusterName)).size,
      queueMs: ilk.queueMs ?? null,
      bootMs: ilk.bootMs ?? null,
      prepMs: ilk.prepMs ?? null,
      transportMs: ilk.transportMs ?? null,
      runnerMaxMs: runner.length ? Math.max(...runner) : null,
      publishMs: ilk.publishMs ?? null,
      // Saat kayması negatif "kalan" üretebilir: göstermek yerine ölçülmedi.
      restMs: rest !== null && rest >= 0 ? rest : null,
      jobMs: ilk.jobMs ?? null,
    });
  }
  return out;
}
