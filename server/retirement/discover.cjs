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
function buildTargets(base, invRows, certRows, jvmRows) {
  const certByHost = buildCertIndex(certRows || []);
  const jvmKey = (h, j) => `${U(h)}|${U(j)}`;
  const jvms = new Map((jvmRows || []).map((r) => [jvmKey(r.host, r.jvm), r]));
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
    const web = matchWebForApp({ app, appHost: host, domain: r.domain || '' }, certByHost);
    const j = jvms.get(jvmKey(host, app));
    targets.push({
      host, site: siteOf(host), env, appName: app, gen,
      appPath: r.app_path || '', inventoryStatus: r.status || '', domain: r.domain || '', tier: web.tier,
      web: web.web.map((w) => ({ host: w.host, serverName: w.serverName, product: w.product, port: w.port, confFile: w.confFile })),
      webHow: web.how,
      hub: j ? { running: Number(j.running) === 1, autoStart: String(j.auto_start || 'unknown'), scanDate: j.scan_date ? new Date(j.scan_date).toISOString().slice(0, 10) : null } : null,
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

async function discover(base) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const p = [{ name: 'b', type: sql.NVarChar(128), value: base }];
  const [inv, certs, jvms] = await Promise.all([
    query(`SELECT DISTINCT app, host, env, domain, jboss_version, app_path, status FROM dbo.MWAppsInventory WHERE app = @b OR app LIKE @b + '-_'`, p).then((r) => r.recordset || []),
    query(`SELECT host, ip, port, server_name, conf_file, product, env FROM dbo.BMW_Certificates_Inventory`).then((r) => r.recordset || []).catch(() => []),
    query(`SELECT t.host, t.jvm, t.running, t.auto_start, t.scan_date FROM dbo.Server_Hub_Jvms t
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m ON m.host = t.host AND m.d = t.scan_date
            WHERE t.jvm = @b OR t.jvm LIKE @b + '-_'`, p).then((r) => r.recordset || []).catch(() => []),
  ]);
  return buildTargets(base, inv, certs, jvms);
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

module.exports = { buildTargets, discover, searchApps, siteOf, parseAppName, genOf };
