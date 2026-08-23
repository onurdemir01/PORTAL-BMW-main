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
  // SPA TANIMI (kullanici tarafindan verildi): uygulama adinda "-app-v" ya da
  // "-app-emb-v" GECIYORSA o uygulama bir SPA'dir. Ad kalibina bakmak zorundayiz cunku
  // dbo.Openshift_Inventory yalnizca cluster/namespace/application tutuyor - SPA olup
  // olmadigini soyleyen bir sutun YOK.
  // ICERIR (contains) kontrolu, "ile biter" DEGIL: kural boyle verildi ve ornegin
  // "...-app-emb-v0" gibi adlarda surum sonekinden sonra baska bir sey de gelebilir.
  const SPA_RE = /-app(-emb)?-v/i;
  const SPA_LABEL = '-app-v / -app-emb-v';

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
      const clusterParams = () => clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(200), value: c }));

      const [ocpRes, ngxRes, routeRes] = await Promise.all([
        query(
          `SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory
            WHERE cluster IN (${placeholders})`,
          clusterParams()
        ),
        scanDate
          ? query(
              `SELECT DISTINCT env, application FROM dbo.Nginx_Config_Audit WHERE scan_date = @d`,
              [{ name: 'd', type: sql.NVarChar(10), value: scanDate }]
            )
          : Promise.resolve({ recordset: [] }),
        // Route tipi = uygulamanin AGI. Iki tablo da cluster/namespace adlarini AYNI
        // kaynaktan (global_variables cluster tanimlari + `oc projects`) uretiyor, bu
        // yuzden bu iki alan uzerinden birlestirmek guvenli.
        query(
          `SELECT DISTINCT namespace_name, route_name, route_address, termination_type
             FROM dbo.BMW_Openshift_Route_Inventory
            WHERE cluster_name IN (${placeholders})`,
          clusterParams()
        ).catch(() => ({ recordset: [], _missing: true })),
      ]);

      const routeTableMissing = !!routeRes._missing;

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
        const label = String(addr || '').trim().toLowerCase().split('.')[0];
        if (!label || !nsLower) return null;
        const suf = '-' + nsLower;
        return label.endsWith(suf) ? label.slice(0, -suf.length) : null;
      }

      const routeByApp = new Map();   // "<ns> <app>"   -> tip  (adresten cozuldu)
      const routeByName = new Map();  // "<ns> <route>" -> tip  (route adiyla)
      const routeByNs = new Map();    // "<ns>"         -> o namespace'teki TUM tipler
      for (const r of routeRes.recordset || []) {
        const ns = String(r.namespace_name || '').trim().toLowerCase();
        const rt = String(r.route_name || '').trim().toLowerCase();
        const tt = String(r.termination_type || '').trim().toLowerCase() || 'yok';
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
        if (byAddr) { matchStats.address++; return { type: byAddr, how: 'address' }; }
        const byName = routeByName.get(nsLower + ' ' + appLower);
        if (byName) { matchStats.name++; return { type: byName, how: 'name' }; }
        const set = routeByNs.get(nsLower);
        if (set && set.size === 1) { matchStats.ns++; return { type: [...set][0], how: 'ns' }; }
        if (set && set.size > 1) { matchStats.conflict++; return { type: null, how: 'conflict' }; }
        matchStats.none++;
        return { type: null, how: 'none' };
      }

      // ── OpenShift tarafi: SPA suzgeci + ag siniflandirmasi ────────────────────────
      const ocpNonSpa = new Set();
      let ocpNoEnv = 0;
      // env -> { app -> { name, net } }   net: 'internet' | 'intranet' | 'diger' | 'bilinmiyor'
      const ocp = new Map();
      for (const r of ocpRes.recordset || []) {
        const app = String(r.application || '').trim();
        if (!app) continue;
        if (!SPA_RE.test(app)) { ocpNonSpa.add(app.toLowerCase()); continue; }
        const e = envOfNamespace(r.namespace);
        if (!e) { ocpNoEnv++; continue; }
        const env = e.toUpperCase();
        const nsLower = String(r.namespace || '').trim().toLowerCase();
        const { type } = terminationOf(nsLower, app.toLowerCase());
        // Kullanicinin verdigi kural: passthrough -> internet (nginx'e cikabilir),
        // reencrypt -> intranet (nginx'e CIKAMAZ). Diger tipler (edge, tls yok)
        // bu kuralin disinda; "diger" olarak ayri tutulur, tahmin edilmez.
        const net = type === 'passthrough' ? 'internet'
                  : type === 'reencrypt' ? 'intranet'
                  : type ? 'diger' : 'bilinmiyor';
        if (!ocp.has(env)) ocp.set(env, new Map());
        const k = app.toLowerCase();
        const prev = ocp.get(env).get(k);
        // Ayni uygulama birden fazla namespace'te olabilir; internet bilgisi baskindir
        // (bir yerde bile internete acilliyorsa nginx'e cikabilir demektir).
        if (!prev || (prev.net !== 'internet' && net === 'internet')) {
          ocp.get(env).set(k, { name: app, net });
        }
      }

      // ── nginx tarafi ──────────────────────────────────────────────────────────────
      const ngxNonSpa = new Set();
      const ngx = new Map();
      for (const r of ngxRes.recordset || []) {
        const e = String(r.env || '').trim().toUpperCase();
        const app = String(r.application || '').trim();
        if (!app || !e) continue;
        if (!SPA_RE.test(app)) { ngxNonSpa.add(app); continue; }
        if (!ngx.has(e)) ngx.set(e, new Map());
        ngx.get(e).set(app.toLowerCase(), app);
      }
      const nginxOutsidePattern = [...ngxNonSpa].sort((a, b) => a.localeCompare(b, 'tr')).slice(0, 40);

      const ENV_LIST = [...new Set([...ENVS.map((e) => e.toUpperCase()), ...ocp.keys(), ...ngx.keys()])];
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
        const onlyNginx = [];
        for (const [k, v] of n) if (!o.has(k)) onlyNginx.push(v);

        return {
          // DIKKAT: map parametresi `e`; burada `env` yazmak ReferenceError uretiyordu
          // (uctan uca testte yakalandi - duz JS oldugu icin tsc gormuyor).
          env: e,
          measured,
          // INTERNET (passthrough) = nginx'e cikmasi BEKLENEN kume. Kapsam bunun uzerinden.
          internetTotal: bucket.internet.length,
          internetInNginx: inNginx.internet.length,
          internetMissingCount: internetMissing.length,
          internetMissing: internetMissing.sort(sortTr).slice(0, CAP),
          // INTRANET (reencrypt) = nginx'e CIKAMAZ. nginx'te gorunuyorsa BU BIR BULGUDUR.
          intranetTotal: bucket.intranet.length,
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
          coverage: measured && bucket.internet.length
            ? Math.round((inNginx.internet.length / bucket.internet.length) * 1000) / 10
            : null,
        };
      }).filter((r) => r.internetTotal || r.intranetTotal || r.otherTotal || r.unknownTotal || r.onlyNginxCount);

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
        routeMatch: matchStats,
        ocpNonSpaExcluded: ocpNonSpa.size,
        nginxOutsidePattern,
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

  // ── 5) UYGULAMA ORTAMLARI (MWApps/WASApps ad kuraliyla ortam matrisi) ──────────────
  require('./app-envs.cjs').registerAppEnvs(router);

  // ── 6) WEB-APP ILISKISI (uygulama <-> onundeki web sunucusu/vhost) ────────────────
  require('./web-app.cjs').registerWebApp(router);

  app.use('/api/denetim', router);
  console.log('[Denetim] module mounted at /api/denetim');
}

module.exports = { initDenetim };
