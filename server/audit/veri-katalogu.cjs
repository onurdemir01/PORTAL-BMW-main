// server/audit/veri-katalogu.cjs - Denetim > "Veri Katalogu" sekmesi (2026-11-13).
//
// Kullanici: "veritabanindaki her bir tablonun hangi job veya portal isi tarafindan ne amacla
// kullanildigini yaz; artik cok fazla playbook, portal isi ve tablo olustu".
//
// KAYNAK: server/katalog/tablolar.json (elle bakilan katalog; bkz. docs/VERI-KATALOGU.md).
// Uc katalogu CANLI bilgiyle birlestirir (SALT OKUNUR):
//   - Portal DB ve TBMWANS icin tablo basina satir sayisi + ayrilmis alan (MB): veritabani basina
//     TEK ucuz sorgu (sys.tables + sys.dm_db_partition_stats). VIEW DATABASE STATE izni yoksa
//     sys.partitions'a duser: satir sayisi gelir, boyut gelmez (boyutVar=false).
//   - SAPMA: veritabaninda olup katalogda olmayan tablolar ("katalogda yok") ve katalogda olup
//     veritabaninda bulunmayanlar ("veritabaninda yok").
//
// KURALLAR
//   - Bir veritabani okunamazsa sayfa DUSMEZ: o DB icin hata doner, katalog yine gosterilir;
//     o DB'nin tablolarinin durumu 'bilinmiyor' olur ve sapma o DB icin HESAPLANMAZ
//     (okunamayan DB'yi "tablo yok" saymak yanlis alarm olurdu).
//   - Portal tablolari kurulumda TBMWANS ile AYNI fiziksel veritabaninda durabilir
//     (.env.example PORTAL_DB_DATABASE=TBMWANS). Iki havuz ayni sunucu+veritabanini gosteriyorsa
//     sapma birlesik hesaplanir: aksi halde her TBMWANS tablosu Portal icin "katalogda yok" cikardi.
//   - Biri okunamazsa "ayni fiziksel mi" BILINEMEZ (havuzlar ayri dusebilir). O zaman okunan DB'nin
//     "katalogda yok" listesi iki katalogun BIRLESIMINE gore suzulur ve sapmaKismi=true doner: aksi
//     halde ayni fiziksel DB'deki ~66 TBMWANS (ya da ~120 Portal) tablosu yanlis alarm olurdu.
//   - Onbellek 10 dk, tek ucus; ?fresh=1 onbellegi atlar (suren hesap varsa onu bekler).
//     Bir DB hata verdiyse sonuc yalniz 1 dk tutulur (gecici hata 10 dk yapismasin).
//   - Zaman asimi: veritabani basina kisa (varsayilan 15 sn); uzun havuz KULLANILMAZ.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KATALOG_YOLU = path.join(__dirname, '..', 'katalog', 'tablolar.json');

const VERITABANLARI = ['Portal', 'TBMWANS'];
// Alan adlari sayfada gruplama icin SABIT liste. Yeni alan gerekiyorsa buraya da eklenir
// (bekci: server/audit/__tests__/veri-katalogu-bekci.test.cjs).
const ALANLAR = [
  'AI Analist',
  'Ansible / AWX',
  'App Hub',
  'Ayarlar',
  'BMW Hub',
  'Crypto Hub',
  'Denetim',
  'Envanter',
  'Eski / Arşiv',
  'Kimlik / Oturum',
  'LogX',
  'Nginx Denetim',
  'OCO',
  'OpenShift',
  'OpsX',
  'Retirement',
  'ScaleX',
  'Self Servis',
  'Sertifika',
  'Server Hub',
  'Smart',
  'Yük Testi',
];
const YAZAN_TURLERI = ['portal', 'playbook', 'betik', 'bilinmiyor'];
const GUVENLER = ['KESIN', 'MAKUL'];

const ONBELLEK_MS = 10 * 60 * 1000;
const HATALI_ONBELLEK_MS = 60 * 1000;
const ZAMAN_ASIMI_MS = 15 * 1000;

// Ayni sorgu iki DB'de de kosar. DB_NAME / sunucu adi her satirda: ayri bir sorgu gerekmesin.
const SQL_BOYUTLU = `SELECT DB_NAME() AS db_adi,
       CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS sunucu,
       s.name AS sema, t.name AS tablo,
       SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END) AS satir,
       SUM(ps.reserved_page_count) AS sayfa
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id = t.object_id
 WHERE t.is_ms_shipped = 0
 GROUP BY s.name, t.name`;
const SQL_SATIRLI = `SELECT DB_NAME() AS db_adi,
       CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS sunucu,
       s.name AS sema, t.name AS tablo,
       SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS satir
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  LEFT JOIN sys.partitions p ON p.object_id = t.object_id
 WHERE t.is_ms_shipped = 0
 GROUP BY s.name, t.name`;

const IZIN_HATASI = /permission|VIEW DATABASE STATE|VIEW SERVER STATE|denied|izin/i;

function zamanla(p, ms, ad) {
  let t = null;
  const zaman = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${ad}: ${Math.round(ms / 1000)} sn içinde yanıt gelmedi`)), ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
  return Promise.race([Promise.resolve().then(p), zaman]).finally(() => clearTimeout(t));
}

/** Tek DB'nin canli tablo istatistigi. Hata firlatmaz: { ok:false, hata } doner. */
async function canliOku(ad, sorgu, zamanAsimiMs) {
  if (typeof sorgu !== 'function') return { ok: false, hata: 'bağlantı tanımlı değil' };
  try {
    let boyutVar = true;
    let r;
    try {
      r = await zamanla(() => sorgu(SQL_BOYUTLU), zamanAsimiMs, ad);
    } catch (e) {
      if (!IZIN_HATASI.test(String((e && e.message) || e))) throw e;
      boyutVar = false;
      r = await zamanla(() => sorgu(SQL_SATIRLI), zamanAsimiMs, ad);
    }
    const rows = (r && r.recordset) || [];
    const ilk = rows[0] || {};
    return {
      ok: true,
      boyutVar,
      dbAdi: ilk.db_adi != null ? String(ilk.db_adi) : null,
      sunucu: ilk.sunucu != null ? String(ilk.sunucu) : null,
      tablolar: rows.map((x) => ({
        sema: String(x.sema || 'dbo'),
        tablo: String(x.tablo || ''),
        satir: x.satir == null ? null : Number(x.satir),
        mb: boyutVar && x.sayfa != null ? Math.round((Number(x.sayfa) * 8) / 1024 * 100) / 100 : null,
      })).filter((x) => x.tablo),
    };
  } catch (e) {
    return { ok: false, hata: String((e && e.message) || e || 'bilinmeyen hata') };
  }
}

const anahtar = (sema, tablo) =>
  (String(sema || 'dbo').toLowerCase() === 'dbo' ? '' : `${String(sema).toLowerCase()}.`) + String(tablo).toLowerCase();

/**
 * Saf hesap: katalog + iki DB'nin canli okumasi -> yanit govdesi.
 * canli: { Portal: canliOku(...) sonucu, TBMWANS: ... }
 */
function katalogDurumu(katalog, canli, simdi = new Date()) {
  const kimlik = (c) => (c && c.ok && c.dbAdi ? `${String(c.sunucu || '').toLowerCase()}|${c.dbAdi.toLowerCase()}` : null);
  const kP = kimlik(canli.Portal);
  const kT = kimlik(canli.TBMWANS);
  const ayniFiziksel = !!(kP && kT && kP === kT);

  const haritalar = {};
  for (const db of VERITABANLARI) {
    const c = canli[db];
    if (!c || !c.ok) continue;
    haritalar[db] = new Map(c.tablolar.map((t) => [anahtar(t.sema, t.tablo), t]));
  }

  const tablolar = katalog.map((g) => {
    const h = haritalar[g.db];
    const t = h ? h.get(anahtar('dbo', String(g.tablo).replace(/^dbo\./i, ''))) : null;
    return {
      ...g,
      durum: !h ? 'bilinmiyor' : t ? 'var' : 'yok',
      satir: t ? t.satir : null,
      mb: t ? t.mb : null,
    };
  });

  // Katalogdaki adlar, fiziksel veritabanina gore. Ayni fizikselse iki DB'nin girdileri birlesir.
  const katalogAdlari = (dbler) =>
    new Set(katalog.filter((g) => dbler.includes(g.db)).map((g) => anahtar('dbo', String(g.tablo).replace(/^dbo\./i, ''))));
  const katalogdaYok = [];
  // Biri okunamadiysa fiziksellik bilinmiyor: okunan DB'yi iki katalogun birlesimiyle suz.
  const sapmaKismi = !(canli.Portal && canli.Portal.ok) || !(canli.TBMWANS && canli.TBMWANS.ok);
  const gruplar = ayniFiziksel ? [{ etiket: 'Portal + TBMWANS', kaynak: 'TBMWANS', dbler: VERITABANLARI }]
    : VERITABANLARI.map((db) => ({ etiket: db, kaynak: db, dbler: sapmaKismi ? VERITABANLARI : [db] }));
  for (const gr of gruplar) {
    const c = canli[gr.kaynak];
    if (!c || !c.ok) continue;
    const adlar = katalogAdlari(gr.dbler);
    for (const t of c.tablolar) {
      if (adlar.has(anahtar(t.sema, t.tablo))) continue;
      katalogdaYok.push({
        db: gr.etiket,
        tablo: String(t.sema).toLowerCase() === 'dbo' ? t.tablo : `${t.sema}.${t.tablo}`,
        satir: t.satir,
        mb: t.mb,
      });
    }
  }
  katalogdaYok.sort((a, b) => a.db.localeCompare(b.db) || a.tablo.localeCompare(b.tablo, 'tr'));

  const veritabanindaYok = tablolar
    .filter((t) => t.durum === 'yok')
    .map((t) => ({ db: t.db, tablo: t.tablo, alan: t.alan, kullanilmiyor: !!t.kullanilmiyor }));

  const veritabanlari = VERITABANLARI.map((db) => {
    const c = canli[db] || { ok: false, hata: 'okunmadı' };
    const katalogSayisi = katalog.filter((g) => g.db === db).length;
    if (!c.ok) return { db, ok: false, hata: c.hata, katalogSayisi };
    const toplamMb = c.boyutVar ? Math.round(c.tablolar.reduce((a, t) => a + (t.mb || 0), 0) * 100) / 100 : null;
    return {
      db,
      ok: true,
      dbAdi: c.dbAdi,
      boyutVar: c.boyutVar,
      tabloSayisi: c.tablolar.length,
      toplamMb,
      katalogSayisi,
      ayniFiziksel,
    };
  });

  return {
    ok: true,
    hesaplandi: simdi.toISOString(),
    ayniFiziksel,
    sapmaKismi,
    veritabanlari,
    tablolar,
    sapma: { katalogdaYok, veritabanindaYok },
    secenekler: { veritabanlari: VERITABANLARI, alanlar: ALANLAR, yazanTurleri: YAZAN_TURLERI, guvenler: GUVENLER },
  };
}

function katalogOku(yol = KATALOG_YOLU) {
  const j = JSON.parse(fs.readFileSync(yol, 'utf8'));
  if (!Array.isArray(j)) throw new Error('katalog bir dizi değil');
  return j;
}

/**
 * Onbellekli + tek ucuslu hesap. deps disaridan verilebilir (testler sahte DB verir).
 *   portalSorgu(sql) / tbmwansSorgu(sql) -> { recordset }
 */
function createVeriKatalogu({
  portalSorgu,
  tbmwansSorgu,
  katalogYukle = () => katalogOku(),
  simdi = () => Date.now(),
  onbellekMs = ONBELLEK_MS,
  hataliOnbellekMs = HATALI_ONBELLEK_MS,
  zamanAsimiMs = ZAMAN_ASIMI_MS,
} = {}) {
  let son = null; // { at, ttl, govde }
  let ucus = null;

  async function hesapla() {
    const katalog = katalogYukle();
    const [p, t] = await Promise.all([
      canliOku('Portal DB', portalSorgu, zamanAsimiMs),
      canliOku('TBMWANS', tbmwansSorgu, zamanAsimiMs),
    ]);
    const govde = katalogDurumu(katalog, { Portal: p, TBMWANS: t }, new Date(simdi()));
    const hatali = !p.ok || !t.ok;
    son = { at: simdi(), ttl: hatali ? hataliOnbellekMs : onbellekMs, govde };
    return govde;
  }

  async function sonuc(taze = false) {
    if (ucus) return ucus;
    if (!taze && son && simdi() - son.at < son.ttl) return son.govde;
    ucus = hesapla().finally(() => {
      ucus = null;
    });
    return ucus;
  }

  return { sonuc, _sifirla: () => { son = null; } };
}

function varsayilanBagimliliklar() {
  return {
    portalSorgu: async (sqlText) => {
      const pool = await require('../db/portal-mssql.cjs').getPool();
      if (!pool) throw new Error('Portal DB bağlantısı yok');
      return pool.request().query(sqlText);
    },
    tbmwansSorgu: (sqlText) => require('../inventory/mssql.cjs').query(sqlText),
  };
}

function registerVeriKatalogu(router, deps = null) {
  const vk = createVeriKatalogu(deps || varsayilanBagimliliklar());
  router.get('/veri-katalogu', async (req, res) => {
    try {
      const govde = await vk.sonuc(String(req.query.fresh || '') === '1');
      res.json(govde);
    } catch (err) {
      res.status(500).json({ ok: false, message: (err && err.message) || 'Veri kataloğu okunamadı.' });
    }
  });
  return vk;
}

module.exports = {
  registerVeriKatalogu,
  createVeriKatalogu,
  katalogDurumu,
  katalogOku,
  canliOku,
  KATALOG_YOLU,
  VERITABANLARI,
  ALANLAR,
  YAZAN_TURLERI,
  GUVENLER,
};
