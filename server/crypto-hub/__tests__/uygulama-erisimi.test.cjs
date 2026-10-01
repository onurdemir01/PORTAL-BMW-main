// server/crypto-hub/__tests__/uygulama-erisimi.test.cjs — UE1..UE7 (2026-10-01).
//
// Kullanici: "Admin merkezinde Crypto Hub'in gorunumunu komple ayir, erisime, Nginx Hub
// erisimi gibi ekle. Cunku Metaco ve Wyden tarafini farkli ekiplere gosterecegiz."
//
// EN KRITIK IDDIA: yetki SUNUCUDA zorlanir. Secim agacini suzmek YETMEZ - kullanici
// tenant anahtarini elle gonderip otekinin verisini cekebilirdi. Bu dosya her tenant'li
// ucun kapidan gectigini kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const ROUTES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'auth', 'visibility-routes.cjs'),
  'utf8',
);
const SEED = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
const ADMIN = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'admin', 'AdminPage.tsx'),
  'utf8',
);
const CFG = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'config', 'elements.ts'),
  'utf8',
);

test('UE1 TENANT ALAN HER UC uygulama kapisindan geciyor', () => {
  // Kapisiz kalan bir uc, Metaco'ya yetkili birinin Wyden verisini cekmesine izin verir.
  const uclar = [...SRC.matchAll(/const tenant = tenantOf\((?:req\.query\.tenant|req\.body\?\.tenant)\);/g)];
  assert.ok(uclar.length >= 5, `tenant'li uc sayisi beklenenden az: ${uclar.length}`);
  const kapi = (SRC.match(/if \(tenant && !\(await uygulamaKapisi/g) || []).length;
  assert.equal(kapi, uclar.length, 'kapi sayisi tenant’li uc sayisiyla tutmuyor');
  for (const m of uclar) {
    // KAPI TENANT SATIRININ HEMEN ARDINDA: araya is giren bir uc, yetkisiz kullaniciya
    // once is yaptirip sonra reddederdi.
    const sonrasi = SRC.slice(m.index, m.index + 260);
    assert.match(
      sonrasi,
      /if \(tenant && !\(await uygulamaKapisi\(req, res, tenant\)\)\) return;/,
      `tenant'li bir uc uygulama kapisindan GECMIYOR (konum ${m.index})`,
    );
  }
});

test('UE2 secim agaci da suzuluyor (gorulmeyecek uygulamaya davet yok)', () => {
  const i = SRC.indexOf("router.get('/tenants'");
  const blok = SRC.slice(i, i + 500);
  assert.match(blok, /gorunenUygulamalar\(req\)/, 'agac suzulmuyor');
  assert.match(blok, /selectionTree\(\)\.filter/, 'tum agac oldugu gibi donuyor');
});

test('UE3 kapi KAPALI TARAFA dusuyor (motor okunamazsa erisim YOK)', () => {
  const i = SRC.indexOf('async function gorunenUygulamalar');
  const blok = SRC.slice(i, i + 900);
  assert.match(blok, /catch\s*\{\s*return new Set\(\)/, 'motor hatasinda bos kume donmuyor');
  assert.match(blok, /canSee\(user, 'cryptohub:app:' \+ app\)/, 'yetki motora sorulmuyor');
});

test('UE4 uygulama ogeleri varsayilan KAPALI; SIKI DEGIL (admin muaf kalsin)', () => {
  // 2026-10-01: ogeler SIKI yapilmisti, sonuc olarak YONETICILER de uygulamalari
  // goremiyordu (kullanici: "adminlerin yetkisi gitti bu sefer"). `default_visible: 0`
  // zaten yeterli: acik kurali olmayan NORMAL kullanici goremez, yonetici gorur.
  for (const app of ['metaco', 'wyden']) {
    const i = SEED.indexOf(`element_key: 'cryptohub:app:${app}'`);
    assert.ok(i > 0, `seed yok: ${app}`);
    const blok = SEED.slice(i, i + 500);
    assert.match(blok, /parent_key: 'CryptoHub'/, `${app}: ata CryptoHub degil`);
    assert.match(blok, /default_visible: 0/, `${app}: varsayilan ACIK - ayrimin anlami kalmaz`);
    assert.ok(
      !/metadata: \{ strict: true \}/.test(blok),
      `${app}: SIKI yapilmis - yoneticiler uygulamalari goremez`,
    );
  }
});

test('UE5 /crypto-access uclari var ve E-POSTA kabul ediyor', () => {
  for (const m of ["router.get('/crypto-access'", "router.put('/crypto-access'", "router.delete('/crypto-access'"]) {
    assert.ok(ROUTES.includes(m), `uc yok: ${m}`);
  }
  const i = ROUTES.indexOf("router.put('/crypto-access'");
  const blok = ROUTES.slice(i, i + 2000);
  assert.match(
    blok,
    /\['user', 'group', 'email'\]\.includes/,
    "e-posta principal'i kabul edilmiyor - uretimdeki kurallar e-postayla giriliyor",
  );
  assert.match(blok, /CRYPTO_APP_KEYS/, 'izinli uygulama listesi yok');
});

test('UE6 SECILMEYEN uygulamaya kural YAZILMAZ', () => {
  const i = ROUTES.indexOf("router.put('/crypto-access'");
  const blok = ROUTES.slice(i, i + 2000);
  assert.match(
    blok,
    /key === 'CryptoHub' \|\| allow \? \[\{ principalType: pt, principalId: pid, allow: true \}\] : \[\]/,
    'secilmeyen uygulamaya da kural yaziliyor olabilir',
  );
});

test('UE7 Admin ekrani sekmeyi tanitiyor (gorunurluk motorundan yonetilebilsin)', () => {
  assert.match(ADMIN, /id: 'cryptoaccess'/, 'Admin sekmesi tanimli degil');
  assert.match(ADMIN, /activeTab === 'cryptoaccess' && <CryptoAccessTab \/>/, 'sekme render edilmiyor');
  assert.match(CFG, /admintab:cryptoaccess/, 'elements.ts kaydi yok - sekme Sayfa Erisimi’nden yonetilemez');
  assert.match(SEED, /element_key: 'admintab:cryptoaccess'/, 'seed kaydi yok');
});
