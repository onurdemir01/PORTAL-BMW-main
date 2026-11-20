#!/usr/bin/env node
'use strict';

/**
 * Isolated sandbox mutation tester for critical security & compliance modules.
 * Never modifies files in the repository working tree: copies required source trees
 * into a temporary sandbox per worker and executes each module's unit tests.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIN_KILL_PCT = 85;

/** Targeted security/compliance mutation catalog (exact token replacements on live logic). */
const TARGETS = [
  {
    // Kurumsal teslim imzasi (kurumsal is #48): yarim aktarimin her bicimi ayri yakalanir. Yalniz
    // gecici git depolarinda kosan testler (TS1-TS6); TS7/TS8 repo kokundeki dosyalari okur.
    id: 'teslim-imza',
    file: 'scripts/teslim.cjs',
    runner: 'node',
    tests: ['server/__tests__/teslim.test.js'],
    testNamePattern: '^TS([1-6]|4b) ',
    specs: [
      {
        id: 'tes-eksik',
        find: 'if (!Object.hasOwn(mevcut, yol)) eksik.push(yol);',
        replace: 'if (false) eksik.push(yol);',
        desc: 'ignore files missing from the delivered tree',
      },
      {
        id: 'tes-farkli',
        find: 'else if (mevcut[yol] !== sha) farkli.push(yol);',
        replace: '',
        desc: 'ignore files whose content differs',
      },
      {
        id: 'tes-fazla',
        find: 'if (!Object.hasOwn(beklenen, yol)) fazla.push(yol);',
        replace: 'if (false) fazla.push(yol);',
        desc: 'ignore extra files not in main',
      },
      {
        id: 'tes-haric',
        find: 'if (IMZA_DISI.some((h) => yol.startsWith(h))) continue;',
        replace: '',
        desc: 'include kalite/ and non-delivered dirs (.github, sunum, ...) in the signature',
      },
      {
        id: 'tes-birebir',
        find: 'if (!fark) {',
        replace: 'if (true) {',
        desc: 'always report the tree as identical',
      },
    ],
  },
  {
    // Application Hub canli sonucu: AWX artifact'i Portal'in kendi is gecmisiyle eslesmeden okunmaz
    // ya da kaydedilmez (PR #303). Yalniz AH14 kosar; dosyanin betik testleri Python ister ve yavastir.
    id: 'app-hub-sahiplik',
    file: 'server/app-hub/canli.cjs',
    runner: 'node',
    tests: ['server/app-hub/__tests__/app-hub.test.js'],
    testNamePattern: '^AH14 ',
    specs: [
      {
        id: 'ah-tek-kayit',
        find: 'if (rows.length !== 1) return null;',
        replace: '',
        desc: 'accept zero or duplicate history rows',
      },
      {
        id: 'ah-sablon-adi',
        find: 'row.template_name !== TEMPLATE_NAME ||',
        replace: '',
        desc: 'skip template name ownership check',
      },
      {
        id: 'ah-platform',
        find: "params.platform !== 'app-hub-ocp'\n  )\n    return null;",
        replace: 'false\n  )\n    return null;',
        desc: 'skip platform ownership check',
      },
      {
        id: 'ah-artifact-app',
        find: 'raw.app !== ad ||',
        replace: '',
        desc: 'accept artifact of another application',
      },
      {
        id: 'ah-hedef-esit',
        find: 'hedefler.every((x, i) => x === sahiplik.hedefler[i])',
        replace: 'true',
        desc: 'compare target count only, not targets',
      },
      {
        id: 'ah-eksik-yazim',
        find: 'if (rowCount !== hedefler.length)\n      throw',
        replace: 'if (false)\n      throw',
        desc: 'accept short write as success',
      },
      {
        id: 'ah-mevcut-kayit',
        find: 'if (mevcut.length) {',
        replace: 'if (false) {',
        desc: 'write the same job twice',
      },
    ],
  },
  {
    id: 'degisken-gizle',
    file: 'server/ansible/degisken-gizle.cjs',
    runner: 'node',
    tests: ['server/ansible/__tests__/degisken-gizle.test.js'],
    specs: [
      {
        id: 'dg-val-some',
        find: 'SIR_DEGERI.some((d) => d.test(String(metin)))',
        replace: 'false',
        desc: 'disable secret value pattern detection',
      },
      {
        id: 'dg-obj-test',
        find: 'SIR_ANAHTARI.test(k) || icindeSirVar(v)',
        replace: 'SIR_ANAHTARI.test(k) && icindeSirVar(v)',
        desc: 'require both secret key AND value in nested obj',
      },
      {
        id: 'dg-top-test',
        find: 'if (SIR_ANAHTARI.test(k) || icindeSirVar(v)) gizlenen.push(k);',
        replace: 'if (SIR_ANAHTARI.test(k)) gizlenen.push(k);',
        desc: 'skip nested secret scan in nesnedenAyikla',
      },
      {
        id: 'dg-top-drop-key',
        find: 'if (SIR_ANAHTARI.test(k) || icindeSirVar(v)) gizlenen.push(k);',
        replace: 'if (icindeSirVar(v)) gizlenen.push(k);',
        desc: 'skip key-name check in nesnedenAyikla',
      },
      {
        id: 'dg-yaml-block',
        find: 'if (SIR_ANAHTARI.test(b.anahtar) || icAnahtar || degerSirMi(govde)) gizlenen.push(b.anahtar);',
        replace: 'if (SIR_ANAHTARI.test(b.anahtar)) gizlenen.push(b.anahtar);',
        desc: 'skip YAML nested key & value scan',
      },
      {
        id: 'dg-yaml-anon',
        find: 'else if (\n      degerSirMi(govde) ||',
        replace: 'else if (\n      degerSirMi(govde) &&',
        desc: 'weaken YAML inline secret line removal',
      },
      {
        id: 'dg-array-scan',
        find: 'if (Array.isArray(deger)) return deger.some(icindeSirVar);',
        replace: 'if (Array.isArray(deger)) return false;',
        desc: 'skip array element recursion',
      },
    ],
  },
  {
    id: 'visibility',
    file: 'server/auth/visibility.cjs',
    runner: 'node',
    tests: [
      'server/auth/__tests__/visibility.test.js',
      'server/auth/__tests__/visibility-cascade.test.js',
      'server/auth/__tests__/visibility-email-strict.test.js',
      'server/auth/__tests__/ek-sayfa-kapisi.test.js',
    ],
    specs: [
      {
        id: 'vis-killswitch',
        find: "if (!truthy(el.enabled)) {\n    not('kill-switch: oge kapali (enabled=false)');\n    return false;\n  }",
        replace: "if (!truthy(el.enabled)) {\n    not('kill-switch');\n    return true;\n  }",
        desc: 'bypass element kill-switch',
      },
      {
        id: 'vis-admin',
        find: "if (role === 'Admin') {\n    not('admin muafiyeti');\n    return true;\n  }",
        replace: "if (role !== 'Admin') {\n    not('admin muafiyeti');\n    return true;\n  }",
        desc: 'invert Admin exemption check',
      },
      {
        id: 'vis-strict-default',
        find: "if (strict) {\n    not('SIKI oge ve eslesen kural YOK -> kapali');\n    return false;\n  }",
        replace: "if (strict) {\n    not('SIKI');\n    return true;\n  }",
        desc: 'fail-open when strict element has no matching rule',
      },
      {
        id: 'vis-user-deny',
        find: 'if (ruleIndex.has(uKey)) {',
        replace: 'if (false && ruleIndex.has(uKey)) {',
        desc: 'skip user-level visibility rule',
      },
      {
        id: 'vis-email-rule',
        find: 'if (ruleIndex.has(eKey)) {',
        replace: 'if (false && ruleIndex.has(eKey)) {',
        desc: 'skip email-level visibility rule',
      },
      {
        id: 'vis-group-break',
        find: 'seen = true;\n        if (ruleIndex.get(gKey)) {\n          allow = true;',
        replace: 'seen = true;\n        if (!ruleIndex.get(gKey)) {\n          allow = true;',
        desc: 'invert group allow evaluation',
      },
      {
        id: 'vis-role-rule',
        find: 'if (ruleIndex.has(rKey)) {',
        replace: 'if (false && ruleIndex.has(rKey)) {',
        desc: 'skip role-level visibility rule',
      },
      {
        id: 'vis-truthy',
        find: "function truthy(v) {\n  return v === true || v === 1 || v === '1';\n}",
        replace: 'function truthy(v) {\n  return v === true && v === 1;\n}',
        desc: 'break truthy helper',
      },
    ],
  },
  {
    id: 'log',
    file: 'server/log.cjs',
    runner: 'node',
    tests: ['server/__tests__/log-rotation.test.js', 'server/__tests__/log-kimlik-maskesi.test.js'],
    specs: [
      {
        id: 'log-empty-zero',
        find: "if (text === '') return fallback;",
        replace: "if (text !== '') return fallback;",
        desc: 'invert empty env guard in numEnv',
      },
      {
        id: 'log-finite',
        find: 'if (!Number.isFinite(n)) return fallback;',
        replace: 'if (Number.isFinite(n)) return fallback;',
        desc: 'invert NaN guard in numEnv',
      },
      {
        id: 'log-rotate-cond',
        find: 'if (bytes + buf.length > cfg.maxBytes && bytes > 0) rotate();',
        replace: 'if (bytes + buf.length > cfg.maxBytes && bytes < 0) rotate();',
        desc: 'disable size-based log rotation',
      },
      {
        id: 'log-mask-url',
        find: ".replace(URL_KIMLIK, '$1$2:***@')",
        replace: ".replace(URL_KIMLIK, '$1$2:$3@')",
        desc: 'leak password in URL credential mask',
      },
      {
        id: 'log-mask-cookie',
        find: ".replace(COOKIE_HDR_RE, '$1: [MASKED]')",
        replace: '',
        desc: 'stop masking Cookie headers',
      },
      {
        id: 'log-mask-sid',
        find: ".replace(SID_KV_RE, '$1=[MASKED]')",
        replace: '',
        desc: 'stop masking session IDs',
      },
      {
        id: 'log-mask-auth',
        find: ".replace(AUTH_SCHEME, '$1 ***')",
        replace: '',
        desc: 'stop masking Bearer/Basic auth headers',
      },
      {
        id: 'log-mask-jwt',
        find: ".replace(JWT_RE, 'eyJ***')",
        replace: '',
        desc: 'stop masking JWT tokens',
      },
    ],
  },
];

/** Generate concrete mutations present in `content` using `specs`. */
function generateMutants(target, content) {
  const mutants = [];
  for (const spec of target.specs) {
    const idx = content.indexOf(spec.find);
    if (idx === -1) continue;
    const mutated = content.slice(0, idx) + spec.replace + content.slice(idx + spec.find.length);
    const line = content.slice(0, idx).split('\n').length;
    mutants.push({
      targetId: target.id,
      file: target.file,
      runner: target.runner,
      tests: target.tests,
      testNamePattern: target.testNamePattern || null,
      id: spec.id,
      desc: spec.desc,
      line,
      mutated,
    });
  }
  return mutants;
}

/** Aggregate per-mutant statuses and enforce kill percentage threshold. */
function summarizeResults(results, minKillPct = MIN_KILL_PCT) {
  const total = results.length;
  const killed = results.filter((r) => r.killed).length;
  const survived = results.filter((r) => !r.killed);
  const killPct = total > 0 ? Number(((killed / total) * 100).toFixed(2)) : 0;
  return {
    total,
    killed,
    survivedCount: survived.length,
    survived,
    killPct,
    minKillPct,
    passed: total > 0 && killPct >= minKillPct,
  };
}

function runCommandAsync(cmd, args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0' };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', (e) => resolve({ code: 1, out, err: String(e) }));
  });
}

function prepareSandbox(sandboxDir) {
  fs.mkdirSync(sandboxDir, { recursive: true });
  for (const dirName of ['server', 'shared', 'src', 'scripts']) {
    fs.cpSync(path.join(REPO_ROOT, dirName), path.join(sandboxDir, dirName), { recursive: true });
  }
  for (const fileName of ['package.json', 'vitest.config.ts', 'tsconfig.json']) {
    const srcPath = path.join(REPO_ROOT, fileName);
    if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, path.join(sandboxDir, fileName));
  }
  const gelSrc = path.join(REPO_ROOT, 'gelistirme');
  if (fs.existsSync(gelSrc)) {
    const gelDst = path.join(sandboxDir, 'gelistirme');
    fs.mkdirSync(gelDst, { recursive: true });
    const nm = path.join(gelSrc, 'node_modules');
    if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(gelDst, 'node_modules'), 'dir');
  }
  const rootNm = path.join(REPO_ROOT, 'node_modules');
  if (fs.existsSync(rootNm)) fs.symlinkSync(rootNm, path.join(sandboxDir, 'node_modules'), 'dir');
  return sandboxDir;
}

async function runTestsForTarget(sandboxDir, runner, tests, testNamePattern = null) {
  if (runner === 'vitest') {
    const vitestBin = path.join(REPO_ROOT, 'gelistirme', 'node_modules', '.bin', 'vitest');
    const cmd = fs.existsSync(vitestBin) ? vitestBin : aracYolu('npx');
    const args = fs.existsSync(vitestBin)
      ? ['run', '--reporter=basic', ...tests]
      : ['vitest', 'run', ...tests];
    return runCommandAsync(cmd, args, sandboxDir);
  }
  const desen = testNamePattern ? [`--test-name-pattern=${testNamePattern}`] : [];
  return runCommandAsync(process.execPath, ['--test', ...desen, ...tests], sandboxDir);
}

async function runMutationSuite({ targetFilter = null, concurrency = 4 } = {}) {
  const selectedTargets = targetFilter
    ? TARGETS.filter((t) => targetFilter.split(',').includes(t.id))
    : TARGETS;

  const originals = new Map();
  const allMutants = [];
  for (const t of selectedTargets) {
    const abs = path.join(REPO_ROOT, t.file);
    const content = fs.readFileSync(abs, 'utf8');
    originals.set(t.file, content);
    allMutants.push(...generateMutants(t, content));
  }

  const workerCount = Math.min(concurrency, Math.max(1, allMutants.length));
  const sandboxes = [];
  const results = new Array(allMutants.length);
  let cursor = 0;

  try {
    for (let i = 0; i < workerCount; i += 1) {
      sandboxes.push(
        prepareSandbox(fs.mkdtempSync(path.join(os.tmpdir(), `bmw-mut-${process.pid}-${i}-`))),
      );
    }

    const workers = sandboxes.map(async (sb) => {
      while (true) {
        const idx = cursor++;
        if (idx >= allMutants.length) break;
        const m = allMutants[idx];
        const targetAbs = path.join(sb, m.file);
        fs.writeFileSync(targetAbs, m.mutated, 'utf8');
        const res = await runTestsForTarget(sb, m.runner, m.tests, m.testNamePattern);
        fs.writeFileSync(targetAbs, originals.get(m.file), 'utf8');
        results[idx] = {
          id: m.id,
          file: m.file,
          line: m.line,
          desc: m.desc,
          killed: res.code !== 0,
        };
      }
    });
    await Promise.all(workers);
  } finally {
    for (const sb of sandboxes) {
      fs.rmSync(sb, { recursive: true, force: true });
    }
  }

  return summarizeResults(results, MIN_KILL_PCT);
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const targetArg = args.find((a) => a.startsWith('--target='));
  const targetFilter = targetArg ? targetArg.slice('--target='.length) : null;

  const summary = await runMutationSuite({ targetFilter });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log(
      `[mutation] Killed ${summary.killed}/${summary.total} mutants (${summary.killPct}% | min ${summary.minKillPct}%)`,
    );
    if (summary.survived.length) {
      for (const s of summary.survived) {
        console.log(`  [SURVIVED] ${s.file}:${s.line} (${s.id}) - ${s.desc}`);
      }
    }
  }
  if (!summary.passed) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[mutation] error:', err);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  MIN_KILL_PCT,
  generateMutants,
  summarizeResults,
  runMutationSuite,
};
