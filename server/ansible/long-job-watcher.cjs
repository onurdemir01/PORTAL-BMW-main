// server/ansible/long-job-watcher.cjs — belirlenen sureden UZUN suredir calisan AWX
// job'lari icin Teams bildirimi gonderir (kullanici istegi: "30 dakikadan fazla uzayan
// bir job varsa bildirim gonder").
//
// TASARIM: server/smart/poller.cjs ile AYNI periyodik-tick deseni (setInterval + unref,
// tek zamanlayici TUM sunuculara bakar). Tarama runner.cjs.listLongJobCandidatesAcrossServers()
// ile gelir (job + workflow job, pending/waiting/running, en eski once, tum sayfalar,
// sunucu basina ok/error). Otomatik iptal + dogrulama long-job-cancel.cjs runCycle()'da;
// 30 dk bildirimi burada (yalniz calisan klasik job'lar, eski davranis).
//
// TEKRAR-BILDIRIM ONLEME: bellek-ici bir Set (serverId:jobId) — process yeniden
// baslarsa sifirlanir (kabul edilebilir: en kotu ihtimalle zaten uzun surmus bir is icin
// bir bildirim daha gider, DB tablosu acmaya degecek kadar kritik degil). Bir job artik
// "calisan" listesinde gorunmuyorsa (bitti/kayboldu) Set'ten cikarilir — boylece Set
// sinirsiz buyumez ve ayni job ID'si (AWX'te asla tekrar etmez ama savunmaci) tekrar
// calisirsa yeniden bildirebilir.
'use strict';

function getConfig() {
  return {
    webhookUrl: (process.env.TEAMS_LONGJOB_WEBHOOK_URL || '').trim(),
    thresholdMinutes: Number(process.env.TEAMS_LONGJOB_THRESHOLD_MINUTES || 30),
    pollIntervalSeconds: Number(process.env.TEAMS_LONGJOB_POLL_INTERVAL_SECONDS || 300),
  };
}

function isConfigured() {
  return !!getConfig().webhookUrl;
}

// Otomatik iptal (long-job-cancel.cjs) Teams webhook'u OLMASA DA calisir: bildirim
// yalnizca webhook varsa gider, iptal karari DB'deki izin listesine baglidir.
// readConfig DB hatasinda son gecerli yapilandirmayi doner (ve hatayi durum ekranina yazar).
async function cancelEnabled(db) {
  const cfg = await require('./long-job-cancel.cjs').readConfig(db || require('../db/index.cjs'));
  return cfg.enabled && cfg.templates.length > 0;
}

const _notified = new Set(); // "serverId:jobId"

async function sendTeamsNotification(job, elapsedMinutes) {
  const { buildDispatcher } = require('../mcp/client.cjs');
  const cfg = getConfig();
  const startedLocal = new Date(job.started).toLocaleString('tr-TR');
  const body = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'Container',
              style: 'attention',
              bleed: true,
              items: [
                {
                  type: 'ColumnSet',
                  columns: [
                    {
                      type: 'Column',
                      width: 'auto',
                      verticalContentAlignment: 'Center',
                      items: [{ type: 'TextBlock', text: '⏱️', size: 'ExtraLarge' }],
                    },
                    {
                      type: 'Column',
                      width: 'stretch',
                      verticalContentAlignment: 'Center',
                      items: [
                        {
                          type: 'TextBlock',
                          text: 'Uzun Süredir Çalışan Ansible İşi',
                          weight: 'Bolder',
                          size: 'Large',
                          wrap: true,
                        },
                        {
                          type: 'TextBlock',
                          text: `${job.serverName} sunucusu`,
                          isSubtle: true,
                          spacing: 'none',
                          wrap: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'FactSet',
              spacing: 'Medium',
              facts: [
                { title: 'İş', value: job.jobName },
                { title: 'Job No', value: String(job.jobId) },
                { title: 'Başlangıç', value: startedLocal },
                { title: 'Geçen Süre', value: `${Math.floor(elapsedMinutes)} dakika` },
              ],
            },
            { type: 'TextBlock', text: `[AWX'te aç](${job.url})`, wrap: true, spacing: 'Medium' },
          ],
        },
      },
    ],
  };

  const dispatcher = buildDispatcher(cfg.webhookUrl, 'teams-longjob');
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    dispatcher,
    signal: AbortSignal.timeout(15_000),
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
}

let _inFlight = false;
let _skipStreak = 0; // onceki tarama surerken ust uste atlanan tick sayisi
const STUCK_SKIPS = 3; // bu kadar tick (~15 dk) atlanirsa "tarama bitmiyor" alarmi
const _tickInfo = { startedAt: null, finishedAt: null, error: null };

const auditOf = (deps) =>
  deps.audit ||
  ((action, opts) => require('../audit/index.cjs').auditPortal(null, action, { username: 'system', ...opts }));

/**
 * Tek tarama. Ust uste binmez (onceki tarama surerken gelen tick atlanir ve loglanir):
 * yavas bir AWX tick'i 5 dk'yi asarsa ayni isi iki kez iptal etmeye/alarmlamaya calismayalim.
 * Tarama HIC bitmiyorsa (STUCK_SKIPS tick atlandi) bu da sessiz bir arizadir: Teams +
 * denetim + durum (long-job-cancel.reportWatcherStuck, tarama basina bir kez).
 * `deps` yalniz testler icin (db/runner/audit enjeksiyonu); uretimde bos gecer.
 */
async function tick(deps = {}) {
  if (_inFlight) {
    _skipStreak += 1;
    console.warn(`[LongJobWatcher] onceki tarama hala suruyor; bu tick atlandi (${_skipStreak} ust uste)`);
    if (_skipStreak >= STUCK_SKIPS) {
      try {
        await require('./long-job-cancel.cjs').reportWatcherStuck({
          startedAt: _tickInfo.startedAt,
          skips: _skipStreak,
          intervalSeconds: pollIntervalSeconds(),
          webhookUrl: getConfig().webhookUrl,
          audit: auditOf(deps),
          runner: deps.runner,
        });
      } catch (e) {
        console.error('[LongJobWatcher] tarama-bitmiyor alarmi verilemedi:', e && e.message);
      }
    }
    return { skipped: 'in-flight' };
  }
  _inFlight = true;
  _tickInfo.startedAt = new Date().toISOString();
  try {
    await tickInner(deps);
    _tickInfo.error = null;
  } catch (e) {
    _tickInfo.error = e && e.message ? e.message : String(e);
    throw e;
  } finally {
    _inFlight = false;
    _skipStreak = 0;
    _tickInfo.finishedAt = new Date().toISOString();
  }
  return { skipped: null };
}

/** Tarama TAMAMEN patladiysa: her sunucu "taranamadi" (complete:false) sayilir. */
function failedScanOf(runner, message) {
  let servers = [];
  try {
    servers = typeof runner.getServers === 'function' ? runner.getServers() : [];
  } catch {
    servers = [];
  }
  return {
    jobs: [],
    servers: servers.map((s) => ({
      serverId: s.id,
      serverName: s.name,
      ok: false,
      error: message,
      kinds: {},
      running: 0,
      queued: 0,
      truncated: false,
      complete: { job: false, workflow: false },
    })),
  };
}

async function tickInner(deps) {
  const db = deps.db || require('../db/index.cjs');
  const runner = deps.runner || require('./runner.cjs');
  const audit = auditOf(deps);
  const ljc = require('./long-job-cancel.cjs');
  const notify = isConfigured();
  const cfg = getConfig();
  // readConfig DB hatasinda ATMAZ: son gecerli yapilandirma (hic yoksa kapali) + durum
  // ekraninda "yapilandirma okunamadi" (eskiden burada sessizce false donuluyordu).
  const cancelCfg = await ljc.readConfig(db);
  const cancel = cancelCfg.enabled && cancelCfg.templates.length > 0;
  const verifying = ljc.hasOpenWork();
  if (!notify && !cancel && !verifying) {
    ljc.recordSkippedTick(
      cancelCfg.enabled
        ? 'Otomatik iptal AÇIK ama izin listesi BOŞ — hiçbir iş iptal edilmez; AWX taranmadı.'
        : 'Otomatik iptal KAPALI — AWX taranmadı.',
    );
    return;
  }

  let scan;
  try {
    scan = await runner.listLongJobCandidatesAcrossServers();
  } catch (e) {
    // Eskiden burada recordSkippedTick + return vardi: tarama hatasi YALNIZ durum ekranina
    // dusuyordu. Simdi her sunucu "taranamadi" sayilip runCycle'a verilir: dogrulama
    // kayitlari korunur (complete:false) ve tarama sagligi sayaci ilerler (Teams + denetim).
    const m = e && e.message ? e.message : String(e);
    console.error('[LongJobWatcher] AWX taramasi basarisiz:', m);
    scan = failedScanOf(runner, `AWX taraması başarısız: ${m}`);
  }

  // ONCE IPTAL + DOGRULAMA (izin listesindeki, esigi asan isler). Otomatik iptal kapali
  // olsa da cagrilir: durum ekrani kararlari ("kapali") gosterir ve daha once istenen
  // iptallerin dogrulamasi/alarmi surer. Ayni is icin "uzun suruyor" + "iptal edildi"
  // iki kart gidebilir (kabul edilebilir).
  try {
    await ljc.runCycle(scan, { db, runner, webhookUrl: cfg.webhookUrl, audit });
  } catch (e) {
    console.error('[LongJobCancel] islem hatasi:', e.message);
    ljc.recordSkippedTick(`İptal döngüsü hata verdi: ${e.message}`);
  }
  if (!notify) return;

  // 30 dk BILDIRIMI: yalniz CALISAN klasik job'lar (eski davranis; workflow'un ic
  // job'lari zaten bu listede oldugu icin workflow'a ayrica kart gonderilmez).
  const jobs = (scan.jobs || []).filter((j) => j.kind === 'job' && j.status === 'running' && j.started);
  const stillRunningKeys = new Set();
  for (const job of jobs) {
    const key = `${job.serverId}:${job.jobId}`;
    stillRunningKeys.add(key);
    const elapsedMinutes = (Date.now() - new Date(job.started).getTime()) / 60000;
    if (elapsedMinutes < cfg.thresholdMinutes) continue;
    if (_notified.has(key)) continue;
    try {
      await sendTeamsNotification(job, elapsedMinutes);
      _notified.add(key);
      console.log(
        `[LongJobWatcher] ${job.serverName} job #${job.jobId} (${Math.floor(elapsedMinutes)} dk) icin Teams bildirimi gonderildi.`,
      );
    } catch (e) {
      console.warn(
        `[LongJobWatcher] ${job.serverName} job #${job.jobId} icin bildirim gonderilemedi:`,
        e.message,
      );
    }
  }

  // Artik calismayan job'lari Set'ten temizle (sinirsiz buyumesin) — YALNIZ job listesi
  // tam taranan sunucularda; tarama hatasinda silmek ayni isi yeniden bildirirdi.
  const complete = new Set(
    (scan.servers || []).filter((s) => s.complete && s.complete.job).map((s) => Number(s.serverId)),
  );
  for (const key of _notified) {
    const sid = Number(key.split(':')[0]);
    if (!stillRunningKeys.has(key) && complete.has(sid)) _notified.delete(key);
  }
}

let _timer = null;
let _firstTimer = null;
const FIRST_TICK_DELAY_MS = 60 * 1000;

// (function bildirimi hoisting ile tick() icinden de cagrilabilir)
function pollIntervalSeconds() {
  // Gecersiz/cok kucuk deger setInterval'i milisaniyelik donguye cevirmesin.
  return Math.max(60, Number(getConfig().pollIntervalSeconds) || 300);
}

function startWatcher() {
  if (_timer) return; // zaten calisiyor (or. hot-reload/test ortami)
  const run = () => tick().catch((e) => console.warn('[LongJobWatcher] tick hatasi:', e.message));
  _timer = setInterval(run, pollIntervalSeconds() * 1000);
  _timer.unref?.();
  // Ilk tarama restart'tan 1 dk sonra: durum ekrani 5 dk bos kalmasin.
  _firstTimer = setTimeout(run, FIRST_TICK_DELAY_MS);
  _firstTimer.unref?.();
}

function stopWatcher() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_firstTimer) {
    clearTimeout(_firstTimer);
    _firstTimer = null;
  }
}

/** Durum ekrani: izleyici hic baslamadiysa bu da "sessiz" bir arizadir — gosterilir. */
function getWatcherInfo() {
  return {
    started: !!_timer,
    pollIntervalSeconds: pollIntervalSeconds(),
    inFlight: _inFlight,
    skippedWhileInFlight: _skipStreak,
    lastTickStartedAt: _tickInfo.startedAt,
    lastTickFinishedAt: _tickInfo.finishedAt,
    lastTickError: _tickInfo.error,
    notifyConfigured: isConfigured(),
  };
}

module.exports = { startWatcher, stopWatcher, tick, isConfigured, getConfig, cancelEnabled, getWatcherInfo };
