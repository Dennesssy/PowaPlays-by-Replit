import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { projectsTable } from "./projects";

export const analyticsEventsTable = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  event: varchar("event").notNull(),
  sessionId: varchar("session_id"),
  userId: varchar("user_id").references(() => usersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  path: varchar("path"),
  referrer: varchar("referrer"),
  userAgent: varchar("user_agent"),
  ip: varchar("ip"),
  country: varchar("country"),
  device: varchar("device"),
  browser: varchar("browser"),
  os: varchar("os"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("IDX_ae_event").on(table.event),
  index("IDX_ae_session").on(table.sessionId),
  index("IDX_ae_project").on(table.projectId),
  index("IDX_ae_created").on(table.createdAt),
]);

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;

export const errorEventsTable = pgTable("error_events", {
  id: serial("id").primaryKey(),
  level: varchar("level").notNull().default("error"),
  message: text("message").notNull(),
  stack: text("stack"),
  fingerprint: varchar("fingerprint"),
  projectId: integer("project_id").references(() => projectsTable.id),
  userId: varchar("user_id").references(() => usersTable.id),
  path: varchar("path"),
  userAgent: varchar("user_agent"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  occurrences: integer("occurrences").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("IDX_ee_level").on(table.level),
  index("IDX_ee_fingerprint").on(table.fingerprint),
  index("IDX_ee_project").on(table.projectId),
]);

export type ErrorEvent = typeof errorEventsTable.$inferSelect;
export type InsertErrorEvent = typeof errorEventsTable.$inferInsert;

export const pageViewsTable = pgTable("page_views", {
  id: serial("id").primaryKey(),
  path: varchar("path").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  sessionId: varchar("session_id"),
  userId: varchar("user_id").references(() => usersTable.id),
  referrer: varchar("referrer"),
  duration: integer("duration"),
  scrollDepth: integer("scroll_depth"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("IDX_pv_path").on(table.path),
  index("IDX_pv_created").on(table.createdAt),
]);

export type PageView = typeof pageViewsTable.$inferSelect;
