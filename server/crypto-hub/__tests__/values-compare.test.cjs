// server/crypto-hub/__tests__/values-compare.test.cjs — cluster values karsilastirmasi.
//
// Kullanici (2026-09-27): "Wyden aktif-pasif calisiyor, her ortam icin ayri cluster'lara
// ozgu values.yaml'lar var, bunlari Portal uzerinden karsilastirabilmek istiyoruz."
//
// VC1 anahtar bazli karsilastirma (satir bazli degil): sira degisikligi FARK DEGILDIR
// VC2 eksik anahtar "ayni" sayilmaz; okunamayan dosya karsilastirmaya GIRMEZ
// VC3 MASKE TUZAGI: iki FARKLI parola maskelendikten sonra "ayni" GORUNMEZ
// VC4 sunucu sozlesmesi: yol kapilari, salt okunurluk, maskelemeden ONCE karsilastirma
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { anahtarla, karsilastir, clusterAdi } = require('../values-compare.cjs');

const SIR = /(pass|passwd|password|pwd|secret|token|apikey|api_key|accesskey|access_key|credential|keystore|truststore|private[_-]?key)/i;
const satirlar = (s) => s.split(String.fromCharCode(10));

test('VC1: anahtar bazli karsilastirma - sira degisikligi fark degildir', () => {
  const a = { path: '/vhosting/wyden/1.8.2/cldev1/garanti_values.yaml', lines: satirlar([
    'global:',
    '  env: dev',
    '  replicas: 2',
    'image:',
    '  tag: 1.8.2',
  ].join(String.fromCharCode(10))) };
  // AYNI icerik, BASKA sira. Satir bazli bir diff burada "her sey farkli" derdi.
  const b = { path: '/vhosting/wyden/1.8.2/cldev2/garanti_values.yaml', lines: satirlar([
    'image:',
    '  tag: 1.8.2',
    'global:',
    '  replicas: 2',
    '  env: dev',
  ].join(String.fromCharCode(10))) };

  const h = anahtarla(a.lines);
  assert.equal(h.get('global.env'), 'dev', 'girinti hiyerarsisi yol olarak kurulmuyor');
  assert.equal(h.get('image.tag'), '1.8.2');

  const r = karsilastir([a, b], null);
  assert.equal(r.karsilastirilabilir, true);
  assert.equal(r.anahtarSayi, 3, 'anahtar sayisi yanlis');
  assert.deepEqual(r.satirlar, [], 'sira degisikligi FARK olarak raporlandi');
  assert.deepEqual(r.okunan.map((f) => f.cluster), ['cldev1', 'cldev2']);

  // Gercek bir fark YAKALANMALI.
  const c = { path: '/vhosting/wyden/1.8.2/cldev3/garanti_values.yaml',
    lines: satirlar('global:' + String.fromCharCode(10) + '  env: dev' + String.fromCharCode(10) + '  replicas: 4' + String.fromCharCode(10) + 'image:' + String.fromCharCode(10) + '  tag: 1.8.2') };
  const r2 = karsilastir([a, c], null);
  assert.equal(r2.farkliSayi, 1, 'gercek fark yakalanmadi');
  assert.equal(r2.satirlar[0].anahtar, 'global.replicas');
  assert.deepEqual(r2.satirlar[0].degerler, ['2', '4']);
});

test('VC2: eksik anahtar fark sayilir, okunamayan dosya karsilastirmaya girmez', () => {
  const LF = String.fromCharCode(10);
  const a = { path: '/vhosting/wyden/1.8.2/cldev1/v.yaml', lines: satirlar('a: 1' + LF + 'b: 2') };
  const b = { path: '/vhosting/wyden/1.8.2/cldev2/v.yaml', lines: satirlar('a: 1') };

  const r = karsilastir([a, b], null);
  // 'b' yalniz BIR dosyada var: bu bir FARKTIR, "ayni" degildir.
  assert.equal(r.farkliSayi, 1, 'eksik anahtar "ayni" sayildi');
  assert.equal(r.satirlar[0].anahtar, 'b');
  assert.equal(r.satirlar[0].eksikVar, true);
  assert.deepEqual(r.satirlar[0].degerler, ['2', null]);

  // OKUNAMAYAN DOSYA: karsilastirmaya girmez ve AYRICA raporlanir.
  const bozuk = { path: '/vhosting/wyden/1.8.2/cldev3/v.yaml', lines: [], error: 'dosya yok' };
  const r2 = karsilastir([a, b, bozuk], null);
  assert.equal(r2.okunan.length, 2, 'okunamayan dosya karsilastirmaya girdi');
  assert.equal(r2.okunamayan.length, 1);
  assert.equal(r2.okunamayan[0].cluster, 'cldev3');
  assert.equal(r2.okunamayan[0].error, 'dosya yok');
  assert.equal(r2.farkliSayi, 1, 'okunamayan dosya fark sayisini bozdu');

  // IKIDEN AZ okunan dosya: "uyumlu" DEMEK YANLIS olurdu.
  assert.equal(karsilastir([a, bozuk], null).karsilastirilabilir, false,
    'tek dosyayla karsilastirilabilir denildi');
  assert.equal(karsilastir([], null).karsilastirilabilir, false);

  assert.equal(clusterAdi('/vhosting/wyden/1.8.2/cldev1/v.yaml'), 'cldev1');
  assert.equal(clusterAdi('v.yaml'), 'v.yaml', 'dizinsiz yolda dosya adina dusmuyor');
});

test('VC3: MASKE TUZAGI - iki farkli parola maskelenince "ayni" gorunmemeli', () => {
  const LF = String.fromCharCode(10);
  const a = { path: '/vhosting/wyden/1.8.2/cldev1/v.yaml',
    lines: satirlar('db:' + LF + '  password: birinci' + LF + '  host: h1') };
  const b = { path: '/vhosting/wyden/1.8.2/cldev2/v.yaml',
    lines: satirlar('db:' + LF + '  password: IKINCI' + LF + '  host: h1') };

  const r = karsilastir([a, b], SIR);
  // Maskelenmis veri uzerinde karsilastirilsaydi ikisi de '****' olur, fark KAYBOLURDU.
  assert.equal(r.farkliSayi, 1, 'farkli iki parola maskeleme yuzunden "ayni" gorundu');
  const s = r.satirlar[0];
  assert.equal(s.anahtar, 'db.password');
  assert.equal(s.sirli, true, 'sir anahtari isaretlenmedi');
  // Fark RAPORLANIR ama deger GOSTERILMEZ.
  assert.deepEqual(s.degerler, ['****', '****'], 'sir degeri maskeliyken sizdi');

  // AYNI parola: fark YOK (maske yanlis alarm uretmemeli).
  const c = { path: '/vhosting/wyden/1.8.2/cldev2/v.yaml',
    lines: satirlar('db:' + LF + '  password: birinci' + LF + '  host: h1') };
  assert.equal(karsilastir([a, c], SIR).farkliSayi, 0, 'ayni parola fark olarak raporlandi');

  // reveal: sirRe yoksa gercek degerler doner.
  assert.deepEqual(karsilastir([a, b], null).satirlar[0].degerler, ['birinci', 'IKINCI']);
});

test('VC4: sunucu sozlesmesi - yol kapilari, salt okunurluk, maskeleme sirasi', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  // YORUMLARI AY: aciklama metinleri iddianin konusu degil (bu tuzak bu oturumda 4 kez vurdu).
  const kod = srv.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  const bekle = (parca, mesaj) => assert.ok(kod.includes(parca), mesaj);

  // KAPILAR: string aramasi degil, CAGIRARAK dogrulanir - yazim degisince test degil kapi
  // konusulur.
  const { normalizeOps, OPS } = require('../index.cjs');
  const tmz = (body) => normalizeOps({ action: 'values_files', ...body });
  const P = '/vhosting/wyden/1.8.2/cldev1/v.yaml';

  assert.equal(OPS.values_files.writes, false, 'okuma islemi YAZAN sayilmis');
  assert.deepEqual(tmz({ valuesPaths: [P] }).valuesPaths, [P], 'gecerli yol reddedildi');
  assert.throws(() => tmz({ valuesPaths: [] }), /seçilmedi/, 'bos liste gecti');
  assert.throws(() => tmz({ valuesPaths: new Array(9).fill(P) }), /en fazla 8/,
    'dosya sayisi sinirlanmamis');
  assert.throws(() => tmz({ valuesPaths: ['/etc/passwd'] }), /vhosting/,
    '/vhosting disindaki yol gecti');
  assert.throws(() => tmz({ valuesPaths: ['/vhosting/../etc/passwd'] }), /\.\./,
    "'..' iceren yol gecti");
  assert.throws(() => tmz({ valuesPaths: [P + String.fromCharCode(10) + '/etc/passwd'] }),
    /Geçersiz karakter/, 'satir sonu listeyi ikiye bolebiliyor');
  // Ayni yol iki kez: bastion'da iki kez okunmasin.
  assert.deepEqual(tmz({ valuesPaths: [P, P] }).valuesPaths, [P], 'tekrarli yol ayiklanmadi');
  // Ham icerik VARSAYILAN OLARAK ISTENMEZ.
  assert.equal(tmz({ valuesPaths: [P] }).reveal, false, 'reveal varsayilani acik');
  assert.equal(tmz({ valuesPaths: [P], reveal: true }).reveal, true);

  bekle('valuesPaths.join(String.fromCharCode(10))', 'yollar satir basina gonderilmiyor');
  bekle("toString('base64')", 'base64 kodlama yok');
  bekle('r' + String.fromCharCode(92) + 'n', 'satir sonu kontrolu yok');
  bekle('lines: maskValues(f.lines)', 'cluster dosyalari maskelenmiyor');
  bekle('crypto_hub_values_reveal', 'ham icerik denetime yazilmiyor');
  bekle('8 dosya', 'dosya sayisi sinirlanmamis');

  // SIRA: karsilastirma MASKELEMEDEN ONCE olmali (VC3'teki tuzak).
  const iKarsilastir = kod.indexOf('.karsilastir(parsed.files');
  const iMaske = kod.indexOf('lines: maskValues(f.lines)');
  assert.ok(iKarsilastir > 0, 'sunucu karsilastirmayi hic cagirmiyor');
  assert.ok(iKarsilastir < iMaske,
    'karsilastirma maskelemeden SONRA yapiliyor - farkli parolalar "ayni" gorunur');
});
