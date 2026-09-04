// server/telnet/__tests__/job-ownership.test.cjs — B3: gecmis kaydi tasmasi ve
// bunun ACTIGI IDOR.
//
// ZINCIR (2026-08-28 incelemesi):
//   1. `ansible_job_history.template_name` NVARCHAR(500).
//   2. Openshift dali adi `Telnet: openshift (ns1,ns2,...)` diye kuruyordu; kullanici
//      coklu namespace sectiginde ad 500'u ASIYOR, MSSQL INSERT'i REDDEDIYOR.
//   3. Hata `console.warn` ile YUTULUYOR — istek basariyla donuyor, gecmis satiri YOK.
//   4. job-status ucunun IDOR korumasi TAM DA O SATIRA bakiyor ve satir yoksa
//      GECIRIYORDU (fail-open). Yani "coklu namespace sec" = "koruma kapali".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
// ── BICIM DUYARSIZ OKUMA ────────────────────────────────────────────────────
// Bu bekciler bir KURALI kilitler ("su cagri su argumanlarla yapiliyor"), satir
// duzenini degil. Depoya prettier girdiginde cagrilar cok satira yayildi ve tirnak
// bicimi degisti; kural aynen dururken bekciler KIRMIZI oldu.
//
// `norm()` yalnizca iki seyi normalize eder: ardisik bosluklari tek boslugua indirir
// ve tek tirnagi cift tirnaga cevirir. ANLAM tasiyan hicbir sey silinmez — yanlis
// argumanla yapilan bir cagri hala yakalanir (mutasyonla dogrulandi).
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

// telnetTemplateName saf bir fonksiyon — dosyadan cikarip DAVRANISINI test ediyoruz
// (index.cjs'i require etmek express/DB yuklerdi).
function loadTemplateNamer() {
  const m = SRC.match(
    /const TEMPLATE_NAME_MAX = \d+;[\s\S]*?\nfunction telnetTemplateName\(namespaces\) \{[\s\S]*?\n\}/,
  );
  assert.ok(m, 'telnetTemplateName bulunamadi — kirpma yok, tasma geri gelmis olabilir');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return telnetTemplateName;`)();
}

test('B3: 200 namespace’lik ad NVARCHAR(500) sinirini ASMAZ', () => {
  const namer = loadTemplateNamer();
  const many = Array.from({ length: 200 }, (_, i) => `ns-cok-uzun-isim-${i}`);
  const name = namer(many);
  assert.ok(name.length <= 500, `ad ${name.length} karakter — INSERT reddedilir, gecmis yazilmaz`);
});

test('B3: kirpilan namespace sayisi GIZLENMEZ', () => {
  const namer = loadTemplateNamer();
  const many = Array.from({ length: 200 }, (_, i) => `ns-cok-uzun-isim-${i}`);
  assert.match(namer(many), /\+\d+\)/, 'kac namespace gizlendigi ada yazilmali');
});

test('B3: tek/az namespace’te ad AYNEN korunur', () => {
  const namer = loadTemplateNamer();
  assert.equal(namer(['ark-prod']), 'Telnet: openshift (ark-prod)');
  assert.equal(namer(['a', 'b']), 'Telnet: openshift (a,b)');
});

test('B3: IDOR kontrolu FAIL-CLOSED (kayit yoksa gecirmez)', () => {
  // Hatayi yutup devam eden bos catch: DB tokezlerse koruma tamamen devre disi kalirdi.
  assert.ok(
    !/\} catch \{ \/\* DB hiccup -> fail-open \*\/ \}/.test(SRC),
    'hatayi yutup geciren bos catch duruyor',
  );
  // Sahip DOGRULANAMADIYSA reddedilmeli; "rows.length && ..." kalibi kayit yoksa
  // hicbir sey yapmadan gecirir.
  assert.ok(
    !/if \(rows\.length && rows\[0\]\.username &&/.test(SRC),
    'kayit yoksa gecirenen eski kalip duruyor',
  );
  assert.match(
    SRC,
    /if \(!owner \|\| owner !== me\)/,
    'sahiplik kanitlanmadikca reddeden kontrol yok',
  );
});

test('B3: DB hatasi da REDDE dusurur (503), sessizce gecirmez', () => {
  assert.match(norm(SRC), /sahiplik sorgusu basarisiz — erisim reddedildi/);
  assert.match(norm(SRC), /\.status\(503\)/);
});

test('B3: sahiplik launch aninda bellege de yazilir (fail-closed isin sahibini kilitlemesin)', () => {
  const hits =
    norm(SRC).match(
      /rememberJobOwner\( ?serverId, ?result\?\.jobId, ?req\.session\?\.user\?\.username,? ?\)/g,
    ) || [];
  assert.equal(hits.length, 2, 'her iki dalda (openshift + legacy) sahiplik kaydedilmeli');
  assert.match(SRC, /JOB_OWNER_CACHE_MAX/, 'onbellek sinirsiz buyuyemez');
});

test('B3: gecmis yazilamazsa artik sessiz uyari degil, HATA loglanir', () => {
  assert.ok(
    !/console\.warn\( ?"\[Telnet\] Gecmis kaydedilemedi/.test(norm(SRC)),
    'sessiz warn duruyor',
  );
  assert.match(norm(SRC), /console\.error\( ?"\[Telnet\] Gecmis YAZILAMADI/);
});
