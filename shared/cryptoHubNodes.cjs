// shared/cryptoHubNodes.cjs - Crypto Hub > Indexer / Node degisikligi sabitleri (2026-11-02).
//
// Sozlesme: scratchpad/serbest/sozlesme.md (2026-11-03). NODE LISTESI YOK: yeni deger SERBEST
// METIN, kullanici sihirbazda grubun her rolu icin yazar (is birimi onayli). Portal degeri bu
// moduldeki kurallarla dogrular (Ansible crypto_hub_node.py ile KARAKTER KARAKTER ayni desenler;
// capraz bekci node-sozlesme.test.cjs CHN12), Portal DB'de yalniz sifreli tutar ve ekranda /
// Smart'ta / denetimde yalniz maskeli deger + sha256 gosterir. Bu modul require ICERMEZ: Vite
// dev shim'i ve tarayici ayni dosyayi saf modul olarak yukler.
//
// PROD ACILISI IKI ANAHTARLA (bolum 10): buradaki NODE_PROD_ACIK listesi + tenants.yml'deki
// `node_degisikligi_acik: true`. Liste KODDA durur (DB/env YOK): bu depoda "bayat DB satiri kod
// varsayilanini ezdi" sinifi uc kez yasandi; acilis bir kod degisikligi + ZIP gerektirsin.
'use strict';

const UIS_BILESENLER = Object.freeze(['adapter', 'api', 'indexer', 'processor']);

/** Regex icin kacis (release adi tenants.yml'den gelir ama yine de duz metin sayilir). */
const kacis = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Yeni tip deployment deseni: <release>-harmonize-uis-<bilesen>-<zincirAg>.
 * 1. grup bilesen, 2. grup zincirAg.
 */
function uisDeseni(release) {
  return new RegExp(
    `^${kacis(release)}-harmonize-uis-(${UIS_BILESENLER.join('|')})-([a-z0-9][a-z0-9-]*[a-z0-9])$`,
  );
}

/**
 * Eski tip deployment deseni: <release>-harmonize-<ek>. `uis-` ile baslayan ek DISARIDA:
 * yeni tip bir deployment eski grup gibi okunursa ayni env iki ayri gruptan yazilabilirdi.
 */
function eskiDeseni(release) {
  return new RegExp(`^${kacis(release)}-harmonize-(?!uis-)([a-z0-9][a-z0-9-]*[a-z0-9])$`);
}

const GRUP_RE = /^(uis|eski):[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// Prod acilis anahtari 1 (anahtar 2: tenants.yml node_degisikligi_acik). Faz 1: bos.
const NODE_PROD_ACIK = Object.freeze([]);

/** Bu kiracida node okuma/talep acik mi? Test kiracilari acik, prod yalniz listedeyse. */
function nodeAcikMi(tenant) {
  return (
    !!tenant &&
    tenant.app === 'metaco' &&
    (!tenant.production || NODE_PROD_ACIK.includes(tenant.key))
  );
}

/** Ekranda ve Smart biletinde gorunen lokasyon. Ankara yalniz prod_ank ortami. */
function lokasyon(tenant) {
  return tenant && tenant.env === 'prod_ank' ? 'Ankara' : 'İstanbul';
}

// Istanbul -> Ankara es kiracisi (D4). GAR prod'da Ankara kiracisi yok -> oneri yok.
const ES_KIRACI = Object.freeze({ metaco_das_prod: 'metaco_das_prod_ank' });

function esKiraciOf(key) {
  return ES_KIRACI[String(key || '')] || null;
}

const GEREKCE_EN_AZ = 10;
const GEREKCE_EN_COK = 500;
const OKUMA_TAZE_MS = 10 * 60 * 1000;
const ONAY_DK = 1440;
const MAX_HEDEF = 8;

// NODEENV `kaynak` alaninin KAPALI kumesi: crypto_hub_node.py KAYNAKLAR ile BIREBIR (capraz
// bekci node-sozlesme.test.cjs CHN11). Bilinmeyen kaynak -> grup olculemedi (fail-closed).
//   envFrom  : kapta acik yok, envFrom kaynagi bu adi KESIN tanimliyor (referans)
//   belirsiz : kapta acik yok, envFrom kaynagi okunamadi (olculemedi)
const NODE_KAYNAKLARI = Object.freeze(['literal', 'secretRef', 'configMapRef', 'alanRef', 'envFrom', 'belirsiz', 'yok']);
const REFERANS_KAYNAKLARI = Object.freeze(['secretRef', 'configMapRef', 'alanRef', 'envFrom']);
// ASLA degismeyen komsu degiskenler (kullanici 2026-11-02: "hep sabit kalacak"). Betikteki
// YASAK_ENV_RE ile AYNI kaynak metin (CHN11). Portal bu adlari tasiyan NODEALLOW/NODEENV
// satirini da kabul etmez (savunma derinligi: betik hatasi plana sizmasin).
const YASAK_ENV_RE = /^(HTTPS?_PROXY|NO_PROXY|ADAPTER_ADDR|EVENT_API_URL|ADDRESS_API_URL_.*|CHAIN_ID.*)$/i;

// Bilete baglanmis acik talebin ust yas siniri (PS2): onay suresi + betik butcesi (30 dk) +
// pay (60 dk). Asilip is sonucu okunamazsa talep OLCULEMEDI / TAKILDI kapanir (basari sayilmaz).
const TAKILDI_DK = ONAY_DK + 30 + 60;
// Ankara talebi Istanbul'a bu sure icinde acilmis ayni grup talebine SUNUCUDA baglanir (PS6).
const ES_TALEP_GUN = 7;

// OCO penceresi (D8). Ufuk pencere acilana kadarki bekleyisi sinirlar; pay betik butcesidir (30 dk):
// daha gec baslayan is pencere disina tasar. Takildi payi pencere sonundan sonra satirin acik
// kalacagi sure (betik butcesi + pay). Pencere uzunlugunun ust siniri yok: acik pencerede bekleyis
// OCO'suz talebin onay suresiyle sinirlanir, yoksa uzun OCO'da bilet, grup kilidi ve sifreli deger
// pencere sonuna kadar surerdi.
const OCO_UFUK_GUN = 7;
const OCO_SON_PAY_DK = 30;
const OCO_TAKILDI_PAY_DK = 90;
const OCO_ACIK_BEKLEME_DK = ONAY_DK;

/**
 * Isin en gec baslayabilecegi an: pencere sonu - pay, ama pencere acildiktan (ya da acikken talep
 * geldikten) sonra en cok OCO_ACIK_BEKLEME_DK.
 * @param {{basMs: number, sonMs: number, talepMs: number}} o
 * @returns {number}
 */
function ocoSonBaslamaMs({ basMs, sonMs, talepMs }) {
  return Math.min(sonMs - OCO_SON_PAY_DK * 60000, Math.max(basMs, talepMs) + OCO_ACIK_BEKLEME_DK * 60000);
}

/**
 * Tek saf kural; sunucu talep aninda, sihirbaz ekran metni icin ayni fonksiyonu cagirir.
 * @param {{basMs: number, sonMs: number, simdiMs: number, smartKapali: boolean}} o
 * @returns {{kod: 'gecersiz'|'gecti'|'kisa'|'son_pay'|'ufuk'|'bekle_kapali'|'bekle'|'acik', sonBaslamaMs: number}}
 *   'bekle' ve 'acik' disindaki her kod rettir.
 */
function ocoPencereKarari({ basMs, sonMs, simdiMs, smartKapali }) {
  const sonBaslamaMs = ocoSonBaslamaMs({ basMs, sonMs, talepMs: simdiMs });
  if (!Number.isFinite(basMs) || !Number.isFinite(sonMs) || !Number.isFinite(simdiMs)) {
    return { kod: 'gecersiz', sonBaslamaMs };
  }
  const kod =
    (() => { if (simdiMs > sonMs) return 'gecti'; if (sonMs - OCO_SON_PAY_DK * 60000 <= basMs) return 'kisa'; if (simdiMs > sonBaslamaMs) return 'son_pay'; if (basMs - simdiMs > OCO_UFUK_GUN * 86400000) return 'ufuk'; if (simdiMs < basMs) { if (smartKapali) return 'bekle_kapali'; return 'bekle'; } return 'acik'; })();
  return { kod, sonBaslamaMs };
}

// -- Yeni deger dogrulama ve maskeleme (sozlesme bolum 3) --------------------------------
// Kaynak metinler Python crypto_hub_node.py ile BIREBIR (CHN12). `\s` YOK: JS ve Python'in
// bosluk kumesi farkli; ASCII on kontrolunden sonra yalniz ASCII siniflari kalir. Hex kacis:
// Python r"..." icinde cift tirnak yazilamaz, JS RegExp.source '/' kacirir.
const DEGER_EN_COK = 2048;
const BOS_MASKE = '(bos)';
// crypto_hub_node_yeni_b64 ust siniri (2 rol x 2048 x JSON kacisi 2x + zarf ~ 11.2K).
const YENI_B64_AZAMI = 16384;
const DESEN = Object.freeze({
  ascii: String.raw`^[\x20-\x7e]+$`,
  yasak: String.raw`[;\x60]|\$\(`,
  url: String.raw`^(https?|wss?)://[^\x20\x22\x24\x27\x3b\x3c\x3e\x5c\x60]+$`,
  hostport: String.raw`^[A-Za-z0-9.-]+:[0-9]{1,5}$`,
  sir: String.raw`^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$`,
});
const BICIMLER = Object.freeze(['url', 'hostport', 'sir']);
// Bayraksiz: `$` yalniz metnin sonunda eslesir (Python'da bu yuzden fullmatch).
const DESEN_RE = Object.freeze({
  ascii: new RegExp(DESEN.ascii),
  yasak: new RegExp(DESEN.yasak),
  url: new RegExp(DESEN.url),
  hostport: new RegExp(DESEN.hostport),
  sir: new RegExp(DESEN.sir),
});

/**
 * Yeni deger dogrulamasi. null = gecerli (bos dahil: env bos degere yazilir); degilse neden
 * kodu: bicim | tip | karakter | uzun | yasak | url | hostport | sir. Sira Python
 * deger_dogrula ile BIREBIR. Deger KIRPILMAZ (trim yok): sir sessizce degismesin.
 * @param {unknown} deger
 * @param {string} bicim
 * @returns {string|null}
 */
function degerDogrula(deger, bicim) {
  if (!BICIMLER.includes(bicim)) return 'bicim';
  if (typeof deger !== 'string') return 'tip';
  if (deger === '') return null;
  if (!DESEN_RE.ascii.test(deger)) return 'karakter';
  if (deger.length > DEGER_EN_COK) return 'uzun';
  if (DESEN_RE.yasak.test(deger)) return 'yasak';
  if (bicim === 'url') return DESEN_RE.url.test(deger) ? null : 'url';
  if (bicim === 'hostport') {
    if (!DESEN_RE.hostport.test(deger)) return 'hostport';
    const port = Number(deger.slice(deger.lastIndexOf(':') + 1));
    return port >= 1 && port <= 65535 ? null : 'hostport';
  }
  return DESEN_RE.sir.test(deger) ? null : 'sir';
}

const URL_PARCA_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/;
const YETKI_RE = /^[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;
const YETKI6_RE = /^\[[0-9A-Fa-f:.]+\](:[0-9]{1,5})?$/;

/**
 * Maskeli gosterim (Python maskele aynasi + bos deger): sema://host[:port][/****], host:port,
 * ****, (bos), -. Yol, sorgu ve kullanici bilgisi hic gecmez. En cok 200 karakter.
 * @param {string|null|undefined} deger
 * @param {string} bicim
 * @returns {string}
 */
function maskele(deger, bicim) {
  if (deger == null) return '-';
  if (deger === '') return BOS_MASKE;
  if (bicim === 'sir') return '****';
  if (bicim === 'hostport') return DESEN_RE.hostport.test(deger) ? deger.slice(0, 200) : '****';
  const m = URL_PARCA_RE.exec(deger);
  if (!m) return '****';
  const sema = m[1];
  let yetki = m[2];
  const kalan = m[3];
  let gizli = false;
  if (yetki.includes('@')) {
    yetki = yetki.slice(yetki.lastIndexOf('@') + 1);
    gizli = true;
  }
  if (!YETKI_RE.test(yetki) && !YETKI6_RE.test(yetki)) return '****';
  if (kalan !== '' && kalan !== '/') gizli = true;
  return `${sema.toLowerCase()}://${yetki}${gizli ? '/****' : ''}`.slice(0, 200);
}

/** Talep numarasi metni (sunucu ve ekran AYNI): Smart numarasi varsa o, yoksa Portal kaydi. */
function talepNoMetni(externalTicketId, talepId) {
  const dis = String(externalTicketId == null ? '' : externalTicketId).trim();
  if (dis) return `Smart #${dis}`;
  return talepId != null && talepId !== '' ? `Portal #${talepId}` : 'Portal #?';
}

module.exports = {
  UIS_BILESENLER,
  uisDeseni,
  eskiDeseni,
  GRUP_RE,
  NODE_PROD_ACIK,
  nodeAcikMi,
  lokasyon,
  ES_KIRACI,
  esKiraciOf,
  GEREKCE_EN_AZ,
  GEREKCE_EN_COK,
  OKUMA_TAZE_MS,
  ONAY_DK,
  MAX_HEDEF,
  NODE_KAYNAKLARI,
  REFERANS_KAYNAKLARI,
  YASAK_ENV_RE,
  TAKILDI_DK,
  ES_TALEP_GUN,
  OCO_UFUK_GUN,
  OCO_SON_PAY_DK,
  OCO_TAKILDI_PAY_DK,
  OCO_ACIK_BEKLEME_DK,
  ocoSonBaslamaMs,
  ocoPencereKarari,
  talepNoMetni,
  DEGER_EN_COK,
  BOS_MASKE,
  YENI_B64_AZAMI,
  DESEN,
  BICIMLER,
  degerDogrula,
  maskele,
};
