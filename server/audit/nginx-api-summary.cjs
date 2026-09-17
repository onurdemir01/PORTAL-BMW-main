// server/audit/nginx-api-summary.cjs - NginxRateLimitInventory ozetleme (SAF fonksiyon).
//
// Route'tan AYRI durur ki DB olmadan test edilebilsin: buradaki karar mantigi
// (ortamlar/sunucular arasi SURUKLENME tespiti, eksik ortam, limitsiz konfigurasyon)
// sayilari dogru gostermenin degil, DOGRU BULGU uretmenin isi.
//
// Girdi: (host, config) duzeyinde ONCEDEN gruplanmis satirlar - SQL tarafinda gruplanir
// cunku ham satir sayisi host x config x location ile carpilir.
'use strict';

const { envOfHost, siteOfHost, orderEnvs, UNKNOWN_ENV } = require('./nginx-hosts.cjs');

/**
 * Sunucunun SERVISI (kullanici, 2026-09-17: "sunucular mblcustomers / customers / mcustomers
 * servislerine gore ayriliyor"). NginxRateLimitInventory yalniz <api>.conf adini tutar,
 * kanal (vhost) dizinini tutmaz; servis bu yuzden nginx_audit'in (nginx -T) server
 * bloklarindan okunur: dbo.Nginx_Audit_Servers.conf_file -> "mblcustomers-PROD.conf" ->
 * "mblcustomers" (ortam eki ve .conf atilir). Sunucudaki her vhost bir servistir.
 * @param {{host:string, conf_file:string, server_name?:string}[]} serverRows
 * @returns Map<host, {services:string[], names:string[]}>
 */
function servicesOfHosts(serverRows) {
  const m = new Map();
  for (const r of serverRows || []) {
    const host = String(r.host || '').trim();
    const file = String(r.conf_file || '').trim().split('/').pop() || '';
    if (!host || !file) continue;
    const svc = file
      .replace(/\.conf$/i, '')
      .replace(/-(dev|test|qa|edu|prod|production)$/i, '')
      .toLowerCase();
    if (!svc) continue;
    if (!m.has(host)) m.set(host, { services: new Set(), names: new Set() });
    const e = m.get(host);
    e.services.add(svc);
    for (const n of String(r.server_name || '').split(/\s+/)) if (n) e.names.add(n);
  }
  return new Map([...m.entries()].map(([h, e]) => [h, { services: [...e.services].sort(), names: [...e.names].sort() }]));
}

/**
 * @param {{host:string, config_file:string, locations:number, no_limit:number,
 *          ip_limited?:number, srv_limited?:number}[]} recordset
 * @param {{host:string, conf_file:string, server_name?:string}[]} [serverRows]  Nginx_Audit_Servers (servis icin)
 */
function summarize(recordset, serverRows) {
  const svcOf = servicesOfHosts(serverRows);
  const raw = (recordset || []).map((r) => {
    const host = String(r.host || '').trim();
    return {
      host,
      env: envOfHost(host),
      site: siteOfHost(host),
      config: String(r.config_file || '').trim(),
      locations: Number(r.locations) || 0,
      noLimit: Number(r.no_limit) || 0,
      ipLimited: Number(r.ip_limited) || 0,
      srvLimited: Number(r.srv_limited) || 0,
    };
  });

  const envs = orderEnvs(new Set(raw.map((r) => r.env)));
  const envRank = new Map(envs.map((e, i) => [e, i]));
  // 'BILINMIYOR' bir ortam DEGILDIR: "eksik ortam" hesabinda paydaya girmemeli, aksi
  // halde her konfigurasyon sahte bir eksik gosterirdi.
  const realEnvs = envs.filter((e) => e !== UNKNOWN_ENV);

  // -- ortam kirilimi ---------------------------------------------------------
  const envAgg = new Map();
  for (const r of raw) {
    if (!envAgg.has(r.env)) {
      envAgg.set(r.env, {
        hostSet: new Set(), configSet: new Set(),
        locations: 0, noLimitLocations: 0, cfg: new Map(),
      });
    }
    const e = envAgg.get(r.env);
    e.hostSet.add(r.host);
    e.configSet.add(r.config);
    e.locations += r.locations;
    e.noLimitLocations += r.noLimit;
    const c = e.cfg.get(r.config) || { loc: 0, noLimit: 0 };
    c.loc += r.locations;
    c.noLimit += r.noLimit;
    e.cfg.set(r.config, c);
  }
  const byEnv = envs.map((env) => {
    const e = envAgg.get(env);
    let configsWithoutLimit = 0;
    for (const v of e.cfg.values()) if (v.loc > 0 && v.noLimit === v.loc) configsWithoutLimit += 1;
    return {
      env,
      hosts: e.hostSet.size,
      configs: e.configSet.size,
      locations: e.locations,
      noLimitLocations: e.noLimitLocations,
      configsWithoutLimit,
    };
  });

  // -- sunucu kirilimi --------------------------------------------------------
  const hostAgg = new Map();
  for (const r of raw) {
    if (!hostAgg.has(r.host)) {
      hostAgg.set(r.host, {
        host: r.host, env: r.env, site: r.site,
        // servis: vhost dosyalarindan (nginx_audit); yoksa bos liste -> ekranda "—"
        services: svcOf.get(r.host)?.services || [],
        serverNames: svcOf.get(r.host)?.names || [],
        configs: 0, locations: 0, noLimitLocations: 0,
      });
    }
    const h = hostAgg.get(r.host);
    h.configs += 1;
    h.locations += r.locations;
    h.noLimitLocations += r.noLimit;
  }
  const byHost = [...hostAgg.values()].sort(
    (a, b) => (envRank.get(a.env) - envRank.get(b.env))
      || a.services.join(',').localeCompare(b.services.join(','))
      || a.host.localeCompare(b.host),
  );

  // -- konfigurasyon kirilimi + FARKLAR ---------------------------------------
  const cfgAgg = new Map();
  for (const r of raw) {
    if (!cfgAgg.has(r.config)) {
      cfgAgg.set(r.config, { config: r.config, hosts: [], envs: {}, totalLocations: 0, noLimitLocations: 0 });
    }
    const c = cfgAgg.get(r.config);
    c.hosts.push({ host: r.host, env: r.env, site: r.site, locations: r.locations, noLimit: r.noLimit });
    c.totalLocations += r.locations;
    c.noLimitLocations += r.noLimit;
    if (!c.envs[r.env]) c.envs[r.env] = { hosts: 0, minLoc: Infinity, maxLoc: 0, locations: 0 };
    const ce = c.envs[r.env];
    ce.hosts += 1;
    ce.locations += r.locations;
    ce.minLoc = Math.min(ce.minLoc, r.locations);
    ce.maxLoc = Math.max(ce.maxLoc, r.locations);
  }

  const byConfig = [...cfgAgg.values()]
    .map((c) => {
      const presentEnvs = envs.filter((e) => c.envs[e]);
      const missingEnvs = realEnvs.filter((e) => !c.envs[e]);
      // AYNI ortamdaki sunucular arasinda fark: min != max => surukleme.
      let hostInconsistent = false;
      const envSummary = {};
      for (const e of presentEnvs) {
        const ce = c.envs[e];
        if (ce.minLoc !== ce.maxLoc) hostInconsistent = true;
        envSummary[e] = {
          hosts: ce.hosts,
          locations: ce.locations,
          minLoc: ce.minLoc === Infinity ? 0 : ce.minLoc,
          maxLoc: ce.maxLoc,
        };
      }
      // ORTAMLAR arasi fark: her ortamin beklenen (max) location sayisi esit mi?
      const perEnvMax = presentEnvs.filter((e) => e !== UNKNOWN_ENV).map((e) => c.envs[e].maxLoc);
      const envInconsistent = perEnvMax.length > 1 && new Set(perEnvMax).size > 1;
      return {
        config: c.config,
        envs: envSummary,
        presentEnvs,
        missingEnvs,
        hostInconsistent,
        envInconsistent,
        totalLocations: c.totalLocations,
        noLimitLocations: c.noLimitLocations,
        // Hicbir location'da ne IP ne de sunucu bazli limit tanimli degil.
        noLimitEverywhere: c.totalLocations > 0 && c.noLimitLocations === c.totalLocations,
        hosts: c.hosts.sort(
          (a, b) => (envRank.get(a.env) - envRank.get(b.env)) || a.host.localeCompare(b.host),
        ),
      };
    })
    .sort((a, b) => a.config.localeCompare(b.config));

  return {
    envs,
    totals: {
      hosts: hostAgg.size,
      configs: cfgAgg.size,
      locations: raw.reduce((a, r) => a + r.locations, 0),
      noLimitLocations: raw.reduce((a, r) => a + r.noLimit, 0),
      configsWithoutLimit: byConfig.filter((c) => c.noLimitEverywhere).length,
      inconsistentConfigs: byConfig.filter((c) => c.hostInconsistent || c.envInconsistent).length,
    },
    byEnv,
    byHost,
    byConfig,
    noLimitConfigs: byConfig.filter((c) => c.noLimitEverywhere).map((c) => c.config),
  };
}

module.exports = { summarize, servicesOfHosts };
