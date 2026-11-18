// server/__tests__/repo-hijyeni.test.js — repoda yetim (hicbir yerden ulasilamayan) dosya kalmaz.
//
// Kural (docs/KALITE-KAPILARI.md "Repo hijyeni"): kullanilmayan belge, betik ya da modul repoda
// kalmaz; insan ya da ajan, kim yazmis olursa. 2026-11-18 temizligi 20 bayat dosya sildi; bu bekci
// yenilerinin birikmesini CI'da durdurur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  yetimler,
  repoTaramasi,
  KOK_STANDART,
  YALNIZ_TEST_IZINLI,
} = require('../../scripts/repo-hijyeni.cjs');

test('RH1 repoda yetim belge, betik ya da modul yok', () => {
  const y = repoTaramasi();
  assert.deepEqual(
    y.map((x) => `${x.tur} ${x.dosya}: ${x.neden}`),
    [],
    'yetim dosyayi kullanan yerden bagla (README / ilgili belge / kod) ya da sil',
  );
});

test('RH2 bekcinin kendisi kor degil: yetimi yakalar, kullanilani birakir', () => {
  const repo = {
    'package.json':
      '{"scripts":{"start":"node server/index.cjs","migrate":"node server/db/migrate.cjs","x":"node scripts/arac.cjs"}}',
    'README.md': '[Kurulum](docs/KURULUM.md)',
    'CHANGELOG.md': '- docs/ESKI-PLAN.md eklendi; server/olu.cjs duzeltildi',
    'docs/KURULUM.md': 'Ayrinti: docs/ALT.md',
    'docs/ALT.md': 'alt belge',
    'docs/YETIM.md': 'kimse anmiyor',
    'docs/DONGU-A.md': 'bkz. docs/DONGU-B.md',
    'docs/DONGU-B.md': 'bkz. docs/DONGU-A.md',
    'docs/ESKI-PLAN.md': 'yalniz CHANGELOG anar',
    'docs/KOD-ANIYOR.md': 'kod yorumu anar',
    'scripts/arac.cjs': '// arac',
    'scripts/tek-seferlik.cjs': '// kimse cagirmiyor',
    'server/index.cjs':
      "require('./db/migrate.cjs'); require('./tembel/poller.cjs'); // bkz. docs/KOD-ANIYOR.md",
    'server/db/migrate.cjs': '',
    'server/tembel/poller.cjs': "const m = cModulu('analiz.cjs');",
    'server/tembel/analiz.cjs': '',
    'server/olu.cjs': '',
    'server/yalniz-test.cjs': '',
    'server/__tests__/x.test.js': "require('../yalniz-test.cjs'); require('../index.cjs');",
    'src/main.tsx':
      "import { a } from '@/utils/yardimci'; import B from './bilesen'; import C from './kutu/index';",
    'src/utils/yardimci.ts': '',
    'src/bilesen/index.tsx': '',
    'src/kutu/index.ts': '',
    'src/utils/olu.ts': '',
    'kalite/kapsam/lcov.info': 'SF:server/olu.cjs\nSF:docs/YETIM.md',
  };
  const dosyalar = Object.keys(repo);
  const y = yetimler(dosyalar, (f) => repo[f]);
  const ad = y.map((x) => x.dosya);
  for (const yetim of [
    'docs/YETIM.md',
    'docs/DONGU-A.md',
    'docs/DONGU-B.md',
    'docs/ESKI-PLAN.md',
    'scripts/tek-seferlik.cjs',
    'server/olu.cjs',
    'server/yalniz-test.cjs',
    'src/utils/olu.ts',
  ]) {
    assert.ok(ad.includes(yetim), `yetim yakalanmadi: ${yetim} (${JSON.stringify(ad)})`);
  }
  for (const canli of [
    'README.md',
    'CHANGELOG.md',
    'docs/KURULUM.md',
    'docs/ALT.md',
    'docs/KOD-ANIYOR.md',
    'scripts/arac.cjs',
    'server/index.cjs',
    'server/db/migrate.cjs',
    'server/tembel/analiz.cjs',
    'src/utils/yardimci.ts',
    'src/bilesen/index.tsx',
    'src/kutu/index.ts',
  ]) {
    assert.ok(!ad.includes(canli), `kullanilan dosya yetim sayildi: ${canli}`);
  }
  assert.equal(
    y.find((x) => x.dosya === 'server/yalniz-test.cjs').neden,
    'yalniz testler yukluyor (olu kod)',
  );
});

test('RH3 istisnalar dar ve gerekceli', () => {
  assert.deepEqual([...KOK_STANDART].sort(), [
    'AGENTS.md',
    'CHANGELOG.md',
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'GEMINI.md',
    'README.md',
    'SECURITY.md',
  ]);
  assert.ok(
    YALNIZ_TEST_IZINLI.size <= 1,
    'yalniz-test istisnasi buyumesin: yardimciyi test agacina tasi',
  );
  for (const [, gerekce] of YALNIZ_TEST_IZINLI) assert.ok(gerekce.length > 10);
});
