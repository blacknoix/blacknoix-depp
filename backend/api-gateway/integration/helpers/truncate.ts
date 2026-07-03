import { getIntegrationPrisma } from './prisma';

/**
 * FK-safe wipe of application tables between integration tests.
 * Child-first order; CASCADE handles remaining dependencies.
 * Reusable by tenant-overview, correlation v2, and future integration suites.
 */
export async function truncateAllIntegrationTables(): Promise<void> {
  const prisma = getIntegrationPrisma();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "alerts",
      "telemetry_events",
      "refresh_tokens",
      "agents",
      "users",
      "tenants"
    RESTART IDENTITY CASCADE;
  `);
}
