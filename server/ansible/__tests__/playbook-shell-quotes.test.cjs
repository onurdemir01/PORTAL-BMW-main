// server/ansible/__tests__/playbook-shell-quotes.test.cjs
//
// GERCEK HATA: `logx_ocp_app_discovery.yml` icindeki bir shell blogunun YORUM satirina
// Turkce kesme isareti yazildi ("API'si"). Ansible argumanlari bolerken tek tirnaklari
// sayar ve blogun tamamini "unbalanced jinja2 block or quotes" ile REDDEDER — playbook
// hic yuklenmez. YAML gecerlidir, testler yesildir; hata ancak AWX'te calistirinca cikar.
//
// Bu test o sinifi tasarim zamaninda yakalar: her `shell:` blogunun yorum satirlarinda
// dengesiz tek tirnak aranir. (Kod satirlarinda tek tirnak MESRUDUR — jsonpath, quote
// filtreleri vb. — bu yuzden yalnizca `#` ile baslayan satirlara bakiyoruz.)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'playbooks');

function commentLinesWithOddQuotes(text) {
  const bad = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) return;
    const singles = (trimmed.match(/'/g) || []).length;
    if (singles % 2 === 1) bad.push(`${i + 1}: ${trimmed}`);
  });
  return bad;
}

// Yorum satirlari YALNIZCA shell/command bloklarinin icindeyken tehlikelidir; YAML
// seviyesindeki yorumlar (satir basi `#`) Ansible tarafindan zaten ayiklanir. Ayrimi
// girinti ile yapmak kirilgan olurdu, bu yuzden `|` blok skalerlerini ayikliyoruz.
function extractShellBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(ansible\.builtin\.)?(shell|command):\s*\|/);
    if (!m) continue;
    const baseIndent = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() && (line.length - line.trimStart().length) <= baseIndent) break;
      body.push(line);
    }
    blocks.push({ startLine: i + 1, body: body.join('\n') });
  }
  return blocks;
}

test('playbook shell bloklarindaki yorumlarda dengesiz tek tirnak YOK', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length > 0, 'playbook dizini bos olmamali');

  const problems = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    for (const block of extractShellBlocks(text)) {
      for (const bad of commentLinesWithOddQuotes(block.body)) {
        problems.push(`${file} (shell blogu satir ${block.startLine}) → ${bad}`);
      }
    }
  }

  assert.deepEqual(problems, [], `Ansible bu bloklari yukleyemez:\n${problems.join('\n')}`);
});

test('tespit mantigi gercekten calisiyor (yanlis-negatif korumasi)', () => {
  const sample = [
    "        ansible.builtin.shell: |",
    "          # DeploymentConfig API'si kapaliysa",
    "          oc get pods -o jsonpath='{.items[*].metadata.name}'",
    "        args:",
  ].join('\n');

  const blocks = extractShellBlocks(sample);
  assert.equal(blocks.length, 1, 'shell blogu bulunmali');
  const bad = commentLinesWithOddQuotes(blocks[0].body);
  assert.equal(bad.length, 1, 'kesme isaretli YORUM yakalanmali');
  assert.match(bad[0], /API/);
  // jsonpath satirinda da tek sayida tirnak YOK (cift) — kod satiri zaten atlaniyor.
});
