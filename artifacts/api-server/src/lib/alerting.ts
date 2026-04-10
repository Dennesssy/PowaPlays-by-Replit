import { db, alertsTable, syncRunsTable } from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { logger } from "./logger";

type Severity = "info" | "warning" | "critical";

export async function raiseAlert(
  severity: Severity,
  category: string,
  title: string,
  message: string,
  source?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(alertsTable).values({
      severity,
      category,
      title,
      message,
      source: source || null,
      metadata: metadata || {},
    });
    logger.warn({ severity, category, title }, "Alert raised");
  } catch (err) {
    logger.error({ err, category, title }, "Failed to raise alert");
  }
}

export async function checkSyncHealth(): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const [latestRun] = await db
    .select()
    .from(syncRunsTable)
    .orderBy(sql`${syncRunsTable.startedAt} DESC`)
    .limit(1);

  if (!latestRun) return;

  if (latestRun.startedAt < twoHoursAgo && latestRun.status !== "running") {
    await raiseAlert(
      "warning",
      "sync",
      "Sync stale",
      `Last sync completed ${Math.round((Date.now() - latestRun.startedAt.getTime()) / 60000)}min ago`,
      "sync-health-check",
    );
  }

  if (latestRun.status === "failed") {
    await raiseAlert(
      "critical",
      "sync",
      "Sync failed",
      latestRun.errorMessage || "Unknown error",
      "sync-health-check",
      { runId: latestRun.id },
    );
  }

  if (latestRun.recordsErrored > 0 && latestRun.recordsErrored > latestRun.recordsFetched * 0.1) {
    await raiseAlert(
      "warning",
      "sync",
      "High sync error rate",
      `${latestRun.recordsErrored}/${latestRun.recordsFetched} records errored (${Math.round(latestRun.recordsErrored / latestRun.recordsFetched * 100)}%)`,
      "sync-health-check",
      { runId: latestRun.id },
    );
  }
}

export async function checkSystemHealth(memoryMb: number, errorRate: number): Promise<void> {
  if (memoryMb > 400) {
    await raiseAlert(
      "warning",
      "system",
      "High memory usage",
      `Heap memory at ${memoryMb}MB`,
      "system-health-check",
    );
  }

  if (errorRate > 10) {
    await raiseAlert(
      "critical",
      "system",
      "High error rate",
      `HTTP error rate at ${errorRate}%`,
      "system-health-check",
    );
  }
}
