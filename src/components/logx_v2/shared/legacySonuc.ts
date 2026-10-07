// src/components/logx_v2/shared/legacySonuc.ts — LogX Legacy playbook sonuçlarından
// "ne alınamadı ve neden" özetini çıkarır (saf fonksiyonlar).
//
// NEDEN VAR (2026-10-07): playbook'lar sunucu ve dosya başına sebep yayınlıyor ama ekran
// bunları yalnızca KISMİ KEŞİFTE gösteriyordu. Üç durumda sebepler ekrana hiç ulaşmıyordu:
//   1. Keşif TÜM sunucularda başarısız  -> yalnızca "Tüm sunucularda keşif başarısız oldu."
//   2. Aktarım başarısız                -> yalnızca "Transfer başarısız oldu."
//   3. Aktarım KISMİ (arşiv üretildi ama bazı dosyalar ya da sunucular içinde yok)
//                                       -> HİÇBİR ŞEY; kullanıcı arşivi tam sanıyordu.
//
// Okunan biçimler GERÇEK playbook çıktılarıdır; örnekleri
// `__tests__/fixtures/legacy-sonuc-ornekleri.json` içinde durur ve
// `server/ansible/__tests__/logx-legacy-gercek-kosum.test.cjs` (LG5) her birini gerçek
// koşumla karşılaştırır. Aktarım sonucu ÜÇ biçimde gelir:
//   - tek sunucu, arşiv var : üst düzey `per_file_status[]`
//   - tek sunucu, arşiv yok : `hosts[{host, status, error}]` (dosya sebepleri metnin içinde)
//   - çok sunucu            : `hosts[{host, status, error, per_file_status[]}]` + üst düzey `error`

export interface SunucuSorunu {
  host: string;
  durum: 'unreachable' | 'error';
  /** Playbook'un yayınladığı ham sebep (boş olabilir). */
  sebep: string;
  /** Bu sunucudan istenip alınamayan dosya sayısı (bilinmiyorsa 0). */
  dosyaSayisi: number;
}

export interface DosyaSorunu {
  host: string;
  path: string;
  sebep: string;
}

export interface LegacySorunlar {
  /** Sunucudan bağımsız genel sebep (ör. parçalar birleştirilemedi). */
  genel: string;
  /** Hiç dosya alınamayan / taranamayan sunucular. */
  sunucular: SunucuSorunu[];
  /** Sunucusu başarılı olduğu halde arşive girmeyen dosyalar. */
  dosyalar: DosyaSorunu[];
  /** İstenen ve arşive giren dosya sayısı; sonuç dosya dökümü taşımıyorsa null. */
  istenen: number | null;
  alinan: number | null;
}

type Nesne = Record<string, unknown>;

const nesneMi = (v: unknown): v is Nesne => !!v && typeof v === 'object' && !Array.isArray(v);
const nesneler = (v: unknown): Nesne[] => (Array.isArray(v) ? v.filter(nesneMi) : []);
const metin = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const durumu = (h: Nesne): SunucuSorunu['durum'] =>
  metin(h.status) === 'unreachable' ? 'unreachable' : 'error';

/** Keşif sonucunda taranamayan sunucular (durumu `ok` olmayan her sunucu). */
export function kesifSorunlari(sonuc: unknown): LegacySorunlar {
  const s = nesneMi(sonuc) ? sonuc : {};
  const sunucular = nesneler(s.hosts)
    .filter((h) => metin(h.status) !== 'ok')
    .map((h) => ({
      host: metin(h.host) || '(adsız sunucu)',
      durum: durumu(h),
      sebep: metin(h.error),
      dosyaSayisi: 0,
    }));
  return { genel: '', sunucular, dosyalar: [], istenen: null, alinan: null };
}

/** Aktarım sonucunda arşive girmeyen sunucular ve dosyalar. */
export function aktarimSorunlari(sonuc: unknown): LegacySorunlar {
  const s = nesneMi(sonuc) ? sonuc : {};
  const sunucular: SunucuSorunu[] = [];
  const dosyalar: DosyaSorunu[] = [];
  let istenen = 0;
  let alinan = 0;
  let dokumVar = false;

  // Tek sunucu, arşiv var: dosya dökümü üst düzeyde.
  for (const f of nesneler(s.per_file_status)) {
    dokumVar = true;
    istenen += 1;
    if (metin(f.status) === 'ok') alinan += 1;
    else dosyalar.push({ host: metin(f.host), path: metin(f.path), sebep: metin(f.error) });
  }

  for (const h of nesneler(s.hosts)) {
    const host = metin(h.host) || '(adsız sunucu)';
    const dokum = nesneler(h.per_file_status);
    const tamam = metin(h.status) === 'ok';
    if (!tamam) {
      // Sunucunun dosyaları tek tek SAYILMAZ: hiçbiri alınamadı, sebep sunucu satırındadır.
      sunucular.push({
        host,
        durum: durumu(h),
        sebep: metin(h.error),
        dosyaSayisi: dokum.length,
      });
    }
    for (const f of dokum) {
      dokumVar = true;
      istenen += 1;
      if (!tamam) continue;
      if (metin(f.status) === 'ok') alinan += 1;
      else dosyalar.push({ host, path: metin(f.path), sebep: metin(f.error) });
    }
  }

  return {
    genel: metin(s.error),
    sunucular,
    dosyalar,
    istenen: dokumVar ? istenen : null,
    alinan: dokumVar ? alinan : null,
  };
}

export function sorunVar(s: LegacySorunlar | null | undefined): s is LegacySorunlar {
  return !!s && (!!s.genel || s.sunucular.length > 0 || s.dosyalar.length > 0);
}

/**
 * Eksik arşivin tek satırlık özeti. Sayılar ek almadan yazılır ("3'ü", "2'si" gibi
 * çekimler sayıya göre değişir; yanlış ek yerine düz döküm).
 */
export function eksikOzeti(s: LegacySorunlar): string {
  if (s.istenen === null || s.alinan === null) {
    return 'Arşiv eksik: bazı sunucu ya da dosyalar alınamadı.';
  }
  return `Arşiv eksik — seçilen dosya: ${s.istenen}, arşive giren: ${s.alinan}, alınamayan: ${s.istenen - s.alinan}.`;
}
