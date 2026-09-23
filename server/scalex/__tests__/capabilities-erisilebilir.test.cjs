// server/scalex/__tests__/capabilities-erisilebilir.test.cjs
//
// `capabilities` KESFI ERISILEBILIR OLSUN.
//
// PR #116 `scalex_cluster_caps` icin eksiksiz bir makine yazdi: 30 gunluk TTL,
// uc-durum ayrimi (yok / bos / okunamadi), `kindsForScope` fail-safe'i, FIFO
// tahliye, bekciler. AMA TABLO HIC DOLMADI.
//
// Iki kopma vardi:
//   1. Istemci tipi uc mod tasiyordu; `capabilities` kelimesi `src/` altinda
//      HIC gecmiyordu — yani ekrandan tetiklenemiyordu.
//   2. `/discover` HER modda `assertValidDiscoveryTargets` cagiriyordu ve o da
//      namespace'i KOSULSUZ zorunlu kiliyordu. Oysa `capabilities` CLUSTER
//      duzeyidir ve namespace istemez (betik ve AWX survey'i boyle davraniyor).
//      Namespace'siz her istek 400 ile duyuyordu.
//
// Bu, depodaki "calismayan kapi" sinifi: makine var, tetikleyeni yok.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

const launch = require('../launch.cjs');

test('CA1 `capabilities` NAMESPACE ISTEMEZ, digerleri ISTER', () => {
  // Asil kapi: bu gecmiyorsa tablo hic dolmaz.
  assert.doesNotThrow(
    () => launch.assertValidDiscoveryTargets({ namespace: '', apps: [], mode: 'capabilities' }),
    'capabilities namespace istiyor — cluster yetenek taramasi HIC calisamaz',
  );
  for (const mode of ['workloads', 'state', 'health', undefined]) {
    assert.throws(
      () => launch.assertValidDiscoveryTargets({ namespace: '', apps: [], mode }),
      /namespace/i,
      `mode=${mode} icin namespace zorunlulugu kalkmis`,
    );
  }
});

test('CA2 namespace VERILIRSE `capabilities`te de DOGRULANIR (kural gevsemedi)', () => {
  assert.throws(
    () => launch.assertValidDiscoveryTargets({ namespace: 'GEÇERSİZ NS', mode: 'capabilities' }),
    /namespace/i,
    'capabilities modunda gecersiz namespace sessizce kabul ediliyor',
  );
  assert.doesNotThrow(() =>
    launch.assertValidDiscoveryTargets({ namespace: 'gecerli-ns', mode: 'capabilities' }),
  );
});

test('CA3 uygulama adi kurali HER modda AYNI kalir', () => {
  for (const mode of ['capabilities', 'workloads', undefined]) {
    assert.throws(
      () => launch.assertValidDiscoveryTargets({ namespace: 'ns', apps: ['KÖTÜ AD'], mode }),
      /uygulama/i,
      `mode=${mode}: uygulama adi dogrulamasi dusmus`,
    );
  }
});

test('CA4 `/discover` `mode`u dogrulayiciya GECIRIYOR', () => {
  const kod = kodOnly(oku('server/scalex/index.cjs'));
  const d = dilim(kod, "router.post(\n    '/discover'", 'let extraKinds');
  assert.match(
    d,
    /assertValidDiscoveryTargets\(\{[^}]*\bmode\b/,
    'mode gecirilmiyor — capabilities yine namespace isteyecek',
  );
  assert.doesNotMatch(d, /if\s*\(\s*(true|false|0|null|undefined)\s*\)/, 'olu/sabit dal');
});

test('CA5 istemci modu sunucunun KABUL LISTESIYLE ayni', () => {
  const kod = kodOnly(oku('server/scalex/index.cjs'));
  const m = kod.match(/\[([^\]]*)\]\.includes\(req\.body\?\.mode\)/);
  assert.ok(m, 'sunucudaki kabul listesi bulunamadi');
  const sunucu = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();

  const api = oku('src/api/scalexApi.ts');
  const t = api.match(/export type DiscoveryMode =([^;]+);/);
  assert.ok(t, 'DiscoveryMode bulunamadi');
  const istemci = [...t[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();

  assert.deepEqual(
    istemci,
    sunucu,
    'istemci ve sunucu mod listeleri ayristi — bir mod ekrandan tetiklenemez kalir',
  );
});

test('CA6 Admin paneli taramayi `capabilities` moduyla baslatiyor', () => {
  const kod = kodOnly(oku('src/components/admin/tabs/ScaleXAdminTab.tsx'));
  const i = kod.indexOf('function ClusterCapsPanel');
  assert.ok(i > 0, 'ClusterCapsPanel bulunamadi');
  const d = kod.slice(i);
  assert.match(d, /scalexApi\.discover\(/, 'panelde tarama baslatan cagri yok');
  assert.match(d, /'capabilities'/, 'tarama capabilities modunda baslatilmiyor');
});

test('CA7 bos-durum metni artik YANLIS yonlendirmiyor', () => {
  // Eski metin "Kesif ekranindan bir tarama kosturdugunuzda liste kendiliginden
  // dolar" diyordu — bugun bu cumle YANLISTI, cunku o yol hic calismiyordu.
  const ham = oku('src/components/admin/tabs/ScaleXAdminTab.tsx');
  assert.doesNotMatch(
    ham,
    /Keşif ekranından bir tarama koştuğunuzda liste\s*\n?\s*kendiliğinden dolar/,
    'yanlis yonlendiren bos-durum metni geri gelmis',
  );
  assert.match(ham, /<strong>Tara<\/strong>/, 'kullaniciya nereye basacagi soylenmiyor');
});
