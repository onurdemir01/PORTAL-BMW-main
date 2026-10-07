// server/opsx/config.cjs — OpsX'in AWX'e GONDERDIGI parametrelerin admin tarafindan
// duzenlenebilir yapilandirmasi. Telnet modulu de bu blob'un openshift bolumunu
// PAYLASIR (bkz. server/opsx/ocp-target.cjs + server/telnet/index.cjs) — bu yuzden
// terminalHost*/namespaceKey/appNameKey/clustersKey/clusterListStyle alanlari
// SILINEMEZ, sadece OpsX'in KENDI /api/opsx/run yolu bunlari artik KULLANMIYOR
// (bkz. asagidaki not).
//
// NEDEN VAR: parametre adlari ('application', 'limit', 'operation') onceden KOD ICINDE
// sabitti — playbook farkli isimler bekliyorsa kod degistirip yeniden deploy etmek
// gerekiyordu. Artik Admin > OpsX Yapilandirma ekranindan degistirilebilir.
//
// SAKLAMA: portal_config_blobs (name='opsx:params'). Tablo zaten yapisiz JSON icin var;
// yeni sema gerektirmez ve deploy uygulama dizinini ezse bile DB'de kalir.
//
// TEMPLATE/SUNUCU BURADA DEGIL: onlar Admin > Playbook Kayitlari'nda (ansible_playbook_registry
// satirlari opsx_legacy_operation / opsx_openshift_operation) yonetilir — LogX ile ayni desen.
'use strict';

const BLOB_NAME = 'opsx:params';

// ── SMART ONAY YAPILANDIRMASI (2026-10-06, kullanici) ────────────────────────────────
// "Self service otomasyonundaki her bir job icin ayri ayri iclerine girdigimde Smart
// entegrasyonunu ayarlayabiliyorum. OpsX icin de OpsX'in icine girdigimde, sadece
// adminlere gozuken sag ustte bir yer olsun - admin panelinde olmasin."
//
// NEDEN BURADA: OpsX'in zaten bir yapilandirma blob'u var (portal_config_blobs
// 'opsx:params'). Yeni tablo/migration gerekmez ve ayni invalidate/cache yolu kullanilir.
//
// PLATFORM BASINA: flow key'ler zaten platform basina ayrilmisti (kullanici karari
// 2026-10-06: "onaylayanlar platform ekiplerine gore farklilasabiliyor"). Metadata
// eslemesi de ayni sekilde ayrilir; tek bir ortak esleme, uc farkli Smart flow'unun
// ElementName setinin AYNI oldugunu varsaymak olurdu ve bu varsayim yanlis.
//
// ORTAM DEGISKENI GERI DUSUS: panel bos birakilan platform icin OPSX_SMART_FLOW_KEY_*
// degeri gecerli kalir (bkz. server/opsx/prod-approval.cjs). Boylece Admin > Sistem'e
// ONCEDEN girilmis degerler kaybolmaz. Ikisi de bossa istek REDDEDILIR - "yapilandirma
// yok" durumu islemi onaysiz calistirmak icin gerekce DEGILDIR.
//
// GUVENLIK BORCU (bilincli, kapsam disi): `integrationKey` bir RFF token'idir ve bu
// blob'da DUZ METIN durur - Self Service'in servis-bazi override'inda da ayni durum var.
// Daha kotuye goturmemek icin OKUMA yolu degeri HIC DONDURMEZ (yalniz "tanimli mi"
// bayragi); yazma yolu bos deger gelirse mevcut degeri KORUR. Vault'a tasinmasi ayri is.
const SMART_PLATFORMS = Object.freeze(['legacy', 'was', 'openshift']);

// `enabled` VARSAYILANI TRUE (2026-10-07, kullanici: "production islemlerindeki Smart
// onayini kendimiz acip kapatabilmemiz lazim, self servis otomasyonlarda oyle ya").
//
// SELF SERVICE'TEN FARKLI VARSAYILAN, BILINCLI: orada `smartApproval.enabled` opt-in'dir
// (varsayilan KAPALI) cunku o akislarda kapi HIC yoktu. OpsX'te kapi ZATEN AKTIF; burada
// varsayilani false yapmak, bir deploy ile UC PLATFORMUN production onayini SESSIZCE
// kaldirmak olurdu. Varsayilan bugunku davranisi aynen surdurur; kapatma ACIK bir
// admin kararidir ve denetime yazilir.
const SMART_DEFAULTS = Object.freeze({
  enabled: true,
  flowKey: '',
  metadataFields: '',
  integrationKey: '',
});

// Flow key SAFE_KEY'e uymak ZORUNDA DEGIL: gercek Smart flow adlari tire/nokta
// icerebiliyor (or. "rff-request-flow.v1"). Yine de serbest metin degil - uzunluk ve
// satir sonu siniri var, cunku bu deger bir dis servise URL/gövde icinde gidiyor.
const SMART_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

const SMART_METADATA_MAX = 20000;

// Kod icindeki mantiksal alan adlari -> playbook'un bekledigi extra_vars anahtarlari.
// Legacy ve Openshift govdeleri YAPISAL OLARAK farkli oldugu icin alan setleri de farkli:
//   Legacy    -> extra_vars: { application, operation };  sunucu listesi AWX'in `limit` alaninda
//
//   Openshift -> OpsX'in KENDI /api/opsx/run'i artik SADECE ocClusterKey/ocInputKey
//   kullanir: extra_vars: { oc_environment, oc_cluster, oc_input }; limit YOK, terminal_host YOK.
//   oc_input coklu namespace/uygulama ciftini "ns1,app1;ns2,app2" formatinda tasir — gercek
//   bmw_openshift_jobs/application_rollout.yaml production playbook'unun BEKLEDIGI AYNI
//   sartname (playbook hedefi kendisi `hosts: "{{ oc_cluster }}_{{ oc_environment }}"` ile cozer).
//
//   `env` alaninin AWX'e giden anahtar ADI ('oc_environment') ARTIK BURADA YAPILANDIRILAMAZ —
//   index.cjs'de SABIT yazilir (2026-08-12, uretimde 3. kez yasandi: kaldirilmis "OpsX
//   Yapilandirma" admin ekraninden DB'ye eskiden kaydedilmis 'env' degeri, koddaki DEFAULT
//   duzeltilse bile DB satirinin oncelikli olmasi yuzunden gerci ezmeye devam ediyordu).
//
//   terminalHostKey/terminalHostsKey/namespaceKey/appNameKey/clustersKey/clusterListStyle
//   alanlari OpsX tarafindan artik OKUNMUYOR ama Telnet modulu (server/telnet/index.cjs)
//   hala buradan okuyup server/opsx/ocp-target.cjs'e gecirdigi icin KORUNUR.
const DEFAULTS = Object.freeze({
  legacy: {
    applicationKey: 'application',
    operationKey: 'operation',
    // Her calistirmaya eklenen sabit degiskenler ("key: value" satirlari).
    extraVars: '',
    // Sunucu listesi ayiraci (AWX `limit` alaninda kullanilir).
    separator: ',',
  },
  openshift: {
    // OpsX'in KENDI /api/opsx/run yolunun kullandigi alanlar (env HARIC — yukaridaki nota bak).
    ocClusterKey: 'oc_cluster',
    ocInputKey: 'oc_input',
    // Asagidakiler artik SADECE Telnet icin (bkz. dosya basi notu).
    terminalHostKey: 'terminal_host',
    terminalHostsKey: 'terminal_hosts',
    namespaceKey: 'namespace',
    appNameKey: 'app_name',
    clustersKey: 'ocp_clusters',
    extraVars: '',
    // Coklu namespace/uygulama ciftleri arasindaki ayirac (OpsX'in oc_input'unda ";").
    // Telnet tarafinda ise cluster_name listesini birlestirmek icin kullanilir.
    separator: ',',
    // Telnet'in cluster listesini AWX'e hangi SEKILDE gonderecegi (bkz. ocp-target.cjs).
    //   'joined'     → TEK oge, cluster_name'ler `separator` ile birlesik (varsayilan).
    //   'perCluster' → her cluster ayri oge + kendi terminal_host'u + terminal_hosts[].
    clusterListStyle: 'joined',
  },
  smart: {
    legacy: { ...SMART_DEFAULTS },
    was: { ...SMART_DEFAULTS },
    openshift: { ...SMART_DEFAULTS },
  },
});

// Hangi platformda hangi anahtar alanlari duzenlenebilir.
const KEY_FIELDS = Object.freeze({
  legacy: ['applicationKey', 'operationKey'],
  openshift: [
    'ocClusterKey', 'ocInputKey',
    'terminalHostKey', 'terminalHostsKey', 'namespaceKey', 'appNameKey', 'clustersKey',
  ],
});

// Anahtar-adi olmayan, sabit secenekli alanlar (Telnet icin).
const CLUSTER_LIST_STYLES = Object.freeze(['joined', 'perCluster']);

// extra_vars anahtarlari playbook'a AYNEN gecer — bicim kontrolu olmadan serbest metin
// kabul etmek, YAML'i bozan veya beklenmedik degisken enjekte eden degerlere yol acardi.
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

let _cache = null;

function db() {
  return require('../db/index.cjs');
}

function normalizePlatform(platform, raw, fallback) {
  const out = { ...fallback };
  for (const k of KEY_FIELDS[platform]) {
    const v = String(raw?.[k] || '').trim();
    if (v && SAFE_KEY.test(v)) out[k] = v;
  }
  if (typeof raw?.extraVars === 'string') out.extraVars = raw.extraVars;
  const sep = raw?.separator;
  // Ayirac tek bir noktalama/bosluk karakteri olmali.
  if (typeof sep === 'string' && sep.length >= 1 && sep.length <= 3) out.separator = sep;
  if (platform === 'openshift' && CLUSTER_LIST_STYLES.includes(raw?.clusterListStyle)) {
    out.clusterListStyle = raw.clusterListStyle;
  }
  return out;
}

/**
 * Tek platformun Smart ayarini normalize eder. GECERSIZ DEGER SESSIZCE KABUL EDILMEZ:
 * desene uymayan bir flow key, Smart'a gidip 400 almak yerine BOS kalir ve kapi
 * "yapilandirilmamis" diyerek istegi REDDEDER (fail-closed).
 *
 * `onceki`: diskteki mevcut ayar. `integrationKey` BOS gelirse ondan korunur - okuma yolu
 * degeri hic dondurmedigi icin panel onu geri gonderemez; bos gelmesi "degistirmedim"
 * demektir, "sil" demek DEGILDIR.
 */
function normalizeSmartPlatform(raw, onceki = SMART_DEFAULTS) {
  const out = { ...SMART_DEFAULTS, ...onceki };

  if (raw && typeof raw === 'object') {
    // YALNIZ GERCEK BOOLEAN kabul edilir. `Boolean(raw.enabled)` yazmak, alan HIC
    // gonderilmediginde (undefined) onay kapisini KAPATIRDI - kismi bir govde
    // production'i onaysiz birakamaz.
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if (typeof raw.flowKey === 'string') {
      const v = raw.flowKey.trim();
      // Bos ACIK bir silme istegidir (admin flow key'i kaldirmak isteyebilir); gecersiz
      // bir desen ise YOK SAYILMAZ - cagirana bildirilecek sekilde bos birakilir.
      out.flowKey = v === '' || SMART_KEY_RE.test(v) ? v : '';
    }
    if (typeof raw.metadataFields === 'string') {
      out.metadataFields = raw.metadataFields.slice(0, SMART_METADATA_MAX);
    }
    if (typeof raw.integrationKey === 'string') {
      const v = raw.integrationKey.trim();
      if (v !== '') out.integrationKey = SMART_KEY_RE.test(v) ? v : out.integrationKey;
    }
  }
  return out;
}

function normalizeSmart(raw, onceki) {
  const out = {};
  for (const p of SMART_PLATFORMS) {
    out[p] = normalizeSmartPlatform(raw?.[p], onceki?.[p]);
  }
  return out;
}

/** Blob'un HAM halini okur (normalize etmeden). Kismi kayit icin gerekli. */
async function readRawBlob() {
  try {
    const { rows } = await db().query(
      `SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]
    );
    if (rows.length) return JSON.parse(rows[0].data);
  } catch { /* okunamadiysa bos */ }
  return null;
}

async function writeBlob(obj) {
  const json = JSON.stringify(obj);
  const upd = await db().query(
    `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
    [json, BLOB_NAME]
  );
  if (!upd.rowCount) {
    await db().query(
      `INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, json]
    );
  }
}

async function getConfig() {
  if (_cache) return _cache;
  let parsed = null;
  try {
    const { rows } = await db().query(
      `SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]
    );
    if (rows.length) parsed = JSON.parse(rows[0].data);
  } catch { /* okunamadiysa varsayilana dus */ }

  _cache = {
    legacy: normalizePlatform('legacy', parsed?.legacy, DEFAULTS.legacy),
    openshift: normalizePlatform('openshift', parsed?.openshift, DEFAULTS.openshift),
    smart: normalizeSmart(parsed?.smart, DEFAULTS.smart),
  };
  return _cache;
}

// AYNI BLOB'DA IKI AYRI SAHIP VAR: parametre adlari (bu fonksiyon) ve Smart onayi
// (saveSmartConfig). Biri otekinin bolumunu EZMEMELI - bu yuzden her ikisi de HAM blob'u
// okuyup yalnizca KENDI bolumunu degistirir. Kosulsuz yazmak, OpsX panelinden Smart
// kaydeden bir admin'in parametre adlarini varsayilana dondurmesi demekti.
async function saveConfig(input) {
  const ham = await readRawBlob();
  const next = {
    ...(ham && typeof ham === 'object' ? ham : {}),
    legacy: normalizePlatform('legacy', input?.legacy, DEFAULTS.legacy),
    openshift: normalizePlatform('openshift', input?.openshift, DEFAULTS.openshift),
  };
  await writeBlob(next);
  invalidate();
  return (await getConfig());
}

/**
 * Yalnizca Smart bolumunu kaydeder (OpsX icindeki admin penceresi).
 *
 * Donus `{ config, reddedilen }`: desene uymayan flow/integration key'ler SESSIZCE
 * atlanmaz, cagirana bildirilir. Sessiz atlama, admin'in "kaydettim" sanip production
 * isleminin reddedilmeye devam etmesi demekti.
 */
async function saveSmartConfig(input) {
  const ham = await readRawBlob();
  const onceki = normalizeSmart(ham?.smart, DEFAULTS.smart);

  const reddedilen = [];
  for (const p of SMART_PLATFORMS) {
    const fk = input?.[p]?.flowKey;
    if (typeof fk === 'string' && fk.trim() !== '' && !SMART_KEY_RE.test(fk.trim())) {
      reddedilen.push(`${p}.flowKey`);
    }
    const ik = input?.[p]?.integrationKey;
    if (typeof ik === 'string' && ik.trim() !== '' && !SMART_KEY_RE.test(ik.trim())) {
      reddedilen.push(`${p}.integrationKey`);
    }
  }

  const next = {
    ...(ham && typeof ham === 'object' ? ham : {}),
    smart: normalizeSmart(input, onceki),
  };
  await writeBlob(next);
  invalidate();
  return { config: (await getConfig()).smart, reddedilen };
}

/** Istemciye GIDECEK sekil: `integrationKey` DEGERI YOK, yalnizca tanimli mi bayragi. */
function smartPublic(smart) {
  const out = {};
  for (const p of SMART_PLATFORMS) {
    const s = smart?.[p] || SMART_DEFAULTS;
    out[p] = {
      enabled: s.enabled !== false,
      flowKey: s.flowKey || '',
      metadataFields: s.metadataFields || '',
      integrationKeySet: Boolean(s.integrationKey),
    };
  }
  return out;
}

function invalidate() { _cache = null; }

// "key: value" satirlarini nesneye cevirir. Bilincli olarak BASIT: tam YAML parser
// eklemek (yeni bagimlilik + genis saldiri yuzeyi) bu ihtiyac icin gereksiz.
// Gecersiz anahtarlar SESSIZCE ATLANMAZ — cagirana bildirilir.
function parseExtraVarLines(text) {
  const out = {};
  const rejected = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) { rejected.push(trimmed); continue; }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!SAFE_KEY.test(key)) { rejected.push(trimmed); continue; }
    out[key] = value;
  }
  return { vars: out, rejected };
}

module.exports = {
  getConfig, saveConfig, invalidate, parseExtraVarLines,
  saveSmartConfig, smartPublic, normalizeSmart,
  DEFAULTS, KEY_FIELDS, CLUSTER_LIST_STYLES, BLOB_NAME,
  SMART_PLATFORMS, SMART_DEFAULTS, SMART_KEY_RE, SMART_METADATA_MAX,
};
