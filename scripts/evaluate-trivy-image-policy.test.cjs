#!/usr/bin/env node
/**
 * Focused tests for scripts/evaluate-trivy-image-policy.cjs
 * Fixtures are synthetic only (TEST-CVE-*, example-pkg, *-fixture versions).
 */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const ROOT = path.resolve(__dirname);
const EVAL = path.join(ROOT, "evaluate-trivy-image-policy.cjs");
const FIX = path.join(ROOT, "fixtures", "trivy");

function runEvaluator(fixtureName, env = {}) {
  const report = path.join(FIX, fixtureName);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trivy-policy-"));
  const localReport = path.join(tmp, "trivy-image.json");
  fs.copyFileSync(report, localReport);
  const result = spawnSync(process.execPath, [EVAL, localReport], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    tmp,
    localReport,
  };
}

describe("evaluate-trivy-image-policy fixtures", () => {
  it("passes when there are no blocking findings", () => {
    const r = runEvaluator("no-blocking.json", { HIGH_EXC: "NO" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /blocking_critical_with_fix=0/);
    assert.match(r.stdout, /blocking_high_with_fix=0/);
    assert.match(r.stdout, /HIGH_EXC=NO/);
    assert.match(r.stdout, /Scan policy gate passed/);
  });

  it("blocks CRITICAL-with-fix", () => {
    const r = runEvaluator("critical-with-fix.json", { HIGH_EXC: "NO" });
    assert.equal(r.status, 1);
    assert.match(
      r.stdout,
      /TEST-CVE-0001 \| CRITICAL \| example-pkg@0\.0\.0-fixture \| 0\.0\.1-fixture/,
    );
    assert.match(r.stdout, /blocking_critical_with_fix=1/);
    assert.match(r.stdout, /HIGH_EXC=NO/);
    assert.match(r.stdout, /BLOCK: Critical vulnerabilities with available fix/);
  });

  it("blocks HIGH-with-fix when HIGH_EXC=NO", () => {
    const r = runEvaluator("high-with-fix.json", { HIGH_EXC: "NO" });
    assert.equal(r.status, 1);
    assert.match(
      r.stdout,
      /TEST-CVE-0002 \| HIGH \| example-pkg@0\.0\.0-fixture \| 0\.0\.1-fixture/,
    );
    assert.match(r.stdout, /blocking_high_with_fix=1/);
    assert.match(r.stdout, /HIGH_EXC=NO/);
    assert.match(r.stdout, /BLOCK: High vulnerabilities with available fix/);
  });

  it("allows HIGH-with-fix with complete valid exception", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const r = runEvaluator("high-with-fix.json", {
      HIGH_EXC: "YES",
      HIGH_REASON: "fixture-only controlled exception",
      HIGH_EXPIRY: future,
      HIGH_ACK: "FOUNDER_ACK_HIGH_EXCEPTION",
      IMAGE_SOURCE_SHA: "fixture-source-sha",
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /blocking_high_with_fix=1/);
    assert.match(r.stdout, /HIGH_EXC=YES/);
    assert.match(r.stdout, /WARN: High findings allowed under time-bounded founder exception/);
    assert.match(r.stdout, /Scan policy gate passed/);
    const record = path.join(r.tmp, "high-vuln-exception-record.txt");
    assert.equal(fs.existsSync(record), true);
    const body = fs.readFileSync(record, "utf8");
    assert.match(body, /high_vuln_exception=YES/);
    assert.match(body, /TEST-CVE-0002/);
  });

  it("fixtures contain only synthetic identifiers", () => {
    for (const name of [
      "no-blocking.json",
      "critical-with-fix.json",
      "high-with-fix.json",
    ]) {
      const text = fs.readFileSync(path.join(FIX, name), "utf8");
      assert.equal(/CVE-\d{4}-\d+/.test(text), false);
      assert.equal(/tar@|brace-expansion|picomatch|ip-address|sigstore/i.test(text), false);
    }
  });
});
