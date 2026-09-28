// server/__tests__/unbound-identifier.test.cjs — `gateVars` SINIFI icin kalici bekci.
//
// NE OLDU: 7eba0d5 `resolveSsLaunchPlan`a `gateVars` ekledi ve cagri yerlerini ona
// cevirdi ama IKI handler'in DESTRUCTURE satirina eklemeyi unuttu. `gateVars` o
// kapsamlarda TANIMSIZ kaldi ve HER Self Servis tetiklemesi ReferenceError ile 502
// dondu. Uretimde otomasyonlar durdu.
//
// NEDEN MEVCUT TESTLER YAKALAMADI: `smart-gate-input.test.cjs` kaynak METNINDE
// `gateVars` GECIYOR MU diye bakiyordu — geciyordu, sadece BAGLI DEGILDI. Metin
// aramasi bu sinifi ilkesel olarak yakalayamaz.
//
// NEDEN TSC: `src/` TypeScript ile denetleniyor ve bu sinif orada IMKANSIZ. Ama
// `server/**/*.cjs` HICBIR denetimden gecmiyordu — bosluk tam olarak oradaydi.
// TypeScript `--checkJs` ile duz JS'i de kapsam analizinden gecirir; TS2304
// ("Cannot find name") ve TS2552 ("Did you mean...") tam olarak bu sinifi isaretler.
//
// NEDEN YALNIZCA BU IKI KOD: `checkJs` tipsiz JS'te yuzlerce TS2339/TS18047 gibi
// gurultu uretir (bunlar CALISMA ZAMANI hatasi DEGIL). TS2304/TS2552 ise farkli:
// o satir calisirsa ReferenceError KESINDIR. Bekci bu yuzden dar tutuldu — genis
// tutulsaydi gurultuye bogulur ve kapatilirdi.
//
// NOT: JSDoc'ta `@returns { a: string }` yazimi da TS2304 uretir (tek suslu parantez
// bir TIP ifadesi olarak okunur; dogrusu `{{ a: string }}`). Bu bir calisma zamani
// hatasi degildir ama bekciyi kirmizi tutar — bu yuzden yazim da duzeltilir.
//
// ── 2026-09-27: BEKCI IKI SEBEPLE KENDI PLATFORMUNDA ISE YARAMIYORDU ────────
//
// 1. `npx` ILE CAGRILIYORDU. Windows'ta `npx` bir `.cmd` dosyasidir; `execFileSync`
//    kabuk acmadan calistigi icin ENOENT atar. Hata `catch`e duser, `e.stdout`
//    tanimsizdir, `out` BOS KALIR — ve bos ciktida TS2304 satiri de bulunmaz.
//    Yani ASIL bekci (asagidaki TANIMSIZ KIMLIK testi) tsc'yi HIC calistirmadan
//    YESIL donuyordu. Bir bekcinin kor olmasinin en kotu bicimi budur: yoklugundan
//    beterdir, cunku orada oldugu sanilir. Cozum: yerel `tsc` betigi `require.resolve`
//    ile bulunur ve `process.execPath` ile calistirilir — her platformda ayni yol.
//
// 2. SENTETIK PROBE, CANLI `server/` AGACINA yaziliyordu. `node --test` dosyalari
//    PARALEL kosar ve bu depoda kaynak agacini tarayan BASKA bekciler var
//    (preflight, node-version-readiness...). Onlar `server/__unbound_probe__.cjs`
//    dosyasini listeleyip okumaya calisiyor, dosya bu arada siliniyor ve ENOENT ile
//    DUSUYORLARDI — bu bekci baska bekcileri bozuyordu. Probe artik gecici bir
//    dizinde durur; oradaki tsconfig gercek yapilandirmayi `extends` ile devralir,
//    yani olculen derleyici secenekleri yine GERCEK olanlardir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const TSCONFIG = path.join(ROOT, 'tsconfig.server-check.json');

// Yerel tsc — `npx` yok. Bulunamazsa SESSIZ GECMEK yerine testi dusururuz.
const TSC = require.resolve('typescript/bin/tsc');

/**
 * tsc'yi calistirir ve ciktisini dondurur.
 *
 * `calisti` alani KRITIK: tsc hic baslayamadiysa cikti bos gelir ve bos cikti
 * "hata yok" ile AYIRT EDILEMEZ. Bu ayrimi kaybetmek, bekciyi kor birakan
 * hatanin ta kendisiydi.
 */
function tscCalistir(config) {
  try {
    execFileSync(process.execPath, [TSC, '-p', config], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { cikti: '', calisti: true };
  } catch (e) {
    // tsc gurultu (TS2339 vb.) yuzunden sifir-disi kod doner; ciktiyi biz suzeriz.
    const cikti = `${e.stdout || ''}${e.stderr || ''}`;
    // Derleyici hic baslamadiysa (ENOENT/EACCES) `stdout` da `stderr` de yoktur.
    return { cikti, calisti: cikti.length > 0 || e.status != null };
  }
}

test('tsconfig.server-check.json repoda var ve server/**/*.cjs kapsiyor', () => {
  assert.ok(fs.existsSync(TSCONFIG), 'sunucu denetim yapilandirmasi silinmis');
  const cfg = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
  assert.ok(cfg.compilerOptions.checkJs, 'checkJs kapatilmis — bekci ise yaramaz');
  assert.ok(cfg.compilerOptions.allowJs);
  assert.deepEqual(cfg.include, ['server/**/*.cjs']);
});

test('server/**/*.cjs icinde TANIMSIZ KIMLIK yok (gateVars sinifi)', () => {
  const { cikti, calisti } = tscCalistir(TSCONFIG);
  // ONCE derleyicinin GERCEKTEN kostugunu kanitla; yoksa bos cikti "temiz" sanilir.
  assert.ok(calisti, 'tsc hic calismadi — bu test YESIL donse bile hicbir sey olcmedi');
  const unbound = cikti.split('\n').filter((l) => /error TS(2304|2552):/.test(l));
  assert.deepEqual(unbound, [],
    'bu satirlar CALISTIGINDA ReferenceError verir:\n' + unbound.join('\n'));
});

test('bekcinin kendisi kor DEGIL: sentetik bir ihlali yakalar', () => {
  // Bekci "hep yesil" olmasin diye: gecici bir dosyaya tanimsiz kimlik yazilir ve
  // tsc'nin bunu GERCEKTEN TS2304 olarak isaretledigi dogrulanir.
  //
  // Probe CANLI AGACA YAZILMAZ (yukaridaki 2 numarali not): paralel kosan diger
  // bekciler `server/` altini tariyor ve yarisi kaybediyorlardi.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbound-probe-'));
  try {
    const probe = path.join(dir, '__unbound_probe__.cjs');
    fs.writeFileSync(probe, "'use strict';\nfunction f() { return buSeyTanimliDegil; }\nmodule.exports = { f };\n");
    // Gercek yapilandirmayi DEVRALIR: olculen derleyici secenekleri gercek olanlar.
    const probeConfig = path.join(dir, 'tsconfig.probe.json');
    const posix = (p) => p.split(path.sep).join('/');
    fs.writeFileSync(
      probeConfig,
      JSON.stringify({
        extends: posix(TSCONFIG),
        // `types: ["node"]` @types/node'u ARAR ve arama gecici dizinden YUKARI dogru
        // yurur — orada node_modules yoktur. Aramayi depoya sabitlemezsek tsc
        // TS2688 ile durur ve sentetik ihlali HIC gormeden bekci "kor" der: dogru
        // sonuc, YANLIS sebep. Sebebin dogru olmasi sonucun dogru olmasi kadar onemli.
        compilerOptions: { typeRoots: [posix(path.join(ROOT, 'node_modules', '@types'))] },
        include: ['__unbound_probe__.cjs'],
      }),
    );

    const { cikti, calisti } = tscCalistir(probeConfig);
    assert.ok(calisti, 'tsc hic calismadi — sentetik ihlal SINANAMADI');
    assert.match(cikti, /__unbound_probe__\.cjs.*error TS2304/,
      'tsc sentetik ihlali yakalamadi — bekci kor, yesil olmasi hicbir sey ifade etmez');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
