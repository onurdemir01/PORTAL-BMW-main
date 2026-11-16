// server/server-hub/reboot-check.cjs — Server Hub > Reboot Kontrolu (2026-10-08).
//
// Kullanici: "reboot olacak bir sunucu var. calisma oncesi bu job'i calistirip sunucuda ne vardi ne
// yoktu not aliyor. reboot sonrasi onceki durum ile karsilastiriyor; onceden varolan ancak acilmamis
// process/jvm varsa aciyor, onceden olmayan ancak acilmis varsa kapatiyor ... Calisma oncesi ve
// sonrasi calistiralim, sunucunun sorunsuz oldugundan emin olalim." Karar: ikisi de OTOMATIK, ama
// TEK JVM bazinda (playbook: bmw_automation_folder/patch_remediation/reboot_check.yml). Sadelestirme
// (2026-10-08): yalniz Nginx/RHA/IHS/CTG/JBoss7/JBoss8/WAS urunleri ve JBoss/WAS JVM'leri; python vb. yok.
//
// "ONCE" GORUNTUSU PORTAL'DA SAKLANIR: ilk tasarim onu sunucuda /tmp'ye (reboot'ta silinebilir) ve
// AWX'in gecici is dizinine (job bitince silinir) yaziyordu. Burada once job'inin set_stats sonucu
// reboot_checks.once_json'a yazilir; "sonra" job'ina rc_once olarak Portal verir.
//
// SORUNSUZ = son goruntu OLCULDU ve "once" ile farki YOK. Olculemeyen sunucu sorunsuz SAYILMAZ.
//
// KONTROL GEREKLI (2026-11-14, ilk gercek kosu: her sey "dokunulmadi" yazdi ve sunucular "sorunsuz"
// cikti). Fark kalmasa bile iki durumda sunucu SORUNSUZ SAYILMAZ, durum 'kontrol' olur:
//   (a) "once" goruntusunde hic izlenen satir (URUN/JVM) yok: v4'ten (2026-11-16) beri betik reboot sonrasi calisan HER
//       urunu (Nginx/Apache/IHS/CTG/JBoss/WAS, prod dahil) kapatir; kapatilan her urun "kontrol edilecek" der;
//   (b) once calismayan bir urun ya da (urunu once calismayan) JVM simdi CALISIYOR. 2026-11-15'ten beri
//       ("nasil bulduysan oyle birak") betik once calismayan URUNU KAPATIR: hala calisan yeni urun KALAN'dir
//       (sorunlu; portalKalan FARK|NEW|URUN; URUN satiri olmayip JVM'i calisan yeni urun de - sonKume). Yalniz
//       kapatma kapisinin (kapatmaKapisi, yalniz ham once'den) korudugu oge (once BOOT'suz ya da eski surum
//       once'nin JBoss 7/8 urunu; v4: bos once hicbir seyi korumaz) "dokunulmadi" der ve kontrol nedenidir; urunu kapatilmasi gereken JVM'i de kontrol;
//   (c) once goruntusu eski betik surumuyle alinmis ve JBoss 7 urun satiri cevrilemedi (BILGI|BELIRSIZ) ya da
//       AWX'teki eski betik JBoss'u hic islemedi (BILGI|ESKI). 2026-11-15'ten beri JBoss satirlari cevrilir;
//   (d) v3: otomasyon reboot oncesi calismayan bir URUNU kapatti (SONUC|durdur|<urun>||OK) - "kapatip kontrol edilecek";
//   (e) v3: sonra sonucunda betik_surum yok ya da BETIK_SURUM_GEREKLI'den kucuk (AWX'teki betik eski). 2026-11-16: sunucu
//       bazinda ve etkiye gore (betikEtkisi): surum < 3 her sunucuda; surum 3 yalniz bos once + son kontrolde hala calisan
//       CTG/JBoss/WAS (yalniz ilk goruntude calisip kendiliginden kapanan icin notr kontrol notu, 'betik eski' degil).
// Kalan: betigin son_fark'i ile Portal'in ayni kuralla kendi hesabinin (portalKalan) buyugu.
// Kayit durumu: hic 'sorunlu' / 'olculemedi' yok ve en az bir 'kontrol' varsa 'kontrol'.
// v4 (2026-11-16, rapor yoneticiye gidiyor): (a) TEK nedeni olan sunucu 'kontrol' DEGIL, notr 'kapsam_disi' ("Karsilastirma
// disi"); baska neden varsa o kazanir, once-bos metni 'bilgi' notu olur. Tumu kapsam_disi olan kayit 'tamam' sayilmaz.
// Komut koprusu (komutSayaci) ve yonetici ozeti (yoneticiOzeti) burada; rapor ve ekran ayni sayilari kullanir.
'use strict';
const { varsayilanSira } = require('../util/siralama.cjs');

const REGISTRY_KEY = 'reboot_check';
// Varsayilan; Admin Server Hub > Kurallar & Limitler'den degistirir (ayarlar.cjs 'limit:reboot').
const MAX_HOST = 500;
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
// "sonra" (yeniden) kosturulabilen kayit durumlari; ekran (RebootKontroluTab) ayni listeyi kullanir.
const SONRA_ACIK = ['once_hazir', 'tamam', 'sorunlu', 'sonra_hata', 'kontrol'];

const db = () => require('../db/index.cjs');
const jsonOku = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

const dizi = (x) => (Array.isArray(x) ? x : []).map((l) => String(l));
const URUNLER = ['NGINX', 'RHA', 'IHS', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS'];
const URUN_ADI = {
  NGINX: 'Nginx',
  RHA: 'Apache HTTP Server',
  IHS: 'IBM HTTP Server (IHS)',
  CTG: 'CTG',
  JBOSS7: 'JBoss 7',
  JBOSS8: 'JBoss 8',
  WAS: 'WebSphere',
};

// SURUM ISARETI (v3): playbook rc_sonuc'a betik_surum yazar. Yoksa ya da GEREKLI'den kucukse AWX'teki betik eski:
// o kosuda urun kapatma ve yeniden deneme YOKTU. Portal bunu kesin soyler ("eski betik olabilir" demez).
// v4: bos once'de her urunu kapatan betik surum 4 (kapiKorur ile ayni kural); daha eskisi 'betik eski' sayilir.
// 2026-11-16: 'betik eski' notu SUNUCU BAZINDA ve ETKIYE gore verilir (betikEtkisi): surum < 3 her sunucuda; surum 3 yalniz
// bos once + son goruntude hala calisan CTG/JBoss/WAS olan sunucuda; betikSurumu().guncel yalniz ham surum bilgisidir.
const BETIK_SURUM_GEREKLI = 4;
function betikSurumu(r) {
  const ham = r?.betik_surum;
  const yazili = ham !== undefined && ham !== null && String(ham).trim() !== '';
  const n = Number(ham);
  return {
    guncel: yazili && Number.isFinite(n) && n >= BETIK_SURUM_GEREKLI,
    etiket: yazili ? `sürüm ${String(ham).trim()}` : 'sürüm yok',
  };
}
// Inceleme B1 (2026-11-16): surum 3 betiginde urun kapatma ve 3x120 sn yeniden deneme VARDI (ansible 68af043c7); eksigi yalniz
// bos once'de CTG/JBoss/WAS'i kapatmamasiydi. Surum 3'e "kapatma YOKTU" demek yanlis olurdu; metin surume gore yazilir.
const ESKI_SURUM_3 =
  "bu koşudaki betik (sürüm 3) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini (Nginx/Apache/IHS) kapatırdı, CTG/JBoss/WAS'a dokunmazdı; sürüm 4 reboot sonrası çalışan her ürünü kapatır";
const ESKI_SURUM_GENEL = 'bu koşuda ürün kapatma ve yeniden deneme YOKTU';
/**
 * Surum etiketinden (betikSurumu().etiket) eski surumun ne yapmadigi (ekran rebootKontrolu.ts eskiSurumNedeni ile BIREBIR).
 * Inceleme B5: etiket metniyle degil SAYIYLA karar verilir ("surum 3.0" etiketi betikEtkisi'nde de surum 3 sayilir; iki metin celismez).
 */
const eskiSurumNedeni = (etiket) => {
  const m = /^sürüm (.+)$/.exec(String(etiket || ''));
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(n) && n >= 3 ? ESKI_SURUM_3 : ESKI_SURUM_GENEL;
};
const betikEskiMetni = (r) => {
  const { etiket } = betikSurumu(r);
  return `AWX'teki reboot_check betiği eski (${etiket}, gerekli ${BETIK_SURUM_GEREKLI}): ${eskiSurumNedeni(etiket)}. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`;
};
/** Kayit duzeyi bant (ekran rebootKontrolu.ts betikEskiMetni + sayi ile BIREBIR): etiketler = etkilenen sunucularin surum etiketleri. */
function betikEskiBandi(etiketler, n) {
  const nedenler = [...new Set(etiketler.map(eskiSurumNedeni))];
  const neden = nedenler.length === 1 ? nedenler[0] : etiketler.map((x) => `${x}: ${eskiSurumNedeni(x)}`).join('; ');
  return `AWX'teki reboot_check betiği eski (${etiketler.join(' / ')}, gerekli ${BETIK_SURUM_GEREKLI}): ${neden}. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın. (${n} sunucuda etkili)`;
}

/** SONUC satirlari -> { islem, urun, ad, sonuc, mesaj }. */
function sonucSatirlari(r) {
  return dizi(r?.islemler)
    .filter((l) => l.startsWith('SONUC|'))
    .map((l) => {
      const q = l.split('|');
      return { islem: q[1] || '', urun: q[2] || '', ad: q[3] || '', sonuc: q[4] || '', mesaj: q.slice(5).join('|') };
    });
}
const izlenenVar = (satirlar) => dizi(satirlar).some((l) => /^(URUN|JVM)\|/.test(l));
const bootVar = (satirlar) => dizi(satirlar).some((l) => l.startsWith('BOOT|'));
const surumVar = (satirlar) => dizi(satirlar).some((l) => l.startsWith('SURUM|'));
const JB_SATIR = /^(URUN|JVM)\|JBOSS[78]\|/;

/**
 * Eski surum once goruntusu (SURUM satiri yok, JBoss satiri var) yeni surum goruntuyle JBoss bazinda
 * KARSILASTIRILAMAZ: JBoss nesil kurali 2026-11-14'te degisti (reboot_goruntu.sh). reboot_duzelt.sh o durumda
 * JBoss satirlarini iki taraftan da cikarir ve BILGI|ESKI yazar; Portal, rapor ve ekran ayni kurali kullanir.
 */
function nesilKarsilastirilamaz(once, diger) {
  return !surumVar(once) && dizi(once).some((l) => JB_SATIR.test(l)) && surumVar(diger);
}

/**
 * CEVIRI (2026-11-15, ilk gece kosusu: JBoss tumden disarida kalinca kapali JVM acilmadi, fazla JVM kapatilmadi).
 * Eski surum once goruntusunun JBoss satirlari CIKARILMAZ, yeni kurala cevrilir (reboot_duzelt.sh nesil_cevir ile
 * BIREBIR): JVM nesli = ayni jboss_home'lu diger-goruntu JVM'inin nesli; yoksa home'da jboss8/vhosting8 -> JBOSS8;
 * yoksa eski etiket. URUN|JBOSS7 yalniz cevrilmis bir JBOSS7 JVM'i ya da digerinde URUN|JBOSS7 varsa kalir; yoksa
 * cikarilir ve 'belirsiz' (dokunulmadi, kontrol gerekli). Eski degilse satirlar aynen doner.
 * -> { satirlar, cevrildi, belirsiz: ['JBOSS7'] | [] }
 */
const evDizini = (d) => (String(d || '').startsWith('jboss_home=') ? String(d).slice(11) : '');
function onceNesilCevir(once, diger) {
  const o = dizi(once);
  if (!nesilKarsilastirilamaz(o, diger)) return { satirlar: o, cevrildi: false, belirsiz: [] };
  const harita = new Map();
  let d7 = false;
  for (const l of dizi(diger)) {
    const q = l.split('|');
    if (q[0] === 'JVM' && /^JBOSS[78]$/.test(q[1])) {
      const h = evDizini(q[3]);
      if (h) harita.set(h, q[1]);
    }
    if (q[0] === 'URUN' && q[1] === 'JBOSS7') d7 = true;
  }
  let j7 = false;
  const cev = o.map((l) => {
    const q = l.split('|');
    if (q[0] !== 'JVM' || !/^JBOSS[78]$/.test(q[1])) return l;
    const h = evDizini(q[3]);
    const g = h && harita.has(h) ? harita.get(h) : /jboss8|vhosting8/.test(h) ? 'JBOSS8' : q[1];
    if (g === 'JBOSS7') j7 = true;
    return [q[0], g, ...q.slice(2)].join('|');
  });
  const belirsiz = !j7 && !d7 && cev.some((l) => l.startsWith('URUN|JBOSS7|'));
  return { satirlar: belirsiz ? cev.filter((l) => !l.startsWith('URUN|JBOSS7|')) : cev, cevrildi: true, belirsiz: belirsiz ? ['JBOSS7'] : [] };
}

/** Goruntu satirlari -> { urun: Set, jvm: Set('URUN|ad') }; haricJb: JBoss satirlari sayilmaz. */
function kume(satirlar, haricJb = false) {
  const g = { urun: new Set(), jvm: new Set() };
  for (const l of dizi(satirlar)) {
    if (haricJb && JB_SATIR.test(l)) continue;
    const p = l.split('|');
    if (p[0] === 'URUN' && p[1]) g.urun.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) g.jvm.add(`${p[1]}|${p[2]}`);
  }
  return g;
}
/** Reboot oncesi kume (reboot_duzelt.sh once_norm): URUN satirlari + JVM'i gorulen urunler. */
function onceKume(satirlar, haricJb = false) {
  const g = kume(satirlar, haricJb);
  for (const k of g.jvm) g.urun.add(k.split('|')[0]);
  return g;
}

/**
 * KAPATMA KAPISI (reboot_duzelt.sh kapatma_kapisi ile BIREBIR, 2026-11-15): YALNIZ ham once'den hesaplanir (karsi goruntuden
 * bagimsiz; betik plani ilk goruntuyle, Portal son goruntuyle bakar - ayni sonucu vermeli). 'bos' = once'de BOOT ya da izlenen
 * satir yok (her sey "yeni" gorunur); 'eski' = eski surum once (SURUM yok, JBoss satiri var) -> JBoss 7/8 urunleri HIC
 * kapatilmaz (inceleme R1 B1: ilk goruntude HC kalkmis, JVM'leri kalkmamisken reboot oncesi CALISAN JBoss 8 domain'i "yeni"
 * sanilip kapatilabiliyordu). -> 'bos'|'eski'|''
 */
// v3 (2026-11-15 aksam, kullanici: "Nginx, apache, ihs urunlerini halen kapatmamissin, kontrol edilecek yazmissin.
// Kapatip, kontrol edilecek yaz"): 'bos' kapida web urunleri (NGINX/RHA/IHS) artik KAPATILIR. v4 (2026-11-16): 'bos'
// kapi hicbir urunu korumaz (kapiKorur); 'bos' degeri yalniz bilgi icin doner.
// BOOT'suz once 'bootsuz' doner: betik plani HATA yazar, hicbir sey yapilmaz -> hepsi korunur.
// -> 'bootsuz'|'bos'|'eski'|''
function kapatmaKapisi(once) {
  if (!bootVar(once)) return 'bootsuz';
  if (!izlenenVar(once)) return 'bos';
  return !surumVar(once) && dizi(once).some((l) => JB_SATIR.test(l)) ? 'eski' : '';
}
// v4 (2026-11-16, kullanici GBTDST01: "standart kurulum, dokunmak istesen dokunurdun"; secim "Her yerde kapat"): 'bos' kapi
// HICBIR urunu korumaz (prod dahil); reboot sonrasi calisan her urun kapatilir ve "kontrol edilecek" der. Yalniz 'eski'
// (JBoss nesli belirsiz) ve 'bootsuz' (betik plani HATA) korur. Betik reboot_duzelt.sh korunur() ile BIREBIR (RC_DUZELT_SURUM=4).
const kapiKorur = (kapi, u) =>
  kapi === 'bootsuz' ||
  (kapi === 'eski' && /^JBOSS[78]$/.test(u));

/**
 * Son (ya da ilk) goruntu kumesi + CIKARIM (reboot_duzelt.sh simdi_dosya ile ayni, inceleme R2 #2): reboot oncesi calismayan
 * urunun JVM'i calisiyor ama URUN satiri yoksa (HC ps'te yok) urun calisiyor sayilir -> kapatilir / kalan'da. Yalniz once
 * kumesinde OLMAYAN urunlere (once calisan urunun DOWN kurali degismez).
 */
function sonKume(satirlar, onceUrun) {
  const g = kume(satirlar);
  for (const k of g.jvm) {
    const u = k.split('|')[0];
    if (!onceUrun.has(u)) g.urun.add(u);
  }
  return g;
}

/**
 * BETIK ETKISI (2026-11-16 uretim, 104 sunuculu kayit: AWX'te surum 3 kostu, GEREKLI=4 oldugu icin HER sunucu 'kontrol' oldu -
 * kullanici: "bu sefer tum sunucular icin kontrol gerekli yaziyor"). Surum 3 ile 4 arasindaki TEK davranis farki: once goruntusu
 * BOS (kapatmaKapisi 'bos') sunucuda reboot sonrasi calisan CTG/JBoss 7/JBoss 8/WAS'in kapatilmasi (v3 yalniz web urunlerini
 * kapatirdi). 'Betik eski' bu yuzden SUNUCU BAZINDA ve ETKIYE gore (ekran rebootKontrolu.ts betikEtkisi ile BIREBIR):
 *   surum yok / < 3 -> her sunucuda eski (kapatma ve yeniden deneme hic yoktu); kapatmaz(u) her urun icin true;
 *   surum 3         -> yalniz bos once + SON goruntude (sonKume cikarimi dahil) hala CTG/JBoss/WAS calisan sunucuda eski;
 *                      kapatmaz(u) yalniz o urunler; diger sunucularda surum 3 guncel sayilir (hicbir 'eski' notu yok);
 *   surum >= 4      -> guncel.
 * Inceleme B2 (2026-11-16): bos once'de CTG/JBoss/WAS yalniz ILK goruntude calisip son kontrolde kendiliginden kapandiysa
 * (gecti) son durum v4'un verecegiyle ayni: yeniden kosmak bir sey degistirmez. Bu sunucu 'betik eski' SAYILMAZ (bant sayisina
 * girmez, "ZIP'i yukleyin" denmez); yalniz notr bir kontrol notu (gectiNotu) doner - v4'te de KAPATTI nedeniyle kontrol olurdu.
 * once verilmezse (eski cagiran) bos kapi plandaki BILGI|BOS satirindan anlasilir. Cagiran once'yi onceGirdisi'nden
 * (goruntu_ok + BOOT) vermelidir; ham once kullanilmaz (inceleme B1).
 * -> { eski, etiket, urunler, hala, gecti, kapatmaz(u), metin, gectiNotu }
 */
const V3_BOS_KAPATMAZ = ['CTG', 'JBOSS7', 'JBOSS8', 'WAS'];
function betikEtkisi(once, r) {
  const surum = betikSurumu(r);
  const yok = { eski: false, etiket: surum.etiket, urunler: [], hala: [], gecti: [], kapatmaz: () => false, metin: '', gectiNotu: '' };
  if (!r || surum.guncel) return yok;
  const n = Number(r.betik_surum);
  if (!(Number.isFinite(n) && n >= 3))
    return { ...yok, eski: true, kapatmaz: () => true, metin: betikEskiMetni(r) };
  const onceVar = Array.isArray(once) && bootVar(once);
  const bos = onceVar ? kapatmaKapisi(once) === 'bos' : dizi(r.plan).some((l) => l.startsWith('BILGI|BOS|'));
  if (!bos) return yok;
  const ilk = sonKume(r.goruntu, new Set()).urun;
  const son = sonKume(r.son_goruntu, new Set()).urun;
  const hala = V3_BOS_KAPATMAZ.filter((u) => son.has(u));
  const gecti = V3_BOS_KAPATMAZ.filter((u) => !son.has(u) && ilk.has(u));
  if (!hala.length && !gecti.length) return yok;
  const ad = (x) => x.map((u) => URUN_ADI[u]).join(', ');
  return {
    eski: hala.length > 0,
    etiket: surum.etiket,
    urunler: hala,
    hala,
    gecti,
    kapatmaz: (u) => V3_BOS_KAPATMAZ.includes(u),
    metin: hala.length
      ? `AWX'teki reboot_check betiği eski (${surum.etiket}, gerekli ${BETIK_SURUM_GEREKLI}): ${ad(hala)} reboot öncesi çalışmıyordu ve hâlâ çalışıyor; reboot öncesi görüntüsü boş sunucuda AWX'teki betik sürüm 3 bunları kapatmaz (sürüm 4 kapatır). ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`
      : '',
    gectiNotu: gecti.length
      ? `${ad(gecti)} reboot öncesi çalışmıyordu, reboot sonrası çalıştı ve son kontrolde kendiliğinden kapanmıştı; ${surum.etiket} betik reboot öncesi görüntüsü boş sunucuda bunlara dokunmaz. Son durum reboot öncesiyle aynı (yeniden çalıştırmak bir şey değiştirmez) — beklenen durum mu kontrol edin.`
      : '',
  };
}

/**
 * Portal'in KENDI kalan hesabi (reboot_duzelt.sh kalan ile ayni kural, saf): once calisan her urun/JVM son
 * goruntude yoksa DOWN; once calisan urunun once olmayan JVM'i son goruntude varsa NEW; once calismayan URUN son
 * goruntude hala calisiyorsa NEW (2026-11-15, betik kapatir; kapatma kapisinin korudugu urun haric). Betigin son_fark'i
 * kaydin alindigi gunun kuraliyla hesaplanir; eski kayit yeni kuralla bu fonksiyonla yeniden degerlendirilir (eski
 * betigin dokunmadigi yeni urun de boylece "kalan" gorunur - durust; guncel betikle yeniden calistirilir).
 */
function portalKalan(once, son) {
  const cev = onceNesilCevir(once, son);
  const kapi = kapatmaKapisi(once);
  const o = onceKume(cev.satirlar);
  const s = sonKume(son, o.urun);
  const out = [];
  for (const u of [...o.urun].sort(varsayilanSira)) if (!s.urun.has(u)) out.push(`FARK|DOWN|URUN|${u}||`);
  for (const k of [...o.jvm].sort(varsayilanSira)) if (!s.jvm.has(k)) out.push(`FARK|DOWN|JVM|${k}|`);
  for (const k of [...s.jvm].sort(varsayilanSira))
    if (!o.jvm.has(k) && o.urun.has(k.split('|')[0])) out.push(`FARK|NEW|JVM|${k}|`);
  for (const u of [...s.urun].sort(varsayilanSira))
    if (!o.urun.has(u) && !kapiKorur(kapi, u)) out.push(`FARK|NEW|URUN|${u}||`);
  return out;
}

/**
 * Bir sunucuyu (fark kalmasa da) 'kontrol' yapan nedenler (saf). once: o sunucunun "once" satirlari.
 * "Once calismayip simdi calisan" oge (kapatma kapisinin korudugu ya da kapatilamamis) DOGRUDAN once <-> son goruntu karsilastirmasiyla
 * bulunur (rapor NEW_URUN kuraliyla ayni); plan BILGI satirlari yalniz plandan SONRA kalkan ogeyi kacirirdi.
 * once verilmezse (eski cagiran) plandaki BILGI satirlarina bakilir.
 */
// v3: bos once'de web urunleri yine kapatilir; "hicbir sey acilip kapatilmadi" artik yanlis olurdu.
// v4 (2026-11-16, "Her yerde kapat"): bos once'de reboot sonrasi calisan HER urun kapatilir (prod dahil).
const ONCE_BOS_NEDEN =
  'Reboot öncesi görüntüde izlenen ürün/JVM yoktu; reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür ve kontrol edilecek (uygulamalar zaten kapalıyken mi alındı?).';
// v4 (2026-11-16, kullanici: "once goruntusu bos satirlarini Kontrol Gerekli uyarili cikartiyoruz; yonetici 'bunlar ne
// uyarilari' diyecek"): tek nedeni once-bos olan sunucu UYARI degil, notr "Karsilastirma disi" sinifidir.
const KAPSAM_DISI_ACIKLAMA =
  'Reboot öncesi bu sunucuda izlenen uygulama (Nginx/Apache/IHS/CTG/JBoss/WAS) çalışmıyordu; karşılaştırılacak bir şey yoktu.';
const REBOOT_DOGRULANAMADI =
  'Sunucunun açılış kimliği reboot öncesiyle aynı; reboot doğrulanamadı.';

/** Once ve ilk goruntunun BOOT kimligi ayni mi (rapor REBOOT_NOT_CONFIRMED ile ayni kural); bilinmiyorsa false. */
function rebootDogrulanamadi(once, r) {
  const boot = (satirlar) => {
    const l = dizi(satirlar).find((x) => x.startsWith('BOOT|'));
    return l ? l.split('|')[1] || '' : '';
  };
  const o = boot(once);
  const i = boot(r?.goruntu);
  return !!o && !!i && o !== 'bilinmiyor' && o === i;
}

// Otomasyonun kapattigi urun nedeni (yoneticiOzeti Y7/B2 bu nedeni ayirt eder; metin ve kalip tek yerden).
const KAPATTI_EKI = ' — otomasyon KAPATTI; beklenen durum mu kontrol edin.';
const KAPATTI_NEDENI = / — otomasyon KAPATTI; beklenen durum mu kontrol edin\.$/;

/** Bir sunucuyu (fark kalmasa da) 'kontrol' yapan nedenler; once-bos ayri doner -> { onceBos, neden: [digerleri] } (saf). */
function kontrolNedenAyrimi(once, r) {
  const neden = [];
  const plan = dizi(r?.plan);
  const onceVar = Array.isArray(once) && bootVar(once);
  const onceBos = (onceVar && !izlenenVar(once)) || plan.some((l) => l.startsWith('BILGI|BOS|'));
  const surum = betikSurumu(r);
  // 2026-11-16: 'betik eski' sunucu bazinda ve etkiye gore (betikEtkisi); surum 3 yalniz bos once + calisan CTG/JBoss/WAS'ta.
  const etki = betikEtkisi(once, r);
  if (etki.eski) neden.push(etki.metin);
  // Inceleme B2: yalniz ilk goruntude calisip kendiliginden kapanan CTG/JBoss/WAS -> notr kontrol notu (betik eski degil).
  if (etki.gectiNotu) neden.push(etki.gectiNotu);
  // ESKI: AWX'teki ESKI betik JBoss'u hic islemedi (2026-11-14 surumu). Yeni betik cevirir (BILGI|NESIL, kontrol degil);
  // yalniz cevrilemeyen JBoss 7 urunu (BILGI|BELIRSIZ ya da Portal'in ayni hesabi) kontrol nedenidir.
  if (plan.some((l) => l.startsWith('BILGI|ESKI|')))
    neden.push(
      'Reboot öncesi görüntü eski betik sürümüyle alınmış ve AWX\'teki eski betik JBoss ürün/JVM\'lerine dokunmadı. Güncel betikle "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.',
    );
  const cev = onceVar ? onceNesilCevir(once, r?.son_goruntu) : { satirlar: [], belirsiz: [] };
  if (cev.belirsiz.length || plan.some((l) => l.startsWith('BILGI|BELIRSIZ|')))
    neden.push(
      'Reboot öncesi görüntü eski betik sürümüyle alınmış; JBoss 7 ürün satırının nesli belirlenemedi (JBoss 8 olabilir) — JBoss 7 ürününe dokunulmadı, elle kontrol edin.',
    );
  // 2026-11-15 ("nasil bulduysan oyle birak"): once calismayan urun KAPATILIR. Hala calisan oge iki turdur:
  //   korunan (kapatma kapisi: eski surum once'nin JBoss urunu; v4'ten beri bos once korumaz) -> gercekten "dokunulmadi";
  //   kapatilmasi gereken (urun; ya da urunu once calismayan JVM) -> "hala calisiyor" (urun ayrica KALAN'da, sorunlu).
  const korunan = [];
  const kapanmali = [];
  const ekle = (liste, etiket) => {
    if (!liste.includes(etiket)) liste.push(etiket);
  };
  if (onceVar) {
    const kapi = kapatmaKapisi(once);
    const o = onceKume(cev.satirlar);
    const s = sonKume(r?.son_goruntu, o.urun);
    for (const u of [...s.urun].sort(varsayilanSira))
      if (!o.urun.has(u)) ekle(kapiKorur(kapi, u) ? korunan : kapanmali, u);
    for (const k of [...s.jvm].sort(varsayilanSira)) {
      const u = k.split('|')[0];
      if (!o.jvm.has(k) && !o.urun.has(u)) ekle(kapiKorur(kapi, u) ? korunan : kapanmali, k.replace('|', '/'));
    }
  } else {
    const son = new Set(dizi(r?.son_goruntu).map((l) => l.split('|').slice(0, 3).join('|')));
    for (const l of plan) {
      if (!l.startsWith('BILGI|') || !/dokunulmadi/.test(l)) continue;
      const p = l.split('|');
      const u = p[2] || '';
      const ad = p[3] || '';
      if (!u) continue;
      const anahtar = ad ? `JVM|${u}|${ad}` : `URUN|${u}|`;
      const etiket = ad ? `${u}/${ad}` : u;
      // Yeni betikte kapinin korudugu her not 'kapatilmadi' icerir; digeri (yeni betigin "urun asamasinda kapatilir" JVM
      // notu ya da ESKI betigin her "dokunulmadi" notu) yeni kurala gore kapatilmasi gereken ogedir (inceleme R2 #5).
      if (son.has(anahtar)) ekle(/kapatilmadi/.test(l) ? korunan : kapanmali, etiket);
    }
  }
  const liste = (x) => `${x.slice(0, 10).join(', ')}${x.length > 10 ? ' …' : ''}`;
  if (korunan.length)
    neden.push(
      `Reboot öncesi çalışmayan ${korunan.length} öğe şimdi çalışıyor ve dokunulmadı (${onceVar ? 'önce görüntüsü eski sürüm, JBoss nesli belirsiz — kapatma güvenli değildi' : 'plan notuna göre'}): ${liste(korunan)} — beklenen durum mu kontrol edin.`,
    );
  // Surum biliniyor: "eski betikle degerlendirildiyse" gibi belirsiz bir cumle yazilmaz (v3, B3).
  // KARAR (2026-11-16): surum 3 + bos once + hala calisan CTG/JBoss/WAS durumu 'kontrol'e CEKILMEZ: v4 kuraliyla oge hala
  // reboot oncesinden farkli (kalan, 'sorunlu') - durust olan bu; yalniz aciklama kesin olarak "betik surum 3 kapatmadi" der.
  // Oge bazinda: eski betigin kapatmadigi oge (etki.kapatmaz) "betik eski", digeri (or. v3'un kapattigi web urunu) "kontrol edin".
  if (kapanmali.length) {
    const urunu = (x) => x.split('/')[0];
    const eskiK = kapanmali.filter((x) => etki.kapatmaz(urunu(x)));
    const diger = kapanmali.filter((x) => !etki.kapatmaz(urunu(x)));
    const eskiNot = `AWX'teki betik eski (${surum.etiket}): ${eskiSurumNedeni(surum.etiket)}`;
    let kuyruk = 'kapatma sonucunu kontrol edin.';
    if (eskiK.length && !diger.length) kuyruk = `${eskiNot}.`;
    else if (eskiK.length) kuyruk = `${liste(eskiK)} için ${eskiNot}; ${liste(diger)} için kapatma sonucunu kontrol edin.`;
    neden.push(
      `Reboot öncesi çalışmayan ${kapanmali.length} öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: ${liste(kapanmali)} — ${kuyruk}`,
    );
  }
  // v3 B2 ("kapatip, kontrol edilecek yaz"): otomasyonun KAPATTIGI her URUN (JVM degil) fark kalmasa da kontrol nedenidir.
  // Yalniz son goruntude gercekten kapali olanlar; hala calisan zaten KALAN'dir (sorunlu).
  const sk = sonKume(r?.son_goruntu, onceVar ? onceKume(cev.satirlar).urun : new Set());
  const kapatilan = new Set(
    sonucSatirlari(r)
      .filter((x) => x.islem === 'durdur' && !x.ad && x.sonuc === 'OK')
      .map((x) => x.urun),
  );
  const kapali = URUNLER.filter((u) => kapatilan.has(u) && !sk.urun.has(u));
  if (kapali.length)
    neden.push(
      `${kapali.map((u) => URUN_ADI[u]).join(', ')} reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu${KAPATTI_EKI}`,
    );
  return { onceBos, neden };
}

/** Tum kontrol nedenleri (once-bos ilk sirada; eski cagiranlar ve testler icin). */
function kontrolNedenleri(once, r) {
  const a = kontrolNedenAyrimi(once, r);
  return a.onceBos ? [ONCE_BOS_NEDEN, ...a.neden] : a.neden;
}

/**
 * OTOMASYON OZETI (v3 B4, kullanici: "otomasyon basarili ve basarisizi net ayirmiyor, dokunmayi da ayirmiyor; sunucuda
 * hangi teknolojiyi calistirdin calistirmadin belirt"). Ekran ve rapor AYNI tanimi buradan alir (saf). Siniflar karsilikli
 * dislayicidir:
 *   dokunmadi : hic komut kosmadi (SONUC OK/FAIL yok; SKIP komut sayilmaz);
 *   basarisiz : en az bir komut kostu VE (bir komut FAIL ya da dokunulan oge son kontrolde hedefte degil / olculemedi);
 *   basarili  : en az bir komut kostu, hepsi OK ve dokunulan her oge son kontrolde hedefte.
 * Hedef: baslat -> son goruntude calisiyor; urun durdur -> ne URUN ne JVM'i; JVM durdur -> yok (sonKume / onceNesilCevir).
 * teknoloji: izlenen 7 urunden once/ilk/son/islemlerde gorulen her biri: { urun, ad, calistirildi, ozet, sonuc }.
 */
const OTOMASYON_BILINMIYOR = 'sunucudan sonuç gelmedi — otomasyonun ne yaptığı bilinmiyor (doğrulanamadı)';
/**
 * Hedef-durum baglami (otomasyonOzeti, komutSayaci ve yoneticiOzeti'nin TEK kaynagi): once/ilk/son kumeleri ve bir SONUC
 * satirinin son kontrolde hedefte olup olmadigi. Hedef: baslat -> son goruntude calisiyor; urun durdur -> ne URUN ne JVM'i;
 * JVM durdur -> yok. Son goruntu olculemediyse hicbir komut hedefte sayilmaz.
 */
function hedefBaglami(once, r) {
  const isl = sonucSatirlari(r);
  const olculdu = !!r?.son_olculdu;
  const onceVar = Array.isArray(once) && bootVar(once);
  const cev = onceVar
    ? onceNesilCevir(once, olculdu ? r?.son_goruntu : r?.goruntu)
    : { satirlar: [], belirsiz: [] };
  const kapi = onceVar ? kapatmaKapisi(once) : '';
  const o = onceKume(cev.satirlar);
  const ilk = sonKume(r?.goruntu, o.urun);
  const s = olculdu ? sonKume(r?.son_goruntu, o.urun) : null;
  const urunJvmVar = (g, u) => [...g.jvm].some((k) => k.startsWith(`${u}|`));
  const hedefte = (x) => {
    if (!s) return false;
    const k = `${x.urun}|${x.ad}`;
    if (!URUN_ADI[x.urun]) return true;
    if (x.islem === 'baslat') return x.ad ? s.jvm.has(k) : s.urun.has(x.urun);
    if (x.islem === 'durdur') return x.ad ? !s.jvm.has(k) : !s.urun.has(x.urun) && !urunJvmVar(s, x.urun);
    return true;
  };
  return { isl, onceVar, cev, kapi, o, ilk, s, hedefte };
}

/**
 * KOMUT SAYACI (v4 B, kullanici: "Otomasyon Basarili sayilari ile Otomatik Duzeltme sayilari eslesmiyor"): Otomatik Duzeltme
 * KOMUT (SONUC satiri) sayar, Otomasyon Ozeti SUNUCU. Kopru sayisi okHedefteDegil: komutu OK donup son kontrolde hedefte olmayan
 * satir - sunucuyu 'otomasyon basarisiz' yapar. hedefBaglami ile otomasyonOzeti ayni kurali kullanir.
 * Inceleme Y3: son goruntu alinamadiysa OK komut "hedefte degil" DEGIL, okOlculemedi (dogrulanamadi; yine basarili sayilmaz).
 * -> { ok, fail, skip, okHedefteDegil, okOlculemedi }
 */
function komutSayaci(once, r) {
  const b = hedefBaglami(once, r);
  const c = { ok: 0, fail: 0, skip: 0, okHedefteDegil: 0, okOlculemedi: 0 };
  for (const x of b.isl) {
    if (x.sonuc === 'OK') {
      c.ok += 1;
      if (!b.s) c.okOlculemedi += 1;
      else if (!b.hedefte(x)) c.okHedefteDegil += 1;
    } else if (x.sonuc === 'FAIL') c.fail += 1;
    else if (x.sonuc === 'SKIP') c.skip += 1;
  }
  return c;
}

/**
 * Kayit geneli komut koprusu: komutSayaci toplami + komutu olan sunucu sayisi; basarili = OK ve son kontrolde hedefte
 * (olculemeyen OK komut basarili sayilmaz, okOlculemedi'de ayrica yazilir).
 */
function komutKoprusu(sunucular, hedefler, onceSat = null) {
  const t = { ok: 0, fail: 0, skip: 0, okHedefteDegil: 0, okOlculemedi: 0, sunucu: 0 };
  for (const h of hedefler) {
    const r = sunucular?.[h];
    if (!r) continue;
    const c = komutSayaci(onceSat?.[h], r);
    for (const k of ['ok', 'fail', 'skip', 'okHedefteDegil', 'okOlculemedi']) t[k] += c[k];
    if (c.ok + c.fail + c.skip) t.sunucu += 1;
  }
  return { ...t, komut: t.ok + t.fail + t.skip, basarili: t.ok - t.okHedefteDegil - t.okOlculemedi };
}

function otomasyonOzeti(once, r) {
  const { isl, cev, kapi, o, ilk, s, hedefte } = hedefBaglami(once, r);
  const komut = isl.filter((x) => x.sonuc === 'OK' || x.sonuc === 'FAIL');
  // Inceleme F4: BOOT'suz once (betik plani HATA yazar) ya da plan HATA -> hicbir islem yapilmadi; nedeni bu.
  const planHata = dizi(r?.plan).some((l) => l.startsWith('BILGI|HATA|'));
  const onceBootsuz = Array.isArray(once) && !bootVar(once);
  const basarili = (x) => x.sonuc === 'OK' && hedefte(x);
  let sinif = 'dokunmadi';
  if (komut.length) sinif = komut.every(basarili) ? 'basarili' : 'basarisiz';

  const gorulen = new Set(isl.map((x) => x.urun));
  for (const g of [o, ilk, ...(s ? [s] : [])]) {
    for (const u of g.urun) gorulen.add(u);
    for (const k of g.jvm) gorulen.add(k.split('|')[0]);
  }
  const deneme = (mesaj) => {
    const m = /\((\d+)\. denemede/.exec(mesaj);
    return m && Number(m[1]) >= 2 ? ` (${m[1]}. denemede)` : '';
  };
  const fark = (g, u) =>
    o.urun.has(u) !== g.urun.has(u) ||
    [...o.jvm, ...g.jvm].some((k) => k.startsWith(`${u}|`) && o.jvm.has(k) !== g.jvm.has(k));
  const etki = betikEtkisi(once, r);
  const calismayanNeden = (u) => {
    if (onceBootsuz) return 'önce görüntüsü eski biçimde / BOOT yok — işlem yapılmadı';
    if (planHata) return 'plan hata verdi — işlem yapılmadı';
    if (!s) return 'son durum ölçülemedi';
    if (!fark(s, u)) {
      if (isl.some((x) => x.urun === u && x.sonuc === 'SKIP')) return 'zaten doğru durumdaydı (komut gerekmedi)';
      return fark(ilk, u) ? 'kendiliğinden düzeldi (komut gerekmedi)' : 'değişiklik yok';
    }
    if (cev.belirsiz.includes(u) || (kapi === 'eski' && kapiKorur(kapi, u))) return 'eski sürüm önce — JBoss dokunulmadı';
    // v4: bos once hicbir urunu korumaz; 'bootsuz' yukarida, 'eski' bir ustte - baska koruyan kapi yok.
    // Inceleme F5: betik SKIP yazdiysa (ornegin "zaten baslatiliyordu") nedeni gorunur; "komut calismadi" eksik kalirdi.
    const skip = isl.find((x) => x.urun === u && x.sonuc === 'SKIP');
    if (skip) return `komut koşulmadı (betik: ${skip.mesaj || 'gerek görülmedi'}) — fark kaldı`;
    // 2026-11-16: yalniz eski betigin gercekten islemedigi urunde (betikEtkisi.kapatmaz) "betik eski" denir.
    return etki.kapatmaz(u) ? "AWX'teki betik eski — işlem yapılmadı" : 'komut çalışmadı — fark kaldı';
  };
  // Inceleme F2: komut OK dondu ama son goruntu alinamadi -> "acilamadi" denmez; dogrulanamadi (yine hata sinifi).
  const durumu = (x) => (x.sonuc === 'OK' && !s ? 'olcmedi' : basarili(x) ? 'ok' : 'hata');
  const METIN = {
    baslat: { ok: 'açıldı ✓', olcmedi: 'açma komutu OK — son durum ölçülemedi ✗', hata: 'açılamadı ✗' },
    durdur: { ok: 'kapatıldı ✓', olcmedi: 'kapatma komutu OK — son durum ölçülemedi ✗', hata: 'kapatılamadı ✗' },
  };
  const teknoloji = URUNLER.filter((u) => gorulen.has(u)).map((u) => {
    const kx = komut.filter((x) => x.urun === u);
    if (!kx.length) return { urun: u, ad: URUN_ADI[u], calistirildi: false, ozet: calismayanNeden(u), sonuc: 'yok' };
    const parca = [];
    for (const x of kx.filter((y) => !y.ad)) {
      const d = durumu(x);
      const m = (METIN[x.islem] || METIN.durdur)[d];
      parca.push(x.islem === 'baslat' && d === 'ok' ? `${m}${deneme(x.mesaj)}` : m);
    }
    const jv = kx.filter((y) => y.ad);
    for (const islem of ['baslat', 'durdur'])
      for (const d of ['ok', 'olcmedi', 'hata']) {
        const n = jv.filter((y) => y.islem === islem && durumu(y) === d).length;
        if (n) parca.push(`${n} JVM ${METIN[islem][d]}`);
      }
    return {
      urun: u,
      ad: URUN_ADI[u],
      calistirildi: true,
      ozet: parca.join(', '),
      sonuc: kx.every(basarili) ? 'ok' : 'hata',
    };
  });
  return { sinif, teknoloji };
}

/**
 * "sonra" sonucundan sunucu basina degerlendirme (saf; test edilir). onceSat: { SUNUCU: [once satirlari] }
 * (rc_once ile ayni bicim); verilmezse once-bos kontrolu yalniz plandaki BILGI|BOS satirina bakar ve Portal'in
 * kendi kalan hesabi yapilmaz. Kalan = betigin son_fark'i ile Portal'in kalan'inin BUYUGU (eski kayit yeni
 * kuralla). Nedenler fark kalsa da yazilir (ekran gosterir); durum yalniz fark yoksa 'kontrol' olur.
 */
function sonraDegerlendir(sunucular, hedefler, onceSat = null) {
  const out = {};
  for (const h of hedefler) {
    const r = sunucular?.[h];
    if (!r || r.sonuc_yok || r.ulasilamadi) {
      out[h] = {
        durum: 'olculemedi',
        sebep: 'sunucudan sonuc gelmedi (ulasilamadi ya da kopya dogrulanamadi)',
        // Inceleme F3: sonuc gelmeyen sunucuda komut kosmus olabilir (rc_sonuc yalniz son adimda yazilir); "dokunmadi"
        // yanlis guvence olurdu. Dogrulanamayan otomasyon basarisiz sayilir, nedeni yazilir.
        otomasyon: { sinif: 'basarisiz', teknoloji: [], not: OTOMASYON_BILINMIYOR },
      };
      continue;
    }
    const once = onceSat?.[h];
    const otomasyon = otomasyonOzeti(once, r);
    if (!r.once_var) {
      out[h] = { durum: 'olculemedi', sebep: 'bu sunucunun "once" goruntusu yok', otomasyon };
      continue;
    }
    const islemler = dizi(r.islemler).filter((l) => l.startsWith('SONUC|'));
    const hatali = islemler.filter((l) => l.split('|')[4] === 'FAIL').length;
    const kalanBetik = dizi(r.son_fark).filter((l) => l.startsWith('FARK|'));
    if (!r.son_olculdu) {
      out[h] = {
        durum: 'olculemedi',
        sebep: 'son goruntu alinamadi',
        islem: islemler.length,
        hatali,
        otomasyon,
      };
      continue;
    }
    const kalanPortal =
      Array.isArray(once) && bootVar(once) ? portalKalan(once, r.son_goruntu) : [];
    const kalan = Math.max(kalanBetik.length, kalanPortal.length);
    // v4: once-bos YALNIZ tek neden ise 'kapsam_disi' (notr); baska bir neden varsa o kazanir ('kontrol') ve once-bos
    // metni bilgi notu olarak eslik eder. Once-bos sunucuda reboot da dogrulanamadiysa hicbir sey dogrulanmamistir -> kontrol.
    const ayrim = kontrolNedenAyrimi(once, r);
    const neden = [
      ...ayrim.neden,
      ...(ayrim.onceBos && !ayrim.neden.length && rebootDogrulanamadi(once, r) ? [REBOOT_DOGRULANAMADI] : []),
    ];
    const bilgi = ayrim.onceBos ? [ONCE_BOS_NEDEN] : [];
    let durum = 'sorunsuz';
    if (kalan) durum = 'sorunlu';
    else if (neden.length) durum = 'kontrol';
    else if (ayrim.onceBos) durum = 'kapsam_disi';
    out[h] = {
      durum,
      kalan,
      islem: islemler.length,
      hatali,
      ...(neden.length ? { neden } : {}),
      ...(bilgi.length ? { bilgi } : {}),
      ...(durum === 'kontrol' ? { sebep: [...neden, ...bilgi].join(' ') } : {}),
      ...(durum === 'kapsam_disi' ? { sebep: KAPSAM_DISI_ACIKLAMA } : {}),
      ...(r.durulma ? { durulma: String(r.durulma) } : {}),
      otomasyon,
    };
  }
  return out;
}

/**
 * Sunucu degerlendirmelerinden kayit durumu (saf): sorunsuz + kapsam_disi (en az bir sorunsuz) -> tamam; TUMU kapsam_disi
 * -> kontrol (hicbir sey dogrulanmadi); sorunsuz / kapsam_disi + kontrol -> kontrol; aksi sorunlu / sonra_hata.
 */
function kayitDurumu(d, sonucVar) {
  const say = (s) => d.filter((x) => x.durum === s).length;
  const sorunsuz = say('sorunsuz');
  const kapsamDisi = say('kapsam_disi');
  const kontrol = say('kontrol');
  if (d.length && sorunsuz > 0 && sorunsuz + kapsamDisi === d.length) return 'tamam';
  if (d.length && sorunsuz + kapsamDisi + kontrol === d.length) return 'kontrol';
  return sonucVar ? 'sorunlu' : 'sonra_hata';
}

/**
 * Turkce yuzde: payda 0 -> '—'; bir ondalik, virgul (%92,6); tam sayida ondalik yazilmaz (%100). Inceleme Y8: yuvarlama
 * tam olmayan sonucu %100 ya da sifir olmayani %0 gostermez (1999/2000 -> %99,9; 1/5000 -> %0,1).
 */
function yuzdeMetni(pay, payda) {
  if (!payda) return '—';
  let v = Math.round((pay * 1000) / payda) / 10;
  if (v >= 100 && pay < payda) v = 99.9;
  if (v <= 0 && pay > 0) v = 0.1;
  return `%${String(v).replace('.', ',')}`;
}
const oran = (pay, payda) => ({ pay, payda, metin: yuzdeMetni(pay, payda) });

/**
 * Oge (urun + JVM) sayaci - yalniz olculen VE once dolu sunucu (saf). Hedef kumesi: once calisan her oge (calismali) + ilk
 * ya da son goruntude gorulen, once calismayan her urun ve once calisan urunun yeni JVM'i (kapali olmali; portalKalan ile ayni
 * oge kimligi, sonKume / onceNesilCevir). dogru = son kontrolde hedef durumda. Ilk sapan oge: otomatik (o ogeye hedef yonunde
 * komut OK) / kendiliginden (komutsuz, SKIP ya da FAIL donup yine de duzelen) / hala sapan.
 * Inceleme Y2: reboot_duzelt.sh once URUNU acar, auto-start JVM'ler onunla kalkar ve JVM icin komut yazilmaz (ya da SKIP
 * "auto-start ile kalkmis"): kendi komutu FAIL olmayan JVM'in urunune baslat OK donduyse JVM "otomatik (urunle birlikte)".
 * Inceleme Y9: kapatma kapisinin korudugu (eski surum once'nin JBoss urunu / nesli belirsiz JBoss 7) once calismayan urun
 * hedef kumesine girmez; 'korunan' (dokunulmadi, kontrol nedeni) olarak ayrica sayilir.
 */
function ogeSayaci(once, r) {
  const cev = onceNesilCevir(once, r?.son_goruntu);
  const kapi = kapatmaKapisi(once);
  const o = onceKume(cev.satirlar);
  const ilk = sonKume(r?.goruntu, o.urun);
  const s = sonKume(r?.son_goruntu, o.urun);
  const isl = sonucSatirlari(r);
  const oge = new Map();
  const korunan = new Set();
  const ekle = (u, ad, calismali) => {
    const k = `${u}|${ad}`;
    if (!oge.has(k)) oge.set(k, { u, ad, calismali });
  };
  for (const u of o.urun) ekle(u, '', true);
  for (const k of o.jvm) ekle(...k.split('|'), true);
  for (const g of [ilk, s]) {
    for (const u of g.urun) {
      if (o.urun.has(u)) continue;
      if (kapiKorur(kapi, u) || cev.belirsiz.includes(u)) korunan.add(u);
      else ekle(u, '', false);
    }
    for (const k of g.jvm) if (!o.jvm.has(k) && o.urun.has(k.split('|')[0])) ekle(...k.split('|'), false);
  }
  const komutu = (u, ad, islem) => isl.find((y) => y.urun === u && y.ad === ad && y.islem === islem);
  const c = { once: 0, hedef: 0, dogru: 0, ilkSapan: 0, ilkDown: 0, ilkNew: 0, otomatik: 0, kendiliginden: 0, halaSapan: 0, korunan: [...korunan].filter((u) => s.urun.has(u)).length };
  for (const x of oge.values()) {
    const var_ = (g) => (x.ad ? g.jvm.has(`${x.u}|${x.ad}`) : g.urun.has(x.u));
    const ilkV = var_(ilk);
    const sonDogru = var_(s) === x.calismali;
    c.hedef += 1;
    if (x.calismali) c.once += 1;
    if (sonDogru) c.dogru += 1;
    if (ilkV === x.calismali) continue;
    c.ilkSapan += 1;
    if (x.calismali) c.ilkDown += 1;
    else c.ilkNew += 1;
    const islem = x.calismali ? 'baslat' : 'durdur';
    const kendi = komutu(x.u, x.ad, islem);
    const urunleBirlikte = !!x.ad && x.calismali && kendi?.sonuc !== 'FAIL' && komutu(x.u, '', 'baslat')?.sonuc === 'OK';
    const komutOk = kendi?.sonuc === 'OK' || urunleBirlikte;
    if (!sonDogru) c.halaSapan += 1;
    else if (komutOk) c.otomatik += 1;
    else c.kendiliginden += 1;
  }
  return c;
}

/**
 * YONETICI OZETI (v4 C, kullanici: "%'sel olarak isin oncesi/sonrasi ne kadar karsilandi; otomasyonun basari orani; bulundugu
 * gibi birakabildik mi; executive summary gibi"). Saf, TEK kaynak: rapor bunu cizer, API ozet.sonra.yonetici olarak ekrana verir.
 * sunucular/hedefler/onceSat sonraDegerlendir ile ayni; deg verilmezse hesaplanir. Her oran { pay, payda, metin }.
 * hedefler KAYDIN TUM sunuculari olmali (inceleme Y4: ekran ve rapor ayni kumeyi sayar); once goruntusu alinamayan sunucu
 * (onceSat'ta yok, degerlendirmesi yok / olculemedi) 'onceYok' kapsam kalemidir, olculemeyen sayilmaz.
 * Kapsamlar (inceleme Y1/Y3): sunucu orani ve oge sayaci yalniz karsilastirilabilir (olculen + once dolu) sunucular; otomasyon
 * orani son durumu OLCULEN tum sunucularin komutlari (karsilastirma disi dahil - web urunu kapatma da otomasyondur);
 * olculemeyen sunucudaki komut "dogrulanamadi" diye ayrica yazilir. komut = tum kayit (Otomatik Duzeltme tablosuyla ayni);
 * komutOlculen = otomasyon oraninin kumesi. Komut basari orani (donus kodu) tum komutlardan.
 */
function yoneticiOzeti(sunucular, hedefler, onceSat = null, deg = null) {
  const d = deg || sonraDegerlendir(sunucular, hedefler, onceSat);
  const sn = {
    toplam: hedefler.length, olculen: 0, olculemeyen: 0, onceYok: 0,
    onceBos: 0, onceBosDiger: 0, onceBosKontrol: 0, onceBosSorunlu: 0,
    karsilastirilabilir: 0, sorunsuz: 0, kontrol: 0, sorunlu: 0, birakilan: 0, birakilanKontrolNotlu: 0,
  };
  const oge = { once: 0, hedef: 0, dogru: 0, ilkSapan: 0, ilkDown: 0, ilkNew: 0, otomatik: 0, kendiliginden: 0, halaSapan: 0, korunan: 0 };
  const olculenler = [];
  for (const h of hedefler) {
    const x = d[h];
    const olculmedi = !x || x.durum === 'olculemedi';
    if (olculmedi && onceSat && !onceSat[h]) {
      sn.onceYok += 1;
      continue;
    }
    if (olculmedi) {
      sn.olculemeyen += 1;
      continue;
    }
    sn.olculen += 1;
    olculenler.push(h);
    const once = onceSat?.[h];
    const r = sunucular?.[h];
    if (kontrolNedenAyrimi(once, r).onceBos) {
      sn.onceBos += 1;
      if (x.durum === 'kontrol') sn.onceBosKontrol += 1;
      else if (x.durum === 'sorunlu') sn.onceBosSorunlu += 1;
      continue;
    }
    // Inceleme B4: BOOT'lu once'si olmayan sunucu (onceSat verilmis ama bu sunucu icin kullanilabilir once yok) karsilastirilamaz;
    // 'onceYok' kapsam kalemidir. Boylece birakilan + kontrolBekleyen + sorunlu == karsilastirilabilir esitligi her zaman tutar.
    // Sayim bolumlemesi (toplam = olculen + olculemeyen + onceYok) korunur: olculen'den dusulur; komutlari ise son goruntu
    // olculdugu icin otomasyon oranina girer (olculenler).
    if (!(Array.isArray(once) && bootVar(once))) {
      sn.olculen -= 1;
      sn.onceYok += 1;
      continue;
    }
    sn.karsilastirilabilir += 1;
    if (x.durum === 'sorunsuz') sn.sorunsuz += 1;
    else if (x.durum === 'kontrol') sn.kontrol += 1;
    else sn.sorunlu += 1;
    const c = ogeSayaci(once, r);
    for (const k of Object.keys(oge)) oge[k] += c[k];
    // Inceleme Y7 (birakildi tanimi): son durum olculdu (karsilastirilabilir) VE kalan fark 0 VE kapatma kapisinin korudugu
    // calisan oge yok -> sunucu reboot oncesi haliyle birakildi. Otomasyonun fazladan calisan urunu KAPATIP fark kalmayan
    // sunucu ('kontrol' notlu) da birakilandir; yalniz 'sorunsuz' sayilsaydi basarisiz gibi gorunurdu (yoneticiye yaniltici).
    // Inceleme B2: 'kontrol' sunucu yalniz TUM kontrol nedenleri "otomasyon KAPATTI" ise birakilandir; betik eski / ESKI /
    // BELIRSIZ gibi baska bir nedeni olan sunucuda yapilacak is vardir -> kontrol bekleyen kalir.
    const yalnizKapatti = x.durum === 'kontrol' && dizi(x.neden).length > 0 && dizi(x.neden).every((n) => KAPATTI_NEDENI.test(n));
    if (!x.kalan && c.korunan === 0 && (x.durum === 'sorunsuz' || yalnizKapatti)) {
      sn.birakilan += 1;
      if (yalnizKapatti) sn.birakilanKontrolNotlu += 1;
    }
  }
  sn.onceBosDiger = sn.onceBosKontrol + sn.onceBosSorunlu;
  sn.kontrolBekleyen = sn.kontrol - sn.birakilanKontrolNotlu;
  const kontrolBekleyen = sn.kontrolBekleyen;
  const komut = komutKoprusu(sunucular, hedefler, onceSat);
  const komutOlculen = komutKoprusu(sunucular, olculenler, onceSat);
  const mudahale = komutOlculen.ok + komutOlculen.fail;
  const dogrulanamayan = komut.ok + komut.fail - mudahale;
  const o = {
    birakildi: oran(sn.birakilan, sn.karsilastirilabilir),
    donus: oran(oge.dogru, oge.hedef),
    otomasyon: oran(komutOlculen.basarili, mudahale),
    komut: oran(komut.ok, komut.ok + komut.fail),
    kapanan: oran(oge.otomatik + oge.kendiliginden, oge.ilkSapan),
  };
  const p = [];
  const kapsamEk = [
    ...(sn.olculemeyen ? [`${sn.olculemeyen} sunucu ölçülemedi`] : []),
    ...(sn.onceYok ? [`${sn.onceYok} sunucunun reboot öncesi görüntüsü alınamadığı için karşılaştırma yapılmadı`] : []),
  ];
  p.push(`Kayıttaki ${sn.toplam} sunucunun ${sn.olculen} tanesinde reboot sonrası son durum ölçüldü${kapsamEk.length ? `, ${kapsamEk.join(', ')}` : ''}.`);
  if (sn.onceBos) {
    const ek = [
      ...(sn.onceBosKontrol ? [`${sn.onceBosKontrol} tanesi kontrol bekliyor`] : []),
      ...(sn.onceBosSorunlu ? [`${sn.onceBosSorunlu} tanesinde sorun kaldı`] : []),
    ];
    p.push(
      `${sn.onceBos} sunucu reboot öncesi izlenen uygulama çalıştırmadığı için karşılaştırma dışı kaldı${ek.length ? ` (bunlardan ${ek.join(', ')})` : ''}.`,
    );
  }
  if (sn.karsilastirilabilir) {
    // Y7/B2: kontrol bekleyen = kontrol notlu olup BIRAKILAN sayilmayanlar (korunan oge calisiyor, betik eski, ESKI/BELIRSIZ vb.);
    // birakilan kontrol notlu sunucunun TEK notu "otomasyon KAPATTI"dir -> cumle her zaman dogru. Esitlik:
    // birakilan + kontrolBekleyen + sorunlu == karsilastirilabilir (B4).
    const ek = [
      ...(kontrolBekleyen ? [`${kontrolBekleyen} sunucu kontrol bekliyor`] : []),
      ...(sn.sorunlu ? [`${sn.sorunlu} sunucuda sorun kaldı`] : []),
    ];
    const notlu = sn.birakilanKontrolNotlu
      ? ` (bunlardan ${sn.birakilanKontrolNotlu} tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var)`
      : '';
    p.push(
      `Karşılaştırılabilen ${sn.karsilastirilabilir} sunucudan ${sn.birakilan} tanesi reboot öncesi haliyle bırakıldı (${o.birakildi.metin})${notlu}${ek.length ? `; ${ek.join(', ')}` : ''}.`,
    );
  } else p.push('Karşılaştırılabilen (önce görüntüsü dolu ve son durumu ölçülen) sunucu yok.');
  if (oge.hedef)
    p.push(
      `Karşılaştırılabilen sunucularda öğe bazında (ürün + JVM) reboot öncesi hale dönüş ${o.donus.metin} (${oge.dogru} / ${oge.hedef}); reboot öncesi çalışan öğe sayısı ${oge.once}${oge.korunan ? `; reboot öncesi çalışmayan ${oge.korunan} öğe kapatma güvenli olmadığı için dokunulmadı (kontrol bekliyor)` : ''}.`,
    );
  if (oge.ilkSapan)
    p.push(
      `Bu sunucularda reboot sonrası ilk kontrolde ${oge.ilkSapan} öğe reboot öncesinden farklıydı (${oge.ilkDown} kapalı, ${oge.ilkNew} fazladan çalışan); ${oge.otomatik} tanesini otomasyon düzeltti, ${oge.kendiliginden} tanesi kendiliğinden düzeldi (${o.kapanan.metin} kapatıldı)${oge.halaSapan ? `, ${oge.halaSapan} öğe hâlâ farklı` : ''}.`,
    );
  else if (oge.hedef) p.push('Bu sunucularda reboot sonrası ilk kontrolde reboot öncesinden farklı öğe yoktu.');
  if (mudahale)
    p.push(
      `Otomasyon son durumu ölçülen sunucularda ${mudahale} açma/kapatma komutu çalıştırdı; ${komutOlculen.basarili} tanesinin hedefi son kontrolde doğrulandı (${o.otomasyon.metin})${dogrulanamayan ? `; ölçülemeyen sunucularda çalışan ${dogrulanamayan} komutun sonucu doğrulanamadı` : ''}.`,
    );
  else if (dogrulanamayan) p.push(`Otomasyon yalnız ölçülemeyen sunucularda ${dogrulanamayan} komut çalıştırdı; sonucu doğrulanamadı.`);
  if (komut.ok + komut.fail)
    p.push(`Komut başarı oranı (dönüş kodu) ${o.komut.metin} (${komut.ok} / ${o.komut.payda})${komut.skip ? `; ${komut.skip} öğede komuta gerek kalmadı` : ''}.`);
  else p.push(`Otomasyonun müdahalesine gerek olmadı${komut.skip ? ` (${komut.skip} öğede komut gerekmedi)` : ''}.`);
  return { sunucu: sn, oge, komut, komutOlculen, oran: o, metin: p.join(' ') };
}

/** Goruntu yeni bicimde ve alinmis mi: BOOT satiri olmayan (eski bicim / bos) goruntuyle duzeltme YAPILMAZ. */
const goruntuTamam = (r) =>
  !!(
    r &&
    r.goruntu_ok &&
    Array.isArray(r.goruntu) &&
    r.goruntu.some((l) => String(l).startsWith('BOOT|'))
  );

/** "once" sonucundan "sonra" job'inin rc_once girdisi: yalniz goruntusu ALINAN (yeni bicim) sunucular. */
function onceGirdisi(onceSunucular) {
  const rc = {};
  for (const [h, r] of Object.entries(onceSunucular || {})) {
    if (goruntuTamam(r)) rc[h] = r.goruntu;
  }
  return rc;
}

function satir(r, ayrinti) {
  const o = {
    id: r.id,
    hosts: jsonOku(r.hosts_json) || [],
    not: r.notes || '',
    durum: r.status,
    olusturan: r.created_by,
    olusturuldu: r.created_at,
    once: { jobId: r.once_job_id, serverId: r.once_server_id, at: r.once_at },
    sonra: { jobId: r.sonra_job_id, serverId: r.sonra_server_id, at: r.sonra_at },
    ozet: jsonOku(r.ozet_json),
    // CANLI (2026-10-09, kullanici: "Suruyor kelimesi isin gercekten calisip calismadigini anlamaya
    // yetmiyor"): kosan fazda AWX'in ANLIK is durumu (pending/waiting/running) ve fazin baslangici.
    // Kosarken kayda baska yazim olmadigi icin updated_at = fazin baslatildigi an.
    awxDurum: r.awx_durum || null,
    fazBasladi: /_kosuyor$/.test(String(r.status || '')) ? r.updated_at : null,
  };
  if (ayrinti) {
    o.once.sonuc = jsonOku(r.once_json);
    o.sonra.sonuc = jsonOku(r.sonra_json);
  }
  return o;
}

/** Kayit + "sonra" sonucu -> { durum, ozet } (saf). Sonuclanmis kaydi okurken de yeni kuralla yeniden hesaplar. */
function sonraOzeti(r, sonuc, job) {
  const hedefler = jsonOku(r.hosts_json) || [];
  const onceSat = onceGirdisi(jsonOku(r.once_json)?.sunucular);
  const sonraHedef = jsonOku(r.sonra_hedef_json) || hedefler;
  const deg = sonraDegerlendir(sonuc?.sunucular || {}, sonraHedef, onceSat);
  const d = Object.values(deg);
  const durum = kayitDurumu(d, !!sonuc);
  const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
  const kontrol = d.filter((x) => x.durum === 'kontrol').length;
  const kapsamDisi = d.filter((x) => x.durum === 'kapsam_disi').length;
  // Inceleme Y4: yonetici ozeti kaydin TUM sunuculariyla (rapor da hosts ile cagirir); once goruntusu alinamayan 'onceYok'.
  const yonetici = yoneticiOzeti(sonuc?.sunucular || {}, hedefler, onceSat, deg);
  const ozet = {
    ...(jsonOku(r.ozet_json) || {}),
    sonra: { sorunsuz, kontrol, kapsamDisi, toplam: d.length, job, sunucu: deg, yonetici },
  };
  return { durum, ozet };
}

// ESKI KAYIT YENI KURALLA (2026-11-14, inceleme): ekrandaki tablo ve rapor her acilista yeni kuralla hesaplanir;
// saklanmis durum (ozet_json / status) ise kaydin sonuclandigi gunun kuralindaydi -> ayni kayitta rozet "Sorunsuz",
// tablo kirmizi "hala KAPALI" diyebiliyordu. Sonuclanmis kayit ayrintisi acilirken durum yeniden hesaplanir; degistiyse
// kayda yazilir (liste rozeti de duzelir). Yalniz sonuclanmis durumlar; kosan faz ilerlet'te.
const SONUCLANMIS = new Set(['tamam', 'sorunlu', 'kontrol']);
async function yenidenDegerlendir(r) {
  if (!r || !SONUCLANMIS.has(r.status)) return r;
  const sonuc = jsonOku(r.sonra_json);
  if (!sonuc?.sunucular) return r;
  const eski = jsonOku(r.ozet_json) || {};
  const { durum, ozet } = sonraOzeti(r, sonuc, eski.sonra?.job || sonuc.job || '');
  if (durum === r.status && JSON.stringify(ozet.sonra) === JSON.stringify(eski.sonra)) return r;
  const ozetJson = JSON.stringify(ozet);
  await db().query(
    `UPDATE reboot_checks SET status = $1, ozet_json = $2 WHERE id = $3 AND status = $4`,
    [durum, ozetJson, r.id, r.status],
  );
  return { ...r, status: durum, ozet_json: ozetJson };
}

async function kayit(id) {
  const { rows } = await db().query(`SELECT * FROM reboot_checks WHERE id = $1`, [id]);
  return rows?.[0] || null;
}

/** Kosan faz bittiyse AWX sonucunu okuyup kayda yazar (okunamazsa hicbir sey yazmaz). */
async function ilerlet(r) {
  const faz = (() => {
    if (r.status === 'once_kosuyor') return 'once';
    if (r.status === 'sonra_kosuyor') return 'sonra';
    return null;
  })();
  if (!faz) return r;
  const jobId = faz === 'once' ? r.once_job_id : r.sonra_job_id;
  const serverId = faz === 'once' ? r.once_server_id : r.sonra_server_id;
  if (!jobId) return r;
  const runner = require('../ansible/runner.cjs');
  const info = await runner.getJobStatusOnServer(Number(serverId) || 0, Number(jobId));
  if (!TERMINAL.has(info.status)) return { ...r, awx_durum: String(info.status || 'bilinmiyor') };
  const { extractStatsKey } = require('../opsx/index.cjs');
  const sonuc = extractStatsKey(info.artifacts, 'reboot_check_result') || null;
  const hedefler = jsonOku(r.hosts_json) || [];
  if (faz === 'once') {
    const sunucular = sonuc?.sunucular || {};
    const alinan = hedefler.filter((h) => goruntuTamam(sunucular[h]));
    // ONCE BOS: goruntu alindi ama izlenen urun/JVM yok -> uyari (kayit yine once_hazir olabilir).
    const onceBos = alinan.filter((h) => !izlenenVar(sunucular[h].goruntu));
    const durum = alinan.length ? 'once_hazir' : 'once_hata';
    const ozet = {
      once: { alinan: alinan.length, toplam: hedefler.length, job: info.status, once_bos: onceBos },
    };
    await db().query(
      `UPDATE reboot_checks SET status = $1, once_json = $2, once_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'once_kosuyor'`,
      [
        durum,
        JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000),
        JSON.stringify(ozet),
        r.id,
      ],
    );
  } else {
    const { durum, ozet } = sonraOzeti(r, sonuc, info.status);
    await db().query(
      `UPDATE reboot_checks SET status = $1, sonra_json = $2, sonra_at = GETUTCDATE(), ozet_json = $3, updated_at = GETUTCDATE() WHERE id = $4 AND status = 'sonra_kosuyor'`,
      [
        durum,
        JSON.stringify(sonuc || { job: info.status }).slice(0, 4000000),
        JSON.stringify(ozet),
        r.id,
      ],
    );
  }
  return kayit(r.id);
}

function mount(router, { launch, HOST_RE, limit }) {
  router.get('/reboot-check', async (req, res) => {
    try {
      const { rows } = await db().query(
        `SELECT TOP 50 id, hosts_json, notes, status, created_by, created_at, once_job_id, once_server_id, once_at,
                sonra_job_id, sonra_server_id, sonra_at, ozet_json FROM reboot_checks ORDER BY id DESC`,
      );
      res.json({ ok: true, kayitlar: (rows || []).map((r) => satir(r, false)) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // DURUM RAPORU (2026-10-09): ekip arkadasinin patch-aggregate-report.py tasarimi, Portal verisiyle
  // (reboot-rapor.cjs). Yeni sekmede acilir; e-postaya yapistirilabilir (Outlook uyumlu tablo yerlesimi).
  router.get('/reboot-check/:id/rapor', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).type('text').send('Geçersiz kayıt.');
    try {
      let r = await kayit(id);
      if (!r) return res.status(404).type('text').send('Kayıt yok.');
      try {
        r = await yenidenDegerlendir(r);
      } catch (e) {
        console.warn('[RebootCheck] kayit yeniden degerlendirilemedi:', e.message);
      }
      res
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(require('./reboot-rapor.cjs').raporHtml(satir(r, true)));
    } catch (err) {
      res.status(500).type('text').send(err.message);
    }
  });

  router.get('/reboot-check/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    try {
      let r = await kayit(id);
      if (!r) return res.status(404).json({ ok: false, message: 'Kayıt yok.' });
      try {
        r = await ilerlet(r);
      } catch (e) {
        // OKUNAMADI != BASARISIZ: AWX okunamazsa kayit degismez, bir sonraki okumada tekrar denenir.
        console.warn('[RebootCheck] is durumu okunamadi:', e.message);
        r = { ...r, awx_durum: 'okunamadi' };
      }
      try {
        r = await yenidenDegerlendir(r);
      } catch (e) {
        console.warn('[RebootCheck] kayit yeniden degerlendirilemedi:', e.message);
      }
      res.json({ ok: true, kayit: satir(r, true) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // REBOOT ONCESI: secilen sunucularin anlik goruntusu alinir ve Portal'da saklanir.
  router.post('/reboot-check', async (req, res) => {
    const hosts = [
      ...new Set(
        (Array.isArray(req.body?.hosts) ? req.body.hosts : [])
          .map((h) =>
            String(h || '')
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    ];
    const enCok = limit ? await limit('reboot') : MAX_HOST;
    if (!hosts.length || hosts.length > enCok || hosts.some((h) => !HOST_RE.test(h)))
      return res.status(400).json({
        ok: false,
        message: `1-${enCok} arası geçerli sunucu adı gerekli (tek seferde en fazla ${enCok} sunucu; Admin Server Hub › Kurallar & Limitler'den artırabilir).`,
      });
    const not = String(req.body?.not || '').slice(0, 500);
    try {
      const j = await launch(
        req,
        REGISTRY_KEY,
        `Reboot kontrolü: ÖNCE ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`,
        { rc_faz: 'once', target_hosts: hosts.join(',') },
        { op: 'reboot_check_once', hosts },
      );
      const { rows } = await db().query(
        `INSERT INTO reboot_checks (hosts_json, notes, status, created_by, once_job_id, once_server_id)
         VALUES ($1, $2, 'once_kosuyor', $3, $4, $5) RETURNING id`,
        [
          JSON.stringify(hosts),
          not || null,
          req.session?.user?.username || 'unknown',
          j.jobId,
          j.awxServerId,
        ],
      );
      res.json({ ok: true, id: rows?.[0]?.id ?? null, ...j });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // REBOOT SONRASI: once goruntusuyle karsilastir + otomatik duzelt. Onay zorunlu (JVM/web baslatir
  // ve DURDURUR). Yalniz "once" goruntusu ALINAN sunucular hedeflenir.
  router.post('/reboot-check/:id/sonra', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    if (req.body?.onay !== true)
      return res
        .status(400)
        .json({
          ok: false,
          message: 'Reboot sonrası düzeltme JVM/web başlatır ve durdurur; onay gerekli.',
        });
    try {
      const r = await kayit(id);
      if (!r) return res.status(404).json({ ok: false, message: 'Kayıt yok.' });
      if (!SONRA_ACIK.includes(r.status))
        return res
          .status(409)
          .json({
            ok: false,
            message: `Kayıt bu durumda reboot sonrası kontrole uygun değil (${r.status}).`,
          });
      const once = jsonOku(r.once_json);
      const rcOnce = onceGirdisi(once?.sunucular);
      const hedef = Object.keys(rcOnce);
      if (!hedef.length)
        return res
          .status(409)
          .json({
            ok: false,
            message:
              'Hiçbir sunucunun (yeni biçimde) "önce" görüntüsü yok; reboot sonrası kontrol yapılamaz. Reboot öncesi görüntüyü yeniden alın.',
          });
      const j = await launch(
        req,
        REGISTRY_KEY,
        `Reboot kontrolü: SONRA ${hedef.length === 1 ? hedef[0] : hedef.length + ' sunucu'}`,
        { rc_faz: 'sonra', target_hosts: hedef.join(','), rc_once: rcOnce },
        { op: 'reboot_check_sonra', id, hosts: hedef },
      );
      await db().query(
        `UPDATE reboot_checks SET status = 'sonra_kosuyor', sonra_job_id = $1, sonra_server_id = $2, sonra_hedef_json = $3,
                sonra_json = NULL, updated_at = GETUTCDATE() WHERE id = $4`,
        [j.jobId, j.awxServerId, JSON.stringify(hedef), id],
      );
      const disarida = (jsonOku(r.hosts_json) || []).filter((h) => !hedef.includes(h));
      res.json({ ok: true, ...j, hedef, disarida });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = {
  mount,
  sonraDegerlendir,
  onceGirdisi,
  kontrolNedenleri,
  kontrolNedenAyrimi,
  rebootDogrulanamadi,
  kayitDurumu,
  komutSayaci,
  komutKoprusu,
  ogeSayaci,
  yoneticiOzeti,
  yuzdeMetni,
  KAPSAM_DISI_ACIKLAMA,
  portalKalan,
  kapatmaKapisi,
  kapiKorur,
  sonKume,
  nesilKarsilastirilamaz,
  onceNesilCevir,
  onceKume,
  kume,
  sonraOzeti,
  yenidenDegerlendir,
  otomasyonOzeti,
  betikSurumu,
  betikEskiMetni,
  betikEtkisi,
  betikEskiBandi,
  BETIK_SURUM_GEREKLI,
  URUNLER,
  URUN_ADI,
  SONRA_ACIK,
  REGISTRY_KEY,
};
