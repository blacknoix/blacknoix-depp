import { prisma } from '../lib/prisma';
import { tenantOwnedWhere } from '../lib/tenantScope';
import { UserRole } from '../types/auth';

export interface TenantUserSummary {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
}

function toUserRole(prismaRole: string): UserRole {
  const map: Record<string, UserRole> = {
    owner: 'owner',
    admin: 'admin',
    analyst: 'analyst',
    read_only: 'read-only',
  };
  return map[prismaRole] ?? 'read-only';
}

/**
 * Fetch a user only when they belong to the caller's tenant.
 * Cross-tenant lookups return null (map to 404 at the route layer).
 */
export async function getUserInTenant(
  tenantId: string,
  userId: string
): Promise<TenantUserSummary | null> {
  const user = await prisma.user.findFirst({
    where: tenantOwnedWhere(tenantId, userId),
    select: { id: true, email: true, role: true, tenantId: true },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: toUserRole(user.role),
    tenantId: user.tenantId,
  };
}
