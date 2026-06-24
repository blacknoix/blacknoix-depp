import { prisma } from '../lib/prisma';

export interface TenantProfile {
  id: string;
  name: string;
  createdAt: Date;
}

/**
 * Load a tenant profile scoped to the caller's tenant id.
 * Returns null when the tenant does not exist or ids do not match.
 */
export async function getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, createdAt: true },
  });

  return tenant;
}
