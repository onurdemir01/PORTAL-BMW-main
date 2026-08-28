// server/ansible/__tests__/output-filter.test.cjs — "kullaniciya log gozukmuyor".
//
// LOGLARIN SESSIZCE BOSALABILECEGI TEK YER BURASI. Admin bir SS item icin "Cikti
// Filtresi" tanimlarsa ham AWX stdout'undan yalnizca needle'i ICEREN satirlar
// gosterilir. Needle hicbir satirla eslesmezse ekran BOMBOS kalir ve hicbir hata
// verilmez — kullanici "loglar gozukmuyor" der, sebebini kimse bilemez.
//
// BU MANTIK ONCEDEN route handler'inin ICINDE, AWX ve DB cagrilarinin arasinda
// gomuluydu; yani ancak CANLI bir AWX + DB ile denenebiliyordu ve pratikte HIC test
// edilmiyordu. Saf fonksiyona cikarildi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOutputFilter } = require('../runner.cjs');

const STDOUT = [
  'PLAY [deploy] ******************',
  '  TASK [Gathering Facts] *******',
  'ok: [gbansp01]',
  '  ÖZET: 3 sunucu guncellendi',
  'PLAY RECAP *********************',
].join('\n');

test('filtre YOKSA cikti AYNEN doner', () => {
  assert.equal(applyOutputFilter(STDOUT, undefined).output, STDOUT);
  assert.equal(applyOutputFilter(STDOUT, {}).output, STDOUT);
  assert.equal(applyOutputFilter(STDOUT, { outputFilter: null }).output, STDOUT);
});

test('filtre KAPALIYSA cikti AYNEN doner', () => {
  const r = applyOutputFilter(STDOUT, { outputFilter: { enabled: false, contains: 'ÖZET' } });
  assert.equal(r.output, STDOUT);
  assert.equal(r.filtered, false);
});

test('needle BOSSA filtre uygulanmaz (tum log kaybolmaz)', () => {
  // Admin filtreyi acip metni bos birakirsa, "hicbir satir eslesmiyor" diye TUM
  // log kaybolmamali — bu, ekrani bombos birakan en kolay yanlis yapilandirma.
  for (const contains of ['', '   ', null, undefined]) {
    const r = applyOutputFilter(STDOUT, { outputFilter: { enabled: true, contains } });
    assert.equal(r.output, STDOUT, `bos needle (${JSON.stringify(contains)}) tum logu sildi`);
    assert.equal(r.filtered, false);
  }
});

test('filtre ACIKSA yalnizca eslesen satirlar kalir ve KIRPILIR', () => {
  const r = applyOutputFilter(STDOUT, { outputFilter: { enabled: true, contains: 'ÖZET' } });
  assert.equal(r.filtered, true);
  // Bastaki girinti kaldirilir: filtre ekrana yalniz ozet satirlari koydugu icin
  // playbook girintisi anlamsizlasiyor ve satirlar "kaymis" gorunuyordu.
  assert.equal(r.output, 'ÖZET: 3 sunucu guncellendi');
  assert.equal(r.totalLines, 5);
  assert.equal(r.matchedLines, 1);
});

test('HICBIR satir eslesmezse bu DURUM RAPORLANIR (sessiz kalmaz)', () => {
  // Cagiran taraf `matchedLines === 0 && totalLines > 0` durumunu uyari olarak
  // loglar — "log gozukmuyor" sikayetinin ilk bakilacak yeri budur.
  const r = applyOutputFilter(STDOUT, { outputFilter: { enabled: true, contains: 'BOYLE_BIR_SEY_YOK' } });
  assert.equal(r.filtered, true);
  assert.equal(r.output, '');
  assert.equal(r.totalLines, 5);
  assert.equal(r.matchedLines, 0, 'tespit edilebilir olmali');
});

test('stdout null/undefined ise BOS METIN doner, undefined DEGIL', () => {
  // Istemci `data.output` bekliyor; `undefined` gondermek "Çıktı yok." yerine
  // bozuk bir gorunum uretirdi.
  for (const v of [null, undefined, 0, false]) {
    assert.equal(applyOutputFilter(v, undefined).output, '');
  }
});

test('cok satirli eslesme sirasi KORUNUR', () => {
  const r = applyOutputFilter(STDOUT, { outputFilter: { enabled: true, contains: 'PLAY' } });
  assert.deepEqual(r.output.split('\n'), ['PLAY [deploy] ******************', 'PLAY RECAP *********************']);
});

test('CRLF kalintisi eslesmeyi bozmaz', () => {
  const crlf = 'ok: [h1]\r\nÖZET: bitti\r\n';
  const r = applyOutputFilter(crlf, { outputFilter: { enabled: true, contains: 'ÖZET' } });
  assert.equal(r.output, 'ÖZET: bitti');
});
