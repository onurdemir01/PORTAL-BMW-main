// server/oco/__tests__/oco-manuel.test.js - OCO Takvimi: elle eklenen olaylar (2026-11-17).
//
// Kullanici: "OCO Takvimi'ne manuel ekleme olayi da ekler misin?"
//
// OM1 dogrulama: baslik/baslangic zorunlu, OCO no yalniz rakam, bitis >= baslangic, en cok 31 gun,
//     yil payi, uzunluk sinirlari; bosluklar kirpilir, bos alan null olur.
// OM2 yetki: ekleyen (buyuk/kucuk harf duyarsiz) ya da Admin; baska kullanici, oturumsuz ve
//     ekleyeni bilinmeyen kayit DEGISTIRILEMEZ.
// OM3 uclar: ekle -> listele (duzenleyebilir kullaniciya gore) -> baskasi guncelleyemez/silemez
//     -> sahibi gunceller -> Admin siler; denetim kaydi her yazmada.
// OM4 nginx'in govdesini yuttugu kodlar (403/404/503) telden 400 gider, anlam govdede kalir;
//     okuma hatasi BOS LISTE degil, hata doner.
// OM5 gecersiz govde ve kimlik DB'ye hic gitmez.
// OM6 :id yalniz pozitif tamsayi.
// OM7 silme yalniz o kaydi siler; liste siralamasi.
// OM8 2000 kayit sinirinda kirpildi bayragi.
// OM9 guncelleme ile okuma arasinda silinen kayit 'yok' doner.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const mo = require('../manuel.cjs');
const { initManuelUclari } = require('../index.cjs');

const SIMDI = new Date('2026-11-17T09:00:00Z');
const gecerli = (ek = {}) => ({
  baslik: '  Bakim penceresi  ',
  ocoNo: '',
  aciklama: '',
  baslangic: '2026-11-20T18:00:00.000Z',
  bitis: '2026-11-20T20:00:00.000Z',
  ...ek,
});

test('OM1 dogrulama kurallari', () => {
  const v = mo.dogrula(gecerli({ ocoNo: ' 23191882 ', aciklama: '  not  ' }), SIMDI);
  assert.equal(v.hata, undefined);
  assert.equal(v.baslik, 'Bakim penceresi');
  assert.equal(v.ocoNo, '23191882');
  assert.equal(v.aciklama, 'not');
  assert.equal(v.baslangic.toISOString(), '2026-11-20T18:00:00.000Z');
  assert.equal(v.bitis.toISOString(), '2026-11-20T20:00:00.000Z');

  const bos = mo.dogrula(gecerli({ bitis: '' }), SIMDI);
  assert.equal(bos.bitis, null);
  assert.equal(bos.ocoNo, null);
  assert.equal(bos.aciklama, null);

  const hatali = [
    [gecerli({ baslik: '   ' }), /Başlık zorunlu/],
    [gecerli({ baslik: 'x'.repeat(301) }), /Başlık en çok 300/],
    [gecerli({ aciklama: 'x'.repeat(2001) }), /Açıklama en çok 2000/],
    [gecerli({ ocoNo: '12a' }), /yalnız rakam/],
    [gecerli({ ocoNo: '-5' }), /yalnız rakam/],
    [gecerli({ baslangic: '' }), /Başlangıç tarihi zorunlu/],
    [gecerli({ baslangic: 'yarin' }), /Başlangıç tarihi geçersiz/],
    [gecerli({ bitis: 'sonra' }), /Bitiş tarihi geçersiz/],
    [gecerli({ bitis: '2026-11-20T17:59:00.000Z' }), /başlangıçtan önce/],
    [gecerli({ bitis: '2026-12-22T18:00:00.000Z' }), /31 gün/],
    [gecerli({ baslangic: '2062-11-20T18:00:00.000Z', bitis: '' }), /yılı 2021–2031/],
  ];
  for (const [g, re] of hatali)
    assert.match(mo.dogrula(g, SIMDI).hata || '', re, JSON.stringify(g).slice(0, 80));
  // Sinir degerleri gecer: tam 31 gun, ayni an, 300 karakter baslik.
  assert.equal(mo.dogrula(gecerli({ bitis: '2026-12-21T18:00:00.000Z' }), SIMDI).hata, undefined);
  assert.equal(mo.dogrula(gecerli({ bitis: '2026-11-20T18:00:00.000Z' }), SIMDI).hata, undefined);
  assert.equal(mo.dogrula(gecerli({ baslik: 'x'.repeat(300) }), SIMDI).hata, undefined);
  assert.match(mo.dogrula(null, SIMDI).hata, /Başlık zorunlu/);
});

test('OM2 yetki: ekleyen ya da Admin', () => {
  const o = { olusturan: 'Ayse.K' };
  assert.equal(mo.yetkili(o, { username: 'ayse.k', role: 'User' }), true);
  assert.equal(mo.yetkili(o, { username: 'mehmet', role: 'User' }), false);
  assert.equal(mo.yetkili(o, { username: 'mehmet', role: 'Admin' }), true);
  assert.equal(mo.yetkili(o, null), false);
  // Ekleyeni bilinmeyen kayit: bos ad bos adla ESLESMEZ (yalniz Admin).
  assert.equal(mo.yetkili({ olusturan: null }, { username: '', role: 'User' }), false);
  assert.equal(mo.yetkili({ olusturan: '' }, { username: '', role: 'User' }), false);
  assert.equal(mo.yetkili({ olusturan: null }, { username: 'x', role: 'Admin' }), true);
});

test('OM6 idCoz yalniz pozitif tamsayi', () => {
  assert.equal(mo.idCoz('12'), 12);
  for (const v of ['0', '-1', '1.5', 'abc', '', '12 ', '99999999999', '2147483648', undefined])
    assert.equal(mo.idCoz(v), null, String(v));
});

// Beklenen SQL BIREBIR (bosluk normalize): WHERE'i dusen DELETE/UPDATE, yer degistirmis INSERT
// kolonlari ya da TOP/ORDER BY'siz liste sahte DB'de "beklenmeyen sorgu" olur (dogrulama bulgusu:
// onceki sahte yalniz SQL onekine bakiyordu, bu mutasyonlar hayatta kaliyordu).
const n = (s) => s.replace(/\s+/g, ' ').trim();
const SQL = {
  ekle: n(
    `INSERT INTO oco_manuel_olaylar (oco_no, baslik, aciklama, baslangic, bitis, olusturan, guncelleyen) OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $6)`,
  ),
  liste: n(
    `SELECT TOP (${mo.EN_COK_KAYIT}) id, oco_no, baslik, aciklama, baslangic, bitis, olusturan, olusturma_at, guncelleyen, guncelleme_at FROM oco_manuel_olaylar ORDER BY baslangic DESC, id DESC`,
  ),
  getir: n(
    `SELECT id, oco_no, baslik, aciklama, baslangic, bitis, olusturan, olusturma_at, guncelleyen, guncelleme_at FROM oco_manuel_olaylar WHERE id = $1`,
  ),
  guncelle: n(
    `UPDATE oco_manuel_olaylar SET oco_no = $2, baslik = $3, aciklama = $4, baslangic = $5, bitis = $6, guncelleyen = $7, guncelleme_at = GETUTCDATE() WHERE id = $1`,
  ),
  sil: n(`DELETE FROM oco_manuel_olaylar WHERE id = $1`),
};

/** Bellek ici sahte DB: yalniz manuel.cjs'in kullandigi bes sorgu, metniyle birebir. */
function sahteDb() {
  const kayitlar = new Map();
  let sira = 0;
  const sorgular = [];
  let patla = null;
  // Testin kurdugu tuzaklar: guncellemeden sonraki getir bos donsun (yaris), liste TOP sinirina ulassin.
  const tuzak = { guncelledenSonraYok: false, listeSatiri: null };
  let guncellendi = false;
  const db = {
    sorgular,
    kayitlar,
    tuzak,
    patlat(m) {
      patla = m;
    },
    async query(sql, p) {
      const q = n(sql);
      sorgular.push(q.split(' ')[0]);
      if (patla) throw new Error(patla);
      if (q === SQL.ekle) {
        const id = ++sira;
        const t = new Date('2026-11-17T09:00:00Z');
        kayitlar.set(id, {
          id,
          oco_no: p[0],
          baslik: p[1],
          aciklama: p[2],
          baslangic: p[3],
          bitis: p[4],
          olusturan: p[5],
          olusturma_at: t,
          guncelleyen: p[5],
          guncelleme_at: t,
        });
        return { rows: [{ id }] };
      }
      if (q === SQL.liste) {
        if (tuzak.listeSatiri)
          return {
            rows: Array.from({ length: tuzak.listeSatiri }, (_, i) => ({
              id: i + 1,
              baslik: `o${i}`,
              baslangic: new Date('2026-11-20T00:00:00Z'),
            })),
          };
        return {
          rows: [...kayitlar.values()].sort((a, b) => b.baslangic - a.baslangic || b.id - a.id),
        };
      }
      if (q === SQL.getir) {
        if (guncellendi && tuzak.guncelledenSonraYok) return { rows: [] };
        const x = kayitlar.get(p[0]);
        return { rows: x ? [x] : [] };
      }
      if (q === SQL.guncelle) {
        guncellendi = true;
        const x = kayitlar.get(p[0]);
        if (x)
          Object.assign(x, {
            oco_no: p[1],
            baslik: p[2],
            aciklama: p[3],
            baslangic: p[4],
            bitis: p[5],
            guncelleyen: p[6],
            guncelleme_at: new Date('2026-11-17T10:00:00Z'),
          });
        return { rows: [] };
      }
      if (q === SQL.sil) {
        kayitlar.delete(p[0]);
        return { rows: [] };
      }
      throw new Error(`beklenmeyen sorgu: ${q}`);
    },
  };
  return db;
}

async function sunucu() {
  const db = sahteDb();
  const denetimler = [];
  const app = express();
  const router = express.Router();
  router.use(express.json());
  // Istek basina kullanici: x-test-user / x-test-role basliklari (gercekte oturumdan gelir).
  const kullanici = (req) =>
    req.headers['x-test-user']
      ? { username: req.headers['x-test-user'], role: req.headers['x-test-role'] || 'User' }
      : null;
  initManuelUclari(router, {
    db,
    kullanici,
    denetim: (req, action, o) => denetimler.push({ action, ...o }),
  });
  app.use('/api/oco', router);
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const kok = `http://127.0.0.1:${srv.address().port}/api/oco`;
  const iste = async (yontem, yol, { kim = 'ayse', rol = 'User', govde } = {}) => {
    const r = await fetch(kok + yol, {
      method: yontem,
      headers: { 'content-type': 'application/json', 'x-test-user': kim, 'x-test-role': rol },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  return { db, denetimler, iste, kapat: () => new Promise((r) => srv.close(r)) };
}

test('OM3 uclar: ekle, listele, yetki, guncelle, sil; denetim kaydi', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);

  const e = await s.iste('POST', '/manuel', {
    govde: gecerli({ ocoNo: '555', aciklama: 'ilk not', bitis: '2026-11-20T21:00:00.000Z' }),
  });
  assert.equal(e.status, 200);
  assert.equal(e.body.ok, true);
  assert.equal(e.body.olay.id, 1);
  assert.equal(e.body.olay.ocoNo, '555');
  assert.equal(e.body.olay.baslik, 'Bakim penceresi');
  assert.equal(e.body.olay.olusturan, 'ayse');
  assert.equal(e.body.olay.duzenleyebilir, true);
  assert.equal(e.body.olay.baslangic, '2026-11-20T18:00:00.000Z');
  assert.equal(e.body.olay.bitis, '2026-11-20T21:00:00.000Z');
  assert.equal(e.body.olay.aciklama, 'ilk not');

  const sahip = await s.iste('GET', '/manuel');
  assert.equal(sahip.body.ok, true);
  assert.equal(sahip.body.kirpildi, false);
  assert.deepEqual(
    sahip.body.olaylar.map((o) => [o.id, o.duzenleyebilir]),
    [[1, true]],
  );
  const baska = await s.iste('GET', '/manuel', { kim: 'mehmet' });
  assert.deepEqual(
    baska.body.olaylar.map((o) => [o.id, o.duzenleyebilir]),
    [[1, false]],
  );

  // Baskasi guncelleyemez / silemez; kayit degismez.
  const g1 = await s.iste('PUT', '/manuel/1', {
    kim: 'mehmet',
    govde: gecerli({ baslik: 'ele gecirildi' }),
  });
  assert.equal(g1.status, 400);
  assert.equal(g1.body.yetkisiz, true);
  assert.match(g1.body.message, /yalnız ekleyen/);
  const s1 = await s.iste('DELETE', '/manuel/1', { kim: 'mehmet' });
  assert.equal(s1.status, 400);
  assert.equal(s1.body.yetkisiz, true);
  assert.equal(s.db.kayitlar.get(1).baslik, 'Bakim penceresi');

  // Sahibi (farkli harf buyuklugu) gunceller.
  const g2 = await s.iste('PUT', '/manuel/1', {
    kim: 'AYSE',
    govde: gecerli({
      baslik: 'Yeni baslik',
      ocoNo: '',
      aciklama: 'ikinci not',
      baslangic: '2026-11-21T08:00:00.000Z',
      bitis: '2026-11-21T09:30:00.000Z',
    }),
  });
  assert.equal(g2.status, 200);
  assert.equal(g2.body.olay.baslik, 'Yeni baslik');
  assert.equal(g2.body.olay.ocoNo, null);
  assert.equal(g2.body.olay.guncelleyen, 'AYSE');
  assert.equal(g2.body.olay.olusturan, 'ayse');
  assert.equal(g2.body.olay.aciklama, 'ikinci not');
  assert.equal(g2.body.olay.baslangic, '2026-11-21T08:00:00.000Z');
  assert.equal(g2.body.olay.bitis, '2026-11-21T09:30:00.000Z');
  assert.notEqual(
    g2.body.olay.guncellemeAt,
    e.body.olay.guncellemeAt,
    'guncelleme zamani yazilmadi',
  );
  assert.equal(g2.body.olay.olusturmaAt, e.body.olay.olusturmaAt);

  // Admin siler; sonra 404 (telden 400, govdede yok:true).
  const s2 = await s.iste('DELETE', '/manuel/1', { kim: 'yonetici', rol: 'Admin' });
  assert.equal(s2.status, 200);
  assert.equal(s.db.kayitlar.size, 0);
  const s3 = await s.iste('DELETE', '/manuel/1', { kim: 'yonetici', rol: 'Admin' });
  assert.equal(s3.status, 400);
  assert.equal(s3.body.yok, true);

  assert.deepEqual(
    s.denetimler.map((d) => d.action),
    ['oco_manuel_ekle', 'oco_manuel_guncelle', 'oco_manuel_sil'],
  );
  assert.equal(JSON.parse(s.denetimler[2].detail).baslik, 'Yeni baslik');
});

test('OM4 okuma hatasi bos liste degil; 503 telden 400', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);
  s.db.patlat('baglanti yok');
  const r = await s.iste('GET', '/manuel');
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.olaylar, undefined);
  assert.match(r.body.message, /okunamadı: baglanti yok/);
  const e = await s.iste('POST', '/manuel', { govde: gecerli() });
  assert.equal(e.status, 400);
  assert.match(e.body.message, /kaydedilemedi: baglanti yok/);
  assert.equal(s.denetimler.length, 0);
});

test('OM5 gecersiz govde ve kimlik DB yazmasina ulasmaz', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);
  const r1 = await s.iste('POST', '/manuel', { govde: gecerli({ baslik: '' }) });
  assert.equal(r1.status, 400);
  assert.match(r1.body.message, /Başlık zorunlu/);
  const r2 = await s.iste('PUT', '/manuel/abc', { govde: gecerli() });
  assert.equal(r2.status, 400);
  assert.match(r2.body.message, /Geçersiz olay kimliği/);
  const r3 = await s.iste('PUT', '/manuel/1', {
    govde: gecerli({ bitis: '2020-01-01T00:00:00Z' }),
  });
  assert.equal(r3.status, 400);
  assert.deepEqual(s.db.sorgular, []);
});

test('OM7 silme yalniz o kaydi siler; liste en yeni baslangic once', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);
  await s.iste('POST', '/manuel', { govde: gecerli({ baslik: 'erken' }) });
  await s.iste('POST', '/manuel', {
    govde: gecerli({ baslik: 'gec', baslangic: '2026-11-25T10:00:00.000Z', bitis: '' }),
  });
  const l = await s.iste('GET', '/manuel');
  assert.deepEqual(
    l.body.olaylar.map((o) => o.baslik),
    ['gec', 'erken'],
  );
  const d = await s.iste('DELETE', '/manuel/1');
  assert.equal(d.status, 200);
  assert.deepEqual([...s.db.kayitlar.keys()], [2]);
});

test('OM8 liste siniri asilinca kirpildi=true (sessiz kirpma yok)', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);
  s.db.tuzak.listeSatiri = mo.EN_COK_KAYIT;
  const l = await s.iste('GET', '/manuel');
  assert.equal(l.body.olaylar.length, mo.EN_COK_KAYIT);
  assert.equal(l.body.kirpildi, true);
  s.db.tuzak.listeSatiri = mo.EN_COK_KAYIT - 1;
  assert.equal((await s.iste('GET', '/manuel')).body.kirpildi, false);
});

test('OM9 guncelleme sirasinda silinen kayit: ok degil yok, denetim yok', async (t) => {
  const s = await sunucu();
  t.after(s.kapat);
  await s.iste('POST', '/manuel', { govde: gecerli() });
  s.denetimler.length = 0;
  s.db.tuzak.guncelledenSonraYok = true;
  const g = await s.iste('PUT', '/manuel/1', { govde: gecerli({ baslik: 'yeni' }) });
  assert.equal(g.status, 400);
  assert.equal(g.body.ok, false);
  assert.equal(g.body.yok, true);
  assert.equal(s.denetimler.length, 0);
});
