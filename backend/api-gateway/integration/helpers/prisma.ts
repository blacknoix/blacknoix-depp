/**
 * Shared Prisma client for integration tests and helpers.
 * Uses DATABASE_URL from integration/setup.ts (depp_test Postgres).
 */
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function getIntegrationPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectIntegrationPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
