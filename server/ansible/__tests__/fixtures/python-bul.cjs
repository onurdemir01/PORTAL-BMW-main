// server/ansible/__tests__/fixtures/python-bul.cjs — jinja2 + PyYAML tasiyan Python'u bul.
//
// NEDEN VAR (2026-10-07): LogX Legacy playbook bekcileri karar mantigini Jinja ile render
// eder ve bunun icin python3 + jinja2 + PyYAML ister. Arama yalnizca PATH'teki `python3` /
// `python` idi. Ansible Homebrew ya da pipx ile kuruluysa bu paketler ANSIBLE'IN KENDI
// yorumlayicisindadir (or. .../Cellar/ansible/<surum>/libexec/bin/python), PATH'teki duz
// python3'te DEGIL: gelistirici makinesinde Ansible kurulu oldugu halde 28 bekci "KOR" diye
// kirmizi duruyordu. Hata mesaji "ansible-core kuruluysa ikisi de zaten var" diyordu ama
// arama o yorumlayiciya hic bakmiyordu.
//
// Sira: acik secim (PORTAL_TEST_PYTHON) -> PATH python3/python -> Ansible'in yorumlayicisi
// -> (Windows) py -3. Hicbiri yoksa null doner; cagiran KOR diye ACIK HATAYLA duser.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WINDOWS = process.platform === 'win32';

/** `#!` satirindan yorumlayici yolu. `#!/usr/bin/env python3` -> `python3`. Yoksa null. */
function shebangYorumlayici(ilkSatir) {
  const s = String(ilkSatir || '');
  if (!s.startsWith('#!')) return null;
  const p = s.slice(2).trim().split(/\s+/).filter(Boolean);
  if (p.length && /(^|\/)env$/.test(p[0])) {
    p.shift();
    // `env -S python3 -u` gibi bayraklar: ilk bayrak olmayan oge yorumlayicidir.
    while (p.length && p[0].startsWith('-')) p.shift();
  }
  return p[0] || null;
}

/** PATH'te calistirilabilir dosya (which). */
function pathteBul(ad, PATH = process.env.PATH) {
  for (const d of String(PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, ad);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* bu dizinde yok */
    }
  }
  return null;
}

/** Ansible kuruluysa onun yorumlayicisi (ansible-playbook betiginin `#!` satiri). */
function ansiblePythonu(PATH = process.env.PATH) {
  for (const ad of ['ansible-playbook', 'ansible']) {
    const p = pathteBul(ad, PATH);
    if (!p) continue;
    try {
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(512);
        const n = fs.readSync(fd, buf, 0, 512, 0);
        const y = shebangYorumlayici(buf.toString('utf8', 0, n).split('\n', 1)[0]);
        if (y) return y;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* okunamadi: siradaki aday */
    }
  }
  return null;
}

/** Denenecek adaylar, oncelik sirasiyla: [komut, on-argumanlar]. */
function adaylar(env = process.env) {
  const liste = [];
  if (env.PORTAL_TEST_PYTHON) liste.push([env.PORTAL_TEST_PYTHON, []]);
  liste.push(['python3', []], ['python', []]);
  const a = ansiblePythonu(env.PATH);
  if (a && !liste.some(([k]) => k === a)) liste.push([a, []]);
  if (WINDOWS) liste.push(['py', ['-3']]);
  return liste;
}

/** jinja2 + PyYAML'i import edebilen ilk aday; yoksa null. */
function pythonBul(env = process.env) {
  for (const [komut, on] of adaylar(env)) {
    const r = spawnSync(komut, [...on, '-c', 'import jinja2, yaml'], {
      stdio: 'ignore',
      env: { ...env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    if (r.status === 0) return { komut, on };
  }
  return null;
}

module.exports = { pythonBul, adaylar, ansiblePythonu, pathteBul, shebangYorumlayici };
