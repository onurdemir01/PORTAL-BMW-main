// server/nginx-loadtest/index.cjs - Nginx Hub > Yuk Testi HTTP yuzeyi (/api/nginx-loadtest).
//
// Ayri router (nginx-cis deseni, kesif C3): nginx-console'un 1600 satirlik router'ina eklenmedi ve
// nginxRedCevirici `haric` listesine KONMADI - 403/404 govdeleri kurumsal nginx'in HTML sayfasina
// donmesin diye 409'a cevrilir; is hatalari zaten 409 (kalici) / 424 (gecici). 5xx YOK.
//
// KAPILAR (sira onemli): requireAuth -> adminOkumaKapisi (Admin olmayana yalniz ADMIN_DISI_OKUMA
// GET yollari) -> requireVisiblePrefix('NginxConsole') -> requireVisible('tab:nginx:yuktesti').
// Yazan her uc ve /durum ayrica isleyicide Admin ister.
//
// AWX KIMLIKLERI ISTEMCIDEN ALINMAZ: sunucu / is numarasi kosu satirindan okunur.
//
// HEDEF IP SINIFLANDIRMASI (tur 3, 2026-10-28): hedef IP'yi kullanici yazar (host secici istege
// bagli). Sunucu IP'nin sahibini envanterlerden bulur (dogrula.ipSinifla) ve karari KENDISI verir:
// IP tam bir non-prod nginx sunucusunun (ya da secilen hostun; paylasilan VIP dahil) ise 'sunucu'
// (bugunku yol: CPU kaydedici + nginx logu, IP sunucunun aday listesinde olmak ZORUNDA); hicbir
// nginx sunucusunun degilse ancak Portal izin listesinde (NGINX_LOADTEST_SERBEST_AGLAR), yasak
// listenin disinda, PROD / EDU / bilinmeyen sahipsiz ve envanter tazeyse 'serbest' (yalniz istemci
// olcumu; hedefe SSH yok; tavan 200 r/s / 50 baglanti; onay metni = IP; on kontrol de G|global).
// Ekran (/ip-sinifi) yalniz gosterir; on kontrol VE kosu kapisi siniflandirmayi YENIDEN yapar.
//
// TEHDIT MODELI: extra_vars AWX'te her degiskenin ustundedir; playbook kapilari Portal hatasina ve
// AWX Relaunch'una (yuk_son_epoch, 15 dk) karsi savunma derinligidir, AWX'te Execute yetkili
// kotu niyetli kullaniciya karsi SINIR DEGIL. Asil sinir AWX RBAC (sablonun Execute / Admin rolu
// yalniz Portal servis hesabinda). "Sahipsiz" IP PROD olmadiginin kaniti degil: LB VIP'leri
// envanterde yok, asil koruma dar tutulan izin listesidir.
//
// AKIS: senaryo (yalniz yol satirlari) -> on kontrol isi (yuk uretmez) -> kosu (on kontrol <= 15 dk,
// ayni kullanici, DONE/OK, onay metni = hedef host ya da serbestte hedef IP, uyarilar - plan
// uyarilari dahil - acikca onaylanmis, sinif ve plan uyarilari degismemis) -> poller sonuclandirir
// (bkz. poller.cjs). Ayrintilar: docs/NGINX-YUK-TESTI.md.
//
// DURDUR: AWX iptali uzaktaki async kos.sh/k6'yi ve ayrik kaydediciyi DURDURMAZ. Kosu icin durdur
// kipindeki is baslatilamazsa 424 durdur_baslatilamadi (iptal basarili olsa da); baslarsa kosunun
// kilitleri (kilit_id) durdur isine baglanir ve o is basariyla bitince birakilir (kilit.cjs).
//
// ARAC SETLERI (tur 4, 2026-11-02): k6 / wrk yuk makinelerine kurulmaz; Admin /araclar ile /sw'ye
// hazirlar (araclar.cjs). On kontrol ve kosu etkin seti ister (sablon cozumunden SONRA, kilitten
// ONCE: 409 araclar_ozet_sabit_yok / araclar_hazir_degil / araclar_ozet_degisti / araclar_geri_cekildi,
// 424 okunamadi); satira arac_id yazilir ve extra_vars setin /sw dizinini ve sha256'larini tasir.
// Kosu, on kontrolun arac_id'si NULL (arac oncesi) ya da etkin set degilse 409 on_kontrol_eski.
// Admin bir DONE seti geri cekebilir (POST /araclar/:id/geri-cek).
//
// GECE KUYRUGU (2026-11-03, kuyruk.cjs): /kuyruklar uclari; yurutucu on kontrol ve kosuyu BU dosyanin kapilarindan
// gecirir (kosuyuBaslat + kosuyuOnKontroldenBaslat; uyari karari tur kodlariyla). Kosu numarasi AWX'ten ONCE kuyruk
// ogesine yazilir (kosuKaydedildi kancasi).
//
// SONUC OZETI (sade turu, 2026-11-02): GET /kosular/:id adim satirlarina cpuOlculemedi + reloadlar ekler,
// CPU-ms/istek ve kapasiteyi asla <= 0 dondurmez (eski satirda da; DB degismez) ve kosu.sonucOzeti
// (toplam istek, en iyi / en kotu p95, 429 / 5xx / hata, konf degisimi, reload anlari) verir (gorunum.cjs).
//
// COKLU KARSILASTIRMA (2026-11-04, coklu.cjs): GET /karsilastir-coklu (ref + en cok 15 aday, her aday ref'e karsi
// kararVer; hiz basina ozet ve gurultu kurali) ve PUT /kosular/:id/etiket (Admin; denetimli). /karsilastir AYNEN.
//
// DURAKLAT / DUZENLEME / KAYITLI TEST (2026-11-04): POST /kuyruklar/:id/duraklat ve /devam (bayrak, kuyruk.cjs "DURAKLAT";
// suren is kosuyuDurdur ile, /kosular/:id/durdur ile ayni kod), PUT /kuyruklar/:id/ogeler/:ogeId (baslamamis oge, plan
// kapilari + onayli hedef), PUT /senaryolar/:id (yalniz ad / aciklama / vhost), /sablonlar (sablon.cjs; hepsi Admin).
//
// TOPLU RAPOR (2026-11-04, rapor.cjs): GET /rapor?kuyruk=<id> ya da ?kosular=1,2,.. (en cok 100; okuma yetkisi
// /karsilastir-coklu ile ayni). Satir = kosu x hiz; yazilamayan kosu 409 degil, yanitta `atlananlar`.
//
// KOSU SILME (2026-11-04, sil.cjs): DELETE /kosular/:id (onay = kosu numarasi) ve POST /kosular/sil (toplu, en cok 50;
// onay = secilen sayi). Kosuyu baslatan kisi ya da Admin: bu iki uc adminOkumaKapisi'ndan SAHIP_SILME ile gecer (gorunurluk
// ve sekme kapisi yine uygulanir), sahiplik isleyicide. Suren / kilitli / bekleyen-calisan kuyruk ogesine bagli / dinlenen
// kuyrugun / dayanan kosusu olan on kontrol silinmez (409, nedenleriyle). Hepsi ya da hic (tek islem, kosullu DELETE).
// /sw'deki ham olcum dosyalarina dokunulmaz. Denetim nginx_loadtest_kosu_sil.
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const dg = require('./dogrula.cjs');
const kilit = require('./kilit.cjs');
const baslat = require('./baslat.cjs');
const poller = require('./poller.cjs');
const araclar = require('./araclar.cjs');
const gorunum = require('./gorunum.cjs');
const kuyruk = require('./kuyruk.cjs');
const coklu = require('./coklu.cjs');
const rapor = require('./rapor.cjs');
const sil = require('./sil.cjs');
const sablon = require('./sablon.cjs');
const { adminOkumaKapisi, isAdmin } = require('../auth/admin-okuma-kapisi.cjs');

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const AKTIF = new Set(['QUEUED', 'RUNNING', 'FINALIZING']);
const ON_KONTROL_MAX_YAS_SN = 15 * 60;
const SEKME = 'tab:nginx:yuktesti';
// Baslatma suren (QUEUED, is numarasi henuz yazilmamis) satir bu sure dolmadan durdurulmaz: durdur
// satiri CANCELED yapip baslatilan isi takipsiz birakirdi.
const BASLATMA_PENCERESI_SN = 120;
// Tutulan kosu kilidinin ek suresi (butce + bu kadar); poller ile ayni.
const KILIT_EK_SN = 180;
// Etiket duzenleme (PUT /kosular/:id/etiket): C0 / DEL / C1 kontrol karakteri ve satir / paragraf ayirici yok.
// eslint-disable-next-line no-control-regex
const ETIKET_YASAK = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const LISTE_ISLEMLERI = new Set(['kosu', 'on_kontrol']);
const LISTE_DURUMLARI = new Set(['QUEUED', 'RUNNING', 'FINALIZING', 'DONE', 'FAILED', 'CANCELED', 'OKUNAMADI']);

/** Admin olmayana (sekmesi acik) salt okunur uclar. /durum ve yazan her uc Admin'de kalir. */
const ADMIN_DISI_OKUMA = Object.freeze([
  /^\/hedefler\/?$/,
  /^\/senaryolar\/?$/,
  /^\/senaryolar\/\d+\/?$/,
  /^\/kosular\/?$/,
  /^\/kosular\/\d+\/?$/,
  /^\/karsilastir\/?$/,
  /^\/karsilastir-coklu\/?$/,
  /^\/rapor\/?$/,
  /^\/araclar\/?$/,
  /^\/kuyruklar\/?$/,
  /^\/kuyruklar\/\d+\/?$/,
]);

/** Admin olmayanin gecebildigi YAZAN uclar (kosu silme): sahiplik isleyicide (kosuyu baslatan kisi), yoksa 403. */
const SAHIP_SILME = Object.freeze([
  { method: 'DELETE', yol: /^\/kosular\/\d+\/?$/ },
  { method: 'POST', yol: /^\/kosular\/sil\/?$/ },
]);

const db = () => require('../db/index.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(s);
const maskeleDerin = (v) => require('../retirement/is-ciktisi.cjs').maskeleDerin(v);

function hata(status, code, message, ek) {
  return Object.assign(new Error(message), { status, code }, ek || {});
}
/** dogrula.cjs kapisinin red nesnesi -> firlatilabilir hata (ek alanlar korunur). */
function kapidan(r) {
  const { ok, status, code, message, ...ek } = r;
  return hata(status, code, message, ek);
}

// Kayit numaralari INT kolon (mssql.Int): 2147483647'yi asan numara 400 olur (yoksa parametre tasip 424 olurdu).
const KAYIT_NO_MAX = 2147483647;
const sayi = (v) => {
  const n = dg.tamSayi(v);
  return n !== null && n > 0 && n <= KAYIT_NO_MAX ? n : null;
};
const iso = (v) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
function jsonOku(s) {
  if (s == null || s === '') return null;
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}
/** Anahtar sirasindan bagimsiz karsilastirma icin kararli JSON. */
function kararliJson(v) {
  if (Array.isArray(v)) return `[${v.map(kararliJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${kararliJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const kullanici = (req) => (req.session && req.session.user) || {};
const ayniKullanici = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== '';

// Denetime yazilan RET kodlari: 409 / 424 (islem denendi, durum engelledi / okunamadi). 400 (girdi / onay metni; DB'ye
// gidilmez) ve 404 (kayit yok) YAZILMAZ; Admin olmayanin yazan uca 403'u adminOkumaKapisi'nda (isleyiciye gelinmez)
// yazilmaz. Kosu silmenin sahiplik 403'u isleyicide ACIKCA yazilir (kosulariSil). Belge: NGINX-YUK-TESTI.md "Denetim".
const DENETLENEN_RET = new Set([409, 424]);

/** Tek hata yaniti. Beklenmeyen hata da 424: 500 govdesi kurumsal gecitte HTML'e doner. */
function hataYaniti(req, res, e, eylem, hedef) {
  let status = Number.isInteger(e && e.status) ? e.status : 424;
  if (status >= 500) status = 424;
  const code = (e && e.code) || (status === 424 ? 'beklenmeyen' : 'gecersiz_istek');
  if (!(e && Number.isInteger(e.status))) console.warn('[NginxYukTesti] beklenmeyen hata:', maskele(e && e.message));
  const body = { ok: false, code, message: maskele((e && e.message) || 'Beklenmeyen hata.') };
  for (const k of ['uyarilar', 'engeller', 'asimlar', 'hatalar', 'kilit', 'env', 'iptal', 'iptalHatasi', 'durdurHatasi', 'sahipler', 'uyariTurleri', 'oge', 'suren', 'kuyrukId', 'eksik', 'onKontrol', 'bitmemis', 'silinemeyenler', 'yetkisiz']) if (e && e[k] !== undefined) body[k] = e[k];
  // Reddedilen baslatma denemesi de denetime yazilir (uretim hedefi, izinsiz yuk makinesi ...).
  if (eylem && DENETLENEN_RET.has(status)) {
    try {
      require('../audit/index.cjs').auditPortal(req, eylem, {
        result: 'fail',
        targetHost: (hedef && hedef.host) || null,
        targetIp: (hedef && hedef.ip) || null,
        // Gecerli JSON, en cok 2000 karakter (uzun mesaj kisaltilir; kod ve kosu no kalir) - baslat.cjs.
        detail: baslat.denetimAyrintisi({ code, message: body.message, ...(hedef && hedef.kosuId ? { kosuId: hedef.kosuId } : {}) }),
      });
    } catch {
      /* best-effort */
    }
  }
  if (!res.headersSent) res.status(status).json(body);
}

async function dbOku(fn) {
  try {
    return await fn(db());
  } catch (e) {
    throw hata(424, 'db_okunamadi', `Portal veritabanı okunamadı: ${maskele(e && e.message)}`);
  }
}

// Is ZATEN baslatildiysa kayit yazimi bir kez kisa gecikmeyle yeniden denenir (opsx was deseni).
async function birKezTekrarla(ad, fn) {
  try {
    await fn();
    return true;
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fn();
      return true;
    } catch (e2) {
      console.warn(`[NginxYukTesti] ${ad} yazilamadi (2 deneme):`, maskele((e2 && e2.message) || (e1 && e1.message)));
      return false;
    }
  }
}

// Is baslamadigi KESIN olan her yolda bu istegin kilitleri birakilir (yalniz bu lock_id'li dolu
// satirlar). Birakma da hata alirsa (DB hala erisilemiyor) kilit TTL ile duser ve uyari yazilir;
// yeniden deneme yok (kesintiyi cozmez).
function kilitleriBirak(anahtarlar, lockId) {
  return kilit.releaseLocks(db(), anahtarlar, lockId).catch((e) => console.warn('[NginxYukTesti] kilit birakilamadi (TTL ile dusecek):', maskele(e && e.message)));
}

// ── SATIR -> API ──────────────────────────────────────────────────────────────────────────

function senaryoApi(r) {
  return {
    id: Number(r.id),
    ad: r.ad,
    aciklama: r.aciklama ?? null,
    vhost: r.vhost ?? null,
    senaryoTur: r.senaryo_tur,
    yolSayisi: r.yol_sayisi == null ? null : Number(r.yol_sayisi),
    sha256: r.sha256 == null ? null : String(r.sha256).trim(),
    kaynak: r.kaynak,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
  };
}

function kosuApi(r) {
  return {
    id: Number(r.id),
    islem: r.islem,
    etiket: r.etiket ?? null,
    adim: r.adim ?? null,
    // Serbest satirda hedef_host '' (DB'de NULL'a cevrilmez); API null doner. Eski satir: sunucu / k6.
    hedefTuru: r.hedef_turu || 'sunucu',
    motor: r.motor || 'k6',
    // HTTP surumu: liste kolonu ya da parametreler JSON'u; alani olmayan eski satir h1.
    protokol: protokolOf(r),
    hedefHost: r.hedef_host || null,
    hedefIp: r.hedef_ip,
    vhost: r.vhost,
    yukHost: r.yuk_host,
    senaryoId: r.senaryo_id == null ? null : Number(r.senaryo_id),
    senaryoAd: r.senaryo_ad ?? null,
    onKontrolKosuId: r.on_kontrol_kosu_id == null ? null : Number(r.on_kontrol_kosu_id),
    durum: r.durum,
    gecerlilik: r.gecerlilik ?? null,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    awxJobId: r.awx_job_id == null ? null : Number(r.awx_job_id),
    awxServerId: r.awx_server_id == null ? null : Number(r.awx_server_id),
  };
}

const deve = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** DB adim satiri -> API (camelCase); sade turu: cpuOlculemedi + reloadlar, CPU / kapasite asla <= 0 (gorunum.cjs).
 *  2026-11-03: `secenek` ({ motor, hedefTuru, protokol }; kosu satirindan) kip dogrulamasina gider (bellek ve kip). */
function adimApi(r, secenek = {}) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'nedenler' || k === 'ham') o[k] = jsonOku(v);
    else o[deve(k)] = v;
  }
  return gorunum.adimGorunumu(o, secenek);
}
/** kararVer'e giden adim: analiz ciktisiyla AYNI anahtarlar (snake), JSON alanlar cozulmus. */
function adimAnaliz(r) {
  return { ...r, nedenler: jsonOku(r.nedenler) || [], ham: jsonOku(r.ham) };
}

const KOSU_KOLONLARI = `k.id, k.senaryo_id, k.on_kontrol_kosu_id, k.islem, k.etiket, k.adim, k.hedef_host, k.hedef_ip, k.vhost,
  k.yuk_host, k.parametreler, k.durum, k.awx_server_id, k.awx_job_id, k.sw_dizin, k.sonuc, k.on_kontrol_ozet,
  k.gecerlilik, k.gecersiz_nedenleri, k.created_by, k.created_at, k.started_at, k.finished_at, k.finalized_at,
  k.iptal_eden, k.kilit_id, k.durdur_awx_server_id, k.durdur_awx_job_id, k.sonuclandirma_denemesi,
  k.hedef_turu, k.motor, k.plan_uyarilari, k.arac_id,
  s.ad AS senaryo_ad, DATEDIFF(SECOND, k.finished_at, GETUTCDATE()) AS yas_sn,
  DATEDIFF(SECOND, k.created_at, GETUTCDATE()) AS olusma_yas_sn`;

// Liste ucu: buyuk JSON kolonlari (sonuc, on kontrol ozeti, parametreler) TASINMAZ. Protokol
// parametreler JSON'undan LIKE ile (JSON_VALUE degil: DB uyumluluk seviyesi bilinmiyor; kanonik
// JSON bosluksuz JSON.stringify, deger h1|h2 enum).
const LISTE_KOLONLARI = `k.id, k.senaryo_id, k.on_kontrol_kosu_id, k.islem, k.etiket, k.adim, k.hedef_host, k.hedef_ip, k.vhost,
  k.yuk_host, k.durum, k.awx_server_id, k.awx_job_id, k.gecerlilik, k.created_by, k.created_at, k.started_at,
  k.finished_at, k.hedef_turu, k.motor, s.ad AS senaryo_ad,
  CASE WHEN k.parametreler LIKE '%"protokol":"h2"%' THEN 'h2' ELSE 'h1' END AS protokol`;

// Coklu karsilastirma (2026-11-04): buyuk JSON kolonlari (sonuc, on kontrol ozeti) TASINMAZ; parametreler (motor /
// protokol / is parcacigi / tavan) gerekli. En cok 16 satir, tek sorgu (IN listesi parametreli).
const COKLU_KOLONLARI = `k.id, k.senaryo_id, k.islem, k.etiket, k.hedef_host, k.hedef_ip, k.vhost, k.parametreler, k.durum, k.gecerlilik,
  k.created_by, k.created_at, k.hedef_turu, k.motor, s.ad AS senaryo_ad`;

// Toplu rapor (2026-11-04): coklu kolonlari + sure ve gecersizlik. `sonuc` yalniz burada: hazirlik kaniti ve olasi sizinti
// (portal_analiz) baska yerde yok; on kontrol ozeti tasinmaz. Kosu basina bir kez cozulur.
const RAPOR_KOLONLARI = `${COKLU_KOLONLARI}, k.started_at, k.finished_at, k.gecersiz_nedenleri, k.sonuc`;

/** Satirin motoru: liste kopyasi (kosular.motor), yoksa kanonik parametreler.motor, yoksa k6 (eski satir). */
function motorOf(x) {
  return (x && x.motor) || (jsonOku(x && x.parametreler) || {}).motor || 'k6';
}

/** Satirin protokolu: liste kolonu (protokol), yoksa kanonik parametreler.protokol, yoksa h1 (eski satir). */
function protokolOf(x) {
  const v = (x && x.protokol) || (jsonOku(x && x.parametreler) || {}).protokol;
  return v === 'h2' ? 'h2' : 'h1';
}

/** Saklanmis JSON metin dizisi (plan_uyarilari) -> string[] (bozuk / yok -> []). */
function metinDizisi(v) {
  const d = jsonOku(v);
  return Array.isArray(d) ? d.filter((s) => typeof s === 'string') : [];
}

/** Kosu ayrintisi ve Durdur kapisi AYNI hesabi gorsun: satirin durumu, AWX isi var mi, durdurma isi. */
function sunucuAyariOf(k, sonucOzet = jsonOku(k.sonuc), analizOzeti = sonucOzet && sonucOzet.portal_analiz && typeof sonucOzet.portal_analiz === 'object' ? sonucOzet.portal_analiz.ozet : null) {
  return gorunum.sunucuAyari(jsonOku(k.parametreler), sonucOzet, analizOzeti, {
    terminal: !AKTIF.has(k.durum), isVar: k.awx_job_id != null, durdurIs: k.durdur_awx_job_id ?? null,
  });
}

async function kosuOku(id) {
  const { rows } = await dbOku((d) =>
    d.query(`SELECT ${KOSU_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id WHERE k.id = $1`, [id]));
  return rows[0] || null;
}

async function senaryoOku(id) {
  const { rows } = await dbOku((d) =>
    d.query(
      `SELECT id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at, silindi
         FROM nginx_loadtest_senaryolar WHERE id = $1`,
      [id],
    ));
  return rows[0] || null;
}

// ── PLAN: kapilarin TAMAMI (on kontrol ve kosu AYNI fonksiyondan gecer) ───────────────────

/** Bugunku (tur 2) ip_hedefte_yok metni: hostun aday IP listesiyle. */
function ipHedefteYok(hedefIp, hedefHost, ay, ek) {
  return hata(409, 'ip_hedefte_yok', ay.ipler.length
    ? `${hedefIp}, ${hedefHost} için bilinen IP'lerden değil (${ay.ipler.join(', ')}).`
    : `${hedefHost} için bilinen bir IP yok (nginx taraması / envanter).`, ek);
}

/**
 * Senaryo + envanter + IP siniflandirmasi + ortam + yuk makinesi + Host basligi + sinirlar. Her
 * kosu baslatmasinda YENIDEN olculur (15 dk icinde envanter / limit / IP'nin sahibi degismis
 * olabilir). `hedefHost` istege bagli (null = yazilan IP siniflandirilir). Sira: kaynaklar ->
 * (hedefHost varsa) hedef kapisi -> ipSinifla -> sunucu: hedef / yuk makinesi kapisi, aday IP
 * savunmasi, vhost listede mi (D7: firlatma yok), sinirlar; serbest: yuk makinesi kapisi, serbest
 * sinirlari -> iki kipte Host basligi uretim kapisi (409 host_uretim) ve plan uyarilari. Sunucu hedefinde plan
 * uyarilarinin basinda olculmus limit_req / limit_conn asimi (dg.limitUyarilari; 2026-11-03'ten beri sinir degil uyari).
 */
async function kosuPlani({ senaryoId, hedefHost = null, hedefIp, vhost, yukHost, sni, parametrelerHam, etiket }) {
  const sen = await senaryoOku(senaryoId);
  if (!sen || sen.silindi === true || sen.silindi === 1) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı (silinmiş olabilir).');
  if (dg.sha256Hex(sen.tsv || '') !== String(sen.sha256 || '').trim()) {
    throw hata(409, 'senaryo_yok', 'Senaryonun içeriği kayıtlı özetiyle (sha256) uyuşmuyor; senaryoyu yeniden oluşturun.');
  }
  const { query, sql } = require('../inventory/mssql.cjs');
  const izinli = dg.yukHostlari();
  const aglar = dg.serbestAglar();
  const yasak = dg.serbestYasak();
  const k = await dg.kaynaklariOku({ query, sql, hostlar: [hedefHost, yukHost].filter(Boolean), ip: hedefIp, vhost });
  if (hedefHost) {
    const hk0 = dg.hedefKapisi(hedefHost, { nginxSatiri: k.nginx.get(hedefHost) || null, invEnv: k.inv.get(hedefHost) });
    if (!hk0.ok) throw kapidan(hk0);
  }
  const sinif = dg.ipSinifla(hedefIp, k, { aglar, yasak, hedefHost, yukHost });
  if (!sinif.ok) {
    if (sinif.code === 'ip_hedefte_yok' && hedefHost) throw ipHedefteYok(hedefIp, hedefHost, dg.hedefAyrintisi(k, hedefHost), { sahipler: sinif.sahipler });
    throw kapidan(sinif);
  }
  const yukKapisi = (hedef) => dg.yukHostKapisi(yukHost, {
    hedef, izinli, nginxSatiri: k.nginx.get(yukHost) || null, invEnv: k.inv.get(yukHost), invVar: k.inv.has(yukHost),
  });
  let env = null;
  let p;
  let vhostListede = null;
  let limitler = { limitReq: null, limitConn: null };
  if (sinif.tur === 'sunucu') {
    const host = sinif.host;
    const hk = dg.hedefKapisi(host, { nginxSatiri: k.nginx.get(host) || null, invEnv: k.inv.get(host) });
    if (!hk.ok) throw kapidan(hk);
    env = hk.env;
    const yk = yukKapisi(host);
    if (!yk.ok) throw kapidan(yk);
    const ay = dg.hedefAyrintisi(k, host);
    // Savunma: IP sunucunun aday listesinde (tarama listen + envanter IP'si) olmak ZORUNDA.
    if (!ay.ipler.includes(hedefIp)) throw ipHedefteYok(hedefIp, host, ay);
    // D7: listede olmayan Host basligi ENGEL degil (joker / regex server_name); denetime yazilir.
    vhostListede = Array.isArray(ay.vhostlar) ? ay.vhostlar.includes(vhost) : null;
    p = dg.parametreler(parametrelerHam, { sni, hedefTuru: 'sunucu' });
    limitler = { limitReq: ay.limitReq ?? null, limitConn: ay.limitConn ?? null };
  } else {
    const yk = yukKapisi(null);
    if (!yk.ok) throw kapidan(yk);
    p = dg.parametreler(parametrelerHam, { sni, hedefTuru: 'serbest' });
  }
  if (!p.ok) throw kapidan(p);
  const hb = dg.hostBasligiDegerlendir(vhost, k, { hedefTuru: sinif.tur, yukHost });
  if (!hb.ok) throw kapidan(hb);
  return {
    senaryo: { id: Number(sen.id), ad: sen.ad, tur: sen.senaryo_tur, tsv: sen.tsv, sha256: String(sen.sha256).trim() },
    hedefTuru: sinif.tur, hedefHost: sinif.tur === 'sunucu' ? sinif.host : null, hedefIp, vhost, yukHost, etiket: etiket || null, env,
    parametreler: p.deger, serbestAg: sinif.tur === 'serbest' ? sinif.ag : null, vhostListede,
    uyarilar: [...(sinif.tur === 'sunucu' ? dg.limitUyarilari(p.deger, limitler) : []), ...hb.uyarilar],
  };
}

async function kosuBasarisiz(kosuId, adim, sonuc, jobId = null, awxServerId = null) {
  await birKezTekrarla('basarisiz kosu satiri', () => db().query(
    `UPDATE nginx_loadtest_kosular
        SET durum = 'FAILED', adim = $2, sonuc = $3, awx_server_id = $4, awx_job_id = $5,
            finished_at = GETUTCDATE(), finalized_at = GETUTCDATE()
      WHERE id = $1 AND durum = 'QUEUED'`,
    [kosuId, adim, JSON.stringify(sonuc), awxServerId, jobId],
  ));
}

/**
 * Kilit -> satir (QUEUED) -> son kapi -> AWX -> kilidi ise bagla -> RUNNING.
 * Sablon kilitten ONCE cozulur: template yoksa ne kilit ne satir olusur.
 */
async function kosuyuBaslat(req, { islem, plan, onKontrolKosuId = null, onaylananUyarilar = [], beklenenAracId = null, kosuKaydedildi = null }) {
  const user = kullanici(req);
  const kullaniciAdi = String(user.username || 'unknown').slice(0, 100);
  const sablon = await baslat.sablonuCoz();
  // Arac kapisi: sablondan SONRA, kilitten ONCE (set yoksa ne kilit ne satir olusur).
  const aracSeti = await araclar.aracKapisi(db());
  const aracId = Number(aracSeti.id);
  if (beklenenAracId != null && Number(beklenenAracId) !== aracId) throw hata(409, 'on_kontrol_eski', araclar.MESAJ.onKontrolEski);
  const hedefTuru = plan.hedefTuru === 'serbest' ? 'serbest' : 'sunucu';
  const motor = plan.parametreler && plan.parametreler.motor === 'wrk' ? 'wrk' : 'k6';
  const anahtarlar = kilit.kilitAnahtarlari({ hedef: plan.hedefHost, hedefIp: plan.hedefIp, hedefTuru, yuk: plan.yukHost, kosu: islem === 'kosu' });
  const lockId = crypto.randomUUID();
  const runner = require('../ansible/runner.cjs');
  // Kilit aciklamasi (kilit_dolu mesajinda target_desc): k6 + sunucu metni tur 2 ile BIREBIR.
  const hedefMetni = plan.hedefHost || `${plan.hedefIp} (serbest)`;
  const planUyarilari = Array.isArray(plan.uyarilar) ? plan.uyarilar : [];
  // Sunucu ayarli on kontrol iptalde kilidi birakmaz (kilit.bagliIsKarari): hedef degismis kalmis olabilir.
  const bagTuru = poller.bagTuruOf({ islem, parametreler: plan.parametreler });
  let alinan;
  try {
    alinan = await kilit.acquireLocks(db(), anahtarlar, {
      lockId,
      holder: kullaniciAdi,
      desc: `${islem === 'kosu' ? 'yük testi' : 'ön kontrol'} ${hedefMetni} <- ${plan.yukHost}${motor === 'wrk' ? ' (wrk)' : ''}`,
      ttlMin: kilit.kilitSuresiDk(),
      // Durum da doner: bayat kilidin birakilip birakilmayacagina bag turuyle kural karar verir.
      isJobTerminal: async (sid, jid) => {
        const s = await runner.getJobStatusOnServer(sid, jid);
        return { terminal: TERMINAL.has(s.status), finished: s.finished || null, status: s.status };
      },
    });
  } catch (e) {
    console.warn('[NginxYukTesti] kilit alinamadi (DB) - is baslatilmadi:', maskele(e && e.message));
    // Onceki anahtarlar alinmis olabilir (G|global alindi, T|... satiri hata atti): birakilmazsa G
    // TTL boyunca var olmayan bir isi gosterirdi.
    await kilitleriBirak(anahtarlar, lockId);
    throw hata(424, 'db_okunamadi', 'İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar deneyin.');
  }
  if (!alinan.ok) throw hata(409, 'kilit_dolu', kilit.doluKilitMesaji(alinan.busyKey, alinan.busy), { kilit: alinan.busyKey });

  let kosuId;
  try {
    // kilit_id: Durdur kosunun kilitlerini (ise bagli olmasalar da) bu kimlikle durdur isine baglar.
    // Serbest satirda hedef_host '' (NULL'a cevrilmez); motor parametreler.motor'un liste kopyasi;
    // plan_uyarilari bos ise NULL (ekran ve kosu onayi ayni listeyi gorur).
    // 2026-11-04 (silme yarisi): kosu, dayandigi on kontrol satiri HALA VARSA yazilir. On kontrol okunduktan sonra
    // (plan / arac kontrolu uzun surer) silinirse INSERT 0 satir yazar: kopuk on_kontrol_kosu_id kalmaz. UPDLOCK +
    // HOLDLOCK: silme islemi bu satiri bu INSERT bitene dek alamaz (sonra bagli kosuyu gorur ve 409 on_kontrol_bagli).
    const ins = await db().query(
      `INSERT INTO nginx_loadtest_kosular (senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, durum, created_by, kilit_id, hedef_turu, motor, plan_uyarilari, arac_id)
       OUTPUT INSERTED.id
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'QUEUED', $10, $11, $12, $13, $14, $15
        WHERE $2 IS NULL OR EXISTS (SELECT 1 FROM nginx_loadtest_kosular o WITH (UPDLOCK, HOLDLOCK) WHERE o.id = $2 AND o.islem = 'on_kontrol')`,
      [plan.senaryo.id, onKontrolKosuId, islem, plan.etiket, plan.hedefHost || '', plan.hedefIp, plan.vhost, plan.yukHost, JSON.stringify(plan.parametreler), kullaniciAdi, lockId,
        hedefTuru, motor, planUyarilari.length ? JSON.stringify(planUyarilari) : null, aracId],
    );
    kosuId = Number(ins.rows && ins.rows[0] && ins.rows[0].id);
    if (!(kosuId > 0)) {
      if (onKontrolKosuId != null && ins.rows && !ins.rows.length) throw Object.assign(new Error('on kontrol silindi'), { onKontrolSilindi: true });
      throw new Error('koşu numarası dönmedi');
    }
  } catch (e) {
    await kilitleriBirak(anahtarlar, lockId);
    if (e && e.onKontrolSilindi) throw hata(409, 'on_kontrol_eski', `Ön kontrol #${onKontrolKosuId} bu arada silindi; iş başlatılmadı. Ön kontrolü yeniden çalıştırın.`);
    throw hata(424, 'db_okunamadi', `Koşu kaydı yazılamadı; iş başlatılmadı: ${maskele(e && e.message)}`);
  }
  const adim = `R${kosuId}`;
  // Gece kuyrugu (kuyruk.cjs): kosu numarasi AWX'e gitmeden ONCE kuyruk ogesine yazilir. Kosullu yazim tutmazsa
  // (kuyruk iptal / kira baska surecte) is BASLATILMAZ: kilit birakilir, satir FAILED.
  if (kosuKaydedildi) {
    try {
      await kosuKaydedildi(kosuId);
    } catch (e) {
      await kilitleriBirak(anahtarlar, lockId);
      await kosuBasarisiz(kosuId, adim, { hata: `kuyruk öğesine yazılamadı: ${maskele(e && e.message).slice(0, 500)}` });
      throw Object.assign(hata(409, 'kuyruk_yazilamadi', `Kuyruk öğesine yazılamadı; iş başlatılmadı: ${maskele(e && e.message)}`), { kosuYazilamadi: kosuId });
    }
  }
  const kok = dg.ciktiKok();
  const simdiSn = Math.floor(Date.now() / 1000);
  const ev = dg.ekstraDegiskenler({
    islem, kosuId, hedefHost: plan.hedefHost, yukHost: plan.yukHost, hedefIp: plan.hedefIp, vhost: plan.vhost,
    senaryo: plan.senaryo, p: plan.parametreler, kok, hedefTuru, arac: araclar.aracDegiskeni(aracSeti), simdiSn,
  });
  const ihlal = dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
  if (ihlal.length) {
    await kilitleriBirak(anahtarlar, lockId);
    await kosuBasarisiz(kosuId, adim, { hata: `son kapı: ${ihlal.join(', ')}` });
    throw hata(409, 'sinir_asildi', `Gönderilecek değişkenler son denetimi geçemedi: ${ihlal.join(', ')}.`);
  }
  let is;
  try {
    is = await baslat.isBaslat(req, {
      sablon,
      extraVars: ev,
      sablonAdi: `Nginx Yük Testi: ${islem === 'kosu' ? 'koşu' : 'ön kontrol'} ${adim} ${plan.hedefHost || plan.hedefIp}`,
      denetim: {
        eylem: islem === 'kosu' ? 'nginx_loadtest_baslat' : 'nginx_loadtest_on_kontrol',
        targetHost: plan.hedefHost || null,
        targetIp: plan.hedefIp,
        // Uzun diziler sonda. 2000 karaktere sigmazsa baslat.denetimAyrintisi once dizilerin ogelerini
        // kisaltir, sonra dizileri atar (sayilari kalir); kimlik alanlari her zaman kalir, JSON gecerli.
        ayrinti: {
          kosuId, adim, islem, hedefTuru, motor, hedefHost: plan.hedefHost || null, hedefIp: plan.hedefIp,
          vhost: plan.vhost, vhostListede: plan.vhostListede ?? null, serbestAg: plan.serbestAg ?? null,
          yukHost: plan.yukHost, senaryoId: plan.senaryo.id, senaryoSha256: plan.senaryo.sha256,
          parametreler: plan.parametreler, etiket: plan.etiket, onKontrolKosuId, aracId, planUyarilari, onaylananUyarilar,
        },
      },
    });
  } catch (e) {
    if (e && e.jobId != null) {
      // AWX degiskenleri yuttu, is baslatildi ve iptali denendi: kilit O ISE baglanir, is
      // terminale ulasinca supurme kurala gore birakir / tutar (iptal edilemediyse yuk kilitli kalir).
      await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: e.awxServerId, awxJobId: e.jobId, bagTuru }).catch(() => {});
    } else if (!(e && e.belirsiz)) {
      await kilitleriBirak(anahtarlar, lockId);
    }
    await kosuBasarisiz(kosuId, adim, { hata: maskele(e && e.message).slice(0, 1000), code: (e && e.code) || null, belirsiz: !!(e && e.belirsiz) },
      e && e.jobId != null ? e.jobId : null, e && e.jobId != null ? e.awxServerId : null);
    throw Object.assign(e, { kosuId });
  }
  try {
    await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: is.awxServerId, awxJobId: is.jobId, bagTuru });
  } catch (e) {
    // Kilit tam TTL ile alindi; baglanamamasi yalniz erken birakmayi geciktirir.
    console.warn('[NginxYukTesti] kilit isle baglanamadi (TTL ile dusecek):', maskele(e && e.message));
  }
  const swDizin = islem === 'kosu' ? dg.kosuDizini(kok, kosuId) : null;
  // Is numarasi HER ZAMAN yazilir (WHERE awx_job_id IS NULL); durum yalniz QUEUED ise RUNNING olur.
  // Baslatma surerken satir CANCELED (Durdur) / FAILED (bayat kuyruk) olduysa is takipsiz kalmasin:
  // hemen iptal edilir; kilitler o ise bagli kalir ve kural (kosu iptali) TTL'e kadar tutar.
  await birKezTekrarla('kosu satiri', () => db().query(
    `UPDATE nginx_loadtest_kosular
        SET adim = $2, awx_server_id = $3, awx_job_id = $4, sw_dizin = $5, started_at = GETUTCDATE(),
            durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END
      WHERE id = $1 AND awx_job_id IS NULL`,
    [kosuId, adim, is.awxServerId, is.jobId, swDizin],
  ));
  let sonDurum = null;
  try {
    const { rows } = await db().query(`SELECT durum FROM nginx_loadtest_kosular WHERE id = $1`, [kosuId]);
    sonDurum = rows && rows[0] ? rows[0].durum : null;
  } catch (e) {
    console.warn(`[NginxYukTesti] kosu ${kosuId} durumu baslatmadan sonra okunamadi:`, maskele(e && e.message));
  }
  if (sonDurum === 'CANCELED' || sonDurum === 'FAILED') {
    console.warn(`[NginxYukTesti] kosu ${kosuId} baslatilirken ${sonDurum} oldu; AWX is #${is.jobId} iptal ediliyor`);
    try {
      await runner.cancelJobOnServer(is.awxServerId, is.jobId);
    } catch (e) {
      console.warn(`[NginxYukTesti] AWX is #${is.jobId} iptal edilemedi (kilit TTL ile dusecek):`, maskele(e && e.message));
    }
  }
  return { kosuId, jobId: is.jobId, awxServerId: is.awxServerId };
}

/**
 * On kontrolden kosu: POST /kosular ve gece kuyrugu AYNI kapidan gecer (sahip, DONE/OK, 15 dk, onay metni, arac seti,
 * engel, uyari karari, plan YENIDEN, sinif / parametre degismemis). `uyariKarari(uyarilar)` onaylanmamis uyaride
 * firlatir; `yer.ok` hata yolunda denetim icin on kontrol satirini tasir.
 */
async function kosuyuOnKontroldenBaslat(req, { okId, confirmText, uyariKarari, kosuKaydedildi = null, yer = null }) {
  if (!okId) throw hata(400, 'gecersiz_istek', 'onKontrolKosuId gerekli (önce ön kontrolü çalıştırın).');
  const ok = await kosuOku(okId);
  if (yer) yer.ok = ok;
  if (!ok || ok.islem !== 'on_kontrol') throw hata(409, 'on_kontrol_eski', 'Ön kontrol bulunamadı; önce ön kontrolü çalıştırın.');
  if (!ayniKullanici(ok.created_by, kullanici(req).username)) {
    throw hata(409, 'on_kontrol_eski', 'Bu ön kontrol size ait değil; koşudan önce kendi ön kontrolünüzü çalıştırın.');
  }
  if (ok.durum !== 'DONE') throw hata(409, 'on_kontrol_eski', `Ön kontrol "${ok.durum}" durumunda; tamamlanmış (DONE) bir ön kontrol gerekli.`);
  const okSonuc = jsonOku(ok.sonuc);
  if (!okSonuc || String(okSonuc.durum || '').toUpperCase() !== 'OK') throw hata(409, 'on_kontrol_eski', 'Ön kontrol sonucu OK değil; yeniden çalıştırın.');
  const yas = ok.yas_sn == null ? null : Number(ok.yas_sn);
  if (yas == null || !Number.isFinite(yas) || yas > ON_KONTROL_MAX_YAS_SN || yas < -60) {
    throw hata(409, 'on_kontrol_eski', `Ön kontrol ${yas == null ? 'zamanı okunamadı' : `${Math.round(yas / 60)} dk önce bitti`}; en çok 15 dk önceki ön kontrol kabul edilir.`);
  }
  // Tur ve motor SATIRDAN (set_stats yankisindan degil); eski satir: DB varsayilani sunucu / k6.
  const tur = ok.hedef_turu || 'sunucu';
  const motor = motorOf(ok);
  if (tur === 'serbest' ? !dg.onayMetniDogru(confirmText, ok.hedef_ip) : !dg.onayMetniDogru(confirmText, ok.hedef_host)) {
    throw hata(409, 'onay_metni', tur === 'serbest'
      ? `Onay için hedef IP'yi (${ok.hedef_ip}) birebir yazın.`
      : `Onay için hedef sunucu adını (${ok.hedef_host}) birebir yazın.`);
  }
  // Tur 4: on kontrol etkin arac setiyle yapilmis olmali (degerlendirmeden ONCE). Set yoksa karar
  // kosuyuBaslat'taki arac kapisinda (sablondan sonra, kilitten once) verilir.
  if (ok.arac_id == null) throw hata(409, 'on_kontrol_eski', araclar.MESAJ.onKontrolAracsiz);
  let etkinArac;
  try {
    etkinArac = (await araclar.aracDurumu(db())).etkin;
  } catch {
    throw hata(424, 'db_okunamadi', araclar.MESAJ.okunamadi);
  }
  if (etkinArac && Number(etkinArac.id) !== Number(ok.arac_id)) throw hata(409, 'on_kontrol_eski', araclar.MESAJ.onKontrolEski);
  const deg = dg.onKontrolDegerlendir(jsonOku(ok.on_kontrol_ozet), { hedefTuru: tur, motor, aracli: true, aracSha256: araclar.motorSha(etkinArac, motor), protokol: protokolOf(ok), parametreler: jsonOku(ok.parametreler) });
  if (deg.engeller.length) throw hata(409, 'on_kontrol_eski', `Ön kontrol koşuya izin vermiyor: ${deg.engeller.join('; ')}.`, { engeller: deg.engeller });
  // Onaylanacak liste = on kontrolde saklanan plan uyarilari + on kontrol degerlendirmesi (ekranla ayni).
  const sakliPlanUyarilari = metinDizisi(ok.plan_uyarilari);
  const uyarilar = [...sakliPlanUyarilari, ...deg.uyarilar];
  // HTTP: kutu isaretli mi; gece kuyrugu: uyari TURLERI kuyrukta onaylanmis mi (kuyruk.cjs). Karar cagiranin.
  uyariKarari(uyarilar);
  // Parametreler ISTEMCIDEN DEGIL on kontrol satirindan; yeniden olculur ve ayni kalmali.
  const sakli = jsonOku(ok.parametreler) || {};
  const plan = await kosuPlani({
    senaryoId: Number(ok.senaryo_id), hedefHost: tur === 'serbest' ? null : ok.hedef_host, hedefIp: ok.hedef_ip, vhost: ok.vhost, yukHost: ok.yuk_host,
    sni: sakli.sni, parametrelerHam: sakli, etiket: ok.etiket,
  });
  if (plan.hedefTuru !== tur || (plan.hedefHost || '') !== (ok.hedef_host || '')) {
    throw hata(409, 'on_kontrol_eski', "Hedef IP'nin sınıfı ön kontrolden bu yana değişti; ön kontrolü yeniden çalıştırın.");
  }
  // Onaylanmamis uyari gecmez: yeniden kurulan planin saklanmayan uyarisi varsa on kontrol eskidir.
  const yeniUyari = plan.uyarilar.find((u) => !sakliPlanUyarilari.includes(u));
  if (yeniUyari) throw hata(409, 'on_kontrol_eski', `Ön kontrolden bu yana yeni uyarı çıktı (${yeniUyari}); ön kontrolü yeniden çalıştırın.`);
  // Protokolsuz (HTTP/2 seciminden once saklanmis) on kontrol h1 sayilir: dagitim oncesi on kontrol gecerli kalir.
  // Ayni kural sunucuAyar icin: alani olmayan eski on kontrol null sayilir. Sunucu ayari degisirse on kontrol eskir.
  if (kararliJson(plan.parametreler) !== kararliJson({ ...sakli, protokol: sakli.protokol ?? 'h1', sunucuAyar: sakli.sunucuAyar ?? null })) {
    throw hata(409, 'on_kontrol_eski', 'Parametreler ön kontrolden bu yana değişti; ön kontrolü yeniden çalıştırın.');
  }
  return kosuyuBaslat(req, { islem: 'kosu', plan, onKontrolKosuId: okId, onaylananUyarilar: uyarilar, beklenenAracId: Number(ok.arac_id), kosuKaydedildi });
}

// -- DURDURMA ISI ----------------------------------------------------------------------------

// Ayni kosu icin iki durdurma isi baslamasin: Durdur ucu iptalden sonra is baslatirken poller iptali gorup otomatik durdurma
// baslatabilirdi. Tek surec icin yeter; ikinci is zararsizdir (geri_al yedek yoksa no-op).
const durdurSuren = new Set();

/** Durdur kipindeki isi baslatir ve satira yazar; onceki durdurma isinin geri alma sonucu temizlenir. Hata FIRLATIR. */
async function durdurIsiBaslat(req, k, ayrinti = {}) {
  const id = Number(k.id);
  const tur = k.hedef_turu || 'sunucu';
  const motor = motorOf(k);
  const sen = await senaryoOku(Number(k.senaryo_id));
  const p = jsonOku(k.parametreler);
  if (!sen || !p) throw hata(409, 'senaryo_yok', 'Koşunun senaryosu ya da parametreleri okunamadı.');
  const simdiSn = Math.floor(Date.now() / 1000);
  const ev = dg.ekstraDegiskenler({
    islem: 'durdur', kosuId: id, hedefHost: k.hedef_host, yukHost: k.yuk_host, hedefIp: k.hedef_ip, vhost: k.vhost,
    senaryo: { tur: sen.senaryo_tur, tsv: sen.tsv, sha256: String(sen.sha256).trim() }, p: { ...p, motor }, kok: dg.ciktiKok(),
    hedefTuru: tur, arac: null, simdiSn,
  });
  const ihlal = dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
  if (ihlal.length) throw hata(409, 'sinir_asildi', `Durdurma değişkenleri son denetimi geçemedi: ${ihlal.join(', ')}.`);
  const is = await baslat.isBaslat(req, {
    sablon: await baslat.sablonuCoz(),
    extraVars: ev,
    sablonAdi: `Nginx Yük Testi: durdur R${id} ${k.hedef_host || k.hedef_ip}`,
    denetim: {
      eylem: 'nginx_loadtest_durdur', targetHost: k.hedef_host || null, targetIp: k.hedef_ip,
      ayrinti: { kosuId: id, hedefTuru: tur, motor, ...ayrinti },
    },
  });
  await birKezTekrarla('durdur isi', () => db().query(
    `UPDATE nginx_loadtest_kosular SET durdur_awx_server_id = $2, durdur_awx_job_id = $3 WHERE id = $1`, [id, is.awxServerId, is.jobId]));
  const s = jsonOku(k.sonuc);
  if (s && typeof s === 'object' && s.durdur_geri_alma) {
    const { durdur_geri_alma: _, ...kalan } = s;
    await birKezTekrarla('durdur sonucu', () => db().query(`UPDATE nginx_loadtest_kosular SET sonuc = $2 WHERE id = $1`, [id, JSON.stringify(kalan)]));
  }
  return { jobId: is.jobId, awxServerId: is.awxServerId };
}

/**
 * Kosuyu durdurur: AWX iptali + (gerekirse) durdur kipi is, kilitlerin ona baglanmasi. POST /kosular/:id/durdur ve kuyruk
 * duraklatma ortak. Hata FIRLATIR; `yer.k` okunan satir (cagiran ret denetimine hedef yazar). Donus: yanit alanlari.
 */
async function kosuyuDurdur(req, id, yer = {}) {
  const k = await kosuOku(id);
  yer.k = k;
  if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
  // Tamamlanmis kosuda yalniz geri alinamamis sunucu ayari icin (Play 7 kosmadi ya da hata verdi).
  if (k.durum === 'DONE' && sunucuAyariOf(k)?.geriAlma?.durum !== 'hata') throw hata(409, 'kosu_bitti', 'Koşu tamamlanmış; durdurulacak bir şey yok.');
  const sid = k.awx_server_id == null ? null : Number(k.awx_server_id);
  const jid = k.awx_job_id == null ? null : Number(k.awx_job_id);
  // Baslatma suruyor (is numarasi henuz yazilmadi): durdur satiri CANCELED yapar, sonra donen is
  // takipsiz kalirdi. Pencere icinde reddet; daha eski yarim satir eskisi gibi kapanir.
  if (k.durum === 'QUEUED' && !(jid > 0)) {
    const yas = k.olusma_yas_sn == null ? NaN : Number(k.olusma_yas_sn);
    if (!Number.isFinite(yas) || yas < BASLATMA_PENCERESI_SN) {
      throw hata(409, 'baslatiliyor', 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.');
    }
  }
  const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
  durdurSuren.add(id);
  try {
    const sonuc = { iptal: null, iptalHatasi: null, durdurIsi: null, durdurHatasi: null };
    const runner = require('../ansible/runner.cjs');
    // Durdurmada siniflandirma YENIDEN YAPILMAZ: tur ve motor satirdan (eski satir: sunucu / k6; durdurIsiBaslat da satirdan).
    const tur = k.hedef_turu || 'sunucu';
    const motor = motorOf(k);
    if (sid != null && jid > 0) {
      try {
        sonuc.iptal = await runner.cancelJobOnServer(sid, jid);
      } catch (e) {
        sonuc.iptalHatasi = maskele(e && e.message).slice(0, 500);
      }
    }
    const iptalOldu = !!(sonuc.iptal && (sonuc.iptal.canceled || sonuc.iptal.alreadyTerminal));
    // AWX iptali uzaktaki async gorevi ve ayrik k6'yi DURDURMAZ: durdur kipindeki playbook kosu
    // dizinindeki pid'leri ve dizine bagli k6'yi sonlandirir. Ortam kapisi BURADA YOK: durdurmak
    // her zaman serbest (CANCELED / FAILED kosuda da: kalan surec temizligi).
    // Sunucu ayarli on kontrol da durdurma isi ister: AWX iptali temizlik play'ini kosturmaz ve hedefteki konf
    // degistirilmis kalirdi (geri alma durdur kipinde hedefteki yedege gore calisir).
    const srvOnKontrol = k.islem === 'on_kontrol' && !!(jsonOku(k.parametreler) || {}).sunucuAyar;
    if (k.islem === 'kosu' || srvOnKontrol) {
      try {
        sonuc.durdurIsi = await durdurIsiBaslat(req, k, { iptal: sonuc.iptal, iptalHatasi: sonuc.iptalHatasi });
      } catch (e) {
        sonuc.durdurHatasi = maskele(e && e.message).slice(0, 500);
      }
    }
    await dbOku((d) => d.query(`UPDATE nginx_loadtest_kosular SET iptal_eden = $2 WHERE id = $1`, [id, kim]));
    // Hic AWX isi olmayan (baslatmasi yarim kalmis) satir dogrudan kapanir.
    if (sid == null || !(jid > 0)) {
      await dbOku((d) => d.query(
        `UPDATE nginx_loadtest_kosular SET durum = 'CANCELED', finalized_at = GETUTCDATE(), finished_at = COALESCE(finished_at, GETUTCDATE())
          WHERE id = $1 AND durum = 'QUEUED' AND awx_job_id IS NULL`, [id]));
    }
    if (sonuc.durdurIsi) {
      const d = sonuc.durdurIsi;
      // Kosunun kilitleri durdur isine baglanir: is basariyla biterse (iki sunucu da "kalan surec
      // yok") supurme hemen birakir, aksi halde TTL (en az butce + 180 sn). Iptal BASARISIZSA kosu
      // isi hala calisiyor olabilir: kilit o ise bagli kalir (durdur isinin basarisi birakmasin).
      if (k.kilit_id && (iptalOldu || sid == null || !(jid > 0))) {
        try {
          await kilit.durdurIsineBagla(db(), k.kilit_id, { awxServerId: d.awxServerId, awxJobId: d.jobId, uzatSn: poller.butceSnOf(k) + KILIT_EK_SN });
        } catch (e) {
          console.warn(`[NginxYukTesti] kosu ${id} kilitleri durdur isine baglanamadi (TTL ile dusecek):`, maskele(e && e.message));
        }
      }
    }
    // Kosu: durdurma isi yoksa uzaktaki yuk surebilir; iptal basarili olsa da BASARI DEGIL. Metin
    // motor ve ture gore (k6 + sunucu tur 2 ile birebir; serbestte hedefte kaydedici yok).
    if ((k.islem === 'kosu' || srvOnKontrol) && !sonuc.durdurIsi) {
      const uzaktaki = srvOnKontrol ? 'konfigürasyon değişikliği' : tur === 'serbest' ? motor : `${motor} / kaydedici`;
      throw hata(424, 'durdur_baslatilamadi',
        `AWX işi ${iptalOldu ? 'iptal edildi' : 'iptal edilemedi'}, ancak durdurma işi başlatılamadı: ${sonuc.durdurHatasi}. Uzaktaki ${uzaktaki} sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.`,
        { iptal: sonuc.iptal, iptalHatasi: sonuc.iptalHatasi, durdurHatasi: sonuc.durdurHatasi });
    }
    if (!iptalOldu && !sonuc.durdurIsi && sid != null && jid > 0) {
      throw hata(424, 'awx_okunamadi', `Durdurulamadı: ${[sonuc.iptalHatasi, sonuc.durdurHatasi].filter(Boolean).join(' / ') || 'AWX yanıt vermedi'}`);
    }
    // Durdur isi baslatildiysa denetimi isBaslat yazdi; yoksa (on kontrol / is numarasiz satir) burada.
    if (!sonuc.durdurIsi) {
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_durdur', {
          result: sonuc.iptal && sonuc.iptal.canceled ? 'ok' : 'fail',
          targetHost: k.hedef_host || null, targetIp: k.hedef_ip,
          detail: baslat.denetimAyrintisi({ kosuId: id, ...sonuc }),
        });
      } catch {
        /* best-effort */
      }
    }
    return sonuc;
  } finally {
    durdurSuren.delete(id);
  }
}

/** Poller: temizlik play'i kosmadan biten sunucu ayarli is. Satir taze okunur; durdurma isi varsa ya da Durdur suruyorsa null. */
async function otoDurdur(satir) {
  const id = Number(satir.id);
  if (durdurSuren.has(id)) return null;
  durdurSuren.add(id);
  try {
    const k = await kosuOku(id);
    if (!k || k.durdur_awx_job_id != null) return null;
    console.warn(`[NginxYukTesti] kosu ${id}: geri alma sonucu yok, otomatik durdurma isi baslatiliyor`);
    return await durdurIsiBaslat(kuyrukIstegi(k.created_by), k, { otomatik: true });
  } finally {
    durdurSuren.delete(id);
  }
}

// -- GECE KUYRUGU (kuyruk.cjs) ---------------------------------------------------------------

/** Kuyruk yurutucusunun istegi: kuyrugu olusturan kullanici adina (denetim ve AWX atfi onun adiyla). */
function kuyrukIstegi(kullaniciAdi) {
  return { session: { user: { username: String(kullaniciAdi || 'unknown'), role: 'Admin', authSource: 'kuyruk' } }, sessionID: null, ip: null, body: {} };
}

/**
 * Kuyrugu olusturanin yetkisi her ogeden once: rol degisikligi (user_role_overrides, etkin) Admin degilse duser.
 * LDAP grubundan cikarilma oturumsuz olculemez (bkz. belge, "Gece kuyrugu"). DB hatasi FIRLATILIR (gecici).
 */
async function kuyrukYetkisi(kullaniciAdi) {
  const ad = String(kullaniciAdi || '').trim().toLowerCase();
  if (!ad) return { ok: false, neden: 'kuyruğu oluşturan kullanıcı bilinmiyor' };
  const { rows } = await db().query(`SELECT role FROM user_role_overrides WHERE LOWER(username) = $1 AND is_active = 1`, [ad]);
  const rol = rows && rows[0] ? rows[0].role : null;
  if (rol != null && rol !== 'Admin') return { ok: false, neden: `${ad} kullanıcısının rolü artık ${String(rol).slice(0, 30)} (Admin değil)` };
  return { ok: true };
}

/** Yurutucunun index.cjs'ten kullandigi islemler (mevcut kapilar; kuyruk kendi kapisi yazmaz). */
const kuyrukIslem = {
  yetkiVarMi: kuyrukYetkisi,
  plan: (g) => kosuPlani(g),
  kosuOku: (id) => kosuOku(id),
  onKontrolBaslat: (kullaniciAdi, plan, kosuKaydedildi) => kosuyuBaslat(kuyrukIstegi(kullaniciAdi), { islem: 'on_kontrol', plan, kosuKaydedildi }),
  kosuBaslat: (kullaniciAdi, { okId, confirmText, onaylananTurler, kosuKaydedildi }) => kosuyuOnKontroldenBaslat(kuyrukIstegi(kullaniciAdi), {
    okId, confirmText, kosuKaydedildi, uyariKarari: kuyruk.uyariKarariOf(onaylananTurler),
  }),
};

/**
 * Ogeye bagli on kontrolun uyarilari (olusturmada onaya gelir). Sahip, DONE, ayni hedef sart. Olcum on kontrolden, degerlendirme
 * OGENIN parametreleriyle: toplu eklemede tek on kontrol farkli kip / protokollu ogelere baglanir (kip 'yeni' port uyarisi).
 */
async function ogeOnKontrolUyarilari(okId, kullaniciAdi, onayHedefi, no, parametreler) {
  const ok = await kosuOku(okId);
  if (!ok || ok.islem !== 'on_kontrol') throw hata(409, 'on_kontrol_eski', `Öğe ${no}: ön kontrol #${okId} bulunamadı.`, { oge: no });
  if (!ayniKullanici(ok.created_by, kullaniciAdi)) throw hata(409, 'on_kontrol_eski', `Öğe ${no}: ön kontrol #${okId} size ait değil.`, { oge: no });
  if (ok.durum !== 'DONE') throw hata(409, 'on_kontrol_eski', `Öğe ${no}: ön kontrol #${okId} "${ok.durum}" durumunda.`, { oge: no });
  const tur = ok.hedef_turu || 'sunucu';
  if ((tur === 'serbest' ? ok.hedef_ip : ok.hedef_host) !== onayHedefi) throw hata(409, 'hedef_farkli', `Öğe ${no}: ön kontrol #${okId} başka bir hedefin.`, { oge: no });
  const deg = dg.onKontrolDegerlendir(jsonOku(ok.on_kontrol_ozet), {
    hedefTuru: tur, motor: motorOf(ok), aracli: ok.arac_id != null, aracSha256: null, protokol: protokolOf(ok), parametreler,
  });
  return [...metinDizisi(ok.plan_uyarilari), ...deg.uyarilar];
}

/** Ogenin saklanan bicimi (olusturma ve duzenleme ortak): kanonik govde ve butce (hazirlik payi dahil). */
function ogeKaydi(og, plan) {
  return {
    butceSn: (Number(plan.parametreler.butceSn) + kuyruk.hazirlikPayiSn(plan.parametreler)) || null,
    govde: { senaryoId: og.senaryoId, hedefHost: og.hedefHost, hedefIp: og.hedefIp, vhost: og.vhost, yukHost: og.yukHost, sni: og.sni, parametreler: plan.parametreler },
  };
}

function ogeNo(e, no) {
  if (e && typeof e.message === 'string' && !/^Öğe \d+:/.test(e.message)) e.message = `Öğe ${no}: ${e.message}`;
  return Object.assign(e, { oge: no });
}

/** Verilen kosu numaralarindan Portal DB'de DURANLAR (Set); okunamazsa null (gosterim eksik kalir, hata degil). */
async function mevcutKosular(idler) {
  const ids = [...new Set(idler.filter((v) => v != null).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return new Set();
  try {
    const { rows } = await db().query(`SELECT /*SIL:mevcut*/ id FROM nginx_loadtest_kosular WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ids);
    return new Set((rows || []).map((r) => Number(r.id)));
  } catch (e) {
    console.warn('[NginxYukTesti] kuyruk kosulari okunamadi (silindi bilgisi yok):', maskele(e && e.message));
    return null;
  }
}

/**
 * Duraklatilmis kuyrugun ekran bilgisi (yalniz aktif + bayrakli kuyruk; digerine bos). Ekranin "sunucuda islem yapabilirsiniz"
 * demesi icin kuyrugun durumu yetmez: `hedefMesgul` hedef kilidi dolu ya da geri alma sonucu bekleniyor (kuyrugun izlemedigi is
 * de olabilir), `geriAlmaSorunu` hedefin son sunucu ayarli isi geri alinamadi (kilit bu durumda da birakilir). Okunamazsa mesgul
 * sayilir: bilinmeyen hali "dokunabilirsiniz" diye gostermek yanlis yondedir. `calisanVar`: liste ogeleri tasimaz.
 */
async function duraklatmaBilgisi(k) {
  if (k.duraklat_at == null || !kuyruk.AKTIF_KUYRUK.has(k.durum)) return {};
  try {
    const calisanVar = !!(await dbOku((d) => d.query(kuyruk.SQL.calisanOge, [k.id]))).rows[0];
    const { rows: kr } = await dbOku((d) => d.query(kuyruk.SQL.hedefKilitli, [kuyruk.hedefKilitAnahtari(k)]));
    let hedefMesgul = Number(kr[0] && kr[0].n) > 0;
    let geriAlmaSorunu = null;
    const sonId = k.hedef_turu === 'serbest' ? null : (await dbOku((d) => d.query(kuyruk.SQL.sonAyarliKosu, [k.onay_hedefi]))).rows[0]?.id;
    const son = sonId == null ? null : await kosuOku(Number(sonId));
    if (son) {
      const ga = sunucuAyariOf(son)?.geriAlma;
      if (AKTIF.has(son.durum) || ga?.durum === 'bekliyor') hedefMesgul = true;
      else if (ga?.durum === 'hata') geriAlmaSorunu = { kosuId: Number(son.id), metin: ga.metin };
    }
    return { calisanVar, hedefMesgul, geriAlmaSorunu };
  } catch (e) {
    console.warn(`[NginxYukTesti kuyruk] kuyruk ${k.id} hedef durumu okunamadi (mesgul sayildi):`, maskele(e && e.message));
    return { calisanVar: false, hedefMesgul: true, geriAlmaSorunu: null };
  }
}

async function kuyrukOkuApi(id) {
  const { rows } = await dbOku((d) => d.query(kuyruk.SQL.kuyrukOku, [id]));
  const k = rows[0];
  if (!k) return null;
  const { rows: ogeler } = await dbOku((d) => d.query(kuyruk.SQL.ogeListe, [id]));
  const z = kuyruk.zamanlama(k, ogeler);
  const mevcut = await mevcutKosular(ogeler.flatMap((o) => [o.kosu_id, o.on_kontrol_kosu_id]));
  return {
    kuyruk: { ...kuyruk.kuyrukApi(k), ...await duraklatmaBilgisi(k), tahminiBitis: z.tahminiBitis, siradakiKalanSn: z.siradakiKalanSn, sunucuZamani: new Date().toISOString() },
    ogeler: ogeler.map((o) => ({
      ...kuyruk.ogeApi(o),
      ...(z.ogeler.get(Number(o.id)) || {}),
      // Kosu silme (2026-11-04): bitmis ogenin numarasi kalir; satiri silinmisse ekran "silindi" gosterir. Okunamazsa alan yok.
      ...(mevcut ? { kosuSilindi: o.kosu_id != null && !mevcut.has(Number(o.kosu_id)), onKontrolSilindi: o.on_kontrol_kosu_id != null && !mevcut.has(Number(o.on_kontrol_kosu_id)) } : {}),
    })),
  };
}

// ── UCLAR ─────────────────────────────────────────────────────────────────────────────────

function adminSart(req) {
  if (!isAdmin(req)) throw hata(403, 'yetki_yok', 'Yük testi işlemleri yalnız Admin.');
}

function onKontrolGovdesi(b) {
  const g = b && typeof b === 'object' ? b : {};
  const senaryoId = sayi(g.senaryoId);
  if (!senaryoId) throw hata(400, 'gecersiz_istek', 'senaryoId gerekli.');
  // Hedef host ISTEGE BAGLI (host secici): yoksa yazilan IP siniflandirilir. Verilmis ama gecersizse 400.
  let hedefHost = null;
  if (g.hedefHost !== undefined && g.hedefHost !== null && g.hedefHost !== '') {
    hedefHost = dg.hostNormalle(g.hedefHost);
    if (!hedefHost) throw hata(400, 'gecersiz_istek', 'Geçersiz hedef sunucu adı.');
  }
  const yukHost = dg.hostNormalle(g.yukHost);
  if (!yukHost) throw hata(400, 'gecersiz_istek', 'Geçersiz yük makinesi adı.');
  const hedefIp = typeof g.hedefIp === 'string' ? g.hedefIp.trim() : '';
  if (!dg.gecerliIpv4(hedefIp)) throw hata(400, 'gecersiz_istek', 'hedefIp noktalı IPv4 olmalı.');
  const vhost = typeof g.vhost === 'string' ? g.vhost.trim().toLowerCase() : '';
  if (!dg.gecerliVhost(vhost)) throw hata(400, 'gecersiz_istek', 'vhost geçerli bir ad olmalı (küçük harf, port / joker / regex yok).');
  if (typeof g.sni !== 'boolean') throw hata(400, 'gecersiz_istek', 'sni true/false olmalı.');
  const e = dg.etiket(g.etiket);
  if (!e.ok) throw kapidan(e);
  return { senaryoId, hedefHost, hedefIp, vhost, yukHost, sni: g.sni, parametrelerHam: g.parametreler, etiket: e.deger };
}

function yonlendiriciKur() {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(requireAuth);
  // SALT OKUNUR ERISIM: sekmesi acilan Admin olmayan kullanici sonuclari OKUR; baslatma, durdurma,
  // senaryo yazma ve canli is ciktisi (/durum) Admin'de kalir.
  let gorunurlukKapisi = false;
  const okumaKapisi = adminOkumaKapisi({
    okuma: ADMIN_DISI_OKUMA,
    mesaj: 'Yük testi işlemleri yalnız Admin.',
    hazir: () => gorunurlukKapisi,
  });
  // Kosu silme: kosuyu baslatan kisi de silebilir (Admin olmasa da); yalniz bu iki uc, gorunurluk motoru kuruluysa.
  router.use((req, res, next) => {
    if (!isAdmin(req) && gorunurlukKapisi && SAHIP_SILME.some((u) => u.method === req.method && u.yol.test(req.path))) return next();
    return okumaKapisi(req, res, next);
  });
  try {
    const { requireVisiblePrefix, requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('NginxConsole'));
    router.use(requireVisible('tab:nginx:yuktesti'));
    gorunurlukKapisi = true;
  } catch {
    /* motor yoksa: hazir() false kalir, Admin olmayan hicbir uca gecemez */
  }

  router.get('/hedefler', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { envOfHost } = require('../audit/nginx-hosts.cjs');
      const izinli = dg.yukHostlari();
      const k = await dg.kaynaklariOku({ query, sql, ekHostlar: izinli });
      const hedefler = [...k.nginx.keys()].sort().map((h) => {
        const kp = dg.hedefKapisi(h, { nginxSatiri: k.nginx.get(h), invEnv: k.inv.get(h) });
        if (!kp.ok) return { host: h, env: envOfHost(h), ipler: [], vhostlar: [], vhostVerisi: false, uygun: false, neden: kp.message, kod: kp.code, hizSiniri: null, vuSiniri: null, limitReq: null, limitConn: null };
        const ay = dg.hedefAyrintisi(k, h);
        // B3: olculmus cok kucuk limit (eski "sifir sinir") hedefi KAPATMAZ; asim plan uyarisidir (limitUyarilari).
        const ipYok = ay.ipler.length === 0;
        return {
          host: h, env: kp.env, ipler: ay.ipler, vhostlar: ay.vhostlar || [], vhostVerisi: Array.isArray(ay.vhostlar),
          uygun: !ipYok,
          neden: ipYok ? 'Bilinen IP yok (nginx taraması / envanter).' : null,
          kod: ipYok ? 'ip_hedefte_yok' : null,
          hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri, limitReq: ay.limitReq ?? null, limitConn: ay.limitConn ?? null,
        };
      });
      hedefler.sort((a, b) => Number(b.uygun) - Number(a.uygun) || a.host.localeCompare(b.host));
      const yukHostlari = izinli.map((h) => {
        const y = dg.yukHostKapisi(h, { izinli, nginxSatiri: k.nginx.get(h) || null, invEnv: k.inv.get(h), invVar: k.inv.has(h) });
        return { host: h, env: envOfHost(h), uygun: y.ok, neden: y.ok ? null : y.message };
      });
      // Serbest hedef izin listesi: acik mi herkese, aglarin kendisi YALNIZ Admin'e.
      const aglar = dg.serbestAglar();
      res.json({
        ok: true, hedefler, yukHostlari, sinirlar: dg.SINIRLAR, varsayilan: dg.VARSAYILAN,
        taramaVerisi: k.sunucular !== null, rateLimitVerisi: k.ayarlar !== null,
        serbest: { acik: aglar.length > 0, aglar: isAdmin(req) ? aglar.map((a) => a.metin) : [] },
        motorlar: [...dg.MOTORLAR],
        protokoller: [...dg.PROTOKOLLER],
        // Tur 4: arac seti durumu (DB okunamazsa hazir:false + db_okunamadi; uc 200 kalir).
        araclar: await araclar.aracDurumuEkran(db()),
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Yazilan IP'nin sinifi (ekran yalniz GOSTERIR; kesin karar on kontrol / kosu kapisinda yeniden
  // verilir). Yalniz Admin (ADMIN_DISI_OKUMA'da YOK); Portal DB'ye ve denetime YAZMAZ. Akis
  // kosuPlani ile ayni sira: kaynaklar -> (hedefHost varsa) hedef kapisi -> ipSinifla.
  router.get('/ip-sinifi', async (req, res) => {
    try {
      adminSart(req);
      const q = req.query || {};
      const ip = typeof q.ip === 'string' ? q.ip.trim() : '';
      if (!dg.gecerliIpv4(ip)) throw hata(400, 'gecersiz_istek', 'ip noktalı IPv4 olmalı.');
      const hostAl = (ad) => {
        const v = q[ad];
        if (v === undefined || v === '') return null;
        const h = typeof v === 'string' ? dg.hostNormalle(v) : '';
        if (!h) throw hata(400, 'gecersiz_istek', `Geçersiz ${ad === 'yukHost' ? 'yük makinesi' : 'hedef sunucu'} adı.`);
        return h;
      };
      const yukHost = hostAl('yukHost');
      const hedefHost = hostAl('hedefHost');
      const { query, sql } = require('../inventory/mssql.cjs');
      const k = await dg.kaynaklariOku({ query, sql, hostlar: [hedefHost, yukHost].filter(Boolean), ip });
      if (hedefHost) {
        const hk0 = dg.hedefKapisi(hedefHost, { nginxSatiri: k.nginx.get(hedefHost) || null, invEnv: k.inv.get(hedefHost) });
        if (!hk0.ok) throw kapidan(hk0);
      }
      const sinif = dg.ipSinifla(ip, k, { aglar: dg.serbestAglar(), yasak: dg.serbestYasak(), hedefHost, yukHost });
      if (!sinif.ok) {
        if (sinif.code === 'ip_hedefte_yok' && hedefHost) throw ipHedefteYok(ip, hedefHost, dg.hedefAyrintisi(k, hedefHost), { sahipler: sinif.sahipler });
        throw kapidan(sinif);
      }
      if (sinif.tur === 'serbest') {
        return res.json({ ok: true, tur: 'serbest', ip, host: null, ag: sinif.ag, digerSahipler: sinif.digerSahipler });
      }
      // Sunucu: /hedefler satiriyla AYNI alanlar; uygun:false da 200 (ekran on kontrol dugmesini kapatir).
      const h = sinif.host;
      const kaynaklar = [...((k.ipSahipleri && k.ipSahipleri.get(h)) || [])].sort();
      const kp = dg.hedefKapisi(h, { nginxSatiri: k.nginx.get(h) || null, invEnv: k.inv.get(h) });
      if (!kp.ok) {
        const { envOfHost } = require('../audit/nginx-hosts.cjs');
        return res.json({
          ok: true, tur: 'sunucu', ip, host: h, env: envOfHost(h), vhostlar: [], vhostVerisi: false, hizSiniri: null, vuSiniri: null, limitReq: null, limitConn: null,
          uygun: false, neden: kp.message, kod: kp.code, kaynaklar,
        });
      }
      const ay = dg.hedefAyrintisi(k, h);
      const adaySiz = !ay.ipler.includes(ip);
      res.json({
        ok: true, tur: 'sunucu', ip, host: h, env: kp.env, vhostlar: ay.vhostlar || [], vhostVerisi: Array.isArray(ay.vhostlar),
        hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri, limitReq: ay.limitReq ?? null, limitConn: ay.limitConn ?? null,
        uygun: !adaySiz,
        neden: adaySiz ? ipHedefteYok(ip, h, ay).message : null,
        kod: adaySiz ? 'ip_hedefte_yok' : null,
        kaynaklar,
      });
    } catch (e) {
      // Eylem yok: salt okunur siniflandirma denetime yazilmaz.
      hataYaniti(req, res, e);
    }
  });

  router.get('/senaryolar', async (req, res) => {
    try {
      const { rows } = await dbOku((d) => d.query(
        `SELECT TOP 200 id, ad, aciklama, vhost, senaryo_tur, yol_sayisi, sha256, kaynak, created_by, created_at
           FROM nginx_loadtest_senaryolar WHERE silindi = 0 ORDER BY id DESC`,
      ));
      res.json({ ok: true, senaryolar: rows.map(senaryoApi) });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/senaryolar/:id', async (req, res) => {
    try {
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz senaryo numarası.');
      const s = await senaryoOku(id);
      if (!s || s.silindi === true || s.silindi === 1) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı (silinmiş olabilir).');
      res.json({ ok: true, senaryo: { ...senaryoApi(s), tsv: s.tsv, ozet: jsonOku(s.ozet) } });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/senaryolar', async (req, res) => {
    try {
      adminSart(req);
      const v = dg.senaryoGovdesi(req.body);
      if (!v.ok) throw kapidan(v);
      const s = v.deger;
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const { rows } = await dbOku((d) => d.query(
        `INSERT INTO nginx_loadtest_senaryolar (ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [s.ad, s.aciklama, s.vhost, s.senaryoTur, s.tsv, s.sha256, s.yolSayisi, s.ozet, s.kaynak, kim],
      ));
      const id = Number(rows[0] && rows[0].id);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_senaryo_ekle', {
          detail: baslat.denetimAyrintisi({ id, ad: s.ad, vhost: s.vhost, senaryoTur: s.senaryoTur, kaynak: s.kaynak, yolSayisi: s.yolSayisi, sha256: s.sha256 }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, id });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Yalniz ad / aciklama / vhost. tsv ve sha256 DEGISMEZ: gecmis kosular ayni icerige bagli, durdurma da onu okur.
  router.put('/senaryolar/:id', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz senaryo numarası.');
      const v = dg.senaryoBilgisi(req.body);
      if (!v.ok) throw kapidan(v);
      const s = v.deger;
      const r = await dbOku((d) => d.query(`UPDATE nginx_loadtest_senaryolar SET ad = $2, aciklama = $3, vhost = $4 WHERE id = $1 AND silindi = 0`, [id, s.ad, s.aciklama, s.vhost]));
      if (!r.rowCount) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı ya da silinmiş.');
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_senaryo_guncelle', { detail: baslat.denetimAyrintisi({ id, ad: s.ad, vhost: s.vhost }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_senaryo_guncelle');
    }
  });

  router.delete('/senaryolar/:id', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz senaryo numarası.');
      // Yumusak silme: gecmis kosular senaryo govdesine (durdurma dahil) erismeye devam eder.
      const r = await dbOku((d) => d.query(`UPDATE nginx_loadtest_senaryolar SET silindi = 1 WHERE id = $1 AND silindi = 0`, [id]));
      if (!r.rowCount) throw hata(409, 'senaryo_yok', 'Senaryo bulunamadı ya da zaten silinmiş.');
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_senaryo_sil', { detail: baslat.denetimAyrintisi({ id }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/kosular/on-kontrol', async (req, res) => {
    let g = null;
    try {
      adminSart(req);
      g = onKontrolGovdesi(req.body);
      const plan = await kosuPlani(g);
      const r = await kosuyuBaslat(req, { islem: 'on_kontrol', plan });
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_on_kontrol', g ? { host: g.hedefHost, ip: g.hedefIp, kosuId: e && e.kosuId } : null);
    }
  });

  router.post('/kosular', async (req, res) => {
    const yer = { ok: null };
    try {
      adminSart(req);
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const r = await kosuyuOnKontroldenBaslat(req, {
        okId: sayi(b.onKontrolKosuId), confirmText: b.confirmText, yer,
        uyariKarari: (uyarilar) => {
          if (uyarilar.length && b.uyariOnay !== true) throw hata(409, 'uyari_onayi', 'Ön kontrol uyarılarını okuyup açıkça onaylamanız gerekiyor.', { uyarilar });
        },
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      const ok = yer.ok;
      hataYaniti(req, res, e, 'nginx_loadtest_baslat', ok ? { host: ok.hedef_host, ip: ok.hedef_ip, kosuId: e && e.kosuId } : null);
    }
  });

  kuyrukUclari(router);
  sablonUclari(router);

  // Liste: islem / durum / hedef suzgeci ve `onceki` (id < onceki) ile sayfalama. Gecersiz deger
  // sessizce yok sayilmaz (yanlis listeyi "tamami" diye gostermek yerine 400). limit + 1 satir
  // cekilir: fazlasi varsa dahaVar.
  router.get('/kosular', async (req, res) => {
    try {
      const q = req.query || {};
      const deger = (ad) => {
        const v = q[ad];
        if (v === undefined || v === '') return undefined;
        if (typeof v !== 'string') throw hata(400, 'gecersiz_istek', `${ad} tek bir değer olmalı.`);
        return v;
      };
      let limit = 50;
      const hamLimit = deger('limit');
      if (hamLimit !== undefined) {
        limit = dg.tamSayi(hamLimit);
        if (limit === null || limit < 1 || limit > 200) throw hata(400, 'gecersiz_istek', 'limit 1..200 arasında bir tam sayı olmalı.');
      }
      const params = [limit + 1];
      const kosullar = [];
      const kosul = (ifade, v) => {
        params.push(v);
        kosullar.push(`${ifade} $${params.length}`);
      };
      const hamHedef = deger('hedef');
      if (hamHedef !== undefined) {
        const hedef = dg.hostNormalle(hamHedef);
        if (!hedef) throw hata(400, 'gecersiz_istek', 'Geçersiz hedef sunucu adı.');
        kosul('k.hedef_host =', hedef);
      }
      const islem = deger('islem');
      if (islem !== undefined) {
        if (!LISTE_ISLEMLERI.has(islem)) throw hata(400, 'gecersiz_istek', "islem 'kosu' ya da 'on_kontrol' olmalı.");
        kosul('k.islem =', islem);
      }
      const durum = deger('durum');
      if (durum !== undefined) {
        if (!LISTE_DURUMLARI.has(durum)) throw hata(400, 'gecersiz_istek', `durum şunlardan biri olmalı: ${[...LISTE_DURUMLARI].join(', ')}.`);
        kosul('k.durum =', durum);
      }
      // Serbest satirin hedef sunucusu yok: IP / hedef turu / motor suzgecleri (gecersiz deger 400).
      const ipSuz = deger('ip');
      if (ipSuz !== undefined) {
        if (!dg.gecerliIpv4(ipSuz)) throw hata(400, 'gecersiz_istek', 'ip noktalı IPv4 olmalı.');
        kosul('k.hedef_ip =', ipSuz);
      }
      const turSuz = deger('hedefTuru');
      if (turSuz !== undefined) {
        if (!dg.HEDEF_TURLERI.includes(turSuz)) throw hata(400, 'gecersiz_istek', "hedefTuru 'sunucu' ya da 'serbest' olmalı.");
        kosul('k.hedef_turu =', turSuz);
      }
      const motorSuz = deger('motor');
      if (motorSuz !== undefined) {
        if (!dg.MOTORLAR.includes(motorSuz)) throw hata(400, 'gecersiz_istek', "motor 'k6' ya da 'wrk' olmalı.");
        kosul('k.motor =', motorSuz);
      }
      const hamOnceki = deger('onceki');
      if (hamOnceki !== undefined) {
        const onceki = sayi(hamOnceki);
        if (!onceki) throw hata(400, 'gecersiz_istek', 'onceki pozitif bir koşu numarası olmalı.');
        kosul('k.id <', onceki);
      }
      const nerede = kosullar.length ? `WHERE ${kosullar.join(' AND ')}` : '';
      const { rows } = await dbOku((d) => d.query(
        `SELECT TOP ($1) ${LISTE_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id
          ${nerede} ORDER BY k.id DESC`,
        params,
      ));
      res.json({ ok: true, kosular: rows.slice(0, limit).map(kosuApi), dahaVar: rows.length > limit });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/kosular/:id', async (req, res) => {
    try {
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      const k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      const { rows: adimlar } = await dbOku((d) => d.query(`SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id = $1 ORDER BY id ASC`, [id]));
      let okOzet = null;
      let planUyarilari = [];
      if (k.islem === 'on_kontrol') {
        okOzet = jsonOku(k.on_kontrol_ozet);
        planUyarilari = metinDizisi(k.plan_uyarilari);
      } else if (k.on_kontrol_kosu_id != null) {
        const { rows } = await dbOku((d) => d.query(`SELECT on_kontrol_ozet, plan_uyarilari FROM nginx_loadtest_kosular WHERE id = $1`, [Number(k.on_kontrol_kosu_id)]));
        okOzet = jsonOku(rows[0] && rows[0].on_kontrol_ozet);
        planUyarilari = metinDizisi(rows[0] && rows[0].plan_uyarilari);
      }
      const tur = k.hedef_turu || 'sunucu';
      const motor = motorOf(k);
      // Tur 4: satirin arac seti (durumundan bagimsiz); okunamazsa yalniz gosterim eksik kalir.
      const aracId = k.arac_id == null ? null : Number(k.arac_id);
      let aracSatiri = null;
      if (aracId != null) {
        try {
          aracSatiri = await araclar.aracSetiOku(db(), aracId);
        } catch (e) {
          console.warn(`[NginxYukTesti] kosu ${id} arac seti ${aracId} okunamadi:`, maskele(e && e.message));
        }
      }
      const aracApi = aracSatiri ? araclar.aracApi(aracSatiri) : null;
      const aracSeti = aracApi
        ? { id: aracApi.id, k6Surum: aracApi.k6Surum, wrkSurum: aracApi.wrkSurum, k6Sha256: aracApi.k6Sha256, wrkSha256: aracApi.wrkSha256, derlemeHost: aracApi.derlemeHost }
        : null;
      const deg = okOzet ? dg.onKontrolDegerlendir(okOzet, { hedefTuru: tur, motor, aracli: aracId != null, aracSha256: araclar.motorSha(aracSatiri, motor), protokol: protokolOf(k), parametreler: jsonOku(k.parametreler) }) : null;
      // Izinli ag ekran icin env'den SU AN hesaplanir (DB okumaz); playbook'un esledigi girdi onKontrol.serbest_ag.
      const serbestAg = tur === 'serbest' ? (dg.serbestAgBul(k.hedef_ip, dg.serbestAglar()) || {}).metin || null : null;
      const sonucOzet = jsonOku(k.sonuc);
      const adimSatirlari = adimlar.map((r) => adimApi(r, { motor, hedefTuru: tur, protokol: protokolOf(k) }));
      const analizOzeti = sonucOzet && sonucOzet.portal_analiz && typeof sonucOzet.portal_analiz === 'object' ? sonucOzet.portal_analiz.ozet : null;
      res.json({
        ok: true,
        kosu: {
          ...kosuApi(k),
          aracId,
          aracSeti,
          parametreler: jsonOku(k.parametreler),
          planUyarilari,
          serbestAg,
          onKontrol: okOzet,
          onKontrolEngelleri: deg ? deg.engeller : [],
          // Ekran ve kosu onayi AYNI listeyi gorur: plan uyarilari basta.
          onKontrolUyarilari: [...planUyarilari, ...(deg ? deg.uyarilar : [])],
          onKontrolYasSn: k.islem === 'on_kontrol' && k.yas_sn != null ? Number(k.yas_sn) : null,
          gecersizNedenleri: jsonOku(k.gecersiz_nedenleri) || [],
          sonucOzet,
          sonucOzeti: gorunum.sonucOzeti(adimSatirlari, analizOzeti, sonucOzet && sonucOzet.portal_analiz ? sonucOzet.portal_analiz.uyarilar : []),
          sunucuAyari: sunucuAyariOf(k, sonucOzet, analizOzeti),
          swDizin: k.sw_dizin ?? null,
          iptalEden: k.iptal_eden ?? null,
          finalizedAt: iso(k.finalized_at),
          durdurIsi: k.durdur_awx_job_id == null ? null : { awxServerId: Number(k.durdur_awx_server_id), awxJobId: Number(k.durdur_awx_job_id) },
          sonuclandirmaDenemesi: Number(k.sonuclandirma_denemesi) || 0,
        },
        adimlar: adimSatirlari,
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/kosular/:id/durum', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      const k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      const temel = { kosuDurum: k.durum, gecerlilik: k.gecerlilik ?? null };
      const sid = k.awx_server_id == null ? null : Number(k.awx_server_id);
      const jid = k.awx_job_id == null ? null : Number(k.awx_job_id);
      if (sid == null || !(jid > 0)) {
        const status = k.durum === 'QUEUED' ? 'pending' : k.durum === 'CANCELED' ? 'canceled' : 'failed';
        return res.json({ ok: true, status, finished: !AKTIF.has(k.durum), output: '', outputOffset: 0, outputLength: 0, result: null, ...temel });
      }
      const runner = require('../ansible/runner.cjs');
      const parcala = (metin) => {
        // `since`: istemcinin elindeki MASKELI metnin uzunlugu. Gecersiz / metinden uzunsa tamami.
        const since = dg.tamSayi(req.query && req.query.since);
        const ofs = since !== null && since >= 0 && since <= metin.length ? since : 0;
        return { output: metin.slice(ofs), outputOffset: ofs, outputLength: metin.length };
      };
      let st;
      try {
        st = await runner.getJobStatusOnServer(sid, jid);
      } catch (e) {
        if (e && (e.code === 'awx_server_missing' || Number(e.status) === 404)) {
          const { rows } = await dbOku((d) => d.query(`SELECT TOP 1 stdout FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`, [sid, jid]));
          if (!rows.length) throw hata(409, 'awx_okunamadi', `AWX iş #${jid} okunamıyor ve Portal arşivinde çıktısı yok.`);
          return res.json({ ok: true, kaynak: 'arsiv', status: k.durum === 'CANCELED' ? 'canceled' : k.durum === 'DONE' ? 'successful' : 'failed', finished: true, ...parcala(maskele(rows[0].stdout)), result: null, jobId: jid, awxServerId: sid, ...temel });
        }
        throw hata(424, 'awx_okunamadi', `AWX işi okunamadı (#${jid}): ${maskele(e && e.message)}`);
      }
      // BAGLAMA: kosu satirindaki is bu modulun playbook'u olmali (ayni numarali baska is gosterilmez).
      const beklenen = String((require('../ansible/template-preflight.cjs').BEKLENEN_PLAYBOOK || {})[baslat.KAYIT_ANAHTARI] || baslat.BEKLENEN_PLAYBOOK_ADI).toLowerCase();
      const gercek = String(st.playbook || '').split('/').pop().toLowerCase();
      if (!gercek) throw hata(424, 'awx_okunamadi', `AWX iş #${jid}: playbook bilgisi okunamadı; çıktı doğrulanmadan gösterilmez.`);
      if (gercek !== beklenen) throw hata(409, 'awx_template_playbook_mismatch', `AWX'teki #${jid} yük testi playbook'u değil (${st.playbook}); çıktı gösterilmedi.`);
      // Is bitse de olaylar islenirken stdout eksik olabilir: o surece BITMEMIS sayilir.
      const bitti = TERMINAL.has(String(st.status)) && st.eventProcessingFinished !== false;
      if (bitti) require('../ansible/job-stdout-cache.cjs').sil(sid, jid);
      let ham;
      try {
        ({ output: ham } = await runner.getJobOutputOnServer(sid, jid, { artimli: !bitti }));
      } catch (e) {
        throw hata(424, 'awx_okunamadi', `AWX iş #${jid} çıktısı okunamadı: ${maskele(e && e.message)}`);
      }
      // Bitmis is: arsiv + /sw okuma + analiz poller'da (uzun surebilir; yoklamayi bekletmez).
      if (bitti && AKTIF.has(k.durum)) poller.tetikle(id);
      const ozet = require('../scalex/result.cjs').extractStatsKey(st.artifacts, poller.STATS_ANAHTARI);
      res.json({
        ok: true, kaynak: 'awx', status: st.status, finished: bitti, ...parcala(maskele(ham)),
        result: ozet ? maskeleDerin(ozet) : null, jobId: jid, awxServerId: sid, ...temel,
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/kosular/:id/durdur', async (req, res) => {
    const yer = { k: null };
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      res.json({ ok: true, ...await kosuyuDurdur(req, id, yer) });
    } catch (e) {
      const k = yer.k;
      hataYaniti(req, res, e, 'nginx_loadtest_durdur', k ? { host: k.hedef_host, ip: k.hedef_ip, kosuId: k.id } : null);
    }
  });

  // Sonucu okunamamis kosuyu yeniden sonuclandirmaya alir (OKUNAMADI otomatik yeniden okunmaz:
  // poller en cok 3 kez dener). CAS: yalniz is numarali, sonucu okunamamis KOSU satiri; deneme
  // sayaci sifirlanir, poller hemen tetiklenir. Yalniz Admin (ADMIN_DISI_OKUMA'da YOK).
  router.post('/kosular/:id/yeniden-oku', async (req, res) => {
    let k = null;
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      k = await kosuOku(id);
      const r = await dbOku((d) => d.query(
        `UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING', sonuclandirma_denemesi = 0
          WHERE id = $1 AND islem = 'kosu' AND awx_job_id IS NOT NULL AND (durum = 'OKUNAMADI' OR gecerlilik = 'OKUNAMADI')`,
        [id],
      ));
      if (!r.rowCount) throw hata(409, 'yeniden_okunamaz', 'Yalnız sonucu okunamamış koşular yeniden okunabilir.');
      poller.tetikle(id);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_yeniden_oku', {
          targetHost: (k && k.hedef_host) || null, targetIp: (k && k.hedef_ip) || null,
          detail: baslat.denetimAyrintisi({ kosuId: id, oncekiDurum: k ? k.durum : null, oncekiGecerlilik: k ? k.gecerlilik ?? null : null }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_yeniden_oku', k ? { host: k.hedef_host, ip: k.hedef_ip, kosuId: k.id } : null);
    }
  });

  // ── ARAC SETLERI (tur 4) ──────────────────────────────────────────────────────────────
  // Okuma Admin disina acik (ADMIN_DISI_OKUMA); vekil adresi yalniz Admin'e. Hazirlama ve geri cekme Admin.
  router.get('/araclar', async (req, res) => {
    try {
      res.json(await araclar.araclarYaniti(req, { isAdmin }));
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/araclar', async (req, res) => {
    try {
      adminSart(req);
      const r = await araclar.araclariHazirla(req, req.body);
      res.json({ ok: true, ...r });
    } catch (e) {
      const g = req.body && typeof req.body === 'object' ? req.body : {};
      const host = (typeof g.derlemeHost === 'string' && dg.hostNormalle(g.derlemeHost)) || null;
      hataYaniti(req, res, e, 'nginx_loadtest_araclar_hazirla', { host, ip: null });
    }
  });

  router.post('/araclar/:id/geri-cek', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz araç seti numarası.');
      const r = await araclar.aracGeriCek(req, id);
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_araclar_geri_cek', null);
    }
  });

  router.get('/karsilastir', async (req, res) => {
    try {
      const q = req.query || {};
      const ref = sayi(q.ref);
      const aday = sayi(q.aday);
      if (!ref || !aday) throw hata(400, 'gecersiz_istek', 'ref ve aday koşu numaraları gerekli.');
      const esik = (v, ad) => {
        if (v === undefined || v === '') return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 100) throw hata(400, 'gecersiz_istek', `${ad} 0..100 arasında olmalı.`);
        return n;
      };
      const esikCpu = esik(q.esikCpu, 'esikCpu');
      const esikP95 = esik(q.esikP95, 'esikP95');
      const [r, a] = [await kosuOku(ref), await kosuOku(aday)];
      for (const [x, ad] of [[r, 'referans'], [a, 'aday']]) {
        if (!x || x.islem !== 'kosu') throw hata(409, 'kosu_yok', `${ad} koşu bulunamadı (ön kontrol karşılaştırılmaz).`);
      }
      const adimlarOf = async (id) => (await dbOku((d) => d.query(`SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id = $1 ORDER BY id ASC`, [id]))).rows.map(adimAnaliz);
      const ra = await adimlarOf(ref);
      const aa = await adimlarOf(aday);
      // Motor / hedef turu / is parcacigi / hiz tavani satirdan: k6 ile wrk, farkli is parcacigi ve
      // farkli tavan_rps (wrk) ve farkli protokol VERI_YOK; serbest taraf CPU'suz karar yolu (analiz.kararVer, sozlesme 10.2).
      const parcacik = (x) => (jsonOku(x.parametreler) || {}).is_parcacigi ?? null;
      const tavan = (x) => (jsonOku(x.parametreler) || {}).tavan_rps ?? null;
      let karar;
      try {
        const analiz = poller.cModulu('analiz.cjs');
        karar = analiz.kararVer(ra, aa, {
          ...(esikCpu !== undefined ? { esikCpu } : {}), ...(esikP95 !== undefined ? { esikP95 } : {}),
          refMotor: motorOf(r), adayMotor: motorOf(a), refHedefTuru: r.hedef_turu || 'sunucu', adayHedefTuru: a.hedef_turu || 'sunucu',
          refIsParcacigi: parcacik(r), adayIsParcacigi: parcacik(a), refTavanRps: tavan(r), adayTavanRps: tavan(a),
          refProtokol: protokolOf(r), adayProtokol: protokolOf(a),
        });
      } catch (e) {
        throw hata(424, 'analiz_okunamadi', `Karşılaştırma hesaplanamadı: ${maskele(e && e.message)}`);
      }
      const ozet = (x) => ({
        id: Number(x.id), etiket: x.etiket ?? null, createdAt: iso(x.created_at), gecerlilik: x.gecerlilik ?? null, durum: x.durum,
        motor: motorOf(x), hedefTuru: x.hedef_turu || 'sunucu', protokol: protokolOf(x),
      });
      res.json({
        ok: true, karar: karar.karar, nedenler: karar.nedenler || [], tablo: karar.tablo || [],
        kademe: karar.kademe ?? null, kombinasyon: karar.kombinasyon ?? null, ref: ozet(r), aday: ozet(a),
      });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Coklu karsilastirma (2026-11-04, coklu.cjs): ?ref=<id>&kosular=<id,...> (ref dahil en cok 16 kosu; ref listede yoksa
  // eklenir). Yetki /karsilastir ile ayni (ADMIN_DISI_OKUMA). Kosu ve adim satirlari IKI sorguda (IN listesi parametreli).
  // 400: eksik / gecersiz numara (INT ustu dahil), 16 siniri, ref disinda aday yok, esik; 409 kosu_yok (bulunamayan var) ya da
  // kosu_uygun_degil (yalniz on kontrol / bitmemis): ayri listeler `eksik`, `onKontrol`, `bitmemis`.
  router.get('/karsilastir-coklu', async (req, res) => {
    try {
      const q = req.query || {};
      if (typeof q.ref !== 'string' || typeof q.kosular !== 'string') throw hata(400, 'gecersiz_istek', 'ref ve kosular (virgülle ayrılmış koşu numaraları) gerekli.');
      const ref = sayi(q.ref);
      if (!ref || !/^\d+$/.test(q.ref.trim())) throw hata(400, 'gecersiz_istek', 'ref pozitif bir koşu numarası olmalı.');
      const parcalar = q.kosular.split(',').map((x) => x.trim()).filter((x) => x !== '');
      if (parcalar.length > 64) throw hata(400, 'gecersiz_istek', `En çok ${coklu.MAX_KOSU} koşu karşılaştırılır.`);
      const idler = [];
      for (const x of parcalar) {
        const n = /^\d{1,10}$/.test(x) ? sayi(x) : null;
        if (!n) throw hata(400, 'gecersiz_istek', `Geçersiz koşu numarası: ${x.slice(0, 20)}`);
        if (!idler.includes(n)) idler.push(n);
      }
      const hepsi = idler.includes(ref) ? idler : [ref, ...idler];
      if (hepsi.length > coklu.MAX_KOSU) throw hata(400, 'gecersiz_istek', `En çok ${coklu.MAX_KOSU} koşu karşılaştırılır (referans dahil); ${hepsi.length} seçildi.`);
      if (hepsi.length < 2) throw hata(400, 'gecersiz_istek', 'Referansın yanında en az bir koşu seçin.');
      const esik = (v, ad) => {
        if (v === undefined || v === '') return undefined;
        const n = Number(v);
        if (typeof v !== 'string' || !Number.isFinite(n) || n <= 0 || n > 100) throw hata(400, 'gecersiz_istek', `${ad} 0..100 arasında olmalı.`);
        return n;
      };
      const esikCpu = esik(q.esikCpu, 'esikCpu');
      const esikP95 = esik(q.esikP95, 'esikP95');
      const yer = hepsi.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: kosuSatirlari } = await dbOku((d) => d.query(
        `SELECT ${COKLU_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id WHERE k.id IN (${yer})`,
        hepsi,
      ));
      const byId = new Map(kosuSatirlari.map((r) => [Number(r.id), r]));
      // Uc ayri liste (ekran ayri metin gosterir): bulunamayan (silinmis olabilir), on kontrol kaydi, bitmemis kosu
      // (QUEUED / RUNNING / FINALIZING: adimlari yarim). FAILED / CANCELED / OKUNAMADI kosu karsilastirilir (adimi varsa).
      const eksik = hepsi.filter((id) => !byId.has(id));
      const onKontrol = hepsi.filter((id) => byId.has(id) && byId.get(id).islem !== 'kosu');
      const bitmemis = hepsi.filter((id) => byId.has(id) && byId.get(id).islem === 'kosu' && AKTIF.has(byId.get(id).durum));
      if (eksik.length || onKontrol.length || bitmemis.length) {
        const no = (l) => l.map((x) => `#${x}`).join(', ');
        const parca = [];
        if (eksik.length) parca.push(`bulunamadı (silinmiş olabilir): ${no(eksik)}`);
        if (onKontrol.length) parca.push(`ön kontrol kaydı (karşılaştırılmaz): ${no(onKontrol)}`);
        if (bitmemis.length) parca.push(`henüz bitmedi: ${no(bitmemis)}`);
        throw hata(409, eksik.length ? 'kosu_yok' : 'kosu_uygun_degil', `Karşılaştırılamayan koşu numarası — ${parca.join('; ')}.`, { eksik, onKontrol, bitmemis });
      }
      const { rows: adimSatirlari } = await dbOku((d) => d.query(
        `SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id IN (${yer}) ORDER BY kosu_id ASC, id ASC`,
        hepsi,
      ));
      const adimlarOf = new Map(hepsi.map((id) => [id, []]));
      for (const a of adimSatirlari) {
        const l = adimlarOf.get(Number(a.kosu_id));
        if (l) l.push(a);
      }
      const kosuOf = (id) => {
        const r = byId.get(id);
        const motor = motorOf(r);
        const protokol = protokolOf(r);
        const tur = r.hedef_turu || 'sunucu';
        const ad = adimlarOf.get(id);
        return {
          meta: coklu.kosuMeta(r, { motor, protokol, parametreler: jsonOku(r.parametreler) }),
          analizAdimlari: ad.map(adimAnaliz),
          gorunumAdimlari: ad.map((x) => adimApi(x, { motor, hedefTuru: tur, protokol })),
        };
      };
      let sonuc;
      try {
        sonuc = coklu.cokluKarsilastir({
          ref: kosuOf(ref), adaylar: hepsi.filter((id) => id !== ref).map(kosuOf), analiz: poller.cModulu('analiz.cjs'),
          esikler: { ...(esikCpu !== undefined ? { esikCpu } : {}), ...(esikP95 !== undefined ? { esikP95 } : {}) },
        });
      } catch (e) {
        throw hata(424, 'analiz_okunamadi', `Karşılaştırma hesaplanamadı: ${maskele(e && e.message)}`);
      }
      res.json({ ok: true, ...sonuc });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Toplu rapor (2026-11-04, rapor.cjs): ?kuyruk=<id> (kuyruk sirasiyla) ya da ?kosular=<id,...> (verilen sirayla; en cok 100).
  // Yetki /karsilastir-coklu ile ayni (ADMIN_DISI_OKUMA). Kosu ve adim satirlari IKI sorguda (IN listesi parametreli). Yazilamayan
  // kosu istegi dusurmez: `atlananlar` (neden: bulunamadi, on_kontrol, bitmemis, olcum_yok, hesaplanamadi, kosu_baslamadi).
  router.get('/rapor', async (req, res) => {
    try {
      const q = req.query || {};
      const kuyrukVar = q.kuyruk !== undefined;
      if (kuyrukVar === (q.kosular !== undefined)) throw hata(400, 'gecersiz_istek', 'kuyruk ya da kosular (yalnız biri) gerekli.');
      const atlananlar = [];
      const idler = [];
      const etiketler = new Map();
      if (kuyrukVar) {
        const kuyrukId = typeof q.kuyruk === 'string' && /^\d{1,10}$/.test(q.kuyruk.trim()) ? sayi(q.kuyruk) : null;
        if (!kuyrukId) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
        const { rows } = await dbOku((d) => d.query(
          `SELECT id, etiket, durum, kosu_id FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = $1 ORDER BY sira ASC, id ASC`,
          [kuyrukId],
        ));
        if (!rows.length) throw hata(409, 'kuyruk_yok', 'Kuyruk bulunamadı.');
        for (const o of rows) {
          const n = o.kosu_id == null ? null : Number(o.kosu_id);
          if (n === null) atlananlar.push({ kosuId: null, etiket: o.etiket ?? null, neden: 'kosu_baslamadi', durum: o.durum ?? null });
          else if (!idler.includes(n)) {
            idler.push(n);
            etiketler.set(n, o.etiket ?? null);
          }
        }
      } else {
        if (typeof q.kosular !== 'string') throw hata(400, 'gecersiz_istek', 'kosular virgülle ayrılmış koşu numaraları olmalı.');
        const parcalar = q.kosular.split(',').map((x) => x.trim()).filter((x) => x !== '');
        if (parcalar.length > rapor.MAX_KOSU * 4) throw hata(400, 'gecersiz_istek', `En çok ${rapor.MAX_KOSU} koşu raporlanır.`);
        for (const x of parcalar) {
          const n = /^\d{1,10}$/.test(x) ? sayi(x) : null;
          if (!n) throw hata(400, 'gecersiz_istek', `Geçersiz koşu numarası: ${x.slice(0, 20)}`);
          if (!idler.includes(n)) idler.push(n);
        }
        if (!idler.length) throw hata(400, 'gecersiz_istek', 'En az bir koşu numarası verin.');
      }
      if (idler.length > rapor.MAX_KOSU) throw hata(400, 'gecersiz_istek', `En çok ${rapor.MAX_KOSU} koşu raporlanır; ${idler.length} seçildi.`);
      if (!idler.length) return res.json({ ok: true, satirlar: [], atlananlar });
      const yer = idler.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: kosuSatirlari } = await dbOku((d) => d.query(
        `SELECT ${RAPOR_KOLONLARI} FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s.id = k.senaryo_id WHERE k.id IN (${yer})`,
        idler,
      ));
      const byId = new Map(kosuSatirlari.map((r) => [Number(r.id), r]));
      const uygun = [];
      for (const id of idler) {
        const r = byId.get(id);
        const neden = !r ? 'bulunamadi' : r.islem !== 'kosu' ? 'on_kontrol' : AKTIF.has(r.durum) ? 'bitmemis' : null;
        if (neden) atlananlar.push({ kosuId: id, etiket: r ? r.etiket ?? null : etiketler.get(id) ?? null, neden, durum: r ? r.durum : null });
        else uygun.push(id);
      }
      if (!uygun.length) return res.json({ ok: true, satirlar: [], atlananlar });
      const yer2 = uygun.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: adimSatirlari } = await dbOku((d) => d.query(
        `SELECT * FROM nginx_loadtest_adimlar WHERE kosu_id IN (${yer2}) ORDER BY kosu_id ASC, id ASC`,
        uygun,
      ));
      const adimlarOf = new Map(uygun.map((id) => [id, []]));
      for (const a of adimSatirlari) {
        const l = adimlarOf.get(Number(a.kosu_id));
        if (l) l.push(a);
      }
      const kosular = uygun.map((id) => {
        const r = byId.get(id);
        const motor = motorOf(r);
        const protokol = protokolOf(r);
        const parametreler = jsonOku(r.parametreler);
        const pa = (jsonOku(r.sonuc) || {}).portal_analiz;
        const ad = adimlarOf.get(id);
        return {
          meta: coklu.kosuMeta(r, { motor, protokol, parametreler }),
          parametreler,
          analizAdimlari: ad.map(adimAnaliz),
          gorunumAdimlari: ad.map((x) => adimApi(x, { motor, hedefTuru: r.hedef_turu || 'sunucu', protokol })),
          analizOzeti: pa && typeof pa === 'object' ? pa.ozet : null,
          kosuUyarilari: pa && typeof pa === 'object' ? pa.uyarilar : [],
          gecersizNedenleri: jsonOku(r.gecersiz_nedenleri) || [],
          startedAt: iso(r.started_at),
          finishedAt: iso(r.finished_at),
        };
      });
      const sonuc = rapor.raporKur({ kosular, analiz: poller.cModulu('analiz.cjs'), gorunum });
      res.json({ ok: true, satirlar: sonuc.satirlar, atlananlar: [...atlananlar, ...sonuc.atlananlar] });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Kosu etiketi sonradan (2026-11-04): yalniz Admin (yazan uc; adminOkumaKapisi Admin olmayani zaten durdurur). Girdi
  // kapisi: metin, trim, en cok 120 karakter (kolon NVARCHAR(120)), kontrol karakteri yok; bos = etiketi kaldir (NULL).
  // Denetim: nginx_loadtest_etiket (eski / yeni). Kuyruk kosusunun "[K<n>] " oneki kullanicinin elindedir (zorlanmaz).
  router.put('/kosular/:id/etiket', async (req, res) => {
    let k = null;
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id || !/^\d+$/.test(String(req.params.id))) throw hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if (b.etiket !== null && typeof b.etiket !== 'string') throw hata(400, 'gecersiz_istek', 'etiket metin (ya da null) olmalı.');
      const yeni = b.etiket === null ? '' : b.etiket.trim();
      if (Array.from(yeni).length > 120) throw hata(400, 'gecersiz_istek', 'Etiket en çok 120 karakter olabilir.');
      if (ETIKET_YASAK.test(yeni)) throw hata(400, 'gecersiz_istek', 'Etiket satır sonu / kontrol karakteri içeremez.');
      k = await kosuOku(id);
      if (!k) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      const deger = yeni || null;
      const r = await dbOku((d) => d.query(`UPDATE nginx_loadtest_kosular SET etiket = $2 WHERE id = $1`, [id, deger]));
      if (!r.rowCount) throw hata(409, 'kosu_yok', 'Koşu bulunamadı.');
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_etiket', {
          targetHost: k.hedef_host || null, targetIp: k.hedef_ip || null,
          detail: baslat.denetimAyrintisi({ kosuId: id, eski: k.etiket ?? null, yeni: deger }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, id, etiket: deger });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_etiket', k ? { host: k.hedef_host, ip: k.hedef_ip, kosuId: k.id } : null);
    }
  });

  // -- KOSU SILME (2026-11-04, sil.cjs) ------------------------------------------------------
  // DELETE /kosular/:id { confirmText: '<numara>' } ve POST /kosular/sil { kosular: [id], confirmText: '<sayi>' }.
  // Sira: girdi + onay metni (400, DB'ye gidilmez) -> satirlar (424) -> bulunamayan (tekli 404) -> sahiplik (403,
  // denetimli) -> engeller (409, nedenleriyle) -> tek islemde kosullu DELETE (hepsi ya da hic) -> denetim.
  const SIL_ANAHTARLARI = [...baslat.DENETIM_ANAHTARLARI, 'kosuIdleri', 'yetkisiz', 'sayi', 'toplu'];
  async function kosulariSil(req, res, ids, toplu) {
    let satirlar = [];
    try {
      const oku = async () => (await dbOku((d) => d.query(sil.okumaSql(ids.length), ids))).rows || [];
      satirlar = await oku();
      const bulunan = new Set(satirlar.map((r) => Number(r.id)));
      if (!toplu && !bulunan.has(ids[0])) throw hata(404, 'kosu_yok', `Koşu #${ids[0]} bulunamadı (silinmiş olabilir).`);
      const yetkisiz = isAdmin(req) ? [] : satirlar.filter((r) => !ayniKullanici(r.created_by, kullanici(req).username));
      if (yetkisiz.length) {
        const liste = yetkisiz.map((r) => `#${r.id}${r.created_by ? ` (${r.created_by})` : ''}`).join(', ');
        try {
          require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kosu_sil', {
            result: 'fail',
            detail: baslat.denetimAyrintisi({ code: 'yetki_yok', toplu, kosuIdleri: ids, yetkisiz: yetkisiz.map((r) => Number(r.id)) }, { anahtarlar: SIL_ANAHTARLARI }),
          });
        } catch {
          /* best-effort */
        }
        throw hata(403, 'yetki_yok', `Yalnız koşuyu başlatan kişi ya da Admin silebilir: ${liste}. Hiçbir kayıt silinmedi.`, { yetkisiz: yetkisiz.map((r) => Number(r.id)) });
      }
      const engelHatasi = (e) => hata(409, toplu ? 'silinemez' : e[0].kod,
        toplu ? `${e.length} kayıt silinemiyor; hiçbir kayıt silinmedi (hepsi ya da hiçbiri). ${e.map((x) => x.metin).join(' ')}` : e[0].metin,
        { silinemeyenler: e });
      const engel = sil.engeller(ids, satirlar);
      if (engel.length) throw engelHatasi(engel);
      let silinen;
      try {
        // Yeniden deneme YOK: COMMIT'ten sonra kopan baglantida ikinci calisma 0 satir bulup silinmis kaydi "kosu_yok"
        // diye raporlardi (silme de denetime yazilmazdi). Hata 424 (denetimli) olur, metin "silinmis olabilir" der.
        silinen = (await db().query(sil.silmeSql(ids.length), [...ids, ids.length], { tekrar: false })).rows || [];
      } catch (e) {
        throw hata(424, 'db_okunamadi', `Kayıtlar silinemedi (Portal veritabanı): ${maskele(e && e.message)}. Silme tek işlemdir; tamamlanmadıysa hiçbir kayıt silinmez. Bağlantı işlem sırasında koptuysa silinmiş olabilir: listeyi yenileyip kontrol edin.`);
      }
      if (silinen.length !== ids.length) {
        // Islem kosulu tutmadi (bu arada baslayan / kilitlenen / kuyruga baglanan): hicbir sey silinmedi.
        satirlar = await oku();
        const yeni = sil.engeller(ids, satirlar);
        if (yeni.length) throw engelHatasi(yeni);
        throw hata(409, 'eszamanli_degisti', 'Kayıtlar bu arada değişti; hiçbir kayıt silinmedi. Listeyi yenileyip tekrar deneyin.');
      }
      const sirali = ids.map((id) => silinen.find((r) => Number(r.id) === id)).filter(Boolean);
      const hostlar = [...new Set(sirali.map((r) => r.hedef_host || null))];
      const ipler = [...new Set(sirali.map((r) => r.hedef_ip || null))];
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kosu_sil', {
          targetHost: hostlar.length === 1 ? hostlar[0] : null,
          targetIp: ipler.length === 1 ? ipler[0] : null,
          detail: baslat.denetimAyrintisi({ toplu, sayi: sirali.length, kosuIdleri: sirali.map((r) => Number(r.id)), kosular: sirali.map(sil.denetimMetni) }, { anahtarlar: SIL_ANAHTARLARI }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, sayi: sirali.length, silinen: sirali.map(sil.silinenApi) });
    } catch (e) {
      const ilk = satirlar.find((r) => Number(r.id) === ids[0]);
      hataYaniti(req, res, e, 'nginx_loadtest_kosu_sil', ilk ? { host: ilk.hedef_host, ip: ilk.hedef_ip, kosuId: toplu ? null : Number(ilk.id) } : null);
    }
  }

  router.delete('/kosular/:id', async (req, res) => {
    const ham = String(req.params.id);
    const id = /^\d+$/.test(ham) ? sayi(ham) : null;
    if (!id) return hataYaniti(req, res, hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.'));
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!sil.onayDogru(b.confirmText, id)) return hataYaniti(req, res, hata(400, 'onay_metni', `Onay için koşu numarasını (${id}) yazın.`));
    return kosulariSil(req, res, [id], false);
  });

  router.post('/kosular/sil', async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const liste = b.kosular;
    if (!Array.isArray(liste) || !liste.length) return hataYaniti(req, res, hata(400, 'gecersiz_istek', 'kosular: silinecek koşu numaraları (dizi) gerekli.'));
    if (liste.length > sil.MAX_TOPLU) return hataYaniti(req, res, hata(400, 'gecersiz_istek', `Bir seferde en çok ${sil.MAX_TOPLU} kayıt silinebilir.`));
    const ids = liste.map((v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? sayi(v) : null));
    if (ids.some((v) => !v)) return hataYaniti(req, res, hata(400, 'gecersiz_istek', 'Geçersiz koşu numarası.'));
    if (new Set(ids).size !== ids.length) return hataYaniti(req, res, hata(400, 'gecersiz_istek', 'Aynı koşu numarası iki kez verilmiş.'));
    // Toplu onay = secilen SAYI (tekli onaydaki "#12" bicimi burada kabul edilmez).
    if (typeof b.confirmText !== 'string' || b.confirmText.trim() !== String(ids.length)) {
      return hataYaniti(req, res, hata(400, 'onay_metni', `Onay için seçilen kayıt sayısını (${ids.length}) yazın.`));
    }
    return kosulariSil(req, res, ids, true);
  });

  return router;
}

/** Calisan oge satiri -> yanittaki `suren` alani. */
function surenOf(c) {
  return c ? { ogeId: Number(c.id), etiket: c.etiket, kosuId: c.kosu_id == null ? null : Number(c.kosu_id), onKontrolKosuId: c.on_kontrol_kosu_id == null ? null : Number(c.on_kontrol_kosu_id) } : null;
}

// Kuyruk uclari (2026-11-04 tasima): KIMLIK KAPISININ ALTINDA tanimli; RO1 bekcisi satir sirasina bakar.
function kuyrukUclari(router) {
  router.get('/kuyruklar', async (req, res) => {
    try {
      const { rows } = await dbOku((d) => d.query(kuyruk.SQL.kuyrukListe));
      res.json({ ok: true, kuyruklar: await Promise.all(rows.map(async (k) => ({ ...kuyruk.kuyrukApi(k), ...await duraklatmaBilgisi(k) }))) });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.get('/kuyruklar/:id', async (req, res) => {
    try {
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
      const r = await kuyrukOkuApi(id);
      if (!r) throw hata(409, 'kuyruk_yok', 'Kuyruk bulunamadı.');
      res.json({ ok: true, ...r });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Olusturma: her oge mevcut on kontrol govdesiyle dogrulanir ve plan kapilarindan GECER (gece YENIDEN gececek);
  // tum ogeler TEK hedefe (onay metni bir kez); uyari turleri (plan + ogeye bagli on kontrol) tek tek onaylanir
  // (409 uyari_onayi + uyariTurleri; istemci onaylananTurler ile yeniden gonderir).
  router.post('/kuyruklar', async (req, res) => {
    let hedefBilgi = null;
    try {
      adminSart(req);
      const g = kuyruk.kuyrukGovdesi(req.body);
      const kullaniciAdi = String(kullanici(req).username || 'unknown').slice(0, 100);
      const ogeler = [];
      const turHaritasi = new Map();
      let onayHedefi = null;
      let hedefTuru = null;
      for (const [i, o] of g.ogeler.entries()) {
        const no = i + 1;
        let og;
        let plan;
        try {
          og = onKontrolGovdesi({ ...o.govde, etiket: undefined });
          plan = await kosuPlani({ ...og, etiket: null });
        } catch (e) {
          throw ogeNo(e, no);
        }
        const hedef = kuyruk.onayHedefiOf(plan);
        if (onayHedefi == null) {
          onayHedefi = hedef;
          hedefTuru = plan.hedefTuru;
          hedefBilgi = { host: plan.hedefHost, ip: plan.hedefIp };
        } else if (hedef !== onayHedefi) {
          throw hata(409, 'hedef_farkli', `Öğe ${no}: hedef (${hedef}) kuyruğun hedefinden (${onayHedefi}) farklı; bir kuyruk tek hedefe yük basar.`, { oge: no });
        }
        const metinler = [...plan.uyarilar];
        if (o.onKontrolKosuId) metinler.push(...await ogeOnKontrolUyarilari(o.onKontrolKosuId, kullaniciAdi, onayHedefi, no, plan.parametreler));
        const turler = kuyruk.uyariTurleri(metinler);
        for (const t of turler) {
          const x = turHaritasi.get(t.kod) || { ...t, ogeler: [] };
          x.ogeler.push(no);
          turHaritasi.set(t.kod, x);
        }
        ogeler.push({ etiket: o.etiket, turler, ...ogeKaydi(og, plan) });
      }
      if (!dg.onayMetniDogru(g.confirmText, onayHedefi)) {
        throw hata(409, 'onay_metni', hedefTuru === 'serbest' ? `Onay için hedef IP'yi (${onayHedefi}) birebir yazın.` : `Onay için hedef sunucu adını (${onayHedefi}) birebir yazın.`);
      }
      // Ayni hedefe ikinci aktif kuyruk: dinlenme kuyruk basina sayildigindan iki kuyruk dinlenmesiz ard arda basardi.
      const ayni = (await dbOku((d) => d.query(kuyruk.SQL.ayniHedefAktif, [onayHedefi]))).rows[0];
      if (ayni) {
        throw hata(409, 'kuyruk_var', `${onayHedefi} için kuyruk #${ayni.id} zaten aktif; bitmesini bekleyin ya da o kuyruğu İptal edin.`, { kuyrukId: Number(ayni.id) });
      }
      const turler = [...turHaritasi.values()];
      if (turler.some((t) => !g.onaylananTurler.includes(t.kod))) {
        throw hata(409, 'uyari_onayi', 'Kuyruğun uyarı türlerini okuyup tek tek onaylayın: gece yalnız bu türler kabul edilir, yeni bir tür çıkan öğe atlanır.', { uyariTurleri: turler });
      }
      const onayli = turler.map(({ kod, ornek }) => ({ kod, ornek }));
      let id;
      try {
        const ins = await db().query(kuyruk.SQL.kuyrukEkle, [g.ad, g.beklemeDk, g.baslangic, g.enGecBitis, onayHedefi, hedefTuru, JSON.stringify(onayli), kullaniciAdi]);
        id = Number(ins.rows && ins.rows[0] && ins.rows[0].id);
        if (!(id > 0)) throw new Error('kuyruk numarası dönmedi');
      } catch (e) {
        throw hata(424, 'db_okunamadi', `Kuyruk yazılamadı: ${maskele(e && e.message)}`);
      }
      try {
        for (const [i, o] of ogeler.entries()) {
          await db().query(kuyruk.SQL.ogeEkle, [id, i + 1, o.etiket, JSON.stringify(o.govde), o.butceSn, JSON.stringify(o.turler)]);
        }
        const h = await db().query(kuyruk.SQL.kuyrukHazir, [id]);
        if (!h.rowCount) throw new Error('kuyruk hazır işaretlenemedi');
      } catch (e) {
        // Yarim kuyruk (hazir = 0) yurutucuye HIC gorunmez; HATALI olarak kapatilir.
        await db().query(kuyruk.SQL.kuyrukYarim, [id, `oluşturma yarım kaldı: ${maskele(e && e.message).slice(0, 400)}`]).catch(() => {});
        throw hata(424, 'db_okunamadi', `Kuyruk öğeleri yazılamadı; kuyruk başlatılmadı: ${maskele(e && e.message)}`);
      }
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kuyruk_olustur', {
          targetHost: hedefBilgi.host || null, targetIp: hedefBilgi.ip || null,
          detail: baslat.denetimAyrintisi({ id, ogeSayisi: ogeler.length, beklemeDk: g.beklemeDk, baslangic: iso(g.baslangic), enGecBitis: iso(g.enGecBitis), onaylananTurler: onayli.map((t) => t.kod), etiketler: ogeler.map((o) => o.etiket) }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, id });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_kuyruk_olustur', hedefBilgi);
    }
  });

  // Iptal: sonraki ogeler baslamaz. Suren kosu DURDURULMAZ (yanitta `suren`; mevcut Durdur ile).
  router.post('/kuyruklar/:id/iptal', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const r = await dbOku((d) => d.query(kuyruk.SQL.kuyrukIptal, [id, kim]));
      if (!r.rowCount) throw hata(409, 'kuyruk_bitti', 'Kuyruk zaten bitmiş ya da iptal edilmiş.');
      await dbOku((d) => d.query(kuyruk.SQL.ogelerIptal, [id, `kuyruk iptal edildi (${kim})`]));
      const { rows } = await dbOku((d) => d.query(kuyruk.SQL.calisanOge, [id]));
      const suren = surenOf(rows[0]);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kuyruk_iptal', { detail: baslat.denetimAyrintisi({ id, suren }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, suren });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  // Duraklat: sonraki oge baslamaz (bayrak, kuyruk.cjs "DURAKLAT"). surenDurdur: calisan kosu (yoksa on kontrol) mevcut
  // Durdur mantigiyla durdurulur; durdurma hatasi duraklatmayi GERI ALMAZ, yanitta durdurHatasi doner.
  router.post('/kuyruklar/:id/duraklat', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if (b.surenDurdur !== undefined && typeof b.surenDurdur !== 'boolean') throw hata(400, 'gecersiz_istek', 'surenDurdur true/false olmalı.');
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const r = await dbOku((d) => d.query(kuyruk.SQL.kuyrukDuraklat, [id, kim]));
      if (!r.rowCount) throw hata(409, 'kuyruk_duraklatilamaz', 'Kuyruk bitmiş ya da zaten duraklatılmış.');
      const { rows } = await dbOku((d) => d.query(kuyruk.SQL.calisanOge, [id]));
      const suren = surenOf(rows[0]);
      let durduruldu = false;
      let durdurHatasi = null;
      const durdurulacak = b.surenDurdur === true && suren ? suren.kosuId ?? suren.onKontrolKosuId : null;
      if (durdurulacak != null) {
        try {
          await kosuyuDurdur(req, durdurulacak);
          durduruldu = true;
        } catch (e) {
          // Bu arada bitmis is: durdurulacak bir sey kalmadi, hata degil.
          if (!(e && e.code === 'kosu_bitti')) durdurHatasi = maskele((e && e.message) || 'Durdurulamadı.').slice(0, 500);
        }
      }
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kuyruk_duraklat', { detail: baslat.denetimAyrintisi({ id, surenDurdur: b.surenDurdur === true, suren, durduruldu, durdurHatasi }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true, suren, durduruldu, durdurHatasi });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_kuyruk_duraklat');
    }
  });

  // Devam: bayrak kalkar. Durdurulan is henuz kapanmadiysa 409: bayraksiz kapanis ogeyi HATALI / ATLANDI yapardi. Ayni sey
  // kosuyuDurdur'un iptal_eden yazmadan onceki penceresi (durdurSuren; tek surec) ve bitmis ama ogesi kapanmamis on kontrol icin
  // gecerli (sonucu kullanilmaz sozu: FAILED bayraksiz ATLANDI olurdu, ayarli on kontrolde kilit geri alma boyunca beklenir).
  router.post('/kuyruklar/:id/devam', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
      const k = (await dbOku((d) => d.query(kuyruk.SQL.kuyrukOku, [id]))).rows[0];
      if (!k) throw hata(409, 'kuyruk_yok', 'Kuyruk bulunamadı.');
      const duraklatilmamis = () => hata(409, 'kuyruk_duraklatilmamis', 'Kuyruk duraklatılmış değil.');
      if (k.duraklat_at == null || !kuyruk.AKTIF_KUYRUK.has(k.durum)) throw duraklatilmamis();
      const c = (await dbOku((d) => d.query(kuyruk.SQL.calisanOge, [id]))).rows[0];
      const suren = surenOf(c);
      const izlenen = suren ? suren.kosuId ?? suren.onKontrolKosuId : null;
      if (izlenen != null) {
        const x = await kosuOku(izlenen);
        const okKapaniyor = !!x && suren.kosuId == null && !AKTIF.has(x.durum);
        if (durdurSuren.has(izlenen) || okKapaniyor || (x && kuyruk.kosuDurduruldu(x))) throw hata(409, 'duraklatma_suruyor', 'Koşu durduruluyor; durunca yeniden deneyin.');
      }
      const r = await dbOku((d) => d.query(kuyruk.SQL.kuyrukDevam, [id]));
      if (!r.rowCount) throw duraklatilmamis();
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kuyruk_devam', { detail: baslat.denetimAyrintisi({ id, duraklatan: k.duraklatan ?? null }) });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_kuyruk_devam');
    }
  });

  // Oge duzenleme: yalniz baslamamis oge; olusturmadaki bicim + plan kapilarindan gecer, hedef kuyrugun onayli hedefi
  // olmak zorunda (onay metni bir kez yazildi). Kuyrukta onayli olmayan plan uyarisi turu acikca onaylanir.
  router.put('/kuyruklar/:id/ogeler/:ogeId', async (req, res) => {
    let hedefBilgi = null;
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      const ogeId = sayi(req.params.ogeId);
      if (!id || !ogeId) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk / öğe numarası.');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const etiket = kuyruk.ogeEtiketi(b.etiket, 'Öğe: ');
      if (!b.govde || typeof b.govde !== 'object' || Array.isArray(b.govde)) throw hata(400, 'gecersiz_istek', 'Öğe: ayarlar (govde) eksik.');
      const og = onKontrolGovdesi({ ...b.govde, etiket: undefined });
      const k = (await dbOku((d) => d.query(kuyruk.SQL.kuyrukOku, [id]))).rows[0];
      if (!k) throw hata(409, 'kuyruk_yok', 'Kuyruk bulunamadı.');
      if (!kuyruk.AKTIF_KUYRUK.has(k.durum)) throw hata(409, 'kuyruk_bitti', 'Kuyruk bitmiş ya da iptal edilmiş; öğesi düzenlenemez.');
      const plan = await kosuPlani({ ...og, etiket: null });
      hedefBilgi = { host: plan.hedefHost, ip: plan.hedefIp };
      const hedef = kuyruk.onayHedefiOf(plan);
      if (hedef !== k.onay_hedefi) throw hata(409, 'hedef_farkli', `Hedef (${hedef}) kuyruğun hedefinden (${k.onay_hedefi}) farklı; bir kuyruk tek hedefe yük basar.`);
      const onayli = kuyruk.kuyrukApi(k).onaylananTurler;
      const turler = kuyruk.uyariTurleri(plan.uyarilar);
      const yeni = turler.filter((t) => !onayli.some((o) => o.kod === t.kod));
      const istemciOnayi = kuyruk.turKodlari(b.onaylananTurler);
      if (yeni.some((t) => !istemciOnayi.includes(t.kod))) {
        throw hata(409, 'uyari_onayi', 'Düzenlenen öğenin yeni uyarı türlerini okuyup tek tek onaylayın: gece yalnız onaylı türler kabul edilir.', { uyariTurleri: yeni });
      }
      const { govde, butceSn } = ogeKaydi(og, plan);
      const r = await dbOku((d) => d.query(kuyruk.SQL.ogeGuncelle, [id, ogeId, etiket, JSON.stringify(govde), butceSn, JSON.stringify(turler)]));
      if (!r.rowCount) throw hata(409, 'oge_basladi', 'Yalnız başlamamış (bekleyen) öğe düzenlenebilir.');
      // Sira bilincli: once oge. Onay yazilamazsa oge gece "yeni uyari" ile ATLANDI olur (fail-closed); istek yeniden denenebilir.
      if (yeni.length) {
        const t = await dbOku((d) => d.query(kuyruk.SQL.kuyrukTurlerEkle, [id, JSON.stringify([...onayli, ...yeni]), k.onaylanan_turler ?? '']));
        if (!t.rowCount) throw hata(409, 'kuyruk_degisti', 'Kuyruk bu arada değişti; uyarı onayı yazılmadı, yeniden kaydedin.');
      }
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_kuyruk_oge_guncelle', {
          targetHost: plan.hedefHost || null, targetIp: plan.hedefIp || null,
          detail: baslat.denetimAyrintisi({ id, ogeId, etiket, onaylananTurler: yeni.map((x) => x.kod) }),
        });
      } catch {
        /* best-effort */
      }
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_kuyruk_oge_guncelle', hedefBilgi);
    }
  });

  // Sira: yalniz BEKLIYOR ogeler; liste kuyrugun BEKLIYOR ogelerinin TAM permutasyonu olmali (bu arada baslayan
  // varsa 409; ekran yeniden okur).
  router.put('/kuyruklar/:id/sira', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk numarası.');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const liste = Array.isArray(b.sira) ? b.sira.map(sayi) : null;
      if (!liste || !liste.length || liste.some((x) => !x) || new Set(liste).size !== liste.length || liste.length > kuyruk.MAX_OGE) {
        throw hata(400, 'gecersiz_istek', 'sira: bekleyen öğe numaralarının listesi olmalı.');
      }
      const { rows } = await dbOku((d) => d.query(kuyruk.SQL.ogeListe, [id]));
      const bekleyen = rows.filter((o) => o.durum === 'BEKLIYOR').map((o) => Number(o.id));
      if (bekleyen.length !== liste.length || bekleyen.some((x) => !liste.includes(x))) {
        throw hata(409, 'sira_eski', 'Bekleyen öğeler değişti (biri başlamış ya da çıkarılmış olabilir); listeyi yenileyip yeniden deneyin.');
      }
      const taban = Number(((await dbOku((d) => d.query(kuyruk.SIRA_TABAN_SQL, [id]))).rows[0] || {}).m) || 0;
      const r = await dbOku((d) => d.query(kuyruk.siraSql(liste.length), [id, ...liste, taban]));
      if (r.rowCount !== liste.length) throw hata(409, 'sira_eski', 'Bir öğe bu arada başladı; listeyi yenileyip yeniden deneyin.');
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/kuyruklar/:id/ogeler/:ogeId/cikar', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      const ogeId = sayi(req.params.ogeId);
      if (!id || !ogeId) throw hata(400, 'gecersiz_istek', 'Geçersiz kuyruk / öğe numarası.');
      const kim = String(kullanici(req).username || 'unknown').slice(0, 100);
      const r = await dbOku((d) => d.query(kuyruk.SQL.ogeCikar, [id, ogeId, `kuyruktan çıkarıldı (${kim})`]));
      if (!r.rowCount) throw hata(409, 'oge_basladi', 'Yalnız başlamamış (bekleyen) öğe çıkarılabilir.');
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });
}

// Kayitli test uclari (2026-11-04, sablon.cjs): KIMLIK KAPISININ ALTINDA; hepsi Admin (ADMIN_DISI_OKUMA'da YOK).
function sablonUclari(router) {
  const kim = (req) => String(kullanici(req).username || 'unknown').slice(0, 100);
  const adBos = async (ad, haricId) => {
    const { rows } = await dbOku((d) => d.query(sablon.SQL.adVar, [ad, haricId]));
    if (rows[0]) throw hata(409, 'sablon_var', `"${ad}" adında kayıtlı test zaten var.`);
  };
  // Yazim: dbOku tekil ihlalini 424'e cevirirdi; UX_nls_ad burada 409 olur.
  const yaz = async (ad, fn) => {
    try {
      return await fn(db());
    } catch (e) {
      if (sablon.tekilIhlali(e)) throw hata(409, 'sablon_var', `"${ad}" adında kayıtlı test zaten var.`);
      throw hata(424, 'db_okunamadi', `Kayıtlı test yazılamadı: ${maskele(e && e.message)}`);
    }
  };
  const denetim = (req, eylem, ayrinti) => {
    try {
      require('../audit/index.cjs').auditPortal(req, eylem, { detail: baslat.denetimAyrintisi(ayrinti) });
    } catch {
      /* best-effort */
    }
  };

  router.get('/sablonlar', async (req, res) => {
    try {
      adminSart(req);
      const { rows } = await dbOku((d) => d.query(sablon.SQL.liste));
      res.json({ ok: true, sablonlar: rows.map(sablon.sablonApi) });
    } catch (e) {
      hataYaniti(req, res, e);
    }
  });

  router.post('/sablonlar', async (req, res) => {
    try {
      adminSart(req);
      const s = sablon.sablonGovdesi(req.body, onKontrolGovdesi);
      await adBos(s.ad, null);
      const { rows } = await yaz(s.ad, (d) => d.query(sablon.SQL.ekle, [s.ad, s.govdeJson, kim(req)]));
      const id = Number(rows[0] && rows[0].id);
      denetim(req, 'nginx_loadtest_sablon_ekle', { id, ad: s.ad, senaryoId: s.govde.senaryoId });
      res.json({ ok: true, id });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_sablon_ekle');
    }
  });

  router.put('/sablonlar/:id', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kayıtlı test numarası.');
      const s = sablon.sablonGovdesi(req.body, onKontrolGovdesi);
      await adBos(s.ad, id);
      const r = await yaz(s.ad, (d) => d.query(sablon.SQL.guncelle, [id, s.ad, s.govdeJson, kim(req)]));
      if (!r.rowCount) throw hata(409, 'sablon_yok', 'Kayıtlı test bulunamadı (silinmiş olabilir).');
      denetim(req, 'nginx_loadtest_sablon_guncelle', { id, ad: s.ad, senaryoId: s.govde.senaryoId });
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_sablon_guncelle');
    }
  });

  router.delete('/sablonlar/:id', async (req, res) => {
    try {
      adminSart(req);
      const id = sayi(req.params.id);
      if (!id) throw hata(400, 'gecersiz_istek', 'Geçersiz kayıtlı test numarası.');
      const r = await dbOku((d) => d.query(sablon.SQL.sil, [id, kim(req)]));
      if (!r.rowCount) throw hata(409, 'sablon_yok', 'Kayıtlı test bulunamadı ya da zaten silinmiş.');
      denetim(req, 'nginx_loadtest_sablon_sil', { id });
      res.json({ ok: true });
    } catch (e) {
      hataYaniti(req, res, e, 'nginx_loadtest_sablon_sil');
    }
  });
}

function initNginxLoadtest(app) {
  app.use('/api/nginx-loadtest', yonlendiriciKur());
  poller.otoDurdurKur(otoDurdur);
  poller.startPoller();
  kuyruk.startKuyruk(kuyrukIslem);
}

module.exports = {
  initNginxLoadtest,
  SEKME,
  _ADMIN_DISI_OKUMA: ADMIN_DISI_OKUMA,
  _yonlendiriciKurForTest: yonlendiriciKur,
  _kosuPlaniForTest: kosuPlani,
  _kararliJsonForTest: kararliJson,
  _adimApiForTest: adimApi,
  _kosuApiForTest: kosuApi,
  _protokolOfForTest: protokolOf,
  _LISTE_KOLONLARI: LISTE_KOLONLARI,
  _kuyrukIslemForTest: kuyrukIslem,
  _otoDurdurForTest: otoDurdur,
  _durdurSurenForTest: durdurSuren,
  _kuyrukYetkisiForTest: kuyrukYetkisi,
};
