// server/audit/app-envs.cjs — "Denetim > Uygulama Ortamlari" (2026-08-23, kullanici talebi).
//
// SORU: bir uygulama hangi ortamlara dagitilmis? SPA tarafindaki matrisin ayni'si, ama
// kaynak dbo.MWAppsInventory (JBoss) / dbo.WASAppsInventory (WAS).
//
// ORTAM AD KURALI (kullanici tarafindan verildi):
//   <Uygulama>-D  -> development
//   <Uygulama>-T  -> test
//   <Uygulama>-Q  -> qa
//   <Uygulama>    -> production
// Taban ad (base) son ek atilarak bulunur; matris satirlari bu taban ada gore kurulur.
//
// IKI BAGIMSIZ SINYAL, BILEREK KARSILASTIRILIYOR:
//   1) UYGULAMA ADI  -> yukaridaki kural
//   2) env SUTUNU    -> envanter job'i bunu HOSTNAME'den turetiyor
//      (bmw_inventory/.../jboss/operations/tasks/main.yml checkEnv fonksiyonu:
//       *P<n>/*SUBE<n>/*INTER<n>/... -> Production, *O<n> -> ODM, *A<n> -> Alpha,
//       *Q<n> -> QA, *T<n>/*D<n>/*BETAT/*WAST -> Test, aksi halde Production)
//   Ikisi celisiyorsa uygulama YANLIS ORTAMDAKI bir sunucuda kosuyor olabilir - bu
//   gercek bir denetim bulgusudur ve ayrica raporlanir.
//
// KRITIK INCELIK: env sutunu D ile T'yi AYIRT EDEMEZ - checkEnv hem *T<n> hem *D<n>
// host'larini "Test" yazar. Bu yuzden ad kuralindaki dev ve test, karsilastirmada TEK
// GRUP sayilir; aksi halde her -D uygulamasi sahte bir celiski uretirdi.
// ODM ve Alpha ad kuralinda hic karsiligi olmayan ortamlar - celiski DEGIL, "kapsam
// disi" sayilir.
'use strict';

const SOURCES = {
  mw:  { table: 'dbo.MWAppsInventory',  label: 'JBoss uygulamalari' },
  was: { table: 'dbo.WASAppsInventory', label: 'WAS uygulamalari' },
};

const ENVS = ['DEV', 'TEST', 'QA', 'PROD'];

// Ad son ekinden ortam. Buyuk/kucuk harf AYRIMI korunur: kural buyuk harf verdi ve
// "-d" gibi kucuk harfli sapmalar ayrica raporlanacak, sessizce dogru sayilmayacak.
const SUFFIX_ENV = { D: 'DEV', T: 'TEST', Q: 'QA' };

// env sutunu (hostname'den turetilmis) -> ad kuralindaki karsiligi.
// Test hem -T hem -D uygulamalarini barindirabilir (bkz. yukaridaki incelik).
const COLUMN_ENV_GROUP = {
  Production: ['PROD'],
  Test: ['TEST', 'DEV'],
  QA: ['QA'],
  // ODM/Alpha ad kuralinin disinda; celiski uretmesinler.
  ODM: null,
  Alpha: null,
};

function parseApp(app) {
  const m = /^(.*)-([A-Za-z])$/.exec(app);
  if (!m) return { base: app, env: 'PROD', standard: true, reason: null };

  const [, base, letter] = m;
  if (SUFFIX_ENV[letter]) return { base, env: SUFFIX_ENV[letter], standard: true, reason: null };

  const upper = letter.toUpperCase();
  if (SUFFIX_ENV[upper]) {
    // "-d" / "-t" / "-q": muhtemelen dogru ortam ama kural BUYUK harf. Ortami yine de
    // uygular (veriyi kaybetmemek icin) ama sapma olarak isaretler.
    return { base, env: SUFFIX_ENV[upper], standard: false, reason: 'Küçük harfli son ek' };
  }
  // Tek harfli ama taninmayan son ek (-P, -A, -O, -X ...). Ortam ATANMAZ; "prod"
  // saymak yanlis olurdu, cunku bu bir ortam eki gibi duruyor ama kuralda yok.
  return { base, env: null, standard: false, reason: `Tanınmayan son ek: -${letter}` };
}

// Ortam SOZCUGU ile biten adlar (-DEV, -TEST, -PROD ...). Kural tek harf verdi; bunlar
// ayri bir sapma turu ve tek-harf kontrolune takilmadiklari icin ayrica araniyor.
const WORD_SUFFIX = /-(DEV|DEVELOPMENT|TEST|TST|QA|UAT|PROD|PRD|PRP|PRODUCTION)$/i;

function registerAppEnvs(router) {
  router.get('/app-envs', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const key = SOURCES[String(req.query.source || 'mw')] ? String(req.query.source) : 'mw';
      const src = SOURCES[key];

      const rs = await query(
        `SELECT app, env, host, domain FROM ${src.table} WHERE app IS NOT NULL AND app <> ''`
      );
      const raw = rs.recordset || [];

      const apps = new Map();        // base -> { base, envs: {ENV: {hosts:Set, rows}} }
      const nonStandard = new Map(); // app -> { app, reason, hosts:Set, envColumn:Set }
      const conflicts = new Map();   // app -> { app, base, nameEnv, envColumn, hosts:Set }
      // env sutunu ad kuralinda karsiligi OLMAYAN degerler (Alpha, ODM ve hic gorulmemis
      // degerler). Bunlar celiski SAYILMAZ ama gorunmez de kalmamali: adinda son ek
      // olmadigi icin bu uygulamalar matriste PROD kutusuna duser, oysa Alpha/ODM
      // host'unda kosuyorlar. Sayilari ekranda gosteriliyor.
      const outOfScope = new Map();

      for (const r of raw) {
        const app = String(r.app || '').trim();
        if (!app) continue;
        const host = String(r.host || '').trim();
        const envCol = String(r.env || '').trim();

        const p = parseApp(app);
        const wordHit = WORD_SUFFIX.exec(app);

        if (wordHit) {
          const e = nonStandard.get(app) || { app, reason: `Ortam sözcüğüyle biten ad: ${wordHit[0]}`, hosts: new Set(), envColumn: new Set() };
          e.hosts.add(host); e.envColumn.add(envCol);
          nonStandard.set(app, e);
        } else if (!p.standard) {
          const e = nonStandard.get(app) || { app, reason: p.reason, hosts: new Set(), envColumn: new Set() };
          e.hosts.add(host); e.envColumn.add(envCol);
          nonStandard.set(app, e);
        }

        // Ortami cozulemeyen adlar matrise girmez - uydurma bir kutuya koymak, matrisi
        // yanlis doldurmak olurdu.
        if (!p.env) continue;

        if (!apps.has(p.base)) apps.set(p.base, { base: p.base, envs: {} });
        const entry = apps.get(p.base);
        if (!entry.envs[p.env]) entry.envs[p.env] = { hosts: new Set(), rows: 0 };
        entry.envs[p.env].hosts.add(host);
        entry.envs[p.env].rows++;

        // Ad <-> env sutunu celiskisi
        const group = Object.prototype.hasOwnProperty.call(COLUMN_ENV_GROUP, envCol)
          ? COLUMN_ENV_GROUP[envCol] : undefined;
        if (group === undefined || group === null) {
          // undefined = hic gorulmemis env degeri, null = bilinen ama ad kuralinin
          // disindaki ortam (Alpha/ODM). Ikisi de celiski degil, ama raporlanir.
          const u = outOfScope.get(envCol)
            || { envColumn: envCol, apps: new Set(), known: group === null };
          u.apps.add(app); outOfScope.set(envCol, u);
        } else if (!group.includes(p.env)) {
          const c = conflicts.get(app) || { app, base: p.base, nameEnv: p.env, envColumn: envCol, hosts: new Set() };
          c.hosts.add(host); conflicts.set(app, c);
        }
      }

      const sortTr = (a, b) => a.localeCompare(b, 'tr');
      const rows = [...apps.values()].map((a) => {
        const envs = {};
        for (const e of ENVS) {
          const v = a.envs[e];
          envs[e] = v ? { hosts: [...v.hosts].sort(sortTr), rows: v.rows } : null;
        }
        const present = ENVS.filter((e) => envs[e]);
        const missing = ENVS.filter((e) => !envs[e]);
        return { base: a.base, envs, present, missing, missingCount: missing.length };
      }).sort((x, y) => x.base.localeCompare(y.base, 'tr'));

      // En sik eksik-ortam desenleri (SPA tarafindaki ile ayni fikir).
      const patternMap = new Map();
      for (const r of rows) {
        if (!r.missing.length) continue;
        const k = r.missing.join(',');
        patternMap.set(k, (patternMap.get(k) || 0) + 1);
      }
      const patterns = [...patternMap.entries()]
        .map(([k, count]) => ({ missing: k.split(','), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      res.json({
        ok: true,
        source: key,
        label: src.label,
        sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, label: v.label })),
        envs: ENVS,
        totalRows: raw.length,
        totalApps: rows.length,
        completeCount: rows.filter((r) => !r.missingCount).length,
        patterns,
        rows,
        nonStandard: [...nonStandard.values()]
          .map((e) => ({ app: e.app, reason: e.reason, hosts: [...e.hosts].sort(sortTr), envColumn: [...e.envColumn].filter(Boolean).sort() }))
          .sort((a, b) => a.app.localeCompare(b.app, 'tr')),
        conflicts: [...conflicts.values()]
          .map((c) => ({ ...c, hosts: [...c.hosts].sort(sortTr) }))
          .sort((a, b) => a.app.localeCompare(b.app, 'tr')),
        outOfScopeEnvColumns: [...outOfScope.values()]
          .map((u) => ({ envColumn: u.envColumn, appCount: u.apps.size, known: u.known }))
          .sort((a, b) => b.appCount - a.appCount),
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Uygulama ortam verisi alınamadı.' });
    }
  });
}

module.exports = { registerAppEnvs, parseApp, SOURCES };
