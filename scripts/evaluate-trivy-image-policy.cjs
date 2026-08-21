#!/usr/bin/env node
/**
 * Fail-closed Trivy JSON policy evaluator for staging-image-supply-chain.
 *
 * CRITICAL-with-fix always blocks.
 * HIGH-with-fix blocks unless HIGH_EXC=YES with complete approved exception
 * (reason, future UTC expiry YYYY-MM-DD, FOUNDER_ACK_HIGH_EXCEPTION).
 *
 * Does not contact the network. Exit 0 = pass; exit 1 = policy block / error.
 */

const fs = require("node:fs");
const path = require("node:path");

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function formatFinding(vuln) {
  const id = vuln.VulnerabilityID || "UNKNOWN-ID";
  const sev = (vuln.Severity || "").toUpperCase();
  const pkg = vuln.PkgName || "unknown-pkg";
  const installed = vuln.InstalledVersion || "unknown-installed";
  const fixed = vuln.FixedVersion || "unknown-fixed";
  return `${id} | ${sev} | ${pkg}@${installed} | ${fixed}`;
}

function collectFixedBySeverity(report) {
  const critical = [];
  const high = [];
  for (const result of report.Results || []) {
    for (const vuln of result.Vulnerabilities || []) {
      const sev = (vuln.Severity || "").toUpperCase();
      const fixed = vuln.FixedVersion;
      if (!fixed) {
        continue;
      }
      const line = formatFinding(vuln);
      if (sev === "CRITICAL") {
        critical.push(line);
      } else if (sev === "HIGH") {
        high.push(line);
      }
    }
  }
  return { critical, high };
}

function validateHighException(env, todayUtc) {
  if (env.HIGH_EXC !== "YES") {
    return { ok: false, reason: "HIGH_EXC is not YES" };
  }
  const reason = env.HIGH_REASON || "";
  const expiry = env.HIGH_EXPIRY || "";
  const ack = env.HIGH_ACK || "";
  if (!reason) {
    return { ok: false, reason: "high exception missing reason" };
  }
  if (ack !== "FOUNDER_ACK_HIGH_EXCEPTION") {
    return { ok: false, reason: "high exception missing founder ack" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return { ok: false, reason: "high exception expiry invalid" };
  }
  if (!(expiry > todayUtc)) {
    return { ok: false, reason: "high exception expiry not in the future" };
  }
  return { ok: true };
}

function writeExceptionRecord(env, highFindings, outPath) {
  const body = [
    "high_vuln_exception=YES",
    `reason=${env.HIGH_REASON}`,
    `expiry_utc=${env.HIGH_EXPIRY}`,
    `founder_ack=${env.HIGH_ACK}`,
    `source_sha=${env.IMAGE_SOURCE_SHA || ""}`,
    "findings:",
    ...highFindings,
    "",
  ].join("\n");
  fs.writeFileSync(outPath, body, "utf8");
}

function main(argv = process.argv.slice(2), env = process.env) {
  const reportPath = argv[0] || "trivy-image.json";
  const abs = path.resolve(reportPath);
  if (!fs.existsSync(abs)) {
    fail(`BLOCK: missing Trivy report at ${abs}`);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    fail(`BLOCK: invalid Trivy JSON (${err instanceof Error ? err.message : String(err)})`);
  }

  const { critical, high } = collectFixedBySeverity(report);
  const highExc = env.HIGH_EXC === "YES" ? "YES" : "NO";

  for (const line of [...critical, ...high]) {
    console.log(line);
  }

  console.log(`blocking_critical_with_fix=${critical.length}`);
  console.log(`blocking_high_with_fix=${high.length}`);
  console.log(`HIGH_EXC=${highExc}`);

  if (critical.length > 0) {
    console.log("BLOCK: Critical vulnerabilities with available fix");
    process.exit(1);
  }

  if (high.length > 0) {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const exc = validateHighException(env, todayUtc);
    if (!exc.ok) {
      console.log(
        `BLOCK: High vulnerabilities with available fix (${exc.reason || "no complete exception"})`,
      );
      process.exit(1);
    }
    const recordPath = path.resolve(
      path.dirname(abs),
      "high-vuln-exception-record.txt",
    );
    writeExceptionRecord(env, high, recordPath);
    console.log(
      "WARN: High findings allowed under time-bounded founder exception; record artifacted",
    );
  }

  console.log("Scan policy gate passed");
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  formatFinding,
  collectFixedBySeverity,
  validateHighException,
  main,
};
