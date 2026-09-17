// server/ansible/__tests__/scalex-verify-timing.test.cjs
// SCALEX DOGRULAMA SURELERI — ACMA ve KAPATMA ARTIK AYNI SEY DEGIL.
//
// KULLANICI KARARI (2026-09-17):
//   ACMA  (target > 0): 5 dk dolunca BEKLEMEYI BIRAK, UYARI yaz, is BASARILI bitsin.
//   KAPATMA (target = 0): 5 dk'da UYARI yaz ama BEKLEMEYE DEVAM; 10 dk'da FAIL.
//
// BU TESTLER BETIGI GERCEKTEN KOSTURUR. Kaynak taramak yetmez: karar tablosu bes
// dalli ve biri yanlis yazilirsa hicbir sey patlamaz — yalnizca uretimde yanlis
// satir gorunur ("FAIL" derken islem calisiyordur, ya da "OK" derken pod hazir
// degildir).
//
// OLCULEN BIR SEY DAHA: deneme basina `oc` cagrisi. Butce 60 sn'den 300 sn'ye
// cikarildi; eski dongu deneme basina UC cagri yapiyordu (spec/status/ready ayri
// ayri), yani 450 cagri/uygulama olurdu. Tek jsonpath sarttir — VT2 bunu SAYAR.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/files/scalex_runner.sh',
);

/**
 * `verify_replicas`i SAHTE bir `oc` ile calistirir.
 *
 * Betigin tamami login/kesif ister; buraya yalnizca dogrulama dongusu ve
 * bagimliliklari `awk` ile cikarilip `eval` edilir. Boylece olculen sey GERCEK
 * kod olur — kopyasi degil.
 */
function verify({ state, target, warn, fail }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-vt-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const calls = path.join(tmp, 'calls');
    const st = path.join(tmp, 'state');
    fs.writeFileSync(st, state);
    fs.writeFileSync(calls, '');
    fs.writeFileSync(
      path.join(bin, 'oc'),
      '#!/bin/sh\necho "$@" >> "$OC_CALLS"\ncase "$*" in *jsonpath*) cat "$OC_STATE";; *) echo "";; esac\nexit 0\n',
      { mode: 0o755 },
    );
    const harness = path.join(tmp, 'h.sh');
    fs.writeFileSync(
      harness,
      [
        '#!/bin/bash',
        'NS=test-ns; CLUSTER=c1; JUMP_SERVER=j1',
        "log() { printf '%s;%s;%s;%s;%s;%s;%s\\n' \"$1\" \"$2\" \"$3\" \"$4\" \"$5\" \"$6\" \"$7\"; }",
        'oc_get_jsonpath() { oc get "$1" "$2" -n "$NS" -o "jsonpath=$3" 2>/dev/null || true; }',
        `eval "$(awk '/^RV_DESIRED=0; RV_CURRENT=0; RV_READY=0/,/^}$/' "$1" | head -20)"`,
        `eval "$(awk '/^human_seconds\\(\\)/,/^}$/' "$1")"`,
        `eval "$(awk '/^verify_sleep_for\\(\\)/,/^}$/' "$1")"`,
        `eval "$(awk '/^verify_replicas\\(\\)/,/^}$/' "$1")"`,
        'verify_replicas app1 Deployment deploy "$2"',
        'echo "RC=$?"',
      ].join('\n'),
      { mode: 0o755 },
    );
    const out = execFileSync('bash', [harness, RUNNER, String(target)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OC_CALLS: calls,
        OC_STATE: st,
        VERIFY_WARN_SECONDS: String(warn),
        VERIFY_FAIL_SECONDS: String(fail),
      },
    });
    return { out, ocCalls: fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('VT1 varsayilan butce HER YERDE 300 sn (ALTI yer ayrismiyor)', () => {
  const runner = fs.readFileSync(RUNNER, 'utf8');
  const launch = fs.readFileSync(path.join(ROOT, 'server/scalex/launch.cjs'), 'utf8');
  const prepare = fs.readFileSync(
    path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/tasks/01_prepare.yml'), 'utf8',
  );
  const ui = fs.readFileSync(
    path.join(ROOT, 'src/components/scalex/steps/OperationStep.tsx'), 'utf8',
  );
  assert.match(runner, /VERIFY_WARN_SECONDS:-300/, 'betik varsayilani 300 degil');
  assert.match(launch, /VERIFICATION_TIMEOUT_DEFAULT = 300/, 'sunucu varsayilani 300 degil');
  assert.match(prepare, /verification_timeout \| default\('300'\)/, 'playbook varsayilani 300 degil');
  assert.match(ui, /TIMEOUT_DEFAULT = "300"/, 'ekran varsayilani 300 degil');
  // Eski onayarli liste GERI GELMESIN.
  assert.doesNotMatch(launch, /VERIFICATION_TIMEOUTS/, 'eski onayarli liste geri gelmis');

  // ── BU IKI YERI ILK VT1 GORMUYORDU (bekci korlugu, 2026-09-17) ───────────
  // PR #98 `TIMEOUT_DEFAULT`i 300 yapti ve VT1 yesil kaldi; ama sihirbaz sayfasi
  // ELDE yazili '60' tutuyordu ve kullanicinin isi 5 dk yerine 1 dk bekledi (HAR
  // kaniti). Bir sabiti "bir yerde dogru" diye dogrulamak yetmiyor — AYNI SAYIYI
  // TUTAN HER YER kontrol edilmeli.
  const page = fs.readFileSync(
    path.join(ROOT, 'src/components/scalex/ScaleXPage.tsx'), 'utf8',
  );
  assert.match(
    page,
    /useState\(TIMEOUT_DEFAULT\)/,
    'sihirbaz sayfasi varsayilani PAYLASILAN sabitten okumuyor',
  );
  assert.doesNotMatch(
    page,
    /setVerificationTimeout\] = useState\(['"][0-9]+['"]\)/,
    'sihirbaz sayfasi sure varsayilanini ELDE yaziyor — PR #98 regresyonu geri geldi',
  );

  // `/preview` ucunun kendi yedegi de sunucu sabitinden gelmeli; yoksa onizleme
  // bir butce, calistirma baska bir butce gosterir.
  const server = fs.readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8');
  assert.doesNotMatch(
    server,
    /verificationTimeout: req\.body\?\.verificationTimeout \?\? ['"][0-9]+['"]/,
    '/preview yedegi ELDE yazili bir saniye degeri kullaniyor',
  );
  assert.match(
    server,
    /req\.body\?\.verificationTimeout \?\?\s*String\(launch\.VERIFICATION_TIMEOUT_DEFAULT\)/,
    '/preview yedegi sunucu sabitinden gelmiyor',
  );
});

test('VT2 deneme basina TEK `oc` cagrisi (uc alan tek jsonpath)', () => {
  // Hemen basarili olan dal: tam bir deneme = 1 cagri.
  const ok = verify({ state: '0|0|0', target: 0, warn: 2, fail: 4 });
  assert.equal(ok.ocCalls, 1, `basarili dogrulama ${ok.ocCalls} oc cagrisi yapti (1 bekleniyor)`);

  // Bekleyen dal: her deneme +1 olmali, +3 degil.
  const bekleyen = verify({ state: '0|2|2', target: 0, warn: 2, fail: 4 });
  assert.ok(
    bekleyen.ocCalls <= 4,
    `bekleyen dogrulama ${bekleyen.ocCalls} oc cagrisi yapti — deneme basina birden fazla cagri var`,
  );
});

test('VT3 KAPATMA: uyari esiginde BEKLEMEYE DEVAM, fail esiginde FAIL', () => {
  const r = verify({ state: '0|2|2', target: 0, warn: 2, fail: 4 });
  assert.match(r.out, /VERIFY;WARN;scale 0 komutu calisti/, 'uyari satiri yok');
  assert.match(r.out, /beklemeye devam ediliyor/, 'uyaridan sonra beklemeyi birakmis');
  assert.match(r.out, /VERIFY;FAIL/, 'fail esiginde FAIL yok');
  assert.match(r.out, /RC=1/, 'kapatma basarisizken RC 1 degil');
});

test('VT4 ACMA: uyari esiginde BIRAK ve BASARILI don (FAIL YOK)', () => {
  const r = verify({ state: '1|1|0', target: 1, warn: 2, fail: 4 });
  // `applied=yes` MAKINE BELIRTECI uyari metninden ONCE gelir: rapor asamasi
  // hedefi "uygulandi ama hazir degil" diye siniflandirabilsin (bkz.
  // scalex-report-verified.test.cjs). Belirtec olmadan portal bunu geri alma
  // HATASI sayiyordu (2026-09-17, is #3326330).
  assert.match(r.out, /VERIFY;WARN;applied=yes aciliyor, 0\/1/, '"aciliyor, 0/1" uyarisi yok');
  assert.doesNotMatch(r.out, /VERIFY;FAIL/, 'acmada FAIL uretilmis — karar tablosuna aykiri');
  assert.match(r.out, /RC=0/, 'acma uyaridan sonra basarili bitmeli');
});

test('VT5 ACMA olcutu READY (pod ayakta ama hazir degilse OK DEME)', () => {
  // `.status.replicas` pod olusur olusmaz hedefe esitlenir. Olcut buysa "0/1, 5 dk'dir"
  // uyarisi HIC ATESLENEMEZ — bu tam olarak ilk yazimda olan seydi.
  const hazirDegil = verify({ state: '1|1|0', target: 1, warn: 2, fail: 4 });
  assert.doesNotMatch(
    hazirDegil.out, /VERIFY;OK/,
    'pod HAZIR DEGILKEN "OK" dendi — acma olcutu ready yerine status.replicas kullaniyor',
  );
  const hazir = verify({ state: '1|1|1', target: 1, warn: 2, fail: 4 });
  assert.match(hazir.out, /VERIFY;OK/, 'pod hazirken OK donmedi');
  assert.match(hazir.out, /RC=0/);
});

test('VT7 ACMA fail esigine ULASSA BILE fail ETMEZ (fail < warn senaryosu)', () => {
  // MUTASYON TURUNDA CIKTI: "acma da fail etsin" mutasyonu VT4'u GECTI, cunku
  // VT4'te (warn=2, fail=4) acma 2. saniyede uyarip DONUYOR — 4. saniyedeki fail
  // kontrolune hic ulasilmiyor. Mutasyon ERISILEMEZ oldugu icin gorunmuyordu.
  //
  // Burada fail esigi uyaridan ONCE geliyor (fail=2, warn=10): akis fail kontrolunden
  // GECMEK ZORUNDA. Acma yine de FAIL ETMEMELI — karar tablosunda acmanin fail esigi
  // YOKTUR. (Bu ayni zamanda gercek bir yanlis yapilandirmadir: fail < warn.)
  const r = verify({ state: '1|1|0', target: 1, warn: 10, fail: 2 });
  assert.doesNotMatch(
    r.out,
    /VERIFY;FAIL/,
    'acma FAIL etti — fail esigi yalnizca KAPATMADA gecerli olmali',
  );
  assert.match(r.out, /RC=0/, 'acma her kosulda basarili bitmeli');

  // Ayni yapilandirmada KAPATMA fail ETMELI — kontrolun kendisi calisiyor olmali.
  const kapat = verify({ state: '0|2|2', target: 0, warn: 10, fail: 2 });
  assert.match(kapat.out, /VERIFY;FAIL/, 'kapatma fail esigine ulasmadi — test kendi olctugunu kaybetti');
  assert.match(kapat.out, /RC=1/);
});

test('VT6 saniye butcesi SUNUCUDA dogrulaniyor (yalniz ekranda degil)', () => {
  const { normalizeVerificationTimeout } = require('../../scalex/launch.cjs');
  assert.equal(normalizeVerificationTimeout(''), 300, 'bos deger varsayilana dusmeli');
  assert.equal(normalizeVerificationTimeout('300'), 300);
  assert.equal(normalizeVerificationTimeout('45'), 45);
  // Gecersizler SESSIZCE varsayilana DUSMEZ — `null` doner ve cagiran 400 verir.
  for (const kotu of ['0', '29', '3601', 'abc', '-5', '10.5', '99999999']) {
    assert.equal(normalizeVerificationTimeout(kotu), null, `gecersiz deger kabul edildi: ${kotu}`);
  }
});
