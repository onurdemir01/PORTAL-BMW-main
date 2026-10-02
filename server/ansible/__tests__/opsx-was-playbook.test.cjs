// server/ansible/__tests__/opsx-was-playbook.test.cjs - OpsX WAS playbook'lari: TEK host, YALNIZ was,
// sonuc sozlesmesi HER yolda.
//
// Tasarim 2026-10-02 (OpsX Legacy WAS), kullanici kararlari K1-a..K4-a. Kesin kurallar:
//   * WAS komutlari YALNIZ was (play duzeyi become: dzdo -> was); HTTP sunucusu kullanicisi yok.
//   * TOPLU ISLEM YOK: islem playbook'u tek string host (virgul yok) + assert + TEK add_host;
//     AWX'e limit GONDERILMEZ (AWX limit'i sessizce yutar), playbook'ta da 'limit' ve
//     'hosts: all' yok.
//   * Onay: consent + confirm_text == was_server, playbook assert'inde de.
//   * '#' satiri yok (aciklama README.md'de), ansible.builtin.script yok (copy + bash),
//     ansible_pipelining: true.
//   * Kume duzeyi komutlar, wsadmin kume betigi, komut satirinda kullanici/parola argumani,
//     toplu oldurme/baslatma opsx_was/** icinde GECMEZ.
//   * set_stats HER yolda (fail'den once, kosulsuz); uzak play rescue + ignore_unreachable.
//   * Envanter parolasi (tbmwans_pwd) yalniz no_log gorevin stdin'inden; environment ile
//     verilmez (Ansible ortam degerlerini become/dzdo komut satirina yazar).
//
// DAVRANIS burada OLCULMEZ (metin bekcisi): betik davranisi opsx-was-script.test.cjs'te,
// playbook karar zincirinin Jinja2 ile kosulmasi Ansible deposunda
// bmw_nginx/tests/check_opsx_was.py (W5) icinde. Gercek Ansible/AWX: README "Kanarya".
//
// OPSX_WAS_DIR: mutasyon kopyasi icin dizin (verilmezse depodaki ayna).
// OPSX_WAS_ANSIBLE_DEPO: Ansible deposu koku verilirse iki kopyanin BAYT BAYT ayni oldugu
// sinanir (logx-legacy-olculemedi X05 deseni).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../../util/guard-text.cjs');

const DIR = process.env.OPSX_WAS_DIR || path.join(__dirname, '..', 'bmw_portal', 'opsx_was');
const KESIF = path.join(DIR, 'opsx_was_discover.yml');
const ISLEM = path.join(DIR, 'opsx_was_operation.yml');
const BETIK = path.join(DIR, 'files', 'opsx_was.sh');
const ENVANTER = path.join(DIR, 'files', 'update_wasapp_status.py');
const README = path.join(DIR, 'README.md');
const oku = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// Kolon-0 "- " ile baslayan her blok bir play (playbook-jinja-traps.test.cjs ile ayni olcut).
function playler(src) {
  const out = [];
  let cur = null;
  for (const line of src.split('\n')) {
    if (/^- /.test(line)) {
      cur = { lines: [line] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return out.map((p) => {
    const text = p.lines.join('\n');
    return {
      text,
      hosts: ((text.match(/^ {2}hosts:\s*(.+)$/m) || [])[1] || '').trim(),
    };
  });
}

// Gorev bloklari: "    - name:" ile baslayan her parca (girinti fark etmez).
function gorevler(text) {
  return text.split(/\n(?=\s*- name:)/);
}

function yorumSatirlari(src) {
  return src
    .split('\n')
    .map((l, i) => [l, i + 1])
    .filter(([l]) => /^\s*#/.test(l))
    .map(([, i]) => i);
}

const YASAK = [
  '-password',
  '-user',
  'clusterServer',
  'stopCluster',
  'startCluster',
  'killall',
  'startApplicationServers',
  'www',
];

function yasakBul(src) {
  return YASAK.filter((y) => src.includes(y));
}

function tumDosyalar(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tumDosyalar(p));
    else out.push(p);
  }
  return out.sort();
}

for (const [ad, yol] of [
  ['kesif', KESIF],
  ['islem', ISLEM],
]) {
  test(`OW1 ${ad}: '#' satiri, SEKME ve ansible.builtin.script yok`, () => {
    const src = oku(yol);
    assert.deepEqual(yorumSatirlari(src), [], "'#' satiri var (aciklama README.md'ye)");
    assert.ok(!src.includes('\t'), 'SEKME karakteri var (YAML sekmeyi kabul etmez)');
    assert.ok(!/ansible\.builtin\.script\b/.test(src), 'script modulu kullanilmis (copy + bash olmali)');
    assert.ok(!/^\s+script:/m.test(src), 'kisa adli script modulu kullanilmis');
  });

  test(`OW2 ${ad}: become YALNIZ dzdo -> was; 'hosts: all', 'limit' ve www yok`, () => {
    const src = oku(yol);
    const users = [...src.matchAll(/become_user:\s*(\S+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(users)], ['was'], `become_user yalniz was olmali: ${users}`);
    const methods = [...src.matchAll(/become_method:\s*(\S+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(methods)], ['dzdo'], `become_method yalniz dzdo: ${methods}`);
    assert.ok(!/^\s*hosts:\s*all\s*$/m.test(src), "'hosts: all' var");
    assert.ok(!/(?<![\w])limit\s*:/.test(src), "'limit' anahtari var (AWX limit KULLANILMAZ)");
    assert.ok(!/\bwww\b/.test(src), 'www gecti (WAS komutlari YALNIZ was)');

    const p = playler(src);
    assert.equal(p.length, 3, 'uc play beklenir (girdi / uzak / sonuc)');
    assert.equal(p[0].hosts, 'localhost');
    assert.equal(p[2].hosts, 'localhost');
    const n = normalize(p[1].text);
    assert.ok(n.includes('become: true'), 'uzak play become: true degil');
    assert.ok(n.includes('become_method: dzdo'), 'uzak play become_method: dzdo degil');
    assert.ok(n.includes('become_user: was'), 'uzak play become_user: was degil');
    assert.ok(n.includes('ansible_pipelining: true'), 'uzak play ansible_pipelining: true degil');
    assert.ok(/^\s*ignore_unreachable:\s*true/m.test(p[1].text), 'uzak play ignore_unreachable yok');
    assert.ok(/^\s+rescue:/m.test(p[0].text), 'girdi play rescue yok');
    assert.ok(/^\s+rescue:/m.test(p[1].text), 'uzak play rescue yok');
    assert.ok(!/become_user/.test(p[0].text + p[2].text), 'localhost play become ediyor');
  });

  test(`OW3 ${ad}: hedef YALNIZ add_host ile; uzak play add_host grubunda`, () => {
    const p = playler(oku(yol));
    const add = gorevler(p[0].text).filter((t) => /ansible\.builtin\.add_host:/.test(t));
    assert.equal(add.length, 1, 'girdi blogunda TEK add_host gorevi beklenir');
    const grup = (add[0].match(/groups:\s*(\S+)/) || [])[1];
    assert.ok(grup, 'add_host grubu yok');
    assert.equal(p[1].hosts, grup, 'uzak play hosts add_host grubu degil');
  });

  test(`OW4 ${ad}: set_stats HER yolda - kosulsuz ve fail'den ONCE`, () => {
    const p = playler(oku(yol));
    const son = p[2].text;
    const ss = son.indexOf('ansible.builtin.set_stats:');
    const fail = son.indexOf('ansible.builtin.fail:');
    assert.ok(ss > 0, 'son play set_stats yok');
    assert.ok(fail > ss, "fail set_stats'ten once ya da yok (sonuc sozlesmesi yayinlanmaz)");
    const ssGorev = gorevler(son).find((t) => t.includes('ansible.builtin.set_stats:'));
    assert.ok(!/^\s+when:/m.test(ssGorev), 'set_stats kosullu');
    assert.ok(!/ansible\.builtin\.(set_stats|fail):/.test(p[0].text + p[1].text), 'set_stats/fail son play disinda');
  });
}

test('OW5 islem: TEK host, onay ve islem kumesi assert ediliyor', () => {
  const n = normalize(oku(ISLEM));
  for (const [parca, neden] of [
    ["',' not in target_host", 'tek host (virgul yok)'],
    ['target_host is string', 'target_host string (dizi = toplu islem)'],
    ["(consent | default(false) | string | lower) == 'true'", 'consent'],
    ["(confirm_text | default('') | string) == (was_server | string)", 'confirm_text == was_server'],
    ["in ['restart', 'stop', 'start']", 'operation kumesi'],
    ["is match('^[A-Za-z0-9_.-]+$')", 'ad bicimi'],
  ]) {
    assert.ok(n.includes(parca), `islem assert'inde eksik: ${neden}`);
  }
  const add = gorevler(playler(oku(ISLEM))[0].text).find((t) => /add_host:/.test(t));
  assert.ok(!/^\s+loop:/m.test(add), 'islem playbook add_host DONGUDE (toplu islem)');
  assert.ok(n.includes("name: '{{ opsx_was_target }}'"), 'add_host adi tek hedef degiskeni degil');
  assert.ok(
    n.includes("when: (opsx_was_final.result | default('OLCULEMEDI')) not in ['OK', 'SKIP']"),
    "FAIL/OLCULEMEDI'de job'i dusuren kosul yok",
  );
});

test('OW6 kesif: en cok 10 host, olculemeyen host listeden DUSMEZ', () => {
  const n = normalize(oku(KESIF));
  assert.ok(n.includes('(opsx_was_hosts | length) <= 10'), 'en cok 10 host assert yok');
  assert.ok(n.includes('target_hosts is string'), 'target_hosts string assert yok');
  assert.ok(
    n.includes('[hostvars[item].opsx_was_disc_host | default({'),
    'toplayici sonucsuz host icin olculemedi yedegi uretmiyor (host listeden duser)',
  );
  assert.ok(
    n.includes("loop: '{{ [] if (opsx_was_input_err is defined) else (opsx_was_hosts | default([])) }}'"),
    'toplayici ISTENEN host listesi uzerinde donmuyor',
  );
  // Kosul FAIL gorevinin when'inde aranir: ayni ifade ozet (debug) gorevinde de geciyor.
  const failGorevi = gorevler(playler(oku(KESIF))[2].text).find((t) => t.includes('ansible.builtin.fail:'));
  assert.ok(failGorevi, 'kesif toplayicisinda fail gorevi yok');
  const fw = normalize(failGorevi);
  assert.ok(fw.includes('(opsx_was_input_err is defined)'), 'girdi reddinde job dusmuyor');
  assert.ok(
    fw.includes("or ((opsx_was_disc_final.hosts | selectattr('overall', 'ne', 'ok') | list | length) > 0)"),
    "olculemeyen host'ta job'i dusuren kosul fail gorevinde yok",
  );
});

test('OW7 envanter: parola yalniz no_log gorevin stdin\'inden; SQL yalniz tek satir UPDATE', () => {
  const src = oku(ISLEM);
  const db = gorevler(src).filter((t) => t.includes('--pwd-stdin'));
  assert.equal(db.length, 1, 'parolayi stdin ile alan TEK envanter gorevi beklenir');
  const t = normalize(db[0]);
  assert.ok(t.includes('no_log: true'), 'envanter gorevi no_log degil');
  assert.ok(t.includes('delegate_to: GBLABT02'), "envanter gorevi GBLABT02'ye delegate degil");
  assert.ok(t.includes("stdin: '{{ tbmwans_pwd }}'"), 'parola stdin ile gitmiyor');
  assert.ok(!/environment:/.test(db[0]), 'envanter gorevinde environment (parola dzdo komut satirina sizar)');
  for (const g of gorevler(src)) {
    if (/environment:/.test(g)) assert.ok(!g.includes('tbmwans_pwd'), 'tbmwans_pwd environment ile veriliyor');
  }
  const py = oku(ENVANTER);
  assert.ok(
    normalize(py).includes(
      "'UPDATE dbo.WASAppsInventory SET status = ?, updated_at = SYSUTCDATETIME() ' 'WHERE host = ? AND app = ?'",
    ),
    'envanter SQL tek satir UPDATE ... WHERE host AND app degil',
  );
  for (const y of ['DELETE', 'INSERT', 'MERGE', 'TRUNCATE']) {
    assert.ok(!new RegExp(`["'][^"'\\n]*\\b${y}\\b`).test(py), `envanter betiginde ${y}`);
  }
  assert.ok(normalize(py).includes('DURUMLAR = (\'running\', \'stopped\')'), 'yalniz olculmus durumlar yazilmali');
});

test('OW8 opsx_was/** icinde yasak belirtec yok (README dahil)', () => {
  const bulgu = [];
  for (const f of tumDosyalar(DIR)) {
    for (const y of yasakBul(fs.readFileSync(f, 'utf8'))) bulgu.push(`${path.relative(DIR, f)}: ${y}`);
  }
  assert.deepEqual(bulgu, [], 'yasak belirtec');
});

test('OW9 betik: dzdo/sudo yok, was kapisi var, WAS komutlari timeout + </dev/null', () => {
  const kod = oku(BETIK)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.ok(!/\b(dzdo|sudo)\b/.test(kod), 'betikte dzdo/sudo (K1-a: become play duzeyinde)');
  assert.ok(/^WAS_USER=was$/m.test(kod), 'WAS_USER=was degil');
  assert.ok(/ME="\$\(id -un/.test(kod), "'id -un' kapisi yok");
  for (const c of ['serverStatus.sh', 'stopServer.sh', 'startServer.sh']) {
    const satir = kod.split('\n').filter((l) => l.includes(`/bin/${c}"`) && l.includes('timeout'));
    assert.equal(satir.length, 1, `${c} tek timeout'lu cagri olmali`);
    assert.ok(satir[0].includes('</dev/null'), `${c} </dev/null ile cagrilmiyor`);
  }
  assert.ok(kod.includes('ps -eo pid=,args= -ww'), 'ps -ww yok');
  assert.ok(kod.includes('$NF == s && $(NF-1) == n && $(NF-2) == c'), 'ps uclu TAM eslesme yok');
});

test('OW10 README sozlesmeyi anlatiyor', () => {
  const r = oku(README);
  for (const a of [
    'opsx_was_discover_result',
    'opsx_was_op_result',
    'OPSX_WAS_DISCOVER_TEMPLATE_ID',
    'OPSX_WAS_OPERATION_TEMPLATE_ID',
    'allow_simultaneous',
    'tbmwans_pwd',
    'Kanarya',
    'ADMU0509I',
    'kill -9',
  ]) {
    assert.ok(r.includes(a), `README'de yok: ${a}`);
  }
});

// -- bekcilerin KOR OLMADIGI: sentetik ihlaller yakalanir ---------------------------------
test('OW11 bekci KOR DEGIL: sentetik ihlaller yakalanir', () => {
  assert.deepEqual(yorumSatirlari('---\n- name: x\n  # yorum\n'), [3]);
  assert.deepEqual(yasakBul('wsadmin.sh -user a -password b'), ['-password', '-user']);
  assert.deepEqual(yasakBul('become_user: www'), ['www']);
  const p = playler('- name: a\n  hosts: localhost\n- name: b\n  hosts: hedef\n  become_user: was\n');
  assert.deepEqual(
    p.map((x) => x.hosts),
    ['localhost', 'hedef'],
  );
  const t = gorevler('    - name: a\n      x: 1\n    - name: b\n      ansible.builtin.set_stats:\n      when: x\n');
  assert.equal(t.length, 2);
  assert.ok(/^\s+when:/m.test(t[1]));
});

// -- iki depo BAYT BAYT ayni (X05 deseni) ------------------------------------------------
const ANSIBLE_DEPO = process.env.OPSX_WAS_ANSIBLE_DEPO || '';
test(
  'OW12 Portal ve Ansible deposundaki opsx_was/** BAYT BAYT ayni',
  {
    skip: ANSIBLE_DEPO
      ? false
      : 'OPSX_WAS_ANSIBLE_DEPO tanimli degil - yayinda iki depo icin diff -r elle (README "Bekciler")',
  },
  () => {
    const karsi = path.join(ANSIBLE_DEPO, 'bmw_portal', 'opsx_was');
    const a = tumDosyalar(DIR).map((f) => path.relative(DIR, f));
    const b = tumDosyalar(karsi).map((f) => path.relative(karsi, f));
    assert.deepEqual(a, b, 'dosya kumeleri farkli');
    for (const f of a) {
      assert.ok(
        fs.readFileSync(path.join(DIR, f)).equals(fs.readFileSync(path.join(karsi, f))),
        `${f} iki depoda farkli`,
      );
    }
  },
);
