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
// NOT: isConfigured() SADECE talep ACMAYI (Smart API) kapsar - talep TAKIBI (ServiceRepository,
// asagida) ayri bir sistem/ayardir, kendi bos-deger kontrolunu checkTicketStatus() icinde yapar.
//
// 2026-08-10: SOS02-KL-001-EN "SMART Request Fulfillment (RFF) Services User Guide"
// (Onur'un servis ekibinden aldigi resmi dokuman) okunup path/govde sekli buna gore
// DOGRULANDI. Onemli bulgular:
//   - Talep ACMA (createoperationalrequest/v1) DOGRULANDI — path + govde + Basic Auth +
//     RFF-Request-Token header'i BIREBIR eslesiyor (bkz. client.cjs).
//   - Talep DURUMU SORGULAMA icin dokumanda HICBIR REST endpoint'i YOK.
//
// 2026-08-13: kardes ekibin GERCEK Django kaynagi (gar_selfserviceportal_uft paketi,
// dashboard/servicerepository.py + loadbalancer/tasks.py check_state_all_ticket())
// incelenerek "ServiceRepository" adli AYRI bir sistem/host uzerinden reverse-engineer
// edilmis bir durum sorgulama protokolu kullanildi (GET, authsiz, ayri host/config).
//
// 2026-08-14: kullanici RESMI bir uc buldu — Smart'in KENDI host'unda (SMART_API_URL),
// createTicket() ile AYNI kimlik dogrulama (Basic Auth + RFF-Request-Token) deseninde:
//   POST {SMART_API_URL}/smart/internal/requestfulfilment/loadwfinstancestatus/v1
//   govde: { wfInstanceId: <id> }  ->  cevap: { result: { resultCode, statusCode, statusName } }
// Ornek statusCode/statusName ciftleri: "50"/"Onay Bekliyor", "1000"/"Tamamlandı",
// "2000"/"İptal Edildi". ServiceRepository yaklasimi (ayri host, ayri admin alani,
// authsiz GET) TAMAMEN KALDIRILDI — bu resmi uc hem daha guvenilir hem de ayri bir
// host/proxy-istisnasi config'i GEREKTIRMIYOR (SMART_API_URL zaten var).
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
    // DOGRULANDI (kullanici tarafindan bulunup ornek govde/cevapla test edildi,
    // bkz. dosya basi 2026-08-14 notu). SMART_API_URL uzerinde, createTicket ile
    // AYNI auth.
    checkTicketPath: process.env.SMART_CHECK_TICKET_PATH || '/smart/internal/requestfulfilment/loadwfinstancestatus/v1',
    // "Login domain information of the user who created the request" — ornek deger
    // dokumanda hep "GARANTI" (kullanicinin KENDI LDAP domain'i degil, sabit bir deger
    // gibi gorunuyor). Farkliysa Admin > Sistem > Smart grubundan degistirilebilir.
    domain: process.env.SMART_DOMAIN || 'GARANTI',
    // Poller ne siklikta local DB'deki PENDING taleplerin durumunu Smart'a sorsun.
    pollIntervalSeconds: Number(process.env.SMART_POLL_INTERVAL_SECONDS || 30),
    // Referans kod tabanindaki SINIRSIZ "while True: sleep(10)" BILINCLI OLARAK
    // KOPYALANMADI (bkz. arastirma notlari) — bir talep bu sureyi asarsa TIMEOUT
    // olarak isaretlenir, otomasyon ASLA tetiklenmez, worker sonsuza dek beklemez.
    //
    // 2026-08-20: sure 24 SAAT'ten 15 DAKIKA'ya cekildi (kullanici talebi). Birim de
    // saatten DAKIKA'ya gecti ve degisken adi BILEREK degistirildi
    // (SMART_TICKET_TIMEOUT_HOURS -> SMART_TICKET_TIMEOUT_MINUTES): eski ad
    // portal_env_overrides allowlist'indeydi, yani Admin > Sistem ekranindan DB'ye
    // yazilmis eski bir "24" degeri process.env'e uygulanip KOD VARSAYILANINI EZIYOR
    // olabilirdi - sadece varsayilani degistirmek 15 dakikayi SESSIZCE uygulamazdi.
    // Eski ad artik HIC OKUNMUYOR, dolayisiyla bayat bir DB satiri etkisiz.
    ticketTimeoutMinutes: (() => {
      const v = Number(process.env.SMART_TICKET_TIMEOUT_MINUTES);
      return Number.isFinite(v) && v > 0 ? v : 15;
    })(),
    // Opsiyonel, Smart'a OZEL proxy (global HTTPS_PROXY'den BILEREK bagimsiz — o,
    // MCP/Splunk/AI gibi diger tum entegrasyonlari da etkiler, admin sadece Smart
    // trafigini proxy'lemek istedi). Bos ise dogrudan baglanti kurulur; bkz. client.cjs
    // buildSmartDispatcher().
    proxyUrl: (process.env.SMART_PROXY_URL || '').trim(),
  };
}

module.exports = { isConfigured, getConfig };
