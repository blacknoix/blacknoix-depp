#!/usr/bin/env node
/**
 * Fail closed if git merge-conflict markers appear in tracked (or scanned) files.
 *
 * Markers matched only at line start to avoid false positives on prose that
 * mentions the tokens without being unresolved conflict markers:
 *   ^<<<<<<<
 *   ^=======
 *   ^>>>>>>>
 *
 * Usage:
 *   node scripts/check-merge-markers.cjs
 *   node scripts/check-merge-markers.cjs --staged   # pre-commit: staged files only
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MARKER = /^(<<<<<<<|=======|>>>>>>>)/;

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
]);

function listStagedFiles() {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

function shouldSkip(relPath) {
  const parts = relPath.split(/[/\\]/);
  return parts.some((part) => SKIP_DIR_NAMES.has(part));
}

function scanFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return [];
  }
  if (
    /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|wasm)$/i.test(
      relPath,
    )
  ) {
    return [];
  }
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  if (text.includes("\0")) {
    return [];
  }
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (MARKER.test(lines[i])) {
      hits.push({ line: i + 1, text: lines[i].slice(0, 120) });
    }
  }
  return hits;
}

function main() {
  const stagedOnly = process.argv.includes("--staged");
  const files = (stagedOnly ? listStagedFiles() : listTrackedFiles()).filter(
    (f) => !shouldSkip(f),
  );

  const offenders = [];
  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length > 0) {
      offenders.push({ file, hits });
    }
  }

  if (offenders.length === 0) {
    process.stdout.write(
      stagedOnly
        ? "merge-marker check: ok (staged files)\n"
        : "merge-marker check: ok (tracked files)\n",
    );
    return;
  }

  process.stderr.write(
    "merge-marker check FAILED: unresolved conflict markers found.\n",
  );
  for (const { file, hits } of offenders) {
    for (const hit of hits) {
      process.stderr.write(`  ${file}:${hit.line}: ${hit.text}\n`);
    }
  }
  process.stderr.write(
    "Remove all lines matching ^(<<<<<<<|=======|>>>>>>>) before committing.\n",
  );
  process.exit(1);
}

main();
