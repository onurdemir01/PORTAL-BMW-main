// server/crypto-hub/kiracilar.cjs — Crypto Hub kiracilari, kurum ayarindaki altyapi alanlariyla (2026-11-20).
//
// Kiraci tanimlari shared/cryptoHubTenants.cjs'te (ekranla paylasilir, bagimsiz). `bastion`, `cluster` ve
// `apiUrl` kurum ayarinin `cryptoHub.kiracilar.<key>` bolumundedir (server/util/kurum-ayari.cjs, K17); bu
// modul okuyucuyu baglar. Sunucu kodu kiracilari BURADAN alir.
'use strict';

const ortak = require('../../shared/cryptoHubTenants.cjs');
const { kurumAyari } = require('../util/kurum-ayari.cjs');

ortak.altyapiCozucuBagla((key) => kurumAyari().veri?.cryptoHub?.kiracilar?.[key] || null);

module.exports = ortak;
