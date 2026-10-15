// server/config/secret-pattern.cjs — Hangi SYSTEM_CONFIG_KEYS anahtarlarinin "gizli deger"
// sayildigini belirleyen tek desen. Eskiden server/db/env-overrides.cjs ve
// server/admin/system-config.cjs'de birebir kopya olarak tutuluyordu ("dongusel require'dan
// kacinmak icin tekrarlanir" yorumuyla, kurumsal AI kod incelemesi, review.md #21) — bu iki
// dosyanin BIRBIRINI degil, SADECE bu bagimliliksiz dosyayi require etmesi dongu riskini
// zaten ortadan kaldirir. Iki yerde ayri ayri guncellenip sessizce tutarsizlasma riskini
// (bir dosyada yeni bir ..._SECRET anahtari eklenip digerinde unutulmasi) kapatir.
//
// Desene uyan anahtar: GET /api/admin/system-config'te maskelenir (istemci gizliligi
// yalniz sunucunun `masked` alanindan okur), DB'ye sifreli yazilir (env-overrides.cjs
// encryptSecretValue) ve PUT denetim kaydina degeri yazilmaz ("value redacted").
//
// WEBHOOK_URL (2026-10-15, kullanici karari): Teams / Power Automate webhook adresi imza
// (sig=) tasir; adresi bilen herkes kanala kart gonderebilir. Kural: "sirlar DB'ye, loglara
// ve Portal'a duz metin gitmez". Bugun desene uyan tek anahtar TEAMS_LONGJOB_WEBHOOK_URL
// (DB_USAGE_ALERT_WEBHOOK_URL beyaz listede degil, yalniz ortam dosyasi). Eski DB'deki duz
// metin satir yuklemede aynen kullanilir (ENC_PREFIX yoksa cozme denenmez); deger Admin >
// Sistem'den bir kez yeniden kaydedilince sifreli yazilir.
'use strict';

const SECRET_PATTERN = /(PASSWORD|SECRET|TOKEN|_KEY|WEBHOOK_URL)$/i;

module.exports = { SECRET_PATTERN };
