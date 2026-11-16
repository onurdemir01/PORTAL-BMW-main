// server/server-hub/capraz.cjs - Server Hub capraz kontrolleri (2026-11-06; saf, birim testli).
//
// Tek sunucunun taramasi "bu JVM kapali" der; capraz kontrol "ayni uygulamanin oteki kopyalari,
// oteki ortamlari, OpenShift'teki karsiligi ve Retirement kaydi ne diyor" diye sorar. Kullanici
// anketinde secilenler (2026-11-06): auto-start uyumsuzlugu (assess zaten REBOOT_RISK /
// STOPPED_AUTOSTART_ON uretir; burada yalniz etiket adayi olur), kopyalar / ortamlar tutarsiz,
// OpenShift'e tasinmis + Retirement kaydi celiskisi. "Kaynaklar celisiyor" (MWAppsInventory <->
// tarama) SECILMEDI: INV_MISMATCH bulgusu olarak kalir.
//
// DORT KONTROL (sonuc JVM basina; bulguyu ve adayi assess.cjs yazar, bekciler kod adini orada arar):
//   kopya     ayni ortam + ayni JBoss nesli + ayni JVM adi, farkli sunucular: biri calisiyor biri
//             kapali ya da auto-start farkli. Sapan kopya isaretlenir (calisma: kapali olan;
//             auto-start: azinlik, esitlikte 'false' olan).
//   kalinti   taban ad (parseApp: <APP>-D/-T/-Q) prod'da calismiyor (hic yok / hepsi kapali /
//             Retirement'la durdurulmus) ama DEV / TEST / QA kopyasi calisiyor. Envanter
//             (MWAppsInventory) taranmamis bir prod kopyasi biliyorsa iddia KURULMAZ.
//   ocp       ayni taban ad OpenShift envanterinde ayni ortam grubunda (namespace son eki; DEV ve
//             TEST tek grup: JBoss ortami hostname'den, ikisini ayiramaz). Dynatrace istegi yazilir.
//   celiski   Retirement hedefi stopped / deleted ama JVM calisiyor, auto-start acik ya da paket
//             ozgun adiyla diskte (STOP paketi .<smart>.old yapar). Yalniz STOP'tan SONRA alinmis
//             taramayla ve paket hedefin kokunde (ZAMAN / KOK KAPISI); eski veri -> dogrulanamadi.
//
// KANIT KAPILARI: taramadan dusen ve bayat sunucu karar vermez (bayat kopya "bilinmiyor" sayilir);
// calismasi olculemeyen JVM ne calisiyor ne kapali sayilir. Ad eslemesi yalniz normAd ile birebir
// (kucuk harf, harf / rakam disi atilir); eslesen adlar kanitta yazilir.
'use strict';

const { parseApp } = require('../audit/app-envs.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
/** Ad eslemesinin TEK kurali: kucuk harf, harf / rakam disi her sey atilir. Tahmin yok. */
const normAd = (s) => L(s).replace(/[^a-z0-9]/g, '');
const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
// assess.cjs shortHost ile ayni kural (IP kisaltilmaz).
const kisaHost = (s) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(String(s || '').trim()) ? String(s).trim() : U(s).split('.')[0];

/** JBoss ortami -> karsilastirma grubu (DEV ve TEST hostname'den ayrilamaz). */
const ORTAM_GRUBU = { PROD: 'prod', QA: 'qa', TEST: 'devtest', DEV: 'devtest', EDU: 'edu' };
/** OpenShift namespace son eki -> ayni grup. */
const NS_GRUBU = { prod: 'prod', qa: 'qa', test: 'devtest', dev: 'devtest', edu: 'edu' };
const NONPROD = new Set(['DEV', 'TEST', 'QA']);
/** STOP / silme yapilmis hedef: JVM kapali, auto-start kapali, paket yeniden adlandirilmis olmali. */
const KAPATILMIS = new Set(['stopped', 'deleted']);

/** Taban uygulama adi: standart son ek (-D/-T/-Q, kucuk harf dahil) atilir; tanimsiz ekte ad aynen kalir. */
function tabanAd(ad) {
  const p = parseApp(String(ad || '').trim());
  return p.env ? p.base : String(ad || '').trim();
}

const taze = (h) => !h.taramadanDustu && h.fresh !== false;
/**
 * YALNIZ ENVANTERDE (2026-11-14, uretim GBJIST02): assess.cjs taramada JVM'i bulunamayan
 * MWAppsInventory uygulamasini gen 0 satir olarak tutar (source 'envanter'). Bu satir TARAMA JVM'I
 * DEGILDIR: kopya grubu, kalinti / OpenShift / Retirement celiskisi, Uygulama 360 kopyasi, retire
 * etiketi ve iliski grafigi onu atlar. TEK yuklem; tuketiciler bunu cagirir.
 */
const yalnizEnvanter = (j) => !!j && (j.yalnizEnvanter === true || j.source === 'envanter');
const bilinen = (j) => j.runningKnown !== false;
/**
 * Tarama JVM'inin UYGULAMA taban adi. assess.cjs envanterEslestir numarali / grup eslesmesinde JVM'e
 * envanter uygulamasini (invApp) yazar: GBFACELIFTSUBE-T1 -> invApp GBFACELIFTSUBE-T -> taban
 * GBFACELIFTSUBE. JVM adi (-T1) standart ortam eki tasimadigi icin tabanAd(j.name) onu ayri
 * uygulama sayiyordu (prod kopyasi bulunamaz -> yanlis ORTAM_KALINTISI / R10).
 */
const uygTaban = (j) => tabanAd((j && j.invApp) || (j && j.name));
const yolAdi = (y) =>
  String(y || '')
    .replace(/(?<!\/)\/+$/, '')
    .split('/')
    .pop();
/** Yol karsilastirma bicimi: bosluk kirpilir, ardisik '/' teke iner, sondaki '/' atilir. */
const sonEgikSiz = (y) =>
  String(y || '')
    .trim()
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
/** Paketin koku: app_path'in ust dizini (/vhosting/APP.ear -> /vhosting); kok cikmazsa ''. */
const yolKoku = (y) => {
  const s = sonEgikSiz(y);
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : '';
};
/** Kokun JBoss nesli (ear-envanter-alim.cjs jbossOf ile ayni kural): /vhosting8 -> 8, /vhosting -> 7, diger '?'. */
const kokNesli = (kok) => {
  const s = sonEgikSiz(kok);
  if (s.endsWith('/vhosting8')) return '8';
  if (s.endsWith('/vhosting')) return '7';
  return '?';
};
/** Iki kok BILINEN iki farkli JBoss nesline mi ait (in-place 7 + 8: obur neslin koku). */
const oburNesil = (a, b) => {
  const x = kokNesli(a);
  const y = kokNesli(b);
  return x !== '?' && y !== '?' && x !== y;
};

// ── ZAMAN KAPISI (2026-11-16, uretim: retire edilmis her JBoss "kritik") ─────────────────────────
// STOP oncesi alinmis tarama STOP'un sonucunu goremez: o veriyle "calisiyor / auto-start acik /
// paket ozgun adiyla diskte" iddiasi kurulmaz (35 gune kadar yanlis kritik). Iddia yalniz STOP'tan
// (silme kontrolunde silmeden) SONRA alinmis taramayla kurulur; eski veri sessiz gecmez, "dogrulama
// bekliyor" notu (bilgi) olur. STOP zamani kayitta yoksa da iddia kurulmaz, not yazilir.
//   EAR (Uygulama Envanteri): taranma = taramanin sunucuda BASLADIGI an (UTC, taranma_utc) > STOP ani.
//   Server Hub: scanDate yalniz GUN tasir (saat yok). Tarama gunu STOP'un kurum gunu (Europe/Istanbul,
//   Portal ve tarayicinin saat dilimi) ile AYNI ise sira bilinmez: yalniz tarama gunu STOP gununden
//   SONRA ise tarama STOP sonrasidir. (Gece taramasi STOP'u ertesi gun gorur.)
//   AYNI GUN (inceleme B1, 2026-11-16): operatorun STOP'u dogrulamak icin hemen "simdi tara" demesi bu
//   durumdur; sira bilinmedigi icin kritik denmez ama bilgi notuna da dusmez: 'belirsiz' -> UYARI
//   (RETIRE_AYNI_GUN_DOGRULA). Ayni gun ve loaded_at ham degeri bile STOP'tan once ise tarama kesin
//   STOP oncesidir -> bilgi. JVM sureci STOP'tan SONRA baslamissa (process_start_epoch) gozlem kesin STOP
//   sonrasidir -> celiski (gun beklenmez).
const GUN_MS = 86400000;
const KURUM_TZ = 'Europe/Istanbul';
// Turkiye 2016'dan beri sabit UTC+3 (yaz saati yok): yalniz Intl saat dilimi verisi yoksa kullanilir.
const KURUM_SABIT_OFSET_MS = 3 * 3600000;
/**
 * Kurum gunu bicimleyicisi. Node ICU / saat dilimi verisi olmadan derlenmisse Intl RangeError atar;
 * modul (tum Server Hub degerlendirmesi) dusmez, sabit ofsete duser ve bunu bir kez yazar (inceleme B6).
 */
function kurumBicimiKur(DTF = Intl.DateTimeFormat) {
  try {
    return new DTF('en-US', {
      timeZone: KURUM_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (e) {
    console.warn(
      `[ServerHub] ${KURUM_TZ} saat dilimi kullanilamiyor (${(e && e.message) || e}); kurum gunu sabit UTC+3 ile hesaplanir`,
    );
    return null;
  }
}
const kurumGunBicimi = kurumBicimiKur();
const sayiMi = (x) => typeof x === 'number' && Number.isFinite(x);
/** Anin kurum saat dilimindeki gun numarasi (gun = 1970'ten beri gun). bicim null: sabit UTC+3. */
function kurumGunu(ms, bicim = kurumGunBicimi) {
  if (!bicim) return Math.floor((ms + KURUM_SABIT_OFSET_MS) / GUN_MS);
  const p = {};
  for (const x of bicim.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / GUN_MS);
}
/** Anin kurum gunu 'YYYY-MM-DD' (STOP / tarama gunu metni; ekranla ayni gun); okunamazsa null. */
const kurumGunMetni = (ms) =>
  sayiMi(ms) ? new Date(kurumGunu(ms) * GUN_MS).toISOString().slice(0, 10) : null;
/** 'YYYY-MM-DD...' -> gun numarasi; okunamazsa null. */
function gunNo(d) {
  if (!d) return null;
  const t = Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / GUN_MS) : null;
}
const zamanMs = (x) => {
  if (x == null || x === '') return null;
  const t = Date.parse(String(x));
  return Number.isFinite(t) ? t : null;
};
// Sunucu saati ile Portal saati arasindaki kayma payi (surec baslangici STOP'tan bu kadar sonra olmali).
const SUREC_PAYI_MS = 10 * 60 * 1000;
/**
 * Server Hub gozleminin (JVM j, sunucu h) STOP / silme anina gore sirasi:
 *   'sonra'    tarama gunu STOP'un kurum gununden sonra, ya da calisan JVM'in sureci STOP'tan sonra baslamis
 *   'belirsiz' ayni gun; yuklemenin STOP'tan once oldugu kanitlanamiyor
 *   'once'     onceki gun, tarama gunu okunamiyor ya da loaded_at ham degeri bile STOP'tan once
 * loaded_at SAAT TABANI (autostart-dogrulama.cjs): DB yerel saat yazar, surucu UTC sanar; ham deger gercek
 * yukleme anina esit ya da ondan ILERIDEDIR. Yalniz "ham < STOP => yukleme (ve tarama) STOP'tan once"
 * yonunde kullanilir; "sonra" kaniti olarak KULLANILMAZ (tarama yuklemeden saatler once bitmis olabilir).
 */
function shSira(h, j, refMs) {
  if (!sayiMi(refMs)) return 'once';
  const ps = sayiMi(j.processStartEpoch) ? j.processStartEpoch * 1000 : null;
  if (bilinen(j) && j.running && ps != null && ps > refMs + SUREC_PAYI_MS) return 'sonra';
  const g = gunNo(h.scanDate);
  if (g == null) return 'once';
  const sg = kurumGunu(refMs);
  if (g > sg) return 'sonra';
  if (g < sg) return 'once';
  if (sayiMi(h.loadedAt) && h.loadedAt < refMs) return 'once';
  return 'belirsiz';
}

/**
 * KOPYA GRUBU (TEK kural; KOPYA_TUTARSIZ bulgusu ve Server Hub > Kopya Durumu sekmesi ayni fonksiyonu
 * kullanir): ayni ortam (ORTAM_GRUBU'nda tanimli) + ayni JBoss nesli + ayni JVM adi (buyuk / kucuk harf
 * duyarsiz). Farkli JVM adiyla kurulmus kopyalar (or. PAY1 / PAY2) ayni grup SAYILMAZ.
 * Taramadan dusen sunucu varsayilan olarak girmez (dusenDahil=true yalniz Kopya Durumu'nun "taramadan
 * dustu" notu icin; sayima girmez); bayatDahil=false iken bayat sunucu da girmez (karar kumesi).
 * @returns {Map<string, Array<{ h: object, j: object }>>} anahtar `${env}|${gen}|${ad}`
 */
function kopyaGruplari(hostlar, { bayatDahil = false, dusenDahil = false } = {}) {
  const ix = new Map();
  for (const h of hostlar || []) {
    if (!ORTAM_GRUBU[h.env]) continue;
    if (h.taramadanDustu ? !dusenDahil : !bayatDahil && !taze(h)) continue;
    for (const j of h.jvms || []) {
      if (!j.name || yalnizEnvanter(j)) continue;
      const k = `${h.env}|${Number(j.gen) || 0}|${L(j.name)}`;
      if (!ix.has(k)) ix.set(k, []);
      ix.get(k).push({ h, j });
    }
  }
  return ix;
}

/**
 * Kopya grubunun karari. grup: TAZE kopyalar (kopyaGruplari varsayilani). Ikiden az sunucuda null.
 * Sapan kopya: calisma (calisan kopya varken kapali olan; olculemeyen kapali SAYILMAZ) ve auto-start
 * (azinlik; esitlikte 'false' olan).
 */
function kopyaKarari(grup) {
  if (new Set(grup.map((c) => c.h.host)).size < 2) return null;
  const olculen = grup.filter((c) => bilinen(c.j));
  const acik = olculen.filter((c) => c.j.running);
  const kapali = olculen.filter((c) => !c.j.running);
  const as = grup.filter((c) => c.j.autoStart === 'true' || c.j.autoStart === 'false');
  const t = as.filter((c) => c.j.autoStart === 'true').length;
  const f = as.length - t;
  const cogunluk = t >= f ? 'true' : 'false';
  return {
    calisan: acik.length,
    kapali: kapali.length,
    olculemeyen: grup.length - olculen.length,
    autoStartAcik: t,
    autoStartKapali: f,
    calismaTutarsiz: acik.length > 0 && kapali.length > 0,
    autoStartTutarsiz: t > 0 && f > 0,
    nedenler: (c) => {
      const n = [];
      if (acik.length && kapali.includes(c)) n.push('calisma');
      if (t && f && as.includes(c) && c.j.autoStart !== cogunluk) n.push('autostart');
      return n;
    },
  };
}

/**
 * @param {object[]} hostlar  assess sunuculari (env, fresh, taramadanDustu, jvms)
 * @param {{ capraz?: object|null, envanter?: Array<{ app: string, env: string|null }>,
 *   earOf?: (host: string) => { uygulamalar: Array<{ ad: string, kok: string }> }|null }} g
 *   earOf: sunucunun TAZE Uygulama Envanteri verisi (yoksa / eskiyse null: paket iddiasi kurulmaz)
 * @returns {{ jvm: (host: string, j: object) => object|null, host: (host: string) => object[] }}
 */
function caprazAnaliz(hostlar, { capraz = null, envanter = [], earOf = () => null } = {}) {
  const ocp = capraz && capraz.ocp && !capraz.ocp.okunamadi ? capraz.ocp.indeks : null;
  const kullanim =
    capraz && capraz.kullanim && !capraz.kullanim.okunamadi ? capraz.kullanim.indeks : null;
  const ret =
    capraz && capraz.retirement && !capraz.retirement.okunamadi ? capraz.retirement.hedefler : null;
  const sonuc = new Map();
  const hostSonuc = new Map();
  const anahtar = (h, j) => `${h.host}|${Number(j.gen) || 0}|${L(j.name)}`;
  const al = (h, j) => {
    const k = anahtar(h, j);
    if (!sonuc.has(k))
      sonuc.set(k, {
        kopya: null,
        kalinti: null,
        ocp: null,
        celiski: [],
        dogrulanamadi: [],
        retirement: [],
      });
    return sonuc.get(k);
  };
  const hostBekleyen = new Map();
  const ekle = (m, k, v) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };

  const canli = hostlar.filter((h) => !h.taramadanDustu);
  // ── Retirement indeksi: host|uygulama -> hedefler ─────────────────────────────
  const retIx = new Map();
  for (const t of ret || []) ekle(retIx, `${kisaHost(t.host)}|${L(t.uygulama)}`, t);
  // Retirement hedefinin uygulamasi MWAppsInventory adidir (or. GBFACELIFTSUBE-T); numarali / grup
  // eslesmesiyle baglanan tarama JVM'i (GBFACELIFTSUBE-T1) o kayda invApp uzerinden de baglanir.
  const retOf = (h, j) =>
    [
      ...new Set([
        ...(retIx.get(`${h.host}|${L(j.name)}`) || []),
        ...((j.invApp && retIx.get(`${h.host}|${L(j.invApp)}`)) || []),
      ]),
    ].filter((t) => t.gen == null || t.gen === (Number(j.gen) || 0));

  // ── Tek gecis: kopya gruplari (kopyaGruplari: Kopya Durumu sekmesiyle TEK kural), taban ad gruplari ──
  const kopyaIx = kopyaGruplari(canli);
  // Bulgu metnindeki payda Kopya Durumu sekmesiyle AYNI: bayat kopya toplamda, "bilinmiyor" olarak.
  const kopyaTumIx = kopyaGruplari(canli, { bayatDahil: true });
  const tabanIx = new Map();
  for (const h of canli)
    for (const j of h.jvms || []) {
      if (!j.name) continue;
      // Retirement kaydi bilgi olarak satira baglanir; taban ad indeksine (kalinti) yalniz tarama JVM'i.
      const r0 = retOf(h, j);
      if (r0.length)
        al(h, j).retirement = r0.map((t) => ({ kayit: t.kayit, hedef: t.hedef, durum: t.durum }));
      if (yalnizEnvanter(j)) continue;
      ekle(tabanIx, U(uygTaban(j)), { h, j });
    }

  // ── kopya: ayni ortamda sapan kopya ─────────────────────────────────────────
  for (const [kopyaAnahtari, grup] of kopyaIx) {
    const karar = kopyaKarari(grup);
    if (!karar) continue;
    const toplam = (kopyaTumIx.get(kopyaAnahtari) || grup).length;
    for (const c of grup) {
      const nedenler = karar.nedenler(c);
      if (!nedenler.length) continue;
      al(c.h, c.j).kopya = {
        nedenler,
        digerleri: grup
          .filter((x) => x !== c)
          .slice(0, 10)
          .map((x) => ({
            host: x.h.host,
            calisiyor: bilinen(x.j) ? !!x.j.running : null,
            autoStart: x.j.autoStart || 'unknown',
          })),
        kopyaSayisi: grup.length,
        // Bulgu metni "x/y kopya calisiyor" (2026-11-14): y = bayat dahil toplam (Kopya Durumu ile ayni);
        // olculemeyen ve bayat kopya "bilinmiyor", kapali sayilmaz.
        calisanSayisi: karar.calisan,
        toplamSayisi: toplam,
        bilinmeyenSayisi: toplam - karar.calisan - karar.kapali,
      };
    }
  }

  // ── kalinti: prod'da calismayan uygulamanin non-prod kopyasi calisiyor ─────────
  const envanterProd = new Set();
  for (const a of envanter || [])
    if (a && a.env === 'PROD' && a.app) envanterProd.add(U(tabanAd(a.app)));
  for (const [taban, liste] of tabanIx) {
    const calisanNonprod = liste.filter(
      (c) => NONPROD.has(c.h.env) && taze(c.h) && bilinen(c.j) && c.j.running,
    );
    if (!calisanNonprod.length) continue;
    const prod = liste.filter((c) => c.h.env === 'PROD');
    // Bayat ya da olculemeyen prod kopyasi: prod'un bugunku durumu bilinmiyor, iddia kurulmaz.
    if (prod.some((c) => !taze(c.h) || !bilinen(c.j))) continue;
    if (prod.some((c) => c.j.running)) continue;
    if (!prod.length && envanterProd.has(taban)) continue;
    const prodRet = prod.flatMap((c) => retOf(c.h, c.j)).filter((x) => KAPATILMIS.has(x.durum));
    const neden = (() => {
      if (prodRet.length) return 'PROD_RETIRE';
      if (prod.length) return 'PROD_KAPALI';
      return 'PROD_YOK';
    })();
    const ocpProd = ocp
      ? (ocp.get(normAd(taban)) || []).filter((x) => NS_GRUBU[x.ortam] === 'prod')
      : null;
    for (const c of calisanNonprod)
      al(c.h, c.j).kalinti = {
        neden,
        // Metinde bu kopyanin kendi yazimi (indeks anahtari buyuk harf).
        taban: uygTaban(c.j),
        prodKopyalar: prod
          .slice(0, 10)
          .map((p) => ({ host: p.h.host, autoStart: p.j.autoStart || 'unknown' })),
        retirement: [...new Set(prodRet.map((x) => x.kayit))],
        ocpProd: ocpProd
          ? ocpProd.slice(0, 5).map((x) => ({ namespace: x.namespace, cluster: x.cluster }))
          : null,
      };
  }

  // ── ocp: ayni taban ad OpenShift'te ayni ortam grubunda ─────────────────────────
  if (ocp)
    for (const h of canli) {
      const grup = ORTAM_GRUBU[h.env];
      if (!grup || !taze(h)) continue;
      for (const j of h.jvms || []) {
        if (!j.name || yalnizEnvanter(j)) continue;
        const taban = uygTaban(j);
        const hits = (ocp.get(normAd(taban)) || []).filter((x) => NS_GRUBU[x.ortam] === grup);
        if (!hits.length) continue;
        // Dynatrace: (namespace, uygulama) basina bir olcum; ayni cift iki cluster'da olsa da bir kez.
        let istek = null;
        let olculdu = !!kullanim;
        let pencere = 0;
        if (kullanim) {
          istek = 0;
          for (const k of new Set(hits.map((x) => `${L(x.namespace)}|${L(x.uygulama)}`))) {
            const o = kullanim.get(k);
            if (!o || o.reqShown == null) olculdu = false;
            else {
              istek += o.reqShown;
              if (o.windowDays && (!pencere || o.windowDays < pencere)) pencere = o.windowDays;
            }
          }
          // Olculen bir yerde istek varsa "var" kesin; hepsi olculmediyse 0 "yok" degildir.
          if (!olculdu && istek === 0) istek = null;
        }
        const jbossBos = (bilinen(j) && !j.running) || j.trafficState === 'NO_RECENT_TRAFFIC';
        al(h, j).ocp = {
          eslesme: hits
            .slice(0, 10)
            .map((x) => ({ namespace: x.namespace, cluster: x.cluster, uygulama: x.uygulama })),
          eslesmeSayisi: hits.length,
          ad: { jboss: j.name, taban, ocp: hits[0].uygulama },
          istek,
          istekOlculdu: olculdu,
          pencereGun: pencere || null,
          kullanimOkunamadi: !kullanim,
          tasinmisOlabilir: jbossBos && istek != null && istek > 0,
          aday: jbossBos || (istek != null && istek > 0),
        };
      }
    }

  // ── celiski: Retirement STOP / silme yapildi ama sunucu baska soyluyor ─────────
  if (ret) {
    const hostIx = new Map(canli.filter(taze).map((h) => [h.host, h]));
    for (const t of ret) {
      if (!KAPATILMIS.has(t.durum)) continue;
      const h = hostIx.get(kisaHost(t.host));
      if (!h) continue;
      // Referans an (ZAMAN KAPISI): JVM durumu da paket adi da STOP'la degisir (STOP paketi .<smart>.old
      // yapar). Silinmis hedefte de referans STOP'tur: STOP ile silme arasindaki taramada ozgun ad
      // kalmissa STOP yarim kalmistir (inceleme B3). STOP zamani yoksa silme ani yedektir.
      let ref = null;
      let refTur = null;
      if (sayiMi(t.durdurulduMs)) {
        ref = t.durdurulduMs;
        refTur = 'STOP';
      } else if (sayiMi(t.silindiMs)) {
        ref = t.silindiMs;
        refTur = 'SILME';
      }
      const paket = yolAdi(t.yol);
      const kok = yolKoku(t.yol);
      const ear = paket && kok ? earOf(h.host) : null;
      // KOK KAPISI: in-place JBoss 7 + 8 (ayni uygulama /vhosting ve /vhosting8'de) STOP yalniz hedef
      // neslin kokundeki paketi .old yapar, obur kokteki ayni adli paketi BILEREK korur. Eslesme
      // hedefin kokunde (app_path'in ust dizini) aranir. Ayni ad baska kokte: yalniz kokler BILINEN iki
      // farkli nesle aitse (obur nesil) sessiz; aksi halde (hedef koku taranan koklerden degil, kok
      // okunamadi) iddia kurulmaz ama sessiz de gecilmez, kok eslenemedi notu (inceleme B4).
      const adEsler = ear ? (ear.uygulamalar || []).filter((u) => U(u.ad) === U(paket)) : [];
      const earAyniKok = adEsler.find((u) => sonEgikSiz(u.kok) === kok) || null;
      const earBaskaKok = (!earAyniKok && adEsler.find((u) => !oburNesil(u.kok, kok))) || null;
      const earMs = ear ? zamanMs(ear.taranma) : null;
      const earSonra = sayiMi(ref) && earMs != null && earMs > ref;
      const earDiskte = earSonra ? earAyniKok : null;
      const jvmler = (h.jvms || []).filter(
        (j) =>
          !yalnizEnvanter(j) &&
          (L(j.name) === L(t.uygulama) || (!!j.invApp && L(j.invApp) === L(t.uygulama))) &&
          (t.gen == null || t.gen === (Number(j.gen) || 0)),
      );
      const ozet = { kayit: t.kayit, hedef: t.hedef, durum: t.durum, durduruldu: t.durduruldu };
      const earNotu = (u, ek) => ({
        ...ozet,
        kaynak: 'EAR',
        nedenler: ['paket'],
        paket: u.ad,
        kok: sonEgikSiz(u.kok),
        tarama: kurumGunMetni(earMs),
        zamanYok: !sayiMi(ref),
        refTur,
        ...ek,
      });
      let earBekleyen = null;
      if (earAyniKok && !earSonra) earBekleyen = earNotu(earAyniKok, {});
      else if (earBaskaKok) earBekleyen = earNotu(earBaskaKok, { kokUyusmaz: true, hedefKok: kok });
      for (const j of jvmler) {
        const sira = shSira(h, j, ref);
        const nedenler = [];
        const eski = [];
        if (bilinen(j) && j.running) (sira === 'sonra' ? nedenler : eski).push('calisiyor');
        if (j.autoStart === 'true') (sira === 'sonra' ? nedenler : eski).push('autostart');
        if (earDiskte) nedenler.push('paket');
        if (nedenler.length)
          al(h, j).celiski.push({ ...ozet, nedenler, paket: earDiskte ? earDiskte.ad : null });
        if (eski.length)
          al(h, j).dogrulanamadi.push({
            ...ozet,
            kaynak: 'SERVER_HUB',
            nedenler: eski,
            paket: null,
            tarama: h.scanDate || null,
            zamanYok: !sayiMi(ref),
            refTur,
            sira: sayiMi(ref) ? sira : null,
          });
        if (earBekleyen) al(h, j).dogrulanamadi.push(earBekleyen);
      }
      // JVM taramada yok ama paket ozgun adiyla diskte: sunucu duzeyinde (EAR konusu).
      if (!jvmler.length && earDiskte)
        ekle(hostSonuc, h.host, {
          ...ozet,
          uygulama: t.uygulama,
          paket: earDiskte.ad,
          kok: sonEgikSiz(earDiskte.kok),
        });
      else if (!jvmler.length && earBekleyen)
        ekle(hostBekleyen, h.host, { ...earBekleyen, uygulama: t.uygulama });
    }
  }

  return {
    jvm: (host, j) => sonuc.get(`${host}|${Number(j.gen) || 0}|${L(j.name)}`) || null,
    host: (host) => hostSonuc.get(host) || [],
    /** Sunucu duzeyi "dogrulama bekliyor" notlari (JVM taramada yok; veri STOP / silmeden eski). */
    hostBekleyen: (host) => hostBekleyen.get(host) || [],
  };
}

// ── Bulgu metinleri (assess.cjs yazar; ekran ve CSV ayni metni gosterir) ──────────
const AS_TR = (v) => {
  if (v === 'true') return 'açık';
  if (v === 'false') return 'kapalı';
  return 'bilinmiyor';
};
const fazlasi = (toplam, gosterilen) => (toplam > gosterilen ? ` +${toplam - gosterilen}` : '');

function kopyaMetni(j, k) {
  const parca = [];
  // "x/y kopya calisiyor" (2026-11-14; kullanici: "prod'da toplam 5 makinede sadece birinde acik").
  if (typeof k.calisanSayisi === 'number')
    parca.push(
      `${k.calisanSayisi}/${k.toplamSayisi || k.kopyaSayisi} kopya çalışıyor${k.bilinmeyenSayisi ? ` (${k.bilinmeyenSayisi} bilinmiyor)` : ''}`,
    );
  if (k.nedenler.includes('calisma')) parca.push('bu kopya kapalı, aynı ortamda çalışan kopya var');
  if (k.nedenler.includes('autostart'))
    parca.push(
      `auto-start ${AS_TR(j.autoStart).toLocaleUpperCase('tr')}, öteki kopyalardan farklı`,
    );
  const d = k.digerleri
    .map(
      (x) =>
        `${x.host} (${(() => {
          if (x.calisiyor == null) return 'ölçülemedi';
          if (x.calisiyor) return 'çalışıyor';
          return 'kapalı';
        })()}, auto-start ${AS_TR(x.autoStart)})`,
    )
    .join(', ');
  return `${parca.join('; ')} — öteki kopyalar: ${d}${fazlasi(k.kopyaSayisi - 1, k.digerleri.length)}`;
}

function kalintiMetni(k) {
  const neden = (() => {
    if (k.neden === 'PROD_YOK') return "prod'da kopyası yok (tarama ve envanter)";
    if (k.neden === 'PROD_RETIRE')
      return `prod kopyası Retirement ile durduruldu (#${k.retirement.join(', #')})`;
    return `prod kopyaları kapalı: ${k.prodKopyalar.map((p) => p.host).join(', ')}`;
  })();
  const o = k.ocpProd && k.ocpProd[0];
  const ocp = o
    ? ` — OpenShift prod'da var (${o.namespace} @ ${o.cluster}${fazlasi(k.ocpProd.length, 1)}): uygulama taşınmış olabilir`
    : '';
  return `${neden}${ocp}`;
}

function ocpMetni(o) {
  const e = o.eslesme[0];
  const yer = `${e.namespace} @ ${e.cluster}${fazlasi(o.eslesmeSayisi, 1)}`;
  const istek = (() => {
    if (o.kullanimOkunamadi) return 'Dynatrace okunamadı';
    if (o.istek == null) return 'Dynatrace isteği ölçülemedi';
    return `Dynatrace ${o.pencereGun || 7} gün: ${o.istek} istek`;
  })();
  const ad = o.ad.jboss === o.ad.ocp ? '' : ` (ad eşleşmesi: ${o.ad.jboss} ↔ ${o.ad.ocp})`;
  const tasinma = o.tasinmisOlabilir
    ? " — JBoss kopyası boşta, uygulama OpenShift'e taşınmış olabilir"
    : '';
  return `OpenShift'te de var: ${yer}${ad} — ${istek}${tasinma}`;
}

function celiskiMetni(c) {
  const p = [];
  if (c.nedenler.includes('calisiyor')) p.push('JVM çalışıyor');
  if (c.nedenler.includes('autostart')) p.push("auto-start AÇIK (reboot'ta geri gelir)");
  if (c.nedenler.includes('paket')) p.push(`paket özgün adıyla diskte (${c.paket})`);
  const ne = c.durum === 'deleted' ? 'silindi' : 'STOP edildi';
  return `Retirement #${c.kayit} hedefi ${ne}${c.durduruldu ? ' (' + c.durduruldu + ')' : ''} ama ${p.join(', ')}`;
}

/** Dogrulama bekliyor (bilgi): eski veri celiski gibi gorunuyor ama STOP / silmeden once alinmis. */
function dogrulamaMetni(b) {
  const ne = b.durum === 'deleted' ? 'silindi' : 'STOP edildi';
  const p = [];
  if (b.nedenler.includes('calisiyor')) p.push('JVM çalışıyor');
  if (b.nedenler.includes('autostart')) p.push('auto-start açık');
  if (b.nedenler.includes('paket')) p.push(`paket özgün adıyla diskte (${b.paket})`);
  const kaynak = b.kaynak === 'EAR' ? 'Uygulama Envanteri (EAR) taraması' : 'Server Hub taraması';
  const silme = b.refTur === 'SILME';
  const bas = `Retirement #${b.kayit} hedefi ${ne}${b.durduruldu ? ' (' + b.durduruldu + ')' : ''}`;
  if (b.kokUyusmaz)
    return `${bas}; paket özgün adıyla başka kökte (${b.kok}/${b.paket}), hedefin kökü ${b.hedefKok || '?'} ${kaynak} (${b.tarama || '?'}) ile eşlenemedi — paketin adı doğrulanamadı`;
  if (b.zamanYok)
    return `${bas}; kayıtta ${b.durum === 'deleted' ? 'STOP / silme' : 'STOP'} zamanı yok — ${kaynak} (${b.tarama || '?'}) ondan önce olabilir: ${p.join(', ')} doğrulanamadı`;
  const an = silme ? 'silme' : 'STOP';
  if (b.sira === 'belirsiz')
    return `${bas}; son ${kaynak} ${an} gününde (${b.tarama || '?'}), ${silme ? 'silmeden' : "STOP'tan"} önce mi sonra mı bilinmiyor — ${p.join(', ')} görünüyor: yeniden tarayın (ertesi günün taraması kesinleştirir)`;
  // Server Hub taramasi gun tasir: ayni gun "once" demek olmaz.
  const sira = (() => {
    if (b.kaynak !== 'EAR') return `${an} günü ya da öncesi`;
    return silme ? 'silmeden önce' : "STOP'tan önce";
  })();
  return `${bas}; son ${kaynak} ${sira} (${b.tarama || '?'}) — ${p.join(', ')} eski veriye ait, doğrulama bir sonraki taramada`;
}

module.exports = {
  caprazAnaliz,
  kopyaGruplari,
  kopyaKarari,
  tabanAd,
  uygTaban,
  normAd,
  yalnizEnvanter,
  kopyaMetni,
  kalintiMetni,
  ocpMetni,
  celiskiMetni,
  dogrulamaMetni,
  kurumGunMetni,
  ORTAM_GRUBU,
  NS_GRUBU,
  // yalniz test (ICU'suz Node yedegi)
  _kurumBicimiKur: kurumBicimiKur,
  _kurumGunu: kurumGunu,
};
