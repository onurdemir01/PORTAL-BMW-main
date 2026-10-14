// src/__tests__/double-submit-guard.test.cjs — H1/H2: cift tetikleme ve bayat yanit.
//
// H1 · `busy` bir React STATE'idir: degeri render sirasinda YAKALANIR, `setBusy(true)`
//      ise ASENKRON uygulanir. Ayni tick icindeki iki tik (cift tiklama, yavas agda
//      sabirsiz kullanici, tus+fare) ikisi de `busy === false` gorur ve IKI AWX JOB'I
//      birden acilabilir. Bu, prod'da AYNI islemin iki kez kosmasi demektir.
//      LogX'te bu bilincli olarak ref'e cevrilmisti; desen diger UC sihirbaza tasindi.
//
// H2 · `clearInterval` yalnizca GELECEK tick'leri durdurur; O ANDA UCUSTA olan istek
//      agdan donmeye devam eder ve `.then` govdesi yine calisir — unmount SONRASI
//      setState, ya da yeni bir akista ESKI yanitin taze ekrani EZMESI.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Dort sihirbaz da GERCEK altyapi isi tetikliyor: AWX job'i, OCP'de gecici pod,
// restart/dump, dosya taramasi. Cift tetiklemenin bedeli gercek.
const WIZARDS = [
  { file: 'components/logx_v2/LogXWizardPage.tsx', ref: 'busyRef' },
  { file: 'components/telnet/TelnetWizardPage.tsx', ref: 'busyRef' },
  { file: 'components/opsx/OpsXWizardPage.tsx', ref: 'busyRef' },
  { file: 'components/filex/FileXWizardPage.tsx', ref: 'busyRef' },
  { file: 'components/SelfServicePage.tsx', ref: 'launchingRef' },
];

for (const w of WIZARDS) {
  test(`H1: ${path.basename(w.file)} ref tabanli guard kullaniyor`, () => {
    const src = read(w.file);
    // LogX `React.useRef`, digerleri cikarilmis `useRef` kullaniyor — ikisi de gecerli.
    assert.match(
      src,
      new RegExp(`const ${w.ref} = (React\\.)?useRef\\(false\\)`),
      `${w.ref} yok — ayni tick’teki iki tik iki AWX job’i acabilir`,
    );
    assert.match(src, new RegExp(`if \\(${w.ref}\\.current\\) return;`));
    assert.match(src, new RegExp(`${w.ref}\\.current = true;`));
    assert.match(
      src,
      new RegExp(`${w.ref}\\.current = false;`),
      'guard hic birakilmiyor — sayfa kilitlenir',
    );
  });
}

test('H1: state tabanli eski guard hicbir sihirbazda kalmadi', () => {
  const offenders = [];
  for (const w of WIZARDS) {
    const src = read(w.file);
    // `if (busy) return;` HEMEN ARDINDAN `setBusy(true)` — tam olarak yarisan kalip.
    if (/if \(busy\) return;\s*\n\s*setBusy\(true\);/.test(src)) offenders.push(w.file);
    if (/if \(launching\) return;\s*\n\s*setLaunching\(true\);/.test(src)) offenders.push(w.file);
  }
  assert.deepEqual(offenders, [], `state tabanli guard duruyor: ${offenders.join(', ')}`);
});

test('H2: FileX poll’u bayat yaniti ATIYOR (unmount + yeniden baslatma)', () => {
  const src = read('components/filex/FileXWizardPage.tsx');
  assert.match(src, /const runIdRef = useRef\(0\);/, 'calistirma kusagi yok');
  // Unmount: ucustaki yanitlar gecersiz kilinmali.
  // BICIM DEGIL KURAL. Onceki desen `useEffect(() => () => {` ifadesini TEK SATIR
  // bekliyordu; dosya prettier'a girince cagri satirlara boluundu ve bekci DAVRANIS
  // AYNEN dururken kirmiziya dondu. Bosluklar tekillestirilip aranir.
  assert.match(
    src.replace(/\s+/g, ' '),
    /useEffect\( *\(\) => \(\) => \{ runIdRef\.current \+= 1;/,
    'unmount’ta kusak artirilmiyor — unmount sonrasi setState',
  );
  // Yeniden baslatma: eski akisin gec gelen yaniti yeni ekrani EZMEMELI.
  assert.match(src, /runIdRef\.current \+= 1;\s*\/\/ eski akışın/);
  // Hem basari hem hata yolunda kontrol edilmeli.
  const checks = (src.match(/if \(myRun !== runIdRef\.current\) return;/g) || []).length;
  assert.equal(checks, 2, 'kusak kontrolu hem then hem catch yolunda olmali');
});

test('H2: interval her cikis yolunda temizleniyor', () => {
  const src = read('components/filex/FileXWizardPage.tsx');
  // CIKISLAR TEK YARDIMCIDA (2026-10-14, `kapat`). Yoklama dort yerden cikiyor (sunucu
  // hatasi, is basarisiz, sonuc, istisna); her biri ayri ayri temizlik yaziyordu ve sayim
  // bekcisi "en az 4 clearInterval" diyordu. Artik interval UC yerde temizlenir —
  // unmount, yeniden baslatma, `kapat` — ve olcut, yoklamanin HER cikisinin `kapat`tan
  // gecmesi.
  const clears = (src.match(/clearInterval\(pollRef\.current\)/g) || []).length;
  assert.ok(clears >= 3, `clearInterval cagrisi az (${clears}) — bir cikis yolu sizdiriyor olabilir`);
  const kapatGovde = src.slice(src.indexOf('const kapat = ('), src.indexOf('pollRef.current = setInterval('));
  assert.match(kapatGovde, /clearInterval\(pollRef\.current\)/, '`kapat` interval`i temizlemiyor');
  const yoklama = src.slice(
    src.indexOf('pollRef.current = setInterval('),
    src.indexOf('}, POLL_INTERVAL_MS);'),
  );
  assert.ok(yoklama.length > 200, 'yoklama govdesi bulunamadi');
  const cikislar = (yoklama.match(/\bkapat\(/g) || []).length;
  assert.ok(cikislar >= 4, `yoklamanin ${cikislar} cikisi \`kapat\`tan geciyor (en az 4 bekleniyor)`);
  // `kapat`tan gecmeden ekran degistiren cikis yok: tek dogrudan adim, `kapat(null)`dan
  // hemen sonra gelen sonuc ekrani.
  assert.deepEqual(yoklama.match(/setStep\('\w+'\)/g) || [], ["setStep('result')"]);
  assert.match(yoklama, /kapat\(null\);\s*setResult\(s\.result\);\s*setStep\('result'\);/);
});
