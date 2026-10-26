'use strict';
// server/ansible/ss-erisim.cjs - Self Service otomasyonlarinda ekip bazli erisim (2026-10-26).
//
// Kullanici: "bazi playbooklari sadece bazi ekiplere acabilmek istiyoruz ... default olarak
// eklenen servisler kullanicilara kapali gelsin, istersek bazi ekiplere, istersek tum ekiplere
// acalim. Tek bir ekip olmayabilir." Ayar admin panelinde degil, otomasyonun "Alanlari Yonet"
// penceresinde yapilir.
//
// UC DURUM (admin her durumda gorur ve calistirir - portalin "admin her seyi gorur" kurali):
//   kapali   yalniz yoneticiler (yeni servisin varsayilani)
//   ekipler  yalniz secilen LDAP gruplarinin uyeleri (bir ya da birden fazla grup)
//   herkes   tum portal kullanicilari
//
// KAYIT: `enabled` ana anahtar olarak kalir (kapali <=> enabled=0); `access_mode` ekipler /
// herkes ayrimini, `access_groups` (JSON dizi) gruplari tutar. Bu ozellikten ONCEKI kayitlarda
// access_mode NULL'dir: enabled=1 ise "herkes" sayilir, yani bugun acik olan servis acik kalir.
//
// FAIL-CLOSED: bilinmeyen bir mod ya da okunamayan grup listesi KIMSEYE acmaz (admin haric).
// Eslesme `groupKeysOf` (server/auth/visibility.cjs) ile ayni tolerans: kayit tam DN ise tam
// DN, yalin ad (CN) ise o CN'ye sahip her grup eslesir. Ic ice (nested) grup uyeligi cozulmez:
// oturumdaki `memberOf` yalniz dogrudan uyelikleri tasir.

const MODLAR = ['kapali', 'ekipler', 'herkes'];
const GRUP_TAVAN = 50;
const GRUP_UZUNLUK = 500;

// DN'ler kaynaga gore buyuk/kucuk harf ve virgul cevresindeki bosluk acisindan degisebiliyor.
function grupAnahtari(g) {
  return String(g == null ? '' : g)
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',');
}

function kullaniciGrupAnahtarlari(user) {
  const out = new Set();
  for (const g of Array.isArray(user && user.groups) ? user.groups : []) {
    const dn = grupAnahtari(g);
    if (!dn) continue;
    out.add(dn);
    const m = /^cn=([^,]+)/.exec(dn);
    if (m) out.add(m[1].trim());
  }
  return out;
}

function ssErisimModu(item) {
  if (!item || !item.enabled) return 'kapali';
  const m = item.accessMode;
  if (m === undefined || m === null || m === '') return 'herkes';
  if (m === 'herkes' || m === 'ekipler') return m;
  return 'kapali';
}

function ssErisimVar(item, user) {
  if (user && user.role === 'Admin') return true;
  const mod = ssErisimModu(item);
  if (mod === 'herkes') return true;
  if (mod !== 'ekipler') return false;
  const izinli = Array.isArray(item.accessGroups) ? item.accessGroups : [];
  if (!izinli.length) return false;
  const anahtarlar = kullaniciGrupAnahtarlari(user);
  if (!anahtarlar.size) return false;
  return izinli.some((g) => {
    const k = grupAnahtari(g);
    return !!k && anahtarlar.has(k);
  });
}

// DB satirindaki access_groups -> dizi. Okunamazsa null: ssErisimVar bunu "kimse" sayar.
function grupListesiOku(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((g) => String(g == null ? '' : g)).filter((g) => g.trim()) : null;
  } catch {
    return null;
  }
}

// Admin'in gonderdigi { mode, groups } -> kaydedilecek alanlar ya da { hata }.
function ssErisimDogrula(govde) {
  const mode = String((govde && govde.mode) || '').trim();
  if (!MODLAR.includes(mode)) return { hata: 'Geçersiz erişim türü (kapali | ekipler | herkes).' };
  const ham = govde && govde.groups;
  if (ham !== undefined && !Array.isArray(ham)) return { hata: 'Ekip listesi bir dizi olmalı.' };
  const groups = [];
  const gorulen = new Set();
  for (const g of ham || []) {
    if (typeof g !== 'string') return { hata: 'Ekip adı metin olmalı.' };
    const t = g.trim();
    if (!t) continue;
    if (t.length > GRUP_UZUNLUK) return { hata: `Ekip adı en fazla ${GRUP_UZUNLUK} karakter olabilir.` };
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) return { hata: 'Ekip adında kontrol karakteri olamaz.' };
    const k = grupAnahtari(t);
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    groups.push(t);
  }
  if (groups.length > GRUP_TAVAN) return { hata: `En fazla ${GRUP_TAVAN} ekip seçilebilir.` };
  if (mode === 'ekipler' && !groups.length) return { hata: 'En az bir ekip (LDAP grubu) seçin.' };
  return { enabled: mode !== 'kapali', accessMode: mode, accessGroups: groups };
}

// GET /ss/items yaniti: admin TUM kayitlari erisim ayariyla gorur; digerleri yalniz erisebildigi
// servisleri, grup listesi olmadan (hangi ekiplerin acik oldugu kullanicinin isi degil).
function ssKullaniciListesi(items, user) {
  const liste = Array.isArray(items) ? items : [];
  if (user && user.role === 'Admin') return liste;
  return liste
    .filter((i) => ssErisimVar(i, user))
    .map((i) => {
      const kopya = { ...i };
      delete kopya.accessMode;
      delete kopya.accessGroups;
      delete kopya.accessGroupsBozuk;
      return kopya;
    });
}

module.exports = {
  MODLAR,
  GRUP_TAVAN,
  ssErisimModu,
  ssErisimVar,
  ssErisimDogrula,
  ssKullaniciListesi,
  grupListesiOku,
  _grupAnahtari: grupAnahtari,
  _kullaniciGrupAnahtarlari: kullaniciGrupAnahtarlari,
};
