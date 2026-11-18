// server/__tests__/teslim.test.js — kurumsal teslim imzasi (scripts/teslim.cjs).
//
// Kurumsal is #48 (2026-11-18): kurumsal dal main'in yarim bir kopyasiydi ve is anlasilmaz bir yerde
// dustu. Imza, kurumsal derlemenin ilk adiminda kodun main'in birebir kopyasi oldugunu dogrular.
// Testler gercek git depolarinda kosar: imza git indeksinden uretilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOK = path.join(__dirname, '..', '..');
const T = require('../../scripts/teslim.cjs');

const git = (dizin, ...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=teslim-test',
      '-c',
      'user.email=teslim-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    { cwd: dizin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

/** Gecici git deposu: dosyalar yazilir, indekse alinir ve commit edilir. */
function depo(dosyalar) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'teslim-test-'));
  git(d, 'init', '-q');
  for (const [yol, icerik] of Object.entries(dosyalar)) yazDosya(d, yol, icerik);
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'ilk');
  return d;
}

function yazDosya(d, yol, icerik) {
  fs.mkdirSync(path.dirname(path.join(d, yol)), { recursive: true });
  fs.writeFileSync(path.join(d, yol), icerik);
}

const toplayici = () => {
  const cikti = { yaz: [], hata: [] };
  return {
    cikti,
    g: { yaz: (m) => cikti.yaz.push(m), hata: (m) => cikti.hata.push(m) },
  };
};

const ANA = {
  'package.json': '{"scripts":{"kurumsal:derle":"node scripts/kurumsal-derle.cjs"}}\n',
  'scripts/kurumsal-derle.cjs': 'console.log(1);\n',
  'scripts/paket.cjs': 'module.exports = 1;\n',
  'dizin/bosluklu ad.txt': 'x\n',
  'kalite/kapsam/ozet.json': '{}\n',
};

test('TS1 imza: git blob sha (git hash-object ile ayni), kuruma gitmeyenler haric, bosluklu yollar', () => {
  const d = depo(ANA);
  try {
    const i = T.imza(d);
    assert.deepEqual(Object.keys(i).sort(), [
      'dizin/bosluklu ad.txt',
      'package.json',
      'scripts/kurumsal-derle.cjs',
      'scripts/paket.cjs',
    ]);
    for (const yol of Object.keys(i)) assert.equal(i[yol], git(d, 'hash-object', yol), yol);
    assert.deepEqual(T.KURUMA_GITMEYEN, ['kalite/', '.github/', '.claude/', '.agent/', 'sunum/']);
    assert.equal(T.IMZA, 'kalite/teslim.json');
    assert.ok(T.IMZA.startsWith(T.KURUMA_GITMEYEN[0]), 'imza kendini kapsamamali');
    // Derlenen / calisan hicbir sey kuruma gitmeyenlere giremez.
    for (const yol of [
      'src/a.ts',
      'server/a.cjs',
      'shared/a.cjs',
      'scripts/a.cjs',
      'package.json',
      'deploy/a.sh',
    ])
      assert.ok(!T.KURUMA_GITMEYEN.some((h) => yol.startsWith(h)), `${yol} kuruma gitmeyenlerde`);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('TS2 karsilastir: farkli, eksik ve fazla AYRI ayri yakalanir; esitse bos', () => {
  const b = { a: '1', b: '2', c: '3' };
  const bos = { farkli: [], eksik: [], fazla: [] };
  assert.deepEqual(T.karsilastir(b, { ...b }), bos);
  assert.deepEqual(T.karsilastir(b, { ...b, b: '9' }), { ...bos, farkli: ['b'] });
  assert.deepEqual(T.karsilastir(b, { a: '1', c: '3' }), { ...bos, eksik: ['b'] });
  assert.deepEqual(T.karsilastir(b, { ...b, d: '4' }), { ...bos, fazla: ['d'] });
  assert.deepEqual(T.karsilastir(b, { a: '0', d: '4' }), {
    farkli: ['a'],
    eksik: ['b', 'c'],
    fazla: ['d'],
  });
  // Prototip adlari dosya sayilmaz.
  assert.deepEqual(T.karsilastir({}, {}), bos);
  assert.deepEqual(T.karsilastir({ toString: 'x' }, {}), { ...bos, eksik: ['toString'] });
  assert.deepEqual(T.karsilastir({}, { constructor: 'x' }), { ...bos, fazla: ['constructor'] });
});

test('TS3 imzaYaz: indeksten yazar; dosya kumesi ayniysa dokunmaz (bos commit yok)', () => {
  const d = depo(ANA);
  try {
    const ilk = T.imzaYaz(d);
    const bas = git(d, 'rev-parse', 'HEAD');
    assert.deepEqual(ilk, { degisti: true, kaynak: bas, dosyaSayisi: 4 });
    const kayit = JSON.parse(fs.readFileSync(path.join(d, T.IMZA), 'utf8'));
    assert.equal(kayit.kaynak, bas);
    assert.equal(kayit.dosyaSayisi, 4);
    assert.deepEqual(kayit.dosyalar, T.imza(d));
    assert.match(kayit.aciklama, /teslim-imzasi\.yml/);
    const metin = fs.readFileSync(path.join(d, T.IMZA), 'utf8');
    assert.equal(
      metin,
      `${JSON.stringify(kayit, null, 2)}\n`,
      'bicim JSON.stringify(2) + satir sonu',
    );

    // Imzanin kendisini commit etmek (kalite/) imzayi degistirmez.
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'imza');
    assert.deepEqual(T.imzaYaz(d), { degisti: false, kaynak: bas, dosyaSayisi: 4 });
    assert.equal(fs.readFileSync(path.join(d, T.IMZA), 'utf8'), metin, 'dosyaya dokunuldu');

    // Kaynak degisince yeniden yazilir, kaynak yeni HEAD olur.
    yazDosya(d, 'scripts/paket.cjs', 'module.exports = 2;\n');
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'degisim');
    const yeni = T.imzaYaz(d);
    assert.deepEqual(yeni, { degisti: true, kaynak: git(d, 'rev-parse', 'HEAD'), dosyaSayisi: 4 });

    // Bozuk imza yeniden yazilir.
    fs.writeFileSync(path.join(d, T.IMZA), '{bozuk');
    assert.equal(T.imzaYaz(d).degisti, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, T.IMZA), 'utf8')).dosyalar, T.imza(d));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('TS4 imzaDogrula: birebir 0; yarim kopyanin her bicimi 1 ve dosyasiyla soylenir', () => {
  const d = depo(ANA);
  try {
    T.imzaYaz(d);
    let t = toplayici();
    assert.equal(T.imzaDogrula(d, t.g), 0);
    assert.match(t.cikti.yaz[0], /BIREBIR: 4 dosya, main [0-9a-f]{12} ile ayni/);

    // Calisma agacindaki (indekse alinmamis) degisiklik sayilmaz: CRLF donusumu yanlis alarm vermez.
    fs.writeFileSync(path.join(d, 'package.json'), '{"scripts":{}}\r\n');
    assert.equal(T.imzaDogrula(d, toplayici().g), 0);

    // Is #48: package.json eski (betik satiri yok), kurumsal-derle.cjs yeni.
    git(d, 'add', 'package.json');
    t = toplayici();
    assert.equal(T.imzaDogrula(d, t.g), 1);
    const mesaj = t.cikti.hata.join('\n');
    assert.match(mesaj, /BIREBIR KOPYASI DEGIL: 1 fark/);
    assert.match(mesaj, /icerigi farkli \(1\): package\.json/);
    assert.match(mesaj, /git rm -r -q \./, 'aktarim yontemi soylenmeli');
    assert.match(mesaj, /Teslim imzasi/, 'tazeleme penceresi soylenmeli');
    assert.doesNotMatch(mesaj, /eksik|fazla \(/);
    git(d, 'checkout', 'HEAD', '--', 'package.json');

    // Eksik dosya ve main'de olmayan (silinmis ama kalmis) dosya.
    git(d, 'rm', '-q', '--cached', 'scripts/paket.cjs');
    yazDosya(d, 'scripts/eski-betik.cjs', 'eski\n');
    git(d, 'add', 'scripts/eski-betik.cjs');
    t = toplayici();
    assert.equal(T.imzaDogrula(d, t.g), 1);
    const m2 = t.cikti.hata.join('\n');
    assert.match(m2, /2 fark/);
    assert.match(m2, /eksik \(main'de var, burada yok\) \(1\): scripts\/paket\.cjs/);
    assert.match(m2, /fazla \(main'de yok, burada var\) \(1\): scripts\/eski-betik\.cjs/);
    assert.doesNotMatch(m2, /icerigi farkli/);
    git(d, 'reset', '-q', '--hard');
    git(d, 'clean', '-q', '-fd', '-e', 'kalite/');
    assert.equal(T.imzaDogrula(d, toplayici().g), 0, 'temizlikten sonra birebir degil');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('TS4b kurumsal is #50: kuruma gitmeyen dizinler eksik ya da farkli olsa da BIREBIR', () => {
  const d = depo({
    ...ANA,
    '.github/workflows/ci.yml': 'on: push\n',
    '.claude/agents/a.md': 'a\n',
    '.agent/rules/k.md': 'k\n',
    'sunum/deck.pptx': 'ikili\n',
  });
  try {
    T.imzaYaz(d);
    const kayit = JSON.parse(fs.readFileSync(path.join(d, T.IMZA), 'utf8'));
    assert.deepEqual(Object.keys(kayit.dosyalar).sort(), Object.keys(T.imza(d)).sort());
    assert.ok(
      !Object.keys(kayit.dosyalar).some((y) => /^(\.github|\.claude|\.agent|sunum)\//.test(y)),
    );
    // Kurumsal dalda yoklar (is #50):
    git(d, 'rm', '-q', '-r', '--cached', '.github', '.claude', '.agent', 'sunum');
    assert.equal(T.imzaDogrula(d, toplayici().g), 0, 'eksik kuruma-gitmeyen dosya fark sayildi');
    // Kurumsal dalda farkli ya da fazlalar:
    yazDosya(d, '.github/workflows/ci.yml', 'on: pull_request\n');
    yazDosya(d, 'sunum/yeni.pdf', 'pdf\n');
    git(d, 'add', '-A');
    assert.equal(
      T.imzaDogrula(d, toplayici().g),
      0,
      'fazla / farkli kuruma-gitmeyen dosya fark sayildi',
    );
    // Ama kod hala denetlenir.
    yazDosya(d, 'scripts/paket.cjs', 'module.exports = 9;\n');
    git(d, 'add', '-A');
    const t = toplayici();
    assert.equal(T.imzaDogrula(d, t.g), 1);
    assert.match(t.cikti.hata.join('\n'), /icerigi farkli \(1\): scripts\/paket\.cjs/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('TS5 imzaDogrula: cok fark kisaltilir; imza yok / bozuk / git yok -> 1', () => {
  const d = depo(ANA);
  try {
    T.imzaYaz(d);
    for (let i = 0; i < 25; i++) yazDosya(d, `fazla/${String(i).padStart(2, '0')}.txt`, `${i}\n`);
    git(d, 'add', '-A');
    let t = toplayici();
    assert.equal(T.imzaDogrula(d, t.g), 1);
    const m = t.cikti.hata.join('\n');
    assert.match(m, /fazla \(main'de yok, burada var\) \(25\): fazla\/00\.txt/);
    assert.match(m, /fazla\/19\.txt \.\.\. ve 5 dosya daha/);
    assert.doesNotMatch(m, /fazla\/20\.txt/);

    for (const [icerik, beklenen] of [
      [null, /okunamadi \(ENOENT\)/],
      ['{bozuk', /okunamadi \(/],
      ['{"kaynak":"x"}', /okunamadi \(dosyalar alani yok\)/],
      ['{"dosyalar":null}', /okunamadi \(dosyalar alani yok\)/],
      ['null', /okunamadi \(/],
    ]) {
      if (icerik === null) fs.rmSync(path.join(d, T.IMZA), { force: true });
      else fs.writeFileSync(path.join(d, T.IMZA), icerik);
      t = toplayici();
      assert.equal(T.imzaDogrula(d, t.g), 1, String(icerik));
      assert.match(t.cikti.hata.join('\n'), beklenen, String(icerik));
      assert.match(t.cikti.hata.join('\n'), /git rm -r -q \./);
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }

  const duz = fs.mkdtempSync(path.join(os.tmpdir(), 'teslim-gitsiz-'));
  try {
    yazDosya(duz, T.IMZA, JSON.stringify({ kaynak: 'x', dosyalar: {} }));
    const t = toplayici();
    // Ust dizinler git deposu olmasin diye GIT_CEILING_DIRECTORIES gerekmez: tmpdir depo degil.
    assert.equal(T.imzaDogrula(duz, t.g), 1);
    assert.match(t.cikti.hata.join('\n'), /git indeksi okunamadi/);
  } finally {
    fs.rmSync(duz, { recursive: true, force: true });
  }
});

test('TS6 main: --yaz ve --dogrula; bilinmeyen arguman 2', () => {
  const d = depo(ANA);
  try {
    let t = toplayici();
    assert.equal(T.main(['--yaz'], d, t.g), 0);
    assert.match(t.cikti.yaz[0], /kalite\/teslim\.json yazildi: 4 dosya \(main [0-9a-f]{12}\)/);
    t = toplayici();
    assert.equal(T.main(['--yaz'], d, t.g), 0);
    assert.match(t.cikti.yaz[0], /guncel: 4 dosya/);
    assert.equal(T.main(['--dogrula'], d, toplayici().g), 0);
    for (const argv of [[], ['--sil'], ['--dogrula', 'x'], ['--yaz', '--dogrula']]) {
      t = toplayici();
      assert.equal(T.main(argv, d, t.g), 2, JSON.stringify(argv));
      assert.match(t.cikti.hata[0], /kullanim/);
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('TS7 imza tazeleme is akisi: her main push, yalniz imza, zorla push yok, her denemede yeniden uretim', () => {
  const akis = fs.readFileSync(path.join(KOK, '.github', 'workflows', 'teslim-imzasi.yml'), 'utf8');
  const kod = akis
    .split('\n')
    .filter((s) => !/^\s*#/.test(s))
    .join('\n');
  assert.match(kod, /on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/);
  assert.doesNotMatch(kod, /paths:/, 'imza her push tan sonra tazelenmeli (paths suzgeci yok)');
  assert.match(kod, /ssh-key: \$\{\{ secrets\.KAPSAM_DEPLOY_KEY \}\}/);
  assert.match(kod, /\n\s+contents: write\n/);
  // Denemeler rebase etmez: her denemede guncel main'den imza yeniden uretilir.
  const dongu = (kod.match(/for deneme in 1 2 3; do([\s\S]*?)\n\s+done/) || [])[1] || '';
  assert.match(
    dongu,
    /git fetch origin main\n\s+git reset --hard origin\/main\n\s+node scripts\/teslim\.cjs --yaz\n/,
  );
  assert.match(dongu, /git add kalite\/teslim\.json\n/);
  assert.match(dongu, /\[skip ci\]/);
  assert.doesNotMatch(kod, /git add (-A|\.|--all)/);
  assert.doesNotMatch(kod, /push[^\n]*--force|pull --rebase/);
  assert.doesNotMatch(kod, /continue-on-error|\|\|\s*true/);
  const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['teslim:yaz'], 'node scripts/teslim.cjs --yaz');
  assert.equal(pkg.scripts['teslim:dogrula'], 'node scripts/teslim.cjs --dogrula');
  assert.doesNotMatch(
    fs.readFileSync(path.join(KOK, '.gitignore'), 'utf8'),
    /^\/?kalite\/?$/m,
    'imza git disi olmamali',
  );
});

test('TS8 repodaki imza bicimi: kuruma gitmeyenler yok, her deger 40 haneli sha, sayi tutarli', () => {
  const kayit = JSON.parse(fs.readFileSync(path.join(KOK, T.IMZA), 'utf8'));
  const yollar = Object.keys(kayit.dosyalar);
  assert.equal(kayit.dosyaSayisi, yollar.length);
  assert.match(kayit.kaynak, /^[0-9a-f]{40}$/);
  assert.ok(yollar.length > 100, 'imza bos');
  assert.ok(
    !yollar.some((y) => T.KURUMA_GITMEYEN.some((h) => y.startsWith(h))),
    'imza kuruma gitmeyenleri icermemeli',
  );
  assert.ok(Object.values(kayit.dosyalar).every((s) => /^[0-9a-f]{40}$/.test(s)));
  for (const y of ['package.json', 'scripts/kurumsal-derle.cjs', 'scripts/teslim.cjs'])
    assert.ok(yollar.includes(y), `${y} imzada yok`);
});
