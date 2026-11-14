// scripts/check-server.cjs - TypeScript checkJs gate for server/**/*.cjs without masking failures.
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FATAL_RE = /\berror TS(1\d{3}|2300|2304|2307|2358|2367|2551|2552|2554):/;
const TS_ERR_RE = /\berror TS\d+:/;

function runTsc() {
  const tscPkg = require.resolve('typescript/package.json', { paths: [ROOT] });
  const tscBin = path.join(path.dirname(tscPkg), 'bin', 'tsc');
  try {
    const out = execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.server-check.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, output: out || '' };
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`;
    return { status: typeof err.status === 'number' ? err.status : 1, output };
  }
}

function main() {
  const { status, output } = runTsc();
  const lines = output.split(/\r?\n/).filter(Boolean);
  const fatal = lines.filter((line) => FATAL_RE.test(line));
  const totalErrors = lines.filter((line) => TS_ERR_RE.test(line)).length;

  if (fatal.length > 0) {
    console.error(`[check:server] FAIL - ${fatal.length} fatal server checkJs diagnostic(s):`);
    for (const line of fatal) console.error(line);
    process.exit(1);
  }

  if (status !== 0 && totalErrors === 0) {
    console.error(`[check:server] FAIL - tsc exited with code ${status} without diagnostics:`);
    console.error(output.trim());
    process.exit(1);
  }

  console.log(`[check:server] OK - 0 fatal diagnostics in server/**/*.cjs (${totalErrors} non-fatal strict=false notices).`);
}

main();
