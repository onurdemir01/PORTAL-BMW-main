// server/opsx/katalog-uclari.cjs - OpsX, Telnet ve FileX sihirbazlarinin ORTAK katalog uclari (2026-11-24).
//
// Uc modul ayni katalogu LogX ile AYNI kaynaklardan okur (uygulama envanteri + snapshot fallback, cluster
// katalogu, namespace onbellegi). Uc govdeleri uc dosyada kopyaydi (Sonar CPD); burada tek kez yazilir.
// Modul yalniz yolunu ve yetki ara katmanini verir. Yanit sekli degismedi: { ok: true, ... } ya da
// { ok: false, message } (hata durumu err.status, yoksa 500).
'use strict';

const hataYaz = (res, err) =>
  res.status(err.status || 500).json({ ok: false, message: err.message });

/** GET ?search= - uygulama envanteri (LogX v2 legacy.searchApps). */
async function uygulamaAra(req, res) {
  try {
    const legacy = require('../logx/v2/legacy.cjs');
    const result = await legacy.searchApps(req.query.search);
    res.json({ ok: true, ...result });
  } catch (err) {
    hataYaz(res, err);
  }
}

/** GET ?app= - secilen uygulamanin sunuculari (OpsX hostsForApp: env / jboss_version / status). */
function sunucular(hostsForApp) {
  return async function sunucularUcu(req, res) {
    try {
      const hosts = await hostsForApp(req.query.app);
      res.json({ ok: true, hosts });
    } catch (err) {
      hataYaz(res, err);
    }
  };
}

/** GET - OpenShift env/cluster agaci (LogX cluster katalogu AYNEN). */
async function clusterAgaci(req, res) {
  try {
    const adminData = require('../logx/v2/admin.cjs');
    const tree = await adminData.getClusterTree();
    res.json({ ok: true, tree });
  } catch (err) {
    hataYaz(res, err);
  }
}

/**
 * GET ?env=&tenant= - secilen env/tenant'in gercek cluster'larinda onbellekte GORULMUS namespace'ler (erisim
 * kisitlamasi suzulmus; OpsX namespacesForCluster). env ya da tenant yoksa 400.
 */
function ocpNamespaceleri(namespacesForCluster) {
  return async function ocpNamespaceleriUcu(req, res) {
    try {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      if (!env || !tenant)
        return res.status(400).json({ ok: false, message: 'env ve tenant gerekli.' });
      const user = req.session?.user || {};
      const namespaces = await namespacesForCluster(env, tenant, user);
      res.json({ ok: true, namespaces });
    } catch (err) {
      hataYaz(res, err);
    }
  };
}

module.exports = { uygulamaAra, sunucular, clusterAgaci, ocpNamespaceleri };
