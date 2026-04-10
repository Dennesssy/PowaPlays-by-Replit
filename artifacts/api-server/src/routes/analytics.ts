import { Router, type IRouter, type Request, type Response } from "express";
import { db, analyticsEventsTable, errorEventsTable, pageViewsTable, feedbackTable, projectsTable } from "@workspace/db";
import { eq, sql, gte } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

function isInternal(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

const uaCache = new Map<string, { device: string; browser: string; os: string }>();
const UA_CACHE_MAX = 1000;

function parseUA(ua: string) {
  if (uaCache.has(ua)) return uaCache.get(ua)!;

  let device = "desktop";
  if (/mobile|android|iphone|ipad/i.test(ua)) device = "mobile";
  else if (/tablet|ipad/i.test(ua)) device = "tablet";

  let browser = "other";
  if (/edg/i.test(ua)) browser = "edge";
  else if (/chrome/i.test(ua)) browser = "chrome";
  else if (/firefox/i.test(ua)) browser = "firefox";
  else if (/safari/i.test(ua)) browser = "safari";

  let os = "other";
  if (/windows/i.test(ua)) os = "windows";
  else if (/mac/i.test(ua)) os = "macos";
  else if (/linux/i.test(ua)) os = "linux";
  else if (/android/i.test(ua)) os = "android";
  else if (/iphone|ipad/i.test(ua)) os = "ios";

  const result = { device, browser, os };
  if (uaCache.size >= UA_CACHE_MAX) {
    const firstKey = uaCache.keys().next().value;
    if (firstKey) uaCache.delete(firstKey);
  }
  uaCache.set(ua, result);
  return result;
}

const VALID_EVENTS = new Set([
  "page_view", "favorite", "unfavorite", "project_view", "project_open", "project_close",
  "filter_use", "search", "share", "feedback_submit", "click",
]);

const eventRateLimits = new Map<string, number>();
const EVENT_RATE_WINDOW = 1000;

router.post("/analytics/events", async (req: Request, res: Response) => {
  const { event, path, projectId, metadata, referrer, sessionId } = req.body;

  if (!event || typeof event !== "string") {
    res.status(400).json({ error: "event is required" });
    return;
  }

  if (!VALID_EVENTS.has(event)) {
    res.status(400).json({ error: "Invalid event type" });
    return;
  }

  if (projectId !== undefined && projectId !== null) {
    const pid = parseInt(String(projectId));
    if (isNaN(pid) || pid < 1) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  if (path !== undefined && typeof path !== "string") {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const clientKey = (req.isAuthenticated() ? req.user.id : (req.ip || "anon")) + ":" + event;
  const now = Date.now();
  const last = eventRateLimits.get(clientKey) || 0;
  if (now - last < EVENT_RATE_WINDOW) {
    res.json({ success: true });
    return;
  }
  eventRateLimits.set(clientKey, now);

  if (eventRateLimits.size > 10000) {
    const cutoff = now - 60000;
    for (const [k, v] of eventRateLimits) {
      if (v < cutoff) eventRateLimits.delete(k);
    }
  }

  const ua = (req.headers["user-agent"] || "").slice(0, 500);
  const { device, browser, os } = parseUA(ua);
  const safePath = typeof path === "string" ? path.slice(0, 500) : null;
  const safeReferrer = typeof referrer === "string" ? referrer.slice(0, 1000) : (typeof req.headers.referer === "string" ? req.headers.referer.slice(0, 1000) : null);
  const safeSessionId = typeof sessionId === "string" ? sessionId.slice(0, 100) : null;

  try {
    const insertPromises: Promise<unknown>[] = [
      db.insert(analyticsEventsTable).values({
        event,
        sessionId: safeSessionId,
        userId: req.isAuthenticated() ? req.user.id : null,
        projectId: projectId ? parseInt(projectId) : null,
        path: safePath,
        referrer: safeReferrer,
        userAgent: ua,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
        device,
        browser,
        os,
        metadata: metadata && typeof metadata === "object" ? metadata : {},
      }),
    ];

    if (event === "page_view" && safePath) {
      insertPromises.push(
        db.insert(pageViewsTable).values({
          path: safePath,
          projectId: projectId ? parseInt(projectId) : null,
          sessionId: safeSessionId,
          userId: req.isAuthenticated() ? req.user.id : null,
          referrer: safeReferrer,
        }),
      );
    }

    await Promise.all(insertPromises);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error tracking event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/analytics/errors", async (req: Request, res: Response) => {
  const { message, stack, level, path, projectId, metadata } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (projectId !== undefined && projectId !== null) {
    const pid = parseInt(String(projectId));
    if (isNaN(pid) || pid < 1) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  const safeMessage = message.slice(0, 2000);
  const safeStack = typeof stack === "string" ? stack.slice(0, 5000) : null;
  const safePath = typeof path === "string" ? path.slice(0, 500) : null;
  const safeLevel = typeof level === "string" && ["error", "warn", "fatal"].includes(level) ? level : "error";

  const fingerprint = crypto
    .createHash("md5")
    .update(safeMessage + (safeStack || "").slice(0, 200))
    .digest("hex");

  try {
    const [existing] = await db
      .select({ id: errorEventsTable.id })
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
        level: safeLevel,
        message: safeMessage,
        stack: safeStack,
        fingerprint,
        projectId: projectId ? parseInt(projectId) : null,
        userId: req.isAuthenticated() ? req.user.id : null,
        path: safePath,
        userAgent: (req.headers["user-agent"] || "").slice(0, 500),
        metadata: metadata && typeof metadata === "object" ? metadata : {},
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
  const days = Math.min(90, Math.max(1, parseInt(period) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [pvCount, uvCount, errCount, topProjects, topPages, feedbackCounts] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(pageViewsTable)
          .where(gte(pageViewsTable.createdAt, since)),
        db
          .select({
            count: sql<number>`count(DISTINCT COALESCE(${pageViewsTable.sessionId}, ${pageViewsTable.userId}))::int`,
          })
          .from(pageViewsTable)
          .where(gte(pageViewsTable.createdAt, since)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(errorEventsTable)
          .where(gte(errorEventsTable.createdAt, since)),
        db
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
          .limit(10),
        db
          .select({
            path: pageViewsTable.path,
            views: sql<number>`count(*)::int`,
          })
          .from(pageViewsTable)
          .where(gte(pageViewsTable.createdAt, since))
          .groupBy(pageViewsTable.path)
          .orderBy(sql`count(*) DESC`)
          .limit(10),
        db
          .select({
            status: feedbackTable.status,
            count: sql<number>`count(*)::int`,
          })
          .from(feedbackTable)
          .groupBy(feedbackTable.status),
      ]);

    const fbMap: Record<string, number> = {};
    feedbackCounts.forEach((f) => {
      fbMap[f.status] = f.count;
    });

    res.json({
      totalPageViews: pvCount[0]?.count || 0,
      uniqueVisitors: uvCount[0]?.count || 0,
      totalErrors: errCount[0]?.count || 0,
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
