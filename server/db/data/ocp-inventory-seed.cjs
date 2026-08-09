// server/db/data/ocp-inventory-seed.cjs — OCP katalogunun ILK KURULUM verisi.
//
// KAYNAK: AWX projesindeki bmw_openshift_jobs/global_variables/openshift_inventory_vars.yaml
// (cluster listesi + API URL'leri) ve kurumsal cluster→jump server eslemesi.
//
// PAROLA YOKTUR ve OLMAYACAKTIR. Her cluster yalnizca hangi vault anahtarini kullandigini
// (`vaultCredentialKey`) tasir; gercek parola AWX'teki credentials.yaml icinde vault'lu
// kalir ve playbook onu `lookup('vars', <anahtar>)` ile cozer.
//
// Bu dosya YALNIZCA bir-kerelik seed icin okunur (bkz. ocp-bootstrap-seed.cjs). Sonrasinda
// tek gercek kaynak DB'dir (ocp_cluster_index) — buradaki liste guncellense bile mevcut
// kurulumlar ETKILENMEZ.
'use strict';

const API = (host, domain = 'fw.garanti.com.tr') => `https://api.${host}.${domain}:6443`;
const GTEK = 'fw.gteknoloji.com.tr';
const DAS = 'fw.dijitalvarlik.com.tr';

// inventory anahtari (`<tenant>_<env>`) → o gruptaki cluster'lar.
// Ayristirma kurali: SON alt cizgi env, oncesi tenant. Alt cizgi yoksa ikisi de anahtar
// ('cicd' → tenant=cicd, env=cicd). Bkz. parseInventoryKey().
const INVENTORY = {
  ark_lab:  { credentialKey: 'uxmid_gar', clusters: { gbocplab1: API('gbocplab1'), gbocplab2: API('gbocplab2') } },
  ark_edu:  { credentialKey: 'uxmid_gar', clusters: { gbocpedu1: API('gbocpedu1') } },
  ark_dev:  { credentialKey: 'uxmid_gar', clusters: { gbocptest1: API('gbocptest1'), gbocptest2: API('gbocptest2'), gbocptest4: API('gbocptest4') } },
  ark_test: { credentialKey: 'uxmid_gar', clusters: { gbocptest1: API('gbocptest1'), gbocptest2: API('gbocptest2'), gbocptest4: API('gbocptest4') } },
  ark_qa:   { credentialKey: 'uxmid_gar', clusters: { gbocpqa1: API('gbocpqa1'), gbocpqa2: API('gbocpqa2'), gbocptest4: API('gbocptest4'), gbocpankqa2: API('gbocpankqa2') } },
  ark_prod: { credentialKey: 'uxmid_gar', clusters: { gbocpprod1: API('gbocpprod1'), gbocpprod2: API('gbocpprod2'), gbocpprod4: API('gbocpprod4'), gbocpankprod2: API('gbocpankprod2'), gbocpdrcprod1: API('gbocpdrcprod1') } },

  hosting_dev:  { credentialKey: 'uxmid_gar', clusters: { gbocp3rdtest3: API('gbocp3rdtest3'), gbocp3rdtest4: API('gbocp3rdtest4') } },
  hosting_test: { credentialKey: 'uxmid_gar', clusters: { gbocp3rdtest3: API('gbocp3rdtest3'), gbocp3rdtest4: API('gbocp3rdtest4') } },
  hosting_qa:   { credentialKey: 'uxmid_gar', clusters: { gbocp3rdtest3: API('gbocp3rdtest3'), gbocp3rdtest4: API('gbocp3rdtest4') } },
  hosting_prod: { credentialKey: 'uxmid_gar', clusters: { gbocp3rdprod1: API('gbocp3rdprod1'), gbocp3rdprod2: API('gbocp3rdprod2'), gbocpank3rdprod2: API('gbocpank3rdprod2') } },

  'istirak-hosting_dev':  { credentialKey: 'uxmid_gar', clusters: { giocp3rdtest3: API('giocp3rdtest3', GTEK), giocp3rdtest4: API('giocp3rdtest4', GTEK) } },
  'istirak-hosting_test': { credentialKey: 'uxmid_gar', clusters: { giocp3rdtest3: API('giocp3rdtest3', GTEK), giocp3rdtest4: API('giocp3rdtest4', GTEK) } },
  'istirak-hosting_qa':   { credentialKey: 'uxmid_gar', clusters: { giocp3rdtest3: API('giocp3rdtest3', GTEK), giocp3rdtest4: API('giocp3rdtest4', GTEK) } },
  'istirak-hosting_prod': { credentialKey: 'uxmid_gar', clusters: { giocp3rdprod1: API('giocp3rdprod1', GTEK), giocp3rdprod2: API('giocp3rdprod2', GTEK), giocpank3rdprod2: API('giocpank3rdprod2', GTEK) } },

  metaco_das_test: { credentialKey: 'uxmid_das', clusters: { daocptest1: API('daocptest1', DAS) } },
  metaco_das_prod: { credentialKey: 'uxmid_das', clusters: { daocpprod1: API('daocpprod1', DAS) } },
  digital_assets_metaco_test: { credentialKey: 'uxmid_das', clusters: { daocptest1: API('daocptest1', DAS) } },
  digital_assets_metaco_prod: { credentialKey: 'uxmid_das', clusters: { daocpprod1: API('daocpprod1', DAS) } },

  metaco_gar_test: { credentialKey: 'uxmid_gar', clusters: { gbocp3rdcwtest1: API('gbocp3rdcwtest1') } },
  metaco_gar_prod: { credentialKey: 'uxmid_gar', clusters: { gbocp3rdcwprod1: API('gbocp3rdcwprod1') } },

  wyden_dev:  { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  wyden_test: { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  wyden_qa:   { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  wyden_prod: { credentialKey: 'uxmid_gar', clusters: { giocp3rdwyprod1: API('giocp3rdwyprod1', GTEK), giocp3rdwyprod2: API('giocp3rdwyprod2', GTEK), giocpank3rdwyprod1: API('giocpank3rdwyprod1', GTEK) } },

  digital_assets_wyden_dev:  { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  digital_assets_wyden_test: { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  digital_assets_wyden_qa:   { credentialKey: 'uxmid_gar', clusters: { giocp3rdwytest1: API('giocp3rdwytest1', GTEK), giocp3rdwytest2: API('giocp3rdwytest2', GTEK) } },
  digital_assets_wyden_prod: { credentialKey: 'uxmid_gar', clusters: { giocp3rdwyprod1: API('giocp3rdwyprod1', GTEK), giocp3rdwyprod2: API('giocp3rdwyprod2', GTEK), giocpank3rdwyprod1: API('giocpank3rdwyprod1', GTEK) } },

  cicd: { credentialKey: 'uxmid_gar', clusters: { gbocpcicd2: API('gbocpcicd2'), gbocpcicd3: API('gbocpcicd3') } },
};

// Cluster'a OZEL jump server (bastion). Burada karsiligi OLMAYAN cluster'lar
// TERMINAL_HOST_MAP yedegine duser (bkz. logx/v2/admin.cjs resolveTerminalHosts).
// NOT: bu listedeki bazi cluster'lar inventory'de YOKTUR (or. gbocpprod3, gbocpinsprod2,
// *ai*, *cds*) — API URL'leri bilinmedigi icin seed onlar icin satir OLUSTURMAZ; eslemeleri
// burada tutulur ki admin o cluster'i elle eklediginde jump server'i hazir bulunsun.
const CLUSTER_JUMP_HOSTS = {
  gbocpdrcprod1: 'gbdrcp51',
  gbocpcicd2: 'gbccdp52',
  gbocpcicd3: 'gbccdp53',
  gbocp3rdprod1: 'gbhstp51',
  gbocp3rdprod2: 'gbhstp52',
  gbocpank3rdprod2: 'gbhstap81',
  giocp3rdprod1: 'gihstp51',
  giocp3rdprod2: 'gihstp52',
  giocpank3rdprod2: 'gihstap81',
  gbocpinsprod2: 'gbinsp52',
  daocpprod1: 'damtcp51',
  daocpprod2: 'damtcp52',
  daocpankprod1: 'damtcap81',
  gbocpcdsprod1: 'gbcdsp51',
  gbocp3rdcwprod1: 'gbmtcp51',
  gbocp3rdcwprod2: 'gbmtcp52',
  gbocpank3rdcwprod1: 'gbmtcap81',
  giocp3rdwyprod1: 'gbwydp51',
  giocp3rdwyprod2: 'gbwydp52',
  gbocp3rdaicprod1: 'gboaip51',
  giocpank3rdwyprod1: 'gbwydap51',
  gbocpank3rdaiprod1: 'gboaiap81',
  gbocparkaiprod1: 'gbaaip51',
  gbocparkaiprod2: 'gbaaip52',
  gbocpankarkaiprod1: 'gbaaiap81',
  gbocpprod1: 'gbarkp51',
  gbocpprod2: 'gbarkp52',
  gbocpankprod2: 'gbarkap82',
  gbocpprod3: 'gbarkp53',
  gbocpprod4: 'gbarkp54',
};

// YEDEK esleme: cluster satirinda kendi jump server'i yoksa tenant+env'e gore bu kullanilir
// (ocp_terminal_host_map tablosuna seed edilir).
const TERMINAL_HOST_MAP = {
  ark_lab: 'gbaocp01', ark_edu: 'gbaocp01', ark_dev: 'gbaocp01',
  ark_test: 'gbaocp01', ark_qa: 'gbaocp01', ark_prod: 'gbaocp01',

  hosting_dev: 'gbaocp01', hosting_test: 'gbaocp01',
  hosting_qa: 'gbaocp01', hosting_prod: 'gbaocp01',

  'istirak-hosting_dev': 'gbaocp01', 'istirak-hosting_test': 'gbaocp01',
  'istirak-hosting_qa': 'gbaocp01', 'istirak-hosting_prod': 'gbaocp01',

  metaco_das_test: 'damtct01', metaco_das_prod: 'daaocp01',
  metaco_gar_test: 'damtct01', metaco_gar_prod: 'daaocp01',

  // `digital_assets_*` gruplari envanterde metaco/wyden ile AYNI cluster'lari isaret eder
  // ama kendi tenant adlariyla ayri satirlar uretir. Yedek eslemesi olmazsa bu satirlar
  // aktive edildigi anda "bastion tanimli degil" 400'u alirdi.
  digital_assets_metaco_test: 'damtct01', digital_assets_metaco_prod: 'daaocp01',
  digital_assets_wyden_dev: 'gbaocp01', digital_assets_wyden_test: 'gbaocp01',
  digital_assets_wyden_qa: 'gbaocp01', digital_assets_wyden_prod: 'gbaocp01',

  wyden_dev: 'gbaocp01', wyden_test: 'gbaocp01',
  wyden_qa: 'gbaocp01', wyden_prod: 'gbaocp01',

  cicd: 'gbaocp01',
};

module.exports = { INVENTORY, CLUSTER_JUMP_HOSTS, TERMINAL_HOST_MAP };
