// server/nginx-loadtest/kuyruk.cjs - Yuk Testi GECE KUYRUGU (2026-11-03).
//
// Kullanici: "gece boyunca ardi ardina test kosulari yapmak istiyorum, ilk test bittikten sonra sunucu bir
// rahatlasin ... kac test girdiysem hepsi arka arkaya sabaha kadar bitsin." Kuyruk SUNUCU tarafinda yurur
// (poller kalibi: setInterval + unref + _ticking); ekran acik kalmak zorunda degil.
//
// AKIS (oge basina): BEKLIYOR -> (yetki, en gec bitis, plan kapilari YENIDEN) -> on kontrol (mevcut akis) ->
// on kontrol DONE: engel -> ATLANDI; uyari TURU kuyrukta onaylanmamis -> ATLANDI ("yeni uyari"); degilse kosu
// (mevcut kosu kapisi, onay metni kuyruk olusturulurken yazilan hedef) -> kosu terminal: DONE -> BITTI, digeri
// (FAILED / OKUNAMADI / CANCELED = Durdur) -> HATALI. Yuk uretmis (kosu_id'li) ogeden sonra kuyruk DINLENME'ye
// gecer; bekleme kosunun kilitleri BIRAKILDIKTAN SONRA baslar (bekleme_dk), bitince siradaki oge.
//
// YARIS GUVENLIGI (birden cok Portal sureci, yeniden baslatma):
//   * Kuyruk kirasi (kira_id / kira_bitis): bir kuyrugu ayni anda tek surec isler; kira suresi dolunca
//     (surec oldu) baska surec devralir. Kira kosullu UPDATE ile alinir.
//   * Oge sahiplenme kosullu UPDATE'tir (durum = 'BEKLIYOR' + kuyruk CALISIYOR + kira BIZDE + kuyrukta
//     CALISIYOR oge YOK) ve DB filtreli tekil indeksi UX_nlko_calisan (kuyruk_id WHERE durum = 'CALISIYOR')
//     ikinci calisan ogeyi reddeder.
//   * AWX'e gitmeden ONCE kosu numarasi oge satirina yazilir (kosuyuBaslat'in kosuKaydedildi kancasi:
//     INSERT'ten sonra, launch'tan once). Yazim kosulludur (deneme_id + kira + kuyruk CALISIYOR); tutmazsa
//     is BASLATILMAZ. Bu yuzden "CALISIYOR ama numarasi yok" oge HICBIR ZAMAN AWX'e gitmemistir: yeniden
//     baslatmada guvenle geri alinir. Numarasi olan oge izlenir (cift baslatma yok).
//   * Kuyruk IPTAL: sonraki ogeler baslamaz; suren kosu DURDURULMAZ (mevcut Durdur ile ayrica). IPTAL / HATALI
//     kuyrugun CALISIYOR ogesi izlenmeye devam eder (aktifKuyruklar) ve kapanir; BEKLIYOR'a geri alma yalniz kuyruk
//     CALISIYOR iken tutar (iptal ile geri alma yarisinda oge yetim kalmaz).
//   * Kira KIRA_SN (600 sn) her turda yenilenir; surec olurse (Portal yeniden basladi) yeni surec kira dolana kadar
//     (en cok ~10 dk) bekler, sonra devralir.
//
// GECICI HATA: AWX / DB kisa kesintisi (424; kosu satiri olsa da is KESIN baslamadiysa) oge HATALI olmaz: numara
// silinir, oge GERI_CEKILME_SN kadar bekler (1, 2, 4, 8, 15 dk) ve ayni oge yeniden denenir; GECICI_DENEME_SINIRI
// (6) denemede HATALI. Is AWX'te baslamis olabilirse (belirsiz / is numarali) oge HATALI ve dinlenme.
//
// SURE: tahmini sure = on kontrol payi + kosunun butcesi (parametreler.butceSn, ust sinir) + static kosuda dosya
// uretimi payi (HAZIRLIK_PAY_SN; oge butce_sn'si bu payi icerir). En gec bitis
// verilmisse ve simdi + tahmin onu asiyorsa oge ATLANDI "sure yetmedi".
// SAAT: karsilastirmalar DB saatiyle (GETUTCDATE / DATEDIFF), surec saatiyle degil.
//
// DURAKLAT (2026-11-04): kullanici gece kosusu sirasinda sunucuda elle is yapip devam etmek ister. Yeni durum DEGERI
// YOK: duraklat_at durumdan bagimsiz bayraktir (BEKLIYOR / CALISIYOR / DINLENME uzerine biner; IPTAL calisir).
//   * Baslama kapilari: KUYRUK_BIZDE ve kuyrukBasla duraklat_at IS NULL ister. Bayrak sahiplenme ile kanca arasina
//     duserse yazim tutmaz, is BASLATILMAZ ve mevcut numarasiz kurtarma yolu ogeyi geri alir (cift baslatma yok).
//   * Suren kosu bitince normal kapanir ve DINLENME sayilir; bekleme bitince kuyruk siradaki ogeyi baslatmadan durur.
//     Siradaki oge yoksa kuyruk normal BITTI olur.
//   * On kontrol sonucu kullanilmaz (15 dk gecerli; duraklatma saatler surebilir): kilidi birakilinca oge BEKLIYOR'a
//     doner, devamda on kontrol yeniden calisir. Kilit beklenir: sunucu ayarli on kontrolde kilit geri alma bitene
//     kadar tutulur, oge CALISIYOR kaldikca ekran "sunucuya dokunmayin" der.
//   * Durdurulan kosu (CANCELED; AWX iptali tutmadiysa FAILED + iptal_eden) oge HATALI OLMAZ: once kuyruk DINLENME'ye gecer,
//     sonra oge bastan kosulmak uzere BEKLIYOR'a doner (arada kesilirse sonraki tur ikinci yazimi yapar; dinlenme atlanmaz).
//     DINLENME kilit birakilana kadar bekler (Durdur'un geri almasi bitmeden kuyruk "duraklatildi" demez).
//   * Ekranin "sunucuya dokunabilirsiniz" karari yalniz kuyruga bakmaz: index.cjs duraklatmaBilgisi hedef kilidini ve hedefin son
//     sunucu ayarli isinin geri alma sonucunu da verir (kilit geri alma basarisiz olsa da birakilir).
'use strict';

const crypto = require('node:crypto');

const KUYRUK_DURUMLARI = Object.freeze(['BEKLIYOR', 'CALISIYOR', 'DINLENME', 'BITTI', 'IPTAL', 'HATALI']);
const OGE_DURUMLARI = Object.freeze(['BEKLIYOR', 'CALISIYOR', 'BITTI', 'ATLANDI', 'HATALI', 'IPTAL']);
const BEKLEME_VARSAYILAN_DK = 5;
const BEKLEME_MIN_DK = 1;
const BEKLEME_MAX_DK = 30;
const MAX_OGE = 30;
const ETIKET_MAX = 100;
// On kontrol isi (yuk yok) icin sure payi: tahmini sure = bu + butceSn.
const ON_KONTROL_PAY_SN = 300;
// Static kosuda kosu oncesi .gz / .br uretimi suresi (tahmine eklenir; kosunun butcesi yuk_butce_sn DEGISMEZ).
const HAZIRLIK_PAY_SN = 180;
// On kontrol en cok 15 dk gecerli (index.cjs ON_KONTROL_MAX_YAS_SN); kosu kilit beklerken eskirse yeniden.
const ON_KONTROL_TAZE_SN = 15 * 60 - 60;
// Gecici hata (AWX / DB kisa kesinti): deneme sayaci; denemeler arasi geri cekilme (sn) - 6 deneme ~30 dk yayilir.
const GECICI_DENEME_SINIRI = 6;
const GERI_CEKILME_SN = Object.freeze([60, 120, 240, 480, 900]);
// Kuyruk duzeyi ardisik tur hatasi (15 sn tur -> ~30 dk): kisa Portal DB kesintisi gece kuyrugunu bitirmesin.
const KUYRUK_HATA_SINIRI = 120;
const KIRA_SN = 600;
const ADIM_SINIRI = 6;
const BASLANGIC_MAX_SAAT = 24;
const BITIS_MAX_SAAT = 36;
const AKTIF_KOSU = new Set(['QUEUED', 'RUNNING', 'FINALIZING']);
const AKTIF_KUYRUK = new Set(['BEKLIYOR', 'CALISIYOR', 'DINLENME']);
const { hasControlChars } = require('../util/control-chars.cjs');
// dogrula.cjs KONTROL_KARAKTERI ile ayni sinif (etiket / ad).
const KONTROL_KARAKTERI = { test: (v) => hasControlChars(v) };

const SUREC_ID = crypto.randomUUID();
let _timer = null;
let _ticking = false;

const maskele = (s) => require('../retirement/is-ciktisi.cjs').maskele(s);

function hata(status, code, message, ek) {
  return Object.assign(new Error(message), { status, code }, ek || {});
}

// -- UYARI TURU ------------------------------------------------------------------------------
// Uyarilar metindir ve sayi tasir ("3/12 yol 200 donmedi", "/web_log %70 dolu"). Tur = sayilari '#' yapilmis,
// boslugu tekillesmis metin; kod = onun sha256'sinin ilk 10 hanesi. Ayni tur farkli sayiyla gelirse ayni koddur.

function uyariNormal(metin) {
  return String(metin ?? '').replace(/\d+(?:[.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim();
}

function uyariTuru(metin) {
  return `U${crypto.createHash('sha256').update(uyariNormal(metin), 'utf8').digest('hex').slice(0, 10)}`;
}

/** Metin listesi -> [{ kod, ornek }] (kod tekil, ilk ornek kalir). */
function uyariTurleri(liste) {
  const out = [];
  const gorulen = new Set();
  for (const m of Array.isArray(liste) ? liste : []) {
    if (typeof m !== 'string' || !m.trim()) continue;
    const kod = uyariTuru(m);
    if (gorulen.has(kod)) continue;
    gorulen.add(kod);
    out.push({ kod, ornek: m.slice(0, 500) });
  }
  return out;
}

/** Gece kosu kapisinin uyari karari: onaylanmamis TUR varsa 409 yeni_uyari (oge ATLANDI). */
function uyariKarariOf(onaylananTurler) {
  const kodlar = (Array.isArray(onaylananTurler) ? onaylananTurler : []).map((t) => (t && typeof t === 'object' ? t.kod : t));
  return (uyarilar) => {
    const yeni = yeniTurler(uyarilar, kodlar);
    if (yeni.length) throw hata(409, 'yeni_uyari', `yeni uyarı: ${yeni.map((t) => (String(t.kod) + " " + t.ornek)).join(' | ')}`.slice(0, 900));
  };
}

/** Onaylanmamis turler (siralamayi korur). `onayli`: kod dizisi. */
function yeniTurler(liste, onayli) {
  const set = new Set(Array.isArray(onayli) ? onayli : []);
  return uyariTurleri(liste).filter((t) => !set.has(t.kod));
}

// -- GOVDE DOGRULAMA (olusturma) -----------------------------------------------------------

function tamSayi(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return null;
}

function zaman(v, ad) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw hata(400, 'gecersiz_istek', `${ad} ISO zaman olmalı.`);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw hata(400, 'gecersiz_istek', `${ad} okunamadı.`);
  return new Date(t);
}

/** Oge etiketi kurallari (olusturma ve duzenleme ortak): kirpilmis, zorunlu, en cok ETIKET_MAX, kontrol karakteri yok. */
function ogeEtiketi(v, onEk) {
  const etiket = typeof v === 'string' ? v.trim() : '';
  if (!etiket) throw hata(400, 'gecersiz_istek', `${onEk}etiket zorunlu (ne değiştirdiğinizi yazın, ör. "A3 brotli seviye 4").`);
  if (Array.from(etiket).length > ETIKET_MAX) throw hata(400, 'gecersiz_istek', `${onEk}etiket en çok ${ETIKET_MAX} karakter.`);
  // Kosu etiketi ve denetim kaydina yazilir: tekli kosunun etiket kapisi (dogrula.cjs KONTROL_KARAKTERI) ile ayni.
  if (KONTROL_KARAKTERI.test(etiket)) throw hata(400, 'gecersiz_istek', `${onEk}etiket satır sonu / kontrol karakteri içeremez.`);
  return etiket;
}

/** Istemcinin onayladigi uyari turu kodlari: bicimi tutanlar, tekil. */
function turKodlari(v) {
  return Array.isArray(v) ? [...new Set(v.filter((k) => typeof k === 'string' && /^U[0-9a-f]{10}$/.test(k)))] : [];
}

/**
 * POST /kuyruklar govdesi. Oge govdeleri (on kontrol govdesi) burada YALNIZ bicim olarak alinir;
 * kapilari cagiran (index.cjs) kosuPlani ile uygular. `simdiMs` testte sabit.
 */
function kuyrukGovdesi(b, { simdiMs = Date.now() } = {}) {
  const g = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  let beklemeDk = BEKLEME_VARSAYILAN_DK;
  if (g.beklemeDk !== undefined && g.beklemeDk !== null && g.beklemeDk !== '') {
    beklemeDk = tamSayi(g.beklemeDk);
    if (beklemeDk === null || beklemeDk < BEKLEME_MIN_DK || beklemeDk > BEKLEME_MAX_DK) {
      throw hata(400, 'gecersiz_istek', `Bekleme ${BEKLEME_MIN_DK}–${BEKLEME_MAX_DK} dk arasında bir tam sayı olmalı.`);
    }
  }
  const baslangic = zaman(g.baslangic, 'Başlangıç');
  if (baslangic && (baslangic.getTime() < simdiMs - 5 * 60000 || baslangic.getTime() > simdiMs + BASLANGIC_MAX_SAAT * 3600000)) {
    throw hata(400, 'gecersiz_istek', `Başlangıç şimdiden en çok ${BASLANGIC_MAX_SAAT} saat sonrası olabilir.`);
  }
  const enGecBitis = zaman(g.enGecBitis, 'En geç bitiş');
  if (enGecBitis) {
    const alt = Math.max(simdiMs, baslangic ? baslangic.getTime() : 0);
    if (enGecBitis.getTime() <= alt) throw hata(400, 'gecersiz_istek', 'En geç bitiş başlangıçtan sonra olmalı.');
    if (enGecBitis.getTime() > simdiMs + BITIS_MAX_SAAT * 3600000) throw hata(400, 'gecersiz_istek', `En geç bitiş şimdiden en çok ${BITIS_MAX_SAAT} saat sonrası olabilir.`);
  }
  const ad = typeof g.ad === 'string' ? g.ad.trim().slice(0, 120) : '';
  if (KONTROL_KARAKTERI.test(ad)) throw hata(400, 'gecersiz_istek', 'Kuyruk adı satır sonu / kontrol karakteri içeremez.');
  if (!Array.isArray(g.ogeler) || g.ogeler.length < 1) throw hata(400, 'gecersiz_istek', 'Kuyrukta en az bir öğe olmalı.');
  if (g.ogeler.length > MAX_OGE) throw hata(400, 'gecersiz_istek', `Kuyrukta en çok ${MAX_OGE} öğe olabilir.`);
  const ogeler = g.ogeler.map((o, i) => {
    const x = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    const etiket = ogeEtiketi(x.etiket, `Öğe ${i + 1}: `);
    if (!x.govde || typeof x.govde !== 'object' || Array.isArray(x.govde)) throw hata(400, 'gecersiz_istek', `Öğe ${i + 1}: ayarlar (govde) eksik.`);
    let onKontrolKosuId = null;
    if (x.onKontrolKosuId !== undefined && x.onKontrolKosuId !== null) {
      onKontrolKosuId = tamSayi(x.onKontrolKosuId);
      if (!(onKontrolKosuId > 0)) throw hata(400, 'gecersiz_istek', `Öğe ${i + 1}: onKontrolKosuId geçersiz.`);
    }
    return { etiket, govde: x.govde, onKontrolKosuId };
  });
  const onaylananTurler = turKodlari(g.onaylananTurler);
  return { ad: ad || null, beklemeDk, baslangic, enGecBitis, confirmText: g.confirmText, onaylananTurler, ogeler };
}

/** Kosu oncesi dosya uretimi payi: yalniz static sunucu ayarinda (parametreler kanonik nesne). */
function hazirlikPayiSn(p) {
  return p && p.sunucuAyar && p.sunucuAyar.static ? HAZIRLIK_PAY_SN : 0;
}

/** Kosu satirina yazilan etiket: "[K<kuyruk>] <oge etiketi>" (en cok 120 karakter). */
function kosuEtiketi(kuyrukId, etiket) {
  return Array.from(`[K${kuyrukId}] ${etiket}`).slice(0, 120).join('');
}

// -- SQL -----------------------------------------------------------------------------------
// Her ifadenin ilk anahtar sozcugunden sonra bir etiket var (/*KQ:ad*/): testteki sahte DB etiketle eslesir; kosullar
// metinde sinanir. Etiket BASA konmaz: db/index.cjs RETURNING cevirisi `^INSERT` / `^UPDATE` arar.

const KUYRUK_KOLONLARI = `id, ad, durum, bekleme_dk, baslangic_at, en_gec_bitis, onay_hedefi, hedef_turu, onaylanan_turler,
  created_by, created_at, iptal_eden, iptal_at, dinlenme_kosu_id, dinlenme_bitis, hata_sayisi, son_hata, bitis_at, hazir,
  duraklat_at, duraklatan,
  DATEDIFF(SECOND, GETUTCDATE(), baslangic_at) AS baslangic_kalan_sn,
  DATEDIFF(SECOND, GETUTCDATE(), en_gec_bitis) AS bitis_kalan_sn,
  DATEDIFF(SECOND, GETUTCDATE(), dinlenme_bitis) AS dinlenme_kalan_sn`;
const OGE_KOLONLARI = `id, kuyruk_id, sira, etiket, govde, butce_sn, uyari_turleri, durum, asama, deneme_id, on_kontrol_kosu_id,
  kosu_id, neden, deneme, baslama_at, bitis_at, created_at, sonraki_deneme_at,
  DATEDIFF(SECOND, GETUTCDATE(), sonraki_deneme_at) AS deneme_kalan_sn`;
// Kuyruk CALISIYOR, duraklatilmamis ve kira BIZDE: yeni is baslatan yazimlarin ortak kosulu ($K = kira parametresi).
const KUYRUK_BIZDE = (p) => `EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk q WHERE q.id = nginx_loadtest_kuyruk_ogeler.kuyruk_id AND q.durum = 'CALISIYOR' AND q.duraklat_at IS NULL AND q.kira_id = ${p})`;
// Yalniz kuyruk CALISIYOR (kirasiz): BEKLIYOR'a geri alma bununla. Kuyruk iptal / HATALI olduysa geri alma TUTMAZ;
// oge CALISIYOR kalir ve sonraki tur (aktifKuyruklar IPTAL / HATALI + calisan oge) onu IPTAL kapatir (yetim yok).
const KUYRUK_CALISIYOR = `EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk q WHERE q.id = nginx_loadtest_kuyruk_ogeler.kuyruk_id AND q.durum = 'CALISIYOR')`;
// Duraklatmada durdurulan kosu: kuyruk once DINLENME'ye gecer, oge sonra geri alinir. IPTAL / HATALI kuyrukta yine tutmaz.
const KUYRUK_YURUYOR = `EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk q WHERE q.id = nginx_loadtest_kuyruk_ogeler.kuyruk_id AND q.durum IN ('CALISIYOR', 'DINLENME'))`;

const SQL = Object.freeze({
  aktifKuyruklar: `SELECT /*KQ:aktifKuyruklar*/ TOP 20 q.id FROM nginx_loadtest_kuyruk q
     WHERE q.hazir = 1 AND (q.durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME')
       OR (q.durum IN ('IPTAL', 'HATALI') AND EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o WHERE o.kuyruk_id = q.id AND o.durum = 'CALISIYOR')))
     ORDER BY q.id ASC`,
  kiraAl: `UPDATE /*KQ:kiraAl*/ nginx_loadtest_kuyruk SET kira_id = $2, kira_bitis = DATEADD(SECOND, $3, GETUTCDATE())
     WHERE id = $1 AND (kira_id IS NULL OR kira_id = $2 OR kira_bitis IS NULL OR kira_bitis < GETUTCDATE())`,
  kuyrukOku: `SELECT /*KQ:kuyrukOku*/ ${KUYRUK_KOLONLARI} FROM nginx_loadtest_kuyruk WHERE id = $1`,
  kuyrukBasla: `UPDATE /*KQ:kuyrukBasla*/ nginx_loadtest_kuyruk SET durum = 'CALISIYOR'
     WHERE id = $1 AND durum = 'BEKLIYOR' AND hazir = 1 AND kira_id = $2 AND duraklat_at IS NULL AND (baslangic_at IS NULL OR baslangic_at <= GETUTCDATE())`,
  calisanOge: `SELECT /*KQ:calisanOge*/ TOP 1 ${OGE_KOLONLARI} FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = $1 AND durum = 'CALISIYOR' ORDER BY sira ASC, id ASC`,
  siradakiOge: `SELECT /*KQ:siradakiOge*/ TOP 1 ${OGE_KOLONLARI} FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = $1 AND durum = 'BEKLIYOR' ORDER BY sira ASC, id ASC`,
  kuyrukBitti: `UPDATE /*KQ:kuyrukBitti*/ nginx_loadtest_kuyruk SET durum = 'BITTI', bitis_at = GETUTCDATE()
     WHERE id = $1 AND durum = 'CALISIYOR' AND kira_id = $2
       AND NOT EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o WHERE o.kuyruk_id = $1 AND o.durum IN ('BEKLIYOR', 'CALISIYOR'))`,
  // Oge kapanisi: beklenen durumdan (BEKLIYOR ya da CALISIYOR) terminal duruma, tek seferlik.
  ogeKapat: `UPDATE /*KQ:ogeKapat*/ nginx_loadtest_kuyruk_ogeler SET durum = $3, neden = $4, deneme_id = NULL, bitis_at = GETUTCDATE()
     WHERE id = $1 AND durum = $2`,
  // BEKLIYOR oge kapidan donunce: karar okunan govdeyle verildi; arada duzenlendiyse tutmaz, sonraki tur yeni degerle karar verir.
  ogeAtla: `UPDATE /*KQ:ogeAtla*/ nginx_loadtest_kuyruk_ogeler SET durum = 'ATLANDI', neden = $2, deneme_id = NULL, bitis_at = GETUTCDATE()
     WHERE id = $1 AND durum = 'BEKLIYOR' AND govde = $3 AND etiket = $4`,
  ogeNeden: `UPDATE /*KQ:ogeNeden*/ nginx_loadtest_kuyruk_ogeler SET neden = $2, deneme = deneme + $3 WHERE id = $1 AND durum = $4`,
  // govde / etiket: plan bu degerlerle yapildi; arada duzenlendiyse sahiplenme tutmaz, sonraki tur yeni degerle baslar.
  ogeSahiplen: `UPDATE /*KQ:ogeSahiplen*/ nginx_loadtest_kuyruk_ogeler
     SET durum = 'CALISIYOR', asama = 'on_kontrol', deneme_id = $2, baslama_at = COALESCE(baslama_at, GETUTCDATE()), neden = NULL
     WHERE id = $1 AND durum = 'BEKLIYOR' AND on_kontrol_kosu_id IS NULL AND kosu_id IS NULL AND ${KUYRUK_BIZDE('$3')}
       AND NOT EXISTS (SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o2 WHERE o2.kuyruk_id = nginx_loadtest_kuyruk_ogeler.kuyruk_id AND o2.durum = 'CALISIYOR')
       AND govde = $4 AND etiket = $5`,
  okKaydet: `UPDATE /*KQ:okKaydet*/ nginx_loadtest_kuyruk_ogeler SET on_kontrol_kosu_id = $2
     WHERE id = $1 AND deneme_id = $3 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id IS NULL AND ${KUYRUK_BIZDE('$4')}`,
  // Numarasiz sahiplenmeyi geri alir (is AWX'e GITMEDI). $2 NULL: yeniden baslatma kurtarmasi (her deneme_id).
  ogeGeriAl: `UPDATE /*KQ:ogeGeriAl*/ nginx_loadtest_kuyruk_ogeler SET durum = 'BEKLIYOR', asama = NULL, deneme_id = NULL, neden = $3, deneme = deneme + $4
     WHERE id = $1 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id IS NULL AND kosu_id IS NULL AND (deneme_id = $2 OR $2 IS NULL)
       AND ${KUYRUK_CALISIYOR}`,
  // Numarali ama is KESIN baslamadi (kosuyuBaslat: satir FAILED, kilit birakildi, belirsiz degil, AWX isi yok):
  // numara silinir, oge BEKLIYOR'a doner (gecici hata yeniden denenir). Yalniz bu denemenin numarasi ($5).
  okSifirla: `UPDATE /*KQ:okSifirla*/ nginx_loadtest_kuyruk_ogeler SET durum = 'BEKLIYOR', asama = NULL, deneme_id = NULL, on_kontrol_kosu_id = NULL, neden = $3, deneme = deneme + $4
     WHERE id = $1 AND deneme_id = $2 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id = $5 AND kosu_id IS NULL
       AND ${KUYRUK_CALISIYOR}`,
  kosuSifirla: `UPDATE /*KQ:kosuSifirla*/ nginx_loadtest_kuyruk_ogeler SET asama = 'on_kontrol', deneme_id = NULL, kosu_id = NULL, neden = $3, deneme = deneme + $4
     WHERE id = $1 AND deneme_id = $2 AND durum = 'CALISIYOR' AND asama = 'kosu' AND kosu_id = $5
       AND ${KUYRUK_CALISIYOR}`,
  // Gecici hatadan sonra geri cekilme: oge bu ana kadar yeniden denenmez (kuyruk siradakine GECMEZ).
  ogeErtele: `UPDATE /*KQ:ogeErtele*/ nginx_loadtest_kuyruk_ogeler SET sonraki_deneme_at = DATEADD(SECOND, $2, GETUTCDATE())
     WHERE id = $1 AND durum IN ('BEKLIYOR', 'CALISIYOR')`,
  kosuAsamasi: `UPDATE /*KQ:kosuAsamasi*/ nginx_loadtest_kuyruk_ogeler SET asama = 'kosu', deneme_id = $3, neden = NULL
     WHERE id = $1 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id = $2 AND kosu_id IS NULL AND ${KUYRUK_BIZDE('$4')}`,
  kosuKaydet: `UPDATE /*KQ:kosuKaydet*/ nginx_loadtest_kuyruk_ogeler SET kosu_id = $2
     WHERE id = $1 AND deneme_id = $3 AND durum = 'CALISIYOR' AND asama = 'kosu' AND kosu_id IS NULL AND ${KUYRUK_BIZDE('$4')}`,
  kosuGeriAl: `UPDATE /*KQ:kosuGeriAl*/ nginx_loadtest_kuyruk_ogeler SET asama = 'on_kontrol', deneme_id = NULL, neden = $3, deneme = deneme + $4
     WHERE id = $1 AND durum = 'CALISIYOR' AND asama = 'kosu' AND kosu_id IS NULL AND (deneme_id = $2 OR $2 IS NULL)
       AND ${KUYRUK_CALISIYOR}`,
  onKontrolYenile: `UPDATE /*KQ:onKontrolYenile*/ nginx_loadtest_kuyruk_ogeler SET durum = 'BEKLIYOR', asama = NULL, deneme_id = NULL, on_kontrol_kosu_id = NULL, neden = $3
     WHERE id = $1 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id = $2 AND kosu_id IS NULL
       AND ${KUYRUK_CALISIYOR}`,
  // Duraklatmada durdurulan kosu: oge bastan kosulmak uzere BEKLIYOR'a doner (HATALI degil, numaralar silinir).
  kosuYenidenSirala: `UPDATE /*KQ:kosuYenidenSirala*/ nginx_loadtest_kuyruk_ogeler
     SET durum = 'BEKLIYOR', asama = NULL, deneme_id = NULL, kosu_id = NULL, on_kontrol_kosu_id = NULL, baslama_at = NULL, neden = $3
     WHERE id = $1 AND durum = 'CALISIYOR' AND asama = 'kosu' AND kosu_id = $2
       AND ${KUYRUK_YURUYOR}`,
  dinlenmeyeGec: `UPDATE /*KQ:dinlenmeyeGec*/ nginx_loadtest_kuyruk SET durum = 'DINLENME', dinlenme_kosu_id = $2, dinlenme_bitis = NULL
     WHERE id = $1 AND durum = 'CALISIYOR'`,
  dinlenmeBaslat: `UPDATE /*KQ:dinlenmeBaslat*/ nginx_loadtest_kuyruk SET dinlenme_bitis = DATEADD(MINUTE, bekleme_dk, GETUTCDATE())
     WHERE id = $1 AND durum = 'DINLENME' AND dinlenme_bitis IS NULL`,
  dinlenmeBitti: `UPDATE /*KQ:dinlenmeBitti*/ nginx_loadtest_kuyruk SET durum = 'CALISIYOR', dinlenme_kosu_id = NULL, dinlenme_bitis = NULL
     WHERE id = $1 AND durum = 'DINLENME' AND dinlenme_bitis IS NOT NULL AND dinlenme_bitis <= GETUTCDATE()`,
  kosuKilidi: `SELECT /*KQ:kosuKilidi*/ kilit_id, durum FROM nginx_loadtest_kosular WHERE id = $1`,
  // kilit.casLock'un "devralinabilir" kosulunun TERSI: dolu ve suresi gecerli (ya da ise bagli, 12 saatten taze).
  kilitTutuluyor: `SELECT /*KQ:kilitTutuluyor*/ COUNT(1) AS n FROM nginx_loadtest_kilitleri
     WHERE lock_id = $1 AND held = 1 AND locked_until IS NOT NULL AND locked_until >= DATEADD(HOUR, -12, GETUTCDATE())
       AND (locked_until >= GETUTCDATE() OR awx_job_id IS NOT NULL)`,
  // Hedefin kilidi dolu mu (kilitTutuluyor ile ayni kosul, is kimligi yerine anahtarla): kuyrugun o an izlemedigi is de
  // (atlanan ayarli on kontrolun geri almasi) hedefe dokunuyor olabilir.
  hedefKilitli: `SELECT /*KQ:hedefKilitli*/ COUNT(1) AS n FROM nginx_loadtest_kilitleri
     WHERE lock_key = $1 AND held = 1 AND locked_until IS NOT NULL AND locked_until >= DATEADD(HOUR, -12, GETUTCDATE())
       AND (locked_until >= GETUTCDATE() OR awx_job_id IS NOT NULL)`,
  // Hedefin son sunucu ayarli isi: konfun son hali bu isin geri alma sonucuna bagli (poller.cjs ile ayni LIKE).
  sonAyarliKosu: `SELECT /*KQ:sonAyarliKosu*/ TOP 1 id FROM nginx_loadtest_kosular
     WHERE hedef_host = $1 AND parametreler LIKE '%"sunucuAyar":{%' ORDER BY id DESC`,
  hataSay: `UPDATE /*KQ:hataSay*/ nginx_loadtest_kuyruk SET hata_sayisi = hata_sayisi + 1, son_hata = $2 WHERE id = $1`,
  hataSifirla: `UPDATE /*KQ:hataSifirla*/ nginx_loadtest_kuyruk SET hata_sayisi = 0 WHERE id = $1 AND hata_sayisi <> 0`,
  kuyrukHatali: `UPDATE /*KQ:kuyrukHatali*/ nginx_loadtest_kuyruk SET durum = 'HATALI', bitis_at = GETUTCDATE()
     WHERE id = $1 AND hata_sayisi >= $2 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME')`,
  hataliOgeler: `UPDATE /*KQ:hataliOgeler*/ nginx_loadtest_kuyruk_ogeler SET durum = 'ATLANDI', neden = $2, bitis_at = GETUTCDATE()
     WHERE kuyruk_id = $1 AND durum = 'BEKLIYOR'`,
  // -- HTTP uclari --
  kuyrukEkle: `INSERT /*KQ:kuyrukEkle*/ INTO nginx_loadtest_kuyruk (ad, durum, bekleme_dk, baslangic_at, en_gec_bitis, onay_hedefi, hedef_turu, onaylanan_turler, created_by, hazir)
     VALUES ($1, 'BEKLIYOR', $2, $3, $4, $5, $6, $7, $8, 0) RETURNING id`,
  // Ayni hedefe ikinci aktif kuyruk yok (dinlenme kuyruk basina sayilir; iki kuyruk dinlenmesiz ard arda basardi).
  ayniHedefAktif: `SELECT /*KQ:ayniHedefAktif*/ TOP 1 id FROM nginx_loadtest_kuyruk
     WHERE onay_hedefi = $1 AND hazir = 1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME') ORDER BY id ASC`,
  kuyrukHazir: `UPDATE /*KQ:kuyrukHazir*/ nginx_loadtest_kuyruk SET hazir = 1, baslangic_at = COALESCE(baslangic_at, GETUTCDATE()) WHERE id = $1 AND hazir = 0`,
  kuyrukYarim: `UPDATE /*KQ:kuyrukYarim*/ nginx_loadtest_kuyruk SET durum = 'HATALI', son_hata = $2, bitis_at = GETUTCDATE() WHERE id = $1 AND hazir = 0`,
  ogeEkle: `INSERT /*KQ:ogeEkle*/ INTO nginx_loadtest_kuyruk_ogeler (kuyruk_id, sira, etiket, govde, butce_sn, uyari_turleri, durum, deneme)
     VALUES ($1, $2, $3, $4, $5, $6, 'BEKLIYOR', 0)`,
  kuyrukListe: `SELECT /*KQ:kuyrukListe*/ TOP 50 ${KUYRUK_KOLONLARI},
     (SELECT COUNT(1) FROM nginx_loadtest_kuyruk_ogeler o WHERE o.kuyruk_id = nginx_loadtest_kuyruk.id) AS oge_sayisi,
     (SELECT COUNT(1) FROM nginx_loadtest_kuyruk_ogeler o WHERE o.kuyruk_id = nginx_loadtest_kuyruk.id AND o.durum IN ('BITTI', 'ATLANDI', 'HATALI', 'IPTAL')) AS biten_sayisi
     FROM nginx_loadtest_kuyruk ORDER BY id DESC`,
  ogeListe: `SELECT /*KQ:ogeListe*/ ${OGE_KOLONLARI} FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = $1 ORDER BY sira ASC, id ASC`,
  kuyrukIptal: `UPDATE /*KQ:kuyrukIptal*/ nginx_loadtest_kuyruk SET durum = 'IPTAL', iptal_eden = $2, iptal_at = GETUTCDATE(), bitis_at = GETUTCDATE()
     WHERE id = $1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME')`,
  ogelerIptal: `UPDATE /*KQ:ogelerIptal*/ nginx_loadtest_kuyruk_ogeler SET durum = 'IPTAL', neden = $2, bitis_at = GETUTCDATE()
     WHERE kuyruk_id = $1 AND durum = 'BEKLIYOR'`,
  ogeCikar: `UPDATE /*KQ:ogeCikar*/ nginx_loadtest_kuyruk_ogeler SET durum = 'IPTAL', neden = $3, bitis_at = GETUTCDATE()
     WHERE id = $2 AND kuyruk_id = $1 AND durum = 'BEKLIYOR'`,
  kuyrukDuraklat: `UPDATE /*KQ:kuyrukDuraklat*/ nginx_loadtest_kuyruk SET duraklat_at = GETUTCDATE(), duraklatan = $2
     WHERE id = $1 AND hazir = 1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME') AND duraklat_at IS NULL`,
  kuyrukDevam: `UPDATE /*KQ:kuyrukDevam*/ nginx_loadtest_kuyruk SET duraklat_at = NULL, duraklatan = NULL
     WHERE id = $1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME') AND duraklat_at IS NOT NULL`,
  // Yalniz baslamamis oge: yurutucu sahiplendiyse tutmaz. Gecici hata sayaci ve geri cekilme eski ayara aitti.
  ogeGuncelle: `UPDATE /*KQ:ogeGuncelle*/ nginx_loadtest_kuyruk_ogeler SET etiket = $3, govde = $4, butce_sn = $5, uyari_turleri = $6, neden = NULL, deneme = 0, sonraki_deneme_at = NULL
     WHERE id = $2 AND kuyruk_id = $1 AND durum = 'BEKLIYOR' AND on_kontrol_kosu_id IS NULL AND kosu_id IS NULL`,
  // Onaylanan turler CAS ($3 = okunan metin): iki eszamanli duzenleme birbirinin onayini ezmesin.
  kuyrukTurlerEkle: `UPDATE /*KQ:kuyrukTurlerEkle*/ nginx_loadtest_kuyruk SET onaylanan_turler = $2
     WHERE id = $1 AND durum IN ('BEKLIYOR', 'CALISIYOR', 'DINLENME') AND COALESCE(onaylanan_turler, '') = $3`,
});

/** Siralama: tek UPDATE (CASE) - yalniz hala BEKLIYOR olanlar; sira degerleri kuyrugun en buyugunun ustunden. */
function siraSql(n) {
  const durumlar = Array.from({ length: n }, (_, i) => `WHEN $${i + 2} THEN $${n + 2} + ${i + 1}`).join(' ');
  const idler = Array.from({ length: n }, (_, i) => `$${i + 2}`).join(', ');
  return `UPDATE /*KQ:sira*/ nginx_loadtest_kuyruk_ogeler SET sira = CASE id ${durumlar} END
     WHERE kuyruk_id = $1 AND durum = 'BEKLIYOR' AND id IN (${idler})`;
}
const SIRA_TABAN_SQL = `SELECT /*KQ:siraTaban*/ MAX(sira) AS m FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = $1`;

// -- YURUTUCU ------------------------------------------------------------------------------

const sayiOf = (v) => { if (v == null || v === '') return null; if (Number.isFinite(Number(v))) return Number(v); return null; };
function jsonOku(s, varsayilan = null) {
  if (s == null || s === '') return varsayilan;
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return varsayilan;
  }
}
const kisa = (s, n = 1000) => maskele(String(s ?? '')).slice(0, n);

/**
 * Hata siniflandirmasi: 'bekle' (kilit dolu: kuyruk bekler, deneme sayilmaz) | 'gecici' (424 / beklenmeyen:
 * yeniden denenir, geri cekilmeyle, en cok GECICI_DENEME_SINIRI) | 'hatali' (kosu satiri olustu ve is AWX'te
 * BASLAMIS OLABILIR: belirsiz ya da AWX is numarasi var; kilit birakilmadi) | 'birak' (kosullu yazim tutmadi:
 * kira / iptal bu surece ait degil) | 'atla' (kalici ret: 400 / 403 / 409).
 * kosuId'li ama belirsiz olmayan, is numarasiz hata (AWX sablonu dogrulanamadi, launch 4xx): is KESIN baslamadi,
 * kosuyuBaslat kilidi birakti, satir FAILED -> durumuna gore 'gecici' / 'atla' (kisa AWX kesintisi kuyrugu bitirmez).
 */
function hataSinifi(e) {
  const code = e && e.code;
  if (code === 'kilit_dolu') return 'bekle';
  if (code === 'kuyruk_yazilamadi') return 'birak';
  if (e && e.kosuId != null && (e.belirsiz || e.jobId != null)) return 'hatali';
  const st = Number(e && e.status);
  if (st === 400 || st === 403 || st === 409) return 'atla';
  return 'gecici';
}

/** Hata kosu satiri tasiyor ama is kesin baslamadi mi (numara ogeden silinip yeniden denenebilir). */
function numaraliBaslamadi(e) {
  return !!(e && e.kosuId != null && !e.belirsiz && e.jobId == null);
}

/** Gecici denemeden sonra geri cekilme bitmedi mi (DB saatiyle kalan sn). */
function geriCekiliyor(oge) {
  const kalan = sayiOf(oge.deneme_kalan_sn);
  return kalan !== null && kalan > 0;
}

/** Ogenin plan girdisi (saklanan govde) -> kosuPlani argumani; etiket kosu etiketi olur. */
function ogePlanGirdisi(kuyruk, oge) {
  const g = jsonOku(oge.govde, {}) || {};
  return {
    senaryoId: Number(g.senaryoId), hedefHost: g.hedefHost || null, hedefIp: g.hedefIp, vhost: g.vhost, yukHost: g.yukHost,
    sni: g.sni === true, parametrelerHam: g.parametreler, etiket: kosuEtiketi(kuyruk.id, oge.etiket),
  };
}

/** Planin onay hedefi: serbestte IP, sunucuda host (mevcut kosu onayi kalibi). */
function onayHedefiOf(plan) {
  return plan.hedefTuru === 'serbest' ? plan.hedefIp : plan.hedefHost;
}

function sureMetni(sn) {
  const d = Math.max(0, Math.round(Number(sn) / 60));
  return d >= 60 ? `${Math.floor(d / 60)} sa ${d % 60} dk` : `${d} dk`;
}

/**
 * Tek kuyrugun bir ya da birkac adimi. `ctx`: { db, islem, kira }. `islem` index.cjs'ten:
 *   yetkiVarMi(kullanici) -> { ok, neden }
 *   plan(planGirdisi) -> plan (kosuPlani; kapilari YENIDEN uygular)
 *   onKontrolBaslat(kullanici, plan, kosuKaydedildi) -> { kosuId }
 *   kosuOku(id) -> satir (yas_sn dahil)
 *   kosuBaslat(kullanici, { okId, confirmText, onaylananTurler, kosuKaydedildi }) -> { kosuId }
 * Donus: yapilan gecis sayisi.
 */
async function kuyrukIsle(ctx, kuyrukId) {
  const { db } = ctx;
  let gecis = 0;
  for (let i = 0; i < ADIM_SINIRI; i += 1) {
    const { rows } = await db.query(SQL.kuyrukOku, [kuyrukId]);
    const k = rows && rows[0];
    if (!k) return gecis;
    const sonuc = await kuyrukAdimi(ctx, k);
    if (sonuc !== 'devam') return gecis;
    gecis += 1;
  }
  return gecis;
}

async function kuyrukAdimi(ctx, k) {
  const { db, kira } = ctx;
  if (k.durum === 'BEKLIYOR') {
    const r = await db.query(SQL.kuyrukBasla, [k.id, kira]);
    return r.rowCount ? 'devam' : 'dur';
  }
  const { rows: cr } = await db.query(SQL.calisanOge, [k.id]);
  const cur = cr && cr[0];
  if (cur) return ogeIlerlet(ctx, k, cur);
  if (k.durum === 'IPTAL' || k.durum === 'BITTI' || k.durum === 'HATALI') return 'dur';
  if (k.durum === 'DINLENME') return dinlenme(ctx, k);
  // CALISIYOR, calisan oge yok: siradaki.
  const { rows: sr } = await db.query(SQL.siradakiOge, [k.id]);
  const next = sr && sr[0];
  if (!next) {
    const r = await db.query(SQL.kuyrukBitti, [k.id, kira]);
    if (r.rowCount) console.log(`[NginxYukTesti kuyruk] kuyruk ${k.id} bitti`);
    return 'dur';
  }
  // Duraklatildi: siradaki baslamaz (DINLENME bitmisse de burada durur).
  if (k.duraklat_at != null) return 'dur';
  return ogeBaslat(ctx, k, next);
}

async function ogeKapat(db, oge, beklenen, yeni, neden) {
  const r = await db.query(SQL.ogeKapat, [oge.id, beklenen, yeni, neden == null ? null : kisa(neden)]);
  // Log ASCII: neden (Turkce metin) satirda, logda yalniz durum.
  if (r.rowCount) console.log(`[NginxYukTesti kuyruk] oge ${oge.id} (kuyruk ${oge.kuyruk_id}) ${yeni}`);
  return r.rowCount > 0;
}

/** BEKLIYOR ogeyi kapi kararindan ATLANDI yapar; karar okunan govdeyle verildi, arada duzenlendiyse tutmaz. */
async function ogeAtla(db, oge, neden) {
  const r = await db.query(SQL.ogeAtla, [oge.id, kisa(neden), oge.govde, oge.etiket]);
  if (!r.rowCount) return 'dur';
  console.log(`[NginxYukTesti kuyruk] oge ${oge.id} (kuyruk ${oge.kuyruk_id}) ATLANDI`);
  return 'devam';
}

/** Sure kapisi: en gec bitis verilmisse ve kalan sure tahmine yetmiyorsa neden metni, yetiyorsa null. */
function sureYetmiyor(k, tahminSn) {
  const kalan = sayiOf(k.bitis_kalan_sn);
  if (k.en_gec_bitis == null || kalan === null) return null;
  if (kalan >= tahminSn) return null;
  return `süre yetmedi: tahmini ${sureMetni(tahminSn)}, en geç bitişe ${sureMetni(Math.max(0, kalan))} kaldı`;
}

async function yetkiKapisi(ctx, k) {
  const y = await ctx.islem.yetkiVarMi(k.created_by);
  return y && y.ok ? null : `yetki: ${(y && y.neden) || 'kuyruğu oluşturan kullanıcının yetkisi doğrulanamadı'}`;
}

/**
 * Gecici hata (424 / beklenmeyen): deneme sayaci artar, neden yazilir; sinira ulasinca oge HATALI. `geriAl`
 * verilmisse (numarasiz sahiplenme) once o geri alinir (oge BEKLIYOR'a doner); yoksa oge `durum`unda kalir.
 */
async function geciciHata(ctx, oge, e, geriAl) {
  const deneme = Number(oge.deneme || 0) + 1;
  const son = deneme >= GECICI_DENEME_SINIRI;
  const bekleSn = GERI_CEKILME_SN[Math.min(deneme, GERI_CEKILME_SN.length) - 1];
  const msg = `geçici hata (${deneme}/${GECICI_DENEME_SINIRI}): ${kisa(e && e.message, 400)}${son ? '' : ("; yeniden deneme " + sureMetni(bekleSn) + " sonra")}`;
  const durum = geriAl && oge.asama !== 'kosu' ? 'BEKLIYOR' : oge.durum;
  if (geriAl) await geriAl(msg, 1);
  else await ctx.db.query(SQL.ogeNeden, [oge.id, msg, 1, durum]);
  if (son) {
    await ogeKapat(ctx.db, oge, durum, 'HATALI', msg);
    return 'devam';
  }
  await ctx.db.query(SQL.ogeErtele, [oge.id, bekleSn]);
  return 'dur';
}

/** BEKLIYOR ogeyi baslatir: kapilar -> sahiplen -> on kontrol (numara AWX'ten once ogeye yazilir). */
async function ogeBaslat(ctx, k, oge) {
  const { db, islem, kira } = ctx;
  // Gecici hatadan sonra geri cekilme: sira korunur (siradakine gecilmez), sure dolunca ayni oge.
  if (geriCekiliyor(oge)) return 'dur';
  const yetki = await (async () => {
    try {
      return { neden: await yetkiKapisi(ctx, k) };
    } catch (e) {
      return { e };
    }
  })();
  if (yetki.e) return geciciHata(ctx, oge, yetki.e, null);
  if (yetki.neden) return ogeAtla(db, oge, yetki.neden);
  const butce = sayiOf(oge.butce_sn) ?? 0;
  const yetmez = sureYetmiyor(k, ON_KONTROL_PAY_SN + butce);
  if (yetmez) return ogeAtla(db, oge, yetmez);
  let plan;
  try {
    plan = await islem.plan(ogePlanGirdisi(k, oge));
  } catch (e) {
    const s = hataSinifi(e);
    if (s === 'atla' || s === 'hatali') return ogeAtla(db, oge, `kapı: ${kisa(e && e.message)}`);
    return geciciHata(ctx, oge, e, null);
  }
  if (onayHedefiOf(plan) !== k.onay_hedefi) {
    return ogeAtla(db, oge, `hedef değişti: onaylanan ${k.onay_hedefi}, şimdi ${onayHedefiOf(plan) || '?'}`);
  }
  // Kosu butcesi yeniden olculdu (varsayilan degismis olabilir): sure kapisi bu degerle de.
  const planButce = Number(plan.parametreler && plan.parametreler.butceSn);
  const yetmez2 = sureYetmiyor(k, ON_KONTROL_PAY_SN + (planButce ? planButce + hazirlikPayiSn(plan.parametreler) : butce));
  if (yetmez2) return ogeAtla(db, oge, yetmez2);
  const token = crypto.randomUUID();
  let al;
  try {
    al = await db.query(SQL.ogeSahiplen, [oge.id, token, kira, oge.govde, oge.etiket]);
  } catch (e) {
    // UX_nlko_calisan: baska surec ayni kuyrukta bir ogeyi az once sahiplendi.
    if (/2627|2601|duplicate|UNIQUE/i.test(String(e && (e.number ?? '')) + String(e && e.message))) return 'dur';
    throw e;
  }
  if (!al.rowCount) return 'dur';
  const geriAl = async (neden, artis) => db.query(SQL.ogeGeriAl, [oge.id, token, neden, artis]);
  try {
    await islem.onKontrolBaslat(k.created_by, plan, async (kosuId) => {
      const r = await db.query(SQL.okKaydet, [oge.id, kosuId, token, kira]);
      if (!r.rowCount) throw hata(409, 'kuyruk_yazilamadi', 'Kuyruk öğesi bu sürece ait değil (iptal / kira); iş başlatılmadı.');
    });
    return 'dur';
  } catch (e) {
    const s = hataSinifi(e);
    if (s === 'birak') return 'dur';
    if (s === 'bekle') {
      await geriAl(`bekliyor: ${kisa(e && e.message, 400)}`, 0);
      return 'dur';
    }
    if (s === 'gecici') {
      // Numara yazildi ama is kesin baslamadi (satir FAILED, kilit birakildi): numara silinerek geri alinir.
      const geri = numaraliBaslamadi(e) ? async (neden, artis) => db.query(SQL.okSifirla, [oge.id, token, neden, artis, e.kosuId]) : geriAl;
      return geciciHata(ctx, { ...oge, asama: 'on_kontrol' }, e, geri);
    }
    // Kalici ret ya da is baslamis olabilir (belirsiz): oge kapanir (CALISIYOR -> ATLANDI / HATALI).
    const yeni = s === 'hatali' ? 'HATALI' : 'ATLANDI';
    await ogeKapat(db, oge, 'CALISIYOR', yeni, `ön kontrol başlatılamadı: ${kisa(e && e.message)}`);
    return 'devam';
  }
}

/** Kuyruk yuruyor ama duraklatilmis mi (IPTAL / HATALI kuyrukta bayrak ise yaramaz: mevcut kapanis yollari). */
const duraklatildi = (k) => k.durum === 'CALISIYOR' && k.duraklat_at != null;

/**
 * Kosu kullanici durdurmasiyla mi bitiyor? CANCELED; ya da Durdur basilmis ve DONE degil (AWX iptali tutmadi, durdurma isi yuku
 * oldurdu: is 'failed' biter, satir FAILED; surerken de true). Sonucu sayilmaz: duraklatmada oge bastan kosulur.
 */
const kosuDurduruldu = (x) => x.durum === 'CANCELED' || (!!x.iptal_eden && x.durum !== 'DONE');

/** CALISIYOR ogeyi bir adim ilerletir. */
async function ogeIlerlet(ctx, k, oge) {
  const { db, islem, kira } = ctx;
  const okId = sayiOf(oge.on_kontrol_kosu_id);
  const kosuId = sayiOf(oge.kosu_id);
  if ((oge.asama === 'on_kontrol' && okId == null) || (oge.asama === 'kosu' && kosuId == null)) {
    // Numarasiz sahiplenme: is AWX'e GITMEDI (numara launch'tan once, kuyruk CALISIYOR iken yazilir). Kuyruk
    // iptal edildiyse oge IPTAL; degilse geri alinir (surec yeniden basladi / kira dustu) ve yeniden denenir.
    if (k.durum !== 'CALISIYOR') return (await (async () => { if ((await ogeKapat(db, oge, 'CALISIYOR', 'IPTAL', `kuyruk ${k.durum === 'IPTAL' ? 'iptal edildi' : k.durum}; iş başlatılmamıştı`))) return 'devam'; return 'dur'; })());
    const r = oge.asama === 'kosu'
      ? await db.query(SQL.kosuGeriAl, [oge.id, null, 'koşu başlatma yarım kaldı; iş başlatılmamıştı, yeniden denenecek', 0])
      : await db.query(SQL.ogeGeriAl, [oge.id, null, 'Portal başlatma sırasında yeniden başladı; iş başlatılmamıştı, yeniden denenecek', 0]);
    return r.rowCount ? 'devam' : 'dur';
  }
  if (oge.asama === 'kosu') {
    const kosu = await islem.kosuOku(kosuId);
    if (!kosu) return (await ogeKapat(db, oge, 'CALISIYOR', 'HATALI', `koşu #${kosuId} bulunamadı`)) ? sonrasi(ctx, k, kosuId) : 'dur';
    if (AKTIF_KOSU.has(kosu.durum)) return 'dur';
    if (k.duraklat_at != null && AKTIF_KUYRUK.has(k.durum) && kosuDurduruldu(kosu)) {
      // Once DINLENME: tersi sirada ikinci yazim kaybolursa oge BEKLIYOR, dinlenme hic yok ve ekran geri alma surerken "Duraklatildi"
      // derdi. Bu sirada kesilirse oge CALISIYOR kalir, sonraki tur (kuyruk DINLENME) buraya doner ve yalniz ogeyi yazar.
      if (k.durum === 'CALISIYOR' && !(await db.query(SQL.dinlenmeyeGec, [k.id, kosuId])).rowCount) return 'dur';
      const r = await db.query(SQL.kosuYenidenSirala, [oge.id, kosuId, `koşu #${kosuId} duraklatmada durduruldu; devamda baştan koşulacak`]);
      return r.rowCount ? 'devam' : 'dur';
    }
    const tamam = kosu.durum === 'DONE';
    const neden = (() => { if (tamam) return null; if (kosu.durum === 'CANCELED') return `koşu #${kosuId} durduruldu (CANCELED)`; return `koşu #${kosuId} ${kosu.durum}`; })();
    if (!(await ogeKapat(db, oge, 'CALISIYOR', tamam ? 'BITTI' : 'HATALI', neden))) return 'dur';
    return sonrasi(ctx, k, kosuId);
  }
  // asama on_kontrol, numarali.
  const ok = await islem.kosuOku(okId);
  if (!ok) return (await ogeKapat(db, oge, 'CALISIYOR', 'ATLANDI', `ön kontrol #${okId} bulunamadı`)) ? 'devam' : 'dur';
  if (AKTIF_KOSU.has(ok.durum)) return 'dur';
  if (duraklatildi(k)) {
    // Kilit tutuluyorsa (durdurma isi sunucu ayarini geri aliyor olabilir) oge CALISIYOR kalir: ekran "bekliyor" der.
    if (await kosuKilitliMi(db, okId)) return 'dur';
    const r = await db.query(SQL.onKontrolYenile, [oge.id, okId, 'kuyruk duraklatıldı; devamda ön kontrol yeniden çalışacak']);
    return r.rowCount ? 'devam' : 'dur';
  }
  if (ok.durum !== 'DONE') {
    const s = jsonOku(ok.sonuc, {}) || {};
    if ((await ogeKapat(db, oge, 'CALISIYOR', 'ATLANDI', `ön kontrol #${okId} ${ok.durum}${s.hata ? (": " + s.hata) : ''}`))) return 'devam'; return 'dur';
  }
  if (k.durum !== 'CALISIYOR') {
    // Kuyruk iptal edildi (ya da durdu): kosu BASLATILMAZ.
    if ((await ogeKapat(db, oge, 'CALISIYOR', 'IPTAL', `kuyruk ${k.durum === 'IPTAL' ? 'iptal edildi' : k.durum}; ön kontrol #${okId} sonrası koşu başlatılmadı`))) return 'devam'; return 'dur';
  }
  if (geriCekiliyor(oge)) return 'dur';
  let yetkiNeden;
  try {
    yetkiNeden = await yetkiKapisi(ctx, k);
  } catch (e) {
    return geciciHata(ctx, oge, e, null);
  }
  if (yetkiNeden) return (await ogeKapat(db, oge, 'CALISIYOR', 'ATLANDI', yetkiNeden)) ? 'devam' : 'dur';
  const okParam = jsonOku(ok.parametreler, {}) || {};
  const yetmez = sureYetmiyor(k, Number(okParam.butceSn) ? Number(okParam.butceSn) + hazirlikPayiSn(okParam) : sayiOf(oge.butce_sn) || 0);
  if (yetmez) return (await ogeKapat(db, oge, 'CALISIYOR', 'ATLANDI', yetmez)) ? 'devam' : 'dur';
  const yas = sayiOf(ok.yas_sn);
  if (yas === null || yas > ON_KONTROL_TAZE_SN) {
    // Kosu kilit beklerken on kontrol eskidi: yeniden on kontrol (sira korunur).
    const r = await db.query(SQL.onKontrolYenile, [oge.id, okId, `ön kontrol #${okId} eskidi (kilit beklenirken); yeniden çalıştırılacak`]);
    return r.rowCount ? 'devam' : 'dur';
  }
  const token = crypto.randomUUID();
  const al = await db.query(SQL.kosuAsamasi, [oge.id, okId, token, kira]);
  if (!al.rowCount) return 'dur';
  const geriAl = async (neden, artis) => db.query(SQL.kosuGeriAl, [oge.id, token, neden, artis]);
  try {
    await islem.kosuBaslat(k.created_by, {
      okId,
      confirmText: k.onay_hedefi,
      onaylananTurler: jsonOku(k.onaylanan_turler, []) || [],
      kosuKaydedildi: async (yeniId) => {
        const r = await db.query(SQL.kosuKaydet, [oge.id, yeniId, token, kira]);
        if (!r.rowCount) throw hata(409, 'kuyruk_yazilamadi', 'Kuyruk öğesi bu sürece ait değil (iptal / kira); koşu başlatılmadı.');
      },
    });
    return 'dur';
  } catch (e) {
    const s = hataSinifi(e);
    if (s === 'birak') return 'dur';
    if (s === 'bekle') {
      await geriAl(`bekliyor: ${kisa(e && e.message, 400)}`, 0);
      return 'dur';
    }
    if (s === 'gecici') {
      const geri = numaraliBaslamadi(e) ? async (neden, artis) => db.query(SQL.kosuSifirla, [oge.id, token, neden, artis, e.kosuId]) : geriAl;
      return geciciHata(ctx, { ...oge, asama: 'kosu' }, e, geri);
    }
    if (s === 'hatali') {
      await ogeKapat(db, oge, 'CALISIYOR', 'HATALI', `koşu başlatılamadı: ${kisa(e && e.message)}`);
      // Is AWX'te baslamis olabilir (belirsiz / is numarali): yuk surebilir, dinlenme kilit birakilinca baslar.
      return sonrasi(ctx, k, e.kosuId);
    }
    const neden = e && e.code === 'yeni_uyari' ? kisa(e.message) : `koşu kapısı: ${kisa(e && e.message)}`;
    await ogeKapat(db, oge, 'CALISIYOR', 'ATLANDI', neden);
    return 'devam';
  }
}

/** Oge kapandi: yuk uretmis olabilecek (kosu numarali) ogeden sonra dinlenme, degilse siradaki. */
async function sonrasi(ctx, k, kosuId) {
  if (kosuId == null || k.durum !== 'CALISIYOR') return 'devam';
  const r = await ctx.db.query(SQL.dinlenmeyeGec, [k.id, kosuId]);
  return r.rowCount ? 'devam' : 'dur';
}

/** Kuyrugun hedef kilidi anahtari (kilit.cjs kilitAnahtarlari ile ayni). */
function hedefKilitAnahtari(k) {
  return k.hedef_turu === 'serbest' ? `T|IP:${k.onay_hedefi}` : `T|${String(k.onay_hedefi).trim().toUpperCase()}`;
}

/**
 * Kosunun kilitleri hala tutuluyor mu? DB okunamazsa HATA firlar (tur hatasi; adim birakilir, sonraki tur yeniden).
 * Kosu SATIRI yoksa (silinmis / hic yok) kilit kimligi bilinemez: false (bekleme yine bekleme_dk surer). Bilincli
 * tercih: "kosu bulunamadi" ogesinden sonra kuyruk ardisik tur hatasiyla HATALI'ya dusmesin.
 */
async function kosuKilitliMi(db, kosuId) {
  const { rows } = await db.query(SQL.kosuKilidi, [kosuId]);
  const r = rows && rows[0];
  if (!r) return false;
  if (AKTIF_KOSU.has(r.durum)) return true;
  if (!r.kilit_id) return false;
  const { rows: kr } = await db.query(SQL.kilitTutuluyor, [String(r.kilit_id)]);
  return Number(kr && kr[0] && kr[0].n) > 0;
}

async function dinlenme(ctx, k) {
  const { db } = ctx;
  if (k.dinlenme_bitis == null) {
    // Bekleme, onceki kosunun kilitleri BIRAKILDIKTAN SONRA sayilir.
    if (k.dinlenme_kosu_id != null && (await kosuKilitliMi(db, Number(k.dinlenme_kosu_id)))) return 'dur';
    const r = await db.query(SQL.dinlenmeBaslat, [k.id]);
    return r.rowCount ? 'devam' : 'dur';
  }
  const kalan = sayiOf(k.dinlenme_kalan_sn);
  if (kalan !== null && kalan > 0) return 'dur';
  const r = await db.query(SQL.dinlenmeBitti, [k.id]);
  return r.rowCount ? 'devam' : 'dur';
}

/** Bir tur: aktif kuyruklar, her biri icin kira -> isle. Kuyruk hatasi digerlerini durdurmaz. */
async function tick(ctx) {
  const { db } = ctx;
  const kira = ctx.kira || SUREC_ID;
  const { rows } = await db.query(SQL.aktifKuyruklar);
  let toplam = 0;
  for (const { id } of rows || []) {
    const al = await db.query(SQL.kiraAl, [id, kira, KIRA_SN]);
    if (!al.rowCount) continue;
    try {
      toplam += await kuyrukIsle({ ...ctx, kira }, id);
      await db.query(SQL.hataSifirla, [id]);
    } catch (e) {
      const m = kisa(e && e.message, 500);
      console.warn(`[NginxYukTesti kuyruk] kuyruk ${id} adimi hata verdi (sonraki tur yeniden):`, m);
      try {
        await db.query(SQL.hataSay, [id, m]);
        const h = await db.query(SQL.kuyrukHatali, [id, KUYRUK_HATA_SINIRI]);
        if (h.rowCount) {
          await db.query(SQL.hataliOgeler, [id, `kuyruk ${KUYRUK_HATA_SINIRI} kez üst üste hata verdi ve durdu: ${m}`]);
          console.warn(`[NginxYukTesti kuyruk] kuyruk ${id} HATALI (${KUYRUK_HATA_SINIRI} ardisik hata)`);
        }
      } catch {
        /* DB yoksa sayac da yazilamaz; sonraki tur */
      }
    }
  }
  return toplam;
}

function tickSaniye(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_KUYRUK_SN ?? '').trim();
  const n = Number(ham);
  if (!ham || !Number.isInteger(n)) return 15;
  return Math.min(Math.max(n, 5), 120);
}

function startKuyruk(islem) {
  if (_timer) return;
  const sn = tickSaniye();
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick({ db: require('../db/index.cjs'), islem, kira: SUREC_ID })
      .catch((e) => console.warn('[NginxYukTesti kuyruk] tur hatasi:', kisa(e && e.message, 500)))
      .finally(() => {
        _ticking = false;
      });
  }, sn * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[NginxYukTesti kuyruk] basladi (${sn} sn)`);
}

// -- GORUNUM -------------------------------------------------------------------------------

const iso = (v) => { if (v == null || v === '') return null; if (v instanceof Date) return v.toISOString(); return String(v); };

function turlerApi(v) {
  const d = jsonOku(v, []);
  return Array.isArray(d) ? d.filter((t) => t && typeof t.kod === 'string').map((t) => ({ kod: t.kod, ornek: String(t.ornek ?? '') })) : [];
}

function kuyrukApi(r) {
  return {
    id: Number(r.id),
    ad: r.ad ?? null,
    durum: r.durum,
    beklemeDk: Number(r.bekleme_dk),
    baslangicAt: iso(r.baslangic_at),
    enGecBitis: iso(r.en_gec_bitis),
    onayHedefi: r.onay_hedefi,
    hedefTuru: r.hedef_turu || 'sunucu',
    onaylananTurler: turlerApi(r.onaylanan_turler),
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    iptalEden: r.iptal_eden ?? null,
    iptalAt: iso(r.iptal_at),
    bitisAt: iso(r.bitis_at),
    sonHata: r.son_hata ?? null,
    dinlenmeKosuId: r.dinlenme_kosu_id == null ? null : Number(r.dinlenme_kosu_id),
    dinlenmeBitis: iso(r.dinlenme_bitis),
    duraklatAt: iso(r.duraklat_at),
    duraklatan: r.duraklatan ?? null,
    ogeSayisi: r.oge_sayisi == null ? null : Number(r.oge_sayisi),
    bitenSayisi: r.biten_sayisi == null ? null : Number(r.biten_sayisi),
  };
}

function ogeApi(r) {
  const g = jsonOku(r.govde, {}) || {};
  return {
    id: Number(r.id),
    sira: Number(r.sira),
    etiket: r.etiket,
    durum: r.durum,
    asama: r.asama ?? null,
    onKontrolKosuId: r.on_kontrol_kosu_id == null ? null : Number(r.on_kontrol_kosu_id),
    kosuId: r.kosu_id == null ? null : Number(r.kosu_id),
    neden: r.neden ?? null,
    butceSn: r.butce_sn == null ? null : Number(r.butce_sn),
    uyariTurleri: turlerApi(r.uyari_turleri),
    baslamaAt: iso(r.baslama_at),
    bitisAt: iso(r.bitis_at),
    ayar: { senaryoId: g.senaryoId ?? null, hedefIp: g.hedefIp ?? null, hedefHost: g.hedefHost ?? null, vhost: g.vhost ?? null, yukHost: g.yukHost ?? null, sni: g.sni === true, parametreler: g.parametreler ?? null },
  };
}

/**
 * Tahmini zamanlama (gosterim): her bekleyen oge icin baslangic / bitis ve "siradaki ... sonra". Sunucu
 * saatiyle; DB'nin kalan saniyeleri (baslangic_kalan_sn, dinlenme_kalan_sn) kullanilir. Kilit beklemesi
 * BILINMEZ (tahmine girmez). Duraklatilmis kuyrukta devam saati bilinmez: bekleyen ogeye tahmin, siradaki sayaci ve
 * tahmini bitis yok (suren oge kendi tahminini tasir).
 */
function zamanlama(k, ogeler, simdiMs = Date.now()) {
  const bekleme = Number(k.bekleme_dk || BEKLEME_VARSAYILAN_DK) * 60;
  const out = new Map();
  let t = simdiMs / 1000;
  let siradakiKalanSn = null;
  const kalanBas = sayiOf(k.baslangic_kalan_sn);
  if (k.durum === 'BEKLIYOR' && kalanBas !== null && kalanBas > 0) {
    t += kalanBas;
    siradakiKalanSn = kalanBas;
  }
  if (k.durum === 'DINLENME') {
    const kd = sayiOf(k.dinlenme_kalan_sn);
    const ek = k.dinlenme_bitis == null ? bekleme : Math.max(0, kd ?? 0);
    t += ek;
    siradakiKalanSn = k.dinlenme_bitis == null ? null : Math.max(0, kd ?? 0);
  }
  let yukVar = false;
  const calisan = ogeler.find((o) => o.durum === 'CALISIYOR');
  if (calisan) {
    const bas = calisan.baslama_at ? new Date(calisan.baslama_at).getTime() / 1000 : t;
    const bit = Math.max(t, bas + ON_KONTROL_PAY_SN + (sayiOf(calisan.butce_sn) || 0));
    out.set(Number(calisan.id), { tahminiBaslangic: new Date(bas * 1000).toISOString(), tahminiBitis: new Date(bit * 1000).toISOString() });
    t = bit;
    yukVar = true;
  }
  const bitisMs = k.en_gec_bitis ? new Date(k.en_gec_bitis).getTime() : null;
  const aktif = AKTIF_KUYRUK.has(k.durum);
  if (k.duraklat_at != null) return { ogeler: out, tahminiBitis: null, siradakiKalanSn: null };
  for (const o of ogeler) {
    if (o.durum !== 'BEKLIYOR' || !aktif) continue;
    if (yukVar) t += bekleme;
    const bas = t;
    t += ON_KONTROL_PAY_SN + (sayiOf(o.butce_sn) || 0);
    out.set(Number(o.id), {
      tahminiBaslangic: new Date(bas * 1000).toISOString(),
      tahminiBitis: new Date(t * 1000).toISOString(),
      sureYetmeyebilir: bitisMs != null && t * 1000 > bitisMs,
    });
    yukVar = true;
  }
  return { ogeler: out, tahminiBitis: aktif && out.size ? new Date(t * 1000).toISOString() : null, siradakiKalanSn };
}

module.exports = {
  KUYRUK_DURUMLARI,
  OGE_DURUMLARI,
  BEKLEME_VARSAYILAN_DK,
  BEKLEME_MIN_DK,
  BEKLEME_MAX_DK,
  MAX_OGE,
  ETIKET_MAX,
  ON_KONTROL_PAY_SN,
  HAZIRLIK_PAY_SN,
  hazirlikPayiSn,
  ON_KONTROL_TAZE_SN,
  GECICI_DENEME_SINIRI,
  GERI_CEKILME_SN,
  KUYRUK_HATA_SINIRI,
  KIRA_SN,
  SQL,
  siraSql,
  SIRA_TABAN_SQL,
  uyariNormal,
  uyariTuru,
  uyariTurleri,
  yeniTurler,
  uyariKarariOf,
  kuyrukGovdesi,
  ogeEtiketi,
  turKodlari,
  AKTIF_KUYRUK,
  kosuEtiketi,
  hataSinifi,
  onayHedefiOf,
  kosuDurduruldu,
  hedefKilitAnahtari,
  kuyrukIsle,
  tick,
  tickSaniye,
  startKuyruk,
  kuyrukApi,
  ogeApi,
  zamanlama,
  _durdurForTest: () => {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _ticking = false;
  },
};
