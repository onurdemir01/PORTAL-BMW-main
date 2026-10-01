// src/__tests__/logx-sihirbaz-kurtarma.test.cjs
//
// LogX SİHİRBAZI KURTARMA YOLLARI (2026-10-02). Bileşen düzeyindeki davranışlar
// LogXSihirbaz.test.tsx'te RENDER edilerek kanıtlanır; burada LogXWizardPage'in o
// parçaları DOĞRU YERLERE BAĞLADIĞI kilitlenir (sayfa çok bağımlılıklı, bütünüyle
// render etmek kırılgan olurdu).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n');
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');
const PAGE = norm(
  codeOnly(
    fs.readFileSync(path.join(__dirname, '..', 'components/logx_v2/LogXWizardPage.tsx'), 'utf8'),
  ),
);

test('K1 her is adimi yoklama dustugunde kurtarma kartini gosterir (sonsuz spinner yok)', () => {
  const ilerleme = (PAGE.match(/<JobProgress /g) || []).length;
  assert.ok(ilerleme >= 5, `JobProgress sayisi beklenenden az: ${ilerleme}`);
  const kart = (PAGE.match(/if \(jobPollError\) \{ return \( <JobPollErrorCard/g) || []).length;
  assert.equal(kart, ilerleme, 'bir is adiminda kurtarma karti yok');
  // Hepsi ortak isleyiciye bagli; o da poll hatasini isaretliyor ve refresh hatasini yakaliyor.
  assert.equal((PAGE.match(/jobBitti\(r\)|onDone=\{jobBitti\}/g) || []).length, ilerleme);
  assert.match(PAGE, /if \(r\.status === "error" && !r\.artifacts\) \{ setJobPollError\(/);
  assert.match(PAGE, /refresh\(requestId\)\.catch\(\(\) => \{\}\)/);
});

test('K2 "Sunucu secimine don": Geri dugmesi, dosya ekrani ve hata ekrani ayni yolu kullanir', () => {
  assert.match(
    PAGE,
    /if \(currentStep === "legacy_file_select"\) \{ await backToHosts\(\); return; \}/,
  );
  assert.match(PAGE, /onBackToHosts=\{\(\) => void backToHosts\(\)\}/);
  assert.match(PAGE, /onBackToHosts=\{ request\?\.platform === "legacy" &&[\s\S]{0,160}?\? \(\) => void backToHosts\(\) : undefined \}/);
  // Degerler istek kaydindan geri yuklenir.
  assert.match(PAGE, /if \(app\) setLegacyApp\(app\); setLegacyManual\(elle\);/);
  assert.match(PAGE, /initialManual=\{legacyManual\}/);
});

test('K3 suresi dolmus / arsivsiz ready istek platform adimina dusmez', () => {
  assert.match(
    PAGE,
    /else if \(request\.state === "expired" \|\| request\.state === "ready"\) step = "expired";/,
  );
  assert.match(PAGE, /\{step === "expired" && \(/);
});
