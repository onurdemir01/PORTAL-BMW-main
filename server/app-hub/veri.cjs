// server/app-hub/veri.cjs - Uygulama Hub veri okuyuculari (2026-11-08).
//
// Kullanici: "baglanan kisi sadece uygulamasinin ismini yazip bu uygulamaya dair her sey
// gozuksun: JBoss ise hangi versiyonlarda, hangi sunucularda, hangi JVM parametreleriyle
// kostugu, ne kadar yuk aldigi, Apache sunucularinin isimleri, sunucuda ne kadar kapasite
// oldugu; OpenShift ise namespace, cluster, replika, Deployment mi Argo Rollout mu, JVM
// parametreleri, node'lar, root adres."
//
// YENI KAYNAK ICAT EDILMEZ; mevcut okuyucular birlestirilir:
//   JBoss  MWAppsInventory (surum, JDK, heap, yol)  + retirement/discover (sunucu, web, trafik)
//          + Server Hub assess/hostDetail (JVM, port, calisma, MASKELI jvm_args)
//          + Inventory (CPU / bellek toplami)
//   WAS    WASAppsInventory + Inventory + audit/web-app eslemesi (sertifika envanteri)
//          + Uygulama Envanteri was_ozeti (server.xml JVM ayarlari, toplandiysa)
//   OCP    Openshift_Inventory (cluster, namespace) + ocp_cluster_index (env, tenant)
//          + ocp_app_cache (tur / replika / imaj) + BMW_Openshift_Route_Inventory (route)
//          + BMW_Application_Usage (Dynatrace istek) + canli detay (app_hub_ocp_canli)
//
// OLCULEMEDI != YOK: her kaynak kendi `okunamadi` alanini tasir; okunamayan kaynak bos liste
// gibi gosterilmez. Kapasite ALANI TOPLAMDIR (Inventory.cpu cekirdek, memory MB): kullanim
// degildir, ekran da oyle yazar.
'use strict';

const L = (s) => String(s == null ? '' : s).trim().toLowerCase();
const U = (s) => String(s == null ? '' : s).trim().toUpperCase();
const nz = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const sayi = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const AD_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ARA_RE = /^[A-Za-z0-9._-]{2,64}$/;
const HOST_TAVAN = 60;

function mssql() {
  return require('../inventory/mssql.cjs');
}

const hataMetni = (e) => String((e && e.message) || e || 'okunamadi').slice(0, 300);

/** Bir sorguyu calistirir; hata firlatmaz, { rows, hata } doner (OLCULEMEDI ayrimi icin). */
async function guvenli(sqlText, params) {
  const { query } = mssql();
  try {
    const r = await query(sqlText, params || []);
    return { rows: r.recordset || [], hata: null };
  } catch (e) {
    return { rows: [], hata: hataMetni(e) };
  }
}

function tablolar() {
  const t = require('../config/apps-table.cjs');
  return { jboss: t.getAppsTable(), was: t.getWasAppsTable() };
}

// ── Arama ───────────────────────────────────────────────────────────────────────

/**
 * Uygulama adiyla uc tipte arama. JBoss adlari taban ada toplanir (<APP>-D/-T/-Q ayni uygulama).
 * Siralama: tam eslesme, sonra onek, sonra icerir; her tipten en cok 25.
 */
async function ara(q) {
  const { sql } = mssql();
  const t = tablolar();
  const p = [{ name: 'q', type: sql.NVarChar(64), value: q }];
  const { parseAppName } = require('../retirement/discover.cjs');
  const [jb, wa, oc] = await Promise.all([
    guvenli(
      `SELECT TOP 400 app, UPPER(host) AS host FROM dbo.${t.jboss} WHERE app LIKE '%' + @q + '%'`,
      p,
    ),
    guvenli(
      `SELECT TOP 100 app, COUNT(DISTINCT host) AS n FROM dbo.${t.was}
        WHERE app LIKE '%' + @q + '%' AND app <> 'NOAPP' GROUP BY app`,
      p,
    ),
    guvenli(
      `SELECT TOP 100 application AS app, COUNT(DISTINCT namespace) AS ns, COUNT(DISTINCT cluster) AS cl
         FROM dbo.Openshift_Inventory WHERE application LIKE '%' + @q + '%' GROUP BY application`,
      p,
    ),
  ]);
  const jbGrup = new Map();
  for (const r of jb.rows) {
    const base = parseAppName(r.app).base;
    if (!base) continue;
    const k = U(base);
    if (!jbGrup.has(k)) jbGrup.set(k, { ad: base, hostlar: new Set(), varyant: new Set() });
    const g = jbGrup.get(k);
    g.hostlar.add(r.host);
    g.varyant.add(r.app);
  }
  const skor = (ad) => {
    const a = L(ad);
    const b = L(q);
    return a === b ? 0 : a.startsWith(b) ? 1 : 2;
  };
  const sirala = (x) => x.sort((a, b) => skor(a.ad) - skor(b.ad) || a.ad.localeCompare(b.ad, 'tr')).slice(0, 25);
  const sonuclar = [
    ...sirala(
      [...jbGrup.values()].map((g) => ({
        ad: g.ad,
        tip: 'jboss',
        ozet: `${g.hostlar.size} sunucu`,
        varyantlar: [...g.varyant].sort(),
      })),
    ),
    ...sirala(wa.rows.map((r) => ({ ad: String(r.app), tip: 'was', ozet: `${r.n} sunucu` }))),
    ...sirala(
      oc.rows.map((r) => ({ ad: String(r.app), tip: 'ocp', ozet: `${r.ns} namespace · ${r.cl} cluster` })),
    ),
  ].sort((a, b) => skor(a.ad) - skor(b.ad));
  const okunamayan = [];
  if (jb.hata) okunamayan.push({ tip: 'jboss', hata: jb.hata });
  if (wa.hata) okunamayan.push({ tip: 'was', hata: wa.hata });
  if (oc.hata) okunamayan.push({ tip: 'ocp', hata: oc.hata });
  return { sonuclar, okunamayan, kesildi: jb.rows.length >= 400 };
}

// ── Ortak: kapasite (Inventory) ────────────────────────────────────────────────

async function kapasiteOku(hostlar) {
  const liste = [...new Set((hostlar || []).map(U).filter(Boolean))].slice(0, HOST_TAVAN);
  const out = new Map();
  if (!liste.length) return { harita: out, hata: null };
  const { sql } = mssql();
  const params = liste.map((h, i) => ({ name: `h${i}`, type: sql.NVarChar(128), value: h }));
  const r = await guvenli(
    `SELECT * FROM dbo.Inventory WHERE UPPER(host) IN (${liste.map((_, i) => `@h${i}`).join(', ')})`,
    params,
  );
  for (const row of r.rows) {
    const mb = sayi(row.memory);
    out.set(U(row.host), {
      cpu: sayi(row.cpu),
      bellekGb: mb == null ? null : Math.round((mb / 1024) * 10) / 10,
      os: nz(row.os),
      osSurum: nz(row.os_version),
      ip: nz(row.ip),
      ortam: nz(row.env),
      jbossSurum: nz(row.jboss_version),
      wasSurum: nz(row.was_version),
      ihsSurum: nz(row.ihs_version),
      rhaSurum: nz(row.rha_version),
      nginxSurum: nz(row.nginx_version),
      jvmSayisi: sayi(row.jvm_count),
    });
  }
  return { harita: out, hata: r.hata };
}

// ── JBoss ──────────────────────────────────────────────────────────────────────

const heap = (v) => {
  const s = nz(v);
  if (!s) return null;
  return /^\d+$/.test(s) ? `${s} MB` : s;
};

async function jbossDetay(adHam) {
  const { parseAppName, discover } = require('../retirement/discover.cjs');
  const { tabanAd } = require('../server-hub/capraz.cjs');
  const base = parseAppName(adHam).base;
  const { sql } = mssql();
  const t = tablolar();
  const p = [{ name: 'b', type: sql.NVarChar(128), value: base }];

  const [mw, disc] = await Promise.all([
    guvenli(`SELECT * FROM dbo.${t.jboss} WHERE app = @b OR app LIKE @b + '-_'`, p),
    discover(base).then(
      (d) => ({ d, hata: null }),
      (e) => ({ d: null, hata: hataMetni(e) }),
    ),
  ]);
  if (!mw.hata && !mw.rows.length) return null;

  const hostlar = [...new Set(mw.rows.map((r) => U(r.host)).filter(Boolean))];
  const kap = await kapasiteOku(hostlar);

  // Server Hub: degerlendirme onbellekten (60 sn taze / 15 dk bayat), agir JVM kolonlari
  // yalniz bu uygulamanin sunuculari icin okunur. Okunamazsa bolum "okunamadi" der.
  let hub = { hata: null, jvmler: [], sonTarama: null };
  try {
    const sh = require('../server-hub/index.cjs');
    const a = await sh.getAssessment(false);
    hub.sonTarama = a.latestScan || null;
    if (a.tableMissing) hub.hata = 'Server Hub tablolari bulunamadi.';
    const hedef = new Set(hostlar);
    const eslesen = (a.hosts || []).filter((h) => hedef.has(U(h.host)) || hedef.has(U(String(h.host).split('.')[0])));
    for (const h of eslesen.slice(0, HOST_TAVAN)) {
      const agir = await sh.loadJvmAgir(h.host).catch(() => new Map());
      const d = sh.hostDetail(h, agir);
      for (const j of d.jvms || []) {
        if (U(tabanAd(j.name)) !== U(base)) continue;
        hub.jvmler.push({
          host: U(String(h.host).split('.')[0]),
          ad: j.name,
          nesil: Number(j.gen) || null,
          grup: j.group || null,
          calisiyor: j.runningKnown === false ? null : !!j.running,
          autoStart: j.autoStart || 'unknown',
          durum: j.serverState || null,
          portlar: j.ports || [],
          jvmArgs: j.jvmArgs || null,
          yapilandirilanJvmArgs: j.configuredJvmArgs || null,
          jvmArgFarki: j.jvmArgDiff || null,
          jvmArgDurumu: j.jvmArgStatus || null,
          jvmArgKaynagi: j.jvmArgsSrc || null,
          istek24s: j.req24h == null ? null : Number(j.req24h),
          istek7g: j.req7d == null ? null : Number(j.req7d),
          taze: h.fresh !== false,
          taramaTarihi: h.scanDate || null,
        });
      }
    }
  } catch (e) {
    hub.hata = hataMetni(e);
  }

  const hubIx = new Map();
  for (const j of hub.jvmler) {
    const k = `${j.host}|${L(j.ad)}`;
    if (!hubIx.has(k)) hubIx.set(k, []);
    hubIx.get(k).push(j);
  }
  const hedefIx = new Map();
  for (const tg of (disc.d && disc.d.targets) || []) hedefIx.set(`${U(tg.host)}|${L(tg.appName)}`, tg);

  const sunucular = mw.rows
    .map((r) => {
      const host = U(r.host);
      const hedefK = `${host}|${L(r.app)}`;
      const tg = hedefIx.get(hedefK) || null;
      const jvms = hubIx.get(hedefK) || [];
      return {
        host,
        uygulama: String(r.app),
        ortam: (tg && tg.env) || nz(r.env),
        site: (tg && tg.site) || null,
        jbossSurum: nz(r.jboss_version),
        nesil: (tg && tg.gen) || (jvms[0] && jvms[0].nesil) || null,
        jdk: nz(r.jdk_type),
        jre: nz(r.jre_version),
        envanterDurumu: nz(r.status),
        uygulamaYolu: nz(r.app_path),
        tier: (tg && tg.tier) || nz(r.tier),
        jvmSayisi: sayi(r.jvm_count),
        minHeap: heap(r.min_heap),
        maxHeap: heap(r.max_heap),
        autoStartEnvanter: nz(r.autostarts),
        jvmler: jvms,
        web: (tg && tg.web) || [],
        webUyari: (tg && tg.webUyari) || null,
        kapasite: kap.harita.get(host) || null,
      };
    })
    .sort((a, b) => String(a.ortam).localeCompare(String(b.ortam)) || a.host.localeCompare(b.host));

  const webIx = new Map();
  for (const s of sunucular) {
    for (const w of s.web) {
      const k = U(w.host);
      if (!webIx.has(k)) webIx.set(k, { host: k, urun: w.product || null, vhostlar: new Set(), istek7g: 0, olculdu: false, uygulamaSunuculari: new Set() });
      const g = webIx.get(k);
      if (w.serverName) g.vhostlar.add(w.serverName);
      g.uygulamaSunuculari.add(s.host);
      if (w.trafik && w.trafik.durum === 'var') {
        g.istek7g += Number(w.trafik.req7) || 0;
        g.olculdu = true;
      } else if (w.trafik && w.trafik.durum === 'yok') g.olculdu = true;
    }
  }
  const webSunuculari = [...webIx.values()]
    .map((g) => ({ ...g, vhostlar: [...g.vhostlar].sort(), uygulamaSunuculari: [...g.uygulamaSunuculari].sort(), istek7g: g.olculdu ? g.istek7g : null }))
    .sort((a, b) => a.host.localeCompare(b.host));

  const surumler = [...new Set(sunucular.map((s) => s.jbossSurum).filter(Boolean))].sort();
  const ortamlar = [...new Set(sunucular.map((s) => s.ortam).filter(Boolean))];
  return {
    tip: 'jboss',
    ad: base,
    varyantlar: [...new Set(mw.rows.map((r) => String(r.app)))].sort(),
    ozet: {
      sunucuSayisi: hostlar.length,
      ortamlar,
      surumler,
      jvmSayisi: hub.jvmler.length,
      calisanJvm: hub.jvmler.filter((j) => j.calisiyor === true).length,
      webSunucuSayisi: webSunuculari.length,
      toplamCpu: sunucular.reduce((a, s) => a + ((s.kapasite && s.kapasite.cpu) || 0), 0) || null,
      toplamBellekGb: Math.round(sunucular.reduce((a, s) => a + ((s.kapasite && s.kapasite.bellekGb) || 0), 0) * 10) / 10 || null,
      yuk: disc.d && disc.d.summary ? disc.d.summary.trafik || null : null,
    },
    sunucular,
    webSunuculari,
    kaynaklar: {
      envanter: { hata: mw.hata },
      kesif: { hata: disc.hata, serverHubOkunamadi: !!(disc.d && disc.d.summary && disc.d.summary.hubUnavailable) },
      serverHub: { hata: hub.hata, sonTarama: hub.sonTarama },
      kapasite: { hata: kap.hata },
    },
  };
}

// ── WAS ────────────────────────────────────────────────────────────────────────

async function wasOzetleri(hostlar) {
  // Uygulama Envanteri (Portal DB): host basina en yeni veri_var=1 kosunun was_ozeti JSON'u.
  const out = new Map();
  if (!hostlar.length) return { harita: out, hata: null };
  try {
    const db = require('../db/index.cjs');
    const liste = hostlar.slice(0, HOST_TAVAN);
    const { rows } = await db.query(
      `SELECT h.host, h.was_ozeti, h.taranma_utc FROM ear_envanter_hostlari h
         JOIN (SELECT host, MAX(kosu_id) AS k FROM ear_envanter_hostlari WHERE veri_var = 1 GROUP BY host) m
           ON m.host = h.host AND m.k = h.kosu_id
        WHERE UPPER(h.host) IN (${liste.map((_, i) => `$${i + 1}`).join(', ')})`,
      liste,
    );
    for (const r of rows) {
      let oz = null;
      try {
        oz = r.was_ozeti ? JSON.parse(r.was_ozeti) : null;
      } catch {
        oz = null;
      }
      out.set(U(r.host), { ozet: oz, taranma: r.taranma_utc ? new Date(r.taranma_utc).toISOString() : null });
    }
    return { harita: out, hata: null };
  } catch (e) {
    return { harita: out, hata: hataMetni(e) };
  }
}

/** was_ozeti icinden bu sunucu (JVM) adina dusen kayitlar; sema surume gore esnek okunur. */
function wasSunucuBilgisi(oz, ad) {
  if (!oz || typeof oz !== 'object') return null;
  const profiller = Array.isArray(oz.profiller) ? oz.profiller : Array.isArray(oz) ? oz : [oz];
  for (const pr of profiller) {
    const sunucular = Array.isArray(pr && pr.sunucular) ? pr.sunucular : [];
    const s = sunucular.find((x) => L(x && (x.ad || x.name)) === L(ad));
    if (s) {
      const jvm = s.jvm || s.jvmEntries || null;
      return {
        profil: pr.profil || pr.ad || null,
        hucre: pr.hucre || null,
        dugum: pr.dugum || null,
        uygulamalar: Array.isArray(s.uygulamalar) ? s.uygulamalar : [],
        uclar: Array.isArray(s.uclar) ? s.uclar : [],
        minHeap: jvm ? nz(jvm.initialHeapSize || jvm.minHeap) : null,
        maxHeap: jvm ? nz(jvm.maximumHeapSize || jvm.maxHeap) : null,
        jvmArgs: jvm ? nz(jvm.genericJvmArguments || jvm.jvmArgs) : null,
        sistemOzellikleri: jvm && Array.isArray(jvm.sistemOzellikleri || jvm.systemProperties) ? jvm.sistemOzellikleri || jvm.systemProperties : [],
      };
    }
  }
  return null;
}

async function wasDetay(ad) {
  const { sql } = mssql();
  const t = tablolar();
  const { maskJvmArgs } = require('../server-hub/mask.cjs');
  const p = [{ name: 'a', type: sql.NVarChar(128), value: ad }];
  const r = await guvenli(`SELECT * FROM dbo.${t.was} WHERE app = @a`, p);
  if (!r.hata && !r.rows.length) return null;
  const hostlar = [...new Set(r.rows.map((x) => U(x.host)).filter(Boolean))];
  const [kap, ear, web] = await Promise.all([
    kapasiteOku(hostlar),
    wasOzetleri(hostlar),
    (async () => {
      const certs = await guvenli(
        `SELECT host, ip, port, server_name, conf_file, product, env FROM dbo.BMW_Certificates_Inventory`,
      );
      if (certs.hata) return { hata: certs.hata, harita: new Map() };
      const wa = require('../audit/web-app.cjs');
      const ix = wa.buildCertIndex(certs.rows);
      const harita = new Map();
      for (const row of r.rows) {
        try {
          const m = wa.matchWebForApp({ app: row.app, appHost: row.host, domain: row.domain }, ix);
          harita.set(U(row.host), m);
        } catch {
          /* tek satir eslesmezse digerleri devam */
        }
      }
      return { hata: null, harita };
    })(),
  ]);
  const sunucular = r.rows
    .map((row) => {
      const host = U(row.host);
      const e = ear.harita.get(host);
      const bilgi = e ? wasSunucuBilgisi(e.ozet, row.app) : null;
      const m = web.harita.get(host);
      return {
        host,
        ortam: nz(row.env),
        wasSurum: nz(row.was_version),
        jdk: nz(row.jdk_type),
        jre: nz(row.jre_version),
        os: nz(row.os),
        envanterDurumu: nz(row.status),
        alan: nz(row.domain),
        kapasite: kap.harita.get(host) || null,
        jvm: bilgi
          ? {
              ...bilgi,
              jvmArgs: bilgi.jvmArgs ? maskJvmArgs(bilgi.jvmArgs) : null,
              taranma: e.taranma,
            }
          : null,
        jvmToplandi: !!(bilgi && (bilgi.jvmArgs || bilgi.maxHeap || bilgi.minHeap)),
        web: m && Array.isArray(m.web) ? m.web.map((w) => ({ host: U(w.host), serverName: w.serverName || null, product: w.product || null, port: w.port || null, kaynak: w.kaynak || null })) : [],
        tier: m ? m.tier || null : null,
      };
    })
    .sort((a, b) => String(a.ortam).localeCompare(String(b.ortam)) || a.host.localeCompare(b.host));
  const webIx = new Map();
  for (const s of sunucular)
    for (const w of s.web) {
      if (!webIx.has(w.host)) webIx.set(w.host, { host: w.host, urun: w.product, vhostlar: new Set(), uygulamaSunuculari: new Set() });
      const g = webIx.get(w.host);
      if (w.serverName) g.vhostlar.add(w.serverName);
      g.uygulamaSunuculari.add(s.host);
    }
  const webSunuculari = [...webIx.values()].map((g) => ({ ...g, vhostlar: [...g.vhostlar].sort(), uygulamaSunuculari: [...g.uygulamaSunuculari].sort(), istek7g: null }));
  return {
    tip: 'was',
    ad,
    ozet: {
      sunucuSayisi: hostlar.length,
      ortamlar: [...new Set(sunucular.map((s) => s.ortam).filter(Boolean))],
      surumler: [...new Set(sunucular.map((s) => s.wasSurum).filter(Boolean))].sort(),
      webSunucuSayisi: webSunuculari.length,
      toplamCpu: sunucular.reduce((a, s) => a + ((s.kapasite && s.kapasite.cpu) || 0), 0) || null,
      toplamBellekGb: Math.round(sunucular.reduce((a, s) => a + ((s.kapasite && s.kapasite.bellekGb) || 0), 0) * 10) / 10 || null,
    },
    sunucular,
    webSunuculari,
    kaynaklar: {
      envanter: { hata: r.hata },
      kapasite: { hata: kap.hata },
      uygulamaEnvanteri: { hata: ear.hata },
      web: { hata: web.hata },
    },
  };
}

// ── OpenShift ──────────────────────────────────────────────────────────────────

async function clusterIndeksi() {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT env, tenant, cluster_name, display, console_url FROM ocp_cluster_index WHERE is_active = 1`,
  );
  const ix = new Map();
  for (const r of rows) {
    const k = L(r.cluster_name);
    if (!ix.has(k)) ix.set(k, []);
    ix.get(k).push({ env: r.env, tenant: r.tenant, ad: r.cluster_name, gorunen: r.display || null, konsol: r.console_url || null });
  }
  return ix;
}

async function ocpDetay(ad) {
  const { sql } = mssql();
  const p = [{ name: 'a', type: sql.NVarChar(128), value: ad }];
  const inv = await guvenli(
    `SELECT DISTINCT cluster, namespace, application FROM dbo.Openshift_Inventory WHERE application = @a`,
    p,
  );
  if (!inv.hata && !inv.rows.length) return null;
  let cix = new Map();
  let cixHata = null;
  try {
    cix = await clusterIndeksi();
  } catch (e) {
    cixHata = hataMetni(e);
  }
  const namespaces = [...new Set(inv.rows.map((r) => String(r.namespace)))];
  const nsParams = namespaces.slice(0, 50).map((n, i) => ({ name: `n${i}`, type: sql.NVarChar(256), value: n }));
  const inNs = nsParams.map((x) => `@${x.name}`).join(', ');
  const [rot, kul] = await Promise.all([
    nsParams.length
      ? guvenli(
          `SELECT cluster_name, namespace_name, route_name, route_address, resolved_ip, termination_type
             FROM dbo.BMW_Openshift_Route_Inventory WHERE namespace_name IN (${inNs})`,
          nsParams,
        )
      : Promise.resolve({ rows: [], hata: null }),
    guvenli(
      `SELECT u.cluster, u.namespace, u.req_total, u.window_days, u.measured, u.scan_date
         FROM dbo.BMW_Application_Usage u
         JOIN (SELECT cluster, namespace, app, MAX(scan_date) AS d FROM dbo.BMW_Application_Usage WHERE app = @a GROUP BY cluster, namespace, app) m
           ON m.cluster = u.cluster AND m.namespace = u.namespace AND m.app = u.app AND m.d = u.scan_date
        WHERE u.app = @a`,
      p,
    ),
  ]);
  const { routesForApp } = require('../audit/nginx-app-routes.cjs');
  const yerler = [];
  const ocpCache = require('../logx/v2/ocp-cache.cjs');
  for (const r of inv.rows) {
    const eslesen = cix.get(L(r.cluster)) || [];
    const ct = eslesen[0] || null;
    let onbellek = null;
    if (ct) {
      try {
        const c = await ocpCache.getApps({ env: ct.env, tenant: ct.tenant, clusterName: ct.ad, namespace: r.namespace });
        const it = (c.items || []).filter((x) => L(x.name) === L(ad));
        if (it.length) onbellek = { kayitlar: it, alinma: c.fetchedAt ? new Date(c.fetchedAt).toISOString() : null, bayat: !!c.stale };
      } catch {
        onbellek = null;
      }
    }
    const rr = routesForApp(
      rot.rows.filter((x) => L(x.cluster_name) === L(r.cluster)),
      r.namespace,
      ad,
    );
    const ku = kul.rows.find((x) => L(x.cluster) === L(r.cluster) && L(x.namespace) === L(r.namespace));
    yerler.push({
      cluster: String(r.cluster),
      namespace: String(r.namespace),
      ortam: ct ? ct.env : null,
      tenant: ct ? ct.tenant : null,
      konsol: ct ? ct.konsol : null,
      katalogda: !!ct,
      onbellek,
      routelar: (rr.adaylar || []).map((a) => ({ adres: a.url, ad: a.routeName || null, tls: a.termination || null, kanit: a.how === 'address' ? 'adres' : 'route adı' })),
      routeEslesme: rr.how || null,
      atfedilmeyenRoute: rr.atfedilmeyen || 0,
      istek: ku ? { toplam: sayi(ku.req_total), gun: sayi(ku.window_days), olculdu: Number(ku.measured) === 1, tarih: ku.scan_date ? new Date(ku.scan_date).toISOString().slice(0, 10) : null } : null,
    });
  }
  yerler.sort((a, b) => String(a.ortam).localeCompare(String(b.ortam)) || a.cluster.localeCompare(b.cluster) || a.namespace.localeCompare(b.namespace));
  return {
    tip: 'ocp',
    ad,
    ozet: {
      clusterSayisi: new Set(yerler.map((y) => y.cluster)).size,
      namespaceSayisi: namespaces.length,
      ortamlar: [...new Set(yerler.map((y) => y.ortam).filter(Boolean))],
      routeSayisi: yerler.reduce((a, y) => a + y.routelar.length, 0),
    },
    yerler,
    kaynaklar: {
      envanter: { hata: inv.hata },
      clusterKatalogu: { hata: cixHata },
      route: { hata: rot.hata },
      kullanim: { hata: kul.hata },
    },
  };
}

module.exports = { AD_RE, ARA_RE, ara, jbossDetay, wasDetay, ocpDetay, kapasiteOku, wasSunucuBilgisi, clusterIndeksi, _ic: { heap } };
