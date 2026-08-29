// server/chaos/result.cjs — playbook'un `set_stats` ile yayinladigi artifact'i okur.
//
// AWX'in artifact'i UC farkli sekilde sunabildigi uretimde GORULDU (controller surumune
// gore degisiyor). OpsX'teki `extractStatsKey` toleransinin (server/opsx/index.cjs:234)
// aynisi — yeni bir tolerans icat etmiyoruz, calisan deseni kullaniyoruz.
'use strict';

function extractStatsKey(rawArtifacts, key) {
  const a = rawArtifacts || {};
  const direct = a[key] ?? a.data?.[key] ?? a.ansible_stats?.data?.[key];
  // STRING KONTROLU DONUSTEN ONCE OLMALI. Ilk yazimda `direct` dolu ise KOSULSUZ
  // donuluyordu; deger bir JSON STRING oldugunda (bazi AWX kurulumlarinda oyle geliyor)
  // ham string donuyor ve asagidaki ayristirma dali OLU KOD kaliyordu. Kendi testim
  // yakaladi.
  if (typeof direct === 'string') {
    const t = direct.trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  }
  if (direct !== undefined && direct !== null) return direct;
  // Bazi kurulumlar degeri ayri bir `<key>_json` alaninda sunuyor.
  for (const candidate of [a[`${key}_json`], a.data?.[`${key}_json`]]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      try { return JSON.parse(candidate); } catch { /* bozuksa yok say */ }
    }
  }
  return null;
}

// `overall_status` KATLAMALI SKALERDE uretiliyor ve bu depoda uretimde "      failed"
// olarak yayinlandigi GORULDU. Playbook tarafinda `| trim` var ama portal ona GUVENMEZ:
// sozlesmenin iki ucu da ayni anda yanlis olabilir ve sonucu kullanici oder.
function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

// Jinja/`set_stats` bir bool'u JSON `true` OLARAK DA, `"True"` STRING'I OLARAK DA
// gonderebilir (AWX controller surumune ve `| bool` filtresinin nerede uygulandigina
// gore degisiyor). `=== true` karsilastirmasi ikincisini SESSIZCE kacirir: kirpilmis
// bir sonuc "kirpilmadi" gorunur ve kullanici eksik listeye tam liste sanip bakar.
// TEK yardimci — her bool alan bundan gecer.
function toBool(value) {
  if (value === true) return true;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  return false;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Mutasyon isinin sonucu. Playbook IKI bicim yayinlayabilir:
//   * tam sonuc          — rapor asamasina gelinebilen calistirmalar
//   * `stage: validation` — girdi dogrulamasi dustugunde (portalin en sik gordugu sinif)
// Ikisini de AYNI sekle indirger; ekran tek bir bicim okur.
function extractChaosResult(rawArtifacts) {
  const raw = extractStatsKey(rawArtifacts, 'chaos_scale_result');
  if (!raw || typeof raw !== 'object') return null;

  const counts = raw.counts || {};
  return {
    overallStatus: normalizeStatus(raw.overall_status),
    stage: String(raw.stage || 'execution'),
    mode: String(raw.mode || ''),
    action: String(raw.action || ''),
    namespace: String(raw.namespace || ''),
    platform: String(raw.platform || ''),
    environment: String(raw.environment || ''),
    catalogSource: String(raw.catalog_source || 'file'),
    clusterMode: String(raw.cluster_mode || ''),
    clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
    apps: Array.isArray(raw.apps) ? raw.apps : [],
    targetReplicas: raw.target_replicas === '' || raw.target_replicas == null ? null : String(raw.target_replicas),
    // `strict_blocked` FAIL'DEN AYRI gosterilmeli: hicbir sey uygulanmadi cunku on
    // kontrol dustu ve kismi calistirma kapaliydi — cluster'da HICBIR degisiklik yok.
    // Bu, kullanici icin kotu degil IYI haber ve oyle sunulmali.
    strictBlocked: toBool(raw.strict_blocked),
    counts: {
      planned: toInt(counts.planned), ok: toInt(counts.ok),
      warn: toInt(counts.warn), fail: toInt(counts.fail),
      precheckFail: toInt(counts.precheck_fail), verifyOk: toInt(counts.verify_ok),
      verifyFail: toInt(counts.verify_fail), blocked: toInt(counts.blocked),
      hpaSeen: toInt(counts.hpa_seen),
    },
    targets: (Array.isArray(raw.targets) ? raw.targets : []).map((t) => ({
      cluster: String(t.cluster || ''), app: String(t.app || ''),
      kind: String(t.kind || '-'), status: normalizeStatus(t.status),
      detail: String(t.detail || ''),
    })),
    targetsTruncated: toBool(raw.targets_truncated),
    targetsTotal: toInt(raw.targets_total),
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    rowsTruncated: toBool(raw.rows_truncated),
    rowsTotal: toInt(raw.rows_total),
    validationError: raw.validation_error ? String(raw.validation_error) : null,
    failedTask: raw.failed_task ? String(raw.failed_task) : null,
    jobId: String(raw.job_id || ''),
  };
}

// Kesif satirlarindaki `detail` alani `anahtar=deger` ciftleri tasir (bkz.
// chaos_discovery.sh). Bosluk ayrac; DEGERLER bosluk icermez (imaj/ad/sayilar).
function parseDetailPairs(detail) {
  const out = {};
  for (const part of String(detail || '').split(' ')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

// Kesif isinin sonucu. Ham satirlari ekranin dogrudan kullanabilecegi nesnelere cevirir.
function extractDiscoveryResult(rawArtifacts) {
  const raw = extractStatsKey(rawArtifacts, 'chaos_discovery_result');
  if (!raw || typeof raw !== 'object') return null;

  const items = Array.isArray(raw.items) ? raw.items : [];
  const counts = raw.counts || {};
  const base = {
    // Kesifte durumlar KUCUK harf ('ok'|'warning'|'partial'|'error') — mutasyon
    // sonucundan (OK/WARN/FAIL) BILEREK farkli, ikisi karistirilmasin.
    overallStatus: String(raw.overall_status ?? '').trim().toLowerCase(),
    mode: String(raw.mode || ''),
    namespace: String(raw.namespace || ''),
    platform: String(raw.platform || ''),
    environment: String(raw.environment || ''),
    catalogSource: String(raw.catalog_source || 'file'),
    clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
    failedClusters: Array.isArray(raw.failed_clusters) ? raw.failed_clusters : [],
    counts: { ok: toInt(counts.ok), warn: toInt(counts.warn), fail: toInt(counts.fail) },
    problems: items
      .filter((i) => normalizeStatus(i.status) === 'FAIL' || normalizeStatus(i.status) === 'WARN')
      .map((i) => ({ cluster: String(i.cluster || ''), step: String(i.step || ''), status: normalizeStatus(i.status), detail: String(i.detail || '') })),
  };

  if (base.mode === 'workloads') {
    base.workloads = items
      .filter((i) => String(i.step) === 'WORKLOAD' && normalizeStatus(i.status) === 'OK')
      .map((i) => {
        const d = parseDetailPairs(i.detail);
        const prev = /^[0-9]+$/.test(d.previous_replicas || '') ? Number(d.previous_replicas) : null;
        return {
          cluster: String(i.cluster || ''), name: String(i.app || ''), kind: String(i.kind || '-'),
          resource: d.resource || '', specReplicas: toInt(d.spec),
          statusReplicas: toInt(d.status), readyReplicas: toInt(d.ready),
          hasHpa: d.hpa === 'yes', image: d.image && d.image !== '-' ? d.image : null,
          // EKRANIN ASIL KARAR GIRDISI: geri alinabilir bir durum var mi?
          // `Geri Al` yalnizca burasi doluyken secilebilir olacak — bugun bu,
          // is calistiktan SONRA `STATE;FAIL` olarak ogreniliyor.
          statePhase: d.state_phase && d.state_phase !== '-' ? d.state_phase : null,
          previousReplicas: prev,
          restorable: prev !== null,
        };
      });
  }

  if (base.mode === 'state') {
    base.states = items
      .filter((i) => String(i.step) === 'STATE' && normalizeStatus(i.status) === 'OK')
      .map((i) => {
        const d = parseDetailPairs(i.detail);
        return {
          cluster: String(i.cluster || ''), appName: String(i.app || ''), kind: String(i.kind || '-'),
          configMap: d.cm || '',
          previousReplicas: /^[0-9]+$/.test(d.previous_replicas || '') ? Number(d.previous_replicas) : null,
          phase: d.phase && d.phase !== '-' ? d.phase : null,
          createdAt: d.created_at && d.created_at !== '-' ? d.created_at : null,
          createdBy: d.created_by && d.created_by !== '-' ? d.created_by : null,
          jobId: d.job_id && d.job_id !== '-' ? d.job_id : null,
        };
      });
  }

  if (base.mode === 'health') {
    base.health = items
      .filter((i) => ['PODS', 'EVENTS'].includes(String(i.step)))
      .map((i) => ({
        cluster: String(i.cluster || ''), app: String(i.app || ''),
        step: String(i.step), status: normalizeStatus(i.status), detail: String(i.detail || ''),
      }));
  }

  return base;
}

module.exports = { extractStatsKey, extractChaosResult, extractDiscoveryResult, parseDetailPairs, normalizeStatus, toBool };
