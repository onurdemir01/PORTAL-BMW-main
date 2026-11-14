// server/server-hub/notlar.cjs - Kalici Admin notlari, etiketler, siniflar (2026-11-07).
//
// Kullanici: "verilere, uygulamalara etiket duzenleme silme ekleme yorum koyma siniflandirma taglama ...
// her sey admin tarafindan editlenebilir ve konfiguratif olmali; biz gercekten bulgu bulabiliriz ama bu
// bilinen bir seydir ve duzeltilecektir ve / veya durumu oyle olmalidir ... bu kisim her taramada
// gitmemeli". Anket: "Bilinen" isaretli supheler AYRI bolumde; indeksler birbirini desteklesin.
//
// DEPO (Portal DB): server_hub_notlar (konu = kanonik varlik anahtari, iliski-grafigi.cjs A.*),
// server_hub_not_gecmisi (her degisiklik, onceki hali JSON), server_hub_siniflar (Admin taksonomisi;
// varsayilanlar kodda, ayni adla satir onlari ezer).
// KURALLAR:
//   - Tarama notu SILMEZ, DEGISTIRMEZ. Konusu grafikte yoksa not YETIM listelenir (son gorulme yok).
//   - Yazildigi anki kanit imzasi saklanir; imza degisince not KALIR, "veri degisti" rozeti cikar.
//   - Yayilim: YALNIZ (konunun kendisi) | ASAGI (app -> kopya -> vhost -> IP; sunucu -> kopya / web -> vhost
//     -> IP) | ZINCIR (bagli bilesen, en cok 500 varlik). Ilgili varlikta "buradan geldi" yoluyla gorunur.
//   - Sinif etkisi BILINEN: ilgili madde (supheli_kod) ya da varligin tamami ana sayimdan dusup "Bilinen"
//     bolumune gecer; KARAR DEGISMEZ (motor ne diyorsa o, not yalniz aciklama ve siniflama).
//   - Silme varsayilan ARSIV (geri alinabilir); kalici silme acik istenirse; gecmis her durumda kalir.
'use strict';

const crypto = require('node:crypto');

const db = () => require('../db/index.cjs');
const T = (s) => String(s == null ? '' : s).trim();

const KONU_RE = /^(sunucu|jvm|was|web|vhost|ip|dns|app):[^\s]{1,390}$/;
const KOD_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
const SINIF_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
const ETIKET_RE = /^[\p{L}\p{N} ._/-]{1,40}$/u;
const YAYILIMLAR = ['YALNIZ', 'ASAGI', 'ZINCIR'];
const RENKLER = ['notr', 'bilgi', 'aksan', 'uyari', 'basari', 'hata'];
const ETKILER = ['BILINEN', 'BILGI'];
const BILESEN_SINIRI = 500;

const SINIF_VARSAYILAN = Object.freeze([
  {
    ad: 'BILINEN',
    baslik: 'Bilinen',
    renk: 'notr',
    etki: 'BILINEN',
    aciklama: 'Bilinen ve kabul edilen durum.',
    sira: 10,
    varsayilan: true,
  },
  {
    ad: 'OLMASI_GEREKEN',
    baslik: 'Olması gereken',
    renk: 'basari',
    etki: 'BILINEN',
    aciklama: 'Böyle olması bekleniyor; şüphe değil.',
    sira: 20,
    varsayilan: true,
  },
  {
    ad: 'DUZELTILECEK',
    baslik: 'Düzeltilecek',
    renk: 'uyari',
    etki: 'BILGI',
    aciklama: 'Gerçek sorun; düzeltme planlandı.',
    sira: 30,
    varsayilan: true,
  },
  {
    ad: 'RETIRE_EDILECEK',
    baslik: 'Retire edilecek',
    renk: 'aksan',
    etki: 'BILGI',
    aciklama: 'Retire kararı verildi; kayıt açılacak / açıldı.',
    sira: 40,
    varsayilan: true,
  },
  {
    ad: 'SAHIBINE_SORULDU',
    baslik: 'Sahibine soruldu',
    renk: 'bilgi',
    etki: 'BILGI',
    aciklama: 'Uygulama sahibinden yanıt bekleniyor.',
    sira: 50,
    varsayilan: true,
  },
]);

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/** Not govdesi -> normalize. Yanlis bicim 400; bilinmeyen sinif 422 (cagiran siniflari verir). */
function notDogrula(b, siniflar) {
  const g = b && typeof b === 'object' ? b : {};
  const konu = T(g.konu);
  if (!KONU_RE.test(konu))
    throw hata(400, 'Konu geçersiz (ör. app:UYGULAMA, sunucu:SUNUCU, vhost:...).');
  const kod = g.supheli_kod == null || g.supheli_kod === '' ? null : T(g.supheli_kod).toUpperCase();
  if (kod != null && !KOD_RE.test(kod)) throw hata(400, 'Şüphe kodu geçersiz.');
  const sinif = T(g.sinif).toUpperCase();
  if (!siniflar.some((s) => s.ad === sinif))
    throw hata(422, `Bilinmeyen sınıf: ${sinif || '(boş)'}`);
  const etiketler = [
    ...new Set((Array.isArray(g.etiketler) ? g.etiketler : []).map(T).filter(Boolean)),
  ];
  if (etiketler.length > 20 || etiketler.some((e) => !ETIKET_RE.test(e)))
    throw hata(
      400,
      'Etiketler geçersiz (en çok 20; harf, rakam, boşluk, . _ / -; en çok 40 karakter).',
    );
  const metin = T(g.metin);
  if (metin.length < 3 || metin.length > 2000) throw hata(400, 'Not metni 3-2000 karakter olmalı.');
  const yayilim = YAYILIMLAR.includes(T(g.yayilim).toUpperCase())
    ? T(g.yayilim).toUpperCase()
    : 'YALNIZ';
  return { konu, supheli_kod: kod, sinif, etiketler, metin, yayilim };
}

function sinifDogrula(b) {
  const g = b && typeof b === 'object' ? b : {};
  const ad = T(g.ad).toUpperCase();
  if (!SINIF_RE.test(ad)) throw hata(400, 'Sınıf adı geçersiz (BÜYÜK_HARF, 2-40).');
  const baslik = T(g.baslik);
  if (baslik.length < 2 || baslik.length > 80) throw hata(400, 'Başlık 2-80 karakter olmalı.');
  const renk = RENKLER.includes(T(g.renk)) ? T(g.renk) : null;
  if (!renk) throw hata(400, `Renk ${RENKLER.join(' / ')} olmalı.`);
  const etki = ETKILER.includes(T(g.etki).toUpperCase()) ? T(g.etki).toUpperCase() : null;
  if (!etki) throw hata(400, 'Etki BILINEN ya da BILGI olmalı.');
  const aciklama = T(g.aciklama).slice(0, 300);
  const sira = Number.isFinite(Number(g.sira))
    ? Math.max(0, Math.min(999, Math.trunc(Number(g.sira))))
    : 100;
  return { ad, baslik, renk, etki, aciklama, sira };
}

// ── DB ───────────────────────────────────────────────────────────────────────────────────────────
const satirNot = (r) => ({
  id: Number(r.id),
  konu: T(r.konu),
  konu_tur: T(r.konu).split(':')[0],
  supheli_kod: r.supheli_kod ? T(r.supheli_kod) : null,
  sinif: T(r.sinif),
  etiketler: (() => {
    try {
      const v = JSON.parse(r.etiketler || '[]');
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  })(),
  metin: String(r.metin || ''),
  yayilim: YAYILIMLAR.includes(T(r.yayilim)) ? T(r.yayilim) : 'YALNIZ',
  durum: T(r.durum) === 'ARSIV' ? 'ARSIV' : 'AKTIF',
  imza: r.imza ? T(r.imza) : null,
  surum: Number(r.surum) || 1,
  olusturan: r.olusturan || null,
  olusturuldu: r.olusturuldu ? new Date(r.olusturuldu).toISOString() : null,
  guncelleyen: r.guncelleyen || null,
  guncellendi: r.guncellendi ? new Date(r.guncellendi).toISOString() : null,
});

/** @returns {Promise<{ okunamadi: boolean, hata?: string, notlar: object[] }>} */
async function notlariOku({ arsiv = false } = {}) {
  try {
    const { rows } = await db().query(
      `SELECT id, konu, supheli_kod, sinif, etiketler, metin, yayilim, durum, imza, surum, olusturan, olusturuldu, guncelleyen, guncellendi
         FROM server_hub_notlar ${arsiv ? '' : "WHERE durum = 'AKTIF'"} ORDER BY id`,
    );
    return { okunamadi: false, notlar: (rows || []).map(satirNot) };
  } catch (e) {
    return { okunamadi: true, hata: (e && e.message) || 'okunamadı', notlar: [] };
  }
}

/** Varsayilanlar + DB satirlari (ayni ad varsayilani ezer). Okunamazsa varsayilanlar + okunamadi. */
async function siniflariOku() {
  const harita = new Map(SINIF_VARSAYILAN.map((s) => [s.ad, { ...s }]));
  try {
    const { rows } = await db().query(
      `SELECT ad, baslik, renk, etki, aciklama, sira FROM server_hub_siniflar`,
    );
    for (const r of rows || []) {
      const ad = T(r.ad);
      if (!SINIF_RE.test(ad)) continue;
      harita.set(ad, {
        ad,
        baslik: String(r.baslik || ad),
        renk: RENKLER.includes(T(r.renk)) ? T(r.renk) : 'notr',
        etki: ETKILER.includes(T(r.etki)) ? T(r.etki) : 'BILGI',
        aciklama: String(r.aciklama || ''),
        // 0 gecerli sira (sinifDogrula 0-999); yalniz bos / sayi olmayan 100.
        sira: r.sira == null || !Number.isFinite(Number(r.sira)) ? 100 : Number(r.sira),
        varsayilan: SINIF_VARSAYILAN.some((s) => s.ad === ad),
      });
    }
    return {
      okunamadi: false,
      siniflar: [...harita.values()].sort((a, b) => a.sira - b.sira || a.ad.localeCompare(b.ad)),
    };
  } catch (e) {
    return {
      okunamadi: true,
      hata: (e && e.message) || 'okunamadı',
      siniflar: [...harita.values()],
    };
  }
}

const GECMIS_SQL = `INSERT INTO server_hub_not_gecmisi (not_id, islem, onceki, kim) VALUES ($1, $2, $3, $4);`;

async function notEkle(n, { kim, imza }) {
  try {
    const { rows } = await db().query(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
       INSERT INTO server_hub_notlar (konu, supheli_kod, sinif, etiketler, metin, yayilim, durum, imza, surum, olusturan, guncelleyen)
         OUTPUT INSERTED.id
         VALUES ($1, $2, $3, $4, $5, $6, 'AKTIF', $7, 1, $8, $8);
       COMMIT;`,
      [n.konu, n.supheli_kod, n.sinif, JSON.stringify(n.etiketler), n.metin, n.yayilim, imza, kim],
    );
    const id = rows && rows[0] ? Number(rows[0].id) : null;
    if (id == null) throw new Error('kimlik dönmedi');
    await db()
      .query(GECMIS_SQL, [id, 'EKLE', null, kim])
      .catch(() => {});
    return id;
  } catch (e) {
    throw hata(424, `Not kaydedilemedi: ${(e && e.message) || ''}`.trim());
  }
}

/** Iyimser kilit: surum tutmazsa 409 (baska Admin degistirdi). */
async function notGuncelle(id, n, { kim, surum, imza }) {
  const once = await notGetir(id);
  if (!once) throw hata(409, 'Not artık yok.');
  if (Number(surum) !== once.surum)
    throw hata(409, 'Not bu arada değişti; sayfayı yenileyip tekrar deneyin.');
  let r;
  try {
    r = await db().query(
      `UPDATE server_hub_notlar
          SET supheli_kod = $3, sinif = $4, etiketler = $5, metin = $6, yayilim = $7, imza = $8,
              surum = surum + 1, guncelleyen = $9, guncellendi = SYSUTCDATETIME()
        WHERE id = $1 AND surum = $2`,
      [
        id,
        once.surum,
        n.supheli_kod,
        n.sinif,
        JSON.stringify(n.etiketler),
        n.metin,
        n.yayilim,
        imza,
        kim,
      ],
    );
  } catch (e) {
    throw hata(424, `Not güncellenemedi: ${(e && e.message) || ''}`.trim());
  }
  if (r.rowCount !== 1) throw hata(409, 'Not bu arada değişti; sayfayı yenileyip tekrar deneyin.');
  await db()
    .query(GECMIS_SQL, [id, 'GUNCELLE', JSON.stringify(once), kim])
    .catch(() => {});
}

async function notGetir(id) {
  const { rows } = await db().query(
    `SELECT id, konu, supheli_kod, sinif, etiketler, metin, yayilim, durum, imza, surum, olusturan, olusturuldu, guncelleyen, guncellendi
       FROM server_hub_notlar WHERE id = $1`,
    [Number(id)],
  );
  return rows && rows[0] ? satirNot(rows[0]) : null;
}

/**
 * durum: ARSIV | AKTIF (geri al) | SIL (kalici; gecmis kalir). Ayni duruma gecis 409 (cift tik / iki Admin;
 * gecmise bos kayit dusmesin). Geri alinan notun sinifi tanimli olmali: "aktif notu olan sinif silinmez"
 * kurali arsivden donuste de gecerli (sinifi silinmis aktif not ne bastirir ne duzenlenebilir).
 */
async function notDurum(id, durum, { kim }) {
  const once = await notGetir(id).catch((e) => {
    throw hata(424, (e && e.message) || 'okunamadı');
  });
  if (!once) throw hata(409, 'Not artık yok.');
  if (durum !== 'SIL' && once.durum === durum)
    throw hata(409, durum === 'ARSIV' ? 'Not zaten arşivde.' : 'Not zaten aktif.');
  if (durum === 'AKTIF') {
    const s = await siniflariOku();
    if (!s.siniflar.some((x) => x.ad === once.sinif))
      throw s.okunamadi
        ? hata(424, 'Sınıf tablosu okunamadı; notun sınıfı doğrulanamadı.')
        : hata(409, `Notun sınıfı (${once.sinif}) artık yok; önce sınıfı yeniden ekleyin.`);
  }
  try {
    if (durum === 'SIL') await db().query(`DELETE FROM server_hub_notlar WHERE id = $1`, [once.id]);
    else
      await db().query(
        `UPDATE server_hub_notlar SET durum = $2, surum = surum + 1, guncelleyen = $3, guncellendi = SYSUTCDATETIME() WHERE id = $1`,
        [once.id, durum, kim],
      );
  } catch (e) {
    throw hata(424, (e && e.message) || 'Not değiştirilemedi.');
  }
  await db()
    .query(GECMIS_SQL, [
      once.id,
      durum === 'SIL' ? 'SIL' : durum === 'ARSIV' ? 'ARSIV' : 'GERI_AL',
      JSON.stringify(once),
      kim,
    ])
    .catch(() => {});
  return once;
}

async function notGecmisi(id) {
  try {
    const { rows } = await db().query(
      `SELECT islem, onceki, kim, zaman FROM server_hub_not_gecmisi WHERE not_id = $1 ORDER BY id`,
      [Number(id)],
    );
    return (rows || []).map((r) => ({
      islem: T(r.islem),
      onceki: (() => {
        try {
          return r.onceki ? JSON.parse(r.onceki) : null;
        } catch {
          return null;
        }
      })(),
      kim: r.kim || null,
      zaman: r.zaman ? new Date(r.zaman).toISOString() : null,
    }));
  } catch (e) {
    throw hata(424, (e && e.message) || 'Geçmiş okunamadı.');
  }
}

async function sinifYaz(s, { kim }) {
  try {
    await db().query(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
       UPDATE server_hub_siniflar WITH (UPDLOCK, HOLDLOCK) SET baslik = $2, renk = $3, etki = $4, aciklama = $5, sira = $6, kim = $7, zaman = SYSUTCDATETIME() WHERE ad = $1;
       IF @@ROWCOUNT = 0 INSERT INTO server_hub_siniflar (ad, baslik, renk, etki, aciklama, sira, kim) VALUES ($1, $2, $3, $4, $5, $6, $7);
       COMMIT;`,
      [s.ad, s.baslik, s.renk, s.etki, s.aciklama, s.sira, kim],
    );
  } catch (e) {
    throw hata(424, `Sınıf kaydedilemedi: ${(e && e.message) || ''}`.trim());
  }
}

/** Varsayilan sinif silinmez; aktif notu olan sinif silinmez (409). */
async function sinifSil(ad) {
  const a = T(ad).toUpperCase();
  if (SINIF_VARSAYILAN.some((s) => s.ad === a))
    throw hata(409, 'Varsayılan sınıf silinemez (başlığı / rengi değiştirilebilir).');
  let rows;
  try {
    ({ rows } = await db().query(
      `SELECT COUNT(*) AS n FROM server_hub_notlar WHERE sinif = $1 AND durum = 'AKTIF'`,
      [a],
    ));
  } catch (e) {
    throw hata(424, (e && e.message) || 'okunamadı');
  }
  if (Number(rows && rows[0] && rows[0].n) > 0)
    throw hata(409, 'Bu sınıfta aktif not var; önce notları başka sınıfa taşıyın.');
  let r;
  try {
    // Sayim ile silme arasinda baska Admin bu sinifla not eklerse silme olmaz (tek ifadede kosul).
    r = await db().query(
      `DELETE FROM server_hub_siniflar OUTPUT DELETED.ad
        WHERE ad = $1 AND NOT EXISTS (SELECT 1 FROM server_hub_notlar WHERE sinif = $1 AND durum = 'AKTIF')`,
      [a],
    );
  } catch (e) {
    throw hata(424, (e && e.message) || 'Sınıf silinemedi.');
  }
  if (!r.rows || !r.rows.length) throw hata(409, 'Sınıf yok ya da bu arada aktif not eklendi.');
}

// ── ONBELLEK ── notlar + siniflar her istekte DB'ye gitmesin (10 sn); her yazim onbellegi siler.
const NOT_TTL_MS = 10 * 1000;
let _nb = { at: 0, deger: null };
function onbellekSil() {
  _nb = { at: 0, deger: null };
}
async function notDurumu() {
  if (_nb.deger && Date.now() - _nb.at < NOT_TTL_MS) return _nb.deger;
  const [n, s] = await Promise.all([notlariOku(), siniflariOku()]);
  const deger = {
    notlar: n.notlar,
    siniflar: s.siniflar,
    okunamadi: n.okunamadi || s.okunamadi,
    hata: n.hata || s.hata || '',
  };
  if (!deger.okunamadi) _nb = { at: Date.now(), deger };
  return deger;
}

// ── INDEKS (saf) ─────────────────────────────────────────────────────────────────────────────────
// ASAGI yonler: kenar turu -> konudan hangi uca gidilir.
const ASAGI = [
  ['kopya', 'hedef'], // app -> jvm / was
  ['barindirir', 'hedef'], // sunucu -> jvm / was / web
  ['sunar', 'hedef'], // web -> vhost
  ['yonlendirir', 'kaynak'], // jvm / was <- vhost (kopyanin web katmani)
  ['dinler', 'hedef'], // vhost -> ip
];

/** Notun ulastigi varliklar: Map(anahtar -> yol [konu, ..., anahtar]). */
function yayilimKumesi(g, konu, yayilim) {
  const out = new Map([[konu, [konu]]]);
  if (yayilim === 'YALNIZ' || !g || !g.dugumler.has(konu)) return out;
  const kuyruk = [konu];
  while (kuyruk.length && out.size < BILESEN_SINIRI) {
    const u = kuyruk.shift();
    for (const e of g.komsuKenarlar(u)) {
      let w = null;
      if (yayilim === 'ZINCIR') w = e.kaynak === u ? e.hedef : e.kaynak;
      else
        for (const [tur, uc] of ASAGI)
          if (e.tur === tur && (uc === 'hedef' ? e.kaynak === u : e.hedef === u))
            w = uc === 'hedef' ? e.hedef : e.kaynak;
      if (w && !out.has(w)) {
        out.set(w, [...out.get(u), w]);
        kuyruk.push(w);
      }
    }
  }
  return out;
}

/**
 * @returns {{ varlikNotlari: Map<string, Array<{ not: object, yol: string[], dogrudan: boolean }>>, yetimler: object[] }}
 */
function notlariIndeksle(notlar, g) {
  const varlikNotlari = new Map();
  const yetimler = [];
  for (const n of notlar) {
    if (n.durum !== 'AKTIF') continue;
    if (!g || !g.dugumler.has(n.konu)) yetimler.push(n);
    for (const [k, yol] of yayilimKumesi(g, n.konu, n.yayilim)) {
      if (!varlikNotlari.has(k)) varlikNotlari.set(k, []);
      varlikNotlari.get(k).push({ not: n, yol, dogrudan: k === n.konu });
    }
  }
  return { varlikNotlari, yetimler };
}

/**
 * Kanit imzasi: kopya / uygulama icin karar + madde kodlari; diger varliklar icin kenar ozeti. Not yazilirken
 * saklanir; okurken farkliysa "veri degisti".
 */
function imzaOf(g, kararlar, anahtar) {
  let govde;
  const k = kararlar && (kararlar.kopyalar.get(anahtar) || kararlar.uygulamalar.get(anahtar));
  if (k && k.maddeler) govde = { karar: k.karar, maddeler: k.maddeler.map((m) => m.kod).sort() };
  else if (k) govde = { karar: k.karar, sayilar: k.sayilar };
  else if (g && g.dugumler.has(anahtar))
    govde = g
      .komsuKenarlar(anahtar)
      .map((e) => `${e.tur}|${e.kaynak === anahtar ? e.hedef : e.kaynak}|${e.durum}`)
      .sort();
  else return null;
  return crypto.createHash('sha256').update(JSON.stringify(govde)).digest('hex').slice(0, 32);
}

/**
 * Kararlari notlarla zenginlestirir (kopyalamadan): kopya / uygulama -> notlar (dogrudan + yayilan),
 * BILINEN etkili notun bastirdigi maddeler, varligin tamami bilinen mi, veri degisti mi.
 */
function kararNotlari(anahtar, { indeks, siniflar, g, kararlar }) {
  const etki = new Map(siniflar.map((s) => [s.ad, s.etki]));
  const l = indeks.varlikNotlari.get(anahtar) || [];
  const notlar = l.map(({ not, yol, dogrudan }) => {
    const simdiki = dogrudan ? imzaOf(g, kararlar, anahtar) : null;
    return {
      ...not,
      yol,
      dogrudan,
      veriDegisti: !!(dogrudan && not.imza && simdiki && simdiki !== not.imza),
    };
  });
  const bilinenNot = notlar.filter((n) => etki.get(n.sinif) === 'BILINEN');
  return {
    notlar,
    bilinenKodlar: new Map(bilinenNot.filter((n) => n.supheli_kod).map((n) => [n.supheli_kod, n])),
    tumuBilinen: bilinenNot.find((n) => !n.supheli_kod) || null,
  };
}

module.exports = {
  SINIF_VARSAYILAN,
  YAYILIMLAR,
  RENKLER,
  KONU_RE,
  notDogrula,
  sinifDogrula,
  notlariOku,
  siniflariOku,
  notEkle,
  notGuncelle,
  notGetir,
  notDurum,
  notGecmisi,
  sinifYaz,
  sinifSil,
  yayilimKumesi,
  notlariIndeksle,
  imzaOf,
  kararNotlari,
  notDurumu,
  onbellekSil,
  hata,
};
