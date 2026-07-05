import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../src/types/authTelemetry';
import { runLateralMovementDetection } from '../src/services/lateralMovementDetectionService';
import { disconnectIntegrationPrisma, getIntegrationPrisma } from './helpers/prisma';
import {
  createAgent,
  createTelemetryEvent,
  createTenant,
  createUser,
} from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

const ACCOUNT = 'CORP\\jdoe';

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

describe('runLateralMovementDetection integration', () => {
  it('persists one lateral incident and upserts idempotently on double run', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agents = await Promise.all(
      ['host-a', 'host-b', 'host-c'].map((name) =>
        createAgent({
          tenantId: tenant.id,
          enrolledByUserId: user.id,
          displayName: name,
        })
      )
    );

    const base = Date.now() - 20 * 60 * 1000;
    const hosts = ['workstation-a', 'workstation-b', 'workstation-c'];
    for (let i = 0; i < hosts.length; i += 1) {
      await createTelemetryEvent({
        tenantId: tenant.id,
        agentId: agents[i].id,
        eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
        occurredAt: new Date(base + i * 5 * 60 * 1000),
        payload: {
          account: ACCOUNT,
          targetHost: hosts[i],
          sourceHost: 'jumpbox-1',
        },
      });
    }

    const lastLogon = new Date(base + 10 * 60 * 1000);
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agents[0].id,
      eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
      occurredAt: new Date(lastLogon.getTime() + 2 * 60 * 1000),
      payload: {
        account: ACCOUNT,
        host: 'workstation-c',
        grantedTo: 'admin',
      },
    });

    const firstRun = await runLateralMovementDetection(tenant.id);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].type).toBe('lateral_movement_privilege_escalation');
    expect(firstRun[0].indicator).toBe(ACCOUNT);
    expect(firstRun[0].agentCount).toBe(3);
    expect(firstRun[0].agentIds.sort()).toEqual(hosts.sort());
    expect(firstRun[0].escalatedAt).toBeDefined();

    const prisma = getIntegrationPrisma();
    expect(await prisma.correlatedIncident.count()).toBe(1);

    const secondRun = await runLateralMovementDetection(tenant.id);
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0].id).toBe(firstRun[0].id);
    expect(await prisma.correlatedIncident.count()).toBe(1);

    const stored = await prisma.correlatedIncident.findUnique({ where: { id: firstRun[0].id } });
    expect(stored!.type).toBe('lateral_movement_privilege_escalation');
    expect(stored!.lastSeen).toEqual(firstRun[0].escalatedAt!);
  });
});
