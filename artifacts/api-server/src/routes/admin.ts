import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable, syncRunsTable, systemMetricsTable, auditLogTable, alertsTable, analyticsEventsTable, errorEventsTable, pageViewsTable, feedbackTable } from "@workspace/db";
import { eq, sql, gte, and, desc } from "drizzle-orm";
import { getApmSnapshot } from "../middlewares/apm";
import { audit } from "../lib/auditLog";
import { syncBuildathonProjects } from "../lib/buildathonSync";

const router: IRouter = Router();

function isAdmin(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/admin/dashboard", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const period = (req.query.period as string) || "7d";
  const days = parseInt(period) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [projectStats] = await db.select({
      total: sql<number>`count(*)::int`,
      public: sql<number>`count(*) filter (where ${projectsTable.isPublic} = true)::int`,
      synced: sql<number>`count(*) filter (where ${projectsTable.externalId} is not null)::int`,
      withThumbnail: sql<number>`count(*) filter (where ${projectsTable.thumbnailUrl} is not null)::int`,
      totalFavorites: sql<number>`COALESCE(sum(${projectsTable.favoriteCount}), 0)::int`,
    }).from(projectsTable);

    const [userStats] = await db.select({
      total: sql<number>`count(*)::int`,
      admins: sql<number>`count(*) filter (where ${usersTable.role} in ('admin', 'internal'))::int`,
      system: sql<number>`count(*) filter (where ${usersTable.role} = 'system')::int`,
      regular: sql<number>`count(*) filter (where ${usersTable.role} = 'user')::int`,
    }).from(usersTable);

    const [eventStats] = await db.select({
      total: sql<number>`count(*)::int`,
      recent: sql<number>`count(*) filter (where ${analyticsEventsTable.createdAt} >= ${since})::int`,
    }).from(analyticsEventsTable);

    const [errorStats] = await db.select({
      total: sql<number>`count(*)::int`,
      unresolved: sql<number>`count(*) filter (where ${errorEventsTable.resolvedAt} is null)::int`,
      recent: sql<number>`count(*) filter (where ${errorEventsTable.createdAt} >= ${since})::int`,
    }).from(errorEventsTable);

    const [feedbackStats] = await db.select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${feedbackTable.status} = 'open')::int`,
      inProgress: sql<number>`count(*) filter (where ${feedbackTable.status} = 'in_progress')::int`,
      resolved: sql<number>`count(*) filter (where ${feedbackTable.status} = 'resolved')::int`,
    }).from(feedbackTable);

    const [alertStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${alertsTable.isResolved} = false)::int`,
      critical: sql<number>`count(*) filter (where ${alertsTable.severity} = 'critical' and ${alertsTable.isResolved} = false)::int`,
    }).from(alertsTable);

    const apm = getApmSnapshot();

    res.json({
      projects: projectStats,
      users: userStats,
      events: eventStats,
      errors: errorStats,
      feedback: feedbackStats,
      alerts: alertStats,
      apm: {
        requestCount: apm.requestCount,
        errorCount: apm.errorCount,
        errorRate: apm.errorRate,
        avgLatencyMs: apm.avgLatencyMs,
        p95Ms: apm.p95Ms,
        p99Ms: apm.p99Ms,
        uptimeSeconds: apm.uptimeSeconds,
        memoryMb: apm.memoryMb,
        rssMemoryMb: apm.rssMemoryMb,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error getting admin dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/metrics/timeseries", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const metric = (req.query.metric as string) || "http.requests";
  const hours = Math.min(168, parseInt(req.query.hours as string) || 24);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    const data = await db.select({
      value: systemMetricsTable.value,
      bucketAt: systemMetricsTable.bucketAt,
    })
    .from(systemMetricsTable)
    .where(and(
      eq(systemMetricsTable.metric, metric),
      gte(systemMetricsTable.bucketAt, since),
    ))
    .orderBy(systemMetricsTable.bucketAt)
    .limit(500);

    res.json({ metric, hours, points: data.map((d) => ({ value: d.value, t: d.bucketAt.toISOString() })) });
  } catch (err) {
    req.log.error({ err }, "Error getting metrics timeseries");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/sync/runs", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

  try {
    const runs = await db.select()
      .from(syncRunsTable)
      .orderBy(desc(syncRunsTable.startedAt))
      .limit(limit);

    res.json({ runs });
  } catch (err) {
    req.log.error({ err }, "Error getting sync runs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/sync/health", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  try {
    const [latest] = await db.select()
      .from(syncRunsTable)
      .orderBy(desc(syncRunsTable.startedAt))
      .limit(1);

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [stats] = await db.select({
      runs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${syncRunsTable.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${syncRunsTable.status} = 'failed')::int`,
      avgDurationMs: sql<number>`COALESCE(avg(${syncRunsTable.durationMs}), 0)::int`,
      totalInserted: sql<number>`COALESCE(sum(${syncRunsTable.recordsInserted}), 0)::int`,
      totalUpdated: sql<number>`COALESCE(sum(${syncRunsTable.recordsUpdated}), 0)::int`,
      totalErrored: sql<number>`COALESCE(sum(${syncRunsTable.recordsErrored}), 0)::int`,
    }).from(syncRunsTable).where(gte(syncRunsTable.startedAt, last24h));

    const health = latest ? (
      latest.status === "completed" && latest.recordsErrored === 0 ? "healthy" :
      latest.status === "completed" && latest.recordsErrored > 0 ? "degraded" :
      latest.status === "failed" ? "unhealthy" : "unknown"
    ) : "unknown";

    res.json({
      health,
      latestRun: latest ? {
        id: latest.id,
        status: latest.status,
        recordsFetched: latest.recordsFetched,
        recordsInserted: latest.recordsInserted,
        recordsUpdated: latest.recordsUpdated,
        recordsErrored: latest.recordsErrored,
        durationMs: latest.durationMs,
        startedAt: latest.startedAt.toISOString(),
        completedAt: latest.completedAt?.toISOString() || null,
      } : null,
      last24h: stats,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting sync health");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/sync/trigger", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  await audit(req, "trigger_sync", "sync");

  try {
    const result = await syncBuildathonProjects();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

router.get("/admin/alerts", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const resolved = req.query.resolved === "true";
  const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

  try {
    const alerts = await db.select()
      .from(alertsTable)
      .where(eq(alertsTable.isResolved, resolved))
      .orderBy(desc(alertsTable.createdAt))
      .limit(limit);

    res.json({ alerts });
  } catch (err) {
    req.log.error({ err }, "Error getting alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/alerts/:id/resolve", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  try {
    await db.update(alertsTable)
      .set({ isResolved: true, resolvedBy: req.user.id, resolvedAt: new Date() })
      .where(eq(alertsTable.id, id));

    await audit(req, "resolve_alert", "alert", String(id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/audit", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

  try {
    const entries = await db.select({
      id: auditLogTable.id,
      actorId: auditLogTable.actorId,
      actorRole: auditLogTable.actorRole,
      action: auditLogTable.action,
      resource: auditLogTable.resource,
      resourceId: auditLogTable.resourceId,
      details: auditLogTable.details,
      ip: auditLogTable.ip,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);

    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/apm/live", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  res.json(getApmSnapshot());
});

router.get("/admin/projects/tags", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  try {
    const tags = await db.execute(sql`
      SELECT tag, count(*) as cnt 
      FROM (
        SELECT jsonb_array_elements_text(tags) as tag 
        FROM projects 
        WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
      ) t 
      GROUP BY tag 
      ORDER BY cnt DESC 
      LIMIT 30
    `);
    res.json({ tags: tags.rows });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/projects/timeline", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const days = Math.min(90, parseInt(req.query.days as string) || 14);

  try {
    const timeline = await db.execute(sql`
      SELECT date_trunc('day', created_at)::date as day, count(*)::int as count
      FROM projects
      WHERE created_at >= now() - interval '1 day' * ${days}
      GROUP BY day
      ORDER BY day
    `);
    res.json({ timeline: timeline.rows });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/errors/fingerprints", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const showResolved = req.query.resolved === "true";

  try {
    const errors = await db
      .select({
        fingerprint: errorEventsTable.fingerprint,
        message: errorEventsTable.message,
        level: errorEventsTable.level,
        occurrences: errorEventsTable.occurrences,
        lastSeenAt: errorEventsTable.lastSeenAt,
        createdAt: errorEventsTable.createdAt,
        resolvedAt: errorEventsTable.resolvedAt,
      })
      .from(errorEventsTable)
      .where(showResolved ? undefined : sql`${errorEventsTable.resolvedAt} is null`)
      .orderBy(desc(errorEventsTable.occurrences))
      .limit(limit);

    res.json({ errors });
  } catch (err) {
    req.log.error({ err }, "Error fetching error fingerprints");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/errors/:fingerprint/resolve", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const { fingerprint } = req.params;
  if (!fingerprint || fingerprint.length > 64) {
    res.status(400).json({ error: "Invalid fingerprint" });
    return;
  }

  try {
    await db
      .update(errorEventsTable)
      .set({ resolvedAt: new Date() })
      .where(eq(errorEventsTable.fingerprint, fingerprint));

    await audit(req, "resolve_error", "error", fingerprint);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error resolving error fingerprint");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/growth", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const days = Math.min(90, parseInt(req.query.days as string) || 30);

  try {
    const growth = await db.execute(sql`
      SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date as day, count(*)::int as count
      FROM users
      WHERE created_at >= now() - interval '1 day' * ${days}
      GROUP BY day
      ORDER BY day
    `);
    res.json({ days, growth: growth.rows });
  } catch (err) {
    req.log.error({ err }, "Error fetching user growth");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
