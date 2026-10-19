// src/components/intranetSpa.ts — Nginx ARK SPA > Intranet SPA: saf yardımcılar (süzgeç, etiket, CSV).
// Sayfa: IntranetSpaPage.tsx. Hesap sunucuda (server/spa-report/intranet.cjs); burada gösterim.
// Yük DYNATRACE'ten (BMW_Application_Usage): beş durum, hiçbiri diğerine indirgenmez.
import type { IntranetDegerlendirme, IntranetIstek, IntranetKurulum, IntranetSatir } from '@/api/arkSpaApi';
import type { Tone } from '@/components/denetim/ui';

export const BEYAN_ETIKET: Record<string, string> = {
  yes: 'kullanıyor',
  no: 'kullanmıyor',
  unknown: 'bilmiyor',
};

export const ISTEK: Record<IntranetIstek, { label: string; hint: string }> = {
  var: { label: 'istek alıyor', hint: 'Dynatrace: uygulamanın servisleri istek almış.' },
  yok: {
    label: 'istek almıyor',
    hint: 'Dynatrace: uygulamanın her cluster’daki servisleri ölçüldü, istek yok.',
  },
  'servis-yok': {
    label: 'Dynatrace servisi yok',
    hint: 'Uygulamanın Dynatrace’te servisi oluşmamış: istek sayılamıyor — “istek almıyor” DEMEK DEĞİL.',
  },
  olculemedi: {
    label: 'ölçülemedi',
    hint: 'Dynatrace servisi var ama ölçülemedi (ya da kullanım verisi okunamadı) — “istek almıyor” demek değil.',
  },
  'olcum-yok': {
    label: 'ölçüm yok',
    hint: 'Uygulama son 7 günün Dynatrace kullanım verisinde yok (Dynatrace’te uygulama olarak görünmüyor olabilir) — “istek almıyor” demek değil.',
  },
};

export const DEGERLENDIRME: Record<IntranetDegerlendirme, { label: string; tone: Tone; hint: string }> = {
  'kapatma-adayi': {
    label: 'kapatma adayı',
    tone: 'danger',
    hint: 'Dynatrace’te istek yok (her cluster ölçüldü) ve ekip “kullanmıyor” dedi.',
  },
  'teyit-bekliyor': {
    label: 'istek yok — ekip teyidi bekleniyor',
    tone: 'warning',
    hint: 'Dynatrace’te istek yok; ekip henüz beyan girmedi.',
  },
  celiski: {
    label: 'çelişki',
    tone: 'warning',
    hint: 'Dynatrace’te istek var ama ekip “kullanmıyor” dedi. Kim kullanıyor, bakılmalı.',
  },
  'internet-route-da-var': {
    label: 'internet route’u da var',
    tone: 'neutral',
    hint: 'Uygulamanın intranet (reencrypt) route’unun yanında internete açık (passthrough) route’u da var.',
  },
  'zayif-kanit': {
    label: 'SPA kanıtı zayıf',
    tone: 'neutral',
    hint: 'Pod’da nginx yalnız ad eşleşmesiyle bulundu (servis okunamadı); SPA Keşfi’nde ayrıntı.',
  },
  'eski-veri': {
    label: 'eski veri',
    tone: 'neutral',
    hint: 'Bazı cluster’ların son keşif koşusu başarısız; satır önceki koşudan.',
  },
};

// INTRANET SUNUCU KURULUMU (Nginx_Intranet_Audit): uygulamanın kendi ortamının intranet nginx
// sunucularında paket (/hysdeploy) + dosyalar (/usr/nginx/applications) + conf var mı.
export const KURULUM: Record<IntranetKurulum['durum'], { label: string; tone: Tone; hint: string }> = {
  tamam: {
    label: 'tamamlandı',
    tone: 'success',
    hint: 'Ortamın taranan her intranet sunucusunda paket, uygulama dosyaları ve conf var.',
  },
  kismi: {
    label: 'kısmi',
    tone: 'warning',
    hint: 'Bazı intranet sunucularında yok ya da bazı parçalar (paket / dosyalar / conf) eksik.',
  },
  yok: {
    label: 'kurulu değil',
    tone: 'danger',
    hint: 'Ortamın taranan intranet sunucularının hiçbirinde bu uygulamanın izi yok.',
  },
  olculemedi: {
    label: 'ölçülemedi',
    tone: 'neutral',
    hint: 'Intranet dizin taraması okunamadı ya da ortamın intranet sunucuları son taramada yok — “kurulu değil” demek değil.',
  },
  'sunucu-yok': {
    label: 'ortamın intranet sunucusu yok',
    tone: 'neutral',
    hint: 'Uygulamanın ortamı (namespace eki) bilinmiyor ya da o ortamın intranet nginx sunucusu yok.',
  },
};

const SUNUCU_DURUM: Record<string, string> = {
  OK: 'tam',
  YOK: 'kurulum yok',
  MISSING_CONF: 'conf yok — nginx sunmuyor',
  MISSING_APP: 'uygulama dosyaları yok',
  MISSING_HYS: 'paket dizini yok',
  ONLY_HYS: 'yarım (yalnız paket)',
  ONLY_APP: 'yarım (yalnız dosyalar)',
  ONLY_CONF: 'yarım (yalnız conf)',
};
export const sunucuDurumu = (s: string) => SUNUCU_DURUM[s] || s || 'bilinmiyor';

export function kurulumMetni(k: IntranetKurulum): string {
  const l = KURULUM[k.durum]?.label || k.durum;
  return k.durum === 'tamam' || k.durum === 'kismi' || k.durum === 'yok' ? `${l} ${k.tam}/${k.beklenen}` : l;
}

export const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

/** Beyan kaydindan sonra sunucuyu yeniden beklemeden satirin kararini ayni kuralla guncelle. */
export function degerlendirIntranet(
  r: Pick<IntranetSatir, 'istek' | 'ag' | 'zayifKanit' | 'eskiCluster'>,
  inUse: IntranetSatir['inUse'],
): IntranetDegerlendirme[] {
  const d: IntranetDegerlendirme[] = [];
  if (r.istek === 'yok' && inUse === 'no') d.push('kapatma-adayi');
  else if (r.istek === 'yok' && !inUse) d.push('teyit-bekliyor');
  if (r.istek === 'var' && inUse === 'no') d.push('celiski');
  if (r.ag === 'karisik') d.push('internet-route-da-var');
  if (r.zayifKanit) d.push('zayif-kanit');
  if (r.eskiCluster.length) d.push('eski-veri');
  return d;
}

/** Yük hücresinin kısa metni (ekran + CSV aynı). */
export function istekMetni(r: IntranetSatir): string {
  if (r.istek === 'var') return `istek alıyor · ${nf(r.req ?? 0)}`;
  return ISTEK[r.istek]?.label || r.istek;
}

/** Yük ipucu: Dynatrace penceresi, servis sayısı, ölçüm günü, kısmi ölçüm ve not. */
export function istekIpucu(r: IntranetSatir): string {
  const d = r.dynatrace;
  const p: string[] = [ISTEK[r.istek]?.hint || ''];
  if (d) {
    if (r.req != null && d.windowDays) p.push(`Son ${d.windowDays} günde ${nf(r.req)} istek.`);
    if (d.services != null) p.push(`${d.services} Dynatrace servisi.`);
    if (d.olcum) p.push(`Ölçülen cluster: ${d.olcum}.`);
    if (d.scanDate) p.push(`Ölçüm günü ${d.scanDate}.`);
    if (d.note) p.push(`Not: ${d.note}`);
  }
  return p.filter(Boolean).join(' ');
}

export type IstekSuzgec = 'all' | IntranetIstek;
export type BeyanSuzgec = 'all' | 'bekleyen' | 'verilmis' | 'yes' | 'no' | 'unknown';
export type DegSuzgec = 'all' | IntranetDegerlendirme;
export type KurulumSuzgec = 'all' | IntranetKurulum['durum'];

export function suzIntranet(
  rows: readonly IntranetSatir[],
  f: {
    env: string;
    istek: IstekSuzgec;
    beyan: BeyanSuzgec;
    deg: DegSuzgec;
    ekip: string;
    q: string;
    kurulum?: KurulumSuzgec;
  },
): IntranetSatir[] {
  const ara = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.env !== 'all' && r.env !== f.env) return false;
    if (f.istek !== 'all' && r.istek !== f.istek) return false;
    if (f.kurulum && f.kurulum !== 'all' && r.kurulum.durum !== f.kurulum) return false;
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
    return [r.application, r.namespace, r.note, ...r.ekip, ...r.adresler, ...r.clusters]
      .join(' ')
      .toLowerCase()
      .includes(ara);
  });
}

export const INTRANET_CSV_BASLIK = [
  'ortam',
  'namespace',
  'uygulama',
  'ag',
  'route_adresleri',
  'clusterlar',
  'ekip',
  'ekip_eposta',
  'ekip_beyani',
  'beyan_eden',
  'beyan_tarihi',
  'aciklama',
  'dynatrace_durumu',
  'dynatrace_istek',
  'dynatrace_gun',
  'dynatrace_servis',
  'dynatrace_olcum_gunu',
  'intranet_kurulum',
  'kurulu_sunucu',
  'beklenen_sunucu',
  'eksik_sunucular',
  'taranmayan_sunucular',
  'degerlendirme',
] as const;

export function intranetCsvSatirlari(rows: readonly IntranetSatir[], tarih: (v: string) => string): string[][] {
  return rows.map((r) => [
    r.env,
    r.namespace,
    r.application,
    r.ag,
    r.adresler.join(' '),
    r.clusters.join(' '),
    r.ekip.join(' '),
    r.ekipEposta.join(' '),
    r.inUse ? BEYAN_ETIKET[r.inUse] || r.inUse : '',
    r.inUseBy || '',
    r.inUseAt ? tarih(r.inUseAt) : '',
    r.note || '',
    ISTEK[r.istek]?.label || r.istek,
    // SAYI YALNIZ ÖLÇÜLDÜYSE: ölçülemeyen satıra 0 yazmak tabloda "hiç istek yok" diye toplanırdı.
    r.req != null ? String(r.req) : '',
    r.dynatrace?.windowDays != null ? String(r.dynatrace.windowDays) : '',
    r.dynatrace?.services != null ? String(r.dynatrace.services) : '',
    r.dynatrace?.scanDate || '',
    KURULUM[r.kurulum.durum]?.label || r.kurulum.durum,
    // SAYI YALNIZ KARAR VERİLDİYSE: ölçülemeyen kurulum "0 sunucu" yazmaz.
    r.kurulum.beklenen ? String(r.kurulum.tam) : '',
    r.kurulum.beklenen ? String(r.kurulum.beklenen) : '',
    r.kurulum.eksik.join(' '),
    r.kurulum.taranmayan.join(' '),
    r.degerlendirme.map((d) => DEGERLENDIRME[d]?.label || d).join(' + '),
  ]);
}
