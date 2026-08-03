// server/ai-analyst/portal-tools.cjs — AI Analist'in MCP-disi, portal-yerli araclari
//
// Amac: LLM'in "X hostuna git, Y logunu oku, sonra Dynatrace/Instana ile capraz
// dogrula" zincirini TEK sohbette kurabilmesi. Araclar mevcut portal yeteneklerini
// sarar; log icerigi LLM'e verilmeden once ZORUNLU PII maskelemesinden gecer.
'use strict';

const { maskLines } = require('../logx/masker.cjs');

const LOG_RESULT_MAX = 8_000;

// ── Host envanteri: kurumsal EnvanterApps tablosundan (env, host, app) ─────────
// Eski portalin kendi inventory_hosts tablosu (port-1111 LogX kalintisi) yerine artik
// gercek uygulama envanteri EnvanterApps kaynak aliniyor — boylece host listesi tek
// yerde (kurumsal DB) tutulur, ayri bir yonetim ekrani gerektirmez. EnvanterApps'te
// bir host birden fazla uygulama satirina sahip olabilir; host bazinda gruplariz.
// Envanter katmaninin PUBLIC API'sini (inventory/index.cjs) kullanir — eskiden bu
// fonksiyon dogrudan inventory/mssql.cjs'in DB havuzuna kenetleniyordu (katman ihlali,
// kurumsal AI kod incelemesi, review.md #16).
async function envanterHostRows() {
  return require('../inventory/index.cjs').getHostsForAiTools();
}

// EnvanterApps satirlarini host bazinda gruplar: { host, envs:[], apps:[] }.
function groupByHost(rows) {
  const map = new Map();
  for (const row of rows) {
    const host = String(row.host || '').trim();
    if (!host) continue;
    if (!map.has(host)) map.set(host, { host, envs: new Set(), apps: new Set() });
    const g = map.get(host);
    if (row.env) g.envs.add(String(row.env));
    if (row.app) g.apps.add(String(row.app));
  }
  return [...map.values()].map((g) => ({ host: g.host, envs: [...g.envs], apps: [...g.apps] }));
}

// Ortak AWX job-bekleme dongusu — fetchRawLogLines ve runReadOnlyAwxTemplate'te birebir
// tekrarlaniyordu (kurumsal AI kod incelemesi, review.md #17).
async function waitForJob(runnerMod, jobId, { maxRetries = 30, delayMs = 2000 } = {}) {
  let jobStatus;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    jobStatus = await runnerMod.getJobStatus(jobId);
    if (['successful', 'failed', 'error', 'canceled'].includes(jobStatus.status)) break;
  }
  return jobStatus;
}

function isTerminalStatus(status) {
  return !!status && ['successful', 'failed', 'error', 'canceled'].includes(status.status);
}

// KALICI COZUM (kurumsal AI kod incelemesi, review.md #23 — onceki iki turde "nginx
// proxy_read_timeout 300s zaten kapsiyor, aktif risk degil" gerekcesiyle ertelenmisti;
// bu turde kullanicinin acik talebi geregi gercekten cozuluyor): fetchRawLogLines ve
// runReadOnlyAwxTemplate artik 30x2s (60s) TAM bekleme yerine KISA bir ilk kontrol yapar
// (QUICK_CHECK_RETRIES x 2s). Is bu sure icinde bitmezse ham sonuc yerine {pending:true,
// jobId} doner; caller (asagidaki tool'lar) LLM'e jobId'yi portal_logx_job_result ile
// tekrar sormasini soyler. Boylece tek bir SSE baglantisi artik en fazla birkac saniye
// (60s degil) acik kalir. Ayrimin bedeli: LLM-araciligiyla "tekrar sor" turu, dogrudan
// in-process polling'den daha yavas/maliyetli olabilir — bu, event-loop/SSE bloklamasindan
// kacinmanin bilincli bedelidir.
const QUICK_CHECK_RETRIES = 3; // ~6s ilk kontrol (makeAnsibleRunTemplateTool'daki 3s tek-kontrolle ayni buyukluk mertebesi)
let _quickCheckDelayMs = 2000; // test-only: gercek 2s'leri beklemeden "hic terminal olmuyor" senaryosunu hizli test etmek icin degistirilebilir

// Henuz tamamlanmamis log-fetch/analyze/raw-template job'larinin baglamini tutar — LLM
// portal_logx_job_result'i jobId ile tekrar cagirdiginda hangi modda (ham fetch / AI-analiz
// / etiketli ham metin) devam edilecegini ve orijinal parametreleri (maskeleme/analiz icin
// gerekli) hatirlar. Kisa TTL'li + sinirli boyutlu — bir sohbet jobId'yi bir daha sormazsa
// sonsuza dek birikmesin diye (server/auth/avatar-cache.cjs ile ayni LRU+TTL felsefesi).
const _pendingJobs = new Map(); // jobId → { mode, ..., createdAt }
const PENDING_JOB_TTL_MS = 15 * 60_000;
const PENDING_JOB_MAX = 200;

function rememberPendingJob(jobId, info) {
  if (_pendingJobs.has(jobId)) _pendingJobs.delete(jobId);
  if (_pendingJobs.size >= PENDING_JOB_MAX) {
    const oldest = _pendingJobs.keys().next().value;
    _pendingJobs.delete(oldest);
  }
  _pendingJobs.set(jobId, { ...info, createdAt: Date.now() });
}

function sweepPendingJobs() {
  const cutoff = Date.now() - PENDING_JOB_TTL_MS;
  for (const [id, info] of _pendingJobs) {
    if (info.createdAt < cutoff) _pendingJobs.delete(id);
  }
}
setInterval(sweepPendingJobs, 5 * 60_000).unref();

function pendingMessage(jobId) {
  return `Job henüz tamamlanmadı (jobId=${jobId}). Birkaç saniye sonra portal_logx_job_result aracını jobId=${jobId} ile çağırıp sonucu alın.`;
}

// ── Sonuc bicimlendiriciler — hem "hemen bitti" hem "sonradan portal_logx_job_result ile
// sorgulandi" yollarindan AYNI kod uzerinden gecsin diye tool.exec()'lerden ayristirildi.
function formatFetchResult({ hostname, logFilePath, grepPattern, safeLines, rawLines }) {
  const { maskedLines, totalMasked } = maskLines(rawLines);
  let text = maskedLines.join('\n');
  if (text.length > LOG_RESULT_MAX) {
    text = text.slice(-LOG_RESULT_MAX); // loglarin SONU daha degerli — sondan kirp
    text = `…(baş taraf kırpıldı)\n${text}`;
  }
  const header = `[${hostname}:${logFilePath}] son ${safeLines} satır` +
    (grepPattern ? `, filtre: ${grepPattern}` : '') +
    (totalMasked > 0 ? ` — ${totalMasked} PII değeri maskelendi` : '');
  return `${header}\n${'─'.repeat(40)}\n${text}`;
}

async function formatAnalyzeResult({ hostname, logFilePath, rawLines, context, username }) {
  const aiAnalyzer = require('../logx/ai-analyzer.cjs');
  const analysis = await aiAnalyzer.analyze(rawLines, context || `Host: ${hostname}, dosya: ${logFilePath}`, username);
  return `[${hostname}:${logFilePath}] LogX AI analizi (${analysis.provider}/${analysis.model}, ` +
    `${analysis.maskedCount} PII maskelendi):\nÖZET: ${analysis.summary}\nSEVİYE: ${analysis.severity}\n` +
    (analysis.possibleCauses?.length ? `OLASI NEDENLER:\n${analysis.possibleCauses.map((c) => `- ${c}`).join('\n')}\n` : '') +
    (analysis.recommendations?.length ? `ÖNERİLER:\n${analysis.recommendations.map((r) => `- ${r}`).join('\n')}` : '');
}

function formatRawTemplateResult(label, output) {
  return `${label}:\n${'─'.repeat(40)}\n${String(output || '').slice(-LOG_RESULT_MAX)}`;
}

// Ansible ile hosttan log satirlarini ceker (HAM — maskeleme yok). fetchLogTool
// ve analyzeLogTool bu tek yolu paylasir; her ikisi kendi ciktisini maskelemekle
// yukumludur (fetchLogTool: maskLines; analyzeLogTool: ai-analyzer.analyze zaten
// dahili olarak maskeliyor). Kisa ilk kontrolden sonra hala calisiyorsa {pending:true,
// jobId} doner — caller portal_logx_job_result'a yonlendirir (review.md #23).
async function fetchRawLogLines({ hostname, logFilePath, grepPattern, lines }) {
  if (!hostname || !logFilePath) throw new Error('hostname ve logFilePath zorunlu.');

  let runnerMod;
  try { runnerMod = require('../ansible/runner.cjs'); }
  catch { throw new Error('Ansible runner yüklenemedi.'); }
  if (!runnerMod.isConfigured()) throw new Error('AWX yapılandırılmamış — log çekme kullanılamaz.');
  const templateId = process.env.AWX_LOG_FETCH_TEMPLATE_ID;
  if (!templateId) throw new Error('AWX_LOG_FETCH_TEMPLATE_ID tanımlı değil — log çekme kullanılamaz.');

  const safeLines = Math.min(Number(lines) || 200, 500);
  const launch = await runnerMod.launchJob(Number(templateId), {
    target_host: hostname,
    log_file_path: logFilePath,
    grep_pattern: grepPattern || '',
    lines: String(safeLines),
  }, hostname);

  const jobStatus = await waitForJob(runnerMod, launch.jobId, { maxRetries: QUICK_CHECK_RETRIES, delayMs: _quickCheckDelayMs });
  if (!isTerminalStatus(jobStatus)) {
    return { pending: true, jobId: launch.jobId, safeLines };
  }
  if (jobStatus.status !== 'successful') {
    throw new Error(`Log çekme job'ı başarısız: ${jobStatus.status} (job #${launch.jobId})`);
  }

  const output = await runnerMod.getJobOutput(launch.jobId);
  const rawLines = String(output.output || '').split('\n');
  return { pending: false, rawLines, safeLines };
}

// Jenerik "salt-okunur AWX template'i calistir + ham stdout'u bekle" yardimcisi —
// fetchRawLogLines'in genel hali (JVM heap / OCP pod status / playbook-registry
// tabanli tum yeni araclar icin). templateId dogrudan verilebilir (registry'den zaten
// cozulmus) VEYA envVarName uzerinden okunabilir (geriye donuk uyumluluk — hicbir mevcut
// cagiran kalmadi ama fonksiyon ileride dogrudan env'den okumak isteyen bir cagiran icin
// esnek kalir). fetchRawLogLines ile ayni kisa-kontrol/pending deseni (review.md #23).
async function runReadOnlyAwxTemplate({ templateId: explicitTemplateId, envVarName, extraVars = {}, limit, missingTemplateMsg }) {
  let runnerMod;
  try { runnerMod = require('../ansible/runner.cjs'); }
  catch { throw new Error('Ansible runner yüklenemedi.'); }
  if (!runnerMod.isConfigured()) throw new Error('AWX yapılandırılmamış.');
  const templateId = explicitTemplateId || (envVarName && process.env[envVarName]);
  if (!templateId) throw new Error(missingTemplateMsg || `${envVarName || 'template ID'} tanımlı değil.`);

  const launch = await runnerMod.launchJob(Number(templateId), extraVars, limit || '');

  const jobStatus = await waitForJob(runnerMod, launch.jobId, { maxRetries: QUICK_CHECK_RETRIES, delayMs: _quickCheckDelayMs });
  if (!isTerminalStatus(jobStatus)) {
    return { pending: true, jobId: launch.jobId };
  }
  if (jobStatus.status !== 'successful') {
    throw new Error(`Job başarısız: ${jobStatus.status} (job #${launch.jobId})`);
  }

  const output = await runnerMod.getJobOutput(launch.jobId);
  return { pending: false, output: String(output.output || '') };
}

// ── Tool 1: LogX envanterinden host arama ─────────────────────────────────────
const listHostsTool = {
  name: 'portal_logx_list_hosts',
  description: 'Kurumsal uygulama envanterinden (EnvanterApps) sunucuları listeler/arar. Log ' +
    'okumadan önce doğru hostname\'i bulmak için kullan. Sonuç: hostname, ortam(lar) ve o ' +
    'sunucuda çalışan uygulamalar.',
  inputSchema: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Hostname veya uygulama adı içinde geçen arama metni (boş = ilk 25 host)',
      },
    },
  },
  async exec({ search } = {}) {
    const grouped = groupByHost(await envanterHostRows());
    const q = (search || '').toLowerCase().trim();
    const filtered = q
      ? grouped.filter((g) =>
          g.host.toLowerCase().includes(q) || g.apps.some((a) => a.toLowerCase().includes(q)))
      : grouped;
    filtered.sort((a, b) => a.host.localeCompare(b.host));
    const rows = filtered.slice(0, 25).map((g) => {
      const appsPreview = g.apps.slice(0, 4).join(', ') + (g.apps.length > 4 ? ` (+${g.apps.length - 4})` : '');
      return `${g.host} | env=${g.envs.join('/') || '-'} | uygulamalar: ${appsPreview || '-'}`;
    });
    return rows.length
      ? `${filtered.length} host bulundu (ilk ${rows.length} gösteriliyor):\n${rows.join('\n')}`
      : 'Eşleşen host bulunamadı — arama terimini değiştirin veya boş bırakın.';
  },
};

// ── Tool: Tek bir hostname icin envanter kaydi (EnvanterApps) ────────────────
// portal_logx_list_hosts ozet doner; bu arac TEK bir host icin o sunucuda calisan
// uygulamalarin TAM listesini + ortam bilgisini doner — sohbette gecen bir hostname'in
// (or. bir DT problem'inin ait oldugu host) baglamini otomatik enjekte etmek icin.
const inventoryLookupTool = {
  name: 'portal_inventory_lookup',
  description: 'Tek bir hostname için envanter kaydını getirir: o sunucuda çalışan TÜM uygulamalar ' +
    've ortam(lar). Sohbette bir hostname geçtiğinde (ör. bir Dynatrace/Instana bulgusunun host\'u) ' +
    'bağlam almak için kullan. Birden fazla host arıyorsan portal_logx_list_hosts kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      hostname: { type: 'string', description: 'Tam veya kısmi hostname' },
    },
    required: ['hostname'],
  },
  async exec({ hostname } = {}) {
    if (!hostname) throw new Error('hostname zorunlu.');
    const grouped = groupByHost(await envanterHostRows());
    const q = String(hostname).toLowerCase().trim();
    const match = grouped.find((g) => g.host.toLowerCase() === q)
      || grouped.find((g) => g.host.toLowerCase().includes(q));
    if (!match) {
      return `"${hostname}" envanterde (EnvanterApps) bulunamadı — hostname'i doğrulamak için portal_logx_list_hosts kullan.`;
    }
    return [
      `hostname: ${match.host}`,
      `environment: ${match.envs.join(', ') || '-'}`,
      `uygulama sayısı: ${match.apps.length}`,
      `uygulamalar: ${match.apps.join(', ') || '-'}`,
    ].join('\n');
  },
};

// ── Tool 2: Ansible ile hosttan log cekme (maskeli) ───────────────────────────
const fetchLogTool = {
  name: 'portal_logx_fetch_log',
  description: 'Belirtilen sunucudan log dosyası içeriğini çeker (Ansible üzerinden). Hemen ' +
    'sonuçlanmazsa jobId ile birlikte "henüz tamamlanmadı" mesajı döner — bu durumda birkaç ' +
    'saniye sonra portal_logx_job_result\'ı AYNI jobId ile çağırın. Önce portal_logx_list_hosts ' +
    'ile doğru hostname\'i bul. İçerik PII-maskelenmiş döner. Bulgularını Dynatrace ' +
    '(dynatrace_managed_query_logs / list_events) veya Instana araçlarıyla çapraz doğrula.',
  inputSchema: {
    type: 'object',
    properties: {
      hostname: { type: 'string', description: 'Envanterdeki hostname (portal_logx_list_hosts çıktısından)' },
      logFilePath: { type: 'string', description: 'Log dosyasının tam yolu (ör. /var/log/jboss/server.log)' },
      grepPattern: { type: 'string', description: 'Opsiyonel filtre deseni (ör. "ERROR|OutOfMemory")' },
      lines: { type: 'number', description: 'Son kaç satır (varsayılan 200, maks 500)' },
    },
    required: ['hostname', 'logFilePath'],
  },
  async exec({ hostname, logFilePath, grepPattern, lines } = {}) {
    const result = await fetchRawLogLines({ hostname, logFilePath, grepPattern, lines });
    if (result.pending) {
      rememberPendingJob(result.jobId, { mode: 'fetch', hostname, logFilePath, grepPattern, safeLines: result.safeLines });
      return pendingMessage(result.jobId);
    }
    return formatFetchResult({ hostname, logFilePath, grepPattern, safeLines: result.safeLines, rawLines: result.rawLines });
  },
};

// ── Tool 3: Hosttan log cek + LogX AI ile analiz et (tek adimda) ─────────────
// LogX AI'in (server/logx/ai-analyzer.cjs) analiz yetenegini MCP AI'a (bu
// orkestrator) bir arac olarak acar — "capraz AI cagirma" burada gerceklesir:
// MCP AI ham logu okumak yerine LogX AI'in urettigi yapilandirilmis ozeti alir
// (token tasarrufu + PII maskeleme ai-analyzer icinde zaten zorunlu).
function makeAnalyzeLogTool(username) {
  return {
    name: 'portal_logx_analyze_log',
    description: 'Belirtilen sunucudan log çeker VE LogX AI analiz motoruyla (özet/severity/olası ' +
      'nedenler/öneriler) analiz eder — tek adımda. Hemen sonuçlanmazsa jobId ile "henüz ' +
      'tamamlanmadı" mesajı döner — bu durumda birkaç saniye sonra portal_logx_job_result\'ı AYNI ' +
      'jobId ile çağırın. Kullanıcı "şu logu analiz et / logda ne olmuş" tarzı bir istekte ' +
      'bulunduğunda ham log okumak yerine BU aracı kullan; ham metin gerekiyorsa ' +
      'portal_logx_fetch_log kullan. Önce portal_logx_list_hosts ile doğru hostname\'i bul.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Envanterdeki hostname (portal_logx_list_hosts çıktısından)' },
        logFilePath: { type: 'string', description: 'Log dosyasının tam yolu (ör. /var/log/jboss/server.log)' },
        grepPattern: { type: 'string', description: 'Opsiyonel filtre deseni (ör. "ERROR|OutOfMemory")' },
        lines: { type: 'number', description: 'Son kaç satır (varsayılan 200, maks 500)' },
        context: { type: 'string', description: 'Opsiyonel ek bağlam (ör. ortam, servis adı, deploy zamanı)' },
      },
      required: ['hostname', 'logFilePath'],
    },
    async exec({ hostname, logFilePath, grepPattern, lines, context } = {}) {
      const result = await fetchRawLogLines({ hostname, logFilePath, grepPattern, lines });
      if (result.pending) {
        rememberPendingJob(result.jobId, { mode: 'analyze', hostname, logFilePath, context, username });
        return { text: pendingMessage(result.jobId) };
      }
      return { text: await formatAnalyzeResult({ hostname, logFilePath, rawLines: result.rawLines, context, username }) };
    },
  };
}

// ── Tool 4: Izin verilen Ansible/AWX template'ini calistirma (yalnizca Admin) ─
// Guvenlik modeli (docs/AI-INTEGRATION-ROADMAP.md #29/#30 ile ayni cizgi):
//   - Yalnizca runner.cjs'teki AWX_READ_ONLY_TEMPLATE_IDS allowlist'inde olan
//     template'ler cagrilabilir — launchJob zaten bunu zorluyor, burada AYRICA
//     tekrar edilmiyor (tek dogruluk kaynagi runner.cjs'te kalsin).
//   - Bu arac yalnizca Admin rolundeki oturumlarda toolset'e eklenir (bkz.
//     getPortalTools) — User rolu bu araci hic gormez, LLM "dener de 403 alir"
//     yerine bastan oneri moduna yonlendirilir (bkz. orchestrator sistem promptu).
//   - Her cagri audit'lenir (server/logx/audit.cjs, action: ai_ansible_launch).
function makeAnsibleRunTemplateTool(user) {
  return {
    name: 'portal_ansible_run_template',
    description: 'İzin verilen (allowlist\'teki) bir Ansible/AWX job template\'ini başlatır. Yalnızca ' +
      'zaten onaylı/salt-okunur sınıflandırılmış template ID\'leri kabul edilir — allowlist dışı bir ID ' +
      'reddedilir (kullanıcıyı Self Service sayfasına yönlendirmeyi öner). Job hemen tamamlanmayabilir; ' +
      'sonucu job ID + kısa süre sonraki durumdur, tam çıktı için portal_ansible_job_status kullan.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'number', description: 'AWX job template ID (allowlist\'te olmalı)' },
        extraVars: { type: 'object', description: 'Opsiyonel extra_vars (key-value)' },
        limit: { type: 'string', description: 'Opsiyonel Ansible --limit (ör. hedef hostname)' },
      },
      required: ['templateId'],
    },
    async exec({ templateId, extraVars = {}, limit = '' } = {}) {
      let runnerMod, audit;
      try { runnerMod = require('../ansible/runner.cjs'); }
      catch { throw new Error('Ansible runner yüklenemedi.'); }
      try { audit = require('../logx/audit.cjs'); } catch { audit = null; }

      const detail = `templateId=${templateId} extraVars=${JSON.stringify(extraVars).slice(0, 500)} limit=${limit || '-'}`;
      try {
        const launch = await runnerMod.launchJob(Number(templateId), extraVars, limit);
        audit?.log({
          username: user.username, role: user.role, action: 'ai_ansible_launch',
          result: 'success', detail: `${detail} jobId=${launch.jobId}`,
        }).catch(() => {});

        // Kisa poll (log-fetch aracindaki gibi 60s beklemek yerine) — LLM'e hizli
        // donus yapilir, gerekiyorsa portal_ansible_job_status ile takip edilir.
        await new Promise((r) => setTimeout(r, 3000));
        const status = await runnerMod.getJobStatus(launch.jobId).catch(() => null);
        return {
          text: `AWX job başlatıldı: templateId=${templateId}, jobId=${launch.jobId}, ` +
            `durum=${status?.status || launch.status} (henüz sonuçlanmamış olabilir — ` +
            `portal_ansible_job_status ile takip edin).`,
        };
      } catch (err) {
        audit?.log({
          username: user.username, role: user.role, action: 'ai_ansible_launch',
          result: 'error', detail: `${detail} error=${err.message}`,
        }).catch(() => {});
        throw err;
      }
    },
  };
}

// ── Tool 5: Ansible job durumu sorgulama ──────────────────────────────────────
function makeAnsibleJobStatusTool() {
  return {
    name: 'portal_ansible_job_status',
    description: 'portal_ansible_run_template ile başlatılmış bir AWX job\'ının güncel durumunu getirir.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'number', description: 'Job ID (portal_ansible_run_template sonucundan)' } },
      required: ['jobId'],
    },
    async exec({ jobId } = {}) {
      const runnerMod = require('../ansible/runner.cjs');
      const status = await runnerMod.getJobStatus(Number(jobId));
      return { text: `Job #${jobId}: durum=${status.status}, başladı=${status.started || '-'}, bitti=${status.finished || '-'}` };
    },
  };
}

// ── Tool: log-fetch/analyze/playbook job sonucunu sonradan alma ──────────────
// portal_logx_fetch_log / portal_logx_analyze_log / portal_playbook_* araclari "henuz
// tamamlanmadi, jobId=N" dondugunde LLM bu araci AYNI jobId ile tekrar cagirir. Launch
// yetkisi kapisindan (portal_ansible_run_template/portal_ansible_job_status — Admin-only)
// BAGIMSIZ, tum kullanicilara acik: zaten sahip olunan bir jobId'nin durumunu sormak yeni
// bir yetki degildir, asil yetki kapisi joBU BASLATMAK'ta (review.md #23).
function makeJobResultTool() {
  return {
    name: 'portal_logx_job_result',
    description: 'portal_logx_fetch_log, portal_logx_analyze_log veya portal_playbook_* bir jobId ile ' +
      '"henüz tamamlanmadı" döndüyse, bu aracı AYNI jobId ile çağırarak sonucu (hazır olduğunda) alın.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'number', description: 'Önceki aracın döndürdüğü jobId' } },
      required: ['jobId'],
    },
    async exec({ jobId } = {}) {
      const id = Number(jobId);
      const pending = _pendingJobs.get(id);
      if (!pending) {
        return { text: `jobId=${id} için bekleyen bir kayıt bulunamadı (süresi dolmuş ya da hatalı jobId olabilir).` };
      }
      let runnerMod;
      try { runnerMod = require('../ansible/runner.cjs'); }
      catch { throw new Error('Ansible runner yüklenemedi.'); }
      const status = await runnerMod.getJobStatus(id);
      if (!isTerminalStatus(status)) {
        return { text: `Job #${id} hâlâ çalışıyor (durum=${status?.status || 'bilinmiyor'}). Birkaç saniye sonra tekrar deneyin.` };
      }
      _pendingJobs.delete(id);
      if (status.status !== 'successful') {
        return { text: `Job #${id} başarısız oldu: durum=${status.status}.` };
      }
      const output = await runnerMod.getJobOutput(id);
      const rawLines = String(output.output || '').split('\n');
      const text = pending.mode === 'analyze'
        ? await formatAnalyzeResult({ hostname: pending.hostname, logFilePath: pending.logFilePath, rawLines, context: pending.context, username: pending.username })
        : pending.mode === 'raw-template'
          ? formatRawTemplateResult(pending.label, output.output)
          : formatFetchResult({ hostname: pending.hostname, logFilePath: pending.logFilePath, grepPattern: pending.grepPattern, safeLines: pending.safeLines, rawLines });
      return { text };
    },
  };
}

// ── Tool: Splunk arama (yalnizca urun+zaman araligi — serbest SPL YOK) ────────
// portal_ansible_run_template'teki "allowlist disina cikma" temkinliliginin Splunk
// karsiligi: LLM'e ham SPL yazdirilmiyor, yalnizca SPLUNK_PRODUCTS'taki adlardan
// birini + sinirli bir zaman penceresini secebiliyor (injection/maliyet riski yok).
const splunkSearchTool = {
  name: 'portal_splunk_search',
  description: 'Splunk\'ta belirtilen ürün için son N dakikadaki log kayıtlarını getirir. ' +
    'Serbest SPL sorgusu KABUL ETMEZ — yalnızca ürün adı ve zaman aralığı.',
  inputSchema: {
    type: 'object',
    properties: {
      product: { type: 'string', description: 'SPLUNK_PRODUCTS listesinden bir ürün adı (ör. jboss, nginx, httpd)' },
      windowMinutes: { type: 'number', description: 'Son kaç dakika (varsayılan 15, maks 60)' },
    },
    required: ['product'],
  },
  async exec({ product, windowMinutes } = {}) {
    const splunkClient = require('../splunk/client.cjs');
    if (!splunkClient.isConfigured()) throw new Error('Splunk yapılandırılmamış (SPLUNK_BASE_URL/SPLUNK_TOKEN).');
    const result = await splunkClient.search({ product, windowMinutes: Math.min(Number(windowMinutes) || 15, 60) });
    return {
      text: `Splunk "${product}" (son ${windowMinutes || 15} dk): ${result.eventCount} kayıt bulundu.\n` +
        (result.sample.length ? `Örnek kayıtlar:\n${result.sample.slice(0, 5).join('\n')}` : ''),
    };
  },
};

// ── Tool: JVM heap/GC durumu (server/ansible/playbooks/jvm_heap_status.yml) ───
// Salt-okunur (jstat/jmap) — bir JBoss/WildFly/EAP prosesinin heap/GC istatistiklerini
// ve JVM baslangic bayraklarini doner. Log-fetch ile ayni desen: launch + poll + stdout.
// ── DB-destekli playbook kayit sistemi (server/ansible/playbook-registry.cjs) ────
// JVM heap, OCP pod durumu ve kullanicinin ekleyecegi HER YENI salt-okunur tanilama
// playbook'u buradan tek bir jenerik mekanizmayla AI aracina donusur. Bir kaydin
// (DB'de veya .env'de) template ID'si YOKSA o arac sessizce olusturulmaz — LLM'e
// hic sunulmaz, dolayisiyla hicbir zaman "hata" olarak gorunmez.

// handler: 'host_target' — tek girdi (hostname), jvm_heap_status.yml'nin kurdugu
// konvansiyon (target_hosts extra_var). Yeni bir playbook bu konvansiyonu takip
// ederse KOD DEGISIKLIGI olmadan admin ekranindan eklenip calisir.
function makeHostTargetTool(row, templateId) {
  return {
    name: `portal_playbook_${row.keyName}`,
    description: `${row.description || row.displayName} Önce portal_logx_list_hosts ile doğru hostname'i doğrula. ` +
      'Hemen sonuçlanmazsa jobId ile "henüz tamamlanmadı" döner — portal_logx_job_result ile takip edin.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Envanterdeki hostname (portal_logx_list_hosts çıktısından)' },
      },
      required: ['hostname'],
    },
    async exec({ hostname } = {}) {
      if (!hostname) throw new Error('hostname zorunlu.');
      const label = `[${hostname}] ${row.displayName}`;
      const result = await runReadOnlyAwxTemplate({
        templateId,
        extraVars: { target_hosts: hostname },
        limit: hostname,
      });
      if (result.pending) {
        rememberPendingJob(result.jobId, { mode: 'raw-template', label });
        return { text: pendingMessage(result.jobId) };
      }
      return { text: formatRawTemplateResult(label, result.output) };
    },
  };
}

// handler: 'ocp_cluster' — tek istisna: cluster adi → jump/bastion host cozumlemesi
// gerektirir (jenerik host_target kalibina uymaz). Template ID artik registry'den
// gelir (DB veya AWX_OCP_POD_STATUS_TEMPLATE_ID env fallback'i) — mantigin geri kalani
// ayni (bkz. server/ansible/playbooks/ocp_pod_status.yml).
function makeOcpPodStatusTool(row, templateId) {
  return {
    name: `portal_playbook_${row.keyName}`,
    description: `${row.description || row.displayName} Önce hangi cluster'ların kayıtlı olduğunu ` +
      'bilmiyorsan kullanıcıya sor veya Admin > Ansible Info > OCP Clusters listesine yönlendir. ' +
      'Hemen sonuçlanmazsa jobId ile "henüz tamamlanmadı" döner — portal_logx_job_result ile takip edin.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: { type: 'string', description: 'Kayıtlı OCP cluster adı (name veya display)' },
        namespace: { type: 'string', description: 'Opsiyonel — boş bırakılırsa tüm namespace\'ler taranır' },
        labelSelector: { type: 'string', description: 'Opsiyonel Kubernetes label selector (ör. app=payment)' },
      },
      required: ['clusterName'],
    },
    async exec({ clusterName, namespace, labelSelector } = {}) {
      if (!clusterName) throw new Error('clusterName zorunlu.');
      const runnerMod = require('../ansible/runner.cjs');
      const clusters = runnerMod.getOcpClusters();
      const q = String(clusterName).toLowerCase().trim();
      const cluster = clusters.find((c) => c.name?.toLowerCase() === q || c.display?.toLowerCase() === q)
        || clusters.find((c) => c.name?.toLowerCase().includes(q) || c.display?.toLowerCase().includes(q));
      if (!cluster) {
        return { text: `"${clusterName}" adında kayıtlı bir OCP cluster bulunamadı. Kayıtlı cluster'lar: ${clusters.map((c) => c.display || c.name).join(', ') || '(yok)'}` };
      }
      if (!cluster.jumpHost) {
        return { text: `"${cluster.display || cluster.name}" cluster'ı için jump/bastion host tanımlı değil — Admin > Ansible Info'dan ekleyin.` };
      }

      const label = `[${cluster.display || cluster.name}] ${row.displayName}`;
      const result = await runReadOnlyAwxTemplate({
        templateId,
        extraVars: {
          jump_host: cluster.jumpHost,
          namespace: namespace || cluster.namespace || '',
          label_selector: labelSelector || '',
        },
        limit: cluster.jumpHost,
      });
      if (result.pending) {
        rememberPendingJob(result.jobId, { mode: 'raw-template', label });
        return { text: pendingMessage(result.jobId) };
      }
      return { text: formatRawTemplateResult(label, result.output) };
    },
  };
}

// Kayit tablosunu okur, her satir icin etkin template ID'yi cozer (DB veya .env),
// hicbir kaynaktan gelmeyenleri ATLAR (sessizce — bkz. dosya basindaki not).
// AI-tetiklemeli altyapi araclari guvenlik-hassastir: her registry-turevi arac, istek sahibi
// kullanicinin `aitool:<keyName>` element gorunurlugune baglanir. Element registry'de yoksa
// canSee varsayilan GORUNUR doner (mevcut davranis korunur) — ama admin bir `aitool:<key>`
// elementi ekleyip belirli kullanici/role kapatarak o AI aracini dinamik olarak kisitlayabilir.
async function canUseTool(user, elementKey) {
  try {
    const { canSee } = require('../auth/visibility.cjs');
    return await canSee(user, elementKey);
  } catch {
    return true; // motor yoksa engelleme (mevcut davranis)
  }
}

async function buildRegistryTools(user) {
  let playbookRegistry;
  try { playbookRegistry = require('../ansible/playbook-registry.cjs'); }
  catch { return []; } // DB modulu yuklenemezse (or. MSSQL yok) sessizce bos liste

  let rows;
  try { rows = await playbookRegistry.listEnabled(); }
  catch { return []; } // DB erisilemezse sessizce bos liste — sohbet cokmemeli

  const tools = [];
  for (const row of rows) {
    const templateId = playbookRegistry.getEffectiveTemplateId(row);
    if (!templateId) continue; // yapilandirilmamis — arac hic olusturulmaz
    if (!(await canUseTool(user, `aitool:${row.keyName}`))) continue; // admin bu AI aracini gizlemis
    tools.push(row.handler === 'ocp_cluster' ? makeOcpPodStatusTool(row, templateId) : makeHostTargetTool(row, templateId));
  }
  return tools;
}

// Orchestrator'in bekledigi bicimde: { name, description, inputSchema, exec }
// user: { username, role } — rate limit/audit baglami ve (Ansible araci icin)
// rol-bazli erisim kisiti icin araclara baglanir.
async function getPortalTools(user = {}) {
  const username = user.username || 'anonymous';
  const tools = [
    listHostsTool, inventoryLookupTool, fetchLogTool, makeAnalyzeLogTool(username),
    makeJobResultTool(), splunkSearchTool, ...(await buildRegistryTools(user)),
  ];
  // AI-tetiklemeli Ansible LAUNCH araci: Admin rolu + `feature:ai_infra_launch` kill-switch.
  // Element varsayilan acik; admin bunu kapatarak AI'nin altyapi job'i baslatmasini tamamen
  // durdurabilir (guvenlik-hassas — bkz. proje notu: AI-triggers-infra).
  if (user.role === 'Admin' && (await canUseTool(user, 'feature:ai_infra_launch'))) {
    tools.push(makeAnsibleRunTemplateTool(user), makeAnsibleJobStatusTool());
  }
  return tools;
}

module.exports = {
  getPortalTools,
  // test-only: gercek 2s'leri beklemeden "hic terminal olmuyor" pending senaryosunu hizli
  // dogrulamak icin (review.md #23 testleri).
  _setQuickCheckDelayMs: (ms) => { _quickCheckDelayMs = ms; },
  _pendingJobs,
};
