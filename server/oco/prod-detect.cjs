// server/oco/prod-detect.cjs — "bu Self Service talebi PRODUCTION mu?" kurali.
//
// KURAL (kullanici tarafindan 2026-08-26'da NET olarak verildi, "her zaman ve her zaman"):
//   extra_vars icinde  env: prod | env: production | ortam: prod | ortam: production
// varsa talep production'dir. Baska hicbir sey aranmaz.
//
// NEDEN YAPILANDIRILABILIR DEGIL: bu bir guvenlik kapisi. Admin ekranindan degistirilebilir
// olsaydi, DB'de kalmis bayat bir ayar prod tespitini SESSIZCE kapatabilirdi (portal
// yapilandirmasinda ayni tuzaga daha once dusuldu: DB satiri kod varsayilanini eziyor).
// Kural kodda sabit; degismesi gerekiyorsa bu dosya degisir ve gozden gecirilir.
'use strict';

const ENV_KEYS = ['env', 'ortam'];
const PROD_VALUES = ['prod', 'production'];

// Anahtar ve deger HARF DUYARSIZ karsilastirilir: AWX survey'leri "ENV"/"Env" ya da
// "PROD"/"Production" gonderebiliyor; buyuk harfli bir deger yuzunden OCO kontrolunun
// atlanmasi, kontrolu hic koymamakla ayni sey olurdu.
function isProductionRequest(extraVars) {
  if (!extraVars || typeof extraVars !== 'object') return false;
  for (const [k, v] of Object.entries(extraVars)) {
    if (!ENV_KEYS.includes(String(k).trim().toLowerCase())) continue;
    if (PROD_VALUES.includes(String(v ?? '').trim().toLowerCase())) return true;
  }
  return false;
}

module.exports = { isProductionRequest, ENV_KEYS, PROD_VALUES };
