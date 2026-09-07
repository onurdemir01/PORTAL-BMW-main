// server/inventory/__tests__/history-routes.test.cjs
//
// NEDEN VAR: envanter geçmişi için beş yeni uç (server/inventory/index.cjs) ve beş
// istemci fonksiyonu (src/api/inventoryApi.ts) AYNI ANDA yazıldı. İkisi ayrı dosyada
// yaşadığı için biri yeniden adlandırılırsa diğeri sessizce 404 almaya başlar — ekran
// "veri yok" der, hata vermez. Bu tür sessiz ayrışma tam olarak burada kilitleniyor.
//
// Ek olarak yapılandırmanın kendisi doğrulanır: her tablo tanımının bir anahtarı olmalı
// ve last_seen_at HER tabloda hash dışı bırakılmış olmalı (dahil edilseydi her satır
// her gece "değişti" sayılırdı — bkz. history.cjs).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const CLIENT = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'api', 'inventoryApi.ts'),
  'utf8',
);

const ROUTES = ['/history/tables', '/history/runs', '/history/at', '/history/diff', '/history/series'];

test('istemcinin cagirdigi HER gecmis ucu sunucuda TANIMLI', () => {
  for (const r of ROUTES) {
    assert.ok(
      SERVER.includes(`'${r}'`),
      `sunucuda tanimli degil: ${r} (istemci bunu cagiriyor, 404 alir)`,
    );
    assert.ok(
      CLIENT.includes(r.replace('/history/', '/history/')),
      `istemcide kullanilmiyor: ${r}`,
    );
  }
});

test('elle tetikleme ucu YALNIZCA Admin', () => {
  const i = SERVER.indexOf("'/history/snapshot'");
  assert.ok(i > 0, 'snapshot ucu bulunamadi');
  // Ucun govdesinde admin kapisi olmali; yoksa herhangi bir kullanici gecmis yazdirabilirdi.
  const body = SERVER.slice(i, i + 600);
  assert.match(body, /isAdmin\(req\)/, 'snapshot ucu admin kapisi tasimali');
});

test('okuma uclari tablo adini DOGRUDAN SQL-e gommuyor', () => {
  // rowsAt/diff/series tablo adini history-config allowlist-inden gecirir; uc katmani
  // ham query parametresini SQL-e koymamali.
  assert.ok(
    !/FROM dbo\.\$\{|FROM \$\{req\.query/.test(SERVER),
    'tablo adi SQL-e dogrudan gomulmemeli',
  );
});

// ── Yapilandirma ───────────────────────────────────────────────────────────────

const { TABLES, getTable, snapshotTables } = require('../history-config.cjs');

test('her tablonun anahtari ve etiketi var', () => {
  for (const t of TABLES) {
    assert.ok(Array.isArray(t.key) && t.key.length > 0, `${t.table}: anahtar yok`);
    assert.ok(t.label, `${t.table}: etiket yok`);
    assert.ok(['snapshot', 'native'].includes(t.mode), `${t.table}: gecersiz mode`);
  }
});

test('last_seen_at anlik goruntu alinan HER tabloda hash DISINDA (en kritik ayar)', () => {
  // Yalnizca `snapshot` tablolari icin gecerli: `native` tablolarin (NginxRateLimit-
  // Inventory) satirlari HIC hash-lenmez — gecmisi kaynagin kendi scan_date kolonundan
  // okunur — ve o tabloda zaten last_seen_at kolonu yoktur.
  for (const t of snapshotTables()) {
    assert.ok(
      (t.volatile || []).some((c) => c.toLowerCase() === 'last_seen_at'),
      `${t.table}: last_seen_at hash-e girerse HER satir HER gece "degisti" sayilir`,
    );
  }
});

test('kullanicinin onayladigi bes tablo kapsamda', () => {
  for (const name of ['Inventory', 'MWAppsInventory', 'BMW_Certificates_Inventory',
                      'Openshift_Inventory', 'NginxRateLimitInventory']) {
    assert.ok(getTable(name), `kapsamda degil: ${name}`);
  }
});

test('NginxRateLimitInventory anlik goruntu ALMAZ (zaten scan_date ile gecmis tutuyor)', () => {
  assert.strictEqual(getTable('NginxRateLimitInventory').mode, 'native');
  assert.ok(
    !snapshotTables().some((t) => t.table === 'NginxRateLimitInventory'),
    'ayni veriyi ikinci kez saklamamali',
  );
});

test('anahtar kolonlari yukleyicilerin DELETE ifadeleriyle ayni', () => {
  // Bu degerler bmw_inventory yukleyicilerinden alindi; degistirilirse "ayni satir"
  // tanimi kaynakla ayrisir ve fark ekrani anlamsiz sonuc uretir.
  assert.deepStrictEqual(getTable('Inventory').key, ['host']);
  assert.deepStrictEqual(getTable('MWAppsInventory').key, ['host', 'app', 'app_path']);
  assert.deepStrictEqual(getTable('BMW_Certificates_Inventory').key,
    ['env', 'host', 'conf_file', 'cert_file']);
  assert.deepStrictEqual(getTable('Openshift_Inventory').key,
    ['cluster', 'namespace', 'application']);
});
