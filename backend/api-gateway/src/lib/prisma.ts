import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client for the api-gateway process.
 * Import this module instead of instantiating PrismaClient in each service.
 */
export const prisma = new PrismaClient();
