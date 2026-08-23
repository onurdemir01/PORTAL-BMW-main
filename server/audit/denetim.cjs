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

function initDenetim(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));
  router.use(requireAuth);

  // Sayfa gizliyse gercek 403 (diger modullerle AYNI desen).
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('Denetim'));
  } catch { /* motor yoksa yoksay */ }

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
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : []
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
            WHERE scan_date = @d`,
          [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }]
        ),
        query(
          `SELECT DISTINCT TOP 30 CONVERT(varchar(10), scan_date, 23) AS d
             FROM dbo.Nginx_Config_Audit ORDER BY d DESC`
        ),
      ]);

      const raw = rowsRes.recordset || [];

      // ENV LISTESI VERIDEN TURETILIR. Kanonik dortlu her zaman gosterilir (bir ortam
      // hic taranmadiysa "bos" olarak GORUNMESI gerekir, sessizce kaybolmasi degil);
      // veride gecen baska jetonlar da eklenir, yoksa o satirlar hicbir sutuna dusmez.
      const CANON = ['DEV', 'TEST', 'QA', 'PROD'];
      const seenEnvs = new Set();
      for (const r of raw) {
        const e = String(r.env || '').trim().toUpperCase();
        seenEnvs.add(e || '(bos)');
      }
      const envList = [...CANON, ...[...seenEnvs].filter((e) => !CANON.includes(e)).sort()];

      // Teshis: her env jetonu icin kac satir, hangi host'lar, hangi vhost dosyalari.
      // "PROD nicin bos" gibi sorular bu tabloya bakilarak cevaplanir.
      const statMap = new Map();
      for (const r of raw) {
        const e = String(r.env || '').trim().toUpperCase() || '(bos)';
        if (!statMap.has(e)) statMap.set(e, { env: e, rows: 0, hosts: new Set(), vhosts: new Set() });
        const st = statMap.get(e);
        st.rows++;
        if (r.host) st.hosts.add(String(r.host));
        if (r.vhost) st.vhosts.add(String(r.vhost));
      }
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
      const SEVERITY = { OK: 0, DUP_SUFFIX: 1, NOT_IN_INVENTORY: 2, NAME_MISMATCH: 3, NOT_DEPLOYED: 4, BROKEN_INCLUDE: 5 };
      const map = new Map();
      for (const r of raw) {
        const service = r.service || '(bilinmiyor)';
        const application = r.application || r.include_name || '(bilinmiyor)';
        const env = String(r.env || '').toUpperCase();
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
        (a, b) => a.service.localeCompare(b.service) || a.application.localeCompare(b.application)
      );
      const services = [...new Set(rows.map((r) => r.service))].sort();

      res.json({
        ok: true,
        scanDate: effectiveDate,
        availableDates: (datesRes.recordset || []).map((x) => x.d),
        services,
        envs: envList,
        envStats,
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Nginx denetim verisi alınamadı.' });
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
  router.get('/nginx-spa-coverage', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const platform = PLATFORM_CLUSTERS[String(req.query.platform || 'ark')] ? String(req.query.platform) : 'ark';
      const clusters = PLATFORM_CLUSTERS[platform];

      const dateRes = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`
      );
      const scanDate = dateRes.recordset?.[0]?.d || null;

      const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
      const [ocpRes, ngxRes] = await Promise.all([
        query(
          `SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory
            WHERE cluster IN (${placeholders})`,
          clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(200), value: c }))
        ),
        scanDate
          ? query(
              `SELECT DISTINCT env, application FROM dbo.Nginx_Config_Audit WHERE scan_date = @d`,
              [{ name: 'd', type: sql.NVarChar(10), value: scanDate }]
            )
          : Promise.resolve({ recordset: [] }),
      ]);

      // env -> uygulama kumeleri. Karsilastirma kucuk harf uzerinden yapilir; iki kaynak
      // ayri job'lar tarafindan yaziliyor ve buyuk/kucuk harf tutarliligi GARANTI DEGIL.
      const ocp = new Map();
      let ocpNoEnv = 0;
      for (const r of ocpRes.recordset || []) {
        const e = envOfNamespace(r.namespace);
        const app = String(r.application || '').trim();
        if (!app) continue;
        if (!e) { ocpNoEnv++; continue; }
        const k = e.toUpperCase();
        if (!ocp.has(k)) ocp.set(k, new Map());
        ocp.get(k).set(app.toLowerCase(), app);
      }

      const ngx = new Map();
      for (const r of ngxRes.recordset || []) {
        const e = String(r.env || '').trim().toUpperCase();
        const app = String(r.application || '').trim();
        if (!app || !e) continue;
        if (!ngx.has(e)) ngx.set(e, new Map());
        ngx.get(e).set(app.toLowerCase(), app);
      }

      const ENV_LIST = [...new Set([...ENVS.map((e) => e.toUpperCase()), ...ocp.keys(), ...ngx.keys()])];
      const CAP = 300;   // listeler ekrani bogmasin; sayilar HER ZAMAN tam
      const rows = ENV_LIST.map((e) => {
        const o = ocp.get(e) || new Map();
        const n = ngx.get(e) || new Map();
        const both = [], onlyOcp = [], onlyNgx = [];
        for (const [k, v] of o) (n.has(k) ? both : onlyOcp).push(v);
        for (const [k, v] of n) if (!o.has(k)) onlyNgx.push(v);
        const sortTr = (a, b) => a.localeCompare(b, 'tr');
        // OLCULEBILIRLIK: nginx tarafinda o ortama ait HIC satir yoksa kapsam
        // HESAPLANMAZ. Aksi halde "%0 kapsam, N uygulama tanimsiz" gibi felaket gorunumlu
        // ama YANLIS bir sonuc cikar. Gercek sebep genellikle olcum bosluguydu:
        // nginx_config_scan.sh yalnizca "location { include application-confs/X.conf; }"
        // kalibini kaydeder; proxy_pass mimarisindeki sunucularda boyle bir satir YOKTUR,
        // dolayisiyla o ortam hic olculmemis olur - "tanimsiz" degil, "bilinmiyor".
        const measured = n.size > 0;
        return {
          env: e,
          measured,
          ocpTotal: o.size,
          nginxTotal: n.size,
          bothCount: both.length,
          onlyOcpCount: onlyOcp.length,
          onlyNginxCount: onlyNgx.length,
          coverage: measured && o.size ? Math.round((both.length / o.size) * 1000) / 10 : null,
          onlyOcp: onlyOcp.sort(sortTr).slice(0, CAP),
          onlyNginx: onlyNgx.sort(sortTr).slice(0, CAP),
          truncated: onlyOcp.length > CAP || onlyNgx.length > CAP,
        };
      }).filter((r) => r.ocpTotal || r.nginxTotal);

      res.json({
        ok: true,
        platform,
        platforms: Object.keys(PLATFORM_CLUSTERS),
        clusters,
        scanDate,
        // Namespace son eki -dev/-test/-qa/-prod'a uymayan kayitlar hicbir ortama
        // atanamaz; sayilari gizlemek yerine ACIKCA raporlanir.
        ocpSkippedNoEnv: ocpNoEnv,
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'SPA kapsam verisi alınamadı.' });
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
        inputs
      );

      // application -> { env -> [{cluster, namespace}] }
      const apps = new Map();
      let skippedNoEnv = 0;
      for (const r of result.recordset || []) {
        const env = envOfNamespace(r.namespace);
        if (!env) { skippedNoEnv++; continue; }   // altyapi/operator namespace'i - uygulama degil
        if (!apps.has(r.application)) apps.set(r.application, { application: r.application, envs: {} });
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

      // Ozet: hangi "eksik ortam" deseni kac uygulamada gorulüyor (en sik 10).
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
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'OpenShift kapsam verisi alınamadı.' });
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
    { key: 'appdomain_service',          label: 'appdomain.service' },
    { key: 'start_sh',                   label: 'start.sh' },
    { key: 'functions_sh',               label: 'functions.sh' },
    { key: 'startCTG_sh',                label: 'startCTG.sh' },
    { key: 'startWAS_sh',                label: 'startWAS.sh' },
    { key: 'startWEB_sh',                label: 'startWEB.sh' },
    { key: 'startJboss_sh',              label: 'startJboss.sh' },
    { key: 'startJboss8_sh',             label: 'startJboss8.sh' },
    { key: 'startNginx_sh',              label: 'startNginx.sh' },
    { key: 'startIHS_sh',                label: 'startIHS.sh' },
    { key: 'exceptionList_ini',          label: 'exceptionList.ini' },
    { key: 'startApplicationServers_jy', label: 'startApplicationServers.jy' },
    { key: 'stopApplicationServers_jy',  label: 'stopApplicationServers.jy' },
    { key: 'startCustom_sh',             label: 'startCustom.sh', perServer: true },
  ];

  const INIT_TABLES = {
    vhosting:  'dbo.InitScriptsInventory',
    vhosting8: 'dbo.InitScriptsInventory8',
  };

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
        `SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('${table}')`
      );
      const have = new Set((colRes.recordset || []).map((r) => String(r.name)));
      const scripts = INIT_SCRIPTS.filter((sc) => have.has(sc.key));
      const missingColumns = INIT_SCRIPTS.filter((sc) => !have.has(sc.key)).map((sc) => sc.label);

      if (!have.has('host') || scripts.length === 0) {
        return res.json({
          ok: true, root, roots: Object.keys(INIT_TABLES), hosts: 0, scriptCount: 0,
          identicalHosts: 0, totalVariants: 0, customHosts: 0,
          missingColumns, scripts: [], hostRows: [],
        });
      }

      const rowsRes = await query(
        `SELECT host, ${scripts.map((sc) => sc.key).join(', ')} FROM ${table} ORDER BY host`
      );
      const raw = (rowsRes.recordset || []).filter((r) => String(r.host || '').trim());
      const hostCount = raw.length;

      // ── Script bazli surum dagilimi ──
      const scriptStats = scripts.map((sc) => {
        const byHash = new Map();
        const absent = [];
        for (const r of raw) {
          const host = String(r.host).trim();
          const h = r[sc.key] ? String(r[sc.key]).trim() : '';
          if (!h) { absent.push(host); continue; }
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

      // ── Sunucu bazli sapma ──
      const majorityOf = new Map(scriptStats.map((sc) => [sc.key, sc.majorityHash]));
      const hostRows = raw.map((r) => {
        const deviations = [];
        const missing = [];
        let customHash = null;
        for (const sc of scripts) {
          const val = r[sc.key] ? String(r[sc.key]).trim() : '';
          if (sc.perServer) { customHash = val || null; continue; }
          if (!val) { missing.push(sc.label); continue; }
          const maj = majorityOf.get(sc.key);
          if (maj && val !== maj) deviations.push(sc.label);
        }
        return {
          host: String(r.host).trim(),
          deviations, deviationCount: deviations.length,
          missing, missingCount: missing.length,
          hasCustom: !!customHash, customHash,
        };
      });

      res.json({
        ok: true,
        root,
        roots: Object.keys(INIT_TABLES),
        hosts: hostCount,
        scriptCount: scripts.length,
        // "tam uyumlu" = perServer disindaki HER script'te cogunlukla ayni hash, hicbiri eksik degil
        identicalHosts: hostRows.filter((r) => r.deviationCount === 0 && r.missingCount === 0).length,
        totalVariants: scriptStats.filter((sc) => !sc.perServer).reduce((a, sc) => a + sc.variantCount, 0),
        customHosts: hostRows.filter((r) => r.hasCustom).length,
        missingColumns,
        scripts: scriptStats,
        hostRows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Init script denetim verisi alinamadi.' });
    }
  });

  // ── 4) ENVANTER METRIKLERI ──────────────────────────────────────────────────────────
  // dbo.Inventory / dbo.MWAppsInventory / dbo.WASAppsInventory uzerinden dagilim ve
  // capraz tablo uclari. Ayri dosyada: beyaz liste + SQL kurulumu hatiri sayilir
  // yer tutuyor ve bu dosyanin konusuyla karismasin.
  require('./envanter-metrics.cjs').registerEnvanterMetrics(router);

  app.use('/api/denetim', router);
  console.log('[Denetim] module mounted at /api/denetim');
}

module.exports = { initDenetim };
