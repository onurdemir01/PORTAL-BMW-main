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
//   3. Onay ekrani (15 dk icinde; sure planlama BITTIGINDE (plan_bitis_at) baslar, planlamanin kendi suresi
//      dahil degil; plan daha eskiyse PLAN_ESKIDI, yeniden planlanir).
//   4. Uygulama: AWX isleri SIRAYLA (bir sonraki ancak oncekinin isi terminal olunca), once bir hostun tum
//      parcalari, sonra siradaki host (hostlar toplu iste ilk gorulme sirasiyla; secim karisik sirali olsa
//      da). FAIL toplu isi DURDURMAZ, sonda ozet kirmizi (BITTI_HATALI).
//   5. Ust sinir Admin > Kurallar & Limitler 'limit:toplu_autostart' (varsayilan 500 JVM).
//
// PARCALAMA (2026-11-15, kullanici: "300 kusur JVM secmisim bunlarin planlama asamasi zaten 15 dakikayi
// asiyor"): betik her JVM icin jboss-cli'yi birkac kez acar (her biri JVM acilisi); 30-40 JVM'li bir host tek
// isle AWX sablon zaman asimini (~15 dk) asip olduruluyordu. Bir hostun ogeleri artik en cok N JVM'lik
// PARCALARA bolunur, her parca TEK AWX isi (plan da uygulama da). N = 'limit:toplu_is_basina_jvm' (varsayilan
// 10, ust 50). Sema degismedi: parca = ayni (plan_)job_id'yi tasiyan ogeler.
//   - PLAN: en cok PLAN_PARALEL AWX ISI ayni anda (is sayilir); ayni hostta ayni anda en cok PLAN_HOST_PARALEL
//     (1) is. Plan salt okunurdur (durum acisindan zararsiz) ama her oge jboss-cli JVM'i acar: ayni hostta
//     paralel parca sunucuya / domain controller'a yuk bindirir, parcalamadan onceki gibi hostta tek is.
//   - UYGULAMA: ayni anda TEK is (ayni hostun parcalari da birbirini bekler; sahiplenme kosulu tum toplu iste
//     BASLATILIYOR / CALISIYOR oge olmamasini ister).
//   - SONUCU BELIRSIZ PARCA (AWX'te suruyor olabilir: launch istegi belirsiz hatayla dondu (launchBelirsiz), is
//     numarasi yazilamadi (BASLATILIYOR takili), is 3 saatte bitmedi): toplu is DURUR - bekleyen ogeler
//     YARIM_KALDI ("calistirilmadi: toplu is durduruldu"); ayni hostta ikinci bir yazma isi acilmaz. Belirsiz
//     ogenin nedeni BELIRSIZ_IZ tasir: JVM, AWX isi terminal gorulene kadar KILITLI kalir (topluKilidi: yeni
//     toplu is secim dogrulamasinda duser, tek satir dugmesi 409).
//   - Plan gecerliligi (PLAN_YAS_MS) degismedi: son parca bittiginde (plan_bitis_at) baslar.
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
//
// DOMAIN KAPALI - HOST XML (2026-11-15, kullanici: "bunlar yanlis retire edilmis uygulamalar o yuzden
// auto-start'lari kapatilmali" + "olur ekle lutfen"): taramada host controller'i calismayan domain'in durmus +
// auto-start true JVM'leri CLI ile degistirilemez (jvmAutoStartKapisi). Bunlar ayri aday grubudur (xmlAdaylar;
// kapi /jvm-autostart-xml ile AYNI: sunucuYazmaKapisi + xmlKapatKapisi) ve AYNI motordan gecer:
//   - Oge eylemi XML_KAPAT_EYLEMI (jboss_autostart_xml_off), hedef false. Secimde eylem 'xml_kapat'.
//   - TEK TUR: bir toplu iste YA CLI (ac/kapat) YA host XML ogeleri olur, karisik secim 400 (en basit guvenli
//     secenek: bir AWX isi tek kip, onay metni tek anlam; tur='AUTOSTART' degismez, tur basina tek aktif is
//     kurali ikisini de kapsar - XML toplu isi CLI toplu isi bitince acilir).
//   - Parca = (host, gen) basina en cok isBasinaJvm() JVM; tek AWX isi action jboss_autostart_xml_off, gen +
//     jvms (bosluklu ad listesi; /jvm-autostart-xml ile ayni extra_vars). Plan plan_only=true: ITEM satiri PLAN
//     -> gecti, SKIP (zaten false) -> dustu, FAIL -> dustu. Betik bir JVM'i reddedince ayni istekteki digerlerine
//     "istek durduruldu (baska JVM reddedildi)" yazar: bunlar YENIDEN planlanir (reddedilen olmadan; her turda en
//     az bir oge duser, dongu sonludur). ITEM satiri yoksa (dosya / host controller kapisi) genel RESULT satiri
//     her ogeye yazilir; YALNIZ "<jvm> su an CALISIYOR (ps)" (JVM'e ozgu genel FAIL, inceleme 2026-11-15 #1) o
//     JVM'e yazilir, digerlerine "istek durduruldu (baska JVM reddedildi): ..." (planda yeniden planlanir).
//   - Uygulama: CLI ile ayni sira / tek is / belirsizlik / kilit / iptal; ek olarak host XML rezervasyonu ve
//     kayitli XML isi (ayni dosya) kontrolu; "GERI ALMA BASARISIZ" (dosya elle geri yazilmali) ve "yazildi ama
//     geri okunan ..." (dosya yazildi, icerik beklenenden farkli; inceleme #3) toplu isi DURDURUR. "host controller
//     yazma sirasinda acildi - ... geri alindi" DURDURMAZ: dosya yedekten geri yazildi ve dogrulandi, sunucular
//     bagimsiz (o sunucu yeniden taranir). Uygulamada betigin "istek durduruldu" satiri yeniden kuyruga ALINMAZ
//     (FAIL kalir): dosya plandan sonra degismistir, yeni tarama + yeni toplu is gerekir.
//   - PROD: Production ya da ortami bilinmeyen sunucunun XML ogesi acik prod onayi ister: olusturmada ve onayda
//     prodOnay:true yoksa 400 (code prod_onay); olusturmada verilen onay ogenin ek alanina yazilir, secim
//     dogrulamasinda (taze) prod cikan ama onaysiz oge DUSTU.
'use strict';

const crypto = require('node:crypto');
const {
  LISTE_EYLEMI,
  XML_KAPAT_EYLEMI,
  ogeSonuclari,
  sonucSatiri,
  sunucuYazmaKapisi,
  jvmAutoStartKapisi,
  xmlKapatKapisi,
} = require('./autostart-dogrulama.cjs');

const TUR = 'AUTOSTART';
const FIX_KEY = 'server_hub_fix';
const POLL_SN = 10;
const KIRA_SN = 120;
const PLAN_YAS_MS = 15 * 60 * 1000;
// Ayni anda en cok bu kadar PLAN AWX isi (parca; is sayilir, host degil).
const PLAN_PARALEL = 5;
// Ayni hostta ayni anda en cok bu kadar plan isi (inceleme 2026-11-15, B4): plan salt okunur ama her oge
// jboss-cli JVM'i acar (-Xmx96m) ve domain controller'a baglanir; parcalamadan once hostta en cok 1 is vardi,
// yuk profili korunur. Hostlar arasi paralellik (PLAN_PARALEL) yine gecerli.
const PLAN_HOST_PARALEL = 1;
// 'limit:toplu_is_basina_jvm' okunamazsa / gecersizse (ayarlar.cjs LIMITLER ile ayni varsayilan).
const IS_BASINA_JVM_VARSAYILAN = 10;
const IS_ZAMAN_ASIMI_MS = 3 * 60 * 60 * 1000;
const ADAY_KODLARI = {
  jboss_autostart_on: 'REBOOT_RISK',
  jboss_autostart_off: 'STOPPED_AUTOSTART_ON',
};
const AKTIF = ['PLANLANIYOR', 'PLAN_HAZIR', 'CALISIYOR', 'IPTAL_ISTENDI'];
const YURUYEN = ['PLANLANIYOR', 'CALISIYOR', 'IPTAL_ISTENDI'];
// SECIM: istekle yazilan secim; taze degerlendirmeyle dogrulamasi yurutucude (secimDogrula) -> ADAY | DUSTU.
const SECIM = 'SECIM';
// Secimin taze degerlendirmeyle dogrulanmasi bu sure icinde basaramazsa ogeler DUSTU (is PLAN_HATA).
const SECIM_ZAMAN_ASIMI_MS = 10 * 60 * 1000;
const KILIT_PARALEL = 5;
// Basarisiz dogrulama denemesinden sonra en erken yeniden deneme (TBMWANS zorlanirken her tick'te tum filoyu
// okumasin; 10 sn'lik tick yerine 30 sn). Bellek ici: is id -> ms.
const SECIM_YENIDEN_MS = 30 * 1000;
const _secimSonraki = new Map();
// Bu durumdaki oge JVM'i kilitler (tek satir dugmesi / /fix 409): is sonu ya da YARIM_KALDI'da kalkar.
const KILITLI_OGE = [
  SECIM,
  'ADAY',
  'PLANLANIYOR',
  'PLAN_GECTI',
  'BEKLIYOR',
  'BASLATILIYOR',
  'CALISIYOR',
];
// Sonucu BELIRSIZ uygulama ogesinin (YARIM_KALDI / FAIL) nedeninde bu iz bulunur: AWX'te suruyor olabilir.
// Boyle oge JVM'i AWX isi terminal gorulene kadar (is numarasi yoksa baslamadan IS_ZAMAN_ASIMI_MS boyunca)
// kilitler; en cok BELIRSIZ_PENCERE_SAAT. "calistirilmadi" YARIM_KALDI'lari bu izi TASIMAZ (kilitlemez).
// Toplu Restart'taki BELIRSIZ_IZ penceresiyle ayni model (inceleme 2026-11-15, B1).
const BELIRSIZ_IZ = 'sonucu belirsiz';
const BELIRSIZ_PENCERE_SAAT = 6;
const IS_TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE_VARSAYILAN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const OLUSTURULUYOR = 'OLUSTURULUYOR';
// Host XML (domain kapali) secim eylemi ve oge eylemi.
const XML_SECIM = 'xml_kapat';
const XML = XML_KAPAT_EYLEMI;
// Betik bir JVM'i reddedince ayni istekteki digerlerine yazdigi satir (server_hub_fix.sh jboss_autostart_xml_off).
const XML_DURDURULDU_RE = /istek durduruldu \(baska JVM reddedildi\)/;
// Uygulamada geri alma basarisiz: dosya elle geri yazilmali -> toplu is DURUR.
const XML_GERI_ALMA_RE = /GERI ALMA BASARISIZ/;
// Uygulamada dosya yazildi ama geri okunan icerik / deger beklenenden farkli (betik "yazildi ama geri okunan") -> DURUR.
const XML_GERI_OKUMA_RE = /yazildi ama geri okunan/;
// JVM'e ozgu genel FAIL (betik (a) kapisi ITEM yazmadan durur): yalniz o JVM'in nedeni.
const XML_JVM_CALISIYOR_RE = /^(\S+) su an CALISIYOR \(ps\)/;
// Olusturmada prod tespiti icin onbellekli degerlendirme en cok bu kadar beklenir; gelmezse sunucular prod sayilir.
const PROD_OKUMA_MS = 10 * 1000;
/** Production ya da ortami bilinmeyen (Bilinmiyor / yok) sunucu prod sayilir. */
const prodMu = (h) =>
  h?.envGroup !== 'Non-Production' || String(h.env || '').toUpperCase() === 'PROD';
const xmlMi = (o) => o && (o.eylem === XML || o.action === XML);
/** Oge ek alani (JSON): { prodOnay } ; okunamazsa {}. */
function ekOku(o) {
  try {
    const v = o?.ek ? JSON.parse(o.ek) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

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

const hostRe = () => _d?.HOST_RE || HOST_RE_VARSAYILAN;
const autoStart = () => (_d && typeof _d.autoStart === 'function' ? _d.autoStart() : null);

function denetim(req, detail) {
  try {
    if (_d?.audit) _d.audit(req, detail);
  } catch {
    // denetim kaydi yazilamadi: islem yine tamam
  }
}

/** Yurutucunun AWX'e ve denetime "kim istedi" diye verecegi sozde istek. */
function sozdeIstek(kim) {
  const ad = M(kim, 128) || 'unknown';
  return {
    session: { user: { username: ad, displayName: ad, role: 'Admin' } },
    sessionID: null,
    ip: null,
  };
}

// ── ADAYLAR ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Taze degerlendirmeden aday listesi. Donus: { adaylar, dislananlar, xmlAdaylar }.
 * aday: { host, env, envGroup, gen, jvm, eylem: 'ac'|'kapat', action, running, autoStart, scanDate }.
 * xmlAdaylar: domain kapali (host XML) KAPAT adaylari; ayni alanlar, eylem 'xml_kapat', action
 *   jboss_autostart_xml_off, prod (Production / ortami bilinmeyen). Kapi /jvm-autostart-xml ile AYNI.
 * dislanan: ayni alanlar + neden (uyumsuz gorunen ama kapidan gecmeyen JVM; ekran nedenini gosterir).
 */
function adaylariTuret(a, opts = {}) {
  const as = opts.autoStart || autoStart();
  const adaylar = [];
  const dislananlar = [];
  const xmlAdaylar = [];
  for (const h of a?.hosts || []) {
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
          dislananlar.push({
            ...satir,
            neden:
              'Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.',
          });
        ikiKez.add(tk);
        continue;
      }
      if (!(satir.gen === 7 || satir.gen === 8)) {
        dislananlar.push({
          ...satir,
          neden: 'JBoss sürümü (7/8) taramada belirlenemedi — iş açılmaz.',
        });
        continue;
      }
      if (j.autoStartDogrulama && j.autoStart !== tarama) {
        dislananlar.push({
          ...satir,
          neden: `iş #${j.autoStartDogrulama.jobId} ile doğrulandı — tarama bekleniyor`,
        });
        continue;
      }
      // DOMAIN KAPALI + KAPAT: host XML grubu (bayat / sema kapisi once ve mesaji aynen; ornek GBFSTT01).
      if (j.domainKapali === true && action === 'jboss_autostart_off') {
        const sk = sunucuYazmaKapisi(a, h, h.host);
        if (sk) {
          dislananlar.push({ ...satir, neden: sk.message });
          continue;
        }
        const xk = xmlKapatKapisi(j, { host: h.host, jvm: tj.name, gen: Number(tj.gen) });
        if (xk) {
          dislananlar.push({
            ...satir,
            neden: `Domain kapalı; “Domain kapalı — auto-start host XML üzerinden kapat” bölümüne de alınmadı: ${xk.message}`,
          });
          continue;
        }
        const sx = as ? as.surenIs(h.host, tj.gen, tj.name) : null;
        if (sx) {
          dislananlar.push({
            ...satir,
            neden: sx.jobId ? `iş #${sx.jobId} sürüyor` : 'iş başlatılıyor',
          });
          continue;
        }
        xmlAdaylar.push({ ...satir, eylem: XML_SECIM, action: XML, prod: prodMu(h) });
        continue;
      }
      const k =
        sunucuYazmaKapisi(a, h, h.host) ||
        jvmAutoStartKapisi(j, { host: h.host, jvm: tj.name, gen: Number(tj.gen), enable });
      if (k) {
        // Domain kapali + AC: host XML yolu yalniz kapatir; neden bunu da soyler.
        const ek =
          j.domainKapali === true && enable && !sunucuYazmaKapisi(a, h, h.host)
            ? ' “Domain kapalı — auto-start host XML üzerinden kapat” bölümü yalnız durmuş JVM’in auto-start’ını kapatır; açma yapmaz.'
            : '';
        dislananlar.push({ ...satir, neden: `${k.message}${ek}` });
        continue;
      }
      // assess'in KENDI duzeltmesi de olmali (tazelik / sema / tanimsiz surec kapilari orada da var).
      const kod = ADAY_KODLARI[action];
      const bulgu = (h.findings || []).find(
        (f) =>
          f.code === kod &&
          f.fix?.action === action &&
          f.fix.jvm === tj.name &&
          Number(f.fix.gen) === Number(tj.gen),
      );
      if (!bulgu) {
        dislananlar.push({ ...satir, neden: 'Bulgu düzeltme önermiyor (assess) — iş açılmaz.' });
        continue;
      }
      const s = as ? as.surenIs(h.host, tj.gen, tj.name) : null;
      if (s) {
        dislananlar.push({
          ...satir,
          neden: s.jobId ? `iş #${s.jobId} sürüyor` : 'iş başlatılıyor',
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
  xmlAdaylar.sort(sira);
  return { adaylar, dislananlar, xmlAdaylar };
}

/**
 * Host XML adaylarini (host, gen) domain'ine gore gruplar (ekran domain'i birlikte secer).
 * Donus: [{ host, gen, env, envGroup, prod, scanDate, jvms: [{ jvm, autoStart, running }] }] (host, gen sirali).
 */
function xmlGrupla(xmlAdaylar) {
  const m = new Map();
  for (const x of xmlAdaylar || []) {
    const k = `${x.host}|${x.gen}`;
    if (!m.has(k))
      m.set(k, {
        host: x.host,
        gen: x.gen,
        env: x.env,
        envGroup: x.envGroup,
        prod: x.prod === true,
        scanDate: x.scanDate,
        jvms: [],
      });
    m.get(k).jvms.push({ jvm: x.jvm, autoStart: x.autoStart, running: x.running });
  }
  return [...m.values()];
}

const ogeAnahtari = (host, gen, jvm) =>
  `${String(host || '').toUpperCase()}|${Number(gen)}|${String(jvm || '').toLowerCase()}`;

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
    hostXml: r.eylem === XML,
    baslamaAt: iso(r.baslama_at),
    bitisAt: iso(r.bitis_at),
  };
}

/** Is satirinin sayimlarini ogelerden yeniden hesaplar. */
async function sayimYaz(isId) {
  await db().query(
    `UPDATE server_hub_toplu_isler SET
        aday = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1),
        plan_gecti = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum NOT IN ('SECIM', 'ADAY', 'PLANLANIYOR', 'DUSTU')),
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
  if (['OK', 'SKIP', 'FAIL', 'DUSTU', 'IPTAL', 'YARIM_KALDI'].includes(yeni))
    set.push('bitis_at = SYSUTCDATETIME()');
  p.push(...eski);
  const kosul = eski.map((_, i) => `$${p.length - eski.length + i + 1}`).join(', ');
  const r = await db().query(
    `UPDATE server_hub_toplu_ogeler SET ${set.join(', ')} WHERE id = $1 AND durum IN (${kosul})`,
    p,
  );
  return r.rowCount === 1;
}

// ── KILIT (tek satir dugmesi / /fix) ─────────────────────────────────────────────────────────────

/**
 * Bu JVM bir toplu isin bekleyen / calisan ogesi mi? Donus: 409 mesaji ya da null. DB okunamazsa null
 * (tek satir isi acilir; betik canli degeri okur, toplu isteki oge sonra SKIP doner - zararsiz).
 * haricIs: secimi dogrulanan isin kendi ogeleri (SECIM) sayilmaz.
 */
async function topluKilidi(host, gen, jvm, { haricIs = null, belirsizler = null } = {}) {
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
      return `${jvm} toplu auto-start işi #${r.is_id} içinde (${r.durum}) — o iş bitene ya da iptal edilene kadar tek tek iş açılmaz (iş açılmadı). Server Hub › Toplu Auto-Start sekmesinden izleyin.`;
    const H = String(host || '').toUpperCase();
    const L = (s) => String(s || '').toLowerCase();
    const y = (belirsizler || (await belirsizOgeler())).find(
      (x) =>
        x.host === H &&
        Number(x.gen) === Number(gen) &&
        L(x.jvm) === L(jvm) &&
        (haricIs == null || Number(x.is_id) !== Number(haricIs)),
    );
    if (!y) return null;
    const ne = y.jobId
      ? `AWX işi #${y.jobId} henüz bitmedi ya da okunamadı`
      : "iş numarası yok, AWX'e gitmiş olabilir";
    return `${jvm} için toplu auto-start işi #${y.is_id} öğesinin sonucu bilinmiyor (${ne}) — AWX işi bitene kadar bu JVM'e iş açılmaz (iş açılmadı). AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın.`;
  } catch (e) {
    console.warn('[TopluAutoStart] kilit okunamadi:', e?.message);
    return null;
  }
}

/**
 * Sonucu BILINMEYEN auto-start ogeleri (tum toplu auto-start isleri, son BELIRSIZ_PENCERE_SAAT saat): neden
 * BELIRSIZ_IZ tasir ve AWX isi bitmemis (okunamiyorsa bitmemis sayilir) ya da is numarasi yok ve
 * baslamasindan bu yana IS_ZAMAN_ASIMI_MS gecmemis. Donus: [{ id, is_id, host, gen, jvm, jobId }]. DB
 * okunamazsa firlatir.
 */
async function belirsizOgeler() {
  const { rows } = await db().query(
    `SELECT o.id, o.is_id, o.host, o.gen, o.jvm, o.awx_server_id, o.awx_job_id, o.baslama_at
       FROM server_hub_toplu_ogeler o JOIN server_hub_toplu_isler i ON i.id = o.is_id
      WHERE i.tur = $1 AND o.durum IN ('YARIM_KALDI', 'FAIL') AND o.neden LIKE $2
        AND o.bitis_at > DATEADD(hour, -${BELIRSIZ_PENCERE_SAAT}, SYSUTCDATETIME())`,
    [TUR, `%${BELIRSIZ_IZ}%`],
  );
  const out = [];
  const durumlar = new Map();
  for (const o of rows || []) {
    let suruyor;
    if (o.awx_job_id != null) {
      const k = `${o.awx_server_id}|${o.awx_job_id}`;
      if (!durumlar.has(k)) durumlar.set(k, await isDurumu(o.awx_server_id, o.awx_job_id));
      const st = durumlar.get(k);
      suruyor = !st || !IS_TERMINAL.has(st.status);
    } else
      suruyor = !o.baslama_at || Date.now() - new Date(o.baslama_at).getTime() <= IS_ZAMAN_ASIMI_MS;
    if (suruyor)
      out.push({
        id: o.id,
        is_id: o.is_id,
        host: String(o.host || '').toUpperCase(),
        gen: o.gen,
        jvm: o.jvm,
        jobId: o.awx_job_id || null,
      });
  }
  return out;
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
    const host = String(x?.host || '')
      .trim()
      .toUpperCase();
    const jvm = String(x?.jvm || '').trim();
    const gen = Number(x?.gen);
    const eylem = String(x?.eylem || '');
    if (!hostRe().test(host)) throw hata(400, `Geçersiz sunucu adı: ${M(host, 64) || '(boş)'}`);
    if (!JVM_RE.test(jvm)) throw hata(400, `Geçersiz JVM adı: ${M(jvm, 64) || '(boş)'}`);
    if (gen !== 7 && gen !== 8) throw hata(400, `Geçersiz JBoss sürümü (gen): ${host}/${jvm}`);
    if (eylem !== 'ac' && eylem !== 'kapat' && eylem !== XML_SECIM)
      throw hata(400, `Geçersiz eylem: ${host}/${jvm}`);
    const k = ogeAnahtari(host, gen, jvm);
    if (gorulen.has(k)) throw hata(400, `Aynı JVM iki kez seçilmiş: ${host}/${jvm}`);
    gorulen.add(k);
    const action =
      eylem === 'ac' ? 'jboss_autostart_on' : eylem === 'kapat' ? 'jboss_autostart_off' : XML;
    out.push({ host, jvm, gen, eylem, action });
  }
  // Tek kip: CLI (ac/kapat) ve host XML ogeleri ayni toplu iste olmaz (bkz. baslik, DOMAIN KAPALI - HOST XML).
  const xmlSay = out.filter((x) => x.action === XML).length;
  if (xmlSay && xmlSay !== out.length)
    throw hata(
      400,
      'Host XML (domain kapalı) öğeleri ile CLI (AÇ / KAPAT) öğeleri aynı toplu işte olmaz — ayrı ayrı planlayın.',
      'karisik_secim',
    );
  return out;
}

/**
 * Olusturmada prod tespiti (yalniz host XML secimi): onbellekli degerlendirme (fresh degil) en cok PROD_OKUMA_MS
 * beklenir; gelmezse ya da sunucu yoksa prod sayilir (guvenli taraf). Donus: prod sunucu adlari (Set).
 */
async function prodHostlari(hostlar) {
  let a = null;
  let t = null;
  try {
    a = await Promise.race([
      _d.getAssessment(false),
      new Promise((resolve) => {
        t = setTimeout(() => resolve(null), PROD_OKUMA_MS);
      }),
    ]);
  } catch {
    a = null;
  } finally {
    if (t) clearTimeout(t);
  }
  const byHost = new Map((a?.hosts || []).map((h) => [h.host, h]));
  return new Set(hostlar.filter((x) => prodMu(byHost.get(x))));
}

/** Prod onayi yoksa 400 (code prod_onay); mesaj sunuculari sayar. */
function prodOnayYok(prodlar) {
  const l = [...prodlar];
  return hata(
    400,
    `Production / ortamı bilinmeyen ${l.length} sunucu seçimde (${l.slice(0, 5).join(', ')}${l.length > 5 ? ` +${l.length - 5}` : ''}) — host XML ile kapatma için açık prod onayı gerekli (prodOnay).`,
    'prod_onay',
  );
}

/**
 * Istek yalniz SECIMI kaydeder (uretim 2026-11-14, Toplu Restart'ta 33 JVM -> HTTP 500 + nginx index.html; ayni
 * desen): eskiden istek icinde tum filo taze okunuyor (getAssessment(true), TBMWANS 30 sn requestTimeout) ve oge
 * basina SIRALI kilit sorgusu bekleniyordu. Simdi is + ogeler (SECIM) hemen yazilir; taze degerlendirme, aday
 * yeniden turetme (eylem eslesmesi dahil) ve kilit yurutucude (secimDogrula). Gecemeyen oge DUSTU (nedeniyle).
 */
async function olustur(req, secim, { prodOnay = false } = {}) {
  const enCok = await _d.ayarlar.limit('toplu_autostart');
  const istek = secimiDuzle(secim, enCok);
  const xmlIs = istek.length > 0 && istek[0].action === XML;
  if (xmlIs && prodOnay !== true) {
    const prodlar = await prodHostlari([...new Set(istek.map((c) => c.host))]);
    if (prodlar.size) throw prodOnayYok(prodlar);
  }
  const ekMetni = xmlIs ? JSON.stringify({ prodOnay: prodOnay === true }) : null;
  const akt = await aktifIs();
  if (akt)
    throw hata(
      409,
      `Toplu auto-start işi #${akt.id} hâlâ aktif (${akt.durum}) — önce o bitmeli ya da iptal edilmeli.`,
      'aktif_is',
    );
  const secilen = istek;
  const kim = M(req.session?.user?.username || 'unknown', 128);
  let isId;
  try {
    const r = await db().query(
      `INSERT INTO server_hub_toplu_isler (tur, durum, olusturan, ust_sinir, aday, kira_id, kira_bitis)
       VALUES ($1, 'PLANLANIYOR', $2, $3, $4, $5, DATEADD(second, ${KIRA_SN}, SYSUTCDATETIME())) RETURNING id`,
      [TUR, kim, enCok, secilen.length, OLUSTURULUYOR],
    );
    isId = r.rows?.[0]?.id;
  } catch (e) {
    // UX_shti_aktif: eszamanli ikinci olusturma
    if (/UX_shti_aktif|duplicate key|UNIQUE/i.test(String(e?.message)))
      throw hata(
        409,
        'Başka bir toplu auto-start işi az önce açıldı — sayfayı yenileyin.',
        'aktif_is',
      );
    throw e;
  }
  if (!isId) throw hata(500, 'Toplu iş kaydı oluşturulamadı.');
  try {
    // 2100 parametre siniri: 100'luk parcalar.
    for (let i = 0; i < secilen.length; i += 100) {
      const parca = secilen.slice(i, i + 100);
      const p = [];
      const v = parca.map((c, j) => {
        // env / tarama degeri / calisiyor / tarama tarihi secimDogrula'da taze degerlendirmeden yazilir.
        p.push(
          isId,
          i + j + 1,
          c.host,
          null,
          c.gen,
          c.jvm,
          c.action,
          c.action === 'jboss_autostart_on' ? 'true' : 'false',
          null,
          null,
          null,
          ekMetni,
        );
        const b = p.length - 12;
        return `(${Array.from({ length: 12 }, (_, n) => `$${b + n + 1}`).join(', ')}, '${SECIM}')`;
      });
      await db().query(
        `INSERT INTO server_hub_toplu_ogeler (is_id, sira, host, env, gen, jvm, eylem, hedef, tarama_degeri, calisiyor, tarama_scan_date, ek, durum) VALUES ${v.join(', ')}`,
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
  const hostlar = [...new Set(secilen.map((c) => c.host))];
  denetim(req, {
    op: 'toplu_autostart_olustur',
    id: isId,
    adet: secilen.length,
    hostlar,
    ...(xmlIs ? { kip: 'xml', prodOnay: prodOnay === true } : {}),
  });
  return {
    id: isId,
    adet: secilen.length,
    hostSayisi: hostlar.length,
    dogrulaniyor: true,
    kip: xmlIs ? 'xml' : 'cli',
  };
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
 */
async function secimOkunamadi(is, liste, e, ne = 'Taze değerlendirme okunamadı') {
  const msg = M(e?.message, 300) || 'bilinmeyen hata';
  console.warn(`[TopluAutoStart] is #${is.id} secim dogrulanamadi:`, msg);
  if (is.created_at && Date.now() - new Date(is.created_at).getTime() > SECIM_ZAMAN_ASIMI_MS) {
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
 * adaylariTuret'ten yeniden turetilir (sunucu / JVM kapilari, assess duzeltmesi, suren is) ve eylem secimle
 * ayni olmali; baska toplu auto-start isinin ogesi olan JVM gecemez. Gecen ADAY (taze degerlerle), gecemeyen
 * DUSTU. Okuma hatasinda SECIM_ZAMAN_ASIMI_MS boyunca yeniden denenir. Donus: true (plan devam eder).
 */
async function secimDogrula(is, og) {
  const liste = og.filter((o) => o.durum === SECIM);
  if (!liste.length) return true;
  let a;
  try {
    a = await _d.getAssessment(true);
  } catch (e) {
    await secimOkunamadi(is, liste, e);
    return false;
  }
  if (!(await kiraYenile(is.id))) return false;
  const { adaylar, dislananlar, xmlAdaylar } = adaylariTuret(a);
  const byK = new Map(
    [...adaylar, ...xmlAdaylar].map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]),
  );
  const disK = new Map(dislananlar.map((x) => [ogeAnahtari(x.host, x.gen, x.jvm), x]));
  // Sonucu belirsiz eski ogeler bir kez okunur (oge basina sorgu yok); okunamazsa topluKilidi kendisi dener.
  let belirsizler = null;
  try {
    belirsizler = await belirsizOgeler();
  } catch {
    belirsizler = null;
  }
  const kararlar = await sinirliParalel(liste, KILIT_PARALEL, async (o) => {
    const k = ogeAnahtari(o.host, o.gen, o.jvm);
    const c = byK.get(k);
    if (!c || c.action !== o.eylem) {
      const d = disK.get(k);
      return {
        neden: `artık aday değil${d ? ` (${d.neden})` : c ? ' (eylem değişti)' : ' (tarama değişti)'}`,
      };
    }
    // Taze degerlendirmede prod (ya da ortami bilinmeyen) cikan host XML ogesi olusturmadaki prod onayi olmadan gecemez.
    if (xmlMi(c) && c.prod && ekOku(o).prodOnay !== true)
      return {
        neden: `${c.host} Production / ortamı bilinmeyen sunucu — prod onayı verilmedi (host XML ile kapatılmaz)`,
      };
    // DB tabanli kilit: ayni JVM baska bir toplu isin ogesiyse (YARIM_KALDI izlemesi ve sonucu belirsiz oge
    // dahil) gecemez.
    const kilit = await topluKilidi(c.host, c.gen, c.jvm, { haricIs: is.id, belirsizler });
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
    await ogeDurum(o.id, [SECIM], 'ADAY', {
      jvm: c.jvm,
      env: M(c.env, 32) || null,
      tarama_degeri: c.autoStart,
      calisiyor: c.running ? 1 : 0,
      tarama_scan_date: M(c.scanDate, 32) || null,
    });
  }
  if (is.hata)
    await db().query(`UPDATE server_hub_toplu_isler SET hata = NULL WHERE id = $1`, [is.id]);
  return true;
}

const planEskiMi = (is) =>
  !is.plan_bitis_at || Date.now() - new Date(is.plan_bitis_at).getTime() > PLAN_YAS_MS;

/**
 * PLAN_HAZIR -> PLAN_ESKIDI (CAS); PLAN_GECTI ogeler IPTAL (JVM kilitleri kalkar). Onay ve yurutucu ortak:
 * terk edilen plan JVM'leri suresiz kilitlemesin (inceleme 2026-11-14).
 */
async function planEskit(req, id) {
  const r = await db().query(
    `UPDATE server_hub_toplu_isler SET durum = 'PLAN_ESKIDI', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
    [id, 'Plan bittikten sonra 15 dakika içinde onaylanmadı — yeniden planlayın.'],
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

async function onayla(req, id, { prodOnay = false } = {}) {
  const is = await isOku(id);
  if (!is) throw hata(404, `Toplu iş #${id} yok.`);
  if (is.durum !== 'PLAN_HAZIR')
    throw hata(409, `Toplu iş #${id} onaylanamaz (durum ${is.durum}).`, 'durum');
  const kim = M(req.session?.user?.username || 'unknown', 128);
  if (planEskiMi(is)) {
    await planEskit(req, id);
    throw hata(
      409,
      'Plan bitişinin üzerinden 15 dakika geçti — canlı değerler yeniden okunmalı. Yeniden planlayın.',
      'plan_eskidi',
    );
  }
  // Onay aninda TAZE sema / tazelik kapisi: sunucu bu arada bayatladiysa o sunucunun ogeleri dusurulur.
  const a = await _d.getAssessment(true);
  if (a.schemaUnknown === true)
    throw hata(
      400,
      'Server Hub şeması (sys.columns) okunamadı — onay verilmedi; sayfayı yenileyin.',
    );
  const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
  const og = await ogeler(id);
  const enCok = await _d.ayarlar.limit('toplu_autostart');
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI');
  if (gecen.length > enCok)
    throw hata(
      400,
      `Limit ${enCok} JVM'e düşürülmüş (${gecen.length} öğe) — yeniden planlayın.`,
      'limit',
    );
  let kalan = 0;
  const as = autoStart();
  // Once karar (yazmadan): prod onayi eksikse hicbir oge degismeden 400.
  const kararlar = gecen.map((o) => {
    const h = byHost.get(o.host);
    // JVM duzeyi kapi da yeniden (inceleme 2026-11-14): plandan sonra baslatilan JVM'in KAPAT ogesi ya da
    // bu arada hedefe gelmis JVM burada duser (betik reddedip ozeti kirmiziya boyamasin). Host XML ogesi
    // /jvm-autostart-xml ile ayni kapidan (domain hala kapali gorunmeli).
    const tj = h
      ? (h.jvms || []).find((x) => x.name === o.jvm && Number(x.gen) === Number(o.gen))
      : null;
    const j = tj && as ? as.uygulaJvm(h, tj) : tj;
    const k =
      sunucuYazmaKapisi(a, h, o.host) ||
      (xmlMi(o)
        ? xmlKapatKapisi(j, { host: o.host, jvm: o.jvm, gen: Number(o.gen) })
        : jvmAutoStartKapisi(j, {
            host: o.host,
            jvm: o.jvm,
            gen: Number(o.gen),
            enable: o.eylem === 'jboss_autostart_on',
          }));
    return { o, k, prod: xmlMi(o) && prodMu(h) };
  });
  const prodlar = new Set(kararlar.filter((x) => !x.k && x.prod).map((x) => x.o.host));
  if (prodlar.size && prodOnay !== true) throw prodOnayYok(prodlar);
  for (const { o, k } of kararlar) {
    if (k)
      await ogeDurum(o.id, ['PLAN_GECTI'], 'DUSTU', {
        neden: M(`onay anında: ${k.message}`, 1000),
      });
    else kalan += 1;
  }
  if (!kalan) {
    await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'BITTI', onaylayan = $2, onay_at = SYSUTCDATETIME(), bitis_at = SYSUTCDATETIME(), hata = $3 WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [
        id,
        kim,
        'Onay anında uygulanacak öğe kalmadı (sunucu taraması bayatladı ya da JVM durumu değişti).',
      ],
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
  if (r.rowCount !== 1)
    throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'BEKLIYOR' WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, {
    op: 'toplu_autostart_onay',
    id,
    adet: kalan,
    ...(prodlar.size ? { prodOnay: true, prodHostlar: [...prodlar] } : {}),
  });
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
    denetim(req, { op: 'toplu_autostart_iptal', id, durum: 'IPTAL' });
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
  // Bekleyen ogeler hemen IPTAL; suren AWX isi iptal EDILMEZ (bitmesi beklenir, sonucu yazilir).
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'BEKLIYOR')`,
    [id],
  );
  await sayimYaz(id);
  denetim(req, { op: 'toplu_autostart_iptal', id, durum: 'IPTAL_ISTENDI' });
  return { id, durum: 'IPTAL_ISTENDI' };
}

// ── YURUTUCU ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Bir AWX isinde birlikte gidebilecek ogelerin anahtari: CLI ogeleri host basina (jvm_items gen tasir), host XML
 * ogeleri (host, gen) basina (tek host XML dosyasi; extra_vars tek gen). Iki kip ASLA ayni anahtarda olmaz.
 */
const parcaAnahtari = (o) => (xmlMi(o) ? `${o.host}|${Number(o.gen)}|xml` : `${o.host}|cli`);

/**
 * Ogeleri AWX isi parcalarina boler: anahtar basina (parcaAnahtari; ilk gorulme sirasiyla), her grubun ogeleri
 * liste sirasiyla en cok n'lik dilimler. Donus: [{ host, gen (yalniz XML), xml, liste }].
 */
function parcala(liste, n) {
  const k = Math.max(1, Number(n) || 1);
  const m = new Map();
  for (const o of liste) {
    const a = parcaAnahtari(o);
    if (!m.has(a)) m.set(a, []);
    m.get(a).push(o);
  }
  const out = [];
  for (const l of m.values()) {
    const xml = xmlMi(l[0]);
    for (let i = 0; i < l.length; i += k)
      out.push({
        host: l[0].host,
        ...(xml ? { gen: Number(l[0].gen) } : {}),
        xml,
        liste: l.slice(i, i + k),
      });
  }
  return out;
}

/** Parcanin AWX extra_vars'i: CLI jboss_autostart_items + jvm_items; host XML jboss_autostart_xml_off + gen + jvms. */
function isDegiskenleri(host, liste, planOnly) {
  if (xmlMi(liste[0]))
    return {
      target_host: host,
      action: XML,
      plan_only: planOnly,
      reload: false,
      gen: Number(liste[0].gen),
      jvms: liste.map((o) => o.jvm).join(' '),
    };
  return {
    target_host: host,
    action: LISTE_EYLEMI,
    plan_only: planOnly,
    reload: false,
    jvm_items: jvmItems(liste),
  };
}

/**
 * Parca ogelerinin sonucu (ogeSonuclari). Host XML isinde betik dosya / host controller kapisinda durursa ITEM
 * satiri yazmaz: genel RESULT satiri FAIL ise satiri olmayan her ogeye o yazilir (dogrulanmaz). Istisna: genel
 * FAIL "<jvm> su an CALISIYOR (ps)" ve o JVM parcadaysa yalniz ona; digerleri "istek durduruldu" (betik onlari
 * hic denemedi; planda yeniden planlanir, uygulamada FAIL kalir).
 */
function parcaSonuclari(liste, result) {
  const s = ogeSonuclari(jvmItems(liste), result);
  if (!liste.length || !xmlMi(liste[0])) return s;
  const r = result && typeof result === 'object' ? result : null;
  const g = r?.action === XML ? sonucSatiri(r.line) : null;
  if (g?.action !== XML || g.durum !== 'FAIL') return s;
  const cj = XML_JVM_CALISIYOR_RE.exec(g.mesaj || '');
  const tek = cj && liste.some((o) => o.jvm === cj[1]) ? cj[1] : null;
  return s.map((x, i) => {
    if (x.durum) return x;
    if (tek && liste[i].jvm !== tek)
      return {
        ...x,
        durum: 'FAIL',
        mesaj: `istek durduruldu (baska JVM reddedildi): ${g.mesaj}`,
        dogrulandi: false,
      };
    return { ...x, durum: 'FAIL', mesaj: g.mesaj, dogrulandi: false };
  });
}

/** Suren ogeler AWX isine gore (parca = ayni is numarasini tasiyan ogeler); is numarasi yoksa anahtar 'yok'. */
function gruplaIs(liste, sunucuAlani, isAlani) {
  const m = new Map();
  for (const o of liste) {
    const k = o[isAlani] == null ? 'yok' : `${o[sunucuAlani]}|${o[isAlani]}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return m;
}

/** Admin ayari 'limit:toplu_is_basina_jvm': bir AWX isine en cok kac JVM. Okunamaz / gecersizse varsayilan. */
async function isBasinaJvm() {
  try {
    const n = Number(await _d.ayarlar.limit('toplu_is_basina_jvm'));
    if (Number.isInteger(n) && n >= 1) return n;
  } catch {
    // ayar okunamadi: varsayilan
  }
  return IS_BASINA_JVM_VARSAYILAN;
}

/** id listesi icin SQL yer tutuculari ($bas, $bas+1, ...). */
const yerTutucu = (ids, bas) => ids.map((_, i) => `$${bas + i}`).join(', ');

/**
 * Sonucu belirsiz parca (AWX'te suruyor olabilir) sonrasi toplu is DURUR: bekleyen ogeler YARIM_KALDI
 * ("calistirilmadi"); ayni hostta ikinci bir yazma isi acilmaz. Ozet kirmizi (uygulaBitir: YARIM_KALDI).
 */
async function topluDurdur(
  is,
  neden,
  kuyruk = "Sonucu bilinmeyen iş AWX'te sürüyor olabilir; AWX'ten kontrol edin, sunucuyu yeniden tarayın, sonra yeni toplu iş açın.",
) {
  const r = await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'BEKLIYOR'`,
    [is.id, M(`çalıştırılmadı: toplu iş durduruldu — ${neden}. ${kuyruk}`, 1000)],
  );
  if (r.rowCount)
    denetim(sozdeIstek(is.onaylayan || is.olusturan), {
      op: 'toplu_autostart_durduruldu',
      id: is.id,
      neden,
      adet: r.rowCount,
    });
}

const jvmItems = (liste) => liste.map((o) => ({ gen: Number(o.gen), jvm: o.jvm, action: o.eylem }));

function sonucOku(st) {
  const { extractStatsKey } = require('../opsx/index.cjs');
  return extractStatsKey(st?.artifacts, 'server_hub_fix_result') || null;
}

/** AWX'ten is durumu; okunamazsa null (sonraki tick yeniden). */
async function isDurumu(serverId, jobId) {
  try {
    return await runner().getJobStatusOnServer(serverId, jobId);
  } catch (e) {
    console.warn(`[TopluAutoStart] is #${jobId} okunamadi:`, e?.message);
    return null;
  }
}

const zamanAsimi = (o) =>
  o.baslama_at && Date.now() - new Date(o.baslama_at).getTime() > IS_ZAMAN_ASIMI_MS;

/**
 * PLAN fazi: suren plan islerini (parca basina bir is) isle; iptal istenmediyse ayni anda en cok PLAN_PARALEL
 * plan isi olacak sekilde yeni parcalar ac (parca = bir hostun en cok isBasinaJvm() ogesi).
 */
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
  const suren = gruplaIs(
    og.filter((o) => o.durum === 'PLANLANIYOR'),
    'plan_awx_server_id',
    'plan_job_id',
  );
  for (const [k, liste] of suren) {
    const o0 = liste[0];
    if (k === 'yok') {
      // ayni surecte launch suresince olmaz (tick tek); burada gorulmesi = yarim kalmis baslatma
      for (const o of liste)
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: 'plan başlatılamadı (iş numarası yok)',
        });
      continue;
    }
    const st = await isDurumu(o0.plan_awx_server_id, o0.plan_job_id);
    if (!st || !IS_TERMINAL.has(st.status)) {
      if (zamanAsimi(o0))
        for (const o of liste)
          await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
            neden: `plan işi #${o0.plan_job_id} 3 saatte bitmedi — AWX'ten kontrol edin`,
          });
      continue;
    }
    const result = sonucOku(st);
    const xml = xmlMi(o0);
    const s = parcaSonuclari(liste, result);
    // Host XML: betik bir JVM'i reddedince digerlerine "istek durduruldu" yazar; gercek red varsa onlar yeniden
    // planlanir (reddedilen olmadan). Gercek red yoksa (yalniz bu satir) duser: dongu olmaz.
    const durdurulduMu = (x) => x.durum === 'FAIL' && XML_DURDURULDU_RE.test(x.mesaj || '');
    const gercekRed = xml && s.some((x) => x.durum === 'FAIL' && !durdurulduMu(x));
    for (let i = 0; i < liste.length; i += 1) {
      const o = liste[i];
      const x = s[i];
      const satir = x.durum ? `${x.durum} ${x.mesaj}`.trim() : null;
      if (x.durum === 'PLAN')
        await ogeDurum(o.id, ['PLANLANIYOR'], 'PLAN_GECTI', {
          neden: M(x.mesaj || 'canlı değer hâlâ uyumsuz', 1000),
          sonuc_satiri: M(satir, 1000),
        });
      else if (x.durum === 'SKIP')
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: M(
            xml
              ? `host XML'de auto-start zaten false — tarama eski (${x.mesaj})`
              : `canlı değer zaten ${o.hedef} — tarama eski (${x.mesaj})`,
            1000,
          ),
          sonuc_satiri: M(satir, 1000),
        });
      else if (gercekRed && durdurulduMu(x))
        await ogeDurum(o.id, ['PLANLANIYOR'], 'ADAY', {
          neden: M(
            `yeniden planlanacak: plan işi #${o0.plan_job_id} içinde başka JVM reddedildi (bu JVM'e dokunulmadı)`,
            1000,
          ),
          sonuc_satiri: M(satir, 1000),
          plan_awx_server_id: null,
          plan_job_id: null,
        });
      else if (x.durum)
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: M(
            xml
              ? `host XML planında: ${x.mesaj || x.durum}`
              : `canlı okumada: ${x.mesaj || x.durum}`,
            1000,
          ),
          sonuc_satiri: M(satir, 1000),
        });
      else
        await ogeDurum(o.id, ['PLANLANIYOR'], 'DUSTU', {
          neden: M(
            `plan okunamadı (iş #${o0.plan_job_id} ${st.status}${result ? '' : `; set_stats yok — AWX'teki server_hub_fix.yml ${xml ? XML : LISTE_EYLEMI} kipini tanımıyor olabilir (playbook güncel mi?)`})`,
            1000,
          ),
        });
    }
  }
  if (iptalMi) return;
  const tazeOg = await ogeler(is.id);
  // Paralellik AWX ISI sayisiyla (PLAN_PARALEL) ve host basina PLAN_HOST_PARALEL ile: ayni hostta ayni anda en
  // cok bu kadar plan isi (jboss-cli acilislari sunucuya / domain controller'a yuk; parcalamadan once de 1'di).
  const surenPlan = gruplaIs(
    tazeOg.filter((o) => o.durum === 'PLANLANIYOR'),
    'plan_awx_server_id',
    'plan_job_id',
  );
  let bos = Math.max(0, PLAN_PARALEL - surenPlan.size);
  if (bos <= 0) return;
  const hostta = new Map();
  for (const l of surenPlan.values()) hostta.set(l[0].host, (hostta.get(l[0].host) || 0) + 1);
  const n = await isBasinaJvm();
  for (const { host, gen, xml, liste } of parcala(
    tazeOg.filter((o) => o.durum === 'ADAY'),
    n,
  )) {
    if (bos <= 0) break;
    if ((hostta.get(host) || 0) >= PLAN_HOST_PARALEL) continue;
    if (!(await kiraYenile(is.id))) return;
    const ids = liste.map((o) => o.id);
    const al = await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'PLANLANIYOR', baslama_at = SYSUTCDATETIME()
        WHERE is_id = $1 AND durum = 'ADAY' AND id IN (${yerTutucu(ids, 3)})
          AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $2)`,
      [is.id, SUREC_ID, ...ids],
    );
    if (al.rowCount < 1) continue;
    bos -= 1;
    hostta.set(host, (hostta.get(host) || 0) + 1);
    // Sahiplenilen ogeler (bu arada iptal edilen dusulur); parca = is numarasi henuz yazilmamis bu ogeler.
    const parca = (await ogeler(is.id)).filter(
      (o) => ids.includes(o.id) && o.durum === 'PLANLANIYOR' && o.plan_job_id == null,
    );
    const pids = parca.map((o) => o.id);
    if (!pids.length) continue;
    try {
      const r = await _d.launch(
        sozdeIstek(is.olusturan),
        FIX_KEY,
        `Server Hub: toplu auto-start #${is.id} plan${xml ? ` (host XML, JBoss ${gen})` : ''} @ ${host} (${parca.length} JVM)`,
        isDegiskenleri(host, parca, true),
        {
          op: 'toplu_autostart_plan',
          id: is.id,
          host,
          adet: parca.length,
          ...(xml ? { kip: 'xml', gen } : {}),
        },
      );
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET plan_awx_server_id = $2, plan_job_id = $3
          WHERE is_id = $1 AND durum = 'PLANLANIYOR' AND plan_job_id IS NULL AND id IN (${yerTutucu(pids, 4)})`,
        [is.id, r.awxServerId, r.jobId, ...pids],
      );
    } catch (e) {
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = $2, bitis_at = SYSUTCDATETIME()
          WHERE is_id = $1 AND durum = 'PLANLANIYOR' AND plan_job_id IS NULL AND id IN (${yerTutucu(pids, 3)})`,
        [is.id, M(`plan başlatılamadı: ${e?.message}`, 1000), ...pids],
      );
    }
  }
}

async function planBitir(is) {
  const og = await ogeler(is.id);
  const gecen = og.filter((o) => o.durum === 'PLAN_GECTI').length;
  const okunamadi = og.filter(
    (o) => o.durum === 'DUSTU' && /^plan (okunamadı|başlatılamadı)/.test(o.neden || ''),
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
  } else if (!gecen && okunamadi === og.length && og.length) {
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
    denetim(sozdeIstek(is.olusturan), {
      op: 'toplu_autostart_bitti',
      id: is.id,
      durum,
      ok: 0,
      fail: 0,
      dusen: og.length - gecen,
    });
}

/**
 * Calisan parca isinin sonucu (terminal ise). Donus: true (parca bitti). 3 saatte bitmeyen is sonucu belirsizdir
 * (AWX'te suruyor olabilir): ogeler FAIL, toplu is DURUR (bekleyenler calistirilmaz).
 */
async function parcaIsiniIsle(is, liste) {
  const o0 = liste[0];
  const st = await isDurumu(o0.awx_server_id, o0.awx_job_id);
  if (!st || !IS_TERMINAL.has(st.status)) {
    if (zamanAsimi(o0)) {
      let gecti = 0;
      for (const o of liste)
        if (
          await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
            neden: `iş #${o0.awx_job_id} 3 saatte bitmedi (${BELIRSIZ_IZ}) — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
          })
        )
          gecti += 1;
      if (gecti) await topluDurdur(is, `${o0.host} işi #${o0.awx_job_id} 3 saatte bitmedi`);
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
  const s = parcaSonuclari(liste, result);
  for (let i = 0; i < liste.length; i += 1) {
    const o = liste[i];
    const x = s[i];
    const satir = x.durum ? `${x.durum} ${x.mesaj}`.trim() : null;
    if (x.dogrulandi)
      await ogeDurum(o.id, ['CALISIYOR'], x.durum, {
        neden: M(x.mesaj, 1000),
        sonuc_satiri: M(satir, 1000),
        dogrulandi: 1,
      });
    else
      await ogeDurum(o.id, ['CALISIYOR'], 'FAIL', {
        neden: M(
          x.durum ? x.mesaj || x.durum : `sonuç okunamadı (iş #${o0.awx_job_id} ${st.status})`,
          1000,
        ),
        sonuc_satiri: M(satir, 1000),
      });
  }
  // Host XML geri alma basarisiz: dosya elle geri yazilmali; siradaki sunuculara gecilmez (bekleyenler YARIM_KALDI).
  if (xmlMi(o0) && s.some((x) => x.durum === 'FAIL' && XML_GERI_ALMA_RE.test(x.mesaj || '')))
    await topluDurdur(
      is,
      `${o0.host} host XML işi #${o0.awx_job_id} geri almada başarısız (dosya elle geri yazılmalı)`,
      'Önce o sunucudaki host XML dosyasını yedekten elle geri yazın (yedek yolu öğe satırında), sunucuyu yeniden tarayın, sonra yeni toplu iş açın.',
    );
  // Dosya yazildi ama geri okunan icerik beklenenden farkli: etkin auto-start belirsiz; siradaki sunuculara gecilmez.
  else if (xmlMi(o0) && s.some((x) => x.durum === 'FAIL' && XML_GERI_OKUMA_RE.test(x.mesaj || '')))
    await topluDurdur(
      is,
      `${o0.host} host XML işi #${o0.awx_job_id} yazıldı ama geri okunan dosya beklenenden farklı (etkin auto-start belirsiz)`,
      'Önce o sunucudaki host XML dosyasını yedekle karşılaştırın (yedek yolu öğe satırında; gerekirse elle geri yazın), sunucuyu yeniden tarayın, sonra yeni toplu iş açın.',
    );
  return true;
}

async function uygulaIlerlet(is, og) {
  const calisan = gruplaIs(
    og.filter((o) => o.durum === 'CALISIYOR'),
    'awx_server_id',
    'awx_job_id',
  );
  for (const [, liste] of calisan) {
    if (!(await parcaIsiniIsle(is, liste))) return false;
  }
  if (calisan.size) og = await ogeler(is.id);
  // Is numarasi yazilamamis BASLATILIYOR (launch dondu ama DB yazilamadi): 10 dk sonra YARIM_KALDI; asla
  // yeniden baslatilmaz ve toplu is DURUR (ayni hostun siradaki parcasi o is AWX'te surerken acilmasin).
  const takili = og.filter((o) => o.durum === 'BASLATILIYOR');
  if (takili.length) {
    const eski = takili.filter(
      (o) => o.baslama_at && Date.now() - new Date(o.baslama_at).getTime() > 10 * 60 * 1000,
    );
    let gecti = null;
    for (const o of eski)
      if (
        await ogeDurum(o.id, ['BASLATILIYOR'], 'YARIM_KALDI', {
          neden: `iş numarası yazılamadı — AWX'e gitmiş olabilir (${BELIRSIZ_IZ}); AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
        })
      )
        gecti = o;
    if (gecti) await topluDurdur(is, `${gecti.host} parçasının iş numarası yazılamadı`);
    return false;
  }
  if (is.durum !== 'CALISIYOR') return !og.some((o) => o.durum === 'CALISIYOR');
  // Siradaki parca: BEKLIYOR ogesi olan hostlardan toplu iste ILK GORULENI (sira'ya gore ilk ogesi en onde olan;
  // secim sirasi hostlari karistirsa da bir hostun tum parcalari bitmeden sonraki hosta gecilmez - inceleme
  // 2026-11-15, B2), o hostun ilk en cok n BEKLIYOR ogesi. Bir tick'te TEK parca baslatilir.
  const bekleyen = og.filter((o) => o.durum === 'BEKLIYOR');
  if (!bekleyen.length) return true;
  const ilkSira = new Map();
  for (const o of og) if (!ilkSira.has(o.host)) ilkSira.set(o.host, Number(o.sira));
  const host = bekleyen.reduce((b, o) => (ilkSira.get(o.host) < ilkSira.get(b.host) ? o : b)).host;
  const n = await isBasinaJvm();
  // Parca anahtari hostun sira'ca ilk BEKLIYOR ogesinden (host XML: ayni host + gen; CLI: host). Kipler karismaz.
  const ilk = bekleyen
    .filter((o) => o.host === host)
    .reduce((b, o) => (Number(o.sira) < Number(b.sira) ? o : b));
  const pk = parcaAnahtari(ilk);
  const xml = xmlMi(ilk);
  const gen = Number(ilk.gen);
  let liste = bekleyen.filter((o) => parcaAnahtari(o) === pk).slice(0, n);
  const as = autoStart();
  // HOST XML: ayni dosyaya iki is olmasin - rezervasyon (tek satir /jvm-autostart-xml ile ayni) await'ten ONCE alinir;
  // doluysa bu tick beklenir (birkac saniyelik baslatma).
  const birakXml = xml && as ? as.xmlRezervasyon(host, gen) : () => {};
  if (!birakXml) return false;
  try {
    if (xml && _d.xmlIsKilidi) {
      const xk = await _d.xmlIsKilidi(host, gen);
      if (xk) {
        for (const o of liste)
          await ogeDurum(o.id, ['BEKLIYOR'], 'DUSTU', { neden: M(`atlandı: ${xk}`, 1000) });
        return false;
      }
    }
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
    const ids = liste.map((o) => o.id);
    // Ayni anda TEK parca: toplu iste (ayni host dahil) baska BASLATILIYOR / CALISIYOR oge varsa sahiplenilmez.
    const al = await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'BASLATILIYOR', baslama_at = SYSUTCDATETIME()
        WHERE is_id = $1 AND durum = 'BEKLIYOR' AND id IN (${yerTutucu(ids, 3)})
          AND EXISTS (SELECT 1 FROM server_hub_toplu_isler WHERE id = $1 AND durum = 'CALISIYOR' AND kira_id = $2)
          AND NOT EXISTS (SELECT 1 FROM server_hub_toplu_ogeler x WITH (UPDLOCK, HOLDLOCK)
                           WHERE x.is_id = $1 AND x.id NOT IN (${yerTutucu(ids, 3)}) AND x.durum IN ('BASLATILIYOR', 'CALISIYOR'))`,
      [is.id, SUREC_ID, ...ids],
    );
    if (al.rowCount < 1) return false;
    const tazeListe = (await ogeler(is.id)).filter(
      (o) => ids.includes(o.id) && o.durum === 'BASLATILIYOR',
    );
    const tids = tazeListe.map((o) => o.id);
    if (!tids.length) return false;
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
          `Server Hub: toplu auto-start #${is.id}${xml ? ` (host XML, JBoss ${gen})` : ''} @ ${host} (${items.length} JVM)`,
          isDegiskenleri(host, tazeListe, false),
          {
            op: 'toplu_autostart_uygula',
            id: is.id,
            host,
            items,
            ...(xml ? { kip: 'xml', gen } : {}),
          },
        );
      } catch (e) {
        if (e?.launchBelirsiz === true) {
          // Launch istegi belirsiz hatayla dondu (zaman asimi / 5xx / baglanti): is AWX'te olusmus olabilir.
          // "Baslatilamadi" DENMEZ; parca YARIM_KALDI, toplu is DURUR.
          await db().query(
            `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'BASLATILIYOR' AND id IN (${yerTutucu(tids, 3)})`,
            [
              is.id,
              M(
                `iş isteği belirsiz hatayla döndü (AWX'e gitmiş olabilir, ${BELIRSIZ_IZ}): ${e?.message} — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
                1000,
              ),
              ...tids,
            ],
          );
          await topluDurdur(is, `${host} parçasının iş isteği belirsiz hatayla döndü`);
          return false;
        }
        // AWX isi acilmadi (kesin red): bu parca FAIL, toplu is DURMAZ (sonraki tick sonraki parca).
        await db().query(
          `UPDATE server_hub_toplu_ogeler SET durum = 'FAIL', neden = $2, bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'BASLATILIYOR' AND id IN (${yerTutucu(tids, 3)})`,
          [is.id, M(`iş başlatılamadı: ${e?.message}`, 1000), ...tids],
        );
        return false;
      }
      // Dogrulama katmani: host XML ogeleri de (action jboss_autostart_xml_off, hedef false); xmlSurenIs bu kaydi gorur.
      if (as) as.isKaydetToplu(r.awxServerId, r.jobId, { host, h, items });
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'CALISIYOR', awx_server_id = $2, awx_job_id = $3 WHERE is_id = $1 AND durum = 'BASLATILIYOR' AND id IN (${yerTutucu(tids, 4)})`,
        [is.id, r.awxServerId, r.jobId, ...tids],
      );
    } finally {
      for (const b of birak) b();
    }
    return false;
  } finally {
    birakXml();
  }
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
    [
      is.id,
      is.durum,
      'Portal yeniden başladı ya da yürütücü durdu — iş kaldığı yerden DEVAM ETTİRİLMEDİ (sessiz yeniden koşma yok). Çalışan host işleri izlenir; gerisi için listeyi yenileyip yeni toplu iş açın.',
      SUREC_ID,
    ],
  );
  if (r.rowCount !== 1) return;
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLAN_GECTI', 'BEKLIYOR', 'PLANLANIYOR')`,
    [is.id, 'Portal yeniden başladı — çalıştırılmadı'],
  );
  await db().query(
    `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum = 'BASLATILIYOR' AND awx_job_id IS NULL`,
    [
      is.id,
      `AWX'e gitmiş olabilir (${BELIRSIZ_IZ}) — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın`,
    ],
  );
  await sayimYaz(is.id);
  denetim(sozdeIstek('toplu-autostart-yurutucu'), {
    op: 'toplu_autostart_yarim_kaldi',
    id: is.id,
    onceki: is.durum,
  });
}

/** YARIM_KALDI isin is numarali CALISIYOR ogeleri: yalniz sonuc okunur. */
async function izle(is) {
  const og = await ogeler(is.id);
  const calisan = gruplaIs(
    og.filter((o) => o.durum === 'CALISIYOR' && o.awx_job_id != null),
    'awx_server_id',
    'awx_job_id',
  );
  for (const [, liste] of calisan) await parcaIsiniIsle(is, liste);
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
      console.warn(`[TopluAutoStart] is #${is.id} ilerletilemedi:`, e?.message);
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
      console.warn(`[TopluAutoStart] is #${is.id} izlenemedi:`, e?.message);
    }
  }
}

function startPoller() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_ticking) return;
    _ticking = true;
    tick()
      .catch((e) => console.warn('[TopluAutoStart] tick hatasi:', e?.message))
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
  // 5xx: kurumsal nginx govdeyi index.html ile degistirir (toplu-restart.cjs mount ile ayni gerekce). Her 5xx
  // loglanir; GET disi isteklerde 424 + upstreamStatus + nginxRed (util/nginx-red.cjs deseni).
  const gonder = (req, res, err) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(
        `[TopluAutoStart] ${req.method} ${req.originalUrl || req.path} ${status}:`,
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

  router.get('/toplu-autostart/adaylar', async (req, res) => {
    try {
      const [a, limit, akt, isBasina] = await Promise.all([
        _d.getAssessment(req.query.fresh === '1'),
        _d.ayarlar.limit('toplu_autostart'),
        aktifIs().catch(() => null),
        isBasinaJvm(),
      ]);
      if (a.tableMissing)
        return res.json({
          ok: true,
          adaylar: [],
          dislananlar: [],
          adaylarXml: [],
          limit,
          isBasinaJvm: isBasina,
          aktif: isSatiri(akt),
          latestScan: null,
        });
      const { adaylar, dislananlar, xmlAdaylar } = adaylariTuret(a);
      res.json({
        ok: true,
        adaylar,
        dislananlar,
        adaylarXml: xmlGrupla(xmlAdaylar),
        limit,
        isBasinaJvm: isBasina,
        aktif: isSatiri(akt),
        latestScan: a.latestScan || null,
        schemaUnknown: a.schemaUnknown === true,
      });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.get('/toplu-autostart', async (req, res) => {
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

  router.get('/toplu-autostart/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const is = await isOku(id);
      if (!is) return res.status(404).json({ ok: false, message: `Toplu iş #${id} yok.` });
      const og = (await ogeler(id)).map(ogeSatiri);
      res.json({
        ok: true,
        is: { ...isSatiri(is), kip: og.length && og[0].hostXml ? 'xml' : 'cli' },
        ogeler: og,
      });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-autostart', async (req, res) => {
    try {
      res.json({
        ok: true,
        ...(await olustur(req, req.body?.secim, {
          prodOnay: req.body?.prodOnay === true,
        })),
      });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-autostart/:id/onayla', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    if (req.body?.confirmed !== true)
      return res.status(400).json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    try {
      res.json({ ok: true, ...(await onayla(req, id, { prodOnay: req.body?.prodOnay === true })) });
    } catch (err) {
      gonder(req, res, err);
    }
  });

  router.post('/toplu-autostart/:id/iptal', async (req, res) => {
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
  PLAN_PARALEL,
  PLAN_HOST_PARALEL,
  BELIRSIZ_IZ,
  IS_BASINA_JVM_VARSAYILAN,
  AKTIF,
  KILITLI_OGE,
  SECIM,
  SECIM_ZAMAN_ASIMI_MS,
  SUREC_ID,
  mount,
  kur,
  adaylariTuret,
  xmlGrupla,
  parcala,
  parcaSonuclari,
  prodMu,
  XML_SECIM,
  secimiDuzle,
  topluKilidi,
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
