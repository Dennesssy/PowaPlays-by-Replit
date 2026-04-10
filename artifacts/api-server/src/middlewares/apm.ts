import { type Request, type Response, type NextFunction } from "express";
import { db, systemMetricsTable } from "@workspace/db";
import { logger } from "../lib/logger";

let requestCount = 0;
let errorCount = 0;
let totalLatencyMs = 0;
let latencies: number[] = [];
const statusCodes: Record<string, number> = {};
const pathCounts: Record<string, number> = {};

export function apmMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    requestCount++;
    totalLatencyMs += elapsed;
    latencies.push(elapsed);

    const code = String(res.statusCode);
    statusCodes[code] = (statusCodes[code] || 0) + 1;

    if (res.statusCode >= 400) errorCount++;

    const basePath = (req.route?.path || req.path || "/").split("?")[0];
    const method = req.method;
    const key = `${method} ${basePath}`;
    pathCounts[key] = (pathCounts[key] || 0) + 1;
  });

  next();
}

export function getApmSnapshot() {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const avgLatency = requestCount > 0 ? totalLatencyMs / requestCount : 0;
  const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;

  return {
    requestCount,
    errorCount,
    errorRate: Math.round(errorRate * 100) / 100,
    avgLatencyMs: Math.round(avgLatency * 100) / 100,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
    statusCodes: { ...statusCodes },
    topPaths: Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, count })),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10,
    rssMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10,
  };
}

export async function flushMetrics(): Promise<void> {
  const now = new Date();
  const snapshot = getApmSnapshot();

  const metrics = [
    { metric: "http.requests", value: snapshot.requestCount, unit: "count" },
    { metric: "http.errors", value: snapshot.errorCount, unit: "count" },
    { metric: "http.error_rate", value: snapshot.errorRate, unit: "percent" },
    { metric: "http.latency.avg", value: snapshot.avgLatencyMs, unit: "ms" },
    { metric: "http.latency.p50", value: snapshot.p50Ms, unit: "ms" },
    { metric: "http.latency.p95", value: snapshot.p95Ms, unit: "ms" },
    { metric: "http.latency.p99", value: snapshot.p99Ms, unit: "ms" },
    { metric: "process.memory.heap", value: snapshot.memoryMb, unit: "MB" },
    { metric: "process.memory.rss", value: snapshot.rssMemoryMb, unit: "MB" },
    { metric: "process.uptime", value: snapshot.uptimeSeconds, unit: "seconds" },
  ];

  try {
    await db.insert(systemMetricsTable).values(
      metrics.map((m) => ({
        ...m,
        bucketAt: now,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Failed to flush APM metrics");
  }

  requestCount = 0;
  errorCount = 0;
  totalLatencyMs = 0;
  latencies = [];
  Object.keys(statusCodes).forEach((k) => delete statusCodes[k]);
  Object.keys(pathCounts).forEach((k) => delete pathCounts[k]);
}

let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startMetricsFlush(intervalMs = 60_000): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    flushMetrics().catch((err) => logger.error({ err }, "Metrics flush error"));
  }, intervalMs);
  logger.info({ intervalMs }, "APM metrics flush started");
}

export function stopMetricsFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
