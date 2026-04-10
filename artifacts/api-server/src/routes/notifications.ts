import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me/notifications", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [notifications, unreadResult] = await Promise.all([
      db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.recipientId, req.user.id))
        .orderBy(desc(notificationsTable.createdAt))
        .limit(50),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.recipientId, req.user.id),
            sql`${notificationsTable.readAt} IS NULL`,
          ),
        ),
    ]);

    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        feedbackId: n.feedbackId,
        actionUrl: n.actionUrl,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: unreadResult[0]?.count || 0,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/notifications/:id/read", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id) || id < 1) {
    res.status(400).json({ error: "Invalid notification ID" });
    return;
  }

  try {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.recipientId, req.user.id),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error marking notification as read");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/notifications/read-all", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.recipientId, req.user.id),
          sql`${notificationsTable.readAt} IS NULL`,
        ),
      );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error marking all notifications as read");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
