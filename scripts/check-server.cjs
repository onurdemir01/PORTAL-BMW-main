// scripts/check-server.cjs - TypeScript checkJs gate for server/, shared/ and scripts/ (tsconfig.server-check.json)
// without masking failures. shared/ and scripts/ joined 2026-11-24 (PR-2): corporate Sonar treats them as
// sources and reads this tsconfig (sonar.typescript.tsconfigPaths).
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FATAL_RE = /\berror TS(1\d{3}|2300|2304|2307|2358|2367|2551|2552|2554):/;
const TS_ERR_RE = /\berror TS\d+:/;

/** tsc'yi checkJs projesiyle kosar; testler gecici bir projeyle cagirir. */
function runTsc({ cwd = ROOT, proje = 'tsconfig.server-check.json' } = {}) {
  const tscPkg = require.resolve('typescript/package.json', { paths: [ROOT] });
  const tscBin = path.join(path.dirname(tscPkg), 'bin', 'tsc');
  try {
    const out = execFileSync(process.execPath, [tscBin, '-p', proje, '--noEmit'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, output: out || '' };
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`;
    return { status: typeof err.status === 'number' ? err.status : 1, output };
  }
}

/**
 * tsc sonucunu kapi kararina cevirir (saf islev). Olumcul tani varsa ya da tsc tanisiz
 * basarisiz olduysa gecmez; strict=false bildirimleri yalniz sayilir.
 * @param {{ status: number, output: string }} sonuc
 * @returns {{ gecti: boolean, satirlar: string[] }}
 */
function degerlendir({ status, output }) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const fatal = lines.filter((line) => FATAL_RE.test(line));
  const totalErrors = lines.filter((line) => TS_ERR_RE.test(line)).length;

  if (fatal.length > 0) {
    return {
      gecti: false,
      satirlar: [
        `[check:server] FAIL - ${fatal.length} fatal server checkJs diagnostic(s):`,
        ...fatal,
      ],
    };
  }

  if (status !== 0 && totalErrors === 0) {
    return {
      gecti: false,
      satirlar: [
        `[check:server] FAIL - tsc exited with code ${status} without diagnostics:`,
        output.trim(),
      ],
    };
  }

  return {
    gecti: true,
    satirlar: [
      `[check:server] OK - 0 fatal diagnostics in server/, shared/, scripts/ (${totalErrors} non-fatal strict=false notices).`,
    ],
  };
}

function main(calistir = runTsc) {
  const { gecti, satirlar } = degerlendir(calistir());
  for (const satir of satirlar) {
    if (gecti) console.log(satir);
    else console.error(satir);
  }
  if (!gecti) process.exit(1);
}

if (require.main === module) main();

module.exports = { FATAL_RE, runTsc, degerlendir, main };
