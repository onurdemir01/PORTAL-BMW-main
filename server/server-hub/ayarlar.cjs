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

/** Tek anahtari yazar; varsayilana donuyorsa satiri siler. Gecmise eski -> yeni yazilir. */
async function yaz(anahtar, yeni, varsayilan, aciklama, kim) {
  const simdiki = await oku(true);
  if (simdiki.okunamadi) throw hata(503, `Server Hub ayarları okunamadı: ${simdiki.hata}`);
  const eski = simdiki.kayitlar[anahtar] ? simdiki.kayitlar[anahtar].deger : String(varsayilan);
  const not = T(aciklama).slice(0, 500) || null;
  // Degismeyen deger yazilmaz ve gecmise satir dusmez.
  if (String(yeni) === eski) return { anahtar, eski, yeni: eski, degismedi: true, varsayilan: eski === String(varsayilan) };
  if (String(yeni) === String(varsayilan)) {
    await db().query(`DELETE FROM server_hub_ayarlar WHERE anahtar = $1`, [anahtar]);
  } else {
    const upd = await db().query(
      `UPDATE server_hub_ayarlar SET deger = $1, aciklama = $2, updated_by = $3, updated_at = GETUTCDATE() WHERE anahtar = $4`,
      [String(yeni), not, kim, anahtar],
    );
    if (!upd.rowCount)
      await db().query(
        `INSERT INTO server_hub_ayarlar (anahtar, deger, aciklama, updated_by) VALUES ($1, $2, $3, $4)`,
        [anahtar, String(yeni), not, kim],
      );
  }
  await db().query(
    `INSERT INTO server_hub_ayar_gecmisi (anahtar, eski, yeni, aciklama, degistiren) VALUES ($1, $2, $3, $4, $5)`,
    [anahtar, eski, String(yeni), not, kim],
  );
  onbellekSil();
  return { anahtar, eski, yeni: String(yeni), varsayilan: String(yeni) === String(varsayilan) };
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
