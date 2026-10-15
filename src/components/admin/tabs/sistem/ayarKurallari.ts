// src/components/admin/tabs/sistem/ayarKurallari.ts — Admin > Sistem saf kurallari.
//
// Yan etkisiz fonksiyonlar: arama, suzgec, ozet sayilari, uygulanma (canli/restart), kontrol
// turu ve onay gerekcesi. Bilesenler bunlari cagirir; test edilebilirlik icin ayri dosyada.
//
// UYGULANMA TEK KAYNAKTAN: sunucunun `hotReloadable` alani. Meta verideki eski
// `restartRequired` alani 47 anahtarda sunucuyla celisiyordu ve kaldirildi (S12).
import type { EnvVarMeta } from './ortamDegiskenleri';

/** Sunucunun GET /api/admin/system-config yanitindaki tek deger. */
export interface ConfigValue {
  key: string;
  value: string;
  defined: boolean;
  masked: boolean;
  source?: 'db' | 'env';
  hotReloadable?: boolean;
}

/** Turkce buyuk/kucuk harf ve aksan katlama: "İzin" ile "izin", "şifre" ile "sifre" eslesir. */
export const katla = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a');

/**
 * Arama eslesmesi: etiket, anahtar, aciklama ve grup adi. Deger yalniz GIZLI DEGILSE
 * aranir — maskeli onizlemenin icinde arama, gizli degerin parcalarini tahmin ettirebilir.
 */
export function eslesir(m: EnvVarMeta, cv: ConfigValue | undefined, grupAd: string, q: string): boolean {
  const aranan = katla(q.trim());
  if (!aranan) return true;
  const alanlar = [m.label, m.key, m.description, grupAd];
  if (cv && !cv.masked && cv.value) alanlar.push(cv.value);
  return alanlar.some((a) => katla(a).includes(aranan));
}

export type Suzgec = 'tumu' | 'eksik' | 'tanimsiz' | 'portalda' | 'restart' | 'taslak';

export const SUZGEC_ETIKETI: Record<Suzgec, string> = {
  tumu: 'Tümü',
  eksik: 'Eksik zorunlu',
  tanimsiz: 'Tanımsız',
  portalda: "Portal'da ayarlı",
  restart: 'Restart bekleyen',
  taslak: 'Kaydedilmemiş',
};

export function suzgectenGecer(
  s: Suzgec,
  m: EnvVarMeta,
  cv: ConfigValue | undefined,
  kirli: boolean,
  restart: boolean,
): boolean {
  switch (s) {
    case 'tumu':
      return true;
    case 'eksik':
      return m.required && !!cv && !cv.defined;
    case 'tanimsiz':
      return m.saltOkunur !== 'ortam' && !!cv && !cv.defined;
    case 'portalda':
      return cv?.source === 'db';
    case 'restart':
      return restart;
    case 'taslak':
      return kirli;
  }
}

export interface Ozet {
  eksik: number;
  zorunlu: number;
  tanimsiz: number;
  toplam: number;
  portalda: number;
  restart: number;
}

/**
 * Ozet kutularinin sayilari. Yalniz sunucunun BILDIRDIGI anahtarlar sayilir: `saltOkunur:
 * 'ortam'` anahtarlar sunucudan hic gelmez ve "tanimsiz" sayilmamalidir.
 */
export function ozet(
  metalar: EnvVarMeta[],
  degerler: Record<string, ConfigValue>,
  restartBekleyen: ReadonlyMap<string, string>,
): Ozet {
  let eksik = 0;
  let zorunlu = 0;
  let tanimsiz = 0;
  let toplam = 0;
  let portalda = 0;
  for (const m of metalar) {
    if (m.saltOkunur === 'ortam') continue;
    const cv = degerler[m.key];
    if (!cv) continue;
    toplam++;
    if (!cv.defined) tanimsiz++;
    if (cv.source === 'db') portalda++;
    if (m.required) {
      zorunlu++;
      if (!cv.defined) eksik++;
    }
  }
  return { eksik, zorunlu, tanimsiz, toplam, portalda, restart: restartBekleyen.size };
}

/** Kaydedince ne zaman gecerli olur. Bilgi yoksa null (rozet cizilmez — tahmin yok). */
export function uygulanma(cv?: ConfigValue): 'canli' | 'restart' | null {
  if (!cv || typeof cv.hotReloadable !== 'boolean') return null;
  return cv.hotReloadable ? 'canli' : 'restart';
}

export type KontrolTuru = 'gizli' | 'secim' | 'sayi' | 'metin';

export function kontrolTuru(m: EnvVarMeta, cv: ConfigValue | undefined): KontrolTuru {
  if (cv?.masked) return 'gizli';
  // Sunucudaki deger seceneklerin DISINDAYSA (elle girilmis eski bir deger) radyo grubu onu
  // gosteremezdi; metin kutusu degeri oldugu gibi korur.
  if (m.secenekler && (!cv || cv.value === '' || m.secenekler.includes(cv.value))) return 'secim';
  if (m.tur === 'sayi') return 'sayi';
  return 'metin';
}

export type Gerekce = 'kritik' | 'bosaltma' | 'gizliSilme' | 'tehlikeliDeger';

export interface OnayGerekcesi {
  gerekceler: Gerekce[];
  tehlikeli: boolean;
}

/**
 * Joker ana makine bir kamu sonekini mi kapsiyor: `*.` + tek etiket (`*.com`, `*.tr`) ya da
 * iki etiket ve son etiket iki harfli ulke kodu (`*.com.tr`, `*.gov.tr`, `*.co.uk`). Kurumun
 * kendi alan adi altindaki joker (`*.kurum.com`, `*.garanti.com.tr`) KAPSANMAZ. Kamu sonek
 * listesi (PSL) tasinmaz: kural kaba ama ongorulebilir; `*.kurum.tr` gibi iki etiketli kurum
 * adi da uyari alir (yanlis alarm yalniz bir onay penceresi, kacirilan sonek ise acik kapi).
 */
function kamuSonekiJokeri(host: string): boolean {
  if (!host.startsWith('*.')) return false;
  const etiketler = host.slice(2).replace(/\.$/, '').split('.');
  if (etiketler.length === 1) return true;
  return etiketler.length === 2 && /^[a-z]{2}$/.test(etiketler[1]);
}

export type TehlikeliDeger = 'csrfOff' | 'csrfLog' | 'frameYildiz' | 'frameSonek';

/**
 * Degerin kendisi tehlikeli mi (guvenlik korumasini kapatan secimler). Sunucunun kabul ettigi
 * HER bicim yakalanmaz; yakalananlar (denetim 2026-10-15):
 *   * CSRF: origin-kontrolu.cjs degeri kucuk harfe cevirir; 'OFF' / 'Log' de kapatir.
 *   * FRAME `*` ya da ana makinesi yalniz yildiz olan koken (`https://*`, `http://*:8443`):
 *     guvenlik-basliklari.cjs onu `frame-ancestors https://*` yapar, her HTTPS sitesi Portal'i
 *     cerceveleyebilir ('frameYildiz').
 *   * FRAME kamu soneki jokeri (`https://*.com`, `https://*.com.tr`): o uzantidaki her site
 *     cerceveleyebilir ('frameSonek'; kural kamuSonekiJokeri'nde).
 * YAKALANMAYANLAR: kurum alan adi altindaki joker (`https://*.kurum.com`, bilerek) ve sunucu
 * deseninin (`[A-Za-z0-9.*-]+`) gecirdigi ama tarayicinin gecersiz sayip yok saydigi bicimler
 * (`https://*.*`, `https://a*b`): kabul edilmeleri bir koken acmaz.
 */
export function tehlikeliDeger(key: string, yeni: string): TehlikeliDeger | null {
  const v = yeni.trim().toLowerCase();
  if (key === 'CSRF_ORIGIN_CHECK') {
    if (v === 'off') return 'csrfOff';
    if (v === 'log') return 'csrfLog';
  }
  if (key === 'PORTAL_FRAME_ANCESTORS') {
    const hostlar = v
      .split(/[\s,]+/)
      .map((o) => (o === '*' ? '*' : /^https?:\/\/([^/:]+)(?::(?:\d{1,5}|\*))?\/?$/.exec(o)?.[1]))
      .filter((h): h is string => !!h);
    if (hostlar.includes('*')) return 'frameYildiz';
    if (hostlar.some(kamuSonekiJokeri)) return 'frameSonek';
  }
  return null;
}

/** "Portal'a sabitle" ipucu: duzenleyicide dugmenin altinda ve onay penceresinde ayni metin. */
export const SABITLEME_IPUCU =
  "Değer ortam dosyasından geliyor; kaydederseniz Portal'da sabitlenir ve ortam dosyasındaki sonraki değişiklik etkisiz kalır.";

/**
 * "Portal'a sabitle" (KARAR, bulgu 4): gizli OLMAYAN, TANIMLI ve degeri ortam dosyasindan gelen
 * (`source !== 'db'`) anahtar degismemis haliyle de kaydedilebilir. Sunucu degeri Portal
 * veritabanina yazar; acilista DB ortam dosyasini ezer (env-overrides.cjs), yani ortam
 * dosyasindaki sonraki degisiklik etkisiz kalir. Eski ekranda Kaydet hep etkindi; islev kaybi
 * olmasin diye korunur.
 *   * Gizli anahtarda YOK: maskeli deger bilinmez, kutu bos baslar, bos "degisiklik yok" demek.
 *   * Tanimsiz anahtarda YOK: sabitlenecek deger yok; bos yazmak ortam dosyasina sonradan
 *     eklenecek degeri sessizce gecersiz kilardi (bosaltma onaysiz yapilmis olurdu).
 *   * Kaynak DB ise zaten sabit: degismemis deger icin Kaydet kapali kalir.
 */
export function sabitlenebilir(cv: ConfigValue): boolean {
  return !cv.masked && cv.defined && cv.source !== 'db';
}

/**
 * Kaydetmeden once onay penceresi gerekiyor mu. null = dogrudan kaydet.
 *
 * BOSALTMA VARSAYILANA DONMEK DEGILDIR: sunucu bos degeri Portal veritabanina yazar ve acilista
 * da uygular (env-overrides.cjs); sunucu ortam dosyasindaki deger yeniden baslatmadan sonra da
 * gecersiz kalir. Bu yuzden tanimli bir degeri bosaltmak her zaman onay ister.
 */
export function onayGerekce(
  m: EnvVarMeta,
  cv: ConfigValue | undefined,
  yeni: string,
): OnayGerekcesi | null {
  if (!cv) return null;
  const gerekceler: Gerekce[] = [];
  // Yalniz bosluktan olusan deger BOS sayilir: aksi halde kapi atlanir, sunucu '   ' yazar ve
  // ayar "Tanimli" gorunur (denetim 2026-10-15). Ekran da gondermeden once bosa cevirir.
  const bos = yeni.trim() === '';
  const gizliSilme = cv.masked && cv.defined && bos;
  if (gizliSilme) gerekceler.push('gizliSilme');
  if (!cv.masked && cv.defined && bos) gerekceler.push('bosaltma');
  // Kritik anahtarda "Portal'a sabitle" de (deger ayni, kaynak ortam dosyasi) onaydan gecer:
  // deger degismese de ortam dosyasindaki sonraki duzeltme artik etkisiz kalir.
  if (m.kritik && (yeni !== (cv.masked ? '' : cv.value) || sabitlenebilir(cv))) gerekceler.push('kritik');
  const tehlike = tehlikeliDeger(m.key, yeni) !== null;
  if (tehlike) gerekceler.push('tehlikeliDeger');
  if (gerekceler.length === 0) return null;
  return { gerekceler, tehlikeli: gizliSilme || tehlike };
}
