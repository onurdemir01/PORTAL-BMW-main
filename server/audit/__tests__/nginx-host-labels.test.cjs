// server/audit/__tests__/nginx-host-labels.test.cjs - Nginx Hub > Envanter: elle etiket (2026-11-12).
//
// Kullanici: "sunuculari istedigim gibi label'layabilir miyim? ... conf.d/ altindaki dosyalarin ismine
// bakiyorduk ama benim overwrite edebilecegim sekilde bir feature mi yapsak?"
//   NL1 dogrulama: bos / too_many / gecersiz karakter / 20+ / bilinmeyen kip reddedilir; tekrarlar tekillesir
//   NL2 degistir: otomatik liste (too_many dahil) yerine gecer; ozet service sayimlari ve too_many listesi buna uyar
//   NL3 ekle: otomatik liste korunur, etiket eklenir; otomatik liste satirda `etiket.oto`
//   NL4 etiketsiz satirlar ayni nesne (kopyalanmaz, alan eklenmez)
//   NL5 kablolama: yazma uclari yalniz Admin, onbellegi temizler; tablo kurulumda ve eski sunucu temizliginde
//   NL6 her yerde gecerli (2026-11-12): etiketHaritasi onbellekli, firlatmaz; yazinca/silince bosalir + haber
//   NL7 SPA: 'degistir' + tek etiket RP tanim servisinin (conf.d adi / grup) yerine gecer; coklu/ekle gecmez
//   NL8 kablolama: Nginx Hub sunucu listesi/drift, SPA, survey secimleri ayni haritayi okur;
//       conf.d adini playbook'a veren secim (nginx-services) etiketlenmez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const et = require('../nginx-host-labels.cjs');
const { summarizeNginxInventory } = require('../nginx-inventory-summary.cjs');

const oku = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

test('NL1 dogrulama', () => {
  assert.match(et.dogrula({ etiketler: [] }).hata, /En az bir/);
  assert.match(et.dogrula({ etiketler: 'too_many' }).hata, /geçersiz/i);
  assert.match(et.dogrula({ etiketler: 'a b<c' }).hata, /geçersiz/i);
  assert.match(et.dogrula({ etiketler: Array.from({ length: 21 }, (_, i) => `e${i}`) }).hata, /20/);
  assert.match(et.dogrula({ mod: 'sil', etiketler: 'a' }).hata, /Kip/);
  const ok = et.dogrula({ mod: 'ekle', etiketler: 'glomo, glomo mobile-api', not: '  x  ' });
  assert.deepEqual(ok, { mod: 'ekle', etiketler: ['glomo', 'mobile-api'], not: 'x' });
  assert.equal(et.dogrula({ etiketler: ['a,b'] }).etiketler.length, 2);
});

const satirlar = () => [
  { hostname: 'GBNGXP09', env: 'production', services: 'too_many', service_count: 7 },
  { hostname: 'GBNGXP01', env: 'production', services: 'eski-ad,cso', service_count: 2 },
  { hostname: 'GBNGXP02', env: 'production', services: 'glomo', service_count: 1 },
];

test('NL2 degistir otomatik listenin yerine gecer; ozet buna uyar', () => {
  const etiketler = new Map([
    ['GBNGXP09', { mod: 'degistir', etiketler: ['glomo', 'mobile'], not: null, by: 'onur', at: null }],
    ['GBNGXP01', { mod: 'degistir', etiketler: ['glomo'], not: 'eski-ad aslinda glomo', by: 'onur', at: null }],
  ]);
  const rows = et.etiketUygula(satirlar(), etiketler);
  assert.equal(rows[0].services, 'glomo,mobile');
  assert.equal(rows[0].service_count, 2);
  assert.deepEqual(rows[0].etiket.oto, ['too_many']);
  const s = summarizeNginxInventory(rows);
  const glomo = s.byService.find((x) => x.service === 'glomo');
  assert.equal(glomo.hosts, 3);
  assert.equal(s.byService.find((x) => x.service === 'eski-ad'), undefined, 'degistirilen otomatik ad sayimda kaldi');
  assert.deepEqual(s.totals.servicesUnlisted, [], 'etiketlenen too_many sunucusu hala listelenmedi sayiliyor');
});

test('NL3 ekle otomatik listeyi korur', () => {
  const rows = et.etiketUygula(satirlar(), new Map([['GBNGXP02', { mod: 'ekle', etiketler: ['mobile', 'glomo'] }]]));
  assert.equal(rows[2].services, 'glomo,mobile');
  assert.deepEqual(rows[2].etiket.oto, ['glomo']);
  assert.equal(rows[2].etiket.mod, 'ekle');
  // too_many sunucusuna ekle: liste toplanmadi bilgisi kaybolmaz
  const r9 = et.etiketUygula(satirlar(), new Map([['GBNGXP09', { mod: 'ekle', etiketler: ['glomo'] }]]))[0];
  assert.equal(r9.services, 'too_many,glomo');
  assert.equal(r9.service_count, 7);
});

test('NL4 etiketsiz satirlar degismez', () => {
  const s = satirlar();
  const rows = et.etiketUygula(s, new Map([['GBNGXP02', { mod: 'ekle', etiketler: ['x'] }]]));
  assert.equal(rows[0], s[0]);
  assert.equal('etiket' in rows[1], false);
  assert.equal(et.etiketUygula(s, new Map()), s);
});

test('NL5 kablolama', () => {
  const d = oku('server/audit/denetim.cjs');
  assert.match(d, /router\.put\('\/nginx-inventory\/labels\/:host', requireAdmin,/);
  assert.match(d, /router\.delete\('\/nginx-inventory\/labels\/:host', requireAdmin,/);
  const blok = d.slice(d.indexOf("'/nginx-inventory/labels/:host'"), d.indexOf("router.delete('/nginx-audit/exceptions/:host'"));
  assert.equal((blok.match(/responseCache\.clear\(\)/g) || []).length, 2, 'yazinca onbellek temizlenmiyor');
  // envanter ucu etiketi uygular; okunamazsa sayfa dusmez
  assert.match(d, /et\.etiketUygula\(es\.ayir\(r\.recordset/);
  assert.match(d, /\{ m: etiketler, hata: etiketHatasi \} = await et\.etiketHaritasi\(\)/);
  assert.match(oku('server/db/mssql-setup.cjs'), /CREATE TABLE nginx_host_labels \(/);
  assert.match(oku('server/nginx-console/eski-sunucu.cjs'), /\{ tablo: 'nginx_host_labels' \}/);
});

const sahteDb = (satirlar, hata) => {
  const db = { okuma: 0, yazma: [] };
  db.query = async (q, p) => {
    if (/^SELECT host, kip/.test(q)) {
      db.okuma += 1;
      if (hata) throw new Error(hata);
      return { rows: satirlar };
    }
    db.yazma.push([q, p]);
    return { rows: [] };
  };
  return db;
};

test('NL6 etiketHaritasi onbellekli, firlatmaz; yazinca bosalir ve haber verir', async () => {
  et._sifirla();
  const kotu = sahteDb([], 'baglanti yok');
  const r0 = await et.etiketHaritasi(kotu);
  assert.equal(r0.m.size, 0);
  assert.match(r0.hata, /baglanti yok/);
  const db = sahteDb([{ host: 'gbngxp01', kip: 'ekle', etiketler: 'glomo,mobile', note: null, updated_by: 'onur', updated_at: null }]);
  const r1 = await et.etiketHaritasi(db);
  assert.equal(r1.hata, null);
  assert.deepEqual(r1.m.get('GBNGXP01').etiketler, ['glomo', 'mobile']);
  await et.etiketHaritasi(db);
  assert.equal(db.okuma, 1, 'ikinci okuma onbellekten gelmeli');
  let haber = 0;
  et.degisinceHaberVer(() => {
    haber += 1;
  });
  await et.etiketYaz(db, 'GBNGXP01', { mod: 'degistir', etiketler: ['glomo'], not: null }, 'onur');
  assert.equal(haber, 1);
  await et.etiketHaritasi(db);
  assert.equal(db.okuma, 2, 'yazinca onbellek bosalmali');
  await et.etiketSil(db, 'GBNGXP01');
  assert.equal(haber, 2);
  assert.deepEqual(et.etkinListe(['a'], null), ['a']);
  assert.deepEqual(et.etkinListe(['a'], { mod: 'ekle', etiketler: ['b', 'a'] }), ['a', 'b']);
  assert.deepEqual(et.etkinListe(['a'], { mod: 'degistir', etiketler: ['b'] }), ['b']);
  assert.deepEqual(et.etkinListe(['GLOMO'], { mod: 'ekle', etiketler: ['glomo', 'x'] }), ['GLOMO', 'x'], 'ekle harf duyarsiz tekil');
  const s0 = et.surum();
  await et.etiketSil(db, 'GBNGXP01');
  assert.equal(et.surum(), s0 + 1, 'surum artmali');
  et._sifirla();
});

test('NL7 SPA RP servisi etikete uyar', () => {
  const { _servisOf: servisOf } = require('../../nginx-console/spa-rp.cjs');
  const RP = { groups: [{ id: 'diger', label: 'Diger', oldHosts: ['GBNGXP05'], newHosts: [] }] };
  const m = new Map([
    ['GBNGXP01', { mod: 'degistir', etiketler: ['glomo'] }],
    ['GBNGXP02', { mod: 'degistir', etiketler: ['glomo', 'mobile'] }],
    ['GBNGXP03', { mod: 'ekle', etiketler: ['glomo'] }],
    ['GBNGXP05', { mod: 'degistir', etiketler: ['webforms'] }],
  ]);
  assert.deepEqual(servisOf('ESKI-AD', 'gbngxp01', RP, m), { servis: 'GLOMO', servisKaynak: 'etiket', servisOto: 'ESKI-AD' });
  assert.deepEqual(servisOf('GLOMO', 'GBNGXP01', RP, m), { servis: 'GLOMO' }, 'ayni ad etiket diye isaretlenmemeli');
  assert.deepEqual(servisOf('ESKI-AD', 'GBNGXP02', RP, m), { servis: 'ESKI-AD' }, 'coklu etiket tanim adini ezmemeli');
  assert.deepEqual(servisOf('ESKI-AD', 'GBNGXP03', RP, m), { servis: 'ESKI-AD' }, 'ustune ekle tanim adini ezmemeli');
  assert.deepEqual(servisOf('', 'GBNGXP05', RP, m), { servis: 'WEBFORMS', servisKaynak: 'etiket' }, 'etiket gruptan once');
  assert.deepEqual(servisOf('', 'GBNGXP05', RP, new Map()), { servis: 'Diger', servisKaynak: 'grup' });
  assert.deepEqual(servisOf('X', 'GBNGXP01', RP), { servis: 'X' }, 'harita yoksa eski davranis');
});

test('NL8 kablolama: diger ekranlar ayni haritayi okur', () => {
  const nc = oku('server/nginx-console/index.cjs');
  const inv = nc.slice(nc.indexOf('async function inventoryHosts()'), nc.indexOf('async function resolveByKey'));
  assert.match(inv, /et\.etiketHaritasi\(\)/, 'Nginx Hub sunucu listesi/drift etiketi okumuyor');
  assert.match(inv, /et\.etkinListe\(h\.services, e\)/);
  assert.match(nc, /etiketler: \(await require\('\.\.\/audit\/nginx-host-labels\.cjs'\)\.etiketHaritasi\(\)\)\.m/, 'SPA etiketi okumuyor');
  assert.match(nc, /degisinceHaberVer\(\(\) => \{\s*spaCache\.clear\(\);\s*_spaMemo = null;/, 'SPA onbellegi etiket degisince bosalmiyor');
  const rp = oku('server/nginx-console/spa-rp.cjs');
  assert.match(rp, /servisOf\(r\.service, host, RP, cfgEtiket\(r\) \|\| ''\)/);
  assert.match(rp, /servisOf\('', host, RP, dirEtiket\(r\) \|\| ''\)/);
  const cs = oku('server/ansible/choice-sources.cjs');
  const hosts = cs.slice(cs.indexOf("'nginx-hosts': {"), cs.indexOf("'nginx-services': {"));
  assert.match(hosts, /et\.etiketHaritasi\(\)/);
  assert.match(hosts, /value: host,/, 'secilen deger host adi kalmali');
  const svc = cs.slice(cs.indexOf("'nginx-services': {"), cs.indexOf("'nginx-locations': {"));
  assert.doesNotMatch(svc, /etiket/, 'playbook a giden conf.d servis adi etiketle degismemeli');
});

test('NL9 API Envanteri etikete uyar; Denetim SPA tanim basina etiketi kullanir, trafik anahtari ham kalir', () => {
  const { summarize } = require('../nginx-api-summary.cjs');
  const rec = [
    { host: 'GBNGXP01', config_file: 'a.conf', locations: 1, no_limit: 0 },
    { host: 'GBNGXP02', config_file: 'a.conf', locations: 1, no_limit: 0 },
  ];
  const srv = [
    { host: 'GBNGXP01', conf_file: '/x/eski-ad-PROD.conf' },
    { host: 'GBNGXP02', conf_file: '/x/glomo-PROD.conf' },
  ];
  const m = new Map([['GBNGXP01', { mod: 'degistir', etiketler: ['glomo'] }]]);
  const s = summarize(rec, srv, m);
  const h1 = s.byHost.find((x) => x.host === 'GBNGXP01');
  assert.deepEqual(h1.services, ['glomo']);
  assert.deepEqual(h1.etiket.oto, ['eski-ad']);
  assert.equal('etiket' in s.byHost.find((x) => x.host === 'GBNGXP02'), false);
  assert.deepEqual(summarize(rec, srv).byHost.find((x) => x.host === 'GBNGXP01').services, ['eski-ad'], 'harita yoksa eski davranis');
  assert.equal(et.tekEtiket(m, ' gbngxp01 '), 'GLOMO');
  assert.equal(et.tekEtiket(new Map([['H', { mod: 'ekle', etiketler: ['x'] }]]), 'H'), null);
  assert.equal(et.tekEtiket(new Map([['H', { mod: 'degistir', etiketler: ['x', 'y'] }]]), 'H'), null);
  // kablolama: dolu servis adi degismez, trafik anahtari ham r.service ile kalir
  const d = oku('server/audit/denetim.cjs');
  assert.match(d, /const servisAdi = \(r\) => tanimEt\(r\) \|\| r\.service \|\| '\(bilinmiyor\)';/);
  assert.equal((d.match(/spaTrafikAnahtari\(r\.service, r\.env, r\.location_path\)/g) || []).length, 2);
  assert.match(d, /addSvc\(e, app\.toLowerCase\(\), r\.service, covTanim\(r\)\)/);
  assert.match(d, /addSvc\('PROD', String\(res\.application\)\.toLowerCase\(\), r\.service, covTanim\(r\)\)/);
  assert.equal(Buffer.from(d).includes(0), false, 'denetim.cjs ham NUL bayti tasimamali');
  assert.match(d, /summarize\(es\.ayir\(aggRes\.recordset \|\| \[\]\), es\.ayir\(srvRes\.recordset \|\| \[\]\), etk\.m\)/);
  assert.match(d, /degisinceHaberVer\(\(\) => responseCache\.clear\(\), 'denetim-yanit'\)/);
  // nginx-migration / nginx_ops / tasima: conf.d adi otomasyon sozlesmesi, etiket girmez
  for (const f of ['server/audit/nginx-migration.cjs', 'server/nginx-migration/index.cjs', 'server/selfservice/nginx-tanim-okuma.cjs']) {
    assert.doesNotMatch(oku(f), /nginx-host-labels/, `${f} etiket okumamali (otomasyon sozlesmesi)`);
  }
});

test('NL10 tanim basina etiket: aynalar anlasmazsa conf.d adi kalir', () => {
  const m = new Map([
    ['GBRVP01', { mod: 'degistir', etiketler: ['glomo'] }],
    ['GBRVP02', { mod: 'degistir', etiketler: ['glomo'] }],
    ['GBRVP03', { mod: 'degistir', etiketler: ['glomo'] }],
  ]);
  const rows = [
    { host: 'GBRVP01', service: 'X', location_path: '/a/' },
    { host: 'GBRVP02', service: 'X', location_path: '/a/' },
    { host: 'GBRVP04', service: 'X', location_path: '/a/' },
    { host: 'GBRVP01', service: 'Y', location_path: '/b/' },
    { host: 'GBRVP03', service: 'Y', location_path: '/b/' },
  ];
  const f = et.tanimEtiketi(rows, m, (r) => r.service + '|' + r.location_path);
  assert.equal(f(rows[0]), null, 'karisik aynada etiket gecmemeli');
  assert.equal(f(rows[2]), null);
  assert.equal(f(rows[3]), 'GLOMO');
  assert.equal(f(rows[4]), 'GLOMO');
  assert.equal(et.tanimEtiketi(rows, new Map(), (r) => r.service)(rows[0]), null);
  const { _servisOf: servisOf } = require('../../nginx-console/spa-rp.cjs');
  assert.deepEqual(servisOf('X', 'GBRVP01', { groups: [] }, ''), { servis: 'X' }, 'cozulmus bos etiket ham adi korur');
  assert.deepEqual(servisOf('X', 'GBRVP01', { groups: [] }, 'glomo'), { servis: 'GLOMO', servisKaynak: 'etiket', servisOto: 'X' });
});

test('NL11 yarisma: okuma surerken yazma olursa eski harita onbellege girmez; SPA ayrinti ucu null ozete dusmez', async () => {
  et._sifirla();
  let birak;
  const db = {
    query: async (q) => {
      if (/^SELECT host, kip/.test(q)) {
        await new Promise((r) => (birak = r));
        return { rows: [{ host: 'H1', kip: 'degistir', etiketler: 'eski', note: null, updated_by: null, updated_at: null }] };
      }
      return { rows: [] };
    },
  };
  const okuma = et.etiketHaritasi(db);
  await new Promise((r) => setImmediate(r));
  await et.etiketYaz({ query: async () => ({ rows: [] }) }, 'H1', { mod: 'degistir', etiketler: ['yeni'], not: null }, 'x');
  birak();
  assert.deepEqual((await okuma).m.get('H1').etiketler, ['eski']);
  let n = 0;
  const db2 = { query: async () => { n += 1; return { rows: [] }; } };
  await et.etiketHaritasi(db2);
  assert.equal(n, 1, 'eski harita onbellege yazilmis (yeniden okunmadi)');
  et._sifirla();
  const nc = oku('server/nginx-console/index.cjs');
  assert.match(nc, /memo = _spaMemo \|\| spaMemoYaz\(sonuc\);/);
  assert.match(nc, /_spaMemo = null;\s*\/\/[^\n]*\n\s*_spaHesap = null;/);
});
