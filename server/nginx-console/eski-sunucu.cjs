// server/nginx-console/eski-sunucu.cjs - Nginx Hub: kapatilmis (eski) sunucularin gizlenmesi
// ve Admin temizligi (kullanici, 2026-11-12: "Nginx Hub'da silinmis ve artik var olmayan
// sunucularin verileri hala tablolarda duruyor").
//
// TANIM (kullanici onayi, 2026-11-12): bir sunucu ESKI sayilir, eger
//   (1) dbo.Inventory'de nginx_version'i dolu bir satiri YOKSA ve
//   (2) son NGINX_ESKI_SUNUCU_GUN (varsayilan 14) gunde HICBIR kaynak onu gormemis/taramamissa.
// Envanter okunamazsa (hata ya da bos sonuc) HICBIR sunucu eski sayilmaz (fail-closed); tarama
// kaynaklarindan biri okunamazsa da ayni sey olur (eksik sinyal "gorulmedi" diye okunmasin).
//
// "GORULME" SINYALLERI:
//   - dokum dosyasi mtime'i ve raw/_seen.json (fetch playbook'unun ulastigi an);
//   - TBMWANS tarama tablolarinda son N gunde satir (her tarama isinin temsilci tablosu:
//     Nginx_Audit_Hosts = nginx_audit, Nginx_Cis_Hosts = nginx_cis, NginxRateLimitInventory =
//     nginx_ratelimit_inventory, Nginx_Config_Audit / Nginx_Intranet_Audit / Nginx_Spa_Traffic =
//     nginx_config_audit). Audit_Servers/Locations/... ve Cis_Results ayni isin alt tablolaridir;
//     sinyal icin okunmaz (ayni host kumesi), yalniz temizlikte silinir;
//   - dbo.nginx_inventory (nginx_metadata her kosuda sifirdan yazar): source_last_update esik
//     icindeyse ya da okunamiyorsa (null / ayristirilamaz) sunucu GORULMUS sayilir.
//   nginx_hub_file_state.last_seen SINYAL DEGILDIR (yalniz degisiklikte guncellenir).
//
// GIZLEME: her Nginx Hub listesi `suzgec(req)` ile eski sunuculari dusurur ve yanita
// `eskiGizli` ({sayi, hostlar, gun}) yazar; `?eskiler=1` gizlemeyi kapatir.
//
// TEMIZLIK (yalniz Admin): aday listesi kaynak basina ne silinecegini sayar; silme aninda aday
// kumesi YENIDEN hesaplanir ve aday olmayan bir sunucu istenmisse HICBIR SEY silinmez (409).
// TBMWANS uretimde FULL recovery + AlwaysOn AG: tek dev DELETE yok - tablo basina, host basina
// `DELETE TOP (5000) ... WHERE host = @h` donguleri (her biri kendi kisa ifadesi), istek basina
// en fazla 50 sunucu ve 20000 satir; kalan varsa rapor edilir, Admin yeniden kosar. Dosyalar
// yalniz o sunucunun TUM DB satirlari silindikten sonra silinir (yarim kalan sunucu aday listesinde
// kalir). Paylasilan dosyalar (raw/_seen.json yalniz o anahtar, objects/ blob deposu) korunur.
// dbo.nginx_inventory ve dbo.Inventory'ye DOKUNULMAZ (baska islerin sahipligi).
'use strict';

const fs = require('fs');
const path = require('path');

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const TABLO_RE = /^(dbo\.)?[A-Za-z_][A-Za-z0-9_]*$/;
const PARCA = 5000;
const MAKS_HOST = 50;
const MAKS_SATIR = 20000;
const VARSAYILAN_GUN = 14;
const EN_AZ_GUN = 7;
const TTL_MS = 10 * 60 * 1000;
const HATA_TTL_MS = 60 * 1000;
const GUN_MS = 24 * 60 * 60 * 1000;
const ONAY_METINLERI = new Set(['SIL', 'S\u0130L']);

// TBMWANS (server/inventory/mssql.cjs). `sinyal`: son gorulme icin okunur.
const TBMWANS_TABLOLARI = Object.freeze([
  { tablo: 'dbo.Nginx_Audit_Hosts', sinyal: true },
  { tablo: 'dbo.Nginx_Audit_Servers', sinyal: false },
  { tablo: 'dbo.Nginx_Audit_Locations', sinyal: false },
  { tablo: 'dbo.Nginx_Audit_Upstreams', sinyal: false },
  { tablo: 'dbo.Nginx_Audit_Settings', sinyal: false },
  { tablo: 'dbo.Nginx_Audit_Files', sinyal: false },
  { tablo: 'dbo.Nginx_Cis_Hosts', sinyal: true },
  { tablo: 'dbo.Nginx_Cis_Results', sinyal: false },
  { tablo: 'dbo.NginxRateLimitInventory', sinyal: true },
  { tablo: 'dbo.Nginx_Config_Audit', sinyal: true },
  { tablo: 'dbo.Nginx_Intranet_Audit', sinyal: true },
  { tablo: 'dbo.Nginx_Spa_Traffic', sinyal: true },
]);
// Portal DB (server/db). nginx_cis_exceptions'ta host NULL = filo geneli: `host = $1` NULL'a
// hicbir zaman eslesmez, filo geneli istisna silinmez.
const PORTAL_TABLOLARI = Object.freeze([
  { tablo: 'nginx_hub_file_history' },
  { tablo: 'nginx_hub_file_state' },
  { tablo: 'nginx_audit_exceptions' },
  { tablo: 'nginx_cis_exceptions' },
]);
for (const t of [...TBMWANS_TABLOLARI, ...PORTAL_TABLOLARI]) {
  if (!TABLO_RE.test(t.tablo)) throw new Error('eski-sunucu: gecersiz tablo adi ' + t.tablo);
}

// Bagimliliklar (testler degistirir).
const _varsayilanBag = {
  tbmwans: () => require('../inventory/mssql.cjs'),
  portal: () => require('../db/index.cjs'),
  yerel: () => require('./index.cjs'),
  simdi: () => Date.now(),
};
let bag = { ..._varsayilanBag };

const norm = (h) =>
  String(h == null ? '' : h)
    .trim()
    .toUpperCase();

function esikGun() {
  const ham = process.env.NGINX_ESKI_SUNUCU_GUN;
  const n = Number(ham);
  if (ham == null || String(ham).trim() === '' || !Number.isInteger(n)) return VARSAYILAN_GUN;
  // Cok kucuk bir deger (yanlis ayar) canli sunuculari gizleyip temizlige aday yapardi.
  return Math.min(3650, Math.max(EN_AZ_GUN, n));
}

// Taze kumesine hem verilen ad hem kisa ad yazilir (guvenli yon): bir kaynak sunucuyu FQDN ile
// (gbngxp09.bmw.local), dokum/baska tablo kisa adla (GBNGXP09) tutuyorsa kisa ad da GORULMUS
// sayilmali; aksi halde canli sunucu eski sayilip temizlige aday olurdu (dogrulama bulgusu).
function tazeEkle(set, h) {
  const H = norm(h);
  if (!H) return;
  set.add(H);
  set.add(H.split('.')[0]);
}

const tabloYokMu = (e) => /Invalid object name/i.test(String((e && e.message) || ''));

// -- Sinyaller -------------------------------------------------------------------------

/** dbo.Inventory'deki nginx sunuculari. Hata ya da bos sonuc FIRLATIR (fail-closed). */
async function envanterOku(query) {
  const r = await query(
    `SELECT host FROM dbo.Inventory WHERE nginx_version IS NOT NULL AND LTRIM(RTRIM(nginx_version)) <> ''`,
  );
  const set = new Set();
  for (const x of (r && r.recordset) || []) {
    const h = norm(x.host);
    if (!h) continue;
    set.add(h);
    set.add(h.split('.')[0]); // FQDN yazilmissa kisa ad da envanterde sayilir (guvenli yon)
  }
  if (!set.size) throw new Error('dbo.Inventory nginx sunucusu dondurmedi');
  return set;
}

async function varOlanTablolar(query) {
  const adlar = [...TBMWANS_TABLOLARI.map((t) => t.tablo), 'dbo.nginx_inventory'];
  const r = await query(`SELECT ${adlar.map((t, i) => `OBJECT_ID('${t}') AS t${i}`).join(', ')}`);
  const satir = (r && r.recordset && r.recordset[0]) || {};
  const set = new Set();
  adlar.forEach((t, i) => {
    if (satir[`t${i}`] != null) set.add(t);
  });
  return set;
}

async function tazeTbmwans(query, sql, varOlan, esikMs) {
  const taze = new Set();
  const esikTarih = new Date(esikMs);
  esikTarih.setUTCHours(0, 0, 0, 0);
  for (const t of TBMWANS_TABLOLARI) {
    if (!t.sinyal || !varOlan.has(t.tablo)) continue;
    const r = await query(
      `SELECT DISTINCT UPPER(LTRIM(RTRIM(host))) AS host FROM ${t.tablo} WHERE scan_date >= @esik`,
      [{ name: 'esik', type: sql.Date, value: esikTarih }],
    );
    for (const x of (r && r.recordset) || []) if (x.host) tazeEkle(taze, x.host);
  }
  if (varOlan.has('dbo.nginx_inventory')) {
    const r = await query(`SELECT hostname, source_last_update FROM dbo.nginx_inventory`);
    for (const x of (r && r.recordset) || []) {
      const h = norm(x.hostname);
      if (!h) continue;
      const ms = x.source_last_update == null ? NaN : new Date(x.source_last_update).getTime();
      if (Number.isNaN(ms) || ms >= esikMs) tazeEkle(taze, h);
    }
  }
  return taze;
}

/** raw/ altindaki host dosyalari: HOST -> [dosya adi]. Dizin okunamazsa FIRLATIR. */
const DOSYA_RE = /^([A-Za-z0-9][A-Za-z0-9-]{1,62})\.(txt|summary\.json(\.tmp\d+)?)$/i;
function hostDosyaHaritasi(dizin) {
  const m = new Map();
  for (const ad of fs.readdirSync(dizin)) {
    const e = DOSYA_RE.exec(ad);
    if (!e) continue;
    const H = norm(e[1]);
    if (!m.has(H)) m.set(H, []);
    m.get(H).push(ad);
  }
  return m;
}

/** Yerel sinyaller: HOST -> son gorulme ms (dokum mtime, _seen.json). */
function yerelSinyaller() {
  const nc = bag.yerel();
  const dizin = nc.rawDir();
  // Dizin okunamiyorsa (mount yok) yerel sinyal BILINMIYOR: fail-closed.
  fs.readdirSync(dizin);
  const m = new Map();
  const koy = (h, ms) => {
    const H = norm(h);
    if (!H || !Number.isFinite(ms) || ms <= 0) return;
    m.set(H, Math.max(m.get(H) || 0, ms));
  };
  for (const d of nc.listDumpedHosts()) koy(d.host, Date.parse(d.dumpedAt));
  for (const [h, ms] of seenOku(dizin)) koy(h, ms);
  return m;
}

/**
 * raw/_seen.json -> [[host, ms]]. nc.seenMap() hatayi yutup bos harita doner; burada yutulmaz:
 * fetch playbook'u degismeyen dokumu yeniden yazmadigi icin dokum tarafindaki tek canlilik
 * sinyali bu dosyadir. Dosya YOKSA bos (eski davranis); VAR ama okunamiyor / ayristirilamiyorsa
 * (yarim yazim, izin) FIRLATIR -> hesap ok:false (fail-closed, hicbir sunucu eski sayilmaz).
 */
function seenOku(dizin) {
  const p = path.join(dizin, '_seen.json');
  let st;
  try {
    st = fs.statSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j || typeof j !== 'object') throw new Error('_seen.json beklenen bicimde degil');
  const atMs = j.at != null && !Number.isNaN(Date.parse(j.at)) ? Date.parse(j.at) : st.mtimeMs;
  const out = [];
  if (Array.isArray(j.hosts)) for (const h of j.hosts) out.push([h, atMs]);
  else if (j.hosts && typeof j.hosts === 'object')
    for (const [h, v] of Object.entries(j.hosts)) out.push([h, Date.parse(v)]);
  else if (j.hosts != null) throw new Error('_seen.json hosts alani beklenen bicimde degil');
  return out;
}

// -- Durum (onbellekli, tek ucus) -------------------------------------------------------
let _durum = null;
let _ucus = null;

async function hesapla() {
  const gun = esikGun();
  const simdi = bag.simdi();
  const esikMs = simdi - gun * GUN_MS;
  const temel = { gun, esik: new Date(esikMs).toISOString(), hesaplandi: new Date(simdi).toISOString() };
  try {
    // Uzun havuz: 14 gunluk tarama tablolarinda DISTINCT 30 sn'yi asabilir.
    const t = bag.tbmwans();
    const query = t.queryLong || t.query;
    const sql = t.sql;
    const envanter = await envanterOku(query);
    const varOlan = await varOlanTablolar(query);
    const taze = await tazeTbmwans(query, sql, varOlan, esikMs);
    const yerel = yerelSinyaller();
    for (const [h, ms] of yerel) if (ms >= esikMs) tazeEkle(taze, h);
    return { ok: true, ...temel, envanter, taze, yerel, varOlan };
  } catch (e) {
    console.warn('[NginxHub] eski sunucu hesabi yapilamadi, hicbir sunucu gizlenmez:', e && e.message);
    return { ok: false, ...temel, hata: String((e && e.message) || e) };
  }
}

/**
 * Eski sunucu durumu. `taze: true` onbellegi ve devam eden hesabi atlar (aday listesi, silme ani).
 * Liste uclari icin ESKIMIS-IKEN-SUN: suresi dolmus deger hemen doner, yenisi arka planda hesaplanir
 * (her 10 dk'da bir listeleme isteginin sinyal sorgularini beklememesi icin). Yalniz ilk hesap bekler.
 */
function ucusBaslat() {
  if (!_ucus) {
    _ucus = hesapla()
      .then((v) => {
        _durum = { at: bag.simdi(), v };
        return v;
      })
      .finally(() => {
        _ucus = null;
      });
  }
  return _ucus;
}
async function durum({ taze = false } = {}) {
  if (taze) {
    const v = await hesapla();
    _durum = { at: bag.simdi(), v };
    return v;
  }
  if (_durum) {
    if (bag.simdi() - _durum.at >= (_durum.v.ok ? TTL_MS : HATA_TTL_MS)) ucusBaslat().catch(() => {});
    return _durum.v;
  }
  return ucusBaslat();
}

/** Saf karar: durum + host -> eski mi. */
function eskiMi(d, host) {
  if (!d || !d.ok) return false;
  const H = norm(host);
  if (!H) return false;
  const kisa = H.split('.')[0];
  if (d.envanter.has(H) || d.envanter.has(kisa)) return false;
  return !d.taze.has(H) && !d.taze.has(kisa);
}

/**
 * Istek basina suzgec. `ayir(rows, anahtar)` eski sunucularin satirlarini dusurur ve hangilerinin
 * gizlendigini toplar; `bilgi()` yanita yazilacak ozet. Hesap HIC firlatmaz (fail-closed: gizleme yok).
 */
async function suzgec(req) {
  const goster = String((req && req.query && req.query.eskiler) || '') === '1';
  let d;
  try {
    d = await durum();
  } catch (e) {
    d = { ok: false, gun: esikGun(), hata: String((e && e.message) || e) };
  }
  const gizli = new Set();
  const gizle = (h) => {
    if (goster || !eskiMi(d, h)) return false;
    gizli.add(norm(h));
    return true;
  };
  return {
    // Onbellek anahtari icin: eski kumesi hesabi ya da gosterme kipi degisince degisir.
    damga: `${d.ok ? 1 : 0}|${d.hesaplandi || ''}|${goster ? 1 : 0}`,
    eskiMi: (h) => !goster && eskiMi(d, h),
    ayir(rows, anahtar = (r) => r && r.host) {
      if (!Array.isArray(rows) || goster || !d.ok) return rows;
      return rows.filter((r) => !gizle(anahtar(r)));
    },
    bilgi() {
      return {
        sayi: gizli.size,
        hostlar: [...gizli].sort().slice(0, 200),
        gun: d.gun,
        gosteriliyor: goster,
        olculemedi: !d.ok,
      };
    },
  };
}

// -- Temizlik dinleyicileri (denetim yanit onbellegi, CIS onbellegi ...) ------------------
const _dinleyiciler = new Set();
function onTemizlik(fn) {
  if (typeof fn === 'function') _dinleyiciler.add(fn);
}
function sifirla() {
  _durum = null;
  _ucus = null;
}
function temizlikBildir() {
  sifirla();
  for (const fn of _dinleyiciler) {
    try {
      fn();
    } catch (e) {
      console.warn('[NginxHub] temizlik dinleyicisi:', e && e.message);
    }
  }
}

// -- Aday listesi (Admin) --------------------------------------------------------------
async function adaylar() {
  const d = await durum({ taze: true });
  if (!d.ok) {
    throw Object.assign(
      new Error(
        'Envanter ya da tarama kaynakları okunamadı; hiçbir sunucu eski sayılmaz ve temizlik yapılmaz.',
      ),
      { status: 503, ayrinti: d.hata },
    );
  }
  const { queryLong, query, sql } = bag.tbmwans();
  const q = queryLong || query;
  const db = bag.portal();
  const nc = bag.yerel();
  const kayit = new Map();
  const al = (h) => {
    const H = norm(h);
    if (!kayit.has(H))
      kayit.set(H, { host: H, dosyalar: [], tbmwans: {}, portal: {}, sonMs: 0, sonTarama: null });
    return kayit.get(H);
  };
  for (const [H, adlar] of hostDosyaHaritasi(nc.rawDir())) al(H).dosyalar = adlar.sort();
  for (const [H, ms] of d.yerel) {
    const k = al(H);
    k.sonMs = Math.max(k.sonMs, ms);
  }
  for (const t of TBMWANS_TABLOLARI) {
    if (!d.varOlan.has(t.tablo)) continue;
    const r = await q(
      `SELECT UPPER(LTRIM(RTRIM(host))) AS host, COUNT_BIG(*) AS n, CONVERT(varchar(10), MAX(scan_date), 23) AS son
         FROM ${t.tablo} GROUP BY UPPER(LTRIM(RTRIM(host)))`,
    );
    for (const x of (r && r.recordset) || []) {
      if (!x.host) continue;
      const k = al(x.host);
      k.tbmwans[t.tablo] = Number(x.n) || 0;
      if (x.son && (!k.sonTarama || x.son > k.sonTarama)) k.sonTarama = String(x.son);
    }
  }
  for (const t of PORTAL_TABLOLARI) {
    try {
      const r = await db.query(
        `SELECT UPPER(LTRIM(RTRIM(host))) AS host, COUNT(*) AS n FROM ${t.tablo} WHERE host IS NOT NULL GROUP BY UPPER(LTRIM(RTRIM(host)))`,
      );
      for (const x of (r && r.rows) || []) {
        if (!x.host) continue;
        al(x.host).portal[t.tablo] = Number(x.n) || 0;
      }
    } catch (e) {
      if (!tabloYokMu(e)) throw e;
    }
  }
  const liste = [];
  for (const k of kayit.values()) {
    if (!HOST_RE.test(k.host) || !eskiMi(d, k.host)) continue;
    const toplam = (o) => Object.values(o).reduce((a, n) => a + n, 0);
    liste.push({
      host: k.host,
      sonGorulme: k.sonMs > 0 ? new Date(k.sonMs).toISOString() : null,
      sonTarama: k.sonTarama,
      dosyalar: k.dosyalar,
      tbmwans: k.tbmwans,
      portal: k.portal,
      toplamSatir: toplam(k.tbmwans) + toplam(k.portal),
    });
  }
  liste.sort((a, b) => a.host.localeCompare(b.host));
  return {
    gun: d.gun,
    esik: d.esik,
    hesaplandi: d.hesaplandi,
    sinirlar: { maksHost: MAKS_HOST, maksSatir: MAKS_SATIR, parca: PARCA },
    adaylar: liste,
  };
}

// -- Silme -----------------------------------------------------------------------------

/**
 * Tablo basina, host basina parcali silme; `butce` asilmaz. -> { silinen, bitti }
 * `normal: true`: aday sayimiyla AYNI ifade (UPPER(LTRIM(RTRIM(host))) = @h). Indeks kullanamaz;
 * yalniz duz `host = @h` gecisi sayimdan az sildiginde (bas bosluklu host satirlari) kosulur.
 */
async function parcaliSil(kaynak, tablo, H, butce, { normal = false } = {}) {
  if (!TABLO_RE.test(tablo) || !HOST_RE.test(H)) throw new Error('gecersiz tablo/host');
  let silinen = 0;
  for (let i = 0; i < 1000; i++) {
    const n = Math.min(PARCA, butce - silinen);
    if (n <= 0) return { silinen, bitti: false };
    let etkilenen;
    if (kaynak === 'tbmwans') {
      const { queryLong, query, sql } = bag.tbmwans();
      const metin = normal
        ? `DELETE TOP (@n) FROM ${tablo} WHERE UPPER(LTRIM(RTRIM(host))) = @h`
        : `DELETE TOP (@n) FROM ${tablo} WHERE host = @h`;
      const r = await (queryLong || query)(metin, [
        { name: 'n', type: sql.Int, value: n },
        { name: 'h', type: sql.NVarChar(64), value: H },
      ]);
      etkilenen = Number((r && r.rowsAffected && r.rowsAffected[0]) || 0);
    } else {
      const metin = normal
        ? `DELETE TOP (${n}) FROM ${tablo} WHERE UPPER(LTRIM(RTRIM(host))) = $1`
        : `DELETE TOP (${n}) FROM ${tablo} WHERE host = $1`;
      const r = await bag.portal().query(metin, [H], { tekrar: false });
      etkilenen = Number((r && r.rowCount) || 0);
    }
    silinen += etkilenen;
    if (etkilenen < n) return { silinen, bitti: true };
  }
  return { silinen, bitti: false };
}

/** Yalniz o host'un raw/ dosyalari; kati yol icerme kontrolu; sembolik bag / dizin silinmez. */
function hostDosyalariniSil(H) {
  if (!HOST_RE.test(H)) throw new Error('gecersiz host');
  const kok = path.resolve(bag.yerel().rawDir());
  const silinen = [];
  const atlanan = [];
  const adlar = hostDosyaHaritasi(kok).get(H) || [];
  for (const ad of adlar) {
    const tam = path.resolve(kok, ad);
    if (path.dirname(tam) !== kok || !tam.startsWith(kok + path.sep)) {
      atlanan.push(ad);
      continue;
    }
    const e = DOSYA_RE.exec(ad);
    if (!e || norm(e[1]) !== H) {
      atlanan.push(ad);
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(tam);
    } catch {
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink()) {
      atlanan.push(ad);
      continue;
    }
    fs.unlinkSync(tam);
    silinen.push(ad);
  }
  return { silinen, atlanan };
}

/** raw/_seen.json'dan yalniz bu host'un anahtari (atomik tmp + rename; hemen once yeniden okunur). */
function seenAnahtariniSil(H) {
  const kok = path.resolve(bag.yerel().rawDir());
  const p = path.join(kok, '_seen.json');
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return false;
  }
  if (!j || typeof j !== 'object') return false;
  let degisti = false;
  if (Array.isArray(j.hosts)) {
    const once = j.hosts.length;
    j.hosts = j.hosts.filter((h) => norm(h) !== H);
    degisti = j.hosts.length !== once;
  } else if (j.hosts && typeof j.hosts === 'object') {
    for (const k of Object.keys(j.hosts)) {
      if (norm(k) === H) {
        delete j.hosts[k];
        degisti = true;
      }
    }
  }
  if (!degisti) return false;
  const tmp = `${p}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(j));
  fs.renameSync(tmp, p);
  return true;
}

function istekDogrula(govde) {
  const b = govde || {};
  // Turkce Q klavyede Caps Lock ile 'SIL' yazilinca noktali I cikar (S + U+0130 + L); ikisi de gecer.
  if (!ONAY_METINLERI.has(typeof b.onay === 'string' ? b.onay.trim() : ''))
    return { hata: "Onay eksik: silmek için onay alanına 'SIL' yazılmalı.", status: 400 };
  const ham = Array.isArray(b.hosts) ? b.hosts : [];
  const hosts = [...new Set(ham.map(norm).filter(Boolean))];
  if (!hosts.length) return { hata: 'En az bir sunucu seçilmeli.', status: 400 };
  if (hosts.length > MAKS_HOST)
    return { hata: `Tek seferde en fazla ${MAKS_HOST} sunucu.`, status: 400 };
  const gecersiz = hosts.filter((h) => !HOST_RE.test(h));
  if (gecersiz.length)
    return { hata: `Geçersiz sunucu adı: ${gecersiz.slice(0, 5).join(', ')}`, status: 400 };
  return { hosts };
}

let _kilit = false;

/**
 * Temizlik. Doner: { hosts:[{host, silinenSatir, dosyalar, seen, hatalar, tamam, islenmedi}],
 * toplamSatir, butceDoldu, kalanVar }. Hata: status'lu Error (400/409/503).
 */
async function temizle(govde) {
  const v = istekDogrula(govde);
  if (v.hata) throw Object.assign(new Error(v.hata), { status: v.status });
  if (_kilit)
    throw Object.assign(new Error('Başka bir temizlik sürüyor; bitince yeniden deneyin.'), {
      status: 409,
    });
  _kilit = true;
  try {
    // SILME ANINDA YENIDEN KONTROL: ekran bayat olabilir (sunucu bu arada envantere donmus ya
    // da taranmis olabilir). Aday olmayan TEK bir sunucu bile varsa hicbir sey silinmez.
    const a = await adaylar();
    const harita = new Map(a.adaylar.map((x) => [x.host, x]));
    const red = v.hosts.filter((h) => !harita.has(h));
    if (red.length) {
      throw Object.assign(
        new Error(
          `Bu sunucular artık eski sunucu adayı değil (envanterde ya da son ${a.gun} günde taranmış); hiçbir şey silinmedi: ${red.join(', ')}`,
        ),
        { status: 409, reddedilen: red },
      );
    }
    let butce = MAKS_SATIR;
    let toplamSatir = 0;
    const sonuc = [];
    for (const H of v.hosts) {
      if (butce <= 0) {
        sonuc.push({ host: H, islenmedi: true, tamam: false, silinenSatir: {}, dosyalar: [], hatalar: [] });
        continue;
      }
      const aday = harita.get(H);
      const s = { host: H, silinenSatir: {}, dosyalar: [], seen: false, hatalar: [], tamam: false };
      let eksik = false;
      const isler = [
        ...PORTAL_TABLOLARI.map((t) => ['portal', t.tablo, aday.portal[t.tablo] || 0]),
        ...TBMWANS_TABLOLARI.map((t) => ['tbmwans', t.tablo, aday.tbmwans[t.tablo] || 0]),
      ].filter((x) => x[2] > 0);
      for (const [kaynak, tablo, beklenen] of isler) {
        if (butce <= 0) {
          eksik = true;
          break;
        }
        try {
          const r = await parcaliSil(kaynak, tablo, H, butce);
          let silinen = r.silinen;
          let bitti = r.bitti;
          // Sayim UPPER(LTRIM(RTRIM(host))) ile; duz esitlik bas bosluklu satirlari kacirir.
          // Eksik kaldiysa ayni ifadeyle ikinci gecis; yine eksikse sunucu TAMAM SAYILMAZ.
          if (bitti && silinen < beklenen && butce - silinen > 0) {
            const r2 = await parcaliSil(kaynak, tablo, H, butce - silinen, { normal: true });
            silinen += r2.silinen;
            bitti = r2.bitti;
          }
          s.silinenSatir[tablo] = silinen;
          butce -= silinen;
          toplamSatir += silinen;
          if (!bitti) eksik = true;
          else if (silinen < beklenen) {
            eksik = true;
            s.hatalar.push({
              tablo,
              mesaj: `Sayılan ${beklenen} satırın ${silinen} kadarı silinebildi; kalan satırlar silinmedi.`,
            });
          }
        } catch (e) {
          // Parametre/sifre degil; DB'nin hata metni (izin yok, zaman asimi ...).
          s.hatalar.push({ tablo, mesaj: String((e && e.message) || e).slice(0, 300) });
          eksik = true;
        }
      }
      if (!eksik) {
        try {
          const f = hostDosyalariniSil(H);
          s.dosyalar = f.silinen;
          if (f.atlanan.length) s.hatalar.push({ tablo: 'raw', mesaj: `atlanan dosya: ${f.atlanan.join(', ')}` });
          s.seen = seenAnahtariniSil(H);
          bag.yerel()._unutHost?.(H);
        } catch (e) {
          s.hatalar.push({ tablo: 'raw', mesaj: String((e && e.message) || e).slice(0, 300) });
        }
      }
      s.tamam = !eksik && s.hatalar.length === 0;
      sonuc.push(s);
    }
    return {
      gun: a.gun,
      hosts: sonuc,
      toplamSatir,
      butceDoldu: butce <= 0,
      kalanVar: sonuc.some((s) => !s.tamam),
      sinirlar: { maksHost: MAKS_HOST, maksSatir: MAKS_SATIR, parca: PARCA },
    };
  } finally {
    _kilit = false;
    temizlikBildir();
  }
}

module.exports = {
  durum,
  eskiMi,
  suzgec,
  adaylar,
  temizle,
  onTemizlik,
  sifirla,
  esikGun,
  TBMWANS_TABLOLARI,
  PORTAL_TABLOLARI,
  SINIRLAR: Object.freeze({ PARCA, MAKS_HOST, MAKS_SATIR }),
  _test: {
    bagla(over) {
      bag = { ..._varsayilanBag, ...over };
      sifirla();
    },
    sifirla() {
      bag = { ..._varsayilanBag };
      sifirla();
      _dinleyiciler.clear();
      _kilit = false;
    },
    parcaliSil,
    hostDosyalariniSil,
    seenAnahtariniSil,
    istekDogrula,
  },
};
