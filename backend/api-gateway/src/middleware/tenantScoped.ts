import { RequestHandler } from 'express';
import { authenticate } from './authenticate';
import { requireTenantContext } from './requireTenantContext';

/**
 * Default middleware chain for tenant-scoped API routes.
 * Mount on routers so individual handlers do not repeat auth + tenant setup.
 *
 * Audit: 401 events are logged by authenticate and requireTenantContext.
 */
export const tenantScoped: RequestHandler[] = [authenticate, requireTenantContext];
