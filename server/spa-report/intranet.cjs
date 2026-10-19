// server/spa-report/intranet.cjs - Nginx ARK SPA > "Intranet SPA" (2026-10-19).
//
// Kullanici: "Simdi Intranet SPA'lere basliyorum, bunlar yuk aliyor mu almiyor mu kullaniliyor
// mu vb rapor gorebilmek istiyorum. Ve yine insanlardan kullanim durumu hakkinda bilgi girisi
// almak istiyorum." Ayni gun duzeltme: "Dynatrace metriklerinden cikarmamiz gerekiyordu." Kararlar
// (kullanici): liste = OpenShift'teki intranet SPA'lar, yuk = mevcut Dynatrace kullanim verisi.
//
// SATIR = Nginx Hub > Gercek SPA Kesfi'nin UYGULAMA satiri (namespace, uygulama), AYNI hesap
// (nginx-console/index.cjs spaKesfiPaylas): spa = 'evet' (route'un ardindaki pod'da nginx bulundu)
// ve ag = 'intranet' (route reencrypt) ya da 'karisik' (intranet + internet route'u birlikte).
// Ag kurali ve kanit spa-discovery.cjs'te; burada yeniden hesaplanmaz.
//
// YUK = DYNATRACE (dbo.BMW_Application_Usage, bmw_openshift_jobs/application_usage, gecelik):
// uygulamanin Dynatrace servislerinin istek sayisi, cluster'lar TOPLANIR (spa-discovery
// olcumIndeksi). Bes durum, hicbiri digerine indirgenmez:
//   var         olculen cluster'larda istek var
//   yok         HER cluster olculdu, istek 0
//   servis-yok  Dynatrace'te servis olusmamis - "istek yok" DEGIL (sayilamaz)
//   olculemedi  servis var ama olculemedi (ya da Dynatrace tablosu okunamadi)
//   olcum-yok   uygulama son 7 gunun kullanim verisinde hic yok
//
// EKIP BEYANI SPA Raporu ve SPA Tasimalari ile AYNI uygulama kaydina yazilir (index.cjs
// uygulamaBeyaniYaz): ayni uygulama icin TEK cevap. OLCUM ve BEYAN AYRI; celiski BILGIDIR.
//
// INTRANET SUNUCU KURULUMU (kullanici, ayni gun: "Intranet SPA sunucularina deployment tamamlanmis
// tamamlanmamis mi bu bilgiyi de gormek istiyorum"): dbo.Nginx_Intranet_Audit (nginx_config_audit
// dizin taramasi) - uygulamanin KENDI ortaminin intranet nginx sunucularinda (nginx-hosts
// INTRANET_HOSTS, envOfHost) /hysdeploy/<ns>/<app>, /usr/nginx/applications/<ns>/<app> ve
// application-confs/<app>-<ns>.conf var mi. Eslesme SPA Kesfi ile ayni: (ns, app) aynen; tutmazsa
// dizin satirinin '-prod' ekli ns'i ('ek-prod'). Durum:
//   tamam       ortamin TARANAN her intranet sunucusunda status OK (uc parca da var)
//   kismi       bazi sunucularda var / bazi parcalar eksik
//   yok         ortamin taranan sunucularinin HICBIRINDE izi yok
//   olculemedi  dizin tablosu okunamadi ya da ortamin intranet sunuculari o gun taranmadi
//   sunucu-yok  uygulamanin ortaminin intranet sunucusu yok (ortam bilinmiyor)
// Taranmayan sunucu "eksik" SAYILMAZ: ayrica listelenir.
'use strict';

const { intranetHosts, envOfHost, siteOfHost } = require('../audit/nginx-hosts.cjs');

const TTL_MS = 60 * 1000;
let _cache = { at: 0, value: null };
const onbellekSil = () => {
  _cache = { at: 0, value: null };
};

const T = (s) => String(s == null ? '' : s).trim();
const L = (s) => T(s).toLowerCase();
const U = (s) => T(s).toUpperCase();
const BEYAN = new Set(['yes', 'no', 'unknown']);
const INTRANET_AG = new Set(['intranet', 'karisik']);
const ENV_SIRA = ['DEV', 'TEST', 'EDU', 'QA', 'UAT', 'PREPROD', 'PROD'];
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Degerlendirme kodlari (ekran etikete cevirir): olcum ve beyan YAN YANA okunur, biri digerini ezmez. */
function degerlendir(r) {
  const d = [];
  if (r.istek === 'yok' && r.inUse === 'no') d.push('kapatma-adayi');
  else if (r.istek === 'yok' && !r.inUse) d.push('teyit-bekliyor');
  if (r.istek === 'var' && r.inUse === 'no') d.push('celiski');
  if (r.ag === 'karisik') d.push('internet-route-da-var');
  if (r.zayifKanit) d.push('zayif-kanit');
  if (r.eskiCluster.length) d.push('eski-veri');
  return d;
}

const bit = (v) => v === true || v === 1 || v === '1';

/** Dizin satirlari -> "ns|app" (ve '-prod' ekli ns) -> satirlar; taranan sunucular. Sayimlar
 *  yalniz uygulamanin ortaminin intranet sunuculariyla kesisir (kurulumHesapla). */
function dizinIndeksi(dirRows) {
  const kesin = new Map();
  const ekProd = new Map();
  const taranan = new Set();
  let tarih = '';
  const ekle = (m, k, r) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  };
  for (const r of dirRows || []) {
    const host = U(r.host);
    taranan.add(host);
    const g = T(r.scan_date).slice(0, 10);
    if (g > tarih) tarih = g;
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!ns || !app) continue;
    ekle(kesin, `${ns}|${app}`, r);
    if (!ns.endsWith('-prod')) ekle(ekProd, `${ns}-prod|${app}`, r);
  }
  return { kesin, ekProd, taranan, tarih };
}

/**
 * Uygulamanin KENDI ortaminin intranet sunucularindaki kurulum (bkz. dosya basi KURULUM).
 * @returns {{durum, tam, beklenen, sunucular, eksik, taranmayan, eslesme}}
 */
// Dizin okunamadiysa indeks bostur (buildIntranetRapor): hicbir sunucu taranmis sayilmaz ->
// 'olculemedi' ve beklenen sunucularin hepsi 'taranmayan'.
function kurulumHesapla(env, ns, app, idx, hosts) {
  const beklenenHost = hosts.filter((h) => envOfHost(h) === env);
  const bos = { tam: 0, beklenen: 0, sunucular: [], eksik: [], taranmayan: [], eslesme: '' };
  if (!beklenenHost.length) return { ...bos, durum: 'sunucu-yok' };
  const k = `${L(ns)}|${L(app)}`;
  let satirlar = (idx.kesin.get(k) || []).filter((r) => beklenenHost.includes(U(r.host)));
  let eslesme = satirlar.length ? 'kesin' : '';
  if (!satirlar.length) {
    satirlar = (idx.ekProd.get(k) || []).filter((r) => beklenenHost.includes(U(r.host)));
    if (satirlar.length) eslesme = 'ek-prod';
  }
  const taranan = beklenenHost.filter((h) => idx.taranan.has(h));
  const taranmayan = beklenenHost.filter((h) => !idx.taranan.has(h));
  const byHost = new Map(satirlar.map((r) => [U(r.host), r]));
  const sunucular = taranan.map((h) => {
    const r = byHost.get(h);
    return r
      ? { host: h, site: siteOfHost(h) || '', hys: bit(r.hys_deployed), app: bit(r.app_deployed), conf: bit(r.conf_exists), status: T(r.status) }
      : { host: h, site: siteOfHost(h) || '', hys: false, app: false, conf: false, status: 'YOK' };
  });
  const tam = sunucular.filter((s) => s.status === 'OK').length;
  const durum = !taranan.length
    ? 'olculemedi'
    : tam === taranan.length
      ? 'tamam'
      : satirlar.length
        ? 'kismi'
        : 'yok';
  return {
    durum,
    tam,
    beklenen: taranan.length,
    sunucular,
    eksik: sunucular.filter((s) => s.status !== 'OK').map((s) => s.host),
    taranmayan,
    eslesme,
  };
}

/**
 * SAF RAPOR KURUCU (veritabani yok).
 * @param {object}   p
 * @param {object[]} p.apps        Gercek SPA Kesfi uygulama satirlari (spa-discovery uygulamalar())
 * @param {Map}      p.ownersByNs  ns-owners indexOwners ciktisi
 * @param {Map}      p.beyanlar    index.cjs loadBeyanlar ciktisi ("ns/app" anahtarlari)
 * @param {object}   [p.coverage]  kesif kapsami (cluster durumlari)
 * @param {object[]|null} [p.dirRows] Nginx_Intranet_Audit son gun (intranet sunuculari)
 * @param {'var'|'okunamadi'} [p.dizinDurum]
 * @param {string[]} [p.hosts]     intranet sunuculari (varsayilan nginx-hosts listesi)
 */
function buildIntranetRapor({ apps, ownersByNs, beyanlar, coverage, dirRows, dizinDurum = 'var', hosts }) {
  const sunucuListesi = (hosts || intranetHosts()).map(U);
  const dIdx = dizinIndeksi(dizinDurum === 'var' ? dirRows : []);
  const { ownersFor } = require('../audit/ns-owners.cjs');
  // UYGULAMA BEYANI (location'siz anahtar); harf duyarsiz, en yeni kazanir (Map sirasi).
  const beyan = new Map();
  for (const [k, v] of beyanlar || []) if (!String(k).includes('\u0000')) beyan.set(L(k), v);

  const rows = (apps || [])
    .filter((a) => a.spa === 'evet' && INTRANET_AG.has(a.ag))
    .map((a) => {
      const ns = T(a.namespace);
      const app = T(a.application);
      const b = beyan.get(`${L(ns)}/${L(app)}`) || null;
      const o = ownersFor(ownersByNs || new Map(), [ns]);
      const u = a.usage || null;
      const r = {
        env: a.env ? U(a.env) : 'BILINMIYOR',
        namespace: ns,
        application: app,
        ag: a.ag,
        // Route adresleri (kullanicinin uygulamayi tanidigi ad) ve cluster'lar.
        adresler: [...(a.hosts || [])],
        clusters: [...(a.clusters || [])],
        eskiCluster: [...(a.staleClusters || [])],
        kapsam: { durum: a.kapsamDurum || 'olculemedi', var: a.kapsamVar || 0, toplam: a.kapsamToplam || 0 },
        zayifKanit: !!a.weakEvidence,
        adKalibi: a.pattern === 'uyuyor',
        istek: a.istek || 'olcum-yok',
        // SAYI YALNIZ OLCULDUYSE (reqShown null = olculemedi / olcum yok).
        req: a.reqShown == null ? null : Number(a.reqShown),
        dynatrace: u
          ? {
              scanDate: u.scanDate || null,
              windowDays: u.windowDays || null,
              services: u.services == null ? null : Number(u.services),
              note: u.note || '',
              olcum: u.olcum || '',
            }
          : null,
        ekip: o.groups,
        ekipEposta: o.emails,
        inUse: b && b.inUse && BEYAN.has(b.inUse) ? b.inUse : null,
        inUseBy: (b && b.inUseBy) || null,
        inUseAt: b ? iso(b.inUseAt) : null,
        note: (b && b.note) || '',
      };
      r.kurulum = kurulumHesapla(r.env, ns, app, dIdx, sunucuListesi);
      r.degerlendirme = degerlendir(r);
      return r;
    });
  // Bilinmeyen ortam EN SONDA (namespace ortam eki tasimiyor).
  const sira = (e) => (ENV_SIRA.includes(e) ? ENV_SIRA.indexOf(e) : ENV_SIRA.length);
  rows.sort(
    (a, b) =>
      sira(a.env) - sira(b.env) ||
      a.application.localeCompare(b.application) ||
      a.namespace.localeCompare(b.namespace),
  );
  const envler = [...new Set(rows.map((r) => r.env))].sort((a, b) => sira(a) - sira(b) || a.localeCompare(b));
  const envs = envler.map((env) => {
    const rs = rows.filter((r) => r.env === env);
    const say = (f) => rs.filter(f).length;
    return {
      env,
      uygulama: rs.length,
      var: say((r) => r.istek === 'var'),
      yok: say((r) => r.istek === 'yok'),
      servisYok: say((r) => r.istek === 'servis-yok'),
      olculemedi: say((r) => r.istek === 'olculemedi'),
      olcumYok: say((r) => r.istek === 'olcum-yok'),
      beyanli: say((r) => !!r.inUse),
      kapatmaAdayi: say((r) => r.degerlendirme.includes('kapatma-adayi')),
      celiski: say((r) => r.degerlendirme.includes('celiski')),
      kurulumTamam: say((r) => r.kurulum.durum === 'tamam'),
      kurulumKismi: say((r) => r.kurulum.durum === 'kismi'),
      kurulumYok: say((r) => r.kurulum.durum === 'yok'),
    };
  });
  // Dynatrace verisinin gunu: satirlardaki en yeni olcum.
  let dynatraceTarihi = '';
  for (const r of rows) {
    const g = (r.dynatrace && r.dynatrace.scanDate) || '';
    if (g > dynatraceTarihi) dynatraceTarihi = g;
  }
  // Taranamayan / eski verili cluster'lar: o cluster'daki intranet SPA'lar listede eksik ya da eski.
  const sorunluCluster = ((coverage && coverage.clusters) || [])
    .filter((c) => c.stale || c.bucket === 'taranamadi')
    .map((c) => ({ cluster: c.cluster, durum: c.status, sebep: c.reason || '' }));
  return {
    rows,
    envs,
    dynatraceTarihi: dynatraceTarihi || null,
    sorunluCluster,
    dizinDurum,
    dizinTarihi: dIdx.tarih || null,
    // Son dizin taramasinda satiri olmayan intranet sunuculari: oradaki kurulum OLCULEMEDI.
    taranmayanSunucu: dizinDurum === 'var' ? sunucuListesi.filter((h) => !dIdx.taranan.has(h)) : sunucuListesi,
  };
}

/** Gercek SPA Kesfi hesabi + ekip sahipleri (TBMWANS) + beyanlar (Portal DB). */
async function loadIntranet(fresh, deps) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) return { ..._cache.value, cached: true };
  const kesif = deps.spaKesfi || require('../nginx-console/index.cjs').spaKesfiPaylas;
  const sonuc = await kesif();
  if (!sonuc || sonuc.tableMissing) {
    // KESIF TABLOSU YOKSA BOS LISTE "hic intranet SPA yok" DEGIL: ekran bunu ayri soyler.
    return { ok: true, notScanned: true, message: (sonuc && sonuc.message) || '', rows: [], envs: [], sorunluCluster: [] };
  }
  const { query } = deps.mssql || require('../inventory/mssql.cjs');
  const { loadNamespaceOwners } = require('../audit/ns-owners.cjs');
  const owners = await loadNamespaceOwners(query).catch(() => ({ ready: false, byNs: new Map() }));
  const beyanlar = await deps.loadBeyanlar();
  // INTRANET SUNUCU KURULUMU: dizin taramasinin son gunu, yalniz intranet sunuculari. Okunamazsa
  // kurulum sutunu 'olculemedi' (bos liste "kurulu degil" diye OKUNMAZ).
  const { sql } = deps.mssql || require('../inventory/mssql.cjs');
  const hosts = intranetHosts();
  const dirRows = await query(
    `SELECT host, namespace, application, hys_deployed, app_deployed, conf_exists, status,
            CONVERT(varchar(10), scan_date, 23) AS scan_date
       FROM dbo.Nginx_Intranet_Audit
      WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)
        AND host IN (${hosts.map((_, i) => `@h${i}`).join(', ')})`,
    hosts.map((h, i) => ({ name: `h${i}`, type: sql.NVarChar(64), value: h })),
  )
    .then((r) => r.recordset || [])
    .catch(() => null);
  const value = {
    ok: true,
    notScanned: false,
    kesifTarihi: sonuc.scanDate || null,
    hesaplandi: sonuc.hesaplandi || null,
    ownersReady: owners.ready !== false,
    // Dynatrace tablosu okunamadiysa HER satir 'olculemedi' (spa-discovery); ekran bandi soyler.
    dynatraceOkunamadi: !!(sonuc.rpKapsam && sonuc.rpKapsam.dynatraceOkunamadi),
    ...buildIntranetRapor({
      apps: sonuc.apps,
      ownersByNs: owners.byNs,
      beyanlar,
      coverage: sonuc.coverage,
      dirRows,
      dizinDurum: dirRows == null ? 'okunamadi' : 'var',
      hosts,
    }),
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

  // BEYAN: giris yapmis (ve sayfayi gorebilen) herkes. Kim yazdi OTURUMDAN kaydedilir ve gorunur -
  // beyan bir olcum degil bir ifadedir (SPA Raporu ile ayni kural).
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

module.exports = { mountIntranet, buildIntranetRapor, degerlendir, loadIntranet, onbellekSil };
