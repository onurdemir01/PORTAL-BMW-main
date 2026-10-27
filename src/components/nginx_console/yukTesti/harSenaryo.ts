// src/components/nginx_console/yukTesti/harSenaryo.ts — har_senaryo.py'nin TARAYICI ici portu (2026-10-27).
//
// Kaynak: glomo_yuk_testi/f5_rehber/har_yuk_testi/har_senaryo.py (sahada kanitli el kiti). Kural: HAR dosyasi
// tarayicidan CIKMAZ (icinde cerez, oturum kimligi, yanit govdesi var). Burada ayristirilir; Portal'a yalniz
// beyaz listeden gecmis YOL satirlari gider, sunucu her satiri yeniden denetler.
//
// SADIK PORT: eleme sirasi ve neden adlari, kisisel veri suphesi, beyaz liste, agirlik, boyut kovalari, K/B
// ayrimi ve OZET satirlari Python'daki gibidir (testler/test_har_senaryo.py vakalari yuk-testi-har.test.ts'te).
// Fark: dosya yazilmaz (sayfa_N.txt yok, "cikti HAR dizini olamaz" kapisi tarayicida anlamsiz).
//   - urlsplit ELLE yazildi (Python 3.12 davranisi): WHATWG `new URL()` nokta segmentlerini cozer ve
//     karakterleri yeniden kodlar; Python yolu oldugu gibi birakir. Farkli yol oynatilirdi.
//   - JSON.parse reviver'i object_hook=_kirp karsiligidir: JSON.parse her degeri once ayristirir, ATILAN
//     anahtarlar nesne kurulurken silinir ve hicbir isleme, ciktiya ya da hata mesajina girmez.
//   - Python dogruluk kurali (bos dizi / bos nesne / 0 / '' yanlis) `dolu()` ile; `\d` Unicode rakamidir.
// Portal farklari (2026-10-27 inceleme; el kitinde yok, fikstur vakalarinin ciktisini DEGISTIRMEZ):
//   - Yol parametresi: her segmentte ';' ve sonrasi tekillestirmeden ONCE atilir (/a;jsessionid=X/b.js ->
//     /a/b.js; JSF/JBoss URL yeniden yazimi oturum kimligini yola koyar). Sayisi ozette `parametresiAtilan`.
//   - E-posta suphesi DOGRUSAL (`epostaMi`): eski duzenli ifade (asagida) ile her girdide ayni sonuc; eski ifade
//     2 KB'lik '/a..@a..' segmentinde polinom geri izleme yapiyordu. Alan kismi en cok 253 karakter.

export const BEYAZ_LISTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;
const RB_BEACON = /(^|\/)rb_[^/]*$/;
// Eski (Python ile ayni) ifade: /[^/@]+@[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/ -
// basi capasiz, sonu capali. Alan kismi '@' tasimadigindan eslesen '@' SON '@'dur; onunde '/' ya da '@' olmayan
// en az bir karakter gerekir; alan kismi da asagidaki capali ifadeyle (ilk etikette harf zorunlu) aynidir.
const EPOSTA_ALANI = /^(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const EPOSTA_ALANI_EN_UZUN = 253;
/** Segment e-posta ile mi bitiyor (eski EPOSTA.test ile ayni sonuc, dogrusal sure). */
export function epostaMi(seg: string): boolean {
  const i = seg.lastIndexOf('@');
  if (i < 1) return false;
  const once = seg[i - 1];
  if (once === '@' || once === '/') return false;
  const alan = seg.slice(i + 1);
  return alan.length <= EPOSTA_ALANI_EN_UZUN && EPOSTA_ALANI.test(alan);
}
const RAKAM_SEGMENT = /^\p{Nd}{6,}$/u;
const RAKAM_11 = /(?<!\p{Nd})\p{Nd}{11}(?!\p{Nd})/u;
const STATIK_UZANTI = ['.js', '.mjs', '.css', '.json', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.webp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.html', '.htm', '.txt', '.wasm'];
// Atilan alanlar: reviver bu anahtarlari nesne kurulurken siler (deger o kisa anda bellekte, sonra cop).
const ATILAN = new Set(['headers', 'cookies', 'postData', 'queryString', 'text', 'params', '_initiator',
  'comment', '_webSocketMessages', '_securityDetails', 'redirectURL', 'encoding']);
export const ORTA_ESIK = 50 * 1024;
export const VARSAYILAN_BUYUK_ESIK = 512000;
export const KOD_KULLANIM = 2;
export const KOD_GUVENLIK = 3;
/** Portal sozlesmesi (sunucu + playbook ayni siniri uygular): senaryo en cok 400 veri satiri, <= 200 KB. */
export const EN_COK_SATIR = 400;
export const EN_COK_TSV_BAYT = 200 * 1024;
export const EN_UZUN_YOL = 2048;

export type Tur = 'js' | 'css' | 'json' | 'html' | 'config' | 'img' | 'font' | 'diger';
export type Boyut = 'kucuk' | 'orta' | 'buyuk';
/** K.tsv / B.tsv satiri: agirlik<TAB>har<TAB>tur<TAB>boyut<TAB>yol. */
export interface SenaryoSatiri { agirlik: number; har: number; tur: Tur; boyut: Boyut; yol: string }
export interface HarGirdisi { ad: string; metin: string; agirlik?: number }
export interface HarOzeti {
  n: number; dosya: string; sayfaAgirligi: number;
  toplamGiris: number; kalan: number; tekilYol: number; hamBayt: number; sorgusuAtilan: number;
  /** Portal: yolundaki ';' parametresi (or. ;jsessionid) atilan, tutulan istek sayisi (OZET.txt'de yok: el kiti atmaz). */
  parametresiAtilan: number;
  belgeIlkSatirda: boolean; kosullu304: number;
  elenen: Record<string, number>; tur: Record<string, number>; boyut: Record<string, number>; sayfaSatir: number;
}
export interface SenaryoOzeti {
  host: string;
  sorguPolitikasi: 'sorguyu_at_yolu_tut' | 'sorgulu_istegi_ele';
  buyukEsikBayt: number;
  harlar: HarOzeti[];
  toplam: { kSatir: number; kToplamAgirlik: number; kAgirlikliOrtHamBayt: number; bSatir: number; sayfaDosyasi: number; k304Agirlik: number };
}
/** Basari: K/B satirlari, sayisal OZET ve OZET.txt satirlari. Ret (`ok: false`): `kod` 2 (kullanim) ya da 3 (guvenlik)
 *  ve `mesaj`; satir alanlari YOK. (Depo `strict: false`: duz sekil, ayrik birlesim daralmaz.) */
export interface SenaryoSonucu {
  ok: boolean; kod?: typeof KOD_KULLANIM | typeof KOD_GUVENLIK; mesaj?: string;
  K?: SenaryoSatiri[]; B?: SenaryoSatiri[]; ozet?: SenaryoOzeti; ozetMetni?: string[];
}

// ── Python yardimcilari ──────────────────────────────────────────────────────────────
type Nesne = Record<string, unknown>;
const nesneMi = (x: unknown): x is Nesne => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Python dogrulugu: None / False / 0 / '' / [] / {} yanlis. */
function dolu(x: unknown): boolean {
  if (x == null || x === false || x === 0 || x === '' || Number.isNaN(x)) return false;
  if (Array.isArray(x)) return x.length > 0;
  if (nesneMi(x)) return Object.keys(x).length > 0;
  return true;
}
const al = (d: Nesne, k: string): unknown => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : undefined);

/** Python int(): sayi kesilir; metin kirpilir, alt cizgili rakam kabul; digeri hata (null). */
function pyInt(x: unknown): number | null {
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'number') return Number.isFinite(x) ? Math.trunc(x) : null;
  if (typeof x === 'string') {
    const s = x.trim();
    if (!/^[+-]?\d+(_\d+)*$/.test(s)) return null;
    return Number(s.replace(/_/g, ''));
  }
  return null;
}

/** "%g" (6 anlamli basamak; ustel bicim us < -4 ya da >= 6). */
function pyG(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const [mantis, usMetni] = x.toExponential(5).split('e');
  const us = Number(usMetni);
  const kirp = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (us < -4 || us >= 6) return `${kirp(mantis)}e${us < 0 ? '-' : '+'}${String(Math.abs(us)).padStart(2, '0')}`;
  return kirp(x.toFixed(5 - us));
}
/** har_senaryo.bicim: tam sayiysa "%d", degilse "%g". */
export function bicim(w: number): string {
  return Number.isInteger(w) ? BigInt(w).toString() : pyG(w);
}
const yuvarla6 = (x: number) => Number(x.toFixed(6));
const iskelet = (yol: string) => Array.from(yol.replace(/[A-Za-z0-9]/g, 'x')).slice(0, 80).join('');
const sirali = (c: Record<string, number>) => Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(' ');
const say = (c: Record<string, number>, k: string, n = 1) => { c[k] = (c[k] || 0) + n; };

// ── urlsplit (Python 3.12) ───────────────────────────────────────────────────────────
class UrlHatasi extends Error {}
const ONALTILIK = /^[0-9a-fA-F]*$/;
function ipv4Mu(s: string): boolean {
  const p = s.split('.');
  if (p.length !== 4) return false;
  return p.every((o) => /^[0-9]{1,3}$/.test(o) && (o === '0' || o[0] !== '0') && Number(o) <= 255);
}
/** ipaddress.IPv6Address kurallari (kapsam kimligi, gomulu IPv4, tek '::'). */
function ipv6Mi(s: string): boolean {
  let adres = s;
  const yuzde = s.indexOf('%');
  if (yuzde >= 0) {
    const kapsam = s.slice(yuzde + 1);
    if (!kapsam || kapsam.includes('%')) return false;
    adres = s.slice(0, yuzde);
  }
  if (!adres) return false;
  const p = adres.split(':');
  if (p.length < 3) return false;
  if (p[p.length - 1].includes('.')) {
    if (!ipv4Mu(p.pop() as string)) return false;
    p.push('0', '0');
  }
  if (p.length > 9) return false;
  let atla: number | null = null;
  for (let i = 1; i < p.length - 1; i += 1) {
    if (!p[i]) {
      if (atla != null) return false;
      atla = i;
    }
  }
  let ust: number;
  let alt: number;
  if (atla != null) {
    ust = atla;
    alt = p.length - atla - 1;
    if (!p[0]) { ust -= 1; if (ust) return false; }
    if (!p[p.length - 1]) { alt -= 1; if (alt) return false; }
    if (8 - (ust + alt) < 1) return false;
  } else {
    if (p.length !== 8 || !p[0] || !p[p.length - 1]) return false;
    ust = p.length;
    alt = 0;
  }
  const gruplar = [...p.slice(0, ust), ...(alt ? p.slice(p.length - alt) : [])];
  return gruplar.every((g) => g.length >= 1 && g.length <= 4 && ONALTILIK.test(g));
}
function koseliDenetle(netloc: string) {
  const hp = netloc.slice(netloc.lastIndexOf('@') + 1);
  const ac = hp.indexOf('[');
  let ad: string;
  if (ac >= 0) {
    if (ac > 0) throw new UrlHatasi();
    const icerik = hp.slice(ac + 1);
    const kapa = icerik.indexOf(']');
    ad = kapa >= 0 ? icerik.slice(0, kapa) : icerik;
    const port = kapa >= 0 ? icerik.slice(kapa + 1) : '';
    if (port && !port.startsWith(':')) throw new UrlHatasi();
  } else {
    const iki = hp.indexOf(':');
    ad = iki >= 0 ? hp.slice(0, iki) : hp;
  }
  if (ad.startsWith('v')) {
    if (!/^v[a-fA-F0-9]+\.[^]+$/.test(ad)) throw new UrlHatasi();
  } else if (ipv4Mu(ad) || !ipv6Mi(ad)) {
    throw new UrlHatasi();
  }
}
const asciiMi = (s: string) => { for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) > 0x7f) return false; return true; };
function netlocDenetle(netloc: string) {
  if (!netloc || asciiMi(netloc)) return;
  const n = netloc.replace(/[@:#?]/g, '');
  const n2 = n.normalize('NFKC');
  if (n === n2) return;
  for (const c of '/?#@:') if (n2.includes(c)) throw new UrlHatasi();
}
/** urllib.parse.urlsplit + .hostname (yalniz bu dosyanin kullandigi alanlar). Hata: UrlHatasi. */
export function urlAyir(url: string): { sema: string; host: string; yol: string; sorgu: string } {
  // lstrip(C0 denetim + bosluk), sonra \t \r \n her yerden silinir (Python _UNSAFE_URL_BYTES_TO_REMOVE).
  let bas = 0;
  while (bas < url.length && url.charCodeAt(bas) <= 0x20) bas += 1;
  let u = url.slice(bas).replace(/[\t\r\n]/g, '');
  let sema = '';
  let netloc = '';
  let sorgu = '';
  const i = u.indexOf(':');
  if (i > 0 && /^[A-Za-z]/.test(u) && /^[A-Za-z0-9+.-]+$/.test(u.slice(0, i))) {
    sema = u.slice(0, i).toLowerCase();
    u = u.slice(i + 1);
  }
  if (u.slice(0, 2) === '//') {
    let son = u.length;
    for (const c of '/?#') {
      const w = u.indexOf(c, 2);
      if (w >= 0) son = Math.min(son, w);
    }
    netloc = u.slice(2, son);
    u = u.slice(son);
    const ac = netloc.includes('[');
    const kapa = netloc.includes(']');
    if (ac !== kapa) throw new UrlHatasi();
    if (ac && kapa) koseliDenetle(netloc);
  }
  const diyez = u.indexOf('#');
  if (diyez >= 0) u = u.slice(0, diyez);
  const soru = u.indexOf('?');
  if (soru >= 0) { sorgu = u.slice(soru + 1); u = u.slice(0, soru); }
  netlocDenetle(netloc);
  // .hostname: kullanici bilgisi atilir, koseli parantez ya da ':' oncesi; '%' sonrasi (kapsam) kucultulmez.
  const bilgi = netloc.slice(netloc.lastIndexOf('@') + 1);
  const ac = bilgi.indexOf('[');
  let host: string;
  if (ac >= 0) {
    const icerik = bilgi.slice(ac + 1);
    const kapa = icerik.indexOf(']');
    host = kapa >= 0 ? icerik.slice(0, kapa) : icerik;
  } else {
    const iki = bilgi.indexOf(':');
    host = iki >= 0 ? bilgi.slice(0, iki) : bilgi;
  }
  const yz = host.indexOf('%');
  host = yz >= 0 ? host.slice(0, yz).toLowerCase() + host.slice(yz) : host.toLowerCase();
  return { sema, host, yol: u, sorgu };
}

// ── har_senaryo.py fonksiyonlari ─────────────────────────────────────────────────────
const sonuBiter = (s: string, ekler: string[]) => ekler.some((e) => s.endsWith(e));
export function turBul(yol: string, mime: string): Tur {
  const p = yol.toLowerCase();
  if (sonuBiter(p, ['.js', '.mjs'])) return 'js';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.json')) return 'json';
  if (sonuBiter(p, ['.html', '.htm']) || p.endsWith('/')) return 'html';
  if (p.endsWith('/config')) return 'config';
  if (sonuBiter(p, ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'])) return 'img';
  if (sonuBiter(p, ['.woff', '.woff2', '.ttf', '.otf', '.eot'])) return 'font';
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  if (m === 'text/html') return 'html';
  if (m === 'application/json') return 'json';
  if (m.includes('javascript')) return 'js';
  if (m === 'text/css') return 'css';
  if (m.startsWith('image/')) return 'img';
  if (m.startsWith('font/') || m.includes('font')) return 'font';
  return 'diger';
}
export function boyutBul(bayt: number, buyukEsik: number): Boyut {
  if (bayt >= buyukEsik) return 'buyuk';
  if (bayt >= ORTA_ESIK) return 'orta';
  return 'kucuk';
}
export function kisiselVeriSuphesi(yol: string): boolean {
  for (const seg of yol.split('/')) {
    if (!seg) continue;
    if (RAKAM_SEGMENT.test(seg)) return true;
    if (seg.includes('@') && !sonuBiter(seg.toLowerCase(), STATIK_UZANTI) && epostaMi(seg)) return true;
  }
  return RAKAM_11.test(yol);
}

/** Yol parametresi (";jsessionid=..." gibi): her segmentten ';' ve sonrasi atilir. `atildi`: yol degisti mi. */
export function yolParametresiniAt(yol: string): { yol: string; atildi: boolean } {
  if (!yol.includes(';')) return { yol, atildi: false };
  return { yol: yol.split('/').map((s) => { const j = s.indexOf(';'); return j >= 0 ? s.slice(0, j) : s; }).join('/'), atildi: true };
}

interface Kayit { yol: string; bayt: number; mime: string; zaman: string; sorguAtildi: boolean; parametreAtildi: boolean; kosullu: boolean }
/** [neden, kayit]: neden null ise istek tutulur. Yalniz izinli alanlara erisir. */
export function ele(girdi: Nesne, host: string, sorguAt: boolean): [string | null, Kayit | null] {
  const ham = al(girdi, 'request');
  const istek: Nesne = dolu(ham) && nesneMi(ham) ? ham : {};
  const hamY = al(girdi, 'response');
  const yanit: Nesne = dolu(hamY) && nesneMi(hamY) ? hamY : {};
  const urlHam = al(istek, 'url');
  const url = dolu(urlHam) ? urlHam : '';
  if (typeof url !== 'string') return ['url_ayristirilamadi', null];
  let u: ReturnType<typeof urlAyir>;
  try {
    u = urlAyir(url);
  } catch {
    return ['url_ayristirilamadi', null];
  }
  if (u.sema !== 'http' && u.sema !== 'https') return ['sema_disi(data/blob)', null];
  if (u.host !== host) return ['baska_host', null];
  const yHam = al(istek, 'method');
  const yontem = dolu(yHam) ? yHam : '?';
  if (yontem !== 'GET') return [`get_degil_${typeof yontem === 'string' && /^[A-Z]{1,10}\n?$/.test(yontem) ? yontem : '?'}`, null];
  // Portal: ';' parametresi (oturum kimligi tasiyabilir) eleme ve tekillestirmeden ONCE atilir.
  const ayik = yolParametresiniAt(u.yol || '/');
  const yol = ayik.yol || '/';
  if (RB_BEACON.test(yol)) return ['oneagent_rb', null];
  const sHam = al(yanit, 'status');
  const durum = pyInt(dolu(sHam) ? sHam : 0) ?? 0;
  if (durum === 0) return ['durum_0', null];
  if (durum >= 300 && durum < 400 && durum !== 304) return [`yonlendirme_${durum}`, null];
  if (durum >= 400) return [`hata_${durum}`, null];
  const onbellek = al(girdi, '_fromCache');
  if (dolu(onbellek)) return [`onbellek_${onbellek === 'memory' || onbellek === 'disk' ? onbellek : 'diger'}`, null];
  if (kisiselVeriSuphesi(yol)) return ['kisisel_veri_suphesi', null];
  let sorguAtildi = false;
  if (u.sorgu) {
    if (!sorguAt) return ['sorgulu', null];
    sorguAtildi = true;
  }
  const iHam = al(yanit, 'content');
  const icerik: Nesne = dolu(iHam) && nesneMi(iHam) ? iHam : {};
  const bHam = al(icerik, 'size');
  const bayt = Math.max(pyInt(dolu(bHam) ? bHam : 0) ?? 0, 0);
  const mHam = al(icerik, 'mimeType');
  const zHam = al(girdi, 'startedDateTime');
  return [null, {
    yol, bayt, mime: typeof mHam === 'string' ? mHam : '', zaman: dolu(zHam) ? String(zHam) : '',
    sorguAtildi, parametreAtildi: ayik.atildi, kosullu: durum === 304,
  }];
}

/** HAR metni -> girdiler (log.entries). ATILAN anahtarlar ayristirma sirasinda silinir. */
export function harOku(ad: string, metin: string): { ok: boolean; girdiler?: unknown[]; mesaj?: string } {
  let har: unknown;
  try {
    har = JSON.parse(metin.charCodeAt(0) === 0xfeff ? metin.slice(1) : metin, function kirp(this: unknown, k: string, v: unknown) {
      return nesneMi(this) && ATILAN.has(k) ? undefined : v;
    });
  } catch {
    return { ok: false, mesaj: `HAR geçerli JSON değil: ${ad}` };
  }
  const log = nesneMi(har) ? al(har, 'log') : undefined;
  const girdiler = nesneMi(log) ? al(log, 'entries') : undefined;
  if (!Array.isArray(girdiler)) return { ok: false, mesaj: `HAR biçimi tanınmadı (log.entries yok): ${ad}` };
  return { ok: true, girdiler };
}

/**
 * har_senaryo.main karsiligi. `harlar` sirasi = HAR numarasi (1'den). Basari: K/B satirlari, sayisal OZET ve
 * OZET.txt satirlari; ret: kod 2 (kullanim) ya da 3 (guvenlik - beyaz liste disi yol; hicbir satir donmez).
 */
export function senaryoUret(harlar: HarGirdisi[], o: { host: string; buyukEsik?: number; sorguAt?: boolean }): SenaryoSonucu {
  const host = String(o.host || '').trim().toLowerCase();
  const buyukEsik = o.buyukEsik ?? VARSAYILAN_BUYUK_ESIK;
  const sorguAt = !!o.sorguAt;
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, kod: KOD_KULLANIM, mesaj: 'Host geçersiz (yalnız küçük harf, rakam, nokta ve tire).' };
  if (!(Number.isInteger(buyukEsik) && buyukEsik > 0)) return { ok: false, kod: KOD_KULLANIM, mesaj: 'Büyük dosya eşiği pozitif tam sayı olmalı.' };
  if (!harlar.length) return { ok: false, kod: KOD_KULLANIM, mesaj: 'En az bir HAR dosyası seçin.' };
  for (const h of harlar) {
    const w = h.agirlik ?? 1;
    if (!(w > 0) || !Number.isFinite(w)) return { ok: false, kod: KOD_KULLANIM, mesaj: `Sayfa ağırlığı pozitif sayı olmalı: ${h.ad}` };
  }
  const politika = sorguAt ? 'sorguyu_at_yolu_tut' : 'sorgulu_istegi_ele';
  const ozetMetni = ['# har_senaryo.py ozeti - yalniz sayilar (deger, baslik, cerez, sorgu yok)', `host=${host}`,
    `sorgu_politikasi=${politika}`, `buyuk_esik_bayt=${buyukEsik}`,
    'kolonlar(K.tsv,B.tsv)=agirlik<TAB>har<TAB>tur<TAB>boyut<TAB>yol', ''];
  const K: SenaryoSatiri[] = [];
  const B = new Map<string, SenaryoSatiri>();
  const ozetHar: HarOzeti[] = [];
  const ihlal = new Map<number, number>();
  const ihlalIskelet: string[] = [];
  let toplamAgirlik = 0;
  let agirlikliBayt = 0;
  let agirlik304 = 0;
  let sayfaDosyasi = 0;
  for (let n = 1; n <= harlar.length; n += 1) {
    const h = harlar[n - 1];
    const w = h.agirlik ?? 1;
    const okunan = harOku(h.ad, h.metin);
    if (!okunan.ok) return { ok: false, kod: KOD_KULLANIM, mesaj: okunan.mesaj };
    const girdiler = okunan.girdiler;
    const elenen: Record<string, number> = {};
    const tutulan: Kayit[] = [];
    for (const g of girdiler) {
      if (!nesneMi(g)) { say(elenen, 'bicim_disi'); continue; }
      const [neden, kayit] = ele(g, host, sorguAt);
      if (neden) say(elenen, neden);
      else tutulan.push(kayit as Kayit);
    }
    const sayac = new Map<string, { adet: number; bayt: number; mime: string }>();
    for (const k of tutulan) {
      let s = sayac.get(k.yol);
      if (!s) { s = { adet: 0, bayt: 0, mime: k.mime }; sayac.set(k.yol, s); }
      s.adet += 1;
      s.bayt = Math.max(s.bayt, k.bayt);
      if (!s.mime) s.mime = k.mime;
    }
    const turler: Record<string, number> = {};
    const boyutlar: Record<string, number> = {};
    let ham = 0;
    for (const [yol, s] of sayac) {
      if (!BEYAZ_LISTE.test(yol)) {
        ihlal.set(n, (ihlal.get(n) || 0) + 1);
        ihlalIskelet.push(iskelet(yol));
        continue;
      }
      const tur = turBul(yol, s.mime);
      const boy = boyutBul(s.bayt, buyukEsik);
      say(turler, tur, s.adet);
      say(boyutlar, boy, s.adet);
      ham += s.bayt * s.adet;
      const agirlik = w * s.adet;
      toplamAgirlik += agirlik;
      agirlikliBayt += agirlik * s.bayt;
      K.push({ agirlik, har: n, tur, boyut: boy, yol });
      if (boy === 'buyuk' && !B.has(yol)) B.set(yol, { agirlik: 1, har: n, tur, boyut: boy, yol });
    }
    // Sayfa acilis sirasi (Python sayfa_N.txt): yalniz OZET sayilari icin; dosya uretilmez.
    const sira = tutulan.map((k, i) => ({ k, i })).sort((a, b) => (a.k.zaman < b.k.zaman ? -1 : a.k.zaman > b.k.zaman ? 1 : a.i - b.i)).map((x) => x.k);
    const belge = sira.findIndex((k) => turBul(k.yol, k.mime) === 'html');
    const sayfaSatir = sira.filter((k) => BEYAZ_LISTE.test(k.yol)).length;
    sayfaDosyasi += 1;
    const sorguAtilan = tutulan.filter((k) => k.sorguAtildi).length;
    const parametresiAtilan = tutulan.filter((k) => k.parametreAtildi).length;
    const kosullu = tutulan.filter((k) => k.kosullu && BEYAZ_LISTE.test(k.yol)).length;
    agirlik304 += w * kosullu;
    const ho: HarOzeti = {
      n, dosya: h.ad, sayfaAgirligi: w, toplamGiris: girdiler.length, kalan: tutulan.length, tekilYol: sayac.size,
      hamBayt: ham, sorgusuAtilan: sorguAtilan, parametresiAtilan, belgeIlkSatirda: belge >= 0, kosullu304: kosullu,
      elenen, tur: turler, boyut: boyutlar, sayfaSatir,
    };
    ozetHar.push(ho);
    ozetMetni.push(`[HAR ${n}] dosya=${h.ad} sayfa_agirligi=${bicim(w)}`,
      `  toplam_giris=${ho.toplamGiris} kalan=${ho.kalan} tekil_yol=${ho.tekilYol} ham_bayt=${ham} sorgusu_atilan=${sorguAtilan} belge_ilk_satirda=${belge >= 0 ? 'evet' : 'HAYIR(belge yok)'} kosullu_304=${kosullu}`,
      `  elenen: ${sirali(elenen) || '-'}`, `  tur: ${sirali(turler) || '-'}`, `  boyut: ${sirali(boyutlar) || '-'}`,
      `  sayfa_${n}.txt_satir=${sayfaSatir}`);
  }
  if (ihlal.size) {
    const adet = [...ihlal.values()].reduce((a, b) => a + b, 0);
    const dagilim = [...ihlal.entries()].sort((a, b) => a[0] - b[0]).map(([n, k]) => `HAR ${n}: ${k}`).join(', ');
    return { ok: false, kod: KOD_GUVENLIK, mesaj: `Güvenlik: ${adet} yol beyaz listeye uymuyor (${dagilim}). Hiçbir satır üretilmedi. Yol iskeletleri (harf/rakam → x): ${ihlalIskelet.slice(0, 5).join('; ')}` };
  }
  if (!K.length) return { ok: false, kod: KOD_KULLANIM, mesaj: `Hiç istek kalmadı (host doğru mu? ${host})` };
  const ort = toplamAgirlik ? agirlikliBayt / toplamAgirlik : 0;
  const toplam = { kSatir: K.length, kToplamAgirlik: yuvarla6(toplamAgirlik), kAgirlikliOrtHamBayt: Math.trunc(ort), bSatir: B.size, sayfaDosyasi, k304Agirlik: yuvarla6(agirlik304) };
  ozetMetni.push('', `[TOPLAM] K_satir=${toplam.kSatir} K_toplam_agirlik=${bicim(toplam.kToplamAgirlik)} K_agirlikli_ort_ham_bayt=${toplam.kAgirlikliOrtHamBayt} B_satir=${toplam.bSatir} sayfa_dosyasi=${sayfaDosyasi} K_304_agirlik=${bicim(toplam.k304Agirlik)}`);
  if (agirlik304) {
    ozetMetni.push(`NOT: K agirliginin %${(100 * agirlik304 / toplamAgirlik).toFixed(1)}'i tarayicida 304 (kosullu GET, govdesiz) idi. Yuk testi kosulsuz gonderir; sunucu 200 + tam govde doner, CPU-ms/istek ve bayt/istek biraz yuksek cikar. Butun adimlarda ayni oynatildigi icin adimlar arasi orana etkisi kucuktur (MAKUL).`);
  }
  const bSatirlari = [...B.values()];
  // Son kapi: gonderilecek her satir yeniden denetlenir (Python: OZET haric butun dosyalar).
  for (const s of [...K, ...bSatirlari]) {
    const satir = satirMetni(s);
    if (!BEYAZ_LISTE.test(s.yol) || satir.includes('?') || satir.includes('#')) {
      return { ok: false, kod: KOD_GUVENLIK, mesaj: 'Güvenlik: hazırlanan bir satır son denetimi geçemedi; hiçbir satır üretilmedi.' };
    }
  }
  return {
    ok: true, K, B: bSatirlari, ozetMetni,
    ozet: { host, sorguPolitikasi: politika, buyukEsikBayt: buyukEsik, harlar: ozetHar, toplam },
  };
}

/** TSV satiri (Python "%s\t%d\t%s\t%s\t%s"). */
export const satirMetni = (s: SenaryoSatiri) => `${bicim(s.agirlik)}\t${s.har}\t${s.tur}\t${s.boyut}\t${s.yol}`;

/** Sunucuya giden OZET: yalniz sayilar; HAR dosya ADLARI tarayicida kalir. Sayac anahtarindaki denetim karakteri
 *  (or. "POST\n" yontemi) '?' olur: sunucu denetim karakterli ozeti butunuyle reddeder. */
export function gonderilecekOzet(o: SenaryoOzeti): Omit<SenaryoOzeti, 'harlar'> & { harlar: Omit<HarOzeti, 'dosya'>[] } {
  const temiz = (c: Record<string, number>) => {
    const d: Record<string, number> = {};
    for (const [k, v] of Object.entries(c)) say(d, Array.from(k, (c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? '?' : c)).join('').slice(0, 80), v);
    return d;
  };
  return { ...o, harlar: o.harlar.map(({ dosya: _dosya, ...h }) => ({ ...h, elenen: temiz(h.elenen) })) };
}

// ── Yapistirilan yol listesi ve gonderim kapisi (Portal sozlesmesi) ──────────────────
export type YolSorunu = { satir: number; neden: string; iskelet?: string };

/** Sunucunun ';' reddiyle ayni metin (dogrula.cjs yolDenetle). HAR'da ';' atilir; yapistirilan listede reddedilir. */
export const YOL_PARAMETRESI_METNI = 'yolda ";" parametresi var (ör. ;jsessionid) — oturum bilgisi senaryoya giremez';
/** Sunucu ve playbook'un da uyguladigi kural (sozlesme 2): beyaz liste, ? # \ ; yok, '//' ile baslamaz, '..' segmenti yok. */
export function yolSorunu(yol: string): string | null {
  if (!yol.startsWith('/')) return /^https?:\/\//i.test(yol) ? 'tam adres değil yol yazın (/ ile başlamalı)' : '/ ile başlamıyor';
  if (yol.includes('?')) return 'sorgu dizesi (?) var';
  if (yol.includes('#')) return 'parça (#) var';
  if (yol.includes('\\')) return 'ters eğik çizgi var';
  if (yol.startsWith('//')) return '// ile başlıyor';
  if (yol.split('/').includes('..')) return '“..” segmenti var';
  if (yol.includes(';')) return YOL_PARAMETRESI_METNI;
  if (!BEYAZ_LISTE.test(yol)) return 'izin verilmeyen karakter (boşluk, tırnak, < > …)';
  if (yol.length > EN_UZUN_YOL) return `yol çok uzun (> ${EN_UZUN_YOL})`;
  if (/%(?![0-9A-Fa-f]{2})/.test(yol)) return 'bozuk % kodlaması var';
  if (/%(2e|2f|5c|00|0a|0d|25)/i.test(yol)) return 'kodlanmış nokta / eğik çizgi / kontrol karakteri var';
  if (kisiselVeriSuphesi(yol)) return 'kişisel veri şüphesi (6+ haneli segment, e-posta ya da 11 hane)';
  return null;
}

/** Bir yol bir satir. Ayni yol tekrar ederse agirligi artar (HAR'daki tekrar gibi); tur uzantidan, boyut bilinmedigi icin 'kucuk'. */
export interface ListeSonucu { ok: boolean; K?: SenaryoSatiri[]; satir?: number; tekrar?: number; sorunlar?: YolSorunu[] }
export function yolListesiSenaryosu(metin: string): ListeSonucu {
  const sorunlar: YolSorunu[] = [];
  const sayac = new Map<string, number>();
  let satir = 0;
  String(metin || '').split('\n').forEach((ham, i) => {
    const yol = ham.replace(/\r$/, '').trim();
    if (!yol) return;
    satir += 1;
    const neden = yolSorunu(yol);
    if (neden) { sorunlar.push({ satir: i + 1, neden, iskelet: iskelet(yol) }); return; }
    sayac.set(yol, (sayac.get(yol) || 0) + 1);
  });
  if (sorunlar.length) return { ok: false, sorunlar };
  if (!sayac.size) return { ok: false, sorunlar: [{ satir: 0, neden: 'liste boş' }] };
  const K: SenaryoSatiri[] = [...sayac.entries()].map(([yol, adet]) => ({ agirlik: adet, har: 1, tur: turBul(yol, ''), boyut: 'kucuk', yol }));
  return { ok: true, K, satir, tekrar: satir - sayac.size };
}

/** POST oncesi son kapi: satir sayisi, TSV boyutu ve her yol (sunucu ayni kurallarla yeniden reddeder). */
export function gonderimKapisi(satirlar: SenaryoSatiri[]): string[] {
  const hatalar: string[] = [];
  if (!satirlar.length) hatalar.push('Gönderilecek satır yok.');
  if (satirlar.length > EN_COK_SATIR) hatalar.push(`Senaryo en çok ${EN_COK_SATIR} satır olabilir (${satirlar.length}). Daha az HAR kullanın ya da listeyi kısaltın.`);
  // HAR'dan gelen yolda tipik ihlal: '//' ile baslayan ya da '..' segmentli yol (Python beyaz listesi ikisine de izin verir).
  const kotu = satirlar.map((s) => ({ s, neden: yolSorunu(s.yol) })).filter((x) => x.neden);
  if (kotu.length) hatalar.push(`${kotu.length} yol Portal kuralına uymuyor (ilki: ${kotu[0].neden}; iskelet ${iskelet(kotu[0].s.yol)}).`);
  const bayt = new TextEncoder().encode(`agirlik\thar\ttur\tboyut\tyol\n${satirlar.map(satirMetni).join('\n')}\n`).length;
  if (bayt > EN_COK_TSV_BAYT) hatalar.push(`Senaryo ${Math.ceil(bayt / 1024)} KB; üst sınır ${EN_COK_TSV_BAYT / 1024} KB.`);
  return hatalar;
}
