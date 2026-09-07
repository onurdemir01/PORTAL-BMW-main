// server/ansible/__tests__/logx-ocp-failure-isolation.test.cjs — HATA GIZLENMESIN.
//
// URETIM ARIZASI (AWX #3297277): `logx_ocp_app_discovery.yml` "Validate requested
// cluster records" gorevinde dustu ve ekranda gorulen TEK sey buydu:
//
//   fatal: [GBAOCP01]: FAILED! => {"censored": "... 'no_log: true' was specified ..."}
//   ...portal: "Otomasyon tarafinda beklenmeyen bir hata olustu."
//
// Iki mesaj da HICBIR SEY SOYLEMIYOR. Sebep tek bir eksik degiskendi (`resolved_password`
// o gorevin `vars:` blogunda tanimli degildi) ama teshis UC ayri korlugun ust uste
// binmesiyle imkansiz hale geldi:
//
//   1. Gorev `no_log: true` tasidigi icin Ansible sebebi "censored" diye GIZLEDI.
//   2. Tek bastion FAIL olunca Ansible "NO MORE HOSTS LEFT" ile KALAN PLAY'LERI ATLADI —
//      PLAY RECAP'te `localhost ok=3` kaldi, yani TOPLAYICI PLAY HIC KOSMADI.
//   3. `set_stats` yayinlanmadigi icin portal `logx_result` bulamadi ve genel
//      "beklenmeyen bir hata" metnini bastı.
//
// Playbook'taki "Clear any host errors so aggregation always runs" gorevinin yorumu
// bunu ONLEDIGINI soyluyordu — ONLEMIYORDU: o gorev play 3'un ICINDE ve play 3 hic
// baslamiyor. "Var denilen ama hic atesLENMEYEN kapi" sinifinin bir ornegi.
//
// Duzeltme uc playbook'ta da hazirlik gorevlerini kendi block/rescue'suna aldi.
// Bu bekci hem o yapiyi (FI1-FI3) hem de ARIZANIN KENDISINI (FI4) kilitler:
// FI4, #3297277'yi AWX'e kopyalamadan `npm test` asamasinda yakalar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { PLAYBOOKS, abs } = require('../paths.cjs');

const FILES = {
  namespace_discovery: PLAYBOOKS.logxOcpNamespaceDiscovery,
  app_discovery: PLAYBOOKS.logxOcpAppDiscovery,
  discover_fetch: PLAYBOOKS.logxOcpDiscoverFetch,
};

// Yalnizca CALISAN metin olculur. Bu bekcinin kendi aciklamalari playbook
// yorumlarinda da geciyor; yorumu kod sanmak bilinen bir korluk desenidir.
const codeOnly = (src) =>
  src
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === '';

/**
 * Bir liste ogesinin (`- name: ...`) TUM govdesi.
 *
 * NEDEN BOYLE: sabit pencere (`slice(i, i + N)`) bu repoda defalarca komsu koda
 * tasip bekciyi kor birakti. Burada olcut GIRINTI: oge, kendisiyle ayni ya da daha
 * az girintili ilk dolu satirda biter.
 */
function itemBody(lines, start) {
  const ind = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && (isBlank(lines[end]) || indentOf(lines[end]) > ind)) end++;
  return { lines: lines.slice(start, end), end };
}

/** `hosts: logx_terminal` play'inin `tasks:` govdesi (satir indeksleriyle). */
function bastionPlayTasks(lines) {
  let playStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- name: /.test(lines[i])) {
      const { lines: body } = itemBody(lines, i);
      if (body.some((l) => /^ {2}hosts:\s*logx_terminal\s*$/.test(l))) {
        playStart = i;
        break;
      }
    }
  }
  assert.ok(playStart >= 0, 'bastion play (hosts: logx_terminal) bulunamadi');
  const play = itemBody(lines, playStart);
  const t = play.lines.findIndex((l) => /^ {2}tasks:\s*$/.test(l));
  assert.ok(t >= 0, 'bastion play icinde tasks: yok');
  return play.lines.slice(t + 1);
}

/** Bir govdedeki ust duzey `- name:` ogeleri. */
function topLevelItems(bodyLines) {
  const ind = bodyLines.find((l) => !isBlank(l) && !/^\s*#/.test(l));
  const level = indentOf(ind);
  const out = [];
  for (let i = 0; i < bodyLines.length; i++) {
    if (indentOf(bodyLines[i]) === level && /^\s*- name: /.test(bodyLines[i])) {
      const it = itemBody(bodyLines, i);
      out.push(it.lines);
      i = it.end - 1;
    }
  }
  return out;
}

/**
 * Dosyadaki HER gorev (hangi girintide olursa olsun).
 *
 * PLAY BASLIKLARI HARIC (girinti 0): onlar gorev degil, kendi altlarindaki TUM
 * gorevleri kapsar. Kapsanan gorevlerin `vars:` adlari play basligina "kullaniliyor"
 * gibi gorunur ve FI4 sahte kirmizi verir — bekcinin kendi korlugu.
 */
function allTasks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*- name: /.test(lines[i]) && indentOf(lines[i]) >= 4) {
      const it = itemBody(lines, i);
      out.push({
        name: (lines[i].match(/- name:\s*"?(.*?)"?\s*$/) || [])[1] || '?',
        lines: it.lines,
      });
    }
  }
  return out;
}

/**
 * Bu oge bir BLOK SAHIBI mi (`block:`/`rescue:` tasiyor)?
 *
 * Blok sahibinin govdesi TUM alt gorevleri kapsar; alt gorevin `vars:` adlari
 * sahibin metninde de gorunur. Sahibi tek tek gorev gibi olcmek, bekcinin kendi
 * korlugudur — alt gorevler zaten ayri ayri olculur.
 */
function isBlockOwner(taskLines) {
  const ind = indentOf(taskLines[0]) + 2;
  return taskLines.some((l) => l === ' '.repeat(ind) + 'block:');
}

/** Bir gorevin kendi `vars:` blogunda tanimladigi anahtarlar. */
function varsKeysOf(taskLines) {
  const ind = indentOf(taskLines[0]) + 2;
  const v = taskLines.findIndex((l) => l === ' '.repeat(ind) + 'vars:');
  if (v < 0) return [];
  const keys = [];
  for (let i = v + 1; i < taskLines.length; i++) {
    const l = taskLines[i];
    if (isBlank(l)) continue;
    if (indentOf(l) <= ind) break;
    if (indentOf(l) === ind + 2) {
      const m = l.trim().match(/^([a-z_][a-z0-9_]*):/);
      if (m) keys.push(m[1]);
    }
  }
  return keys;
}

// ──────────────────────────────────────────────────────────────────────────────

test("FI1 bastion play'inde KORUMASIZ gorev yok (hepsi block altinda)", () => {
  for (const [mod, rel] of Object.entries(FILES)) {
    const lines = codeOnly(fs.readFileSync(abs(rel), 'utf8')).split('\n');
    const items = topLevelItems(bastionPlayTasks(lines));

    // Toplayici bozulup hicbir oge gormezse bekci SESSIZCE yesil kalmasin.
    assert.ok(
      items.length >= 2,
      `${mod}: bastion play'inde yalnizca ${items.length} ust duzey oge goruldu`,
    );

    for (const it of items) {
      const name = (it[0].match(/- name:\s*"?(.*?)"?\s*$/) || [])[1];
      const ind = indentOf(it[0]) + 2;
      assert.ok(
        it.some((l) => l === ' '.repeat(ind) + 'block:'),
        `${mod}: "${name}" gorevi block DISINDA duruyor.\n` +
          'Burada dusen bir gorev host\'u FAIL yapar; Ansible "NO MORE HOSTS LEFT" ile\n' +
          "toplayici play'i ATLAR, set_stats yayinlanmaz ve portal hicbir sey soyleyemez\n" +
          '(uretim: AWX #3297277).',
      );
    }
  }
});

test('FI2 her rescue HATA SEBEBINI sonuca yaziyor (yalnizca anmiyor)', () => {
  const RESULT_FACT = {
    namespace_discovery: 'cluster_ns_results',
    app_discovery: 'cluster_app_results',
    discover_fetch: 'cluster_fetch_results',
  };
  for (const [mod, rel] of Object.entries(FILES)) {
    const lines = codeOnly(fs.readFileSync(abs(rel), 'utf8')).split('\n');
    const items = topLevelItems(bastionPlayTasks(lines));
    let rescues = 0;
    for (const it of items) {
      const ind = indentOf(it[0]) + 2;
      const name = (it[0].match(/- name:\s*"?(.*?)"?\s*$/) || [])[1];
      const r = it.findIndex((l) => l === ' '.repeat(ind) + 'rescue:');
      assert.ok(r >= 0, `${mod}: "${name}" blogunun rescue'su YOK — hata yine host'u dusurur`);
      rescues++;

      // OLCUT "sonuc fact'inin ADI geciyor mu" DEGIL.
      //
      // Bekcinin ilk hali tam olarak bunu olcuyordu ve MUTASYON TURUNDA YESIL KALDI:
      // rescue'nun sonuc yazan gorevlerini silip yerine bir `debug` koydum, ama
      // "guvenli varsayilanlar" gorevi fact'i yine ANDIGI icin bekci gecti. Kapi
      // vardi, kiran seye BAKMIYORDU.
      //
      // Gercek kural: HATA SEBEBI sonuca ULASMALI. Yani sonuc fact'ine yazan
      // gorevlerden EN AZ BIRI bir hata degiskeni (`prepare_error`/`bastion_error`)
      // tasimali.
      const rescueBody = it.slice(r + 1);
      const writers = topLevelItems(rescueBody).filter((t) =>
        t.some((l) => new RegExp(`^\\s*${RESULT_FACT[mod]}:`).test(l)),
      );
      assert.ok(
        writers.some((t) => /\b(prepare_error|bastion_error)\b/.test(t.join('\n'))),
        `${mod}: "${name}" rescue'sunda hata sebebini ${RESULT_FACT[mod]}'a TASIYAN gorev yok.\n` +
          `(fact'e yazan gorev sayisi: ${writers.length}) — hata yutulur ve toplayici\n` +
          '"sebep bos" bir sonuc yayinlar; kullanici yine hicbir sey ogrenemez.',
      );
    }
    assert.ok(rescues >= 2, `${mod}: yalnizca ${rescues} rescue bulundu (>=2 bekleniyor)`);
  }
});

test('FI3 tanilama gorevi GORUNUR ve parolayi DEGER olarak basmiyor', () => {
  for (const [mod, rel] of Object.entries(FILES)) {
    const lines = codeOnly(fs.readFileSync(abs(rel), 'utf8')).split('\n');
    const tasks = allTasks(lines);

    // (a) `no_log` TASIMAYAN bir tanilama gorevi VAR: "censored" son soz olmamali.
    const diag = tasks.find((t) => /Explain the preparation failure/.test(t.name));
    assert.ok(diag, `${mod}: sizdirmayan tanilama gorevi yok — sebep "censored" olarak kalir`);
    assert.ok(
      !diag.lines.some((l) => /^\s*no_log:\s*true\s*$/.test(l)),
      `${mod}: tanilama gorevine no_log eklenmis — gizlenen sebebi acmak icin var, kendisi gizlenemez`,
    );

    // (b) Parola hicbir GORUNUR gorevde DEGER olarak gecmiyor. Yalnizca bir
    //     YUKLEM icinde (…| length) gecebilir; boolean sizinti degildir.
    for (const t of tasks) {
      if (isBlockOwner(t.lines)) continue;
      const hasNoLog = t.lines.some((l) => /^\s*no_log:\s*true\s*$/.test(l));
      if (hasNoLog) continue;
      // Ifade satir sarabilir; once bosluklari tekille, sonra `}}`e kadar oku.
      // `[^\n]*` ile okumak `| length` yuklemini SONRAKI satirda birakip bekciyi
      // sahte kirmiziya dusuruyordu.
      const body = t.lines.join('\n');
      for (const m of body.replace(/\s+/g, ' ').matchAll(/lookup\('vars',[^}]*/g)) {
        assert.match(
          m[0],
          /length/,
          `${mod}: "${t.name}" gorevi (no_log YOK) kimlik degerini yuklemsiz kullaniyor:\n${m[0]}`,
        );
      }
      assert.ok(
        !/\{\{\s*resolved_password\s*\}\}/.test(body.replace(/\s+/g, ' ')),
        `${mod}: "${t.name}" gorevi parolayi DEGER olarak basiyor`,
      );
    }
  }
});

test('FI4 gorevlerde kullanilan her YEREL degisken AYNI gorevde tanimli (#3297277)', () => {
  for (const [mod, rel] of Object.entries(FILES)) {
    const src = codeOnly(fs.readFileSync(abs(rel), 'utf8'));
    const lines = src.split('\n');
    const tasks = allTasks(lines);

    // Dosyadaki TUM gorev-yerel degisken adlari. Bunlar `vars:` ile tanimlanir ve
    // BIR SONRAKI GOREVE TASINMAZ — uretimdeki hata tam olarak buydu.
    const localNames = new Set();
    for (const t of tasks) for (const k of varsKeysOf(t.lines)) localNames.add(k);

    // Toplayici bozulursa bekci bos kumeyle sessizce yesil kalmasin.
    assert.ok(
      localNames.size >= 5,
      `${mod}: yalnizca ${localNames.size} yerel degisken adi toplandi`,
    );
    assert.ok(
      localNames.has('resolved_password'),
      `${mod}: resolved_password toplanamadi — toplayici bozuk`,
    );

    // Play duzeyindeki `vars:` her goreve gorunur.
    const playVars = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '  vars:') {
        for (
          let j = i + 1;
          j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) > 2);
          j++
        ) {
          const m = indentOf(lines[j]) === 4 ? lines[j].trim().match(/^([a-z_][a-z0-9_]*):/) : null;
          if (m) playVars.add(m[1]);
        }
      }
    }

    for (const t of tasks) {
      if (isBlockOwner(t.lines)) continue;
      const own = new Set(varsKeysOf(t.lines));
      const body = t.lines.join('\n');
      for (const name of localNames) {
        if (own.has(name) || playVars.has(name)) continue;
        assert.ok(
          !new RegExp(`\\b${name}\\b`).test(body),
          `${mod}: "${t.name}" gorevi \`${name}\` degiskenini kullaniyor ama onu KENDI \`vars:\`\n` +
            "blogunda TANIMLAMIYOR. Ansible'da gorev-yerel `vars:` bir sonraki goreve TASINMAZ;\n" +
            'bu gorev `no_log` tasiyorsa sebep "censored" olarak gizlenir ve teshis edilemez\n' +
            '(uretim: AWX #3297277 — bastion komple dustu, portal hicbir sey soyleyemedi).',
        );
      }
    }
  }
});
