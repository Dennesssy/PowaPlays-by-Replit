import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { projectsTable } from "./projects";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  type: varchar("type").notNull().default("general"),
  status: varchar("status").notNull().default("open"),
  priority: varchar("priority").notNull().default("normal"),
  title: varchar("title").notNull(),
  body: text("body").notNull(),
  submitterId: varchar("submitter_id").references(() => usersTable.id),
  submitterEmail: varchar("submitter_email"),
  submitterName: varchar("submitter_name"),
  projectId: integer("project_id").references(() => projectsTable.id),
  url: varchar("url"),
  userAgent: varchar("user_agent"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  assigneeId: varchar("assignee_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("IDX_feedback_status").on(table.status),
  index("IDX_feedback_type").on(table.type),
  index("IDX_feedback_submitter").on(table.submitterId),
  index("IDX_feedback_assignee").on(table.assigneeId),
]);

export type Feedback = typeof feedbackTable.$inferSelect;
export type InsertFeedback = typeof feedbackTable.$inferInsert;

export const feedbackResponsesTable = pgTable("feedback_responses", {
  id: serial("id").primaryKey(),
  feedbackId: integer("feedback_id").notNull().references(() => feedbackTable.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  isInternal: varchar("is_internal").notNull().default("false"),
  newStatus: varchar("new_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("IDX_fb_resp_feedback").on(table.feedbackId),
]);

export type FeedbackResponse = typeof feedbackResponsesTable.$inferSelect;
export type InsertFeedbackResponse = typeof feedbackResponsesTable.$inferInsert;
