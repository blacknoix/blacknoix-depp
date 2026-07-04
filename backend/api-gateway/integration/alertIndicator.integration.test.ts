import { listAlerts } from '../src/services/alertService';
import { disconnectIntegrationPrisma } from './helpers/prisma';
import { createAgent, createAlert, createTenant, createUser } from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

describe('Alert.indicator integration', () => {
  it('round-trips indicator and supports filtering by it', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agent = await createAgent({ tenantId: tenant.id, enrolledByUserId: user.id });
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    await createAlert({
      tenantId: tenant.id,
      agentId: agent.id,
      indicator: hash,
      ruleId: 'malware-prefix',
      title: 'Malware event: malware.detected',
    });
    await createAlert({
      tenantId: tenant.id,
      agentId: agent.id,
      indicator: null,
      ruleId: 'severity-threshold',
      title: 'HIGH event: file.write',
    });

    const all = await listAlerts(tenant.id, { limit: 50 });
    expect(all).toHaveLength(2);
    const withIndicator = all.find((a) => a.indicator === hash);
    expect(withIndicator).toBeDefined();
    expect(withIndicator!.ruleId).toBe('malware-prefix');

    const filtered = await listAlerts(tenant.id, { limit: 50, indicator: hash });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].indicator).toBe(hash);
    expect(filtered[0].agentId).toBe(agent.id);
  });
});
