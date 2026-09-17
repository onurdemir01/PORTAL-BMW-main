// server/scalex/__tests__/scalex-dinamik-ayarlar.test.cjs
// ADMIN EKRANINDAN AYAR — VE O AYARIN GERCEKTEN DINAMIK OLDUGU.
//
// KULLANICI ISTEGI (2026-09-17): "scalex deki timeout vb yapilari da admin
// ekranindan verebilecek ve bu degiskenleri de degistirince dinamik calisacak
// algilayacak yapida olmali."
//
// BU TESTLERIN TAMAMI AYNI PROSES ICINDE `process.env`i DEGISTIRIP sonucun
// DEGISTIGINI olcer. Kaynak taramasi bu sinifi GORMEZ: kod
//
//     const X = config.tunable('...');        // modul duzeyinde
//
// yazildiginda da "config.tunable cagriliyor" testi YESIL kalir, ama deger boot'ta
// donar ve admin ekrani bir daha HICBIR SEYI degistirmez. Tek gecerli olcut,
// degeri degistirip sonucun degistigini GORMEK.
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const config = require('../config.cjs');
const launch = require('../launch.cjs');

const KEYS = Object.keys(config.TUNABLES);
let saved;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// DA1 — ASIL IDDIA. Restart YOK, yeniden require YOK: yalnizca env degisti.
test('DA1 admin degeri degistirince AYNI PROSESTE yeni deger gecerli', () => {
  assert.equal(launch.verifyTimeoutDefault(), 300, 'fabrika varsayilani 300 degil');
  process.env.SCALEX_VERIFY_TIMEOUT_DEFAULT = '600';
  assert.equal(
    launch.verifyTimeoutDefault(),
    600,
    'deger BOOT-TA dondurulmus — admin ekrani hicbir seyi degistirmiyor',
  );
  process.env.SCALEX_VERIFY_TIMEOUT_DEFAULT = '120';
  assert.equal(launch.verifyTimeoutDefault(), 120, 'ikinci degisiklik uygulanmadi');
});

// DA2 — SINIRLAR DA DINAMIK. Yalnizca varsayilani dinamiklestirip min/max'i sabit
// birakmak, ekranin kabul ettigi araliktan farkli bir varsayilan uretebilirdi.
test('DA2 min/max ve diger tavanlar da AYNI ISTEKTE degisiyor', () => {
  assert.equal(launch.maxTargets(), 200);
  assert.equal(launch.prodWrittenConfirmThreshold(), 5);
  process.env.SCALEX_MAX_TARGETS = '25';
  process.env.SCALEX_PROD_CONFIRM_THRESHOLD = '1';
  assert.equal(launch.maxTargets(), 25, 'hedef tavani dinamik degil');
  assert.equal(launch.prodWrittenConfirmThreshold(), 1, 'prod esigi dinamik degil');

  process.env.SCALEX_VERIFY_TIMEOUT_MIN = '60';
  process.env.SCALEX_VERIFY_TIMEOUT_MAX = '900';
  assert.equal(launch.normalizeVerificationTimeout('45'), null, 'yeni MIN uygulanmadi');
  assert.equal(launch.normalizeVerificationTimeout('1200'), null, 'yeni MAX uygulanmadi');
  assert.equal(launch.normalizeVerificationTimeout('600'), 600, 'yeni aralik icindeki deger reddedildi');
});

// DA3 — AYARIN AWX'E GERCEKTEN ULASTIGI. Sinirlari dinamiklestirip `extra_vars`i
// eski sabitten beslemek, hicbir sey degistirmemekle ayni olurdu: kullanici admin
// ekranindan 240 yazar, ekran 240 gosterir, AWX'e 300 gider.
//
// Katalog bagimliliklari (hosts/meta/vault) bu testin konusu DEGIL — `launch.cjs`
// onlari NESNE olarak tuttugu icin require onbellegi yamanabiliyor.
test('DA3 extra_vars YENI degerlerle uretiliyor (carpan dahil)', async () => {
  const adminData = require('../../logx/v2/admin.cjs');
  const ocp = require('../../logx/v2/ocp.cjs');
  const saveHosts = adminData.resolveTerminalHosts;
  const saveMeta = adminData.resolveClusterMeta;
  const saveVault = ocp.assertVaultKeysKnownOrThrow;
  adminData.resolveTerminalHosts = async () => ({ hosts: [{ cluster: 'c1', host: 'h1' }], missing: [] });
  adminData.resolveClusterMeta = async () => [{ cluster: 'c1', vaultKey: 'k' }];
  ocp.assertVaultKeysKnownOrThrow = async () => {};
  try {
    process.env.SCALEX_VERIFY_TIMEOUT_DEFAULT = '240';
    process.env.SCALEX_VERIFY_FAIL_MULTIPLIER = '3';
    const vars = await launch.buildRunExtraVars({
      env: 'test', tenant: 'ark', namespace: 'ns1', clusters: ['c1'], apps: ['app1'],
      action: 'stop', executionMode: 'apply', allowPartial: true, mailTo: 'a@b.c', mailCc: '',
    });
    assert.equal(Number(vars.verification_timeout), 240, 'butce admin degerinden gelmiyor');
    assert.equal(Number(vars.verify_warn_seconds), 240, 'uyari esigi admin degerinden gelmiyor');
    assert.equal(Number(vars.verify_fail_seconds), 720, 'fail carpani admin degerinden gelmiyor');
  } finally {
    adminData.resolveTerminalHosts = saveHosts;
    adminData.resolveClusterMeta = saveMeta;
    ocp.assertVaultKeysKnownOrThrow = saveVault;
  }
});

// DA4 — TUTARSIZ AYAR SESSIZCE UYGULANMAZ. min > max yazan bir admin, ekranda
// "60-30 arasi bir deger girin" ve her istegin reddedilmesiyle karsilasirdi.
test('DA4 tutarsiz uclu UCU BIRDEN fabrikaya doner ve SEBEBI raporlanir', () => {
  process.env.SCALEX_VERIFY_TIMEOUT_MIN = '900';
  process.env.SCALEX_VERIFY_TIMEOUT_MAX = '120';
  const c = config.publicConfig();
  assert.deepEqual(
    [c.verificationTimeout.min, c.verificationTimeout.default, c.verificationTimeout.max],
    [30, 300, 3600],
    'tutarsiz uclu kismen uygulanmis — ekran anlamsiz bir aralik gosterir',
  );
  assert.ok(c.problems.length > 0, 'tutarsizlik SESSIZCE yutuldu — admin sebebini goremez');
  assert.match(c.problems.join(' '), /tutarsız/i);
});

// DA5 — SERT SINIRLAR ADMIN ICIN DE GECERLI. `MAX_TARGETS=100000` tek isle butun
// ortami durdurabilmek demekti.
test('DA5 sert sinir disindaki deger REDDEDILIR ve sebebi yazilir', () => {
  process.env.SCALEX_MAX_TARGETS = '100000';
  const c = config.publicConfig();
  assert.equal(c.maxTargets, 200, 'sert sinir asildi');
  assert.match(c.problems.join(' '), /SCALEX_MAX_TARGETS/, 'sebep raporlanmadi');

  process.env.SCALEX_MAX_TARGETS = 'bes yuz';
  assert.equal(config.publicConfig().maxTargets, 200, 'sayi olmayan deger kabul edildi');
});

// DA6 — ANAHTARLAR ADMIN EKRANINDA GORUNUYOR MU. Beyaz listede olmayan bir anahtar
// DB'den process.env'e HIC gecmez: ozellik calisir gorunur ama ekrandan
// ayarlanamaz.
test('DA6 her ayar beyaz listede VE sicak-yuklenir olarak isaretli', () => {
  const { SYSTEM_CONFIG_KEYS, HOT_RELOADABLE_KEYS } = require('../../db/env-overrides.cjs');
  for (const key of KEYS) {
    assert.ok(SYSTEM_CONFIG_KEYS.includes(key), `${key} admin ekraninda YOK (beyaz liste)`);
    assert.ok(
      HOT_RELOADABLE_KEYS.includes(key),
      `${key} "restart gerekir" diye isaretli ama gerekmiyor — kullanici bosuna kesinti planlar`,
    );
  }
});

// DA7 — EKRANIN FABRIKA DEGERLERI SUNUCUNUNKIYLE AYNI MI. Sunucu cevabi gelene
// kadar ekran kendi fallback'ini gosteriyor; ayrisirsa kullanici bir an yanlis
// araligi gorur ve reddedilen bir deger girer.
test('DA7 ekran fallback degerleri sunucu fabrika degerleriyle AYNI', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/hooks/useScaleXLimits.ts'), 'utf8');
  const pairs = [
    ["timeoutDefault: '300'", 'SCALEX_VERIFY_TIMEOUT_DEFAULT'],
    ['timeoutMin: 30', 'SCALEX_VERIFY_TIMEOUT_MIN'],
    ['timeoutMax: 3600', 'SCALEX_VERIFY_TIMEOUT_MAX'],
    ['failMultiplier: 2', 'SCALEX_VERIFY_FAIL_MULTIPLIER'],
    ['maxTargets: 200', 'SCALEX_MAX_TARGETS'],
    ['prodConfirmThreshold: 5', 'SCALEX_PROD_CONFIRM_THRESHOLD'],
    ['maxAuditGroups: 12', 'SCALEX_MAX_AUDIT_GROUPS'],
  ];
  for (const [uiText, key] of pairs) {
    assert.ok(ui.includes(uiText), `ekran fallback'i "${uiText}" degil`);
    const num = Number(uiText.match(/([0-9]+)/)[1]);
    assert.equal(config.TUNABLES[key].fallback, num, `${key}: ekran ${num}, sunucu ${config.TUNABLES[key].fallback}`);
  }
  // StoppedPanel'in kendi fabrika degeri de ayni olmali.
  const panel = fs.readFileSync(path.join(ROOT, 'src/components/scalex/StoppedPanel.tsx'), 'utf8');
  assert.match(panel, /const MAX_AUDIT_GROUPS = 12;/, 'panel fabrika tavani ayrismis');
});

// DA8 — UCUN KARARI. DA6 yalnizca LISTENIN var oldugunu kontrol ediyordu; mutasyon
// turunda `restartRequired: true` sabitini geri koydugumda HICBIR bekci kirmizi
// DONMEDI (2026-09-17 bekci korlugu). Liste dogru olup uc onu KULLANMAYABILIR.
// Bu test gercek yol isleyicisini CAGIRIR.
test('DA8 admin ucu sicak anahtar icin "restart gerekir" DEMIYOR', async () => {
  // `system-config.cjs` `setEnvOverride`i YIKIYOR — require'dan ONCE yamanmali.
  const envOv = require('../../db/env-overrides.cjs');
  const saved = envOv.setEnvOverride;
  envOv.setEnvOverride = async () => {};
  // Denetim kaydi DB'ye gitmesin.
  const audit = require('../../audit/index.cjs');
  const savedAudit = audit.auditPortal;
  audit.auditPortal = () => {};
  try {
    const routes = {};
    const fakeApp = {
      get: (p, h) => { routes[`GET ${p}`] = h; },
      put: (p, _mw, h) => { routes[`PUT ${p}`] = h || _mw; },
    };
    require('../../admin/system-config.cjs').initSystemConfig(fakeApp);

    const put = routes['PUT /api/admin/system-config'];
    assert.ok(put, 'system-config PUT ucu bulunamadi');

    const call = (key) =>
      new Promise((resolve) => {
        put(
          { session: { user: { role: 'Admin', username: 'admin' } }, body: { key, value: '600' } },
          { status: () => ({ json: resolve }), json: resolve },
        );
      });

    const hot = await call('SCALEX_VERIFY_TIMEOUT_DEFAULT');
    assert.equal(
      hot.restartRequired,
      false,
      'sicak yuklenen ayar icin "yeniden baslatin" deniyor — kullanici bosuna kesinti planlar',
    );

    // KARSI ORNEK: sicak OLMAYAN bir anahtar hala restart istemeli. Aksi halde
    // "hepsine false de" mutasyonu bu testten gecerdi.
    const cold = await call('PORT');
    assert.equal(cold.restartRequired, true, 'boot-ta okunan ayar icin restart uyarisi DUSTU');

    // GET de "sicak mi" bilgisini TASIMALI; ekran rozeti oradan geliyor.
    const rows = await new Promise((resolve) => {
      routes['GET /api/admin/system-config'](
        { session: { user: { role: 'Admin' } } },
        { status: () => ({ json: resolve }), json: resolve },
      );
    });
    const row = rows.values.find((v) => v.key === 'SCALEX_MAX_AUDIT_GROUPS');
    assert.ok(row, 'ScaleX ayari admin listesinde YOK');
    assert.equal(row.hotReloadable, true, 'ekran "sicak yuklenir" bilgisini alamiyor');
  } finally {
    envOv.setEnvOverride = saved;
    audit.auditPortal = savedAudit;
  }
});
