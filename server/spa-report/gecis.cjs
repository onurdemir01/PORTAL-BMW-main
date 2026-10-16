// server/spa-report/gecis.cjs — Nginx ARK SPA Raporu > "Glomo Geçiş Planı" (2026-10-13).
//
// Kullanici: "Glomo Production tasimalarimizin ilerlemesini gosteren Excel'i baska bir ekip
// takvimlendirdi; calisma 5 dahil bitti, 6 ve 7 kaldi. Eksikler varsa calisma 7'ye gom.
// Uygulama kullanimda mi? Kullanimdaysa calismaya katilacak kisinin ismi. Gecenler listenin
// asaginda, ben gecti yazacagim ve gecis tarihini elle girecegim. Setlerin calisma tarihini ve
// OCO numarasini elle girecegim. Tabloyu dolduran kisinin ismi GORUNMESIN."
//
// 2026-10-16: Set 6 tamamlandi; bazi uygulama sahipleri uygulamalarini Set 7'ye aldirdi. Kalan
// tek calisma Set 7. Liste glomo-gecis-set7-talep.json'da; TEK SEFERLIK goc (spa_gecis_goc)
// listedeki uygulamalari Set 7'ye tasir, girisler (kullanimda / katilimci / kontrol) korunur.
// Ayrica "Kontrol" kolonu: herkes "Kontrol Ettim" der, yalniz an tutulur (kim ve aciklama YOK).
//
// KAYNAKLAR
//   glomo-gecis-seed.json  Excel'den (Glomo-Nginx-Tasima-Takvimi.xlsx, 210 uygulama, Calisma 1-7).
//                          Excel'in Turkce karakterleri bozuktu; yalniz namespace/uygulama/set/
//                          location alindi (ekip ve yuk canli rapordan gelir).
//   glomo-gecis-set7-talep.json  2026-10-16 Set 7'ye alinacak uygulamalar (bkz. gocUygula).
//   loadReport()           canli ARK SPA raporu (Nginx_Config_Audit). Glomo servisinde olup
//                          Excel'de OLMAYAN uygulama "eksik" sayilir ve Set 7'ye eklenir.
//
// YAZMA YETKISI IKIYE AYRILIR
//   herkes (sayfayi gorebilen): "kullanimda mi" + "calismaya katilacak kisi" + "kontrol ettim"
//   yalniz Admin             : set tarihi / OCO no, uygulamanin seti, gecti + gecis tarihi
//                              (2026-10-16'dan beri ekranda yalniz set tarihi / OCO; diger
//                              Admin uclari duruyor ama ekran cagirmiyor)
// KIMIN YAZDIGI TUTULMAZ ve gosterilmez (kullanici istegi): tabloda yalniz katilacak kisi var.
//
// TARIHLER METIN: set calisma ani 'YYYY-MM-DDTHH:mm' (TR saati, girildigi gibi), gecis tarihi
// 'YYYY-MM-DD'. Saat dilimi donusumu yok - ekrana yazilan, girilenin aynisidir.
'use strict';

const crypto = require('node:crypto');
const db = require('../db/index.cjs');

const SETLER = [1, 2, 3, 4, 5, 6, 7];
const EKSIK_SET = 7;
const SEED = require('./glomo-gecis-seed.json');
const SEED_BY_KEY = new Map(SEED.map((s) => [`${s.namespace}/${s.application}`, s]));
const GLOMO = 'GLOMO';

const T = (s) => String(s == null ? '' : s).trim();
const appKey = (ns, app) => crypto.createHash('sha256').update(`${T(ns)}\u0000${T(app)}`).digest('hex');
const isAdmin = (req) => req.session?.user?.role === 'Admin';
const TARIH_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZAMAN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// SET 7 TALEBI (2026-10-16). Icerik kullanicinin gonderdigi listedir; DEGISTIRILMEZ.
// Dosya okunamazsa (commit'e girmedi vb.) modul YINE yuklenir: bu require modul duzeyinde ve
// spa-report/index.cjs'te ana raporun da onunde - patlarsa /api/spa-report altindaki BUTUN uclar
// kalkar. Goc ve talepEslesmeyen devre disi kalir, hata loglanir ve Admin ekranda gorur.
let TALEP = { ad: 'set7-talep-2026-10-16', hedefSet: 7, uygulamalar: [] };
let TALEP_HATA = null;
try {
  TALEP = require('./glomo-gecis-set7-talep.json');
} catch (err) {
  TALEP_HATA = `glomo-gecis-set7-talep.json okunamadi: ${err.message}`;
  console.error(`[glomo-gecis] ${TALEP_HATA}`);
}
const TALEP_LISTE = (TALEP.uygulamalar || []).map((u) => ({ namespace: T(u.namespace), application: T(u.application) }));

let _seedlendi = false;
let _gocTamam = false;
let _gocHata = TALEP_HATA;
async function seedle() {
  if (!_seedlendi) {
    for (const no of SETLER) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM spa_gecis_set WHERE no = $1) INSERT INTO spa_gecis_set (no) VALUES ($1)`,
        [no],
      );
    }
    const { rows } = await db.query(`SELECT app_key FROM spa_gecis_app`);
    const var_ = new Set((rows || []).map((r) => String(r.app_key).trim()));
    for (const s of SEED) {
      const k = appKey(s.namespace, s.application);
      if (var_.has(k)) continue;
      await db.query(
        `INSERT INTO spa_gecis_app (app_key, namespace, application, set_no, kaynak) VALUES ($1, $2, $3, $4, 'excel')`,
        [k, s.namespace, s.application, s.set],
      );
    }
    _seedlendi = true;
  }
  if (!_gocTamam && !TALEP_HATA) {
    // Goc yazilamazsa (tablo yok, DB hatasi) sayfa yine acilir; hata loglanir, Admin yanitta
    // (goc.hata) gorur ve sonraki okumada yeniden denenir.
    try {
      await gocUygula();
      _gocTamam = true;
      _gocHata = null;
    } catch (err) {
      _gocHata = err.message;
      console.error(`[glomo-gecis] Set ${TALEP.hedefSet} gocu (${TALEP.ad}) uygulanamadi:`, err.message);
    }
  }
}

/**
 * TEK SEFERLIK GOC (2026-10-16): talep listesindeki uygulama planda VARSA ve seti hedef degilse
 * hedef sete tasinir; "gecti" ve gecis tarihi sifirlanir (yoksa ust bolumde gorunmez). Girisler
 * (kullanimda / katilimci / kontrol_at) DOKUNULMAZ. Planda olmayan EKLENMEZ (uydurma satir
 * olusmasin; canli Glomo envanterindeki uygulamayi "eksik" mantigi zaten Set 7'ye ekler).
 * spa_gecis_goc satiri ayni islemde yazilir: tekrar calismaz (Admin sonradan baska sete alirsa
 * geri cekilmez). UPDLOCK+HOLDLOCK: eszamanli iki istekten ikincisi birincinin bitmesini bekler
 * ve satiri gorup atlar.
 *
 * TABLO ON KONTROLU BEGIN TRAN'DAN ONCE: tablo yoksa SQL Server'in 208 hatasi (ertelenmis ad
 * cozumu) bir DERLEME hatasidir ve XACT_ABORT onu geri ALMAZ - BEGIN TRAN havuzdaki baglantida
 * acik kalir (node-mssql baglantiyi sifirlamadan geri verir; sonraki ilgisiz sorgular o islemin
 * icinde kosar). THROW ise calisma zamani hatasidir: islem acilmadan toplu temiz biter.
 *
 * IZ: OUTPUT DELETED.* ile tasinan her uygulama onceki set / gecti / gecis tarihiyle loglanir
 * (gecti ve tarih sifirlandigi icin elle geri donusun tek kaynagi).
 */
async function gocUygula() {
  const hedef = Number(TALEP.hedefSet);
  if (!SETLER.includes(hedef)) throw new Error(`gecersiz hedef set: ${TALEP.hedefSet}`);
  const anahtarlar = [...new Set(TALEP_LISTE.map((u) => appKey(u.namespace, u.application)))];
  if (!anahtarlar.length) return;
  const yer = anahtarlar.map((_, i) => `$${i + 3}`).join(', ');
  const r = await db.query(
    `SET XACT_ABORT ON;
     IF OBJECT_ID(N'spa_gecis_goc', N'U') IS NULL THROW 50001, N'spa_gecis_goc tablosu yok', 1;
     BEGIN TRAN;
     IF NOT EXISTS (SELECT 1 FROM spa_gecis_goc WITH (UPDLOCK, HOLDLOCK) WHERE ad = $1)
     BEGIN
       UPDATE spa_gecis_app SET set_no = $2, gecti = 0, gecis_tarihi = NULL, updated_at = GETUTCDATE()
        OUTPUT DELETED.namespace, DELETED.application, DELETED.set_no, DELETED.gecti, DELETED.gecis_tarihi
        WHERE set_no <> $2 AND app_key IN (${yer});
       INSERT INTO spa_gecis_goc (ad) VALUES ($1);
     END
     COMMIT;`,
    [TALEP.ad, hedef, ...anahtarlar],
  );
  const tasinan = (r && r.rows) || [];
  if (!tasinan.length) return;
  console.log(`[glomo-gecis] ${TALEP.ad}: ${tasinan.length} uygulama Set ${hedef}'ye tasindi`);
  for (const x of tasinan) {
    const gecti = x.gecti === true || Number(x.gecti) === 1 ? 1 : 0;
    console.log(`[glomo-gecis] ${TALEP.ad}: ${T(x.namespace)}/${T(x.application)} Set ${x.set_no} -> ${hedef} (onceki gecti=${gecti}, gecis_tarihi=${T(x.gecis_tarihi) || '-'})`);
  }
}

const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? T(v) : d.toISOString();
};

/** Canli rapordaki Glomo uygulamalari: "ns/app" -> { ekip, locations, yuk }. */
function glomoCanli(rapor) {
  const m = new Map();
  for (const r of rapor?.rows || []) {
    if (T(r.service).toUpperCase() !== GLOMO) continue;
    const k = `${T(r.namespace)}/${T(r.application)}`;
    if (!m.has(k)) m.set(k, { namespace: T(r.namespace), application: T(r.application), ekip: new Set(), locations: [], trafik: [] });
    const x = m.get(k);
    for (const e of r.team || []) x.ekip.add(e);
    if (r.location && !x.locations.includes(r.location)) x.locations.push(r.location);
    x.trafik.push(r.traffic || null);
  }
  return m;
}

/** Uygulama yuk ozeti: bir location bile yuk aliyorsa 'active'; HEPSI olculmus ve bossa 'idle';
 *  aksi halde 'unknown' (olculemedi != yuk yok); hic olcum yoksa null. */
function yukOzeti(trafik) {
  const list = (trafik || []).filter(Boolean);
  if (!list.length) return null;
  const aktif = list.filter((t) => t.state === 'active');
  if (aktif.length) return { state: 'active', req7: aktif.reduce((a, t) => a + (Number(t.req7) || 0), 0) };
  if (list.length === (trafik || []).length && list.every((t) => t.state === 'idle')) return { state: 'idle', req7: 0 };
  return { state: 'unknown', req7: 0 };
}

// EKIP E-POSTASI (2026-10-13, kullanici: "ekiplerin e-postasina ulasmak istiyorum"): namespace sahibi
// tablosu (dbo.Openshift_Namespace_Owners, CMDB -> Smart) grup adiyla birlikte e-postayi da tutuyor.
// Okunamazsa e-posta bos kalir ve ekip adi canli rapordan gelir.
async function sahipleriYukle() {
  try {
    const { query } = require('../inventory/mssql.cjs');
    const { loadNamespaceOwners } = require('../audit/ns-owners.cjs');
    return await loadNamespaceOwners(query);
  } catch {
    return { ready: false, byNs: new Map() };
  }
}

async function planYukle(loadReport, sahipYukle = sahipleriYukle) {
  await seedle();
  let rapor = null;
  try { rapor = await loadReport(false); } catch { rapor = null; }
  const canli = glomoCanli(rapor);
  const sahipler = await sahipYukle().catch(() => ({ ready: false, byNs: new Map() }));
  const { ownersFor } = require('../audit/ns-owners.cjs');
  const raporVar = !!rapor && rapor.ok !== false && !rapor.notScanned;

  // EKSIKLER: canli raporda Glomo olup planda olmayan uygulama Set 7'ye (kaynak 'portal').
  if (raporVar) {
    const { rows } = await db.query(`SELECT app_key FROM spa_gecis_app`);
    const var_ = new Set((rows || []).map((r) => String(r.app_key).trim()));
    for (const x of canli.values()) {
      const k = appKey(x.namespace, x.application);
      if (var_.has(k)) continue;
      await db.query(
        `INSERT INTO spa_gecis_app (app_key, namespace, application, set_no, kaynak) VALUES ($1, $2, $3, $4, 'portal')`,
        [k, x.namespace, x.application, EKSIK_SET],
      );
    }
  }

  const [setler, uyg] = await Promise.all([
    db.query(`SELECT no, calisma_at, oco_no FROM spa_gecis_set ORDER BY no`),
    db.query(`SELECT namespace, application, set_no, kaynak, kullanimda, katilimci, gecti, gecis_tarihi, kontrol_at FROM spa_gecis_app`),
  ]);
  // Set 7 talebinde olup ANLIK planda olmayanlar (yazim hatasi / envanterde yok): Admin'e uyari.
  const plandaki = new Set((uyg.rows || []).map((r) => `${T(r.namespace)}/${T(r.application)}`));
  const talepEslesmeyen = TALEP_LISTE.filter((u) => !plandaki.has(`${u.namespace}/${u.application}`));
  const apps = (uyg.rows || []).map((r) => {
    const k = `${T(r.namespace)}/${T(r.application)}`;
    const c = canli.get(k);
    const s = SEED_BY_KEY.get(k);
    return {
      namespace: T(r.namespace),
      application: T(r.application),
      setNo: Number(r.set_no),
      kaynak: T(r.kaynak) || 'excel',
      kullanimda: r.kullanimda == null ? null : T(r.kullanimda),
      katilimci: r.katilimci || '',
      gecti: r.gecti === true || Number(r.gecti) === 1,
      gecisTarihi: r.gecis_tarihi ? T(r.gecis_tarihi) : null,
      // "Kontrol Ettim" ani (ISO, UTC). Kimin bastigi TUTULMAZ.
      kontrolAt: iso(r.kontrol_at),
      ekip: (() => {
        const o = ownersFor(sahipler.byNs, [r.namespace]);
        return [...new Set([...(c ? [...c.ekip] : []), ...o.groups])];
      })(),
      ekipEposta: ownersFor(sahipler.byNs, [r.namespace]).emails,
      locations: c && c.locations.length ? c.locations : (s ? s.locations : []),
      yuk: c ? yukOzeti(c.trafik) : null,
      // Rapor okunduysa ve uygulama orada yoksa: canli Glomo envanterinde gorulmuyor.
      taramadaYok: raporVar && !c,
    };
  });
  return {
    ok: true,
    raporVar,
    raporTarihi: rapor?.scanDate || null,
    epostaVar: sahipler.ready !== false,
    sets: (setler.rows || []).map((r) => ({ no: Number(r.no), calismaAt: r.calisma_at ? T(r.calisma_at) : null, ocoNo: r.oco_no ? T(r.oco_no) : '' })),
    apps,
    talepEslesmeyen,
    // Tek seferlik Set 7 gocunun durumu: uygulanamadiysa Set 6'dan tasinacak uygulamalar
    // "Tamamlanan" bolumunde kalir - Admin ekranda uyari gorur (sunucu logu tek iz degil).
    goc: { ad: TALEP.ad, uygulandi: _gocTamam, hata: _gocTamam ? null : _gocHata },
  };
}

function mountGecis(router, { loadReport, sahipYukle }) {
  router.get('/gecis', async (req, res) => {
    try {
      const p = await planYukle(loadReport, sahipYukle);
      const admin = isAdmin(req);
      // talepEslesmeyen ve goc hatasi yalniz Admin'e (ekran da yalniz Admin'e gosterir).
      res.json({
        ...p,
        talepEslesmeyen: admin ? p.talepEslesmeyen : [],
        goc: admin ? p.goc : { ad: p.goc.ad, uygulandi: p.goc.uygulandi },
        admin,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // HERKES: kullanimda mi + katilacak kisi. Kim yazdi TUTULMAZ (kullanici istegi).
  router.put('/gecis/app', async (req, res) => {
    const ns = T(req.body?.namespace);
    const app = T(req.body?.application);
    const ku = req.body?.kullanimda == null || req.body.kullanimda === '' ? null : T(req.body.kullanimda);
    if (!ns || !app) return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    if (ku !== null && ku !== 'yes' && ku !== 'no') return res.status(400).json({ ok: false, message: 'Geçersiz değer.' });
    const katilimci = ku === 'yes' ? T(req.body?.katilimci).slice(0, 400) : '';
    try {
      const r = await db.query(
        `UPDATE spa_gecis_app SET kullanimda = $2, katilimci = $3, updated_at = GETUTCDATE() WHERE app_key = $1`,
        [appKey(ns, app), ku, katilimci || null],
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, message: 'Uygulama planda yok.' });
      res.json({ ok: true, kullanimda: ku, katilimci });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // HERKES: "Kontrol Ettim" (2026-10-16). Yalniz an tutulur; kim bastigi ve aciklama YOK
  // (kullanici: "Sadece Kontrol Ettim diye bir buton olsa kafi aciklama girmesini istemiyorum").
  // kontrol=false yanlislikla basilani geri alir.
  router.put('/gecis/app-kontrol', async (req, res) => {
    const ns = T(req.body?.namespace);
    const app = T(req.body?.application);
    const k = req.body?.kontrol;
    if (!ns || !app) return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    if (k !== true && k !== false) return res.status(400).json({ ok: false, message: 'kontrol true ya da false olmalı.' });
    try {
      const r = await db.query(
        k
          ? `UPDATE spa_gecis_app SET kontrol_at = GETUTCDATE(), updated_at = GETUTCDATE() WHERE app_key = $1 RETURNING kontrol_at`
          : `UPDATE spa_gecis_app SET kontrol_at = NULL, updated_at = GETUTCDATE() WHERE app_key = $1 RETURNING kontrol_at`,
        [appKey(ns, app)],
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, message: 'Uygulama planda yok.' });
      res.json({ ok: true, kontrolAt: k ? iso(r.rows?.[0]?.kontrol_at) || new Date().toISOString() : null });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  const yalnizAdmin = (req, res, next) =>
    isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Bu alanı yalnız Admin değiştirebilir.' });

  // ADMIN: uygulamanin seti, gecti, gecis tarihi.
  router.put('/gecis/app-admin', yalnizAdmin, async (req, res) => {
    const ns = T(req.body?.namespace);
    const app = T(req.body?.application);
    if (!ns || !app) return res.status(400).json({ ok: false, message: 'namespace ve application zorunlu.' });
    const b = req.body || {};
    const set = [];
    const p = [appKey(ns, app)];
    if (b.setNo !== undefined) {
      if (!SETLER.includes(Number(b.setNo))) return res.status(400).json({ ok: false, message: 'Geçersiz set.' });
      p.push(Number(b.setNo)); set.push(`set_no = $${p.length}`);
    }
    if (b.gecti !== undefined) { p.push(b.gecti ? 1 : 0); set.push(`gecti = $${p.length}`); }
    if (b.gecisTarihi !== undefined) {
      const t = b.gecisTarihi ? T(b.gecisTarihi) : null;
      if (t && !TARIH_RE.test(t)) return res.status(400).json({ ok: false, message: 'Geçiş tarihi YYYY-AA-GG olmalı.' });
      p.push(t); set.push(`gecis_tarihi = $${p.length}`);
    }
    if (!set.length) return res.status(400).json({ ok: false, message: 'Değişiklik yok.' });
    try {
      const r = await db.query(`UPDATE spa_gecis_app SET ${set.join(', ')}, updated_at = GETUTCDATE() WHERE app_key = $1`, p);
      if (!r.rowCount) return res.status(404).json({ ok: false, message: 'Uygulama planda yok.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // ADMIN: setin calisma ani + OCO numarasi.
  router.put('/gecis/set', yalnizAdmin, async (req, res) => {
    const no = Number(req.body?.no);
    if (!SETLER.includes(no)) return res.status(400).json({ ok: false, message: 'Geçersiz set.' });
    const at = req.body?.calismaAt ? T(req.body.calismaAt).slice(0, 16) : null;
    if (at && !ZAMAN_RE.test(at)) return res.status(400).json({ ok: false, message: 'Çalışma zamanı YYYY-AA-GGTSS:DD olmalı.' });
    const oco = T(req.body?.ocoNo).slice(0, 64);
    try {
      await db.query(`UPDATE spa_gecis_set SET calisma_at = $2, oco_no = $3, updated_at = GETUTCDATE() WHERE no = $1`, [no, at, oco || null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // ADMIN TOPLU: setteki gecmemis tum uygulamalar "gecti"; tarihi bos olanlara verilen tarih yazilir.
  router.post('/gecis/set/:no/gecti', yalnizAdmin, async (req, res) => {
    const no = Number(req.params.no);
    if (!SETLER.includes(no)) return res.status(400).json({ ok: false, message: 'Geçersiz set.' });
    const t = req.body?.tarih ? T(req.body.tarih) : null;
    if (t && !TARIH_RE.test(t)) return res.status(400).json({ ok: false, message: 'Tarih YYYY-AA-GG olmalı.' });
    try {
      const r = await db.query(
        `UPDATE spa_gecis_app SET gecti = 1, gecis_tarihi = COALESCE(gecis_tarihi, $2), updated_at = GETUTCDATE()
          WHERE set_no = $1 AND gecti = 0`,
        [no, t],
      );
      res.json({ ok: true, guncellenen: r.rowCount || 0 });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { mountGecis, planYukle, glomoCanli, yukOzeti, appKey, TALEP, _sifirla: () => { _seedlendi = false; _gocTamam = false; _gocHata = TALEP_HATA; } };
