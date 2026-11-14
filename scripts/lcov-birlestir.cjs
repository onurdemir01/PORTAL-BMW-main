#!/usr/bin/env node
// scripts/lcov-birlestir.cjs
// Merges node:test (--experimental-test-coverage --test-reporter=lcov) and Vitest
// (coverage/vitest/lcov.info) LCOV reports into a single repo-relative coverage/lcov.info
// for SonarQube (`sonar.javascript.lcov.reportPaths=coverage/lcov.info`).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { Buffer } = require('node:buffer');

/**
 * Normalizes an LCOV `SF:` file path to a forward-slash path relative to `repoRoot`.
 */
function normalizeSfPath(rawPath, repoRoot = process.cwd()) {
  const s = String(rawPath || '').trim().replaceAll('\\', '/');
  if (!s) return '';
  const rootPosix = path.resolve(repoRoot).replaceAll('\\', '/').replace(/\/+$/, '');
  if (s.startsWith(`${rootPosix}/`)) {
    return s.slice(rootPosix.length + 1);
  }
  const resolved = path.isAbsolute(s) ? s : path.resolve(repoRoot, s).replaceAll('\\', '/');
  if (resolved.startsWith(`${rootPosix}/`)) {
    return resolved.slice(rootPosix.length + 1);
  }
  return s.replace(/^\.\//, '');
}

function emptyRecord(sf) {
  return {
    sf,
    fns: new Map(),
    fnda: new Map(),
    da: new Map(),
    brda: new Map(),
  };
}

/**
 * Parses raw LCOV content into normalized per-file records.
 */
function parseLcovRecords(text, repoRoot = process.cwd()) {
  const records = new Map();
  let cur = null;

  const ensureRecord = (sf) => {
    const key = normalizeSfPath(sf, repoRoot);
    if (!key) return null;
    if (!records.has(key)) records.set(key, emptyRecord(key));
    return records.get(key);
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'end_of_record') {
      cur = null;
      continue;
    }
    if (line.startsWith('SF:')) {
      cur = ensureRecord(line.slice(3));
      continue;
    }
    if (!cur) continue;

    if (line.startsWith('FN:')) {
      const idx = line.indexOf(',');
      if (idx > 3) {
        const lineNo = line.slice(3, idx);
        const fnName = line.slice(idx + 1);
        if (!cur.fns.has(fnName)) cur.fns.set(fnName, lineNo);
      }
    } else if (line.startsWith('FNDA:')) {
      const idx = line.indexOf(',');
      if (idx > 5) {
        const hits = Number(line.slice(5, idx)) || 0;
        const fnName = line.slice(idx + 1);
        cur.fnda.set(fnName, (cur.fnda.get(fnName) || 0) + hits);
      }
    } else if (line.startsWith('DA:')) {
      const [lineNoStr, hitsStr] = line.slice(3).split(',');
      const lineNo = Number(lineNoStr);
      const hits = Number(hitsStr) || 0;
      if (Number.isInteger(lineNo) && lineNo > 0) {
        cur.da.set(lineNo, (cur.da.get(lineNo) || 0) + hits);
      }
    } else if (line.startsWith('BRDA:')) {
      const parts = line.slice(5).split(',');
      if (parts.length === 4) {
        const key = `${parts[0]},${parts[1]},${parts[2]}`;
        const rawTaken = parts[3];
        const prev = cur.brda.get(key);
        if (rawTaken === '-') {
          if (prev === undefined) cur.brda.set(key, '-');
        } else {
          const hits = Number(rawTaken) || 0;
          const prevNum = prev === undefined || prev === '-' ? 0 : Number(prev);
          cur.brda.set(key, prevNum + hits);
        }
      }
    }
  }
  return records;
}

/**
 * Merges multiple LCOV report strings into one deduplicated LCOV string.
 */
function mergeLcovTexts(texts, repoRoot = process.cwd()) {
  const merged = new Map();

  for (const text of texts) {
    const recs = parseLcovRecords(text, repoRoot);
    for (const [sf, rec] of recs.entries()) {
      if (!merged.has(sf)) merged.set(sf, emptyRecord(sf));
      const dst = merged.get(sf);
      for (const [fnName, lineNo] of rec.fns.entries()) {
        if (!dst.fns.has(fnName)) dst.fns.set(fnName, lineNo);
      }
      for (const [fnName, hits] of rec.fnda.entries()) {
        dst.fnda.set(fnName, (dst.fnda.get(fnName) || 0) + hits);
      }
      for (const [lineNo, hits] of rec.da.entries()) {
        dst.da.set(lineNo, (dst.da.get(lineNo) || 0) + hits);
      }
      for (const [brKey, val] of rec.brda.entries()) {
        const prev = dst.brda.get(brKey);
        if (val === '-') {
          if (prev === undefined) dst.brda.set(brKey, '-');
        } else {
          const prevNum = prev === undefined || prev === '-' ? 0 : Number(prev);
          dst.brda.set(brKey, prevNum + Number(val));
        }
      }
    }
  }

  const out = [];
  for (const sf of [...merged.keys()].sort((a, b) => a.localeCompare(b))) {
    const r = merged.get(sf);
    out.push('TN:');
    out.push(`SF:${sf}`);

    for (const [fnName, lineNo] of r.fns.entries()) {
      out.push(`FN:${lineNo},${fnName}`);
    }
    let fnh = 0;
    for (const [fnName, hits] of r.fnda.entries()) {
      if (hits > 0) fnh += 1;
      out.push(`FNDA:${hits},${fnName}`);
    }
    out.push(`FNF:${r.fns.size || r.fnda.size}`);
    out.push(`FNH:${fnh}`);

    let brh = 0;
    for (const [brKey, val] of r.brda.entries()) {
      if (val !== '-' && Number(val) > 0) brh += 1;
      out.push(`BRDA:${brKey},${val}`);
    }
    out.push(`BRF:${r.brda.size}`);
    out.push(`BRH:${brh}`);

    const lineNums = [...r.da.keys()].sort((a, b) => a - b);
    let lh = 0;
    for (const lineNo of lineNums) {
      const hits = r.da.get(lineNo);
      if (hits > 0) lh += 1;
      out.push(`DA:${lineNo},${hits}`);
    }
    out.push(`LF:${lineNums.length}`);
    out.push(`LH:${lh}`);
    out.push('end_of_record');
  }

  return `${out.join('\n')}${out.length ? '\n' : ''}`;
}

function mergeLcovFiles(inputPaths, outputPath, repoRoot = process.cwd()) {
  const texts = [];
  const used = [];
  for (const p of inputPaths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
    if (!fs.existsSync(abs)) continue;
    texts.push(fs.readFileSync(abs, 'utf8'));
    used.push(abs);
  }
  const combined = mergeLcovTexts(texts, repoRoot);
  const absOut = path.isAbsolute(outputPath) ? outputPath : path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, combined, 'utf8');
  return { outputPath: absOut, inputCount: used.length, bytes: Buffer.byteLength(combined) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let out = 'coverage/lcov.info';
  const inputs = [];
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
      out = args[i + 1];
      i += 1;
    } else {
      inputs.push(args[i]);
    }
  }
  if (!inputs.length) {
    inputs.push('coverage/node-lcov.info', 'coverage/vitest/lcov.info');
  }
  const res = mergeLcovFiles(inputs, out, process.cwd());
  process.stdout.write(
    `[lcov] ${res.inputCount} rapor birlestirildi -> ${res.outputPath} (${res.bytes} byte)\n`,
  );
}

module.exports = {
  normalizeSfPath,
  parseLcovRecords,
  mergeLcovTexts,
  mergeLcovFiles,
};
