// server/opsx/pod-parse.cjs — Pod kesfi playbook'unun (opsx_openshift_pods.yaml)
// ciktisini ayristirir.
//
// NEDEN PORTALDA: playbook `oc get pods --no-headers` ciktisini HAM satirlar olarak
// birakir; ayristirma burada yapilir — logx/v2/ocp-app-parse.cjs ile AYNI tasarim
// karari (Jinja'da dict listesi kurmak ek collection bagimliligi ya da okunmasi zor
// filtre zincirleri gerektirir; Node tarafinda ayristirma birim testiyle dogrulanabilir).
//
// Satir bicimi (bosluk ayrilmis):  NAME  READY  STATUS  RESTARTS  AGE
//   my-app-7d8f9c5b4-x2k9p   1/1   Running   0            5d
//   another-pod-abc          0/1   Pending   2 (3d ago)   10m
//
// DIKKAT — RESTARTS SUTUNU BOSLUK ICEREBILIR: guncel kubectl/oc surumleri yeniden
// baslatma sayisini "2 (3d ago)" bicimiyle yazar. Bu yuzden satir bastan 3 alan +
// SONDAN 1 alan (AGE) olarak sabitlenir, ARADA KALAN her sey RESTARTS sayilir. Naif
// bir `split()[3]` bu satirlarda AGE'i "(3d" olarak okurdu.
'use strict';

// Tek satir → obje. Bozuk/eksik satir null doner (cagiran filtreler).
function parsePodLine(line) {
  const raw = String(line == null ? '' : line).trim();
  if (!raw) return null;

  const parts = raw.split(/\s+/);
  // NAME READY STATUS RESTARTS AGE → en az 5 alan.
  if (parts.length < 5) return null;

  const name = parts[0];
  if (!name) return null;

  return {
    name,
    ready: parts[1],
    status: parts[2],
    restarts: parts.slice(3, -1).join(' '),
    age: parts[parts.length - 1],
  };
}

// artifacts.opsx_pods_result → portal ic bicimi.
//
// COK-CLUSTER x COK-NAMESPACE (bkz. server/opsx/index.cjs resolveOcpClusterFanout): bir
// tenant'a birden fazla gercek cluster bagli olabilir VE kullanici birden fazla namespace
// secebilir — playbook artik HER (cluster,namespace) cifti icin AYRI bir `oc get pods`
// ciktisini AYRI bir sonuc olarak (hata izole) doner —
// `results: [{cluster, namespace, ok, lines}|{cluster, namespace, ok:false, error}]`.
// Her satir ayristirilip pod'a HEM `cluster` HEM `namespace` etiketi eklenir; basarisiz
// (cluster,namespace) ciftleri (baglanilamadiysa) `error`'a toplanir, DIGERLERINI engellemez.
function parsePodDiscoveryResult(artifacts) {
  const a = artifacts || {};
  const clusterResults = Array.isArray(a.results) ? a.results : [];
  const pods = [];
  const errors = [];
  const namespaceSet = new Set();
  for (const cr of clusterResults) {
    const cluster = String(cr?.cluster || '').trim();
    const namespace = String(cr?.namespace || '').trim();
    if (namespace) namespaceSet.add(namespace);
    if (cr?.ok === false) {
      errors.push(`${cluster || '?'}/${namespace || '?'}: ${String(cr?.error || 'Pod listesi alınamadı').trim()}`);
      continue;
    }
    const lines = Array.isArray(cr?.lines) ? cr.lines : [];
    for (const line of lines) {
      const parsed = parsePodLine(line);
      if (parsed) pods.push({ ...parsed, cluster, namespace });
    }
  }

  return {
    // `trim`: playbook katlamali skaler (`>-`) kullanabiliyor ve Jinja blok etiketleri
    // deger basina bosluk birakabiliyor (logx tarafinda birebir bu hata yasandi).
    overallStatus: String(a.overall_status || 'unknown').trim() || 'unknown',
    namespaces: [...namespaceSet],
    error: errors.join(' | '),
    pods,
  };
}

module.exports = { parsePodLine, parsePodDiscoveryResult };
