// server/ansible/__tests__/ocp-staging-parity.test.cjs — OCP arşiv teslimi legacy ile AYNI.
//
// GERCEK ARIZA (2026-08-09, uretim): job 3208785 basariyla 6 arsiv uretti ama HICBIRI
// indirilemedi (404). Zincir: portal `staging_user` gondermiyordu → playbook `was`
// varsayiyordu → `dzdo: unknown user: was` → `/sw/BMW_PORTAL/logs/ocp` hic hazirlanmadi →
// rescue devreye girip arsivleri bastion'in `/tmp/logx-v2-fallback` dizinine yazdi →
// portal orayi goremedigi icin 404.
//
// KARAR (kullanici): legacy'de yillardir calisan yapiyi birebir uygula. `logx_legacy_transfer.yml`
// dzdo KULLANMAZ, staging kullanicisi/mod'u KULLANMAZ: `stat` ile /sw mount'unu kontrol
// eder ve arsivi DOGRUDAN oraya yazar; olmazsa fallback. Bu testler o esligi kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'playbooks');
const OCP_FETCH = 'logx_ocp_discover_fetch.yml';

// Yorum satirlari haric kod: dosya basindaki mimari notlar 'dzdo'yu ADIYLA aniyor.
function code(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

test(`${OCP_FETCH}: dzdo / staging kullanicisi / mod ayari GECMEZ (legacy modeli)`, () => {
  const src = code(OCP_FETCH);
  for (const banned of ['dzdo', 'staging_runas_user', 'staging_directory_mode', 'staged_archive_mode']) {
    assert.ok(
      !new RegExp(banned).test(src),
      `${banned} geri gelmis — uretimde 'dzdo: unknown user: was' ile indirmeyi kirmisti`
    );
  }
});

test(`${OCP_FETCH}: arsiv DOGRUDAN staging yoluna yazilir, ara kopyalama yok`, () => {
  const src = code(OCP_FETCH);
  assert.match(src, /dest: "\{\{ item\.staging_archive_path \}\}"/, 'staging arsivi dogrudan hedefe yazilmali');
  assert.match(src, /dest: "\{\{ item\.fallback_archive_path \}\}"/, 'fallback yolu korunmali');
});

test(`${OCP_FETCH}: staging dizinini OLUSTURMAYA calisan gorev yok (legacy paritesi)`, () => {
  // Legacy `stat` ile bakar, olusturmaz. Onceki surumdeki `file: state=directory` +
  // `mode` her calistirmada `PermissionError: Operation not permitted:
  // /sw/BMW_PORTAL/logs/ocp` uretiyordu (dizin var, sahibi baska kullanici) ve hicbir
  // ise yaramiyordu. `fallback_dir` olusturma HARIC — o legacy'de de var.
  const src = code(OCP_FETCH);
  const blocks = src.split(/\n\s*- name:/);
  const offenders = blocks.filter((b) => /state:\s*directory/.test(b) && /staging_dir/.test(b));
  assert.deepEqual(offenders, [], 'staging_dir mkdir/chmod denemesi geri gelmis');
  // Fallback dizini olusturma DURMALI (kaldirirken yanlislikla silinmesin).
  assert.match(src, /path: "\{\{ fallback_dir \}\}"/);
});

test('HICBIR playbook `ingest_url` kullanmiyor — portal da artik gondermemeli', () => {
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'))) {
    assert.ok(!/ingest_url/.test(fs.readFileSync(path.join(DIR, file), 'utf8')), `${file}: ingest_url`);
  }
  const ocp = fs.readFileSync(path.join(__dirname, '..', '..', 'logx', 'v2', 'ocp.cjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/ingest_url|issueIngestToken/.test(ocp), 'ocp.cjs bosuna token + DB satiri uretmemeli');
  // Teslim yolu staging: bu iki degisken gitmeye devam etmeli.
  assert.match(ocp, /staging_dir:/);
  assert.match(ocp, /fallback_dir:/);
});

// ── `when:` ile korunan set_fact'ler ────────────────────────────────────────────────
//
// GERCEK ARIZA (2026-08-10, uretim job 3209025/3209041): dort arsivin DORDU DE
// /sw/BMW_PORTAL/logs/ocp altinda basariyla olustu, `staged_unit_files` doluydu — ama
// hemen ardindan "Record this bastion's archive summary" gorevi
// `'staging_error' is undefined` ile dustu. Cunku `staging_error` YALNIZCA
// `when: fallback_units | length > 0` korumali gorevde set ediliyordu; her sey yolunda
// gidince (fallback gerekmeyince) hic tanimlanmiyordu. Rescue devreye girdi, aggregator
// `overall_status: failed` yayinladi ve kullanici "Transfer basarisiz oldu" gordu —
// ARSIVLER STAGING'DE DURURKEN.
//
// KURAL: `when:` ile korunan bir set_fact'in urettigi her degisken ya play basinda
// KOSULSUZ ilklenir ya da HER kullaniminda `default(...)` / `is (not) defined` /
// `select('defined')` ile korunur. Bu test o kurali kilitler.
function parseTasks(text) {
  const lines = text.split('\n');
  const tasks = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = /^(\s*)- name:\s*(.*)$/.exec(line);
    if (m) {
      if (cur) tasks.push(cur);
      cur = { indent: m[1].length, name: m[2].trim().replace(/^["']|["']$/g, ''), from: i, to: i, keys: [], hasWhen: false };
    } else if (cur) {
      cur.to = i;
    }
  });
  if (cur) tasks.push(cur);

  for (const t of tasks) {
    const taskKeyIndent = t.indent + 2;
    let sfIndent = null;
    for (let i = t.from; i <= t.to; i++) {
      const m = /^(\s*)([\w.]+):/.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length;
      const key = m[2];
      if (indent === taskKeyIndent) {
        sfIndent = (key === 'set_fact' || key === 'ansible.builtin.set_fact') ? indent + 2 : null;
        if (key === 'when') t.hasWhen = true;
        continue;
      }
      if (sfIndent !== null && indent === sfIndent) t.keys.push(key);
    }
  }
  return { lines, tasks };
}

test(`${OCP_FETCH}: when: ile korunan her set_fact play basinda ILKLENIR`, () => {
  const text = fs.readFileSync(path.join(DIR, OCP_FETCH), 'utf8');
  const { tasks } = parseTasks(text);

  const initTask = tasks.find((t) => t.name.startsWith('Initialize working facts'));
  assert.ok(initTask, 'play "Initialize working facts" gorevini kaybetmis olmamali');
  const initialized = new Set(initTask.keys);

  const violations = [];
  for (const t of tasks) {
    if (!t.hasWhen) continue;
    for (const key of t.keys) {
      if (initialized.has(key)) continue;
      // ISTISNA: playbook degiskenin TANIMSIZLIGINI bilerek olcuyorsa (ornegin rescue
      // yolundaki `when: logx_bastion_summary is not defined`) ilklemek o mantigi bozar.
      // Bu durumda tanimsizlik bir HATA degil, SINYALDIR.
      if (new RegExp(`\\b${key}\\s+is\\s+(not\\s+)?defined`).test(text)) continue;
      violations.push(`'${key}' — "${t.name}" gorevinde kosullu set ediliyor ama ilklenmiyor`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Kosul saglanmadiginda bu degiskenler tanimsiz kalir; onlari okuyan gorev ' +
    "'undefined' ile duser ve BASARILI bir calistirma 'failed' raporlanir:\n" + violations.join('\n')
  );
});
