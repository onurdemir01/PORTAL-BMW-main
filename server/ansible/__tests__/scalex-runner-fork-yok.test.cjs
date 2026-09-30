// server/ansible/__tests__/scalex-runner-fork-yok.test.cjs
//
// KESIF RUNNER'I: UYGULAMA BASINA SUREC YOK, YETKISIZ TIP TEK TURDA (PR-N, v24).
//
// AWX 3365168/81/88 (2026-09-30): 19 uygulamalik kesif 1 uygulamalikten ~3,5 sn
// uzun. Sebep `oc` degil: `disc_emit_kind` satir BASINA ~70-80 surec aciyordu
// (`log` alan basina `$(sanitize)` = alt kabuk + tr|sed|cut, `$(disc_val)` x9,
// `disc_read_state` icinde safe_name/awk/cut/grep). Ayrica atfi kurulamayan
// ekstra CRD'ler ve yetkisiz tipler SIRAYLA tekil cekiliyordu.
//
//   N1  satir dongusunde `$(` yok + dis komut sayisi uygulama sayisindan BAGIMSIZ
//   N2  cikti v23 altin ciktisiyla BAYT BAYT ayni (bilincli farklar ayrica)
//   N3  yetkisiz obek: tekil `get` YOK, kalanlar TEK cagriyla
//   N4  sanitize/disc_val fuzz: yeni = eski boru hatti
//   N5  tekil cekimler AYNI ANDA (iz ic ice)
//   N6  durum birlestirme `awk`i duserse durum bilgisi KAYBOLMAZ
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  SENARYOLAR,
  TEMEL_MODEL,
  kostur,
  RUNNER,
} = require('./fixtures/scalex-kesif-senaryolar.cjs');
const ALTIN = require('./fixtures/scalex-kesif-altin.json');

const KAYNAK = fs.readFileSync(RUNNER, 'utf8');

function govde(ad) {
  const bas = KAYNAK.indexOf(`\n${ad}() {\n`);
  assert.ok(bas >= 0, `${ad} bulunamadi`);
  const son = KAYNAK.indexOf('\n}\n', bas);
  return KAYNAK.slice(bas + 1, son + 2);
}

// ── N1 ─────────────────────────────────────────────────────────────────────
test('N1a disc_emit_kind satir dongusunde alt kabuk/boru yok', () => {
  const g = govde('disc_emit_kind');
  const bas = g.indexOf("while IFS='|' read -r");
  const son = g.indexOf('done < "$j"');
  assert.ok(bas > 0 && son > bas, 'satir dongusu bulunamadi');
  const dongu = g
    .slice(bas, son)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(dongu, /\$\((?!\()/, 'dongude $( ... ) var');
  assert.doesNotMatch(dongu, /`/, 'dongude ters tirnak var');
  // Dongunun cagirdigi yardimcilar da surec acmamali.
  for (const f of [
    'sanitize_v',
    'log',
    'disc_val_v',
    'disc_has_hpa_v',
    'disc_gitops_v',
    'disc_app_wanted',
    'kind_to_display_v',
  ]) {
    const fg = govde(f)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    assert.doesNotMatch(fg, /\$\((?!\()|`|\|\s*(tr|sed|cut|grep|awk)\b/, `${f} surec aciyor`);
  }
});

// PATH shim: dis komutlari sayar (oc haric). Alt kabuklar burada gorunmez;
// onlari N1a kilitler.
function shimDizini(log) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-shim-'));
  for (const k of [
    'awk',
    'grep',
    'sed',
    'tr',
    'cut',
    'cat',
    'sort',
    'wc',
    'paste',
    'head',
    'tail',
  ]) {
    const gercek = execFileSync('bash', ['-c', `command -v ${k}`], { encoding: 'utf8' }).trim();
    fs.writeFileSync(
      path.join(dir, k),
      `#!/bin/bash\nprintf '%s\\n' ${k} >> ${JSON.stringify(log)}\nexec ${gercek} "$@"\n`,
      { mode: 0o755 },
    );
  }
  return dir;
}
function disKomutSayisi(n) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-shimlog-')), 'l');
  fs.writeFileSync(log, '');
  const shim = shimDizini(log);
  const deploy = Array.from({ length: n }, (_, i) => ({
    name: `app-${i}`,
    spec: 1,
    labels: i % 2 ? { 'argocd.argoproj.io/instance': 'x' } : {},
  }));
  const cm = {};
  for (let i = 0; i < n; i += 3)
    cm[`scalex-state-app-${i}`] = { app: `app-${i}`, previous_replicas: '2', phase: 'scaled_down' };
  const r = kostur(
    {
      model: {
        nesneler: { ...TEMEL_MODEL.nesneler, deploy },
        cm,
        hpa: [{ name: 'h', target: 'app-1' }],
      },
    },
    { pathEk: shim },
  );
  const sayi = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  fs.rmSync(shim, { recursive: true, force: true });
  return { sayi, satir: r.satirlar.filter((l) => l.includes(';WORKLOAD;OK;')).length };
}

test('N1b dis komut sayisi uygulama sayisiyla BUYUMUYOR (N=2 vs N=40)', () => {
  const az = disKomutSayisi(2);
  const cok = disKomutSayisi(40);
  // deploy N + sts 2 + dc 1 + rollout 1 + ds 2 + cronjob 2
  assert.equal(az.satir, 2 + 8, 'N=2 satir sayisi');
  assert.equal(cok.satir, 40 + 8, 'N=40 satir sayisi');
  assert.equal(cok.sayi, az.sayi, `N=2: ${az.sayi} komut, N=40: ${cok.sayi} komut`);
});

// ── N2 ─────────────────────────────────────────────────────────────────────
for (const s of SENARYOLAR) {
  test(`N2 altin cikti: ${s.ad}`, () => {
    const yeni = kostur(s).satirlar;
    const eski = ALTIN[s.ad];
    assert.ok(eski, 'altin kayit yok');
    if (!s.bilinenFark) {
      assert.deepEqual(yeni, eski);
      return;
    }
    // BILINCLI FARK (v24): satirsiz + rc=1 obekte eski yol `SCAN;WARN;call_failed`
    // basip tipleri SIRAYLA tekil cekiyordu. Yeni yol yetkisiz tipi hata
    // metninden ayirir: SCAN satiri yok, tip satirlari AYNI (sira farkli olabilir).
    assert.ok(!yeni.some((l) => l.includes('reason=call_failed')), 'call_failed hala basiliyor');
    const beklenen = eski.filter((l) => !l.includes('reason=call_failed'));
    assert.deepEqual([...yeni].sort(), [...beklenen].sort());
  });
}

// ── N3 ─────────────────────────────────────────────────────────────────────
function tekilGetler(cagrilar) {
  return cagrilar.filter((c) => /^get [^ ,]+ -n \S+ --allow-missing-template-keys=true/.test(c));
}
function birlesikGetler(cagrilar) {
  return cagrilar.filter((c) =>
    /^get [^ ]+,[^ ]+ -n \S+ --allow-missing-template-keys=true/.test(c),
  );
}

test('N3a tamami yetkisiz obek: tekil get YOK, hepsi no_permission', () => {
  const s = SENARYOLAR.find((x) => x.ad === 'hepsi-yasak');
  const r = kostur(s);
  assert.deepEqual(tekilGetler(r.cagrilar), []);
  assert.equal(birlesikGetler(r.cagrilar).length, 1);
  const warn = r.satirlar.filter((l) => l.includes(';WORKLOAD_KIND;WARN;'));
  assert.equal(warn.length, 6);
  assert.ok(warn.every((l) => l.includes('reason=no_permission')));
});

test('N3b bos namespace + tek yetkisiz tip: kalan bes tip TEK cagriyla', () => {
  const s = SENARYOLAR.find((x) => x.ad === 'bos-ns-yasak');
  const r = kostur(s);
  assert.deepEqual(tekilGetler(r.cagrilar), []);
  const b = birlesikGetler(r.cagrilar);
  assert.equal(b.length, 2, b.join('\n'));
  assert.ok(!b[1].includes('rollouts.argoproj.io'), 'yetkisiz tip yeniden denendi');
  assert.equal(b[1].split(' ')[1].split(',').length, 5);
  const ok = r.satirlar.filter((l) => l.includes(';WORKLOAD_KIND;OK;'));
  assert.equal(ok.length, 5);
});

test('N3c API yoklugu ile yetki reddi karismaz (absent once, sonra forbidden)', () => {
  const r = kostur({
    model: {
      yokTipler: ['rollout'],
      yasakTipler: ['sts'],
      nesneler: { deploy: [], sts: [], dc: [], rollout: [], ds: [], cronjob: [] },
    },
  });
  const w = (k) =>
    r.satirlar.find((l) => l.includes(`;WORKLOAD_KIND;`) && l.includes(`kind=${k} `));
  assert.match(w('rollout'), /reason=api_absent/);
  assert.match(w('sts'), /reason=no_permission/);
  assert.deepEqual(tekilGetler(r.cagrilar), []);
  assert.equal(birlesikGetler(r.cagrilar).length, 3);
});

// ── N4 ─────────────────────────────────────────────────────────────────────
test('N4 sanitize_v / disc_val_v eski boru hattiyla ayni (fuzz)', () => {
  const al = 'ab ;\t\n\r\v\f  xyz-_.:/|ç🙂';
  let tohum = 12345;
  const rnd = () => (tohum = (tohum * 1103515245 + 12345) % 2147483648) / 2147483648;
  const r = (n) => Array.from({ length: n }, () => al[Math.floor(rnd() * al.length)]).join('');
  const girdiler = ['', ' ', '  ', ' a ', '\n\n', 'a\r\nb', ';;;', '\t\t x \t', '-'];
  for (let i = 0; i < 120; i++) girdiler.push(r(Math.floor(rnd() * 60)));
  // Uzun girdiler ASCII: BSD `cut -c` yerel ayara gore karakter, GNU bayt sayar.
  for (let i = 0; i < 12; i++) girdiler.push('x'.repeat(1590 + i) + ' \t;y'.repeat(i));
  for (let i = 0; i < 8; i++) girdiler.push('  '.repeat(900) + 'z'.repeat(i * 150));
  const betik = [
    'set -u',
    KAYNAK.match(/^_NL=.*$/m)[0],
    KAYNAK.match(/^_CR=.*$/m)[0],
    KAYNAK.match(/^_TAB=.*$/m)[0],
    govde('sanitize_v'),
    govde('disc_val_v'),
    `eski_s() { printf '%s' "\${1:-}" | tr '\\n\\r;' '   ' | sed 's/[[:space:]][[:space:]]*/ /g' | cut -c1-1600; }`,
    `eski_d() { local v; v="$(printf '%s' "\${1:-}" | tr -d '\\n\\r' | tr ' \\t;' '___')"; [ -z "$v" ] && v="-"; printf '%s' "$v"; }`,
    'n=0; bad=0',
    'while IFS= read -r -d "" x; do',
    '  n=$((n+1))',
    '  a="$(eski_s "$x")"; sanitize_v b "$x"',
    '  [ "$a" = "$b" ] || { bad=$((bad+1)); printf "S %q\\n" "$x" >&2; }',
    '  a="$(eski_d "$x")"; disc_val_v b "$x"',
    '  [ "$a" = "$b" ] || { bad=$((bad+1)); printf "D %q\\n" "$x" >&2; }',
    'done',
    'echo "$n $bad"',
  ].join('\n');
  const p = spawnSync('bash', ['-c', betik], {
    input: girdiler.join('\0') + '\0',
    encoding: 'utf8',
  });
  assert.equal(p.status, 0, p.stderr);
  const [n, bad] = p.stdout.trim().split(' ').map(Number);
  assert.equal(n, girdiler.length);
  assert.equal(bad, 0, p.stderr.slice(0, 2000));
});

// ── N5 ─────────────────────────────────────────────────────────────────────
test('N5 ekstra CRD tekil cekimleri AYNI ANDA ve on-cekimle birlikte', () => {
  const iz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-iz-')), 'iz');
  fs.writeFileSync(iz, '');
  const s = SENARYOLAR.find((x) => x.ad === 'crd');
  const r = kostur({
    model: {
      ...s.model,
      yavas: {
        'kafkas.kafka.strimzi.io': 1500,
        'conjurfollowers.conjur.cyberark.com': 1500,
        'prometheuses.metrics.example.com': 1500,
      },
    },
    env: { ...s.env, SAHTE_OC_IZ: iz },
  });
  const satirlar = fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean);
  const ilkBitti = satirlar.findIndex((l) => l.startsWith('BITTI'));
  const bastanBasla = satirlar.slice(0, ilkBitti).filter((l) => l.startsWith('BASLA')).length;
  assert.equal(bastanBasla, 3, `iz ic ice degil:\n${satirlar.join('\n')}`);
  // Satirlar yine SIRALI ve altinla ayni.
  assert.deepEqual(r.satirlar, ALTIN.crd);
});

// ── N6 ─────────────────────────────────────────────────────────────────────
test('N6 durum birlestirme awk`i duserse eski tekil yola duser (satirlar ayni)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-awkkir-'));
  const gercek = execFileSync('bash', ['-c', 'command -v awk'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(dir, 'awk'),
    `#!/bin/bash\ncase "$*" in *'FILENAME == sf'*) exit 2 ;; esac\nexec ${gercek} "$@"\n`,
    { mode: 0o755 },
  );
  const r = kostur(
    SENARYOLAR.find((x) => x.ad === 'temel'),
    { pathEk: dir },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(r.satirlar, ALTIN.temel);
});
