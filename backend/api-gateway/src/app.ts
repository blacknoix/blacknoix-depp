import express from "express";

import type { AuthStrategy } from "./auth/principal";
import { devHeaderStrategy } from "./auth/strategies/dev-header";
import { authenticate } from "./middleware/authenticate";
import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logger";
import { notFound } from "./middleware/not-found";
import { requestId } from "./middleware/request-id";
import { requireTenant } from "./middleware/tenant-context";

import type { OidcLoginService } from "./auth/oidc/login";
import type { AuthService } from "./auth/service";
import type { AgentsService } from "./agents/service";
import type { DatabaseHealthCheck } from "./db/pool";
import { createAgentsRouter } from "./routes/agents";
import { createAuthRouter } from "./routes/auth";
import { createHealthRouter } from "./routes/health";
import rootRouter from "./routes/root";
import { createTenantsRouter } from "./routes/tenants";
import { createTelemetryRouter } from "./routes/telemetry";
import type { TenantLookup } from "./tenants/repository";
import type { TelemetryService } from "./telemetry/service";
<<<<<<< HEAD
=======
import type { CorrelationService } from "./correlation/service";
import type { FindingSharedViewsRepository } from "./findings-views/repository";
>>>>>>> 12b026d (feat: deepen Findings operator workflow with views, jump bar, and attention)

/**
 * Maximum accepted JSON request body.
 *
 * This is the single source of truth for the default: config/env.ts reports an
 * unset BODY_LIMIT_DEFAULT as undefined rather than carrying a second copy that
 * could drift from this one.
 *
 * 100kb matches Express's own implicit default, so making the limit explicit
 * changes no behavior. It is a deliberately conservative control-plane value.
 */
const DEFAULT_JSON_BODY_LIMIT = "100kb";

export interface AppOptions {
  /** Accepts a `bytes` string such as "100kb" or "1mb", or a raw byte count. */
  jsonBodyLimit?: string | number;

  /**
   * How requests are turned into an authenticated principal. Defaults to the
   * development header stand-in; index.ts selects it from AUTH_MODE, which
   * refuses to allow an unverified strategy in production.
   */
  authStrategy?: AuthStrategy;

  /**
   * Database reachability probe surfaced by /health. Omitted means "no database
   * configured"; createApp itself never opens a connection, which keeps it free
   * of side effects for tests.
   */
  checkDatabase?: DatabaseHealthCheck;

  /**
   * Resolves the authenticated tenant to its registry record for
   * /v1/tenants/me. Omitted means the route fails closed; index.ts wires it to
   * the Kysely-backed repository when a database is configured.
   */
  lookupTenant?: TenantLookup;

  /**
   * Backs POST /v1/auth/refresh (and future auth routes). Omitted means those
   * routes fail closed; index.ts wires it only when a database and JWT
   * configuration are both present.
   */
  authService?: AuthService;

  /**
   * Upstream OIDC callback verification for /v1/auth/oidc/callback. Omitted means
   * that route fails closed; index.ts wires it only when OIDC is configured and
   * the auth service is available.
   */
  oidc?: {
    loginService: OidcLoginService;
  };

  /**
   * Backs POST /v1/telemetry/events. Omitted means the route fails closed;
   * index.ts wires it when a database is configured.
   */
  telemetryService?: TelemetryService;

  /**
   * Max events for POST /v1/telemetry/events/batch. Validated in env when set.
   */
  telemetryBatchMaxEvents?: number;

  /**
   * Backs agent enrollment/revoke and credential exchange. Omitted means those
   * routes fail closed; index.ts wires it when database + JWT config are present.
   */
  agentsService?: AgentsService;
<<<<<<< HEAD
=======

  /**
   * Backs GET /v1/findings. Omitted means the route fails closed; index.ts
   * wires it when a database (and correlation) is configured.
   */
  correlationService?: CorrelationService;

  /**
   * Backs GET/POST/DELETE /v1/findings/views (tenant shared views). Omitted
   * means those routes fail closed.
   */
  sharedViews?: FindingSharedViewsRepository;
>>>>>>> 12b026d (feat: deepen Findings operator workflow with views, jump bar, and attention)
}

export function createApp(options: AppOptions = {}) {
  const jsonBodyLimit = options.jsonBodyLimit ?? DEFAULT_JSON_BODY_LIMIT;
  const authStrategy = options.authStrategy ?? devHeaderStrategy;

  const app = express();

  // Middleware order is deliberate:
  //   1. requestId  - every downstream layer and error response needs a correlation ID.
  //   2. logger     - registered before body parsing so durationMs covers it and
  //                   malformed-body requests are still logged.
  //   3. json       - parse failures are surfaced by the centralized error handler.
  //   4. authenticate - resolves the principal without rejecting; the
  //                   requireTenant guard is applied per-route at the mount
  //                   point below.
  app.use(requestId);
  app.use(requestLogger);
  // NOTE: this limit bounds only bodies that express.json() actually parses,
  // i.e. requests with a JSON content type. A large text/plain or octet-stream
  // body is not constrained by it. Bounding request size in general belongs at
  // the reverse proxy / ingress.
  //
  // NOTE: body-parser skips a request whose body another parser already read.
  // If a route ever needs a different limit (telemetry ingestion), its parser
  // must be mounted BEFORE this fallback, or this one will reject the request
  // first and the route-specific limit will never apply.
  app.use(express.json({ limit: jsonBodyLimit }));
  app.use(authenticate(authStrategy));

  // Infrastructure routes: no tenant context required.
  app.use("/", rootRouter);
  app.use("/health", createHealthRouter({ checkDatabase: options.checkDatabase }));

  // Auth endpoints are NOT behind requireTenant: refresh / agent token exchange
  // present an opaque credential in the body, not an authenticated principal.
  app.use(
    "/v1/auth",
    createAuthRouter({
      authService: options.authService,
      agentsService: options.agentsService,
      oidc: options.oidc,
    }),
  );

  // Versioned API surface: tenant-scoped.
  app.use(
    "/v1/tenants",
    requireTenant,
    createTenantsRouter({ lookupTenant: options.lookupTenant }),
  );

  // Agent enrollment (register + revoke). Credential exchange is under /v1/auth.
  app.use(
    "/v1/agents",
    requireTenant,
    createAgentsRouter({ agentsService: options.agentsService }),
  );

  // Telemetry ingest: requires an agent principal (agent JWT / x-agent-id).
  app.use(
    "/v1/telemetry",
    requireTenant,
    createTelemetryRouter({
      telemetryService: options.telemetryService,
      batchMaxEvents: options.telemetryBatchMaxEvents,
    }),
  );

<<<<<<< HEAD
=======
  // Correlation findings: narrow operator read surface (not an alert console).
  app.use(
    "/v1/findings",
    requireTenant,
    createFindingsRouter({
      correlationService: options.correlationService,
      sharedViews: options.sharedViews,
    }),
  );

>>>>>>> 12b026d (feat: deepen Findings operator workflow with views, jump bar, and attention)
  // Terminal handlers, in order.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
