// server/crypto-hub/index.cjs — Crypto Hub (2026-09-25).
//
// Kullanici: "ekibimizin yonettigi ucuncu parti uygulamalardan ikisi (Metaco, Wyden) icin
// gelistirici ve rezilyans ekiplerine Portal'dan bir arayuz sunmak istiyorum. Kullanici once
// hangi domainde ve hangi ortamda islem yapacagini secsin."
//
// FAZ 1 = DURUM + SURUMLER, salt okunur. Veri kaynagi bmw_automation_folder/crypto_hub
// taramasi -> dbo.Crypto_Hub_* tablolari. Bu modul yalniz OKUR ve bir de taramayi tetikler.
//
// "OLCULEMEDI" ILE "YOK" AYRI (taramadan devralinan sozlesme): registry kimligi verilmediyse
// ya da bir asama dustuyse Crypto_Hub_Notes'ta NOTE/ERR satiri olur; ekran bunu "olculemedi"
// diye gosterir, "yeni surum yok" DEMEZ.
'use strict';

const express = require('express');
const { CRYPTO_TENANTS, tenantOf, selectionTree, isOpen } = require('../../shared/cryptoHubTenants.cjs');

// Production simdilik kapali (kullanici, 2026-09-26). Ekran zaten sectirmiyor; bu kontrol
// DOGRUDAN API cagrisini de keser - aksi halde "kapali" yalnizca gorsel bir suslemeden ibaret
// olurdu.
const CLOSED_MSG = 'Production ortamları Crypto Hub\'da şimdilik kapalı.';

const REGISTRY_KEY = 'crypto_hub_inventory';

// Son tarama okumasi 1-2 sn surer; ekran her sekme degisiminde DB'yi yormasin.
let _cache = { at: 0, key: '', value: null };
const CACHE_MS = 60 * 1000;

/** Surum karsilastirmasi: kosan chart surumu vs registry etiketleri.
 *  Semantik siralama (1.9 < 1.10) - metin siralamasi yanlis "en yeni" verirdi. */
function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/);
  const pb = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number(pa[i]);
    const y = Number(pb[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x !== y) return x - y;
    } else {
      const sx = pa[i] || '';
      const sy = pb[i] || '';
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return 0;
}

async function loadTenant(tenant) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const p = [{ name: 't', type: sql.NVarChar(64), value: tenant.key }];
  const son = (table) => `(SELECT MAX(scan_date) FROM ${table} WHERE tenant_key = @t)`;

  const [comp, rel, tag, note] = await Promise.all([
    query(`SELECT kind, name, want, ready, image, version, scanned_at
             FROM dbo.Crypto_Hub_Components
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Components')}
            ORDER BY kind, name`, p).then((r) => r.recordset || []).catch(() => null),
    query(`SELECT release_name, chart, chart_version, app_version, status, updated_at, scanned_at
             FROM dbo.Crypto_Hub_Releases
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Releases')}`, p)
      .then((r) => r.recordset || []).catch(() => []),
    query(`SELECT chart_ref, tag
             FROM dbo.Crypto_Hub_ChartTags
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_ChartTags')}`, p)
      .then((r) => r.recordset || []).catch(() => []),
    query(`SELECT level, stage, message, scanned_at
             FROM dbo.Crypto_Hub_Notes
            WHERE tenant_key = @t AND scan_date = ${son('dbo.Crypto_Hub_Notes')}`, p)
      .then((r) => r.recordset || []).catch(() => []),
  ]);

  // comp null = tablo yok (DDL calistirilmamis). "Bilesen yok" ile ayni sey DEGIL.
  if (comp === null) {
    return { tableMissing: true, components: [], releases: [], tags: [], notes: [], scannedAt: null, versions: null };
  }

  const scannedAt = [...comp, ...rel, ...tag, ...note]
    .map((r) => r.scanned_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const components = comp.map((r) => ({
    kind: r.kind, name: r.name,
    want: r.want == null ? null : Number(r.want),
    ready: r.ready == null ? null : Number(r.ready),
    image: r.image || '', version: r.version || '',
    state: r.want === 0 ? 'stopped' : (Number(r.ready) >= Number(r.want) ? 'running' : 'degraded'),
  }));

  const releases = rel.map((r) => ({
    name: r.release_name, chart: r.chart || '', chartVersion: r.chart_version || '',
    appVersion: r.app_version || '', status: r.status || '', updatedAt: r.updated_at || '',
  }));

  const tagList = [...new Set(tag.map((r) => String(r.tag)))].sort(cmpVersion);
  // KOSAN SURUM ANA RELEASE'TEN OKUNUR. Wyden namespace'inde `wydenapp` yaninda `keycloak`
  // ve `wyden-vault-*` da var; helm list siralamasina guvenip releases[0] almak, ekranda
  // Wyden surumu yerine Keycloak surumunu gosterirdi.
  const main = releases.find((r) => r.name === tenant.helmRelease) || releases[0];
  const running = main?.chartVersion || '';
  const tagsMeasured = tagList.length > 0;
  const newer = tagsMeasured && running ? tagList.filter((v) => cmpVersion(v, running) > 0) : [];

  return {
    tableMissing: false,
    scannedAt,
    components,
    releases,
    notes: note.map((r) => ({ level: r.level, stage: r.stage || '', message: r.message || '' })),
    versions: {
      running,
      release: main ? main.name : tenant.helmRelease,
      // OLCULEMEDI: etiket listesi bos + NOTE varsa "yeni surum yok" DEMEYIZ.
      measured: tagsMeasured,
      available: tagList,
      newer,
      latest: tagList.length ? tagList[tagList.length - 1] : '',
    },
    summary: {
      total: components.length,
      running: components.filter((c) => c.state === 'running').length,
      stopped: components.filter((c) => c.state === 'stopped').length,
      degraded: components.filter((c) => c.state === 'degraded').length,
    },
  };
}

function initCryptoHub(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);

  try {
    const { requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisible('CryptoHub'));
  } catch { /* motor yoksa yoksay */ }

  // Secim agaci: uygulama -> domain -> ortam. Tarama HIC kosmamis olsa da doner ki
  // kullanici ekrani bos gormesin, neyin eksik oldugunu okusun.
  router.get('/tenants', (_req, res) => {
    res.json({ ok: true, apps: selectionTree() });
  });

  router.get('/overview', async (req, res) => {
    const tenant = tenantOf(req.query.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı. Geçerli anahtarlar: ' + CRYPTO_TENANTS.map((t) => t.key).join(', ') });
    }
    if (!isOpen(tenant)) return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!tenant.namespace) {
      return res.json({
        ok: true, tenant, notConfigured: true,
        message: `${tenant.appLabel} ${tenant.envLabel} için namespace/helm tanımı henüz girilmedi — tarama bu ortamı atlıyor.`,
      });
    }
    const fresh = String(req.query.fresh || '') === '1';
    if (!fresh && _cache.value && _cache.key === tenant.key && Date.now() - _cache.at < CACHE_MS) {
      return res.json({ ok: true, tenant, cached: true, ..._cache.value });
    }
    try {
      const value = await loadTenant(tenant);
      _cache = { at: Date.now(), key: tenant.key, value };
      res.json({ ok: true, tenant, ...value });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // Taramayi SIMDI kostur (yalniz secili kiraci). Yazan bir is DEGIL - tarama salt okunur.
  router.post('/rescan', async (req, res) => {
    const tenant = tenantOf(req.body?.tenant);
    if (!tenant) return res.status(400).json({ ok: false, message: 'Bilinmeyen kiracı.' });
    if (!isOpen(tenant)) return res.status(403).json({ ok: false, closed: true, message: CLOSED_MSG });
    if (!tenant.namespace) return res.status(409).json({ ok: false, message: 'Bu ortam henüz yapılandırılmadı.' });
    try {
      const reg = require('../ansible/playbook-registry.cjs');
      const row = await reg.getByKey(REGISTRY_KEY).catch(() => null);
      const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
      const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
      if (!templateId) {
        return res.status(501).json({ ok: false, message: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${REGISTRY_KEY}" satırına Template ID girilmeli.` });
      }
      const extraVars = { crypto_hub_keys: tenant.key };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: REGISTRY_KEY });
      const user = req.session?.user || {};
      const result = await require('../ansible/runner.cjs').launchJobOnServer(serverId, templateId, extraVars, '', user);
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.username || 'unknown', serverId, templateId, `Crypto Hub: ${tenant.key}`, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)],
        );
      } catch (e) { console.warn('[CryptoHub] job gecmisi yazilamadi:', e.message); }
      _cache = { at: 0, key: '', value: null };
      res.json({ ok: true, jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Ekran "Taramayi tazele" isini is-takipcisinde izler; bitince onbellek dusurulur ki
  // kullanici F5'siz taze veriyi gorsun.
  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    }
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([
        runner.getJobStatusOnServer(serverId, jobId),
        runner.getJobOutputOnServer(serverId, jobId),
      ]);
      if (['successful', 'failed', 'error', 'canceled'].includes(statusInfo.status)) {
        _cache = { at: 0, key: '', value: null };
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '' });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/crypto-hub', router);
  console.log('[CryptoHub] module mounted at /api/crypto-hub');
}

module.exports = { initCryptoHub, cmpVersion, loadTenant };
