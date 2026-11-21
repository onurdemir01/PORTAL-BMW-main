// server/audit/ocp-platforms.cjs — OpenShift cluster -> platform (tenant) eslemesi.
//
// KAYNAK: gar_bmt_ansible_scripts/bmw_openshift_jobs/global_variables/openshift_inventory.yaml
// icindeki "<platform>_<env>" gruplari (ark_prod, ark_test, hosting_qa, wyden_dev, ...).
// Portal o repoyu okuyamadigi icin esleme BURAYA yansitilir. Cluster listesi degisirse
// (yeni cluster eklenmesi/cikarilmasi) BURASI da guncellenmelidir.
//
// ── NEDEN ORTAM BURADAN GELMIYOR (kritik tasarim karari, 2026-08-21) ─────────────────
// yaml'daki gruplar "<platform>_<env>" gorunumunde ama ENV bilgisi GUVENILIR DEGIL:
//   ark_dev   -> [orocptest1, orocptest2, orocptest4]
//   ark_test  -> [orocptest1, orocptest2, orocptest4]   <-- ark_dev ile BIREBIR AYNI
//   ark_qa    -> [orocpqa1, orocpqa2, orocptest4, orocpankqa2]  <-- orocptest4 ORTAK
// Yani ayni cluster hem dev hem test hem qa grubunda olabiliyor; cluster'a bakarak
// "bu uygulama dev'de mi test'te mi" sorusu YANITLANAMAZ. Gercek veriyle dogrulandi
// (2026-08-19 envanteri): ark_dev/ark_test cluster kumesinde 11.861 "-dev" ve 11.592
// "-test" namespace'i IC ICE duruyor; ark_qa kumesinde bile 4.005 "-dev" + 3.806 "-test"
// namespace'i var.
//
// COZUM: platform CLUSTER'dan, ortam NAMESPACE SON EKINDEN (-dev/-test/-qa/-prod) gelir.
// Bu, ARK Openshift SPA Raporu'nda da dogrulanan AYNI kuraldir.
'use strict';

// KUME ADLARI KOD DISINDA (2026-11-20, kalite kapisi K17): kurum ayarinda (server/util/kurum-ayari.cjs).
//   ocp.platformKumeleri  {platform: [cluster]}  platform -> o platforma ait TUM cluster'lar (ortam ayrimi
//                         YOK, bilerek birlestirildi)
//   ocp.ortamKumeleri     {platform: {ortam: [cluster]}}  RESMI ORTAM -> CLUSTER KUMESI (kullanici,
//                         2026-10-14). Ortam YINE namespace son ekinden gelir (yukaridaki kural degismedi);
//                         bu tablo "bir uygulama o ortamin KAC cluster'inda olmali" sorusunun cevabidir:
//                         hucredeki k/n'deki n veriden degil buradan gelir. Ansible envanterindeki gruplardan
//                         FARKLI olabilir; kullanicinin verdigi liste esastir. Bir ortamin namespace'i bu
//                         listenin DISINDAKI bir cluster'da gorulurse "beklenmeyen cluster" olarak ayrica
//                         gosterilir (sayiya katilmaz).
// Her cagrida ayardan okunur (ayar nesnesi degismedikce onbellekten). Ayar yoksa bos.
const { kurumAyari } = require('../util/kurum-ayari.cjs');

const KUME = /^[a-z][a-z0-9-]{0,62}$/;
const kumeler = (v) =>
  (Array.isArray(v) ? v : [])
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => KUME.test(c));

// Onbellek ayar nesnesinin KIMLIGINE bagli (kurumAyari dosya degisince yeni nesne verir): WeakMap,
// eski ayar nesnesi birakilinca girdisi de gider.
const _onbellek = new WeakMap();
function ocpAyari() {
  const { veri } = kurumAyari();
  const hazir = _onbellek.get(veri);
  if (hazir) return hazir;
  const ocp = veri?.ocp && typeof veri.ocp === 'object' ? veri.ocp : {};
  const platform = {};
  for (const [p, liste] of Object.entries(ocp.platformKumeleri || {})) platform[p] = kumeler(liste);
  const ortam = {};
  for (const [p, ortamlar] of Object.entries(ocp.ortamKumeleri || {})) {
    if (!ortamlar || typeof ortamlar !== 'object') continue;
    ortam[p] = {};
    for (const [e, liste] of Object.entries(ortamlar)) ortam[p][e] = kumeler(liste);
  }
  // cluster -> platform (ters indeks)
  const ters = new Map();
  for (const [p, liste] of Object.entries(platform)) for (const c of liste) ters.set(c, p);
  const sonuc = { platform, ortam, ters };
  _onbellek.set(veri, sonuc);
  return sonuc;
}

/** @returns {Record<string, string[]>} platform -> cluster listesi */
const platformKumeleri = () => ocpAyari().platform;
/** @returns {Record<string, Record<string, string[]>>} platform -> ortam -> cluster listesi */
const ortamKumeleri = () => ocpAyari().ortam;

// EDU (2026-09-17): "-edu" ekli namespace'ler (ORNGXT51 intranet sunucusunun ortami)
// onceden null donup SESSIZCE sayilmiyordu; kullanici ortam ozetinde Edu'yu ayri istedi.
const ENVS = ['dev', 'test', 'qa', 'edu', 'prod'];

// Ortam YALNIZCA namespace son ekinden belirlenir (yukaridaki nota bakin). Eslesmeyen
// namespace'ler (ornek "falcon-operator", "openshift-monitoring") null doner ve ortam
// karsilastirmasina HIC girmez - bunlar altyapi/operator namespace'leri, uygulama degil.
function envOfNamespace(ns) {
  const n = String(ns || '').toLowerCase();
  for (const e of ENVS) if (n.endsWith('-' + e)) return e;
  return null;
}

function platformOfCluster(cluster) {
  return ocpAyari().ters.get(String(cluster || '').toLowerCase()) || null;
}

module.exports = { platformKumeleri, ortamKumeleri, ENVS, envOfNamespace, platformOfCluster };
