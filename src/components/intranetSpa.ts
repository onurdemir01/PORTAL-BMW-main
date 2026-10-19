// src/components/intranetSpa.ts — Nginx ARK SPA > Intranet SPA: saf yardımcılar (süzgeç, etiket, CSV).
// Sayfa: IntranetSpaPage.tsx. Hesap sunucuda (server/spa-report/intranet.cjs); burada gösterim.
import type { IntranetDegerlendirme, IntranetSatir, IntranetSunucu } from '@/api/arkSpaApi';
import { kismiEtiket, pencereIstekYok } from '@/components/denetim/yukPencere';
import type { Tone } from '@/components/denetim/ui';

export const BEYAN_ETIKET: Record<string, string> = {
  yes: 'kullanıyor',
  no: 'kullanmıyor',
  unknown: 'bilmiyor',
};

export const DEGERLENDIRME: Record<IntranetDegerlendirme, { label: string; tone: Tone; hint: string }> = {
  'kapatma-adayi': {
    label: 'kapatma adayı',
    tone: 'danger',
    hint: 'Ölçümde 7 günün tamamında ve her sunucuda istek yok, ekip de “kullanmıyor” dedi.',
  },
  'teyit-bekliyor': {
    label: 'yük yok — ekip teyidi bekleniyor',
    tone: 'warning',
    hint: 'Ölçümde istek yok; ekip henüz beyan girmedi.',
  },
  celiski: {
    label: 'çelişki',
    tone: 'warning',
    hint: 'Ölçümde istek var ama ekip “kullanmıyor” dedi. Kim kullanıyor, bakılmalı.',
  },
  'ocp-yok': {
    label: 'OpenShift envanterinde yok',
    tone: 'neutral',
    hint: 'Uygulama OpenShift envanterinde bulunamadı — kaldırılmış olabilir.',
  },
  sunulmuyor: {
    label: 'nginx sunmuyor',
    tone: 'neutral',
    hint: 'Hiçbir sunucuda application-confs dosyası yok: dizin duruyor ama nginx bu uygulamayı sunmuyor.',
  },
  'kurulum-eksik': {
    label: 'kurulum eksik',
    tone: 'neutral',
    hint: 'Ortamın taranan sunucularının bazısında uygulama yok ya da yarım kurulmuş.',
  },
};

const DURUM_ETIKET: Record<string, string> = {
  OK: 'tam',
  MISSING_CONF: 'conf yok — sunulmuyor',
  MISSING_APP: 'uygulama dosyaları yok',
  MISSING_HYS: 'paket dizini yok',
  ONLY_HYS: 'yarım kurulum (yalnız paket)',
  ONLY_APP: 'yarım kurulum (yalnız dosyalar)',
  ONLY_CONF: 'yarım kurulum (yalnız conf)',
};
export const durumEtiketi = (s: string) => DURUM_ETIKET[s] || s || 'bilinmiyor';

/** Sunucu başına ölçümün kısa metni. "Ölçülemedi" sebebiyle yazılır; hiçbiri "0 istek" DEĞİL. */
export function sunucuYukMetni(s: IntranetSunucu): string {
  const t = s.trafik;
  if (!s.conf) return '—';
  if (!t) return 'ölçüm yok';
  if (t.durum === 'var') return `7g ${t.req7 ?? 0} · 24s ${t.req24 ?? 0}`;
  if (t.durum === 'sifir') return 'istek yok (7 gün)';
  if (t.durum === 'sifir-kismi') {
    const k = t.kismi || [];
    if (k.includes('pencere') && t.pencereSa != null) return `${pencereIstekYok(t.pencereSa)} (7 gün ölçülemedi)`;
    if (k.includes('pencere')) return 'istek yok (ölçülen süre bilinmiyor)';
    if (k.includes('eslesmeyen-host')) return 'istek yok (sunucuda sahipsiz istek var)';
    return 'istek yok (kısmi ölçüm)';
  }
  switch (t.neden) {
    case 'log':
      return `log okunamadı${t.hata ? `: ${t.hata}` : ''}`;
    case 'satir-yok':
      return 'bu uygulama için ölçüm satırı yok';
    case 'host':
      return 'sunucu ölçülmedi';
    case 'host-kipi-yok':
      return 'sunucuda uygulama bazlı ölçüm yok';
    case 'belirsiz':
      return 'conf adı iki uygulamaya düşüyor — ayrılamıyor';
    default:
      return 'ölçüm tablosu okunamadı';
  }
}

export type YukSuzgec = 'all' | 'active' | 'idle' | 'unknown' | 'none';
export type BeyanSuzgec = 'all' | 'bekleyen' | 'verilmis' | 'yes' | 'no' | 'unknown';
export type DegSuzgec = 'all' | IntranetDegerlendirme;

export const yukDurumu = (r: IntranetSatir): Exclude<YukSuzgec, 'all'> => (r.yuk ? r.yuk.state : 'none');

/** Yük hücresinin kısa metni (ekran + CSV aynı). */
export function yukMetni(r: IntranetSatir): string {
  const t = r.yuk;
  if (!t) return 'ölçüm yok';
  if (t.state === 'active') return `yük alıyor · 7g ${t.req7 ?? 0}`;
  if (t.state === 'idle') return 'yük almıyor';
  return kismiEtiket(t) || 'ölçülemedi';
}

export function suzIntranet(
  rows: readonly IntranetSatir[],
  f: { env: string; yuk: YukSuzgec; beyan: BeyanSuzgec; deg: DegSuzgec; ekip: string; q: string },
): IntranetSatir[] {
  const ara = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.env !== 'all' && r.env !== f.env) return false;
    if (f.yuk !== 'all' && yukDurumu(r) !== f.yuk) return false;
    if (f.beyan === 'bekleyen' && r.inUse) return false;
    if (f.beyan === 'verilmis' && !r.inUse) return false;
    if ((f.beyan === 'yes' || f.beyan === 'no' || f.beyan === 'unknown') && r.inUse !== f.beyan) return false;
    if (f.deg !== 'all' && !r.degerlendirme.includes(f.deg)) return false;
    if (f.ekip !== 'all') {
      if (f.ekip === '-') {
        if (r.ekip.length) return false;
      } else if (!r.ekip.includes(f.ekip)) return false;
    }
    if (!ara) return true;
    return [r.application, r.namespace, r.note, ...r.ekip, ...r.sunucular.map((s) => s.host)]
      .join(' ')
      .toLowerCase()
      .includes(ara);
  });
}

export const INTRANET_CSV_BASLIK = [
  'ortam',
  'namespace',
  'uygulama',
  'ekip',
  'ekip_eposta',
  'ekip_beyani',
  'beyan_eden',
  'beyan_tarihi',
  'aciklama',
  'yuk_durumu',
  'istek_7g',
  'istek_24s',
  'son_istek',
  'olculen_sunucu',
  'olculemeyen_sunucu',
  'olculen_saat',
  'sunulan_sunucu',
  'tam_sunucu',
  'beklenen_sunucu',
  'eksik_sunucular',
  'openshift',
  'degerlendirme',
  'sunucular',
] as const;

export function intranetCsvSatirlari(rows: readonly IntranetSatir[], tarih: (v: string) => string): string[][] {
  return rows.map((r) => [
    r.env,
    r.namespace,
    r.application,
    r.ekip.join(' '),
    r.ekipEposta.join(' '),
    r.inUse ? BEYAN_ETIKET[r.inUse] || r.inUse : '',
    r.inUseBy || '',
    r.inUseAt ? tarih(r.inUseAt) : '',
    r.note || '',
    yukMetni(r),
    // SAYI YALNIZ ÖLÇÜLDÜYSE: ölçülemeyen satıra 0 yazmak tabloda "hiç istek yok" diye toplanırdı.
    r.yuk && r.yuk.req7 != null ? String(r.yuk.req7) : '',
    r.yuk && r.yuk.req24 != null ? String(r.yuk.req24) : '',
    r.yuk?.lastSeen || '',
    r.yuk ? String(r.yuk.hosts) : '',
    r.yuk ? String((r.yuk.unknownHosts || 0) + (r.yuk.missingHosts || 0)) : '',
    r.yuk && r.yuk.pencereSaat != null ? String(r.yuk.pencereSaat) : '',
    String(r.sunulan),
    String(r.tamSunucu),
    String(r.beklenen),
    r.eksikSunucular.join(' '),
    r.ocpVar == null ? '' : r.ocpVar ? 'var' : 'yok',
    r.degerlendirme.map((d) => DEGERLENDIRME[d]?.label || d).join(' + '),
    r.sunucular.map((s) => `${s.host}:${s.status || '?'}`).join(' '),
  ]);
}
