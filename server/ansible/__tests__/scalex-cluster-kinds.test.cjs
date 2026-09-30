// server/ansible/__tests__/scalex-cluster-kinds.test.cjs
//
// CLUSTER BASINA YETENEK ONBELLEGI — PLAYBOOK TARAFI (PR-A).
//
// NEDEN DAVRANISSAL: buradaki kural bir METIN degil bir DEGERLENDIRME sonucu.
// "`| default(` gecmiyor" gibi bir metin bekcisi, ifadenin NE URETTIGINI
// soyleyemez; ve bu depoda en pahali hata sinifi "sessiz eksik" oldugu icin
// yanlis bir degerlendirme hicbir yerde hata vermez — yalnizca CRD'ler kaybolur.
//
// Bu yuzden gorev dosyalari GERCEKTEN kosturulur ve `10_discover.yml`deki
// ifade DOSYADAN OKUNUP degerlendirilir. Testin icine kopyalanmis bir ifade,
// dosya degistiginde sessizce eskir ve bekci kendi kopyasini korurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { SCALEX_PKG: PKG } = require('../paths.cjs');
const APP = path.join(PKG, 'scalex_app');
const DISC = path.join(APP, 'tasks', 'discovery');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

// CI'DA ATLAMA SESSIZ OLMASIN (VT0 ile ayni gerekce): `Jenkinsfile` ansible
// kurmuyorsa bu ailenin tamami sessizce atlanir ve suit yine yesil doner.
test('CK0 CI`da ansible KURULU (CK ailesi sessizce atlanmasin)', () => {
  if (process.env.CI !== 'true') return;
  assert.ok(HAS_ANSIBLE, 'CI=true ama `ansible-playbook` yok — CK ailesi kosmuyor.');
});

// `10_discover.yml`deki ifadeyi DOSYADAN alir. Kopyalamak, bekcinin korudugu
// koddan bagimsizlasmasi demekti.
function envIfadesi(ad) {
  const src = fs.readFileSync(path.join(DISC, '10_discover.yml'), 'utf8');
  const m = new RegExp(`^\\s*${ad}:\\s*"(.+)"\\s*$`, 'm').exec(src);
  assert.ok(m, `10_discover.yml icinde ${ad} bulunamadi`);
  return m[1];
}

/**
 * `discovery/01_prepare.yml`i verilen extra_vars ile kosturur, sonra
 * `10_discover.yml`den okunan ifadeyi her cluster icin degerlendirir.
 */
function cozumle(vars, clusters) {
  return cozumleIfade(envIfadesi('SCALEX_EXTRA_KINDS'), vars, clusters);
}

/** Verilen ifadeyi `01_prepare.yml` kostuktan SONRA her cluster icin degerlendirir. */
function cozumleIfade(ifade, vars, clusters) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-ck-'));
  try {
    const play = path.join(tmp, 'p.yml');
    const temel = {
      scalex_clusters_override: {
        version: 1,
        clusters: Object.fromEntries(
          clusters.map((c) => [
            c,
            {
              api_url: 'https://a',
              credential: 'k',
              enabled: true,
              environments: ['test'],
              jump_server: 'j',
              platform: 'ark',
            },
          ]),
        ),
        defaults: {},
      },
      target_platform: 'ark',
      target_environment: 'test',
      target_namespace: 'ns1',
      discovery_mode: 'workloads',
      username: 'uxmid',
      ...vars,
    };
    fs.writeFileSync(
      play,
      [
        '---',
        '- hosts: localhost',
        '  gather_facts: false',
        `  vars: ${JSON.stringify(temel)}`,
        '  tasks:',
        '    - block:',
        `        - ansible.builtin.include_tasks: ${path.join(DISC, '01_prepare.yml')}`,
        '        - ansible.builtin.debug:',
        `            msg: "COZUM:{{ scalex_target.cluster }}=[${ifade}]"`,
        `          loop: ${JSON.stringify(clusters.map((c) => ({ cluster: c })))}`,
        '          loop_control:',
        '            loop_var: scalex_target',
        '      rescue:',
        '        - ansible.builtin.debug:',
        '            msg: "PREPARE_FAILED"',
      ].join('\n'),
    );
    const r = spawnSync('ansible-playbook', [play], {
      encoding: 'utf8',
      env: { ...process.env, ANSIBLE_LOCALHOST_WARNING: 'False', ANSIBLE_DEPRECATION_WARNINGS: 'False' },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.ok(!/PREPARE_FAILED/.test(out), `01_prepare dustu:\n${out.slice(-2000)}`);
    const sonuc = {};
    for (const m of out.matchAll(/COZUM:([^=\]]+)=\[(.*?)\]/g)) sonuc[m[1]] = m[2];
    assert.equal(
      Object.keys(sonuc).length,
      clusters.length,
      `beklenen ${clusters.length} cozum, gelen ${Object.keys(sonuc).length}:\n${out.slice(-2000)}`,
    );
    return sonuc;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── CK1: SOZLUK GELDIGINDE HER CLUSTER KENDI LISTESINI ALIR ─────────────────
test('CK1 sozlukteki cluster KENDI listesini alir', { skip: !HAS_ANSIBLE }, () => {
  const c = cozumle(
    { scalex_cluster_kinds: { c1: 'a.io,b.io', c2: 'z.io' }, scalex_extra_kinds: 'a.io,b.io,z.io' },
    ['c1', 'c2'],
  );
  assert.equal(c.c1, 'a.io,b.io');
  assert.equal(c.c2, 'z.io');
});

// ── CK2: ASIL KURAL — SOZLUKTE OLMAYAN CLUSTER BIRLESIME DUSMEZ ─────────────
//
// Kismi onbellegin tehlikesi kismi olmasindan degil, TEK bir degerin HER
// cluster'a gitmesinden geliyordu. Sozlukte olmayan cluster BOS almali ki
// yalnizca kendisi soguk yolu kossun ve kendi CRD'leri kaybolmasin.
test('CK2 sozlukte OLMAYAN cluster BOS alir (birlesime DUSMEZ)', { skip: !HAS_ANSIBLE }, () => {
  const c = cozumle(
    { scalex_cluster_kinds: { c1: 'a.io' }, scalex_extra_kinds: 'a.io,b.io' },
    ['c1', 'c3'],
  );
  assert.equal(c.c1, 'a.io');
  assert.equal(c.c3, '', 'kaydi olmayan cluster BASKASININ listesiyle sinirlandi');
});

// ── CK3: GERIYE UYUM — ESKI PORTAL (sozluk YOK) ─────────────────────────────
test('CK3 sozluk GELMEZSE birlesik liste aynen gecer', { skip: !HAS_ANSIBLE }, () => {
  const c = cozumle({ scalex_extra_kinds: 'a.io,b.io' }, ['c1', 'c2']);
  assert.equal(c.c1, 'a.io,b.io');
  assert.equal(c.c2, 'a.io,b.io');
});

// Hicbiri gelmezse bos: betik eski yolu kosar (fail-safe).
test('CK4 hic onbellek yoksa BOS gecer (fail-safe)', { skip: !HAS_ANSIBLE }, () => {
  const c = cozumle({}, ['c1']);
  assert.equal(c.c1, '');
});

// ── CK5: `default(x, true)` BOOLEAN BICIMI YASAK ────────────────────────────
//
// Boolean bicim degeri FALSY oldugunda da geriye duser. Sozlukte bir cluster
// icin BILEREK bos deger bulunuyorsa ("bu cluster icin onbellek yok"), boolean
// default onu "tanimsiz" sayip tam da ezmek istedigimiz birlesik listeye geri
// dusururdu. Bu, metin bekcisiyle DEGIL degerlendirmeyle kanitlanir.
test('CK5 sozlukteki BOS deger birlesige geri DUSMEZ', { skip: !HAS_ANSIBLE }, () => {
  const c = cozumle(
    { scalex_cluster_kinds: { c1: '', c2: 'z.io' }, scalex_extra_kinds: 'a.io,b.io' },
    ['c1', 'c2'],
  );
  assert.equal(c.c1, '', '`default(x, true)` kullanilmis — bos deger birlesige dustu');
  assert.equal(c.c2, 'z.io');
});

// ── CK6: BOZUK SOZLUK TUM KAPSAMI SOGUK YOLA DUSURMESIN ─────────────────────
//
// Sozluk "Prompt on launch > Variables" ile geliyor; oraya bir operator elle
// metin de yazabilir. `| length` metinde de calisir, yani `is mapping` olmadan
// "sozluk geldi" sanilir, geri dusus `''` olur ve HICBIR cluster onbellek almaz.
// Bozuk bir girdinin bedeli, tum kapsamin sessizce soguk yola dusmesi olurdu.
test('CK6 sozluk yerine METIN gelirse birlesik listeye DUSULUR', { skip: !HAS_ANSIBLE }, () => {
  for (const bozuk of ['a.io', ['a.io'], 5]) {
    const c = cozumle({ scalex_cluster_kinds: bozuk, scalex_extra_kinds: 'u.io' }, ['c1']);
    assert.equal(
      c.c1,
      'u.io',
      `bozuk sozluk (${JSON.stringify(bozuk)}) tum kapsami soguk yola dusurdu`,
    );
  }
});

// ── CK7: `default(x, true)` BOOLEAN BICIMI KULLANILMIYOR ────────────────────
//
// DURUST NOT — BU BIR METIN BEKCISI ve oldugunu biliyoruz. Iki bicim BUGUNKU
// veriyle AYNI sonucu veriyor: `kindsPerCluster` sozluge hic bos deger koymuyor,
// yani "anahtar var ama degeri falsy" hali uretimde olusmuyor. Dolayisiyla
// davranissal bir bekci yazilamaz; yazilsaydi ikisini de yesil gorurdu.
//
// Yine de kilitleniyor, cunku bu bicim bir sonraki turun tuzagi: "tarandi ama
// CRD YOK" halini ifade etmek icin sozluge BILEREK bos bir deger konacak
// (bkz. cluster-caps.cjs `kindsPerCluster` notu). Boolean default o kasitli bos
// degeri "tanimsiz" sayip birlesik listeye geri dusururdu — `10_run_phase.yml`
// `WORKLOAD_KINDS` notundaki hatanin AYNISI.
test('CK7 `default(x, true)` boolean bicimi kullanilmiyor', () => {
  const ifade = envIfadesi('SCALEX_EXTRA_KINDS');
  assert.match(ifade, /\|\s*default\(/, 'geri dusus hic yok — eski portal kirilir');
  assert.doesNotMatch(
    ifade,
    /\|\s*default\([^)]*,\s*(true|True|1)\s*\)/,
    'boolean `default` bicimi: kasitli bos deger birlesik listeye geri duser',
  );
});

// ── CK8: "TARANDI AMA BOS" ISARETI GERCEKTEN DOGRU DEGERLENIYOR ─────────────
//
// MUTASYON TURUNDA BULUNDU: isaret degiskenini `10_discover.yml`den silmek
// yalnizca bir METIN bekcisini kizartiyordu. Metin bekcisi satirin VAR oldugunu
// kanitlar, DOGRU DEGERLENDIGINI degil — bu depodaki "calismayan kapi" sinifi.
//
// Ayrim ANAHTARIN VARLIGI ile tasiniyor: portal yalnizca GUVENILIR bir kaydi
// olan cluster'i sozluge koyar, dolayisiyla sozlukte olmak "bu cluster tarandi"
// demektir — listesi BOS olsa bile.
test('CK8 isaret YALNIZCA sozlukteki cluster icin `yes`', { skip: !HAS_ANSIBLE }, () => {
  const ifade = envIfadesi('SCALEX_EXTRA_KINDS_SCANNED');
  const c = cozumleIfade(
    ifade,
    { scalex_cluster_kinds: { c1: 'a.io', c2: '' }, scalex_extra_kinds: 'u.io' },
    ['c1', 'c2', 'c3'],
  );
  assert.equal(c.c1, 'yes', 'dolu kaydi olan cluster taranmamis sayildi');
  // ASIL NOKTA: BOS deger de "tarandi"dir. Aksi halde ekstra CRD'si olmayan
  // cluster her kesifte ~50 `oc get --raw` odemeye devam ederdi.
  assert.equal(c.c2, 'yes', '"tarandi ama BOS" taranmamis sayildi — enumerasyon geri geldi');
  assert.equal(c.c3, 'no', 'kaydi OLMAYAN cluster taranmis sayildi — enumerasyon sessizce atlanir');
});
