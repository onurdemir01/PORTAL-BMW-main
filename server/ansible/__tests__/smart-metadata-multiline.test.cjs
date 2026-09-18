// server/ansible/__tests__/smart-metadata-multiline.test.cjs
//
// Smart metadata (2026-09-18, kullanici: ACIKLAMA satir satir gorunsun): parseSimpleYaml
// YAML blok skaleri (`ALAN: |`) destekler; buildSmartMetadata sonradan islemesi `\n`
// kacisini satir sonuna cevirir, kosullu bos satirlari tek satira indirir. Tek satirli
// anahtar: deger davranisi (AWX extra_vars) DEGISMEZ.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
const parseSimpleYaml = new Function(
  SRC.slice(SRC.indexOf('function parseSimpleYaml'), SRC.indexOf('// ── Config')) + '; return parseSimpleYaml;',
)();

test('parseSimpleYaml: tek satir davranisi ayni; blok skaleri (| ve |-) girintiyi atip satirlari birlestirir', () => {
  const out = parseSimpleYaml('A: 1\nB: |\n  satir1\n    ic girinti\n\n  satir3\nC: "q"\n# yorum\nD: |-\n    x\n    y\nE: son\n');
  assert.deepEqual(out, { A: '1', B: 'satir1\n  ic girinti\n\nsatir3', C: 'q', D: 'x\ny', E: 'son' });
  // blok sonundaki bos satirlar atilir; blogun ardindan gelen anahtar okunur
  assert.deepEqual(parseSimpleYaml('K: |\n  a\n\n\nL: b'), { K: 'a', L: 'b' });
  // bos blok
  assert.deepEqual(parseSimpleYaml('K: |\nL: b'), { K: '', L: 'b' });
});

test('buildSmartMetadata sonradan islemesi: \\n kacisi, kosullu bos satirlar, uc bosluk', () => {
  const i = SRC.indexOf('metadata[key] = String(smartMetaEnv.renderString(rawValue, ctx))');
  assert.ok(i > 0, 'sonradan isleme yok');
  const chain = SRC.slice(i, i + 300);
  for (const s of [".replace(/\\\\n/g, '\\n')", ".replace(/[ \\t]+\\n/g, '\\n')", ".replace(/\\n{2,}/g, '\\n')", '.trim()']) {
    assert.ok(chain.includes(s), `zincirde yok: ${s}`);
  }
  // Ayni zinciri gercek nunjucks ciktisina uygula: kosullu satir bos kalinca satir kaybolur
  const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true });
  const post = (v) => String(v).replace(/\\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  const tpl = parseSimpleYaml('ACIKLAMA: |\n  {{ username }} acti\n  Islem: {{ extraVars.action }}\n  {% if extraVars.ns is defined %}NS: {{ extraVars.ns }}{% endif %}\n  Son\nK: satir1\\nsatir2').ACIKLAMA;
  assert.equal(post(env.renderString(tpl, { username: 'u', extraVars: { action: 'delete' } })), 'u acti\nIslem: DELETE'.replace('DELETE', 'delete') + '\nSon');
  assert.equal(post(env.renderString(tpl, { username: 'u', extraVars: { action: 'delete', ns: 'x' } })), 'u acti\nIslem: delete\nNS: x\nSon');
  assert.equal(post('satir1\\nsatir2'), 'satir1\nsatir2');
});
