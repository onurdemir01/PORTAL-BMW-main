// server/opsx/__tests__/basarisiz-iste-sebep.test.js — BS1..BS5 (2026-09-30).
//
// URETIM: kullanici Crypto Hub cluster'i (odocptest1 / harmonize-test) icin OpsX pod
// kesfi calistirdi, "patliyor" dedi ama SEBEP hicbir yerde gorunmuyordu (job 3364180).
//
// Playbook dogru davraniyordu: (cluster,namespace) ciftinin hatasini toplayip `set_stats`
// ile YAYINLIYOR, sonra AWX isi kirmizi kalsin diye BILEREK `fail` ediyor. Dosyanin kendi
// notu bunu soyluyor: "set_stats BU GOREVDEN ONCE calistigi icin artifact zaten
// yayinlanmistir: portal duzgun sonucu alir, AWX dogru sekilde 'failed' der."
//
// PORTAL ISE ARTIFACT'I HIC OKUMUYORDU: `status !== 'successful'` gorunce sabit bir metin
// donduruyordu. Iki taraf birbiriyle celisiyordu ve sebep IKI YERDE DE kayboluyordu:
//   - AWX log'unda, cunku login gorevi `no_log: true` (sifre sizmasin - dogru karar)
//   - ekranda, cunku portal artifact'i atiyordu
//
// Bu bekciler ikisini birden kilitler: portal basarisiz iste de artifact okur, playbook
// da sebebi log'a basar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const PB_DIR = path.join(
  __dirname,
  '..',
  '..',
  'ansible',
  'playbooks',
  'bmw_portal',
  'opsx_openshift_dump',
);
const PODS_YML = fs.readFileSync(path.join(PB_DIR, 'opsx_openshift_pods.yaml'), 'utf8');
const DUMP_YML = fs.readFileSync(path.join(PB_DIR, 'opsx_openshift_dump.yaml'), 'utf8');

// Her durum ucunun govdesi: `getJobStatusOnServer` cagrisindan `catch`e kadar.
function uclar() {
  const bloklar = [];
  let i = 0;
  for (;;) {
    const j = SRC.indexOf('runner.getJobStatusOnServer(serverId, jobId)', i);
    if (j < 0) break;
    const k = SRC.indexOf('} catch (err) {', j);
    bloklar.push(SRC.slice(j, k > 0 ? k : j + 3000));
    i = j + 1;
  }
  return bloklar;
}

// 2026-11-24: bes sonuc ucu (legacy JVM, server-config, OCP pod, pod silme, dump) tek yardimcidan kurulur
// (sonucUcu); kural yardimcida, her ucun ona bagli oldugu ayrica sayilir.
const SONUC_UCLARI = [
  '/api/opsx/legacy/jvm/:serverId/:jobId/status',
  '/api/opsx/legacy/serverconfig/:serverId/:jobId/status',
  '/api/opsx/ocp/pods/:serverId/:jobId/status',
  '/api/opsx/poddelete/:serverId/:jobId/status',
  '/api/opsx/dump/:serverId/:jobId/status',
];
function sonucUcuGovdesi() {
  const i = SRC.indexOf('function sonucUcu(');
  assert.ok(i > 0, 'sonucUcu yardimcisi yok');
  const son = SRC.indexOf('\n  }\n', i);
  return SRC.slice(i, son > i ? son : undefined);
}

test('BS1 durum uclari BASARISIZ iste artifact okumadan CIKMIYOR', () => {
  for (const yol of SONUC_UCLARI)
    assert.ok(SRC.includes(`sonucUcu('${yol}', {`), `${yol} ortak sonuc yardimcisindan kurulmuyor`);
  assert.equal((SRC.match(/sonucUcu\('\/api\/opsx\//g) || []).length, SONUC_UCLARI.length);
  assert.match(
    sonucUcuGovdesi(),
    /if \(!TERMINAL\.has\(statusInfo\.status\)\)[\s\S]*const raw = cikar\(statusInfo\.artifacts\);/,
    'sonuc yardimcisi terminal iste artifact okumuyor',
  );
  const bloklar = uclar();
  assert.ok(bloklar.length >= 2, `beklenen durum ucu sayisi bulunamadi: ${bloklar.length}`);
  for (const b of bloklar) {
    // Terminal olmayan durum icin erken cikis MESRU (is hala kosuyor).
    // Yasak olan: TERMINAL ama basarisiz durumda artifact'i HIC okumadan donmek.
    const erken = /status !== 'successful'\)\s*\{\s*\n\s*return res\.json\(/.test(b);
    assert.ok(
      !erken,
      "bir durum ucu `status !== 'successful'` gorunce artifact'i okumadan donuyor - " +
        'playbook sonucu set_stats ile YAYINLADIKTAN SONRA bilerek fail ediyor, sebep atilir',
    );
  }
});

test('BS2 artifact YOKSA mesaj basarili/basarisiz ayrimi YAPIYOR', () => {
  // "Is tamamlandi ancak sonuc alinamadi" ile "is basarisiz oldu" AYRI tesihslerdir:
  // ilki playbook'un set_stats adimini, ikincisi isin kendisini isaret eder. Ikisini
  // tek metne indirmek, bakan kisiyi yanlis yere gonderir.
  for (const [ad, metin] of [
    ['pod', 'Pod listesi alınamadı (iş başarısız oldu).'],
    ['jvm', 'JVM listesi alınamadı (iş başarısız oldu).'],
    ['server-config', 'Server-Config listesi alınamadı (iş başarısız oldu).'],
    ['dump', 'İşlem başarısız oldu.'],
  ]) {
    assert.ok(SRC.includes(metin), `${ad}: basarisiz is mesaji kaybolmus`);
  }
  // Ve bu metinler ARTIFACT YOKSA kolunda olmali - kosul `=== 'successful'` uzerinden (ortak yardimcida) ve her
  // sonuc ucu iki metni de verir.
  assert.match(
    sonucUcuGovdesi(),
    /if \(!raw\) \{[\s\S]*statusInfo\.status === 'successful' \? bosBasarili : bosBasarisiz/,
    'artifact-yok kolunda basarili/basarisiz ayrimi yok',
  );
  for (const yol of SONUC_UCLARI) {
    const i = SRC.indexOf(`sonucUcu('${yol}', {`);
    const cagri = SRC.slice(i, SRC.indexOf('\n  });\n', i));
    assert.match(cagri, /bosBasarili:/, `${yol}: basarili-artifactsiz metni yok`);
    assert.match(cagri, /bosBasarisiz:/, `${yol}: basarisiz-artifactsiz metni yok`);
  }
  for (const metin of [
    'Pod listesi alınamadı (iş başarısız oldu).',
    'JVM listesi alınamadı (iş başarısız oldu).',
    'Server-Config listesi alınamadı (iş başarısız oldu).',
  ])
    assert.ok(SRC.includes(`bosBasarisiz: '${metin}'`), `${metin} basarisiz kolunda degil`);
});

test('BS3 pod sonucu BASARISIZ iste de ayristiriciya giriyor (sebep ekrana ulasir)', () => {
  // Kullanicinin bildirdigi YOL bu; BS1 tum uclari tarasa da bu yol ayrica kilitlenir.
  const j = SRC.indexOf('cikar: extractOpsxPodsResult,');
  assert.ok(j > 0, 'pod artifact okumasi bulunamadi');
  // Pod ucu ortak yardimcidan gecer: yardimcinin artifact okumasindan ONCEKI kodu da bu kurala tabidir.
  const g = sonucUcuGovdesi();
  const oncesi = g.slice(0, g.indexOf('const raw = cikar(statusInfo.artifacts);'));
  // YORUM SATIRLARI ATILIR: bu dosyanin ve index.cjs'in kendi aciklamalari da
  // "status !== 'successful'" dizgesini tasiyor; ham metinde aramak KENDI notunu
  // bulup hep kirmizi yanardi (ilk surumde oldu).
  const kod = oncesi
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ');
  assert.ok(
    !/status !== 'successful'\)\s*\{\s*return res\.json\(/.test(kod),
    'pod artifact okumasindan ONCE basarili-degilse-cik kapisi var - sebep atilir',
  );
  const blok = SRC.slice(j, j + 1800);
  assert.match(blok, /parsePodDiscoveryResult\(raw\)/, 'artifact ayristirilmiyor');
  assert.match(
    blok,
    /parsed\.pods\.length === 0 && parsed\.error/,
    'pod bulunamadiginda hata metni donmuyor',
  );
});

test('BS4 playbook basarisizlik SEBEBINI AWX log’una basiyor', () => {
  for (const [ad, yml, degisken] of [
    ['pods', PODS_YML, 'merged_results'],
    ['dump', DUMP_YML, 'flat_results'],
  ]) {
    assert.match(
      yml,
      /SEBEBINI AWX log'una yaz/,
      `${ad}: sebep log'a basilmiyor - login gorevi no_log oldugu icin AWX'te hicbir iz kalmaz`,
    );
    assert.ok(
      yml.includes(`{{ ${degisken} | rejectattr('ok') | map(attribute='error') | list }}`),
      `${ad}: log'a basilan sey basarisiz kayitlarin hata metni degil`,
    );
  }
});

test('BS5 fail mesaji SEBEPLERI tasiyor (sabit metin degil)', () => {
  for (const [ad, yml, degisken] of [
    ['pods', PODS_YML, 'merged_results'],
    ['dump', DUMP_YML, 'flat_results'],
  ]) {
    const i = yml.indexOf('Hicbir sonuc uretilemediyse isi BASARISIZ yap');
    assert.ok(i > 0, `${ad}: fail gorevi bulunamadi`);
    const blok = yml.slice(i, i + 900);
    assert.match(blok, /Sebepler:/, `${ad}: fail mesaji sebep tasimiyor`);
    assert.ok(
      blok.includes(`${degisken} | rejectattr('ok')`),
      `${ad}: fail mesaji basarisiz kayitlardan beslenmiyor`,
    );
  }
});
