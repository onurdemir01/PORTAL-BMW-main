// server/admin/__tests__/system-config-ekran.test.cjs
// BEYAZ LISTEDEKI HER AYAR EKRANDA DA OLMALI.
//
// 2026-09-18 denetimi: `SCALEX_*` yedi anahtar `SYSTEM_CONFIG_KEYS`te vardi ve
// `PUT /api/admin/system-config` onlari KABUL EDIYORDU — ama `SystemConfigTab`
// ekrani ELLE KURATORLU bir `ENV_VARS` listesinden ciziliyor ve o listede
// yoklardi. Sonuc: PR #102'nin "ScaleX ayarlari admin ekranindan verilebilecek"
// vaadi yalnizca API duzeyinde gerceklesmisti; ekranda ALAN YOKTU.
//
// Ayni kayma OPSX_*_TEMPLATE_ID ve OCO_TIMEOUT_MS'te de vardi (uzun suredir).
// DA6 bekcisi yalnizca SUNUCU tarafini (TUNABLES <-> SYSTEM_CONFIG_KEYS <->
// HOT_RELOADABLE_KEYS) olcuyordu — ekran tarafi hic bakilmiyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TAB = path.join(ROOT, 'src/components/admin/tabs/SystemConfigTab.tsx');
// Meta veri (ENV_VARS) ekran bileseninden ayri dosyada (2026-10-15 Sistem yeniden tasarimi).
const META = path.join(ROOT, 'src/components/admin/tabs/sistem/ortamDegiskenleri.ts');
const SISTEM = path.join(ROOT, 'src/components/admin/tabs/sistem');
// Kaydetme akisi (PUT ve restart karari) ekranin veri kancasinda.
const HOOK = path.join(SISTEM, 'useSistemAyarlari.ts');
const KURALLAR = path.join(SISTEM, 'ayarKurallari.ts');

/** Yorum satirlari atilmis kaynak (yorumdaki ornek kalip bekciyi yaniltmasin). */
function kodOnly(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

/** Ekrandaki `ENV_VARS` girdileri: anahtar -> girdinin TAM METNI.
 *
 *  BLOK BAZLI OKUNUR, SATIR BAZLI DEGIL: bicimlendirici (prettier) girdileri tek
 *  satirdan cok satira cevirince, satir arayan eski okuyucu girdiyi HIC bulamiyor ve
 *  bekci yanlis sebeple kirmiziya donuyordu (2026-09-28).
 */
function ekranGirdileri() {
  const src = fs.readFileSync(META, 'utf8');
  const m = new Map();
  for (const g of src.matchAll(/\{[^{}]*key:\s*['"]([A-Z0-9_]+)['"][^{}]*\}/g)) m.set(g[1], g[0]);
  return m;
}

/** Ekrandaki `ENV_VARS` girdilerinin anahtarlari. */
function ekranAnahtarlari() {
  const src = fs.readFileSync(META, 'utf8');
  // TIRNAK TURU IDDIANIN KONUSU DEGIL: bicimlendirici (prettier) cift tirnagi tek
  // tirnaga cevirince toplayici SIFIR anahtar gordu ve bekci tum anahtarlarda
  // yanlis sebeple kirmiziya dondu (2026-09-28).
  return [...src.matchAll(/\{\s*key:\s*['"]([A-Z0-9_]+)['"]/g)].map((m) => m[1]);
}

test('S11 `SYSTEM_CONFIG_KEYS`teki her anahtar admin ekraninda GORUNUYOR', () => {
  const { SYSTEM_CONFIG_KEYS } = require('../../db/env-overrides.cjs');
  const ekranda = ekranAnahtarlari();

  // TOPLAYICI BOSALMASIN: desen bozulursa liste sifirlanir ve test VAKUMLA gecer.
  assert.ok(ekranda.length >= 50, `ekran toplayicisi yalnizca ${ekranda.length} anahtar gordu`);

  const eksik = SYSTEM_CONFIG_KEYS.filter((k) => !ekranda.includes(k));
  assert.deepEqual(
    eksik,
    [],
    'Bu anahtarlar sunucuda duzenlenebilir ama EKRANDA ALAN YOK — kullanici ancak ' +
      `elle API cagrisiyla girebilir:\n  ${eksik.join('\n  ')}`,
  );
});

// S11b — IKI YONLU: ekranda olup beyaz listede OLMAYAN her anahtar salt okunur olmali.
// NODE_ENV ve SMART_TICKET_TIMEOUT_MINUTES ekranda "Duzenle" ile gorunuyordu; kaydetmek
// 400 donuyordu ("Bu anahtar duzenlenemez."). Tersi de kilitli: 'ortam' isaretli bir
// anahtar beyaz listeye girerse ekran onu duzenlenemez gosterir ama sunucu kabul eder.
// 'opsx' (KARAR-1, 2026-10-15): OPSX_SMART_* OpsX'teki Smart Onayi penceresinden yonetilir
// (kullanici: "admin panelinde olmasin"); burada yalniz bilgi satiri.
test('S11b beyaz liste disi anahtar `saltOkunur: ortam`; opsx yalniz OPSX_SMART_*', () => {
  const { SYSTEM_CONFIG_KEYS } = require('../../db/env-overrides.cjs');
  const girdiler = ekranGirdileri();
  // Toplayici iki desende de AYNI sayida girdi gormeli: girdi duz nesne degilse
  // (ic ice suslu parantez) `ekranGirdileri` onu kacirir ve bu bekci o girdiye bakmaz.
  assert.equal(girdiler.size, ekranAnahtarlari().length, 'ENV_VARS girdisi duz nesne degil');
  const salt = (g) => (g.match(/saltOkunur:\s*['"](\w+)['"]/) || [])[1] || null;
  const hatalar = [];
  for (const [key, g] of girdiler) {
    const s = salt(g);
    const listede = SYSTEM_CONFIG_KEYS.includes(key);
    if (!listede && s !== 'ortam') hatalar.push(`${key}: beyaz listede yok ama 'ortam' degil (${s})`);
    if (listede && s === 'ortam') hatalar.push(`${key}: beyaz listede ama 'ortam' isaretli`);
    if (s === 'opsx' && !/^OPSX_SMART_/.test(key)) hatalar.push(`${key}: 'opsx' yalniz OPSX_SMART_*`);
    if (/^OPSX_SMART_/.test(key) && s !== 'opsx') hatalar.push(`${key}: OPSX_SMART_* 'opsx' olmali`);
    if (s && !['ortam', 'opsx'].includes(s)) hatalar.push(`${key}: bilinmeyen saltOkunur '${s}'`);
  }
  assert.deepEqual(hatalar, []);
});

// S12 — SICAK ANAHTARLAR EKRANDA "RESTART GEREKIR" DEMEMELI.
// Ekranin kendi `restartRequired` alani IKINCI bir dogruluk kaynagiydi; sunucu
// "gerekmez" derken ekran "gerekir" yaziyordu ve kullanici bosuna kesinti
// planliyordu. Artik karar sunucunun `hotReloadable` alanindan geliyor.
test('S12 sicak yuklenen anahtarlar ekranda `restartRequired: true` TASIMIYOR', () => {
  const { HOT_RELOADABLE_KEYS } = require('../../db/env-overrides.cjs');
  const girdiler = ekranGirdileri();
  const yanlis = [];
  for (const key of HOT_RELOADABLE_KEYS) {
    // GIRDININ TAMAMI okunur: alanlar satirlara bolunmus olabilir (prettier).
    const girdi = girdiler.get(key);
    assert.ok(girdi, `${key} ekranda yok (S11 bunu zaten yakalamali)`);
    if (/restartRequired:\s*true/.test(girdi)) yanlis.push(key);
  }
  assert.deepEqual(yanlis, [], `sicak yuklenen ama "restart gerekir" yazan: ${yanlis.join(', ')}`);
  // 2026-10-15: meta alan TAMAMEN kalkti (47 anahtarda sunucuyla celisiyordu). Geri gelirse
  // ikinci dogruluk kaynagi da geri gelir; tek kaynak sunucunun `hotReloadable` alani.
  assert.doesNotMatch(
    kodOnly(fs.readFileSync(META, 'utf8')),
    /restartRequired\s*:/,
    'meta veride `restartRequired` alani geri geldi — ikinci dogruluk kaynagi',
  );
  assert.match(
    kodOnly(fs.readFileSync(KURALLAR, 'utf8')),
    /cv\.hotReloadable/,
    'uygulanma (canli/restart) sunucunun hotReloadable alanindan okunmuyor',
  );
});

// S13 — KAYDETME SONRASI UYARI KOSULLU OLMALI.
// `setRestartNeeded(true)` KOSULSUZ cagriliyordu: sicak bir ayari degistiren
// admin de "sunucu yeniden baslatilmali" bandini goruyordu. Karar PUT yanitindaki
// `restartRequired` alanindan gelmeli (o da anahtara gore hesaplaniyor).
test('S13 kaydetme sonrasi restart bandi PUT yanitina bagli', () => {
  const kodSatirlari = kodOnly(fs.readFileSync(HOOK, 'utf8'));
  assert.doesNotMatch(
    kodSatirlari,
    /^\s*setRestartNeeded\(true\);\s*$/m,
    'restart bandi KOSULSUZ aciliyor — sicak ayarlarda yanlis uyari',
  );
  assert.match(
    kodSatirlari,
    /r\.restartRequired !== false/,
    'restart karari PUT yanitindan okunmuyor',
  );
  // 2026-10-15 GUCLENDIRME: literal tek basina yetmiyordu — kosullu satirin ALTINA ikinci,
  // KOSULSUZ bir cagri eklense bekci yine yesil kalirdi. Cagri TEK ve kosulun ICINDE olmali.
  assert.match(
    kodSatirlari,
    /if \(r\.restartRequired !== false\) restartBekleyeneEkle\(/,
    'restart listesine ekleme PUT yanitina bagli degil',
  );
  const cagrilar = (kodSatirlari.match(/(?<!function )\brestartBekleyeneEkle\(/g) || []).length;
  assert.equal(cagrilar, 1, `restartBekleyeneEkle ${cagrilar} kez cagriliyor (tam 1 olmali)`);
  // Ekranin baska bir dosyasi da listeye dogrudan yazmamali.
  const digerleri = [path.join(ROOT, 'src/components/admin/tabs/SystemConfigTab.tsx')]
    .concat(fs.readdirSync(SISTEM).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(SISTEM, f)))
    .filter((f) => f !== HOOK && !f.endsWith('sistemOturumu.ts'))
    .filter((f) => /(?<!function )\brestartBekleyeneEkle\(/.test(kodOnly(fs.readFileSync(f, 'utf8'))));
  assert.deepEqual(digerleri.map((f) => path.relative(ROOT, f)), [], 'restart listesine kancanin disindan yaziliyor');
});

// S16 — SECIM TURU ANAHTARLARIN SECENEKLERI SUNUCUDAN GECER.
// Ekran CSRF_ORIGIN_CHECK ve SCALEX_PROD_SMART_MODE icin serbest metin yerine secenek dugmeleri
// gosteriyor. Secenek listesi sunucu dogrulayicisiyla kayarsa kullanicinin tikladigi secenek 400
// doner (ya da sunucunun kabul ettigi bir deger ekranda secilemez). Iki yon de olculur.
test('S16 secenekli anahtarlarin her secenegi sunucu dogrulayicisindan geciyor', () => {
  const { oturumAyariHatasi } = require('../../auth/oturum-ayarlari.cjs');
  const { ayarHatasi, SMART_MODES } = require('../../scalex/config.cjs');
  const src = fs.readFileSync(META, 'utf8');
  const secenekler = (key) => {
    const m = src.match(new RegExp(`key: '${key}'[^{}]*secenekler:\\s*\\[([^\\]]*)\\]`));
    assert.ok(m, `${key} icin secenekler okunamadi`);
    return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  };
  const durumlar = [
    ['CSRF_ORIGIN_CHECK', oturumAyariHatasi, ['enforce', 'log', 'off']],
    ['SCALEX_PROD_SMART_MODE', ayarHatasi, SMART_MODES],
  ];
  for (const [key, dogrula, sunucuKumesi] of durumlar) {
    const liste = secenekler(key);
    assert.ok(liste.length >= 2, `${key}: secenek listesi bos`);
    for (const v of liste) assert.equal(dogrula(key, v), null, `${key}='${v}' sunucuda REDDEDILIYOR`);
    assert.notEqual(dogrula(key, '__gecersiz__'), null, `${key}: dogrulayici her seyi kabul ediyor (bekci kor)`);
    assert.deepEqual([...liste].sort(), [...sunucuKumesi].sort(), `${key}: ekran ve sunucu secenekleri farkli`);
  }
});

// S17 — OPSX_SMART_FLOW_KEY_* metni var olmayan bir kapiyi vaat etmesin (denetim 2026-10-15).
// Satirlar "ikisi de bossa ... production islemi baslatilmaz" diyordu; oysa WAS production
// islemleri Smart kapisindan HIC gecmiyor (was.cjs opsxProductionKapisi cagirmaz) ve
// Legacy/OpenShift'te kapi Smart onayi OpsX panelinden kapatilmissa (ya da admin atladiysa)
// flow key olmadan da gecer. "Baslatilmaz" diyen satirin platformu kapidan gecmeli VE metin
// kosulu ("Smart onayi aciksa") soylemeli.
test('S17 OpsX flow key satirlari yalniz gercekten var olan kapiyi vaat eder', () => {
  const girdiler = ekranGirdileri();
  const kapiDosyasi = {
    OPSX_SMART_FLOW_KEY_LEGACY: 'server/opsx/index.cjs',
    OPSX_SMART_FLOW_KEY_OPENSHIFT: 'server/opsx/index.cjs',
    OPSX_SMART_FLOW_KEY_WAS: 'server/opsx/was.cjs',
  };
  for (const [anahtar, dosya] of Object.entries(kapiDosyasi)) {
    const girdi = girdiler.get(anahtar);
    assert.ok(girdi, `${anahtar} ekranda yok`);
    if (!/başlatılmaz/.test(girdi)) continue;
    const kaynak = fs.readFileSync(path.join(ROOT, dosya), 'utf8');
    assert.match(kaynak, /opsxProductionKapisi/, `${anahtar} "başlatılmaz" diyor ama ${dosya} Smart kapisini cagirmiyor`);
    assert.match(girdi, /Smart onayı açık/, `${anahtar} "başlatılmaz" diyor ama kapinin kosulunu (Smart onayi acik) soylemiyor`);
  }
});

// S18 — TEAMS_LONGJOB_WEBHOOK_URL SIR SAYILIR (KARAR, bulgu 13; yeniden denetim 2026-10-15).
// Adres imza (sig=) tasir: bilen herkes kanala kart gonderebilir. Desen degismeden once deger
// ekranda acikti (title ve aramada da), PUT denetim kaydina `value=` ile duz yaziliyordu ve
// DB'ye duz gidiyordu. Kural: "sirlar DB'ye, loglara ve Portal'a duz metin gitmez". Istemci
// gizliligi yalniz sunucunun `masked` alanindan okur (SistemAyarlari.test SA27).
const WEBHOOK = 'TEAMS_LONGJOB_WEBHOOK_URL';
const IMZALI = 'https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=GIZLI-IMZA-7f3Zq';

/** process.env anahtarlarini test sonunda eski haline getirir. */
function ortamiSakla(anahtarlar) {
  const eski = Object.fromEntries(anahtarlar.map((k) => [k, process.env[k]]));
  return () => {
    for (const [k, v] of Object.entries(eski)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

test('S18a SECRET_PATTERN WEBHOOK_URL ile biten her beyaz liste anahtarini kapsar (komsulari degil)', () => {
  const { SECRET_PATTERN } = require('../../config/secret-pattern.cjs');
  const { SYSTEM_CONFIG_KEYS } = require('../../db/env-overrides.cjs');
  const webhooklar = SYSTEM_CONFIG_KEYS.filter((k) => /WEBHOOK_URL$/i.test(k));
  assert.ok(webhooklar.includes(WEBHOOK), `${WEBHOOK} beyaz listede yok (bekci kor)`);
  assert.deepEqual(webhooklar.filter((k) => !SECRET_PATTERN.test(k)), [], 'sir sayilmayan webhook anahtari');
  // Desen gereginden genis degil: ayni gruptaki ve `_URL` ile biten gizli olmayan anahtarlar acik.
  for (const k of ['TEAMS_LONGJOB_THRESHOLD_MINUTES', 'TEAMS_LONGJOB_POLL_INTERVAL_SECONDS', 'AWX_URL', 'SMART_API_URL', 'OCO_API_URL']) {
    assert.ok(!SECRET_PATTERN.test(k), `${k} sir sayiliyor`);
  }
});

test('S18b webhook PUT: DB`ye sifreli, denetim kaydinda deger yok; GET maskeler', async () => {
  const express = require('express');
  const db = require('../../db/index.cjs');
  const audit = require('../../audit/index.cjs');
  const asilSorgu = db.query;
  const asilDenetim = audit.auditPortal;
  const geriYukle = ortamiSakla([WEBHOOK, 'ENV_OVERRIDES_ENCRYPTION_KEY']);
  const yazilan = [];
  const denetim = [];
  db.query = async (sql, params) => {
    if (/portal_env_overrides/.test(sql) && /UPDATE|INSERT/i.test(sql)) yazilan.push(params);
    return { rows: [], rowCount: 1 };
  };
  audit.auditPortal = (_req, eylem, ayrinti) => {
    denetim.push({ eylem, ...ayrinti });
  };
  process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'c'.repeat(64);
  let sunucu = null;
  try {
    const app = express();
    app.use((req, _res, next) => {
      req.session = { user: { username: 'adm', role: 'Admin' } };
      next();
    });
    require('../../admin/system-config.cjs').initSystemConfig(app);
    sunucu = app.listen(0);
    await new Promise((r) => sunucu.once('listening', r));
    const url = `http://127.0.0.1:${sunucu.address().port}/api/admin/system-config`;

    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: WEBHOOK, value: IMZALI }),
    });
    assert.equal(put.status, 200, await put.clone().text());
    // DB: sifreli (setEnvOverride -> encryptSecretValue).
    assert.equal(yazilan.length, 1, 'DB yazimi bekleniyordu');
    const saklanan = String(yazilan[0][0]);
    assert.ok(saklanan.startsWith('enc:v1:'), `DB'ye sifresiz gitti: ${saklanan.slice(0, 24)}`);
    assert.ok(!saklanan.includes('GIZLI-IMZA'), 'imza DB degerinde duz duruyor');
    // Denetim kaydi: yalniz anahtar adi.
    assert.equal(denetim.length, 1);
    assert.equal(denetim[0].eylem, 'system_config_update');
    assert.equal(denetim[0].detail, `key=${WEBHOOK} (value redacted)`);
    assert.ok(!JSON.stringify(denetim).includes('GIZLI-IMZA'), 'imza denetim kaydina yazildi');
    // Okuyan kod (long-job-watcher) duz degeri gormeye devam eder.
    assert.equal(process.env[WEBHOOK], IMZALI);

    const r = await (await fetch(url)).json();
    const v = r.values.find((x) => x.key === WEBHOOK);
    assert.ok(v, `${WEBHOOK} GET yanitinda yok`);
    assert.equal(v.masked, true, 'webhook maskeli bildirilmiyor');
    assert.equal(v.defined, true);
    assert.equal(v.source, 'db');
    assert.ok(!v.value.includes('GIZLI-IMZA') && !v.value.includes('logic.azure'), `GET duz deger dondu: ${v.value}`);
    assert.equal(v.value, 'ht•••Zq');
  } finally {
    db.query = asilSorgu;
    audit.auditPortal = asilDenetim;
    geriYukle();
    if (sunucu) await new Promise((r) => sunucu.close(r));
  }
});

test('S18c setEnvOverride webhook`u sifreler; production`da anahtar yoksa duz yazmaz', async () => {
  const db = require('../../db/index.cjs');
  const asil = db.query;
  const geriYukle = ortamiSakla([WEBHOOK, 'ENV_OVERRIDES_ENCRYPTION_KEY', 'NODE_ENV']);
  let yazilan = null;
  db.query = async (sql, params) => {
    if (/^UPDATE/.test(sql)) {
      yazilan = params[0];
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  try {
    const { setEnvOverride } = require('../../db/env-overrides.cjs');
    process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'd'.repeat(64);
    await setEnvOverride(WEBHOOK, IMZALI, 'adm');
    assert.ok(String(yazilan).startsWith('enc:v1:'), 'setEnvOverride webhook`u sifrelemedi');
    assert.ok(!String(yazilan).includes('GIZLI-IMZA'));

    yazilan = null;
    process.env.NODE_ENV = 'production';
    delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
    await assert.rejects(() => setEnvOverride(WEBHOOK, IMZALI, 'adm'), /ENV_OVERRIDES_ENCRYPTION_KEY tanimli degil/);
    assert.equal(yazilan, null, 'production`da anahtarsiz webhook DB`ye yazildi');
  } finally {
    db.query = asil;
    geriYukle();
  }
});

test('S18d desen degismeden once DB`ye duz yazilmis webhook yuklemede aynen kullanilir; sifreli satir cozulur', async () => {
  const db = require('../../db/index.cjs');
  const asil = db.query;
  const geriYukle = ortamiSakla([WEBHOOK, 'ENV_OVERRIDES_ENCRYPTION_KEY']);
  try {
    const { loadEnvOverrides, isFromDb, encryptSecretValue } = require('../../db/env-overrides.cjs');
    process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'e'.repeat(64);
    // Eski satir: ENC_PREFIX yok -> cozme denenmez, deger oldugu gibi uygulanir.
    delete process.env[WEBHOOK];
    db.query = async () => ({ rows: [{ env_key: WEBHOOK, env_value: IMZALI }] });
    await loadEnvOverrides();
    assert.equal(process.env[WEBHOOK], IMZALI, 'eski duz metin webhook satiri uygulanmadi');
    assert.equal(isFromDb(WEBHOOK), true);
    // Yeni satir: sifreli -> cozulur.
    const sifreli = encryptSecretValue(IMZALI);
    assert.ok(sifreli.startsWith('enc:v1:'));
    delete process.env[WEBHOOK];
    db.query = async () => ({ rows: [{ env_key: WEBHOOK, env_value: sifreli }] });
    await loadEnvOverrides();
    assert.equal(process.env[WEBHOOK], IMZALI, 'sifreli webhook satiri cozulmedi');
  } finally {
    db.query = asil;
    geriYukle();
  }
});
