// server/server-hub/ear-envanter-ayar.cjs - Uygulama Envanteri ayarlari (2026-11-04).
//
// Kullanici: "her seferinde taranmasin butun sunuculari haftalik olarak tarasin otomatik istenirse
// elle de calistirilabilsin". Haftalik zamanlayici, parti boyutlari, okuma kimligi, kokler ve saklama
// suresi kaynak koda dokunmadan Admin ekranindan degisir.
//
// DEPO: Portal DB ear_envanter_ayarlar (anahtar -> deger). server-hub/ayarlar.cjs deseni: yalniz
// VARSAYILANDAN FARKLI satir tutulur (kodun varsayilani degisirse eski satir onu sessizce ezmesin);
// okunamazsa varsayilanlar uygulanir ve bu GIZLENMEZ (okunamadi=true, ekran soyler).
//
// ZAMANLAYICI VARSAYILANI KAPALI: AWX template'i girildigi an 1000+ sunucuda TAM tarama baslamasin.
// Akis: template -> 1-5 sunucuyla elle pilot -> Admin haftalik taramayi acar.
//
// SAAT: Turkiye 2016'dan beri sabit UTC+3 (yaz saati yok); hesap UTC uzerinden +3 ile yapilir,
// sunucunun TZ ayarina bagli degildir.
'use strict';

const TR_OFSET_MS = 3 * 60 * 60 * 1000;
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
// Kacirilan zamanlama (Portal kapaliydi) en gec bu kadar sonra yine baslar; sonrasi bir sonraki hafta.
const TELAFI_MS = 24 * 60 * 60 * 1000;

const tamSayi = (min, max) => (v) => {
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
};
const secenek = (liste) => (v) => (liste.includes(String(v).trim()) ? String(v).trim() : null);

/** Kok listesi: mutlak yollar, ':' ayracli, en cok 4, '..' yok (playbook regex'inin ust kumesi degil, alt kumesi). */
function kokDogrula(v) {
  const s = String(v).trim();
  const parcalar = s.split(':');
  if (!s || parcalar.length > 4) return null;
  for (const p of parcalar)
    if (!/^\/[A-Za-z0-9._/-]{1,120}$/.test(p) || p.split('/').includes('..')) return null;
  return s;
}

const AYARLAR = Object.freeze({
  zamanlayici: {
    ad: 'Haftalık tarama',
    varsayilan: 'KAPALI',
    dogrula: secenek(['ACIK', 'KAPALI']),
  },
  gun: { ad: 'Gün (0 Pazar … 6 Cumartesi)', varsayilan: '0', dogrula: tamSayi(0, 6) },
  saat: {
    ad: 'Saat (TR, SS:DD)',
    varsayilan: '02:00',
    dogrula: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v).trim()) ? String(v).trim() : null),
  },
  kip: { ad: 'Haftalık taramanın kipi', varsayilan: 'TAM', dogrula: secenek(['OZET', 'TAM']) },
  // Ust sinir 100: playbook'un ear_parti_siniri varsayilani. Daha buyuk parti AWX olay tablosunu ve
  // bellegi sisirir; filo partilere bolunur ve partiler SIRAYLA kosar.
  parti_ozet: { ad: 'ÖZET parti boyutu', varsayilan: '100', dogrula: tamSayi(1, 100) },
  parti_tam: { ad: 'TAM parti boyutu', varsayilan: '50', dogrula: tamSayi(1, 100) },
  okuma_kullanicisi: {
    ad: 'Okuma kimliği (dzdo)',
    varsayilan: 'was',
    dogrula: (v) =>
      /^([a-z_][a-z0-9_-]{0,31})?$/.test(String(v).trim()) ? String(v).trim() : null,
  },
  kokler: { ad: 'Taranan kökler', varsayilan: '/vhosting:/vhosting8', dogrula: kokDogrula },
  // DB: son N FILO kosusu (ve onlardan yeni secili kosular). /sw: son N TAM kosusunun ham dosyalari
  // (agac goruntuleyici ve ZIP bunlari okur).
  saklama_kosu: { ad: "DB'de tutulan filo koşusu", varsayilan: '12', dogrula: tamSayi(2, 52) },
  saklama_ham: { ad: "/sw'de tutulan TAM koşusu", varsayilan: '3', dogrula: tamSayi(1, 10) },
});

const TTL_MS = 30 * 1000;
let _cache = { at: 0, value: null };
const onbellekSil = () => {
  _cache = { at: 0, value: null };
};
const db = () => require('../db/index.cjs');

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function varsayilanlar() {
  return Object.fromEntries(Object.entries(AYARLAR).map(([k, v]) => [k, v.varsayilan]));
}

/** DB satirlari -> ayar nesnesi. Gecersiz / bilinmeyen satir yok sayilir (varsayilan gecerli kalir). */
function satirlardan(rows) {
  const deger = varsayilanlar();
  const kayitlar = {};
  for (const r of rows || []) {
    const a = AYARLAR[String(r.anahtar || '').trim()];
    if (!a) continue;
    const d = a.dogrula(r.deger == null ? '' : r.deger);
    if (d == null) continue;
    deger[r.anahtar] = d;
    kayitlar[r.anahtar] = {
      updatedBy: r.updated_by || null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  }
  return { deger, kayitlar, okunamadi: false, hata: '' };
}

async function oku(fresh = false) {
  if (!fresh && _cache.value && Date.now() - _cache.at < TTL_MS) return _cache.value;
  try {
    const { rows } = await db().query(
      `SELECT anahtar, deger, updated_by, updated_at FROM ear_envanter_ayarlar`,
    );
    const value = satirlardan(rows);
    _cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    return {
      deger: varsayilanlar(),
      kayitlar: {},
      okunamadi: true,
      hata: err.message || 'okunamadı',
    };
  }
}

/** Tek ayar yazar; varsayilana donen deger satiri siler. Donus: { anahtar, eski, yeni }. */
async function yaz(anahtar, deger, kim) {
  const a = AYARLAR[String(anahtar || '').trim()];
  if (!a)
    throw hata(
      400,
      `Bilinmeyen ayar: ${String(anahtar || '(boş)').slice(0, 40)}`,
      'bilinmeyen_ayar',
    );
  const d = a.dogrula(deger == null ? '' : deger);
  if (d == null)
    throw hata(
      400,
      `${a.ad} için geçersiz değer: ${String(deger ?? '').slice(0, 60) || '(boş)'}`,
      'gecersiz_ayar',
    );
  const simdiki = await oku(true);
  if (simdiki.okunamadi)
    throw hata(424, `Uygulama Envanteri ayarları okunamadı: ${simdiki.hata}`, 'ayar_okunamadi');
  const eski = simdiki.deger[anahtar];
  if (d === a.varsayilan) {
    await db().query(`DELETE FROM ear_envanter_ayarlar WHERE anahtar = $1`, [anahtar]);
  } else {
    await db().query(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
       UPDATE ear_envanter_ayarlar WITH (UPDLOCK, HOLDLOCK)
          SET deger = $2, updated_by = $3, updated_at = SYSUTCDATETIME()
        WHERE anahtar = $1;
       IF @@ROWCOUNT = 0
         INSERT INTO ear_envanter_ayarlar (anahtar, deger, updated_by) VALUES ($1, $2, $3);
       COMMIT;`,
      [anahtar, d, String(kim || 'unknown').slice(0, 128)],
    );
  }
  onbellekSil();
  return { anahtar, eski, yeni: d };
}

// ── ZAMANLAMA ───────────────────────────────────────────────────────────────────────────────────

/** Ayardaki haftalik zamanin `simdi`den once gelen en son ornegi (UTC Date). */
function sonZamanlama(ayar, simdi = new Date()) {
  const gun = Number(ayar.gun);
  const [ss, dd] = String(ayar.saat).split(':').map(Number);
  const yerel = new Date(simdi.getTime() + TR_OFSET_MS);
  for (let geri = 0; geri <= 7; geri++) {
    const g = new Date(
      Date.UTC(yerel.getUTCFullYear(), yerel.getUTCMonth(), yerel.getUTCDate() - geri, ss, dd),
    );
    if (g.getUTCDay() !== gun) continue;
    const utc = new Date(g.getTime() - TR_OFSET_MS);
    if (utc.getTime() <= simdi.getTime()) return utc;
  }
  return null;
}

/** Bir sonraki haftalik zaman (UTC Date); zamanlayici kapaliysa null. */
function sonrakiZamanlama(ayar, simdi = new Date()) {
  if (ayar.zamanlayici !== 'ACIK') return null;
  const son = sonZamanlama(ayar, simdi);
  return son ? new Date(son.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
}

/**
 * Su an baslatilmasi gereken haftalik kosunun anahtari (H-YYYY-MM-DD, TR tarihi) ya da null.
 * Zaman gelmis ve en gec TELAFI_MS gecmisse anahtar doner; ayni anahtarla ikinci kosu acilmaz
 * (DB tarafi: ear_envanter_kosulari.zamanlayici_anahtari, kosuOlustur'un kosulu).
 */
function bekleyenZamanlama(ayar, simdi = new Date()) {
  if (ayar.zamanlayici !== 'ACIK') return null;
  const son = sonZamanlama(ayar, simdi);
  if (!son || simdi.getTime() - son.getTime() > TELAFI_MS) return null;
  const yerel = new Date(son.getTime() + TR_OFSET_MS);
  return { anahtar: `H-${yerel.toISOString().slice(0, 10)}`, zaman: son };
}

function zamanlamaMetni(ayar) {
  return `${GUNLER[Number(ayar.gun)] || '?'} ${ayar.saat} (TR), ${ayar.kip === 'TAM' ? 'TAM' : 'ÖZET'} kip`;
}

module.exports = {
  AYARLAR,
  GUNLER,
  TELAFI_MS,
  oku,
  yaz,
  onbellekSil,
  satirlardan,
  varsayilanlar,
  kokDogrula,
  sonZamanlama,
  sonrakiZamanlama,
  bekleyenZamanlama,
  zamanlamaMetni,
};
