'use strict';
// CALISMA ZAMANI PAKETI DUMAN TESTI (scripts/paket-duman.cjs; pakette `npm test`). Betik calisma
// dizinindeki paketi sinar: gecici bir paket agacinda GERCEK betik olarak kosar.
//   PD1 saglam paket: bagimliliklar cozulur (ust dizinden cozulen ve package.json'u disa vermeyen,
//       ya da yalniz node_modules'te duran paket dahil), giris dosyalari gecerli, dist gecer -> 0.
//   PD2 her kusur ayri satirda: cozulemeyen bagimlilik, devDependencies, sozdizimi hatasi, eksik
//       giris dosyasi, dist dogrulamasi -> cikis 1.
//   PD3 bagimliligi olmayan paket de sinanir (0 bagimlilik).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, '..', '..', 'scripts', 'paket-duman.cjs');
const DIST_TAMAM = "console.log('[dist] tamam');\n";

// Paket gecici dizinin ALTINDA (`<gecici>/paket`): `../` ile baslayan dosyalar ust dizine yazilir
// (paketin disindan cozulen bagimlilik).
function paket(t, dosyalar) {
  const ust = fs.mkdtempSync(path.join(os.tmpdir(), 'paket-duman-'));
  t.after(() => fs.rmSync(ust, { recursive: true, force: true }));
  const kok = path.join(ust, 'paket');
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true });
    fs.writeFileSync(
      path.join(kok, ad),
      typeof icerik === 'string' ? icerik : JSON.stringify(icerik),
    );
  }
  const r = spawnSync(process.execPath, [BETIK], { cwd: kok, encoding: 'utf8' });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}

test('PD1 saglam paket gecer', (t) => {
  const r = paket(t, {
    'package.json': { dependencies: { 'pd-normal': '1', 'pd-disa': '1', 'pd-yalin': '1' } },
    'node_modules/pd-normal/package.json': { name: 'pd-normal', main: 'i.js' },
    'node_modules/pd-normal/i.js': '',
    // Paketin disinda (ust dizinde) ve package.json'u disa vermez: kok giris noktasiyla cozulur.
    '../node_modules/pd-disa/package.json': { name: 'pd-disa', exports: { '.': './i.js' } },
    '../node_modules/pd-disa/i.js': '',
    // Kok giris noktasi da yok: yalniz node_modules'te durdugu dogrulanir.
    'node_modules/pd-yalin/package.json': { name: 'pd-yalin', exports: { './x': './x.js' } },
    'server/index.cjs': 'module.exports = 1;\n',
    'server/service.cjs': 'module.exports = 2;\n',
    'scripts/dist-dogrula.cjs': DIST_TAMAM,
  });
  assert.equal(r.kod, 0, r.err);
  assert.equal(
    r.out,
    '[dist] tamam\n[duman] tamam: 3 calisma zamani bagimliligi, sunucu girisi, dist\n',
  );
});

test('PD2 her kusur ayri satirda raporlanir, cikis 1', (t) => {
  const r = paket(t, {
    'package.json': {
      dependencies: { 'pd-olmayan-paket': '1' },
      devDependencies: { vite: '1' },
    },
    'server/index.cjs': 'const = ;\n',
    'scripts/dist-dogrula.cjs': 'process.exit(1);\n',
  });
  assert.equal(r.kod, 1);
  const satirlar = r.err.trim().split('\n');
  assert.equal(satirlar[0], '[duman] BASARISIZ:');
  assert.equal(satirlar[1], '- cozulemedi: pd-olmayan-paket');
  assert.equal(satirlar[2], '- package.json devDependencies tasiyor (calisma zamani paketi degil)');
  assert.match(satirlar[3], /^- server\/index\.cjs sozdizimi: .*server[/\\]index\.cjs:1$/);
  assert.equal(satirlar[4], '- server/service.cjs yok');
  assert.equal(satirlar[5], '- dist dogrulamasi gecmedi');
  assert.equal(satirlar.length, 6);
});

test('PD3 bagimliligi olmayan paket', (t) => {
  const r = paket(t, {
    'package.json': {},
    'server/index.cjs': '',
    'server/service.cjs': '',
    'scripts/dist-dogrula.cjs': DIST_TAMAM,
  });
  assert.equal(r.kod, 0, r.err);
  assert.match(r.out, /\[duman\] tamam: 0 calisma zamani bagimliligi/);
});
