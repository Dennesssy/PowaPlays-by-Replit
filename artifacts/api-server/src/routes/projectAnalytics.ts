import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, pageViewsTable, analyticsEventsTable, feedbackTable, usersTable } from "@workspace/db";
import { eq, and, sql, gte, desc } from "drizzle-orm";

const router: IRouter = Router();

function isMaster(req: Request): boolean {
  return req.isAuthenticated() && req.user.role === "internal";
}

const VALID_ROLES = new Set(["user", "admin", "internal"]);

async function getUserProjectAnalytics(userId: string) {
  const projects = await db
    .select({
      id: projectsTable.id,
      title: projectsTable.title,
      slug: projectsTable.slug,
      favoriteCount: projectsTable.favoriteCount,
      isPublic: projectsTable.isPublic,
      isHidden: projectsTable.isHidden,
      createdAt: projectsTable.createdAt,
    })
    .from(projectsTable)
    .where(eq(projectsTable.ownerId, userId))
    .orderBy(desc(projectsTable.createdAt))
    .limit(500);

  if (projects.length === 0) {
    return {
      projects: [],
      summary: { totalProjects: 0, visibleCount: 0, totalFavorites: 0, totalViews: 0, totalFeedback: 0 },
      trends: { views: [], favorites: [] },
    };
  }

  const projectIds = projects.map((p) => p.id);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [viewCounts, favEvents, feedbackCounts, dailyViews, dailyFavorites] =
    await Promise.all([
      db
        .select({
          projectId: pageViewsTable.projectId,
          views: sql<number>`count(*)::int`,
        })
        .from(pageViewsTable)
        .where(sql`${pageViewsTable.projectId} = ANY(${projectIds})`)
        .groupBy(pageViewsTable.projectId),
      db
        .select({
          projectId: analyticsEventsTable.projectId,
          favorites: sql<number>`count(*)::int`,
        })
        .from(analyticsEventsTable)
        .where(
          and(
            sql`${analyticsEventsTable.projectId} = ANY(${projectIds})`,
            eq(analyticsEventsTable.event, "favorite"),
          ),
        )
        .groupBy(analyticsEventsTable.projectId),
      db
        .select({
          projectId: feedbackTable.projectId,
          count: sql<number>`count(*)::int`,
        })
        .from(feedbackTable)
        .where(sql`${feedbackTable.projectId} = ANY(${projectIds})`)
        .groupBy(feedbackTable.projectId),
      db
        .select({
          day: sql<string>`to_char(${pageViewsTable.createdAt}::date, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(pageViewsTable)
        .where(
          and(
            sql`${pageViewsTable.projectId} = ANY(${projectIds})`,
            gte(pageViewsTable.createdAt, thirtyDaysAgo),
          ),
        )
        .groupBy(sql`${pageViewsTable.createdAt}::date`)
        .orderBy(sql`${pageViewsTable.createdAt}::date`),
      db
        .select({
          day: sql<string>`to_char(${analyticsEventsTable.createdAt}::date, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(analyticsEventsTable)
        .where(
          and(
            sql`${analyticsEventsTable.projectId} = ANY(${projectIds})`,
            eq(analyticsEventsTable.event, "favorite"),
            gte(analyticsEventsTable.createdAt, thirtyDaysAgo),
          ),
        )
        .groupBy(sql`${analyticsEventsTable.createdAt}::date`)
        .orderBy(sql`${analyticsEventsTable.createdAt}::date`),
    ]);

  const viewMap: Record<number, number> = {};
  viewCounts.forEach((v) => {
    if (v.projectId) viewMap[v.projectId] = v.views;
  });

  const favMap: Record<number, number> = {};
  favEvents.forEach((f) => {
    if (f.projectId) favMap[f.projectId] = f.favorites;
  });

  const fbMap: Record<number, number> = {};
  feedbackCounts.forEach((f) => {
    if (f.projectId) fbMap[f.projectId] = f.count;
  });

  const projectAnalytics = projects.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    favoriteCount: p.favoriteCount,
    isPublic: p.isPublic,
    isHidden: p.isHidden,
    views: viewMap[p.id] || 0,
    favoriteEvents: favMap[p.id] || 0,
    feedbackCount: fbMap[p.id] || 0,
    createdAt: p.createdAt.toISOString(),
  }));

  const totalViews = Object.values(viewMap).reduce((s, v) => s + v, 0);
  const totalFavorites = projects.reduce((s, p) => s + (p.favoriteCount || 0), 0);
  const visibleCount = projects.filter((p) => p.isPublic && !p.isHidden).length;
  const totalFeedback = Object.values(fbMap).reduce((s, v) => s + v, 0);

  return {
    projects: projectAnalytics,
    summary: {
      totalProjects: projects.length,
      visibleCount,
      totalFavorites,
      totalViews,
      totalFeedback,
    },
    trends: {
      views: dailyViews.map((d) => ({ date: d.day, count: d.count })),
      favorites: dailyFavorites.map((d) => ({ date: d.day, count: d.count })),
    },
  };
}

router.get("/me/projects/analytics", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const analytics = await getUserProjectAnalytics(req.user.id);
    res.json(analytics);
  } catch (err) {
    req.log.error({ err }, "Error getting project analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:userId/analytics", async (req: Request, res: Response) => {
  if (!isMaster(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const userId = req.params.userId;
  if (!userId || typeof userId !== "string" || userId.length > 200) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const analytics = await getUserProjectAnalytics(userId);
    res.json({
      user: { id: user.id, username: user.username, displayName: user.displayName },
      ...analytics,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting user analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users", async (req: Request, res: Response) => {
  if (!isMaster(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : undefined;

  try {
    const conditions = [];
    if (search) {
      const safe = search.replace(/[%_\\]/g, (c) => "\\" + c);
      conditions.push(
        sql`(${usersTable.username} ILIKE ${"%" + safe + "%"} ESCAPE '\\' OR ${usersTable.displayName} ILIKE ${"%" + safe + "%"} ESCAPE '\\' OR ${usersTable.email} ILIKE ${"%" + safe + "%"} ESCAPE '\\')`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [users, countResult] = await Promise.all([
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          username: usersTable.username,
          displayName: usersTable.displayName,
          role: usersTable.role,
          profileImageUrl: usersTable.profileImageUrl,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(where)
        .orderBy(desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(where),
    ]);

    res.json({
      users: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
      total: countResult[0]?.count || 0,
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "Error listing users");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:userId/role", async (req: Request, res: Response) => {
  if (!isMaster(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const userId = req.params.userId;
  if (!userId || typeof userId !== "string" || userId.length > 200) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { role } = req.body;

  if (!role || !VALID_ROLES.has(role)) {
    res.status(400).json({ error: "Invalid role. Must be user, admin, or internal" });
    return;
  }

  if (userId === req.user.id) {
    res.status(400).json({ error: "Cannot change your own role" });
    return;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ role })
      .where(eq(usersTable.id, userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
