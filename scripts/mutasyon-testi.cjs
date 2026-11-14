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

const REPO_ROOT = path.resolve(__dirname, '..');
const MIN_KILL_PCT = 85;

/** Targeted security/compliance mutation catalog (exact token replacements on live logic). */
const TARGETS = [
  {
    id: 'url',
    file: 'src/utils/url.ts',
    runner: 'vitest',
    tests: ['src/utils/__tests__/url.test.ts'],
    specs: [
      {
        id: 'url-allow-js',
        find: 'new Set(["http:", "https:"])',
        replace: 'new Set(["http:", "https:", "javascript:"])',
        desc: 'allow javascript scheme in allowlist',
      },
      {
        id: 'url-drop-https',
        find: 'new Set(["http:", "https:"])',
        replace: 'new Set(["http:"])',
        desc: 'drop https from allowlist',
      },
      {
        id: 'url-ctrl-lt',
        find: 'if (code <= 0x1f || code === 0x7f) return true;',
        replace: 'if (code < 0x1f || code === 0x7f) return true;',
        desc: 'relax control char <= to <',
      },
      {
        id: 'url-ctrl-and',
        find: 'if (code <= 0x1f || code === 0x7f) return true;',
        replace: 'if (code <= 0x1f && code === 0x7f) return true;',
        desc: 'change || to && in control char check',
      },
      {
        id: 'url-ctrl-ret',
        find: 'if (code <= 0x1f || code === 0x7f) return true;',
        replace: 'if (code <= 0x1f || code === 0x7f) return false;',
        desc: 'return false on control chars',
      },
      {
        id: 'url-proto-bypass',
        find: 'if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return "";',
        replace: 'if (ALLOWED_PROTOCOLS.has(parsed.protocol) && !parsed.hostname) return "";',
        desc: 'bypass ALLOWED_PROTOCOLS negation',
      },
      {
        id: 'url-open-unsafe',
        find: 'if (!url) return;',
        replace: 'if (false && !url) return;',
        desc: 'open window even when url rejected',
      },
      {
        id: 'url-proto-rel',
        find: 'if (v.startsWith("//")) {',
        replace: 'if (!v.startsWith("//")) {',
        desc: 'invert protocol-relative check',
      },
    ],
  },
  {
    id: 'degisken-gizle',
    file: 'server/ansible/degisken-gizle.cjs',
    runner: 'node',
    tests: ['server/ansible/__tests__/degisken-gizle.test.cjs'],
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
      'server/auth/__tests__/visibility.test.cjs',
      'server/auth/__tests__/visibility-cascade.test.cjs',
      'server/auth/__tests__/visibility-email-strict.test.cjs',
      'server/auth/__tests__/ek-sayfa-kapisi.test.cjs',
    ],
    specs: [
      {
        id: 'vis-killswitch',
        find: "if (!truthy(el.enabled)) { not('kill-switch: oge kapali (enabled=false)'); return false; }",
        replace: "if (!truthy(el.enabled)) { not('kill-switch'); return true; }",
        desc: 'bypass element kill-switch',
      },
      {
        id: 'vis-admin',
        find: "if (role === 'Admin') { not('admin muafiyeti'); return true; }",
        replace: "if (role !== 'Admin') { not('admin muafiyeti'); return true; }",
        desc: 'invert Admin exemption check',
      },
      {
        id: 'vis-strict-default',
        find: "if (strict) { not('SIKI oge ve eslesen kural YOK -> kapali'); return false; }",
        replace: "if (strict) { not('SIKI'); return true; }",
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
        find: 'if (ruleIndex.has(gKey)) { seen = true; if (ruleIndex.get(gKey)) { allow = true; eslesen = gKey; break; } }',
        replace:
          'if (ruleIndex.has(gKey)) { seen = true; if (!ruleIndex.get(gKey)) { allow = true; eslesen = gKey; break; } }',
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
        find: "function truthy(v) { return v === true || v === 1 || v === '1'; }",
        replace: 'function truthy(v) { return v === true && v === 1; }',
        desc: 'break truthy helper',
      },
    ],
  },
  {
    id: 'log',
    file: 'server/log.cjs',
    runner: 'node',
    tests: [
      'server/__tests__/log-rotation.test.cjs',
      'server/__tests__/log-kimlik-maskesi.test.cjs',
    ],
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
  for (const dirName of ['server', 'shared', 'src']) {
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

async function runTestsForTarget(sandboxDir, runner, tests) {
  if (runner === 'vitest') {
    const vitestBin = path.join(REPO_ROOT, 'gelistirme', 'node_modules', '.bin', 'vitest');
    const cmd = fs.existsSync(vitestBin) ? vitestBin : 'npx';
    const args = fs.existsSync(vitestBin)
      ? ['run', '--reporter=basic', ...tests]
      : ['vitest', 'run', ...tests];
    return runCommandAsync(cmd, args, sandboxDir);
  }
  return runCommandAsync(process.execPath, ['--test', ...tests], sandboxDir);
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
        const res = await runTestsForTarget(sb, m.runner, m.tests);
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
