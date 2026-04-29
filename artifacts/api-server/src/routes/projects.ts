import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql, or, ilike, desc } from "drizzle-orm";

const router: IRouter = Router();

const tagsCache: { data: unknown; expires: number } = { data: null, expires: 0 };
const TAGS_CACHE_TTL = 5 * 60 * 1000;

const projectsCache = new Map<string, { data: unknown; expires: number }>();
const PROJECTS_CACHE_TTL = 5 * 60 * 1000;

function isInternal(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

function sanitizeSearch(input: string): string {
  return input.replace(/[%_\\]/g, (c) => "\\" + c).slice(0, 200);
}

const VALID_SORT = new Set(["popular", "newest"]);
const MAX_LIMIT = 2000;

router.get("/projects", async (req: Request, res: Response) => {
  const tag = typeof req.query.tag === "string" ? req.query.tag.slice(0, 100) : undefined;
  const style = typeof req.query.style === "string" ? req.query.style.slice(0, 50) : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;
  const sort = VALID_SORT.has(req.query.sort as string) ? (req.query.sort as string) : "popular";

  const cacheKey = `${page}:${limit}:${sort}:${tag || ""}:${style || ""}:${search || ""}`;
  const cached = projectsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    res.json(cached.data);
    return;
  }

  try {
    const conditions = [
      eq(projectsTable.isPublic, true),
      eq(projectsTable.isHidden, false),
    ];

    if (search) {
      const safe = sanitizeSearch(search);
      conditions.push(
        or(
          sql`${projectsTable.title} ILIKE ${"%" + safe + "%"} ESCAPE '\\'`,
          sql`${projectsTable.description} ILIKE ${"%" + safe + "%"} ESCAPE '\\'`,
        )!,
      );
    }

    if (tag) {
      conditions.push(sql`${projectsTable.tags}::jsonb @> ${JSON.stringify([tag])}::jsonb`);
    }

    if (style) {
      conditions.push(ilike(projectsTable.style, style));
    }

    const whereClause = and(...conditions);

    const [projects, countResult] = await Promise.all([
      db
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
        .where(whereClause)
        .orderBy(
          sort === "newest"
            ? desc(projectsTable.createdAt)
            : sql`${projectsTable.favoriteCount} DESC, ${projectsTable.createdAt} DESC`,
        )
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectsTable)
        .where(whereClause),
    ]);

    const response = {
      projects: projects.map((p) => ({
        ...p,
        tags: (p.tags as string[]) || [],
        ownerUsername: p.ownerUsername || "unknown",
        ownerAvatarUrl: p.ownerAvatarUrl || null,
        createdAt: p.createdAt.toISOString(),
      })),
      total: countResult[0]?.count || 0,
    };

    projectsCache.set(cacheKey, { data: response, expires: Date.now() + PROJECTS_CACHE_TTL });
    if (projectsCache.size > 50) {
      let oldestKey: string | undefined;
      let oldestExpires = Infinity;
      for (const [k, v] of projectsCache) {
        if (v.expires < oldestExpires) { oldestExpires = v.expires; oldestKey = k; }
      }
      if (oldestKey) projectsCache.delete(oldestKey);
    }

    res.json(response);
  } catch (err) {
    req.log.error({ err }, "Error listing projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/tags", async (req: Request, res: Response) => {
  try {
    if (tagsCache.data && tagsCache.expires > Date.now()) {
      res.json({ tags: tagsCache.data });
      return;
    }

    const result = await db.execute(
      sql`SELECT value, COUNT(*)::int as count FROM projects, jsonb_array_elements_text(tags) AS value WHERE is_public = true AND is_hidden = false GROUP BY value ORDER BY count DESC LIMIT 50`,
    );
    tagsCache.data = result.rows;
    tagsCache.expires = Date.now() + TAGS_CACHE_TTL;
    res.json({ tags: result.rows });
  } catch (err) {
    req.log.error({ err }, "Error listing tags");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id) || id < 1) {
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

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100));
  const offset = (page - 1) * limit;

  try {
    const ownerCondition = eq(projectsTable.ownerId, req.user.id);

    const [projects, countResult] = await Promise.all([
      db
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
        .where(ownerCondition)
        .orderBy(desc(projectsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectsTable)
        .where(ownerCondition),
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
});

router.patch("/me/projects/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id) || id < 1) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const { isHidden, description, tags, style } = req.body;

  if (tags !== undefined && !Array.isArray(tags)) {
    res.status(400).json({ error: "tags must be an array" });
    return;
  }

  if (tags && tags.length > 20) {
    res.status(400).json({ error: "Maximum 20 tags allowed" });
    return;
  }

  if (description !== undefined && typeof description === "string" && description.length > 5000) {
    res.status(400).json({ error: "Description too long (max 5000 chars)" });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: projectsTable.id })
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
    if (isHidden !== undefined) updateData.isHidden = Boolean(isHidden);
    if (description !== undefined) updateData.description = typeof description === "string" ? description.slice(0, 5000) : description;
    if (tags !== undefined) updateData.tags = tags.map((t: unknown) => String(t).slice(0, 50));
    if (style !== undefined) updateData.style = typeof style === "string" ? style.slice(0, 50) : style;

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
