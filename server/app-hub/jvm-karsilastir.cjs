// server/app-hub/jvm-karsilastir.cjs - Application Hub: toplu JVM argumani karsilastirmasi (2026-11-16).
//
// Kullanici: "Belli sayida (5-10) JBoss uygulamasini verdigimde bunlarin ozellikle PRODUCTION'da kendi
// sunuculari arasinda JVM argumanlarinin esit olup olmadigini gormek istiyorum. Toplu liste verip
// daha ozet bilgi almak istiyorum."
//
// POST /api/app-hub/jvm-karsilastir { uygulamalar: string[1..20], ortam: 'PROD'|'TUMU'|<ortam>, nesil: 7|8|'hepsi' }
//
// SALT OKUNUR: veri tek uygulama ekraninin okuyucusundan (veri.cjs jbossDetay, index.cjs onbellegiyle)
// gelir; yeni kaynak yok, hicbir sey yazilmaz. Yetki router duzeyinde (requireAdmin + AppHub
// gorunurlugu); denetim kaydini genel auditMutations katmani yazar (govdede yalniz uygulama adlari).
//
// KARSILASTIRMA KURALLARI:
//   * Grup = (uygulama, nesil) [TUMU seciliyse (uygulama, ortam, nesil)]: JBoss 7 ile 8 ayri karsilastirilir.
//   * Arguman kumesi SIRASIZ; anahtar=deger: -Dk=v -> (-Dk, v), -Xmx2g -> (-Xmx, 2g),
//     -XX:+Foo -> (-XX:Foo, +), -XX:Foo=v -> (-XX:Foo, v), -Xlog:x -> (-Xlog, x), --add-opens=v -> (--add-opens, v).
//   * TEKRAR EDEN ANAHTAR: JVM'de son yazilan gecerlidir (-Xmx2g -Xmx4g -> 4g; -D ve -XX icin de); etkin
//     deger son deger, tekrar uyari olarak yazilir. Yalniz gercekten cok degerli bayraklar (--add-opens,
//     -javaagent, -Xlog...) sirasiz birlestirilir.
//   * KESIK ARGUMAN: tarayici (server_hub_scan.sh JA_ARGS_MAX) uzun metni belirtec sinirinda keser ve sona
//     '...+N' ekler. Belirtec arguman sayilmaz; kesik JVM'de bulunmayan anahtar 'eksik' degil
//     'karsilastirilamadi' olur.
//   * MASKELI deger (***): maske belirleyici oldugu icin (mask.cjs) metin oldugu gibi karsilastirilir;
//     *** kisimlari esit cikar, acik kalan host / sema farki gorunur. 'maskeli' notu yazilir.
//   * SUNUCUYA OZGU: degerdeki o JVM'in host adi / IP'si / JVM adi (belirtec sinirinda) <HOST>/<IP>/<JVM>
//     ile degistirilir; normallestirince esitlenen fark esitsizlik sayilmaz, ayri listelenir. Kosulsuz
//     sunucuya ozgu yalniz KIMLIK anahtarlari (node adi, tx node id, server/host adi). Port ofseti yalniz
//     ayni sunucudaki JVM'ler arasinda dogal farktir; sunucular arasinda farkliysa FARKLI.
//     Ham ve normallestirilmis cogunluk farkli JVM'leri gosterirse sapan belirsizdir: cogunluk yazilmaz.
//   * Kaynak: calisan surec argumani (jvmArgs) yoksa yapilandirilan (yapilandirilanJvmArgs). Grubun
//     tum uyelerinde ayni kaynak varsa o kaynak kullanilir (karisik kaynak sahte fark uretir).
//   * Durum: ESIT | FARKLI | TEK_SUNUCU | OLCULEMEDI | BULUNAMADI.
'use strict';

const { varsayilanSira } = require('../util/siralama.cjs');

const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();

const UYGULAMA_TAVAN = 20;
// Uygulama basina jbossDetay discover + Server Hub agir okumasi yapar; 2 uygulama x JVM_AGIR_ESZAMAN.
const ESZAMAN = 2;

const ENVANTER_ORTAM = {
  PRODUCTION: 'PROD',
  PROD: 'PROD',
  PRD: 'PROD',
  QA: 'QA',
  TEST: 'TEST',
  ALPHA: 'ALPHA',
  ODM: 'ODM',
  DEV: 'DEV',
};
// discover.cjs'in urettigi ortam kumesi (hedefOrtami): bunlarin disindaki etiket 'taninmadi' sayilir.
const ORTAMLAR = ['PROD', 'QA', 'TEST', 'DEV', 'ALPHA', 'ODM'];

/** Ortam etiketini tek bicime getirir ('Production' -> 'PROD'); bossa ad kuralina (-D/-T/-Q) bakar; taninmazsa BILINMIYOR. */
function ortamNorm(ortam, uygulamaAdi) {
  const o = U(ortam);
  if (o) return ENVANTER_ORTAM[o] || 'BILINMIYOR';
  const m = /-([DTQ])$/i.exec(String(uygulamaAdi || '').trim());
  if (m) return { D: 'DEV', T: 'TEST', Q: 'QA' }[m[1].toUpperCase()];
  return 'BILINMIYOR';
}

// KIMLIK anahtarlari: dogasi geregi her JVM'de farkli; degerleri farkli olsa da esitsizlik degil.
// (bind adresi, jgroups, rmi hostname bu listede DEGIL: normallestirmeden sonra kalan fark gercek farktir.)
const SUNUCUYA_OZGU_ANAHTARLAR = new Set([
  '-Djboss.node.name',
  '-Djboss.host.name',
  '-Djboss.qualified.host.name',
  '-Djboss.server.name',
  '-Djboss.tx.node.id',
]);
// Port ofseti ayni sunucudaki JVM'leri ayirir; sunucular arasinda (ayni JVM dizilimi) esit olmali.
const PORT_OFSET = '-Djboss.socket.binding.port-offset';

// Arguman ayristirma (anahtarDeger / argOzu) shared/jvmArg.cjs'te: Application Hub OCP ekrani
// (ortam ici cluster karsilastirmasi, 2026-11-23) ayni kuralla calisir.
const { anahtarDeger, argOzu } = require('../../shared/jvmArg.cjs');

/** Arguman metni -> Map(anahtar -> etkin deger). */
function argHaritasi(metin) {
  return argOzu(metin).h;
}

const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Degerdeki sunucuya ozgu parcalari yer tutucuyla degistirir; yalniz BELIRTEC SINIRINDA (harf/rakam
 * komsusu yok). Host adi harf duyarsiz (DNS), IP rakam sinirinda, JVM adi harf DUYARLI. Uzun olan once.
 */
function normallestir(deger, uye) {
  let v = String(deger);
  const parcalar = [
    { s: uye.host, yer: '<HOST>', bayrak: 'gi', sol: '(?<![A-Za-z0-9])', sag: '(?![A-Za-z0-9])' },
    { s: uye.ip, yer: '<IP>', bayrak: 'g', sol: '(?<![0-9.])', sag: '(?![0-9])' },
    { s: uye.jvm, yer: '<JVM>', bayrak: 'g', sol: '(?<![A-Za-z0-9])', sag: '(?![A-Za-z0-9])' },
  ]
    .filter((p) => p.s && String(p.s).length >= 3)
    .sort((a, b) => String(b.s).length - String(a.s).length);
  for (const p of parcalar)
    v = v.replace(new RegExp(p.sol + kacis(String(p.s)) + p.sag, p.bayrak), p.yer);
  return v;
}

const maskeli = (v) => String(v).includes('***');

/** Degere gore gruplar: [[deger, [x...]], ...] buyukten kucuge (esitlikte deger sirasi). */
function grupla(olan, degerFn) {
  const g = new Map();
  for (const x of olan) {
    const d = degerFn(x);
    if (!g.has(d)) g.set(d, []);
    g.get(d).push(x);
  }
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

const cogunlukVarMi = (sirali) => sirali.length > 1 && sirali[0][1].length > sirali[1][1].length;

/** Port ofseti: her sunucudaki ofset kumesi ayniysa (ya da tek sunucuysa) fark ayni sunucudaki JVM'ler arasindadir. */
function ofsetSunucuIcinde(olan) {
  const bySunucu = new Map();
  for (const x of olan) {
    const k = U(x.u.host);
    if (!bySunucu.has(k)) bySunucu.set(k, []);
    bySunucu.get(k).push(String(x.h.get(PORT_OFSET)));
  }
  return new Set([...bySunucu.values()].map((v) => v.sort(varsayilanSira).join(','))).size === 1;
}

/**
 * Bir grubun (ayni uygulama, ayni nesil) JVM'lerini karsilastirir. SAF fonksiyon.
 * uyeler: [{ etiket, host, jvm, ip?, args: string|null, kaynak, calisiyor, taze, taramaTarihi }]
 */
function grupKarsilastir(uyeler) {
  const ayrik = uyeler.map((u) => ({
    u,
    oz: u.args && String(u.args).trim() ? argOzu(u.args) : null,
  }));
  const haritalar = ayrik
    .filter((x) => x.oz?.h.size)
    .map((x) => ({ u: x.u, h: x.oz.h, kesik: x.oz.kesik, tekrarlar: x.oz.tekrarlar }));
  const olculen = haritalar.map((x) => x.u);
  const olculemeyen = ayrik.filter((x) => !x.oz?.h.size).map((x) => x.u);
  const uyarilar = [];
  const bayat = uyeler.filter((u) => u.taze === false);
  if (olculemeyen.length)
    uyarilar.push(
      `${olculemeyen.length} JVM'in argümanı okunamadı (${olculemeyen.map((u) => u.etiket).join(', ')}); karşılaştırmaya girmedi.`,
    );
  if (bayat.length)
    uyarilar.push(
      `${bayat.length} JVM'in Server Hub taraması bayat; argümanlar güncel olmayabilir.`,
    );
  const kaynaklar = new Set(olculen.map((u) => u.kaynak));
  if (kaynaklar.size > 1)
    uyarilar.push(
      "Bazı JVM'ler çalışan süreçten, bazıları yapılandırmadan okundu; fark kaynak farkından olabilir.",
    );
  const kesikler = haritalar.filter((x) => x.kesik != null);
  if (kesikler.length) {
    const kesikListesi = kesikler.map((x) => `${x.u.etiket}: +${x.kesik}`).join(', ');
    uyarilar.push(
      `${kesikler.length} JVM'in argüman metni taramada kesilmiş (${kesikListesi}); kesilen kısımdaki argümanlar karşılaştırılamadı.`,
    );
  }
  for (const x of haritalar) {
    if (x.tekrarlar.length)
      uyarilar.push(
        `${x.u.etiket}: ${x.tekrarlar.join(', ')} birden çok kez veriliyor; son yazılan değer etkin sayıldı.`,
      );
  }

  const bos = {
    degerFarklari: [],
    eksikFazla: [],
    karsilastirilamadi: [],
    sunucuyaOzgu: [],
    maskeli: [],
    esitSayisi: 0,
    farkSayisi: 0,
  };
  const sonuc = (durum, neden, ek = {}) => ({
    durum,
    neden: neden || null,
    uyarilar,
    jvmSayisi: uyeler.length,
    olculenJvm: olculen.length,
    ...bos,
    ...ek,
  });

  if (!uyeler.length) return sonuc('BULUNAMADI', 'Seçilen ortamda JVM yok.');
  if (!olculen.length)
    return sonuc(
      'OLCULEMEDI',
      "Hiçbir JVM'in argümanı okunamadı (tarama yok, argüman toplanmadı ya da okuma hatası).",
    );
  if (bayat.length === uyeler.length)
    return sonuc('OLCULEMEDI', 'Tüm JVM taramaları bayat; güncel argüman yok.');
  if (uyeler.length === 1) return sonuc('TEK_SUNUCU', 'Karşılaştırılacak ikinci JVM yok.');
  if (olculen.length < 2)
    return sonuc('OLCULEMEDI', 'Argümanı okunabilen tek JVM var; diğerleri ölçülemedi.');

  const anahtarlar = [...new Set(haritalar.flatMap((x) => [...x.h.keys()]))].sort(varsayilanSira);
  const degerFarklari = [];
  const eksikFazla = [];
  const karsilastirilamadi = [];
  const sunucuyaOzgu = [];
  const maskeliListe = [];
  let esitSayisi = 0;

  for (const k of anahtarlar) {
    const olan = haritalar.filter((x) => x.h.has(k));
    // Kesik JVM'de bulunmayan anahtar kesilen kisimda olabilir: eksik sayilmaz.
    const olmayan = haritalar.filter((x) => !x.h.has(k) && x.kesik == null);
    const olmayanKesik = haritalar.filter((x) => !x.h.has(k) && x.kesik != null);
    if (olan.some((x) => maskeli(x.h.get(k)))) maskeliListe.push(k);
    if (olmayan.length) {
      eksikFazla.push({
        anahtar: k,
        olan: olan.map((x) => x.u.etiket),
        olmayan: olmayan.map((x) => x.u.etiket),
        kesikte: olmayanKesik.map((x) => x.u.etiket),
        degerler: olan.map((x) => ({ uye: x.u.etiket, deger: x.h.get(k) })),
        cogunlukta: olan.length > olmayan.length,
      });
      continue;
    }
    if (olmayanKesik.length)
      karsilastirilamadi.push({ anahtar: k, kesik: olmayanKesik.map((x) => x.u.etiket) });
    if (olan.length < 2) continue;
    const ham = grupla(olan, (x) => x.h.get(k));
    if (ham.length === 1) {
      if (!olmayanKesik.length) esitSayisi++;
      continue;
    }
    const sirali = grupla(olan, (x) => normallestir(x.h.get(k), x.u));
    const ornek = olan.map((x) => ({ uye: x.u.etiket, deger: x.h.get(k) }));
    if (sirali.length === 1 || SUNUCUYA_OZGU_ANAHTARLAR.has(k)) {
      sunucuyaOzgu.push({
        anahtar: k,
        degerler: ornek,
        normal: sirali.length === 1 ? sirali[0][0] : null,
      });
      continue;
    }
    if (k === PORT_OFSET && ofsetSunucuIcinde(olan)) {
      sunucuyaOzgu.push({ anahtar: k, degerler: ornek, normal: null });
      continue;
    }
    let cogunlukVar = cogunlukVarMi(sirali);
    // Ham degerlerin cogunlugu baska JVM'leri gosteriyorsa (or. -Dmaster=OPJBAP01 uc sunucuda, biri kendini
    // gosteriyor) normallestirme sapani yanlis secebilir: cogunluk yazilmaz, tum degerler gosterilir.
    const etiketler = (xs) =>
      xs
        .map((x) => x.u.etiket)
        .sort(varsayilanSira)
        .join(',');
    const belirsiz =
      cogunlukVar && cogunlukVarMi(ham) && etiketler(ham[0][1]) !== etiketler(sirali[0][1]);
    if (belirsiz) cogunlukVar = false;
    degerFarklari.push({
      anahtar: k,
      cogunluk: cogunlukVar ? sirali[0][0] : null,
      cogunlukUyeler: cogunlukVar ? sirali[0][1].map((x) => x.u.etiket) : [],
      degerler: sirali.map(([deger, xs]) => ({ deger, uyeler: xs.map((x) => x.u.etiket) })),
      sapanlar: (cogunlukVar ? sirali.slice(1) : sirali).flatMap(([deger, xs]) =>
        xs.map((x) => ({ uye: x.u.etiket, deger: x.h.get(k), normal: deger })),
      ),
      belirsiz,
    });
  }
  const farkSayisi = degerFarklari.length + eksikFazla.length;
  return {
    durum: farkSayisi ? 'FARKLI' : 'ESIT',
    neden: null,
    uyarilar,
    jvmSayisi: uyeler.length,
    olculenJvm: olculen.length,
    degerFarklari,
    eksikFazla,
    karsilastirilamadi,
    sunucuyaOzgu,
    maskeli: maskeliListe,
    esitSayisi,
    farkSayisi,
  };
}

/** JVM'in karsilastirmada kullanilacak argumani ve kaynagi; tercih: calisan surec, yoksa yapilandirilan. */
function argSec(j, tercih) {
  const calisan = j.jvmArgs && String(j.jvmArgs).trim() ? j.jvmArgs : null;
  const yapi =
    j.yapilandirilanJvmArgs && String(j.yapilandirilanJvmArgs).trim()
      ? j.yapilandirilanJvmArgs
      : null;
  if (tercih === 'YAPILANDIRILAN' && yapi) return { args: yapi, kaynak: 'YAPILANDIRILAN' };
  if (calisan) return { args: calisan, kaynak: 'CALISAN' };
  if (yapi) return { args: yapi, kaynak: 'YAPILANDIRILAN' };
  return { args: null, kaynak: null };
}

const DURUM_ONCELIK = ['FARKLI', 'OLCULEMEDI', 'ESIT', 'TEK_SUNUCU', 'BULUNAMADI'];

/**
 * jbossDetay ciktisini (ya da null) secilen ortam / nesil icin karsilastirir. SAF fonksiyon.
 * secim: { ortam: 'PROD'|'TUMU'|<ortam>, nesil: 7|8|'hepsi' }
 */
function uygulamaKarsilastir(istenen, detay, secim) {
  const ortamSec = secim.ortam || 'PROD';
  const nesilSec = secim.nesil == null ? 'hepsi' : secim.nesil;
  if (!detay) {
    return {
      ad: istenen,
      tabanAd: null,
      durum: 'BULUNAMADI',
      neden: 'Envanterde JBoss uygulaması olarak bulunamadı.',
      sunucuSayisi: 0,
      jvmSayisi: 0,
      gruplar: [],
      uyarilar: [],
    };
  }
  const uyarilar = [];
  const kaynaklar = detay.kaynaklar || {};
  const shHata = kaynaklar.serverHub?.hata;
  if (kaynaklar.envanter?.hata) uyarilar.push(`Envanter okunamadı: ${kaynaklar.envanter.hata}`);
  if (kaynaklar.kesif?.hata)
    uyarilar.push(
      `Keşif okunamadı (${kaynaklar.kesif.hata}); ortam yalnız envanter kaydından okundu.`,
    );

  const gruplar = new Map();
  const bilinmeyen = [];
  const hostlar = new Set();
  for (const s of detay.sunucular || []) {
    const ortam = ortamNorm(s.ortam, s.uygulama);
    if (ortam === 'BILINMIYOR')
      bilinmeyen.push(s.ortam == null || s.ortam === '' ? '(boş)' : String(s.ortam));
    if (ortamSec !== 'TUMU' && ortam !== ortamSec) continue;
    for (const j of s.jvmler || []) {
      const nesil = Number(j.nesil) || Number(s.nesil) || null;
      if (nesilSec !== 'hepsi' && nesil !== Number(nesilSec)) continue;
      const gAnahtar = ortamSec === 'TUMU' ? `${ortam}|${nesil}` : `${nesil}`;
      if (!gruplar.has(gAnahtar)) gruplar.set(gAnahtar, { ortam, nesil, jvmler: [] });
      gruplar.get(gAnahtar).jvmler.push({ s, j });
      hostlar.add(U(s.host));
    }
  }
  if (bilinmeyen.length) {
    const degerler = [...new Set(bilinmeyen)].join(', ');
    uyarilar.push(
      ortamSec === 'TUMU'
        ? `${bilinmeyen.length} sunucunun ortamı bilinmiyor ya da tanınmadı (${degerler}); ayrı grupta karşılaştırıldı.`
        : `${bilinmeyen.length} sunucunun ortamı bilinmiyor ya da tanınmadı (${degerler}); ${ortamSec} süzgecine alınmadı.`,
    );
  }

  const grupSonuclari = [...gruplar.values()]
    .sort(
      (a, b) => String(a.ortam).localeCompare(String(b.ortam)) || (a.nesil || 0) - (b.nesil || 0),
    )
    .map((g) => {
      // Grubun tum JVM'lerinde calisan surec argumani yoksa ama hepsinde yapilandirilan varsa, hepsi
      // yapilandirilandan okunur: calisan + yapilandirilan karisimi (JBoss baslaticinin ekledigi -D'ler) sahte fark uretir.
      const hepsiCalisan = g.jvmler.every(({ j }) => j.jvmArgs && String(j.jvmArgs).trim());
      const hepsiYapi = g.jvmler.every(
        ({ j }) => j.yapilandirilanJvmArgs && String(j.yapilandirilanJvmArgs).trim(),
      );
      const tercih = !hepsiCalisan && hepsiYapi ? 'YAPILANDIRILAN' : 'CALISAN';
      const uyeler = g.jvmler.map(({ s, j }) => {
        const a = argSec(j, tercih);
        return {
          etiket: `${U(s.host)}/${j.ad}`,
          host: U(s.host),
          jvm: j.ad,
          ip: s.kapasite?.ip || null,
          args: a.args,
          kaynak: a.kaynak,
          calisiyor: j.calisiyor == null ? null : j.calisiyor,
          taze: j.taze !== false,
          taramaTarihi: j.taramaTarihi || null,
        };
      });
      const k = grupKarsilastir(uyeler);
      // Server Hub hatasi argumansizligin nedeni olabilir: 'tarama yok' yerine hatayi yaz.
      if (shHata && k.durum === 'OLCULEMEDI' && !k.olculenJvm)
        k.neden = `Server Hub okunamadı: ${shHata}`;
      return {
        ortam: g.ortam,
        nesil: g.nesil,
        sunucuSayisi: new Set(uyeler.map((u) => u.host)).size,
        jvmler: uyeler.map(({ args, ip, ...u }) => ({
          ...u,
          olculdu: !!args,
          kesik: args ? argOzu(args).kesik != null : false,
        })),
        ...k,
      };
    });

  let durum;
  let neden = null;
  if (!grupSonuclari.length) {
    if (shHata && (detay.sunucular || []).length) {
      durum = 'OLCULEMEDI';
      neden = `Server Hub okunamadı: ${shHata}`;
    } else {
      durum = 'BULUNAMADI';
      const ortamAd = ortamSec === 'TUMU' ? 'hiçbir ortamda' : `${ortamSec} ortamında`;
      const nesilAd = nesilSec === 'hepsi' ? '' : `JBoss ${nesilSec} `;
      neden = (detay.sunucular || []).length
        ? `${ortamAd} ${nesilAd}JVM'i yok.`
        : 'Sunucu kaydı yok.';
    }
  } else {
    durum = DURUM_ONCELIK.find((d) => grupSonuclari.some((g) => g.durum === d)) || 'OLCULEMEDI';
    if (shHata) uyarilar.push(`Server Hub okunamadı: ${shHata}`);
  }
  return {
    ad: istenen,
    tabanAd: detay.ad || null,
    durum,
    neden,
    sunucuSayisi: hostlar.size,
    jvmSayisi: grupSonuclari.reduce((a, g) => a + g.jvmSayisi, 0),
    farkSayisi: grupSonuclari.reduce((a, g) => a + g.farkSayisi, 0),
    gruplar: grupSonuclari,
    uyarilar,
  };
}

function ozetle(sonuclar) {
  const oz = {
    toplam: sonuclar.length,
    ESIT: 0,
    FARKLI: 0,
    TEK_SUNUCU: 0,
    OLCULEMEDI: 0,
    BULUNAMADI: 0,
  };
  for (const s of sonuclar) oz[s.durum] = (oz[s.durum] || 0) + 1;
  return oz;
}

/**
 * Govdeyi dogrular; { ok, uygulamalar, tabanlar, ortam, nesil } ya da { ok:false, error }.
 * tabanAdi: ad -> taban ad (discover parseAppName; MUSTERI-T -> MUSTERI). jbossDetay tabanla okudugu icin
 * ayni tabana inen adlar tek kez okunur (ilk yazilan ad kalir).
 */
function girdiDogrula(b, AD_RE, tabanAdi = (x) => x) {
  const g = b && typeof b === 'object' ? b : {};
  if (!Array.isArray(g.uygulamalar)) return { ok: false, error: 'uygulamalar bir liste olmalı.' };
  const gorulen = new Set();
  const liste = [];
  const tabanlar = [];
  for (const x of g.uygulamalar) {
    const ad = String(x == null ? '' : x).trim();
    if (!ad) continue;
    if (!AD_RE.test(ad)) return { ok: false, error: `Geçersiz uygulama adı: ${ad.slice(0, 64)}` };
    const taban = String(tabanAdi(ad) || ad);
    if (gorulen.has(taban.toUpperCase())) continue;
    gorulen.add(taban.toUpperCase());
    liste.push(ad);
    tabanlar.push(taban);
  }
  if (!liste.length) return { ok: false, error: 'En az bir uygulama adı girin.' };
  if (liste.length > UYGULAMA_TAVAN)
    return {
      ok: false,
      error: `En çok ${UYGULAMA_TAVAN} uygulama karşılaştırılabilir (${liste.length} verildi).`,
    };
  const ortamHam = g.ortam == null || g.ortam === '' ? 'PROD' : U(g.ortam);
  const ortam = ortamHam === 'TUMU' ? 'TUMU' : ENVANTER_ORTAM[ortamHam];
  if (!ortam) return { ok: false, error: `Ortam TUMU ya da ${ORTAMLAR.join(', ')} olmalı.` };
  const nesilHam = g.nesil == null || g.nesil === '' ? 'hepsi' : String(g.nesil).toLowerCase();
  if (!['7', '8', 'hepsi'].includes(nesilHam))
    return { ok: false, error: "Nesil 7, 8 ya da 'hepsi' olmalı." };
  return {
    ok: true,
    uygulamalar: liste,
    tabanlar,
    ortam,
    nesil: nesilHam === 'hepsi' ? 'hepsi' : Number(nesilHam),
  };
}

/**
 * Router'a ucu baglar. detayOku(tabanAd, fresh) -> jbossDetay ciktisi (index.cjs onbellegi uzerinden).
 * sinirliParalel: veri.cjs'in sirali sinirli paralel yardimcisi. tabanAdi: ad -> taban ad.
 */
function mount(router, { detayOku, sinirliParalel, AD_RE, tabanAdi }) {
  router.post('/jvm-karsilastir', async (req, res) => {
    const g = girdiDogrula(req.body, AD_RE, tabanAdi);
    if (!g.ok) return res.status(400).json({ ok: false, error: g.error });
    const fresh = !!(req.body?.fresh === true);
    const secim = { ortam: g.ortam, nesil: g.nesil };
    const basla = Date.now();
    try {
      const sirali = g.uygulamalar.map((ad, i) => ({ ad, taban: g.tabanlar[i] }));
      const sonuclar = await sinirliParalel(sirali, ESZAMAN, async ({ ad, taban }) => {
        let r;
        try {
          r = uygulamaKarsilastir(ad, await detayOku(taban, fresh), secim);
        } catch (e) {
          r = {
            ad,
            tabanAd: null,
            durum: 'OLCULEMEDI',
            neden: `Okunamadı: ${String(e?.message || e).slice(0, 200)}`,
            sunucuSayisi: 0,
            jvmSayisi: 0,
            farkSayisi: 0,
            gruplar: [],
            uyarilar: [],
          };
        }
        if (U(taban) !== U(ad))
          r.uyarilar.unshift(
            `${ad} taban adla (${taban}) okundu; ortam seçimi (${g.ortam}) geçerli.`,
          );
        return r;
      });
      const u = req.session?.user?.username || '?';
      console.log(
        `[AppHub] ${u} -> jvm-karsilastir uygulama=${sonuclar.length} ortam=${g.ortam} nesil=${g.nesil} sure=${Date.now() - basla}ms`,
      );
      res.json({
        ok: true,
        ortam: g.ortam,
        nesil: g.nesil,
        ozet: ozetle(sonuclar),
        uygulamalar: sonuclar,
        okundu: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: `Karşılaştırma yapılamadı: ${e?.message || e}` });
    }
  });
}

module.exports = {
  mount,
  UYGULAMA_TAVAN,
  _ic: {
    anahtarDeger,
    argOzu,
    argHaritasi,
    normallestir,
    grupKarsilastir,
    uygulamaKarsilastir,
    girdiDogrula,
    ozetle,
    ortamNorm,
    argSec,
    SUNUCUYA_OZGU_ANAHTARLAR,
    ESZAMAN,
  },
};
