// server/inventory/__tests__/mssql-havuz-ayrimi.test.cjs
//
// SALT-OKUNUR MSSQL HAVUZU GERCEKTEN AYRI OLSUN.
//
// `mssql-readonly.cjs`in basligi soyle diyordu: *"mssql.cjs'teki paylasilan
// (yazma-yetkili) havuzdan KASITLI olarak ayridir"*. AMA DEGILDI.
//
// Iki modul de `sql.connect(config)` cagiriyordu ve node-mssql'in `connect`i
// GLOBAL bir havuz kurar; `config`i YALNIZCA ILK cagride kullanir. Envanter
// ekranlari yonetici "Custom SQL" ekranindan cok once acildigi icin global
// havuzu pratikte HEP yazma-yetkili modul kuruyordu. Sonuc: salt-okunur istek
// YAZMA YETKILI kimlikle kosuyor, `MSSQL_RO_USER` hesabi HIC kullanilmiyor ve
// "Salt-okunur baglanti kuruldu" satiri YANLIS bilgi veriyordu.
//
// Bu, depodaki "calismayan kapi" sinifidir: ekran/gunluk kapinin kapali
// oldugunu soylerken kapi hic ateslenmiyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('MV1 node-mssql`in `connect`i SONRAKI configleri YOK SAYAR (kuralin sebebi)', async () => {
  // Kutuphanenin GERCEK `connect` fonksiyonu; yalnizca surucu sahte.
  // Bir surum yukseltmesi bu semantigi degistirirse bu bekci haber verir.
  const shared = require('mssql/lib/shared');
  const gorulen = [];
  const orijinal = shared.driver.ConnectionPool;
  shared.driver.ConnectionPool = class {
    constructor(cfg) { gorulen.push(cfg.user); this.config = cfg; }
    connect() { return Promise.resolve(this); }
    on() {} removeListener() {}
    close(cb) { if (cb) cb(); return Promise.resolve(); }
  };
  try {
    const gc = require('mssql/lib/global-connection');
    const a = await gc.connect({ user: 'YAZMA', database: 'X' });
    const b = await gc.connect({ user: 'SALT_OKUNUR', database: 'X' });
    assert.deepEqual(gorulen, ['YAZMA'], 'ikinci config kullanilmis — semantik degismis');
    assert.equal(a, b, 'iki cagri farkli havuz dondu — semantik degismis');
    assert.equal(b.config.user, 'YAZMA', 'salt-okunur istek yazma kimligiyle kosuyor');
    await b.close();
  } finally {
    shared.driver.ConnectionPool = orijinal;
  }
});

test('MV2 HICBIR sunucu modulu global havuzu (`sql.connect`) kurmaz', () => {
  const kokler = ['server'];
  const bulunan = [];
  const gez = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') gez(p); continue; }
      if (!e.name.endsWith('.cjs')) continue;
      if (/\bsql\.connect\s*\(/.test(kodOnly(oku(p)))) bulunan.push(p);
    }
  };
  kokler.forEach(gez);
  assert.deepEqual(
    bulunan, [],
    `global havuz kuran dosya(lar): ${bulunan.join(', ')} — config'leri SESSIZCE yok sayilir`,
  );
});

test('MV3 iki envanter havuzu AYRI nesne ve KENDI kimligiyle kurulur', async () => {
  const sql = require('mssql');
  const orijinal = sql.ConnectionPool;
  const kurulan = [];
  sql.ConnectionPool = class {
    constructor(cfg) { kurulan.push(cfg.user); this.config = cfg; this._dinleyici = 0; }
    connect() { return Promise.resolve(this); }
    on() { this._dinleyici++; }
  };
  const eskiEnv = { ...process.env };
  Object.assign(process.env, {
    MSSQL_SERVER: 'sunucu', MSSQL_DATABASE: 'db',
    MSSQL_USER: 'YAZMA', MSSQL_PASSWORD: 'p',
    MSSQL_RO_USER: 'SALT_OKUNUR', MSSQL_RO_PASSWORD: 'p',
  });
  // Modulleri TAZE yukle — onceki testlerden kalan `_pool` olmasin.
  for (const m of ['../mssql.cjs', '../mssql-readonly.cjs']) delete require.cache[require.resolve(m)];
  try {
    // YAZMA havuzu ONCE kurulur — uretimdeki gercek sira bu (envanter ekranlari
    // yonetici Custom SQL ekranindan cok once acilir). Hata tam burada oluyordu.
    const yazma = await require('../mssql.cjs').getPool();
    const salt = await require('../mssql-readonly.cjs').getReadOnlyPool();

    assert.ok(yazma && salt, 'havuzlar kurulamadi');
    assert.notEqual(yazma, salt, 'AYNI havuz nesnesi — ayrim yok, salt-okunur kapi olu');
    assert.equal(yazma.config.user, 'YAZMA');
    assert.equal(salt.config.user, 'SALT_OKUNUR', 'salt-okunur havuz yazma kimligiyle kurulmus');
    assert.deepEqual(kurulan, ['YAZMA', 'SALT_OKUNUR'], 'her modul kendi havuzunu kurmadi');
    // Her havuz KENDI hata dinleyicisini tasimali: ortak nesnede her modul
    // yalniz kendi `_pool`unu null'lar ve ikisi durum konusunda anlasmazliga duser.
    assert.ok(yazma._dinleyici > 0 && salt._dinleyici > 0, 'hata dinleyicisi takilmamis');
  } finally {
    sql.ConnectionPool = orijinal;
    process.env = eskiEnv;
    for (const m of ['../mssql.cjs', '../mssql-readonly.cjs']) delete require.cache[require.resolve(m)];
  }
});

test('MV4 Custom SQL ucu salt-okunur havuzu TERCIH eder, paylasilana yalniz DUSER', () => {
  const kod = kodOnly(oku('server/inventory/index.cjs'));
  const i = kod.indexOf("require('./mssql-readonly.cjs')");
  assert.ok(i > 0, 'Custom SQL ucu salt-okunur modulu hic kullanmiyor');
  const d = kod.slice(i, kod.indexOf('const req2 = pool.request();', i));
  assert.ok(d.length > 0, 'dilim bos');
  assert.match(d, /getReadOnlyPool\(\)/, 'salt-okunur havuz istenmiyor');

  // ── DILIM DAR OLMALI ──────────────────────────────────────────────────────
  // Ilk yazimda yalnizca "dilimde bir `if (!pool)` VAR MI" soruluyordu ve bekci
  // KORDU: dusus kosulu `if (true)` yapildiginda, ASAGIDAKI ikinci `if (!pool)`
  // (baglanti hic yoksa 503) esleseiyor ve bekci geciyordu. Bu, depodaki 4
  // numarali korluk desenidir — tanimlayicinin VARLIGI sorulmus, DOGRU YERDE
  // olup olmadigi degil.
  //
  // Artik TAM dusus blogu dilimlenip basi sinaniyor.
  const bas = d.indexOf("let usedPool = 'readonly';");
  const son = d.indexOf("usedPool = 'shared';");
  assert.ok(bas >= 0 && son > bas, 'dusus blogu bulunamadi — desen degismis');
  const dusus = d.slice(bas, son);
  assert.match(
    dusus.split('\n')[1] || '',
    /^\s*if\s*\(\s*!pool\s*\)\s*\{/,
    'paylasilan havuza dusus `!pool` ile korunmuyor — salt-okunur kapi olur',
  );
  assert.doesNotMatch(dusus, /if\s*\(\s*(true|1|false|0|null|undefined)\s*\)/, 'sabit kosullu dal');
});

test('MV5 salt-okunur modul yazma kimligini HIC okumaz', () => {
  const kod = kodOnly(oku('server/inventory/mssql-readonly.cjs'));
  assert.doesNotMatch(
    kod, /MSSQL_USER|MSSQL_PASSWORD(?!\s*\})/,
    'salt-okunur modul yazma kimligine basvuruyor',
  );
  assert.match(kod, /MSSQL_RO_USER/, 'salt-okunur kullanici okunmuyor');
});
