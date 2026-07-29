import { createAuthStrategy } from "./auth/auth-mode";
import { resolveJwtConfig } from "./auth/jwt/config";
import { resolveOidcConfig } from "./auth/oidc/config";
import { createRemoteOidcLoginService } from "./auth/oidc/remote";
import { createDbInitiationStore } from "./auth/oidc/store-db";
import { createAuthService } from "./auth/service";
import { createAgentsRepository } from "./agents/repository";
import { createAgentsService } from "./agents/service";
import { createApp } from "./app";
import { env } from "./config/env";
import { createKysely } from "./db/kysely";
import { closePool, createDatabaseHealthCheck, createPool } from "./db/pool";
import { logLifecycle } from "./lib/log";
import { createSessionsRepository } from "./sessions/repository";
import { createTenantsRepository } from "./tenants/repository";
import { createTelemetryRepository } from "./telemetry/repository";
import { createTelemetryService } from "./telemetry/service";
import { createCorrelationFindingsRepository } from "./correlation/repository";
import { createFindingSuppressionsRepository } from "./correlation/suppression-repository";
import { createCorrelationService } from "./correlation/service";
import { createFindingSharedViewsRepository } from "./findings-views/repository";
import { createUsersRepository } from "./users/repository";
import { createDeviceIdentityRepository } from "./threat-events/device-identity-repository";
import { createDeviceIdentityService } from "./threat-events/device-identity";
import { createThreatEventsRepository } from "./threat-events/repository";
import { createDevSingleNodeFinalizer } from "./threat-events/finality";
import { createInMemoryGossip } from "./threat-events/gossip";
import { createThreatEventService } from "./threat-events/service";

/**
 * How long to wait for in-flight requests to finish before forcing exit.
 * Without a cap, a single hung request keeps the process alive until the
 * orchestrator SIGKILLs it.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * How often to reap keep-alive connections that have gone idle during shutdown.
 * See the reaper in shutdown() for why a single sweep is not enough.
 */
const IDLE_REAP_INTERVAL_MS = 100;

// Creating the pool does not connect: `pg` connects lazily on first use, so an
// unavailable database does not prevent startup. /health reports the state.
const pool = env.databaseUrl ? createPool(env.databaseUrl) : undefined;

// Kysely wraps the same pool; the repositories are the tenant-scoped data path.
// Without a database, dependent routes fail closed.
const db = pool ? createKysely(pool) : undefined;
const tenants = db ? createTenantsRepository(db) : undefined;
const users = db ? createUsersRepository(db) : undefined;
const sessions = db ? createSessionsRepository(db) : undefined;
const agents = db ? createAgentsRepository(db) : undefined;
const telemetry = db ? createTelemetryRepository(db) : undefined;
const findings = db ? createCorrelationFindingsRepository(db) : undefined;
const suppressions = db ? createFindingSuppressionsRepository(db) : undefined;
const sharedViews = db ? createFindingSharedViewsRepository(db) : undefined;
const deviceIdentities = db ? createDeviceIdentityRepository(db) : undefined;
const deviceIdentityService = deviceIdentities
  ? createDeviceIdentityService({ deviceIdentities })
  : undefined;
const threatEventsRepo = db ? createThreatEventsRepository(db) : undefined;
const threatEventService =
  deviceIdentities && threatEventsRepo && findings
    ? createThreatEventService({
        deviceIdentities,
        threatEvents: threatEventsRepo,
        findings,
        finality: createDevSingleNodeFinalizer(),
        gossip: createInMemoryGossip(),
        correlationBridgeEnabled: env.correlationBridgeEnabled,
        correlationBridgeDisabledTenants: env.correlationBridgeDisabledTenants,
        correlationBridgeForceEnabledTenants:
          env.correlationBridgeForceEnabledTenants,
        correlationBridgeCoverageAutoDisable:
          env.correlationBridgeCoverageAutoDisable,
        correlationBridgeCoveragePolicy: {
          threshold: env.correlationBridgeCoverageThreshold,
          soakMs: env.correlationBridgeCoverageSoakHours * 60 * 60 * 1000,
          minFindings: env.correlationBridgeCoverageMinFindings,
        },
      })
    : undefined;
const correlationService =
  telemetry && findings && suppressions && threatEventService
    ? createCorrelationService({
        telemetry,
        findings,
        suppressions,
        threatEvents: threatEventService,
      })
    : undefined;
const telemetryService = telemetry
  ? createTelemetryService({
      telemetry,
      ...(correlationService ? { correlation: correlationService } : {}),
    })
  : undefined;

// Resolved at startup so AUTH_MODE=jwt with invalid/missing JWT config fails to
// boot rather than serving requests it cannot verify. When AUTH_MODE is not jwt
// but JWT_* is present (e.g. local agent exchange under dev-header), resolve it
// too — a partial JWT config still fails closed via resolveJwtConfig.
const jwtConfig =
  env.authMode === "jwt" || Boolean(process.env.JWT_ACCESS_SECRET?.trim())
    ? resolveJwtConfig(process.env)
    : undefined;

// The auth service needs both persistence and signing; without either, the auth
// routes report unavailable rather than pretending to work.
const authService =
  users && sessions && jwtConfig
    ? createAuthService({ users, sessions, jwtConfig })
    : undefined;

const agentsService = agents
  ? createAgentsService({
      agents,
      ...(jwtConfig ? { jwtConfig } : {}),
    })
  : undefined;

// Resolved at startup: an enabled-but-misconfigured provider fails to boot.
// undefined means OIDC login is not enabled. The callback also needs the auth
// service (to mint DEPP tokens), so without it the route reports unavailable.
const oidcConfig = resolveOidcConfig(process.env);
// Postgres-backed initiation store: HA single-use + TTL semantics across
// restarts and instances (see store-db.ts). OIDC requires the auth service,
// which requires the database, so `db` is present whenever oidc is wired.
const oidc =
  oidcConfig && authService && db
    ? {
        loginService: createRemoteOidcLoginService(
          oidcConfig,
          createDbInitiationStore(db),
        ),
      }
    : undefined;

const app = createApp({
  jsonBodyLimit: env.jsonBodyLimit,
  authStrategy: createAuthStrategy(env.authMode, { jwtConfig }),
  checkDatabase: createDatabaseHealthCheck(pool),
  lookupTenant: tenants?.findById,
  authService,
  oidc,
  telemetryService,
  telemetryBatchMaxEvents: env.telemetryBatchMaxEvents,
  agentsService,
  deviceIdentities: deviceIdentityService,
  threatEventService,
  correlationService,
  sharedViews,
});

const server = app.listen(env.port, () => {
  logLifecycle("info", "server_started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
    authMode: env.authMode,
    database: pool ? "configured" : "not_configured",
    pid: process.pid,
  });
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  // A second Ctrl+C during shutdown must not restart the sequence.
  if (shuttingDown) {
    logLifecycle("warn", "shutdown_already_in_progress", { signal });
    return;
  }

  shuttingDown = true;
  logLifecycle("info", "shutdown_started", { signal });

  const forceExit = setTimeout(() => {
    logLifecycle("error", "shutdown_timeout", {
      signal,
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Do not let the timer itself hold the event loop open once we finish early.
  forceExit.unref();

  // server.close() waits for every open socket, including keep-alive sockets
  // sitting idle. Sweeping once at shutdown only catches connections idle at
  // that instant: a request still in flight becomes idle when it finishes, and
  // would then hold the process for the full keep-alive timeout. So we sweep
  // repeatedly until close completes, which reaps each connection as it drains
  // while never touching one that is actively serving a request.
  const reapIdle = setInterval(() => {
    server.closeIdleConnections();
  }, IDLE_REAP_INTERVAL_MS);

  reapIdle.unref();
  server.closeIdleConnections();

  // Stops accepting new connections; the callback fires once all existing
  // connections have ended.
  server.close((err) => {
    clearTimeout(forceExit);
    clearInterval(reapIdle);

    if (err) {
      logLifecycle("error", "shutdown_failed", {
        signal,
        errorName: err.name,
        errorMessage: err.message,
      });
      process.exit(1);
    }

    // Drain the pool only after in-flight requests have finished, so a request
    // is never cut off from the database mid-flight. closePool never rejects.
    void closePool(pool).then(() => {
      logLifecycle("info", "shutdown_complete", { signal });
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
