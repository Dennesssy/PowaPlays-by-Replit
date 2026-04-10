import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, timestamp, integer, jsonb, index, real, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const syncRunsTable = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  source: varchar("source").notNull().default("buildathon"),
  status: varchar("status").notNull().default("running"),
  buildathonId: varchar("buildathon_id"),
  buildathonName: varchar("buildathon_name"),
  recordsFetched: integer("records_fetched").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsErrored: integer("records_errored").notNull().default(0),
  remoteTotal: integer("remote_total").notNull().default(0),
  batchesProcessed: integer("batches_processed").notNull().default(0),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_sync_runs_status").on(table.status),
  index("idx_sync_runs_source").on(table.source),
  index("idx_sync_runs_started").on(table.startedAt),
]);

export type SyncRun = typeof syncRunsTable.$inferSelect;
export type InsertSyncRun = typeof syncRunsTable.$inferInsert;

export const systemMetricsTable = pgTable("system_metrics", {
  id: serial("id").primaryKey(),
  metric: varchar("metric").notNull(),
  value: real("value").notNull(),
  unit: varchar("unit"),
  tags: jsonb("tags").default(sql`'{}'::jsonb`),
  bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_sm_metric").on(table.metric),
  index("idx_sm_bucket").on(table.bucketAt),
  index("idx_sm_metric_bucket").on(table.metric, table.bucketAt),
]);

export type SystemMetric = typeof systemMetricsTable.$inferSelect;

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: varchar("actor_id").references(() => usersTable.id),
  actorRole: varchar("actor_role"),
  action: varchar("action").notNull(),
  resource: varchar("resource").notNull(),
  resourceId: varchar("resource_id"),
  details: jsonb("details").default(sql`'{}'::jsonb`),
  ip: varchar("ip"),
  userAgent: varchar("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_audit_actor").on(table.actorId),
  index("idx_audit_action").on(table.action),
  index("idx_audit_resource").on(table.resource),
  index("idx_audit_created").on(table.createdAt),
]);

export type AuditLogEntry = typeof auditLogTable.$inferSelect;

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  severity: varchar("severity").notNull().default("warning"),
  category: varchar("category").notNull(),
  title: varchar("title").notNull(),
  message: text("message"),
  source: varchar("source"),
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedBy: varchar("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_alerts_severity").on(table.severity),
  index("idx_alerts_category").on(table.category),
  index("idx_alerts_resolved").on(table.isResolved),
  index("idx_alerts_created").on(table.createdAt),
]);

export type Alert = typeof alertsTable.$inferSelect;

export const rateLimitsTable = pgTable("rate_limits", {
  id: serial("id").primaryKey(),
  key: varchar("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(1),
  limit: integer("limit_value").notNull().default(100),
}, (table) => [
  index("idx_rl_key").on(table.key),
  index("idx_rl_window").on(table.windowStart),
]);
