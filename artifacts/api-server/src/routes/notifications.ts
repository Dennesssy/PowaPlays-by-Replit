import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/me/notifications", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.recipientId, req.user.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    const [unreadResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        sql`${notificationsTable.recipientId} = ${req.user.id} AND ${notificationsTable.readAt} IS NULL`,
      );

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
      unreadCount: unreadResult?.count || 0,
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
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid notification ID" });
    return;
  }

  try {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        sql`${notificationsTable.id} = ${id} AND ${notificationsTable.recipientId} = ${req.user.id}`,
      );

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error marking notification as read");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
