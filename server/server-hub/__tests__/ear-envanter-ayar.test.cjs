// server/server-hub/__tests__/ear-envanter-ayar.test.cjs - Uygulama Envanteri ayarlari ve iki planli zamanlama.
//
//   EY1  varsayilanlar (kullanici, 2026-11-05): P1 OZET her 4 haftada Pazar 02:00, P2 TAM her 2 ayda ayin ilk
//        Pazari 03:00; ikisi KAPALI (template girilince filo taramasi kendiliginden baslamaz); parti 100 / 50
//   EY2  dogrulama: plan alanlari, kapsam normalize (ORTAM:a,B -> ORTAM:A,B), gercek takvim tarihi, saat SS:DD
//   EY3  DB satirlari: gecersiz ya da bilinmeyen satir yok sayilir (varsayilan gecerli kalir)
//   EY4  ZAMAN DOGRULUK TABLOSU (TR = UTC+3): N haftada bir yil donumunde; TR gece yarisi siniri; ayin
//        ilk / dorduncu / SON gunu (5 Pazarli ay, 28 gunluk Subat); baslangic (capa) oncesi calisma yok;
//        24 saat telafi; anahtar TR tarihiyle; kapali plan sonraki zaman vermez
//   EY5  TAM ONCELIGI: ayni gunun OZET ornegi kapsayan TAM ile birlesir; kapsam kapsamazsa ya da iki plan
//        da OZET ise birlesmez; TAM once siralanir; P1'de eski H- anahtari es anahtardir
//   EY6  yaz / planYaz: varsayilana donen deger satiri SILER; planda bir alan gecersizse HICBIRI yazilmaz;
//        tek transaction; okunamazsa 424 (sessiz yazma yok)
//   EY7  ESKI HAFTALIK PLAN: acikti -> P1'e aynen tasinir (HAFTA, 1, gun, saat, kip); kapaliydi -> silinir
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ear-envanter.cjs');

function ayarYukle() {
  delete require.cache[require.resolve('../ear-envanter-ayar.cjs')];
  return require('../ear-envanter-ayar.cjs');
}
afterEach(() => F.dbKaldir());

/** UTC Date -> TR yerel "YYYY-AA-GG SS:DD". */
const tr = (d) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

test('EY1 varsayilanlar', () => {
  const a = ayarYukle();
  const d = a.varsayilanlar();
  assert.deepEqual(
    ['acik', 'birim', 'aralik', 'gun', 'saat', 'kip', 'kapsam'].map((k) => d[`p1_${k}`]),
    ['KAPALI', 'HAFTA', '4', '0', '02:00', 'OZET', 'FILO'],
  );
  assert.deepEqual(
    ['acik', 'birim', 'aralik', 'gun', 'sira', 'saat', 'kip', 'kapsam'].map((k) => d[`p2_${k}`]),
    ['KAPALI', 'AY', '2', '0', 'ILK', '03:00', 'TAM', 'FILO'],
  );
  assert.equal(d.parti_ozet, '100');
  assert.equal(d.parti_tam, '50');
  assert.equal(d.kokler, '/vhosting:/vhosting8');
  for (const k of ['zamanlayici', 'gun', 'saat', 'kip']) assert.ok(!(k in d), `eski anahtar ${k}`);
  assert.deepEqual(a.planOzeti(d).map((p) => p.sonraki), [[], []], 'kapali plan sonraki zaman vermez');
});

test('EY2 dogrulama', () => {
  const { AYARLAR, kokDogrula, kapsamDogrula, tarihDogrula } = ayarYukle();
  assert.equal(AYARLAR.parti_tam.dogrula('101'), null);
  assert.equal(AYARLAR.parti_tam.dogrula(' 75 '), '75');
  assert.equal(AYARLAR.p1_saat.dogrula('24:00'), null);
  assert.equal(AYARLAR.p1_saat.dogrula('2:00'), null);
  assert.equal(AYARLAR.p1_saat.dogrula('23:59'), '23:59');
  assert.equal(AYARLAR.p1_gun.dogrula('7'), null);
  assert.equal(AYARLAR.p1_aralik.dogrula('0'), null);
  assert.equal(AYARLAR.p1_aralik.dogrula('13'), null);
  assert.equal(AYARLAR.p2_sira.dogrula('BESINCI'), null);
  assert.equal(AYARLAR.p2_birim.dogrula('GUN'), null);
  assert.equal(kapsamDogrula('ORTAM: test , prod,TEST'), 'ORTAM:PROD,TEST');
  assert.equal(kapsamDogrula('SORUNLU'), 'SORUNLU');
  for (const k of ['', 'ORTAM:', 'ORTAM:a;b', 'HEPSI', `ORTAM:${Array.from({ length: 21 }, (_, i) => `E${i}`).join(',')}`])
    assert.equal(kapsamDogrula(k), null, k);
  assert.equal(tarihDogrula('2026-02-28'), '2026-02-28');
  for (const t of ['2026-02-30', '2026-13-01', '26-01-01', '2019-12-31', ''])
    assert.equal(tarihDogrula(t), null, t);
  assert.equal(AYARLAR.okuma_kullanicisi.dogrula('root; id'), null);
  assert.equal(kokDogrula('/vhosting:/vhosting8'), '/vhosting:/vhosting8');
  for (const k of ['vhosting', '/a/../b', '/a:/b:/c:/d:/e', '', '/a b', '/a:'])
    assert.equal(kokDogrula(k), null, k);
});

test('EY3 DB satirlari suzulur', () => {
  const { satirlardan } = ayarYukle();
  const s = satirlardan([
    { anahtar: 'parti_tam', deger: '500' },
    { anahtar: 'bilinmeyen', deger: 'x' },
    { anahtar: 'p1_acik', deger: 'ACIK', updated_by: 'ayse' },
    { anahtar: 'p2_kapsam', deger: 'ORTAM:' },
  ]);
  assert.equal(s.deger.parti_tam, '50', 'gecersiz satir varsayilani ezmemeli');
  assert.equal(s.deger.p1_acik, 'ACIK');
  assert.equal(s.deger.p2_kapsam, 'FILO');
  assert.deepEqual(Object.keys(s.kayitlar), ['p1_acik']);
});

test('EY4 zaman dogruluk tablosu (TR)', () => {
  const a = ayarYukle();
  const plan = (p, ek) => a.planOf({ ...a.varsayilanlar(), [`${p}_acik`]: 'ACIK', ...ek }, p);
  const p1 = plan('p1', {});
  // capa 2026-01-01 (Persembe): ilk Pazar 4 Ocak, sonra 28 gunde bir.
  assert.deepEqual(a.sonrakiZamanlamalar(p1, new Date('2026-11-05T12:00:00Z'), 3).map(tr), [
    '2026-11-08 02:00',
    '2026-12-06 02:00',
    '2027-01-03 02:00',
  ]);
  assert.equal(tr(a.ornek(p1, 0)), '2026-01-04 02:00');
  // TR 02:00 Pazar = UTC Cumartesi 23:00
  assert.equal(a.sonZamanlama(p1, new Date('2026-11-07T23:00:00Z')).toISOString(), '2026-11-07T23:00:00.000Z');
  assert.equal(tr(a.sonZamanlama(p1, new Date('2026-11-07T22:59:00Z'))), '2026-10-11 02:00');
  // TR gece yarisi: Pazartesi 00:30 TR = Pazar 21:30 UTC
  const gece = plan('p1', { p1_aralik: '1', p1_gun: '1', p1_saat: '00:30' });
  assert.equal(a.sonZamanlama(gece, new Date('2026-11-08T21:30:00Z')).toISOString(), '2026-11-08T21:30:00.000Z');
  assert.equal(a.trGun(a.sonZamanlama(gece, new Date('2026-11-08T21:30:00Z'))), '2026-11-09');
  // AY: 2 ayda bir ilk Pazar (Oca, Mar, May ... Kas 2026 = 1 Kas)
  const p2 = plan('p2', {});
  assert.deepEqual(a.sonrakiZamanlamalar(p2, new Date('2026-10-01T00:00:00Z'), 3).map(tr), [
    '2026-11-01 03:00',
    '2027-01-03 03:00',
    '2027-03-07 03:00',
  ]);
  // Kasim 2026'da bes Pazar: ilk 1, dorduncu 22, son 29; Subat 2027'nin son Cumasi 26.
  assert.equal(a.ayinGunu(2026, 10, 0, 'ILK'), 1);
  assert.equal(a.ayinGunu(2026, 10, 0, 'DORDUNCU'), 22);
  assert.equal(a.ayinGunu(2026, 10, 0, 'SON'), 29);
  assert.equal(a.ayinGunu(2027, 1, 5, 'SON'), 26);
  assert.equal(a.ayinGunu(2027, 1, 0, 'ILK'), 7);
  const son = plan('p2', { p2_aralik: '1', p2_sira: 'SON', p2_gun: '5', p2_saat: '23:45' });
  assert.equal(tr(a.sonrakiZamanlamalar(son, new Date('2027-02-01T00:00:00Z'), 1)[0]), '2027-02-26 23:45');
  // Capa: baslangic 2026-11-10 -> ilk haftalik Pazar 15 Kasim; oncesinde calisma yok.
  const capa = plan('p1', { p1_aralik: '1', p1_baslangic: '2026-11-10' });
  assert.equal(a.sonZamanlama(capa, new Date('2026-11-12T00:00:00Z')), null);
  assert.equal(tr(a.sonrakiZamanlamalar(capa, new Date('2026-11-12T00:00:00Z'), 1)[0]), '2026-11-15 02:00');
  // AY capasi ayin ilk Pazarindan sonra: o ay atlanir, aralik capa ayindan sayilir (Kas + 2 = Oca).
  const capaAy = plan('p2', { p2_baslangic: '2026-11-05' });
  assert.equal(tr(a.sonrakiZamanlamalar(capaAy, new Date('2026-11-05T00:00:00Z'), 1)[0]), '2027-01-03 03:00');
  // Telafi 24 saat; anahtar TR tarihiyle
  const d = { ...a.varsayilanlar(), p1_acik: 'ACIK' };
  assert.deepEqual(a.bekleyenZamanlama(d, new Date('2026-11-07T23:30:00Z')).map((x) => x.anahtar), ['P1-2026-11-08']);
  assert.deepEqual(a.bekleyenZamanlama(d, new Date('2026-11-08T23:01:00Z')), [], '24 saat sonra telafi yok');
  assert.deepEqual(a.bekleyenZamanlama(a.varsayilanlar(), new Date('2026-11-07T23:30:00Z')), []);
  assert.match(a.zamanlamaMetni(p1), /^Her 4 haftada bir · Pazar 02:00 \(TR\) · ÖZET · tüm filo$/);
  assert.match(a.zamanlamaMetni(p2), /^Her 2 ayda bir · ayın ilk Pazarı 03:00 \(TR\) · TAM · tüm filo$/);
  assert.match(a.zamanlamaMetni(son), /^Her ay · ayın son Cuması 23:45/);
});

test('EY5 TAM onceligi', () => {
  const a = ayarYukle();
  const ikiAcik = { ...a.varsayilanlar(), p1_acik: 'ACIK', p2_acik: 'ACIK' };
  // 3 Ocak 2027: P1 02:00 OZET ve P2 03:00 TAM ayni gun.
  const gece = a.bekleyenZamanlama(ikiAcik, new Date('2027-01-02T23:30:00Z'));
  assert.deepEqual(gece.map((x) => [x.anahtar, x.birlesti]), [['P1-2027-01-03', 'P2']]);
  assert.deepEqual(gece[0].esAnahtarlar, ['H-2027-01-03'], 'eski haftalik anahtar');
  const sonra = a.bekleyenZamanlama(ikiAcik, new Date('2027-01-03T00:30:00Z'));
  assert.deepEqual(sonra.map((x) => [x.anahtar, x.birlesti]), [['P2-2027-01-03', null], ['P1-2027-01-03', 'P2']]);
  assert.deepEqual(sonra[0].esAnahtarlar, []);
  // Kapsam kapsamiyor: TAM yalniz PROD, OZET filo -> birlesmez.
  const prod = { ...ikiAcik, p2_kapsam: 'ORTAM:PROD' };
  assert.deepEqual(a.bekleyenZamanlama(prod, new Date('2027-01-03T00:30:00Z')).map((x) => x.birlesti), [null, null]);
  // Ikisi de OZET -> birlesmez.
  const ozet = { ...ikiAcik, p2_kip: 'OZET' };
  assert.ok(a.bekleyenZamanlama(ozet, new Date('2027-01-03T00:30:00Z')).every((x) => !x.birlesti));
  // TAM ortam listesi OZET'inkini kapsar.
  assert.equal(a.kapsamKapsar('ORTAM:PROD,TEST', 'ORTAM:TEST'), true);
  assert.equal(a.kapsamKapsar('ORTAM:PROD', 'ORTAM:PROD,TEST'), false);
  assert.equal(a.kapsamKapsar('FILO', 'SORUNLU'), true);
  assert.equal(a.kapsamKapsar('SORUNLU', 'FILO'), false);
  // 8 Kasim: yalniz P1 (P2'nin Kasim ornegi 1 Kasim'di, 7 gun uzakta): birlesmez.
  assert.deepEqual(a.bekleyenZamanlama(ikiAcik, new Date('2026-11-07T23:30:00Z')).map((x) => x.birlesti), [null]);
});

test('EY6 yaz ve planYaz', async () => {
  let a = ayarYukle();
  const db = F.sahteDb([
    [/SELECT anahtar, deger/, () => ({ rows: [{ anahtar: 'parti_tam', deger: '80' }, { anahtar: 'p1_aralik', deger: '2' }] })],
  ]);
  F.dbKur(db);
  const r = await a.yaz('parti_tam', '50', 'ayse');
  assert.deepEqual([r.eski, r.yeni], ['80', '50']);
  assert.ok(db.cagrilar.some((c) => /DELETE FROM ear_envanter_ayarlar WHERE anahtar = \$1/.test(c.sql)));
  await assert.rejects(a.yaz('parti_tam', '500', 'ayse'), (e) => e.status === 400);
  await assert.rejects(a.yaz('yok', '1', 'ayse'), (e) => e.status === 400);
  const once = db.cagrilar.length;
  await assert.rejects(a.planYaz('p1', { acik: 'ACIK', saat: '25:00' }, 'ayse'), (e) => e.status === 400);
  await assert.rejects(a.planYaz('p3', { acik: 'ACIK' }, 'ayse'), (e) => e.code === 'bilinmeyen_plan');
  await assert.rejects(a.planYaz('p1', { yok: '1' }, 'ayse'), (e) => e.status === 400);
  assert.equal(db.cagrilar.length, once, 'gecersiz alanda DB ye hic gidilmez');
  const p = await a.planYaz('p1', { acik: 'ACIK', aralik: '4', kapsam: 'ORTAM:test', saat: '02:00' }, 'ayse');
  assert.deepEqual(
    p.degisen.map((x) => [x.anahtar, x.yeni]),
    [['p1_acik', 'ACIK'], ['p1_aralik', '4'], ['p1_kapsam', 'ORTAM:TEST']],
    'degismeyen alan yazilmaz; kapsam normalize',
  );
  const tx = db.cagrilar.at(-1);
  assert.match(tx.sql, /SET XACT_ABORT ON;\s*BEGIN TRAN;[\s\S]*COMMIT;/);
  assert.deepEqual(JSON.parse(tx.params[0]), ['p1_aralik'], 'varsayilana donen satir silinir');
  assert.deepEqual(JSON.parse(tx.params[1]), [
    { anahtar: 'p1_acik', deger: 'ACIK' },
    { anahtar: 'p1_kapsam', deger: 'ORTAM:TEST' },
  ]);
  a = ayarYukle();
  F.dbKur(F.sahteDb([[/SELECT anahtar, deger/, () => { throw new Error('DB yok'); }]]));
  await assert.rejects(a.yaz('parti_tam', '60', 'ayse'), (e) => e.status === 424);
  await assert.rejects(a.planYaz('p2', { acik: 'ACIK' }, 'ayse'), (e) => e.status === 424);
});

test('EY7 eski haftalik plan tasinir', async () => {
  let a = ayarYukle();
  let satirlar = [
    { anahtar: 'zamanlayici', deger: 'ACIK' },
    { anahtar: 'gun', deger: '3' },
    { anahtar: 'saat', deger: '21:15' },
    { anahtar: 'parti_tam', deger: '40' },
  ];
  let db = F.sahteDb([
    [/SELECT anahtar, deger/, () => ({ rows: satirlar })],
    [/DELETE FROM ear_envanter_ayarlar WHERE anahtar IN/, (params) => {
      const sil = new Set(JSON.parse(params[0]));
      const ekle = JSON.parse(params[1]);
      satirlar = [...satirlar.filter((r) => !sil.has(r.anahtar)), ...ekle];
      return {};
    }],
  ]);
  F.dbKur(db);
  const o = await a.oku(true);
  assert.deepEqual(
    ['acik', 'birim', 'aralik', 'gun', 'saat', 'kip'].map((k) => o.deger[`p1_${k}`]),
    ['ACIK', 'HAFTA', '1', '3', '21:15', 'TAM'],
    'acik eski plan aynen tasinir (eski varsayilan kip TAM)',
  );
  assert.equal(o.deger.parti_tam, '40', 'oteki ayarlar yerinde');
  assert.ok(!satirlar.some((r) => ['zamanlayici', 'gun', 'saat', 'kip'].includes(r.anahtar)));
  assert.ok(!satirlar.some((r) => r.anahtar === 'p1_birim'), 'varsayilan deger satir olarak yazilmaz');
  const tasima = db.cagrilar.filter((c) => /DELETE FROM ear_envanter_ayarlar WHERE anahtar IN/.test(c.sql));
  assert.equal(tasima.length, 1);
  await a.oku(true);
  assert.equal(db.cagrilar.filter((c) => /DELETE FROM ear_envanter_ayarlar WHERE anahtar IN/.test(c.sql)).length, 1, 'bir kez');

  a = ayarYukle();
  satirlar = [{ anahtar: 'kip', deger: 'OZET' }, { anahtar: 'saat', deger: '04:00' }];
  db = F.sahteDb([
    [/SELECT anahtar, deger/, () => ({ rows: satirlar })],
    [/DELETE FROM ear_envanter_ayarlar WHERE anahtar IN/, (params) => {
      const sil = new Set(JSON.parse(params[0]));
      satirlar = satirlar.filter((r) => !sil.has(r.anahtar));
      assert.deepEqual(JSON.parse(params[1]), [], 'kapali eski plan tasinmaz');
      return {};
    }],
  ]);
  F.dbKur(db);
  const k = await a.oku(true);
  assert.equal(k.deger.p1_acik, 'KAPALI');
  assert.equal(k.deger.p1_kip, 'OZET');
  assert.deepEqual(satirlar, []);
});
