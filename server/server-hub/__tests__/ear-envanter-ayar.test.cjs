// server/server-hub/__tests__/ear-envanter-ayar.test.cjs - Uygulama Envanteri ayarlari ve haftalik zaman.
//
//   EY1  varsayilanlar: zamanlayici KAPALI (template girilince filo taramasi kendiliginden baslamaz),
//        TAM, Pazar 02:00, parti 100 / 50
//   EY2  dogrulama: parti 1..100, kokler mutlak / '..' yok / en cok 4, kimlik bicimi, saat SS:DD
//   EY3  DB satirlari: gecersiz ya da bilinmeyen satir yok sayilir (varsayilan gecerli kalir)
//   EY4  zaman TR (UTC+3): Pazar 02:00 TR = Cumartesi 23:00 UTC; anahtar TR tarihiyle; 24 saat sonra
//        kacirilan hafta telafi edilmez; kapaliyken sonraki zaman yok
//   EY5  yaz: varsayilana donen deger satiri SILER; okunamazsa 424 (sessiz yazma yok)
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ear-envanter.cjs');

function ayarYukle() {
  delete require.cache[require.resolve('../ear-envanter-ayar.cjs')];
  return require('../ear-envanter-ayar.cjs');
}
afterEach(() => F.dbKaldir());

test('EY1 varsayilanlar', () => {
  const a = ayarYukle().varsayilanlar();
  assert.equal(a.zamanlayici, 'KAPALI');
  assert.equal(a.kip, 'TAM');
  assert.equal(a.gun, '0');
  assert.equal(a.saat, '02:00');
  assert.equal(a.parti_ozet, '100');
  assert.equal(a.parti_tam, '50');
  assert.equal(a.kokler, '/vhosting:/vhosting8');
});

test('EY2 dogrulama', () => {
  const { AYARLAR, kokDogrula } = ayarYukle();
  assert.equal(AYARLAR.parti_tam.dogrula('101'), null);
  assert.equal(AYARLAR.parti_tam.dogrula('0'), null);
  assert.equal(AYARLAR.parti_tam.dogrula(' 75 '), '75');
  assert.equal(AYARLAR.saat.dogrula('24:00'), null);
  assert.equal(AYARLAR.saat.dogrula('2:00'), null);
  assert.equal(AYARLAR.saat.dogrula('23:59'), '23:59');
  assert.equal(AYARLAR.gun.dogrula('7'), null);
  assert.equal(AYARLAR.okuma_kullanicisi.dogrula('was'), 'was');
  assert.equal(AYARLAR.okuma_kullanicisi.dogrula(''), '', 'bos = become yok');
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
    { anahtar: 'zamanlayici', deger: 'ACIK', updated_by: 'ayse' },
  ]);
  assert.equal(s.deger.parti_tam, '50', 'gecersiz satir varsayilani ezmemeli');
  assert.equal(s.deger.zamanlayici, 'ACIK');
  assert.deepEqual(Object.keys(s.kayitlar), ['zamanlayici']);
});

test('EY4 haftalik zaman (TR)', () => {
  const a = ayarYukle();
  const ayar = { ...a.varsayilanlar(), zamanlayici: 'ACIK' };
  assert.equal(
    a.sonZamanlama(ayar, new Date('2026-11-07T23:30:00Z')).toISOString(),
    '2026-11-07T23:00:00.000Z',
  );
  assert.equal(
    a.sonZamanlama(ayar, new Date('2026-11-07T22:59:00Z')).toISOString(),
    '2026-10-31T23:00:00.000Z',
  );
  assert.deepEqual(
    a.bekleyenZamanlama(ayar, new Date('2026-11-07T23:30:00Z')).anahtar,
    'H-2026-11-08',
  );
  assert.equal(
    a.bekleyenZamanlama(ayar, new Date('2026-11-08T23:30:00Z')),
    null,
    '24 saat sonra telafi yok',
  );
  assert.equal(
    a.sonrakiZamanlama(ayar, new Date('2026-11-07T23:30:00Z')).toISOString(),
    '2026-11-14T23:00:00.000Z',
  );
  assert.equal(a.sonrakiZamanlama({ ...ayar, zamanlayici: 'KAPALI' }), null);
  assert.equal(
    a.bekleyenZamanlama({ ...ayar, zamanlayici: 'KAPALI' }, new Date('2026-11-07T23:30:00Z')),
    null,
  );
  const carsamba = { ...ayar, gun: '3', saat: '21:15' };
  assert.equal(
    a.bekleyenZamanlama(carsamba, new Date('2026-11-04T18:20:00Z')).anahtar,
    'H-2026-11-04',
  );
  assert.match(a.zamanlamaMetni(carsamba), /Çarşamba 21:15 \(TR\), TAM/);
});

test('EY5 yaz', async () => {
  let a = ayarYukle();
  const db = F.sahteDb([
    [/SELECT anahtar, deger/, () => ({ rows: [{ anahtar: 'parti_tam', deger: '80' }] })],
  ]);
  F.dbKur(db);
  const r = await a.yaz('parti_tam', '50', 'ayse');
  assert.deepEqual([r.eski, r.yeni], ['80', '50']);
  assert.ok(
    db.cagrilar.some((c) => /DELETE FROM ear_envanter_ayarlar WHERE anahtar = \$1/.test(c.sql)),
    'varsayilana donus satiri silmeli',
  );
  await assert.rejects(a.yaz('parti_tam', '500', 'ayse'), (e) => e.status === 400);
  await assert.rejects(a.yaz('yok', '1', 'ayse'), (e) => e.status === 400);
  a = ayarYukle();
  F.dbKur(
    F.sahteDb([
      [
        /SELECT anahtar, deger/,
        () => {
          throw new Error('DB yok');
        },
      ],
    ]),
  );
  await assert.rejects(a.yaz('parti_tam', '60', 'ayse'), (e) => e.status === 424);
});
