import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id),
  replitProjectId: varchar("replit_project_id"),
  title: varchar("title").notNull(),
  slug: varchar("slug").notNull(),
  url: varchar("url").notNull(),
  description: text("description"),
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
  style: varchar("style"),
  isPublic: boolean("is_public").notNull().default(true),
  isHidden: boolean("is_hidden").notNull().default(false),
  thumbnailUrl: varchar("thumbnail_url"),
  previewVideoUrl: varchar("preview_video_url"),
  previewStatus: varchar("preview_status").default("pending"),
  favoriteCount: integer("favorite_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;

export const favoritesTable = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Favorite = typeof favoritesTable.$inferSelect;

export const previewJobsTable = pgTable("preview_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  status: varchar("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
