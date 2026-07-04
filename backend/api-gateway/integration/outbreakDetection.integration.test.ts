import { runOutbreakDetection } from '../src/services/outbreakDetectionService';
import { getIntegrationPrisma, disconnectIntegrationPrisma } from './helpers/prisma';
import { createAgent, createAlert, createTenant, createUser } from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

const INDICATOR = 'deadbeef'.repeat(8);

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

describe('runOutbreakDetection integration', () => {
  it('persists one outbreak incident and upserts idempotently on double run', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agents = await Promise.all(
      [1, 2, 3].map((n) =>
        createAgent({
          tenantId: tenant.id,
          enrolledByUserId: user.id,
          displayName: `agent-${n}`,
        })
      )
    );

    const base = Date.now() - 2 * 60 * 60 * 1000;
    for (let i = 0; i < agents.length; i += 1) {
      await createAlert({
        tenantId: tenant.id,
        agentId: agents[i].id,
        indicator: INDICATOR,
        ruleId: 'malware-prefix',
        createdAt: new Date(base + i * 30 * 60 * 1000),
        title: `Malware on agent-${i + 1}`,
      });
    }

    const firstRun = await runOutbreakDetection(tenant.id);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].agentCount).toBe(3);
    expect(firstRun[0].agentIds.sort()).toEqual(agents.map((a) => a.id).sort());
    expect(firstRun[0].indicator).toBe(INDICATOR);

    const prisma = getIntegrationPrisma();
    expect(await prisma.correlatedIncident.count()).toBe(1);

    const secondRun = await runOutbreakDetection(tenant.id);
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0].id).toBe(firstRun[0].id);
    expect(await prisma.correlatedIncident.count()).toBe(1);

    const stored = await prisma.correlatedIncident.findUnique({ where: { id: firstRun[0].id } });
    expect(stored).not.toBeNull();
    expect(stored!.agentCount).toBe(3);
    expect(stored!.type).toBe('malware_outbreak');
  });
});
