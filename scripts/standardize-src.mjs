#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/standardize-src.mjs --dry
 *   node scripts/standardize-src.mjs --apply
 */

import fs from "fs/promises";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry") || args.has("-n");
const APPLY = args.has("--apply") || args.has("-y");

if (!DRY && !APPLY) {
  console.error("Usage: node scripts/standardize-src.mjs --dry | --apply");
  process.exit(1);
}
if (DRY && APPLY) {
  console.error("Choose only one: --dry or --apply");
  process.exit(1);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function moveIfNeeded(fromRel, toRel) {
  const from = path.join(ROOT, fromRel);
  const to = path.join(ROOT, toRel);

  const fromExists = await exists(from);
  const toExists = await exists(to);

  if (!fromExists) {
    return { action: "skip", from: fromRel, to: toRel, reason: "source_missing" };
  }
  if (toExists) {
    return { action: "skip", from: fromRel, to: toRel, reason: "target_exists" };
  }

  if (DRY) {
    return { action: "move", from: fromRel, to: toRel, reason: "dry_run" };
  }

  await ensureDir(path.dirname(to));
  await fs.rename(from, to);
  return { action: "move", from: fromRel, to: toRel, reason: "moved" };
}

function rewriteSpecifier(spec) {
  // Turn relative refs to old root folders into "@/..."
  // Examples:
  //  ../components/X  -> @/components/X
  //  ../../contexts/Y -> @/contexts/Y
  //  ../constants     -> @/constants
  //  ../../constants.ts -> @/constants
  const rules = [
    { key: "components", re: /^(?:\.\.\/)+components(\/.*)?$/ },
    { key: "contexts", re: /^(?:\.\.\/)+contexts(\/.*)?$/ },
    { key: "constants", re: /^(?:\.\.\/)+constants(?:\.ts)?(\/.*)?$/ },
  ];

  for (const r of rules) {
    const m = spec.match(r.re);
    if (m) {
      const rest = m[1] || "";
      return `@/${r.key}${rest}`;
    }
  }

  // Also normalize "src/..." style imports if any appear later
  if (spec.startsWith("src/")) return `@/${spec.slice(4)}`;

  return null;
}

async function listSourceFiles() {
  // Tiny globber is already in node_modules (seen in your tree)
  const { glob } = await import("tinyglobby");
  const patterns = [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.js",
    "src/**/*.jsx",
  ];
  const files = await glob(patterns, {
    cwd: ROOT,
    dot: false,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.vite/**"],
    absolute: true,
  });
  return files;
}

function patchImports(content) {
  // Match:
  // import ... from "..."
  // export ... from "..."
  // import("...")  (dynamic)
  // require("...") (just in case)
  //
  // NOTE: This is a pragmatic refactor; if you later want AST-level safety
  // we can swap to TS compiler API.
  const patterns = [
    {
      name: "import_from",
      re: /(import\s+[\s\S]*?\sfrom\s*)(['"])([^'"]+)\2/g,
      idx: 3,
    },
    {
      name: "export_from",
      re: /(export\s+[\s\S]*?\sfrom\s*)(['"])([^'"]+)\2/g,
      idx: 3,
    },
    {
      name: "dynamic_import",
      re: /(import\(\s*)(['"])([^'"]+)\2(\s*\))/g,
      idx: 3,
    },
    {
      name: "require",
      re: /(require\(\s*)(['"])([^'"]+)\2(\s*\))/g,
      idx: 3,
    },
  ];

  let out = content;
  const changes = [];

  for (const p of patterns) {
    out = out.replace(p.re, (full, a, quote, spec, b) => {
      const next = rewriteSpecifier(spec);
      if (!next) return full;

      changes.push({ from: spec, to: next });
      // reconstruct depending on pattern shape
      if (p.name === "import_from" || p.name === "export_from") {
        return `${a}${quote}${next}${quote}`;
      }
      // dynamic_import / require have trailing group
      return `${a}${quote}${next}${quote}${b}`;
    });
  }

  return { out, changes };
}

async function patchFile(fileAbs) {
  const rel = path.relative(ROOT, fileAbs);
  const before = await fs.readFile(fileAbs, "utf8");
  const { out, changes } = patchImports(before);

  if (changes.length === 0) return { rel, changed: false, changes: [] };

  if (DRY) return { rel, changed: true, changes };

  await fs.writeFile(fileAbs, out, "utf8");
  return { rel, changed: true, changes };
}

async function main() {
  console.log(DRY ? "[DRY RUN]" : "[APPLY]", "Standardize src structure");

  // 1) Move folders/files
  const moves = [];
  moves.push(await moveIfNeeded("components", "src/components"));
  moves.push(await moveIfNeeded("contexts", "src/contexts"));
  moves.push(await moveIfNeeded("constants.ts", "src/constants.ts"));

  for (const m of moves) {
    if (m.action === "move") {
      console.log(`- move: ${m.from} -> ${m.to} (${m.reason})`);
    } else {
      console.log(`- skip: ${m.from} -> ${m.to} (${m.reason})`);
    }
  }

  // 2) Patch imports under src/
  const files = await listSourceFiles();
  const results = [];
  for (const f of files) results.push(await patchFile(f));

  const touched = results.filter(r => r.changed);
  console.log("");
  console.log(`Patched files: ${touched.length}/${results.length}`);

  // Print a compact summary
  for (const r of touched) {
    const uniq = new Map();
    for (const c of r.changes) uniq.set(`${c.from}=>${c.to}`, c);
    console.log(`\n${r.rel}`);
    for (const c of uniq.values()) {
      console.log(`  - ${c.from}  ->  ${c.to}`);
    }
  }

  console.log("");
  console.log(DRY ? "Dry run complete." : "Apply complete.");
  console.log("Next: git diff, then npm run build.");
}

main().catch((e) => {
  console.error("ERROR:", e?.stack || e);
  process.exit(1);
});