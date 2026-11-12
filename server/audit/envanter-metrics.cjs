// server/audit/envanter-metrics.cjs — "Denetim > Envanter Metrikleri" veri uclari (2026-08-23).
//
// UC KAYNAK, AYNI SEKIL:
//   hosts -> dbo.Inventory           (middleware_inventory job'i; SUNUCU basina 1 satir)
//   mw    -> dbo.MWAppsInventory     (middleware_applications_inventory/jboss; UYGULAMA basina 1 satir)
//   was   -> dbo.WASAppsInventory    (middleware_applications_inventory/was;   UYGULAMA basina 1 satir)
//
// Sutun listeleri, tablolari dolduran loader'lardan BIREBIR alindi
// (bmw_inventory/.../inventory_loader.py, mwapps_clean_and_import.py,
// was_clean_and_import.py) - tahmin edilmedi.
//
// NEDEN SUNUCUDA TOPLANIYOR: dbo.Inventory ~1600 satir olsa da uygulama tablolari cok daha
// buyuk. Ham satirlari tarayiciya tasiyip orada gruplamak hem agir hem de sayfa buyudukce
// bozulur. GROUP BY veritabaninda kalir; tarayiciya yalnizca ozet gider.
//
// GUVENLIK: SQL tanimlayicilari (tablo/sutun adlari) parametre olarak BAGLANAMAZ, sorguya
// metin olarak girer. Bu yuzden istemciden gelen source/x/y degerleri asla dogrudan
// kullanilmaz - yalnizca ASAGIDAKI SABIT beyaz listede karsiligi bulunan anahtarlar kabul
// edilir ve SQL'e giren ad her zaman bu dosyadaki sabit metindir.
'use strict';

// Bir boyutun etiketi + gercek sutun adi. `product: true` olanlar "kurulu mu" sayimina da girer.
const DIM = (col, label, extra = {}) => ({ col, label, ...extra });

const SOURCES = {
  hosts: {
    table: 'dbo.Inventory',
    label: 'Sunucular',
    unit: 'sunucu',
    hasHost: true,
    // TRY_CONVERT: bu alanlar kaynakta metin olarak gelebiliyor; cevrilemeyen deger toplama
    // 0 katkiyla degil, NULL olarak girer ve SUM tarafindan yok sayilir.
    numerics: [
      { key: 'memory', col: 'memory', label: 'toplam bellek (GB)' },
      { key: 'cpu', col: 'cpu', label: 'toplam vCPU' },
      { key: 'jvm_count', col: 'jvm_count', label: 'toplam JVM' },
    ],
    dims: [
      DIM('env', 'Ortam'),
      DIM('domain', 'Domain'),
      DIM('subnet', 'Subnet'),
      DIM('os', 'İşletim sistemi'),
      DIM('os_version', 'OS sürümü'),
      DIM('jboss_version', 'JBoss sürümü', { product: 'JBoss' }),
      // JBOSS 7 / 8 AYRI (kullanici, 2026-11-12): middleware_inventory artik jboss_version'in ana
      // surume gore ayrilmis kopyasini da yaziyor (jboss_version degismedi). Iki surum tasiyan sunucu
      // (GBTOAQ01: '7.3.5 8.1.6.1') her iki kirilimda dogru sayilir. Kolon tabloda YOKSA (yeni sema
      // henuz yuklenmedi) boyut sessizce degil, AYRI bir notla dusurulur: bkz. mevcutBoyutlar.
      DIM('jboss7_version', 'JBoss 7 sürümü', { product: 'JBoss 7', istegeBagli: true }),
      DIM('jboss8_version', 'JBoss 8 sürümü', { product: 'JBoss 8', istegeBagli: true }),
      DIM('was_version', 'WAS sürümü', { product: 'WAS' }),
      DIM('ihs_version', 'IHS sürümü', { product: 'IHS' }),
      DIM('rha_version', 'RHA sürümü', { product: 'RHA' }),
      DIM('ctg_version', 'CTG sürümü', { product: 'CTG' }),
      DIM('nginx_version', 'Nginx sürümü', { product: 'Nginx' }),
    ],
  },
  mw: {
    table: 'dbo.MWAppsInventory',
    label: 'JBoss uygulamaları',
    unit: 'uygulama',
    hasHost: true,
    hasApp: true,
    numerics: [{ key: 'jvm_count', col: 'jvm_count', label: 'toplam JVM' }],
    dims: [
      DIM('env', 'Ortam'),
      DIM('domain', 'Domain'),
      DIM('jboss_version', 'JBoss sürümü'),
      DIM('jre_version', 'JRE sürümü'),
      DIM('jdk_type', 'JDK türü'),
      DIM('os', 'İşletim sistemi'),
      DIM('os_version', 'OS sürümü'),
      DIM('status', 'Durum'),
      DIM('tier', 'Katman'),
      DIM('autostarts', 'Otomatik başlatma'),
      DIM('deployed', 'Dağıtılmış'),
    ],
  },
  was: {
    table: 'dbo.WASAppsInventory',
    label: 'WAS uygulamaları',
    unit: 'uygulama',
    hasHost: true,
    hasApp: true,
    numerics: [],
    dims: [
      DIM('env', 'Ortam'),
      DIM('domain', 'Domain'),
      DIM('was_version', 'WAS sürümü'),
      DIM('jre_version', 'JRE sürümü'),
      DIM('jdk_type', 'JDK türü'),
      DIM('os', 'İşletim sistemi'),
      DIM('os_version', 'OS sürümü'),
      DIM('status', 'Durum'),
    ],
  },
};

// Bos/NULL degerleri tek bir gorunur etikette toplar. Aksi halde "" ve NULL ayri gruplar
// olur ve tabloda iki adsiz satir gorunur.
const NORM = (col) => `ISNULL(NULLIF(LTRIM(RTRIM(CAST(${col} AS NVARCHAR(400)))), ''), '(boş)')`;

function pickSource(raw) {
  const key = String(raw || 'hosts');
  return SOURCES[key] ? key : 'hosts';
}

// ISTEGE BAGLI KOLONLAR: tabloda gercekten var mi (sys.columns, 10 dk onbellek). Yoksa o boyut
// sorgudan cikar - tek eksik kolon UNION ALL sorgusunun TAMAMINI (tum sayfayi) dusururdu. Kolon
// listesi okunamazsa istege bagli boyutlar da cikar (temkinli yon; zorunlu boyutlar etkilenmez).
const KOLON_TTL_MS = 10 * 60 * 1000;
const _kolonOnbellek = new Map();
async function tabloKolonlari(table) {
  const o = _kolonOnbellek.get(table);
  if (o && Date.now() - o.at < KOLON_TTL_MS) return o.kolonlar;
  const { query, sql } = require('../inventory/mssql.cjs');
  const rs = await query(
    `SELECT LOWER(c.name) AS name FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t)`,
    [{ name: 't', type: sql.NVarChar(256), value: table }],
  );
  const kolonlar = new Set((rs.recordset || []).map((x) => String(x.name)));
  _kolonOnbellek.set(table, { at: Date.now(), kolonlar });
  return kolonlar;
}
async function mevcutBoyutlar(srcKey) {
  const src = SOURCES[srcKey];
  if (!src.dims.some((d) => d.istegeBagli)) return { dims: src.dims, eksik: [] };
  let kolonlar = null;
  try {
    kolonlar = await tabloKolonlari(src.table);
  } catch {
    kolonlar = null;
  }
  const dims = src.dims.filter((d) => !d.istegeBagli || (kolonlar && kolonlar.has(d.col.toLowerCase())));
  const eksik = src.dims.filter((d) => d.istegeBagli && !dims.includes(d)).map((d) => d.label);
  return { dims, eksik };
}

function pickDim(src, raw, fallback, dims = SOURCES[src].dims) {
  const found = dims.find((d) => d.col === String(raw || ''));
  return found || dims.find((d) => d.col === fallback) || dims[0];
}

function registerEnvanterMetrics(router) {
  // ── Katalog: arayuz hangi kaynaklar/boyutlar var bilsin ─────────────────────────────
  router.get('/envanter/sources', (_req, res) => {
    res.json({
      ok: true,
      sources: Object.entries(SOURCES).map(([key, s]) => ({
        key, label: s.label, unit: s.unit,
        dims: s.dims.map((d) => ({ key: d.col, label: d.label, product: d.product || null })),
      })),
    });
  });

  // ── 1) OZET + TUM BOYUTLARIN DAGILIMI ───────────────────────────────────────────────
  // Tek gidis-donus: her boyut icin bir GROUP BY, hepsi UNION ALL ile birlestirilir.
  // Boyut basina ayri istek atmak 11 gidis-donus demek olurdu.
  router.get('/envanter/summary', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const srcKey = pickSource(req.query.source);
      const src = SOURCES[srcKey];
      const T = src.table;
      const { dims, eksik: eksikBoyutlar } = await mevcutBoyutlar(srcKey);

      const parts = dims.map((d) => `
        SELECT '${d.col}' AS dim, ${NORM(d.col)} AS val, COUNT(*) AS n,
               ${src.hasHost ? 'COUNT(DISTINCT host)' : 'COUNT(*)'} AS hosts
          FROM ${T} GROUP BY ${NORM(d.col)}`);

      const totalsSelect = [
        'COUNT(*) AS rows_total',
        src.hasHost ? 'COUNT(DISTINCT host) AS host_total' : '0 AS host_total',
        src.hasApp ? 'COUNT(DISTINCT app) AS app_total' : '0 AS app_total',
        ...src.numerics.map((nm) => `SUM(TRY_CONVERT(bigint, ${nm.col})) AS sum_${nm.key}`),
      ].join(', ');

      const [distRes, totalRes] = await Promise.all([
        query(parts.join('\n        UNION ALL')),
        query(`SELECT ${totalsSelect} FROM ${T}`),
      ]);

      const distributions = {};
      for (const d of dims) distributions[d.col] = [];
      for (const r of distRes.recordset || []) {
        const bucket = distributions[r.dim];
        if (bucket) bucket.push({ value: String(r.val), count: Number(r.n) || 0, hosts: Number(r.hosts) || 0 });
      }
      for (const k of Object.keys(distributions)) {
        distributions[k].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'tr'));
      }

      const t = (totalRes.recordset || [])[0] || {};

      // "Kurulu" sayimi: surum alani DOLU olan sunucu sayisi. Urun sutunu bos ise o urun o
      // sunucuda yok demektir (loader bos birakir) - bu yuzden "(bos)" kovasi disarida kalir.
      const products = dims
        .filter((d) => d.product)
        .map((d) => {
          const rowsFor = distributions[d.col] || [];
          const installed = rowsFor.filter((x) => x.value !== '(boş)');
          return {
            key: d.col,
            label: d.product,
            installed: installed.reduce((a, x) => a + x.hosts, 0),
            versionCount: installed.length,
            versions: installed,
          };
        })
        .sort((a, b) => b.installed - a.installed);

      res.json({
        ok: true,
        source: srcKey,
        label: src.label,
        unit: src.unit,
        totals: {
          rows: Number(t.rows_total) || 0,
          hosts: Number(t.host_total) || 0,
          apps: Number(t.app_total) || 0,
          numerics: src.numerics.map((nm) => ({
            key: nm.key, label: nm.label, value: Number(t['sum_' + nm.key]) || 0,
          })),
        },
        dims: dims.map((d) => ({ key: d.col, label: d.label })),
        products,
        distributions,
        // Tabloda olmadigi icin hesaplanmayan istege bagli kirilimlar (ekran not olarak yazar).
        eksikBoyutlar,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Envanter metrikleri alınamadı.' });
    }
  });

  // ── 2) CAPRAZ TABLO (pivot) ─────────────────────────────────────────────────────────
  // "Bu urunun surumleri hangi domain'lerde/subnet'lerde nasil dagilmis" sorusunun cevabi.
  // x ve y istemciden gelir ama SQL'e giren ad HER ZAMAN beyaz listedeki sabit sutun adidir.
  router.get('/envanter/pivot', async (req, res) => {
    try {
      const { query } = require('../inventory/mssql.cjs');
      const srcKey = pickSource(req.query.source);
      const src = SOURCES[srcKey];
      const { dims } = await mevcutBoyutlar(srcKey);
      const x = pickDim(srcKey, req.query.x, 'domain', dims);
      const y = pickDim(srcKey, req.query.y, dims.find((d) => d.product)?.col || dims[1].col, dims);
      // metric=hosts yalnizca uygulama tablolarinda anlamli; dbo.Inventory'de zaten satir=sunucu.
      const metric = String(req.query.metric || 'rows') === 'hosts' && src.hasHost ? 'hosts' : 'rows';
      const agg = metric === 'hosts' ? 'COUNT(DISTINCT host)' : 'COUNT(*)';
      // "(bos)" = urun o sunucuda kurulu degil. Surum kirilimina bakarken bu kova tabloyu
      // sisirir, o yuzden istege bagli olarak disarida birakilabilir.
      const hideEmpty = String(req.query.hideEmpty || '') === '1';

      const rs = await query(`
        SELECT ${NORM(x.col)} AS xv, ${NORM(y.col)} AS yv, ${agg} AS n
          FROM ${src.table}
         ${hideEmpty ? `WHERE NULLIF(LTRIM(RTRIM(CAST(${y.col} AS NVARCHAR(400)))), '') IS NOT NULL` : ''}
         GROUP BY ${NORM(x.col)}, ${NORM(y.col)}`);

      const cells = {};
      const rowTotals = new Map();
      const colTotals = new Map();
      let total = 0;
      for (const r of rs.recordset || []) {
        const xv = String(r.xv), yv = String(r.yv), n = Number(r.n) || 0;
        // Ayirici olarak U+0001: bosluk kullanilsaydi "a b"+"c" ile "a"+"b c" AYNI
        // anahtari uretir ve hucreler birbirinin uzerine yazardi. Bu karakter envanter
        // verisinde gecmez. Istemci AYNI ayiriciyi kullanir.
        cells[xv + '\u0001' + yv] = n;
        colTotals.set(xv, (colTotals.get(xv) || 0) + n);
        rowTotals.set(yv, (rowTotals.get(yv) || 0) + n);
        total += n;
      }
      const sortDesc = (m) => [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'))
        .map(([value, count]) => ({ value, count }));

      res.json({
        ok: true,
        source: srcKey,
        metric,
        x: { key: x.col, label: x.label, values: sortDesc(colTotals) },
        y: { key: y.col, label: y.label, values: sortDesc(rowTotals) },
        cells,
        total,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Çapraz tablo alınamadı.' });
    }
  });
}

module.exports = { registerEnvanterMetrics, SOURCES, _kolonOnbellek };
