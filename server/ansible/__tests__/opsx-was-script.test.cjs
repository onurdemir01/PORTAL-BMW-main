// server/ansible/__tests__/opsx-was-script.test.cjs - OpsX WAS betigi (opsx_was.sh) DAVRANISI.
//
// GERCEK betik kosulur; WAS araclari sahtedir: ps, id, serverStatus.sh, stopServer.sh,
// startServer.sh, setupCmdLine.sh, serverindex.xml, cluster.xml, soap.client.props. JVM'ler
// GERCEK kukla sureclerdir (sleep): betigin kill -9'u yalniz kuklalari oldurebilir, bekci
// makinesinde rastgele bir sureci degil.
//
// Tasarim (4) senaryolari:
//   S1 kimlik hatasi -> OLCULEMEDI, ASLA STOPPED (WAS kimlik/yetki hatasinda da "appears to be
//      stopped" basabilir; kimlik satiri yoksa serverStatus hic kosmaz)
//   S2 app1 / app10 karismaz (ps argv'sinin son uc alani <cell> <node> <server> TAM eslesme)
//   S3 ayni ucluyle N=2 surec -> ret (COKLU_SUREC, komut yok)
//   S4 stop sonrasi JVM geri gelir (nodeagent) -> FAIL
//   S5 id -un != was -> FAIL, hicbir WAS komutu kosmaz
//   S6 K3-a: stop'ta sure dolar -> FAIL ve kill YOK; restart'ta sure dolar + TEK PID -> kill -9 +
//      start; iki PID -> kill YOK
//   S0 bash/timeout yoksa ACIK skip mesaji (yesil donmez, atlandigi yazar)
// 2026-10-02 duzeltici turu (dogrulanmis bulgular; Ansible bekcisinde D11-D15/O18-O22):
//   S7 restart'ta stop HIZLI reddedilirse (ADMN0022E, rc 126) yanit veren JVM'e kill -9 YOK;
//      ASKIDA'da kill -9 + start; stop_dogrulama hedefe ulasmadiysa FAIL
//   S8 adinda AUTHORIZ/PASSWORD/... gecen JVM kendi adi yuzunden OLCULEMEDI olmaz; adi kodla
//      cakisan JVM'de SECJ kodu yine yakalanir; kodsuz serbest metin kimlik hatasi '?'
//   S9 kesif sure butcesi: serverStatus kosmaz, OLCULEMEDI, mesaj acik
//   S10 dis sinir dolarsa RESULT basilir, ic WAS komutu YETIM KALMAZ
// Her kosuda: son satir RESULT, rc sozlesmesi (OK/SKIP 0, FAIL 1, OLCULEMEDI 3), soap.client.props
// icerigi ve parolalar ciktida yok.
//
// Daha genis senaryo kumesi (TOCTOU SKIP, ASKIDA, erisilemeyen profil, cluster, Dmgr deposu,
// maske, Jinja karar zinciri, envanter): Ansible deposunda bmw_nginx/tests/check_opsx_was.py.
// OPSX_WAS_DIR: mutasyon kopyasi dizini (verilmezse depodaki ayna).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, posixYol } = require('./fixtures/kabuk.cjs');

const DIR = process.env.OPSX_WAS_DIR || path.join(__dirname, '..', 'bmw_portal', 'opsx_was');
const BETIK = path.join(DIR, 'files', 'opsx_was.sh');

// `timeout` node'un gozuyle degil betigin kabugunun gozuyle olculur (Windows'ta ayni adli
// baska bir komut var).
const KABUK_VAR = spawnSync(BASH, ['-c', 'timeout 1 true && sleep 0'], { stdio: 'ignore' }).status === 0;
const SKIP = KABUK_VAR
  ? false
  : 'bash/timeout bulunamadi (Git Bash gerekir) - WAS betik davranis bekcileri KOSMADI';

const SOAP_GIZLI = 'KzosKw0gizliSOAP';
const SOAP_KULLANICI = 'srv_gizli_kullanici';

const LIB = [
  "JAVA_ARGS='/usr/WebSphere/AppServer/java/8.0/bin/java -Xms256m com.ibm.ws.bootstrap.WSLauncher com.ibm.ws.runtime.WsServer /usr/WebSphere/AppServer/profiles/AppSrv01/config'",
  'pids_of() {',
  '  local f a n',
  '  for f in "$FAKE"/procs/*; do',
  '    [ -f "$f" ] || continue',
  '    read -r -a a < "$f"',
  '    n=${#a[@]}',
  '    [ "$n" -ge 4 ] || continue',
  '    if [ "${a[n-1]}" = "$3" ] && [ "${a[n-2]}" = "$2" ] && [ "${a[n-3]}" = "$1" ] && kill -0 "${a[0]}" 2>/dev/null; then echo "${a[0]}"; fi',
  '  done',
  '}',
  'spawn() {',
  '  sleep 600 >/dev/null 2>&1 </dev/null &',
  '  local p=$!',
  '  echo "$p" >> "$FAKE/pids.all"',
  '  printf \'%s %s %s %s %s\\n\' "$p" "$JAVA_ARGS" "$1" "$2" "$3" > "$FAKE/procs/$p"',
  '  echo "$p"',
  '}',
  'kill_triple() { local p; for p in $(pids_of "$1" "$2" "$3"); do kill -9 "$p" 2>/dev/null; rm -f "$FAKE/procs/$p"; done; }',
  'mode_of() { M=""; [ -f "$FAKE/$1" ] && read -r M < "$FAKE/$1"; return 0; }',
  '',
].join('\n');

const PS = [
  '#!/bin/bash',
  '. "$FAKE/lib.sh"',
  'echo ps >> "$FAKE/log.ps"',
  '[ -e "$FAKE/ps_fail" ] && exit 1',
  'for r in "$FAKE"/respawn/*; do',
  '  [ -f "$r" ] || continue',
  '  read -r k c n s < "$r"',
  '  if [ "$k" -le 0 ]; then spawn "$c" "$n" "$s" >/dev/null; rm -f "$r"; else echo "$((k - 1)) $c $n $s" > "$r"; fi',
  'done',
  'echo "1 /usr/lib/systemd/systemd --switched-root --system"',
  'echo "$$ ps -eo pid=,args= -ww"',
  'for f in "$FAKE"/procs/*; do',
  '  [ -f "$f" ] || continue',
  '  read -r p rest < "$f"',
  '  kill -0 "$p" 2>/dev/null && printf \'%s %s\\n\' "$p" "$rest"',
  'done',
  'exit 0',
  '',
].join('\n');

const ID = [
  '#!/bin/bash',
  'case "${1:-}" in -un|-nu) echo "${FAKE_USER:-was}" ;; -u) echo 1001 ;; *) echo "uid=1001(${FAKE_USER:-was})" ;; esac',
  '',
].join('\n');

function serverStatus(cell, node, pdir) {
  return [
    '#!/bin/bash',
    '. "$FAKE/lib.sh"',
    `C=${cell}; N=${node}; PDIR='${pdir}'`,
    's="${1:-}"',
    'echo "$s" >> "$FAKE/log.status"',
    'echo "ADMU0116I: Tool information is being logged in file $PDIR/logs/$s/serverStatus.log"',
    'echo "ADMU0500I: Retrieving server status for $s"',
    'mode_of ss_mode',
    // Yalniz SECJ kodu: rc 0, "authoriz/authenticat" gibi anahtar sozcuk YOK - bekci tek
    // katmani (her SECJ kodu = olculemedi) olcer; diger katmanlar Ansible deposundaki
    // check_opsx_was.py D4'te ayri ayri.
    'if [ "$M" = auth ]; then',
    '  echo "SECJ0305I: The role-based check failed for admin-authz operation Server:getState."',
    '  echo "ADMU0509I: The Application Server \\"$s\\" cannot be reached. It appears to be stopped."',
    '  exit 0',
    'fi',
    'if [ "$M" = login ]; then',
    '  echo "javax.security.auth.login.LoginException: Authentication failed for user"',
    '  echo "ADMU0509I: The Application Server \\"$s\\" cannot be reached. It appears to be stopped."',
    '  exit 0',
    'fi',
    'if [ "$M" = hang ]; then sleep 30 & echo "$!" >> "$FAKE/hang.pids"; wait; exit 0; fi',
    'if [ -n "$(pids_of "$C" "$N" "$s")" ] && [ ! -e "$FAKE/unresp/$s" ]; then',
    '  echo "ADMU0508I: The Application Server \\"$s\\" is STARTED"',
    'else',
    '  echo "ADMU0509I: The Application Server \\"$s\\" cannot be reached. It appears to be stopped."',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

function stopServer(cell, node) {
  return [
    '#!/bin/bash',
    '. "$FAKE/lib.sh"',
    `C=${cell}; N=${node}`,
    's="${1:-}"',
    'echo "$*" >> "$FAKE/log.stop"',
    'mode_of stop_mode',
    'case "$M" in',
    '  fail) echo "ADMU3060E: Timed out waiting for server shutdown. wsadmin -password gizli123"; exit 246 ;;',
    '  hang) sleep 30 & echo "$!" >> "$FAKE/hang.pids"; wait; exit 0 ;;',
    '  red) echo "ADMU0111E: Program exiting with error: javax.management.JMRuntimeException: ADMN0022E: Access is denied for the stop operation on Server MBean"; exit 255 ;;',
    '  rc126) echo "bash: stopServer.sh: Permission denied"; exit 126 ;;',
    '  dup) spawn "$C" "$N" "$s" >/dev/null; echo "ADMU3060E: Timed out waiting for server shutdown."; exit 246 ;;',
    '  respawn) kill_triple "$C" "$N" "$s"; echo "1 $C $N $s" > "$FAKE/respawn/$s"; echo "ADMU4000I: Server $s stop completed."; exit 0 ;;',
    '  *) kill_triple "$C" "$N" "$s"; echo "ADMU4000I: Server $s stop completed."; exit 0 ;;',
    'esac',
    '',
  ].join('\n');
}

function startServer(cell, node) {
  return [
    '#!/bin/bash',
    '. "$FAKE/lib.sh"',
    `C=${cell}; N=${node}`,
    's="${1:-}"',
    'echo "$*" >> "$FAKE/log.start"',
    'rm -f "$FAKE/unresp/$s"',
    'p="$(spawn "$C" "$N" "$s")"',
    'echo "ADMU3000I: Server $s open for e-business; process id is $p"',
    'exit 0',
    '',
  ].join('\n');
}

function serverindex(sunucular) {
  const s = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<serverindex:ServerIndex xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmi:id="ServerIndex_1" hostName="gbwast01">',
  ];
  sunucular.forEach(([ad, tur], i) => {
    s.push(
      i % 2
        ? `  <serverEntries xmi:id="ServerEntry_${i}"\n      serverDisplayName="${ad}" serverName="${ad}"\n      serverType="${tur}">`
        : `  <serverEntries xmi:id="ServerEntry_${i}" serverDisplayName="${ad}" serverName="${ad}" serverType="${tur}">`,
      `    <specialEndpoints xmi:id="NamedEndPoint_${i}" endPointName="BOOTSTRAP_ADDRESS"/>`,
      '  </serverEntries>',
    );
  });
  s.push('</serverindex:ServerIndex>', '');
  return s.join('\n');
}

function yaz(f, icerik, mode = 0o644) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, icerik, { mode });
  fs.chmodSync(f, mode);
}

class Dunya {
  constructor({ soap = 'var', sunucular } = {}) {
    this.w = fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-was-'));
    this.fake = path.join(this.w, 'fake');
    for (const d of ['bin', 'procs', 'respawn', 'unresp']) fs.mkdirSync(path.join(this.fake, d), { recursive: true });
    yaz(path.join(this.fake, 'pids.all'), '');
    yaz(path.join(this.fake, 'lib.sh'), LIB);
    yaz(path.join(this.fake, 'bin', 'ps'), PS, 0o755);
    yaz(path.join(this.fake, 'bin', 'id'), ID, 0o755);
    this.root = path.join(this.w, 'was');
    const p = path.join(this.root, 'profiles', 'AppSrv01');
    const pp = posixYol(p);
    yaz(
      path.join(p, 'bin', 'setupCmdLine.sh'),
      `#!/bin/sh\nWAS_HOME=/usr/WebSphere/AppServer\nWAS_CELL=C1\nexport WAS_CELL\nWAS_NODE=N1\nexport WAS_NODE\n`,
      0o755,
    );
    yaz(path.join(p, 'bin', 'serverStatus.sh'), serverStatus('C1', 'N1', pp), 0o755);
    yaz(path.join(p, 'bin', 'stopServer.sh'), stopServer('C1', 'N1'), 0o755);
    yaz(path.join(p, 'bin', 'startServer.sh'), startServer('C1', 'N1'), 0o755);
    yaz(
      path.join(p, 'config', 'cells', 'C1', 'nodes', 'N1', 'serverindex.xml'),
      serverindex(
        sunucular || [
          ['nodeagent', 'NODE_AGENT'],
          ['app1', 'APPLICATION_SERVER'],
          ['app10', 'APPLICATION_SERVER'],
        ],
      ),
    );
    yaz(
      path.join(p, 'config', 'cells', 'C1', 'clusters', 'CL1', 'cluster.xml'),
      '<topology.cluster:ServerCluster xmi:version="2.0" name="CL1">\n' +
        '  <members xmi:id="ClusterMember_1" memberName="app1" nodeName="N1" weight="2"/>\n' +
        '</topology.cluster:ServerCluster>\n',
    );
    yaz(
      path.join(p, 'properties', 'soap.client.props'),
      `com.ibm.SOAP.securityEnabled=true\ncom.ibm.SOAP.loginUserid=${soap === 'var' ? SOAP_KULLANICI : ''}\n` +
        `com.ibm.SOAP.loginPassword={xor}${SOAP_GIZLI}\n`,
    );
  }

  env(ek = {}) {
    const e = { ...process.env };
    for (const k of ['MODE', 'OP', 'PROFILE', 'CELL', 'NODE', 'SERVER', 'CONSENT', 'CONFIRM', 'SERVER_FILTER', 'FAKE_USER'])
      delete e[k];
    return {
      ...e,
      FAKE: posixYol(this.fake),
      FAKEBIN: posixYol(path.join(this.fake, 'bin')),
      WAS_ROOT: posixYol(this.root),
      SH: posixYol(BETIK),
      POLL_S: '0',
      STABILITY_S: '0',
      KILL_WAIT_S: '5',
      STATUS_TIMEOUT: '10',
      STOP_TIMEOUT: '5',
      START_TIMEOUT: '5',
      CMD_GRACE: '2',
      KILL_AFTER: '1',
      ...ek,
    };
  }

  ayar(ad, deger = '') {
    yaz(path.join(this.fake, ad), deger);
  }

  surec(cell, node, server) {
    const r = spawnSync(BASH, ['-c', '. "$FAKE/lib.sh"; spawn "$1" "$2" "$3"', 'x', cell, node, server], {
      encoding: 'utf8',
      env: this.env(),
    });
    const pid = (r.stdout || '').trim();
    assert.match(pid, /^\d+$/, `kukla surec baslatilamadi: ${r.stderr}`);
    return pid;
  }

  canli(pid) {
    return spawnSync(BASH, ['-c', 'kill -0 "$1" 2>/dev/null', 'x', pid], { env: this.env() }).status === 0;
  }

  log(ad) {
    const f = path.join(this.fake, `log.${ad}`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  }

  kos(ortam) {
    for (const ad of ['status', 'stop', 'start', 'ps']) fs.rmSync(path.join(this.fake, `log.${ad}`), { force: true });
    const r = spawnSync(BASH, ['-c', 'export PATH="$FAKEBIN:$PATH"; exec bash "$SH"'], {
      encoding: 'utf8',
      env: this.env(ortam),
      timeout: 300000,
    });
    return sonuc(r);
  }

  // Playbook'un dis siniri (`timeout -k 3 <sn> bash betik`) DOLMUS gibi: sahte WAS komutu
  // basladiginda (hang.pids) dis timeout'a TERM gonderilir; GNU timeout bunu, sure dolunca
  // oldugu gibi bash'e ve surec grubuna iletir. Zamanlamadan (makine yukunden) bagimsiz.
  // rc RESULT'la tutarli olmaz (dis timeout'un cikis kodu) - ham sonuc doner.
  async kosDisSinir(ortam) {
    const { spawn } = require('node:child_process');
    const e = this.env(ortam);
    const p = spawn(
      BASH,
      ['-c', 'export PATH="$FAKEBIN:$PATH"; timeout -k 3 300 bash "$SH" & t=$!; echo "$t" > "$FAKE/outer.pid"; wait "$t"'],
      { env: e },
    );
    let stdout = '';
    p.stdout.on('data', (c) => (stdout += c));
    const bitti = new Promise((r) => p.on('close', r));
    const son = Date.now() + 120000;
    while (Date.now() < son && this.hangPids().length === 0 && p.exitCode === null) await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    spawnSync(BASH, ['-c', 'kill -TERM "$(cat "$FAKE/outer.pid")"'], { env: e });
    await Promise.race([bitti, new Promise((r) => setTimeout(r, 120000))]);
    return { stdout, gecenMs: Date.now() - t0 };
  }

  hangPids() {
    const f = path.join(this.fake, 'hang.pids');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\s+/).filter((x) => /^\d+$/.test(x)) : [];
  }

  temizle() {
    try {
      spawnSync(BASH, ['-c', 'for p in $(cat "$FAKE/pids.all" "$FAKE/hang.pids" 2>/dev/null); do kill -9 "$p" 2>/dev/null; done; true'], {
        env: this.env(),
      });
    } finally {
      fs.rmSync(this.w, { recursive: true, force: true });
    }
  }
}

function sonuc(r) {
  const out = r.stdout || '';
  const lines = out.replace(/\r/g, '').split('\n').filter(Boolean);
  const rr = lines.filter((l) => l.startsWith('RESULT\t')).map((l) => l.split('\t'));
  const R = rr[rr.length - 1] || [];
  const dl = lines.filter((l) => l.startsWith('DISCOVER\t'));
  let disc = null;
  if (dl.length) disc = JSON.parse(dl[dl.length - 1].slice('DISCOVER\t'.length));
  const s = {
    rc: r.status,
    out,
    err: r.stderr || '',
    lines,
    status: R[2],
    before: R[3],
    after: R[4],
    msg: R[5] || '',
    steps: lines.filter((l) => l.startsWith('STEP\t')).map((l) => l.split('\t')),
    disc,
    sunucu(ad) {
      for (const p of disc?.profiles || []) for (const x of p.servers || []) if (x.server === ad) return x;
      return null;
    },
    step(ad) {
      return this.steps.filter((x) => x[1] === ad);
    },
  };
  // Ortak degismezler.
  assert.ok((lines[lines.length - 1] || '').startsWith('RESULT\t'), `son satir RESULT degil:\n${out}\n${s.err}`);
  assert.equal(R.length, 6, `RESULT 6 alan degil: ${R}`);
  const rc = { OK: 0, SKIP: 0, FAIL: 1, OLCULEMEDI: 3 }[s.status];
  assert.equal(s.rc, rc, `rc ${s.rc} RESULT ${s.status} ile tutarsiz`);
  for (const g of [SOAP_GIZLI, SOAP_KULLANICI, 'gizli123']) {
    assert.ok(!out.includes(g) && !s.err.includes(g), `ciktida gizli deger: ${g}`);
  }
  // STEP durumu = adimin HEDEFINE ulasip ulasmadigi: OK dogrulama adimi hedef durumu bildirir.
  for (const [ad, hedef] of [['stop_dogrulama', 'STOPPED:'], ['start_dogrulama', 'RUNNING:']]) {
    for (const st of s.step(ad)) {
      if (st[2] === 'OK') assert.ok(st[3].startsWith(hedef), `${ad} OK ama hedef durum degil: ${st[3]}`);
    }
  }
  return s;
}

const islem = (op, ek = {}) => ({
  MODE: 'op',
  OP: op,
  PROFILE: 'AppSrv01',
  CELL: 'C1',
  NODE: 'N1',
  SERVER: 'app1',
  CONSENT: 'true',
  CONFIRM: 'app1',
  ...ek,
});

function dunyada(sec, fn) {
  const d = new Dunya(sec);
  try {
    fn(d);
  } finally {
    d.temizle();
  }
}

test('S0 betik bekcileri bash olmadan YESIL donmez: atlandigi acikca yazilir', () => {
  if (!KABUK_VAR) {
    assert.ok(SKIP.includes('KOSMADI'), 'skip mesaji acik degil');
    return;
  }
  assert.ok(fs.existsSync(BETIK), `betik yok: ${BETIK}`);
});

test('S1 kimlik hatasi -> OLCULEMEDI, ASLA STOPPED; kimlik satiri yoksa serverStatus kosmaz', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    d.ayar('ss_mode', 'auth');
    const k = d.kos({ MODE: 'discover' });
    const a1 = k.sunucu('app1');
    assert.equal(a1?.state, 'OLCULEMEDI', `SECJ + ADMU0509I STOPPED sayildi: ${JSON.stringify(a1)}`);
    assert.equal(a1?.ss, '?');
    const s = d.kos(islem('start'));
    assert.equal(s.status, 'OLCULEMEDI', `kimlik hatasinda start: ${s.msg}`);
    assert.deepEqual(d.log('start'), [], 'kimlik hatasinda startServer kostu');
  });
  dunyada({ soap: 'yok' }, (d) => {
    const k = d.kos({ MODE: 'discover' });
    assert.ok(k.disc.profiles[0].servers.length > 0);
    for (const x of k.disc.profiles[0].servers) assert.equal(x.state, 'OLCULEMEDI', JSON.stringify(x));
    assert.equal(k.disc.profiles[0].kimlik, 'yok');
    assert.deepEqual(d.log('status'), [], 'kimlik yokken serverStatus kostu');
    const s = d.kos(islem('stop'));
    assert.equal(s.status, 'OLCULEMEDI');
    assert.equal(s.before, '-');
    assert.deepEqual(d.log('stop'), [], 'kimlik yokken stopServer kostu');
  });
});

test('S2 app1 / app10 karismaz (uclu TAM eslesme)', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    const p10 = d.surec('C1', 'N1', 'app10');
    d.surec('C1', 'N2', 'app1');
    const k = d.kos({ MODE: 'discover' });
    assert.equal(k.sunucu('app1')?.state, 'STOPPED', `app10/baska node app1 sayildi: ${JSON.stringify(k.sunucu('app1'))}`);
    assert.equal(k.sunucu('app1')?.pids, 0);
    assert.equal(k.sunucu('app10')?.state, 'RUNNING');
    assert.equal(k.sunucu('app1')?.cluster, 'CL1');
    assert.equal(k.sunucu('app10')?.cluster, '');
    assert.equal(k.sunucu('nodeagent'), null, 'nodeagent hedef listesinde');
    const p1 = d.surec('C1', 'N1', 'app1');
    const s = d.kos(islem('stop'));
    assert.deepEqual([s.status, s.before, s.after], ['OK', 'RUNNING', 'STOPPED'], s.msg);
    assert.ok(!d.canli(p1), 'app1 durmadi');
    assert.ok(d.canli(p10), 'app1 stop app10u etkiledi');
  });
});

test('S3 ayni ucluyle N=2 surec -> ret, komut YOK', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    d.surec('C1', 'N1', 'app1');
    d.surec('C1', 'N1', 'app1');
    const k = d.kos({ MODE: 'discover', SERVER_FILTER: 'app1' });
    assert.equal(k.sunucu('app1')?.state, 'COKLU_SUREC');
    const s = d.kos(islem('restart'));
    assert.deepEqual([s.status, s.before], ['FAIL', 'COKLU_SUREC'], s.msg);
    assert.deepEqual(d.log('stop'), [], 'N=2 iken stopServer kostu');
  });
});

test('S4 stop sonrasi JVM geri gelir (nodeagent) -> FAIL', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    d.surec('C1', 'N1', 'app1');
    d.ayar('stop_mode', 'respawn');
    const s = d.kos(islem('stop'));
    assert.equal(s.status, 'FAIL', s.msg);
    assert.equal(s.after, 'RUNNING');
    assert.match(s.msg, /geri geldi/);
  });
});

test('S5 id -un != was -> FAIL, hicbir WAS komutu kosmaz', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    d.surec('C1', 'N1', 'app1');
    const k = d.kos({ MODE: 'discover', FAKE_USER: 'uxmid' });
    assert.equal(k.status, 'FAIL');
    assert.equal(k.disc?.overall, 'olculemedi');
    const s = d.kos(islem('stop', { FAKE_USER: 'uxmid' }));
    assert.equal(s.status, 'FAIL');
    assert.equal(s.before, '-');
    assert.deepEqual([...d.log('status'), ...d.log('stop'), ...d.log('ps')], [], 'was disi kullanici ile olcum/komut');
  });
});

test('S6 K3-a: stop suresi dolar -> FAIL ve kill YOK; restart + TEK PID -> kill -9 + start; iki PID -> kill YOK', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    const p1 = d.surec('C1', 'N1', 'app1');
    d.ayar('stop_mode', 'hang');
    const s = d.kos(islem('stop', { STOP_TIMEOUT: '1', CMD_GRACE: '1' }));
    assert.equal(s.status, 'FAIL', s.msg);
    assert.match(s.msg, /durdurulamadi/);
    assert.ok(s.msg.includes(p1), 'FAIL mesajinda PID yok');
    assert.ok(d.canli(p1), "stop'ta JVM oldurulmus (K3-a)");
    assert.deepEqual(s.step('kill'), [], "stop'ta kill adimi var");

    d.ayar('stop_mode', 'fail');
    const r = d.kos(islem('restart'));
    assert.deepEqual([r.status, r.before, r.after], ['OK', 'RUNNING', 'RUNNING'], r.msg);
    const kl = r.step('kill');
    assert.equal(kl[0]?.[2], 'OK', `kill -9 adimi yok: ${JSON.stringify(kl)}`);
    assert.ok(kl[0][3].includes(p1));
    assert.ok(!d.canli(p1), 'eski app1 sureci oldurulmedi');
    assert.equal(d.log('start').length, 1, 'kill sonrasi start kosmadi');
  });
  dunyada({}, (d) => {
    const p1 = d.surec('C1', 'N1', 'app1');
    d.ayar('stop_mode', 'dup');
    const r = d.kos(islem('restart'));
    assert.deepEqual([r.status, r.after], ['FAIL', 'COKLU_SUREC'], r.msg);
    assert.ok(d.canli(p1), 'iki PID eslesirken kill -9 yapildi');
    assert.deepEqual(d.log('start'), [], 'iki PID iken start kostu');
  });
});

test('S7 K3-a "stop SURESI dolarsa": hizli ret / calistirilamayan stopServer kill DEGIL; ASKIDA kill', { skip: SKIP }, () => {
  for (const [mod, kod] of [['red', 'ADMN0022E'], ['rc126', 'rc 126']]) {
    dunyada({}, (d) => {
      const p1 = d.surec('C1', 'N1', 'app1');
      d.ayar('stop_mode', mod);
      const r = d.kos(islem('restart'));
      assert.deepEqual([r.status, r.before, r.after], ['FAIL', 'RUNNING', 'RUNNING'], `${mod}: ${r.msg}`);
      assert.match(r.msg, /kill -9 YAPILMADI/);
      assert.ok(r.msg.includes(kod), `${mod}: gercek sebep yok: ${r.msg}`);
      assert.ok(d.canli(p1), `${mod}: yanit veren JVM'e kill -9 atildi`);
      assert.deepEqual(d.log('start'), [], `${mod}: stop basarisizken start kostu`);
      assert.equal(r.step('kill')[0]?.[2], 'SKIP', JSON.stringify(r.step('kill')));
      assert.equal(r.step('stop_dogrulama')[0]?.[2], 'FAIL', 'hedefe ulasmayan stop_dogrulama FAIL degil');
    });
  }
  dunyada({}, (d) => {
    const p1 = d.surec('C1', 'N1', 'app1');
    d.ayar('unresp/app1');
    d.ayar('stop_mode', 'red');
    const r = d.kos(islem('restart'));
    assert.deepEqual([r.status, r.before, r.after], ['OK', 'ASKIDA', 'RUNNING'], r.msg);
    assert.equal(r.step('kill')[0]?.[2], 'OK');
    assert.match(r.step('kill')[0][3], /ASKIDA/);
    assert.ok(!d.canli(p1), 'ASKIDA JVM oldurulmedi');
    assert.match(r.msg, /kill -9/, 'OK sonucu kill -9 yapildigini soylemiyor');
  });
});

test('S8 serbest metin sozcukleri ADIN icinde: OLCULEMEDI yok; kod tespiti ve kodsuz hata korunur', { skip: SKIP }, () => {
  const adlar = ['AuthorizationWS', 'PasswordReset', 'DeniedPartyScreening', 'ExceptionMonitor'];
  dunyada({ sunucular: adlar.map((a) => [a, 'APPLICATION_SERVER']) }, (d) => {
    for (const a of adlar) d.surec('C1', 'N1', a);
    const k = d.kos({ MODE: 'discover' });
    for (const a of adlar) {
      assert.deepEqual([k.sunucu(a)?.state, k.sunucu(a)?.ss], ['RUNNING', 'UP'], `${a} kendi adi yuzunden: ${JSON.stringify(k.sunucu(a))}`);
    }
  });
  dunyada({ sunucular: [['J', 'APPLICATION_SERVER'], ['SECJ0305I', 'APPLICATION_SERVER']] }, (d) => {
    d.ayar('ss_mode', 'auth');
    const k = d.kos({ MODE: 'discover' });
    for (const a of ['J', 'SECJ0305I']) assert.deepEqual([k.sunucu(a)?.state, k.sunucu(a)?.ss], ['OLCULEMEDI', '?'], a);
  });
  dunyada({}, (d) => {
    d.ayar('ss_mode', 'login');
    const k = d.kos({ MODE: 'discover', SERVER_FILTER: 'app10' });
    assert.deepEqual([k.sunucu('app10')?.state, k.sunucu('app10')?.ss], ['OLCULEMEDI', '?'], 'kodsuz kimlik hatasi olculmus sayildi');
  });
});

test('S9 kesif sure butcesi: serverStatus kosmaz, JVM OLCULEMEDI, mesaj acik', { skip: SKIP }, () => {
  dunyada({}, (d) => {
    d.surec('C1', 'N1', 'app1');
    const k = d.kos({ MODE: 'discover', DISC_DEADLINE_S: '0' });
    const sv = k.disc.profiles[0].servers;
    assert.equal(sv.length, 2);
    for (const x of sv) assert.deepEqual([x.state, x.ss], ['OLCULEMEDI', '?'], JSON.stringify(x));
    assert.deepEqual(d.log('status'), [], 'butce asildiktan sonra serverStatus kostu');
    assert.match(k.msg, /2 JVM .*butce/, k.msg);
    assert.match(k.disc.reason, /butce/);
  });
});

test('S10 dis sinir dolarsa RESULT basilir ve ic WAS komutu YETIM KALMAZ', { skip: SKIP }, async () => {
  const d = new Dunya();
  try {
    d.surec('C1', 'N1', 'app1');
    d.ayar('stop_mode', 'hang');
    const r = await d.kosDisSinir(islem('stop', { STOP_TIMEOUT: '60', CMD_GRACE: '1' }));
    assert.ok(r.gecenMs < 10000, `dis sinir sinyalinden sonra betik ${r.gecenMs} ms surdu (trap ertelendi)`);
    const satirlar = (r.stdout || '').replace(/\r/g, '').split('\n').filter(Boolean);
    const son = (satirlar[satirlar.length - 1] || '').split('\t');
    assert.deepEqual(son.slice(0, 5), ['RESULT', 'stop', 'OLCULEMEDI', 'RUNNING', 'OLCULEMEDI'], `dis sinirda RESULT yok: ${r.stdout}`);
    assert.match(son[5] || '', /sonlandirildi/);
    const pids = d.hangPids();
    assert.ok(pids.length > 0, 'sahte stopServer baslamadi');
    const bitis = Date.now() + 8000;
    while (Date.now() < bitis && pids.some((p) => d.canli(p))) spawnSync(BASH, ['-c', 'sleep 0.5']);
    assert.ok(!pids.some((p) => d.canli(p)), `ic WAS komutu yetim kaldi: ${pids}`);
  } finally {
    d.temizle();
  }
});
