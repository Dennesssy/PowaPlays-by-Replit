import { Router, type IRouter, type Request, type Response } from "express";
import { db, favoritesTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.post("/favorites/:projectId", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projectId = parseInt(req.params.projectId as string);
  if (isNaN(projectId) || projectId < 1) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  try {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [existing] = await db
      .select({ id: favoritesTable.id })
      .from(favoritesTable)
      .where(
        and(
          eq(favoritesTable.userId, req.user.id),
          eq(favoritesTable.projectId, projectId),
        ),
      );

    if (!existing) {
      await db.insert(favoritesTable).values({
        userId: req.user.id,
        projectId,
      });
      await db
        .update(projectsTable)
        .set({ favoriteCount: sql`${projectsTable.favoriteCount} + 1` })
        .where(eq(projectsTable.id, projectId));
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error adding favorite");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete(
  "/favorites/:projectId",
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const projectId = parseInt(req.params.projectId as string);
    if (isNaN(projectId) || projectId < 1) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    try {
      const [existing] = await db
        .select({ id: favoritesTable.id })
        .from(favoritesTable)
        .where(
          and(
            eq(favoritesTable.userId, req.user.id),
            eq(favoritesTable.projectId, projectId),
          ),
        );

      if (existing) {
        await db
          .delete(favoritesTable)
          .where(
            and(
              eq(favoritesTable.userId, req.user.id),
              eq(favoritesTable.projectId, projectId),
            ),
          );
        await db
          .update(projectsTable)
          .set({
            favoriteCount: sql`GREATEST(${projectsTable.favoriteCount} - 1, 0)`,
          })
          .where(eq(projectsTable.id, projectId));
      }

      res.json({ success: true });
    } catch (err) {
      req.log.error({ err }, "Error removing favorite");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/me/favorites", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  try {
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
        .from(favoritesTable)
        .innerJoin(projectsTable, eq(favoritesTable.projectId, projectsTable.id))
        .leftJoin(usersTable, eq(projectsTable.ownerId, usersTable.id))
        .where(eq(favoritesTable.userId, req.user.id))
        .orderBy(desc(favoritesTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(favoritesTable)
        .where(eq(favoritesTable.userId, req.user.id)),
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
    req.log.error({ err }, "Error listing favorites");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
