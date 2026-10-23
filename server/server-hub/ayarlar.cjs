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
'use strict';

const { KODLAR, SEVIYELER } = require('./kural-katalogu.cjs');

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
    varsayilan: 50,
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

module.exports = { LIMITLER, oku, limit, seviyeYaz, limitYaz, gecmis, onbellekSil, satirlardan };
