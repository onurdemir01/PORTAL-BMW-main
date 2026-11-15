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
//     Kapatma kapisinin korudugu urun (once BOS, eski surum once'nin JBoss urunu; kapi yalniz ham once'den) -> Uyari
//     (NEW_URUN, dokunulmadi). Urunu once calismayan JVM'in komutu urunun SONUC|durdur satiridir ("urunle birlikte
//     kapatildi"). Durdur SKIP (kapatma aninda kapaliydi) ama son goruntude calisiyor -> "sonra yeniden kalkti" (eski betik
//     DEGIL). URUN satiri olmayip JVM'i calisan (once calismayan) urun calisiyor sayilir (reboot-check.cjs sonKume).
//   * Duzeltilen (kapaliydi acildi / fazladan JVM kapatildi) -> Bilgi
//   * v3 (2026-11-15 aksam): otomasyonun KAPATTIGI urun -> Uyari (KAPATILDI_URUN, "kontrol edilecek"); AWX'teki betik
//     eski (betik_surum yok / < 3) -> Uyari (BETIK_ESKI). Bos once'de web urunleri (NGINX/RHA/IHS) korunmaz, kapatilir.
//     Otomasyon sinifi (basarili/basarisiz/dokunmadi) ve teknoloji listesi reboot-check.cjs otomasyonOzeti'nden (tek kaynak).
//   * boot_id degismemis -> Uyari (reboot dogrulanamadi)
//   * Olculemedi (sonuc gelmedi / son goruntu alinamadi) -> Kritik ("sorunsuz" SAYILMAZ)
// DURUSTLUK (2026-11-14): "Otomatik kapatildi" YALNIZ o oge icin SONUC|durdur|...|OK varsa yazilir
// (urun icin SONUC|durdur|<urun>||OK; JVM'i ancak plan durdur dediyse ya da urunu kapatildiysa). Komut yoksa "kendiliginden kapandi".
// "Otomatik acildi" yalniz SONUC|baslat|...|OK ile; komutsuz kalkan oge "kendiliginden acildi". Komut FAIL donup
// oge yine de kalktiysa / kapandiysa ayri sinif (KOMUT_HATALI_*): "komut calistirmadi" demek yanlis olurdu.
// Yalniz SONUC satirinda gorunen oge (durulma goruntusunde gorulup kapatilan JVM) de listelenir.
// Eski surum once goruntusu (SURUM satiri yok) -> JBoss satirlari karsilastirilmaz, Uyari (ESKI_SURUM).
// Once goruntusu bos (BOOT var, izlenen satir yok) -> Uyari (ONCE_BOS); once calismayan ama simdi
// calisan, kapatma kapisi geregi dokunulmayan oge -> Uyari (NEW_URUN, kontrol gerekli). Reboot oncesi urun
// kumesi betikle ayni: URUN satirlari + JVM'i gorulen urunler.
'use strict';

const { varsayilanSira } = require('../util/siralama.cjs');

const URUN_ADI = { NGINX: 'Nginx', RHA: 'Apache HTTP Server', IHS: 'IBM HTTP Server (IHS)', CTG: 'CTG', JBOSS7: 'JBoss 7', JBOSS8: 'JBoss 8', WAS: 'WebSphere' };
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

/** Sunucu basina bulgular ve sonuc (saf; test edilir). */
function sunucuDegerlendir(onceSat, s) {
  const bulgu = [];
  if (!s || s.sonuc_yok) return { sonuc: 'PROBLEM', bulgu: [{ durum: 'OLCULEMEDI', servis: 'Sistem kontrolü', aciklama: 'Sunucudan sonuç gelmedi (ulaşılamadı ya da kopya doğrulanamadı).', onceSonra: '—' }] };
  // Eski surum once goruntusunun JBoss satirlari yeni nesil kuralina CEVRILIR (reboot-check.cjs onceNesilCevir,
  // 2026-11-15); yalniz cevrilemeyen JBoss 7 urunu 'belirsiz' (dokunulmadi, uyari).
  const { onceNesilCevir, kapatmaKapisi, kapiKorur, betikSurumu, betikEskiMetni } = require('./reboot-check.cjs');
  const surum = betikSurumu(s);
  const cev = onceNesilCevir(onceSat, s.son_olculdu ? s.son_goruntu : s.goruntu);
  // Kapatma kapisi (betik ve Portal kalan ile ayni, yalniz ham once): bos once / eski surum JBoss urunu -> "dokunulmadi".
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
    bulgu.push({ durum: 'ONCE_BOS', servis: 'Sistem kontrolü', aciklama: 'Reboot öncesi görüntüde izlenen ürün/JVM yoktu; yalnız web ürünleri (Nginx/Apache/IHS) reboot öncesi haline (kapalı) döndürülür, diğerlerine dokunulmadı. Uygulamalar zaten kapalıyken mi alındı? Elle kontrol edin.', onceSonra: '—' });
  // v3 surum isareti: AWX'teki betik eskiyse bu kosuda urun kapatma / yeniden deneme yoktu (kesin; "olabilir" denmez).
  if (!surum.guncel) bulgu.push({ durum: 'BETIK_ESKI', servis: 'Sistem kontrolü', aciklama: betikEskiMetni(s), onceSonra: '—' });
  if (cev.belirsiz.length)
    bulgu.push({ durum: 'ESKI_SURUM', servis: 'JBoss 7', aciklama: 'Reboot öncesi görüntü eski betik sürümüyle alınmış; JBoss 7 ürün satırının nesli belirlenemedi (JBoss 8 olabilir), JBoss 7 ürününe dokunulmadı. Elle kontrol edin.', onceSonra: '—' });
  if (o.boot && ilk.boot && o.boot !== 'bilinmiyor' && o.boot === ilk.boot)
    bulgu.push({ durum: 'REBOOT_NOT_CONFIRMED', servis: 'Sistem kontrolü', aciklama: 'Sunucunun boot kimliği değişmemiş; reboot doğrulanamadı.', onceSonra: '—' });
  if (!son) bulgu.push({ durum: 'OLCULEMEDI', servis: 'Sistem kontrolü', aciklama: 'Düzeltmeden sonraki son görüntü alınamadı; sorunsuz sayılmadı.', onceSonra: '—' });
  else {
    // Anahtarlar: once / ilk / son goruntu + SONUC satirlari. Yalniz durulma goruntusunde gorunup JVM planiyla
    // kapatilan oge (ilk ve son goruntude yok) yalniz SONUC satirindan bilinir; atlanirsa yapilan islem gorunmezdi.
    const islemAnahtar = [];
    for (const l of Array.isArray(s.islemler) ? s.islemler : []) {
      const q = String(l).split('|');
      if (q[0] !== 'SONUC' || !URUN_ADI[q[2]]) continue;
      islemAnahtar.push(q[3] ? `${q[2]}|${q[3]}` : q[2]);
    }
    const anahtarlar = new Set([...o.urun, ...ilk.urun, ...son.urun, ...[...o.jvm, ...ilk.jvm, ...son.jvm], ...islemAnahtar]);
    for (const k of [...anahtarlar].sort(varsayilanSira)) {
      const jvm = k.includes('|');
      const var_ = (g) => (jvm ? g.jvm.has(k) : g.urun.has(k));
      const urun = k.split('|')[0];
      const once = var_(o); const ilkV = var_(ilk); const sonV = var_(son);
      const ad = jvm ? k.split('|')[1] : '';
      // komut: OK | FAIL | SKIP | undefined (hic kosmadi)
      const komut = (islem) => isl.get(`${islem}|${urun}|${ad}`);
      if (once && sonV && ilkV) continue;
      if (once && !sonV) bulgu.push({ durum: 'DOWN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışıyordu; otomatik düzeltmeye rağmen çalışmıyor.', onceSonra: 'çalışıyordu → çalışmıyor' });
      else if (once && !ilkV && sonV && komut('baslat') === 'OK') bulgu.push({ durum: 'DUZELTILDI', servis: servisAdi(k), aciklama: 'Reboot sonrası kapalıydı; otomatik açıldı.', onceSonra: 'kapalıydı → çalışıyor' });
      else if (once && !ilkV && sonV && komut('baslat') === 'FAIL') bulgu.push({ durum: 'KOMUT_HATALI_ACILDI', servis: servisAdi(k), aciklama: 'Reboot sonrası kapalıydı; Portal açma komutu BAŞARISIZ döndü, son kontrolde çalışıyor.', onceSonra: 'kapalıydı → çalışıyor' });
      else if (once && !ilkV && sonV) bulgu.push({ durum: 'KENDILIGINDEN_ACILDI', servis: servisAdi(k), aciklama: 'Reboot sonrası ilk görüntüde kapalıydı; Portal açma komutu çalıştırmadan kalktı (auto-start).', onceSonra: 'kapalıydı → çalışıyor' });
      // Urunu reboot oncesi calismayan JVM'in kendi komutu yoktur; urun kapatma komutu (SONUC|durdur|<urun>||) onu da kapsar.
      const urunJvmi = jvm && !o.urun.has(urun);
      const durdurK = komut('durdur') ?? (urunJvmi ? isl.get(`durdur|${urun}|`) : undefined);
      const ile = urunJvmi && !komut('durdur') ? 'ürünle birlikte ' : '';
      if (!once && urunJvmi && sonV && korur(urun)) bulgu.push({ durum: 'NEW_URUN', servis: servisAdi(k), aciklama: 'Ürün reboot öncesi çalışmıyordu; önce görüntüsü boş / eski sürüm olduğu için kapatılmadı, dokunulmadı.', onceSonra: 'yoktu → çalışıyor' });
      else if (!once && urunJvmi && sonV) bulgu.push({ durum: 'NEW_URUN', servis: servisAdi(k), aciklama: `Ürün reboot öncesi çalışmıyordu; ürünle birlikte kapanması gerekirken hâlâ çalışıyor${durdurK === 'FAIL' ? ' (ürün kapatma komutu BAŞARISIZ)' : durdurK === 'SKIP' ? ' (kapatma anında ürün kapalıydı, sonra yeniden kalktı)' : durdurK ? '' : ' (ürün kapatma komutu çalışmadı)'}.`, onceSonra: 'yoktu → çalışıyor' });
      else if (!once && !jvm && sonV && korur(urun)) bulgu.push({ durum: 'NEW_URUN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu, şimdi çalışıyor; önce görüntüsü boş / eski sürüm olduğu için kapatılmadı, dokunulmadı.', onceSonra: 'yoktu → çalışıyor' });
      else if (!once && !jvm && sonV) bulgu.push({ durum: 'NEW_URUN_KALAN', servis: servisAdi(k), aciklama: `Reboot öncesi çalışmıyordu; otomatik kapatılması gerekirken hâlâ çalışıyor — ${durdurK === 'FAIL' ? 'kapatma komutu BAŞARISIZ döndü' : durdurK === 'OK' ? 'kapatma komutu başarılı döndü ama süreç hâlâ çalışıyor' : durdurK === 'SKIP' ? 'kapatma anında zaten kapalıydı (komut gerekmedi), sonra yeniden kalktı' : surum.guncel ? 'kapatma komutu çalışmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)' : `kapatma komutu çalışmadı — AWX'teki betik eski (${surum.etiket}); güncel betikle yeniden çalıştırın`}.`, onceSonra: 'yoktu → çalışıyor' });
      else if (!once && jvm && sonV) bulgu.push({ durum: 'NEW_KALAN', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu; kapatılması gerekirken hâlâ çalışıyor.', onceSonra: 'yoktu → çalışıyor' });
      // v3 B2: otomasyonun kapattigi URUN uyari sinifindadir ("kapatildi - kontrol edilecek"); JVM bilgi kalir.
      else if (!once && !sonV && durdurK === 'OK') bulgu.push({ durum: jvm ? 'KAPATILDI' : 'KAPATILDI_URUN', servis: servisAdi(k), aciklama: `Reboot öncesi çalışmıyordu; reboot sonrası ${ilkV ? 'açılmıştı' : 'kalkmıştı (durulma beklemesinde görüldü)'}, ${ile}otomatik kapatıldı.${jvm ? '' : ' Beklenen durum mu kontrol edin.'}`, onceSonra: 'yoktu → kapatıldı' });
      else if (!once && !sonV && durdurK === 'FAIL') bulgu.push({ durum: 'KOMUT_HATALI_KAPANDI', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu; Portal kapatma komutu BAŞARISIZ döndü, son kontrolde çalışmıyor.', onceSonra: 'yoktu → kapandı' });
      else if (!once && (ilkV || durdurK) && !sonV) bulgu.push({ durum: 'KENDILIGINDEN_KAPANDI', servis: servisAdi(k), aciklama: 'Reboot öncesi çalışmıyordu; reboot sonrası görülmüştü, son kontrolde çalışmıyor. Portal kapatma komutu çalıştırmadı.', onceSonra: 'yoktu → kapandı' });
    }
  }
  const kritik = bulgu.some((b) => ['DOWN', 'NEW_KALAN', 'NEW_URUN_KALAN', 'OLCULEMEDI'].includes(b.durum));
  const sonuc = kritik ? 'PROBLEM' : bulgu.some((b) => DURUM[b.durum]?.[1] === 'warning') ? 'WARNING' : bulgu.length ? 'INFO' : 'OK';
  // Otomasyon ozeti (2026-11-15, ekip: "otomasyon kac tanesinde calisti, kac tanesine dokunmadi"): SKIP komut sayilmaz.
  const komutlar = [...isl.values()].filter((x) => x === 'OK' || x === 'FAIL');
  return { sonuc, bulgu, komut: komutlar.length, komutHata: komutlar.filter((x) => x === 'FAIL').length };
}

const DURUM = {
  DOWN: ['Çalışmıyor (DOWN)', 'problem'], NEW_KALAN: ['Fazladan çalışıyor (NEW)', 'problem'], NEW_URUN_KALAN: ['Fazladan çalışan ürün (NEW) — kapatılamadı', 'problem'], OLCULEMEDI: ['Ölçülemedi', 'problem'],
  REBOOT_NOT_CONFIRMED: ['Reboot doğrulanamadı', 'warning'], ONCE_BOS: ['Önce görüntüsü boş', 'warning'], NEW_URUN: ['Yeni süreç (NEW) — kontrol gerekli', 'warning'],
  DUZELTILDI: ['Otomatik açıldı', 'info'], KAPATILDI: ['Otomatik kapatıldı', 'info'], KAPATILDI_URUN: ['Otomatik kapatıldı — kontrol edilecek', 'warning'],
  BETIK_ESKI: ['AWX betiği eski', 'warning'],
  KENDILIGINDEN_ACILDI: ['Kendiliğinden açıldı', 'info'], KENDILIGINDEN_KAPANDI: ['Kendiliğinden kapandı', 'info'],
  KOMUT_HATALI_ACILDI: ['Açma komutu başarısız, sonra kalktı', 'info'], KOMUT_HATALI_KAPANDI: ['Kapatma komutu başarısız, sonra kapandı', 'info'],
  ESKI_SURUM: ['JBoss 7 dokunulmadı (eski görüntü)', 'warning'],
};
const RENK = { problem: ['#fff0f0', '#a12631'], warning: ['#fff4df', '#805300'], info: ['#edf4ff', '#17549f'], ok: ['#eaf6ee', '#20633f'] };
const SIRA = { PROBLEM: 0, WARNING: 1, INFO: 2, OK: 3 };
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kisaHost = (h) => String(h).split('.', 1)[0];
const pill = (css, metin) => `<span class='pill ${css}' style='background:${RENK[css][0]};color:${RENK[css][1]};padding:3px 8px;font-weight:bold'>${e(metin)}</span>`;

// [id, etiket, satir sinifi] - sinif bos = tumu. v3 B4: otomasyon siniflari reboot-check.cjs otomasyonOzeti'nden (ekranla ayni).
// Inceleme F1: "Sorunsuz / Sorun kaldi / Kontrol gerekli" filtreleri SON DURUM'a (sonraDegerlendir durum -> d-*) baglidir; satirdaki
// "Son durum" pill'i, Otomasyon Ozeti kutulari ve ekran (sonDurum) ile ayni kaynak. Rapor bulgu sinifi (s-*) yalniz "Bilgi"de.
const FILTRELER = [['tum', 'Tümü', ''], ['obasarili', 'Otomasyon başarılı', 'o-basarili'], ['obasarisiz', 'Otomasyon başarısız', 'o-basarisiz'],
  ['dokunmadi', 'Otomasyon dokunmadı', 'o-dokunmadi'], ['sorunsuz', 'Sorunsuz', 'd-sorunsuz'], ['kritik', 'Sorun kaldı (kritik)', 'd-sorunlu'],
  ['uyari', 'Kontrol gerekli', 'd-kontrol'], ['bilgi', 'Bilgi', 's-INFO']];
/** Son durum grubu (ekran sonDurum ile ayni): olculemeyen "Sorun kaldi" sayilir. */
const sonGrup = (son) => (son === 'sorunsuz' || son === 'kontrol' ? son : 'sorunlu');
const OTOMASYON = { basarili: ['Otomasyon başarılı', 'ok'], basarisiz: ['Otomasyon başarısız', 'problem'], dokunmadi: ['Otomasyon dokunmadı', 'info'] };
const SON_DURUM = { sorunsuz: ['Sorunsuz', 'ok'], kontrol: ['Kontrol gerekli', 'warning'], sorunlu: ['Sorun kaldı', 'problem'], olculemedi: ['Ölçülemedi', 'problem'] };
const STIL = [
  'body{margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#202938;font-size:14px;line-height:1.45}',
  '.shell{width:100%;max-width:960px;margin:0 auto;background:#fff}', '.pad{padding:24px 28px}',
  'h1{font-size:23px;line-height:1.25;margin:0 0 6px}', 'h2{font-size:17px;margin:26px 0 10px}', '.muted{color:#687385;font-size:12px}',
  'table{width:100%;border-collapse:collapse}', 'th{font-weight:bold;text-align:left;background:#f1f4f8;color:#344054;font-size:12px}',
  'td,th{padding:10px 11px;border-bottom:1px solid #e6e9ef;vertical-align:top}', '.summary td{text-align:center;padding:13px 5px;border:1px solid #e6e9ef}',
  '.host{font-weight:bold;white-space:nowrap}', '.minor{color:#6d7581;font-size:12px;word-break:break-word}', '.note{color:#576477;font-size:12px;margin-top:9px}',
  '.pill{display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:bold}',
  '.healthy td{padding:7px 10px;font-size:12px;border:none;color:#344054}',
  // FILTRE (2026-11-15): yalniz CSS (radyo + :checked ~); betik yok, e-postada filtre calismaz ama tum satirlar kalir.
  '.fr{position:absolute;opacity:0;pointer-events:none}', '.filtre{margin:14px 0 4px;display:flex;flex-wrap:wrap;gap:6px}',
  '.filtre label{cursor:pointer;border:1px solid #d0d6e0;border-radius:14px;padding:4px 10px;font-size:12px;color:#344054;background:#fff}',
  ...FILTRELER.map(([id]) => `#f-${id}:checked ~ .filtre label[for=f-${id}]{background:#202938;color:#fff;border-color:#202938}`),
  ...FILTRELER.filter(([, , sinif]) => sinif).map(([id, , sinif]) => `#f-${id}:checked ~ table.fl tr.r:not(.${sinif}){display:none}`),
  ...FILTRELER.filter(([, , sinif]) => sinif).map(([id]) => `#f-${id}:checked ~ .fl-n{display:none}`),
].join('\n');

/** reboot_checks satiri (satir(r, true) bicimi) -> tam HTML belge. */
function raporHtml(k) {
  const onceS = k?.once?.sonuc?.sunucular || {};
  const sonraS = k?.sonra?.sonuc?.sunucular || null;
  const hostlar = Array.isArray(k?.hosts) ? k.hosts : [];
  const p = [`<!doctype html><html lang='tr'><head><meta charset='utf-8'><title>Reboot Kontrolü #${e(k?.id)} — Durum Raporu</title><style>${STIL}</style></head><body>`,
    "<table role='presentation' cellpadding='0' cellspacing='0' border='0' style='width:100%;background:#f5f7fa'><tr><td align='center'>",
    "<table role='presentation' class='shell' cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:960px;background:#ffffff'><tr><td class='pad' style='padding:24px 28px'>",
    '<h1>Patch Reboot | Durum Raporu</h1>'];
  const ust = (faz) => `<div class='muted'>${e(faz)} &nbsp;·&nbsp; Kayıt: <b>#${e(k?.id)}</b>${k?.not ? ` &nbsp;·&nbsp; ${e(k.not)}` : ''} &nbsp;·&nbsp; ${hostlar.length} sunucu &nbsp;·&nbsp; ${e(k?.olusturan || '')}</div>`;
  const kutular = (ogeler) => `<table role='presentation' class='summary' cellpadding='0' cellspacing='0'><tr>${ogeler.map(([l, v, fg, bg]) =>
    `<td style='text-align:center;border:1px solid #e6e9ef;background:${bg};padding:13px 5px'><span style='display:block;font-size:24px;font-weight:bold;color:${fg}'>${v}</span><span style='font-size:12px;color:#596579'>${e(l)}</span></td>`).join('')}</tr></table>`;

  if (!sonraS) {
    // Yalniz "once" kaydi var: neyin kaydedildigini gosterir.
    const alinan = hostlar.filter((h) => onceS[h]?.goruntu_ok && (onceS[h]?.goruntu || []).some((l) => String(l).startsWith('BOOT|')));
    p.push(ust('Reboot öncesi kayıt'), `<p style='font-size:15px;margin:17px 0 14px'><b>${alinan.length} / ${hostlar.length} sunucunun reboot öncesi görüntüsü kaydedildi.</b></p>`,
      kutular([['Sunucu', hostlar.length, '#202938', '#f7f9fc'], ['Kaydedildi', alinan.length, '#20633f', '#eaf6ee'], ['Alınamadı', hostlar.length - alinan.length, '#a12631', '#fff0f0']]),
      "<h2>Kaydedilen ürünler</h2><table cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Çalışan ürünler</th><th>JVM</th></tr>");
    for (const h of hostlar) {
      const g = goruntu(onceS[h]?.goruntu);
      const ok = alinan.includes(h);
      const bos = ok && g.urun.size === 0 && g.jvm.size === 0;
      const urunMetni = bos ? pill('warning', 'izlenen ürün yok — uygulamalar kapalıyken mi alındı?') : e([...onceGoruntu(onceS[h]?.goruntu).urun].map((u) => URUN_ADI[u] || u).join(', '));
      p.push(`<tr><td class='host'>${e(kisaHost(h))}</td><td>${ok ? urunMetni : pill('problem', 'Görüntü alınamadı')}</td><td>${ok ? g.jvm.size : '—'}</td></tr>`);
    }
    p.push('</table>');
  } else {
    // Tek kaynak (v3 B4): otomasyon sinifi + teknoloji listesi + son durum reboot-check.cjs sonraDegerlendir'den.
    const { sonraDegerlendir, onceGirdisi } = require('./reboot-check.cjs');
    const sd = sonraDegerlendir(sonraS, hostlar, onceGirdisi(onceS));
    const deg = hostlar.map((h) => ({ h, ...sunucuDegerlendir(onceS[h]?.goruntu, sonraS[h]), oto: sd[h]?.otomasyon || { sinif: 'dokunmadi', teknoloji: [] }, son: sd[h]?.durum || 'olculemedi' }));
    const say = { PROBLEM: 0, WARNING: 0, INFO: 0, OK: 0 };
    for (const d of deg) say[d.sonuc] += 1;
    const baslik = !deg.length ? 'Karşılaştırma için sunucu verisi bulunamadı.' : say.PROBLEM ? `${say.PROBLEM} sunucuda kritik durum tespit edildi.`
      : say.WARNING ? `Kritik sorun yok; ${say.WARNING} sunucuda uyarı var.` : say.INFO ? `Kritik sorun ve uyarı yok; ${say.INFO} sunucuda bilgi kaydı var.` : 'Tüm sunucuların karşılaştırma sonucu normal.';
    p.push(ust('Otomatik düzeltme sonrası • Son kontrol'), `<p style='font-size:15px;margin:17px 0 14px'><b>${e(baslik)}</b></p>`,
      kutular([['Sunucu', deg.length, '#202938', '#f7f9fc'], ['Kritik sunucu', say.PROBLEM, '#a12631', '#fff0f0'], ['Uyarılı sunucu', say.WARNING, '#805300', '#fff4df'], ['Bilgili sunucu', say.INFO, '#17549f', '#edf4ff'], ['Normal sunucu', say.OK, '#20633f', '#eaf6ee']]),
      // SAYI KARISIKLIGI (2026-11-15, ekip: "4 bilgi diyor 5 tane cikmis"): kutular SUNUCU sayar, Bulgular KAYIT;
      // bir sunucuda birden cok bulgu olur. Ikisi de acikca yazilir.
      "<p class='note'>Kutular <b>sunucu</b> sayısıdır; bir sunucuda birden çok bulgu olabilir. Sunucu, en ağır bulgusunun sınıfında sayılır.</p>");
    const oSay = (c) => deg.filter((d) => d.oto.sinif === c).length;
    const sSay = (...c) => deg.filter((d) => c.includes(d.son)).length;
    p.push('<h2>Otomasyon Özeti</h2>',
      kutular([['Otomasyon başarılı', oSay('basarili'), '#20633f', '#eaf6ee'], ['Otomasyon başarısız', oSay('basarisiz'), '#a12631', '#fff0f0'], ['Otomasyon dokunmadı', oSay('dokunmadi'), '#344054', '#f7f9fc']]),
      kutular([['Sorunsuz', sSay('sorunsuz'), '#20633f', '#eaf6ee'], ['Kontrol gerekli', sSay('kontrol'), '#805300', '#fff4df'], ['Sorun kaldı', sSay('sorunlu', 'olculemedi'), '#a12631', '#fff0f0']]),
      "<p class='note'>Otomasyon: <b>dokunmadı</b> = hiç açma/kapatma komutu çalışmadı (gerek kalmayanlar sayılmaz); <b>başarılı</b> = çalışan her komut başarılı ve dokunduğu her öğe son kontrolde hedef durumda; <b>başarısız</b> = bir komut başarısız ya da dokunduğu bir öğe son kontrolde hedefte değil / ölçülemedi. Üç sınıfın toplamı sunucu sayısıdır. Alt satır son kontroldeki durumdur (ekrandaki ile aynı).</p>");
    const sinif = (d) => `r s-${d.sonuc} o-${d.oto.sinif} d-${sonGrup(d.son)}`;
    // FILTRE: radyolar tum filtreli tablolardan ONCE ve onlarla kardes (CSS ~ secicisi).
    p.push(...FILTRELER.map(([id], i) => `<input type='radio' name='f' id='f-${id}' class='fr'${i === 0 ? ' checked' : ''}>`),
      "<div class='filtre'>" + FILTRELER.map(([id, etiket]) => "<label for='f-" + id + "'>" + e(etiket) + '</label>').join('') + '</div>');
    const tekno = (o, calisan) => (calisan && o.not ? `<span style='color:#a12631'>${e(o.not)}</span>` : '') || o.teknoloji.filter((t) => t.calistirildi === calisan).map((t) => calisan
      ? `<span style='color:${t.sonuc === 'hata' ? '#a12631' : '#20633f'}'>${e(t.ad)}: ${e(t.ozet)}</span>`
      : `<span style='color:#596579'>${e(t.ad)} (${e(t.ozet)})</span>`).join('<br>') || "<span class='muted'>—</span>";
    p.push(`<h2>Sunucu bazında otomasyon <span class='muted'>(${deg.length} sunucu)</span></h2>`,
      "<table class='fl' cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr><th>Sunucu</th><th>Otomasyon</th><th>Çalıştırılan teknolojiler</th><th>Çalıştırılmayan teknolojiler (nedeniyle)</th><th>Son durum</th></tr>");
    for (const d of [...deg].sort((a, b) => a.h.localeCompare(b.h))) {
      const [oEt, oCss] = OTOMASYON[d.oto.sinif] || OTOMASYON.dokunmadi;
      const [sEt, sCss] = SON_DURUM[d.son] || SON_DURUM.olculemedi;
      p.push(`<tr class='${sinif(d)}'><td class='host'>${e(kisaHost(d.h))}</td><td>${pill(oCss, oEt)}</td><td class='minor'>${tekno(d.oto, true)}</td><td class='minor'>${tekno(d.oto, false)}</td><td>${pill(sCss, sEt)}</td></tr>`);
    }
    p.push('</table>');
    const bulgular = deg.flatMap((d) => d.bulgu.map((b) => ({ ...b, h: d.h, hs: d.sonuc, d }))).sort((a, b) => SIRA[a.hs] - SIRA[b.hs] || a.h.localeCompare(b.h));
    const bulguluSunucu = new Set(bulgular.map((b) => b.h)).size;
    p.push(`<h2>Bulgular <span class='muted'>(${bulgular.length} kayıt · ${bulguluSunucu} sunucu)</span></h2>`, "<p class='muted'>Yalnız sorunlu, düzeltilen ya da değişen kayıtlar gösterilir; normal çalışanlar tabloyu kalabalıklaştırmaz.</p>");
    if (bulgular.length) {
      p.push("<table class='fl' cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse'><tr><th>Sunucu</th><th>Servis / JVM</th><th>Durum</th><th>Önce → Sonra</th></tr>");
      for (const b of bulgular) {
        const [etiket, css] = DURUM[b.durum] || [b.durum, 'info'];
        p.push(`<tr class='${sinif(b.d)}'><td class='host'>${e(kisaHost(b.h))}</td><td>${e(b.servis)}</td><td>${pill(css, etiket)}<div class='minor'>${e(b.aciklama)}</div></td><td style='white-space:nowrap'>${e(b.onceSonra)}</td></tr>`);
      }
      p.push('</table>');
    } else p.push("<p style='padding:12px 14px;background:#eaf6ee'>İzlenen ürün ve JVM'lerde sorun veya değişiklik görünmüyor.</p>");

    const islemler = deg.flatMap((d) => (sonraS[d.h]?.islemler || []).filter((l) => String(l).startsWith('SONUC|')).map((l) => {
      const q = String(l).split('|');
      return { h: d.h, d, islem: q[1], urun: q[2], ad: q[3], sonuc: q[4], mesaj: q.slice(5).join('|') };
    }));
    if (islemler.length) {
      const c = { OK: 0, FAIL: 0, SKIP: 0 };
      for (const x of islemler) c[x.sonuc] = (c[x.sonuc] || 0) + 1;
      p.push(`<h2>Otomatik Düzeltme <span class='muted'>(${islemler.length} hedef)</span></h2>`,
        `<p>Başarılı komut: <b>${c.OK}</b> &nbsp;·&nbsp; Başarısız: <b>${c.FAIL}</b> &nbsp;·&nbsp; Gerek kalmadı: <b>${c.SKIP}</b></p>`,
        "<p class='note'><b>Önemli:</b> Komutun başarılı dönmesi, son görüntüde servis durumunun doğrulandığı anlamına gelmez. Nihai sonuç yukarıdaki karşılaştırmadır.</p>",
        "<table class='fl' cellpadding='0' cellspacing='0'><tr><th>Sunucu</th><th>Servis / JVM</th><th>İşlem</th><th>Komut sonucu</th></tr>");
      for (const x of islemler.sort((a, b) => (a.sonuc === 'FAIL' ? 0 : 1) - (b.sonuc === 'FAIL' ? 0 : 1) || a.h.localeCompare(b.h))) {
        const css = x.sonuc === 'OK' ? 'ok' : x.sonuc === 'FAIL' ? 'problem' : 'info';
        const etiket = x.sonuc === 'OK' ? 'Komut başarılı' : x.sonuc === 'FAIL' ? 'Komut başarısız' : 'Gerek kalmadı';
        p.push(`<tr class='${sinif(x.d)}'><td class='host'>${e(kisaHost(x.h))}</td><td>${e(servisAdi(x.ad ? `${x.urun}|${x.ad}` : x.urun))}</td><td>${x.islem === 'baslat' ? 'Başlat' : x.islem === 'durdur' ? 'Durdur' : e(x.islem)}</td><td>${pill(css, etiket)}<div class='minor'>${e(x.mesaj)}</div></td></tr>`);
      }
      p.push('</table>');
    }
    const normal = deg.filter((d) => d.sonuc === 'OK').map((d) => kisaHost(d.h));
    p.push(`<h2 class='fl-n'>Normal Sunucular <span class='muted'>(${normal.length})</span></h2><div class='fl-n'>`);
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
    p.push('</div>');
  }
  p.push("<p class='note' style='border-top:1px solid #e6e9ef;padding-top:14px'><b>Durumlar:</b> DOWN = reboot öncesi çalışıyordu, düzeltmeden sonra da çalışmıyor; NEW = reboot öncesi yoktu, şimdi çalışıyor. "
    + 'İzlenen ürünler: Nginx, Apache, IBM HTTP Server, CTG, JBoss 7/8, WebSphere ve JVM\'leri. Süreç sayısındaki değişim fark sayılmaz. '
    + 'Rapor tasarımı: patch-aggregate-report.py (patch_remediation).</p>',
  '</td></tr></table></td></tr></table></body></html>');
  return p.join('\n');
}

module.exports = { raporHtml, sunucuDegerlendir };
