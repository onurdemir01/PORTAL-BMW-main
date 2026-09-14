// server/audit/nginx-migration.cjs - Nginx SPA > "Production Tasimalari": eski GBRVP* sunucularinin
// proxy_pass hedefleri, yeni GBNGXP4x/5x sunucularinda DIZIN olarak var mi?
//
// SORU (kullanici, 2026-09-14): eski sunuculardaki location'larda tanimli proxy_pass
// uygulamalari yeni sunucularda /hysdeploy/<ns>/<app>/ ve
// /usr/nginx/applications/<ns>/<app>/ olarak bulunuyor mu?
//
// KAYNAKLAR (hepsi mevcut tablolar, yeni tablo YOK):
//   dbo.Nginx_Config_Audit  kind='proxy'  -> eski sunucu: vhost, location, upstream,
//                                            target_url (= proxy_ssl_name, route adresi)
//   dbo.Nginx_Audit_Upstreams             -> target_url bossa upstream'in server host'u
//   dbo.BMW_Openshift_Route_Inventory     -> route adresi -> namespace (KESIN eslesme)
//   dbo.Openshift_Inventory               -> (namespace, application) ciftleri (yedek cozum)
//   dbo.Nginx_Intranet_Audit              -> yeni sunucu: hys/app/conf dizin bayraklari
//                                            (tablo adi tarihsel; dizin taramasi HER
//                                            sunucuda kosar - bmw_nginx/nginx_config_audit)
//
// proxy_pass YAZIM BICIMLERI (kullanici, 2026-09-14) - dordu de gecerli:
//   proxy_pass https://<app>-<ns>.apps.fw.garanti.com.tr     (FQDN)
//   proxy_pass https://<app>-<ns>.apps.fw.garanti.com.tr/    (FQDN, yol)
//   proxy_pass https://<app>-<ns>                             (upstream blogu adi)
//   proxy_pass https://<app>-<ns>/                            (upstream blogu adi, yol)
// Tarayici sema/yol/portu attigi icin DB'de iki bicim kalir: FQDN ya da CIPLAK AD.
// Upstream adi her zaman <app>-<ns> DEGILDIR (takma ad olabilir: "onur", "pblc-cfa");
// o yuzden GERCEK arka uc su sirayla bulunur:
//   1) upstream blogunun server satiri (nginx_audit / Nginx_Audit_Upstreams)  - en kesin
//   2) location'daki proxy_ssl_name (target_url)                               - SNI adi
//   3) proxy_pass'teki adin kendisi (FQDN ya da ciplak <app>-<ns>)
//
// "-prod" EKI (kullanici, 2026-09-14): eski vhost'lardaki yazimda <Namespace> "-prod"
// EKSIZDIR (proxy_pass https://x-app-v1-digital-banking-ch/ -> gercek namespace
// digital-banking-ch-prod). Cozum once adi OLDUGU GIBI dener; tutmazsa "-prod"
// eklenmis halini dener ve bunu satirda isaretler (suffixAdded) - sessiz ek yok.
//
// HEDEF -> (namespace, uygulama) COZUMU: etiket <app>-<ns> kalibindadir ama hem app hem
// ns tire icerebilir; "nerede bolunur" belirsiz. Bu yuzden TAHMIN EDILMEZ:
//   (1) FQDN route envanterinde BIREBIR varsa namespace oradan, app = etiket - "-ns"
//   (2) ciplak ad / etiket, route envanterindeki bir adresin ILK ETIKETIYLE ayniysa
//       (ayni kesinlik: route adresleri kurumsal kalipta)
//   (3) OpenShift envanterindeki (ns, app) ciftlerinden etiketi birebir ureten(ler);
//       birden fazla ciftse "belirsiz", hicbiri yoksa "cozulemedi" - ikisi de ekranda
//       AYRI gorunur, sessizce dusmez.
//
// SPA OLMAYAN HEDEFLER: eski vhost'lar API/arka uc servislerine de proxy_pass yapar.
// Bunlar yeni sunucuda dizin olarak BEKLENMEZ (proxy ile tasinir); "-app-v/-app-emb-v"
// kalibina uymayanlar ayri listede gosterilir, "eksik" sayilmaz.
'use strict';

const SPA_RE = /-app(-emb)?-v/i;

/** Sabit tasima gruplari (kullanici verdi, 2026-09-14). */
const MIGRATION_GROUPS = [
  {
    id: 'glomo',
    label: 'Glomo',
    oldHosts: ['GBRVPP07', 'GBRVPP08', 'GBRVPP09', 'GBRVPP10', 'GBRVPAP03', 'GBRVPAP04', 'GBRVPAP05', 'GBRVPAP06'],
    newHosts: ['GBNGXP40', 'GBNGXP41', 'GBNGXP48', 'GBNGXP49', 'GBNGXAP24', 'GBNGXAP25'],
  },
  {
    id: 'other',
    label: 'Openbanking / Saklama / Webforms vb.',
    oldHosts: ['GBRVPP01', 'GBRVPP02', 'GBRVPAP01', 'GBRVPAP02'],
    newHosts: ['GBNGXP44', 'GBNGXP45', 'GBNGXP58', 'GBNGXP59', 'GBNGXAP28', 'GBNGXAP29'],
  },
];

const H = (h) => String(h || '').trim().toUpperCase();
const L = (s) => String(s || '').trim().toLowerCase();
const bit = (v) => v === true || v === 1 || v === '1';

/** "https://x.y:443/" ya da "x.y" -> "x.y" */
function hostOf(url) {
  let s = L(url);
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0];
  s = s.replace(/:\d+$/, '');
  return s;
}

/**
 * Hedef host adini (namespace, uygulama)'ya cozer.
 * @returns {{namespace:string|null, application:string|null, how:'route'|'inventory'|'ambiguous'|'unresolved', candidates?:string[]}}
 */
const PROD_SUFFIX = '-prod';

function resolveTarget(host, routeByAddress, ocpByLabel, routeByLabel = new Map()) {
  const h = L(host);
  if (!h) return { namespace: null, application: null, how: 'unresolved', suffixAdded: false };
  const dot = h.indexOf('.');
  const label0 = dot >= 0 ? h.slice(0, dot) : h;
  const rest = dot >= 0 ? h.slice(dot) : '';

  // Once oldugu gibi, sonra "-prod" eklenmis hali (eski yazimda ek yok).
  const tries = [{ label: label0, suffixAdded: false }];
  if (!label0.endsWith(PROD_SUFFIX)) tries.push({ label: label0 + PROD_SUFFIX, suffixAdded: true });

  let ambiguous = null;
  for (const { label, suffixAdded } of tries) {
    // (1) FQDN birebir, (2) ciplak ad = route adresinin ilk etiketi
    const ns = routeByAddress.get(label + rest) || routeByLabel.get(label);
    if (ns) {
      const suf = '-' + ns;
      if (label.endsWith(suf) && label.length > suf.length) {
        return { namespace: ns, application: label.slice(0, -suf.length), how: 'route', suffixAdded };
      }
    }
    const cands = ocpByLabel.get(label) || [];
    if (cands.length === 1) {
      return { namespace: cands[0].namespace, application: cands[0].application, how: 'inventory', suffixAdded };
    }
    if (cands.length > 1 && !ambiguous) {
      ambiguous = {
        namespace: null,
        application: null,
        how: 'ambiguous',
        suffixAdded,
        candidates: cands.map((c) => c.namespace + '/' + c.application),
      };
    }
  }
  return ambiguous || { namespace: null, application: null, how: 'unresolved', suffixAdded: false };
}

/**
 * @param proxyRows    Nginx_Config_Audit kind='proxy' (host, vhost, service, location, upstream_name, target_url)
 * @param upstreamRows Nginx_Audit_Upstreams (host, name, server)
 * @param routeRows    BMW_Openshift_Route_Inventory (namespace_name, route_address)
 * @param ocpRows      Openshift_Inventory (namespace, application)
 * @param dirRows      Nginx_Intranet_Audit (host, namespace, application, hys_deployed, app_deployed, conf_exists)
 */
function buildMigration({ proxyRows, upstreamRows, routeRows, ocpRows, dirRows, groups = MIGRATION_GROUPS }) {
  // route adresi -> namespace (birebir)
  const routeByAddress = new Map();
  const routeByLabel = new Map(); // ilk etiket -> ns (ciplak upstream adi icin)
  for (const r of routeRows || []) {
    const a = hostOf(r.route_address);
    const ns = L(r.namespace_name);
    if (!a || !ns) continue;
    if (!routeByAddress.has(a)) routeByAddress.set(a, ns);
    const lbl = a.split('.')[0];
    if (lbl && !routeByLabel.has(lbl)) routeByLabel.set(lbl, ns);
  }
  // "<app>-<ns>" etiketi -> [(ns, app)] (yedek cozum)
  const ocpByLabel = new Map();
  for (const r of ocpRows || []) {
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!ns || !app) continue;
    const label = app + '-' + ns;
    if (!ocpByLabel.has(label)) ocpByLabel.set(label, []);
    const arr = ocpByLabel.get(label);
    if (!arr.some((c) => c.namespace === ns && c.application === app)) arr.push({ namespace: ns, application: app });
  }
  // (host, upstream adi) -> server host (target_url bos kaldiysa)
  const upsServer = new Map();
  for (const r of upstreamRows || []) {
    const k = H(r.host) + '|' + L(r.name);
    if (!upsServer.has(k)) upsServer.set(k, hostOf(r.server));
  }
  // yeni sunucu dizinleri: host -> "ns/app" -> bayraklar
  const dirs = new Map();
  const scannedHosts = new Set();
  for (const r of dirRows || []) {
    const host = H(r.host);
    if (!host) continue;
    scannedHosts.add(host);
    if (!dirs.has(host)) dirs.set(host, new Map());
    dirs.get(host).set(L(r.namespace) + '/' + L(r.application), {
      hys: bit(r.hys_deployed),
      app: bit(r.app_deployed),
      conf: bit(r.conf_exists),
    });
  }

  const out = [];
  for (const g of groups) {
    const oldSet = new Set(g.oldHosts.map(H));
    const apps = new Map(); // "ns/app" -> satir
    const nonSpa = new Map(); // hedef host -> satir
    const unresolved = new Map(); // hedef host -> satir

    for (const r of proxyRows || []) {
      const host = H(r.host);
      if (!oldSet.has(host)) continue;
      // proxy_pass'te yazan ad (FQDN ya da ciplak upstream adi) - ekranda "yazim" olarak gorunur
      const written = hostOf(r.upstream_name);
      const form = written ? (written.includes('.') ? 'fqdn' : 'upstream') : 'none';
      // Gercek arka uc: upstream server satiri > proxy_ssl_name > yazilan ad
      let target = upsServer.get(host + '|' + written) || '';
      let targetSource = 'upstream-server';
      if (!target) {
        target = hostOf(r.target_url);
        targetSource = 'proxy_ssl_name';
      }
      if (!target) {
        target = written;
        targetSource = 'proxy_pass';
      }
      const loc = String(r.location || '');
      const svc = String(r.service || r.vhost || '');
      const res = resolveTarget(target, routeByAddress, ocpByLabel, routeByLabel);

      const push = (map, key, extra) => {
        if (!map.has(key)) {
          map.set(key, {
            ...extra, target, targetSource, suffixAdded: res.suffixAdded === true,
            services: new Set(), oldHosts: new Set(), locations: new Set(), forms: new Set(), written: new Set(),
            paths: new Map(), // "SERVICE|location" -> {service, location, hosts:Set}
          });
        }
        const row = map.get(key);
        row.services.add(svc);
        row.oldHosts.add(host);
        row.locations.add(loc);
        row.forms.add(form);
        if (written) row.written.add(written);
        // "Tanim olustur" icin: hangi vhost (servis) + hangi context path. Ayni uygulama
        // birden fazla location'dan sunuluyorsa kullanici birini secer.
        const pk = svc + '|' + loc;
        if (!row.paths.has(pk)) row.paths.set(pk, { service: svc, location: loc, hosts: new Set() });
        row.paths.get(pk).hosts.add(host);
      };

      if (res.namespace && res.application) {
        const key = res.namespace + '/' + res.application;
        if (!SPA_RE.test(res.application)) {
          push(nonSpa, key, { namespace: res.namespace, application: res.application, how: res.how });
        } else {
          push(apps, key, { namespace: res.namespace, application: res.application, how: res.how });
        }
      } else if (SPA_RE.test(target)) {
        push(unresolved, target, { how: res.how, candidates: res.candidates || [] });
      } else {
        // SPA kalibina uymayan ve cozulemeyen: API/arka uc olabilir - SPA-disi listede
        push(nonSpa, target, { namespace: null, application: null, how: res.how });
      }
    }

    const newHosts = g.newHosts.map(H);
    const finish = (row) => ({
      ...row,
      services: [...row.services].sort(),
      oldHosts: [...row.oldHosts].sort(),
      locations: [...row.locations].sort(),
      locationCount: row.locations.size,
      // proxy_pass yazim bicim(ler)i: 'fqdn' | 'upstream'; ve yazilan ad(lar)
      forms: [...row.forms].sort(),
      written: [...row.written].sort(),
      paths: [...row.paths.values()]
        .map((x) => ({ service: x.service, location: x.location, hosts: [...x.hosts].sort() }))
        .sort((a, b) => a.service.localeCompare(b.service) || a.location.localeCompare(b.location)),
    });

    const appRows = [...apps.values()].map((row) => {
      const key = row.namespace + '/' + row.application;
      const perHost = {};
      let readyHosts = 0;
      let scanned = 0;
      for (const nh of newHosts) {
        if (!scannedHosts.has(nh)) {
          perHost[nh] = null; // taranmadi
          continue;
        }
        scanned++;
        const f = dirs.get(nh).get(key) || { hys: false, app: false, conf: false };
        perHost[nh] = f;
        if (f.hys && f.app) readyHosts++;
      }
      // hazir: TARANAN her yeni sunucuda hys+app var; taranmayan varsa "kismi"
      const status =
        scanned === 0 ? 'not-scanned' : readyHosts === scanned && scanned === newHosts.length ? 'ready'
          : readyHosts === 0 ? 'missing' : 'partial';
      return { ...finish(row), perHost, readyHosts, scannedHosts: scanned, status };
    });
    const order = { missing: 0, partial: 1, 'not-scanned': 2, ready: 3 };
    appRows.sort((a, b) => order[a.status] - order[b.status] || a.application.localeCompare(b.application));

    out.push({
      id: g.id,
      label: g.label,
      oldHosts: g.oldHosts.map(H),
      newHosts,
      newHostsScanned: newHosts.filter((h) => scannedHosts.has(h)),
      oldHostsSeen: [...new Set((proxyRows || []).map((r) => H(r.host)).filter((h) => oldSet.has(h)))].sort(),
      apps: appRows,
      nonSpa: [...nonSpa.values()].map(finish).sort((a, b) => a.target.localeCompare(b.target)),
      unresolved: [...unresolved.values()].map(finish).sort((a, b) => a.target.localeCompare(b.target)),
      totals: {
        apps: appRows.length,
        ready: appRows.filter((r) => r.status === 'ready').length,
        partial: appRows.filter((r) => r.status === 'partial').length,
        missing: appRows.filter((r) => r.status === 'missing').length,
        notScanned: appRows.filter((r) => r.status === 'not-scanned').length,
        nonSpa: nonSpa.size,
        unresolved: unresolved.size,
      },
    });
  }
  return out;
}

/**
 * Veritabanindan tasima gorunumunu yukler (Denetim ucu + "Tanim olustur" anti-tamper).
 * Her tablo KENDI son tarama gunuyle okunur (config audit ile nginx_audit ayri isler).
 * @param query           mssql query(text, inputs)
 * @param sql             mssql tip nesnesi
 * @param hasProxyColumns async () => boolean  (Nginx_Config_Audit kind/target_url DDL'i)
 */
async function loadMigration({ query, sql, hasProxyColumns }) {
  const { loadNamespaceOwners, ownersFor } = require('./ns-owners.cjs');
  const oldHosts = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.oldHosts))];
  const newHosts = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.newHosts))];
  const inList = (prefix, arr) => ({
    sqlText: arr.map((_, i) => `@${prefix}${i}`).join(', '),
    params: arr.map((h, i) => ({ name: `${prefix}${i}`, type: sql.NVarChar(64), value: h })),
  });
  const oldIn = inList('o', oldHosts);
  const newIn = inList('n', newHosts);

  // kind/target_url kolonlari DDL ile geldi; yoksa proxy satirlari hic yazilmamistir.
  if (hasProxyColumns && !(await hasProxyColumns())) {
    return {
      ok: true, ownersReady: false, proxyReady: false, dirsReady: false, proxyScanDate: null, dirScanDate: null,
      groups: buildMigration({ proxyRows: [], upstreamRows: [], routeRows: [], ocpRows: [], dirRows: [] }),
    };
  }

  const [proxyDate, dirDate] = await Promise.all([
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`)
      .then((r) => r.recordset?.[0]?.d || null).catch(() => null),
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Intranet_Audit`)
      .then((r) => r.recordset?.[0]?.d || null).catch(() => null),
  ]);

  const [proxy, ups, routes, ocp, dirs] = await Promise.all([
    proxyDate
      ? query(
          `SELECT host, vhost, service, location_path AS location, upstream_name, target_url
             FROM dbo.Nginx_Config_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Config_Audit)
              AND kind = 'proxy' AND host IN (${oldIn.sqlText})`,
          oldIn.params,
        ).then((r) => r.recordset || [])
      : Promise.resolve([]),
    // nginx_audit (nginx -T) upstream server host'u. Tablo yoksa yedek yok, is durmaz.
    query(
      `SELECT host, name, server FROM dbo.Nginx_Audit_Upstreams
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Upstreams)
          AND host IN (${oldIn.sqlText})`,
      oldIn.params,
    ).then((r) => r.recordset || []).catch(() => []),
    query(`SELECT DISTINCT namespace_name, route_address FROM dbo.BMW_Openshift_Route_Inventory`)
      .then((r) => r.recordset || []).catch(() => []),
    query(`SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory`)
      .then((r) => r.recordset || []).catch(() => []),
    dirDate
      ? query(
          `SELECT host, namespace, application, hys_deployed, app_deployed, conf_exists
             FROM dbo.Nginx_Intranet_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)
              AND host IN (${newIn.sqlText})`,
          newIn.params,
        ).then((r) => r.recordset || [])
      : Promise.resolve([]),
  ]);

  const groups = buildMigration({ proxyRows: proxy, upstreamRows: ups, routeRows: routes, ocpRows: ocp, dirRows: dirs });
  const owners = await loadNamespaceOwners(query);
  for (const g of groups) {
    for (const a of g.apps) a.owner = ownersFor(owners.byNs, [a.namespace]);
  }
  return {
    ok: true,
    ownersReady: owners.ready,
    proxyReady: !!proxyDate,
    dirsReady: !!dirDate,
    proxyScanDate: proxyDate,
    dirScanDate: dirDate,
    groups,
  };
}

module.exports = { buildMigration, loadMigration, resolveTarget, MIGRATION_GROUPS, SPA_RE, _hostOf: hostOf };
