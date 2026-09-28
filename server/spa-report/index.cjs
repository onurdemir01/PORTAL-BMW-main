// server/spa-report/index.cjs — "Nginx ARK SPA Raporu" uçları.
//
// Kullanıcı (2026-09-28): tüm servisler (Glomo / Webforms / Saklama / Geintdigital vb.)
// için tek liste; kolonlar Ekip Beyanı, Uygulama, Namespace, Ekip, Yük Durumu, Location,
// Açıklama. "Buraya ekiplerin giriş yapabilmesini istiyorum."
//
// KİM YAZABİLİR: giriş yapmış her kullanıcı — sayfa görünürlük motorundan geçer, yani
// kimin göreceğini Admin > Sayfa Erişimi belirler. Beyan bir ÖLÇÜM DEĞİL, ekibin kendi
// ifadesidir; kim/ne zaman yazdığı kaydedilir ve ekranda görünür. Salt okunur bir rapor
// yapıp beyanı Admin'e bırakmak, veriyi bilen kişiyi devre dışı bırakırdı.
//
// BEYAN TEK ALANDIR (kullanıcı kararı, 2026-09-28): SPA Taşımaları'ndaki alanın AYNISI
// (nginx_migration_tracking.in_use). Aynı uygulama için iki ekranda iki farklı beyan
// olması, "hangisi geçerli" sorusunu cevapsız bırakırdı. Bu yüzden okuma group_id'ye
// BAKMAZ (en son güncellenen kazanır), yazma ise varsa mevcut satırı günceller.
'use strict';

const express = require('express');
const db = require('../db/index.cjs');

const TTL_MS = 60 * 1000;
let _cache = { at: 0, value: null };

/** Beyanlar: "ns/app" -> {inUse, inUseBy, note}. group_id'den BAĞIMSIZ, en yeni kazanır. */
async function loadBeyanlar() {
  const m = new Map();
  try {
    const r = await db.query(
      `SELECT namespace, application, in_use, in_use_by, note, updated_at
         FROM nginx_migration_tracking
        ORDER BY updated_at ASC`,
    );
    for (const x of r.rows || []) {
      const k = `${String(x.namespace || '').trim()}/${String(x.application || '').trim()}`;
      // ORDER BY updated_at ASC + üzerine yazma = EN YENİ kazanır.
      m.set(k, {
        inUse: x.in_use == null ? null : String(x.in_use),
        inUseBy: x.in_use_by || null,
        note: x.note || '',
      });
    }
  } catch {
    /* tablo yoksa beyan sütunu boş kalır - rapor yine çalışır */
  }
  return m;
}

async function loadReport(fresh) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) {
    return { ..._cache.value, cached: true };
  }
  const { query, sql } = require('../inventory/mssql.cjs');
  const { buildSpaReport } = require('./build.cjs');

  const tarih = await query(
    `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`,
  )
    .then((r) => r.recordset?.[0]?.d || null)
    .catch(() => null);
  if (!tarih) {
    // TARAMA YOKSA BOŞ LİSTE DÖNMEYİZ: "hiç SPA yok" ile "henüz taranmadı" ayrı şeyler.
    return { ok: true, notScanned: true, scanDate: null, rows: [], services: [], skipped: 0 };
  }

  const { spaSatirlari, trafikSatirlari } = await (async () => {
    const [a, b] = await Promise.all([
      query(
        `SELECT service, env, application, namespace, location_path, host, vhost
           FROM dbo.Nginx_Config_Audit
          WHERE scan_date = @d
            AND (COL_LENGTH('dbo.Nginx_Config_Audit', 'kind') IS NULL OR kind IS NULL OR kind = 'spa')`,
        [{ name: 'd', type: sql.NVarChar(10), value: tarih }],
      )
        .then((r) => r.recordset || [])
        .catch(() => []),
      query(
        `SELECT service, env, location, req_24h, req_7d, hc_24h, sampled, last_seen, error
           FROM dbo.Nginx_Spa_Traffic
          WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Spa_Traffic)`,
      )
        .then((r) => r.recordset || [])
        .catch(() => []),
    ]);
    return { spaSatirlari: a, trafikSatirlari: b };
  })();

  // YÜK: Denetim > Nginx SPA ile AYNI ölçüt. Üç durum ayrı kalır; ölçülemeyen bir
  // location "yük yok" DEĞİLDİR (bkz. denetim.cjs trafficOf).
  const trafik = new Map();
  for (const x of trafikSatirlari) {
    const k = `${String(x.service || '').toUpperCase()}|${String(x.env || '').toUpperCase()}|${String(x.location || '')}`;
    if (!trafik.has(k))
      trafik.set(k, { req24: 0, req7: 0, hosts: 0, unknown: 0, sampled: false, lastSeen: null });
    const c = trafik.get(k);
    if (x.error) {
      c.unknown += 1;
      continue;
    }
    c.hosts += 1;
    c.req24 += Number(x.req_24h) || 0;
    c.req7 += Number(x.req_7d) || 0;
    if (x.sampled) c.sampled = true;
    const ls = x.last_seen ? String(x.last_seen) : null;
    if (ls && (!c.lastSeen || ls > c.lastSeen)) c.lastSeen = ls;
  }
  const trafficOf = (service, env, location) => {
    const c = trafik.get(
      `${String(service || '').toUpperCase()}|${String(env || '').toUpperCase()}|${String(location || '')}`,
    );
    if (!c || (c.hosts === 0 && c.unknown === 0)) return null;
    if (c.hosts === 0)
      return {
        state: 'unknown',
        req7: null,
        req24: null,
        sampled: false,
        lastSeen: null,
        hosts: 0,
        unknownHosts: c.unknown,
      };
    return {
      state: c.req7 > 0 ? 'active' : c.sampled ? 'unknown' : 'idle',
      req7: c.req7,
      req24: c.req24,
      sampled: c.sampled,
      lastSeen: c.lastSeen,
      hosts: c.hosts,
      unknownHosts: c.unknown,
    };
  };

  const { loadNamespaceOwners, ownersFor } = require('../audit/ns-owners.cjs');
  const owners = await loadNamespaceOwners(query).catch(() => ({ byNs: new Map(), ready: false }));
  const beyanlar = await loadBeyanlar();

  const r = buildSpaReport({
    rows: spaSatirlari,
    trafficOf,
    beyanlar,
    ekipOf: (ns) => (ownersFor(owners.byNs, [ns]) || {}).groups || [],
    env: 'PROD',
  });
  const value = {
    ok: true,
    notScanned: false,
    scanDate: tarih,
    ownersReady: owners.ready !== false,
    trafficReady: trafikSatirlari.length > 0,
    ...r,
  };
  _cache = { at: Date.now(), value };
  return { ...value, cached: false };
}

const BEYAN = new Set(['yes', 'no', 'unknown']);

function initSpaReport(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);
  try {
    const { requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisible('ArkSpaRaporu'));
  } catch {
    /* gorunurluk motoru yoksa yoksay */
  }

  router.get('/', async (req, res) => {
    try {
      res.json(await loadReport(String(req.query.fresh || '') === '1'));
    } catch (err) {
      res.status(err.status || 502).json({ ok: false, message: err.message });
    }
  });

  // BEYAN YAZMA: giriş yapmış kullanıcı. Kim yazdı KAYDEDİLİR - beyan bir ölçüm değil,
  // bir ifadedir; kimin söylediği bilinmeden değeri olmaz.
  router.put('/declare', async (req, res) => {
    const ns = String(req.body?.namespace || '').trim();
    const app2 = String(req.body?.application || '').trim();
    const inUse = req.body?.inUse == null || req.body?.inUse === '' ? null : String(req.body.inUse);
    const note = String(req.body?.note || '').slice(0, 500);
    if (!ns || !app2)
      return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    if (inUse !== null && !BEYAN.has(inUse))
      return res.status(400).json({ ok: false, message: 'Geçersiz beyan.' });
    const user = require('../auth/utils.cjs').getRequestUser(req) || {};
    const by = user.username || null;
    try {
      // MEVCUT SATIR VARSA ONU GUNCELLE: beyan tek alandir, ikinci bir satir acmak ayni
      // uygulama icin iki farkli cevap uretirdi (bkz. dosya basligi).
      const ex = await db.query(
        `SELECT TOP 1 group_id FROM nginx_migration_tracking
          WHERE namespace = $1 AND application = $2 ORDER BY updated_at DESC`,
        [ns, app2],
      );
      if (ex.rows.length) {
        await db.query(
          `UPDATE nginx_migration_tracking
              SET in_use = $3, in_use_by = $4, in_use_at = GETUTCDATE(), note = $5,
                  updated_by = $4, updated_at = GETUTCDATE()
            WHERE group_id = $1 AND namespace = $2 AND application = $6`,
          [ex.rows[0].group_id, ns, inUse, by, note, app2],
        );
      } else {
        await db.query(
          `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, in_use, in_use_by, in_use_at, note, updated_by)
           VALUES ('ark', $1, $2, 'none', $3, $4, GETUTCDATE(), $5, $4)`,
          [ns, app2, inUse, by, note],
        );
      }
      _cache = { at: 0, value: null };
      res.json({ ok: true, inUse, inUseBy: by, note });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/spa-report', router);
  console.log('[ARK SPA] module mounted at /api/spa-report');
}

module.exports = { initSpaReport, loadReport };
