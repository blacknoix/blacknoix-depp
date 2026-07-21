import express from "express";

import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logger";
import { notFound } from "./middleware/not-found";
import { requestId } from "./middleware/request-id";
import { attachTenantContext, requireTenant } from "./middleware/tenant-context";

import healthRouter from "./routes/health";
import rootRouter from "./routes/root";
import tenantsRouter from "./routes/tenants";

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
}

export function createApp(options: AppOptions = {}) {
  const jsonBodyLimit = options.jsonBodyLimit ?? DEFAULT_JSON_BODY_LIMIT;

  const app = express();

  // Middleware order is deliberate:
  //   1. requestId  - every downstream layer and error response needs a correlation ID.
  //   2. logger     - registered before body parsing so durationMs covers it and
  //                   malformed-body requests are still logged.
  //   3. json       - parse failures are surfaced by the centralized error handler.
  //   4. tenant     - reads tenant identity without rejecting; the requireTenant
  //                   guard is applied per-route at the mount point below.
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
  app.use(attachTenantContext);

  // Infrastructure routes: no tenant context required.
  app.use("/", rootRouter);
  app.use("/health", healthRouter);

  // Versioned API surface: tenant-scoped.
  app.use("/v1/tenants", requireTenant, tenantsRouter);

  // Terminal handlers, in order.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
