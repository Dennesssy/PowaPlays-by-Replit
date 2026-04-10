import { Router, type IRouter, type Request, type Response } from "express";
import { syncBuildathonProjects } from "../lib/buildathonSync";
import { db, projectsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/sync/status", async (_req: Request, res: Response) => {
  try {
    const [result] = await db
      .select({
        total: sql<number>`count(*)::int`,
        synced: sql<number>`count(*) filter (where ${projectsTable.externalId} is not null)::int`,
        lastSync: sql<string>`max(${projectsTable.syncedAt})`,
      })
      .from(projectsTable);

    res.json({
      totalProjects: result?.total || 0,
      syncedFromBuildathon: result?.synced || 0,
      lastSyncAt: result?.lastSync || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/sync/trigger", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || (req.user.role !== "admin" && req.user.role !== "internal")) {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  try {
    const result = await syncBuildathonProjects();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

export default router;
