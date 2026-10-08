// server/opsx/prod-approval.cjs — OpsX PRODUCTION islemleri Smart onayindan gecer.
//
// KULLANICI TALEBI (2026-10-06): "OpsX kismindaki Legacy veya Openshift fark etmez
// bunlarin Production akislarini Smart'a entegre etmek istiyorum. Yine Otomasyondaki gibi
// Smart talebi acilsin, onay akislarindan gectikten sonra Ansible tetiklensin."
//
// ── NE YAPMIYOR: AYRI BIR SMART MOTORU ───────────────────────────────────────────────
// Onay makinesi ZATEN var ve tam bu is icin ayrilmis: `server/ansible/change-gates.cjs`
// dosyasinin kendi notu, mantik `launch-ss` govdesine gomuluyken "Self Service disindaki
// hicbir akista kapi YOKTU - OpsX, LogX ve Telnet dogrudan launchJobOnServer() cagiriyor"
// diyor. ScaleX o kapiyi kullaniyor; OpsX de ayni kapiyi kullanir. Bu modul yalnizca IKI
// soruyu cevaplar: (1) bu istek production mu, (2) hangi flow key ile talep acilacak.
//
// Onay sonrasi isi MEVCUT Smart poller'i oynatiyor (`server/smart/poller.cjs` ->
// runner.performSsLaunch). O yol genel bir AWX launch'idir ve `resolvedLaunchOptions`
// icindeki `limit`'i launch payload'ina yayar - Legacy OpsX'in `--limit`'i (host listesi +
// GBLABT02) onay sonrasi replay'de KAYBOLMAZ. Dogrulandi; bu yuzden poller'a ya da
// performSsLaunch'a OpsX bilgisi KONMUYOR (ScaleX'in bilincli olarak kacindigi sey).
//
// ── GECICI BLOGUN YERINI ALDI ────────────────────────────────────────────────────────
// 2026-10-06'da ayni gun once `ocp-prod-restart-gate.cjs` ile production OpenShift
// restart'i TAMAMEN reddeden gecici bir kapi konmustu. Kullanici karari: Smart onayi o
// blogu DEVRALIR - production islem artik reddedilmez, talep acilir ve onaydan sonra
// kosar. Uretim tespiti o modulden BIREBIR tasinmistir (desen eslemesi, preprod/nonprod
// ayiklamasi, kelime icine gomulu isaret); blogun kendisi kaldirildi.
'use strict';

// ── "PRODUCTION" NASIL ANLASILIR ─────────────────────────────────────────────────────
//
// OCP katalogundaki `env` SERBEST METIN (ocp_cluster_index.env NVARCHAR(30), admin
// yaziyor): uretimde prod/PROD/prd gorulduo. was-state.cjs'teki ENV_MAP yalniz bu uc TAM
// eslesmeyi biliyor; 'prod1' ya da 'prod-tr' gibi bir etiket oraya dusmez ve istek
// PRODUCTION SAYILMAZDI - yani onaysiz koşardi. Bir onay kapisinin fail-open davranmasi,
// kapiyi hic koymamaktan kotudur, bu yuzden DESEN eslemesi yapilir.
//
// YANLIS POZITIFE KARSI: `preprod` / `nonprod` icinde "prod" gecer ama uretim DEGILDIR;
// once ayiklanir. Yanlis pozitifin bedeli gereksiz bir onay istegi (gurultu); yanlis
// negatifin bedeli production'da ONAYSIZ restart.
const URETIM_DISI_RE = /(non[-_ ]?prod|pre[-_ ]?prod|prod[-_ ]?(test|like|sim)|sandbox)/i;

// "prod" KELIME ICINDE DE aranir, sinir sarti YOKTUR: gercek cluster adlarinda isaret
// ayiricisiz gomulu geliyor (`giocpank3rdwyprod1` - uretimdeki Wyden prod cluster'i).
// Sinir sartli bir desen bunu kacirir ve kapi fail-open olurdu.
const URETIM_GOMULU_RE = /(prod|production|canli|canlı)/i;

// `prd` KISALTMASI yalniz TAM SOZCUK olarak sayilir: uc harflik bir dizi kelime icinde
// rastgele eslesip test sunucularini gereksiz onaya sokabilirdi.
const URETIM_PRD_RE = /(^|[^a-z])prd([^a-z]|$)/i;

/** Bir ortam/cluster/host etiketi uretime mi isaret ediyor? */
function uretimEtiketi(etiket) {
  const s = String(etiket ?? '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  if (URETIM_DISI_RE.test(s)) return false;
  return URETIM_GOMULU_RE.test(s) || URETIM_PRD_RE.test(s);
}

/**
 * Istek production mu? Verilen TUM etiketler olculur ve ILK tutan sebep olarak doner.
 *
 * Legacy/WAS'ta etiket host'larin envanterdeki `env` degeridir; OpenShift'te ortam
 * (`env`), cluster grubu (`tenant`) ve cozulmus cluster adlari. Hepsi birden olculur:
 * katalogda yanlis `env` ile kaydedilmis bir satir ya da adi prod olan bir host, kapiyi
 * ACMASIN (playbook hedefi OpenShift'te `{{ oc_cluster }}_{{ env }}`).
 *
 * @param {{alan: string, deger: unknown}[]} etiketler
 * @returns {{uretim: boolean, sebep: string|null}}
 */
function uretimIstegi(etiketler) {
  for (const { alan, deger } of etiketler || []) {
    const degerler = Array.isArray(deger) ? deger : [deger];
    for (const d of degerler) {
      if (uretimEtiketi(d)) return { uretim: true, sebep: `${alan}=${String(d).trim()}` };
    }
  }
  return { uretim: false, sebep: null };
}

// ── PLATFORM BASINA FLOW KEY (kullanici karari 2026-10-06) ───────────────────────────
// Onaylayanlar platform ekiplerine gore farklilasabiliyor ve bir platformun akisi otekini
// etkilemiyor. Degerler Admin > Sistem'den girilir (portal_env_overrides allowlist'i).
const FLOW_KEY_ENV = Object.freeze({
  legacy: 'OPSX_SMART_FLOW_KEY_LEGACY',
  was: 'OPSX_SMART_FLOW_KEY_WAS',
  openshift: 'OPSX_SMART_FLOW_KEY_OPENSHIFT',
});

// ── YAPILANDIRMA NEREDEN OKUNUR (2026-10-06, kullanici) ──────────────────────────────
// "Self service otomasyonundaki her bir job icin iclerine girdigimde Smart entegrasyonunu
// ayarlayabiliyorum. OpsX icin de OpsX'in icine girdigimde, sadece adminlere gozuken sag
// ustte bir yer olsun - admin panelinde olmasin."
//
// ONCELIK: OpsX panelinde girilen deger (portal_config_blobs 'opsx:params' -> smart.<plat>),
// yoksa ortam degiskeni. Ikisi de bossa null (fail-closed, asagi bak).
//
// NEDEN GERI DUSUS KORUNUYOR: flow key'ler bir sure Admin > Sistem'e ortam degiskeni olarak
// girildi. Panel geldi diye o degerleri gecersiz saymak, calisan bir onay akisini bir
// deploy ile sessizce KAPATMAK olurdu (kapi fail-closed oldugu icin production islemler
// "yapilandirilmamis" diye reddedilmeye baslardi).
//
// BAYAT DB SATIRI RISKI: bu depoda "DB satiri koddaki varsayilani sessizce ezdi" uc kez
// yasandi. Burada o sinif GENISLEME uretemez: her iki kaynak da YALNIZ admin tarafindan
// yazilabiliyor ve DEGER YOKSA islem REDDEDILIR. Yani bayat/bos bir satir kapiyi en kotu
// halde DAHA SIKI yapar, hicbir durumda gevsetmez.
async function smartYapilandirma(plat) {
  try {
    const cfg = await require('./config.cjs').getConfig();
    return cfg.smart?.[plat] || null;
  } catch (e) {
    // DB okunamadiysa ortam degiskenlerine dusulur. Burada REDDETMEK de bir secenekti ama
    // gereksiz katiydi: env degeri varsa onay akisi ZATEN kurulu demektir.
    console.warn('[OpsX] Smart yapilandirmasi okunamadi, ortam degiskenine dusuluyor:', e.message);
    return null;
  }
}

/**
 * Bu platformda Smart onayi ETKIN mi? (kullanici karari 2026-10-07)
 *
 * VARSAYILAN ETKIN. Yapilandirma okunamazsa da ETKIN sayilir: DB'ye erisemedigimiz icin
 * production'i onaysiz gecirmek, kapiyi hic koymamaktan kotudur. Kapatma yalnizca
 * ACIK bir `enabled: false` kaydiyla olur.
 *
 * @returns {Promise<boolean>}
 */
async function smartOnayiEtkinMi(platform) {
  const plat = String(platform || '').toLowerCase();
  if (!FLOW_KEY_ENV[plat]) return true;
  const blob = await smartYapilandirma(plat);
  return blob?.enabled !== false;
}

/**
 * change-gates.openSmartTicket'in bekledigi `overrides.smartApproval` seklini uretir.
 *
 * FAIL-CLOSED: flow key girilmemisse `null` DONER ve cagiran istegi REDDEDER. "Onay
 * yapilandirilmamis" durumu, islemi onaysiz calistirmak icin bir gerekce DEGILDIR -
 * Self Servis tarafinda da ayni: flow key yoksa `smart_flow_key_missing` ile durur.
 *
 * @param {'legacy'|'was'|'openshift'} platform
 * @returns {Promise<{flowKey:string, metadataFields:string, integrationKey:string}|null>}
 */
async function smartApprovalFor(platform) {
  const plat = String(platform || '').toLowerCase();
  const envAdi = FLOW_KEY_ENV[plat];
  if (!envAdi) return null;

  const blob = await smartYapilandirma(plat);

  const flowKey =
    String(blob?.flowKey || '').trim() || String(process.env[envAdi] || '').trim();
  if (!flowKey) return null;

  return {
    flowKey,
    metadataFields:
      String(blob?.metadataFields || '').trim() ||
      String(process.env.OPSX_SMART_METADATA_FIELDS || '').trim(),
    integrationKey:
      String(blob?.integrationKey || '').trim() ||
      String(process.env.OPSX_SMART_INTEGRATION_KEY || '').trim(),
  };
}

/** Flow key eksikken dondurulecek hata govdesi - NE YAPILACAGINI soyler. */
function flowKeyEksikYaniti(platform) {
  const plat = String(platform || '').toLowerCase();
  const envAdi = FLOW_KEY_ENV[plat] || '(bilinmeyen platform)';
  const platAd = { legacy: 'Legacy (JBoss)', was: 'WAS', openshift: 'OpenShift' }[plat] || platform;
  return {
    status: 503,
    body: {
      ok: false,
      blocked: 'opsx_prod_approval_unconfigured',
      message:
        `Production işlemleri Smart onayından geçer, ancak ${platAd} platformu için Smart ` +
        `Flow Key tanımlanmamış. Yönetici, OpsX ekranının sağ üstündeki "Smart Onayı" ` +
        `penceresinden bu değeri girmeli (alternatif: ${envAdi} ortam değişkeni). ` +
        `Onay akışı kurulmadan production işlem başlatılmaz.`,
    },
  };
}

/**
 * OPSX PRODUCTION KAPISI. Uretim degilse `{proceed:true}`, uretimse Smart talebi acar ve
 * `{proceed:false, body}` doner; cagiran o govdeyi 200 ile dondurur (is BASLATILMAZ).
 *
 * `runChangeGates` YERINE dogrudan `openSmartTicket`: ortak kapi ayni zamanda OCO
 * (kesinti penceresi) kapisini da iceriyor ve OpsX bir OCO numarasi TOPLAMIYOR. Admin'in
 * OpsX ek degiskenlerine `env: prod` yazmis olmasi OCO kapisini tetikler, o da numara
 * isteyip istegi dusururdu. Istenen sey "Smart talebi acilsin"di; OCO kapsamda degil.
 *
 * ── LIMIT: FAIL-CLOSED OLCUM ───────────────────────────────────────────────────────
 * Onay sonrasi isi Smart poller'i `performSsLaunch` ile oynatiyor ve o yol limit'i YALNIZ
 * `detail.ask_limit_on_launch` dogruysa payload'a koyar (buildAwxLaunchPayload). OpsX'in
 * dogrudan yolu (`launchJobOnServer`) ise KOSULSUZ koyar. Bu fark, onaylanmis bir Legacy
 * restart'in SECILEN HOST YERINE sablonun tum envanterinde kosmasi demekti - kullanicinin
 * acikca yasakladigi toplu islem ("toplu islem sakin olmasin cok tehlikeli"). Bu yuzden
 * limit GEREKIYORSA template'in bayragi OLCULUR; tutmazsa ya da OLCULEMEZSE istek
 * REDDEDILIR. "Olculemedi" burada "kabul eder" sayilmaz.
 *
 * Zorunlu survey varsayilanlari da bilet acilmadan ONCE doldurulur: replay yolu
 * `fillRequiredSurveyDefaults` cagirmaz, onaylanmis is eksik degiskenle baslardi.
 *
 * @param {object} p
 * @param {'legacy'|'was'|'openshift'} p.platform
 * @param {number} p.serverId
 * @param {number} p.templateId
 * @param {object} p.extraVars
 * @param {string} p.limitValue  bos ise limit gerekmiyor
 * @param {{alan:string,deger:unknown}[]} p.etiketler  uretim tespiti icin olculecek alanlar
 * @param {object} p.req
 * @param {string} p.islemAdi    denetim/metadata icin kisa ad (or. "OpsX Legacy restart")
 * @param {object} [p.ozet]      Smart metadata'sina girecek ek bilgi
 * @returns {Promise<{proceed:true}|{proceed:false, status?:number, body:object}>}
 */
async function opsxProductionKapisi({
  platform,
  serverId,
  templateId,
  extraVars,
  limitValue = '',
  etiketler,
  req,
  islemAdi,
  ozet = {},
}) {
  const { uretim, sebep } = uretimIstegi(etiketler);
  if (!uretim) return { proceed: true };

  // ── KAPI KAPATILMIS MI (kullanici karari 2026-10-07) ───────────────────────────────
  // "Production islemlerindeki Smart onayini kendimiz acip kapatabilmemiz lazim, self
  // servis otomasyonlarda oyle ya burada da aynisini yapalim."
  //
  // KAPALIYKEN SESSIZ GECMEZ: production bir islem onaysiz kosuyorsa bunun DENETIMDE
  // izi kalmali. Aksi halde "bu prod restart'i kim onayladi" sorusunun cevabi yok ve
  // kapinin kapali oldugu DONEM bile geriye donuk gorunmez.
  // ADMIN KENDI TETIKLEMESINDE Smart onayini atlamis olabilir (ansible/admin-smart-atla.cjs).
  // Platform ayari DEGISMEZ; yalniz bu Admin'in bu istegi onaysiz kosar ve denetime yazilir.
  const atla = require('../ansible/admin-smart-atla.cjs');
  if (await atla.adminSmartAtliyor(req)) {
    atla.atlamayiDenetle(req, 'opsx_production', { platform, islem: islemAdi, uretimSebebi: sebep, templateId });
    return { proceed: true };
  }

  if (!(await smartOnayiEtkinMi(platform))) {
    try {
      require('../audit/index.cjs').auditPortal(req, 'opsx_prod_onaysiz_calisti', {
        detail: JSON.stringify({ platform, islem: islemAdi, uretimSebebi: sebep, templateId }),
      });
    } catch (e) {
      console.warn('[OpsX] onaysiz production denetim kaydi yazilamadi:', e.message);
    }
    return { proceed: true };
  }

  const smartApproval = await smartApprovalFor(platform);
  if (!smartApproval) {
    const y = flowKeyEksikYaniti(platform);
    return { proceed: false, status: y.status, body: { ...y.body, reason: sebep } };
  }

  const runner = require('../ansible/runner.cjs');

  // LIMIT OLCUMU (fail-closed) — bkz. yukaridaki not.
  let askLimit;
  if (limitValue) {
    try {
      const st = await runner.getTemplateLaunchSettingsOnServer(serverId, templateId);
      askLimit = st.askLimitOnLaunch;
    } catch (e) {
      return {
        proceed: false,
        status: 503,
        body: {
          ok: false,
          blocked: 'opsx_prod_limit_unmeasured',
          reason: sebep,
          message:
            `Production işlemi için AWX şablonunun "Limit" ayarı OKUNAMADI (${e.message}). ` +
            `Onay sonrası iş limit olmadan başlarsa seçilen sunucu yerine şablonun TÜM ` +
            `envanterinde çalışır; bu yüzden ölçülemeyen durumda iş başlatılmaz.`,
        },
      };
    }
    if (askLimit !== true) {
      return {
        proceed: false,
        status: 400,
        body: {
          ok: false,
          blocked: 'opsx_prod_limit_not_accepted',
          reason: sebep,
          message:
            `Bu AWX şablonunda "Limit" alanı çalıştırma anında sorulmuyor ` +
            `(ask_limit_on_launch kapalı). Onay sonrası iş, seçtiğiniz sunucu yerine ` +
            `şablonun TÜM envanterinde çalışırdı — toplu işlem riski nedeniyle ` +
            `başlatılmadı. Yönetici, AWX şablonunda Limit alanını "Prompt on launch" ` +
            `yapmalı.`,
        },
      };
    }
  }

  // Zorunlu survey varsayilanlarini SIMDI doldur: replay yolu bunu yapmaz.
  let tamExtraVars = extraVars;
  try {
    tamExtraVars = await runner.prefillSurveyDefaultsOnServer(serverId, templateId, extraVars);
  } catch (e) {
    console.warn('[OpsX] survey varsayilanlari doldurulamadi:', e.message);
  }

  const user = req?.session?.user || {};
  const gates = require('../ansible/change-gates.cjs');
  let opened;
  try {
    opened = await gates.openSmartTicket({
      server: { id: Number(serverId) },
      templateId: Number(templateId),
      username: user.username || 'unknown',
      email: user.mail || '',
      templateName: `OpsX: ${islemAdi}`,
      overrides: { smartApproval },
      extraVars: tamExtraVars,
      // `detail` OLCULMUS bayrakla donar: replay limit'i payload'a koyabilsin.
      detail: { ask_limit_on_launch: askLimit === true },
      resolvedLaunchOptions: limitValue ? { limit: limitValue } : {},
      specFields: [],
      // SABLON VARSA O KULLANILIR (2026-10-08): eskiden bu fonksiyon sablonu YOK SAYIP sabit bir
      // nesne donduruyordu; Smart flow'unun alan adlariyla (JOBTYPE, SERVERSET...) eslesmedigi icin
      // bilet acilamazdi. Sablon Self Servis ile AYNI isleyiciden gecer; OpsX'e ozgu degerler
      // {{opsx.islem}}, {{opsx.platform}}, {{opsx.uygulama}}, {{opsx.sunucular}} ... ile kullanilir.
      // Sablon yoksa eski sabit nesne (geri uyumluluk).
      buildSmartMetadata: (metadataFieldsRaw, ctx) => {
        const opsxOzet = {
          islem: islemAdi,
          platform,
          uretimSebebi: sebep,
          talepEden: user.username || '',
          ...ozet,
        };
        if (!String(metadataFieldsRaw || '').trim()) return opsxOzet;
        return require('../smart/metadata.cjs').buildSmartMetadata(metadataFieldsRaw, { ...ctx, opsx: opsxOzet });
      },
      auditAction: 'opsx_prod_smart_ticket_open',
      req,
    });
  } catch (smartErr) {
    const kod = smartErr.code === 'smart_ticket_store_failed' ? 500 : smartErr.status || 502;
    return {
      proceed: false,
      status: kod,
      body: {
        ok: false,
        blocked: 'opsx_prod_smart_failed',
        reason: sebep,
        externalTicketId: smartErr.externalTicketId,
        message: `Smart talebi açılamadı: ${smartErr.message}`,
      },
    };
  }

  return {
    proceed: false,
    body: {
      ok: true,
      pendingApproval: true,
      ticketId: opened.ticketId,
      externalTicketId: opened.externalTicketId,
      reason: sebep,
      message:
        `Production işlemi için Smart talebi açıldı (kayıt no: ${opened.externalTicketId}). ` +
        `Onay akışı tamamlanınca Ansible işi otomatik başlatılır — bu ekranda beklemeniz ` +
        `gerekmez. Talep durumunu Smart üzerinden takip edebilirsiniz.`,
    },
  };
}

module.exports = {
  uretimEtiketi,
  uretimIstegi,
  smartApprovalFor,
  smartOnayiEtkinMi,
  flowKeyEksikYaniti,
  opsxProductionKapisi,
  FLOW_KEY_ENV,
};
