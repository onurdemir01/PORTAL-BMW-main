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
'use strict';

function isConfigured() {
  return !!(process.env.SMART_API_URL && process.env.SMART_API_USERNAME && process.env.SMART_API_PASSWORD);
}

function getConfig() {
  return {
    // Referans kod tabanindaki (kardes ekibin Smart entegrasyonu) GBCA sinifiyla AYNI
    // sekil: base URL + iki path (talep acma + durum sorgulama), Basic Auth + ozel
    // "RFF-Request-Token" header'i. Path'ler farkli olabilir — Onur'dan gelecek gercek
    // degerlerle degistirilecek.
    baseUrl: (process.env.SMART_API_URL || '').replace(/\/+$/, ''),
    username: process.env.SMART_API_USERNAME || '',
    password: process.env.SMART_API_PASSWORD || '',
    requestToken: process.env.SMART_RFF_TOKEN || '',
    createTicketPath: process.env.SMART_CREATE_TICKET_PATH || '/rff/create',
    checkTicketPath: process.env.SMART_CHECK_TICKET_PATH || '/rff/status',
    // Poller ne siklikta local DB'deki PENDING taleplerin durumunu Smart'a sorsun.
    pollIntervalSeconds: Number(process.env.SMART_POLL_INTERVAL_SECONDS || 30),
    // Referans kod tabanindaki SINIRSIZ "while True: sleep(10)" BILINCLI OLARAK
    // KOPYALANMADI (bkz. arastirma notlari) — bir talep bu sureyi asarsa TIMEOUT
    // olarak isaretlenir, worker'i sonsuza dek isgal etmez.
    ticketTimeoutHours: Number(process.env.SMART_TICKET_TIMEOUT_HOURS || 24),
  };
}

module.exports = { isConfigured, getConfig };
