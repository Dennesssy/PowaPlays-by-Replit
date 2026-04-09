import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql, or, ilike } from "drizzle-orm";
import {
  ListProjectsQueryParams,
  GetProjectParams,
  UpdateMyProjectBody,
  UpdateMyProjectParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (req: Request, res: Response) => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  const tag = parsed.success ? parsed.data.tag : undefined;
  const style = parsed.success ? parsed.data.style : undefined;
  const search = parsed.success ? parsed.data.search : undefined;
  const page = parsed.success && parsed.data.page ? parsed.data.page : 1;
  const limit = parsed.success && parsed.data.limit ? parsed.data.limit : 50;
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
      .where(and(...conditions))
      .orderBy(sql`${projectsTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    let filtered = projects;
    if (tag) {
      filtered = filtered.filter((p) => {
        const t = (p.tags as string[]) || [];
        return t.some((x) => x.toLowerCase() === tag.toLowerCase());
      });
    }
    if (style) {
      filtered = filtered.filter(
        (p) => p.style?.toLowerCase() === style.toLowerCase(),
      );
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(
        and(eq(projectsTable.isPublic, true), eq(projectsTable.isHidden, false)),
      );

    res.json({
      projects: filtered.map((p) => ({
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

router.get("/projects/:id", async (req: Request, res: Response) => {
  const parsed = GetProjectParams.safeParse(req.params);
  if (!parsed.success) {
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
      .where(eq(projectsTable.id, parsed.data.id));

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
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

  const paramsParsed = UpdateMyProjectParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const bodyParsed = UpdateMyProjectBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.id, paramsParsed.data.id),
          eq(projectsTable.ownerId, req.user.id),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (bodyParsed.data.isHidden !== undefined)
      updateData.isHidden = bodyParsed.data.isHidden;
    if (bodyParsed.data.description !== undefined)
      updateData.description = bodyParsed.data.description;
    if (bodyParsed.data.tags !== undefined)
      updateData.tags = bodyParsed.data.tags;
    if (bodyParsed.data.style !== undefined)
      updateData.style = bodyParsed.data.style;

    const [updated] = await db
      .update(projectsTable)
      .set(updateData)
      .where(eq(projectsTable.id, paramsParsed.data.id))
      .returning();

    const [withUser] = await db
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
      .where(eq(projectsTable.id, updated.id));

    res.json({
      ...withUser,
      tags: (withUser.tags as string[]) || [],
      ownerUsername: withUser.ownerUsername || "unknown",
      ownerAvatarUrl: withUser.ownerAvatarUrl || null,
      createdAt: withUser.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
