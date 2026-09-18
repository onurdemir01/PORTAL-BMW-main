// server/admin/__tests__/system-config-ekran.test.cjs
// BEYAZ LISTEDEKI HER AYAR EKRANDA DA OLMALI.
//
// 2026-09-18 denetimi: `SCALEX_*` yedi anahtar `SYSTEM_CONFIG_KEYS`te vardi ve
// `PUT /api/admin/system-config` onlari KABUL EDIYORDU — ama `SystemConfigTab`
// ekrani ELLE KURATORLU bir `ENV_VARS` listesinden ciziliyor ve o listede
// yoklardi. Sonuc: PR #102'nin "ScaleX ayarlari admin ekranindan verilebilecek"
// vaadi yalnizca API duzeyinde gerceklesmisti; ekranda ALAN YOKTU.
//
// Ayni kayma OPSX_*_TEMPLATE_ID ve OCO_TIMEOUT_MS'te de vardi (uzun suredir).
// DA6 bekcisi yalnizca SUNUCU tarafini (TUNABLES <-> SYSTEM_CONFIG_KEYS <->
// HOT_RELOADABLE_KEYS) olcuyordu — ekran tarafi hic bakilmiyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TAB = path.join(ROOT, 'src/components/admin/tabs/SystemConfigTab.tsx');

/** Ekrandaki `ENV_VARS` girdilerinin anahtarlari. */
function ekranAnahtarlari() {
  const src = fs.readFileSync(TAB, 'utf8');
  return [...src.matchAll(/\{\s*key:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

test('S11 `SYSTEM_CONFIG_KEYS`teki her anahtar admin ekraninda GORUNUYOR', () => {
  const { SYSTEM_CONFIG_KEYS } = require('../../db/env-overrides.cjs');
  const ekranda = ekranAnahtarlari();

  // TOPLAYICI BOSALMASIN: desen bozulursa liste sifirlanir ve test VAKUMLA gecer.
  assert.ok(ekranda.length >= 50, `ekran toplayicisi yalnizca ${ekranda.length} anahtar gordu`);

  const eksik = SYSTEM_CONFIG_KEYS.filter((k) => !ekranda.includes(k));
  assert.deepEqual(
    eksik,
    [],
    'Bu anahtarlar sunucuda duzenlenebilir ama EKRANDA ALAN YOK — kullanici ancak ' +
      `elle API cagrisiyla girebilir:\n  ${eksik.join('\n  ')}`,
  );
});

// S12 — SICAK ANAHTARLAR EKRANDA "RESTART GEREKIR" DEMEMELI.
// Ekranin kendi `restartRequired` alani IKINCI bir dogruluk kaynagiydi; sunucu
// "gerekmez" derken ekran "gerekir" yaziyordu ve kullanici bosuna kesinti
// planliyordu. Artik karar sunucunun `hotReloadable` alanindan geliyor.
test('S12 sicak yuklenen anahtarlar ekranda `restartRequired: true` TASIMIYOR', () => {
  const { HOT_RELOADABLE_KEYS } = require('../../db/env-overrides.cjs');
  const src = fs.readFileSync(TAB, 'utf8');
  const yanlis = [];
  for (const key of HOT_RELOADABLE_KEYS) {
    const satir = src.split('\n').find((l) => l.includes(`key: "${key}"`));
    assert.ok(satir, `${key} ekranda yok (S11 bunu zaten yakalamali)`);
    if (/restartRequired:\s*true/.test(satir)) yanlis.push(key);
  }
  assert.deepEqual(yanlis, [], `sicak yuklenen ama "restart gerekir" yazan: ${yanlis.join(', ')}`);
});

// S13 — KAYDETME SONRASI UYARI KOSULLU OLMALI.
// `setRestartNeeded(true)` KOSULSUZ cagriliyordu: sicak bir ayari degistiren
// admin de "sunucu yeniden baslatilmali" bandini goruyordu. Karar PUT yanitindaki
// `restartRequired` alanindan gelmeli (o da anahtara gore hesaplaniyor).
test('S13 kaydetme sonrasi restart bandi PUT yanitina bagli', () => {
  const src = fs.readFileSync(TAB, 'utf8');
  const kodSatirlari = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(
    kodSatirlari,
    /^\s*setRestartNeeded\(true\);\s*$/m,
    'restart bandi KOSULSUZ aciliyor — sicak ayarlarda yanlis uyari',
  );
  assert.match(
    kodSatirlari,
    /r\.restartRequired !== false/,
    'restart karari PUT yanitindan okunmuyor',
  );
});
