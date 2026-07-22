import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type { Migration, MigrationProvider } from "kysely/migration";

/** Migration modules look like `001_name.ts` / `001_name.js` — not decls or maps. */
const MIGRATION_FILE = /^\d+_.+\.(?:ts|js)$/;

/**
 * Loads migrations from a folder in a way that works on Windows as well as
 * POSIX.
 *
 * Kysely's built-in FileMigrationProvider dynamic-imports each file by its raw
 * filesystem path. On Windows an absolute path (C:\...) is rejected by the ESM
 * loader as ERR_UNSUPPORTED_ESM_URL_SCHEME, because import() requires a file://
 * URL for absolute paths. A POSIX path happens to be accepted, which is why the
 * built-in provider fails only on Windows. Converting each path with
 * pathToFileURL imports correctly on every platform.
 */
export class LocalMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationFolder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await fs.readdir(this.migrationFolder);
    const migrations: Record<string, Migration> = {};

    for (const entry of entries.sort()) {
      if (!MIGRATION_FILE.test(entry) || entry.endsWith(".d.ts")) {
        continue;
      }

      const fileUrl = pathToFileURL(path.join(this.migrationFolder, entry)).href;
      const loaded = (await import(fileUrl)) as Partial<Migration>;

      if (typeof loaded.up !== "function") {
        throw new Error(`Migration "${entry}" does not export an "up" function.`);
      }

      const name = entry.replace(/\.(?:ts|js)$/, "");
      migrations[name] = { up: loaded.up, down: loaded.down };
    }

    return migrations;
  }
}
