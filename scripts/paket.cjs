#!/usr/bin/env node
// scripts/paket.cjs — CALISMA ZAMANI PAKETI: kurumsal teslim dizini + sunucu kurulum zip'i (2026-11-12).
//
// NEDEN
//   Kurumsal bagimlilik taramasi `npm install`in kurdugu BUTUN agaci, gelistirme araclari dahil
//   tarar. vite / vitest'in kullandigi picomatch'in yayimlanmis duzeltmesi yok; tam agac "0 ihlal"
//   olamaz. Uretimde ise gelistirme araci CALISMAZ: sunucu yalniz calisma zamani bagimliliklarini
//   yukler, arayuz onceden derlenmis `dist/`tir. Bu betik tam olarak o agaci uretir:
//     - package.json'da devDependencies YOK; `npm run build` derleme degil, `dist/` DOGRULAMASI;
//     - package-lock.json repo kilidinden BUDANIR (yalniz calisma zamanindan erisilebilen girdiler,
//       surumler birebir ayni; yeniden cozumleme yok);
//     - `dist/` burada derlenir; dosya hash'leri `dist/.manifest.sha256`ya (sha256sum bicimi),
//       surum / commit `dist/.paket.json`a yazilir.
//   Taranan agac = kurulan agac. Ayni cikti hem kurumsal depoya giden kaynak dizini hem
//   `deploy/release.sh`in actigi zip'tir.
//
// KULLANIM
//   npm run paket -- --cikti <dizin> [--zip <dosya.zip>] [--derleme-yok]
//     --cikti        paket koku (yoksa olusturulur; DOLUYSA once bosaltilir)
//     --zip          ayrica `PORTAL-BMW-main/` kok dizinli zip (deploy/release.sh bunu bekler)
//     --derleme-yok  `npm run build` calistirma; mevcut dist/ kullanilir
//
// ON KONTROLLER (biri dusse paket URETILMEZ, cikis kodu 1)
//   - kopyalanan sunucu / paylasilan / betik kodu calisma zamaninda olmayan bir paketi yuklemiyor;
//   - paket icinde .env (sir) yok, test yok, node_modules yok;
//   - budanmis kilitteki her surum repo kilidindekiyle ayni.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { builtinModules } = require('node:module');

const KOK = path.join(__dirname, '..');

// ── Pakete girenler ─────────────────────────────────────────────────────────────────────────────
// Kok dizinden DAHIL edilenler (gerisi girmez: sunum/, araclar, yapilandirmalar, notlar).
const DAHIL = [
  'server',
  'shared',
  'src', // arayuz KAYNAGI: kurumsal kod incelemesi (Sonar) icin; calisma zamaninda dist/ kullanilir
  'public',
  'index.html',
  'deploy',
  'docs',
  'scripts',
  'tsconfig.json',
  'tsconfig.server-check.json',
  'README.md',
  '.env.example',
];
// Yalniz gelistirmede kullanilan betikler (gelistirme paketlerine ya da repo duzenine bagli).
const GELISTIRME_BETIKLERI = new Set([
  'scripts/run-tests.cjs',
  'scripts/check-ascii.cjs',
  'scripts/fix-ascii.cjs',
  'scripts/standardize-src.mjs',
  'scripts/devlog.sh',
  'scripts/devlog.ps1',
  'scripts/ui-tarama',
  'scripts/paket.cjs',
  'scripts/guvenlik-denetim.cjs',
]);

/** Kopyalanmayacak yol mu? `goreli` kok'e gore, `/` ayracli. */
function haricMi(goreli) {
  const parca = goreli.split('/');
  const ad = parca[parca.length - 1];
  if (parca.includes('node_modules') || parca.includes('__tests__')) return true;
  if (/\.test\.[cm]?[jt]sx?$/.test(ad) || /\.spec\.[cm]?[jt]sx?$/.test(ad)) return true;
  // Sir: .env, .env.prod ... (yalniz .env.example girer)
  if (/^\.env(\.|$)/.test(ad) && ad !== '.env.example') return true;
  if (ad === '.DS_Store') return true;
  for (const g of GELISTIRME_BETIKLERI) if (goreli === g || goreli.startsWith(`${g}/`)) return true;
  return false;
}

// ── package.json ────────────────────────────────────────────────────────────────────────────────
// Calisma zamaninda anlamli olan script'ler (gerisi vite / vitest / eslint / concurrently ister).
const CALISMA_SCRIPTLERI = [
  'server',
  'start',
  'dev:serve',
  'test:all',
  'qa',
  'prod',
  'preflight',
  'migrate',
  'db:seed',
  'playbook:rev',
  // Deploy oncesi sunucuda ic servis sertifikalarini dener (docs/TLS-SETUP.md); dotenv disinda bagimlilik yok.
  'tls:dene',
];

/** Repo package.json'undan calisma zamani package.json'u. Saf islev. */
function paketJson(kok) {
  const p = JSON.parse(JSON.stringify(kok));
  delete p.devDependencies;
  delete p['lint-staged'];
  const scripts = {};
  for (const ad of CALISMA_SCRIPTLERI)
    if (kok.scripts && kok.scripts[ad]) scripts[ad] = kok.scripts[ad];
  // `npm run build`: DERLEME DEGIL, hazir dist'in dogrulamasi (Jenkins, release.sh, run.sh cagirir).
  scripts.build = 'node scripts/dist-dogrula.cjs';
  scripts.test = 'node scripts/paket-duman.cjs';
  p.scripts = scripts;
  // Yalniz calisma zamani agacini ilgilendiren override'lar kalir (digerleri gelistirme araclari
  // icindir; eski npm surumlerinde agacta olmayan pakete override uyari uretebiliyor).
  if (p.overrides) {
    const calisma = new Set(Object.keys(kok.dependencies || {}));
    const o = {};
    for (const [k, v] of Object.entries(p.overrides)) if (calisma.has(k)) o[k] = v;
    if (Object.keys(o).length) p.overrides = o;
    else delete p.overrides;
  }
  return p;
}

// ── package-lock.json budama ────────────────────────────────────────────────────────────────────
/** npm'in modul cozumleme kurali, kilit yollari uzerinde: once kendi node_modules'u, sonra ustler. */
function cozumle(P, yer, ad) {
  let taban = yer;
  for (;;) {
    const aday = (taban ? `${taban}/` : '') + `node_modules/${ad}`;
    if (P[aday]) return aday;
    if (!taban) return null;
    const i = taban.lastIndexOf('/node_modules/');
    taban = i < 0 ? '' : taban.slice(0, i);
  }
}

/**
 * Repo kilidini calisma zamani paketine budar: kok `dependencies` (+ optional) ile baslar, her
 * girdinin dependencies / optionalDependencies / (zorunlu) peerDependencies baglarini npm cozumleme
 * kuraliyla izler. Erisilemeyen her girdi (gelistirme agaci) atilir. Surumler DEGISMEZ.
 * Saf islev; ag gerektirmez.
 */
function kilitBudama(kilit, pkg) {
  const P = kilit.packages || {};
  const tut = new Set(['']);
  const kuyruk = [''];
  const kokBag = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
  while (kuyruk.length) {
    const yer = kuyruk.shift();
    const g = yer === '' ? { dependencies: kokBag } : P[yer] || {};
    const peerOps = g.peerDependenciesMeta || {};
    const baglar = {
      ...(g.dependencies || {}),
      ...(g.optionalDependencies || {}),
      ...Object.fromEntries(
        Object.entries(g.peerDependencies || {}).filter(
          ([ad]) => !(peerOps[ad] && peerOps[ad].optional),
        ),
      ),
    };
    for (const ad of Object.keys(baglar)) {
      const hedef = cozumle(P, yer, ad);
      if (!hedef || tut.has(hedef)) continue;
      tut.add(hedef);
      kuyruk.push(hedef);
    }
  }
  const yeni = {};
  for (const [k, v] of Object.entries(P)) {
    if (!tut.has(k)) continue;
    const g = { ...v };
    if (k === '') {
      delete g.devDependencies;
      g.dependencies = { ...(pkg.dependencies || {}) };
    } else {
      delete g.dev;
      if (g.devOptional) {
        delete g.devOptional;
        g.optional = true;
      }
    }
    yeni[k] = g;
  }
  return { ...kilit, packages: yeni };
}

// ── Gelistirme paketi sizintisi ─────────────────────────────────────────────────────────────────
const YUKLEME = /(?:require\(\s*|import\(\s*|\bfrom\s+|^\s*import\s+)['"]([^'"./][^'"]*)['"]/gm;
const YERLESIK = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Paket adini ayiklar (`@kapsam/ad/alt` -> `@kapsam/ad`, `ad/alt` -> `ad`). */
function paketAdi(belirtec) {
  const p = belirtec.split('/');
  return belirtec.startsWith('@') ? p.slice(0, 2).join('/') : p[0];
}

/**
 * Calisma zamaninda yuklenen ama calisma zamani bagimliligi OLMAYAN paketler. `dosyalar`:
 * [{ goreli, metin }]. k6 betikleri (Ansible uzak hostta kosturur) Node'da yuklenmez.
 */
function devSizintisi(dosyalar, calismaZamani) {
  const izinli = new Set(calismaZamani);
  const bulgu = [];
  for (const { goreli, metin } of dosyalar) {
    for (const m of metin.matchAll(YUKLEME)) {
      const b = m[1];
      if (YERLESIK.has(b) || YERLESIK.has(b.split('/')[0])) continue;
      if (b === 'k6' || b.startsWith('k6/')) continue;
      const ad = paketAdi(b);
      if (!izinli.has(ad)) bulgu.push(`${goreli}: ${ad}`);
    }
  }
  return [...new Set(bulgu)].sort();
}

// ── dist manifesti ──────────────────────────────────────────────────────────────────────────────
function dosyaListesi(dizin, taban = dizin) {
  const out = [];
  for (const e of fs.readdirSync(dizin, { withFileTypes: true })) {
    const p = path.join(dizin, e.name);
    if (e.isDirectory()) out.push(...dosyaListesi(p, taban));
    else out.push(path.relative(taban, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function sha256(dosya) {
  return crypto.createHash('sha256').update(fs.readFileSync(dosya)).digest('hex');
}

// MANIFEST BICIMI sha256sum'un kendisi ("<hash>  <yol>"): `cd dist && sha256sum -c .manifest.sha256`
// ile de dogrulanir. JSON ("<yol>": "<hash>") BILEREK degil: adinda key / auth / token gecen bir
// dosyanin hash'i sir tarayicilarinda (gitleaks generic-api-key) "anahtar = deger" diye API anahtari
// sayiliyordu (yerel tarama, 2026-11-12). Surum / commit ayri, kucuk JSON'da.
const MANIFEST = '.manifest.sha256';
const PAKET_BILGI = '.paket.json';

function manifestYaz(distDizini, ek) {
  const satirlar = [];
  for (const f of dosyaListesi(distDizini)) {
    if (f === MANIFEST || f === PAKET_BILGI) continue;
    satirlar.push(`${sha256(path.join(distDizini, f))}  ${f}`);
  }
  fs.writeFileSync(path.join(distDizini, MANIFEST), `${satirlar.join('\n')}\n`);
  const bilgi = { ...ek, dosyaSayisi: satirlar.length };
  fs.writeFileSync(path.join(distDizini, PAKET_BILGI), `${JSON.stringify(bilgi, null, 2)}\n`);
  return bilgi;
}

// ── Kopyalama ───────────────────────────────────────────────────────────────────────────────────
function kopyala(kaynakKok, hedefKok) {
  const kopyalanan = [];
  const yuru = (goreli) => {
    const kaynak = path.join(kaynakKok, goreli);
    if (!fs.existsSync(kaynak) || haricMi(goreli)) return;
    const st = fs.statSync(kaynak);
    if (st.isDirectory()) {
      for (const ad of fs.readdirSync(kaynak)) yuru(`${goreli}/${ad}`);
      return;
    }
    const hedef = path.join(hedefKok, goreli);
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.copyFileSync(kaynak, hedef);
    fs.chmodSync(hedef, st.mode);
    kopyalanan.push(goreli);
  };
  for (const g of DAHIL) yuru(g);
  return kopyalanan;
}

function argumanlar(argv) {
  const a = { cikti: null, zip: null, derleme: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cikti') a.cikti = argv[++i];
    else if (argv[i] === '--zip') a.zip = argv[++i];
    else if (argv[i] === '--derleme-yok') a.derleme = false;
    else throw new Error(`bilinmeyen arguman: ${argv[i]}`);
  }
  if (!a.cikti) throw new Error('--cikti <dizin> gerekli');
  return a;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: KOK, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  const a = argumanlar(process.argv.slice(2));
  const cikti = path.resolve(a.cikti);
  if (cikti === KOK || cikti.startsWith(`${KOK}${path.sep}`))
    throw new Error('--cikti repo DISINDA olmali');
  const kokPkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  const kokKilit = JSON.parse(fs.readFileSync(path.join(KOK, 'package-lock.json'), 'utf8'));

  if (a.derleme) {
    console.log('[paket] arayuz derleniyor (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: KOK, stdio: 'inherit' });
  }
  const dist = path.join(KOK, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html')))
    throw new Error('dist/index.html yok - once derleyin');

  fs.rmSync(cikti, { recursive: true, force: true });
  fs.mkdirSync(cikti, { recursive: true });
  const kopyalanan = kopyala(KOK, cikti);
  fs.cpSync(dist, path.join(cikti, 'dist'), { recursive: true });
  for (const f of [MANIFEST, PAKET_BILGI, '.manifest.json'])
    fs.rmSync(path.join(cikti, 'dist', f), { force: true });

  const pkg = paketJson(kokPkg);
  fs.writeFileSync(path.join(cikti, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const kilit = kilitBudama(kokKilit, pkg);
  fs.writeFileSync(path.join(cikti, 'package-lock.json'), `${JSON.stringify(kilit, null, 2)}\n`);

  const commit = git('rev-parse', 'HEAD');
  const kirli = git('status', '--porcelain');
  manifestYaz(path.join(cikti, 'dist'), {
    surum: pkg.version,
    commit,
    kirliAgac: Boolean(kirli),
    olusturma: new Date().toISOString(),
  });
  fs.copyFileSync(path.join(KOK, 'docs', 'KURULUM-PAKET.md'), path.join(cikti, 'KURULUM.md'));

  // ── On kontroller ──
  const hatalar = [];
  const kod = kopyalanan
    .filter((f) => /^(server|shared|scripts)\//.test(f) && /\.(c?js|mjs)$/.test(f))
    .map((goreli) => ({ goreli, metin: fs.readFileSync(path.join(cikti, goreli), 'utf8') }));
  const sizinti = devSizintisi(kod, Object.keys(pkg.dependencies || {}));
  if (sizinti.length)
    hatalar.push(`calisma zamaninda olmayan paket yukleniyor:\n  ${sizinti.join('\n  ')}`);
  const yasak = dosyaListesi(cikti).filter((f) => haricMi(f) && !f.startsWith('dist/'));
  if (yasak.length)
    hatalar.push(`pakette olmamasi gereken dosya:\n  ${yasak.slice(0, 20).join('\n  ')}`);
  const surumFarki = Object.entries(kilit.packages)
    .filter(([k, v]) => k && (kokKilit.packages[k] || {}).version !== v.version)
    .map(([k]) => k);
  if (surumFarki.length) hatalar.push(`budanmis kilitte surum farki: ${surumFarki.join(', ')}`);
  for (const ad of Object.keys(pkg.dependencies || {})) {
    if (!kilit.packages[`node_modules/${ad}`])
      hatalar.push(`calisma zamani bagimliligi kilitte yok: ${ad}`);
  }
  execFileSync(process.execPath, [path.join(cikti, 'scripts', 'dist-dogrula.cjs')], {
    cwd: cikti,
    stdio: 'inherit',
  });
  if (hatalar.length) {
    console.error(`[paket] URETILMEDI:\n- ${hatalar.join('\n- ')}`);
    fs.rmSync(cikti, { recursive: true, force: true });
    process.exit(1);
  }

  if (a.zip) {
    const zip = path.resolve(a.zip);
    const gecici = fs.mkdtempSync(path.join(path.dirname(zip), '.paket-'));
    try {
      fs.cpSync(cikti, path.join(gecici, 'PORTAL-BMW-main'), { recursive: true });
      fs.rmSync(zip, { force: true });
      execFileSync('zip', ['-rq', zip, 'PORTAL-BMW-main'], { cwd: gecici });
    } finally {
      fs.rmSync(gecici, { recursive: true, force: true });
    }
    console.log(`[paket] zip: ${zip}`);
  }
  const say = Object.keys(kilit.packages).length - 1;
  console.log(
    `[paket] tamam: ${cikti} (${kopyalanan.length} kaynak dosya, ${say} calisma zamani paketi, commit ${commit || '?'}${kirli ? ' + KIRLI AGAC' : ''})`,
  );
}

module.exports = {
  DAHIL,
  haricMi,
  paketJson,
  cozumle,
  kilitBudama,
  devSizintisi,
  paketAdi,
  manifestYaz,
  MANIFEST,
  PAKET_BILGI,
  dosyaListesi,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`[paket] HATA: ${e.message}`);
    process.exit(1);
  }
}
