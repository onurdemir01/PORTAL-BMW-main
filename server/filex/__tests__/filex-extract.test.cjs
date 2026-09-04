// server/filex/__tests__/filex-extract.test.cjs — extractFilexResult(): AWX artifacts'ten
// filex_result okuma. LogX/Telnet/OpsX ile AYNI sekil toleransi (top-level / data /
// ansible_stats.data) + JSON metin cozumu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

// extractFilexResult saf bir fonksiyon — ama filex-parse.cjs'i require eder.
// Dogrudan require etmek express/DB yuklerdi; dosyadan cikarip test ediyoruz.
function loadExtractor() {
  const a = SRC.indexOf('function extractFilexResult(');
  const b = SRC.indexOf('function initFileX(');
  assert.ok(a > 0 && b > a, 'extractFilexResult bulunamadi');
  const { parseFilexResult } = require('../filex-parse.cjs');
  // require('./filex-parse.cjs') cagrisini onceden yuklenen modulle degistir.
  let body = SRC.slice(a, b);
  body = body.replace(
    "const { parseFilexResult } = require('./filex-parse.cjs');",
    '/* parseFilexResult enjekte edildi */',
  );
  // eslint-disable-next-line no-new-func
  return new Function('parseFilexResult', `${body}; return extractFilexResult;`)(parseFilexResult);
}
const extract = loadExtractor();

const SAMPLE = {
  overall_status: 'ok',
  hosts: [
    {
      host: 'GBJBOQ01',
      status: 'ok',
      ear_dirs: ['/app.ear'],
      meta_raw: '644|was|was|100|1700000000|/app.ear/a.jar',
      sha_raw: '',
    },
  ],
};

// ── Sekil toleransi ───────────────────────────────────────────────────────────
test('extractFilexResult: artifacts.filex_result (top-level) dogrudan okunur', () => {
  const out = extract({ filex_result: SAMPLE });
  assert.ok(out);
  assert.equal(out.hosts[0].files.length, 1);
  assert.equal(out.hosts[0].files[0].path, '/app.ear/a.jar');
});

test('extractFilexResult: artifacts.data.filex_result (yaygin AWX set_stats sekli) okunur', () => {
  const out = extract({ data: { filex_result: SAMPLE } });
  assert.ok(out);
  assert.equal(out.overall_status, 'ok');
  assert.equal(out.hosts[0].files.length, 1);
});

test('extractFilexResult: artifacts.ansible_stats.data.filex_result (bazi controller surumleri) okunur', () => {
  const out = extract({ ansible_stats: { data: { filex_result: SAMPLE } } });
  assert.ok(out);
  assert.equal(out.hosts.length, 1);
});

// ── Hata sinirlari ────────────────────────────────────────────────────────────
test('extractFilexResult: hicbir bilinen sekilde yoksa null doner', () => {
  assert.equal(extract({}), null);
  assert.equal(extract(null), null);
  assert.equal(extract(undefined), null);
  assert.equal(extract({ some_other_key: 1 }), null);
});

test('extractFilexResult: filex_result nesne degilse (string/number) yok sayilir', () => {
  assert.equal(extract({ filex_result: 'not-an-object' }), null);
  assert.equal(extract({ filex_result: 42 }), null);
});

test('extractFilexResult: data.filex_result nesne degilse yok sayilir', () => {
  assert.equal(extract({ data: { filex_result: 'string-value' } }), null);
});

// ── parseFilexResult entegrasyonu ─────────────────────────────────────────────
test('extractFilexResult: status=error host dosya listesi UREMEZ', () => {
  const out = extract({
    filex_result: {
      overall_status: 'partial',
      hosts: [
        {
          host: 'A',
          status: 'ok',
          ear_dirs: ['/app.ear'],
          meta_raw: '644|was|was|100|1700000000|/app.ear/x.jar',
          sha_raw: '',
        },
        {
          host: 'B',
          status: 'error',
          error: 'unreachable',
          ear_dirs: [],
          meta_raw: 'bozuk',
          sha_raw: '',
        },
      ],
    },
  });
  assert.equal(out.hosts[0].files.length, 1);
  assert.deepEqual(out.hosts[1].files, [], 'hatali host dosya uretmez');
  assert.equal(out.hosts[1].error, 'unreachable');
});

test('extractFilexResult: hosts dizisi olmayan sonuc oldugu gibi doner', () => {
  const out = extract({ filex_result: { overall_status: 'failed' } });
  assert.deepEqual(out, { overall_status: 'failed' });
});

// ── Kaynak kod sozlesmesi ─────────────────────────────────────────────────────
test('extractFilexResult: job-status ucunda cagrilmali (artifacts eline alinip atilmaz)', () => {
  assert.match(
    SRC,
    /extractFilexResult\(statusInfo\.artifacts\)/,
    'artifacts yine eline alinip atiliyor — ekranda sonuc olmaz',
  );
});

test('extractFilexResult: uc AWX sekli de denenir (top-level, data, ansible_stats.data)', () => {
  assert.match(SRC, /artifacts\.filex_result/);
  assert.match(SRC, /artifacts\.data\?\.filex_result/);
  assert.match(SRC, /artifacts\.ansible_stats\?\.data\?\.filex_result/);
});
