// server/audit/__tests__/spa-yalniz-ark.test.cjs - YA1..YA2 (2026-11-11).
//
// Kullanici: "SPA'ler sadece ve sadece ARK OpenShift cluster'larinda bulunuyor; diger cluster'larla bir
// iliskisi, gosterimi vb. hicbir seyin olmasina gerek yok."
//   YA1 SPA uclarinin (Kapsam & Tasima, Production Tasimalari) route / OpenShift envanteri sorgulari ARK'a
//       suzulu: cluster suzgeci olmayan sorgu kalmadi (OpenShift Kapsami /ocp-coverage BILEREK haric -
//       o sayfa tum tenant'lar icin). Gercek SPA Kesfi suzgeci davranissal: spa-rp.test.cjs SR26a.
//   YA2 SPA uclari ?platform= yok sayar (sabit 'ark'); Kapsam ekranindaki "ARK disi cluster" notu yok.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');
const TABLO_RE = /FROM dbo\.(BMW_Openshift_Route_Inventory|Openshift_Inventory)\b/g;

function suzgecsizler(metin, bitis = metin.length) {
  const out = [];
  for (const m of metin.matchAll(TABLO_RE)) {
    if (m.index >= bitis) continue;
    const devam = metin.slice(m.index, m.index + 260);
    const ifade = devam.split('`')[0];
    // IN (ARK listesi) ya da = @parametre (ucta ARK listesine karsi dogrulanmis tek cluster).
    if (!/\bcluster(_name)?\s+(IN\s*\(|=\s*@)/i.test(ifade)) out.push(`${m[1]} @${metin.slice(0, m.index).split('\n').length}`);
  }
  return out;
}

test('YA1 SPA sorgulari ARK cluster suzgecli', () => {
  const den = oku('server/audit/denetim.cjs');
  const ocpKapsam = den.indexOf("router.get('/ocp-coverage'");
  assert.ok(ocpKapsam > 0, '/ocp-coverage ucu bulunamadi (bekci sinirini guncelleyin)');
  assert.deepEqual(suzgecsizler(den, ocpKapsam), [], 'denetim.cjs SPA uclarinda cluster suzgeci olmayan sorgu');
  assert.deepEqual(suzgecsizler(oku('server/audit/nginx-migration.cjs')), [], 'nginx-migration.cjs suzgecsiz sorgu');
});

test('YA2 platform sabit ark; ARK disi not ekranda yok', () => {
  const den = oku('server/audit/denetim.cjs');
  assert.ok(!/PLATFORM_CLUSTERS\[String\(req\.query\.platform/.test(den), '?platform= hala okunuyor');
  assert.equal((den.match(/const platform = 'ark';/g) || []).length, 4);
  const ozet = oku('src/components/denetim/NginxSpaSummary.tsx');
  assert.ok(!/platformDisi/.test(ozet), 'Kapsam ekraninda ARK disi cluster notu duruyor');
});
