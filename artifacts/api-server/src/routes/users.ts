import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, projectsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user: req.user });
});

router.get("/users/:username/profile", async (req: Request, res: Response) => {
  const username = req.params.username as string;
  if (!username) {
    res.status(400).json({ error: "Invalid username" });
    return;
  }

  try {
    const [user] = await db
      .select()
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
    const username = req.params.username as string;
    if (!username) {
      res.status(400).json({ error: "Invalid username" });
      return;
    }

    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, username));

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const projects = await db
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
        .where(
          and(
            eq(projectsTable.ownerId, user.id),
            eq(projectsTable.isPublic, true),
            eq(projectsTable.isHidden, false),
          ),
        )
        .orderBy(sql`${projectsTable.createdAt} DESC`);

      res.json({
        projects: projects.map((p) => ({
          ...p,
          tags: (p.tags as string[]) || [],
          ownerUsername: p.ownerUsername || "unknown",
          ownerAvatarUrl: p.ownerAvatarUrl || null,
          createdAt: p.createdAt.toISOString(),
        })),
        total: projects.length,
      });
    } catch (err) {
      req.log.error({ err }, "Error listing user projects");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
