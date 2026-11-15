// server/__tests__/kalite-kapilari.test.cjs — kalite kapilari zorunlu ve YALNIZ SIKILASIR
// (docs/KALITE-KAPILARI.md, 2026-11-15).
//
// KK1-KK4: kapilarin kendisi dogru calisiyor mu (sir taramasi, kapsam esigi, bicim cirigi, Sonar).
// KK5-KK9: kapilar gevsetilemiyor mu: esik tabanlari, Sonar dislamalari, bastirma sayilari, CI ile
// tek komutun esitligi, kancalar ve ajan / gelistirici talimat dosyalari.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOK = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
const ESIK = JSON.parse(oku('kalite/esikler.json'));

const sir = require('../../scripts/sir-tarama.cjs');
const kapsam = require('../../scripts/kapsam-esik.cjs');
const bicim = require('../../scripts/bicim-kapisi.cjs');
const sonar = require('../../scripts/sonar-kapi.cjs');
const { KAPILAR, CI_EK } = require('../../scripts/kapi.cjs');

test('KK1 sir taramasi: gercek desen yakalanir, yer tutucu ve tanimlayici gecer', () => {
  const yakalanir = [
    'const password = "Gizli2026pw";',
    'Server=db;Database=x;PWD=Abc12345xy;',
    'curl https://kullanici:S3cretPw9@host/x',
    `const k = "${'AKIA'}${'ABCDEFGHIJKLMNOP'}";`,
    `t = "${'ghp_'}${'a'.repeat(36)}"`,
    '-----BEGIN RSA PRIVATE KEY-----',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123',
  ];
  for (const s of yakalanir) assert.ok(sir.satirTara(s).length > 0, `yakalanmadi: ${s}`);
  const gecer = [
    'pwd: "${DB_PASS}"',
    'sifre: "********"',
    'password: "<parola>"',
    "connectionType: server.token ? 'token' : 'user_pass',",
    'const parolaAlani = req.body.password;',
  ];
  for (const s of gecer) assert.deepEqual(sir.satirTara(s), [], `yanlis pozitif: ${s}`);
  // Test dosyasinda sahte parola / JWT / anahtar basligi serbest; bulut belirteci DEGIL.
  assert.deepEqual(sir.satirTara('const password = "Gizli2026pw";', { test: true }), []);
  assert.deepEqual(sir.satirTara('-----BEGIN PRIVATE KEY-----', { test: true }), []);
  assert.deepEqual(sir.satirTara(`x = "${'AKIA'}${'ABCDEFGHIJKLMNOP'}"`, { test: true }), [
    'AWS erisim anahtari',
  ]);
  // Yasak dosyalar.
  assert.ok(sir.dosyaYasak('kayit/portal.har'));
  assert.ok(sir.dosyaYasak('.env'));
  assert.ok(sir.dosyaYasak('deploy/.env.prod'));
  assert.ok(sir.dosyaYasak('certs/sunucu.key'));
  assert.equal(sir.dosyaYasak('.env.example'), null);
  assert.equal(sir.dosyaYasak('src/App.tsx'), null);
  // Fark ayristirma: yalniz eklenen satirlar, dogru satir numarasiyla; test yolu ayrimi.
  const fark = [
    'diff --git a/server/a.cjs b/server/a.cjs',
    '--- a/server/a.cjs',
    '+++ b/server/a.cjs',
    '@@ -1,0 +7,2 @@',
    '+const ok = 1;',
    '+const password = "Gizli2026pw";',
    '-const password = "EskiDeger99x";',
    'diff --git a/server/__tests__/b.test.cjs b/server/__tests__/b.test.cjs',
    '+++ b/server/__tests__/b.test.cjs',
    '@@ -0,0 +1 @@',
    '+const password = "Gizli2026pw";',
  ].join('\n');
  assert.deepEqual(sir.farkTara(fark, ['kayit.har']), [
    {
      dosya: 'kayit.har',
      satir: 0,
      ad: 'yasak dosya: HAR kaydi (oturum cerezi, parola, kisisel veri tasir)',
    },
    { dosya: 'server/a.cjs', satir: 8, ad: 'parola / belirtec atamasi' },
  ]);
});

test('KK2 kapsam esigi: yalniz kaynak dosyalari, satir birlestirme, esik tek kaynaktan', () => {
  const lcov = [
    'SF:server/a.cjs',
    'DA:1,1',
    'DA:2,0',
    'BRDA:1,0,0,1',
    'BRDA:1,0,1,-',
    'end_of_record',
    'SF:server/a.cjs', // ikinci kayit (vitest + node): satir 2 burada vurulmus
    'DA:2,3',
    'DA:3,0',
    'end_of_record',
    'SF:server/__tests__/a.test.cjs', // test dosyasi sayilmaz
    'DA:1,1',
    'end_of_record',
    'SF:dist/x.js', // kaynak disi
    'DA:1,0',
    'end_of_record',
  ].join('\n');
  const o = kapsam.kapsamOlc(lcov);
  assert.deepEqual(o, {
    satir: { toplam: 3, kapsanan: 2 },
    dal: { toplam: 2, kapsanan: 1 },
    dosya: 1,
  });
  assert.equal(Math.round(kapsam.oran(o.satir)), 67);
  assert.equal(kapsam.esikOku(), ESIK.kapsam.satirMin);
});

test('KK3 bicim cirigi: bicimli dosya bicimli kalir, bicimsize dokunmak serbest', () => {
  assert.equal(bicim.ihlalMi(true, false), true, 'bicimli dosya bozuldu ama gecti');
  assert.equal(bicim.ihlalMi(null, false), true, 'yeni bicimsiz dosya gecti');
  assert.equal(bicim.ihlalMi(false, false), false, 'eski bicimsiz dosyaya dokunmak engellendi');
  assert.equal(bicim.ihlalMi(true, true), false);
  assert.equal(bicim.ihlalMi(null, true), false);
  assert.ok(
    bicim.KOD.test('src/a.tsx') && bicim.KOD.test('server/a.cjs') && !bicim.KOD.test('docs/a.md'),
  );
});

test('KK4 Sonar kapisi: kosullar esiklerden, sonuc ozeti dogru okunur', () => {
  const k = sonar.kosullar(ESIK);
  assert.equal(k.length, ESIK.sonar.kosullar.length);
  assert.deepEqual(k[0], {
    metric: ESIK.sonar.kosullar[0].metrik,
    op: ESIK.sonar.kosullar[0].op,
    error: String(ESIK.sonar.kosullar[0].esik),
  });
  const kirmizi = sonar.durumOzeti({
    projectStatus: {
      status: 'ERROR',
      conditions: [
        {
          status: 'ERROR',
          metricKey: 'bugs',
          comparator: 'GT',
          errorThreshold: '0',
          actualValue: '2',
        },
        {
          status: 'OK',
          metricKey: 'coverage',
          comparator: 'LT',
          errorThreshold: '70',
          actualValue: '75.0',
        },
      ],
    },
  });
  assert.equal(kirmizi.tamam, false);
  assert.match(kirmizi.satirlar[0], /KIRMIZI bugs = 2 \(esik GT 0\)/);
  assert.equal(sonar.durumOzeti({ projectStatus: { status: 'OK', conditions: [] } }).tamam, true);
  assert.equal(sonar.durumOzeti({}).tamam, false, 'bos yanit yesil sayildi');
  // CI'daki servis imaji betikteki imajla ayni (iki yerde iki surum olmasin).
  assert.ok(
    oku('.github/workflows/ci.yml').includes(`image: ${sonar.IMAJ}`),
    'CI Sonar imaji betikle farkli',
  );
});

// Esik TABANLARI: esikler.json bundan gevsek olamaz. Tabani degistirmek bu dosyayi degistirmek
// demektir ve CODEOWNERS incelemesine duser.
const TABAN = {
  kapsamSatirMin: 70,
  sonar: {
    coverage: ['LT', 70],
    duplicated_lines_density: ['GT', 3],
    bugs: ['GT', 0],
    vulnerabilities: ['GT', 0],
    // MQR guvenilirlik notu (2026-11-15): kod kokularinin guvenilirlik etkisini de sayar; standart
    // reliability_rating ile esdeger metrik oldugundan ikisi birden kurulamaz, siki olan secildi.
    software_quality_reliability_rating: ['GT', 1],
    security_rating: ['GT', 1],
    sqale_rating: ['GT', 1],
    security_hotspots_reviewed: ['LT', 100],
    software_quality_blocker_issues: ['GT', 0],
    software_quality_high_issues: ['GT', 0],
  },
  bastirma: {
    NOSONAR: 0,
    'ts-ignore': 0,
    'ts-expect-error': 0,
    'eslint-disable': 2,
    'test-only-skip': 0,
  },
};

test('KK5 esikler yalniz sikilasir: kapsam, Sonar kosullari ve bastirma tavanlari tabandan gevsek degil', () => {
  assert.ok(ESIK.kapsam.satirMin >= TABAN.kapsamSatirMin, 'kapsam esigi tabanin altina indi');
  const kosul = new Map(ESIK.sonar.kosullar.map((k) => [k.metrik, k]));
  for (const [metrik, [op, taban]] of Object.entries(TABAN.sonar)) {
    const k = kosul.get(metrik);
    assert.ok(k, `Sonar kosulu kaldirildi: ${metrik}`);
    assert.equal(k.op, op, `${metrik} karsilastirmasi degisti`);
    const e = Number(k.esik);
    assert.ok(
      op === 'LT' ? e >= taban : e <= taban,
      `${metrik} esigi gevsetildi (${k.esik}, taban ${taban})`,
    );
  }
  for (const [ad, tavan] of Object.entries(TABAN.bastirma))
    assert.ok(ESIK.bastirma[ad] <= tavan, `bastirma tavani yukseltildi: ${ad}`);
});

test('KK6 Sonar yapilandirmasi: kapsam / sorun dislamasi yok, CPD dislamasi yalniz gerekceli veri dosyalari', () => {
  const p = oku('sonar-project.properties');
  const ayar = new Map(
    p
      .split('\n')
      .filter((s) => s && !s.startsWith('#') && s.includes('='))
      .map((s) => [s.slice(0, s.indexOf('=')).trim(), s.slice(s.indexOf('=') + 1).trim()]),
  );
  assert.ok(!ayar.has('sonar.coverage.exclusions'), 'kapsam dislamasi eklendi');
  for (const k of ayar.keys())
    assert.ok(!k.startsWith('sonar.issue.ignore'), `sorun bastirma eklendi: ${k}`);
  assert.equal(ayar.get('sonar.sources'), 'src,server,shared', 'kaynak dizinleri daraltildi');
  const izinliDislama = new Set([
    'node_modules/**',
    'dist/**',
    'dist_prev/**',
    'coverage/**',
    'sunum/**',
    'docs/**',
  ]);
  for (const d of ayar.get('sonar.exclusions').split(','))
    assert.ok(
      izinliDislama.has(d) || /__tests__|\.(test|spec)\./.test(d),
      `kaynak dislamasi eklendi: ${d}`,
    );
  const cpd = (ayar.get('sonar.cpd.exclusions') || '').split(',').filter(Boolean);
  assert.deepEqual(
    [...cpd].sort(),
    Object.keys(ESIK.sonar.cpdHaric).sort(),
    'CPD listesi esikler.json ile ayni degil',
  );
  for (const [dosya, gerekce] of Object.entries(ESIK.sonar.cpdHaric)) {
    assert.ok(gerekce.length >= 40, `${dosya}: gerekce yok`);
    assert.ok(
      !/[*?]/.test(dosya) && fs.existsSync(path.join(KOK, dosya)),
      `${dosya}: joker ya da olmayan dosya`,
    );
  }
});

// Izlenen kaynak metinleri (bu dosya haric: desenleri metin olarak tasir). Desenler JS duzenli
// ifadesiyle sayilir: `git grep -E` \s ve \b tanimaz, sayim sessizce 0 cikiyordu (mutasyonla bulundu).
const BU_DOSYA = path.relative(KOK, __filename).replaceAll('\\', '/');
const METINLER = execFileSync(
  'git',
  ['ls-files', '-z', '--', 'src', 'server', 'shared', 'scripts'],
  {
    cwd: KOK,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split('\0')
  .filter((f) => f && f !== BU_DOSYA && /\.(?:[cm]?js|tsx?|py|sh|ya?ml)$/.test(f))
  .map((f) => ({ f, metin: fs.readFileSync(path.join(KOK, f), 'utf8') }));
function say(re) {
  let n = 0;
  for (const { metin } of METINLER)
    for (const satir of metin.split('\n')) if (re.test(satir)) n += 1;
  return n;
}

test('KK7 bastirma sayilari tavanin altinda (NOSONAR, ts-ignore, eslint-disable, .only / .skip)', () => {
  const sayim = {
    NOSONAR: say(/NOSONAR/),
    'ts-ignore': say(/@ts-ignore/),
    'ts-expect-error': say(/@ts-expect-error/),
    'eslint-disable': say(/(?:\/\/|\/\*)\s*eslint-disable/),
    'test-only-skip': say(/\b(?:it|test|describe)\.(?:only|skip)\(/),
  };

  for (const [ad, n] of Object.entries(sayim))
    assert.ok(
      n <= ESIK.bastirma[ad],
      `${ad}: ${n} adet, tavan ${ESIK.bastirma[ad]} (kalite/esikler.json)`,
    );
});

test('KK8 CI ve `npm run kapi` ayni kapilari kosturur; hicbir kapi yumusatilmamis', () => {
  const ci = oku('.github/workflows/ci.yml');
  for (const k of [...KAPILAR, ...CI_EK])
    assert.ok(ci.includes(k.ci), `${k.id} (${k.ad}) CI'da kosmuyor`);
  const kod = ci
    .split('\n')
    .filter((s) => !/^\s*#/.test(s))
    .join('\n');
  assert.ok(!/continue-on-error\s*:\s*true/.test(kod), 'CI adimi continue-on-error tasiyor');
  assert.ok(!/\|\|\s*(true\b|:(\s|$)|exit 0\b)/m.test(kod), 'CI adimi `|| true` ile yumusatilmis');
  assert.match(ci, /pull_request:\s*\n\s*branches: \[main\]/, 'PR tetigi yok');
  assert.match(ci, /\n  sonar:\n[\s\S]*needs: verify[\s\S]*sonar-kapi\.cjs --ci/, 'Sonar isi yok');
  const pkg = JSON.parse(oku('package.json'));
  assert.equal(pkg.scripts.kapi, 'node scripts/kapi.cjs');
  assert.equal(pkg.scripts['kapi:hizli'], 'node scripts/kapi.cjs --hizli');
  assert.equal(pkg.scripts['kapi:sonar'], 'node scripts/sonar-kapi.cjs');
  assert.match(
    pkg.scripts.lint,
    /^eslint src\/ server\/ shared\/ scripts\/ --max-warnings 0$/,
    'lint kapsami daraldi ya da uyari serbest',
  );
  assert.ok(KAPILAR.filter((k) => k.hizli).length >= 6, 'hizli kapilar azaltildi');
});

test('KK9 kancalar ve talimat dosyalari kapilari zorunlu kilar', () => {
  const pre = oku('.husky/pre-commit');
  for (const s of [
    'npx lint-staged',
    'node scripts/bicim-kapisi.cjs',
    'node scripts/sir-tarama.cjs --staged',
  ])
    assert.ok(pre.includes(s), `pre-commit: ${s} yok`);
  assert.ok(
    oku('.husky/pre-push').includes('npm run -s kapi:hizli'),
    'pre-push hizli kapilari kosmuyor',
  );
  assert.ok(
    oku('.husky/commit-msg').includes('node scripts/sir-tarama.cjs --mesaj'),
    'commit mesaji sir taramasi yok',
  );
  const ls = JSON.parse(oku('package.json'))['lint-staged'];
  assert.ok(
    Object.values(ls)
      .flat()
      .some((k) => /^eslint --max-warnings 0/.test(k)),
    'lint-staged eslint kapisi yok',
  );
  // Gelistirici ve ajan talimatlari: tek kaynaga ve tek komuta isaret eder.
  for (const f of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.agent/rules/kalite-kapilari.md',
    'CONTRIBUTING.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
  ]) {
    const m = oku(f);
    assert.ok(
      m.includes('docs/KALITE-KAPILARI.md'),
      `${f}: docs/KALITE-KAPILARI.md'ye isaret etmiyor`,
    );
    assert.ok(m.includes('npm run kapi'), `${f}: npm run kapi yok`);
  }
  const doc = oku('docs/KALITE-KAPILARI.md');
  for (const k of [...KAPILAR, ...CI_EK])
    assert.ok(doc.includes(`| ${k.id} |`), `belgede ${k.id} satiri yok`);
});

test('KK10 Sonar inceleme kayitlari gerekceli ve bayat degil', () => {
  const liste = sonar.incelemeler();
  assert.ok(Array.isArray(liste));
  for (const k of liste) {
    assert.match(
      k.kural,
      /^(javascript|typescript|python|text|secrets):S\d+$/,
      `kural bicimi: ${k.kural}`,
    );
    assert.ok(!/[*?]/.test(k.dosya), `${k.dosya}: joker yasak`);
    assert.ok(k.gerekce && k.gerekce.length >= 60, `${k.dosya}: gerekce kisa`);
    assert.ok(k.icerik && k.icerik.length >= 8, `${k.dosya}: icerik metni cok genel`);
    assert.ok(
      oku(k.dosya).includes(k.icerik),
      `${k.dosya}: kayitli icerik dosyada yok (bayat kayit)`,
    );
  }
  // Eslestirme: kural + dosya + satir icerigi; satir numarasi degil.
  const k0 = { kural: 'javascript:S5443', dosya: 'a/b.cjs', icerik: "'/tmp/x'", gerekce: 'x' };
  const h = { component: 'proje:a/b.cjs', ruleKey: 'javascript:S5443' };
  assert.equal(sonar.incelemeBul(h, "  return '/tmp/x';", [k0]), k0);
  assert.equal(sonar.incelemeBul(h, "  return '/tmp/y';", [k0]), null, 'icerik farkli ama eslesti');
  assert.equal(
    sonar.incelemeBul({ ...h, ruleKey: 'javascript:S1313' }, "'/tmp/x'", [k0]),
    null,
    'kural farkli ama eslesti',
  );
  assert.equal(
    sonar.incelemeBul({ ...h, component: 'proje:a/c.cjs' }, "'/tmp/x'", [k0]),
    null,
    'dosya farkli ama eslesti',
  );
});
