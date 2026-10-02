// server/opsx/was-state.cjs - OpsX WAS (WebSphere) icin SAF yardimcilar.
//
// Bu dosya DB'ye, AWX'e ya da Express'e DOGRUDAN dokunmaz. Kilit fonksiyonlari `db`
// nesnesini PARAMETRE olarak alir (testte sahte db verilir). Uclarin kendisi
// server/opsx/was.cjs icinde.
//
// TEMEL KURAL (kullanici, 2026-10-02): "olculemedi" ile "durdu/yok" ASLA karismaz.
//   - Olculemeyen bir JVM STOPPED gosterilmez, uzerinde islem yapilmaz.
//   - Playbook'tan gelen durum, ayni sonucun ham olcumleriyle (pids, ss) CAPRAZ
//     kontrol edilir: tasarim (3) tablosuna uymayan her bildirim OLCULEMEDI'ye duser.
//   - Bilinmeyen deger (yeni bir durum adi, bos alan, yanlis tip) => OLCULEMEDI.
//
// TOPLU ISLEM YOK: tek host + tek JVM. Bu dosyadaki dogrulayicilar dizi kabul etmez.
'use strict';

// Ad deseni playbook assert'iyle AYNI (bkz. bmw_portal/opsx_was/opsx_was_operation.yml).
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const NAME_MAX = 128;

const MAX_DISCOVER_HOSTS = 10;
const DISCOVERY_MAX_AGE_MS = 15 * 60 * 1000;

const OPERATIONS = Object.freeze(['restart', 'stop', 'start']);

const STATES = Object.freeze(['RUNNING', 'STOPPED', 'ASKIDA', 'COKLU_SUREC', 'OLCULEMEDI']);
const SS_VALUES = Object.freeze(['UP', 'ULASILAMIYOR', 'TANIMSIZ', '?']);
const KIMLIK_VALUES = Object.freeze(['var', 'yok', 'olculemedi']);
const OP_RESULTS = Object.freeze(['OK', 'SKIP', 'FAIL', 'OLCULEMEDI']);

// Durum -> izinli islemler (tasarim (3) tablosu). Listede olmayan durum = hicbir islem.
const ALLOWED_BY_STATE = Object.freeze({
  RUNNING: Object.freeze(['stop', 'restart']),
  STOPPED: Object.freeze(['start']),
  ASKIDA: Object.freeze(['stop', 'restart']),
});

// KILIT SURESI.
// Template timeout'u (AWX) en cok TEMPLATE_TIMEOUT_MIN olmali; kilit ondan UZUN tutulur
// ki AWX isi oldurmeden kilit dusmesin. Kilit launch'tan HEMEN ONCE TAM sureyle alinir.
// "Once kisa, job id gelince uzat" denendi ve REDDEDILDI: uzatma yazimi basarisiz olursa
// kilit is surerken duserdi (guvensiz). Tersi - surec launch ile baglama arasinda
// coker - en kotu ihtimalle uygulamayi TTL boyunca kilitli birakir (guvenli taraf).
const TEMPLATE_TIMEOUT_MIN = 30;
const DEFAULT_LOCK_TTL_MIN = 60;

function lockTtlMinutes(env = process.env) {
  const raw = String(env.OPSX_WAS_LOCK_TTL_MIN ?? '').trim();
  if (!raw) return DEFAULT_LOCK_TTL_MIN;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_LOCK_TTL_MIN;
  // Alt sinir: template timeout + 5 dk pay. Ust sinir: yarim gun (kalici kilit olmasin).
  return Math.min(Math.max(n, TEMPLATE_TIMEOUT_MIN + 5), 720);
}

function isValidName(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= NAME_MAX && NAME_RE.test(v);
}

// ── ORTAM NORMALIZASYONU ─────────────────────────────────────────────────────
// WASAppsInventory env'i PROD/TEST/ALPHA yaziyor, JBoss tablosu Production/Test/Alpha
// (bkz. P/server/audit/app-envs.cjs). Normalize edilmezse PROD bir WAS hostu prod
// SAYILMAZ (rozet yanlis renkte, denetim kaydi yanlis ortamda).
const ENV_MAP = Object.freeze({
  PROD: 'Production',
  PRODUCTION: 'Production',
  PRD: 'Production',
  TEST: 'Test',
  TST: 'Test',
  ALPHA: 'Alpha',
  QA: 'QA',
  ODM: 'ODM',
});

function normalizeEnv(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return ENV_MAP[s.toUpperCase()] || s;
}

function isProdEnv(raw) {
  return normalizeEnv(raw) === 'Production';
}

// NOAPP: envanter betiginin "uygulama bulunamadi" yer tutucusu - gercek bir JVM DEGIL.
function isNoApp(app) {
  return String(app ?? '').trim().toUpperCase() === 'NOAPP';
}

// v1 yalniz Linux. AIX satirlari listede GORUNUR ama secilemez.
function isSelectableOs(os) {
  return String(os ?? '').trim().toUpperCase() === 'LINUX';
}

function normalizeHost(h) {
  return String(h ?? '').trim().toUpperCase();
}

// Envanter satirlarini ekran/dogrulama icin tek bicime getirir. Ayni host iki kez
// gelirse (beklenmez, UNIQUE(host, app)) ilk satir kalir.
function shapeInventoryHosts(rows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const host = normalizeHost(r?.host);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const os = String(r?.os ?? '').trim();
    const linux = isSelectableOs(os);
    const validHost = isValidName(host);
    out.push({
      host,
      env: normalizeEnv(r?.env),
      envRaw: String(r?.env ?? '').trim(),
      os,
      wasVersion: String(r?.was_version ?? '').trim(),
      status: String(r?.status ?? '').trim().toLowerCase(),
      selectable: linux && validHost,
      reason: !linux
        ? `İşletim sistemi ${os || 'bilinmiyor'} — bu sürümde yalnız Linux desteklenir.`
        : !validHost
          ? 'Sunucu adı beklenmeyen karakter içeriyor.'
          : '',
    });
  }
  return out.sort((a, b) => byText(a.host, b.host));
}

// Kod noktasi sirasi. localeCompare KULLANILMAZ: sonucu ICU/isletim sistemi diline gore
// degisir ("GB;03" bir makinede once, digerinde sonra gelir).
function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── SIR MASKELEME ────────────────────────────────────────────────────────────
// Betik ciktisi Portal'a ulasmadan once parola desenleri maskelenir. Betik parolayi
// HIC basmamali (K2-a); bu ikinci emniyet.
function maskSecrets(text) {
  return String(text ?? '')
    .replace(/(-password\s+)(\S+)/gi, '$1***')
    .replace(/((?:password|passwd|pwd)\s*[=:]\s*)(\S+)/gi, '$1***');
}

function shortText(v, max = 400) {
  const s = maskSecrets(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── DURUM SINIFLANDIRMASI (tasarim (3) tablosu) ──────────────────────────────
//   pids < 0 (ps olculemedi)          -> OLCULEMEDI
//   pids >= 2                         -> COKLU_SUREC
//   ss '?' ya da TANIMSIZ             -> OLCULEMEDI
//   1 + UP                            -> RUNNING
//   0 + ULASILAMIYOR                  -> STOPPED
//   1 + ULASILAMIYOR                  -> ASKIDA
//   0 + UP                            -> OLCULEMEDI (celiski)
// ADMU0509I ("appears to be stopped") TEK BASINA STOPPED DEGILDIR: N=0 da gerekir.
function classify(pids, ss) {
  const n = Number(pids);
  if (!Number.isInteger(n) || n < 0) return 'OLCULEMEDI';
  if (n >= 2) return 'COKLU_SUREC';
  if (ss === 'UP') return n === 1 ? 'RUNNING' : 'OLCULEMEDI';
  if (ss === 'ULASILAMIYOR') return n === 1 ? 'ASKIDA' : 'STOPPED';
  return 'OLCULEMEDI';
}

function isMeasured(state) {
  return state === 'RUNNING' || state === 'STOPPED' || state === 'ASKIDA';
}

function normalizePids(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= -1) return v;
  if (typeof v === 'string' && /^-?\d{1,6}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n >= -1 ? n : -1;
  }
  return -1;
}

// Tek bir server kaydini normalize eder. `hostOk`/`kimlik` ust seviyeden gelir.
function normalizeServer(raw, { hostOk, hostReason, kimlik }) {
  const server = String(raw?.server ?? '').trim();
  const cluster = String(raw?.cluster ?? '').trim();
  const reported = STATES.includes(raw?.state) ? raw.state : 'OLCULEMEDI';
  const pids = normalizePids(raw?.pids);
  const ss = SS_VALUES.includes(raw?.ss) ? raw.ss : '?';
  let reason = shortText(raw?.reason ?? '', 300);
  let state = reported;

  // CAPRAZ KONTROL: bildirilen durum ham olcumle tutarli degilse OLCULEMEDI.
  // Bilinmeyen durum adi zaten yukarida OLCULEMEDI'ye dustu.
  const expected = classify(pids, ss);
  if (state !== expected) {
    reason = `tutarsız ölçüm (bildirilen ${reported}, ps=${pids}, serverStatus=${ss})${reason ? ` — ${reason}` : ''}`;
    state = 'OLCULEMEDI';
  }
  // Host olculemediyse altindaki hicbir JVM olculmus sayilmaz.
  if (!hostOk) {
    state = 'OLCULEMEDI';
    reason = `sunucu ölçülemedi${hostReason ? `: ${hostReason}` : ''}`;
  }
  return {
    server,
    cluster,
    state,
    reportedState: reported,
    pids,
    ss,
    reason,
    kimlik,
  };
}

// opsx_was_discover_result'i normalize eder. `requestedHosts` verilirse sonucta
// OLMAYAN her istenen host `overall: 'olculemedi'` olarak EKLENIR (erisilemeyen host
// listeden dusmez - LX2 dersi, bkz. server/ansible/__tests__/logx-legacy-olculemedi.test.cjs).
function parseDiscoverResult(raw, requestedHosts = []) {
  const hostsIn = Array.isArray(raw?.hosts) ? raw.hosts : [];
  const hosts = [];
  const seen = new Set();
  for (const h of hostsIn) {
    const host = normalizeHost(h?.host);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const hostOk = h?.overall === 'ok';
    const hostReason = shortText(h?.reason ?? '', 300);
    const profiles = [];
    for (const p of Array.isArray(h?.profiles) ? h.profiles : []) {
      const kimlik = KIMLIK_VALUES.includes(p?.kimlik) ? p.kimlik : 'olculemedi';
      const servers = (Array.isArray(p?.servers) ? p.servers : []).map((s) =>
        normalizeServer(s, { hostOk, hostReason, kimlik }),
      );
      profiles.push({
        profile: String(p?.profile ?? '').trim(),
        cell: String(p?.cell ?? '').trim(),
        node: String(p?.node ?? '').trim(),
        kimlik,
        servers,
      });
    }
    hosts.push({
      host,
      overall: hostOk ? 'ok' : 'olculemedi',
      reason: hostOk ? hostReason : hostReason || 'sebep bildirilmedi',
      profiles,
    });
  }
  for (const rh of requestedHosts || []) {
    const host = normalizeHost(rh);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push({
      host,
      overall: 'olculemedi',
      reason: 'keşif sonucunda bu sunucu yok (erişilemedi ya da playbook sonuç üretmedi)',
      profiles: [],
    });
  }
  return { hosts: hosts.sort((a, b) => byText(a.host, b.host)) };
}

// Kesif sonucundaki TUM JVM'leri duz liste olarak verir (ic kullanim).
function allInstances(discovery) {
  const out = [];
  for (const h of discovery?.hosts || []) {
    for (const p of h.profiles || []) {
      for (const s of p.servers || []) {
        out.push({
          host: h.host,
          hostOverall: h.overall,
          profile: p.profile,
          cell: p.cell,
          node: p.node,
          kimlik: p.kimlik,
          ...s,
        });
      }
    }
  }
  return out;
}

function sameTarget(a, b) {
  return (
    normalizeHost(a.host) === normalizeHost(b.host) &&
    a.profile === b.profile &&
    a.cell === b.cell &&
    a.node === b.node &&
    a.server === b.server
  );
}

// (host, profile, cell, node, server) BIREBIR eslesmesi. Host buyuk/kucuk harf
// duyarsiz, digerleri duyarli (WAS adlari harf duyarlidir).
function findTarget(discovery, t) {
  return allInstances(discovery).find((i) => sameTarget(i, t)) || null;
}

// KUME DEGERI (playbook sozlesmesi, bmw_portal/opsx_was/README.md):
//   ''        uye degil (olculdu)
//   '?'       kume bilgisi OLCULEMEDI - BILINMIYOR. Kume ADI DEGILDIR: '?' olan iki JVM
//             "ayni kumede" SAYILMAZ (2026-10-02 capraz denetim: '?' ad gibi gruplaninca
//             son calisan uye uyarisi kayboluyordu).
//   'A,B'     birden cok kumede gorundu (virgullu)
function clusterInfo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { known: true, names: [] };
  const names = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!names.length || names.includes('?')) return { known: false, names: [] };
  return { known: true, names };
}

// Hedefin "karsiliklari": ayni hucredeki ayni kumenin diger uyeleri (YALNIZ bilinen kume
// adlariyla) + ayni JVM adinin diger hostlardaki ornekleri (LB cifti). Kumesi bilinmeyen
// ornek kume kardesi SAYILMAZ (sayilsaydi "baska calisan uye var" diye uyari susardi).
// Hepsi kesif sonucundan; KESFEDILMEYEN hostlar hesaba katilmaz (mesajda belirtilir).
function peersOf(discovery, target) {
  const tc = clusterInfo(target.cluster);
  return allInstances(discovery).filter((i) => {
    if (sameTarget(i, target)) return false;
    if (i.server === target.server) return true;
    if (!tc.known || !tc.names.length || i.cell !== target.cell) return false;
    const ic = clusterInfo(i.cluster);
    return ic.known && ic.names.some((n) => tc.names.includes(n));
  });
}

function peerSummary(discovery, target) {
  const peers = peersOf(discovery, target);
  return {
    total: peers.length,
    running: peers.filter((p) => p.state === 'RUNNING').length,
    unknown: peers.filter((p) => !isMeasured(p.state)).length,
    clusterKnown: clusterInfo(target.cluster).known,
  };
}

// UYARILAR - sunucu bunlari ackWarnings === true olmadan KABUL ETMEZ.
//   ASKIDA      : surec var, e-business yanit vermiyor.
//   SON_CALISAN : stop/restart sonrasi olculen calisan ornek kalmayacak - YA DA hedefin
//                 kume bilgisi olculemedi ('?'): kumede calisan baska uye kalip kalmadigi
//                 BILINMIYOR, muhafazakar olarak her zaman sorulur.
function computeWarnings(discovery, target, operation) {
  const out = [];
  if (!target) return out;
  if (target.state === 'ASKIDA' && (operation === 'stop' || operation === 'restart')) {
    out.push({
      code: 'ASKIDA',
      message:
        'JVM süreci var ama sunucu yanıt vermiyor (ASKIDA). Durdurma süreci sonlandıramayabilir; ' +
        'işlem sonunda gerçek durum ayrıca raporlanır.',
    });
  }
  if (
    (operation === 'stop' || operation === 'restart') &&
    (target.state === 'RUNNING' || target.state === 'ASKIDA')
  ) {
    const s = peerSummary(discovery, target);
    const ek = s.unknown ? ` ${s.unknown} örneğin durumu ölçülemedi.` : '';
    if (!s.clusterKnown) {
      out.push({
        code: 'SON_CALISAN',
        message:
          'Bu JVM\'in küme bilgisi ölçülemedi: kümesinde çalışan başka üye kalıp kalmadığı BİLİNMİYOR, ' +
          'bu JVM son çalışan üye olabilir.' +
          (s.running ? ` Aynı adlı ${s.running} örnek başka sunucuda çalışıyor ölçüldü.` : '') +
          ` İşlem süresince uygulama hizmet veremeyebilir.${ek} Keşfedilmeyen sunucular hesaba katılmadı.`,
      });
    } else if (s.running === 0) {
      const kume = clusterInfo(target.cluster).names;
      out.push({
        code: 'SON_CALISAN',
        message:
          (kume.length
            ? `Bu JVM, "${kume.join(', ')}" kümesinin ve keşfedilen sunucular arasında ölçülen SON çalışan örneği.`
            : 'Bu JVM, keşfedilen sunucular arasında bu uygulamanın ölçülen SON çalışan örneği.') +
          ` İşlem süresince uygulama hizmet veremeyebilir.${ek} Keşfedilmeyen sunucular hesaba katılmadı.`,
      });
    }
  }
  return out;
}

function allowedOperations(target) {
  if (!target) return [];
  if (target.hostOverall && target.hostOverall !== 'ok') return [];
  if (target.kimlik !== 'var') return [];
  return [...(ALLOWED_BY_STATE[target.state] || [])];
}

// Islem-durum kapisi. Sunucu 409 doner; mesaj kullaniciya aynen gosterilir.
function gateOperation(target, operation) {
  if (!OPERATIONS.includes(operation)) {
    return { ok: false, status: 400, message: 'Geçersiz işlem.' };
  }
  if (!target) {
    return {
      ok: false,
      status: 409,
      message: 'Seçilen JVM keşif sonucunda yok — keşfi yenileyin.',
    };
  }
  if (target.hostOverall && target.hostOverall !== 'ok') {
    return {
      ok: false,
      status: 409,
      message: `${target.host} ölçülemedi — gerçek durum bilinmiyor, işlem yapılmaz.`,
    };
  }
  if (target.state === 'OLCULEMEDI') {
    return {
      ok: false,
      status: 409,
      message: `${target.server} durumu ölçülemedi — gerçek durum bilinmiyor, işlem yapılmaz.${target.reason ? ` (${target.reason})` : ''}`,
    };
  }
  if (target.state === 'COKLU_SUREC') {
    return {
      ok: false,
      status: 409,
      message: `${target.server} için birden fazla süreç eşleşti — hangisine dokunulacağı belirsiz, işlem yapılmaz.`,
    };
  }
  if (target.kimlik !== 'var') {
    return {
      ok: false,
      status: 409,
      message: `Profil kimliği (soap.client.props) ${target.kimlik === 'yok' ? 'bulunamadı' : 'ölçülemedi'} — işlem yapılmaz.`,
    };
  }
  const allowed = ALLOWED_BY_STATE[target.state] || [];
  if (!allowed.includes(operation)) {
    const neden =
      target.state === 'STOPPED'
        ? 'JVM zaten durmuş görünüyor'
        : target.state === 'RUNNING'
          ? 'JVM zaten çalışıyor'
          : `JVM durumu ${target.state}`;
    return {
      ok: false,
      status: 409,
      message: `${neden} — "${operation}" bu durumda izinli değil (izinli: ${allowed.join(', ') || 'yok'}).`,
    };
  }
  return { ok: true };
}

// Ekrana giden hedef satirlari: YALNIZ server === app olan JVM'ler secilebilir aday
// olarak listelenir. Diger JVM'lerin adi istemciye GITMEZ (baska uygulamalar); yalniz
// karsilik sayilari ozet olarak verilir.
function targetsForApp(discovery, app) {
  const rows = [];
  for (const i of allInstances(discovery)) {
    if (i.server !== app) continue;
    const ops = allowedOperations(i);
    const peers = peerSummary(discovery, i);
    rows.push({
      host: i.host,
      profile: i.profile,
      cell: i.cell,
      node: i.node,
      server: i.server,
      cluster: i.cluster,
      state: i.state,
      pids: i.pids,
      ss: i.ss,
      reason: i.reason,
      kimlik: i.kimlik,
      hostOverall: i.hostOverall,
      selectable: ops.length > 0,
      allowedOps: ops,
      peers,
      warnings: {
        stop: computeWarnings(discovery, i, 'stop'),
        restart: computeWarnings(discovery, i, 'restart'),
        start: computeWarnings(discovery, i, 'start'),
      },
    });
  }
  return rows.sort((a, b) => byText(`${a.host}|${a.profile}`, `${b.host}|${b.profile}`));
}

// Kesfin yasi. `finished` AWX'ten (ISO). Okunamazsa GECERSIZ sayilir (fail-closed).
function discoveryAge(finishedIso, now = Date.now()) {
  const t = new Date(String(finishedIso ?? '')).getTime();
  if (!finishedIso || !Number.isFinite(t)) return { ok: false, reason: 'zaman okunamadı' };
  const age = now - t;
  if (age < -60_000) return { ok: false, reason: 'zaman gelecekte' };
  if (age > DISCOVERY_MAX_AGE_MS) {
    return { ok: false, reason: `keşif ${Math.round(age / 60000)} dk önce yapıldı (en çok 15 dk)` };
  }
  return { ok: true, ageMs: Math.max(age, 0) };
}

// ── ISLEM SONUCU ─────────────────────────────────────────────────────────────
// opsx_was_op_result'i normalize eder. Sonuc yoksa ya da tanimsizsa OLCULEMEDI:
// "basarili mi bilmiyoruz" ile "basarisiz" ayri sey, ikisi de "OK" DEGIL.
function parseOpResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = OP_RESULTS.includes(raw.result) ? raw.result : 'OLCULEMEDI';
  // Once/sonra: bilinen durum aynen; '-' ya da bos = olcum HIC yapilmadi (ornegin girdi
  // kapisinda reddedildi) -> bos (ekranda "—"); baska her deger OLCULEMEDI. Hicbiri
  // STOPPED'a dusmez.
  const st = (v) => {
    const s = String(v ?? '').trim();
    if (!s || s === '-') return '';
    return STATES.includes(s) ? s : 'OLCULEMEDI';
  };
  // STEP durumu = adimin HEDEFINE ulasip ulasmadigi (README "STEP durumu"). Mesaji 'UYARI:'
  // ile baslayan OK adim "tamam ama dikkat": ekranda yesil "Basarili" DEGIL, sari "Uyari".
  // Bilinmeyen durum adi OLCULEMEDI (asla OK).
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 60).map((s) => {
    const status = OP_RESULTS.includes(s?.status) ? s.status : 'OLCULEMEDI';
    const msg = shortText(s?.msg ?? '', 400);
    return {
      step: shortText(s?.step ?? '', 80),
      status,
      msg,
      warning: status === 'OK' && /^\s*UYARI\b/i.test(msg),
    };
  });
  return {
    host: normalizeHost(raw.host),
    profile: String(raw.profile ?? '').trim(),
    cell: String(raw.cell ?? '').trim(),
    node: String(raw.node ?? '').trim(),
    server: String(raw.server ?? '').trim(),
    op: OPERATIONS.includes(raw.op) ? raw.op : String(raw.op ?? '').trim(),
    requestId: String(raw.request_id ?? '').trim(),
    before: st(raw.before),
    after: st(raw.after),
    result,
    steps,
    line: shortText(raw.line ?? '', 600),
  };
}

// Yayinlanan sonuc BASLATILAN istege mi ait? (request_id, host, JVM). Sonuc baska bir
// isteginse (yanlis template, eski artifact) "basarili" sayilmaz: gercek durum BILINMIYOR.
// Alan sonucta bos ise (eski playbook) o alan icin karar verilmez.
function opResultMismatch(parsed, params) {
  if (!parsed) return '';
  const p = params || {};
  const farklar = [];
  if (parsed.requestId && p.request_id && parsed.requestId !== String(p.request_id)) farklar.push('istek kimliği');
  if (parsed.host && p.host && parsed.host !== normalizeHost(p.host)) farklar.push('sunucu');
  if (parsed.server && p.server && parsed.server !== String(p.server)) farklar.push('JVM');
  return farklar.join(', ');
}

// Ekran rengi/etiketi. OLCULEMEDI ayri (sari) - "gercek durum bilinmiyor".
function resultSeverity(result) {
  if (result === 'OK') return 'ok';
  if (result === 'SKIP') return 'skip';
  if (result === 'FAIL') return 'fail';
  return 'unknown';
}

// Denetim kaydinin `result` alani: yalniz OK/SKIP basari sayilir.
function auditResultOf(result) {
  return result === 'OK' || result === 'SKIP' ? 'ok' : 'fail';
}

// ── KILIT (opsx_was_locks, compare-and-set) ──────────────────────────────────
// Desen ScaleX'in tryLockRestore'u (server/scalex/state.cjs): TEK UPDATE ifadesi hem
// kontrol hem yazmadir, TOCTOU yok. IKI anahtar alinir:
//   A|<APP>                         - ayni uygulamanin BASKA hostunda is suruyorsa 409
//                                     (LB ciftinin ikisi birden inmesin)
//   T|<HOST>|<cell>|<node>|<server> - ayni JVM'e ikinci is
// Kilit UPDATE ile BIRAKILIR, satir SILINMEZ (TBMWANS: DELETE yok).
function lockKeys({ app, host, cell, node, server }) {
  return {
    app: `A|${String(app)}`,
    target: `T|${normalizeHost(host)}|${cell}|${node}|${server}`,
  };
}

async function ensureLockRow(db, key) {
  try {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM opsx_was_locks WHERE lock_key = $1)
         INSERT INTO opsx_was_locks (lock_key, held) VALUES ($1, 0)`,
      [key],
    );
  } catch (e) {
    // Esszamanli iki istek ayni anda INSERT edebilir; UNIQUE ihlali (2627/2601)
    // satirin ZATEN var oldugu anlamina gelir - sorun degil. Baska hata yukari.
    if (!/2627|2601|duplicate|UNIQUE/i.test(String(e?.number ?? '') + String(e?.message ?? ''))) {
      throw e;
    }
  }
}

async function casLock(db, key, { lockId, holder, desc, ttlMin }) {
  const { rowCount } = await db.query(
    `UPDATE opsx_was_locks
        SET held = 1, holder = $2, lock_id = $3, target_desc = $4,
            locked_until = DATEADD(MINUTE, $5, GETUTCDATE()),
            awx_server_id = NULL, awx_job_id = NULL, updated_at = GETUTCDATE()
      WHERE lock_key = $1
        AND (held IS NULL OR held = 0 OR locked_until IS NULL OR locked_until < GETUTCDATE())`,
    [key, holder, lockId, desc, ttlMin],
  );
  return rowCount > 0;
}

async function readLock(db, key) {
  const { rows } = await db.query(
    `SELECT TOP 1 lock_key, held, holder, lock_id, target_desc, locked_until, awx_server_id, awx_job_id, last_op_finished_at
       FROM opsx_was_locks WHERE lock_key = $1`,
    [key],
  );
  return rows[0] || null;
}

// AWX zamanini (ISO) tek bicime getirir: 'YYYY-MM-DDTHH:MM:SS.mmmZ' (24 karakter). Bu
// bicimde metin karsilastirmasi zaman karsilastirmasidir (kolon NVARCHAR). Okunamazsa null.
function isoOrNull(v) {
  if (v == null || v === '') return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// last_op_finished_at: bu anahtardaki SON islemin AWX bitis zamani. YALNIZ ileri gider
// (eski bir is daha gec gozlenirse geri yazilmaz). Kilit birakilirken AYNI UPDATE'te yazilir:
// kilit duser de zaman yazilmaz durumu olmaz.
const LAST_OP_SET = `last_op_finished_at = CASE WHEN $FIN IS NOT NULL AND (last_op_finished_at IS NULL OR last_op_finished_at < $FIN) THEN $FIN ELSE last_op_finished_at END`;

async function releaseLockById(db, key, lockId, finishedIso = null) {
  const { rowCount } = await db.query(
    `UPDATE opsx_was_locks SET held = 0, updated_at = GETUTCDATE(), ${LAST_OP_SET.replace(/\$FIN/g, '$3')}
      WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
    [key, lockId, isoOrNull(finishedIso)],
  );
  return rowCount > 0;
}

// Dolu kilidin bagli oldugu is bitmis mi? `jobState` { terminal, finished } ya da (eski
// imza) boolean donebilir. Hata = BITMEMIS (fail-closed: kilit dolu sayilir).
async function boundJobState(jobState, row) {
  try {
    const r = await jobState(Number(row.awx_server_id), Number(row.awx_job_id));
    if (r === true) return { terminal: true, finished: null };
    if (r && typeof r === 'object' && r.terminal === true) return { terminal: true, finished: r.finished ?? null };
  } catch {
    /* AWX okunamadi: bitmis SAYILMAZ */
  }
  return { terminal: false, finished: null };
}

// Iki anahtari TUMU YA DA HICBIRI mantigiyla alir. Dolu kilit bir AWX isine bagliysa ve
// o is TERMINAL ise (`isJobTerminal` true / {terminal:true} donerse) kilit bayattir: CAS
// ile birakilip (bitis zamani last_op_finished_at'e yazilarak) bir kez daha denenir.
// `isJobTerminal` hata atarsa kilit DOLU sayilir (fail-closed).
async function acquireLocks(db, keys, { lockId, holder, desc, isJobTerminal, ttlMin }) {
  const order = [keys.app, keys.target];
  const taken = [];
  const ttl = Number.isInteger(ttlMin) && ttlMin > TEMPLATE_TIMEOUT_MIN ? ttlMin : lockTtlMinutes();
  for (const key of order) {
    await ensureLockRow(db, key);
    let ok = await casLock(db, key, { lockId, holder, desc, ttlMin: ttl });
    let row = null;
    if (!ok) {
      row = await readLock(db, key);
      if (row && row.awx_job_id != null && row.awx_server_id != null && isJobTerminal) {
        const js = await boundJobState(isJobTerminal, row);
        if (js.terminal && row.lock_id) {
          await releaseLockById(db, key, row.lock_id, js.finished);
          ok = await casLock(db, key, { lockId, holder, desc, ttlMin: ttl });
          if (!ok) row = await readLock(db, key);
        }
      }
    }
    if (!ok) {
      for (const k of taken) await releaseLockById(db, k, lockId);
      return { ok: false, busyKey: key, busy: row };
    }
    taken.push(key);
  }
  return { ok: true, keys: taken };
}

// Launch basarili: kilit AWX isine baglanir. Bagli kilit, is terminale ulasinca durum
// ucundan (ya da bir sonraki kilit denemesinde bayat-kilit kontrolunden) birakilir.
// Sure DEGISMEZ: kilit zaten tam TTL ile alindi.
async function bindLocks(db, keys, lockId, { awxServerId, awxJobId }) {
  for (const key of [keys.app, keys.target]) {
    await db.query(
      `UPDATE opsx_was_locks
          SET awx_server_id = $3, awx_job_id = $4, updated_at = GETUTCDATE()
        WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
      [key, lockId, awxServerId, awxJobId],
    );
  }
}

async function releaseLocks(db, keys, lockId) {
  for (const key of [keys.app, keys.target]) await releaseLockById(db, key, lockId);
}

// Is terminale ulasti: o ise bagli TUM kilitler birakilir ve isin AWX bitis zamani
// last_op_finished_at'e yazilir (ayni UPDATE). Bu zaman, bu ISTEN ONCE baslamis bir kesifin
// /run'da reddedilmesini saglar (bkz. staleDiscovery).
async function releaseLocksForJob(db, awxServerId, awxJobId, finishedIso = null) {
  const { rowCount } = await db.query(
    `UPDATE opsx_was_locks SET held = 0, updated_at = GETUTCDATE(), ${LAST_OP_SET.replace(/\$FIN/g, '$3')}
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND held = 1`,
    [awxServerId, awxJobId, isoOrNull(finishedIso)],
  );
  return rowCount;
}

// BAYAT KESIF (LB cifti korumasi, 2026-10-02): kesif, bu uygulamadaki SON islem BITMEDEN
// baslamissa olcumleri o islemden onceki (ya da islem ortasindaki) durumu gosterir. Ornek:
// ALI GBWASP01'i durdurur, is biter, kilit duser; VELI'nin ALI'nin isinden ONCE aldigi kesif
// 01'i hala "calisiyor" gosterir ve 02'yi SON_CALISAN uyarisi olmadan durdurtur. Kural:
// kesfin AWX baslangic zamani > uygulamanin son islem bitis zamani (iki zaman da AWX'ten).
// Donus: '' (gecerli) ya da red sebebi.
function staleDiscovery(discoveryStartedIso, lastOpFinishedIso) {
  const son = isoOrNull(lastOpFinishedIso);
  if (!son) return '';
  const bas = isoOrNull(discoveryStartedIso);
  if (!bas) return 'keşfin başlangıç zamanı okunamadı';
  if (bas <= son) return `keşif bu uygulamadaki son işlem bitmeden başlamış (son işlem ${son}, keşif ${bas})`;
  return '';
}

// -- ISLEM KAYDI (opsx_was_ops) -----------------------------------------------
// Baslatilan her WAS isi icin TEK satir (UNIQUE(awx_server_id, awx_job_id)); satir SILINMEZ.
//   1) SONUC DENETIMI ISARETI: audited_at IS NULL kosullu UPDATE bir CAS'tir; sonuc denetimini
//      (opsx_was_result) yalniz onu kazanan yazar. Genel ss/job-status ucunun
//      ansible_job_history.finished_at'i doldurmasi bu isareti ETKILEMEZ (onceden etkiliyordu:
//      Self Service Gecmis'te bakilan isin sonuc denetimi HIC yazilmiyordu).
//   2) SAHIPLIK YEDEGI: ansible_job_history yazilamadiysa durum ucu sahibi buradan okur.
//   3) UZLASTIRICI KUYRUGU: audited_at bos satirlar sunucu tarafinda sonuclandirilir
//      (kullanici sekmeyi kapatsa da sonuc denetimi yazilir, kilit birakilir).
function isUniqueViolation(e) {
  return /2627|2601|duplicate|UNIQUE/i.test(String(e?.number ?? '') + String(e?.message ?? ''));
}

async function insertOpRecord(db, { serverId, jobId, requestId, username, params }) {
  const { rowCount } = await db.query(
    `INSERT INTO opsx_was_ops (awx_server_id, awx_job_id, request_id, username, params)
     SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (SELECT 1 FROM opsx_was_ops WHERE awx_server_id = $1 AND awx_job_id = $2)`,
    [serverId, jobId, requestId || null, username || null, JSON.stringify(params || {})],
  );
  return rowCount > 0;
}

async function loadOpRecord(db, serverId, jobId) {
  const { rows } = await db.query(
    `SELECT TOP 1 username, params, audited_at FROM opsx_was_ops WHERE awx_server_id = $1 AND awx_job_id = $2`,
    [serverId, jobId],
  );
  return rows[0] || null;
}

// TEK SEFER isareti. true = bu cagri sonucu ILK kez kaydetti (denetim yazilmali).
async function markOpAudited(db, r) {
  const vals = [
    r.serverId,
    r.jobId,
    r.result || null,
    r.before || null,
    r.after || null,
    r.awxStatus || null,
    isoOrNull(r.finished),
  ];
  const upd = await db.query(
    `UPDATE opsx_was_ops SET result = $3, before_state = $4, after_state = $5, awx_status = $6,
            awx_finished = $7, audited_at = GETUTCDATE()
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND audited_at IS NULL`,
    vals,
  );
  if (upd.rowCount > 0) return true;
  // Satir hic yoksa (launch'taki INSERT basarisizdi) burada olusturulur - yine TEK sefer.
  try {
    const ins = await db.query(
      `INSERT INTO opsx_was_ops (awx_server_id, awx_job_id, result, before_state, after_state, awx_status,
              awx_finished, request_id, username, params, audited_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, GETUTCDATE()
        WHERE NOT EXISTS (SELECT 1 FROM opsx_was_ops WHERE awx_server_id = $1 AND awx_job_id = $2)`,
      [...vals, r.requestId || null, r.username || null, JSON.stringify(r.params || {})],
    );
    return ins.rowCount > 0;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

// Uzlastiricinin bakacagi isler: sonucu yazilmamis islem kayitlari (son 24 saat) + bir ise
// bagli DOLU kilitler (islem kaydi hic yazilamamis olsa bile kilit birakilsin).
async function pendingWasJobs(db, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const a = await db.query(
    `SELECT TOP 50 awx_server_id, awx_job_id FROM opsx_was_ops
      WHERE audited_at IS NULL AND created_at >= DATEADD(HOUR, -24, GETUTCDATE())
      ORDER BY id ASC`,
  );
  const b = await db.query(
    `SELECT TOP 50 awx_server_id, awx_job_id FROM opsx_was_locks
      WHERE held = 1 AND awx_server_id IS NOT NULL AND awx_job_id IS NOT NULL
      ORDER BY id ASC`,
  );
  const out = [];
  const seen = new Set();
  for (const r of [...(a.rows || []), ...(b.rows || [])]) {
    const sid = Number(r.awx_server_id);
    const jid = Number(r.awx_job_id);
    if (!Number.isInteger(sid) || !Number.isInteger(jid) || seen.has(`${sid}:${jid}`)) continue;
    seen.add(`${sid}:${jid}`);
    out.push({ serverId: sid, jobId: jid });
  }
  return out.slice(0, n);
}

// Uygulama kilidi dolu mu (kesif ekraninda bilgi olarak gosterilir; karar degil).
async function activeAppLock(db, app) {
  const { rows } = await db.query(
    `SELECT TOP 1 holder, target_desc, awx_job_id, locked_until FROM opsx_was_locks
      WHERE lock_key = $1 AND held = 1 AND locked_until > GETUTCDATE()`,
    [`A|${String(app)}`],
  );
  return rows[0] || null;
}

module.exports = {
  NAME_RE,
  NAME_MAX,
  MAX_DISCOVER_HOSTS,
  DISCOVERY_MAX_AGE_MS,
  OPERATIONS,
  STATES,
  ALLOWED_BY_STATE,
  TEMPLATE_TIMEOUT_MIN,
  DEFAULT_LOCK_TTL_MIN,
  lockTtlMinutes,
  isValidName,
  normalizeEnv,
  isProdEnv,
  isNoApp,
  isSelectableOs,
  normalizeHost,
  shapeInventoryHosts,
  maskSecrets,
  classify,
  isMeasured,
  parseDiscoverResult,
  findTarget,
  clusterInfo,
  peerSummary,
  computeWarnings,
  allowedOperations,
  gateOperation,
  targetsForApp,
  discoveryAge,
  parseOpResult,
  opResultMismatch,
  resultSeverity,
  auditResultOf,
  lockKeys,
  readLock,
  acquireLocks,
  bindLocks,
  releaseLocks,
  releaseLocksForJob,
  staleDiscovery,
  activeAppLock,
  insertOpRecord,
  loadOpRecord,
  markOpAudited,
  pendingWasJobs,
};
