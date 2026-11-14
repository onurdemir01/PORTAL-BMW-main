// server/crypto-hub/smart-ayar.cjs - Crypto Hub node talebinin kendi Smart ayari.
//
// portal_config_blobs 'crypto-hub:smart' satiri: {enabled, flowKey, metadataFields, integrationKey,
// ocoTest}.
// OpsX'in smart.<plat> bolumune konmaz: normalizeSmart bilinmeyen platformu kayitta siler.
//
// OKUMA ONBELLEKSIZ ve okuma hatasi "satir yok" ile KARISMAZ: satir yoksa bos blok OpsX'e duser;
// okunamayan satir ise firlatir. Yutulsa bilet sessizce OpsX flow'una, yanlis onaycilara giderdi.
//
// BLOK kurali: flow + sablon ikisi bos -> OpsX OpenShift blogunun tamami; ikisi dolu -> Crypto
// blogu (token Crypto'nun, yoksa sistem token'i; OpsX'in token'i ASLA). Alan alan dusulmez: flow'larin
// ElementName setleri farkli, karisim Smart'ta dropdown'lari sessizce bos birakir. Yarim blok
// kaydedilemez, DB'den gelirse resolver reddeder.
//
// enabled:false YALNIZ test kiracisinda etkilidir (smartKapaliMi). OpsX'in enabled'i burada
// hic okunmaz: OpsX'te Smart kapatmak Crypto Hub'i onaysiz ACMAZ.
//
// ocoTest (D8): test kiracilarinda OCO numarasi istensin mi; production'da OCO her zaman zorunludur
// (ocoGerekliMi). ocoCheck.environments kullanilmaz: env/ortam anahtarina bakar, node extra_vars'inda
// bu anahtarlar yok ve prod_ank'i production saymaz.
'use strict';

const BLOB_NAME = 'crypto-hub:smart';
const BOS_BLOK = Object.freeze({ enabled: true, flowKey: '', metadataFields: '', integrationKey: '', ocoTest: false });

const db = () => require('../db/index.cjs');
const opsxCfg = () => require('../opsx/config.cjs');
const envMod = () => require('../db/env-overrides.cjs');

const METIN = Object.freeze({
  okunamadi: 'Crypto Hub Smart ayarı okunamadı, lütfen tekrar deneyin.',
  yarim: 'Flow Key ile metadata şablonu birlikte dolu ya da birlikte boş olmalı. Yalnız yorum satırı içeren şablon boş sayılır.',
  gecersiz: (alanlar) => `Geçersiz alan(lar): ${alanlar.join(', ')}. Değişiklik kaydedilmedi.`,
  tokenFlowsuz: "Flow Key olmadan entegrasyon anahtarı kaydedilemez.",
  sifrelemeYok: 'Değer şifreleme anahtarı (ENV_OVERRIDES_ENCRYPTION_KEY) tanımlı değil — entegrasyon anahtarı kaydedilemez.',
  sablonUzun: 'Metadata şablonu çok uzun.',
});

const redHatasi = (blocked, message, ek = {}) => Object.assign(new Error(message), { status: 400, blocked, ...ek });
const metinOf = (x) => (typeof x === 'string' ? x : '');

/** Yalniz yorum / bos satir iceren sablon Smart'a bos metadata gonderir: bos sayilir. */
function sablonDoluMu(raw) {
  const { parseSimpleYaml } = require('../smart/metadata.cjs');
  return Object.keys(parseSimpleYaml(String(raw || ''))).length > 0;
}

/** Her cagri DB'ye gider. Okuma / ayristirma hatasi FIRLATIR. */
async function oku() {
  const r = await db().query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
  if (!Array.isArray(r?.rows)) throw new Error('portal_config_blobs yaniti gecersiz');
  if (!r.rows.length) return { ...BOS_BLOK };
  const ham = JSON.parse(r.rows[0].data);
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) throw new Error('crypto-hub:smart satiri bozuk');
  return {
    // Yalniz gercek false kapatir: bozuk bir deger Smart'i acik birakir.
    enabled: ham.enabled !== false,
    flowKey: metinOf(ham.flowKey).trim(),
    metadataFields: metinOf(ham.metadataFields),
    integrationKey: metinOf(ham.integrationKey),
    // Yalniz gercek true acar: bozuk bir deger varsayilana (kapali) duser.
    ocoTest: ham.ocoTest === true,
  };
}

/** @returns {'bos'|'dolu'|'yarim'} */
function blokDurumu(blob) {
  const flow = !!(blob?.flowKey);
  const sablon = !!blob && sablonDoluMu(blob.metadataFields);
  if (flow !== sablon) return 'yarim';
  if (!flow) return 'bos';
  return opsxCfg().SMART_KEY_RE.test(blob.flowKey) ? 'dolu' : 'yarim';
}

/**
 * Tek saf karar: bu kiracida Smart onayi kapali mi? `tenant` yalniz tenantOf sabit listesinden
 * gelir; istek govdesi ve NODE_ENV okunmaz. Bayat bir enabled:false satiri production kiraciyi
 * gevsetemez; etiket savunmasi `production` yanlis yazilirsa da kapiyi kapali tutar.
 */
function smartKapaliMi(tenant, blob) {
  if (!tenant || tenant.production !== false) return false;
  const { uretimEtiketi } = require('../opsx/prod-approval.cjs');
  if (uretimEtiketi(tenant.key) || uretimEtiketi(tenant.env) || uretimEtiketi(tenant.cluster)) return false;
  return !!blob && blob.enabled === false;
}

/**
 * Tek saf karar: bu kiracida node talebi OCO ister mi? Kiraci kurali smartKapaliMi'nin aynasi, yonu
 * ters: production ya da uretim etiketli kiraci, blob ne derse desin her zaman true (fail-closed).
 */
function ocoGerekliMi(tenant, blob) {
  if (!tenant || tenant.production !== false) return true;
  const { uretimEtiketi } = require('../opsx/prod-approval.cjs');
  if (uretimEtiketi(tenant.key) || uretimEtiketi(tenant.env) || uretimEtiketi(tenant.cluster)) return true;
  return !!blob && blob.ocoTest === true;
}

/**
 * Talep aninda kullanilacak Smart karari. Okuma / token cozme hatasi firlatir (cagiran 503).
 * @returns {Promise<{mod: 'onay'|'kapali', ocoGerekli: boolean, kaynak: 'crypto'|'opsx'|null,
 *   yarim: boolean, sa: {flowKey: string, metadataFields: string, integrationKey: string}|null}>}
 */
async function cryptoSmartCoz(tenant) {
  const blob = await oku();
  const mod = smartKapaliMi(tenant, blob) ? 'kapali' : 'onay';
  const ocoGerekli = ocoGerekliMi(tenant, blob);
  const durum = blokDurumu(blob);
  if (durum === 'yarim') return { mod, ocoGerekli, kaynak: null, yarim: true, sa: null };
  if (durum === 'dolu') {
    return {
      mod,
      ocoGerekli,
      kaynak: 'crypto',
      yarim: false,
      sa: {
        flowKey: blob.flowKey,
        metadataFields: blob.metadataFields,
        integrationKey: blob.integrationKey ? envMod().decryptSecretValue(blob.integrationKey) : '',
      },
    };
  }
  let sa = null;
  try {
    sa = await require('../opsx/prod-approval.cjs').smartApprovalFor('openshift');
  } catch {
    sa = null;
  }
  return { mod, ocoGerekli, kaynak: 'opsx', yarim: false, sa };
}

async function yaz(blob) {
  const json = JSON.stringify(blob);
  const upd = await db().query(
    `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
    [json, BLOB_NAME],
  );
  if (!upd?.rowCount) {
    await db().query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, json]);
  }
}

/**
 * Kismi govde yalniz gelen alanlari degistirir. Bos token = degistirme; flowKey silinince ya da
 * degisince token da silinir (flow'lar ayri token'la yayinlanabilir, eski token yeni flow'a sessizce
 * yapismasin; yenisi girilmezse sistem token'i kullanilir). Reddedilen govde hicbir sey yazmaz.
 * @returns {Promise<{onceki: object, sonraki: object}>}
 */
async function kaydet(govde) {
  const { SMART_KEY_RE, SMART_TOKEN_RE, SMART_METADATA_MAX } = opsxCfg();
  const g = govde && typeof govde === 'object' && !Array.isArray(govde) ? govde : {};
  const onceki = await oku();
  const sonraki = { ...onceki };
  const reddedilen = [];
  if (typeof g.enabled === 'boolean') sonraki.enabled = g.enabled;
  if (typeof g.ocoTest === 'boolean') sonraki.ocoTest = g.ocoTest;
  if (typeof g.flowKey === 'string') {
    const v = g.flowKey.trim();
    if (v !== '' && !SMART_KEY_RE.test(v)) reddedilen.push('flowKey');
    else sonraki.flowKey = v;
  }
  if (typeof g.metadataFields === 'string') {
    if (g.metadataFields.length > SMART_METADATA_MAX) reddedilen.push('metadataFields');
    else sonraki.metadataFields = g.metadataFields;
  }
  const token = metinOf(g.integrationKey).trim();
  if (token && !SMART_TOKEN_RE.test(token)) reddedilen.push('integrationKey');
  if (reddedilen.length) throw redHatasi('crypto_smart_gecersiz', METIN.gecersiz(reddedilen), { reddedilen });
  if (!sonraki.flowKey) {
    if (token) throw redHatasi('crypto_smart_token_flowsuz', METIN.tokenFlowsuz);
    sonraki.integrationKey = '';
  } else if (token) {
    if (!envMod().getEncryptionKey()) throw redHatasi('crypto_smart_sifreleme_yok', METIN.sifrelemeYok);
    sonraki.integrationKey = envMod().encryptSecretValue(token);
  } else if (sonraki.flowKey !== onceki.flowKey) {
    sonraki.integrationKey = '';
  }
  if (blokDurumu(sonraki) === 'yarim') throw redHatasi('crypto_smart_yarim', METIN.yarim);
  await yaz(sonraki);
  return { onceki, sonraki };
}

/** Kayitli token talep aninda cozulebilecek mi? Cozulemezse her talep 503 alir; ekran bunu gizlememeli. */
function tokenCozulurMu(blob) {
  if (!blob.integrationKey) return true;
  try {
    envMod().decryptSecretValue(blob.integrationKey);
    return true;
  } catch {
    return false;
  }
}

/** Istemciye gidecek sekil. Token degeri YOK (ne Crypto'nun ne OpsX'in), yalniz varlik bayragi. */
async function ekranOzeti() {
  const blob = await oku();
  const blok = blokDurumu(blob);
  let opsxFlowKey = '';
  if (blok === 'bos') {
    try {
      const sa = await require('../opsx/prod-approval.cjs').smartApprovalFor('openshift');
      opsxFlowKey = (sa?.flowKey) || '';
    } catch {
      opsxFlowKey = '';
    }
  }
  const kaynak = (() => { if (blok === 'dolu') return 'crypto'; if (opsxFlowKey) return 'opsx'; return null; })();
  // Oncelik talebin gercek sonucuna gore: yarim blok ve cozulemeyen token enabled'dan bagimsiz 503 verir.
  let durum;
  if (blok === 'yarim') durum = 'eksik';
  else if (blok === 'dolu' && !tokenCozulurMu(blob)) durum = 'token_cozulemedi';
  else if (blob.enabled === false) durum = 'testte_kapali';
  else durum = (() => { if (kaynak === 'crypto') return 'kendi'; if (kaynak === 'opsx') return 'opsx'; return 'eksik'; })();
  return {
    smart: {
      enabled: blob.enabled !== false,
      ocoTest: blob.ocoTest === true,
      flowKey: blob.flowKey,
      metadataFields: blob.metadataFields,
      integrationKeySet: Boolean(blob.integrationKey),
    },
    kaynak,
    durum,
    opsxFlowKey,
    sifrelemeVar: Boolean(envMod().getEncryptionKey()),
  };
}

function denetimYaz(req, action, detail) {
  try {
    require('../audit/index.cjs').auditPortal(req, action, { detail: JSON.stringify(detail) });
  } catch {
    /* denetim yazilamadi - kayit yine de yapildi */
  }
}

/** Kaydin denetim ozeti: token degeri yok; enabled ve ocoTest onceki -> yeni acikca yazilir. */
function kayitDetayi(onceki, sonraki) {
  return {
    enabled: { onceki: onceki.enabled, yeni: sonraki.enabled },
    ocoTest: { onceki: onceki.ocoTest, yeni: sonraki.ocoTest },
    flowKey: sonraki.flowKey,
    flowKeyDegisti: onceki.flowKey !== sonraki.flowKey,
    sablonDegisti: onceki.metadataFields !== sonraki.metadataFields,
    integrationKeySet: Boolean(sonraki.integrationKey),
    integrationKeyDegisti: onceki.integrationKey !== sonraki.integrationKey,
  };
}

/**
 * /smart-config uclari. index.cjs router'indaki requireAuth + requireVisible('CryptoHub') sonrasi
 * baglanir; ayrica her uc requireAdmin ister.
 */
function initCryptoHubSmartAyar(router, { requireAdmin }) {
  router.get('/smart-config', requireAdmin, async (_req, res) => {
    try {
      res.json({ ok: true, ...(await ekranOzeti()) });
    } catch (e) {
      console.warn('[CryptoHub] Smart ayari okunamadi:', e.message);
      res.status(503).json({ ok: false, blocked: 'crypto_smart_okunamadi', message: METIN.okunamadi });
    }
  });

  router.put('/smart-config', requireAdmin, async (req, res) => {
    let sonuc;
    try {
      sonuc = await kaydet(req.body?.smart);
    } catch (e) {
      if (e?.status === 400) {
        return res.status(400).json({
          ok: false,
          blocked: e.blocked,
          message: e.message,
          ...(e.reddedilen ? { reddedilen: e.reddedilen } : {}),
        });
      }
      console.warn('[CryptoHub] Smart ayari kaydedilemedi:', e.message);
      return res.status(503).json({ ok: false, blocked: 'crypto_smart_okunamadi', message: METIN.okunamadi });
    }
    const { onceki, sonraki } = sonuc;
    denetimYaz(req, 'crypto_hub_smart_config_save', kayitDetayi(onceki, sonraki));
    if (onceki.enabled !== sonraki.enabled) {
      denetimYaz(req, sonraki.enabled ? 'crypto_hub_smart_acildi' : 'crypto_hub_smart_kapatildi', {
        onceki: onceki.enabled,
        yeni: sonraki.enabled,
      });
    }
    try {
      res.json({ ok: true, ...(await ekranOzeti()) });
    } catch {
      res.json({ ok: true });
    }
  });

  // Taslak onizleme: GERCEK cryptoNodeMetadata, sentetik ozet. Smart'a gitmez, DB'ye yazmaz.
  router.post('/smart-config/onizle', requireAdmin, async (req, res) => {
    const raw = metinOf(req.body?.metadataFields);
    if (raw.length > opsxCfg().SMART_METADATA_MAX) {
      return res.status(400).json({ ok: false, blocked: 'crypto_smart_gecersiz', message: METIN.sablonUzun });
    }
    const ben = (req.session?.user) || req.user || {};
    try {
      const metadata = await require('./node.cjs').taslakOnizle(raw, ben);
      res.json({ ok: true, metadata });
    } catch (e) {
      res.json({ ok: true, metadata: null, hata: e.message });
    }
  });
}

module.exports = {
  BLOB_NAME,
  oku,
  kaydet,
  ekranOzeti,
  sablonDoluMu,
  blokDurumu,
  smartKapaliMi,
  ocoGerekliMi,
  cryptoSmartCoz,
  initCryptoHubSmartAyar,
};
