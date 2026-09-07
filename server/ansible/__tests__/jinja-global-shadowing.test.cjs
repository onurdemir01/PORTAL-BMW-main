// server/ansible/__tests__/jinja-global-shadowing.test.cjs — JINJA GLOBAL'I DEGISKEN SANMAK.
//
// OLCULDU (2026-09-07, yerel sonda — hicbir degisken gonderilmeden):
//
//   namespace is defined            -> True
//   (namespace | default('')) tipi  -> Namespace      (bir Python SINIFI)
//
// `namespace` Jinja'nin KENDI global'idir (jinja2.utils.Namespace). Bir playbook onu
// kendi degiskeni sanarsa iki sey olur ve ikisi de sessizdir:
//
//   1. `x is defined` HER ZAMAN dogru -> "gonderilmedi mi" kontrolu OLU kapiya doner.
//   2. `x | default('')` bos string DEGIL, SINIFI dondurur -> Ansible onu fact olarak
//      saklayamaz ve is "Type 'type' is unsupported for variable storage" gibi
//      teshis edilemez bir mesajla duser.
//
// IKISI DE URETIM KODUNDA VARDI:
//
//   telnet_openshift.yaml — zorunlu girdi kapisi:
//     (namespaces | default(namespace | default('') | ternary([namespace|default('')], [])))
//       | length > 0
//   `ternary` sinifi truthy gorup `[<class>]` uretiyordu, `length > 0` DOGRU donuyordu
//   ve assert GECIYORDU. Kapi, tam ihtiyac duyuldugu anda — AWX'te "Prompt on launch"
//   kapali olup TUM extra_vars yutuldugunda, yani fail_msg'in uyardigi senaryoda —
//   ateslenmiyordu.
//
//   logx_ocp_discover_fetch.yml — `oc_namespace: "{{ oc_namespace_input | default(namespace
//   | default('')) }}"`; portal her zaman `oc_namespace_input` gonderdigi icin uretimde
//   patlamiyordu ama playbook YEREL OLARAK HIC calistirilamiyordu.
//
// DOGRU YAZIM: `lookup('vars', 'namespace', default='')` — ayni geriye-uyum niyeti,
// Jinja global'ine carpmadan.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { allPlaybookFiles, MIN_PLAYBOOK_COUNT } = require('../paths.cjs');

// Jinja'nin kendi global'leri. Bir playbook bunlari BARE (tirnaksiz, noktasiz) kullanirsa
// kendi degiskenini degil, Jinja'nin nesnesini okur.
const JINJA_GLOBALS = ['namespace', 'range', 'dict', 'lipsum', 'cycler', 'joiner'];

const codeOnly = (src) =>
  src
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

/**
 * Bir metinde BARE kullanim var mi?
 *
 * Elenenler (mesru kullanimlar):
 *   'namespace' / "namespace"    -> tirnakli: sozluk anahtari, attribute adi
 *   item.namespace               -> nokta ile erisim
 *   ocp_namespaces / namespace_x -> daha uzun tanimlayici
 *   --namespace=                 -> shell bayragi (onunde tire)
 *   namespace(items=[]) / range(0,n) -> FONKSIYON cagrisi: Jinja global'inin MESRU
 *                                  kullanimi. Hata, ayni adi DEGISKEN sanmaktir;
 *                                  cagirmak degil. (`{% set ns = namespace(...) %}`
 *                                  deyimi bu depoda uc rapor playbook'unda kullaniliyor.)
 */
function bareUses(text, name) {
  const out = [];
  const re = new RegExp(`(^|[^A-Za-z0-9_.'"-])${name}(?![A-Za-z0-9_'"]|\\s*\\()`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index);
  return out;
}

/**
 * Bir dosyada JINJA IFADESI olarak degerlendirilen metin parcalari.
 *
 * NEDEN SATIRIN TAMAMI DEGIL: bekcinin ilk hali her satiri tariyordu ve gorev
 * ADLARINDAKI ("Build scan targets (cluster x namespace)") ile shell bayraklarindaki
 * (`--namespace={{ ... }}`) kelimeyi de kod sandi — sekiz yanlis pozitif. Olcut artik
 * YALNIZCA gercekten degerlendirilen metin:
 *   - `{{ ... }}` ve `{% ... %}` iclerigi
 *   - `when:` degeri
 *   - `that:` blogunun altindaki liste ogeleri (bunlar tirnaksiz Jinja'dir)
 */
function expressionParts(src) {
  const parts = [];
  const lines = src.split('\n');
  let thatIndent = -1;

  lines.forEach((line, i) => {
    const indent = line.length - line.trimStart().length;
    const push = (text) => {
      if (text && text.trim()) parts.push({ line: i + 1, text, raw: line });
    };

    if (/^\s*that:\s*$/.test(line)) {
      thatIndent = indent;
    } else if (thatIndent >= 0 && line.trim() !== '' && indent <= thatIndent) {
      thatIndent = -1;
    }
    if (thatIndent >= 0 && /^\s*-\s/.test(line)) push(line.replace(/^\s*-\s/, ''));

    const w = line.match(/\bwhen:\s*(.+)$/);
    if (w) push(w[1]);

    for (const m of line.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g)) {
      push(m[1] ?? m[2]);
    }
  });
  return parts;
}

test("JG1 hicbir playbook Jinja global'ini DEGISKEN gibi kullanmiyor", () => {
  const files = allPlaybookFiles();

  // Toplayici yanlis dizine bakarsa bekci bos kumeyle sessizce yesil kalmasin.
  assert.ok(
    files.length >= MIN_PLAYBOOK_COUNT,
    `yalnizca ${files.length} playbook goruldu (>=${MIN_PLAYBOOK_COUNT} bekleniyor)`,
  );

  const bulgular = [];
  let taranan = 0;
  for (const f of files) {
    for (const part of expressionParts(codeOnly(fs.readFileSync(f, 'utf8')))) {
      taranan++;
      for (const g of JINJA_GLOBALS) {
        if (bareUses(part.text, g).length === 0) continue;
        bulgular.push(`${path.basename(f)}:${part.line}  [${g}]  ${part.raw.trim().slice(0, 110)}`);
      }
    }
  }

  // Toplayici bozulup hic ifade gormezse bekci sessizce yesil kalmasin.
  assert.ok(taranan >= 500, `yalnizca ${taranan} Jinja ifadesi toplandi — toplayici bozuk`);

  assert.deepEqual(
    bulgular,
    [],
    "Jinja global'i degisken gibi kullanilmis:\n" +
      bulgular.map((b) => '  ' + b).join('\n') +
      "\n\nBu ad HER ZAMAN `is defined` doner ve `| default('')` bos string DEGIL bir\n" +
      'SINIF dondurur — kontrol kapisi OLU kalir ya da is teshis edilemez bir hatayla\n' +
      "duser. Dogru yazim: lookup('vars', '<ad>', default='')",
  );
});

test('JG2 tespit mantigi GERCEKTEN calisiyor (yanlis-negatif korumasi)', () => {
  // Bekci bos kumeyi yesil sanmasin: eslesmesi GEREKENLER ve ELENMESI gerekenler.
  const yakalanmali = [
    "          - (namespaces | default(namespace | default('') | ternary([namespace], []))) | length > 0",
    '    oc_namespace: "{{ oc_namespace_input | default(namespace | default(\'\')) }}"',
    '        msg: "{{ namespace }}"',
  ];
  for (const l of yakalanmali) {
    assert.ok(bareUses(l, 'namespace').length > 0, `yakalanmadi: ${l}`);
  }

  const elenmeli = [
    "    oc_namespace: \"{{ lookup('vars', 'namespace', default='') }}\"",
    '        namespaces: "{{ item.namespaces | default([]) }}"',
    "          - { 'namespace': item.1, 'app_name': item.0 }",
    '          {{ item.namespace | default("") }}',
    "          {{ results | selectattr('namespace', 'equalto', ns) | list }}",
    '    ocp_namespaces: "{{ ocp_namespaces | default([]) }}"',
    // FONKSIYON cagrisi mesrudur — hata, ayni adi DEGISKEN sanmaktir.
    '          {%- set ns = namespace(items=[]) -%}',
    '      loop: "{{ range(0, results | length) | list }}"',
  ];
  for (const l of elenmeli) {
    assert.equal(bareUses(l, 'namespace').length, 0, `yanlis pozitif: ${l}`);
  }
});
