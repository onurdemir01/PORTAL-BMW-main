'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TARGETS,
  MIN_KILL_PCT,
  generateMutants,
  summarizeResults,
  runMutationSuite,
} = require('../../scripts/mutasyon-testi.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');

test('mutation tester generates valid mutants across critical targets and enforces >= 85% kill rate', async () => {
  assert.equal(MIN_KILL_PCT, 85);
  assert.ok(TARGETS.length >= 4);

  for (const target of TARGETS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, target.file), 'utf8');
    const mutants = generateMutants(target, src);
    assert.ok(mutants.length >= 5, `${target.file} should yield at least 5 mutants`);
  }

  const passSummary = summarizeResults([
    { id: 'm1', killed: true },
    { id: 'm2', killed: true },
    { id: 'm3', killed: true },
    { id: 'm4', killed: true },
    { id: 'm5', killed: true },
    { id: 'm6', killed: true },
    { id: 'm7', killed: false },
  ]);
  assert.equal(passSummary.passed, true);
  assert.equal(passSummary.killPct, 85.71);

  const failSummary = summarizeResults([
    { id: 'm1', killed: true },
    { id: 'm2', killed: false },
  ]);
  assert.equal(failSummary.passed, false);

  // Live sandboxed mutation check on degisken-gizle without touching workspace files
  const live = await runMutationSuite({ targetFilter: 'degisken-gizle', concurrency: 2 });
  assert.equal(live.passed, true, `Survived mutants: ${JSON.stringify(live.survived)}`);
  assert.ok(live.killPct >= 85);
});
