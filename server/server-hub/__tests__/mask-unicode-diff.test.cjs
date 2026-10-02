// server/server-hub/__tests__/mask-unicode-diff.test.cjs - maskenin Unicode (T2-M1) ve jvm_arg_diff
// (T2-M2) kurallari. Ortak vakalar (20-33) mask_cases.json'da ve D1-C26'da; burasi her anahtar kelime
// konumunu (KEY_ERE, R4, R8a, R8b) ve jvm_arg_diff'in sinir durumlarini ayrica kilitler.
// Ucuncu katman loader (server_hub_loader.py) ve tarayici awk (server_hub_scan.sh --mask) ile bire bir;
// uc katman diferansiyeli Ansible deposundaki harness'lerde (L24, sc_K).
// Dosya ASCII kalir (lint:ascii): Unicode harfler String.fromCharCode ile.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mask = require('../mask.cjs');

const I_NOKTALI = String.fromCharCode(0x130);
const I_NOKTASIZ = String.fromCharCode(0x131);
const UZUN_S = String.fromCharCode(0x17f);
const KELVIN = String.fromCharCode(0x212a);

test('T2-M1 dort Unicode esdeger her anahtar kelime konumunda maskelenir (KEY_ERE, R4, R8a, R8b)', () => {
  const vakalar = [
    // KEY_ERE (R2): Turkce buyuk/kucuk harf donusumu ciktisi
    [`CREDENT${I_NOKTALI}AL=v1`, `CREDENT${I_NOKTALI}AL=***`],
    [`cl${I_NOKTASIZ}ent_key: v2`, `cl${I_NOKTASIZ}ent_key: ***`],
    [`to${KELVIN}en=v3`, `to${KELVIN}en=***`],
    [`${UZUN_S}ecret=v4`, `${UZUN_S}ecret=***`],
    // R1 (-D anahtari) ve R6 (DMR)
    [`-Dx.pr${I_NOKTALI}vate.key=v5`, `-Dx.pr${I_NOKTALI}vate.key=***`],
    [`"pa${UZUN_S}${UZUN_S}word" => "v6"`, `"pa${UZUN_S}${UZUN_S}word" => "***"`],
    // R4 bayrak, R8a / R8b XML
    [`--pa${UZUN_S}s v7`, `--pa${UZUN_S}s ***`],
    [`<${UZUN_S}ecret value="v8"/>`, `<${UZUN_S}ecret value="***"/>`],
    [`<PA${UZUN_S}SWORD>v9</pa${UZUN_S}sword>`, `<PA${UZUN_S}SWORD>***</pa${UZUN_S}sword>`],
  ];
  for (const [girdi, beklenen] of vakalar) assert.equal(mask.maskText(girdi), beklenen, girdi);
  // beyaz liste karari da ayni katlamayi kullanir: 'jboss.' onekinin altindaki sir anahtari
  assert.equal(mask.degerAcik(`jboss.AP${I_NOKTALI}_KEY`), false);
  assert.equal(mask.degerAcik('jboss.node.name'), true);
  assert.equal(
    mask.maskJvmArgs(`-Djboss.s${I_NOKTALI}gning.key=v10`),
    `-Djboss.s${I_NOKTALI}gning.key=***`,
  );
});

test('T2-M1 katlama YALNIZ ASCII + dort acik esdeger: katla() ve KATLAMA', () => {
  assert.deepEqual(Object.keys(mask.KATLAMA).sort(), ['i', 'k', 's']);
  assert.equal(mask.katla('ab'), 'ab', 'i/s/k disindaki harf degismemeli');
  const re = new RegExp(`^${mask.katla('isk')}$`, 'i');
  for (const s of ['isk', 'ISK', `${I_NOKTALI}${UZUN_S}${KELVIN}`, `${I_NOKTASIZ}sk`])
    assert.ok(re.test(s), s);
  // Kullanici / anahtar-adi siniflari ASCII disi her karakteri kapsar (Turkce harf, vekil cifti)
  assert.equal(mask.maskText(`DB${I_NOKTALI}/Pw1@h`), `DB${I_NOKTALI}/***@h`);
  assert.equal(
    mask.maskText(`password${UZUN_S}${I_NOKTASIZ}=Pw2`),
    `password${UZUN_S}${I_NOKTASIZ}=***`,
  );
});

test('T2-M2 jvm_arg_diff sinir durumlari (loader maske_jvm_diff ve tarayici jd() ile ayni)', () => {
  const d = mask.maskJvmArgDiff;
  assert.equal(d(null), null);
  assert.equal(d(undefined), undefined);
  assert.equal(d(''), '');
  assert.equal(d('partial; '), 'partial; ');
  assert.equal(d(' ...+3'), ' ...+3');
  assert.equal(d('a; '), 'a; ');
  assert.equal(d('; '), '; ');
  // reason= metni serbest maskeden gecer, 'partial; ' onekiyle de
  assert.equal(d('partial; reason=CLI_FAIL token=t1'), 'partial; reason=CLI_FAIL token=***');
  // -D'siz anahtar ve -D oneki ayni beyaz liste karari
  assert.equal(
    d('jboss.node.name running=a configured=b'),
    'jboss.node.name running=a configured=b',
  );
  assert.equal(d('-Djava.home running=/a configured=/b'), '-Djava.home running=/a configured=/b');
  assert.equal(
    d('-Dapp.secret running=s1 configured=s2'),
    '-Dapp.secret running=*** configured=*** (farkli)',
  );
  // acgozlu: SON ' configured=' ayirir; deger satir sonu tasisa da ('s') oge bicimine uyar
  assert.equal(d('k running=a configured=b configured=c'), 'k running=*** configured=*** (farkli)');
  assert.equal(d('k running=a\nb configured=c'), 'k running=*** configured=*** (farkli)');
  // ' configured=' yoksa oge bicimsizdir: serbest maske
  assert.equal(d('k running=password=p1'), 'k running=password=***');
  // -X ogesi serbest maskeden gecer (normal -X degeri degismez)
  assert.equal(d('-Xmx running=2048m configured=4096m'), '-Xmx running=2048m configured=4096m');
  // kesme isareti yalniz SONDA korunur; ortadaki ' ...+N' oge metnidir
  assert.equal(
    d('-Dx running=1 configured=2 ...+1; -Dy running=3 configured=4 ...+2'),
    '-Dx running=*** configured=*** (farkli); -Dy running=*** configured=*** (farkli) ...+2',
  );
  // zaten maskeli deger ayni kalir (loader mask_hits saymaz)
  const m = '-Dfoo running=*** configured=*** (farkli)';
  assert.equal(d(m), m);
});
