// server/__tests__/run-sh-kilit.test.cjs — deploy/run.sh start/restart kilidi node'a gecmez (2026-10-23).
//
// Uretim (gblabt02, Node 22.23.4 gecisi): release-git.sh -> run.sh start ile acilan Portal sureci,
// run_locked'in `exec 200>$LOCK_FILE` + `flock -n 200` ile aldigi kilidin fd'sini DEVRALIYORDU. flock
// kilidi fd acik kaldikca yasar: sonraki her `run.sh prod restart` "baska bir start/restart suruyor"
// ile dustu (stop + start calisiyordu, cunku stop kilit almaz ve node olunce kilit kalkar).
// Davranis WSL'de yeniden uretildi; duzeltme node'u baslatirken `200>&-` ile fd'yi kapatmak.
//   RK1 node'u baslatan satir kilit fd'sini kapatir
//   RK2 kilit fd numarasi tek yerde: run_locked'in actigi fd ile kapatilan ayni
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SH = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'run.sh'), 'utf8');
const kod = SH.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('RK1 node u baslatan komut kilit fd sini kapatir (devralip kilidi tutmaz)', () => {
  const m = /nohup \$SETSID_BIN node "\$ROOT_DIR\/server\/index\.cjs" "\$ENV_NAME" \\\n([^\n]*)/.exec(kod);
  assert.ok(m, 'node baslatma satiri bulunamadi (bekci kor kalmasin diye FAIL)');
  assert.match(m[1], /\s200>&-\s*&\s*$/, 'node kilit fd sini devraliyor - sonraki her restart kilitte duser');
});

test('RK2 kapatilan fd, run_locked in kilit icin actigi fd ile ayni', () => {
  const ac = /exec (\d+)>"\$LOCK_FILE"/.exec(kod);
  const fl = /flock -n (\d+);/.exec(kod);
  assert.ok(ac && fl, 'run_locked kilidi bulunamadi');
  assert.equal(ac[1], fl[1]);
  assert.ok(kod.includes(` ${ac[1]}>&- &`), `node baslatilirken ${ac[1]} numarali fd kapatilmiyor`);
});
