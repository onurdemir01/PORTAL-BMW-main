// server/audit/__tests__/nginx-api-summary.test.js
//
// "Nginx API Envanteri" sekmesinin ozet mantigi. DB gerektirmez.
//
// Bu denetimin ZOR yani sayi saymak degil, FARKI bulmak: konfigurasyon dosya adlari
// ortamdan bagimsiz olarak AYNIDIR, dolayisiyla "ayni conf her yerde ayni mi?" sorusu
// ancak (ortam, sunucu) kirilimlarini karsilastirarak cevaplanir. Asagidaki testler
// once ortam turetmeyi, sonra iki tur SURUKLENMEYI (sunucular arasi / ortamlar arasi)
// kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, servicesOfHosts } = require('../nginx-api-summary.cjs');
const { envOfHost } = require('../nginx-hosts.cjs');

const row = (host, config_file, locations, no_limit = 0) => ({
  host,
  config_file,
  locations,
  no_limit,
});

test('ortam SUNUCU ADINDAN turetilir (tabloda ortam kolonu yok)', () => {
  assert.equal(envOfHost('ORNGWD01'), 'DEV');
  assert.equal(envOfHost('ORNGWT03'), 'TEST');
  assert.equal(envOfHost('ORNGWQ01'), 'QA');
  assert.equal(envOfHost('ORNGWP01'), 'PROD');
  assert.equal(envOfHost('ORNGWAP01'), 'PROD', 'Ankara da PROD');
  assert.equal(envOfHost('ORRVPP07'), 'PROD', 'reverse proxy prod');
  assert.equal(envOfHost('kimbilir'), 'BILINMIYOR', 'taninmayan SESSIZCE bir ortama atanmaz');
});

test('ortam kirilimi: kac sunucu, kac konfigurasyon, kac location', () => {
  const s = summarize([
    row('ORNGWD01', 'mobile.conf', 10),
    row('ORNGWD02', 'mobile.conf', 10),
    row('ORNGWD01', 'internet.conf', 5),
    row('ORNGWP01', 'mobile.conf', 12),
  ]);
  const dev = s.byEnv.find((e) => e.env === 'DEV');
  assert.equal(dev.hosts, 2);
  assert.equal(dev.configs, 2, 'mobile + internet');
  assert.equal(dev.locations, 25, '10 + 10 + 5');
  const prod = s.byEnv.find((e) => e.env === 'PROD');
  assert.equal(prod.hosts, 1);
  assert.equal(prod.locations, 12);
});

test('sunucu kirilimi: her sunucu icin conf ve location sayisi', () => {
  const s = summarize([
    row('ORNGWD01', 'a.conf', 3),
    row('ORNGWD01', 'b.conf', 4),
    row('ORNGWT03', 'a.conf', 3),
  ]);
  const d01 = s.byHost.find((h) => h.host === 'ORNGWD01');
  assert.equal(d01.configs, 2);
  assert.equal(d01.locations, 7);
  assert.equal(d01.env, 'DEV');
});

test('sunucu sirasi ortama gore (DEV, TEST, QA, PROD) sonra ada gore', () => {
  const s = summarize([
    row('ORNGWP02', 'a.conf', 1),
    row('ORNGWD01', 'a.conf', 1),
    row('ORNGWP01', 'a.conf', 1),
    row('ORNGWT03', 'a.conf', 1),
  ]);
  assert.deepEqual(
    s.byHost.map((h) => h.host),
    ['ORNGWD01', 'ORNGWT03', 'ORNGWP01', 'ORNGWP02'],
  );
});

test('konfigurasyon bazinda: hangi ortamda VAR, hangisinde YOK', () => {
  const s = summarize([
    row('ORNGWD01', 'yalniz-dev.conf', 4),
    row('ORNGWD01', 'her-yerde.conf', 8),
    row('ORNGWT03', 'her-yerde.conf', 8),
    row('ORNGWP01', 'her-yerde.conf', 8),
  ]);
  const only = s.byConfig.find((c) => c.config === 'yalniz-dev.conf');
  assert.deepEqual(only.presentEnvs, ['DEV']);
  assert.deepEqual(only.missingEnvs, ['TEST', 'PROD'], 'veride QA hic yok, eksik sayilmaz');

  const all = s.byConfig.find((c) => c.config === 'her-yerde.conf');
  assert.deepEqual(all.missingEnvs, []);
  assert.equal(all.envInconsistent, false, 'her ortamda 8 location - fark yok');
});

test('SUNUCULAR ARASI suruklenme: ayni ortamda sunucular farkliysa isaretlenir', () => {
  const s = summarize([
    row('ORNGWP01', 'x.conf', 20),
    row('ORNGWP02', 'x.conf', 20),
    row('ORNGWP03', 'x.conf', 17), // biri geride kalmis
  ]);
  const c = s.byConfig[0];
  assert.equal(c.hostInconsistent, true);
  assert.equal(c.envs.PROD.minLoc, 17);
  assert.equal(c.envs.PROD.maxLoc, 20);
  assert.equal(c.envs.PROD.hosts, 3);
});

test('ORTAMLAR ARASI suruklenme: ortamlarin beklenen sayisi farkliysa isaretlenir', () => {
  const s = summarize([
    row('ORNGWD01', 'x.conf', 10),
    row('ORNGWT03', 'x.conf', 10),
    row('ORNGWP01', 'x.conf', 7), // prod geride
  ]);
  const c = s.byConfig[0];
  assert.equal(c.envInconsistent, true);
  assert.equal(c.hostInconsistent, false, 'her ortamda tek sunucu - ic fark yok');
});

test('tutarli dagitimda HICBIR suruklenme bayragi yanmaz', () => {
  const s = summarize([
    row('ORNGWD01', 'x.conf', 9),
    row('ORNGWD02', 'x.conf', 9),
    row('ORNGWT03', 'x.conf', 9),
    row('ORNGWT04', 'x.conf', 9),
    row('ORNGWP01', 'x.conf', 9),
    row('ORNGWAP01', 'x.conf', 9),
  ]);
  const c = s.byConfig[0];
  assert.equal(c.hostInconsistent, false);
  assert.equal(c.envInconsistent, false);
  assert.equal(s.totals.inconsistentConfigs, 0);
});

test('rate limit tanimi OLMAYAN konfigurasyonlar', () => {
  const s = summarize([
    row('ORNGWD01', 'limitsiz.conf', 5, 5), // 5 location, 5'i de limitsiz
    row('ORNGWT03', 'limitsiz.conf', 5, 5),
    row('ORNGWD01', 'kismi.conf', 5, 2), // 2'si limitsiz -> conf limitsiz SAYILMAZ
    row('ORNGWD01', 'tam.conf', 5, 0),
  ]);
  assert.deepEqual(s.noLimitConfigs, ['limitsiz.conf']);
  assert.equal(s.totals.configsWithoutLimit, 1);
  const kismi = s.byConfig.find((c) => c.config === 'kismi.conf');
  assert.equal(kismi.noLimitEverywhere, false);
  assert.equal(kismi.noLimitLocations, 2, 'kismi olan yine de sayilir');
});

test('BILINMIYOR bir ortam DEGILDIR: eksik ortam listesine girmez', () => {
  const s = summarize([row('ORNGWD01', 'x.conf', 3), row('tanimsizsunucu', 'x.conf', 3)]);
  const c = s.byConfig[0];
  assert.ok(!c.missingEnvs.includes('BILINMIYOR'));
  assert.ok(s.envs.includes('BILINMIYOR'), 'ama GIZLENMEZ - ekranda gorunur');
  assert.equal(c.envInconsistent, false, 'BILINMIYOR ortam karsilastirmasina katilmaz');
});

test('toplamlar', () => {
  const s = summarize([
    row('ORNGWD01', 'a.conf', 4, 1),
    row('ORNGWD02', 'a.conf', 4, 1),
    row('ORNGWP01', 'b.conf', 6, 6),
  ]);
  assert.equal(s.totals.hosts, 3);
  assert.equal(s.totals.configs, 2);
  assert.equal(s.totals.locations, 14);
  assert.equal(s.totals.noLimitLocations, 8);
  assert.equal(s.totals.configsWithoutLimit, 1, 'b.conf tamamen limitsiz');
});

test('bos girdi cokmez ve DOLU yanitla ayni sekli tasir', () => {
  const s = summarize([]);
  assert.deepEqual(s.byEnv, []);
  assert.deepEqual(s.byHost, []);
  assert.deepEqual(s.byConfig, []);
  assert.deepEqual(s.noLimitConfigs, []);
  assert.equal(s.totals.hosts, 0);
  assert.ok(Array.isArray(s.envs));
});

test('sunucu basina SERVIS: vhost dosyasindan (ortam eki ve .conf atilir), audit verisi yoksa bos; siralama ortam > servis > ad (2026-09-17)', () => {
  const servers = [
    {
      host: 'ORNGWP02',
      conf_file: '/usr/nginx/conf.d/mblcustomers-PROD.conf',
      server_name: 'mblcustomers.ornekbanka.invalid',
    },
    {
      host: 'ORNGWP01',
      conf_file: '/usr/nginx/conf.d/customers-PROD.conf',
      server_name: 'customers.ornekbanka.invalid www.customers.ornekbanka.invalid',
    },
    {
      host: 'ORNGWP01',
      conf_file: '/usr/nginx/conf.d/customers-PROD.conf',
      server_name: 'customers.ornekbanka.invalid',
    }, // ikinci server blogu (443)
    { host: 'ORNGWD01', conf_file: 'mcustomers-dev.conf' },
  ];
  const m = servicesOfHosts(servers);
  assert.deepEqual(m.get('ORNGWP01'), {
    services: ['customers'],
    names: ['customers.ornekbanka.invalid', 'www.customers.ornekbanka.invalid'],
  });
  assert.deepEqual(m.get('ORNGWD01').services, ['mcustomers']);
  const out = summarize(
    [
      row('ORNGWP01', 'a.conf', 3),
      row('ORNGWP02', 'a.conf', 3),
      row('ORNGWP03', 'a.conf', 3),
      row('ORNGWD01', 'a.conf', 1),
    ],
    servers,
  );
  const by = Object.fromEntries(out.byHost.map((h) => [h.host, h]));
  assert.deepEqual(by.ORNGWP02.services, ['mblcustomers']);
  assert.deepEqual(by.ORNGWP03.services, []); // audit verisi yok -> "—"
  assert.deepEqual(
    out.byHost.map((h) => h.host),
    ['ORNGWD01', 'ORNGWP03', 'ORNGWP01', 'ORNGWP02'],
  ); // DEV once; PROD icinde servissiz ('') once, sonra customers, mblcustomers
  assert.deepEqual(summarize([row('ORNGWP01', 'a.conf', 1)]).byHost[0].services, []); // serverRows verilmezse de calisir
});
