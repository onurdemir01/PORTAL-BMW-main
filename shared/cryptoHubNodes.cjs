// shared/cryptoHubNodes.cjs - Crypto Hub > Indexer / Node degisikligi sabitleri (2026-11-02).
//
// Sozlesme: scratchpad/cryptohub/sozlesme.md bolum 2 + 7.1. KATALOG VERISI BURADA YOK: node
// listesi ve sirlar yalniz Ansible tarafinda (vars/nodes.yml + vault'lu vars/node_sirlari.yml).
// Portal katalogu yalniz node_env_get ciktisindaki NODECAT / NODEALLOW satirlarindan ogrenir
// ve yalniz maskeli deger + sha256 gorur.
//
// PROD ACILISI IKI ANAHTARLA (bolum 10): buradaki NODE_PROD_ACIK listesi + tenants.yml'deki
// `node_degisikligi_acik: true`. Liste KODDA durur (DB/env YOK): bu depoda "bayat DB satiri kod
// varsayilanini ezdi" sinifi uc kez yasandi; acilis bir kod degisikligi + ZIP gerektirsin.
'use strict';

const UIS_BILESENLER = Object.freeze(['adapter', 'api', 'indexer', 'processor']);

/** Regex icin kacis (release adi katalogdan gelir ama yine de duz metin sayilir). */
const kacis = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Yeni tip deployment deseni: <release>-harmonize-uis-<bilesen>-<zincirAg>.
 * 1. grup bilesen, 2. grup zincirAg.
 */
function uisDeseni(release) {
  return new RegExp(
    `^${kacis(release)}-harmonize-uis-(${UIS_BILESENLER.join('|')})-([a-z0-9][a-z0-9-]*[a-z0-9])$`,
  );
}

/**
 * Eski tip deployment deseni: <release>-harmonize-<ek>. `uis-` ile baslayan ek DISARIDA:
 * yeni tip bir deployment eski grup gibi okunursa ayni env iki ayri gruptan yazilabilirdi.
 */
function eskiDeseni(release) {
  return new RegExp(`^${kacis(release)}-harmonize-(?!uis-)([a-z0-9][a-z0-9-]*[a-z0-9])$`);
}

const GRUP_RE = /^(uis|eski):[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const NODE_ID_RE = /^[a-z0-9_]{3,64}$/;

// Prod acilis anahtari 1 (anahtar 2: tenants.yml node_degisikligi_acik). Faz 1: bos.
const NODE_PROD_ACIK = Object.freeze([]);

/** Bu kiracida node okuma/talep acik mi? Test kiracilari acik, prod yalniz listedeyse. */
function nodeAcikMi(tenant) {
  return (
    !!tenant &&
    tenant.app === 'metaco' &&
    (!tenant.production || NODE_PROD_ACIK.includes(tenant.key))
  );
}

/** Ekranda ve Smart biletinde gorunen lokasyon. Ankara yalniz prod_ank ortami. */
function lokasyon(tenant) {
  return tenant && tenant.env === 'prod_ank' ? 'Ankara' : 'İstanbul';
}

// Istanbul -> Ankara es kiracisi (D4). GAR prod'da Ankara kiracisi yok -> oneri yok.
const ES_KIRACI = Object.freeze({ metaco_das_prod: 'metaco_das_prod_ank' });

function esKiraciOf(key) {
  return ES_KIRACI[String(key || '')] || null;
}

const GEREKCE_EN_AZ = 10;
const GEREKCE_EN_COK = 500;
const OKUMA_TAZE_MS = 10 * 60 * 1000;
const ONAY_DK = 1440;
const MAX_HEDEF = 8;

// NODEENV `kaynak` alaninin KAPALI kumesi: crypto_hub_node.py KAYNAKLAR ile BIREBIR (capraz
// bekci node-sozlesme.test.cjs CHN11). Bilinmeyen kaynak -> grup olculemedi (fail-closed).
//   envFrom  : kapta acik yok, envFrom kaynagi bu adi KESIN tanimliyor (referans)
//   belirsiz : kapta acik yok, envFrom kaynagi okunamadi (olculemedi)
const NODE_KAYNAKLARI = Object.freeze(['literal', 'secretRef', 'configMapRef', 'alanRef', 'envFrom', 'belirsiz', 'yok']);
const REFERANS_KAYNAKLARI = Object.freeze(['secretRef', 'configMapRef', 'alanRef', 'envFrom']);
// ASLA degismeyen komsu degiskenler (kullanici 2026-11-02: "hep sabit kalacak"). Betikteki
// YASAK_ENV_RE ile AYNI kaynak metin (CHN11). Portal bu adlari tasiyan NODEALLOW/NODEENV
// satirini da kabul etmez (savunma derinligi: betik hatasi plana sizmasin).
const YASAK_ENV_RE = /^(HTTPS?_PROXY|NO_PROXY|ADAPTER_ADDR|EVENT_API_URL|ADDRESS_API_URL_.*|CHAIN_ID.*)$/i;

// Bilete baglanmis acik talebin ust yas siniri (PS2): onay suresi + betik butcesi (30 dk) +
// pay (60 dk). Asilip is sonucu okunamazsa talep OLCULEMEDI / TAKILDI kapanir (basari sayilmaz).
const TAKILDI_DK = ONAY_DK + 30 + 60;
// Ankara talebi Istanbul'a bu sure icinde acilmis ayni grup talebine SUNUCUDA baglanir (PS6).
const ES_TALEP_GUN = 7;

/** Talep numarasi metni (sunucu ve ekran AYNI): Smart numarasi varsa o, yoksa Portal kaydi. */
function talepNoMetni(externalTicketId, talepId) {
  const dis = String(externalTicketId == null ? '' : externalTicketId).trim();
  if (dis) return `Smart #${dis}`;
  return talepId != null && talepId !== '' ? `Portal #${talepId}` : 'Portal #?';
}

module.exports = {
  UIS_BILESENLER,
  uisDeseni,
  eskiDeseni,
  GRUP_RE,
  NODE_ID_RE,
  NODE_PROD_ACIK,
  nodeAcikMi,
  lokasyon,
  ES_KIRACI,
  esKiraciOf,
  GEREKCE_EN_AZ,
  GEREKCE_EN_COK,
  OKUMA_TAZE_MS,
  ONAY_DK,
  MAX_HEDEF,
  NODE_KAYNAKLARI,
  REFERANS_KAYNAKLARI,
  YASAK_ENV_RE,
  TAKILDI_DK,
  ES_TALEP_GUN,
  talepNoMetni,
};
