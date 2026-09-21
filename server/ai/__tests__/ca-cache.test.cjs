// server/ai/__tests__/ca-cache.test.cjs
//
// TLS GUVEN DEPOSU ONBELLEGI.
//
// OLCUM (uretim, 13,5 gun): `[CA] TLS guven deposu hazirlandi` 1.514 kez —
// ACILIS BASINA ~19. Dort modul bunu bagimsiz cagiriyor ve MCP her baglanti
// denemesinde yeniden cagiriyor. Her cagri ~145 kok sertifikayi ayristirip her
// biri icin `X509Certificate` kurup parmak izi hesapliyor.
//
// EN TEHLIKELI YANLIS ONBELLEK BURADA: sertifika DONUSUNDE (rotation) eski
// depoyu kullanmaya devam etmek, TLS dogrulamasinin SESSIZCE bozulmasi demek.
// Bu yuzden anahtar dosyanin KENDISINI (mtime + boyut) kapsar.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ca = require('../ca.cjs');

/** Gecerli tek bir self-signed PEM uretir (openssl olmadan, node crypto ile). */
function sahtePem() {
  // Gercek bir sertifika uretmek pahali; bunun yerine PEM AYRISTIRMASINI
  // sinamak icin gecersiz ama BICIMI dogru bir blok kullaniyoruz. `getFingerprint`
  // onu atlayacagi icin `addedCorporateCertificates` 0 kalir — bizim olctugumuz
  // sey DEPONUN YENIDEN KURULUP KURULMADIGI, sertifika sayisi degil.
  return '-----BEGIN CERTIFICATE-----\nMIIBogIBADANBgkq\n-----END CERTIFICATE-----\n';
}

function gecici() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-'));
  return { dir, dosya: path.join(dir, 'corp.pem') };
}

test('CA1 ayni yapilandirmada depo YENIDEN KURULMUYOR', () => {
  ca._resetCaCacheForTest();
  const onceki = process.env.CORP_CA_CERT_PATH;
  delete process.env.CORP_CA_CERT_PATH;
  const satirlar = [];
  const orijinal = console.log;
  console.log = (...a) => satirlar.push(a.join(' '));
  try {
    const a = ca.buildCombinedCa();
    const b = ca.buildCombinedCa();
    const c = ca.buildCombinedCa();
    assert.equal(a, b, 'onbellek isabet etmiyor — her cagri yeniden kuruyor');
    assert.equal(b, c);
    const kurulum = satirlar.filter((l) => l.includes('TLS guven deposu hazirlandi'));
    assert.equal(kurulum.length, 1, `uc cagride ${kurulum.length} log satiri — acilis gurultusu surer`);
  } finally {
    console.log = orijinal;
    if (onceki === undefined) delete process.env.CORP_CA_CERT_PATH;
    else process.env.CORP_CA_CERT_PATH = onceki;
    ca._resetCaCacheForTest();
  }
});

test('CA2 SERTIFIKA DONUSU (dosya degisimi) onbellegi GECERSIZ kilar', () => {
  // EN KRITIK TEST. Anahtar yalnizca YOL olsaydi, donmus bir sertifika surec
  // omru boyunca ESKI haliyle kullanilir ve TLS dogrulamasi SESSIZCE bozulurdu.
  ca._resetCaCacheForTest();
  const onceki = process.env.CORP_CA_CERT_PATH;
  const { dir, dosya } = gecici();
  const satirlar = [];
  const orijinal = console.log;
  const orijinalWarn = console.warn;
  console.log = (...a) => satirlar.push(a.join(' '));
  console.warn = () => {};
  try {
    fs.writeFileSync(dosya, sahtePem());
    process.env.CORP_CA_CERT_PATH = dosya;

    const a = ca.buildCombinedCa();
    const b = ca.buildCombinedCa();
    assert.equal(a, b, 'ayni dosyada onbellek isabet etmiyor');

    // ONBELLEGE ALINAN DEPO **TAM** OLMALI.
    //
    // Mutasyon turunda "kurumsal sertifikalar eklenmeden onbellege al"
    // denendi ve ETKISIZ cikti — fonksiyonun SONUNDAKI atama kismi girdiyi
    // eziyor. Ama ayni mutasyonun ERKEN RETURN'lu hali GERCEKTEN zararli ve
    // CA1/CA2 onu yakaliyor: kurumsal CA'si EKSIK bir guven deposu, ic hostlara
    // TLS dogrulamasini SESSIZCE bozar (her cagri "basarili" doner).
    //
    // Asagidaki iki assert TAMLIK SOZLESMESINI kilitler: onbellekten donen
    // nesne, taze kurulanla ayni alanlari tasimali. `corporateFileCount`
    // ayristirilan PEM blogu sayisidir.
    assert.equal(a.corporateFileCount, 1, 'kurumsal PEM blogu sayilmamis');
    assert.equal(
      b.corporateFileCount,
      1,
      'ONBELLEKTEKI depo EKSIK — kurumsal sertifikalar eklenmeden onbellege alinmis',
    );
    assert.equal(b.rootCount, a.rootCount);

    // DOSYA DEGISTI (rotation). mtime cozunurlugune takilmamak icin boyutu da
    // degistiriyoruz — anahtar ikisini birden kapsiyor.
    fs.writeFileSync(dosya, sahtePem() + sahtePem());
    const c = ca.buildCombinedCa();
    assert.notEqual(
      c,
      a,
      'SERTIFIKA DONUSU KACIRILDI — eski depo kullanilmaya devam ediyor, TLS sessizce bozulur',
    );

    const kurulum = satirlar.filter((l) => l.includes('TLS guven deposu hazirlandi'));
    assert.equal(kurulum.length, 2, `donusum sonrasi ${kurulum.length} kurulum — 2 olmali`);
  } finally {
    console.log = orijinal;
    console.warn = orijinalWarn;
    if (onceki === undefined) delete process.env.CORP_CA_CERT_PATH;
    else process.env.CORP_CA_CERT_PATH = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    ca._resetCaCacheForTest();
  }
});

test('CA3 YOL DEGISIRSE depo yeniden kuruluyor', () => {
  ca._resetCaCacheForTest();
  const onceki = process.env.CORP_CA_CERT_PATH;
  const { dir, dosya } = gecici();
  const ikinci = path.join(dir, 'corp2.pem');
  const orijinal = console.log;
  const orijinalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    fs.writeFileSync(dosya, sahtePem());
    fs.writeFileSync(ikinci, sahtePem() + sahtePem());
    process.env.CORP_CA_CERT_PATH = dosya;
    const a = ca.buildCombinedCa();
    process.env.CORP_CA_CERT_PATH = ikinci;
    const b = ca.buildCombinedCa();
    assert.notEqual(b, a, 'yol degisti ama eski depo donuyor');
  } finally {
    console.log = orijinal;
    console.warn = orijinalWarn;
    if (onceki === undefined) delete process.env.CORP_CA_CERT_PATH;
    else process.env.CORP_CA_CERT_PATH = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    ca._resetCaCacheForTest();
  }
});

test('CA4 HATA ONBELLEKLENMIYOR — bozuk yapilandirma HER cagride patlar', () => {
  // Hatayi onbelleklemek, dosya DUZELTILDIKTEN sonra bile surec omru boyunca
  // basarisiz kalmak demekti.
  ca._resetCaCacheForTest();
  const onceki = process.env.CORP_CA_CERT_PATH;
  const { dir, dosya } = gecici();
  const orijinal = console.log;
  console.log = () => {};
  try {
    process.env.CORP_CA_CERT_PATH = path.join(dir, 'yok.pem');
    assert.throws(() => ca.buildCombinedCa(), /bulunamadı/);
    assert.throws(() => ca.buildCombinedCa(), /bulunamadı/, 'ikinci cagri sessizce gecti');

    // Dosya DUZELTILINCE calismali.
    fs.writeFileSync(dosya, sahtePem());
    process.env.CORP_CA_CERT_PATH = dosya;
    assert.ok(ca.buildCombinedCa().ca.length > 0, 'duzeltilmis yapilandirma hala basarisiz');
  } finally {
    console.log = orijinal;
    if (onceki === undefined) delete process.env.CORP_CA_CERT_PATH;
    else process.env.CORP_CA_CERT_PATH = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    ca._resetCaCacheForTest();
  }
});

test('CA5 onbellek anahtari DOSYAYI kapsiyor (yalniz yol DEGIL)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ca.cjs'), 'utf8');
  const kod = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const i = kod.indexOf('function cacheKey');
  const j = kod.indexOf('function buildCombinedCa');
  assert.ok(i >= 0 && j > i, 'anahtar uretici bulunamadi');
  const govde = kod.slice(i, j);
  assert.match(govde, /statSync/, 'anahtar dosyanin durumuna BAKMIYOR');
  assert.match(govde, /mtimeMs/, 'anahtar mtime icermiyor — donusum kacirilir');
  assert.match(govde, /st\.size/, 'anahtar boyut icermiyor');
});
