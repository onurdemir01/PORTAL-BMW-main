// server/nginx-loadtest/dogrula.cjs - Nginx Hub > Yuk Testi: girdi ve guvenlik kapilari.
//
// Bu dosyadaki her kapi SUNUCU tarafinda karar verir; ekran (D) ayni kurallari yalniz kolaylik
// icin gosterir, playbook (A) ayni kurallari BIR KEZ DAHA assert eder. Sozlesme:
// scratchpad yuktesti_sozlesme.md bolum 3 (extra_vars) ve 9 (korkuluklar).
//
// IKI PARCA:
//   * SAF kapilar: senaryo satirlari, parametreler/butce, ortam kapisi, yuk makinesi kapisi,
//     aday IP / vhost, on kontrol degerlendirmesi, extra_vars kurulumu ve denetimi.
//   * kaynaklariOku: TBMWANS envanter / tarama tablolarini okur. Sorgu fonksiyonu PARAMETRE
//     olarak gelir (testte sahte). Okunamayan kaynak "yok" SAYILMAZ: 424 envanter_okunamadi.
//
// ORTAM KURALI (kullanici kurali, 2026-10-27 sozlesmesi): ad kurali (audit/nginx-hosts.cjs
// envOfHost) ESASTIR ve DEV/TEST/QA disindaki her sonuc (PROD, EDU, BILINMIYOR) reddedilir.
// Diger kaynaklar (dbo.nginx_inventory.env, dbo.Inventory.env, PROD RP listeleri) yalniz
// URETIM ISARETI EKLEYEBILIR, kapiyi asla gevsetemez. ratelimit.cjs'teki gevsek envOfHost ve
// FAIL-OPEN tierOfHost bilerek KULLANILMAZ.
//
// TUR 3 (2026-10-28, yuktesti2_sozlesme.md): hedef IP'yi kullanici yazar; ipSinifla IP'nin
// sahibini envanterlerden (nginx_inventory, Inventory, IPInventory, son tarama) bulur:
//   * sunucu  - IP tam bir non-prod nginx sunucusunun (ya da host seciciyle secilmis ve o hostun
//               IP'si; paylasilan VIP dahil): bugunku yol, sunucu tarafi da olculur.
//   * serbest - IP hicbir nginx sunucusunun degil (LB VIP / yonetilmeyen sunucu): yalniz Portal
//               izin listesindeki (NGINX_LOADTEST_SERBEST_AGLAR, en kucuk /24) aglarda, yasak
//               listesinin (NGINX_LOADTEST_SERBEST_YASAK) disinda, hicbir PROD / EDU / bilinmeyen
//               sahibe ait degilse ve envanter tazeyse; yalniz istemci olcumu, tavan 200 r/s / 50
//               baglanti. "Sahipsiz" PROD olmadiginin kaniti DEGILDIR: asil koruma izin listesidir.
// Motor: k6 (acik dongu, istek/sn) ya da wrk (kapali dongu, baglanti; toplam hiz tavan_rps ile
// sinirli, tavan sunucuda hesaplanir). Host basligi iki kipte yalniz bicimle denetlenir (D7);
// yalniz uretim / EDU / bilinmeyen sunucularda tanimli ad 409 host_uretim.
'use strict';

const crypto = require('node:crypto');

// ── SINIRLAR (kod sabiti; DB ayari DEGIL - bayat DB satiri kod varsayilanini ezmesin) ──
const SINIRLAR = Object.freeze({
  maxHiz: 450, // rate_limits.conf: limit_req 500 r/s/IP; pay birakildi (kit: IP_SINIRI)
  hizMin: 1,
  maxHizSayisi: 5,
  maxTekrar: 3,
  isinmaMin: 5,
  isinmaMax: 60,
  // Analiz penceresi [ilk olcum sn + 3, son olcum sn - 2] ve CPU ornekleri 1 sn aralikli: pencere
  // >= 30 sn ister (analiz.cjs pencere_kisa). 30..36 sn'lik olcum her adimi GECERSIZ yapiyordu.
  sureMin: 40,
  sureMax: 300,
  boslukMin: 0,
  boslukMax: 120,
  bostaMin: 30,
  bostaMax: 120,
  maxVuMin: 10,
  maxVu: 199, // limit_conn 200/IP
  maxButceSn: 2700, // toplam is suresi en cok 45 dk
  maxSatir: 400,
  maxTsvBayt: 200 * 1024,
  maxYolUzunlugu: 2048,
  // wrk (kapali dongu): adim = baglanti sayisi; is parcacigi her baglanti sayisini tam bolmeli.
  baglantiMin: 1,
  maxBaglanti: 199, // limit_conn 200/IP (maxVu ile ayni pay)
  maxBaglantiSayisi: 5,
  isParcacigiMin: 1,
  maxIsParcacigi: 16,
  // Serbest hedef (LB VIP / yonetilmeyen sunucu): izin listesi en kucuk /24; iki motorda hiz /
  // tavan <= 200 r/s ve VU / baglanti <= 50 (LB SNAT IP'sinde paylasilan 500 r/s / 200 baglanti).
  serbestMinOnek: 24,
  serbestTavanRps: 200,
  serbestMaxBaglanti: 50,
  // Is gecerlilik suresi: Portal yuk_son_epoch = simdi + 900 gonderir (AWX Relaunch'u reddedilir).
  isGecerlilikSn: 900,
  // Serbest siniflandirma tazeligi: IPInventory son yukleme ve son nginx taramasi.
  ipEnvanteriMaxYasSaat: 48,
  taramaMaxYasGun: 2,
});

const VARSAYILAN = Object.freeze({
  hizlar: Object.freeze([100, 250, 400]),
  tekrar: 2,
  isinma: 30,
  sure: 120,
  bosluk: 30,
  bosta: 60,
  maxvu: 150,
  kip: 'yeni',
  ae: 'br',
  motor: 'k6',
  baglantilar: Object.freeze([2, 4, 8]),
  is_parcacigi: 2,
  // Serbest hedefte tanimsiz hizlar / maxvu buradan (sunucuda yukaridaki degerler).
  serbest: Object.freeze({ hizlar: Object.freeze([50, 100, 200]), maxvu: 50 }),
});

const MOTORLAR = Object.freeze(['k6', 'wrk']);
const HEDEF_TURLERI = Object.freeze(['sunucu', 'serbest']);
const IZINLI_ORTAM = new Set(['DEV', 'TEST', 'QA']);
const KIPLER = new Set(['yeni', 'ka']);
const AE_DEGERLERI = new Set(['br', 'gzip', 'identity']);
const TURLER = new Set(['js', 'css', 'json', 'html', 'config', 'img', 'font', 'diger']);
const BOYUTLAR = new Set(['kucuk', 'orta', 'buyuk']);
const SENARYO_TURLERI = new Set(['K', 'B']);
const KAYNAKLAR = new Set(['har', 'liste']);
const ISLEMLER = new Set(['on_kontrol', 'kosu', 'durdur']);

// Desenler playbook assert'leriyle AYNI (sozlesme bolum 3). Birinde degisirse digeri de.
const HOST_RE = /^[A-Z0-9][A-Z0-9-]{1,30}$/;
const RUN_ID_RE = /^[0-9]{1,10}$/;
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;
// RFC 1123 ad: kucuk harf, port YOK, joker YOK, '~' (regex server_name) YOK, bosluk YOK.
const VHOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const HIZLAR_RE = /^[0-9]{1,3}( [0-9]{1,3}){0,4}$/;
const K6_YOLU_RE = /^\/[A-Za-z0-9._/-]{1,200}$/;
const UA_ONEK_RE = /^[a-z][a-z0-9-]{2,30}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CIKTI_KOK_RE = /^\/[A-Za-z0-9._/-]{1,200}$/;
const ADIM_RE = /^R[0-9]{1,10}$/;
const TUR_RE = /^[A-Za-z0-9_-]{1,120}$/;
// har_senaryo.py BEYAZ_LISTE ve yuk_k6.js YOL_RE ile BIREBIR: sorgu (?), parca (#), bosluk,
// ters egik cizgi ve kontrol karakteri bu kumede YOK.
const BEYAZ_LISTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
// har_senaryo.py kisisel_veri_suphesi ile ayni uc desen (sunucu ayni kurali YENIDEN uygular:
// tarayicidaki suzgec atlanmis olabilir).
const RAKAM_SEGMENT = /^\d{6,}$/;
// E-posta: har_senaryo.py'nin `[^/@]+@[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$`
// ifadesi bastan sabitsiz oldugu icin uzun '@'li parcada polinom geri izliyordu (2 KB yol ~0.5 sn,
// tek POST dakikalarca olay dongusunu kilitleyebiliyordu). epostaMi ayni karari DOGRUSAL verir:
// alan kismi SON '@'tan sonrasidir (alan '@' tasiyamaz), '@'tan hemen once '@' ya da '/' olmayan
// en az bir karakter gerekir. Esdegerlik rastgele dizgilerle olculur (dogrula.test YD11).
const EPOSTA_ALAN = /^(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const EPOSTA_ALAN_MAX = 253;
const RAKAM_11 = /(?<!\d)\d{11}(?!\d)/;
// Yol parametresi (`;jsessionid=...`, `;sid=`): JBoss/JSF ilk yanitta oturum kimligini yola yazar.
// Oturum bilgisi senaryoya (DB, ekran, AWX extra_vars, k6) GIREMEZ.
const NOKTALI_VIRGUL_NEDENI = 'yolda ";" parametresi var (ör. ;jsessionid) — oturum bilgisi senaryoya giremez';
const STATIK_UZANTI = ['.js', '.mjs', '.css', '.json', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.webp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.html', '.htm', '.txt', '.wasm'];
// Kodlanmis nokta / egik cizgi / ters egik cizgi / NUL / satir sonu / cift kodlama: nginx'in
// yol normallestirmesini sasirtmanin yolu. Statik bir dosya yolunda mesru karsiligi yok.
const KODLU_TEHLIKE = /%(2e|2f|5c|00|0a|0d|25)/i;
const BOZUK_YUZDE = /%(?![0-9A-Fa-f]{2})/;
// Kontrol karakteri (CR/LF dahil): baslik / log enjeksiyonunun yolu.
// eslint-disable-next-line no-control-regex
const KONTROL_KARAKTERI = /[\u0000-\u001f\u007f]/;

const VARSAYILAN_YUK_HOSTLARI = Object.freeze(['GBNGXT34']);
const VARSAYILAN_K6 = '/home/www/bin/k6';
const VARSAYILAN_WRK = '/home/www/bin/wrk';
const VARSAYILAN_CIKTI_KOK = '/sw/BMW_PORTAL/nginx_loadtest';
const UA_ONEK = 'portal-yuktesti';
// Son kapi (playbook 2. assert ile ayni): sayi alanlari, is gecerlilik penceresinin ust payi.
const SAYI_RE = /^[0-9]{1,5}$/;
const EPOCH_RE = /^[0-9]{10}$/;
const SON_EPOCH_UST_PAY_SN = 1800;

// ── SABIT UYARILAR (sunucuda; uyariOnay zorunlu, ekran yalniz gosterir) ───────────────────

const SERBEST_UYARISI = 'Serbest hedef: sunucu tarafı ölçüm (CPU, nginx logu) yapılmaz; sonuçlar yalnız istemci ölçümüdür. Hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır (en çok 200 istek/sn ve 50 bağlantı). Yük bir yük dengeleyici (LB) üzerinden gidiyorsa nginx isteği (realip yoksa) LB\'nin IP\'sinden görür: IP başına 500 istek/sn ve 200 bağlantı sınırı LB arkasındaki herkesle, vhost başına 5000 istek/sn sınırı tüm istemcilerle paylaşılır; başka kullanıcılar 429 alabilir.';
const WRK_UYARISI = 'wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir. Portal her isteğe bağlantı başına sabit bekleme ekler; toplam hız ORTALAMADA koşunun tavanını (hedefin ölçülmüş limit_req\'inin %90\'ı, en çok 450; serbest hedefte 200 istek/sn) aşmaz; bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir. limit_req burst\'ü bağlantı sayısından küçük ya da burst\'süz yollarda 429 alınır ve koşu durur; böyle yollarda k6 kullanın ya da bağlantı sayısını düşük tutun. İlk 429 ya da 5xx yanıtta iş parçacığı yük üretmeyi keser; 429, 5xx, 10\'dan fazla soket hatası ya da %1 üstü hata oranında koşu durur (DUR). Gecikme yüzdelikleri wrk\'nin koordineli ihmal düzeltmesiyle hesaplanır; wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.';
// D7: Host basligi server_name listesinde olmamak ENGEL degil, onay isteyen UYARI.
const HOST_LISTEDE_YOK_UYARISI = "Host başlığı (vhost) hedefin nginx -T çıktısındaki server_name'ler arasında yok ya da ölçülemedi (joker / regex ad olabilir; değilse istek default_server'a düşer). Ön kontroldeki 200 sonuçlarına bakın.";
const WRK_SNI_MESAJI = "wrk SNI'yi Host başlığına göre seçemez (IP adresi SNI olarak gider); SNI kutusunu kapatın.";

// Plan uyarilari (yalniz serbest hedef; satirda saklanir, kosu aninda yeniden kurulur).
// Host listeleri sirali, ilk 5 (metin deterministik: saklanan liste ile yeniden kurulan karsilastirilir).
const ilkBesHost = (P) => [...new Set(P)].sort().slice(0, 5).join(', ');
const HOST_TARAMADA_YOK_UYARISI = (vhost) => `Host başlığı (${vhost}) son nginx taramasında hiçbir sunucunun server_name listesinde yok: hedefin (LB / yönetilmeyen sunucu) bu adı nereye yönlendireceği bilinmiyor.`;
const HOST_URETIMDE_DE_VAR_UYARISI = (vhost, P) => `Host başlığı (${vhost}) üretim / EDU / ortamı bilinmeyen sunucularda da tanımlı (${ilkBesHost(P)}): LB ya da reverse proxy bu adı üretim havuzuna yönlendirebilir; VIP’in hangi havuza gittiğini doğrulayın.`;
const YUK_MAKINESI_HAVUZDA_UYARISI = (vhost, yukHost) => `Host başlığı (${vhost}) yük sunucusunun (${yukHost}) kendi server_name listesinde: VIP’in havuzunda yük sunucusu da olabilir; yükün bir kısmı yük sunucusunun kendi nginx’ine döner ve istemci ölçümü bozulur. Mümkünse başka bir yük sunucusu seçin.`;
const YUK_MAKINESI_RP_UYARISI = (yukHost) => `Yük sunucusu (${yukHost}) bir internet reverse proxy’si; hedef VIP’in havuzunda kendisi de olabilir. Havuzu doğrulayın.`;

// ── KUCUK YARDIMCILAR ─────────────────────────────────────────────────────────────────────

/** Kapi sonucu: { status, code, message }. Uclar bunu dogrudan yanita cevirir. */
function red(status, code, message, ek) {
  return Object.assign({ ok: false, status, code, message }, ek || {});
}

function hostNormalle(v) {
  const h = String(v ?? '').trim().toUpperCase();
  return HOST_RE.test(h) ? h : '';
}

function gecerliIpv4(v) {
  return typeof v === 'string' && IPV4_RE.test(v);
}

// Yuk makinesinin ulasacagi IP: geri donus (127/8) yuk makinesinin KENDISINE gider
// (GBNGXT34 da bir nginx'tir), 0/8 / link-local / cok noktali yayin hedef degildir.
function kullanilabilirIp(v) {
  if (!gecerliIpv4(v)) return false;
  const [a, b] = v.split('.').map(Number);
  if (a === 0 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function gecerliVhost(v) {
  return typeof v === 'string' && VHOST_RE.test(v);
}

/** Gecerli IPv4 -> 0..2^32-1 (bit islemi YOK: 2^31 ustu isaretli olmasin). */
function ipSayi(ip) {
  return ip.split('.').reduce((t, x) => t * 256 + Number(x), 0);
}

function ipMetni(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Tam sayi (sayi ya da rakam metni); degilse null. */
function tamSayi(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^[0-9]{1,9}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function kisaMetin(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > max || KONTROL_KARAKTERI.test(s)) return null;
  return s;
}

function sha256Hex(metin) {
  return crypto.createHash('sha256').update(Buffer.from(String(metin), 'utf8')).digest('hex');
}

// ── SENARYO ───────────────────────────────────────────────────────────────────────────────

/** Parca e-posta mi (eski EPOSTA ifadesiyle ayni karar, dogrusal; alan kismi en cok 253). */
function epostaMi(seg) {
  const s = String(seg);
  const i = s.lastIndexOf('@');
  if (i < 1 || s[i - 1] === '@' || s[i - 1] === '/') return false;
  const alan = s.slice(i + 1);
  return alan.length <= EPOSTA_ALAN_MAX && EPOSTA_ALAN.test(alan);
}

function kisiselVeriSuphesi(yol) {
  for (const seg of String(yol).split('/')) {
    if (!seg) continue;
    if (RAKAM_SEGMENT.test(seg)) return true;
    if (seg.includes('@') && !STATIK_UZANTI.some((u) => seg.toLowerCase().endsWith(u)) && epostaMi(seg)) return true;
  }
  return RAKAM_11.test(String(yol));
}

/** Tek yolu denetler. Donus: '' (gecerli) ya da red sebebi (Turkce, ekranda gosterilir). */
function yolDenetle(yol) {
  if (typeof yol !== 'string' || !yol) return 'yol yok';
  if (yol.length > SINIRLAR.maxYolUzunlugu) return `yol çok uzun (${yol.length} > ${SINIRLAR.maxYolUzunlugu})`;
  if (!BEYAZ_LISTE.test(yol)) return 'yol beyaz listeye uymuyor (sorgu, parça, boşluk ya da ters eğik çizgi olabilir)';
  if (yol.includes(';')) return NOKTALI_VIRGUL_NEDENI;
  if (yol.startsWith('//')) return "yol '//' ile başlıyor";
  if (yol.split('/').some((s) => s === '..')) return "yolda '..' parçası var";
  if (BOZUK_YUZDE.test(yol)) return "yolda bozuk '%' kodlaması var";
  if (KODLU_TEHLIKE.test(yol)) return 'yolda kodlanmış nokta / eğik çizgi / kontrol karakteri var';
  if (kisiselVeriSuphesi(yol)) return 'yolda kişisel veri şüphesi var (6+ haneli parça, e-posta ya da 11 haneli numara)';
  return '';
}

/** Agirlik -> kanonik metin (kos.sh deseni `[0-9.]+`: us YOK). Gecersizse null. */
function agirlikBicim(v) {
  const w = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > 1e9) return null;
  const r = Math.round(w * 1e6) / 1e6;
  if (r <= 0) return null;
  return r.toFixed(6).replace(/\.?0+$/, '');
}

/**
 * Ekrandan gelen satirlardan KANONIK TSV uretir. Basliksiz; her satir
 * `agirlik<TAB>har<TAB>tur<TAB>boyut<TAB>yol`, LF ile biter (kit K.tsv bicimi).
 * Donus: { ok:true, tsv, sha256, yolSayisi, satirSayisi } | red(...)
 */
function senaryoSatirlari(satirlar) {
  if (!Array.isArray(satirlar) || satirlar.length === 0) return red(400, 'gecersiz_istek', 'Senaryoda en az bir satır olmalı.');
  if (satirlar.length > SINIRLAR.maxSatir) {
    return red(409, 'sinir_asildi', `Senaryo en çok ${SINIRLAR.maxSatir} satır olabilir (${satirlar.length} gönderildi).`);
  }
  // Bayt siniri satir denetiminden ONCE: tavani asan govde hic taranmaz. Alt sinir = yol baytlari +
  // satir basina 5 ayirac (4 sekme + LF); kanonik TSV her zaman bundan buyuktur, yani gecerli bir
  // senaryo burada reddedilmez.
  let altSinir = 0;
  for (const s of satirlar) {
    altSinir += (s && typeof s === 'object' && typeof s.yol === 'string' ? Buffer.byteLength(s.yol, 'utf8') : 0) + 5;
  }
  if (altSinir > SINIRLAR.maxTsvBayt) {
    return red(409, 'sinir_asildi', `Senaryo en az ${Math.ceil(altSinir / 1024)} KB; en çok ${SINIRLAR.maxTsvBayt / 1024} KB olabilir.`);
  }
  const hatalar = [];
  const out = [];
  const yollar = new Set();
  satirlar.forEach((s, i) => {
    const no = i + 1;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return void hatalar.push({ satir: no, neden: 'satır nesne değil' });
    const agirlik = agirlikBicim(s.agirlik);
    if (agirlik === null) return void hatalar.push({ satir: no, neden: 'ağırlık pozitif sayı olmalı' });
    const har = tamSayi(s.har);
    if (har === null || har < 0 || har > 999) return void hatalar.push({ satir: no, neden: 'har 0..999 tam sayı olmalı' });
    if (!TURLER.has(s.tur)) return void hatalar.push({ satir: no, neden: 'tür tanınmadı' });
    if (!BOYUTLAR.has(s.boyut)) return void hatalar.push({ satir: no, neden: 'boyut tanınmadı' });
    const neden = yolDenetle(s.yol);
    if (neden) return void hatalar.push({ satir: no, neden });
    yollar.add(s.yol);
    out.push(`${agirlik}\t${har}\t${s.tur}\t${s.boyut}\t${s.yol}`);
  });
  if (hatalar.length) {
    return red(400, 'gecersiz_istek', `${hatalar.length} satır reddedildi: ${hatalar.slice(0, 3).map((h) => `#${h.satir} ${h.neden}`).join('; ')}`, {
      hatalar: hatalar.slice(0, 50),
    });
  }
  const tsv = out.join('\n') + '\n';
  // Son kapi (har_senaryo.py ile ayni): yazilacak her satir yeniden denetlenir.
  for (const satir of out) {
    const yol = satir.split('\t')[4];
    if (satir.split('\t').length !== 5 || !BEYAZ_LISTE.test(yol) || satir.includes('?') || satir.includes('#')) {
      return red(400, 'gecersiz_istek', 'Hazırlanan bir satır son denetimi geçemedi.');
    }
  }
  const bayt = Buffer.byteLength(tsv, 'utf8');
  if (bayt > SINIRLAR.maxTsvBayt) {
    return red(409, 'sinir_asildi', `Senaryo ${Math.ceil(bayt / 1024)} KB; en çok ${SINIRLAR.maxTsvBayt / 1024} KB olabilir.`);
  }
  return { ok: true, tsv, sha256: sha256Hex(tsv), yolSayisi: yollar.size, satirSayisi: out.length };
}

// Ozet: ayristiricinin SAYILARI. Yol ya da serbest metin tasimamali; yine de sinirlanir.
function ozetTemizle(v, derinlik = 0) {
  if (v === null || v === undefined) return { ok: true, deger: null };
  if (derinlik > 4) return { ok: false };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, deger: v } : { ok: false };
  if (typeof v === 'boolean') return { ok: true, deger: v };
  if (typeof v === 'string') return v.length <= 200 && !KONTROL_KARAKTERI.test(v) ? { ok: true, deger: v } : { ok: false };
  if (Array.isArray(v)) {
    if (v.length > 200) return { ok: false };
    const d = [];
    for (const x of v) {
      const r = ozetTemizle(x, derinlik + 1);
      if (!r.ok) return r;
      d.push(r.deger);
    }
    return { ok: true, deger: d };
  }
  if (typeof v === 'object') {
    const anahtarlar = Object.keys(v);
    if (anahtarlar.length > 200) return { ok: false };
    const d = {};
    for (const k of anahtarlar) {
      if (k.length > 80 || KONTROL_KARAKTERI.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return { ok: false };
      const r = ozetTemizle(v[k], derinlik + 1);
      if (!r.ok) return r;
      d[k] = r.deger;
    }
    return { ok: true, deger: d };
  }
  return { ok: false };
}

/** POST /senaryolar govdesi. Donus: { ok:true, deger:{...} } | red(...) */
function senaryoGovdesi(b) {
  const g = b && typeof b === 'object' ? b : {};
  const ad = kisaMetin(g.ad, 120);
  if (!ad) return red(400, 'gecersiz_istek', 'Senaryo adı gerekli (en çok 120 karakter).');
  const aciklama = kisaMetin(g.aciklama, 500);
  if (aciklama === null) return red(400, 'gecersiz_istek', 'Açıklama en çok 500 karakter olabilir.');
  let vhost = null;
  if (g.vhost !== undefined && g.vhost !== null && g.vhost !== '') {
    vhost = String(g.vhost).trim().toLowerCase();
    if (!gecerliVhost(vhost)) return red(400, 'gecersiz_istek', 'vhost geçerli bir ad değil (port, joker, regex yok).');
  }
  if (!SENARYO_TURLERI.has(g.senaryoTur)) return red(400, 'gecersiz_istek', "senaryoTur 'K' ya da 'B' olmalı.");
  if (!KAYNAKLAR.has(g.kaynak)) return red(400, 'gecersiz_istek', "kaynak 'har' ya da 'liste' olmalı.");
  const s = senaryoSatirlari(g.satirlar);
  if (!s.ok) return s;
  const oz = ozetTemizle(g.ozet);
  if (!oz.ok || (oz.deger !== null && (typeof oz.deger !== 'object' || Array.isArray(oz.deger)))) {
    return red(400, 'gecersiz_istek', 'Özet yalnız sayı/kısa metin taşıyan bir nesne olmalı.');
  }
  const ozetJson = oz.deger === null ? null : JSON.stringify(oz.deger);
  if (ozetJson && ozetJson.length > 32 * 1024) return red(409, 'sinir_asildi', 'Özet çok büyük (en çok 32 KB).');
  return {
    ok: true,
    deger: { ad, aciklama: aciklama || null, vhost, senaryoTur: g.senaryoTur, kaynak: g.kaynak, tsv: s.tsv, sha256: s.sha256, yolSayisi: s.yolSayisi, ozet: ozetJson },
  };
}

// ── PARAMETRELER ve BUTCE ─────────────────────────────────────────────────────────────────

/**
 * Sozlesme bolum 3: bosta + kosu_sayisi * (isinma + sure + bosluk + ADIM_EK_SN) + 120 saniye.
 * ADIM_EK_SN: k6 acilisi, setup yol yoklamasi, gracefulStop ve kos.sh'in kendi payi. Playbook
 * yalniz `>= formul (ek paysiz)` diye denetler; ek paysiz butcede 15 adimli kosu timeout'a (rc 124)
 * dusebiliyordu. Adim sayisi motora gore: k6 hizlar, wrk baglantilar (motor'suz eski nesne = k6).
 */
const ADIM_EK_SN = 20;
function adimSayisi(p) {
  const d = p && p.motor === 'wrk' ? p.baglantilar : p && p.hizlar;
  return Array.isArray(d) ? d.length : 0;
}
function butceSn(p) {
  return p.bosta + adimSayisi(p) * p.tekrar * (p.isinma + p.sure + p.bosluk + ADIM_EK_SN) + 120;
}

// Olculmus tavan 0 (limit_req < 2 r/s ya da limit_conn <= 1): "olcum yok" (null) DEGILDIR. Eskiden
// 0 global tavana (450 r/s, 199 VU) dusuyordu: en siki zone korkulugu tamamen kaldiriyordu.
const SIFIR_SINIR_MESAJI = "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz.";

/** rateLimitTavani sonucu bu hedefi yuk testine kapatiyor mu (olculmus 0). */
function sifirSinir(hizSiniri, vuSiniri) {
  return hizSiniri === 0 || vuSiniri === 0;
}

/**
 * Parametreleri denetler ve KANONIK nesneyi dondurur (ayni girdi -> ayni nesne; on kontrol ile
 * kosunun "ayni parametre" kosulu buna dayanir). Tanimsiz alan VARSAYILAN'dan gelir (serbest
 * hedefte hizlar / maxvu VARSAYILAN.serbest'ten).
 * `hizSiniri` / `vuSiniri`: hedefin olculmus rate limitinden daraltilmis tavan (yoksa null; 0 ise
 * hedef yuk testine KAPALI: 409 sinir_asildi).
 * Kanonik nesneler (ilgisiz anahtar GIRMEZ; motor'suz eski nesne k6 sayilir):
 *   k6  { motor:'k6', hizlar, tekrar, isinma, sure, bosluk, bosta, maxvu, kip, ae, sni, butceSn }
 *   wrk { motor:'wrk', baglantilar, is_parcacigi, tavan_rps, tekrar, isinma, sure, bosluk, bosta, kip, ae, sni:false, butceSn }
 * `tavan_rps` girdiden ALINMAZ: sunucu min(450, hizSiniri), serbest min(200, ...). Serbest hedefte
 * iki motorda hiz / tavan <= 200 ve VU / baglanti <= 50.
 */
function parametreler(ham, { sni, hizSiniri = null, vuSiniri = null, hedefTuru = 'sunucu' } = {}) {
  const g = ham && typeof ham === 'object' && !Array.isArray(ham) ? ham : null;
  if (!g) return red(400, 'gecersiz_istek', 'parametreler nesnesi gerekli.');
  if (!HEDEF_TURLERI.includes(hedefTuru)) return red(400, 'gecersiz_istek', "hedefTuru 'sunucu' ya da 'serbest' olmalı.");
  const serbest = hedefTuru === 'serbest';
  const motor = g.motor === undefined ? VARSAYILAN.motor : g.motor;
  if (!MOTORLAR.includes(motor)) return red(400, 'gecersiz_istek', "motor 'k6' ya da 'wrk' olmalı.");
  const wrk = motor === 'wrk';
  const al = (k) => {
    if (g[k] !== undefined) return g[k];
    return serbest && VARSAYILAN.serbest[k] !== undefined ? VARSAYILAN.serbest[k] : VARSAYILAN[k];
  };
  let hizlar = null;
  let baglantilar = null;
  let isParcacigi = null;
  if (!wrk) {
    const hamHizlar = al('hizlar');
    if (!Array.isArray(hamHizlar) || hamHizlar.length === 0) return red(400, 'gecersiz_istek', 'hizlar en az bir değer içermeli.');
    hizlar = hamHizlar.map(tamSayi);
    if (hizlar.some((h) => h === null)) return red(400, 'gecersiz_istek', 'hizlar tam sayı olmalı.');
  } else {
    const hamBaglantilar = al('baglantilar');
    if (!Array.isArray(hamBaglantilar) || hamBaglantilar.length === 0) return red(400, 'gecersiz_istek', 'baglantilar en az bir değer içermeli.');
    baglantilar = hamBaglantilar.map(tamSayi);
    if (baglantilar.some((n) => n === null)) return red(400, 'gecersiz_istek', 'baglantilar tam sayı olmalı.');
    isParcacigi = tamSayi(al('is_parcacigi'));
    if (isParcacigi === null) return red(400, 'gecersiz_istek', 'is_parcacigi tam sayı olmalı.');
  }
  const sayilar = {};
  for (const k of wrk ? ['tekrar', 'isinma', 'sure', 'bosluk', 'bosta'] : ['tekrar', 'isinma', 'sure', 'bosluk', 'bosta', 'maxvu']) {
    sayilar[k] = tamSayi(al(k));
    if (sayilar[k] === null) return red(400, 'gecersiz_istek', `${k} tam sayı olmalı.`);
  }
  const kip = al('kip');
  const ae = al('ae');
  if (!KIPLER.has(kip)) return red(400, 'gecersiz_istek', "kip 'yeni' ya da 'ka' olmalı.");
  if (!AE_DEGERLERI.has(ae)) return red(400, 'gecersiz_istek', "ae 'br', 'gzip' ya da 'identity' olmalı.");
  if (typeof sni !== 'boolean') return red(400, 'gecersiz_istek', 'sni true/false olmalı.');
  // wrk SNI olarak URL'deki IP'yi gonderir: Host basligina gore secemez. Gizli donusum YOK.
  if (wrk && sni) return red(400, 'gecersiz_istek', WRK_SNI_MESAJI);
  if (sifirSinir(hizSiniri, vuSiniri)) return red(409, 'sinir_asildi', SIFIR_SINIR_MESAJI);

  const olculenHiz = Number.isInteger(hizSiniri) && hizSiniri > 0 ? hizSiniri : SINIRLAR.maxHiz;
  const olculenVu = Number.isInteger(vuSiniri) && vuSiniri > 0 ? vuSiniri : SINIRLAR.maxVu;
  const SERBEST_EKI = ', serbest hedef tavanı';
  const asim = [];
  const aralik = (k, min, max, ad, ek = '') => {
    if (sayilar[k] < min || sayilar[k] > max) asim.push(`${ad} ${sayilar[k]} (izinli ${min}..${max}${ek})`);
  };
  let tavanRps = null;
  if (!wrk) {
    const tavanHiz = Math.min(serbest ? SINIRLAR.serbestTavanRps : SINIRLAR.maxHiz, olculenHiz);
    if (hizlar.length > SINIRLAR.maxHizSayisi) asim.push(`en çok ${SINIRLAR.maxHizSayisi} hız`);
    if (new Set(hizlar).size !== hizlar.length) asim.push('aynı hız iki kez');
    for (const h of hizlar) {
      if (h < SINIRLAR.hizMin || h > tavanHiz) {
        asim.push(`hız ${h} izinli aralıkta değil (1..${tavanHiz}${serbest ? SERBEST_EKI : tavanHiz < SINIRLAR.maxHiz ? ', hedefin ölçülmüş limit_req değerinin %90\'ı' : ''})`);
      }
    }
  } else {
    const tavanBaglanti = Math.min(serbest ? SINIRLAR.serbestMaxBaglanti : SINIRLAR.maxBaglanti, Number.isInteger(vuSiniri) && vuSiniri > 0 ? vuSiniri : SINIRLAR.maxBaglanti);
    tavanRps = Math.min(serbest ? SINIRLAR.serbestTavanRps : SINIRLAR.maxHiz, olculenHiz);
    if (baglantilar.length > SINIRLAR.maxBaglantiSayisi) asim.push(`en çok ${SINIRLAR.maxBaglantiSayisi} bağlantı kademesi`);
    if (new Set(baglantilar).size !== baglantilar.length) asim.push('aynı bağlantı sayısı iki kez');
    for (const n of baglantilar) {
      if (n < SINIRLAR.baglantiMin || n > tavanBaglanti) {
        asim.push(`bağlantı ${n} izinli aralıkta değil (1..${tavanBaglanti}${serbest ? SERBEST_EKI : tavanBaglanti < SINIRLAR.maxBaglanti ? ", hedefin ölçülmüş limit_conn değerinin bir eksiği" : ''})`);
      }
    }
    if (isParcacigi < SINIRLAR.isParcacigiMin || isParcacigi > SINIRLAR.maxIsParcacigi) {
      asim.push(`iş parçacığı ${isParcacigi} (izinli ${SINIRLAR.isParcacigiMin}..${SINIRLAR.maxIsParcacigi})`);
    } else {
      // wrk baglantilari c / t tam sayi bolmesiyle dagitir: bolunmeyen sayi TUR adindaki N'yi yalanlar.
      const enKucuk = Math.min(...baglantilar);
      if (isParcacigi > enKucuk) asim.push(`iş parçacığı ${isParcacigi} en küçük bağlantı sayısından (${enKucuk}) büyük`);
      for (const n of baglantilar) {
        if (n % isParcacigi !== 0) asim.push(`bağlantı ${n}, iş parçacığı sayısına (${isParcacigi}) tam bölünmüyor`);
      }
    }
  }
  aralik('tekrar', 1, SINIRLAR.maxTekrar, 'tekrar');
  aralik('isinma', SINIRLAR.isinmaMin, SINIRLAR.isinmaMax, 'ısınma');
  aralik('sure', SINIRLAR.sureMin, SINIRLAR.sureMax, 'süre');
  aralik('bosluk', SINIRLAR.boslukMin, SINIRLAR.boslukMax, 'boşluk');
  aralik('bosta', SINIRLAR.bostaMin, SINIRLAR.bostaMax, 'boşta başlangıç');
  if (!wrk) aralik('maxvu', SINIRLAR.maxVuMin, Math.min(serbest ? SINIRLAR.serbestMaxBaglanti : SINIRLAR.maxVu, olculenVu), 'maxvu', serbest ? SERBEST_EKI : '');
  const p = wrk
    ? { motor: 'wrk', baglantilar, is_parcacigi: isParcacigi, tavan_rps: tavanRps, ...sayilar, kip, ae, sni: false }
    : { motor: 'k6', hizlar, ...sayilar, kip, ae, sni };
  if (!asim.length) {
    const b = butceSn(p);
    if (b > SINIRLAR.maxButceSn) asim.push(`toplam süre ${b} sn > ${SINIRLAR.maxButceSn} sn (hız/tekrar/süre azaltın)`);
  }
  if (asim.length) return red(409, 'sinir_asildi', `Sınır aşıldı: ${asim.join('; ')}.`, { asimlar: asim });
  return { ok: true, deger: { ...p, butceSn: butceSn(p) } };
}

function etiket(v) {
  const e = kisaMetin(v, 120);
  if (e === null) return red(400, 'gecersiz_istek', 'Etiket en çok 120 karakter olabilir.');
  return { ok: true, deger: e || null };
}

// ── ORTAM KAPILARI ────────────────────────────────────────────────────────────────────────

/**
 * Uretim isaretleri: ad kurali DISINDAKI kaynaklar. Biri bile tutarsa kapanir.
 * @param {{host:string, nginxEnv?:string|null, invEnv?:string|null}} k
 */
function uretimIsareti(k) {
  const { uretimIstegi } = require('../opsx/prod-approval.cjs');
  const { internetRpHosts } = require('../audit/nginx-hosts.cjs');
  const s = uretimIstegi([
    { alan: 'dbo.nginx_inventory.env', deger: k.nginxEnv },
    { alan: 'dbo.Inventory.env', deger: k.invEnv },
    { alan: 'sunucu adı', deger: k.host },
  ]);
  if (s.uretim) return s.sebep;
  if (internetRpHosts().byEnv.PROD.includes(k.host)) return 'PROD reverse proxy listesinde';
  return null;
}

/**
 * Hedef kapisi (korkuluk 1). `kaynak`: { nginxSatiri (null = envanterde yok), invEnv }.
 * Donus: { ok:true, env } | red(409, 'hedef_uretim' | 'hedef_envanterde_yok', ...)
 */
function hedefKapisi(host, kaynak) {
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  const env = envOfHost(host);
  if (!IZINLI_ORTAM.has(env)) {
    return red(409, 'hedef_uretim', env === 'PROD'
      ? `${host} üretim sunucusu (ad kuralı); yük testi yalnız DEV/TEST/QA sunucularında yapılır.`
      : `${host} ortamı ${env}; yük testi yalnız DEV/TEST/QA sunucularında yapılır.`, { env });
  }
  if (!kaynak || !kaynak.nginxSatiri) {
    return red(409, 'hedef_envanterde_yok', `${host} nginx envanterinde (dbo.nginx_inventory) yok.`, { env });
  }
  const sebep = uretimIsareti({ host, nginxEnv: kaynak.nginxSatiri.env, invEnv: kaynak.invEnv });
  if (sebep) return red(409, 'hedef_uretim', `${host} için üretim işareti var (${sebep}); yük testi yapılmaz.`, { env });
  return { ok: true, env };
}

/**
 * Yuk makinesi kapisi: izin listesinde, hedeften farkli, ad kuralina gore DEV/TEST/QA, uretim
 * isareti yok ve en az bir envanterde kayitli.
 */
function yukHostKapisi(host, { hedef = null, izinli = [], nginxSatiri = null, invEnv, invVar = false } = {}) {
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  const env = envOfHost(host);
  if (hedef && host === hedef) return red(409, 'ayni_host', 'Yük makinesi hedefle aynı olamaz.', { env });
  if (!izinli.includes(host)) {
    return red(409, 'yuk_host_izinsiz', `${host} yük makinesi izin listesinde değil (NGINX_LOADTEST_YUK_HOSTLARI).`, { env });
  }
  if (!IZINLI_ORTAM.has(env)) return red(409, 'yuk_host_izinsiz', `${host} ortamı ${env}; yük makinesi yalnız DEV/TEST/QA olabilir.`, { env });
  const sebep = uretimIsareti({ host, nginxEnv: nginxSatiri ? nginxSatiri.env : null, invEnv });
  if (sebep) return red(409, 'yuk_host_izinsiz', `${host} için üretim işareti var (${sebep}).`, { env });
  if (!nginxSatiri && !invVar) return red(409, 'yuk_host_izinsiz', `${host} envanterde (dbo.nginx_inventory / dbo.Inventory) yok.`, { env });
  return { ok: true, env };
}

// ── ADAY IP ve VHOST ──────────────────────────────────────────────────────────────────────

// retirement/dns-ip.cjs ipOf ile ayni ayristirma: `10.1.2.3:443 ssl` -> 10.1.2.3; `443` -> ''.
function listenIp(listen) {
  const ilk = String(listen || '').trim().split(/[\s,]+/)[0] || '';
  const i = ilk.lastIndexOf(':');
  return (i > 0 ? ilk.slice(0, i) : ilk.includes('.') ? ilk : '').replace(/^\[|\]$/g, '');
}

// Tarayici (nginx_audit_scan.sh) bir server blogunun TUM listen direktiflerini tek alanda boslukla
// birlestirir (`10.9.0.1:443 ssl http2 10.20.30.40:443 ssl`): her belirtecin IP'si, yalniz gecerli
// IPv4 (ssl / http2 / default_server / 443 / [::] belirtecleri IP uretmez). Ilk belirtece bakmak
// ikinci listen'deki IP'yi sahipsiz gosterirdi (PROD nginx'in VIP'i serbest siniflanirdi).
function listenIpleri(listen) {
  return String(listen || '').trim().split(/[\s,]+/).map((t) => listenIp(t)).filter((ip) => gecerliIpv4(ip));
}

/** Hedefin aday IP'leri: tarama listen IP'leri (her belirtec) + envanter IP'si; yalniz kullanilabilir IPv4. */
function adayIpler({ listenler = [], envanterIp = null } = {}) {
  const set = new Set();
  for (const l of listenler) {
    for (const ip of listenIpleri(l)) if (kullanilabilirIp(ip)) set.add(ip);
  }
  for (const ip of String(envanterIp || '').split(/[\s,;]+/)) if (kullanilabilirIp(ip)) set.add(ip);
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Tarama satirlarinin server_name alanlarindan gecerli vhost adlari (joker/regex/'_' elenir). */
function vhostlar(serverNameleri = []) {
  const set = new Set();
  for (const sn of serverNameleri) {
    for (const ad of String(sn || '').split(/\s+/)) {
      const v = ad.trim().toLowerCase().replace(/;$/, '');
      if (v && gecerliVhost(v) && v !== 'localhost') set.add(v);
    }
  }
  return [...set].sort();
}

function hizDegeri(rate) {
  const m = /^([0-9]+)r\/(s|m)$/i.exec(String(rate || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'm' ? n / 60 : n;
}

/**
 * Hedefin olculmus rate limit tavanlari (dbo.Nginx_Audit_Settings satirlarindan).
 * Tek yuk makinesi TEK IP oldugu icin yalniz IP anahtarli zone'lar sayilir. Uygulanan zone
 * bilgisi varsa yalniz uygulananlar; yoksa tanimli olanlar (temkinli taraf). En kucuk deger.
 * Donus: { hizSiniri: int|null (0.9 x limit_req), vuSiniri: int|null (limit_conn - 1) }. null =
 * olcum yok (global tavan); 0 = olculmus ve izin verilebilir hiz/VU yok (hedef KAPALI, sifirSinir).
 */
function rateLimitTavani(satirlar = []) {
  const { parseReqZone, parseReqApply, parseConnApply } = require('../nginx-console/ratelimit.cjs');
  const ipAnahtari = (v) => v === '$binary_remote_addr' || v === '$remote_addr';
  const reqZone = new Map();
  const connZone = new Set();
  const uygulananReq = new Set();
  const connUygulama = [];
  for (const r of satirlar) {
    const v = String(r.value || '');
    if (r.directive === 'limit_req_zone') {
      const z = parseReqZone(v);
      if (z.name && ipAnahtari(z.variable)) reqZone.set(z.name, hizDegeri(z.rate));
    } else if (r.directive === 'limit_conn_zone') {
      const z = parseReqZone(v);
      if (z.name && ipAnahtari(z.variable)) connZone.add(z.name);
    } else if (r.directive === 'limit_req') {
      const a = parseReqApply(v);
      if (a.name) uygulananReq.add(a.name);
    } else if (r.directive === 'limit_conn') {
      const a = parseConnApply(v);
      if (a.name && a.conn != null) connUygulama.push(a);
    }
  }
  const adaylar = [...reqZone.entries()]
    .filter(([ad, hiz]) => hiz != null && (uygulananReq.size === 0 || uygulananReq.has(ad)))
    .map(([, hiz]) => hiz);
  const enKucukHiz = adaylar.length ? Math.min(...adaylar) : null;
  const conn = connUygulama.filter((a) => connZone.has(a.name)).map((a) => a.conn);
  const enKucukConn = conn.length ? Math.min(...conn) : null;
  return {
    hizSiniri: enKucukHiz == null ? null : Math.max(0, Math.floor(enKucukHiz * 0.9)),
    vuSiniri: enKucukConn == null ? null : Math.max(0, enKucukConn - 1),
  };
}

// ── ON KONTROL DEGERLENDIRMESI (korkuluk 5) ───────────────────────────────────────────────

const EVET = (v) => v === true || (typeof v === 'string' && ['true', 'yes', '1'].includes(v.trim().toLowerCase()));
const HAYIR = (v) => v === false || (typeof v === 'string' && ['false', 'no', '0'].includes(v.trim().toLowerCase()));
const SAYI = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * On kontrol ozeti (set_stats on_kontrol) -> { engeller, uyarilar }. Tur ve motor HER ZAMAN kosu
 * SATIRINDAN gelir (set_stats yankisindan degil).
 * ENGEL: kosu bu on kontrolle baslatilamaz (IP hedefte yerel degil, yuk araci yok, /web_log
 * okunamiyor, hic yol denenmemis, nginx master sayisi olculmus ve 1 degil; serbestte IP yuk
 * makinesinde yerel ya da olculemedi). UYARI: acik onay (uyariOnay) ister.
 * k6 + sunucu: cikti (listeler ve SIRALARI) tur 2 ile BIREBIR; TEK istisna D7: server_name
 * olcumu (false ya da null) ENGEL degil, listenin BASINDA uyari (joker / regex server_name).
 * Serbest: hedef kurallari (ip_yerel, server_name, log dizini, master, df, log_format) yok; yollar
 * ve sikistirma iki kipte ayni (yuk makinesi tarafi). Sabit uyarilar listenin sonunda.
 */
function onKontrolDegerlendir(ok, { hedefTuru = 'sunucu', motor = 'k6' } = {}) {
  const engeller = [];
  const uyarilar = [];
  if (!ok || typeof ok !== 'object') return { engeller: ['ön kontrol sonucu okunamadı'], uyarilar };
  if (!HEDEF_TURLERI.includes(hedefTuru) || !MOTORLAR.includes(motor)) {
    return { engeller: ['ön kontrol sonucu okunamadı (hedef türü ya da yük aracı tanınmadı)'], uyarilar };
  }
  const serbest = hedefTuru === 'serbest';
  if (serbest) {
    if (!HAYIR(ok.ip_yuk_makinesinde)) engeller.push('hedef IP yük makinesinde yerel ya da ölçülemedi');
  } else {
    if (!EVET(ok.ip_yerel)) engeller.push('seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)');
    if (!EVET(ok.server_name_var)) uyarilar.push(HOST_LISTEDE_YOK_UYARISI);
  }
  if (motor === 'wrk') {
    if (!EVET(ok.wrk_var)) {
      engeller.push(EVET(ok.wrk_calisiyor)
        ? `wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında (${ok.wrk_surum || '-'}); wrk'yi make VER=4.2.0 ile yeniden derleyin`
        : 'wrk yük makinesinde bulunamadı ya da çalıştırılamıyor');
    }
  } else if (!EVET(ok.k6_var)) engeller.push('k6 yük makinesinde bulunamadı');
  // CPU kaydedici /web_log'u okuyamazsa sunucu tarafi olcum yok: playbook bunu ENGEL sayar.
  if (!serbest && HAYIR(ok.log_dizini_okunur)) engeller.push('log dizini /web_log okunamıyor');
  const toplam = SAYI(ok.yollar_toplam);
  const iki = SAYI(ok.yollar_200);
  if (!(toplam > 0)) engeller.push('ön kontrolde hiçbir yol denenmedi');
  else if (iki === null) uyarilar.push('200 dönen yol sayısı ölçülemedi');
  else if (iki < toplam) uyarilar.push(`${toplam - iki}/${toplam} yol 200 dönmedi`);
  const statik = SAYI(ok.sikistirma && ok.sikistirma.statik);
  if (statik > 0) uyarilar.push(`hedefte ön-sıkıştırılmış dosyalar var (${statik} yol)`);
  if (!serbest) {
    const df = SAYI(ok.web_log_df);
    if (df === null) uyarilar.push('/web_log doluluğu ölçülemedi');
    else if (df >= 65) uyarilar.push(`/web_log %${df} dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)`);
    if (HAYIR(ok.log_format_ua)) uyarilar.push("etkin log_format'ta user-agent= yok: sunucu tarafı ölçüm eksik kalır");
    // cpu_kaydedici.sh 0 ya da 1'den fazla master gorurse baslamaz: olculmus != 1 ENGEL, olculemedi UYARI.
    const master = SAYI(ok.master_sayisi);
    if (master === null) uyarilar.push('nginx master süreç sayısı ölçülemedi (1 bekleniyor)');
    else if (master !== 1) engeller.push(`nginx master süreç sayısı ${master} (1 bekleniyor; CPU kaydedici bu durumda başlamaz)`);
  }
  if (serbest) uyarilar.push(SERBEST_UYARISI);
  if (motor === 'wrk') uyarilar.push(WRK_UYARISI);
  return { engeller, uyarilar };
}

/** Onay metni: sunucu hedefinde hedef host adi, serbest hedefte hedef IP (birebir, kirpilmis). */
function onayMetniDogru(confirmText, beklenen) {
  return typeof beklenen === 'string' && beklenen !== '' && typeof confirmText === 'string' && confirmText.trim() === beklenen;
}

// ── ORTAM DEGISKENLERI ────────────────────────────────────────────────────────────────────

/** Yuk makinesi izin listesi. Bos/tanimsiz -> varsayilan; gecersiz girdiler atilir (liste daralir). */
function yukHostlari(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_YUK_HOSTLARI ?? '').trim();
  if (!ham) return [...VARSAYILAN_YUK_HOSTLARI];
  return [...new Set(ham.split(/[\s,;]+/).map(hostNormalle).filter(Boolean))];
}

function yolGuvenli(v, re) {
  return typeof v === 'string' && re.test(v) && !v.split('/').includes('..');
}

function k6Yolu(env = process.env) {
  const v = String(env.NGINX_LOADTEST_K6 ?? '').trim();
  if (!v) return VARSAYILAN_K6;
  if (yolGuvenli(v, K6_YOLU_RE)) return v;
  console.warn('[NginxYukTesti] NGINX_LOADTEST_K6 gecersiz, varsayilan kullaniliyor');
  return VARSAYILAN_K6;
}

/** Yuk makinesinde wrk yolu (k6Yolu ile ayni kural; playbook iki yolu da ayni desenle denetler). */
function wrkYolu(env = process.env) {
  const v = String(env.NGINX_LOADTEST_WRK ?? '').trim();
  if (!v) return VARSAYILAN_WRK;
  if (yolGuvenli(v, K6_YOLU_RE)) return v;
  console.warn('[NginxYukTesti] NGINX_LOADTEST_WRK gecersiz, varsayilan kullaniliyor');
  return VARSAYILAN_WRK;
}

// ── SERBEST HEDEF AG LISTELERI (Portal env; playbook'a GONDERILMEZ - extra_var ezilebilirdi) ──

// Ayni ham girdi icin tek uyari (liste her istekte yeniden okunur; log tasmasin).
const _uyarilanGirdiler = new Set();
function birKezUyar(degisken, ham, neden, sonuc = 'kullanilmadi') {
  const anahtar = `${degisken}|${ham}`;
  if (_uyarilanGirdiler.has(anahtar) || _uyarilanGirdiler.size >= 1000) return;
  _uyarilanGirdiler.add(anahtar);
  console.warn(`[NginxYukTesti] ${degisken} girdisi ${sonuc} (${neden}): ${JSON.stringify(String(ham)).slice(0, 80)}`);
}

/**
 * `a.b.c.d/n` ya da tek IPv4 (= /32) -> { ok:true, ag } | { ok:false, neden }. Host bitli girdi
 * (10.1.2.3/24) NORMALLESTIRILMEZ, reddedilir: yazanin niyeti belirsizdir.
 */
function agGirdisiCoz(ham, minOnek) {
  const m = /^([0-9.]{7,15})(?:\/([0-9]{1,2}))?$/.exec(ham);
  if (!m || !gecerliIpv4(m[1])) return { ok: false, neden: 'bicimsiz' };
  const onek = m[2] === undefined ? 32 : Number(m[2]);
  if (onek > 32 || (m[2] !== undefined && m[2] !== String(onek))) return { ok: false, neden: 'bicimsiz' };
  if (onek < minOnek) return { ok: false, neden: `onek /${onek} < /${minOnek}` };
  const ag = ipSayi(m[1]);
  const blok = 2 ** (32 - onek);
  if (ag % blok !== 0) return { ok: false, neden: 'host bitleri dolu' };
  return {
    ok: true,
    ag: Object.freeze({
      metin: `${m[1]}/${onek}`, ag, maske: onek === 0 ? 0 : (0xffffffff << (32 - onek)) >>> 0, onek, agAdresi: m[1], yayin: ipMetni(ag + blok - 1),
    }),
  };
}

/**
 * Serbest hedef IZIN listesi (NGINX_LOADTEST_SERBEST_AGLAR; virgul / bosluk / ';' ayrik CIDR ya
 * da tek IP). Atilan girdi (bicimsiz, /24'ten genis, host bitli, ag adresi kullanilamaz) listeyi
 * DARALTIR (fail-closed); tekillestirilir, en cok 64. Bos liste = serbest hedef KAPALI.
 * Donus: [{ metin, ag, maske, onek, agAdresi, yayin }]
 */
function serbestAglar(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_SERBEST_AGLAR ?? '').trim();
  if (!ham) return [];
  const out = [];
  const gorulen = new Set();
  for (const girdi of ham.split(/[\s,;]+/).filter(Boolean)) {
    const r = agGirdisiCoz(girdi, SINIRLAR.serbestMinOnek);
    const neden = !r.ok ? r.neden : !kullanilabilirIp(r.ag.agAdresi) ? 'ag adresi kullanilamaz (0/8, 127/8, 169.254/16, 224+)' : null;
    if (neden) {
      birKezUyar('NGINX_LOADTEST_SERBEST_AGLAR', girdi, neden);
      continue;
    }
    if (gorulen.has(r.ag.metin)) continue;
    gorulen.add(r.ag.metin);
    if (out.length >= 64) {
      birKezUyar('NGINX_LOADTEST_SERBEST_AGLAR', girdi, 'en cok 64 girdi');
      continue;
    }
    out.push(r.ag);
  }
  return out;
}

/**
 * Serbest hedef YASAK listesi (NGINX_LOADTEST_SERBEST_YASAK; ayni bicim, onek 0..32 - genis yasak
 * guvenlidir). Gecersiz girdi ATILMAZ, `hatali`ya girer: yasak listesinde atmak fail-OPEN olurdu;
 * tek gecersiz girdi tum yuk testini kapatir (ipSinifla, iki kipte). Donus: { liste, hatali }.
 */
function serbestYasak(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_SERBEST_YASAK ?? '').trim();
  const liste = [];
  const hatali = [];
  if (!ham) return { liste, hatali };
  const gorulen = new Set();
  for (const girdi of ham.split(/[\s,;]+/).filter(Boolean)) {
    const r = agGirdisiCoz(girdi, 0);
    if (!r.ok) {
      birKezUyar('NGINX_LOADTEST_SERBEST_YASAK', girdi, r.neden, 'gecersiz, liste duzeltilene kadar yuk testi kapali');
      hatali.push(girdi);
      continue;
    }
    if (gorulen.has(r.ag.metin)) continue;
    gorulen.add(r.ag.metin);
    liste.push(r.ag);
  }
  return { liste, hatali };
}

/** IP agin icinde mi (saf). Gecersiz IP / ag -> false. */
function agIcinde(ip, a) {
  if (!gecerliIpv4(ip) || !a || !Number.isInteger(a.onek) || a.onek < 0 || a.onek > 32 || !Number.isFinite(a.ag)) return false;
  const blok = 2 ** (32 - a.onek);
  return Math.floor(ipSayi(ip) / blok) === Math.floor(a.ag / blok);
}

/** IP'yi kapsayan ilk izinli ag; /30 ve altinda ag ve yayin adresi hedef olamaz (/31, /32 serbest). */
function serbestAgBul(ip, aglar) {
  return (Array.isArray(aglar) ? aglar : []).find((a) => agIcinde(ip, a) && !(a.onek <= 30 && (ip === a.agAdresi || ip === a.yayin))) || null;
}

function ciktiKok(env = process.env) {
  const v = String(env.NGINX_LOADTEST_DIR ?? '').trim().replace(/\/+$/, '');
  if (!v) return VARSAYILAN_CIKTI_KOK;
  if (yolGuvenli(v, CIKTI_KOK_RE)) return v;
  console.warn('[NginxYukTesti] NGINX_LOADTEST_DIR gecersiz, varsayilan kullaniliyor');
  return VARSAYILAN_CIKTI_KOK;
}

/** Kosunun /sw dizini. Yol ISTEMCIDEN ya da artifact'tan DEGIL, buradan gelir. */
function kosuDizini(kok, kosuId) {
  return `${kok}/${Number(kosuId)}`;
}

// ── EXTRA_VARS ────────────────────────────────────────────────────────────────────────────

// Sozlesme bolum 3: gonderilen TUM anahtarlar (fazlasi ve eksigi son kapida reddedilir). Tur 2'nin
// 23 anahtari aynen, ardindan tur 3'un 7 anahtari (sira playbook README tablosuyla ayni).
const EKSTRA_ANAHTARLAR = Object.freeze([
  'yuk_islem', 'yuk_run_id', 'yuk_hedef_host', 'yuk_yuk_host', 'yuk_hedef_ip', 'yuk_host_basligi', 'yuk_sni',
  'yuk_senaryo_tur', 'yuk_senaryo_b64', 'yuk_senaryo_sha256', 'yuk_hizlar', 'yuk_tekrar', 'yuk_kip', 'yuk_ae',
  'yuk_isinma_sn', 'yuk_sure_sn', 'yuk_bosluk_sn', 'yuk_bosta_bas_sn', 'yuk_maxvu', 'yuk_butce_sn', 'yuk_k6_yolu',
  'yuk_ua_onek', 'yuk_cikti_kok',
  'yuk_hedef_turu', 'yuk_motor', 'yuk_baglantilar', 'yuk_is_parcacigi', 'yuk_wrk_yolu', 'yuk_tavan_rps', 'yuk_son_epoch',
]);

/**
 * Sozlesme bolum 3 alan listesi; hepsi METIN. `limit` her zaman ''. Serbest hedefte
 * yuk_hedef_host ''. Motorun ilgisiz alanlari '' (k6: baglantilar / is_parcacigi / tavan_rps; wrk:
 * hizlar / maxvu). yuk_son_epoch = simdi + isGecerlilikSn: AWX'ten sonradan yeniden baslatma
 * (Relaunch) playbook kapisinda reddedilir. Durdur eski (motor'suz) satirdan da kurulur: k6.
 */
function ekstraDegiskenler({ islem, kosuId, hedefHost, yukHost, hedefIp, vhost, senaryo, p, k6, ua = UA_ONEK, kok, hedefTuru = 'sunucu', wrk = wrkYolu(), simdiSn = Math.floor(Date.now() / 1000) }) {
  const wrkMi = p.motor === 'wrk';
  const liste = (v) => (Array.isArray(v) ? v.join(' ') : '');
  return {
    yuk_islem: islem,
    yuk_run_id: String(kosuId),
    yuk_hedef_host: hedefTuru === 'serbest' ? '' : hedefHost,
    yuk_yuk_host: yukHost,
    yuk_hedef_ip: hedefIp,
    yuk_host_basligi: vhost,
    yuk_sni: p.sni ? '1' : '0',
    yuk_senaryo_tur: senaryo.tur,
    yuk_senaryo_b64: Buffer.from(senaryo.tsv, 'utf8').toString('base64'),
    yuk_senaryo_sha256: senaryo.sha256,
    yuk_hizlar: wrkMi ? '' : liste(p.hizlar),
    yuk_tekrar: String(p.tekrar),
    yuk_kip: p.kip,
    yuk_ae: p.ae,
    yuk_isinma_sn: String(p.isinma),
    yuk_sure_sn: String(p.sure),
    yuk_bosluk_sn: String(p.bosluk),
    yuk_bosta_bas_sn: String(p.bosta),
    yuk_maxvu: wrkMi ? '' : String(p.maxvu),
    yuk_butce_sn: String(butceSn(p)),
    yuk_k6_yolu: k6,
    yuk_ua_onek: ua,
    yuk_cikti_kok: kok,
    yuk_hedef_turu: hedefTuru,
    yuk_motor: wrkMi ? 'wrk' : 'k6',
    yuk_baglantilar: wrkMi ? liste(p.baglantilar) : '',
    yuk_is_parcacigi: wrkMi ? String(p.is_parcacigi) : '',
    yuk_wrk_yolu: wrk,
    yuk_tavan_rps: wrkMi ? String(p.tavan_rps) : '',
    yuk_son_epoch: String(Math.floor(simdiSn) + SINIRLAR.isGecerlilikSn),
  };
}

/**
 * Baslatmadan hemen once SON KAPI: gonderilecek degiskenler playbook assert'leriyle (sozlesme
 * bolum 3, playbook kapisi = Portal son kapisi) ayni kurallardan gecer; "on_kontrol, kosu"
 * satirlari durdur kipinde DENETLENMEZ (playbook da denetlemez: durdur eski satirdan kurulur ve
 * yuku durdurmanin yolu kapanmamali). Donus: ihlal listesi (bos = gecerli).
 */
function ekstraDegiskenleriDenetle(ev, { simdiSn = Math.floor(Date.now() / 1000) } = {}) {
  const ihlal = [];
  const metin = (k) => typeof ev[k] === 'string';
  const sayi = (k) => (metin(k) && SAYI_RE.test(ev[k]) ? Number(ev[k]) : null);
  const aralik = (k, min, max) => {
    const n = sayi(k);
    if (n === null || n < min || n > max) ihlal.push(k);
  };
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  // Ad kurali GBNG[WX]A?[DTQ] + EDU degil: envOfHost DEV/TEST/QA (playbook yt_re_nonprod_adi + yt_edu_hostlari).
  const nonProdAd = (h) => HOST_RE.test(h) && IZINLI_ORTAM.has(envOfHost(h));
  if (!ISLEMLER.has(ev.yuk_islem)) ihlal.push('yuk_islem');
  if (!metin('yuk_run_id') || !RUN_ID_RE.test(ev.yuk_run_id)) ihlal.push('yuk_run_id');
  const durdur = ev.yuk_islem === 'durdur';
  // Yalniz durdur kipinde YOKSA sunucu sayilir (eski Portal'in durdurmasi); eksik anahtar yine asagida.
  const tur = ev.yuk_hedef_turu === undefined && durdur ? 'sunucu' : ev.yuk_hedef_turu;
  if (!HEDEF_TURLERI.includes(tur)) ihlal.push('yuk_hedef_turu');
  const serbest = tur === 'serbest';
  if (serbest ? ev.yuk_hedef_host !== '' : !(metin('yuk_hedef_host') && nonProdAd(ev.yuk_hedef_host))) ihlal.push('yuk_hedef_host');
  if (!metin('yuk_yuk_host') || !nonProdAd(ev.yuk_yuk_host) || ev.yuk_yuk_host === ev.yuk_hedef_host) ihlal.push('yuk_yuk_host');
  if (!durdur) {
    if (!MOTORLAR.includes(ev.yuk_motor)) ihlal.push('yuk_motor');
    const wrk = ev.yuk_motor === 'wrk';
    if (!kullanilabilirIp(ev.yuk_hedef_ip)) ihlal.push('yuk_hedef_ip');
    if (!gecerliVhost(ev.yuk_host_basligi)) ihlal.push('yuk_host_basligi');
    if (ev.yuk_sni !== '0' && (ev.yuk_sni !== '1' || wrk)) ihlal.push('yuk_sni');
    if (!SENARYO_TURLERI.has(ev.yuk_senaryo_tur)) ihlal.push('yuk_senaryo_tur');
    let tsv = null;
    if (!metin('yuk_senaryo_b64') || !/^[A-Za-z0-9+/]+={0,2}$/.test(ev.yuk_senaryo_b64)) ihlal.push('yuk_senaryo_b64');
    else {
      tsv = Buffer.from(ev.yuk_senaryo_b64, 'base64').toString('utf8');
      const satirlar = tsv.split('\n').filter((s) => s !== '');
      const bozuk = satirlar.some((s) => {
        const k = s.split('\t');
        return k.length !== 5 || yolDenetle(k[4]) !== '' || /[?#\\]/.test(s);
      });
      if (Buffer.byteLength(tsv, 'utf8') > SINIRLAR.maxTsvBayt || !satirlar.length || satirlar.length > SINIRLAR.maxSatir || bozuk) ihlal.push('yuk_senaryo_b64');
    }
    if (!metin('yuk_senaryo_sha256') || !SHA256_RE.test(ev.yuk_senaryo_sha256) || (tsv !== null && sha256Hex(tsv) !== ev.yuk_senaryo_sha256)) {
      ihlal.push('yuk_senaryo_sha256');
    }
    const kademeler = (k, max) => {
      if (!metin(k) || !HIZLAR_RE.test(ev[k])) return null;
      const d = ev[k].split(' ').map(Number);
      return d.some((n) => n < 1 || n > max) ? null : d;
    };
    // k6 adimlari (wrk'de bos).
    if (wrk) {
      if (ev.yuk_hizlar !== '') ihlal.push('yuk_hizlar');
      if (ev.yuk_maxvu !== '') ihlal.push('yuk_maxvu');
    } else {
      if (!kademeler('yuk_hizlar', serbest ? SINIRLAR.serbestTavanRps : SINIRLAR.maxHiz)) ihlal.push('yuk_hizlar');
      aralik('yuk_maxvu', SINIRLAR.maxVuMin, serbest ? SINIRLAR.serbestMaxBaglanti : SINIRLAR.maxVu);
    }
    // wrk adimlari (k6'da bos): baglantilar tekil, is parcacigi en kucuk baglantiyi asmaz ve her birini boler.
    if (!wrk) {
      for (const k of ['yuk_baglantilar', 'yuk_is_parcacigi', 'yuk_tavan_rps']) if (ev[k] !== '') ihlal.push(k);
    } else {
      const b = kademeler('yuk_baglantilar', serbest ? SINIRLAR.serbestMaxBaglanti : SINIRLAR.maxBaglanti);
      if (!b || new Set(b).size !== b.length) ihlal.push('yuk_baglantilar');
      const t = sayi('yuk_is_parcacigi');
      if (t === null || t < SINIRLAR.isParcacigiMin || t > SINIRLAR.maxIsParcacigi || (b && (t > Math.min(...b) || b.some((n) => n % t !== 0)))) {
        ihlal.push('yuk_is_parcacigi');
      }
      aralik('yuk_tavan_rps', 1, serbest ? SINIRLAR.serbestTavanRps : SINIRLAR.maxHiz);
    }
    aralik('yuk_tekrar', 1, SINIRLAR.maxTekrar);
    if (!KIPLER.has(ev.yuk_kip)) ihlal.push('yuk_kip');
    if (!AE_DEGERLERI.has(ev.yuk_ae)) ihlal.push('yuk_ae');
    aralik('yuk_isinma_sn', SINIRLAR.isinmaMin, SINIRLAR.isinmaMax);
    aralik('yuk_sure_sn', SINIRLAR.sureMin, SINIRLAR.sureMax);
    aralik('yuk_bosluk_sn', SINIRLAR.boslukMin, SINIRLAR.boslukMax);
    aralik('yuk_bosta_bas_sn', SINIRLAR.bostaMin, SINIRLAR.bostaMax);
    // Is gecerlilik suresi: simdi <= deger <= simdi + 1800 (Portal simdi + 900 gonderir).
    const epoch = metin('yuk_son_epoch') && EPOCH_RE.test(ev.yuk_son_epoch) ? Number(ev.yuk_son_epoch) : null;
    if (epoch === null || epoch < simdiSn || epoch > simdiSn + SON_EPOCH_UST_PAY_SN) ihlal.push('yuk_son_epoch');
    // Butce: <= 2700 ve >= bosta + adim_sayisi * tekrar * (isinma + sure + bosluk) + 120 (ek paysiz formul).
    const butce = sayi('yuk_butce_sn');
    const adimlar = metin(wrk ? 'yuk_baglantilar' : 'yuk_hizlar') ? ev[wrk ? 'yuk_baglantilar' : 'yuk_hizlar'].split(' ').length : NaN;
    const altSinir = Number(ev.yuk_bosta_bas_sn) + adimlar * Number(ev.yuk_tekrar) * (Number(ev.yuk_isinma_sn) + Number(ev.yuk_sure_sn) + Number(ev.yuk_bosluk_sn)) + 120;
    if (butce === null || butce < 1 || butce > SINIRLAR.maxButceSn || !(butce >= altSinir)) ihlal.push('yuk_butce_sn');
    if (!yolGuvenli(ev.yuk_k6_yolu, K6_YOLU_RE)) ihlal.push('yuk_k6_yolu');
    if (!yolGuvenli(ev.yuk_wrk_yolu, K6_YOLU_RE)) ihlal.push('yuk_wrk_yolu');
    if (!metin('yuk_ua_onek') || !UA_ONEK_RE.test(ev.yuk_ua_onek)) ihlal.push('yuk_ua_onek');
    if (!yolGuvenli(ev.yuk_cikti_kok, CIKTI_KOK_RE)) ihlal.push('yuk_cikti_kok');
  }
  // Bilinmeyen anahtar gonderilmez (LIMIT_MUAF, proxy degiskenleri, ...); eksik anahtar da yok.
  for (const k of Object.keys(ev)) if (!EKSTRA_ANAHTARLAR.includes(k)) ihlal.push(k);
  for (const k of EKSTRA_ANAHTARLAR) if (!(k in ev) && !ihlal.includes(k)) ihlal.push(k);
  return ihlal;
}

/** ansible_job_history icin: senaryo govdesi yerine boyut izi (nginx-console content_b64 deseni). */
function gecmisIcinMaskele(ev) {
  const o = { ...ev };
  if (typeof o.yuk_senaryo_b64 === 'string') o.yuk_senaryo_b64 = `<${o.yuk_senaryo_b64.length} b64>`;
  return o;
}

// ── KAYNAKLAR (TBMWANS) ───────────────────────────────────────────────────────────────────

/** `@h0,@h1,...` + parametreler; en cok 500 deger (SQL Server 2100 parametre siniri). */
function inListesi(onek, degerler, sql) {
  const d = [...new Set(degerler)].slice(0, 500);
  return {
    sqlText: d.map((_, i) => `@${onek}${i}`).join(','),
    params: d.map((v, i) => ({ name: `${onek}${i}`, type: sql.NVarChar(64), value: v })),
    bos: d.length === 0,
  };
}

const okunamadi = (kaynak, e) =>
  Object.assign(new Error(`${kaynak} okunamadı: ${(e && e.message) || e}`), { status: 424, code: 'envanter_okunamadi' });

/** Sahiplik kaynaklarindaki ad -> kisa host adi (FQDN alani atilir); gecersizse ''. */
function sahipAdi(v) {
  return hostNormalle(String(v ?? '').trim().split('.')[0]);
}

/** MSSQL tam sayi sonucu -> sayi ya da null (olculmedi). */
function tamSayiYaDaNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// TARAMA GUNU (2026-10-28 inceleme): nginx_audit_analyze.py gunu temizlikten SONRA 5000 satirlik commit'li
// partilerle yazar (Hosts -> Servers -> Locations -> Upstreams -> Settings -> Files); saklama bugun + dun.
// Yukleme surerken (yarida dustuyse butun gun) MAX(scan_date) YARIM gundur, bir onceki gun tamdir. Okuma:
// sahiplik ve server_name adlari son IKI tarama gununun birlesimi (fazla sahip / uretim adi tutucu yon;
// non-prod ad yalniz hostun en son gununden: bayat ad uretim engelini kaldirmasin); hedef satirlari ve
// limitler her hostun bu iki gun icindeki EN SON gunu (henuz yazilmamis host dunku tam verisine duser).
// Tazelik (taramaYasGun) MAX(scan_date) uzerinde kalir. Indeks dostu: IX_NgxAS_scan / IX_NgxASt_scan
// (scan_date, host) seek; Settings'te tam tablo taramasi yok (gun seek'i + host basina EXISTS seek'i).
const SON_IKI_TARAMA_GUNU = 'DATEADD(day, -1, (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers))';
const LIMIT_DIREKTIFLERI = "('limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn')";

/** Tarama satirinin gunu (CONVERT 23: 'YYYY-MM-DD') -> metin; '' = bilinmiyor (hepsi ayni gun sayilir). */
function gunMetni(v) {
  return v == null ? '' : String(v).slice(0, 10);
}

/** Satirlar -> Map(anahtar -> en son gun); bos anahtar atlanir. */
function enSonGunler(satirlar, anahtar) {
  const m = new Map();
  for (const x of satirlar) {
    const a = anahtar(x);
    if (!a) continue;
    const g = gunMetni(x.gun);
    if (!m.has(a) || g > m.get(a)) m.set(a, g);
  }
  return m;
}

/**
 * Kapilarin ihtiyac duydugu TBMWANS verisi. `hostlar`: verilirse yalniz bu hostlar icin tarama
 * satirlari okunur (baslatma yolu); verilmezse envanterdeki tum non-prod hostlar (/hedefler).
 * Tablo YOKSA (OBJECT_ID null) o kaynak "veri yok" sayilir; sorgu HATASI 424'tur.
 * `ip` verilirse IP'nin SAHIPLERI de okunur (sozlesme 8.1; hepsi parametreli, IP SQL metnine
 * GOMULMEZ): nginx_inventory ip kolonu, dbo.Inventory ip, dbo.IPInventory (tireli host onarimi),
 * son IKI taramanin listen'lari (her belirtec); IPInventory ve tarama tazeligi. Bulunan sahipler
 * tarama / limit / Inventory env okumasina da girer. `vhost` verilirse son iki taramanin TUM
 * server_name'leri (taramaAdlari; Host basligi uretim kapisi). Tarama ve limit satirlari her hostun
 * son iki tarama gunu icindeki EN SON gunundendir (SON_IKI_TARAMA_GUNU). `ip` ve `vhost` verilmezse
 * kaynaklar ve sirasi tur 2 ile AYNI (tarama / limit sorgulari iki gunluk pencereyle).
 * Donus: { nginx: Map(host -> satir), inv: Map(host -> env), sunucular: Map(host -> {listen[], serverName[]})|null,
 *          ayarlar: Map(host -> satir[])|null, ipSahipleri: Map(host -> Set(kaynak)), ipTaninmayan: kaynak[],
 *          taramaVar, ipEnvanteriVar, ipEnvanteriYasSaat, ipEnvanteriSon, taramaYasGun, taramaSon,
 *          taramaAdlari: [{host, server_name, guncel}]|null (yalniz vhost verildiyse) }
 */
async function kaynaklariOku({ query, sql, hostlar = null, ekHostlar = [], ip = null, vhost = null }) {
  if (ip !== null && ip !== undefined && !gecerliIpv4(ip)) {
    throw Object.assign(new Error('hedefIp noktalı IPv4 olmalı.'), { status: 400, code: 'gecersiz_istek' });
  }
  const ipModu = ip !== null && ip !== undefined;
  let nginxSatirlari;
  try {
    nginxSatirlari = (await query(`SELECT hostname, env, ip, service FROM dbo.nginx_inventory`)).recordset || [];
  } catch (e) {
    throw okunamadi('dbo.nginx_inventory', e);
  }
  // TRUNCATE + yeniden yukleme: bos tablo "envanterde yok" DEGIL, "su an okunamiyor"dur.
  if (!nginxSatirlari.length) throw okunamadi('dbo.nginx_inventory', new Error('tablo boş (yeniden yükleniyor olabilir)'));
  const nginx = new Map();
  for (const r of nginxSatirlari) {
    const h = hostNormalle(r.hostname);
    if (h && !nginx.has(h)) nginx.set(h, { host: h, env: r.env == null ? null : String(r.env), ip: r.ip == null ? null : String(r.ip), service: r.service || null });
  }
  const { envOfHost } = require('../audit/nginx-hosts.cjs');

  const tabloVar = async (ad) => {
    try {
      const r = await query(`SELECT OBJECT_ID('${ad}') AS oid`);
      return !!(r.recordset && r.recordset[0] && r.recordset[0].oid);
    } catch (e) {
      throw okunamadi(ad, e);
    }
  };
  const ilkSatir = async (kaynak, metin) => {
    try {
      return ((await query(metin)).recordset || [])[0] || {};
    } catch (e) {
      throw okunamadi(kaynak, e);
    }
  };

  // ── IP SAHIPLIGI (yalniz ip verildiginde) ──
  const inv = new Map();
  const ipSahipleri = new Map();
  const ipTaninmayan = [];
  const sahipEkle = (ham, kaynak) => {
    const h = sahipAdi(ham);
    if (!h) {
      // Adi cozulemeyen satir: IP'nin sahibi bilinmiyor (fail-closed: ipSinifla reddeder).
      if (!ipTaninmayan.includes(kaynak)) ipTaninmayan.push(kaynak);
      return null;
    }
    if (!ipSahipleri.has(h)) ipSahipleri.set(h, new Set());
    ipSahipleri.get(h).add(kaynak);
    return h;
  };
  const ipParam = (ad, deger) => [{ name: ad, type: sql.NVarChar(64), value: deger }];
  let taramaVarMi = null;
  const taramaTablosu = async () => (taramaVarMi === null ? (taramaVarMi = await tabloVar('dbo.Nginx_Audit_Servers')) : taramaVarMi);
  let ipEnvanteriVar = false;
  let ipEnvanteriYasSaat = null;
  let ipEnvanteriSon = null;
  let taramaYasGun = null;
  let taramaSon = null;
  if (ipModu) {
    for (const r of nginxSatirlari) {
      if (String(r.ip ?? '').trim().split(/[\s,;]+/).includes(ip)) sahipEkle(r.hostname, 'dbo.nginx_inventory');
    }
    try {
      const r = await query(`SELECT host, env, ip FROM dbo.Inventory WHERE LTRIM(RTRIM(ip)) = @ip0`, ipParam('ip0', ip));
      for (const x of r.recordset || []) {
        if (String(x.ip ?? '').trim() !== ip) continue;
        const h = sahipEkle(x.host, 'dbo.Inventory');
        if (h) inv.set(h, x.env == null ? null : String(x.env));
      }
    } catch (e) {
      throw okunamadi('dbo.Inventory', e);
    }
    if (await tabloVar('dbo.IPInventory')) {
      // Gunluk TRUNCATE + yeniden yukleme: bos tablo "sahipsiz" DEGIL (serbest siniflandirma 424 der).
      const dolu = (await ilkSatir('dbo.IPInventory', `SELECT TOP 1 1 AS x FROM dbo.IPInventory`)).x != null;
      if (dolu) {
        ipEnvanteriVar = true;
        try {
          // Yukleyici satiri ILK '-'ten boler (host, ip = line.split("-", 1)): tireli host adi bozuk gelir.
          // Onarim: tam = host + '-' + ip; gercek IP son '-'ten sonrasi, gercek host oncesi.
          const r = await query(
            `SELECT host, ip FROM dbo.IPInventory WHERE LTRIM(RTRIM(ip)) = @ip1 OR LTRIM(RTRIM(ip)) LIKE @ip2`,
            [...ipParam('ip1', ip), ...ipParam('ip2', `%-${ip}`)],
          );
          for (const x of r.recordset || []) {
            const tam = `${String(x.host ?? '').trim()}-${String(x.ip ?? '').trim()}`;
            const i = tam.lastIndexOf('-');
            if (tam.slice(i + 1) === ip) sahipEkle(tam.slice(0, i), 'dbo.IPInventory');
          }
        } catch (e) {
          throw okunamadi('dbo.IPInventory', e);
        }
        const t = await ilkSatir('dbo.IPInventory',
          `SELECT DATEDIFF(HOUR, MAX(last_seen_at), GETDATE()) AS yas_saat, CONVERT(varchar(19), MAX(last_seen_at), 120) AS son FROM dbo.IPInventory`);
        ipEnvanteriYasSaat = tamSayiYaDaNull(t.yas_saat);
        ipEnvanteriSon = t.son == null ? null : String(t.son);
      }
    }
    if (await taramaTablosu()) {
      try {
        // Son IKI tarama gunu: yarim gunde henuz yazilmamis sahip dunku satiriyla gorunur.
        const r = await query(
          `SELECT DISTINCT host, listen FROM dbo.Nginx_Audit_Servers
            WHERE scan_date >= ${SON_IKI_TARAMA_GUNU} AND listen LIKE @ip3`,
          ipParam('ip3', `%${ip}%`),
        );
        // Kesin eslesme HER listen belirtecinde (tarayici bloktaki tum listen'leri birlestirir).
        for (const x of r.recordset || []) if (listenIpleri(x.listen).includes(ip)) sahipEkle(x.host, 'tarama');
      } catch (e) {
        throw okunamadi('dbo.Nginx_Audit_Servers', e);
      }
      const t = await ilkSatir('dbo.Nginx_Audit_Servers',
        `SELECT DATEDIFF(DAY, MAX(scan_date), CAST(GETDATE() AS DATE)) AS yas_gun, CONVERT(varchar(10), MAX(scan_date), 23) AS son FROM dbo.Nginx_Audit_Servers`);
      taramaYasGun = tamSayiYaDaNull(t.yas_gun);
      taramaSon = t.son == null ? null : String(t.son);
    }
  }
  // Host basligi uretim kapisi: son IKI taramanin TUM server_name'leri (denetim.cjs tum-tarama okumasi
  // emsali). `guncel`: satir, hostun bu iki gun icindeki en son gunundan mi (hostun TUM satirlarindan; adsiz
  // blok da gun sayar). Uretim tarafi iki gunun birlesimi, non-prod tarafi yalniz guncel satirlar.
  let taramaAdlari;
  if (vhost !== null && vhost !== undefined) {
    taramaAdlari = null;
    if (await taramaTablosu()) {
      try {
        const r = await query(
          `SELECT DISTINCT host, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers
            WHERE scan_date >= ${SON_IKI_TARAMA_GUNU}`,
        );
        const satirlar = r.recordset || [];
        const son = enSonGunler(satirlar, (x) => sahipAdi(x.host));
        taramaAdlari = satirlar.filter((x) => x.server_name != null)
          .map((x) => ({ host: x.host, server_name: x.server_name, guncel: gunMetni(x.gun) === son.get(sahipAdi(x.host)) }));
      } catch (e) {
        throw okunamadi('dbo.Nginx_Audit_Servers', e);
      }
    }
  }

  const ilgili = [...new Set([
    ...(hostlar ? hostlar : [...nginx.keys()].filter((h) => IZINLI_ORTAM.has(envOfHost(h)))).map(hostNormalle).filter(Boolean),
    ...ipSahipleri.keys(),
  ])];
  const invHostlari = [...new Set([...ilgili, ...ekHostlar.map(hostNormalle).filter(Boolean)])];

  if (invHostlari.length) {
    const il = inListesi('h', invHostlari, sql);
    try {
      const r = await query(`SELECT host, env FROM dbo.Inventory WHERE UPPER(LTRIM(RTRIM(host))) IN (${il.sqlText})`, il.params);
      for (const x of r.recordset || []) {
        const h = hostNormalle(x.host);
        if (h) inv.set(h, x.env == null ? null : String(x.env));
      }
    } catch (e) {
      throw okunamadi('dbo.Inventory', e);
    }
  }

  let sunucular = null;
  // ip / vhost yoksa OBJECT_ID burada (tur 2 sirasi); varsa yukarida bir kez olculdu.
  if (ilgili.length && (await taramaTablosu())) {
    sunucular = new Map();
    const il = inListesi('s', ilgili, sql);
    try {
      const r = await query(
        `SELECT host, listen, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers
          WHERE scan_date >= ${SON_IKI_TARAMA_GUNU} AND host IN (${il.sqlText})`,
        il.params,
      );
      const satirlar = r.recordset || [];
      // Host basina o hostun EN SON gunu (aday IP'ler, vhostlar): yarim gunde henuz yazilmamis host dunku
      // tam satirlarini kullanir; iki gunun satirlari KARISTIRILMAZ.
      const son = enSonGunler(satirlar, (x) => hostNormalle(x.host));
      for (const x of satirlar) {
        const h = hostNormalle(x.host);
        if (!h || gunMetni(x.gun) !== son.get(h)) continue;
        if (!sunucular.has(h)) sunucular.set(h, { listen: [], serverName: [] });
        sunucular.get(h).listen.push(x.listen);
        sunucular.get(h).serverName.push(x.server_name);
      }
    } catch (e) {
      throw okunamadi('dbo.Nginx_Audit_Servers', e);
    }
  }

  let ayarlar = null;
  if (ilgili.length && (await tabloVar('dbo.Nginx_Audit_Settings'))) {
    ayarlar = new Map();
    const il = inListesi('a', ilgili, sql);
    const gunParam = (ad, deger) => ({ name: ad, type: sql.NVarChar(10), value: deger });
    try {
      // Son iki tarama gunu, seek ile: d = MAX(scan_date), o = d'den onceki gun (yoksa null).
      const g = ((await query(
        `SELECT CONVERT(varchar(10), m.d, 23) AS d,
                CONVERT(varchar(10), (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Settings WHERE scan_date < m.d), 23) AS o
           FROM (SELECT MAX(scan_date) AS d FROM dbo.Nginx_Audit_Settings) AS m`,
      )).recordset || [])[0] || {};
      const d = g.d == null ? null : gunMetni(g.d);
      const o = g.o == null ? null : gunMetni(g.o);
      if (d) {
        // Host basina etkin gun: iki gun icinde hostun HERHANGI bir Settings satiri oldugu en son gun (yalniz
        // limit satirlari degil: limit_req'i olmayan host mesru olarak limitsizdir). Host basina iki seek.
        const r0 = await query(
          `SELECT h.host,
                  CASE WHEN EXISTS (SELECT 1 FROM dbo.Nginx_Audit_Settings s WHERE s.scan_date = CONVERT(date, @d, 23) AND s.host = h.host) THEN 1 ELSE 0 END AS d_var,
                  CASE WHEN EXISTS (SELECT 1 FROM dbo.Nginx_Audit_Settings s WHERE s.scan_date = CONVERT(date, @o, 23) AND s.host = h.host) THEN 1 ELSE 0 END AS o_var
             FROM (VALUES ${il.params.map((p) => `(@${p.name})`).join(', ')}) AS h(host)`,
          [...il.params, gunParam('d', d), gunParam('o', o)],
        );
        const gunHostlari = new Map();
        for (const x of r0.recordset || []) {
          const gun = Number(x.d_var) === 1 ? d : Number(x.o_var) === 1 && o ? o : null;
          if (!gun) continue;
          if (!gunHostlari.has(gun)) gunHostlari.set(gun, []);
          gunHostlari.get(gun).push(String(x.host));
        }
        for (const [gun, hs] of gunHostlari) {
          const il2 = inListesi('a', hs, sql);
          const r = await query(
            `SELECT host, directive, value FROM dbo.Nginx_Audit_Settings
              WHERE scan_date = CONVERT(date, @g, 23)
                AND directive IN ${LIMIT_DIREKTIFLERI} AND host IN (${il2.sqlText})`,
            [...il2.params, gunParam('g', gun)],
          );
          for (const x of r.recordset || []) {
            const h = hostNormalle(x.host);
            if (!h) continue;
            if (!ayarlar.has(h)) ayarlar.set(h, []);
            ayarlar.get(h).push({ directive: x.directive, value: x.value });
          }
        }
      }
    } catch (e) {
      throw okunamadi('dbo.Nginx_Audit_Settings', e);
    }
  }
  return {
    nginx, inv, sunucular, ayarlar, ipSahipleri, ipTaninmayan,
    taramaVar: taramaVarMi === null ? sunucular !== null : taramaVarMi,
    ipEnvanteriVar, ipEnvanteriYasSaat, ipEnvanteriSon, taramaYasGun, taramaSon,
    ...(vhost !== null && vhost !== undefined ? { taramaAdlari } : {}),
  };
}

/** Bir hedefin kaynaklardan turetilen ayrintisi (IP adaylari, vhostlar, tavanlar). */
function hedefAyrintisi(k, host) {
  const n = k.nginx.get(host) || null;
  const s = k.sunucular ? k.sunucular.get(host) || null : null;
  const ipler = adayIpler({ listenler: s ? s.listen : [], envanterIp: n ? n.ip : null });
  // Tarama verisi yoksa (tablo yok ya da host taranmamis) vhost listesi BILINMIYOR: null.
  const vh = s ? vhostlar(s.serverName) : null;
  const t = k.ayarlar ? rateLimitTavani(k.ayarlar.get(host) || []) : { hizSiniri: null, vuSiniri: null };
  return { ipler, vhostlar: vh, hizSiniri: t.hizSiniri, vuSiniri: t.vuSiniri };
}

// ── IP SINIFLANDIRMASI (sozlesme 8.2; SAF, sira BAGLAYICI) ─────────────────────────────────

/**
 * Yazilan hedef IP -> { ok:true, tur:'sunucu', host } | { ok:true, tur:'serbest', host:null, ag,
 * digerSahipler:[{host, env}] } | red(400 / 409 / 424, ..., { sahipler }). `k`: kaynaklariOku({ ip })
 * donusu. Sira: IP bicimi -> yasak listesi (gecersiz girdi / yasakli ag; IKI kipte, izin
 * listesinden ONCE) -> adi cozulemeyen sahip (iki yolda, host secici dahil) -> sahiplerin ortami ->
 * yuk makinesinin kendi IP'si -> uretim / EDU / bilinmeyen ortamli sahip -> nginx sahipleri (host
 * secici: hedefHost sahiplerden biri mi - paylasilan VIP kabul; elle IP: tek nginx sahibi ve tek
 * sahip) -> nginx sahibi yoksa serbest (izin listesi acik, tarama ve IPInventory var ve TAZE, IP
 * izinli bir agda ve ag / yayin adresi degil). Cagiran hedefHost icin ONCE hedefKapisi'ni calistirir.
 */
function ipSinifla(ip, k, { aglar = [], yasak = { liste: [], hatali: [] }, hedefHost = null, yukHost = null } = {}) {
  if (!kullanilabilirIp(ip)) return red(400, 'gecersiz_istek', 'hedefIp kullanılabilir bir IPv4 değil (0/8, 127/8, 169.254/16, 224+ olamaz).');
  const ys = yasak && typeof yasak === 'object' ? yasak : { liste: [], hatali: [] };
  const hatali = Array.isArray(ys.hatali) ? ys.hatali : [];
  if (hatali.length) {
    return red(409, 'ip_yasak_listesi_gecersiz', `NGINX_LOADTEST_SERBEST_YASAK okunamadı (geçersiz girdi: ${hatali[0]}); liste düzeltilene kadar yük testi yapılmaz.`);
  }
  const yasakli = (Array.isArray(ys.liste) ? ys.liste : []).find((a) => agIcinde(ip, a));
  if (yasakli) return red(409, 'ip_yasakli_agda', `${ip} yasaklı bir ağda (${yasakli.metin}, NGINX_LOADTEST_SERBEST_YASAK); yük testi yapılmaz.`);
  const taninmayan = [...new Set(Array.isArray(k.ipTaninmayan) ? k.ipTaninmayan : [])];
  if (taninmayan.length) {
    return red(409, 'ip_sahibi_cozulemedi', `${ip} adı çözülemeyen bir envanter kaydına ait (${taninmayan.join(', ')}); IP'nin sahibi bilinmediği için yük testi yapılmaz.`);
  }
  const { envOfHost, envFromInventory } = require('../audit/nginx-hosts.cjs');
  const sahipMap = k.ipSahipleri instanceof Map ? k.ipSahipleri : new Map();
  // nginx sahibi: nginx envanterinde ya da son taramada listen'i bu IP. Ortam: nginx ise ad kurali;
  // degilse ad kurali BILINMIYOR degilse o, aksi halde dbo.Inventory.env.
  const sahipler = [...sahipMap.keys()].sort().map((h) => {
    const kaynaklar = sahipMap.get(h);
    const nginx = k.nginx.has(h) || kaynaklar.has('tarama');
    const adEnv = envOfHost(h);
    const env = nginx || adEnv !== 'BILINMIYOR' ? adEnv : envFromInventory(k.inv.get(h));
    return { host: h, env, nginx, kaynaklar: [...kaynaklar].sort() };
  });
  const ek = { sahipler: sahipler.slice(0, 10) };
  if (yukHost && sahipler.some((s) => s.host === yukHost)) {
    return red(409, 'ayni_host', `${ip} yük makinesinin (${yukHost}) kendi IP'si; hedef olamaz.`, ek);
  }
  for (const s of sahipler) {
    const isaret = IZINLI_ORTAM.has(s.env) ? uretimIsareti({ host: s.host, nginxEnv: k.nginx.get(s.host)?.env ?? null, invEnv: k.inv.get(s.host) ?? null }) : null;
    if (!IZINLI_ORTAM.has(s.env) || isaret) {
      const sebep = !IZINLI_ORTAM.has(s.env) ? `ortamı ${s.env}` : `üretim işareti: ${isaret}`;
      return red(409, 'hedef_uretim', `${ip}, ${s.host} sunucusuna ait (${sebep}); yük testi yapılmaz.`, ek);
    }
  }
  const nginxSahipleri = sahipler.filter((s) => s.nginx).map((s) => s.host);
  if (hedefHost) {
    // Host secici: paylasilan VIP'te diger non-prod sahipler kabul (playbook ip_yerel'i on kontrolde
    // VE kosu basinda olcer). Metni cagiran aday listesiyle kurar.
    if (nginxSahipleri.includes(hedefHost)) return { ok: true, tur: 'sunucu', host: hedefHost };
    return red(409, 'ip_hedefte_yok', `${ip}, ${hedefHost} için bilinen IP'lerden değil.`, ek);
  }
  if (nginxSahipleri.length === 1 && sahipler.length === 1) return { ok: true, tur: 'sunucu', host: nginxSahipleri[0] };
  if (nginxSahipleri.length >= 2) {
    return red(409, 'ip_belirsiz', `${ip} birden çok nginx sunucusunda tanımlı (${nginxSahipleri.join(', ')}); hedef sunucuyu listeden seçin.`, ek);
  }
  if (nginxSahipleri.length === 1) {
    const digerleri = sahipler.filter((s) => !s.nginx).map((s) => s.host);
    return red(409, 'ip_belirsiz', `${ip} hem nginx sunucusu ${nginxSahipleri[0]} hem ${digerleri.join(', ')} kaydında görünüyor; hedef sunucuyu listeden seçin.`, ek);
  }
  // Nginx sahibi yok: serbest adayi. "Sahipsiz" PROD olmadiginin kaniti DEGIL; asil koruma izin listesi.
  const izinli = Array.isArray(aglar) ? aglar : [];
  if (!izinli.length) {
    return red(409, 'serbest_kapali', `${ip} envanterdeki bir nginx sunucusuna ait değil ve serbest hedef kapalı (NGINX_LOADTEST_SERBEST_AGLAR tanımlı değil).`, ek);
  }
  if (!(k.taramaVar && k.ipEnvanteriVar)) {
    const eksik = [k.taramaVar ? null : 'dbo.Nginx_Audit_Servers', k.ipEnvanteriVar ? null : 'dbo.IPInventory'].filter(Boolean).join(' ve ');
    return red(424, 'envanter_okunamadi', `Serbest hedef için IP sahipliği doğrulanamadı: ${eksik} okunamadı ya da boş.`, ek);
  }
  const parcalar = [];
  if (k.ipEnvanteriYasSaat == null || k.ipEnvanteriYasSaat > SINIRLAR.ipEnvanteriMaxYasSaat) {
    parcalar.push(`dbo.IPInventory son yükleme ${k.ipEnvanteriSon ?? '?'} (${k.ipEnvanteriYasSaat ?? '?'} saat önce, en çok ${SINIRLAR.ipEnvanteriMaxYasSaat})`);
  }
  if (k.taramaYasGun == null || k.taramaYasGun > SINIRLAR.taramaMaxYasGun) {
    parcalar.push(`nginx taraması ${k.taramaSon ?? '?'} (${k.taramaYasGun ?? '?'} gün önce, en çok ${SINIRLAR.taramaMaxYasGun})`);
  }
  if (parcalar.length) return red(424, 'envanter_bayat', `Serbest hedef için envanter bayat: ${parcalar.join('; ')}; yükleyici / tarama işlerini kontrol edin.`, ek);
  const ag = serbestAgBul(ip, izinli);
  if (!ag) {
    return red(409, 'ip_izinli_agda_degil', `${ip} envanterdeki bir nginx sunucusuna ait değil ve izinli ağların (${izinli.map((a) => a.metin).join(', ')}) dışında.`, ek);
  }
  return { ok: true, tur: 'serbest', host: null, ag: ag.metin, digerSahipler: sahipler.map((s) => ({ host: s.host, env: s.env })) };
}

// ── HOST BASLIGI (D7 + uretim kapisi + plan uyarilari; sozlesme 8.4) ─────────────────────────

/**
 * server_name belirteci Host basligiyla eslesir mi: tam esitlik, `*.s` (son ek), `.s` (s ya da son
 * ek), `p.*` (on ek). '', '_' ve `~` ile baslayan REGEX belirtec eslesmez - regex degerlendirilmez
 * (zaman asimsiz Node regex'i olay dongusunu kilitleyebilir; asil koruma izin listesi: bilinen bosluk).
 */
function serverNameEslesir(ad, vhost) {
  const a = String(ad ?? '').trim().toLowerCase().replace(/;+$/, '').replace(/^["']+|["']+$/g, '');
  const v = String(vhost ?? '').trim().toLowerCase();
  if (!a || !v || a === '_' || a.startsWith('~')) return false;
  if (a === v) return true;
  if (a.startsWith('*.')) return v.endsWith(`.${a.slice(2)}`) && a.length > 2;
  if (a.startsWith('.')) {
    const s = a.slice(1);
    return s !== '' && (v === s || v.endsWith(`.${s}`));
  }
  if (a.endsWith('.*')) return a.length > 2 && v.startsWith(`${a.slice(0, -2)}.`);
  return false;
}

/**
 * Host basligi son taramada nerede tanimli: P = server_name'i eslesen uretim / EDU / ortami bilinmeyen
 * (ya da uretim isaretli) hostlar - son IKI tarama gununun birlesiminden (tutucu); N = eslesen diger
 * hostlar - yalniz hostun EN SON gunundan (`guncel`; dun silinmis ad uretim engelini kaldirmasin);
 * S = P + N. Yalniz P varsa (N bos) iki kipte 409 host_uretim; listede olmamak ENGEL DEGIL (D7). Yalniz
 * serbestte onay isteyen plan uyarilari (sirasiyla): hicbir yerde yok, uretimde de var, yuk makinesi
 * havuzda, yuk makinesi RP. Tarama tablosu yoksa sunucu kipinde { ok:true, uyarilar:[] } (serbest zaten
 * tarama ister). `guncel` alani olmayan satir guncel sayilir.
 */
function hostBasligiDegerlendir(vhost, k, { hedefTuru = 'sunucu', yukHost = null } = {}) {
  const serbest = hedefTuru === 'serbest';
  if (!Array.isArray(k.taramaAdlari)) {
    if (!serbest) return { ok: true, uyarilar: [] };
    return red(424, 'envanter_okunamadi', 'Serbest hedef için Host başlığı denetlenemedi: nginx taraması (dbo.Nginx_Audit_Servers) okunamadı ya da boş.');
  }
  const { envOfHost, internetRpHosts } = require('../audit/nginx-hosts.cjs');
  const birlesim = new Set();
  const guncel = new Set();
  for (const r of k.taramaAdlari) {
    const h = sahipAdi(r && r.host);
    if (!h) continue;
    if (!String((r && r.server_name) ?? '').split(/\s+/).some((ad) => serverNameEslesir(ad, vhost))) continue;
    birlesim.add(h);
    if (r.guncel !== false) guncel.add(h);
  }
  const uretimMi = (h) => !IZINLI_ORTAM.has(envOfHost(h))
    || !!uretimIsareti({ host: h, nginxEnv: k.nginx.get(h)?.env ?? null, invEnv: k.inv.get(h) ?? null });
  const P = [...birlesim].filter(uretimMi).sort();
  const N = [...guncel].filter((h) => !P.includes(h));
  const S = new Set([...P, ...N]);
  if (P.length && !N.length) {
    return red(409, 'host_uretim', `Host başlığı (${vhost}) son taramada yalnız üretim / EDU / ortamı bilinmeyen nginx sunucularında tanımlı (${P.slice(0, 5).join(', ')}${P.length > 5 ? ' …' : ''}); bu adla yük testi yapılmaz.`, {
      sahipler: P.slice(0, 10).map((h) => ({ host: h, env: envOfHost(h), nginx: true, kaynaklar: ['tarama'] })),
    });
  }
  const uyarilar = [];
  if (serbest) {
    if (!S.size) uyarilar.push(HOST_TARAMADA_YOK_UYARISI(vhost));
    if (P.length) uyarilar.push(HOST_URETIMDE_DE_VAR_UYARISI(vhost, P));
    if (yukHost && S.has(yukHost)) uyarilar.push(YUK_MAKINESI_HAVUZDA_UYARISI(vhost, yukHost));
    if (yukHost && internetRpHosts().all.has(yukHost)) uyarilar.push(YUK_MAKINESI_RP_UYARISI(yukHost));
  }
  return { ok: true, uyarilar };
}

module.exports = {
  SINIRLAR,
  VARSAYILAN,
  UA_ONEK,
  MOTORLAR,
  HEDEF_TURLERI,
  VARSAYILAN_WRK,
  SERBEST_UYARISI,
  WRK_UYARISI,
  HOST_LISTEDE_YOK_UYARISI,
  WRK_SNI_MESAJI,
  HOST_TARAMADA_YOK_UYARISI,
  HOST_URETIMDE_DE_VAR_UYARISI,
  YUK_MAKINESI_HAVUZDA_UYARISI,
  YUK_MAKINESI_RP_UYARISI,
  IZINLI_ORTAM,
  HOST_RE,
  ADIM_RE,
  TUR_RE,
  BEYAZ_LISTE,
  NOKTALI_VIRGUL_NEDENI,
  SIFIR_SINIR_MESAJI,
  red,
  hostNormalle,
  gecerliIpv4,
  kullanilabilirIp,
  gecerliVhost,
  tamSayi,
  sha256Hex,
  epostaMi,
  kisiselVeriSuphesi,
  yolDenetle,
  agirlikBicim,
  senaryoSatirlari,
  senaryoGovdesi,
  ozetTemizle,
  ADIM_EK_SN,
  butceSn,
  sifirSinir,
  parametreler,
  etiket,
  uretimIsareti,
  hedefKapisi,
  yukHostKapisi,
  listenIp,
  listenIpleri,
  adayIpler,
  vhostlar,
  rateLimitTavani,
  onKontrolDegerlendir,
  onayMetniDogru,
  yukHostlari,
  k6Yolu,
  wrkYolu,
  ciktiKok,
  kosuDizini,
  serbestAglar,
  serbestYasak,
  agIcinde,
  serbestAgBul,
  EKSTRA_ANAHTARLAR,
  ekstraDegiskenler,
  ekstraDegiskenleriDenetle,
  gecmisIcinMaskele,
  kaynaklariOku,
  hedefAyrintisi,
  ipSinifla,
  serverNameEslesir,
  hostBasligiDegerlendir,
};
