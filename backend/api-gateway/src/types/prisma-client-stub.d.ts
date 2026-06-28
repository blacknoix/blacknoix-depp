/**
 * Compile-time stub for @prisma/client.
 *
 * This file exists so `tsc --noEmit` passes before `npm install` has been run
 * (e.g. in CI without node_modules, or in sandboxed environments).
 * It is NEVER used at runtime — the real @prisma/client takes precedence
 * once installed in node_modules.
 *
 * Remove this file after running `npm install` and confirming tsc still passes.
 */
declare module '@prisma/client' {
  export type Role = 'owner' | 'admin' | 'analyst' | 'read_only';
  export type AgentStatus = 'pending' | 'active' | 'inactive' | 'revoked' | 'expired';
  export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

  export interface Tenant {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface User {
    id: string;
    email: string;
    passwordHash: string;
    role: Role;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    tenant: Tenant;
  }

  export interface RefreshToken {
    id: string;
    isRevoked: boolean;
    expiresAt: Date;
    createdAt: Date;
    userId: string;
    user: User;
  }

  export interface Agent {
    id: string;
    tenantId: string;
    displayName: string;
    hostname: string;
    os: string;
    ipAddress: string | null;
    agentVersion: string;
    status: AgentStatus;
    tokenHash: string;
    tokenPrefix: string;
    enrolledByUserId: string;
    pendingExpiresAt: Date;
    lastIpHash: string | null;
    lastAgentVersion: string | null;
    registeredAt: Date;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface TelemetryEvent {
    id: string;
    tenantId: string;
    agentId: string;
    eventType: string;
    severity: string;
    occurredAt: Date;
    payload: unknown;
    receivedAt: Date;
  }

  export interface Alert {
    id: string;
    tenantId: string;
    agentId: string;
    telemetryEventId: string | null;
    title: string;
    severity: string;
    status: AlertStatus;
    assignedToId: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }

  type WhereUniqueInput<T extends object> = Partial<T>;

  interface TenantDelegate {
    findUnique(args: {
      where: WhereUniqueInput<{ id: string }>;
      select?: { id?: boolean; name?: boolean; createdAt?: boolean };
    }): Promise<Pick<Tenant, 'id' | 'name' | 'createdAt'> | null>;
  }

  interface UserDelegate {
    findUnique(args: {
      where: WhereUniqueInput<{ id: string; email: string }>;
      include?: { tenant?: boolean };
    }): Promise<(User & { tenant: Tenant }) | null>;
    findFirst(args: {
      where: Partial<{ id: string; tenantId: string }>;
      select?: { id?: boolean; email?: boolean; role?: boolean; tenantId?: boolean };
    }): Promise<Pick<User, 'id' | 'email' | 'role' | 'tenantId'> | null>;
  }

  interface RefreshTokenDelegate {
    findUnique(args: {
      where: WhereUniqueInput<{ id: string }>;
      include?: { user?: boolean };
    }): Promise<(RefreshToken & { user: User }) | null>;
    create(args: {
      data: { id: string; userId: string; expiresAt: Date };
    }): Promise<RefreshToken>;
    update(args: {
      where: WhereUniqueInput<{ id: string }>;
      data: Partial<RefreshToken>;
    }): Promise<RefreshToken>;
    updateMany(args: {
      where: Partial<{ userId: string; isRevoked: boolean }>;
      data: Partial<RefreshToken>;
    }): Promise<{ count: number }>;
  }

  type AgentSummaryRow = Pick<
    Agent,
    | 'id'
    | 'tenantId'
    | 'displayName'
    | 'hostname'
    | 'os'
    | 'agentVersion'
    | 'status'
    | 'tokenPrefix'
    | 'enrolledByUserId'
    | 'pendingExpiresAt'
    | 'registeredAt'
  >;

  type AgentDetailRow = AgentSummaryRow &
    Pick<Agent, 'ipAddress' | 'lastSeenAt' | 'lastAgentVersion' | 'createdAt' | 'updatedAt'>;

  interface AgentDelegate {
    create(args: {
      data: {
        displayName: string;
        hostname: string;
        os: string;
        agentVersion: string;
        tokenHash: string;
        tokenPrefix: string;
        tenantId: string;
        enrolledByUserId: string;
        pendingExpiresAt: Date;
        ipAddress?: string | null;
      };
      select: {
        id: true;
        tenantId: true;
        displayName: true;
        hostname: true;
        os: true;
        agentVersion: true;
        status: true;
        tokenPrefix: true;
        enrolledByUserId: true;
        pendingExpiresAt: true;
        registeredAt: true;
      };
    }): Promise<AgentSummaryRow>;
    findFirst(args: {
      where: { tokenHash: string };
      select: {
        id: true;
        tenantId: true;
        status: true;
        tokenHash: true;
        tokenPrefix: true;
        pendingExpiresAt: true;
      };
    }): Promise<
      Pick<Agent, 'id' | 'tenantId' | 'status' | 'tokenHash' | 'tokenPrefix' | 'pendingExpiresAt'> | null
    >;
    findUnique(args: {
      where: { id: string };
      select: { id: true; tenantId: true; status: true; tokenHash: true };
    }): Promise<Pick<Agent, 'id' | 'tenantId' | 'status' | 'tokenHash'> | null>;
    findMany(args: {
      where: { tenantId: string };
      orderBy: { registeredAt: 'desc' | 'asc' };
      select: {
        id: true;
        tenantId: true;
        displayName: true;
        hostname: true;
        os: true;
        agentVersion: true;
        status: true;
        tokenPrefix: true;
        enrolledByUserId: true;
        pendingExpiresAt: true;
        registeredAt: true;
      };
    }): Promise<AgentSummaryRow[]>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: {
        id: true;
        tenantId: true;
        displayName: true;
        hostname: true;
        os: true;
        agentVersion: true;
        status: true;
        tokenPrefix: true;
        enrolledByUserId: true;
        pendingExpiresAt: true;
        registeredAt: true;
        ipAddress: true;
        lastSeenAt: true;
        lastAgentVersion: true;
        createdAt: true;
        updatedAt: true;
      };
    }): Promise<AgentDetailRow | null>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: {
        id: true;
        tenantId: true;
        displayName: true;
        hostname: true;
        os: true;
        agentVersion: true;
        status: true;
        tokenPrefix: true;
        enrolledByUserId: true;
        pendingExpiresAt: true;
        registeredAt: true;
      };
    }): Promise<AgentSummaryRow | null>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: { id: true; status: true };
    }): Promise<Pick<Agent, 'id' | 'status'> | null>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }): Promise<Pick<Agent, 'id'> | null>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<Agent, 'status' | 'lastSeenAt' | 'lastIpHash'>>;
      select?: {
        id: true;
        tenantId: true;
        displayName: true;
        hostname: true;
        os: true;
        agentVersion: true;
        status: true;
        tokenPrefix: true;
        enrolledByUserId: true;
        pendingExpiresAt: true;
        registeredAt: true;
      };
    }): Promise<AgentSummaryRow | Agent>;
    updateMany(args: {
      where: { id: string; tenantId: string; status: AgentStatus };
      data: Partial<Pick<Agent, 'status'>>;
    }): Promise<{ count: number }>;
  }

  type TelemetryEventRow = Pick<
    TelemetryEvent,
    | 'id'
    | 'tenantId'
    | 'agentId'
    | 'eventType'
    | 'severity'
    | 'occurredAt'
    | 'receivedAt'
    | 'payload'
  >;

  interface TelemetryEventDelegate {
    createMany(args: {
      data: Array<{
        id: string;
        tenantId: string;
        agentId: string;
        eventType: string;
        severity: string;
        occurredAt: Date;
        payload: Record<string, unknown>;
      }>;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: {
        tenantId: string;
        agentId: string;
        receivedAt?: { lt: Date };
      };
      orderBy: { receivedAt: 'desc' | 'asc' };
      take: number;
      select: {
        id: true;
        tenantId: true;
        agentId: true;
        eventType: true;
        severity: true;
        occurredAt: true;
        receivedAt: true;
        payload: true;
      };
    }): Promise<TelemetryEventRow[]>;
  }

  type AlertSummaryRow = Pick<
    Alert,
    | 'id'
    | 'tenantId'
    | 'agentId'
    | 'telemetryEventId'
    | 'title'
    | 'severity'
    | 'status'
    | 'assignedToId'
    | 'createdAt'
    | 'updatedAt'
  >;

  type AlertDetailRow = AlertSummaryRow & Pick<Alert, 'resolvedAt'>;

  interface AlertDelegate {
    findMany(args: {
      where: {
        tenantId: string;
        status?: AlertStatus;
        severity?: string;
        agentId?: string;
        createdAt?: { lt: Date };
      };
      orderBy: { createdAt: 'desc' | 'asc' };
      take: number;
      select: {
        id: true;
        tenantId: true;
        agentId: true;
        telemetryEventId: true;
        title: true;
        severity: true;
        status: true;
        assignedToId: true;
        createdAt: true;
        updatedAt: true;
      };
    }): Promise<AlertSummaryRow[]>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: {
        id: true;
        tenantId: true;
        agentId: true;
        telemetryEventId: true;
        title: true;
        severity: true;
        status: true;
        assignedToId: true;
        resolvedAt: true;
        createdAt: true;
        updatedAt: true;
      };
    }): Promise<AlertDetailRow | null>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: { id: true; status: true };
    }): Promise<Pick<Alert, 'id' | 'status'> | null>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }): Promise<Pick<Alert, 'id'> | null>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<Alert, 'status' | 'assignedToId' | 'resolvedAt'>>;
      select: {
        id: true;
        tenantId: true;
        agentId: true;
        telemetryEventId: true;
        title: true;
        severity: true;
        status: true;
        assignedToId: true;
        resolvedAt: true;
        createdAt: true;
        updatedAt: true;
      };
    }): Promise<AlertDetailRow>;
    createMany(args: {
      data: Array<{
        tenantId: string;
        agentId: string;
        telemetryEventId: string;
        title: string;
        severity: string;
        status: AlertStatus;
      }>;
    }): Promise<{ count: number }>;
  }

  type TransactionClient = {
    telemetryEvent: TelemetryEventDelegate;
    agent: Pick<AgentDelegate, 'update'>;
    alert: Pick<AlertDelegate, 'createMany'>;
    refreshToken: Pick<RefreshTokenDelegate, 'update' | 'create'>;
  };

  export class PrismaClient {
    tenant: TenantDelegate;
    user: UserDelegate;
    refreshToken: RefreshTokenDelegate;
    agent: AgentDelegate;
    telemetryEvent: TelemetryEventDelegate;
    alert: AlertDelegate;
    $transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
  }
}
