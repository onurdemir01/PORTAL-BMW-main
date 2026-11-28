'use strict';
// SUNUCU checkJs KAPISI (scripts/check-server.cjs, kapi K4) — karar, gercek tsc ve cikis.
//   CS1 olumcul tanilar (sozdizimi TS1xxx, cozulemeyen ad / modul, yanlis arguman sayisi ...)
//       kapiyi dusurur; strict=false bildirimleri yalniz sayilir.
//   CS2 tsc tanisiz basarisiz olursa (cokme, bozuk proje) kapi duser; cikti aynen yazilir.
//   CS3 gercek tsc gecici bir projede: cozulemeyen modul olumcul, temiz proje gecer.
//   CS4 main: gecmezse satirlar stderr'e ve cikis 1; gecerse tek satir stdout'a.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { degerlendir, runTsc, main } = require('../../scripts/check-server.cjs');

const tani = (kod) => `server/a.cjs(1,1): error TS${kod}: ileti`;

test('CS1 olumcul tanilar kapiyi dusurur, digerleri yalniz sayilir', () => {
  const olumcul = ['1005', '1128', '2300', '2304', '2307', '2358', '2367', '2551', '2552', '2554'];
  for (const kod of olumcul) {
    const r = degerlendir({ status: 2, output: `${tani('2339')}\n${tani(kod)}\n` });
    assert.equal(r.gecti, false, `TS${kod} olumcul sayilmadi`);
    assert.deepEqual(r.satirlar, [
      '[check:server] FAIL - 1 fatal server checkJs diagnostic(s):',
      tani(kod),
    ]);
  }
  for (const kod of ['2339', '2345', '2555', '7006', '18048', '23040']) {
    const r = degerlendir({ status: 2, output: `${tani(kod)}\r\n${tani('2580')}\r\n` });
    assert.equal(r.gecti, true, `TS${kod} olumcul sayildi`);
    assert.deepEqual(r.satirlar, [
      '[check:server] OK - 0 fatal diagnostics in server/, shared/, scripts/ (2 non-fatal strict=false notices).',
    ]);
  }
  const iki = degerlendir({ status: 2, output: `${tani('2304')}\n${tani('2307')}\n` });
  assert.equal(iki.satirlar[0], '[check:server] FAIL - 2 fatal server checkJs diagnostic(s):');
  assert.equal(degerlendir({ status: 0, output: '' }).gecti, true);
});

test('CS2 tsc tanisiz basarisiz olursa kapi duser', () => {
  const r = degerlendir({ status: 1, output: '\n  tsc coktu: bellek yetmedi  \n' });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.satirlar, [
    '[check:server] FAIL - tsc exited with code 1 without diagnostics:',
    'tsc coktu: bellek yetmedi',
  ]);
});

test('CS3 gercek tsc: cozulemeyen modul olumcul, temiz proje gecer', (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'check-server-'));
  t.after(() => fs.rmSync(kok, { recursive: true, force: true }));
  const ayar = { compilerOptions: { strict: false, noEmit: true, types: [] }, include: ['*.ts'] };
  fs.writeFileSync(path.join(kok, 'proje.json'), JSON.stringify(ayar));
  fs.writeFileSync(path.join(kok, 'a.ts'), "import { x } from './olmayan';\nexport const y = x;\n");
  let r = runTsc({ cwd: kok, proje: 'proje.json' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /error TS2307:/);
  assert.equal(degerlendir(r).gecti, false);

  fs.writeFileSync(path.join(kok, 'a.ts'), 'export const y: number = 1;\n');
  r = runTsc({ cwd: kok, proje: 'proje.json' });
  assert.equal(r.status, 0, r.output);
  assert.equal(degerlendir(r).gecti, true);
});

test('CS4 main: gecmezse stderr ve cikis 1, gecerse stdout', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const hata = t.mock.method(console, 'error', () => {});
  const cikis = t.mock.method(process, 'exit', () => {});

  main(() => ({ status: 2, output: tani('2304') }));
  assert.deepEqual(
    hata.mock.calls.map((c) => c.arguments[0]),
    ['[check:server] FAIL - 1 fatal server checkJs diagnostic(s):', tani('2304')],
  );
  assert.deepEqual(
    cikis.mock.calls.map((c) => c.arguments[0]),
    [1],
  );
  assert.equal(log.mock.callCount(), 0);

  main(() => ({ status: 0, output: '' }));
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /^\[check:server\] OK - 0 fatal/);
  assert.equal(cikis.mock.callCount(), 1, 'gecen kapi cikis kodu verdi');
});
