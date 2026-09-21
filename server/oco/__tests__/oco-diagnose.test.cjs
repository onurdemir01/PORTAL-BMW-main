// server/oco/__tests__/oco-diagnose.test.cjs
//
// OCO TANI — "bir ornek numara girince ne cikiyor, hangisi nasil dikkate aliniyor?"
//
// EN KRITIK BEKCI: `READ_FIELDS` listesi ile KODUN GERCEKTEN okudugu alanlarin
// ayrismamasi. Ayrisirsa ekran YALAN soyler — "bu alan okunuyor" yazar, kod
// okumaz (ya da tersi). Bu, tani aracini teshis aracindan yanilgi kaynagina
// cevirirdi.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const diag = require('../diagnose.cjs');
const OCO_DIR = path.join(__dirname, '..');
const GATES = fs.readFileSync(path.join(OCO_DIR, '..', 'ansible', 'change-gates.cjs'), 'utf8');
const SRC = {
  'client.cjs': fs.readFileSync(path.join(OCO_DIR, 'client.cjs'), 'utf8'),
  'window.cjs': fs.readFileSync(path.join(OCO_DIR, 'window.cjs'), 'utf8'),
  'change-gates.cjs': GATES,
};

// Gercek bir OCO cevabinin bicimi (window.test.cjs'teki ornekle ayni sekil).
function ornekYanit(over = {}) {
  return {
    GetChangeOrderByWfInstanceIdResult: {
      ResultCode: 1000,
      ResultMessage: 'OK',
      Result: {
        OcoWfInstanceId: 22502813,
        OcoWfIdSubject: 'Odeme servisi bakim',
        PlannedStartDate: '/Date(1789605000000+0300)/',
        PlannedEndDate: '/Date(1789614000000+0300)/',
        // Portalin OKUMADIGI alanlar — tani ekraninin asil konusu bunlar.
        ApprovalStatus: 'Approved',
        RequestedBy: 'bir.kullanici',
        TargetSystems: ['sistem-a', 'sistem-b'],
        Status: 'Scheduled',
        ...over,
      },
    },
  };
}

test('OD1 `READ_FIELDS` listesi KODLA ayrismiyor (ekran yalan soylemez)', () => {
  for (const f of diag.READ_FIELDS) {
    const src = SRC[f.reader];
    assert.ok(src, `bilinmeyen okuyucu: ${f.reader}`);
    // Yol'un SON pargasi o dosyada GERCEKTEN geciyor olmali.
    const leaf = f.path.split('.').pop();
    assert.ok(
      src.includes(leaf),
      `\`${f.path}\` "${f.reader} okuyor" diyor ama o dosyada \`${leaf}\` GECMIYOR`,
    );
  }
});

test('OD2 kodun okudugu bir alan listede EKSIK degil', () => {
  // Ters yon: `window.cjs` bir tarih alani okuyorsa listede de olmali. Aksi
  // halde ekran "yok sayiliyor" der, kod okur — kullanici yanlis karar verir.
  const beklenen = ['PlannedStartDate', 'PlannedEndDate', 'InterruptionStartDate', 'InterruptionEndDate'];
  const listede = new Set(diag.READ_FIELDS.map((f) => f.path.split('.').pop()));
  for (const alan of beklenen) {
    if (!SRC['window.cjs'].includes(alan)) continue;
    assert.ok(listede.has(alan), `window.cjs \`${alan}\` okuyor ama READ_FIELDS'te YOK`);
  }
  // Baslik alanlari da ayni sekilde.
  for (const alan of ['OcoWfIdSubject', 'Subject']) {
    assert.ok(listede.has(alan), `change-gates \`${alan}\` okuyor ama READ_FIELDS'te YOK`);
  }
});

test('OD3 gezinti YOK SAYILAN alanlari GERCEKTEN gosteriyor', () => {
  const { fields } = diag.walkFields(ornekYanit());
  const yol = (p) => fields.find((f) => f.path === p);

  // Okunan
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.PlannedStartDate').read, true);
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.OcoWfIdSubject').read, true);
  // Yok sayilan — taninin asil degeri bu
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.ApprovalStatus').read, false);
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.TargetSystems').read, false);
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.Status').read, false);
  // Dizi ICINE girilmez, uzunluk gosterilir
  assert.equal(yol('GetChangeOrderByWfInstanceIdResult.Result.TargetSystems').type, 'array');
  assert.match(yol('GetChangeOrderByWfInstanceIdResult.Result.TargetSystems').value, /2 oge/);
});

test('OD4 gezinti SINIRLI (dev/bozuk govde ekrani bogmaz)', () => {
  const dev = { GetChangeOrderByWfInstanceIdResult: { Result: {} } };
  for (let i = 0; i < 2000; i++) dev.GetChangeOrderByWfInstanceIdResult.Result[`alan${i}`] = i;
  const { fields, truncated } = diag.walkFields(dev);
  assert.ok(fields.length <= diag.MAX_FIELDS, `alan sayisi tavani asildi: ${fields.length}`);
  assert.equal(truncated, true, 'kirpma SESSIZ — kullaniciya soylenmiyor');
});

test('OD5 uzun deger KIRPILIYOR ve kirpildigi soyleniyor', () => {
  const { fields } = diag.walkFields(ornekYanit({ Subject: 'x'.repeat(5000) }));
  const f = fields.find((x) => x.path.endsWith('.Subject'));
  assert.ok(f.value.length <= diag.MAX_VALUE_LEN + 1, 'deger kirpilmamis');
  assert.equal(f.truncated, true);
});

test('OD6 EKSIK alanlar raporlaniyor ("kapi neden calismadi"nin cevabi)', () => {
  // Planned* YOKSA ve PlannedInterruption da yoksa kapi "tarih yok" ile duser.
  const yanit = ornekYanit();
  delete yanit.GetChangeOrderByWfInstanceIdResult.Result.PlannedStartDate;
  delete yanit.GetChangeOrderByWfInstanceIdResult.Result.PlannedEndDate;
  const d = diag.diagnose({ payload: yanit, resultCode: 1000 });
  const eksik = d.missing.map((m) => m.path.split('.').pop());
  assert.ok(eksik.includes('PlannedStartDate'), 'eksik alan raporlanmiyor');
  assert.equal(d.window, null, 'tarih yokken pencere uretilmis');
});

test('OD7 pencere karari GERCEK `window.cjs` ile ayni', () => {
  const { evaluateWindow, extractPlannedInterruption } = require('../window.cjs');
  const yanit = ornekYanit();
  const now = new Date(1789606000000); // pencere ICINDE
  const d = diag.diagnose({ payload: yanit, resultCode: 1000 }, now);
  const planned = extractPlannedInterruption(yanit);
  const beklenen = evaluateWindow({ startDate: planned.startDate, endDate: planned.endDate, now });
  assert.deepEqual(d.window, beklenen, 'tani penceresi gercek hesapla AYRISMIS');
  assert.equal(d.window.phase, 'inside');
});

test('OD8 kapi simulasyonu gercek karar agaciyla AYNI SIRADA', () => {
  // `evaluateOcoGate` sirasi: tarih yok -> pencere bozuk -> expired -> before -> inside
  // DILIM SINIRI ONEMLI: `openSmartTicket` bu dosyada `evaluateOcoGate`ten
  // ONCE tanimli (satir 84 vs 210). Ilk yazdigimda son sinir olarak onu
  // vermistim ve dilim BOS cikiyordu — bekci dogru sebeple degil, bos metinde
  // hicbir sey bulamadigi icin kirmiziya dusmustu. Bos bir dilimde `indexOf`
  // hep -1 doner; sira kontrolu "gecerse" de hicbir sey kanitlamazdi.
  const bas = GATES.indexOf('async function evaluateOcoGate');
  const son = GATES.indexOf('async function runChangeGates');
  assert.ok(bas > 0 && son > bas, 'karar agaci dilimi bulunamadi');
  const s = GATES.slice(bas, son);
  const sira = ['ocoRequired', 'ocoExpired', 'ocoDecisionRequired'];
  let onceki = -1;
  for (const m of sira) {
    const i = s.indexOf(m);
    assert.ok(i > onceki, `gercek kapida sira degismis: ${m}`);
    onceki = i;
  }
  // Simulasyon ayni sonuclari uretmeli.
  const yanit = ornekYanit();
  const gecmis = new Date(1789700000000); // pencere KAPANMIS
  const d1 = diag.diagnose({ payload: yanit, resultCode: 1000 }, gecmis);
  assert.equal(diag.simulateGate({ diagnosis: d1, ocoApplies: true }).outcome, 'error');

  const erken = new Date(1789000000000); // pencere HENUZ ACILMADI
  const d2 = diag.diagnose({ payload: yanit, resultCode: 1000 }, erken);
  assert.equal(diag.simulateGate({ diagnosis: d2, ocoApplies: true }).outcome, 'deferred');

  const icinde = new Date(1789606000000);
  const d3 = diag.diagnose({ payload: yanit, resultCode: 1000 }, icinde);
  assert.equal(diag.simulateGate({ diagnosis: d3, ocoApplies: true }).outcome, 'proceed');

  // Kapi uygulanmiyorsa numara HIC sorulmaz.
  assert.equal(diag.simulateGate({ diagnosis: d3, ocoApplies: false }).outcome, 'skip');
});

test('OD9 `OCO_API_URL` varsayilani YOK — "ayar yok" ile "servis cokmus" ayrilir', () => {
  const onceki = process.env.OCO_API_URL;
  try {
    delete process.env.OCO_API_URL;
    delete require.cache[require.resolve('../config.cjs')];
    const cfg = require('../config.cjs');
    assert.equal(cfg.getConfig().baseUrl, '', 'kod icinde hala bir varsayilan var');
    assert.equal(cfg.isConfigured(), false, '`isConfigured()` yalan soyluyor (daima true)');
  } finally {
    if (onceki === undefined) delete process.env.OCO_API_URL;
    else process.env.OCO_API_URL = onceki;
    delete require.cache[require.resolve('../config.cjs')];
  }
});

test('OD10 OCO yaniti BAYT TAVANI tasiyor', () => {
  const src = SRC['client.cjs'];
  assert.match(src, /OCO_RESPONSE_MAX_BYTES/, 'bayt tavani yok');
  // `.text()` ile sinirsiz okuma KALMAMALI.
  const govde = src.slice(src.indexOf('async function getChangeOrder'));
  assert.ok(
    !/await res\.body\.text\(\)/.test(govde),
    'hala sinirsiz `.text()` ile okunuyor',
  );
  assert.match(govde, /okuSinirli\(/, 'sinirli okuyucu KARAR NOKTASINDA kullanilmiyor');
});
