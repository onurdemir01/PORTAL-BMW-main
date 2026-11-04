// server/ansible/__tests__/kabuk-rhel8-tabani.test.cjs — AWX agacindaki kabuk kodu RHEL 8 bash'inde calisir.
//
// Hedef sunucular RHEL 8 / 9: bash 4.4 / 5.1 (kullanici, 2026-11-04: "rhel 8/9 uyumlu olmasidir").
// Taban RHEL 8'in 4.4'u: bash 5'e ozgu bir yapi RHEL 9'da calisir, RHEL 8'de SESSIZCE bozulur
// (bilinmeyen degisken bos gelir, bilinmeyen secenek hata verir). Gelistirici makinesindeki
// bash (macOS 3.2 ya da Homebrew 5.x) bunu gostermez; bu bekci kaynagi okur.
//
// KR1 .sh betikleri ve playbook'lardaki satir ici kabuk bash 5'e ozgu yapi kullanmaz.
// KR2 desenler kor degil: bilinen ornekleri yakalar, bash 4.4'te olanlari (mapfile, @Q) yakalamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AGAC = path.join(__dirname, '..', 'bmw_portal');

// bash 5.0 / 5.1 / 5.2 ile gelenler. 4.4'te OLANLAR (mapfile, ${x@Q}, ${x@E}, ${x@P}, ${x@A},
// ${x@a}, declare -A, ${x,,}) burada YOK.
// `degisken`: ayni satirda `${AD:-` ile bos-kontrolu yapilan kullanim KORUMALIDIR (bash < 5'te
// bos gelir, satir yedege duser: `t="${EPOCHREALTIME:-}"; [ -n "$t" ] || t=$(date +%s.%N)`).
// Yuk testi ve ScaleX betikleri bu deseni bilerek kullanir.
const BASH5 = [
  { ad: 'EPOCHSECONDS (5.0)', re: /\$\{?EPOCHSECONDS\b/, degisken: 'EPOCHSECONDS' },
  { ad: 'EPOCHREALTIME (5.0)', re: /\$\{?EPOCHREALTIME\b/, degisken: 'EPOCHREALTIME' },
  { ad: 'BASH_ARGV0 (5.0)', re: /\bBASH_ARGV0\b/, degisken: 'BASH_ARGV0' },
  { ad: 'SRANDOM (5.1)', re: /\$\{?SRANDOM\b/, degisken: 'SRANDOM' },
  { ad: 'wait -p (5.1)', re: /\bwait\s+(-[a-z]*\s+)*-p\b/ },
  { ad: '${x@U} / ${x@u} / ${x@L} / ${x@K} / ${x@k} (5.1+)', re: /\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?@[UuLKk]\}/ },
  { ad: 'shopt localvar_inherit / localvar_unset / assoc_expand_once (5.0+)', re: /\bshopt\s+-[su]\s+(localvar_inherit|localvar_unset|assoc_expand_once)\b/ },
  { ad: 'shopt patsub_replacement (5.2)', re: /\bshopt\s+-[su]\s+patsub_replacement\b/ },
];

function dosyalar(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dosyalar(p, out);
    else if (/\.(sh|ya?ml)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Yorum satirlari (# ...) taranmaz: aciklamada yapinin ADI gecebilir.
const kodSatirlari = (metin) => metin.split('\n').map((s, i) => [i + 1, s]).filter(([, s]) => !/^\s*#/.test(s));

function ihlaller(metin) {
  const bul = [];
  for (const [no, satir] of kodSatirlari(metin)) {
    for (const d of BASH5) {
      if (!d.re.test(satir)) continue;
      if (d.degisken && satir.includes('${' + d.degisken + ':-')) continue; // korumali kullanim
      bul.push(`${no}: ${d.ad}`);
    }
  }
  return bul;
}

test('KR1 AWX agacindaki kabuk kodu bash 5e ozgu yapi kullanmiyor (RHEL 8 = bash 4.4)', () => {
  const liste = dosyalar(AGAC);
  assert.ok(liste.filter((f) => f.endsWith('.sh')).length >= 5, `kabuk betikleri bulunamadi (${AGAC}) - bekci yanlis yere bakiyor`);
  assert.ok(liste.some((f) => f.endsWith(path.join('opsx_was', 'files', 'opsx_was.sh'))), 'opsx_was.sh taranmiyor');
  const bad = [];
  for (const f of liste) {
    for (const i of ihlaller(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(AGAC, f)}:${i}`);
  }
  assert.deepEqual(bad, [], `RHEL 8 bash 4.4'te olmayan yapi:\n${bad.join('\n')}`);
});

test('KR2 desenler kor degil: bash 5 orneklerini yakalar, bash 4.4 yapilarini yakalamaz', () => {
  const yakalanmali = [
    'now=$EPOCHSECONDS',
    't=${EPOCHREALTIME}',
    'r=$SRANDOM',
    'wait -n -p bitti',
    'echo "${ad@U}"',
    'echo "${dizi[0]@L}"',
    'shopt -s localvar_inherit',
  ];
  for (const s of yakalanmali) assert.equal(ihlaller(s).length, 1, `yakalanmadi: ${s}`);
  const serbest = [
    'mapfile -t PLIST <<< "$pnames"',
    'echo "${ad@Q}"',
    'declare -A m',
    'x=${y,,}',
    '# $EPOCHSECONDS yorumda',
    // korumali (bash < 5'te yedege duser): yuk testi / ScaleX betiklerindeki gercek desen
    't="${EPOCHREALTIME:-}"; [ -n "$t" ] || t="$(date +%s.%N 2>/dev/null)"',
    'simdi() { if [ -n "${EPOCHSECONDS:-}" ]; then echo "$EPOCHSECONDS"; else date +%s; fi; }',
  ];
  for (const s of serbest) assert.deepEqual(ihlaller(s), [], `yanlis alarm: ${s}`);
});
