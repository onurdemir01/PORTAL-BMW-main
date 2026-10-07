// server/opsx/__tests__/smart-config.test.cjs — SC1..SC10 (2026-10-06).
//
// KULLANICI TALEBI: "Nasil self service otomasyonundaki her bir job icin ayri ayri
// iclerine girdigim zaman Smart entegrasyonunu ayarlayabiliyorum; OpsX icin de OpsX'in
// icine girdigimde sadece adminlere gozuken sag ustte bir yer olsun. Admin panelinde
// olmasin."
//
// EN PAHALI DORT YANLIS, bu bekcilerin kilitledigi sey:
//   1. YETKI: yapilandirmayi admin olmayan birinin degistirmesi -> Smart flow key'i
//      degistirip onay akisini baska bir (onaysiz) flow'a yonlendirmek.
//   2. SIR SIZMASI: integrationKey bir RFF token'idir; okuma yolunda istemciye donmesi
//      ya da denetim kaydina yazilmasi onu tarayici gecmisine/loga tasir.
//   3. KOMSU BOLUMU EZMEK: ayni blob'da ('opsx:params') parametre adlari da duruyor.
//      Smart kaydeden bir admin, OpsX'in AWX parametre adlarini varsayilana dondururse
//      job'lar yanlis extra_vars anahtarlariyla kosar.
//   4. SESSIZ ATLAMA: gecersiz desenli bir flow key'i sessizce yok saymak -> admin
//      "kaydettim" sanir, production reddedilmeye devam eder (en bastaki sorun).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const OPSX = path.join(__dirname, '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');
const IDX = fs.readFileSync(path.join(OPSX, 'index.cjs'), 'utf8');
const PAGE = fs.readFileSync(path.join(SRC, 'components', 'opsx', 'OpsXWizardPage.tsx'), 'utf8');
const MODAL = fs.readFileSync(path.join(SRC, 'components', 'opsx', 'OpsXSmartConfigModal.tsx'), 'utf8');

// Sahte DB: tek bir blob satiri tutar. GERCEK sorgu metnini gorur, boylece "hangi
// bolumu yazdi" sorusu olculebilir — her sorguya basarili demek bekciyi kor birakirdi.
function konfigIle(baslangicJson, fn) {
  const dbPath = require.resolve('../../db/index.cjs');
  const cfgPath = require.resolve('../config.cjs');
  const kayitliDb = require.cache[dbPath];
  const kayitliCfg = require.cache[cfgPath];

  const durum = { data: baslangicJson };
  const mod = new Module(dbPath, null);
  mod.exports = {
    query: async (sql, params = []) => {
      if (/^\s*SELECT/i.test(sql)) {
        return durum.data == null ? { rows: [], rowCount: 0 } : { rows: [{ data: durum.data }], rowCount: 1 };
      }
      if (/^\s*UPDATE/i.test(sql)) {
        if (durum.data == null) return { rows: [], rowCount: 0 };
        durum.data = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (/^\s*INSERT/i.test(sql)) {
        durum.data = params[1];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  mod.loaded = true;
  require.cache[dbPath] = mod;
  delete require.cache[cfgPath];

  const geri = () => {
    if (kayitliDb) require.cache[dbPath] = kayitliDb; else delete require.cache[dbPath];
    if (kayitliCfg) require.cache[cfgPath] = kayitliCfg; else delete require.cache[cfgPath];
  };
  return Promise.resolve(fn(require(cfgPath), durum)).finally(geri);
}

test('SC1 uclar ADMIN gerektirir ve requireAdmin fallback DENY', async () => {
  // requireAdmin'i requireAuth'a baglamak ya da yoksa gecirmek, her oturumlu
  // kullanicinin Smart flow key'ini degistirebilmesi demekti.
  assert.match(
    IDX,
    /app\.get\(\s*'\/api\/opsx\/smart-config',\s*requireAuth,\s*requireAdmin/,
    'GET /smart-config admin gerektirmiyor',
  );
  assert.match(
    IDX,
    /app\.put\(\s*\n?\s*'\/api\/opsx\/smart-config',\s*\n?\s*requireAuth,\s*\n?\s*requireAdmin/,
    'PUT /smart-config admin gerektirmiyor',
  );
  // Auth modulu yuklenemezse admin guard'i KAPALI kalir (403), requireAuth'a DUSMEZ.
  const blok = IDX.slice(IDX.indexOf('let requireAdmin'), IDX.indexOf('// OpsX sayfasi kullaniciya kapaliysa'));
  assert.match(blok, /let requireAdmin = \(req, res, next\) =>\s*\n?\s*res\.status\(403\)/, 'requireAdmin fallback DENY degil');
  assert.ok(!/requireAdmin = requireAuth/.test(IDX), 'requireAdmin requireAuth\'a baglanmis');
});

test('SC2 integrationKey DEGERI istemciye HIC donmez', async () => {
  await konfigIle(null, async (cfg) => {
    const pub = cfg.smartPublic({
      legacy: { flowKey: 'F-L', metadataFields: 'KONU: x', integrationKey: 'GIZLI-TOKEN' },
    });
    const json = JSON.stringify(pub);
    assert.ok(!json.includes('GIZLI-TOKEN'), 'token istemci govdesine sizdi');
    assert.equal(pub.legacy.integrationKeySet, true, 'tanimli oldugu bilgisi kayboldu');
    assert.equal(pub.legacy.flowKey, 'F-L');
  });
  // Okuma ucu smartPublic KULLANMALI; ham `smart` nesnesini dondurmek token'i sizdirirdi.
  const getBlok = IDX.slice(IDX.indexOf("app.get('/api/opsx/smart-config'"), IDX.indexOf("app.put(\n    '/api/opsx/smart-config'"));
  assert.match(getBlok, /smart:\s*cfg\.smartPublic\(/, 'okuma ucu smartPublic kullanmiyor');
  assert.ok(!/smart:\s*smart\b/.test(getBlok), 'ham smart nesnesi donduruluyor');
});

test('SC3 denetim kaydina DEGER yazilmaz, yalniz "dolu mu" bayragi', () => {
  const blok = IDX.slice(IDX.indexOf("'opsx_smart_config_save'"), IDX.indexOf("res.json({ ok: true, smart: cfg.smartPublic(config)"));
  assert.match(blok, /flowKeySet: Boolean\(/, 'denetimde bayrak yok');
  assert.match(blok, /integrationKeySet: Boolean\(/, 'denetimde integrationKey bayragi yok');
  // Degerin kendisi JSON'a girmemeli
  assert.ok(!/config\[p\]\?\.integrationKey\s*[,}]/.test(blok), 'denetim kaydina token DEGERI yaziliyor');
  assert.ok(!/detail: JSON\.stringify\(config\)/.test(blok), 'tum yapilandirma denetime yaziliyor');
});

test('SC4 bos integrationKey "degistirmedim" demektir, "sil" DEMEZ', async () => {
  // Okuma yolu degeri hic dondurmedigi icin panel onu geri gonderemez. Bos gelmesi
  // silme istegi sayilirsa, metadata eslemesini degistiren admin token'i de silerdi.
  const baslangic = JSON.stringify({ smart: { legacy: { flowKey: 'F-1', metadataFields: 'A: 1', integrationKey: 'KORU-BENI' } } });
  await konfigIle(baslangic, async (cfg, durum) => {
    await cfg.saveSmartConfig({ legacy: { flowKey: 'F-2', metadataFields: 'A: 2', integrationKey: '' } });
    const yeni = JSON.parse(durum.data);
    assert.equal(yeni.smart.legacy.integrationKey, 'KORU-BENI', 'bos deger token\'i SILDI');
    assert.equal(yeni.smart.legacy.flowKey, 'F-2');
    assert.equal(yeni.smart.legacy.metadataFields, 'A: 2');
  });
});

test('SC5 Smart kaydi KOMSU bolumleri (parametre adlari) EZMEZ', async () => {
  // Ayni blob'da OpsX'in AWX parametre adlari da duruyor. Kosulsuz yazim, job'larin
  // yanlis extra_vars anahtarlariyla kosmasi demekti.
  const baslangic = JSON.stringify({
    legacy: { applicationKey: 'ozel_app', operationKey: 'ozel_op', extraVars: 'x: 1', separator: ';' },
    openshift: { ocClusterKey: 'ozel_cluster', ocInputKey: 'ozel_input' },
  });
  await konfigIle(baslangic, async (cfg, durum) => {
    await cfg.saveSmartConfig({ legacy: { flowKey: 'F-1', metadataFields: '' } });
    const yeni = JSON.parse(durum.data);
    assert.equal(yeni.legacy.applicationKey, 'ozel_app', 'parametre adi varsayilana dondu');
    assert.equal(yeni.legacy.operationKey, 'ozel_op');
    assert.equal(yeni.openshift.ocClusterKey, 'ozel_cluster');
    assert.equal(yeni.smart.legacy.flowKey, 'F-1', 'Smart bolumu yazilmadi');
  });
});

test('SC6 parametre kaydi SMART bolumunu EZMEZ (ters yon)', async () => {
  const baslangic = JSON.stringify({ smart: { legacy: { flowKey: 'F-KORU', metadataFields: 'A: 1', integrationKey: 'T' } } });
  await konfigIle(baslangic, async (cfg, durum) => {
    await cfg.saveConfig({ legacy: { applicationKey: 'app2' } });
    const yeni = JSON.parse(durum.data);
    assert.equal(yeni.smart?.legacy?.flowKey, 'F-KORU', 'parametre kaydi Smart flow key\'i sildi');
    assert.equal(yeni.smart?.legacy?.integrationKey, 'T');
  });
});

test('SC7 GECERSIZ desenli anahtar SESSIZCE atlanmaz, cagirana bildirilir', async () => {
  await konfigIle(null, async (cfg, durum) => {
    const { config, reddedilen } = await cfg.saveSmartConfig({
      legacy: { flowKey: 'bos luk var', metadataFields: '' },
      was: { flowKey: 'IYI-KEY_1.2:3', metadataFields: '' },
      openshift: { flowKey: '', metadataFields: '', integrationKey: 'kotu token!' },
    });
    assert.ok(reddedilen.includes('legacy.flowKey'), 'gecersiz flowKey bildirilmedi');
    assert.ok(reddedilen.includes('openshift.integrationKey'), 'gecersiz integrationKey bildirilmedi');
    assert.equal(config.legacy.flowKey, '', 'gecersiz deger KAYDEDILDI');
    assert.equal(config.was.flowKey, 'IYI-KEY_1.2:3', 'gecerli deger kaydedilmedi');
    // Diske de gecersiz deger yazilmamali
    assert.ok(!String(durum.data).includes('bos luk var'));
  });
});

test('SC8 bos flow key ACIK bir silme istegidir (kapi fail-closed\'a doner)', async () => {
  const baslangic = JSON.stringify({ smart: { legacy: { flowKey: 'F-1', metadataFields: '', integrationKey: '' } } });
  await konfigIle(baslangic, async (cfg) => {
    const { config, reddedilen } = await cfg.saveSmartConfig({ legacy: { flowKey: '', metadataFields: '' } });
    assert.equal(config.legacy.flowKey, '', 'flow key silinemedi');
    assert.deepEqual(reddedilen, [], 'bos deger gecersiz sayildi');
  });
});

test('SC9 metadata eslemesi UZUNLUK siniri tasir (govde sismesi)', async () => {
  await konfigIle(null, async (cfg) => {
    const uzun = 'A'.repeat(cfg.SMART_METADATA_MAX + 500);
    const { config } = await cfg.saveSmartConfig({ legacy: { flowKey: 'F-1', metadataFields: uzun } });
    assert.equal(config.legacy.metadataFields.length, cfg.SMART_METADATA_MAX);
  });
});

test('SC10 ekran: dugme ADMINE OZEL, OCO yoklugu YAZILI, kod TEK kopya', () => {
  // Dugme admin kontrolu arkasinda olmali (kozmetik kapi; uclar ayrica requireAdmin).
  assert.match(PAGE, /const admin = user\?\.role === "Admin"/, 'admin tespiti yok');
  assert.match(PAGE, /\{admin && \(\s*\n?\s*<button/, 'dugme admin kontrolu arkasinda degil');
  assert.match(PAGE, /OpsXSmartConfigModal/, 'pencere sayfaya baglanmamis');

  // OCO'nun OpsX'te OLMADIGI ekranda yazili olmali: sessiz bir bosluk, kullanicinin
  // "OCO kontrolunu de buradan ayarlarim" diye beklemesi demekti.
  assert.match(MODAL, /OCO kontrolü OpsX'te yok/, 'OCO yoklugu ekranda yazili degil');
  assert.match(MODAL, /OCO numarası\s*\n?\s*toplamıyor/, 'OCO yoklugunun SEBEBI yazili degil');

  // Flow key bossa production'in REDDEDILDIGI yazili olmali (fail-closed seffafligi).
  assert.match(MODAL, /Flow Key boşsa production işlem reddedilir/, 'fail-closed davranis yazili degil');

  // "Alanlari Getir" tablosu ve taslak uretici PAYLASILAN modulden gelmeli. Ikinci bir
  // kopya, bu depoda tekrar tekrar yasanan sinif: biri duzelir, oteki eski kalir.
  assert.match(MODAL, /from '@\/components\/self_service\/smartMetadata'/, 'paylasilan modul kullanilmiyor');
  assert.ok(!/function buildMetadataTemplate/.test(MODAL), 'taslak uretici IKINCI KEZ yazilmis');
  assert.ok(!/<thead>/.test(MODAL), 'alan tablosu IKINCI KEZ yazilmis');

  const ss = fs.readFileSync(path.join(SRC, 'components', 'self_service', 'FieldOverridesModal.tsx'), 'utf8');
  assert.match(ss, /from '\.\/smartMetadata'/, 'Self Service paylasilan module gecmemis');
  assert.ok(!/function buildMetadataTemplate/.test(ss), 'Self Service\'te yerel kopya kalmis');
});

test('SC11 SMART_KEY_RE bos diziyi REDDEDER (SC4 bu varsayima dayaniyor)', async () => {
  // MUTASYON TESTINDE ORTAYA CIKTI (2026-10-06): `if (v !== '')` kontrolunu kaldirmak
  // bugun DAVRANISI DEGISTIRMIYOR, cunku desen bos diziyi zaten reddediyor ve deger
  // oldugu gibi kaliyor. Yani SC4'un korumasi ikinci bir varsayima dayaniyor.
  //
  // Desen ileride gevsetilirse (or. `*` yerine `+` unutulursa) bos bir integrationKey
  // mevcut token'i EZERDI ve SC4 bunu yakalardi - ama o noktada hatanin SEBEBI belirsiz
  // olurdu. Bu bekci varsayimi ACIK hale getirir.
  await konfigIle(null, async (cfg) => {
    assert.equal(cfg.SMART_KEY_RE.test(''), false, 'desen bos diziyi kabul ediyor');
    assert.equal(cfg.SMART_KEY_RE.test('   '), false, 'desen boslugu kabul ediyor');
    assert.equal(cfg.SMART_KEY_RE.test('A'.repeat(201)), false, 'uzunluk siniri yok');
    assert.equal(cfg.SMART_KEY_RE.test('rff-request-flow.v1:2_3'), true, 'gercek flow adi reddedildi');
  });
});

// ── ETKIN/KAPALI ANAHTARI (SC12..SC16, 2026-10-07) ───────────────────────────────────
// Kullanici: "Production islemlerindeki Smart onayini kendimiz acip kapatabilmemiz lazim,
// self servis otomasyonlarda oyle ya burada da aynisini yapalim."
//
// EN PAHALI UC YANLIS:
//   1. VARSAYILANI KAPALI yapmak -> bir deploy, UC PLATFORMUN production onayini
//      SESSIZCE kaldirir. Self Service'te opt-in dogru (orada kapi HIC yoktu); OpsX'te
//      kapi ZATEN aktif.
//   2. Kismi bir govdenin kapiyi kapatmasi -> `Boolean(raw.enabled)` yazmak, alan hic
//      gonderilmediginde (undefined) onayi kapatirdi.
//   3. Kapaliyken SESSIZ gecmek -> "bu prod restart'i kim onayladi" sorusunun cevabi
//      kalmaz; kapinin kapali oldugu DONEM bile geriye donuk gorunmez.

test('SC12 VARSAYILAN ETKIN: kayit yoksa da onay istenir', async () => {
  await konfigIle(null, async (cfg) => {
    assert.equal(cfg.DEFAULTS.smart.legacy.enabled, true, 'varsayilan KAPALI - deploy onayi kaldirirdi');
    const { config } = await cfg.saveSmartConfig({ legacy: { flowKey: 'F-1', metadataFields: '' } });
    assert.equal(config.legacy.enabled, true, 'enabled gonderilmeyince kapandi');
    assert.equal(config.was.enabled, true);
    assert.equal(config.openshift.enabled, true);
  });
});

test('SC13 KISMI govde kapiyi KAPATAMAZ (yalniz gercek boolean)', async () => {
  const baslangic = JSON.stringify({ smart: { legacy: { enabled: true, flowKey: 'F-1', metadataFields: '', integrationKey: '' } } });
  await konfigIle(baslangic, async (cfg) => {
    // Alan HIC yok -> degismez
    let r = await cfg.saveSmartConfig({ legacy: { flowKey: 'F-2', metadataFields: '' } });
    assert.equal(r.config.legacy.enabled, true, 'alan yokken kapandi');
    // Dizge/sayi gibi truthy-falsy degerler YOK SAYILIR
    for (const v of ['false', '', 0, null, 'off']) {
      r = await cfg.saveSmartConfig({ legacy: { enabled: v, flowKey: 'F-2', metadataFields: '' } });
      assert.equal(r.config.legacy.enabled, true, `boolean olmayan deger (${String(v)}) kapiyi kapatti`);
    }
    // ACIK false kapatir
    r = await cfg.saveSmartConfig({ legacy: { enabled: false, flowKey: 'F-2', metadataFields: '' } });
    assert.equal(r.config.legacy.enabled, false, 'acik false kapatmadi');
  });
});

test('SC14 kapali/acik bilgisi istemciye DONER (ekran ucuncu durumu gosterebilsin)', async () => {
  await konfigIle(null, async (cfg) => {
    const pub = cfg.smartPublic({ legacy: { enabled: false, flowKey: 'F', integrationKey: 'T' } });
    assert.equal(pub.legacy.enabled, false);
    // Kayit hic yoksa ETKIN gorunur - ekran "tanimsiz"i "kapali" ile karistirmasin
    assert.equal(pub.was.enabled, true);
  });
});

test('SC15 YAPILANDIRMA OKUNAMAZSA kapi ETKIN sayilir (fail-closed)', async () => {
  // DB'ye erisemedigimiz icin production'i onaysiz gecirmek, kapiyi hic koymamaktan kotu.
  const cfgPath = require.resolve('../config.cjs');
  const gaPath = require.resolve('../prod-approval.cjs');
  const kayitliCfg = require.cache[cfgPath];
  const kayitliGa = require.cache[gaPath];
  const mod = new Module(cfgPath, null);
  mod.exports = { getConfig: async () => { throw new Error('DB yok'); } };
  mod.loaded = true;
  require.cache[cfgPath] = mod;
  delete require.cache[gaPath];
  const eskiWarn = console.warn;
  console.warn = () => {};
  try {
    const ga = require(gaPath);
    assert.equal(await ga.smartOnayiEtkinMi('legacy'), true, 'DB okunamazken kapi KAPALI sayildi');
    assert.equal(await ga.smartOnayiEtkinMi('openshift'), true);
  } finally {
    console.warn = eskiWarn;
    if (kayitliCfg) require.cache[cfgPath] = kayitliCfg; else delete require.cache[cfgPath];
    if (kayitliGa) require.cache[gaPath] = kayitliGa; else delete require.cache[gaPath];
  }
});

test('SC16 ekran: UC durum ayri gosterilir, KAPALI uyarisi ve denetim izi yazili', () => {
  // "yesil/sari" ikili gosterim, KAPALI durumu "tanimsiz" ile ayni gosterirdi - oysa biri
  // production'i REDDEDER, oteki ONAYSIZ GECIRIR. Bu ikisi karistirilamaz.
  assert.match(MODAL, /durum === 'acik'/, 'ucuncu durum yok');
  assert.match(MODAL, /durum === 'kapali'/, 'kapali durumu ayirt edilmiyor');
  assert.match(MODAL, /onaysız ve Smart'ta kayıtsız/, 'kapatmanin sonucu ekranda yazili degil');
  assert.match(MODAL, /opsx_prod_onaysiz_calisti/, 'denetim izi ekranda yazili degil');
  // Anahtar kapaliyken "REDDEDILIR" uyarisi GOSTERILMEMELI (yanlis olur: islem kosar)
  assert.match(MODAL, /guncel\.enabled && \(\s*\n?\s*<p className="text-\[11px\] text-red-600/,
    'Flow Key uyarisi kapi kapaliyken de gosteriliyor');

  // Kapi kapaliyken SESSIZ gecmemeli: denetim kaydi kapiya GOMULU olmali.
  const ga = fs.readFileSync(path.join(OPSX, 'prod-approval.cjs'), 'utf8');
  const blok = ga.slice(ga.indexOf('if (!(await smartOnayiEtkinMi('), ga.indexOf('const smartApproval = await'));
  assert.match(blok, /auditPortal\(req, 'opsx_prod_onaysiz_calisti'/, 'onaysiz calisma denetime yazilmiyor');
  assert.match(blok, /return \{ proceed: true \}/, 'kapi kapaliyken islem gecmiyor');
});

test('SC17 kapi KAPALIYKEN denetim kaydi GERCEKTEN yazilir (davranissal)', async () => {
  // SC16 cagrinin METNINI ariyordu; mutasyon testinde onune `void 0 &&` koyunca metin
  // hala esleserek bekciyi gecti (T3 hayatta kaldi). Bir cagrinin VARLIGINI olcen bekci
  // kordur - CALISTIGINI olcmek gerekir.
  const cfgPath = require.resolve('../config.cjs');
  const auditPath = require.resolve('../../audit/index.cjs');
  const gaPath = require.resolve('../prod-approval.cjs');
  const kayitli = {
    cfg: require.cache[cfgPath], audit: require.cache[auditPath], ga: require.cache[gaPath],
  };

  const kayitlar = [];
  const cfgMod = new Module(cfgPath, null);
  cfgMod.exports = {
    getConfig: async () => ({ smart: { legacy: { enabled: false, flowKey: '', metadataFields: '', integrationKey: '' } } }),
  };
  cfgMod.loaded = true;
  require.cache[cfgPath] = cfgMod;

  const auditMod = new Module(auditPath, null);
  auditMod.exports = { auditPortal: (_req, action, o) => kayitlar.push([action, o]) };
  auditMod.loaded = true;
  require.cache[auditPath] = auditMod;
  delete require.cache[gaPath];

  try {
    const ga = require(gaPath);
    const k = await ga.opsxProductionKapisi({
      platform: 'legacy',
      serverId: 1,
      templateId: 9,
      extraVars: {},
      limitValue: 'GBJBOSSPROD01',
      // URETIM etiketi: kapi tetiklenmeli, aksi halde test hicbir sey olcmez
      etiketler: [{ alan: 'ortam', deger: 'prod' }],
      req: { session: { user: { username: 'onurd' } } },
      islemAdi: 'OpsX Legacy restart',
    });
    assert.equal(k.proceed, true, 'kapi kapaliyken islem GECMEDI');
    const iz = kayitlar.find(([a]) => a === 'opsx_prod_onaysiz_calisti');
    assert.ok(iz, 'onaysiz production islem denetime HIC yazilmadi');
    const d = JSON.parse(iz[1].detail);
    assert.equal(d.platform, 'legacy');
    assert.equal(d.islem, 'OpsX Legacy restart');
    assert.match(d.uretimSebebi, /ortam=prod/, 'uretim sebebi kayda girmedi');
  } finally {
    for (const [k2, pth] of [['cfg', cfgPath], ['audit', auditPath], ['ga', gaPath]]) {
      if (kayitli[k2]) require.cache[pth] = kayitli[k2]; else delete require.cache[pth];
    }
  }
});

test('SC18 kapi ETKINken onaysiz GECMEZ (SC17 ters yonu)', async () => {
  // SC17 tek basina "kapi hep gecirir"i de gecerdi. Bu test enabled=true + flowKey yok
  // halinde isin BASLATILMADIGINI kilitler.
  const cfgPath = require.resolve('../config.cjs');
  const gaPath = require.resolve('../prod-approval.cjs');
  const kayitliCfg = require.cache[cfgPath];
  const kayitliGa = require.cache[gaPath];
  const mod = new Module(cfgPath, null);
  mod.exports = {
    getConfig: async () => ({ smart: { legacy: { enabled: true, flowKey: '', metadataFields: '', integrationKey: '' } } }),
  };
  mod.loaded = true;
  require.cache[cfgPath] = mod;
  delete require.cache[gaPath];
  const eskiEnv = { ...process.env };
  try {
    delete process.env.OPSX_SMART_FLOW_KEY_LEGACY;
    const ga = require(gaPath);
    const k = await ga.opsxProductionKapisi({
      platform: 'legacy', serverId: 1, templateId: 9, extraVars: {}, limitValue: '',
      etiketler: [{ alan: 'ortam', deger: 'prod' }],
      req: { session: { user: {} } }, islemAdi: 'OpsX Legacy restart',
    });
    assert.equal(k.proceed, false, 'etkin kapi onaysiz gecirdi');
    assert.equal(k.body.blocked, 'opsx_prod_approval_unconfigured');
  } finally {
    process.env = eskiEnv;
    if (kayitliCfg) require.cache[cfgPath] = kayitliCfg; else delete require.cache[cfgPath];
    if (kayitliGa) require.cache[gaPath] = kayitliGa; else delete require.cache[gaPath];
  }
});
