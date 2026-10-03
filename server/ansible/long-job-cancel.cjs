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

function teamsCard(job, elapsedMinutes, cfg) {
  const wf = normKind(job.kind) === 'workflow';
  return cardShell(
    'attention',
    `⛔ Uzun süren ${kindLabel(job.kind)} Portal tarafından iptal edildi`,
    `${job.serverName} · ${job.jobName} · ${kindLabel(job.kind)} #${job.jobId} — ${Math.floor(elapsedMinutes)} dakikadır ` +
      `${job.started ? 'çalışıyordu' : 'kuyruktaydı'} (eşik ${cfg.thresholdMinutes} dk). AWX iptal isteğini kabul etti; ` +
      'durduğu bir sonraki taramada doğrulanır (durmazsa ayrı alarm gelir).' +
      (wf ? ` ${WORKFLOW_CHILDREN_NOTE}` : ''),
    [...jobFacts(job, elapsedMinutes, cfg), ...(wf ? [{ title: 'Alt işler', value: WORKFLOW_CHILDREN_NOTE }] : [])],
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

/** Durum satiri icin kisa neden. */
function shortHint(info) {
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
  if (info.httpStatus === 403 && info.jobState === 'active') what = forbiddenHint(info);
  else if (info.jobState === 'unknown') {
    what = "AWX arayüzünden işin durumunu kontrol edin; hâlâ çalışıyorsa elle iptal edin. " + RETRY_HINT;
  } else if (info.httpStatus === 405 || info.httpStatus === 409) {
    what =
      "İşi AWX arayüzünden elle iptal edin. AWX önündeki vekil/WAF/gateway'in iptal isteğini (POST .../cancel/) " +
      'AWX\'e ilettiğinden emin olun.';
  } else {
    what = 'İşi AWX arayüzünden elle iptal edin. Hata sürüyorsa AWX erişimini ve Portal kimlik bilgisini kontrol edin.';
  }
  const title =
    info.jobState === 'unknown'
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
      entries.push({
        ...entry,
        decision: 'would_cancel',
        reason:
          `Eşik aşıldı (${Math.floor(d.elapsedMinutes)} dk ≥ ${cfg.thresholdMinutes} dk${d.basis === 'created' ? ', kuyruk süresi' : ''}): ` +
          `gerçek taramada İPTAL EDİLİR${wfNote} (kuru çalıştırma — hiçbir şey iptal edilmedi)`,
      });
      continue;
    }

    const n = _attempts.get(key) || 0;
    _attempts.set(key, n + 1);
    try {
      const r = await runner.cancelJobOnServer(job.serverId, job.jobId, { kind: normKind(job.kind) });
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
        `[LongJobCancel] ${job.serverName} ${kindLabel(job.kind)} #${job.jobId} (${job.jobName}) ${Math.floor(d.elapsedMinutes)} dk -> IPTAL ISTENDI (AWX kabul etti; sonraki taramada dogrulanacak)`,
      );
      doAudit('ok', {
        phase: 'cancel',
        ...logFields(job),
        executer: job.executer,
        status: job.status,
        elapsedMinutes: Math.floor(d.elapsedMinutes),
        basis: d.basis,
        thresholdMinutes: cfg.thresholdMinutes,
        ...(normKind(job.kind) === 'workflow' ? { childJobsCanceledToo: true, note: WORKFLOW_CHILDREN_NOTE } : {}),
      });
      const teams = await notifyTeams(webhookUrl, teamsCard(job, d.elapsedMinutes, cfg), red);
      entries.push({
        ...entry,
        decision: 'cancel_requested',
        reason: `İptal istendi (AWX kabul etti)${wfNote}; sonraki taramada doğrulanacak`,
      });
      results.push({ job, ok: true, elapsedMinutes: d.elapsedMinutes });
      pushLog({ ...logFields(job), outcome: 'requested', ok: true, message: `İptal istendi (AWX 202)${wfNote}`, teams }, tickLog);
    } catch (e) {
      // KALICI RED TEKRAR DENENMEZ (403 + is aktif: yetki bir sonraki turda belirmez; PR #108
      // `tooLarge` ile ayni sinif). Gecici hatalar en fazla MAX_ATTEMPTS kez denenir.
      // Her iki durumda da basarisizlik SESSIZ DEGIL: denetim 'fail' + durum kaydi; son
      // denemede (ya da kalici redde) Teams "IPTAL EDILEMEDI" karti.
      const permanent = !!(e && e.permanent);
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
      };
      const hint = shortHint(info);
      if (exhausted) {
        _attempts.set(key, MAX_ATTEMPTS); // bir daha denenmesin
        _failed.set(key, { job: entry, message: msg, permanent, httpStatus, jobState: info.jobState, hint, at: iso() });
      }
      console.error(
        `[LongJobCancel] ${job.serverName} ${kindLabel(job.kind)} #${job.jobId} IPTAL EDILEMEDI ` +
          `(deneme ${n + 1}/${MAX_ATTEMPTS}${permanent ? ', KALICI' : ''}; is durumu: ${info.jobState || 'son taramada aktif'}):`,
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
      results.push({ job, ok: false, error: msg, permanent });
      pushLog(
        { ...logFields(job), outcome: 'failed', ok: false, message: msg, permanent, httpStatus, attempt: n + 1, teams },
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
    open: {
      awaitingVerify,
      stillRunning,
      failed: _failed.size,
      scanFailing: scanHealth.filter((h) => h.alerted).length,
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

/**
 * @returns {Promise<Array<{serverId, templateId, kind, name, state: 'admin'|'no_admin'|'unknown',
 *   tokenScope: 'write'|'unknown', message}>>}
 * 'unknown' = OLCULEMEDI (AWX okunamadi ya da alan yok) — 'no_admin' ile KARISTIRILMAZ.
 * 'admin' YALNIZ template Admin rolunu soyler: token kapsami ayri (`tokenScope`) yazilir;
 * statik/OAuth2 token'da 'unknown' -> mesaj "token kapsami OLCULEMEDI" der, "iptal edebilir" DEMEZ.
 */
async function checkPermissions(templates, { runner, deadlineMs = PERMISSION_DEADLINE_MS } = {}) {
  const red = makeRedactor(runner);
  const list = (Array.isArray(templates) ? templates : []).slice(0, PERMISSION_MAX_TEMPLATES);
  return Promise.all(
    list.map(async (t) => {
      const base = { serverId: t.serverId, templateId: t.templateId, kind: normKind(t.kind), name: t.name || '' };
      try {
        if (!runner || typeof runner.getTemplateCapabilitiesOnServer !== 'function') {
          throw new Error('yetki okuyucu yok');
        }
        const cap = await withDeadline(
          runner.getTemplateCapabilitiesOnServer(t.serverId, t.templateId, base.kind),
          deadlineMs,
          'AWX',
        );
        const edit = cap && cap.capabilities ? cap.capabilities.edit : undefined;
        const name = base.name || (cap && cap.name) || '';
        const tokenScope = cap && cap.tokenScope === 'write' ? 'write' : 'unknown';
        if (edit === true) {
          return {
            ...base,
            name,
            state: 'admin',
            tokenScope,
            message:
              tokenScope === 'write'
                ? "Template Admin rolü var; Portal token'ını kullanıcı/şifreyle kendisi alıyor (AWX varsayılanı 'write' " +
                  "kapsam). Portal bu template'in işlerini iptal edebilmeli; kesin sonuç ilk iptal denemesinde görülür."
                : "Template Admin rolü var. Token kapsamı ÖLÇÜLEMEDİ (statik ya da OAuth2 token): token 'read' kapsamlıysa " +
                  'iptal yine 403 alır. Süperkullanıcı durumu da ölçülmedi.',
          };
        }
        if (edit === false) return { ...base, name, state: 'no_admin', tokenScope, message: NO_ADMIN_MESSAGE };
        return {
          ...base,
          name,
          state: 'unknown',
          tokenScope,
          message: 'Ölçülemedi: AWX yanıtında user_capabilities.edit alanı yok (yetki VAR ya da YOK denemez).',
        };
      } catch (e) {
        return {
          ...base,
          state: 'unknown',
          tokenScope: 'unknown',
          message: `Ölçülemedi (yetki VAR ya da YOK denemez): ${red((e && e.message) || String(e))}`,
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
  if (no.length) {
    out.push(
      `${no.length} template'te Portal BAŞKALARININ başlattığı işleri iptal EDEMEZ (AWX'te template Admin rolü yok): ` +
        no.map((p) => p.name || `#${p.templateId}`).join(', '),
    );
  }
  if (unk.length) {
    out.push(`${unk.length} template'te iptal yetkisi ölçülemedi: ` + unk.map((p) => p.name || `#${p.templateId}`).join(', '));
  }
  if (scopeUnk.length) {
    out.push(
      `${scopeUnk.length} template'te Admin rolü var ama token kapsamı ölçülemedi (statik/OAuth2 token): "Admin ✓" ` +
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
      permissions = await checkPermissions(cfg.templates, { runner: getRunner() });
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
      const permissions = await checkPermissions(templates, { runner: getRunner() });
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
}

/** Test yardimcisi: onbellek suresini doldurur (bir sonraki readConfig DB'ye gider). */
function _expireCache() {
  _cacheAt = 0;
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
  CONFIG_NAME,
  MAX_ATTEMPTS,
  VERIFY_TICKS,
  SCAN_FAIL_TICKS,
  _reset,
  _expireCache,
};
