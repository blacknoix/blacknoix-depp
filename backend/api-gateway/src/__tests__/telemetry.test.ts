import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { authenticateAgent } from '../middleware/authenticateAgent';
import * as telemetryService from '../services/telemetryService';
import { AgentAuthenticatedRequest } from '../types/telemetry';

jest.mock('../middleware/authenticateAgent', () => ({
  authenticateAgent: jest.fn(),
}));

jest.mock('../services/telemetryService', () => ({
  ingestTelemetryBatch: jest.fn(),
  listEventsForAgent: jest.fn(),
}));

const mockedAuthenticateAgent = authenticateAgent as jest.MockedFunction<typeof authenticateAgent>;
const mockedIngestTelemetryBatch = telemetryService.ingestTelemetryBatch as jest.MockedFunction<
  typeof telemetryService.ingestTelemetryBatch
>;
const mockedListEventsForAgent = telemetryService.listEventsForAgent as jest.MockedFunction<
  typeof telemetryService.listEventsForAgent
>;

const app = createApp();
const VALID_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

const INVALID_TOKEN_ERROR = { error: 'Unauthorized' };

function makeUserToken(overrides?: Partial<{ sub: string; tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'user-a', tenantId: 'tenant-a', role: 'analyst', ...overrides },
    VALID_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

function validEvent(overrides?: Record<string, unknown>) {
  return {
    eventType: 'process.start',
    severity: 'low',
    occurredAt: '2024-06-01T12:00:00.000Z',
    payload: { pid: 1234 },
    ...overrides,
  };
}

function mockAgentAuth(agent: { agentId: string; tenantId: string } | null) {
  mockedAuthenticateAgent.mockImplementation(async (req, res, next) => {
    if (!agent) {
      res.status(401).json(INVALID_TOKEN_ERROR);
      return;
    }
    (req as AgentAuthenticatedRequest).agent = agent;
    next();
  });
}

// ─── POST /telemetry/events ───────────────────────────────────────────────────
describe('POST /telemetry/events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIngestTelemetryBatch.mockResolvedValue(undefined);
    mockAgentAuth({ agentId: 'agent-a', tenantId: 'tenant-a' });
  });

  it('401 with no Authorization header', async () => {
    mockAgentAuth(null);

    const res = await request(app).post('/telemetry/events').send([validEvent()]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN_ERROR);
    expect(mockedIngestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('401 with unknown token', async () => {
    mockAgentAuth(null);

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer unknown-token')
      .send([validEvent()]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN_ERROR);
  });

  it('401 with revoked agent token', async () => {
    mockAgentAuth(null);

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer revoked-agent-token')
      .send([validEvent()]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN_ERROR);
  });

  it('valid token resolves correct agentId and tenantId', async () => {
    mockAgentAuth({ agentId: 'agent-a', tenantId: 'tenant-a' });

    await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([validEvent()]);

    expect(mockedIngestTelemetryBatch).toHaveBeenCalledWith(
      'agent-a',
      'tenant-a',
      expect.any(Array)
    );
  });

  it('202 with a valid single-event batch', async () => {
    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([validEvent()]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1 });
    expect(mockedIngestTelemetryBatch).toHaveBeenCalledTimes(1);
  });

  it('202 with a valid 100-event batch', async () => {
    const batch = Array.from({ length: 100 }, (_, i) =>
      validEvent({ payload: { index: i } })
    );

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send(batch);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 100 });
  });

  it('400 when batch exceeds 100 events', async () => {
    const batch = Array.from({ length: 101 }, () => validEvent());

    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send(batch);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/between 1 and 100/)])
    );
    expect(mockedIngestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('400 when eventType is missing from any event', async () => {
    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([{ severity: 'low', occurredAt: '2024-06-01T12:00:00.000Z', payload: {} }]);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/eventType/)])
    );
  });

  it('400 when severity is invalid', async () => {
    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([validEvent({ severity: 'extreme' })]);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/severity/)])
    );
  });

  it('400 when occurredAt is not a valid ISO datetime', async () => {
    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([validEvent({ occurredAt: 'not-a-date' })]);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/occurredAt/)])
    );
  });

  it('400 when payload is not a JSON object', async () => {
    const res = await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([validEvent({ payload: ['array'] })]);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/payload/)])
    );
  });

  it('agentId and tenantId come from authenticated agent context, not body', async () => {
    mockAgentAuth({ agentId: 'agent-from-token', tenantId: 'tenant-from-token' });

    await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send([
        {
          ...validEvent(),
          agentId: 'agent-from-body',
          tenantId: 'tenant-from-body',
        },
      ]);

    expect(mockedIngestTelemetryBatch).toHaveBeenCalledWith(
      'agent-from-token',
      'tenant-from-token',
      expect.any(Array)
    );
  });

  it('events are sent to service with authenticated context', async () => {
    const events = [validEvent({ eventType: 'file.write' })];

    await request(app)
      .post('/telemetry/events')
      .set('Authorization', 'Bearer valid-agent-token')
      .send(events);

    expect(mockedIngestTelemetryBatch).toHaveBeenCalledWith('agent-a', 'tenant-a', [
      expect.objectContaining({ eventType: 'file.write', severity: 'low' }),
    ]);
  });
});

// ─── GET /api/agents/:agentId/events ──────────────────────────────────────────
describe('GET /api/agents/:agentId/events', () => {
  const sampleEvents = [
    {
      id: 'evt-2',
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      eventType: 'process.start',
      severity: 'low',
      occurredAt: new Date('2024-06-01T12:00:00.000Z'),
      receivedAt: new Date('2024-06-01T12:01:00.000Z'),
      payload: { pid: 2 },
    },
    {
      id: 'evt-1',
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      eventType: 'file.write',
      severity: 'medium',
      occurredAt: new Date('2024-06-01T11:00:00.000Z'),
      receivedAt: new Date('2024-06-01T11:30:00.000Z'),
      payload: { path: '/tmp/a' },
    },
  ];

  beforeEach(() => jest.clearAllMocks());

  it('200 + events for agent in caller tenant', async () => {
    mockedListEventsForAgent.mockResolvedValue(sampleEvents);

    const res = await request(app)
      .get('/api/agents/agent-a/events')
      .set('Authorization', `Bearer ${makeUserToken({ role: 'analyst', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockedListEventsForAgent).toHaveBeenCalledWith('tenant-a', 'agent-a', 50, undefined);
  });

  it('404 for agentId in another tenant', async () => {
    mockedListEventsForAgent.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/agents/agent-b/events')
      .set('Authorization', `Bearer ${makeUserToken({ tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
  });

  it('404 for non-existent agentId', async () => {
    mockedListEventsForAgent.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/agents/missing/events')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(res.status).toBe(404);
  });

  it('401 without user token', async () => {
    const res = await request(app).get('/api/agents/agent-a/events');
    expect(res.status).toBe(401);
    expect(mockedListEventsForAgent).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/agents/agent-a/events')
      .set('Authorization', `Bearer ${makeUserToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedListEventsForAgent).not.toHaveBeenCalled();
  });

  it('respects limit parameter', async () => {
    mockedListEventsForAgent.mockResolvedValue(sampleEvents);

    await request(app)
      .get('/api/agents/agent-a/events?limit=25')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListEventsForAgent).toHaveBeenCalledWith('tenant-a', 'agent-a', 25, undefined);
  });

  it('caps limit at 200', async () => {
    mockedListEventsForAgent.mockResolvedValue([]);

    await request(app)
      .get('/api/agents/agent-a/events?limit=500')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListEventsForAgent).toHaveBeenCalledWith('tenant-a', 'agent-a', 200, undefined);
  });

  it('respects before cursor', async () => {
    mockedListEventsForAgent.mockResolvedValue(sampleEvents);
    const before = '2024-06-01T12:00:00.000Z';

    await request(app)
      .get(`/api/agents/agent-a/events?before=${encodeURIComponent(before)}`)
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(mockedListEventsForAgent).toHaveBeenCalledWith(
      'tenant-a',
      'agent-a',
      50,
      new Date(before)
    );
  });

  it('returns events ordered by receivedAt descending', async () => {
    mockedListEventsForAgent.mockResolvedValue(sampleEvents);

    const res = await request(app)
      .get('/api/agents/agent-a/events')
      .set('Authorization', `Bearer ${makeUserToken()}`);

    expect(res.body[0].id).toBe('evt-2');
    expect(res.body[1].id).toBe('evt-1');
    expect(new Date(res.body[0].receivedAt).getTime()).toBeGreaterThan(
      new Date(res.body[1].receivedAt).getTime()
    );
  });
});
