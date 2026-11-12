// server/audit/nginx-locations.cjs — "Nginx SPA Audit > Location Detayi" (2026-08-24).
//
// SORU (kullanici): her servis icin, ortamlarda tanimli
//     /<Path>/   <Namespace>   <Application>
// bilgisini ve location blogunu gormek; standarta uyup uymadigini anlamak.
//
// KAYNAK: dbo.Nginx_Config_Audit — nginx_config_audit job'inin gunluk taramasi. Her satir
// bir vhost location blogudur:
//   location <path> { include .../application-confs/<include_name>.conf; }
//
// NE GOSTERILEBILIR, NE GOSTERILEMEZ (durust sinir):
//   VAR : location PATH'i, include edilen dosya ADI, cozulen namespace/application,
//         dagitim bicimi (namespaced/flat/none), host, vhost, durum.
//   YOK : location blogunun HAM ICERIGI. nginx_config_scan.sh yalnizca "location ... {
//         include ... }" ciftini kaydeder, blogun govdesini DB'ye yazmaz. Blogun tam
//         metnini gostermek scan script'inin genisletilmesini gerektirir - ayri is.
//         Burada uydurma bir govde URETILMEZ.
//
// STANDART KONTROLU: iki bagimsiz olcut ayri ayri raporlanir, tek bir "uygun/uygun degil"
// damgasi VURULMAZ - hangi olcutun tutmadigi bilinmeden mudahale edilemez.
//   1) status        : audit'in kendi siniflandirmasi (OK / BROKEN_INCLUDE / NOT_DEPLOYED /
//                      NOT_IN_INVENTORY / NAME_MISMATCH / MULTI_PATH)
//   2) pathMatchesApp: location path'i uygulama adini iceriyor mu? Tutmuyorsa path ile
//                      servis edilen uygulama ayrismis olabilir (kopyala-yapistir hatasi).
'use strict';

// Ayni (service, env, application, location) birden fazla HOST'ta tekrar eder (prod'da
// 4-8 aynali nginx). Satirlar bu dortlude TEKILLESTIRILIR, host'lar toplanir - aksi halde
// tablo ayni bilgiyi 8 kez gosterirdi.
function keyOf(r) {
  return [r.service, r.env, r.application, r.location_path, r.include_name]
    // AYIRICI U+0000 — servis/uygulama adlarinda gecemeyecek tek karakter.
    // KACIS DIZISI olarak yazilir, HAM bayt olarak DEGIL (2026-08-28): ham NUL bayti
    // dosyayi git'e BINARY gosteriyordu; `git diff`/`git blame` calismiyor, kod
    // incelemesinde degisiklik hic gorunmuyordu. (server/audit/denetim.cjs ayni
    // ayiriciyi zaten kacis dizisiyle yaziyor ve notu da bunu soyluyor.)
    .map((x) => String(x || '')).join('\u0000');
}

function registerNginxLocations(router) {
  router.get('/nginx-locations', async (req, res) => {
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const scanDate = String(req.query.scanDate || '').trim();
      const service = String(req.query.service || '').trim();
      const env = String(req.query.env || '').trim().toUpperCase();
      const status = String(req.query.status || '').trim();
      const q = String(req.query.q || '').trim().toLowerCase();
      const CAP = 1500;

      const dateRes = await query(
        scanDate
          ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
          : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`,
        scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : []
      );
      const effectiveDate = dateRes.recordset?.[0]?.d || null;
      if (!effectiveDate) {
        return res.json({
          ok: true, scanDate: null, services: [], envs: [], statusCounts: [],
          total: 0, shown: 0, capped: false, rows: [],
        });
      }

      const rs = await query(
        `SELECT service, env, host, vhost, location_path, include_name, application,
                namespace, deploy_mode, include_exists, app_deployed, in_ocp_inventory, status
           FROM dbo.Nginx_Config_Audit
          WHERE scan_date = @d`,
        [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }]
      );
      // ELLE ETIKET (2026-11-12, "her yerde gecerli"): sunucu 'Yerine gec' + tek etiketliyse tanimin
      // servisi o etikettir (SPA Uygulamalari / Denetim SPA ile ayni kural; nginx-host-labels tekEtiket).
      // conf.d'deki asil ad serviceOto'da kalir.
      const et = require('./nginx-host-labels.cjs');
      const etM = (await et.etiketHaritasi()).m;
      const ham = rs.recordset || [];
      // Tanim basina: aynalar karisik etiketliyse conf.d adi kalir (tek tanim iki satira bolunmesin).
      const tanimEt = et.tanimEtiketi(ham, etM, keyOf);
      const raw = ham.map((r) => {
        const t = tanimEt(r);
        return t && t !== String(r.service || '').trim().toUpperCase() ? { ...r, service: t, service_oto: r.service || null } : r;
      });

      // Filtre secenekleri TUM veriden uretilir (filtre uygulanmadan once), yoksa bir
      // ortam secildiginde diger secenekler listeden kaybolurdu.
      const services = [...new Set(raw.map((r) => String(r.service || '')).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'tr'));
      const envs = [...new Set(raw.map((r) => String(r.env || '').toUpperCase()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'tr'));

      const merged = new Map();
      const statusCount = {};
      let total = 0;

      for (const r of raw) {
        const svc = String(r.service || '');
        const e = String(r.env || '').toUpperCase();
        if (service && svc !== service) continue;
        if (env && e !== env) continue;
        if (status && String(r.status || '') !== status) continue;

        const app = String(r.application || '').trim();
        const ns = String(r.namespace || '').trim();
        const path = String(r.location_path || '').trim();
        if (q && ![app, ns, path, String(r.include_name || '')]
          .some((x) => x.toLowerCase().includes(q))) continue;

        const k = keyOf(r);
        if (!merged.has(k)) {
          const st = String(r.status || '');
          statusCount[st] = (statusCount[st] || 0) + 1;
          total++;
          merged.set(k, {
            service: svc,
            ...(r.service_oto !== undefined ? { serviceOto: r.service_oto } : {}),
            env: e,
            locationPath: path,
            includeName: String(r.include_name || '').trim(),
            application: app,
            namespace: ns,
            deployMode: String(r.deploy_mode || '').trim(),
            includeExists: !!r.include_exists,
            appDeployed: !!r.app_deployed,
            inOcpInventory: !!r.in_ocp_inventory,
            status: st,
            vhosts: new Set(),
            hosts: new Set(),
            // Location path uygulama adini iceriyor mu? Tutmuyorsa path ile servis edilen
            // uygulama ayrismis olabilir. Damga DEGIL, dikkat cekici bir isaret.
            pathMatchesApp: !!app && path.toLowerCase().includes(app.toLowerCase()),
          });
        }
        const m = merged.get(k);
        if (r.vhost) m.vhosts.add(String(r.vhost));
        if (r.host) m.hosts.add(String(r.host));
      }

      const sortTr = (a, b) => a.localeCompare(b, 'tr');
      const rows = [...merged.values()]
        .map((m) => ({ ...m, vhosts: [...m.vhosts].sort(sortTr), hosts: [...m.hosts].sort(sortTr) }))
        .sort((a, b) =>
          sortTr(a.service, b.service) || sortTr(a.env, b.env) ||
          sortTr(a.application, b.application) || sortTr(a.locationPath, b.locationPath));

      res.json({
        ok: true,
        scanDate: effectiveDate,
        services,
        envs,
        statusCounts: Object.entries(statusCount)
          .map(([s, count]) => ({ status: s, count })).sort((a, b) => b.count - a.count),
        total,
        shown: Math.min(rows.length, CAP),
        capped: rows.length > CAP,
        // Location blogunun HAM govdesi taranmiyor; ekran bunu soylemeli.
        bodyAvailable: false,
        rows: rows.slice(0, CAP),
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Location detayı alınamadı.' });
    }
  });
}

module.exports = { registerNginxLocations };
