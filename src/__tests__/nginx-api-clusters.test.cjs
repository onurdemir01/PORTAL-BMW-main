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
  assert.ok(/coverage\.rows\.map/.test(UI), 'küme kapsamı hesaplanmıyor');
  assert.ok(/clusterCoverage\(allHosts\)/.test(UI), 'kapsam tüm ortamların birleşiminden hesaplanmalı');
  assert.ok(/hangi gateway&apos;lerde var, hangilerinde yok/.test(UI), 'detayda başlık yok');
  assert.ok(/title="bu sunucuda VAR"/.test(UI) && /title="bu sunucuda YOK"/.test(UI), 'var/yok ayrımı okunmuyor');
  assert.ok(/liste dışı/.test(UI), 'liste dışı sunucular gösterilmiyor');
  assert.ok(/API_CLUSTERS\.map\(\(c\) => c\.label \+ '_var'\)/.test(UI), 'CSV küme sütunları yok');
  assert.ok(/colSpan=\{envs\.length \+ 4\}/.test(UI), 'yeni sütun sonrası detay satırı colSpan güncellenmemiş');
  // Renkler token'dan: koyu temada okunabilirlik (bkz. src/__tests__/inline-color-leaks).
  assert.ok(!/#[0-9a-fA-F]{6}/.test(UI), 'ekranda sabit hex renk var');
  assert.ok(/var\(--status-success\)/.test(UI) && /var\(--status-danger\)/.test(UI), 'durum renkleri token değil');
});
