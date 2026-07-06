import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { AGENT_TOKEN_PREFIX } from '../src/lib/agentToken';
import { hashAgentToken } from '../src/services/agentService';
import { AUTH_REMOTE_LOGON_EVENT_TYPE } from '../src/types/authTelemetry';
import { TELEMETRY_SCHEMA_VERSION } from '../src/lib/telemetryContract';
import { disconnectIntegrationPrisma, getIntegrationPrisma } from './helpers/prisma';
import { createAgent, createTenant, createUser } from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

const app = createApp();

function buildAgentToken(): string {
  return `${AGENT_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

describe('telemetry contract ingest integration', () => {
  async function seedAgentWithToken() {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const enrollmentToken = buildAgentToken();
    const agent = await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      tokenHash: hashAgentToken(enrollmentToken),
      tokenPrefix: enrollmentToken.slice(0, 17),
    });
    return { tenant, agent, enrollmentToken };
  }

  it('accepts valid auth.remote_logon and persists auth columns via existing extractors', async () => {
    const { tenant, agent, enrollmentToken } = await seedAgentWithToken();

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send([
        {
          eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
          severity: 'medium',
          occurredAt: '2026-06-15T10:00:00.000Z',
          schemaVersion: TELEMETRY_SCHEMA_VERSION,
          payload: {
            account: 'CORP\\jdoe',
            targetHost: 'workstation-a',
            sourceHost: 'jumpbox-1',
          },
        },
      ]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1 });

    const stored = await getIntegrationPrisma().telemetryEvent.findMany({
      where: { tenantId: tenant.id, agentId: agent.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      authAccount: 'CORP\\jdoe',
      authHost: 'workstation-a',
      authSourceHost: 'jumpbox-1',
      authGrantedTo: null,
    });
  });

  it('rejects malformed auth.remote_logon with 400', async () => {
    const { enrollmentToken } = await seedAgentWithToken();

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send([
        {
          eventType: AUTH_REMOTE_LOGON_EVENT_TYPE,
          severity: 'medium',
          occurredAt: '2026-06-15T10:00:00.000Z',
          payload: { account: 'jdoe' },
        },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/targetHost/)])
    );

    expect(await getIntegrationPrisma().telemetryEvent.count()).toBe(0);
  });

  it('accepts novel event types as opaque telemetry', async () => {
    const { tenant, agent, enrollmentToken } = await seedAgentWithToken();

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', `Bearer ${enrollmentToken}`)
      .send([
        {
          eventType: 'custom.sensor.reading',
          severity: 'info',
          occurredAt: '2026-06-15T10:00:00.000Z',
          payload: { sensorId: 'temp-1', valueCelsius: 42, unvalidated: true },
        },
      ]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1 });

    const stored = await getIntegrationPrisma().telemetryEvent.findFirst({
      where: { tenantId: tenant.id, agentId: agent.id },
    });
    expect(stored?.eventType).toBe('custom.sensor.reading');
    expect(stored?.payload).toEqual({
      sensorId: 'temp-1',
      valueCelsius: 42,
      unvalidated: true,
    });
  });
});
