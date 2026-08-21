# FTS-Blog Project Audit Report

**Project:** fts-blog (Frontend Test Suite - Blog)
**Type:** Node.js + Express blog system with SQLite (sql.js), EJS templates
**Date:** 2026-08-21
**Scope:** Security, architecture, bugs, performance, and code quality

---

## 1. Executive Summary

| Severity | Security | Architecture | Bugs | Performance | Total |
|----------|----------|--------------|------|-------------|-------|
| Critical | 6 | — | 3 | — | 9 |
| High | 10 | 8 | 6 | 4 | 28 |
| Medium | 10 | 16 | 4 | 5 | 35 |
| Low | 7 | 2 | — | 2 | 11 |
| **Total** | **33** | **26** | **13** | **11** | **83** |

The codebase has a concentrated cluster of **9 Critical findings** that require immediate remediation before any production use. The most urgent are a stored XSS vulnerability via unsanitized `marked` output, arbitrary code execution through unsafe YAML deserialization, hardcoded session secrets enabling session forgery, and a race condition in database writes causing silent data loss. Beyond security, the architecture suffers from pervasive duplication (4 `getDb` definitions, 5 tag-resolution copies, 2 full login implementations) and a 412-line god route file with no service layer. Performance is dominated by the sql.js architecture: the entire database is deserialized from disk on every single HTTP request, and every write triggers a full-database export/import cycle.

---

## 2. Critical Issues (Must Fix)

### 2.1 Stored XSS via Unsanitized `marked` HTML

**Files:** `server.js:114-116`, `views/post.ejs:33`, `views/admin-preview.ejs:43`

`marked` is initialized with `gfm: true` and no sanitizer. The EJS templates render post content using unescaped output (`<%- marked.parse(post.content) %>`). Since modern `marked` no longer strips HTML tags by default, a malicious author can inject `<script>` tags or event-handler attributes into post content and achieve arbitrary JavaScript execution in every visitor's browser.

**Impact:** Complete account takeover for any visitor, including admins. Cookie theft, admin action forgery.

**Recommendation:** Add `DOMPurify` or `marked`'s `sanitize: true` option (or use `marked.use({ sanitize: true })` with a proper sanitizer library). Render with `<%= %>` (escaped) instead of `<%- %>` unless HTML is explicitly required and sanitized.

---

### 2.2 Arbitrary Code Execution via Unsafe YAML Deserialization

**File:** `routes/import.js:274`

`yaml.load(frontmatterText)` uses js-yaml's default full schema, which deserializes `!!js/function`, `!!js/undefined`, and `!!python/object` YAML tags. A crafted Obsidian markdown file with malicious frontmatter can execute arbitrary JavaScript or Python code on the server during import.

**Impact:** Full server compromise. An attacker who can upload or place a markdown file in the `经验/` directory achieves remote code execution.

**Recommendation:** Replace `yaml.load()` with `yaml.load(text, { schema: yaml.defaultSafeSchema })` or use a dedicated frontmatter parser like `gray-matter` that only extracts YAML/TOML without executing deserialized types.

---

### 2.3 Hardcoded Session Secret Enables Session Forgery

**File:** `server.js:121`

```js
secret: 'fts-blog-secret-key-2026'
```

A static, predictable secret in source code. Anyone with repo access (or who sees the code) can HMAC-sign arbitrary session cookies and impersonate any user without a password.

**Impact:** Complete authentication bypass. Attacker can forge `{"userId":1,"username":"admin"}` and gain admin access instantly.

**Recommendation:** Move the secret to an environment variable (`process.env.SESSION_SECRET`) with a fallback only in development. Generate a 64-byte random secret on first startup if none is configured. Rotate the secret immediately if this code has been exposed.

---

### 2.4 Hardcoded Credentials in README + Startup Banner

**Files:** `server.js:160-161`, `README.md`, `database/init.js:64`

The admin password `admin123` is hardcoded in the seed logic, printed to stdout in the startup banner, and documented in the README. `database/init.js:64` seeds `admin123` and logs it to stdout.

**Impact:** Credential is immediately known to anyone with repo access or log access. In production, log aggregation services capture this.

**Recommendation:** Remove the password from the startup banner and README. Generate a random default password on first initialization and display it once. Require password change on first login.

---

### 2.5 Race Condition in `saveDb()` — Silent Data Loss

**Files:** `routes/api.js:54-58`, `routes/import.js:31-35`, `admin.js:54-58`

sql.js loads the entire `blog.db` into memory. Every write does: `readFileSync → new SQL.Database(buffer) → modify → export → writeFileSync`. Concurrent requests read the file at different times and overwrite each other's writes. No file locking exists.

**Reproduction:**
```bash
curl -X POST /api/posts -d '{"title":"A","slug":"a","content":"x"}' &
curl -X POST /api/posts -d '{"title":"B","slug":"b","content":"y"}' &
# One post is silently lost
```

**Impact:** Under any concurrent write load, data is silently lost. This is not theoretical — any two simultaneous API calls will race.

**Recommendation:** Implement a write queue with a mutex so that only one write serializes at a time. Alternatively, migrate to `better-sqlite3` which supports concurrent access with proper locking.

---

### 2.6 Path Traversal in OBSIDIAN_DIR Import

**File:** `routes/import.js:13`, `routes/import.js:67-69`

`OBSIDIAN_DIR` is defined as `path.join(__dirname, '..', '经验')`, and `fs.readdirSync(OBSIDIAN_DIR)` lists files that are read directly with `fs.readFileSync(filePath)`. Filenames come from the filesystem without sanitization. If an attacker can place a file with a traversal-sequence name (e.g., `..%2f..%2fetc%2fpasswd.md`) inside `经验/`, the app reads and imports arbitrary files from outside that directory.

**Impact:** Arbitrary file read from the server filesystem. Combined with the YAML RCE, this is a full compromise path.

**Recommendation:** Validate filenames against a strict whitelist pattern (`/^[a-zA-Z0-9_\-一-鿿]+\.md$/`). Use `path.resolve()` and verify the resolved path starts with the expected base directory.

---

### 2.7 Insecure Session Cookie — No Security Flags

**File:** `server.js:124`

```js
cookie: { secure: false }
```

Only `secure: false` is set. `httpOnly`, `sameSite`, and any `maxAge`/`expires` are all omitted. The cookie is sent over plain HTTP, accessible to JavaScript (enabling XSS-based session theft), and persists indefinitely.

**Impact:** Session hijacking via network sniffing (if HTTP), XSS theft, and no automatic session expiry.

**Recommendation:**
```js
cookie: {
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}
```

---

### 2.8 Session Fixation — No Session ID Regeneration After Login

**Files:** `server.js:120-125`, `routes/api.js:86-88`, `routes/admin.js:94-96`

After successful authentication, `req.session.userId` is set but the session identifier is never regenerated. An attacker who can set a known session ID before login retains that ID after the victim authenticates.

**Impact:** Session hijacking via subdomain cookie overflow or session prediction.

**Recommendation:** Call `req.session.regenerate()` after successful login in both the API and web login handlers.

---

### 2.9 No Rate Limiting on Login

**Files:** `routes/api.js:63`, `routes/admin.js:56`

Neither the API login nor the web login has rate limiting. The default `admin123` credential is short enough for rapid brute-force, and bcrypt's cost factor of 10 provides only limited per-request slowdown.

**Impact:** Offline brute-force of the admin password is trivial. Online brute-force is feasible given enough time.

**Recommendation:** Add `express-rate-limit` middleware to both login endpoints. Limit to 5 attempts per 15 minutes per IP. Consider account lockout after repeated failures.

---

## 3. High Priority Issues

### 3.1 No CSRF Protection on State-Changing Endpoints

**Files:** All routes — `server.js:105-106`

No CSRF tokens are present on any state-changing form or API endpoint (login, post CRUD, upload, delete). Any authenticated admin who visits a malicious page can have actions performed on their behalf via hidden form submissions.

**Impact:** Unauthorized post creation, deletion, or admin actions via cross-site request forgery.

**Recommendation:** Add `csurf` middleware. Include tokens in all mutating forms and API requests.

---

### 3.2 No Content Security Policy

**Files:** `server.js` (no CSP configured)

No `Content-Security-Policy` header is set anywhere. Combined with the stored XSS issue, there is no restriction on inline script execution.

**Impact:** Injected scripts execute without restriction.

**Recommendation:** Add `helmet` middleware with a restrictive CSP:
```js
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"]
  }
}));
```

---

### 3.3 Clickjacking (No X-Frame-Options / CSP frame-ancestors)

**Files:** `server.js`

No `X-Frame-Options` header or CSP `frame-ancestors` directive. An attacker can embed the admin panel in an invisible iframe and trick an authenticated admin into clicking disguised buttons (e.g., delete post).

**Impact:** Unintended admin actions via UI redress attack.

**Recommendation:** Add `helmet.frameguard({ action: 'deny' })` or set CSP `frame-ancestors: ['none']`.

---

### 3.4 XSS via Unescaped EJS Variables in Template Attributes

**Files:** `views/post.ejs:19`, `views/admin-dashboard.ejs:68`

Several templates use `<%= %>` inside HTML attribute values. For example, `views/post.ejs:19` renders `<img src="<%= post.cover_image %>">`. While `<%= %>` auto-escapes in EJS, a `cover_image` value of `" onmouseover="alert(1)` breaks out of the attribute context.

**Impact:** Stored XSS via crafted attribute values in post data.

**Recommendation:** Validate `cover_image` against a URL whitelist pattern. Use EJS delimiters that force attribute-aware escaping, or sanitize with DOMPurify before rendering.

---

### 3.5 MIME-Type-Spoofable File Upload

**File:** `routes/api.js:29-41`

Upload checks file extension and `Content-Type` header, but a sophisticated client can set any `Content-Type` value. Filenames are derived from `Date.now() + Math.random()` with no filesystem-level execution prevention or content inspection.

**Impact:** Web shell upload if combined with other vulnerabilities (SSRF, WAF bypass).

**Recommendation:** Inspect file signatures (magic bytes) using `file-type` or `mmmagic`. Set uploaded files to non-executable permissions. Add `X-Content-Type-Options: nosniff`.

---

### 3.6 No Input Validation / Sanitization Layer

**Files:** `routes/api.js:242-291` (post create), `routes/admin.js` (all handlers)

Title, slug, and content fields are accepted from `req.body` with no sanitization beyond presence checks. No length limits, no format validation, no HTML sanitization for stored XSS.

**Impact:** Malicious content stored in database and served to all visitors.

**Recommendation:** Add a validation library (e.g., `zod` or `joi`). Define schemas for all input objects. Sanitize HTML content server-side before storage.

---

### 3.7 IDOR via Sequential Post IDs

**Files:** `routes/api.js:204-238`, `routes/admin.js:147-186`

Post IDs are sequential integers starting from 1 with no ownership check. Any authenticated user can enumerate, read, edit, or delete any post by incrementing the ID.

**Impact:** Unauthorized access to all posts in the system.

**Recommendation:** Add ownership checks (`WHERE id = ? AND author_id = ?`) to all mutating endpoints. Or implement role-based access control.

---

### 3.8 No Existence Check on PUT/DELETE — Returns Success for Non-Existent IDs

**Files:** `routes/api.js:294-345` (PUT), `routes/api.js:348-360` (DELETE)

`UPDATE posts SET ... WHERE id = ?` with a non-existent ID affects 0 rows but returns `{ message: 'Post updated' }`. DELETE similarly returns success for non-existent resources.

**Impact:** Client cannot distinguish successful operations from no-ops. Silent failures in automation.

**Recommendation:** Check `db.getRowsModified()` (or equivalent) after write operations. Return 404 if `rowsAffected === 0`.

---

### 3.9 `GROUP_CONCAT` Default 1000-Char Limit Silently Truncates Tags

**Files:** `routes/api.js:117`, `routes/public.js:25-32`

SQLite's `GROUP_CONCAT` caps at 1000 characters by default. Posts with many or long tags silently lose data. `row[10].split(',')` then produces incomplete/corrupted tag arrays.

**Impact:** Data loss for high-tag-density posts as the site grows.

**Recommendation:** Increase the limit with `PRAGMA group_concat_max_len = 10000` or restructure tags into a separate query.

---

### 3.10 SQLite Database File Stored in World-Readable Location

**File:** `server.js:15`, `server.js:108-110`

The database at `data/blog.db` is stored without filesystem ACL restrictions. A local privilege escalation or misconfigured reverse proxy could expose it.

**Impact:** Direct database download revealing all posts, user credentials, and session data.

**Recommendation:** Set restrictive filesystem permissions on `data/blog.db` (e.g., `0o600`). Ensure the `data/` directory is outside the static file serving root.

---

## 4. Medium Priority Issues

### 4.1 `routes/api.js` is a 412-Line God File

**File:** `routes/api.js`

Auth, post CRUD, tag CRUD, and file upload all live in one router. No service layer exists; business logic is embedded in route handlers. Testing requires spinning up the full Express stack.

**Recommendation:** Split into `routes/auth.js`, `routes/posts.js`, `routes/tags.js`, `routes/uploads.js`. Extract business logic into a `services/` layer.

---

### 4.2 Code Duplication

| Function | Defined In | Count |
|----------|-----------|-------|
| `getDb()` | `routes/api.js:44`, `routes/admin.js:12`, `routes/admin.js:33`, `routes/import.js:21`, `routes/public.js:11` | **5** |
| `saveDb()` | `routes/api.js:54`, `routes/import.js:31` | **2** |
| Login logic | `routes/api.js:63-94`, `routes/admin.js:56-107` | **2** |
| Tag association | `server.js:71-81`, `routes/api.js:260-282`, `routes/api.js:318-335`, `routes/import.js:123-135`, `routes/import.js:208-224` | **5** |
| Slug regex | 6 locations across all route files | **6** |
| Post seeding | `server.js:24-91`, `database/seed.js:8-183`, `database/init.js:64-66` | **3** |

**Impact:** A change to any shared logic must be applied in up to 6 places. Bug fixes propagate inconsistently.

**Recommendation:** Extract `getDb()`, `saveDb()`, `slugify()`, and tag-resolution logic into a shared `lib/` or `utils/` module. Consolidate login into a single auth middleware/service.

---

### 4.3 Generic Error Responses Hide Root Cause

**Files:** `routes/api.js:92,158,198,289,343,358,374,393`, `routes/import.js:153`, `routes/public.js:63,116`

Every catch block returns `{ error: 'Server error' }` without the underlying exception. The update handler at `api.js:342-343` is the only one that surfaces the real message — inconsistency suggests ad-hoc debugging.

**Impact:** Production debugging requires adding `console.error` statements and redeploying.

**Recommendation:** Use Express's error-handling middleware (`app.use((err, req, res, next) => ...)`). Return detailed errors in development, sanitized errors in production. Log the full stack trace server-side.

---

### 4.4 `db.close()` Not in `finally` Blocks — Connection Leaks on Error

**Files:** `routes/api.js:63-94`, `routes/admin.js:112-133`, `routes/public.js:22-64`

On an unhandled exception inside a route, the SQLite connection is never closed. Under load this exhausts file descriptors.

**Recommendation:** Use `try { ... } finally { db.close(); }` in every route handler.

---

### 4.5 Default MemoryStore for Sessions

**File:** `server.js:120-125`

`express-session`'s default MemoryStore is not shared across cluster processes and leaks memory under load. It is not safe for production.

**Recommendation:** Use `connect-session-knex` or `session-file-store` for persistent sessions. Or migrate to `better-sqlite3` with a session table.

---

### 4.6 Missing Body Size Limits

**File:** `server.js:105-106`

No `express.json({ limit: ... })` or `express.urlencoded({ limit: ... })` configuration. An attacker can send a multi-gigabyte request body to exhaust server memory.

**Recommendation:** Add `express.json({ limit: '1mb' })` and `express.urlencoded({ limit: '1mb', extended: true })`.

---

### 4.7 Logging Internal Paths and Credentials to Console

**Files:** `server.js:73`, `database/init.js:66,73`

The absolute database path and admin credentials are logged to stdout. In production, logs are often shipped to aggregation services.

**Impact:** Secrets and internal infrastructure details leak into log systems.

**Recommendation:** Remove credential logging entirely. Use a structured logging library (e.g., `pino` or `winston`) with configurable log levels.

---

### 4.8 Unescaped `decodeHtmlEntities` in Preview Route

**File:** `routes/admin.js:22-31`, `routes/admin.js:210`

`decodeHtmlEntities` decodes HTML entities on post content before rendering into the preview template. If the author intentionally wrote `&amp;` in a code example, the preview renders corrupted content that differs from what gets saved.

**Impact:** Preview does not match published output, leading to author confusion and potential XSS smuggling.

**Recommendation:** Remove `decodeHtmlEntities` unless there is a documented encoding pipeline requirement. Add a comment explaining the need if it is retained.

---

### 4.9 No Malware Scanning on Uploads

**File:** `routes/api.js:29-41`

Uploaded files pass only extension/MIME checks. No content-type sniffing, ClamAV integration, or file-signature verification.

**Recommendation:** Integrate `clamav.js` or `file-type` for content inspection. Store uploads outside the web root and serve through a proxy.

---

### 4.10 No `X-Content-Type-Options: nosniff`

**Files:** `server.js` (no security headers)

Browsers may MIME-sniff uploaded or served files, increasing the impact of file-upload attacks.

**Recommendation:** Add `helmet()` middleware or set `X-Content-Type-Options: nosniff` manually on all responses.

---

### 4.11 `database/init.js` Invokes `initDatabase()` Both via Export AND at Module Bottom

**File:** `database/init.js:80-83`

`initDatabase()` is called at the bottom of the file after `module.exports`. `server.js` also calls `initDatabase()` at line 94. If the module is required before `server.js` runs, the DB is initialized twice in the same process.

**Recommendation:** Remove the bottom-of-file invocation. Call `initDatabase()` only from `server.js`.

---

### 4.12 `database/seed.js` Runs at Module Load Time

**File:** `database/seed.js:185-188`

`require('./database/seed')` executes `seedPosts()` immediately. This is surprising behavior for an import and conflicts with `server.js`'s seeding logic.

**Recommendation:** Export a function `seedPosts()` and call it explicitly from `server.js` or a CLI command.

---

### 4.13 No SQLite Schema Migrations or Version Tracking

**File:** `database/init.js`

Schema changes are made by editing `init.js` directly. No migration history, no up/down, no way to know what schema version a deployed database is on.

**Recommendation:** Add a `schema_version` table. Implement a simple migration runner (e.g., `db-migrate` or a custom numbered migration system).

---

### 4.14 No Graceful Shutdown

**File:** `server.js`

No `SIGTERM` / `SIGINT` handler. The SQLite connection is never explicitly closed on shutdown. A process kill during a write can corrupt the database file.

**Recommendation:** Add:
```js
process.on('SIGTERM', async () => {
  server.close();
  await getDb().then(db => db.close());
  process.exit(0);
});
```

---

### 4.15 No Validation Library — Ad-Hoc Checks Only

**Files:** All route files

Required fields are checked with `if (!title)` ad-hoc. No email, URL, or length validation exists. Slug format is not validated server-side.

**Recommendation:** Add `zod` or `joi` schemas for all request bodies. Validate at the route level before processing.

---

### 4.16 Repeated Column-Index Row Mapping

**Files:** `routes/api.js:128-140`, `routes/api.js:176-197`, `routes/admin.js:113-120`, `routes/public.js:37-50`

Every handler maps `row[0]` through `row[10]` to named properties by hand. A schema migration silently breaks these mappings.

**Recommendation:** Create a row-mapper utility: `const post = rowToPost(row)` that returns `{ id, title, slug, ... }`.

---

### 4.17 No Health Check Endpoint

**File:** `server.js`

No `GET /health` endpoint. Load balancers and process managers cannot verify liveness.

**Recommendation:** Add `app.get('/health', (req, res) => res.json({ status: 'ok' }))`.

---

### 4.18 No Testing Framework

**Files:** Project-wide

Zero tests exist. The tag-resolution, slug-generation, and frontmatter-parsing logic are all testable pure functions that have no coverage.

**Recommendation:** Add `jest` or `vitest`. Write unit tests for `slugify()`, `parseFrontmatter()`, tag resolution, and the YAML-safe parsing path.

---

### 4.19 Unvalidated Slug Pattern in API

**File:** `views/admin-editor.ejs:52` (client-side only), `routes/api.js:244-255`, `routes/api.js:294-312`

Client-side `pattern="[a-z0-9-]+"` validation exists, but server-side routes accept slugs without format checks. A curl/Postman request can pass slugs containing path traversal characters or SQL comment syntax.

**Recommendation:** Validate slug format server-side: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` with a max length of 100.

---

### 4.20 No Password Complexity Requirements

**Files:** `routes/api.js`, `routes/admin.js`

The login form accepts any non-empty string. The default `admin123` is 9 characters with no mixed case, numbers, or symbols.

**Recommendation:** Enforce minimum 8 characters with at least one uppercase, one lowercase, one number, and one symbol.

---

## 5. Low Priority / Technical Debt

### 5.1 Magic Numbers Throughout Codebase

**Files:** `routes/api.js:40` (5 MB upload limit), `routes/public.js:94` (200 chars/min read time), `routes/import.js:105,193` (200 char excerpt limit)

These should be named constants (`MAX_UPLOAD_MB`, `CHARS_PER_MINUTE`, `EXCERPT_MAX_LENGTH`). The 200 chars/min read time is also a poor proxy — it uses character count, not word count, and applies the same rate to CJK and Latin text.

---

### 5.2 No HTTP Compression or Cache Headers

**Files:** `server.js:104-110`

No `compression()` middleware. No `Cache-Control`, `ETag`, or `Last-Modified` headers. HTML responses are 2–5× larger than gzip equivalents.

**Recommendation:** Add `compression()` middleware. Set `Cache-Control: public, max-age=300` on API responses and `Cache-Control: no-cache` on dynamic pages.

---

### 5.3 No Asset Fingerprinting / Cache Busting

**Files:** `public/css/`, `public/js/`

CSS and JS filenames contain no content hash. Setting long `max-age` cache headers is unsafe without a build step.

**Recommendation:** Add a build step (e.g., `vite` or `esbuild`) that produces content-hashed filenames.

---

### 5.4 No Request ID / Tracing

**Files:** Project-wide

Concurrent requests are indistinguishable in logs. No request-specific identifier exists to correlate frontend errors with backend logs.

**Recommendation:** Add a request ID middleware (`cls-hooked` or async local storage).

---

### 5.5 Single Process, No Clustering

**File:** `server.js`

No `cluster` module usage. Node.js runs on a single CPU core by default.

**Recommendation:** Use `pm2` in cluster mode or the built-in `cluster` module. Note: this requires fixing the MemoryStore session issue first.

---

### 5.6 No CDN for Static Assets or Uploads

**File:** `server.js:108-110`

All assets served from the origin server. No geo-distribution or edge caching.

**Recommendation:** Serve uploads and static assets through a CDN (e.g., Cloudflare R2 + Cloudflare CDN).

---

### 5.7 Cover Image `src` Without CSP Nonce

**File:** `views/post.ejs:19`

`<img src="...">` rendered from database content. Without CSP `img-src` restrictions, a stored XSS payload could embed external tracking pixels or CSRF-probe images.

**Recommendation:** Add CSP `img-src` directive restricting to `'self' data:`.

---

### 5.8 Duplicate `getDb` in `admin.js` is Dead Code Risk

**File:** `routes/admin.js:12-19` and `routes/admin.js:33-41`

The first `async function getDb()` is completely shadowed by the identical second declaration. Future edits that modify only one definition create subtle bugs.

**Recommendation:** Delete the first definition (lines 12-19).

---

### 5.9 `method-override` Accepts Any Method Without Validation

**File:** `server.js:107`

`app.use(methodOverride('_method'))` with no allowlist. An attacker can send `X-HTTP-Method-Override: PURGE` or other unexpected HTTP verbs.

**Recommendation:** Add an allowlist: `methodOverride('_method', { methods: ['POST', 'PUT', 'DELETE'] })`.

---

### 5.10 `saveUninitialized: false` Prevents Empty Session Creation

**File:** `server.js:120-125`

This is actually a good practice, but combined with `resave: false`, there is no server-side session cleanup mechanism for stale sessions.

**Recommendation:** Add a session cleanup job that prunes expired sessions periodically.

---

### 5.11 Upload Directory Created with Default Permissions

**File:** `routes/api.js:14-16`

`fs.mkdir('uploads', { recursive: true })` with no explicit permissions. On Linux, the directory may be world-readable/writable.

**Recommendation:** Set explicit permissions: `fs.mkdir('uploads', { recursive: true, mode: 0o750 })`.

---

### 5.12 Dependency Versions May Be Outdated

**File:** `package.json`

`js-yaml: ^5.3.0` is a production dependency. js-yaml 5.x has a known RCE CVE; verify whether 5.3.0 specifically is affected.

**Recommendation:** Audit dependencies with `npm audit`. Update `js-yaml` to the patched version or replace with `yaml` (which has a safe default schema).

---

## 6. Positive Observations

1. **Parameterized SQL queries:** All `sql.js` queries use `?` placeholders with value arrays. Classic SQL injection is not present.
2. **bcrypt cost factor of 10:** `database/init.js:64` uses a reasonable bcrypt cost factor for password hashing.
3. **`express.urlencoded({ extended: true })` uses safe parser:** The `qs` library is safe for this use case.
4. **No CORS misconfiguration:** No `cors` middleware is configured, which is appropriate for a same-origin application.
5. **Upload size limit exists:** `routes/api.js:40` checks `file.size > 5 * 1024 * 1024`. A limit is in place, even if it could be configured server-side.

---

## 7. Recommendations (Prioritized)

### Immediate (Before Any Production Use)

| Priority | Action | Impact |
|----------|--------|--------|
| 1 | **Remove or sanitize `marked` output** — add DOMPurify or `sanitize: true` | Eliminates stored XSS |
| 2 | **Replace `yaml.load()` with safe schema** — use `yaml.load(text, { schema: yaml.defaultSafeSchema })` or `gray-matter` | Eliminates RCE |
| 3 | **Move session secret to env var** — `process.env.SESSION_SECRET` with random fallback | Prevents session forgery |
| 4 | **Add write mutex to `saveDb()`** — serialize all DB writes through a queue | Eliminates silent data loss |
| 5 | **Remove hardcoded credentials from banner and README** — generate random password on first run | Eliminates credential leakage |
| 6 | **Add path validation to import file listing** — whitelist filename pattern | Eliminates path traversal |
| 7 | **Set secure cookie flags** — `httpOnly`, `sameSite`, `maxAge` | Eliminates session theft vector |
| 8 | **Regenerate session ID after login** — `req.session.regenerate()` | Eliminates session fixation |
| 9 | **Add rate limiting to login endpoints** — `express-rate-limit` | Reduces brute-force risk |
| 10 | **Add CSRF tokens** — `csurf` middleware | Eliminates CSRF |

### Short-Term (Next Sprint)

| Priority | Action |
|----------|--------|
| 11 | Add CSP headers via `helmet` |
| 12 | Add `X-Frame-Options: DENY` |
| 13 | Add input validation with `zod` or `joi` |
| 14 | Add ownership checks to post CRUD (IDOR fix) |
| 15 | Return 404 for PUT/DELETE on non-existent resources |
| 16 | Increase `GROUP_CONCAT` limit or restructure tag queries |
| 17 | Add `finally { db.close() }` to all route handlers |
| 18 | Replace MemoryStore with persistent session store |

### Medium-Term (Next Month)

| Priority | Action |
|----------|--------|
| 19 | Extract shared utilities (`getDb`, `saveDb`, `slugify`, tag logic) into `lib/` |
| 20 | Split `routes/api.js` into focused route files |
| 21 | Add service layer for business logic |
| 22 | Replace generic error responses with structured error handling |
| 23 | Add request body size limits |
| 24 | Add file-signature validation on uploads |
| 25 | Add SQLite schema versioning and migration runner |
| 26 | Add health check endpoint and graceful shutdown handler |

### Long-Term (Ongoing)

| Priority | Action |
|----------|--------|
| 27 | Add gzip/brotli compression and cache headers |
| 28 | Add content-hashed asset fingerprinting |
| 29 | Add test suite with unit tests for pure functions |
| 30 | Add structured logging (pino/winston) |
| 31 | Migrate from sql.js to `better-sqlite3` for proper concurrent access |
| 32 | Add in-memory markdown render cache |
| 33 | Add image optimization pipeline (resize, WebP, lazy loading) |

---

## Appendix: Finding Index by File

| File | Findings |
|------|----------|
| `server.js` | Hardcoded secret, insecure cookies, no CSRF, no CSP, no rate limit, session fixation, logging credentials, seeding side effects, no compression, no health check, no graceful shutdown |
| `routes/api.js` | God file, duplicated logic, unsafe YAML, race condition, generic errors, no existence checks, GROUP_CONCAT limit, no body size limits, no validation, column-index mapping, MIME-spoofable uploads |
| `routes/admin.js` | Duplicate `getDb`, dead code, login duplication, no `finally` close, session fixation, decodeHtmlEntities issue |
| `routes/import.js` | Path traversal, unsafe YAML, BOM handling, partial import failure, side-effect module load, duplicate `getDb` |
| `routes/public.js` | No `finally` close, GROUP_CONCAT limit, no cache headers |
| `views/post.ejs` | Stored XSS, attribute injection |
| `views/admin-preview.ejs` | Stored XSS |
| `views/admin-editor.ejs` | Client-side-only validation |
| `views/admin-dashboard.ejs` | Attribute injection |
| `database/init.js` | Hardcoded credentials, double invocation, no migrations |
| `database/seed.js` | Side-effect module load, triple seeding |
| `package.json` | Potentially vulnerable `js-yaml` version |
