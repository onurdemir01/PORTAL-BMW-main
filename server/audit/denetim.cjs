// server/audit/denetim.cjs — "Denetim" sayfasinin veri uclari (2026-08-21).
//
// IKI AYRI KONU, IKI AYRI UC:
//   1) GET /api/denetim/nginx-spa   -> dbo.Nginx_Config_Audit (nginx_config_audit job'i
//      doldurur). Servis bazinda, ortam (DEV/TEST/QA/PROD) karsilastirmali uygulama
//      tablosu + uygulamanin OpenShift envanterinde olup olmadigi.
//   2) GET /api/denetim/ocp-coverage -> dbo.Openshift_Inventory. Bir uygulamanin bir
//      platformun HANGI ortamlarinda VAR / EKSIK oldugu.
//   3) GET /api/denetim/init-scripts -> dbo.InitScriptsInventory[8] (check_initialize
//      job'i doldurur). Init script'lerinin sunucular arasi sha512 sapmasi: hangi
//      script kac AYRI surumle dagitilmis, hangi host'lar cogunluktan ayrilmis.
//
// Ikisi de SALT OKUNUR ve mevcut tablolari okur - yeni tablo/DDL GEREKTIRMEZ.
'use strict';

const express = require('express');
const { PLATFORM_CLUSTERS, ENVS, envOfNamespace } = require('./ocp-platforms.cjs');
const { tierOfHost, envOfHost } = require('./nginx-hosts.cjs');
const { indexIntranetRows, coverageForEnv } = require('./nginx-intranet.cjs');
const { summarizeAudit, readLatestAuditDate } = require('./nginx-audit.cjs');
// Tarama SAATI (2026-09-23): tablolarda `scanned_at` varsa okunur, yoksa null.
const { scanStamp } = require('./scan-stamp.cjs');
const { loadMigration, resolveTarget, buildResolverMaps, MIGRATION_GROUPS } = require('./nginx-migration.cjs');
const { buildRouteStats } = require('./route-stats.cjs');
const { loadNamespaceOwners, ownersFor } = require('./ns-owners.cjs');

// Proxy (production) kolonlari DDL ile eklendi mi?
//
// NEDEN TESPIT: `kind` kolonu YOKKEN sorguya "AND kind = 'spa'" koymak Denetim
// sayfasinin TAMAMINI dusururdu. DDL elle calistirildigi icin kodun once, semanin
// sonra gelmesi NORMAL bir durumdur - bu yuzden filtre KOSULLU kurulur ve sema
// hazir olmadan da mevcut ekranlar calismaya devam eder.
let _proxyColsAt = 0;
let _proxyCols = null;
const PROXY_COLS_TTL = 60_000;

async function hasProxyColumns() {
  if (_proxyCols !== null && Date.now() - _proxyColsAt < PROXY_COLS_TTL) return _proxyCols;
  try {
    const { query } = require('../inventory/mssql.cjs');
    const r = await query(
      `SELECT COUNT(*) AS n FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.Nginx_Config_Audit')
          AND name IN ('kind','upstream_name','target_url','upstream_defined')`,
    );
    _proxyCols = Number(r.recordset?.[0]?.n || 0) === 4;
  } catch {
    _proxyCols = false;
  }
  _proxyColsAt = Date.now();
  return _proxyCols;
}

/** Mevcut SPA ekranlari proxy satirlarini GORMEMELI - sayilari sessizce degistirirdi.
 *  Eski satirlarda kind NULL'dur ve SPA sayilir. */
async function spaFilter() {
  return (await hasProxyColumns()) ? " AND (kind IS NULL OR kind = 'spa')" : '';
}

function initDenetim(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.use(requireAuth);

  // Sayfa gizliyse gercek 403 (diger modullerle AYNI desen).
  try {
    const { requireVisiblePrefix, requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('Denetim'));
    // SEKME BAZLI kapi (2026-09-17): sayfa acik olsa da yalniz izin verilen sekmenin uclari.
    // Yol -> sekme eslemesi DenetimPage sekme id'leriyle ayni; eslesmeyen yol sayfa kapisiyla kalir.
    // nginx sekmeleri 2026-09-22'de Nginx Hub'a tasindi: bu yollar artik 'NginxConsole' SAYFA
    // kapisindan gecer (tab:denetim:nginx* elementleri silindi).
    // Nginx yollari Nginx Hub sayfasina + O SEKMEYE baglidir (2026-09-23): "istedigim
    // kullanicilar yalniz istedigim sekmeleri gorsun" (kullanici). Eslesmeyen nginx yolu
    // sayfa kapisinda kalir.
    const NGINX_PATH = /^\/(nginx-spa|nginx-spa-coverage|route-stats|nginx-migration|nginx-locations|nginx-proxy|nginx-api|nginx-api-locations|nginx-inventory|nginx-audit)(\/|$)/;
    const NGINX_TAB_OF_PATH = [
      [/^\/(nginx-spa|nginx-spa-coverage|route-stats|nginx-migration)(\/|$)/, 'spa'],
      [/^\/(nginx-api|nginx-api-locations)(\/|$)/, 'api'],
      [/^\/nginx-inventory(\/|$)/, 'envanter'],
      [/^\/(nginx-audit|nginx-locations|nginx-proxy)(\/|$)/, 'audit'],
    ];
    const TAB_OF_PATH = [
      [/^\/ocp-coverage(\/|$)/, 'ocp'],
      [/^\/init-scripts(\/|$)/, 'init'],
      [/^\/deploy-scripts(\/|$)/, 'deploy'],
      [/^\/route-traffic(\/|$)/, 'routetraffic'],
      [/^\/envanter(\/|$)/, 'envanter'],
      [/^\/app-envs(\/|$)/, 'appenvs'],
      [/^\/web-app(\/|$)/, 'webapp'],
    ];
    router.use((req, res, next) => {
      if (NGINX_PATH.test(req.path)) {
        const nx = NGINX_TAB_OF_PATH.find(([re]) => re.test(req.path));
        return requireVisible('NginxConsole')(req, res, () => {
          if (!nx) return next();
          return requireVisible('tab:nginx:' + nx[1])(req, res, next);
        });
      }
      const hit = TAB_OF_PATH.find(([re]) => re.test(req.path));
      if (!hit) return next();
      return requireVisible('tab:denetim:' + hit[1])(req, res, next);
    });
  } catch {
    /* motor yoksa yoksay */
  }

  // YANIT ONBELLEGI (2026-09-15): gorunurluk kapisindan SONRA - onbellek yetki
  // kontrolunu atlayamaz. 60 sn; ?fresh=1 (Yenile dugmesi) atlar. Bkz. response-cache.cjs
  const { createResponseCache } = require('./response-cache.cjs');
  const responseCache = createResponseCache();
  router.use(responseCache.middleware);

  // ── 1) NGINX SPA AUDIT ──────────────────────────────────────────────────────────────
  // Nginx_Config_Audit gunluk satir tutar; HER ZAMAN en son scan_date okunur (tarih
  // parametresi verilirse o gun). Ayni (service, env, application) birden fazla host'ta
  // (prod'da 4-8 mirror nginx) tekrar edecegi icin uygulama bazinda TEKILLESTIRILIR;
  // host detayi ayrica dondurulur ki "hangi sunucuda var/yok" da gorulebilsin.
  router.get('/nginx-spa', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const scanDate = String(req.query.scanDate || '').trim();

      const dateRes = await query(
        scanDate
          ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
          : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`,
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [],
      );
      const effectiveDate = dateRes.recordset?.[0]?.d || null;
      if (!effectiveDate) {
        return res.json({ ok: true, scanDate: null, services: [], rows: [], availableDates: [] });
      }

      const [rowsRes, datesRes] = await Promise.all([
        query(
          `SELECT service, env, application, namespace, include_name, location_path,
                  host, vhost, deploy_mode, include_exists, app_deployed,
                  in_ocp_inventory, status
             FROM dbo.Nginx_Config_Audit
            WHERE scan_date = @d${await spaFilter()}`,
          [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
        ),
        query(
          `SELECT DISTINCT TOP 30 CONVERT(varchar(10), scan_date, 23) AS d
             FROM dbo.Nginx_Config_Audit ORDER BY d DESC`,
        ),
      ]);

      const raw = rowsRes.recordset || [];

      // YUK ALIYOR MU (kullanici, 2026-09-24): "bu uygulamalar yuk aliyor mu? Bunu en iyi
      // access log'dan goruruz." Kaynak dbo.Nginx_Spa_Traffic - bmw_nginx/nginx_config_audit
      // icindeki files/nginx_spa_traffic.sh location basina istek sayar (hc.jsp / hc.html
      // HARIC: saglik kontrolu yuk degildir). Tablo yoksa ekran eskisi gibi calisir.
      //
      // ANAHTAR (service, env, location): ayni tanim birden fazla mirror sunucuda durur,
      // sayilar TOPLANIR; "son istek" en yenisi alinir. Log okunamayan sunucu sayiya
      // KATILMAZ ama "bilinmiyor" bayragini kaldirir - "yuk yok" demek degildir.
      const traffic = new Map(); // SERVICE|ENV|LOCATION -> {req24, req7, hc24, hosts, lastSeen, sampled, unknown}
      try {
        const tr = await query(
          `SELECT service, env, location, req_24h, req_7d, hc_24h, sampled, last_seen, error
             FROM dbo.Nginx_Spa_Traffic
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Spa_Traffic)`,
        );
        for (const x of tr.recordset || []) {
          const k = `${String(x.service || '').toUpperCase()}|${String(x.env || '').toUpperCase()}|${String(x.location || '')}`;
          if (!traffic.has(k)) traffic.set(k, { req24: 0, req7: 0, hc24: 0, hosts: 0, lastSeen: null, sampled: false, unknown: 0 });
          const c = traffic.get(k);
          if (x.error) { c.unknown += 1; continue; }
          c.hosts += 1;
          c.req24 += Number(x.req_24h) || 0;
          c.req7 += Number(x.req_7d) || 0;
          c.hc24 += Number(x.hc_24h) || 0;
          if (x.sampled) c.sampled = true;
          const ls = x.last_seen ? String(x.last_seen) : null;
          if (ls && (!c.lastSeen || ls > c.lastSeen)) c.lastSeen = ls;
        }
      } catch {
        /* tablo yoksa trafik gosterilmez - ekran calismaya devam eder */
      }

      /**
       * Hucrenin yuk durumu. UC AYRI DURUM (ikiye indirmek yaniltirdi):
       *   active   : 7 gun icinde hc DISI istek var
       *   idle     : log OKUNDU ve 7 gundur hc disi istek YOK
       *   unknown  : log okunamadi / tarama bu location'i hic gormedi
       * `sampled` ise req7 ALT SINIRDIR (log kuyrugu 7 gunu kapsamiyor): "yuk yok" demeden
       * once bunu soyleriz, aksi halde buyuk loglu sunucuda yanlis "atil" cikardik.
       */
      const trafficOf = (service, env, location) => {
        const c = traffic.get(`${String(service || '').toUpperCase()}|${String(env || '').toUpperCase()}|${String(location || '')}`);
        if (!c || (c.hosts === 0 && c.unknown === 0)) return null;
        if (c.hosts === 0) return { state: 'unknown', req24: null, req7: null, hc24: null, lastSeen: null, sampled: false, hosts: 0, unknownHosts: c.unknown };
        return {
          state: c.req7 > 0 ? 'active' : (c.sampled ? 'unknown' : 'idle'),
          req24: c.req24, req7: c.req7, hc24: c.hc24,
          lastSeen: c.lastSeen, sampled: c.sampled, hosts: c.hosts, unknownHosts: c.unknown,
        };
      };

      // PROD MATRISTE (2026-09-14, kullanici: "prod uygulamalarin bilgileri gozukmuyor"):
      // eski GBRVP* vhost'lari SPA include'u degil proxy_pass kullanir; bu satirlar
      // spaFilter ile disarida kaliyor ve PROD sutunu bos kaliyordu. Proxy satirlari
      // Production Tasimalari'ndaki cozumle (-prod eki dahil) uygulamaya cevrilip
      // status='PROXY' SPA satiri gibi haritaya katilir. namespace cozumden gelir; hucre
      // H/A/C bayraklari YENI prod SPA sunucularindan (tasima grubunun newHosts'u) okunur.
      let prodProxyStats = null;
      if (await hasProxyColumns()) {
        try {
          const [prx, routes, ocp] = await Promise.all([
            query(
              `SELECT service, env, host, vhost, location_path, upstream_name, target_url
                 FROM dbo.Nginx_Config_Audit
                WHERE scan_date = @d AND kind = 'proxy' AND UPPER(env) = 'PROD'`,
              [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
            ),
            query(`SELECT DISTINCT namespace_name, route_address FROM dbo.BMW_Openshift_Route_Inventory`).catch(() => ({ recordset: [] })),
            query(`SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory`).catch(() => ({ recordset: [] })),
          ]);
          const maps = buildResolverMaps(routes.recordset || [], ocp.recordset || []);
          const hostOf = (u) => String(u || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '');
          prodProxyStats = { rows: 0, resolved: 0, unresolved: 0 };
          for (const r of prx.recordset || []) {
            prodProxyStats.rows++;
            const target = hostOf(r.target_url) || hostOf(r.upstream_name);
            const res = resolveTarget(target, maps.routeByAddress, maps.ocpByLabel, maps.routeByLabel);
            if (!res.application) {
              prodProxyStats.unresolved++;
              continue;
            }
            prodProxyStats.resolved++;
            raw.push({
              service: r.service, env: 'PROD', application: res.application, namespace: res.namespace,
              include_name: null, location_path: r.location_path, host: r.host, vhost: r.vhost,
              deploy_mode: 'proxy', include_exists: 1, app_deployed: null, in_ocp_inventory: 1,
              status: 'PROXY', _proxyTarget: target, _suffixAdded: res.suffixAdded === true,
            });
          }
        } catch (e) {
          console.warn('[denetim] PROD proxy satirlari matrise katilamadi:', e.message);
        }
      }

      // ENV LISTESI VERIDEN TURETILIR. Kanonik dortlu her zaman gosterilir (bir ortam
      // hic taranmadiysa "bos" olarak GORUNMESI gerekir, sessizce kaybolmasi degil);
      // veride gecen baska jetonlar da eklenir, yoksa o satirlar hicbir sutuna dusmez.
      // ENV NORMALIZE TEK YERDE (2026-08-28). Ayni deger UC yerde normalize ediliyordu
      // ve biri FARKLIYDI: env listesi/istatistikler `.trim().toUpperCase() || '(bos)'`
      // kullanirken hucre anahtari yalnizca `.toUpperCase()` yapiyordu. Sonuc: env'i
      // bos ya da bosluklu (`" qa "`) olan satirlar `''` / `' QA '` anahtari uretiyor,
      // bu anahtarlar `envList`te olmadigi icin hucre HICBIR SUTUNA dusmuyor ve veri
      // ekranda SESSIZCE kayboluyordu. Artik uc cagri da bu fonksiyondan geciyor.
      const normEnv = (v) =>
        String(v || '')
          .trim()
          .toUpperCase() || '(bos)';

      const CANON = ['DEV', 'TEST', 'QA', 'PROD'];
      const seenEnvs = new Set();
      for (const r of raw) {
        seenEnvs.add(normEnv(r.env));
      }
      const envList = [...CANON, ...[...seenEnvs].filter((e) => !CANON.includes(e)).sort()];

      // Teshis: her env jetonu icin kac satir, hangi host'lar, hangi vhost dosyalari.
      // "PROD nicin bos" gibi sorular bu tabloya bakilarak cevaplanir.
      const statMap = new Map();
      for (const r of raw) {
        const e = normEnv(r.env);
        if (!statMap.has(e))
          statMap.set(e, { env: e, rows: 0, hosts: new Set(), vhosts: new Set() });
        const st = statMap.get(e);
        st.rows++;
        if (r.host) st.hosts.add(String(r.host));
        if (r.vhost) st.vhosts.add(String(r.vhost));
      }
      // SERVIS BASINA LOCATION SAYISI (kullanici, 2026-09-14): ortam kirilimiyla. Bir
      // location = (servis, ortam, vhost, location_path) - ayni tanim birden fazla
      // sunucuda (mirror) olabilir, sunucu sayisiyla CARPILMAZ.
      const svcLoc = new Map(); // service -> env -> Set(vhost|location)
      for (const r of raw) {
        const svc = r.service || '(bilinmiyor)';
        const e = normEnv(r.env);
        if (!svcLoc.has(svc)) svcLoc.set(svc, new Map());
        const m = svcLoc.get(svc);
        if (!m.has(e)) m.set(e, new Set());
        m.get(e).add(String(r.vhost || '') + '|' + String(r.location_path || ''));
      }
      const serviceStats = [...svcLoc.entries()]
        .map(([service, m]) => ({ service, envs: Object.fromEntries([...m.entries()].map(([e, set]) => [e, set.size])) }))
        .sort((a, b) => a.service.localeCompare(b.service));

      const envStats = envList.map((e) => {
        const st = statMap.get(e);
        return {
          env: e,
          rows: st ? st.rows : 0,
          hosts: st ? [...st.hosts].sort() : [],
          vhosts: st ? [...st.vhosts].sort() : [],
        };
      });

      // (service, application) -> ortam bazli durum. Ayni uygulama ayni ortamda birden
      // fazla host/location'da olabilir; ortam hucresi "en kotu" duruma gore ozetlenir
      // (BROKEN_INCLUDE/NOT_DEPLOYED gibi bir sorun varsa OK ile gizlenmesin).
      const SEVERITY = {
        OK: 0,
        DUP_SUFFIX: 1,
        NOT_IN_INVENTORY: 2,
        NAME_MISMATCH: 3,
        NOT_DEPLOYED: 4,
        BROKEN_INCLUDE: 5,
      };
      const map = new Map();
      for (const r of raw) {
        const service = r.service || '(bilinmiyor)';
        const application = r.application || r.include_name || '(bilinmiyor)';
        const env = normEnv(r.env);
        // Ayirici olarak U+0000: servis/uygulama adlarinda gecemeyecek tek karakter.
        // (Kaynakta HAM kontrol karakteri degil, KACIS DIZISI olarak yazilir.)
        const key = service + '\u0000' + application;
        if (!map.has(key)) map.set(key, { service, application, envs: {} });
        const entry = map.get(key);
        const prev = entry.envs[env];
        const cell = {
          present: true,
          status: r.status,
          namespace: r.namespace || null,
          deployMode: r.deploy_mode || null,
          includeExists: !!r.include_exists,
          appDeployed: !!r.app_deployed,
          inOcpInventory: !!r.in_ocp_inventory,
          locationPath: r.location_path,
          hosts: [r.host],
          proxyTarget: r._proxyTarget || null,
          suffixAdded: r._suffixAdded === true,
          traffic: trafficOf(r.service, r.env, r.location_path),
        };
        if (!prev) {
          entry.envs[env] = cell;
        } else {
          if (!prev.hosts.includes(r.host)) prev.hosts.push(r.host);
          if ((SEVERITY[r.status] ?? 0) > (SEVERITY[prev.status] ?? 0)) {
            Object.assign(prev, cell, { hosts: prev.hosts });
          }
        }
      }

      const rows = [...map.values()].sort(
        (a, b) => a.service.localeCompare(b.service) || a.application.localeCompare(b.application),
      );
      // (services listesi yanitta yeniden uretilir: NEW_ONLY satirlari sonradan eklenir)

      // H/A/C DIZIN BAYRAKLARI (2026-09-14, kullanici: "ayni gosterimi non-prod icin de"):
      // dizin taramasi (hysdeploy / applications / application-confs) HER sunucuda kosar ve
      // dbo.Nginx_Intranet_Audit'e yazilir (ad tarihsel). Matristeki her hucrenin sunuculari
      // icin (namespace, uygulama) bayraklari eklenir. Tablo yoksa hucreler bayraksiz kalir.
      // Eski GBRVP* hostu -> tasima grubunun yeni sunuculari (PROD proxy hucreleri bunlardan okur)
      const newHostsOfOld = new Map();
      for (const g of MIGRATION_GROUPS) for (const oh of g.oldHosts) newHostsOfOld.set(oh, g.newHosts);
      const dirHostsOfCell = (cell) => {
        if (cell.status !== 'PROXY') return cell.hosts;
        const set = new Set();
        for (const h of cell.hosts) for (const nh of newHostsOfOld.get(String(h).trim().toUpperCase()) || []) set.add(nh);
        return [...set];
      };
      const spaHosts = [...new Set([
        ...raw.map((r) => String(r.host || '').trim().toUpperCase()),
        ...MIGRATION_GROUPS.flatMap((g) => g.newHosts),
      ].filter(Boolean))];
      let dirsReady = false;
      const dirIdx = new Map(); // "HOST|ns/app" -> {hys, app, conf}
      const dirScannedHosts = new Set(); // son taramada satiri olan sunucular
      if (spaHosts.length) {
        try {
          const hIn = spaHosts.map((_, i) => `@h${i}`).join(', ');
          const dr = await query(
            `SELECT host, namespace, application, hys_deployed, app_deployed, conf_exists, conf_name
               FROM dbo.Nginx_Intranet_Audit
              WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)
                AND host IN (${hIn})`,
            spaHosts.map((h, i) => ({ name: `h${i}`, type: sql.NVarChar(64), value: h })),
          );
          dirsReady = true;
          const newProdHosts = new Set(MIGRATION_GROUPS.flatMap((g) => g.newHosts));
          const onNewProd = new Map(); // ns/app -> {hosts:Set, confName}
          // TARANAN sunucular: son taramada EN AZ BIR satiri olan host. Kullanici (2026-09-21):
          // "neden taranmadi gozukuyor?" — tablo yalniz izi olan (hysdeploy/app dizini/conf ya da
          // envanterde bulunan) ciftler icin satir yazar; hic izi olmayan uygulama icin satir YOK.
          // Bu "sunucu taranmadi" degil "sunucuda hicbir sey yok" demektir; ikisi ayri gosterilir.
          for (const d of dr.recordset || []) dirScannedHosts.add(String(d.host || '').trim().toUpperCase());
          for (const d of dr.recordset || []) {
            const host = String(d.host || '').trim().toUpperCase();
            const nsApp = String(d.namespace || '').trim().toLowerCase() + '/' + String(d.application || '').trim().toLowerCase();
            dirIdx.set(host + '|' + nsApp, { hys: !!d.hys_deployed, app: !!d.app_deployed, conf: !!d.conf_exists });
            if (newProdHosts.has(host) && (d.hys_deployed || d.app_deployed || d.conf_exists)) {
              if (!onNewProd.has(nsApp)) onNewProd.set(nsApp, { hosts: new Set(), confName: null, namespace: String(d.namespace || '').trim().toLowerCase(), application: String(d.application || '').trim().toLowerCase() });
              const e = onNewProd.get(nsApp);
              e.hosts.add(host);
              if (d.conf_name && !e.confName) e.confName = String(d.conf_name);
            }
          }
          // YALNIZ YENI SUNUCUDA (kullanici, 2026-09-14): yeni prod SPA sunucusunda dizin var ama
          // eski sunucuda proxy tanimi yok -> PROD hucresi NEW_ONLY. KURAL (kullanici, ayni gun):
          // bu hucre YALNIZCA dev/test/qa'da zaten gorunen bir uygulamaya eklenir; baska hicbir
          // ortamda olmayip yalniz yeni prod sunucusunda dizini olan uygulama SATIR OLUSTURMAZ
          // (dizin kalintisi/ornek olabilir, matrisi sisirmesin).
          const covered = new Set();
          for (const r of rows) {
            const c = r.envs.PROD;
            if (c && c.namespace) covered.add(String(c.namespace).toLowerCase() + '/' + r.application.toLowerCase());
          }
          for (const [nsApp, e] of onNewProd) {
            if (covered.has(nsApp)) continue;
            const row = rows.find((r) => r.application.toLowerCase() === e.application && !r.envs.PROD) || null;
            if (!row) continue; // baska ortamda yok -> gosterilmez
            row.envs.PROD = {
              present: true, status: 'NEW_ONLY', namespace: e.namespace, deployMode: 'namespaced',
              includeExists: false, appDeployed: true, inOcpInventory: true, locationPath: '', hosts: [...e.hosts].sort(),
            };
          }
        } catch (e) {
          console.warn('[denetim] dizin bayraklari okunamadi:', e.message);
          dirsReady = false;
        }
      }
      // PROXY hucresi (kullanici, 2026-09-17: "8 sunucu vardi, hepsi icin tanim var mi yok mu
      // belirt"): tasima grubunun ESKI sunucularinin hangilerinde proxy tanimi VAR, hangileri
      // EKSIK. Grup, tanimin gorüldugu ilk eski sunucudan bulunur.
      const oldGroupOf = new Map();
      for (const g of MIGRATION_GROUPS) for (const oh of g.oldHosts) oldGroupOf.set(oh, g.oldHosts);
      for (const r of rows) {
        for (const cell of Object.values(r.envs)) {
          if (cell.status !== 'PROXY') continue;
          const have = new Set(cell.hosts.map((h) => String(h).trim().toUpperCase()));
          const expected = oldGroupOf.get([...have][0]) || [...have];
          cell.oldExpected = expected;
          cell.oldMissing = expected.filter((h) => !have.has(h));
        }
      }
      if (dirsReady) {
        for (const r of rows) {
          for (const cell of Object.values(r.envs)) {
            if (!cell.namespace) continue; // flat dagitimda ns/app dizini yok
            const key = String(cell.namespace).trim().toLowerCase() + '/' + r.application.toLowerCase();
            cell.dirs = dirHostsOfCell(cell).map((h) => {
              const H = String(h).trim().toUpperCase();
              // null = sunucu son taramada HIC yok (taranmadi); satir yoksa ama sunucu tarandiysa
              // "hicbir iz yok" (h a c hepsi eksik) — eskiden ikisi de "taranmadi" gorunuyordu.
              const flags = dirIdx.get(H + '|' + key) || (dirScannedHosts.has(H) ? { hys: false, app: false, conf: false } : null);
              return { host: h, flags };
            });
          }
        }
      }

      // EKIP (2026-09-14): uygulamanin namespace'inin CMDB sahibi. Ortamlar farkli
      // namespace'te olabilir (glomo-dev / glomo-prod); hepsinin sahibi toplanir,
      // farkli ekiplerse hepsi listelenir. Namespace'siz satirlar "bilinmiyor".
      const owners = await loadNamespaceOwners(query);
      for (const r of rows) {
        const nss = [...new Set(Object.values(r.envs).map((c) => c.namespace).filter(Boolean))];
        r.owner = { ...ownersFor(owners.byNs, nss), namespaces: nss };
      }

      // Filo ozeti: kac location yuk aliyor / almiyor / bilinmiyor (ekranda tek bakista)
      const trafficStats = { ready: traffic.size > 0, active: 0, idle: 0, unknown: 0 };
      for (const r of rows) {
        for (const c of Object.values(r.envs)) {
          if (!c || !c.traffic) continue;
          trafficStats[c.traffic.state === 'active' ? 'active' : c.traffic.state === 'idle' ? 'idle' : 'unknown'] += 1;
        }
      }

      res.json({
        ok: true,
        trafficStats,
        ownersReady: owners.ready,
        dirsReady,
        prodProxy: prodProxyStats,
        serviceStats,
        scanDate: effectiveDate,
        scannedAt: await scanStamp(query, 'dbo.Nginx_Config_Audit'),
        availableDates: (datesRes.recordset || []).map((x) => x.d),
        services: [...new Set(rows.map((r) => r.service))].sort(), // NEW_ONLY satirlari dahil
        envs: envList,
        envStats,
        rows,
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, message: err.message || 'Nginx denetim verisi alınamadı.' });
    }
  });

  // ── 1b) SPA KAPSAMI: OpenShift'te kac SPA var, kaci nginx'e tanimli ────────────────
  // Iki bagimsiz kaynagi ORTAM bazinda karsilastirir:
  //   dbo.Openshift_Inventory   -> cluster'larda GERCEKTEN duran uygulamalar
  //   dbo.Nginx_Config_Audit    -> nginx konfiglerinde TANIMLI uygulamalar
  // Uc kova cikar: ikisinde de var / yalniz OpenShift'te (nginx'e tanimsiz) /
  // yalniz nginx'te (OpenShift envanterinde karsiligi yok - olu tanim olabilir).
  //
  // Ortam bilgisi OpenShift tarafinda NAMESPACE son ekinden gelir (-dev/-test/-qa/-prod),
  // cluster'dan DEGIL: ark_dev ile ark_test ayni cluster'lari paylasir, cluster tek basina
  // ortam bilgisi tasimaz. nginx tarafinda ise env, vhost DOSYA ADINDAN turer.
  // SPA TANIMI (kullanici tarafindan verildi): uygulama adinda "-app-v" ya da
  // "-app-emb-v" GECIYORSA o uygulama bir SPA'dir. Ad kalibina bakmak zorundayiz cunku
  // dbo.Openshift_Inventory yalnizca cluster/namespace/application tutuyor - SPA olup
  // olmadigini soyleyen bir sutun YOK.
  // ICERIR (contains) kontrolu, "ile biter" DEGIL: kural boyle verildi ve ornegin
  // "...-app-emb-v0" gibi adlarda surum sonekinden sonra baska bir sey de gelebilir.
  const SPA_RE = /-app(-emb)?-v/i;
  const SPA_LABEL = '-app-v / -app-emb-v';

  // ── 1c) ROUTE ISTATISTIKLERI: ortam basina route / SPA / SPA-disi / IP ──────────────
  // Hesap route-stats.cjs'te (birim testli). Platform suzgeci kapsam ucuyla ayni.
  router.get('/route-stats', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const platform = PLATFORM_CLUSTERS[String(req.query.platform || 'ark')] ? String(req.query.platform) : 'ark';
      const clusters = PLATFORM_CLUSTERS[platform];
      const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
      const r = await query(
        `SELECT cluster_name, namespace_name, route_name, route_address, resolved_ip, termination_type
           FROM dbo.BMW_Openshift_Route_Inventory
          WHERE cluster_name IN (${placeholders})`,
        clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(200), value: c })),
      ).catch(() => ({ recordset: [], _missing: true }));
      const out = buildRouteStats(r.recordset || []);
      res.json({ ok: true, platform, routeTableMissing: !!r._missing, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Route istatistikleri alınamadı.' });
    }
  });

  // Bir IP'ye cozen route'lar (ortam ozeti > SPA route -> IP tiklamasi)
  router.get('/route-stats/ip', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { routesOfIp } = require('./route-stats.cjs');
      const platform = PLATFORM_CLUSTERS[String(req.query.platform || 'ark')] ? String(req.query.platform) : 'ark';
      const clusters = PLATFORM_CLUSTERS[platform];
      const ip = String(req.query.ip || '').trim();
      if (!/^[0-9a-f.:]{3,45}$/i.test(ip)) return res.status(400).json({ ok: false, message: 'ip gecersiz' });
      const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
      const r = await query(
        `SELECT cluster_name, namespace_name, route_name, route_address, resolved_ip, termination_type
           FROM dbo.BMW_Openshift_Route_Inventory
          WHERE cluster_name IN (${placeholders}) AND LTRIM(RTRIM(resolved_ip)) = @ip`,
        [...clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(200), value: c })), { name: 'ip', type: sql.NVarChar(64), value: ip }],
      ).catch(() => ({ recordset: [], _missing: true }));
      const kind = ['spa', 'nonSpa', 'all'].includes(String(req.query.kind)) ? String(req.query.kind) : 'all';
      res.json({ ok: true, ip, env: String(req.query.env || '').toUpperCase(), kind, routeTableMissing: !!r._missing, rows: routesOfIp(r.recordset || [], ip, req.query.env, kind) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Route listesi alınamadı.' });
    }
  });

  router.get('/nginx-spa-coverage', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const platform = PLATFORM_CLUSTERS[String(req.query.platform || 'ark')]
        ? String(req.query.platform)
        : 'ark';
      const clusters = PLATFORM_CLUSTERS[platform];

      const dateRes = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`,
      );
      const scanDate = dateRes.recordset?.[0]?.d || null;

      const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
      const clusterParams = () =>
        clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(200), value: c }));

      const [ocpRes, ngxRes, routeRes, intraRes, proxyRes] = await Promise.all([
        query(
          `SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory
            WHERE cluster IN (${placeholders})`,
          clusterParams(),
        ),
        scanDate
          ? query(
              // host DA cekiliyor: nginx sunuculari artik IKI KATMAN (internete
              // acik + intranet). Hangi katmanda tanimli oldugu bilinmeden "intranet
              // uygulamasi intranet sunucusuna deploy olmus mu" sorusu cevaplanamaz.
              `SELECT DISTINCT env, application, host, service FROM dbo.Nginx_Config_Audit
                WHERE scan_date = @d${await spaFilter()}`,
              [{ name: 'd', type: sql.NVarChar(10), value: scanDate }],
            )
          : Promise.resolve({ recordset: [] }),
        // Route tipi = uygulamanin AGI. Iki tablo da cluster/namespace adlarini AYNI
        // kaynaktan (global_variables cluster tanimlari + `oc projects`) uretiyor, bu
        // yuzden bu iki alan uzerinden birlestirmek guvenli.
        query(
          `SELECT DISTINCT namespace_name, route_name, route_address, termination_type
             FROM dbo.BMW_Openshift_Route_Inventory
            WHERE cluster_name IN (${placeholders})`,
          clusterParams(),
        ).catch(() => ({ recordset: [], _missing: true })),
        // INTRANET: ayri tablo, ayri tane. Bu sunucularda servis vhost'u olmadigi icin
        // kapsam location'lardan DEGIL, uc dizinin varligindan okunur
        // (bkz. nginx-intranet.cjs ve bmw_nginx/nginx_config_audit).
        // Kendi scan_date'i kullanilir: DDL sonradan calistirildiysa iki tablonun son
        // tarama gunu ayni olmayabilir; Nginx_Config_Audit'in tarihini dayatmak
        // intranet tarafini bos gosterirdi.
        query(
          `SELECT host, namespace, application, hys_deployed, app_deployed,
                  conf_exists, status
             FROM dbo.Nginx_Intranet_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)`,
        ).catch(() => ({ recordset: [], _missing: true })),
        // PROD: eski GBRVP* vhost'lari SPA include'u DEGIL proxy_pass kullanir; bu satirlar
        // spaFilter ile disarida kaliyordu ve PROD kapsami "olculemedi" gorunuyordu
        // (kullanici bildirimi, 2026-09-14). Hedefler Production Tasimalari'ndaki cozumle
        // (-prod eki dahil) uygulamaya cevrilir ve PROD nginx kumesine katilir.
        scanDate && (await hasProxyColumns())
          ? query(
              `SELECT host, upstream_name, target_url, service
                 FROM dbo.Nginx_Config_Audit
                WHERE scan_date = @d AND kind = 'proxy' AND UPPER(env) = 'PROD'`,
              [{ name: 'd', type: sql.NVarChar(10), value: scanDate }],
            ).catch(() => ({ recordset: [] }))
          : Promise.resolve({ recordset: [] }),
      ]);

      const routeTableMissing = !!routeRes._missing;
      // Tablo YOKSA bu "hicbiri deploy edilmemis" DEMEK DEGILDIR - DDL henuz
      // calistirilmamis demektir. Ikisini ayirmadan ekran yanlis alarm uretir.
      const intranetTableMissing = !!intraRes._missing;
      const intraIdx = indexIntranetRows(intraRes.recordset || []);
      // INTERNET sunucularindaki dizin taramasi (kullanici, 2026-09-18): "deploy edilmis" =
      // internete acik en az bir sunucuda /hysdeploy/<ns>/<app>/ VE /usr/nginx/applications/
      // <ns>/<app>/ var (H+A; matristeki "hazir" kurali). Konfigurasyon tanimi (include /
      // proxy) AYRI olcudur; ikisi karistirildigi icin ozet yaniltiyordu. Ortam sunucu
      // adindan (envOfHost; yeni PROD SPA sunuculari GBNGXP4x -> PROD).
      const netDirs = new Map(); // env -> app(lower) -> { hosts: [{host, hys, app}] }
      for (const r of intraRes.recordset || []) {
        const host = String(r.host || '').trim().toUpperCase();
        const app = String(r.application || '').trim();
        if (!host || !app || tierOfHost(host) === 'intranet') continue;
        const env = envOfHost(host);
        if (!netDirs.has(env)) netDirs.set(env, new Map());
        const k = app.toLowerCase();
        if (!netDirs.get(env).has(k)) netDirs.get(env).set(k, { hosts: [] });
        netDirs.get(env).get(k).hosts.push({ host, hys: !!r.hys_deployed, app: !!r.app_deployed });
      }

      // ── Route tipi haritasi ───────────────────────────────────────────────────────
      // "<namespace>|<route>" -> tip, ve "<namespace>" -> o namespace'teki tum tipler.
      // ASIL ESLESME ADRESTEN yapilir. route_name ile uygulama adinin ayni oldugu
      // GARANTI DEGIL (biri route'un, digeri deployment/rollout/dc'nin adi), ama route
      // ADRESI kurumsal kalibi tasiyor:
      //   dev/test/qa : <Application>-<Namespace>.apps-t.fw.garanti.com.tr
      //   prod        : <Application>-<Namespace>.apps.fw.garanti.com.tr
      // Namespace'i satirdan ZATEN bildigimiz icin ilk etiketin sonundaki "-<namespace>"
      // TAM OLARAK kesilir; "uygulama adi nerede biter, namespace nerede baslar"
      // belirsizligi hic dogmaz. Uygulama adinin icinde namespace'e benzeyen bir metin
      // gecse bile dogru calisir (ornek: follow-up-app-v0 / follow-up-test).
      // Kaliba uymayan (elle verilmis) adreslerde null doner - TAHMIN EDILMEZ.
      function appFromAddress(addr, nsLower) {
        const label = String(addr || '')
          .trim()
          .toLowerCase()
          .split('.')[0];
        if (!label || !nsLower) return null;
        const suf = '-' + nsLower;
        return label.endsWith(suf) ? label.slice(0, -suf.length) : null;
      }

      const routeByApp = new Map(); // "<ns> <app>"   -> tip  (adresten cozuldu)
      const routeByName = new Map(); // "<ns> <route>" -> tip  (route adiyla)
      const routeByNs = new Map(); // "<ns>"         -> o namespace'teki TUM tipler
      for (const r of routeRes.recordset || []) {
        const ns = String(r.namespace_name || '')
          .trim()
          .toLowerCase();
        const rt = String(r.route_name || '')
          .trim()
          .toLowerCase();
        const tt =
          String(r.termination_type || '')
            .trim()
            .toLowerCase() || 'yok';
        if (!ns) continue;
        const fromAddr = appFromAddress(r.route_address, ns);
        if (fromAddr) routeByApp.set(ns + ' ' + fromAddr, tt);
        if (rt) routeByName.set(ns + ' ' + rt, tt);
        if (!routeByNs.has(ns)) routeByNs.set(ns, new Set());
        routeByNs.get(ns).add(tt);
      }

      // Bir uygulamanin route tipini bul. Eslesmenin NASIL kuruldugu da sayilir ve
      // ekranda gosterilir - siniflandirmanin guvenilirligi buna bagli, gizlenmez.
      //   address : route ADRESINDEN cozuldu (kurumsal kalip) - EN GUVENILIR
      //   name    : adres kaliba uymadi ama ayni adli bir route var
      //   ns      : ikisi de tutmadi, ama namespace'teki TUM route'lar ayni tipte
      //   conflict: namespace'te tipler CELISIYOR   -> siniflandirilMAZ
      //   none    : hic route bilgisi yok           -> siniflandirilMAZ
      const matchStats = { address: 0, name: 0, ns: 0, conflict: 0, none: 0 };
      function terminationOf(nsLower, appLower) {
        const byAddr = routeByApp.get(nsLower + ' ' + appLower);
        if (byAddr) {
          matchStats.address++;
          return { type: byAddr, how: 'address' };
        }
        const byName = routeByName.get(nsLower + ' ' + appLower);
        if (byName) {
          matchStats.name++;
          return { type: byName, how: 'name' };
        }
        const set = routeByNs.get(nsLower);
        if (set && set.size === 1) {
          matchStats.ns++;
          return { type: [...set][0], how: 'ns' };
        }
        if (set && set.size > 1) {
          matchStats.conflict++;
          return { type: null, how: 'conflict' };
        }
        matchStats.none++;
        return { type: null, how: 'none' };
      }

      // ── OpenShift tarafi: SPA suzgeci + ag siniflandirmasi ────────────────────────
      const ocpNonSpa = new Set();
      let ocpNoEnv = 0;
      // env -> { app -> { name, net } }   net: 'internet' | 'intranet' | 'diger' | 'bilinmiyor'
      const ocp = new Map();
      // env -> Set(app)  SPA olsun olmasin TUM uygulamalar: ortam ozetindeki "SPA'larin
      // envanterdeki payi" (kullanici, 2026-09-17) bunun uzerinden.
      const ocpAll = new Map();
      for (const r of ocpRes.recordset || []) {
        const app = String(r.application || '').trim();
        if (!app) continue;
        const e = envOfNamespace(r.namespace);
        if (e) {
          const E = e.toUpperCase();
          if (!ocpAll.has(E)) ocpAll.set(E, new Set());
          ocpAll.get(E).add(app.toLowerCase());
        }
        if (!SPA_RE.test(app)) {
          ocpNonSpa.add(app.toLowerCase());
          continue;
        }
        if (!e) {
          ocpNoEnv++;
          continue;
        }
        const env = e.toUpperCase();
        const nsLower = String(r.namespace || '')
          .trim()
          .toLowerCase();
        const { type } = terminationOf(nsLower, app.toLowerCase());
        // Kullanicinin verdigi kural: passthrough -> internet (nginx'e cikabilir),
        // reencrypt -> intranet (nginx'e CIKAMAZ). Diger tipler (edge, tls yok)
        // bu kuralin disinda; "diger" olarak ayri tutulur, tahmin edilmez.
        const net =
          type === 'passthrough'
            ? 'internet'
            : type === 'reencrypt'
              ? 'intranet'
              : type
                ? 'diger'
                : 'bilinmiyor';
        if (!ocp.has(env)) ocp.set(env, new Map());
        const k = app.toLowerCase();
        const prev = ocp.get(env).get(k);
        // Ayni uygulama birden fazla namespace'te olabilir; internet bilgisi baskindir
        // (bir yerde bile internete acilliyorsa nginx'e cikabilir demektir).
        // Namespace'ler sahiplik icin biriktirilir (kullanici, 2026-09-17: "deploy olmamis
        // uygulamalari ve sahipliklerini getir"): ekip namespace'in CMDB sahibidir.
        const nss = prev ? prev.nss : new Set();
        nss.add(nsLower);
        if (!prev || (prev.net !== 'internet' && net === 'internet')) {
          ocp.get(env).set(k, { name: app, net, nss });
        }
      }
      const owners = await loadNamespaceOwners(query);
      // Eksik uygulama satiri: ad + namespace'ler + ekip (OwnerCell ile ayni sekil)
      const detailOf = (env, name, extra) => {
        const v = (ocp.get(env) || new Map()).get(String(name).toLowerCase());
        const nss = v ? [...v.nss].sort() : [];
        return { app: name, namespaces: nss, owner: { ...ownersFor(owners.byNs, nss), namespaces: nss }, ...extra };
      };

      // ── nginx tarafi ──────────────────────────────────────────────────────────────
      const ngxNonSpa = new Set();
      const ngx = new Map(); // INTERNETE ACIK sunucularda tanimli SPA'lar
      // env -> app(lower) -> Set(SERVIS): uygulama hangi nginx servisinin (vhost: GLOMO,
      // WEBFORMS, SAKLAMA...) altinda tanimli (kullanici, 2026-09-17: "kac tanesi hangi
      // servisin altindan reverse proxy'leniyor"). Non-prod: include satirinin vhost'u;
      // PROD: eski sunucudaki proxy_pass satirinin vhost'u.
      const ngxSvc = new Map();
      const addSvc = (env, appLower, svc) => {
        const sv = String(svc || '').trim().toUpperCase() || '(bilinmiyor)';
        if (!ngxSvc.has(env)) ngxSvc.set(env, new Map());
        if (!ngxSvc.get(env).has(appLower)) ngxSvc.get(env).set(appLower, new Set());
        ngxSvc.get(env).get(appLower).add(sv);
      };
      // Intranet sunucusunda servis vhost'u BEKLENMEZ. Yine de bir location kaydi
      // cikarsa bunu SESSIZCE internet kumesine katmak orani bozar; sayilir ve
      // ekranda bilgi olarak gosterilir.
      let intranetVhostRows = 0;
      for (const r of ngxRes.recordset || []) {
        const e = String(r.env || '')
          .trim()
          .toUpperCase();
        const app = String(r.application || '').trim();
        if (!app || !e) continue;
        if (!SPA_RE.test(app)) {
          ngxNonSpa.add(app);
          continue;
        }
        // Katman host'tan gelir (bkz. nginx-hosts.cjs INTRANET_HOSTS). Listede
        // olmayan her host internete acik sayilir.
        if (tierOfHost(r.host) === 'intranet') {
          intranetVhostRows++;
          continue;
        }
        if (!ngx.has(e)) ngx.set(e, new Map());
        ngx.get(e).set(app.toLowerCase(), app);
        addSvc(e, app.toLowerCase(), r.service);
      }
      // PROD proxy satirlari -> (ns, app) -> PROD nginx kumesi (internet katmani; GBRVP*
      // hostlari internettir). Cozulemeyenler sayilir, sessizce dusmez.
      const proxyStats = { rows: 0, resolved: 0, spa: 0, unresolved: 0 };
      {
        const maps = buildResolverMaps(routeRes.recordset || [], ocpRes.recordset || []);
        const hostOf = (u) => String(u || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '');
        for (const r of proxyRes.recordset || []) {
          proxyStats.rows++;
          if (tierOfHost(r.host) === 'intranet') continue;
          const target = hostOf(r.target_url) || hostOf(r.upstream_name);
          const res = resolveTarget(target, maps.routeByAddress, maps.ocpByLabel, maps.routeByLabel);
          if (!res.application) {
            proxyStats.unresolved++;
            continue;
          }
          proxyStats.resolved++;
          if (!SPA_RE.test(res.application)) {
            ngxNonSpa.add(res.application);
            continue;
          }
          proxyStats.spa++;
          if (!ngx.has('PROD')) ngx.set('PROD', new Map());
          if (!ngx.get('PROD').has(res.application)) ngx.get('PROD').set(res.application, res.application);
          addSvc('PROD', String(res.application).toLowerCase(), r.service);
        }
      }

      const nginxOutsidePattern = [...ngxNonSpa]
        .sort((a, b) => a.localeCompare(b, 'tr'))
        .slice(0, 40);

      const ENV_LIST = [
        ...new Set([
          ...ENVS.map((e) => e.toUpperCase()),
          ...ocp.keys(),
          ...ngx.keys(),
          ...intraIdx.keys(), // EDU gibi YALNIZ intranet tarafinda gecen ortamlar
        ]),
      ];
      const CAP = 300;
      const sortTr = (a, b) => a.localeCompare(b, 'tr');

      const rows = ENV_LIST.map((e) => {
        const o = ocp.get(e) || new Map();
        const n = ngx.get(e) || new Map();
        // nginx'te bu ortama ait HIC satir yoksa kapsam OLCULEMEZ (proxy_pass mimarisi
        // gibi durumlar). "%0 kapsam" demek yaniltici olurdu.
        const measured = n.size > 0;

        const bucket = { internet: [], intranet: [], diger: [], bilinmiyor: [] };
        const inNginx = { internet: [], intranet: [], diger: [], bilinmiyor: [] };
        for (const [k, v] of o) {
          bucket[v.net].push(v.name);
          if (n.has(k)) inNginx[v.net].push(v.name);
        }
        const internetMissing = bucket.internet.filter((a) => !n.has(a.toLowerCase()));
        // DEPLOY EDILMIS (H+A) / SERVISE TANIMLI / YUK ALIYOR (ikisi de) - uc ayri kume
        const nd = netDirs.get(e) || new Map();
        const dirsMeasured = nd.size > 0;
        const deployedOn = (a) => ((nd.get(a.toLowerCase()) || { hosts: [] }).hosts.filter((h) => h.hys && h.app).map((h) => h.host));
        const deployed = bucket.internet.filter((a) => deployedOn(a).length > 0);
        const deployedSet = new Set(deployed.map((a) => a.toLowerCase()));
        const serving = deployed.filter((a) => n.has(a.toLowerCase()));
        const notDeployed = bucket.internet.filter((a) => !deployedSet.has(a.toLowerCase()));
        const deployedNotDefined = deployed.filter((a) => !n.has(a.toLowerCase()));
        const definedNotDeployed = bucket.internet.filter((a) => n.has(a.toLowerCase()) && !deployedSet.has(a.toLowerCase()));
        // Internet SPA'larindan nginx'te tanimli olanlarin SERVIS kirilimi: servis -> uygulama
        // sayisi. Bir uygulama birden fazla vhost'ta tanimliysa her birinde sayilir
        // (multi = kac uygulama birden fazla serviste). Toplam servis sayilari bu yuzden
        // internetInNginx'i asabilir; ekran bunu yazar.
        const svcCount = new Map();
        let multi = 0;
        // Bir nginx SERVISININ altinda hizmet alan FARKLI uygulama sayisi (kullanici,
        // 2026-09-18: "435 SPA'nin kaci Glomo/Webforms/Saklama altindan hizmet aliyor" -
        // servis toplamlari cakisma yuzunden bunu vermez). Servisi bilinmeyen sayilmaz.
        let serviced = 0;
        for (const a of inNginx.internet) {
          const set = (ngxSvc.get(e) || new Map()).get(a.toLowerCase()) || new Set(['(bilinmiyor)']);
          if (set.size > 1) multi++;
          if ([...set].some((sv) => sv !== '(bilinmiyor)')) serviced++;
          for (const sv of set) svcCount.set(sv, (svcCount.get(sv) || 0) + 1);
        }
        const internetServices = [...svcCount.entries()].map(([service, count]) => ({ service, count })).sort((x, y) => y.count - x.count || x.service.localeCompare(y.service));
        // INTRANET KAPSAMI: uygulama uc dizinin UCUNDE de var mi? Hesap ayri modulde
        // (nginx-intranet.cjs) - orada birim testleriyle kilitli.
        const ic = coverageForEnv(bucket.intranet, intraIdx.get(e), CAP);
        const onlyNginx = [];
        for (const [k, v] of n) if (!o.has(k)) onlyNginx.push(v);

        return {
          // DIKKAT: map parametresi `e`; burada `env` yazmak ReferenceError uretiyordu
          // (uctan uca testte yakalandi - duz JS oldugu icin tsc gormuyor).
          env: e,
          measured,
          // Ortam ozeti (2026-09-17): bu ortamdaki TUM OpenShift uygulamalari ve TUM SPA'lar
          // (internet + intranet + diger + bilinmiyor) - "kac SPA var, envanterin yuzde kaci".
          ocpApps: (ocpAll.get(e) || new Set()).size,
          spaTotal: o.size,
          // INTERNET (passthrough) = nginx'e cikmasi BEKLENEN kume. Kapsam bunun uzerinden.
          internetTotal: bucket.internet.length,
          internetInNginx: inNginx.internet.length,
          internetServices,
          internetMultiService: multi,
          internetServiced: serviced,
          internetMissingCount: internetMissing.length,
          internetMissing: internetMissing.sort(sortTr).slice(0, CAP),
          // Deploy (H+A, internet sunuculari) - 2026-09-18
          internetDirsMeasured: dirsMeasured,
          internetDeployed: deployed.length,
          internetServing: serving.length,
          internetNotDeployedCount: notDeployed.length,
          internetDeployedNotDefinedCount: deployedNotDefined.length,
          internetDefinedNotDeployedCount: definedNotDeployed.length,
          // Sahiplikli ayrinti (ekrandaki "tikla, listeyi gor"): internet = nginx'te tanimi
          // olmayanlar; intranet = hic kurulmamis + yarim kurulmus (eksik dizinler ve sunucular)
          missingDetail: {
            internet: internetMissing.slice(0, CAP).map((a) => detailOf(e, a, { kind: 'missing' })),
            intranet: [
              ...ic.missing.map((a) => detailOf(e, a, { kind: 'missing' })),
              ...ic.partial.map((x) => detailOf(e, x.app, { kind: 'partial', namespace: x.namespace, hosts: x.hosts })),
            ],
            // ROUTE'SUZ SPA'lar (kullanici, 2026-09-18): OpenShift'te var ama route envanterinde
            // hic kaydi yok -> internet/intranet siniflandirilamiyor; nginx'te tanimli olup
            // olmadigi ayrica yazilir (inNginx: eski sunucuda proxy / include var mi).
            noRoute: bucket.bilinmiyor.slice(0, CAP).map((a) => detailOf(e, a, { kind: 'noroute', inNginx: n.has(a.toLowerCase()) })),
            // deploy bakisi (2026-09-18): ekibin isi / bizim isimiz / 404 riski
            notDeployed: notDeployed.sort(sortTr).slice(0, CAP).map((a) => detailOf(e, a, { kind: 'notdeployed', defined: n.has(a.toLowerCase()) })),
            deployedNotDefined: deployedNotDefined.sort(sortTr).slice(0, CAP).map((a) => detailOf(e, a, { kind: 'notdefined', hosts: deployedOn(a).map((h) => ({ host: h, missing: [] })) })),
            definedNotDeployed: definedNotDeployed.sort(sortTr).slice(0, CAP).map((a) => detailOf(e, a, { kind: 'nopackage' })),
          },
          // INTRANET (reencrypt) = intranet SPA sunucularina dagitilir. Olcum
          // location'dan DEGIL, uc dizinin varligindan gelir (2026-09-10 duzeltmesi):
          //   /hysdeploy/<ns>/<app>/ + /usr/nginx/applications/<ns>/<app>/ +
          //   application-confs/<app>-<ns>.conf
          // "Yarim kurulum" ayri kovada: 404 doner ama mudahalesi bastan kurulumdan
          // farklidir, ikisini birlestirmek nerede is oldugunu gizlerdi.
          intranetTotal: bucket.intranet.length,
          measuredIntranet: ic.measured,
          intranetFull: ic.fullCount,
          intranetPartialCount: ic.partialCount,
          intranetPartial: ic.partial,
          intranetMissingCount: ic.missingCount,
          intranetMissing: ic.missing,
          intranetOnlyOnServerCount: ic.onlyOnServerCount,
          intranetOnlyOnServer: ic.onlyOnServer,
          intranetHosts: ic.hosts,
          intranetCoverage: ic.coverage,
          // BULGU DARALDI: intranet uygulamasinin INTERNETE ACIK sunucuda tanimli
          // olmasi. Intranet sunucusunda olmasi artik NORMALDIR, bulgu degildir.
          intranetInNginx: inNginx.intranet.length,
          intranetInNginxList: inNginx.intranet.sort(sortTr).slice(0, CAP),
          // Route tipi passthrough/reencrypt DISINDA olanlar (edge, tls yok).
          otherTotal: bucket.diger.length,
          otherInNginx: inNginx.diger.length,
          // Route bilgisi hic bulunamayanlar - siniflandirilamaz, tahmin YOK.
          unknownTotal: bucket.bilinmiyor.length,
          unknownInNginx: inNginx.bilinmiyor.length,
          // nginx'te var ama OpenShift SPA listesinde yok.
          onlyNginxCount: onlyNginx.length,
          onlyNginx: onlyNginx.sort(sortTr).slice(0, CAP),
          // Kapsam YALNIZCA internet kumesi uzerinden: intranet uygulamalarini paydaya
          // katmak, cikmasi zaten yasak olanlari "eksik" saymak olurdu.
          coverage:
            measured && bucket.internet.length
              ? Math.round((inNginx.internet.length / bucket.internet.length) * 1000) / 10
              : null,
        };
      }).filter(
        (r) =>
          r.internetTotal || r.intranetTotal || r.otherTotal || r.unknownTotal || r.onlyNginxCount,
      );

      // Intranet sunuculari HENUZ TARANMADIYSA bunu ekran SOYLEMELI: aksi halde "hicbir
      // intranet uygulamasi deploy edilmemis" gibi okunur ve yanlis alarm uretir.
      const intranetScanned = intraIdx.size > 0;

      res.json({
        ok: true,
        platform,
        platforms: Object.keys(PLATFORM_CLUSTERS),
        clusters,
        scanDate,
        spaPatternLabel: SPA_LABEL,
        // Route tablosu okunamadiysa ekran bunu SOYLEMELI: aksi halde her sey
        // "bilinmiyor" kovasina duser ve sebebi anlasilmaz.
        routeTableMissing,
        intranetScanned,
        intranetTableMissing,
        // Beklenmeyen durum: intranet sunucusunda servis vhost'u tanimi bulundu.
        intranetVhostRows,
        routeMatch: matchStats,
        ownersReady: owners.ready,
        // PROD nginx kumesinin kaynagi: eski sunucudaki proxy_pass satirlari (cozum sayilari)
        prodProxy: proxyStats,
        ocpNonSpaExcluded: ocpNonSpa.size,
        nginxOutsidePattern,
        ocpSkippedNoEnv: ocpNoEnv,
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'SPA kapsam verisi alınamadı.' });
    }
  });

  // ── 1c) NGINX AUDIT: TUM nginx sunuculari, nginx -T tabanli ───────────────────────
  // Bes tablo (Hosts/Servers/Locations/Upstreams/Settings) host bazinda birlestirilir.
  // Ureten is: bmw_nginx/nginx_audit. Legacy denetiminden AYRI veri, AYRI ekran.
  // Alti tabloyu (son tarama) okur ve host bazinda birlestirir. `onlyHost` verilirse
  // yalnizca o sunucu (detay sayfasi): tum filoyu cekip birini secmek yerine SQL'de
  // suzulur - ayarlar tablosu binlerce satir olabiliyor.
  async function loadNginxAudit(onlyHost) {
    // queryLong (2026-09-21): 14 gunluk tablolarda 30 sn yetmiyordu; 180 sn'lik ayri havuz.
    const { queryLong: query, sql } = require('../inventory/mssql.cjs');

    const dateRes = await readLatestAuditDate(query);

    // Tablo YOKSA "bulgu yok" DEGIL, DDL calistirilmamis demektir.
    if (dateRes._missing) {
      return { ok: true, schemaReady: false, filesReady: false, scanDate: null, hosts: [], totals: null };
    }
    const scanDate = dateRes.recordset?.[0]?.d || null;
    if (!scanDate) {
      return { ok: true, schemaReady: true, filesReady: false, scanDate: null, hosts: [], totals: null };
    }

    const hostCond = onlyHost ? ' AND host = @host' : '';
    const params = [{ name: 'scanDate', type: sql.Date, value: scanDate }];
    if (onlyHost) params.push({ name: 'host', type: sql.NVarChar(64), value: onlyHost });
    // Butun audit tablolari yanitta ilan edilen Hosts snapshot'ini okumali. Tablo
    // basina MAX kullanmak, yarim yuklemede eski detaylari yeni taramaya tasirdi.
    const latest = () => `WHERE scan_date = @scanDate${hostCond}`;
    const q = (text) => query(text, params);

    // Nginx_Audit_Files SONRADAN eklendi: tablo yoksa dosya uyumu bolumu "henuz yok"
    // olarak gosterilir, ekranin geri kalani calisir.
    const filesQ = q(`SELECT host, ref_file, path, file_exists, identical, n_missing, n_changed,
                             n_extra, details
                        FROM dbo.Nginx_Audit_Files ${latest()}`)
      .then((r) => ({ rows: r.recordset || [], ready: true }))
      .catch(() => ({ rows: [], ready: false }));

    // Ortam: ad kalibi tutmayan hostlar icin dbo.Inventory.env (middleware_inventory).
    const invQ = query(
      `SELECT host, env FROM dbo.Inventory
        WHERE nginx_version IS NOT NULL AND LTRIM(RTRIM(nginx_version)) <> ''`,
    )
      .then((r) => r.recordset || [])
      .catch(() => []);

    // Kabul edilen degerler (nginx_audit_allowed_values, Portal DB); tablo yoksa bos.
    const allowedQ = require('../db/index.cjs')
      .query(`SELECT id, directive, value, note FROM nginx_audit_allowed_values`)
      .then((r) => r.rows || [])
      .catch(() => []);
    // Istisnalar Portal DB'sinde (nginx_audit_exceptions); tablo yoksa bos.
    const excQ = require('../db/index.cjs')
      .query(`SELECT host, note, created_by, created_at, updated_by, updated_at FROM nginx_audit_exceptions`)
      .then((r) => r.rows || [])
      .catch(() => []);
    const [hosts, servers, locations, upstreams, settings, files, inventory, exceptions, allowed] = await Promise.all([
      q(`SELECT host, status, status_msg, files, server_blocks, locations,
                locations_proxy, upstreams, ups_no_resolve, ups_no_keepalive,
                ups_no_zone, unused_upstreams, proxy_fqdn, proxy_undefined,
                settings_mismatch
           FROM dbo.Nginx_Audit_Hosts ${latest()}`),
      q(`SELECT host, conf_file, seq, listen, server_name, ssl, cert_file, locations
           FROM dbo.Nginx_Audit_Servers ${latest()}`),
      q(`SELECT host, conf_file, srv_seq, location, behaviour, proxy_target, target_kind
           FROM dbo.Nginx_Audit_Locations ${latest()}`),
      q(`SELECT host, conf_file, name, server, resolve, keepalive, zone, used
           FROM dbo.Nginx_Audit_Upstreams ${latest()}`),
      q(`SELECT host, conf_file, context, directive, value, reference_value, matches
           FROM dbo.Nginx_Audit_Settings ${latest()}`),
      filesQ,
      invQ,
      excQ,
      allowedQ,
    ]);

    const out = summarizeAudit({
      hosts: hosts.recordset || [],
      servers: servers.recordset || [],
      locations: locations.recordset || [],
      upstreams: upstreams.recordset || [],
      settings: settings.recordset || [],
      allowed,
      files: files.rows,
      inventory,
      exceptions,
    });
    return { ok: true, schemaReady: true, filesReady: files.ready, scanDate, ...out };
  }

  // Sicak onbellek (2026-09-21): tum filo hesabi bellekte, istek aninda doner; suresi dolunca
  // arka planda yenilenir; ?fresh=1 bekleyerek yeniler. Boot'tan 45 sn sonra onceden isitilir.
  const { createWarmCache } = require('./warm-cache.cjs');
  const nginxAuditWarm = createWarmCache({ name: 'nginx-audit', ttlMs: 10 * 60 * 1000, compute: () => loadNginxAudit(null) });
  nginxAuditWarm.warm(45000);
  router.get('/nginx-audit', async (req, res) => {
    try {
      res.json(await nginxAuditWarm.get({ fresh: req.query.fresh === '1' }));
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Nginx audit verisi alınamadı.' });
    }
  });

  // ── Nginx Audit istisnalari (2026-09-15): yalniz Admin yazar, herkes gorur ────────────
  {
    const db = require('../db/index.cjs');
    let requireAdmin = (_req, res) => res.status(403).json({ ok: false, message: 'Yetki yok.' });
    let getRequestUser = () => null;
    try {
      const auth = require('../auth/index.cjs');
      if (typeof auth.requireAdmin === 'function') requireAdmin = auth.requireAdmin;
      if (typeof auth.getRequestUser === 'function') getRequestUser = auth.getRequestUser;
    } catch { /* auth modulu yoksa yazma kapali kalir */ }
    const HOST_RE = /^[A-Z0-9._-]{1,64}$/;

    // Kabul edilen degerler (2026-09-22): listele / ekle / sil (Admin). Onbellek tazelenir.
    router.get('/nginx-audit/allowed', async (_req, res) => {
      try {
        const r = await db.query(`SELECT id, directive, value, note, created_by, created_at FROM nginx_audit_allowed_values ORDER BY directive, value`);
        res.json({ ok: true, rows: r.rows || [] });
      } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
    });
    router.put('/nginx-audit/allowed', requireAdmin, async (req, res) => {
      try {
        const directive = String(req.body?.directive || '').trim().toLowerCase();
        const value = String(req.body?.value || '').trim();
        const note = String(req.body?.note || '').trim().slice(0, 500);
        if (!/^[a-z_][a-z0-9_]*$/.test(directive)) return res.status(400).json({ ok: false, message: 'Direktif adı geçersiz (ör. client_max_body_size).' });
        if (!value || value.length > 256) return res.status(400).json({ ok: false, message: 'Değer zorunlu (en çok 256 karakter).' });
        const by = req.user?.username || req.user?.email || null;
        const ex = await db.query(`SELECT 1 FROM nginx_audit_allowed_values WHERE directive = $1 AND value = $2`, [directive, value]);
        if (!(ex.rows || []).length) await db.query(`INSERT INTO nginx_audit_allowed_values (directive, value, note, created_by) VALUES ($1, $2, $3, $4)`, [directive, value, note || null, by]);
        responseCache.clear(); nginxAuditWarm.run().catch(() => {});
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
    });
    router.delete('/nginx-audit/allowed/:id', requireAdmin, async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'id geçersiz' });
        await db.query(`DELETE FROM nginx_audit_allowed_values WHERE id = $1`, [id]);
        responseCache.clear(); nginxAuditWarm.run().catch(() => {});
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
    });

    router.put('/nginx-audit/exceptions/:host', requireAdmin, async (req, res) => {
      const host = String(req.params.host || '').trim().toUpperCase();
      const note = String(req.body?.note || '').trim().slice(0, 500);
      if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
      if (!note) return res.status(400).json({ ok: false, message: 'İstisna notu zorunlu (neden istisna?).' });
      const by = (getRequestUser(req) || {}).username || null;
      try {
        const ex = await db.query(`SELECT 1 FROM nginx_audit_exceptions WHERE host = $1`, [host]);
        if (ex.rows.length) {
          await db.query(`UPDATE nginx_audit_exceptions SET note = $2, updated_by = $3, updated_at = GETUTCDATE() WHERE host = $1`, [host, note, by]);
        } else {
          await db.query(`INSERT INTO nginx_audit_exceptions (host, note, created_by, updated_by) VALUES ($1, $2, $3, $3)`, [host, note, by]);
        }
        responseCache.clear();
        try { require('./index.cjs').auditPortal(req, 'nginx_audit_exception_set', { username: by, result: 'ok', detail: JSON.stringify({ host, note }) }); } catch { /* yoksay */ }
        res.json({ ok: true, host, note, by });
      } catch (err) {
        res.status(503).json({ ok: false, message: err.message });
      }
    });

    router.delete('/nginx-audit/exceptions/:host', requireAdmin, async (req, res) => {
      const host = String(req.params.host || '').trim().toUpperCase();
      if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
      try {
        await db.query(`DELETE FROM nginx_audit_exceptions WHERE host = $1`, [host]);
        responseCache.clear();
        try { require('./index.cjs').auditPortal(req, 'nginx_audit_exception_clear', { username: (getRequestUser(req) || {}).username, result: 'ok', detail: JSON.stringify({ host }) }); } catch { /* yoksay */ }
        res.json({ ok: true, host });
      } catch (err) {
        res.status(503).json({ ok: false, message: err.message });
      }
    });
  }

  // Tek sunucunun ayrintisi (Denetim > Nginx Audit > sunucu sayfasi).
  router.get('/nginx-audit/host/:host', async (req, res) => {
    try {
      // `query` BU HANDLER'DA TANIMSIZDI (2026-09-23): asagidaki `scanStamp(query, ...)`
      // cagrisi calisma aninda ReferenceError veriyordu — yani sunucu detay sayfasi
      // 500 donuyordu. Bu dosyadaki desen her handler'in `query`yi KENDI icinde
      // require etmesi (bkz. `/nginx-api` handler'i); burada atlanmisti.
      // `server/__tests__` altindaki "TANIMSIZ KIMLIK yok (gateVars sinifi)" bekcisi
      // bunu yakalamisti.
      const { query } = require('../inventory/mssql.cjs');
      const host = String(req.params.host || '').trim().toUpperCase();
      if (!/^[A-Z0-9._-]{1,64}$/.test(host)) {
        return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
      }
      const out = await loadNginxAudit(host);
      const found = (out.hosts || []).find((h) => h.host === host) || null;
      res.json({
        ok: true,
        schemaReady: out.schemaReady,
        filesReady: out.filesReady,
        scanDate: out.scanDate,
        scannedAt: await scanStamp(query, 'dbo.Nginx_Audit_Hosts'),
        host: found,
        reference: out.reference || [],
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Nginx audit verisi alınamadı.' });
    }
  });

  // ── 1c) PROD TASIMA: eski GBRVP* proxy_pass hedefleri yeni GBNGXP4x/5x'te dizin mi ────
  // Veri yukleme nginx-migration.cjs/loadMigration'da: ayni yukleyici "Tanim olustur"
  // dugmesinin anti-tamper kontrolunde de kullanilir (server/nginx-migration/index.cjs).
  const migrationWarm = createWarmCache({ name: 'nginx-migration', ttlMs: 10 * 60 * 1000, compute: () => {
    const { queryLong: query, sql } = require('../inventory/mssql.cjs');
    return loadMigration({ query, sql, hasProxyColumns });
  } });
  migrationWarm.warm(75000);
  router.get('/nginx-migration', async (req, res) => {
    try {
      res.json(await migrationWarm.get({ fresh: req.query.fresh === '1' }));
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Taşıma verisi alınamadı.' });
    }
  });

  // ── 2) OPENSHIFT ORTAM KAPSAMI ──────────────────────────────────────────────────────
  // "Bir uygulama hangi ortamlarda eksik" sorusu. Platform CLUSTER'dan, ortam NAMESPACE
  // SON EKINDEN gelir (nedeni: ocp-platforms.cjs basligindaki "kritik tasarim karari"
  // notu - ark_dev ile ark_test AYNI cluster'lardir, cluster ortam bilgisi TASIMAZ).
  router.get('/ocp-coverage', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const platform = String(req.query.platform || 'ark').trim();
      const clusters = PLATFORM_CLUSTERS[platform];
      if (!clusters) {
        return res.status(400).json({
          ok: false,
          message: `Bilinmeyen platform: ${platform}. Geçerli: ${Object.keys(PLATFORM_CLUSTERS).join(', ')}`,
        });
      }

      const inputs = clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(100), value: c }));
      const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
      const result = await query(
        `SELECT DISTINCT cluster, namespace, application
           FROM dbo.Openshift_Inventory
          WHERE cluster IN (${placeholders})`,
        inputs,
      );

      // application -> { env -> [{cluster, namespace}] }
      const apps = new Map();
      let skippedNoEnv = 0;
      for (const r of result.recordset || []) {
        const env = envOfNamespace(r.namespace);
        if (!env) {
          skippedNoEnv++;
          continue;
        } // altyapi/operator namespace'i - uygulama degil
        if (!apps.has(r.application))
          apps.set(r.application, { application: r.application, envs: {} });
        const e = apps.get(r.application).envs;
        if (!e[env]) e[env] = [];
        e[env].push({ cluster: r.cluster, namespace: r.namespace });
      }

      const rows = [...apps.values()]
        .map((a) => {
          const present = ENVS.filter((e) => a.envs[e]?.length);
          const missing = ENVS.filter((e) => !a.envs[e]?.length);
          return { ...a, present, missing, missingCount: missing.length };
        })
        .sort((a, b) => a.application.localeCompare(b.application));

      // ORTAM BASINA GERCEKTE KULLANILAN CLUSTER KUMESI (2026-09-10, kullanici bulgusu).
      //
      // Sorun: bir uygulama production'in 5 cluster'indan yalnizca 1'inde olsa da hucre
      // "VAR" gorunuyordu - 5'inde olanla ayirt EDILEMIYORDU. Cluster bilgisi yalnizca
      // fare ipucunda duruyordu.
      //
      // Kume TAHMIN EDILMEZ, VERIDEN CIKARILIR: platformun cluster listesi ortam ayrimi
      // TASIMAZ (bkz. ocp-platforms.cjs - ayni cluster hem dev hem test namespace'i
      // barindirabiliyor). Bu yuzden "prod cluster'lari" diye sabit bir liste yazmak
      // yanlis olurdu; bunun yerine o ortamda GERCEKTEN namespace barindiran cluster'lar
      // sayilir.
      //
      // Her cluster icin uygulama sayisi da dondurulur: bu, "n" sayisinin ne demek
      // oldugunu aciklar ve DR gibi az uygulamali cluster'lari gorunur kilar. Kismi
      // kapsam BIR HUKUM DEGIL, bir GOZLEMDIR - bazi uygulamalarin (or. DR'de) olmamasi
      // mesrudur, bu yuzden "eksik" damgasi vurulmaz.
      const { envClustersFromApps } = require('./ocp-clusters.cjs');
      const envClusterList = envClustersFromApps(apps.values(), ENVS);

      // Ozet: hangi "eksik ortam" deseni kac uygulamada goruluyor (en sik 10).
      const patternCount = new Map();
      for (const r of rows) {
        if (!r.missing.length) continue;
        const k = r.missing.join(',');
        patternCount.set(k, (patternCount.get(k) || 0) + 1);
      }
      const patterns = [...patternCount.entries()]
        .map(([k, n]) => ({ missing: k.split(','), count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.json({
        ok: true,
        platform,
        platforms: Object.keys(PLATFORM_CLUSTERS),
        clusters,
        envs: ENVS,
        totalApplications: rows.length,
        completeCount: rows.filter((r) => !r.missing.length).length,
        skippedNoEnv,
        patterns,
        envClusters: envClusterList,
        rows,
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, message: err.message || 'OpenShift kapsam verisi alınamadı.' });
    }
  });

  // ── 3) INIT SCRIPT SAPMASI ──────────────────────────────────────────────────────────
  // dbo.InitScriptsInventory (/vhosting) ve dbo.InitScriptsInventory8 (/vhosting8) -
  // check_initialize.yaml job'i doldurur; her sunucu icin her init script'inin sha512'si.
  //
  // SORU: "sunuculardaki script'ler birbirinden ne kadar farkli, kac farkli surum
  // dagitilmis?" Cevap iki yonden verilir:
  //   - SCRIPT bazli: bir script kac AYRI sha512 degeriyle duruyor (= surum sayisi),
  //     hangisi COGUNLUK, hangi host'lar sapiyor, kacinda hic YOK.
  //   - SUNUCU bazli: bir host cogunluktan kac script'te ayriliyor.
  //
  // "Cogunluk" referans kabul edilir: bu tablolarda kanonik surumu isaretleyen bir alan
  // YOK, ve initialize.yaml sablonu tum sunuculara AYNI dosyalari dagittigi icin en
  // kalabalik hash pratikte sablonun kendisidir. startCustom.sh bu kuralin BILINEN
  // istisnasidir - sunucuya ozel olmasi TASARIM GEREGI (initialize.yaml:50 onu yeniden
  // kurulumda yedekten geri kopyalar). O yuzden ayrica isaretlenir ve sapma sayimina
  // KATILMAZ; yoksa neredeyse her sunucu yanlislikla "sapkin" gorunurdu.
  const INIT_SCRIPTS = [
    { key: 'appdomain_service', label: 'appdomain.service' },
    { key: 'start_sh', label: 'start.sh' },
    { key: 'functions_sh', label: 'functions.sh' },
    { key: 'startCTG_sh', label: 'startCTG.sh' },
    { key: 'startWAS_sh', label: 'startWAS.sh' },
    { key: 'startWEB_sh', label: 'startWEB.sh' },
    { key: 'startJboss_sh', label: 'startJboss.sh' },
    { key: 'startJboss8_sh', label: 'startJboss8.sh' },
    { key: 'startNginx_sh', label: 'startNginx.sh' },
    { key: 'startIHS_sh', label: 'startIHS.sh' },
    { key: 'exceptionList_ini', label: 'exceptionList.ini' },
    { key: 'startApplicationServers_jy', label: 'startApplicationServers.jy' },
    { key: 'stopApplicationServers_jy', label: 'stopApplicationServers.jy' },
    { key: 'startCustom_sh', label: 'startCustom.sh', perServer: true },
  ];

  const INIT_TABLES = {
    vhosting: 'dbo.InitScriptsInventory',
    vhosting8: 'dbo.InitScriptsInventory8',
  };

  // -- 4) NGINX API ENVANTERI ---------------------------------------------------------
  // Kaynak: dbo.NginxRateLimitInventory (nginx_ratelimit_inventory job'i APPEND eder).
  // Bir satir = (host, config_file, api_location) + o gunku iki rate limit zone'u.
  //
  // ORTAM BILGISI TABLODA YOK ve konfigurasyon dosya adlari ortamdan bagimsiz olarak
  // AYNIDIR - ayni "x.conf" hem DEV hem PROD sunucusunda bulunur. Bu yuzden ortam
  // SUNUCU ADINDAN turetilir (bkz. nginx-hosts.cjs), dosya adindan DEGIL.
  //
  // NEDEN SQL'DE GRUPLANIYOR: satir sayisi host x config x location ile carpilir
  // (50 sunucu x 20 conf x 50 location ~ 50.000 satir). (host, config) duzeyinde
  // gruplayinca ~1.000 satira duser; ortam/konfigurasyon kirilimlari bundan turetilir.
  router.get('/nginx-api', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { summarize } = require('./nginx-api-summary.cjs');
      const scanDate = String(req.query.scanDate || '').trim();

      const dateRes = await query(
        scanDate
          ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
          : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory`,
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [],
      );
      const effectiveDate = dateRes.recordset?.[0]?.d || null;
      if (!effectiveDate) {
        // Bos yanit da DOLU yanitla AYNI sekli tasir - istemci ayri bir dal yazmasin.
        return res.json({
          ok: true, scanDate: null, availableDates: [], ...summarize([]),
        });
      }

      const [aggRes, datesRes, srvRes] = await Promise.all([
        query(
          `SELECT host, config_file,
                  COUNT(*) AS locations,
                  SUM(CASE WHEN ip_rate_limit IS NULL AND server_rate_limit IS NULL
                           THEN 1 ELSE 0 END) AS no_limit,
                  SUM(CASE WHEN ip_rate_limit IS NOT NULL THEN 1 ELSE 0 END) AS ip_limited,
                  SUM(CASE WHEN server_rate_limit IS NOT NULL THEN 1 ELSE 0 END) AS srv_limited
             FROM dbo.NginxRateLimitInventory
            WHERE scan_date = @d
            GROUP BY host, config_file`,
          [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
        ),
        query(
          `SELECT DISTINCT CONVERT(varchar(10), scan_date, 23) AS d
             FROM dbo.NginxRateLimitInventory ORDER BY d DESC`,
        ),
        // Sunucunun SERVISI (vhost dosyasi) nginx_audit'in server bloklarindan; tablo
        // yoksa ya da job kosmadiysa sutun "—" kalir, ekran calisir.
        query(
          `SELECT host, conf_file, server_name FROM dbo.Nginx_Audit_Servers
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers)`,
        ).catch(() => ({ recordset: [] })),
      ]);

      // Toplama mantigi SAF ve AYRI: DB olmadan test edilebilsin diye
      // (bkz. __tests__/nginx-api-summary.test.cjs).
      const summary = summarize(aggRes.recordset || [], srvRes.recordset || []);
      res.json({
        ok: true,
        scanDate: effectiveDate,
        scannedAt: await scanStamp(query, 'dbo.NginxRateLimitInventory'),
        availableDates: (datesRes.recordset || []).map((r) => r.d),
        ...summary,
      });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- PROXY (PRODUCTION) TANIMLARI ---------------------------------------------------
  // Production nginx SPA include deseni KULLANMAZ; tanimlar proxy_pass/upstream
  // seklindedir. Denetim uzun sure yalniz include desenini kaydettigi icin PROD ortami
  // BOS gorunuyordu (sunucular taraniyordu - tarayici deseni tanimiyordu).
  //
  // SPA'ya ozgu alanlar (include, deploy_mode, app_deployed) burada NULL'dur; sahte
  // deger yazmak toplamlara sizip metrikleri yanlis gosterirdi.
  router.get('/nginx-proxy', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');

      if (!(await hasProxyColumns())) {
        // Sema hazir degil: BOS liste degil, NEDENINI soyleyen bir yanit doner -
        // "hic tanim yok" ile "henuz olculemiyor" karistirilmamalidir.
        return res.json({
          ok: true, schemaReady: false, scanDate: null, envs: [], services: [],
          totals: { rows: 0, vhosts: 0, hosts: 0, nonProdTarget: 0, undefinedUpstream: 0 },
          rows: [],
        });
      }

      const scanDate = String(req.query.scanDate || '').trim();
      const dateRes = await query(
        scanDate
          ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
          : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d
               FROM dbo.Nginx_Config_Audit WHERE kind = 'proxy'`,
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [],
      );
      const effectiveDate = dateRes.recordset?.[0]?.d || null;
      if (!effectiveDate) {
        return res.json({
          ok: true, schemaReady: true, scanDate: null, envs: [], services: [],
          totals: { rows: 0, vhosts: 0, hosts: 0, nonProdTarget: 0, undefinedUpstream: 0 },
          rows: [],
        });
      }

      const r = await query(
        `SELECT service, env, host, vhost, location_path, upstream_name, target_url,
                upstream_defined, in_ocp_inventory, status
           FROM dbo.Nginx_Config_Audit
          WHERE scan_date = @d AND kind = 'proxy'
          ORDER BY env, service, vhost, location_path, host`,
        [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
      );

      // Ayni tanim prod'da 4-8 sunucuda AYNADIR; location bazinda tekillestirilir,
      // hangi sunucularda goruldugu ayrica tasinir ki eksik sunucu farkedilebilsin.
      const map = new Map();
      for (const x of r.recordset || []) {
        const key = `${x.vhost}||${x.location_path}||${x.target_url || ''}`;
        if (!map.has(key)) {
          map.set(key, {
            service: x.service, env: String(x.env || '').trim().toUpperCase(),
            vhost: x.vhost, locationPath: x.location_path,
            upstreamName: x.upstream_name, targetUrl: x.target_url,
            upstreamDefined: x.upstream_defined === 1 || x.upstream_defined === true,
            inOcpInventory: x.in_ocp_inventory === 1 || x.in_ocp_inventory === true,
            status: x.status, hosts: [],
          });
        }
        map.get(key).hosts.push(x.host);
      }
      const rows = [...map.values()].map((v) => ({ ...v, hosts: v.hosts.sort() }));

      res.json({
        ok: true,
        schemaReady: true,
        scanDate: effectiveDate,
        scannedAt: await scanStamp(query, 'dbo.NginxRateLimitInventory'),
        envs: [...new Set(rows.map((x) => x.env))].sort(),
        services: [...new Set(rows.map((x) => x.service))].filter(Boolean).sort(),
        totals: {
          rows: rows.length,
          vhosts: new Set(rows.map((x) => x.vhost)).size,
          hosts: new Set((r.recordset || []).map((x) => x.host)).size,
          nonProdTarget: rows.filter((x) => x.status === 'NON_PROD_TARGET').length,
          undefinedUpstream: rows.filter((x) => !x.upstreamDefined).length,
        },
        rows,
      });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- API (LOCATION) BAZINDA KIRILIM --------------------------------------------------
  // "Su API hangi ortamda, hangi sunucularda var?" sorusu. /nginx-api konfigurasyon
  // duzeyinde ozetliyor; burasi TEK TEK location'lara iner.
  //
  // Ham satirlar burada gruplaniyor (SQL'de degil) cunku ORTAM sunucu adindan turer -
  // esleme JS'te. Istemciye giden yuk yine kucuk: (config x location) duzeyinde ~binler,
  // host listeleri satirin icinde. Ayni desen /nginx-spa ucunda da kullaniliyor.
  router.get('/nginx-api-locations', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { summarizeLocations } = require('./nginx-api-locations.cjs');
      const scanDate = String(req.query.scanDate || '').trim();

      const dateRes = await query(
        scanDate
          ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
          : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory`,
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [],
      );
      const effectiveDate = dateRes.recordset?.[0]?.d || null;
      if (!effectiveDate) {
        return res.json({ ok: true, scanDate: null, envs: [], rows: [] });
      }

      const r = await query(
        `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = @d`,
        [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
      );

      const { envs, rows, scannedHosts } = summarizeLocations(r.recordset || []);
      res.json({ ok: true, scanDate: effectiveDate, envs, rows, scannedHosts });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- NGINX ENVANTERI ----------------------------------------------------------------
  // Kaynak: dbo.nginx_inventory (bmw_nginx/nginx_metadata job'i doldurur).
  // Her sunucuda .metadata dosyasi uretilip toplanir; tablo her kosuda TRUNCATE edilip
  // yeniden yazilir - yani GECMIS YOK, tablo her zaman "su anki hal".
  //
  // Bu tabloda ORTAM KOLONU VAR (`env`); NginxRateLimitInventory'den farkli olarak
  // sunucu adindan turetmeye gerek yok.
  router.get('/nginx-inventory', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const { summarizeNginxInventory } = require('./nginx-inventory-summary.cjs');

      const r = await query(
        `SELECT metadata_version, hostname, fqdn, env, location, service, services,
                service_count, domain, ip, subnet, os, kernel, architecture, cpu,
                memory, nginx_version, nginx_user, nginx_prefix, config_count,
                disk_usr_nginx, disk_web_log, source_last_update
           FROM dbo.nginx_inventory
          ORDER BY env, location, hostname`,
      );

      const rows = r.recordset || [];
      // En yeni source_last_update, verinin ne kadar taze oldugunu soyler. Tabloda
      // scan_date YOK (TRUNCATE+yeniden yazim), bu yuzden tazelik gostergesi budur.
      const lastUpdate = rows
        .map((x) => x.source_last_update)
        .filter(Boolean)
        .sort()
        .pop() || null;

      res.json({
        ok: true,
        lastUpdate: lastUpdate ? String(lastUpdate) : null,
        // hosts: ozetleyicinin DUZELTILMIS env tasiyan satirlari (ham tablo satirlari degil)
        ...summarizeNginxInventory(rows),
      });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // Ortak hesap (Init Script + Deployment Scripts, 2026-09-18): raw = [{host, <key>: sha}],
  // scripts = [{key,label,perServer?}] -> script bazli surum dagilimi + sunucu bazli sapma.
  /**
   * GENEL ENVANTER DISI SUNUCULAR (kullanici, 2026-09-24): GBEVM* ve GBPRV* filo
   * cogunlugunu bozuyor. Cogunluk YALNIZCA genel envanterden hesaplanir; bu sunucular
   * ayni cogunluga gore degerlendirilip AYRI raporlanir. Server Hub'da da ayni ayrim var
   * (server/server-hub/assess.cjs SPECIAL_HOST_RE) - iki ekran ayni olcutu kullansin.
   */
  const SPECIAL_HOST_RE = /^(GBEVM|GBPRV)/i;
  const isSpecialHost = (h) => SPECIAL_HOST_RE.test(String(h || '').trim());

  /**
   * @param {object[]} raw satirlar
   * @param {object[]} scripts script tanimlari
   * @param {Map<string,string>} [majorityOverride] cogunluk disaridan verilirse (ozel
   *   sunucular GENEL envanterin cogunluguna gore olculur; kendi aralarinda degil)
   */
  function scriptDeviationReport(raw, scripts, majorityOverride) {
    const hostCount = raw.length;
    const scriptStats = scripts.map((sc) => {
      const byHash = new Map();
      const absent = [];
      for (const r of raw) {
        const host = String(r.host).trim();
        const h = r[sc.key] ? String(r[sc.key]).trim() : '';
        if (!h) {
          absent.push(host);
          continue;
        }
        if (!byHash.has(h)) byHash.set(h, []);
        byHash.get(h).push(host);
      }
      const variants = [...byHash.entries()]
        .map(([hash, hosts]) => ({ hash, count: hosts.length, hosts: hosts.sort() }))
        .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));
      const majority = variants[0] || null;
      return {
        key: sc.key,
        label: sc.label,
        perServer: !!sc.perServer,
        present: hostCount - absent.length,
        missing: absent.length,
        missingHosts: absent.sort(),
        variantCount: variants.length,
        majorityHash: majority ? majority.hash : null,
        majorityCount: majority ? majority.count : 0,
        deviatingCount: majority ? variants.slice(1).reduce((a, v) => a + v.count, 0) : 0,
        variants,
      };
    });
    const majorityOf = majorityOverride || new Map(scriptStats.map((sc) => [sc.key, sc.majorityHash]));
    const hostRows = raw.map((r) => {
      const deviations = [];
      const missing = [];
      let customHash = null;
      for (const sc of scripts) {
        const val = r[sc.key] ? String(r[sc.key]).trim() : '';
        if (sc.perServer) {
          customHash = val || null;
          continue;
        }
        if (!val) {
          missing.push(sc.label);
          continue;
        }
        const maj = majorityOf.get(sc.key);
        if (maj && val !== maj) deviations.push(sc.label);
      }
      return {
        host: String(r.host).trim(),
        deviations,
        deviationCount: deviations.length,
        missing,
        missingCount: missing.length,
        hasCustom: !!customHash,
        customHash,
      };
    });
    return { scriptStats, hostRows };
  }

  function scriptReportSummary(scripts, scriptStats, hostRows) {
    return {
      hosts: hostRows.length,
      scriptCount: scripts.length,
      // "tam uyumlu" = perServer disindaki HER script'te cogunlukla ayni hash, hicbiri eksik degil
      identicalHosts: hostRows.filter((r) => r.deviationCount === 0 && r.missingCount === 0).length,
      totalVariants: scriptStats.filter((sc) => !sc.perServer).reduce((a, sc) => a + sc.variantCount, 0),
      customHosts: hostRows.filter((r) => r.hasCustom).length,
      scripts: scriptStats,
      hostRows,
    };
  }

  // ── 3b) DEPLOYMENT SCRIPT SAPMASI (2026-09-18) ──────────────────────────────────────
  // dbo.DeployScriptsInventory - bmw_wds_scripts/deployment_scripts/check_deployment_scripts.yaml
  // doldurur: /vhosting/HYSUXSCRIPTS/*.sh ve /vhosting8/HYSUXSCRIPTS/*.sh icin (host, root,
  // script, sha512, size, mtime). Init'ten farki: tablo UZUN bicimde (script basina satir),
  // script listesi sabit degil - hangi dosya varsa o gelir (vhosting8'de was_checkapp.sh,
  // was_enable_hc.sh gibi ekler var). Yanit sekli Init ile AYNI ki ekran ortak.
  const DEPLOY_TABLE = 'dbo.DeployScriptsInventory';
  const DEPLOY_ROOTS = ['vhosting', 'vhosting8'];

  router.get('/deploy-scripts', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const rootParam = String(req.query.root || 'vhosting');
      const root = DEPLOY_ROOTS.includes(rootParam) ? rootParam : 'vhosting';
      const empty = (message) => ({
        ok: true, root, roots: DEPLOY_ROOTS, scanDate: null, missingColumns: [], message,
        hosts: 0, scriptCount: 0, identicalHosts: 0, totalVariants: 0, customHosts: 0, scripts: [], hostRows: [],
      });
      const ex = await query(`SELECT OBJECT_ID('${DEPLOY_TABLE}') AS oid`);
      if (!ex.recordset?.[0]?.oid) {
        return res.json(empty('dbo.DeployScriptsInventory tablosu henüz yok — check_deployment_scripts job\'ı bir kez koşmalı.'));
      }
      const rowsRes = await query(
        `SELECT host, script, sha512, scan_date FROM ${DEPLOY_TABLE} WHERE root = @root ORDER BY host, script`,
        [{ name: 'root', type: sql.NVarChar, value: root }],
      );
      const rows = rowsRes.recordset || [];
      if (!rows.length) return res.json(empty(`/${root} için kayıt yok.`));
      // Uzun tablo -> Init ile ayni "host basina satir" sekli; script listesi VERIDEN.
      const names = [...new Set(rows.map((r) => String(r.script || '').trim()).filter(Boolean))].sort();
      const scripts = names.map((n) => ({ key: n, label: n }));
      const byHost = new Map();
      let scanDate = null;
      for (const r of rows) {
        const host = String(r.host || '').trim();
        if (!host) continue;
        if (!byHost.has(host)) byHost.set(host, { host });
        byHost.get(host)[String(r.script).trim()] = r.sha512 ? String(r.sha512).trim() : '';
        if (r.scan_date && (!scanDate || r.scan_date > scanDate)) scanDate = r.scan_date;
      }
      const raw = [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
      // Init ile AYNI ayrim (kullanici, 2026-09-24): cogunluk genel envanterden, GBEVM*/GBPRV*
      // ayni cogunluga gore olculup ayri blokta.
      const genelRaw = raw.filter((r) => !isSpecialHost(r.host));
      const ozelRaw = raw.filter((r) => isSpecialHost(r.host));
      const { scriptStats, hostRows } = scriptDeviationReport(genelRaw, scripts);
      let special = null;
      if (ozelRaw.length) {
        const majorityOf = new Map(scriptStats.map((sc) => [sc.key, sc.majorityHash]));
        const ozel = scriptDeviationReport(ozelRaw, scripts, majorityOf);
        special = scriptReportSummary(scripts, ozel.scriptStats, ozel.hostRows);
      }
      res.json({
        ok: true,
        root,
        roots: DEPLOY_ROOTS,
        scanDate: scanDate ? new Date(scanDate).toISOString().slice(0, 10) : null,
        missingColumns: [],
        ...scriptReportSummary(scripts, scriptStats, hostRows),
        special,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Deployment script denetim verisi alinamadi.' });
    }
  });

  // ── 3c) ROUTE TRAFIGI (2026-09-21) ───────────────────────────────────────────────────
  // dbo.BMW_Openshift_Route_Traffic - bmw_openshift_jobs/route_traffic/openshift_route_traffic.yml
  // doldurur (Thanos, route basina gunluk istek). Envanterle birlestirme + siniflama
  // route-traffic.cjs'te (birim testli). Son DEAD_DAYS gun okunur; tablo yoksa bos yanit.
  router.get('/route-traffic', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const { buildRouteTraffic, DEAD_DAYS } = require('./route-traffic.cjs');
      const ex = await query(`SELECT OBJECT_ID('dbo.BMW_Openshift_Route_Traffic') AS oid`);
      if (!ex.recordset?.[0]?.oid) {
        return res.json({
          ok: true, tableMissing: true,
          message: 'dbo.BMW_Openshift_Route_Traffic tablosu henüz yok — route_traffic job\'ı bir kez koşmalı.',
          rows: [], summary: { routes: 0, active: 0, silent: 0, dead: 0, nodata: 0, spa: 0, spaDead: 0 },
          latestScan: null, earliestScan: null, daysCovered: 0, silentDays: 30, deadDays: DEAD_DAYS,
        });
      }
      const [traffic, inventory] = await Promise.all([
        query(
          `SELECT scan_date, window_hours, cluster, namespace, route, req_total, r2xx, r4xx, r5xx
             FROM dbo.BMW_Openshift_Route_Traffic
            WHERE scan_date >= DATEADD(day, -${DEAD_DAYS}, CAST(GETDATE() AS DATE))`,
        ),
        query(`SELECT cluster_name, namespace_name, route_name, route_address FROM dbo.BMW_Openshift_Route_Inventory`)
          .catch(() => ({ recordset: [] })),
      ]);
      res.json({ ok: true, tableMissing: false, ...buildRouteTraffic(traffic.recordset || [], inventory.recordset || []) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Route trafiği verisi alınamadı.' });
    }
  });

  router.get('/init-scripts', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const rootParam = String(req.query.root || 'vhosting');
      const root = INIT_TABLES[rootParam] ? rootParam : 'vhosting';
      const table = INIT_TABLES[root];

      // startCustom_sh sutununu ansible loader sonradan ekliyor; job henuz kosmadiysa
      // sutun YOKTUR ve sabit bir SELECT patlar. O yuzden once semaya bakilir ve SELECT
      // yalnizca var olan sutunlardan kurulur. Sutun adlari INIT_SCRIPTS'teki SABIT
      // liste ile kesistirilir - disaridan gelen hicbir metin SQL'e girmez.
      const colRes = await query(
        `SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('${table}')`,
      );
      const have = new Set((colRes.recordset || []).map((r) => String(r.name)));
      const scripts = INIT_SCRIPTS.filter((sc) => have.has(sc.key));
      const missingColumns = INIT_SCRIPTS.filter((sc) => !have.has(sc.key)).map((sc) => sc.label);

      if (!have.has('host') || scripts.length === 0) {
        return res.json({
          ok: true,
          root,
          roots: Object.keys(INIT_TABLES),
          hosts: 0,
          scriptCount: 0,
          identicalHosts: 0,
          totalVariants: 0,
          customHosts: 0,
          missingColumns,
          scripts: [],
          hostRows: [],
        });
      }

      const rowsRes = await query(
        `SELECT host, ${scripts.map((sc) => sc.key).join(', ')} FROM ${table} ORDER BY host`,
      );
      const raw = (rowsRes.recordset || []).filter((r) => String(r.host || '').trim());

      // Cogunluk GENEL envanterden; GBEVM*/GBPRV* ayni cogunluga gore olculup ayri raporlanir.
      const genelRaw = raw.filter((r) => !isSpecialHost(r.host));
      const ozelRaw = raw.filter((r) => isSpecialHost(r.host));
      const { scriptStats, hostRows } = scriptDeviationReport(genelRaw, scripts);
      let special = null;
      if (ozelRaw.length) {
        const majorityOf = new Map(scriptStats.map((sc) => [sc.key, sc.majorityHash]));
        const ozel = scriptDeviationReport(ozelRaw, scripts, majorityOf);
        special = scriptReportSummary(scripts, ozel.scriptStats, ozel.hostRows);
      }
      res.json({
        ok: true,
        root,
        roots: Object.keys(INIT_TABLES),
        missingColumns,
        ...scriptReportSummary(scripts, scriptStats, hostRows),
        special,
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, message: err.message || 'Init script denetim verisi alinamadi.' });
    }
  });

  // ── 4) ENVANTER METRIKLERI ──────────────────────────────────────────────────────────
  // dbo.Inventory / dbo.MWAppsInventory / dbo.WASAppsInventory uzerinden dagilim ve
  // capraz tablo uclari. Ayri dosyada: beyaz liste + SQL kurulumu hatiri sayilir
  // yer tutuyor ve bu dosyanin konusuyla karismasin.
  require('./envanter-metrics.cjs').registerEnvanterMetrics(router);

  // ── 5) UYGULAMA ORTAMLARI (MWApps/WASApps ad kuraliyla ortam matrisi) ──────────────
  require('./app-envs.cjs').registerAppEnvs(router);

  // ── 6) WEB-APP ILISKISI (uygulama <-> onundeki web sunucusu/vhost) ────────────────
  require('./web-app.cjs').registerWebApp(router);

  // ── 7) NGINX LOCATION DETAYI (servis/ortam bazinda location + namespace/app) ──────
  require('./nginx-locations.cjs').registerNginxLocations(router);

  app.use('/api/denetim', router);
  console.log('[Denetim] module mounted at /api/denetim');
}

module.exports = { initDenetim };
