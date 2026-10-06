// server/nginx-console/__tests__/spa-rp.test.cjs - Gercek SPA Kesfi: Ag / Reverse proxy /
// RP istegi kolonlari (kullanici, 2026-10-01).
//
// "Ayni tabloda uygulamanin istek alip almadigi, intranet mi internet mi, internet ise BIZIM
// reverse proxy sunucularimizda tanimli mi ve RP tanimi istek aliyor mu - hepsi tek yerde."
//
// KESIN KURAL bu bekcilerin konusu: "olculemedi" ile "yok/tanimsiz" ASLA karismaz.
// Testler DAVRANIS uzerinden: buildSpaDiscovery'ye ham tablo satirlari verilir, uygulama
// satirindaki kodlara bakilir. DB gerektirmez; platformdan bagimsiz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildSpaDiscovery,
  agKarari,
  spaYanitGovdesi,
  YANIT_VARSAYILAN,
  YANIT_BOS_DIZI,
} = require('../spa-discovery.cjs');
const { rpTanimlari, normLoc, pencereSaat, KODLAR } = require('../spa-rp.cjs');
const { internetRpHosts, _INTRANET_HOSTS } = require('../../audit/nginx-hosts.cjs');
const { MIGRATION_GROUPS } = require('../../audit/nginx-migration.cjs');
const { normalize } = require('../../util/guard-text.cjs');

const KOK = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');

const RP = internetRpHosts();
const PROD_ALL = RP.byEnv.PROD;
const GUN = '2026-10-01';

// ── FIXTURE ────────────────────────────────────────────────────────────────────────────
const D = (o) => ({
  cluster: 'gbocptest1',
  namespace: 'kart-test',
  route: 'r',
  host: '',
  termination: 'passthrough',
  workload_kind: 'Deployment',
  workload: 'app',
  is_spa: 1,
  signal: 'image',
  image: '',
  note: '',
  match_by: 'selector',
  scan_date: GUN,
  ...o,
});
/** Kurumsal adresli uygulama route'u: <app>-<ns>.apps(-t).fw.garanti.com.tr */
const A = (app, ns, o = {}) => {
  const prod = ns.endsWith('-prod');
  return D({
    route: app,
    workload: app,
    namespace: ns,
    host: `${app}-${ns}.${prod ? 'apps' : 'apps-t'}.fw.garanti.com.tr`,
    cluster: prod ? 'gbocpprod1' : 'gbocptest1',
    ...o,
  });
};
/** Nginx_Config_Audit LOC satiri (include -> application-confs). */
const LOC = (host, ns, app, o = {}) => ({
  host,
  vhost: 'KART-TEST',
  service: 'KART',
  env: 'TEST',
  location_path: `/${app}/`,
  application: app,
  namespace: ns,
  status: 'OK',
  kind: 'spa',
  upstream_name: null,
  target_url: null,
  scan_date: GUN,
  ...o,
});
/** Nginx_Config_Audit PRX satiri: analyzer target_url'e proxy_ssl_name yoksa upstream'i yazar
 *  ve application'a ilk DNS etiketinin TAHMININI koyar, namespace NULL. */
const PRX = (host, upstream, o = {}) => ({
  host,
  vhost: 'GLOMO-PROD',
  service: 'GLOMO',
  env: 'PROD',
  location_path: '/x/',
  application: String(upstream).split('.')[0],
  namespace: null,
  status: 'OK',
  kind: 'proxy',
  upstream_name: upstream,
  target_url: upstream,
  scan_date: GUN,
  ...o,
});
/** Host'un o gun TARANDIGINI gosteren, hicbir kesif uygulamasina baglanmayan satir. */
const IZ = (host) => LOC(host, 'iz-yok-test', 'iz', { vhost: 'IZ-X', location_path: '/iz/' });
/** Nginx_Spa_Traffic LOAD satiri. */
const TRF = (host, vhost, location, o = {}) => ({
  host,
  vhost,
  location,
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: '20260901000000',
  scan_date: GUN,
  ...o,
});
/** LOADERR satiri ANALYZER'IN YAZDIGI GIBI: service/env/location NULL (yalniz host, vhost). */
const LOADERR = (host, vhost, msg) => ({
  host,
  vhost,
  service: null,
  env: null,
  location: null,
  req_24h: null,
  req_7d: null,
  hc_24h: null,
  sampled: 0,
  last_seen: null,
  error: msg,
  first_seen: null,
  scan_date: GUN,
});
/** RP kaynaklari: varsayilan dort tablo da okundu (bos). `tablolar` yalniz farki yazar. */
const K = (o = {}) => {
  const { tablolar, ...rest } = o;
  return {
    prxKolon: 4,
    cfg: [],
    dir: [],
    ups: [],
    trf: [],
    ...rest,
    tablolar: { cfg: 'var', dir: 'var', trf: 'var', ups: 'var', ...(tablolar || {}) },
  };
};
/** Fixture'larda URETILEN kodlar (SR35: sozluk bekcisi - her kod listede ve ekranda). */
const GORULEN = {
  rp: new Set(),
  rpIstek: new Set(),
  rpNeden: new Set(),
  rpIstekNeden: new Set(),
  rpEsles: new Set(),
  trafikNeden: new Set(),
};
const topla = (r) => {
  for (const a of r.apps) {
    GORULEN.rp.add(a.rp);
    GORULEN.rpIstek.add(a.rpIstek);
    if (a.rpNeden) GORULEN.rpNeden.add(a.rpNeden.split(':')[0]);
    for (const n of a.rpIstekNeden || []) GORULEN.rpIstekNeden.add(n);
    if (a.rpEsles) GORULEN.rpEsles.add(a.rpEsles);
  }
  // Ayrinti paneli: tanim basina trafik 'olculemedi' nedeni (TRAFIK_NEDEN sozlugu).
  for (const m of (r.rpDetay || new Map()).values())
    for (const d of m.values()) if (d.trafik && d.trafik.neden) GORULEN.trafikNeden.add(d.trafik.neden);
  return r;
};
const run = (disc, kaynak, { inv = [], use = [], runs = [], katalog } = {}) =>
  topla(buildSpaDiscovery(disc, inv, use, runs, kaynak, katalog));
const by = (r) => Object.fromEntries(r.apps.map((a) => [a.application, a]));
/** Ayni adli uygulamalar farkli namespace'lerde: 'ns/app' anahtari. */
const byNs = (r) => Object.fromEntries(r.apps.map((a) => [`${a.namespace}/${a.application}`, a]));

// TEST ortaminda iki uygulama: biri iki RP host'unda tanimli, biri hicbirinde.
const T_DISC = [A('kart-ui', 'kart-test'), A('bos-ui', 'kart-test')];
const T_TANIM = [LOC('GBNGXT33', 'kart-test', 'kart-ui'), LOC('GBNGXT34', 'kart-test', 'kart-ui')];

// ── RP'DE TANIMLI MI ──────────────────────────────────────────────────────────────────
test('SR1 non-prod include tanimi: tanimli, yol include, host 2/2; tanimsiz yalniz tam taramada', () => {
  const r = run(T_DISC, K({ cfg: T_TANIM }));
  const b = by(r);
  assert.equal(b['kart-ui'].rp, 'tanimli');
  assert.deepEqual(b['kart-ui'].rpYol, ['include']);
  assert.equal(b['kart-ui'].rpHost, '2/2');
  assert.equal(b['kart-ui'].rpEsles, undefined, 'kesin eslesme satira yazilmaz (boyut)');
  assert.equal(b['bos-ui'].rp, 'tanimsiz', 'iki host da taranmis, tablo okunmus: tanimsiz');
  assert.equal(b['bos-ui'].rpNeden, undefined);
  assert.equal(b['bos-ui'].rpIstek, 'uygulanamaz', 'tanimsiz uygulamada RP istegi sorulmaz');
});

test('SR2 beklenen RP host u TARANMAMISSA tanimsiz DENMEZ: olculemedi + neden', () => {
  // GBNGXT34 o gun satir uretmedi (ignore_unreachable) -> tanim orada olabilir.
  const r = run(T_DISC, K({ cfg: [T_TANIM[0]] }));
  const b = by(r);
  assert.equal(b['bos-ui'].rp, 'olculemedi', 'taranmamis host varken tanimsiz uretildi');
  assert.equal(b['bos-ui'].rpNeden, 'host-taranmadi');
  assert.deepEqual(r.rpKapsam.taranmayan.TEST, ['GBNGXT34'], 'taranmayan host kapsamda yok');
  // Tanim bulunduysa eksik host 'tanimli'yi DUSURMEZ; rpHost bunu soyler.
  assert.equal(b['kart-ui'].rp, 'tanimli');
  assert.equal(b['kart-ui'].rpHost, '1/2');
});

test('SR3 PROD: proxy kolonlari yoksa olculemedi; dizin tablosu okunamazsa olculemedi', () => {
  const disc = [A('bos-app-v1', 'odeme-prod')];
  const tam = PROD_ALL.map(IZ);
  assert.equal(by(run(disc, K({ cfg: tam })))['bos-app-v1'].rp, 'tanimsiz', 'kontrol');
  const p = by(run(disc, K({ prxKolon: 3, cfg: tam })))['bos-app-v1'];
  assert.equal(p.rp, 'olculemedi', 'kind kolonlari yokken PROD tanimsiz dendi');
  assert.equal(p.rpNeden, 'proxy-kolonu-yok');
  const d = by(run(disc, K({ cfg: tam, dir: null, tablolar: { dir: 'okunamadi' } })))['bos-app-v1'];
  assert.equal(d.rp, 'olculemedi', 'K3: dizin okunamadiyken "hicbiri yok" dendi');
  assert.equal(d.rpNeden, 'okunamadi:dizin');
});

test('SR4 sorgu DUSTU ya da tablo YOK: hicbir uygulama tanimsiz olmaz', () => {
  const okunamadi = by(run(T_DISC, K({ cfg: null, tablolar: { cfg: 'okunamadi' } })))['bos-ui'];
  assert.equal(okunamadi.rp, 'olculemedi');
  assert.equal(okunamadi.rpNeden, 'okunamadi:config');
  const yok = by(run(T_DISC, K({ cfg: null, tablolar: { cfg: 'yok' } })))['bos-ui'];
  assert.equal(yok.rp, 'olculemedi');
  assert.equal(yok.rpNeden, 'tablo-yok:config');
  // Durum 'var' dese bile satir dizisi gelmediyse (null) okunmus SAYILMAZ.
  assert.equal(by(run(T_DISC, K({ cfg: null })))['bos-ui'].rp, 'olculemedi');
  // Kaynak hic verilmezse (eski cagri) de tanimsiz/yok uretilmez.
  for (const r of [buildSpaDiscovery(T_DISC, [], [], []), run(T_DISC, undefined)]) {
    for (const a of r.apps) {
      assert.notEqual(a.rp, 'tanimsiz', `${a.application} kaynak yokken tanimsiz`);
      assert.notEqual(a.rpIstek, 'yok', `${a.application} kaynak yokken istek yok`);
    }
  }
});

test('SR5 kapsam disi: EDU (RP listesi yok), ortamsiz namespace, ARK disi platform', () => {
  const disc = [
    A('edu-ui', 'kart-edu'),
    A('ortamsiz-ui', 'kart'),
    A('host-ui', 'kart-test', { cluster: 'gbocp3rdtest3' }),
  ];
  const b = by(run(disc, K({ cfg: [...T_TANIM] })));
  assert.equal(b['edu-ui'].rp, 'kapsam-disi');
  assert.equal(b['edu-ui'].rpNeden, 'rp-listesi-yok');
  assert.equal(b['ortamsiz-ui'].rp, 'kapsam-disi');
  assert.equal(b['ortamsiz-ui'].rpNeden, 'ortam-yok');
  assert.equal(b['host-ui'].rp, 'kapsam-disi', 'hosting platformu icin tanimsiz dendi');
  assert.equal(b['host-ui'].rpNeden, 'platform');
});

test('SR6 K4: RP kolonlari yalniz SPA ve internet/karisik; digerleri uygulanamaz', () => {
  const disc = [
    A('intra-ui', 'kart-test', { termination: 'reencrypt' }),
    A('api-svc', 'kart-test', { is_spa: 0 }),
    A('edge-ui', 'kart-test', { termination: 'edge' }),
    A('karma-ui', 'kart-test'),
    A('karma-ui', 'kart-test', { route: 'karma-ic', termination: 'reencrypt' }),
  ];
  const cfg = [
    ...T_TANIM.map((x) => ({ ...x, application: 'intra-ui', location_path: '/intra-ui/' })),
    LOC('GBNGXT33', 'kart-test', 'api-svc'),
  ];
  const b = by(run(disc, K({ cfg })));
  assert.equal(b['intra-ui'].ag, 'intranet');
  assert.equal(b['intra-ui'].rp, 'uygulanamaz');
  assert.equal(b['intra-ui'].agCelisme, true, 'reencrypt SPA internet RP de tanimli: celiski');
  assert.equal(b['api-svc'].rp, 'uygulanamaz', 'SPA olmayana RP karari verildi');
  assert.equal(b['api-svc'].agCelisme, undefined);
  assert.equal(b['edge-ui'].ag, 'diger');
  assert.equal(b['edge-ui'].rp, 'uygulanamaz');
  assert.equal(b['karma-ui'].ag, 'karisik');
  assert.equal(b['karma-ui'].rp, 'tanimsiz', 'karisik internet gibi aranmali');
});

test('SR7 eski yazim: -prod EKSIZ ciplak upstream KESIF host una ek-prod ile baglanir', () => {
  const disc = [A('x-app-v1', 'digital-banking-ch-prod')];
  const cfg = [...PROD_ALL.map(IZ), PRX('GBRVPP01', 'x-app-v1-digital-banking-ch')];
  const a = by(run(disc, K({ cfg })))['x-app-v1'];
  assert.equal(a.rp, 'tanimli', 'ciplak upstream eslesmedi');
  assert.deepEqual(a.rpYol, ['proxy']);
  assert.equal(a.rpEsles, 'ek-prod', 'sessiz ek: eslesme yolu satirda isaretlenmeli');
});

test('SR8 ad kalibina UYMAYAN SPA nin proxy tanimi bulunur (isSpaApp suzgeci YOK)', () => {
  const disc = [A('eski-portal', 'odeme-prod')];
  const cfg = [
    ...PROD_ALL.map(IZ),
    PRX('GBRVPP02', 'eski-portal-odeme-prod.apps.fw.garanti.com.tr'),
  ];
  const r = run(disc, K({ cfg }));
  const a = by(r)['eski-portal'];
  assert.equal(a.rp, 'tanimli', 'kalibi tutmayan SPA nin tanimi atildi');
  assert.equal(a.rpEsles, undefined);
  // UPSTREAM TAKMA ADI: gercek server Nginx_Audit_Upstreams'ten.
  const r2 = run(
    disc,
    K({
      cfg: [...PROD_ALL.map(IZ), PRX('GBRVPP02', 'onur')],
      ups: [
        {
          host: 'GBRVPP02',
          name: 'onur',
          server: 'eski-portal-odeme-prod.apps.fw.garanti.com.tr:443',
          scan_date: GUN,
        },
      ],
    }),
  );
  assert.equal(by(r2)['eski-portal'].rp, 'tanimli', 'takma ad upstream server ile cozulmedi');
  const t = rpTanimlari(r2.rpDetay, 'odeme-prod', 'eski-portal');
  assert.equal(t[0].hedefKaynak, 'upstream-server');
  assert.equal(r2.rpKapsam.upsTarih, GUN);
});

test('SR9 yeni PROD dizin kurulumu tanimdir (K3); olcum kaynagi yok; conf yoksa tanim degil', () => {
  const disc = [A('eski-portal', 'odeme-prod')];
  const dir = (o) => [
    {
      host: 'GBNGXP44',
      namespace: 'odeme-prod',
      application: 'eski-portal',
      hys_deployed: 1,
      app_deployed: 0,
      conf_exists: 1,
      conf_name: 'eski-portal-odeme-prod.conf',
      scan_date: GUN,
      ...o,
    },
  ];
  const a = by(run(disc, K({ cfg: PROD_ALL.map(IZ), dir: dir() })))['eski-portal'];
  assert.equal(a.rp, 'tanimli');
  assert.deepEqual(a.rpYol, ['dizin']);
  assert.equal(
    a.rpIstek,
    'kaynak-yok',
    'olcum kaynagi olmayan tanim "yok" ya da olculemedi sayildi',
  );
  assert.deepEqual(a.rpSorun, ['MISSING_APP']);
  const c = by(run(disc, K({ cfg: PROD_ALL.map(IZ), dir: dir({ conf_exists: 0 }) })))[
    'eski-portal'
  ];
  assert.equal(c.rp, 'tanimsiz', 'conf dosyasi olmayan dizin tanim sayildi');
});

// ── RP ISTEGI ─────────────────────────────────────────────────────────────────────────
const istekOf = (trf, cfg = T_TANIM) => by(run(T_DISC, K({ cfg, trf })))['kart-ui'];
const ESKI = '20260901000000'; // scan_date'ten 30 gun once: tam pencere

test('SR10 LOADERR (service/env/location NULL) tanimi olculemedi yapar; "yok" DEGIL', () => {
  const trf = [
    LOADERR('GBNGXT33', 'KART-TEST', 'log dosyasi yok: /web_log/kart.log'),
    TRF('GBNGXT34', 'KART-TEST', '/kart-ui/', { first_seen: ESKI }),
  ];
  const a = istekOf(trf);
  assert.equal(a.rpIstek, 'olculemedi', 'okunamayan log "istek yok" a dustu');
  assert.equal(a.rpOlcum, '1/2');
  assert.equal(a.rpReq7, 0, 'olculen tanimin sifiri yazilir');
  const t = rpTanimlari(run(T_DISC, K({ cfg: T_TANIM, trf })).rpDetay, 'kart-test', 'kart-ui');
  const t33 = t.find((d) => d.host === 'GBNGXT33');
  assert.equal(t33.trafik.durum, 'olculemedi');
  assert.equal(t33.trafik.neden, 'log');
  assert.match(t33.trafik.hata, /log dosyasi yok/);
  // vhost '*' (betigin tum sunucu hatasi) da ayni host'taki tum tanimlari olculemedi yapar.
  assert.equal(
    istekOf([LOADERR('GBNGXT33', '*', 'tarih hesaplanamadi'), trf[1]]).rpIstek,
    'olculemedi',
  );
});

test('SR11 location bicimi betikle ayni: "^~ /x/" olculur, "= /x" olculemez', () => {
  assert.equal(normLoc('^~ /kart/'), '/kart/');
  assert.equal(normLoc('/kart/'), '/kart/');
  assert.equal(normLoc('= /tam'), null);
  assert.equal(normLoc('~* \\.(js|css)$'), null);
  assert.equal(normLoc('^~/bosluksuz'), null);
  assert.equal(normLoc('@adli'), null);
  const onekli = T_TANIM.map((x) => ({ ...x, location_path: '^~ /kart-ui/' }));
  const trf = ['GBNGXT33', 'GBNGXT34'].map((h) =>
    TRF(h, 'KART-TEST', '/kart-ui/', { req_7d: 4, req_24h: 1, first_seen: ESKI }),
  );
  const a = istekOf(trf, onekli);
  assert.equal(a.rpIstek, 'var', '"^~" onekli tanim trafikle eslesmedi');
  assert.equal(a.rpReq7, 8);
  const tam = T_TANIM.map((x) => ({ ...x, location_path: '= /kart-ui/' }));
  assert.equal(istekOf(trf, tam).rpIstek, 'olculemedi', '"=" location olculmus sayildi');
});

test('SR12 0 istek ancak tam pencerede "yok"; kisa pencere / sampled / first_seen yok -> kismi', () => {
  const iki = (o33, o34 = o33) => [
    TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', o33),
    TRF('GBNGXT34', 'KART-TEST', '/kart-ui/', o34),
  ];
  const yok = istekOf(iki({ first_seen: ESKI }));
  assert.equal(yok.rpIstek, 'yok');
  assert.equal(yok.rpPencereSa, 720);
  // Gunluk rotasyon: log 2 saat once basliyor, sampled=0 -> "7 gundur istek yok" DENEMEZ.
  const kisa = istekOf(iki({ first_seen: ESKI }, { first_seen: '20260930220000' }));
  assert.equal(kisa.rpIstek, 'kismi', 'kisa pencere "yok" sayildi');
  assert.equal(kisa.rpPencereSa, 2, 'en kisa pencere yazilmali');
  assert.equal(istekOf(iki({ first_seen: ESKI, sampled: 1 })).rpIstek, 'kismi');
  assert.equal(istekOf(iki({ first_seen: null })).rpIstek, 'kismi');
  assert.equal(pencereSaat('2026-10-01', '20260930220000'), 2);
  assert.equal(pencereSaat('2026-10-01', null), null);
  // 7 GUN SINIRI (2026-10-02 dogrulama bulgusu: fikstur yalniz 720/48/2 saatti; "<=" ya da
  // "yaklasik 7 gun" gevsetmesi yesil kaliyordu). 167 saat = 7 gunden KISA -> kismi; 168 -> yok.
  assert.equal(pencereSaat('2026-10-01', '20260924010000'), 167);
  assert.equal(pencereSaat('2026-10-01', '20260924000000'), 168);
  const s167 = istekOf(iki({ first_seen: '20260924010000' }));
  assert.equal(s167.rpIstek, 'kismi', '167 saatlik 0 "7 gunde yok" sayildi');
  assert.deepEqual(s167.rpIstekNeden, ['pencere']);
  assert.equal(s167.rpPencereSa, 167);
  const s168 = istekOf(iki({ first_seen: '20260924000000' }));
  assert.equal(s168.rpIstek, 'yok', 'tam 7 gunluk (168 saat) olcum "yok" demeli');
  assert.equal(s168.rpPencereSa, 168);
});

test('SR13 istek var: mirror tanimlar TOPLANIR, son istek en yenisi', () => {
  const a = istekOf([
    TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', {
      req_7d: 5,
      req_24h: 1,
      last_seen: '20260930101010',
    }),
    TRF('GBNGXT34', 'KART-TEST', '/kart-ui/', {
      req_7d: 7,
      req_24h: 2,
      last_seen: '20260930121212',
    }),
  ]);
  assert.equal(a.rpIstek, 'var');
  assert.equal(a.rpReq7, 12);
  assert.equal(a.rpReq24, 3);
  assert.equal(a.rpSon, '20260930121212');
  assert.equal(a.rpOlcum, '2/2');
});

test('SR14 trafik satiri yok: host hic satir uretmediyse "host", digerleri varsa "satir-yok"', () => {
  const t33 = TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { first_seen: ESKI });
  const r = run(T_DISC, K({ cfg: T_TANIM, trf: [t33] }));
  assert.equal(by(r)['kart-ui'].rpIstek, 'olculemedi', 'olculmeyen host "yok" sayildi');
  const t34 = rpTanimlari(r.rpDetay, 'kart-test', 'kart-ui').find((d) => d.host === 'GBNGXT34');
  assert.equal(t34.trafik.neden, 'host');
  const r2 = run(T_DISC, K({ cfg: T_TANIM, trf: [t33, TRF('GBNGXT34', 'KART-TEST', '/baska/')] }));
  const t34b = rpTanimlari(r2.rpDetay, 'kart-test', 'kart-ui').find((d) => d.host === 'GBNGXT34');
  assert.equal(t34b.trafik.neden, 'satir-yok');
  // Trafik tablosu yoksa tanimli satirlarin hepsi olculemedi.
  const r3 = run(T_DISC, K({ cfg: T_TANIM, trf: null, tablolar: { trf: 'yok' } }));
  assert.equal(by(r3)['kart-ui'].rpIstek, 'olculemedi');
  assert.equal(by(r3)['kart-ui'].rpReq7, undefined, 'olculemeyen hucreye 0 yazildi');
});

test('SR15 PROD: eski proxy olculur, olcum kaynagi olmayan yeni dizin tanimi 0 i "kismi" yapar', () => {
  const disc = [A('eski-portal', 'odeme-prod')];
  const cfg = [
    ...PROD_ALL.map(IZ),
    PRX('GBRVPP01', 'eski-portal-odeme-prod.apps.fw.garanti.com.tr'),
  ];
  const trf = [TRF('GBRVPP01', 'GLOMO-PROD', '/x/', { first_seen: ESKI })];
  const dir = [
    {
      host: 'GBNGXP44',
      namespace: 'odeme-prod',
      application: 'eski-portal',
      hys_deployed: 1,
      app_deployed: 1,
      conf_exists: 1,
      scan_date: GUN,
    },
  ];
  assert.equal(by(run(disc, K({ cfg, trf })))['eski-portal'].rpIstek, 'yok');
  const a = by(run(disc, K({ cfg, trf, dir })))['eski-portal'];
  assert.deepEqual(a.rpYol, ['dizin', 'proxy']);
  assert.equal(a.rpIstek, 'kismi', 'olculmeyen yeni sunucu tanimi varken "yok" dendi');
});

// ── UYGULAMA ISTEGI (Dynatrace) VE ENVANTER ─────────────────────────────────────────────
test('SR16 Dynatrace servisi yok: "servis-yok" (istek yok DEGIL); sorgu dustuyse olculemedi', () => {
  const use = [
    {
      namespace: 'kart-test',
      app: 'kart-ui',
      scan_date: GUN,
      window_days: 7,
      req_total: 0,
      services_total: 0,
      measured: 1,
    },
    {
      namespace: 'kart-test',
      app: 'bos-ui',
      scan_date: GUN,
      window_days: 7,
      req_total: 0,
      services_total: 2,
      measured: 1,
    },
  ];
  const b = by(run(T_DISC, K(), { use }));
  assert.equal(b['kart-ui'].istek, 'servis-yok');
  assert.equal(b['bos-ui'].istek, 'yok');
  const r = buildSpaDiscovery(T_DISC, [], null, [], K());
  for (const a of r.apps)
    assert.equal(a.istek, 'olculemedi', 'okunamayan Dynatrace "olcum yok" gorundu');
  assert.equal(r.rpKapsam.dynatraceOkunamadi, true);
});

test('SR17 route envanteri sorgusu DUSERSE "kayitli degil" denmez: olculemedi', () => {
  const r = buildSpaDiscovery(T_DISC, null, [], [], K());
  for (const a of r.apps) {
    assert.equal(a.inventory, 'olculemedi', 'envanter okunamazken kayitli degil dendi');
    assert.equal(a.agEnvanter, 'olculemedi');
  }
  assert.equal(r.appSummary.spaNotInInventory, 0);
  assert.equal(r.summary.spaNotInInventory, 0);
  assert.equal(r.rpKapsam.envanterOkunamadi, true);
});

// ── AG ────────────────────────────────────────────────────────────────────────────────
test('SR18 ag: "" TLS yok -> diger, NULL -> bilinmiyor, ikisi birden karisik; route bir kez', () => {
  const tek = (t) => agKarari(new Map([['c|r', t]])).ag;
  assert.equal(tek('passthrough'), 'internet');
  assert.equal(tek('reencrypt'), 'intranet');
  assert.equal(tek('edge'), 'diger');
  assert.equal(tek(''), 'diger', 'TLS siz route bilinmiyor sayildi');
  assert.equal(tek(null), 'bilinmiyor', 'NULL termination TLS yok sayildi');
  const disc = [
    A('null-ui', 'kart-test', { termination: null }),
    A('bos-tls', 'kart-test', { termination: '' }),
    A('cift', 'kart-test'),
    A('cift', 'kart-test', { cluster: 'gbocptest2' }),
  ];
  const b = by(buildSpaDiscovery(disc, [], [], [], K()));
  assert.equal(b['null-ui'].ag, 'bilinmiyor');
  assert.deepEqual(b['null-ui'].agSay, { bos: 1 });
  assert.equal(b['bos-tls'].ag, 'diger');
  assert.deepEqual(b['bos-tls'].agSay, { tlsYok: 1 });
  assert.deepEqual(b.cift.agSay, { passthrough: 2 }, 'iki cluster daki route ayri sayilmali');
});

test('SR19 ag capraz kontrolu envanterle celisirse UYARIR, ag degerini EZMEZ', () => {
  const inv = [
    {
      cluster_name: 'gbocptest1',
      namespace_name: 'kart-test',
      route_name: 'kart-ui',
      route_address: 'x',
      termination_type: 'reencrypt',
    },
    {
      cluster_name: 'gbocptest1',
      namespace_name: 'kart-test',
      route_name: 'bos-ui',
      route_address: 'y',
      termination_type: 'passthrough',
    },
  ];
  const b = by(buildSpaDiscovery(T_DISC, inv, [], [], K()));
  assert.equal(b['kart-ui'].ag, 'internet', 'envanter ag degerini ezdi');
  assert.equal(b['kart-ui'].agEnvanter, 'celisik');
  assert.equal(b['kart-ui'].agCelisikRoute, 1);
  assert.equal(b['bos-ui'].agEnvanter, 'uyumlu');
  // NULL ve '' ikisi de TLS yok: celiski DEGIL.
  const b2 = by(
    buildSpaDiscovery(
      [A('d-ui', 'kart-test', { termination: '' })],
      [{ namespace_name: 'kart-test', route_name: 'd-ui', termination_type: null }],
      [],
      [],
      K(),
    ),
  );
  assert.equal(b2['d-ui'].agEnvanter, 'uyumlu');
  assert.equal(
    by(buildSpaDiscovery(T_DISC, [], [], [], K()))['kart-ui'].agEnvanter,
    'envanterde-yok',
  );
  // AYNI CLUSTER ONCE: baska cluster'daki ayni adli route'un farkli tipi celiski DEGIL.
  const b3 = by(
    buildSpaDiscovery(
      [A('c-ui', 'kart-test')],
      [
        {
          cluster_name: 'gbocptest2',
          namespace_name: 'kart-test',
          route_name: 'c-ui',
          termination_type: 'reencrypt',
        },
        {
          cluster_name: 'gbocptest1',
          namespace_name: 'kart-test',
          route_name: 'c-ui',
          termination_type: 'passthrough',
        },
      ],
      [],
      [],
      K(),
    ),
  );
  assert.equal(b3['c-ui'].agEnvanter, 'uyumlu', 'baska cluster in satiriyla karsilastirildi');
});

// ── LISTE VE BOYUT ─────────────────────────────────────────────────────────────────────
test('SR20 internet RP listesi TEK yerden: GBNGXT07 yok, intranet ile kesisim yok, PROD = tasima gruplari', () => {
  assert.ok(!RP.all.has('GBNGXT07'), 'GBNGXT07 RP sayildi (kullanici: SAYILMAZ)');
  for (const h of RP.all) assert.ok(!_INTRANET_HOSTS.has(h), `${h} hem internet RP hem intranet`);
  const grup = new Set(MIGRATION_GROUPS.flatMap((g) => [...g.oldHosts, ...g.newHosts]));
  assert.deepEqual(new Set(PROD_ALL), grup, 'PROD RP listesi tasima gruplarindan ayristi');
  assert.deepEqual(RP.byEnv.DEV, ['GBNGXD01', 'GBNGXD02']);
  assert.deepEqual(RP.byEnv.TEST, ['GBNGXT33', 'GBNGXT34']);
  assert.deepEqual(RP.byEnv.QA, ['GBNGXQ01', 'GBNGXQ02']);
  assert.equal(RP.byEnv.EDU, undefined, 'EDU icin internet RP listesi yok (kapsam disi)');
  // KOPYA YOK: PROD hostlari nginx-hosts.cjs'te ELLE yazilmaz.
  const src = read('server/audit/nginx-hosts.cjs');
  assert.ok(
    !/GBRVPP0[1-9]'|GBNGXP4[0-9]'/.test(src),
    'PROD RP listesi nginx-hosts.cjs e kopyalanmis',
  );
});

test('SR21 yanit butcesi: 10 bin uygulamalik satir listesi 8 MB onbellek sinirinin altinda', () => {
  // Gercekci adlar: digital-banking-ch-prod gibi namespace, <app>-<ns>.apps.fw... adres, iki
  // cluster, Dynatrace satiri; yarisi iki RP host'unda tanimli ve trafigi olculmus SPA.
  const disc = [];
  const cfg = [];
  const trf = [];
  const use = [];
  for (let i = 0; i < 10000; i++) {
    const ns = `digital-banking-ch${i % 400}-test`;
    const app = `odeme-talimat-${i}-app-v1`;
    const spa = i % 2 === 0;
    disc.push(A(app, ns, { is_spa: spa ? 1 : 0 }));
    disc.push(A(app, ns, { cluster: 'gbocptest2', is_spa: spa ? 1 : 0 }));
    use.push({
      namespace: ns,
      app,
      scan_date: GUN,
      window_days: 35,
      req_total: 1234,
      services_total: 2,
      measured: 1,
      note: '',
    });
    if (spa) {
      for (const h of ['GBNGXT33', 'GBNGXT34']) {
        cfg.push(LOC(h, ns, app, { location_path: `/${app}/`, include_name: `kart-${app}-${ns}` }));
        trf.push(
          TRF(h, 'KART-TEST', `/${app}/`, { req_7d: 10, req_24h: 2, last_seen: '20260930101010' }),
        );
      }
    }
  }
  const r = buildSpaDiscovery(disc, [], use, [], K({ cfg, trf }));
  assert.equal(r.apps.length, 10000);
  assert.equal(
    r.apps.filter((a) => a.rp === 'tanimli').length,
    5000,
    'fixture tanimlari baglanmadi',
  );
  // OLCULEN SEY GERCEK HTTP GOVDESI (spaYanitGovdesi): eskiden JSON.stringify(r) olculuyordu,
  // uc noktanin gonderdigi govde degil.
  const govde = JSON.stringify(spaYanitGovdesi({ ok: true, ...r }));
  const mb = govde.length / 1024 / 1024;
  assert.ok(
    mb < 8,
    `yanit ${mb.toFixed(2)} MB - 8 MB onbellek sinirini asti (tanim listesi satira gomulmus olabilir)`,
  );
  assert.ok(!('rpDetay' in JSON.parse(JSON.stringify(r))), 'ayrinti haritasi yanita sizdi');
  assert.ok(!('rows' in JSON.parse(govde)), 'route satirlari ?satir=1 olmadan govdeye girdi');
});

test('SR21b yanit butcesi GERCEKCI profilde: iki route, uzun FQDN, bes ortam, PROD include + dizin, rpSorun', () => {
  // Dogrulama bulgusu (2026-10-01): SR21'in tek route'lu profili 6,9 MB uretiyordu; uygulama
  // basina iki route (dis + '-int'), iki cluster, uzun adresler ve dolu rpSorun ile ayni 10 bin
  // uygulama 8,5 MB'a cikip onbellegi SESSIZCE devre disi birakiyordu. Bu profil olc_boyut
  // olcumunun aynisidir.
  const ENVS = ['dev', 'test', 'qa', 'prod', 'edu'];
  const disc = [];
  const inv = [];
  const cfg = [];
  const trf = [];
  const dir = [];
  const use = [];
  const PROD_ESKI = [...RP.prodOld].slice(0, 4);
  const PROD_YENI = [...RP.prodNew].slice(0, 4);
  for (let i = 0; i < 10000; i++) {
    const env = ENVS[i % 5];
    const ns = `digital-banking-chnl${i % 400}-${env}`;
    const app = `odeme-talimat-islemleri-${i}-app-v1`;
    const prod = env === 'prod';
    const spa = i % 2 === 0;
    const term = i % 7 === 0 ? 'reencrypt' : 'passthrough';
    for (const cl of prod ? ['gbocpprod1', 'gbocpprod2'] : ['gbocptest1', 'gbocptest2']) {
      for (const suf of ['', '-int']) {
        const host = `${app}${suf}-${ns}.${prod ? 'apps' : 'apps-t'}.fw.garanti.com.tr`;
        disc.push(
          D({
            cluster: cl,
            namespace: ns,
            route: app + suf,
            host,
            termination: suf ? 'reencrypt' : term,
            workload: app,
            is_spa: spa ? 1 : 0,
            signal: 'nginx-start',
            image: `registry.example/${ns}/${app}:1.0.${i}`,
            note: i % 10 === 0 ? 'servis okunamadi: forbidden' : '',
            match_by: i % 10 === 0 ? 'ad' : 'selector',
          }),
        );
        inv.push({
          cluster_name: cl,
          namespace_name: ns,
          route_name: app + suf,
          route_address: host,
          termination_type: suf ? 'reencrypt' : i % 13 === 0 ? 'edge' : term,
        });
      }
    }
    use.push({
      namespace: ns,
      app,
      scan_date: GUN,
      window_days: 35,
      req_total: 123456,
      services_total: i % 9 === 0 ? 0 : 3,
      measured: 1,
      note: i % 11 === 0 ? 'dynatrace timeout' : '',
    });
    if (!spa) continue;
    const ENV = env.toUpperCase();
    for (const h of prod ? PROD_ESKI : RP.byEnv[ENV] || []) {
      cfg.push(
        LOC(h, ns, app, {
          vhost: `KART-${ENV}`,
          env: ENV,
          status: i % 6 === 0 ? 'BROKEN_INCLUDE' : 'OK',
        }),
      );
      trf.push(
        TRF(h, `KART-${ENV}`, `/${app}/`, {
          req_24h: 20,
          req_7d: 1000,
          hc_24h: 1,
          last_seen: '20260930101010',
        }),
      );
    }
    if (prod)
      for (const h of PROD_YENI)
        dir.push({
          host: h,
          namespace: ns,
          application: app,
          hys_deployed: 1,
          app_deployed: i % 4 === 0 ? 0 : 1,
          conf_exists: 1,
          conf_name: `${app}-${ns}.conf`,
          scan_date: GUN,
        });
  }
  for (const h of RP.all) cfg.push(IZ(h));
  const r = buildSpaDiscovery(disc, inv, use, [], K({ cfg, trf, dir }));
  assert.equal(r.apps.length, 10000);
  // Profil gercekten agir mi (yoksa bekci yine kor kalir): PROD'da iki yol, sorunlu tanimlar.
  const prodTanimli = r.apps.filter((a) => a.env === 'prod' && a.rp === 'tanimli');
  assert.ok(prodTanimli.length > 500, 'PROD tanimlari baglanmadi - profil hafif kaldi');
  assert.ok(
    prodTanimli.every((a) => a.rpYol.length === 2),
    'PROD include + dizin birlikte gelmedi',
  );
  assert.ok(
    r.apps.some((a) => (a.rpSorun || []).length >= 2),
    'rpSorun dolu satir yok',
  );
  assert.ok(
    r.apps.every((a) => a.hosts.length === 2 && a.clusters.length === 2),
    'iki route x iki cluster',
  );
  const govde = JSON.stringify(
    spaYanitGovdesi({ ok: true, tableMissing: false, scanDate: GUN, ...r }),
  );
  const mb = govde.length / 1024 / 1024;
  assert.ok(mb < 8, `gercekci profilde yanit ${mb.toFixed(2)} MB - 8 MB onbellek sinirini asti`);
  // KUCULTME KORUNUR: varsayilanlar govdeye yazilmaz (kaldirilirsa bu profil 8 MB'i asar).
  const ornek = JSON.parse(govde).apps.find((a) => a.spa === 'hayir');
  assert.ok(
    ornek && !('rp' in ornek) && !('rpIstek' in ornek),
    'varsayilan rp/rpIstek govdeye yazildi',
  );
});

// ── DOGRULAMA BULGULARI (2026-10-01): her biri bir bekci, mutasyonla dogrulandi ─────────
test('SR26 upstream okunamadi / yok / bos: takma adli PROD proxy varken PROD "tanimsiz" DENMEZ', () => {
  // Takma adla yazilmis proxy_pass (proxy_ssl_name yok): analyzer target_url'e takma adi yazar;
  // gercek arka uc YALNIZ Nginx_Audit_Upstreams'ten bulunur (ayri is, 2 gun saklama).
  const disc = [A('eski-portal', 'odeme-prod')];
  const cfg = [...PROD_ALL.map(IZ), PRX('GBRVPP02', 'onur')];
  const ups = [
    {
      host: 'GBRVPP02',
      name: 'onur',
      server: 'eski-portal-odeme-prod.apps.fw.garanti.com.tr:443',
      scan_date: GUN,
    },
  ];
  assert.equal(
    by(run(disc, K({ cfg, ups })))['eski-portal'].rp,
    'tanimli',
    'kontrol: upstream okundu',
  );
  for (const [ad, kaynak, neden] of [
    ['okunamadi', K({ cfg, ups: null, tablolar: { ups: 'okunamadi' } }), 'okunamadi:upstream'],
    ['tablo yok', K({ cfg, ups: null, tablolar: { ups: 'yok' } }), 'tablo-yok:upstream'],
    ['bos (is kosmadi / adi icermiyor)', K({ cfg, ups: [] }), 'hedef-cozulemedi'],
  ]) {
    const r = run(disc, kaynak);
    const a = by(r)['eski-portal'];
    assert.equal(
      a.rp,
      'olculemedi',
      `upstream ${ad}: takma adin hedefi bilinmezken tanimsiz dendi`,
    );
    assert.equal(a.rpNeden, neden, `upstream ${ad}`);
    assert.equal(r.rpKapsam.hedefCozulemeyen.PROD, 1, `upstream ${ad}: kapsamda sayilmadi`);
  }
  // NOKTALI (gercek FQDN) cozulemeyen hedef tanimsiz'i BOZMAZ: arka uc biliniyor, kesifte yok.
  const yabanci = run(disc, K({ cfg: [...PROD_ALL.map(IZ), PRX('GBRVPP02', 'baska.vendor.net')] }));
  assert.equal(by(yabanci)['eski-portal'].rp, 'tanimsiz');
  // Baska ortamin cozulemeyen takma adi bu ortamin kararini etkilemez.
  const testte = run(
    [A('bos-ui', 'kart-test')],
    K({ cfg: [...RP.byEnv.TEST.map(IZ), PRX('GBRVPP02', 'onur')] }),
  );
  assert.equal(by(testte)['bos-ui'].rp, 'tanimsiz');
});

test('SR28 paylasilan adres / ad carpismasi: tanim uygulamaya AYRILAMAZ - "kesin" ve "istek var" yazilmaz', () => {
  // P8: iki is yuku ayni adresi paylasiyor (path tabanli route); PROD RP yalniz /hesap/'i proxy ediyor.
  const host = 'online.garantibbva.com.tr';
  const disc = [
    A('hesap-ui', 'online-prod', { host, route: 'hesap' }),
    A('kart-ui', 'online-prod', { host, route: 'kart' }),
  ];
  const cfg = [...PROD_ALL.map(IZ), PRX('GBRVPP07', host, { location_path: '/hesap/' })];
  const trf = [TRF('GBRVPP07', 'GLOMO-PROD', '/hesap/', { req_7d: 900, req_24h: 100 })];
  const b = by(run(disc, K({ cfg, trf })));
  for (const ad of ['hesap-ui', 'kart-ui']) {
    assert.equal(b[ad].rpEsles, 'paylasimli', `${ad}: paylasilan adres kesin baglandi`);
    assert.equal(
      b[ad].rpIstek,
      'ayrilamaz',
      `${ad}: paylasilan tanimin trafigi bu uygulamaya yazildi`,
    );
    assert.equal(b[ad].rpReq7, undefined, `${ad}: ayrilamayan trafik satira yazildi`);
  }
  // Ayni ROUTE'un iki is yuku (blue/green) tanimi GERCEKTEN paylasir: kesin kalir.
  const bg = by(
    run(
      [
        A('mavi', 'online-prod', { host, route: 'web' }),
        A('yesil', 'online-prod', { host, route: 'web' }),
      ],
      K({ cfg, trf }),
    ),
  );
  assert.equal(bg.mavi.rpEsles, undefined, 'ayni route un is yukleri paylasimli sayildi');
  assert.equal(bg.mavi.rpIstek, 'var');
  // P3: genel DNS etiketi ('mobil') kesifte OLMAYAN yabanci hedefe ('mobil.vendor-cdn.net') baglanmaz.
  const disc3 = [
    A('mobil-web', 'mobil-prod', { host: 'mobil.garanti.com.tr' }),
    A('bonus-mobil', 'bonus-prod', { host: 'mobil.bonus.com.tr' }),
  ];
  const b3 = by(
    run(disc3, K({ cfg: [...PROD_ALL.map(IZ), PRX('GBRVPP07', 'mobil.vendor-cdn.net')] })),
  );
  assert.equal(b3['mobil-web'].rp, 'tanimsiz', 'genel etiket yabanci hedefle eslesti');
  assert.equal(b3['bonus-mobil'].rp, 'tanimsiz');
  // P9: '<app>-<ns>' bolme carpismasi (odeme-ui + kart-prod = odeme + ui-kart-prod) -> belirsiz.
  const disc9 = [
    A('odeme-ui', 'kart-prod', { host: 'odeme.garanti.com.tr' }),
    A('odeme', 'ui-kart-prod', { host: 'odeme2.garanti.com.tr' }),
  ];
  const b9 = byNs(
    run(disc9, K({ cfg: [...PROD_ALL.map(IZ), PRX('GBRVPP07', 'odeme-ui-kart-prod')] })),
  );
  for (const k of ['kart-prod/odeme-ui', 'ui-kart-prod/odeme']) {
    assert.equal(b9[k].rpEsles, 'belirsiz', `${k}: ad carpismasi kesin baglandi`);
    assert.equal(b9[k].rpIstek, 'ayrilamaz');
  }
  // Ayrilamayan tanim + uygulamanin KENDI tanimi 0 istek (tam pencere): "yok" DEGIL - alt sinir.
  const hostT = 'online.garanti.com.tr';
  const discT = [
    A('hesap-ui', 'online-test', { host: hostT, route: 'hesap' }),
    A('kart-ui', 'online-test', { host: hostT, route: 'kart' }),
  ];
  const cfgT = [
    LOC('GBNGXT33', 'online-test', 'hesap-ui'),
    PRX('GBNGXT34', hostT, { vhost: 'ONLINE-TEST', env: 'TEST', location_path: '/online/' }),
  ];
  const trfT = [
    TRF('GBNGXT33', 'KART-TEST', '/hesap-ui/', { first_seen: ESKI }),
    TRF('GBNGXT34', 'ONLINE-TEST', '/online/', { req_7d: 50, first_seen: ESKI }),
  ];
  const bT = by(run(discT, K({ cfg: cfgT, trf: trfT })));
  assert.equal(
    bT['hesap-ui'].rpIstek,
    'kismi',
    'kendi tanimi 0 + ayrilamayan tanim varken "yok" dendi',
  );
  assert.deepEqual(bT['hesap-ui'].rpIstekNeden, ['ayrilamaz']);
  assert.equal(bT['kart-ui'].rpIstek, 'ayrilamaz');
});

test('SR29 ortamin bir RP sunucusu TARANMAMISKEN 0 istek "yok" DEGIL: kismi + host-taranmadi', () => {
  const disc = [A('odeme-ui-app-v1', 'odeme-prod')];
  const hedef = 'odeme-ui-app-v1-odeme-prod.apps.fw.garanti.com.tr';
  const ankarasiz = PROD_ALL.filter((h) => !/^GBRVPAP0[3-6]$/.test(h)).map(IZ);
  const kos = (cfg, trf) => by(run(disc, K({ cfg, trf })))['odeme-ui-app-v1'];
  // P6: tanim Pendik'te (GBRVPP07), tam pencerede 0 istek; Ankara (GBRVPAP03-06) taranmadi.
  const p6 = kos([...ankarasiz, PRX('GBRVPP07', hedef)], [TRF('GBRVPP07', 'GLOMO-PROD', '/x/')]);
  assert.equal(p6.rp, 'tanimli');
  assert.equal(p6.rpIstek, 'kismi', 'Ankara taranmamisken "istek yok" dendi');
  assert.deepEqual(p6.rpIstekNeden, ['host-taranmadi']);
  assert.equal(p6.rpOlcum, '1/1');
  // P6b: tanim BASKA tasima grubunda (GBRVPP01): ortamin taranmayan hostu yine kapsamda.
  const p6b = kos([...ankarasiz, PRX('GBRVPP01', hedef)], [TRF('GBRVPP01', 'GLOMO-PROD', '/x/')]);
  assert.equal(
    p6b.rpIstek,
    'kismi',
    'baska tasima grubunda 0 istek + Ankara taranmadi: "yok" dendi',
  );
  // Kontrol: Ankara taranmis ve orada da tanim yok -> "yok".
  const tam = kos(
    [...PROD_ALL.map(IZ), PRX('GBRVPP07', hedef)],
    [TRF('GBRVPP07', 'GLOMO-PROD', '/x/')],
  );
  assert.equal(tam.rpIstek, 'yok');
  assert.equal(tam.rpIstekNeden, undefined);
  // Istek GORULDUYSE taranmayan host "var"i dusurmez.
  const var_ = kos(
    [...ankarasiz, PRX('GBRVPP07', hedef)],
    [TRF('GBRVPP07', 'GLOMO-PROD', '/x/', { req_7d: 3 })],
  );
  assert.equal(var_.rpIstek, 'var');
  // P7: TEST - T33 tanimli ve 0 istek; T34 taranmadi.
  const p7 = by(
    run(
      [A('kart-ui', 'kart-test')],
      K({
        cfg: [LOC('GBNGXT33', 'kart-test', 'kart-ui')],
        trf: [TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { first_seen: ESKI })],
      }),
    ),
  )['kart-ui'];
  assert.equal(p7.rpIstek, 'kismi', 'T34 taranmamisken "istek yok" dendi');
  assert.deepEqual(p7.rpIstekNeden, ['host-taranmadi']);
});

test('SR30 ayni adli uygulama iki namespace te + flat LOC: hicbir aday "tanimsiz" olmaz (belirsiz)', () => {
  // Analyzer flat duzende ns='' ve app=stem yazar; adin birden cok namespace'te olmasi gercekci.
  const disc = [
    A('kampanya', 'a-test', { host: 'kampanya.a.garanti.com.tr' }),
    A('kampanya', 'b-test', { host: 'kampanya.b.garanti.com.tr' }),
  ];
  const flat = LOC('GBNGXT33', '', 'kampanya', { status: 'NAME_MISMATCH' });
  const r = run(disc, K({ cfg: [...RP.byEnv.TEST.map(IZ), flat] }));
  const b = byNs(r);
  for (const k of ['a-test/kampanya', 'b-test/kampanya']) {
    assert.equal(b[k].rp, 'olculemedi', `${k}: ona ait olabilecek tanim varken tanimsiz dendi`);
    assert.equal(b[k].rpNeden, 'belirsiz');
  }
  assert.equal(r.rpKapsam.belirsiz, 1);
  // Tek aday: zayif eslesmeyle baglanir.
  const tek = byNs(run([disc[0]], K({ cfg: [...RP.byEnv.TEST.map(IZ), flat] })))['a-test/kampanya'];
  assert.equal(tek.rp, 'tanimli');
  assert.equal(tek.rpEsles, 'zayif');
  // Flat LOC '<app>-<ns>' govdesiyle: ad kalibindan baglanir ('ad').
  const ad = by(
    run(
      [A('kart-ui', 'kart-test')],
      K({ cfg: [IZ('GBNGXT34'), LOC('GBNGXT33', '', 'kart-ui-kart-test')] }),
    ),
  )['kart-ui'];
  assert.equal(ad.rp, 'tanimli');
  assert.equal(ad.rpEsles, 'ad');
});

test('SR31 "-prod" eki YALNIZ PROD RP de denenir: TEST RP deki ciplak ad PROD uygulamasina baglanmaz', () => {
  const disc = [A('kart-ui-app-v1', 'kart-prod'), A('kart-ui-app-v1', 'kart-test')];
  const inv = [
    {
      cluster_name: 'gbocpprod1',
      namespace_name: 'kart-prod',
      route_name: 'kart-ui-app-v1',
      route_address: 'kart-ui-app-v1-kart-prod.apps.fw.garanti.com.tr',
      termination_type: 'passthrough',
    },
    {
      cluster_name: 'gbocptest1',
      namespace_name: 'kart-test',
      route_name: 'kart-ui-app-v1',
      route_address: 'kart-ui-app-v1-kart-test.apps-t.fw.garanti.com.tr',
      termination_type: 'passthrough',
    },
  ];
  const tam = [...PROD_ALL.map(IZ), ...RP.byEnv.TEST.map(IZ)];
  const testRp = PRX('GBNGXT33', 'kart-ui-app-v1-kart', { vhost: 'KART-TEST', env: 'TEST' });
  // Iki kapi: kesif indeksi (envantersiz) ve resolveTarget'in kendi '-prod' denemesi (envanterli).
  for (const [ad, ek] of [
    ['envantersiz', {}],
    ['envanterli (resolveTarget yolu)', { inv }],
  ]) {
    const p = byNs(run(disc, K({ cfg: [...tam, testRp] }), ek))['kart-prod/kart-ui-app-v1'];
    assert.equal(p.rp, 'tanimsiz', `${ad}: TEST RP deki tanim PROD uygulamasina baglandi`);
    assert.equal(p.rpSorun, undefined, ad);
  }
  // Kontrol: AYNI ciplak ad PROD RP'de -> ek-prod ile baglanir (eski PROD yazim kurali).
  const b2 = byNs(run(disc, K({ cfg: [...tam, PRX('GBRVPP07', 'kart-ui-app-v1-kart')] }), { inv }));
  assert.equal(b2['kart-prod/kart-ui-app-v1'].rp, 'tanimli');
  assert.equal(b2['kart-prod/kart-ui-app-v1'].rpEsles, 'ek-prod');
});

test('SR32 dizin tablosu config ten FARKLI gunden: yeni PROD taranmis sayilmaz, PROD "tanimsiz" DENMEZ', () => {
  const disc = [A('yeni-app-v1', 'odeme-prod'), A('baska', 'baska-prod')];
  const eskiProd = [...RP.prodOld].map(IZ);
  const dirSatir = (g) =>
    [...RP.prodNew].map((h) => ({
      host: h,
      namespace: 'baska-prod',
      application: 'baska',
      hys_deployed: 1,
      app_deployed: 1,
      conf_exists: 1,
      conf_name: 'baska-baska-prod.conf',
      scan_date: g,
    }));
  // Kontrol: ayni gun -> 24 PROD host da taranmis -> tanimsiz.
  assert.equal(
    by(run(disc, K({ cfg: eskiProd, dir: dirSatir(GUN) })))['yeni-app-v1'].rp,
    'tanimsiz',
  );
  // Limitli kosu config'i bugune tasidi, dizin tablosu 2026-09-20'de kaldi.
  const r = run(disc, K({ cfg: eskiProd, dir: dirSatir('2026-09-20') }));
  const a = by(r)['yeni-app-v1'];
  assert.equal(a.rp, 'olculemedi', 'iki farkli gunun satirlari birlestirilip tanimsiz dendi');
  assert.equal(a.rpNeden, 'tarih-farkli:dizin');
  assert.equal(r.rpKapsam.dizinFarkli, true);
  assert.equal(r.rpKapsam.dizinTarih, '2026-09-20');
  assert.equal(r.rpKapsam.configTarih, GUN);
  assert.deepEqual(
    new Set(r.rpKapsam.taranmayan.PROD),
    RP.prodNew,
    'eski gunun dizin satirlari yeni PROD u taranmis saydirdi',
  );
  // Eski gunun dizin TANIMI yine gosterilir (bilinen en son durum; tanimli bir kanittir).
  assert.equal(by(r).baska.rp, 'tanimli');
  assert.deepEqual(by(r).baska.rpYol, ['dizin']);
});

test('SR33 Dynatrace cluster lari TOPLANIR: pasif cluster in 0 i "istek yok" yapmaz; sira onemsiz', () => {
  const disc = [
    A('odeme-ui-app-v1', 'odeme-prod'),
    A('odeme-ui-app-v1', 'odeme-prod', { cluster: 'gbocpprod2' }),
  ];
  const U = (cluster, o = {}) => ({
    cluster,
    namespace: 'odeme-prod',
    app: 'odeme-ui-app-v1',
    scan_date: GUN,
    window_days: 35,
    req_total: 0,
    services_total: 2,
    measured: 1,
    note: null,
    ...o,
  });
  const kos = (use) => by(run(disc, K(), { use }))['odeme-ui-app-v1'];
  for (const use of [
    [U('gbocpprod1'), U('gbocpprod2', { req_total: 900 })],
    [U('gbocpprod2', { req_total: 900 }), U('gbocpprod1')],
  ]) {
    const a = kos(use);
    assert.equal(
      a.istek,
      'var',
      `aktif/pasif: pasif cluster in 0 i secildi (${use[0].cluster} once)`,
    );
    assert.equal(a.reqShown, 900);
  }
  const yarim = kos([U('gbocpprod1', { measured: 0 }), U('gbocpprod2')]);
  assert.equal(yarim.istek, 'olculemedi', 'bir cluster olculemedi ve 0 istek: "yok" dendi');
  assert.equal(yarim.usage.olcum, '1/2');
  assert.equal(
    kos([U('gbocpprod1', { services_total: 0 }), U('gbocpprod2', { services_total: 0 })]).istek,
    'servis-yok',
  );
  assert.equal(kos([U('gbocpprod1'), U('gbocpprod2')]).istek, 'yok');
  // Ayni cluster in ESKI gunu yeni gununu ezmez (sira ne olursa olsun).
  assert.equal(
    kos([
      U('gbocpprod1', { req_total: 5, scan_date: '2026-09-28' }),
      U('gbocpprod1'),
      U('gbocpprod2'),
    ]).istek,
    'yok',
  );
  assert.equal(
    kos([
      U('gbocpprod1'),
      U('gbocpprod1', { req_total: 5, scan_date: '2026-09-28' }),
      U('gbocpprod2'),
    ]).istek,
    'yok',
  );
});

// ── ORTAM DISI TANIM (kullanici karari, 2026-10-02) ──────────────────────────────────
test('SR38 YALNIZ baska ortamin RP sinde tanimli: KENDI ortaminda tanimsiz/olculemedi; ORTAM_DISI uyari olarak kalir', () => {
  // ESKI BEKLENTI DEGISTI (bilerek): bu uygulama eskiden rp='tanimli', rpHost='0/2',
  // rpSorun=['ORTAM_DISI'] aliyordu ve 'tanimsiz' suzgecinde CIKMIYORDU - oysa kendi ortaminin
  // (TEST) RP'lerinde tanimi yok. Kullanici karari (2026-10-02): kendi ortaminda 'tanimsiz'
  // sayilsin (ortamin RP hostlari taranmamissa 'olculemedi'), baska ortamdaki tanim uyari.
  const disc = [A('kart-ui', 'kart-test')];
  const prodRp = PRX('GBRVPP07', 'kart-ui-kart-test.apps-t.fw.garanti.com.tr', {
    status: 'NON_PROD_TARGET',
  });
  const tam = [...RP.byEnv.TEST.map(IZ), prodRp];
  const r = run(disc, K({ cfg: tam }));
  const a = by(r)['kart-ui'];
  assert.equal(a.rp, 'tanimsiz', 'yalniz PROD RP de tanimli TEST uygulamasi tanimli sayildi');
  assert.equal(a.rpNeden, undefined);
  assert.deepEqual(a.rpSorun, ['ORTAM_DISI'], 'baska ortamdaki tanim uyarisi kayboldu');
  assert.deepEqual(a.rpOrtamDisi, ['PROD'], 'hangi ortamda tanimli oldugu yazilmiyor');
  assert.equal(a.rpIstek, 'uygulanamaz', 'kendi ortaminda tanimsiz uygulamada RP istegi soruldu');
  assert.equal(a.rpHost, undefined);
  assert.equal(r.appSummary.spaRp.tanimsiz, 1, 'ozet tanimsiz sayisina girmedi');
  // Ayrinti panelinde baska ortamin tanimi YINE listelenir (gerekce gorunur).
  const t = rpTanimlari(r.rpDetay, 'kart-test', 'kart-ui');
  assert.equal(t.length, 1);
  assert.equal(t[0].env, 'PROD');
  // Ortamin bir RP host'u taranmadi: tanimsiz DENMEZ (olculemedi + neden), uyari yine var.
  const b = by(run(disc, K({ cfg: [IZ('GBNGXT33'), prodRp] })))['kart-ui'];
  assert.equal(b.rp, 'olculemedi', 'T34 taranmamisken ortam disi tanimli uygulamaya tanimsiz dendi');
  assert.equal(b.rpNeden, 'host-taranmadi');
  assert.deepEqual(b.rpSorun, ['ORTAM_DISI']);
  // PROD uygulamasi yalniz TEST RP'de (LOC ns ile baglaniyor): PROD tam tarandi -> tanimsiz.
  const p = by(
    run(
      [A('odeme-ui', 'odeme-prod')],
      K({
        cfg: [...PROD_ALL.map(IZ), ...RP.byEnv.TEST.map(IZ), LOC('GBNGXT33', 'odeme-prod', 'odeme-ui')],
      }),
    ),
  )['odeme-ui'];
  assert.equal(p.rp, 'tanimsiz');
  assert.deepEqual(p.rpOrtamDisi, ['TEST']);
  // EDU (RP listesi yok) TEST RP'de tanimli: kapsam disi + uyari ('tanimli' DEGIL).
  const e = by(
    run(
      [A('edu-ui', 'kart-edu')],
      K({ cfg: [...RP.byEnv.TEST.map(IZ), LOC('GBNGXT33', 'kart-edu', 'edu-ui')] }),
    ),
  )['edu-ui'];
  assert.equal(e.rp, 'kapsam-disi');
  assert.equal(e.rpNeden, 'rp-listesi-yok');
  assert.deepEqual(e.rpSorun, ['ORTAM_DISI']);
  // Ortamsiz namespace: kendi ortami bilinmez, tanim 'tanimli' kalir ve ORTAM_DISI yazilmaz.
  const o = by(
    run([A('ortamsiz-ui', 'kart')], K({ cfg: [LOC('GBNGXT33', 'kart', 'ortamsiz-ui')] })),
  )['ortamsiz-ui'];
  assert.equal(o.rp, 'tanimli');
  assert.equal(o.rpSorun, undefined);
});

// KARISIK DURUM (K3, 2026-10-02): TEST uygulamasi TEST RP'de (GBNGXT33) tanimli ve olculmus
// gercek 0 (pencere 30 gun, sampled=0, iki TEST RP'si de tarandi); ayrica PROD RP'nin
// (GBRVPP07) test adresine proxy'si 900 istek aliyor.
const K3_DISC = [A('kart-ui', 'kart-test')];
const K3_PRX = PRX('GBRVPP07', 'kart-ui-kart-test.apps-t.fw.garanti.com.tr', {
  status: 'NON_PROD_TARGET',
});
const K3_CFG = [...RP.byEnv.TEST.map(IZ), LOC('GBNGXT33', 'kart-test', 'kart-ui'), K3_PRX];
const K3_KENDI0 = TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { first_seen: ESKI });
// Baska ortamin satirinda son istek ve KISA pencere (2 gun) var: ikisi de kendi satirina
// SIZMAMALI (rpSon / rpPencereSa yalniz kendi ortaminin olculen tanimlarindan).
const K3_DISI900 = TRF('GBRVPP07', 'GLOMO-PROD', '/x/', {
  req_7d: 900,
  req_24h: 90,
  last_seen: '20260930235959',
  first_seen: '20260929000000',
});
const k3 = (trf, cfg = K3_CFG) => by(run(K3_DISC, K({ cfg, trf })))['kart-ui'];

test('SR39 karisik durum (K3): karar ve sayilar YALNIZ kendi ortamindan; baska ortamin istegi rpReq7Disi (bilgi)', () => {
  // ESKI BEKLENTI DEGISTI (bilerek, K3): bu fixture eskiden rpIstek='var', rpReq7=900,
  // rpOlcum='2/2', rpYol=['include','proxy'], rpSorun=['NON_PROD_TARGET','ORTAM_DISI'] veriyordu
  // - RP istegi TUM tanimlarin (kendi + baska ortam) TOPLAMIYDI ("muhafazakar" secim). Kullanici
  // karari K1 baska ortamin tanimini YALNIZ UYARI sayar; K3 (orkestrator, K1'in dogal uzantisi)
  // bunu karisik duruma tasir: TEST'te olculmus gercek 0 alan TEST uygulamasi "istek yok"tur,
  // PROD RP'nin 900 istegi yalniz rpReq7Disi + ORTAM_DISI uyarisi olarak gorunur.
  const rr = run(K3_DISC, K({ cfg: K3_CFG, trf: [K3_KENDI0, K3_DISI900] }));
  const a = by(rr)['kart-ui'];
  assert.equal(a.rp, 'tanimli');
  assert.equal(a.rpHost, '1/2', 'baska ortamin hostu paya girdi');
  assert.deepEqual(a.rpYol, ['include'], 'baska ortamin tanim yolu (proxy) kendi yoluna girdi');
  // NON_PROD_TARGET baska ortamin (PROD RP) taniminin durumu: satirda yalniz ORTAM_DISI uyarisi;
  // o tanimin durumu ayrinti panelinde kendi satirinda.
  assert.deepEqual(a.rpSorun, ['ORTAM_DISI'], 'baska ortamin tanim durumu kendi sorununa girdi');
  assert.deepEqual(a.rpOrtamDisi, ['PROD']);
  assert.equal(a.rpIstek, 'yok', 'baska ortamin istegi kendi ortaminin kararina girdi (eski toplama)');
  assert.equal(a.rpIstekNeden, undefined);
  assert.equal(a.rpReq7, 0, 'baska ortamin istegi kendi sayisina eklendi');
  assert.equal(a.rpReq24, 0);
  assert.equal(a.rpOlcum, '1/1', 'baska ortamin tanimi olculebilir tanim sayisina girdi');
  assert.equal(a.rpSon, undefined, 'baska ortamin son istegi kendi satirina sizdi');
  assert.equal(a.rpPencereSa, 720, 'baska ortamin kisa penceresi kendi penceresini kisaltti');
  assert.equal(a.rpReq7Disi, 900, 'baska ortamin olculmus istegi bilgi olarak yazilmadi');
  // Ayrinti paneli baska ortamin tanimini ve olcumunu YINE listeler (bilgi kaybolmaz).
  const t = rpTanimlari(rr.rpDetay, 'kart-test', 'kart-ui');
  assert.deepEqual(
    t.map((d) => [d.env, d.trafik && d.trafik.req7]),
    [
      ['PROD', 900],
      ['TEST', 0],
    ],
  );
  assert.equal(rr.appSummary.spaRpIstek.yok, 1, 'ozet "istek yok" kirilimi K3 ile tutarsiz');
  assert.equal(rr.appSummary.spaRpIstek.var, undefined);
  // Kendi istegi de varsa: sayi YALNIZ kendi (50), 950 DEGIL; 'var' kendi istegiyle.
  const v = k3([TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { req_7d: 50, req_24h: 5 }), K3_DISI900]);
  assert.equal(v.rpIstek, 'var');
  assert.equal(v.rpReq7, 50, 'kendi sayisina baska ortamin istegi eklendi');
  assert.equal(v.rpReq24, 5);
  assert.equal(v.rpReq7Disi, 900);
  // Kendi penceresi kisa (0, 2 gun): 'kismi' kalir; 900 kismi'yi 'var'a CEVIRMEZ.
  const k = k3([TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { first_seen: '20260929000000' }), K3_DISI900]);
  assert.equal(k.rpIstek, 'kismi');
  assert.deepEqual(k.rpIstekNeden, ['pencere']);
  assert.equal(k.rpReq7, 0);
  assert.equal(k.rpReq7Disi, 900);
  // Yalniz kendi ortaminda tanimliysa alan YAZILMAZ.
  const kendi = k3([K3_KENDI0], K3_CFG.slice(0, -1));
  assert.equal(kendi.rpReq7Disi, undefined);
  assert.equal(kendi.rpIstek, 'yok');
  // Baska ortamdaki tanim OLCULEMEDIYSE (LOADERR) bilgi yazilmaz - olculmeyene 0 yazilmaz;
  // kendi karari bundan ETKILENMEZ (eskiden '2/2' yerine '1/2' olup 'olculemedi' oluyordu).
  const olcmedi = k3([K3_KENDI0, LOADERR('GBRVPP07', 'GLOMO-PROD', 'log dosyasi yok')]);
  assert.equal(olcmedi.rpReq7Disi, undefined);
  assert.equal(olcmedi.rpIstek, 'yok', 'baska ortamin olculemeyen tanimi kendi kararini dusurdu');
  assert.equal(olcmedi.rpOlcum, '1/1');
  // Baska ortamin olculmus 0'i bilgi olarak YAZILMAZ (kisa pencerede "7 gunde yok" degil).
  const sifir = k3([K3_KENDI0, TRF('GBRVPP07', 'GLOMO-PROD', '/x/', { first_seen: '20260930000000' })]);
  assert.equal(sifir.rpReq7Disi, undefined, 'baska ortamin (alt sinir) 0 i bilgi olarak yazildi');
});

// ── YENI PROD DIZIN TANIMI: HOST KIPI (sozlesme 2026-10-02) ─────────────────────────────
// nginx_spa_traffic.sh host kipi: uygulama basina vhost (conf.d/<app>-<ns>.conf) ortak log'da
// Host/SNI ile sayilir. Satir: vhost=<app>-<ns>, location='@'+server_name, service/env NULL.
// Kova: vhost='_' ('@_' eslesmeyen Host, '@ip', '@-' alansiz) - uygulamaya EKLENMEZ.
const HTRF = (host, vhost, o = {}) => ({
  host,
  vhost,
  service: null,
  env: null,
  location: `@${String(vhost).toLowerCase()}.irp.garantibbva.com.tr`,
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: ESKI,
  scan_date: GUN,
  ...o,
});
/** HLOADERR: sayilar NULL, error dolu; vhost '*' KULLANILMAZ. */
const HERR = (host, vhost, msg) => ({
  ...HTRF(host, vhost),
  req_24h: null,
  req_7d: null,
  hc_24h: null,
  first_seen: null,
  error: msg,
});
const HKOVA = (host, loc, req7) => ({ ...HTRF(host, '_'), location: loc, req_7d: req7 });
const DIZIN = (host, ns, app, o = {}) => ({
  host,
  namespace: ns,
  application: app,
  hys_deployed: 1,
  app_deployed: 1,
  conf_exists: 1,
  conf_name: `${app}-${ns}.conf`,
  scan_date: GUN,
  ...o,
});
const YP_APP = 'odeme-ui-app-v1';
const YP_NS = 'odeme-prod';
const YP_VH = `${YP_APP}-${YP_NS}`;
const ypKos = (trf, o = {}) => {
  const r = run(
    [A(YP_APP, YP_NS)],
    K({
      cfg: [...PROD_ALL.map(IZ), ...(o.cfg || [])],
      dir: o.dir || [DIZIN('GBNGXP40', YP_NS, YP_APP)],
      trf,
      ...(o.k || {}),
    }),
  );
  return { r, a: by(r)[YP_APP], t: rpTanimlari(r.rpDetay, YP_NS, YP_APP) };
};

test('SR40 dizin tanimi host kipi satirina baglanir: vhost=<app>-<ns> (harf duyarsiz), istek var / gercek 0', () => {
  const v = ypKos([
    HTRF('GBNGXP40', YP_VH, { req_7d: 120, req_24h: 12, hc_24h: 3, last_seen: '20260930101010' }),
  ]);
  assert.equal(v.a.rp, 'tanimli');
  assert.deepEqual(v.a.rpYol, ['dizin']);
  assert.equal(v.a.rpIstek, 'var', 'yeni PROD dizin tanimi hala olculmuyor');
  assert.equal(v.a.rpReq7, 120);
  assert.equal(v.a.rpReq24, 12);
  assert.equal(v.a.rpSon, '20260930101010');
  assert.equal(v.a.rpOlcum, '1/1');
  assert.equal(v.t[0].vhost, YP_VH, 'ayrinti panelinde eslesen vhost yok');
  assert.equal(v.t[0].trafik.ad, `${YP_VH}.irp.garantibbva.com.tr`, 'server_name gosterilmiyor');
  assert.equal(v.r.rpKapsam.hostKipi, true);
  // GERCEK 0: tam pencere, sampled=0, kova yok -> "istek yok".
  const s = ypKos([HTRF('GBNGXP40', YP_VH)]);
  assert.equal(s.a.rpIstek, 'yok');
  assert.equal(s.a.rpReq7, 0);
  assert.equal(s.a.rpPencereSa, 720);
  // Diskteki harf (Odeme-UI...) eslesmeyi bozmaz.
  assert.equal(ypKos([HTRF('GBNGXP40', 'Odeme-UI-App-V1-Odeme-Prod', { req_7d: 4 })]).a.rpIstek, 'var');
  // Yedek aday conf_name govdesi: conf.d ve application-confs ayni adla yazilir.
  const yedek = ypKos([HTRF('GBNGXP40', `${YP_VH}-2`, { req_7d: 7 })], {
    dir: [DIZIN('GBNGXP40', YP_NS, YP_APP, { conf_name: `${YP_VH}-2.conf` })],
  });
  assert.equal(yedek.a.rpIstek, 'var', 'conf_name govdesi denenmedi');
  // ek-prod ile baglanan dizin satiri (ns '-prod'suz): vhost dizin satirinin KENDI ns'iyle.
  const ek = ypKos([HTRF('GBNGXP40', `${YP_APP}-odeme`, { req_7d: 9 })], {
    dir: [DIZIN('GBNGXP40', 'odeme', YP_APP)],
  });
  assert.equal(ek.a.rpEsles, 'ek-prod');
  assert.equal(ek.a.rpIstek, 'var');
  // Pencere kurallari location kipiyle ayni: sampled=1 / kisa pencere / first_seen yok -> kismi.
  for (const o of [{ sampled: 1 }, { first_seen: '20260930220000' }, { first_seen: null }]) {
    const k = ypKos([HTRF('GBNGXP40', YP_VH, o)]).a;
    assert.equal(k.rpIstek, 'kismi', `0 istek alt sinir degil: ${JSON.stringify(o)}`);
    assert.deepEqual(k.rpIstekNeden, ['pencere']);
  }
  // 7 GUN SINIRI host kipinde de: 167 saat -> kismi(pencere), 168 saat -> yok (kova yok).
  const h167 = ypKos([HTRF('GBNGXP40', YP_VH, { first_seen: '20260924010000' })]).a;
  assert.equal(h167.rpIstek, 'kismi', 'host kipinde 167 saatlik 0 "yok" sayildi');
  assert.deepEqual(h167.rpIstekNeden, ['pencere']);
  const h168 = ypKos([HTRF('GBNGXP40', YP_VH, { first_seen: '20260924000000' })]).a;
  assert.equal(h168.rpIstek, 'yok');
  assert.equal(h168.rpPencereSa, 168);
});

test('SR41 host kipinde eslesme YOKSA olculemedi (0 DEGIL): satir yok / host kipi yok / host yok / HLOADERR / HOST|*', () => {
  const baska = HTRF('GBNGXP41', 'baska-app-odeme-prod'); // host kipi o gun calisti
  for (const [ad, trf, neden] of [
    ['vhost satiri yok', [HTRF('GBNGXP40', 'baska-app-odeme-prod')], 'satir-yok'],
    ['sunucuda hic satir yok', [baska], 'host'],
    [
      'sunucuda yalniz location kipi satiri',
      [TRF('GBNGXP40', 'GLOMO-PROD', '/glomo/'), baska],
      'host-kipi-yok',
    ],
    [
      'HLOADERR (access_log off)',
      [HERR('GBNGXP40', YP_VH, 'access_log off - vhost loglamiyor'), baska],
      'log',
    ],
    [
      'HOST|* tarih hatasi olcumu ezer',
      [HTRF('GBNGXP40', YP_VH, { req_7d: 5 }), LOADERR('GBNGXP40', '*', 'tarih hesaplanamadi')],
      'log',
    ],
  ]) {
    const { a, t } = ypKos(trf);
    assert.equal(a.rpIstek, 'olculemedi', `${ad}: olculemeyen dizin tanimi "${a.rpIstek}"`);
    assert.equal(a.rpReq7, undefined, `${ad}: olculemeyen hucreye sayi yazildi`);
    assert.equal(t[0].trafik.durum, 'olculemedi', ad);
    assert.equal(t[0].trafik.neden, neden, ad);
  }
  const herr = ypKos([HERR('GBNGXP40', YP_VH, 'access_log off - vhost loglamiyor')]).t[0];
  assert.match(herr.trafik.hata, /access_log off/, 'HLOADERR sebebi panele tasinmiyor');
  assert.equal(herr.vhost, YP_VH);
  // HLOADERR baska bir vhost'un location kipi hatasini ZEHIRLEMEZ (ayri haritalar).
  const loc = LOC('GBNGXP40', YP_NS, YP_APP, { vhost: 'GLOMO-PROD', location_path: '/odeme/' });
  const ayri = ypKos(
    [
      TRF('GBNGXP40', 'GLOMO-PROD', '/odeme/', { req_7d: 2 }),
      HERR('GBNGXP40', 'GLOMO-PROD', 'ayni adli host kipi hatasi'),
    ],
    { cfg: [loc], dir: [] },
  );
  assert.equal(ayri.a.rpIstek, 'var', 'host kipi hatasi location kipi olcumunu dusurdu');
  // Trafik tablosu okunamadi: dizin tanimi olculemedi ('kaynak-yok' DEGIL - kaynak var olabilir).
  const ok = ypKos(null, { k: { tablolar: { trf: 'okunamadi' } } });
  assert.equal(ok.a.rpIstek, 'olculemedi');
  assert.equal(ok.t[0].trafik.neden, 'okunamadi');
});

test('SR42 kova (eslesmeyen Host / IP / alansiz) uygulamaya EKLENMEZ ama o sunucudaki 0 i alt sinir yapar', () => {
  const sifir = HTRF('GBNGXP40', YP_VH);
  for (const loc of ['@_', '@ip', '@-']) {
    const { a, t, r } = ypKos([sifir, HKOVA('GBNGXP40', loc, 31)]);
    assert.equal(a.rpIstek, 'kismi', `${loc}: atanamayan istek varken "istek yok" dendi`);
    assert.deepEqual(a.rpIstekNeden, ['eslesmeyen-host']);
    assert.equal(a.rpReq7, 0, `${loc}: kova uygulamaya eklendi`);
    assert.equal(t[0].trafik.atanmamis, 31);
    const h = r.rpKapsam.hostlar.find((x) => x.host === 'GBNGXP40');
    assert.ok(h.kova, `${loc}: kova sunucu kapsaminda gorunmuyor`);
  }
  // Kova BASKA sunucudaysa bu tanimin 0'i etkilenmez.
  assert.equal(ypKos([sifir, HKOVA('GBNGXP41', '@_', 31)]).a.rpIstek, 'yok');
  // Istek varsa kova "var"i dusurmez.
  assert.equal(
    ypKos([HTRF('GBNGXP40', YP_VH, { req_7d: 3 }), HKOVA('GBNGXP40', '@_', 31)]).a.rpIstek,
    'var',
  );
  // Kova bir uygulamanin vhost'u sayilmaz ('_' adli dizin satiri yok sayilir).
  const kovaApp = ypKos([HKOVA('GBNGXP40', '@_', 31)]);
  assert.equal(kovaApp.t[0].trafik.neden, 'satir-yok');
});

test('SR43 eski analyzer (hicbir yerde "@" satiri yok): dizin tanimi kaynak-yok (eski davranis); yeni PROD servis vhost u location kipinde OLCULUR', () => {
  // Eski betik/analyzer: yeni PROD'da yalniz servis vhost'larinin LOAD satirlari var.
  const eski = ypKos([TRF('GBRVPP01', 'GLOMO-PROD', '/x/'), TRF('GBNGXP40', 'GLOMO-PROD', '/g/')]);
  assert.equal(eski.a.rpIstek, 'kaynak-yok', 'host kipi hic yokken dizin tanimi olculemedi/yok oldu');
  assert.equal(eski.t[0].trafik, null);
  assert.equal(eski.r.rpKapsam.hostKipi, false);
  const hostOf = (r, h) => r.rpKapsam.hostlar.find((x) => x.host === h);
  // Sunucu durumu: location kipi satiri olan yeni PROD sunucusu 'var' (servis vhost'lari
  // olculuyor); hic satiri olmayan yeni PROD sunucusu host kipi yokken 'kaynak-yok'.
  assert.equal(hostOf(eski.r, 'GBNGXP40').trafik, 'var');
  assert.equal(hostOf(eski.r, 'GBNGXP41').trafik, 'kaynak-yok');
  assert.equal(hostOf(eski.r, 'GBRVPP02').trafik, 'satir-yok', 'eski PROD kaynak-yok sayildi');
  // Host kipi calisinca: satiri olmayan yeni PROD sunucusu artik 'satir-yok' (olculemedi
  // tarafi), host kipi satir sayisi kapsamda.
  const yeni = ypKos([HTRF('GBNGXP40', YP_VH)]);
  assert.equal(hostOf(yeni.r, 'GBNGXP40').trafik, 'var');
  assert.equal(hostOf(yeni.r, 'GBNGXP40').hostKipi, 1);
  assert.equal(hostOf(yeni.r, 'GBNGXP41').trafik, 'satir-yok');
  // YENI PROD SERVIS VHOST'U (<SERVICE>-PROD.conf, location'li): location kipinde olculur
  // (eskiden rol 'prod-yeni' oldugu icin hep kaynak-yok'tu).
  const loc = LOC('GBNGXP40', YP_NS, YP_APP, { vhost: 'GLOMO-PROD', location_path: '/odeme/' });
  const s = ypKos([TRF('GBNGXP40', 'GLOMO-PROD', '/odeme/', { req_7d: 6 })], {
    cfg: [loc],
    dir: [],
  });
  assert.deepEqual(s.a.rpYol, ['include']);
  assert.equal(s.a.rpIstek, 'var', 'yeni PROD servis vhost u olculmuyor');
  // Eski PROD proxy + yeni PROD dizin, ikisi de olculmus 0 (tam pencere): artik "yok"
  // (eskiden dizin kaynak-yok oldugu icin hep 'kismi' idi - SR15).
  const iki = ypKos([TRF('GBRVPP01', 'GLOMO-PROD', '/x/'), HTRF('GBNGXP40', YP_VH)], {
    cfg: [PRX('GBRVPP01', `${YP_VH}.apps.fw.garanti.com.tr`)],
  });
  assert.deepEqual(iki.a.rpYol, ['dizin', 'proxy']);
  assert.equal(iki.a.rpIstek, 'yok');
  assert.equal(iki.a.rpOlcum, '2/2');
  // Biri olculemedi (HLOADERR) -> 'olculemedi'; biri istek aliyor -> 'var'.
  assert.equal(
    ypKos([TRF('GBRVPP01', 'GLOMO-PROD', '/x/'), HERR('GBNGXP40', YP_VH, 'log dosyasi yok: /web_log/spa-prod-bmw-nginx.log')], {
      cfg: [PRX('GBRVPP01', `${YP_VH}.apps.fw.garanti.com.tr`)],
    }).a.rpIstek,
    'olculemedi',
  );
});

// ── DOGRULAMA BULGULARI (2026-10-02) ──────────────────────────────────────────────────

test('SR45 conf_name yedegi BASKA uygulamanin vhost unu baglamaz: yalniz <app>-<ns>-N; kendi satiri yoksa olculemedi', () => {
  // Analyzer conf_name'i cekirdek eslesmesiyle yazar: 'ui/odeme-prod' satirina
  // 'kart-ui-odeme-prod.conf' (servis oneki 'kart' atilarak) dusebilir. Kosulsuz yedek,
  // ui'nin kendi vhost satiri yokken kart-ui'nin 500 istegini ui'ye "kesin var" yaziyordu.
  const H = 'GBNGXP40';
  const disc = [A('kart-ui', 'odeme-prod'), A('ui', 'odeme-prod')];
  const kos = (dir, trf) =>
    by(run(disc, K({ cfg: PROD_ALL.map(IZ), dir, trf })));
  const kartTrf = [HTRF(H, 'kart-ui-odeme-prod', { req_7d: 500 })];
  for (const [ad, dir] of [
    [
      'kart-ui dizini de var',
      [DIZIN(H, 'odeme-prod', 'kart-ui'), DIZIN(H, 'odeme-prod', 'ui', { conf_name: 'kart-ui-odeme-prod.conf' })],
    ],
    ['yalniz ui dizini', [DIZIN(H, 'odeme-prod', 'ui', { conf_name: 'kart-ui-odeme-prod.conf' })]],
  ]) {
    const r = run(disc, K({ cfg: PROD_ALL.map(IZ), dir, trf: kartTrf }));
    const ui = by(r).ui;
    assert.equal(ui.rpIstek, 'olculemedi', `${ad}: ui baska uygulamanin istegiyle "${ui.rpIstek}"`);
    assert.equal(ui.rpReq7, undefined, `${ad}: olculemeyen hucreye sayi yazildi`);
    const t = rpTanimlari(r.rpDetay, 'odeme-prod', 'ui')[0];
    assert.equal(t.trafik.neden, 'satir-yok', ad);
    assert.equal(t.vhost, '', `${ad}: tanim baska uygulamanin vhost una baglandi`);
  }
  assert.equal(
    kos([DIZIN(H, 'odeme-prod', 'kart-ui'), DIZIN(H, 'odeme-prod', 'ui')], kartTrf)['kart-ui'].rpReq7,
    500,
  );
  // '-N' yedegi BASKA bir dizin satirinin '<app>-<ns>'i ise aday degil (o ad onun vhost'u).
  const nKos = (dir) =>
    byNs(
      run(
        [A('x', 'y-prod'), A('x', 'y-prod-2')],
        K({ cfg: PROD_ALL.map(IZ), dir, trf: [HTRF(H, 'x-y-prod-2', { req_7d: 5 })] }),
      ),
    )['y-prod/x'];
  const ekli = DIZIN(H, 'y-prod', 'x', { conf_name: 'x-y-prod-2.conf' });
  assert.equal(
    nKos([ekli, DIZIN(H, 'y-prod-2', 'x')]).rpIstek,
    'olculemedi',
    "'-N' adi baska dizin satirinin vhost'u iken baglandi",
  );
  // Ayni ad baska bir dizin satirina ait DEGILSE '-N' yedegi gecerli (SR40 ile ayni kural).
  assert.equal(nKos([ekli]).rpIstek, 'var');
});

test('SR46 ayni conf.d adina iki dizin satiri (<app>-<ns> bolme carpismasi): trafik AYRILAMAZ, "kesin var" yazilmaz', () => {
  const H = 'GBNGXP40';
  const trf = [HTRF(H, 'kart-ui-x-prod', { req_7d: 42 })];
  const iki = [DIZIN(H, 'x-prod', 'kart-ui'), DIZIN(H, 'ui-x-prod', 'kart')];
  const r = by(run([A('kart-ui', 'x-prod'), A('kart', 'ui-x-prod')], K({ cfg: PROD_ALL.map(IZ), dir: iki, trf })));
  for (const app of ['kart-ui', 'kart']) {
    assert.equal(r[app].rp, 'tanimli', app);
    assert.equal(r[app].rpEsles, 'belirsiz', `${app}: carpisan dizin tanimi kesin sayildi`);
    assert.equal(r[app].rpIstek, 'ayrilamaz', `${app}: ayni 42 istek iki uygulamaya yazildi`);
    assert.equal(r[app].rpReq7, undefined, app);
  }
  // Diger satirin uygulamasi kesifte olmasa da ad isgal edilmis: yine ayrilamaz.
  const tek = by(run([A('kart-ui', 'x-prod')], K({ cfg: PROD_ALL.map(IZ), dir: iki, trf })))['kart-ui'];
  assert.equal(tek.rpIstek, 'ayrilamaz');
  // Carpisma yoksa kesin ve 'var'.
  const yalniz = by(
    run([A('kart-ui', 'x-prod')], K({ cfg: PROD_ALL.map(IZ), dir: iki.slice(0, 1), trf })),
  )['kart-ui'];
  assert.equal(yalniz.rpEsles, undefined);
  assert.equal(yalniz.rpIstek, 'var');
  assert.equal(yalniz.rpReq7, 42);
});

test('SR47 host kipinde sampled=1 kovadan geliyorsa (pencere tam) neden yalniz "eslesmeyen-host"; pencere kisaysa ikisi', () => {
  // nginx_spa_traffic.sh (2026-10-02): logda @_/@ip/@- istegi varsa o logun uygulamalari
  // sampled=1. Pencere tam iken bunun sebebi pencere DEGIL: ipucu "pencere kisa" demesin.
  const kova = HKOVA('GBNGXP40', '@ip', 31);
  const tam = ypKos([HTRF('GBNGXP40', YP_VH, { sampled: 1 }), kova]).a;
  assert.equal(tam.rpIstek, 'kismi');
  assert.deepEqual(tam.rpIstekNeden, ['eslesmeyen-host'], 'kova kaynakli sampled pencere diye yazildi');
  const kisa = ypKos([HTRF('GBNGXP40', YP_VH, { sampled: 1, first_seen: '20260930220000' }), kova]).a;
  assert.deepEqual(kisa.rpIstekNeden, ['pencere', 'eslesmeyen-host']);
  // Kova YOKSA sampled=1 pencere sayilir (eski veri okunamadi) - alt sinir dusmez.
  assert.deepEqual(ypKos([HTRF('GBNGXP40', YP_VH, { sampled: 1 })]).a.rpIstekNeden, ['pencere']);
  // Location kipi bu istisnayi ALMAZ: sampled=1 daima pencere.
  const loc = LOC('GBNGXP40', YP_NS, YP_APP, { vhost: 'GLOMO-PROD', location_path: '/odeme/' });
  const l = ypKos([TRF('GBNGXP40', 'GLOMO-PROD', '/odeme/', { sampled: 1 }), kova], { cfg: [loc], dir: [] }).a;
  assert.deepEqual(l.rpIstekNeden, ['pencere']);
});

// ── K3 (2026-10-02): KARISIK DURUMDA RP ISTEGI YALNIZ KENDI ORTAMININ TANIMLARINDAN ──────
// Baska ortamin olculmus istegi rpReq7Disi (bilgi) + ORTAM_DISI uyarisi; karari ve sayiyi
// DEGISTIRMEZ. Eski davranis (toplama) geri gelirse asagidaki her vaka kirmiziya doner.
test('SR48 K3: kendi ortaminin tanimi olculemediyse baska ortamin 900 istegi karari KURTARMAZ (olculemedi / kaynak-yok / ayrilamaz)', () => {
  // (b) Kendi tanimi LOADERR: eskiden PROD RP'nin 900 istegi satira 'var 900' yazdiriyordu.
  const b = k3([LOADERR('GBNGXT33', 'KART-TEST', 'log dosyasi yok: /web_log/kart.log'), K3_DISI900]);
  assert.equal(b.rp, 'tanimli');
  assert.equal(b.rpIstek, 'olculemedi', 'baska ortamin istegi kendi olculemeyen taniminin yerine gecti');
  assert.equal(b.rpOlcum, '0/1');
  assert.equal(b.rpReq7, undefined, 'olculemeyen hucreye sayi yazildi');
  assert.equal(b.rpReq24, undefined);
  assert.equal(b.rpReq7Disi, 900, 'baska ortamin istegi bilgi olarak da yazilmadi');
  // Kendi RP sunucusunun o gun hic trafik satiri yok (neden 'host'): yine olculemedi.
  const h = k3([K3_DISI900]);
  assert.equal(h.rpIstek, 'olculemedi');
  assert.equal(h.rpReq7, undefined);
  assert.equal(h.rpReq7Disi, 900);
  // kaynak-yok: PROD uygulamasinin kendi tanimi yalniz yeni PROD dizini ve o gun HICBIR yerde
  // host kipi satiri yok; TEST RP'deki (ortam disi) include tanimi 900 istek aliyor.
  const ky = ypKos([TRF('GBNGXT33', 'KART-TEST', `/${YP_APP}/`, { req_7d: 900 })], {
    cfg: [LOC('GBNGXT33', YP_NS, YP_APP)],
  }).a;
  assert.equal(ky.rp, 'tanimli');
  assert.deepEqual(ky.rpYol, ['dizin']);
  assert.deepEqual(ky.rpOrtamDisi, ['TEST']);
  assert.equal(ky.rpIstek, 'kaynak-yok', 'baska ortamin istegi olcum kaynagi olmayan kendi taniminin yerine gecti');
  assert.equal(ky.rpOlcum, undefined);
  assert.equal(ky.rpReq7, undefined);
  assert.equal(ky.rpReq7Disi, 900);
  // ayrilamaz: kendi (PROD dizin) tanimi conf.d ad carpismasiyla 'belirsiz' (SR46); TEST
  // RP'deki ortam disi tanim 900 istek aliyor -> yine 'ayrilamaz', sayi yok.
  const H = 'GBNGXP40';
  const ay = by(
    run(
      [A('kart-ui', 'x-prod'), A('kart', 'ui-x-prod')],
      K({
        cfg: [...PROD_ALL.map(IZ), LOC('GBNGXT33', 'x-prod', 'kart-ui')],
        dir: [DIZIN(H, 'x-prod', 'kart-ui'), DIZIN(H, 'ui-x-prod', 'kart')],
        trf: [
          HTRF(H, 'kart-ui-x-prod', { req_7d: 42 }),
          TRF('GBNGXT33', 'KART-TEST', '/kart-ui/', { req_7d: 900 }),
        ],
      }),
    ),
  )['kart-ui'];
  assert.equal(ay.rpIstek, 'ayrilamaz', 'baska ortamin istegi ayrilamayan kendi taniminin yerine gecti');
  assert.equal(ay.rpEsles, 'belirsiz');
  assert.equal(ay.rpReq7, undefined);
  assert.equal(ay.rpReq7Disi, 900);
});

test('SR49 K3: YALNIZ baska ortamda tanimli -> rp tanimsiz, rpIstek uygulanamaz; olculmus istegi yalniz rpReq7Disi (bilgi)', () => {
  // (c) SR38'in fixture'i + PROD RP tanimi 900 istek aliyor. Kendi ortaminin (TEST) RP'sinde
  // tanim yok: RP istegi sorulmaz ('uygulanamaz', ekranda gerekce "kendi ortaminin RP'sinde
  // tanim yok"); 900 karara ve sayiya girmez, yalniz bilgi.
  const cfgDisi = [...RP.byEnv.TEST.map(IZ), K3_PRX];
  const rr = run(K3_DISC, K({ cfg: cfgDisi, trf: [K3_DISI900] }));
  const c = by(rr)['kart-ui'];
  assert.equal(c.rp, 'tanimsiz');
  assert.equal(c.rpIstek, 'uygulanamaz', 'kendi ortaminda tanimsiz uygulamada RP istegi baska ortamdan hesaplandi');
  assert.deepEqual(c.rpSorun, ['ORTAM_DISI']);
  assert.deepEqual(c.rpOrtamDisi, ['PROD']);
  assert.equal(c.rpReq7Disi, 900, 'baska ortamin olculmus istegi bilgi olarak yazilmadi');
  for (const f of ['rpReq7', 'rpReq24', 'rpOlcum', 'rpIstekNeden', 'rpSon', 'rpPencereSa', 'rpYol', 'rpHost', 'rpEsles'])
    assert.equal(c[f], undefined, `${f} baska ortamin taniminden yazildi`);
  assert.equal(rr.appSummary.spaRp.tanimsiz, 1);
  assert.equal(rr.appSummary.spaRpIstek.uygulanamaz, 1);
  // Ortamin bir RP host'u taranmadi: rp 'olculemedi' (host-taranmadi), rpIstek yine
  // 'uygulanamaz' (mevcut tablo: kendi ortaminda tanim bulunamayan satirda istek sorulmaz);
  // 900 'olculemedi'yi de degistirmez.
  const o = k3([K3_DISI900], [IZ('GBNGXT33'), K3_PRX]);
  assert.equal(o.rp, 'olculemedi');
  assert.equal(o.rpNeden, 'host-taranmadi');
  assert.equal(o.rpIstek, 'uygulanamaz');
  assert.equal(o.rpReq7Disi, 900);
  // Baska ortamin tanimi olculemedi (LOADERR) ya da olculmus 0: bilgi yazilmaz.
  assert.equal(k3([LOADERR('GBRVPP07', 'GLOMO-PROD', 'izin yok')], cfgDisi).rpReq7Disi, undefined);
  assert.equal(k3([TRF('GBRVPP07', 'GLOMO-PROD', '/x/')], cfgDisi).rpReq7Disi, undefined);
  // Iki baska ortam tanimi: biri 900, biri olculemedi -> bilgi yalniz olculenin istegi (900);
  // olculemeyen tanim toplami bozmaz (NaN / 0 yazilmaz).
  const iki = k3(
    [K3_DISI900, LOADERR('GBRVPP08', 'GLOMO-PROD', 'izin yok')],
    [...cfgDisi, PRX('GBRVPP08', 'kart-ui-kart-test.apps-t.fw.garanti.com.tr', { location_path: '/y/' })],
  );
  assert.equal(iki.rpReq7Disi, 900);
  // Baska ortamin AYRILAMAYAN tanimi ('<app>-<ns>' carpismasi -> belirsiz): istegi bu
  // uygulamaninki diye bilgi olarak da yazilmaz.
  const bel = by(
    run(
      [A('kart-ui', 'x-prod'), A('kart', 'ui-x-prod')],
      K({
        cfg: [...PROD_ALL.map(IZ), LOC('GBNGXT33', '', 'kart-ui-x-prod')],
        trf: [TRF('GBNGXT33', 'KART-TEST', '/kart-ui-x-prod/', { req_7d: 900 })],
      }),
    ),
  );
  for (const app of ['kart-ui', 'kart']) {
    assert.deepEqual(bel[app].rpOrtamDisi, ['TEST'], `${app}: belirsiz tanim baglanmadi (test bos)`);
    assert.equal(bel[app].rpReq7Disi, undefined, `${app}: ayrilamayan tanimin istegi yazildi`);
  }
});

test('SR50 K3: ozet kirilimlari suzgec kodlariyla tutarli; baska ortamin zayif/sorunlu tanimi kendi rpYol / rpEsles / rpSorun una girmez', () => {
  // (d) Uc TEST uygulamasi, hepsinde PROD RP'nin test adresine proxy'si 900 istek aliyor:
  //   a-ui  kendi TEST tanimi olculmus gercek 0  -> 'yok'
  //   b-ui  kendi TEST tanimi LOADERR            -> 'olculemedi'
  //   c-ui  kendi ortaminda tanim yok            -> rp 'tanimsiz', rpIstek 'uygulanamaz'
  // Eski toplama davranisinda ucu de 'var 900' idi; "RP istegi var" suzgeci ucunu getirirdi.
  const prx = (app, loc) =>
    PRX('GBRVPP07', `${app}-kart-test.apps-t.fw.garanti.com.tr`, {
      location_path: loc,
      status: 'NON_PROD_TARGET',
    });
  const cfg = [
    ...RP.byEnv.TEST.map(IZ),
    LOC('GBNGXT33', 'kart-test', 'a-ui'),
    LOC('GBNGXT33', 'kart-test', 'b-ui', { vhost: 'B-TEST' }),
    prx('a-ui', '/a/'),
    prx('b-ui', '/b/'),
    prx('c-ui', '/c/'),
  ];
  const trf = [
    TRF('GBNGXT33', 'KART-TEST', '/a-ui/'),
    LOADERR('GBNGXT33', 'B-TEST', 'izin yok'),
    ...['/a/', '/b/', '/c/'].map((l) => TRF('GBRVPP07', 'GLOMO-PROD', l, { req_7d: 900 })),
  ];
  const r = run([A('a-ui', 'kart-test'), A('b-ui', 'kart-test'), A('c-ui', 'kart-test')], K({ cfg, trf }));
  const b = by(r);
  assert.deepEqual(
    ['a-ui', 'b-ui', 'c-ui'].map((x) => [b[x].rp, b[x].rpIstek, b[x].rpReq7, b[x].rpReq7Disi]),
    [
      ['tanimli', 'yok', 0, 900],
      ['tanimli', 'olculemedi', undefined, 900],
      ['tanimsiz', 'uygulanamaz', undefined, 900],
    ],
  );
  // Ozet kirilimi (ust bant ve suzgec seceneklerindeki sayilar) satirlarla ayni kodlari sayar.
  assert.deepEqual(r.appSummary.spaRpIstek, { yok: 1, olculemedi: 1, uygulanamaz: 1 });
  assert.deepEqual(r.appSummary.spaRp, { tanimli: 2, tanimsiz: 1 });
  // PROD uygulamasi: kendi PROD proxy tanimi kesin ve sorunsuz; TEST RP'de namespace'siz (flat)
  // include tanimi 'ad' eslesmesiyle ve BROKEN_INCLUDE durumuyla bagli. Eskiden satir
  // rpYol=['include','proxy'], rpEsles='ad', rpSorun=['BROKEN_INCLUDE','ORTAM_DISI'] aliyordu.
  const p = by(
    run(
      [A('odeme-ui', 'odeme-prod')],
      K({
        cfg: [
          PRX('GBRVPP07', 'odeme-ui-odeme-prod.apps.fw.garanti.com.tr'),
          LOC('GBNGXT33', '', 'odeme-ui-odeme-prod', { status: 'BROKEN_INCLUDE' }),
        ],
      }),
    ),
  )['odeme-ui'];
  assert.equal(p.rp, 'tanimli');
  assert.deepEqual(p.rpYol, ['proxy'], 'baska ortamin tanim yolu kendi yoluna girdi');
  assert.equal(p.rpEsles, undefined, 'baska ortamin zayif eslesmesi kendi kararini zayif gosterdi');
  assert.deepEqual(p.rpSorun, ['ORTAM_DISI'], 'baska ortamin tanim durumu kendi sorununa girdi');
  assert.deepEqual(p.rpOrtamDisi, ['TEST']);
});

// ── UC NOKTA HESABI: SAHTE mssql ile DAVRANIS (DB yok) ────────────────────────────────
// spaKesfiHesapla gercek sorgu metinlerini kosar; sahte query metne gore satir dondurur ya da
// DUSER. Boylece "sorgu dustu -> olculemedi" uc noktanin kendisinde (Promise.all, sema,
// parametreler) dogrulanir, yalniz saf fonksiyonda degil.
const Module = require('node:module');
const MSSQL = require.resolve('../../inventory/mssql.cjs');
function sahteDb(ayar = {}) {
  const sorgular = [];
  const query = async (text, inputs = []) => {
    const t = normalize(text);
    sorgular.push({ t, hostlar: inputs.map((i) => i.value) });
    const ver = (rows) => ({ recordset: rows });
    const dus = (ad) => {
      if ((ayar.dus || []).includes(ad)) throw new Error(`${ad} dustu`);
    };
    const hostlar = new Set(inputs.map((i) => i.value));
    const suz = (rows) => (rows || []).filter((r) => hostlar.has(r.host));
    if (t.includes("OBJECT_ID('dbo.BMW_Spa_Discovery') AS oid")) return ver([{ oid: 1 }]);
    if (t.includes('MAX(scan_date), 23) AS d FROM dbo.BMW_Spa_Discovery')) return ver([{ d: GUN }]);
    if (t.includes("COL_LENGTH('dbo.BMW_Spa_Discovery', 'match_by') AS mb")) {
      dus('sema');
      return ver([
        { mb: 1, run: null, cfg: 1, dir: 1, trf: 1, ups: 1, prx: 4, fs: 40, ...ayar.sema },
      ]);
    }
    if (t.includes('FROM dbo.BMW_Spa_Discovery d')) return ver(ayar.disc || T_DISC);
    if (t.includes('FROM dbo.BMW_Openshift_Route_Inventory')) return (dus('envanter'), ver([]));
    if (t.includes('FROM dbo.BMW_Application_Usage')) return (dus('dynatrace'), ver([]));
    if (t.includes('FROM dbo.Nginx_Config_Audit'))
      return (dus('cfg'), ver(suz(ayar.cfg || T_TANIM)));
    if (t.includes('FROM dbo.Nginx_Intranet_Audit')) return (dus('dir'), ver(suz(ayar.dir)));
    if (t.includes('FROM dbo.Nginx_Audit_Upstreams')) return (dus('ups'), ver(suz(ayar.ups)));
    if (t.includes('FROM dbo.Nginx_Spa_Traffic')) return (dus('trf'), ver(suz(ayar.trf)));
    throw new Error('beklenmeyen sorgu: ' + t.slice(0, 80));
  };
  const m = new Module(MSSQL);
  m.filename = MSSQL;
  m.loaded = true;
  m.exports = { query, sql: { NVarChar: (n) => ({ n }) } };
  require.cache[MSSQL] = m;
  return sorgular;
}
const { _spaKesfiHesaplaForTest: hesapla } = require('../index.cjs');
const sorgusu = (sq, tablo) => sq.find((x) => x.t.includes(`FROM dbo.${tablo}`));

test('SR24 uc nokta: envanter / Dynatrace / config sorgusu DUSERSE olculemedi; host parametreleri', async () => {
  let sq = sahteDb({ dus: ['envanter', 'dynatrace'] });
  let r = await hesapla();
  let b = by(r);
  assert.equal(b['kart-ui'].inventory, 'olculemedi', 'envanter hatasi "kayitli degil" gorundu');
  assert.equal(b['kart-ui'].istek, 'olculemedi', 'Dynatrace hatasi "olcum yok" gorundu');
  assert.equal(r.rpKapsam.envanterOkunamadi, true);
  assert.equal(r.rpKapsam.dynatraceOkunamadi, true);
  // Diger kaynaklar etkilenmez: RP karari yine verilir.
  assert.equal(b['kart-ui'].rp, 'tanimli');
  assert.equal(b['bos-ui'].rp, 'tanimsiz');
  assert.ok(r.rpDetay instanceof Map, 'ayrinti haritasi uc nokta sonucunda yok');
  assert.ok(!Object.keys(r).includes('rpDetay'), 'ayrinti haritasi JSON a girer');
  // HOST SUZGECI parametreli: config ve trafik tum internet RP'ler. Trafik 2026-10-02'ye
  // kadar yalniz non-prod + eski PROD'du; yeni PROD artik olculur (servis vhost'lari location
  // kipinde, uygulama vhost'lari host kipinde) - okunmazsa dizin tanimlari hep 'kaynak-yok'.
  assert.equal(sorgusu(sq, 'Nginx_Config_Audit').hostlar.length, RP.all.size);
  assert.deepEqual(new Set(sorgusu(sq, 'Nginx_Spa_Traffic').hostlar), RP.all);
  assert.deepEqual(new Set(sorgusu(sq, 'Nginx_Intranet_Audit').hostlar), RP.prodNew);
  // UPSTREAM TUM INTERNET RP'LERDEN (dogrulama bulgusu, 2026-10-01): non-prod RP'lerde de
  // takma adli proxy_pass var; yalniz eski PROD'u okumak onlari hic cozulemez birakirdi.
  assert.deepEqual(new Set(sorgusu(sq, 'Nginx_Audit_Upstreams').hostlar), RP.all);

  sahteDb({ dus: ['cfg'] });
  r = await hesapla();
  assert.equal(r.rpKapsam.tablolar.cfg, 'okunamadi');
  assert.equal(by(r)['bos-ui'].rp, 'olculemedi', 'config sorgusu dusunce tanimsiz dendi');
  assert.equal(by(r)['bos-ui'].rpNeden, 'okunamadi:config');
});

test('SR24b uc nokta: upstream sorgusu DUSERSE takma adli PROD proxy li uygulama "tanimsiz" olmaz', async () => {
  const disc = [A('eski-portal', 'odeme-prod')];
  const cfg = [...PROD_ALL.map(IZ), PRX('GBRVPP02', 'onur')];
  const ups = [
    {
      host: 'GBRVPP02',
      name: 'onur',
      server: 'eski-portal-odeme-prod.apps.fw.garanti.com.tr:443',
      scan_date: GUN,
    },
  ];
  sahteDb({ disc, cfg, ups });
  let r = await hesapla();
  assert.equal(by(r)['eski-portal'].rp, 'tanimli', 'kontrol: upstream okundu, takma ad cozuldu');
  sahteDb({ disc, cfg, ups, dus: ['ups'] });
  r = await hesapla();
  assert.equal(r.rpKapsam.tablolar.ups, 'okunamadi');
  assert.equal(by(r)['eski-portal'].rp, 'olculemedi', 'upstream sorgusu dusunce tanimsiz dendi');
  assert.equal(by(r)['eski-portal'].rpNeden, 'okunamadi:upstream');
});

test('SR25 uc nokta: sema sorgusu dusunce tablolar "okunamadi" (yok DEGIL); tablo yoksa sorgu atilmaz', async () => {
  let sq = sahteDb({ dus: ['sema'] });
  let r = await hesapla();
  assert.deepEqual(r.rpKapsam.tablolar, {
    cfg: 'okunamadi',
    dir: 'okunamadi',
    trf: 'okunamadi',
    ups: 'okunamadi',
  });
  assert.equal(by(r)['bos-ui'].rp, 'olculemedi');
  assert.equal(by(r)['bos-ui'].rpNeden, 'okunamadi:config', 'sema bilinmezken "tablo yok" dendi');
  assert.equal(sorgusu(sq, 'Nginx_Config_Audit'), undefined);

  sq = sahteDb({ sema: { cfg: null, prx: 0 } });
  r = await hesapla();
  assert.equal(sorgusu(sq, 'Nginx_Config_Audit'), undefined, 'olmayan tabloya sorgu atildi');
  assert.equal(r.rpKapsam.tablolar.cfg, 'yok');
  assert.equal(by(r)['bos-ui'].rpNeden, 'tablo-yok:config');

  // Kolon yoksa adi yazilmaz (derleme aninda 'Invalid column name'): NULL secilir.
  sq = sahteDb({ sema: { prx: 3, fs: null } });
  await hesapla();
  assert.ok(sorgusu(sq, 'Nginx_Config_Audit').t.includes('CAST(NULL AS NVARCHAR(16)) AS kind'));
  assert.ok(
    sorgusu(sq, 'Nginx_Spa_Traffic').t.includes('CAST(NULL AS NVARCHAR(20)) AS first_seen'),
  );
});

// UC ISLEYICILERI: sahte req/res (onbellek ara katmani haric; o response-cache testlerinde).
const nc = require('../index.cjs');
const uclar = nc._spaUclariForTest;
const cagir = (isleyici, query) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(body) {
        resolve({ code: this.statusCode, body: JSON.parse(JSON.stringify(body)) });
        return this;
      },
      setHeader() {},
    };
    Promise.resolve(isleyici({ query }, res)).catch(reject);
  });
const tamHesapSayisi = (sq) =>
  sq.filter((x) => x.t.includes('FROM dbo.BMW_Spa_Discovery d')).length;

test('SR34 uc nokta govdesi: varsayilanlar yazilmaz (istemci doldurur), route satirlari yalniz ?satir=1 ile', async () => {
  nc._spaSifirlaForTest();
  sahteDb({ disc: [...T_DISC, A('api-svc', 'kart-test', { is_spa: 0 })] });
  const g = await cagir(uclar.kesif, {});
  assert.equal(g.code, 200);
  assert.ok(!('rows' in g.body), 'route satirlari ?satir=1 olmadan gonderildi');
  const api = g.body.apps.find((a) => a.application === 'api-svc');
  assert.ok(api && !('rp' in api) && !('rpIstek' in api), 'varsayilan rp/rpIstek govdeye yazildi');
  assert.ok(!('staleClusters' in api), 'bos dizi govdeye yazildi');
  // Ayni kod: yalniz VARSAYILAN olmayan deger yazilir.
  assert.equal(g.body.apps.find((a) => a.application === 'bos-ui').rp, 'tanimsiz');
  const g2 = await cagir(uclar.kesif, { satir: '1' });
  assert.ok(
    Array.isArray(g2.body.rows) && g2.body.rows.length === 3,
    '?satir=1 route satirlarini getirmedi',
  );
  nc._spaSifirlaForTest();
});

test('SR36 ayrinti ucu: bellek ozeti yokken AYNI ANDA gelen tiklamalar TEK tam hesap baslatir', async () => {
  nc._spaSifirlaForTest();
  let sq = sahteDb();
  const q = { ns: 'kart-test', app: 'kart-ui' };
  const uc = await Promise.all([1, 2, 3].map(() => cagir(uclar.ayrinti, q)));
  assert.equal(tamHesapSayisi(sq), 1, 'eszamanli uc tiklama ayri tam hesap baslatti');
  assert.deepEqual(
    uc.map((s) => s.code),
    [200, 200, 200],
  );
  assert.equal(new Set(uc.map((s) => s.body.hesaplandi)).size, 1, 'yanitlar farkli hesaplardan');
  assert.equal(uc[0].body.tanimlar.length, 2);
  // Bellek ozeti tazeyken ayrinti ucu SORGU ATMAZ.
  const once = sq.length;
  await cagir(uclar.ayrinti, q);
  assert.equal(sq.length, once, 'taze bellek ozetine ragmen sorgu atildi');
  // Ana uc ile ayrinti ucu ayni anda (sayfa acilisi + hizli tiklama): yine tek hesap.
  nc._spaSifirlaForTest();
  sq = sahteDb();
  const [ana, ayr] = await Promise.all([cagir(uclar.kesif, {}), cagir(uclar.ayrinti, q)]);
  assert.equal(tamHesapSayisi(sq), 1, 'ana uc ve ayrinti ucu ayri hesap kosturdu');
  assert.equal(ana.body.hesaplandi, ayr.body.hesaplandi, 'satir ve panel farkli hesaptan');
  nc._spaSifirlaForTest();
});

test('SR44 uc nokta: yeni PROD trafik satirlari okunur; "@" satiri varsa dizin tanimi olculur, yoksa kaynak-yok; panel olcumu tasir', async () => {
  const disc = [A(YP_APP, YP_NS)];
  const cfg = PROD_ALL.map(IZ);
  const dir = [DIZIN('GBNGXP40', YP_NS, YP_APP)];
  // Eski analyzer: '@' satiri yok -> eski davranis (kaynak-yok).
  sahteDb({ disc, cfg, dir, trf: [TRF('GBRVPP01', 'GLOMO-PROD', '/x/')] });
  let r = await hesapla();
  assert.equal(by(r)[YP_APP].rpIstek, 'kaynak-yok');
  assert.equal(r.rpKapsam.hostKipi, false);
  // Host kipi satiri: sahte DB satirlari host parametresine gore suzer - GBNGXP40 sorgunun
  // host listesinde degilse satir gelmez ve bu kontrol kirmiziya doner.
  nc._spaSifirlaForTest();
  sahteDb({ disc, cfg, dir, trf: [HTRF('GBNGXP40', YP_VH, { req_7d: 42, req_24h: 4 })] });
  const g = await cagir(uclar.kesif, {});
  const satir = g.body.apps.find((a) => a.application === YP_APP);
  assert.equal(satir.rpIstek, 'var', 'uc nokta yeni PROD host kipi satirini okumuyor');
  assert.equal(satir.rpReq7, 42);
  assert.equal(g.body.rpKapsam.hostKipi, true);
  const p = await cagir(uclar.ayrinti, { ns: YP_NS, app: YP_APP });
  assert.equal(p.code, 200);
  assert.equal(p.body.kapsam.hostKipi, true, 'ayrinti ucu host kipi durumunu tasimiyor');
  assert.equal(p.body.tanimlar[0].vhost, YP_VH);
  assert.equal(p.body.tanimlar[0].trafik.req7, 42);
  assert.equal(p.body.tanimlar[0].trafik.ad, `${YP_VH}.irp.garantibbva.com.tr`);
  nc._spaSifirlaForTest();
});

// ── UC NOKTA VE EKRAN SOZLESMESI (metin bekcileri; normalize ile bicimden bagimsiz) ──────
test('SR22 uc nokta: okunamadi null olur, en yeni tarama DB de secilir, onbellek ve ayrinti ucu bagli', () => {
  const src = normalize(read('server/nginx-console/index.cjs'));
  const bas = src.indexOf('async function spaKesfiHesapla()');
  const son = src.indexOf('function spaMemoYaz(');
  assert.ok(bas > 0 && son > bas, 'spaKesfiHesapla bulunamadi');
  const govde = src.slice(bas, son);
  assert.ok(
    !govde.includes('.catch(() => [])'),
    'bir kaynak hatayi [] ile yutuyor (olculemedi = yok karisir)',
  );
  assert.match(
    govde,
    /const yoksaNull = \(p\) =>\s*p\.then\(\(r\) => r\.recordset \|\| \[\]\)\.catch\(\(\) => null\);/,
  );
  // Envanter ve Dynatrace sorgulari yoksaNull ile sarili (eskiden .catch(() => []) idi).
  assert.match(
    govde,
    /yoksaNull\(\s*query\(\s*`SELECT cluster_name, namespace_name, route_name, route_address, termination_type FROM dbo\.BMW_Openshift_Route_Inventory`/,
    'route envanteri hatasi null a cevrilmiyor',
  );
  // Dynatrace: hata null'a cevrilir VE secim CLUSTER basina yapilir (tablonun tekil anahtari
  // scan_date, cluster, namespace, app). Bolumlemeden cluster cikarsa ayni gunun prod1/prod2
  // satirlari arasinda secim belirsizlesir (pasif cluster'in 0'i "istek yok" gorunur).
  assert.match(
    govde,
    /yoksaNull\(\s*query\(\s*`SELECT cluster, namespace, app, scan_date[^`]*FROM dbo\.BMW_Application_Usage/,
    'Dynatrace hatasi null a cevrilmiyor (ya da cluster kolonu secilmiyor)',
  );
  assert.match(
    govde,
    /ROW_NUMBER\(\) OVER \(PARTITION BY cluster, namespace, app ORDER BY scan_date DESC\) AS rn\s+FROM dbo\.BMW_Application_Usage/,
    'Dynatrace en yeni satiri CLUSTER basina secilmiyor',
  );
  for (const t of [
    'Nginx_Config_Audit',
    'Nginx_Intranet_Audit',
    'Nginx_Audit_Upstreams',
    'Nginx_Spa_Traffic',
  ]) {
    assert.ok(
      govde.includes(
        `FROM dbo.${t} WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.${t}) AND host IN (`,
      ),
      `${t}: en yeni tarama veritabaninda secilmiyor / host suzgeci yok`,
    );
  }
  // 2026-10-06: altinci arguman cluster katalogu (kapsam oraninin paydasi).
  assert.ok(govde.includes('buildSpaDiscovery(disc, inv, usage, runs, rpKaynak, katalog)'));
  assert.match(
    src,
    /router\.get\(\s*'\/spa-discovery',\s*spaCache\.middleware,\s*spaKesfiUcu\s*\);/,
    'yanit onbellegi /spa-discovery ucuna bagli degil',
  );
  assert.ok(src.includes('const spaCache = createResponseCache();'));
  assert.match(
    src,
    /router\.get\(\s*'\/spa-discovery\/rp',\s*spaRpAyrintiUcu\s*\);/,
    'ayrinti ucu yok',
  );
  assert.ok(src.includes('rpTanimlari(memo.detay, ns, app)'));
  // Govde KUCULTULUR ve route satirlari yalniz ?satir=1 ile gider (davranis: SR34).
  assert.ok(
    src.includes(
      "res.json(spaYanitGovdesi(sonuc, { satir: String(req.query.satir || '') === '1' }));",
    ),
    'ana uc govdeyi spaYanitGovdesi ile kurmuyor',
  );
});

test('SR23 ekran: uc yeni kolon ve suzgec, ayrinti paneli, Yenile onbellegi atlar', () => {
  const ui = normalize(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const api = normalize(read('src/api/nginxConsoleApi.ts'));
  const var_ = (s, parca, mesaj) => assert.ok(s.includes(parca), mesaj + ' :: ' + parca);
  var_(
    ui,
    'nginxConsoleApi.spaRp(a.namespace, a.application',
    'satira tiklayinca ayrinti istenmiyor',
  );
  var_(ui, 'onClick={() => onSec(anahtar(a))}', 'satir tiklanabilir degil');
  var_(ui, 'yukle(true)', 'Yenile onbellegi atlamiyor');
  var_(api, "fresh ? '?fresh=1' : ''", 'api fresh=1 gondermiyor');
  var_(
    api,
    '/spa-discovery/rp?ns=${encodeURIComponent(ns)}&app=${encodeURIComponent(app)}',
    'ayrinti ucu cagrisi yok',
  );
  // 2026-10-03: basliklar KOLONLAR tablosundan (kolon basina ipucu); "Uygulama istegi"
  // kolonunun IPUCU Dynatrace oldugunu soyler (alt satirdaki 'Dynatrace' yetmez, ipucu sart).
  assert.match(
    ui,
    /baslik: 'Uygulama isteği',[^}]*ipucu: '[^']*Dynatrace/,
    '"Uygulama istegi" basliginin ipucu Dynatrace oldugunu soylemiyor',
  );
  // OLCULEMEDI ile YOK/TANIMSIZ ayri etiketlenir - her etiket KENDI haritasinda aranir
  // (DURUM_ETIKETI'nde de "kismi" var; tum dosyada aramak bekciyi kor yapardi).
  const blok = (bas, son) => {
    const i = ui.indexOf(bas);
    const j = ui.indexOf(son, i + 1);
    assert.ok(i >= 0 && j > i, `blok bulunamadi: ${bas}`);
    return ui.slice(i, j);
  };
  const rpE = blok('const RP_ETIKET', 'const RPI_ETIKET');
  for (const k of [
    "tanimsiz: { t: 'tanımsız'",
    "olculemedi: { t: 'ölçülemedi'",
    "'kapsam-disi': { t: 'kapsam dışı'",
  ])
    var_(rpE, k, 'RP etiketi eksik');
  const rpiE = blok('const RPI_ETIKET', 'const YOL_ADI');
  for (const k of [
    "yok: { t: 'istek yok'",
    "kismi: { t: 'kısmi'",
    "olculemedi: { t: 'ölçülemedi'",
    "'kaynak-yok': { t: 'ölçüm kaynağı yok'",
  ])
    var_(rpiE, k, 'RP istegi etiketi eksik');
  var_(ui, "a.istek === 'servis-yok'", 'Dynatrace servisi yok ayri gosterilmiyor');
});

test('SR37 ekran: satir memo bileseni, sabit onSec; acik panel tablo surumune bagli', () => {
  // Davranis bekcisi vitest'te (NginxSpaDiscovery.test.tsx "satir memo": tiklamada sayi
  // bicimleme sayaci). Bu metin bekcisi, o test kosmayan bir ortamda da yapinin durdugunu soyler.
  const ui = normalize(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  assert.ok(ui.includes('const SpaSatir = memo(function SpaSatir('), 'satir memo bileseni yok');
  assert.match(
    ui,
    /const onSec = useCallback\(\s*\(key: string\) => setSecili\(\(s\) => \(s === key \? null : key\)\),\s*\[\],?\s*\);/,
    'onSec sabit degil (memo her satiri yeniden cizer)',
  );
  assert.match(
    ui,
    /<SpaSatir\s+key=\{anahtar\(a\)\}[^>]*\sonSec=\{onSec\}/,
    'satirlar memo bileseniyle cizilmiyor',
  );
  // "Yenile" sonrasi acik panel yeniden cekilir: surum bagimlilikta.
  assert.match(
    ui,
    /\[a\.namespace, a\.application, surum\],?\s*\);/,
    'ayrinti paneli tablo surumune bagli degil',
  );
  assert.ok(
    ui.includes('d.hesaplandi !== tabloHesap'),
    'panel hesabini tablo hesabiyla karsilastirmiyor',
  );
});

test('SR27 govdede yazilmayan varsayilanlar istemcide AYNI degerle geri doldurulur (liste esitligi)', () => {
  // Gidis-donus davranisi vitest'te (sunucunun spaYanitGovdesi -> istemcinin spaUygulamaDoldur);
  // burada iki LISTE esitlenir: biri degisip oteki unutulursa ekran ya coker ya da
  // "uygulanamaz" satiri "olculemedi" gosterir.
  const api = normalize(read('src/api/nginxConsoleApi.ts'));
  const v = api.match(/export const SPA_YANIT_VARSAYILAN = \{([^}]*)\} as const/);
  assert.ok(v, 'istemci varsayilan listesi (SPA_YANIT_VARSAYILAN) yok');
  const istemci = {};
  for (const m of v[1].matchAll(/(\w+): (?:'([^']*)'|(true|false|null))/g))
    istemci[m[1]] = m[2] !== undefined ? m[2] : JSON.parse(m[3]);
  assert.deepEqual(istemci, { ...YANIT_VARSAYILAN }, 'sunucu ve istemci varsayilanlari ayristi');
  const d = api.match(/export const SPA_YANIT_BOS_DIZI = \[([^\]]*)\] as const/);
  assert.ok(d, 'istemci bos dizi listesi (SPA_YANIT_BOS_DIZI) yok');
  assert.deepEqual(new Set([...d[1].matchAll(/'([^']+)'/g)].map((m) => m[1])), YANIT_BOS_DIZI);
  // Doldurma GERCEKTEN cagriliyor.
  const fn = api.slice(
    api.indexOf('spaDiscovery: (fresh = false)'),
    api.indexOf('spaRp: (ns: string'),
  );
  assert.ok(fn.includes('.then(spaYanitDoldur)'), 'spaDiscovery yaniti doldurmuyor');
});

test('SR35 kod sozlugu: uretilen her kod listede, listedeki her kod uretiliyor ve ekranda etiketi var', () => {
  // SIRA: bu dosyanin SON testi - yukaridaki fixture'larin urettigi kodlari (GORULEN) okur.
  // 'envanter' bugun ULASILAMAZ: resolveTarget'in cozdugu '<app>-<ns>' etiketini adIdx ayni
  // anahtarla ONCE dener; kod geriye donuk olarak listede durur.
  const ULASILAMAZ = { rpEsles: new Set(['envanter']) };
  for (const [alan, liste] of Object.entries(KODLAR)) {
    for (const v of GORULEN[alan])
      assert.ok(liste.includes(v), `${alan}: '${v}' uretildi ama KODLAR listesinde yok`);
    for (const v of liste) {
      if (ULASILAMAZ[alan] && ULASILAMAZ[alan].has(v)) continue;
      assert.ok(
        GORULEN[alan].has(v),
        `${alan}: '${v}' hicbir fixture'da uretilmedi (liste bayat ya da bekci eksik)`,
      );
    }
  }
  const ui = normalize(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const blok = (bas, son) => {
    const i = ui.indexOf(bas);
    const j = ui.indexOf(son, i + 1);
    assert.ok(i >= 0 && j > i, `blok bulunamadi: ${bas}`);
    return ui.slice(i, j);
  };
  const kac = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const anahtarVar = (s, k) => new RegExp(`[{,]\\s*'?${kac(k)}'?\\s*:`).test(s);
  const sozluk = [
    ['rp', blok('const RP_ETIKET', 'const RPI_ETIKET'), 'RP_ETIKET'],
    ['rpIstek', blok('const RPI_ETIKET', 'const RPI_NEDEN_METNI'), 'RPI_ETIKET'],
    ['rpIstekNeden', blok('const RPI_NEDEN_METNI', 'const YOL_ADI'), 'RPI_NEDEN_METNI'],
    ['rpEsles', blok('const ESLES_ADI', 'const TABLO_ADI'), 'ESLES_ADI'],
  ];
  for (const [alan, s, ad] of sozluk)
    for (const k of KODLAR[alan]) assert.ok(anahtarVar(s, k), `${ad}: '${k}' kodunun etiketi yok`);
  const neden = blok('function rpNedenMetni(', 'function rpIstekNedenMetni(');
  for (const k of KODLAR.rpNeden)
    assert.ok(neden.includes(`case '${k}':`), `rpNedenMetni: '${k}' metni yok (ham kod gorunur)`);
  // 2026-10-03: hucrenin IKINCI SATIRI neden ve eslesmeyi kisa adla yazar (tam metin ipucunda).
  // Kisa adi olmayan kod ikinci satirda ham gorunmez ama "neden olculemedi" bilgisi satirdan
  // duser; liste bayatlamasin.
  const nedenKisa = blok('const RP_NEDEN_KISA', 'const ESLES_KISA');
  for (const k of KODLAR.rpNeden)
    assert.ok(anahtarVar(nedenKisa, k), `RP_NEDEN_KISA: '${k}' kisa adi yok`);
  const eslesKisa = blok('const ESLES_KISA', 'function RpHucre(');
  for (const k of KODLAR.rpEsles)
    assert.ok(anahtarVar(eslesKisa, k), `ESLES_KISA: '${k}' kisa adi yok`);
  const tablo = blok('const TABLO_ADI', 'const TRAFIK_NEDEN');
  for (const k of ['config', 'dizin', 'upstream'])
    assert.ok(anahtarVar(tablo, k), `TABLO_ADI: '${k}' yok`);
  // Ayrinti paneli: tanim basina 'olculemedi' nedeni ham kod olarak gorunmez.
  const trfNeden = blok('const TRAFIK_NEDEN', 'const zaman');
  for (const k of KODLAR.trafikNeden)
    assert.ok(anahtarVar(trfNeden, k), `TRAFIK_NEDEN: '${k}' metni yok (ham kod gorunur)`);
  // RP ve RP istegi suzgeclerinde her kod bir secenek.
  const rpSec = blok("title='Reverse proxy'de tanımlı mı'", '</select>');
  for (const k of KODLAR.rp)
    assert.ok(rpSec.includes(`<option value='${k}'>`), `RP suzgeci: '${k}' secenegi yok`);
  const rpiSec = blok("title='RP isteği (access log)'", '</select>');
  for (const k of KODLAR.rpIstek)
    assert.ok(rpiSec.includes(`<option value='${k}'>`), `RP istegi suzgeci: '${k}' secenegi yok`);
  // TS tipleri de ayni kodlari tasir (tsc ekranin yeni kodu yanlis karsilastirmasini yakalar).
  const api = normalize(read('src/api/nginxConsoleApi.ts'));
  const tip = (bas) => {
    const i = api.indexOf(bas);
    assert.ok(i >= 0, `tip bulunamadi: ${bas}`);
    return api.slice(i, api.indexOf(';', i));
  };
  for (const [alan, bas] of [
    ['rp', 'export type NgSpaRp ='],
    ['rpIstek', 'export type NgSpaRpIstek ='],
    ['rpIstekNeden', 'export type NgSpaRpIstekNeden ='],
    ['rpEsles', 'rpEsles?:'],
  ]) {
    const t = tip(bas);
    for (const k of KODLAR[alan]) assert.ok(t.includes(`'${k}'`), `${bas} '${k}' kodunu icermiyor`);
  }
});

// ── KAPSAM ORANI (kullanici, 2026-10-06) ─────────────────────────────────────────────
// "ARK'in prod/test/qa/dev cluster'lari zaten belli. Ilgili route hangi cluster'larda var
//  ise Kismi veya Tam olarak gosterilmeli. Ornegin 4 prod cluster'in 4'unde de varsa
//  4/4 Tam, 3'unde varsa 3/4 Kismi diye yazmali."
//
// EN PAHALI YANLIS: erisilemeyen cluster'i eksiklik saymak. Uretimde 12 cluster `login`
// ile dusuyor; o cluster yuzunden "4/5 Kismi" demek UYDURMA bir eksiklik raporu olur -
// uygulama orada olabilir de olmayabilir de, BILMIYORUZ.
const KAT = (...ciftler) => ciftler.map(([c, e]) => ({ cluster_name: c, env: e, tenant: 'ark' }));
const RUN = (...ciftler) => ciftler.map(([c, d]) => ({ cluster: c, durum: d }));
const P4 = KAT(['p1', 'prod'], ['p2', 'prod'], ['p3', 'prod'], ['p4', 'prod']);
const AC = (app, ns, cl) => A(app, ns, { cluster: cl });

test('KP1 4/4 Tam ve 3/4 Kismi', () => {
  const tam = by(
    run(
      ['p1', 'p2', 'p3', 'p4'].map((c) => AC('x-app-v0', 'x-prod', c)),
      K(),
      { katalog: P4, runs: RUN(['p1', 'ok'], ['p2', 'kismi'], ['p3', 'ok'], ['p4', 'kismi']) },
    ),
  )['x-app-v0'];
  assert.equal(tam.kapsamDurum, 'tam');
  assert.equal(tam.kapsamVar, 4);
  assert.equal(tam.kapsamToplam, 4);

  const kismi = by(
    run(['p1', 'p2', 'p3'].map((c) => AC('x-app-v0', 'x-prod', c)), K(), {
      katalog: P4,
      runs: RUN(['p1', 'ok'], ['p2', 'ok'], ['p3', 'ok'], ['p4', 'ok']),
    }),
  )['x-app-v0'];
  assert.equal(kismi.kapsamDurum, 'kismi');
  assert.equal(kismi.kapsamVar, 3);
  assert.equal(kismi.kapsamToplam, 4);
});

test('KP2 ERISILEMEYEN cluster PAYDAYA GIRMEZ (uydurma eksiklik raporu yok)', () => {
  const r = by(
    run(['p1', 'p2', 'p3'].map((c) => AC('x-app-v0', 'x-prod', c)), K(), {
      katalog: P4,
      runs: RUN(['p1', 'ok'], ['p2', 'ok'], ['p3', 'ok'], ['p4', 'login']),
    }),
  )['x-app-v0'];
  assert.equal(r.kapsamToplam, 3, 'erisilemeyen cluster paydaya girmis');
  assert.equal(r.kapsamDurum, 'tam', 'erisilemeyen cluster yuzunden Kismi denmis');
  assert.equal(r.kapsamBakilamayan, 1, 'bakilamayan cluster sayisi gorunmuyor');
});

test('KP3 "kismi" TARANDI sayilir (route varligi guvenilir)', () => {
  // `kismi` = route'lar okundu, bazi namespace'lerin SERVISLERI okunamadi. O cluster'i
  // paydadan dusurmek, olculmus bir bilgiyi atmak olurdu.
  const r = by(
    run([AC('x-app-v0', 'x-prod', 'p1'), AC('x-app-v0', 'x-prod', 'p2')], K(), {
      katalog: KAT(['p1', 'prod'], ['p2', 'prod']),
      runs: RUN(['p1', 'ok'], ['p2', 'kismi']),
    }),
  )['x-app-v0'];
  assert.equal(r.kapsamToplam, 2);
  assert.equal(r.kapsamDurum, 'tam');
});

test('KP4 KATALOG OKUNAMAZSA oran IDDIA EDILMEZ', () => {
  // Uydurma bir payda ile oran yazmak, var olmayan bir eksiklik raporlamak olurdu.
  const r = by(run([AC('x-app-v0', 'x-prod', 'p1')], K(), { katalog: null, runs: RUN(['p1', 'ok']) }))[
    'x-app-v0'
  ];
  assert.equal(r.kapsamDurum, 'olculemedi');
  assert.equal(r.kapsamToplam, 0);
  // Cluster katalogda YOKSA da oran iddia edilmez
  const y = by(
    run([AC('x-app-v0', 'x-prod', 'bilinmeyen')], K(), { katalog: P4, runs: RUN(['p1', 'ok']) }),
  )['x-app-v0'];
  assert.equal(y.kapsamDurum, 'olculemedi');
});

test('KP5 UYGULAMA IKI ORTAMDA: oran IDDIA EDILMEZ', () => {
  // Ayni adli uygulama prod VE test'te olabilir. Birinin ortamini secip ona gore oran
  // yazmak uydurma olurdu: "2/4 Kismi" dersek prod'da eksik sanilir, oysa satir iki
  // ortamin toplamidir. Mutasyon M4 bu korlugu gosterdi (ortamlar.length === 1 -> >= 1).
  const r = by(
    run([AC('x-app-v0', 'x-prod', 'p1'), AC('x-app-v0', 'x-prod', 't1')], K(), {
      katalog: KAT(['p1', 'prod'], ['p2', 'prod'], ['t1', 'test'], ['t2', 'test']),
      runs: RUN(['p1', 'ok'], ['p2', 'ok'], ['t1', 'ok'], ['t2', 'ok']),
    }),
  )['x-app-v0'];
  assert.equal(r.kapsamDurum, 'olculemedi', 'iki ortamli uygulamada oran iddia edilmis');
  assert.equal(r.kapsamToplam, 0);
});
