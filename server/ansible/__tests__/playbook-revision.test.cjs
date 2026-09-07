// server/ansible/__tests__/playbook-revision.test.cjs — AWX'TEKI KOPYA BAYAT MI?
//
// NEDEN VAR: `server/ansible/bmw_portal/` klasoru AWX projesine ELLE kopyalanir.
// Kopyalanmadiginda AWX ESKI surumu kosar, ama portalda gorunen hata repodaki
// (coktan duzeltilmis) koda ait olur — teshis saatlerce YANLIS YERDE aranir.
//
// 2026-09-07'de bu dongude DORT tur donuldu. Son turda #3297277'nin sebebi
// (`resolved_password` tanimi) `ebd603f` ile zaten duzeltilmisti; AWX'teki kopya
// bayatti ve hicbir sey bunu SOYLEMIYORDU.
//
// Mekanizma: playbook, iceriginin ozetinden turetilen bir damgayi play 1'de
// `set_stats` ile yayinlar; portal gelen degeri manifest'le karsilastirir.
// Bu bekci mekanizmanin UC halkasini da kilitler — zincirin biri kopunca
// "bayat kopya" tespiti SESSIZCE olur, cunku uyari zaten gorunmeyen bir seydir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AWX_TREE, expectedRevisionFor } = require('../paths.cjs');
const rev = require('../../../scripts/playbook-rev.cjs');

const MANIFEST = JSON.parse(fs.readFileSync(rev.MANIFEST, 'utf8'));

test('PV1 damga ICERIKLE tutuyor (playbook damga guncellenmeden degistirilmemis)', () => {
  const computed = rev.computeAll();

  // Toplayici yanlis dizine bakarsa bekci bos kumeyle sessizce yesil kalmasin.
  assert.ok(Object.keys(computed).length >= 3, "damgalanan playbook sayisi 3'ten az");

  const bayat = Object.entries(computed)
    .filter(([k, v]) => MANIFEST[k]?.hash !== v.hash)
    .map(([k]) => k);
  assert.deepEqual(
    bayat,
    [],
    'Playbook degisti ama damga guncellenmedi:\n' +
      bayat.map((b) => `  - ${b}`).join('\n') +
      '\n`npm run playbook:rev` calistirip degisikligi commit edin.\n' +
      'Damga guncellenmezse portal AWX kopyasinin bayat oldugunu ANLAYAMAZ.',
  );
});

test('PV2 dosyadaki damga manifest ile AYNI (ve HER kopyasi ayni)', () => {
  for (const [rel, info] of Object.entries(MANIFEST)) {
    const src = fs.readFileSync(path.join(AWX_TREE, rel), 'utf8');
    // YALNIZCA hex damga satirlari. `"{{ logx_playbook_revision }}"` bir SABLONDUR,
    // damga degil; onu da esleyen ilk hal bekciyi sahte kirmiziya dusurdu.
    const stamps = [...src.matchAll(/logx_playbook_revision:\s*"([0-9a-f]+)"/g)].map((m) => m[1]);
    assert.ok(stamps.length >= 1, `${rel}: dosyada damga YOK`);
    for (const s of stamps) {
      assert.equal(s, info.revision, `${rel}: dosyadaki damga manifest ile uyusmuyor`);
    }
  }
});

test('PV3 damga ARIZA ANINDA DA okunabilsin diye EN BASTA yayinlaniyor', () => {
  for (const rel of Object.keys(MANIFEST)) {
    const src = fs.readFileSync(path.join(AWX_TREE, rel), 'utf8');
    const stampTask = src.indexOf('logx_playbook_revision: "{{ logx_playbook_revision }}"');
    assert.ok(stampTask > 0, `${rel}: damga set_stats ile YAYINLANMIYOR — portal okuyamaz`);

    // Sonucu yayinlayan set_stats EN SONDADIR. Damga ondan ONCE gelmeli: is ilerde
    // duserse (uretimde tam boyle oldu) tek okunabilir artifact damga olur.
    //
    // Olcut `logx_result:` metni DEGIL — o dize dosyanin bas yorumunda da geciyor ve
    // bekciyi damganin ONUNE dusuruyordu (yani bekci kendi belgesini kod saniyordu).
    // Olcut YAPI: damga, dosyadaki ILK `set_stats` olmali.
    const statCalls = [...src.matchAll(/ansible\.builtin\.set_stats:/g)].map((m) => m.index);
    assert.ok(statCalls.length >= 2, `${rel}: beklenen iki set_stats (damga + sonuc) yok`);
    assert.ok(
      stampTask < statCalls[1],
      `${rel}: damga ILK set_stats degil — is erken duserse okunamaz`,
    );

    // Ve play 1'de olmali: orada hicbir sey patlayamaz (bastion'a hic gidilmez).
    const play2 = src.indexOf('hosts: logx_terminal');
    assert.ok(
      stampTask < play2,
      `${rel}: damga bastion play'inde yayinlaniyor — bastion'a ulasilamazsa damga da gelmez`,
    );
  }
});

test('PV4 portal hem UYUSMAZLIGI hem DAMGANIN YOKLUGUNU ele aliyor', () => {
  const jobs = require('../../logx/v2/jobs.cjs');
  const P = 'bmw_portal/logx/ocp/logx_ocp_app_discovery.yml';
  const guncel = expectedRevisionFor(P);
  assert.ok(guncel, 'beklenen damga cozulemedi');

  // 1) Guncel kopya: SUSAR. Yanlis suclama, hicbir sey soylememekten kotudur.
  assert.equal(
    jobs.buildPlaybookStalenessWarning({
      playbook: P,
      artifacts: { logx_playbook_revision: guncel },
    }),
    null,
  );
  // AWX surumleri stats'i farkli sarar; ucu de okunmali.
  assert.equal(
    jobs.buildPlaybookStalenessWarning({
      playbook: P,
      artifacts: { data: { logx_playbook_revision: guncel } },
    }),
    null,
  );
  assert.equal(
    jobs.buildPlaybookStalenessWarning({
      playbook: P,
      artifacts: { ansible_stats: { data: { logx_playbook_revision: guncel } } },
    }),
    null,
  );

  // 2) Damga FARKLI: soyler.
  const farkli = jobs.buildPlaybookStalenessWarning({
    playbook: P,
    artifacts: { logx_playbook_revision: 'deadbeef00' },
  });
  assert.match(farkli, /deadbeef00/);
  assert.match(farkli, new RegExp(guncel));

  // 3) Damga HIC YOK — EN OLASI HAL: damgadan eski bir kopya onu yayinlamaz.
  //    Bu dal silinirse mekanizma tam da is gorecegi anda bozulur.
  const yok = jobs.buildPlaybookStalenessWarning({ playbook: P, artifacts: {} });
  assert.ok(yok, 'damga hic gelmediginde portal SUSUYOR — bayat kopyanin en olasi hali budur');
  assert.match(yok, new RegExp(guncel), 'repo surumu yazilmamis');

  // "BIR SEY SOYLUYOR" YETMEZ — NE soyledigi onemli.
  //
  // Bekcinin ilk hali yalnizca `assert.ok(yok)` diyordu ve MUTASYON TURUNDA YESIL
  // KALDI: damga-yoklugu dalini silince akis uyusmazlik sablonuna dusuyor ve
  // "AWX: null" diye bir metin uretiyordu. Kullaniciya "null" gostermek, hic
  // gostermemekten iyi degil.
  assert.doesNotMatch(
    yok,
    /\bnull\b|\bundefined\b/,
    'damga yokken uydurma bir deger basiliyor:\n' + yok,
  );

  // BOS damga da YOKLUK demektir; iki girdi AYNI mesaji uretmeli.
  assert.equal(
    jobs.buildPlaybookStalenessWarning({ playbook: P, artifacts: { logx_playbook_revision: '' } }),
    yok,
    'bos damga ile damgasizlik farkli ele aliniyor — ikisi de "kopya eski" demektir',
  );

  // Ve uyusmazlik mesajindan AYRI olmali: ayni sablona dusuyorsa dal yok demektir.
  assert.notEqual(yok, farkli, 'damga yoklugu ile uyusmazlik ayni mesaji uretiyor');

  // 4) Damgalanmamis playbook: SUSAR (telnet/opsx hakkinda hicbir sey demez).
  assert.equal(
    jobs.buildPlaybookStalenessWarning({
      playbook: 'bmw_portal/telnet_openshift/telnet_openshift.yaml',
      artifacts: {},
    }),
    null,
  );
});

test('PV5 uyari kullaniciya GOSTERILEN metnin ONUNE geciyor', () => {
  // "beklenmeyen bir hata olustu" diye baslayan bir metni okuyan kullanici, gercek
  // sebebin AWX'te duran eski bir dosya oldugunu asla tahmin edemez.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'logx/v2/jobs.cjs'), 'utf8');
  const fn = src.slice(
    src.indexOf('async function pollJob('),
    src.indexOf('async function cancelJob('),
  );
  assert.match(fn, /buildPlaybookStalenessWarning\(/, 'pollJob uyariyi hic hesaplamiyor');
  assert.match(
    fn.replace(/\s+/g, ' '),
    /errorMessage\s*=\s*baseError && staleWarning \? `\$\{staleWarning\} \$\{baseError\}`/,
    'uyari kullanici mesajinin ONUNE eklenmiyor — sonuna eklenirse okunmaz',
  );
});
