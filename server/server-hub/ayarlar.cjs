// server/server-hub/ayarlar.cjs - Server Hub Admin ayarlari (2026-10-20): bulgu seviyeleri ve
// tek seferde girilebilecek sunucu sayisi.
//
// Kullanici: (1) "istedigimde bunlarin kritiklik seviyesini degistirebilmek istiyorum";
// (2) "reboot kontrolu ve acilis hazirligi gibi sayfalara maksimum ne kadar input verebiliyorum?
// ... Tek seferde kac sunucu yazilabilecegini oraya gostermeni ... bu limitin arttirilabilmesi icin
// de adminlere yetki vermeni istiyorum."
//
// DEPO: Portal DB server_hub_ayarlar (anahtar -> deger) + server_hub_ayar_gecmisi (kim, ne zaman,
// eski -> yeni, aciklama). Anahtarlar 'seviye:<KOD>' ve 'limit:<ad>'. VARSAYILANA DONEN deger
// satiri SILER: tablo yalniz gercekten degistirilmis olani tasir (kodun varsayilani degisirse
// eski bir DB satiri onu sessizce ezmesin).
// OKUNAMAZSA varsayilanlar uygulanir ve bu GIZLENMEZ (okunamadi=true; ekran soyler).
// Server Hub router'i zaten yalniz Admin'e acik; yazma uclari oradadir.
//
// RETIREMENT (2026-11-06): 'etiket:<KURAL>' (KESIN / SUPHELI / KAPALI) ve 'liste:kok_yoksay' (kokte
// yok sayilan girdi adlari, siralanmis ve virgulle). Ikisinde de GEREKCE zorunlu: etiket bir silme
// kararinin girdisidir.
'use strict';

const {
  KODLAR,
  SEVIYELER,
  ETIKET_KURALLARI,
  ETIKET_SEVIYELERI,
  KOK_YOKSAY_VARSAYILAN,
} = require('./kural-katalogu.cjs');

const KURAL = new Map(ETIKET_KURALLARI.map((k) => [k.kural, k]));
const YOKSAY_AD_RE = /^[A-Za-z0-9._+@-][A-Za-z0-9._+@ -]{0,63}$/;
const YOKSAY_SINIR = 50;
/** Ad listesi -> tekil, sirali dizi; gecersiz ad varsa null. */
function yoksayNormal(liste) {
  const adlar = (Array.isArray(liste) ? liste : String(liste == null ? '' : liste).split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (adlar.some((x) => !YOKSAY_AD_RE.test(x) || x === '.' || x === '..')) return null;
  return [...new Set(adlar)].sort();
}
const YOKSAY_VARSAYILAN_METIN = yoksayNormal(KOK_YOKSAY_VARSAYILAN).join(',');

/**
 * Sunucu sayisi limitleri. ust: Admin'in verebilecegi en buyuk deger (gerekce aciklamada).
 * tara / reboot AWX isine target_hosts olarak gider; hazirlik is BASLATMAZ.
 */
const LIMITLER = {
  tara: {
    ad: 'Şimdi tara',
    varsayilan: 50,
    ust: 1000,
    aciklama: 'server_hub_scan işini seçilen sunucularda başlatır; liste AWX işine target_hosts olarak gider.',
  },
  reboot: {
    ad: 'Reboot Kontrolü',
    // 2026-11-13 (kullanici): varsayilan 50 -> 500 (ust sinirla ayni).
    varsayilan: 500,
    ust: 500,
    aciklama: 'reboot_check işi (önce / sonra); sonra fazı her sunucunun “önce” görüntüsünü AWX işine taşır, bu yüzden üst sınır daha düşük.',
  },
  hazirlik: {
    ad: 'Açılış Hazırlığı',
    varsayilan: 500,
    ust: 5000,
    aciklama: 'İş başlatmaz; son taramayı okur.',
  },
};

const TTL_MS = 30 * 1000;
let _cache = { at: 0, value: null };
const onbellekSil = () => {
  _cache = { at: 0, value: null };
};
const db = () => require('../db/index.cjs');
const T = (s) => String(s == null ? '' : s).trim();

function varsayilanlar() {
  return {
    seviyeler: {},
    limitler: Object.fromEntries(Object.entries(LIMITLER).map(([k, v]) => [k, v.varsayilan])),
    etiketler: Object.fromEntries(ETIKET_KURALLARI.map((k) => [k.kural, k.varsayilan])),
    kokYoksay: yoksayNormal(KOK_YOKSAY_VARSAYILAN),
    kayitlar: {},
    okunamadi: false,
    hata: '',
  };
}

/** DB satirlari -> ayarlar. Gecersiz / bilinmeyen satir YOK SAYILIR (varsayilan gecerli kalir). */
function satirlardan(rows) {
  const out = varsayilanlar();
  for (const r of rows || []) {
    const anahtar = T(r.anahtar);
    const deger = T(r.deger);
    const meta = { deger, aciklama: r.aciklama || '', updatedBy: r.updated_by || null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null };
    if (anahtar.startsWith('seviye:')) {
      const kod = anahtar.slice('seviye:'.length);
      if (!KODLAR.has(kod) || !SEVIYELER.includes(deger)) continue;
      out.seviyeler[kod] = deger;
      out.kayitlar[anahtar] = meta;
    } else if (anahtar.startsWith('limit:')) {
      const ad = anahtar.slice('limit:'.length);
      const n = Number(deger);
      if (!LIMITLER[ad] || !Number.isInteger(n) || n < 1 || n > LIMITLER[ad].ust) continue;
      out.limitler[ad] = n;
      out.kayitlar[anahtar] = meta;
    } else if (anahtar.startsWith('etiket:')) {
      const kural = anahtar.slice('etiket:'.length);
      if (!KURAL.has(kural) || !ETIKET_SEVIYELERI.includes(deger)) continue;
      out.etiketler[kural] = deger;
      out.kayitlar[anahtar] = meta;
    } else if (anahtar === 'liste:kok_yoksay') {
      const l = yoksayNormal(deger);
      if (!l || l.length > YOKSAY_SINIR) continue;
      out.kokYoksay = l;
      out.kayitlar[anahtar] = meta;
    }
  }
  return out;
}

async function oku(fresh = false) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) return _cache.value;
  try {
    const { rows } = await db().query(
      `SELECT anahtar, deger, aciklama, updated_by, updated_at FROM server_hub_ayarlar`,
    );
    const value = satirlardan(rows);
    _cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // OKUNAMADI onbellege alinmaz: bir sonraki istek yeniden dener.
    return { ...varsayilanlar(), okunamadi: true, hata: err.message || 'okunamadı' };
  }
}

async function limit(ad) {
  return (await oku()).limitler[ad];
}

function hata(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Tek anahtari yazar; varsayilana donuyorsa satiri siler. Ayar + gecmis tek transaction'dir. */
async function yaz(anahtar, yeni, varsayilan, aciklama, kim) {
  const simdiki = await oku(true);
  if (simdiki.okunamadi) throw hata(503, `Server Hub ayarları okunamadı: ${simdiki.hata}`);
  const not = T(aciklama).slice(0, 500) || null;
  const tabloKapisi = `SET XACT_ABORT ON;
    IF OBJECT_ID(N'server_hub_ayarlar', N'U') IS NULL OR OBJECT_ID(N'server_hub_ayar_gecmisi', N'U') IS NULL
      THROW 50001, N'Server Hub ayar tablolari hazir degil.', 1;
    DECLARE @eski nvarchar(max);
    DECLARE @degisti bit = 0;
    BEGIN TRAN;
    SELECT @eski = deger FROM server_hub_ayarlar WITH (UPDLOCK, HOLDLOCK) WHERE anahtar = $1;
    SET @eski = COALESCE(@eski, $5);`;
  const ayarSql =
    String(yeni) === String(varsayilan)
      ? `DELETE FROM server_hub_ayarlar WHERE anahtar = $1;`
      : `UPDATE server_hub_ayarlar WITH (UPDLOCK, HOLDLOCK)
           SET deger = $2, aciklama = $3, updated_by = $4, updated_at = GETUTCDATE()
         WHERE anahtar = $1;
         IF @@ROWCOUNT = 0
           INSERT INTO server_hub_ayarlar (anahtar, deger, aciklama, updated_by)
           VALUES ($1, $2, $3, $4);`;
  const tx = await db().query(
    `${tabloKapisi}
     IF @eski <> $2
     BEGIN
       ${ayarSql}
       INSERT INTO server_hub_ayar_gecmisi (anahtar, eski, yeni, aciklama, degistiren)
       VALUES ($1, @eski, $2, $3, $4);
       SET @degisti = 1;
     END
     COMMIT;
     SELECT @eski AS eski, $2 AS yeni, @degisti AS degisti;`,
    [anahtar, String(yeni), not, kim, String(varsayilan)],
  );
  const sonuc = tx.rows && tx.rows[0];
  if (!sonuc) throw new Error('Server Hub ayar yazımı sonucu okunamadı.');
  const eski = T(sonuc.eski);
  const gercekYeni = T(sonuc.yeni);
  const degismedi = sonuc.degisti === false || sonuc.degisti === 0;
  onbellekSil();
  return {
    anahtar,
    eski,
    yeni: gercekYeni,
    degismedi,
    varsayilan: gercekYeni === String(varsayilan),
  };
}

async function seviyeYaz({ kod, seviye, aciklama, kim }) {
  const k = T(kod);
  const s = T(seviye);
  if (!KODLAR.has(k)) throw hata(400, `Bilinmeyen bulgu kodu: ${k || '(boş)'}`);
  if (!SEVIYELER.includes(s)) throw hata(400, `Geçersiz seviye: ${s || '(boş)'} (kritik / uyarı / bilgi / sorun yok)`);
  return yaz(`seviye:${k}`, s, KODLAR.get(k).seviye, aciklama, kim);
}

async function limitYaz({ ad, deger, aciklama, kim }) {
  const a = T(ad);
  const L = LIMITLER[a];
  if (!L) throw hata(400, `Bilinmeyen limit: ${a || '(boş)'}`);
  const n = Number(deger);
  if (!Number.isInteger(n) || n < 1 || n > L.ust)
    throw hata(400, `${L.ad} için limit 1 ile ${L.ust} arasında bir tam sayı olmalı (gelen: ${T(deger) || '(boş)'}).`);
  return yaz(`limit:${a}`, n, L.varsayilan, aciklama, kim);
}

async function etiketYaz({ kural, seviye, aciklama, kim }) {
  const k = T(kural);
  const s = T(seviye);
  if (!KURAL.has(k)) throw hata(400, `Bilinmeyen etiket kuralı: ${k || '(boş)'}`);
  if (!ETIKET_SEVIYELERI.includes(s)) throw hata(400, `Geçersiz etiket: ${s || '(boş)'} (KESIN / SUPHELI / KAPALI)`);
  if (T(aciklama).length < 3) throw hata(400, 'Gerekçe zorunlu: etiket bir retire kararının girdisidir.');
  return yaz(`etiket:${k}`, s, KURAL.get(k).varsayilan, aciklama, kim);
}

async function kokYoksayYaz({ liste, aciklama, kim }) {
  const l = yoksayNormal(liste);
  if (!l) throw hata(400, 'Geçersiz ad: yalnız harf, rakam, . _ + @ - ve boşluk; en çok 64 karakter; "." ve ".." olmaz.');
  if (l.length > YOKSAY_SINIR) throw hata(400, `Yok sayma listesi en çok ${YOKSAY_SINIR} ad olabilir (gelen: ${l.length}).`);
  // server_hub_ayarlar.deger NVARCHAR(256): sessiz kirpma olmasin.
  if (l.join(',').length > 256) throw hata(400, `Yok sayma listesi virgüllerle birlikte en çok 256 karakter olabilir (gelen: ${l.join(',').length}).`);
  if (T(aciklama).length < 3) throw hata(400, 'Gerekçe zorunlu: yok sayılan girdi bulgu ve etiket üretmez.');
  return yaz('liste:kok_yoksay', l.join(','), YOKSAY_VARSAYILAN_METIN, aciklama, kim);
}

async function gecmis(n = 100) {
  const { rows } = await db().query(
    `SELECT TOP ${Math.max(1, Math.min(500, Number(n) || 100))} anahtar, eski, yeni, aciklama, degistiren, zaman
       FROM server_hub_ayar_gecmisi ORDER BY id DESC`,
  );
  return (rows || []).map((r) => ({
    anahtar: r.anahtar,
    eski: r.eski,
    yeni: r.yeni,
    aciklama: r.aciklama || '',
    degistiren: r.degistiren,
    zaman: r.zaman ? new Date(r.zaman).toISOString() : null,
  }));
}

module.exports = {
  LIMITLER,
  oku,
  limit,
  seviyeYaz,
  limitYaz,
  etiketYaz,
  kokYoksayYaz,
  yoksayNormal,
  gecmis,
  onbellekSil,
  satirlardan,
};
