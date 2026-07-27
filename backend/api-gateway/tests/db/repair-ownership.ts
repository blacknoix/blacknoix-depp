/**
 * One-shot repair: reassign public schema objects from postgres to depp_migrator.
 *
 * Migrations must run as depp_migrator (ADR-0004). If they were accidentally run
 * as the postgres superuser, table ownership lands on postgres, resetSchema
 * fails for depp_migrator, and any DATABASE_URL that also uses a superuser
 * bypasses RLS — exactly the isolation failures the dbtest suite catches.
 *
 * LOCAL DEV ONLY. Usage:
 *   npx tsx tests/db/repair-ownership.ts
 */
import { Pool } from "pg";

const SUPER_URL =
  process.env.DATABASE_SUPER_URL ??
  "postgres://postgres:postgres@localhost:5432/depp";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: SUPER_URL, max: 1 });
  try {
    const who = await pool.query(
      "select current_user as role, current_setting('is_superuser') as super",
    );
    if (who.rows[0]?.super !== "on") {
      throw new Error(
        "repair-ownership must connect as a superuser (default: postgres)",
      );
    }

    await pool.query(`
      do $repair$
      declare
        r record;
      begin
        for r in
          select c.relname as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and pg_get_userbyid(c.relowner) = 'postgres'
        loop
          execute format('alter table public.%I owner to depp_migrator', r.name);
        end loop;

        for r in
          select c.relname as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'S'
            and pg_get_userbyid(c.relowner) = 'postgres'
        loop
          execute format('alter sequence public.%I owner to depp_migrator', r.name);
        end loop;

        for r in
          select p.oid::regprocedure as sig
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and pg_get_userbyid(p.proowner) = 'postgres'
        loop
          execute format('alter function %s owner to depp_migrator', r.sig);
        end loop;
      end
      $repair$;
    `);

    const owners = await pool.query(`
      select c.relname as table, pg_get_userbyid(c.relowner) as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1
    `);
    const bad = owners.rows.filter((row) => row.owner !== "depp_migrator");
    if (bad.length > 0) {
      throw new Error(
        `ownership repair incomplete: ${bad
          .map((row) => `${row.table}:${row.owner}`)
          .join(", ")}`,
      );
    }
    console.log(
      JSON.stringify({
        ok: true,
        tables: owners.rows.length,
        owner: "depp_migrator",
      }),
    );
  } finally {
    await pool.end();
  }
}

void main();
