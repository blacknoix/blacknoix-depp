import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";

import { LocalMigrationProvider } from "../../src/db/migration-provider";

/**
 * Runs with no database: it exercises only migration discovery and loading.
 *
 * The point is to guard the cross-platform import path (pathToFileURL) that
 * FileMigrationProvider got wrong on Windows. This code path is identical on
 * every OS, so a POSIX CI run still protects the Windows fix from regressing.
 */
describe("LocalMigrationProvider", () => {
  const migrationsFolder = path.join(__dirname, "..", "..", "src", "db", "migrations");

  it("discovers migration modules and loads their up/down functions", async () => {
    const provider = new LocalMigrationProvider(migrationsFolder);

    const migrations = await provider.getMigrations();
    const names = Object.keys(migrations);

    assert.ok(
      names.includes("001_tenants_and_agents"),
      `expected 001_tenants_and_agents, got: ${names.join(", ") || "(none)"}`,
    );

    for (const name of names) {
      assert.equal(typeof migrations[name].up, "function", `${name}.up`);
    }
  });
});
