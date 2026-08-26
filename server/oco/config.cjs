// server/oco/config.cjs — OCO (ChangeManagement ServiceRepository) baglanti ayarlari.
//
// server/smart/config.cjs ile AYNI desen: her zaman process.env'den okunur; gercek deger
// Admin > Sistem ekranindan girilip DB'ye (portal_env_overrides, AES-256-GCM) yazilir ve
// boot'ta process.env'e uygulanir. .env ile elle vermek de calisir.
//
// Smart'tan AYRI bir sistem: farkli host, farkli protokol (duz GET, gövdesiz), kimlik
// dogrulamasi YOK. Bu yuzden server/smart/* icine karistirilmadi - Smart'in isConfigured()
// kontrolu OCO'yu kapsamaz, kapsamamali.
'use strict';

function getConfig() {
  return {
    // Kullanicinin verdigi uc: https://servicerepository/ChangeManagement/...
    // Ortama gore host degisebilecegi icin taban adres ayarlanabilir birakildi.
    baseUrl: (process.env.OCO_API_URL || 'https://servicerepository').replace(/\/+$/, ''),
    // Path ve sorgu parametresi ayri tutulur ki uc degisirse kod degil ayar guncellensin.
    changeOrderPath: process.env.OCO_CHANGE_ORDER_PATH
      || '/ChangeManagement/ChangeManagementServiceRepository.svc/Change/getChangeOrderByWfInstanceId/',
    // Opsiyonel, OCO'ya OZEL proxy (global HTTPS_PROXY'den bilerek bagimsiz - Smart'ta
    // da ayni tercih yapildi: admin tek bir entegrasyonu proxy'lemek isteyebiliyor).
    proxyUrl: (process.env.OCO_PROXY_URL || '').trim(),
    timeoutMs: (() => {
      const v = Number(process.env.OCO_TIMEOUT_MS);
      return Number.isFinite(v) && v > 0 ? v : 15000;
    })(),
    // Zamanlanmis tetiklemeleri kontrol eden poller'in tick araligi.
    pollIntervalSeconds: (() => {
      const v = Number(process.env.OCO_POLL_INTERVAL_SECONDS);
      return Number.isFinite(v) && v > 0 ? v : 30;
    })(),
  };
}

function isConfigured() {
  return !!getConfig().baseUrl;
}

module.exports = { getConfig, isConfigured };
