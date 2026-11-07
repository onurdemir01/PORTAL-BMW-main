// server/server-hub/gorunumler.cjs - Server Hub tablolarinin ORTAK kayitli gorunumleri (2026-11-07).
//
// Kullanici (anket): "Kayitli gorunumler / hizli suzgec cipleri". Kisisel gorunum tarayicida kalir
// (EarTablo); ORTAK gorunumu Admin kaydeder, Server Hub'i acan herkes gorur. Gorunum = tablonun suzgeci
// + siralamasi + kolonlari; veri degil, YALNIZ ekran ayari. Depo: Portal DB server_hub_gorunumler
// (ekran + ad tekil).
//
// GET    /gorunumler?ekran=              liste (okunamazsa okunamadi: true ve bos liste; ekran dusmez)
// PUT    /gorunumler                     { ekran, ad, gorunum: { f, s, kolonlar } }  ekle / guncelle
// DELETE /gorunumler?ekran=&ad=          sil
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Girdi beyaz listeyle
// dogrulanir (ekran, islec, anahtar bicimi, boyut): gorunum metni ekrana yeniden basilir. Kodlar
// proxy-guvenli: 400 gecersiz, 409 silinecek gorunum yok, 424 depo yazilamadi.
'use strict';

const db = () => require('../db/index.cjs');
const T = (s) => String(s == null ? '' : s).trim();

const EKRANLAR = [
  'server-hub-bulgular',
  'server-hub-sunucular',
  'uygulama-360',
  'retirement-etiketleri',
];
// EarTablo yerelUyar ile ayni islecler.
const ISLECLER = [
  'in',
  'icerir',
  'esit',
  'bos',
  'dolu',
  'min',
  'max',
  'gun',
  'evet',
  'hayir',
  'eksik',
];
const ANAHTAR_RE = /^[A-Za-z0-9_]{1,64}$/;
const SIRA_RE = /^[A-Za-z0-9_]{1,64}:(asc|desc)$/;
const EN_COK_JSON = 8000;
const EN_COK_GORUNUM = 50;

function hata(status, message) {
  return Object.assign(new Error(message), { status });
}

const skaler = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Gorunumu dogrular ve yalniz bilinen alanlarla yeniden kurar. */
function gorunumDogrula(g) {
  if (!g || typeof g !== 'object') throw hata(400, 'Görünüm eksik.');
  const f = Array.isArray(g.f) ? g.f : null;
  if (!f || f.length > 30) throw hata(400, 'Süzgeç listesi geçersiz (en çok 30).');
  const temiz = f.map((x) => {
    if (!x || !ANAHTAR_RE.test(T(x.k)) || !ISLECLER.includes(T(x.op)))
      throw hata(400, `Geçersiz süzgeç: ${T(x && x.k) || '?'} ${T(x && x.op) || '?'}`);
    const v = x.v;
    if (v !== undefined) {
      const l = Array.isArray(v) ? v : [v];
      if (
        l.length > 200 ||
        !l.every(skaler) ||
        l.some((y) => typeof y === 'string' && y.length > 200)
      )
        throw hata(400, `Süzgeç değeri geçersiz: ${T(x.k)}`);
    }
    return v === undefined ? { k: T(x.k), op: T(x.op) } : { k: T(x.k), op: T(x.op), v };
  });
  const s = T(g.s);
  if (s && !SIRA_RE.test(s)) throw hata(400, 'Sıralama geçersiz.');
  const kolonlar = g.kolonlar == null ? undefined : g.kolonlar;
  if (
    kolonlar !== undefined &&
    (!Array.isArray(kolonlar) ||
      kolonlar.length > 40 ||
      !kolonlar.every((k) => ANAHTAR_RE.test(T(k))))
  )
    throw hata(400, 'Kolon listesi geçersiz.');
  const out = { f: temiz, s };
  if (kolonlar) out.kolonlar = kolonlar.map(T);
  if (JSON.stringify(out).length > EN_COK_JSON) throw hata(400, 'Görünüm çok büyük.');
  return out;
}

function ekranDogrula(ekran) {
  const e = T(ekran);
  if (!EKRANLAR.includes(e)) throw hata(400, `Geçersiz ekran: ${e || '(boş)'}`);
  return e;
}
function adDogrula(ad) {
  const a = T(ad);
  if (!a || a.length > 60) throw hata(400, 'Görünüm adı 1–60 karakter olmalı.');
  return a;
}

/** @returns {Promise<{ okunamadi: boolean, gorunumler: object[] }>} hicbir zaman reddetmez */
async function oku(ekran) {
  try {
    const { rows } = await db().query(
      `SELECT ad, gorunum, kaydeden, zaman FROM server_hub_gorunumler WHERE ekran = $1 ORDER BY ad`,
      [ekran],
    );
    const gorunumler = [];
    for (const r of rows || []) {
      try {
        gorunumler.push({
          ad: T(r.ad),
          ...gorunumDogrula(JSON.parse(String(r.gorunum || ''))),
          kaydeden: r.kaydeden || null,
          zaman: r.zaman ? new Date(r.zaman).toISOString() : null,
        });
      } catch {
        // Bozuk / eski satir ekrana gitmez; digerleri gelir.
      }
    }
    return { okunamadi: false, gorunumler };
  } catch {
    return { okunamadi: true, gorunumler: [] };
  }
}

async function yaz({ ekran, ad, gorunum, kim }) {
  const e = ekranDogrula(ekran);
  const a = adDogrula(ad);
  const g = gorunumDogrula(gorunum);
  await db()
    .query(
      `SET XACT_ABORT ON;
     IF OBJECT_ID(N'server_hub_gorunumler', N'U') IS NULL
       THROW 50001, N'Görünüm tablosu hazır değil.', 1;
     BEGIN TRAN;
     UPDATE server_hub_gorunumler WITH (UPDLOCK, HOLDLOCK)
        SET gorunum = $3, kaydeden = $4, zaman = SYSUTCDATETIME()
      WHERE ekran = $1 AND ad = $2;
     IF @@ROWCOUNT = 0
     BEGIN
       IF (SELECT COUNT(*) FROM server_hub_gorunumler WHERE ekran = $1) >= ${EN_COK_GORUNUM}
         THROW 50002, N'Bu ekranda en çok ${EN_COK_GORUNUM} ortak görünüm olabilir.', 1;
       INSERT INTO server_hub_gorunumler (ekran, ad, gorunum, kaydeden) VALUES ($1, $2, $3, $4);
     END
     COMMIT;
     SELECT 1 AS tamam;`,
      [e, a, JSON.stringify(g), kim],
    )
    .catch((err) => {
      // Sinir asimi kullanicinin duzeltecegi bir girdi hatasidir (400); digerleri depo (424).
      const m = String((err && err.message) || '');
      throw hata(/ortak görünüm olabilir/.test(m) ? 400 : 424, m || 'Görünüm kaydedilemedi.');
    });
  return { ekran: e, ad: a, ...g };
}

async function sil({ ekran, ad }) {
  const e = ekranDogrula(ekran);
  const a = adDogrula(ad);
  let rows;
  try {
    ({ rows } = await db().query(
      `DELETE FROM server_hub_gorunumler OUTPUT DELETED.ad WHERE ekran = $1 AND ad = $2`,
      [e, a],
    ));
  } catch (err) {
    throw hata(424, (err && err.message) || 'Görünüm silinemedi.');
  }
  if (!(rows || []).length)
    throw hata(409, `${a} görünümü artık yok (başka biri silmiş olabilir).`);
  return { ekran: e, ad: a };
}

function mount(router, { audit }) {
  const kim = (req) => (req.session && req.session.user && req.session.user.username) || 'unknown';
  const gonder = (res, err) =>
    res
      .status([400, 409, 424].includes(err.status) ? err.status : 424)
      .json({ ok: false, message: err.message });

  router.get('/gorunumler', async (req, res) => {
    let e;
    try {
      e = ekranDogrula(req.query.ekran);
    } catch (err) {
      return gonder(res, err);
    }
    res.json({ ok: true, ekran: e, ...(await oku(e)) });
  });

  router.put('/gorunumler', async (req, res) => {
    try {
      const b = req.body || {};
      const r = await yaz({ ekran: b.ekran, ad: b.ad, gorunum: b.gorunum, kim: kim(req) });
      audit(req, { op: 'gorunum_kaydet', ekran: r.ekran, ad: r.ad, suzgec: r.f.length });
      res.json({ ok: true, ...(await oku(r.ekran)) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.delete('/gorunumler', async (req, res) => {
    try {
      const r = await sil({ ekran: req.query.ekran, ad: req.query.ad });
      audit(req, { op: 'gorunum_sil', ekran: r.ekran, ad: r.ad });
      res.json({ ok: true, ...(await oku(r.ekran)) });
    } catch (err) {
      gonder(res, err);
    }
  });
}

module.exports = { mount, oku, yaz, sil, gorunumDogrula, EKRANLAR, ISLECLER };
