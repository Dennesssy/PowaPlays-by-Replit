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
- `public/css/style.css` — White/glass theme styles
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

Replit Auth (OIDC PKCE). Username sourced from OIDC `username` claim (falls back to email prefix). Users with @replit.com emails are auto-promoted to admin role. Role field in session/user object. `onboardingCompleted` flag controls first-login modal.

### Roles

- `user` (default): Can see My Projects, import repls, view personal analytics
- `admin`: Everything users see, plus Platform analytics tab (admin dashboard data)
- `internal` (master): Everything admins see, plus Users tab (role management, view-as-user), System tab (APM, sync, alerts, audit)

### Dashboard Tabs (role-gated)

- **My Projects**: All authenticated users — project list with visibility toggle
- **Import from Replit**: All authenticated users — fetches public repls from replit.com server-side
- **Analytics**: All authenticated users — per-project views, favorites, feedback counts
- **Platform**: Admin/Master only — platform-wide stats (projects, users, feedback, errors, alerts, APM)
- **Users**: Master only — user list, role assignment, "view as user" analytics
- **System**: Master only — live APM, sync health, alerts, audit log

### Design

White/glass theme (godly.website inspired). Filter is a floating dark glassmorphism popup (not a persistent bar). Grid fills full viewport. Desktop: centered modal filter. Mobile: bottom sheet filter. Cmd+K keyboard shortcut to open filter. Font: Inter + JetBrains Mono. Accent for mobile pill nav: teal/green (#2ecca4). Search input border: teal accent.

### Security & Performance Audit (Applied)

**Backend Security (25 fixes)**:
- CORS restricted to allowed origins in production (env `ALLOWED_ORIGINS`)
- Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- Express body size limit: 1MB for JSON and URL-encoded
- `x-powered-by` header disabled
- Feedback validation: type whitelist, title max 500 chars, body max 10000 chars, email format check
- Feedback response validation: body max 10000 chars, status whitelist
- Project tags: validated as array, max 20 items, each max 50 chars
- Project description max 5000 chars
- Analytics events: event type whitelist, rate limiting per client+event
- User management: cannot change own role, userId length validation
- Repl import: username sanitization, URL encoding
- Favorites: project existence check before favoriting
- Search SQL injection prevention: special chars escaped in ILIKE patterns
- Notification mark-read: uses proper AND conditions instead of raw SQL template

**Performance (25 fixes)**:
- `/me/projects`: added LIMIT/OFFSET pagination
- `/users/:username/projects`: added LIMIT/OFFSET pagination
- `/me/favorites`: added LIMIT/OFFSET pagination
- `/admin/analytics`: all 6 queries parallelized with Promise.all
- `projectAnalytics.ts`: 5 sequential queries parallelized with Promise.all
- `/me/notifications`: list + unread count parallelized
- `/admin/users`: list + count parallelized
- `/feedback/:id`: responses + count + project lookup parallelized
- Tags cache: 5-minute TTL in-memory cache
- Repl cache: periodic cleanup of expired entries (60s interval)
- Rate limit bucket cleanup: periodic gc for stale entries
- UA parser cache: LRU-like cache (1000 entries)
- DB indexes added: projects(owner_id), projects(is_public, is_hidden), projects(created_at), projects(favorite_count), feedback(project_id), feedback(created_at)
- Repl fetch: 10-second AbortController timeout
- Response limits on feedback responses (max 200 per thread)
- Project analytics: 500 project limit per user query

**API/URL Audit (25 fixes)**:
- All API.js URL parameters use encodeURIComponent
- API error handling: parses server JSON error messages instead of generic "HTTP {status}"
- XSS: feedback.js _renderFeedbackRow uses escapeHtml on all dynamic fields
- XSS: feedback.js showThread uses escapeHtml on title, type, status, names
- XSS: feedback.js showAdminOverview uses escapeHtml on all user data
- XSS: feedback.js inline onclick replaced with data attributes + event listeners
- XSS: notifications.js uses escapeHtml on title, body, actionUrl
- XSS: auth.js uses escapeHtml on user name and avatar URL
- Notifications: actionUrl validated to start with "/" before navigating
- Notification panel: skip redundant mark-read if already read
- Feedback submit form: maxlength attributes on inputs
- Feedback reply: button disabled during submission to prevent double-submit
- Feedback submit: button disabled during submission
- Mark-all-notifications-read endpoint added (POST /me/notifications/read-all)
- Admin users endpoint returns pagination metadata (page, limit)
- User search support in admin users endpoint
- Notification ID validation: must be positive integer

### Express 5 Notes

- Catch-all route uses `/{*path}` syntax (not `*`)
