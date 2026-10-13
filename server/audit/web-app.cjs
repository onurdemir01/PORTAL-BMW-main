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
      const { query } = require('../inventory/mssql.cjs');
      const key = SOURCES[String(req.query.source || 'mw')] ? String(req.query.source) : 'mw';
      const src = SOURCES[key];
      const q = String(req.query.q || '')
        .trim()
        .toLowerCase();
      const onlyUnmatched = String(req.query.onlyUnmatched || '') === '1';
      const CAP = 1000;

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

      for (const a of appRes.recordset || []) {
        const app = String(a.app || '').trim();
        const appHost = String(a.host || '').trim();
        if (!app) continue;

        const domain = String(a.domain || '').trim();
        const m = webZenginlestir(app, appHost, matchWebForApp({ app, appHost, domain }, certByHost),
          { hubVhostsByHost: hub.hubVhostsByHost, vhostRows: hub.vhostRows, ipMap: hub.ipMap, jvm: hub.jvmOf(appHost, app, src.genKolon ? genOf(a[src.genKolon]) : null) });
        const { tier, how, matched } = m;
        if (matched) eslesen++;

        howCount[howKova(how)] = (howCount[howKova(how)] || 0) + 1;
        tierCount[tier] = (tierCount[tier] || 0) + 1;
        total++;

        if (onlyUnmatched && matched) continue;
        if (q && !app.toLowerCase().includes(q) && !appHost.toLowerCase().includes(q)) continue;
        if (rows.length >= CAP) continue;

        rows.push({
          app,
          appHost,
          env: String(a.env || '').trim(),
          domain,
          // DNS -> VIP cozumunde hangi bolgenin DNS sunuculari (gtdmz / fw); null = bilinmiyor.
          dnsBolge: dnsBolgesi(domain),
          tier,
          how,
          matched,
          // Bir uygulama birden fazla vhost'ta servis ediliyor olabilir; hepsi dondurulur.
          web: (m.web || []).map((w) => ({ ip: '', port: '', confFile: '', product: '', ...w, kaynak: w.kaynak || 'ad', site: siteOf(w.host) })),
          webHostCandidate: m.webHostCandidate,
          vhostCountOnHost: m.vhostCountOnHost,
        });
      }

      rows.sort(
        (x, y) => x.app.localeCompare(y.app, 'tr') || x.appHost.localeCompare(y.appHost, 'tr'),
      );

      res.json({
        ok: true,
        source: key,
        label: src.label,
        sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, label: v.label })),
        certMissing,
        hubHata: hub.hata && hub.hata.length ? hub.hata.join('; ') : null,
        total,
        matchedTotal: eslesen,
        shown: rows.length,
        capped: rows.length >= CAP,
        matchSummary: Object.entries(howCount)
          .map(([how, count]) => ({ how, count }))
          .sort((a, b) => b.count - a.count),
        tierSummary: Object.entries(tierCount)
          .map(([tier, count]) => ({ tier, count }))
          .sort((a, b) => b.count - a.count),
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Web-App ilişkisi alınamadı.' });
    }
  });
}

module.exports = { registerWebApp, dnsCozumle, dnsBolgesi, DNS_BOLGELER, adVaryantlari, webHostOf, webHostAdaylari, tierOf, buildCertIndex, matchWebForApp };
