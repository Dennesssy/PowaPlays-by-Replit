import { Router, type IRouter, type Request, type Response } from "express";
import { db, analyticsEventsTable, errorEventsTable, pageViewsTable, feedbackTable, projectsTable } from "@workspace/db";
import { eq, sql, gte } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

function isInternal(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

function parseUA(ua: string) {
  let device = "desktop";
  if (/mobile|android|iphone|ipad/i.test(ua)) device = "mobile";
  else if (/tablet|ipad/i.test(ua)) device = "tablet";

  let browser = "other";
  if (/chrome/i.test(ua)) browser = "chrome";
  else if (/firefox/i.test(ua)) browser = "firefox";
  else if (/safari/i.test(ua)) browser = "safari";
  else if (/edge/i.test(ua)) browser = "edge";

  let os = "other";
  if (/windows/i.test(ua)) os = "windows";
  else if (/mac/i.test(ua)) os = "macos";
  else if (/linux/i.test(ua)) os = "linux";
  else if (/android/i.test(ua)) os = "android";
  else if (/iphone|ipad/i.test(ua)) os = "ios";

  return { device, browser, os };
}

router.post("/analytics/events", async (req: Request, res: Response) => {
  const { event, path, projectId, metadata, referrer, sessionId } = req.body;

  if (!event) {
    res.status(400).json({ error: "event is required" });
    return;
  }

  const ua = req.headers["user-agent"] || "";
  const { device, browser, os } = parseUA(ua);

  try {
    await db.insert(analyticsEventsTable).values({
      event,
      sessionId: sessionId || null,
      userId: req.isAuthenticated() ? req.user.id : null,
      projectId: projectId || null,
      path: path || null,
      referrer: referrer || req.headers.referer || null,
      userAgent: ua,
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
      device,
      browser,
      os,
      metadata: metadata || {},
    });

    if (event === "page_view" && path) {
      await db.insert(pageViewsTable).values({
        path,
        projectId: projectId || null,
        sessionId: sessionId || null,
        userId: req.isAuthenticated() ? req.user.id : null,
        referrer: referrer || null,
      });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error tracking event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/analytics/errors", async (req: Request, res: Response) => {
  const { message, stack, level, path, projectId, metadata } = req.body;

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const fingerprint = crypto
    .createHash("md5")
    .update(message + (stack || "").slice(0, 200))
    .digest("hex");

  try {
    const [existing] = await db
      .select()
      .from(errorEventsTable)
      .where(eq(errorEventsTable.fingerprint, fingerprint));

    if (existing) {
      await db
        .update(errorEventsTable)
        .set({
          occurrences: sql`${errorEventsTable.occurrences} + 1`,
          lastSeenAt: new Date(),
        })
        .where(eq(errorEventsTable.id, existing.id));
    } else {
      await db.insert(errorEventsTable).values({
        level: level || "error",
        message,
        stack: stack || null,
        fingerprint,
        projectId: projectId || null,
        userId: req.isAuthenticated() ? req.user.id : null,
        path: path || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: metadata || {},
      });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error reporting error event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics", async (req: Request, res: Response) => {
  if (!isInternal(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const period = (req.query.period as string) || "7d";
  const days = parseInt(period) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [pvCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pageViewsTable)
      .where(gte(pageViewsTable.createdAt, since));

    const [uvCount] = await db
      .select({ count: sql<number>`count(DISTINCT COALESCE(${pageViewsTable.sessionId}, ${pageViewsTable.userId}))::int` })
      .from(pageViewsTable)
      .where(gte(pageViewsTable.createdAt, since));

    const [errCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(errorEventsTable)
      .where(gte(errorEventsTable.createdAt, since));

    const topProjects = await db
      .select({
        projectId: pageViewsTable.projectId,
        title: projectsTable.title,
        views: sql<number>`count(*)::int`,
      })
      .from(pageViewsTable)
      .leftJoin(projectsTable, eq(pageViewsTable.projectId, projectsTable.id))
      .where(gte(pageViewsTable.createdAt, since))
      .groupBy(pageViewsTable.projectId, projectsTable.title)
      .orderBy(sql`count(*) DESC`)
      .limit(10);

    const topPages = await db
      .select({
        path: pageViewsTable.path,
        views: sql<number>`count(*)::int`,
      })
      .from(pageViewsTable)
      .where(gte(pageViewsTable.createdAt, since))
      .groupBy(pageViewsTable.path)
      .orderBy(sql`count(*) DESC`)
      .limit(10);

    const feedbackCounts = await db
      .select({
        status: feedbackTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackTable)
      .groupBy(feedbackTable.status);

    const fbMap: Record<string, number> = {};
    feedbackCounts.forEach((f) => { fbMap[f.status] = f.count; });

    res.json({
      totalPageViews: pvCount?.count || 0,
      uniqueVisitors: uvCount?.count || 0,
      totalErrors: errCount?.count || 0,
      topProjects: topProjects.filter((p) => p.projectId !== null),
      topPages,
      feedbackCounts: {
        open: fbMap.open || 0,
        acknowledged: fbMap.acknowledged || 0,
        in_progress: fbMap.in_progress || 0,
        resolved: fbMap.resolved || 0,
        closed: fbMap.closed || 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error getting analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
