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
