// server/spa-report/intranet-takvim.cjs - Intranet SPA gecis takvimi (2026-11-27).
//
// Kullanici: "Intranet SPA sayfasini direkt bu listeye gore duzenler misin? gecisler tamamlandi,
// tek gormek istedigim sey su: set, gecis_tarihi, sira, ekip, ekip_eposta, namespace, uygulama,
// route_adresleri, dynatrace_durumu, dynatrace_istek, aciklama. Ayrica gecis tarihini bu sayfadan
// admin olarak duzeltebilmek istiyorum."
//
// KAYNAK: takvim Portal DB'de (intranet_spa_takvim), anahtar (set, namespace, uygulama): her
// uygulama DC basina bir satir (once bir DC'nin setlerinde, sonra digerininkinde; ayni uygulama
// farkli setlerde yer alir). Ilk yukleme ve sonrakiler: Admin sayfadan CSV yukler (onizle -> yukle);
// yukleme MEVCUT TAKVIMIN YERINE GECER, set planina dokunmaz. set / gecis_tarihi / sira YALNIZ
// takvimden gelir.
// SET PLANI (2026-11-27, intranet-set-plani.cjs): set basina tarih, DC, eski / yeni IP; Admin
// sayfadan duzenler ya da CSV yukler. Set tarihi degisince setin uygulama satirlari da o tarihe
// gecer (setSatirlariniTasi; set toplu tarih YALNIZ plan uzerinden, ikinci yol yok). Ayni uygulamanin
// ayni DC'de iki sette olmasi UYARIDIR, hata degil (DC plandan; plan yoksa denetlenmez): takvim
// onizlemesi uygulama basina, plan onizlemesi ve set duzeltmesi DC basina ozetle soyler.
//
// ALAN ONCELIGI: yuklenen liste bu sayfanin eski CSV disa aktarimindan turetildi (ayni sutun adlari,
// ayni bosluklu liste bicimi, ayni Dynatrace etiketleri): liste donmus bir anlik goruntudur. Bu
// yuzden (namespace, uygulama) canli Intranet SPA raporunda (intranet.cjs loadIntranet) eslesirse
//   ekip, ekip_eposta                   LISTE (bossa canli): sira = set icindeki EKIP sirasi; canli
//                                       ekip listeyi ezseydi ekip suzgeci ve sira grubu bozulurdu
//                                       (kullanici: "direkt bu listeye gore")
//   route_adresleri                     canli deger (bossa listeden)
//   dynatrace_durumu, dynatrace_istek   canli olcum (yalniz var / yok / servis-yok ise; olculemedi
//                                       ya da olcum-yok canli degeri listeyi EZMEZ)
//   aciklama                            canli uygulama beyaninin notu (bossa listedeki aciklama)
// Eslesmezse hepsi listeden. Satir hangi alanin nereden geldigini `kaynak` ile tasir.
// TAKVIMDE YOK: canli raporun PROD satirlarindan takvimde olmayanlar ayrica listelenir (sessizce
// kaybolmaz).
//
// YETKI: okuma sayfayi gorebilen herkes (intranet router'i requireAuth + requireVisible);
// yukleme ve tarih duzeltme yalniz Admin (requireAdmin), her degisiklik auditPortal'a yazilir.
// ESZAMANLILIK: satir basina `surum` (her yazimda +1). Tek satir duzeltme beklenenSurum, set planinda
// tarih degisikligi setin her satirinin surumunu gonderir; tutmazsa 409. Yukleme yeni satirlari eski planin
// en buyuk surumu + 1 ile yazar: eski ekrandan gelen surum yeni planda HIC tutmaz (ABA yok).
// Yukleme `kilit` gonderir (yukleme_id + surum toplami): onizlemeden sonra yapilan bir tarih
// duzeltmesi de toplami degistirir, yukleme onu sessizce silmez (409, onizleme tazelenir).
// ELLE DUZELTME: `elle_tarih` = 1 YALNIZ tek satir duzeltmesinde (/tarih). Set tarihi yayilimi
// (set plani duzeltmesi / plan yuklemesi) tasidigi satirlara 0 yazar (satir artik setin tarihini
// izler), yukleme 0 yazar. `guncelleyen` yalniz "son degistiren"dir, elle duzeltme anlamina gelmez.
// Takvim ve plan onizlemeleri yalniz elle_tarih = 1 satirlarin kaybini sayar.
'use strict';

const crypto = require('node:crypto');

const T = (s) => String(s == null ? '' : s).trim();
const L = (s) => T(s).toLowerCase();

/** Ekranda gosterilen Dynatrace etiketleri (eski disa aktarimla ayni metin). */
const ISTEK_ETIKET = {
  var: 'istek alıyor',
  yok: 'istek almıyor',
  'servis-yok': 'Dynatrace servisi yok',
  olculemedi: 'ölçülemedi',
  'olcum-yok': 'ölçüm yok',
};
/** Canli olcum listeyi yalniz bu durumlarda ezer (olculemedi / olcum-yok bir olcum degil). */
const OLCULEN = new Set(['var', 'yok', 'servis-yok']);

const SINIR = {
  // Govde global express.json({ limit: '2mb' }) (service.cjs) ile okunur: JSON'da bir karakter en
  // cok 3 bayt (Turkce harf 2, U+FFFD 3, kacisli tirnak 2) -> 600000 karakter 2mb'a sigar.
  metin: 600000,
  satir: 3000,
  hata: 50,
  namespace: 63,
  uygulama: 253,
  ekip: 1000,
  ekip_eposta: 2000,
  route_adresleri: 4000,
  dynatrace_durumu: 100,
  dynatrace_istek: 32,
  aciklama: 1000,
};

/** Kubernetes adlari: namespace DNS-1123 etiketi, uygulama DNS-1123 alt alan adi. '/' ve formul
 *  baslangici (esittir, arti, et isareti) giremez; '/' ile birlesen (ns, app) anahtari cakisamaz. */
const NS_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const APP_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

const ZORUNLU = ['set', 'gecis_tarihi', 'sira', 'namespace', 'uygulama'];
const SECMELI = [
  'ekip',
  'ekip_eposta',
  'route_adresleri',
  'dynatrace_durumu',
  'dynatrace_istek',
  'aciklama',
];

/** Ilk satirdan ayrac: ';' (Excel TR) ya da ','. */
function ayracBul(metin) {
  const ilk = metin.split(/\r?\n/, 1)[0] || '';
  const say = (c) => ilk.split(c).length - 1;
  return say(';') >= say(',') ? ';' : ',';
}

/** RFC 4180 kayitlari: tirnakli alan, "" kacisi, alan icinde satir sonu; CRLF / LF. */
function csvKayitlari(metin, ayrac) {
  const kayitlar = [];
  let kayit = [];
  let alan = '';
  let tirnak = false;
  let i = 0;
  const alanBitir = () => {
    kayit.push(alan);
    alan = '';
  };
  const kayitBitir = () => {
    alanBitir();
    kayitlar.push(kayit);
    kayit = [];
  };
  while (i < metin.length) {
    const c = metin[i];
    if (tirnak) {
      if (c === '"' && metin[i + 1] === '"') {
        alan += '"';
        i += 2;
        continue;
      }
      if (c === '"') tirnak = false;
      else alan += c;
      i += 1;
      continue;
    }
    if (c === '"') tirnak = true;
    else if (c === ayrac) alanBitir();
    else if (c === '\n') kayitBitir();
    else if (c !== '\r') alan += c;
    i += 1;
  }
  if (alan !== '' || kayit.length) kayitBitir();
  return { kayitlar, kapanmamisTirnak: tirnak };
}

/** Gun adlari (Pazar = 0), harf ve aksan duyarsiz karsilastirma icin katlanmis. */
const GUN_KATLI = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
const katla = (s) =>
  T(s)
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i');

/**
 * 'dd.mm.yyyy[ GunAdi]' ya da 'yyyy-mm-dd' -> 'yyyy-mm-dd'; gecersizse null. Gun adi verilmisse
 * tarihin gunu olmali: listede gun adiyla celisen tarih (elle duzeltilmis olabilir) sorulmadan
 * kabul edilmez.
 */
function tarihCoz(s) {
  const v = T(s);
  let g;
  let a;
  let y;
  let gunAdi = '';
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\S+))?$/.exec(v);
  if (m) [, g, a, y, gunAdi = ''] = m;
  else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return null;
    [, y, a, g] = m;
  }
  const yil = Number(y);
  const ay = Number(a);
  const gun = Number(g);
  if (yil < 2020 || yil > 2100) return null;
  const d = new Date(Date.UTC(yil, ay - 1, gun));
  if (d.getUTCFullYear() !== yil || d.getUTCMonth() !== ay - 1 || d.getUTCDate() !== gun)
    return null;
  if (gunAdi && katla(gunAdi) !== GUN_KATLI[d.getUTCDay()]) return null;
  return d.toISOString().slice(0, 10);
}

/** 'Pilot' -> sira 0, 'Set N' -> sira N (1..99); gecersizse null. */
function setCoz(s) {
  const v = T(s);
  if (/^pilot$/i.test(v)) return { ad: 'Pilot', sira: 0 };
  const m = /^set\s?(\d{1,2})$/i.exec(v);
  if (!m || Number(m[1]) < 1) return null;
  return { ad: `Set ${Number(m[1])}`, sira: Number(m[1]) };
}

/**
 * Ortak CSV tablo okuma (takvim ve set plani): BOM, bos / buyuk / UTF-8 olmayan dosya, kapanmamis
 * tirnak, tekrar eden ya da eksik zorunlu baslik, satir siniri, yalniz baslik. `veri` null ise dosya
 * butun olarak reddedildi; degilse her bos olmayan kayit `{ no, al }` (no: dosya satiri, baslik = 1;
 * sutun sayisi tutmayan kayit hata olarak yazilir ve `veri`ye girmez).
 */
function csvTabloOku(metinHam, { zorunlu, secmeli, satirSiniri }) {
  const metin = String(metinHam == null ? '' : metinHam).replace(/^\uFEFF/, '');
  const sonuc = { satirlar: [], hatalar: [], eksikSutun: [], yoksayilanSutun: [], toplam: 0 };
  const hata = (satir, mesaj) => {
    if (sonuc.hatalar.length < SINIR.hata) sonuc.hatalar.push({ satir, mesaj });
    sonuc.hataSayisi = (sonuc.hataSayisi || 0) + 1;
  };
  const red = (satir, mesaj) => {
    hata(satir, mesaj);
    return { sonuc, hata, veri: null };
  };
  if (!metin.trim()) return red(0, 'Dosya boş.');
  if (metin.length > SINIR.metin)
    return red(0, `Dosya çok büyük (en çok ${SINIR.metin} karakter).`);
  // KODLAMA: tarayici dosyayi UTF-8 okur; Excel'in "CSV (virgulle ayrilmis)" kaydi Windows-1254'tur
  // ve Turkce harfler U+FFFD olur. Bozuk metin DB'ye yazilmaz.
  if (metin.includes('\uFFFD'))
    return red(
      0,
      'Dosya UTF-8 değil (Türkçe harfler bozuk). Excel’de “CSV UTF-8” olarak kaydedin.',
    );
  const { kayitlar, kapanmamisTirnak } = csvKayitlari(metin, ayracBul(metin));
  if (kapanmamisTirnak) hata(0, 'Kapanmamış tırnak: dosya bozuk.');
  const baslik = (kayitlar[0] || []).map(L);
  const sutun = new Map(baslik.map((b, i) => [b, i]));
  const tekrarSutun = [...new Set(baslik.filter((b, i) => b && baslik.indexOf(b) !== i))];
  if (tekrarSutun.length) return red(1, `Başlıkta tekrar eden sütun: ${tekrarSutun.join(', ')}.`);
  sonuc.eksikSutun = zorunlu.filter((s) => !sutun.has(s));
  sonuc.yoksayilanSutun = baslik.filter((b) => b && !zorunlu.includes(b) && !secmeli.includes(b));
  if (sonuc.eksikSutun.length) return red(1, `Zorunlu sütun yok: ${sonuc.eksikSutun.join(', ')}.`);
  const dolu = (k) => k.some((h) => T(h));
  const sayi = kayitlar.slice(1).filter(dolu).length;
  sonuc.toplam = sayi;
  if (sayi > satirSiniri) return red(0, `Çok fazla satır: ${sayi} (en çok ${satirSiniri}).`);
  // YALNIZ BASLIK: yukleme mevcudun yerine gectigi icin bos dosya hepsini silerdi.
  if (!sayi) return red(0, 'Veri satırı yok: dosyada yalnız başlık var.');
  const veri = [];
  kayitlar.slice(1).forEach((k, idx) => {
    const no = idx + 2;
    if (!dolu(k)) return;
    if (k.length !== baslik.length) {
      hata(no, `Sütun sayısı ${k.length}, başlıkta ${baslik.length}.`);
      return;
    }
    veri.push({ no, al: (ad) => (sutun.has(ad) ? T(k[sutun.get(ad)]) : '') });
  });
  return { sonuc, hata, veri };
}

/** gecis_tarihi hucresi -> { tarih } ya da { sorun } (gun adi uyusmazligi ayri soylenir). */
function tarihHucresi(ham) {
  const tarih = tarihCoz(ham);
  if (tarih) return { tarih };
  if (tarihCoz(T(ham).split(/\s+/)[0]))
    return { sorun: `gecis_tarihi gün adı tarihe uymuyor ("${ham}")` };
  return { sorun: `gecis_tarihi geçersiz ("${ham}"; gg.aa.yyyy)` };
}

/**
 * CSV metnini takvim satirlarina cevirir. Satir hatasi varsa yukleme REDDEDILIR (takvim butun olarak
 * yer degistirir); hatalar satir numarasiyla (baslik = 1) doner. Anahtar (set, namespace, uygulama):
 * ayni uygulama farkli setlerde (DC'lerde) yer alir, ayni sette iki kez yer alamaz.
 */
function takvimAyristir(metinHam) {
  const { sonuc, hata, veri } = csvTabloOku(metinHam, {
    zorunlu: ZORUNLU,
    secmeli: SECMELI,
    satirSiniri: SINIR.satir,
  });
  if (!veri) return sonuc;
  const gorulen = new Map();
  for (const { no, al } of veri) {
    const set = setCoz(al('set'));
    const tarih = tarihHucresi(al('gecis_tarihi'));
    const siraMetin = al('sira');
    const sira = /^\d{1,4}$/.test(siraMetin) ? Number(siraMetin) : null;
    const s = {
      namespace: al('namespace'),
      uygulama: al('uygulama'),
      ekip: al('ekip'),
      ekip_eposta: al('ekip_eposta'),
      route_adresleri: al('route_adresleri'),
      dynatrace_durumu: al('dynatrace_durumu'),
      dynatrace_istek: al('dynatrace_istek'),
      aciklama: al('aciklama'),
    };
    const sorun = [];
    if (!set) sorun.push(`set geçersiz ("${al('set')}"; Pilot ya da Set N)`);
    if (tarih.sorun) sorun.push(tarih.sorun);
    if (sira == null || sira < 1) sorun.push(`sira geçersiz ("${siraMetin}")`);
    if (!s.namespace) sorun.push('namespace boş');
    else if (!NS_RE.test(s.namespace)) sorun.push(`namespace geçersiz ad ("${s.namespace}")`);
    if (!s.uygulama) sorun.push('uygulama boş');
    else if (!APP_RE.test(s.uygulama)) sorun.push(`uygulama geçersiz ad ("${s.uygulama}")`);
    for (const [ad, v] of Object.entries(s))
      if (v.length > SINIR[ad]) sorun.push(`${ad} çok uzun (${v.length} > ${SINIR[ad]})`);
    if (s.dynatrace_istek && !/^\d{1,15}$/.test(s.dynatrace_istek))
      sorun.push(`dynatrace_istek sayı değil ("${s.dynatrace_istek}")`);
    const anahtar = set ? anahtarOf(set.ad, s.namespace, s.uygulama) : null;
    if (anahtar && s.namespace && s.uygulama && gorulen.has(anahtar))
      sorun.push(
        `${set.ad} içinde ${s.namespace}/${s.uygulama} ${gorulen.get(anahtar)}. satırda da var`,
      );
    if (sorun.length) {
      hata(no, sorun.join('; ') + '.');
      continue;
    }
    gorulen.set(anahtar, no);
    sonuc.satirlar.push({ ...s, set: set.ad, setSira: set.sira, gecisTarihi: tarih.tarih, sira });
  }
  return sonuc;
}

/** Canli istek sayisi yalniz olculduyse (null -> bos). */
const canliIstek = (c) => (c.req == null ? '' : String(c.req));

/** Canli rapor eslesmesi (namespace, uygulama): uygulamanin her DC satiri ayni canli satira eslesir. */
const canliAnahtar = (ns, app) => `${L(ns)}/${L(app)}`;
/** Takvim satiri anahtari (set, namespace, uygulama); harf duyarsiz (DB UNIQUE ile ayni). */
const anahtarOf = (set, ns, app) => `${L(set)}|${canliAnahtar(ns, app)}`;

/** elle_tarih BIT: mssql true / false doner (sayi da olabilir). */
const elleMi = (x) => Number(x.elle_tarih) === 1;

/** DB satiri -> ekran satiri (birlestirmeden once). */
function satirdan(x) {
  return {
    set: x.set_adi,
    setSira: Number(x.set_sira),
    gecisTarihi: x.gecis_tarihi,
    sira: Number(x.sira),
    namespace: x.namespace,
    uygulama: x.uygulama,
    ekip: x.ekip || '',
    ekip_eposta: x.ekip_eposta || '',
    route_adresleri: x.route_adresleri || '',
    dynatrace_durumu: x.dynatrace_durumu || '',
    dynatrace_istek: x.dynatrace_istek || '',
    aciklama: x.aciklama || '',
    surum: Number(x.surum),
    guncelleyen: x.guncelleyen || null,
    guncelleme: x.guncelleme || null,
    elleTarih: elleMi(x),
  };
}

/** Takvim + canli rapor (ALAN ONCELIGI dosya basinda). */
function birlestir(takvim, rapor) {
  const canli = new Map();
  for (const r of rapor?.rows || []) {
    const k = canliAnahtar(r.namespace, r.application);
    if (!canli.has(k) || r.env === 'PROD') canli.set(k, r);
  }
  const takvimde = new Set();
  const rows = takvim.map((t) => {
    const k = canliAnahtar(t.namespace, t.uygulama);
    takvimde.add(k);
    const c = canli.get(k) || null;
    const liste = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).join(' ') : '');
    const sec = (canliDeger, listeDeger) =>
      canliDeger ? { v: canliDeger, k: 'canli' } : { v: listeDeger, k: 'liste' };
    const listeOnce = (listeDeger, canliDeger) =>
      listeDeger || !canliDeger ? { v: listeDeger, k: 'liste' } : { v: canliDeger, k: 'canli' };
    const ekip = listeOnce(t.ekip, c && liste(c.ekip));
    const eposta = listeOnce(t.ekip_eposta, c && liste(c.ekipEposta));
    const route = sec(c && liste(c.adresler), t.route_adresleri);
    const olculdu = !!c && OLCULEN.has(c.istek);
    const canliNot = c ? T(c.note) : '';
    const not = sec(canliNot, t.aciklama);
    return {
      set: t.set,
      setSira: t.setSira,
      gecisTarihi: t.gecisTarihi,
      sira: t.sira,
      ekip: ekip.v,
      ekipEposta: eposta.v,
      namespace: t.namespace,
      uygulama: t.uygulama,
      routeAdresleri: route.v,
      dynatraceDurumu: olculdu ? ISTEK_ETIKET[c.istek] : t.dynatrace_durumu,
      dynatraceIstek: olculdu ? canliIstek(c) : t.dynatrace_istek,
      aciklama: not.v,
      kaynak: {
        ekip: ekip.k,
        ekipEposta: eposta.k,
        routeAdresleri: route.k,
        dynatrace: olculdu ? 'canli' : 'liste',
        aciklama: not.k,
      },
      canli: !!c,
      // ACIKLAMA DUZENLEME (yalniz Admin, ekran): kutu yalniz canli notu tasir, listedeki aciklama
      // yer tutucu olur; boylece not silinebilir ve liste metni sessizce nota donusmez. Yazim canli
      // raporun ns / app yazimiyla ve uygulama beyani (inUse) DEGISMEDEN gider.
      canliNot: c ? canliNot : null,
      listeAciklama: t.aciklama,
      canliNamespace: c ? c.namespace : null,
      canliUygulama: c ? c.application : null,
      inUse: c ? c.inUse || null : null,
      surum: t.surum,
      guncelleyen: t.guncelleyen,
      guncelleme: t.guncelleme,
    };
  });
  const takvimdeYok = (rapor?.rows || [])
    .filter((r) => r.env === 'PROD' && !takvimde.has(canliAnahtar(r.namespace, r.application)))
    .map((r) => ({
      namespace: r.namespace,
      uygulama: r.application,
      ekip: (r.ekip || []).join(' '),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.uygulama.localeCompare(b.uygulama));
  return { rows, takvimdeYok };
}

const SECIM = `SELECT set_adi, set_sira, CONVERT(varchar(10), gecis_tarihi, 23) AS gecis_tarihi, sira,
       namespace, uygulama, ekip, ekip_eposta, route_adresleri, dynatrace_durumu, dynatrace_istek,
       aciklama, surum, guncelleyen, elle_tarih, CONVERT(varchar(33), guncelleme, 126) AS guncelleme
  FROM intranet_spa_takvim`;
const SIRA = 'ORDER BY set_sira, sira, namespace, uygulama';

async function takvimOku(db) {
  const { rows } = await db.query(`${SECIM} ${SIRA}`);
  const y = await db.query(
    `SELECT TOP 1 yukleme_id, yukleyen, CONVERT(varchar(33), yukleme_zamani, 126) AS yukleme_zamani
       FROM intranet_spa_takvim ORDER BY yukleme_zamani DESC`,
  );
  const ilk = y.rows[0];
  return {
    rows: rows.map(satirdan),
    yukleme: ilk
      ? {
          id: ilk.yukleme_id,
          yukleyen: ilk.yukleyen || null,
          zaman: ilk.yukleme_zamani || null,
          kilit: kilitOf(ilk.yukleme_id, rows),
        }
      : null,
  };
}

/** Yukleme kilidi: yukleme kimligi + satir sayisi + surum toplami (her tarih yazimi toplami artirir). */
function kilitOf(yuklemeId, rows) {
  if (!rows.length) return null;
  const toplam = rows.reduce((n, r) => n + Number(r.surum || 0), 0);
  return `${yuklemeId}:${rows.length}:${toplam}`;
}

function setOzeti(satirlar) {
  const m = new Map();
  for (const s of satirlar) {
    if (!m.has(s.set)) m.set(s.set, { set: s.set, sira: s.setSira, satir: 0, tarihler: new Set() });
    const o = m.get(s.set);
    o.satir += 1;
    o.tarihler.add(s.gecisTarihi);
  }
  return [...m.values()]
    .sort((a, b) => a.sira - b.sira)
    .map((o) => ({
      set: o.set,
      satir: o.satir,
      tarihler: [...o.tarihler].sort((a, b) => a.localeCompare(b)),
    }));
}

const KOLONLAR = [
  'set_adi',
  'set_sira',
  'gecis_tarihi',
  'sira',
  'namespace',
  'uygulama',
  'ekip',
  'ekip_eposta',
  'route_adresleri',
  'dynatrace_durumu',
  'dynatrace_istek',
  'aciklama',
  'yukleme_id',
  'yukleyen',
  'surum',
];
const PARCA = 50;

/** Yukleme kilidi icin surum ozeti: satir sayisi + surum toplami + en buyuk surum (yeniden yukleme
 *  en buyuk surumun ustunden yazar, tek satir yazimi toplami artirir). */
function surumKilidi(rows) {
  let toplam = 0;
  let enBuyuk = 0;
  for (const r of rows) {
    const s = Number(r.surum || 0);
    toplam += s;
    enBuyuk = Math.max(enBuyuk, s);
  }
  return `${rows.length}:${toplam}:${enBuyuk}`;
}

const setSirasi = (s) => setCoz(s)?.sira ?? Number.MAX_SAFE_INTEGER;

/**
 * Ayni uygulama ayni DC'de birden fazla sette: [{ dc, namespace, uygulama, setler }]. Satir
 * { set, namespace, uygulama }; DC set planindan, kirpilmis ve harf duyarsiz (ekrandaki DC grubuyla
 * ayni kural). Planda olmayan ya da DC'si bos set denetlenmez.
 */
function ayniDcCiftleri(satirlar, plan) {
  const planM = new Map(plan.map((p) => [L(p.set), p]));
  const grup = new Map();
  for (const s of satirlar) {
    const p = planM.get(L(s.set));
    if (!p || !T(p.dc)) continue;
    const k = `${L(p.dc)}|${canliAnahtar(s.namespace, s.uygulama)}`;
    if (!grup.has(k))
      grup.set(k, { dc: T(p.dc), namespace: s.namespace, uygulama: s.uygulama, setler: [] });
    grup.get(k).setler.push(s.set);
  }
  return [...grup.values()]
    .filter((c) => c.setler.length > 1)
    .map((c) => ({ ...c, setler: [...c.setler].sort((a, b) => setSirasi(a) - setSirasi(b)) }));
}

/**
 * Plan yuklemesi ve set duzeltmesi icin ozet: DC basina kac uygulama birden fazla sette (365
 * uygulamayi tek tek saymaz). `yalnizSet` verilirse yalniz o seti iceren ciftler.
 */
function ayniDcOzeti(satirlar, plan, yalnizSet = null) {
  const dcM = new Map();
  for (const c of ayniDcCiftleri(satirlar, plan)) {
    if (yalnizSet && !c.setler.includes(yalnizSet)) continue;
    const k = L(c.dc);
    if (!dcM.has(k)) dcM.set(k, { dc: c.dc, n: 0, setler: new Set() });
    const o = dcM.get(k);
    o.n += 1;
    for (const s of c.setler) o.setler.add(s);
  }
  return [...dcM.values()].map(
    (o) =>
      `Aynı DC’de (${o.dc}) ${o.n} uygulama birden fazla sette: ${[...o.setler]
        .sort((a, b) => setSirasi(a) - setSirasi(b))
        .join(', ')}.`,
  );
}

/**
 * Takvim onizleme uyarilari (yuklemeyi ENGELLEMEZ). Plan = set plani satirlari ({ set, dc,
 * gecisTarihi }); bossa DC denetimi yapilamaz ve bu soylenir.
 *   - ayni uygulama ayni DC'de iki sette (DC plandan; DC'si bos set denetlenmez)
 *   - setin satirlarinin tarihi set planinin tarihinden farkli (sayi)
 *   - planda olmayan set
 */
function takvimUyarilari(satirlar, plan) {
  const uyarilar = [];
  if (!plan.length) {
    uyarilar.push('Set planı yok: aynı uygulamanın aynı DC’de iki sette olması denetlenmedi.');
    return uyarilar;
  }
  const planM = new Map(plan.map((p) => [L(p.set), p]));
  const tarihFark = new Map();
  const plansiz = new Set();
  for (const s of satirlar) {
    const p = planM.get(L(s.set));
    if (!p) plansiz.add(s.set);
    else if (p.gecisTarihi !== s.gecisTarihi) tarihFark.set(s.set, (tarihFark.get(s.set) || 0) + 1);
  }
  for (const c of ayniDcCiftleri(satirlar, plan))
    uyarilar.push(
      `${c.namespace}/${c.uygulama} aynı DC’de (${c.dc}) ${c.setler.length} sette: ${c.setler.join(', ')}.`,
    );
  for (const [set, n] of tarihFark)
    uyarilar.push(
      `${set}: ${n} uygulamanın tarihi set planındaki tarihten (${planM.get(L(set)).gecisTarihi}) farklı.`,
    );
  if (plansiz.size) uyarilar.push(`Set planında olmayan set: ${[...plansiz].join(', ')}.`);
  return uyarilar;
}

/**
 * SET TARIHI YAYILIMI (set plani duzeltmesi ve plan yuklemesi, intranet-set-plani.cjs): setin
 * tarihi `tarih`ten farkli satirlari o tarihe gecer (surum + 1, guncelleyen = by, elle_tarih = 0:
 * tasinan satir artik setin tarihini izler, sonraki onizleme onu elle duzeltme kaybi saymaz). Cagiran
 * transaction icinde, satir kilidiyle. `beklenen` verilirse ({ "ns/app": surum }) setin HER
 * satirinin surumu tutmali (fazla ya da eksik anahtar da), yoksa { cakisma: true } (eski ekran setin
 * satirlarini ezmez).
 */
async function setSatirlariniTasi(tx, { setAdi, tarih, by, beklenen }) {
  const { rows } = await tx.query(
    `SELECT namespace, uygulama, surum, CONVERT(varchar(10), gecis_tarihi, 23) AS gecis_tarihi
       FROM intranet_spa_takvim WITH (UPDLOCK, HOLDLOCK) WHERE set_adi = $1`,
    [setAdi],
  );
  if (beklenen) {
    const tutar =
      Object.keys(beklenen).length === rows.length &&
      rows.every((r) => Number(beklenen[`${r.namespace}/${r.uygulama}`]) === Number(r.surum));
    if (!tutar) return { cakisma: true };
  }
  const tasinan = rows.filter((r) => r.gecis_tarihi !== tarih);
  if (tasinan.length)
    await tx.query(
      `UPDATE intranet_spa_takvim
          SET gecis_tarihi = CONVERT(date, $1, 23), surum = surum + 1, guncelleyen = $2,
              elle_tarih = 0, guncelleme = SYSUTCDATETIME()
        WHERE set_adi = $3 AND gecis_tarihi <> CONVERT(date, $1, 23)`,
      [tarih, by, setAdi],
    );
  return {
    cakisma: false,
    satir: rows.length,
    tasinan: tasinan.length,
    eski: [...new Set(tasinan.map((r) => r.gecis_tarihi))].sort((a, b) => a.localeCompare(b)),
  };
}

/** Setin satirlari (ham, birlestirmesiz): yazim yanitlari icin. */
async function setSatirlari(tx, setAdi) {
  const { rows } = await tx.query(`${SECIM} WHERE set_adi = $1 ${SIRA}`, [setAdi]);
  return rows.map(satirdan);
}

function denetle(req, eylem, detay) {
  try {
    require('../audit/index.cjs').auditPortal(req, eylem, { detail: JSON.stringify(detay) });
  } catch {
    /* best-effort */
  }
}

const kim = (req) => require('../auth/utils.cjs').getRequestUser(req)?.username || null;

const CAKISMA = 'takvim_cakisma';

function mountTakvim(router, deps) {
  const dbOf = () => deps.db || require('../db/index.cjs');
  const requireAdmin = (req, res, next) =>
    require('../auth/index.cjs').requireAdmin(req, res, next);
  const dbHatasi = (res, e, mesaj) => {
    console.error('[IntranetSPA] takvim hatasi:', e.message);
    res.status(500).json({ ok: false, message: mesaj });
  };
  // Set plani modulu bu modulun yardimcilarini kullanir: dongusel bagimlilik olmasin diye burada
  // (gec) yuklenir.
  const setPlani = require('./intranet-set-plani.cjs');

  const requireAuth = (req, res, next) => require('../auth/index.cjs').requireAuth(req, res, next);

  router.get('/intranet/takvim', requireAuth, async (req, res) => {
    let t;
    let plan;
    try {
      t = await takvimOku(dbOf());
      plan = await setPlani.planOku(dbOf());
    } catch (e) {
      console.error('[IntranetSPA] takvim okunamadi:', e.message);
      return res.status(502).json({ ok: false, message: 'Geçiş takvimi okunamadı.' });
    }
    let rapor = null;
    let canliHata = '';
    try {
      rapor = await deps.loadIntranet(String(req.query.fresh || '') === '1');
      if (rapor?.ok === false) canliHata = rapor.message || 'Canlı rapor alınamadı.';
    } catch (e) {
      canliHata = e.message || 'Canlı rapor alınamadı.';
    }
    const { rows, takvimdeYok } = birlestir(t.rows, canliHata ? null : rapor);
    let durum = 'var';
    if (canliHata) durum = 'okunamadi';
    else if (rapor?.notScanned) durum = 'taranmadi';
    res.json({
      ok: true,
      yukleme: t.yukleme,
      rows,
      plan,
      takvimdeYok,
      canli: {
        durum,
        message: canliHata || '',
        kesifTarihi: rapor?.kesifTarihi || null,
        dynatraceOkunamadi: !!rapor?.dynatraceOkunamadi,
      },
    });
  });

  router.post('/intranet/takvim/onizle', requireAdmin, async (req, res) => {
    const a = takvimAyristir(req.body?.metin);
    let mevcut = [];
    let yukleme = null;
    let plan = [];
    try {
      const t = await takvimOku(dbOf());
      mevcut = t.rows;
      yukleme = t.yukleme;
      plan = await setPlani.planOku(dbOf());
    } catch (e) {
      return dbHatasi(res, e, 'Mevcut takvim okunamadı.');
    }
    const k = (x) => anahtarOf(x.set, x.namespace, x.uygulama);
    const eski = new Map(mevcut.map((m) => [k(m), m]));
    const yeniM = new Map(a.satirlar.map((s) => [k(s), s]));
    let yeni = 0;
    let tarihDegisen = 0;
    for (const s of a.satirlar) {
      const m = eski.get(k(s));
      if (!m) yeni += 1;
      else if (m.gecisTarihi !== s.gecisTarihi) tarihDegisen += 1;
    }
    // ELLE DUZELTILMIS tarih (elle_tarih, yalniz tek satir duzeltmesi) yeni listede yoksa ya da
    // baska tarihteyse kaybolur.
    const elleKaybolan = mevcut.filter((m) => {
      if (!m.elleTarih) return false;
      const s = yeniM.get(k(m));
      return !s || s.gecisTarihi !== m.gecisTarihi;
    }).length;
    const uyarilar = a.hataSayisi ? [] : takvimUyarilari(a.satirlar, plan);
    res.json({
      ok: true,
      gecerli: !a.hataSayisi,
      satir: a.satirlar.length,
      toplam: a.toplam,
      setler: setOzeti(a.satirlar),
      hatalar: a.hatalar,
      hataSayisi: a.hataSayisi || 0,
      yoksayilanSutun: a.yoksayilanSutun,
      uyarilar: uyarilar.slice(0, SINIR.hata),
      uyariSayisi: uyarilar.length,
      fark: {
        mevcut: mevcut.length,
        yeni,
        kalkan: mevcut.filter((m) => !yeniM.has(k(m))).length,
        tarihDegisen,
        elleKaybolan,
      },
      yukleme,
    });
  });

  router.post('/intranet/takvim/yukle', requireAdmin, async (req, res) => {
    const a = takvimAyristir(req.body?.metin);
    if (a.hataSayisi)
      return res.status(400).json({
        ok: false,
        message: `Dosyada ${a.hataSayisi} hata var; takvim değiştirilmedi.`,
        hatalar: a.hatalar,
      });
    const beklenen = T(req.body?.beklenenKilit) || null;
    const by = kim(req);
    const id = crypto.randomUUID();
    try {
      const sonuc = await dbOf().transaction(async (tx) => {
        const { rows } = await tx.query(
          'SELECT yukleme_id, surum FROM intranet_spa_takvim WITH (UPDLOCK, HOLDLOCK)',
        );
        const simdiki = rows[0]?.yukleme_id || null;
        if (kilitOf(simdiki, rows) !== beklenen) return { cakisma: true };
        // ABA: yeni satirlar eski takvimin en buyuk surumunun ustunden baslar.
        const taban = rows.reduce((n, r) => Math.max(n, Number(r.surum || 0)), 0) + 1;
        await tx.query('DELETE FROM intranet_spa_takvim');
        for (let i = 0; i < a.satirlar.length; i += PARCA) {
          const parca = a.satirlar.slice(i, i + PARCA);
          const params = [];
          const degerler = parca.map((s) => {
            const v = [
              s.set,
              s.setSira,
              s.gecisTarihi,
              s.sira,
              s.namespace,
              s.uygulama,
              s.ekip,
              s.ekip_eposta,
              s.route_adresleri,
              s.dynatrace_durumu,
              s.dynatrace_istek,
              s.aciklama,
              id,
              by,
              taban,
            ];
            const yer = v.map((d, j) => {
              params.push(d);
              const p = `$${params.length}`;
              return j === 2 ? `CONVERT(date, ${p}, 23)` : p;
            });
            return `(${yer.join(', ')})`;
          });
          await tx.query(
            `INSERT INTO intranet_spa_takvim (${KOLONLAR.join(', ')}) VALUES ${degerler.join(', ')}`,
            params,
          );
        }
        return { cakisma: false, onceki: simdiki };
      });
      if (sonuc.cakisma)
        return res.status(409).json({
          ok: false,
          code: CAKISMA,
          message:
            'Takvim siz önizlerken başka biri tarafından değiştirildi. Önizlemeyi yenileyip tekrar deneyin.',
        });
      denetle(req, 'intranet_spa_takvim_yukle', {
        yukleme: id,
        onceki: sonuc.onceki,
        satir: a.satirlar.length,
        setler: setOzeti(a.satirlar).map((s) => `${s.set}:${s.satir}`),
      });
      res.json({ ok: true, yukleme: id, satir: a.satirlar.length });
    } catch (e) {
      return dbHatasi(res, e, 'Takvim yüklenemedi.');
    }
  });

  // TEK SATIR tarih duzeltme; anahtar (set, namespace, uygulama). Set toplu tarih bu uctan DEGIL,
  // set planindan gider (PUT /intranet/takvim/set): iki ayri yol yok.
  router.put('/intranet/takvim/tarih', requireAdmin, async (req, res) => {
    const tarih = tarihCoz(req.body?.tarih);
    if (!tarih) return res.status(400).json({ ok: false, message: 'Geçersiz tarih (yyyy-aa-gg).' });
    const by = kim(req);
    const setAdi = setCoz(req.body?.set)?.ad || '';
    const ns = T(req.body?.namespace);
    const app = T(req.body?.uygulama);
    if (!setAdi || !ns || !app)
      return res.status(400).json({
        ok: false,
        message: 'set, namespace ve uygulama zorunlu (setin tarihi set planından değişir).',
      });
    const beklenenSurum = Number(req.body?.beklenenSurum);
    if (!Number.isInteger(beklenenSurum))
      return res.status(400).json({ ok: false, message: 'beklenenSurum zorunlu.' });
    const kosul = 'WHERE set_adi = $1 AND namespace = $2 AND uygulama = $3';
    try {
      // Okuma, surum denetimi ve yazim TEK transaction'da, satir kilidi altinda: audit'in "eski"
      // degeri yazimdan hemen onceki degerdir.
      const sonuc = await dbOf().transaction(async (tx) => {
        const once = await tx.query(`${SECIM} WITH (UPDLOCK, HOLDLOCK) ${kosul}`, [
          setAdi,
          ns,
          app,
        ]);
        if (!once.rows.length) return { yok: true };
        const eski = satirdan(once.rows[0]);
        if (eski.surum !== beklenenSurum) return { cakisma: true, satir: eski };
        await tx.query(
          `UPDATE intranet_spa_takvim
              SET gecis_tarihi = CONVERT(date, $4, 23), surum = surum + 1, guncelleyen = $5,
                  elle_tarih = 1, guncelleme = SYSUTCDATETIME()
            ${kosul} AND surum = $6`,
          [setAdi, ns, app, tarih, by, beklenenSurum],
        );
        const sonra = await tx.query(`${SECIM} ${kosul}`, [setAdi, ns, app]);
        return { eski: eski.gecisTarihi, satir: sonra.rows[0] ? satirdan(sonra.rows[0]) : null };
      });
      if (sonuc.yok) return res.status(404).json({ ok: false, message: 'Uygulama takvimde yok.' });
      if (sonuc.cakisma)
        return res.status(409).json({
          ok: false,
          code: CAKISMA,
          message: `${setAdi} ${ns}/${app} siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin.`,
          satir: sonuc.satir,
        });
      denetle(req, 'intranet_spa_takvim_tarih', {
        set: setAdi,
        namespace: ns,
        uygulama: app,
        eski: sonuc.eski,
        yeni: tarih,
      });
      return res.json({ ok: true, rows: sonuc.satir ? [sonuc.satir] : [] });
    } catch (e) {
      return dbHatasi(res, e, 'Geçiş tarihi güncellenemedi.');
    }
  });

  setPlani.mountSetPlani(router, { dbOf, requireAdmin, dbHatasi });
}

module.exports = {
  mountTakvim,
  takvimAyristir,
  csvTabloOku,
  tarihHucresi,
  takvimUyarilari,
  ayniDcOzeti,
  setSatirlariniTasi,
  setSatirlari,
  surumKilidi,
  takvimOku,
  denetle,
  kim,
  tarihCoz,
  setCoz,
  birlestir,
  anahtarOf,
  CAKISMA,
  ISTEK_ETIKET,
  SINIR,
};
