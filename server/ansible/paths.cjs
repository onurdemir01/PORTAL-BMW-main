// server/ansible/paths.cjs — AWX'e kopyalanan playbook agacinin TEK adres kaynagi.
//
// NEDEN VAR: bu agacin yollari onceden en az 10 dosyaya dagilmisti (testler,
// preflight, dokumanlar). Bir playbook tasindiginda hepsinin ayni anda
// guncellenmesi gerekiyordu; biri unutulunca test "dosya yok" diye degil,
// SESSIZCE "kontrol edilecek dosya yok" diye yesil kaliyordu.
//
// AGAC AWX REPOSUNUN AYNASIDIR. `server/ansible/bmw_portal/` klasoru, AWX
// projesindeki `bmw_portal/` ile BIREBIR AYNI yapidadir — klasor oldugu gibi
// kopyalanabilir. Bu, kozmetik bir tercih degil:
//
//   Playbook'lar kimlik dosyasini `playbook_dir`e GORELI arar
//   (`../../../bmw_openshift_jobs/global_variables/credentials.yaml` gibi).
//   Iki repoda derinlik AYNI olmazsa, burada gecen bir test AWX'te patlayabilir —
//   nitekim uretimde tam olarak bu oldu (AWX #3296360): playbook `logx/ocp/`
//   altina (uc seviye) tasinmisti ama yolu iki seviye varsayiyordu, kimlik
//   dosyasi bulunamadi, parola BOS kaldi ve ekran yaniltici bir kubeconfig
//   hatasi gosterdi.
//
// YENI PLAYBOOK EKLERKEN: once AWX'teki yerini ogren, sonra buraya ayni yolla
// ekle. `playbook-tree.test.cjs` bu listeyi agacin gercegiyle karsilastirir.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ANSIBLE_DIR = __dirname;

/** AWX'e kopyalanan agacin koku. Bu klasorun ICERIGI `bmw_portal/` olur. */
const AWX_TREE = path.join(ANSIBLE_DIR, 'bmw_portal');

/**
 * AWX'e KOPYALANMAYAN, yalnizca portal/AI tanilama icin duran playbook'lar.
 * Bunlar bilerek duz bir klasorde durur: AWX projesinde karsiliklari YOK.
 */
const LOCAL_PLAYBOOKS = path.join(ANSIBLE_DIR, 'playbooks');

/**
 * Modul -> AWX agacindaki yol (AWX_TREE'ye goreli).
 * Anahtarlar portalin ic adlari, degerler AWX'teki GERCEK dosya adlaridir.
 * Ikisi her yerde ayni degil: telnet portal tarafinda `ocp_telnet_control`
 * diye anilir ama AWX'te `telnet_openshift/telnet_openshift.yaml`dir.
 */
const PLAYBOOKS = {
  logxLegacyDiscovery: 'logx/legacy/logx_legacy_discovery.yml',
  logxLegacyTransfer: 'logx/legacy/logx_legacy_transfer.yml',
  logxOcpAppDiscovery: 'logx/ocp/logx_ocp_app_discovery.yml',
  logxOcpDiscoverFetch: 'logx/ocp/logx_ocp_discover_fetch.yml',
  logxOcpNamespaceDiscovery: 'logx/ocp/logx_ocp_namespace_discovery.yml',
  opsxLegacyDump: 'opsx_legacy_dump/opsx_legacy_dump.yml',
  opsxLegacyJvmDiscover: 'opsx_legacy_dump/opsx_legacy_jvm_discover.yml',
  opsxOpenshiftDump: 'opsx_openshift_dump/opsx_openshift_dump.yaml',
  opsxOpenshiftPods: 'opsx_openshift_dump/opsx_openshift_pods.yaml',
  telnetOpenshift: 'telnet_openshift/telnet_openshift.yaml',
};

/** ScaleX AWX paketi — klasor olarak kopyalanir (tek dosya degil). */
const SCALEX_PKG = path.join(AWX_TREE, 'scalex');
const SCALEX_APP = path.join(SCALEX_PKG, 'scalex_app');

/**
 * Her playbook'un AWX agacindaki DERINLIGI (bmw_portal'a goreli klasor sayisi).
 * `credentials.yaml` aramasi bu derinlige gore cozulur; degistirmeden once
 * playbook'un `vars_files` blogundaki aday yollari da gozden gecir.
 */
function depthOf(relPath) {
  return relPath.split('/').length - 1;
}

const abs = (relPath) => path.join(AWX_TREE, relPath);

/**
 * Iki agactaki TUM playbook dosyalari (mutlak yol), OZYINELI.
 *
 * NEDEN OZYINELI: agac duzlestirilmisken testler `readdirSync(playbooks)` ile
 * tarama yapiyordu. Agac `bmw_portal/<modul>/<alt>/` haline gelince o cagri
 * DAHA AZ dosya dondurur ve testler SESSIZCE kucuk bir kumeyi kontrol edip
 * yesil kalirdi — kontrol edilmeyen playbook, kontrol edilen kadar guvenli
 * gorunurdu. Tek toplayici + asagidaki alt sinir bunu engeller.
 */
function allPlaybookFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(yml|yaml)$/.test(e.name)) out.push(full);
    }
  };
  for (const root of [LOCAL_PLAYBOOKS, AWX_TREE]) {
    if (fs.existsSync(root)) walk(root);
  }
  return out.sort();
}

// Toplam playbook sayisinin ALT SINIRI. Bir toplayici yanlis dizine bakmaya
// baslarsa test "kontrol edilecek sey yok" diye yesil kalmasin.
const MIN_PLAYBOOK_COUNT = 25;

module.exports = {
  ANSIBLE_DIR,
  AWX_TREE,
  LOCAL_PLAYBOOKS,
  PLAYBOOKS,
  SCALEX_PKG,
  SCALEX_APP,
  depthOf,
  abs,
  /** AWX agacindaki tum playbook'larin MUTLAK yollari. */
  allAwxPlaybooks: () => Object.values(PLAYBOOKS).map(abs),
  allPlaybookFiles,
  MIN_PLAYBOOK_COUNT,
};
