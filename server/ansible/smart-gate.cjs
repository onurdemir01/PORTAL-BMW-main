// server/ansible/smart-gate.cjs — "bu talep icin Smart onayi gerekli mi, hangi flow ile?"
//
// 2026-08-26 (kullanici karari): Smart onayi ARTIK ORTAMA DUYARLI. Onceki halde
// smartApproval.enabled tek bir anahtardi ve acikken HER ortamda onay isteniyordu;
// ortam bazli farkli onay merci/akis modellenemiyordu.
//
// YAPILANDIRMA (bkz. src/api/ansibleApi.ts FieldCustomization.smartApproval):
//   enabled       : ana anahtar
//   envs          : onay ISTENECEK ortamlar, ornek ["prod"]. BOS/TANIMSIZ ise TUM
//                   ortamlar - eski davranis BIREBIR korunur (geriye donuk uyum).
//   flowKey       : varsayilan flow
//   flowKeyByEnv  : ortam bazli flow override'i, ornek { prod: "X", test: "Y" }.
//                   Ilgili ortam icin deger yoksa flowKey'e duser.
//
// GUVENLI TARAF: talebin ortami BELIRLENEMEZSE (extra_vars'ta env/ortam yok ya da
// deger taninmiyor) ve envs listesi doluysa onay YINE DE ISTENIR. Ters tercih
// ("bilmiyorsak gecir") bir yazim hatasiyla prod onayinin atlanmasi demek olurdu.
'use strict';

const { detectEnvironment } = require('./request-env.cjs');

function normEnvs(sa) {
  return (Array.isArray(sa?.envs) ? sa.envs : [])
    .map((e) => String(e ?? '').trim().toLowerCase())
    .filter(Boolean);
}

// requestEnv verilmezse extraVars'tan tespit edilir (cagiran taraf zaten hesapladiysa
// tekrar hesaplamaya gerek yok).
function isSmartRequired(smartApproval, extraVars, requestEnv) {
  if (!smartApproval || !smartApproval.enabled) return false;
  const envs = normEnvs(smartApproval);
  if (envs.length === 0) return true;                    // eski davranis: her ortamda
  const env = requestEnv !== undefined ? requestEnv : detectEnvironment(extraVars);
  if (!env) return true;                                 // ortam bilinmiyor -> GUVENLI taraf
  return envs.includes(env);
}

function resolveFlowKey(smartApproval, extraVars, requestEnv) {
  const env = requestEnv !== undefined ? requestEnv : detectEnvironment(extraVars);
  const byEnv = (smartApproval && smartApproval.flowKeyByEnv) || {};
  const perEnv = env ? byEnv[env] : undefined;
  return String(perEnv || (smartApproval && smartApproval.flowKey) || '').trim();
}

module.exports = { isSmartRequired, resolveFlowKey, normEnvs };
