// server/logx/v2/jobs.cjs — LogX v2'nin tum Ansible job launch/poll islemleri icin ortak
// yardimci. Ham stdout ASLA parse edilmez — sonuc her zaman AWX'in `artifacts` alanindan
// (playbook'un son adimda `ansible.builtin.set_stats` ile yayinladigi `logx_result` JSON'u)
// okunur (bkz. plan dosyasi B-new-2).
'use strict';

const path = require('path');
const db = require('../../db/index.cjs');
const playbookRegistry = require('../../ansible/playbook-registry.cjs');
const runner = require('../../ansible/runner.cjs');
const audit = require('../audit.cjs');

const JOB_KEY_BY_TYPE = {
  legacy_discovery: 'logx_legacy_discovery',
  legacy_transfer: 'logx_legacy_transfer',
  ocp_namespace_discovery: 'logx_ocp_namespace_discovery',
  ocp_discover_fetch: 'logx_ocp_discover_fetch',
};

const TERMINAL_STATUSES = new Set(['successful', 'failed', 'error', 'canceled']);

function isAwx404Error(err) {
  return err?.status === 404 || /AWX HTTP 404/i.test(String(err?.message || ''));
}

// Template ID hangi AWX sunucusunda gercekten mevcut, hizlica bulur.
// Yanlis server secimi durumunda (ozellikle varsayilan id=1) 404'u otomatik telafi eder.
async function findServerIdsContainingTemplate(templateId, preferredServerId) {
  const targetId = Number(templateId);
  const servers = (runner.getServers?.() || []).filter((s) => s && (s.token || (s.user && s.password)));
  if (servers.length === 0) return [];

  const ordered = [...servers].sort((a, b) => {
    if (Number(a.id) === Number(preferredServerId)) return -1;
    if (Number(b.id) === Number(preferredServerId)) return 1;
    return Number(a.id) - Number(b.id);
  });

  const found = [];
  for (const server of ordered) {
    try {
      const templates = await runner.listTemplatesForServer(server);
      if (templates.some((t) => Number(t.id) === targetId)) {
        found.push(Number(server.id));
      }
    } catch {
      // Erisilemeyen bir AWX sunucusu tum akisi bozmasin.
    }
  }
  return found;
}

function extractLogxResultFromArtifacts(rawArtifacts) {
  const artifacts = rawArtifacts || {};

  // Preferred shape: artifacts.logx_result
  if (artifacts.logx_result && typeof artifacts.logx_result === 'object') {
    return artifacts.logx_result;
  }

  // Common AWX set_stats shape: artifacts.data.logx_result
  if (artifacts.data && artifacts.data.logx_result && typeof artifacts.data.logx_result === 'object') {
    return artifacts.data.logx_result;
  }

  // Some controller versions may nest stats payload under ansible_stats.data
  if (artifacts.ansible_stats && artifacts.ansible_stats.data && artifacts.ansible_stats.data.logx_result
      && typeof artifacts.ansible_stats.data.logx_result === 'object') {
    return artifacts.ansible_stats.data.logx_result;
  }

  // Last resort: tolerate stringified JSON payloads under known keys.
  for (const key of ['logx_result', 'logx_result_json']) {
    if (typeof artifacts[key] === 'string') {
      try {
        const parsed = JSON.parse(artifacts[key]);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // ignore invalid JSON
      }
    }
  }

  return null;
}

function summarizeArtifactKeys(rawArtifacts) {
  const artifacts = rawArtifacts || {};
  const top = Object.keys(artifacts);
  const dataKeys = artifacts.data && typeof artifacts.data === 'object' ? Object.keys(artifacts.data) : [];
  const statsDataKeys = artifacts.ansible_stats && artifacts.ansible_stats.data && typeof artifacts.ansible_stats.data === 'object'
    ? Object.keys(artifacts.ansible_stats.data)
    : [];

  return {
    top,
    data: dataKeys,
    ansibleStatsData: statsDataKeys,
  };
}

async function findTemplateOnServer(serverId, templateId) {
  const targetServerId = Number(serverId);
  const targetTemplateId = Number(templateId);
  const server = (runner.getServers?.() || []).find((s) => Number(s.id) === targetServerId);
  if (!server) return null;
  try {
    const templates = await runner.listTemplatesForServer(server);
    return templates.find((t) => Number(t.id) === targetTemplateId) || null;
  } catch {
    return null;
  }
}

async function assertTemplateMatchesRegistry(serverId, templateId, expectedPlaybookPath) {
  const expectedFile = path.basename(String(expectedPlaybookPath || '')).trim().toLowerCase();
  if (!expectedFile) return;

  const tpl = await findTemplateOnServer(serverId, templateId);
  if (!tpl) return; // Template metadata alinamazsa launch'i bloklamayalim.

  const actualFile = path.basename(String(tpl.playbook || '')).trim().toLowerCase();
  if (!actualFile) return;

  if (actualFile !== expectedFile) {
    throw Object.assign(
      new Error(
        `Playbook Registry eşleşme hatası: templateId=${templateId} (AWX ${serverId}) playbook='${actualFile}', `
        + `beklenen='${expectedFile}'. Admin > Playbook Registry'de template ID veya awx_server_id yanlış olabilir.`
      ),
      { status: 409 }
    );
  }
}

// Bir job tipini launch eder, logx_v2_jobs'a bir satir yazar, {id, awxJobId, status} doner.
// requestId sahibi oldugu dogrulanmis cagiran tarafindan gecilir (route seviyesinde kontrol edilir).
async function launchJob(requestId, jobType, extraVars, limit = '') {
  const keyName = JOB_KEY_BY_TYPE[jobType];
  if (!keyName) throw Object.assign(new Error(`Bilinmeyen job tipi: ${jobType}`), { status: 400 });

  // Idempotency guard: ayni request icin ayni tipte HÂLÂ calisan (terminal-olmayan) bir job
  // varsa yeni job acma — mevcut olani dondur. Frontend busy-kilidi ile birlikte, ag
  // gecikmesinde art arda tiklamanin ust uste job acmasini backend seviyesinde de keser.
  const existing = await listJobsForRequest(requestId);
  const inFlight = [...existing].reverse().find(
    (j) => j.jobType === jobType && !TERMINAL_STATUSES.has(j.status)
  );
  if (inFlight) return inFlight;

  const registryRow = await playbookRegistry.getByKey(keyName);
  if (!registryRow || !registryRow.enabled) {
    throw Object.assign(new Error(`"${keyName}" playbook kaydı bulunamadı veya devre dışı — admin panelinden yapılandırılmalı.`), { status: 503 });
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(registryRow);
  if (!templateId) {
    throw Object.assign(new Error(`"${keyName}" için AWX template ID yapılandırılmamış.`), { status: 503 });
  }
  // Hangi AWX sunucusunda calisacagi: admin panelinden set edilmis awx_server_id
  // once; yoksa .env'deki AWX_LOGX_SERVER_ID (4 template'in de bulundugu tek sunucu);
  // o da yoksa 1. NOT: template'ler yanlis AWX sunucusunda aranirsa AWX HTTP 404 doner —
  // bu degiskenin dogru AWX'i (or. Maestro 2) isaret etmesi SARTTIR.
  const configuredServerId = registryRow.awxServerId || Number(process.env.AWX_LOGX_SERVER_ID) || 1;
  let awxServerId = configuredServerId;

  let launch;
  try {
    await assertTemplateMatchesRegistry(awxServerId, templateId, registryRow.playbookPath);
    launch = await runner.launchJobOnServer(awxServerId, templateId, extraVars, limit);
  } catch (err) {
    if (!isAwx404Error(err)) throw err;

    const candidateServerIds = await findServerIdsContainingTemplate(templateId, configuredServerId);
    const alternative = candidateServerIds.find((id) => id !== Number(configuredServerId));

    if (alternative) {
      console.warn(`[LogXv2] Template ${templateId} AWX ${configuredServerId} uzerinde bulunamadi, AWX ${alternative} ile yeniden deneniyor.`);
      awxServerId = alternative;
      await assertTemplateMatchesRegistry(awxServerId, templateId, registryRow.playbookPath);
      launch = await runner.launchJobOnServer(awxServerId, templateId, extraVars, limit);
      // Otomatik-iyilestirme: dogru sunucuyu kalici yaz → sonraki launch'lar ~7sn telafi
      // taramasini atlar. Best-effort; yazamazsa job yine de basladi, sadece hiz kaybi olur.
      playbookRegistry.updateServerId(keyName, alternative)
        .then((ok) => { if (ok) console.warn(`[LogXv2] "${keyName}" registry awx_server_id → ${alternative} olarak kalıcı güncellendi (otomatik-iyileştirme).`); })
        .catch((e) => console.warn(`[LogXv2] awx_server_id otomatik-iyileştirme yazılamadı: ${e.message}`));
    } else {
      const hint = candidateServerIds.length > 0
        ? `Template ${templateId} yalnızca AWX ${candidateServerIds.join(',')} üzerinde bulundu.`
        : `Template ${templateId} erişilebilen AWX sunucularında bulunamadı.`;
      throw Object.assign(
        new Error(`AWX HTTP 404: job template bulunamadı (templateId=${templateId}, awxServerId=${configuredServerId}). ${hint} Admin > Playbook Registry'de awx_server_id alanını veya AWX_LOGX_SERVER_ID değerini kontrol edin.`),
        { status: 404 }
      );
    }
  }

  const { jobId: awxJobId, status } = launch;

  const { rows } = await db.query(
    `INSERT INTO logx_v2_jobs (request_id, job_type, awx_server_id, awx_job_id, status, extra_vars_redacted, started_at)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4,$5,$6,GETUTCDATE())`,
    [requestId, jobType, awxServerId, awxJobId, status || 'pending', JSON.stringify(extraVars)]
  );
  return normalizeJob(rows[0]);
}

async function getJobById(jobDbId) {
  const { rows } = await db.query(`SELECT * FROM logx_v2_jobs WHERE id = $1`, [jobDbId]);
  return rows[0] ? normalizeJob(rows[0]) : null;
}

async function listJobsForRequest(requestId) {
  const { rows } = await db.query(
    `SELECT * FROM logx_v2_jobs WHERE request_id = $1 ORDER BY id ASC`, [requestId]
  );
  return rows.map(normalizeJob);
}

// KULLANICIYA gosterilen hata metni. Son kullanici Ansible/AWX bilmek ZORUNDA DEGIL:
// mesaj sade tutulur, is numarasi verilir ve yoneticiye yonlendirilir. Teknik ayrinti
// ayri bir metinde (buildTechnicalJobDetail) uretilir; kullanici isterse ayni ekrandaki
// cikti panelinden ham Ansible loguna bakabilir.
// Saf fonksiyon — dogrudan test edilir.
function buildUserFacingJobError(job, live) {
  const jobNo = job.awxJobId;
  if (live.status === 'failed' || live.status === 'error') {
    return `İşlem tamamlanamadı (İş No: ${jobNo}). Otomasyon tarafında beklenmeyen bir hata oluştu. `
         + `Lütfen bu iş numarasıyla birlikte sistem yöneticinize başvurun. `
         + `Teknik ayrıntılar aşağıdaki çıktı panelindedir.`;
  }
  if (live.status === 'canceled') {
    return `İşlem iptal edildi (İş No: ${jobNo}).`;
  }
  // Terminal ama beklenen sonucu uretmemis (ornegin playbook set_stats adimina hic ulasmamis).
  return `İşlem tamamlandı ancak sonuç alınamadı (İş No: ${jobNo}). `
       + `Lütfen bu iş numarasıyla birlikte sistem yöneticinize başvurun. `
       + `Teknik ayrıntılar aşağıdaki çıktı panelindedir.`;
}

// YONETICI/destek icin teknik ayrinti. Kullaniciya gosterilmez; audit'e yazilir ve
// /jobs/:id/status yanitinda YALNIZCA Admin rolune eklenir.
function buildTechnicalJobDetail(job, live, keyInfo) {
  return `Yapılandırılmış çıktı bulunamadı (beklenen: artifacts.logx_result veya artifacts.data.logx_result). `
       + `Mevcut anahtarlar: top=[${keyInfo.top.join(', ')}], data=[${keyInfo.data.join(', ')}], ansible_stats.data=[${keyInfo.ansibleStatsData.join(', ')}]. `
       + `AWX ayrıntısı: jobId=${job.awxJobId}, serverId=${job.awxServerId}, status=${live.status}, playbook=${live.playbook || '-'}, inventory=${live.inventory || '-'}. `
       + `Job başarısızsa ham Ansible çıktısına bakın; başarılı görünüyorsa playbook'un set_stats adımını ve AWX template'in doğru playbook'a bağlı olduğunu kontrol edin.`;
}

// AWX'ten guncel durumu ceker, terminal durumdaysa logx_v2_jobs'i artifacts ile gunceller.
// Zaten terminal durumdaki bir job'i tekrar AWX'e sormaz (cache'lenmis satiri doner).
async function pollJob(job) {
  if (TERMINAL_STATUSES.has(job.status)) return job;

  const live = await runner.getJobStatusOnServer(job.awxServerId, job.awxJobId);
  if (!TERMINAL_STATUSES.has(live.status)) {
    if (live.status !== job.status) {
      await db.query(`UPDATE logx_v2_jobs SET status = $1 WHERE id = $2`, [live.status, job.id]);
    }
    return { ...job, status: live.status };
  }

  const artifacts = extractLogxResultFromArtifacts(live.artifacts);
  const keyInfo = summarizeArtifactKeys(live.artifacts);
  const errorMessage = artifacts ? null : buildUserFacingJobError(job, live);
  const technicalDetail = artifacts ? null : buildTechnicalJobDetail(job, live, keyInfo);

  if (technicalDetail) {
    // Teknik ayrinti DB semasina EKLENMEZ (yeni kolon yok); kalici iz audit'te ve
    // asil kaynak olan AWX stdout'unda kalir (bkz. getJobOutput).
    audit.log({
      username: 'system',
      action: 'v2_job_failed',
      result: live.status,
      detail: technicalDetail,
    }).catch(() => {});
  }

  const { rows } = await db.query(
    `UPDATE logx_v2_jobs
       SET status = $1, artifacts_json = $2, finished_at = GETUTCDATE(), error_message = $3
     OUTPUT INSERTED.*
     WHERE id = $4`,
    [live.status, artifacts ? JSON.stringify(artifacts) : null, errorMessage, job.id]
  );
  return { ...normalizeJob(rows[0]), technicalDetail };
}

// Calisan bir job'i AWX'te iptal eder ve DB satirini `canceled` durumuna ceker. Zaten
// terminal durumdaysa AWX'e dokunmadan mevcut satiri doner (idempotent). Iptal sonrasi
// sihirbaz, request state'i uzerinden uygun ekrana toparlanir (bkz. index.cjs cancel route).
async function cancelJob(job) {
  if (TERMINAL_STATUSES.has(job.status)) return job;

  await runner.cancelJobOnServer(job.awxServerId, job.awxJobId);
  const { rows } = await db.query(
    `UPDATE logx_v2_jobs
       SET status = 'canceled', finished_at = GETUTCDATE(),
           error_message = COALESCE(error_message, 'Kullanıcı tarafından iptal edildi.')
     OUTPUT INSERTED.*
     WHERE id = $1`,
    [job.id]
  );
  return normalizeJob(rows[0]);
}

// Bekleyen/calisan bir job'in CANLI AWX stdout'unu doner — yalnizca kullaniciya
// "su an ne oluyor" gorunurlugu icindir, sonuc sozlesmesinin kaynagi DEGILDIR
// (o her zaman pollJob()'in okudugu artifacts.logx_result'tir, bkz. dosya basi notu).
async function getJobOutput(job) {
  const { output } = await runner.getJobOutputOnServer(job.awxServerId, job.awxJobId);
  return output;
}

function normalizeJob(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    jobType: row.job_type,
    awxServerId: row.awx_server_id,
    awxJobId: row.awx_job_id,
    status: row.status,
    artifacts: row.artifacts_json ? JSON.parse(row.artifacts_json) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

module.exports = {
  launchJob, getJobById, listJobsForRequest, pollJob, cancelJob, getJobOutput, TERMINAL_STATUSES,
  // saf yardimcilar — birim testleri icin acildi (DB/AWX gerektirmez)
  buildUserFacingJobError, buildTechnicalJobDetail,
};
