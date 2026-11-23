// server/spa-report/paket-kurulum.cjs - Intranet SPA paket kurulumu (2026-11-23).
//
// Kullanici: "Intranet SPA'lerimdeki eksik paketlerin Nginx'lere gelmesinde maalesef yeterince hizli degiliz.
// o yuzden gecisleri beklemeden paketleri Artifactory'den sunucuya cekmek istiyorum."
//
// UCLAR (/api/spa-report altinda; intranet router'i requireAuth + requireVisible('ArkIntranetSpa') uygular,
// burada her uc AYRICA requireAdmin):
//   GET  /intranet/paket/adaylar[?fresh=1]       kurulabilecek uygulamalar (aday hesabi, asagida)
//   POST /intranet/paket/kur                      plan ya da uygula isi (AWX spa_package_install)
//   GET  /intranet/paket/is/:serverId/:jobId      isin durumu; bitince sonuc spa_paket_kurulum tablosuna
//
// ADAY = Intranet SPA raporunun (intranet.cjs loadIntranet) satiri; yalniz env 'PROD' ve kurulum.durum 'yok'
// (kismi DEGIL: kismi kurulumun uzerine yazilmaz). Hedef sunucular = TARANAN ve status 'YOK' PROD intranet
// sunuculari; taranmayan sunucu bilgi olarak listelenir (oraya kurulmaz).
// SURUM = OCP'de kosan imajin etiketi: Application Hub saatlik filo taramasi + elle canli okuma (filo.birlestir),
// yalniz uygulamanin PROD cluster'larinda (Portal cluster katalogunda env 'PROD' ve platform 'ark'), ayni
// namespace'te, basarili okumalar. Ana nesnenin (Deployment / Rollout) imaji <namespace>/<uygulama>:<etiket>
// olmali. Prod cluster'lari arasinda etiket farkliysa kurulmaz (hangisi dogru bilinmiyor).
// BASTIONSUZ (2026-11-23 kullanici karari "A": bastion'lara ve Nginx'lere birlikte baglanan ortak AWX envanteri
// yok): playbook OCP'yi OKUMAZ, surumu teyit edemez. Bu yuzden kullanilan PROD okumasi 3 saatten eskiyse
// 'bayat' ENGELDIR (saatlik tarama ya da canli okuma beklenir).
// APPLICATION.JSON = uygulamanin route'u uzerinden https://<route host>/config (pod'daki nginx ayni
// configuration_template ile config.json = ConfigMap application.json sunar). Nginx sunucusu kendisi ceker;
// Portal kalem basina config_urls gonderir (en cok 3, tekil): yalniz uygulamanin PROD cluster'indaki SPA
// route'larinin adresleri; baska bir uygulamayla paylasilan adres (yol tabanli route olabilir) alinmaz;
// intranet (reencrypt) route'u once. Elenen adres sayisi 'config-adresi-elendi' (bilgi); adres kalmazsa
// 'config-adresi-yok' engeli. config_urls is gecmisine / denetime YAZILMAZ (kalem kimligi yeter).
//
// GUVEN: POST istemcinin gonderdigi surum / sunucu / cluster'i KULLANMAZ; adaylari yeniden hesaplar ve yalniz
// (namespace, application) secimini alir. Uygulamak icin onay kutusuna 'PROD' yazilir (Smart yok, kullanici
// karari). Is sahipligi ansible_job_history kaydindan (sablon adi + params) dogrulanir.
//
// UYGULA PLANA BAGLIDIR: apply govdesi plan {serverId, jobId} tasir. Plan ayni kullanicinin, en cok 2 saat
// once baslamis, bitmis ve sonucu okunmus plan isi olmali; secim planin kalemlerinin alt kumesi, kalemin taze
// surumu plandakiyle ayni olmali; kalem yalniz planda PLAN_OK olan ve hala hedef olan sunuculara kurulur
// (PLAN_OK sunucusu kalmayan kalem gonderilmez). ESZAMANLI IS: son 3 saatte baslamis ve secimle kesisen
// bitmemis kurulum isi varsa (ya da durumu okunamazsa) yeni is baslatilmaz. YAKIN KURULUM: son 24 saatte
// apply OK yazilmis (ns, app, sunucu) hedeften cikar (aday listesi gece dizin taramasina kadar 'yok' der).
'use strict';

const { imajCoz } = require('../../shared/ocpImaj.cjs');

const REGISTRY_KEY = 'spa_package_install';
const STATS_KEY = 'spa_package_install_result';
const PLATFORM = 'spa-package-install';
const TEMPLATE_ONEK = 'Intranet SPA paket kurulumu';
const PLAN_ADI = `${TEMPLATE_ONEK}: plan`;
const KALEM_TAVAN = 10;
const HOST_TAVAN = 8;
const SAAT_MS = 60 * 60 * 1000;
const BAYAT_MS = 3 * SAAT_MS;
const PLAN_OMRU_MS = 2 * SAAT_MS;
// Pencere bir isin en kotu suresinden (10 kalem x (indirme + 3600 sn)) uzun: daha eski isler bitmis sayilir.
const ESZAMANLI_MS = 24 * SAAT_MS;
const YAKIN_KURULUM_MS = 24 * SAAT_MS;
const ONBELLEK_MS = 60 * 1000;
const PARALEL = 6;
const CONFIG_ADRES_TAVAN = 3;
const MESAJ_TAVAN = 1000;

/** Sunucunun urettigi tum uyari kodlari (ekran: src/api/arkSpaApi.ts PAKET_UYARI_KODLARI ile birebir). */
const UYARI_KODLARI = Object.freeze([
  'ad-gecersiz',
  'katalog-yok',
  'surum-yok',
  'surum-farkli',
  'imaj-yolu-farkli',
  'etiketsiz',
  'bayat',
  'config-adresi-yok',
  'config-adresi-elendi',
  'hedef-yok',
  'hedef-fazla',
  'taranmayan',
  'yakin-zamanda-kuruldu',
]);
const UYARI_KUMESI = new Set(UYARI_KODLARI);

const NS_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const APP_RE = /^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$/;
const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE = /^[A-Z0-9-]{3,32}$/;
// Route host'u: playbook girdi kapisi (spi_config_url_re) ve spa_package_host.sh ile ayni desen
// (https://<host>/config). En az bir nokta ve harfle baslayan son etiket: IP literal'i, localhost ve
// tek etiketli ad gecmez (ic adrese istek gitmesin). Uzunluk ayrica en cok 253.
const ROUTE_HOST_RE = /^([A-Za-z0-9-]{1,63}[.])+[A-Za-z][A-Za-z0-9-]{0,62}$/;
const ROUTE_HOST_TAVAN = 253;
const SONUC_DURUM = new Set(['PLAN_OK', 'OK', 'SKIP', 'FAIL']);
const BITTI = new Set(['successful', 'failed', 'error', 'canceled']);

const T = (s) => String(s == null ? '' : s).trim();
const L = (s) => T(s).toLowerCase();
const U = (s) => T(s).toUpperCase();
const anahtar = (ns, app) => `${L(ns)}/${L(app)}`;
const hata = (status, metin) => Object.assign(new Error(metin), { status });

function uyari(kod, metin, engel) {
  if (!UYARI_KUMESI.has(kod)) throw new Error(`Bilinmeyen paket uyari kodu: ${kod}`);
  return { kod, metin, engel };
}

/** Ayni kodun (cluster basina) tekrarlarini tek uyarida birlestirir; engel herhangi birinde varsa engel. */
function uyarilariBirlestir(uyarilar) {
  const ix = new Map();
  for (const u of uyarilar) {
    const v = ix.get(u.kod);
    if (!v) ix.set(u.kod, { ...u });
    else {
      v.metin = `${v.metin}; ${u.metin}`;
      v.engel = v.engel || u.engel;
    }
  }
  return [...ix.values()];
}

/** Zaman damgasi pencerenin icinde mi; okunamayan zaman icerde sayilir (guvenli taraf). */
function pencerede(zaman, ms, simdi) {
  const t = zaman ? new Date(zaman).getTime() : Number.NaN;
  return Number.isNaN(t) || simdi - t <= ms;
}

let _onbellek = { at: 0, deger: null };
function onbellekSil() {
  _onbellek = { at: 0, deger: null };
}

// ── Aday hesabi ────────────────────────────────────────────────────────────────

/** Satirin ark cluster'lari -> katalogdaki PROD karsiliklari + katalogda olmayanlar. */
function prodClusterlari(clusters, katalog) {
  const { platformOfCluster } = require('../audit/ocp-platforms.cjs');
  const prod = [];
  const katalogYok = [];
  // Satirdaki adiyla (kucuk harf) PROD cluster'lar: /config adresi yalniz bunlarin route'larindan.
  const prodAdlari = new Set();
  for (const c of clusters || []) {
    if (platformOfCluster(c) !== 'ark') continue;
    const girdiler = katalog.get(L(c)) || [];
    if (!girdiler.length) katalogYok.push(T(c));
    const p = girdiler.find((g) => U(g.env) === 'PROD');
    if (p) {
      prod.push({ cluster: p.ad, ortam: p.env, tenant: p.tenant });
      prodAdlari.add(L(c));
    }
  }
  return { prod, katalogYok, prodAdlari };
}

function katalogUyarisi(prod, katalogYok, katalogHata) {
  if (katalogHata) return uyari('katalog-yok', `Cluster kataloğu okunamadı: ${katalogHata}`, true);
  if (!prod.length)
    return uyari('katalog-yok', "Uygulamanın kataloğunda PROD ortamlı ARK cluster'ı yok.", true);
  // Katalogda olmayan cluster'in ortami bilinmez; okumasi surum hesabina girmez (bilgi, engel degil).
  if (katalogYok.length)
    return uyari(
      'katalog-yok',
      `Portal cluster kataloğunda olmayan cluster (sürüm hesabına girmedi): ${katalogYok.join(', ')}`,
      false,
    );
  return null;
}

/** Tek okumanin kosan surumu: ana nesnenin <ns>/<app>:<etiket> imaji. */
function okumaSurumu(okuma, ns, app) {
  const temel = { cluster: T(okuma.cluster), alinma: okuma.alinma || null };
  const ana = require('../app-hub/filo.cjs').anaNesne(okuma.nesneler);
  const imajlar = (ana?.containerlar || []).map((c) => c.imaj).filter(Boolean);
  const eslesenler = imajlar.filter((i) => {
    const p = imajCoz(i);
    return L(p.namespace) === L(ns) && L(p.uygulama) === L(app);
  });
  const eslesen = eslesenler[0];
  // Uygulama imaji ana nesnenin birden cok container'inda farkli etiketle kosuyorsa hangi paketin
  // kurulacagi belli degil: surum verilmez (surum-farkli engeli).
  const etiketler = [...new Set(eslesenler.map((i) => imajCoz(i).etiket || i))];
  if (etiketler.length > 1)
    return {
      ...temel,
      hata: uyari(
        'surum-farkli',
        `${temel.cluster}: uygulama imajı birden çok etiketle koşuyor (${etiketler.join(', ')})`,
        true,
      ),
    };
  if (!eslesen) {
    const liste = imajlar.join(', ') || 'imaj yok';
    return { ...temel, hata: uyari('imaj-yolu-farkli', `${temel.cluster}: ${liste}`, true) };
  }
  const p = imajCoz(eslesen);
  if (p.digest || !p.etiket)
    return {
      ...temel,
      hata: uyari('etiketsiz', `${temel.cluster}: ${eslesen} (digest ya da etiket yok)`, true),
    };
  if (!VER_RE.test(p.etiket))
    return {
      ...temel,
      hata: uyari('etiketsiz', `${temel.cluster}: etiket paket sürümü biçimine uymuyor`, true),
    };
  return { ...temel, imaj: eslesen, etiket: p.etiket, hata: null };
}

function enYeni(liste) {
  return liste.reduce(
    (a, s) => (!a || String(s.alinma || '') > String(a.alinma || '') ? s : a),
    null,
  );
}

function bayatMi(alinma, simdi) {
  const t = alinma ? Date.parse(alinma) : Number.NaN;
  return Number.isNaN(t) || simdi - t > BAYAT_MS;
}

/** Okumalardan surum; uyarilar engelleri tasir. */
function surumHesapla(okumalar, prod, ns, app, simdi) {
  const prodIx = new Map(prod.map((p) => [L(p.cluster), p]));
  const ilgili = (okumalar || []).filter(
    (o) => o?.ok && L(o.namespace) === L(ns) && prodIx.has(L(o.cluster)),
  );
  if (!ilgili.length)
    return {
      uyarilar: [uyari('surum-yok', "PROD cluster'larında başarılı OpenShift okuması yok.", true)],
    };
  const sonuclar = ilgili.map((o) => okumaSurumu(o, ns, app));
  const uyarilar = sonuclar.filter((s) => s.hata).map((s) => s.hata);
  const gecerli = sonuclar.filter((s) => s.etiket);
  const etiketler = [...new Set(gecerli.map((s) => s.etiket))];
  if (etiketler.length > 1)
    uyarilar.push(
      uyari(
        'surum-farkli',
        `PROD cluster'larında farklı sürümler: ${gecerli.map((s) => s.cluster + '=' + s.etiket).join(', ')}`,
        true,
      ),
    );
  const okunan = new Set(ilgili.map((o) => L(o.cluster)));
  const okunmayan = prod.filter((p) => !okunan.has(L(p.cluster))).map((p) => p.cluster);
  if (okunmayan.length)
    uyarilar.push(
      uyari('surum-yok', `Okuması olmayan PROD cluster: ${okunmayan.join(', ')}`, false),
    );
  const son = enYeni(gecerli);
  if (!son) return { uyarilar };
  if (bayatMi(son.alinma, simdi))
    uyarilar.push(
      uyari(
        'bayat',
        `Son PROD okuması ${son.alinma || '?'} (3 saatten eski); playbook sürümü yeniden okumadığı için saatlik tarama ya da canlı okuma bekleniyor.`,
        true,
      ),
    );
  const yer = prodIx.get(L(son.cluster));
  return { surum: son.etiket, imaj: son.imaj, alinma: son.alinma, yer, uyarilar };
}

/** Son 24 saatte kurulan sunucular hedeften cikar; hepsi cikarsa engel (tekrar kurulum onlenir). */
function yakinUyarisi(cikan, yakin, hedefKaldi) {
  if (!cikan.length) return null;
  const son = cikan
    .map((h) => yakin.get(h))
    .reduce((a, z) => (!a || String(z) > String(a) ? z : a), null);
  return uyari(
    'yakin-zamanda-kuruldu',
    `son kurulum ${son || '?'}; dizin taraması bekleniyor (${cikan.join(', ')})`,
    !hedefKaldi,
  );
}

function hedefUyarilari(hedefler, taranmayan, cikan, yakin) {
  const u = [];
  const yu = yakinUyarisi(cikan, yakin, hedefler.length > 0);
  if (yu) u.push(yu);
  else if (!hedefler.length)
    u.push(
      uyari('hedef-yok', 'Kurulacak (taranmış, izi olmayan) PROD intranet sunucusu yok.', true),
    );
  if (hedefler.length > HOST_TAVAN)
    u.push(
      uyari(
        'hedef-fazla',
        `Hedef sunucu ${hedefler.length}; iş başına en çok ${HOST_TAVAN}.`,
        true,
      ),
    );
  if (taranmayan.length)
    u.push(uyari('taranmayan', `Taranmayan sunucu (kurulmaz): ${taranmayan.join(', ')}`, false));
  return u;
}

function adGecerliMi(ns, app) {
  return NS_RE.test(ns) && APP_RE.test(app);
}

/** Adresin route termination'ina gore sirasi: intranet (reencrypt) once, yalniz internet sona. */
function adresSirasi(terms) {
  if (terms.includes('reencrypt')) return 0;
  if (terms.length && terms.every((t) => t === 'passthrough')) return 2;
  return 1;
}

/**
 * Rapor satirinin route ayrintisindan (routeDetay) /config adresleri. Alinan adres:
 *   - gecerli host (ROUTE_HOST_RE, en cok 253), kucuk harf, tekil;
 *   - en az bir SPA route'u (nginx bulunmus) ve en az bir PROD cluster'da (katalog);
 *   - PAYLASILAN DEGIL: baska bir (ns, uygulama) satirinda da gorunen adres yol tabanli route olabilir,
 *     /config baska uygulamanin icerigini dondurur (yanlis application.json) - alinmaz.
 * Sira: intranet (reencrypt) route'u once, yalniz internet (passthrough) olan sonra; en cok 3.
 * Elenenler neden basina sayilir (adres YAZILMAZ).
 */
function configAdresleri(detay, prodAdlari) {
  const elenen = { gecersiz: 0, spaDegil: 0, prodDisi: 0, paylasilan: 0 };
  const adaylar = [];
  const gorulen = new Set();
  for (const d of detay || []) {
    const h = L(d?.host);
    if (!h || gorulen.has(h)) continue;
    gorulen.add(h);
    const clusters = (d.clusters || []).map(L);
    let neden = null;
    if (h.length > ROUTE_HOST_TAVAN || !ROUTE_HOST_RE.test(h)) neden = 'gecersiz';
    else if (d.paylasilan) neden = 'paylasilan';
    else if (!d.spa) neden = 'spaDegil';
    else if (!clusters.some((c) => prodAdlari?.has(c))) neden = 'prodDisi';
    if (neden) elenen[neden] += 1;
    else adaylar.push({ h, sira: adresSirasi((d.terms || []).map(L)) });
  }
  adaylar.sort((x, y) => x.sira - y.sira);
  return {
    urls: adaylar.slice(0, CONFIG_ADRES_TAVAN).map((a) => `https://${a.h}/config`),
    elenen,
  };
}

/** Elenen adresler bilgi uyarisi (engel degil; adres kalmadiysa engel config-adresi-yok). */
function elenenUyarisi(elenen) {
  const parca = [
    ['paylasilan', 'başka uygulamayla paylaşılan adres'],
    ['prodDisi', "PROD dışı cluster'da"],
    ['spaDegil', 'SPA olmayan route'],
    ['gecersiz', 'geçersiz adres'],
  ]
    .filter(([k]) => elenen[k])
    .map(([k, ad]) => `${ad} ${elenen[k]}`);
  if (!parca.length) return null;
  return uyari(
    'config-adresi-elendi',
    `/config için denenmeyen route adresi: ${parca.join(', ')}`,
    false,
  );
}

/** Rapor satiri -> aday (ic alan _configUrls kaleme gider; yanitta atilir). */
function adayKur(row, ctx) {
  const ns = T(row.namespace);
  const app = T(row.application);
  const k = row.kurulum || {};
  const yakin = ctx.yakin?.get(anahtar(ns, app)) || new Map();
  const tumHedefler = (k.sunucular || [])
    .filter((s) => s.status === 'YOK')
    .map((s) => U(s.host))
    .filter((h) => HOST_RE.test(h));
  const hedefler = tumHedefler.filter((h) => !yakin.has(h));
  const cikan = tumHedefler.filter((h) => yakin.has(h));
  const taranmayan = (k.taranmayan || []).map(U);
  const { prod, katalogYok, prodAdlari } = prodClusterlari(row.clusters, ctx.katalog);
  const uyarilar = [];
  if (!adGecerliMi(ns, app))
    uyarilar.push(
      uyari('ad-gecersiz', 'Namespace ya da uygulama adı paket yolu biçiminde değil.', true),
    );
  const ku = katalogUyarisi(prod, katalogYok, ctx.katalogHata);
  if (ku) uyarilar.push(ku);
  const s = surumHesapla(ctx.okumalar, prod, ns, app, ctx.simdi);
  uyarilar.push(...s.uyarilar);
  const { urls: configUrls, elenen } = configAdresleri(row.routeDetay, prodAdlari);
  if (!configUrls.length)
    uyarilar.push(
      uyari(
        'config-adresi-yok',
        "Uygulamanın PROD cluster'da kendine ait SPA route adresi yok: application.json OpenShift'teki /config'ten çekilemez.",
        true,
      ),
    );
  const eu = elenenUyarisi(elenen);
  if (eu) uyarilar.push(eu);
  uyarilar.push(...hedefUyarilari(hedefler, taranmayan, cikan, yakin));
  const birlesik = uyarilariBirlestir(uyarilar);
  const kurulabilir = !birlesik.some((x) => x.engel) && !!s.surum && !!s.yer;
  return {
    namespace: ns,
    application: app,
    env: 'PROD',
    surum: s.surum || null,
    imaj: s.imaj || null,
    cluster: s.yer ? s.yer.cluster : null,
    clusters: prod.map((p) => p.cluster),
    alinma: s.alinma || null,
    hedefler,
    taranmayan,
    uyarilar: birlesik,
    kurulabilir,
    sonDeneme: ctx.sonDeneme || null,
    _configUrls: configUrls,
  };
}

async function okumalariOku(app) {
  const C = require('../app-hub/canli.cjs');
  const F = require('../app-hub/filo.cjs');
  const [canli, saatlik] = await Promise.all([
    C.sonOkumalar(app).catch(() => []),
    F.filoOkumalari(app).catch(() => []),
  ]);
  return F.birlestir(canli, saatlik);
}

async function katalogOku() {
  try {
    return { katalog: await require('../app-hub/veri.cjs').clusterIndeksi(), katalogHata: null };
  } catch (e) {
    return { katalog: new Map(), katalogHata: String(e?.message || e).slice(0, 200) };
  }
}

/** Son denemeler: (ns, app) basina en son isin tum sunucu satirlari. Okunamazsa bos (bilgi). */
async function sonDenemeleriOku() {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT k.namespace, k.application, k.server_id, k.job_id, k.mod, k.host, k.status, k.message, k.kullanici, k.zaman
       FROM spa_paket_kurulum k
       JOIN (SELECT namespace, application, MAX(id) AS mid FROM spa_paket_kurulum GROUP BY namespace, application) m
         ON m.namespace = k.namespace AND m.application = k.application
       JOIN spa_paket_kurulum s ON s.id = m.mid
      WHERE k.server_id = s.server_id AND k.job_id = s.job_id
      ORDER BY k.id`,
  );
  const ix = new Map();
  for (const r of rows || []) {
    const key = anahtar(r.namespace, r.application);
    if (!ix.has(key))
      ix.set(key, {
        zaman: r.zaman ? new Date(r.zaman).toISOString() : null,
        kullanici: r.kullanici || null,
        mod: r.mod,
        jobId: Number(r.job_id),
        serverId: Number(r.server_id),
        sunucular: [],
      });
    ix.get(key).sunucular.push({ host: r.host, status: r.status, message: r.message || '' });
  }
  return ix;
}

/**
 * Son 24 saatte apply OK yazilmis (ns, app) -> Map(sunucu -> zaman). Okunamazsa hata yukari cikar
 * (bos sayilmaz: yeniden kurulumu onleyen kapi).
 */
async function yakinKurulumlariOku(simdi) {
  const { rows } = await require('../db/index.cjs').query(
    `SELECT namespace, application, host, MAX(zaman) AS zaman
       FROM spa_paket_kurulum
      WHERE mod = 'apply' AND status = 'OK' AND zaman >= DATEADD(HOUR, -24, SYSUTCDATETIME())
      GROUP BY namespace, application, host`,
  );
  const ix = new Map();
  for (const r of rows || []) {
    if (!r.host || !pencerede(r.zaman, YAKIN_KURULUM_MS, simdi)) continue;
    const key = anahtar(r.namespace, r.application);
    if (!ix.has(key)) ix.set(key, new Map());
    const t = r.zaman ? new Date(r.zaman).toISOString() : null;
    ix.get(key).set(U(r.host), t);
  }
  return ix;
}

/** Tum aday hesabi. deps.loadIntranet(fresh) intranet raporunu verir. */
async function hesapla(deps, fresh) {
  const simdi = Date.now();
  if (!fresh && _onbellek.deger && simdi - _onbellek.at < ONBELLEK_MS) return _onbellek.deger;
  const rapor = await deps.loadIntranet(fresh);
  const rows = (rapor.rows || []).filter((r) => r.env === 'PROD' && r.kurulum?.durum === 'yok');
  const { katalog, katalogHata } = await katalogOku();
  const sonDenemeler = await sonDenemeleriOku().catch(() => new Map());
  const yakin = await yakinKurulumlariOku(simdi);
  const { sinirliParalel } = require('../app-hub/veri.cjs')._ic;
  const okumalar = await sinirliParalel(rows, PARALEL, (r) =>
    okumalariOku(T(r.application)).catch(() => []),
  );
  const adaylar = rows.map((r, i) =>
    adayKur(r, {
      katalog,
      katalogHata,
      okumalar: okumalar[i],
      simdi,
      yakin,
      sonDeneme: sonDenemeler.get(anahtar(r.namespace, r.application)),
    }),
  );
  const deger = {
    hesaplandi: new Date(simdi).toISOString(),
    dizinTarihi: rapor.dizinTarihi || null,
    dizinDurum: rapor.notScanned ? 'kesif-yok' : rapor.dizinDurum || null,
    adaylar,
  };
  _onbellek = { at: simdi, deger };
  return deger;
}

function disaVer(a) {
  const gorunen = { ...a };
  delete gorunen._configUrls;
  return gorunen;
}

// ── AWX ────────────────────────────────────────────────────────────────────────

/** AWX'e giden kalem (spi_items[]): kimlik + config_urls. cluster bilgi icindir, playbook kullanmaz. */
const kalem = (a) => ({
  id: `${a.namespace}/${a.application}`,
  namespace: a.namespace,
  application: a.application,
  version: a.surum,
  cluster: a.cluster,
  hosts: [...a.hedefler],
  config_urls: [...a._configUrls],
});

/** Is gecmisi / denetim / yanit icin kalem kimligi (config_urls yazilmaz). */
const kimlik = (k) => ({
  id: k.id,
  namespace: k.namespace,
  application: k.application,
  version: k.version,
  cluster: k.cluster,
  hosts: [...k.hosts],
});

/** Govde secimini dogrular. Donus: { secim } ya da { hata }. */
function secimDogrula(body) {
  const s = body && Array.isArray(body.secim) ? body.secim : null;
  if (!s?.length) return { hata: 'En az bir uygulama seçin.' };
  if (s.length > KALEM_TAVAN) return { hata: `Bir işte en çok ${KALEM_TAVAN} uygulama.` };
  const secim = s.map((x) => ({ namespace: T(x?.namespace), application: T(x?.application) }));
  if (secim.some((x) => !adGecerliMi(x.namespace, x.application)))
    return { hata: 'Geçersiz namespace ya da uygulama adı.' };
  if (new Set(secim.map((x) => anahtar(x.namespace, x.application))).size !== secim.length)
    return { hata: 'Aynı uygulama iki kez seçildi.' };
  return { secim };
}

/** Secimi taze aday hesabina esler; kurulabilir olmayanlar hata. */
function secimiEsle(secim, adaylar) {
  const ix = new Map(adaylar.map((a) => [anahtar(a.namespace, a.application), a]));
  const secilen = [];
  const red = [];
  for (const s of secim) {
    const a = ix.get(anahtar(s.namespace, s.application));
    if (a?.kurulabilir) secilen.push(a);
    else red.push(`${s.namespace}/${s.application}`);
  }
  return { secilen, red };
}

async function gecmisYaz(u, serverId, templateId, mod, job, items) {
  try {
    await require('../db/index.cjs').query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        u.username || 'unknown',
        serverId,
        templateId,
        `${TEMPLATE_ONEK}: ${mod === 'apply' ? 'uygula' : 'plan'}`,
        job?.jobId,
        job?.status || 'pending',
        JSON.stringify({ platform: PLATFORM, mode: mod, items }),
      ],
    );
    return null;
  } catch (e) {
    console.error('[IntranetSPA] paket kurulumu is gecmisi yazilamadi:', e.message);
    return `İş başladı ama iş geçmişine yazılamadı (${e.message}): bu iş eşzamanlı iş denetiminde ve sonuç ekranında görünmez; bitene kadar aynı uygulamada yeni iş başlatmayın, sonucu AWX'ten izleyin.`;
  }
}

function denetle(req, eylem, detay) {
  try {
    require('../audit/index.cjs').auditPortal(req, eylem, { detail: JSON.stringify(detay) });
  } catch {
    /* best-effort */
  }
}

// ── Is sonucu ──────────────────────────────────────────────────────────────────

async function isSahipligi(serverId, jobId) {
  const { rows } = await require('../db/index.cjs').query(
    `SELECT TOP 2 template_id, template_name, params, username, started_at
       FROM ansible_job_history
      WHERE awx_server_id = $1 AND job_id = $2 AND template_name LIKE $3
      ORDER BY id DESC`,
    [serverId, jobId, `${TEMPLATE_ONEK}%`],
  );
  if (rows?.length !== 1) return null;
  let params = null;
  try {
    params = JSON.parse(rows[0].params);
  } catch {
    return null;
  }
  const templateId = Number(rows[0].template_id);
  if (
    params?.platform !== PLATFORM ||
    !Array.isArray(params.items) ||
    !Number.isInteger(templateId)
  )
    return null;
  if (params.mode !== 'plan' && params.mode !== 'apply') return null;
  return {
    templateId,
    mod: params.mode,
    items: params.items,
    kullanici: rows[0].username || null,
    sablonAdi: rows[0].template_name || '',
    baslangic: rows[0].started_at || null,
  };
}

function idKumesi(items) {
  return [...new Set((items || []).map((i) => T(i?.id)))].sort((a, b) => a.localeCompare(b));
}

function artifactEslesir(sonuc, sahiplik) {
  if (!sonuc || typeof sonuc !== 'object' || !Array.isArray(sonuc.items)) return false;
  if (sonuc.mode && sonuc.mode !== sahiplik.mod) return false;
  const a = idKumesi(sonuc.items);
  const b = idKumesi(sahiplik.items);
  return a.length === b.length && sonuc.items.length === a.length && a.every((x, i) => x === b[i]);
}

/** Planlanan her (kalem, sunucu) icin bir satir; artifact'te olmayan sunucu FAIL 'sonuc-yok'. */
function tabloSatirlari(sonuc, sahiplik) {
  const sonucIx = new Map(sonuc.items.map((i) => [T(i.id), i]));
  const satirlar = [];
  for (const p of sahiplik.items) {
    const r = sonucIx.get(T(p.id)) || {};
    const hostIx = new Map((r.hosts || []).map((h) => [U(h?.host), h]));
    for (const host of p.hosts || []) {
      const h = hostIx.get(U(host));
      const status = SONUC_DURUM.has(h?.status) ? h.status : 'FAIL';
      satirlar.push({
        namespace: T(p.namespace).slice(0, 63),
        application: T(p.application).slice(0, 253),
        version: T(p.version).slice(0, 128),
        cluster: T(p.cluster).slice(0, 100),
        host: U(host).slice(0, 64),
        status,
        step: T(h ? h.step : 'sonuc-yok').slice(0, 32),
        message: T(h ? h.message : 'Sunucu sonucu yayınlanmadı.').slice(0, MESAJ_TAVAN),
      });
    }
  }
  return satirlar;
}

/** Ayni (server, job) bir kez yazilir. Donus: yeni yazildiysa true. */
async function sonucYaz(serverId, jobId, sahiplik, satirlar) {
  if (!satirlar.length) return false;
  return require('../db/index.cjs').transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT TOP 1 id FROM spa_paket_kurulum WITH (UPDLOCK, HOLDLOCK) WHERE server_id = $1 AND job_id = $2`,
      [serverId, jobId],
    );
    if (rows.length) return false;
    await tx.query(
      `INSERT INTO spa_paket_kurulum (server_id, job_id, mod, namespace, application, version, cluster, host, status, step, message, kullanici)
       SELECT $1, $2, $3, j.namespace, j.application, j.version, j.cluster, j.host, j.status, j.step, j.message, $5
         FROM OPENJSON($4) WITH (
           namespace NVARCHAR(63) '$.namespace', application NVARCHAR(253) '$.application',
           version NVARCHAR(128) '$.version', cluster NVARCHAR(100) '$.cluster', host NVARCHAR(64) '$.host',
           status NVARCHAR(16) '$.status', step NVARCHAR(32) '$.step', message NVARCHAR(1000) '$.message'
         ) j`,
      [serverId, jobId, sahiplik.mod, JSON.stringify(satirlar), sahiplik.kullanici],
    );
    return true;
  });
}

// ── Plan baglama ve eszamanli is ───────────────────────────────────────────────

/** Govdedeki plan {serverId, jobId}; yoksa / gecersizse null. */
function planNumaralari(plan) {
  const serverId = Number(plan?.serverId);
  const jobId = Number(plan?.jobId);
  if (!Number.isInteger(serverId) || serverId < 0 || !Number.isInteger(jobId) || jobId <= 0)
    return null;
  return { serverId, jobId };
}

/** (ns/app) -> PLAN_OK sunucu kumesi. */
function planOkIndeksi(satirlar) {
  const ix = new Map();
  for (const s of satirlar) {
    const key = anahtar(s.namespace, s.application);
    if (!ix.has(key)) ix.set(key, new Set());
    if (s.status === 'PLAN_OK') ix.get(key).add(U(s.host));
  }
  return ix;
}

/** Plan isinin sunucu satirlari: tabloda varsa oradan; yoksa AWX artifact'inden okunur ve tabloya yazilir. */
async function planSatirlari(n, sahiplik) {
  const { rows } = await require('../db/index.cjs').query(
    `SELECT namespace, application, host, status FROM spa_paket_kurulum WHERE server_id = $1 AND job_id = $2`,
    [n.serverId, n.jobId],
  );
  if (rows?.length) return rows;
  let st;
  try {
    st = await require('../ansible/runner.cjs').getJobStatusOnServer(n.serverId, n.jobId);
  } catch (e) {
    throw hata(409, `Plan işinin durumu okunamadı: ${e?.message || e}`);
  }
  if (st?.templateId !== sahiplik.templateId)
    throw hata(409, 'Plan işinin AWX şablon kimliği iş geçmişiyle eşleşmiyor.');
  if (!BITTI.has(st.status)) throw hata(409, 'Plan işi henüz bitmedi.');
  const sonuc = require('../opsx/index.cjs').extractStatsKey(st.artifacts, STATS_KEY);
  if (!sonuc) throw hata(409, 'Plan işinin sonucu yayınlanmadı; yeniden planlayın.');
  if (!artifactEslesir(sonuc, sahiplik)) throw hata(409, 'Plan sonucu plan isteğiyle eşleşmiyor.');
  const satirlar = tabloSatirlari(sonuc, sahiplik);
  if (await sonucYaz(n.serverId, n.jobId, sahiplik, satirlar)) onbellekSil();
  return satirlar;
}

/** Apply'in dayandigi plani dogrular. Donus: { items: plan kalemleri, planOk: Map }. */
async function planiDogrula(n, ctx) {
  if (n.serverId !== ctx.serverId)
    throw hata(409, 'Plan başka bir AWX sunucusunda koşmuş; yeniden planlayın.');
  const sahiplik = await isSahipligi(n.serverId, n.jobId);
  if (!sahiplik) throw hata(404, 'Plan işi bulunamadı (Intranet SPA paket kurulumu planı değil).');
  if (sahiplik.mod !== 'plan' || sahiplik.sablonAdi !== PLAN_ADI)
    throw hata(409, 'Belirtilen iş bir plan işi değil.');
  if (sahiplik.kullanici !== ctx.kullanici) throw hata(409, 'Plan başka bir kullanıcıya ait.');
  if (sahiplik.templateId !== ctx.templateId)
    throw hata(409, 'Plan başka bir AWX şablonuyla koşmuş; yeniden planlayın.');
  const t = sahiplik.baslangic ? new Date(sahiplik.baslangic).getTime() : Number.NaN;
  if (Number.isNaN(t) || ctx.simdi - t > PLAN_OMRU_MS)
    throw hata(409, 'Plan 2 saatten eski; yeniden planlayın.');
  const satirlar = await planSatirlari(n, sahiplik);
  return { items: sahiplik.items, planOk: planOkIndeksi(satirlar) };
}

/**
 * Taze kalemleri plana baglar: secim plan kalemlerinin alt kumesi, surum ayni, sunucular PLAN_OK ile taze
 * hedeflerin kesisimi; PLAN_OK sunucusu kalmayan kalem cikar. Donus: gonderilecek kalemler (sirasi korunur).
 */
function planaBagla(kalemler, plan) {
  const planIx = new Map((plan.items || []).map((p) => [anahtar(p?.namespace, p?.application), p]));
  const disarida = kalemler.filter((k) => !planIx.has(anahtar(k.namespace, k.application)));
  if (disarida.length)
    throw hata(409, `Planda olmayan seçim: ${disarida.map((k) => k.id).join(', ')}`);
  const sonuc = [];
  for (const k of kalemler) {
    const key = anahtar(k.namespace, k.application);
    const p = planIx.get(key);
    if (T(p.version) !== k.version)
      throw hata(
        409,
        `${k.id}: sürüm plandan sonra değişti (plan ${T(p.version)}, şimdi ${k.version}); yeniden planlayın.`,
      );
    const ok = plan.planOk.get(key) || new Set();
    const hosts = k.hosts.filter((h) => ok.has(U(h)));
    if (hosts.length) sonuc.push({ ...k, hosts });
  }
  if (!sonuc.length) throw hata(409, 'Planda PLAN_OK sunucusu kalan kalem yok; yeniden planlayın.');
  return sonuc;
}

async function isBittiMi(serverId, jobId) {
  const { rows } = await require('../db/index.cjs').query(
    `SELECT TOP 1 1 AS var FROM spa_paket_kurulum WHERE server_id = $1 AND job_id = $2`,
    [serverId, jobId],
  );
  if (rows?.length) return true;
  let st;
  try {
    st = await require('../ansible/runner.cjs').getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    throw hata(
      409,
      `Kurulum işi #${jobId} durumu AWX'ten okunamadı; eşzamanlı iş denetimi yapılamadığı için iş başlatılmadı: ${e?.message || e}`,
    );
  }
  if (!BITTI.has(st?.status)) return false;
  // Ekran yoklamadan kapanmis olabilir: bitmis isin sonucu burada da tabloya yazilir, yoksa
  // 24 saatlik yakin-kurulum kapisi bu sunuculari goremezdi.
  await sonucuSessizKaydet({ serverId, jobId }, st);
  return true;
}

/** Bitmis isin artifact'i sahiplik ve kalemlerle eslesiyorsa tabloya yazar; hata kapilari durdurmaz. */
async function sonucuSessizKaydet(n, st) {
  try {
    const sahiplik = await isSahipligi(n.serverId, n.jobId);
    if (!sahiplik || st?.templateId !== sahiplik.templateId) return;
    const sonuc = require('../opsx/index.cjs').extractStatsKey(st.artifacts, STATS_KEY);
    if (!sonuc || !artifactEslesir(sonuc, sahiplik)) return;
    if (await sonucYaz(n.serverId, n.jobId, sahiplik, tabloSatirlari(sonuc, sahiplik)))
      onbellekSil();
  } catch (e) {
    console.warn(`[IntranetSPA] is #${n.jobId} sonucu yazilamadi:`, e.message);
  }
}

/** Son 24 saatte baslamis, secimle kesisen ve bitmemis kurulum isi varsa 409. */
async function eszamanliIsDenetle(secim, simdi) {
  const istenen = new Set(secim.map((s) => anahtar(s.namespace, s.application)));
  const { rows } = await require('../db/index.cjs').query(
    `SELECT awx_server_id, job_id, params, started_at FROM ansible_job_history
      WHERE template_name LIKE $1 AND started_at >= DATEADD(HOUR, -24, GETUTCDATE())`,
    [`${TEMPLATE_ONEK}%`],
  );
  const isler = new Map();
  for (const r of rows || []) {
    if (!pencerede(r.started_at, ESZAMANLI_MS, simdi)) continue;
    let params = null;
    try {
      params = JSON.parse(r.params);
    } catch {
      continue;
    }
    if (params?.platform !== PLATFORM || !Array.isArray(params.items)) continue;
    const kesisir = params.items.some((i) => istenen.has(anahtar(i?.namespace, i?.application)));
    const jobId = Number(r.job_id);
    if (kesisir && Number.isInteger(jobId) && jobId > 0)
      isler.set(`${r.awx_server_id}|${jobId}`, { serverId: Number(r.awx_server_id), jobId });
  }
  for (const is of isler.values())
    if (!(await isBittiMi(is.serverId, is.jobId)))
      throw hata(409, `Bu uygulama için süren bir kurulum işi var (#${is.jobId}).`);
}

// ── Uclar ──────────────────────────────────────────────────────────────────────

// Gec require: auth modulu testlerde sahtelenir. Ad route-auth-order RO1b bekcisinin aradigi kapi adidir.
const requireAdmin = (req, res, next) => require('../auth/index.cjs').requireAdmin(req, res, next);

async function adaylarUcu(req, res, deps) {
  try {
    const d = await hesapla(deps, String(req.query.fresh || '') === '1');
    const adaylar = d.adaylar.map(disaVer);
    res.json({
      ok: true,
      hesaplandi: d.hesaplandi,
      dizinTarihi: d.dizinTarihi,
      dizinDurum: d.dizinDurum,
      ozet: { toplam: adaylar.length, kurulabilir: adaylar.filter((a) => a.kurulabilir).length },
      adaylar,
    });
  } catch (e) {
    console.error('[IntranetSPA] paket adaylari hatasi:', e.message);
    res.status(502).json({ ok: false, error: 'Paket adayları hesaplanamadı.' });
  }
}

async function kurUcu(req, res, deps) {
  const b = req.body || {};
  const sd = secimDogrula(b);
  if (sd.hata) return res.status(400).json({ ok: false, error: sd.hata });
  const uygula = b.apply === true;
  if (uygula && T(b.onayMetni) !== 'PROD')
    return res.status(428).json({ ok: false, error: 'Uygulamak için onay kutusuna PROD yazın.' });
  const planNo = uygula ? planNumaralari(b.plan) : null;
  if (uygula && !planNo)
    return res
      .status(400)
      .json({ ok: false, error: 'Uygulama bir plana bağlı olmalı: plan {serverId, jobId}.' });
  const { templateId, serverId, keyName } =
    await require('../app-hub/index.cjs').resolveByKey(REGISTRY_KEY);
  if (!templateId)
    return res.status(501).json({
      ok: false,
      error: `Paket kurulum playbook'u tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`,
    });
  let extraVars;
  try {
    const simdi = Date.now();
    const kullanici = req.session?.user?.username || 'unknown';
    const plan = planNo
      ? await planiDogrula(planNo, { serverId, templateId, kullanici, simdi })
      : null;
    await eszamanliIsDenetle(sd.secim, simdi);
    const d = await hesapla(deps, true);
    const es = secimiEsle(sd.secim, d.adaylar);
    if (es.red.length)
      return res
        .status(400)
        .json({ ok: false, error: `Kurulabilir değil: ${es.red.join(', ')}. Sayfayı yenileyin.` });
    const tumKalemler = es.secilen.map(kalem);
    const items = plan ? planaBagla(tumKalemler, plan) : tumKalemler;
    extraVars = { spi_mode: uygula ? 'apply' : 'plan', spi_items: items };
  } catch (e) {
    return res.status(e.status || 502).json({ ok: false, error: e.message });
  }
  return baslat(req, res, { serverId, templateId, extraVars, uygula });
}

async function baslat(req, res, { serverId, templateId, extraVars, uygula }) {
  const mod = extraVars.spi_mode;
  const items = extraVars.spi_items.map(kimlik);
  try {
    const tp = require('../ansible/template-preflight.cjs');
    await tp.assertRegistryPlaybook(serverId, templateId, REGISTRY_KEY);
    await tp.assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, {
      label: REGISTRY_KEY,
    });
    const u = req.session?.user || {};
    const job = await require('../ansible/runner.cjs').launchJobOnServer(
      serverId,
      templateId,
      extraVars,
      '',
      u,
    );
    const gecmisHatasi = await gecmisYaz(u, serverId, templateId, mod, job, items);
    denetle(req, uygula ? 'spa_paket_kurulum_uygula' : 'spa_paket_kurulum_plan', {
      items,
      serverId,
      jobId: job?.jobId || null,
      ...(gecmisHatasi ? { gecmisYazilamadi: true } : {}),
    });
    res.json({
      ok: true,
      serverId,
      jobId: job?.jobId || null,
      mod,
      items,
      ...(gecmisHatasi ? { uyari: gecmisHatasi } : {}),
    });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
}

function isNumaralari(req) {
  const serverId = Number(req.params.serverId);
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(serverId) || serverId < 0 || !Number.isInteger(jobId) || jobId <= 0)
    return null;
  return { serverId, jobId };
}

async function isUcu(req, res, deps) {
  const n = isNumaralari(req);
  if (!n) return res.status(400).json({ ok: false, error: 'Geçersiz iş numarası.' });
  let sahiplik;
  try {
    sahiplik = await isSahipligi(n.serverId, n.jobId);
  } catch (e) {
    return res.status(424).json({ ok: false, error: `İş kaydı okunamadı: ${e?.message || e}` });
  }
  if (!sahiplik)
    return res
      .status(404)
      .json({ ok: false, error: 'Bu iş bir Intranet SPA paket kurulumu işi değil.' });
  try {
    const st = await require('../ansible/runner.cjs').getJobStatusOnServer(n.serverId, n.jobId);
    if (!Number.isInteger(st.templateId) || st.templateId !== sahiplik.templateId)
      return res
        .status(409)
        .json({ ok: false, error: 'AWX iş şablonu kimliği iş geçmişiyle eşleşmiyor.' });
    if (!BITTI.has(st.status)) return res.json({ ok: true, status: st.status, finished: false });
    return bitmisIs(res, deps, n, sahiplik, st);
  } catch (e) {
    res.status(502).json({ ok: false, error: `İş durumu okunamadı: ${e?.message || e}` });
  }
}

async function bitmisIs(res, deps, n, sahiplik, st) {
  const sonuc = require('../opsx/index.cjs').extractStatsKey(st.artifacts, STATS_KEY);
  if (!sonuc) {
    const error =
      st.status === 'successful'
        ? "İş bitti ama sonuç yayınlanmadı (playbook'un set_stats adımı)."
        : 'İş başarısız oldu ve sonuç yayınlanmadı; AWX iş çıktısına bakın.';
    return res.json({ ok: true, status: st.status, finished: true, error });
  }
  if (!artifactEslesir(sonuc, sahiplik))
    return res.status(409).json({ ok: false, error: 'İş sonucu kurulum isteğiyle eşleşmiyor.' });
  const satirlar = tabloSatirlari(sonuc, sahiplik);
  const yazildi = await sonucYaz(n.serverId, n.jobId, sahiplik, satirlar);
  if (yazildi) {
    onbellekSil();
    if (sahiplik.mod === 'apply' && satirlar.some((s) => s.status === 'OK'))
      deps.intranetOnbellekSil?.();
  }
  res.json({ ok: true, status: st.status, finished: true, sonuc });
}

/**
 * Uclari intranet router'ina baglar.
 * @param {import('express').Router} router
 * @param {{loadIntranet: (fresh: boolean) => Promise<object>, intranetOnbellekSil?: () => void}} deps
 */
function mount(router, deps) {
  router.get('/intranet/paket/adaylar', requireAdmin, (req, res) => adaylarUcu(req, res, deps));
  router.post('/intranet/paket/kur', requireAdmin, (req, res) => kurUcu(req, res, deps));
  router.get('/intranet/paket/is/:serverId/:jobId', requireAdmin, (req, res) =>
    isUcu(req, res, deps),
  );
}

module.exports = {
  mount,
  onbellekSil,
  REGISTRY_KEY,
  STATS_KEY,
  TEMPLATE_ONEK,
  KALEM_TAVAN,
  HOST_TAVAN,
  UYARI_KODLARI,
  _ic: {
    uyarilariBirlestir,
    planaBagla,
    adayKur,
    surumHesapla,
    prodClusterlari,
    okumaSurumu,
    secimDogrula,
    configAdresleri,
    tabloSatirlari,
    artifactEslesir,
  },
};
