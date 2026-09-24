// src/__tests__/nginx-api-clusters.test.cjs — "API Bazlı" sekmesinde SUNUCU KÜMESİ kırılımı.
//
// Kullanıcı (2026-09-23): "Developer arkadaşlar API Bazlı sekmesine gelip kendi API'lerini
// bulduktan sonra hangi sunucularda var hangilerinde yok görmek istiyor." Kümeler kurum
// tanımıdır; listeler bu testte AÇIKÇA yazılıdır, çünkü bir sunucunun sessizce listeden
// düşmesi ekranda "eksik" görünmemesine yol açar — yani hatayı gizler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { API_CLUSTERS, clusterCoverage } = require('../../shared/nginxApiClusters.cjs');
const UI = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'denetim', 'NginxApiLocations.tsx'),
  'utf8',
);

const BEKLENEN = {
  mblcustomers: [
    'GBNGWP01', 'GBNGWP02', 'GBNGWP03', 'GBNGWP04', 'GBNGWP05', 'GBNGWP06', 'GBNGWP07', 'GBNGWP08',
    'GBNGWP09', 'GBNGWP10', 'GBNGWP11', 'GBNGWP12', 'GBNGWP13', 'GBNGWP14', 'GBNGWP15', 'GBNGWP16',
    'GBNGWAP01', 'GBNGWAP02', 'GBNGWAP03', 'GBNGWAP04', 'GBNGWAP05', 'GBNGWAP06', 'GBNGWAP07', 'GBNGWAP08',
  ],
  customers: [
    'GBNGWP25', 'GBNGWP26', 'GBNGWP27', 'GBNGWP28', 'GBNGWP29', 'GBNGWP30', 'GBNGWP31', 'GBNGWP32',
    'GBNGWAP22', 'GBNGWAP23', 'GBNGWAP24', 'GBNGWAP25',
  ],
  mcustomers: [
    'GBNGWAP10', 'GBNGWAP11', 'GBNGWAP12', 'GBNGWAP13',
    'GBNGWP17', 'GBNGWP18', 'GBNGWP19', 'GBNGWP20', 'GBNGWP21', 'GBNGWP22', 'GBNGWP23', 'GBNGWP24',
    'GBNGXAP30', 'GBNGXAP31', 'GBNGXP60', 'GBNGXP61', 'GBNGXP62', 'GBNGXP63',
  ],
};

test('AC1 küme listeleri kullanıcının verdiği listelerle BİREBİR aynı', () => {
  assert.deepEqual(
    API_CLUSTERS.map((c) => c.key),
    ['mblcustomers', 'customers', 'mcustomers'],
    'küme adları/sırası değişmiş',
  );
  for (const c of API_CLUSTERS) {
    assert.deepEqual(c.hosts, BEKLENEN[c.key], `${c.key} sunucu listesi değişmiş`);
  }
  assert.equal(API_CLUSTERS[0].hosts.length, 24);
  assert.equal(API_CLUSTERS[1].hosts.length, 12);
  assert.equal(API_CLUSTERS[2].hosts.length, 18);
  const hepsi = API_CLUSTERS.flatMap((c) => c.hosts);
  assert.equal(new Set(hepsi).size, hepsi.length, 'bir sunucu iki kümede birden');
});

test('AC2 kapsam: var / yok listeleri ve büyük-küçük harf', () => {
  const r = clusterCoverage(['gbngwp01', 'GBNGWP02', 'GBNGWAP22']);
  const mbl = r.rows.find((x) => x.cluster.key === 'mblcustomers');
  assert.deepEqual(mbl.present, ['GBNGWP01', 'GBNGWP02'], 'küçük harf sunucu eşleşmedi');
  assert.equal(mbl.missing.length, 22);
  assert.ok(!mbl.missing.includes('GBNGWP01'));

  const cust = r.rows.find((x) => x.cluster.key === 'customers');
  assert.deepEqual(cust.present, ['GBNGWAP22']);

  const mcust = r.rows.find((x) => x.cluster.key === 'mcustomers');
  assert.deepEqual(mcust.present, [], 'bu kümede hiç olmamalı');
  assert.equal(mcust.missing.length, 18, 'hiç yoksa TÜM sunucular eksik sayılmalı');
});

test('AC3 hiçbir kümede olmayan sunucu "liste dışı" olarak görünür (liste bayatlarsa fark edilsin)', () => {
  const r = clusterCoverage(['GBNGWP01', 'GBNGWT03', 'GBNGXP99']);
  assert.deepEqual(r.outside, ['GBNGWT03', 'GBNGXP99']);
  assert.deepEqual(clusterCoverage([]).outside, []);
  assert.equal(clusterCoverage([]).rows[0].present.length, 0);
});

test('AC4 ekran sözleşmesi: satırda küme özeti, detayda var/yok dökümü, CSV sütunları', () => {
  assert.ok(/<Th>Sunucu kümeleri<\/Th>/.test(UI), 'tabloya küme sütunu eklenmemiş');
  assert.ok(/rowsCov\.map/.test(UI), 'küme kapsamı satırda gösterilmiyor');
  // 2026-09-23: kapsam + RATE LIMIT karsilastirmasi SUNUCUDA hesaplanir (satir basina
  // sunucu sunucu limit tasimak yaniti sisirirdi); ekran yalniz cizer.
  assert.ok(/const rowsCov = row\.clusters \|\| \[\]/.test(UI), 'kume ozeti sunucudan gelmiyor');
  assert.ok(/küme içi limit farkı/.test(UI), 'kume ici limit farki isaretlenmiyor');
  assert.ok(/IP \{g\.ip \|\| '—'\} · location \{g\.srv \|\| '—'\}/.test(UI), 'limit degerleri gosterilmiyor');
  // PERFORMANS (kullanici "ekran kasiyor"): satir bileseni React.memo, arama ertelenir,
  // liste ilk dilimle acilir.
  assert.ok(/React\.memo\(function LocationRow/.test(UI), 'satir bileseni memo degil');
  assert.ok(/useDeferredValue/.test(UI), 'arama her tusta tum tabloyu yeniden ciziyor');
  assert.ok(/rows\.slice\(0, limit\)/.test(UI), 'tum satirlar birden cizilirse ekran kasar');
  // Sunucu sozlesmesi: kume + limit ozeti uretiliyor mu?
  const SRV = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'audit', 'nginx-api-locations.cjs'), 'utf8');
  assert.ok(/function clusterBreakdown\(/.test(SRV), 'sunucu kume ozeti uretmiyor');
  assert.ok(/limitDrift: groups\.length > 1/.test(SRV), 'kume ici limit farki hesaplanmiyor');
  assert.ok(/require\('\.\.\/\.\.\/shared\/nginxApiClusters\.cjs'\)/.test(SRV), 'sunucu ortak kume listesini kullanmiyor');
  assert.ok(/hangi gateway&apos;lerde var, hangilerinde yok/.test(UI), 'detayda başlık yok');
  // "var" tarafi limit gruplariyla, "yok" tarafi ayri bir rozetle gosterilir (2026-09-23).
  assert.ok(/sunucuda YOK/.test(UI), 'eksik sunucular gösterilmiyor');
  assert.ok(/tüm eş sunucularda aynı/.test(UI), 'limitlerin eş sunucularda aynı olup olmadığı yazmıyor');
  assert.ok(/API_CLUSTERS\.map\(\(c\) => c\.label \+ '_var'\)/.test(UI), 'CSV küme sütunları yok');
  assert.ok(/colSpan=\{envs\.length \+ 4\}/.test(UI), 'yeni sütun sonrası detay satırı colSpan güncellenmemiş');
  // Renkler token'dan: koyu temada okunabilirlik (bkz. src/__tests__/inline-color-leaks).
  assert.ok(!/#[0-9a-fA-F]{6}/.test(UI), 'ekranda sabit hex renk var');
  assert.ok(/var\(--status-success\)/.test(UI) && /var\(--status-danger\)/.test(UI), 'durum renkleri token değil');
});

// AC5 (2026-09-24, kullanici: "bazi API'lar sunucularda olmasina ragmen sunucuda yok diye
// raporlaniyor"). Tarama tablosunda O GUN HIC satir uretmemis bir sunucu - ulasilamamis ya da
// dbo.Inventory'de nginx_version bos oldugu icin taramanin host listesine hic girmemis - eskiden
// "YOK" sayiliyordu. Kanit yoktur: soru sorulmamistir. Uc durum ayrilir.
test('AC5 "yok" ile "taranmadi" ayridir: hic satir uretmemis sunucu eksik SAYILMAZ', () => {
  const { summarizeLocations } = require('../../server/audit/nginx-api-locations.cjs');
  const { API_CLUSTERS } = require('../../shared/nginxApiClusters.cjs');
  const kume = API_CLUSTERS[0];
  const [varHost, yokHost, taranmayanHost] = kume.hosts;

  // varHost: location var · yokHost: tarandi (baska location uretti) ama bu location yok
  // taranmayanHost: hic satir yok
  const rows = summarizeLocations([
    { host: varHost, config_file: 'api.conf', api_location: '/v1/x', ip_rate_limit: '10r/s', server_rate_limit: null },
    { host: yokHost, config_file: 'api.conf', api_location: '/v1/baska', ip_rate_limit: null, server_rate_limit: null },
  ]).rows;

  const r = rows.find((x) => x.location === '/v1/x');
  const c = r.clusters.find((x) => x.key === kume.key);
  assert.ok(c.missing.includes(yokHost), 'taranan ama location tasimayan sunucu EKSIK sayilmali');
  assert.ok(!c.missing.includes(taranmayanHost), 'hic taranmamis sunucu eksik SAYILMAMALI');
  assert.ok(c.notScanned.includes(taranmayanHost), 'hic taranmamis sunucu notScanned altinda olmali');
  assert.equal(c.present + c.missing.length + c.notScanned.length, c.total, 'uc kume toplami kumeyi vermeli');
  assert.ok(r.clusterNotScanned > 0);
});
