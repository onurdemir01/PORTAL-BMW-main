// server/logx/v2/ocp-health.cjs — OCP kataloğundaki bir cluster satirinin CANLI kontrolu:
//   (1) Baglanti Testi — cluster'in kendi API adresine GET /version
//   (2) Pod Durumu     — `ocp_pod_status` playbook'u, cluster'in jump server'i uzerinden
//
// NEDEN BURADA: bu iki aksiyon eskiden Admin > Ansible Yapilandirma altindaki AYRI bir
// OCP katalogunda (ansible_ocp_clusters / server/ansible/ocp-store.cjs) yasiyordu. Iki
// katalog paralel yasadigi icin biri (LogX'inki) doluyken digeri BOS kalabiliyordu —
// nitekim uretimde oyleydi ve "OCP Cluster Yonetimi" ekrani hicbir sey gostermiyordu.
// Tek katalog: ocp_cluster_index. Aksiyonlar da onunla birlikte buraya tasindi.
'use strict';

const http = require('http');
const https = require('https');

const db = require('../../db/index.cjs');

// Satiri KATALOGDAN okur (client'in gonderdigi degerlere guvenilmez).
async function getClusterRow(id) {
  const { rows } = await db.query(
    `SELECT TOP 1 id, env, tenant, cluster_name, api_url, token, terminal_host, default_namespace
     FROM ocp_cluster_index WHERE id = $1`,
    [Number(id)]
  );
  return rows[0] || null;
}

// Cluster'in kendi API adresine hafif bir erisilebilirlik testi.
//
// TOKENSIZ CALISIR ve bu BILEREK boyledir: portal kataloğunda cluster token'i tutulmasi
// ZORUNLU degil (parola/token portalda tutulmama ilkesi). Token yoksa OCP 401/403 doner —
// bu da "adres ayakta ve TLS el sikismasi tamam" demektir, yani ERISILEBILIR sayilir.
// Sertifika dogrulamasi kapali: kurumsal cluster'lar ic CA kullaniyor ve bu test bir
// guvenlik kontrolu degil, bir erisilebilirlik kontroludur.
function probeApiUrl(apiUrl, token) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL('/version', apiUrl);
    } catch {
      resolve({ ok: false, message: 'Geçersiz API URL.' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const request = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      rejectUnauthorized: false,
      timeout: 5000,
    }, (response) => {
      let data = '';
      response.on('data', (c) => { data += c; });
      response.on('end', () => {
        const code = response.statusCode || 0;
        if (code && code < 400) resolve({ ok: true });
        else if (code === 401 || code === 403) {
          resolve({ ok: true, message: `Erişilebilir (HTTP ${code} — kimlik doğrulama beklenen davranış, token portalda tutulmaz).` });
        } else {
          resolve({ ok: false, message: `HTTP ${code}: ${data.slice(0, 150)}` });
        }
      });
    });
    request.on('error', (err) => resolve({ ok: false, message: err.message }));
    request.on('timeout', () => { request.destroy(); resolve({ ok: false, message: 'Bağlantı zaman aşımına uğradı.' }); });
    request.end();
  });
}

async function testConnection(id) {
  const row = await getClusterRow(id);
  if (!row) throw Object.assign(new Error('Cluster bulunamadı.'), { status: 404 });
  if (!row.api_url) {
    throw Object.assign(
      new Error('Bu cluster için API URL tanımlı değil — satırdaki "API URL" alanını doldurun.'),
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  const result = await probeApiUrl(row.api_url, row.token);
  const responseTimeMs = Date.now() - startedAt;
  const status = result.ok ? 'ok' : 'unreachable';

  // Durum best-effort yazilir: yazamamak testi basarisiz saymaz.
  await db.query(
    `UPDATE ocp_cluster_index SET connection_status = $1, last_checked_at = GETUTCDATE() WHERE id = $2`,
    [status, Number(id)]
  ).catch(() => {});

  return { ok: result.ok, message: result.message, responseTimeMs, status };
}

// Pod durumu: salt-okunur `oc get`. Bastion cozumlemesi kataloğun KENDI kapisindan
// (resolveTerminalHosts) gecer — cluster satirinda jump server bos ise tenant/env yedegi
// devreye girer; iki ekranda iki farkli sonuc cikmasin.
async function podStatus(id, { namespace = '', labelSelector = '' } = {}) {
  const row = await getClusterRow(id);
  if (!row) throw Object.assign(new Error('Cluster bulunamadı.'), { status: 404 });

  const adminData = require('./admin.cjs');
  const { hosts, missing } = await adminData.resolveTerminalHosts(row.env, row.tenant, [row.cluster_name]);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Bu cluster için Jump Server tanımlı değil: ${row.cluster_name} — satırdaki ` +
        `"Jump Server" alanını doldurun ya da "${row.tenant}/${row.env}" için yedek eşleme tanımlayın.`
      ),
      { status: 400 }
    );
  }
  const jumpHost = hosts[row.cluster_name];

  const runner = require('../../ansible/runner.cjs');
  const playbookRegistry = require('../../ansible/playbook-registry.cjs');
  const registryRow = await playbookRegistry.getByKey('ocp_pod_status');
  const templateId = registryRow && playbookRegistry.getEffectiveTemplateId(registryRow);
  if (!templateId) {
    throw Object.assign(
      new Error('OCP pod durumu için template ID tanımlı değil (Admin > Playbook Kayıtları veya AWX_OCP_POD_STATUS_TEMPLATE_ID).'),
      { status: 503 }
    );
  }

  const extraVars = {
    jump_host: jumpHost,
    namespace: String(namespace || row.default_namespace || ''),
    label_selector: String(labelSelector || ''),
  };
  // AWX "Prompt on launch" kapaliysa bu degiskenler sessizce yutulur ve playbook
  // --all-namespaces ile calisir (yanlis sonuc) — once uyar.
  await require('../../ansible/template-preflight.cjs')
    .assertTemplateAcceptsExtraVars(registryRow.awxServerId ?? 0, templateId, extraVars, { label: 'ocp_pod_status' });

  const launch = await runner.launchJob(Number(templateId), extraVars, jumpHost);

  // AWX job'i kisa surer (salt-okunur `oc get`); 60 sn ustu bekleme anlamsiz.
  let jobStatus = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    jobStatus = await runner.getJobStatus(launch.jobId);
    if (['successful', 'failed', 'error', 'canceled'].includes(jobStatus.status)) break;
  }
  if (!jobStatus || jobStatus.status !== 'successful') {
    throw Object.assign(
      new Error(`AWX job ${jobStatus?.status || 'zaman aşımı'} (job ${launch.jobId}).`),
      { status: 502 }
    );
  }
  const output = await runner.getJobOutput(launch.jobId);
  return { ok: true, output: output.output, jobId: launch.jobId, jumpHost };
}

module.exports = { testConnection, podStatus, getClusterRow };
