// server/ansible/__tests__/ear-regex-dogrusal.test.js — Sonar S8786: EAR / web tarayicisinin Python
// desenleri (hedefte Python 3.6+) dogrusal yazildi; esdegerlik GERCEK python3 ile kanitlanir
// (fixtures/ear_regex_esdeger.py modulleri dosyadan yukler, eski desen yalniz orada referans).
//
//   EG1 JVM_KULLANICI_RE `([A-Za-z0-9_$#.-]+/)[^@/ "]+@` -> `(?<=[A-Za-z0-9_$#.-])(/)[^@/ "]+@`.
//       Eski desen her kullanici adi konumundan '/' arardi (karesel). Yeni eslesme '/'den baslar, \1
//       artik yalniz '/'; kullanici adi eslesmenin disinda yerinde kalir -> `\1***@` ciktisi ayni.
//       jvm_maskele: yeni modul == eski desenli kopya, 5000+ girdi.
//   EG2 JAR_RE: tembel `(.+?)-` her '-<rakam>' adayindan sona tarardi. Yeni grup 1: son '/'ye kadar
//       (ilk satirda) + o parcada ilk '-<rakam>'a kadar; sonuc eskisinin en kucuk gecerli adayi.
//       jar_ayir: yeni == eski, 5000+ girdi (yapili jar adlari dahil).
//   EG3 ACCESS_ISTEK `(\S+)[^"]*` ortusuyordu -> `(\S+)(?:\s[^"]*)?`: \S+ tam kosu ya da (kosu '"' ile
//       bitiyorsa) bir eksigi; gruplar ve aralik ayni, 5000+ yapili access satiri.
//   EG4 kotu girdide (50k+ karakter) yeni desenler < 200 ms.
//   EG5 desenlerde Python 3.6'da olmayan yapi yok (atomik grup / iyelik niceleyici 3.11+).
'use strict';
const { esnek } = require('../../__tests__/fixtures/kod-deseni.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { adaylar } = require('./fixtures/python-bul.cjs');

const FILES = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'ear_envanter', 'files');
const EAR = path.join(FILES, 'ear_tara.py');
const WEB = path.join(FILES, 'web_tara.py');
const BETIK = path.join(__dirname, 'fixtures', 'ear_regex_esdeger.py');

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (
      spawnSync(komut, [...on, '-c', 'import re, importlib.util'], { stdio: 'ignore' }).status === 0
    )
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();
const SKIP = PY ? false : 'python3 bulunamadi - EAR regex esdegerlik bekcileri KOSMADI';

let sonuc = null;
function kosu() {
  if (sonuc) return sonuc;
  const r = spawnSync(PY.komut, [...PY.on, '-I', '-B', BETIK, EAR, WEB], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(r.status, 0, `betik dustu: ${r.stderr}`);
  sonuc = JSON.parse(r.stdout.trim().split('\n').pop());
  return sonuc;
}

function karsilastirma(ad) {
  const k = kosu().karsilastirma.find((x) => x.ad.startsWith(ad));
  assert.ok(k, `${ad} sonucu yok`);
  assert.equal(k.fark, undefined, `${ad} fark: ${JSON.stringify(k.fark)}`);
  return k;
}

test('EG1 JVM_KULLANICI_RE: jvm_maskele ciktisi eski desenle ayni', { skip: SKIP }, () => {
  const k = karsilastirma('J1');
  assert.ok(k.adet >= 5000, `girdi az: ${k.adet}`);
  assert.ok(k.eslesen >= 500, `maskelenen az: ${k.eslesen}`);
});

test('EG2 JAR_RE: jar_ayir ciktisi eski desenle ayni', { skip: SKIP }, () => {
  const k = karsilastirma('J2');
  assert.ok(k.adet >= 5000, `girdi az: ${k.adet}`);
  assert.ok(k.eslesen >= 200, `surum ayrilan az: ${k.eslesen}`);
});

test('EG3 ACCESS_ISTEK: search gruplari ve araligi eski desenle ayni', { skip: SKIP }, () => {
  const k = karsilastirma('J3');
  assert.ok(k.adet >= 5000, `girdi az: ${k.adet}`);
  assert.ok(k.eslesen >= 500, `eslesen az: ${k.eslesen}`);
});

test('EG4 kotu girdide yeni desenler 200 ms altinda', { skip: SKIP }, () => {
  const s = kosu().sure_ms;
  assert.deepEqual(Object.keys(s).sort(), [
    'access_acik',
    'access_tirnak',
    'jar_egik',
    'jar_tire',
    'jvm_egik',
    'jvm_harf',
  ]);
  for (const [ad, ms] of Object.entries(s)) assert.ok(ms < 200, `${ad}: ${ms} ms`);
});

test('EG5 desenler Python 3.6 ile uyumlu (atomik grup / iyelik niceleyici yok)', () => {
  const satirlar = [
    ...fs
      .readFileSync(EAR, 'utf8')
      .split('\n')
      .filter((l) => /^(JVM_KULLANICI_RE|JAR_RE) = /.test(l)),
    ...fs
      .readFileSync(WEB, 'utf8')
      .split('\n')
      .filter((l) => /^ACCESS_ISTEK = /.test(l)),
  ];
  assert.equal(satirlar.length, 3, 'uc desen satiri bulunamadi');
  for (const l of satirlar) {
    assert.doesNotMatch(l, esnek(/\(\?>/), `atomik grup: ${l}`);
    assert.doesNotMatch(l, /[*+?}]\+/, `iyelik niceleyici: ${l}`);
  }
});
