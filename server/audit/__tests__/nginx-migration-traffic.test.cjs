// server/audit/__tests__/nginx-migration-traffic.test.cjs — Production Taşımaları'nda yük göstergesi.
//
// Kullanici (2026-09-27): "yuk alip almama gostergesini Production Tasimalari sayfasina da
// ekler misin? yuk alimini GBRVPP07-08-09-10 sunucularindan kontrol etmelisin."
//
// MT1 olcum ESKI sunuculardan alinir; yeni sunucu satiri karismaz
// MT2 uc durum: active / idle / unknown - olcememek "yuk yok" DEGIL
// MT3 mirror sunucular TOPLANIR, okunamayan sunucu "yuk yok" yapmaz
// MT4 olcum satiri yoksa null - ekran uydurmaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMigration, MIGRATION_GROUPS } = require('../nginx-migration.cjs');

// GLOMO grubunun eski sunucularindan biri + yeni filodan biri.
const ESKI = 'GBRVPP07';
const ESKI2 = 'GBRVPP08';
const YENI = 'GBNGXP40';

// Eski sunucuda bir proxy_pass location'i: tasima gorunumune girmesi icin sart.
function proxy(host, location, target) {
  return {
    host, vhost: 'GLOMO-PROD.conf', service: 'GLOMO', location,
    kind: 'proxy', upstream_name: null, target_url: target, upstream_defined: 1,
  };
}

const ROUTES = [{ namespace_name: 'glomo-prod', route_address: 'base-app-v0-glomo-prod.apps.fw.garanti.com.tr' }];
const OCP = [{ namespace: 'glomo-prod', application: 'base-app-v0' }];

function kur(trafficRows) {
  return buildMigration({
    proxyRows: [proxy(ESKI, '/base/', 'https://base-app-v0-glomo-prod.apps.fw.garanti.com.tr/')],
    upstreamRows: [], routeRows: ROUTES, ocpRows: OCP, dirRows: [], newLocRows: [],
    trafficRows,
    groups: MIGRATION_GROUPS.filter((g) => g.id === 'glomo'),
  });
}

const yolOf = (groups) => {
  const g = groups.find((x) => x.id === 'glomo');
  const a = (g.apps || []).find((x) => x.application === 'base-app-v0');
  assert.ok(a, 'uygulama tasima gorunumunde yok');
  return a.paths[0];
};

const satir = (host, over = {}) => ({
  host, service: 'GLOMO', env: 'PROD', location: '/base/',
  req_24h: 0, req_7d: 0, hc_24h: 0, sampled: 0, last_seen: null, error: null, ...over,
});

test('MT1 olcum ESKI sunuculardan alinir; YENI sunucu satiri karismaz', () => {
  // Yeni sunucuda tanim yeni olustugu icin log kisadir; oraya bakmak "yuk yok" derdi.
  // Kullanici kurali: olcum isin GERCEKTEN aktigi eski sunuculardan.
  const yalnizYeni = yolOf(kur([satir(YENI, { req_7d: 5000, req_24h: 700 })]));
  assert.equal(yalnizYeni.traffic, null, 'yeni sunucu satiri olcume karismis');

  const eski = yolOf(kur([satir(ESKI, { req_7d: 5000, req_24h: 700, last_seen: '20260927101500' })]));
  assert.ok(eski.traffic, 'eski sunucu satiri okunmamis');
  assert.equal(eski.traffic.state, 'active');
  assert.equal(eski.traffic.req7, 5000);
  assert.equal(eski.traffic.lastSeen, '20260927101500');

  // Ikisi birden geldiginde YALNIZ eski sayilir.
  const ikisi = yolOf(kur([
    satir(ESKI, { req_7d: 10, req_24h: 2 }),
    satir(YENI, { req_7d: 9999, req_24h: 999 }),
  ]));
  assert.equal(ikisi.traffic.req7, 10, 'yeni sunucunun sayisi toplama girmis');
  assert.equal(ikisi.traffic.hosts, 1);
});

test('MT2 uc durum: olcememek "yuk yok" DEGIL', () => {
  assert.equal(yolOf(kur([satir(ESKI, { req_7d: 1 })])).traffic.state, 'active');

  // Log OKUNDU ve istek yok -> gercekten atil.
  assert.equal(yolOf(kur([satir(ESKI, { req_7d: 0 })])).traffic.state, 'idle');

  // Log okunamadi -> BILINMIYOR. "idle" demek, olculemeyen bir seyi iddia etmek olurdu.
  const hata = yolOf(kur([satir(ESKI, { error: 'log bulunamadi' })]));
  assert.equal(hata.traffic.state, 'unknown');
  assert.equal(hata.traffic.req7, null, 'okunamayan sunucuya sayi yazilmis');
  assert.equal(hata.traffic.unknownHosts, 1);

  // Ornekleme 7 gunu kapsamiyorsa req7 ALT SINIRDIR: 0 gorsek bile "atil" DEMEYIZ.
  const kismi = yolOf(kur([satir(ESKI, { req_7d: 0, sampled: 1 })]));
  assert.equal(kismi.traffic.state, 'unknown');
  assert.equal(kismi.traffic.sampled, true);

  // Saglik kontrolu YUK DEGILDIR: yalniz hc varsa atil sayilir.
  const sadeceHc = yolOf(kur([satir(ESKI, { req_7d: 0, hc_24h: 8640 })]));
  assert.equal(sadeceHc.traffic.state, 'idle');
  assert.equal(sadeceHc.traffic.hc24, 8640);
});

test('MT3 mirror sunucular TOPLANIR; okunamayan sunucu "yuk yok" yapmaz', () => {
  const t = yolOf(kur([
    satir(ESKI, { req_7d: 100, req_24h: 10, last_seen: '20260926080000' }),
    satir(ESKI2, { req_7d: 40, req_24h: 4, last_seen: '20260927090000' }),
  ])).traffic;
  assert.equal(t.req7, 140, 'mirror sunucular toplanmamis');
  assert.equal(t.req24, 14);
  assert.equal(t.hosts, 2);
  assert.equal(t.lastSeen, '20260927090000', 'son istek EN YENI olmali');

  // Biri okunamadi ama otekinde yuk var: durum ACTIVE kalir, okunamayan sayilir.
  const karma = yolOf(kur([
    satir(ESKI, { req_7d: 7 }),
    satir(ESKI2, { error: 'izin yok' }),
  ])).traffic;
  assert.equal(karma.state, 'active');
  assert.equal(karma.hosts, 1);
  assert.equal(karma.unknownHosts, 1, 'okunamayan sunucu bildirilmiyor');
});

test('MT4 olcum satiri yoksa null - ekran uydurmaz', () => {
  assert.equal(yolOf(kur([])).traffic, null);
  assert.equal(yolOf(kur(undefined)).traffic, null);
  // Baska bir location'in olcumu bu yola yazilmamali.
  assert.equal(yolOf(kur([satir(ESKI, { location: '/baska/', req_7d: 999 })])).traffic, null);
  // Baska servisin olcumu de karismamali.
  assert.equal(yolOf(kur([satir(ESKI, { service: 'WEBFORMS', req_7d: 999 })])).traffic, null);
});
