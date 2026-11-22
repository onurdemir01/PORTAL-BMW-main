// src/__tests__/nginx-api-clusters.test.js — "API Bazlı" sekmesinde SUNUCU KÜMESİ kırılımı.
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

// Sunucular kurum ayarinda (nginx.apiKumeleri); testler kurgusal ornekle kosar. Kume kimligi / etiketi
// ekranla paylasilan dosyada (shared/nginxApiClusters.cjs).
const { apiKumeleri, clusterCoverage } = require('../../server/audit/nginx-api-kumeleri.cjs');
const { API_CLUSTERS: KUME_TANIMLARI } = require('../../shared/nginxApiClusters.cjs');
const API_CLUSTERS = apiKumeleri();
const UI = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'denetim', 'NginxApiLocations.tsx'),
  'utf8',
);

const BEKLENEN = {
  mblcustomers: [
    'ORNGWP01',
    'ORNGWP02',
    'ORNGWP03',
    'ORNGWP04',
    'ORNGWP05',
    'ORNGWP06',
    'ORNGWP07',
    'ORNGWP08',
    'ORNGWP09',
    'ORNGWP10',
    'ORNGWP11',
    'ORNGWP12',
    'ORNGWP13',
    'ORNGWP14',
    'ORNGWP15',
    'ORNGWP16',
    'ORNGWAP01',
    'ORNGWAP02',
    'ORNGWAP03',
    'ORNGWAP04',
    'ORNGWAP05',
    'ORNGWAP06',
    'ORNGWAP07',
    'ORNGWAP08',
  ],
  customers: [
    'ORNGWP25',
    'ORNGWP26',
    'ORNGWP27',
    'ORNGWP28',
    'ORNGWP29',
    'ORNGWP30',
    'ORNGWP31',
    'ORNGWP32',
    'ORNGWAP22',
    'ORNGWAP23',
    'ORNGWAP24',
    'ORNGWAP25',
  ],
  mcustomers: [
    'ORNGWAP10',
    'ORNGWAP11',
    'ORNGWAP12',
    'ORNGWAP13',
    'ORNGWP17',
    'ORNGWP18',
    'ORNGWP19',
    'ORNGWP20',
    'ORNGWP21',
    'ORNGWP22',
    'ORNGWP23',
    'ORNGWP24',
    'ORNGXAP30',
    'ORNGXAP31',
    'ORNGXP60',
    'ORNGXP61',
    'ORNGXP62',
    'ORNGXP63',
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
  const r = clusterCoverage(['orngwp01', 'ORNGWP02', 'ORNGWAP22']);
  const mbl = r.rows.find((x) => x.cluster.key === 'mblcustomers');
  assert.deepEqual(mbl.present, ['ORNGWP01', 'ORNGWP02'], 'küçük harf sunucu eşleşmedi');
  assert.equal(mbl.missing.length, 22);
  assert.ok(!mbl.missing.includes('ORNGWP01'));

  const cust = r.rows.find((x) => x.cluster.key === 'customers');
  assert.deepEqual(cust.present, ['ORNGWAP22']);

  const mcust = r.rows.find((x) => x.cluster.key === 'mcustomers');
  assert.deepEqual(mcust.present, [], 'bu kümede hiç olmamalı');
  assert.equal(mcust.missing.length, 18, 'hiç yoksa TÜM sunucular eksik sayılmalı');
});

test('AC3 hiçbir kümede olmayan sunucu "liste dışı" olarak görünür (liste bayatlarsa fark edilsin)', () => {
  const r = clusterCoverage(['ORNGWP01', 'ORNGWT03', 'ORNGXP99']);
  assert.deepEqual(r.outside, ['ORNGWT03', 'ORNGXP99']);
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
  assert.ok(
    /IP \{g\.ip \|\| '—'\} · location \{g\.srv \|\| '—'\}/.test(UI),
    'limit degerleri gosterilmiyor',
  );
  // PERFORMANS (kullanici "ekran kasiyor"): satir bileseni React.memo, arama ertelenir,
  // liste ilk dilimle acilir.
  assert.ok(/React\.memo\(function LocationRow/.test(UI), 'satir bileseni memo degil');
  assert.ok(/useDeferredValue/.test(UI), 'arama her tusta tum tabloyu yeniden ciziyor');
  assert.ok(/rows\.slice\(0, limit\)/.test(UI), 'tum satirlar birden cizilirse ekran kasar');
  // Sunucu sozlesmesi: kume + limit ozeti uretiliyor mu?
  const SRV = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'audit', 'nginx-api-locations.cjs'),
    'utf8',
  );
  assert.ok(/function clusterBreakdown\(/.test(SRV), 'sunucu kume ozeti uretmiyor');
  assert.ok(/limitDrift: groups\.length > 1/.test(SRV), 'kume ici limit farki hesaplanmiyor');
  assert.ok(
    /require\('\.\/nginx-api-kumeleri\.cjs'\)/.test(SRV),
    'sunucu ortak kume listesini (kurum ayarindan) kullanmiyor',
  );
  assert.ok(/hangi gateway&apos;lerde var, hangilerinde yok/.test(UI), 'detayda başlık yok');
  // "var" tarafi limit gruplariyla, "yok" tarafi ayri bir rozetle gosterilir (2026-09-23).
  assert.ok(/sunucuda YOK/.test(UI), 'eksik sunucular gösterilmiyor');
  assert.ok(
    /tüm eş sunucularda aynı/.test(UI),
    'limitlerin eş sunucularda aynı olup olmadığı yazmıyor',
  );
  assert.ok(/API_CLUSTERS\.map\(\(c\) => c\.label \+ '_var'\)/.test(UI), 'CSV küme sütunları yok');
  assert.ok(
    /colSpan=\{envs\.length \+ 4\}/.test(UI),
    'yeni sütun sonrası detay satırı colSpan güncellenmemiş',
  );
  // Renkler token'dan: koyu temada okunabilirlik (bkz. src/__tests__/inline-color-leaks).
  assert.ok(!/#[0-9a-fA-F]{6}/.test(UI), 'ekranda sabit hex renk var');
  assert.ok(
    /var\(--status-success\)/.test(UI) && /var\(--status-danger\)/.test(UI),
    'durum renkleri token değil',
  );
});

// AC5 (2026-09-24, kullanici: "bazi API'lar sunucularda olmasina ragmen sunucuda yok diye
// raporlaniyor"). Tarama tablosunda O GUN HIC satir uretmemis bir sunucu - ulasilamamis ya da
// dbo.Inventory'de nginx_version bos oldugu icin taramanin host listesine hic girmemis - eskiden
// "YOK" sayiliyordu. Kanit yoktur: soru sorulmamistir. Uc durum ayrilir.
test('AC5 "yok" ile "taranmadi" ayridir: hic satir uretmemis sunucu eksik SAYILMAZ', () => {
  const { summarizeLocations } = require('../../server/audit/nginx-api-locations.cjs');
  const API_CLUSTERS = apiKumeleri();
  const kume = API_CLUSTERS[0];
  const [varHost, yokHost, taranmayanHost] = kume.hosts;

  // varHost: location var · yokHost: tarandi (baska location uretti) ama bu location yok
  // taranmayanHost: hic satir yok
  const rows = summarizeLocations([
    {
      host: varHost,
      config_file: 'api.conf',
      api_location: '/v1/x',
      ip_rate_limit: '10r/s',
      server_rate_limit: null,
    },
    {
      host: yokHost,
      config_file: 'api.conf',
      api_location: '/v1/baska',
      ip_rate_limit: null,
      server_rate_limit: null,
    },
  ]).rows;

  const r = rows.find((x) => x.location === '/v1/x');
  const c = r.clusters.find((x) => x.key === kume.key);
  assert.ok(c.missing.includes(yokHost), 'taranan ama location tasimayan sunucu EKSIK sayilmali');
  assert.ok(!c.missing.includes(taranmayanHost), 'hic taranmamis sunucu eksik SAYILMAMALI');
  assert.ok(
    c.notScanned.includes(taranmayanHost),
    'hic taranmamis sunucu notScanned altinda olmali',
  );
  assert.equal(
    c.present + c.missing.length + c.notScanned.length,
    c.total,
    'uc kume toplami kumeyi vermeli',
  );
  assert.ok(r.clusterNotScanned > 0);
});

test('AC6 ekranla paylasilan dosya sunucu adi tasimaz; kumeler ayar yoksa bos (sessizce eski liste yok)', () => {
  assert.deepEqual(
    KUME_TANIMLARI.map((c) => Object.keys(c).sort().join(',')),
    ['key,label', 'key,label', 'key,label'],
  );
  const eski = process.env.KURUM_AYAR_DOSYASI;
  try {
    delete process.env.KURUM_AYAR_DOSYASI;
    assert.deepEqual(
      apiKumeleri().map((c) => c.hosts.length),
      [0, 0, 0],
    );
  } finally {
    process.env.KURUM_AYAR_DOSYASI = eski;
  }
});
