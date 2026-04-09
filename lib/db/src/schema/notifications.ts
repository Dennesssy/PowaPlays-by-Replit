import { pgTable, serial, varchar, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { feedbackTable } from "./feedback";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientId: varchar("recipient_id").notNull().references(() => usersTable.id),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  body: text("body"),
  feedbackId: integer("feedback_id").references(() => feedbackTable.id),
  actionUrl: varchar("action_url"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("IDX_notif_recipient").on(table.recipientId),
  index("IDX_notif_read").on(table.readAt),
]);

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
