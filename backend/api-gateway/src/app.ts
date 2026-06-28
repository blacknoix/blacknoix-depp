import express, { ErrorRequestHandler } from 'express';
import { authRouter } from './routes/auth';
import { apiRouter } from './routes/api';
import { internalRouter } from './routes/internal';
import { telemetryRouter } from './routes/telemetry';
import { agentTrafficRouter } from './routes/agentTraffic';
import { env } from './config/env';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Health check (unauthenticated)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Auth routes: /auth/login, /auth/refresh, /auth/me
  app.use('/auth', authRouter);

  // Agent traffic (agent credential auth — not user JWT)
  app.use('/agent', agentTrafficRouter);
  app.use('/telemetry', express.json({ limit: '512kb' }), telemetryRouter);

  app.use(((err, _req, res, next) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    next(err);
  }) as ErrorRequestHandler);

  // Tenant-scoped API routes (authenticate + requireTenantContext by default)
  app.use('/api', apiRouter);

  // Operator metrics (admin+ JWT)
  app.use('/internal', internalRouter);

  return app;
}

// Only start the server when this file is the entry point (not during tests)
if (require.main === module) {
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`api-gateway listening on port ${env.port}`);
  });
}
