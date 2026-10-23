// server/audit/web-app.cjs — "Denetim > Web-App Iliskisi" (2026-08-23, kullanici talebi).
//
// SORU: MWAppsInventory/WASAppsInventory'deki her uygulama satirinin onune, o uygulamayi
// SERVIS EDEN web sunucusunu (host, ip, port, server_name) koymak.
//
// KAYNAKLAR
//   dbo.MWAppsInventory / dbo.WASAppsInventory -> app, host, env, domain
//   dbo.BMW_Certificates_Inventory             -> host, ip, port, server_name, conf_file,
//                                                 product, alias, env
//
// ESLESTIRME KURALLARI (kullanici verdi)
//   3-tier (genellikle gtdmz.com.tr): uygulama sunucusunun adindaki 5. KARAKTER 'A' ise
//     web sunucusunda 'W' olur.  DACRAAP01 -> DACRWAP01,  GBCJAP01 -> GBCJWP01
//     DIKKAT: "ilk A" degil, 5. KONUM. DACRAAP01'de iki 'A' var, yalnizca 5.'si doner.
//   2-tier (genellikle .fw.garanti.com.tr): web sunucusu uygulamanin KENDI sunucusudur.
//   Her iki durumda da dogru vhost'u bulmak icin uygulama adi KUCUK HARFLE server_name
//   icinde aranir.
//
// TAHMIN YOK: server_name'de uygulama adinin HANGI bicimde gectigi (tam ad mi, ortam son
// eki atilmis taban ad mi) kullanicinin da emin olmadigi bir nokta. Bu yuzden IKISI DE
// denenir ve HANGISIYLE eslestigi her satirda raporlanir - gercek veri geldiginde cevap
// kendiliginden ortaya cikar. Hicbiri tutmazsa satir "eslesmedi" olarak isaretlenir,
// uydurma bir web sunucusu YAZILMAZ.
'use strict';

const SOURCES = {
  // genKolon: ayni ad + sunucuda JBoss 7 ve 8 JVM'i olabilir; AJP eslesmesi dogru surumun portuyla yapilir.
  mw: { table: 'dbo.MWAppsInventory', label: 'JBoss uygulamaları', genKolon: 'jboss_version' },
  was: { table: 'dbo.WASAppsInventory', label: 'WAS uygulamaları' },
};

// Ortam son eki (bkz. app-envs.cjs): server_name'de taban ad geciyor olabilir.
const ENV_SUFFIX = /-[DTQdtq]$/;

const TIER3_DOMAIN = /gtdmz/i;
const TIER2_DOMAIN = /fw\.garanti/i;

/**
 * 3-tier kuralina gore web sunucusu adini uretir: 5. KARAKTER 'A' ise 'W' yapilir.
 * Kural tutmazsa null doner - tahmin edilmez.
 */
function webHostOf(host) {
  const h = String(host || '').trim();
  if (h.length < 5) return null;
  if (h[4].toUpperCase() !== 'A') return null;
  return h.slice(0, 4) + (h[4] === 'a' ? 'w' : 'W') + h.slice(5);
}

/**
 * 3-tier web sunucusu ADAYLARI (2026-10-12, kullanici: "3-tier sunucularin web sunucularini
 * bulamiyorsun; GOJBAB03'un web hostu GOJBWP03" ve "Pendik icin kural 5. harf, toplam 6 harf;
 * Ankara icin 5. harf, toplam 7 harf"). Ad = <harfler><rakamlar>; Pendik 6 harf, Ankara 7 harf
 * (fazladan site harfi A). Tek kural (5. harf A->W) GOJBAB03'ten var olmayan GOJBWB03'u
 * uretiyordu ve web katmani sessizce "eslenemedi" kaliyordu. Adaylar:
 *   1) 5. harf A->W                          GBCJAP01 -> GBCJWP01, DACRAAP01 -> DACRWAP01
 *   2) 5. harf A->W + SON harf (ortam) -> P  GOJBAB03 -> GOJBWP03 (Pendik, 6 harf)
 *                                            DACRAAB01 -> DACRWAP01 (Ankara, 7 harf)
 * Aday TAHMIN olarak kullanilmaz: yalniz envanterde/taramada VHOST'U OLAN aday secilir ve
 * vhost'un server_name'i uygulamayla eslesmek zorunda. Hicbiri yoksa satir "eslenemedi" kalir.
 */
function webHostAdaylari(host) {
  const h = String(host || '').trim();
  const out = [];
  const a = webHostOf(h);
  if (!a) return out;
  out.push(a);
  const m = /^([A-Za-z]+)(\d+)$/.exec(a);
  if (m && (m[1].length === 6 || m[1].length === 7)) {
    const son = m[1].slice(-1);
    const b = m[1].slice(0, -1) + (son === son.toLowerCase() ? 'p' : 'P') + m[2];
    if (b.toUpperCase() !== a.toUpperCase()) out.push(b);
  }
  return out;
}

function tierOf(domain, host) {
  const d = String(domain || '');
  if (TIER3_DOMAIN.test(d)) return '3-tier';
  if (TIER2_DOMAIN.test(d)) return '2-tier';
  // Domain bos/tanimsizsa host adindan CIKARIM YAPILMAZ; "bilinmiyor" denir ve her iki
  // aday da denenir. Yanlis tier atamak, yanlis web sunucusu gostermek demek olurdu.
  return 'bilinmiyor';
}

/** BMW_Certificates_Inventory satirlari -> web sunucu adina gore vhost listesi (buyuk harf anahtar). */
function buildCertIndex(certRows) {
  const certByHost = new Map();
  for (const c of certRows || []) {
    const h = String(c.host || '').trim().toUpperCase();
    if (!h) continue;
    if (!certByHost.has(h)) certByHost.set(h, []);
    certByHost.get(h).push({
      host: String(c.host || '').trim(),
      ip: c.ip == null ? '' : String(c.ip).trim(),
      port: c.port == null ? '' : String(c.port).trim(),
      serverName: String(c.server_name || '').trim(),
      confFile: String(c.conf_file || '').trim(),
      product: String(c.product || '').trim(),
    });
  }
  return certByHost;
}

/**
 * AD VARYANTLARI (2026-10-13, GFY_INTERNET_SERVICES retirement'i: web bulunamadi). Alan adinda
 * ALT CIZGI OLAMAZ; envanter adi `gfy_internet_services` ise vhost `gfy-internet-services` ya da
 * `gfyinternetservices` olur. Alt cizgili adda bu iki bicim de denenir (once kendisi).
 */
function adVaryantlari(ad) {
  const a = String(ad || '').toLowerCase();
  if (!a.includes('_')) return [a];
  return [...new Set([a, a.replace(/_/g, '-'), a.replace(/_/g, '')])];
}

/**
 * Tek uygulama satiri icin web sunucusu eslesmesi (Denetim > Web-App kurali; retirement akisi da
 * AYNI fonksiyonu kullanir — kullanici 2026-09-21: "web sunucu kesfi icin web-app relations").
 * @returns {{ tier, how, matched, web: object[], webHostCandidate, vhostCountOnHost }}
 */
function matchWebForApp({ app, appHost, domain }, certByHost) {
  const tier = tierOf(domain, appHost);
  const needleFull = String(app).toLowerCase();
  const needleBase = needleFull.replace(ENV_SUFFIX, '');
  const adaylar = webHostAdaylari(appHost).map((h) => ({ host: h, how: 'harf-dönüşümü' }));
  const candidates =
    tier === '2-tier'
      ? [{ host: appHost, how: 'aynı host' }]
      : [...adaylar, { host: appHost, how: 'aynı host' }];
  let matched = null;
  let hostOnly = null;
  for (const cand of candidates) {
    if (!cand.host) continue;
    const list = certByHost.get(cand.host.toUpperCase());
    if (!list || !list.length) continue;
    if (!hostOnly) hostOnly = { how: cand.how, host: cand.host, count: list.length };
    const denenecek = [
      ...adVaryantlari(needleFull).map((n, i) => [i ? `tam ad, ${n}` : 'tam ad', n]),
      ...(needleBase === needleFull ? [] : adVaryantlari(needleBase).map((n, i) => [i ? `taban ad, ${n}` : 'taban ad', n])),
    ];
    for (const [form, needle] of denenecek) {
      const hits = list.filter((e) => e.serverName.toLowerCase().includes(needle));
      if (hits.length) { matched = { how: cand.how, nameForm: form, entries: hits }; break; }
    }
    if (matched) break;
  }
  const how = matched
    ? `${matched.how} + server_name (${matched.nameForm})`
    : hostOnly ? 'web sunucusu var, server_name tutmadı' : 'eşleşmedi';
  return {
    tier, how, matched: !!matched,
    web: matched ? matched.entries : [],
    webHostCandidate: hostOnly ? hostOnly.host : webHostOf(appHost) || appHost,
    webHostAdaylari: tier === '2-tier' ? [] : webHostAdaylari(appHost),
    vhostCountOnHost: hostOnly ? hostOnly.count : 0,
  };
}

const U = (s) => String(s || '').trim().toUpperCase();

/**
 * TOPOLOJI (2026-10-16, kullanici: "3-tier sunucularin topolojisi 'bilinmiyor' olarak yazilmis").
 * tierOf yalniz envanterdeki domain'e bakar; domain bos satirlar 'bilinmiyor' kaliyordu - web
 * sunucusu harf donusumuyle AYRI bir hostta bulunmus olsa bile. Domain yoksa topoloji ESLESME
 * KANITINDAN okunur: web sunucusu uygulama sunucusundan ayri bir host -> 3-tier, ayni host ->
 * 2-tier; eslesme yok ama ad kuraliyla uretilen ayri aday hostta vhost var -> 3-tier. Hic kanit
 * yoksa ad kurali TAHMIN olarak kullanilmaz: 'bilinmiyor' kalir (yanlis tier = yanlis web sunucusu).
 * @returns {{ tier: string, kaynak: string }} kaynak: domain / esleme kaniti / aday web sunucusu / bos
 */
function topolojiOf(domain, appHost, m) {
  const t = tierOf(domain, appHost);
  if (t !== 'bilinmiyor') return { tier: t, kaynak: 'domain' };
  const web = (m && m.web) || [];
  if (web.length) return { tier: web.some((w) => U(w.host) !== U(appHost)) ? '3-tier' : '2-tier', kaynak: 'eşleşme' };
  if (m && m.vhostCountOnHost > 0 && m.webHostCandidate && U(m.webHostCandidate) !== U(appHost)) {
    return { tier: '3-tier', kaynak: 'aday web sunucusu' };
  }
  return { tier: 'bilinmiyor', kaynak: '' };
}

/** Web sunucusu adinin uygulama sunucusundan hangi ad kuraliyla geldigi (yoksa null). */
function adKurali(appHost, webHost) {
  if (U(webHost) === U(appHost)) return 'web katmanı uygulamanın kendi sunucusunda';
  const ad = webHostAdaylari(appHost).map(U);
  if (ad[0] && ad[0] === U(webHost)) return `${U(appHost)} → ${U(webHost)}: 5. harf A→W`;
  if (ad[1] && ad[1] === U(webHost)) {
    const harf = ((/^([A-Z]+)\d+$/.exec(U(webHost)) || [])[1] || '').length;
    return `${U(appHost)} → ${U(webHost)}: 5. harf A→W + son harf P (${harf} harf = ${harf === 7 ? 'Ankara' : 'Pendik'})`;
  }
  return null;
}

/**
 * ESLESME NASIL KURULDU — SATIR BASINA (2026-10-16, kullanici: "'Eslesme nasil kuruldu' yazimini her
 * bir uygulama icin kendi satirina yazar misin?"). Genel kural metni yerine bu uygulama sunucusunun
 * GERCEK yolu: topoloji neden, her web sunucusu hangi ad kuraliyla, vhost hangi kaynaktan (sertifika
 * envanteri / Server Hub / AJP hedefi / mod_cluster) ve eslesmediyse neden.
 * @returns {string[]}
 */
function nasilAciklama({ app, appHost, domain, m, topoloji }) {
  const satir = [];
  const t = topoloji || topolojiOf(domain, appHost, m);
  satir.push(
    t.kaynak === 'domain'
      ? `Topoloji ${t.tier}: envanterdeki domain ${domain}`
      : t.kaynak === 'eşleşme'
        ? `Topoloji ${t.tier}: envanterde domain yok; ${t.tier === '3-tier' ? 'web sunucusu ayrı bir host' : 'web sunucusu uygulamanın kendi sunucusu'}`
        : t.kaynak === 'aday web sunucusu'
          ? `Topoloji 3-tier: envanterde domain yok; ad kuralının ürettiği web sunucusu ${U(m.webHostCandidate)} envanterde var`
          : 'Topoloji bilinmiyor: envanterde domain yok, web sunucusu da bulunamadı',
  );
  const how = String((m && m.how) || '');
  const hub = /^Server Hub/.test(how);
  const form = (/server_name \(([^)]*)\)/.exec(how) || [])[1];
  const web = (m && m.web) || [];
  const hostlar = [...new Set(web.map((w) => U(w.host)))];
  for (const h of hostlar) {
    const kaynaklar = new Set();
    for (const w of web.filter((x) => U(x.host) === h)) {
      const k = String(w.kaynak || 'ad');
      if (k === 'ad' || k.startsWith('ad+')) {
        kaynaklar.add(hub
          ? `server_name ilk etiketi = "${app}" (Server Hub taraması; sertifika envanterinde yok)`
          : `server_name'de "${app}" geçiyor (${form || 'ad'}; sertifika envanteri)`);
      }
      if (k.includes('ajp')) kaynaklar.add(`AJP/proxy hedefi bu uygulamanın JVM portu${w.ajpHedef ? ` (${w.ajpHedef})` : ''}`);
      if (k.includes('mc')) kaynaklar.add(`mod_cluster balancer adı = uygulama adı${w.mcBalancer ? ` (balancer://${w.mcBalancer})` : ''}; aynı site ve ortamdaki web sunucusu`);
    }
    const kural = adKurali(appHost, h);
    satir.push(`${kural || `${h}: ad kuralı dışında`} — ${[...kaynaklar].join(' · ')}`);
  }
  if (!web.length) {
    const adaylar = webHostAdaylari(appHost);
    if (m && m.vhostCountOnHost > 0) {
      const kural = adKurali(appHost, m.webHostCandidate);
      satir.push(`${kural || U(m.webHostCandidate)} — orada ${m.vhostCountOnHost} vhost var ama hiçbirinin server_name'i "${app}" içermiyor; AJP / mod_cluster hedefi de yok`);
    } else {
      satir.push(`Web sunucusu bulunamadı: ${adaylar.length ? `aday ${adaylar.map(U).join(', ')} ve ` : ''}${U(appHost)} için sertifika envanterinde de Server Hub taramasında da vhost yok`);
    }
  }
  return satir;
}

// ── DNS -> LB VIP (2026-10-13, kullanici: "DNS'in cozdugu IP aslinda load balancer'daki virtual IP;
// tum member IP'ler bu VIP'in altinda bir pool olusturur" + "Ankara sunucularinin VIP'i Pendik'ten farkli
// olacagi icin Ankara sunucularinin cozdugu DNS'in farkli olmasini beklerim").
//
// BOLGE + SITE BAZLI COZUM: ayni ad bulundugu siteye gore FARKLI VIP'e cozulur ve hangi DNS sunucusuna
// sorulacagi domain bolgesine baglidir (kullanici 2026-10-13):
//   gtdmz.com.tr       Pendik 10.230.238.22   Ankara 10.236.238.22
//   fw.garanti.com.tr  Pendik 10.230.238.1    Ankara 10.236.238.1
// Bolge satirin (uygulamanin) domain'inden; site web sunucusunun adindan (Ankara 7 harf). Her uye KENDI
// sitesinin DNS'iyle gosterilir. Bir site DNS'ine ulasilamazsa diger site denenmez (yanlis VIP olurdu),
// hata yazilir. Bolgesi bilinmeyen satir Portal cozucusuyla cozulur ve ekran bunu soyler.
// Sonuclar 10 dk onbellekte; ayni anda en fazla 20 sorgu, ad basina 3 sn.
const DNS_TTL_MS = 10 * 60 * 1000;
const DNS_SURE_MS = 3000;
const DNS_ESZAMANLI = 20;
const _dnsOnbellek = new Map();

const DNS_BOLGELER = Object.freeze({
  gtdmz: { Pendik: ['10.230.238.22'], Ankara: ['10.236.238.22'] },
  fw: { Pendik: ['10.230.238.1'], Ankara: ['10.236.238.1'] },
});

/** Domain -> DNS bolgesi ('gtdmz' | 'fw' | null). */
function dnsBolgesi(domain) {
  const d = String(domain || '').toLowerCase();
  if (/gtdmz/.test(d)) return 'gtdmz';
  if (/fw\.garanti/.test(d)) return 'fw';
  return null;
}

async function tekCozum(ad, sunucular) {
  const dns = require('node:dns').promises;
  const zaman = new Promise((_, red) => setTimeout(() => red(Object.assign(new Error('zaman asimi'), { code: 'ZAMAN_ASIMI' })), DNS_SURE_MS));
  try {
    let ips;
    if (sunucular && sunucular.length) {
      const r = new dns.Resolver({ timeout: DNS_SURE_MS, tries: 1 });
      r.setServers(sunucular);
      ips = await Promise.race([r.resolve4(ad), zaman]);
    } else {
      ips = (await Promise.race([dns.lookup(ad, { all: true, family: 4 }), zaman])).map((x) => x.address);
    }
    return { ips: [...new Set(ips)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
  } catch (e) {
    const c = e && e.code;
    return { hata: c === 'ENOTFOUND' || c === 'ENODATA' ? 'DNS kaydı yok' : c === 'ZAMAN_ASIMI' || c === 'ETIMEOUT' ? 'zaman aşımı' : String(c || (e && e.message) || e) };
  }
}

/**
 * istekler: [{ad, bolge}] -> sonuc[`${bolge || '-'}|${ad}`] = { Pendik, Ankara } (bolge biliniyorsa)
 * ya da { varsayilan } (bolge yoksa Portal cozucusu).
 */
async function dnsCozumle(istekler, { bolgeler = DNS_BOLGELER, cozucu = tekCozum, simdi = Date.now } = {}) {
  const isler = [];
  const sonuc = {};
  for (const x of istekler || []) {
    const ad = String((x && x.ad) || '').trim().toLowerCase();
    const bolge = x && x.bolge && bolgeler[x.bolge] ? x.bolge : null;
    const anahtar = `${bolge || '-'}|${ad}`;
    if (!ad || sonuc[anahtar]) continue;
    sonuc[anahtar] = {};
    const kollar = bolge ? Object.keys(bolgeler[bolge]) : ['varsayilan'];
    for (const k of kollar) {
      if (ad.startsWith('*')) { sonuc[anahtar][k] = { hata: 'joker ad - çözülmez' }; continue; }
      if (/^[0-9.]+$/.test(ad)) { sonuc[anahtar][k] = { ips: [ad] }; continue; }
      const sunucular = bolge ? bolgeler[bolge][k] : null;
      const ok = `${sunucular ? sunucular.join(',') : 'varsayilan'}|${ad}`;
      const c = _dnsOnbellek.get(ok);
      if (c && simdi() - c.at < DNS_TTL_MS) { sonuc[anahtar][k] = c.v; continue; }
      isler.push({ ad, anahtar, k, ok, sunucular });
    }
  }
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(DNS_ESZAMANLI, isler.length) }, async () => {
    while (i < isler.length) {
      const is = isler[i++];
      const v = await cozucu(is.ad, is.sunucular);
      _dnsOnbellek.set(is.ok, { at: simdi(), v });
      sonuc[is.anahtar][is.k] = { ...v, ...(is.sunucular ? { dnsSunucusu: is.sunucular.join(', ') } : {}) };
    }
  }));
  return { sonuc };
}

function registerWebApp(router) {
  // DNS -> VIP: tablo yuklendikten SONRA ayri istekle (tabloyu bekletmesin). En fazla 400 ad.
  router.post('/web-app/dns', async (req, res) => {
    const istekler = Array.isArray(req.body?.istekler)
      ? req.body.istekler.slice(0, 400).map((x) => ({ ad: String(x?.ad || ''), bolge: x?.bolge ? String(x.bolge) : null }))
      : [];
    try {
      const { sonuc } = await dnsCozumle(istekler);
      res.json({ ok: true, sonuc });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.get('/web-app', async (req, res) => {
    try {
      const key = SOURCES[String(req.query.source || 'mw')] ? String(req.query.source) : 'mw';
      const src = SOURCES[key];
      const q = String(req.query.q || '')
        .trim()
        .toLowerCase();
      const onlyUnmatched = String(req.query.onlyUnmatched || '') === '1';
      const taze = String(req.query.fresh || '') === '1';
      const CAP = 1000;

      const h = await webAppSonucu(key, taze);
      // Arama / suzme ONBELLEKTEKI tam sonuc uzerinde (alfabetik sirali); sayaclar suzmeden bagimsiz.
      const rows = [];
      let uyan = 0;
      for (const r of h.rows) {
        if (onlyUnmatched && r.matched) continue;
        if (q && !r.app.toLowerCase().includes(q) && !r.appHost.toLowerCase().includes(q)) continue;
        uyan += 1;
        if (rows.length < CAP) rows.push(r);
      }

      res.json({
        ok: true,
        source: key,
        label: src.label,
        sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, label: v.label })),
        certMissing: h.certMissing,
        hubHata: h.hubHata,
        total: h.total,
        matchedTotal: h.eslesen,
        shown: rows.length,
        capped: uyan > rows.length,
        hesaplandi: h.hesaplandi,
        matchSummary: h.matchSummary,
        tierSummary: h.tierSummary,
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Web-App ilişkisi alınamadı.' });
    }
  });
}

// -- HESAP ONBELLEGI + TEK UCUS (2026-10-23) ---------------------------------------------
// Kullanici: "sorgulama yaparken bir turlu getirmedi sorgular cok uzun suruyor 'Yenile' butonu donup
// duruyor". Arama kutusundaki her degisiklik (300 ms gecikmeyle) TUM hesabi bastan kosturuyordu:
// sertifika envanteri + Server Hub tablolari tamamen cekilir, her uygulama satiri icin AJP/mod_cluster
// eslemesi tum vhost listesinde dolasir - ve bu senkron dongu Node'u (TUM Portal'i) bitene kadar
// kilitler. Birkac harf = ayni agir hesap uc-dort kez sirada, onceki istekler de iptal edilmiyor.
// Simdi: kaynak basina TAM sonuc (suzmesiz, sinirsiz, sirali) bir kez hesaplanir, WEBAPP_ONBELLEK_MS
// (varsayilan 10 dk, 0 = onbellek yok) tutulur; ayni anda gelen istekler AYNI hesabi bekler (tek
// ucus). Arama onbellekteki satirlar uzerinde suzulur. "Yenile" (fresh=1) onbellegi atlar; suren bir
// hesap varsa onu bekler (o zaten taze). Hata onbellege YAZILMAZ. Anahtar kaynak adi (SOURCES: 2
// deger) - Map sinirli. Veri gunluk taramalardan gelir; hesap zamani ekranda yazilir.
const ONBELLEK_VARSAYILAN_MS = 10 * 60 * 1000;
function onbellekMs() {
  const n = parseInt(process.env.WEBAPP_ONBELLEK_MS || '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 60 * 60 * 1000 ? n : ONBELLEK_VARSAYILAN_MS;
}
// Hesap dongusu her DILIM satirda olay dongusune nefes aldirir: hesap surerken Portal donmaz.
const DILIM = 200;
const nefes = () => new Promise((ok) => setImmediate(ok));
const _hesaplar = new Map();

function webAppSonucu(key, taze) {
  const c = _hesaplar.get(key);
  if (c && (c.bekliyor || (!taze && Date.now() - c.at < onbellekMs()))) return c.p;
  const kayit = { at: Date.now(), bekliyor: true, p: null };
  kayit.p = webAppHesapla(key).then(
    (v) => { kayit.bekliyor = false; kayit.at = Date.now(); return v; },
    (e) => { if (_hesaplar.get(key) === kayit) _hesaplar.delete(key); throw e; },
  );
  _hesaplar.set(key, kayit);
  return kayit.p;
}

async function webAppHesapla(key) {
  const { query } = require('../inventory/mssql.cjs');
  const src = SOURCES[key];
  const [appRes, certRes] = await Promise.all([
    query(`SELECT DISTINCT app, host, env, domain${src.genKolon ? `, ${src.genKolon}` : ''} FROM ${src.table}
            WHERE app IS NOT NULL AND app <> ''`),
    query(`SELECT host, ip, port, server_name, conf_file, product, env
             FROM dbo.BMW_Certificates_Inventory`).catch(() => ({
      recordset: [],
      _missing: true,
    })),
  ]);
  const certMissing = !!certRes._missing;

  const certByHost = buildCertIndex(certRes.recordset || []);
  // SERVER HUB + AJP (2026-10-13): retirement kesfiyle AYNI zenginlestirme (discover.cjs).
  // Server Hub okunamazsa yalniz sertifika eslemesi kalir; ekran bunu hubHata ile soyler.
  const { webZenginlestir, hubBaglamiYukle, siteOf, genOf } = require('../retirement/discover.cjs');
  const hub = await hubBaglamiYukle(query).catch((e) => ({ vhostRows: [], hubVhostsByHost: new Map(), ipMap: new Map(), jvmOf: () => null, hata: [e.message] }));
  // Ozet kovasi: AJP parantezindeki sayilar kovayi parcalamasin.
  const howKova = (h) => String(h).replace(/AJP\/proxy hedefi = JVM portu \([^)]*\)/, 'AJP/proxy hedefi = JVM portu');

  const howCount = {};
  const tierCount = {};
  const rows = [];
  let total = 0;
  let eslesen = 0;
  let sira = 0;

  for (const a of appRes.recordset || []) {
    if (++sira % DILIM === 0) await nefes();
    const app = String(a.app || '').trim();
    const appHost = String(a.host || '').trim();
    if (!app) continue;

    const domain = String(a.domain || '').trim();
    const m = webZenginlestir(app, appHost, matchWebForApp({ app, appHost, domain }, certByHost),
      { hubVhostsByHost: hub.hubVhostsByHost, vhostRows: hub.vhostRows, ipMap: hub.ipMap,
        jvm: hub.jvmOf(appHost, app, src.genKolon ? genOf(a[src.genKolon]) : null),
        // mod_cluster yalniz JBoss (8) icin; WAS kaynaginda balancer adi eslesmesi yapilmaz.
        gen: src.genKolon ? genOf(a[src.genKolon]) : null, modCluster: key === 'mw' })
    const { how, matched } = m;
    const topoloji = topolojiOf(domain, appHost, m);
    const tier = topoloji.tier;
    if (matched) eslesen++;

    howCount[howKova(how)] = (howCount[howKova(how)] || 0) + 1;
    tierCount[tier] = (tierCount[tier] || 0) + 1;
    total++;

    rows.push({
      app,
      appHost,
      env: String(a.env || '').trim(),
      domain,
      // DNS -> VIP cozumunde hangi bolgenin DNS sunuculari (gtdmz / fw); null = bilinmiyor.
      dnsBolge: dnsBolgesi(domain),
      tier,
      tierKaynak: topoloji.kaynak,
      how,
      nasil: nasilAciklama({ app, appHost, domain, m, topoloji }),
      matched,
      // Bir uygulama birden fazla vhost'ta servis ediliyor olabilir; hepsi dondurulur.
      // DNS BOLGESI VHOST BASINA (2026-10-16, kullanici: "Ankara IP'lerinin hicbiri cozulememis"):
      // hangi DNS sunucusuna sorulacagi COZULEN ADIN kendi alanina baglidir (x.gtdmz.com.tr ->
      // gtdmz). Eskiden yalniz envanterdeki uygulama domain'ine bakiliyordu; domain bos satirlarda
      // bolge null kaliyor, Ankara uyesi Ankara DNS'ine HIC sorulmayip Portal cozucusunun (Pendik)
      // cevabiyla "Ankara VIP'i farkli olabilir" diye gosteriliyordu.
      web: (m.web || []).map((w) => ({
        ip: '', port: '', confFile: '', product: '', ...w, kaynak: w.kaynak || 'ad', site: siteOf(w.host),
        dnsBolge: dnsBolgesi(w.serverName) || dnsBolgesi(domain),
      })),
      webHostCandidate: m.webHostCandidate,
      vhostCountOnHost: m.vhostCountOnHost,
    });
  }

  rows.sort(
    (x, y) => x.app.localeCompare(y.app, 'tr') || x.appHost.localeCompare(y.appHost, 'tr'),
  );

  return {
    certMissing,
    hubHata: hub.hata && hub.hata.length ? hub.hata.join('; ') : null,
    total,
    eslesen,
    hesaplandi: new Date().toISOString(),
    matchSummary: Object.entries(howCount)
      .map(([how, count]) => ({ how, count }))
      .sort((a, b) => b.count - a.count),
    tierSummary: Object.entries(tierCount)
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count),
    rows,
  };
}

/** Test icin: hesap onbellegini bosaltir. */
function _webAppOnbellekTemizle() { _hesaplar.clear(); }

module.exports = { registerWebApp, _webAppOnbellekTemizle, dnsCozumle, dnsBolgesi, DNS_BOLGELER, adVaryantlari, webHostOf, webHostAdaylari, tierOf, topolojiOf, nasilAciklama, buildCertIndex, matchWebForApp };
