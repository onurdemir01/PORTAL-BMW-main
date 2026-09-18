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

// ── VT1 YENIDEN YAZILDI: ELLE REGEX YERINE TARAMA + DAVRANIS ───────────────
//
// ESKI VT1 "varsayilan HER YERDE 300" diyordu ve YESILDI; ama uretimde (2026-09-18,
// isler #3329581/#3329638/#3329647/#3329656/#3329662) ScaleX TAMAMEN kapaliydi ve
// dort ayri '60' kalintisi hayattaydi. Sebep: elle yazilmis dort regex.
//
//   * `verificationTimeout:` NESNE-OZELLIK yazimini ariyordu; `/run`daki
//     `const verificationTimeout = ... ?? '60'` (= yazimi) suzgecten gecti —
//     ustelik ISI GERCEKTEN BASLATAN uc orasi.
//   * `useState(...)` baslangicini ariyordu; `setVerificationTimeout('60')`
//     sifirlama cagrisini gormedi.
//   * `String(launch.VERIFICATION_TIMEOUT_DEFAULT)` metnini KILITLIYORDU —
//     oysa o ad #102'de silinmisti. Bekci OLU BIR ADI koruyordu ve dogru
//     duzeltmeyi yapanin testi kirmizi olacakti.
//
// Yeni olcut: "bir sabiti bir yerde dogrula" degil, "bu sayiyi TUTAN HER YERI tara".
function timeoutLiterals(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split('\n');
  const out = [];
  // YORUM VE DUZYAZI ELENIR — ikisi de sayi tasiyor ama KOD DEGIL.
  //   * `/**` ile baslayan JSDoc satiri ilk yazimda elenmiyordu ve
  //     `"90" -> "1 dk 30 sn"` ornegi yanlis alarm uretti.
  //   * Survey JSON'unun `question_description` alanlari tarih ve HTTP kodu
  //     iceriyor ("2026-09-18", "400") — bunlar ayar degil, aciklama.
  const duzyazi = (l) =>
    /^\s*(\/\/|#|\*|\/\*)/.test(l) || /"(question_description|question_name)"/.test(l);
  lines.forEach((line, n) => {
    if (duzyazi(line)) return;
    // BUYUK/KUCUK HARF DUYARSIZ. Duyarli desen `setVerificationTimeout('60')`
    // yazimini kaciriyordu — tam da PR #98'in regresyonunu ureten yazim.
    if (!/verification_?timeout|verify_(warn|fail)_seconds|timeout_(default|min|max)/i.test(line))
      return;
    // KAYAN PENCERE: anahtar kelime satiri + SONRAKI IKI satir. Tek satira bagli
    // tarama `?? \n '60';` gibi satira bolunmus bir varsayilani KACIRIYORDU
    // (prettier ya da elle bolme yeter).
    for (let k = n; k < Math.min(n + 3, lines.length); k++) {
      const l = lines[k];
      if (k > n && duzyazi(l)) continue;
      for (const m of l.matchAll(/['"`](\d{1,5})['"`]|\b(?<!\.)(\d{2,5})\b/g)) {
        const v = m[1] || m[2];
        if (v) out.push({ rel, line: k + 1, value: v, text: l.trim().slice(0, 100) });
      }
    }
  });
  // Ayni satir birden cok pencereye girebilir — tekille.
  const seen = new Set();
  return out.filter((h) => {
    const k = `${h.line}:${h.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

test('VT1 sure sabiti TUTAN HER YERDE 300 (tarama, elle regex degil)', () => {
  // DOSYA BAZLI IZIN. Duz bir kume (`{300,30,3600,86400}`) cok genisti:
  // `index.cjs`e `'30'` ya da `'3600'` yazmak GECIYORDU — uretimdeki `'60'`
  // hatasiyla ayni siniftan bir regresyon. Sunucu uclarinda ve sihirbaz
  // sayfasinda TEK MESRU sabit 300'dur; aralik sinirlari yalnizca sinirlarin
  // TANIMLANDIGI dosyalarda gorunmeli.
  const SCANNED = {
    'server/scalex/index.cjs': { izin: new Set(['300']), enAz: 0 },
    'server/scalex/launch.cjs': { izin: new Set(['300']), enAz: 0 },
    'src/components/scalex/ScaleXPage.tsx': { izin: new Set(['300']), enAz: 0 },
    'server/scalex/config.cjs': { izin: new Set(['300', '30', '3600', '86400', '20']), enAz: 6 },
    'src/components/scalex/steps/OperationStep.tsx': { izin: new Set(['300', '30', '3600']), enAz: 3 },
    'src/hooks/useScaleXLimits.ts': { izin: new Set(['300', '30', '3600']), enAz: 0 },
    'server/ansible/bmw_portal/scalex/scalex_app/tasks/01_prepare.yml': {
      izin: new Set(['300', '86400']), enAz: 4,
    },
  };

  const bad = [];
  for (const [rel, kural] of Object.entries(SCANNED)) {
    const hits = timeoutLiterals(rel);
    // ALT SINIR DOSYA BASINA. Toplam sinir (>= 8) zayifti: `index.cjs` ve
    // `launch.cjs` taramadan tamamen dusse toplam yine tutuyordu.
    assert.ok(
      hits.length >= kural.enAz,
      `${rel}: toplayici ${hits.length} sabit gordu, en az ${kural.enAz} bekleniyor — desen bozulmus`,
    );
    for (const hit of hits) {
      if (!kural.izin.has(hit.value)) bad.push(`${hit.rel}:${hit.line} -> "${hit.value}"  ${hit.text}`);
    }
  }
  assert.deepEqual(bad, [], `sure satirinda beklenmeyen sabit:\n  ${bad.join('\n  ')}`);

  const runner = fs.readFileSync(RUNNER, 'utf8');
  assert.match(runner, /VERIFY_WARN_SECONDS:-300/, 'betik varsayilani 300 degil');
  const cfg = fs.readFileSync(path.join(ROOT, 'server/scalex/config.cjs'), 'utf8');
  assert.match(cfg, /SCALEX_VERIFY_TIMEOUT_DEFAULT: \{ fallback: 300/, 'fabrika varsayilani 300 degil');
  const launch = fs.readFileSync(path.join(ROOT, 'server/scalex/launch.cjs'), 'utf8');
  assert.doesNotMatch(launch, /VERIFICATION_TIMEOUTS/, 'eski onayarli liste geri gelmis');

  // SURVEY YAPISAL OKUNUR, SATIR TARANMAZ. JSON'da anahtar satiri (`"variable"`)
  // `min`/`max`/`default`tan SONRA geliyor; ileri bakan pencere onlari kaciriyordu
  // ve "0 sabit gorduм" diye yanlis alarm uretiyordu. JSON'u ayristirmak hem dogru
  // hem kirilmaz. (Sinirlarin PORTALIN uretebilecegi degerleri kapsamasi ayrica
  // S10 tarafindan kilitleniyor — burada yalnizca VARSAYILANLAR.)
  const survey = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'server/ansible/bmw_portal/scalex/awx/scalex_run.survey.json'), 'utf8',
    ),
  );
  const soru = (v) => survey.spec.find((q) => q.variable === v);
  assert.equal(soru('verification_timeout').default, 300, 'survey butce varsayilani 300 degil');
  assert.equal(soru('verify_warn_seconds').default, 300, 'survey uyari varsayilani 300 degil');
  assert.equal(
    soru('verify_fail_seconds').default,
    300 * 2,
    'survey fail varsayilani, butce x fabrika carpani ile ayrismis',
  );
});

// VT1b — KAYNAK METNI DEGIL, GERCEK MODULU SOR. Eski bekci silinmis bir
// tanimlayiciyi metin olarak kilitliyordu; `require` bunu YAPAMAZ.
test('VT1b `/preview` yedegi GERCEKTEN var olan bir disa acilimi kullaniyor', () => {
  const launch = require(path.join(ROOT, 'server/scalex/launch.cjs'));
  // YORUM SATIRLARI ELENIR. Ilk yazimimda elemiyordum ve test KENDI aciklamamda
  // gecen `launch.VERIFICATION_TIMEOUT_DEFAULT` metnini yakalayip kirmizi dondu —
  // bu dosyanin defalarca kaydettigi "kendi doc-comment'ini eslestirme" korlugu.
  const server = fs
    .readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  // `require('./launch.cjs')` de eslesiyor — dosya uzantisi bir disa acilim degil.
  const used = [...server.matchAll(/launch\.([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((m) => m[1])
    .filter((n) => n !== 'cjs');
  const missing = [...new Set(used)].filter((n) => launch[n] === undefined);
  assert.deepEqual(missing, [], `index.cjs olmayan disa acilim(lar)i cagiriyor: ${missing.join(', ')}`);
  assert.equal(typeof launch.verifyTimeoutDefault, 'function', 'varsayilan getter degil');
  assert.equal(launch.verifyTimeoutDefault(), 300);

  // DAVRANISSAL CAPA — "var mi" yetmiyor, "DOGRUSU mu" da sorulmali.
  // `launch.verifyTimeoutMin()` VAR OLAN ama YANLIS bir getter (30 doner); yalnizca
  // varlik kontrolu yapan bir bekci onu da gecirirdi. Uc yerin de ayni degeri
  // uretmesi GERCEKTEN olculur.
  const kaynak = fs.readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8');
  const cagrilar = [...kaynak.matchAll(/verificationTimeout[^\n]*launch\.(\w+)\(\)/g)].map(
    (m) => m[1],
  );
  assert.ok(cagrilar.length >= 3, `sure yedegi yalnizca ${cagrilar.length} yerde — desen bozulmus`);
  for (const ad of new Set(cagrilar)) {
    assert.equal(
      launch[ad](),
      300,
      `index.cjs \`launch.${ad}()\` kullaniyor ama o ${launch[ad]()} donduruyor — varsayilan 300 olmali`,
    );
  }
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

// ── VT8 — URETIMDE YASANAN HATANIN BIREBIR TESTI ───────────────────────────
//
// 2026-09-18: ScaleX'in TAMAMI kapaliydi. `01_prepare.yml:79` varsayilani '300'
// yapiyordu, `:134` ise yalnizca ['30','60','120'] kabul ediyordu. Her is
// `Validate inputs`ta oldu ve kullaniciya "Survey, credential veya mail ayarlari
// eksik/gecersiz." dendi — tamamen yanlis bir sebep.
//
// Bu test GORVEV DOSYASINI GERCEKTEN KOSTURUR. Kaynak taramasi bu sinifi
// goremez: sabit liste dogru yazilmis olabilir ama VARSAYILANLA celisebilir.
// `--syntax-check` de goremez (YAML gecerli, assert calisma aninda degerlenir).
const { spawnSync: _spawn } = require('node:child_process');
const HAS_ANSIBLE = _spawn('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

// CI'DA ATLAMA SESSIZ OLMASIN.
//
// VT8 ailesi 2026-09-18 uretim arizasinin (butce 300 -> "Validate inputs"ta olum)
// TEK davranissal testi. `{ skip: !HAS_ANSIBLE }` ile, ansible kurulu olmayan bir
// makinede sessizce atlaniyor — ve `Jenkinsfile` yalnizca `nodejs 'node20'`
// tanimliyor, ansible KURMUYOR. Yani bu uc test CI'da HIC kosmuyordu ve suit yine
// yesil donuyordu: bu deponun tam da kovaladigi "yesil ama kosmayan bekci" sinifi.
//
// Gelistirici makinesinde ansible yoksa atlamak makul (herkes ansible kurmak
// zorunda degil); CI'da atlamak DEGIL. `CI=true` iken eksiklik HATA olur.
test('VT0 CI`da ansible KURULU (VT8 ailesi sessizce atlanmasin)', () => {
  if (process.env.CI !== 'true') return; // yerelde bilgi amacli, kapi degil
  assert.ok(
    HAS_ANSIBLE,
    'CI=true ama `ansible-playbook` yok — VT8/VT8b/VT8c atlanir ve uretim ' +
      'arizasinin tek davranissal testi kosmaz. Jenkinsfile Install asamasina ' +
      'ansible kurulumu ekleyin.',
  );
});

/** `01_prepare.yml`i verilen sure ile kosturur; {ok, msg} doner. */
function prepareWith(timeout) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-vt8-'));
  try {
    const play = path.join(tmp, 'p.yml');
    fs.writeFileSync(
      play,
      [
        '---',
        '- hosts: localhost',
        '  gather_facts: false',
        '  vars:',
        '    scalex_clusters_override: {version: 1, clusters: {c1: {api_url: "https://a", credential: k, enabled: true, environments: [test], jump_server: j, platform: ark}}}',
        '    target_platform: ark',
        '    target_environment: test',
        '    target_namespace: ns1',
        '    target_app_names: app1',
        '    operation_action: stop',
        '    execution_mode: dry_run',
        '    scalex_cluster_mode: all',
        `    verification_timeout: "${timeout}"`,
        '    username: uxmid',
        '    smtp_host: smtp.x',
        '    smtp_port: 25',
        '    mail_from: a@b.c',
        '    mail_subject_prefix: "[X]"',
        '    mail_to: a@b.c',
        '    awx_job_id: "1"',
        '  tasks:',
        '    - block:',
        `        - ansible.builtin.include_tasks: ${path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/tasks/01_prepare.yml')}`,
        '      rescue:',
        '        - ansible.builtin.debug: { msg: "PREPARE_FAILED: {{ ansible_failed_result.msg | default(\'?\') }}" }',
      ].join('\n'),
    );
    const r = _spawn('ansible-playbook', [play], {
      encoding: 'utf8',
      env: { ...process.env, ANSIBLE_LOCALHOST_WARNING: 'False' },
    });
    const out = r.stdout || '';
    const m = out.match(/PREPARE_FAILED: (.*?)"/);
    return { ok: !m, msg: m ? m[1] : '', out };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('VT8 varsayilan 300 sn playbook dogrulamasindan GECIYOR', { skip: !HAS_ANSIBLE }, () => {
  const r = prepareWith('300');
  assert.ok(
    r.ok,
    `300 sn REDDEDILDI — uretimdeki hata geri geldi. Mesaj: ${r.msg}\n${r.out.slice(-1200)}`,
  );
});

test('VT8b gecersiz sure REDDEDILIYOR ve sebep DOGRU yazi', { skip: !HAS_ANSIBLE }, () => {
  // `'abc'` ve `'300abc'` REGEX OLMADAN DA reddedilir: Jinja `| int` donusturemezse
  // 0 verir (shell gibi KIRPMAZ) ve `>= 1` kosuluna takilir. Yani bu iki deger
  // regex satirini KORUMUYOR — olculdu:
  //     '300.5' | int = 300      is match = false
  //     '1e3'   | int = 1000     is match = false
  // Regex satirinin TEK gercek katkisi bunlari kesmek. Ilk yazimda VT8b ikisini de
  // denemiyordu, yani `is match('^[0-9]+$')` satirini SILMEK hicbir testi kirmiyordu.
  for (const kotu of ['abc', '300abc', '300.5', '1e3', '-5', '']) {
    const r = prepareWith(kotu);
    assert.ok(!r.ok, `gecersiz sure KABUL EDILDI: ${JSON.stringify(kotu)}`);
    assert.match(
      r.msg,
      /Sonuç kontrol süresi geçersiz/,
      `sure hatasi "mail ayarlari" diye raporlaniyor — uretimde teshisi imkansiz kilan buydu: ${r.msg}`,
    );
  }
});

// VT8d — YAPISAL CAPA. VT8 yalnizca POZITIF ("300 geciyor mu") oldugu icin assert
// gorevini TAMAMEN SILMEK onu kirmiyordu: gorev yoksa 300 zaten gecer.
test('VT8d dogrulama gorevi VAR ve uc butce degiskenini de kontrol ediyor', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/tasks/01_prepare.yml'), 'utf8',
  );
  assert.match(src, /- name: "Validate verification budget"/, 'dogrulama gorevi YOK');
  const blok = src.slice(src.indexOf('- name: "Validate verification budget"'));
  const govde = blok.slice(0, blok.indexOf('\n- name:'));
  // BETIGE GIDEN UC DEGER: butce + uyari + fail. Ucu de dogrulanmali; `verify_*`
  // ikisi dogrulanmazsa `verify_replicas` karsilastirmasi sessizce yanlis sayilir
  // ve KAPATMANIN FAIL ESIGI hic ateslenmez (betik `set -e` ile kosmuyor).
  for (const v of [
    'verification_timeout_effective',
    'verify_warn_seconds_effective',
    'verify_fail_seconds_effective',
  ]) {
    assert.ok(govde.includes(`${v} is match`), `${v} icin regex kontrolu yok`);
    assert.ok(govde.includes(`${v} | int >= 1`), `${v} icin alt sinir yok`);
    assert.ok(govde.includes(`${v} | int <= 86400`), `${v} icin ust sinir yok`);
  }
});

test('VT8c mutlak sinir disi sure REDDEDILIYOR', { skip: !HAS_ANSIBLE }, () => {
  assert.ok(!prepareWith('999999').ok, 'mutlak tavan disi deger kabul edildi');
});

// ── VT9 — BETIK TARAFINDAKI BUTCE DOGRULAMASI ──────────────────────────────
//
// Mutasyon turunda betikten `VERIFY_*_SECONDS` dogrulamasini SILMEK hicbir bekciyi
// kirmadi: VT8d yalnizca PLAYBOOK tarafina bakiyor. Oysa betik AWX'ten ELLE de
// calistirilabilir (survey doldurularak, playbook dogrulamasi ayni olsa da bu
// ikinci kemer bilerek var) ve `set -e` YOK — sayisal olmayan bir esikte
// `[ "$elapsed" -ge "$VERIFY_FAIL_SECONDS" ]` rc=2 verir, kosul SESSIZCE yanlis
// sayilir ve KAPATMANIN FAIL ESIGI hic ateslenmez.
//
// Dogrulama blogu `awk` ile cikarilip GERCEKTEN kosturulur — kaynak taramasi degil.
function butceDogrula(warn, fail) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-vt9-'));
  try {
    const h = path.join(tmp, 'h.sh');
    fs.writeFileSync(
      h,
      [
        '#!/bin/bash',
        'set -u',
        'CLUSTER=c1; JUMP_SERVER=j1',
        "log() { printf '%s;%s;%s;%s;%s;%s;%s\\n' \"$1\" \"$2\" \"$3\" \"$4\" \"$5\" \"$6\" \"$7\"; }",
        `VERIFY_WARN_SECONDS="${warn}"`,
        `VERIFY_FAIL_SECONDS="${fail}"`,
        // Yalnizca VERIFY_* dogrulama blogunu cikar (yorumlar dahil degil).
        `eval "$(awk '/^if ! printf .%s. "\\$VERIFY_WARN_SECONDS"/,/^fi$/' "$1")"`,
        'echo "GECTI"',
      ].join('\n'),
      { mode: 0o755 },
    );
    const r = _spawn('bash', [h, RUNNER], { encoding: 'utf8' });
    return r.stdout || '';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('VT9 betik, sayisal olmayan butceyi INPUT;FAIL ile REDDEDIYOR', () => {
  const iyi = butceDogrula('300', '600');
  assert.match(iyi, /GECTI/, 'gecerli butce reddedildi');
  assert.doesNotMatch(iyi, /INPUT;FAIL/, 'gecerli butce icin FAIL basildi');

  for (const [w, f] of [
    ['abc', '600'],
    ['300', 'abc'],
    ['0', '600'],
    ['300', '0'],
    ['', '600'],
    ['-5', '600'],
  ]) {
    const out = butceDogrula(w, f);
    assert.match(
      out,
      /INPUT;FAIL;Invalid verification budget/,
      `gecersiz butce KABUL EDILDI: warn=${JSON.stringify(w)} fail=${JSON.stringify(f)} -> ${out.trim()}`,
    );
    assert.doesNotMatch(out, /GECTI/, 'gecersiz butcede betik devam etti (exit 0 beklenir)');
  }
});
