// server/audit/nginx-host-labels.cjs - Nginx Hub > Envanter: sunucuya elle etiket (2026-11-12).
//
// Kullanici: "sunuculari istedigim gibi label'layabilir miyim? oto kesif yapmistik conf.d/ altindaki
// dosyalarin ismine bakiyorduk ama benim overwrite edebilecegim sekilde bir feature mi yapsak?"
//
// OTOMATIK KESIF: nginx_metadata betigi conf.d/*.conf adlarindan `services` yazar (5'ten fazlaysa
// 'too_many'). ELLE ETIKET Portal DB'de (nginx_host_labels) tutulur; TBMWANS tablosuna DOKUNULMAZ
// (her kosuda TRUNCATE edilir, elle deger orada yasayamaz). Iki kip:
//   degistir - otomatik listenin YERINE gecer (too_many dahil; kullanici tam listeyi verir)
//   ekle     - otomatik listeye eklenir (otomatik kesif surer, elle etiket ustune biner)
// Otomatik liste satirda `etiket.oto` olarak KALIR: ekran ikisini birlikte gosterir (elle deger
// otomatigi sessizce silmesin; kesif degisirse fark gorunsun).
'use strict';

const HOST_RE = /^[A-Z0-9._-]{1,64}$/;
const ETIKET_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MODLAR = new Set(['degistir', 'ekle']);
const EN_COK_ETIKET = 20;

function bol(v) {
  return String(v == null ? '' : v)
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Istek govdesini dogrular. Hata metni ya da { mod, etiketler, not } doner. */
function dogrula(govde) {
  const mod = String(govde?.mod || 'degistir');
  if (!MODLAR.has(mod)) return { hata: 'Kip geçersiz (degistir | ekle).' };
  const ham = Array.isArray(govde?.etiketler) ? govde.etiketler.flatMap(bol) : bol(govde?.etiketler);
  const etiketler = [...new Set(ham)];
  if (!etiketler.length) return { hata: 'En az bir etiket gerekli.' };
  if (etiketler.length > EN_COK_ETIKET) return { hata: `En çok ${EN_COK_ETIKET} etiket.` };
  const kotu = etiketler.find((e) => !ETIKET_RE.test(e) || e.toLowerCase() === 'too_many');
  if (kotu) return { hata: `Etiket geçersiz: "${kotu.slice(0, 64)}" (harf, rakam, . _ - ; en çok 64).` };
  const not = String(govde?.not || '').trim().slice(0, 500) || null;
  return { mod, etiketler, not };
}

/**
 * Etiketleri envanter satirlarina uygular (SAF; satirlar kopyalanir).
 * @param rows dbo.nginx_inventory satirlari
 * @param etiketler Map<HOST, { mod, etiketler: string[], not, by, at }>
 */
function etiketUygula(rows, etiketler) {
  if (!etiketler?.size) return rows;
  return rows.map((r) => {
    const e = etiketler.get(String(r.hostname || '').trim().toUpperCase());
    if (!e) return r;
    const oto = bol(r.services);
    const etkin = etkinListe(oto, e);
    return {
      ...r,
      services: etkin.join(','),
      service_count: etkin.includes('too_many') ? r.service_count : etkin.length,
      etiket: { mod: e.mod, etiketler: e.etiketler, not: e.not || null, by: e.by || null, at: e.at || null, oto },
    };
  });
}

/** Portal DB'den tum etiketler: Map<HOST, kayit>. */
async function etiketleriOku(db) {
  const r = await db.query(
    `SELECT host, kip, etiketler, note, updated_by, updated_at FROM nginx_host_labels`,
    [],
  );
  const m = new Map();
  for (const x of r.rows || []) {
    m.set(String(x.host).toUpperCase(), {
      mod: MODLAR.has(x.kip) ? x.kip : 'degistir',
      etiketler: bol(x.etiketler),
      not: x.note || null,
      by: x.updated_by || null,
      at: x.updated_at ? new Date(x.updated_at).toISOString() : null,
    });
  }
  return m;
}

/**
 * Etkin service listesi (SAF): otomatik liste + elle etiket. Etiket yoksa otomatik liste aynen.
 * @param {string[]} oto otomatik (conf.d) liste
 * @param {{mod:string, etiketler:string[]}|null|undefined} e
 */
function etkinListe(oto, e) {
  if (!e) return oto;
  if (e.mod !== 'ekle') return [...e.etiketler];
  // Ustune ekle: harf duyarsiz tekil (otomatik 'GLOMO' + etiket 'glomo' iki kez sayilmaz); otomatik yazim kalir.
  const gorulen = new Set(oto.map((x) => String(x).toLowerCase()));
  return [...oto, ...e.etiketler.filter((x) => !gorulen.has(x.toLowerCase()) && gorulen.add(x.toLowerCase()))];
}

// -- HER YERDE GECERLI (kullanici, 2026-11-12: "etiket her yerde gecerli olsun, SPA'ya da bagla") --
// Ayni haritayi okuyanlar: Envanter, Nginx Hub sunucu listesi + drift, API Envanteri, SPA Uygulamalari
// (spa-rp), Denetim SPA matrisi + kapsami, Nginx Locations, ARK SPA Raporu (yalniz gosterim), survey
// 'nginx-hosts' etiketi. KASITLI OLARAK OKUMAYANLAR (otomasyon / birlestirme anahtari conf.d adidir):
// survey 'nginx-services' / 'nginx-locations' degerleri, nginx-migration (Production Tasimalari),
// nginx_ops tanim okuma, trafik anahtarlari (spaTrafikAnahtari), yuk testi.
// tekEtiket kurali: yalniz 'degistir' + TEK etiket bir TANIMIN servisini belirler. Kisa bellek onbellegi: her istek Portal DB'ye gitmesin. Yazinca/silince onbellek bosalir ve
// dinleyiciler (baska modullerin yanit onbellekleri) haber alir: eski service listesi kalmasin.
const ONBELLEK_MS = 30 * 1000;
let onbellek = null; // { at, m }
let surumNo = 0; // her degisiklikte artar: uzun hesaplar bitince sonucun bayat olup olmadigini sorar
const dinleyiciler = new Map(); // anahtar -> fn (ayni anahtar ikinci kez kaydolursa yerine gecer)

/**
 * Degisiklikte cagrilacak fonksiyon (or. yanit onbellegi temizligi). Anahtar verilirse ayni
 * modul (router testlerde birden cok kurulur) dinleyici biriktirmez.
 */
function degisinceHaberVer(fn, anahtar) {
  if (typeof fn === 'function') dinleyiciler.set(anahtar || fn, fn);
}

/**
 * TANIM BASINA etiket (aynalar): ayni tanim (anahtar) birden cok sunucuda durur. Etiket yalniz TUM
 * sunuculari ayni tekEtiket'i tasiyorsa gecer; karisiksa (bir ayna etiketli, digeri degil) tanim
 * conf.d adinda kalir - aksi halde tek tanim iki satira bolunur, trafik iki kez sayilirdi.
 * @returns {(r: object) => string|null}
 */
function tanimEtiketi(rows, m, anahtar, hostOf = (r) => r.host) {
  const k = new Map();
  if (m?.size)
    for (const r of rows || []) {
      const a = anahtar(r);
      const t = tekEtiket(m, hostOf(r));
      const v = k.get(a);
      k.set(a, (() => { if (v === undefined) return t; if (v === t) return v; return null; })());
    }
  return (r) => (m?.size ? k.get(anahtar(r)) || null : null);
}

/**
 * Sunucunun KESIN tek servisi: yalniz 'degistir' + tek etiket ("bu sunucu X"); BUYUK harf.
 * Diger durumlarda null (coklu etiket / ustune ekle bir tanimin hangi servise ait oldugunu soylemez).
 */
function tekEtiket(m, host) {
  const e = (m?.get?.(String(host || '').trim().toUpperCase()) ?? null);
  return e?.mod === 'degistir' && e.etiketler?.length === 1 ? String(e.etiketler[0]).toUpperCase() : null;
}

function degisti() {
  onbellek = null;
  surumNo += 1;
  for (const fn of dinleyiciler.values()) {
    try {
      fn();
    } catch {
      /* yoksay */
    }
  }
}

/**
 * Etiket haritasi (onbellekli). ASLA firlatmaz: okunamazsa bos harita + hata metni doner;
 * cagiran ekran otomatik listeyle calismaya devam eder.
 * @returns {Promise<{ m: Map<string, object>, hata: string|null }>}
 */
async function etiketHaritasi(db) {
  if (onbellek && Date.now() - onbellek.at < ONBELLEK_MS) return { m: onbellek.m, hata: null };
  try {
    const s = surumNo;
    const m = await etiketleriOku(db || require('../db/index.cjs'));
    // Okuma surerken yazma olduysa bu (eski) harita onbellege GIRMEZ (dogrulama bulgusu).
    if (s === surumNo) onbellek = { at: Date.now(), m };
    return { m, hata: null };
  } catch (e) {
    return { m: new Map(), hata: e.message || String(e) };
  }
}

async function etiketYaz(db, host, { mod, etiketler, not }, by) {
  const ex = await db.query(`SELECT 1 FROM nginx_host_labels WHERE host = $1`, [host]);
  if ((ex.rows || []).length) {
    await db.query(
      `UPDATE nginx_host_labels SET kip = $2, etiketler = $3, note = $4, updated_by = $5, updated_at = GETUTCDATE() WHERE host = $1`,
      [host, mod, etiketler.join(','), not, by],
    );
  } else {
    await db.query(
      `INSERT INTO nginx_host_labels (host, kip, etiketler, note, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)`,
      [host, mod, etiketler.join(','), not, by],
    );
  }
  degisti();
}

async function etiketSil(db, host) {
  await db.query(`DELETE FROM nginx_host_labels WHERE host = $1`, [host]);
  degisti();
}

module.exports = {
  HOST_RE,
  dogrula,
  etiketUygula,
  etkinListe,
  tekEtiket,
  tanimEtiketi,
  surum: () => surumNo,
  etiketleriOku,
  etiketHaritasi,
  degisinceHaberVer,
  etiketYaz,
  etiketSil,
  _bol: bol,
  _sifirla: () => {
    onbellek = null;
  },
};
