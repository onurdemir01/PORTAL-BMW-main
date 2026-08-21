// server/audit/ocp-platforms.cjs — OpenShift cluster -> platform (tenant) eslemesi.
//
// KAYNAK: gar_bmt_ansible_scripts/bmw_openshift_jobs/global_variables/openshift_inventory.yaml
// icindeki "<platform>_<env>" gruplari (ark_prod, ark_test, hosting_qa, wyden_dev, ...).
// Portal o repoyu okuyamadigi icin esleme BURAYA yansitilir. Cluster listesi degisirse
// (yeni cluster eklenmesi/cikarilmasi) BURASI da guncellenmelidir.
//
// ── NEDEN ORTAM BURADAN GELMIYOR (kritik tasarim karari, 2026-08-21) ─────────────────
// yaml'daki gruplar "<platform>_<env>" gorunumunde ama ENV bilgisi GUVENILIR DEGIL:
//   ark_dev   -> [gbocptest1, gbocptest2, gbocptest4]
//   ark_test  -> [gbocptest1, gbocptest2, gbocptest4]   <-- ark_dev ile BIREBIR AYNI
//   ark_qa    -> [gbocpqa1, gbocpqa2, gbocptest4, gbocpankqa2]  <-- gbocptest4 ORTAK
// Yani ayni cluster hem dev hem test hem qa grubunda olabiliyor; cluster'a bakarak
// "bu uygulama dev'de mi test'te mi" sorusu YANITLANAMAZ. Gercek veriyle dogrulandi
// (2026-08-19 envanteri): ark_dev/ark_test cluster kumesinde 11.861 "-dev" ve 11.592
// "-test" namespace'i IC ICE duruyor; ark_qa kumesinde bile 4.005 "-dev" + 3.806 "-test"
// namespace'i var.
//
// COZUM: platform CLUSTER'dan, ortam NAMESPACE SON EKINDEN (-dev/-test/-qa/-prod) gelir.
// Bu, ARK Openshift SPA Raporu'nda da dogrulanan AYNI kuraldir.
'use strict';

// platform -> o platforma ait TUM cluster'lar (ortam ayrimi YOK, bilerek birlestirildi)
const PLATFORM_CLUSTERS = {
  ark: [
    'gbocptest1', 'gbocptest2', 'gbocptest4',
    'gbocpqa1', 'gbocpqa2', 'gbocpankqa2',
    'gbocpprod1', 'gbocpprod2', 'gbocpankprod2', 'gbocpprod4', 'gbocpdrcprod1',
  ],
  ark_ai: ['gbocparkaiprod1', 'gbocparkaiprod2', 'gbocpankarkaiprod1', 'gbocparkaitest1', 'gbocparkaitest2'],
  ark_lab: ['gbocplab1', 'gbocplab2'],
  ark_edu: ['gbocpedu1'],
  hosting: ['gbocp3rdprod1', 'gbocp3rdprod2', 'gbocpank3rdprod2', 'gbocp3rdtest3', 'gbocp3rdtest4'],
  'istirak-hosting': ['giocp3rdprod1', 'giocp3rdprod2', 'giocpank3rdprod2', 'giocp3rdtest3', 'giocp3rdtest4'],
  wyden: ['giocp3rdwyprod1', 'giocp3rdwyprod2', 'giocpank3rdwyprod1', 'giocp3rdwytest1', 'giocp3rdwytest2'],
  metaco_das: ['daocpprod1', 'daocpprod2', 'daocpankprod1', 'daocptest1'],
  metaco_gar: ['gbocp3rdcwprod1', 'gbocp3rdcwprod2', 'gbocpank3rdcwprod1', 'gbocp3rdcwtest1'],
  instana: ['gbocpinsprod2'],
  cicd: ['gbocpcicd2', 'gbocpcicd3'],
};

// cluster -> platform (ters indeks)
const CLUSTER_TO_PLATFORM = new Map();
for (const [platform, clusters] of Object.entries(PLATFORM_CLUSTERS)) {
  for (const c of clusters) CLUSTER_TO_PLATFORM.set(c.toLowerCase(), platform);
}

const ENVS = ['dev', 'test', 'qa', 'prod'];

// Ortam YALNIZCA namespace son ekinden belirlenir (yukaridaki nota bakin). Eslesmeyen
// namespace'ler (ornek "falcon-operator", "openshift-monitoring") null doner ve ortam
// karsilastirmasina HIC girmez - bunlar altyapi/operator namespace'leri, uygulama degil.
function envOfNamespace(ns) {
  const n = String(ns || '').toLowerCase();
  for (const e of ENVS) if (n.endsWith('-' + e)) return e;
  return null;
}

function platformOfCluster(cluster) {
  return CLUSTER_TO_PLATFORM.get(String(cluster || '').toLowerCase()) || null;
}

module.exports = { PLATFORM_CLUSTERS, ENVS, envOfNamespace, platformOfCluster };
