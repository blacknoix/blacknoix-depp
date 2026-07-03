import { getTenantOverview } from '../src/services/tenantOverviewService';
import { TENANT_OVERVIEW_WINDOW_MS } from '../src/types/tenantOverview';
import { disconnectIntegrationPrisma } from './helpers/prisma';
import {
  createAgent,
  createAlert,
  createTelemetryEvent,
  createTenant,
  createUser,
} from './helpers/seed';
import { truncateAllIntegrationTables } from './helpers/truncate';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Margin inside/outside the 24h window to avoid flake between seed and query. */
const WINDOW_MARGIN_MS = 5 * MINUTE_MS;

function rollingWindowBoundaries(referenceMs = Date.now()) {
  return {
    inside1h: new Date(referenceMs - 1 * HOUR_MS),
    insideNearBoundary: new Date(referenceMs - (TENANT_OVERVIEW_WINDOW_MS - WINDOW_MARGIN_MS)),
    outsidePastBoundary: new Date(referenceMs - (TENANT_OVERVIEW_WINDOW_MS + WINDOW_MARGIN_MS)),
    outside25h: new Date(referenceMs - 25 * HOUR_MS),
    referenceMs,
  };
}

beforeEach(async () => {
  await truncateAllIntegrationTables();
});

afterAll(async () => {
  await disconnectIntegrationPrisma();
});

describe('getTenantOverview integration', () => {
  it('aggregates agent status and alert status/severity counts correctly', async () => {
    const tenant = await createTenant({ name: 'agg-tenant' });
    const user = await createUser({ tenantId: tenant.id });

    const statuses = ['pending', 'pending', 'active', 'inactive', 'revoked', 'expired'] as const;
    for (const status of statuses) {
      await createAgent({
        tenantId: tenant.id,
        enrolledByUserId: user.id,
        status,
        displayName: `agent-${status}`,
      });
    }

    const alertMix: Array<{ status: 'open' | 'acknowledged' | 'resolved'; severity: string }> = [
      { status: 'open', severity: 'low' },
      { status: 'acknowledged', severity: 'medium' },
      { status: 'resolved', severity: 'high' },
    ];
    const agentForAlerts = await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      status: 'active',
      displayName: 'alert-agent',
    });
    for (const row of alertMix) {
      await createAlert({
        tenantId: tenant.id,
        agentId: agentForAlerts.id,
        status: row.status,
        severity: row.severity,
        title: `${row.status}-${row.severity}`,
      });
    }

    const overview = await getTenantOverview(tenant.id);
    expect(overview).not.toBeNull();

    expect(overview!.agents.total).toBe(7);
    expect(overview!.agents.byStatus).toEqual({
      pending: 2,
      active: 2,
      inactive: 1,
      revoked: 1,
      expired: 1,
    });

    expect(overview!.alerts.total).toBe(3);
    expect(overview!.alerts.byStatus).toEqual({
      open: 1,
      acknowledged: 1,
      resolved: 1,
    });
    expect(overview!.alerts.bySeverity).toEqual({
      info: 0,
      low: 1,
      medium: 1,
      high: 1,
      critical: 0,
    });
  });

  it('counts telemetry events24h using receivedAt >= now - TENANT_OVERVIEW_WINDOW_MS', async () => {
    const anchor = Date.now();
    const bounds = rollingWindowBoundaries(anchor);

    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agent = await createAgent({ tenantId: tenant.id, enrolledByUserId: user.id });

    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: bounds.inside1h,
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: bounds.insideNearBoundary,
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: bounds.outsidePastBoundary,
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: bounds.outside25h,
    });

    const overview = await getTenantOverview(tenant.id);
    expect(overview!.telemetry.events24h).toBe(2);
  });

  it('counts recentlySeen agents using lastSeenAt >= now - TENANT_OVERVIEW_WINDOW_MS', async () => {
    const anchor = Date.now();
    const bounds = rollingWindowBoundaries(anchor);

    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });

    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: bounds.inside1h,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: bounds.insideNearBoundary,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: bounds.outsidePastBoundary,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: bounds.outside25h,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: null,
    });

    const overview = await getTenantOverview(tenant.id);
    expect(overview!.agents.recentlySeen).toBe(2);
  });

  it('returns latest activity timestamps as true maxima', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    const agent = await createAgent({ tenantId: tenant.id, enrolledByUserId: user.id });

    const olderTelemetry = new Date('2026-01-01T10:00:00.000Z');
    const latestTelemetry = new Date('2026-06-15T12:00:00.000Z');
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: olderTelemetry,
    });
    await createTelemetryEvent({
      tenantId: tenant.id,
      agentId: agent.id,
      receivedAt: latestTelemetry,
    });

    const olderAlert = new Date('2026-02-01T08:00:00.000Z');
    const latestAlert = new Date('2026-06-20T18:00:00.000Z');
    await createAlert({
      tenantId: tenant.id,
      agentId: agent.id,
      createdAt: olderAlert,
      title: 'older',
    });
    await createAlert({
      tenantId: tenant.id,
      agentId: agent.id,
      createdAt: latestAlert,
      title: 'latest',
    });

    const olderSeen = new Date('2026-03-01T09:00:00.000Z');
    const latestSeen = new Date('2026-06-25T06:00:00.000Z');
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: olderSeen,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: latestSeen,
    });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: null,
    });

    const overview = await getTenantOverview(tenant.id);
    expect(overview!.activity.lastTelemetryReceivedAt).toBe(latestTelemetry.toISOString());
    expect(overview!.activity.lastAlertCreatedAt).toBe(latestAlert.toISOString());
    expect(overview!.activity.lastAgentSeenAt).toBe(latestSeen.toISOString());
  });

  it('scopes all aggregates to the requested tenant under real SQL', async () => {
    const tenantA = await createTenant({ name: 'tenant-a' });
    const userA = await createUser({ tenantId: tenantA.id });
    await createAgent({ tenantId: tenantA.id, enrolledByUserId: userA.id, status: 'active' });
    await createAgent({ tenantId: tenantA.id, enrolledByUserId: userA.id, status: 'active' });

    const tenantB = await createTenant({ name: 'tenant-b' });
    const userB = await createUser({ tenantId: tenantB.id });
    for (let i = 0; i < 5; i += 1) {
      await createAgent({ tenantId: tenantB.id, enrolledByUserId: userB.id, status: 'pending' });
    }

    const overviewA = await getTenantOverview(tenantA.id);
    expect(overviewA!.agents.total).toBe(2);
    expect(overviewA!.agents.byStatus.active).toBe(2);
    expect(overviewA!.agents.byStatus.pending).toBe(0);

    const overviewB = await getTenantOverview(tenantB.id);
    expect(overviewB!.agents.total).toBe(5);
    expect(overviewB!.agents.byStatus.pending).toBe(5);
  });

  it('returns zeros and null activity timestamps for an empty tenant', async () => {
    const tenant = await createTenant({ name: 'empty-tenant' });

    const overview = await getTenantOverview(tenant.id);
    expect(overview).not.toBeNull();
    expect(overview!.tenant.id).toBe(tenant.id);
    expect(overview!.agents.total).toBe(0);
    expect(overview!.agents.recentlySeen).toBe(0);
    expect(overview!.agents.byStatus).toEqual({
      pending: 0,
      active: 0,
      inactive: 0,
      revoked: 0,
      expired: 0,
    });
    expect(overview!.alerts.total).toBe(0);
    expect(overview!.telemetry.events24h).toBe(0);
    expect(overview!.activity.lastTelemetryReceivedAt).toBeNull();
    expect(overview!.activity.lastAlertCreatedAt).toBeNull();
    expect(overview!.activity.lastAgentSeenAt).toBeNull();
  });

  it('returns null activity timestamps when tenant has agents but no telemetry or alerts', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    await createAgent({
      tenantId: tenant.id,
      enrolledByUserId: user.id,
      lastSeenAt: null,
    });

    const overview = await getTenantOverview(tenant.id);
    expect(overview!.activity.lastTelemetryReceivedAt).toBeNull();
    expect(overview!.activity.lastAlertCreatedAt).toBeNull();
    expect(overview!.activity.lastAgentSeenAt).toBeNull();
  });
});
