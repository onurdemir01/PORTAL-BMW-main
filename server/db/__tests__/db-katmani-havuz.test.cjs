// server/db/__tests__/db-katmani-havuz.test.cjs
//
// DB katmani: yavas sorgu gunlugu, havuz dolulugu (tarn API), havuz ayarlari ve
// getPool tek-ucus (single-flight). Gercek DB GEREKMEZ — mssql.ConnectionPool sahte.
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('mssql');

const METRICS = require.resolve('../../metrics.cjs');
const PORTAL = require.resolve('../portal-mssql.cjs');
const DBIDX = require.resolve('../index.cjs');
const INV = require.resolve('../../inventory/mssql.cjs');
const RO = require.resolve('../../inventory/mssql-readonly.cjs');

const ORIG_POOL = sql.ConnectionPool;
const ORIG_NOW = Date.now;
let eskiEnv;
let uyarilar;
let origWarn, origErr, origLog;

function taze() {
  for (const m of [PORTAL, DBIDX, INV, RO]) delete require.cache[m];
}

// Sahte tarn havuzu + ConnectionPool. `ayar.gecikme` ms sonra connect cozulur.
function sahteHavuz(ayar = {}) {
  const kurulan = [];
  sql.ConnectionPool = class {
    constructor(cfg) {
      this.config = cfg;
      this.dinleyici = {};
      this.kapandi = false;
      this.pool = {
        max: cfg.pool && cfg.pool.max, min: cfg.pool && cfg.pool.min,
        numUsed: () => 3, numFree: () => 2, numPendingAcquires: () => 1,
      };
      kurulan.push(this);
    }
    connect() {
      const hata = typeof ayar.hata === 'function' ? ayar.hata() : ayar.hata;
      return new Promise((res, rej) => setTimeout(() => (hata ? rej(new Error('baglanamadi')) : res(this)), ayar.gecikme || 5));
    }
    on(ad, fn) { this.dinleyici[ad] = fn; }
    close() { this.kapandi = true; return Promise.resolve(); }
    request() {
      const self = this;
      return {
        input() {},
        query(q) {
          self.sonSorgu = q;
          return new Promise((res) => setTimeout(() => res({ recordset: [{ a: 1 }, { a: 2 }], rowsAffected: [2] }), ayar.sorguMs || 1));
        },
      };
    }
  };
  return kurulan;
}

beforeEach(() => {
  eskiEnv = { ...process.env };
  Object.assign(process.env, {
    MSSQL_SERVER: 'sunucu', MSSQL_DATABASE: 'db', MSSQL_USER: 'u', MSSQL_PASSWORD: 'p',
    MSSQL_RO_USER: 'ro', MSSQL_RO_PASSWORD: 'p',
  });
  delete process.env.SLOW_QUERY_MS;
  delete process.env.TBMWANS_DB_POOL_MIN;
  uyarilar = [];
  origWarn = console.warn; origErr = console.error; origLog = console.log;
  console.warn = (...a) => uyarilar.push(a.join(' '));
  console.error = () => {};
  console.log = () => {};
  taze();
});

afterEach(() => {
  sql.ConnectionPool = ORIG_POOL;
  Date.now = ORIG_NOW;
  process.env = eskiEnv;
  console.warn = origWarn; console.error = origErr; console.log = origLog;
  taze();
});

const yavas = () => uyarilar.filter((u) => u.startsWith('[SlowQuery]'));

// -- (1) Yavas sorgu gunlugu ----------
test('Y1 esik altinda sessiz, ustunde tek satir; SQL bosluklari daraltilir ve 150 karakter', () => {
  const m = require(METRICS);
  assert.equal(m.slowQueryThresholdMs(), 500, 'varsayilan esik 500 ms olmali');
  assert.equal(m.reportQueryTiming({ pool: 'x', waitNs: 100_000_000n, queryNs: 300_000_000n, sqlText: 'SELECT 1' }), false);
  assert.equal(yavas().length, 0);

  const uzun = 'SELECT   a,\n\t b\r\n FROM t WHERE ' + 'x'.repeat(400);
  assert.equal(m.reportQueryTiming({
    pool: 'portal', waitNs: 200_000_000n, queryNs: 400_000_000n, result: { recordset: [1, 2, 3] }, sqlText: uzun,
  }), true);
  const s = yavas();
  assert.equal(s.length, 1);
  assert.match(s[0], /pool=portal wait=200\.0ms query=400\.0ms loopLag=\d+ms rows=3 /);
  const onizleme = s[0].match(/sql="([^"]*)"/)[1];
  assert.equal(onizleme.length, 150);
  assert.ok(onizleme.startsWith('SELECT a, b FROM t WHERE x'), onizleme);
  assert.doesNotMatch(s[0], /\n|\t|\r/);
});

test('Y2 SLOW_QUERY_MS env esigi; gecersiz deger varsayilana duser', () => {
  const m = require(METRICS);
  process.env.SLOW_QUERY_MS = '50';
  assert.equal(m.reportQueryTiming({ pool: 'x', waitNs: 0n, queryNs: 60_000_000n, sqlText: 'q' }), true);
  process.env.SLOW_QUERY_MS = 'abc';
  assert.equal(m.slowQueryThresholdMs(), 500);
  assert.equal(m.reportQueryTiming({ pool: 'x', waitNs: 0n, queryNs: 60_000_000n, sqlText: 'q' }), false);
});

test('Y3 Portal adapter: bekleme/sorgu ayri olculur, parametre DEGERI gunluge yazilmaz', async () => {
  process.env.SLOW_QUERY_MS = '0';
  sahteHavuz({ sorguMs: 3 });
  const db = require(DBIDX);
  const r = await db.query('SELECT * FROM t WHERE parola = $1 AND n = $2', ['GIZLI-DEGER-123', 42]);
  assert.equal(r.rows.length, 2);
  const s = yavas();
  assert.equal(s.length, 1, s.join('\n'));
  assert.match(s[0], /^\[SlowQuery\] pool=portal wait=\d+\.\dms query=\d+\.\dms loopLag=\d+ms rows=2 sql="SELECT \* FROM t WHERE parola = @p1 AND n = @p2"$/);
  assert.doesNotMatch(s[0], /GIZLI-DEGER-123/);
  assert.doesNotMatch(s[0].match(/sql="([^"]*)"/)[1], /42/);
});

test('Y4 Portal adapter yeniden deneme yolu da olculur (retry=1)', async () => {
  process.env.SLOW_QUERY_MS = '0';
  sahteHavuz();
  const portal = require(PORTAL);
  let ilk = true;
  const havuz = await portal.getPool();
  const origReq = havuz.request.bind(havuz);
  havuz.request = () => {
    const r = origReq();
    if (ilk) {
      ilk = false;
      r.query = () => Promise.reject(Object.assign(new Error('kopuk'), { code: 'ECONNRESET' }));
    }
    return r;
  };
  const db = require(DBIDX);
  const r = await db.query('SELECT 1');
  assert.equal(r.rows.length, 2);
  const s = yavas();
  assert.equal(s.length, 2, s.join('\n'));
  assert.match(s[0], /status=error/);
  assert.doesNotMatch(s[0], /retry=1/);
  assert.match(s[1], /rows=2 retry=1 /);
});

test('Y5 TBMWANS query/queryLong olculur; input degerleri gunluge yazilmaz', async () => {
  process.env.SLOW_QUERY_MS = '0';
  sahteHavuz();
  const inv = require(INV);
  await inv.query('SELECT  *\n FROM Inventory WHERE h=@h', [{ name: 'h', type: sql.NVarChar, value: 'GIZLI-HOST' }]);
  await inv.queryLong('SELECT 2', []);
  const s = yavas();
  assert.equal(s.length, 2, s.join('\n'));
  assert.match(s[0], /pool=tbmwans wait=.* rows=2 sql="SELECT \* FROM Inventory WHERE h=@h"/);
  assert.match(s[1], /pool=tbmwans-long /);
  assert.doesNotMatch(s.join('\n'), /GIZLI-HOST/);
});

test('Y6 salt-okunur havuz: request().query olculur, callback bicimi aynen gecer', async () => {
  process.env.SLOW_QUERY_MS = '0';
  sahteHavuz();
  const ro = require(RO);
  const havuz = await ro.getReadOnlyPool();
  const r = await havuz.request().query('SELECT TOP 5 * FROM t');
  assert.equal(r.recordset.length, 2);
  assert.equal(yavas().length, 1);
  assert.match(yavas()[0], /pool=tbmwans-ro wait=0\.0ms .* rows=2 sql="SELECT TOP 5 \* FROM t"/);
  // ayni havuz iki kez sarilmaz
  assert.equal(await ro.getReadOnlyPool(), havuz);
  await havuz.request().query('SELECT 1');
  assert.equal(yavas().length, 2);
});

test('Y7 sorgu hatasi aynen iletilir ve gunluk satiri status=error tasir', async () => {
  const m = require(METRICS);
  process.env.SLOW_QUERY_MS = '0';
  await assert.rejects(
    m.timeQuery('p', 0n, 'SELECT x', () => new Promise((_, rej) => setTimeout(() => rej(new Error('boom')), 2))),
    /boom/,
  );
  assert.match(yavas()[0], /rows=- status=error/);
});

// -- (2) Havuz dolulugu ----------
test('H1 TBMWANS poolStats tarn API`sini okur (null degil) ve snapshot`ta ana + uzun havuz', async () => {
  sahteHavuz();
  const inv = require(INV);
  assert.equal(inv.poolStats(), null, 'havuz yokken null');
  await inv.getPool();
  const st = inv.poolStats();
  assert.equal(st.used, 3);
  assert.equal(st.free, 2);
  assert.equal(st.size, 5);
  assert.equal(st.pending, 1);
  assert.equal(st.pendingAcquires, 1);
  assert.equal(st.max, 20);
  assert.equal(inv.longPoolStats(), null);
  await inv.queryLong('SELECT 1');
  assert.equal(inv.longPoolStats().max, 4);

  const snap = require(METRICS).snapshot();
  assert.equal(snap.tbmwansDbPool.main.used, 3);
  assert.equal(snap.tbmwansDbPool.long.max, 4);
  assert.ok('portalDbPool' in snap, 'mevcut alan korunmali');
});

// -- (3) Havuz ayarlari ----------
test('A1 TBMWANS ana ve salt-okunur havuz: min env (varsayilan 2), idle 300000', async () => {
  const kurulan = sahteHavuz();
  await require(INV).getPool();
  await require(RO).getReadOnlyPool();
  assert.deepEqual(kurulan.map((p) => p.config.pool), [
    { max: 20, min: 2, idleTimeoutMillis: 300000 },
    { max: 10, min: 2, idleTimeoutMillis: 300000 },
  ]);
  taze();
  process.env.TBMWANS_DB_POOL_MIN = '5';
  const k2 = sahteHavuz();
  await require(INV).getPool();
  await require(RO).getReadOnlyPool();
  assert.deepEqual(k2.map((p) => p.config.pool.min), [5, 5]);
});

// -- (4) Tek-ucus ----------
const MODULLER = [
  ['portal-mssql', () => require(PORTAL).getPool],
  ['inventory/mssql', () => require(INV).getPool],
  ['mssql-readonly', () => require(RO).getReadOnlyPool],
];

for (const [ad, al] of MODULLER) {
  test(`T1 ${ad}: eszamanli cagrilar TEK ConnectionPool kurar`, async () => {
    const kurulan = sahteHavuz({ gecikme: 20 });
    const getPool = al();
    const sonuc = await Promise.all(Array.from({ length: 8 }, () => getPool()));
    assert.equal(kurulan.length, 1, `${kurulan.length} havuz kuruldu`);
    assert.ok(sonuc.every((p) => p === kurulan[0]));
  });

  test(`T2 ${ad}: hata sonrasi bekleyen soz temizlenir, cooldown korunur`, async () => {
    let hata = true;
    const kurulan = sahteHavuz({ hata: () => hata });
    const getPool = al();
    const sonuc = await Promise.all([getPool(), getPool()]);
    assert.deepEqual(sonuc, [null, null]);
    assert.equal(kurulan.length, 1);
    hata = false;
    assert.equal(await getPool(), null, 'cooldown penceresinde yeniden denememeli');
    assert.equal(kurulan.length, 1);
    const t = ORIG_NOW();
    Date.now = () => t + 11_000;
    const p = await getPool();
    assert.equal(p, kurulan[1], 'cooldown sonrasi yeniden kurulmali');
  });

  test(`T3 ${ad}: hata veren eski havuz, yenisi kurulunca kapatilir`, async () => {
    const kurulan = sahteHavuz();
    const getPool = al();
    const eski = await getPool();
    eski.dinleyici.error(new Error('koptu'));
    assert.equal(eski.kapandi, false, 'yenisi kurulmadan kapatilmamali');
    const t = ORIG_NOW();
    Date.now = () => t + 11_000;
    const yeni = await getPool();
    assert.notEqual(yeni, eski);
    assert.equal(eski.kapandi, true, 'eski havuz sizdi');
    // eski havuzdan gelen gecikmis hata, yeni havuzu dusurmemeli
    eski.dinleyici.error(new Error('gecikmis'));
    assert.equal(await getPool(), yeni);
    assert.equal(kurulan.length, 2);
  });
}

test('T4 uzun-sorgu havuzu da tek-ucus', async () => {
  const kurulan = sahteHavuz({ gecikme: 15 });
  const inv = require(INV);
  await Promise.all(Array.from({ length: 5 }, () => inv.queryLong('SELECT 1')));
  assert.equal(kurulan.length, 2, 'ana + tek uzun havuz bekleniyordu');
});

// -- (2026-11-13) Olcum: uzun havuz yedegi ayri etiket, yavas HTTP satiri ----------
test('Y8 uzun havuz kurulamazsa ana havuza dusulur ve etiket tbmwans(long-fallback)', async () => {
  process.env.SLOW_QUERY_MS = '0';
  let n = 0;
  sahteHavuz({ hata: () => (n++ === 1) });
  const inv = require(INV);
  await inv.queryLong('SELECT 3', []);
  const s = yavas();
  assert.equal(s.length, 1, s.join('\n'));
  assert.match(s[0], /pool=tbmwans\(long-fallback\) /);
});

function sahteIstek({ baseUrl, routePath, originalUrl, method = 'GET' }) {
  const EventEmitter = require('node:events');
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = { method, baseUrl, originalUrl, url: originalUrl, route: routePath ? { path: routePath } : undefined, query: { token: 'GIZLI' } };
  return { req, res };
}
const yavasHttp = () => uyarilar.filter((u) => u.startsWith('[SlowHttp]'));

test('SH1 yavas istek: rota KALIBI yazilir; ham URL / query string / deger yazilmaz', async () => {
  const m = require(METRICS);
  process.env.SLOW_HTTP_MS = '0';
  const { req, res } = sahteIstek({ baseUrl: '/api/oco', routePath: '/calendar', originalUrl: '/api/oco/calendar?token=GIZLI&group=6203' });
  await new Promise((r) => m.middleware(req, res, r));
  await new Promise((r) => setTimeout(r, 3));
  res.emit('finish');
  const s = yavasHttp();
  assert.equal(s.length, 1, uyarilar.join('\n'));
  assert.match(s[0], /^\[SlowHttp\] method=GET route=\/api\/oco\/calendar status=200 ms=\d+ loopLag=\d+ms$/);
  assert.doesNotMatch(s[0], /GIZLI|\?|6203/);
});

test('SH2 rota eslesmediyse yalniz baseUrl; esik altinda sessiz', async () => {
  const m = require(METRICS);
  process.env.SLOW_HTTP_MS = '0';
  const a = sahteIstek({ baseUrl: '/api', originalUrl: '/api/yok/GIZLI?x=1' });
  m.middleware(a.req, a.res, () => {});
  await new Promise((r) => setTimeout(r, 2));
  a.res.emit('finish');
  assert.match(yavasHttp()[0], / route=\/api status=/);
  assert.doesNotMatch(yavasHttp()[0], /GIZLI/);
  process.env.SLOW_HTTP_MS = '60000';
  const b = sahteIstek({ baseUrl: '/api/oco', routePath: '/calendar', originalUrl: '/api/oco/calendar' });
  m.middleware(b.req, b.res, () => {});
  b.res.emit('finish');
  assert.equal(yavasHttp().length, 1, 'esik altindaki istek yazildi');
  delete process.env.SLOW_HTTP_MS;
  assert.equal(m.slowHttpThresholdMs(), 1500);
});
