'use strict';

const MAX_HISTORY_CLOCK_SKEW_MS = 5 * 60 * 1000;

function norm(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

function parseParams(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function targetMatches(vars, target, kind) {
  const expected = {
    host: norm(target.host),
    application: norm(target.appName),
    gen: norm(target.gen),
    appPath: norm(target.appPath),
  };
  const rows = Array.isArray(vars.rt_hedefler)
    ? vars.rt_hedefler
    : [
        {
          host: vars.target_host,
          application: vars.application,
          jboss_gen: vars.jboss_gen,
          app_path: vars.app_path,
        },
      ];
  const matches = rows.filter(
    (row) =>
      norm(row?.host) === expected.host &&
      norm(row?.application) === expected.application &&
      norm(row?.jboss_gen) === expected.gen &&
      norm(row?.app_path) === expected.appPath,
  );
  return matches.length === 1 && (kind === 'stop' || rows.length === 1);
}

function validateRecovery({
  kind,
  target,
  record,
  history,
  job,
  expectedServerId,
  expectedTemplateId,
  expectedPlaybook,
  claimEvents = [],
  existingBindings = [],
}) {
  const field = kind === 'stop' ? 'last_job_id' : kind === 'delete' ? 'delete_job_id' : null;
  const status = kind === 'stop' ? 'stopping' : kind === 'delete' ? 'deleting' : null;
  if (
    !field ||
    target?.status !== status ||
    target?.[kind === 'stop' ? 'lastJobId' : 'deleteJobId']
  )
    return { ok: false, reason: 'Hedef artık uzlaştırılabilir bir orphan claim değil.' };

  const jobId = Number(job?.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0 || Number(history?.job_id) !== jobId)
    return { ok: false, reason: 'AWX işi ile Portal iş geçmişi aynı job ID’yi kanıtlamıyor.' };
  if (Number(history?.awx_server_id) !== Number(expectedServerId))
    return {
      ok: false,
      reason: 'İş geçmişindeki AWX sunucusu güncel Retirement kaydıyla eşleşmiyor.',
    };
  if (
    Number(history?.template_id) !== Number(expectedTemplateId) ||
    Number(job?.templateId) !== Number(expectedTemplateId)
  )
    return { ok: false, reason: 'AWX job template’i Retirement adımıyla eşleşmiyor.' };
  const actualPlaybook = norm(job?.playbook).split('/').pop();
  if (!actualPlaybook || actualPlaybook !== norm(expectedPlaybook).split('/').pop())
    return { ok: false, reason: 'AWX işinin playbook’u beklenen Retirement eylemiyle eşleşmiyor.' };

  const prefix = kind === 'stop' ? 'retirement: stop ' : 'retirement: delete ';
  if (!norm(history?.template_name).startsWith(prefix))
    return { ok: false, reason: 'Portal iş geçmişi beklenen Retirement eylemini kanıtlamıyor.' };

  const vars = parseParams(history?.params);
  if (!vars || vars.plan_only !== false)
    return {
      ok: false,
      reason: 'Gerçek işlem parametreleri kanıtlanamadı (plan_only=false gerekli).',
    };
  if (norm(vars.smart_no) !== norm(record?.smartNo))
    return { ok: false, reason: 'Smart numarası Retirement kaydıyla eşleşmiyor.' };
  if (!targetMatches(vars, target, kind))
    return { ok: false, reason: 'Hedef host/application/JBoss/path kanıtı eşleşmiyor.' };

  const awxCreated = Date.parse(job?.created);
  const historyStarted = new Date(history?.started_at).getTime();
  if (
    !Number.isFinite(awxCreated) ||
    !Number.isFinite(historyStarted) ||
    Math.abs(awxCreated - historyStarted) > MAX_HISTORY_CLOCK_SKEW_MS
  )
    return {
      ok: false,
      reason: 'AWX launch zamanı ile Portal iş geçmişi eşleşmiyor.',
    };

  // target.updated_at poller tarafindan degisebilir; claim zamani olarak kullanilamaz.
  // Yalniz launch basarili olduktan sonra job ID persist edilemezse yazilan, append-only
  // error olayi bu kurtarma yolunun acilmasina izin verir. Olay da yazilamadiysa fail closed.
  const eventNeedle = `${kind} isi #${jobId} basladi ancak portal kaydi tamamlanamadi`;
  const hasClaimEvent = claimEvents.some((event) => {
    const at = new Date(event?.at).getTime();
    const text = norm(event?.text);
    return (
      Number.isFinite(at) &&
      Math.abs(awxCreated - at) <= MAX_HISTORY_CLOCK_SKEW_MS &&
      text.includes(eventNeedle) &&
      text.includes(norm(target.host)) &&
      text.includes(norm(target.appName))
    );
  });
  if (!hasClaimEvent)
    return {
      ok: false,
      reason: 'Portal orphan claim olayı bu AWX işi ve hedef için kanıtlanamadı.',
    };

  const conflicting = existingBindings.some((row) => {
    if (Number(row.id) === Number(target.id)) return false;
    if (kind === 'delete' || Number(row.record_id) !== Number(target.recordId)) return true;
    return !targetMatches(
      vars,
      { host: row.host, appName: row.app_name, gen: row.jboss_gen, appPath: row.app_path },
      'stop',
    );
  });
  if (conflicting)
    return { ok: false, reason: 'Bu job ID başka bir Retirement hedefiyle ilişkilendirilmiş.' };

  return { ok: true, field, status, jobId };
}

module.exports = { validateRecovery, parseParams, MAX_HISTORY_CLOCK_SKEW_MS };
