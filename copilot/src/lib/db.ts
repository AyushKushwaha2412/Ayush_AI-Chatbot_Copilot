import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma instance. The global cache prevents Next.js dev-mode hot
 * reloads from opening a new SQLite connection on every request.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
