// server/__tests__/modul-taklit.test.cjs
//
// `mock.module` NODE SURUMUNDEN BAGIMSIZ (2026-10-23). visible-tables.test.cjs `{ exports }` ile
// modul taklit ediyordu; Node 22 bu secenegi SESSIZCE yok sayar ve modul BOS doner. Portalin
// calistigi makinede (Node 22.22.2) 12 test bu yuzden kirmiziydi; Node 26'da yesildi.
//
//   MT1 her `mock.module(...)` cagrisi secenegini `modulTaklitSecenegi(...)`ten alir
//   MT2 yardimci 22'de namedExports, 24+'da exports secer (iki dal da olculur)
//   MT3 CANLI: bu Node surumunde gercekten taklit eder (testi kosan surum hangisiyse)
'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { modulTaklitSecenegi } = require('./fixtures/modul-taklit.cjs');

const ROOT = path.join(__dirname, '..', '..');

function testDosyalari(dizin, acc = []) {
  for (const ad of fs.readdirSync(dizin, { withFileTypes: true })) {
    const p = path.join(dizin, ad.name);
    if (ad.isDirectory()) {
      if (ad.name !== 'node_modules') testDosyalari(p, acc);
    } else if (ad.name.endsWith('.test.cjs')) acc.push(p);
  }
  return acc;
}

test('MT1 her mock.module cagrisi secenegini modulTaklitSecenegi ile alir', () => {
  const ihlal = [];
  let toplam = 0;
  for (const f of testDosyalari(path.join(ROOT, 'server'))) {
    if (f === __filename) continue;
    const kod = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    const cagrilar = kod.match(/mock\.module\(\s*[^,]+,\s*[^\s]/g) || [];
    for (const c of cagrilar) {
      toplam++;
      if (!/,\s*m$/.test(c)) ihlal.push(`${path.relative(ROOT, f)}: ${c.replace(/\s+/g, ' ')}`);
    }
    const yardimli = kod.match(/mock\.module\(\s*[^,]+,\s*modulTaklitSecenegi\(/g) || [];
    if (yardimli.length !== cagrilar.length)
      ihlal.push(
        `${path.relative(ROOT, f)}: ${cagrilar.length} cagri, ${yardimli.length} tanesi yardimciyla`,
      );
  }
  assert.ok(toplam > 0, 'hic mock.module cagrisi bulunamadi: bekci kor');
  assert.deepEqual(ihlal, [], `Node 22'de sessizce bos modul verir:\n${ihlal.join('\n')}`);
});

test('MT2 yardimci 22de namedExports, 24+da exports secer', () => {
  const d = { a: 1 };
  for (const v of ['22.22.2', 'v22.23.4', '23.11.0'])
    assert.deepEqual(modulTaklitSecenegi(d, v), { namedExports: d }, v);
  for (const v of ['24.0.0', 'v24.22.1', '26.12.1', '27.0.0'])
    assert.deepEqual(modulTaklitSecenegi(d, v), { exports: d }, v);
});

test('MT3 bu Node surumunde gercekten taklit eder', () => {
  const hedef = path.join(__dirname, 'fixtures', 'modul-taklit-hedef.cjs');
  fs.writeFileSync(hedef, "module.exports = { kim: () => 'gercek' };\n");
  try {
    const m = mock.module(
      './fixtures/modul-taklit-hedef.cjs',
      modulTaklitSecenegi({ kim: () => 'sahte' }),
    );
    try {
      assert.equal(
        require('./fixtures/modul-taklit-hedef.cjs').kim(),
        'sahte',
        `Node ${process.versions.node} taklidi uygulamadi`,
      );
    } finally {
      m.restore();
    }
  } finally {
    fs.rmSync(hedef, { force: true });
  }
});
