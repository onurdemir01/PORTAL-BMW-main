// server/smart/config.cjs — Smart/RFF (kurum ici talep yonetim sistemi) baglanti
// ayarlari. LDAP_URL/LDAP_BIND_DN deseniyle AYNI: env var'lardan okunur, DB'ye
// YAZILMAZ (kimlik bilgisi/servis hesabi sifresi portal DB'sine asla girmez).
//
// GERCEK DEGERLER BILINMIYOR (2026-08-09 itibariyle) — Onur'un REST endpoint + servis
// hesabi bilgisi var ama henuz portala girilmedi. Bu dosya sadece hangi env var'larin
// BEKLENDIGINI tanimlar; deger girilene kadar isConfigured() false doner ve Smart
// onayi gerektiren Self Service item'lari devre disi kalir (sessizce YANLIS calismaz,
// acikca "yapilandirilmamis" hatasi doner).
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
