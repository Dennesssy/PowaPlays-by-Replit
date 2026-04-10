# POWAPLAY — Developer Reference

**POWAPLAY** is a project discovery platform built on Replit. Users authenticate with their Replit account, import their public Repls, and curate a public portfolio. A 2D draggable canvas grid showcases all public projects. The app is a full-stack TypeScript monorepo (pnpm workspaces) with a Node/Express API server serving both the REST API and the static frontend.

---

## Quick Facts

| Item | Value |
|---|---|
| Stack | Node.js + Express (API), Vanilla JS SPA (Frontend), PostgreSQL (Drizzle ORM) |
| Auth | Replit OIDC (OpenID Connect + PKCE) |
| Port | `$PORT` env var (default 8080 in dev) |
| Dev command | `pnpm --filter @workspace/api-server run dev` |
| DB migrations | `pnpm --filter @workspace/db run db:push` |
| Build | `pnpm --filter @workspace/api-server run build` |

---

## Role System

| Role (DB value) | Who | What they can do |
|---|---|---|
| `"user"` | Anyone who logs in | My Projects, Import Repls, Favorites, Feedback |
| `"admin"` | @replit.com emails (auto), manually promoted | + Platform analytics, feedback overview, project moderation |
| `"internal"` | Master accounts (MASTER_EMAILS secret) | + User management, APM dashboard, audit logs, system config, view-as-user |

> **Note:** The codebase uses `"internal"` as the DB value for master. `isMaster()` checks `role === "internal"`. `isAdmin()` checks `role === "admin" OR "internal"`. When reading code, "internal" = master.

---

## Project Tree

```
workspace/
├── artifacts/
│   ├── api-server/          ← Express API + static file server
│   │   └── src/
│   │       ├── app.ts       ← Express app setup (CORS, middleware, static)
│   │       ├── index.ts     ← Server entry point (PORT binding)
│   │       ├── lib/
│   │       │   ├── auth.ts          ← Session CRUD, OIDC config, token refresh
│   │       │   ├── alerting.ts      ← System alert thresholds and raising
│   │       │   ├── auditLog.ts      ← Admin action audit trail
│   │       │   ├── buildathonSync.ts← Syncs Buildathon projects from external API
│   │       │   └── logger.ts        ← Pino structured logger
│   │       ├── middlewares/
│   │       │   ├── apm.ts           ← Request latency, P50/P95/P99, error rates
│   │       │   └── authMiddleware.ts← Session → req.user, token auto-refresh
│   │       └── routes/
│   │           ├── index.ts         ← Mounts all sub-routers under /api
│   │           ├── auth.ts          ← Login, callback, logout, /auth/user
│   │           ├── projects.ts      ← Public project listing, CRUD, me/projects
│   │           ├── users.ts         ← Public user profiles
│   │           ├── repls.ts         ← Replit profile scrape, import endpoint
│   │           ├── projectAnalytics.ts ← Per-user analytics, master user mgmt
│   │           ├── favorites.ts     ← Favorite/unfavorite projects
│   │           ├── feedback.ts      ← Feedback CRUD, threading, admin overview
│   │           ├── analytics.ts     ← Event tracking, page views, error reports
│   │           ├── admin.ts         ← Admin dashboard, APM timeseries, sync health
│   │           ├── notifications.ts ← User notification inbox
│   │           ├── sync.ts          ← Manual sync trigger (admin)
│   │           └── health.ts        ← GET /health liveness probe
│   └── powaplay/
│       └── public/           ← Static SPA served by api-server
│           ├── index.html    ← Single HTML shell, all page sections
│           ├── manifest.json ← PWA manifest (name, icons, display: standalone)
│           ├── sw.js         ← Service worker (cache-first for non-API)
│           ├── css/
│           │   └── style.css ← All styles (canvas, overlay, mobile bar, etc.)
│           └── js/
│               ├── app.js    ← Main SPA controller (router, auth, dashboard, overlay)
│               ├── canvas.js ← 2D draggable grid, tile rendering, edge loading
│               ├── api.js    ← Fetch wrappers for all API endpoints
│               ├── admin.js  ← Admin dashboard charts (SVG), user management
│               └── feedback.js ← Feedback submit, inbox, threading UI
├── lib/
│   ├── db/
│   │   └── src/
│   │       └── schema/
│   │           ├── auth.ts          ← users + sessions tables
│   │           ├── projects.ts      ← projects table
│   │           ├── analytics.ts     ← analytics_events + page_views tables
│   │           ├── feedback.ts      ← feedback + feedback_responses tables
│   │           ├── notifications.ts ← notifications table
│   │           └── observability.ts ← system_metrics + audit_log tables
│   ├── api-spec/
│   │   └── openapi.yaml      ← OpenAPI 3.1 spec (source of truth for types)
│   ├── api-zod/              ← Auto-generated Zod types from openapi.yaml
│   ├── api-client-react/     ← Auto-generated React hooks from openapi.yaml
│   └── replit-auth-web/      ← Thin frontend auth hook (calls /api/auth/user)
└── scripts/
    └── post-merge.sh         ← Runs db:push after task agent merges
```

---

## File-by-File Reference

---

### `artifacts/api-server/src/app.ts` (100 lines)

The Express application setup. Every request flows through this file before reaching a route.

**Critical sections:**

- **Lines 35–62 — CORS policy:** In development, all origins are allowed. In production, `ALLOWED_ORIGINS` env var controls the whitelist. If `ALLOWED_ORIGINS` is not set (empty), production also allows all origins (fail-open). This prevents auth breakage when the env var is missing. To lock down in production, set `ALLOWED_ORIGINS=https://yourdomain.com`.

- **Lines 68–78 — Security headers:** Sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, and `Permissions-Policy` on every response. These are important for deployment security reviews.

- **Lines 80–83 — Middleware order:** APM runs before auth. Auth populates `req.user`. Routes come after both. Never reorder these.

- **Lines 85–97 — Static file serving:** The API server also serves `artifacts/powaplay/public/` as static files. The fallback `/{*path}` sends `index.html` for SPA routing. Cache is disabled in development (`no-store`), 1-hour in production.

**When to update:** Add new global middleware here (e.g., rate limiting, compression). For pricing/subscription middleware (e.g., plan checks), add after `authMiddleware` and before `router`.

---

### `artifacts/api-server/src/lib/auth.ts` (86 lines)

Session management and OIDC configuration. **Not the auth routes** — those are in `routes/auth.ts`.

**Key exports:**
- `getOidcConfig()` — lazily fetches Replit's OIDC discovery document (cached after first call)
- `createSession(data)` / `getSession(sid)` / `updateSession(sid, data)` / `deleteSession(sid)` — PostgreSQL-backed session CRUD
- `SESSION_TTL` — 7 days. Change here to adjust session lifetime.
- `SessionData` interface — what's stored in each session: `user` object, `access_token`, `refresh_token`, `expires_at`

**When to update:** If you add fields to the user object that need to survive across requests (like a subscription tier), add them to `SessionData.user` here.

---

### `artifacts/api-server/src/routes/auth.ts` (322 lines)

Handles the full OIDC login flow and exposes the current user.

**Critical sections:**

- **Lines 55–104 — `upsertUser()` function:** This is where login creates or updates a user in the database.

  - **Line 58 (THE USERNAME FIX — Task #2):** Previously derived username from email: `email.split("@")[0]`. This was wrong — `d.stewart5700@yahoo.com` gave `d.stewart5700` instead of `hitch45motor`. Now reads `claims.username` from the OIDC token (Replit provides this in the `profile` scope). Falls back to email prefix only if the claim is missing.

  - **Lines 87–102 — MASTER_EMAILS auto-promotion:** If the user's email is in the `MASTER_EMAILS` secret (comma-separated), they are set to role `"internal"` (master). Set this secret in Replit Secrets.

  - **After line 102 — @replit.com auto-admin (Task #2):** Replit team members are automatically promoted to `"admin"` on first login. Not master — just admin. This lets them review the app with full analytics access.

- **Lines 107–122 — `GET /api/auth/user`:** Returns the current session user to the frontend. Includes `id`, `email`, `firstName`, `lastName`, `profileImageUrl`, `role`, and now `username` (added in Task #2). Frontend calls this on every page load.

- **Lines 124–151 — `GET /api/login`:** Starts the OIDC PKCE flow. Stores `code_verifier`, `nonce`, `state`, `return_to` in short-lived cookies (10 min). Redirects to `replit.com/oidc/auth`.

- **Lines 153–218 — `GET /api/callback`:** Receives the auth code from Replit, exchanges for tokens, calls `upsertUser()`, creates a session, sets the `sid` cookie.

- **Lines 220–233 — `GET /api/logout`:** Clears session, redirects to Replit's OIDC end-session endpoint.

**For future pricing:** After `upsertUser()` in the callback (line ~196), you would check the user's subscription status against a billing system (Stripe, etc.) and store `subscriptionTier` in the session.

---

### `artifacts/api-server/src/middlewares/authMiddleware.ts` (90 lines)

Runs on every request. Reads the `sid` cookie, fetches the session, refreshes expired tokens, and sets `req.user`.

- **Lines 31–56 — `refreshIfExpired()`:** If the access token is expired and a refresh token exists, it silently gets a new one via Replit's OIDC token endpoint and updates the session. If refresh fails, the session is cleared and the user is logged out.

- **Lines 63–65 — `req.isAuthenticated()`:** A TypeScript type guard. Use `if (!req.isAuthenticated()) { res.status(401)... }` in any route that requires login.

**When to update:** If you add new fields to the session user (e.g., `subscriptionTier`), also update the `Express.User` interface extension in this file (lines 13–28).

---

### `artifacts/api-server/src/middlewares/apm.ts` (114 lines)

Application Performance Monitoring. Intercepts every request to measure latency.

- Tracks request counts, P50/P95/P99 latency, error rates, and memory usage in memory
- Flushes to the `system_metrics` DB table every 60 seconds
- Exposes a snapshot via `getApmSnapshot()` used by the admin dashboard endpoint

**When to update:** Adjust the flush interval or add new metrics. Do not remove — the admin dashboard depends on it.

---

### `artifacts/api-server/src/routes/repls.ts` (372 lines) — NEW (Task #2)

Fetches a user's public Repls from Replit's profile page and handles importing them.

**How it works (important for maintenance):**

Replit's GraphQL API now requires persisted query hashes (no arbitrary queries allowed). Instead, this file scrapes the `__NEXT_DATA__` JSON embedded in `https://replit.com/@{username}` — the same Apollo state the page uses for SSR. This is a community-known technique and works as of April 2026.

- **Lines 9–52 — Caching + rate limiting:** Results are cached per-username for 5 minutes (max 500 entries). Rate limiting: 5 fetches per user per minute, 30 fetches globally per minute. Prevents hammering Replit's servers.

- **Lines 60–96 — `fetchReplDetail()`:** For each of the first 10 repls found on the profile page, fetches the individual repl page (`/@username/slug`) to get canonical public/private status, creation date, demo URL, and icon. Uses a 5-second `AbortController` timeout per repl.

- **Lines 98–213 — `fetchUserRepls()`:** Main fetch logic. Parses Apollo state, builds a list of repls. Enriches the first 10 with detail data. Strictly filters: any repl that is confirmed private OR not confirmed public is excluded. Only verified-public repls are cached and returned.

- **Lines 215–255 — `GET /me/repls`:** Returns the user's public repls with an `imported: true/false` flag for each (checked against existing projects in the DB).

- **Lines 257–342 — `POST /me/repls/import`:** Validates the slug exists in the user's verified public repls (belt-and-suspenders: re-checks against canonical list). Creates a project entry in the DB. Returns 409 if already imported.

- **Lines 344–370 — `POST /me/onboarding/complete`:** Sets `onboardingCompleted: true` on the user. Called once after the first-login onboarding modal is dismissed.

**If Replit changes their page structure:** The `__NEXT_DATA__` extraction regex (`/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/`) may need updating. Test with a fresh fetch of `replit.com/@hitch45motor` and look for the script tag.

---

### `artifacts/api-server/src/routes/projectAnalytics.ts` (306 lines) — NEW (Task #2)

Per-user project analytics and master user management.

- **Lines 13–149 — `getUserProjectAnalytics(userId)`:** Queries `page_views`, `analytics_events` (for "favorite" events), and `feedback` tables to get per-project stats and 30-day trends. Returns `projects[]` with views/favorites/feedbackCount per project, plus a `summary` and `trends` object.

- **`GET /me/projects/analytics`:** Returns analytics for the logged-in user's own projects.

- **`GET /admin/users/:userId/analytics`:** Master-only. Returns analytics for any user. Used for the "View as User" capability in the master dashboard.

- **`GET /admin/users`:** Master-only. Paginated user list with search. Returns id, email, username, displayName, role, createdAt.

- **`PATCH /admin/users/:userId/role`:** Master-only. Changes a user's role. Cannot change your own role. Valid roles: `"user"`, `"admin"`, `"internal"`.

---

### `artifacts/api-server/src/routes/projects.ts` (319 lines)

The core project discovery API.

- **`GET /api/projects`:** Public. Supports `page`, `limit` (max 500), `search`, `tag`, `style`, `sort` (`popular`|`newest`). Used by the canvas for infinite loading.

- **`GET /api/me/projects`:** Authenticated. Returns the user's own projects including hidden ones.

- **`PATCH /api/me/projects/:id`:** Authenticated. Updates `isHidden`, `description`, `tags`, `style` on a project the user owns.

**Pagination contract (critical):** `MAX_LIMIT = 500`. The canvas fetches with `limit=500`. If this is lowered, `_discoverAllLoaded` fires too early, truncating the gallery. Do not lower this without also updating canvas.js.

**For future pricing:** A `PATCH /api/me/projects/:id` that upgrades a project to "featured" status would go here, gated behind a subscription tier check.

---

### `artifacts/api-server/src/routes/admin.ts` (384 lines)

Admin-only platform analytics and system controls. All routes gated by `requireAdmin` (role: admin or internal).

- **`GET /api/admin/dashboard`:** Aggregated stats — total projects/users, recent events, error counts, top projects, current APM snapshot.
- **`GET /api/admin/metrics/timeseries`:** Historical metric data (e.g., `http.requests`) for chart rendering.
- **`GET /api/admin/sync/health`:** Buildathon sync status, last run time, error count.
- **`GET /api/admin/feedback/overview`:** Total/open feedback counts, per-user response rates, neglected feedback.
- **`GET /api/admin/alerts`:** Active system alerts.
- **`GET /api/admin/audit-log`:** Recent admin actions.

---

### `artifacts/api-server/src/routes/feedback.ts` (630 lines)

Full feedback lifecycle. The largest route file.

- **Lines 1–80:** Role helper functions and DB queries.
- **`GET /api/feedback`:** Admins see all. Users see only feedback they submitted or feedback on their own projects.
- **`POST /api/feedback`:** Open to anyone including anonymous (captures name/email). Creates feedback linked to a project.
- **`GET /api/feedback/:id`:** Thread view. Internal notes (`isInternal: true`) only visible to admin/internal.
- **`POST /api/feedback/:id/respond`:** Add a reply. Project owner, submitter, or admin.
- **`PATCH /api/feedback/:id/status`:** Change status (open → acknowledged → in_progress → resolved → closed). Project owner or admin.

---

### `artifacts/api-server/src/routes/analytics.ts` (282 lines)

Event ingestion and error tracking. No auth required for submission (by design — tracks anonymous visitors too).

- **`POST /api/analytics/events`:** Accepts any event. If `type === "page_view"`, also writes to `page_views` table. Parses User-Agent for device/browser/OS info.
- **`POST /api/analytics/errors`:** Client-side error reporting. MD5 fingerprints each error to de-duplicate. Tracked in `analytics_events`.

---

### `artifacts/api-server/src/lib/buildathonSync.ts`

Background sync that fetches projects from `https://buildathons.replit.app/api/public/`. Runs on server start and periodically. This populates the main project gallery.

**If Buildathon API changes:** Update the endpoint URLs and response parsing here.

---

### Database Schema (`lib/db/src/schema/`)

#### `auth.ts` (31 lines)
Two tables: `sessions` (sid, sess JSON, expire) and `users`.

**`users` table fields:**
| Field | Purpose |
|---|---|
| `id` | UUID primary key (from Replit OIDC `sub` claim) |
| `email` | Unique. Used for MASTER_EMAILS check and @replit.com auto-admin |
| `username` | Replit username (e.g. "hitch45motor"). Fixed in Task #2 to use OIDC claim |
| `displayName` | Shown in UI. Defaults to firstName |
| `role` | `"user"` / `"admin"` / `"internal"` |
| `onboardingCompleted` | Boolean. Set true after first-login modal dismissed |
| `publicProfileEnabled` | Controls whether /u/:username page is visible |
| `bio` | User bio shown on public profile |

**For future pricing:** Add `subscriptionTier varchar` (e.g., `"free"`, `"pro"`, `"team"`), `stripeCustomerId varchar`, `subscriptionExpiresAt timestamp` here. Then run `pnpm --filter @workspace/db run db:push`.

#### `projects.ts` (60 lines)
The `projects` table. Key fields: `ownerId`, `slug`, `replitProjectId`, `url`, `replitUrl`, `thumbnailUrl`, `isPublic`, `isHidden`, `favoriteCount`, `tags` (array), `style`.

**For future pricing:** Add `isFeatured boolean` or `plan varchar` to gate enhanced visibility.

#### `analytics.ts` (72 lines)
`analytics_events` (general events with metadata, device info) and `page_views` (path, projectId, scrollDepth, duration).

#### `observability.ts`
`system_metrics` (APM flush target) and `audit_log` (admin action trail).

---

### `artifacts/powaplay/public/js/app.js` (1466 lines)

The main SPA controller. Handles routing, auth state, page rendering, and the project overlay.

**Sections by line range:**

- **Lines 1–30 — Init:** Registers service worker, sets up session ID for analytics, calls `Auth.init()` then `App.init()`.

- **Lines 31–80 — `App.init()`:** Checks auth state, sets up nav visibility per role, starts notification polling, routes to current URL.
  - **Lines 54–58:** Admin link visibility — shows `.nav-admin` only for `role === "internal"` or `"admin"`. If you add a new role-gated nav item, add it here.

- **Lines 170–200 — Router setup:** Maps URL patterns to page handlers. Add new routes here.
  - `/` → discover canvas
  - `/dashboard` → `_showDashboard()`
  - `/admin` → `_showAdmin()`
  - `/u/:username` → `_showProfile(username)`
  - `/feedback`, `/feedback/:id` → feedback views

- **Lines 358–422 — `_showAdmin()`:** Gated to admin/internal. Renders the admin overview page. Calls `AdminDashboard` from admin.js.

- **Lines 424–510 — `_showDashboard()`:** The user dashboard. Fetches `/api/me/projects` and `/api/me/projects/analytics`. Renders personal stats and project list with hide/show toggles.
  - Role-aware: calls additional admin endpoints for admin/internal roles.

- **Lines 500–620 — `_showDiscover()`:** Initializes the canvas grid. Fetches first page of projects (limit=500). Sets north/south page counters for bidirectional infinite loading.

- **Lines 700–800 — `openProject(project)`:** Renders the project detail overlay (Godly-style).
  - **Lines 759–782:** Builds the overlay HTML — title, Visit pill button, favorites count, time-ago date, description, tags, action buttons (Favorite, Feedback, Share).
  - `_timeAgo()` helper at ~line 863: converts timestamps to "2d ago", "1mo ago" etc.

- **Lines 841–856 — PWA install prompt:** Captures `beforeinstallprompt`, reveals `#install-btn`. Do not remove.

- **Lines 875–930 — `_setupMobile()`:** Mobile bottom bar event listeners. Navigation pills route to pages. Index button shows discover canvas.

- **Lines 930–1000 — Filter system:** `_applyFilters()` rebuilds the canvas with filtered results. Always passes the current `sort` parameter.

**For navigation changes per role:** The mobile bottom bar and desktop nav adaptation per role is handled here. The pill buttons check `Auth.user` at click time to decide where to navigate.

---

### `artifacts/powaplay/public/js/canvas.js` (550 lines)

The 2D draggable grid. Completely independent from app.js — communicates only via the `Canvas` global object.

**Sections by line range:**

- **Lines 1–60 — State:** `_offsetX/Y` (pan position), `_discoverPage` (current south page), `_discoverNorthPage` (current north page), `_cols` (grid columns), `_tileW/H` (tile dimensions).

- **Lines 60–150 — Pointer/Touch events:** Mouse drag and touch pan handlers. `touch-action: none` in CSS and `preventDefault()` on touchstart/touchmove prevents iOS scroll hijack.

- **Lines 150–250 — `_render()`:** Positions all tiles based on `_offsetX/Y`. Triggers edge detection.

- **Lines 250–350 — Edge detection:** South edge (`scrolledY > maxY - 600`) triggers `_loadMoreProjects()`. North edge (`scrolledY < 600`) triggers `_loadMoreProjectsNorth()`.
  - **Critical:** `_discoverNorthAllLoaded` prevents duplicate north loads. `_discoverSouthAllLoaded` stops south loading when last page reached.
  - **Intentional design — page 2 start:** On initial load, a probe request fetches `page=1&limit=1` to get the total count. If more than 1 page exists, the canvas starts rendering from **page 2** (not page 1). This is deliberate — it ensures the user can immediately pan north to see page 1 content (bidirectional loading). If only 1 page exists, it starts at page 1 with north loading disabled. To change this behavior, modify the `startPage` calculation in `_showDiscover()` and `_applyFilters()` in `app.js`.

- **Lines 350–450 — `_loadMoreProjects()` / `_loadMoreProjectsNorth()`:** Fetch the next/previous page. Append tiles to the south, prepend to the north. North prepend shifts all existing grid indices by `newProjects.length` to stay aligned.

- **Lines 450–550 — `_createTile(project, index)`:** Renders a single project card. Thumbnail, title, owner, tags, favorites count. Click → `App.openProject(project)`.

**Pagination contract:** Always uses `limit=500`. The `_discoverAllLoaded` flag fires when fewer than 500 results return. Do not change the limit without also updating `MAX_LIMIT` in `projects.ts`.

---

### `artifacts/powaplay/public/js/api.js` (185 lines)

Thin fetch wrappers. All API calls go through here. Always sends `credentials: "include"` for session cookies.

**Key methods:**
- `getProjects(params)` — canvas data source
- `getMyProjects()` — dashboard project list
- `getMyRepls()` — fetch user's Replit repls (`GET /api/me/repls`)
- `importRepl(slug, replId)` — import a repl (`POST /api/me/repls/import`)
- `getMyProjectAnalytics()` — dashboard analytics
- `getUserAnalytics(userId)` — master view-as-user
- `trackEvent(event, data)` — analytics event
- `reportError(message, stack)` — error reporting

**For future pricing:** Add `getSubscriptionStatus()`, `createCheckoutSession()`, `cancelSubscription()` here.

---

### `artifacts/powaplay/public/js/admin.js` (445 lines)

Admin dashboard rendering. Custom SVG-based charts (no external charting library in prod).

**Sections:**
- **Lines 1–100:** `AdminDashboard._load()` — fetches `/api/admin/dashboard` and renders overview stats.
- **Lines 100–200:** Chart rendering functions — project distribution (pie), feedback status (bar), user composition (donut).
- **Lines 200–300:** APM section — request counts, latency percentiles, error rate, memory gauge.
- **Lines 300–445:** Alerts, audit log, sync health, user management table (master only).

**For adding new admin charts:** Follow the existing SVG pattern. Add a new section div in `index.html` (admin section) and a rendering function here.

---

### `artifacts/powaplay/public/js/feedback.js` (452 lines)

Complete feedback UI.

- **Lines 1–100:** `showSubmitForm(projectId, title)` — modal with type/body/contact fields. Works for anonymous users.
- **Lines 100–200:** `showInbox()` — lists feedback threads relevant to the current user.
- **Lines 200–300:** `showThread(id)` — thread view with reply form. Internal notes hidden from non-admins client-side (also enforced server-side).
- **Lines 300–452:** `showAdminOverview()` — admin feedback stats table.

---

### `artifacts/powaplay/public/index.html`

The single HTML shell. All "pages" are `<section>` elements shown/hidden by the router.

**Key sections:**
- `#page-discover` — canvas viewport
- `#page-dashboard` — user dashboard (auth-gated)
- `#page-profile` — public user profile
- `#page-admin` — admin panel
- `#page-feedback` — feedback inbox/thread
- `#mobile-bottom-bar` — mobile nav bar (5 elements: 2 corners + 3 pills)
- `#overlay-*` — project detail overlay

**Mobile bottom bar (lines 215–230):**
- `#mobile-nav-lightning` (left corner) — POWAPLAY home/branding for visitors; settings icon for logged-in users
- `#mobile-filter-btn` — filter pill
- `#mobile-index-btn` — gallery/discover pill
- `#mobile-feedback-btn` — feedback pill (becomes "My Projects" for logged-in users)
- `#mobile-nav-refresh` (right corner) — refresh; admin access for admin/internal role

---

### `artifacts/powaplay/public/sw.js`

Service worker. Cache strategy: cache-first for non-API responses, network fallback.

- Cache name: `powaplay-v2`. **Update the version string** when you want users to get fresh assets after a deploy (e.g., `powaplay-v3`).
- API calls (`/api/*`) bypass the cache — always fetched live.

---

### `artifacts/powaplay/public/manifest.json`

PWA manifest. Controls how the app installs on iOS/Android home screens.

- `name`: "POWAPLAY by Replit"
- `display`: "standalone" (full-screen, no browser chrome)
- `start_url`: "/"
- Update `icons` array if you add new app icon sizes.

---

## Future Pricing — Where to Add It

When you're ready to add subscription tiers (e.g., Pro features like featured project slots, analytics exports, private portfolio):

1. **Database:** Add `subscriptionTier`, `stripeCustomerId`, `subscriptionExpiresAt` to `lib/db/src/schema/auth.ts` → run `db:push`

2. **Backend — Stripe integration:** Create `artifacts/api-server/src/routes/billing.ts` with:
   - `POST /api/billing/checkout` — create Stripe checkout session
   - `POST /api/billing/webhook` — handle Stripe events (subscription created/cancelled)
   - `GET /api/billing/status` — return current subscription tier

3. **Session:** Add `subscriptionTier` to `SessionData` in `lib/auth.ts` and update `upsertUser()` in `routes/auth.ts` to fetch/cache tier on login

4. **Middleware:** Add a `requirePro` middleware in `middlewares/` that checks `req.user.subscriptionTier === "pro"` — use it on gated routes

5. **Frontend:** Add `API.getSubscriptionStatus()` in `api.js`, render pricing page in `index.html`, add billing section to dashboard in `app.js`

6. **Env secrets needed:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`

---

## Environment Variables & Secrets

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-set by Replit DB) |
| `REPL_ID` | Yes | OIDC client ID (auto-set by Replit) |
| `ISSUER_URL` | No | Defaults to `https://replit.com/oidc` |
| `MASTER_EMAILS` | Yes | Comma-separated emails for `"internal"` (master) role |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins (fail-open if not set) |
| `PORT` | No | Server port (auto-set by Replit, defaults to 8080) |
| `NODE_ENV` | No | Set to `production` in deployed environments |

---

## Deployment Checklist

1. Set `MASTER_EMAILS` secret to your Gmail (denn.stewartjr@gmail.com) — this gives you master/internal role
2. Verify `DATABASE_URL` is set (auto-configured by Replit PostgreSQL)
3. If using a custom domain: set `ALLOWED_ORIGINS=https://yourdomain.com`
4. Update `sw.js` cache version string (`powaplay-v3`) to bust client caches
5. The server starts with `pnpm --filter @workspace/api-server run start` in production

---

## Key Changes History

| Task | What Changed | Files |
|---|---|---|
| Task #2 | Fixed OIDC username claim: now uses `claims.username` not `email.split("@")[0]` | `routes/auth.ts:58` |
| Task #2 | Added `username` to session, `/auth/user` response, `req.user` | `routes/auth.ts`, `lib/auth.ts`, `authMiddleware.ts` |
| Task #2 | Auto-admin for @replit.com emails on login | `routes/auth.ts` in `upsertUser()` |
| Task #2 | New `/api/me/repls` + `/api/me/repls/import` endpoints (Replit profile scrape) | `routes/repls.ts` |
| Task #2 | Per-user analytics, master user management endpoints | `routes/projectAnalytics.ts` |
| Task #2 | First-login onboarding modal, `onboardingCompleted` field | `routes/repls.ts`, `schema/auth.ts` |
| Task #2 | CORS fix: fail-open when `ALLOWED_ORIGINS` not set | `app.ts:51–53` |
| Task #2 | Pagination fix: `MAX_LIMIT` restored to 500 | `routes/projects.ts` |
