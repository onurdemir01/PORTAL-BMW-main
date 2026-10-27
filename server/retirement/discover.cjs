// server/retirement/discover.cjs - Uygulama retirement kesfi (saf kisimlar birim testli).
//
// Kullanici (2026-09-21): "uygulama sahipleri bazen sadece Pendik sunucularini yaziyor, Ankara
// sunuculari runtime envanterinden sorgulanmali; tum ortamlar (dev/test/qa/prod/edu/alfa/beta);
// web sunucu kesfi icin Denetim'deki Web-App iliskisi kullanilmali."
//
// Kaynaklar: dbo.MWAppsInventory (app, host, env, domain, jboss_version, app_path, status)
//   + dbo.BMW_Certificates_Inventory (web vhost'lari; audit/web-app.cjs matchWebForApp)
//   + dbo.Server_Hub_Jvms (varsa: calisiyor mu / auto-start; son tarama)
// Uygulama adi kurali (audit/app-envs.cjs): <App>-D/-T/-Q ortam son ekleri, <App> = prod.
// Site: sunucu adinda tier harfinden sonra fazladan 'A' = Ankara (siteOf, asagida).
'use strict';

const { buildCertIndex, matchWebForApp, webHostAdaylari, adVaryantlari } = require('../audit/web-app.cjs');
const { webConfKanonik, urunAilesi, webKanonikAnahtar } = require('./web-liste.cjs');

const U = (s) => String(s || '').trim().toUpperCase();

// Sunucu adi: <2 sirket><2 servis><tier A|W|X...><site A?><ortam P|T|Q|D><n>. Ornek: GBCJAP01 Pendik
// (tier A, site harfi yok), GBCJAAP02 Ankara (fazladan A), GBNGXP40 Pendik, GBNGXAP34 Ankara
// (nginx_metadata kurali AP<n>$ yalniz tier'i A olmayan sunucularda dogru; burada genellestirildi).
function siteOf(host) {
  const m = /^([A-Z]{5,})([A-Z])(\d+)$/.exec(U(host));
  if (!m) return 'Pendik';
  return m[1].length >= 6 && m[1].endsWith('A') ? 'Ankara' : 'Pendik';
}

/** "CRM-T" -> { base: "CRM", env: "TEST" }; "CRM" -> PROD. */
function parseAppName(app) {
  const m = /^(.*)-([DdTtQq])$/.exec(String(app || '').trim());
  if (!m) return { base: String(app || '').trim(), env: 'PROD' };
  return { base: m[1], env: { D: 'DEV', T: 'TEST', Q: 'QA' }[m[2].toUpperCase()] };
}

// ORTAM: AD KURALI + ENVANTER (kullanici 2026-10-12: "paket isminden dolayi QA retirement'lari
// production gibi algilaniyor"). Ad kurali (-D/-T/-Q) yalniz SON EK varsa ortami soyler; eksiz ad
// eskiden KOSULSUZ PROD sayiliyordu - QA sunucusunda prod ile AYNI paket adiyla calisan uygulama
// boylece PROD oldu (OCO zorunlu, SCC maili...). Eksiz adda MWAppsInventory.env sutunu kullanilir
// (envanter job'i HOSTNAME'den turetir: *Q<n> -> QA, *T<n>/*D<n> -> Test, *O<n> -> ODM, *A<n> ->
// Alpha, aksi halde Production). Son ek varsa o kazanir (sutun D ile T'yi ayirt edemez).
// Sutun bos/taninmazsa PROD kalir: belirsizlikte guvenli taraf (OCO + SCC kapilari).
const ENVANTER_ORTAM = { PRODUCTION: 'PROD', PROD: 'PROD', QA: 'QA', TEST: 'TEST', ALPHA: 'ALPHA', ODM: 'ODM', DEV: 'DEV' };
function hedefOrtami(app, envanterEnv) {
  const p = parseAppName(app);
  if (/-[DdTtQq]$/.test(String(app || '').trim())) return p.env;
  return ENVANTER_ORTAM[String(envanterEnv || '').trim().toUpperCase()] || 'PROD';
}

/**
 * JVM SECIMI SURUMLE (2026-10-13, GOJBAP10: ayni adli iki GFYINTERNETBRANCH JVM'i - JBoss 7 ve 8, portlari
 * farkli). Eskiden `sunucu|ad` anahtari ikinciyi birinciye YAZIYORDU: AJP eslesmesi ve "calisiyor/kapali"
 * bilgisi yanlis surumden okunabiliyordu. Kural: surum biliniyorsa AYNI surumun JVM'i; yoksa ya da
 * eslesen surum yoksa ve ayni adla TEK JVM varsa (surum bilgisi tasimayan eski satir) o; birden fazlaysa
 * TAHMIN YOK (null).
 */
function jvmIndeksi(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = `${String(r.host || '').trim().toUpperCase()}|${String(r.jvm || '').trim().toUpperCase()}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
function jvmSec(idx, host, app, gen) {
  const l = idx.get(`${String(host || '').trim().toUpperCase()}|${String(app || '').trim().toUpperCase()}`) || [];
  if (!l.length) return null;
  const surumlu = l.filter((r) => r.gen != null && r.gen !== '');
  if (gen != null && surumlu.length) return surumlu.find((r) => Number(r.gen) === Number(gen)) || null;
  return l.length === 1 ? l[0] : null;
}

// URUN SURUMUNUN MAJORU (ilk sayi). Eskiden "herhangi bir yerde 8 var mi" bakiliyordu:
// EAP 7.4.8 / 7.3.8 / 7.0.8 JBoss 8 sayiliyordu (job_3438186 denetimi, 2026-10-22).
function genOf(jbossVersion) {
  const v = String(jbossVersion || '');
  if (/jboss.?8|eap.?8/i.test(v)) return 8;
  if (/jboss.?7|eap.?7/i.test(v)) return 7;
  const m = /(\d+)/.exec(v);
  const n = m ? Number(m[1]) : NaN;
  return n === 7 || n === 8 ? n : null;
}

// KURULUM KOLU = retirement betiklerinin GEN'i (OpsX kurulumKolu ile ayni kural). Betikler GEN'e gore
// KURULUM DIZINI secer: 7 = /usr/jboss/AppServer + /vhosting, 8 = /usr/jboss8/AppServer + /vhosting8.
// Envanter iki kurulumu app_path ile ayirir; kol oradan okunur, yoksa urun majoru. Standart disi
// sunucuda /usr/jboss altinda JBoss 8 urunu kurulu olabilir (GBJBOP18): urun surumu kolu SOYLEMEZ.
function kolOf(appPath, jbossVersion) {
  const p = String(appPath || '').trim().toLowerCase();
  if (p.startsWith('/vhosting8/')) return 8;
  if (p.startsWith('/vhosting/')) return 7;
  return genOf(jbossVersion);
}
// Envanterin 'NF' (paket dizini bulunamadi) isareti ve mutlak olmayan yol = paket yolu YOK.
const paketYolu = (p) => {
  const s = String(p || '').trim();
  return s.startsWith('/') ? s : '';
};

/**
 * @param {string} base  uygulama taban adi (CRM)
 * @param {object[]} invRows   MWAppsInventory satirlari (app = base ya da base-D/T/Q)
 * @param {object[]} certRows  BMW_Certificates_Inventory
 * @param {object[]} jvmRows   Server_Hub_Jvms (son tarama; opsiyonel)
 */
// ── VHOST TRAFIGI (kullanici, 2026-10-08) ────────────────────────────────────────────
// "Retirement kaydi girilirken sunucunun Apache loglarinda hc istegi disinda istegin olup
// olmadigi kontrol edilip kaydi acana gosterilebilir mi? 'Bak halen istek var, yine de
// retire prosedurune devam etmek istiyor musun?' gibi soru sorulabilir."
//
// OLCUM ZATEN VAR, YENI ANSIBLE ISI GEREKMEZ: server_hub_scan.sh RHA/IHS access log
// kuyrugunu `www` ile okuyor, vhost basina sayiyor ve `hc.html|hc.jsp` isteklerini AYRI
// kovaya alip (hc_24h) asil sayimdan DISLIYOR. Sonuc dbo.Server_Hub_Vhosts'ta.
//
// DEGISMEZ (server_hub/README.md): `req_24h/req_7d/hc_24h >= 0` ANCAK VE ANCAK
// `traffic_state ∈ {ACTIVE, NO_RECENT_TRAFFIC}`; diger her durumda -1. Bu yuzden:
//   ACTIVE            -> trafik VAR (req_7d > 0)
//   NO_RECENT_TRAFFIC -> trafik YOK, OLCULDU (kapsam >= 7 gun sarti saglanmis)
//   digeri / satir yok -> OLCULEMEDI
// "Olculemedi" ASLA "trafik yok" sayilmaz: retire karari buna dayaniyor ve yanlis tarafa
// dusmek, hala istek alan bir uygulamayi durdurmak demek.
//
// `sampled = 1`: log kuyrugu kesilmis, sayilar ALT SINIR. "en az N istek" denir.
const TRAFIK_OLCULDU = new Set(['ACTIVE', 'NO_RECENT_TRAFFIC']);

function trafikSinifi(v) {
  if (!v) return { durum: 'olculemedi', sebep: 'Server Hub taramasinda bu vhost icin kayit yok' };
  const st = String(v.traffic_state || '').toUpperCase();
  if (!TRAFIK_OLCULDU.has(st))
    return { durum: 'olculemedi', sebep: String(v.traffic_reason || st || 'bilinmiyor') };
  const r7 = Number(v.req_7d);
  const r24 = Number(v.req_24h);
  // -1 ile 0 AYRI: degismez geregi olculmus durumda >= 0 olmali; -1 gelirse veri
  // tutarsizdir ve "yok" saymak yanlis olurdu.
  if (!Number.isFinite(r7) || r7 < 0)
    return { durum: 'olculemedi', sebep: `${st} ama sayi yok (${v.req_7d})` };
  return {
    durum: r7 > 0 ? 'var' : 'yok',
    req24: Number.isFinite(r24) && r24 >= 0 ? r24 : null,
    req7: r7,
    hc24: Number.isFinite(Number(v.hc_24h)) && Number(v.hc_24h) >= 0 ? Number(v.hc_24h) : null,
    sampled: Number(v.sampled) === 1,
    sonIstek: v.last_req_epoch ? new Date(Number(v.last_req_epoch) * 1000).toISOString() : null,
    tarama: v.scan_date ? new Date(v.scan_date).toISOString().slice(0, 10) : null,
  };
}

// ── IKINCI WEB KAYNAGI: SERVER HUB (2026-10-08) ─────────────────────────────────────
// Kullanici: "GBSVCVOICEORDER uygulamasinin Apache konfigurasyonu olmasina ragmen bunu
// kesfedememis gozukuyor." Kesif web vhost'larini YALNIZ dbo.BMW_Certificates_Inventory'den
// aliyordu; sertifika envanterinde olmayan bir vhost (Server Hub'in ayni sunucuda IHS/RHA
// yapilandirmasindan GERCEKTEN gordugu) hic bulunmuyordu. Sertifika envanteri eslemezse
// Server Hub'in en yeni taramasina bakilir - ayni aday sunucular (harf donusumu, ayni host).
//
// ESLEME SIKI: server_name'in ya da bir alias'in ILK ETIKETI uygulama adina BIREBIR esit.
// Sertifika yolundaki "iceriyor" / taban ad eslemesi burada YOK, cunku retirement bu
// vhost'lari KAPATIYOR ve ayni sunucu cogu kez kardes ortamlari da barindiriyor (GBJBOT07:
// gbsvcvoiceorder-d VE -t). '-d' retire edilirken '-t'nin vhost'unu yakalamak, calisan bir
// ortami kapatmak olurdu.
function hubWebFallback(app, appHost, certSonucu, hubVhostsByHost) {
  // Alt cizgili ad: '-' ve bitisik bicimler de (alan adinda '_' olamaz). Esleme yine BIREBIR ilk etiket.
  const needles = new Set(adVaryantlari(app));
  const ilkEtiket = (s) => String(s || '').trim().toLowerCase().split('.')[0];
  // Aday aplikasyon sunucusunun KENDISIYSE etiketi 'ayni host' (harf donusumu bir sey bulmadi).
  // TUM 3-tier adaylari (webHostAdaylari: A->W ve son harf P; Pendik 6, Ankara 7 harf) - sertifika envanterinde vhost'u olmayan
  // aday Server Hub taramasinda olabilir (2026-10-12: GOJBAB03 -> GOJBWP03).
  const adaylar = [
    { host: certSonucu.webHostCandidate, how: U(certSonucu.webHostCandidate) === U(appHost) ? 'aynı host' : 'harf-dönüşümü' },
    ...(certSonucu.tier === '2-tier' ? [] : webHostAdaylari(appHost)).map((h) => ({ host: h, how: 'harf-dönüşümü' })),
    { host: appHost, how: 'aynı host' },
  ];
  const goruldu = new Set();
  for (const c of adaylar) {
    const h = U(c.host);
    if (!h || goruldu.has(h)) continue;
    goruldu.add(h);
    const list = hubVhostsByHost.get(h) || [];
    const hits = list.filter((v) =>
      [v.server_name, ...String(v.aliases || '').split(/[\s,]+/)].some((n) => n && needles.has(ilkEtiket(n))),
    );
    if (!hits.length) continue;
    const tekil = new Map();
    for (const v of hits) {
      // PORT ANAHTARDA: ayni conf'ta :80 ve :443 iki ayri blok (sertifika yolu da port
      // basina giris uretiyor). Portsuz anahtar :80 blogunu sessizce dusuruyordu.
      const port = String(v.listen || '').split(/[\s,]+/)[0].split(':').pop() || '';
      const k = `${U(v.host)}|${String(v.server_name || '').trim().toLowerCase()}|${port}|${v.conf_file || ''}`;
      if (tekil.has(k)) continue;
      tekil.set(k, {
        host: U(v.host), serverName: String(v.server_name || '').trim(), product: String(v.product || ''),
        port, confFile: String(v.conf_file || ''),
      });
    }
    return {
      ...certSonucu,
      matched: true,
      how: `Server Hub (${c.how}) + server_name ilk etiketi = uygulama adı · sertifika envanterinde yok`,
      web: [...tekil.values()],
    };
  }
  return certSonucu;
}

// ── UCUNCU WEB KAYNAGI: AJP / PROXY HEDEFI (2026-10-12) ──────────────────────────────
// Kullanici: "uygulamanin ismi onur ama Apache'de cansu.fw.garanti.com.tr diye tanim yapilmis olabilir.
// worker properties'te uygulamanin hangi AJP portu uzerinden hangi JVM'e gidecegi belirtiliyor; JBoss
// sunucularinda hangi uygulamanin hangi AJP portundan dinledigini bulsan, gercek virtual host blogunu
// kesfedemez miyiz?" Server Hub taramasi artik (a) JVM'in TANIMLI AJP/HTTP portlarini (cfg_ports, JVM
// kapaliyken de) ve (b) vhost'un mod_jk worker'larini workers.properties uzerinden host:port olarak
// (proxy_targets) yaziyor. Burada: vhost'un bir hedefi BU uygulamanin sunucusuna ve JVM'inin
// portlarindan birine gidiyorsa o vhost ADI NE OLURSA OLSUN bu uygulamanindir.
// Hedef sunucu cozumu Server Hub degerlendirmesiyle ayni: localhost/127.x -> vhost'un kendi sunucusu;
// IP -> Server_Hub_Ips'te o IP'yi tasiyan TEK sunucu (iki sunucuda ise VIP/kayan IP: cozulmez);
// ad -> ilk etiketin buyuk harfi. '~DYNAMIC'/'~TRUNC' isaretleri hedef degildir.
const portListesi = (s) => String(s || '').split(/[\s,]+/).filter((x) => /^[0-9]{1,5}$/.test(x));
function ipSahipleri(ipRows) {
  const m = new Map();
  for (const r of ipRows || []) {
    const ip = String(r.ip || '').trim();
    if (!ip) continue;
    if (!m.has(ip)) m.set(ip, new Set());
    m.get(ip).add(U(r.host));
  }
  return m;
}
function hedefSunucusu(hh, vhostHost, ipMap) {
  const h = String(hh || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return null;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h)) return U(vhostHost);
  if (/^[0-9.]+$/.test(h)) { const o = ipMap.get(h); return o && o.size === 1 ? [...o][0] : null; }
  return U(h.split('.')[0]);
}
function ajpWeb(appHost, jvm, vhostRows, ipMap) {
  if (!jvm) return [];
  const portlar = new Set([...portListesi(jvm.cfg_ports), ...portListesi(jvm.ports)]);
  if (!portlar.size) return [];
  const out = [];
  for (const v of vhostRows || []) {
    for (const t of String(v.proxy_targets || '').split(',')) {
      const x = t.trim();
      if (!x || x.startsWith('~')) continue;
      const i = x.lastIndexOf(':');
      if (i <= 0) continue;
      const port = x.slice(i + 1);
      if (!portlar.has(port) || hedefSunucusu(x.slice(0, i), v.host, ipMap) !== U(appHost)) continue;
      out.push({
        host: U(v.host), serverName: String(v.server_name || '').trim(), product: String(v.product || ''),
        port: String(v.listen || '').split(/[\s,]+/)[0].split(':').pop() || '', confFile: String(v.conf_file || ''),
        kaynak: 'ajp', ajpHedef: x,
      });
      break;
    }
  }
  return out;
}

function webUyariMetni(web, host, hubVhostsByHost) {
  const uc = web.tier === '3-tier' || (web.tier !== '2-tier' && (web.webHostAdaylari || []).length > 0);
  const aday = (web.webHostAdaylari || []).map((h) => `${U(h)}${hubVhostsByHost.has(U(h)) ? '' : ' (taramada yok)'}`);
  const denenen = [...aday, `${U(host)} (aynı host)`].join(', ');
  return `${uc ? '3-tier: ' : ''}web vhost'u BULUNAMADI — denenen: ${denenen}. Retirement bu vhost'u KAPATMAZ ve trafiğini kontrol edemez; web sunucusunu elle doğrulayın.`;
}

/**
 * ORTAK WEB ZENGINLESTIRME (2026-10-13, kullanici: "Denetim > Web-App sekmesinde de ayni gelistirmeyi
 * yapabilir miyiz?"). Sertifika envanteri eslesmesinin (matchWebForApp) uzerine iki kaynak:
 *   1) Server Hub vhost taramasi (sertifika envanterinde olmayan vhost'lar; ad ilk etiketi birebir)
 *   2) AJP/proxy hedefi = uygulamanin JVM portu (ad tutmasa da)
 * Retirement kesfi ve Denetim > Web-App AYNI fonksiyonu kullanir - iki ekran ayni cevabi verir.
 * @param {object} ctx { hubVhostsByHost: Map, vhostRows: object[], ipMap: Map, jvm: object|null }
 */
// ── DORDUNCU WEB KAYNAGI: MOD_CLUSTER BALANCER ADI (2026-10-13) ─────────────────────────
// Kullanici: "IBM Apache'ler her zaman mod_jk + AJP ile JBoss 7'ye, Red Hat Apache'ler her zaman
// mod_cluster + AJP ile JBoss 8'e baglanir. Red Hat Apache'lerde yalniz mod_cluster'a uygun balancer
// ismi yazar; JBoss 8'ler kendini kendi Apache'sine advertise eder." Uretim konfigurasyonunda (gbjbop35)
// kalip tutarli: `<APP>.conf` icinde `ProxyPass / balancer://<app kucuk harf>/` - BALANCER ADI =
// UYGULAMA ADI. Uyeler dinamik oldugu icin port eslesmesi YOK; esleme su uc sartla:
//   1) balancer adi uygulama adiyla BIREBIR (alt cizgi varyantlari dahil, ortam eki dahil)
//   2) hedef JBoss 8 (ya da surumu bilinmiyor) - JBoss 7 mod_cluster kullanmaz; JBoss 7 retirement'i
//      JBoss 8'in vhost'unu ALMAZ
//   3) web sunucusu uygulama sunucusunun KENDISI ya da AYNI site + AYNI ortam harfinde
//      (advertise ayni ag/ortam icinde; Ankara Pendik'i, test prod'u almaz)
// Hangi JVM'in o an uye oldugu dogrulanmaz; ekran bunu "mod_cluster" etiketiyle ayri gosterir.
const envHarfi = (h) => { const m = /([A-Z])\d+$/.exec(U(h)); return m ? m[1] : ''; };
function mcWeb(app, appHost, gen, vhostRows) {
  if (Number(gen) === 7) return [];
  const adlar = new Set(adVaryantlari(app));
  const site = siteOf(appHost);
  const env = envHarfi(appHost);
  const out = [];
  for (const v of vhostRows || []) {
    const vh = U(v.host);
    if (!(vh === U(appHost) || (siteOf(vh) === site && envHarfi(vh) === env))) continue;
    const bal = String(v.proxy_targets || '').split(',').map((x) => x.trim().toLowerCase())
      .filter((x) => x && !x.startsWith('~') && !x.includes(':'));
    const hit = bal.find((b) => adlar.has(b));
    if (!hit) continue;
    out.push({
      host: vh, serverName: String(v.server_name || '').trim(), product: String(v.product || ''),
      port: String(v.listen || '').split(/[\s,]+/)[0].split(':').pop() || '', confFile: String(v.conf_file || ''),
      kaynak: 'mc', mcBalancer: hit,
    });
  }
  return out;
}

// -- ADAY VHOST INDEKSI (2026-10-23, kullanici: "denetim -> web-app envanteri vb. sayfalar cok gec
// yukleniyor") -------------------------------------------------------------------------------------
// ajpWeb / mcWeb her uygulama satiri icin filonun TUM vhost listesini tariyordu (uygulama x vhost); Web-App
// soguk hesabi sentetik 5000 x 20000'de 25,6 sn surdu ve olay dongusunu kilitledi (retirement kesfi de ayni
// koddan gecer). Indeks yalniz ADAY secer: (cozulmus hedef sunucu, port) -> vhost'lar ve balancer adi ->
// vhost'lar. Esleme kurali ajpWeb/mcWeb'de AYNEN kalir (ilk tutan hedefte dur, localhost/127.x, IP tek
// sahip, '~', JBoss 7, site+ortam); aday kumesi gercek eslesmelerin UST KUMESI ve sirasi korunur.
// Indeks ayni vhost dizisi + ipMap icin BIR KEZ kurulur (WeakMap - istek bitince serbest kalir).
const BOS_IP = new Map();
const _vhostIndeksleri = new WeakMap();
function vhostIndeksi(vhostRows, ipMap) {
  let ipBasina = _vhostIndeksleri.get(vhostRows);
  if (!ipBasina) _vhostIndeksleri.set(vhostRows, (ipBasina = new WeakMap()));
  const hazir = ipBasina.get(ipMap);
  if (hazir) return hazir;
  const ajp = new Map();
  const mc = new Map();
  const ekle = (m, k, vi) => {
    let l = m.get(k);
    if (!l) m.set(k, (l = []));
    if (l[l.length - 1] !== vi) l.push(vi);
  };
  for (let vi = 0; vi < vhostRows.length; vi++) {
    const v = vhostRows[vi];
    for (const t of String(v.proxy_targets || '').split(',')) {
      const x = t.trim();
      if (!x || x.startsWith('~')) continue;
      const i = x.lastIndexOf(':');
      if (i > 0) {
        const srv = hedefSunucusu(x.slice(0, i), v.host, ipMap);
        if (srv != null) {
          let pm = ajp.get(srv);
          if (!pm) ajp.set(srv, (pm = new Map()));
          ekle(pm, x.slice(i + 1), vi);
        }
      } else if (!x.includes(':')) {
        ekle(mc, x.toLowerCase(), vi);
      }
    }
  }
  const idx = { ajp, mc };
  ipBasina.set(ipMap, idx);
  return idx;
}
/** Bu uygulamanin ajpWeb/mcWeb'de eslesebilecegi vhost'lar (ust kume), orijinal sirayla. */
function adayVhostlar(app, host, ctx) {
  const vhostRows = ctx.vhostRows || [];
  if (!vhostRows.length) return vhostRows;
  const idx = vhostIndeksi(vhostRows, ctx.ipMap || BOS_IP);
  const set = new Set();
  const jvm = ctx.jvm || null;
  if (jvm) {
    const pm = idx.ajp.get(U(host));
    if (pm) {
      for (const p of new Set([...portListesi(jvm.cfg_ports), ...portListesi(jvm.ports)])) {
        for (const vi of pm.get(p) || []) set.add(vi);
      }
    }
  }
  if (ctx.modCluster !== false && Number(ctx.gen ?? null) !== 7) {
    for (const ad of adVaryantlari(app)) for (const vi of idx.mc.get(ad) || []) set.add(vi);
  }
  return [...set].sort((a, b) => a - b).map((vi) => vhostRows[vi]);
}

function webZenginlestir(app, host, web, ctx) {
  let w = web;
  if (!w.matched) w = hubWebFallback(app, host, w, ctx.hubVhostsByHost || new Map());
  const anahtar = (x) => `${U(x.host)}|${String(x.serverName || '').toLowerCase()}|${x.port || ''}|${x.confFile || ''}`;
  const ekle = (wx, liste, tur, ozet, kisa) => {
    if (!liste.length) return wx;
    const mevcut = new Map((wx.web || []).map((x) => [anahtar(x), { ...x }]));
    // AYNI DOSYA, IKI YAZIM (bkz. web-liste.cjs): IHS sertifika girdisi 'mod-jk.conf' = Server Hub
    // '/usr/IBMIHS/conf/mod-jk.conf' (ayni host + ServerName + port). BELIRLENIMCI: baska kokun
    // '<...>/conf/X'i ya da RHA dosyasi birlesmez. Birlesen girdi Map'te YERINDE kalir (satir sirasi
    // degismez), 'ad+tur' olur ve mutlak yolu alir.
    const kanonik = new Map();
    for (const [mk, x] of mevcut) {
      const c = webConfKanonik(x);
      if (c !== String(x.confFile || '')) kanonik.set(anahtar({ ...x, confFile: c }), mk);
    }
    let yeni = 0;
    for (const a of liste) {
      const k = anahtar(a);
      const hedef = mevcut.has(k) ? k : (urunAilesi(a.product) !== 'RHA' ? kanonik.get(k) : undefined);
      if (hedef && hedef !== k) mevcut.get(hedef).confFile = a.confFile;
      if (hedef) {
        const m = mevcut.get(hedef);
        m.kaynak = m.kaynak && m.kaynak !== 'ad' ? `${m.kaynak}+${tur}` : `ad+${tur}`;
        if (a.ajpHedef) m.ajpHedef = a.ajpHedef;
        if (a.mcBalancer) m.mcBalancer = a.mcBalancer;
      } else { mevcut.set(k, a); yeni += 1; }
    }
    return { ...wx, matched: true, web: [...mevcut.values()],
      how: `${wx.matched ? `${wx.how} + ` : ''}${ozet} (${liste.length} vhost${yeni ? `, ${yeni} yalniz ${kisa} ile bulundu` : ''})` };
  };
  // Tum filo yerine yalniz ADAY vhost'lar (bkz. vhostIndeksi) - sonuc ayni, is uygulama x vhost degil.
  const ipMap = ctx.ipMap || BOS_IP;
  const adaylar = adayVhostlar(app, host, { ...ctx, ipMap });
  w = ekle(w, ajpWeb(host, ctx.jvm || null, adaylar, ipMap), 'ajp', 'AJP/proxy hedefi = JVM portu', 'AJP');
  if (ctx.modCluster !== false) w = ekle(w, mcWeb(app, host, ctx.gen ?? null, adaylar), 'mc', 'mod_cluster balancer adı = uygulama adı', 'mod_cluster');
  return w;
}

/** Server Hub baglami (en yeni tarama): vhost'lar, JVM portlari, IP sahipleri. Okunamayan kaynak bos kalir. */
async function hubBaglamiYukle(query) {
  const enYeni = `JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m ON m.host = t.host AND m.d = t.scan_date`;
  const jvmCols = await query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Server_Hub_Jvms')`)
    .then((r) => (r.recordset || []).map((c) => String(c.name).toLowerCase()))
    .catch(() => []);
  const jvmSel = ['host', 'jvm', 'ports'].concat(jvmCols.includes('gen') ? ['gen'] : []).concat(jvmCols.includes('cfg_ports') ? ['cfg_ports'] : []).map((c) => `t.${c}`).join(', ');
  const hata = [];
  const [vhostRows, jvmRows, ipRows] = await Promise.all([
    query(`SELECT t.host, t.server_name, t.aliases, t.listen, t.conf_file, t.product, t.proxy_targets FROM dbo.Server_Hub_Vhosts t ${enYeni}`)
      .then((r) => r.recordset || []).catch((e) => { hata.push(`vhost: ${e.message}`); return []; }),
    jvmCols.length
      ? query(`SELECT ${jvmSel} FROM dbo.Server_Hub_Jvms t ${enYeni}`).then((r) => r.recordset || []).catch((e) => { hata.push(`jvm: ${e.message}`); return []; })
      : Promise.resolve([]),
    query(`SELECT t.host, t.ip FROM dbo.Server_Hub_Ips t ${enYeni}`).then((r) => r.recordset || []).catch(() => []),
  ]);
  const hubVhostsByHost = new Map();
  for (const v of vhostRows) {
    const h = U(v.host);
    if (!hubVhostsByHost.has(h)) hubVhostsByHost.set(h, []);
    hubVhostsByHost.get(h).push(v);
  }
  const jvms = jvmIndeksi(jvmRows);
  return { vhostRows, hubVhostsByHost, ipMap: ipSahipleri(ipRows), jvmOf: (host, app, gen = null) => jvmSec(jvms, host, app, gen), hata };
}

// IN-PLACE ISARETI + WEB ADIMI (job_3438186 denetimi): ayni sunucu + uygulama birden cok kolda ise
// hedef `inPlace` (ve `digerSurumler`) tasir. Web listesinde YALNIZ AD / SERTIFIKA eslesmesiyle
// bulunan vhost hangi kurulumun onunde durdugunu SOYLEMEZ (JBoss 7 retire'i JBoss 8'in Red Hat
// Apache vhost'unu kapatabiliyordu): in-place hedefte bu girdiler `elle` isaretlenir ve otomatik
// kapatilmaz. Otomatik kalanlar: AJP/proxy hedefi SECILEN kurulumun JVM portu (ajp) ya da
// mod_cluster (mc - yalniz JBoss 8, mcWeb zaten kolu suzer).
function inPlaceIsaretle(targets) {
  const kollar = new Map();
  for (const t of targets) {
    const k = `${t.host}|${U(t.appName)}`;
    if (!kollar.has(k)) kollar.set(k, new Set());
    kollar.get(k).add(t.gen ?? 0);
  }
  // DIGER KURULUMUN KESIN VHOST'U (2026-10-27, kullanici: "Jboss7 sectim gidip Redhat Apache'yi de bulup islem
  // yapmaya calisiyor gibi"): JBoss 7 hedefi RHA mod_cluster vhost'unu yalniz adiyla buluyordu; ayni vhost'u
  // JBoss 8 hedefi mod_cluster ile KESIN eslestiriyor. Yalniz ad/sertifika ile eslesen ve diger kurulumun ajp/mc
  // ile sahiplendigi vhost bu hedefin listesinden cikar (o kurulumun onunde durur). Sahipsiz olan 'elle' kalir.
  const kesin = (w) => /(^|\+)(ajp|mc)(\+|$)/.test(String(w.kaynak || 'ad'));
  const sahipli = new Map();
  for (const t of targets) {
    for (const w of t.web || []) {
      if (!kesin(w)) continue;
      const k = `${t.host}|${U(t.appName)}|${webKanonikAnahtar(w)}`;
      if (!sahipli.has(k)) sahipli.set(k, new Set());
      sahipli.get(k).add(t.gen ?? 0);
    }
  }
  for (const t of targets) {
    const set = kollar.get(`${t.host}|${U(t.appName)}`);
    if (!set || set.size < 2) continue;
    t.inPlace = true;
    t.digerSurumler = [...set].filter((g) => g !== (t.gen ?? 0)).sort();
    const diger = t.digerSurumler.map((g) => (g ? `JBoss ${g}` : 'sürümü bilinmeyen kurulum')).join(', ');
    t.web = (t.web || [])
      .filter((w) => {
        if (kesin(w)) return true;
        const s = sahipli.get(`${t.host}|${U(t.appName)}|${webKanonikAnahtar(w)}`);
        return !s || ![...s].some((g) => g !== (t.gen ?? 0));
      })
      .map((w) => {
        if (kesin(w)) return w;
        return { ...w, elle: `in-place: ${t.appName} bu sunucuda ${diger} kurulumunda da var; vhost yalnız ad/sertifika ile eşleşti, hangi kurulumun önünde olduğu doğrulanamadı — otomatik kapatılmaz, elle kontrol edilmeli` };
      });
  }
}

function buildTargets(base, invRows, certRows, jvmRows, vhostRows, ipRows = []) {
  const ipMap = ipSahipleri(ipRows);
  const certByHost = buildCertIndex(certRows || []);
  const jvms = jvmIndeksi(jvmRows);
  // VHOST TRAFIGI: host + server_name ile anahtarlanir. `server_name` BUYUK/KUCUK HARF
  // DUYARSIZ karsilastirilir (Apache sunucu adlarini kasa korumadan yaziyor); kasaya
  // duyarli bir anahtar, olculmus trafigi "olculemedi" gosterirdi.
  const vhostByKey = new Map(
    (vhostRows || []).map((v) => [`${U(v.host)}|${String(v.server_name || '').trim().toLowerCase()}`, v]),
  );
  const hubVhostsByHost = new Map();
  for (const v of vhostRows || []) {
    const h = U(v.host);
    if (!hubVhostsByHost.has(h)) hubVhostsByHost.set(h, []);
    hubVhostsByHost.get(h).push(v);
  }
  const seen = new Set();
  const targets = [];
  for (const r of invRows || []) {
    const app = String(r.app || '').trim();
    const host = U(r.host);
    if (!app || !host) continue;
    const { base: b } = parseAppName(app);
    const env = hedefOrtami(app, r.env);
    if (U(b) !== U(base)) continue;
    // IN-PLACE (job_3438186, 2026-10-22 - CANLI ETKI): ayni uygulama ayni sunucuda hem JBoss 7 hem
    // JBoss 8'de calisabilir; envanter iki satir dondurur. Anahtar eskiden `host|app` idi: IKINCI satir
    // atiliyor, hangi surumun gorunecegini SQL satir sirasi (ORDER BY yok) seciyordu - JBoss 7 retire
    // edilmek istenirken JBoss 8 hedefi olusabiliyordu ve betik bunu yakalayamaz (yol ve surum tutarli).
    // Anahtar KOL'u da icerir: iki kurulum iki ayri hedef, kullanici hangisini acikca secer.
    const gen = kolOf(r.app_path, r.jboss_version);
    const key = `${host}|${app}|${gen ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const j = jvmSec(jvms, host, app, gen);
    // Sertifika eslesmesi + Server Hub + AJP/proxy (ortak: Denetim > Web-App de kullanir).
    const web = webZenginlestir(app, host, matchWebForApp({ app, appHost: host, domain: r.domain || '' }, certByHost),
      { hubVhostsByHost, vhostRows, ipMap, jvm: j, gen });
    // SOZLESME v3 (D1-C15, D1-C28): running=0 tek basina "kapali" DEGIL. running_src
    // UNMEASURED (hidepid / ps korlugu) ise calisma durumu BILINMIYOR; NULL (eski satir ya da
    // kolon henuz yok) bilinen sayilir.
    const runningSrc = j && j.running_src != null && j.running_src !== '' ? U(j.running_src) : null;
    // JBOSS 7 + YALNIZ ADLA BULUNAN RHA (2026-10-27, kullanici: "Jboss7 secimi yaptigimda neden gidip Redhat
    // Apache'deki vhost'u kesfedip kullaniciya yansitiyoruz? kafa karistiriyor"). RHA, JBoss 7'nin onunde ancak
    // AJP/proxy ile durur ve o bag kesin eslesmeyle (kaynak ajp) bulunur. Yalniz ad/sertifika ile eslesen RHA
    // vhost'u JBoss 8'in mod_cluster onudur: listelenmez, otomatik kapatilmaz; sayisi webHow'da soylenir.
    const rhaAd = (w) => gen === 7 && urunAilesi(w.product) === 'RHA' && !/(^|\+)(ajp|mc)(\+|$)/.test(String(w.kaynak || 'ad'));
    const elenenRha = web.web.filter(rhaAd).length;
    if (elenenRha) web.web = web.web.filter((w) => !rhaAd(w));
    targets.push({
      host, site: siteOf(host), env, appName: app, gen,
      appPath: paketYolu(r.app_path), inventoryStatus: r.status || '', domain: r.domain || '', tier: web.tier,
      web: web.web.map((w) => ({
        host: w.host, serverName: w.serverName, product: w.product, port: w.port, confFile: w.confFile,
        kaynak: w.kaynak || 'ad', ...(w.ajpHedef ? { ajpHedef: w.ajpHedef } : {}), ...(w.mcBalancer ? { mcBalancer: w.mcBalancer } : {}),
        trafik: trafikSinifi(vhostByKey.get(`${U(w.host)}|${String(w.serverName || '').trim().toLowerCase()}`)),
      })),
      webHow: elenenRha ? `${web.how} · JBoss 7 için yalnız adla eşleşen ${elenenRha} Red Hat Apache vhost'u sayılmadı (JBoss 8'in mod_cluster önü)` : web.how,
      // WEB BULUNAMADI UYARISI (2026-10-12, kullanici: "3-tier bir uygulamayi retire etmek
      // istedigimizde web vhost icin herhangi bir uyari vermedi"). Bos web listesi "web yok"
      // DEMEK DEGIL: retirement o vhost'u KAPATMAZ ve trafik kontrolu de yapamaz.
      webUyari: web.web.length ? null : webUyariMetni(web, host, hubVhostsByHost),
      hub: j ? {
        running: Number(j.running) === 1,
        runningSrc,
        runningKnown: runningSrc !== 'UNMEASURED',
        autoStart: String(j.auto_start || 'unknown'),
        scanDate: j.scan_date ? new Date(j.scan_date).toISOString().slice(0, 10) : null,
      } : null,
    });
  }
  inPlaceIsaretle(targets);
  const order = { PROD: 0, QA: 1, TEST: 2, DEV: 3, ALPHA: 4, ODM: 5 };
  targets.sort((a, b) => (order[a.env] ?? 9) - (order[b.env] ?? 9) || a.site.localeCompare(b.site) || a.host.localeCompare(b.host) || (a.gen ?? 0) - (b.gen ?? 0));
  const summary = {
    total: targets.length,
    bySite: { Pendik: targets.filter((t) => t.site === 'Pendik').length, Ankara: targets.filter((t) => t.site === 'Ankara').length },
    byEnv: Object.fromEntries(['PROD', 'QA', 'TEST', 'DEV', 'ALPHA', 'ODM'].map((e) => [e, targets.filter((t) => t.env === e).length])),
    webMatched: targets.filter((t) => t.web.length).length,
    webBulunamadi: targets.filter((t) => !t.web.length).length,
    prod: targets.some((t) => t.env === 'PROD'),
  };
  return { base, targets, summary };
}

/**
 * @param {string} base
 * @param {{ query: Function, sql: object }} [db]  test icin enjekte edilebilir (varsayilan mssql.cjs)
 */
async function discover(base, db) {
  const { query, sql } = db || require('../inventory/mssql.cjs');
  const p = [{ name: 'b', type: sql.NVarChar(128), value: base }];
  // KOLON LISTESI sys.columns'tan (sozlesme v3 P9): running_src yalniz semada VARSA secilir.
  // Eskiden sorgu sabitti ve asagidaki .catch, kolon eksikligini de yutup TUM hedefleri
  // "tarama yok" gosterebilirdi; artik eksik kolon sorguyu dusurmez.
  // KOLON SORGUSU DUSERSE KAPALI (C3): eskiden .catch(() => []) running_src'yi sessizce
  // dusuruyor, v3 UNMEASURED JVM "kapali" okunuyordu. Artik bu Server Hub'in OKUNAMAMASIDIR:
  // hubUnavailable=true ve hicbir hedefe hub verisi baglanmaz (ekran "okunamadi" der).
  let hubError = null;
  let trafikError = null;
  const jvmCols = await query(
    `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Server_Hub_Jvms')`,
  )
    .then((r) => (r.recordset || []).map((c) => String(c.name).toLowerCase()))
    .catch((e) => {
      hubError = `sema okunamadi: ${String((e && e.message) || e || 'okunamadi')}`;
      console.warn('[Retirement] Server_Hub_Jvms kolonlari okunamadi:', hubError);
      return null;
    });
  const jvmSel = ['host', 'jvm', 'gen', 'running', 'auto_start', 'scan_date', 'ports']
    .concat(jvmCols && jvmCols.includes('running_src') ? ['running_src'] : [])
    .concat(jvmCols && jvmCols.includes('cfg_ports') ? ['cfg_ports'] : [])
    .map((c) => `t.${c}`)
    .join(', ');
  const [inv, certs, jvms, vhosts, ips] = await Promise.all([
    query(`SELECT DISTINCT app, host, env, domain, jboss_version, app_path, status FROM dbo.MWAppsInventory WHERE app = @b OR app LIKE @b + '-_'`, p).then((r) => r.recordset || []),
    query(`SELECT host, ip, port, server_name, conf_file, product, env FROM dbo.BMW_Certificates_Inventory`).then((r) => r.recordset || []).catch(() => []),
    jvmCols == null
      ? Promise.resolve([])
      : query(`SELECT ${jvmSel} FROM dbo.Server_Hub_Jvms t
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m ON m.host = t.host AND m.d = t.scan_date
            WHERE t.jvm = @b OR t.jvm LIKE @b + '-_'`, p).then((r) => r.recordset || []).catch((e) => {
          // OLCULEMEDI != YOK: Server Hub okunamadiysa bu "tarama yok" degil; ozet bunu tasir.
          hubError = String((e && e.message) || e || 'okunamadi');
          console.warn('[Retirement] Server_Hub_Jvms okunamadi:', hubError);
          return [];
        }),
    // VHOST TRAFIGI (en yeni tarama). Kolonlar migration ile geldigi icin SELECT * DEGIL
    // acik liste; okunamazsa BOS doner ve her vhost 'olculemedi' olur - "trafik yok"
    // DEGIL. Tablo/kolon yoksa da ayni yere duser.
    query(`SELECT v.host, v.server_name, v.aliases, v.listen, v.conf_file, v.product, v.proxy_targets, v.req_24h, v.req_7d, v.hc_24h,
                  v.traffic_state, v.traffic_reason, v.sampled, v.last_req_epoch, v.scan_date
             FROM dbo.Server_Hub_Vhosts v
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
               ON m.host = v.host AND m.d = v.scan_date`).then((r) => r.recordset || []).catch((e) => {
          trafikError = String((e && e.message) || e || 'okunamadi');
          console.warn('[Retirement] Server_Hub_Vhosts okunamadi:', trafikError);
          return [];
        }),
    // AJP/proxy hedefindeki IP'yi sunucuya cevirmek icin (en yeni tarama). Okunamazsa IP hedefler cozulmez.
    query(`SELECT i.host, i.ip FROM dbo.Server_Hub_Ips i
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
               ON m.host = i.host AND m.d = i.scan_date`).then((r) => r.recordset || []).catch(() => []),
  ]);
  const out = buildTargets(base, inv, certs, jvms, vhosts, ips);
  out.summary.hubUnavailable = hubError != null;
  // TRAFIK OZETI: kayit acma ekraninin uyari sorusu bunu okuyor. Uc sayi AYRI tutulur -
  // "olculemedi" ne "var" ne "yok" kovasina katilir.
  const tumWeb = out.targets.flatMap((t) => t.web || []);
  out.summary.trafik = {
    vhost: tumWeb.length,
    var: tumWeb.filter((w) => w.trafik?.durum === 'var').length,
    yok: tumWeb.filter((w) => w.trafik?.durum === 'yok').length,
    olculemedi: tumWeb.filter((w) => w.trafik?.durum === 'olculemedi').length,
    // hc HARIC 7 gunluk toplam; sampled varsa ALT SINIR oldugu ayrica bildirilir.
    req7Toplam: tumWeb.reduce((a, w) => a + (w.trafik?.durum === 'var' ? w.trafik.req7 : 0), 0),
    altSinir: tumWeb.some((w) => w.trafik?.durum === 'var' && w.trafik.sampled),
    okunamadi: trafikError,
  };
  return out;
}

async function searchApps(q) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const r = await query(
    `SELECT DISTINCT TOP 30 app FROM dbo.MWAppsInventory WHERE app LIKE '%' + @q + '%' ORDER BY app`,
    [{ name: 'q', type: sql.NVarChar(128), value: String(q || '').slice(0, 64) }],
  );
  const bases = new Set();
  for (const row of r.recordset || []) bases.add(parseAppName(row.app).base);
  return [...bases].sort();
}

module.exports = { buildTargets, discover, searchApps, siteOf, parseAppName, hedefOrtami, genOf, kolOf, paketYolu, inPlaceIsaretle, jvmIndeksi, jvmSec, trafikSinifi, ajpWeb, mcWeb, hedefSunucusu, webZenginlestir, hubBaglamiYukle, adayVhostlar, ipSahipleri };
