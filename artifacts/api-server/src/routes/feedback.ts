import { Router, type IRouter, type Request, type Response } from "express";
import { db, feedbackTable, feedbackResponsesTable, usersTable, notificationsTable, projectsTable } from "@workspace/db";
import { eq, and, or, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

function isInternal(req: Request): boolean {
  return req.isAuthenticated() && (req.user.role === "internal" || req.user.role === "admin");
}

function isProjectOwner(req: Request, projectOwnerId: string): boolean {
  return req.isAuthenticated() && req.user.id === projectOwnerId;
}

router.get("/feedback", async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const type = req.query.type as string | undefined;
  const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
  const ownerId = req.query.ownerId as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  try {
    const conditions = [];

    if (isInternal(req)) {
      if (ownerId) {
        const ownerProjects = await db
          .select({ id: projectsTable.id })
          .from(projectsTable)
          .where(eq(projectsTable.ownerId, ownerId));
        const ownerProjectIds = ownerProjects.map((p) => p.id);
        if (ownerProjectIds.length > 0) {
          conditions.push(sql`${feedbackTable.projectId} = ANY(${ownerProjectIds})`);
        } else {
          res.json({ items: [], total: 0, ownerMetrics: null });
          return;
        }
      }
    } else if (req.isAuthenticated()) {
      const myProjects = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.ownerId, req.user.id));
      const myProjectIds = myProjects.map((p) => p.id);

      conditions.push(
        or(
          eq(feedbackTable.submitterId, req.user.id),
          myProjectIds.length > 0
            ? sql`${feedbackTable.projectId} = ANY(${myProjectIds})`
            : sql`false`,
        )!,
      );
    } else {
      res.json({ items: [], total: 0, ownerMetrics: null });
      return;
    }

    if (status) conditions.push(eq(feedbackTable.status, status));
    if (type) conditions.push(eq(feedbackTable.type, type));
    if (projectId) conditions.push(eq(feedbackTable.projectId, projectId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        id: feedbackTable.id,
        type: feedbackTable.type,
        status: feedbackTable.status,
        priority: feedbackTable.priority,
        title: feedbackTable.title,
        body: feedbackTable.body,
        submitterName: feedbackTable.submitterName,
        submitterEmail: feedbackTable.submitterEmail,
        projectId: feedbackTable.projectId,
        assigneeName: usersTable.displayName,
        resolvedAt: feedbackTable.resolvedAt,
        createdAt: feedbackTable.createdAt,
        updatedAt: feedbackTable.updatedAt,
      })
      .from(feedbackTable)
      .leftJoin(usersTable, eq(feedbackTable.assigneeId, usersTable.id))
      .where(where)
      .orderBy(desc(feedbackTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackTable)
      .where(where);

    const feedbackIds = items.map((i) => i.id);
    let responseCounts: Record<number, number> = {};
    if (feedbackIds.length > 0) {
      const counts = await db
        .select({
          feedbackId: feedbackResponsesTable.feedbackId,
          count: sql<number>`count(*)::int`,
        })
        .from(feedbackResponsesTable)
        .where(sql`${feedbackResponsesTable.feedbackId} = ANY(${feedbackIds})`)
        .groupBy(feedbackResponsesTable.feedbackId);
      counts.forEach((c) => { responseCounts[c.feedbackId] = c.count; });
    }

    const projectIds = [...new Set(items.map((i) => i.projectId).filter(Boolean))] as number[];
    let projectNames: Record<number, string> = {};
    if (projectIds.length > 0) {
      const projects = await db
        .select({ id: projectsTable.id, title: projectsTable.title })
        .from(projectsTable)
        .where(sql`${projectsTable.id} = ANY(${projectIds})`);
      projects.forEach((p) => { projectNames[p.id] = p.title; });
    }

    res.json({
      items: items.map((i) => ({
        ...i,
        projectTitle: i.projectId ? (projectNames[i.projectId] || null) : null,
        responseCount: responseCounts[i.id] || 0,
        resolvedAt: i.resolvedAt?.toISOString() || null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
      total: countResult?.count || 0,
    });
  } catch (err) {
    req.log.error({ err }, "Error listing feedback");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/feedback", async (req: Request, res: Response) => {
  const { type, title, body, projectId, email, name, url } = req.body;

  if (!type || !title || !body) {
    res.status(400).json({ error: "type, title, and body are required" });
    return;
  }

  try {
    const [item] = await db.insert(feedbackTable).values({
      type,
      title,
      body,
      projectId: projectId || null,
      submitterId: req.isAuthenticated() ? req.user.id : null,
      submitterEmail: req.isAuthenticated() ? req.user.email : (email || null),
      submitterName: req.isAuthenticated() ? (req.user.firstName || req.user.email) : (name || "Anonymous"),
      url: url || null,
      userAgent: req.headers["user-agent"] || null,
    }).returning();

    const notifyTargets: string[] = [];

    if (projectId) {
      const [project] = await db
        .select({ ownerId: projectsTable.ownerId })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId));
      if (project && project.ownerId !== (req.isAuthenticated() ? req.user.id : null)) {
        notifyTargets.push(project.ownerId);
      }
    }

    const internalUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`${usersTable.role} IN ('internal', 'admin')`);
    internalUsers.forEach((u) => {
      if (!notifyTargets.includes(u.id)) notifyTargets.push(u.id);
    });

    if (notifyTargets.length > 0) {
      await db.insert(notificationsTable).values(
        notifyTargets.map((uid) => ({
          recipientId: uid,
          type: "new_feedback",
          title: `New ${type}: ${title}`,
          body: body.slice(0, 200),
          feedbackId: item.id,
          actionUrl: `/feedback/${item.id}`,
        })),
      );
    }

    res.status(201).json({
      ...item,
      projectTitle: null,
      responseCount: 0,
      assigneeName: null,
      resolvedAt: null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error submitting feedback");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/feedback/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid feedback ID" });
    return;
  }

  try {
    const [item] = await db
      .select({
        id: feedbackTable.id,
        type: feedbackTable.type,
        status: feedbackTable.status,
        priority: feedbackTable.priority,
        title: feedbackTable.title,
        body: feedbackTable.body,
        submitterId: feedbackTable.submitterId,
        submitterName: feedbackTable.submitterName,
        submitterEmail: feedbackTable.submitterEmail,
        projectId: feedbackTable.projectId,
        assigneeName: usersTable.displayName,
        resolvedAt: feedbackTable.resolvedAt,
        createdAt: feedbackTable.createdAt,
        updatedAt: feedbackTable.updatedAt,
      })
      .from(feedbackTable)
      .leftJoin(usersTable, eq(feedbackTable.assigneeId, usersTable.id))
      .where(eq(feedbackTable.id, id));

    if (!item) {
      res.status(404).json({ error: "Feedback not found" });
      return;
    }

    let canView = isInternal(req);
    if (!canView && req.isAuthenticated()) {
      if (item.submitterId === req.user.id) canView = true;
      if (!canView && item.projectId) {
        const [proj] = await db
          .select({ ownerId: projectsTable.ownerId })
          .from(projectsTable)
          .where(eq(projectsTable.id, item.projectId));
        if (proj && proj.ownerId === req.user.id) canView = true;
      }
    }

    if (!canView) {
      res.status(404).json({ error: "Feedback not found" });
      return;
    }

    let responseConditions = [eq(feedbackResponsesTable.feedbackId, id)];
    if (!isInternal(req)) {
      responseConditions.push(eq(feedbackResponsesTable.isInternal, "false"));
    }

    const responses = await db
      .select({
        id: feedbackResponsesTable.id,
        feedbackId: feedbackResponsesTable.feedbackId,
        body: feedbackResponsesTable.body,
        isInternal: feedbackResponsesTable.isInternal,
        newStatus: feedbackResponsesTable.newStatus,
        createdAt: feedbackResponsesTable.createdAt,
        authorName: usersTable.displayName,
        authorRole: usersTable.role,
      })
      .from(feedbackResponsesTable)
      .leftJoin(usersTable, eq(feedbackResponsesTable.authorId, usersTable.id))
      .where(and(...responseConditions))
      .orderBy(feedbackResponsesTable.createdAt);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackResponsesTable)
      .where(eq(feedbackResponsesTable.feedbackId, id));

    let projectTitle = null;
    if (item.projectId) {
      const [p] = await db
        .select({ title: projectsTable.title })
        .from(projectsTable)
        .where(eq(projectsTable.id, item.projectId));
      projectTitle = p?.title || null;
    }

    res.json({
      feedback: {
        id: item.id,
        type: item.type,
        status: item.status,
        priority: item.priority,
        title: item.title,
        body: item.body,
        submitterName: item.submitterName,
        submitterEmail: item.submitterEmail,
        projectId: item.projectId,
        projectTitle,
        assigneeName: item.assigneeName,
        responseCount: countResult?.count || 0,
        resolvedAt: item.resolvedAt?.toISOString() || null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
      responses: responses.map((r) => ({
        ...r,
        authorName: r.authorName || "Unknown",
        authorRole: r.authorRole || "user",
        isInternal: r.isInternal === "true",
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting feedback");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/feedback/:id/respond", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid feedback ID" });
    return;
  }

  const { body: responseBody, isInternal: isInternalNote, newStatus } = req.body;
  if (!responseBody) {
    res.status(400).json({ error: "body is required" });
    return;
  }

  try {
    const [fb] = await db
      .select()
      .from(feedbackTable)
      .where(eq(feedbackTable.id, id));

    if (!fb) {
      res.status(404).json({ error: "Feedback not found" });
      return;
    }

    let canRespond = isInternal(req) || fb.submitterId === req.user.id;
    if (!canRespond && fb.projectId) {
      const [proj] = await db
        .select({ ownerId: projectsTable.ownerId })
        .from(projectsTable)
        .where(eq(projectsTable.id, fb.projectId));
      if (proj && proj.ownerId === req.user.id) canRespond = true;
    }

    if (!canRespond) {
      res.status(403).json({ error: "Not authorized to respond" });
      return;
    }

    if (isInternalNote && !isInternal(req)) {
      res.status(403).json({ error: "Only internal users can post internal notes" });
      return;
    }

    const [response] = await db.insert(feedbackResponsesTable).values({
      feedbackId: id,
      authorId: req.user.id,
      body: responseBody,
      isInternal: isInternalNote ? "true" : "false",
      newStatus: newStatus || null,
    }).returning();

    if (newStatus) {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === "resolved" || newStatus === "closed") {
        updateData.resolvedAt = new Date();
      }
      await db.update(feedbackTable).set(updateData).where(eq(feedbackTable.id, id));
    }

    const notifyTargets: string[] = [];

    if (fb.submitterId && fb.submitterId !== req.user.id && !isInternalNote) {
      notifyTargets.push(fb.submitterId);
    }

    if (fb.projectId) {
      const [proj] = await db
        .select({ ownerId: projectsTable.ownerId })
        .from(projectsTable)
        .where(eq(projectsTable.id, fb.projectId));
      if (proj && proj.ownerId !== req.user.id && !notifyTargets.includes(proj.ownerId)) {
        notifyTargets.push(proj.ownerId);
      }
    }

    if (notifyTargets.length > 0) {
      await db.insert(notificationsTable).values(
        notifyTargets.map((uid) => ({
          recipientId: uid,
          type: newStatus ? "feedback_status_changed" : "feedback_response",
          title: newStatus
            ? `Feedback "${fb.title}" is now ${newStatus}`
            : `New response on "${fb.title}"`,
          body: responseBody.slice(0, 200),
          feedbackId: id,
          actionUrl: `/feedback/${id}`,
        })),
      );
    }

    res.status(201).json({
      ...response,
      authorName: req.user.firstName || req.user.email || "Unknown",
      authorRole: req.user.role || "user",
      isInternal: isInternalNote || false,
      createdAt: response.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error responding to feedback");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/feedback/:id/status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid feedback ID" });
    return;
  }

  const { status, assigneeId } = req.body;
  if (!status) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  try {
    const [fb] = await db.select().from(feedbackTable).where(eq(feedbackTable.id, id));
    if (!fb) {
      res.status(404).json({ error: "Feedback not found" });
      return;
    }

    let canUpdate = isInternal(req);
    if (!canUpdate && fb.projectId) {
      const [proj] = await db
        .select({ ownerId: projectsTable.ownerId })
        .from(projectsTable)
        .where(eq(projectsTable.id, fb.projectId));
      if (proj && proj.ownerId === req.user.id) canUpdate = true;
    }

    if (!canUpdate) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const updateData: Record<string, unknown> = { status };
    if (assigneeId) updateData.assigneeId = assigneeId;
    if (status === "resolved" || status === "closed") {
      updateData.resolvedAt = new Date();
    }

    const [updated] = await db
      .update(feedbackTable)
      .set(updateData)
      .where(eq(feedbackTable.id, id))
      .returning();

    if (updated.submitterId) {
      await db.insert(notificationsTable).values({
        recipientId: updated.submitterId,
        type: "feedback_status_changed",
        title: `Your feedback "${updated.title}" is now ${status}`,
        feedbackId: id,
        actionUrl: `/feedback/${id}`,
      });
    }

    res.json({
      ...updated,
      projectTitle: null,
      responseCount: 0,
      assigneeName: null,
      resolvedAt: updated.resolvedAt?.toISOString() || null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating feedback status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/feedback/overview", async (req: Request, res: Response) => {
  if (!isInternal(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const userStats = await db
      .select({
        ownerId: projectsTable.ownerId,
        ownerUsername: usersTable.username,
        ownerDisplayName: usersTable.displayName,
        ownerAvatar: usersTable.profileImageUrl,
        totalFeedback: sql<number>`count(DISTINCT ${feedbackTable.id})::int`,
        openFeedback: sql<number>`count(DISTINCT CASE WHEN ${feedbackTable.status} = 'open' THEN ${feedbackTable.id} END)::int`,
        acknowledgedFeedback: sql<number>`count(DISTINCT CASE WHEN ${feedbackTable.status} = 'acknowledged' THEN ${feedbackTable.id} END)::int`,
        resolvedFeedback: sql<number>`count(DISTINCT CASE WHEN ${feedbackTable.status} IN ('resolved', 'closed') THEN ${feedbackTable.id} END)::int`,
        totalResponses: sql<number>`(
          SELECT count(*)::int FROM feedback_responses fr
          INNER JOIN feedback f2 ON fr.feedback_id = f2.id
          WHERE f2.project_id = ANY(
            SELECT p2.id FROM projects p2 WHERE p2.owner_id = ${projectsTable.ownerId}
          )
          AND fr.author_id = ${projectsTable.ownerId}
        )`,
        avgResponseTimeHours: sql<number>`(
          SELECT COALESCE(
            EXTRACT(EPOCH FROM AVG(
              (SELECT MIN(fr3.created_at) FROM feedback_responses fr3 WHERE fr3.feedback_id = f3.id AND fr3.author_id = ${projectsTable.ownerId})
              - f3.created_at
            )) / 3600,
            0
          )::int
          FROM feedback f3
          WHERE f3.project_id = ANY(
            SELECT p3.id FROM projects p3 WHERE p3.owner_id = ${projectsTable.ownerId}
          )
          AND EXISTS(SELECT 1 FROM feedback_responses fr4 WHERE fr4.feedback_id = f3.id AND fr4.author_id = ${projectsTable.ownerId})
        )`,
      })
      .from(feedbackTable)
      .innerJoin(projectsTable, eq(feedbackTable.projectId, projectsTable.id))
      .innerJoin(usersTable, eq(projectsTable.ownerId, usersTable.id))
      .groupBy(projectsTable.ownerId, usersTable.username, usersTable.displayName, usersTable.profileImageUrl)
      .orderBy(sql`count(DISTINCT CASE WHEN ${feedbackTable.status} = 'open' THEN ${feedbackTable.id} END) DESC`);

    const [globalCounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(CASE WHEN ${feedbackTable.status} = 'open' THEN 1 END)::int`,
        acknowledged: sql<number>`count(CASE WHEN ${feedbackTable.status} = 'acknowledged' THEN 1 END)::int`,
        inProgress: sql<number>`count(CASE WHEN ${feedbackTable.status} = 'in_progress' THEN 1 END)::int`,
        resolved: sql<number>`count(CASE WHEN ${feedbackTable.status} IN ('resolved', 'closed') THEN 1 END)::int`,
      })
      .from(feedbackTable);

    const neglectedUsers = userStats
      .filter((u) => u.openFeedback > 0 && u.totalResponses === 0)
      .map((u) => ({
        ownerId: u.ownerId,
        username: u.ownerUsername,
        displayName: u.ownerDisplayName,
        openCount: u.openFeedback,
      }));

    res.json({
      globalCounts: globalCounts || { total: 0, open: 0, acknowledged: 0, inProgress: 0, resolved: 0 },
      userStats: userStats.map((u) => ({
        ownerId: u.ownerId,
        username: u.ownerUsername,
        displayName: u.ownerDisplayName,
        avatar: u.ownerAvatar,
        totalFeedback: u.totalFeedback,
        openFeedback: u.openFeedback,
        acknowledgedFeedback: u.acknowledgedFeedback,
        resolvedFeedback: u.resolvedFeedback,
        totalResponses: u.totalResponses,
        avgResponseTimeHours: u.avgResponseTimeHours,
        responseRate: u.totalFeedback > 0 ? Math.round((u.resolvedFeedback / u.totalFeedback) * 100) : 0,
      })),
      neglectedUsers,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting admin feedback overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
