import { Router } from "express";
import { prisma } from "../db.js";

export const healthRouter = Router();

/**
 * GET /api/health
 * Railway uses this endpoint for health checks before routing traffic.
 * Also checks DB connectivity so we surface infra problems early.
 */
healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});
