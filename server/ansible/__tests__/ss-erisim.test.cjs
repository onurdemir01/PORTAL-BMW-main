// server/ansible/__tests__/ss-erisim.test.cjs
//
// Self Service ekip bazli erisim (2026-10-26). Kullanici: "bazi playbooklari sadece bazi
// ekiplere acabilmek istiyoruz ... default olarak kullanicilara kapali gelsin ... istersek tum
// ekiplere de acalim. Tek bir ekip olmayabilir."
//   SE1  mod: eski kayit (mod yok) + acik = herkes; kapali; bilinmeyen mod kapali (fail-closed)
//   SE2  admin her kipte erisir; kapali / herkes
//   SE3  ekipler: tam DN, yalin CN, harf ve virgul-bosluk farki eslesir; uye olmayan / grupsuz red
//   SE4  kayitli tam DN, ayni CN'li BASKA OU'daki gruba acilmaz
//   SE5  bos ya da okunamayan grup listesi kimseye acmaz
//   SE6  dogrulama: gecersiz mod, ekipsiz "ekipler", tekillestirme, tavan, tip, kontrol karakteri
//   SE7  liste: admin hepsini erisim alanlariyla gorur; kullanici yalniz erisebildigini, grupsuz
//   SE8  runner: liste / survey / launch-ss sunucuda kontrol eder; erisim ucu admin; yazim atomik
//   SE9  setup: mevcut kurulumlara iki kolon ALTER ile eklenir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const e = require('../ss-erisim.cjs');

const DN_MW = 'CN=GT-Middleware,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr';
const kullanici = (groups) => ({ username: 'osmankoz', role: 'User', groups });
const ADMIN = { username: 'onurdemir', role: 'Admin', groups: [] };
const oge = (ek) => ({ id: 'x', title: 'T', awxServerId: 2, awxTemplateId: 7, enabled: true, ...ek });

test('SE1 mod: eski kayit acik = herkes; kapali; bilinmeyen = kapali', () => {
  assert.equal(e.ssErisimModu(oge({ accessMode: null })), 'herkes');
  assert.equal(e.ssErisimModu(oge({})), 'herkes');
  assert.equal(e.ssErisimModu(oge({ enabled: false, accessMode: 'herkes' })), 'kapali');
  assert.equal(e.ssErisimModu(oge({ accessMode: 'ekipler' })), 'ekipler');
  assert.equal(e.ssErisimModu(oge({ accessMode: 'kapali' })), 'kapali');
  assert.equal(e.ssErisimModu(oge({ accessMode: 'HERKES' })), 'kapali');
  assert.equal(e.ssErisimModu(null), 'kapali');
});

test('SE2 admin her kipte erisir; kapali red, herkes acik', () => {
  for (const ek of [{ enabled: false }, { accessMode: 'ekipler', accessGroups: [] }, { accessMode: 'herkes' }]) {
    assert.equal(e.ssErisimVar(oge(ek), ADMIN), true, JSON.stringify(ek));
  }
  assert.equal(e.ssErisimVar(oge({ enabled: false }), kullanici([DN_MW])), false);
  assert.equal(e.ssErisimVar(oge({ accessMode: 'herkes' }), kullanici([])), true);
  assert.equal(e.ssErisimVar(oge({ accessMode: 'herkes' }), null), true);
});

test('SE3 ekipler: DN / CN / harf / bosluk eslesir; uye olmayan ve grupsuz red', () => {
  const dnIle = oge({ accessMode: 'ekipler', accessGroups: [DN_MW] });
  const cnIle = oge({ accessMode: 'ekipler', accessGroups: ['gt-middleware'] });
  assert.equal(e.ssErisimVar(dnIle, kullanici([DN_MW])), true);
  assert.equal(e.ssErisimVar(dnIle, kullanici(['cn=gt-middleware, ou=groups, dc=fw,dc=garanti,dc=com,dc=tr'])), true);
  assert.equal(e.ssErisimVar(cnIle, kullanici([DN_MW])), true);
  const iki = oge({ accessMode: 'ekipler', accessGroups: ['GT-Network', DN_MW] });
  assert.equal(e.ssErisimVar(iki, kullanici(['CN=GT-Network,OU=Groups,DC=fw'])), true, 'ikinci ekip');
  assert.equal(e.ssErisimVar(dnIle, kullanici(['CN=GT-Network,OU=Groups,DC=fw'])), false);
  assert.equal(e.ssErisimVar(dnIle, kullanici([])), false);
  assert.equal(e.ssErisimVar(dnIle, { username: 'x', role: 'User' }), false);
  assert.equal(e.ssErisimVar(dnIle, null), false);
});

test('SE4 kayitli tam DN, ayni CN li baska OU daki gruba acilmaz', () => {
  const item = oge({ accessMode: 'ekipler', accessGroups: [DN_MW] });
  assert.equal(e.ssErisimVar(item, kullanici(['CN=GT-Middleware,OU=Eski,DC=fw,DC=garanti,DC=com,DC=tr'])), false);
});

test('SE5 bos ya da okunamayan grup listesi kimseye acmaz', () => {
  assert.equal(e.ssErisimVar(oge({ accessMode: 'ekipler', accessGroups: [] }), kullanici([DN_MW])), false);
  assert.equal(e.ssErisimVar(oge({ accessMode: 'ekipler', accessGroups: null }), kullanici([DN_MW])), false);
  assert.equal(e.ssErisimVar(oge({ accessMode: 'ekipler', accessGroups: ['  '] }), kullanici([DN_MW])), false);
  assert.equal(e.grupListesiOku('{bozuk'), null);
  assert.equal(e.grupListesiOku('{"a":1}'), null);
  assert.deepEqual(e.grupListesiOku(null), []);
  assert.deepEqual(e.grupListesiOku(JSON.stringify([DN_MW, '', 'x'])), [DN_MW, 'x']);
});

test('SE6 dogrulama', () => {
  assert.match(e.ssErisimDogrula({ mode: 'acik' }).hata, /Geçersiz erişim/);
  assert.match(e.ssErisimDogrula({}).hata, /Geçersiz erişim/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: [] }).hata, /En az bir ekip/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: ['  '] }).hata, /En az bir ekip/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: 'GT-X' }).hata, /dizi/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: [5] }).hata, /metin/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: ['a\nb'] }).hata, /kontrol/);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: ['x'.repeat(501)] }).hata, /500/);
  const cok = Array.from({ length: e.GRUP_TAVAN + 1 }, (_, i) => `G${i}`);
  assert.match(e.ssErisimDogrula({ mode: 'ekipler', groups: cok }).hata, /En fazla/);

  const d = e.ssErisimDogrula({ mode: 'ekipler', groups: [` ${DN_MW} `, DN_MW.toLowerCase(), 'GT-Network'] });
  assert.deepEqual(d, { enabled: true, accessMode: 'ekipler', accessGroups: [DN_MW, 'GT-Network'] });
  assert.deepEqual(e.ssErisimDogrula({ mode: 'kapali', groups: ['GT-Network'] }), {
    enabled: false,
    accessMode: 'kapali',
    accessGroups: ['GT-Network'],
  });
  assert.equal(e.ssErisimDogrula({ mode: 'herkes' }).enabled, true);
});

test('SE7 liste: admin hepsini gorur; kullanici yalniz erisebildigini, grup listesi olmadan', () => {
  const items = [
    oge({ id: 'a', enabled: false, accessMode: 'kapali', accessGroups: [] }),
    oge({ id: 'b', accessMode: 'ekipler', accessGroups: [DN_MW] }),
    oge({ id: 'c', accessMode: 'ekipler', accessGroups: ['GT-Network'] }),
    oge({ id: 'd', accessMode: null, accessGroups: [] }),
  ];
  assert.deepEqual(e.ssKullaniciListesi(items, ADMIN).map((i) => i.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(e.ssKullaniciListesi(items, ADMIN)[1].accessGroups, [DN_MW]);
  const gorunen = e.ssKullaniciListesi(items, kullanici([DN_MW]));
  assert.deepEqual(gorunen.map((i) => i.id), ['b', 'd']);
  for (const i of gorunen) {
    assert.equal('accessGroups' in i, false, 'grup listesi kullaniciya gitti');
    assert.equal('accessMode' in i, false);
  }
  assert.deepEqual(items[1].accessGroups, [DN_MW], 'kaynak liste degistirildi');
  assert.deepEqual(e.ssKullaniciListesi(items, kullanici([])).map((i) => i.id), ['d']);
});

const RUNNER = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
function blok(bas, uzunluk = 2500) {
  const i = RUNNER.indexOf(bas);
  assert.ok(i >= 0, `bulunamadi: ${bas}`);
  return RUNNER.slice(i, i + uzunluk);
}

test('SE8 runner: sunucu tarafi kontrol ve atomik yazim', () => {
  const liste = blok("app.get('/api/ansible/ss/items'", 300);
  assert.match(liste, /ssErisim\.ssKullaniciListesi\(readSsItems\(\), req\.session\?\.user\)/);

  const launch = blok("app.post('/api/ansible/launch-ss/:serverId/:templateId'", 2000);
  assert.match(launch, /ssErisim\.ssErisimVar\(i, req\.session\?\.user\)/);
  assert.doesNotMatch(launch, /isAdmin \|\| i\.enabled/, 'eski enabled-only kontrol geri geldi');

  const survey = blok("app.get('/api/ansible/survey/:serverId/:templateId'", 1500);
  const kontrol = survey.indexOf('ssErisim.ssErisimVar(');
  const token = survey.indexOf('getTokenForServer(');
  assert.ok(kontrol > 0 && kontrol < token, 'survey AWX e gitmeden once erisimi kontrol etmiyor');
  assert.match(survey.slice(0, kontrol), /role !== 'Admin'/, 'admin muafiyeti yok (ScaleX penceresi kirilir)');

  assert.match(
    RUNNER,
    /app\.get\('\/api\/ansible\/template-detail\/:serverId\/:templateId', requireAuth, requireAnsiblePage,/,
  );
  assert.match(RUNNER, /app\.post\('\/api\/ansible\/ss\/items\/:id\/access', requireAuth, requireAdmin,/);

  const yaz = blok('async function writeSsItems(items)', 2200);
  assert.match(yaz, /BEGIN TRAN;[\s\S]*DELETE FROM ansible_ss_items;[\s\S]*COMMIT TRAN;[\s\S]*ROLLBACK TRAN;/);
  assert.match(yaz, /access_mode, access_groups\) VALUES/);
  const satir = blok('function ssRowToItem(r)', 900);
  assert.match(satir, /accessMode: r\.access_mode/);
  assert.match(satir, /ssErisim\.grupListesiOku\(r\.access_groups\)/);
});

test('SE9 setup: iki kolon mevcut kurulumlara ALTER ile eklenir', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(s, /ALTER TABLE ansible_ss_items ADD access_mode NVARCHAR\(16\) NULL/);
  assert.match(s, /ALTER TABLE ansible_ss_items ADD access_groups NVARCHAR\(MAX\) NULL/);
});
