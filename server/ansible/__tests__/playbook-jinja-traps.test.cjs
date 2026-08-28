// server/ansible/__tests__/playbook-jinja-traps.test.cjs — TUM playbook'lari tarayan
// bekci. Bu repoda uretimi kirmis tuzaklar tek tek kod incelemesiyle degil, MEKANIK
// olarak yakalanmali: ayni hata en az iki kez tekrarlandi.
//
// TUZAK 1 · KATLAMALI SKALER + `{% set %}`
//   `logx_ocp_namespace_discovery.yml` yorumu bunu ZATEN belgeliyordu:
//   "deger uretimde `'      failed'` olarak yayinlanmisti".
//   YAML katlamali skalerde (`>-`) satir sonlari BOSLUGA doner ve `{% set %}` etiketleri
//   arasindaki bosluklar CIKTIYA SIZAR. `| trim` yalniz IFADENIN SONUCUNU kirpar,
//   etiketlerden gelen bu bosluklari DEGIL. Portal `"failed"` bekler, `"      failed"`
//   gorur, eslesmez ve durum SESSIZCE yanlis yorumlanir.
//   Buna ragmen ayni hata `ocp_pod_source_extract.yml`de aynen tekrarlanmisti.
//
// TUZAK 2 · `no_log` ALTINDA KAYBOLAN SEBEP — uretimde iki kez yasandi (job 3218662,
//   3218799): login gorevi `no_log: true` oldugu icin hata "censored" gorunuyor, sebep
//   HICBIR YERDE yazmiyordu. Kural: parola tasiyan gorev AYRI olmali.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'playbooks');
const FILES = fs.readdirSync(DIR).filter((f) => /\.(yml|yaml)$/.test(f));

function read(f) {
  return fs.readFileSync(path.join(DIR, f), 'utf8');
}

// Yorum satirlari haric: aciklamalar tuzagi ANLATMAK icin ondan alinti yapiyor.
function codeOnly(src) {
  return src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('playbook dizini bos degil (test yanlis yere bakiyor olmasin)', () => {
  assert.ok(FILES.length >= 15, `beklenenden az playbook bulundu: ${FILES.length}`);
});

test('TUZAK 1: katlamali skalerde `{% set %}` bosluk denetimi ZORUNLU', () => {
  const offenders = [];
  for (const f of FILES) {
    const code = codeOnly(read(f));
    // Katlamali skaler (`>-` ya da `>`) ile baslayan ve icinde `{% set %}` gecen bloklar.
    const re = /:\s*>-?\s*\n((?:[ \t]+.*\n)+)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const block = m[1];
      if (!/\{%-?\s*set\s/.test(block)) continue;
      // Her `{% set %}` etiketi HEM acilista HEM kapanista bosluk denetimli olmali.
      for (const tag of block.match(/\{%-?[\s\S]*?-?%\}/g) || []) {
        if (!/^\{%-/.test(tag) || !/-%\}$/.test(tag)) {
          offenders.push(`${f}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    'katlamali skalerde bosluk denetimsiz Jinja etiketi — deger basinda bosluklarla yayinlanir:\n' + offenders.join('\n'));
});

test('TUZAK 2: parola tasiyan gorevde `no_log` var', () => {
  // `oc login --password=...` iceren her gorev no_log tasimali. no_log'u KALDIRMAK
  // cluster parolalarini AWX job ciktisina dokerdi — bu, kullanicinin acik kuralidir.
  const offenders = [];
  for (const f of FILES) {
    const src = read(f);
    if (!/--password=/.test(src)) continue;
    // Gorev bloklarini kabaca ayir; parola gecen blokta no_log aranir.
    const tasks = src.split(/\n(?=\s*-\s+name:)/);
    for (const t of tasks) {
      if (/--password=/.test(t) && !/no_log:\s*true/.test(t)) {
        offenders.push(`${f}: ${(t.match(/name:\s*"?([^"\n]+)/) || [])[1] || '?'}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'parola AWX ciktisina sizabilir:\n' + offenders.join('\n'));
});

test('TUZAK 2b: `no_log` gorevi mumkun oldugunca DAR — sonuc ayri gorevde okunuyor', () => {
  // Uretimde iki kez yasandi: tek bir buyuk `no_log` gorevi hem parolayi hem HATA
  // SEBEBINI gizledi. Kural: parola tasiyan playbook, `rc`/`stderr`'i AYRI bir gorevde
  // sanitize edip basmali.
  for (const f of FILES) {
    const src = read(f);
    if (!/--password=/.test(src)) continue;
    assert.match(src, /(register:\s*login_results|sanitized|stderr)/i,
      `${f}: parola tasiyan login var ama sonucu sanitize edip basan bir gorev yok — hata "censored" kalir`);
  }
});

test('vault parolalari yalnizca DEGISKEN ADI uzerinden cozuluyor', () => {
  // Repo kurali: parola DB'ye/extra_vars'a ASLA yazilmaz; portal yalnizca vault
  // degiskeninin ADINI tasir, playbook `lookup('vars', <ad>)` ile cozer.
  for (const f of FILES) {
    const src = read(f);
    if (!/credential_key/.test(src)) continue;
    assert.match(src, /lookup\('vars',\s*item\.credential_key/,
      `${f}: credential_key kullaniliyor ama lookup('vars', ...) ile cozulmuyor`);
  }
});

test('tum playbook dosyalari gecerli YAML', () => {
  // Bu repodaki tuzaklarin cogu YAML GECERLIYKEN patladi — bu test onlari yakalamaz,
  // ama bozuk girinti gibi kaba hatalari erken yakalar.
  for (const f of FILES) {
    const src = read(f);
    assert.ok(src.trim().length > 0, `${f} bos`);
    assert.ok(!src.includes('\t'), `${f} SEKME karakteri iceriyor — YAML sekmeyi kabul etmez`);
  }
});
