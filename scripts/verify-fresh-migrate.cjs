#!/usr/bin/env node
/**
 * Fresh-database migration verification.
 *
 * Creates an empty database, grants local-dev roles, runs migrate:latest, and
 * asserts the public tables match the branch schema contract (001–016).
 *
 * Requires a superuser URL (default: postgres local-dev from docker-compose).
 *
 *   VERIFY_MIGRATE_SUPERUSER_URL=postgres://postgres:postgres@localhost:5432/postgres
 *   node scripts/verify-fresh-migrate.cjs
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GATEWAY = path.join(ROOT, "backend", "api-gateway");
const { Client } = require(path.join(GATEWAY, "node_modules", "pg"));
const DB_NAME = "depp_migrate_verify";

const EXPECTED_TABLES = [
  "agent_credentials",
  "agents",
  "correlation_findings",
  "device_identities",
  "finding_shared_views",
  "finding_suppressions",
  "oidc_initiations",
  "refresh_tokens",
  "sessions",
  "telemetry_events",
  "tenants",
  "threat_events",
  "users",
];

const EXPECTED_MIGRATIONS = [
  "001_tenants_and_agents",
  "002_tenants_rls",
  "003_users",
  "004_sessions_refresh_tokens",
  "005_oidc_initiations",
  "006_telemetry_events",
  "007_agent_credentials",
  "008_correlation_findings",
  "009_findings_lifecycle",
  "010_finding_suppressions",
  "011_finding_shared_views",
  "012_finding_investigation_intent",
  "013_device_identities",
  "014_threat_events",
  "015_finding_detection_source",
  "016_threat_event_detection_source",
];

function superuserUrl() {
  return (
    process.env.VERIFY_MIGRATE_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres"
  );
}

function rewriteDb(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function main() {
  const adminUrl = superuserUrl();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const dbAdmin = new Client({
    connectionString: rewriteDb(adminUrl, DB_NAME),
  });
  await dbAdmin.connect();

  await dbAdmin.query(`
    do $$
    begin
      if not exists (select from pg_roles where rolname = 'depp_app') then
        create role depp_app login password 'depp_app_local_dev_only'
          nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
      if not exists (select from pg_roles where rolname = 'depp_migrator') then
        create role depp_migrator login password 'depp_migrator_local_dev_only'
          nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
    end $$;
  `);
  await dbAdmin.query(`grant connect on database ${DB_NAME} to depp_app`);
  await dbAdmin.query(`grant connect on database ${DB_NAME} to depp_migrator`);
  await dbAdmin.query(`grant usage, create on schema public to depp_migrator`);
  await dbAdmin.query(`grant usage on schema public to depp_app`);
  await dbAdmin.end();

  const migrationUrl = rewriteDb(
    "postgres://depp_migrator:depp_migrator_local_dev_only@localhost:5432/postgres",
    DB_NAME,
  );

  execFileSync(
    process.execPath,
    ["--import", "tsx", "src/db/migrate.ts", "latest"],
    {
      cwd: GATEWAY,
      env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
      stdio: "inherit",
    },
  );

  const check = new Client({ connectionString: migrationUrl });
  await check.connect();

  const { rows: tableRows } = await check.query(
    `select tablename from pg_tables
     where schemaname = 'public'
       and tablename not like 'kysely_%'
     order by tablename`,
  );
  const tables = tableRows.map((r) => r.tablename);
  if (JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES)) {
    console.error("fresh migrate table mismatch");
    console.error("expected", EXPECTED_TABLES);
    console.error("actual  ", tables);
    process.exit(1);
  }

  const { rows: migRows } = await check.query(
    `select name from kysely_migration order by name`,
  );
  const migrations = migRows.map((r) => r.name);
  if (JSON.stringify(migrations) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
    console.error("fresh migrate migration-name mismatch");
    console.error("expected", EXPECTED_MIGRATIONS);
    console.error("actual  ", migrations);
    process.exit(1);
  }

  const { rows: cols } = await check.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'correlation_findings'
       and column_name in ('owner_user_id', 'operator_note', 'status', 'detection_source')
     order by column_name`,
  );
  const colNames = cols.map((r) => r.column_name);
  for (const required of [
    "owner_user_id",
    "operator_note",
    "status",
    "detection_source",
  ]) {
    if (!colNames.includes(required)) {
      console.error(`missing correlation_findings.${required}`);
      process.exit(1);
    }
  }

  const { rows: threatCols } = await check.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'threat_events'
       and column_name = 'detection_source'`,
  );
  if (threatCols.length !== 1) {
    console.error("missing threat_events.detection_source");
    process.exit(1);
  }

  await check.end();

  const cleanup = new Client({ connectionString: adminUrl });
  await cleanup.connect();
  await cleanup.query(`drop database if exists ${DB_NAME} with (force)`);
  await cleanup.end();

  console.log("fresh migrate verification: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
