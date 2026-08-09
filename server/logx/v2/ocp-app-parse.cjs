// server/logx/v2/ocp-app-parse.cjs — Uygulama/obje kesfi playbook'unun ciktisini ayristirir.
//
// NEDEN PORTALDA: playbook `oc get ... -o jsonpath` ile SATIR SATIR duz metin uretir
// (tam JSON pod spec'leri AWX artifact'ini gereksiz sisirirdi ve Jinja'da dict listesi
// kurmak ya ek collection bagimliligi ya da okunmasi zor filtre zincirleri gerektirirdi).
// Burada ayristirmak hem kucuk hem birim testiyle dogrulanabilir.
//
// Satir bicimi:  kind|name|replicas|image|podImage|labelApp|created
// Ayirici `|` guvenlidir: Kubernetes ad/etiket degerlerinde bu karakter yasaktir.
'use strict';

const FIELDS = 7;

// Tek satir → obje. Bozuk/eksik satir null doner (cagiran filtreler).
function parseObjectLine(line) {
  const raw = String(line == null ? '' : line);
  if (!raw.trim()) return null;

  const parts = raw.split('|');
  // Alan sayisi TAM tutmali. Az ise satir yarim; FAZLA ise bir alan (pratikte `image`,
  // cunku Kubernetes image dizesini bicim olarak dogrulamaz) icinde `|` gecmis ve tum
  // alanlar KAYMIS demektir — sessizce yanlis veri yazmaktansa satiri atiyoruz.
  // Ad ve etiket degerlerinde `|` zaten yasak, o yuzden kayma yalnizca buradan gelebilir.
  if (parts.length !== FIELDS) return null;

  const [kind, name, replicas, image, podImage, labelApp, created] = parts.map((p) => p.trim());
  if (!name) return null;

  const n = Number(replicas);
  return {
    kind: kind || 'Unknown',
    name,
    // Service/Route gibi tiplerde replicas YOKTUR — 0 ile karistirmamak icin null.
    replicas: replicas !== '' && Number.isFinite(n) ? n : null,
    // Is yuklerinde spec.template.spec.containers[0], Pod'da spec.containers[0].
    image: image || podImage || null,
    labelApp: labelApp || null,
    created: created || null,
  };
}

// Playbook'un `results[]` ogesi → { cluster_name, namespace, status, error, objects[] }
function parseResultEntry(entry) {
  const e = entry || {};
  const objects = (Array.isArray(e.lines) ? e.lines : [])
    .map(parseObjectLine)
    .filter(Boolean);
  return {
    clusterName: String(e.cluster_name || ''),
    namespace: String(e.namespace || ''),
    status: e.status === 'ok' ? 'ok' : 'error',
    error: String(e.error || ''),
    objects,
  };
}

// artifacts.logx_result → portal ic bicimi. Cluster bazinda gruplama BURADA yapilir
// (playbook duz liste dondurur; gruplama Jinja'da gereksiz karmasik olurdu).
function parseAppDiscoveryResult(artifacts) {
  const a = artifacts || {};
  const entries = (Array.isArray(a.results) ? a.results : []).map(parseResultEntry);

  const byCluster = new Map();
  for (const e of entries) {
    if (!byCluster.has(e.clusterName)) byCluster.set(e.clusterName, []);
    byCluster.get(e.clusterName).push({
      namespace: e.namespace,
      status: e.status,
      error: e.error,
      objects: e.objects,
    });
  }

  return {
    // `trim`: playbook katlamali skaler (`>-`) kullaniyor; Jinja blok etiketleri deger
    // basina bosluk birakabiliyor ve "  success" ile 'success' karsilastirmasi tutmuyordu.
    overallStatus: String(a.overall_status || 'unknown').trim() || 'unknown',
    clusters: [...byCluster.entries()].map(([clusterName, namespaces]) => ({
      clusterName,
      namespaces,
    })),
    // Onbellege yazarken duz liste daha kullanisli.
    entries,
  };
}

module.exports = { parseObjectLine, parseResultEntry, parseAppDiscoveryResult, FIELDS };
