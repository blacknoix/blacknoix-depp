import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Postgres integration smoke', () => {
  it('connects to Postgres via the real PrismaClient', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it('round-trips a tenant row after migrations', async () => {
    const id = randomUUID();
    const name = `integration-smoke-${Date.now()}`;

    await prisma.tenant.create({
      data: { id, name },
    });

    const found = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    expect(found).toEqual({ id, name });

    await prisma.tenant.delete({ where: { id } });
  });
});
