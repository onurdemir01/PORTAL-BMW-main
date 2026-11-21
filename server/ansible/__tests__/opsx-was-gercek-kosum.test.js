// server/ansible/__tests__/opsx-was-gercek-kosum.test.js - OpsX WAS playbook'lari GERCEK ansible-playbook ile
// (2026-11-21). opsx_was/ gecici dizine kopyalanir; files/opsx_was.sh yerine gercek bicimde STEP / RESULT /
// DISCOVER satiri basan sahte betik konur; hedef host yerel baglantidir (ansible_become=false: dzdo yok).
//
// NEDEN: sonuc satiri sekmeyle ayrilir. `>-` blok skaler icindeki `split('\t')` SEKMEYE BOLMUYORDU: Ansible
// Jinja ifadesindeki ters boluyu ciftler, `'\t'` iki karakterlik metin olur (core 2.16 ve 2.21 olculdu).
// Basarili her islem OLCULEMEDI ile bitiyor, AWX isi FAILED oluyor, envanter hic yazilmiyordu; kesif de her
// hostu "olculemedi" sayiyordu. Ansible deposundaki bekci karar zincirini Jinja2 ile (Ansible'siz) kosturdugu
// icin `'\t'` orada gercek sekmeydi: tuzak gorunmedi. Duzeltme: sekme cift tirnakli bir degiskende
// (`opsx_was_sekme: "\t"`). Metin kurali: playbook-jinja-traps.test.js (T kurali).
//   GK1 islem: betik RESULT OK basinca sonuc OK, before/after olculen, is basarili (rc 0)
//   GK2 islem: envanter adimi on kosullar yokken FAIL ve SEBEBI tasir (bos mesaj degil; eksiklerin hepsi)
//   GK3 islem: betik RESULT basmazsa OLCULEMEDI; girdi reddinde sonuc play'inin yedek `line`'i gercek
//       sekmeyle ayrilir (6 alan)
//   GK4 kesif: DISCOVER + RESULT OK basinca host 'ok', profil listesi gelir
//   GK5 islem: parola + portal_yazici_host + portal_envanter_sql_sunucusu verilince envanter adimi YAZICI
//       SUNUCUDA kosar (sha1 / sahip kapisi, betik --sunucu ile); DB yok, sonuc satiri FAIL ama "tanimli
//       degil" DEGIL (on kosul gecti)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ansiblePythonu } = require('./fixtures/python-bul.cjs');

const KAYNAK = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'opsx_was');
const VAR = (komut) => spawnSync(komut, ['--version'], { stdio: 'ignore' }).status === 0;
const ATLA = {
  skip:
    (!VAR('ansible-playbook') && 'ansible-playbook yok') ||
    (!VAR('timeout') && 'timeout yok (coreutils)'),
};

function ortam(sahteBetik) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-was-kosum-'));
  const dizin = path.join(kok, 'opsx_was');
  fs.cpSync(KAYNAK, dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, 'files', 'opsx_was.sh'), sahteBetik, { mode: 0o644 });
  const py = ansiblePythonu() || 'python3';
  const inv = path.join(kok, 'envanter.ini');
  fs.writeFileSync(
    inv,
    [
      `localhost ansible_connection=local ansible_python_interpreter=${py}`,
      `ORWAST01 ansible_connection=local ansible_become=false ansible_python_interpreter=${py}`,
      `ORLABT02 ansible_connection=local ansible_become=false ansible_python_interpreter=${py}`,
      '',
    ].join('\n'),
  );
  return { kok, dizin, inv };
}

function oynat(sahteBetik, playbook, ev) {
  const { kok, dizin, inv } = ortam(sahteBetik);
  const r = spawnSync(
    'ansible-playbook',
    ['-i', inv, path.join(dizin, playbook), '-e', JSON.stringify(ev)],
    {
      encoding: 'utf8',
      cwd: kok,
      env: {
        ...process.env,
        ANSIBLE_SHOW_CUSTOM_STATS: 'True',
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_NOCOLOR: '1',
        ANSIBLE_RETRY_FILES_ENABLED: 'False',
      },
      timeout: 240000,
    },
  );
  const satir = r.stdout.split('\n').find((s) => s.includes('RUN: {'));
  return { ...r, stats: satir ? JSON.parse(satir.slice(satir.indexOf('{'))) : null };
}

const ISLEM = {
  target_host: 'ORWAST01',
  was_profile: 'AppSrv01',
  was_cell: 'cell01',
  was_node: 'node01',
  was_server: 'srv01',
  operation: 'restart',
  consent: true,
  confirm_text: 'srv01',
  opsx_request_id: 'gk-1',
};
const BETIK_OK = [
  '#!/bin/bash',
  'printf "STEP\\tstop\\tOK\\tdurdu\\n"',
  'printf "RESULT\\t%s\\tOK\\tSTOPPED\\tRUNNING\\tyeniden baslatildi\\n" "$OP"',
  '',
].join('\n');

test('GK1 islem: RESULT OK -> sonuc OK, olculen durumlar, is basarili', ATLA, () => {
  const r = oynat(BETIK_OK, 'opsx_was_operation.yml', ISLEM);
  const s = r.stats?.opsx_was_op_result;
  assert.ok(s, `opsx_was_op_result yayinlanmadi\n${r.stdout.slice(-2000)}`);
  assert.equal(s.result, 'OK', `sonuc OK olmali (sekme bolmesi): ${JSON.stringify(s)}`);
  assert.equal(s.before, 'STOPPED');
  assert.equal(s.after, 'RUNNING');
  assert.equal(r.status, 0, r.stdout.slice(-1500));
});

test('GK2 islem: envanter adimi on kosullar yokken FAIL ve sebebi tasir', ATLA, () => {
  const r = oynat(BETIK_OK, 'opsx_was_operation.yml', ISLEM);
  const env = (r.stats?.opsx_was_op_result?.steps || []).find((x) => x.step === 'envanter');
  assert.ok(env, 'envanter adimi yok');
  assert.equal(env.status, 'FAIL');
  // Eksik on kosullarin HEPSI tek satirda (parola + AWX template Variables, kurum adlari koda yazilmaz).
  assert.match(
    String(env.msg),
    /tbmwans_pwd \(AWX credential\), portal_yazici_host, portal_envanter_sql_sunucusu tanimli degil/,
    'sebep bos ya da eksik (sekme bolmesi)',
  );
});

test(
  'GK3 islem: RESULT yoksa OLCULEMEDI; girdi reddinde yedek satir gercek sekmeyle 6 alan',
  ATLA,
  () => {
    const r = oynat('#!/bin/bash\necho "beklenmeyen cikti"\n', 'opsx_was_operation.yml', ISLEM);
    const s = r.stats?.opsx_was_op_result;
    assert.ok(s, 'opsx_was_op_result yayinlanmadi');
    assert.equal(s.result, 'OLCULEMEDI');
    assert.notEqual(r.status, 0, 'olculemeyen islem isi dusurmeli');
    // Girdi reddi (onay yok): host hic kosmaz, sonuc play'i yedek satiri kendisi kurar.
    const red = oynat(BETIK_OK, 'opsx_was_operation.yml', { ...ISLEM, consent: false });
    const k = red.stats?.opsx_was_op_result;
    assert.ok(k, 'girdi reddinde opsx_was_op_result yayinlanmadi');
    assert.equal(k.result, 'FAIL');
    const alanlar = String(k.line).split('\t');
    assert.equal(alanlar.length, 6, `yedek satir sekmeyle ayrilmali: ${JSON.stringify(k.line)}`);
    assert.deepEqual(alanlar.slice(0, 3), ['RESULT', 'restart', 'FAIL']);
  },
);

test('GK4 kesif: DISCOVER + RESULT OK -> host ok, profiller gelir', ATLA, () => {
  const veri = JSON.stringify({ overall: 'ok', profiles: [{ profile: 'AppSrv01', servers: [] }] });
  const betik = [
    '#!/bin/bash',
    `printf 'DISCOVER\\t%s\\n' '${veri}'`,
    'printf "RESULT\\tdiscover\\tOK\\t-\\t-\\tkesif tamam\\n"',
    '',
  ].join('\n');
  const r = oynat(betik, 'opsx_was_discover.yml', { target_hosts: 'ORWAST01' });
  const s = r.stats?.opsx_was_discover_result;
  assert.ok(s, `opsx_was_discover_result yayinlanmadi\n${r.stdout.slice(-2000)}`);
  const h = (s.hosts || []).find((x) => x.host === 'ORWAST01');
  assert.ok(h, JSON.stringify(s));
  assert.equal(h.overall, 'ok', `host olculemedi sayildi (sekme bolmesi): ${JSON.stringify(h)}`);
  assert.equal(h.profiles.length, 1);
});

test('GK5 islem: on kosullar verilince envanter adimi yazici sunucuda kosar', ATLA, () => {
  const r = oynat(BETIK_OK, 'opsx_was_operation.yml', {
    ...ISLEM,
    tbmwans_pwd: 'deneme-degeri',
    portal_yazici_host: 'ORLABT02',
    portal_envanter_sql_sunucusu: 'db.ornek.invalid,1453',
  });
  const s = r.stats?.opsx_was_op_result;
  assert.ok(s, `opsx_was_op_result yayinlanmadi\n${r.stdout.slice(-2000)}`);
  assert.equal(s.result, 'OK', 'islem sonucu envanter adimindan etkilenmemeli');
  const env = (s.steps || []).find((x) => x.step === 'envanter');
  assert.ok(env, 'envanter adimi yok');
  assert.equal(env.status, 'FAIL', 'DB yokken envanter OK olamaz');
  assert.ok(String(env.msg).length > 0, 'sebep bos');
  assert.doesNotMatch(String(env.msg), /tanimli degil/, 'on kosul gecmedi');
  assert.match(
    r.stdout,
    /TASK \[--- \[Task\] dbo\.WASAppsInventory tek satir UPDATE/,
    'UPDATE gorevi yok',
  );
  assert.doesNotMatch(r.stdout, /deneme-degeri/, 'parola ciktiya sizdi');
});
