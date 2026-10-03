// server/ansible/long-job-cancel.cjs — uzun suren AWX job'larini OTOMATIK IPTAL.
//
// Kullanici (2026-09-14): "Portal maestro'larda uzun suren job'lari kill etsin".
// Kararlar (kullanici): esik 60 dk; YALNIZCA Admin ekraninda secilen template'ler;
// mod: dogrudan iptal + Teams bildirimi.
//
// TASARIM: long-job-watcher'in tick'i (5 dk'da bir, tum AWX sunuculari) taramayi
// (runner.listLongJobCandidatesAcrossServers) burada runCycle()'a verir; karar
// shouldCancel() ile, iptal runner.cancelJobOnServer() ile (job: /api/v2/jobs/<id>/cancel/,
// workflow: /api/v2/workflow_jobs/<id>/cancel/). Yapilandirma DB'de
// (portal_config_blobs 'longjob-cancel'), env DEGIL: Admin ekranindan hot degisir.
//
// 2026-10-03 URETIM OLAYI ("belirledigim surede bitmeyen isler kesilmiyor; gelistirme
// tamamlandi diye rapor yazdim"). Kanit: 20 Eylul logunda 8 x `POST /api/v2/jobs/N/cancel/
// -> 403`; basarisizlik YALNIZ console.warn'a gidiyordu. Bu dosya artik su sozu verir:
//   1) SESSIZ BASARISIZLIK YOK: iptal reddedilirse (403 dahil) Teams karti ("IPTAL
//      EDILEMEDI - is CALISMAYA DEVAM EDIYOR" + sebep + ne yapilmali), Portal denetimi
//      'awx_long_job_cancel' result 'fail' ve durum kaydi (son tick + son 50 deneme).
//   2) DURUM + KURU CALISTIRMA: bellek-ici son tick ozeti (sunucu basina taranabildi mi,
//      her aday icin karar + neden). Kuru calistirma AYNI karar mantigini kosar, HICBIR
//      IPTAL (/cancel/) istegi gondermez, Teams/denetim yazmaz, durum makinesine dokunmaz.
//      (Kullanici/sifreli AWX'te token onbellegi bossa kimlik dogrulama token'i alinabilir:
//      POST /api/v2/tokens/ — gercek tarama da ayni token'i kullanir.)
//   3) YETKI ON KONTROLU: izin listesindeki template icin AWX user_capabilities.edit
//      (template Admin rolu). false -> "baskalarinin isini iptal EDEMEZ"; okunamazsa
//      "olculemedi" (yok/var DEGIL). edit=true TOKEN KAPSAMINI olcmez: statik/OAuth2
//      token'da kapsam "olculemedi" yazilir (read kapsamli token her POST'ta 403 alir).
//   4) KAPSAM: workflow job'lari + tum sayfalar + en eski once (runner tarafinda).
//      Workflow iptali AWX'te workflow'un CALISAN TUM ALT ISLERINI de keser (kart + ekran soyler).
//   5) IPTAL SONRASI DOGRULAMA: 202'den sonra is VERIFY_TICKS tarama boyunca hala
//      aktifse "iptal istendi ama durmadi" alarmi. Is TAM taranmis listede gorunmese bile
//      kayit, isin durumu AWX'ten OKUNUP terminal oldugu teyit edilmeden SILINMEZ (ofset
//      sayfalamasi kayabilir); durum okunamazsa BILINMIYOR, kayit korunur. "Zaten bitmis"
//      (alreadyTerminal) kayitlari da ayni dogrulamadan gecer.
//   6) YAPILANDIRMA OKUNAMAZSA son gecerli yapilandirmayla devam (hic yoksa kapali);
//      console.error + durum ekraninda "yapilandirma okunamadi".
//   7) "Kuyrukta takili isler" (cancelQueued, varsayilan KAPALI): pending/waiting is
//      created zamanina gore esigi asarsa iptal.
//   8) TARAMA SAGLIGI: otomatik iptal acikken izin listesindeki bir sunucu+tur SCAN_FAIL_TICKS
//      tarama ust uste okunamazsa (token iptali/401, gateway yolu, ...) kesinti basina TEK
//      Teams karti "OTOMATIK IPTAL CALISMIYOR" + denetim fail (phase 'scan'); duzelince kayit.
//      Tarama hic bitmiyorsa (in-flight) watcher ayni yoldan haber verir.
//   9) IPTAL TOKEN'I (kullanici, 2026-10-03: "servis kullanicisina yetki verme hakkim yok;
//      kendi onurdemir3 token'imi admin panelinden vereyim, onunla iptal et"): AWX sunucusu
//      basina Admin'in girdigi kisisel token (long-job-cancel-token.cjs; sifreli, yalniz
//      yazilir). YALNIZ iptal cagrisi ve yetki on kontrolu bu token'i kullanir; tarama, durum
//      okuma ve Portal'in diger tum AWX cagrilari servis kullanicisiyla DEGISMEDEN kalir.
//      Token tanimli degilse eski davranis. 401 -> "IPTAL TOKEN'I GECERSIZ": Teams + denetim
//      + durum, is IPTAL EDILEMEDI (kalici; yeni token kaydedilince yeniden denenir). 403 ->
//      kalici red + "token sahibi <kullanici> bu template'te Admin degil". IZ: Teams karti
//      ve denetim kaydi "iptal <kullanici> token'iyla yapildi" der.
//      Token KAYDI okunamazsa (DB; bellekte son gecerli kayit yok) servis kullanicisina
//      DUSULMEZ: iptal o turda DENENMEZ (gecici; MAX_ATTEMPTS), kart/durum "iptal token kaydi
//      OKUNAMADI - iptal denenmedi" der; kayit okununca is yeniden denenir. Token kaydedildigi
//      AWX ADRESINE baglidir: sunucunun adresi degisirse token yeni adrese GONDERILMEZ (kalici).
//
// GUVENLIK MODELI (degismedi):
//   - Izin listesi BOS = hicbir sey iptal edilmez (varsayilan kapali). Esik en az 5 dk.
//   - Eslesme (awxServerId, tur, templateId) uclusu uzerinden; ad yalniz gosterim.
//     Eski kayitlarda tur yoksa 'job' sayilir.
//   - Uclarin tamami requireAuth + requireAdmin (registerRoutes).
//   - Coklu Portal ornegi: superuser olmayan Portal kullanicisi BITMIS ise 403 alir (405 DEGIL);
//     runner.cancelJobOnServer 403/405/409'da isin durumunu okur, terminal ise "zaten bitmis"
//     doner. Boylece ikinci ornegin denemesi yanlis "IPTAL EDILEMEDI" alarmi uretmez.
//   - Sirlar (token/sifre) durum/denetim/Teams metinlerine GIRMEZ (redaksiyon).
'use strict';

const os = require('os');
const tokenStore = require('./long-job-cancel-token.cjs');

const CONFIG_NAME = 'longjob-cancel';
const CACHE_TTL_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;
const VERIFY_TICKS = 2;
const SCAN_FAIL_TICKS = 3; // ~15 dk (5 dk aralik) ust uste taranamayan sunucu+tur -> Teams + denetim
const STATE_CHECK_MAX = 50; // tur basina "listede yok" teyidi icin en fazla bu kadar is durumu okunur
const ATTEMPT_LOG_MAX = 50;
const STATUS_JOBS_MAX = 300;
const PERMISSION_DEADLINE_MS = 8000;
const PERMISSION_MAX_TEMPLATES = 100;
const TEMPLATE_LIST_DEADLINE_MS = 20000;
const TEAMS_TIMEOUT_MS = 15000;

const PROBLEM_DECISIONS = new Set(['cancel_failed', 'still_running']);
// AWX'te aktif (iptal edilebilir) durumlar: UnifiedJob.CAN_CANCEL. Digerleri terminal.
const ACTIVE_STATUSES = new Set(['new', 'pending', 'waiting', 'running']);

let _cache = null;
let _cacheAt = 0;
let _lastGood = null;
let _lastGoodAt = null;
let _configError = null; // { at, message } | null

const iso = (ms) => new Date(ms == null ? Date.now() : ms).toISOString();
const normKind = (k) => (k === 'workflow' ? 'workflow' : 'job');
const kindLabel = (k) => (normKind(k) === 'workflow' ? 'workflow job' : 'job');

// ── Redaksiyon ───────────────────────────────────────────────────────────────
function genericRedact(s) {
  return String(s == null ? '' : s)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/((?:access_)?token|password|passwd|secret|client_secret)(["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, '$1$2***');
}

function makeRedactor(runner) {
  return (s) => {
    let x = String(s == null ? '' : s);
    try {
      if (runner && typeof runner.redactSecrets === 'function') x = runner.redactSecrets(x);
    } catch {
      /* genel kaliplar yine uygulanir */
    }
    try {
      // Iptal token'lari runner'dan bagimsiz da maskelenir (sahte/eksik runner'da bile).
      x = tokenStore.redact(x);
    } catch {
      /* genel kaliplar yine uygulanir */
    }
    return genericRedact(x).slice(0, 1000);
  };
}

// ── Yapilandirma ─────────────────────────────────────────────────────────────
function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
  const seen = new Set();
  return {
    enabled: cfg.enabled === true,
    thresholdMinutes: Math.max(5, Math.min(24 * 60, Number(cfg.thresholdMinutes) || 60)),
    cancelQueued: cfg.cancelQueued === true,
    templates: templates
      .map((t) => ({
        serverId: Number(t && t.serverId) || 0,
        templateId: Number(t && t.templateId) || 0,
        kind: normKind(t && t.kind),
        name: String((t && t.name) || '').slice(0, 200),
      }))
      .filter((t) => {
        if (!(t.serverId > 0 && t.templateId > 0)) return false;
        const k = `${t.serverId}:${t.kind}:${t.templateId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
  };
}

/**
 * DB hatasinda SESSIZCE 'kapali'ya DUSMEZ: son gecerli yapilandirma (hic yoksa kapali)
 * doner, hata console.error + durum ekranina (getConfigState) yazilir. Basarisiz okuma
 * onbellege yazilmaz; bir sonraki cagri DB'yi yeniden dener.
 */
async function readConfig(db) {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
    const raw = rows?.[0]?.data;
    const cfg = normalizeConfig(typeof raw === 'string' ? JSON.parse(raw) : raw);
    _cache = cfg;
    _cacheAt = Date.now();
    _lastGood = cfg;
    _lastGoodAt = iso();
    _configError = null;
    return cfg;
  } catch (e) {
    const message = genericRedact((e && e.message) || String(e));
    _configError = { at: iso(), message };
    console.error(
      `[LongJobCancel] yapilandirma okunamadi (portal_config_blobs '${CONFIG_NAME}'); ` +
        (_lastGood ? 'son gecerli yapilandirmayla devam ediliyor' : 'hic gecerli yapilandirma yok -> otomatik iptal KAPALI') +
        ':',
      message,
    );
    return _lastGood || normalizeConfig(null);
  }
}

function getConfigState() {
  return {
    configError: _configError,
    usingLastGoodConfig: !!(_configError && _lastGood),
    lastGoodAt: _lastGoodAt,
  };
}

async function writeConfig(db, body) {
  const cfg = normalizeConfig(body);
  const data = JSON.stringify(cfg);
  const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
  if (ex.rows.length) await db.query(`UPDATE portal_config_blobs SET data = $2 WHERE name = $1`, [CONFIG_NAME, data]);
  else await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [CONFIG_NAME, data]);
  _cache = cfg;
  _cacheAt = Date.now();
  _lastGood = cfg;
  _lastGoodAt = iso();
  _configError = null;
  // Admin kaydetti (or. AWX'te Admin rolunu verdikten sonra): iptal edilemeyen isler
  // bir sonraki taramada YENIDEN denenir. Bekleyen dogrulamalara (_done) dokunulmaz.
  _failed.clear();
  _attempts.clear();
  _storeUnreadableKeys.clear();
  return cfg;
}

const cfgView = (cfg) =>
  cfg
    ? {
        enabled: cfg.enabled,
        thresholdMinutes: cfg.thresholdMinutes,
        cancelQueued: cfg.cancelQueued,
        templateCount: cfg.templates.length,
      }
    : null;

// ── Karar ────────────────────────────────────────────────────────────────────
/**
 * Saf karar: bu job iptal edilmeli mi? (test edilebilir)
 * Calisan is `started`a, kuyruktaki is (yalniz cancelQueued acikken) `created`a gore olculur.
 * @returns {{cancel: boolean, reason?: string, decision: string, elapsedMinutes?: number, basis?: string}}
 */
function isListed(cfg, job) {
  const kind = normKind(job.kind);
  return ((cfg && cfg.templates) || []).some(
    (t) => t.serverId === Number(job.serverId) && t.templateId === Number(job.templateId) && normKind(t.kind) === kind,
  );
}

function shouldCancel(cfg, job, nowMs = Date.now()) {
  if (!cfg || !cfg.enabled) return { cancel: false, reason: 'kapali', decision: 'disabled' };
  if (!job) return { cancel: false, reason: 'started yok', decision: 'no_started' };
  if (!isListed(cfg, job)) return { cancel: false, reason: 'izin listesinde degil', decision: 'not_listed' };
  const queued = job.status === 'pending' || job.status === 'waiting' || job.status === 'new';
  let refIso;
  let basis;
  if (queued) {
    if (!cfg.cancelQueued) return { cancel: false, reason: 'kuyrukta (kuyruk secenegi kapali)', decision: 'queued_option_off' };
    if (!job.created) return { cancel: false, reason: 'created yok', decision: 'no_created' };
    refIso = job.created;
    basis = 'created';
  } else {
    if (!job.started) return { cancel: false, reason: 'started yok', decision: 'no_started' };
    refIso = job.started;
    basis = 'started';
  }
  const refMs = new Date(refIso).getTime();
  if (!Number.isFinite(refMs)) {
    return { cancel: false, reason: `${basis} okunamadi`, decision: basis === 'created' ? 'no_created' : 'no_started' };
  }
  const elapsedMinutes = (nowMs - refMs) / 60000;
  if (!(elapsedMinutes >= cfg.thresholdMinutes)) {
    return { cancel: false, reason: 'esik altinda', decision: 'below_threshold', elapsedMinutes, basis };
  }
  return { cancel: true, decision: 'cancel', elapsedMinutes, basis };
}

const REASON_TEXT = {
  disabled: 'Otomatik iptal kapalı',
  // "hicbir zaman" DENMEZ: secili bir workflow iptal edilirse AWX onun alt islerini de keser.
  not_listed: 'İzin listesinde değil — Portal bu işi doğrudan iptal etmez',
  no_started: "AWX'te başlangıç zamanı (started) yok — süre ölçülemedi, dokunulmadı",
  no_created: "AWX'te oluşturma zamanı (created) yok — süre ölçülemedi, dokunulmadı",
  queued_option_off: "Kuyrukta (pending/waiting) — 'Kuyrukta takılı işler' seçeneği kapalı",
};

// ── Durum (bellek-ici, bu Portal ornegi) ──────────────────────────────────────
const _attempts = new Map(); // key -> deneme sayisi
const _done = new Map(); // key -> { job, requestedAt, seenTicks, alarmed, alreadyTerminal } ; terminal dogrulaninca silinir
const _failed = new Map(); // key -> { job, message, permanent, httpStatus, jobState, hint, at } ; tekrar denenmez
const _scanHealth = new Map(); // `${serverId}:${kind}` -> { fails, since, alerted, lastError, ... }
const _missingSeen = new Map(); // key -> ust uste kac TAM taramada "listede yok + detay 404"
const _attemptLog = []; // son ATTEMPT_LOG_MAX deneme/alarm
let _lastTick = null;
let _lastDryRun = null;
let _stuckAlertFor = null; // watcher in-flight alarmi verilen taramanin baslangic zamani
let _tokenSigSeen = null; // Map<serverId, sifreli deger>: iptal token'i (baska ornekte) degisti mi
const _storeUnreadableKeys = new Set(); // token KAYDI okunamadigi icin iptali DENENMEYEN isler

const jobKey = (job) => `${job.serverId}:${normKind(job.kind)}:${job.jobId}`;

function pushLog(entry, tickLog) {
  const e = { at: iso(), ...entry };
  _attemptLog.push(e);
  if (_attemptLog.length > ATTEMPT_LOG_MAX) _attemptLog.splice(0, _attemptLog.length - ATTEMPT_LOG_MAX);
  if (tickLog) tickLog.push(e);
  return e;
}

function baseEntry(job, nowMs) {
  const ref = job.started || job.created;
  const refMs = ref ? new Date(ref).getTime() : NaN;
  return {
    serverId: job.serverId,
    serverName: job.serverName || `sunucu ${job.serverId}`,
    kind: normKind(job.kind),
    jobId: job.jobId,
    jobName: job.jobName || `#${job.jobId}`,
    templateId: job.templateId ?? null,
    status: job.status || null,
    started: job.started || null,
    created: job.created || null,
    executer: job.executer || null,
    url: job.url || null,
    ageMinutes: Number.isFinite(refMs) ? Math.floor((nowMs - refMs) / 60000) : null,
  };
}

// ── Teams ────────────────────────────────────────────────────────────────────
function cardShell(style, title, subtitle, facts, url) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body: [
            {
              type: 'Container',
              style,
              bleed: true,
              items: [
                { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Large', wrap: true },
                { type: 'TextBlock', text: subtitle, wrap: true },
              ],
            },
            { type: 'FactSet', facts },
          ],
          actions: url ? [{ type: 'Action.OpenUrl', title: 'AWX’te aç', url }] : [],
        },
      },
    ],
  };
}

function jobFacts(job, elapsedMinutes, cfg) {
  const ref = job.started || job.created;
  return [
    { title: 'AWX', value: job.serverName || `sunucu ${job.serverId}` },
    { title: normKind(job.kind) === 'workflow' ? 'Workflow job' : 'Job', value: `#${job.jobId} — ${job.jobName}` },
    { title: 'Template', value: `#${job.templateId ?? '?'}${normKind(job.kind) === 'workflow' ? ' (workflow)' : ''}` },
    { title: 'AWX durumu', value: job.status || '—' },
    { title: 'Başlatan', value: job.executer || '—' },
    { title: job.started ? 'Başlangıç' : 'Kuyruğa giriş', value: ref ? new Date(ref).toLocaleString('tr-TR') : '—' },
    {
      title: 'Süre',
      value: elapsedMinutes != null ? `${Math.floor(elapsedMinutes)} dk (eşik ${cfg.thresholdMinutes} dk)` : '—',
    },
    { title: 'Kural', value: 'Admin > Ansible Info > Uzun süren işleri iptal (izin listesindeki template)' },
  ];
}

const WORKFLOW_CHILDREN_NOTE =
  "AWX bir workflow'u iptal edince o an çalışan TÜM alt işlerini de keser (alt işlerin template'i izin listesinde olmasa bile).";

// IZ: iptalin HANGI AWX kimligiyle yapildigi (kart + denetim + durum ayni metni kullanir).
const viaText = (owner) => `İptal ${owner || '?'} token'ıyla yapıldı`;
const viaPhrase = (owner) => `iptal ${owner || '?'} token'ıyla yapıldı`;
const SERVICE_VIA_TEXT = "İptal Portal'ın AWX servis kullanıcısıyla yapıldı";

function viaFacts(info) {
  if (!info || !info.via) return [];
  if (info.via === 'cancel_token') {
    return [{ title: 'İptal kimliği', value: `${viaText(info.tokenOwner)} (kişisel iptal token'ı — geçici çözüm)` }];
  }
  return [{ title: 'İptal kimliği', value: SERVICE_VIA_TEXT }];
}

function teamsCard(job, elapsedMinutes, cfg, info = {}) {
  const wf = normKind(job.kind) === 'workflow';
  return cardShell(
    'attention',
    `⛔ Uzun süren ${kindLabel(job.kind)} Portal tarafından iptal edildi`,
    `${job.serverName} · ${job.jobName} · ${kindLabel(job.kind)} #${job.jobId} — ${Math.floor(elapsedMinutes)} dakikadır ` +
      `${job.started ? 'çalışıyordu' : 'kuyruktaydı'} (eşik ${cfg.thresholdMinutes} dk). AWX iptal isteğini kabul etti; ` +
      'durduğu bir sonraki taramada doğrulanır (durmazsa ayrı alarm gelir).' +
      (info.via === 'cancel_token' ? ` ${viaText(info.tokenOwner)}.` : '') +
      (wf ? ` ${WORKFLOW_CHILDREN_NOTE}` : ''),
    [
      ...jobFacts(job, elapsedMinutes, cfg),
      ...viaFacts(info),
      ...(wf ? [{ title: 'Alt işler', value: WORKFLOW_CHILDREN_NOTE }] : []),
    ],
    job.url,
  );
}

const RETRY_HINT =
  "Düzelttikten sonra Admin > Ansible Info > Uzun süren işleri iptal ekranında Kaydet'e basmak yeniden denemeyi açar.";
const TOKEN_SCOPE_HINT =
  "Portal'ın kullandığı AWX token'ında 'write' kapsamı yoksa (ör. 'read' kapsamlı oluşturulmuş statik AWX_N_TOKEN) " +
  'AWX her iptal isteğini 403 ile reddeder → write kapsamlı token tanımlayın.';

/**
 * 403 (is AKTIF) icin "ne yapilmali". Tek nedene baglanmaz: AWX'te isi BASLATAN kullanici
 * onu her zaman iptal edebilir (JobAccess.can_cancel), yani is Portal'in kendi isiyse sebep
 * template Admin rolu OLAMAZ -> token kapsami. Aksi halde iki olasi neden birlikte yazilir.
 */
function forbiddenHint(info) {
  if (info.via === 'cancel_token') {
    const who = info.tokenOwner || info.portalUser || '?';
    if (info.createdByPortal === true) {
      return (
        `Bu işi iptal token'ının sahibi ${who} başlatmış; AWX'te işi başlatan kullanıcı onu her zaman iptal edebilir — ` +
        "yani sebep template Admin rolü DEĞİL: token 'write' kapsamlı değil. Admin ekranından 'write' kapsamlı bir token " +
        `girin. Şimdilik işi AWX arayüzünden elle iptal edin. ${RETRY_HINT}`
      );
    }
    return (
      `Token sahibi ${who} bu template'te Admin değil (Execute rolü başkalarının başlattığı işi iptal etmeye YETMEZ) → ` +
      `AWX'te ${who} kullanıcısına bu template'te Admin rolü verin ya da Admin rolü olan bir kullanıcının token'ını girin. ` +
      "Token 'write' kapsamlı değilse AWX her iptal isteğini yine 403 ile reddeder. " +
      `Şimdilik işi AWX arayüzünden elle iptal edin. ${RETRY_HINT}`
    );
  }
  if (info.createdByPortal === true) {
    return (
      `Bu işi Portal'ın kendi AWX kullanıcısı${info.portalUser ? ` (${info.portalUser})` : ''} başlatmış; AWX'te işi ` +
      'başlatan kullanıcı onu her zaman iptal edebilir — yani sebep template Admin rolü DEĞİL. ' +
      `${TOKEN_SCOPE_HINT} Şimdilik işi AWX arayüzünden elle iptal edin. ${RETRY_HINT}`
    );
  }
  return (
    "İki olası neden var: (1) Portal'ın AWX kullanıcısının bu template'te Admin rolü yok (Execute rolü, başkalarının " +
    "başlattığı işi iptal etmeye YETMEZ) → AWX'te Admin rolü verin; (2) " +
    `${TOKEN_SCOPE_HINT} Şimdilik işi AWX arayüzünden elle iptal edin. ${RETRY_HINT}`
  );
}

const TOKEN_INVALID_WHAT =
  "İptal token'ı AWX'te iptal edilmiş ya da süresi dolmuş (AWX 401). Admin > Ansible Info > Uzun süren işleri iptal > " +
  "İptal token'ı bölümünden yeni token girin (kaydedince iptal edilemeyen işler yeniden denenir) ya da token'ı silin " +
  "(o zaman Portal servis kullanıcısı kullanılır). Şimdilik işi AWX arayüzünden elle iptal edin.";
const TOKEN_STORE_UNREADABLE_WHAT =
  "Portal iptal token kaydını (portal_config_blobs 'longjob-cancel-tokens') okuyamadı: bu sunucuda iptal token'ı " +
  "tanımlı mı ÖLÇÜLEMEDİ, bu yüzden iptal DENENMEDİ (servis kullanıcısına düşülmedi). Portal'ın DB erişimini kontrol " +
  'edin; kayıt okununca iş otomatik olarak yeniden denenir. Şimdilik işi AWX arayüzünden elle iptal edin.';
const TOKEN_MISMATCH_WHAT =
  "Bu AWX sunucusunun adresi iptal token'ı kaydedildikten sonra değişmiş (ya da kayıtta adres yok): kişisel token " +
  "yeni adrese GÖNDERİLMEDİ ve iptal denenmedi. Admin ekranından token'ı bu sunucu için yeniden girin ya da silin " +
  "(o zaman Portal servis kullanıcısı kullanılır). Şimdilik işi AWX arayüzünden elle iptal edin.";
const TOKEN_UNDECRYPTABLE_WHAT =
  "Kayıtlı iptal token'ı çözülemedi (ENV_OVERRIDES_ENCRYPTION_KEY eksik ya da değişmiş olabilir). Admin ekranından " +
  "token'ı yeniden girin ya da silin. Şimdilik işi AWX arayüzünden elle iptal edin.";

/** Durum satiri icin kisa neden. */
function shortHint(info) {
  if (info.tokenInvalid) return "İPTAL TOKEN'I GEÇERSİZ — Admin ekranından yeni token girin";
  if (info.tokenStoreUnreadable) return 'iptal token kaydı OKUNAMADI — iptal denenmedi';
  if (info.tokenServerMismatch) return "iptal token'ı bu AWX adresi için kaydedilmedi — token gönderilmedi, iptal denenmedi";
  if (info.tokenUndecryptable) return "iptal token'ı çözülemedi — Admin ekranından yeniden girin";
  if (info.httpStatus === 403 && info.jobState === 'active' && info.via === 'cancel_token') {
    return info.createdByPortal === true
      ? `olası neden: token 'write' kapsamlı değil (işi token sahibi ${info.tokenOwner || '?'} başlatmış)`
      : `token sahibi ${info.tokenOwner || '?'} bu template'te Admin değil (ya da token 'write' kapsamlı değil)`;
  }
  if (info.httpStatus === 403 && info.jobState === 'active') {
    return info.createdByPortal === true
      ? "olası neden: token'da 'write' kapsamı yok (iş Portal'ın kendi başlattığı iş; Admin rolü sebep DEĞİL)"
      : "olası neden: Portal'ın AWX kullanıcısının bu template'te Admin rolü yok ya da token 'write' kapsamlı değil";
  }
  if (info.jobState === 'unknown') return "işin şu anki durumu ölçülemedi; AWX arayüzünden kontrol edin";
  return null;
}

function failureCard(job, elapsedMinutes, cfg, info = {}) {
  let what;
  if (info.tokenInvalid) what = TOKEN_INVALID_WHAT;
  else if (info.tokenStoreUnreadable) what = TOKEN_STORE_UNREADABLE_WHAT;
  else if (info.tokenServerMismatch) what = TOKEN_MISMATCH_WHAT;
  else if (info.tokenUndecryptable) what = TOKEN_UNDECRYPTABLE_WHAT;
  else if (info.httpStatus === 403 && info.jobState === 'active') what = forbiddenHint(info);
  else if (info.jobState === 'unknown') {
    what = "AWX arayüzünden işin durumunu kontrol edin; hâlâ çalışıyorsa elle iptal edin. " + RETRY_HINT;
  } else if (info.httpStatus === 405 || info.httpStatus === 409) {
    what =
      "İşi AWX arayüzünden elle iptal edin. AWX önündeki vekil/WAF/gateway'in iptal isteğini (POST .../cancel/) " +
      'AWX\'e ilettiğinden emin olun.';
  } else {
    what = 'İşi AWX arayüzünden elle iptal edin. Hata sürüyorsa AWX erişimini ve Portal kimlik bilgisini kontrol edin.';
  }
  const title = info.tokenInvalid
    ? `⛔ İPTAL EDİLEMEDİ — İPTAL TOKEN'I GEÇERSİZ (${info.tokenOwner || '?'}, AWX 401)`
    : info.tokenStoreUnreadable
      ? '⛔ İPTAL EDİLEMEDİ — İPTAL TOKEN KAYDI OKUNAMADI (iptal denenmedi)'
      : info.tokenServerMismatch
        ? `⛔ İPTAL EDİLEMEDİ — İPTAL TOKEN'I BU AWX ADRESİ İÇİN KAYDEDİLMEDİ (${info.tokenOwner || '?'})`
        : info.tokenUndecryptable
      ? `⛔ İPTAL EDİLEMEDİ — İPTAL TOKEN'I ÇÖZÜLEMEDİ (${info.tokenOwner || '?'})`
      : info.jobState === 'unknown'
        ? '⛔ İPTAL EDİLEMEDİ — işin AWX’teki şu anki durumu ÖLÇÜLEMEDİ'
        : '⛔ İPTAL EDİLEMEDİ — iş AWX’te ÇALIŞMAYA DEVAM EDİYOR';
  return cardShell(
    'attention',
    title,
    `${job.serverName} · ${job.jobName} · ${kindLabel(job.kind)} #${job.jobId} — ${Math.floor(elapsedMinutes || 0)} dakikadır ` +
      `${job.started ? 'çalışıyor' : 'kuyrukta'} (eşik ${cfg.thresholdMinutes} dk; son taramada aktifti). Portal iptal etmeye ` +
      `çalıştı ama istek başarısız oldu${info.permanent ? ' (kalıcı ret; tekrar denenmeyecek)' : ` (${info.attempts || MAX_ATTEMPTS} deneme)`}.`,
    [
      ...jobFacts(job, elapsedMinutes, cfg),
      ...(info.awxStatus ? [{ title: 'AWX durumu (iptal anında)', value: info.awxStatus }] : []),
      ...(info.tokenStoreUnreadable
        ? [{ title: 'İptal kimliği', value: 'ÖLÇÜLEMEDİ — iptal token kaydı okunamadı; iptal denenmedi (servis kullanıcısına düşülmedi)' }]
        : info.via === 'cancel_token'
          ? [
              {
                title: 'İptal kimliği',
                value:
                  info.tokenUndecryptable || info.tokenServerMismatch
                    ? `İptal ${info.tokenOwner || '?'} token'ıyla DENENMEDİ (token kullanılamıyor)`
                    : `İptal ${info.tokenOwner || '?'} token'ıyla denendi (kişisel iptal token'ı)`,
              },
            ]
          : []),
      { title: 'Sebep', value: info.reason || '—' },
      { title: 'Ne yapılmalı', value: what },
    ],
    job.url,
  );
}

function notStoppedCard(job, elapsedMinutes, cfg, info = {}) {
  const when = info.requestedAt ? new Date(info.requestedAt).toLocaleString('tr-TR') : '';
  return cardShell(
    'warning',
    info.alreadyTerminal
      ? '⚠️ İPTAL EDİLMEDİ — AWX “zaten bitmiş” dedi ama iş ÇALIŞMAYA DEVAM EDİYOR'
      : '⚠️ İPTAL İSTENDİ AMA İŞ DURMADI — AWX’te ÇALIŞMAYA DEVAM EDİYOR',
    info.alreadyTerminal
      ? `${job.serverName} · ${job.jobName} · ${kindLabel(job.kind)} #${job.jobId}: iptal isteğine ${when} tarihinde ` +
          `"zaten bitmiş" (405/409) yanıtı geldi, ama iş ${info.ticks || VERIFY_TICKS} taramadır hâlâ '${job.status || '?'}' durumunda.`
      : `${job.serverName} · ${job.jobName} · ${kindLabel(job.kind)} #${job.jobId}: iptal ${when} ` +
          `istendi ve AWX kabul etti, ama iş ${info.ticks || VERIFY_TICKS} taramadır hâlâ '${job.status || '?'}' durumunda.`,
    [
      ...jobFacts(job, elapsedMinutes, cfg),
      {
        title: 'Ne yapılmalı',
        value: info.alreadyTerminal
          ? "AWX arayüzünden işi elle iptal edin. AWX önündeki vekil/WAF/gateway'in iptal isteğini (POST .../cancel/) " +
            "AWX'e ilettiğinden emin olun. Portal bu işi tekrar iptal etmeyi DENEMEZ."
          : 'AWX arayüzünde işi kontrol edin ve gerekirse elle iptal edin; iş iptalde takılıysa execution node / receptor ' +
            'sağlığına bakın. Portal bu işi tekrar iptal etmeyi DENEMEZ.',
      },
    ],
    job.url,
  );
}

function scanFailCard(h, cfg) {
  return cardShell(
    'attention',
    `⛔ OTOMATİK İPTAL ÇALIŞMIYOR — ${h.serverName} ${kindLabel(h.kind)} listesi taranamıyor`,
    `Portal ${h.fails} taramadır (${new Date(h.since).toLocaleString('tr-TR')} tarihinden beri) bu AWX'teki ` +
      `${kindLabel(h.kind)} işlerini okuyamıyor. Bu sürede izin listesindeki işler eşiği (${cfg.thresholdMinutes} dk) aşsa da KESİLMEZ.`,
    [
      { title: 'AWX', value: h.serverName },
      { title: 'Tür', value: kindLabel(h.kind) },
      { title: 'Sebep', value: h.lastError || '—' },
      {
        title: 'Ne yapılmalı',
        value:
          "AWX erişimini, Portal'ın AWX kimlik bilgisini (token süresi / yenilenmesi, kullanıcı-şifre) ve API tabanını " +
          '(AAP 2.5: /api/controller/v2) kontrol edin. Ayrıntı: Admin > Ansible Info > Uzun süren işleri iptal > Durum.',
      },
    ],
    null,
  );
}

function scanRecoveredCard(h) {
  return cardShell(
    'good',
    `✅ Otomatik iptal yeniden çalışıyor — ${h.serverName} ${kindLabel(h.kind)} listesi taranabiliyor`,
    `${h.fails} başarısız taramadan sonra (${new Date(h.since).toLocaleString('tr-TR')} tarihinden beri) liste yeniden okundu.`,
    [
      { title: 'AWX', value: h.serverName },
      { title: 'Tür', value: kindLabel(h.kind) },
    ],
    null,
  );
}

function watcherStuckCard(startedAt, skips, intervalSeconds) {
  return cardShell(
    'attention',
    '⛔ OTOMATİK İPTAL ÇALIŞMIYOR — tarama bitmiyor',
    `Uzun süren iş taraması ${new Date(startedAt).toLocaleString('tr-TR')} tarihinde başladı ve hâlâ sürüyor; ` +
      `${skips} tarama (${Math.round((skips * intervalSeconds) / 60)} dk) atlandı. Bu sürede hiçbir iş iptal edilmiyor.`,
    [
      {
        title: 'Ne yapılmalı',
        value:
          "AWX ve Teams webhook erişimini kontrol edin (yanıt vermeyen bir uç taramayı bekletiyor olabilir); sürüyorsa Portal'ı yeniden başlatın.",
      },
    ],
    null,
  );
}

async function sendTeams(webhookUrl, body) {
  if (!webhookUrl) return false;
  const { buildDispatcher } = require('../mcp/client.cjs');
  const dispatcher = buildDispatcher(webhookUrl, 'teams-longjob-cancel');
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    dispatcher,
    // Asili bir webhook/vekil tick'i (ve ardindaki iptalleri) bekletmesin.
    signal: AbortSignal.timeout(TEAMS_TIMEOUT_MS),
  });
  if (!res.ok) {
    // SINIRLI OKUMA: `.text()` govdenin TAMAMINI bellege alir; ardindan gelen
    // `slice(0, 200)` HICBIR SEY KURTARMAZ — veri o noktada zaten bellektedir
    // (bkz. server/util/bounded-read.cjs, 2 numarali ders). Araya giren bir
    // kurumsal vekil sunucu bu uca MB'larca HTML hata sayfasi donebilir ve bu
    // yol her basarisiz webhook'ta calisir.
    const { readBodyPreview } = require('../util/bounded-read.cjs');
    const text = await readBodyPreview(res.body, { maxBytes: 1024 });
    throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return true;
}

/** Teams sonucu durum kaydina yazilir: 'gonderildi' | 'webhook tanimli degil' | 'hata: ...'. */
async function notifyTeams(webhookUrl, card, red) {
  if (!webhookUrl) return 'webhook tanimli degil';
  try {
    await sendTeams(webhookUrl, card);
    return 'gonderildi';
  } catch (e) {
    const m = red((e && e.message) || String(e));
    console.error('[LongJobCancel] Teams bildirimi gonderilemedi:', m);
    return `hata: ${m}`;
  }
}

// ── Ana dongu ────────────────────────────────────────────────────────────────
function decisionRank(e) {
  if (PROBLEM_DECISIONS.has(e.decision)) return 0;
  if (['cancel_requested', 'would_cancel', 'already_terminal', 'cancel'].includes(e.decision)) return 1;
  if (['below_threshold', 'queued_option_off', 'no_started', 'no_created'].includes(e.decision)) return 2;
  if (e.decision === 'not_listed') return 3;
  return 4;
}

function logFields(job) {
  return {
    serverId: job.serverId,
    serverName: job.serverName,
    kind: normKind(job.kind),
    jobId: job.jobId,
    jobName: job.jobName,
    templateId: job.templateId ?? null,
  };
}

/** "Listede yok" teyidi: isin SU ANKI durumu. Okunamazsa Map'te YOK (= olculemedi). */
async function readJobStates(runner, keys, red) {
  const out = new Map();
  if (!runner || typeof runner.getJobStateOnServer !== 'function') return out;
  for (const key of keys.slice(0, STATE_CHECK_MAX)) {
    const [sid, kind, jid] = key.split(':');
    try {
      const st = await runner.getJobStateOnServer(Number(sid), Number(jid), kind);
      if (st && st.status) out.set(key, st);
    } catch (e) {
      console.error(`[LongJobCancel] ${key} durumu okunamadi (kayit korunuyor):`, red((e && e.message) || String(e)));
    }
  }
  return out;
}

/**
 * TARAMA SAGLIGI: otomatik iptal acikken izin listesindeki her (sunucu, tur) icin ardisik
 * tarama hatasi sayilir. SCAN_FAIL_TICKS'e ulasinca kesinti basina TEK Teams karti + denetim
 * 'fail' (phase 'scan') + durum kaydi; duzelince denetim 'ok' + durum kaydi (+ kart alarm
 * gittiyse). Eskiden tarama hatasinin tek izi console + durum ekraniydi (SESSIZ).
 */
async function scanHealthStep(cfg, servers, ctx) {
  const relevant = new Map();
  if (cfg.enabled) {
    for (const t of cfg.templates) {
      relevant.set(`${t.serverId}:${normKind(t.kind)}`, { serverId: t.serverId, kind: normKind(t.kind) });
    }
  }
  for (const key of [..._scanHealth.keys()]) if (!relevant.has(key)) _scanHealth.delete(key);
  for (const [key, { serverId, kind }] of relevant) {
    const s = servers.find((x) => Number(x.serverId) === serverId);
    const k = s && s.kinds ? s.kinds[kind] : null;
    const serverName = (s && s.serverName) || `sunucu ${serverId}`;
    const h = _scanHealth.get(key);
    if (k && k.ok) {
      if (h && h.alerted) {
        const msg =
          `${serverName} ${kindLabel(kind)} listesi yeniden taranabiliyor (${h.fails} başarısız taramadan sonra); ` +
          'otomatik iptal yeniden çalışıyor.';
        console.warn(`[LongJobCancel] ${serverName} ${kind}: tarama duzeldi (${h.fails} basarisiz taramadan sonra)`);
        const teams = await notifyTeams(ctx.webhookUrl, scanRecoveredCard({ ...h, serverName }), ctx.red);
        ctx.doAudit('ok', { phase: 'scan', serverId, serverName, kind, recovered: true, fails: h.fails, since: h.since });
        pushLog({ serverId, serverName, kind, outcome: 'scan_recovered', ok: true, message: msg, teams }, ctx.tickLog);
      }
      _scanHealth.delete(key);
      continue;
    }
    const err = ctx.red(
      !s
        ? "Bu AWX sunucusu Portal'da tanımlı değil — izin listesindeki template'leri taranamıyor."
        : (k && k.error) || s.error || 'taranamadı',
    );
    const cur = h || { serverId, kind, serverName, fails: 0, since: iso(), alerted: false, lastError: null };
    cur.fails += 1;
    cur.lastError = err;
    cur.serverName = serverName;
    cur.lastAt = iso();
    _scanHealth.set(key, cur);
    if (cur.fails >= SCAN_FAIL_TICKS && !cur.alerted) {
      cur.alerted = true;
      const msg =
        `OTOMATİK İPTAL ÇALIŞMIYOR: ${serverName} ${kindLabel(kind)} listesi ${cur.fails} taramadır (${cur.since} tarihinden beri) ` +
        `okunamıyor — izin listesindeki işler eşiği aşsa da KESİLMEZ. Sebep: ${err}`;
      console.error(`[LongJobCancel] ${serverName} ${kind}: ${cur.fails} taramadir taranamiyor - otomatik iptal CALISMIYOR:`, err);
      const teams = await notifyTeams(ctx.webhookUrl, scanFailCard(cur, cfg), ctx.red);
      ctx.doAudit('fail', { phase: 'scan', serverId, serverName, kind, fails: cur.fails, since: cur.since, error: err });
      pushLog({ serverId, serverName, kind, outcome: 'scan_failed', ok: false, message: msg, teams }, ctx.tickLog);
    }
  }
}

function scanHealthView() {
  return [..._scanHealth.values()].map((h) => ({
    serverId: h.serverId,
    serverName: h.serverName,
    kind: h.kind,
    fails: h.fails,
    since: h.since,
    lastAt: h.lastAt || null,
    alerted: !!h.alerted,
    lastError: h.lastError,
    threshold: SCAN_FAIL_TICKS,
  }));
}

/** runner'daki sunucu satiri (url, apiBase): iptal token'inin adres baglamasi icin. */
function serverInfo(runner, serverId) {
  try {
    if (runner && typeof runner.getServerById === 'function') return runner.getServerById(serverId) || null;
    if (runner && typeof runner.getServers === 'function') {
      return runner.getServers().find((x) => Number(x.id) === Number(serverId)) || null;
    }
  } catch {
    /* adres okunamadi -> token KULLANILMAZ (long-job-cancel-token bindingProblem) */
  }
  return null;
}

async function _runCycle(scan, opts = {}) {
  const { db, runner, webhookUrl, audit } = opts;
  const dryRun = opts.dryRun === true;
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const t0 = Date.now();
  const red = makeRedactor(runner);
  const cfg = await readConfig(db);
  const jobs = scan && Array.isArray(scan.jobs) ? scan.jobs : Array.isArray(scan) ? scan : [];
  const servers = scan && Array.isArray(scan.servers) ? scan.servers : null;
  // "Listede yok" sonucu YALNIZ o sunucu+tur HATASIZ ve KIRPILMADAN tarandiysa dikkate
  // alinir; o zaman bile isin durumu okunmadan "bitti" SAYILMAZ (ofset sayfa kaymasi).
  // Eski cagri bicimi (processJobs(jobs)) sunucu bilgisi tasimaz: liste tam kabul edilir.
  const isComplete = (serverId, kind) => {
    if (!servers) return true;
    const s = servers.find((x) => Number(x.serverId) === Number(serverId));
    return !!(s && s.complete && s.complete[normKind(kind)]);
  };
  const completeForKey = (key) => {
    const [sid, kind] = key.split(':');
    return isComplete(Number(sid), kind);
  };
  const byKey = new Map(jobs.map((j) => [jobKey(j), j]));
  const results = [];
  const tickLog = [];
  const verify = { asked: 0, measured: 0, unmeasured: 0 };
  // Sunucu basina iptal kimligi (tur basina bir kez): iptal token'i tanimliysa o, degilse
  // servis kullanicisi. Cozulemeyen / adresi degismis token ve OKUNAMAYAN kayit FIRLATIR
  // (sessizce servis kullanicisina dusulmez).
  const authBySrv = new Map();
  const cancelAuthFor = async (serverId) => {
    const k = Number(serverId);
    if (!authBySrv.has(k)) {
      authBySrv.set(
        k,
        tokenStore.getCancelAuth(db, k, { server: serverInfo(runner, k) }).then(
          (a) => ({ a }),
          (e) => ({ e }),
        ),
      );
    }
    const r = await authBySrv.get(k);
    if (r.e) throw r.e;
    return r.a;
  };
  const doAudit = (result, detail) => {
    if (!audit || dryRun) return;
    try {
      audit('awx_long_job_cancel', { result, detail: JSON.stringify(detail) });
    } catch {
      /* denetim yazilamazsa iptal akisi durmaz */
    }
  };

  // Iptal istenmis (ya da AWX'in "zaten bitmis" dedigi) is hala AKTIF goruldu.
  const stillActive = async (rec, cur) => {
    rec.seenTicks += 1;
    if (rec.seenTicks < VERIFY_TICKS || rec.alarmed) return;
    rec.alarmed = true;
    const elapsed =
      rec.job.ageMinutes != null ? rec.job.ageMinutes + (nowMs - Date.parse(rec.requestedAt)) / 60000 : null;
    const msg = rec.alreadyTerminal
      ? `AWX iptal isteğine "zaten bitmiş" dedi (${rec.requestedAt}) ama iş ${rec.seenTicks} taramadır hâlâ ` +
        `'${cur.status || '?'}' — İPTAL EDİLMEDİ; iş AWX'te çalışmaya devam ediyor.`
      : `İptal istendi (${rec.requestedAt}) ve AWX kabul etti, ama iş ${rec.seenTicks} taramadır hâlâ ` +
        `'${cur.status || '?'}' — İPTAL İSTENDİ AMA DURMADI; iş AWX'te çalışmaya devam ediyor.`;
    console.error(
      `[LongJobCancel] ${cur.serverName} ${kindLabel(cur.kind)} #${cur.jobId}: iptal sonrasi hala aktif - DURMADI (${rec.seenTicks} tarama)`,
    );
    const teams = await notifyTeams(
      webhookUrl,
      notStoppedCard(cur, elapsed, cfg, { requestedAt: rec.requestedAt, ticks: rec.seenTicks, alreadyTerminal: rec.alreadyTerminal }),
      red,
    );
    doAudit('fail', {
      phase: 'verify',
      ...logFields(cur),
      status: cur.status,
      requestedAt: rec.requestedAt,
      awxSaidTerminal: !!rec.alreadyTerminal,
      message: msg,
    });
    pushLog({ ...logFields(cur), outcome: 'still_running', ok: false, message: msg, teams }, tickLog);
  };

  // 1) IPTAL SONRASI DOGRULAMA + TEMIZLIK (onceki tick'lerin kayitlari)
  if (!dryRun) {
    for (const k of [..._missingSeen.keys()]) if (byKey.has(k)) _missingSeen.delete(k);
    const gone = [];
    for (const [key, rec] of _done) {
      const cur = byKey.get(key);
      if (cur) await stillActive(rec, cur);
      else if (isComplete(rec.job.serverId, rec.job.kind)) gone.push(key);
      // aksi: sunucu/tur bu turda tam taranamadi -> BILINMIYOR; kayit korunur
    }
    for (const key of new Set([..._failed.keys(), ..._attempts.keys()])) {
      if (!byKey.has(key) && !_done.has(key) && completeForKey(key)) gone.push(key);
    }
    if (gone.length) {
      const states = await readJobStates(runner, gone, red);
      verify.asked = gone.length;
      verify.measured = states.size;
      verify.unmeasured = gone.length - states.size;
      for (const key of gone) {
        const st = states.get(key);
        if (!st) continue; // olculemedi -> kayit korunur, sonraki tur yeniden bakar
        const rec = _done.get(key);
        if (ACTIVE_STATUSES.has(st.status)) {
          // Listede yok ama AWX'te AKTIF: sayfa kaymasi. Bitti SAYILMAZ, dogrulama surer.
          _missingSeen.delete(key);
          if (rec) await stillActive(rec, { ...rec.job, status: st.status });
          continue;
        }
        if (st.status === 'missing') {
          // Tek bir 404 "silindi" kaniti DEGIL (gateway/yol tuhafligi olabilir; AWX calisan
          // isin silinmesine izin vermez): ikinci TAM taramada da yoksa silinmis sayilir.
          const n = (_missingSeen.get(key) || 0) + 1;
          _missingSeen.set(key, n);
          if (n < 2) continue;
        }
        const f = _failed.get(key);
        _missingSeen.delete(key);
        _done.delete(key);
        _failed.delete(key);
        _attempts.delete(key);
        const shown = st.status === 'missing' ? "AWX'te bulunamadı (silinmiş)" : `AWX durumu '${st.status}'`;
        if (rec && !rec.alreadyTerminal) {
          const canceled = st.status === 'canceled';
          pushLog(
            {
              ...logFields(rec.job),
              outcome: canceled ? 'stopped' : 'finished',
              ok: true,
              awxStatus: st.status,
              message: canceled
                ? rec.alarmed
                  ? `İş sonunda durdu (${shown}; daha önce "durmadı" alarmı verilmişti).`
                  : `İptal doğrulandı: ${shown}.`
                : `İş iptalle değil kendiliğinden bitti (${shown}) — iptal isteğinin etkisi doğrulanamadı.`,
            },
            tickLog,
          );
        } else if (f && f.job) {
          pushLog(
            {
              ...logFields(f.job),
              outcome: 'finished',
              ok: true,
              awxStatus: st.status,
              message: `Daha önce İPTAL EDİLEMEYEN iş artık AWX'te aktif değil (${shown}).`,
            },
            tickLog,
          );
        }
      }
    }
  }

  // 1b) IPTAL TOKEN'I DEGISTI MI (coklu Portal ornegi): token baska bir ornekte kaydedilip/
  // silinmis olabilir; o ornegin resetFailuresForServer'i BU ornegin belleginde calismaz.
  // Kayit imzasi degisen sunucuda iptal edilemeyen isler yeniden denenir ("Kaydet -> yeniden
  // denenir" sozu her ornekte tutulsun). Okunamazsa dokunulmaz.
  // OKUNAMADI -> OKUNDU gecisi de degisimdir: kayit okunamadigi icin iptali DENENMEYEN isler
  // (_storeUnreadableKeys; token'li ya da token'siz her sunucu) yeniden denenir. GERCEKTEN
  // denenip kalici reddedilen isler (403/401) bu gecisle yeniden ACILMAZ (cift kart olmasin).
  // _tokenSigSeen okunamayan turlarda sifirlanmaz: aradaki gercek degisim yine yakalanir.
  if (!dryRun) {
    let sigs = null;
    try {
      sigs = await tokenStore.signatures(db);
    } catch {
      sigs = null;
    }
    if (sigs) {
      if (_tokenSigSeen) {
        const ids = new Set([...sigs.keys(), ..._tokenSigSeen.keys()]);
        for (const id of ids) if ((sigs.get(id) || null) !== (_tokenSigSeen.get(id) || null)) resetFailuresForServer(id);
      }
      for (const key of _storeUnreadableKeys) {
        _failed.delete(key);
        _attempts.delete(key);
      }
      _storeUnreadableKeys.clear();
      _tokenSigSeen = new Map(sigs);
    }
  }

  // 2) KARARLAR
  const listedWorkflows = new Set(
    jobs
      .filter((j) => normKind(j.kind) === 'workflow' && cfg.enabled && isListed(cfg, j))
      .map((j) => `${j.serverId}:${j.jobId}`),
  );
  const entries = [];
  for (const job of jobs) {
    const key = jobKey(job);
    const entry = baseEntry(job, nowMs);
    // Iptali istenmis is: yapilandirma sonradan degisse de dogrulama durumu gosterilir.
    const rec = _done.get(key);
    if (rec) {
      if (rec.alarmed) {
        entries.push({
          ...entry,
          decision: 'still_running',
          reason: rec.alreadyTerminal
            ? `İPTAL EDİLMEDİ: AWX ${rec.requestedAt} tarihinde "zaten bitmiş" dedi ama iş ${rec.seenTicks} taramadır hâlâ '${job.status || '?'}'`
            : `İPTAL İSTENDİ AMA DURMADI: ${rec.requestedAt} tarihinde istendi, ${rec.seenTicks} taramadır hâlâ '${job.status || '?'}'`,
        });
      } else if (rec.alreadyTerminal) {
        entries.push({
          ...entry,
          decision: 'already_terminal',
          reason: `AWX işi zaten bitmiş bildirdi (${rec.requestedAt}); sonraki taramada doğrulanacak`,
        });
      } else {
        entries.push({
          ...entry,
          decision: 'cancel_requested',
          reason: `İptal istendi (${rec.requestedAt}); sonraki taramada doğrulanacak`,
        });
      }
      continue;
    }
    const d = shouldCancel(cfg, job, nowMs);
    if (!d.cancel) {
      let reason =
        d.decision === 'below_threshold'
          ? `Eşik altında (${Math.floor(d.elapsedMinutes)} dk < ${cfg.thresholdMinutes} dk${d.basis === 'created' ? ', kuyruk süresi' : ''})`
          : REASON_TEXT[d.decision] || d.reason;
      if (
        d.decision === 'not_listed' &&
        job.parentWorkflowJobId &&
        listedWorkflows.has(`${job.serverId}:${job.parentWorkflowJobId}`)
      ) {
        reason =
          `İzin listesinde değil — doğrudan iptal edilmez; AMA üst workflow #${job.parentWorkflowJobId} izin listesinde: ` +
          'o iptal edilirse AWX bu alt işi de keser';
      }
      entries.push({ ...entry, decision: d.decision, reason });
      continue;
    }
    const f = _failed.get(key);
    if (f) {
      entries.push({
        ...entry,
        decision: 'cancel_failed',
        reason:
          `İPTAL EDİLEMEDİ${f.httpStatus ? ` (AWX ${f.httpStatus})` : ''}: ${f.message}` +
          (f.hint ? ` — ${f.hint}` : '') +
          " — tekrar denenmiyor; iş son taramada AWX'te hâlâ aktif",
      });
      continue;
    }
    const wfNote = normKind(job.kind) === 'workflow' ? ' (AWX workflow’un çalışan alt işlerini de keser)' : '';
    if (dryRun) {
      // Kuru calistirma token'i COZMEZ; gercek taramada hangi kimlikle (ya da hic) denenecegini soyler.
      let authNote = '';
      try {
        const da = await tokenStore.describeCancelAuth(db, job.serverId, { server: serverInfo(runner, job.serverId) });
        if (da.state === 'token') authNote = ` — iptal ${da.owner} token'ıyla yapılır`;
        else if (da.state === 'mismatch') {
          authNote = ` — AMA iptal token'ı (${da.owner || '?'}) bu AWX adresi için kaydedilmedi: gerçek taramada iptal DENENMEZ`;
        } else if (da.state === 'unreadable') {
          authNote = ' — AMA iptal token kaydı OKUNAMADI: gerçek taramada iptal DENENMEZ (ölçülemedi)';
        }
      } catch {
        authNote = '';
      }
      entries.push({
        ...entry,
        decision: 'would_cancel',
        reason:
          `Eşik aşıldı (${Math.floor(d.elapsedMinutes)} dk ≥ ${cfg.thresholdMinutes} dk${d.basis === 'created' ? ', kuyruk süresi' : ''}): ` +
          `gerçek taramada İPTAL EDİLİR${wfNote} (kuru çalıştırma — hiçbir şey iptal edilmedi)` +
          authNote,
      });
      continue;
    }

    const n = _attempts.get(key) || 0;
    _attempts.set(key, n + 1);
    let auth = null;
    try {
      auth = await cancelAuthFor(job.serverId);
      const viaToken = !!(auth && auth.via === 'cancel_token');
      const r = await runner.cancelJobOnServer(
        job.serverId,
        job.jobId,
        viaToken ? { kind: normKind(job.kind), authToken: auth.token, authOwner: auth.owner } : { kind: normKind(job.kind) },
      );
      const via = viaToken ? { via: 'cancel_token', tokenOwner: auth.owner } : { via: 'service' };
      const viaNote = viaToken ? `; ${viaPhrase(auth.owner)}` : '';
      if (r && r.alreadyTerminal) {
        // Yine de dogrulanir: is sonraki taramalarda hala aktif gorunurse alarm (vekil 405'i).
        _done.set(key, { job: entry, requestedAt: iso(), seenTicks: 0, alarmed: false, alreadyTerminal: true });
        const how = r.stateVerified
          ? `AWX durumu '${r.awxStatus}'`
          : `AWX 405/409; işin durumu okunamadı${r.stateError ? ` (${red(r.stateError)})` : ''} — sonraki taramalarda doğrulanacak`;
        entries.push({
          ...entry,
          decision: 'already_terminal',
          reason: `Zaten bitmiş (${how}) — iş kendisi bitmiş ya da başka bir Portal örneği iptal etmiş olabilir; alarm yok`,
        });
        results.push({ job, ok: true, skipped: 'zaten bitmis' });
        pushLog({ ...logFields(job), outcome: 'already_terminal', ok: true, message: `AWX: iş zaten bitmiş (${how})` }, tickLog);
        continue;
      }
      _done.set(key, { job: entry, requestedAt: iso(), seenTicks: 0, alarmed: false, alreadyTerminal: false });
      console.warn(
        `[LongJobCancel] ${job.serverName} ${kindLabel(job.kind)} #${job.jobId} (${job.jobName}) ${Math.floor(d.elapsedMinutes)} dk -> IPTAL ISTENDI (AWX kabul etti; sonraki taramada dogrulanacak)` +
          (viaToken ? ` - iptal token'i sahibi ${auth.owner}` : ''),
      );
      doAudit('ok', {
        phase: 'cancel',
        ...logFields(job),
        executer: job.executer,
        status: job.status,
        elapsedMinutes: Math.floor(d.elapsedMinutes),
        basis: d.basis,
        thresholdMinutes: cfg.thresholdMinutes,
        ...via,
        credential: viaToken ? viaText(auth.owner) : SERVICE_VIA_TEXT,
        ...(normKind(job.kind) === 'workflow' ? { childJobsCanceledToo: true, note: WORKFLOW_CHILDREN_NOTE } : {}),
      });
      const teams = await notifyTeams(webhookUrl, teamsCard(job, d.elapsedMinutes, cfg, via), red);
      entries.push({
        ...entry,
        decision: 'cancel_requested',
        reason: `İptal istendi (AWX kabul etti)${wfNote}${viaNote}; sonraki taramada doğrulanacak`,
      });
      results.push({ job, ok: true, elapsedMinutes: d.elapsedMinutes, ...via });
      pushLog(
        { ...logFields(job), outcome: 'requested', ok: true, message: `İptal istendi (AWX 202)${wfNote}${viaNote}`, teams, ...via },
        tickLog,
      );
    } catch (e) {
      // KALICI RED TEKRAR DENENMEZ (403 + is aktif: yetki bir sonraki turda belirmez; PR #108
      // `tooLarge` ile ayni sinif). Gecici hatalar en fazla MAX_ATTEMPTS kez denenir.
      // Her iki durumda da basarisizlik SESSIZ DEGIL: denetim 'fail' + durum kaydi; son
      // denemede (ya da kalici redde) Teams "IPTAL EDILEMEDI" karti.
      // IPTAL TOKEN'I: 401 -> "IPTAL TOKEN'I GECERSIZ" (kalici; kayit + durum isaretlenir);
      // cozulemeyen / adresi degismis token da kalici. Yeni token kaydedilince (ya da silinince)
      // yeniden denenir. Token KAYDI okunamadiysa iptal DENENMEDI: gecici (kayit okununca yeniden).
      const viaToken = !!(auth && auth.via === 'cancel_token');
      const tokenUndecryptable = !!(e && e.tokenUndecryptable);
      const tokenServerMismatch = !!(e && e.tokenServerMismatch);
      const tokenStoreUnreadable = !!(e && e.tokenStoreUnreadable);
      const tokenInvalid = !!(e && e.cancelTokenInvalid) || (viaToken && e && e.status === 401);
      const tokenOwner = viaToken ? auth.owner : tokenUndecryptable || tokenServerMismatch ? e.owner || null : null;
      const via =
        viaToken || tokenUndecryptable || tokenServerMismatch
          ? { via: 'cancel_token', tokenOwner }
          : tokenStoreUnreadable
            ? { via: 'unknown', tokenOwner: null }
            : { via: 'service' };
      const permanent = !!(e && e.permanent) || tokenInvalid || tokenUndecryptable || tokenServerMismatch;
      if (tokenStoreUnreadable) _storeUnreadableKeys.add(key);
      else _storeUnreadableKeys.delete(key);
      const exhausted = permanent || n + 1 >= MAX_ATTEMPTS;
      const msg = red((e && e.message) || String(e));
      const httpStatus = (e && e.status) || null;
      const info = {
        reason: msg,
        permanent,
        httpStatus,
        attempts: n + 1,
        jobState: (e && e.jobState) || null,
        awxStatus: (e && e.awxStatus) || null,
        portalUser: (e && e.portalUser) || null,
        createdByPortal: e && typeof e.createdByPortal === 'boolean' ? e.createdByPortal : null,
        tokenInvalid,
        tokenUndecryptable,
        tokenServerMismatch,
        tokenStoreUnreadable,
        ...via,
      };
      const hint = shortHint(info);
      if (tokenInvalid) {
        await tokenStore.markInvalid(db, job.serverId, {
          tokenEnc: auth && auth.entry ? auth.entry.tokenEnc : null,
          httpStatus: 401,
          message: msg,
        });
      }
      if (exhausted) {
        _attempts.set(key, MAX_ATTEMPTS); // bir daha denenmesin
        _failed.set(key, { job: entry, message: msg, permanent, httpStatus, jobState: info.jobState, hint, at: iso() });
      }
      console.error(
        `[LongJobCancel] ${job.serverName} ${kindLabel(job.kind)} #${job.jobId} IPTAL EDILEMEDI ` +
          `(deneme ${n + 1}/${MAX_ATTEMPTS}${permanent ? ', KALICI' : ''}; is durumu: ${info.jobState || 'son taramada aktif'}` +
          `${via.via === 'cancel_token' ? `; iptal token'i sahibi ${tokenOwner || '?'}` : ''}` +
          `${tokenInvalid ? '; IPTAL TOKENI GECERSIZ' : ''}${tokenUndecryptable ? '; IPTAL TOKENI COZULEMEDI' : ''}` +
          `${tokenServerMismatch ? '; IPTAL TOKENI BU AWX ADRESI ICIN KAYDEDILMEDI' : ''}` +
          `${tokenStoreUnreadable ? '; IPTAL TOKEN KAYDI OKUNAMADI, iptal denenmedi' : ''}):`,
        msg,
      );
      doAudit('fail', {
        phase: 'cancel',
        ...logFields(job),
        executer: job.executer,
        status: job.status,
        elapsedMinutes: Math.floor(d.elapsedMinutes),
        thresholdMinutes: cfg.thresholdMinutes,
        httpStatus,
        permanent,
        attempt: n + 1,
        jobState: info.jobState,
        createdByPortal: info.createdByPortal,
        ...via,
        credential: tokenStoreUnreadable
          ? 'İptal denenmedi: iptal token kaydı okunamadı (kimlik ölçülemedi)'
          : tokenServerMismatch
            ? `İptal denenmedi: ${tokenOwner || '?'} token'ı bu AWX adresi için kaydedilmedi`
            : tokenUndecryptable
              ? `İptal denenmedi: ${tokenOwner || '?'} token'ı çözülemedi`
              : via.via === 'cancel_token'
                ? `İptal ${tokenOwner || '?'} token'ıyla denendi`
                : "İptal Portal'ın AWX servis kullanıcısıyla denendi",
        ...(tokenInvalid ? { tokenInvalid: true } : {}),
        ...(tokenUndecryptable ? { tokenUndecryptable: true } : {}),
        ...(tokenServerMismatch ? { tokenServerMismatch: true } : {}),
        ...(tokenStoreUnreadable ? { tokenStoreUnreadable: true } : {}),
        error: msg,
      });
      let teams = null;
      if (exhausted) {
        teams = await notifyTeams(webhookUrl, failureCard(job, d.elapsedMinutes, cfg, info), red);
      }
      entries.push({
        ...entry,
        decision: 'cancel_failed',
        reason:
          `İPTAL EDİLEMEDİ${httpStatus ? ` (AWX ${httpStatus})` : ''}: ${msg}` +
          (hint ? ` — ${hint}` : '') +
          (exhausted ? ' — tekrar denenmiyor' : ` — tekrar denenecek (${n + 1}/${MAX_ATTEMPTS})`),
      });
      results.push({ job, ok: false, error: msg, permanent, ...via });
      pushLog(
        {
          ...logFields(job),
          outcome: tokenInvalid ? 'token_invalid' : 'failed',
          ok: false,
          message: msg,
          permanent,
          httpStatus,
          attempt: n + 1,
          teams,
          ...via,
        },
        tickLog,
      );
    }
  }

  // 3) TARAMA SAGLIGI (yalniz gercek tick; kuru calistirma sayaclara dokunmaz)
  if (!dryRun && servers) await scanHealthStep(cfg, servers, { webhookUrl, red, doAudit, tickLog });

  // 4) OZET
  entries.forEach((e) => {
    e.problem = PROBLEM_DECISIONS.has(e.decision);
  });
  entries.sort((a, b) => decisionRank(a) - decisionRank(b) || (b.ageMinutes || 0) - (a.ageMinutes || 0));
  const counts = {};
  for (const e of entries) counts[e.decision] = (counts[e.decision] || 0) + 1;
  const st = getConfigState();
  const summary = {
    at: iso(t0),
    durationMs: Date.now() - t0,
    dryRun,
    config: cfgView(cfg),
    configError: st.configError,
    usingLastGoodConfig: st.usingLastGoodConfig,
    servers: servers
      ? servers.map((s) => ({
          serverId: s.serverId,
          serverName: s.serverName,
          ok: !!s.ok,
          error: s.error ? red(s.error) : null,
          running: s.running || 0,
          queued: s.queued || 0,
          truncated: !!s.truncated,
          kinds: Object.fromEntries(
            Object.entries(s.kinds || {}).map(([k, v]) => [
              k,
              { ok: !!v.ok, error: v.error ? red(v.error) : null, count: v.count || 0, pages: v.pages || 0, truncated: !!v.truncated },
            ]),
          ),
        }))
      : null,
    verify,
    scanHealth: scanHealthView(),
    jobsTotal: entries.length,
    jobs: entries.slice(0, STATUS_JOBS_MAX),
    counts,
    attempts: tickLog,
  };
  if (dryRun) _lastDryRun = summary;
  else _lastTick = summary;
  return { summary, results };
}

/** Watcher tick'i ve kuru calistirma: tarama sonucunu ({jobs, servers}) isler, ozeti doner. */
async function runCycle(scan, opts = {}) {
  return (await _runCycle(scan, opts)).summary;
}

/**
 * Geriye uyum: is listesiyle cagrilir, deneme sonuclarini doner.
 * @returns {Promise<Array<{job, ok, error?, skipped?, permanent?}>>}
 */
async function processJobs(jobs, opts = {}) {
  return (await _runCycle({ jobs: jobs || [] }, opts)).results;
}

/** Watcher AWX'i taramadan donduyse (kapali / liste bos / tarama hatasi) durum yine yazilir. */
function recordSkippedTick(reason) {
  const st = getConfigState();
  _lastTick = {
    at: iso(),
    durationMs: 0,
    dryRun: false,
    skipped: genericRedact(reason),
    config: cfgView(_lastGood),
    configError: st.configError,
    usingLastGoodConfig: st.usingLastGoodConfig,
    servers: null,
    scanHealth: scanHealthView(),
    jobsTotal: 0,
    jobs: [],
    counts: {},
    attempts: [],
  };
}

/**
 * Watcher: onceki tarama hala suruyor (in-flight) ve ust uste `skips` tick atlandi. Tarama
 * BITMIYORSA hicbir is iptal edilmez — bu da SESSIZ bir ariza: tarama basina TEK Teams
 * karti + denetim 'fail' (phase 'watcher') + durum kaydi.
 */
async function reportWatcherStuck({ startedAt, skips, intervalSeconds = 300, webhookUrl, audit, runner } = {}) {
  if (!startedAt || _stuckAlertFor === startedAt) return null;
  _stuckAlertFor = startedAt;
  const red = makeRedactor(runner);
  const msg =
    `Uzun süren iş taraması ${startedAt} tarihinden beri bitmedi; ${skips} tarama atlandı — ` +
    'bu sürede hiçbir iş iptal edilmiyor (OTOMATİK İPTAL ÇALIŞMIYOR).';
  console.error(`[LongJobCancel] tarama bitmiyor (baslangic ${startedAt}, ${skips} tick atlandi) - otomatik iptal CALISMIYOR`);
  const teams = await notifyTeams(webhookUrl, watcherStuckCard(startedAt, skips, intervalSeconds), red);
  try {
    if (audit) {
      audit('awx_long_job_cancel', {
        result: 'fail',
        detail: JSON.stringify({ phase: 'watcher', startedAt, skippedTicks: skips, message: msg }),
      });
    }
  } catch {
    /* denetim yazilamazsa alarm yine durumda gorunur */
  }
  pushLog({ outcome: 'watcher_stuck', ok: false, message: msg, teams });
  return teams;
}

/**
 * Dogrulamasi bekleyen kayit var mi? (otomatik iptal kapatilsa da alarm yolu calismali)
 * "Zaten bitmis" (alreadyTerminal) kayitlari da dogrulanir: vekil 405'i is calisirken gelebilir.
 */
function hasOpenWork() {
  return _done.size > 0;
}

function getStatus() {
  const st = getConfigState();
  let awaitingVerify = 0;
  let stillRunning = 0;
  for (const rec of _done.values()) {
    if (rec.alarmed) stillRunning++;
    else awaitingVerify++;
  }
  const scanHealth = scanHealthView();
  // Iptal token'lari: yalniz "tanimli / sahip / son dogrulama / GECERSIZ mi" (DEGER YOK).
  const tv = tokenStore.statusView();
  const nameOf = (id) => {
    const s = _lastTick && Array.isArray(_lastTick.servers) ? _lastTick.servers.find((x) => Number(x.serverId) === id) : null;
    return (s && s.serverName) || `sunucu ${id}`;
  };
  const cancelTokens = {
    measured: tv.measured,
    readError: tv.readError,
    tokens: tv.tokens.map((t) => ({ ...t, serverName: nameOf(t.serverId) })),
  };
  return {
    instance: `${os.hostname()}:${process.pid}`,
    now: iso(),
    config: cfgView(_lastGood),
    configError: st.configError,
    usingLastGoodConfig: st.usingLastGoodConfig,
    lastTick: _lastTick,
    lastDryRun: _lastDryRun,
    attempts: _attemptLog.slice().reverse(),
    scanHealth,
    cancelTokens,
    open: {
      awaitingVerify,
      stillRunning,
      failed: _failed.size,
      scanFailing: scanHealth.filter((h) => h.alerted).length,
      tokenInvalid: cancelTokens.tokens.filter((t) => t.invalid).length,
    },
    limits: {
      maxAttempts: MAX_ATTEMPTS,
      verifyTicks: VERIFY_TICKS,
      scanFailTicks: SCAN_FAIL_TICKS,
      attemptLogMax: ATTEMPT_LOG_MAX,
    },
  };
}

// ── Yetki on kontrolu ────────────────────────────────────────────────────────
const NO_ADMIN_MESSAGE =
  "Portal bu template'in BAŞKALARININ başlattığı işlerini iptal EDEMEZ (AWX'te Portal kullanıcısına bu " +
  "template'te Admin rolü gerekir; Execute yetmez). Portal'ın kendi başlattığı işler iptal edilebilir.";

function withDeadline(p, ms, label) {
  let t = null;
  const limit = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label || 'AWX'} ${Math.round(ms / 1000)} sn içinde yanıt vermedi`)), ms);
    if (typeof t.unref === 'function') t.unref();
  });
  return Promise.race([Promise.resolve(p), limit]).finally(() => clearTimeout(t));
}

const tokenNoAdminMessage = (owner) =>
  `İptal token'ının sahibi ${owner || '?'} bu template'te Admin değil: Portal bu template'in BAŞKALARININ başlattığı ` +
  `işlerini iptal EDEMEZ (AWX'te ${owner || 'token sahibi'} kullanıcısına bu template'te Admin rolü gerekir; Execute yetmez). ` +
  `${owner || 'Token sahibi'} kullanıcısının kendi başlattığı işler iptal edilebilir.`;

/**
 * @returns {Promise<Array<{serverId, templateId, kind, name, state: 'admin'|'no_admin'|'unknown',
 *   tokenScope: 'write'|'unknown', via: string, tokenOwner, message}>>}
 *   (via: 'service' | 'cancel_token' | 'unknown' - 'unknown' = token kaydi okunamadi)
 * 'unknown' = OLCULEMEDI (AWX okunamadi ya da alan yok) — 'no_admin' ile KARISTIRILMAZ.
 * 'admin' YALNIZ template Admin rolunu soyler: token kapsami ayri (`tokenScope`) yazilir;
 * statik/OAuth2 token'da 'unknown' -> mesaj "token kapsami OLCULEMEDI" der, "iptal edebilir" DEMEZ.
 *
 * `cancelAuth(serverId)` (rotalar verir; tokenStore.getCancelAuth): sunucuda IPTAL TOKEN'I
 * tanimliysa yetki o token'in SAHIBINE gore olculur (otomatik iptal o token'la yapilir).
 * Verilmezse eski davranis (servis kullanicisi).
 */
async function checkPermissions(templates, { runner, deadlineMs = PERMISSION_DEADLINE_MS, cancelAuth = null } = {}) {
  const red = makeRedactor(runner);
  const list = (Array.isArray(templates) ? templates : []).slice(0, PERMISSION_MAX_TEMPLATES);
  const authCache = new Map();
  const authFor = (serverId) => {
    const k = Number(serverId);
    if (!authCache.has(k)) {
      authCache.set(
        k,
        Promise.resolve()
          .then(() => (typeof cancelAuth === 'function' ? cancelAuth(k) : { via: 'service' }))
          .then(
            (a) => ({ a }),
            (e) => ({ e }),
          ),
      );
    }
    return authCache.get(k);
  };
  return Promise.all(
    list.map(async (t) => {
      const base = { serverId: t.serverId, templateId: t.templateId, kind: normKind(t.kind), name: t.name || '' };
      const ar = await authFor(t.serverId);
      if (ar.e && ar.e.tokenStoreUnreadable) {
        // Token KAYDI okunamadi: iptalin hangi kimlikle yapilacagi bile OLCULEMEDI (servis
        // kullanicisina gore olculmez - "Admin YOK" ile karismasin).
        return {
          ...base,
          state: 'unknown',
          tokenScope: 'unknown',
          via: 'unknown',
          tokenOwner: null,
          message:
            "Ölçülemedi: iptal token kaydı OKUNAMADI — iptalin hangi AWX kimliğiyle yapılacağı bilinmiyor (yetki VAR ya da YOK denemez): " +
            red((ar.e && ar.e.message) || String(ar.e)),
        };
      }
      if (ar.e) {
        // Token tanimli ama cozulemiyor / adresi degismis: yetki OLCULEMEDI (servis kullanicisina
        // dusulmez, token yeni adrese gonderilmez).
        return {
          ...base,
          state: 'unknown',
          tokenScope: 'unknown',
          via: 'cancel_token',
          tokenOwner: ar.e.owner || null,
          message: `Ölçülemedi (yetki VAR ya da YOK denemez): ${red((ar.e && ar.e.message) || String(ar.e))}`,
        };
      }
      const auth = ar.a || { via: 'service' };
      const viaToken = auth.via === 'cancel_token';
      const viaInfo = viaToken ? { via: 'cancel_token', tokenOwner: auth.owner || null } : { via: 'service', tokenOwner: null };
      try {
        if (!runner || typeof runner.getTemplateCapabilitiesOnServer !== 'function') {
          throw new Error('yetki okuyucu yok');
        }
        const cap = await withDeadline(
          viaToken
            ? runner.getTemplateCapabilitiesOnServer(t.serverId, t.templateId, base.kind, { authToken: auth.token })
            : runner.getTemplateCapabilitiesOnServer(t.serverId, t.templateId, base.kind),
          deadlineMs,
          'AWX',
        );
        const edit = cap && cap.capabilities ? cap.capabilities.edit : undefined;
        const name = base.name || (cap && cap.name) || '';
        const tokenScope = cap && cap.tokenScope === 'write' && !viaToken ? 'write' : 'unknown';
        if (edit === true) {
          return {
            ...base,
            name,
            state: 'admin',
            tokenScope,
            ...viaInfo,
            message: viaToken
              ? `Template Admin rolü var (iptal token'ının sahibi ${auth.owner || '?'}). Token kapsamı ÖLÇÜLEMEDİ ` +
                "(kişisel token): token 'read' kapsamlıysa iptal yine 403 alır."
              : tokenScope === 'write'
                ? "Template Admin rolü var; Portal token'ını kullanıcı/şifreyle kendisi alıyor (AWX varsayılanı 'write' " +
                  "kapsam). Portal bu template'in işlerini iptal edebilmeli; kesin sonuç ilk iptal denemesinde görülür."
                : "Template Admin rolü var. Token kapsamı ÖLÇÜLEMEDİ (statik ya da OAuth2 token): token 'read' kapsamlıysa " +
                  'iptal yine 403 alır. Süperkullanıcı durumu da ölçülmedi.',
          };
        }
        if (edit === false) {
          return {
            ...base,
            name,
            state: 'no_admin',
            tokenScope,
            ...viaInfo,
            message: viaToken ? tokenNoAdminMessage(auth.owner) : NO_ADMIN_MESSAGE,
          };
        }
        return {
          ...base,
          name,
          state: 'unknown',
          tokenScope,
          ...viaInfo,
          message: 'Ölçülemedi: AWX yanıtında user_capabilities.edit alanı yok (yetki VAR ya da YOK denemez).',
        };
      } catch (e) {
        const invalid = viaToken && e && e.status === 401;
        return {
          ...base,
          state: 'unknown',
          tokenScope: 'unknown',
          ...viaInfo,
          message: invalid
            ? `Ölçülemedi: İPTAL TOKEN'I GEÇERSİZ (AWX 401; token sahibi ${auth.owner || '?'}) — Admin ekranından yeni token girin.`
            : `Ölçülemedi (yetki VAR ya da YOK denemez): ${red((e && e.message) || String(e))}`,
        };
      }
    }),
  );
}

function permissionWarnings(perms) {
  const no = (perms || []).filter((p) => p.state === 'no_admin');
  const unk = (perms || []).filter((p) => p.state === 'unknown');
  const scopeUnk = (perms || []).filter((p) => p.state === 'admin' && p.tokenScope !== 'write');
  const out = [];
  const label = (p) =>
    (p.name || `#${p.templateId}`) + (p.via === 'cancel_token' ? ` (iptal token'ı sahibi ${p.tokenOwner || '?'})` : '');
  if (no.length) {
    out.push(
      `${no.length} template'te Portal BAŞKALARININ başlattığı işleri iptal EDEMEZ (AWX'te template Admin rolü yok): ` +
        no.map(label).join(', '),
    );
  }
  if (unk.length) {
    out.push(`${unk.length} template'te iptal yetkisi ölçülemedi: ` + unk.map(label).join(', '));
  }
  if (scopeUnk.length) {
    out.push(
      `${scopeUnk.length} template'te Admin rolü var ama token kapsamı ölçülemedi (statik/OAuth2 ya da kişisel token): "Admin ✓" ` +
        "iptalin kesin çalışacağını GÖSTERMEZ; token 'read' kapsamlıysa iptal 403 alır.",
    );
  }
  return out;
}

/** `?t=1:42:job,2:7:workflow` -> template listesi (adlar yapilandirmadan). */
function parseTemplateList(q, cfg) {
  const out = [];
  for (const part of String(q || '').split(',').slice(0, PERMISSION_MAX_TEMPLATES)) {
    const [sid, tid, kind] = part.split(':');
    const serverId = Number(sid);
    const templateId = Number(tid);
    if (!(Number.isInteger(serverId) && serverId > 0 && Number.isInteger(templateId) && templateId > 0)) continue;
    const k = normKind(kind);
    const known = ((cfg && cfg.templates) || []).find(
      (t) => t.serverId === serverId && t.templateId === templateId && t.kind === k,
    );
    out.push({ serverId, templateId, kind: k, name: known ? known.name : '' });
  }
  return out;
}

// ── HTTP uclari (yalniz Admin) ───────────────────────────────────────────────
function registerRoutes(app, deps = {}) {
  const { requireAuth, requireAdmin, getRunner, getDb, getWatcherInfo, audit } = deps;
  if (typeof requireAuth !== 'function' || typeof requireAdmin !== 'function') {
    throw new Error('registerRoutes: requireAuth ve requireAdmin zorunlu');
  }
  const teamsConfigured = () => !!(process.env.TEAMS_LONGJOB_WEBHOOK_URL || '').trim();
  const safeAudit = (req, action, opts) => {
    try {
      if (audit) audit(req, action, opts);
    } catch {
      /* denetim yazilamazsa uc yine yanit verir */
    }
  };
  const watcherInfo = () => {
    try {
      return getWatcherInfo ? getWatcherInfo() : null;
    } catch {
      return null;
    }
  };
  const fail = (res, err, code = 503) =>
    res.status(code).json({ ok: false, message: makeRedactor(safeRunner())((err && err.message) || String(err)) });
  const safeRunner = () => {
    try {
      return getRunner ? getRunner() : null;
    } catch {
      return null;
    }
  };
  // Yetki on kontrolu: sunucuda iptal token'i tanimliysa yetki onun SAHIBINE gore olculur.
  // Token kaydedildigi AWX ADRESINE baglidir: sunucu satiri (url, apiBase) karsilastirma icin verilir.
  const cancelAuthOf = (serverId) =>
    tokenStore.getCancelAuth(getDb(), serverId, { server: serverInfo(safeRunner(), serverId) });
  let dryRunInFlight = null;

  app.get('/api/ansible/longjob-cancel', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const config = await readConfig(getDb());
      res.json({ ok: true, config, ...getConfigState(), teamsConfigured: teamsConfigured() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.put('/api/ansible/longjob-cancel', requireAuth, requireAdmin, async (req, res) => {
    let cfg;
    try {
      cfg = await writeConfig(getDb(), req.body || {});
    } catch (err) {
      return fail(res, err);
    }
    safeAudit(req, 'awx_long_job_cancel_config', { result: 'ok', detail: JSON.stringify(cfg) });
    let permissions = [];
    let permissionsError = null;
    try {
      permissions = await checkPermissions(cfg.templates, { runner: getRunner(), cancelAuth: cancelAuthOf });
    } catch (err) {
      permissionsError = genericRedact(err.message);
    }
    res.json({ ok: true, config: cfg, permissions, permissionsError, warnings: permissionWarnings(permissions) });
  });

  app.get('/api/ansible/longjob-cancel/status', requireAuth, requireAdmin, (_req, res) => {
    res.json({ ok: true, ...getStatus(), watcher: watcherInfo(), teamsConfigured: teamsConfigured() });
  });

  // KURU CALISTIRMA: ayni tarama + ayni karar mantigi; HICBIR iptal (/cancel/) istegi
  // gonderilmez, Teams/denetim yazilmaz, durum makinesine (_attempts/_done/_failed/
  // _scanHealth) dokunulmaz. AWX token onbellegi bossa (kullanici/sifreli sunucu) tarama
  // icin kimlik dogrulama token'i alinabilir (POST /api/v2/tokens/); bu bir iptal DEGILDIR.
  app.post('/api/ansible/longjob-cancel/dry-run', requireAuth, requireAdmin, async (_req, res) => {
    try {
      if (!dryRunInFlight) {
        dryRunInFlight = (async () => {
          const runner = getRunner();
          const scan = await runner.listLongJobCandidatesAcrossServers();
          return runCycle(scan, { db: getDb(), runner, dryRun: true });
        })().finally(() => {
          dryRunInFlight = null;
        });
      }
      const result = await dryRunInFlight;
      res.json({ ok: true, result });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/ansible/longjob-cancel/permissions', requireAuth, requireAdmin, async (req, res) => {
    try {
      const cfg = await readConfig(getDb());
      const q = req.query && typeof req.query.t === 'string' ? req.query.t : '';
      const templates = q ? parseTemplateList(q, cfg) : cfg.templates;
      const permissions = await checkPermissions(templates, { runner: getRunner(), cancelAuth: cancelAuthOf });
      res.json({ ok: true, permissions, warnings: permissionWarnings(permissions) });
    } catch (err) {
      fail(res, err);
    }
  });

  // Ekranin template listesi: job + workflow template'leri (sunucu basina ok/error).
  app.get('/api/ansible/longjob-cancel/templates', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const runner = getRunner();
      const red = makeRedactor(runner);
      const servers = runner.getServers();
      const out = await Promise.all(
        servers.map(async (s) => {
          try {
            const templates = await withDeadline(runner.listCancelableTemplatesForServer(s), TEMPLATE_LIST_DEADLINE_MS, s.name);
            return { serverId: s.id, serverName: s.name, ok: true, templates };
          } catch (err) {
            return { serverId: s.id, serverName: s.name, ok: false, error: red(err.message), templates: [] };
          }
        }),
      );
      res.json({ ok: true, servers: out });
    } catch (err) {
      fail(res, err);
    }
  });

  // ── IPTAL TOKEN'I (AWX sunucusu basina; YALNIZ YAZILIR) ──────────────────────
  // Deger HICBIR yanita, denetime, loga girmez: yanitlar yalniz tanimli/degil, sahip,
  // kim/ne zaman ve son dogrulama sonucunu tasir. Kaydet/Sil/Dogrula denetime DEGERSIZ
  // yazilir ('awx_long_job_cancel_token'). Govde anahtari `token`: genel mutasyon
  // denetimi (auditMutations) onu zaten [REDACTED] yazar; deger URL'de TASINMAZ.
  const reqUser = (req) => {
    const u = (req && ((req.session && req.session.user) || req.user)) || {};
    return String(u.username || 'admin').slice(0, 150);
  };
  const serverOf = (id) => {
    const r = safeRunner();
    try {
      return r && typeof r.getServers === 'function' ? r.getServers().find((s) => Number(s.id) === Number(id)) || null : null;
    } catch {
      return null;
    }
  };
  const parseSid = (req) => {
    const n = Number(req.params && req.params.serverId);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const tokenAudit = (req, result, detail) =>
    safeAudit(req, 'awx_long_job_cancel_token', { result, detail: JSON.stringify(detail) });
  const verifierFor = (sid) => (tok) => {
    const r = getRunner();
    if (!r || typeof r.whoAmIWithTokenOnServer !== 'function') throw new Error('token doğrulayıcı yok');
    return withDeadline(r.whoAmIWithTokenOnServer(sid, tok), PERMISSION_DEADLINE_MS, 'AWX');
  };
  const errCode = (err) => (err && Number.isInteger(err.code) && err.code >= 400 && err.code < 600 ? err.code : 503);
  const tokenView = async (srv) => {
    const v = await tokenStore.publicView(getDb(), [{ id: srv.id, name: srv.name, url: srv.url, apiBase: srv.apiBase }]);
    return v.servers.find((x) => x.serverId === Number(srv.id)) || null;
  };

  app.get('/api/ansible/longjob-cancel/tokens', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const r = safeRunner();
      // url yalniz adres karsilastirmasi icindir; yanita yalniz origin + API tabani girer.
      const servers =
        r && typeof r.getServers === 'function'
          ? r.getServers().map((s) => ({ id: s.id, name: s.name, url: s.url, apiBase: s.apiBase }))
          : [];
      const view = await tokenStore.publicView(getDb(), servers);
      res.json({ ok: true, ...view });
    } catch (err) {
      fail(res, err);
    }
  });

  app.put('/api/ansible/longjob-cancel/tokens/:serverId', requireAuth, requireAdmin, async (req, res) => {
    const sid = parseSid(req);
    const srv = sid == null ? null : serverOf(sid);
    if (!srv) return res.status(404).json({ ok: false, message: 'AWX sunucusu bulunamadı.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const candidate = typeof body.token === 'string' ? body.token : null;
    try {
      const out = await tokenStore.saveToken(getDb(), {
        serverId: sid,
        server: srv,
        token: candidate,
        by: reqUser(req),
        verify: verifierFor(sid),
      });
      resetFailuresForServer(sid);
      tokenAudit(req, 'ok', {
        op: 'set',
        serverId: sid,
        serverName: srv.name,
        owner: out.owner,
        ownerIsSuperuser: out.ownerIsSuperuser,
        ...(out.replacedOwner ? { replacedOwner: out.replacedOwner } : {}),
      });
      res.json({ ok: true, owner: out.owner, ownerIsSuperuser: out.ownerIsSuperuser, token: await tokenView(srv) });
    } catch (err) {
      const message = makeRedactor(safeRunner())(
        tokenStore.redact((err && err.message) || String(err), candidate ? [candidate.trim(), candidate] : []),
      );
      tokenAudit(req, 'fail', {
        op: 'set',
        serverId: sid,
        serverName: srv.name,
        reason: (err && err.reason) || null,
        httpStatus: (err && err.httpStatus) || null,
        error: message,
      });
      res.status(errCode(err)).json({ ok: false, reason: (err && err.reason) || null, message });
    }
  });

  app.delete('/api/ansible/longjob-cancel/tokens/:serverId', requireAuth, requireAdmin, async (req, res) => {
    const sid = parseSid(req);
    if (sid == null) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu.' });
    const srv = serverOf(sid);
    const serverName = srv ? srv.name : `sunucu ${sid}`;
    try {
      const out = await tokenStore.deleteToken(getDb(), sid);
      resetFailuresForServer(sid);
      tokenAudit(req, 'ok', { op: 'delete', serverId: sid, serverName, owner: out.owner, deleted: out.deleted });
      res.json({ ok: true, deleted: out.deleted });
    } catch (err) {
      const message = makeRedactor(safeRunner())((err && err.message) || String(err));
      tokenAudit(req, 'fail', { op: 'delete', serverId: sid, serverName, error: message });
      res.status(errCode(err)).json({ ok: false, message });
    }
  });

  app.post('/api/ansible/longjob-cancel/tokens/:serverId/verify', requireAuth, requireAdmin, async (req, res) => {
    const sid = parseSid(req);
    const srv = sid == null ? null : serverOf(sid);
    if (!srv) return res.status(404).json({ ok: false, message: 'AWX sunucusu bulunamadı.' });
    try {
      const out = await tokenStore.verifyStored(getDb(), sid, { by: reqUser(req), verify: verifierFor(sid), server: srv });
      const result = { ...out, message: out.message ? makeRedactor(safeRunner())(out.message) : null };
      if (out.ok) resetFailuresForServer(sid);
      tokenAudit(req, out.ok ? 'ok' : 'fail', {
        op: 'verify',
        serverId: sid,
        serverName: srv.name,
        owner: out.owner,
        measured: out.measured,
        httpStatus: out.httpStatus,
        message: result.message,
      });
      res.json({ ok: true, result, token: await tokenView(srv) });
    } catch (err) {
      const message = makeRedactor(safeRunner())((err && err.message) || String(err));
      tokenAudit(req, 'fail', { op: 'verify', serverId: sid, serverName: srv.name, error: message });
      res.status(errCode(err)).json({ ok: false, message });
    }
  });
}

/**
 * Iptal token'i kaydedildi/silindi/dogrulandi: o sunucuda IPTAL EDILEMEYEN isler bir sonraki
 * taramada YENIDEN denenir (writeConfig'in tum sunucular icin yaptiginin sunucu basina hali).
 * Bekleyen dogrulamalara (_done) dokunulmaz.
 */
function resetFailuresForServer(serverId) {
  const prefix = `${Number(serverId)}:`;
  for (const k of [..._failed.keys()]) if (k.startsWith(prefix)) _failed.delete(k);
  for (const k of [..._attempts.keys()]) if (k.startsWith(prefix)) _attempts.delete(k);
  for (const k of [..._storeUnreadableKeys]) if (k.startsWith(prefix)) _storeUnreadableKeys.delete(k);
}

function _reset() {
  _cache = null;
  _cacheAt = 0;
  _lastGood = null;
  _lastGoodAt = null;
  _configError = null;
  _attempts.clear();
  _done.clear();
  _failed.clear();
  _scanHealth.clear();
  _missingSeen.clear();
  _attemptLog.length = 0;
  _lastTick = null;
  _lastDryRun = null;
  _stuckAlertFor = null;
  _tokenSigSeen = null;
  _storeUnreadableKeys.clear();
  tokenStore._reset();
}

/** Test yardimcisi: onbellek suresini doldurur (bir sonraki readConfig DB'ye gider). */
function _expireCache() {
  _cacheAt = 0;
  tokenStore._expireCache();
}

module.exports = {
  readConfig,
  writeConfig,
  normalizeConfig,
  shouldCancel,
  runCycle,
  processJobs,
  checkPermissions,
  permissionWarnings,
  parseTemplateList,
  registerRoutes,
  getStatus,
  getConfigState,
  recordSkippedTick,
  reportWatcherStuck,
  hasOpenWork,
  teamsCard,
  failureCard,
  notStoppedCard,
  resetFailuresForServer,
  CONFIG_NAME,
  MAX_ATTEMPTS,
  VERIFY_TICKS,
  SCAN_FAIL_TICKS,
  _reset,
  _expireCache,
};
