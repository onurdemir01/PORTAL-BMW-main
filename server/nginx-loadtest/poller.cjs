// server/nginx-loadtest/poller.cjs - Yuk Testi kosularini SUNUCU tarafinda sonuclandirir.
//
// Kimse ekrani acik tutmasa da (45 dk'lik kosu, kapanan sekme) is biter, sonuc yazilir, kilit
// birakilir. Desen retirement/poller.cjs (setInterval + unref + _ticking) ve opsx WAS
// uzlastiricisi (kilit supurmesi).
//
// TERMINAL IS (AWX durum; event_processing_finished false ise is bittikten 10 dk sonrasina kadar
// beklenir, sonra "cikti eksik olabilir" nedeniyle sonuclandirilir):
//   1. Satir FINALIZING'e CAS ile alinir (iki tur ayni kosuyu iki kez yazmaz) ve deneme sayaci
//      (sonuclandirma_denemesi) AYNI ifadede artar.
//   2. Ise bagli kilitler kilit.bagliIsKarari ile birakilir ya da TUTULUR: AWX iptali / hatasi
//      uzaktaki async kos.sh/k6'yi ve ayrik kaydediciyi DURDURMAZ (is bitti != yuk bitti). Tutulan
//      kosu kilidi isten cozulur ve en az butce + 180 sn daha tutulur.
//   3. set_stats `nginx_loadtest_result` toleransli okunur (scalex/result.cjs extractStatsKey),
//      maskelenir, BU kosuya ait oldugu (run_id + islem) dogrulanir.
//   4. Maskeli stdout ansible_job_output'a bir kez arsivlenir.
//   5. on_kontrol: set_stats'tan karar. kosu: /sw kosu dizini C'nin kosuDiziniOku'su ile okunur,
//      kosuAnaliz ile degerlendirilir, adim satirlari yazilir, gecerlilik konur. DUR (erken durma,
//      veri /sw'de) playbook isi dusurse de DONE + KISMI'dir.
// OKUNAMADI != BASARISIZ != BASARI: AWX okunamazsa satir oldugu gibi kalir (sonraki tur); is bitti
// ama sonuc okunamadiysa durum OKUNAMADI olur - ASLA DONE degil. Eksik artifact basari sayilmaz.
// TUR 3 (hedef turu + motor): set_stats surum 2 `hedef_turu` / `motor` yankisi YALNIZ metinse satirla
// karsilastirilir (farkliysa sonuc bu kosuya ait degil); null / yok (girdi reddi, eski playbook)
// denetlenmez ki playbook'un "girdi reddedildi ..." metni kaybolmasin. Analiz turu ve motoru satirdan
// alir; serbest kosuda sunucu dosyasi olmamasi okuma hatasi degildir (sonuc.cjs toleransli).
// COKME DONGUSU KALKANI: /sw okumasi hata verirse satir FINALIZING kalir ve sonraki tur yeniden
// dener (en cok 3 deneme); sayac 3'u gecmisse (surec okuma sirasinda olmus olabilir) /sw hic
// okunmaz, satir OKUNAMADI olur. Admin "yeniden oku" ucuyla sayaci sifirlayabilir.
'use strict';

const path = require('node:path');

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const STATS_ANAHTARI = 'nginx_loadtest_result';
const AKTIF = Object.freeze(['QUEUED', 'RUNNING', 'FINALIZING']);
const KOSU_GECERLILIK = new Set(['GECERLI', 'KISMI', 'GECERSIZ']);
const ADIM_GECERLILIK = new Set(['GECERLI', 'DOYMA', 'GECERSIZ', 'HATALI']);
const METRIKLER = Object.freeze([
  'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95', 'connect_p95', 'hata_orani', 'gercek_rps', 'bayt_istek', 'n_istek',
  'n_429', 'n_5xx', 'dropped', 'istek_sunucu', 'rps_sunucu', 'cpu_ms_istek', 'host_cpu_ort', 'kapasite_rps',
  'srt_p50', 'srt_p95', 'srt_p99',
]);
const ADIM_KOLONLARI = Object.freeze(['kosu_id', 'tur', 'senaryo', 'kip', 'ae', 'hiz', 'deneme', 'gecerlilik', 'nedenler', ...METRIKLER, 'sikistirma_turu', 'ham']);
const MAX_ADIM = 100;
// analiz.cjs'in katlanan adim uyarilari (en cok 40 + ozet satiri) genel uyarilarin ARDINDAN gelir;
// 50'lik tavan cok uyarili kosuda onlari sessizce kesiyordu.
const KOSU_UYARI_TAVANI = 100;
const SONUC_MAX_BAYT = 256 * 1024;
const HAM_MAX_BAYT = 32 * 1024;
const BAYAT_KUYRUK_DK = 15;
// Sonuclandirma: okuma denemesi tavani, olay islemesi bekleme suresi, "is yok" (404) icin satir
// yasi payi, tutulan kosu kilidinin ek suresi. Butce okunamazsa en kotu durum (2700 sn).
const OKUMA_DENEME_SINIRI = 3;
const OLAY_BEKLEME_SN = 10 * 60;
const YOK_PAYI_SN = 600;
const KILIT_EK_SN = 180;
const VARSAYILAN_BUTCE_SN = 2700;
const DENEME_NEDENI = 'sonuç 3 denemede okunamadı (Portal süreci okuma sırasında yeniden başlamış olabilir)';
const OLAY_EKSIK_NEDENI = 'AWX olay işlemesi tamamlanmadı; arşivlenen çıktı eksik olabilir';
const SW_YOK_NEDENI = "yük başlamadı ya da sonuçlar /sw'ye kopyalanmadı (playbook sw_dizin bildirmedi)";
// tick ve tetikle AYNI kolonlari okur (sonuclandirma butceyi, satir yasini, deneme sayisini, hedef
// turunu ve motoru ister).
const SONUCLANDIRMA_KOLONLARI = `id, islem, durum, awx_server_id, awx_job_id, parametreler, started_at, created_at, sonuclandirma_denemesi, kilit_id, hedef_turu, motor,
       DATEDIFF(SECOND, COALESCE(started_at, created_at), GETUTCDATE()) AS calisma_yas_sn`;

let _timer = null;
let _ticking = false;
const _suren = new Set();

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const kilit = () => require('./kilit.cjs');
const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(s);
const maskeleDerin = (v) => require('../retirement/is-ciktisi.cjs').maskeleDerin(v);

// C'nin modulleri (sonuc.cjs / analiz.cjs) TEMBEL yuklenir: sunucu acilisi onlara baglanmaz ve
// eksiklik yalniz o kosuyu OKUNAMADI yapar. Once require.cache'e bakilir (testte sahte modul).
function cModulu(ad) {
  const tam = path.join(__dirname, ad);
  const c = require.cache[tam];
  return c && c.exports ? c.exports : require(tam);
}

function pollSaniye(env = process.env) {
  const n = Number(String(env.NGINX_LOADTEST_POLL_SN ?? '').trim());
  if (!String(env.NGINX_LOADTEST_POLL_SN ?? '').trim() || !Number.isInteger(n)) return 30;
  return Math.min(Math.max(n, 10), 600);
}

function jsonKisa(v, max) {
  const s = JSON.stringify(v ?? null);
  return s.length <= max ? s : null;
}

const SAYI = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const TAM = (v) => {
  const n = SAYI(v);
  return n !== null && Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
};
const metinListesi = (v, adet, uzunluk) =>
  (Array.isArray(v) ? v : []).slice(0, adet).map((x) => maskele(String(x ?? '')).slice(0, uzunluk));

/** Kosunun butcesi (parametreler.butceSn, sunucunun hesapladigi); okunamazsa en kotu durum. */
function butceSnOf(kosu) {
  let p = kosu && kosu.parametreler;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = null;
    }
  }
  const b = p && typeof p === 'object' ? Number(p.butceSn) : NaN;
  return Number.isInteger(b) && b > 0 && b <= VARSAYILAN_BUTCE_SN ? b : VARSAYILAN_BUTCE_SN;
}

/** Satirin yasi (sn): COALESCE(started_at, created_at)'ten bu yana; DB saati, yoksa yerel saat. */
function calismaYasiSn(kosu) {
  const db0 = SAYI(kosu && kosu.calisma_yas_sn);
  if (db0 !== null) return db0;
  const t = bitisZamani(kosu && kosu.started_at) || bitisZamani(kosu && kosu.created_at);
  return t ? (Date.now() - t.getTime()) / 1000 : null;
}

/**
 * set_stats -> maskeli nesne ya da null. Yayinlanan sonuc BU kosuya ait degilse (run_id / islem
 * tutmuyor; metin olarak yayinlanmis hedef_turu / motor satirdan farkli) KULLANILMAZ: baska bir
 * isin sonucunu bu kosuya yazmak sessiz yanlistir. Yanki null ya da yoksa denetlenmez.
 */
function statsNormalle(ham, kosu) {
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return { stats: null, uyusmazlik: null };
  if (String(ham.run_id ?? '') !== String(kosu.id)) return { stats: null, uyusmazlik: `run_id ${String(ham.run_id ?? '?').slice(0, 20)}` };
  if (String(ham.islem ?? '') !== String(kosu.islem)) return { stats: null, uyusmazlik: `islem ${String(ham.islem ?? '?').slice(0, 20)}` };
  if (typeof ham.hedef_turu === 'string' && ham.hedef_turu !== (kosu.hedef_turu || 'sunucu')) {
    return { stats: null, uyusmazlik: `hedef_turu ${ham.hedef_turu.slice(0, 20)}` };
  }
  if (typeof ham.motor === 'string' && ham.motor !== (kosu.motor || 'k6')) return { stats: null, uyusmazlik: `motor ${ham.motor.slice(0, 20)}` };
  let s = maskeleDerin(ham);
  s.durum = String(s.durum ?? '').trim().toUpperCase();
  if (JSON.stringify(s).length > SONUC_MAX_BAYT && s.kosu && typeof s.kosu === 'object') {
    s = { ...s, kosu: { ...s.kosu, istemci_ozet: null, dosyalar: null }, kirpildi: true };
  }
  if (JSON.stringify(s).length > SONUC_MAX_BAYT) s = { surum: s.surum, run_id: s.run_id, islem: s.islem, durum: s.durum, hata: s.hata, kirpildi: true };
  return { stats: s, uyusmazlik: null };
}

/** On kontrol isinin sonucu (yuk uretmez; /sw okunmaz). */
function onKontrolKarari(st, stats, uyusmazlik) {
  const ok = stats && stats.on_kontrol && typeof stats.on_kontrol === 'object' ? stats.on_kontrol : null;
  if (st.status === 'canceled') return { durum: 'CANCELED', sonuc: stats, onKontrolOzet: ok };
  if (!stats) {
    const neden = uyusmazlik ? `yayınlanan sonuç bu ön kontrole ait değil (${uyusmazlik})` : 'set_stats sonucu (nginx_loadtest_result) yok';
    return st.status === 'successful'
      ? { durum: 'OKUNAMADI', sonuc: { hata: neden } }
      : { durum: 'FAILED', sonuc: { hata: maskele(st.jobExplanation || '') || neden } };
  }
  if (st.status === 'successful' && stats.durum === 'OK') {
    if (!ok) return { durum: 'OKUNAMADI', sonuc: { ...stats, hata: 'on_kontrol bölümü yok' } };
    return { durum: 'DONE', sonuc: stats, onKontrolOzet: ok };
  }
  return { durum: 'FAILED', sonuc: stats, onKontrolOzet: ok };
}

/** C'nin kosuAnaliz ciktisini sozlesmeye gore suzer; sozlesme disi ciktida HATA atar. */
function analizNormalle(a) {
  if (!a || typeof a !== 'object') throw new Error('analiz sonucu yok');
  if (!KOSU_GECERLILIK.has(a.gecerlilik)) throw new Error(`analiz gecerliligi tanınmadı: ${String(a.gecerlilik).slice(0, 20)}`);
  const adimlar = [];
  const uyarilar = metinListesi(a.uyarilar, KOSU_UYARI_TAVANI, 500);
  for (const x of (Array.isArray(a.adimlar) ? a.adimlar : []).slice(0, MAX_ADIM)) {
    if (!x || typeof x !== 'object' || typeof x.tur !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(x.tur)) {
      uyarilar.push('tanınmayan bir adım satırı atlandı');
      continue;
    }
    const y = {
      tur: x.tur,
      senaryo: x.senaryo === 'K' || x.senaryo === 'B' ? x.senaryo : null,
      kip: typeof x.kip === 'string' ? x.kip.slice(0, 8) : null,
      ae: typeof x.ae === 'string' ? x.ae.slice(0, 10) : null,
      hiz: TAM(x.hiz),
      deneme: TAM(x.deneme),
      gecerlilik: ADIM_GECERLILIK.has(x.gecerlilik) ? x.gecerlilik : 'GECERSIZ',
      nedenler: metinListesi(x.nedenler, 20, 300),
      sikistirma_turu: typeof x.sikistirma_turu === 'string' ? x.sikistirma_turu.slice(0, 16) : null,
      ham: x.ham === undefined || x.ham === null ? null : jsonKisa(maskeleDerin(x.ham), HAM_MAX_BAYT) ?? JSON.stringify({ kirpildi: true }),
    };
    for (const m of METRIKLER) y[m] = SAYI(x[m]);
    adimlar.push(y);
  }
  return {
    gecerlilik: a.gecerlilik,
    nedenler: metinListesi(a.nedenler, 50, 500),
    uyarilar,
    adimlar,
    ozet: a.ozet && typeof a.ozet === 'object' ? JSON.parse(jsonKisa(a.ozet, 64 * 1024) ?? '{"kirpildi":true}') : null,
  };
}

// INT parametre tavani: adaptor tam sayiyi mssql.Int ile gonderir; 2^31 ustu FLOAT kolona metin
// olarak gider (MSSQL ortuk cevirir) - tasma hatasi yerine dogru deger.
const parametre = (v) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) > 2147483647 ? String(v) : v);

/** Adim satirlari: kosu basina en cok MAX_ADIM satir; yeniden sonuclandirmada once o kosununkiler silinir. */
async function adimlariYaz(kosuId, adimlar) {
  await db().query(`DELETE FROM nginx_loadtest_adimlar WHERE kosu_id = $1`, [kosuId]);
  for (let i = 0; i < adimlar.length; i += 10) {
    const parca = adimlar.slice(i, i + 10);
    const params = [];
    const degerler = parca.map((a) => {
      const satir = [kosuId, a.tur, a.senaryo, a.kip, a.ae, a.hiz, a.deneme, a.gecerlilik, JSON.stringify(a.nedenler),
        ...METRIKLER.map((m) => a[m]), a.sikistirma_turu, a.ham];
      const yer = satir.map((v) => {
        params.push(parametre(v));
        return `$${params.length}`;
      });
      return `(${yer.join(', ')})`;
    });
    await db().query(`INSERT INTO nginx_loadtest_adimlar (${ADIM_KOLONLARI.join(', ')}) VALUES ${degerler.join(', ')}`, params);
  }
}

/** Maskeli stdout'u bir kez arsivler (ansible_job_output UNIQUE(awx_server_id, job_id)). */
async function ciktiArsivle(sid, jid) {
  const ex = await db().query(`SELECT 1 AS x FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`, [sid, jid]);
  if (ex.rows && ex.rows.length) return false;
  // Biten iste son metin artimlardan turemez: onbellek birakilir, AWX'ten tam cekilir.
  require('../ansible/job-stdout-cache.cjs').sil(sid, jid);
  const { output } = await runner().getJobOutputOnServer(sid, jid);
  const m = maskele(String(output ?? ''));
  if (!m) return false;
  try {
    await db().query(`INSERT INTO ansible_job_output (awx_server_id, job_id, stdout) VALUES ($1, $2, $3)`, [sid, jid, m]);
  } catch (e) {
    if (!/2627|2601|duplicate|UNIQUE/i.test(String(e && (e.number ?? '')) + String(e && e.message))) throw e;
  }
  return true;
}

/**
 * DUR sozlesmesi: playbook DUR'da (erken durma, veri /sw'de) isi yine DUSURUR (AWX 'failed');
 * karar set_stats'a gore verilir. 'canceled' bu karardan ONCE ayri ele alinir.
 */
function kosuBasarili(awxStatus, statsDurum) {
  return statsDurum !== 'FAIL' && (awxStatus === 'successful' || (awxStatus === 'failed' && statsDurum === 'DUR'));
}

/**
 * Kosu (yuk) isinin sonucu: /sw dizini okunur ve analiz edilir. `deneme`: bu sonuclandirmanin
 * kacinci denemesi (FINALIZING CAS'inin yazdigi sayac). Okuma hatasi ve deneme < 3 ise
 * { yenidenDenenecek: true } doner (satir FINALIZING kalir, son yazim yapilmaz).
 */
async function kosuKarari(kosu, st, stats, uyusmazlik, { deneme = OKUMA_DENEME_SINIRI } = {}) {
  const dg = require('./dogrula.cjs');
  const id = Number(kosu.id);
  const dizin = dg.kosuDizini(dg.ciktiKok(), id);
  if (st.status === 'canceled') {
    return { durum: 'CANCELED', gecerlilik: 'GECERSIZ', nedenler: ['koşu iptal edildi'], sonuc: stats, swDizin: dizin };
  }
  if (!stats) {
    const neden = uyusmazlik ? `yayınlanan sonuç bu koşuya ait değil (${uyusmazlik})` : 'set_stats sonucu (nginx_loadtest_result) yok';
    // Eksik artifact BASARI DEGILDIR: AWX "successful" dese de sonuc kanitlanamaz.
    return st.status === 'successful'
      ? { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI', nedenler: [neden], sonuc: { hata: neden }, swDizin: dizin }
      : { durum: 'FAILED', gecerlilik: 'OKUNAMADI', nedenler: [neden], sonuc: { hata: maskele(st.jobExplanation || '') || neden }, swDizin: dizin };
  }
  const ekNedenler = [];
  const kosuBolumu = stats.kosu && typeof stats.kosu === 'object' ? stats.kosu : null;
  if (kosuBolumu && kosuBolumu.sw_dizin && String(kosuBolumu.sw_dizin).replace(/\/+$/, '') !== dizin) {
    ekNedenler.push(`playbook başka bir dizin bildirdi (${String(kosuBolumu.sw_dizin).slice(0, 200)}); Portal ${dizin} dizinini okudu`);
  }
  if (stats.durum === 'DUR') ekNedenler.push('koşu erken durdu (DUR)');
  // Tur ve motor satirdan (set_stats yankisindan degil); eski satir: DB varsayilani sunucu / k6.
  const hedefTuru = kosu.hedef_turu || 'sunucu';
  const motor = kosu.motor || 'k6';
  const kosRc = kosuBolumu ? SAYI(kosuBolumu.kos_rc) : null;
  if (kosRc !== null && kosRc !== 0) ekNedenler.push(`${motor === 'wrk' ? 'wrk_kos.sh' : 'kos.sh'} rc=${kosRc}`);
  const basarili = kosuBasarili(st.status, stats.durum);
  const hataMetni = `AWX işi başarısız (${st.status}${stats.hata ? `: ${String(stats.hata).slice(0, 300)}` : ''})`;

  // Playbook kosu bolumunu yayinladi ama sw_dizin bildirmedi: /sw'ye HIC veri kopyalanmadi (yuk
  // baslamadi ya da kopya dustu). Dizin okunmaz; "okunamadi" degil, gecersiz bir basarisizliktir.
  if (kosuBolumu && !String(kosuBolumu.sw_dizin ?? '').trim()) {
    return { durum: 'FAILED', gecerlilik: 'GECERSIZ', nedenler: [hataMetni, SW_YOK_NEDENI], sonuc: { ...stats, portal_analiz: { hata: SW_YOK_NEDENI } }, swDizin: dizin };
  }

  let analiz = null;
  let okumaHatasi = null;
  try {
    const veri = await cModulu('sonuc.cjs').kosuDiziniOku(dizin, { adim: `R${id}` });
    analiz = analizNormalle(await cModulu('analiz.cjs').kosuAnaliz(veri, { adim: `R${id}`, hedefTuru, motor }));
  } catch (e) {
    okumaHatasi = `sonuç dizini okunamadı/çözümlenemedi: ${maskele(e && e.message).slice(0, 400)}`;
  }
  // Gecici okuma hatasi (NFS, yarim kopya): satir FINALIZING kalir, sonraki tur yeniden dener.
  if (!analiz && deneme < OKUMA_DENEME_SINIRI) return { yenidenDenenecek: true, okumaHatasi };
  const sonuc = (a) => ({ ...stats, portal_analiz: a ? { ozet: a.ozet, uyarilar: a.uyarilar } : { hata: okumaHatasi } });
  if (basarili) {
    if (!analiz) return { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI', nedenler: [okumaHatasi, ...ekNedenler], sonuc: sonuc(null), swDizin: dizin };
    const gec = analiz.gecerlilik === 'GECERLI' && ekNedenler.length ? 'KISMI' : analiz.gecerlilik;
    return { durum: 'DONE', gecerlilik: gec, nedenler: [...analiz.nedenler, ...ekNedenler], sonuc: sonuc(analiz), adimlar: analiz.adimlar, swDizin: dizin };
  }
  if (!analiz) return { durum: 'FAILED', gecerlilik: 'OKUNAMADI', nedenler: [hataMetni, okumaHatasi, ...ekNedenler], sonuc: sonuc(null), swDizin: dizin };
  return {
    durum: 'FAILED',
    gecerlilik: analiz.gecerlilik === 'GECERLI' ? 'KISMI' : analiz.gecerlilik,
    nedenler: [hataMetni, ...analiz.nedenler, ...ekNedenler],
    sonuc: sonuc(analiz),
    adimlar: analiz.adimlar,
    swDizin: dizin,
  };
}

function bitisZamani(v) {
  if (v == null || v === '') return null;
  const t = new Date(String(v));
  return Number.isFinite(t.getTime()) ? t : null;
}

async function sonYaz(kosu, st, k) {
  if (Array.isArray(k.adimlar)) await adimlariYaz(Number(kosu.id), k.adimlar);
  const sonucJson = k.sonuc == null ? null : jsonKisa(k.sonuc, SONUC_MAX_BAYT) ?? JSON.stringify({ kirpildi: true });
  await db().query(
    `UPDATE nginx_loadtest_kosular
        SET durum = $2, gecerlilik = $3, gecersiz_nedenleri = $4, sonuc = $5, on_kontrol_ozet = $6,
            sw_dizin = COALESCE($7, sw_dizin), finished_at = COALESCE($8, finished_at, GETUTCDATE()), finalized_at = GETUTCDATE()
      WHERE id = $1 AND durum = 'FINALIZING'`,
    [Number(kosu.id), k.durum, k.gecerlilik ?? null, k.nedenler ? JSON.stringify(k.nedenler.filter(Boolean)) : null, sonucJson,
      k.onKontrolOzet ? jsonKisa(k.onKontrolOzet, 64 * 1024) : null, k.swDizin ?? null, bitisZamani(st && st.finished)],
  );
}

/**
 * Ise bagli kilitler: kural (bag turu = satirin islemi) 'birak' derse birakilir; 'tut' derse
 * isten cozulur ve kosu kilidi en az butce + 180 sn daha tutulur (uzak k6 / kaydedici).
 */
async function isinKilitleri(kosu, st, sid, jid) {
  const karar = kilit().bagliIsKarari(kosu.islem, st.status);
  if (karar === 'birak') return kilit().releaseLocksForJob(db(), sid, jid, st.finished || null);
  return kilit().isinKilitleriniCoz(db(), sid, jid, kosu.islem === 'kosu' ? butceSnOf(kosu) + KILIT_EK_SN : null);
}

/**
 * Tek kosuyu sonuclandirir. AWX okunamazsa HATA atar (satir degismez, sonraki tur). Donus:
 * { terminal:false } | { terminal:true, durum } | { suruyor:true } | { terminal:false, yenidenDenenecek:true }.
 */
async function kosuyuSonuclandir(kosu) {
  const id = Number(kosu.id);
  const sid = Number(kosu.awx_server_id);
  const jid = Number(kosu.awx_job_id);
  if (!Number.isInteger(sid) || sid < 0 || !Number.isInteger(jid) || jid <= 0) return { terminal: false, isYok: true };
  if (_suren.has(id)) return { terminal: false, suruyor: true };
  _suren.add(id);
  try {
    const butce = butceSnOf(kosu);
    const yas = calismaYasiSn(kosu);
    let st;
    try {
      st = await runner().getJobStatusOnServer(sid, jid);
    } catch (e) {
      // Is AWX'te YOK (404, sunucu ayakta) ancak satir butce + 600 sn'den eskiyse "calismiyor"
      // sayilir; daha gencse tek 404 (gecit, yeni URL) kanit DEGIL: hata yukari, satir ve kilit
      // degismez (kilitSupur / acquireLocks ile ayni fail-closed). Sunucu yok (devre disi) ise
      // durum BILINMEZ: satir oldugu gibi kalir, kilit TTL ile duser.
      if (e && Number(e.status) === 404 && e.code !== 'awx_server_missing' && yas !== null && yas > butce + YOK_PAYI_SN) {
        st = { status: 'error', missing: true, artifacts: {}, jobExplanation: `AWX iş #${jid} artık yok`, finished: null };
      } else {
        throw e;
      }
    }
    // Olay islemesi bitmemis terminal is: stdout eksik olabilir. Is 10 dk'dan yeni bittiyse beklenir;
    // daha eskiyse (ya da bitis zamani yoksa satir butce + 600 sn'yi gectiyse) yine sonuclandirilir.
    let olayEksik = false;
    if (TERMINAL.has(st.status) && st.eventProcessingFinished === false) {
      const bitis = bitisZamani(st.finished);
      const eski = bitis ? (Date.now() - bitis.getTime()) / 1000 >= OLAY_BEKLEME_SN : yas !== null && yas > butce + YOK_PAYI_SN;
      if (eski) olayEksik = true;
    }
    if (!TERMINAL.has(st.status) || (st.eventProcessingFinished === false && !olayEksik)) {
      if (kosu.durum === 'QUEUED') {
        await db().query(`UPDATE nginx_loadtest_kosular SET durum = 'RUNNING', started_at = COALESCE(started_at, GETUTCDATE()) WHERE id = $1 AND durum = 'QUEUED'`, [id]);
      }
      return { terminal: false, awxStatus: st.status };
    }
    const al = await db().query(
      `UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING', sonuclandirma_denemesi = sonuclandirma_denemesi + 1
        WHERE id = $1 AND durum IN ('QUEUED', 'RUNNING', 'FINALIZING') RETURNING sonuclandirma_denemesi`,
      [id],
    );
    if (!al.rowCount) return { terminal: true, atlandi: true };
    // Sayac okunamazsa (adaptor OUTPUT dondurmediyse) tek deneme + son karar: eski davranis.
    const deneme = TAM(al.rows && al.rows[0] && al.rows[0].sonuclandirma_denemesi) ?? OKUMA_DENEME_SINIRI;
    try {
      await isinKilitleri(kosu, st, sid, jid);
    } catch (e) {
      console.warn(`[NginxYukTesti poller] kosu ${id} kilidi birakilamadi/cozulemedi (supurme/TTL halleder):`, maskele(e && e.message));
    }
    const { stats, uyusmazlik } = statsNormalle(require('../scalex/result.cjs').extractStatsKey(st.artifacts, STATS_ANAHTARI), kosu);
    if (!st.missing) {
      try {
        await ciktiArsivle(sid, jid);
      } catch (e) {
        console.warn(`[NginxYukTesti poller] is #${jid} ciktisi arsivlenemedi:`, maskele(e && e.message));
      }
    }
    let k;
    if (st.missing) {
      k = { durum: 'OKUNAMADI', gecerlilik: kosu.islem === 'kosu' ? 'OKUNAMADI' : null, nedenler: [st.jobExplanation], sonuc: { hata: st.jobExplanation } };
    } else if (deneme > OKUMA_DENEME_SINIRI) {
      // Onceki denemeler son yazima ulasmadi (surec okuma sirasinda olmus olabilir): /sw OKUNMAZ.
      console.warn(`[NginxYukTesti poller] kosu ${id}: ${deneme}. sonuclandirma denemesi; /sw okunmadan OKUNAMADI yaziliyor`);
      k = {
        durum: 'OKUNAMADI', gecerlilik: kosu.islem === 'kosu' ? 'OKUNAMADI' : null, nedenler: [DENEME_NEDENI],
        sonuc: stats ? { ...stats, portal_analiz: { hata: DENEME_NEDENI } } : { hata: DENEME_NEDENI },
      };
    } else if (kosu.islem === 'on_kontrol') {
      k = onKontrolKarari(st, stats, uyusmazlik);
    } else {
      k = await kosuKarari(kosu, st, stats, uyusmazlik, { deneme });
      if (k.yenidenDenenecek) {
        console.warn(`[NginxYukTesti poller] kosu ${id} sonucu okunamadi (deneme ${deneme}/${OKUMA_DENEME_SINIRI}); sonraki tur yeniden denenecek:`, k.okumaHatasi);
        return { terminal: false, yenidenDenenecek: true };
      }
    }
    if (olayEksik) k = { ...k, nedenler: [...(k.nedenler || []), OLAY_EKSIK_NEDENI] };
    await sonYaz(kosu, st, k);
    return { terminal: true, durum: k.durum };
  } finally {
    _suren.delete(id);
  }
}

/** Baslatmasi yarim kalmis satirlar (INSERT oldu, is numarasi hic yazilmadi). Kilitleri TTL birakir. */
async function bayatKuyruk() {
  const r = await db().query(
    `UPDATE nginx_loadtest_kosular
        SET durum = 'FAILED', sonuc = $1, finalized_at = GETUTCDATE(), finished_at = COALESCE(finished_at, GETUTCDATE())
      WHERE durum = 'QUEUED' AND awx_job_id IS NULL AND created_at < DATEADD(MINUTE, -${BAYAT_KUYRUK_DK}, GETUTCDATE())`,
    [JSON.stringify({ hata: 'Başlatma tamamlanmadı (AWX iş numarası kaydedilemedi).' })],
  );
  return r.rowCount || 0;
}

/**
 * Bir ise bagli dolu kilitler: is terminalse kural (kilidin bag turu) 'birak' derse birakilir,
 * 'tut' derse isten cozulur (TTL birakir). Satiri yazilamamis kosular ve durdur isleri dahil.
 */
async function kilitSupur() {
  let birakilan = 0;
  for (const { serverId, jobId, bagTuru } of await kilit().bekleyenKilitIsleri(db(), 20)) {
    let st;
    try {
      st = await runner().getJobStatusOnServer(serverId, jobId);
    } catch {
      continue; // okunamadi: kilit DOLU kalir (fail-closed), TTL birakir
    }
    if (!TERMINAL.has(st.status)) continue;
    if (kilit().bagliIsKarari(bagTuru, st.status) === 'birak') birakilan += await kilit().releaseLocksForJob(db(), serverId, jobId, st.finished || null);
    else await kilit().isinKilitleriniCoz(db(), serverId, jobId);
  }
  return birakilan;
}

async function tick() {
  let kapanan = 0;
  const b = await bayatKuyruk().catch((e) => {
    console.warn('[NginxYukTesti poller] bayat kuyruk temizlenemedi:', maskele(e && e.message));
    return 0;
  });
  const { rows } = await db().query(
    `SELECT TOP 20 ${SONUCLANDIRMA_KOLONLARI} FROM nginx_loadtest_kosular
      WHERE durum IN ('QUEUED', 'RUNNING', 'FINALIZING') AND awx_job_id IS NOT NULL ORDER BY id ASC`,
  );
  for (const k of rows || []) {
    try {
      const o = await kosuyuSonuclandir(k);
      if (o.terminal && !o.atlandi) kapanan += 1;
    } catch (e) {
      // OKUNAMADI != BASARISIZ: satir oldugu gibi kalir, sonraki tur yeniden bakar.
      console.warn(`[NginxYukTesti poller] kosu ${k.id} durumu okunamadi:`, maskele(e && e.message));
    }
  }
  const s = await kilitSupur().catch((e) => {
    console.warn('[NginxYukTesti poller] kilit supurmesi:', maskele(e && e.message));
    return 0;
  });
  if (b || kapanan || s) console.log(`[NginxYukTesti poller] bayat=${b} sonuclanan=${kapanan} birakilan-kilit=${s}`);
  return { bayat: b, kapanan, kilit: s };
}

function startPoller() {
  if (_timer) return;
  const sn = pollSaniye();
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[NginxYukTesti poller] tick hatasi:', maskele(e && e.message)))
      .finally(() => {
        _ticking = false;
      });
  }, sn * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[NginxYukTesti poller] basladi (${sn} sn)`);
}

/** Durum ucu biten isi gorunce sonuclandirmayi BEKLEMEDEN tetikler (ayni kosu iki kez islenmez). */
function tetikle(kosuId) {
  const id = Number(kosuId);
  if (!Number.isInteger(id) || _suren.has(id)) return;
  (async () => {
    const { rows } = await db().query(`SELECT ${SONUCLANDIRMA_KOLONLARI} FROM nginx_loadtest_kosular WHERE id = $1`, [id]);
    const k = rows && rows[0];
    if (k && AKTIF.includes(k.durum)) await kosuyuSonuclandir(k);
  })().catch((e) => console.warn(`[NginxYukTesti poller] kosu ${id} tetiklenemedi:`, maskele(e && e.message)));
}

module.exports = {
  STATS_ANAHTARI,
  TERMINAL,
  AKTIF,
  METRIKLER,
  KOSU_UYARI_TAVANI,
  OKUMA_DENEME_SINIRI,
  DENEME_NEDENI,
  OLAY_EKSIK_NEDENI,
  SW_YOK_NEDENI,
  SONUCLANDIRMA_KOLONLARI,
  cModulu,
  pollSaniye,
  butceSnOf,
  calismaYasiSn,
  statsNormalle,
  onKontrolKarari,
  analizNormalle,
  kosuBasarili,
  kosuKarari,
  kosuyuSonuclandir,
  bayatKuyruk,
  kilitSupur,
  tick,
  startPoller,
  tetikle,
  _durdurForTest: () => {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _ticking = false;
    _suren.clear();
  },
};
