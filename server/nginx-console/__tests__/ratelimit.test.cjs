// server/nginx-console/__tests__/ratelimit.test.cjs — Nginx Hub › Rate Limit (2026-09-26).
//
// RL1 ozet: limitli/limitsiz ayrimi ve ortam kirilimi
// RL2 "limit YOK" ile "olculmedi" AYRI
// RL3 rapor: Excel uyumlu CSV (ayrac, kacis, BOM) ve sunucuda uretiliyor
// RL4 sekme gorunurluk kapisina bagli
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { summarize, toCsv, csvField, envOfHost, limitState } = require('../ratelimit.cjs');

const R = (host, loc, ip, srv) => ({
  host, env: envOfHost(host), configFile: 'x.conf', location: loc,
  ipLimit: ip, serverLimit: srv, state: limitState({ ip_rate_limit: ip, server_rate_limit: srv }),
});

test('RL1: ozet - limitli/limitsiz ve ortam kirilimi', () => {
  const rows = [
    R('GBNGXP40', '/a', 'ip_zone 10r/s', null),
    R('GBNGXP40', '/b', null, null),
    R('GBNGXP41', '/c', null, 'srv 5r/s'),
    R('GBNGWT03', '/d', 'ip_zone 10r/s', 'srv 5r/s'),
  ];
  const s = summarize(rows);
  assert.equal(s.rows, 4);
  assert.equal(s.hosts, 3);
  assert.equal(s.limitsiz, 1);
  assert.equal(s.limitli, 3);
  assert.equal(s.ipOnly, 1);
  assert.equal(s.serverOnly, 1);
  assert.equal(s.ikisi, 1);
  // SERVER SEVIYESI LIMIT LIMITSIZ SAYILMAZ: nginx onu location'a MIRAS birakir.
  assert.equal(rows[2].state, 'server');
  // En cok kullanilan zone: iki satirda gecen ip_zone basta.
  assert.equal(s.topZones[0].zone, 'ip_zone 10r/s');
  assert.equal(s.topZones[0].count, 2);
  // Ortam SUNUCU ADINDAN turetilir (dosya adi her ortamda ayni).
  assert.equal(s.byEnv.PROD.rows, 3);
  assert.equal(s.byEnv.PROD.limitsiz, 1);
  assert.equal(s.byEnv.TEST.rows, 1);
});

test('RL2: "limit YOK" ile "olculmedi" ayri', () => {
  // Satir VARSA ve iki alan da bossa: gercekten limitsiz.
  assert.equal(limitState({ ip_rate_limit: null, server_rate_limit: null }), 'yok');
  // Hic satir YOKSA ozet sifir doner - bu "hepsi limitsiz" DEMEK DEGIL.
  const bos = summarize([]);
  assert.equal(bos.rows, 0);
  assert.equal(bos.limitsiz, 0, 'satir yokken limitsiz sayaci sismemeli');

  // Sunucu ucu tablo yoksa bunu ACIKCA soyluyor mu?
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /tableMissing: yok/);
  assert.match(src, /hic kosmamis olabilir/);

  // Ekran da ayni ayrimi yapmali.
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'RateLimitTab.tsx'), 'utf8');
  assert.match(ui, /"limit yok" anlamına GELMEZ|limit yok" anlamına GELMEZ/i);
});

test('RL3: rapor Excel uyumlu ve SUNUCUDA uretiliyor', () => {
  const rows = [R('GBNGXP40', '/a;b', 'ip"z', null)];
  const csv = toCsv(rows, '2026-09-26');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 BOM yoksa Excel Turkce karakteri bozar');
  assert.ok(csv.includes('Sunucu;Ortam'), 'TR Excel icin noktali virgul ayrac');
  // Ayrac ve tirnak iceren degerler kacisli olmali - yoksa sutunlar kayar.
  assert.ok(csv.includes('"/a;b"'));
  assert.ok(csv.includes('"ip""z"'));
  assert.equal(csvField('duz'), 'duz', 'gereksiz tirnak eklenmemeli');
  // Satir sonu CRLF (Excel).
  assert.ok(csv.includes('\r\n'));

  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /ratelimit\.csv/);
  assert.match(src, /Content-Disposition/, 'indirme basligi yok');
  assert.match(src, /text\/csv; charset=utf-8/);
});

test('RL4: sekme gorunurluk kapisina bagli', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  // Hem veri hem rapor ucu tab:nginx:ratelimit kapisindan gecmeli.
  // Regex'i regex ile aramak okunmaz oluyor: duz metin arayalim.
  assert.ok(src.includes("'ratelimit'],"), 'ratelimit yolu sekme kapisina baglanmamis');

  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(setup, /element_key: 'tab:nginx:ratelimit'/, 'sekme seed edilmemis');
  assert.match(setup, /NGINX_TAB_KEYS_SEED = \[[^\]]*'ratelimit'/, 'mevcut grantlar yeni sekmeyi de almali');

  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  assert.match(page, /canSee\('tab:nginx:ratelimit'\)/);
});
