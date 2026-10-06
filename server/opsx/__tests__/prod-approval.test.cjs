// server/opsx/__tests__/prod-approval.test.cjs — PA1..PA12 (2026-10-06).
//
// OpsX PRODUCTION islemleri Smart onayindan gecer. Kullanici: "OpsX kismindaki Legacy
// veya Openshift fark etmez bunlarin Production akislarini Smart'a entegre etmek
// istiyorum. Yine Otomasyondaki gibi Smart talebi acilsin, onay akislarindan gectikten
// sonra Ansible tetiklensin."
//
// EN PAHALI IKI YANLIS, bu bekcilerin kilitledigi sey:
//   1. FAIL-OPEN TESPIT: 'prod1' / 'gbocpprod1' gibi serbest yazilmis bir etiketi uretim
//      saymamak = production isi ONAYSIZ kosturmak.
//   2. LIMIT KAYBI: onay sonrasi is `performSsLaunch` ile oynatiliyor ve o yol limit'i
//      YALNIZ `detail.ask_limit_on_launch` dogruysa gonderir. OpsX'in dogrudan yolu
//      (`launchJobOnServer`) KOSULSUZ gonderir. Fark gozden kacarsa onaylanmis bir Legacy
//      restart SECILEN HOST YERINE sablonun TUM envanterinde kosar - kullanicinin acikca
//      yasakladigi toplu islem ("toplu islem sakin olmasin cok tehlikeli").
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ga = require('../prod-approval.cjs');
const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

test('PA1 URETIM etiketleri yakalanir (serbest yazim + kelime icine gomulu)', () => {
  for (const e of [
    'prod', 'PROD', 'Prod', 'prd', 'PRD', 'production', 'Production',
    'prod1', 'prod-tr', 'tr-prod', 'ark_prod', 'canli', 'canlı',
    // GERCEK cluster/host adlari: isaret ayirici olmadan gomulu
    'gbocpprod1', 'giocpank3rdwyprod1', 'DACRWAP01-PROD',
  ])
    assert.equal(ga.uretimEtiketi(e), true, `uretim sayilmadi: ${e}`);
});

test('PA2 URETIM OLMAYAN etiketler onaya SOKULMAZ', () => {
  for (const e of ['test', 'TEST', 'qa', 'lab', 'dev', 'edu', 'alpha', 'odm', '', null, undefined])
    assert.equal(ga.uretimEtiketi(e), false, `yanlislikla uretim sayildi: ${String(e)}`);
});

test('PA3 preprod / nonprod URETIM DEGILDIR (yanlis pozitif kapisi)', () => {
  for (const e of ['preprod', 'pre-prod', 'nonprod', 'non_prod', 'prod-test', 'sandbox'])
    assert.equal(ga.uretimEtiketi(e), false, `yanlislikla uretim sayildi: ${e}`);
});

test('PA4 uretimIstegi ILK tutan alani SEBEP olarak doner', () => {
  const r = ga.uretimIstegi([
    { alan: 'ortam', deger: 'test' },
    { alan: 'cluster', deger: ['gbocptest1', 'giocpank3rdwyprod1'] },
  ]);
  assert.equal(r.uretim, true);
  assert.equal(r.sebep, 'cluster=giocpank3rdwyprod1');
  // Hicbiri tutmazsa sebep null
  assert.deepEqual(ga.uretimIstegi([{ alan: 'ortam', deger: 'qa' }]), {
    uretim: false,
    sebep: null,
  });
});

test('PA5 KATALOG/ENVANTER HATASI kapiyi acmaz: tum etiketler olculur', () => {
  // Legacy'de envanterdeki env bos ya da yanlis olabilir; host ADI da olculdugu icin
  // adi prod olan bir sunucu onaysiz gecmez.
  const r = ga.uretimIstegi([
    { alan: 'ortam', deger: ['', null] },
    { alan: 'sunucu', deger: ['GBJBOSSPROD03'] },
  ]);
  assert.equal(r.uretim, true);
  assert.match(r.sebep, /sunucu=GBJBOSSPROD03/);
});

test('PA6 PLATFORM BASINA flow key (kullanici karari)', () => {
  assert.deepEqual(Object.keys(ga.FLOW_KEY_ENV).sort(), ['legacy', 'openshift', 'was']);
  const eski = { ...process.env };
  try {
    delete process.env.OPSX_SMART_FLOW_KEY_LEGACY;
    // FAIL-CLOSED: anahtar yoksa null -> cagiran REDDEDER
    assert.equal(ga.smartApprovalFor('legacy'), null, 'anahtar yokken onay yapilandirmasi uretildi');
    process.env.OPSX_SMART_FLOW_KEY_LEGACY = 'FLOW-LEGACY';
    assert.equal(ga.smartApprovalFor('legacy').flowKey, 'FLOW-LEGACY');
    // Platformlar BIRBIRINDEN BAGIMSIZ: legacy tanimliyken openshift hala kapali
    delete process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    assert.equal(ga.smartApprovalFor('openshift'), null);
    assert.equal(ga.smartApprovalFor('bilinmeyen'), null);
  } finally {
    process.env = eski;
  }
});

test('PA7 flow key eksik yaniti NE YAPILACAGINI soyler ve env adini verir', () => {
  const y = ga.flowKeyEksikYaniti('openshift');
  assert.equal(y.status, 503);
  assert.match(y.body.message, /OPSX_SMART_FLOW_KEY_OPENSHIFT/);
  assert.match(y.body.message, /Admin ▸ Sistem/);
  // Onay kurulmadan production isin onaysiz KOSMADIGI yazili olmali
  assert.match(y.body.message, /başlatılmaz/);
  assert.equal(y.body.blocked, 'opsx_prod_approval_unconfigured');
});

test('PA8 LIMIT FAIL-CLOSED: template limit kabul etmiyorsa is BASLATILMAZ', async () => {
  const runner = require('../../ansible/runner.cjs');
  const eskiAyar = runner.getTemplateLaunchSettingsOnServer;
  const eskiEnv = { ...process.env };
  try {
    process.env.OPSX_SMART_FLOW_KEY_LEGACY = 'FLOW-LEGACY';
    runner.getTemplateLaunchSettingsOnServer = async () => ({ askLimitOnLaunch: false });
    const k = await ga.opsxProductionKapisi({
      platform: 'legacy',
      serverId: 1,
      templateId: 9,
      extraVars: {},
      limitValue: 'HOST1,GBLABT02',
      etiketler: [{ alan: 'ortam', deger: 'prod' }],
      req: { session: { user: { username: 'u' } } },
      islemAdi: 'Legacy restart',
    });
    assert.equal(k.proceed, false);
    assert.equal(k.body.blocked, 'opsx_prod_limit_not_accepted');
    assert.equal(k.status, 400);
    // SEBEBI SOYLER: kullanici "neden baslamadi" diye sormasin
    assert.match(k.body.message, /TÜM/);
    assert.match(k.body.message, /Prompt on launch/);
  } finally {
    runner.getTemplateLaunchSettingsOnServer = eskiAyar;
    process.env = eskiEnv;
  }
});

test('PA9 LIMIT OLCULEMEDIYSE de is BASLATILMAZ ("olculemedi" != "kabul eder")', async () => {
  const runner = require('../../ansible/runner.cjs');
  const eskiAyar = runner.getTemplateLaunchSettingsOnServer;
  const eskiEnv = { ...process.env };
  try {
    process.env.OPSX_SMART_FLOW_KEY_LEGACY = 'FLOW-LEGACY';
    runner.getTemplateLaunchSettingsOnServer = async () => {
      throw new Error('AWX 500');
    };
    const k = await ga.opsxProductionKapisi({
      platform: 'legacy',
      serverId: 1,
      templateId: 9,
      extraVars: {},
      limitValue: 'HOST1',
      etiketler: [{ alan: 'ortam', deger: 'prod' }],
      req: {},
      islemAdi: 'Legacy restart',
    });
    assert.equal(k.proceed, false);
    assert.equal(k.body.blocked, 'opsx_prod_limit_unmeasured');
    assert.equal(k.status, 503);
  } finally {
    runner.getTemplateLaunchSettingsOnServer = eskiAyar;
    process.env = eskiEnv;
  }
});

test('PA10 URETIM DEGILSE kapi SEFFAF (test/qa akislari aynen devam eder)', async () => {
  const k = await ga.opsxProductionKapisi({
    platform: 'legacy',
    serverId: 1,
    templateId: 9,
    extraVars: {},
    limitValue: 'HOST1',
    etiketler: [{ alan: 'ortam', deger: 'test' }],
    req: {},
    islemAdi: 'Legacy restart',
  });
  assert.deepEqual(k, { proceed: true }, 'test ortami onaya sokulmus');
});

test('PA11 UCLAR KAPIYA BAGLI: run (Legacy+Openshift) ve poddelete; dump KAPSAM DISI', () => {
  const cagri = (IDX.match(/opsxProductionKapisi\(/g) || []).length;
  assert.ok(cagri >= 2, `kapi cagrisi eksik (run + poddelete beklenir, bulunan: ${cagri})`);
  // poddelete ucu
  const pd = IDX.slice(IDX.indexOf("'/api/opsx/poddelete/openshift'"));
  assert.ok(pd.includes('opsxProductionKapisi('), 'poddelete ucu kapiya baglanmamis');
  // CAGRININ VARLIGI YETMEZ, KARARINA UYULMALI: `if (!kapi.proceed)` olmadan kapi
  // cagrilir ama sonucu yok sayilir ve prod pod silme onaysiz kosar (mutasyon M9).
  assert.ok(
    /if \(!kapi\.proceed\) \{/.test(pd),
    'poddelete kapinin kararina uymuyor - cagri yerinde ama etkisiz',
  );
  assert.ok(
    /staleWarning/.test(pd),
    'pod adlarinin donduruldugu uyarisi yok - sessiz bir "tamamlandi" en kotu sonuc',
  );
  // dump ucu KAPSAM DISI olmali (salt tani)
  const dBas = IDX.indexOf("'/api/opsx/dump/openshift'");
  const dSon = IDX.indexOf("'/api/opsx/poddelete/openshift'");
  assert.ok(dBas > 0 && dSon > dBas, 'uc siralamasi beklenenden farkli');
  assert.ok(
    !IDX.slice(dBas, dSon).includes('opsxProductionKapisi('),
    'dump ucu da onaya sokulmus - kullanici restart dedi, tani akisi beklememeli',
  );
});

test('PA13 BILET LIMIT TASIR: detail.ask_limit_on_launch + resolvedLaunchOptions.limit', async () => {
  // EN PAHALI SESSIZ HATA. Onay sonrasi isi Smart poller'i `performSsLaunch` ile
  // oynatiyor; o yol limit'i YALNIZ `detail.ask_limit_on_launch` dogruysa payload'a
  // koyar (buildAwxLaunchPayload). `detail: {}` gecilse onaylanmis bir Legacy restart
  // SECILEN HOST YERINE sablonun TUM envanterinde kosardi - kullanicinin yasakladigi
  // toplu islem. Kaynak taramasi bunu goremedi (mutasyon M8 sagkaldi), bu yuzden
  // bilete GERCEKTEN ne gittigi olculuyor.
  const gates = require('../../ansible/change-gates.cjs');
  const runner = require('../../ansible/runner.cjs');
  const eskiAc = gates.openSmartTicket;
  const eskiAyar = runner.getTemplateLaunchSettingsOnServer;
  const eskiPre = runner.prefillSurveyDefaultsOnServer;
  const eskiEnv = { ...process.env };
  let gecen = null;
  try {
    process.env.OPSX_SMART_FLOW_KEY_LEGACY = 'FLOW-LEGACY';
    runner.getTemplateLaunchSettingsOnServer = async () => ({ askLimitOnLaunch: true });
    runner.prefillSurveyDefaultsOnServer = async (_s, _t, ev) => ({ ...ev, tbmwans_pwd: 'x' });
    gates.openSmartTicket = async (arg) => {
      gecen = arg;
      return { ticketId: 7, externalTicketId: 'SMART-7' };
    };
    const k = await ga.opsxProductionKapisi({
      platform: 'legacy',
      serverId: 3,
      templateId: 11,
      extraVars: { application: 'crm' },
      limitValue: 'HOST1,HOST2,GBLABT02',
      etiketler: [{ alan: 'ortam', deger: 'prod' }],
      req: { session: { user: { username: 'u', mail: 'u@x' } } },
      islemAdi: 'Legacy restart',
    });
    assert.ok(gecen, 'Smart bileti hic acilmadi');
    assert.equal(
      gecen.detail.ask_limit_on_launch,
      true,
      'detail limit bayragi tasimiyor - onay sonrasi is --limit OLMADAN kosar (TOPLU ISLEM)',
    );
    assert.equal(
      gecen.resolvedLaunchOptions.limit,
      'HOST1,HOST2,GBLABT02',
      'limit degeri bilete yazilmamis',
    );
    // ZORUNLU SURVEY VARSAYILANLARI onceden dolduruldu: replay yolu bunu yapmaz
    assert.equal(gecen.extraVars.tbmwans_pwd, 'x', 'survey varsayilanlari doldurulmamis');
    // GERCEK sunucu/template kimligi: 0 ya da uydurma deger, onaylanmis isi
    // "AWX sunucusu bulunamadi" ile sessizce oldururdu
    assert.equal(gecen.server.id, 3);
    assert.equal(gecen.templateId, 11);
    // Kullaniciya DONEN yanit: is BASLAMADI, bilet numarasi var
    assert.equal(k.proceed, false);
    assert.equal(k.body.pendingApproval, true);
    assert.equal(k.body.externalTicketId, 'SMART-7');
    assert.ok(!k.status, 'onay bekleyen talep HTTP hatasi olarak donmus');
  } finally {
    gates.openSmartTicket = eskiAc;
    runner.getTemplateLaunchSettingsOnServer = eskiAyar;
    runner.prefillSurveyDefaultsOnServer = eskiPre;
    process.env = eskiEnv;
  }
});

test('PA12 KAPI COZUMDEN SONRA cagrilir ve KATALOGDAN COZULMUS degerleri olcer', () => {
  // Istemcinin gonderdigi env/tenant DEGIL: resolveOpenshiftTargets'in dogruladigi.
  assert.ok(
    /ocEnvForGate = envKey;/.test(IDX) && /ocTenantForGate = tenantKey;/.test(IDX),
    'OpenShift dali kapiya katalogdan cozulmus env/tenant tasimiyor',
  );
  // "Tum cluster'lar" secildiginde grubun TAMAMI olcume girmeli
  assert.ok(
    /ocKapiHedefleri = targetCluster \? \[targetCluster\] : clusterNames;/.test(IDX),
    "'Tum cluster'lar' secildiginde grubun tamami olculmuyor",
  );
  // Legacy: secilen host'larin ENVANTERDEKI env'i olculur (istemci degeri degil)
  assert.ok(/seciliEnvler/.test(IDX), 'Legacy ortam etiketi envanterden okunmuyor');
  // GECICI BLOK KALDIRILDI: artik reddetme degil onay
  assert.ok(
    !/ocp-prod-restart-gate/.test(IDX),
    'gecici blok hala bagli - Smart onayi onun yerini aldi, ikisi birden OpenShift prod"u kapatir',
  );
});
