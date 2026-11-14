// server/server-hub/toplu-autostart.cjs - Server Hub > Toplu Auto-Start (2026-11-14).
//
// Kullanici: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton hazirlayabilir misin?"
//
// GECMIS: toplu auto-start 2026-10-01'de kullanicinin istegiyle KALDIRILDI ("yanlis bir tarama yuzlerce
// sunucuya yayilir"). 2026-11-14'te kullanici su GUVENLIK MODELINI secti; bu modul onu uygular:
//   1. Liste yalniz TAZE taramada auto-start UYUMSUZ JVM'ler: calisiyor + auto-start false -> AC; durmus +
//      auto-start true -> KAPAT. Kapilar /jvm-autostart ile AYNI fonksiyon (autostart-dogrulama.cjs
//      sunucuYazmaKapisi / jvmAutoStartKapisi): taze sunucu, sema bilinir, UNAVAILABLE degil, calisan JVM'de
//      kapat yok. Ayrica assess'in KENDI duzeltmesi (REBOOT_RISK / STOPPED_AUTOSTART_ON bulgusunun fix'i) sart.
//   2. TEK DUGME once SALT OKUNUR PLAN isi acar (host basina bir server_hub_fix isi, action
//      jboss_autostart_items, plan_only=true): betik her JVM'in CANLI auto-start'ini jboss-cli ile okur.
//      PLAN = hala uyumsuz (uygulanir); SKIP = canli deger zaten hedefte (tarama eski, dusurulur); FAIL =
//      dusurulur (nedeniyle). "AC" adayinin JVM'i plan aninda durmus olsa da betik bunu yakalamaz (auto-start
//      acmak durmus JVM'e zarar vermez; reboot'ta acilir) - ekran bunu soyler.
//   3. Onay ekrani (15 dk icinde; plan daha eskiyse PLAN_ESKIDI, yeniden planlanir).
//   4. Host basina TEK is, hostlar SIRAYLA (bir sonraki host ancak oncekinin isi terminal olunca). FAIL toplu
//      isi DURDURMAZ, sonda ozet kirmizi (BITTI_HATALI).
//   5. Ust sinir Admin > Kurallar & Limitler 'limit:toplu_autostart' (varsayilan 50 JVM).
//   6. Dogrulanan sonuc (oge OK/SKIP, betik CLI ile geri okudu) dogrulama katmanina yazilir (isKaydetToplu):
//      sunucu paneli ve Bulgular tarama gelmeden yeni degeri gosterir.
//
// DURUM DB'DE (server_hub_toplu_isler / server_hub_toplu_ogeler): sayfa yenilense ya da baska admin acsa
// ilerleme gorunur; yurutme sunucu tarafinda (tick, 10 sn).
//
// YENIDEN BASLATMADA SESSIZ YENIDEN KOSMA YOK: aktif is surecin KIRASIYLA (kira_id = bu surecin rastgele
// kimligi, 120 sn, her tick yenilenir) yurur. Kirasi dusmus aktif isi bulan surec onu ILERLETMEZ: is
// YARIM_KALDI olur; baslamamis ogeler YARIM_KALDI ("calistirilmadi"); is numarasi yazilmamis BASLATILIYOR oge
// YARIM_KALDI ("AWX'e gitmis olabilir - AWX'ten kontrol edin"); is numarasi olan CALISIYOR oge yalniz IZLENIR
// (sonucu yazilir, yeniden baslatilmaz).
//
// IPTAL: yeni host baslatilmaz; suren AWX isi iptal EDILMEZ, bitmesi beklenir; bekleyen ogeler IPTAL.
//
// TALEP 2 (Toplu Restart) ayni tablolari tur='RESTART' ile kullanacak sekilde tasarlandi; bu modul yalniz
// tur='AUTOSTART'.
'use strict';

const crypto = require('node:crypto');
const {
  AUTOSTART_EYLEMLERI,
  LISTE_EYLEMI,
  ogeSonuclari,
  sunucuYazmaKapisi,
  jvmAutoStartKapisi,
} = require('./autostart-dogrulama.cjs');

const TUR = 'AUTOSTART';
const FIX_KEY = 'server_hub_fix';
const POLL_SN = 10;
const KIRA_SN = 120;
const PLAN_YAS_MS = 15 * 60 * 1000;
const PLAN_PARALEL = 5;
const IS_ZAMAN_ASIMI_MS = 3 * 60 * 60 * 1000;
const ADAY_KODLARI = { jboss_autostart_on: 'REBOOT_RISK', jboss_autostart_off: 'STOPPED_AUTOSTART_ON' };
const AKTIF = ['PLANLANIYOR', 'PLAN_HAZIR', 'CALISIYOR', 'IPTAL_ISTENDI'];
const YURUYEN = ['PLANLANIYOR', 'CALISIYOR', 'IPTAL_ISTENDI'];
// Bu durumdaki oge JVM'i kilitler (tek satir dugmesi / /fix 409): is sonu ya da YARIM_KALDI'da kalkar.
const KILITLI_OGE = ['ADAY', 'PLANLANIYOR', 'PLAN_GECTI', 'BEKLIYOR', 'BASLATILIYOR', 'CALISIYOR'];
const IS_TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE_VARSAYILAN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const OLUSTURULUYOR = 'OLUSTURULUYOR';

// Bu surecin kimligi: kira bununla tutulur. Yeniden baslayan surec FARKLI kimlikle gelir (eski kirayi devralmaz).
const SUREC_ID = crypto.randomBytes(16).toString('hex');

let _d = null;
let _timer = null;
let _ticking = false;

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const IN = (l) => l.map((x) => `'${x}'`).join(', ');
const hata = (status, message, code) => Object.assign(new Error(message), { status, code });

/** Router mount'unda verilir (index.cjs): launch, getAssessment, autoStart(), ayarlar, audit, HOST_RE, ... */
function kur(deps) {
  _d = deps || null;
}

const hostRe = () => (_d && _d.HOST_RE) || HOST_RE_VARSAYILAN;
const autoStart = () => (_d && typeof _d.autoStart === 'function' ? _d.autoStart() : null);

function denetim(req, detail) {
  try {
    if (_d && _d.audit) _d.audit(req, detail);
  } catch {
    // denetim kaydi yazilamadi: islem yine tamam
  }
}

/** Yurutucunun AWX'e ve denetime "kim istedi" diye verecegi sozde istek. */
function sozdeIstek(kim) {
  const ad = M(kim, 128) || 'unknown';
  return { session: { user: { username: ad, displayName: ad, role: 'Admin' } }, sessionID: null, ip: null };
}

// ── ADAYLAR ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Taze degerlendirmeden aday listesi. Donus: { adaylar, dislananlar }.
 * aday: { host, env, envGroup, gen, jvm, eylem: 'ac'|'kapat', action, running, autoStart, scanDate }.
 * dislanan: ayni alanlar + neden (uyumsuz gorunen ama kapidan gecmeyen JVM; ekran nedenini gosterir).
 */
function adaylariTuret(a, opts = {}) {
  const as = opts.autoStart || autoStart();
  const adaylar = [];
  const dislananlar = [];
  for (const h of (a && a.hosts) || []) {
    // AYNI SUNUCUDA AYNI (gen, JVM adi) IKI KEZ (uretim 2026-11-14, GBSTPQ01/GBSTPMAINWEB): taramada iki
    // kayit varsa hangisinin auto-start'i degisecek belirsizdir; ikisi de aday OLMAZ, nedeniyle disarida.
    const tekrar = new Map();
    for (const x of h.jvms || []) {
      const k = ogeAnahtari(h.host, Number(x.gen), x.name);
      tekrar.set(k, (tekrar.get(k) || 0) + 1);
    }
    const ikiKez = new Set();
    for (const tj of h.jvms || []) {
      const j = as ? as.uygulaJvm(h, tj) : tj;
      const rk = j.runningKnown !== false;
      const tarama = tj.autoStart;
      // Uyumsuzluk TARAMA degerine gore aranir; dogrulama katmani degeri degistirdiyse "dogrulandi" diye dislanir.
      let action = null;
      if (rk && tj.running === true && tarama === 'false') action = 'jboss_autostart_on';
      else if (rk && tj.running !== true && tarama === 'true') action = 'jboss_autostart_off';
      if (!action) continue;
      const satir = {
        host: h.host,
        env: h.env || null,
        envGroup: h.envGroup || null,
        gen: Number(tj.gen),
        jvm: tj.name,
        eylem: action === 'jboss_autostart_on' ? 'ac' : 'kapat',
        action,
        running: tj.running === true,
        autoStart: tarama,
        scanDate: h.scanDate || null,
      };
      const enable = action === 'jboss_autostart_on';
      const tk = ogeAnahtari(h.host, Number(tj.gen), tj.name);
      if ((tekrar.get(tk) || 0) > 1) {
        if (!ikiKez.has(tk))
          dislananlar.push({ ...satir, neden: 'Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.' });
        ikiKez.add(tk);
        continue;
      }
      if (!(satir.gen === 7 || satir.gen === 8)) {
        dislananlar.push({ ...satir, neden: 'JBoss sürümü (7/8) taramada belirlenemedi — iş açılmaz.' });
        continue;
      }
      if (j.autoStartDogrulama && j.autoStart !== tarama) {
        dislananlar.push({ ...satir, neden: `iş #${j.autoStartDogrulama.jobId} ile doğrulandı — tarama bekleniyor` });
        continue;
      }
      const k =
        sunucuYazmaKapisi(a, h, h.host) || jvmAutoStartKapisi(j, { host: h.host, jvm: tj.name, gen: Number(tj.gen), enable });
      if (k) {
        dislananlar.push({ ...satir, neden: k.message });
        continue;
      }
      // assess'in KENDI duzeltmesi de olmali (tazelik / sema / tanimsiz surec kapilari orada da var).
      const kod = ADAY_KODLARI[action];
      const bulgu = (h.findings || []).find(
        (f) => f.code === kod && f.fix && f.fix.action === action && f.fix.jvm === tj.name && Number(f.fix.gen) === Number(tj.gen),
      );
      if (!bulgu) {
        dislananlar.push({ ...satir, neden: 'Bulgu düzeltme önermiyor (assess) — iş açılmaz.' });
        continue;
      }
      const s = as ? as.surenIs(h.host, tj.gen, tj.name) : null;
      if (s) {
        dislananlar.push({ ...satir, neden: s.jobId ? `iş #${s.jobId} sürüyor` : 'iş başlatılıyor' });
        continue;
      }
      adaylar.push(satir);
    }
  }
  const sira = (x, y) => (x.host < y.host ? -1 : x.host > y.host ? 1 : x.gen - y.gen || (x.jvm < y.jvm ? -1 : x.jvm > y.jvm ? 1 : 0));
  adaylar.sort(sira);
  dislananlar.sort(sira);
  return { adaylar, dislananlar };
}

const ogeAnahtari = (host, gen, jvm) => `${String(host || '').toUpperCase()}|${Number(gen)}|${String(jvm || '').toLowerCase()}`;

// ── DB ───────────────────────────────────────────────────────────────────────────────────────────

async function aktifIs() {
  const { rows } = await db().query(
    `SELECT TOP 1 * FROM server_hub_toplu_isler WHERE tur = $1 AND durum IN (${IN(AKTIF)}) ORDER BY id DESC`,
    [TUR],
  );
  return (rows && rows[0]) || null;
}

async function isOku(id) {
  const { rows } = await db().query(`SELECT * FROM server_hub_toplu_isler WHERE id = $1 AND tur = $2`, [id, TUR]);
  return (rows && rows[0]) || null;
}

async function ogeler(isId) {
  const { rows } = await db().query(`SELECT * FROM server_hub_toplu_ogeler WHERE is_id = $1 ORDER BY sira`, [isId]);
  return rows || [];
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

function isSatiri(r) {
  if (!r) return null;
  return {
    id: r.id,
    durum: r.durum,
    olusturan: r.olusturan,
    onaylayan: r.onaylayan || null,
    iptalEden: r.iptal_eden || null,
    ustSinir: r.ust_sinir,
    aday: r.aday,
    planGecti: r.plan_gecti,
    dusen: r.dusen,
    ok: r.ok_sayisi,
    skip: r.skip_sayisi,
    fail: r.fail_sayisi,
    hata: r.hata || null,
    createdAt: iso(r.created_at),
    planBitisAt: iso(r.plan_bitis_at),
    onayAt: iso(r.onay_at),
    bitisAt: iso(r.bitis_at),
  };
}

function ogeSatiri(r) {
  return {
    id: r.id,
    sira: r.sira,
    host: r.host,
    env: r.env || null,
    gen: r.gen,
    jvm: r.jvm,
    eylem: r.eylem,
    hedef: r.hedef,
    taramaDegeri: r.tarama_degeri,
    calisiyor: r.calisiyor === true || r.calisiyor === 1,
    taramaScanDate: r.tarama_scan_date || null,
    durum: r.durum,
    neden: r.neden || null,
    planJobId: r.plan_job_id || null,
    awxServerId: r.awx_server_id == null ? null : r.awx_server_id,
    awxJobId: r.awx_job_id || null,
    sonucSatiri: r.sonuc_satiri || null,
    dogrulandi: r.dogrulandi === true || r.dogrulandi === 1,
    baslamaAt: iso(r.baslama_at),
    bitisAt: iso(r.bitis_at),
  };
}

/** Is satirinin sayimlarini ogelerden yeniden hesaplar. */
async function sayimYaz(isId) {
  await db().query(
    `UPDATE server_hub_toplu_isler SET
        aday = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1),
        plan_gecti = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum NOT IN ('ADAY', 'PLANLANIYOR', 'DUSTU')),
        dusen = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'DUSTU'),
        ok_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'OK'),
        skip_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'SKIP'),
        fail_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'FAIL')
      WHERE id = $1`,
    [isId],
  );
}

/** Kira: yalniz bu surec, kendi kirasini yeniler. Donus: true (bizde). */
async function kiraYenile(isId) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET kira_bitis = DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())
      WHERE id = $1 AND kira_id = $2`,
    [isId, SUREC_ID],
  );
  return r.rowCount === 1;
}

/** Oge(ler)e durum yaz; yalniz beklenen durumdaysa (CAS). */
async function ogeDurum(id, eski, yeni, alanlar = {}) {
  const set = ['durum = $2'];
  const p = [id, yeni];
  for (const [k, v] of Object.entries(alanlar)) {
    p.push(v);
    set.push(`${k} = $${p.length}`);
  }
  if (['OK', 'SKIP', 'FAIL', 'DUSTU', 'IPTAL', 'YARIM_KALDI'].includes(yeni)) set.push('bitis_at = SYSUTCDATETIME()');
  p.push(...eski);
  const kosul = eski.map((_, i) => `$${p.length - eski.length + i + 1}`).join(', ');
  const r = await db().query(`UPDATE server_hub_toplu_ogeler SET ${set.join(', ')} WHERE id = $1 AND durum IN (${kosul})`, p);
  return r.rowCount === 1;
}

// ── KILIT (tek satir dugmesi / /fix) ─────────────────────────────────────────────────────────────

/**
 * Bu JVM bir toplu isin bekleyen / calisan ogesi mi? Donus: 409 mesaji ya da null. DB okunamazsa null
 * (tek satir isi acilir; betik canli degeri okur, toplu isteki oge sonra SKIP doner - zararsiz).
 */
async function topluKilidi(host, gen, jvm) {
  try {
    const { rows } = await db().query(
      `SELECT TOP 1 o.is_id, o.durum FROM server_hub_toplu_ogeler o
         JOIN server_hub_toplu_isler i ON i.id = o.is_id
        WHERE i.tur = $1 AND o.host = $2 AND o.gen = $3 AND o.jvm = $4 AND o.durum IN (${IN(KILITLI_OGE)})
        ORDER BY o.is_id DESC`,
      [TUR, String(host || '').toUpperCase(), Number(gen), String(jvm || '')],
    );
    const r = rows && rows[0];
    if (!r) return null;
    return `${jvm} toplu auto-start işi #${r.is_id} içinde (${r.durum}) — o iş bitene ya da iptal edilene kadar tek tek iş açılmaz (iş açılmadı). Server Hub › Toplu Auto-Start sekmesinden izleyin.`;
  } catch (e) {
    console.warn('[TopluAutoStart] kilit okunamadi:', e && e.message);
    return null;
  }
}

// ── OLUSTUR / ONAY / IPTAL ───────────────────────────────────────────────────────────────────────

function secimiDuzle(secim, enCok) {
  if (!Array.isArray(secim) || !secim.length) throw hata(400, 'En az bir JVM seçilmeli.');
  if (secim.length > enCok)
    throw hata(
      400,
      `Tek toplu işte en fazla ${enCok} JVM (${secim.length} seçildi; Admin Server Hub › Kurallar & Limitler'den artırabilir).`,
      'limit',
    );
  const gorulen = new Set();
  const out = [];
  for (const x of secim) {
    const host = String((x && x.host) || '').trim().toUpperCase();
    const jvm = String((x && x.jvm) || '').trim();
    const gen = Number(x && x.gen);
    const eylem = String((x && x.eylem) || '');
    if (!hostRe().test(host)) throw hata(400, `Geçersiz sunucu adı: ${M(host, 64) || '(boş)'}`);
    if (!JVM_RE.test(jvm)) throw hata(400, `Geçersiz JVM adı: ${M(jvm, 64) || '(boş)'}`);
    if (gen !== 7 && gen !== 8) throw hata(400, `Geçersiz JBoss sürümü (gen): ${host}/${jvm}`);
    if (eylem !== 'ac' && eylem !== 'kapat') throw hata(400, `Geçersiz eylem: ${host}/${jvm}`);
    const k = ogeAnahtari(host, gen, jvm);
    if (gorulen.has(k)) throw hata(400, `Aynı JVM iki kez seçilmiş: ${host}/${jvm}`);
    gorulen.add(k);
    out.push({ host, jvm, gen, eylem, action: eylem === 'ac' ? 'jboss_autostart_on' : 'jboss_autostart_off' });
  }
  return out;
}

async function olustur(req, secim) {
  const enCok = await _d.ayarlar.limit('toplu_autostart');
  const istek = secimiDuzle(secim, enCok);
  const akt = await aktifIs();
  if (akt) throw hata(409, `Toplu auto-start işi #${akt.id} hâlâ aktif (${akt.durum}) — önce o bitmeli ya da iptal edilmeli.`, 'aktif_is');
  // Her oge TAZE degerlendirmeden yeniden turetilir: istemciden gelen liste yalniz SECIMDIR.
  const a = await _d.getAssessment(true);
  const { adaylar, dislananlar } = adaylariTuret(a);
  const byK = new Map(adaylar.map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]));
  const disK = new Map(dislananlar.map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]));
  const secilen = [];
  for (const x of istek) {
    const k = ogeAnahtari(x.host, x.gen, x.jvm);
    const c = byK.get(k);
    if (!c || c.action !== x.action) {
      const d = disK.get(k);
      throw hata(
        400,
        `${x.host}/${x.jvm} artık aday değil${d ? ` (${d.neden})` : ' (tarama değişti)'} — listeyi yenileyin; iş açılmadı.`,
        'aday_degil',
      );
    }
    secilen.push(c);
  }
  // DB tabanli kilit: ayni JVM baska bir toplu isin ogesiyse (YARIM_KALDI izlemesi dahil) acilmaz.
  for (const c of secilen) {
    const k = await topluKilidi(c.host, c.gen, c.jvm);
    if (k) throw hata(409, k, 'aktif_is');
  }
  const kim = M(req.session?.user?.username || 'unknown', 128);
  let isId;
  try {
    const r = await db().query(
      `INSERT INTO server_hub_toplu_isler (tur, durum, olusturan, ust_sinir, aday, kira_id, kira_bitis)
       VALUES ($1, 'PLANLANIYOR', $2, $3, $4, $5, DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())) RETURNING id`,
      [TUR, kim, enCok, secilen.length, OLUSTURULUYOR],
    );
    isId = r.rows && r.rows[0] && r.rows[0].id;
  } catch (e) {
    // UX_shti_aktif: eszamanli ikinci olusturma
    if (/UX_shti_aktif|duplicate key|UNIQUE/i.test(String(e && e.message)))
      throw hata(409, 'Başka bir toplu auto-start işi az önce açıldı — sayfayı yenileyin.', 'aktif_is');
    throw e;
  }
  if (!isId) throw hata(500, 'Toplu iş kaydı oluşturulamadı.');
  try {
    // 2100 parametre siniri: 100'luk parcalar.
    for (let i = 0; i < secilen.length; i += 100) {
      const parca = secilen.slice(i, i + 100);
      const p = [];
      const v = parca.map((c, j) => {
        p.push(isId, i + j + 1, c.host, M(c.env, 32) || null, c.gen, c.jvm, c.action, c.action === 'jboss_autostart_on' ? 'true' : 'false', c.autoStart, c.running ? 1 : 0, M(c.scanDate, 32) || null);
        const b = p.length - 11;
        return `(${Array.from({ length: 11 }, (_, n) => `$${b + n + 1}`).join(', ')}, 'ADAY')`;
      });
      await db().query(
        `INSERT INTO server_hub_toplu_ogeler (is_id, sira, host, env, gen, jvm, eylem, hedef, tarama_degeri, calisiyor, tarama_scan_date, durum) VALUES ${v.join(', ')}`,
        p,
      );
    }
    await db().query(`UPDATE server_hub_toplu_isler SET kira_id = $2 WHERE id = $1 AND kira_id = $3`, [isId, SUREC_ID, OLUSTURULUYOR]);
  } catch (e) {
    await db()
      .query(
        `UPDATE server_hub_toplu_isler SET durum = 'PLAN_HATA', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1`,
        [isId, M(`Öğeler yazılamadı: ${e && e.message}`, 1000)],
      )
      .catch(() => {});
    await db().query(`UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = 'kayıt yarım kaldı' WHERE is_id = $1`, [isId]).catch(() => {});
    throw hata(500, `Toplu iş öğeleri yazılamadı: ${e && e.message}`);
  }
  const hostlar = [...new Set(secilen.map((c) => c.host))];
  denetim(req, { op: 'toplu_autostart_olustur', id: isId, adet: secilen.length, hostlar });
  return { id: isId, adet: secilen.length, hostSayisi: hostlar.length };
}

const planEskiMi = (is) => !is.plan_bitis_at || Date.now() - new Date(is.plan_bitis_at).getTime() > PLAN_YAS_MS;

/**
 * PLAN_HAZIR -> PLAN_ESKIDI (CAS); PLAN_GECTI ogeler IPTAL (JVM kilitleri kalkar). Onay ve yurutucu ortak:
 * terk edilen plan JVM'leri suresiz kilitlemesin (inceleme 2026-11-14).
 */
async function planEskit(req, id) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'PLAN_ESKIDI', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
    [id, 'Plan 15 dakikadan eski — onaylanmadı; yeniden planlayın.'],
  );
  if (r.rowCount !== 1) return false;
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'plan eskidi (15 dk)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_autostart_plan_eskidi', id });
  return true;
}

async function onayla(req, id) {
  const is = await isOku(id);
  if (!is) throw hata(404, `Toplu iş #${id} yok.`);
  if (is.durum !== 'PLAN_HAZIR') throw hata(409, `Toplu iş #${id} onaylanamaz (durum ${is.durum}).`, 'durum');
  const kim = M(req.session?.user?.username || 'unknown', 128);
  if (planEskiMi(is)) {
    await planEskit(req, id);
    throw hata(409, 'Plan 15 dakikadan eski — canlı değerler yeniden okunmalı. Yeniden planlayın.', 'plan_eskidi');
  }
  // Onay aninda TAZE sema / tazelik kapisi: sunucu bu arada bayatladiysa o sunucunun ogeleri dusurulur.
  const a = await _d.getAssessment(true);
  if (a.schemaUnknown === true) throw hata(400, 'Server Hub şeması (sys.columns) okunamadı — onay verilmedi; sayfayı yenileyin.');
  const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
  const og = await ogeler(id);
  const enCok = await _d.ayarlar.limit('toplu_autostart');
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI');
  if (gecen.length > enCok)
    throw hata(400, `Limit ${enCok} JVM'e düşürülmüş (${gecen.length} öğe) — yeniden planlayın.`, 'limit');
  let kalan = 0;
  const as = autoStart();
  for (const o of gecen) {
    const h = byHost.get(o.host);
    // JVM duzeyi kapi da yeniden (inceleme 2026-11-14): plandan sonra baslatilan JVM'in KAPAT ogesi ya da
    // bu arada hedefe gelmis JVM burada duser (betik reddedip ozeti kirmiziya boyamasin).
    const tj = h ? (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen)) : null;
    const j = tj && as ? as.uygulaJvm(h, tj) : tj;
    const k =
      sunucuYazmaKapisi(a, h, o.host) ||
      jvmAutoStartKapisi(j, { host: o.host, jvm: o.jvm, gen: Number(o.gen), enable: o.eylem === 'jboss_autostart_on' });
    if (k) await ogeDurum(o.id, ['PLAN_GECTI'], 'DUSTU', { neden: M(`onay anında: ${k.message}`, 1000) });
    else kalan += 1;
  }
  if (!kalan) {
    await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'BITTI', onaylayan = $2, onay_at = SYSUTCDATETIME(), bitis_at = SYSUTCDATETIME(), hata = $3 WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [id, kim, 'Onay anında uygulanacak öğe kalmadı (sunucu taraması bayatladı ya da JVM durumu değişti).'],
    );
    await sayimYaz(id);
    denetim(req, { op: 'toplu_autostart_onay', id, adet: 0 });
    return { id, adet: 0 };
  }
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'CALISIYOR', onaylayan = $2, onay_at = SYSUTCDATETIME(),
        kira_id = $3, kira_bitis = DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())
      WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
    [id, kim, SUREC_ID],
  );
  if (r.rowCount !== 1) throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
  await db().query(`UPDATE server_hub_toplu_ogeler SET durum = 'BEKLIYOR' WHERE is_id = $1 AND durum = 'PLAN_GECTI'`, [id]);
  await sayimYaz(id);
  denetim(req, { op: 'toplu_autostart_onay', id, adet: kalan });
  return { id, adet: kalan };
}

async function iptal(req, id) {
  const is = await isOku(id);
  if (!is) throw hata(404, `Toplu iş #${id} yok.`);
  const kim = M(req.session?.user?.username || 'unknown', 128);
  if (is.durum === 'PLAN_HAZIR') {
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'IPTAL', iptal_eden = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [id, kim],
    );
    if (r.rowCount !== 1) throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
      [id],
    );
    await sayimYaz(id);
    denetim(req, { op: 'toplu_autostart_iptal', id, durum: 'IPTAL' });
    return { id, durum: 'IPTAL' };
  }
  if (is.durum !== 'PLANLANIYOR' && is.durum !== 'CALISIYOR')
    throw hata(409, `Toplu iş #${id} iptal edilemez (durum ${is.durum}).`, 'durum');
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'IPTAL_ISTENDI', iptal_eden = $2 WHERE id = $1 AND durum IN ('PLANLANIYOR', 'CALISIYOR')`,
    [id, kim],
  );
  if (r.rowCount !== 1) throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
  // Bekleyen ogeler hemen IPTAL; suren AWX isi iptal EDILMEZ (bitmesi beklenir, sonucu yazilir).
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('ADAY', 'BEKLIYOR')`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_autostart_iptal', id, durum: 'IPTAL_ISTENDI' });
  return { id, durum: 'IPTAL_ISTENDI' };
}

// ── YURUTUCU ─────────────────────────────────────────────────────────────────────────────────────

function gruplaHost(liste) {
  const m = new Map();
  for (const o of liste) {
    if (!m.has(o.host)) m.set(o.host, []);
    m.get(o.host).push(o);
  }
  return m;
}

const jvmItems = (liste) => liste.map((o) => ({ gen: Number(o.gen), jvm: o.jvm, action: o.eylem }));

function sonucOku(st) {
  const { extractStatsKey } = require('../opsx/index.cjs');
  return extractStatsKey(st && st.artifacts, 'server_hub_fix_result') || null;
}

/** AWX'ten is durumu; okunamazsa null (sonraki tick yeniden). */
async function isDurumu(serverId, jobId) {
  try {
    return await runner().getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    console.warn(`[TopluAutoStart] is #${jobId} okunamadi:`, e && e.message);
    return null;
  }
}

const zamanAsimi = (o) => o.baslama_at && Date.now() - new Date(o.baslama_at).getTime() > IS_ZAMAN_ASIMI_MS;

/** PLAN fazi: suren plan islerini isle; iptal istenmediyse en cok PLAN_PARALEL host plan isi ac. */
async function planIlerlet(is, og, iptalMi) {
  const suren = gruplaHost(og.filter((o) => o.durum === 'PLANLANIYOR'));
  for (const [host, liste] of suren) {
    const o0 = liste[0];
    if (o0.plan_job_id == null) {
      // ayni surecte launch suresince olmaz (tick tek); burada gorulmesi = yarim kalmis baslatma
      for (const o of liste) await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', { neden: 'plan başlatılamadı (iş numarası yok)' });
      continue;
    }
    const st = await isDurumu(o0.plan_awx_server_id, o0.plan_job_id);
    if (!st || !IS_TERMINAL.has(st.status)) {
      if (zamanAsimi(o0))
        for (const o of liste)
          await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', { neden: `plan işi #${o0.plan_job_id} 3 saatte bitmedi — AWX'ten kontrol edin` });
      continue;
    }
    const result = sonucOku(st);
    const s = ogeSonuclari(jvmItems(liste), result);
    for (let i = 0; i < liste.length; i += 1) {
      const o = liste[i];
      const x = s[i];
      const satir = x.durum ? `${x.durum} ${x.mesaj}`.trim() : null;
      if (x.durum === 'PLAN')
        await ogeDurum(o.id, ['PLANLANIYOR'], 'PLAN_GECTI', { neden: M(x.mesaj || 'canlı değer hâlâ uyumsuz', 1000), sonuc_satiri: M(satir, 1000) });
      else if (x.durum === 'SKIP')
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: M(`canlı değer zaten ${o.hedef} — tarama eski (${x.mesaj})`, 1000),
          sonuc_satiri: M(satir, 1000),
        });
      else if (x.durum)
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', { neden: M(`canlı okumada: ${x.mesaj || x.durum}`, 1000), sonuc_satiri: M(satir, 1000) });
      else
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: M(
            `plan okunamadı (iş #${o0.plan_job_id} ${st.status}${result ? '' : "; set_stats yok — AWX'teki server_hub_fix.yml jboss_autostart_items kipini tanımıyor olabilir (playbook güncel mi?)"})`,
            1000,
          ),
        });
    }
  }
  if (iptalMi) return;
  const tazeOg = await ogeler(is.id);
  const calisan = new Set(tazeOg.filter((o) => o.durum === 'PLANLANIYOR').map((o) => o.host)).size;
  const bekleyen = gruplaHost(tazeOg.filter((o) => o.durum === 'ADAY'));
  let bos = Math.max(0, PLAN_PARALEL - calisan);
  for (const [host, liste] of bekleyen) {
    if (bos <= 0) break;
    if (!(await kiraYenile(is.id))) return;
    const al = await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'PLANLANIYOR', baslama_at = SYSUTCDATETIME()
        WHERE is_id = $1 AND host = $2 AND durum = 'ADAY'
          AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $3)`,
      [is.id, host, SUREC_ID],
    );
    if (al.rowCount < 1) continue;
    bos -= 1;
    try {
      const r = await _d.launch(
        sozdeIstek(is.olusturan),
        FIX_KEY,
        `Server Hub: toplu auto-start #${is.id} plan @ ${host}`,
        { target_host: host, action: LISTE_EYLEMI, plan_only: true, reload: false, jvm_items: jvmItems(liste) },
        { op: 'toplu_autostart_plan', id: is.id, host, adet: liste.length },
      );
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET plan_awx_server_id = $3, plan_job_id = $4 WHERE is_id = $1 AND host = $2 AND durum = 'PLANLANIYOR'`,
        [is.id, host, r.awxServerId, r.jobId],
      );
    } catch (e) {
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = $3, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND host = $2 AND durum = 'PLANLANIYOR'`,
        [is.id, host, M(`plan başlatılamadı: ${e && e.message}`, 1000)],
      );
    }
  }
}

async function planBitir(is) {
  const og = await ogeler(is.id);
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI').length;
  const okunamadi = og.filter((o) => o.durum === 'DUSTU' && /^plan (okunamadı|başlatılamadı)/.test(o.neden || '')).length;
  let durum = 'PLAN_HAZIR';
  let mesaj = null;
  if (!gecen && okunamadi === og.length && og.length) {
    durum = 'PLAN_HATA';
    mesaj = 'Plan hiçbir sunucuda okunamadı — AWX işlerine bakın.';
  } else if (!gecen) {
    durum = 'BITTI';
    mesaj = 'Uygulanacak bir şey kalmadı: canlı değerler zaten hedefte ya da okunamadı.';
  }
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = $2, hata = $3, plan_bitis_at = SYSUTCDATETIME()${durum === 'PLAN_HAZIR' ? '' : ', bitis_at = SYSUTCDATETIME()'}
      WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $4`,
    [is.id, durum, mesaj, SUREC_ID],
  );
  await sayimYaz(is.id);
  if (r.rowCount === 1 && durum !== 'PLAN_HAZIR')
    denetim(sozdeIstek(is.olusturan), { op: 'toplu_autostart_bitti', id: is.id, durum, ok: 0, fail: 0, dusen: og.length - gecen });
}

/** Calisan host isinin sonucu (terminal ise). Donus: true (host bitti). */
async function hostIsiniIsle(is, liste) {
  const o0 = liste[0];
  const st = await isDurumu(o0.awx_server_id, o0.awx_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (zamanAsimi(o0)) {
      for (const o of liste)
        await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
          neden: `iş #${o0.awx_job_id} 3 saatte bitmedi — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
        });
      return true;
    }
    return false;
  }
  const result = sonucOku(st);
  // Dogrulama katmani (kayitliysa: ayni surecte acilan is). Yeniden baslatmadan sonra katman bos; DB yine yazilir.
  const as = autoStart();
  if (as) {
    try {
      as.isBitti(o0.awx_server_id, o0.awx_job_id, st.status, result);
    } catch {
      // katman guncellenemedi: DB sonucu yine yazilir
    }
  }
  const s = ogeSonuclari(jvmItems(liste), result);
  for (let i = 0; i < liste.length; i += 1) {
    const o = liste[i];
    const x = s[i];
    const satir = x.durum ? `${x.durum} ${x.mesaj}`.trim() : null;
    if (x.dogrulandi)
      await ogeDurum(o.id, ['CALISIYOR'], x.durum, { neden: M(x.mesaj, 1000), sonuc_satiri: M(satir, 1000), dogrulandi: 1 });
    else
      await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
        neden: M(x.durum ? x.mesaj || x.durum : `sonuç okunamadı (iş #${o0.awx_job_id} ${st.status})`, 1000),
        sonuc_satiri: M(satir, 1000),
      });
  }
  return true;
}

async function uygulaIlerlet(is, og) {
  const calisan = gruplaHost(og.filter((o) => o.durum === 'CALISIYOR'));
  for (const [, liste] of calisan) {
    if (!(await hostIsiniIsle(is, liste))) return false;
  }
  if (calisan.size) og = await ogeler(is.id);
  // Is numarasi yazilamamis BASLATILIYOR (launch dondu ama DB yazilamadi): 10 dk sonra YARIM_KALDI; asla
  // yeniden baslatilmaz.
  const takili = og.filter((o) => o.durum === 'BASLATILIYOR');
  if (takili.length) {
    const eski = takili.filter((o) => o.baslama_at && Date.now() - new Date(o.baslama_at).getTime() > 10 * 60 * 1000);
    for (const o of eski)
      await ogeDurum(o.id, ['BASLATILIYOR'], 'YARIM_KALDI', {
        neden: "iş numarası yazılamadı — AWX'e gitmiş olabilir; AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın",
      });
    return false;
  }
  if (is.durum !== 'CALISIYOR') return !og.some((o) => o.durum === 'CALISIYOR');
  // Siradaki host (sira'ya gore ilk BEKLIYOR ogesi olan); bir tick'te TEK host baslatilir.
  const bekleyen = og.filter((o) => o.durum === 'BEKLIYOR');
  if (!bekleyen.length) return true;
  const host = bekleyen[0].host;
  let liste = bekleyen.filter((o) => o.host === host);
  // Tek satir isi (bellek kilidi) bu JVM'de suruyorsa oge atlanir (cakisan iki is acilmaz).
  const kalan = [];
  for (const o of liste) {
    const k = _d.surenIsKilidi ? await _d.surenIsKilidi(o.host, o.gen, o.jvm) : null;
    if (k) await ogeDurum(o.id, ['BEKLIYOR'], 'DUSTU', { neden: M(`atlandı: ${k}`, 1000) });
    else kalan.push(o);
  }
  liste = kalan;
  if (!liste.length) return false;
  if (!(await kiraYenile(is.id))) return false;
  const al = await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'BASLATILIYOR', baslama_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND host = $2 AND durum = 'BEKLIYOR'
        AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $1 AND durum = 'CALISIYOR' AND kira_id = $3)
        AND NOT EXISTS (SELECT 1 FROM server_hub_toplu_ogeler x WITH (UPDLOCK, HOLDLOCK)
                         WHERE x.is_id = $1 AND x.host <> $2 AND x.durum IN ('BASLATILIYOR', 'CALISIYOR'))`,
    [is.id, host, SUREC_ID],
  );
  if (al.rowCount < 1) return false;
  const tazeListe = (await ogeler(is.id)).filter((o) => o.host === host && o.durum === 'BASLATILIYOR');
  const as = autoStart();
  const birak = tazeListe.map((o) => (as ? as.rezervasyon(o.host, o.gen, o.jvm) : () => {}));
  let r;
  try {
    let h = null;
    try {
      const a = await _d.getAssessment(false);
      h = (a.hosts || []).find((x) => x.host === host) || null;
    } catch {
      h = null;
    }
    const items = jvmItems(tazeListe);
    try {
      r = await _d.launch(
        sozdeIstek(is.onaylayan || is.olusturan),
        FIX_KEY,
        `Server Hub: toplu auto-start #${is.id} @ ${host} (${items.length} JVM)`,
        { target_host: host, action: LISTE_EYLEMI, plan_only: false, reload: false, jvm_items: items },
        { op: 'toplu_autostart_uygula', id: is.id, host, items },
      );
    } catch (e) {
      // AWX isi acilmadi: bu host FAIL, toplu is DURMAZ (sonraki tick sonraki host).
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'FAIL', neden = $3, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND host = $2 AND durum = 'BASLATILIYOR'`,
        [is.id, host, M(`iş başlatılamadı: ${e && e.message}`, 1000)],
      );
      return false;
    }
    if (as) as.isKaydetToplu(r.awxServerId, r.jobId, { host, h, items });
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'CALISIYOR', awx_server_id = $3, awx_job_id = $4 WHERE is_id = $1 AND host = $2 AND durum = 'BASLATILIYOR'`,
      [is.id, host, r.awxServerId, r.jobId],
    );
  } finally {
    for (const b of birak) b();
  }
  return false;
}

async function uygulaBitir(is) {
  await sayimYaz(is.id);
  const son = await isOku(is.id);
  const iptalMi = son.durum === 'IPTAL_ISTENDI';
  if (iptalMi)
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
      [is.id],
    );
  await sayimYaz(is.id);
  const s = await isOku(is.id);
  // YARIM_KALDI oge (is numarasi yazilamadi; AWX'e gitmis olabilir) da kirmizidir: yesil "Tamamlandi" onu gizlemez.
  const og = await ogeler(is.id);
  const kirmizi = s.fail_sayisi > 0 || og.some((o) => o.durum === 'YARIM_KALDI');
  const durum = iptalMi ? 'IPTAL' : kirmizi ? 'BITTI_HATALI' : 'BITTI';
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = $2, bitis_at = SYSUTCDATETIME(), kira_id = NULL, kira_bitis = NULL
      WHERE id = $1 AND durum IN ('CALISIYOR', 'IPTAL_ISTENDI', 'PLANLANIYOR') AND kira_id = $3`,
    [is.id, durum, SUREC_ID],
  );
  if (r.rowCount === 1)
    denetim(sozdeIstek(s.onaylayan || s.olusturan), {
      op: 'toplu_autostart_bitti',
      id: is.id,
      durum,
      ok: s.ok_sayisi,
      skip: s.skip_sayisi,
      fail: s.fail_sayisi,
      dusen: s.dusen,
    });
}

/**
 * KIRASI DUSMUS aktif is: ILERLETILMEZ. Yalniz isaretlenir; is numarasi olan CALISIYOR ogeler izlenmeye devam
 * eder (sonuc yazilir, yeniden baslatilmaz).
 */
async function yarimBirak(is) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'YARIM_KALDI', kira_id = NULL, kira_bitis = NULL, bitis_at = SYSUTCDATETIME(),
        hata = $3
      WHERE id = $1 AND durum = $2 AND (kira_id IS NULL OR kira_id <> $4) AND (kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME())`,
    [is.id, is.durum, "Portal yeniden başladı ya da yürütücü durdu — iş kaldığı yerden DEVAM ETTİRİLMEDİ (sessiz yeniden koşma yok). Çalışan host işleri izlenir; gerisi için listeyi yenileyip yeni toplu iş açın.", SUREC_ID],
  );
  if (r.rowCount !== 1) return;
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum IN ('ADAY', 'PLAN_GECTI', 'BEKLIYOR', 'PLANLANIYOR')`,
    [is.id, 'Portal yeniden başladı — çalıştırılmadı'],
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum = 'BASLATILIYOR' AND awx_job_id IS NULL`,
    [is.id, "AWX'e gitmiş olabilir — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın"],
  );
  await sayimYaz(is.id);
  denetim(sozdeIstek('toplu-autostart-yurutucu'), { op: 'toplu_autostart_yarim_kaldi', id: is.id, onceki: is.durum });
}

/** YARIM_KALDI isin is numarali CALISIYOR ogeleri: yalniz sonuc okunur. */
async function izle(is) {
  const og = await ogeler(is.id);
  const calisan = gruplaHost(og.filter((o) => o.durum === 'CALISIYOR' && o.awx_job_id != null));
  for (const [, liste] of calisan) await hostIsiniIsle(is, liste);
  if (calisan.size) await sayimYaz(is.id);
}

async function tick() {
  if (!_d || typeof _d.launch !== 'function') return;
  const { rows } = await db().query(
    `SELECT *, CASE WHEN kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME() THEN 1 ELSE 0 END AS kira_dustu
       FROM server_hub_toplu_isler WHERE tur = $1 AND durum IN (${IN([...YURUYEN, 'PLAN_HAZIR'])}) ORDER BY id`,
    [TUR],
  );
  for (const is of rows || []) {
    try {
      // Onay bekleyen is ILERLETILMEZ (kirasi yok sayilir); 15 dk'yi asinca PLAN_ESKIDI olur, kilitler kalkar.
      if (is.durum === 'PLAN_HAZIR') {
        if (planEskiMi(is)) await planEskit(sozdeIstek('toplu-autostart-yurutucu'), is.id);
        continue;
      }
      if (is.kira_id !== SUREC_ID) {
        if (Number(is.kira_dustu) === 1) await yarimBirak(is);
        continue;
      }
      if (!(await kiraYenile(is.id))) continue;
      let og = await ogeler(is.id);
      const iptalMi = is.durum === 'IPTAL_ISTENDI';
      // Onaylanmamis is PLAN fazindadir (iptal istense de: suren plan isi biter, sonra IPTAL).
      if (is.durum === 'PLANLANIYOR' || (iptalMi && !is.onay_at)) {
        await planIlerlet(is, og, iptalMi);
        og = await ogeler(is.id);
        if (iptalMi) {
          if (!og.some((o) => o.durum === 'PLANLANIYOR')) await uygulaBitir(is);
          else await sayimYaz(is.id);
        } else if (!og.some((o) => o.durum === 'ADAY' || o.durum === 'PLANLANIYOR')) await planBitir(is);
        else await sayimYaz(is.id);
        continue;
      }
      const bitti = await uygulaIlerlet(is, og);
      if (bitti) await uygulaBitir(is);
      else await sayimYaz(is.id);
    } catch (e) {
      console.warn(`[TopluAutoStart] is #${is.id} ilerletilemedi:`, e && e.message);
    }
  }
  // YARIM_KALDI isler: is numarali CALISIYOR ogeler izlenir (yeniden baslatilmaz).
  const y = await db().query(
    `SELECT DISTINCT i.* FROM server_hub_toplu_isler i JOIN server_hub_toplu_ogeler o ON o.is_id = i.id
      WHERE i.tur = $1 AND i.durum = 'YARIM_KALDI' AND o.durum = 'CALISIYOR'`,
    [TUR],
  );
  for (const is of y.rows || []) {
    try {
      await izle(is);
    } catch (e) {
      console.warn(`[TopluAutoStart] is #${is.id} izlenemedi:`, e && e.message);
    }
  }
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[TopluAutoStart] tick hatasi:', e && e.message))
      .finally(() => {
        _ticking = false;
      });
  }, POLL_SN * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[TopluAutoStart] yurutucu basladi (${POLL_SN} sn)`);
}

// ── UCLAR ────────────────────────────────────────────────────────────────────────────────────────

function mount(router, deps) {
  kur(deps);
  const gonder = (res, err) =>
    res.status(err.status || 500).json({ ok: false, message: err.message, ...(err.code ? { code: err.code } : {}) });

  router.get('/toplu-autostart/adaylar', async (req, res) => {
    try {
      const [a, limit, akt] = await Promise.all([
        _d.getAssessment(req.query.fresh === '1'),
        _d.ayarlar.limit('toplu_autostart'),
        aktifIs().catch(() => null),
      ]);
      if (a.tableMissing) return res.json({ ok: true, adaylar: [], dislananlar: [], limit, aktif: isSatiri(akt), latestScan: null });
      const { adaylar, dislananlar } = adaylariTuret(a);
      res.json({ ok: true, adaylar, dislananlar, limit, aktif: isSatiri(akt), latestScan: a.latestScan || null, schemaUnknown: a.schemaUnknown === true });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.get('/toplu-autostart', async (req, res) => {
    try {
      const { rows } = await db().query(`SELECT TOP 10 * FROM server_hub_toplu_isler WHERE tur = $1 ORDER BY id DESC`, [TUR]);
      const akt = (rows || []).find((r) => AKTIF.includes(r.durum)) || (await aktifIs());
      res.json({ ok: true, aktif: isSatiri(akt), son: (rows || []).map(isSatiri) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.get('/toplu-autostart/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const is = await isOku(id);
      if (!is) return res.status(404).json({ ok: false, message: `Toplu iş #${id} yok.` });
      res.json({ ok: true, is: isSatiri(is), ogeler: (await ogeler(id)).map(ogeSatiri) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.post('/toplu-autostart', async (req, res) => {
    try {
      res.json({ ok: true, ...(await olustur(req, req.body && req.body.secim)) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.post('/toplu-autostart/:id/onayla', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    if (req.body?.confirmed !== true) return res.status(400).json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    try {
      res.json({ ok: true, ...(await onayla(req, id)) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.post('/toplu-autostart/:id/iptal', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      res.json({ ok: true, ...(await iptal(req, id)) });
    } catch (err) {
      gonder(res, err);
    }
  });
}

module.exports = {
  TUR,
  KIRA_SN,
  PLAN_YAS_MS,
  PLAN_PARALEL,
  AKTIF,
  KILITLI_OGE,
  SUREC_ID,
  mount,
  kur,
  adaylariTuret,
  secimiDuzle,
  topluKilidi,
  olustur,
  onayla,
  iptal,
  tick,
  startPoller,
  _durdurForTest: () => {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _ticking = false;
  },
};
