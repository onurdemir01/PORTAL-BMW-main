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

const { buildCertIndex, matchWebForApp } = require('../audit/web-app.cjs');

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

function genOf(jbossVersion) {
  const v = String(jbossVersion || '');
  if (/(^|[^0-9])8([^0-9]|$)/.test(v) || /jboss8|eap.?8/i.test(v)) return 8;
  if (/(^|[^0-9])7([^0-9]|$)/.test(v) || /jboss7|eap.?7/i.test(v)) return 7;
  return null;
}

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
  const needle = String(app).toLowerCase();
  const ilkEtiket = (s) => String(s || '').trim().toLowerCase().split('.')[0];
  // Aday aplikasyon sunucusunun KENDISIYSE etiketi 'ayni host' (harf donusumu bir sey bulmadi).
  const adaylar = [
    { host: certSonucu.webHostCandidate, how: U(certSonucu.webHostCandidate) === U(appHost) ? 'aynı host' : 'harf-dönüşümü' },
    { host: appHost, how: 'aynı host' },
  ];
  const goruldu = new Set();
  for (const c of adaylar) {
    const h = U(c.host);
    if (!h || goruldu.has(h)) continue;
    goruldu.add(h);
    const list = hubVhostsByHost.get(h) || [];
    const hits = list.filter((v) =>
      [v.server_name, ...String(v.aliases || '').split(/[\s,]+/)].some((n) => n && ilkEtiket(n) === needle),
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

function buildTargets(base, invRows, certRows, jvmRows, vhostRows) {
  const certByHost = buildCertIndex(certRows || []);
  const jvmKey = (h, j) => `${U(h)}|${U(j)}`;
  const jvms = new Map((jvmRows || []).map((r) => [jvmKey(r.host, r.jvm), r]));
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
    const { base: b, env } = parseAppName(app);
    if (U(b) !== U(base)) continue;
    const key = `${host}|${app}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const gen = genOf(r.jboss_version);
    let web = matchWebForApp({ app, appHost: host, domain: r.domain || '' }, certByHost);
    if (!web.matched) web = hubWebFallback(app, host, web, hubVhostsByHost);
    const j = jvms.get(jvmKey(host, app));
    // SOZLESME v3 (D1-C15, D1-C28): running=0 tek basina "kapali" DEGIL. running_src
    // UNMEASURED (hidepid / ps korlugu) ise calisma durumu BILINMIYOR; NULL (eski satir ya da
    // kolon henuz yok) bilinen sayilir.
    const runningSrc = j && j.running_src != null && j.running_src !== '' ? U(j.running_src) : null;
    targets.push({
      host, site: siteOf(host), env, appName: app, gen,
      appPath: r.app_path || '', inventoryStatus: r.status || '', domain: r.domain || '', tier: web.tier,
      web: web.web.map((w) => ({
        host: w.host, serverName: w.serverName, product: w.product, port: w.port, confFile: w.confFile,
        trafik: trafikSinifi(vhostByKey.get(`${U(w.host)}|${String(w.serverName || '').trim().toLowerCase()}`)),
      })),
      webHow: web.how,
      hub: j ? {
        running: Number(j.running) === 1,
        runningSrc,
        runningKnown: runningSrc !== 'UNMEASURED',
        autoStart: String(j.auto_start || 'unknown'),
        scanDate: j.scan_date ? new Date(j.scan_date).toISOString().slice(0, 10) : null,
      } : null,
    });
  }
  const order = { PROD: 0, QA: 1, TEST: 2, DEV: 3 };
  targets.sort((a, b) => (order[a.env] ?? 9) - (order[b.env] ?? 9) || a.site.localeCompare(b.site) || a.host.localeCompare(b.host));
  const summary = {
    total: targets.length,
    bySite: { Pendik: targets.filter((t) => t.site === 'Pendik').length, Ankara: targets.filter((t) => t.site === 'Ankara').length },
    byEnv: Object.fromEntries(['PROD', 'QA', 'TEST', 'DEV'].map((e) => [e, targets.filter((t) => t.env === e).length])),
    webMatched: targets.filter((t) => t.web.length).length,
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
  const jvmSel = ['host', 'jvm', 'running', 'auto_start', 'scan_date']
    .concat(jvmCols && jvmCols.includes('running_src') ? ['running_src'] : [])
    .map((c) => `t.${c}`)
    .join(', ');
  const [inv, certs, jvms, vhosts] = await Promise.all([
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
    query(`SELECT v.host, v.server_name, v.aliases, v.listen, v.conf_file, v.product, v.req_24h, v.req_7d, v.hc_24h,
                  v.traffic_state, v.traffic_reason, v.sampled, v.last_req_epoch, v.scan_date
             FROM dbo.Server_Hub_Vhosts v
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
               ON m.host = v.host AND m.d = v.scan_date`).then((r) => r.recordset || []).catch((e) => {
          trafikError = String((e && e.message) || e || 'okunamadi');
          console.warn('[Retirement] Server_Hub_Vhosts okunamadi:', trafikError);
          return [];
        }),
  ]);
  const out = buildTargets(base, inv, certs, jvms, vhosts);
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

module.exports = { buildTargets, discover, searchApps, siteOf, parseAppName, genOf, trafikSinifi };
