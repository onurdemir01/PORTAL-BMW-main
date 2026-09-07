// server/logx/v2/__tests__/legacy-host-selection.test.cjs — legacy kesfinde SUNUCU SECIMI.
//
// NEDEN VAR: bir uygulamanin 30 sunucusu olabiliyor ve kesif bugune kadar HEPSINI
// tariyordu (dakikalarca suren job + kullanilamaz uzunlukta dosya listesi). Artik
// kullanici sunucu seciyor. Secim istemciden geldigi icin ENVANTERDEN YENIDEN
// DOGRULANIR — aksi halde kullanici, yetkisi olmayan bir uygulamanin sunucusunu
// istek govdesine yazip orada log tarayabilirdi (anti-TOCTOU deseni, transfer() ile ayni).
'use strict';

const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const inventoryDb = require('../../../inventory/mssql.cjs');
const jobs = require('../jobs.cjs');
const requests = require('../requests.cjs');
const legacy = require('../legacy.cjs');

const REQUEST = { request_id: 'req-1' };

// Envanterde APP1 icin iki host var. Sorgu `UPPER(host)` donduruyor.
function fakePool(hosts) {
  return {
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({ recordset: hosts.map((h) => ({ host: h })) }),
    }),
  };
}

async function withStubs(hosts, fn) {
  const oldPool = inventoryDb.getPool;
  const oldLaunch = jobs.launchJob;
  const oldUpdate = requests.updateRequest;
  const launched = [];
  inventoryDb.getPool = async () => fakePool(hosts);
  jobs.launchJob = async (requestId, type, vars) => {
    launched.push({ type, vars });
    return { jobId: 1 };
  };
  requests.updateRequest = async () => {};
  try {
    return await fn(launched);
  } finally {
    inventoryDb.getPool = oldPool;
    jobs.launchJob = oldLaunch;
    requests.updateRequest = oldUpdate;
  }
}

test('seçilen sunucular yalnız onlar taranır (30 sunucu yerine 1)', async () => {
  await withStubs(['GBCJAP01', 'GBCJAP02', 'GBCJAP03'], async (launched) => {
    await legacy.discover(REQUEST, 'APP1', ['gbcjap02']);
    assert.equal(launched.length, 1);
    assert.equal(launched[0].vars.target_hosts, 'GBCJAP02', 'yalnız seçilen host taranmalı');
  });
});

test('envanterde OLMAYAN sunucu REDDEDILIR (istemciye guvenilmez)', async () => {
  await withStubs(['GBCJAP01'], async (launched) => {
    await assert.rejects(
      () => legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'BASKA-UYGULAMANIN-SUNUCUSU']),
      (e) => e.status === 400 && /ait değil/.test(e.message),
    );
    assert.equal(launched.length, 0, 'doğrulama başarısızsa job HIC baslamamali');
  });
});

test('seçim yoksa ESKI DAVRANIS korunur — tüm envanter hostları', async () => {
  await withStubs(['GBCJAP01', 'GBCJAP02'], async (launched) => {
    await legacy.discover(REQUEST, 'APP1', undefined);
    assert.equal(launched[0].vars.target_hosts, 'GBCJAP01,GBCJAP02');
  });
});

test('listHostsForApp(): sunucu seçim ekranı için env/sürüm/durum da döner', async () => {
  const oldPool = inventoryDb.getPool;
  inventoryDb.getPool = async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({
        recordset: [{ host: 'GBCJAP01', env: 'PROD', jboss_version: 'EAP7', status: 'running' }],
      }),
    }),
  });
  try {
    const rows = await legacy.listHostsForApp('APP1');
    assert.deepEqual(rows, [
      { host: 'GBCJAP01', env: 'PROD', jbossVersion: 'EAP7', status: 'running' },
    ]);
  } finally {
    inventoryDb.getPool = oldPool;
  }
});

// ── ELLE SUNUCU GIRISI (kontrollu, izlenebilir, ongorulur) ──────────────────
//
// Kullanici istegi: listede olmayan bir uygulama/sunucu icin de kesif yapilabilsin.
// Ama envanter dogrulamasi bir sunucunun VAR OLDUGUNU garanti ederken ayni zamanda
// BICIMINI de garanti ediyordu; elle giris o garantiyi kaldirir. Deger
// `target_hosts` olarak AWX'e gidip `--limit` argumanina donustugu icin bicim
// AYRICA denetlenmeli.

test('EG1 KAPI GEVSEMEDI: bayrak YOKSA envanter disi host hala REDDEDILIR', async () => {
  // Varsayilan davranis AYNEN eskisi gibi. Yeni yol ancak cagiran ACIKCA isterse acilir.
  await withStubs(['GBCJAP01'], async (launched) => {
    await assert.rejects(
      () => legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'ELLE-YAZILAN']),
      (e) => e.status === 400 && /ait değil/.test(e.message),
    );
    assert.equal(launched.length, 0, 'dogrulama basarisizsa job HIC baslamamali');
  });
});

test('EG2 bayrak VARSA envanter disi host kabul edilir ve AYRICA raporlanir', async () => {
  await withStubs(['GBCJAP01'], async (launched) => {
    const r = await legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'yeni-sunucu-01'], {
      allowManual: true,
    });
    assert.equal(launched.length, 1, 'job baslamali');
    assert.equal(launched[0].vars.target_hosts, 'GBCJAP01,YENI-SUNUCU-01');
    // IZLENEBILIRLIK: hangi adlarin envanter disi oldugu cagirana DONER.
    assert.deepEqual(r.manualHosts, ['YENI-SUNUCU-01']);
  });
});

test('EG3 envanterdeki host `manualHosts`a GIRMEZ (gurultu uretmesin)', async () => {
  await withStubs(['GBCJAP01', 'GBCJAP02'], async () => {
    const r = await legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'GBCJAP02'], {
      allowManual: true,
    });
    assert.deepEqual(r.manualHosts, [], 'envanterdeki hostlar elle girilmis sayiliyor');
  });
});

test('EG4 BICIM KAPISI: kabuk metakarakterli ad bayrakla bile REDDEDILIR', async () => {
  // `--limit` bir kabuk argumani olarak tasiniyor; bunlar enjeksiyon yuzeyi.
  const kotu = [
    'host; rm -rf /',
    'host$(whoami)',
    'host`id`',
    "host' OR 1=1 --",
    'bosluklu ad',
    'host|pipe',
    'host&arka',
  ];
  for (const bad of kotu) {
    await withStubs(['GBCJAP01'], async (launched) => {
      await assert.rejects(
        () => legacy.discover(REQUEST, 'APP1', ['GBCJAP01', bad], { allowManual: true }),
        (e) => e.status === 400 && e.code === 'manual_host_format',
        `bicim kapisi gecirdi: ${bad}`,
      );
      assert.equal(launched.length, 0, `job baslamamaliydi: ${bad}`);
    });
  }
});

test('EG5 gecerli bicimler kabul edilir (harf/rakam/nokta/tire/alt cizgi)', async () => {
  for (const ok of ['GBCJAP99', 'app-server-01', 'host.example.com', 'a_b-c.d1']) {
    await withStubs(['GBCJAP01'], async (launched) => {
      await legacy.discover(REQUEST, 'APP1', [ok], { allowManual: true });
      assert.equal(launched.length, 1, `gecerli ad reddedildi: ${ok}`);
    });
  }
});

test('EG6 elle girilen ad BUYUK HARFE cevrilir (envanterle ayni bicim)', async () => {
  await withStubs(['GBCJAP01'], async (launched) => {
    const r = await legacy.discover(REQUEST, 'APP1', ['yeni-sunucu'], { allowManual: true });
    assert.equal(launched[0].vars.target_hosts, 'YENI-SUNUCU');
    assert.deepEqual(r.manualHosts, ['YENI-SUNUCU']);
  });
});

// `withStubs` kendi `updateRequest` stub'ini KURUYOR; yakalayiciyi ICERIDE kurmak
// gerekiyor, yoksa disaridaki stub onun tarafindan eziliyor.
async function captureRequestWrites(hosts, fn) {
  const writes = [];
  await withStubs(hosts, async () => {
    requests.updateRequest = async (id, patch) => {
      writes.push(patch);
    };
    await fn();
  });
  return writes;
}

test('EG7 elle girilen sunucular ISTEK KAYDINA yazilir (sonradan gorulebilsin)', async () => {
  const writes = await captureRequestWrites(['GBCJAP01'], () =>
    legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'ELLE01'], { allowManual: true }),
  );
  const withInput = writes.find((w) => w && w.input);
  assert.ok(withInput, 'istek kaydi guncellenmedi');
  assert.deepEqual(withInput.input.manualHosts, ['ELLE01'], 'elle girilenler kayda yazilmiyor');
});

test('EG8 elle giris YOKSA `manualHosts` kayda HIC yazilmaz', async () => {
  const writes = await captureRequestWrites(['GBCJAP01'], () =>
    legacy.discover(REQUEST, 'APP1', ['GBCJAP01'], { allowManual: true }),
  );
  const withInput = writes.find((w) => w && w.input);
  assert.ok(withInput);
  assert.ok(
    !('manualHosts' in withInput.input),
    'elle giris yokken bos alan yaziliyor — kayit gurultusu',
  );
});

// ── ROUTE SEVIYESI: BAYRAK ve DENETIM GERCEKTEN BAGLI MI ────────────────────
//
// Bu depoda tekrar eden hata sinifi: mantik yazilir, test edilir ve GERCEK CAGRI
// YOLUNDAN hic gecmez. `allowManual` route'ta okunmazsa elle giris HIC calismaz;
// denetim kaydi yazilmazsa is "izlenebilir" olmaktan cikar.
// `legacy.cjs` kaynagi: bicim kapilari ve envanter olcutu KOD olarak dogrulanir.
const LEGACY_SRC = fs.readFileSync(path.join(__dirname, '..', 'legacy.cjs'), 'utf8');

const ROUTE_SRC = fs
  .readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n')
  .replace(/\s+/g, ' ')
  .replace(/'/g, '"');

test('EG9 route `allowManual` bayragini ACIKCA okuyor (varsayilan KAPALI)', () => {
  assert.match(
    ROUTE_SRC,
    /const allowManual = req\.body\?\.allowManual === true;/,
    'bayrak okunmuyor — elle giris ya hic calismaz ya da her zaman acik olur',
  );
  // BICIM DEGIL KURAL. Onceki desen cagriyi TEK SATIR halinde ariyordu; prettier
  // cagriyi cok satira bolunce bekci, bayrak DOGRU sekilde gecirilirken kirmizi
  // dondu. Olcut: `legacy.discover` cagrisinin argumanlari arasinda `allowManual`
  // gecmesi. Bosluklar tekillenir, satir sonlari onemsizlesir.
  const flatRoute = ROUTE_SRC.replace(/\s+/g, ' ');
  const call = (flatRoute.match(/legacy\.discover\(([^)]*)\)/) || [])[1] || '';
  assert.ok(call.length > 0, '`legacy.discover` cagrisi bulunamadi');
  assert.match(call, /allowManual/, 'bayrak `discover`a GECIRILMIYOR');
});

test('EG10 elle girilen sunucular DENETIM KAYDINA yaziliyor', () => {
  // "Envanter disina cikan bir is, sonradan `bu nereden geldi` sorusunu
  // cevaplayabilmeli" — izlenebilirlik sartinin kod karsiligi.
  assert.match(
    ROUTE_SRC,
    /if \(manualHosts\.length\) \{[\s\S]{0,200}audit[\s\S]{0,200}v2_legacy_manual_host/,
    'elle giris denetim kaydina yazilmiyor',
  );
});

test('EG11 elle girilen uygulama adi da YETKI KAPISINDAN geciyor', () => {
  // Kisitlama modeli VARSAYILAN-ACIK; ama bir kisit TANIMLIYSA elle yazmak onu
  // ATLATAMAMALI. Kapi `discover` cagrisindan ONCE olmali.
  const at = ROUTE_SRC.indexOf('"/legacy/:requestId/discover"');
  assert.ok(at > 0, 'route bulunamadi');
  const body = ROUTE_SRC.slice(at, at + 900);
  const gateAt = body.indexOf('assertAllowed("legacy_app"');
  const callAt = body.indexOf('legacy.discover(');
  assert.ok(gateAt > 0, 'yetki kapisi yok');
  assert.ok(gateAt < callAt, 'yetki kapisi kesiften SONRA — is coktan baslamis olur');
});

// -- ELLE GIRILEN UYGULAMA ADI ------------------------------------------------
//
// Sunucu adlari icin siki bir bicim kapisi VARDI (SAFE_MANUAL_HOST_RE) ama UYGULAMA
// adi icin HICBIR kontrol yoktu. Envanterden secilen adlar zaten guvenliydi; ekrana
// serbest metin yolu eklenince (`AppSearchStep` "Listede yok — ... adiyla devam et")
// bu bosluk gercek bir yol haline geldi: `app` degeri `app_name` olarak AWX
// extra_vars'ina, oradan playbook'a ve kabuk yollarina gidiyor.

test('EG16 uygulama adi icin BICIM kapisi var', () => {
  assert.match(
    LEGACY_SRC,
    /SAFE_MANUAL_APP_RE\s*=/,
    "uygulama adi icin bicim kapisi yok — serbest metin dogrudan extra_vars'a gider",
  );
  // Kapi GERCEKTEN uygulanmali; tanimlayip kullanmamak tam da kacirilan sey olurdu.
  const fn = LEGACY_SRC.slice(LEGACY_SRC.indexOf('async function discover('));
  assert.match(
    fn.slice(0, 2000),
    /SAFE_MANUAL_APP_RE\.test\(/,
    'bicim kapisi tanimli ama `discover` icinde UYGULANMIYOR',
  );
});

test('EG17 bos uygulama adi reddedilir', () => {
  const fn = LEGACY_SRC.slice(LEGACY_SRC.indexOf('async function discover('));
  assert.match(
    fn.slice(0, 2000),
    /Uygulama adı zorunlu/,
    'bos ad kontrolu yok — is adsiz baslar ve playbook bos `app_name` ile calisir',
  );
});

test('EG18 "envanterde var mi" olcutu HOST SAYISI degil', () => {
  // Sunucusu olmayan bir uygulama da envanterde OLABILIR. Olcut "host dondu mu"
  // olsaydi, envanterdeki bir uygulama "elle girilmis" diye isaretlenirdi.
  const fn = LEGACY_SRC.slice(LEGACY_SRC.indexOf('async function discover('));
  const window = fn.slice(0, 3000);
  assert.match(window, /searchApps\(/, 'envanter kontrolu uygulama listesinden yapilmiyor');
  assert.doesNotMatch(
    window,
    /appInInventory\s*=\s*inventoryHosts\.length/,
    'envanterde varlik HOST SAYISINDAN turetiliyor — yanlis olcut',
  );
});

test('EG19 envanter OKUNAMAZSA "elle girildi" diye ISARETLENMEZ', () => {
  // Bilinmezligi suclama olarak yazmak denetim kaydini guvenilmez yapardi:
  // DB kesintisinde her is "elle girilmis" gorunurdu.
  const fn = LEGACY_SRC.slice(LEGACY_SRC.indexOf('async function discover('));
  const catchBlock = fn.slice(fn.indexOf('searchApps('), fn.indexOf('searchApps(') + 800);
  assert.match(
    catchBlock,
    /catch\s*\{[\s\S]{0,400}appInInventory\s*=\s*true/,
    'envanter okunamayinca is "elle girilmis" sayiliyor — denetim kaydi guvenilmez olur',
  );
});

test('EG20 elle girilen UYGULAMA da denetim kaydina yazilir', () => {
  assert.match(
    ROUTE_SRC,
    /v2_legacy_manual_app/,
    'elle girilen uygulama adi denetime yazilmiyor — "bu is hangi ada gitti" cevapsiz kalir',
  );
  // Kosula bagli olmali: her is "elle girilmis" diye yazilmamali.
  const flat = ROUTE_SRC.replace(/\s+/g, ' ');
  assert.match(
    flat,
    /if \(manualApp\)/,
    'denetim kaydi kosulsuz yaziliyor — envanterden secilen adlar da "elle" gorunur',
  );
});
