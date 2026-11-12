// server/bmw-hub/__tests__/bmw-hub.test.cjs - BN1..BN9 (2026-11-08).
//
// Kullanici: "sadece adminlerin goruntuleyebilecegi bir sayfa olsun; talebi acan kisinin ismi de
// gozuksun." Kilitler: Admin disi hicbir uca ulasamaz; acan / yazan kisi ISTEMCIDEN degil
// oturumdan gelir; toplu ekleme ya hepsi ya hicbiri; durum degisimi gecmise yazilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

const K = require('../../../shared/bmwHub.cjs');

// ── Sahte modul yardimcisi ─────────────────────────────────────────────────────
function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

// Bellek ici "veritabani": bmw-hub'in kullandigi SQL kaliplarini taniyan kucuk bir sahte.
const DB = { isler: new Map(), notlar: [], sorgular: [], dusur: null };
const simdi = () => new Date('2026-11-08T09:00:00Z');
async function sahteQuery(sql, params = []) {
  DB.sorgular.push(sql);
  if (DB.dusur && DB.dusur(sql)) throw new Error('sahte db hatasi');
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('INSERT INTO bmw_hub_isler')) {
    const [id, baslik, aciklama, durum, oncelik, kategori, sahip, beklenen, son, ak, aa, ga] = params;
    DB.isler.set(id, {
      id, baslik, aciklama, durum, oncelik, kategori, sahip, beklenen,
      son_tarih: son ? new Date(`${son}T00:00:00Z`) : null,
      acan_kullanici: ak, acan_ad: aa, guncelleyen_ad: ga,
      olusturma: simdi(), guncelleme: simdi(), kapanis: s.includes('GETUTCDATE())') ? simdi() : null,
    });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('INSERT INTO bmw_hub_notlar')) {
    const [is_id, tur, metin, yk, ya] = params;
    DB.notlar.push({ id: DB.notlar.length + 1, is_id, tur, metin, yazan_kullanici: yk, yazan_ad: ya, olusturma: simdi() });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('SELECT * FROM bmw_hub_isler WHERE id')) {
    const r = DB.isler.get(params[0]);
    return { rows: r ? [{ ...r }] : [] };
  }
  if (s.includes('FROM bmw_hub_isler ORDER BY')) return { rows: [...DB.isler.values()].map((r) => ({ ...r })) };
  if (s.startsWith('SELECT * FROM bmw_hub_notlar')) return { rows: DB.notlar.filter((n) => n.is_id === params[0]) };
  if (s.startsWith('UPDATE bmw_hub_isler SET')) {
    const id = params[params.length - 1];
    const r = DB.isler.get(id);
    if (!r) return { rows: [], rowCount: 0 };
    const set = s.slice('UPDATE bmw_hub_isler SET '.length, s.lastIndexOf(' WHERE '));
    for (const parca of set.split(', ')) {
      const m = parca.match(/^(\w+) = (.+)$/);
      if (!m) continue;
      const [, kol, ifade] = m;
      if (ifade === 'GETUTCDATE()') r[kol] = new Date('2026-11-08T10:00:00Z');
      else if (ifade === 'NULL') r[kol] = null;
      else {
        const v = params[Number(ifade.slice(1)) - 1];
        r[kol] = kol === 'son_tarih' && v ? new Date(`${v}T00:00:00Z`) : v;
      }
    }
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('DELETE FROM bmw_hub_notlar')) {
    DB.notlar = DB.notlar.filter((n) => n.is_id !== params[0]);
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('DELETE FROM bmw_hub_isler')) {
    DB.isler.delete(params[0]);
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`taninmayan sorgu: ${s}`);
}

sahte(require.resolve('../../db/index.cjs'), { query: sahteQuery });
sahte(require.resolve('../../auth/index.cjs'), {
  getRequestUser: (req) => (req.session && req.session.user) || null,
  requireAdmin: (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false, error: 'oturum yok' });
    if (u.role !== 'Admin') return res.status(403).json({ ok: false, error: 'admin gerekli' });
    next();
  },
});
sahte(require.resolve('../../auth/visibility.cjs'), { requireVisiblePrefix: () => (_q, _s, n) => n() });
sahte(require.resolve('../../audit/index.cjs'), { auditMutations: () => (_q, _s, n) => n() });

const { createRouter } = require('../index.cjs');

let kimlik = { username: 'Onur', displayName: 'Onur Demir', role: 'Admin' };
function uygulama() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = kimlik ? { user: kimlik } : {};
    next();
  });
  app.use('/api/bmw-hub', createRouter());
  return app;
}

async function istek(method, yol, body) {
  const srv = uygulama().listen(0);
  try {
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/bmw-hub${yol}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

function sifirla() {
  DB.isler.clear();
  DB.notlar = [];
  DB.sorgular = [];
  DB.dusur = null;
  kimlik = { username: 'Onur', displayName: 'Onur Demir', role: 'Admin' };
}

test('BN1 tarih: iki bicim kabul, gecersiz gun reddedilir (sessizce tarihsiz kaydedilmez)', () => {
  assert.equal(K.tarihCoz('2026-11-20'), '2026-11-20');
  assert.equal(K.tarihCoz('20.11.2026'), '2026-11-20');
  assert.equal(K.tarihCoz('5/1/2027'), '2027-01-05');
  assert.equal(K.tarihCoz(''), '');
  assert.equal(K.tarihCoz('31.02.2026'), null);
  assert.equal(K.tarihCoz('yarin'), null);
  const { hatalar } = K.isDogrula({ baslik: 'x', sonTarih: '31.02.2026' });
  assert.ok(hatalar.some((h) => h.includes('Son tarih')), 'gecersiz tarih hata vermedi');
});

test('BN2 toplu ayristirici: alanlar, bos ara alan, yorum ve madde isareti, hatali satir', () => {
  const r = K.topluAyristir(
    [
      '# yorum',
      '',
      '- Birinci | Ali Veli | 20.11.2026 | yüksek | devam | DBA onayı | uzun | açıklama',
      '2. İkinci || 2026-12-01',
      'Üçüncü | | | acil-degil',
      ' | sahip var baslik yok',
    ].join('\n'),
  );
  assert.equal(r.length, 4);
  assert.deepEqual(
    { ...r[0].deger },
    { baslik: 'Birinci', aciklama: 'uzun | açıklama', durum: 'devam', oncelik: 'yuksek', sahip: 'Ali Veli', beklenen: 'DBA onayı', kategori: 'Otomasyon', sonTarih: '2026-11-20' },
  );
  assert.equal(r[0].satir, 3);
  assert.equal(r[1].deger.baslik, 'İkinci');
  assert.equal(r[1].deger.sahip, '');
  assert.equal(r[1].deger.sonTarih, '2026-12-01');
  assert.equal(r[1].hatalar.length, 0);
  assert.ok(r[2].hatalar.some((h) => h.includes('öncelik')), 'taninmayan oncelik gecti');
  assert.ok(r[3].hatalar.some((h) => h.includes('Başlık')), 'basliksiz satir gecti');
});

test('BN3 Admin disi kullanici hicbir uca ulasamaz (okuma dahil); oturumsuz 401', async () => {
  sifirla();
  kimlik = { username: 'ayse', displayName: 'Ayşe', role: 'User' };
  for (const [m, y, b] of [['GET', '/isler'], ['POST', '/isler', { baslik: 'x' }], ['POST', '/toplu', { metin: 'x' }], ['PATCH', '/isler/a', { durum: 'tamam' }], ['DELETE', '/isler/a']]) {
    const r = await istek(m, y, b);
    // nginx-red cevirici 403'u 409'a cevirir; asil kod upstreamStatus'ta
    assert.equal(r.status, 409, `${m} ${y} admin disina acik: ${r.status}`);
    assert.equal(r.body.upstreamStatus, 403);
  }
  assert.equal(DB.isler.size, 0);
  kimlik = null;
  assert.equal((await istek('GET', '/isler')).status, 401);
});

test('BN4 acan kisi oturumdan gelir; istemcinin gonderdigi acan alanlari yok sayilir', async () => {
  sifirla();
  const r = await istek('POST', '/isler', { baslik: 'Prod onayi', acanAd: 'Sahte Kisi', acanKullanici: 'sahte', sahip: 'Mehmet', sonTarih: '20.11.2026' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.is.acanAd, 'Onur Demir');
  assert.equal(r.body.is.acanKullanici, 'onur', 'kullanici adi kucuk harfe cevrilmedi');
  assert.equal(r.body.is.sonTarih, '2026-11-20');
  assert.equal(r.body.is.durum, 'acik');
  assert.equal(DB.notlar.length, 1);
  assert.equal(DB.notlar[0].tur, 'olusturma');
  assert.equal(DB.notlar[0].yazan_ad, 'Onur Demir');
});

test('BN5 dogrulama: bos baslik, taninmayan durum, uzun baslik kaydedilmez', async () => {
  sifirla();
  assert.equal((await istek('POST', '/isler', { baslik: '  ' })).status, 400);
  assert.equal((await istek('POST', '/isler', { baslik: 'x', durum: 'bitti-mi' })).status, 400);
  assert.equal((await istek('POST', '/isler', { baslik: 'x'.repeat(K.SINIR.baslik + 1) })).status, 400);
  assert.equal(DB.isler.size, 0);
});

test('BN6 toplu: hatali satir varsa HICBIRI eklenmez; temizse hepsi eklenir', async () => {
  sifirla();
  const kotu = await istek('POST', '/toplu', { metin: 'Bir | | 2026-11-20\nIki | | 32.13.2026' });
  assert.equal(kotu.status, 400);
  assert.equal(kotu.body.satirlar[0].satir, 2);
  assert.equal(DB.isler.size, 0, 'hatali toplu eklemede kayit yazildi');
  const iyi = await istek('POST', '/toplu', { metin: 'Bir | Ali | 2026-11-20\nIki' });
  assert.equal(iyi.status, 200);
  assert.equal(iyi.body.eklenen, 2);
  assert.equal(DB.isler.size, 2);
});

test('BN7 toplu: DB yarida duserse eklenenler geri alinir (ya hepsi ya hicbiri)', async () => {
  sifirla();
  let n = 0;
  DB.dusur = (sql) => sql.includes('INSERT INTO bmw_hub_isler') && ++n === 3;
  const r = await istek('POST', '/toplu', { metin: 'A\nB\nC\nD' });
  assert.equal(r.status, 500);
  assert.equal(DB.isler.size, 0, 'yarim kalan toplu ekleme geri alinmadi');
  assert.equal(DB.notlar.length, 0);
});

test('BN8 durum degisimi gecmise yazilir, kapanis tamamlaninca dolar, yeniden acilinca bosalir', async () => {
  sifirla();
  const { body } = await istek('POST', '/isler', { baslik: 'Is' });
  const id = body.is.id;
  kimlik = { username: 'mehmet', displayName: 'Mehmet K', role: 'Admin' };
  const t = await istek('PATCH', `/isler/${id}`, { durum: 'tamam', sahip: 'Mehmet K' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.ok(t.body.is.kapanis, 'tamamlanan isin kapanisi yok');
  assert.equal(t.body.is.guncelleyenAd, 'Mehmet K');
  const turler = DB.notlar.map((x) => x.tur);
  assert.ok(turler.includes('durum') && turler.includes('sahip'), `gecmis eksik: ${turler}`);
  const d = DB.notlar.find((x) => x.tur === 'durum');
  assert.match(d.metin, /Açık → Tamamlandı/);
  assert.equal(d.yazan_ad, 'Mehmet K');
  const g = await istek('PATCH', `/isler/${id}`, { durum: 'devam' });
  assert.equal(g.body.is.kapanis, null, 'yeniden acilan isin kapanisi kaldi');
  assert.equal((await istek('PATCH', `/isler/${id}`, {})).status, 400);
});

test('BN9 cakisma: eski damga ile kayit 409 + bmw_cakisma; liste ozeti gecikmeyi sayar', async () => {
  sifirla();
  const { body } = await istek('POST', '/isler', { baslik: 'Is', sonTarih: '2020-01-01' });
  const id = body.is.id;
  const r = await istek('PATCH', `/isler/${id}`, { baslik: 'Yeni', beklenenGuncelleme: '2000-01-01T00:00:00.000Z' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'bmw_cakisma');
  assert.equal(DB.isler.get(id).baslik, 'Is', 'cakismada kayit ezildi');
  const ok = await istek('PATCH', `/isler/${id}`, { baslik: 'Yeni', beklenenGuncelleme: body.is.guncelleme });
  assert.equal(ok.status, 200);
  const l = await istek('GET', '/isler');
  assert.equal(l.body.ozet.acik, 1);
  assert.equal(l.body.ozet.gecikmis, 1);
  assert.equal(l.body.ozet.sahipsiz, 1);
  assert.equal(K.gecikmisMi({ durum: 'tamam', sonTarih: '2020-01-01' }, '2026-11-08'), false, 'tamamlanan is gecikmis sayildi');
});
