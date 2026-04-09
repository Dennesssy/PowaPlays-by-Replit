# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: Pure HTML/CSS/JS (no React, no Vite, no frontend npm deps)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## POWAPLAY by Replit

PWA marketplace / decentralized app store. Replit projects appear as a pannable wall of live app tiles.

### Architecture

- **API Server** (`artifacts/api-server`): Express 5 on port 8080 — serves both `/api/*` routes AND the static frontend from `artifacts/powaplay/public/`
- **Frontend** (`artifacts/powaplay/public/`): Pure vanilla HTML/CSS/JS — no build step, no framework
- **Powaplay artifact** routes `/` to port 8080 (the API server)
- **API Server artifact** routes `/api` to port 8080
- Both share the same Express server instance

### Frontend Files

- `public/index.html` — SPA shell with all page sections
- `public/css/style.css` — Complete dark theme styles
- `public/js/api.js` — API client wrapper
- `public/js/router.js` — Client-side SPA router
- `public/js/auth.js` — Auth state management
- `public/js/canvas.js` — Omnidirectional panning canvas engine
- `public/js/feedback.js` — Feedback inbox, thread view, submit form, admin overview
- `public/js/notifications.js` — Notification bell with polling
- `public/js/app.js` — Main app init, routing, page controllers

### Routes (Frontend)

- `/` — Discover page (pannable canvas wall)
- `/feedback` — Feedback inbox (auth-gated)
- `/feedback/:id` — Feedback thread/conversation
- `/dashboard` — Project management (auth-gated)
- `/admin` — Admin oversight dashboard (internal/admin only)
- `/u/:username` — Public user profile

### Database Schema

Tables: `sessions`, `users`, `projects`, `favorites`, `preview_jobs`, `feedback`, `feedback_responses`, `analytics_events`, `error_events`, `page_views`, `notifications`

Key fields:
- `users.role`: "user" (default) | "internal" | "admin"
- `users.username`, `displayName`, `bio`, `publicProfileEnabled`
- `feedback.projectId` links to projects table
- `feedback_responses.isInternal` for private internal notes

### Two-Tier Observable Feedback Framework

1. **Project-owner level**: Visitors submit feedback on specific projects. Project owners see all feedback on their projects and can respond privately, creating a direct communication channel. Owners can change feedback status (open/acknowledged/in_progress/resolved/closed).

2. **Global admin/internal level**: Internal Replit users see ALL feedback across all users. The admin overview (`/admin` page, backed by `/api/admin/feedback/overview`) shows:
   - Global counts (total, open, acknowledged, in-progress, resolved)
   - Per-user metrics: total feedback, open count, resolved count, response rate %, avg response time
   - Neglected users list (users with open feedback and zero responses)
   - Drill-down into any user's feedback

### Auth

Replit Auth (OIDC PKCE). Username auto-generated from email prefix. Role field in session/user object.

### Design

Dark theme. Accent: `#e0ff65`. No emojis. Font: Inter + JetBrains Mono.

### Express 5 Notes

- Catch-all route uses `/{*path}` syntax (not `*`)
