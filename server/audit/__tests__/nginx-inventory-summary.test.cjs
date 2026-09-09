// server/audit/__tests__/nginx-inventory-summary.test.cjs
//
// "Nginx Envanteri" sekmesinin ozet mantigi (dbo.nginx_inventory). DB gerektirmez.
//
// En kritik davranis TOPLAMLARIN DURUSTLUGU: bellek/disk degerleri sunucudan serbest
// metin olarak geliyor ("16G", "512M", bazen bos). Cozulemeyen bir degeri 0 sayip
// toplamaya devam etmek, toplami SESSIZCE kucuk gosterirdi. Bu yuzden toplam yalnizca
// cozulebilen satirlardan hesaplanir ve kac satirin disarida kaldigi AYRICA bildirilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeNginxInventory,
  _toGiB: toGiB,
  _splitServices: splitServices,
  _UNKNOWN: UNKNOWN,
} = require('../nginx-inventory-summary.cjs');

const host = (o) => ({
  hostname: 'H', env: 'test', location: 'pendik', nginx_version: '1.24.0', os: 'RHEL 8',
  kernel: '4.18', architecture: 'x86_64', cpu: '4', memory: '16G', disk_usr_nginx: '50G',
  disk_web_log: '100G', services: 'mobile', service_count: '1', config_count: '10',
  metadata_version: '1', nginx_user: 'www', domain: 'd', subnet: 's', ...o,
});

test('toGiB: birimler donusturulur, cozulemeyen NULL doner', () => {
  assert.equal(toGiB('16G'), 16);
  assert.equal(toGiB('1T'), 1024);
  assert.equal(toGiB('512M'), 0.5);
  assert.equal(toGiB('16GiB'), 16);
  assert.equal(toGiB(''), null, 'bos deger 0 SAYILMAZ');
  assert.equal(toGiB('bilinmiyor'), null);
  assert.equal(toGiB(null), null);
});

test('toplamlar yalnizca COZULEBILEN degerlerden; gerisi ayrica bildirilir', () => {
  const s = summarizeNginxInventory([
    host({ hostname: 'a', memory: '16G' }),
    host({ hostname: 'b', memory: '32G' }),
    host({ hostname: 'c', memory: '' }),        // cozulemez
    host({ hostname: 'd', memory: 'bilinmiyor' }), // cozulemez
  ]);
  assert.equal(s.totals.memory.totalGiB, 48, '16 + 32');
  assert.equal(s.totals.memory.parsed, 2);
  assert.equal(s.totals.memory.unparsed, 2, 'gizlenmiyor');
  assert.equal(s.totals.hosts, 4, 'sunucu sayisi TAM (cozulemeyenler de sunucu)');
});

test('cpu toplami sayisal olmayanlari 0 sayar ama sunucu sayisini dusurmez', () => {
  const s = summarizeNginxInventory([
    host({ hostname: 'a', cpu: '4' }),
    host({ hostname: 'b', cpu: 'unknown' }),
  ]);
  assert.equal(s.totals.cpuTotal, 4);
  assert.equal(s.totals.hosts, 2);
});

test('ortam x lokasyon kirilimi', () => {
  const s = summarizeNginxInventory([
    host({ hostname: 'a', env: 'production', location: 'pendik' }),
    host({ hostname: 'b', env: 'production', location: 'ankara' }),
    host({ hostname: 'c', env: 'production', location: 'ankara' }),
    host({ hostname: 'd', env: 'non-production', location: 'pendik' }),
  ]);
  const prod = s.byEnv.find((e) => e.env === 'production');
  assert.equal(prod.hosts, 3);
  assert.deepEqual(prod.locations, [
    { location: 'ankara', hosts: 2 },
    { location: 'pendik', hosts: 1 },
  ], 'cok gorulen once');
  assert.equal(s.byEnv[0].env, 'production', 'ortamlar sunucu sayisina gore sirali');
});

test('BOS ortam/lokasyon SESSIZCE atilmaz, (bilinmiyor) kovasina duser', () => {
  const s = summarizeNginxInventory([host({ hostname: 'a', env: '', location: null })]);
  assert.equal(s.byEnv[0].env, UNKNOWN);
  assert.equal(s.byEnv[0].locations[0].location, UNKNOWN);
  assert.equal(s.totals.hosts, 1, 'sayimdan DUSMEZ');
});

test('services alani tekil adlara bolunur ve sunucu bazinda sayilir', () => {
  assert.deepEqual(splitServices('mobile internet  kurumsal'), ['mobile', 'internet', 'kurumsal']);
  assert.deepEqual(splitServices('a,b;c'), ['a', 'b', 'c']);
  assert.deepEqual(splitServices(''), []);

  const s = summarizeNginxInventory([
    host({ hostname: 'a', env: 'test', services: 'mobile internet' }),
    host({ hostname: 'b', env: 'prod', services: 'mobile' }),
  ]);
  const mobile = s.byService.find((x) => x.service === 'mobile');
  assert.equal(mobile.hosts, 2);
  assert.deepEqual(mobile.envs, ['prod', 'test']);
  assert.equal(s.byService.find((x) => x.service === 'internet').hosts, 1);
  assert.equal(s.totals.services, 2);
});

test('ayni service ayni sunucuda iki kez gecerse BIR kez sayilir', () => {
  const s = summarizeNginxInventory([host({ hostname: 'a', services: 'mobile mobile' })]);
  assert.equal(s.byService.find((x) => x.service === 'mobile').hosts, 1);
});

test('dagilimlar cok gorulen once sirali', () => {
  const s = summarizeNginxInventory([
    host({ hostname: 'a', nginx_version: '1.22.1' }),
    host({ hostname: 'b', nginx_version: '1.24.0' }),
    host({ hostname: 'c', nginx_version: '1.24.0' }),
  ]);
  assert.deepEqual(s.versions.nginx, [
    { value: '1.24.0', count: 2 },
    { value: '1.22.1', count: 1 },
  ]);
  assert.equal(s.totals.nginxVersions, 2);
});

test('bos girdi cokmez', () => {
  const s = summarizeNginxInventory([]);
  assert.equal(s.totals.hosts, 0);
  assert.deepEqual(s.byEnv, []);
  assert.deepEqual(s.byService, []);
  assert.equal(s.totals.memory.totalGiB, 0);
  assert.deepEqual(summarizeNginxInventory(undefined).byEnv, []);
});
