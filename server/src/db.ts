import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton — reuses a single connection pool across the app.
 * In development, stores the instance on globalThis to survive hot reloads
 * (tsx watch would otherwise create a new pool on every file change).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
