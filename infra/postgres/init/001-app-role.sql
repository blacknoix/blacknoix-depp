-- Creates the least-privileged role that api-gateway connects as.
--
-- Runs once, on first initialisation of an empty data directory. If you change
-- this file you must recreate the volume for it to take effect:
--   docker compose -f infra/docker-compose.yml down -v
--
-- LOCAL DEVELOPMENT ONLY. The password below is a well-known local default for
-- a disposable container. Production roles are provisioned by infrastructure,
-- never by a committed file.
--
-- NOBYPASSRLS is the point of this role. Per ADR-0001 and ADR-0004, tenant
-- isolation is enforced by Row-Level Security, and RLS does not apply to
-- superusers or to a table's owner. The application must therefore connect as a
-- role that is neither. Migrations will run as a separate, more privileged role
-- (ADR-0004, slice B).
--
-- No table grants appear here because no tables exist yet. Grants land with the
-- schema in slice B.

DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'depp_app') THEN
    CREATE ROLE depp_app
      LOGIN
      PASSWORD 'depp_app_local_dev_only'
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
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO depp_app', current_database());
END
$$;
