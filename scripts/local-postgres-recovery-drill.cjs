#!/usr/bin/env node
/**
 * Local disposable-Postgres recovery drill (criterion 7 — local evidence only).
 *
 * Safety-gated backup/restore of the Compose `depp` database into a disposable
 * restore target, then post-restore vertical-slice verification.
 *
 *   cd backend/api-gateway && npm run recovery:local-postgres
 *
 * Artifacts are written outside the repository under:
 *   <Downloads>/depp-local-recovery-drill/recovery-drill-<timestamp>/
 *
 * Non-claims: not staging, production, RPO/RTO, HA, managed-backup, IdP, or
 * platform evidence. Does not print connection strings, passwords, or tokens.
 */

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GATEWAY = path.join(ROOT, "backend", "api-gateway");
const COMPOSE_FILE = path.join(ROOT, "infra", "docker-compose.yml");
const TEST_ENV = path.join(GATEWAY, "tests", "test.env");
const CONTAINER = "depp-postgres";
const VOLUME = "depp-postgres-data";
const SOURCE_DB = "depp";
const RECOVERY_DB = "depp_recovery_drill";
const EXPECTED_IMAGE_PREFIX = "postgres:17";

const report = {
  claimClass: "local disposable-Postgres recovery-drill validation",
  stagingEvidence: false,
  idpEvidence: false,
  productionAuthorized: false,
  sourceSha: null,
  command: "npm run recovery:local-postgres",
  fixture: {
    composeFile: "infra/docker-compose.yml",
    service: "postgres",
    containerName: CONTAINER,
    volume: VOLUME,
    image: null,
    postgresVersion: null,
    sourceDatabase: SOURCE_DB,
    restoreDatabase: RECOVERY_DB,
    migrationCommand: "npm run migrate:latest (via test.env DATABASE_MIGRATION_URL)",
  },
  outcomes: {
    safetyCheck: "pending",
    migrate: "pending",
    preBackupVerticalSlice: "pending",
    seed: "pending",
    backup: "pending",
    restore: "pending",
    postRestoreVerify: "pending",
    postRestoreVerticalSlice: "pending",
    originalFixtureVerticalSlice: "pending",
    cleanup: "pending",
  },
  preBackupVerticalSlice: null,
  postRestoreVerticalSlice: null,
  originalFixtureVerticalSlice: null,
  artifactDir: null,
};

let artifactDir = null;
let backupPath = null;
let statePath = null;
let reportPath = null;

function fail(step, message) {
  report.outcomes[step] = "fail";
  console.error(`recovery-drill FAIL [${step}]: ${message}`);
  throw new Error(message);
}

function loadTestEnv() {
  const raw = fs.readFileSync(TEST_ENV, "utf8");
  const env = { ...process.env };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    env[key] = value;
  }
  return env;
}

function parsePgUrl(urlString, label) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    fail("safetyCheck", `${label} is not a parseable URL`);
  }
  const host = (u.hostname || "").toLowerCase();
  const db = (u.pathname || "").replace(/^\//, "");
  return {
    host,
    port: u.port || "5432",
    database: db,
    username: decodeURIComponent(u.username || ""),
  };
}

function rewriteDb(urlString, database) {
  const u = new URL(urlString);
  u.pathname = `/${database}`;
  return u.toString();
}

function redactedUrlMeta(urlString) {
  const p = parsePgUrl(urlString, "DATABASE_URL");
  return {
    host: p.host,
    port: p.port,
    database: p.database,
    username: p.username,
  };
}

function docker(...args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    const safe = err
      .replace(/postgres:\/\/[^\s]+/gi, "postgres://[redacted]")
      .slice(0, 400);
    throw new Error(`docker ${args[0]} failed: ${safe || `exit ${result.status}`}`);
  }
  return (result.stdout || "").trim();
}

function runNode(args, env, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: GATEWAY,
    env,
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    const safe = combined
      .replace(/postgres:\/\/[^\s"']+/gi, "postgres://[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [redacted]")
      .slice(0, 800);
    console.error(safe);
    fail(label, `${label} exited non-zero`);
  }
  return result.stdout || "";
}

function parseTestCounts(output) {
  const pass = /ℹ pass (\d+)/.exec(output);
  const failMatch = /ℹ fail (\d+)/.exec(output);
  const tests = /ℹ tests (\d+)/.exec(output);
  return {
    tests: tests ? Number(tests[1]) : null,
    pass: pass ? Number(pass[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
  };
}

function gitSourceSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function evidenceRoot() {
  const override = process.env.DEPP_RECOVERY_EVIDENCE_ROOT;
  if (override && override.trim() !== "") {
    return path.resolve(override);
  }
  return path.join(os.homedir(), "Downloads", "depp-local-recovery-drill");
}

function assertDisposableFixture(env) {
  if (!fs.existsSync(COMPOSE_FILE)) {
    fail("safetyCheck", "infra/docker-compose.yml missing");
  }

  const appMeta = redactedUrlMeta(env.DATABASE_URL);
  const migMeta = redactedUrlMeta(env.DATABASE_MIGRATION_URL);

  if (!["localhost", "127.0.0.1", "::1"].includes(appMeta.host)) {
    fail(
      "safetyCheck",
      `DATABASE_URL host must be loopback for disposable drill (got ${appMeta.host})`,
    );
  }
  if (appMeta.database !== SOURCE_DB) {
    fail(
      "safetyCheck",
      `DATABASE_URL database must be '${SOURCE_DB}' (got ${appMeta.database})`,
    );
  }
  if (appMeta.username !== "depp_app") {
    fail("safetyCheck", "DATABASE_URL must use local-dev role depp_app");
  }
  if (migMeta.username !== "depp_migrator") {
    fail(
      "safetyCheck",
      "DATABASE_MIGRATION_URL must use local-dev role depp_migrator",
    );
  }
  if (migMeta.database !== SOURCE_DB || migMeta.host !== appMeta.host) {
    fail("safetyCheck", "migration URL must target the same disposable database");
  }

  let inspectJson;
  try {
    inspectJson = docker("inspect", CONTAINER);
  } catch {
    fail(
      "safetyCheck",
      `container '${CONTAINER}' not found; start with: docker compose -f infra/docker-compose.yml up -d`,
    );
  }

  const inspect = JSON.parse(inspectJson)[0];
  const image = inspect.Config?.Image || "";
  report.fixture.image = image;
  if (!image.includes(EXPECTED_IMAGE_PREFIX) && !image.includes("postgres")) {
    fail("safetyCheck", `unexpected image for disposable fixture: ${image}`);
  }

  const names = inspect.Name || "";
  if (!names.includes(CONTAINER)) {
    fail("safetyCheck", "container name mismatch");
  }

  const mounts = inspect.Mounts || [];
  const hasVolume = mounts.some(
    (m) => m.Name === VOLUME || (m.Source || "").includes(VOLUME),
  );
  if (!hasVolume) {
    fail(
      "safetyCheck",
      `expected compose volume '${VOLUME}' attached to disposable container`,
    );
  }

  const health = inspect.State?.Health?.Status || inspect.State?.Status;
  if (health !== "healthy" && inspect.State?.Status !== "running") {
    fail("safetyCheck", `postgres container not ready (status=${health})`);
  }

  // Confirm we are not targeting a non-compose production-looking name.
  if (SOURCE_DB === "postgres" || SOURCE_DB === "template0") {
    fail("safetyCheck", "refusing to drill against a system database name");
  }

  try {
    report.fixture.postgresVersion = docker(
      "exec",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      SOURCE_DB,
      "-tAc",
      "show server_version",
    );
  } catch {
    fail("safetyCheck", "unable to read server_version from disposable container");
  }

  report.outcomes.safetyCheck = "pass";
  console.log(
    `recovery-drill safety: ok (container=${CONTAINER}, db=${SOURCE_DB}, image=${image})`,
  );
}

async function withPgClient(connectionString, fn) {
  const { Client } = require(path.join(GATEWAY, "node_modules", "pg"));
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function superuserUrl(env) {
  return (
    process.env.VERIFY_MIGRATE_SUPERUSER_URL ||
    process.env.DEPP_LOCAL_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres"
  );
}

async function dropRecoveryDb(adminUrl) {
  await withPgClient(adminUrl, async (client) => {
    await client.query(
      `drop database if exists ${RECOVERY_DB} with (force)`,
    );
  });
}

async function createRecoveryDb(adminUrl) {
  await dropRecoveryDb(adminUrl);
  await withPgClient(adminUrl, async (client) => {
    await client.query(`create database ${RECOVERY_DB}`);
  });
  await withPgClient(rewriteDb(adminUrl, RECOVERY_DB), async (client) => {
    await client.query(`grant connect on database ${RECOVERY_DB} to depp_app`);
    await client.query(
      `grant connect on database ${RECOVERY_DB} to depp_migrator`,
    );
  });
}

function backupDatabase() {
  // Dump inside the disposable container, then copy the custom-format file
  // outside the repository for the drill window (deleted during cleanup).
  docker(
    "exec",
    CONTAINER,
    "pg_dump",
    "-U",
    "postgres",
    "-Fc",
    "-f",
    "/tmp/depp-recovery-drill.dump",
    SOURCE_DB,
  );
  docker("cp", `${CONTAINER}:/tmp/depp-recovery-drill.dump`, backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size < 100) {
    fail("backup", "backup artifact missing or too small");
  }
  report.outcomes.backup = "pass";
  console.log("recovery-drill backup: ok (artifact outside repo; not logged)");
}

function restoreDatabase() {
  // Plain restore as local superuser preserves dump ownership/ACLs (depp_migrator
  // / depp_app). Avoid --role/--no-owner here — they emptied the target DB.
  const restore = spawnSync(
    "docker",
    [
      "exec",
      CONTAINER,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      RECOVERY_DB,
      "/tmp/depp-recovery-drill.dump",
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (restore.status !== 0) {
    const safe = `${restore.stderr || restore.stdout || ""}`
      .replace(/postgres:\/\/[^\s]+/gi, "postgres://[redacted]")
      .slice(0, 600);
    console.error(safe);
    // Continue to object verification — pg_restore can exit non-zero on warnings.
  }

  const check = docker(
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    RECOVERY_DB,
    "-tAc",
    "select count(*) from information_schema.tables where table_schema='public' and table_name in ('alerts','alert_audit_events','telemetry_events','tenants')",
  );
  if (Number(check.trim()) < 4) {
    fail("restore", "restored database missing required public tables");
  }

  const alertCount = docker(
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    RECOVERY_DB,
    "-tAc",
    "select count(*) from alerts",
  );
  if (Number(alertCount.trim()) < 1) {
    fail("restore", "restored database missing seeded alert rows");
  }

  docker(
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    RECOVERY_DB,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "grant connect on database depp_recovery_drill to depp_app; grant connect on database depp_recovery_drill to depp_migrator; grant usage on schema public to depp_app; grant usage, create on schema public to depp_migrator;",
  );

  report.outcomes.restore = "pass";
  console.log("recovery-drill restore: ok");
}

async function cleanupAll(adminUrl) {
  const errors = [];
  try {
    docker("exec", CONTAINER, "rm", "-f", "/tmp/depp-recovery-drill.dump");
  } catch {
    errors.push("container-tmp");
  }
  try {
    if (backupPath && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch {
    errors.push("host-backup");
  }
  try {
    await dropRecoveryDb(adminUrl);
  } catch {
    errors.push("drop-recovery-db");
  }
  if (errors.length > 0) {
    report.outcomes.cleanup = "fail";
    fail("cleanup", `cleanup incomplete: ${errors.join(", ")}`);
  }
  report.outcomes.cleanup = "pass";
  console.log("recovery-drill cleanup: ok");
}

function writeReport() {
  if (!reportPath) return;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`recovery-drill report: ${reportPath}`);
}

async function main() {
  report.sourceSha = gitSourceSha();
  const env = loadTestEnv();
  const adminUrl = superuserUrl(env);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .replace("Z", "Z");
  artifactDir = path.join(evidenceRoot(), `recovery-drill-${stamp}`);
  fs.mkdirSync(artifactDir, { recursive: true });
  report.artifactDir = artifactDir;
  backupPath = path.join(artifactDir, "depp.dump");
  statePath = path.join(artifactDir, "state-identifiers.json");
  reportPath = path.join(artifactDir, "report.json");

  console.log(`recovery-drill sourceSha=${report.sourceSha}`);
  console.log(`recovery-drill artifacts=${artifactDir}`);

  assertDisposableFixture(env);

  // Migrate source fixture.
  runNode(
    ["--import", "tsx", "src/db/migrate.ts", "latest"],
    { ...env, DATABASE_MIGRATION_URL: env.DATABASE_MIGRATION_URL },
    "migrate",
  );
  report.outcomes.migrate = "pass";
  console.log("recovery-drill migrate: ok");

  // Pre-backup vertical-slice suite on source DB.
  const preOut = runNode(
    [
      "--env-file=tests/test.env",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/db/tenant-isolation-immutable-audit.dbtest.ts",
    ],
    env,
    "preBackupVerticalSlice",
  );
  report.preBackupVerticalSlice = parseTestCounts(preOut);
  report.outcomes.preBackupVerticalSlice = "pass";
  console.log(
    `recovery-drill pre-backup vertical-slice: pass=${report.preBackupVerticalSlice.pass}`,
  );

  // Seed known dataset on source.
  runNode(
    ["--import", "tsx", "scripts/recovery-drill-seed-verify.ts", "--seed"],
    { ...env, RECOVERY_STATE_PATH: statePath },
    "seed",
  );
  report.outcomes.seed = "pass";

  backupDatabase();

  await createRecoveryDb(adminUrl);
  restoreDatabase();

  const recoveryAppUrl = rewriteDb(env.DATABASE_URL, RECOVERY_DB);
  const recoveryMigUrl = rewriteDb(env.DATABASE_MIGRATION_URL, RECOVERY_DB);

  // Post-restore data + HTTP verification (does not wipe restored rows).
  runNode(
    ["--import", "tsx", "scripts/recovery-drill-seed-verify.ts", "--verify"],
    {
      ...env,
      DATABASE_URL: recoveryAppUrl,
      DATABASE_MIGRATION_URL: recoveryMigUrl,
      RECOVERY_STATE_PATH: statePath,
    },
    "postRestoreVerify",
  );
  report.outcomes.postRestoreVerify = "pass";

  // Existing vertical-slice suite against restored DB (re-seeds; proves schema/grants/routes).
  const postOut = runNode(
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/db/tenant-isolation-immutable-audit.dbtest.ts",
    ],
    {
      ...env,
      DATABASE_URL: recoveryAppUrl,
      DATABASE_MIGRATION_URL: recoveryMigUrl,
      LOG_SILENT: "1",
      AUTH_EXPLICIT_ROLES_MODE: "compat",
    },
    "postRestoreVerticalSlice",
  );
  report.postRestoreVerticalSlice = parseTestCounts(postOut);
  report.outcomes.postRestoreVerticalSlice = "pass";
  console.log(
    `recovery-drill post-restore vertical-slice: pass=${report.postRestoreVerticalSlice.pass}`,
  );

  await cleanupAll(adminUrl);

  // Confirm original disposable fixture remains usable.
  const origOut = runNode(
    [
      "--env-file=tests/test.env",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/db/tenant-isolation-immutable-audit.dbtest.ts",
    ],
    env,
    "originalFixtureVerticalSlice",
  );
  report.originalFixtureVerticalSlice = parseTestCounts(origOut);
  report.outcomes.originalFixtureVerticalSlice = "pass";

  writeReport();
  console.log("recovery-drill: PASS (local disposable-Postgres evidence only)");
}

main().catch(async (err) => {
  try {
    const env = loadTestEnv();
    const adminUrl = superuserUrl(env);
    if (artifactDir) {
      try {
        await dropRecoveryDb(adminUrl);
      } catch {
        /* ignore */
      }
      try {
        if (backupPath && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      } catch {
        /* ignore */
      }
      try {
        docker("exec", CONTAINER, "rm", "-f", "/tmp/depp-recovery-drill.dump");
      } catch {
        /* ignore */
      }
      report.outcomes.cleanup =
        report.outcomes.cleanup === "pass" ? "pass" : "attempted";
      writeReport();
    }
  } catch {
    /* ignore nested cleanup errors */
  }
  console.error(
    err instanceof Error ? err.message : "recovery-drill failed",
  );
  process.exit(1);
});
