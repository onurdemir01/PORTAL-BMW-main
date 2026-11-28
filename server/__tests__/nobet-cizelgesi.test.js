'use strict';
// NOBET CIZELGESI (server/duty-roster/index.cjs) — gercek express ve uclar; DB bellek ici bir
// duty_roster tablosu taklidi (db.query cagri aninda okunur, yerinde sahte). Eski JSON dosyasi
// (server/data/duty-roster.json, git disi) yalniz O YOL icin sahtelenir: gelistiricinin gercek
// dosyasi teste girmez. Modul durumu (bellek onbellegi) her testte taze yuklenir.
//   NB1 acilis: tablo bossa eski dosyadan gocer (gecersiz satirlar atlanir), sonra DB'den yukler;
//       satir eslemesi (DATE nesnesi, pasif kayit, varsayilanlar).
//   NB2 dosya yok ya da bozuksa 'duty-roster' blob'undan gocer; tablo doluysa goc yok.
//   NB3 DB yuklenemezse liste eski dosyadan (normalize); dosya bozuksa bos liste.
//   NB4 upsert: dogrulama hatasi 400; ayni gun + e-posta (harf duyarsiz) guncellenir, yoksa eklenir;
//       yanit guncel liste; DB hatasi 500.
//   NB5 toplu import: gecersizler atlanir; gecerli yoksa 400; DB hatasi 500.
//   NB6 silme kimlikle; DB hatasi 500.
//   NB7 gorunurluk kapisi ('Nobet') ve denetim ara katmani ('duty_roster') tum uclarda; ikisi de
//       yuklenemezse uclar yine calisir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');

const db = require('../db/index.cjs');
const gorunurluk = require('../auth/visibility.cjs');
const denetim = require('../audit/index.cjs');

const MODUL = require.resolve('../duty-roster/index.cjs');
const ESKI_DOSYA = path.join(__dirname, '..', 'data', 'duty-roster.json');

/** Bellek ici duty_roster + portal_config_blobs; desteklenen sorgular modulun kullandiklari. */
function sahteDb(t, { satirlar = [], blob, bozuk } = {}) {
  const tablo = satirlar.map((r) => ({ ...r }));
  const sorgular = [];
  t.mock.method(db, 'query', async (sql, p = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    sorgular.push(q);
    if (bozuk && bozuk.test(q)) throw new Error('DB yok');
    if (q === 'SELECT COUNT(*) AS n FROM duty_roster') return { rows: [{ n: tablo.length }] };
    if (q.startsWith('SELECT data FROM portal_config_blobs'))
      return { rows: blob === undefined ? [] : [{ data: blob }] };
    if (q === 'SELECT * FROM duty_roster ORDER BY duty_date, email')
      return {
        rows: [...tablo].sort(
          (a, b) =>
            String(a.duty_date).localeCompare(String(b.duty_date)) ||
            a.email.localeCompare(b.email),
        ),
      };
    if (q.startsWith('UPDATE duty_roster SET')) {
      const [ad, soyad, tel, gun, eposta] = p;
      const hedef = tablo.filter(
        (r) => r.duty_date === gun && r.email.toLowerCase() === eposta.toLowerCase(),
      );
      for (const r of hedef) Object.assign(r, { first_name: ad, last_name: soyad, phone: tel });
      return { rows: [], rowCount: hedef.length };
    }
    if (q.startsWith('INSERT INTO duty_roster')) {
      const [id, gun, ad, soyad, tel, eposta] = p;
      tablo.push({
        id,
        duty_date: gun,
        first_name: ad,
        last_name: soyad,
        phone: tel,
        email: eposta,
      });
      return { rows: [], rowCount: 1 };
    }
    if (q === 'DELETE FROM duty_roster WHERE id = $1') {
      const once = tablo.length;
      tablo.splice(0, tablo.length, ...tablo.filter((r) => r.id !== p[0]));
      return { rows: [], rowCount: once - tablo.length };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  });
  return { tablo, sorgular };
}

/** Eski JSON dosyasi: yalniz o yol sahte (undefined = yok). */
function eskiDosya(t, icerik) {
  const varMi = fs.existsSync;
  const oku = fs.readFileSync;
  t.mock.method(fs, 'existsSync', (p, ...a) =>
    p === ESKI_DOSYA ? icerik !== undefined : varMi.call(fs, p, ...a),
  );
  t.mock.method(fs, 'readFileSync', (p, ...a) =>
    p === ESKI_DOSYA ? icerik : oku.call(fs, p, ...a),
  );
}

async function kur(t, { gecir = true } = {}) {
  const log = t.mock.method(console, 'log', () => {});
  const uyari = t.mock.method(console, 'warn', () => {});
  const kapilar = { gorunurluk: [], denetim: [] };
  if (gecir) {
    t.mock.method(gorunurluk, 'requireVisiblePrefix', (anahtar) => {
      kapilar.gorunurluk.push(anahtar);
      return (req, _res, next) => next();
    });
    t.mock.method(denetim, 'auditMutations', (onek) => {
      kapilar.denetim.push(onek);
      return (req, _res, next) => next();
    });
  }
  delete require.cache[MODUL];
  const { initDutyRoster, readDutyRoster } = require(MODUL);
  const app = express();
  initDutyRoster(app);
  const s = app.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => new Promise((r) => s.close(r)));
  const iste = async (yol, { method = 'GET', govde } = {}) => {
    const r = await fetch(`http://127.0.0.1:${s.address().port}${yol}`, {
      method,
      headers: govde === undefined ? {} : { 'content-type': 'application/json' },
      body: govde === undefined ? undefined : JSON.stringify(govde),
    });
    return { status: r.status, govde: await r.json() };
  };
  return { iste, log, uyari, kapilar, readDutyRoster };
}

/** Acilis yuklemesi (beklenmeyen bir promise) bitene kadar bekler. */
async function yuklendi(s) {
  for (let i = 0; i < 200; i++) {
    const satirlar = [...s.log.mock.calls, ...s.uyari.mock.calls].map((c) =>
      String(c.arguments[0]),
    );
    if (satirlar.some((l) => /kayit DB'den yuklendi|DB yuklenemedi/.test(l))) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('acilis yuklemesi bitmedi');
}

const kayit = (o) => ({
  id: 'k1',
  date: '2026-12-01',
  firstName: 'Ali',
  lastName: 'Kaya',
  phone: '5550001122',
  email: 'ali@ornek.invalid',
  ...o,
});

test('NB1 acilista bos tablo eski dosyadan gocer, sonra DB yuklenir', async (t) => {
  eskiDosya(
    t,
    JSON.stringify([
      kayit({ firstName: '  Ali  ', date: '2026-12-01T09:00:00' }),
      kayit({ id: 'k2', email: 'gecersiz', date: '2026-12-02' }),
      kayit({ id: undefined, email: 'veli@ornek.invalid', date: '2026-12-02' }),
    ]),
  );
  const { tablo } = sahteDb(t);
  const s = await kur(t);
  await yuklendi(s);
  assert.equal(tablo.length, 2, 'gecersiz satir gocmus ya da gecerli satir atlanmis');
  assert.equal(tablo[0].first_name, 'Ali', 'ad kirpilmadi');
  assert.equal(tablo[0].duty_date, '2026-12-01', 'tarih 10 karaktere inmedi');
  assert.match(tablo[1].id, /^\d+-[0-9a-f]+$/, 'kimligi olmayan satira kimlik uretilmedi');
  const satirlar = s.log.mock.calls.map((c) => c.arguments[0]);
  assert.ok(satirlar.includes('[DB] migrated duty-roster (2 satir)'));
  assert.ok(satirlar.includes("[DutyRoster] 2 kayit DB'den yuklendi."));

  const r = await s.iste('/api/duty-roster');
  assert.equal(r.status, 200);
  assert.deepEqual(r.govde[0], {
    id: 'k1',
    date: '2026-12-01',
    firstName: 'Ali',
    lastName: 'Kaya',
    phone: '5550001122',
    email: 'ali@ornek.invalid',
    dutyGroup: null,
    team: null,
    service: null,
    isActive: true,
    dataSource: 'manual',
  });
});

test('NB1b satir eslemesi: DATE nesnesi, pasif kayit, bos alanlar', async (t) => {
  eskiDosya(t, undefined);
  sahteDb(t, {
    satirlar: [
      {
        id: 'a',
        duty_date: new Date('2026-12-05T00:00:00Z'),
        email: 'a@ornek.invalid',
        is_active: 0,
        duty_group: 'G1',
        team: 'Takim',
        service: 'Svc',
        data_source: 'excel',
      },
      { id: 'b', duty_date: '2026-12-06', email: 'b@ornek.invalid', is_active: false },
      { id: 'c', duty_date: null, email: 'c@ornek.invalid', is_active: true },
    ],
  });
  const s = await kur(t);
  await yuklendi(s);
  const liste = s.readDutyRoster();
  const a = liste.find((x) => x.id === 'a');
  assert.deepEqual(a, {
    id: 'a',
    date: '2026-12-05',
    firstName: '',
    lastName: '',
    phone: '',
    email: 'a@ornek.invalid',
    dutyGroup: 'G1',
    team: 'Takim',
    service: 'Svc',
    isActive: false,
    dataSource: 'excel',
  });
  assert.equal(liste.find((x) => x.id === 'b').isActive, false);
  assert.equal(liste.find((x) => x.id === 'c').isActive, true);
  assert.equal(liste.find((x) => x.id === 'c').date, '');
  liste.pop();
  assert.equal(s.readDutyRoster().length, 3, 'liste onbellegin kendisi olarak verildi');
});

test('NB2 dosya yok ya da bozuksa blobdan gocer; tablo doluysa goc yok', async (t) => {
  eskiDosya(t, '{bozuk');
  let { tablo } = sahteDb(t, { blob: JSON.stringify([kayit({})]) });
  let s = await kur(t);
  await yuklendi(s);
  assert.equal(tablo.length, 1, 'blob gocu olmadi');

  // Bos eski dosya blob gocunu engellemez.
  t.mock.restoreAll();
  eskiDosya(t, '[]');
  ({ tablo } = sahteDb(t, { blob: JSON.stringify([kayit({ id: 'blobdan' })]) }));
  s = await kur(t);
  await yuklendi(s);
  assert.deepEqual(
    tablo.map((r) => r.id),
    ['blobdan'],
    'bos eski dosya blob gocunu engelledi',
  );

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  ({ tablo } = sahteDb(t, { blob: '[]' }));
  s = await kur(t);
  await yuklendi(s);
  assert.equal(tablo.length, 0);
  assert.ok(!s.log.mock.calls.some((c) => /migrated/.test(c.arguments[0])), 'bos blob goc saydi');

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  ({ tablo } = sahteDb(t, { blob: 'bozuk-json' }));
  s = await kur(t);
  await yuklendi(s);
  assert.equal(tablo.length, 0);

  t.mock.restoreAll();
  eskiDosya(t, JSON.stringify([kayit({ id: 'yeni' })]));
  const dolu = sahteDb(t, {
    satirlar: [{ id: 'eski', duty_date: '2026-11-01', email: 'x@ornek.invalid' }],
  });
  s = await kur(t);
  await yuklendi(s);
  assert.deepEqual(
    dolu.tablo.map((r) => r.id),
    ['eski'],
    'dolu tabloya goc yapildi',
  );
  assert.ok(!dolu.sorgular.some((q) => q.startsWith('SELECT data FROM portal_config_blobs')));
});

test('NB2b goc satiri eklenemezse diger satirlar surer', async (t) => {
  eskiDosya(t, JSON.stringify([kayit({}), kayit({ id: 'k2', email: 'b@ornek.invalid' })]));
  const { tablo } = sahteDb(t);
  const asil = db.query;
  let ilk = true;
  t.mock.method(db, 'query', async (sql, p) => {
    if (ilk && sql.includes('INSERT INTO duty_roster')) {
      ilk = false;
      throw new Error('kilit');
    }
    return asil(sql, p);
  });
  const s = await kur(t);
  await yuklendi(s);
  assert.equal(tablo.length, 1);
  assert.ok(
    s.uyari.mock.calls.some(
      (c) =>
        c.arguments[0] === '[DutyRoster] import satiri eklenemedi (2026-12-01):' &&
        c.arguments[1] === 'kilit',
    ),
  );
  assert.ok(s.log.mock.calls.some((c) => c.arguments[0] === '[DB] migrated duty-roster (1 satir)'));
});

test('NB3 DB yuklenemezse liste eski dosyadan; bozuk dosya bos liste', async (t) => {
  eskiDosya(t, JSON.stringify([{ date: '2026-12-09T10:00', firstName: ' Ayse ', email: 'a@x.y' }]));
  sahteDb(t, { bozuk: /./ });
  let s = await kur(t);
  await yuklendi(s);
  assert.ok(
    s.uyari.mock.calls.some(
      (c) =>
        c.arguments[0] === '[DutyRoster] DB yuklenemedi, dosya fallback aktif:' &&
        c.arguments[1] === 'DB yok',
    ),
  );
  let r = await s.iste('/api/duty-roster');
  assert.equal(r.govde.length, 1);
  assert.equal(r.govde[0].date, '2026-12-09');
  assert.equal(r.govde[0].firstName, 'Ayse');
  assert.equal(r.govde[0].lastName, '');

  t.mock.restoreAll();
  eskiDosya(t, 'bozuk');
  sahteDb(t, { bozuk: /./ });
  s = await kur(t);
  await yuklendi(s);
  r = await s.iste('/api/duty-roster');
  assert.deepEqual(r.govde, []);

  t.mock.restoreAll();
  eskiDosya(t, '{"dizi":"degil"}');
  sahteDb(t, { bozuk: /./ });
  s = await kur(t);
  await yuklendi(s);
  r = await s.iste('/api/duty-roster');
  assert.deepEqual(r.govde, []);
});

test('NB4 upsert: dogrulama, guncelleme ya da ekleme, DB hatasi', async (t) => {
  eskiDosya(t, undefined);
  const { tablo } = sahteDb(t, {
    satirlar: [
      {
        id: 'v1',
        duty_date: '2026-12-01',
        first_name: 'Ali',
        last_name: 'Kaya',
        phone: '1',
        email: 'Ali@Ornek.invalid',
      },
    ],
  });
  const s = await kur(t);
  await yuklendi(s);

  let r = await s.iste('/api/duty-roster/upsert', {
    method: 'POST',
    govde: { date: '01.12.2026', email: 'x@y' },
  });
  assert.equal(r.status, 400);
  assert.deepEqual(r.govde, {
    ok: false,
    error: 'date invalid, firstName required, lastName required, phone required, email invalid',
  });
  r = await s.iste('/api/duty-roster/upsert', { method: 'POST', govde: {} });
  assert.equal(
    r.govde.error,
    'date invalid, firstName required, lastName required, phone required, email required',
  );

  r = await s.iste('/api/duty-roster/upsert', {
    method: 'POST',
    govde: kayit({ id: 'yeni', email: 'ali@ornek.INVALID', firstName: 'Ali Riza', phone: '2' }),
  });
  assert.equal(r.status, 200);
  assert.equal(tablo.length, 1, 'ayni gun + e-posta yeni satir acti');
  assert.equal(tablo[0].id, 'v1', 'mevcut satirin kimligi korunmadi');
  assert.equal(r.govde.items[0].firstName, 'Ali Riza');

  r = await s.iste('/api/duty-roster/upsert', {
    method: 'POST',
    govde: kayit({ id: 'k9', date: '2026-12-02' }),
  });
  assert.equal(r.govde.ok, true);
  assert.deepEqual(
    r.govde.items.map((x) => x.id),
    ['v1', 'k9'],
  );

  t.mock.restoreAll();
  sahteDb(t, { bozuk: /^UPDATE/ });
  r = await s.iste('/api/duty-roster/upsert', { method: 'POST', govde: kayit({}) });
  assert.equal(r.status, 500);
  assert.deepEqual(r.govde, { ok: false, error: 'Kaydedilemedi: DB yok' });
});

test('NB5 toplu import gecersizleri atlar; gecerli yoksa 400; DB hatasi 500', async (t) => {
  eskiDosya(t, undefined);
  const { tablo } = sahteDb(t);
  const s = await kur(t);
  await yuklendi(s);

  let r = await s.iste('/api/duty-roster/import', {
    method: 'POST',
    govde: {
      items: [kayit({}), kayit({ id: 'k2', phone: '' }), kayit({ id: 'k3', date: '2026-12-03' })],
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    tablo.map((x) => x.id),
    ['k1', 'k3'],
  );
  assert.equal(r.govde.items.length, 2);

  for (const govde of [
    { items: [kayit({ email: '' })] },
    { items: 'dizi degil' },
    { items: { 0: kayit({}) } },
    {},
  ]) {
    r = await s.iste('/api/duty-roster/import', { method: 'POST', govde });
    assert.equal(r.status, 400, JSON.stringify(govde));
    assert.deepEqual(r.govde, { ok: false, error: 'No valid rows' });
  }

  t.mock.restoreAll();
  sahteDb(t, { bozuk: /^SELECT \* FROM duty_roster/ });
  r = await s.iste('/api/duty-roster/import', { method: 'POST', govde: { items: [kayit({})] } });
  assert.equal(r.status, 500);
  assert.deepEqual(r.govde, { ok: false, error: 'Import kaydedilemedi: DB yok' });
});

test('NB6 silme kimlikle; DB hatasi 500', async (t) => {
  eskiDosya(t, undefined);
  const { tablo } = sahteDb(t, {
    satirlar: [
      { id: 'a', duty_date: '2026-12-01', email: 'a@ornek.invalid' },
      { id: 'b', duty_date: '2026-12-02', email: 'b@ornek.invalid' },
    ],
  });
  const s = await kur(t);
  await yuklendi(s);
  let r = await s.iste('/api/duty-roster/a', { method: 'DELETE' });
  assert.deepEqual(r.govde, { ok: true, items: [s.readDutyRoster()[0]] });
  assert.deepEqual(
    tablo.map((x) => x.id),
    ['b'],
  );

  t.mock.restoreAll();
  sahteDb(t, { bozuk: /^DELETE/ });
  r = await s.iste('/api/duty-roster/b', { method: 'DELETE' });
  assert.equal(r.status, 500);
  assert.deepEqual(r.govde, { ok: false, error: 'Silinemedi: DB yok' });
});

test('NB7 gorunurluk kapisi ve denetim ara katmani; yuklenemezlerse uclar calisir', async (t) => {
  eskiDosya(t, undefined);
  sahteDb(t);
  const s = await kur(t);
  await yuklendi(s);
  assert.deepEqual(s.kapilar, { gorunurluk: ['Nöbet'], denetim: ['duty_roster'] });

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  sahteDb(t);
  t.mock.method(
    gorunurluk,
    'requireVisiblePrefix',
    () => (_req, res) => res.status(403).json({ ok: false, error: 'gizli' }),
  );
  t.mock.method(denetim, 'auditMutations', () => (_req, _res, next) => next());
  const kapali = await kur(t, { gecir: false });
  await yuklendi(kapali);
  for (const [yol, method] of [
    ['/api/duty-roster', 'GET'],
    ['/api/duty-roster/upsert', 'POST'],
    ['/api/duty-roster/x', 'DELETE'],
  ]) {
    const r = await kapali.iste(yol, { method, govde: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${method} ${yol} kapidan gecti`);
  }

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  sahteDb(t);
  t.mock.method(gorunurluk, 'requireVisiblePrefix', () => {
    throw new Error('motor yok');
  });
  t.mock.method(denetim, 'auditMutations', () => {
    throw new Error('denetim yok');
  });
  const motorsuz = await kur(t, { gecir: false });
  await yuklendi(motorsuz);
  const r = await motorsuz.iste('/api/duty-roster');
  assert.equal(r.status, 200);
});
