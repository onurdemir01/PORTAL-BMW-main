// server/audit/web-app.cjs — "Denetim > Web-App Ilişkisi" (2026-08-23, kullanici talebi).
//
// SORU: MWAppsInventory/WASAppsInventory'deki her uygulama satirinin onune, o uygulamayi
// SERVIS EDEN web sunucusunu (host, ip, port, server_name) koymak.
//
// KAYNAKLAR
//   dbo.MWAppsInventory / dbo.WASAppsInventory -> app, host, env, domain
//   dbo.BMW_Certificates_Inventory             -> host, ip, port, server_name, conf_file,
//                                                 product, alias, env
//
// ESLESTIRME KURALLARI (kullanici verdi)
//   3-tier (genellikle gtdmz.com.tr): uygulama sunucusunun adindaki 5. KARAKTER 'A' ise
//     web sunucusunda 'W' olur.  DACRAAP01 -> DACRWAP01,  GBCJAP01 -> GBCJWP01
//     DIKKAT: "ilk A" degil, 5. KONUM. DACRAAP01'de iki 'A' var, yalnizca 5.'si doner.
//   2-tier (genellikle .fw.garanti.com.tr): web sunucusu uygulamanin KENDI sunucusudur.
//   Her iki durumda da dogru vhost'u bulmak icin uygulama adi KUCUK HARFLE server_name
//   icinde aranir.
//
// TAHMIN YOK: server_name'de uygulama adinin HANGI bicimde gectigi (tam ad mi, ortam son
// eki atilmis taban ad mi) kullanicinin da emin olmadigi bir nokta. Bu yuzden IKISI DE
// denenir ve HANGISIYLE eslestigi her satirda raporlanir - gercek veri geldiginde cevap
// kendiliginden ortaya cikar. Hicbiri tutmazsa satir "eslesmedi" olarak isaretlenir,
// uydurma bir web sunucusu YAZILMAZ.
'use strict';

const SOURCES = {
  mw:  { table: 'dbo.MWAppsInventory',  label: 'JBoss uygulamaları' },
  was: { table: 'dbo.WASAppsInventory', label: 'WAS uygulamaları' },
};

// Ortam son eki (bkz. app-envs.cjs): server_name'de taban ad geciyor olabilir.
const ENV_SUFFIX = /-[DTQdtq]$/;

const TIER3_DOMAIN = /gtdmz/i;
const TIER2_DOMAIN = /fw\.garanti/i;

/**
 * 3-tier kuralina gore web sunucusu adini uretir: 5. KARAKTER 'A' ise 'W' yapilir.
 * Kural tutmazsa null doner - tahmin edilmez.
 */
function webHostOf(host) {
  const h = String(host || '').trim();
  if (h.length < 5) return null;
  if (h[4].toUpperCase() !== 'A') return null;
  return h.slice(0, 4) + (h[4] === 'a' ? 'w' : 'W') + h.slice(5);
}

function tierOf(domain, host) {
  const d = String(domain || '');
  if (TIER3_DOMAIN.test(d)) return '3-tier';
  if (TIER2_DOMAIN.test(d)) return '2-tier';
  // Domain bos/tanimsizsa host adindan CIKARIM YAPILMAZ; "bilinmiyor" denir ve her iki
  // aday da denenir. Yanlis tier atamak, yanlis web sunucusu gostermek demek olurdu.
  return 'bilinmiyor';
}

function registerWebApp(router) {
  router.get('/web-app', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const key = SOURCES[String(req.query.source || 'mw')] ? String(req.query.source) : 'mw';
      const src = SOURCES[key];
      const q = String(req.query.q || '').trim().toLowerCase();
      const onlyUnmatched = String(req.query.onlyUnmatched || '') === '1';
      const CAP = 1000;

      const [appRes, certRes] = await Promise.all([
        query(`SELECT DISTINCT app, host, env, domain FROM ${src.table}
                WHERE app IS NOT NULL AND app <> ''`),
        query(`SELECT host, ip, port, server_name, conf_file, product, env
                 FROM dbo.BMW_Certificates_Inventory`)
          .catch(() => ({ recordset: [], _missing: true })),
      ]);
      const certMissing = !!certRes._missing;

      // Web sunucusu adina gore vhost kayitlari.
      const certByHost = new Map();
      for (const c of certRes.recordset || []) {
        const h = String(c.host || '').trim().toUpperCase();
        if (!h) continue;
        if (!certByHost.has(h)) certByHost.set(h, []);
        certByHost.get(h).push({
          host: String(c.host || '').trim(),
          ip: c.ip == null ? '' : String(c.ip).trim(),
          port: c.port == null ? '' : String(c.port).trim(),
          serverName: String(c.server_name || '').trim(),
          confFile: String(c.conf_file || '').trim(),
          product: String(c.product || '').trim(),
        });
      }

      const howCount = {};
      const tierCount = {};
      const rows = [];
      let total = 0;

      for (const a of appRes.recordset || []) {
        const app = String(a.app || '').trim();
        const appHost = String(a.host || '').trim();
        if (!app) continue;

        const domain = String(a.domain || '').trim();
        const tier = tierOf(domain, appHost);
        const needleFull = app.toLowerCase();
        const needleBase = needleFull.replace(ENV_SUFFIX, '');

        // Aday web sunuculari: kurala gore SIRALI denenir.
        //   3-tier  -> once harf donusumu, sonra ayni host (kural tutmazsa)
        //   2-tier  -> ayni host
        //   bilinmiyor -> ikisi de
        const w = webHostOf(appHost);
        const candidates = tier === '3-tier'
          ? [{ host: w, how: 'harf-dönüşümü' }, { host: appHost, how: 'aynı host' }]
          : tier === '2-tier'
            ? [{ host: appHost, how: 'aynı host' }]
            : [{ host: w, how: 'harf-dönüşümü' }, { host: appHost, how: 'aynı host' }];

        let matched = null;   // { how, nameForm, entries[] }
        let hostOnly = null;  // web sunucusu bulundu ama server_name tutmadi

        for (const cand of candidates) {
          if (!cand.host) continue;
          const list = certByHost.get(cand.host.toUpperCase());
          if (!list || !list.length) continue;
          if (!hostOnly) hostOnly = { how: cand.how, host: cand.host, count: list.length };

          // Once TAM ad, sonra ortam son eki atilmis TABAN ad.
          for (const [form, needle] of [['tam ad', needleFull], ['taban ad', needleBase]]) {
            if (form === 'taban ad' && needle === needleFull) continue;  // son ek yoksa tekrar deneme
            const hits = list.filter((e) => e.serverName.toLowerCase().includes(needle));
            if (hits.length) { matched = { how: cand.how, nameForm: form, entries: hits }; break; }
          }
          if (matched) break;
        }

        const how = matched ? `${matched.how} + server_name (${matched.nameForm})`
          : hostOnly ? 'web sunucusu var, server_name tutmadı'
          : 'eşleşmedi';

        howCount[how] = (howCount[how] || 0) + 1;
        tierCount[tier] = (tierCount[tier] || 0) + 1;
        total++;

        if (onlyUnmatched && matched) continue;
        if (q && !app.toLowerCase().includes(q) && !appHost.toLowerCase().includes(q)) continue;
        if (rows.length >= CAP) continue;

        rows.push({
          app,
          appHost,
          env: String(a.env || '').trim(),
          domain,
          tier,
          how,
          matched: !!matched,
          // Bir uygulama birden fazla vhost'ta servis ediliyor olabilir; hepsi dondurulur.
          web: matched ? matched.entries : [],
          webHostCandidate: hostOnly ? hostOnly.host : (webHostOf(appHost) || appHost),
          vhostCountOnHost: hostOnly ? hostOnly.count : 0,
        });
      }

      rows.sort((x, y) => x.app.localeCompare(y.app, 'tr') || x.appHost.localeCompare(y.appHost, 'tr'));

      res.json({
        ok: true,
        source: key,
        label: src.label,
        sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, label: v.label })),
        certMissing,
        total,
        shown: rows.length,
        capped: rows.length >= CAP,
        matchSummary: Object.entries(howCount).map(([how, count]) => ({ how, count }))
          .sort((a, b) => b.count - a.count),
        tierSummary: Object.entries(tierCount).map(([tier, count]) => ({ tier, count }))
          .sort((a, b) => b.count - a.count),
        rows,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Web-App ilişkisi alınamadı.' });
    }
  });
}

module.exports = { registerWebApp, webHostOf, tierOf };
