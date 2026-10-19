// src/components/denetim/yukPencere.ts — "istek yok ama 7 gün ölçülemedi" metni (2026-10-02).
//
// ÜÇ EKRAN AYNI METNİ KULLANIR: Denetim > Nginx SPA (DenetimPage TrafficBadge), Nginx ARK SPA
// Raporu (ArkSpaRaporuPage YukHucre) ve Production Taşımaları (NginxProdMigration). Kural
// sunucuda TEK yerde (server/audit/nginx-migration.cjs spaTrafikDurumu); burası onun `kismi`
// nedenlerini insan diline çevirir.
//
// NEDEN VAR: günlük rotasyonlu sunucularda (logrotate 'rotate 3') okunan log 1-4 gün kalıyor.
// Eskiden bu 0 istek "yük almıyor / atıl aday / emekli adayı" görünüyordu; oysa 7 günün
// tamamına bakılmadı. Durum artık 'unknown' ve etiket ölçülen süreyi söylüyor:
// "son 3 günde istek yok (7 gün ölçülemedi)".

import type { SpaYukOlcumu } from '@/api/denetimApi';

type YukOlcumu = SpaYukOlcumu;

/** 'son 3 günde istek yok' / 'son 5 saatte istek yok' / 'bugünkü kayıtta istek yok'.
 *  Aşağı yuvarlanır: pencere bir ALT SINIRDIR, "3 günde yok" en az 3 gün bakıldı demek. */
export function pencereIstekYok(saat: number): string {
  if (saat >= 24) return `son ${Math.floor(saat / 24)} günde istek yok`;
  if (saat >= 1) return `son ${Math.floor(saat)} saatte istek yok`;
  return 'bugünkü kayıtta istek yok';
}

/** 'son 3 günü' / 'son 5 saati' / 'yalnız tarama gününü' (ipucu cümlesi için). */
export function pencereSuresi(saat: number): string {
  if (saat >= 24) return `son ${Math.floor(saat / 24)} günü`;
  if (saat >= 1) return `son ${Math.floor(saat)} saati`;
  return 'yalnız tarama gününü';
}

/**
 * Ölçüldü ama "yük almıyor" denemeyen durumun KISA etiketi. Yalnız state 'unknown' ve en az
 * bir sunucu okunmuşken (hosts > 0) dolu döner; log hiç okunamadıysa null (çağıran kendi
 * "log okunamadı" metnini yazar).
 */
export function kismiEtiket(t: YukOlcumu): string | null {
  if (t.state !== 'unknown' || !t.hosts) return null;
  const k = t.kismi || [];
  if (k.includes('pencere') && t.pencereSaat != null)
    return `${pencereIstekYok(t.pencereSaat)} (7 gün ölçülemedi)`;
  if (k.includes('pencere-bilinmiyor')) return 'istek yok (ölçülen süre bilinmiyor)';
  if (k.includes('sampled')) return 'istek yok (7 günün tamamı okunamadı)';
  const eksik = (t.unknownHosts || 0) + (t.missingHosts || 0);
  if (eksik) return `istek yok (${eksik} sunucu ölçülemedi)`;
  return 'kısmi ölçüm';
}

/**
 * Production Taşımaları: uygulamanın yollarından (eski sunucudaki location'lar) tek yük özeti.
 * Bir yol bile yük alıyorsa o yol (aktif). Hiçbiri almıyorsa ve HİÇ ölçülmemiş bir yol varsa
 * (traffic null — tablo var ama o yolun sunucusundan o gün satır yok) sonuç 'unknown'
 * ('satirsiz-sunucu'): öteki yollar 7 gün ölçülmüş 0 olsa da "yük almıyor" DENMEZ (2026-10-02
 * doğrulama bulgusu; eskiden null yol atılıyor, uygulama "yük almıyor" bandına düşüyordu).
 * Sunucudaki karşılığı: server/audit/nginx-migration.cjs spaTrafikBirlesik. Hiç ölçüm yoksa null.
 */
export function yolYukOzeti(
  paths: { traffic: YukOlcumu | null; hosts?: string[] }[],
): YukOlcumu | null {
  const olcumler = paths.map((p) => p.traffic).filter((t): t is YukOlcumu => !!t);
  if (!olcumler.length) return null;
  const aktif = olcumler.find((t) => t.state === 'active');
  if (aktif) return aktif;
  const secilen = olcumler.find((t) => t.state === 'unknown') || olcumler[0];
  const olculmeyen = paths.filter((p) => !p.traffic);
  if (!olculmeyen.length) return secilen;
  return {
    ...secilen,
    state: 'unknown',
    missingHosts:
      (secilen.missingHosts || 0) +
      olculmeyen.reduce((a, p) => a + Math.max(1, p.hosts ? p.hosts.length : 0), 0),
    kismi: [...new Set([...(secilen.kismi || []), 'satirsiz-sunucu' as const])],
  };
}

/** Uzun açıklama (ipucu): her neden ayrı cümle, hepsi "yük almıyor DENMEZ" ile biter. */
export function kismiAciklama(t: YukOlcumu): string {
  const k = t.kismi || [];
  const c: string[] = [];
  if (k.includes('pencere') && t.pencereSaat != null)
    c.push(
      `Okunan access log ${pencereSuresi(t.pencereSaat)} kapsıyor (tarama günü 00:00'dan geriye ${t.pencereSaat} saat) ve bu sürede sağlık kontrolü dışında istek görülmedi. Sunucudaki log saklama süresi 7 günden kısa olabilir (günlük rotasyon).`,
    );
  if (k.includes('pencere-bilinmiyor'))
    c.push('Ölçülen sürenin başı bu taramada yok (eski tarama sürümü): kaç gün bakıldığı bilinmiyor.');
  if (k.includes('sampled'))
    c.push('Log dosyasının tamamı okunamadı (okuma bütçesi bitti ya da eski bir log dosyası açılamadı); okunan bölüm 7 günü kapsamıyor.');
  if (k.includes('okunamayan-sunucu'))
    c.push(`${t.unknownHosts || 'Bir'} sunucuda access log okunamadı; oraya gelen istek bilinmiyor.`);
  if (k.includes('satirsiz-sunucu'))
    c.push(`${t.missingHosts || 'Bir'} sunucuda bu tanımın o günkü ölçüm satırı yok (tarama zaman aşımı ya da trafik adımı kapalı).`);
  if (!c.length) c.push('Ölçüm 7 günün tamamını ve tanımın her sunucusunu kapsamıyor.');
  c.push('7 günün tamamı ölçülemediği için “yük almıyor” DENMEZ.');
  return c.join(' ');
}
