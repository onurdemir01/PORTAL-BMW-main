// src/__tests__/backdrop-dismiss.test.cjs
//
// "Arka plana tiklayinca kapat" tuzagi (kullanici bildirimi, 2026-09-11): pencereler
//     onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
// ile kapaniyordu. `click` farenin BIRAKILDIGI ogeye gider; editorde metin secip fareyi
// disarida birakmak pencereyi kapatiyor ve girilen her seyi siliyordu.
//
// Iki sey kilitlenir:
//  1) karar fonksiyonu: yalnizca basma VE birakma arka plandaysa kapat
//  2) kaynak bekcisi: HICBIR pencere eski kalibi kullanmasin
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// TS dosyasini derlemeden test etmek icin saf fonksiyonu metinden cikariyoruz:
// shouldDismiss bilerek bagimliliksiz, tek satirlik bir mantik.
function loadShouldDismiss() {
  const src = fs.readFileSync(path.join(ROOT, 'components/common/backdropDismiss.ts'), 'utf8');
  const m = /export function shouldDismiss\(([^)]*)\)\s*\{\s*return ([^;]+);/.exec(src);
  assert.ok(m, 'shouldDismiss bulunamadi');
  const params = m[1].replace(/:\s*boolean/g, '').replace(/\s*=\s*true/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(params, 'return ' + m[2] + ';');
}

test('yalnizca basma VE birakma arka plandaysa kapatir', () => {
  const f = loadShouldDismiss();
  assert.equal(f(true, true, true), true, 'gercek arka plan tiklamasi kapatmali');
  // Panelde basla, arka planda birak = SURUKLEME. Kapatmamali.
  assert.equal(f(false, true, true), false, 'panelde baslayan surukleme KAPATMAMALI');
  assert.equal(f(true, false, true), false);
  assert.equal(f(false, false, true), false);
});

test('enabled=false: arka plan tiklamasi hicbir zaman kapatmaz', () => {
  const f = loadShouldDismiss();
  assert.equal(f(true, true, false), false);
});

test('hicbir pencere eski "target === currentTarget -> onClose" kalibini kullanmiyor', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        // "e.target === e.currentTarget" ya da "=== overlayRef.current" ile onClose
        if (/onClick=\{\s*\(e\)\s*=>\s*\{\s*if\s*\(e\.target\s*===\s*(e\.currentTarget|\w+Ref\.current)\)\s*onClose\(\)/.test(src)) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    }
  };
  walk(path.join(ROOT, 'components'));
  assert.deepEqual(
    offenders,
    [],
    'Bu dosyalar surukleme ile kapanan eski kalibi kullaniyor; useBackdropDismiss kullanin:\n' +
      offenders.join('\n'),
  );
});

test('Is Baslat penceresi arka plan tiklamasina KAPALI', () => {
  const src = fs.readFileSync(path.join(ROOT, 'components/ansible/AnsiblePage.tsx'), 'utf8');
  const i = src.indexOf('function LaunchModal(');
  assert.ok(i > 0);
  const body = src.slice(i, src.indexOf('function InfoRow('));
  assert.ok(
    /useBackdropDismiss\(onClose,\s*false\)/.test(body),
    'LaunchModal arka plan tiklamasiyla kapanmamali (form silinir)',
  );
});
