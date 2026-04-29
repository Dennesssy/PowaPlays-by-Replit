import { db, projectsTable, usersTable, syncRunsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { raiseAlert, checkSyncHealth } from "./alerting";

const BUILDATHON_SOURCE = "https://buildathons.replit.app";
const ACTIVE_BUILDATHON_URL = `${BUILDATHON_SOURCE}/api/public/buildathons/active`;
const PROJECTS_URL = `${BUILDATHON_SOURCE}/api/public/projects`;
const BATCH_SIZE = 100;
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

interface BuildathonProject {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  demoUrl: string | null;
  replitProjectUrl: string | null;
  videoUrl: string | null;
  websiteUrl: string | null;
  buildathonId: string;
  userId: string;
  displayOrder: number;
  peakFavorites: number;
  createdAt: string;
  updatedAt: string;
  tags: Array<{ id: string; name: string }>;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    profileImageUrl: string | null;
  };
  favoriteCount: number;
  bucksTotal: number;
}

interface BuildathonResponse {
  projects: BuildathonProject[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface ActiveBuildathon {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);
}

function resolveThumbnailUrl(thumb: string | null): string | null {
  if (!thumb) return null;
  if (thumb.startsWith("http")) return thumb;
  return `${BUILDATHON_SOURCE}${thumb}`;
}

async function fetchActiveBuildathon(): Promise<ActiveBuildathon | null> {
  try {
    const res = await fetch(ACTIVE_BUILDATHON_URL);
    if (!res.ok) {
      logger.warn({ status: res.status }, "Failed to fetch active buildathon");
      return null;
    }
    const data = await res.json() as ActiveBuildathon;
    return data;
  } catch (err) {
    logger.error({ err }, "Error fetching active buildathon");
    return null;
  }
}

async function fetchProjectsBatch(buildathonId: string, offset: number): Promise<BuildathonResponse | null> {
  try {
    const url = `${PROJECTS_URL}?buildathonId=${buildathonId}&limit=${BATCH_SIZE}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ status: res.status, offset }, "Failed to fetch projects batch");
      return null;
    }
    return await res.json() as BuildathonResponse;
  } catch (err) {
    logger.error({ err, offset }, "Error fetching projects batch");
    return null;
  }
}

async function ensureSystemUser(): Promise<string> {
  const systemId = "buildathon-sync";
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, systemId));

  if (!existing) {
    await db.insert(usersTable).values({
      id: systemId,
      username: "buildathon-sync",
      displayName: "Buildathon Sync",
      role: "system",
    });
  }
  return systemId;
}

function buildProjectValues(project: BuildathonProject, systemUserId: string) {
  const tags = project.tags?.map((t) => t.name) || [];
  const slug = slugify(project.name || project.id);
  const url = project.demoUrl || project.replitProjectUrl || project.websiteUrl || "";
  const thumbnailUrl = resolveThumbnailUrl(project.thumbnailUrl);
  const displayName = project.user?.displayName ||
    [project.user?.firstName, project.user?.lastName].filter(Boolean).join(" ") ||
    `user-${project.userId}`;
  const ownerUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, "") || `u${project.userId}`;

  return {
    externalId: project.id,
    ownerId: systemUserId,
    title: project.name || "Untitled",
    slug,
    url,
    demoUrl: project.demoUrl || null,
    replitUrl: project.replitProjectUrl || null,
    description: project.description || null,
    tags: tags,
    thumbnailUrl,
    videoUrl: project.videoUrl || null,
    favoriteCount: project.favoriteCount || 0,
    buildathonId: project.buildathonId,
    ownerDisplayName: displayName,
    ownerAvatarUrl: project.user?.profileImageUrl || null,
    ownerUsername: ownerUsername,
    isPublic: true,
    isHidden: false,
    syncedAt: new Date(),
  };
}

async function upsertBatch(
  projects: BuildathonProject[],
  systemUserId: string,
): Promise<{ inserted: number; updated: number; errors: number }> {
  if (projects.length === 0) return { inserted: 0, updated: 0, errors: 0 };

  const values = projects.map((p) => buildProjectValues(p, systemUserId));

  try {
    const results = await db
      .insert(projectsTable)
      .values(values)
      .onConflictDoUpdate({
        target: projectsTable.externalId,
        set: {
          title: sql`EXCLUDED.title`,
          description: sql`EXCLUDED.description`,
          tags: sql`EXCLUDED.tags`,
          thumbnailUrl: sql`EXCLUDED.thumbnail_url`,
          videoUrl: sql`EXCLUDED.video_url`,
          demoUrl: sql`EXCLUDED.demo_url`,
          replitUrl: sql`EXCLUDED.replit_url`,
          favoriteCount: sql`EXCLUDED.favorite_count`,
          ownerDisplayName: sql`EXCLUDED.owner_display_name`,
          ownerAvatarUrl: sql`EXCLUDED.owner_avatar_url`,
          ownerUsername: sql`EXCLUDED.owner_username`,
          url: sql`EXCLUDED.url`,
          syncedAt: sql`EXCLUDED.synced_at`,
        },
      })
      .returning({ id: projectsTable.id, wasInserted: sql<boolean>`(xmax::text::bigint = 0)` });

    const inserted = results.filter((r) => r.wasInserted).length;
    return { inserted, updated: results.length - inserted, errors: 0 };
  } catch (err) {
    logger.error({ err, batchSize: projects.length }, "Batch upsert failed, falling back to individual upserts");
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    for (const project of projects) {
      try {
        const v = buildProjectValues(project, systemUserId);
        const [r] = await db
          .insert(projectsTable)
          .values(v)
          .onConflictDoUpdate({
            target: projectsTable.externalId,
            set: {
              title: v.title,
              description: v.description,
              tags: v.tags,
              thumbnailUrl: v.thumbnailUrl,
              videoUrl: v.videoUrl,
              demoUrl: v.demoUrl,
              replitUrl: v.replitUrl,
              favoriteCount: v.favoriteCount,
              ownerDisplayName: v.ownerDisplayName,
              ownerAvatarUrl: v.ownerAvatarUrl,
              ownerUsername: v.ownerUsername,
              url: v.url,
              syncedAt: v.syncedAt,
            },
          })
          .returning({ id: projectsTable.id, wasInserted: sql<boolean>`(xmax::text::bigint = 0)` });
        if (r.wasInserted) inserted++;
        else updated++;
      } catch (rowErr) {
        errors++;
        logger.error({ err: rowErr, projectId: project.id }, "Individual upsert failed");
      }
    }
    return { inserted, updated, errors };
  }
}

export async function syncBuildathonProjects(): Promise<{ synced: number; total: number; errors: number; runId: number }> {
  const startTime = Date.now();
  logger.info("Starting buildathon project sync...");

  const [run] = await db.insert(syncRunsTable).values({
    source: "buildathon",
    status: "running",
    startedAt: new Date(),
  }).returning();

  const runId = run.id;

  try {
    const buildathon = await fetchActiveBuildathon();
    if (!buildathon) {
      await db.update(syncRunsTable)
        .set({ status: "skipped", completedAt: new Date(), durationMs: Date.now() - startTime, errorMessage: "No active buildathon found" })
        .where(eq(syncRunsTable.id, runId));
      logger.warn("No active buildathon found, skipping sync");
      return { synced: 0, total: 0, errors: 0, runId };
    }

    await db.update(syncRunsTable)
      .set({ buildathonId: buildathon.id, buildathonName: buildathon.name })
      .where(eq(syncRunsTable.id, runId));

    logger.info({ buildathonId: buildathon.id, name: buildathon.name }, "Found active buildathon");

    const systemUserId = await ensureSystemUser();
    let offset = 0;
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    let total = 0;
    let batches = 0;
    let fetched = 0;

    while (true) {
      const batch = await fetchProjectsBatch(buildathon.id, offset);
      if (!batch || batch.projects.length === 0) break;

      if (batch.total > 0) total = batch.total;
      batches++;
      fetched += batch.projects.length;

      const batchResult = await upsertBatch(batch.projects, systemUserId);
      inserted += batchResult.inserted;
      updated += batchResult.updated;
      errors += batchResult.errors;

      await db.update(syncRunsTable)
        .set({ recordsFetched: fetched, recordsInserted: inserted, recordsUpdated: updated, recordsErrored: errors, batchesProcessed: batches, remoteTotal: total })
        .where(eq(syncRunsTable.id, runId));

      logger.info({ offset, batchSize: batch.projects.length, synced: inserted + updated, total }, "Synced batch");

      if (!batch.hasMore) break;
      offset = batch.nextOffset ?? offset + BATCH_SIZE;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const durationMs = Date.now() - startTime;
    await db.update(syncRunsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        durationMs,
        recordsFetched: fetched,
        recordsInserted: inserted,
        recordsUpdated: updated,
        recordsErrored: errors,
        batchesProcessed: batches,
        remoteTotal: total,
      })
      .where(eq(syncRunsTable.id, runId));

    const elapsed = (durationMs / 1000).toFixed(1);
    logger.info({ inserted, updated, total, errors, elapsedSeconds: elapsed, runId }, "Buildathon sync complete");

    if (errors > 0 && errors > fetched * 0.05) {
      await raiseAlert("warning", "sync", "Elevated sync errors", `${errors}/${fetched} records failed to sync`, "buildathon-sync", { runId });
    }

    return { synced: inserted + updated, total, errors, runId };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(syncRunsTable)
      .set({ status: "failed", completedAt: new Date(), durationMs, errorMessage: errorMsg })
      .where(eq(syncRunsTable.id, runId));

    await raiseAlert("critical", "sync", "Sync crashed", errorMsg, "buildathon-sync", { runId });
    logger.error({ err, runId }, "Buildathon sync crashed");
    throw err;
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startSyncScheduler(): void {
  if (syncTimer) clearInterval(syncTimer);

  logger.info({ intervalMs: SYNC_INTERVAL_MS }, "Starting buildathon sync scheduler");

  setTimeout(() => {
    syncBuildathonProjects().catch((err) => {
      logger.error({ err }, "Initial sync failed");
    });
  }, 5000);

  syncTimer = setInterval(async () => {
    try {
      await syncBuildathonProjects();
      await checkSyncHealth();
    } catch (err) {
      logger.error({ err }, "Scheduled sync failed");
    }
  }, SYNC_INTERVAL_MS);
}

export function stopSyncScheduler(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    logger.info("Buildathon sync scheduler stopped");
  }
}
