// src/components/server_hub/earEnvanter.ts — Uygulama Envanteri ekranının saf yardımcıları (2026-11-04).
//
// DURUM DİLİ (kabul ölçütü): eksik ya da ölçülemeyen hiçbir şey YEŞİL görünmez. Yeşil ("iyi") yalnız
// TAM / TAMAMLANDI / AYNI'dır; kısmi tarama sarı, sonuç yok / okunamadı kırmızı, karşılaştırılamayan
// eşlenik nötr. Renkler tasarım belirteçlerinden (koyu temada da okunur).
import type { EarAgacSatiri, EarParti } from '@/api/earEnvanterApi';

export type Ton = 'iyi' | 'uyari' | 'kotu' | 'bilgi' | 'notr';
export const TON: Record<Ton, { renk: string; zemin: string; metin: string }> = {
  iyi: {
    renk: 'var(--status-success)',
    zemin: 'var(--status-success-bg)',
    metin: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
  },
  uyari: {
    renk: 'var(--status-warning)',
    zemin: 'var(--status-warning-bg)',
    metin: 'var(--status-warning-text)',
  },
  kotu: {
    renk: 'var(--status-danger)',
    zemin: 'var(--status-danger-bg)',
    metin: 'var(--status-danger-text)',
  },
  bilgi: {
    renk: 'var(--status-info)',
    zemin: 'var(--status-info-bg)',
    metin: 'var(--status-info)',
  },
  notr: { renk: 'var(--text-muted)', zemin: 'var(--bg-elevated)', metin: 'var(--text-secondary)' },
};

export interface DurumBilgisi {
  etiket: string;
  ton: Ton;
  aciklama: string;
}

const bilinmeyen = (d: string | null | undefined): DurumBilgisi => ({
  etiket: d ? d.toLowerCase() : '—',
  ton: 'notr',
  aciklama: d ? `Bilinmeyen durum: ${d}` : 'Durum yok.',
});

const UYGULAMA: Record<string, DurumBilgisi> = {
  TAM: { etiket: 'tam', ton: 'iyi', aciklama: 'Tarama eksiksiz.' },
  KISMI_SINIR: {
    etiket: 'kısmi · sınır',
    ton: 'uyari',
    aciklama: 'Giriş sınırına takıldı; liste eksik.',
  },
  KISMI_ZAMAN: {
    etiket: 'kısmi · süre',
    ton: 'uyari',
    aciklama: 'Süre bütçesi doldu; liste eksik.',
  },
  KISMI_IZIN: { etiket: 'kısmi · izin', ton: 'uyari', aciklama: 'Bazı dizinler okunamadı (izin).' },
  ARSIV_ACILMADI: {
    etiket: 'arşiv açılmadı',
    ton: 'uyari',
    aciklama: 'Paketli arşivin içindeki WAR listelenmedi (ÖZET kip ya da boyut sınırı).',
  },
  ATLANDI_ZAMAN: {
    etiket: 'atlandı · süre',
    ton: 'uyari',
    aciklama: 'Süre bitmeden sırası gelmedi; taranmadı.',
  },
  HATA: { etiket: 'hata', ton: 'kotu', aciklama: 'Tarayıcı bu uygulamada hata verdi.' },
};

const HOST: Record<string, DurumBilgisi> = {
  TAM: { etiket: 'tam', ton: 'iyi', aciklama: 'Sunucudaki tüm uygulamalar eksiksiz tarandı.' },
  KISMI: {
    etiket: 'kısmi',
    ton: 'uyari',
    aciklama: 'En az bir uygulama eksik tarandı ya da uyarı var.',
  },
  KOK_YOK: { etiket: 'kök yok', ton: 'bilgi', aciklama: 'Sunucuda /vhosting ve /vhosting8 yok.' },
  ZAMAN_ASIMI: {
    etiket: 'zaman aşımı',
    ton: 'uyari',
    aciklama: 'Tarama süresi doldu; sonuç eksik.',
  },
  PYTHON_YOK: {
    etiket: 'python yok',
    ton: 'kotu',
    aciklama: 'python3 / platform-python bulunamadı.',
  },
  KIMLIK_GECISI_YOK: {
    etiket: 'kimlik geçişi yok',
    ton: 'kotu',
    aciklama: 'dzdo ile okuma kimliğine geçilemedi.',
  },
  ULASILAMADI: { etiket: 'ulaşılamadı', ton: 'kotu', aciklama: 'AWX sunucuya bağlanamadı.' },
  YAZILAMADI: { etiket: 'yazılamadı', ton: 'kotu', aciklama: "Sonuç /sw'ye yazılamadı." },
  HATA: { etiket: 'hata', ton: 'kotu', aciklama: 'Tarama hata verdi.' },
  SONUC_YOK: { etiket: 'sonuç yok', ton: 'kotu', aciklama: 'Bu sunucudan sonuç gelmedi.' },
  OKUNAMADI: { etiket: 'okunamadı', ton: 'kotu', aciklama: 'Sonuç dosyası okunamadı ya da bozuk.' },
};

const KOSU: Record<string, DurumBilgisi> = {
  CALISIYOR: { etiket: 'çalışıyor', ton: 'bilgi', aciklama: 'Partiler sırayla taranıyor.' },
  TAMAMLANDI: {
    etiket: 'tamamlandı',
    ton: 'iyi',
    aciklama: 'Her sunucu tam tarandı (ya da kökü yok).',
  },
  KISMI: {
    etiket: 'kısmi',
    ton: 'uyari',
    aciklama: 'Bazı sunucular eksik tarandı ya da sonuç vermedi.',
  },
  BASARISIZ: { etiket: 'başarısız', ton: 'kotu', aciklama: 'Hiçbir sunucudan veri gelmedi.' },
  IPTAL: { etiket: 'iptal', ton: 'notr', aciklama: 'Koşu iptal edildi; gelen sonuçlar saklandı.' },
};

const KARAR: Record<string, DurumBilgisi> = {
  AYNI: { etiket: 'aynı', ton: 'iyi', aciklama: 'Yapı ve kütüphaneler bütün kopyalarda aynı.' },
  FARKLI_KUTUPHANE: {
    etiket: 'kütüphane farklı',
    ton: 'kotu',
    aciklama: 'En az bir kopyada jar ya da sürüm farklı.',
  },
  FARKLI_YAPI: {
    etiket: 'yapı farklı',
    ton: 'uyari',
    aciklama: 'Kütüphaneler aynı, dosya yapısı farklı.',
  },
  EKSIK_TARAMA: {
    etiket: 'karşılaştırılamadı',
    ton: 'uyari',
    aciklama: 'Kopyalardan biri tam taranmadı; eksik veri "aynı" sayılmaz.',
  },
  KARSILASTIRILAMAZ: {
    etiket: 'kip farklı',
    ton: 'notr',
    aciklama: 'Kopyalar farklı kipte tarandı (ÖZET / TAM).',
  },
  TEK: { etiket: 'tek kopya', ton: 'notr', aciklama: 'Bu ortam ve nesilde tek sunucuda.' },
};

const PARTI: Record<string, DurumBilgisi> = {
  BEKLIYOR: { etiket: 'bekliyor', ton: 'notr', aciklama: 'Sırası gelmedi.' },
  CALISIYOR: { etiket: 'AWX’te', ton: 'bilgi', aciklama: 'AWX işi çalışıyor.' },
  ALINIYOR: { etiket: 'alınıyor', ton: 'bilgi', aciklama: 'Sonuçlar DB’ye alınıyor.' },
  BITTI: { etiket: 'bitti', ton: 'iyi', aciklama: 'Sonuçlar alındı.' },
  HATA: { etiket: 'hata', ton: 'kotu', aciklama: 'Başlatılamadı ya da sonuçlar alınamadı.' },
  IPTAL: { etiket: 'iptal', ton: 'notr', aciklama: 'Koşu iptal edildi ya da durdu.' },
};

export const uygulamaDurumu = (d: string | null | undefined) => (d && UYGULAMA[d]) || bilinmeyen(d);
export const hostDurumu = (d: string | null | undefined) => (d && HOST[d]) || bilinmeyen(d);
export const kosuDurumu = (d: string | null | undefined) => (d && KOSU[d]) || bilinmeyen(d);
export const kararDurumu = (d: string | null | undefined) => (d && KARAR[d]) || bilinmeyen(d);
export const partiDurumu = (d: string | null | undefined) => (d && PARTI[d]) || bilinmeyen(d);

/** Testler için: her tablodaki bütün durumlar. */
export const DURUM_TABLOLARI = { UYGULAMA, HOST, KOSU, KARAR, PARTI };

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Elle girilen sunucu listesi: satır / boşluk / virgül / noktalı virgül ayraçlı; tekil, BÜYÜK harf. */
export function hostListesiAyristir(metin: string): { hostlar: string[]; gecersiz: string[] } {
  const parcalar = String(metin || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const tekil = [...new Set(parcalar)];
  return {
    hostlar: tekil.filter((h) => HOST_RE.test(h)),
    gecersiz: tekil.filter((h) => !HOST_RE.test(h)),
  };
}

/** Kısa parmak izi gösterimi. */
export const kisaIz = (s: string | null | undefined) => (s ? String(s).trim().slice(0, 8) : '—');

/** Verinin yaşı (gün, tam sayı); tarih yoksa null. */
export function veriYasiGun(
  utc: string | null | undefined,
  simdi: number = Date.now(),
): number | null {
  if (!utc) return null;
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((simdi - t) / 86400000)) : null;
}

export function boyutMetni(b: number | string | null | undefined): string {
  const n = Number(b);
  if (b === '' || b == null || !Number.isFinite(n)) return '—';
  const birim = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < birim.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${birim[i]}`;
}

/** Ağaç satırlarını yol parçasına göre süzer (büyük/küçük harf duyarsız). */
export function agacSuz(satirlar: EarAgacSatiri[], q: string): EarAgacSatiri[] {
  const t = String(q || '')
    .trim()
    .toLowerCase();
  if (!t) return satirlar;
  return satirlar.filter((s) => String(s[0]).toLowerCase().includes(t));
}

/** Parti ilerlemesi: bitmiş (BITTI / HATA / IPTAL), çalışan, toplam; host bazında. */
export function partiIlerleme(partiler: EarParti[]): {
  bitenHost: number;
  toplamHost: number;
  calisan: EarParti | null;
} {
  let biten = 0;
  let toplam = 0;
  let calisan: EarParti | null = null;
  for (const p of partiler || []) {
    toplam += p.host_sayisi || 0;
    if (['BITTI', 'HATA', 'IPTAL'].includes(p.durum)) biten += p.host_sayisi || 0;
    if (p.durum === 'CALISIYOR' || p.durum === 'ALINIYOR') calisan = p;
  }
  return { bitenHost: biten, toplamHost: toplam, calisan };
}
