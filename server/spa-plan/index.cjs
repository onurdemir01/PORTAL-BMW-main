// server/spa-plan/index.cjs — SPA Taşıma Planı, EKİP ekranı (2026-09-26).
//
// Kullanıcı: "SPA production taşımaları için ekiplerden planlama almak istiyorum ama
// e-postadan takip etmek çok zor. Nginx Hub dışında bir yer olsun, Production Taşımaları
// sayfasının aynısı oraya yansısın; ekipler uygulamalarının kullanılıp kullanılmadığını,
// kullanılıyorsa deployment/rollout tarihini girsin."
//
// ÜÇ TASARIM KARARI:
//
// 1) TEK KAYIT YERİ. Ekibin girdiği tarih, yöneticinin baktığı Production Taşımaları ile
//    AYNI tabloya (nginx_migration_tracking) yazılır. Ayrı bir "ekip tablosu" açsaydık iki
//    liste bir hafta içinde ayrışır, e-posta takibinden farkı kalmazdı.
//
// 2) EKİP YALNIZ İKİ ŞEY YAZAR: "kullanımda mı" ve "planlanan tarih" (+ not). `migrated`
//    (geçti) işaretini ekip KOYAMAZ — o, taramayla doğrulanan bir olgu, beyan değil.
//    Bu uç, gövdedeki başka alanları görmezden gelir; yönetici uçları ayrı yerde durur.
//
// 3) ÖLÇÜM İLE BEYAN AYRI DURUR. "Yük alıyor mu" access log'dan ÖLÇÜLÜR (dbo.Nginx_Spa_Traffic),
//    "kullanıyor muyuz" ekibin BEYANIDIR. Ekran ikisini yan yana gösterir; biri diğerinin
//    yerine geçmez — ölçüm "idle" derken ekip "kullanıyoruz" diyebilir (yılda bir koşan iş).
'use strict';

const express = require('express');

const TRAFFIC_TABLE = 'dbo.Nginx_Spa_Traffic';
const IN_USE = ['yes', 'no', 'unknown'];

/** İstemciden gelen beyan gövdesi. Yalnız ekibin yazabileceği alanlar okunur. */
function normalizeDeclaration(body) {
  const group = String(body?.group || '').trim();
  const namespace = String(body?.namespace || '').trim().toLowerCase();
  const application = String(body?.application || '').trim().toLowerCase();
  if (!group || !namespace || !application) throw new Error('group, namespace, application zorunlu.');

  const inUse = String(body?.inUse || '').trim().toLowerCase();
  if (inUse && !IN_USE.includes(inUse)) throw new Error(`Geçersiz kullanım bilgisi: ${inUse}`);

  const raw = String(body?.plannedDate || '').trim();
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`Tarih YYYY-AA-GG olmalı: ${raw}`);
  const plannedDate = raw || null;

  // "Kullanıyoruz" diyip tarih vermemek, tam olarak e-postadaki belirsizliğin kendisi.
  if (inUse === 'yes' && !plannedDate) {
    throw new Error('Uygulama kullanımdaysa deployment/rollout tarihi zorunlu.');
  }
  return { group, namespace, application, inUse: inUse || null, plannedDate, note: String(body?.note || '').trim().slice(0, 500) || null };
}

/** Kullanıcının AD grupları (görünürlük motorundaki normalizasyonun aynısı). */
function groupKeysOf(user) {
  const out = new Set();
  for (const g of Array.isArray(user && user.groups) ? user.groups : []) {
    const dn = String(g || '').trim().toLowerCase();
    if (!dn) continue;
    out.add(dn);
    const m = /^cn=([^,]+)/.exec(dn);
    if (m) out.add(m[1].trim().toLowerCase());
  }
  return out;
}

/** Uygulama bu kullanıcının ekibine mi ait? Sahip çözülmemişse (owner yok) HERKESE açık
 *  sayılır: "sahibi bilinmiyor" diye satırı gizlemek, planlanması gereken uygulamayı
 *  kimsenin görmediği bir kör noktaya iterdi. */
function ownedBy(app, keys) {
  const groups = (app.owner && app.owner.groups) || [];
  if (!groups.length) return null;                       // sahibi bilinmiyor
  return groups.some((g) => keys.has(String(g).trim().toLowerCase()));
}

async function loadTraffic(groups) {
  const { query } = require('../inventory/mssql.cjs');
  // Ortam sutununa GUVENMEYIZ: hangi degerlerin yazildigi tarama surumune gore degisiyor.
  // Bunun yerine trafik, tasima grubunun KENDI sunucularina gore suzulur - eski prod
  // sunuculari + yeni prod sunuculari. Boylece test trafigi prod sayisina karismaz.
  const hosts = new Set();
  for (const g of groups) {
    for (const h of [...(g.oldHosts || []), ...(g.newHosts || [])]) hosts.add(String(h).toUpperCase());
  }
  const out = new Map(); // SERVICE|LOCATION -> toplam
  try {
    const r = await query(
      `SELECT host, service, location, req_24h, req_7d, hc_24h, sampled, last_seen, error
         FROM ${TRAFFIC_TABLE}
        WHERE scan_date = (SELECT MAX(scan_date) FROM ${TRAFFIC_TABLE})`,
    );
    for (const x of r.recordset || []) {
      if (!hosts.has(String(x.host || '').toUpperCase())) continue;
      const k = `${String(x.service || '').toUpperCase()}|${String(x.location || '')}`;
      if (!out.has(k)) out.set(k, { req24: 0, req7: 0, hosts: 0, unknown: 0, sampled: false, lastSeen: null });
      const c = out.get(k);
      if (x.error) { c.unknown += 1; continue; }
      c.hosts += 1;
      c.req24 += Number(x.req_24h) || 0;
      c.req7 += Number(x.req_7d) || 0;
      if (x.sampled) c.sampled = true;
      const ls = x.last_seen ? String(x.last_seen) : null;
      if (ls && (!c.lastSeen || ls > c.lastSeen)) c.lastSeen = ls;
    }
  } catch {
    return null; // tablo yok -> ekran "olculemedi" gosterir, "yuk yok" DEMEZ
  }
  return out;
}

/** Uygulamanin tum location'larinin trafigi birlestirilir: biri bile yuk aliyorsa aktif. */
function trafficOfApp(app, traffic) {
  if (!traffic) return null;
  let req24 = 0; let req7 = 0; let seen = 0; let unknown = 0; let sampled = false; let lastSeen = null;
  for (const p of app.paths || []) {
    const c = traffic.get(`${String(p.service || '').toUpperCase()}|${String(p.location || '')}`);
    if (!c) { unknown += 1; continue; }
    if (c.hosts === 0) { unknown += 1; continue; }
    seen += 1;
    req24 += c.req24; req7 += c.req7;
    if (c.sampled) sampled = true;
    if (c.lastSeen && (!lastSeen || c.lastSeen > lastSeen)) lastSeen = c.lastSeen;
  }
  if (seen === 0) return { state: 'unknown', req24: null, req7: null, lastSeen: null, sampled: false, measuredPaths: 0, unknownPaths: unknown };
  return {
    state: req7 > 0 ? 'active' : (sampled ? 'unknown' : 'idle'),
    req24, req7, lastSeen, sampled, measuredPaths: seen, unknownPaths: unknown,
  };
}

function initSpaPlan(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const db = require('../db/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);

  try {
    const { requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisible('SpaPlan'));
  } catch { /* motor yoksa yoksay */ }

  const { createWarmCache } = require('../audit/warm-cache.cjs');
  const migrationWarm = createWarmCache({
    name: 'spa-plan-migration',
    ttlMs: 10 * 60 * 1000,
    compute: () => {
      const { queryLong: query, sql } = require('../inventory/mssql.cjs');
      const { loadMigration } = require('../audit/nginx-migration.cjs');
      // hasProxyColumns: Denetim'dekinin sadelestirilmis kopyasi degil, AYNI fonksiyon
      // (kolon yoksa proxy satirlari disarida kalir).
      const { hasProxyColumns } = require('../audit/denetim.cjs');
      return loadMigration({ query, sql, hasProxyColumns });
    },
  });

  router.get('/rows', async (req, res) => {
    const user = (req.session && req.session.user) || {};
    const isAdmin = String(user.role || '') === 'Admin';
    const keysOn = groupKeysOf(user);
    // BOS EKRAN TUZAGI (2026-09-26, uretimde gorulen): varsayilan "yalniz kendi ekibim"
    // idi. Yonetici hicbir uygulama ekibinin AD grubunda DEGILDIR; her satir elenip
    // sayfa bombos geliyordu. Ayni sey LDAP kapaliyken (grup listesi bos) HERKES icin
    // olurdu. Bu iki durumda varsayilan TUM EKIPLER; istemci acikca all=0 derse suzulur.
    const varsayilanTumu = isAdmin || keysOn.size === 0;
    const istek = String(req.query.all || '');
    const all = istek === '1' || (istek !== '0' && varsayilanTumu);
    try {
      const data = await migrationWarm.get({ fresh: req.query.fresh === '1' });
      if (!data || data.ok === false) {
        return res.status(503).json({ ok: false, message: data?.message || 'Taşıma verisi alınamadı.' });
      }
      const groups = data.groups || [];
      const traffic = await loadTraffic(groups);

      let tracking = new Map();
      try {
        const { rows } = await db.query(
          `SELECT group_id, namespace, application, state, planned_date, migrated_date, note,
                  in_use, in_use_by, in_use_at, updated_by, updated_at
             FROM nginx_migration_tracking`,
        );
        tracking = new Map(rows.map((r) => [`${r.group_id}|${r.namespace}|${r.application}`, r]));
      } catch (e) {
        console.warn('[spa-plan] takip satirlari okunamadi:', e.message);
      }

      const keys = keysOn;
      const d = (v) => (v ? String(v instanceof Date ? v.toISOString().slice(0, 10) : v).slice(0, 10) : null);
      const rows = [];
      let hiddenByOwner = 0;
      for (const g of groups) {
        for (const a of g.apps || []) {
          const mine = ownedBy(a, keys);
          // Varsayilan: kendi ekibinin uygulamalari. Sahibi bilinmeyenler de gosterilir
          // (mine === null) - planlanmasi gereken uygulama kimsenin gormedigi yere dusmesin.
          if (!all && mine === false) { hiddenByOwner += 1; continue; }
          const t = tracking.get(`${g.id}|${a.namespace}|${a.application}`) || null;
          rows.push({
            group: g.id,
            groupLabel: g.label,
            namespace: a.namespace,
            application: a.application,
            status: a.status,
            services: a.services || [],
            locations: a.locations || [],
            locationCount: a.locationCount || 0,
            owner: a.owner || null,
            mine,
            traffic: trafficOfApp(a, traffic),
            inUse: t && t.in_use ? String(t.in_use) : null,
            inUseBy: (t && t.in_use_by) || null,
            inUseAt: t && t.in_use_at ? new Date(t.in_use_at).toISOString() : null,
            plannedDate: d(t && t.planned_date),
            migratedDate: d(t && t.migrated_date),
            state: (t && t.state) || 'none',
            note: (t && t.note) || null,
            updatedBy: (t && t.updated_by) || null,
            updatedAt: t && t.updated_at ? new Date(t.updated_at).toISOString() : null,
          });
        }
      }
      res.json({
        ok: true,
        isAdmin,
        all,
        /** oturumdaki AD grup sayisi: 0 ise sahiplik suzgeci ANLAMSIZDIR */
        groupCount: keysOn.size,
        hiddenByOwner,
        ownersReady: data.ownersReady !== false,
        trafficReady: traffic !== null,
        scanDate: data.dirScanDate || data.proxyScanDate || null,
        groups: groups.map((g) => ({ id: g.id, label: g.label })),
        rows,
      });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // EKIP BEYANI. Yalnizca in_use + planned_date + note yazar; state'i 'migrated' YAPAMAZ.
  router.put('/declare', async (req, res) => {
    let t;
    try {
      t = normalizeDeclaration(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
    const user = (req.session && req.session.user) || {};
    const by = user.username || null;
    try {
      const ex = await db.query(
        `SELECT id, state FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
        [t.group, t.namespace, t.application],
      );
      // "Gecti" isareti taramayla dogrulanan bir olgu; ekip beyani onu GERI ALMAZ.
      const mevcut = ex.rows[0];
      const state = mevcut && mevcut.state === 'migrated'
        ? 'migrated'
        : (t.plannedDate ? 'planned' : (mevcut ? mevcut.state : 'none'));
      if (mevcut) {
        await db.query(
          `UPDATE nginx_migration_tracking
              SET in_use = $1, in_use_by = $2, in_use_at = GETUTCDATE(),
                  planned_date = $3, note = COALESCE($4, note), state = $5,
                  updated_by = $2, updated_at = GETUTCDATE()
            WHERE id = $6`,
          [t.inUse, by, t.plannedDate, t.note, state, mevcut.id],
        );
      } else {
        await db.query(
          `INSERT INTO nginx_migration_tracking
             (group_id, namespace, application, state, planned_date, note, in_use, in_use_by, in_use_at, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, GETUTCDATE(), $8, GETUTCDATE())`,
          [t.group, t.namespace, t.application, state, t.plannedDate, t.note, t.inUse, by],
        );
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/spa-plan', router);
  console.log('[SpaPlan] module mounted at /api/spa-plan');
}

module.exports = { initSpaPlan, normalizeDeclaration, ownedBy, trafficOfApp, groupKeysOf, IN_USE };
