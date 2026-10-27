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
});

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
const VARSAYILAN_CIKTI_KOK = '/sw/BMW_PORTAL/nginx_loadtest';
const UA_ONEK = 'portal-yuktesti';

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
 * dusebiliyordu.
 */
const ADIM_EK_SN = 20;
function butceSn(p) {
  return p.bosta + p.hizlar.length * p.tekrar * (p.isinma + p.sure + p.bosluk + ADIM_EK_SN) + 120;
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
 * kosunun "ayni parametre" kosulu buna dayanir). Tanimsiz alan VARSAYILAN'dan gelir.
 * `hizSiniri` / `vuSiniri`: hedefin olculmus rate limitinden daraltilmis tavan (yoksa null; 0 ise
 * hedef yuk testine KAPALI: 409 sinir_asildi).
 */
function parametreler(ham, { sni, hizSiniri = null, vuSiniri = null } = {}) {
  const g = ham && typeof ham === 'object' && !Array.isArray(ham) ? ham : null;
  if (!g) return red(400, 'gecersiz_istek', 'parametreler nesnesi gerekli.');
  const al = (k) => (g[k] === undefined ? VARSAYILAN[k] : g[k]);
  const hamHizlar = al('hizlar');
  if (!Array.isArray(hamHizlar) || hamHizlar.length === 0) return red(400, 'gecersiz_istek', 'hizlar en az bir değer içermeli.');
  const hizlar = hamHizlar.map(tamSayi);
  if (hizlar.some((h) => h === null)) return red(400, 'gecersiz_istek', 'hizlar tam sayı olmalı.');
  const sayilar = {};
  for (const k of ['tekrar', 'isinma', 'sure', 'bosluk', 'bosta', 'maxvu']) {
    sayilar[k] = tamSayi(al(k));
    if (sayilar[k] === null) return red(400, 'gecersiz_istek', `${k} tam sayı olmalı.`);
  }
  const kip = al('kip');
  const ae = al('ae');
  if (!KIPLER.has(kip)) return red(400, 'gecersiz_istek', "kip 'yeni' ya da 'ka' olmalı.");
  if (!AE_DEGERLERI.has(ae)) return red(400, 'gecersiz_istek', "ae 'br', 'gzip' ya da 'identity' olmalı.");
  if (typeof sni !== 'boolean') return red(400, 'gecersiz_istek', 'sni true/false olmalı.');
  if (sifirSinir(hizSiniri, vuSiniri)) return red(409, 'sinir_asildi', SIFIR_SINIR_MESAJI);

  const tavanHiz = Math.min(SINIRLAR.maxHiz, Number.isInteger(hizSiniri) && hizSiniri > 0 ? hizSiniri : SINIRLAR.maxHiz);
  const tavanVu = Math.min(SINIRLAR.maxVu, Number.isInteger(vuSiniri) && vuSiniri > 0 ? vuSiniri : SINIRLAR.maxVu);
  const asim = [];
  if (hizlar.length > SINIRLAR.maxHizSayisi) asim.push(`en çok ${SINIRLAR.maxHizSayisi} hız`);
  if (new Set(hizlar).size !== hizlar.length) asim.push('aynı hız iki kez');
  for (const h of hizlar) {
    if (h < SINIRLAR.hizMin || h > tavanHiz) {
      asim.push(`hız ${h} izinli aralıkta değil (1..${tavanHiz}${tavanHiz < SINIRLAR.maxHiz ? ', hedefin ölçülmüş limit_req değerinin %90\'ı' : ''})`);
    }
  }
  const aralik = (k, min, max, ad) => {
    if (sayilar[k] < min || sayilar[k] > max) asim.push(`${ad} ${sayilar[k]} (izinli ${min}..${max})`);
  };
  aralik('tekrar', 1, SINIRLAR.maxTekrar, 'tekrar');
  aralik('isinma', SINIRLAR.isinmaMin, SINIRLAR.isinmaMax, 'ısınma');
  aralik('sure', SINIRLAR.sureMin, SINIRLAR.sureMax, 'süre');
  aralik('bosluk', SINIRLAR.boslukMin, SINIRLAR.boslukMax, 'boşluk');
  aralik('bosta', SINIRLAR.bostaMin, SINIRLAR.bostaMax, 'boşta başlangıç');
  aralik('maxvu', SINIRLAR.maxVuMin, tavanVu, 'maxvu');
  const p = { hizlar, ...sayilar, kip, ae, sni };
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

/** Hedefin aday IP'leri: tarama listen IP'leri + envanter IP'si; yalniz kullanilabilir IPv4. */
function adayIpler({ listenler = [], envanterIp = null } = {}) {
  const set = new Set();
  for (const l of listenler) {
    const ip = listenIp(l);
    if (kullanilabilirIp(ip)) set.add(ip);
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
 * On kontrol ozeti (set_stats on_kontrol) -> { engeller, uyarilar }.
 * ENGEL: kosu bu on kontrolle baslatilamaz (IP hedefte yerel degil, vhost nginx -T'de yok, k6 yok,
 * /web_log okunamiyor, hic yol denenmemis, nginx master sayisi olculmus ve 1 degil). UYARI: acik
 * onay (uyariOnay) ister. Playbook ayni engelleri yt_engeller'e yazar (sunucu, ekran, playbook ayni).
 */
function onKontrolDegerlendir(ok) {
  const engeller = [];
  const uyarilar = [];
  if (!ok || typeof ok !== 'object') return { engeller: ['ön kontrol sonucu okunamadı'], uyarilar };
  if (!EVET(ok.ip_yerel)) engeller.push('seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)');
  if (!EVET(ok.server_name_var)) engeller.push("vhost hedefin nginx -T çıktısında yok (ya da ölçülemedi)");
  if (!EVET(ok.k6_var)) engeller.push('k6 yük makinesinde bulunamadı');
  // CPU kaydedici /web_log'u okuyamazsa sunucu tarafi olcum yok: playbook bunu ENGEL sayar.
  if (HAYIR(ok.log_dizini_okunur)) engeller.push('log dizini /web_log okunamıyor');
  const toplam = SAYI(ok.yollar_toplam);
  const iki = SAYI(ok.yollar_200);
  if (!(toplam > 0)) engeller.push('ön kontrolde hiçbir yol denenmedi');
  else if (iki === null) uyarilar.push('200 dönen yol sayısı ölçülemedi');
  else if (iki < toplam) uyarilar.push(`${toplam - iki}/${toplam} yol 200 dönmedi`);
  const statik = SAYI(ok.sikistirma && ok.sikistirma.statik);
  if (statik > 0) uyarilar.push(`hedefte ön-sıkıştırılmış dosyalar var (${statik} yol)`);
  const df = SAYI(ok.web_log_df);
  if (df === null) uyarilar.push('/web_log doluluğu ölçülemedi');
  else if (df >= 65) uyarilar.push(`/web_log %${df} dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)`);
  if (HAYIR(ok.log_format_ua)) uyarilar.push("etkin log_format'ta user-agent= yok: sunucu tarafı ölçüm eksik kalır");
  // cpu_kaydedici.sh 0 ya da 1'den fazla master gorurse baslamaz: olculmus != 1 ENGEL, olculemedi UYARI.
  const master = SAYI(ok.master_sayisi);
  if (master === null) uyarilar.push('nginx master süreç sayısı ölçülemedi (1 bekleniyor)');
  else if (master !== 1) engeller.push(`nginx master süreç sayısı ${master} (1 bekleniyor; CPU kaydedici bu durumda başlamaz)`);
  return { engeller, uyarilar };
}

function onayMetniDogru(confirmText, hedefHost) {
  return typeof confirmText === 'string' && confirmText.trim() === hedefHost;
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

// Sozlesme bolum 3: gonderilen TUM anahtarlar (fazlasi ve eksigi son kapida reddedilir).
const EKSTRA_ANAHTARLAR = Object.freeze([
  'yuk_islem', 'yuk_run_id', 'yuk_hedef_host', 'yuk_yuk_host', 'yuk_hedef_ip', 'yuk_host_basligi', 'yuk_sni',
  'yuk_senaryo_tur', 'yuk_senaryo_b64', 'yuk_senaryo_sha256', 'yuk_hizlar', 'yuk_tekrar', 'yuk_kip', 'yuk_ae',
  'yuk_isinma_sn', 'yuk_sure_sn', 'yuk_bosluk_sn', 'yuk_bosta_bas_sn', 'yuk_maxvu', 'yuk_butce_sn', 'yuk_k6_yolu',
  'yuk_ua_onek', 'yuk_cikti_kok',
]);

/** Sozlesme bolum 3 alan listesi; hepsi METIN. `limit` her zaman ''. */
function ekstraDegiskenler({ islem, kosuId, hedefHost, yukHost, hedefIp, vhost, senaryo, p, k6, ua = UA_ONEK, kok }) {
  return {
    yuk_islem: islem,
    yuk_run_id: String(kosuId),
    yuk_hedef_host: hedefHost,
    yuk_yuk_host: yukHost,
    yuk_hedef_ip: hedefIp,
    yuk_host_basligi: vhost,
    yuk_sni: p.sni ? '1' : '0',
    yuk_senaryo_tur: senaryo.tur,
    yuk_senaryo_b64: Buffer.from(senaryo.tsv, 'utf8').toString('base64'),
    yuk_senaryo_sha256: senaryo.sha256,
    yuk_hizlar: p.hizlar.join(' '),
    yuk_tekrar: String(p.tekrar),
    yuk_kip: p.kip,
    yuk_ae: p.ae,
    yuk_isinma_sn: String(p.isinma),
    yuk_sure_sn: String(p.sure),
    yuk_bosluk_sn: String(p.bosluk),
    yuk_bosta_bas_sn: String(p.bosta),
    yuk_maxvu: String(p.maxvu),
    yuk_butce_sn: String(butceSn(p)),
    yuk_k6_yolu: k6,
    yuk_ua_onek: ua,
    yuk_cikti_kok: kok,
  };
}

/**
 * Baslatmadan hemen once SON KAPI: gonderilecek degiskenler playbook assert'leriyle ayni
 * kurallardan gecer. Donus: ihlal listesi (bos = gecerli).
 */
function ekstraDegiskenleriDenetle(ev) {
  const ihlal = [];
  const metin = (k) => typeof ev[k] === 'string';
  const aralik = (k, min, max) => {
    if (!metin(k) || !/^[0-9]{1,6}$/.test(ev[k]) || Number(ev[k]) < min || Number(ev[k]) > max) ihlal.push(k);
  };
  if (!ISLEMLER.has(ev.yuk_islem)) ihlal.push('yuk_islem');
  if (!metin('yuk_run_id') || !RUN_ID_RE.test(ev.yuk_run_id)) ihlal.push('yuk_run_id');
  if (!metin('yuk_hedef_host') || !HOST_RE.test(ev.yuk_hedef_host)) ihlal.push('yuk_hedef_host');
  if (!metin('yuk_yuk_host') || !HOST_RE.test(ev.yuk_yuk_host) || ev.yuk_yuk_host === ev.yuk_hedef_host) ihlal.push('yuk_yuk_host');
  if (!kullanilabilirIp(ev.yuk_hedef_ip)) ihlal.push('yuk_hedef_ip');
  if (!gecerliVhost(ev.yuk_host_basligi)) ihlal.push('yuk_host_basligi');
  if (ev.yuk_sni !== '0' && ev.yuk_sni !== '1') ihlal.push('yuk_sni');
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
  if (!metin('yuk_hizlar') || !HIZLAR_RE.test(ev.yuk_hizlar) || ev.yuk_hizlar.split(' ').some((h) => Number(h) < 1 || Number(h) > SINIRLAR.maxHiz)) {
    ihlal.push('yuk_hizlar');
  }
  aralik('yuk_tekrar', 1, SINIRLAR.maxTekrar);
  if (!KIPLER.has(ev.yuk_kip)) ihlal.push('yuk_kip');
  if (!AE_DEGERLERI.has(ev.yuk_ae)) ihlal.push('yuk_ae');
  aralik('yuk_isinma_sn', SINIRLAR.isinmaMin, SINIRLAR.isinmaMax);
  aralik('yuk_sure_sn', SINIRLAR.sureMin, SINIRLAR.sureMax);
  aralik('yuk_bosluk_sn', SINIRLAR.boslukMin, SINIRLAR.boslukMax);
  aralik('yuk_bosta_bas_sn', SINIRLAR.bostaMin, SINIRLAR.bostaMax);
  aralik('yuk_maxvu', SINIRLAR.maxVuMin, SINIRLAR.maxVu);
  aralik('yuk_butce_sn', 1, SINIRLAR.maxButceSn);
  if (!yolGuvenli(ev.yuk_k6_yolu, K6_YOLU_RE)) ihlal.push('yuk_k6_yolu');
  if (!metin('yuk_ua_onek') || !UA_ONEK_RE.test(ev.yuk_ua_onek)) ihlal.push('yuk_ua_onek');
  if (!yolGuvenli(ev.yuk_cikti_kok, CIKTI_KOK_RE)) ihlal.push('yuk_cikti_kok');
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

/**
 * Kapilarin ihtiyac duydugu TBMWANS verisi. `hostlar`: verilirse yalniz bu hostlar icin tarama
 * satirlari okunur (baslatma yolu); verilmezse envanterdeki tum non-prod hostlar (/hedefler).
 * Tablo YOKSA (OBJECT_ID null) o kaynak "veri yok" sayilir; sorgu HATASI 424'tur.
 * Donus: { nginx: Map(host -> satir), inv: Map(host -> env), sunucular: Map(host -> {listen[], serverName[]})|null,
 *          ayarlar: Map(host -> satir[])|null }
 */
async function kaynaklariOku({ query, sql, hostlar = null, ekHostlar = [] }) {
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
  const ilgili = (hostlar ? hostlar : [...nginx.keys()].filter((h) => IZINLI_ORTAM.has(envOfHost(h)))).map(hostNormalle).filter(Boolean);
  const invHostlari = [...new Set([...ilgili, ...ekHostlar.map(hostNormalle).filter(Boolean)])];

  const inv = new Map();
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

  const tabloVar = async (ad) => {
    try {
      const r = await query(`SELECT OBJECT_ID('${ad}') AS oid`);
      return !!(r.recordset && r.recordset[0] && r.recordset[0].oid);
    } catch (e) {
      throw okunamadi(ad, e);
    }
  };

  let sunucular = null;
  if (ilgili.length && (await tabloVar('dbo.Nginx_Audit_Servers'))) {
    sunucular = new Map();
    const il = inListesi('s', ilgili, sql);
    try {
      const r = await query(
        `SELECT host, listen, server_name FROM dbo.Nginx_Audit_Servers
          WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers) AND host IN (${il.sqlText})`,
        il.params,
      );
      for (const x of r.recordset || []) {
        const h = hostNormalle(x.host);
        if (!h) continue;
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
    try {
      const r = await query(
        `SELECT host, directive, value FROM dbo.Nginx_Audit_Settings
          WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Settings)
            AND directive IN ('limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn') AND host IN (${il.sqlText})`,
        il.params,
      );
      for (const x of r.recordset || []) {
        const h = hostNormalle(x.host);
        if (!h) continue;
        if (!ayarlar.has(h)) ayarlar.set(h, []);
        ayarlar.get(h).push({ directive: x.directive, value: x.value });
      }
    } catch (e) {
      throw okunamadi('dbo.Nginx_Audit_Settings', e);
    }
  }
  return { nginx, inv, sunucular, ayarlar };
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

module.exports = {
  SINIRLAR,
  VARSAYILAN,
  UA_ONEK,
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
  adayIpler,
  vhostlar,
  rateLimitTavani,
  onKontrolDegerlendir,
  onayMetniDogru,
  yukHostlari,
  k6Yolu,
  ciktiKok,
  kosuDizini,
  EKSTRA_ANAHTARLAR,
  ekstraDegiskenler,
  ekstraDegiskenleriDenetle,
  gecmisIcinMaskele,
  kaynaklariOku,
  hedefAyrintisi,
};
