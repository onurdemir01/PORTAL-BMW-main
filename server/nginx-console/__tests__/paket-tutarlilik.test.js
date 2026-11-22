// server/nginx-console/__tests__/paket-tutarlilik.test.js - Tutarlilik > Paketler (2026-11-16).
//
// Kullanici: "Glomo sunucularinin her zaman ve her sartta esit oldugunu bilmek istiyorum." Ayni gun
// elle karsilastirmada 230 uygulamadan 24'u farkliydi (atlanmis deployment, ayni surumde farkli
// dosyalar, elle unzip ile silinen config). Bu testler o gercek durumlari ve "okunamadi != esit"
// kuralini korur:
//   PT1 hepsi taze olculdu ve ayni -> esit
//   PT2 surum / dosyalar / config farki ayri ayri adlandirilir; cogunluk ilk varyant
//   PT3 bir sunucuda dizin yok ya da conf gosteriyor ama dizin yok -> eksik (once listelenir)
//   PT4 olculemeyen sunucu (eski betik, dokum yok, bayat, cok buyuk) esit dedirtmez; fark varsa
//       hukum yine farkli
//   PT5 hicbir sunucuda tanimli olmayan dizin karsilastirilmaz, tanimsiz sayilir
//   PT6 @@SPAPKG ayristirma: CRLF, bicim disi satir, bolum yokken null
//   PT7 ozet yan dosyasi eski semadaysa (pkgs yok) yeniden uretilir
//   PT8 uctan uca: raw/<HOST>.txt + _seen.json -> /drift/paket yaniti (gercek grup listesi)
//   PT9 okunamayan uygulama (www giremedi, dosya okunamadi) esit sayilmaz; okunabilenler farkliysa farkli
//   PT10 karsilastirilacak uygulama yoksa (dizin yok / bos bolum) hukum esit degil
//   PT11 kaynagindan eski .gz/.br (bayat sikistirma) esit dedirtmez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computePaketTutarlilik, sunucuDurumu } = require('../paket-tutarlilik.cjs');
const { parseDump } = require('../dump-parse.cjs');

const NOW = Date.parse('2026-11-16T15:00:00Z');
const TAZE = '2026-11-16T14:30:00Z';
const GRUP = [{ id: 'glomo', label: 'Glomo', hosts: ['ORNGXP40', 'ORNGXP41', 'ORNGXAP34'] }];

const pkg = (ns, app, o = {}) => ({
  ns,
  app,
  durum: 'var',
  version: '1.0.0-1-prod',
  icerik: 'aaaaaaaaaaaa',
  config: 'cccccccccccc',
  dosya: 10,
  versionZamani: '2026-11-04 04:03',
  tanimli: true,
  ...o,
});
const veri = (pkgs, seenAt = TAZE, ek = {}) => ({
  ozet: { pkgs, dumpedAt: seenAt, ...ek },
  seenAt,
});

function hesapla(v) {
  return computePaketTutarlilik(GRUP, new Map(Object.entries(v)), { nowMs: NOW }).groups[0];
}

test('PT1 tum sunucular taze olculdu, her uygulama ayni -> esit', () => {
  const p = [pkg('glomo-ns', 'app-a'), pkg('glomo-ns', 'app-b', { version: null })];
  const g = hesapla({ ORNGXP40: veri(p), ORNGXP41: veri(p), ORNGXAP34: veri(p) });
  assert.equal(g.hukum, 'esit');
  assert.deepEqual(g.sayac, {
    uygulama: 2,
    ayni: 2,
    farkli: 0,
    eksik: 0,
    olculemedi: 0,
    tanimsiz: 0,
    olculen: 3,
    sunucu: 3,
  });
  assert.equal(g.apps.length, 0);
  assert.deepEqual(
    g.ayni.map((a) => a.key),
    ['glomo-ns/app-a', 'glomo-ns/app-b'],
  );
  assert.ok(g.sunucular.every((s) => s.durum === 'olculdu' && s.paketSayisi === 2));
  assert.ok(!('pkgs' in g.sunucular[0]), 'yanit ham paket listesini tasimamali');
});

test('PT2 surum, dosyalar ve config farki ayri adlandirilir; cogunluk ilk varyant', () => {
  const ana = [pkg('ns', 'surum'), pkg('ns', 'dosya'), pkg('ns', 'config')];
  const sapan = [
    pkg('ns', 'surum', { version: '0.9.0-7-prod', icerik: 'bbbbbbbbbbbb' }),
    pkg('ns', 'dosya', { icerik: 'dddddddddddd', dosya: 30 }),
    pkg('ns', 'config', { config: '771b609c89a4' }),
  ];
  const g = hesapla({ ORNGXP40: veri(ana), ORNGXP41: veri(ana), ORNGXAP34: veri(sapan) });
  assert.equal(g.hukum, 'farkli');
  assert.equal(g.sayac.farkli, 3);
  const by = Object.fromEntries(g.apps.map((a) => [a.app, a]));
  assert.deepEqual(by.surum.fark, ['version', 'icerik']);
  assert.equal(by.surum.yalnizVersion, false);
  assert.deepEqual(by.dosya.fark, ['icerik'], 'ayni surumde farkli dosyalar ayrica gorunmeli');
  assert.deepEqual(by.config.fark, ['config']);
  assert.deepEqual(by.dosya.cogunluk.hosts, ['ORNGXP40', 'ORNGXP41']);
  assert.equal(by.dosya.varyantlar[1].hosts[0], 'ORNGXAP34');
  const hucre = by.config.sunucular.find((s) => s.host === 'ORNGXAP34');
  assert.equal(hucre.config, '771b609c89a4');
  // yalniz .version farki (dosyalar ayni) da esit DEGILDIR ama ayrica isaretlenir
  const v = hesapla({
    ORNGXP40: veri([pkg('ns', 'x')]),
    ORNGXP41: veri([pkg('ns', 'x')]),
    ORNGXAP34: veri([pkg('ns', 'x', { version: null })]),
  });
  assert.equal(v.hukum, 'farkli');
  assert.equal(v.apps[0].yalnizVersion, true);
});

test('PT3 dizin bir sunucuda yok ya da conf gosteriyor ama dizin yok -> eksik, once listelenir', () => {
  const tam = [pkg('ns', 'a-farkli'), pkg('ns', 'z-eksik')];
  const g = hesapla({
    ORNGXP40: veri(tam),
    ORNGXP41: veri([pkg('ns', 'a-farkli', { icerik: 'eeeeeeeeeeee' }), pkg('ns', 'z-eksik')]),
    ORNGXAP34: veri([
      pkg('ns', 'a-farkli'),
      {
        ...pkg('ns', 'z-eksik'),
        durum: 'yok',
        version: null,
        icerik: null,
        config: null,
        dosya: 0,
      },
    ]),
  });
  assert.equal(g.hukum, 'farkli');
  assert.deepEqual(
    g.apps.map((a) => [a.app, a.durum]),
    [
      ['z-eksik', 'eksik'],
      ['a-farkli', 'farkli'],
    ],
  );
  assert.deepEqual(g.apps[0].yok, ['ORNGXAP34']);
  assert.equal(g.apps[0].sunucular.find((s) => s.host === 'ORNGXAP34').yok, true);
  // listede hic olmayan (dizini silinmis, conf'u da yok) uygulama da eksik
  const h = hesapla({
    ORNGXP40: veri([pkg('ns', 'b')]),
    ORNGXP41: veri([pkg('ns', 'b')]),
    ORNGXAP34: veri([]),
  });
  assert.equal(h.apps[0].durum, 'eksik');
  assert.deepEqual(h.apps[0].yok, ['ORNGXAP34']);
});

test('PT4 olculemeyen sunucu esit dedirtmez; fark varsa hukum farkli kalir', () => {
  const p = [pkg('ns', 'a')];
  const eski = hesapla({
    ORNGXP40: veri(p),
    ORNGXP41: veri(p),
    ORNGXAP34: { ozet: { pkgs: null, dumpedAt: TAZE }, seenAt: TAZE },
  });
  assert.equal(eski.hukum, 'olculemedi');
  assert.equal(eski.sunucular.find((s) => s.host === 'ORNGXAP34').durum, 'eski-betik');
  assert.equal(eski.sayac.olculen, 2);

  const yok = hesapla({ ORNGXP40: veri(p), ORNGXP41: veri(p) });
  assert.equal(yok.hukum, 'olculemedi');
  assert.equal(yok.sunucular.find((s) => s.host === 'ORNGXAP34').durum, 'dokum-yok');

  const bayat = hesapla({
    ORNGXP40: veri(p),
    ORNGXP41: veri(p),
    ORNGXAP34: veri(p, '2026-11-16T10:00:00Z'),
  });
  assert.equal(bayat.hukum, 'olculemedi', '5 saatlik olcum esit sayilmamali');
  const b = bayat.sunucular.find((s) => s.host === 'ORNGXAP34');
  assert.equal(b.durum, 'bayat');
  assert.match(b.neden, /5 saat/);

  const fark = hesapla({
    ORNGXP40: veri(p),
    ORNGXP41: veri([pkg('ns', 'a', { config: 'ffffffffffff' })]),
  });
  assert.equal(fark.hukum, 'farkli', 'olculemeyen sunucu varken bile kesin fark gizlenmez');

  assert.equal(sunucuDurumu({ pkgs: null, tooLarge: true }, TAZE, NOW, 3).durum, 'olculemedi');
  assert.equal(sunucuDurumu({ pkgs: [] }, null, NOW, 3).durum, 'bayat');
  assert.equal(sunucuDurumu({ pkgs: [] }, TAZE, NOW, 3).durum, 'olculdu');
});

test('PT5 hicbir sunucuda tanimli olmayan dizin karsilastirilmaz, tanimsiz sayilir', () => {
  const g = hesapla({
    ORNGXP40: veri([pkg('ns', 'a'), pkg('ns', 'artik', { tanimli: false })]),
    ORNGXP41: veri([pkg('ns', 'a')]),
    ORNGXAP34: veri([pkg('ns', 'a'), pkg('ns', 'artik', { tanimli: false, icerik: 'x' })]),
  });
  assert.equal(g.hukum, 'esit');
  assert.deepEqual(g.tanimsiz, [{ key: 'ns/artik', hosts: ['ORNGXAP34', 'ORNGXP40'] }]);
  // bir sunucuda tanimliysa karsilastirmaya girer
  const t = hesapla({
    ORNGXP40: veri([pkg('ns', 'b', { tanimli: true })]),
    ORNGXP41: veri([pkg('ns', 'b', { tanimli: false })]),
    ORNGXAP34: veri([]),
  });
  assert.equal(t.apps[0].key, 'ns/b');
  assert.equal(t.apps[0].durum, 'eksik');
});

test('PT6 @@SPAPKG ayristirma: CRLF, bicim disi satir atlanir, bolum yoksa null', () => {
  const d = parseDump(
    [
      '@@HOST ORNGXP40',
      '@@SPAPKG',
      'ges-pension-fund-ch-prod\tfund-coach-app-v0\tvar\t0.0.11-1-prod\tc7e374461abb\tb7d870101bd9\t953\t2026-11-16 16:44\t1',
      'ns\tgone\tyok\t-\t-\t-\t0\t-\t1',
      'ns\tkisa\tvar',
      'ns/kotu\tapp\tvar\tv\ti\tc\t1\t-\t1',
      'ns\tapp\tbilinmeyen\tv\ti\tc\t1\t-\t1',
      '@@END',
      '@@TREE',
      '@@END',
    ].join('\r\n'),
  );
  assert.equal(d.pkgs.length, 2);
  assert.deepEqual(d.pkgs[0], {
    ns: 'ges-pension-fund-ch-prod',
    app: 'fund-coach-app-v0',
    durum: 'var',
    version: '0.0.11-1-prod',
    icerik: 'c7e374461abb',
    config: 'b7d870101bd9',
    dosya: 953,
    versionZamani: '2026-11-16 16:44',
    tanimli: true,
    bayatSikistirma: null,
  });
  assert.equal(d.pkgs[1].durum, 'yok');
  assert.equal(d.pkgs[1].version, null);
  assert.equal(parseDump('@@HOST X\n@@TREE\n@@END\n').pkgs, null);
  assert.deepEqual(parseDump('@@HOST X\n@@SPAPKG\n@@END\n').pkgs, []);
});

function geciciDizin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-paket-'));
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  process.env.NGINX_CONSOLE_DIR = dir;
  const history = require('../history.cjs');
  history.ingestDump = async () => null;
  return dir;
}
const dokum = (host, satirlar) =>
  [
    `@@HOST ${host}`,
    '@@TIME 2026-11-16T14:30:00Z',
    '@@PREFIX /usr/nginx',
    '@@NGINX_T ok',
    'ok',
    '@@END',
    '@@TREE',
    '@@END',
    '@@SPAPKG',
    ...satirlar,
    '@@END',
    '',
  ].join('\n');
const satir = (app, icerik = 'aaaaaaaaaaaa') =>
  `glomo-ns\t${app}\tvar\t1.0.0-1-prod\t${icerik}\tcccccccccccc\t10\t2026-11-04 04:03\t1`;

test('PT7 eski semadaki ozet yan dosyasi (pkgs yok) kullanilmaz, dokumden yeniden uretilir', () => {
  const dir = geciciDizin();
  const idx = require('../index.cjs');
  const p = path.join(dir, 'raw', 'ORPKGT01.txt');
  fs.writeFileSync(p, dokum('ORPKGT01', [satir('app-a')]));
  const st = fs.statSync(p);
  fs.writeFileSync(
    path.join(dir, 'raw', 'ORPKGT01.summary.json'),
    JSON.stringify({
      mtimeMs: st.mtimeMs,
      ingested: true,
      host: 'ORPKGT01',
      tree: [],
      certs: [],
      certUses: [],
      fileCount: 0,
      loaded: null,
      sslFiles: [],
    }),
  );
  const sm = idx._loadSummaryForTest('ORPKGT01');
  assert.ok(Array.isArray(sm.pkgs), 'eski yan dosya pkgs olmadan donmemeli');
  assert.equal(sm.pkgs[0].app, 'app-a');
  assert.equal(sm.ozetSurumu, 2);
  const yan = JSON.parse(fs.readFileSync(path.join(dir, 'raw', 'ORPKGT01.summary.json'), 'utf8'));
  assert.equal(yan.ozetSurumu, 2, 'yan dosya yeni semayla yeniden yazilmali');
});

test('PT8 uctan uca: raw dokumleri + _seen.json -> /drift/paket yaniti (MIGRATION_GROUPS)', () => {
  const dir = geciciDizin();
  const idx = require('../index.cjs');
  const { migrationGroups } = require('../../audit/nginx-migration.cjs');
  const glomo = migrationGroups().find((g) => g.id === 'glomo').newHosts;
  // Glomo: biri ayni surumde farkli dosyalarla (fund-coach olayi), biri dokumsuz
  glomo.slice(0, -1).forEach((h, i) => {
    fs.writeFileSync(
      path.join(dir, 'raw', `${h}.txt`),
      dokum(h, [
        satir('app-a'),
        satir('fund-coach-app-v0', i === 0 ? 'bbbbbbbbbbbb' : 'aaaaaaaaaaaa'),
      ]),
    );
  });
  const seen = Object.fromEntries(
    glomo.map((h) => [h, new Date(Date.now() - 10 * 60000).toISOString()]),
  );
  fs.writeFileSync(
    path.join(dir, 'raw', '_seen.json'),
    JSON.stringify({ at: new Date().toISOString(), hosts: seen }),
  );
  const r = idx._paketTutarlilikForTest();
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.groups.map((g) => g.id),
    migrationGroups().map((g) => g.id),
  );
  const g = r.groups.find((x) => x.id === 'glomo');
  assert.deepEqual(g.hosts, [...glomo].sort());
  assert.equal(g.hukum, 'farkli');
  assert.deepEqual(
    g.apps.map((a) => [a.app, a.fark]),
    [['fund-coach-app-v0', ['icerik']]],
  );
  const son = glomo[glomo.length - 1];
  assert.equal(g.sunucular.find((s) => s.host === son).durum, 'dokum-yok');
  assert.equal(g.sayac.olculen, glomo.length - 1);
  // diger grubun hicbir dokumu yok: esit DEGIL, olculemedi
  const diger = r.groups.find((x) => x.id !== 'glomo');
  assert.equal(diger.hukum, 'olculemedi');
  assert.equal(diger.sayac.olculen, 0);
});

test('PT9 okunamayan uygulama esit sayilmaz; okunabilenler farkliysa hukum farkli', () => {
  const ok = [pkg('ns', 'a')];
  const okunamaz = [
    { ...pkg('ns', 'a'), durum: 'okunamadi', icerik: null, config: null, dosya: null },
  ];
  const g = hesapla({ ORNGXP40: veri(ok), ORNGXP41: veri(ok), ORNGXAP34: veri(okunamaz) });
  assert.equal(g.hukum, 'olculemedi', 'okunamayan paket ESIT gosterilmemeli');
  assert.equal(g.sayac.olculemedi, 1);
  assert.equal(g.apps[0].durum, 'olculemedi');
  assert.deepEqual(g.apps[0].okunamayan, ['ORNGXAP34']);
  assert.equal(g.apps[0].sunucular.find((s) => s.host === 'ORNGXAP34').okunamadi, true);
  const f = hesapla({
    ORNGXP40: veri(ok),
    ORNGXP41: veri([pkg('ns', 'a', { icerik: 'ffffffffffff' })]),
    ORNGXAP34: veri(okunamaz),
  });
  assert.equal(f.hukum, 'farkli');
  assert.equal(f.apps[0].durum, 'farkli');
  // dokumde "var" ama ozet bos gelen satir (cd basarisiz) ayristirmada okunamadi olur
  const d = parseDump(
    [
      '@@HOST X',
      '@@SPAPKG',
      ['ns', 'a', 'var', '-', '', '', '', '-', '1'].join('\t'),
      ['ns', 'b', 'okunamadi', 'v1', '-', '-', '-', '-', '1', '-'].join('\t'),
      '@@END',
    ].join('\n'),
  );
  assert.deepEqual(
    d.pkgs.map((x) => [x.app, x.durum, x.icerik]),
    [
      ['a', 'okunamadi', null],
      ['b', 'okunamadi', null],
    ],
  );
});

test('PT10 karsilastirilacak uygulama yoksa hukum esit degil', () => {
  const g = hesapla({ ORNGXP40: veri([]), ORNGXP41: veri([]), ORNGXAP34: veri([]) });
  assert.equal(g.sayac.olculen, 3);
  assert.equal(g.sayac.uygulama, 0);
  assert.equal(g.hukum, 'olculemedi');
  // yalniz tanimsiz dizinler de esitlik kaniti degildir
  const t = hesapla({
    ORNGXP40: veri([pkg('ns', 'x', { tanimli: false })]),
    ORNGXP41: veri([]),
    ORNGXAP34: veri([]),
  });
  assert.equal(t.hukum, 'olculemedi');
});

test('PT11 kaynagindan eski .gz/.br esit dedirtmez (tum sunucularda ayni olsa da)', () => {
  const p = [pkg('ns', 'a')];
  const g = hesapla({
    ORNGXP40: veri(p),
    ORNGXP41: veri(p),
    ORNGXAP34: veri([pkg('ns', 'a', { bayatSikistirma: 2 })]),
  });
  assert.equal(g.hukum, 'farkli');
  assert.deepEqual(g.apps[0].fark, ['sikistirma']);
  assert.deepEqual(g.apps[0].bayatSikistirma, ['ORNGXAP34']);
  assert.equal(g.apps[0].sunucular.find((s) => s.host === 'ORNGXAP34').bayatSikistirma, 2);
  const hepsi = [pkg('ns', 'a', { bayatSikistirma: 1 })];
  assert.equal(
    hesapla({ ORNGXP40: veri(hepsi), ORNGXP41: veri(hepsi), ORNGXAP34: veri(hepsi) }).hukum,
    'farkli',
  );
});
