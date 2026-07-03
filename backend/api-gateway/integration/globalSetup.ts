import { execSync } from 'child_process';
import path from 'path';

const DEFAULT_DATABASE_URL = 'postgresql://test:test@localhost:5432/depp_test';

/**
 * Apply Prisma migrations before the integration suite runs.
 * Uses migrate deploy — the same path as production — now that baseline_auth
 * creates tenants/users/refresh_tokens before later migrations reference them.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;

  const apiGatewayRoot = path.resolve(__dirname, '..');

  execSync('npx prisma migrate deploy', {
    cwd: apiGatewayRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
