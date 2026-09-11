// server/ansible/__tests__/playbook-tree.test.cjs — AWX agaci AYNASI.
//
// NEDEN VAR: `server/ansible/bmw_portal/` klasoru AWX projesindeki `bmw_portal/`
// ile BIREBIR AYNI olmali — klasor oldugu gibi kopyalanabilsin diye. Ama asil
// sebep kozmetik degil:
//
//   Playbook'lar kimlik dosyasini `playbook_dir`e GORELI arar. Iki repoda
//   derinlik ayni olmazsa burada gecen bir sey AWX'te patlar. Uretimde tam
//   olarak bu oldu (AWX #3296360): playbook AWX'te `logx/ocp/` altina (uc
//   seviye) tasinmisti, ama `vars_files` yolu iki seviye varsayiyordu. Kimlik
//   dosyasi bulunamadi, parola BOS kaldi, `oc login` sessizce patladi ve ekran
//   "Missing or incomplete configuration info" diye YANILTICI bir hata gosterdi.
//   Portal reposunda hicbir test kirmizi donmemisti — cunku burada agac DUZDU
//   ve derinlik diye bir sey YOKTU.
//
// Bu bekci, o korlugu kapatan mekanizmadir: agacin sekli ve her playbook'un
// goreli yollarinin KENDI derinligiyle tutarli oldugu burada olculur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AWX_TREE,
  LOCAL_PLAYBOOKS,
  PLAYBOOKS,
  SCALEX_APP,
  abs,
  allPlaybookFiles,
} = require('../paths.cjs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

test('AT1 AWX agacindaki her playbook GERCEKTEN duruyor', () => {
  for (const [key, rel] of Object.entries(PLAYBOOKS)) {
    const p = abs(rel);
    assert.ok(fs.existsSync(p), `${key}: ${rel} yok — paths.cjs agacla uyusmuyor`);
  }
});

test('AT2 AWX agacinda kayit DISI playbook yok (kopyalanan sey tam olarak bilinen sey)', () => {
  const known = new Set(Object.values(PLAYBOOKS));
  const found = [];
  const walk = (dir, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      // ScaleX bir PAKET (klasor olarak kopyalanir), tek tek playbook degil.
      else if (/\.(yml|yaml)$/.test(e.name) && !rel.startsWith('scalex/')) found.push(rel);
    }
  };
  walk(AWX_TREE);
  const unknown = found.filter((f) => !known.has(f));
  assert.deepEqual(
    unknown,
    [],
    "paths.cjs'e kaydedilmemis playbook(lar) AWX agacinda:\n" +
      unknown.join('\n') +
      "\nAWX'teki yerini ogrenip PLAYBOOKS'a ekleyin — kayitsiz dosya, kopyalandiginda\n" +
      'yanlis derinlige dusebilir ve kimlik dosyasini bulamaz.',
  );
});

test('AT3 goreli `../` yollari, dosyanin KENDI derinligiyle tutarli', () => {
  // Bir playbook `bmw_portal/logx/ocp/x.yml` ise `../../../` reponun koku demektir
  // (bmw_openshift_jobs oraya kardestir). `../../` ise `bmw_portal/`de kalir ve
  // kimlik dosyasini BULAMAZ. Her dosyanin adaylari kendi derinligini KAPSAMALI.
  const problems = [];
  for (const [key, rel] of Object.entries(PLAYBOOKS)) {
    const src = fs.readFileSync(abs(rel), 'utf8');
    if (!/bmw_openshift_jobs/.test(src)) continue;
    // `bmw_portal/` icindeki klasor derinligi: logx/ocp/x.yml -> 2
    const depth = rel.split('/').length - 1;
    // Repo koküne cikmak icin gereken `../` sayisi: derinlik + 1 (bmw_portal'in kendisi)
    const needed = '../'.repeat(depth + 1);
    // IKI YAZIM DA GECERLI:
    //   playbook_dir ~ '/../../bmw_openshift_jobs/...'   (tercih edilen — tasinmaya dayanikli)
    //   - ../../bmw_openshift_jobs/...                   (duz goreli; OpsX playbook'lari boyle)
    // Bu bekcinin olctugu sey YAZIM DEGIL DERINLIK: dosyanin kendi konumundan
    // repo kokune ulasan bir aday var mi.
    const hasNeeded =
      src.includes(`/${needed}bmw_openshift_jobs`) || src.includes(`${needed}bmw_openshift_jobs`);
    if (!hasNeeded) {
      problems.push(
        `${key} (${rel}, derinlik ${depth}): '${needed}bmw_openshift_jobs' adayi YOK — ` +
          'kimlik dosyasi bu konumdan bulunamaz',
      );
    }
  }
  assert.deepEqual(problems, [], 'goreli yol derinligi tutmuyor:\n' + problems.join('\n'));
});

test("AT4 AWX'e kopyalanan agac ile YEREL playbook'lar KARISMIYOR", () => {
  // `playbooks/` altindakiler AWX projesinde YOK: portal/AI tanilamasi icin
  // duruyorlar. Biri yanlislikla oraya kopyalanirsa AWX'te calismayan bir
  // playbook belirir; tersi durumda AWX'e gitmesi gereken dosya gitmez.
  const localNames = fs
    .readdirSync(LOCAL_PLAYBOOKS)
    .filter((f) => /\.(yml|yaml)$/.test(f))
    .sort();
  const awxNames = Object.values(PLAYBOOKS)
    .map((r) => r.split('/').pop())
    .sort();
  const overlap = localNames.filter((n) => awxNames.includes(n));
  assert.deepEqual(overlap, [], `ayni ad iki agacta birden: ${overlap.join(', ')}`);
  assert.ok(localNames.length > 0, 'yerel playbook dizini bosalmis — tasima fazla mi geldi?');
});

test('AT5 toplayici IKI agaci da goruyor (sessizce kucuk kumeye dusmez)', () => {
  const all = allPlaybookFiles();
  const inAwx = all.filter((f) => f.startsWith(AWX_TREE));
  const inLocal = all.filter((f) => f.startsWith(LOCAL_PLAYBOOKS));
  assert.ok(inAwx.length >= 10, `AWX agacinda yalnizca ${inAwx.length} playbook goruluyor`);
  assert.ok(inLocal.length >= 10, `yerel agacta yalnizca ${inLocal.length} playbook goruluyor`);
});

test('AT6 ScaleX kurulum komutu CANONICAL kaynak ve hedef derinligini kullaniyor', () => {
  const guide = path.join(AWX_TREE, 'scalex', 'SCALEX_AWX_SETUP.md');
  const src = fs.readFileSync(guide, 'utf8');
  const match = src.match(/^cp -r (\S+)\s+(\S+)$/m);
  const canonicalSource = path.relative(REPO_ROOT, SCALEX_APP).split(path.sep).join('/');

  assert.ok(match, 'ScaleX kurulum rehberinde kopyalama komutu bulunamadi');
  assert.equal(
    match[1],
    canonicalSource,
    `ScaleX kurulum rehberi canonical kaynak yerine '${match[1]}' kullaniyor`,
  );
  assert.equal(
    match[2],
    '<AWX_PROJECT_DIR>/bmw_portal/scalex/',
    `ScaleX hedef derinligi vars_files yoluyla uyumsuz: ${match[2]}`,
  );
  for (const rel of ['main.yml', 'discovery.yml', 'files/scalex_runner.sh']) {
    assert.ok(
      fs.existsSync(path.join(SCALEX_APP, rel)),
      `ScaleX paketinde zorunlu dosya yok: ${rel}`,
    );
  }
});
