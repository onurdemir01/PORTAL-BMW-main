// server/selfservice/__tests__/check-truncation.test.cjs — SESSIZ KESME.
//
// `POST /ip-check` ve `POST /openshift-check` girdiyi 1000'de KESIYOR ve bunu
// SOYLEMIYORDU. Kullanici Excel'den 1500 satir yapistirdiginda 500'u hicbir yerde
// gorunmuyordu: ne sonuc listesinde, ne "bulunamadi" listesinde. `totalChecked` 1000
// diyor, kullanici 1500 yapistirdigini biliyor ama arayuzde hicbir uyari yok — sonuc
// "demek ki hepsi bulundu" diye okunuyordu. Denetim modulundeki B4 ile AYNI aile:
// hata vermeden veri kaybetmek.
//
// Sinirin KENDISI dogru (MSSQL tek ifadede 2100 parametre kabul eder, 1000 guvenli
// tarafta); sorun sessiz olmasiydi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const API = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'api', 'selfServiceApi.ts'), 'utf8'
);

test('sinir tek yerde tanimli (iki ucta ayrisamaz)', () => {
  assert.match(SRC, /const MAX_CHECK_ITEMS = 1000;/);
  assert.ok(!/length >= 1000\) break;/.test(SRC), 'sessizce kesen eski dongu duruyor');
});

test('kesilen girdi sayisi YANITTA doner — her iki ucta da', () => {
  assert.match(SRC, /truncated: ipsTruncated,/);
  assert.match(SRC, /truncated: itemsTruncated,/);
  const maxItems = (SRC.match(/maxItems: MAX_CHECK_ITEMS,/g) || []).length;
  assert.equal(maxItems, 2, 'iki uc de sinirin ne oldugunu soylemeli');
});

test('sinir MSSQL parametre tavaninin ALTINDA', () => {
  // `openshift-check` ayni parametreleri IKI kolona karsi kullaniyor ama adlandirilmis
  // parametreler TEKRAR SAYILMAZ; yine de tavana yaklasmamak icin genis pay birakilir.
  const m = SRC.match(/const MAX_CHECK_ITEMS = (\d+);/);
  assert.ok(m, 'sinir okunamadi');
  assert.ok(Number(m[1]) <= 2000, `sinir MSSQL 2100 parametre tavanina cok yakin: ${m[1]}`);
});

test('istemci tipi kesme bilgisini TASIYOR', () => {
  assert.match(API, /truncated\?: number; maxItems\?: number;/);
});

test('arayuz kesmeyi GORUNUR kiliyor', () => {
  for (const f of ['IpCheckSection.tsx', 'OpenshiftCheckSection.tsx']) {
    const ui = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'components', 'self_service', f), 'utf8'
    );
    assert.match(ui, /summary\.truncated \?/, `${f}: kesme kullaniciya gosterilmiyor`);
    assert.match(ui, /DEĞERLENDİRİLMEDİ/, `${f}: uyari metni yok`);
  }
});

test('mutasyonlar admin kapisindan geciyor, salt-okunur sorgular MUAF', () => {
  // /ip-check ve /openshift-check POST ama gercek bir MUTASYON DEGIL — muafiyet
  // BILINCLI. Muafiyetin yanlislikla baska uclara genislemesine karsi bekci.
  const m = SRC.match(/if \(req\.path === "([^"]+)" \|\| req\.path === "([^"]+)"\) return next\(\);/);
  assert.ok(m, 'admin-gate muafiyeti bulunamadi');
  assert.deepEqual([m[1], m[2]].sort(), ['/ip-check', '/openshift-check']);
  assert.match(SRC, /return requireAdmin\(req, res, next\);/);
});
