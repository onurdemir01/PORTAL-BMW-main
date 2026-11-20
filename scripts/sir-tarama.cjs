// scripts/sir-tarama.cjs — eklenen satirlarda sir, eklenen dosyalarda yasak dosya arar (kalite kapisi K7).
//   node scripts/sir-tarama.cjs --staged          commit oncesi: sahnelenen fark (pre-commit)
//   node scripts/sir-tarama.cjs --aralik A..B     CI: PR / push araligindaki fark
//   node scripts/sir-tarama.cjs --mesaj <dosya>   commit mesaji (commit-msg)
//
// Repo PUBLIC: giren sir geri alinamaz (gecmis yazimi gerekir). Bu tarama son savunma degil ilk
// savunmadir; gitleaks kuruluysa --staged ayrica onu da kosturur.
//
// IKI SINIF: KESIN desenler (bulut / GitHub / Slack belirteci, imzali adres) her dosyada aranir.
// TEST DISI desenler (ozel anahtar basligi, JWT, parola atamasi, baglanti dizgisi, Bearer, adreste
// kimlik) test dosyalarinda aranmaz: maskeleme testleri bunlari sahte degerlerle sinar.
'use strict';

const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');

const KESIN = [
  ['AWS erisim anahtari', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub belirteci', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Slack belirteci', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API anahtari', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['imzali adres (sig=)', /[?&]sig=[A-Za-z0-9%_-]{20,}/],
];

const TEST_DISI_KESIN = [
  ['ozel anahtar', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

// Deger yer tutucu mu (sahte / sablon / degisken acilimi)? Genel desenlerde yanlis pozitifi keser.
// Biri tum degerle eslesirse yer tutucudur.
const YER_TUTUCU = [
  /^\*+$/, // ****
  /^x+$/i, // xxxx
  /^\.{3}$/, // ...
  /^<[^>]*>$/, // <parola>
  /^\$.*$/, // $DEGISKEN, ${DEGISKEN}
  /^\{\{.*\}\}$/, // {{ jinja }}
  /^%[a-z_]+%$/i, // %WINDOWS_DEGISKENI%
  /^(?:changeme|example|ornek|dummy|placeholder|secret|password|parola|sifre|redacted|gizli)$/i,
];
const yerTutucuMu = (v) => YER_TUTUCU.some((d) => d.test(v));

// Sir gibi gorunen deger: rakam ve harf birlikte ya da 16+ karakter. 'user_pass' gibi
// tanimlayicilar (ornegin `token ? 'token' : 'user_pass'`) bu yuzden bulgu sayilmaz.
const SIR_GIBI = (v) => (/\d/.test(v) && /[A-Za-z]/.test(v)) || v.length >= 16;

const GENEL = [
  [
    'parola / belirtec atamasi',
    /\b(?:password|passwd|pwd|parola|sifre|secret|token|api[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
  ],
  ['baglanti dizgisi parolasi', /;\s*(?:pwd|password)\s*=\s*([^;\s"'`]{6,})/i],
  ['Bearer belirteci', /\bBearer\s+([A-Za-z0-9._~+/-]{24,})/],
  ['adreste kimlik bilgisi', /:\/\/[^/\s:@'"`]+:([^@\s/'"`]{4,})@/],
];

const TEST_DOSYASI = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$|^src\/test\//;

// Eklenmesi yasak dosyalar (yol). .env.example serbest.
const YASAK_DOSYA = [
  [/\.har$/i, 'HAR kaydi (oturum cerezi, parola, kisisel veri tasir)'],
  [/(^|\/)\.env(\.[^/]*)?$/, 'ortam dosyasi'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, 'anahtar / sertifika deposu'],
  [/(^|\/)id_(rsa|ecdsa|ed25519)$/, 'SSH ozel anahtari'],
];
const YASAK_ISTISNA = /(^|\/)\.env\.example$/;

/** Tek satir -> bulgu adlari. Saf islev. */
function satirTara(satir, { test = false } = {}) {
  const out = [];
  for (const [ad, re] of KESIN) if (re.test(satir)) out.push(ad);
  if (test) return out;
  for (const [ad, re] of TEST_DISI_KESIN) if (re.test(satir)) out.push(ad);
  for (const [ad, re] of GENEL) {
    const m = re.exec(satir);
    if (m && !yerTutucuMu(m[1]) && SIR_GIBI(m[1])) out.push(ad);
  }
  return out;
}

/** Dosya yolu yasak mi? -> sebep ya da null. Saf islev. */
function dosyaYasak(yol) {
  if (YASAK_ISTISNA.test(yol)) return null;
  const hit = YASAK_DOSYA.find(([re]) => re.test(yol));
  return hit ? hit[1] : null;
}

/** `git diff -U0` ciktisi -> eklenen satirlar [{ dosya, satir, metin }]. Saf islev. */
function farkAyristir(fark) {
  const satirlar = [];
  let dosya = null;
  let no = 0;
  for (const s of String(fark).split('\n')) {
    if (s.startsWith('+++ ')) {
      dosya = s === '+++ /dev/null' ? null : s.replace(/^\+\+\+ b\//, '');
    } else if (s.startsWith('@@')) {
      const m = /\+(\d+)/.exec(s);
      no = m ? Number(m[1]) : 0;
    } else if (dosya && s.startsWith('+')) {
      satirlar.push({ dosya, satir: no, metin: s.slice(1) });
      no += 1;
    }
  }
  return satirlar;
}

/** Fark metni + eklenen dosya listesi -> bulgular. Saf islev. */
function farkTara(fark, eklenenDosyalar = []) {
  const bulgular = [];
  for (const yol of eklenenDosyalar) {
    const sebep = dosyaYasak(yol);
    if (sebep) bulgular.push({ dosya: yol, satir: 0, ad: `yasak dosya: ${sebep}` });
  }
  for (const { dosya, satir, metin } of farkAyristir(fark))
    for (const ad of satirTara(metin, { test: TEST_DOSYASI.test(dosya) }))
      bulgular.push({ dosya, satir, ad });
  return bulgular;
}

const git = (args) =>
  execFileSync(aracYolu('git'), args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function rapor(bulgular, baglam) {
  if (!bulgular.length) {
    console.log(`[sir-tarama] temiz (${baglam}).`);
    return 0;
  }
  console.error(
    `[sir-tarama] KIRMIZI (${baglam}): ${bulgular.length} bulgu. Degerler yazdirilmaz.`,
  );
  for (const b of bulgular.slice(0, 50))
    console.error(`  - ${b.dosya}${b.satir ? ':' + b.satir : ''}  ${b.ad}`);
  console.error(
    '  Sir ise: commit etme, degeri dondur (rotate). Yer tutucu ise: ${DEGISKEN} / <...> / *** kullan.',
  );
  return 1;
}

function main(argv) {
  if (argv.includes('--mesaj')) {
    const yol = argv[argv.indexOf('--mesaj') + 1];
    const metin = fs.readFileSync(yol, 'utf8');
    const bulgular = [];
    metin.split('\n').forEach((s, i) => {
      if (s.startsWith('#')) return;
      for (const ad of satirTara(s)) bulgular.push({ dosya: 'commit mesaji', satir: i + 1, ad });
    });
    return rapor(bulgular, 'commit mesaji');
  }
  if (argv.includes('--aralik')) {
    const aralik = argv[argv.indexOf('--aralik') + 1];
    const fark = git(['diff', '-U0', '--no-color', '--no-ext-diff', aralik]);
    const eklenen = git(['diff', '--name-only', '--diff-filter=AR', aralik])
      .split('\n')
      .filter(Boolean);
    return rapor(farkTara(fark, eklenen), aralik);
  }
  // --staged (varsayilan)
  const fark = git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']);
  const eklenen = git(['diff', '--cached', '--name-only', '--diff-filter=AR'])
    .split('\n')
    .filter(Boolean);
  let rc = rapor(farkTara(fark, eklenen), 'sahnelenen fark');
  // gitleaks istege bagli: kurulu degilse atlanir; kuruluysa hatasi da bulgusu da kirmizidir.
  const gitleaks = aracYolu('gitleaks', { zorunlu: false });
  if (gitleaks) {
    const gl = spawnSync(gitleaks, ['protect', '--staged', '--redact', '--no-banner'], {
      stdio: 'inherit',
    });
    if (gl.error || gl.status !== 0) rc = 1;
  }
  return rc;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { satirTara, dosyaYasak, farkAyristir, farkTara, yerTutucuMu };
