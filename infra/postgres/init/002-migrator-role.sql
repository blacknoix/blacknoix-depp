-- Creates depp_migrator: the role that owns schema objects and runs migrations.
--
-- Runs once, on first initialisation of an empty data directory, after
-- 001-app-role.sql. Changing it requires recreating the volume:
--   docker compose -f infra/docker-compose.yml down -v
--
-- LOCAL DEVELOPMENT ONLY. The password is a well-known local default for a
-- disposable container. Production roles are provisioned by infrastructure.
--
-- NOSUPERUSER and NOBYPASSRLS are deliberate. With FORCE ROW LEVEL SECURITY a
-- non-superuser table owner is still subject to its own policies, whereas a
-- superuser bypasses RLS unconditionally. Making the owner a non-superuser role
-- keeps a superuser out of the table-ownership path entirely (ADR-0004).

DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'depp_migrator') THEN
    CREATE ROLE depp_migrator
      LOGIN
      PASSWORD 'depp_migrator_local_dev_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  END IF;
END
$$;

DO
$$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO depp_migrator', current_database());
END
$$;

-- The migrator creates and owns objects in schema public. Since PostgreSQL 15
-- the public schema does not grant CREATE to PUBLIC, so it must be explicit.
GRANT USAGE, CREATE ON SCHEMA public TO depp_migrator;

-- The application role only uses the schema; per-table DML grants are issued in
-- the migrations that create each table.
GRANT USAGE ON SCHEMA public TO depp_app;
