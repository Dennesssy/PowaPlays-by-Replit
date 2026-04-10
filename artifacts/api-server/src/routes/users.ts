import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, projectsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user: req.user });
});

router.get("/users/:username/profile", async (req: Request, res: Response) => {
  const username = typeof req.params.username === "string" ? req.params.username.slice(0, 100) : "";
  if (!username) {
    res.status(400).json({ error: "Invalid username" });
    return;
  }

  try {
    const [user] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        firstName: usersTable.firstName,
        profileImageUrl: usersTable.profileImageUrl,
        bio: usersTable.bio,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.username, username));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.ownerId, user.id),
          eq(projectsTable.isPublic, true),
          eq(projectsTable.isHidden, false),
        ),
      );

    res.json({
      id: user.id,
      username: user.username || user.id,
      displayName: user.displayName || user.firstName || user.username,
      avatarUrl: user.profileImageUrl,
      bio: user.bio,
      projectCount: countResult?.count || 0,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/users/:username/projects",
  async (req: Request, res: Response) => {
    const username = typeof req.params.username === "string" ? req.params.username.slice(0, 100) : "";
    if (!username) {
      res.status(400).json({ error: "Invalid username" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    try {
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username));

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const userProjectCondition = and(
        eq(projectsTable.ownerId, user.id),
        eq(projectsTable.isPublic, true),
        eq(projectsTable.isHidden, false),
      );

      const [projects, countResult] = await Promise.all([
        db
          .select({
            id: projectsTable.id,
            title: projectsTable.title,
            slug: projectsTable.slug,
            url: projectsTable.url,
            description: projectsTable.description,
            tags: projectsTable.tags,
            style: projectsTable.style,
            isPublic: projectsTable.isPublic,
            isHidden: projectsTable.isHidden,
            thumbnailUrl: projectsTable.thumbnailUrl,
            previewVideoUrl: projectsTable.previewVideoUrl,
            favoriteCount: projectsTable.favoriteCount,
            ownerUsername: usersTable.username,
            ownerAvatarUrl: usersTable.profileImageUrl,
            createdAt: projectsTable.createdAt,
          })
          .from(projectsTable)
          .leftJoin(usersTable, eq(projectsTable.ownerId, usersTable.id))
          .where(userProjectCondition)
          .orderBy(desc(projectsTable.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectsTable)
          .where(userProjectCondition),
      ]);

      res.json({
        projects: projects.map((p) => ({
          ...p,
          tags: (p.tags as string[]) || [],
          ownerUsername: p.ownerUsername || "unknown",
          ownerAvatarUrl: p.ownerAvatarUrl || null,
          createdAt: p.createdAt.toISOString(),
        })),
        total: countResult[0]?.count || 0,
      });
    } catch (err) {
      req.log.error({ err }, "Error listing user projects");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
