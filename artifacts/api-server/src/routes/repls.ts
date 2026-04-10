import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getSessionId, getSession, updateSession } from "../lib/auth";

const router: IRouter = Router();

const replsCache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const rateLimitBuckets = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_FETCHES_PER_USER = 5;
const GLOBAL_MAX_FETCHES = 30;
let globalFetchTimestamps: number[] = [];

function cleanupCaches() {
  const now = Date.now();
  if (replsCache.size > CACHE_MAX_ENTRIES) {
    for (const [k, v] of replsCache) {
      if (v.expires < now) replsCache.delete(k);
    }
  }
  if (rateLimitBuckets.size > 1000) {
    const cutoff = now - RATE_LIMIT_WINDOW;
    for (const [k, v] of rateLimitBuckets) {
      const filtered = v.filter((t) => t > cutoff);
      if (filtered.length === 0) rateLimitBuckets.delete(k);
      else rateLimitBuckets.set(k, filtered);
    }
  }
}

setInterval(cleanupCaches, 60000);

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW;

  globalFetchTimestamps = globalFetchTimestamps.filter((t) => t > cutoff);
  if (globalFetchTimestamps.length >= GLOBAL_MAX_FETCHES) return true;

  const userTs = (rateLimitBuckets.get(userId) || []).filter((t) => t > cutoff);
  rateLimitBuckets.set(userId, userTs);
  if (userTs.length >= MAX_FETCHES_PER_USER) return true;

  userTs.push(now);
  globalFetchTimestamps.push(now);
  return false;
}

function sanitizeUsername(username: string): string | null {
  if (!username || typeof username !== "string") return null;
  const clean = username.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return clean.length > 0 ? clean : null;
}

async function fetchReplDetail(safeUsername: string, slug: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `https://replit.com/@${encodeURIComponent(safeUsername)}/${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "POWAPLAY/1.0", "Accept": "text/html" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return null;
    let nextData: Record<string, unknown>;
    try { nextData = JSON.parse(scriptMatch[1]); } catch { return null; }
    const apolloState: Record<string, unknown> = (nextData?.props as Record<string, unknown>)?.apolloState as Record<string, unknown> || (((nextData?.props as Record<string, unknown>)?.pageProps as Record<string, unknown>)?.apolloState as Record<string, unknown>) || {};
    for (const [key, value] of Object.entries(apolloState)) {
      const v = value as Record<string, unknown>;
      if (key.startsWith("Repl:") && v.__typename === "Repl" && typeof v.slug === "string") {
        const rawCreatedAt = v.timeCreated ?? v.publishedAt ?? v.createdAt ?? null;
        const rawHostedUrl = v.hostedUrl ?? v.deploymentUrl ?? v.customDomain ?? null;
        return {
          isPublic: v.isPrivate === false || v.isPublic === true,
          isPrivate: !!v.isPrivate,
          createdAt: typeof rawCreatedAt === "string" || typeof rawCreatedAt === "number" ? new Date(rawCreatedAt as string).toISOString() : null,
          demoUrl: typeof rawHostedUrl === "string" && /^https?:\/\//i.test(rawHostedUrl) ? rawHostedUrl : null,
          description: typeof v.description === "string" ? v.description.slice(0, 1000) : null,
          iconUrl: typeof v.iconUrl === "string" && /^https?:\/\//i.test(v.iconUrl) ? v.iconUrl : null,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchUserRepls(username: string): Promise<unknown[]> {
  const cached = replsCache.get(username);
  if (cached && cached.expires > Date.now()) {
    return cached.data as unknown[];
  }

  try {
    const safeUsername = sanitizeUsername(username);
    if (!safeUsername) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `https://replit.com/@${encodeURIComponent(safeUsername)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "POWAPLAY/1.0",
        "Accept": "text/html",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn({ status: res.status, username: safeUsername }, "Failed to fetch Replit profile");
      return [];
    }

    const html = await res.text();

    const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      logger.warn({ username: safeUsername }, "No __NEXT_DATA__ found on profile page");
      return [];
    }

    let nextData;
    try {
      nextData = JSON.parse(scriptMatch[1]);
    } catch {
      logger.warn({ username: safeUsername }, "Failed to parse __NEXT_DATA__");
      return [];
    }

    const apolloState = nextData?.props?.apolloState || nextData?.props?.pageProps?.apolloState || {};

    const repls: unknown[] = [];
    for (const [key, value] of Object.entries(apolloState)) {
      const v = value as Record<string, unknown>;
      if (
        key.startsWith("Repl:") &&
        v.__typename === "Repl" &&
        v.isPublished !== false
      ) {
        const title = typeof v.title === "string" ? v.title.slice(0, 200) : "Untitled";
        const slug = typeof v.slug === "string" ? v.slug.slice(0, 200) : (typeof v.title === "string" ? v.title.slice(0, 200) : "");
        const rawCreatedAt = v.timeCreated ?? v.publishedAt ?? v.createdAt ?? null;
        const createdAt = typeof rawCreatedAt === "string" || typeof rawCreatedAt === "number"
          ? new Date(rawCreatedAt as string).toISOString()
          : null;
        const isPublic = v.isPrivate === false || v.isPublic === true || (!v.isPrivate && v.isPublished !== false);
        const rawHostedUrl = v.hostedUrl ?? v.deploymentUrl ?? v.customDomain ?? null;
        const demoUrl = typeof rawHostedUrl === "string" && /^https?:\/\//i.test(rawHostedUrl) ? rawHostedUrl : null;
        repls.push({
          id: v.id || key.replace("Repl:", ""),
          title,
          slug,
          description: typeof v.description === "string" ? v.description.slice(0, 1000) : null,
          iconUrl: typeof v.iconUrl === "string" && /^https?:\/\//i.test(v.iconUrl) ? v.iconUrl : null,
          url: `https://replit.com/@${safeUsername}/${encodeURIComponent(slug)}`,
          demoUrl,
          language: (v.language as string) || ((v.templateInfo as Record<string, unknown>)?.label as string) || null,
          isPublished: true,
          isPublic,
          createdAt,
        });
      }
    }

    const DETAIL_FETCH_LIMIT = 10;
    const toEnrich = repls.slice(0, DETAIL_FETCH_LIMIT) as Array<Record<string, unknown>>;
    const detailResults = await Promise.allSettled(
      toEnrich.map((r) => fetchReplDetail(safeUsername, r.slug as string)),
    );

    const enriched: unknown[] = repls.map((repl, i) => {
      const r = repl as Record<string, unknown>;
      if (i >= DETAIL_FETCH_LIMIT) {
        return (r.isPublic === true) ? r : null;
      }
      const detail = detailResults[i].status === "fulfilled" ? detailResults[i].value : null;
      if (!detail) {
        return (r.isPublic === true) ? r : null;
      }
      if (detail.isPrivate === true || detail.isPublic !== true) return null;
      return {
        ...r,
        isPublic: true,
        createdAt: detail.createdAt ?? r.createdAt,
        demoUrl: detail.demoUrl ?? r.demoUrl,
        description: detail.description ?? r.description,
        iconUrl: detail.iconUrl ?? r.iconUrl,
      };
    }).filter(Boolean);

    replsCache.set(username, { data: enriched, expires: Date.now() + CACHE_TTL });
    return enriched;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn({ username }, "Replit profile fetch timed out");
    } else {
      logger.error({ err, username }, "Error fetching Replit profile");
    }
    return [];
  }
}

router.get("/me/repls", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const username = req.user.username;
  if (!username) {
    res.json({ repls: [], message: "No Replit username found on your account" });
    return;
  }

  try {
    const cached = replsCache.get(username);
    const isCacheHit = cached && cached.expires > Date.now();
    if (!isCacheHit && isRateLimited(req.user.id)) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    const repls = await fetchUserRepls(username);

    const existingProjects = await db
      .select({ replitUrl: projectsTable.replitUrl, slug: projectsTable.slug })
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.user.id));

    const importedSlugs = new Set(existingProjects.map((p) => p.slug));
    const importedUrls = new Set(existingProjects.map((p) => p.replitUrl).filter(Boolean));

    const replsWithStatus = (repls as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      imported: importedSlugs.has(r.slug as string) || importedUrls.has(r.url as string),
    }));

    res.json({ repls: replsWithStatus, username });
  } catch (err) {
    req.log.error({ err }, "Error fetching user repls");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/repls/import", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { replId, slug } = req.body;
  if (!slug || typeof slug !== "string") {
    res.status(400).json({ error: "slug is required" });
    return;
  }

  if (slug.length > 200) {
    res.status(400).json({ error: "slug too long" });
    return;
  }

  const username = req.user.username;
  if (!username) {
    res.status(400).json({ error: "No Replit username on your account" });
    return;
  }

  try {
    const canonical = await fetchUserRepls(username);
    const match = (canonical as Array<Record<string, unknown>>).find(
      (r) =>
        r.slug === slug || r.id === replId,
    );

    if (!match || match.isPublic !== true) {
      res.status(403).json({
        error: "This repl does not belong to your Replit profile or is not public",
      });
      return;
    }

    const safeSlug = match.slug as string;
    const safeTitle = match.title as string;
    const safeUrl = `https://replit.com/@${encodeURIComponent(username)}/${encodeURIComponent(safeSlug)}`;

    const [existing] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.ownerId, req.user.id),
          eq(projectsTable.slug, safeSlug),
        ),
      );

    if (existing) {
      res.status(409).json({ error: "Project already imported", project: { id: existing.id } });
      return;
    }

    const [project] = await db
      .insert(projectsTable)
      .values({
        ownerId: req.user.id,
        replitProjectId: (match.id as string) || null,
        title: safeTitle,
        slug: safeSlug,
        url: safeUrl,
        replitUrl: safeUrl,
        description: (match.description as string) || null,
        thumbnailUrl: (match.iconUrl as string) || null,
        tags: [],
        isPublic: true,
        isHidden: false,
        ownerUsername: username,
        ownerDisplayName: req.user.firstName || username,
        ownerAvatarUrl: req.user.profileImageUrl || null,
      })
      .returning();

    res.status(201).json({
      ...project,
      tags: project.tags || [],
      createdAt: project.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error importing repl");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/onboarding/complete", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await db
      .update(usersTable)
      .set({ onboardingCompleted: true })
      .where(eq(usersTable.id, req.user.id));

    const sid = getSessionId(req);
    if (sid) {
      const session = await getSession(sid);
      if (session) {
        session.user.onboardingCompleted = true;
        await updateSession(sid, session);
      }
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error completing onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
