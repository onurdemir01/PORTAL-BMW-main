// server/admin/__tests__/kurum-ayari-duzenle.test.js - KA1..KA28 (2026-11-27).
//
// Admin > Kurum Ayari (server/admin/kurum-ayari-duzenle.cjs). Gecici dizinde GERCEK dosya ile:
//   KA1  env tanimsiz: GET salt okunur durum, PUT 503 env-yok
//   KA2  GET: sha / boyut / mtime / bolumler; yanit dosyanin dizinini TASIMAZ (yalniz ad)
//   KA3  PUT: atomik yazma sonrasi okuyucu (kurumAyari) yeni veriyi gorur; eski hal yedekte;
//        gecici dosya kalmaz; denetimde anahtar yollari var, degerler yok; dosya modu korunur
//   KA4  oncekiSha diskteki degilse 409 cakisma; dosya ve yedek dizini dokunulmaz
//   KA5  ust duzey bolum silmek 428 ister; bolumSilmeOnayi ile gecer
//   KA6  gecersiz JSON / JSON nesnesi olmayan icerik 400; hata metni icerikten alinti yapmaz
//   KA7  boyut siniri 413
//   KA8  bilinen sunucu adi alaninda YENI ihlal 400 (yol var, deger yok); onceden olan ihlal kilitlemez
//   KA9  yedek budama: en cok MAKS_YEDEK; liste en yeni once; yedek okuma
//   KA10 yol gecisi: kaliba uymayan yedek adi 400 / 404; dizin disina cikilmaz
//   KA11 admin degil 403 (her uc)
//   KA12 yazma izni yok: 500 yazma-izni, metin dosya VE dizin iznini soyler; dosya degismez; denetim fail
//   KA13 geri yukleme ayni kayit yolundan: action kurum_ayari_restore; gecersiz ad 400
//   KA14 yazma siniri 429
//   KA15 ayni icerik: degisiklikYok, yedek alinmaz
//   KA16 SUNUCU_ALANLARI kodun sunucu adi olarak okudugu her anahtari kapsar (bekci): sunucu*()
//        cagrilari VE SUNUCU kuraliyla suzen bolum(...) okuyuculari; kendi SUNUCU regex'i yasak
//   KA17 derinlik siniri 400; yazmadan SONRA dusen hata 424 yazma-hatasi + denetim fail (yollarla)
//   KA18 geri yukleme etiketi icerige bagli: baska icerik 400 yedek-uyusmuyor, olmayan yedek 404
//   KA19 salt okunur dosya: rename dizin iznine ragmen yazilmaz (yazma-izni), yedek kalmaz
//   KA20 yedek dizini dosya ise 424 yedek-dizini; POSIX'te gevsek izin 0700'e daraltilir
//   KA21 budama az once alinan yedegi silmez (ileri tarihli yedekler); ayni ms eki sayisal siralanir
//   KA22 okuyucu onbellegi: ayni boyut + ayni zaman damgasi + ayni inode'da da yeni veri gorulur
//   KA23 repo calisma agacindaki dosya yazilmaz (409 repo-ici); GET repoIci bildirir
//   KA24 denetimde kirpilan yol kategorisi (+N) ile
//   KA25 bolum bosaltma / null / sunucu alani silme 428; onay yalniz true
//   KA26 POSIX: 0666 dosyada umask'a ragmen mod korunur
//   KA27 disk dolu (ENOSPC) adlandirilir, denetime fail, yetim yedek kalmaz
//   KA28 yazma siniri kullanici basina
'use strict';

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const denetim = [];
sahte(require.resolve('../../auth/index.cjs'), {
  requireAdmin: (req, res, next) =>
    req.session?.user?.role === 'Admin' ? next() : res.status(403).json({ ok: false }),
});
sahte(require.resolve('../../audit/index.cjs'), {
  auditPortal: (_req, action, opts) => denetim.push({ action, ...opts }),
});

const D = require('../kurum-ayari-duzenle.cjs');
const { kurumAyari } = require('../../util/kurum-ayari.cjs');
const { SUNUCU_ALANLARI } = require('../../../shared/kurumAyari.cjs');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ORNEK = {
  surum: 1,
  nginx: { intranetSunuculari: ['ORNGXD50', 'ORNGXT50'], exposeHedefi: 'ORNGXT07' },
  ocp: { platformKumeleri: { ark: ['orocptest1'] } },
  smart: { domain: 'KURUM' },
};
const metin = (v) => JSON.stringify(v, null, 2) + '\n';

let dizin;
let dosya;
const eskiEnv = process.env.KURUM_AYAR_DOSYASI;

beforeEach(() => {
  dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'kurum-ayari-'));
  dosya = path.join(dizin, 'kurum-ayari.json');
  fs.writeFileSync(dosya, metin(ORNEK));
  process.env.KURUM_AYAR_DOSYASI = dosya;
  denetim.length = 0;
  D._yazmaSiniriSifirla();
});

afterEach(() => {
  mock.restoreAll();
  fs.rmSync(dizin, { recursive: true, force: true });
  if (eskiEnv === undefined) delete process.env.KURUM_AYAR_DOSYASI;
  else process.env.KURUM_AYAR_DOSYASI = eskiEnv;
});

async function istek(method, yol, govde, rol = 'Admin', username = 'admin1') {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _r, n) => {
    req.session = { user: { username, role: rol } };
    n();
  });
  app.use('/api/admin/kurum-ayari', D.kurumAyariRouter());
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/admin/kurum-ayari${yol}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

const kaydet = (icerik, ek = {}) =>
  istek('PUT', '', { icerik, oncekiSha: sha(fs.readFileSync(dosya)), ...ek });
const yedekDizini = () => path.join(dizin, 'kurum-ayari.json.yedek');
const yedekler = () => (fs.existsSync(yedekDizini()) ? fs.readdirSync(yedekDizini()) : []);
const yedekJsonlari = () => yedekler().filter((a) => a.endsWith('.json'));

test('KA1 env tanimsiz: GET salt okunur durum, PUT 503 env-yok', async () => {
  delete process.env.KURUM_AYAR_DOSYASI;
  const g = await istek('GET', '');
  assert.equal(g.status, 200);
  assert.equal(g.body.envTanimli, false);
  assert.equal(g.body.okunabilir, false);
  assert.equal(g.body.envAdi, 'KURUM_AYAR_DOSYASI');
  assert.match(g.body.hata, /tanımlı değil/);
  const p = await istek('PUT', '', { icerik: '{}', oncekiSha: 'a'.repeat(64) });
  // GET disi 5xx: kurumsal nginx govdeyi HTML ile degistirmesin diye 424 + asil kod.
  assert.equal(p.status, 424);
  assert.equal(p.body.upstreamStatus, 503);
  assert.equal(p.body.nginxRed, true);
  assert.equal(p.body.code, 'env-yok');
  const y = await istek('GET', '/yedekler');
  assert.deepEqual(y.body.yedekler, []);
});

test('KA2 GET: sha, boyut, bolumler; yanit dizini tasimaz', async () => {
  const g = await istek('GET', '');
  assert.equal(g.status, 200);
  assert.equal(g.body.gecerli, true);
  assert.equal(g.body.sha, sha(fs.readFileSync(dosya)));
  assert.equal(g.body.boyut, fs.statSync(dosya).size);
  assert.equal(g.body.dosyaAdi, 'kurum-ayari.json');
  assert.deepEqual(g.body.bolumler, ['surum', 'nginx', 'ocp', 'smart']);
  assert.ok(!JSON.stringify(g.body).includes(path.basename(dizin)), 'dizin adi yanita sizdi');
  assert.equal(g.body.dosyaYazilabilir, true);
  assert.equal(g.body.dizinYazilabilir, true);
  assert.equal(g.body.repoIci, false);

  fs.writeFileSync(dosya, '{\n  "a": 1,\n  "b": \n}');
  const bozuk = await istek('GET', '');
  assert.equal(bozuk.body.gecerli, false);
  assert.match(bozuk.body.hata, /^geçerli bir JSON değil( \(satır 4, sütun 1\))?$/);
  assert.deepEqual(bozuk.body.bolumler, []);

  fs.rmSync(dosya);
  const yok = await istek('GET', '');
  assert.equal(yok.body.okunabilir, false);
  assert.equal(yok.body.hata, 'dosya bulunamadı (ENOENT)');
});

test('KA3 PUT: atomik yazma sonrasi okuyucu yeniyi gorur, eski hal yedekte, denetimde yollar', async () => {
  const eski = fs.readFileSync(dosya, 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(dosya, 0o640);
  const yeni = structuredClone(ORNEK);
  yeni.nginx.intranetSunuculari.push('ORNGXP50');
  yeni.smart.domain = 'GIZLI-DEGER';
  yeni.opsx = { dbIslemSunucusu: 'ORLABT02' };
  const r = await kaydet(metin(yeni));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sha, sha(metin(yeni)));
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(yeni));
  assert.deepEqual(kurumAyari().veri.opsx, { dbIslemSunucusu: 'ORLABT02' });
  assert.equal(kurumAyari().hata, null);

  const y = yedekler();
  assert.equal(y.length, 1);
  assert.equal(y[0], r.body.yedek);
  assert.equal(fs.readFileSync(path.join(yedekDizini(), y[0]), 'utf8'), eski);
  assert.deepEqual(
    fs.readdirSync(dizin).filter((a) => a.endsWith('.tmp')),
    [],
    'gecici dosya kaldi',
  );
  if (process.platform !== 'win32') assert.equal(fs.statSync(dosya).mode & 0o777, 0o640);

  assert.deepEqual(r.body.yollar, {
    eklenen: ['opsx'],
    silinen: [],
    degisen: ['nginx.intranetSunuculari', 'smart.domain'],
  });
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].action, 'kurum_ayari_update');
  assert.match(denetim[0].detail, /degisen=nginx\.intranetSunuculari,smart\.domain/);
  assert.match(denetim[0].detail, /^dosya=kurum-ayari\.json /);
  assert.ok(!denetim[0].detail.includes('GIZLI-DEGER'), 'deger denetime yazildi');
  assert.ok(!denetim[0].detail.includes('ORNGXP50'), 'deger denetime yazildi');
});

test('KA4 oncekiSha uyusmazsa 409; dosya ve yedek dizini dokunulmaz', async () => {
  const once = fs.readFileSync(dosya, 'utf8');
  const r = await istek('PUT', '', { icerik: '{"a":1}', oncekiSha: sha('baska') });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'cakisma');
  assert.equal(r.body.sha, sha(once));
  assert.equal(fs.readFileSync(dosya, 'utf8'), once);
  assert.equal(fs.existsSync(yedekDizini()), false);
  const eksik = await istek('PUT', '', { icerik: '{"a":1}' });
  assert.equal(eksik.status, 400);
  assert.equal(eksik.body.code, 'onceki-sha');
});

test('KA5 ust duzey bolum silmek 428 ister; onayla gecer', async () => {
  const { ocp, smart, ...kalan } = ORNEK;
  assert.ok(ocp && smart);
  const r = await kaydet(metin(kalan));
  assert.equal(r.status, 428);
  assert.equal(r.body.code, 'bolum-silme-onayi');
  assert.deepEqual(r.body.silinenBolumler, ['ocp', 'smart']);
  assert.equal(yedekler().length, 0);
  const onayli = await kaydet(metin(kalan), { bolumSilmeOnayi: true });
  assert.equal(onayli.status, 200);
  assert.deepEqual(onayli.body.yollar.silinen, ['ocp', 'smart']);
  // Sunucu alani olmayan alt anahtar silmek onay istemez.
  const alt = structuredClone(kalan);
  alt.nginx.not = 'x';
  assert.equal((await kaydet(metin(alt))).status, 200);
  delete alt.nginx.not;
  assert.equal((await kaydet(metin(alt))).status, 200);
});

test('KA6 gecersiz JSON ve nesne olmayan icerik 400; metin icerikten alinti yapmaz', async () => {
  const r = await kaydet('{"gizliSunucu": "ORNGXZ99",\n  oops}');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'json');
  assert.ok(!r.body.error.includes('ORNGXZ99'), 'hata metni icerik alintiladi');
  assert.ok(!r.body.error.includes('oops'), 'hata metni icerik alintiladi');
  for (const icerik of ['[1,2]', '"metin"', 'null', '42']) {
    const n = await kaydet(icerik);
    assert.equal(n.status, 400, icerik);
    assert.match(n.body.error, /JSON nesnesi/);
  }
  const tur = await istek('PUT', '', { icerik: { a: 1 }, oncekiSha: sha('x') });
  assert.equal(tur.status, 400);
  assert.equal(tur.body.code, 'icerik');
  assert.equal(yedekler().length, 0);
});

test('KA7 boyut siniri 413', async () => {
  const buyuk = JSON.stringify({ a: 'x'.repeat(D.MAKS_BAYT) });
  const r = await kaydet(buyuk);
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'boyut');
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
});

test('KA8 sunucu adi: yeni ihlal 400 (deger yok); onceden olan ihlal kilitlemez', async () => {
  const yeni = structuredClone(ORNEK);
  yeni.nginx.intranetSunuculari.push('9KOTU AD');
  yeni.nginx.exposeHedefi = '';
  yeni.nginx.gocGruplari = { glomo: { eski: 'ORRVPP07', yeni: ['ORNGXP40'] } };
  const r = await kaydet(metin(yeni));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'sunucu-adi');
  assert.deepEqual(r.body.ihlaller, [
    { yol: 'nginx.intranetSunuculari[2]', neden: 'gecersiz-ad' },
    { yol: 'nginx.gocGruplari.glomo.eski', neden: 'liste-degil' },
    { yol: 'nginx.exposeHedefi', neden: 'gecersiz-ad' },
  ]);
  assert.ok(!JSON.stringify(r.body).includes('KOTU'), 'deger yanita yazildi');

  // Dosyada ZATEN bozuk bir girdi var: ilgisiz bir bolumu kaydetmek engellenmez.
  const bozuk = structuredClone(ORNEK);
  bozuk.nginx.intranetSunuculari.push('9KOTU');
  fs.writeFileSync(dosya, metin(bozuk));
  const ilgisiz = structuredClone(bozuk);
  ilgisiz.smart.domain = 'BASKA';
  assert.equal((await kaydet(metin(ilgisiz))).status, 200);
  // Sirasi degisse de ayni bozuk deger yeni sayilmaz.
  ilgisiz.nginx.intranetSunuculari.unshift('ORNGXQ50');
  assert.equal((await kaydet(metin(ilgisiz))).status, 200);
});

test('KA9 yedek budama en cok MAKS_YEDEK; liste en yeni once; yedek okunur', async () => {
  fs.mkdirSync(yedekDizini());
  for (let i = 0; i < D.MAKS_YEDEK + 3; i++) {
    const ad = `202001${String(i + 1).padStart(2, '0')}T000000000Z.json`;
    fs.writeFileSync(path.join(yedekDizini(), ad), `{"i":${i}}`);
  }
  fs.writeFileSync(path.join(yedekDizini(), 'elle-birakilan.txt'), 'dokunma');
  const r = await kaydet(metin({ ...ORNEK, surum: 2 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.budanan, 4);
  const kalan = yedekler().filter((a) => a.endsWith('.json'));
  assert.equal(kalan.length, D.MAKS_YEDEK);
  assert.ok(kalan.includes(r.body.yedek), 'yeni yedek budandi');
  assert.ok(!kalan.includes('20200101T000000000Z.json'), 'en eski yedek kaldi');
  assert.ok(yedekler().includes('elle-birakilan.txt'), 'kaliba uymayan dosya silindi');

  const l = await istek('GET', '/yedekler');
  assert.equal(l.status, 200);
  assert.equal(l.body.yedekler.length, D.MAKS_YEDEK);
  assert.equal(l.body.yedekler[0].ad, r.body.yedek);
  assert.match(l.body.yedekler[0].shaKisa, /^[a-f0-9]{12}$/);
  assert.equal(l.body.yedekler[1].zaman, '2020-01-33T00:00:00.000Z');

  const y = await istek('GET', `/yedekler/${r.body.yedek}`);
  assert.equal(y.status, 200);
  assert.equal(y.body.icerik, metin(ORNEK));
  assert.equal(y.body.sha, sha(metin(ORNEK)));
});

test('KA10 yol gecisi: kaliba uymayan yedek adi reddedilir', async () => {
  fs.writeFileSync(path.join(dizin, 'disarida.json'), '{"sir":1}');
  for (const ad of [
    '..%2Fdisarida.json',
    '..%2F..%2Fkurum-ayari.json',
    'disarida.json',
    '20261127T101112345Z.json%00',
    '20261127T101112345Z.json%2F..%2F..%2Fdisarida.json',
  ]) {
    const r = await istek('GET', `/yedekler/${ad}`);
    assert.ok([400, 404].includes(r.status), `${ad} -> ${r.status}`);
    assert.ok(!JSON.stringify(r.body).includes('sir'), `${ad} dizin disini okudu`);
  }
  const yok = await istek('GET', '/yedekler/20261127T101112345Z.json');
  assert.equal(yok.status, 404);
  assert.equal(yok.body.code, 'yedek-yok');
});

test('KA11 admin degil 403', async () => {
  for (const [m, y, g] of [
    ['GET', ''],
    ['GET', '/yedekler'],
    ['GET', '/yedekler/20261127T101112345Z.json'],
    ['PUT', '', { icerik: '{}', oncekiSha: sha(fs.readFileSync(dosya)) }],
  ]) {
    const r = await istek(m, y, g, 'User');
    assert.equal(r.status, 403, `${m} ${y}`);
  }
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
});

test('KA12 yazma izni yok: 424 (asil 500) yazma-izni, dosya ve dizin izni, dosya degismez', async () => {
  const gercek = fs.openSync;
  mock.method(fs, 'openSync', (p, ...r) => {
    if (String(p).startsWith(dizin) && r[0] === 'wx')
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return gercek(p, ...r);
  });
  const r = await kaydet(metin({ ...ORNEK, surum: 3 }));
  assert.equal(r.status, 424);
  assert.equal(r.body.upstreamStatus, 500);
  assert.equal(r.body.nginxRed, true);
  assert.equal(r.body.code, 'yazma-izni');
  assert.match(r.body.error, /EACCES/);
  assert.match(r.body.message, /dosyaya VE\s+bulunduğu dizine yazma izni/);
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].action, 'kurum_ayari_update');
  assert.equal(denetim[0].result, 'fail');
  assert.match(denetim[0].detail, /^code=yazma-izni dosya=kurum-ayari\.json .* degisen=surum$/);
  assert.deepEqual(yedekJsonlari(), [], 'yarim yedek kaldi');
});

test('KA12b atomik yazma rename asamasinda duserse ozgun dosya ve gecici dosya temiz', async () => {
  mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('read-only'), { code: 'EROFS' });
  });
  const r = await kaydet(metin({ ...ORNEK, surum: 4 }));
  assert.equal(r.status, 424);
  assert.equal(r.body.code, 'yazma-izni');
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  assert.deepEqual(
    fs.readdirSync(dizin).filter((a) => a.endsWith('.tmp')),
    [],
  );
  // Yazma dustu: alinan yedek ayni icerigin kopyasiydi, silindi (kotayi yemez).
  assert.deepEqual(yedekJsonlari(), []);
});

test('KA13 geri yukleme ayni kayit yolundan gecer', async () => {
  const ilk = await kaydet(metin({ ...ORNEK, surum: 5 }));
  assert.equal(ilk.status, 200);
  const y = await istek('GET', `/yedekler/${ilk.body.yedek}`);
  const geri = await kaydet(y.body.icerik, { geriYuklenenYedek: ilk.body.yedek });
  assert.equal(geri.status, 200);
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  assert.equal(yedekler().length, 2, 'geri yukleme de yedek almali');
  assert.equal(denetim.at(-1).action, 'kurum_ayari_restore');
  assert.match(denetim.at(-1).detail, new RegExp(`geriYuklenen=${ilk.body.yedek}`));
  const kotu = await kaydet('{}', { geriYuklenenYedek: '../x.json' });
  assert.equal(kotu.status, 400);
  assert.equal(kotu.body.code, 'yedek-adi');
});

test('KA14 yazma siniri 429', async () => {
  let son;
  for (let i = 0; i < 11; i++) son = await kaydet(metin({ ...ORNEK, surum: 100 + i }));
  assert.equal(son.status, 429);
});

test('KA15 ayni icerik: degisiklikYok, yedek alinmaz', async () => {
  const r = await kaydet(metin(ORNEK));
  assert.equal(r.status, 200);
  assert.equal(r.body.degisiklikYok, true);
  assert.equal(yedekler().length, 0);
  assert.equal(denetim.length, 0);
});

test('KA16 SUNUCU_ALANLARI kodun sunucu adi olarak okudugu her anahtari kapsar', () => {
  const SERVER = path.join(__dirname, '..', '..');
  const anahtarlar = new Set();
  const suzenBolumler = new Set();
  const kendiKurali = [];
  (function gez(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith('.cjs')) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/sunucu(?:Listesi|Haritasi|Adi)\(\s*(['`])([^'`]+)\1/g))
          anahtarlar.add(m[2].replaceAll(/\$\{[^}]+\}/g, '*'));
        if (/\bSUNUCU\.test\(/.test(s))
          for (const m of s.matchAll(/\bbolum\(\s*'([^']+)'/g)) suzenBolumler.add(m[1]);
        if (/\bconst SUNUCU\s*=\s*\//.test(s)) kendiKurali.push(path.relative(SERVER, p));
      }
    }
  })(SERVER);
  // Toplayici bosalmasin: desen bozulursa bekci vakumla gecer.
  assert.ok(anahtarlar.size >= 10, `yalniz ${anahtarlar.size} anahtar bulundu`);
  const bilinen = new Set(SUNUCU_ALANLARI.map((a) => a.yol));
  assert.deepEqual(
    [...anahtarlar].filter((k) => !bilinen.has(k)).sort(),
    [],
    'Bu anahtarlar sunucu adi olarak okunuyor ama kayit denetiminde yok (shared/kurumAyari.cjs)',
  );
  // bolum('x') ile okuyup SUNUCU kuraliyla suzen modul (rvp-ayari.cjs): x altinda bir alan listede olmali.
  assert.ok(suzenBolumler.size >= 1, 'SUNUCU ile suzen bolum okuyucusu bulunamadi (desen bozuldu)');
  assert.deepEqual(
    [...suzenBolumler]
      .filter((b) => ![...bilinen].some((y) => y === b || y.startsWith(`${b}.`)))
      .sort(),
    [],
    'Bu bolumler SUNUCU kuraliyla suzuluyor ama kayit denetiminde alanlari yok',
  );
  // Sunucu adi kurali tek yerde: modul kendi SUNUCU regex'ini tanimlarsa kayit denetimiyle ayrisir.
  assert.deepEqual(kendiKurali.sort(), [], 'SUNUCU regex shared/kurumAyari.cjs disinda tanimli');
});

test('KA17 derinlik siniri 400; yazmadan sonra dusen hata 424 + denetim fail (yollarla)', async () => {
  let derin = '1';
  for (let i = 0; i < 100; i++) derin = `{"a":${derin}}`;
  const d = await kaydet(`{"x":${derin}}`);
  assert.equal(d.status, 400);
  assert.equal(d.body.code, 'derinlik');
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  assert.equal(denetim.length, 0);

  // rename basarili, sonra beklenmeyen hata: degisiklik diskte, denetim yine duser.
  const gercekRename = fs.renameSync;
  const gercekOku = fs.readFileSync;
  let yazildi = false;
  mock.method(fs, 'renameSync', (...a) => {
    gercekRename(...a);
    yazildi = true;
  });
  mock.method(fs, 'readFileSync', (p, ...r) => {
    if (yazildi && !r.length && path.resolve(String(p)) === dosya)
      throw Object.assign(new Error('io'), { code: 'EIO' });
    return gercekOku(p, ...r);
  });
  const yeni = { ...ORNEK, surum: 9 };
  const r = await kaydet(metin(yeni));
  mock.restoreAll();
  assert.equal(r.status, 424);
  assert.equal(r.body.code, 'yazma-hatasi');
  assert.match(r.body.error, /EIO/);
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(yeni));
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].result, 'fail');
  assert.match(denetim[0].detail, /^code=yazma-hatasi .* degisen=surum$/);
});

test('KA18 geri yukleme etiketi icerige bagli', async () => {
  const ilk = await kaydet(metin({ ...ORNEK, surum: 5 }));
  assert.equal(ilk.status, 200);
  const sahte = await kaydet(metin({ ...ORNEK, surum: 77 }), { geriYuklenenYedek: ilk.body.yedek });
  assert.equal(sahte.status, 400);
  assert.equal(sahte.body.code, 'yedek-uyusmuyor');
  const yok = await kaydet(metin(ORNEK), { geriYuklenenYedek: '20200101T000000000Z.json' });
  assert.equal(yok.status, 404);
  assert.equal(yok.body.code, 'yedek-yok');
  assert.equal(denetim.filter((x) => x.action === 'kurum_ayari_restore').length, 0);
});

test('KA19 salt okunur dosya yazilmaz; yedek kalmaz', async () => {
  const gercek = fs.accessSync;
  mock.method(fs, 'accessSync', (p, mod) => {
    if (path.resolve(String(p)) === dosya && mod === fs.constants.W_OK)
      throw Object.assign(new Error('ro'), { code: 'EACCES' });
    return gercek(p, mod);
  });
  const g = await istek('GET', '');
  assert.equal(g.body.dosyaYazilabilir, false);
  const r = await kaydet(metin({ ...ORNEK, surum: 6 }));
  assert.equal(r.status, 424);
  assert.equal(r.body.code, 'yazma-izni');
  assert.match(r.body.error, /salt okunursa kayıt reddedilir/);
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  assert.deepEqual(yedekJsonlari(), []);
  mock.restoreAll();
  if (process.platform !== 'win32') {
    fs.chmodSync(dosya, 0o444);
    const p = await kaydet(metin({ ...ORNEK, surum: 7 }));
    fs.chmodSync(dosya, 0o644);
    assert.equal(p.body.code, 'yazma-izni');
    assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  }
});

test('KA20 yedek dizini dosya ise reddedilir; gevsek izin daraltilir', async () => {
  fs.writeFileSync(yedekDizini(), 'dizin degil');
  const r = await kaydet(metin({ ...ORNEK, surum: 8 }));
  assert.equal(r.status, 424);
  assert.equal(r.body.code, 'yedek-dizini');
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
  const l = await istek('GET', '/yedekler');
  assert.equal(l.body.code, 'yedek-dizini');
  fs.rmSync(yedekDizini());
  if (process.platform !== 'win32') {
    fs.mkdirSync(yedekDizini(), { mode: 0o755 });
    fs.chmodSync(yedekDizini(), 0o755);
    assert.equal((await kaydet(metin({ ...ORNEK, surum: 8 }))).status, 200);
    assert.equal(fs.statSync(yedekDizini()).mode & 0o777, 0o700);
  }
});

test('KA21 budama az once alinan yedegi silmez; ayni ms eki sayisal siralanir', async () => {
  fs.mkdirSync(yedekDizini());
  for (let i = 0; i < D.MAKS_YEDEK; i++)
    fs.writeFileSync(
      path.join(yedekDizini(), `2099${String(i + 1).padStart(4, '0')}T000000000Z.json`),
      '{}',
    );
  const r = await kaydet(metin({ ...ORNEK, surum: 10 }));
  assert.equal(r.status, 200);
  assert.ok(yedekler().includes(r.body.yedek), 'az once alinan yedek budandi');
  assert.equal(yedekJsonlari().length, D.MAKS_YEDEK);
  assert.equal(r.body.budanan, 1);

  fs.rmSync(yedekDizini(), { recursive: true });
  fs.mkdirSync(yedekDizini());
  const kok = '20261127T101112345Z';
  for (const ek of ['', '-1', '-2', '-10'])
    fs.writeFileSync(path.join(yedekDizini(), `${kok}${ek}.json`), '{}');
  const l = await istek('GET', '/yedekler');
  assert.deepEqual(
    l.body.yedekler.map((y) => y.ad),
    [`${kok}-10.json`, `${kok}-2.json`, `${kok}-1.json`, `${kok}.json`],
  );
});

test('KA22 okuyucu onbellegi ayni boyut + zaman damgasi + inode ile de yenilenir', async () => {
  const gercekStat = fs.statSync;
  mock.method(fs, 'statSync', (p, ...r) => {
    const st = gercekStat(p, ...r);
    if (st && path.resolve(String(p)) === dosya)
      Object.assign(st, { mtimeMs: 1, ctimeMs: 1, ino: 1 });
    return st;
  });
  assert.equal(kurumAyari().veri.surum, 1);
  const yeni = metin({ ...ORNEK, surum: 2 });
  assert.equal(Buffer.byteLength(yeni), fs.statSync(dosya).size, 'boyut ayni olmali');
  const r = await kaydet(yeni);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(kurumAyari().veri.surum, 2);
});

test('KA23 repo calisma agacindaki dosya yazilmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  try {
    const ic = path.join(kok, 'deploy', 'a.json');
    fs.mkdirSync(path.dirname(ic));
    fs.writeFileSync(ic, '{}');
    assert.equal(D.repoIciMi(ic, kok), false, '.git yokken repo sayildi');
    fs.mkdirSync(path.join(kok, '.git'));
    assert.equal(D.repoIciMi(ic, kok), true);
    assert.equal(D.repoIciMi(dosya, kok), false);
    assert.equal(D.repoIciMi(kok, kok), false);
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
  // Gercek repo: izlenen ornek dosya. Yalniz okunur; PUT kilitten ONCE reddedilir (yanlis sha ile).
  const ornek = path.join(__dirname, '..', '..', '..', 'deploy', 'kurum-ayari.ornek.json');
  if (!fs.existsSync(path.join(__dirname, '..', '..', '..', '.git'))) return;
  const once = sha(fs.readFileSync(ornek));
  process.env.KURUM_AYAR_DOSYASI = ornek;
  const g = await istek('GET', '');
  assert.equal(g.body.repoIci, true);
  const p = await istek('PUT', '', { icerik: '{"a":1}', oncekiSha: 'f'.repeat(64) });
  assert.equal(p.status, 409);
  assert.equal(p.body.code, 'repo-ici');
  assert.equal(sha(fs.readFileSync(ornek)), once);
});

test('KA24 denetimde kirpilan yol kategorisi (+N) ile', async () => {
  const yeni = structuredClone(ORNEK);
  yeni.cok = {};
  for (let i = 0; i < 45; i++) yeni[`k${String(i).padStart(2, '0')}`] = i;
  const r = await kaydet(metin(yeni));
  assert.equal(r.status, 200);
  assert.equal(r.body.yollar.eklenen.length, 46);
  assert.match(denetim[0].detail, / eklenen=[^ ]+ \(\+6\)$/);
});

test('KA25 bolum bosaltma / null / sunucu alani silme 428; onay yalniz true', async () => {
  for (const nginx of [{}, null, [], 'x']) {
    const r = await kaydet(metin({ ...ORNEK, nginx }));
    assert.equal(r.status, 428, JSON.stringify(nginx));
    assert.deepEqual(r.body.silinenBolumler, ['nginx']);
  }
  const alan = structuredClone(ORNEK);
  delete alan.nginx.intranetSunuculari;
  const a = await kaydet(metin(alan));
  assert.equal(a.status, 428);
  assert.deepEqual(a.body.silinenBolumler, []);
  assert.deepEqual(a.body.silinenSunucuAlanlari, ['nginx.intranetSunuculari']);
  const evet = await kaydet(metin(alan), { bolumSilmeOnayi: 'evet' });
  assert.equal(evet.status, 428, 'yalniz true onay sayilir');
  assert.equal((await kaydet(metin(alan), { bolumSilmeOnayi: true })).status, 200);
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(alan));
});

test('KA26 POSIX: 0666 dosyada umask a ragmen mod korunur', async () => {
  if (process.platform === 'win32') return;
  fs.chmodSync(dosya, 0o666);
  const eskiMask = process.umask(0o022);
  try {
    assert.equal((await kaydet(metin({ ...ORNEK, surum: 11 }))).status, 200);
  } finally {
    process.umask(eskiMask);
  }
  assert.equal(fs.statSync(dosya).mode & 0o777, 0o666);
});

test('KA27 disk dolu adlandirilir, denetime fail, yetim yedek kalmaz', async () => {
  const gercek = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (hedef, ...r) => {
    if (typeof hedef === 'number') throw Object.assign(new Error('dolu'), { code: 'ENOSPC' });
    return gercek(hedef, ...r);
  });
  const r = await kaydet(metin({ ...ORNEK, surum: 12 }));
  mock.restoreAll();
  assert.equal(r.status, 424);
  assert.equal(r.body.code, 'disk-dolu');
  assert.equal(denetim[0].result, 'fail');
  assert.match(denetim[0].detail, /^code=disk-dolu /);
  assert.deepEqual(yedekJsonlari(), [], 'yarim yedek kaldi');
  assert.equal(fs.readFileSync(dosya, 'utf8'), metin(ORNEK));
});

test('KA28 yazma siniri kullanici basina', async () => {
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await istek('PUT', '', { icerik: '{}', oncekiSha: 'f'.repeat(64) }, 'Admin', 'admin1'))
        .status,
      409,
    );
  const a = await istek('PUT', '', { icerik: '{}', oncekiSha: 'f'.repeat(64) }, 'Admin', 'admin1');
  assert.equal(a.status, 429);
  const b = await istek('PUT', '', { icerik: '{}', oncekiSha: 'f'.repeat(64) }, 'Admin', 'admin2');
  assert.equal(b.status, 409);
});

test('KA22b elle duzenleme: ayni boyut ve ayni mtime ile de okuyucu yeniyi gorur (ctime)', async () => {
  // Kaba saat cozunurlugu benzetimi: iki yazimda da ayni (tam saniye) zaman damgasi.
  fs.utimesSync(dosya, 1000, 1000);
  assert.equal(kurumAyari().veri.surum, 1);
  const st = fs.statSync(dosya);
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(dosya, metin({ ...ORNEK, surum: 2 }));
  fs.utimesSync(dosya, 1000, 1000);
  const yeni = fs.statSync(dosya);
  assert.equal(yeni.mtimeMs, st.mtimeMs);
  assert.equal(yeni.size, st.size);
  assert.equal(kurumAyari().veri.surum, 2);
});
