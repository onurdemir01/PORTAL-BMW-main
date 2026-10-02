// server/spa-report/index.cjs — "Nginx ARK SPA Raporu" uclari.
//
// Kullanici (2026-09-28): tum servisler (Glomo / Webforms / Saklama / Geintdigital vb.)
// icin tek liste; kolonlar Ekip Beyani, Uygulama, Namespace, Ekip, Yuk Durumu, Location,
// Aciklama. "Buraya ekiplerin giris yapabilmesini istiyorum."
//
// KIM YAZABILIR: giris yapmis her kullanici — sayfa gorunurluk motorundan gecer, yani
// kimin gorecegini Admin > Sayfa Erisimi belirler. Beyan bir OLCUM DEGIL, ekibin kendi
// ifadesidir; kim/ne zaman yazdigi kaydedilir ve ekranda gorunur. Salt okunur bir rapor
// yapip beyani Admin'e birakmak, veriyi bilen kisiyi devre disi birakirdi.
//
// BEYAN IKI SEVIYELI (2026-10-01). Kullanici: "ayni uygulamaya tanimli 3 tane location
// bulunuyor. Birine kullanilmiyor dedigim zaman hepsine kullanilmiyor olarak
// isaretleniyor."
//
// Sebep: beyan nginx_migration_tracking.in_use alanindaydi ve o tablo UYGULAMA basina tek
// satir tutar (UNIQUE(group_id, namespace, application)) — location kirilimi oraya sigmaz.
// Artik location'a ozel beyanlar ayri tabloda (nginx_spa_location_in_use).
//
// EN OZEL OLAN KAZANIR: location beyani varsa o, yoksa SPA Tasimalari'ndaki UYGULAMA
// beyani DEVRALINIR (ekranda "devralindi" diye isaretlenir). Boylece "hangisi gecerli"
// sorusunun tek bir cevabi var ve iki ekran birbirini gormeye devam ediyor.
'use strict';

const express = require('express');
const crypto = require('node:crypto');
const db = require('../db/index.cjs');

const TTL_MS = 60 * 1000;
let _cache = { at: 0, value: null };

/**
 * Location beyaninin birincil anahtari.
 *
 * OZET KULLANILIR cunku (namespace, application, location_path) uzerindeki UNIQUE kisit
 * SQL Server'in 900 baytlik indeks anahtari sinirini asiyor (bkz. mssql-setup.cjs).
 */
const declKey = (ns, app, loc) =>
  crypto
    .createHash('sha256')
    .update(`${String(ns || '').trim()}\u0000${String(app || '').trim()}\u0000${String(loc || '').trim()}`)
    .digest('hex');

/**
 * Beyanlar: "ns/app" (uygulama seviyesi) + "ns/app\u0000loc" (location seviyesi).
 * group_id'den BAGIMSIZ, en yeni kazanir.
 */
async function loadBeyanlar() {
  const m = new Map();
  try {
    const r = await db.query(
      `SELECT namespace, application, in_use, in_use_by, in_use_at, note, updated_at
         FROM nginx_migration_tracking
        ORDER BY updated_at ASC`,
    );
    for (const x of r.rows || []) {
      const k = `${String(x.namespace || '').trim()}/${String(x.application || '').trim()}`;
      // ORDER BY updated_at ASC + uzerine yazma = EN YENI kazanir.
      m.set(k, {
        inUse: x.in_use == null ? null : String(x.in_use),
        inUseBy: x.in_use_by || null,
        // BEYAN TARIHI (2026-10-01): ekran "kim" yaninda "ne zaman"i da gostersin -
        // bir yil onceki beyan bugunku kadar guvenilir degildir.
        inUseAt: x.in_use_at || x.updated_at || null,
        note: x.note || '',
      });
    }
  } catch {
    /* tablo yoksa beyan sutunu bos kalir - rapor yine calisir */
  }
  // LOCATION BEYANLARI SONRA YUKLENIR ama AYRI anahtar alaninda durur: uygulama
  // beyaninin uzerine YAZMAZ, build.cjs ikisini ayri ayri sorar (once location).
  try {
    const r = await db.query(
      `SELECT namespace, application, location_path, in_use, in_use_by, in_use_at, note, updated_at
         FROM nginx_spa_location_in_use
        ORDER BY updated_at ASC`,
    );
    for (const x of r.rows || []) {
      const k = `${String(x.namespace || '').trim()}/${String(x.application || '').trim()}\u0000${String(x.location_path || '').trim()}`;
      m.set(k, {
        inUse: x.in_use == null ? null : String(x.in_use),
        inUseBy: x.in_use_by || null,
        inUseAt: x.in_use_at || x.updated_at || null,
        note: x.note || '',
      });
    }
  } catch {
    /* tablo henuz yoksa yalniz uygulama seviyesi beyan gorunur */
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
    // TARAMA YOKSA BOS LISTE DONMEYIZ: "hic SPA yok" ile "henuz taranmadi" ayri seyler.
    return { ok: true, notScanned: true, scanDate: null, rows: [], services: [], skipped: 0 };
  }

  const {
    SPA_TRAFIK_SEMA_SQL,
    spaTrafikSorgusu,
    spaTrafikIndeksi,
    spaTrafikDurumu,
    spaTrafikAnahtari,
  } = require('../audit/nginx-migration.cjs');

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
      // TRAFIK: first_seen kolonu yoksa NULL secilir (kolon adini yazmak sorguyu derleme
      // aninda dusururdu); host kipi satirlari ('@...') alinmaz. Bkz. nginx-migration.cjs.
      query(SPA_TRAFIK_SEMA_SQL)
        .then((r) => r.recordset?.[0] || {})
        .then((s) => (s.trf ? query(spaTrafikSorgusu(!!s.fs)).then((r) => r.recordset || []) : []))
        .catch(() => []),
    ]);
    return { spaSatirlari: a, trafikSatirlari: b };
  })();

  // YUK: Denetim > Nginx SPA ve Production Tasimalari ile AYNI kural (nginx-migration.cjs
  // spaTrafikDurumu). Olculemeyen bir location "yuk yok" DEGILDIR; 'idle' (emekli adayi
  // suzgeci) YALNIZ tanimin her sunucusu olculmus, sampled=0 ve olculen pencere >= 7 gun
  // iken verilir. Kisa pencerede durum 'unknown' + kismi=['pencere'] ("son N gunde istek
  // yok, 7 gun olculemedi").
  const trfIdx = spaTrafikIndeksi(trafikSatirlari, (x) =>
    spaTrafikAnahtari(x.service, x.env, x.location),
  );
  // TANIMIN SUNUCULARI: build.cjs satiri (U(service), U(env), T(location)) ile anahtarlar;
  // ayni normalizasyon burada da yapilir ki tanim sunuculari kaybolmasin.
  const nU = (s) =>
    String(s == null ? '' : s)
      .trim()
      .toUpperCase();
  const nT = (s) => String(s == null ? '' : s).trim();
  const tanimlar = new Map();
  for (const r of spaSatirlari) {
    const k = spaTrafikAnahtari(nU(r.service), nU(r.env), nT(r.location_path));
    if (!tanimlar.has(k)) tanimlar.set(k, []);
    tanimlar.get(k).push({ host: r.host, vhost: r.vhost });
  }
  const trafficOf = (service, env, location) => {
    const k = spaTrafikAnahtari(service, env, location);
    return spaTrafikDurumu(trfIdx, k, tanimlar.get(k));
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
    // Host kipi / kova satirlari "olcum var" SAYILMAZ (bu raporun tanimi location yolu).
    trafficReady: trfIdx.satir > 0,
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

  // BEYAN YAZMA: giris yapmis kullanici. Kim yazdi KAYDEDILIR - beyan bir olcum degil,
  // bir ifadedir; kimin soyledigi bilinmeden degeri olmaz.
  router.put('/declare', async (req, res) => {
    const ns = String(req.body?.namespace || '').trim();
    const app2 = String(req.body?.application || '').trim();
    const loc = String(req.body?.location || '').trim();
    const inUse = req.body?.inUse == null || req.body?.inUse === '' ? null : String(req.body.inUse);
    const note = String(req.body?.note || '').slice(0, 500);
    if (!ns || !app2)
      return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    if (inUse !== null && !BEYAN.has(inUse))
      return res.status(400).json({ ok: false, message: 'Geçersiz beyan.' });
    const user = require('../auth/utils.cjs').getRequestUser(req) || {};
    const by = user.username || null;

    // LOCATION VERILDIYSE BEYAN YALNIZ O LOCATION'A YAZILIR (2026-10-01). Eskiden her
    // beyan uygulama satirina gidiyordu; ayni uygulamanin uc location'i varsa birine
    // "kullanmiyor" demek ucune de yaziyordu — kullanicinin bildirdigi hata buydu.
    if (loc) {
      const key = declKey(ns, app2, loc);
      try {
        const ex = await db.query(
          `SELECT TOP 1 id FROM nginx_spa_location_in_use WHERE decl_key = $1`,
          [key],
        );
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_spa_location_in_use
                SET in_use = $2, in_use_by = $3, in_use_at = GETUTCDATE(), note = $4,
                    updated_by = $3, updated_at = GETUTCDATE()
              WHERE decl_key = $1`,
            [key, inUse, by, note],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_spa_location_in_use
               (decl_key, namespace, application, location_path, in_use, in_use_by, in_use_at, note, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, GETUTCDATE(), $7, $6)`,
            [key, ns, app2, loc, inUse, by, note],
          );
        }
        _cache = { at: 0, value: null };
        return res.json({ ok: true, inUse, inUseBy: by, note, scope: 'location' });
      } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
      }
    }

    // LOCATION YOKSA ESKI DAVRANIS: uygulama seviyesi beyan (SPA Tasimalari ile AYNI alan).
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
      res.json({ ok: true, inUse, inUseBy: by, note, scope: 'application' });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/spa-report', router);
  console.log('[ARK SPA] module mounted at /api/spa-report');
}

module.exports = { initSpaReport, loadReport, declKey };
