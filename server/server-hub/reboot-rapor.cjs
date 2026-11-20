// server/server-hub/reboot-rapor.cjs — Reboot Kontrolu "Durum Raporu" HTML'i (2026-10-09).
//
// Kullanici: "ekip arkadasimin emeklerinin de kaybolmasini istemiyorum; onun HTML raporunu Portal'da
// bir butona tiklaninca goruntulenebilir yap." Tasarim ekip arkadasinin
// patch_remediation/scripts/patch-aggregate-report.py `write_html` ciktisinin AYNISIDIR (stil, baslik,
// ozet kutulari, Bulgular / Otomatik Duzeltme tablolari, Normal Sunucular izgarasi, Durumlar notu;
// Outlook uyumlu tablo yerlesimi - e-postaya da yapistirilabilir).
//
// Veri ise artik o betigin okudugu compare.psv / summary.env / remediation.psv DEGIL (o boru hatti
// kaldirildi): Portal'da saklanan reboot_checks kaydidir (once goruntusu + sonra sonucu). Siniflar
// kullanicinin kuralina gore (2026-10-08/09):
//   * Surec SAYISI fark degildir (eski COUNT_CHANGED yok).
//   * DOWN = once calisan urun/JVM duzeltmeden SONRA da calismiyor -> Kritik
//   * Fazladan calisan JVM (once yoktu, duzeltmeye ragmen calisiyor) -> Kritik
//   * 2026-11-15 ("nasil bulduysan oyle birak"): once calismayan URUN betikce KAPATILIR. Hala calisiyorsa
//     -> Kritik (NEW_URUN_KALAN; komut FAIL / OK ama calisiyor / hic kosmadi - eski betik - ayri yazilir).
//     Kapatma kapisinin korudugu urun (BOOT'suz once, eski surum once'nin JBoss urunu; kapi yalniz ham once'den) -> Uyari
//     (NEW_URUN, dokunulmadi). Urunu once calismayan JVM'in komutu urunun SONUC|durdur satiridir ("urunle birlikte
//     kapatildi"). Durdur SKIP (kapatma aninda kapaliydi) ama son goruntude calisiyor -> "sonra yeniden kalkti" (eski betik
//     DEGIL). URUN satiri olmayip JVM'i calisan (once calismayan) urun calisiyor sayilir (reboot-check.cjs sonKume).
//   * Duzeltilen (kapaliydi acildi / fazladan JVM kapatildi) -> Bilgi
//   * v3 (2026-11-15 aksam): otomasyonun KAPATTIGI urun -> Uyari (KAPATILDI_URUN, "kontrol edilecek"); AWX'teki betik
//     eski (betik_surum yok / < 4) -> Uyari (BETIK_ESKI). v4: bos once hicbir urunu korumaz, calisan her urun kapatilir.
//     2026-11-16: BETIK_ESKI yalniz etkili sunucuda (surum < 3 her sunucu; surum 3 bos once + calisan CTG/JBoss/WAS); kayit
//     duzeyinde etkili sunucu sayisiyla tek not (betikEskiBandi).
//     Otomasyon sinifi (basarili/basarisiz/dokunmadi) ve teknoloji listesi reboot-check.cjs otomasyonOzeti'nden (tek kaynak).
//   * boot_id degismemis -> Uyari (reboot dogrulanamadi)
//   * Olculemedi (sonuc gelmedi / son goruntu alinamadi) -> Kritik ("sorunsuz" SAYILMAZ)
// DURUSTLUK (2026-11-14): "Otomatik kapatildi" YALNIZ o oge icin SONUC|durdur|...|OK varsa yazilir
// (urun icin SONUC|durdur|<urun>||OK; JVM'i ancak plan durdur dediyse ya da urunu kapatildiysa). Komut yoksa "kendiliginden kapandi".
// "Otomatik acildi" yalniz SONUC|baslat|...|OK ile; komutsuz kalkan oge "kendiliginden acildi". Komut FAIL donup
// oge yine de kalktiysa / kapandiysa ayri sinif (KOMUT_HATALI_*): "komut calistirmadi" demek yanlis olurdu.
// Yalniz SONUC satirinda gorunen oge (durulma goruntusunde gorulup kapatilan JVM) de listelenir.
// Eski surum once goruntusu (SURUM satiri yok) -> JBoss satirlari karsilastirilmaz, Uyari (ESKI_SURUM).
// Once goruntusu bos (BOOT var, izlenen satir yok) -> v4 (2026-11-16): NOTR (ONCE_BOS, 'Karsilastirma disi'; uyari sayilmaz,
// yalniz o varsa sunucu KAPSAM_DISI); v4 basa Yonetici Ozeti (yoneticiOzeti) eklendi. Once calismayan ama simdi
// calisan, kapatma kapisi geregi dokunulmayan oge -> Uyari (NEW_URUN, kontrol gerekli). Reboot oncesi urun
// kumesi betikle ayni: URUN satirlari + JVM'i gorulen urunler.
'use strict';

const { varsayilanSira } = require('../util/siralama.cjs');

// Yonetici ozeti kovalari ve bolumlu cubugun sirasi (reboot-check.cjs SEVIYE_KOVALARI ile ayni kume).
const SEVIYE_SIRA = ['mudahalesiz', 'duzeltildi', 'kontrol', 'yapilamadi', 'hatali'];
const yuzdeMetni = (pay, payda) => require('./reboot-check.cjs').yuzdeMetni(pay, payda);

const URUN_ADI = {
  NGINX: 'Nginx',
  RHA: 'Apache HTTP Server',
  IHS: 'IBM HTTP Server (IHS)',
  CTG: 'CTG',
  JBOSS7: 'JBoss 7',
  JBOSS8: 'JBoss 8',
  WAS: 'WebSphere',
};
const JVM_ADI = { JBOSS7: 'JBoss 7 JVM', JBOSS8: 'JBoss 8 JVM', WAS: 'WebSphere JVM' };

const JB_SATIR = /^(URUN|JVM)\|JBOSS[78]\|/;
function goruntu(satirlar, haricJb = false) {
  const g = { boot: null, urun: new Set(), jvm: new Set() };
  for (const l of Array.isArray(satirlar) ? satirlar : []) {
    if (haricJb && JB_SATIR.test(String(l))) continue;
    const p = String(l).split('|');
    if (p[0] === 'BOOT') g.boot = p[1] || null;
    else if (p[0] === 'URUN' && p[1]) g.urun.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) g.jvm.add(`${p[1]}|${p[2]}`);
  }
  return g;
}
/** Reboot oncesi urun kumesi (reboot_duzelt.sh once_norm ile ayni): URUN satirlari + JVM'i gorulen urunler. */
function onceGoruntu(satirlar, haricJb = false) {
  const g = goruntu(satirlar, haricJb);
  for (const k of g.jvm) g.urun.add(k.split('|')[0]);
  return g;
}
/** SONUC satirlarindan "islem|urun|ad" -> sonuc (OK/FAIL/SKIP). */
function islemSonuclari(satirlar) {
  const m = new Map();
  for (const l of Array.isArray(satirlar) ? satirlar : []) {
    const q = String(l).split('|');
    if (q[0] === 'SONUC') m.set(`${q[1]}|${q[2]}|${q[3] || ''}`, q[4]);
  }
  return m;
}
const servisAdi = (anahtar) => {
  const [u, ad] = anahtar.split('|');
  return ad ? `${JVM_ADI[u] || u} — ${ad}` : URUN_ADI[u] || u;
};

/**
 * Sunucu basina bulgular ve sonuc (saf; test edilir). etkiOnce: betikEtkisi'ne giden once (inceleme B1: sonraDegerlendir ile
 * ayni kaynak, onceGirdisi - goruntu_ok + BOOT); ARGUMAN hic verilmezse onceSat (eski cagiran / testler). Acikca undefined
 * verilirse (once goruntusu alinamamis) undefined kalir - varsayilan parametre bunu yutardi.
 */
function sunucuDegerlendir(onceSat, s, ...ek) {
  const etkiOnce = ek.length ? ek[0] : onceSat;
  const bulgu = [];
  if (!s || s.sonuc_yok)
    return {
      sonuc: 'PROBLEM',
      bulgu: [
        {
          durum: 'OLCULEMEDI',
          servis: 'Sistem kontrolü',
          aciklama: 'Sunucudan sonuç gelmedi (ulaşılamadı ya da kopya doğrulanamadı).',
          onceSonra: '—',
        },
      ],
    };
  // Eski surum once goruntusunun JBoss satirlari yeni nesil kuralina CEVRILIR (reboot-check.cjs onceNesilCevir,
  // 2026-11-15); yalniz cevrilemeyen JBoss 7 urunu 'belirsiz' (dokunulmadi, uyari).
  const {
    onceNesilCevir,
    kapatmaKapisi,
    kapiKorur,
    betikEtkisi,
    KAPSAM_DISI_ACIKLAMA,
  } = require('./reboot-check.cjs');
  // 2026-11-16: 'betik eski' sunucu bazinda ve etkiye gore (reboot-check.cjs betikEtkisi; surum 3 yalniz bos once + calisan CTG/JBoss/WAS).
  const etki = betikEtkisi(etkiOnce, s);
  const cev = onceNesilCevir(onceSat, s.son_olculdu ? s.son_goruntu : s.goruntu);
  // Kapatma kapisi (betik ve Portal kalan ile ayni, yalniz ham once): BOOT'suz once / eski surum JBoss urunu -> "dokunulmadi".
  const kapi = kapatmaKapisi(onceSat);
  const korur = (u) => kapiKorur(kapi, u);
  const o = onceGoruntu(cev.satirlar);
  // Cikarim (sonKume ile ayni): once calismayan urunun yalniz JVM'i goruluyorsa urun de calisiyor sayilir.
  const cikarim = (g) => {
    for (const k of g.jvm) if (!o.urun.has(k.split('|')[0])) g.urun.add(k.split('|')[0]);
    return g;
  };
  const ilk = cikarim(goruntu(s.goruntu));
  const son = s.son_olculdu ? cikarim(goruntu(s.son_goruntu)) : null;
  const isl = islemSonuclari(s.islemler);
  const onceHam = goruntu(onceSat);
  if (o.boot && onceHam.urun.size === 0 && onceHam.jvm.size === 0)
    bulgu.push({
      durum: 'ONCE_BOS',
      servis: 'Sistem kontrolü',
      aciklama: `${KAPSAM_DISI_ACIKLAMA} Bu bir uyarı değildir; reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür, kapatılan ürün kontrol edilecek.`,
      onceSonra: '—',
    });
  // v3 surum isareti: AWX'teki betik eskiyse ve bu sunucuda etkisi varsa (kesin; "olabilir" denmez).
  if (etki.eski)
    bulgu.push({
      durum: 'BETIK_ESKI',
      servis: 'Sistem kontrolü',
      aciklama: etki.metin,
      onceSonra: '—',
    });
  if (cev.belirsiz.length)
    bulgu.push({
      durum: 'ESKI_SURUM',
      servis: 'JBoss 7',
      aciklama:
        'Reboot öncesi görüntü eski betik sürümüyle alınmış; JBoss 7 ürün satırının nesli belirlenemedi (JBoss 8 olabilir), JBoss 7 ürününe dokunulmadı. Elle kontrol edin.',
      onceSonra: '—',
    });
  if (o.boot && ilk.boot && o.boot !== 'bilinmiyor' && o.boot === ilk.boot)
    bulgu.push({
      durum: 'REBOOT_NOT_CONFIRMED',
      servis: 'Sistem kontrolü',
      aciklama: 'Sunucunun boot kimliği değişmemiş; reboot doğrulanamadı.',
      onceSonra: '—',
    });
  if (!son)
    bulgu.push({
      durum: 'OLCULEMEDI',
      servis: 'Sistem kontrolü',
      aciklama: 'Düzeltmeden sonraki son görüntü alınamadı; sorunsuz sayılmadı.',
      onceSonra: '—',
    });
  else {
    // Anahtarlar: once / ilk / son goruntu + SONUC satirlari. Yalniz durulma goruntusunde gorunup JVM planiyla
    // kapatilan oge (ilk ve son goruntude yok) yalniz SONUC satirindan bilinir; atlanirsa yapilan islem gorunmezdi.
    const islemAnahtar = [];
    for (const l of Array.isArray(s.islemler) ? s.islemler : []) {
      const q = String(l).split('|');
      if (q[0] !== 'SONUC' || !URUN_ADI[q[2]]) continue;
      islemAnahtar.push(q[3] ? `${q[2]}|${q[3]}` : q[2]);
    }
    const anahtarlar = new Set([
      ...o.urun,
      ...ilk.urun,
      ...son.urun,
      ...[...o.jvm, ...ilk.jvm, ...son.jvm],
      ...islemAnahtar,
    ]);
    for (const k of [...anahtarlar].sort(varsayilanSira)) {
      const jvm = k.includes('|');
      const var_ = (g) => (jvm ? g.jvm.has(k) : g.urun.has(k));
      const urun = k.split('|')[0];
      const once = var_(o);
      const ilkV = var_(ilk);
      const sonV = var_(son);
      const ad = jvm ? k.split('|')[1] : '';
      // komut: OK | FAIL | SKIP | undefined (hic kosmadi)
      const komut = (islem) => isl.get(`${islem}|${urun}|${ad}`);
      if (once && sonV && ilkV) continue;
      if (once && !sonV)
        bulgu.push({
          durum: 'DOWN',
          servis: servisAdi(k),
          aciklama: 'Reboot öncesi çalışıyordu; otomatik düzeltmeye rağmen çalışmıyor.',
          onceSonra: 'çalışıyordu → çalışmıyor',
        });
      else if (once && !ilkV && sonV && komut('baslat') === 'OK')
        bulgu.push({
          durum: 'DUZELTILDI',
          servis: servisAdi(k),
          aciklama: 'Reboot sonrası kapalıydı; otomatik açıldı.',
          onceSonra: 'kapalıydı → çalışıyor',
        });
      else if (once && !ilkV && sonV && komut('baslat') === 'FAIL')
        bulgu.push({
          durum: 'KOMUT_HATALI_ACILDI',
          servis: servisAdi(k),
          aciklama:
            'Reboot sonrası kapalıydı; Portal açma komutu BAŞARISIZ döndü, son kontrolde çalışıyor.',
          onceSonra: 'kapalıydı → çalışıyor',
        });
      // Inceleme Y2 (reboot-check.cjs ogeSayaci ile ayni): betik once URUNU acar, auto-start JVM onunla kalkar (JVM komutu yok / SKIP).
      else if (once && jvm && !ilkV && sonV && isl.get(`baslat|${urun}|`) === 'OK')
        bulgu.push({
          durum: 'DUZELTILDI',
          servis: servisAdi(k),
          aciklama:
            'Reboot sonrası kapalıydı; ürünü otomatik açılınca onunla birlikte kalktı (auto-start).',
          onceSonra: 'kapalıydı → çalışıyor',
        });
      else if (once && !ilkV && sonV)
        bulgu.push({
          durum: 'KENDILIGINDEN_ACILDI',
          servis: servisAdi(k),
          aciklama:
            'Reboot sonrası ilk görüntüde kapalıydı; Portal açma komutu çalıştırmadan kalktı (auto-start).',
          onceSonra: 'kapalıydı → çalışıyor',
        });
      // Urunu reboot oncesi calismayan JVM'in kendi komutu yoktur; urun kapatma komutu (SONUC|durdur|<urun>||) onu da kapsar.
      const urunJvmi = jvm && !o.urun.has(urun);
      const durdurK = komut('durdur') ?? (urunJvmi ? isl.get(`durdur|${urun}|`) : undefined);
      const ile = urunJvmi && !komut('durdur') ? 'ürünle birlikte ' : '';
      if (!once && urunJvmi && sonV && korur(urun))
        bulgu.push({
          durum: 'NEW_URUN',
          servis: servisAdi(k),
          aciklama:
            'Ürün reboot öncesi çalışmıyordu; önce görüntüsü eski sürüm (JBoss nesli belirsiz) ya da BOOT satırı olmadığı için kapatılmadı, dokunulmadı.',
          onceSonra: 'yoktu → çalışıyor',
        });
      else if (!once && urunJvmi && sonV)
        bulgu.push({
          durum: 'NEW_URUN',
          servis: servisAdi(k),
          aciklama: `Ürün reboot öncesi çalışmıyordu; ürünle birlikte kapanması gerekirken hâlâ çalışıyor${durdurK === 'FAIL' ? ' (ürün kapatma komutu BAŞARISIZ)' : durdurK === 'SKIP' ? ' (kapatma anında ürün kapalıydı, sonra yeniden kalktı)' : durdurK ? '' : ' (ürün kapatma komutu çalışmadı)'}.`,
          onceSonra: 'yoktu → çalışıyor',
        });
      else if (!once && !jvm && sonV && korur(urun))
        bulgu.push({
          durum: 'NEW_URUN',
          servis: servisAdi(k),
          aciklama:
            'Reboot öncesi çalışmıyordu, şimdi çalışıyor; önce görüntüsü eski sürüm (JBoss nesli belirsiz) ya da BOOT satırı olmadığı için kapatılmadı, dokunulmadı.',
          onceSonra: 'yoktu → çalışıyor',
        });
      else if (!once && !jvm && sonV)
        bulgu.push({
          durum: 'NEW_URUN_KALAN',
          servis: servisAdi(k),
          aciklama: `Reboot öncesi çalışmıyordu; otomatik kapatılması gerekirken hâlâ çalışıyor — ${durdurK === 'FAIL' ? 'kapatma komutu BAŞARISIZ döndü' : durdurK === 'OK' ? 'kapatma komutu başarılı döndü ama süreç hâlâ çalışıyor' : durdurK === 'SKIP' ? 'kapatma anında zaten kapalıydı (komut gerekmedi), sonra yeniden kalktı' : !etki.kapatmaz(urun) ? 'kapatma komutu çalışmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)' : `kapatma komutu çalışmadı — AWX'teki betik eski (${etki.etiket}); güncel betikle yeniden çalıştırın`}.`,
          onceSonra: 'yoktu → çalışıyor',
        });
      else if (!once && jvm && sonV)
        bulgu.push({
          durum: 'NEW_KALAN',
          servis: servisAdi(k),
          aciklama: 'Reboot öncesi çalışmıyordu; kapatılması gerekirken hâlâ çalışıyor.',
          onceSonra: 'yoktu → çalışıyor',
        });
      // v3 B2: otomasyonun kapattigi URUN uyari sinifindadir ("kapatildi - kontrol edilecek"); JVM bilgi kalir.
      else if (!once && !sonV && durdurK === 'OK')
        bulgu.push({
          durum: jvm ? 'KAPATILDI' : 'KAPATILDI_URUN',
          servis: servisAdi(k),
          aciklama: `Reboot öncesi çalışmıyordu; reboot sonrası ${ilkV ? 'açılmıştı' : 'kalkmıştı (durulma beklemesinde görüldü)'}, ${ile}otomatik kapatıldı.${jvm ? '' : ' Beklenen durum mu kontrol edin.'}`,
          onceSonra: 'yoktu → kapatıldı',
        });
      else if (!once && !sonV && durdurK === 'FAIL')
        bulgu.push({
          durum: 'KOMUT_HATALI_KAPANDI',
          servis: servisAdi(k),
          aciklama:
            'Reboot öncesi çalışmıyordu; Portal kapatma komutu BAŞARISIZ döndü, son kontrolde çalışmıyor.',
          onceSonra: 'yoktu → kapandı',
        });
      else if (!once && (ilkV || durdurK) && !sonV)
        bulgu.push({
          durum: 'KENDILIGINDEN_KAPANDI',
          servis: servisAdi(k),
          aciklama:
            'Reboot öncesi çalışmıyordu; reboot sonrası görülmüştü, son kontrolde çalışmıyor. Portal kapatma komutu çalıştırmadı.',
          onceSonra: 'yoktu → kapandı',
        });
    }
  }
  const kritik = bulgu.some((b) =>
    ['DOWN', 'NEW_KALAN', 'NEW_URUN_KALAN', 'OLCULEMEDI'].includes(b.durum),
  );
  // v4: ONCE_BOS uyari DEGIL (notr); yalniz o varsa sunucu 'KAPSAM_DISI' sayilir, baska bilgi bulgusu varsa INFO.
  const notr = (b) => DURUM[b.durum]?.[1] === 'neutral';
  let sonuc = 'OK';
  if (kritik) sonuc = 'PROBLEM';
  else if (bulgu.some((b) => DURUM[b.durum]?.[1] === 'warning')) sonuc = 'WARNING';
  else if (bulgu.some((b) => !notr(b))) sonuc = 'INFO';
  else if (bulgu.length) sonuc = 'KAPSAM_DISI';
  // Otomasyon ozeti (2026-11-15, ekip: "otomasyon kac tanesinde calisti, kac tanesine dokunmadi"): SKIP komut sayilmaz.
  const komutlar = [...isl.values()].filter((x) => x === 'OK' || x === 'FAIL');
  return {
    sonuc,
    bulgu,
    komut: komutlar.length,
    komutHata: komutlar.filter((x) => x === 'FAIL').length,
  };
}

const DURUM = {
  DOWN: ['Çalışmıyor (DOWN)', 'problem'],
  NEW_KALAN: ['Fazladan çalışıyor (NEW)', 'problem'],
  NEW_URUN_KALAN: ['Fazladan çalışan ürün (NEW) — kapatılamadı', 'problem'],
  OLCULEMEDI: ['Ölçülemedi', 'problem'],
  REBOOT_NOT_CONFIRMED: ['Reboot doğrulanamadı', 'warning'],
  ONCE_BOS: ['Karşılaştırma dışı (önce çalışan uygulama yoktu)', 'neutral'],
  NEW_URUN: ['Yeni süreç (NEW) — kontrol gerekli', 'warning'],
  DUZELTILDI: ['Otomatik açıldı', 'info'],
  KAPATILDI: ['Otomatik kapatıldı', 'info'],
  KAPATILDI_URUN: ['Otomatik kapatıldı — kontrol edilecek', 'warning'],
  BETIK_ESKI: ['AWX betiği eski', 'warning'],
  KENDILIGINDEN_ACILDI: ['Kendiliğinden açıldı', 'info'],
  KENDILIGINDEN_KAPANDI: ['Kendiliğinden kapandı', 'info'],
  KOMUT_HATALI_ACILDI: ['Açma komutu başarısız, sonra kalktı', 'info'],
  KOMUT_HATALI_KAPANDI: ['Kapatma komutu başarısız, sonra kapandı', 'info'],
  ESKI_SURUM: ['JBoss 7 dokunulmadı (eski görüntü)', 'warning'],
};
const RENK = {
  problem: ['#fff0f0', '#a12631'],
  warning: ['#fff4df', '#805300'],
  info: ['#edf4ff', '#17549f'],
  ok: ['#eaf6ee', '#20633f'],
  neutral: ['#f1f3f6', '#475467'],
};
const SIRA = { PROBLEM: 0, WARNING: 1, INFO: 2, KAPSAM_DISI: 3, OK: 4 };
const e = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const kisaHost = (h) => String(h).split('.', 1)[0];
const pill = (css, metin) =>
  `<span class='pill ${css}' style='background:${RENK[css][0]};color:${RENK[css][1]};padding:3px 8px;font-weight:bold'>${e(metin)}</span>`;

// [id, etiket, satir sinifi] - sinif bos = tumu. v3 B4: otomasyon siniflari reboot-check.cjs otomasyonOzeti'nden (ekranla ayni).
// Inceleme F1: "Sorunsuz / Sorun kaldi / Kontrol gerekli" filtreleri SON DURUM'a (sonraDegerlendir durum -> d-*) baglidir; satirdaki
// "Son durum" pill'i, Otomasyon Ozeti kutulari ve ekran (sonDurum) ile ayni kaynak. Rapor bulgu sinifi (s-*) yalniz "Bilgi"de.
const FILTRELER = [
  ['tum', 'Tümü', ''],
  ['obasarili', 'Otomasyon başarılı', 'o-basarili'],
  ['obasarisiz', 'Otomasyon başarısız', 'o-basarisiz'],
  ['dokunmadi', 'Otomasyon dokunmadı', 'o-dokunmadi'],
  ['sorunsuz', 'Sorunsuz', 'd-sorunsuz'],
  ['kritik', 'Sorun kaldı / ölçülemedi', 'd-sorunlu'],
  ['uyari', 'Kontrol gerekli', 'd-kontrol'],
  ['kapsamdisi', 'Karşılaştırma dışı', 'd-kapsam_disi'],
  ['bilgi', 'Bilgi', 's-INFO'],
];
/** Son durum grubu (ekran sonDurum ile ayni): olculemeyen "Sorun kaldi" sayilir; v4 karsilastirma disi ayri grup. */
const sonGrup = (son) => (['sorunsuz', 'kontrol', 'kapsam_disi'].includes(son) ? son : 'sorunlu');
const OTOMASYON = {
  basarili: ['Otomasyon başarılı', 'ok'],
  basarisiz: ['Otomasyon başarısız', 'problem'],
  dokunmadi: ['Otomasyon dokunmadı', 'info'],
};
const SON_DURUM = {
  sorunsuz: ['Sorunsuz', 'ok'],
  kontrol: ['Kontrol gerekli', 'warning'],
  sorunlu: ['Sorun kaldı', 'problem'],
  olculemedi: ['Ölçülemedi', 'problem'],
  kapsam_disi: ['Karşılaştırma dışı', 'neutral'],
};
const STIL = [
  ':root{--zemin:#f3f5f9;--kart:#ffffff;--ink:#1b2330;--ikincil:#475467;--soluk:#667085;--cizgi:#e4e8ef;--vurgu:#1f5fbf}',
  "body{margin:0;background:var(--zemin);font-family:'Segoe UI',Roboto,Arial,Helvetica,sans-serif;color:var(--ink);font-size:14px;line-height:1.5}",
  '.shell{width:100%;max-width:1000px;margin:0 auto;background:transparent}',
  '.pad{padding:28px 24px 40px}',
  'h1{font-size:22px;line-height:1.25;margin:0 0 4px;letter-spacing:-0.01em}',
  'h2{font-size:17px;margin:26px 0 10px}',
  'h3{font-size:14px;margin:0 0 10px;color:var(--ink);display:flex;align-items:center;gap:8px}',
  '.muted{color:var(--soluk);font-size:12px;font-weight:normal}',
  'table{width:100%;border-collapse:collapse}',
  'th{font-weight:600;text-align:left;background:#f1f4f8;color:#344054;font-size:12px}',
  'td,th{padding:10px 11px;border-bottom:1px solid var(--cizgi);vertical-align:top}',
  '.summary td{text-align:center;padding:13px 5px;border:1px solid var(--cizgi)}',
  '.host{font-weight:600;white-space:nowrap}',
  '.minor{color:#4b5565;font-size:12px;word-break:break-word}',
  '.note{color:#576477;font-size:12px;margin-top:9px}',
  '.pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}',
  '.healthy td{padding:7px 10px;font-size:12px;border:none;color:#344054}',
  'a{color:var(--vurgu)}',
  'a:focus-visible{outline:2px solid var(--vurgu);outline-offset:2px;border-radius:4px}',
  // Baslik ve ozet
  '.ust{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px;margin-bottom:18px}',
  '.ust .meta{color:var(--soluk);font-size:12px}',
  '.ozet{display:block}',
  '.uyari-bant{margin:0 0 14px;padding:10px 14px;border-radius:10px;background:#fff4dc;color:#8a5a00;font-weight:600;font-size:13px}',
  '.hero{display:flex;flex-wrap:wrap;gap:20px 32px;align-items:center;background:var(--kart);border:1px solid var(--cizgi);border-radius:14px;padding:22px 24px;margin-bottom:14px}',
  '.hero-l{display:flex;flex-direction:column;min-width:200px}',
  '.hero-r{flex:1;min-width:260px}',
  '.hero-etiket{font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--soluk)}',
  '.hero-oran{font-size:52px;font-weight:700;line-height:1.05;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:var(--ink)}',
  '.hero-alt{font-size:13px;color:var(--ikincil);font-variant-numeric:tabular-nums}',
  '.bar{display:flex;height:14px;border-radius:999px;overflow:hidden;background:#eef1f6}',
  '.seg{display:block;height:100%}',
  '.seg:hover{filter:brightness(1.15)}',
  '.seg.bos{width:100%;background:#eef1f6}',
  '.hero-mini{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:10px;font-size:13px;color:var(--ikincil);font-variant-numeric:tabular-nums}',
  '.grup{border-collapse:separate;border-spacing:0;margin:0 0 14px}',
  '.grup>tbody>tr>td.grup-k,.grup>tr>td.grup-k{width:50%;vertical-align:top;border:none;padding:0}',
  '.grup-k{background:var(--kart)}',
  '.grup-k+.grup-k{padding-left:14px!important}',
  '.grup-k>h3{background:var(--kart);border:1px solid var(--cizgi);border-bottom:none;border-radius:14px 14px 0 0;padding:16px 18px 6px;margin:0}',
  '.grup-k>.kv{background:var(--kart);border:1px solid var(--cizgi);border-top:none;border-radius:0 0 14px 14px}',
  '.g-say{display:inline-block;min-width:22px;text-align:center;padding:1px 8px;border-radius:999px;font-size:12px;font-variant-numeric:tabular-nums}',
  '.g-ok{background:#e8f5ee;color:#1d7a46}',
  '.g-bad{background:#fdecea;color:#b42318}',
  '.kv td{border-bottom:1px solid #eef1f6;padding:12px 14px;vertical-align:middle}',
  '.kv tr:last-child td{border-bottom:none}',
  '.kv-n{width:64px;font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}',
  '.kv-alt{display:block;font-size:12px;color:var(--soluk)}',
  '.kv-dot{display:inline-block;width:8px;height:8px;border-radius:999px;margin-right:6px;vertical-align:middle}',
  '.kv-t b{display:inline;font-size:14px}',
  '.kv-y{width:72px;text-align:right}',
  '.kv-p{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}',
  '.etiket{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:999px;background:#eef1f6;color:var(--ikincil);font-size:11px}',
  'a.sayi{color:inherit;text-decoration:none;border-bottom:2px dotted currentColor}',
  'a.sayi:hover{border-bottom-style:solid}',
  '.kart{background:var(--kart);border:1px solid var(--cizgi);border-radius:14px;padding:18px 18px 8px;margin-bottom:14px}',
  '.kart-alt{margin:0 0 12px;font-size:13px;color:var(--ikincil)}',
  '.sessiz{color:var(--soluk);font-size:12px}',
  '.sayilar{color:var(--ikincil);font-size:12px;margin:8px 0;font-variant-numeric:tabular-nums}',
  '.islem td,.islem th{padding:9px 10px}',
  '.islem .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.islem tr:last-child td{border-bottom:none}',
  '.k-ok{color:#1d7a46}',
  '.k-warn{color:#8a5a00}',
  '.k-bad{color:#b42318;font-weight:600}',
  '.alt-link{margin:4px 2px 0;font-size:13px}',
  '.hukum{margin:0 0 12px;font-size:16px;line-height:1.45;color:var(--ink)}',
  '.h-bad{color:#b42318}',
  '.lejant{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px}',
  '.lj{color:var(--ikincil);text-decoration:none;display:inline-flex;align-items:center;gap:6px}',
  '.lj:hover{color:var(--ink)}',
  '.lj b{color:var(--ink);font-variant-numeric:tabular-nums}',
  '.lj-n{display:inline-block;width:10px;height:10px;border-radius:3px}',
  '.bolum{margin:22px 2px 10px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--soluk)}',
  '.yollar{border-collapse:separate;border-spacing:14px 0;margin:0 -14px 14px;width:calc(100% + 28px)}',
  '.yol{width:33.33%;vertical-align:top;background:var(--kart);border:1px solid var(--cizgi);border-top:4px solid;border-radius:14px;padding:16px 18px!important}',
  '.yol-bas{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;color:var(--ink)}',
  '.yol-ikon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;font-size:13px;font-weight:700}',
  '.yol-sayi{font-size:40px;font-weight:700;line-height:1.15;margin:12px 0 10px;font-variant-numeric:tabular-nums;letter-spacing:-0.02em}',
  '.yol-sayi a.sayi{display:inline-block;line-height:1;padding-bottom:3px}',
  '.yol-pay{font-size:12px;color:var(--soluk);margin-bottom:10px;font-variant-numeric:tabular-nums}',
  '.mini-bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:#eef1f6;margin:4px 0 10px}',
  '.mini-bar span{display:block;height:100%}',
  '.sonuc td{border-bottom:1px solid #eef1f6;padding:7px 0;font-size:13px}',
  '.sonuc tr:last-child td{border-bottom:none}',
  '.sonuc .r{text-align:right;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}',
  '.s-ikon{display:inline-block;width:16px;font-weight:700}',
  '.yol-not{margin-top:8px;font-size:12px;color:var(--soluk)}',
  '.serit{display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:12px 16px;border-radius:12px;background:#fff4dc;color:#6b4700;text-decoration:none;font-size:13px;border:1px solid #f3dc9f}',
  '.serit:hover{border-color:#8a5a00}',
  '.serit-ikon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:#8a5a00;color:#fff;font-weight:700;flex:none}',
  '.serit-ok{margin-left:auto;font-weight:600;white-space:nowrap}',
  // Ayrinti panelleri: kapali; baglantiyla (:target) acilir. Ozet panel acikken de gorunur kalir.
  '.detay{display:none;background:var(--kart);border:1px solid var(--cizgi);border-radius:14px;padding:6px 18px 16px;margin:14px 0}',
  '.detay:target{display:block;animation:ac .18s ease-out}',
  '@keyframes ac{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
  '@media (prefers-reduced-motion:reduce){.detay:target{animation:none}}',
  '.detay-bas{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px}',
  '.detay-bas h2{margin:14px 0 6px}',
  '.kapat{font-size:13px;text-decoration:none;font-weight:600}',
  '@media (max-width:640px){.yollar,.yollar>tbody,.yollar>tbody>tr,.yollar tr{display:block;width:auto;margin:0}.yol{display:block;width:auto!important;margin-bottom:12px}.yol-sayi{font-size:34px}.serit{flex-wrap:wrap}.pad{padding:16px 12px 28px!important}.hero{padding:18px;gap:14px}.hero-l,.hero-r{min-width:0;flex-basis:100%}.hero-oran{font-size:42px}.kv-n{width:48px;font-size:24px}.kv td{padding:10px}.grup,.grup>tbody,.grup>tbody>tr,.grup tr{display:block}.grup-k{display:block;width:auto!important}.grup-k+.grup-k{padding-left:0!important;margin-top:14px}td,th{padding:8px}}',
  '@media print{.detay{display:block}.kapat,.alt-link{display:none}body{background:#fff}}',
  // FILTRE (2026-11-15): yalniz CSS (radyo + :checked ~); betik yok, e-postada filtre calismaz ama tum satirlar kalir.
  '.fr{position:absolute;opacity:0;pointer-events:none}',
  '.filtre{margin:14px 0 4px;display:flex;flex-wrap:wrap;gap:6px}',
  '.filtre label{cursor:pointer;border:1px solid #d0d6e0;border-radius:14px;padding:4px 10px;font-size:12px;color:#344054;background:#fff}',
  ...FILTRELER.map(
    ([id]) =>
      `#f-${id}:checked ~ .filtre label[for=f-${id}]{background:#202938;color:#fff;border-color:#202938}`,
  ),
  ...FILTRELER.filter(([, , sinif]) => sinif).map(
    ([id, , sinif]) => `#f-${id}:checked ~ table.fl tr.r:not(.${sinif}){display:none}`,
  ),
  ...FILTRELER.filter(([, , sinif]) => sinif).map(
    ([id]) => `#f-${id}:checked ~ .fl-n{display:none}`,
  ),
].join('\n');

// YONETICI OZETI (2026-11-17 yeniden tasarim; kullanici: "Durum sayfasinin ozeti sadece yonetici ozetinden olussun ... sayilarin
// uzerine tiklarsam detaylar ortaya ciksin"; "bizim burada bilmemiz gereken sadece ve sadece sunucu seviyesinde basari orani").
// Sayilar reboot-check.cjs sunucuSeviyesi'nden (ekranla ayni tek kaynak). Ozet her zaman gorunur; her sayi bir ayrinti paneline
// baglidir (#d-...). Paneller betiksiz CSS :target ile acilir (e-posta istemcisinde betik calismaz; panel kapali kalir, ozet
// okunur). Eski "oge / komut / ilk sapma" oranlari ve uzun tanim paragrafi kaldirildi (yoneticiye anlamsizdi).
const KOVA = {
  mudahalesiz: {
    ad: 'Müdahalesiz açıldı',
    alt: 'Reboot öncesi haliyle açıldı, hiçbir işlem gerekmedi.',
    ton: 'ok',
  },
  duzeltildi: {
    ad: 'Otomasyonla eski haline getirildi',
    alt: 'Açma/kapatma işlemi yapıldı, reboot öncesi hale döndü.',
    ton: 'ok2',
  },
  kontrol: {
    ad: 'Kontrol bekliyor',
    alt: 'Fark kalmadı ama elle bakılması gereken bir not var; başarı sayılmadı.',
    ton: 'warn',
  },
  yapilamadi: {
    ad: 'Hiç işlem yapılamadı',
    alt: 'Sunucuya ulaşılamadı, sonuç alınamadı ya da işlem başlatılamadı; reboot öncesi hale döndüğü doğrulanamadı.',
    ton: 'bad2',
  },
  hatali: {
    ad: 'İşlem yapıldı, eski haline getirilemedi',
    alt: 'Açma/kapatma işlemi yapıldı ama sunucu reboot öncesi hale dönmedi.',
    ton: 'bad',
  },
};
const TON = {
  ok: ['#1d7a46', '#e8f5ee'],
  ok2: ['#13603a', '#d7efe1'],
  warn: ['#8a5a00', '#fff4dc'],
  bad2: ['#a8431b', '#fdeee6'],
  bad: ['#b42318', '#fdecea'],
  mavi: ['#1f5fbf', '#e8effb'],
};
const ISLEM_ADI = { baslat: 'açma', durdur: 'kapatma' };
const islemEtiketi = (x) =>
  `${x.jvm ? JVM_ADI[x.urun] || `${x.urun} JVM` : URUN_ADI[x.urun] || x.urun} ${ISLEM_ADI[x.islem] || x.islem}`;
const komutMetni = (y) => {
  const n = `${y.ad ? `${JVM_ADI[y.urun] || `${y.urun} JVM`} ${y.ad}` : URUN_ADI[y.urun] || y.urun} ${ISLEM_ADI[y.islem] || y.islem}`;
  if (y.sonuc === 'FAIL') return `<span class='k-bad'>${e(n)} — hata</span>`;
  if (!y.hedefte) return `<span class='k-warn'>${e(n)} — son kontrolde hedefte değil</span>`;
  return `<span class='k-ok'>${e(n)} ✓</span>`;
};
const sayiLink = (id, n, etiket) =>
  `<a class='sayi' href='#${id}' aria-label='${e(`${etiket}: ${n} — ayrıntıyı aç`)}'>${n}</a>`;

/**
 * Ozet (2026-11-17 v2, kullanici: "Dikkat gerektiren kismi soldaki 'Otomasyonla eski haline getirildi' maddesine bagli degil mi? ...
 * gorenler vay be ne kadar anlasilir ve net desin"). Ozet bir HIKAYE gibi okunur: hukum cumlesi + basari orani + dagilim cubugu;
 * sonra "Reboot sonrasi ne oldu?" uc yol: (1) mudahale gerekmedi, (2) otomasyon devreye girdi -> eski haline getirildi /
 * getirilemedi (ayni dalin iki sonucu ayni kartta), (3) otomasyon islem yapamadi (neden kirilimiyla); kontrol bekleyenler serit.
 * sev = sunucuSeviyesi; betikNotu = kayit duzeyi uyari (varsa).
 */
const YAPILAMADI_NEDEN = {
  ulasilamadi: 'Sunucuya ulaşılamadı',
  once_yok: 'Reboot öncesi görüntüsü yok',
  olculemedi: 'Son durum ölçülemedi',
  komutsuz: 'Fark kaldı, komut çalışmadı',
};
const yuzde = (pay, payda) => e(yuzdeMetni(pay, payda));
function ozetBolumu(sev, betikNotu) {
  const s = sev.sayi;
  const basarili = s.mudahalesiz + s.duzeltildi;
  const dikkat = s.kontrol + s.yapilamadi + s.hatali;
  const oto = s.duzeltildi + s.hatali;
  const bar = SEVIYE_SIRA.filter((k) => s[k])
    .map(
      (k) =>
        `<a class='seg' href='#d-${k}' title='${e(`${KOVA[k].ad}: ${s[k]} sunucu`)}' style='width:${(s[k] * 100) / (sev.toplam || 1)}%;background:${TON[KOVA[k].ton][0]}'></a>`,
    )
    .join('');
  const lejant = SEVIYE_SIRA.filter((k) => s[k])
    .map(
      (k) =>
        `<a class='lj' href='#d-${k}'><span class='lj-n' style='background:${TON[KOVA[k].ton][0]}'></span>${e(KOVA[k].ad)} <b>${s[k]}</b></a>`,
    )
    .join('');
  const hukum = !sev.toplam
    ? 'Karşılaştırma için sunucu verisi yok.'
    : dikkat
      ? `${sev.toplam} sunucunun <b>${basarili}</b> tanesi reboot sonrası reboot öncesi haliyle çalışıyor; <b class='h-bad'>${dikkat} sunucu dikkat istiyor</b>.`
      : `${sev.toplam} sunucunun <b>tamamı</b> reboot sonrası reboot öncesi haliyle çalışıyor.`;
  const bas = (ikon, ton, baslik) =>
    `<div class='yol-bas'><span class='yol-ikon' style='background:${TON[ton][1]};color:${TON[ton][0]}'>${ikon}</span>${e(baslik)}</div>`;
  const sayi = (k, n, ton) =>
    `<div class='yol-sayi' style='color:${n ? TON[ton][0] : 'var(--soluk)'}'>${n ? sayiLink(`d-${k}`, n, KOVA[k].ad) : '0'}</div>`;
  // (1) mudahale gerekmedi
  const etiketler = [];
  if (sev.etiketSay.izlenenYok)
    etiketler.push(`${sev.etiketSay.izlenenYok} sunucuda izlenen uygulama yoktu`);
  const kendiliginden = sev.kova.mudahalesiz.filter((h) => sev.sunucu[h].komutlar.length).length;
  if (kendiliginden)
    etiketler.push(`${kendiliginden} sunucuda komut hedefe ulaşmadan kendiliğinden düzeldi`);
  const yol1 = [
    "<td class='yol' style='border-top-color:#1d7a46'>",
    bas('✓', 'ok', 'Müdahale gerekmedi'),
    sayi('mudahalesiz', s.mudahalesiz, 'ok'),
    `<div class='yol-pay'>${yuzde(s.mudahalesiz, sev.toplam)} · reboot öncesi haliyle açıldı</div>`,
    etiketler.map((t) => `<span class='etiket'>${e(t)}</span>`).join(' '),
    '</td>',
  ].join('');
  // (2) otomasyon devreye girdi: iki sonuc ayni kartta
  const yol2 = [
    "<td class='yol' style='border-top-color:#1f5fbf'>",
    bas('⚙', 'mavi', 'Otomasyon devreye girdi'),
    `<div class='yol-sayi' style='color:${oto ? '#1f5fbf' : 'var(--soluk)'}'>${oto}</div>`,
    `<div class='yol-pay'>${oto ? 'sunucuda açma/kapatma yapıldı' : 'hiçbir sunucuda gerekmedi'}</div>`,
    oto
      ? [
          `<div class='mini-bar' role='img' aria-label='${e(`${s.duzeltildi} eski haline getirildi, ${s.hatali} getirilemedi`)}'><span style='width:${(s.duzeltildi * 100) / oto}%;background:#13603a'></span><span style='width:${(s.hatali * 100) / oto}%;background:#b42318'></span></div>`,
          "<table class='sonuc' cellpadding='0' cellspacing='0'>",
          `<tr><td><span class='s-ikon' style='color:#13603a'>✓</span> Eski haline getirildi</td><td class='r' style='color:#13603a'>${s.duzeltildi ? sayiLink('d-duzeltildi', s.duzeltildi, KOVA.duzeltildi.ad) : '0'}</td></tr>`,
          `<tr><td><span class='s-ikon' style='color:#b42318'>✗</span> Eski haline getirilemedi</td><td class='r' style='color:#b42318'>${s.hatali ? sayiLink('d-hatali', s.hatali, KOVA.hatali.ad) : '0'}</td></tr>`,
          '</table>',
          `<div class='yol-not'>Otomasyon başarısı ${e(sev.otomasyon.metin)}</div>`,
        ].join('')
      : '',
    '</td>',
  ].join('');
  // (3) otomasyon islem yapamadi: neden kirilimi
  const kirilim = Object.entries(YAPILAMADI_NEDEN)
    .filter(([n]) => sev.yapilamadiNeden[n])
    .map(([n, ad]) => `<tr><td>${e(ad)}</td><td class='r'>${sev.yapilamadiNeden[n]}</td></tr>`)
    .join('');
  const yol3 = [
    "<td class='yol' style='border-top-color:#a8431b'>",
    bas('!', 'bad2', 'Otomasyon işlem yapamadı'),
    sayi('yapilamadi', s.yapilamadi, 'bad2'),
    `<div class='yol-pay'>${s.yapilamadi ? `${yuzde(s.yapilamadi, sev.toplam)} · reboot öncesi hale döndüğü doğrulanamadı` : 'böyle sunucu yok'}</div>`,
    kirilim ? `<table class='sonuc' cellpadding='0' cellspacing='0'>${kirilim}</table>` : '',
    '</td>',
  ].join('');
  const serit = s.kontrol
    ? `<a class='serit' href='#d-kontrol'><span class='serit-ikon'>!</span><span><b>${s.kontrol} sunucu elle kontrol bekliyor.</b> Reboot öncesinden farkı yok ama bakılması gereken bir not var; başarı sayılmadı.</span><span class='serit-ok'>Göster →</span></a>`
    : '';
  const islem = sev.islemler.length
    ? [
        `<table class='islem' cellpadding='0' cellspacing='0'><tr><th>İşlem</th><th class='r'>Sunucu</th><th class='r'>Komut</th><th class='r'>Başarılı</th></tr>`,
        ...sev.islemler.map((x, i) => {
          const tam = x.hedefte === x.komut;
          return (
            `<tr><td>${e(islemEtiketi(x))}</td><td class='r'>${sayiLink(`d-op-${i}`, x.sunucular.length, islemEtiketi(x))}</td><td class='r'>${x.komut}</td>` +
            `<td class='r'><span class='${tam ? 'k-ok' : 'k-bad'}'>${x.hedefte} / ${x.komut}</span></td></tr>`
          );
        }),
        '</table>',
      ].join('')
    : "<p class='sessiz'>Hiçbir sunucuda açma/kapatma işlemine gerek olmadı.</p>";
  return [
    "<section id='ozet' class='ozet' aria-label='Yönetici Özeti'>",
    betikNotu ? `<p class='uyari-bant'>${e(betikNotu)}</p>` : '',
    "<div class='hero'>",
    "<div class='hero-l'><span class='hero-etiket'>Sunucu seviyesinde başarı</span>",
    `<span class='hero-oran'>${e(sev.basari.metin)}</span>`,
    `<span class='hero-alt'><b>${basarili}</b> / ${sev.toplam} sunucu reboot öncesi haliyle çalışıyor</span></div>`,
    "<div class='hero-r'>",
    `<p class='hukum'>${hukum}</p>`,
    `<div class='bar' role='img' aria-label='${e(SEVIYE_SIRA.map((k) => `${KOVA[k].ad} ${s[k]}`).join(', '))}'>${bar || "<span class='seg bos'></span>"}</div>`,
    `<div class='lejant'>${lejant}</div>`,
    '</div></div>',
    "<h3 class='bolum'>Reboot sonrası ne oldu?</h3>",
    `<table class='yollar' cellpadding='0' cellspacing='0'><tr>${yol1}${yol2}${yol3}</tr></table>`,
    serit,
    "<div class='kart'><h3>Yapılan işlemler</h3>",
    `<p class='kart-alt'>Hangi işlem kaç sunucuda yapıldı; sayılara tıklayınca sunucular açılır.</p>`,
    islem,
    '</div>',
    `<p class='alt-link'><a href='#d-tum'>Teknik ayrıntılar (tüm tablolar) →</a> · <a class='eposta-link' href='?eposta=1'>E-posta / yazdırma görünümü (tüm ayrıntılar açık)</a></p>`,
    '</section>',
  ].join('\n');
}

/** Bir kovanin ayrinti paneli: sunucu, etiket, yapilan islemler, neden. */
function kovaPaneli(sev, k) {
  const hostlar = [...sev.kova[k]].sort(varsayilanSira);
  const [fg] = TON[KOVA[k].ton];
  const satirlar = hostlar.map((h) => {
    const x = sev.sunucu[h];
    const isl = x.komutlar.length
      ? x.komutlar.map(komutMetni).join('<br>')
      : `<span class='sessiz'>${x.bilinmiyor ? 'bilinmiyor (sonuç gelmedi)' : 'işlem yok'}</span>`;
    const neden =
      [
        ...x.etiket.map((t) => `<span class='etiket'>${e(t)}</span>`),
        ...x.neden.map((n) => e(n)),
      ].join('<br>') || "<span class='sessiz'>—</span>";
    return `<tr><td class='host'>${e(kisaHost(h))}</td><td class='minor'>${isl}</td><td class='minor'>${neden}</td></tr>`;
  });
  return [
    `<section id='d-${k}' class='detay' aria-label='${e(KOVA[k].ad)}'>`,
    `<div class='detay-bas'><h2 style='color:${fg}'>${e(KOVA[k].ad)} <span class='muted'>(${hostlar.length} sunucu)</span></h2><a class='kapat' href='#ozet'>← Özete dön</a></div>`,
    `<p class='kart-alt'>${e(KOVA[k].alt)}</p>`,
    hostlar.length
      ? `<table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Yapılan işlemler</th><th>Not / neden</th></tr>${satirlar.join('')}</table>`
      : "<p class='sessiz'>Bu grupta sunucu yok.</p>",
    '</section>',
  ].join('\n');
}

/** Bir islem turunun ayrinti paneli: o islemin yapildigi sunucular, komut sonuclari ve sunucunun son durumu. */
function islemPaneli(sev, x, i) {
  const satirlar = [...x.sunucular].sort(varsayilanSira).map((h) => {
    const sv = sev.sunucu[h];
    const ilgili = sv.komutlar.filter(
      (y) => y.islem === x.islem && y.urun === x.urun && !!y.ad === x.jvm,
    );
    const [fg, bg] = TON[KOVA[sv.kova].ton];
    return (
      `<tr><td class='host'>${e(kisaHost(h))}</td><td class='minor'>${ilgili.map(komutMetni).join('<br>')}</td>` +
      `<td><span class='pill' style='color:${fg};background:${bg}'>${e(KOVA[sv.kova].ad)}</span></td></tr>`
    );
  });
  return [
    `<section id='d-op-${i}' class='detay' aria-label='${e(islemEtiketi(x))}'>`,
    `<div class='detay-bas'><h2>${e(islemEtiketi(x))} <span class='muted'>(${x.sunucular.length} sunucu · ${x.komut} komut)</span></h2><a class='kapat' href='#ozet'>← Özete dön</a></div>`,
    `<p class='kart-alt'>Başarılı = komut başarılı döndü ve son kontrolde hedef durumda: ${x.hedefte} / ${x.komut}; hata dönen komut ${x.fail}.</p>`,
    `<table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Komutlar</th><th>Sunucunun sonucu</th></tr>${satirlar.join('')}</table>`,
    '</section>',
  ].join('\n');
}

// E-posta / yazdirma gorunumu: paneller acik, gezinme baglantilari gizli.
const EPOSTA_STIL =
  '\n.detay{display:block!important;animation:none!important}\n.kapat,.alt-link,.eposta-link{display:none!important}';

const DURUMLAR_NOTU =
  "<p class='sayilar' style='border-top:1px solid #e6e9ef;padding-top:12px'>DOWN = reboot öncesi çalışıyordu, şimdi çalışmıyor · NEW = reboot öncesi yoktu, şimdi çalışıyor</p>";

/**
 * reboot_checks satiri -> tam HTML belge. opt.eposta (2026-11-17, dogrulama bulgusu): e-posta istemcisi :target panellerini
 * acamaz; e-posta / yazdirma gorunumunde TUM ayrinti panelleri acik gelir, "Ozete don" ve gorunum baglantilari gizlenir.
 */
function raporHtml(k, opt = {}) {
  const onceS = k?.once?.sonuc?.sunucular || {};
  const sonraS = k?.sonra?.sonuc?.sunucular || null;
  const hostlar = Array.isArray(k?.hosts) ? k.hosts : [];
  const p = [
    `<!doctype html><html lang='tr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Reboot Kontrolü #${e(k?.id)} — Durum Raporu</title><style>${STIL}${opt.eposta ? EPOSTA_STIL : ''}</style></head><body>`,
    "<table role='presentation' cellpadding='0' cellspacing='0' border='0' style='width:100%;background:#f5f7fa'><tr><td align='center'>",
    "<table role='presentation' class='shell' cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:960px;background:#ffffff'><tr><td class='pad' style='padding:24px 28px'>",
    '<h1>Patch Reboot | Durum Raporu</h1>',
  ];
  const ust = (faz) =>
    `<div class='muted'>${e(faz)} &nbsp;·&nbsp; Kayıt: <b>#${e(k?.id)}</b>${k?.not ? ` &nbsp;·&nbsp; ${e(k.not)}` : ''} &nbsp;·&nbsp; ${hostlar.length} sunucu &nbsp;·&nbsp; ${e(k?.olusturan || '')}</div>`;
  const kutular = (ogeler) =>
    `<table role='presentation' class='summary' cellpadding='0' cellspacing='0'><tr>${ogeler
      .map(
        ([l, v, fg, bg]) =>
          `<td style='text-align:center;border:1px solid #e6e9ef;background:${bg};padding:13px 5px'><span style='display:block;font-size:24px;font-weight:bold;color:${fg}'>${v}</span><span style='font-size:12px;color:#596579'>${e(l)}</span></td>`,
      )
      .join('')}</tr></table>`;

  if (!sonraS) {
    // Yalniz "once" kaydi var: neyin kaydedildigini gosterir.
    const alinan = hostlar.filter(
      (h) =>
        onceS[h]?.goruntu_ok &&
        (onceS[h]?.goruntu || []).some((l) => String(l).startsWith('BOOT|')),
    );
    p.push(
      ust('Reboot öncesi kayıt'),
      `<p style='font-size:15px;margin:17px 0 14px'><b>${alinan.length} / ${hostlar.length} sunucunun reboot öncesi görüntüsü kaydedildi.</b></p>`,
      kutular([
        ['Sunucu', hostlar.length, '#202938', '#f7f9fc'],
        ['Kaydedildi', alinan.length, '#20633f', '#eaf6ee'],
        ['Alınamadı', hostlar.length - alinan.length, '#a12631', '#fff0f0'],
      ]),
      "<h2>Kaydedilen ürünler</h2><table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Çalışan ürünler</th><th>JVM</th></tr>",
    );
    for (const h of hostlar) {
      const g = goruntu(onceS[h]?.goruntu);
      const ok = alinan.includes(h);
      const bos = ok && g.urun.size === 0 && g.jvm.size === 0;
      const urunMetni = bos
        ? pill('warning', 'izlenen ürün yok — uygulamalar kapalıyken mi alındı?')
        : e([...onceGoruntu(onceS[h]?.goruntu).urun].map((u) => URUN_ADI[u] || u).join(', '));
      p.push(
        `<tr><td class='host'>${e(kisaHost(h))}</td><td>${ok ? urunMetni : pill('problem', 'Görüntü alınamadı')}</td><td>${ok ? g.jvm.size : '—'}</td></tr>`,
      );
    }
    p.push('</table>');
  } else {
    // Tek kaynak (v3 B4): otomasyon sinifi + teknoloji listesi + son durum reboot-check.cjs sonraDegerlendir'den.
    const { sonraDegerlendir, onceGirdisi, yoneticiOzeti } = require('./reboot-check.cjs');
    const onceSat = onceGirdisi(onceS);
    const sd = sonraDegerlendir(sonraS, hostlar, onceSat);
    // Inceleme Y5: "Karsilastirma disi" kutusu tek kaynaga (sonraDegerlendir 'kapsam_disi') baglidir: kapsam disi sunucunun yalniz
    // bilgi bulgusu (or. kendiliginden kapanan web urunu) varsa INFO degil KAPSAM_DISI; kapsam disi OLMAYAN sunucuda yalniz notr
    // bulgu kaldiysa INFO (ayni raporda iki farkli "Karsilastirma disi" sayisi cikmaz).
    const hizala = (x, son) => {
      if (son === 'kapsam_disi' && ['INFO', 'KAPSAM_DISI', 'OK'].includes(x.sonuc))
        return { ...x, sonuc: 'KAPSAM_DISI' };
      if (son !== 'kapsam_disi' && x.sonuc === 'KAPSAM_DISI') return { ...x, sonuc: 'INFO' };
      return x;
    };
    const deg = hostlar.map((h) => {
      const son = sd[h]?.durum || 'olculemedi';
      return {
        h,
        ...hizala(sunucuDegerlendir(onceS[h]?.goruntu, sonraS[h], onceSat[h]), son),
        oto: sd[h]?.otomasyon || { sinif: 'dokunmadi', teknoloji: [] },
        son,
      };
    });
    const say = { PROBLEM: 0, WARNING: 0, INFO: 0, KAPSAM_DISI: 0, OK: 0 };
    for (const d of deg) say[d.sonuc] += 1;
    // v4 C: YONETICI OZETI raporun en ustunde (reboot-check.cjs yoneticiOzeti, ekranla ayni sayilar).
    const yon = yoneticiOzeti(sonraS, hostlar, onceSat, sd);
    const kp = yon.komut;
    // 2026-11-17: ozet YALNIZ sunucu seviyesi yonetici ozeti; ayrintilar sayilara tiklayinca (:target paneller).
    const sev = require('./reboot-check.cjs').sunucuSeviyesi(sonraS, hostlar, onceSat, sd);
    const { betikEtkisi: bE, betikEskiBandi: bB } = require('./reboot-check.cjs');
    const etkiliU = hostlar.filter(
      (h) => sonraS[h] && !sonraS[h].sonuc_yok && bE(onceSat[h], sonraS[h]).eski,
    );
    const betikNotu = etkiliU.length
      ? bB([...new Set(etkiliU.map((h) => bE(onceSat[h], sonraS[h]).etiket))], etkiliU.length)
      : '';
    p.push(
      ust('Otomatik düzeltme sonrası • Son kontrol'),
      ozetBolumu(sev, betikNotu),
      ...SEVIYE_SIRA.map((kv) => kovaPaneli(sev, kv)),
      ...sev.islemler.map((x, i) => islemPaneli(sev, x, i)),
      "<section id='d-tum' class='detay' aria-label='Teknik ayrıntılar'><div class='detay-bas'><h2>Teknik ayrıntılar</h2><a class='kapat' href='#ozet'>← Özete dön</a></div>",
    );
    let baslik = 'Tüm sunucuların karşılaştırma sonucu normal.';
    if (!deg.length) baslik = 'Karşılaştırma için sunucu verisi bulunamadı.';
    else if (say.PROBLEM) baslik = `${say.PROBLEM} sunucuda kritik durum tespit edildi.`;
    else if (say.WARNING) baslik = `Kritik sorun yok; ${say.WARNING} sunucuda uyarı var.`;
    else if (say.INFO) baslik = `Kritik sorun ve uyarı yok; ${say.INFO} sunucuda bilgi kaydı var.`;
    else if (say.KAPSAM_DISI)
      baslik = `Kritik sorun ve uyarı yok; ${say.KAPSAM_DISI} sunucu karşılaştırma dışı (reboot öncesi çalışan uygulama yoktu).`;
    // 2026-11-16: kayit duzeyi betik-eski notu yalniz etkili sunucu varsa ve SAYISIYLA (ekran bandi ile ayni metin).
    const { betikEtkisi, betikEskiBandi } = require('./reboot-check.cjs');
    // Inceleme B1: once kaynagi sonraDegerlendir ile ayni (onceSat = onceGirdisi; goruntu_ok=false ham once kullanilmaz).
    const etkili = hostlar.filter(
      (h) => sonraS[h] && !sonraS[h].sonuc_yok && betikEtkisi(onceSat[h], sonraS[h]).eski,
    );
    if (etkili.length)
      p.push(
        `<p class='betik-eski' style='margin:12px 0;padding:10px 12px;background:${RENK.warning[0]};color:${RENK.warning[1]};font-weight:bold'>${e(betikEskiBandi([...new Set(etkili.map((h) => betikEtkisi(onceSat[h], sonraS[h]).etiket))], etkili.length))}</p>`,
      );
    p.push(
      '<h2>Ayrıntı</h2>',
      `<p style='font-size:15px;margin:17px 0 14px'><b>${e(baslik)}</b></p>`,
      kutular([
        ['Sunucu', deg.length, '#202938', '#f7f9fc'],
        ['Kritik sunucu', say.PROBLEM, '#a12631', '#fff0f0'],
        ['Uyarılı sunucu', say.WARNING, '#805300', '#fff4df'],
        ['Bilgili sunucu', say.INFO, '#17549f', '#edf4ff'],
        ['Karşılaştırma dışı', say.KAPSAM_DISI, RENK.neutral[1], RENK.neutral[0]],
        ['Normal sunucu', say.OK, '#20633f', '#eaf6ee'],
      ]),
    );
    const oSay = (c) => deg.filter((d) => d.oto.sinif === c).length;
    const sSay = (...c) => deg.filter((d) => c.includes(d.son)).length;
    p.push(
      '<h2>Otomasyon Özeti</h2>',
      kutular([
        ['Otomasyon başarılı', oSay('basarili'), '#20633f', '#eaf6ee'],
        ['Otomasyon başarısız', oSay('basarisiz'), '#a12631', '#fff0f0'],
        ['Otomasyon dokunmadı', oSay('dokunmadi'), '#344054', '#f7f9fc'],
      ]),
      kutular([
        ['Sorunsuz', sSay('sorunsuz'), '#20633f', '#eaf6ee'],
        ['Kontrol gerekli', sSay('kontrol'), '#805300', '#fff4df'],
        ['Sorun kaldı', sSay('sorunlu'), '#a12631', '#fff0f0'],
        ['Ölçülemedi', sSay('olculemedi'), '#a12631', '#fff0f0'],
        ['Karşılaştırma dışı', sSay('kapsam_disi'), RENK.neutral[1], RENK.neutral[0]],
      ]),
      `<p class='sayilar'>Komut: başarılı <b>${kp.ok}</b> · başarısız <b>${kp.fail}</b> · gerek kalmadı <b>${kp.skip}</b> · başarılı ama son kontrolde hedefte değil <b>${kp.okHedefteDegil}</b> · başarılı ama doğrulanamadı <b>${kp.okOlculemedi}</b></p>`,
    );
    const sinif = (d) => `r s-${d.sonuc} o-${d.oto.sinif} d-${sonGrup(d.son)}`;
    // FILTRE: radyolar tum filtreli tablolardan ONCE ve onlarla kardes (CSS ~ secicisi).
    p.push(
      ...FILTRELER.map(
        ([id], i) =>
          `<input type='radio' name='f' id='f-${id}' class='fr'${i === 0 ? ' checked' : ''}>`,
      ),
      "<div class='filtre'>" +
        FILTRELER.map(([id, etiket]) => "<label for='f-" + id + "'>" + e(etiket) + '</label>').join(
          '',
        ) +
        '</div>',
    );
    const tekno = (o, calisan) =>
      (calisan && o.not ? `<span style='color:#a12631'>${e(o.not)}</span>` : '') ||
      o.teknoloji
        .filter((t) => t.calistirildi === calisan)
        .map((t) =>
          calisan
            ? `<span style='color:${t.sonuc === 'hata' ? '#a12631' : '#20633f'}'>${e(t.ad)}: ${e(t.ozet)}</span>`
            : `<span style='color:#596579'>${e(t.ad)} (${e(t.ozet)})</span>`,
        )
        .join('<br>') ||
      "<span class='muted'>—</span>";
    p.push(
      `<h2>Sunucu bazında otomasyon <span class='muted'>(${deg.length} sunucu)</span></h2>`,
      "<table class='fl' cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr><th>Sunucu</th><th>Otomasyon</th><th>Çalıştırılan teknolojiler</th><th>Çalıştırılmayan teknolojiler (nedeniyle)</th><th>Son durum</th></tr>",
    );
    for (const d of [...deg].sort((a, b) => a.h.localeCompare(b.h))) {
      const [oEt, oCss] = OTOMASYON[d.oto.sinif] || OTOMASYON.dokunmadi;
      const [sEt, sCss] = SON_DURUM[d.son] || SON_DURUM.olculemedi;
      p.push(
        `<tr class='${sinif(d)}'><td class='host'>${e(kisaHost(d.h))}</td><td>${pill(oCss, oEt)}</td><td class='minor'>${tekno(d.oto, true)}</td><td class='minor'>${tekno(d.oto, false)}</td><td>${pill(sCss, sEt)}</td></tr>`,
      );
    }
    p.push('</table>');
    const bulgular = deg
      .flatMap((d) => d.bulgu.map((b) => ({ ...b, h: d.h, hs: d.sonuc, d })))
      .sort((a, b) => SIRA[a.hs] - SIRA[b.hs] || a.h.localeCompare(b.h));
    const bulguluSunucu = new Set(bulgular.map((b) => b.h)).size;
    p.push(
      `<h2>Bulgular <span class='muted'>(${bulgular.length} kayıt · ${bulguluSunucu} sunucu)</span></h2>`,
    );
    if (bulgular.length) {
      p.push(
        "<table class='fl' cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr><th>Sunucu</th><th>Servis / JVM</th><th>Durum</th><th>Önce → Sonra</th></tr>",
      );
      for (const b of bulgular) {
        // Inceleme Y11: kapsam disi OLMAYAN (or. kontrol gerekli) sunucuda once-bos bulgusu "Karsilastirma disi" denmez.
        const [etiket, css] =
          b.durum === 'ONCE_BOS' && b.d.son !== 'kapsam_disi'
            ? ['Önce görüntüsü boş (bilgi)', 'neutral']
            : DURUM[b.durum] || [b.durum, 'info'];
        p.push(
          `<tr class='${sinif(b.d)}'><td class='host'>${e(kisaHost(b.h))}</td><td>${e(b.servis)}</td><td>${pill(css, etiket)}<div class='minor'>${e(b.aciklama)}</div></td><td style='white-space:nowrap'>${e(b.onceSonra)}</td></tr>`,
        );
      }
      p.push('</table>');
    } else
      p.push(
        "<p style='padding:12px 14px;background:#eaf6ee'>İzlenen ürün ve JVM'lerde sorun veya değişiklik görünmüyor.</p>",
      );

    const islemler = deg.flatMap((d) =>
      (sonraS[d.h]?.islemler || [])
        .filter((l) => String(l).startsWith('SONUC|'))
        .map((l) => {
          const q = String(l).split('|');
          return {
            h: d.h,
            d,
            islem: q[1],
            urun: q[2],
            ad: q[3],
            sonuc: q[4],
            mesaj: q.slice(5).join('|'),
          };
        }),
    );
    if (islemler.length) {
      // v4 B: birim acikca "komut · sunucu"; sayaclar komutKoprusu ile ayni (Otomasyon Ozeti koprusu da onu kullanir).
      p.push(
        `<h2>Otomatik Düzeltme <span class='muted'>(${islemler.length} komut · ${kp.sunucu} sunucu)</span></h2>`,
        `<p class='sayilar'>Başarılı komut <b>${kp.ok}</b> · başarısız <b>${kp.fail}</b> · gerek kalmadı <b>${kp.skip}</b> · başarılı ama son kontrolde hedefte değil <b>${kp.okHedefteDegil}</b> · başarılı ama doğrulanamadı <b>${kp.okOlculemedi}</b></p>`,
        "<table class='fl' cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Servis / JVM</th><th>İşlem</th><th>Komut sonucu</th></tr>",
      );
      for (const x of islemler.sort(
        (a, b) =>
          (a.sonuc === 'FAIL' ? 0 : 1) - (b.sonuc === 'FAIL' ? 0 : 1) || a.h.localeCompare(b.h),
      )) {
        const css = x.sonuc === 'OK' ? 'ok' : x.sonuc === 'FAIL' ? 'problem' : 'info';
        const etiket =
          x.sonuc === 'OK'
            ? 'Komut başarılı'
            : x.sonuc === 'FAIL'
              ? 'Komut başarısız'
              : 'Gerek kalmadı';
        p.push(
          `<tr class='${sinif(x.d)}'><td class='host'>${e(kisaHost(x.h))}</td><td>${e(servisAdi(x.ad ? `${x.urun}|${x.ad}` : x.urun))}</td><td>${x.islem === 'baslat' ? 'Başlat' : x.islem === 'durdur' ? 'Durdur' : e(x.islem)}</td><td>${pill(css, etiket)}<div class='minor'>${e(x.mesaj)}</div></td></tr>`,
        );
      }
      p.push('</table>');
    }
    const normal = deg.filter((d) => d.sonuc === 'OK').map((d) => kisaHost(d.h));
    p.push(
      `<h2 class='fl-n'>Normal Sunucular <span class='muted'>(${normal.length})</span></h2><div class='fl-n'>`,
    );
    if (normal.length) {
      p.push("<table role='presentation' class='healthy' cellpadding='0' cellspacing='0'>");
      for (let i = 0; i < normal.length; i += 3) {
        const satir = normal.slice(i, i + 3);
        p.push(
          `<tr>${satir.map((h) => "<td style='width:33.33%;padding:7px 10px'>" + e(h) + '</td>').join('')}${"<td style='width:33.33%'>&nbsp;</td>".repeat(3 - satir.length)}</tr>`,
        );
      }
      p.push('</table>');
    } else p.push("<p class='muted'>Normal sınıfında sunucu bulunmuyor.</p>");
    p.push('</div>', DURUMLAR_NOTU, '</section>');
  }
  p.push(...(sonraS ? [] : [DURUMLAR_NOTU]), '</td></tr></table></td></tr></table></body></html>');
  return p.join('\n');
}

module.exports = { raporHtml, sunucuDegerlendir };
