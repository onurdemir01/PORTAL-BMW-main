// server/ansible/long-job-cancel.cjs — uzun suren AWX job'larini OTOMATIK IPTAL.
//
// Kullanici (2026-09-14): "Portal maestro'larda uzun suren job'lari kill etsin".
// Kararlar (kullanici): esik 60 dk; YALNIZCA Admin ekraninda secilen template'ler;
// mod: dogrudan iptal + Teams bildirimi.
//
// TASARIM: long-job-watcher'in tick'i (5 dk'da bir, tum AWX sunuculari) burada
// shouldCancel() ile sorar; evet ise runner.cancelJobOnServer() (POST
// /api/v2/jobs/<id>/cancel/) + Teams karti + Portal audit. Yapilandirma DB'de
// (portal_config_blobs 'longjob-cancel'), env DEGIL: Admin ekranindan hot degisir.
//
// GUVENLIK MODELI:
//   - Izin listesi BOS = hicbir sey iptal edilmez (varsayilan kapali).
//   - Eslesme (awxServerId, templateId) cifti uzerinden; template adi yalniz gosterim.
//   - Ayni job icin tek deneme (bellek-ici Set); AWX 405/409 donerse (zaten bitmis)
//     sessizce gecilir. Iptal istegi basarisizsa bir sonraki tick'te TEKRAR denenir
//     (Set'e girmez) - ama en fazla MAX_ATTEMPTS.
//   - "started" yoksa sure hesaplanamaz -> dokunulmaz.
'use strict';

const CONFIG_NAME = 'longjob-cancel';
const CACHE_TTL_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;

let _cache = null;
let _cacheAt = 0;

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
  return {
    enabled: cfg.enabled === true,
    thresholdMinutes: Math.max(5, Math.min(24 * 60, Number(cfg.thresholdMinutes) || 60)),
    templates: templates
      .map((t) => ({
        serverId: Number(t.serverId) || 0,
        templateId: Number(t.templateId) || 0,
        name: String(t.name || '').slice(0, 200),
      }))
      .filter((t) => t.serverId > 0 && t.templateId > 0),
  };
}

async function readConfig(db) {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
    const raw = rows?.[0]?.data;
    _cache = normalizeConfig(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    _cache = normalizeConfig(null);
  }
  _cacheAt = Date.now();
  return _cache;
}

async function writeConfig(db, body) {
  const cfg = normalizeConfig(body);
  const data = JSON.stringify(cfg);
  const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
  if (ex.rows.length) await db.query(`UPDATE portal_config_blobs SET data = $2 WHERE name = $1`, [CONFIG_NAME, data]);
  else await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [CONFIG_NAME, data]);
  _cache = cfg;
  _cacheAt = Date.now();
  return cfg;
}

/** Saf karar: bu job iptal edilmeli mi? (test edilebilir) */
function shouldCancel(cfg, job, nowMs = Date.now()) {
  if (!cfg || !cfg.enabled) return { cancel: false, reason: 'kapali' };
  if (!job || !job.started) return { cancel: false, reason: 'started yok' };
  const elapsedMinutes = (nowMs - new Date(job.started).getTime()) / 60000;
  if (!(elapsedMinutes >= cfg.thresholdMinutes)) return { cancel: false, reason: 'esik altinda', elapsedMinutes };
  const listed = cfg.templates.some(
    (t) => t.serverId === Number(job.serverId) && t.templateId === Number(job.templateId),
  );
  if (!listed) return { cancel: false, reason: 'izin listesinde degil', elapsedMinutes };
  return { cancel: true, elapsedMinutes };
}

const _attempts = new Map(); // "serverId:jobId" -> deneme sayisi
const _done = new Set(); // iptal edildi (bu process omrunde)

function teamsCard(job, elapsedMinutes, cfg) {
  const startedLocal = new Date(job.started).toLocaleString('tr-TR');
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
              style: 'attention',
              bleed: true,
              items: [
                { type: 'TextBlock', text: '⛔ Uzun süren job Portal tarafından iptal edildi', weight: 'Bolder', size: 'Large', wrap: true },
                {
                  type: 'TextBlock',
                  text: `${job.serverName} · ${job.jobName} · job #${job.jobId} — ${Math.floor(elapsedMinutes)} dakikadır çalışıyordu (eşik ${cfg.thresholdMinutes} dk).`,
                  wrap: true,
                },
              ],
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'AWX', value: job.serverName },
                { title: 'Job', value: `#${job.jobId} — ${job.jobName}` },
                { title: 'Başlatan', value: job.executer || '—' },
                { title: 'Başlangıç', value: startedLocal },
                { title: 'Süre', value: `${Math.floor(elapsedMinutes)} dk (eşik ${cfg.thresholdMinutes} dk)` },
                { title: 'Kural', value: 'Admin > Ansible Info > Uzun süren işleri iptal (izin listesindeki template)' },
              ],
            },
          ],
          actions: job.url ? [{ type: 'Action.OpenUrl', title: 'AWX’te aç', url: job.url }] : [],
        },
      },
    ],
  };
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

/**
 * Watcher tick'inden cagrilir: esigi asan + izin listesindeki job'lari iptal eder.
 * @returns {Promise<Array<{job, ok, error?}>>}
 */
async function processJobs(jobs, { db, runner, webhookUrl, audit } = {}) {
  const cfg = await readConfig(db);
  const results = [];
  const alive = new Set();
  for (const job of jobs || []) {
    const key = `${job.serverId}:${job.jobId}`;
    alive.add(key);
    const d = shouldCancel(cfg, job);
    if (!d.cancel) continue;
    if (_done.has(key)) continue;
    const n = _attempts.get(key) || 0;
    if (n >= MAX_ATTEMPTS) continue;
    _attempts.set(key, n + 1);
    try {
      const r = await runner.cancelJobOnServer(job.serverId, job.jobId);
      _done.add(key);
      if (r && r.alreadyTerminal) {
        results.push({ job, ok: true, skipped: 'zaten bitmis' });
        continue;
      }
      console.warn(`[LongJobCancel] ${job.serverName} job #${job.jobId} (${job.jobName}) ${Math.floor(d.elapsedMinutes)} dk -> IPTAL EDILDI`);
      try {
        if (audit) audit('awx_long_job_cancel', { result: 'ok', detail: JSON.stringify({ serverId: job.serverId, serverName: job.serverName, jobId: job.jobId, jobName: job.jobName, templateId: job.templateId, executer: job.executer, elapsedMinutes: Math.floor(d.elapsedMinutes), thresholdMinutes: cfg.thresholdMinutes }) });
      } catch { /* audit yoksa yoksay */ }
      try {
        await sendTeams(webhookUrl, teamsCard(job, d.elapsedMinutes, cfg));
      } catch (e) {
        console.warn('[LongJobCancel] Teams bildirimi gonderilemedi:', e.message);
      }
      results.push({ job, ok: true, elapsedMinutes: d.elapsedMinutes });
    } catch (e) {
      // KALICI RED TEKRAR DENENMEZ. Portalin AWX kullanicisinda `cancel` yetkisi
      // yoksa (403) bu bir sonraki turda BELIRMEZ; uc kez denemek hem bosuna hem
      // de logda "belki olur" gorunumu uretir. Uretimde tam bu yasandi: 8 × 403
      // + LongJobCancel'in tekrar denemeleri.
      // (PR #108'deki `tooLarge` reddiyle ayni sinif.)
      if (e && e.permanent) {
        _attempts.set(key, MAX_ATTEMPTS); // bir daha denenmesin
        console.warn(
          `[LongJobCancel] ${job.serverName} job #${job.jobId} iptal edilemedi — KALICI, tekrar denenmeyecek:`,
          e.message,
        );
      } else {
        console.warn(`[LongJobCancel] ${job.serverName} job #${job.jobId} iptal edilemedi (deneme ${n + 1}/${MAX_ATTEMPTS}):`, e.message);
      }
      results.push({ job, ok: false, error: e.message, permanent: !!(e && e.permanent) });
    }
  }
  for (const key of _done) if (!alive.has(key)) _done.delete(key);
  for (const key of _attempts.keys()) if (!alive.has(key)) _attempts.delete(key);
  return results;
}

function _reset() {
  _cache = null;
  _cacheAt = 0;
  _attempts.clear();
  _done.clear();
}

module.exports = { readConfig, writeConfig, normalizeConfig, shouldCancel, processJobs, teamsCard, CONFIG_NAME, _reset };
