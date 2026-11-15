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
//   (a) "once" goruntusunde hic izlenen satir (URUN/JVM) yok: v3'ten beri betik yalniz web urunlerini (Nginx/Apache/IHS)
//       reboot oncesi haline (kapali) dondurur, CTG/JBoss/WAS'a dokunmaz - bu bir dogrulama degil, elle bakilmali;
//   (b) once calismayan bir urun ya da (urunu once calismayan) JVM simdi CALISIYOR. 2026-11-15'ten beri
//       ("nasil bulduysan oyle birak") betik once calismayan URUNU KAPATIR: hala calisan yeni urun KALAN'dir
//       (sorunlu; portalKalan FARK|NEW|URUN; URUN satiri olmayip JVM'i calisan yeni urun de - sonKume). Yalniz
//       kapatma kapisinin (kapatmaKapisi, yalniz ham once'den) korudugu oge (once BOS / BOOT'suz ya da eski surum
//       once'nin JBoss 7/8 urunu) "dokunulmadi" der ve kontrol nedenidir; urunu kapatilmasi gereken JVM'i de kontrol;
//   (c) once goruntusu eski betik surumuyle alinmis ve JBoss 7 urun satiri cevrilemedi (BILGI|BELIRSIZ) ya da
//       AWX'teki eski betik JBoss'u hic islemedi (BILGI|ESKI). 2026-11-15'ten beri JBoss satirlari cevrilir;
//   (d) v3: otomasyon reboot oncesi calismayan bir URUNU kapatti (SONUC|durdur|<urun>||OK) - "kapatip kontrol edilecek";
//   (e) v3: sonra sonucunda betik_surum yok ya da BETIK_SURUM_GEREKLI'den kucuk (AWX'teki betik eski).
// Kalan: betigin son_fark'i ile Portal'in ayni kuralla kendi hesabinin (portalKalan) buyugu.
// Kayit durumu: hic 'sorunlu' / 'olculemedi' yok ve en az bir 'kontrol' varsa 'kontrol'.
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
const BETIK_SURUM_GEREKLI = 3;
function betikSurumu(r) {
  const ham = r?.betik_surum;
  const yazili = ham !== undefined && ham !== null && String(ham).trim() !== '';
  const n = Number(ham);
  return {
    guncel: yazili && Number.isFinite(n) && n >= BETIK_SURUM_GEREKLI,
    etiket: yazili ? `sürüm ${String(ham).trim()}` : 'sürüm yok',
  };
}
const betikEskiMetni = (r) =>
  `AWX'teki reboot_check betiği eski (${betikSurumu(r).etiket}, gerekli ${BETIK_SURUM_GEREKLI}): bu koşuda ürün kapatma ve yeniden deneme YOKTU. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`;

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
// Kapatip, kontrol edilecek yaz"): 'bos' kapida web urunleri (NGINX/RHA/IHS) artik KAPATILIR; CTG/JBoss/WAS korunur.
// BOOT'suz once 'bootsuz' doner: betik plani HATA yazar, hicbir sey yapilmaz -> hepsi korunur.
// -> 'bootsuz'|'bos'|'eski'|''
function kapatmaKapisi(once) {
  if (!bootVar(once)) return 'bootsuz';
  if (!izlenenVar(once)) return 'bos';
  return !surumVar(once) && dizi(once).some((l) => JB_SATIR.test(l)) ? 'eski' : '';
}
const WEB_URUN = /^(NGINX|RHA|IHS)$/;
const kapiKorur = (kapi, u) =>
  kapi === 'bootsuz' ||
  (kapi === 'bos' && !WEB_URUN.test(u)) ||
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
function kontrolNedenleri(once, r) {
  const neden = [];
  const plan = dizi(r?.plan);
  const onceVar = Array.isArray(once) && bootVar(once);
  const onceBos = (onceVar && !izlenenVar(once)) || plan.some((l) => l.startsWith('BILGI|BOS|'));
  // v3: bos once'de web urunleri yine kapatilir; "hicbir sey acilip kapatilmadi" artik yanlis olurdu.
  if (onceBos)
    neden.push(
      'Reboot öncesi görüntüde izlenen ürün/JVM yoktu; yalnız web ürünleri (Nginx/Apache/IHS) reboot öncesi haline (kapalı) döndürülür, diğerlerine dokunulmadı (uygulamalar zaten kapalıyken mi alındı?).',
    );
  const surum = betikSurumu(r);
  if (r && !surum.guncel) neden.push(betikEskiMetni(r));
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
  //   korunan (kapatma kapisi: once BOS / eski surum once'nin JBoss urunu) -> gercekten "dokunulmadi";
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
      `Reboot öncesi çalışmayan ${korunan.length} öğe şimdi çalışıyor ve dokunulmadı (${onceVar ? 'önce görüntüsü boş ya da eski sürüm — kapatma güvenli değildi' : 'plan notuna göre'}): ${liste(korunan)} — beklenen durum mu kontrol edin.`,
    );
  // Surum biliniyor: "eski betikle degerlendirildiyse" gibi belirsiz bir cumle yazilmaz (v3, B3).
  if (kapanmali.length)
    neden.push(
      `Reboot öncesi çalışmayan ${kapanmali.length} öğe hâlâ çalışıyor; otomatik kapatılması gerekiyordu: ${liste(kapanmali)} — ${surum.guncel ? 'kapatma sonucunu kontrol edin.' : "AWX'teki betik eski olduğu için bu koşuda ürün kapatma yoktu."}`,
    );
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
      `${kapali.map((u) => URUN_ADI[u]).join(', ')} reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin.`,
    );
  return neden;
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
function otomasyonOzeti(once, r) {
  const isl = sonucSatirlari(r);
  const komut = isl.filter((x) => x.sonuc === 'OK' || x.sonuc === 'FAIL');
  const olculdu = !!r?.son_olculdu;
  const onceVar = Array.isArray(once) && bootVar(once);
  // Inceleme F4: BOOT'suz once (betik plani HATA yazar) ya da plan HATA -> hicbir islem yapilmadi; nedeni bu.
  const planHata = dizi(r?.plan).some((l) => l.startsWith('BILGI|HATA|'));
  const onceBootsuz = Array.isArray(once) && !bootVar(once);
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
  const surum = betikSurumu(r);
  const calismayanNeden = (u) => {
    if (onceBootsuz) return 'önce görüntüsü eski biçimde / BOOT yok — işlem yapılmadı';
    if (planHata) return 'plan hata verdi — işlem yapılmadı';
    if (!s) return 'son durum ölçülemedi';
    if (!fark(s, u)) {
      if (isl.some((x) => x.urun === u && x.sonuc === 'SKIP')) return 'zaten doğru durumdaydı (komut gerekmedi)';
      return fark(ilk, u) ? 'kendiliğinden düzeldi (komut gerekmedi)' : 'değişiklik yok';
    }
    if (cev.belirsiz.includes(u) || (kapi === 'eski' && kapiKorur(kapi, u))) return 'eski sürüm önce — JBoss dokunulmadı';
    if (kapiKorur(kapi, u)) return 'önce görüntüsü boş — dokunulmadı';
    // Inceleme F5: betik SKIP yazdiysa (ornegin "zaten baslatiliyordu") nedeni gorunur; "komut calismadi" eksik kalirdi.
    const skip = isl.find((x) => x.urun === u && x.sonuc === 'SKIP');
    if (skip) return `komut koşulmadı (betik: ${skip.mesaj || 'gerek görülmedi'}) — fark kaldı`;
    return surum.guncel ? 'komut çalışmadı — fark kaldı' : "AWX'teki betik eski — işlem yapılmadı";
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
    const neden = kontrolNedenleri(once, r);
    const durum = kalan ? 'sorunlu' : neden.length ? 'kontrol' : 'sorunsuz';
    out[h] = {
      durum,
      kalan,
      islem: islemler.length,
      hatali,
      ...(neden.length ? { neden } : {}),
      ...(durum === 'kontrol' ? { sebep: neden.join(' ') } : {}),
      ...(r.durulma ? { durulma: String(r.durulma) } : {}),
      otomasyon,
    };
  }
  return out;
}

/** Sunucu degerlendirmelerinden kayit durumu (saf): hepsi sorunsuz -> tamam; sorunsuz + kontrol -> kontrol. */
function kayitDurumu(d, sonucVar) {
  const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
  const kontrol = d.filter((x) => x.durum === 'kontrol').length;
  if (d.length && sorunsuz === d.length) return 'tamam';
  if (d.length && kontrol > 0 && sorunsuz + kontrol === d.length) return 'kontrol';
  return sonucVar ? 'sorunlu' : 'sonra_hata';
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
  const deg = sonraDegerlendir(
    sonuc?.sunucular || {},
    jsonOku(r.sonra_hedef_json) || hedefler,
    onceSat,
  );
  const d = Object.values(deg);
  const durum = kayitDurumu(d, !!sonuc);
  const sorunsuz = d.filter((x) => x.durum === 'sorunsuz').length;
  const kontrol = d.filter((x) => x.durum === 'kontrol').length;
  const ozet = {
    ...(jsonOku(r.ozet_json) || {}),
    sonra: { sorunsuz, kontrol, toplam: d.length, job, sunucu: deg },
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
  kayitDurumu,
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
  BETIK_SURUM_GEREKLI,
  URUNLER,
  URUN_ADI,
  SONRA_ACIK,
  REGISTRY_KEY,
};
