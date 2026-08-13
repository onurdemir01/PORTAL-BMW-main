// server/ansible/long-job-watcher.cjs — belirlenen sureden UZUN suredir calisan AWX
// job'lari icin Teams bildirimi gonderir (kullanici istegi: "30 dakikadan fazla uzayan
// bir job varsa bildirim gonder").
//
// TASARIM: server/smart/poller.cjs ile AYNI periyodik-tick deseni (setInterval + unref,
// tek zamanlayici TUM sunuculara bakar). Job listesi runner.cjs.listRunningJobsAcrossServers()
// ile gelir (sadece status=running, started alani olanlar).
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

const _notified = new Set(); // "serverId:jobId"

async function sendTeamsNotification(job, elapsedMinutes) {
  const { buildDispatcher } = require('../mcp/client.cjs');
  const cfg = getConfig();
  const startedLocal = new Date(job.started).toLocaleString('tr-TR');
  const body = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: 'attention',
            bleed: true,
            items: [{
              type: 'ColumnSet',
              columns: [
                { type: 'Column', width: 'auto', verticalContentAlignment: 'Center',
                  items: [{ type: 'TextBlock', text: '⏱️', size: 'ExtraLarge' }] },
                { type: 'Column', width: 'stretch', verticalContentAlignment: 'Center',
                  items: [
                    { type: 'TextBlock', text: 'Uzun Süredir Çalışan Ansible İşi', weight: 'Bolder', size: 'Large', wrap: true },
                    { type: 'TextBlock', text: `${job.serverName} sunucusu`, isSubtle: true, spacing: 'none', wrap: true },
                  ] },
              ],
            }],
          },
          { type: 'FactSet', spacing: 'Medium', facts: [
            { title: 'İş', value: job.jobName },
            { title: 'Job No', value: String(job.jobId) },
            { title: 'Başlangıç', value: startedLocal },
            { title: 'Geçen Süre', value: `${Math.floor(elapsedMinutes)} dakika` },
          ] },
          { type: 'TextBlock', text: `[AWX'te aç](${job.url})`, wrap: true, spacing: 'Medium' },
        ],
      },
    }],
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
    const text = await res.text().catch(() => '');
    throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function tick() {
  if (!isConfigured()) return;
  const cfg = getConfig();
  const runner = require('./runner.cjs');
  let jobs;
  try {
    jobs = await runner.listRunningJobsAcrossServers();
  } catch (e) {
    console.warn('[LongJobWatcher] calisan job listesi alinamadi:', e.message);
    return;
  }

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
      console.log(`[LongJobWatcher] ${job.serverName} job #${job.jobId} (${Math.floor(elapsedMinutes)} dk) icin Teams bildirimi gonderildi.`);
    } catch (e) {
      console.warn(`[LongJobWatcher] ${job.serverName} job #${job.jobId} icin bildirim gonderilemedi:`, e.message);
    }
  }

  // Artik calismayan job'lari Set'ten temizle (sinirsiz buyumesin).
  for (const key of _notified) {
    if (!stillRunningKeys.has(key)) _notified.delete(key);
  }
}

let _timer = null;

function startWatcher() {
  if (_timer) return; // zaten calisiyor (ör. hot-reload/test ortami)
  const cfg = getConfig();
  _timer = setInterval(() => { tick().catch((e) => console.warn('[LongJobWatcher] tick hatasi:', e.message)); }, cfg.pollIntervalSeconds * 1000);
  _timer.unref?.();
}

function stopWatcher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startWatcher, stopWatcher, tick, isConfigured, getConfig };
