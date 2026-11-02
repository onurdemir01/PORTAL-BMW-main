// server/nginx-loadtest/araclar.cjs - Yuk Testi arac setleri (tur 4, 2026-11-02; arac_sozlesme.md).
//
// Yuk araclari (k6 + wrk) yuk makinelerine KALICI kurulmaz. Admin "Araclari hazirla" ile AYNI AWX
// sablonunu (nginx_loadtest_run) yuk_islem='araclar' ile baslatir: derleme makinesi (varsayilan
// GBLABT02) k6 resmi surum arsivini (resmi checksums dosyasiyla) ve wrk 4.2.0 kaynagini kurumsal
// vekil uzerinden indirir, wrk'yi derler; ikililer /sw'de <NGINX_LOADTEST_DIR>/araclar/<id>/ altina
// yazilir (0644, calistirilamaz). Her on kontrol / kosu secilen motorun ikilisini www kosu dizinine
// kopyalar, sha256'sini YALNIZ Portal'in verdigi degerle (bu tablodaki) dogrular, calistirir, siler.
//
// GUVEN KOKU PORTAL'DIR: sha256'lar bu modulun sonuclandirmasinda playbook set_stats'tan (derleme +
// /sw geri okuma) alinir; /sw'deki SHA256SUMS / manifest.json insan icindir.
//
// ARSIV OZETLERI SABITTIR (koordinator karari D1, 2026-11-02; ilk-kullanimda-guven KALKTI): k6
// arsivinin ve wrk 4.2.0 kaynak arsivinin sha256'si Portal env'inde (NGINX_LOADTEST_K6_ARSIV_SHA256,
// NGINX_LOADTEST_WRK_KAYNAK_SHA256; 64 hex) VERILMEK ZORUNDA. Biri eksik / gecersizse "Araclari hazirla"
// 409 arac_ozet_sabit_yok (is, kilit, satir yok) ve hicbir set etkin degildir. Playbook iki arsivi bu
// degerlerle acmadan / derlemeden / calistirmadan ONCE dogrular; farkliysa FAIL, hicbir sey calismaz.
// Admin onay toreni (aracOnayla, kaynak_onay) KALKTI; kolonlar tabloda kalir, okunmaz.
//
// ETKIN SET = en yeni DONE + geri cekilmemis (geri_cekme_at NULL) + iki sha ve sw_dizin dolu + istenen
// VE kaydedilen arsiv ozetleri SU ANKI env degerleriyle ayni. env degisirse eski setler kendiliginden
// devre disi (fail-closed, acik metin). Admin bir DONE seti geri cekebilir (D2, denetim kaydi); etkin
// set o zaman kurala uyan bir onceki DONE sete duser, yoksa set yok.
//
// Bu dosya ust duzeyde yalniz dogrula.cjs'i yukler (Ansible bekcisi L12 aracEkstraDegiskenler'i
// tek basina cagirir); db / AWX / kilit tembel yuklenir.
'use strict';

const crypto = require('node:crypto');
const dg = require('./dogrula.cjs');

const VARSAYILAN_DERLEME_HOST = 'GBLABT02';
const VARSAYILAN_PROXY = 'http://tekprxv2.fw.garanti.com.tr:80';
const VARSAYILAN_K6_SURUM = 'v0.49.0';
const WRK_SURUM = dg.WRK_SURUM;
const K6_SURUM_RE = /^v0\.(4[5-9]|5[0-9])\.[0-9]{1,2}$/;
// Yalniz http://<ad>:<port>; kimlik bilgisi (@), yol, buyuk harf, https YOK.
const PROXY_RE = /^http:\/\/[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?:[0-9]{1,5}$/;
// Playbook yt_re_cikti_kok ile AYNI (arac seti yalniz /sw altinda olur).
const CIKTI_KOK_PB_RE = /^\/sw\/BMW_PORTAL(_DEV)?(\/[A-Za-z0-9._-]+)+$/;
const PROXY_HATASI = 'NGINX_LOADTEST_ARAC_PROXY geçersiz';
const ARAC_STATS_ANAHTARI = 'nginx_loadtest_result';
const AKTIF_ARAC = Object.freeze(['QUEUED', 'RUNNING', 'FINALIZING']);
const BAYAT_KUYRUK_DK = 15;
// Derleme isinin uzaktaki ust siniri (Play 8: timeout -k 30 1800) + 404 payi.
const ARAC_IS_SURESI_SN = 1800;
const YOK_PAYI_SN = 600;
// PU2: AWX'i (404 disi hata, sunucu yapilandirmadan kalkti) bu kadar suredir okunamayan aktif satir
// OKUNAMADI yazilir (butce + pay + 12 sa; kilit.cjs 12 saatlik devralma kuraliyla ayni pencere).
const OKUNAMAZ_SURE_SN = ARAC_IS_SURESI_SN + YOK_PAYI_SN + 12 * 3600;
const OKUMA_DENEME_SINIRI = 3;
const SONUC_MAX_BAYT = 256 * 1024;
const ESKI_PLAYBOOK_IZI = 'yuk_islem on_kontrol|kosu|durdur';
const ESKI_PLAYBOOK_NOTU = ' (Ansible deposu güncel değil: araclar kipi yok)';
// PU1: arsiv sabit ozetle tutmadi (get_url "did not match" / playbook "ozetiyle (ENV) farkli", "ozeti sabit
// degerden farkli"): "ozet" ile "farkli" arasinda ayni cumle icinde en cok 80 karakter olabilir.
const OZET_FARKLI_IZI = /did not match|checksum mismatch|ozet[a-z]*\b[^;]{0,80}?\bfarkli|ozet[a-z]*\s+(ayni degil|uyusmuyor)/i;
const OZET_FARKLI_NOTU = ' (arşiv sabitlenen özetle uyuşmuyor, hiçbir şey derlenmedi: arşivi kurum vekili dışında yeniden doğrulayın; gerçekten değiştiyse NGINX_LOADTEST_K6_ARSIV_SHA256 / NGINX_LOADTEST_WRK_KAYNAK_SHA256’yı güncelleyin)';
const OZET_ENVLERI = Object.freeze({ k6Arsiv: 'NGINX_LOADTEST_K6_ARSIV_SHA256', wrkKaynak: 'NGINX_LOADTEST_WRK_KAYNAK_SHA256' });
const BELGE_BOLUMU = 'docs/NGINX-YUK-TESTI.md › “Arşiv özetlerini sabitleme”';

// Sozlesme 2.3: TAM 10 anahtar, sira baglayici (playbook README tablosu / bekci ARAC_VARS).
const ARAC_EKSTRA_ANAHTARLAR = Object.freeze([
  'yuk_islem', 'yuk_run_id', 'yuk_derleme_host', 'yuk_k6_surum', 'yuk_wrk_surum',
  'yuk_k6_arsiv_sha256', 'yuk_wrk_kaynak_sha256', 'yuk_proxy', 'yuk_cikti_kok', 'yuk_son_epoch',
]);

const MESAJ = Object.freeze({
  hazirDegil: 'Yük araçları henüz hazırlanmadı: Yük Testi › Araçlar bölümünden “Araçları hazırla” ile k6 ve wrk’yi /sw’ye hazırlayın (yalnız Admin).',
  ozetDegisti: 'Sabitlenen arşiv özetleriyle hazırlanmış bir araç seti yok (özetler değişmiş olabilir): Yük Testi › Araçlar bölümünden “Araçları hazırla” ile yeniden hazırlayın (yalnız Admin).',
  geriCekildi: 'Sabitlenen özetlerle hazırlanmış araç setleri geri çekildi: Yük Testi › Araçlar bölümünden “Araçları hazırla” ile yeni set hazırlayın (yalnız Admin).',
  okunamadi: 'Araç seti okunamadı; iş başlatılmadı, lütfen tekrar deneyin.',
  okunamadiEkran: 'Araç seti okunamadı; yeniden deneyin.',
  onKontrolEski: 'Etkin yük aracı seti ön kontrolden bu yana değişti (yeniden hazırlandı ya da geri çekildi); ön kontrolü yeniden çalıştırın.',
  onKontrolAracsiz: 'Bu ön kontrol araç setleri gelmeden (eski sürümle) yapıldı; ön kontrolü yeniden çalıştırın.',
});

/** Eksik / gecersiz sabit ozet listesi -> kapi metni (on kontrol / kosu / ekran). */
function ozetSabitYokMesaji(eksikler) {
  return `Yük aracı arşiv özetleri sabitlenmemiş (${eksikler.join(', ')}): iki özeti de Portal ortamına (.env) 64 haneli sha256 olarak yazıp Portal’ı yeniden başlatın; komutlar ${BELGE_BOLUMU} bölümünde.`;
}

const NEDEN = Object.freeze({
  eksik: 'araç sonucu eksik ya da bu işe ait değil',
  sha: 'sha256 değerleri geçersiz',
  surum: 'sürüm satırı beklenenle uyuşmuyor',
  dizin: '/sw dizini beklenenden farklı',
  sabitYok: 'iş sabit arşiv özetleri olmadan başlatılmış',
  wrkKaynak: 'wrk kaynak özeti sabit değerden farklı',
  k6Arsiv: 'k6 arşiv özeti sabit değerden farklı',
});

const db = () => require('../db/index.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(s);
const maskeleDerin = (v) => require('../retirement/is-ciktisi.cjs').maskeleDerin(v);

function hata(status, code, message, ek) {
  return Object.assign(new Error(message), { status, code }, ek || {});
}

const sha = (v) => (v == null ? null : String(v).trim().toLowerCase() || null);
const iso = (v) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));
const sayiYaDaNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function jsonOku(s) {
  if (s == null || s === '') return null;
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

// ── ORTAM ─────────────────────────────────────────────────────────────────────────────────

/**
 * Derleme makinesi izin listesi (NGINX_LOADTEST_DERLEME_HOSTLARI; virgul / bosluk / ';'). Girdi
 * GBLABT02 ya da ad kuralina gore DEV/TEST/QA (EDU degil) olmali; gecersiz atilir (bir kez uyari).
 * Liste bos kalirsa ['GBLABT02']. Ilk eleman varsayilan.
 */
function derlemeHostlari(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_DERLEME_HOSTLARI ?? '').trim();
  if (!ham) return [VARSAYILAN_DERLEME_HOST];
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  const out = [];
  for (const girdi of ham.split(/[\s,;]+/).filter(Boolean)) {
    const h = dg.hostNormalle(girdi);
    const uygun = h && (h === VARSAYILAN_DERLEME_HOST || dg.IZINLI_ORTAM.has(envOfHost(h)));
    if (!uygun) {
      dg.birKezUyar('NGINX_LOADTEST_DERLEME_HOSTLARI', girdi, 'GBLABT02 ya da DEV/TEST/QA nginx adi degil');
      continue;
    }
    if (!out.includes(h)) out.push(h);
  }
  return out.length ? out : [VARSAYILAN_DERLEME_HOST];
}

function varsayilanDerlemeHost(env = process.env) {
  return derlemeHostlari(env)[0];
}

/** Indirme vekili: { proxy, hata }. Bos -> varsayilan; 'yok' -> '' (vekilsiz); gecersiz -> hata. */
function aracProxy(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_ARAC_PROXY ?? '').trim();
  if (!ham) return { proxy: VARSAYILAN_PROXY, hata: null };
  const v = ham.toLowerCase();
  if (v === 'yok') return { proxy: '', hata: null };
  if (PROXY_RE.test(v)) return { proxy: v, hata: null };
  return { proxy: null, hata: PROXY_HATASI };
}

function k6Surum(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_K6_SURUM ?? '').trim();
  if (!ham) return VARSAYILAN_K6_SURUM;
  if (K6_SURUM_RE.test(ham)) return ham;
  dg.birKezUyar('NGINX_LOADTEST_K6_SURUM', ham, 'izinli v0.45.0..v0.59.x', 'kullanilmadi, varsayilan v0.49.0');
  return VARSAYILAN_K6_SURUM;
}

/**
 * Sabit ozet env'i (ZORUNLU): TAM 64 hex (kirpilir; buyuk harf kucultulur, sha256sum ciktisi zaten
 * kucuk). Donus: { deger: '<64 kucuk hex>' | null, neden: null | (Turkce: tanimli degil / 64 hex degil) }.
 */
function sabitOzetDurumu(env, ad) {
  const ham = String(env[ad] ?? '').trim();
  if (!ham) return { deger: null, neden: 'tanımlı değil' };
  const v = ham.toLowerCase();
  if (dg.SHA256_RE.test(v)) return { deger: v, neden: null };
  dg.birKezUyar(ad, ham, '64 hex degil');
  return { deger: null, neden: '64 hex değil' };
}

/** Geriye uyumlu tekil okuma: gecerli deger ya da null. */
function sabitOzetEnv(env, ad) {
  return sabitOzetDurumu(env, ad).deger;
}

/**
 * Sabit arsiv ozetleri (SENKRON; DB okumaz - onceki setten devralma YOK). Donus:
 * { k6Arsiv, wrkKaynak (64 kucuk hex | ''), eksikler: ['<ENV> <neden>', ...] }.
 * eksikler bos degilse hicbir set etkin degildir ve hazirlama 409 ile reddedilir.
 */
function sabitOzetler(env = process.env) {
  const k6 = sabitOzetDurumu(env, OZET_ENVLERI.k6Arsiv);
  const wrk = sabitOzetDurumu(env, OZET_ENVLERI.wrkKaynak);
  const eksikler = [];
  if (!k6.deger) eksikler.push(`${OZET_ENVLERI.k6Arsiv} ${k6.neden}`);
  if (!wrk.deger) eksikler.push(`${OZET_ENVLERI.wrkKaynak} ${wrk.neden}`);
  return { k6Arsiv: k6.deger || '', wrkKaynak: wrk.deger || '', eksikler };
}

// ── EXTRA_VARS ────────────────────────────────────────────────────────────────────────────

/** Sozlesme 2.3: 10 anahtar, hepsi METIN, sira ARAC_EKSTRA_ANAHTARLAR. `limit` her zaman ''. */
function aracEkstraDegiskenler({ aracId, derlemeHost, k6Surum: k6v, wrkSurum = WRK_SURUM, k6ArsivSha256 = '', wrkKaynakSha256 = '', proxy = '', kok, simdiSn = Math.floor(Date.now() / 1000) }) {
  return {
    yuk_islem: 'araclar',
    yuk_run_id: String(aracId),
    yuk_derleme_host: String(derlemeHost ?? ''),
    yuk_k6_surum: String(k6v ?? ''),
    yuk_wrk_surum: String(wrkSurum ?? ''),
    yuk_k6_arsiv_sha256: String(k6ArsivSha256 ?? ''),
    yuk_wrk_kaynak_sha256: String(wrkKaynakSha256 ?? ''),
    yuk_proxy: String(proxy ?? ''),
    yuk_cikti_kok: String(kok ?? ''),
    yuk_son_epoch: String(Math.floor(simdiSn) + dg.SINIRLAR.isGecerlilikSn),
  };
}

/**
 * Son kapi (playbook Play 1 araclar assert'i ile ayni kurallar). Iki arsiv ozeti ZORUNLU 64 kucuk hex
 * (D1: bos ozet = ilk-kullanimda-guven, artik gonderilmez). Donus: ihlal listesi (bos = gecerli).
 */
function aracEkstraDegiskenleriDenetle(ev, { simdiSn = Math.floor(Date.now() / 1000) } = {}) {
  const ihlal = [];
  const o = ev && typeof ev === 'object' ? ev : {};
  const metin = (k) => typeof o[k] === 'string';
  const shaZorunlu = (k) => metin(k) && dg.SHA256_RE.test(o[k]);
  const { envOfHost } = require('../audit/nginx-hosts.cjs');
  if (o.yuk_islem !== 'araclar') ihlal.push('yuk_islem');
  if (!metin('yuk_run_id') || !dg.RUN_ID_RE.test(o.yuk_run_id)) ihlal.push('yuk_run_id');
  const h = o.yuk_derleme_host;
  if (!metin('yuk_derleme_host') || !dg.HOST_RE.test(h) || !(h === VARSAYILAN_DERLEME_HOST || dg.IZINLI_ORTAM.has(envOfHost(h)))) ihlal.push('yuk_derleme_host');
  if (!metin('yuk_k6_surum') || !K6_SURUM_RE.test(o.yuk_k6_surum)) ihlal.push('yuk_k6_surum');
  if (o.yuk_wrk_surum !== WRK_SURUM) ihlal.push('yuk_wrk_surum');
  if (!shaZorunlu('yuk_k6_arsiv_sha256')) ihlal.push('yuk_k6_arsiv_sha256');
  if (!shaZorunlu('yuk_wrk_kaynak_sha256')) ihlal.push('yuk_wrk_kaynak_sha256');
  if (!metin('yuk_proxy') || !(o.yuk_proxy === '' || PROXY_RE.test(o.yuk_proxy))) ihlal.push('yuk_proxy');
  if (!dg.yolGuvenli(o.yuk_cikti_kok, CIKTI_KOK_PB_RE)) ihlal.push('yuk_cikti_kok');
  const epoch = metin('yuk_son_epoch') && dg.EPOCH_RE.test(o.yuk_son_epoch) ? Number(o.yuk_son_epoch) : null;
  if (epoch === null || epoch < simdiSn || epoch > simdiSn + dg.SON_EPOCH_UST_PAY_SN) ihlal.push('yuk_son_epoch');
  for (const k of Object.keys(o)) if (!ARAC_EKSTRA_ANAHTARLAR.includes(k)) ihlal.push(k);
  for (const k of ARAC_EKSTRA_ANAHTARLAR) if (!(k in o) && !ihlal.includes(k)) ihlal.push(k);
  return ihlal;
}

// ── SATIR -> API ──────────────────────────────────────────────────────────────────────────

const ARAC_KOLONLARI = `id, durum, derleme_host, k6_surum, wrk_surum, istenen_k6_arsiv_sha256, istenen_wrk_kaynak_sha256,
  k6_sha256, wrk_sha256, k6_arsiv_sha256, wrk_kaynak_sha256, sw_dizin, derleme_rhel,
  derleme_glibc, wrk_glibc_gerekli, hata, sonuc, awx_server_id, awx_job_id, kilit_id, sonuclandirma_denemesi, created_by,
  created_at, started_at, finished_at, finalized_at, geri_ceken, geri_cekme_at,
  DATEDIFF(SECOND, COALESCE(started_at, created_at), GETUTCDATE()) AS calisma_yas_sn`;

function awxUrlOf(sid, jid) {
  if (sid == null || !(Number(jid) > 0)) return null;
  try {
    const runner = require('../ansible/runner.cjs');
    return require('../retirement/is-ciktisi.cjs')._awxIsAdresi(runner.getServerById(Number(sid)), Number(jid)) || null;
  } catch {
    return null;
  }
}

/** Satirin istenen ozetleri su anki sabit ozetlerle ayni mi (sabit eksikse false). */
function ozetlerGuncelMi(r, sabit) {
  if (!r || !sabit || sabit.eksikler.length) return false;
  return sha(r.istenen_k6_arsiv_sha256) === sabit.k6Arsiv && sha(r.istenen_wrk_kaynak_sha256) === sabit.wrkKaynak;
}

/**
 * Satir -> AracSeti (sozlesme 2.2; D1/D2). wrkOpenssl / wrkLuajit saklanan set_stats'tan. `ozetlerGuncel`:
 * setin arsiv ozetleri su anki env sabitleriyle ayni (degilse set etkin olamaz). `geriCekildi`: Admin geri cekti.
 */
function aracApi(r, sabit = sabitOzetler()) {
  const a = ((jsonOku(r.sonuc) || {}).araclar) || {};
  const m = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: Number(r.id),
    durum: r.durum,
    derlemeHost: r.derleme_host,
    k6Surum: r.k6_surum,
    wrkSurum: r.wrk_surum,
    k6Sha256: sha(r.k6_sha256),
    wrkSha256: sha(r.wrk_sha256),
    k6ArsivSha256: sha(r.k6_arsiv_sha256),
    wrkKaynakSha256: sha(r.wrk_kaynak_sha256),
    ozetlerGuncel: ozetlerGuncelMi(r, sabit),
    geriCekildi: r.geri_cekme_at != null,
    geriCeken: r.geri_ceken ?? null,
    geriCekmeAt: iso(r.geri_cekme_at),
    calismaYasSn: sayiYaDaNull(r.calisma_yas_sn),
    swDizin: r.durum === 'DONE' ? r.sw_dizin ?? null : null,
    derlemeRhel: r.derleme_rhel ?? null,
    derlemeGlibc: r.derleme_glibc ?? null,
    wrkGlibcGerekli: r.wrk_glibc_gerekli ?? null,
    wrkOpenssl: m(a.wrk_openssl),
    wrkLuajit: m(a.wrk_luajit),
    hata: r.hata ?? null,
    awxServerId: sayiYaDaNull(r.awx_server_id),
    awxJobId: sayiYaDaNull(r.awx_job_id),
    awxUrl: awxUrlOf(r.awx_server_id, r.awx_job_id),
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

// ── ETKIN SET VE KAPI ─────────────────────────────────────────────────────────────────────

/**
 * Etkin set (D1): en yeni DONE, geri cekilmemis, iki sha + sw_dizin dolu, istenen VE kaydedilen arsiv
 * ozetleri su anki sabitlerle ayni. Sabit ozet eksikse DB okunmaz, null.
 */
async function etkinAracSeti(d = db(), sabit = sabitOzetler()) {
  if (sabit.eksikler.length) return null;
  const { rows } = await d.query(
    `SELECT TOP 1 ${ARAC_KOLONLARI} FROM nginx_loadtest_araclar
      WHERE durum = 'DONE' AND geri_cekme_at IS NULL AND k6_sha256 IS NOT NULL AND wrk_sha256 IS NOT NULL AND sw_dizin IS NOT NULL
        AND istenen_k6_arsiv_sha256 = $1 AND istenen_wrk_kaynak_sha256 = $2 AND k6_arsiv_sha256 = $1 AND wrk_kaynak_sha256 = $2
      ORDER BY id DESC`,
    [sabit.k6Arsiv, sabit.wrkKaynak],
  );
  return (rows && rows[0]) || null;
}

/**
 * Etkin set + kapi karari (firlatmaz; DB hatasi yukari). Donus: { hazir, etkin, aracId, k6Surum, wrkSurum,
 * kod: null | 'araclar_ozet_sabit_yok' | 'araclar_hazir_degil' | 'araclar_ozet_degisti' | 'araclar_geri_cekildi', mesaj }.
 */
async function aracDurumu(d = db(), sabit = sabitOzetler()) {
  const yok = (kod, mesaj) => ({ hazir: false, etkin: null, aracId: null, k6Surum: null, wrkSurum: null, kod, mesaj });
  if (sabit.eksikler.length) return yok('araclar_ozet_sabit_yok', ozetSabitYokMesaji(sabit.eksikler));
  const etkin = await etkinAracSeti(d, sabit);
  if (etkin) return { hazir: true, etkin, aracId: Number(etkin.id), k6Surum: etkin.k6_surum, wrkSurum: etkin.wrk_surum, kod: null, mesaj: null };
  // Neden: bu ozetlerle DONE set var mi (varsa en yenisi geri cekilmis mi), yoksa hic DONE var mi.
  const es = (await d.query(
    `SELECT TOP 1 id, geri_cekme_at FROM nginx_loadtest_araclar
      WHERE durum = 'DONE' AND istenen_k6_arsiv_sha256 = $1 AND istenen_wrk_kaynak_sha256 = $2 ORDER BY id DESC`,
    [sabit.k6Arsiv, sabit.wrkKaynak],
  )).rows;
  const eslesen = (es && es[0]) || null;
  if (eslesen) return eslesen.geri_cekme_at != null ? yok('araclar_geri_cekildi', MESAJ.geriCekildi) : yok('araclar_hazir_degil', MESAJ.hazirDegil);
  const so = (await d.query(`SELECT TOP 1 id FROM nginx_loadtest_araclar WHERE durum = 'DONE' ORDER BY id DESC`)).rows;
  return so && so[0] ? yok('araclar_ozet_degisti', MESAJ.ozetDegisti) : yok('araclar_hazir_degil', MESAJ.hazirDegil);
}

/** /hedefler icin (uc 200 kalir): DB okunamazsa hazir:false + db_okunamadi. */
async function aracDurumuEkran(d) {
  try {
    const { etkin, ...geri } = await aracDurumu(d || db());
    return geri;
  } catch (e) {
    console.warn('[NginxYukTesti] arac seti okunamadi (/hedefler):', maskele(e && e.message));
    return { hazir: false, aracId: null, k6Surum: null, wrkSurum: null, kod: 'db_okunamadi', mesaj: MESAJ.okunamadiEkran };
  }
}

/** On kontrol / kosu kapisi: etkin seti doner ya da 409 (aracDurumu kodu) / 424 (okunamadi) atar. */
async function aracKapisi(d) {
  let r;
  try {
    r = await aracDurumu(d || db());
  } catch (e) {
    throw hata(424, 'db_okunamadi', MESAJ.okunamadi);
  }
  if (!r.hazir) throw hata(409, r.kod, r.mesaj);
  return r.etkin;
}

/** Kosu satirindaki motorun beklenen sha256'si (etkin setten). */
function motorSha(set, motor) {
  if (!set) return null;
  return sha(motor === 'wrk' ? set.wrk_sha256 : set.k6_sha256);
}

/** ekstraDegiskenler'in `arac` parametresi. */
function aracDegiskeni(set) {
  return { dizin: String(set.sw_dizin || ''), k6Sha256: sha(set.k6_sha256) || '', wrkSha256: sha(set.wrk_sha256) || '' };
}

async function aracSetiOku(d, id) {
  const { rows } = await d.query(`SELECT ${ARAC_KOLONLARI} FROM nginx_loadtest_araclar WHERE id = $1`, [id]);
  return (rows && rows[0]) || null;
}

// ── SONUCLANDIRMA (poller.tick her turda cagirir) ─────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;

/** set_stats araclar bolumu bu satira ait ve gecerli mi (sozlesme 2.7). Donus: { ok, neden }. */
function aracGecerli(a, s) {
  if (!a || typeof a !== 'object' || !s) return { ok: false, neden: NEDEN.eksik };
  if (Number(a.arac_id) !== Number(s.id) || a.derleme_host !== s.derleme_host || a.k6_surum !== s.k6_surum || a.wrk_surum !== s.wrk_surum) {
    return { ok: false, neden: NEDEN.eksik };
  }
  for (const k of ['k6_sha256', 'wrk_sha256', 'k6_arsiv_sha256', 'wrk_kaynak_sha256']) {
    if (typeof a[k] !== 'string' || !HEX64.test(a[k])) return { ok: false, neden: NEDEN.sha };
  }
  const k6Satir = typeof a.k6_surum_satiri === 'string' ? a.k6_surum_satiri : '';
  const wrkSatir = typeof a.wrk_surum_satiri === 'string' ? a.wrk_surum_satiri : '';
  const k6Bas = `k6 ${s.k6_surum}`;
  if (!(k6Satir.startsWith(k6Bas) && (k6Satir.length === k6Bas.length || k6Satir[k6Bas.length] === ' '))) return { ok: false, neden: NEDEN.surum };
  if (!wrkSatir.startsWith(`wrk ${s.wrk_surum} `)) return { ok: false, neden: NEDEN.surum };
  if (typeof a.sw_dizin !== 'string' || a.sw_dizin !== s.sw_dizin) return { ok: false, neden: NEDEN.dizin };
  // D1: is sabit ozetlerle baslatilmis olmali (bos istenen = eski ilk-kullanimda-guven isi; DONE olmaz).
  const istenenK6 = sha(s.istenen_k6_arsiv_sha256);
  const istenenWrk = sha(s.istenen_wrk_kaynak_sha256);
  if (!istenenK6 || !istenenWrk) return { ok: false, neden: NEDEN.sabitYok };
  if (a.k6_arsiv_sha256 !== istenenK6) return { ok: false, neden: NEDEN.k6Arsiv };
  if (a.wrk_kaynak_sha256 !== istenenWrk) return { ok: false, neden: NEDEN.wrkKaynak };
  return { ok: true, neden: null };
}

/** set_stats -> { stats, uyusmazlik }; baska isin sonucu (run_id / islem) kullanilmaz. */
function aracStatsNormalle(ham, satir) {
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return { stats: null, uyusmazlik: null };
  if (String(ham.run_id ?? '') !== String(satir.id)) return { stats: null, uyusmazlik: `run_id ${String(ham.run_id ?? '?').slice(0, 20)}` };
  if (String(ham.islem ?? '') !== 'araclar') return { stats: null, uyusmazlik: `islem ${String(ham.islem ?? '?').slice(0, 20)}` };
  let s = maskeleDerin(ham);
  s.durum = String(s.durum ?? '').trim().toUpperCase();
  if (JSON.stringify(s).length > SONUC_MAX_BAYT) s = { surum: s.surum, run_id: s.run_id, islem: s.islem, durum: s.durum, hata: s.hata, araclar: s.araclar, kirpildi: true };
  if (JSON.stringify(s).length > SONUC_MAX_BAYT) s = { surum: s.surum, run_id: s.run_id, islem: s.islem, durum: s.durum, kirpildi: true };
  return { stats: s, uyusmazlik: null };
}

function hataMetni(v) {
  const m = maskele(String(v ?? '')).trim();
  const ek = (m.includes(ESKI_PLAYBOOK_IZI) ? ESKI_PLAYBOOK_NOTU : '') + (OZET_FARKLI_IZI.test(m) ? OZET_FARKLI_NOTU : '');
  return `${m.slice(0, Math.max(0, 1000 - ek.length))}${ek}`;
}

const kisaAscii = (v, n, re) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= n && re.test(t) ? t : null;
};

/** Terminal is -> karar (saf). Donus: { durum, hata, sonuc, a? }. */
function aracKarari(st, stats, uyusmazlik, satir, deneme) {
  if (st.missing) return { durum: 'OKUNAMADI', hata: hataMetni(st.jobExplanation), sonuc: { hata: st.jobExplanation } };
  if (deneme > OKUMA_DENEME_SINIRI) return { durum: 'OKUNAMADI', hata: 'sonuç 3 denemede okunamadı', sonuc: stats };
  if (st.status === 'canceled') return { durum: 'CANCELED', hata: hataMetni((stats && stats.hata) || st.jobExplanation || 'iş iptal edildi'), sonuc: stats };
  if (!stats) {
    const neden = uyusmazlik ? `yayınlanan sonuç bu işe ait değil (${uyusmazlik})` : 'set_stats sonucu (nginx_loadtest_result) yok';
    return st.status === 'successful'
      ? { durum: 'OKUNAMADI', hata: neden, sonuc: { hata: neden } }
      : { durum: 'FAILED', hata: hataMetni(st.jobExplanation || neden), sonuc: { hata: neden } };
  }
  const g = aracGecerli(stats.araclar, satir);
  if (st.status === 'successful' && stats.durum === 'OK' && g.ok) return { durum: 'DONE', hata: null, sonuc: stats, a: stats.araclar };
  return { durum: 'FAILED', hata: hataMetni(stats.hata || g.neden || `AWX işi ${st.status}`), sonuc: stats };
}

function bitisZamani(v) {
  if (v == null || v === '') return null;
  const t = new Date(String(v));
  return Number.isFinite(t.getTime()) ? t : null;
}

async function aracSonYaz(satir, st, k) {
  const sonucJson = k.sonuc == null ? null : (() => {
    const s = JSON.stringify(k.sonuc);
    return s.length <= SONUC_MAX_BAYT ? s : JSON.stringify({ kirpildi: true });
  })();
  const bitis = bitisZamani(st && st.finished);
  if (k.durum === 'DONE') {
    const a = k.a;
    await db().query(
      `UPDATE nginx_loadtest_araclar
          SET durum = 'DONE', k6_sha256 = $2, wrk_sha256 = $3, k6_arsiv_sha256 = $4, wrk_kaynak_sha256 = $5,
              derleme_rhel = $6, derleme_glibc = $7, wrk_glibc_gerekli = $8, sonuc = $9, hata = NULL,
              finished_at = COALESCE($10, finished_at, GETUTCDATE()), finalized_at = GETUTCDATE()
        WHERE id = $1 AND durum = 'FINALIZING'`,
      [Number(satir.id), a.k6_sha256, a.wrk_sha256, a.k6_arsiv_sha256, a.wrk_kaynak_sha256,
        kisaAscii(a.derleme_rhel, 8, /^[0-9]{1,3}$/), kisaAscii(a.derleme_glibc, 16, /^[0-9]+\.[0-9]+(\.[0-9]+)?$/),
        kisaAscii(a.wrk_glibc_gerekli, 16, /^[0-9]+\.[0-9]+(\.[0-9]+)?$/), sonucJson, bitis],
    );
    return;
  }
  await db().query(
    `UPDATE nginx_loadtest_araclar
        SET durum = $2, hata = $3, sonuc = $4, finished_at = COALESCE($5, finished_at, GETUTCDATE()), finalized_at = GETUTCDATE()
      WHERE id = $1 AND durum = 'FINALIZING'`,
    [Number(satir.id), k.durum, k.hata == null ? null : String(k.hata).slice(0, 1000), sonucJson, bitis],
  );
}

async function aracBayatKuyruk() {
  const r = await db().query(
    `UPDATE nginx_loadtest_araclar
        SET durum = 'FAILED', hata = $1, finalized_at = GETUTCDATE(), finished_at = COALESCE(finished_at, GETUTCDATE())
      WHERE durum = 'QUEUED' AND awx_job_id IS NULL AND created_at < DATEADD(MINUTE, -${BAYAT_KUYRUK_DK}, GETUTCDATE())`,
    ['Başlatma tamamlanmadı (AWX iş numarası kaydedilemedi).'],
  );
  return r.rowCount || 0;
}

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);

/** Tek arac isi. AWX okunamazsa HATA atar (satir degismez). */
async function araciSonuclandir(satir) {
  const runner = require('../ansible/runner.cjs');
  const kilit = require('./kilit.cjs');
  const id = Number(satir.id);
  const sid = Number(satir.awx_server_id);
  const jid = Number(satir.awx_job_id);
  if (!Number.isInteger(sid) || sid < 0 || !Number.isInteger(jid) || jid <= 0) return { terminal: false, isYok: true };
  const yas = sayiYaDaNull(satir.calisma_yas_sn);
  let st;
  try {
    st = await runner.getJobStatusOnServer(sid, jid);
  } catch (e) {
    if (e && Number(e.status) === 404 && e.code !== 'awx_server_missing' && yas !== null && yas > ARAC_IS_SURESI_SN + YOK_PAYI_SN) {
      st = { status: 'error', missing: true, artifacts: {}, jobExplanation: `AWX iş #${jid} artık yok`, finished: null };
    } else if (yas !== null && yas > OKUNAMAZ_SURE_SN) {
      // PU2: AWX (sunucu yapilandirmadan kalkti, kalici 403 / 5xx) butce + pay + 12 sa'tir okunamiyor:
      // satir OKUNAMADI olur ("Araclari hazirla" acilir); kilit 12 saatlik devralma kuraliyla zaten duser.
      const neden = maskele(String((e && (e.code || e.message)) || 'bilinmeyen hata')).slice(0, 160);
      st = { status: 'error', missing: true, artifacts: {}, jobExplanation: `AWX iş #${jid} durumu 12 saatten uzun süredir okunamıyor (${neden})`, finished: null };
    } else {
      throw e;
    }
  }
  // PU4 (poller ile ayni kural): terminal is olay islemesini bitirmediyse stdout eksik olabilir; is
  // OLAY_BEKLEME_SN'den yeni bittiyse beklenir (bitis yoksa satir butce + pay'i gecene dek).
  let olayBekle = false;
  if (TERMINAL.has(st.status) && st.eventProcessingFinished === false && !st.missing) {
    const bitis = bitisZamani(st.finished);
    const bekleme = require('./poller.cjs').OLAY_BEKLEME_SN;
    olayBekle = bitis ? (Date.now() - bitis.getTime()) / 1000 < bekleme : !(yas !== null && yas > ARAC_IS_SURESI_SN + YOK_PAYI_SN);
  }
  if (!TERMINAL.has(st.status) || olayBekle) {
    if (satir.durum === 'QUEUED') {
      await db().query(`UPDATE nginx_loadtest_araclar SET durum = 'RUNNING', started_at = COALESCE(started_at, GETUTCDATE()) WHERE id = $1 AND durum = 'QUEUED'`, [id]);
    }
    return { terminal: false, awxStatus: st.status };
  }
  const al = await db().query(
    `UPDATE nginx_loadtest_araclar SET durum = 'FINALIZING', sonuclandirma_denemesi = sonuclandirma_denemesi + 1
      WHERE id = $1 AND durum IN ('QUEUED', 'RUNNING', 'FINALIZING') RETURNING sonuclandirma_denemesi`,
    [id],
  );
  if (!al.rowCount) return { terminal: true, atlandi: true };
  const d0 = Number(al.rows && al.rows[0] && al.rows[0].sonuclandirma_denemesi);
  const deneme = Number.isInteger(d0) ? d0 : OKUMA_DENEME_SINIRI;
  try {
    if (kilit.bagliIsKarari('araclar', st.status) === 'birak') await kilit.releaseLocksForJob(db(), sid, jid, st.finished || null);
    else await kilit.isinKilitleriniCoz(db(), sid, jid);
  } catch (e) {
    console.warn(`[NginxYukTesti araclar] arac ${id} kilidi birakilamadi/cozulemedi (supurme/TTL halleder):`, maskele(e && e.message));
  }
  const ham = require('../scalex/result.cjs').extractStatsKey(st.artifacts, ARAC_STATS_ANAHTARI);
  const { stats, uyusmazlik } = aracStatsNormalle(ham, satir);
  if (!st.missing) {
    try {
      await require('./poller.cjs').ciktiArsivle(sid, jid);
    } catch (e) {
      console.warn(`[NginxYukTesti araclar] is #${jid} ciktisi arsivlenemedi:`, maskele(e && e.message));
    }
  }
  const k = aracKarari(st, stats, uyusmazlik, satir, deneme);
  await aracSonYaz(satir, st, k);
  return { terminal: true, durum: k.durum };
}

/**
 * poller.tick her turda cagirir: bayat kuyruk + en cok 5 aktif arac isi. SIRA (aclik kalkani): once
 * butce + pay icindeki GENC isler (en yeni once), sonra eskiler (en eski once). AWX'i okunamayan eski
 * satirlar yeni isleri asla geride birakmaz; eskiler de en eskisi once OKUNAMADI esigine varip kuyruktan
 * cikar (PU2).
 */
async function araclariSonuclandir() {
  let kapanan = 0;
  const bayat = await aracBayatKuyruk().catch((e) => {
    console.warn('[NginxYukTesti araclar] bayat kuyruk temizlenemedi:', maskele(e && e.message));
    return 0;
  });
  const esik = ARAC_IS_SURESI_SN + YOK_PAYI_SN;
  const yasIfadesi = 'DATEDIFF(SECOND, COALESCE(started_at, created_at), GETUTCDATE())';
  const { rows } = await db().query(
    `SELECT TOP 5 ${ARAC_KOLONLARI} FROM nginx_loadtest_araclar
      WHERE durum IN ('QUEUED', 'RUNNING', 'FINALIZING') AND awx_job_id IS NOT NULL
      ORDER BY CASE WHEN ${yasIfadesi} > ${esik} THEN 1 ELSE 0 END, CASE WHEN ${yasIfadesi} > ${esik} THEN id ELSE -id END`,
  );
  for (const r of rows || []) {
    try {
      const o = await araciSonuclandir(r);
      if (o.terminal && !o.atlandi) kapanan += 1;
    } catch (e) {
      console.warn(`[NginxYukTesti araclar] arac ${r.id} durumu okunamadi:`, maskele(e && e.message));
    }
  }
  return { bayat, kapanan };
}

// ── UCLAR (index.cjs yonlendiricisi cagirir; Admin denetimi isleyicide) ───────────────────

function kullaniciAdi(req) {
  return String(((req && req.session && req.session.user) || {}).username || 'unknown').slice(0, 100);
}

async function dbOku(fn) {
  try {
    return await fn(db());
  } catch (e) {
    throw hata(424, 'db_okunamadi', `Portal veritabanı okunamadı: ${maskele(e && e.message)}`);
  }
}

function kilitleriBirak(anahtarlar, lockId) {
  return require('./kilit.cjs').releaseLocks(db(), anahtarlar, lockId)
    .catch((e) => console.warn('[NginxYukTesti araclar] kilit birakilamadi (TTL ile dusecek):', maskele(e && e.message)));
}

async function aracBasarisiz(aracId, metin, jobId = null, awxServerId = null) {
  try {
    await db().query(
      `UPDATE nginx_loadtest_araclar
          SET durum = 'FAILED', hata = $2, awx_server_id = $3, awx_job_id = $4, finished_at = GETUTCDATE(), finalized_at = GETUTCDATE()
        WHERE id = $1 AND durum = 'QUEUED'`,
      [aracId, String(metin).slice(0, 1000), awxServerId, jobId],
    );
  } catch (e) {
    console.warn(`[NginxYukTesti araclar] arac ${aracId} FAILED yazilamadi:`, maskele(e && e.message));
  }
}

/**
 * GET /araclar: { ok, etkin, calisan, gecmis, ayar, kapi }. Vekil adresi yalniz Admin'e. `ayar` sabit
 * arsiv ozetlerini (herkese acik degerler) ve eksiklerini, `kapi` etkin set yoksa nedenini (kod, mesaj) tasir.
 */
async function araclarYaniti(req, { isAdmin }) {
  const sabit = sabitOzetler();
  const { durum, calisan, gecmis } = await dbOku(async (d) => {
    const du = await aracDurumu(d, sabit);
    const c = (await d.query(`SELECT TOP 1 ${ARAC_KOLONLARI} FROM nginx_loadtest_araclar WHERE durum IN ('QUEUED', 'RUNNING', 'FINALIZING') ORDER BY id DESC`)).rows;
    const g = (await d.query(`SELECT TOP 10 ${ARAC_KOLONLARI} FROM nginx_loadtest_araclar ORDER BY id DESC`)).rows;
    return { durum: du, calisan: (c && c[0]) || null, gecmis: g || [] };
  });
  const px = aracProxy();
  const admin = !!(isAdmin && isAdmin(req));
  const api = (r) => aracApi(r, sabit);
  return {
    ok: true,
    etkin: durum.etkin ? api(durum.etkin) : null,
    calisan: calisan ? api(calisan) : null,
    gecmis: gecmis.slice(0, 10).map(api),
    ayar: {
      derlemeHostlari: derlemeHostlari(),
      varsayilanDerlemeHost: varsayilanDerlemeHost(),
      k6Surum: k6Surum(),
      wrkSurum: WRK_SURUM,
      proxyTanimli: !px.hata && !!px.proxy,
      proxy: admin && !px.hata ? px.proxy || null : null,
      proxyHatasi: px.hata,
      k6ArsivSha256: sabit.k6Arsiv || null,
      wrkKaynakSha256: sabit.wrkKaynak || null,
      ozetEksikleri: [...sabit.eksikler],
      isSuresiSn: ARAC_IS_SURESI_SN + YOK_PAYI_SN,
    },
    kapi: { kod: durum.kod, mesaj: durum.mesaj },
  };
}

/**
 * POST /araclar (cagiran adminSart'i ONCE cagirir). Sira sozlesme 2.2 + D1: host -> izin listesi ->
 * vekil -> SABIT OZETLER (ikisi de yoksa 409 arac_ozet_sabit_yok) -> sablon -> kilit (A|araclar +
 * L|<HOST>) -> satir -> son kapi -> AWX -> kilidi ise bagla -> RUNNING. Donus: { aracId, jobId, awxServerId }.
 */
async function araclariHazirla(req, govde) {
  const baslat = require('./baslat.cjs');
  const kilit = require('./kilit.cjs');
  const g = govde && typeof govde === 'object' ? govde : {};
  let host = varsayilanDerlemeHost();
  if (g.derlemeHost !== undefined && g.derlemeHost !== null && g.derlemeHost !== '') {
    host = dg.hostNormalle(g.derlemeHost);
    if (!host) throw hata(400, 'gecersiz_istek', 'Geçersiz derleme makinesi adı.');
  }
  if (!derlemeHostlari().includes(host)) {
    throw hata(409, 'derleme_host_izinsiz', `${host} derleme makinesi izin listesinde değil (NGINX_LOADTEST_DERLEME_HOSTLARI).`);
  }
  const px = aracProxy();
  if (px.hata) throw hata(409, 'arac_proxy_gecersiz', 'NGINX_LOADTEST_ARAC_PROXY geçersiz (yalnız http://<ad>:<port>, kimlik bilgisi yok); araçlar hazırlanamaz.');
  const sabit = sabitOzetler();
  if (sabit.eksikler.length) {
    throw hata(409, 'arac_ozet_sabit_yok', `Araçlar hazırlanamaz: ${ozetSabitYokMesaji(sabit.eksikler)}`);
  }
  const sablon = await baslat.sablonuCoz();
  const k6v = k6Surum();
  const kim = kullaniciAdi(req);
  const anahtarlar = ['A|araclar', `L|${host}`];
  const lockId = crypto.randomUUID();
  const runner = require('../ansible/runner.cjs');
  let alinan;
  try {
    alinan = await kilit.acquireLocks(db(), anahtarlar, {
      lockId,
      holder: kim,
      desc: `araç hazırlama ${host}`,
      ttlMin: kilit.kilitSuresiDk(),
      isJobTerminal: async (sid, jid) => {
        const s = await runner.getJobStatusOnServer(sid, jid);
        return { terminal: TERMINAL.has(s.status), finished: s.finished || null, status: s.status };
      },
    });
  } catch (e) {
    console.warn('[NginxYukTesti araclar] kilit alinamadi (DB) - is baslatilmadi:', maskele(e && e.message));
    await kilitleriBirak(anahtarlar, lockId);
    throw hata(424, 'db_okunamadi', 'İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar deneyin.');
  }
  if (!alinan.ok) throw hata(409, 'kilit_dolu', kilit.doluKilitMesaji(alinan.busyKey, alinan.busy), { kilit: alinan.busyKey });

  const kok = dg.ciktiKok();
  let aracId;
  let swDizin;
  try {
    const ins = await db().query(
      `INSERT INTO nginx_loadtest_araclar (durum, derleme_host, k6_surum, wrk_surum, istenen_k6_arsiv_sha256, istenen_wrk_kaynak_sha256, kilit_id, created_by)
       VALUES ('QUEUED', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [host, k6v, WRK_SURUM, sabit.k6Arsiv, sabit.wrkKaynak, lockId, kim],
    );
    aracId = Number(ins.rows && ins.rows[0] && ins.rows[0].id);
    if (!(aracId > 0)) throw new Error('araç seti numarası dönmedi');
    swDizin = `${kok}/araclar/${aracId}`;
    await db().query(`UPDATE nginx_loadtest_araclar SET sw_dizin = $2 WHERE id = $1`, [aracId, swDizin]);
  } catch (e) {
    await kilitleriBirak(anahtarlar, lockId);
    if (aracId > 0) await aracBasarisiz(aracId, `kayıt tamamlanamadı: ${maskele(e && e.message)}`);
    throw hata(424, 'db_okunamadi', `Araç kaydı yazılamadı; iş başlatılmadı: ${maskele(e && e.message)}`);
  }
  const simdiSn = Math.floor(Date.now() / 1000);
  const ev = aracEkstraDegiskenler({
    aracId, derlemeHost: host, k6Surum: k6v, wrkSurum: WRK_SURUM, k6ArsivSha256: sabit.k6Arsiv, wrkKaynakSha256: sabit.wrkKaynak, proxy: px.proxy, kok, simdiSn,
  });
  const ihlal = aracEkstraDegiskenleriDenetle(ev, { simdiSn });
  if (ihlal.length) {
    await kilitleriBirak(anahtarlar, lockId);
    await aracBasarisiz(aracId, `son kapı: ${ihlal.join(', ')}`);
    throw hata(409, 'sinir_asildi', `Gönderilecek değişkenler son denetimi geçemedi: ${ihlal.join(', ')}.`, { aracId });
  }
  let is;
  try {
    is = await baslat.isBaslat(req, {
      sablon,
      extraVars: ev,
      sablonAdi: `Nginx Yük Testi: araç hazırlama A${aracId} ${host}`,
      denetim: {
        eylem: 'nginx_loadtest_araclar_hazirla',
        targetHost: host,
        targetIp: null,
        ayrinti: { aracId, islem: 'araclar', derlemeHost: host, k6Surum: k6v, wrkSurum: WRK_SURUM, k6ArsivSha256: sabit.k6Arsiv, wrkKaynakSha256: sabit.wrkKaynak },
      },
    });
  } catch (e) {
    if (e && e.jobId != null) {
      await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: e.awxServerId, awxJobId: e.jobId, bagTuru: 'araclar' }).catch(() => {});
    } else if (!(e && e.belirsiz)) {
      await kilitleriBirak(anahtarlar, lockId);
    }
    await aracBasarisiz(aracId, maskele(e && e.message), e && e.jobId != null ? e.jobId : null, e && e.jobId != null ? e.awxServerId : null);
    throw Object.assign(e, { aracId });
  }
  try {
    await kilit.bindLocks(db(), anahtarlar, lockId, { awxServerId: is.awxServerId, awxJobId: is.jobId, bagTuru: 'araclar' });
  } catch (e) {
    console.warn('[NginxYukTesti araclar] kilit isle baglanamadi (TTL ile dusecek):', maskele(e && e.message));
  }
  const yaz = async () => db().query(
    `UPDATE nginx_loadtest_araclar
        SET awx_server_id = $2, awx_job_id = $3, started_at = GETUTCDATE(), durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END
      WHERE id = $1 AND awx_job_id IS NULL`,
    [aracId, is.awxServerId, is.jobId],
  );
  try {
    await yaz();
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await yaz();
    } catch (e2) {
      console.warn('[NginxYukTesti araclar] arac satiri yazilamadi (2 deneme):', maskele((e2 && e2.message) || (e1 && e1.message)));
    }
  }
  return { aracId, jobId: is.jobId, awxServerId: is.awxServerId };
}

/**
 * POST /araclar/:id/geri-cek (D2; cagiran adminSart'i ONCE cagirir). Yalniz geri cekilmemis DONE set.
 * Satir silinmez; geri_ceken / geri_cekme_at yazilir, denetim kaydi dusulur. Etkin set kendiliginden
 * kurala uyan bir onceki DONE sete duser, yoksa set yok (on kontrol / kosu acik metinle reddedilir).
 * Suren on kontrol / kosu durdurulmaz; bekleyen on kontrol kosuda on_kontrol_eski ile duser.
 * Donus: { arac, kapi: { hazir, aracId, kod, mesaj } }.
 */
async function aracGeriCek(req, id) {
  const r = await dbOku((d) => aracSetiOku(d, id));
  if (!r) throw hata(409, 'arac_yok', 'Araç seti bulunamadı.');
  if (r.durum !== 'DONE') throw hata(409, 'arac_geri_cekilemez', 'Yalnız başarıyla hazırlanmış (DONE) bir araç seti geri çekilebilir.');
  if (r.geri_cekme_at != null) throw hata(409, 'zaten_geri_cekildi', 'Bu araç seti zaten geri çekildi.');
  const sabit = sabitOzetler();
  const onceki = await dbOku((d) => etkinAracSeti(d, sabit));
  const kim = kullaniciAdi(req);
  const u = await dbOku((d) => d.query(
    `UPDATE nginx_loadtest_araclar SET geri_ceken = $2, geri_cekme_at = GETUTCDATE()
      WHERE id = $1 AND durum = 'DONE' AND geri_cekme_at IS NULL`,
    [id, kim],
  ));
  if (!u.rowCount) throw hata(409, 'zaten_geri_cekildi', 'Bu araç seti zaten geri çekildi.');
  let kapi;
  try {
    const du = await aracDurumu(db(), sabit);
    kapi = { hazir: du.hazir, aracId: du.aracId, kod: du.kod, mesaj: du.mesaj };
  } catch {
    kapi = { hazir: false, aracId: null, kod: 'db_okunamadi', mesaj: MESAJ.okunamadiEkran };
  }
  try {
    require('../audit/index.cjs').auditPortal(req, 'nginx_loadtest_araclar_geri_cek', {
      targetHost: r.derleme_host || null,
      detail: require('./baslat.cjs').denetimAyrintisi({
        aracId: id, etkindi: !!onceki && Number(onceki.id) === id, yeniEtkinAracId: kapi.aracId, kapiKodu: kapi.kod,
        k6Sha256: sha(r.k6_sha256), wrkSha256: sha(r.wrk_sha256),
      }),
    });
  } catch {
    /* best-effort */
  }
  const guncel = await dbOku((d) => aracSetiOku(d, id));
  return { arac: aracApi(guncel || { ...r, geri_ceken: kim, geri_cekme_at: new Date() }, sabit), kapi };
}

module.exports = {
  VARSAYILAN_DERLEME_HOST,
  VARSAYILAN_PROXY,
  VARSAYILAN_K6_SURUM,
  WRK_SURUM,
  K6_SURUM_RE,
  PROXY_RE,
  PROXY_HATASI,
  ARAC_EKSTRA_ANAHTARLAR,
  ARAC_KOLONLARI,
  AKTIF_ARAC,
  MESAJ,
  NEDEN,
  ESKI_PLAYBOOK_NOTU,
  OZET_FARKLI_NOTU,
  OZET_ENVLERI,
  OKUNAMAZ_SURE_SN,
  ozetSabitYokMesaji,
  derlemeHostlari,
  varsayilanDerlemeHost,
  aracProxy,
  k6Surum,
  sabitOzetEnv,
  sabitOzetDurumu,
  sabitOzetler,
  ozetlerGuncelMi,
  aracEkstraDegiskenler,
  aracEkstraDegiskenleriDenetle,
  aracApi,
  etkinAracSeti,
  aracDurumu,
  aracDurumuEkran,
  aracKapisi,
  motorSha,
  aracDegiskeni,
  aracSetiOku,
  aracGecerli,
  aracStatsNormalle,
  aracKarari,
  araciSonuclandir,
  aracBayatKuyruk,
  araclariSonuclandir,
  araclarYaniti,
  araclariHazirla,
  aracGeriCek,
};
