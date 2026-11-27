// shared/kurumAyari.cjs - kurum ayari dosyasinin saf kurallari (2026-11-27).
//
// Kullanan: server/util/kurum-ayari.cjs (SUNUCU adi kurali, okuma), server/admin/kurum-ayari-duzenle.cjs
// (Admin > Kurum Ayari kaydi: sunucu adi denetimi, denetim kaydina giden anahtar yollari) ve ekranda
// src/components/admin/tabs/KurumAyariTab.tsx (kaydetmeden once fark on izlemesi). Iki taraf ayni
// kurali ve ayni fark hesabini kullanir; ekranin gosterdigi fark sunucunun denetime yazdigiyla aynidir.
'use strict';

// Sunucu adi: harf ile baslar, harf / rakam / tire (okuyan taraf buyuk harfe cevirir).
const SUNUCU = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;

// Kodun sunucu adi olarak okudugu alanlar (server/util/kurum-ayari.cjs sunucuListesi / sunucuHaritasi /
// sunucuAdi cagrilari ve SUNUCU kuraliyla suzen bolum(...) okuyuculari). Okuyan taraf gecersiz girdiyi SESSIZCE atar ("n gecersiz girdi atildi"):
// yazim hatasi bir sunucuyu otomasyondan duser. Bu yuzden kayitta yeni ihlal reddedilir.
// '*' bir nesnenin her anahtari demektir; tur 'anahtarlar': nesnenin ANAHTARLARI sunucu adidir. Liste ile kodun esitligini kurum-ayari-duzenle.test.js kilitler.
const SUNUCU_ALANLARI = Object.freeze([
  { yol: 'nginx.intranetSunuculari', tur: 'liste' },
  { yol: 'nginx.internetRpNonprod', tur: 'harita' },
  { yol: 'nginx.gocGruplari.*.eski', tur: 'liste' },
  { yol: 'nginx.gocGruplari.*.yeni', tur: 'liste' },
  { yol: 'nginx.apiKumeleri', tur: 'harita' },
  { yol: 'nginx.apiGeneratorNonprod', tur: 'harita' },
  { yol: 'nginx.exposeHedefi', tur: 'ad' },
  { yol: 'nginx.yukTesti.derlemeSunucusu', tur: 'ad' },
  { yol: 'nginx.yukTesti.varsayilanYukSunuculari', tur: 'liste' },
  { yol: 'opsx.dbIslemSunucusu', tur: 'ad' },
  { yol: 'opsx.metadataHubTamRestart', tur: 'liste' },
  // server/nginx-console/rvp-ayari.cjs bolum('nginx.rvp') ile okur, ayni kuralla sessizce atar.
  { yol: 'nginx.rvp.sunucular', tur: 'anahtarlar' },
  { yol: 'nginx.rvp.kutular', tur: 'harita' },
]);

const nesneMi = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Ic ice gecme siniri: fark hesabi ozyinelidir, cok derin icerik yigini tasirirdi (RangeError).
const MAKS_DERINLIK = 64;

/** Deger MAKS_DERINLIK'ten derin mi (yinelemeli; kendisi yigin tasirmaz). */
function derinlikAsildi(v, sinir = MAKS_DERINLIK) {
  const yigin = [[v, 1]];
  while (yigin.length) {
    const [d, n] = yigin.pop();
    if (d === null || typeof d !== 'object') continue;
    if (n > sinir) return true;
    for (const c of Object.values(d)) yigin.push([c, n + 1]);
  }
  return false;
}
const ilkelMi = (v) => v === null || typeof v !== 'object';
const DUZ_ANAHTAR = /^[A-Za-z_$][\w$-]*$/;

/** Okunur anahtar yolu: a.b, a["x.y"], a[3]. */
function yolEkle(ust, anahtar) {
  if (typeof anahtar === 'number') return `${ust}[${anahtar}]`;
  if (!DUZ_ANAHTAR.test(anahtar)) return `${ust}[${JSON.stringify(anahtar)}]`;
  return ust ? `${ust}.${anahtar}` : anahtar;
}

/** Derin esitlik; nesnede anahtar sirasi onemsiz, listede sira onemli. */
function esit(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => esit(x, b[i]))
    );
  }
  if (!nesneMi(a) || !nesneMi(b)) return false;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && esit(a[k], b[k]))
  );
}

/** a'da olup b'de olmayan degerler (tekrar sayisiyla). */
function cokluFark(a, b) {
  const sayac = new Map();
  for (const v of b) {
    const k = JSON.stringify(v);
    sayac.set(k, (sayac.get(k) || 0) + 1);
  }
  const fark = [];
  for (const v of a) {
    const k = JSON.stringify(v);
    const n = sayac.get(k) || 0;
    if (n > 0) sayac.set(k, n - 1);
    else fark.push(v);
  }
  return fark;
}

function gez(a, b, yol, f) {
  if (esit(a, b)) return;
  if (nesneMi(a) && nesneMi(b)) {
    for (const k of Object.keys(a)) {
      if (Object.hasOwn(b, k)) gez(a[k], b[k], yolEkle(yol, k), f);
      else f.silinen.push({ yol: yolEkle(yol, k), deger: a[k] });
    }
    for (const k of Object.keys(b))
      if (!Object.hasOwn(a, k)) f.eklenen.push({ yol: yolEkle(yol, k), deger: b[k] });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.every(ilkelMi) && b.every(ilkelMi)) {
      const eklenen = cokluFark(b, a);
      const cikan = cokluFark(a, b);
      f.listeler.push({ yol, eklenen, cikan, siraDegisti: !eklenen.length && !cikan.length });
      return;
    }
    // Nesne ogeli liste: ayni siradaki ogeler alan alan, fazla ogeler eklenen / silinen.
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) gez(a[i], b[i], yolEkle(yol, i), f);
    for (let i = n; i < b.length; i++) f.eklenen.push({ yol: yolEkle(yol, i), deger: b[i] });
    for (let i = n; i < a.length; i++) f.silinen.push({ yol: yolEkle(yol, i), deger: a[i] });
    return;
  }
  f.degisen.push({ yol, eski: a, yeni: b });
}

/**
 * Iki ayar nesnesinin farki. Ilkel ogeli listeler kume gibi okunur (eklenen / cikan deger);
 * nesne ogeli listeler sira numarasiyla alan alan (`l[2].aciklama`), fazla ogeler eklenen / silinen;
 * tur degisiminde alan butun olarak "degisen" sayilir. Ozyinelidir: cagiran derinligi sinirlar
 * (sunucu kayitta MAKS_DERINLIK).
 * @param {unknown} eski
 * @param {unknown} yeni
 * @returns {{ eklenen: {yol: string, deger: unknown}[], silinen: {yol: string, deger: unknown}[],
 *   degisen: {yol: string, eski: unknown, yeni: unknown}[],
 *   listeler: {yol: string, eklenen: unknown[], cikan: unknown[], siraDegisti: boolean}[] }}
 */
function farkHesapla(eski, yeni) {
  const f = { eklenen: [], silinen: [], degisen: [], listeler: [] };
  gez(eski, yeni, '', f);
  return f;
}

/** Fark yok mu. */
function farkBosMu(f) {
  return !f.eklenen.length && !f.silinen.length && !f.degisen.length && !f.listeler.length;
}

/** Yalniz anahtar yollari, sirali (denetim kaydi degerleri tasimaz). */
function farkYollari(f) {
  const yollar = (l) => l.map((x) => x.yol).sort((a, b) => a.localeCompare(b));
  return {
    eklenen: yollar(f.eklenen),
    silinen: yollar(f.silinen),
    degisen: yollar([...f.degisen, ...f.listeler]),
  };
}

/** Kalip yolunu ('a.*.b') nesnede somut yollara acar; olmayan alan atlanir (okuyan taraf "yok" der). */
function alanlariAc(veri, kalip) {
  let adaylar = [{ yol: '', deger: veri }];
  for (const parca of kalip.split('.')) {
    const sonraki = [];
    for (const a of adaylar) {
      if (!nesneMi(a.deger)) continue;
      const anahtarlar = parca === '*' ? Object.keys(a.deger) : [parca];
      for (const k of anahtarlar)
        if (Object.hasOwn(a.deger, k)) sonraki.push({ yol: yolEkle(a.yol, k), deger: a.deger[k] });
    }
    adaylar = sonraki;
  }
  return adaylar;
}

const gecerliAd = (v) => typeof v === 'string' && SUNUCU.test(v.trim());

function listeIhlalleri(yol, deger, out) {
  if (!Array.isArray(deger)) {
    out.push({ yol, neden: 'liste-degil', iz: `${yol}|liste-degil` });
    return;
  }
  deger.forEach((v, i) => {
    if (!gecerliAd(v))
      out.push({ yol: `${yol}[${i}]`, neden: 'gecersiz-ad', iz: `${yol}|${JSON.stringify(v)}` });
  });
}

/**
 * Bilinen sunucu adi alanlarindaki ihlaller. `iz` eski / yeni karsilastirmasi icindir (degeri tasir;
 * sunucu yanita ve denetime yalniz `yol` + `neden` yazar).
 * @returns {{ yol: string, neden: 'gecersiz-ad' | 'liste-degil' | 'nesne-degil', iz: string }[]}
 */
function sunucuIhlalleri(veri) {
  const out = [];
  for (const alan of SUNUCU_ALANLARI) {
    for (const { yol, deger } of alanlariAc(veri, alan.yol)) {
      if (alan.tur === 'ad') {
        if (!gecerliAd(deger))
          out.push({ yol, neden: 'gecersiz-ad', iz: `${yol}|${JSON.stringify(deger)}` });
      } else if (alan.tur === 'liste') {
        listeIhlalleri(yol, deger, out);
      } else if (alan.tur === 'anahtarlar' && nesneMi(deger)) {
        for (const k of Object.keys(deger))
          if (!gecerliAd(k))
            out.push({
              yol: yolEkle(yol, k),
              neden: 'gecersiz-ad',
              iz: `${yol}|${JSON.stringify(k)}`,
            });
      } else if (nesneMi(deger)) {
        for (const k of Object.keys(deger)) listeIhlalleri(yolEkle(yol, k), deger[k], out);
      } else {
        out.push({ yol, neden: 'nesne-degil', iz: `${yol}|nesne-degil` });
      }
    }
  }
  return out;
}

/**
 * Eski dosyada OLMAYAN ihlaller: onceden bozuk bir girdi ilgisiz bir bolumun kaydini kilitlemesin.
 * Tekrar sayilir: eskide bir kez olan bozuk deger yenide iki kez varsa ikincisi yeni ihlaldir.
 */
function yeniSunucuIhlalleri(eski, yeni) {
  const onceki = new Map();
  for (const { iz } of sunucuIhlalleri(eski)) onceki.set(iz, (onceki.get(iz) || 0) + 1);
  return sunucuIhlalleri(yeni).filter(({ iz }) => {
    const n = onceki.get(iz) || 0;
    if (n > 0) onceki.set(iz, n - 1);
    return n === 0;
  });
}

const doluMu = (v) => (Array.isArray(v) ? v.length > 0 : nesneMi(v) && Object.keys(v).length > 0);
const ayniTur = (a, b) => Array.isArray(a) === Array.isArray(b) && nesneMi(a) === nesneMi(b);

/**
 * Ayrica onay isteyen silmeler (kazara bolum / sunucu listesi kaybini engeller):
 *   bolumler       ust duzey anahtar silindi ya da dolu degeri bosaltildi / turu degisti
 *                  (`nginx: {}`, `nginx: null` silmekle aynidir: okuyan taraf "yok" der)
 *   sunucuAlanlari SUNUCU_ALANLARI'ndan eskide dolu olup yenide hic olmayan somut yol
 *                  (tur degisimi yeni ihlal olarak ayrica reddedilir)
 * Sunucu (428) ve ekran (onay penceresi) ayni listeyi kullanir.
 * @returns {{ bolumler: string[], sunucuAlanlari: string[] }}
 */
function onayliSilmeler(eski, yeni) {
  const e = nesneMi(eski) ? eski : {};
  const y = nesneMi(yeni) ? yeni : {};
  const bolumler = Object.keys(e).filter(
    (k) => !Object.hasOwn(y, k) || (doluMu(e[k]) && (!doluMu(y[k]) || !ayniTur(e[k], y[k]))),
  );
  const sunucuAlanlari = [];
  for (const alan of SUNUCU_ALANLARI) {
    const yenide = new Set(alanlariAc(y, alan.yol).map((x) => x.yol));
    for (const { yol, deger } of alanlariAc(e, alan.yol))
      if (!yenide.has(yol) && (doluMu(deger) || (typeof deger === 'string' && deger.trim())))
        sunucuAlanlari.push(yol);
  }
  return { bolumler, sunucuAlanlari };
}

module.exports = {
  SUNUCU,
  SUNUCU_ALANLARI,
  MAKS_DERINLIK,
  derinlikAsildi,
  farkHesapla,
  farkBosMu,
  farkYollari,
  sunucuIhlalleri,
  yeniSunucuIhlalleri,
  onayliSilmeler,
};
