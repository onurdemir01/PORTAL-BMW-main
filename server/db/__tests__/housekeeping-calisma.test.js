// server/db/__tests__/housekeeping-calisma.test.js - DB doluluk ve gece temizliginin CALISMA ZAMANI (2026-11-24,
// kapsam PR-2). housekeeping.test.js saf fonksiyonlari sinar; burada sahte havuz, sahte Teams ve sahte saatle
// doluluk okuma, parti parti temizlik, durum kaliciligi, zamanlayici ve iki Admin ucu kosar.
//   HR1 readUsage: havuz yok hatasi; dosya / disk / log bekleme / buyuk tablo eslemesi; izin yoksa disk null
//   HR2 runHousekeeping: her adim TOP (@n) partileriyle biter; sayaclar; durum kaydi UPDATE yoksa INSERT
//   HR3 runHousekeeping hatasi: genel mesaj (ham hata istemciye gitmez), durum yine kaydedilir; kosarken ikinci cagri bos
//   HR4 zamanlayici + uclar (init modul basina bir kez): kayitli durum yuklenir; 20 sn sonra doluluk + gunde bir
//       Teams karti; Teams hatasi uyari kalir (gun isaretlenmez); ayarli saatte temizlik gunde bir kez; okuma
//       hatasinda zamanlayici durmaz; Admin disi 403; webhook adresi istemciye gitmez; 500 genel mesaj; kosarken 409
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const H = { pool: null, hata: null, partiler: {}, sorgular: [], izinYok: false, dbInfoHata: false };
function havuz() {
  return {
    request() {
      const girdi = {};
      const r = {
        input(ad, tip, deger) {
          girdi[ad] = deger;
          return r;
        },
        async query(sql) {
          const metin = String(sql).replace(/\s+/g, ' ').trim();
          H.sorgular.push({ metin, girdi: { ...girdi } });
          if (H.hata && H.hata.test(metin)) throw new Error('ham surucu hatasi: baglanti koptu');
          if (metin.includes('FROM sys.database_files'))
            return {
              recordset: [
                {
                  name: 'ORN_DATA',
                  type_desc: 'ROWS',
                  physical_name: 'D:\\data\\orn.ndf',
                  size_mb: '9800.0',
                  used_mb: '9500.0',
                  max_size: 1280000,
                  growth: 65536,
                  is_percent_growth: false,
                },
                {
                  name: 'ORN_LOG',
                  type_desc: 'LOG',
                  physical_name: 'L:\\log\\orn.ldf',
                  size_mb: '2000.0',
                  used_mb: '100.0',
                  max_size: 268435456,
                  growth: 10,
                  is_percent_growth: true,
                },
              ],
            };
          if (metin.includes('sys.dm_os_volume_stats')) {
            if (H.izinYok) throw new Error('VIEW SERVER STATE izni yok');
            return {
              recordset: [
                {
                  name: 'ORN_LOG',
                  volume_mount_point: 'L:\\',
                  total_mb: '50000.0',
                  free_mb: '0.0',
                },
              ],
            };
          }
          if (metin.includes('FROM sys.databases')) {
            if (H.dbInfoHata) throw new Error('izin yok');
            return {
              recordset: [{ log_reuse_wait_desc: 'LOG_BACKUP', recovery_model_desc: 'FULL' }],
            };
          }
          if (metin.includes('FROM sys.tables'))
            return {
              recordset: [{ name: 'logx_v2_jobs', rows_count: '8000', reserved_mb: '1100.5' }],
            };
          // Temizlik adimlari: tablo basina sirali parti sonuclari.
          const anahtar = /(?:UPDATE|DELETE) TOP \(@n\) (?:FROM )?(\w+)/.exec(metin)?.[1];
          if (anahtar) {
            const kuyruk = H.partiler[anahtar] || [];
            return { rowsAffected: [kuyruk.length ? kuyruk.shift() : 0] };
          }
          throw new Error(`beklenmeyen sorgu: ${metin.slice(0, 80)}`);
        },
      };
      return r;
    },
  };
}
sahte('portal-mssql.cjs', {
  getPool: async () => H.pool,
  sql: { Int: 'Int' },
});
const B = { satir: null, yazim: [], updSayisi: 0, okumaHata: false };
sahte('index.cjs', {
  query: async (sql, params) => {
    if (/^SELECT data FROM portal_config_blobs/.test(sql)) {
      if (B.okumaHata) throw new Error('tablo yok');
      return { rows: B.satir ? [{ data: B.satir }] : [] };
    }
    B.yazim.push({ sql, params });
    if (/^UPDATE portal_config_blobs/.test(sql)) return { rowCount: B.updSayisi };
    return { rowCount: 1 };
  },
});
sahte('../mcp/client.cjs', { buildDispatcher: () => undefined });
const denetim = [];
sahte('../audit/index.cjs', { auditPortal: (req, olay) => denetim.push(olay) });

const hk = require('../housekeeping.cjs');

const sessiz = (t) => {
  const kayit = { log: [], warn: [], error: [] };
  for (const k of Object.keys(kayit))
    t.mock.method(console, k, (...a) => kayit[k].push(a.join(' ')));
  return kayit;
};
const bosalt = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

const uclar = {};
const app = {
  get: (yol, fn) => (uclar[`GET ${yol}`] = fn),
  post: (yol, fn) => (uclar[`POST ${yol}`] = fn),
};
function cagir(uc, rol) {
  return new Promise((resolve) => {
    const res = {
      kod: 200,
      status(n) {
        this.kod = n;
        return this;
      },
      json(govde) {
        resolve({ status: this.kod, body: govde });
      },
    };
    uclar[uc]({ session: { user: { username: 'adm', role: rol } } }, res);
  });
}

test('HR1 readUsage: havuz yoksa hata; dosya, disk ve tablo eslemesi', async (t) => {
  sessiz(t);
  H.pool = null;
  await assert.rejects(hk.readUsage(), /Portal DB bağlantısı yok/);
  H.pool = havuz();
  const eskiDb = process.env.PORTAL_DB_DATABASE;
  process.env.PORTAL_DB_DATABASE = 'ORNEKDB';
  try {
    const u = await hk.readUsage();
    assert.equal(u.database, 'ORNEKDB');
    const [veri, log] = u.files;
    assert.equal(veri.kind, 'data');
    assert.equal(veri.cap_mb, 10000);
    assert.equal(veri.growth, '512 MB');
    assert.equal(veri.volume, null);
    assert.equal(Math.round(veri.alert_pct), 95);
    assert.equal(log.kind, 'log');
    assert.equal(log.cap_mb, null, '2 TB log sinirsiz sayilir');
    assert.equal(log.growth, '%10');
    assert.equal(log.volume, 'L:\\');
    assert.equal(log.alert_pct, 5, 'sinirsiz log diskteki bos alana gore');
    assert.equal(u.logReuseWait, 'LOG_BACKUP');
    assert.equal(u.recoveryModel, 'FULL');
    assert.deepEqual(u.topTables, [{ name: 'logx_v2_jobs', rows: 8000, reserved_mb: 1100.5 }]);
    H.izinYok = true;
    H.dbInfoHata = true;
    const k = await hk.readUsage();
    assert.equal(k.files[1].volume, null);
    assert.equal(k.files[1].alert_pct, 5, 'disk yoksa dosya ici doluluk');
    assert.equal(k.logReuseWait, null);
  } finally {
    H.izinYok = false;
    H.dbInfoHata = false;
    if (eskiDb === undefined) delete process.env.PORTAL_DB_DATABASE;
    else process.env.PORTAL_DB_DATABASE = eskiDb;
  }
});

test('HR2 runHousekeeping: partiler, sayaclar, durum kaydi', async (t) => {
  sessiz(t);
  H.pool = havuz();
  H.sorgular = [];
  B.yazim = [];
  B.updSayisi = 0;
  // batchSize 2000: 2000 + 2000 + 5 -> uc parti; LogX istek silme 500'luk partilerle.
  H.partiler = {
    logx_v2_jobs: [2000, 2000, 5],
    logx_v2_requests: [7, 500, 500, 3],
    nginx_loadtest_adimlar: [500, 20],
    nginx_loadtest_kosular: [4],
  };
  const s = await hk.runHousekeeping();
  assert.equal(s.status, 'done');
  assert.equal(s.logxBlobsCleared, 4005 + 7);
  assert.equal(s.logxRequestsDeleted, 1003);
  assert.equal(s.nginxLoadtestStepsDeleted, 520);
  assert.equal(s.nginxLoadtestRunsDeleted, 4);
  assert.equal(s.lastError, null);
  assert.ok(s.finishedAt);
  const temizlik = H.sorgular.filter((q) => /TOP \(@n\)/.test(q.metin));
  assert.equal(temizlik.length, 3 + 1 + 3 + 2 + 1);
  assert.deepEqual(temizlik[0].girdi, { n: 2000, d: 30 });
  assert.deepEqual(
    temizlik.find((q) => q.metin.startsWith('DELETE TOP (@n) FROM logx_v2_requests')).girdi,
    { n: 500, d: 180 },
  );
  assert.deepEqual(temizlik.at(-1).girdi, { n: 500, d: 365 });
  // Suren yuk testi kosusu asla silinmez.
  assert.ok(
    temizlik
      .filter((q) => /nginx_loadtest/.test(q.metin))
      .every((q) => q.metin.includes("durum NOT IN ('QUEUED', 'RUNNING', 'FINALIZING')")),
  );
  // Durum: UPDATE 0 satir -> INSERT; lastUsage DB'ye yazilmaz.
  assert.match(B.yazim[0].sql, /^UPDATE portal_config_blobs/);
  assert.match(B.yazim[1].sql, /^INSERT INTO portal_config_blobs/);
  const kayit = JSON.parse(B.yazim[1].params[1]);
  assert.equal(kayit.status, 'done');
  assert.equal('lastUsage' in kayit, false);
  B.yazim = [];
  B.updSayisi = 1;
  await hk.runHousekeeping();
  assert.equal(B.yazim.length, 1, 'satir varken INSERT gitmemeli');
});

test('HR3 runHousekeeping hatasi genel mesajla kaydedilir; kosarken ikinci cagri bos doner', async (t) => {
  const k = sessiz(t);
  H.pool = havuz();
  H.hata = /DELETE TOP \(@n\) FROM logx_v2_requests/;
  B.yazim = [];
  const s = await hk.runHousekeeping();
  H.hata = null;
  assert.equal(s.status, 'error');
  assert.equal(s.lastError, 'Veritabanı bakım çalışması tamamlanamadı.');
  assert.ok(!JSON.stringify(s).includes('ham surucu'), 'ham hata durumda tutulmamali');
  assert.ok(
    k.error.some((x) => /ham surucu hatasi/.test(x)),
    'ham hata sunucu loguna yazilmali',
  );
  assert.equal(JSON.parse(B.yazim.at(-1).params[0]).status, 'error');

  H.pool = null;
  const s2 = await hk.runHousekeeping();
  assert.equal(s2.status, 'error');

  // Kosarken: ilk cagri bekletilir, ikinci cagri ayni durumu hemen doner.
  let birak;
  H.pool = {
    request: () => ({
      input() {
        return this;
      },
      query: () =>
        new Promise((r) => {
          birak = () => r({ rowsAffected: [0] });
        }),
    }),
  };
  const ilk = hk.runHousekeeping();
  await bosalt(3);
  const ikinci = await hk.runHousekeeping();
  assert.equal(ikinci.status, 'running');
  const sorguOncesi = H.sorgular.length;
  for (let i = 0; i < 6; i++) {
    birak();
    await bosalt(3);
  }
  assert.equal((await ilk).status, 'done');
  assert.equal(H.sorgular.length, sorguOncesi);
});

test('HR4 zamanlayici ve uclar: kayitli durum, gunde bir uyari, saatinde temizlik, yetki', async (t) => {
  const k = sessiz(t);
  // init modul basina BIR kez (zamanlayici modul duzeyinde); zamanlayici ve uclar ayni testte.
  const T0 = Date.parse('2026-11-24T10:00:00Z');
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: T0 });
  const saat = new Date(T0 + 3600e3).getHours();
  const env = {
    DB_USAGE_ALERT_WEBHOOK_URL: 'https://teams.ornek.invalid/hook?sig=GIZLI',
    DB_USAGE_ALERT_PERCENT: '90',
    DB_HOUSEKEEPING_HOUR: String(saat),
  };
  Object.assign(process.env, env);
  const teams = [];
  let teamsKod = 502;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    teams.push({ url, govde: JSON.parse(opts.body) });
    return new Response(teamsKod === 200 ? '' : 'vekil hata sayfasi', { status: teamsKod });
  });
  B.satir = JSON.stringify({
    status: 'running',
    alertsSent: 'bozuk',
    finishedAt: '2026-11-23T03:10:00.000Z',
    logxBlobsCleared: 9,
  });
  H.pool = havuz();
  H.partiler = {};
  try {
    hk.initDbHousekeeping(app);
    await bosalt();
    let r = await cagir('GET /api/admin/db-usage', 'Admin');
    assert.equal(r.body.state.status, 'idle', 'yarida kalmis kosu idle yuklenmeli');
    assert.deepEqual(r.body.state.alertsSent, {});
    assert.equal(r.body.state.logxBlobsCleared, 9);
    assert.equal(r.body.config.webhookConfigured, true);
    assert.ok(!JSON.stringify(r.body).includes('GIZLI'), 'webhook imzasi istemciye gitti');
    assert.equal('lastUsage' in r.body.state, false);
    assert.equal(teams.length, 0, 'uyari acilistan 20 sn once gitti');

    // 20 sn: ilk okuma; ORN_DATA %95 >= %90 -> Teams. Vekil 502 doner: gun isaretlenmez.
    t.mock.timers.tick(20_000);
    await bosalt();
    assert.equal(teams.length, 1);
    assert.equal(teams[0].url, env.DB_USAGE_ALERT_WEBHOOK_URL);
    assert.ok(k.warn.some((x) => /Teams webhook HTTP 502: vekil hata sayfasi/.test(x)));
    // 15 dk aralik: tekrar dener, bu kez basarili; gun isaretlenir ve kaydedilir.
    teamsKod = 200;
    t.mock.timers.tick(15 * 60e3 - 20_000);
    await bosalt();
    assert.equal(teams.length, 2);
    const kart = JSON.stringify(teams[1].govde);
    assert.match(kart, /ORN_DATA \(veri\)/);
    assert.ok(!kart.includes('ORN_LOG'), 'esik altindaki dosya karta girdi');
    const kayit = JSON.parse(B.yazim.at(-1).params[0]);
    assert.deepEqual(kayit.alertsSent, { ORN_DATA: '2026-11-24' });
    // Ayni gun ikinci kart yok.
    t.mock.timers.tick(15 * 60e3);
    await bosalt();
    assert.equal(teams.length, 2);

    // Temizlik: ayarli saatte (T0 + 60 dk) bir kez; ayni gun ikinci kez kosmaz.
    const temizlikSayisi = () => H.sorgular.filter((q) => /TOP \(@n\)/.test(q.metin)).length;
    const once = temizlikSayisi();
    t.mock.timers.tick(15 * 60e3); // T0 + 45 dk
    await bosalt();
    assert.equal(temizlikSayisi(), once, 'saatinden once kostu');
    t.mock.timers.tick(15 * 60e3); // T0 + 60 dk
    await bosalt();
    assert.equal(temizlikSayisi(), once + 5);
    t.mock.timers.tick(15 * 60e3); // T0 + 75 dk, ayni saat ayni gun
    await bosalt();
    assert.equal(temizlikSayisi(), once + 5, 'ayni gun ikinci kez kostu');

    // Doluluk okunamazsa zamanlayici durmaz, uyari yazar.
    H.hata = /sys\.database_files/;
    t.mock.timers.tick(15 * 60e3);
    await bosalt();
    assert.ok(k.warn.some((x) => /doluluk okunamadi/.test(x)));

    // Uclar
    assert.equal((await cagir('GET /api/admin/db-usage', 'User')).status, 403);
    assert.equal((await cagir('POST /api/admin/db-housekeeping/run', 'User')).status, 403);
    r = await cagir('GET /api/admin/db-usage', 'Admin');
    H.hata = null;
    assert.equal(r.status, 500);
    assert.equal(r.body.message, 'Veritabanı doluluk bilgisi okunamadı.');
    assert.ok(!JSON.stringify(r.body).includes('ham surucu'));

    let birak;
    H.pool = {
      request: () => ({
        input() {
          return this;
        },
        query: () =>
          new Promise((res) => {
            birak = () => res({ rowsAffected: [0] });
          }),
      }),
    };
    const bas = await cagir('POST /api/admin/db-housekeeping/run', 'Admin');
    assert.deepEqual(bas.body, { ok: true, started: true });
    assert.deepEqual(denetim, ['db_housekeeping_manual_run']);
    const tekrar = await cagir('POST /api/admin/db-housekeeping/run', 'Admin');
    assert.equal(tekrar.status, 409);
    for (let i = 0; i < 6; i++) {
      birak();
      await bosalt(3);
    }
  } finally {
    for (const ad of Object.keys(env)) delete process.env[ad];
  }
});
