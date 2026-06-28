/**
 * Jest mock for @prisma/client.
 * Provides a no-op PrismaClient so the module can be imported without
 * the real package installed. Tests that need Prisma behaviour mock
 * authService at a higher level and never reach this.
 */
const PrismaClient = jest.fn().mockImplementation(() => ({
  tenant: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  agent: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  telemetryEvent: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  alert: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
    telemetryEvent: { createMany: jest.fn() },
    agent: { update: jest.fn() },
    alert: { createMany: jest.fn() },
  })),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
}));

module.exports = { PrismaClient };
