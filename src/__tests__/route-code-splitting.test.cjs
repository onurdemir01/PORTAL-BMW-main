// src/__tests__/route-code-splitting.test.cjs — B6: agir sayfalar ana bundle'a girmesin.
//
// Route bazli code-splitting bilincli bir karar (App.tsx yorumu: "1.2MB tek bundle →
// ilk yuk belirgin kuculur"). Ama `DenetimPage` eager import olarak kalmisti: kendi
// route'u olan, giristen sonra ancak menuden acilan, kod tabanindaki en agir
// sayfalardan biri — tum agirligi GIRIS EKRANININ BILE indirdigi ana bundle'a
// giriyordu. Lazy'e cevrilince ana bundle 431 kB -> 340 kB (gzip 122 -> 103) dustu.
//
// Bu test yeni bir sayfanin yanlislikla eager eklenmesine karsi bekcidir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

// Ilk boyama icin GERCEKTEN kritik olanlar. Bunlar disinda hicbir sayfa eager olmamali.
const ALLOWED_EAGER = ['LoginPage', 'DashboardPage', 'ForbiddenPage'];

test('sayfa bilesenleri lazy yuklenir (izin verilenler haric)', () => {
  const eager = [...SRC.matchAll(/^import (\w+Page) from "@\/components\//gm)].map((m) => m[1]);
  const unexpected = eager.filter((n) => !ALLOWED_EAGER.includes(n));
  assert.deepEqual(unexpected, [], `bu sayfalar eager import — ana bundle sisiyor: ${unexpected.join(', ')}`);
});

test('DenetimPage lazy', () => {
  assert.match(SRC, /const DenetimPage = React\.lazy\(\(\) => import\("@\/components\/DenetimPage"\)\)/);
});

test('Suspense sinirini kaldirmadan lazy eklenmemis', () => {
  assert.match(SRC, /<Suspense fallback=/, 'lazy route var ama Suspense yok — sayfa acilirken cokerdi');
});
