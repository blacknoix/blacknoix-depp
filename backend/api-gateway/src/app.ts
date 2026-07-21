import express from "express";

import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logger";
import { notFound } from "./middleware/not-found";
import { requestId } from "./middleware/request-id";
import { attachTenantContext, requireTenant } from "./middleware/tenant-context";

import healthRouter from "./routes/health";
import rootRouter from "./routes/root";
import tenantsRouter from "./routes/tenants";

export function createApp() {
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
  app.use(express.json());
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
