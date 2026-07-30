// server/config/secret-pattern.cjs — Hangi SYSTEM_CONFIG_KEYS anahtarlarinin "gizli deger"
// sayildigini belirleyen tek desen. Eskiden server/db/env-overrides.cjs ve
// server/admin/system-config.cjs'de birebir kopya olarak tutuluyordu ("dongusel require'dan
// kacinmak icin tekrarlanir" yorumuyla, kurumsal AI kod incelemesi, review.md #21) — bu iki
// dosyanin BIRBIRINI degil, SADECE bu bagimliliksiz dosyayi require etmesi dongu riskini
// zaten ortadan kaldirir. Iki yerde ayri ayri guncellenip sessizce tutarsizlasma riskini
// (bir dosyada yeni bir ..._SECRET anahtari eklenip digerinde unutulmasi) kapatir.
'use strict';

const SECRET_PATTERN = /(PASSWORD|SECRET|TOKEN|_KEY)$/i;

module.exports = { SECRET_PATTERN };
