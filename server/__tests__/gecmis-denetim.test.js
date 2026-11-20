// server/__tests__/gecmis-denetim.test.js — K16 main gecmisi (scripts/gecmis-denetim.cjs).
//
//   GD1 konu satiri 8-120 karakter (kod noktasi); Merge / Revert / fixup! / squash! muaf; 7 ve 121 kirmizi
//   GD2 konu satiri kancadaki gibi okunur ('#' satirlari atlanir, CR silinir); --konu cikis kodu
//   GD3 kanca kurali buradan okur (tek kaynak: kancada sayi yok); CI adimi ve kapi listesi bagli
//   GD4 aralik: push first-parent (dal commit'leri degil birlesme), --pr tum commit'ler; zorla push son commit
//   GD5 PR iliskisi: birlesmis PR yoksa kirmizi, bot muaf, API hatasi sessiz gecmez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const G = require('../../scripts/gecmis-denetim.cjs');

const KOK = path.join(__dirname, '..', '..');
const BETIK = path.join(KOK, 'scripts', 'gecmis-denetim.cjs');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');

test('GD1 konu satiri uzunlugu ve muafiyetler', () => {
  assert.equal(G.konuDenetle('a'.repeat(8)), null);
  assert.equal(G.konuDenetle('a'.repeat(120)), null);
  assert.match(G.konuDenetle('a'.repeat(7)), /8-120 karakter olmali \(simdi 7\)/);
  assert.match(G.konuDenetle('a'.repeat(121)), /simdi 121/);
  assert.equal(G.konuDenetle('ş'.repeat(120)), null, 'Turkce harf tek karakter sayilir');
  assert.match(G.konuDenetle(''), /simdi 0/);
  for (const m of ['Merge pull request #1', 'Revert "x"', 'fixup! a', 'squash! b'])
    assert.equal(G.konuDenetle(`${m} ${'x'.repeat(130)}`), null, m);
  assert.match(G.konuDenetle(`merge ${'x'.repeat(130)}`), /simdi/, 'kucuk harf muaf degil');
});

test('GD2 konu satiri kancadaki gibi okunur, --konu cikis kodu', () => {
  assert.equal(G.konuSatiri('# yorum\nGercek konu satiri\r\n\ngovde'), 'Gercek konu satiri');
  assert.equal(G.konuSatiri('\nkonu'), '', 'bos ilk satir konu sayilir (kancada da oyle)');
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'gd2-'));
  try {
    const yaz = (ad, metin) => {
      fs.writeFileSync(path.join(dizin, ad), metin);
      return spawnSync(process.execPath, [BETIK, '--konu', path.join(dizin, ad)], {
        encoding: 'utf8',
      });
    };
    assert.equal(yaz('iyi', 'Anlamli bir konu satiri\n\ngovde\n').status, 0);
    const kotu = yaz('kotu', `${'x'.repeat(121)}\n`);
    assert.equal(kotu.status, 1);
    assert.match(
      kotu.stderr,
      /\[commit-msg\] HATA: konu satiri 8-120 karakter olmali \(simdi 121\)/,
    );
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
});

test('GD3 tek kaynak: kanca betigi cagirir, CI adimi ve kapi listesi bagli', () => {
  const kanca = oku('.husky/commit-msg');
  assert.match(kanca, /node scripts\/gecmis-denetim\.cjs --konu "\$msg_file"/);
  assert.doesNotMatch(kanca, /\b(?:8|120)\b/, 'uzunluk sinirlari kancada yeniden yazilmaz');
  assert.match(kanca, /node scripts\/sir-tarama\.cjs --mesaj/);
  const ci = oku('.github/workflows/ci.yml');
  assert.match(ci, /node scripts\/gecmis-denetim\.cjs --aralik "\$ARALIK"/);
  assert.match(ci, /pull-requests: read/);
  const { CI_EK } = require('../../scripts/kapi.cjs');
  assert.ok(CI_EK.some((k) => k.id === 'K16' && k.ci.includes('gecmis-denetim.cjs --aralik')));
});

function depoKur() {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'gd4-'));
  const g = (...a) =>
    execFileSync('git', a, {
      cwd: dizin,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Deneme',
        GIT_AUTHOR_EMAIL: 'deneme@ornek.invalid',
        GIT_COMMITTER_NAME: 'Deneme',
        GIT_COMMITTER_EMAIL: 'deneme@ornek.invalid',
      },
    }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', '/dev/null');
  const yaz = (ad, mesaj) => {
    fs.writeFileSync(path.join(dizin, ad), mesaj);
    g('add', ad);
    g('commit', '-q', '-m', mesaj);
    return g('rev-parse', 'HEAD');
  };
  return { dizin, g, yaz };
}

test('GD4 aralik: push first-parent, PR tum commit, zorla push son commit', () => {
  const { dizin, g, yaz } = depoKur();
  try {
    const taban = yaz('a', 'Taban commit konusu');
    g('checkout', '-q', '-b', 'dal');
    yaz('b', 'Dal commit bir konusu');
    yaz('c', 'Dal commit iki konusu');
    const dalUcu = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from dal', 'dal');
    const birlesme = g('rev-parse', 'HEAD');
    const push = G.commitler(`${taban}..${birlesme}`, { cwd: dizin });
    assert.equal(push.zorla, false);
    assert.deepEqual(
      push.liste.map((c) => c.sha),
      [birlesme],
      'push araliginda yalniz main adimi (dal commitleri PR icinde)',
    );
    const pr = G.commitler(`${taban}..${dalUcu}`, { pr: true, cwd: dizin });
    assert.deepEqual(
      pr.liste.map((c) => c.konu),
      ['Dal commit iki konusu', 'Dal commit bir konusu'],
    );
    // Zorla push: onceki uc yeni gecmiste yok.
    g('checkout', '-q', '--orphan', 'yeni');
    yaz('d', 'Yeniden yazilmis gecmis bir');
    const yeniUc = yaz('e', 'Yeniden yazilmis gecmis iki');
    const zorla = G.commitler(`${birlesme}..${yeniUc}`, { cwd: dizin });
    assert.equal(zorla.zorla, true);
    assert.deepEqual(
      zorla.liste.map((c) => c.sha),
      [yeniUc],
    );
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
});

test("GD5 PR iliskisi: PR'siz kirmizi, bot muaf, API hatasi gecmez", async () => {
  const yanit = (durum, govde) => async () => ({
    ok: durum < 400,
    status: durum,
    json: async () => govde,
  });
  const birlesmis = {
    depo: 'o/r',
    jeton: 't',
    getir: yanit(200, [{ merged_at: '2026-11-20T00:00:00Z' }]),
  };
  const acik = { depo: 'o/r', jeton: 't', getir: yanit(200, [{ merged_at: null }]) };
  const yok = { depo: 'o/r', jeton: 't', getir: yanit(200, []) };
  const c = { sha: 'a'.repeat(40), yazar: 'Biri', konu: 'Gecerli bir konu satiri' };
  assert.deepEqual(await G.denetle([c], birlesmis), []);
  for (const d of [acik, yok]) {
    const ihlal = await G.denetle([c], d);
    assert.equal(ihlal.length, 1);
    assert.match(ihlal[0].neden, /PR'siz/);
  }
  assert.deepEqual(await G.denetle([{ ...c, yazar: G.BOT }], yok), [], 'bot muaf');
  assert.deepEqual(await G.denetle([c], null), [], 'PR olayinda yalniz konu');
  const ikisi = await G.denetle([{ ...c, konu: 'x'.repeat(121) }], yok);
  assert.equal(ikisi.length, 2, 'konu ve PR ayri ihlal');
  await assert.rejects(
    G.denetle([c], { depo: 'o/r', jeton: 't', getir: yanit(403, {}) }),
    /GitHub API 403/,
  );
});
