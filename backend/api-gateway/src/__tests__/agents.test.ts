import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { createApp } from '../app';
import * as agentService from '../services/agentService';
import { requireRole } from '../middleware/requireRole';

jest.mock('../services/agentService', () => ({
  createAgent: jest.fn(),
  listAgentsInTenant: jest.fn(),
  getAgentInTenant: jest.fn(),
}));

const mockedCreateAgent = agentService.createAgent as jest.MockedFunction<typeof agentService.createAgent>;
const mockedListAgentsInTenant = agentService.listAgentsInTenant as jest.MockedFunction<
  typeof agentService.listAgentsInTenant
>;
const mockedGetAgentInTenant = agentService.getAgentInTenant as jest.MockedFunction<
  typeof agentService.getAgentInTenant
>;

const app = createApp();
const VALID_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

function makeAccessToken(overrides?: Partial<{ sub: string; tenantId: string; role: string }>) {
  return jwt.sign(
    { sub: 'user-a', tenantId: 'tenant-a', role: 'admin', ...overrides },
    VALID_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

const sampleAgentSummary = {
  id: 'agent-1',
  tenantId: 'tenant-a',
  hostname: 'endpoint-01',
  os: 'linux',
  agentVersion: '1.0.0',
  status: 'pending' as const,
  registeredAt: new Date('2024-06-01'),
};

const sampleAgentDetail = {
  ...sampleAgentSummary,
  ipAddress: '10.0.0.1',
  lastSeenAt: null,
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
};

const validCreateBody = {
  hostname: 'endpoint-01',
  os: 'linux',
  agentVersion: '1.0.0',
};

// ─── requireRole middleware ───────────────────────────────────────────────────
describe('requireRole middleware', () => {
  function runRequireRole(role: string, minimum: 'owner' | 'admin' | 'analyst' | 'read-only') {
    const req = {
      tenant: { tenantId: 'tenant-a', userId: 'user-a', role },
    } as unknown as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    requireRole(minimum)(req, res as unknown as Response, next as NextFunction);

    return { res, next };
  }

  it('passes when role meets minimum', () => {
    const { res, next } = runRequireRole('admin', 'admin');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes when role exceeds minimum', () => {
    const { res, next } = runRequireRole('owner', 'analyst');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403 when role is below minimum', () => {
    const { res, next } = runRequireRole('analyst', 'admin');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('enforces hierarchy owner > admin > analyst > read-only', () => {
    expect(runRequireRole('read-only', 'analyst').res.status).toHaveBeenCalledWith(403);
    expect(runRequireRole('analyst', 'admin').res.status).toHaveBeenCalledWith(403);
    expect(runRequireRole('admin', 'owner').res.status).toHaveBeenCalledWith(403);
    expect(runRequireRole('owner', 'read-only').next).toHaveBeenCalled();
  });
});

// ─── POST /api/agents ─────────────────────────────────────────────────────────
describe('POST /api/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('201 + agentToken on valid admin token', async () => {
    mockedCreateAgent.mockResolvedValue({
      agent: sampleAgentSummary,
      agentToken: 'one-time-token-hex',
    });

    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin' })}`)
      .send(validCreateBody);

    expect(res.status).toBe(201);
    expect(res.body.agentToken).toBe('one-time-token-hex');
    expect(res.body.agent).toMatchObject({
      id: 'agent-1',
      hostname: 'endpoint-01',
      os: 'linux',
      agentVersion: '1.0.0',
      status: 'pending',
      tenantId: 'tenant-a',
    });
  });

  it('does not include tokenHash in response', async () => {
    mockedCreateAgent.mockResolvedValue({
      agent: sampleAgentSummary,
      agentToken: 'one-time-token-hex',
    });

    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin' })}`)
      .send(validCreateBody);

    expect(res.body.tokenHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/);
  });

  it('403 when role is analyst', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst' })}`)
      .send(validCreateBody);

    expect(res.status).toBe(403);
    expect(mockedCreateAgent).not.toHaveBeenCalled();
  });

  it('403 when role is read-only', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`)
      .send(validCreateBody);

    expect(res.status).toBe(403);
    expect(mockedCreateAgent).not.toHaveBeenCalled();
  });

  it('400 when hostname is missing', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin' })}`)
      .send({ os: 'linux', agentVersion: '1.0.0' });

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('hostname');
  });

  it('400 when os is missing', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin' })}`)
      .send({ hostname: 'endpoint-01', agentVersion: '1.0.0' });

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('os');
  });

  it('400 when agentVersion is missing', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin' })}`)
      .send({ hostname: 'endpoint-01', os: 'linux' });

    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('agentVersion');
  });

  it('uses tenantId from token, not request body', async () => {
    mockedCreateAgent.mockResolvedValue({
      agent: sampleAgentSummary,
      agentToken: 'token',
    });

    await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'admin', tenantId: 'tenant-a' })}`)
      .send({ ...validCreateBody, tenantId: 'tenant-b' });

    expect(mockedCreateAgent).toHaveBeenCalledWith('tenant-a', expect.objectContaining(validCreateBody));
    expect(mockedCreateAgent).not.toHaveBeenCalledWith('tenant-b', expect.anything());
  });
});

// ─── GET /api/agents ──────────────────────────────────────────────────────────
describe('GET /api/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + array of agents for caller tenant', async () => {
    mockedListAgentsInTenant.mockResolvedValue([sampleAgentSummary]);

    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'agent-1', tenantId: 'tenant-a' });
    expect(mockedListAgentsInTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('only returns agents scoped to caller tenant via service', async () => {
    mockedListAgentsInTenant.mockResolvedValue([
      { ...sampleAgentSummary, id: 'agent-a', tenantId: 'tenant-a' },
    ]);

    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst', tenantId: 'tenant-a' })}`);

    expect(res.body.every((a: { tenantId: string }) => a.tenantId === 'tenant-a')).toBe(true);
    expect(res.body.some((a: { tenantId: string }) => a.tenantId === 'tenant-b')).toBe(false);
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
    expect(mockedListAgentsInTenant).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedListAgentsInTenant).not.toHaveBeenCalled();
  });
});

// ─── GET /api/agents/:agentId ─────────────────────────────────────────────────
describe('GET /api/agents/:agentId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 + agent when id belongs to caller tenant', async () => {
    mockedGetAgentInTenant.mockResolvedValue(sampleAgentDetail);

    const res = await request(app)
      .get('/api/agents/agent-1')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'agent-1', tenantId: 'tenant-a' });
    expect(mockedGetAgentInTenant).toHaveBeenCalledWith('tenant-a', 'agent-1');
  });

  it('404 when id belongs to another tenant', async () => {
    mockedGetAgentInTenant.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/agents/agent-b')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst', tenantId: 'tenant-a' })}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
  });

  it('404 when id does not exist', async () => {
    mockedGetAgentInTenant.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/agents/missing')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'analyst' })}`);

    expect(res.status).toBe(404);
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/agents/agent-1');
    expect(res.status).toBe(401);
    expect(mockedGetAgentInTenant).not.toHaveBeenCalled();
  });

  it('403 for read-only role', async () => {
    const res = await request(app)
      .get('/api/agents/agent-1')
      .set('Authorization', `Bearer ${makeAccessToken({ role: 'read-only' })}`);

    expect(res.status).toBe(403);
    expect(mockedGetAgentInTenant).not.toHaveBeenCalled();
  });
});
