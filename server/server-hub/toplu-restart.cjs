// server/server-hub/toplu-restart.cjs - Server Hub > Toplu Restart (2026-11-14).
//
// Kullanici: "JBoss8 DOCCOREFILESERVICE calisiyor ama yapilandirilan JVM parametreleri calisan surectekinden
// FARKLI uyarilari ... bunlar icin de toplu restart et sayfasi getirir misin?" (bulgu JVM_PARAM_FARKI).
//
// GUVENLIK MODELI (kullaniciya verilen soz):
//   1. Liste yalniz TAZE taramada farki olan (jvm_arg_diff -> argFark 1), CALISAN (olculmus) JVM'ler; farkli
//      parametreler (maskeli) gosterilir, varsayilan hepsi secili. Bulgu kuraliyla AYNI yuklem (assess.cjs
//      JVM_PARAM_FARKI) + yazma kapilari (sema bilinir, taze sunucu, tanimli surec).
//   2. TEK DUGME once SALT OKUNUR ONIZLEME acar: secilen sunucularin server_hub_scan isi (sunucuda hicbir sey
//      degismez; yalniz tarama satirlari yuklenir). Is bitince her sunucunun GERCEKTEN yuklendigi kanitlanir
//      (sonuc hosts + loader excluded + loaded_at ONCEKI degerden buyuk; Date.now ile DEGIL) ve her JVM yeniden
//      degerlendirilir: hala calisiyor + fark hala var + farkli anahtarlar ortusuyor -> gecer; degilse duser.
//   3. Onay (15 dk icinde). Onayda AWX legacy sablonu Limit'i kabul etmiyorsa (ask_limit_on_launch) onay
//      VERILMEZ: AWX limit'i yutar ve restart TUM envanterde kosardi.
//   4. JVM'ler TEK TEK: bir sonraki ancak oncekinin restart isi bitip JVM STARTED (set_stats
//      opsx_serverconfig_ops_result) olduktan VE dogrulama taramasi yuklendikten sonra baslar. Ayni anda tek
//      oge kostugu icin ayni uygulamanin kopyalari (ayni JVM adi / grubu, baska sunucu) ASLA ayni anda restart
//      edilmez; siralama kopyalari ardisik koymamaya calisir.
//   5. Her restart'tan sonra o sunucu yeniden taranir (mevcut server_hub_scan, tek sunucu): fark kapandi mi?
//      Kapanmadiysa "tarama yanlis uyari veriyor olabilir (...)" yazilir; YENIDEN DENENMEZ.
//   6. Restart'in kaniti: set_stats start_state=STARTED ve/veya taramada surec baslangic zamani (process_start_epoch)
//      ONCEKI taramadakinden farkli + JVM calisiyor. Ikisi de yoksa oge BASARISIZ.
//   7. BASARISIZLIK (JVM ayaga kalkmadi / is dustu): toplu is DURMAZ ama ayni uygulamanin (ayni JVM adi ya da
//      grubu) bekleyen kopyalari ATLANIR (hepsini birden dusurmemek icin); ozet kirmizi.
//   8. URETIM: OpsX'in prod kapisi (Smart onayi) zaman uyumsuz ve tek is icin tasarli; Admin atlama / onay kapali
//      yollari onaysiz kosar. Kapi atlanmasin diye prod (ve ortami bilinmeyen) sunucu toplu listeye ALINMAZ
//      ("prod - OpsX'ten tek tek"); OpsX tarafindaki topluRestartBaslat da prod istegi reddeder (iki katman).
//      Metadatahub standalone hostlari (OpsX main.yml tam script restart) de alinmaz.
//   9. Restart, OpsX route'unun AYNI fonksiyonlariyla acilir (legacyIstegiHazirla + opsxIsiBaslat): anti-TOCTOU
//      envanter kontrolu, server_config_map dogrulamasi, extra_vars on kontrolu, is gecmisi, 'opsx_operation'
//      denetimi. Her OpsX isi Teams karti da atar (ekran onayda soyler).
//
// DURUM DB'DE (server_hub_toplu_isler / server_hub_toplu_ogeler, tur='RESTART'; Toplu Auto-Start ile ayni
// tablolar): sayfa yenilense ya da baska admin acsa ilerleme gorunur; yurutme sunucu tarafinda (tick 10 sn).
// Oge ayrintisi (grup, uygulama, maskeli fark, tarama oncesi loaded_at / surec baslangici, is numaralari) 'ek'
// JSON'unda. Yalniz MASKELI fark metni saklanir.
//
// YENIDEN BASLATMADA SESSIZ YENIDEN KOSMA YOK: kirasi dusmus aktif is YARIM_KALDI olur; baslamamis ogeler
// "calistirilmadi", suren restart / dogrulama taramasi ogeleri is numaralariyla YARIM_KALDI ("AWX'ten kontrol
// edin, sunucuyu yeniden tarayin"). Hicbir oge yeniden baslatilmaz.
//
// IPTAL: yeni JVM baslatilmaz; suren restart isi (ve onun dogrulama taramasi) biter; bekleyenler IPTAL.
//
// SONUCU BILINMEYEN RESTART (inceleme 2026-11-14): launch istegi belirsiz hatayla dondu (AWX'e gitmis olabilir),
// is numarasi yazilamadi (BASLATILIYOR takili), restart isi 45 dk'da bitmedi ya da Portal restart surerken yeniden
// basladi -> oge YARIM_KALDI / FAIL olur ve nedenine BELIRSIZ_IZ yazilir. Boyle bir oge varken:
//   - ayni toplu isin bekleyenleri ATLANDI ("toplu is durduruldu"), is BITTI_HATALI (sessiz devam yok);
//   - JVM kilidi (topluKilidi) AWX isi bitene kadar (is numarasi yoksa 45 dk) KALKMAZ;
//   - yeni toplu restart'ta ayni uygulamanin kopyalari ATLANDI, digerleri o is bitene kadar BEKLER.
// PLAN_HAZIR is 15 dk icinde onaylanmazsa yurutucu onu PLAN_ESKIDI yapar (JVM kilitleri kalkar). 15 dk
// onizleme BITTIGINDE (plan_bitis_at) baslar; onizleme taramasinin kendi suresi dahil degil.
//
// AWX IS BOYUTU (2026-11-15, Toplu Auto-Start parcalamasi 'limit:toplu_is_basina_jvm' ile birlikte incelendi):
// burada parcalama GEREKMEZ. Restart isi zaten JVM basina TEK AWX isi (OpsX legacy restart, tek JVM); onizleme
// ve dogrulama isleri JVM basina jboss-cli acmayan server_hub_scan taramasidir (onizleme sunuculari
// 'limit:tara' kadarlik parcalarla tarar). toplu_is_basina_jvm bu modulde okunmaz.
'use strict';

const crypto = require('node:crypto');
const { maskJvmArgDiff } = require('./mask.cjs');

const TUR = 'RESTART';
const SCAN_KEY = 'server_hub_scan';
const POLL_SN = 10;
const KIRA_SN = 120;
const PLAN_YAS_MS = 15 * 60 * 1000;
const RESTART_ZAMAN_ASIMI_MS = 45 * 60 * 1000;
const TARAMA_ZAMAN_ASIMI_MS = 60 * 60 * 1000;
const STATS_KEY = 'opsx_serverconfig_ops_result';
const AKTIF = ['PLANLANIYOR', 'PLAN_HAZIR', 'CALISIYOR', 'IPTAL_ISTENDI'];
const YURUYEN = ['PLANLANIYOR', 'CALISIYOR', 'IPTAL_ISTENDI'];
// Oge durumlari: SECIM (istekle yazildi; taze degerlendirme yurutucude) -> ADAY | DUSTU; ADAY -> PLANLANIYOR (onizleme taramasi) -> PLAN_GECTI | DUSTU -> BEKLIYOR -> BASLATILIYOR ->
// CALISIYOR (restart isi) -> TARANIYOR (dogrulama taramasi) -> KAPANDI | KAPANMADI | FAIL; ayrica ATLANDI
// (onaydan sonra calistirilmadi: kopya korumasi / kilit / artik aday degil / prod), IPTAL, YARIM_KALDI.
const SECIM = 'SECIM';
const KILITLI_OGE = [
  SECIM,
  'ADAY',
  'PLANLANIYOR',
  'PLAN_GECTI',
  'BEKLIYOR',
  'BASLATILIYOR',
  'CALISIYOR',
  'TARANIYOR',
];
const SUREN_OGE = ['BASLATILIYOR', 'CALISIYOR', 'TARANIYOR'];
const IS_TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE_VARSAYILAN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const OLUSTURULUYOR = 'OLUSTURULUYOR';
const DIFF_MAX = 600;
// Sonucu bilinmeyen restart ogesinin neden metninde HER ZAMAN bulunur; yetimRestartlar bununla arar.
const BELIRSIZ_IZ = "AWX'te sürüyor olabilir";
const YETIM_PENCERE_SAAT = 6;
const TAKILI_MS = 10 * 60 * 1000;
// Secimin taze degerlendirmeyle dogrulanmasi bu sure icinde basaramazsa ogeler DUSTU (is PLAN_HATA).
const SECIM_ZAMAN_ASIMI_MS = 10 * 60 * 1000;
const KILIT_PARALEL = 5;
// Basarisiz dogrulama denemesinden sonra en erken yeniden deneme (TBMWANS zorlanirken her tick'te tum filoyu
// okumasin; 10 sn'lik tick yerine 30 sn). Bellek ici: is id -> ms.
const SECIM_YENIDEN_MS = 30 * 1000;
const _secimSonraki = new Map();
// Durdurmayi kanitlayan kill sonuclari (jboss_serverconfig_ops.yml): kill -9 gitti ya da surec kalmamis.
const DURDU_KILL = ['KILL_OK', 'KILL_YOK'];
const KAPANMADI_NOTU =
  "tarama yanlış uyarı veriyor olabilir (server-group jvm ayarı domain.xml'de olabilir ya da host XML diskte değişmiş ama host controller yeniden yüklenmemiş olabilir)";

const SUREC_ID = crypto.randomBytes(16).toString('hex');

let _d = null;
let _timer = null;
let _ticking = false;

const db = () => require('../db/index.cjs');
const runner = () => require('../ansible/runner.cjs');
const opsx = () => require('../opsx/index.cjs');
const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const IN = (l) => l.map((x) => `'${x}'`).join(', ');
const L = (s) => String(s || '').toLowerCase();
const hata = (status, message, code) => Object.assign(new Error(message), { status, code });

function kur(deps) {
  _d = deps || null;
}

const hostRe = () => _d?.HOST_RE || HOST_RE_VARSAYILAN;
const autoStart = () => (_d && typeof _d.autoStart === 'function' ? _d.autoStart() : null);

function denetim(req, detail) {
  try {
    if (_d?.audit) _d.audit(req, detail);
  } catch {
    // denetim kaydi yazilamadi: islem yine tamam
  }
}

function sozdeIstek(kim) {
  const ad = M(kim, 128) || 'unknown';
  return {
    session: { user: { username: ad, displayName: ad, role: 'Admin' } },
    sessionID: null,
    ip: null,
  };
}

const ekOku = (o) => {
  try {
    const x = JSON.parse(o?.ek || '{}');
    return x && typeof x === 'object' ? x : {};
  } catch {
    return {};
  }
};
const ekYaz = (x) => JSON.stringify(x || {});

// ── FARK METNI ───────────────────────────────────────────────────────────────────────────────────

/** Maskeli jvm_arg_diff -> { metin (<= DIFF_MAX), anahtarlar } ('<anahtar> running=.. configured=..' ogeleri). */
function farkOzeti(ham) {
  const m = maskJvmArgDiff(ham == null ? null : String(ham));
  if (!m) return { metin: '', anahtarlar: [] };
  const govde = m.replace(/^partial; /, '').replace(/ \.\.\.\+[0-9]+$/, '');
  const anahtarlar = [];
  if (!/^reason=/.test(govde))
    for (const oge of govde.split('; ')) {
      const a = oge.split(' ')[0];
      if (a?.startsWith('-') && !anahtarlar.includes(a)) anahtarlar.push(a);
    }
  return { metin: m.length > DIFF_MAX ? `${m.slice(0, DIFF_MAX - 1)}…` : m, anahtarlar };
}

/** Sunucularin agir fark kolonlari (maskelenmeden once ham), host basina Map. Okunamazsa bos Map. */
async function farklariOku(hostlar) {
  const out = new Map();
  if (_d && typeof _d.loadJvmAgir === 'function') {
    const kol = typeof _d.loadJvmAgir.semaOku === 'function' ? _d.loadJvmAgir.semaOku() : undefined;
    const liste = [...new Set(hostlar)];
    for (let i = 0; i < liste.length; i += 10) {
      const parca = liste.slice(i, i + 10);
      const sonuc = await Promise.all(
        parca.map((h) => _d.loadJvmAgir(h, kol ? { kol } : undefined).catch(() => new Map())),
      );
      parca.forEach((h, k) => out.set(h, sonuc[k]));
    }
  }
  return out;
}

const agirFark = (agir, h, gen, jvm) => {
  const m = agir.get(h);
  const r = m ? m.get(`${Number(gen)}|${L(jvm)}`) : null;
  return r ? r.jvm_arg_diff : null;
};

// ── ADAYLAR ──────────────────────────────────────────────────────────────────────────────────────

/** Envanter (MWAppsInventory) bu JVM'le eslesti mi (assess hit.invStatus / invJvmCount yazar)? */
const envanterdeMi = (j) => Object.hasOwn(j, 'invStatus') || Object.hasOwn(j, 'invJvmCount');

/**
 * Filo adlandirma kurali (assess.cjs envOf ile AYNI desen): kisa adin ortam harfi P ise PROD. Envanter ortami
 * yanlis etiketlenmis olabilir; toplu yol ikisinden biri prod diyorsa durur ("OpsX'ten tek tek").
 */
function adKuraliProd(host) {
  const m = /^[A-Z]{4,6}?(A?)([DTQPO])\d+$/.exec(
    String(host || '')
      .trim()
      .toUpperCase()
      .split('.')[0],
  );
  return !!m && m[2] === 'P';
}

/** Fark bulgusunun yuklemi (assess.cjs JVM_PARAM_FARKI ile AYNI). */
const farkliCalisiyor = (j) =>
  !!j && j.runningKnown !== false && j.running === true && j.argFark === 1;

/**
 * Restart yazma kapisi. Donus: null (gecer) ya da neden metni. Prod / ortam bilinmiyor / standalone burada
 * durur ("OpsX'ten tek tek"); OpsX topluRestartBaslat ayni kontrolu envanter ortamiyla yeniden yapar.
 */
function restartKapisi(a, h, j) {
  if (a?.schemaUnknown === true || h?.schemaUnknown === true)
    return 'Server Hub şeması (sys.columns) okunamadı — eylem önerilmez.';
  if (h?.fresh !== true)
    return `tarama bayat (${h?.scanDate || '?'}${h?.loadExcluded ? ', son yükleme dışlandı' : ''}) — önce sunucuyu yeniden tarayın.`;
  if (!j) return 'JVM taramada yok.';
  if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE')
    return 'tanım kaynağında yok (ps’te tanımsız süreç) — restart edilmez.';
  if (Number(j.gen) !== 7 && Number(j.gen) !== 8) return 'JBoss sürümü (7/8) bilinmiyor.';
  if (!JVM_RE.test(String(j.name || ''))) return 'JVM adı geçersiz.';
  if (h.env === 'PROD')
    return "prod — OpsX'ten tek tek (Smart onayı; toplu restart prod'a dokunmaz).";
  if (!h.env || h.env === 'BILINMIYOR')
    return "ortamı bilinmiyor (prod olabilir) — OpsX'ten tek tek.";
  const pa = require('../opsx/prod-approval.cjs');
  if (pa.uretimIstegi([{ alan: 'sunucu', deger: [h.host] }]).uretim)
    return "sunucu adı prod — OpsX'ten tek tek.";
  if (adKuraliProd(h.host))
    return `sunucu adı kuralına göre prod (envanter ${h.env} diyor; çelişki) — OpsX'ten tek tek.`;
  if (opsx().metadatahubHostMu(h.host))
    return "standalone (metadatahub) — OpsX restart burada tam script restart'ı çalıştırır; OpsX'ten tek tek.";
  if (!envanterdeMi(j))
    return "envanterde (MWAppsInventory) eşleşen uygulama yok — OpsX restart'ı uygulama adıyla çalışır; OpsX'ten tek tek.";
  return null;
}

/**
 * Taze degerlendirmeden aday listesi: { adaylar, dislananlar }. aday: { host, env, gen, jvm, grp, scanDate,
 * fark, anahtarlar }. agir verilirse farklar ondan okunur (ekran); verilmezse fark bos.
 */
function adaylariTuret(a, agir) {
  const as = autoStart();
  const adaylar = [];
  const dislananlar = [];
  for (const h of a?.hosts || []) {
    if (h.taramadanDustu) continue;
    // Ayni sunucuda ayni (gen, JVM adi) iki kayit: hangisinin restart edilecegi belirsiz, aday olmaz.
    const tekrar = new Map();
    for (const x of h.jvms || []) {
      const tk = ogeAnahtari(h.host, x.gen, x.name);
      tekrar.set(tk, (tekrar.get(tk) || 0) + 1);
    }
    const ikiKez = new Set();
    for (const j of h.jvms || []) {
      if (!farkliCalisiyor(j)) continue;
      const tk = ogeAnahtari(h.host, j.gen, j.name);
      if ((tekrar.get(tk) || 0) > 1) {
        if (!ikiKez.has(tk))
          dislananlar.push({
            host: h.host,
            env: h.env || null,
            envGroup: h.envGroup || null,
            gen: Number(j.gen),
            jvm: j.name,
            grp: j.group || '',
            scanDate: h.scanDate || null,
            fark: '',
            anahtarlar: [],
            neden:
              'Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, restart edilmez; sunucu ayrıntısından bakın.',
          });
        ikiKez.add(tk);
        continue;
      }
      const fo = farkOzeti(agir ? agirFark(agir, h.host, j.gen, j.name) : null);
      const satir = {
        host: h.host,
        env: h.env || null,
        envGroup: h.envGroup || null,
        gen: Number(j.gen),
        jvm: j.name,
        grp: j.group || '',
        scanDate: h.scanDate || null,
        fark: fo.metin,
        anahtarlar: fo.anahtarlar,
      };
      const k = restartKapisi(a, h, j);
      if (k) {
        dislananlar.push({ ...satir, neden: k });
        continue;
      }
      const s = as ? as.surenIs(h.host, j.gen, j.name) : null;
      if (s) {
        dislananlar.push({
          ...satir,
          neden: s.jobId ? `auto-start işi #${s.jobId} sürüyor` : 'auto-start işi başlatılıyor',
        });
        continue;
      }
      adaylar.push(satir);
    }
  }
  const sira = (x, y) =>
    x.host < y.host
      ? -1
      : x.host > y.host
        ? 1
        : x.gen - y.gen || (x.jvm < y.jvm ? -1 : x.jvm > y.jvm ? 1 : 0);
  adaylar.sort(sira);
  dislananlar.sort(sira);
  return { adaylar, dislananlar };
}

const ogeAnahtari = (host, gen, jvm) =>
  `${String(host || '').toUpperCase()}|${Number(gen)}|${L(jvm)}`;
const kopyaAnahtari = (x) => L(x.jvm);

/**
 * Siralama: ayni uygulamanin kopyalari (ayni JVM adi) ARDISIK olmasin (round-robin). Tek seferde tek oge kostugu
 * icin kopyalar zaten asla ayni anda degil; bu, bir kopya dustugunde digerlerinin atlanabilmesi icin zaman da tanir.
 */
function siraKarisik(liste) {
  const gruplar = new Map();
  for (const x of liste) {
    const k = kopyaAnahtari(x);
    if (!gruplar.has(k)) gruplar.set(k, []);
    gruplar.get(k).push(x);
  }
  const kuyruk = [...gruplar.values()].sort(
    (p, q) => q.length - p.length || (kopyaAnahtari(p[0]) < kopyaAnahtari(q[0]) ? -1 : 1),
  );
  const out = [];
  let son = null;
  while (out.length < liste.length) {
    kuyruk.sort((p, q) => q.length - p.length);
    let g = kuyruk.find((x) => x.length && kopyaAnahtari(x[0]) !== son);
    if (!g) g = kuyruk.find((x) => x.length);
    const x = g.shift();
    out.push(x);
    son = kopyaAnahtari(x);
  }
  return out;
}

// ── DB ───────────────────────────────────────────────────────────────────────────────────────────

async function aktifIs() {
  const { rows } = await db().query(
    `SELECT TOP 1 * FROM server_hub_toplu_isler WHERE tur = $1 AND durum IN (${IN(AKTIF)}) ORDER BY id DESC`,
    [TUR],
  );
  return rows?.[0] || null;
}

async function isOku(id) {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_toplu_isler WHERE id = $1 AND tur = $2`,
    [id, TUR],
  );
  return rows?.[0] || null;
}

async function ogeler(isId) {
  const { rows } = await db().query(
    `SELECT * FROM server_hub_toplu_ogeler WHERE is_id = $1 ORDER BY sira`,
    [isId],
  );
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
    kapandi: r.ok_sayisi,
    kapanmadi: r.skip_sayisi,
    fail: r.fail_sayisi,
    hata: r.hata || null,
    createdAt: iso(r.created_at),
    planBitisAt: iso(r.plan_bitis_at),
    onayAt: iso(r.onay_at),
    bitisAt: iso(r.bitis_at),
  };
}

function ogeSatiri(r) {
  const ek = ekOku(r);
  return {
    id: r.id,
    sira: r.sira,
    host: r.host,
    env: r.env || null,
    gen: r.gen,
    jvm: r.jvm,
    grp: ek.grp || '',
    uygulama: ek.application || null,
    fark: ek.fark || '',
    farkSonra: ek.farkSonra == null ? null : ek.farkSonra,
    durum: r.durum,
    neden: r.neden || null,
    planJobId: r.plan_job_id || null,
    awxServerId: r.awx_server_id == null ? null : r.awx_server_id,
    restartJobId: r.awx_job_id || null,
    taramaJobId: ek.taramaJob?.jobId || null,
    startState: ek.restart?.startState || null,
    baslamaAt: iso(r.baslama_at),
    bitisAt: iso(r.bitis_at),
  };
}

/** Sayimlar: ok_sayisi = KAPANDI, skip_sayisi = KAPANMADI, fail_sayisi = FAIL (+ YARIM_KALDI is sonu ayri). */
async function sayimYaz(isId) {
  await db().query(
    `UPDATE server_hub_toplu_isler SET
        aday = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1),
        plan_gecti = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum NOT IN ('SECIM', 'ADAY', 'PLANLANIYOR', 'DUSTU')),
        dusen = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum IN ('DUSTU', 'ATLANDI')),
        ok_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'KAPANDI'),
        skip_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'KAPANMADI'),
        fail_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'FAIL')
      WHERE id = $1`,
    [isId],
  );
}

async function kiraYenile(isId) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET kira_bitis = DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())
      WHERE id = $1 AND kira_id = $2`,
    [isId, SUREC_ID],
  );
  return r.rowCount === 1;
}

const BITIS_DURUMLARI = [
  'KAPANDI',
  'KAPANMADI',
  'FAIL',
  'DUSTU',
  'ATLANDI',
  'IPTAL',
  'YARIM_KALDI',
];

/** Ogeye durum yaz; yalniz beklenen durumdaysa (CAS). */
async function ogeDurum(id, eski, yeni, alanlar = {}) {
  const set = ['durum = $2'];
  const p = [id, yeni];
  for (const [k, v] of Object.entries(alanlar)) {
    p.push(v);
    set.push(`${k} = $${p.length}`);
  }
  if (BITIS_DURUMLARI.includes(yeni)) set.push('bitis_at = SYSUTCDATETIME()');
  p.push(...eski);
  const kosul = eski.map((_, i) => `$${p.length - eski.length + i + 1}`).join(', ');
  const r = await db().query(
    `UPDATE server_hub_toplu_ogeler SET ${set.join(', ')} WHERE id = $1 AND durum IN (${kosul})`,
    p,
  );
  return r.rowCount === 1;
}

// ── KILIT ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Bu JVM bir toplu restart'in bekleyen / suren ogesi mi? Donus: 409 mesaji ya da null. Auto-start (tek satir,
 * /fix, Toplu Auto-Start) restart suren JVM'e dokunmasin. DB okunamazsa null (auto-start betigi canli okur).
 * haricIs: secimi dogrulanan isin kendi ogeleri (SECIM) sayilmaz. yetimler: bir kez okunmus yetimRestartlar()
 * listesi (secim dogrulamasinda oge basina yeniden okunmaz; okunmadiysa burada okunur).
 */
async function topluKilidi(host, gen, jvm, { haricIs = null, yetimler = null } = {}) {
  try {
    const p = [TUR, String(host || '').toUpperCase(), Number(gen), String(jvm || '')];
    let haric = '';
    if (haricIs != null) {
      p.push(Number(haricIs));
      haric = ' AND o.is_id <> $5';
    }
    const { rows } = await db().query(
      `SELECT TOP 1 o.is_id, o.durum FROM server_hub_toplu_ogeler o
         JOIN server_hub_toplu_isler i ON i.id = o.is_id
        WHERE i.tur = $1 AND o.host = $2 AND o.gen = $3 AND o.jvm = $4${haric} AND o.durum IN (${IN(KILITLI_OGE)})
        ORDER BY o.is_id DESC`,
      p,
    );
    const r = rows?.[0];
    if (r)
      return `${jvm} toplu restart işi #${r.is_id} içinde (${r.durum}) — o iş bitene ya da iptal edilene kadar bu JVM'e iş açılmaz (iş açılmadı). Server Hub › Toplu Restart sekmesinden izleyin.`;
    const H = String(host || '').toUpperCase();
    const y = (yetimler || (await yetimRestartlar())).find(
      (x) => x.host === H && Number(x.gen) === Number(gen) && L(x.jvm) === L(jvm),
    );
    if (!y) return null;
    return `${jvm} için toplu restart işi #${y.is_id} öğesinin sonucu bilinmiyor (${yetimMetni(y)}) — AWX işi bitene kadar bu JVM'e iş açılmaz (iş açılmadı).`;
  } catch (e) {
    console.warn('[TopluRestart] kilit okunamadi:', e?.message);
    return null;
  }
}

/**
 * Sonucu BILINMEYEN restart ogeleri (tum toplu restart isleri, son YETIM_PENCERE_SAAT saat): neden BELIRSIZ_IZ
 * tasir ve AWX isi bitmemis (okunamiyorsa bitmemis sayilir) ya da is numarasi yok ve baslamasindan bu yana
 * RESTART_ZAMAN_ASIMI_MS gecmemis. Donus: [{ id, is_id, host, gen, jvm, grp, jobId }]. DB okunamazsa firlatir.
 */
async function yetimRestartlar() {
  const { rows } = await db().query(
    `SELECT o.id, o.is_id, o.host, o.gen, o.jvm, o.ek, o.awx_server_id, o.awx_job_id, o.baslama_at
       FROM server_hub_toplu_ogeler o JOIN server_hub_toplu_isler i ON i.id = o.is_id
      WHERE i.tur = $1 AND o.durum IN ('YARIM_KALDI', 'FAIL') AND o.neden LIKE $2
        AND o.bitis_at > DATEADD(hour, -${YETIM_PENCERE_SAAT}, SYSUTCDATETIME())`,
    [TUR, `%${BELIRSIZ_IZ}%`],
  );
  const out = [];
  for (const o of rows || []) {
    let suruyor;
    if (o.awx_job_id != null) {
      const st = await isDurumu(o.awx_server_id, o.awx_job_id);
      suruyor = !st || !IS_TERMINAL.has(st.status);
    } else suruyor = !o.baslama_at || !sureAsti(o.baslama_at, RESTART_ZAMAN_ASIMI_MS);
    if (suruyor)
      out.push({
        id: o.id,
        is_id: o.is_id,
        host: String(o.host || '').toUpperCase(),
        gen: o.gen,
        jvm: o.jvm,
        grp: ekOku(o).grp || '',
        jobId: o.awx_job_id || null,
      });
  }
  return out;
}

const yetimMetni = (y) =>
  y.jobId
    ? `restart işi #${y.jobId} ${BELIRSIZ_IZ}`
    : `restart isteği ${BELIRSIZ_IZ}, iş numarası yok`;

// ── OLUSTUR / ONAY / IPTAL ───────────────────────────────────────────────────────────────────────

function secimiDuzle(secim, enCok) {
  if (!Array.isArray(secim) || !secim.length) throw hata(400, 'En az bir JVM seçilmeli.');
  if (secim.length > enCok)
    throw hata(
      400,
      `Tek toplu restart işinde en fazla ${enCok} JVM (${secim.length} seçildi; Admin Server Hub › Kurallar & Limitler'den artırabilir).`,
      'limit',
    );
  const gorulen = new Set();
  const out = [];
  for (const x of secim) {
    const host = String(x?.host || '')
      .trim()
      .toUpperCase();
    const jvm = String(x?.jvm || '').trim();
    const gen = Number(x?.gen);
    if (!hostRe().test(host)) throw hata(400, `Geçersiz sunucu adı: ${M(host, 64) || '(boş)'}`);
    if (!JVM_RE.test(jvm)) throw hata(400, `Geçersiz JVM adı: ${M(jvm, 64) || '(boş)'}`);
    if (gen !== 7 && gen !== 8) throw hata(400, `Geçersiz JBoss sürümü (gen): ${host}/${jvm}`);
    const k = ogeAnahtari(host, gen, jvm);
    if (gorulen.has(k)) throw hata(400, `Aynı JVM iki kez seçilmiş: ${host}/${jvm}`);
    gorulen.add(k);
    out.push({ host, jvm, gen });
  }
  return out;
}

/**
 * Istek yalniz SECIMI kaydeder (uretim 2026-11-14: 33 JVM secilince POST HTTP 500 + nginx'in index.html'i dondu).
 * Eskiden istek icinde tum filo taze okunuyor (getAssessment(true): TBMWANS'ta 8 agir sorgu, 30 sn
 * requestTimeout), agir fark kolonlari ve oge basina SIRALI kilit sorgulari (her biri yetim restart'lar icin AWX'e
 * de gidebilir) bekleniyordu; bir TBMWANS zaman asimi tum istegi 500'e ceviriyordu. Simdi is + ogeler (SECIM)
 * hemen yazilir; taze degerlendirme, adaylarin yeniden turetilmesi, kilitler ve fark okumasi yurutucude
 * (secimDogrula, tick). Kapilar AYNI: gecemeyen oge DUSTU olur ve nedeni yazilir; okuma hatasinda yurutucu
 * yeniden dener (SECIM_ZAMAN_ASIMI_MS sonra DUSTU). Bu istekte kalan kapilar: limit, secim bicimi, aktif is.
 */
async function olustur(req, secim) {
  const enCok = await _d.ayarlar.limit('toplu_restart');
  const istek = secimiDuzle(secim, enCok);
  const akt = await aktifIs();
  if (akt)
    throw hata(
      409,
      `Toplu restart işi #${akt.id} hâlâ aktif (${akt.durum}) — önce o bitmeli ya da iptal edilmeli.`,
      'aktif_is',
    );
  // Siralama yalniz JVM adina bakar (kopyalar ardisik olmasin): secimden kurulabilir.
  const sirali = siraKarisik(istek);
  const kim = M(req.session?.user?.username || 'unknown', 128);
  let isId;
  try {
    const r = await db().query(
      `INSERT INTO server_hub_toplu_isler (tur, durum, olusturan, ust_sinir, aday, kira_id, kira_bitis)
       VALUES ($1, 'PLANLANIYOR', $2, $3, $4, $5, DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())) RETURNING id`,
      [TUR, kim, enCok, sirali.length, OLUSTURULUYOR],
    );
    isId = r.rows?.[0]?.id;
  } catch (e) {
    if (/UX_shti_aktif|duplicate key|UNIQUE/i.test(String(e?.message)))
      throw hata(
        409,
        'Başka bir toplu restart işi az önce açıldı — sayfayı yenileyin.',
        'aktif_is',
      );
    throw e;
  }
  if (!isId) throw hata(500, 'Toplu iş kaydı oluşturulamadı.');
  try {
    for (let i = 0; i < sirali.length; i += 100) {
      const parca = sirali.slice(i, i + 100);
      const p = [];
      const v = parca.map((c, j) => {
        // env / tarama tarihi / ek (grup, fark, onceki loaded_at / surec baslangici) secimDogrula'da yazilir.
        p.push(isId, i + j + 1, c.host, null, c.gen, c.jvm, 'restart', 1, null, ekYaz({}));
        const b = p.length - 10;
        return `(${Array.from({ length: 10 }, (_, n) => `$${b + n + 1}`).join(', ')}, '${SECIM}')`;
      });
      await db().query(
        `INSERT INTO server_hub_toplu_ogeler (is_id, sira, host, env, gen, jvm, eylem, calisiyor, tarama_scan_date, ek, durum) VALUES ${v.join(', ')}`,
        p,
      );
    }
    await db().query(
      `UPDATE server_hub_toplu_isler SET kira_id = $2 WHERE id = $1 AND kira_id = $3`,
      [isId, SUREC_ID, OLUSTURULUYOR],
    );
  } catch (e) {
    await db()
      .query(
        `UPDATE server_hub_toplu_isler SET durum = 'PLAN_HATA', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1`,
        [isId, M(`Öğeler yazılamadı: ${e?.message}`, 1000)],
      )
      .catch(() => {});
    await db()
      .query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = 'kayıt yarım kaldı' WHERE is_id = $1`,
        [isId],
      )
      .catch(() => {});
    throw hata(500, `Toplu iş öğeleri yazılamadı: ${e?.message}`);
  }
  const hostlar = [...new Set(sirali.map((c) => c.host))];
  denetim(req, {
    op: 'toplu_restart_olustur',
    id: isId,
    adet: sirali.length,
    hostlar,
    jvmler: sirali.map((c) => `${c.host}/${c.jvm}`),
  });
  return { id: isId, adet: sirali.length, hostSayisi: hostlar.length, dogrulaniyor: true };
}

/** En cok n esli calisan fn; sonuc sirasi liste sirasi. */
async function sinirliParalel(liste, n, fn) {
  const out = new Array(liste.length);
  let sonraki = 0;
  const isci = async () => {
    while (sonraki < liste.length) {
      const k = sonraki;
      sonraki += 1;
      out[k] = await fn(liste[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, isci));
  return out;
}

/**
 * Dogrulama basarisiz (taze okuma ya da beklenmeyen hata): SECIM_ZAMAN_ASIMI_MS icinde en erken
 * SECIM_YENIDEN_MS sonra yeniden denenir (is hatasinda yazilir), sonra kalan SECIM ogeleri DUSTU (is PLAN_HATA).
 * ne: hatanin turu (kullaniciya giden metin).
 */
async function secimOkunamadi(is, liste, e, ne = 'Taze değerlendirme okunamadı') {
  const msg = M(e?.message, 300) || 'bilinmeyen hata';
  console.warn(`[TopluRestart] is #${is.id} secim dogrulanamadi:`, msg);
  if (sureAsti(is.created_at, SECIM_ZAMAN_ASIMI_MS)) {
    _secimSonraki.delete(is.id);
    for (const o of liste)
      await ogeDurum(o.id, [SECIM], 'DUSTU', {
        neden: M(
          `seçim doğrulanamadı: 10 dakikada başarılamadı — ${ne} (${msg}); JVM'e dokunulmadı`,
          1000,
        ),
      });
    return;
  }
  _secimSonraki.set(is.id, Date.now() + SECIM_YENIDEN_MS);
  await db().query(`UPDATE server_hub_toplu_isler SET hata = $2 WHERE id = $1`, [
    is.id,
    M(`${ne} (${msg}) — yeniden deneniyor; hiçbir JVM'e dokunulmadı.`, 1000),
  ]);
}

/**
 * SECIM ogelerini TAZE degerlendirmeyle dogrular (eskiden olustur isteginde yapilan kapilarin AYNISI): aday
 * yeniden turetilir (adaylariTuret: tazelik, sema, prod / ortam bilinmiyor / standalone, envanter, suren
 * auto-start), baska toplu isin ogesi / sonucu bilinmeyen restart / suren auto-start kilidi. Gecen oge ADAY
 * (taze degerlerle), gecemeyen DUSTU (nedeniyle). Donus: true (dogrulandi, plan devam eder) ya da false.
 */
async function secimDogrula(is, og) {
  const liste = og.filter((o) => o.durum === SECIM);
  if (!liste.length) return true;
  let a;
  let agir;
  let yetimler;
  try {
    a = await _d.getAssessment(true);
    agir = await farklariOku(liste.map((o) => o.host));
    yetimler = await yetimRestartlar();
  } catch (e) {
    await secimOkunamadi(is, liste, e);
    return false;
  }
  if (!(await kiraYenile(is.id))) return false;
  const { adaylar, dislananlar } = adaylariTuret(a, agir);
  const byK = new Map(adaylar.map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]));
  const disK = new Map(dislananlar.map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]));
  const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
  const kararlar = await sinirliParalel(liste, KILIT_PARALEL, async (o) => {
    const k = ogeAnahtari(o.host, o.gen, o.jvm);
    const c = byK.get(k);
    if (!c) {
      const d = disK.get(k);
      return { neden: `artık aday değil${d ? ` (${d.neden})` : ' (tarama değişti)'}` };
    }
    // Baska bir toplu isin (restart ya da auto-start) ogesi ya da suren tek satir auto-start isi olan JVM gecemez.
    const kilit =
      (await topluKilidi(c.host, c.gen, c.jvm, { haricIs: is.id, yetimler })) ||
      (_d.surenIsKilidi ? await _d.surenIsKilidi(c.host, c.gen, c.jvm) : null);
    return kilit ? { neden: kilit } : { c };
  });
  for (let i = 0; i < liste.length; i += 1) {
    const o = liste[i];
    const { c, neden } = kararlar[i];
    if (!c) {
      await ogeDurum(o.id, [SECIM], 'DUSTU', {
        neden: M(`seçim doğrulamasında düştü: ${neden}`, 1000),
      });
      continue;
    }
    const h = byHost.get(c.host) || {};
    const tj = (h.jvms || []).find((x) => x.name === c.jvm && Number(x.gen) === c.gen) || {};
    const ek = {
      grp: c.grp || '',
      fark: c.fark || '',
      anahtarlar: c.anahtarlar || [],
      // Onizleme taramasinin "gercekten yuklendi" kaniti icin ONCEKI deger (Date.now ile karsilastirilmaz).
      loadedAt: h.loadedAt == null ? null : h.loadedAt,
      processStart: tj.processStartEpoch == null ? null : tj.processStartEpoch,
    };
    await ogeDurum(o.id, [SECIM], 'ADAY', {
      jvm: c.jvm,
      env: M(c.env, 32) || null,
      tarama_scan_date: M(c.scanDate, 32) || null,
      ek: ekYaz(ek),
    });
  }
  if (is.hata)
    await db().query(`UPDATE server_hub_toplu_isler SET hata = NULL WHERE id = $1`, [is.id]);
  return true;
}

const planEskiMi = (is) =>
  !is.plan_bitis_at || Date.now() - new Date(is.plan_bitis_at).getTime() > PLAN_YAS_MS;

/** PLAN_HAZIR -> PLAN_ESKIDI (CAS); PLAN_GECTI ogeler IPTAL (JVM kilitleri kalkar). Onay ve yurutucu ortak. */
async function planEskit(req, id) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'PLAN_ESKIDI', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
    [id, 'Önizleme bittikten sonra 15 dakika içinde onaylanmadı — yeniden önizleyin.'],
  );
  if (r.rowCount !== 1) return false;
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'önizleme eskidi (15 dk)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_restart_plan_eskidi', id });
  return true;
}

async function onayla(req, id) {
  const is = await isOku(id);
  if (!is) throw hata(404, `Toplu iş #${id} yok.`);
  if (is.durum !== 'PLAN_HAZIR')
    throw hata(409, `Toplu iş #${id} onaylanamaz (durum ${is.durum}).`, 'durum');
  const kim = M(req.session?.user?.username || 'unknown', 128);
  if (planEskiMi(is)) {
    await planEskit(req, id);
    throw hata(
      409,
      'Önizleme bitişinin üzerinden 15 dakika geçti — JVM’ler yeniden taranmalı. Yeniden önizleyin.',
      'plan_eskidi',
    );
  }
  // AWX legacy sablonu limit'i kabul etmiyorsa (yutulursa restart TUM envanterde kosar) onay VERILMEZ.
  await opsx().legacyLimitKontrol();
  const a = await _d.getAssessment(true);
  if (a.schemaUnknown === true)
    throw hata(
      400,
      'Server Hub şeması (sys.columns) okunamadı — onay verilmedi; sayfayı yenileyin.',
    );
  const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
  const og = await ogeler(id);
  const enCok = await _d.ayarlar.limit('toplu_restart');
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI');
  if (gecen.length > enCok)
    throw hata(
      400,
      `Limit ${enCok} JVM'e düşürülmüş (${gecen.length} öğe) — yeniden önizleyin.`,
      'limit',
    );
  let kalan = 0;
  for (const o of gecen) {
    const h = byHost.get(o.host);
    const j = h
      ? (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen))
      : null;
    const k =
      restartKapisi(a, h, j) ||
      (farkliCalisiyor(j) ? null : 'JVM artık çalışmıyor ya da fark kalmadı.');
    if (k) await ogeDurum(o.id, ['PLAN_GECTI'], 'DUSTU', { neden: M(`onay anında: ${k}`, 1000) });
    else kalan += 1;
  }
  if (!kalan) {
    await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'BITTI', onaylayan = $2, onay_at = SYSUTCDATETIME(), bitis_at = SYSUTCDATETIME(), hata = $3 WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [id, kim, 'Onay anında restart edilecek JVM kalmadı.'],
    );
    await sayimYaz(id);
    denetim(req, { op: 'toplu_restart_onay', id, adet: 0 });
    return { id, adet: 0 };
  }
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'CALISIYOR', onaylayan = $2, onay_at = SYSUTCDATETIME(),
        kira_id = $3, kira_bitis = DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())
      WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
    [id, kim, SUREC_ID],
  );
  if (r.rowCount !== 1)
    throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'BEKLIYOR' WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_restart_onay', id, adet: kalan });
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
    if (r.rowCount !== 1)
      throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
      [id],
    );
    await sayimYaz(id);
    denetim(req, { op: 'toplu_restart_iptal', id, durum: 'IPTAL' });
    return { id, durum: 'IPTAL' };
  }
  if (is.durum !== 'PLANLANIYOR' && is.durum !== 'CALISIYOR')
    throw hata(409, `Toplu iş #${id} iptal edilemez (durum ${is.durum}).`, 'durum');
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'IPTAL_ISTENDI', iptal_eden = $2 WHERE id = $1 AND durum IN ('PLANLANIYOR', 'CALISIYOR')`,
    [id, kim],
  );
  if (r.rowCount !== 1)
    throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'BEKLIYOR')`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_restart_iptal', id, durum: 'IPTAL_ISTENDI' });
  return { id, durum: 'IPTAL_ISTENDI' };
}

// ── YURUTUCU: ORTAK ──────────────────────────────────────────────────────────────────────────────

async function isDurumu(serverId, jobId) {
  try {
    return await runner().getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    console.warn(`[TopluRestart] is #${jobId} okunamadi:`, e?.message);
    return null;
  }
}

const sureAsti = (bas, ms) => bas && Date.now() - new Date(bas).getTime() > ms;

/**
 * Tarama isi sonucunun bu sunucuyu GERCEKTEN yukledigi kaniti. onceki: islemden ONCEKI h.loadedAt (bilinmiyorsa
 * null). Donus: null (yuklendi) ya da neden.
 */
function yuklemeKaniti(result, h, host, onceki) {
  if (!result || typeof result !== 'object')
    return 'tarama sonucu (set_stats server_hub_scan_result) yok';
  const H = String(host).toUpperCase();
  const hosts = Array.isArray(result.hosts)
    ? result.hosts.map(
        (x) =>
          String(x || '')
            .toUpperCase()
            .split('.')[0],
      )
    : [];
  if (!hosts.includes(H)) return 'tarama bu sunucudan satır üretmedi';
  const loader = result.loader && typeof result.loader === 'object' ? result.loader : null;
  const dis =
    loader && Array.isArray(loader.excluded)
      ? loader.excluded.find(
          (x) =>
            x &&
            String(x.host || '')
              .toUpperCase()
              .split('.')[0] === H,
        )
      : null;
  if (dis) return `yükleyici dışladı (${M(dis.issue, 80) || '?'})`;
  if (!h) return 'sunucu değerlendirmede yok';
  if (h.loadExcluded) return 'son yükleme dışlandı';
  if (h.loadedAt == null || (onceki != null && !(h.loadedAt > onceki)))
    return 'yükleme zamanı ilerlemedi (yeni satır yüklenmedi)';
  return null;
}

function taramaSonucu(st) {
  return opsx().extractStatsKey(st?.artifacts, 'server_hub_scan_result') || null;
}

async function taramaBaslat(is, hostlar, op) {
  return _d.launch(
    sozdeIstek(is.onaylayan || is.olusturan),
    SCAN_KEY,
    `Server Hub: toplu restart #${is.id} ${op === 'toplu_restart_onizleme' ? 'önizleme' : 'doğrulama'} taraması (${hostlar.length === 1 ? hostlar[0] : `${hostlar.length} sunucu`})`,
    { target_hosts: hostlar.join(',') },
    { op, id: is.id, hosts: hostlar },
  );
}

/** Envanterde host + kurulum kolu (gen) icin bu ad var mi? Donus: uygulama adi ya da null. */
async function uygulamaAdi(host, gen, jvm) {
  const satirlar = await opsx().hostsForApp(jvm);
  const ok = satirlar.some(
    (r) => String(r.host || '').toUpperCase() === host && String(r.kurulum) === String(gen),
  );
  return ok ? jvm : null;
}

// ── ONIZLEME (salt okunur tarama) ────────────────────────────────────────────────────────────────

async function onizlemeIsle(is, liste, st) {
  const result = taramaSonucu(st);
  if (_d.onbellekSil) _d.onbellekSil();
  const a = await _d.getAssessment(true);
  const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
  const agir = await farklariOku(liste.map((o) => o.host));
  const jobId = liste[0].plan_job_id;
  for (const o of liste) {
    const ek = ekOku(o);
    const dus = (neden) =>
      ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', { neden: M(`önizlemede düştü: ${neden}`, 1000) });
    if (!result) {
      await dus(
        `tarama işi #${jobId} ${st.status}; sonuç (set_stats) okunamadı — AWX'ten kontrol edin`,
      );
      continue;
    }
    const h = byHost.get(o.host);
    const yk = yuklemeKaniti(result, h, o.host, ek.loadedAt);
    if (yk) {
      await dus(`önizleme taraması bu sunucuyu yüklemedi: ${yk}`);
      continue;
    }
    const j = (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen));
    if (!j) {
      await dus('JVM yeni taramada yok');
      continue;
    }
    if (!(j.runningKnown !== false && j.running === true)) {
      await dus('JVM artık çalışmıyor');
      continue;
    }
    if (j.argFark !== 1) {
      await dus(j.argFark === 2 ? 'fark artık ölçülemiyor' : 'fark kalmadı');
      continue;
    }
    const k = restartKapisi(a, h, j);
    if (k) {
      await dus(k);
      continue;
    }
    const fo = farkOzeti(agirFark(agir, o.host, o.gen, o.jvm));
    const eski = Array.isArray(ek.anahtarlar) ? ek.anahtarlar : [];
    if (eski.length && fo.anahtarlar.length && !eski.some((x) => fo.anahtarlar.includes(x))) {
      await dus(
        `fark değişti (önce: ${eski.join(', ')}; şimdi: ${fo.anahtarlar.join(', ')}) — listeyi yenileyip yeniden seçin`,
      );
      continue;
    }
    let uygulama = null;
    try {
      uygulama = await uygulamaAdi(o.host, o.gen, o.jvm);
    } catch (e) {
      await dus(`envanter okunamadı (${M(e?.message, 200)})`);
      continue;
    }
    if (!uygulama) {
      await dus(
        `envanterde ${o.host} JBoss ${o.gen} kurulumunda "${o.jvm}" uygulaması yok — OpsX restart'ı uygulama adıyla çalışır; OpsX'ten tek tek`,
      );
      continue;
    }
    const yeniEk = {
      ...ek,
      grp: j.group || ek.grp || '',
      application: uygulama,
      fark: fo.metin || ek.fark || '',
      anahtarlar: fo.anahtarlar.length ? fo.anahtarlar : eski,
      // Restart kaniti ve dogrulama taramasi bu ONIZLEME degerleriyle karsilastirilir.
      loadedAt: h.loadedAt,
      processStart: j.processStartEpoch == null ? null : j.processStartEpoch,
    };
    await ogeDurum(o.id, ['PLANLANIYOR'], 'PLAN_GECTI', {
      neden: 'hâlâ çalışıyor ve fark hâlâ var',
      ek: ekYaz(yeniEk),
    });
  }
}

async function planIlerlet(is, og, iptalMi) {
  // Secim once taze degerlendirmeyle dogrulanir (olustur istegi yalniz secimi yazar); basaramazsa sonraki tick.
  // Beklenmeyen hata da (turetme / DB yazimi) ayni zaman asimina baglidir: is sonsuza dek PLANLANIYOR kalip
  // JVM kilitlerini ve aktif is yuvasini tutamaz.
  if (!iptalMi && og.some((o) => o.durum === SECIM)) {
    if (Date.now() < (_secimSonraki.get(is.id) || 0)) return;
    let tamam;
    try {
      tamam = await secimDogrula(is, og);
    } catch (e) {
      await secimOkunamadi(
        is,
        og.filter((o) => o.durum === SECIM),
        e,
        'Seçim doğrulaması hata verdi',
      );
      tamam = false;
    }
    if (!tamam) return;
    _secimSonraki.delete(is.id);
  }
  const suren = new Map();
  for (const o of og.filter((x) => x.durum === 'PLANLANIYOR')) {
    const k = o.plan_job_id == null ? 'yok' : `${o.plan_awx_server_id}|${o.plan_job_id}`;
    if (!suren.has(k)) suren.set(k, []);
    suren.get(k).push(o);
  }
  for (const [k, liste] of suren) {
    if (k === 'yok') {
      for (const o of liste)
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: 'önizleme başlatılamadı (iş numarası yok)',
        });
      continue;
    }
    const o0 = liste[0];
    const st = await isDurumu(o0.plan_awx_server_id, o0.plan_job_id);
    if (!st || !IS_TERMINAL.has(st.status)) {
      if (sureAsti(o0.baslama_at, TARAMA_ZAMAN_ASIMI_MS))
        for (const o of liste)
          await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
            neden: `önizleme taraması #${o0.plan_job_id} 1 saatte bitmedi — AWX'ten kontrol edin`,
          });
      continue;
    }
    await onizlemeIsle(is, liste, st);
  }
  if (iptalMi) return;
  const tazeOg = await ogeler(is.id);
  const bekleyen = tazeOg.filter((o) => o.durum === 'ADAY');
  if (!bekleyen.length) return;
  const enCok = Math.max(1, Number(await _d.ayarlar.limit('tara')) || 50);
  const hostlar = [...new Set(bekleyen.map((o) => o.host))];
  for (let i = 0; i < hostlar.length; i += enCok) {
    const parca = hostlar.slice(i, i + enCok);
    if (!(await kiraYenile(is.id))) return;
    let al = 0;
    for (const host of parca) {
      const r = await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'PLANLANIYOR', baslama_at = SYSUTCDATETIME()
          WHERE is_id = $1 AND host = $2 AND durum = 'ADAY'
            AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $3)`,
        [is.id, host, SUREC_ID],
      );
      al += r.rowCount || 0;
    }
    if (!al) continue;
    try {
      const r = await taramaBaslat(is, parca, 'toplu_restart_onizleme');
      for (const host of parca)
        await db().query(
          `UPDATE server_hub_toplu_ogeler SET plan_awx_server_id = $3, plan_job_id = $4 WHERE is_id = $1 AND host = $2 AND durum = 'PLANLANIYOR'`,
          [is.id, host, r.awxServerId, r.jobId],
        );
    } catch (e) {
      for (const host of parca)
        await db().query(
          `UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = $3, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND host = $2 AND durum = 'PLANLANIYOR'`,
          [is.id, host, M(`önizleme başlatılamadı: ${e?.message}`, 1000)],
        );
    }
  }
}

async function planBitir(is) {
  const og = await ogeler(is.id);
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI').length;
  const okunamadi = og.filter(
    (o) =>
      o.durum === 'DUSTU' &&
      /(?:^önizleme (?:başlatılamadı|taraması))|sonuç \(set_stats\) okunamadı|yüklemedi/.test(
        o.neden || '',
      ),
  ).length;
  const secimOkunamadi = og.filter(
    (o) => o.durum === 'DUSTU' && /^seçim doğrulanamadı/.test(o.neden || ''),
  ).length;
  let durum = 'PLAN_HAZIR';
  let mesaj = null;
  if (!gecen && og.length && secimOkunamadi === og.length) {
    durum = 'PLAN_HATA';
    mesaj =
      "Taze değerlendirme okunamadı — seçim doğrulanamadı, hiçbir JVM'e dokunulmadı. Listeyi yenileyip yeniden deneyin.";
  } else if (!gecen && og.length && okunamadi === og.length) {
    durum = 'PLAN_HATA';
    mesaj = 'Önizleme taraması hiçbir sunucuyu yükleyemedi — AWX işlerine bakın.';
  } else if (!gecen) {
    durum = 'BITTI';
    mesaj = 'Restart edilecek JVM kalmadı: hepsi önizlemede düştü (nedeni tabloda).';
  }
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = $2, hata = $3, plan_bitis_at = SYSUTCDATETIME()${durum === 'PLAN_HAZIR' ? '' : ', bitis_at = SYSUTCDATETIME()'}
      WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $4`,
    [is.id, durum, mesaj, SUREC_ID],
  );
  await sayimYaz(is.id);
  if (r.rowCount === 1 && durum !== 'PLAN_HAZIR')
    denetim(sozdeIstek(is.olusturan), {
      op: 'toplu_restart_bitti',
      id: is.id,
      durum,
      kapandi: 0,
      fail: 0,
      dusen: og.length - gecen,
    });
}

// ── UYGULAMA (tek tek) ───────────────────────────────────────────────────────────────────────────

/** Ayni uygulamanin (ayni JVM adi ya da grubu) BEKLEYEN kopyalari atlanir (biri ayaga kalkmadi). */
async function kopyalariAtla(is, o) {
  const ek = ekOku(o);
  const og = await ogeler(is.id);
  for (const x of og) {
    if (x.durum !== 'BEKLIYOR' || x.id === o.id) continue;
    const xe = ekOku(x);
    if (L(x.jvm) === L(o.jvm) || (ek.grp && xe.grp && ek.grp === xe.grp))
      await ogeDurum(x.id, ['BEKLIYOR'], 'ATLANDI', {
        neden: M(
          `aynı uygulamanın kopyası ${o.host}/${o.jvm} restart'ta ayağa kalkmadı — bu kopya korunmak için çalıştırılmadı`,
          1000,
        ),
      });
  }
}

/**
 * Sonucu bilinmeyen restart: toplu is DURUR. Bekleyen ogeler ATLANDI, is hatasi yazilir; sonraki tick isi
 * BITTI_HATALI bitirir (YARIM_KALDI / FAIL). Kopyalar dahil hicbir JVM bu isten sonra baslatilmaz.
 */
async function topluDurdur(is, o, neden) {
  const metin = M(
    `toplu iş durduruldu: ${o.host}/${o.jvm} ${neden} — sonucu AWX'ten kontrol edin, sonra kalanlar için yeni toplu iş açın`,
    900,
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'ATLANDI', neden = $2, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'BEKLIYOR'`,
    [is.id, `atlandı: ${metin}`],
  );
  await db().query(`UPDATE server_hub_toplu_isler SET hata = $2 WHERE id = $1`, [is.id, metin]);
}

/** Restart isi (CALISIYOR) terminal mi? Oyleyse dogrulama taramasini baslatir ya da FAIL yazar. */
async function restartIsle(is, o) {
  const st = await isDurumu(o.awx_server_id, o.awx_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (sureAsti(o.baslama_at, RESTART_ZAMAN_ASIMI_MS)) {
      // Is hala kosuyor olabilir: siradaki JVM onceki restart surerken baslamasin -> toplu is DURUR.
      if (
        await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
          neden: `restart işi #${o.awx_job_id} 45 dakikada bitmedi (${BELIRSIZ_IZ}) — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
        })
      )
        await topluDurdur(is, o, `restart işi #${o.awx_job_id} 45 dakikada bitmedi`);
    }
    return;
  }
  const stats = opsx().extractStatsKey(st.artifacts, STATS_KEY);
  const hostListe = stats && typeof stats === 'object' ? stats[String(o.host).toUpperCase()] : null;
  const giris = Array.isArray(hostListe)
    ? hostListe.find(
        (x) => x && String(x.name || '') === o.jvm && String(x.jbossMajor || '') === String(o.gen),
      )
    : null;
  const startState = giris ? String(giris.start_state || '') : null;
  const ek = ekOku(o);
  ek.restart = {
    jobStatus: st.status,
    startState,
    stopState: giris ? giris.stop_state || null : null,
    killResult: giris ? giris.kill_result || null : null,
    hostController: giris ? giris.host_controller || null : null,
  };
  if (startState === 'NOT_STARTED') {
    await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
      neden: M(
        `restart işi #${o.awx_job_id} bitti ama JVM STARTED olmadı (30 × 5 sn) — AWX çıktısına bakın; aynı uygulamanın bekleyen kopyaları atlandı`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    await kopyalariAtla(is, o);
    return;
  }
  // STARTED tek basina restart kaniti DEGIL: stop basarisiz + kill yapilmadiysa JVM hic durmadi, :start etkisiz
  // kaldi ve grep yine STARTED gordu. Durdurma kaniti (STOPPED ya da kill -9 / surec kalmadi) sart.
  if (
    giris &&
    ek.restart.stopState !== 'STOPPED' &&
    !DURDU_KILL.includes(String(ek.restart.killResult || ''))
  ) {
    await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
      neden: M(
        `JVM durdurulamadı (stop_state=${ek.restart.stopState || '?'}, kill=${ek.restart.killResult || 'yok'}; iş #${o.awx_job_id}) — restart yapılmadı sayılır; AWX çıktısına bakın; aynı uygulamanın bekleyen kopyaları atlandı`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    await kopyalariAtla(is, o);
    return;
  }
  if (!giris && st.status !== 'successful') {
    await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
      neden: M(
        `restart işi #${o.awx_job_id} ${st.status}; bu JVM için sonuç (set_stats ${STATS_KEY}) yok — host controller adı okunamamış olabilir; AWX çıktısına bakın`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    await kopyalariAtla(is, o);
    return;
  }
  // STARTED ya da (eski playbook: set_stats yok, is basarili) -> dogrulama taramasi kaniti tamamlar.
  let r;
  try {
    r = await taramaBaslat(is, [o.host], 'toplu_restart_dogrulama');
  } catch (e) {
    await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
      neden: M(
        `restart işi #${o.awx_job_id} bitti (${startState || 'sonuç yok'}) ama doğrulama taraması başlatılamadı: ${e?.message} — sunucuyu elle tarayın`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    if (startState !== 'STARTED') await kopyalariAtla(is, o);
    return;
  }
  ek.taramaJob = { serverId: r.awxServerId, jobId: r.jobId };
  ek.taramaBaslama = new Date().toISOString();
  await ogeDurum(o.id, ['CALISIYOR'], 'TARANIYOR', { ek: ekYaz(ek) });
}

/** Dogrulama taramasi (TARANIYOR) terminal mi? Oyleyse KAPANDI / KAPANMADI / FAIL. */
async function taramaIsle(is, o) {
  const ek = ekOku(o);
  const tj = ek.taramaJob || {};
  const st = await isDurumu(tj.serverId, tj.jobId);
  const started = ek.restart?.startState === 'STARTED';
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (sureAsti(ek.taramaBaslama || o.baslama_at, TARAMA_ZAMAN_ASIMI_MS)) {
      await ogeDurum(o.id, ['TARANIYOR'], 'FAIL', {
        neden: `restart yapıldı (iş #${o.awx_job_id}) ama doğrulama taraması #${tj.jobId} 1 saatte bitmedi — sunucuyu yeniden tarayın`,
      });
      if (!started) await kopyalariAtla(is, o);
    }
    return;
  }
  const result = taramaSonucu(st);
  if (_d.onbellekSil) _d.onbellekSil();
  const a = await _d.getAssessment(true);
  const h = (a.hosts || []).find((x) => x.host === o.host);
  const yk = yuklemeKaniti(result, h, o.host, ek.loadedAt);
  if (yk) {
    await ogeDurum(o.id, ['TARANIYOR'], 'FAIL', {
      neden: M(
        `restart işi #${o.awx_job_id} (${ek.restart?.startState || 'sonuç yok'}) bitti ama doğrulama taraması #${tj.jobId} sunucuyu yüklemedi: ${yk} — sunucuyu yeniden tarayın`,
        1000,
      ),
    });
    if (!started) await kopyalariAtla(is, o);
    return;
  }
  const j = (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen));
  if (!j || !(j.runningKnown !== false && j.running === true)) {
    await ogeDurum(o.id, ['TARANIYOR'], 'FAIL', {
      neden: M(
        `restart sonrası taramada JVM ${j ? 'çalışmıyor' : 'yok'} (iş #${o.awx_job_id}) — aynı uygulamanın bekleyen kopyaları atlandı`,
        1000,
      ),
    });
    await kopyalariAtla(is, o);
    return;
  }
  const ps0 = ek.processStart == null ? null : Number(ek.processStart);
  const ps1 = j.processStartEpoch == null ? null : Number(j.processStartEpoch);
  ek.sonra = {
    processStart: ps1,
    argFark: j.argFark == null ? null : j.argFark,
    loadedAt: h.loadedAt,
  };
  if (ps0 != null && ps1 != null && ps1 === ps0) {
    await ogeDurum(o.id, ['TARANIYOR'], 'FAIL', {
      neden: M(
        `süreç başlangıç zamanı değişmedi — JVM restart edilmemiş görünüyor (iş #${o.awx_job_id} ${ek.restart?.startState || 'sonuç yok'}); AWX çıktısına bakın`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    return;
  }
  if ((ps0 == null || ps1 == null) && !started) {
    await ogeDurum(o.id, ['TARANIYOR'], 'FAIL', {
      neden: M(
        `restart kanıtı yok: set_stats STARTED yok ve süreç başlangıç zamanı ölçülemedi (iş #${o.awx_job_id}) — AWX çıktısına bakın`,
        1000,
      ),
      ek: ekYaz(ek),
    });
    return;
  }
  const agir = await farklariOku([o.host]);
  const fo = farkOzeti(agirFark(agir, o.host, o.gen, o.jvm));
  ek.farkSonra = fo.metin || '';
  if (j.argFark === 0) {
    await ogeDurum(o.id, ['TARANIYOR'], 'KAPANDI', {
      neden: 'restart edildi, fark kapandı',
      ek: ekYaz(ek),
    });
    return;
  }
  await ogeDurum(o.id, ['TARANIYOR'], 'KAPANMADI', {
    neden: M(
      j.argFark === 1
        ? `restart edildi ama fark kapanmadı — ${KAPANMADI_NOTU}`
        : 'restart edildi; fark ölçülemedi (tarama karşılaştıramadı)',
      1000,
    ),
    ek: ekYaz(ek),
  });
}

/** Siradaki JVM'i baslat (yalniz baska suren oge yoksa). Donus: true (yapacak is kalmadi). */
async function uygulaIlerlet(is, og) {
  const suren = og.find((o) => o.durum === 'CALISIYOR' || o.durum === 'TARANIYOR');
  if (suren) {
    if (suren.durum === 'CALISIYOR') await restartIsle(is, suren);
    else await taramaIsle(is, suren);
    return false;
  }
  const takili = og.filter((o) => o.durum === 'BASLATILIYOR');
  if (takili.length) {
    // Is numarasi yazilamadi: restart AWX'te kosuyor olabilir -> asla yeniden baslatilmaz, toplu is DURUR.
    for (const o of takili.filter((x) => sureAsti(x.baslama_at, TAKILI_MS)))
      if (
        await ogeDurum(o.id, ['BASLATILIYOR'], 'YARIM_KALDI', {
          neden: `restart iş numarası yazılamadı (${BELIRSIZ_IZ}) — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
        })
      )
        await topluDurdur(is, o, 'restart iş numarası yazılamadı');
    return false;
  }
  if (is.durum !== 'CALISIYOR') return true;
  const o = og.find((x) => x.durum === 'BEKLIYOR');
  if (!o) return true;
  const ek = ekOku(o);
  const atla = (neden) =>
    ogeDurum(o.id, ['BEKLIYOR'], 'ATLANDI', { neden: M(`atlandı: ${neden}`, 1000) });
  // Auto-start isi (tek satir ya da toplu) bu JVM'de suruyorsa restart acilmaz.
  const kilit = _d.surenIsKilidi ? await _d.surenIsKilidi(o.host, o.gen, o.jvm) : null;
  if (kilit) {
    await atla(kilit);
    return false;
  }
  // Onceki bir toplu restart'in sonucu bilinmeyen ogesi AWX'te suruyor olabilir: ayni uygulamanin kopyasi
  // (ayni JVM adi ya da grubu) ATLANIR; baska JVM o is bitene kadar BEKLER (ayni anda iki restart yok).
  const yetimler = await yetimRestartlar();
  const kopya = yetimler.find(
    (y) => L(y.jvm) === L(o.jvm) || (ek.grp && y.grp && ek.grp === y.grp),
  );
  if (kopya) {
    await atla(
      `aynı uygulamanın kopyası ${kopya.host}/${kopya.jvm}: ${yetimMetni(kopya)} (toplu iş #${kopya.is_id})`,
    );
    return false;
  }
  if (yetimler.length) {
    const y = yetimler[0];
    await ogeDurum(o.id, ['BEKLIYOR'], 'BEKLIYOR', {
      neden: M(
        `bekliyor: ${y.host}/${y.jvm} ${yetimMetni(y)} (toplu iş #${y.is_id}) — o bitince başlar`,
        1000,
      ),
    });
    return false;
  }
  // Her JVM oncesi TAZE degerlendirme: sunucu hala taze / prod degil, JVM hala calisiyor ve farkli.
  const a = await _d.getAssessment(true);
  const h = (a.hosts || []).find((x) => x.host === o.host);
  const j = h
    ? (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen))
    : null;
  const k =
    restartKapisi(a, h, j) ||
    (farkliCalisiyor(j) ? null : 'JVM artık çalışmıyor ya da fark kalmadı (taramaya göre).');
  if (k) {
    await atla(k);
    return false;
  }
  if (!(await kiraYenile(is.id))) return false;
  const al = await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'BASLATILIYOR', baslama_at = SYSUTCDATETIME()
      WHERE id = $1 AND durum = 'BEKLIYOR'
        AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $2 AND durum = 'CALISIYOR' AND kira_id = $3)
        AND NOT EXISTS (SELECT 1 FROM server_hub_toplu_ogeler x WITH (UPDLOCK, HOLDLOCK)
                         WHERE x.is_id = $2 AND x.durum IN (${IN(SUREN_OGE)}))`,
    [o.id, is.id, SUREC_ID],
  );
  if (al.rowCount !== 1) return false;
  // Restart kaniti bu ANKI taramaya gore (onizlemeden sonra baska tarama gelmis olabilir).
  const ekBas = {
    ...ek,
    loadedAt: h.loadedAt,
    processStart: j.processStartEpoch == null ? null : j.processStartEpoch,
  };
  let r;
  try {
    r = await opsx().topluRestartBaslat({
      req: sozdeIstek(is.onaylayan || is.olusturan),
      application: ek.application,
      host: o.host,
      gen: o.gen,
      jvm: o.jvm,
    });
  } catch (e) {
    const code = e?.code;
    const mesaj = M(e?.message, 900);
    if (e?.launchBelirsiz === true) {
      // AWX launch istegi belirsiz hatayla dondu (zaman asimi / 5xx / baglanti): is AWX'te olusmus olabilir.
      // "Dokunulmadi" DENMEZ; oge YARIM_KALDI, toplu is durur (kopya dahil siradaki JVM baslatilmaz).
      if (
        await ogeDurum(o.id, ['BASLATILIYOR'], 'YARIM_KALDI', {
          neden: M(
            `restart isteği belirsiz hatayla döndü (${BELIRSIZ_IZ}): ${mesaj} — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
            1000,
          ),
        })
      )
        await topluDurdur(is, o, 'restart isteği belirsiz hatayla döndü');
      return false;
    }
    if (code === 'uretim' || code === 'standalone')
      await ogeDurum(o.id, ['BASLATILIYOR'], 'ATLANDI', { neden: `atlandı: ${mesaj}` });
    else {
      await ogeDurum(o.id, ['BASLATILIYOR'], 'FAIL', {
        neden: `restart başlatılamadı (JVM'e dokunulmadı): ${mesaj}`,
      });
      // Sablon / limit sorunu her JVM'de ayni: kalanlar da baslatilamaz -> hepsi atlanir (tek tek FAIL yerine).
      if (code === 'limit_kabul_edilmiyor' || code === 'limit_olculemedi' || code === 'sablon_yok')
        await db().query(
          `UPDATE server_hub_toplu_ogeler SET durum = 'ATLANDI', neden = $2, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'BEKLIYOR'`,
          [is.id, M(`atlandı: ${mesaj}`, 1000)],
        );
    }
    return false;
  }
  await ogeDurum(o.id, ['BASLATILIYOR'], 'CALISIYOR', {
    awx_server_id: r.awxServerId,
    awx_job_id: r.jobId,
    neden: null,
    ek: ekYaz(ekBas),
  });
  return false;
}

async function uygulaBitir(is) {
  await sayimYaz(is.id);
  const son = await isOku(is.id);
  const iptalMi = son.durum === 'IPTAL_ISTENDI';
  if (iptalMi)
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
      [is.id],
    );
  await sayimYaz(is.id);
  const s = await isOku(is.id);
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
      op: 'toplu_restart_bitti',
      id: is.id,
      durum,
      kapandi: s.ok_sayisi,
      kapanmadi: s.skip_sayisi,
      fail: s.fail_sayisi,
      dusen: s.dusen,
    });
}

/** KIRASI DUSMUS aktif is: ILERLETILMEZ, izlenmez; ogeler is numaralariyla YARIM_KALDI. */
async function yarimBirak(is) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'YARIM_KALDI', kira_id = NULL, kira_bitis = NULL, bitis_at = SYSUTCDATETIME(),
        hata = $3
      WHERE id = $1 AND durum = $2 AND (kira_id IS NULL OR kira_id <> $4) AND (kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME())`,
    [
      is.id,
      is.durum,
      'Portal yeniden başladı ya da yürütücü durdu — toplu restart kaldığı yerden DEVAM ETTİRİLMEDİ (sessiz yeniden koşma yok). Süren öğelerin iş numarası tabloda; AWX’ten kontrol edin, sunucuları yeniden tarayın; gerisi için yeni toplu iş açın.',
      SUREC_ID,
    ],
  );
  if (r.rowCount !== 1) return;
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLANLANIYOR', 'PLAN_GECTI', 'BEKLIYOR')`,
    [is.id, 'Portal yeniden başladı — çalıştırılmadı'],
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum = 'BASLATILIYOR'`,
    [
      is.id,
      `restart AWX'e gitmiş olabilir (iş numarası yazılmadı; ${BELIRSIZ_IZ}) — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
    ],
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum = 'CALISIYOR'`,
    [
      is.id,
      `restart işi sürüyordu (iş numarası tabloda; ${BELIRSIZ_IZ}) — AWX işi bitene kadar bu JVM ve kopyaları kilitli; sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
    ],
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum = 'TARANIYOR'`,
    [
      is.id,
      'restart yapıldı; doğrulama taraması sürüyordu — sunucuyu yeniden tarayın (fark kapandı mı Bulgular’da görünür)',
    ],
  );
  await sayimYaz(is.id);
  denetim(sozdeIstek('toplu-restart-yurutucu'), {
    op: 'toplu_restart_yarim_kaldi',
    id: is.id,
    onceki: is.durum,
  });
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
        if (planEskiMi(is)) await planEskit(sozdeIstek('toplu-restart-yurutucu'), is.id);
        continue;
      }
      if (is.kira_id !== SUREC_ID) {
        if (Number(is.kira_dustu) === 1) await yarimBirak(is);
        continue;
      }
      if (!(await kiraYenile(is.id))) continue;
      let og = await ogeler(is.id);
      const iptalMi = is.durum === 'IPTAL_ISTENDI';
      if (is.durum === 'PLANLANIYOR' || (iptalMi && !is.onay_at)) {
        await planIlerlet(is, og, iptalMi);
        og = await ogeler(is.id);
        if (iptalMi) {
          if (!og.some((o) => o.durum === 'PLANLANIYOR')) await uygulaBitir(is);
          else await sayimYaz(is.id);
        } else if (
          !og.some((o) => o.durum === SECIM || o.durum === 'ADAY' || o.durum === 'PLANLANIYOR')
        )
          await planBitir(is);
        else await sayimYaz(is.id);
        continue;
      }
      const bitti = await uygulaIlerlet(is, og);
      if (bitti) await uygulaBitir(is);
      else await sayimYaz(is.id);
    } catch (e) {
      console.warn(`[TopluRestart] is #${is.id} ilerletilemedi:`, e?.message);
    }
  }
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[TopluRestart] tick hatasi:', e?.message))
      .finally(() => {
        _ticking = false;
      });
  }, POLL_SN * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[TopluRestart] yurutucu basladi (${POLL_SN} sn)`);
}

// ── UCLAR ────────────────────────────────────────────────────────────────────────────────────────

function mount(router, deps) {
  kur(deps);
  // 5xx (DB / degerlendirme hatasi): kurumsal nginx (proxy_intercept_errors + error_page 500) govdeyi kendi
  // index.html'iyle degistirir; asil mesaj ne ekrana ne loga duserdi (uretim 2026-11-14, 33 JVM). Her 5xx
  // loglanir; GET disi isteklerde util/nginx-red.cjs deseni: 424 + upstreamStatus + nginxRed (safeJson asil
  // kodu ve mesaji tasir). GET (yoklama) 5xx'i eskisi gibi kalir.
  const gonder = (req, res, err) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(
        `[TopluRestart] ${req.method} ${req.originalUrl || req.path} ${status}:`,
        err?.message,
      );
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return res.status(424).json({
          ok: false,
          message: err.message,
          code: err.code || 'toplu_sunucu_hatasi',
          upstreamStatus: status,
          nginxRed: true,
        });
    }
    return res
      .status(status)
      .json({ ok: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  };

  router.get('/toplu-restart/adaylar', async (req, res) => {
    try {
      const [a, limit, akt] = await Promise.all([
        _d.getAssessment(req.query.fresh === '1'),
        _d.ayarlar.limit('toplu_restart'),
        aktifIs().catch(() => null),
      ]);
      if (a.tableMissing)
        return res.json({
          ok: true,
          adaylar: [],
          dislananlar: [],
          limit,
          aktif: isSatiri(akt),
          latestScan: null,
        });
      // Farkli parametreler yalniz fark bulunan sunucular icin okunur (agir kolonlar, maskeli).
      const hostlar = [];
      for (const h of a.hosts || [])
        if (!h.taramadanDustu && (h.jvms || []).some(farkliCalisiyor)) hostlar.push(h.host);
      const agir = await farklariOku(hostlar);
      const { adaylar, dislananlar } = adaylariTuret(a, agir);
      res.json({
        ok: true,
        adaylar,
        dislananlar,
        limit,
        aktif: isSatiri(akt),
        latestScan: a.latestScan || null,
        schemaUnknown: a.schemaUnknown === true,
      });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.get('/toplu-restart', async (req, res) => {
    try {
      const { rows } = await db().query(
        `SELECT TOP 10 * FROM server_hub_toplu_isler WHERE tur = $1 ORDER BY id DESC`,
        [TUR],
      );
      const akt = (rows || []).find((r) => AKTIF.includes(r.durum)) || (await aktifIs());
      res.json({ ok: true, aktif: isSatiri(akt), son: (rows || []).map(isSatiri) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.get('/toplu-restart/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const is = await isOku(id);
      if (!is) return res.status(404).json({ ok: false, message: `Toplu iş #${id} yok.` });
      res.json({ ok: true, is: isSatiri(is), ogeler: (await ogeler(id)).map(ogeSatiri) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-restart', async (req, res) => {
    try {
      res.json({ ok: true, ...(await olustur(req, req.body?.secim)) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-restart/:id/onayla', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    if (req.body?.confirmed !== true)
      return res.status(400).json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    try {
      res.json({ ok: true, ...(await onayla(req, id)) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-restart/:id/iptal', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      res.json({ ok: true, ...(await iptal(req, id)) });
    } catch (err) {
      gonder(req, res, err);
    }
  });
}

module.exports = {
  TUR,
  KIRA_SN,
  PLAN_YAS_MS,
  AKTIF,
  KILITLI_OGE,
  SECIM,
  SECIM_ZAMAN_ASIMI_MS,
  SUREC_ID,
  STATS_KEY,
  KAPANMADI_NOTU,
  BELIRSIZ_IZ,
  mount,
  kur,
  farkOzeti,
  restartKapisi,
  adaylariTuret,
  siraKarisik,
  secimiDuzle,
  yuklemeKaniti,
  topluKilidi,
  yetimRestartlar,
  adKuraliProd,
  olustur,
  onayla,
  iptal,
  tick,
  startPoller,
  SECIM_YENIDEN_MS,
  _secimBeklemeSifirlaForTest: () => _secimSonraki.clear(),
  _durdurForTest: () => {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _ticking = false;
    _secimSonraki.clear();
  },
};
