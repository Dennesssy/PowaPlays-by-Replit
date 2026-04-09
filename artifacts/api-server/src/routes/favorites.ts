import { Router, type IRouter, type Request, type Response } from "express";
import { db, favoritesTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { AddFavoriteParams, RemoveFavoriteParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/favorites/:projectId", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = AddFavoriteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(favoritesTable)
      .where(
        and(
          eq(favoritesTable.userId, req.user.id),
          eq(favoritesTable.projectId, parsed.data.projectId),
        ),
      );

    if (!existing) {
      await db.insert(favoritesTable).values({
        userId: req.user.id,
        projectId: parsed.data.projectId,
      });
      await db
        .update(projectsTable)
        .set({ favoriteCount: sql`${projectsTable.favoriteCount} + 1` })
        .where(eq(projectsTable.id, parsed.data.projectId));
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

    const parsed = RemoveFavoriteParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(favoritesTable)
        .where(
          and(
            eq(favoritesTable.userId, req.user.id),
            eq(favoritesTable.projectId, parsed.data.projectId),
          ),
        );

      if (existing) {
        await db
          .delete(favoritesTable)
          .where(
            and(
              eq(favoritesTable.userId, req.user.id),
              eq(favoritesTable.projectId, parsed.data.projectId),
            ),
          );
        await db
          .update(projectsTable)
          .set({
            favoriteCount: sql`GREATEST(${projectsTable.favoriteCount} - 1, 0)`,
          })
          .where(eq(projectsTable.id, parsed.data.projectId));
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

  try {
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
      .from(favoritesTable)
      .innerJoin(projectsTable, eq(favoritesTable.projectId, projectsTable.id))
      .leftJoin(usersTable, eq(projectsTable.ownerId, usersTable.id))
      .where(eq(favoritesTable.userId, req.user.id))
      .orderBy(sql`${favoritesTable.createdAt} DESC`);

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
    req.log.error({ err }, "Error listing favorites");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
