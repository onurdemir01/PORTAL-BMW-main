// server/smart/config.cjs — Smart/RFF (kurum ici talep yonetim sistemi) baglanti
// ayarlari. Bu dosya HER ZAMAN process.env'den okur — ama AWX_PASSWORD/ANTHROPIC_API_KEY
// ile AYNI desen: gercek deger Admin > Sistem ekranindan girilip DB'ye (portal_env_overrides,
// AES-256-GCM ile sifreli — bkz. server/db/env-overrides.cjs) yazilir, boot'ta process.env'e
// UYGULANIR. Yani "env var" ile "DB'den admin panelinden girilen deger" burada CELISMEZ —
// ikincisi birincisini besler. .env dosyasina elle yazmak da hala calisir (ör. dev ortami),
// DB override'i varsa o kazanir.
//
// Deger girilene kadar isConfigured() false doner ve Smart onayi gerektiren Self Service
// item'lari devre disi kalir (sessizce YANLIS calismaz, acikca "yapilandirilmamis" hatasi doner).
//
// 2026-08-10: SOS02-KL-001-EN "SMART Request Fulfillment (RFF) Services User Guide"
// (Onur'un servis ekibinden aldigi resmi dokuman) okunup path/govde sekli buna gore
// DOGRULANDI. Onemli bulgular:
//   - Talep ACMA (createoperationalrequest/v1) DOGRULANDI — path + govde + Basic Auth +
//     RFF-Request-Token header'i BIREBIR eslesiyor (bkz. client.cjs).
//   - Talep DURUMU SORGULAMA icin dokumanda HICBIR REST endpoint'i YOK. Referans kod
//     tabanindaki (kardes ekip) durum sorgusu Smart'in kendisinden DEGIL, ayri bir sistemden
//     ("Servicerepository" adiyla anilan, muhtemelen SMART'in workflow/roadmap API'si,
//     bu dokumanin kapsami DISINDA) geliyordu. SMART_CHECK_TICKET_PATH bu yuzden BOS
//     birakildi — doldurulmadigi surece client.cjs.checkTicketStatus() acikca hata
//     firlatir (poller bunu loglar, talep PENDING kalir, sessizce yanlis "hicbir zaman
//     onaylanmadi" sonucuna dusmez). Onur'dan bu ayri sistemin dokumani gerekiyor.
function isConfigured() {
  return !!(process.env.SMART_API_URL && process.env.SMART_API_USERNAME && process.env.SMART_API_PASSWORD);
}

function getConfig() {
  return {
    // SOS02-KL-001-EN'deki ortam host'lari (hepsi :8443, ayni path'ler):
    //   Test: gbcalt01.fw.garanti.com.tr | QA: gbcadq01.fw.garanti.com.tr | Prod: gbca.fw.garanti.com.tr
    // Admin hangi ortama baglanilacagini SMART_API_URL'e o ortamin tam host'unu
    // (https://<host>:8443) yazarak secer.
    baseUrl: (process.env.SMART_API_URL || '').replace(/\/+$/, ''),
    username: process.env.SMART_API_USERNAME || '',
    password: process.env.SMART_API_PASSWORD || '',
    requestToken: process.env.SMART_RFF_TOKEN || '',
    // DOGRULANDI (SOS02-KL-001-EN, "Request Flow Opening Service - REST").
    createTicketPath: process.env.SMART_CREATE_TICKET_PATH || '/smart/internal/requestfulfilment/createoperationalrequest/v1',
    // DOGRULANDI (SOS02-KL-001-EN, "Metadata Service Required to Start Request Flow - REST")
    // — opsiyonel: bir flowKey'in bekledigi metadata alanlarini (ElementName/IsRequired/...)
    // sorgulamak icin. Su an hicbir yerden cagrilmiyor, admin arac-kutusu icin hazir.
    getMetadataPath: process.env.SMART_GET_METADATA_PATH || '/smart/internal/getmetadataoperationalrequestbyflowname/v1',
    // DOGRULANMADI — dokumanda YOK, bkz. dosya basi notu. Bos oldugu surece
    // checkTicketStatus() acikca hata firlatir.
    checkTicketPath: process.env.SMART_CHECK_TICKET_PATH || '',
    // "Login domain information of the user who created the request" — ornek deger
    // dokumanda hep "GARANTI" (kullanicinin KENDI LDAP domain'i degil, sabit bir deger
    // gibi gorunuyor). Farkliysa Admin > Sistem > Smart grubundan degistirilebilir.
    domain: process.env.SMART_DOMAIN || 'GARANTI',
    // Poller ne siklikta local DB'deki PENDING taleplerin durumunu Smart'a sorsun.
    pollIntervalSeconds: Number(process.env.SMART_POLL_INTERVAL_SECONDS || 30),
    // Referans kod tabanindaki SINIRSIZ "while True: sleep(10)" BILINCLI OLARAK
    // KOPYALANMADI (bkz. arastirma notlari) — bir talep bu sureyi asarsa TIMEOUT
    // olarak isaretlenir, worker'i sonsuza dek isgal etmez.
    ticketTimeoutHours: Number(process.env.SMART_TICKET_TIMEOUT_HOURS || 24),
  };
}

module.exports = { isConfigured, getConfig };
