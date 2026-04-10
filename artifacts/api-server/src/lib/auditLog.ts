import { db, auditLogTable } from "@workspace/db";
import { type Request } from "express";
import { logger } from "./logger";

export async function audit(
  req: Request,
  action: string,
  resource: string,
  resourceId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: req.isAuthenticated() ? req.user.id : null,
      actorRole: req.isAuthenticated() ? req.user.role || "user" : "anonymous",
      action,
      resource,
      resourceId: resourceId || null,
      details: details || {},
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (err) {
    logger.error({ err, action, resource }, "Failed to write audit log");
  }
}
