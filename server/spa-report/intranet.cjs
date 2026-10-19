// server/spa-report/intranet.cjs - Nginx ARK SPA > "Intranet SPA" (2026-10-19).
//
// Kullanici: "Simdi Intranet SPA'lere basliyorum, bunlar yuk aliyor mu almiyor mu kullaniliyor
// mu vb rapor gorebilmek istiyorum. Ve yine insanlardan kullanim durumu hakkinda bilgi girisi
// almak istiyorum. Nginx ARK SPA sayfasi altinda gosterebilir miyiz?"
//
// SATIR = (ortam, namespace, uygulama). Kaynaklar (hepsi mevcut tablolar, yeni tablo YOK):
//   dbo.Nginx_Intranet_Audit   intranet sunucularindaki dizin kurulumu (hysdeploy / applications /
//                              application-confs), sunucu basina; in_ocp_inventory
//   dbo.Nginx_Spa_Traffic      HOST KIPI olcum: uygulama basina vhost (<app>-<ns>.conf) ortak
//                              log'da Host/SNI ile sayilir (nginx_spa_traffic.sh, 2026-10-02)
//   dbo.Openshift_Namespace_Owners  ekip + e-posta
//   nginx_migration_tracking   EKIP BEYANI - SPA Raporu ve SPA Tasimalari ile AYNI uygulama alani
//                              (index.cjs uygulamaBeyaniYaz): ayni uygulama icin TEK cevap
//
// YUK KURALI SPA Kesfi ile AYNI (nginx-console/spa-rp.cjs trafikIndeksi / dizinTrafigi /
// dizinAdaylari): "olculemedi" ile "yuk almiyor" ASLA karismaz. Uygulamanin yuku, conf'u olan
// (nginx'in gercekten sundugu) sunuculardan birlesir; mirror sayilari TOPLANIR. 'idle' YALNIZ her
// sunucu olculmus, pencere >= 7 gun, sampled=0 ve hicbir sunucuda atanamayan istek yokken.
//
// OLCUM ve BEYAN AYRI: biri digerini ezmez; celiski (yuk var ama "kullanmiyor") BILGIDIR ve
// "degerlendirme" kodu olarak gosterilir.
'use strict';

const { intranetHosts, envOfHost, siteOfHost, orderEnvs } = require('../audit/nginx-hosts.cjs');
const { trafikIndeksi, dizinTrafigi, dizinAdaylari } = require('../nginx-console/spa-rp.cjs');

const TTL_MS = 60 * 1000;
let _cache = { at: 0, value: null };
const onbellekSil = () => {
  _cache = { at: 0, value: null };
};

const T = (s) => String(s == null ? '' : s).trim();
const L = (s) => T(s).toLowerCase();
const U = (s) => T(s).toUpperCase();
const bit = (v) => v === true || v === 1 || v === '1';
const enBuyuk = (a, b) => (!a ? b || null : !b ? a : b > a ? b : a);
const BEYAN = new Set(['yes', 'no', 'unknown']);
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Sunucu basina olcumleri (dizinTrafigi sonuclari) uygulama yukune birlestirir. Bicim
 * SpaYukOlcumu (Denetim / SPA Raporu / Tasimalar ile ayni) - ekran ortak metinleri kullanir.
 *   null      hicbir sunucuda olcum kaynagi yok (host kipi hic uretilmedi) ya da uygulama hicbir
 *             sunucuda sunulmuyor (conf yok) - "yuk almiyor" DEGIL
 *   active    en az bir sunucuda 7 gunde istek var (hc haric)
 *   idle      sunulan HER sunucu olculdu, hepsi tam pencere ve kesin 0
 *   unknown   gerisi; kismi nedenleriyle
 */
function yukBirlestir(sunucular) {
  const sunulan = sunucular.filter((s) => s.conf);
  if (!sunulan.length || sunulan.every((s) => s.trafik == null)) return null;
  let req7 = 0;
  let req24 = 0;
  let hc24 = 0;
  let hosts = 0;
  let unknownHosts = 0;
  let missingHosts = 0;
  let sampled = false;
  let lastSeen = null;
  let firstSeen = null;
  let pencereSaat;
  const kismi = new Set();
  for (const s of sunulan) {
    const t = s.trafik;
    if (!t) {
      missingHosts += 1;
      kismi.add('satirsiz-sunucu');
      continue;
    }
    if (t.durum === 'olculemedi') {
      if (t.neden === 'log' || t.neden === 'tablo-yok' || t.neden === 'okunamadi') {
        unknownHosts += 1;
        kismi.add('okunamayan-sunucu');
      } else if (t.neden === 'belirsiz') {
        unknownHosts += 1;
        kismi.add('belirsiz-vhost');
      } else {
        missingHosts += 1;
        kismi.add('satirsiz-sunucu');
      }
      continue;
    }
    hosts += 1;
    req7 += t.req7 || 0;
    req24 += t.req24 || 0;
    hc24 += t.hc24 || 0;
    sampled = sampled || !!t.sampled;
    lastSeen = enBuyuk(lastSeen, t.son);
    // EN DAR pencere: mirror'lardan en gec baslayan (en yeni first_seen) olcumu sinirlar.
    firstSeen = enBuyuk(firstSeen, t.ilk);
    pencereSaat =
      pencereSaat === undefined
        ? t.pencereSa
        : pencereSaat == null || t.pencereSa == null
          ? null
          : Math.min(pencereSaat, t.pencereSa);
    for (const k of t.kismi || []) {
      if (k === 'pencere') kismi.add(t.pencereSa == null ? 'pencere-bilinmiyor' : 'pencere');
      else kismi.add(k);
    }
  }
  // Olculemeyen / satirsiz her sunucu bir kismi nedeni ekler: 'idle' = olculen var ve HICBIR neden yok.
  const state = req7 > 0 ? 'active' : hosts > 0 && !kismi.size ? 'idle' : 'unknown';
  const o = {
    state,
    req7: hosts ? req7 : null,
    req24: hosts ? req24 : null,
    hc24: hosts ? hc24 : null,
    lastSeen,
    firstSeen,
    pencereSaat: pencereSaat === undefined ? null : pencereSaat,
    sampled,
    hosts,
    unknownHosts,
    missingHosts,
  };
  if (state === 'unknown') o.kismi = [...kismi];
  return o;
}

/** Degerlendirme kodlari (ekran etikete cevirir). Olcum ve beyan AYRI kalir; kod ikisini YAN YANA okur. */
function degerlendir(r) {
  const d = [];
  const st = r.yuk ? r.yuk.state : null;
  if (st === 'idle' && r.inUse === 'no') d.push('kapatma-adayi');
  else if (st === 'idle' && !r.inUse) d.push('teyit-bekliyor');
  if (st === 'active' && r.inUse === 'no') d.push('celiski');
  if (r.ocpVar === false) d.push('ocp-yok');
  if (r.sunulan === 0) d.push('sunulmuyor');
  else if (r.kurulum === 'kismi') d.push('kurulum-eksik');
  return d;
}

/**
 * SAF RAPOR KURUCU (veritabani yok).
 * @param {object}   p
 * @param {object[]} p.dirRows      Nginx_Intranet_Audit (son gun, intranet sunuculari)
 * @param {object[]|null} p.trafficRows Nginx_Spa_Traffic (son gun, intranet sunuculari)
 * @param {'var'|'yok'|'okunamadi'} p.trafikTablo
 * @param {Map}      p.ownersByNs   ns-owners indexOwners ciktisi
 * @param {Map}      p.beyanlar     index.cjs loadBeyanlar ciktisi ("ns/app" anahtarlari)
 * @param {string[]} [p.hosts]      intranet sunuculari (varsayilan nginx-hosts listesi)
 */
function buildIntranetRapor({ dirRows, trafficRows, trafikTablo, ownersByNs, beyanlar, hosts }) {
  const { ownersFor } = require('../audit/ns-owners.cjs');
  const liste = (hosts || intranetHosts()).map(U);
  const intranet = new Set(liste);
  const idx = trafikIndeksi(trafikTablo === 'var' ? trafficRows || [] : []);
  // UYGULAMA BEYANI (location'siz anahtar); harf duyarsiz eslesir, en yeni kazanir (Map sirasi).
  const beyan = new Map();
  for (const [k, v] of beyanlar || []) if (!String(k).includes('\u0000')) beyan.set(L(k), v);

  const satirlar = (dirRows || []).filter((r) => intranet.has(U(r.host)) && T(r.namespace) && T(r.application));
  // Taranan sunucular: o gunun dizin taramasinda satiri olanlar. Beklenen kurulum yalniz
  // TARANAN sunuculara gore hesaplanir - taranmamis sunucu "eksik" DEGIL, olculemedi.
  const taranan = new Set(satirlar.map((r) => U(r.host)));
  const dizinSahip = new Map();
  for (const r of satirlar) {
    if (!bit(r.conf_exists)) continue;
    const k = `${U(r.host)}|${U(`${L(r.application)}-${L(r.namespace)}`)}`;
    if (!dizinSahip.has(k)) dizinSahip.set(k, new Set());
    dizinSahip.get(k).add(`${L(r.namespace)}|${L(r.application)}`);
  }

  const gruplar = new Map(); // "ENV|ns|app" -> satir
  let dizinTarihi = '';
  for (const r of satirlar) {
    const host = U(r.host);
    const env = envOfHost(host);
    const ns = L(r.namespace);
    const app = L(r.application);
    const g = T(r.scan_date).slice(0, 10);
    if (g > dizinTarihi) dizinTarihi = g;
    const k = `${env}|${ns}|${app}`;
    if (!gruplar.has(k)) gruplar.set(k, { env, namespace: ns, application: app, sunucular: [], ocp: [] });
    const x = gruplar.get(k);
    const conf = bit(r.conf_exists);
    let trafik = null;
    let belirsiz = false;
    // OLCUM TABLOSU YOK / OKUNAMADI: yuk "olcum yok" (null) - ekran sebebini bantta soyler.
    if (conf && trafikTablo === 'var') {
      const a = dizinAdaylari(host, ns, app, r.conf_name, dizinSahip);
      belirsiz = a.belirsiz;
      // Ayni conf.d adina iki uygulama dusuyorsa istek bu uygulamaya AYRILAMAZ: olculemedi.
      trafik = belirsiz
        ? { durum: 'olculemedi', neden: 'belirsiz' }
        : dizinTrafigi(host, a.adaylar, trafikTablo, idx);
    }
    x.sunucular.push({
      host,
      site: siteOfHost(host) || '',
      hys: bit(r.hys_deployed),
      app: bit(r.app_deployed),
      conf,
      status: T(r.status) || '',
      confName: T(r.conf_name),
      trafik,
    });
    x.ocp.push(bit(r.in_ocp_inventory));
  }

  const rows = [...gruplar.values()].map((x) => {
    const beklenen = liste.filter((h) => envOfHost(h) === x.env && taranan.has(h));
    const bulunan = new Set(x.sunucular.map((s) => s.host));
    const sunulan = x.sunucular.filter((s) => s.conf).length;
    const tam = x.sunucular.filter((s) => s.status === 'OK').length;
    const b = beyan.get(`${x.namespace}/${x.application}`) || null;
    const o = ownersFor(ownersByNs || new Map(), [x.namespace]);
    const r = {
      env: x.env,
      namespace: x.namespace,
      application: x.application,
      ekip: o.groups,
      ekipEposta: o.emails,
      sunucular: x.sunucular.sort((a, c) => a.host.localeCompare(c.host)),
      // Ayni ortamin TARANAN intranet sunucularindan bu uygulamanin HIC olmadigi sunucular.
      eksikSunucular: beklenen.filter((h) => !bulunan.has(h)),
      beklenen: beklenen.length,
      tamSunucu: tam,
      sunulan,
      kurulum: tam === beklenen.length && tam > 0 ? 'tam' : 'kismi',
      // OpenShift envanteri: herhangi bir sunucu satiri "var" diyorsa var; hepsi "yok"sa yok.
      ocpVar: x.ocp.some(Boolean) ? true : x.ocp.length ? false : null,
      yuk: yukBirlestir(x.sunucular),
      inUse: b && b.inUse && BEYAN.has(b.inUse) ? b.inUse : null,
      inUseBy: (b && b.inUseBy) || null,
      inUseAt: b ? iso(b.inUseAt) : null,
      note: (b && b.note) || '',
    };
    r.degerlendirme = degerlendir(r);
    return r;
  });
  const envSira = orderEnvs(new Set(rows.map((r) => r.env)));
  rows.sort(
    (a, b) =>
      envSira.indexOf(a.env) - envSira.indexOf(b.env) ||
      a.application.localeCompare(b.application) ||
      a.namespace.localeCompare(b.namespace),
  );

  const envs = envSira.map((env) => {
    const rs = rows.filter((r) => r.env === env);
    const say = (f) => rs.filter(f).length;
    return {
      env,
      sunucular: liste.filter((h) => envOfHost(h) === env),
      taranan: liste.filter((h) => envOfHost(h) === env && taranan.has(h)),
      uygulama: rs.length,
      active: say((r) => r.yuk && r.yuk.state === 'active'),
      idle: say((r) => r.yuk && r.yuk.state === 'idle'),
      unknown: say((r) => r.yuk && r.yuk.state === 'unknown'),
      olcumYok: say((r) => !r.yuk),
      beyanli: say((r) => !!r.inUse),
      kapatmaAdayi: say((r) => r.degerlendirme.includes('kapatma-adayi')),
      celiski: say((r) => r.degerlendirme.includes('celiski')),
    };
  });

  return {
    rows,
    envs,
    dizinTarihi: dizinTarihi || null,
    trafikTarihi: idx.tarih || null,
    trafikTablo,
    // Host kipi hic uretilmediyse (eski betik / SPA_HOST_MODE kapali) yuk sutunu "olcum yok".
    hostKipi: idx.hostKipi > 0,
    taranmayan: liste.filter((h) => !taranan.has(h)),
  };
}

/** Veritabanindan okur (TBMWANS: dizin + trafik + sahipler; Portal DB: beyan). */
async function loadIntranet(fresh, { loadBeyanlar, mssql }) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) return { ..._cache.value, cached: true };
  const { query, sql } = mssql || require('../inventory/mssql.cjs');
  const { SPA_TRAFIK_SEMA_SQL } = require('../audit/nginx-migration.cjs');
  const { loadNamespaceOwners } = require('../audit/ns-owners.cjs');
  const hosts = intranetHosts();
  const hostIn = hosts.map((_, i) => `@h${i}`).join(', ');
  const hostParams = hosts.map((h, i) => ({ name: `h${i}`, type: sql.NVarChar(64), value: h }));

  const [dirRows, sema] = await Promise.all([
    query(
      `SELECT host, namespace, application, hys_deployed, app_deployed, conf_exists, conf_name,
              in_ocp_inventory, status, CONVERT(varchar(10), scan_date, 23) AS scan_date
         FROM dbo.Nginx_Intranet_Audit
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)
          AND host IN (${hostIn})`,
      hostParams,
    )
      .then((r) => r.recordset || [])
      .catch(() => null),
    query(SPA_TRAFIK_SEMA_SQL)
      .then((r) => r.recordset?.[0] || {})
      .catch(() => null),
  ]);
  if (dirRows == null) return { ok: false, message: 'Intranet dizin taraması (Nginx_Intranet_Audit) okunamadı.' };
  if (!dirRows.length) {
    // TARAMA YOKSA BOS LISTE "hic SPA yok" DEGIL: ekran bunu ayri soyler.
    return { ok: true, notScanned: true, rows: [], envs: [], hostKipi: false, taranmayan: hosts };
  }
  let trafikTablo = 'okunamadi';
  let trafficRows = null;
  if (sema && !sema.trf) trafikTablo = 'yok';
  else if (sema && sema.trf) {
    trafficRows = await query(
      `SELECT host, vhost, location, req_24h, req_7d, hc_24h, sampled, last_seen, error,
              ${sema.fs ? 'first_seen' : 'CAST(NULL AS NVARCHAR(20)) AS first_seen'},
              CONVERT(varchar(10), scan_date, 23) AS scan_date
         FROM dbo.Nginx_Spa_Traffic
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Spa_Traffic)
          AND host IN (${hostIn})`,
      hostParams,
    )
      .then((r) => r.recordset || [])
      .catch(() => null);
    trafikTablo = trafficRows == null ? 'okunamadi' : 'var';
  }
  const owners = await loadNamespaceOwners(query).catch(() => ({ ready: false, byNs: new Map() }));
  const beyanlar = await loadBeyanlar();
  const value = {
    ok: true,
    notScanned: false,
    ownersReady: owners.ready !== false,
    ...buildIntranetRapor({ dirRows, trafficRows, trafikTablo, ownersByNs: owners.byNs, beyanlar, hosts }),
  };
  _cache = { at: Date.now(), value };
  return { ...value, cached: false };
}

function mountIntranet(router, deps) {
  router.get('/intranet', async (req, res) => {
    try {
      res.json(await loadIntranet(String(req.query.fresh || '') === '1', deps));
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // BEYAN: giris yapmis (ve sayfayi gorebilen) herkes. Kim yazdi KAYDEDILIR ve gorunur - beyan bir
  // olcum degil bir ifadedir (SPA Raporu ile ayni kural). Uygulama seviyesi: SPA Raporu ve SPA
  // Tasimalari ayni cevabi gorur.
  router.put('/intranet/declare', async (req, res) => {
    const ns = T(req.body?.namespace);
    const app = T(req.body?.application);
    const inUse = req.body?.inUse == null || req.body.inUse === '' ? null : T(req.body.inUse);
    const note = String(req.body?.note || '').slice(0, 500);
    if (!ns || !app) return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    if (inUse !== null && !BEYAN.has(inUse)) return res.status(400).json({ ok: false, message: 'Geçersiz beyan.' });
    const user = require('../auth/utils.cjs').getRequestUser(req) || {};
    const by = user.username || null;
    try {
      await deps.uygulamaBeyaniYaz({ namespace: ns, application: app, inUse, note, by });
      onbellekSil();
      res.json({ ok: true, inUse, inUseBy: by, inUseAt: new Date().toISOString(), note });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { mountIntranet, buildIntranetRapor, yukBirlestir, degerlendir, loadIntranet, onbellekSil };
