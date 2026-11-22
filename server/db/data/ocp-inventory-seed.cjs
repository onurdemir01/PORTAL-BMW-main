// server/db/data/ocp-inventory-seed.cjs — OCP katalogunun ILK KURULUM verisi, kurum ayarindan (2026-11-20).
//
// KAYNAK: AWX projesindeki openshift envanter degiskenleri (cluster listesi + API URL'leri) ve kurumsal
// cluster -> jump server eslemesi. Sunucu / cluster adlari ve kurum alan adlari repoya yazilmaz (K17):
// veri kurum ayarinin `ocp.tohum` bolumundedir (server/util/kurum-ayari.cjs; bicim
// deploy/kurum-ayari.ornek.json):
//   envanter            {<tenant>_<env>: {credentialKey, username?, clusters: {<cluster>: <api url>}}}
//   atlamaSunuculari    {<cluster>: <jump server>}
//   terminalSunuculari  {<tenant>_<env>: <jump server>}
//   vaultAnahtarlari    [{key, ...}]
//   varsayilanKullanici <oc login kullanicisi>
//
// PAROLA YOKTUR ve OLMAYACAKTIR. Her cluster yalnizca hangi vault anahtarini kullandigini tasir; gercek
// parola AWX'teki credentials.yaml icinde vault'lu kalir ve playbook onu `lookup('vars', <anahtar>)` ile cozer.
//
// Bu veri YALNIZCA bir-kerelik seed icin okunur (bkz. ocp-bootstrap-seed.cjs). Sonrasinda tek gercek kaynak
// DB'dir (ocp_cluster_index): ayar guncellense bile mevcut kurulumlar ETKILENMEZ. Ayar yoksa tohum BOS doner
// ve seed "bos" diye atlanir (isaret konmaz: ayar sonradan verilince ilk kurulum yine calisir).
'use strict';

const { bolum } = require('../../util/kurum-ayari.cjs');

const nesne = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** -> { INVENTORY, CLUSTER_JUMP_HOSTS, TERMINAL_HOST_MAP, VAULT_KEYS, DEFAULT_OCP_USERNAME, hata } */
function ocpTohumu(env = process.env) {
  const { deger, hata } = bolum('ocp.tohum', env);
  const t = nesne(deger);
  return {
    INVENTORY: nesne(t.envanter),
    CLUSTER_JUMP_HOSTS: nesne(t.atlamaSunuculari),
    TERMINAL_HOST_MAP: nesne(t.terminalSunuculari),
    VAULT_KEYS: Array.isArray(t.vaultAnahtarlari) ? t.vaultAnahtarlari : [],
    DEFAULT_OCP_USERNAME: typeof t.varsayilanKullanici === 'string' ? t.varsayilanKullanici : '',
    hata,
  };
}

module.exports = { ocpTohumu };
