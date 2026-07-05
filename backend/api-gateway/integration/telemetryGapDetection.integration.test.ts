import { runTelemetryGapDetection } from '../src/services/telemetryGapDetectionService';
import { GAP_WINDOW_MS } from '../src/types/correlationIncident';
import { disconnectIntegrationPrisma, getIntegrationPrisma } from './helpers/prisma';
import {
  createAgent,
  createAlert,
  createTelemetryEvent,
  createTenant,
  createUser,
} from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

const BASELINE_EVENTS = 240;
const GAP_NORMAL_EVENTS = 4;

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

async function seedBaselineVolume(
  tenantId: string,
  agentId: string,
  baselineStart: Date,
  alertTime: Date,
  count: number
): Promise<void> {
  const spanMs = alertTime.getTime() - baselineStart.getTime();
  for (let i = 0; i < count; i += 1) {
    const offset = Math.floor((spanMs * i) / count);
    await createTelemetryEvent({
      tenantId,
      agentId,
      occurredAt: new Date(baselineStart.getTime() + offset),
    });
  }
}

async function seedGapVolume(
  tenantId: string,
  agentId: string,
  alertTime: Date,
  count: number
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createTelemetryEvent({
      tenantId,
      agentId,
      occurredAt: new Date(alertTime.getTime() + (i + 1) * 60 * 1000),
    });
  }
}

describe('runTelemetryGapDetection integration', () => {
  it('fires for an isolated agent drop and upserts idempotently on double run', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const alertTime = new Date(Date.now() - GAP_WINDOW_MS - 5 * 60 * 1000);
    const baselineStart = new Date(alertTime.getTime() - 24 * 60 * 60 * 1000);

    const triggerAgent = await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      displayName: 'trigger',
    });
    const peers = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        createAgent({
          tenantId: tenant.id,
          enrolledByUserId: user.id,
          displayName: `peer-${n}`,
        })
      )
    );

    await seedBaselineVolume(tenant.id, triggerAgent.id, baselineStart, alertTime, BASELINE_EVENTS);
    await seedGapVolume(tenant.id, triggerAgent.id, alertTime, 0);

    for (const peer of peers) {
      await seedBaselineVolume(tenant.id, peer.id, baselineStart, alertTime, BASELINE_EVENTS);
      await seedGapVolume(tenant.id, peer.id, alertTime, GAP_NORMAL_EVENTS);
    }

    await createAlert({
      tenantId: tenant.id,
      agentId: triggerAgent.id,
      severity: 'high',
      createdAt: alertTime,
      title: 'Critical process anomaly',
    });

    const firstRun = await runTelemetryGapDetection(tenant.id);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].type).toBe('telemetry_gap_after_alert');
    expect(firstRun[0].indicator).toBe(triggerAgent.id);
    expect(firstRun[0].observedVolume).toBe(0);
    expect(firstRun[0].degradedPeerFraction).toBe(0);

    const prisma = getIntegrationPrisma();
    expect(await prisma.correlatedIncident.count()).toBe(1);

    const secondRun = await runTelemetryGapDetection(tenant.id);
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0].id).toBe(firstRun[0].id);
    expect(await prisma.correlatedIncident.count()).toBe(1);
  });

  it('suppresses when most peers also drop (shared outage)', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const alertTime = new Date(Date.now() - GAP_WINDOW_MS - 5 * 60 * 1000);
    const baselineStart = new Date(alertTime.getTime() - 24 * 60 * 60 * 1000);

    const agents = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        createAgent({
          tenantId: tenant.id,
          enrolledByUserId: user.id,
          displayName: `agent-${n}`,
        })
      )
    );

    for (const agent of agents) {
      await seedBaselineVolume(tenant.id, agent.id, baselineStart, alertTime, BASELINE_EVENTS);
      await seedGapVolume(tenant.id, agent.id, alertTime, 0);
    }

    await createAlert({
      tenantId: tenant.id,
      agentId: agents[0].id,
      severity: 'critical',
      createdAt: alertTime,
      title: 'Shared outage trigger',
    });

    const incidents = await runTelemetryGapDetection(tenant.id);
    expect(incidents).toHaveLength(0);
    expect(await getIntegrationPrisma().correlatedIncident.count()).toBe(0);
  });
});
