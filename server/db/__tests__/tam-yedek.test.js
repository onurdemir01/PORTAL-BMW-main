// server/db/__tests__/tam-yedek.test.js - gunluk tam DB yedegi (full-backup.cjs) davranisi:
// tablo basina CSV (bicim, sir kolonu maskesi), basarisiz tablo, DB yok / genel hata, ayni anda
// ikinci calisma, saklama suresi temizligi, ayarlar, Admin uclari ve zamanlayici.
//
// Gercek MSSQL yok: havuz (getPool) ve node-mssql'in akis Request'i sahte; dosyalar gecici dizine
// gercekten yazilir. full-backup.cjs getPool'u yuklenirken yapi bozumuyla aldigi icin sahte
// YUKLEMEDEN ONCE kurulur; modulun durumu (state, zamanlayici) her testte taze yuklenir.
// Kaynak metni bekcileri full-backup-secrets.test.js'te.
'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const mssql = require('../portal-mssql.cjs');
const db = require('../index.cjs');
const audit = require('../../audit/index.cjs');

const sorgular = [];
/** @type {{ tablolar: any[], veriler: Record<string, any>, kesifHata: any }} */
const sahte = { tablolar: [], veriler: {}, kesifHata: null };

class SahteIstek extends EventEmitter {
  constructor() {
    super();
    this.stream = false;
  }

  query(q) {
    sorgular.push({ q, stream: this.stream });
    const tablo = /^SELECT \* FROM \[[^\]]+\]\.\[([^\]]+)\]$/.exec(q)[1];
    const v = sahte.veriler[tablo];
    setImmediate(() => {
      if (v.hemenHata) return this.emit('error', v.hemenHata);
      this.emit('recordset', Object.fromEntries(v.kolonlar.map((k) => [k, {}])));
      for (const r of v.satirlar) this.emit('row', r);
      if (v.hata) this.emit('error', v.hata);
      else this.emit('done');
    });
  }
}

const havuz = {
  request: () => ({
    query: async (q) => {
      sorgular.push({ q });
      if (sahte.kesifHata) throw sahte.kesifHata;
      return { recordset: sahte.tablolar };
    },
  }),
};
const havuzAl = mock.method(mssql, 'getPool', async () => havuz);
const asilRequest = mssql.sql.Request;
mssql.sql.Request = SahteIstek;

const yol = require.resolve('../full-backup.cjs');
function yukle() {
  delete require.cache[yol];
  return require('../full-backup.cjs');
}

/** Her test: gecici dizin, temiz sahte, DB yazimi kaydedilir. */
function hazirla(t, { tablolar = [], veriler = {}, dbSatir = [], rowCount = 1 } = {}) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-tam-yedek-'));
  const eskiDizin = process.env.DB_FULL_BACKUP_DIR;
  process.env.DB_FULL_BACKUP_DIR = dizin;
  t.after(() => {
    if (eskiDizin === undefined) delete process.env.DB_FULL_BACKUP_DIR;
    else process.env.DB_FULL_BACKUP_DIR = eskiDizin;
    fs.rmSync(dizin, { recursive: true, force: true });
  });
  sorgular.length = 0;
  sahte.tablolar = tablolar;
  sahte.veriler = veriler;
  sahte.kesifHata = null;
  havuzAl.mock.resetCalls();
  havuzAl.mock.mockImplementation(async () => havuz);
  const dbq = t.mock.method(db, 'query', async (q) =>
    q.startsWith('SELECT') ? { rows: dbSatir } : { rowCount },
  );
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  return { dizin, dbq };
}

const T = (ad) => ({ TABLE_SCHEMA: 'dbo', TABLE_NAME: ad });

test('DY1 her tablo ayri CSV: ~ ayirici, kacis, tarih ISO, sir kolonu maskeli (NULL degil), durum ve kayit', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 27, 2, 5, 9).getTime() });
  const { dizin, dbq } = hazirla(t, {
    tablolar: [T('kullanicilar'), T('bos')],
    veriler: {
      kullanicilar: {
        kolonlar: ['id', 'ad', 'api_token', 'olusma'],
        satirlar: [
          { id: 1, ad: 'a~b', api_token: 'gizli', olusma: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
          { id: 2, ad: 'tirnak "x"\nyeni', api_token: null, olusma: null },
          { id: 3, ad: 'duz', api_token: undefined, olusma: 'r\rs' },
        ],
      },
      bos: { kolonlar: ['k'], satirlar: [] },
    },
    rowCount: 0,
  });
  const fb = yukle();
  const s = await fb.runBackup();

  const ts = '20261127-02.05.09';
  assert.deepEqual(fs.readdirSync(dizin).sort(), [`bos.${ts}.csv`, `kullanicilar.${ts}.csv`]);
  assert.equal(
    fs.readFileSync(path.join(dizin, `kullanicilar.${ts}.csv`), 'utf8'),
    'id~ad~api_token~olusma\n' +
      '1~"a~b"~***maskelendi***~2026-01-02T03:04:05.000Z\n' +
      '2~"tirnak ""x""\nyeni"~~\n' +
      '3~duz~~"r\rs"\n',
  );
  assert.equal(fs.readFileSync(path.join(dizin, `bos.${ts}.csv`), 'utf8'), 'k\n');
  assert.deepEqual(
    sorgular.filter((x) => x.stream !== undefined),
    [
      { q: 'SELECT * FROM [dbo].[kullanicilar]', stream: true },
      { q: 'SELECT * FROM [dbo].[bos]', stream: true },
    ],
  );
  assert.match(sorgular[0].q, /INFORMATION_SCHEMA\.TABLES WHERE TABLE_TYPE = 'BASE TABLE'/);
  assert.equal(s.status, 'done');
  assert.equal(s.tableCount, 2);
  assert.equal(s.doneCount, 2);
  assert.equal(s.totalRows, 3);
  assert.deepEqual(s.failedTables, []);
  assert.equal(s.currentTable, null);
  assert.equal(s.lastError, null);
  assert.equal(s.startedAt, new Date(2026, 10, 27, 2, 5, 9).toISOString());
  assert.equal(s.finishedAt, s.startedAt);

  // Son calisma DB'ye yazilir: once UPDATE, satir yoksa INSERT.
  const [upd, ins] = dbq.mock.calls.map((c) => c.arguments);
  assert.match(upd[0], /^UPDATE portal_config_blobs SET data = \$1/);
  assert.equal(upd[1][1], 'db_full_backup:last_run');
  assert.equal(JSON.parse(upd[1][0]).status, 'done');
  assert.match(ins[0], /^INSERT INTO portal_config_blobs/);
  assert.deepEqual(ins[1], ['db_full_backup:last_run', upd[1][0]]);
});

test('DY2 yedeklenemeyen tablo: digerleri surer, durum error ve tablolar adiyla', async (t) => {
  const { dizin, dbq } = hazirla(t, {
    tablolar: [T('a'), T('b'), T('c')],
    veriler: {
      a: { kolonlar: ['x'], satirlar: [{ x: 1 }] },
      b: { kolonlar: ['x'], satirlar: [{ x: 1 }], hata: new Error('baglanti koptu') },
      c: { hemenHata: new Error('izin yok') },
    },
  });
  const s = await yukle().runBackup();
  assert.equal(s.status, 'error');
  assert.deepEqual(s.failedTables, ['b', 'c']);
  assert.equal(s.lastError, '2 tablo yedeklenemedi: b, c');
  assert.equal(s.doneCount, 3);
  assert.equal(s.totalRows, 1);
  assert.equal(fs.readdirSync(dizin).filter((f) => f.startsWith('a.')).length, 1);
  // UPDATE satiri buldu: INSERT yok.
  assert.equal(dbq.mock.callCount(), 1);
});

test('DY3 DB baglantisi yoksa ya da tablo kesfi duserse: error, sebep, durum kaydedilir', async (t) => {
  const { dbq } = hazirla(t);
  havuzAl.mock.mockImplementation(async () => null);
  let s = await yukle().runBackup();
  assert.equal(s.status, 'error');
  assert.equal(s.lastError, 'Portal DB bağlantısı yok.');
  assert.equal(JSON.parse(dbq.mock.calls[0].arguments[1][0]).status, 'error');

  // Havuz istisna atarsa durum 'running'de takili kalmaz; ayni sebep yazilir.
  havuzAl.mock.mockImplementation(async () => {
    throw new Error('ECONNREFUSED');
  });
  const fb = yukle();
  s = await fb.runBackup();
  assert.equal(s.status, 'error');
  assert.equal(s.lastError, 'Portal DB bağlantısı yok.');
  havuzAl.mock.mockImplementation(async () => havuz);
  assert.equal((await fb.runBackup()).status, 'done', 'sonraki calisma baslayabilir');

  sahte.kesifHata = new Error('INFORMATION_SCHEMA okunamadi');
  s = await yukle().runBackup();
  assert.equal(s.status, 'error');
  assert.equal(s.lastError, 'INFORMATION_SCHEMA okunamadi');
  assert.equal(s.currentTable, null);
  assert.ok(s.finishedAt);
});

test('DY4 calisirken ikinci calisma baslamaz: ayni an iki istek tek yedek alir', async (t) => {
  hazirla(t, { tablolar: [T('a')], veriler: { a: { kolonlar: ['x'], satirlar: [{ x: 1 }] } } });
  const fb = yukle();
  const ilk = fb.runBackup();
  const ikinci = fb.runBackup();
  const [s1, s2] = await Promise.all([ilk, ikinci]);
  assert.equal(havuzAl.mock.callCount(), 1, 'ikinci cagri havuz istemeden donmeli');
  assert.equal(sorgular.filter((x) => x.stream).length, 1, 'tablo bir kez yedeklenir');
  assert.equal(s1.status, 'done');
  assert.equal(s2, s1);
});

test('DY5 saklama suresi: suresi gecen DOSYALAR silinir, tazeler ve dizinler kalir', async (t) => {
  const { dizin } = hazirla(t);
  const eski = process.env.DB_FULL_BACKUP_RETENTION_DAYS;
  process.env.DB_FULL_BACKUP_RETENTION_DAYS = '2';
  t.after(() => {
    if (eski === undefined) delete process.env.DB_FULL_BACKUP_RETENTION_DAYS;
    else process.env.DB_FULL_BACKUP_RETENTION_DAYS = eski;
  });
  const gun = 86_400_000;
  const kur = (ad, yasGun) => {
    const p = path.join(dizin, ad);
    fs.writeFileSync(p, 'x');
    const z = new Date(Date.now() - yasGun * gun);
    fs.utimesSync(p, z, z);
  };
  kur('eski1.csv', 3);
  kur('eski2.csv', 2.1);
  kur('taze.csv', 1.9);
  fs.mkdirSync(path.join(dizin, 'altdizin'));
  const z = new Date(Date.now() - 10 * gun);
  fs.utimesSync(path.join(dizin, 'altdizin'), z, z);
  const s = await yukle().runBackup();
  assert.equal(s.removedFiles, 2);
  assert.deepEqual(fs.readdirSync(dizin).sort(), ['altdizin', 'taze.csv']);
});

test('DY6 ayarlar: dizin varsayilani, sinirlar kelepcelenir, bos ve gecersiz deger varsayilana duser', (t) => {
  const anahtarlar = [
    'DB_FULL_BACKUP_DIR',
    'DB_FULL_BACKUP_RETENTION_DAYS',
    'DB_FULL_BACKUP_HOUR',
    'DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES',
  ];
  const eski = Object.fromEntries(anahtarlar.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(eski)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const { getConfig } = yukle();
  for (const k of anahtarlar) delete process.env[k];
  assert.deepEqual(getConfig(), {
    dir: '/sw/WAS_IMAGES/Ansible/Middleware_Inventory/backup/daily_full',
    retentionDays: 14,
    hour: 2,
    checkIntervalMinutes: 15,
  });
  Object.assign(process.env, {
    DB_FULL_BACKUP_DIR: '/tmp/y',
    DB_FULL_BACKUP_RETENTION_DAYS: '99999',
    DB_FULL_BACKUP_HOUR: '-4',
    DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES: '7.9',
  });
  assert.deepEqual(getConfig(), {
    dir: '/tmp/y',
    retentionDays: 3650,
    hour: 0,
    checkIntervalMinutes: 7,
  });
  Object.assign(process.env, {
    DB_FULL_BACKUP_RETENTION_DAYS: ' ',
    DB_FULL_BACKUP_HOUR: '99',
    DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES: 'abc',
  });
  assert.deepEqual(getConfig(), {
    dir: '/tmp/y',
    retentionDays: 14,
    hour: 23,
    checkIntervalMinutes: 15,
  });
  // Tik araligi en cok 60 dk: daha uzun aralik saatlik pencereyi kacirir, yedek hic alinmaz.
  process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES = '90';
  assert.equal(getConfig().checkIntervalMinutes, 60);
});

/** Express yerine: kaydedilen uclar ve yanitlari. */
function sahteApp() {
  const uclar = {};
  const app = {
    get: (p, h) => (uclar[`GET ${p}`] = h),
    post: (p, h) => (uclar[`POST ${p}`] = h),
  };
  const cagir = (ad, rol) => {
    const r = { kod: 200, govde: null };
    const res = {
      status(k) {
        r.kod = k;
        return res;
      },
      json(g) {
        r.govde = g;
        return res;
      },
    };
    uclar[ad]({ session: rol ? { user: { role: rol } } : {} }, res);
    return r;
  };
  return { app, cagir };
}

const bekle = () => new Promise((r) => setImmediate(r));

test('DY7 Admin uclari: durum ve elle calistirma yalniz Admin; calisirken 409; denetim kaydi', async (t) => {
  hazirla(t, { tablolar: [T('a')], veriler: { a: { kolonlar: ['x'], satirlar: [] } } });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const kayit = t.mock.method(audit, 'auditPortal', () => {});
  const fb = yukle();
  const { app, cagir } = sahteApp();
  fb.initDbFullBackup(app);
  await bekle();

  for (const ad of ['GET /api/admin/db-full-backup/status', 'POST /api/admin/db-full-backup/run']) {
    for (const rol of [undefined, 'User']) {
      const r = cagir(ad, rol);
      assert.equal(r.kod, 403, `${ad} ${rol}`);
      assert.deepEqual(r.govde, { ok: false });
    }
  }
  let r = cagir('GET /api/admin/db-full-backup/status', 'Admin');
  assert.equal(r.govde.ok, true);
  assert.equal(r.govde.state.status, 'idle');
  assert.equal(r.govde.config.hour, fb.getConfig().hour);

  r = cagir('POST /api/admin/db-full-backup/run', 'Admin');
  assert.deepEqual(r.govde, { ok: true, started: true });
  assert.equal(kayit.mock.calls[0].arguments[1], 'db_full_backup_manual_run');
  r = cagir('POST /api/admin/db-full-backup/run', 'Admin');
  assert.equal(r.kod, 409);
  assert.deepEqual(r.govde, { ok: false, message: 'Zaten çalışıyor.' });
  while (cagir('GET /api/admin/db-full-backup/status', 'Admin').govde.state.status === 'running')
    await bekle();
  assert.equal(havuzAl.mock.callCount(), 1);

  // Denetim kaydi yazilamasa da calistirma baslar.
  kayit.mock.mockImplementation(() => {
    throw new Error('denetim yok');
  });
  r = cagir('POST /api/admin/db-full-backup/run', 'Admin');
  assert.deepEqual(r.govde, { ok: true, started: true });
  while (cagir('GET /api/admin/db-full-backup/status', 'Admin').govde.state.status === 'running')
    await bekle();
});

test('DY8 zamanlayici: ayarli saatte gunde bir kez; baska saatte yok; yeniden baslatmada bugunku calisma sayilir', async (t) => {
  const saat2 = new Date(2026, 10, 27, 2, 0, 0).getTime();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: saat2 });
  const eski = process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES;
  process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES = '10';
  t.after(() => {
    if (eski === undefined) delete process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES;
    else process.env.DB_FULL_BACKUP_CHECK_INTERVAL_MINUTES = eski;
  });
  hazirla(t, { tablolar: [] });
  let { app, cagir } = sahteApp();
  yukle().initDbFullBackup(app);
  await bekle();
  /** Yedek calisiyorsa bitene kadar bekler (gercek dosya islemleri olay dongusunde). */
  const bitene = async () => {
    for (let i = 0; i < 1000; i++) {
      await bekle();
      if (cagir('GET /api/admin/db-full-backup/status', 'Admin').govde.state.status !== 'running')
        return;
    }
    throw new Error('yedek bitmedi');
  };
  /** Saati 10 dakikalik tiklerle ilerletir; her tikten sonra baslayan yedek biter. */
  const ilerle = async (dk) => {
    for (let k = 0; k < dk / 10; k++) {
      t.mock.timers.tick(10 * 60_000);
      await bitene();
    }
  };

  t.mock.timers.tick(10 * 60_000 - 1);
  await bitene();
  assert.equal(havuzAl.mock.callCount(), 0, 'aralik dolmadan tik yok');
  t.mock.timers.tick(1);
  await bitene();
  assert.equal(havuzAl.mock.callCount(), 1, '02:10 tikinde calisir');
  await ilerle(40);
  assert.equal(havuzAl.mock.callCount(), 1, 'ayni gun (02:20-02:50) ikinci kez calismaz');
  await ilerle(20); // 03:10: saat penceresi disi
  assert.equal(havuzAl.mock.callCount(), 1);
  await ilerle(23 * 60); // ertesi gun 02:00 ve 02:10
  assert.equal(havuzAl.mock.callCount(), 2, 'ertesi gun bir kez calisir');

  // Yeniden baslatma: DB'deki son calisma bugun bittiyse ayni gun tekrar calismaz.
  const bugun = new Date(Date.now()).toISOString();
  hazirla(t, { dbSatir: [{ data: JSON.stringify({ status: 'done', finishedAt: bugun }) }] });
  ({ app, cagir } = sahteApp());
  yukle().initDbFullBackup(app);
  await bekle();
  assert.equal(
    cagir('GET /api/admin/db-full-backup/status', 'Admin').govde.state.finishedAt,
    bugun,
  );
  await ilerle(30);
  assert.equal(havuzAl.mock.callCount(), 0);
});

test.after(() => {
  mssql.sql.Request = asilRequest;
});
