import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql, or, ilike } from "drizzle-orm";

const router: IRouter = Router();

function isInternal(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

router.get("/projects", async (req: Request, res: Response) => {
  const tag = req.query.tag as string | undefined;
  const style = req.query.style as string | undefined;
  const search = req.query.search as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  try {
    const conditions = [
      eq(projectsTable.isPublic, true),
      eq(projectsTable.isHidden, false),
    ];

    if (search) {
      conditions.push(
        or(
          ilike(projectsTable.title, `%${search}%`),
          ilike(projectsTable.description, `%${search}%`),
        )!,
      );
    }

    if (tag) {
      conditions.push(sql`${projectsTable.tags}::jsonb @> ${JSON.stringify([tag])}::jsonb`);
    }

    if (style) {
      conditions.push(ilike(projectsTable.style, style));
    }

    const projects = await db
      .select({
        id: projectsTable.id,
        title: projectsTable.title,
        slug: projectsTable.slug,
        url: projectsTable.url,
        demoUrl: projectsTable.demoUrl,
        description: projectsTable.description,
        tags: projectsTable.tags,
        style: projectsTable.style,
        isPublic: projectsTable.isPublic,
        isHidden: projectsTable.isHidden,
        thumbnailUrl: projectsTable.thumbnailUrl,
        previewVideoUrl: projectsTable.previewVideoUrl,
        videoUrl: projectsTable.videoUrl,
        favoriteCount: projectsTable.favoriteCount,
        ownerId: projectsTable.ownerId,
        ownerUsername: projectsTable.ownerUsername,
        ownerDisplayName: projectsTable.ownerDisplayName,
        ownerAvatarUrl: projectsTable.ownerAvatarUrl,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(and(...conditions))
      .orderBy(sql`${projectsTable.favoriteCount} DESC, ${projectsTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(and(...conditions));

    res.json({
      projects: projects.map((p) => ({
        ...p,
        tags: (p.tags as string[]) || [],
        ownerUsername: p.ownerUsername || "unknown",
        ownerAvatarUrl: p.ownerAvatarUrl || null,
        createdAt: p.createdAt.toISOString(),
      })),
      total: countResult?.count || 0,
    });
  } catch (err) {
    req.log.error({ err }, "Error listing projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/tags", async (req: Request, res: Response) => {
  try {
    const result = await db.execute(
      sql`SELECT value, COUNT(*)::int as count FROM projects, jsonb_array_elements_text(tags) AS value WHERE is_public = true AND is_hidden = false GROUP BY value ORDER BY count DESC LIMIT 50`
    );
    res.json({ tags: result.rows });
  } catch (err) {
    req.log.error({ err }, "Error listing tags");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  try {
    const [project] = await db
      .select({
        id: projectsTable.id,
        title: projectsTable.title,
        slug: projectsTable.slug,
        url: projectsTable.url,
        demoUrl: projectsTable.demoUrl,
        replitUrl: projectsTable.replitUrl,
        description: projectsTable.description,
        tags: projectsTable.tags,
        style: projectsTable.style,
        isPublic: projectsTable.isPublic,
        isHidden: projectsTable.isHidden,
        thumbnailUrl: projectsTable.thumbnailUrl,
        previewVideoUrl: projectsTable.previewVideoUrl,
        videoUrl: projectsTable.videoUrl,
        favoriteCount: projectsTable.favoriteCount,
        ownerId: projectsTable.ownerId,
        ownerUsername: projectsTable.ownerUsername,
        ownerDisplayName: projectsTable.ownerDisplayName,
        ownerAvatarUrl: projectsTable.ownerAvatarUrl,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, id));

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.isHidden || !project.isPublic) {
      const isOwner = req.isAuthenticated() && req.user.id === project.ownerId;
      if (!isOwner && !isInternal(req)) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
    }

    res.json({
      ...project,
      tags: (project.tags as string[]) || [],
      ownerUsername: project.ownerUsername || "unknown",
      ownerAvatarUrl: project.ownerAvatarUrl || null,
      createdAt: project.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me/projects", async (req: Request, res: Response) => {
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
        demoUrl: projectsTable.demoUrl,
        description: projectsTable.description,
        tags: projectsTable.tags,
        style: projectsTable.style,
        isPublic: projectsTable.isPublic,
        isHidden: projectsTable.isHidden,
        thumbnailUrl: projectsTable.thumbnailUrl,
        previewVideoUrl: projectsTable.previewVideoUrl,
        favoriteCount: projectsTable.favoriteCount,
        ownerUsername: projectsTable.ownerUsername,
        ownerAvatarUrl: projectsTable.ownerAvatarUrl,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.user.id))
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
});

router.patch("/me/projects/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const { isHidden, description, tags, style } = req.body;

  try {
    const [existing] = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.id, id),
          eq(projectsTable.ownerId, req.user.id),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (isHidden !== undefined) updateData.isHidden = isHidden;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) updateData.tags = tags;
    if (style !== undefined) updateData.style = style;

    const [updated] = await db
      .update(projectsTable)
      .set(updateData)
      .where(eq(projectsTable.id, id))
      .returning();

    res.json({
      ...updated,
      tags: (updated.tags as string[]) || [],
      ownerUsername: updated.ownerUsername || "unknown",
      ownerAvatarUrl: updated.ownerAvatarUrl || null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
