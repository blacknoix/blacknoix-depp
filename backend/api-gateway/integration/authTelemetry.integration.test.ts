import {
  AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
  AUTH_REMOTE_LOGON_EVENT_TYPE,
} from '../src/types/authTelemetry';
import { listAuthTelemetryForTenant } from '../src/services/telemetryService';
import { disconnectIntegrationPrisma } from './helpers/prisma';
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

describe('auth telemetry integration', () => {
  it('persists and queries structured auth columns by account and window', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agentA = await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      displayName: 'host-a',
    });
    const agentB = await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      displayName: 'host-b',
    });

    const inWindow = new Date('2026-06-15T10:00:00.000Z');
    const outOfWindow = new Date('2026-06-10T10:00:00.000Z');
    const windowStart = new Date('2026-06-15T00:00:00.000Z');
    const windowEnd = new Date('2026-06-16T00:00:00.000Z');

    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agentA.id,
      eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
      occurredAt: inWindow,
      payload: {
        account: ACCOUNT,
        targetHost: 'workstation-a',
        sourceHost: 'jumpbox-1',
        logonType: 'remoteInteractive',
      },
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agentB.id,
      eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
      occurredAt: inWindow,
      payload: {
        account: ACCOUNT,
        targetHost: 'workstation-b',
      },
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agentA.id,
      eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
      occurredAt: inWindow,
      payload: {
        account: ACCOUNT,
        host: 'workstation-a',
        grantedTo: 'admin',
        mechanism: 'sudo',
      },
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agentB.id,
      eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
      occurredAt: outOfWindow,
      payload: {
        account: ACCOUNT,
        targetHost: 'old-host',
      },
    });

    const logons = await listAuthTelemetryForTenant(tenant.id, {
      eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
      authAccount: ACCOUNT,
      since: windowStart,
      until: windowEnd,
      limit: 50,
    });

    expect(logons).toHaveLength(2);
    expect(new Set(logons.map((e) => e.authHost))).toEqual(
      new Set(['workstation-a', 'workstation-b'])
    );
    expect(logons.every((e) => e.authAccount === ACCOUNT)).toBe(true);
    expect(logons.find((e) => e.authHost === 'workstation-a')?.authSourceHost).toBe('jumpbox-1');

    const privilege = await listAuthTelemetryForTenant(tenant.id, {
      eventType: AUTH_PRIVILEGE_CHANGE_EVENT_TYPE,
      authAccount: ACCOUNT,
      since: windowStart,
      until: windowEnd,
      limit: 50,
    });

    expect(privilege).toHaveLength(1);
    expect(privilege[0].authGrantedTo).toBe('admin');
    expect(privilege[0].authHost).toBe('workstation-a');
  });
});
