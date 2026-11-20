#!/usr/bin/env node
// scripts/kurumsal-prova.cjs — kurumsal Jenkins isinin PROVASI. `npm run kurumsal:prova`
// (CI: .github/workflows/ci.yml `kurumsal` isi; Node surumu groovy'den okunur).
//
// NEDEN (2026-11-18, kurumsal isler #46 / #48): kurumsal is bizim gormedigimiz bir ortamda kosar ve
// her kirilma (eksik npm betigi, yanlis paket yeri, derleme hatasi, 15 dk zaman asimi) ancak orada
// gorunuyordu. Prova ayni komutlari, ayni sirayla, kurumsal klona benzeyen temiz bir agacta kosturur:
//   1. git worktree (commit'lenmis HEAD): node_modules yok, git indeksi var;
//   2. teslim imzasi o agactan yazilir (main'de .github/workflows/teslim-imzasi.yml'in yaptigi), sonra
//      kuruma gitmeyen dizinler (scripts/teslim.cjs KURUMA_GITMEYEN: .github, sunum, Ansible ...) agactan
//      ve indeksten silinir: prova kurumsal depodaki agacta kosar (is #52);
//   3. `npm install` (kurumun `jf npm install`i), sonra groovy'de install'dan sonraki her komut
//      `npm <komut>` olarak (kutuphanenin NPMPipeline'i boyle cagirir);
//   4. groovy'nin sikistirdigi dizinde calisma zamani paketi var mi; paketin icinde server/index.cjs'in
//      yukledigi her modul yuklenebiliyor mu (Ansible'siz agacta eksik dosya burada duser); sure kurumun
//      15 dk'lik tek zaman asiminin altinda mi (pay birakilir: kurumsal pod'lar yavas olabilir).
// Ortam farklari (kayit defteri, JFrog'un .npmrc'si) provada yoktur; onlar kurum talebindedir.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CIKTI } = require('./kurumsal-derle.cjs');
const { KURUMA_GITMEYEN } = require('./teslim.cjs');
const { aracYolu, kabukIcin } = require('./arac-yolu.cjs');

const KOK = path.join(__dirname, '..');
const GROOVY = 'deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy';
const SURE_SINIRI_DK = 10;
// Paketin kurulup calismasi icin sart olanlar (CIKTI'ya gore).
const PAKET_ICERIGI = [
  'package.json',
  'package-lock.json',
  'dist/index.html',
  'dist/.paket.json',
  'server',
  'deploy/release.sh',
];

// Paketin icinde kosar: sunucunun giris dosyasinin yukledigi her modul (dinlemeye baslamadan).
const MODUL_YUKLE = [
  "const fs = require('node:fs'), path = require('node:path');",
  "const giris = fs.readFileSync('server/index.cjs', 'utf8');",
  "const adlar = [...new Set([...giris.matchAll(/require\\('(\\.\\/[^']+)'\\)/g)].map((m) => m[1]))];",
  "for (const m of adlar) require(path.resolve('server', m));",
  'console.log(`[prova] calisma zamani: server/index.cjs ${adlar.length} modul yuklendi`);',
  'process.exit(0);',
].join('\n');

/** Satir yorumlari (`//` sonrasi) atilir; satir satir (dogrusal, Sonar S8786). */
const yorumsuz = (metin) =>
  metin
    .split('\n')
    .map((s) => (s.includes('//') ? s.slice(0, s.indexOf('//')) : s))
    .join('\n');

/** Groovy metni -> derleme bilgileri; bulunamayan alan undefined. Saf islev, hata atmaz. */
function ayristir(metin) {
  const araclar = (metin.match(/tools:\s*\[([^\]]*)\]/) || [])[1];
  const node = araclar && (araclar.match(/nodejs:\s*"([^"]+)"/) || [])[1];
  const blok = (metin.match(/commands:\s*\[([\s\S]*?)\]/) || [])[1];
  const komutlar =
    blok === undefined ? undefined : [...yorumsuz(blok).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const s = metin.match(/compress:\s*\[from:\s*"([^"]+)",\s*to:\s*"([^"]+)"\]/);
  return { araclar, node, komutlar, sikistir: s ? { from: s[1], to: s[2] } : undefined };
}

/** Prova icin groovy: Node, komutlar ve sikistirma zorunlu; yoksa hata. */
function groovyOku(metin) {
  const g = ayristir(metin);
  const eksik = [];
  if (!g.node) eksik.push('tools nodejs');
  if (!g.komutlar?.length) eksik.push('commands');
  if (!g.sikistir) eksik.push('compress');
  if (eksik.length) throw new Error(`groovy okunamadi: ${eksik.join(', ')} yok`);
  if (g.komutlar[0] !== 'install')
    throw new Error(`groovy'nin ilk komutu install degil: ${g.komutlar[0]}`);
  return g;
}

/** Sikistirilan dizinde paket eksiksiz mi? -> eksik listesi (bos = tamam). */
function paketDenetle(agac, sikistirKoku, cikti = CIKTI) {
  const goreli = path.posix.relative(sikistirKoku, cikti);
  if (goreli.startsWith('..') || path.posix.isAbsolute(goreli))
    return [`paket (${cikti}) sikistirilan dizinin (${sikistirKoku}) altinda degil`];
  const eksik = PAKET_ICERIGI.filter((p) => !fs.existsSync(path.join(agac, cikti, p))).map(
    (p) => `${cikti}/${p}`,
  );
  const pkgYol = path.join(agac, cikti, 'package.json');
  if (fs.existsSync(pkgYol) && JSON.parse(fs.readFileSync(pkgYol, 'utf8')).devDependencies)
    eksik.push(`${cikti}/package.json devDependencies tasiyor (calisma zamani paketi degil)`);
  return eksik;
}

/** Kurumsal ortamdaki gibi: Sonar kosusu tetiklenmez (BUILD_NOTE yok). */
function ortam(env = process.env) {
  const e = { ...env };
  delete e.BUILD_NOTE;
  return e;
}

function prova({
  kok = KOK,
  kos = spawnSync,
  yaz = console.log,
  hata = console.error,
  simdi = Date.now,
  surum = process.version,
  // Komut adi -> mutlak yol (git / npm PATH'te aranmaz; scripts/arac-yolu.cjs).
  cozumle = (k) => (path.isAbsolute(k) ? k : kabukIcin(aracYolu(k))),
} = {}) {
  let g;
  try {
    g = groovyOku(fs.readFileSync(path.join(kok, GROOVY), 'utf8'));
  } catch (e) {
    hata(`[prova] ${e.message}`);
    return 1;
  }
  if (surum !== `v${g.node}`)
    yaz(`[prova] UYARI: Node ${surum}; kurumsal is Node ${g.node} kullanir.`);
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'kurumsal-prova-'));
  const agac = path.join(gecici, 'agac');
  const bas = simdi();
  const adim = (ad, komut, args, cwd) => {
    yaz(`[prova] ${ad}: ${[path.basename(komut), ...args].join(' ')}`);
    const r = kos(cozumle(komut), args, {
      cwd,
      stdio: 'inherit',
      env: ortam(),
      shell: process.platform === 'win32' && komut === 'npm',
    });
    if (r.error || r.status !== 0) {
      hata(`[prova] DUSTU: ${ad} (cikis ${r.status ?? 1}${r.error ? `, ${r.error.message}` : ''})`);
      return false;
    }
    return true;
  };
  try {
    if (!adim('temiz agac', 'git', ['worktree', 'add', '--detach', agac, 'HEAD'], kok)) return 1;
    if (!adim('teslim imzasi', process.execPath, ['scripts/teslim.cjs', '--yaz'], agac)) return 1;
    const silinecek = ['rm', '-r', '-q', '--ignore-unmatch', '--', ...KURUMA_GITMEYEN];
    if (!adim('kurum agaci (kuruma gitmeyenler silinir)', 'git', silinecek, agac)) return 1;
    for (const k of g.komutlar) {
      if (!adim(`groovy "${k}"`, 'npm', k.split(/\s+/), agac)) return 1;
    }
    const eksik = paketDenetle(agac, g.sikistir.from);
    if (eksik.length) {
      hata(`[prova] PAKET EKSIK (groovy ${g.sikistir.from} dizinini sikistirir):`);
      for (const e of eksik) hata(`  - ${e}`);
      return 1;
    }
    const paket = path.join(agac, CIKTI);
    if (!adim('calisma zamani modulleri', process.execPath, ['-e', MODUL_YUKLE], paket)) return 1;
    const dk = (simdi() - bas) / 60000;
    if (dk > SURE_SINIRI_DK) {
      hata(
        `[prova] SURE ASILDI: ${dk.toFixed(1)} dk > ${SURE_SINIRI_DK} dk (kurumsal is 15 dk'da kesilir).`,
      );
      return 1;
    }
    yaz(`[prova] tamam: ${dk.toFixed(1)} dk, paket ${CIKTI} -> ${g.sikistir.to}`);
    return 0;
  } finally {
    kos(cozumle('git'), ['worktree', 'remove', '--force', agac], { cwd: kok, stdio: 'ignore' });
    fs.rmSync(gecici, { recursive: true, force: true });
  }
}

/** `--node-surumu`: groovy'deki Node surumunu yazar (CI setup-node icin); argumansiz: prova. */
function main(argv, { kok = KOK, yaz = console.log, hata = console.error, ...secenek } = {}) {
  if (!argv.length) return prova({ kok, yaz, hata, ...secenek });
  if (argv[0] === '--node-surumu' && argv.length === 1) {
    try {
      yaz(groovyOku(fs.readFileSync(path.join(kok, GROOVY), 'utf8')).node);
      return 0;
    } catch (e) {
      hata(`[prova] ${e.message}`);
      return 1;
    }
  }
  hata('kullanim: node scripts/kurumsal-prova.cjs [--node-surumu]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  GROOVY,
  SURE_SINIRI_DK,
  PAKET_ICERIGI,
  MODUL_YUKLE,
  ayristir,
  groovyOku,
  paketDenetle,
  ortam,
  prova,
  main,
};
