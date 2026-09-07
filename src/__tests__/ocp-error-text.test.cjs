// src/__tests__/ocp-error-text.test.cjs — `oc` hatalarinin insan diline cevrilmesi.
//
// NEDEN VAR (uretim, AWX #3296360/#3296365/#3296411 — 2026-09-06): LogX'in OCP
// tarafi uc ayri iste su duvari basiyordu ve kullanici uc kez ayni seyi gordu:
//
//   Error in configuration: Missing or incomplete configuration info.
//   Please login or point to an existing, complete config file ... ~/.kube/config
//
// Bu mesaj GERCEK HATANIN IKI ADIM SONRASININ belirtisiydi: kimlik dosyasi
// bulunamadigi icin parola bos kalmis, `oc login` sessizce patlamis, bir sonraki
// `oc` cagrisi da dogal olarak kubeconfig'ten sikayet etmisti. Ekran, kullaniciyi
// YAPACAK HICBIR SEYIN OLMADIGI bir yere (`~/.kube/config`) yonlendiriyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// GERCEK kaynagi derleyip CALISTIRIR — kopyasini degil (survey-suggestions deseni).
function load(rel) {
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}

const { humanizeOcpError } = load('utils/ocpError.ts');

test('OE1 kubeconfig duvari kullaniciyi YANLIS YERE yonlendirmez', () => {
  const raw =
    'Error in configuration: Missing or incomplete configuration info. Please login or ' +
    'point to an existing, complete config file:\n  1. Via the command-line flag --config';
  const h = humanizeOcpError(raw);
  assert.ok(h.translated, 'uretimde gorulen mesaj cevrilmiyor');
  // Kullaniciya kubeconfig aramasi SOYLENMEMELI — onun elinde degil.
  assert.doesNotMatch(
    h.text,
    /kube\/config|--config|KUBECONFIG/,
    'kullanici hala kubeconfig ariyor',
  );
  assert.match(h.text, /kimlik/i, 'gercek sebep (kimlik cozulemedi) soylenmiyor');
  // Ham metin KAYBOLMAZ: operasyon ekibi onu okuyabilmeli.
  assert.equal(h.raw, raw);
});

test('OE2 LOGIN_FAILED onekinin ARKASINDAKI gercek sebep okunur', () => {
  const a = humanizeOcpError('LOGIN_FAILED: error: Login failed (401 Unauthorized)');
  assert.match(a.text, /401|reddedildi/i, '401 ayirt edilmiyor');

  const b = humanizeOcpError('LOGIN_FAILED: dial tcp 10.0.0.1:6443: connect: connection refused');
  assert.match(b.text, /ulasilamadi|ağ|ag/i, 'ag hatasi ayirt edilmiyor');
  assert.doesNotMatch(b.text, /401/, 'ag hatasi kimlik hatasi gibi gosteriliyor');

  const c = humanizeOcpError('LOGIN_FAILED: x509: certificate signed by unknown authority');
  assert.match(c.text, /sertifika/i, 'sertifika hatasi ayirt edilmiyor');
});

test('OE3 ESLESMEYEN metin AYNEN gecer — ceviri uydurmaz', () => {
  const raw = 'some completely unknown failure from oc';
  const h = humanizeOcpError(raw);
  assert.equal(h.text, raw, 'bilinmeyen hata degistirilmis');
  assert.equal(h.translated, false, 'bilinmeyen hata "cevrildi" sayiliyor');
});

test('OE4 bos girdi cokmez', () => {
  for (const v of [null, undefined, '', '   ']) {
    const h = humanizeOcpError(v);
    assert.equal(typeof h.text, 'string');
    assert.ok(h.text.length > 0, 'bos hata metni uretiliyor');
  }
});

test('OE5 yetki hatasi kimlik hatasindan AYRI cumle uretir', () => {
  const forbidden = humanizeOcpError('Error from server (Forbidden): pods is forbidden');
  assert.match(forbidden.text, /yetki/i, 'yetki hatasi ayirt edilmiyor');
  // Yetki hatasi "kimlik cozulemedi" ile karistirilirsa yonetici yanlis seyi duzeltir.
  assert.doesNotMatch(forbidden.text, /kimlik bilgisi cozulemedi/i);
});
