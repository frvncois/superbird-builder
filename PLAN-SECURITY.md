# PLAN-SECURITY.md — pen-test remediation batch

Fixes from the 2026-09-15 authorized pen test. All are small, contained, and
independent of one another (do them in any order; they touch different files or
different functions). Nothing here changes the public product behaviour except
where noted. After the batch: `npm run type-check`, restart the server, run the
verification probes at the bottom.

Context you need before starting:
- Server is plain Node, no framework. Entry: `server/index.mjs`. Auth:
  `server/auth.mjs`. Media: `server/media.mjs`. Exporter: `server/export.mjs`.
  Zip codec: `server/zip.mjs`.
- Roles are `admin | editor | contributor`. `canBuild` = admin|editor;
  contributor is content-only (edits in the Preview surface).
- The MCP server authenticates with a `guano_` bearer token → resolves to its
  owning user with a **live** role. `requestUser(req)` accepts session cookie OR
  bearer; `sessionUser(req)` accepts session cookie only.
- Do NOT weaken any existing check. Each task ADDS a gate or a cap.
- The live instance serves the real guano.dev site from a draft; do not run
  destructive requests against it while testing. The verification probes below
  are all reads / expected-rejections.

---

## Task 1 — S5: block contributors from destroying shared media (MED, do first)

**Problem:** `handleMedia` in `server/media.mjs` gates only on "is authenticated"
(`if (!user) return 401`) plus the origin check. Any role — including a
contributor — can therefore **replace the bytes of, or delete, any media asset**
used across the whole site, and mutate the folder tree. Upload and metadata
edits are fine for contributors (they add/caption their own media in Preview);
destructive/structural ops are not.

**Fix:** in `server/media.mjs`, inside `handleMedia`, right after the existing
origin check

```js
  const mutating = req.method !== 'GET'
  if (mutating && !originAllowed(req)) return fail(res, 403, 'cross-origin request rejected')
  await loadIndex()
```

add:

```js
  // contributors may browse (GET), upload their own media (POST /api/media) and
  // edit metadata (PATCH /api/media/:id) — but NOT replace bytes, delete assets,
  // or restructure folders, which affect shared library state site-wide (S5).
  const isContributor = user.role === 'contributor'
```

Then gate the three destructive/structural branches. Add the guard as the FIRST
line inside each:

1. Asset replace — the `if (action === 'replace' && req.method === 'POST')` block
   (~line 550):
   ```js
   if (action === 'replace' && req.method === 'POST') {
     if (isContributor) return fail(res, 403, 'forbidden')
   ```
2. Asset delete — the `if (!action && req.method === 'DELETE')` block (~line 597):
   ```js
   if (!action && req.method === 'DELETE') {
     if (isContributor) return fail(res, 403, 'forbidden')
   ```
3. Folder mutations — cover create, patch, and delete. Add at the very top of
   both the `if (path === '/api/media/folders' && req.method === 'POST')` block
   (~line 461) and the `if (path.startsWith('/api/media/folders/'))` block
   (~line 480):
   ```js
   if (isContributor) return fail(res, 403, 'forbidden')
   ```
   (The folders/:id block handles both PATCH and DELETE, so one guard at its top
   covers both.)

Leave `GET /api/media`, `POST /api/media` (upload), and
`PATCH /api/media/:id` (metadata) unguarded — contributors keep those.

**Verify:** with a contributor session, `POST /api/media/<id>/replace`,
`DELETE /api/media/<id>`, and any `/api/media/folders*` mutation → 403; upload
and metadata PATCH still 200. (No contributor account handy → confirm by code
review that the three branches now return 403 for `role === 'contributor'`.)

---

## Task 2 — S14: stop leaking member/invite emails to contributors (MED)

**Problem:** `handleUsers` in `server/index.mjs` answers `GET /api/users/members`
BEFORE the admin gate, returning every member's and pending invite's **email** to
any authenticated role, contributors included.

**Fix:** in the `/api/users/members` branch (~line 421), require editor+ (deny
contributor) before returning. Change:

```js
  if (path === '/api/users/members' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ users: listMembers(), invites: listInvitesPublic() }))
  }
```

to:

```js
  if (path === '/api/users/members' && req.method === 'GET') {
    // PII (emails) is editor+ only — contributors get the count, no addresses
    if (admin.role === 'contributor') {
      return send(res, 200, JSON.stringify({ users: [], invites: [], restricted: true }))
    }
    return send(res, 200, JSON.stringify({ users: listMembers(), invites: listInvitesPublic() }))
  }
```

(Returning an empty, `restricted`-flagged shape rather than 403 keeps the
contributor UI from erroring on a team panel it may render. If the UI doesn't
need it at all for contributors, a `return fail(res, 403, 'forbidden')` is also
fine — check `src/components/shared/UsersSettings.vue` for how the response is
consumed before deciding.)

**Verify:** contributor session → `/api/users/members` returns no emails;
editor/admin → unchanged.

---

## Task 3 — S7: cap decompression in the zip reader (MED, one file)

**Problem:** `readZip` in `server/zip.mjs` calls `inflateRawSync(compressed)` with
no output ceiling and no cumulative cap, so a malicious package (admin-gated
project import) can inflate ~2 GB per entry and exhaust memory.

**Fix:** in `server/zip.mjs`:

1. Add caps near the top (after the imports):
   ```js
   const MAX_ENTRY_BYTES = 100 * 1024 * 1024 // per-entry decompressed ceiling
   const MAX_TOTAL_BYTES = 600 * 1024 * 1024 // cumulative across the archive
   ```
2. In `readZip`, declare a running total before the loop:
   ```js
   const out = []
   let totalBytes = 0
   ```
3. Reject an oversized declared size before inflating, and bound the inflate.
   Replace the decompress block (~lines 154-160):
   ```js
   let data
   if (method === 0) data = Buffer.from(compressed)
   else if (method === 8) data = inflateRawSync(compressed)
   else throw expose(`unsupported compression method ${method}`)

   if (data.length !== uncompSize) throw expose(`size mismatch for ${name}`)
   ```
   with:
   ```js
   if (uncompSize > MAX_ENTRY_BYTES) throw expose(`entry too large: ${name}`)
   let data
   if (method === 0) data = Buffer.from(compressed)
   else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
   else throw expose(`unsupported compression method ${method}`)

   if (data.length !== uncompSize) throw expose(`size mismatch for ${name}`)
   totalBytes += data.length
   if (totalBytes > MAX_TOTAL_BYTES) throw expose('archive decompresses too large')
   ```

`maxOutputLength` makes `inflateRawSync` throw a `RangeError` on an over-cap
entry; the import handler already wraps `readZip` in try/catch → 400. No other
change needed. (`createZip` / the writer is untouched — it only handles trusted
server-produced data.)

**Verify:** a normal project import still round-trips (export then import in the
editor). Reasoning check: a crafted entry claiming/producing >100 MB now throws
instead of allocating.

---

## Task 4 — S16: validate `settings.domain` in the exporter (LOW)

**Problem:** `renderShell` in `server/export.mjs` interpolates `settings.domain`
into canonical + og:image URLs. It's `escapeHtml`-wrapped (so no XSS), but an
unvalidated value poisons those URLs, and a contributor can set `settings.domain`
via a raw store PUT (domain is not a sensitive-gated field), so validating only
on the `update_settings` write path does not fully close it — the exporter must
validate what it actually renders.

**Fix:** in `server/export.mjs`, add a hostname regex near the top-level helpers
(next to `escapeHtml`):

```js
// bare hostname only — anything else is ignored so it can't poison canonical/OG
const EXPORT_HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
```

Then in `renderShell` (~line 755) change:

```js
  const domain = settings.domain || ''
```

to:

```js
  const raw = String(settings.domain ?? '').trim().toLowerCase()
  const domain = EXPORT_HOSTNAME_RE.test(raw) ? raw : ''
```

Everything downstream (`absolute()`, the canonical `<link>`) already keys off
`domain` being truthy, so an invalid domain now simply behaves as "no domain."

**Verify:** export with `settings.domain = "evil.com/path\""` → no canonical tag
and og:image stays relative (invalid domain ignored); with `settings.domain =
"example.com"` → absolute URLs as before.

---

## Task 5 — S8: password change invalidates other sessions (LOW/MED)

**Problem:** changing a password (`POST /api/auth/update`) doesn't revoke the
user's other sessions, so a stolen 30-day cookie survives a reset.

**Fix, part A** — export the session-revoke helper. In `server/auth.mjs`, change
`function destroyUserSessions(userId)` (~line 240) to
`export function destroyUserSessions(userId)`.

**Fix, part B** — in `server/index.mjs`:
1. Add `destroyUserSessions` to the import block from `./auth.mjs` (alphabetical
   with the others).
2. In the `/api/auth/update` handler (~line 296), after the successful
   `updateUser` call, when the password actually changed, revoke ALL of the
   user's sessions and issue a fresh cookie for THIS request so the current
   session isn't logged out. Replace:
   ```js
   const updated = await updateUser(user.id, { name, email, password })
   return send(res, 200, JSON.stringify(userProfile(updated)))
   ```
   with:
   ```js
   const changingPassword = password !== undefined && password !== ''
   const updated = await updateUser(user.id, { name, email, password })
   if (changingPassword) {
     // revoke every existing session (old cookies die), then re-issue one for
     // the caller so they stay logged in on this device (S8)
     destroyUserSessions(user.id)
     return send(res, 200, JSON.stringify(userProfile(updated)), 'application/json', {
       'set-cookie': sessionCookieHeader(createSession(user.id)),
     })
   }
   return send(res, 200, JSON.stringify(userProfile(updated)))
   ```

`createSession` and `sessionCookieHeader` are already imported in index.mjs.

**Verify:** log in from two browsers, change the password in browser A → browser
B's next authed request returns 401 (cookie revoked); browser A stays logged in.

---

## Task 6 — S10 (uncontroversial half): clickjacking header on the admin editor (LOW)

**Problem:** neither static surface sends `X-Frame-Options` / `frame-ancestors`,
so the admin editor is framable (clickjacking). Do NOT add a restrictive CSP to
the admin SPA in this batch — the editor compiles Tailwind at runtime in the
browser and a strict `script-src` may break it; that needs its own testing pass.
The frame header is the safe, uncontroversial half.

**Fix:** in `server/index.mjs`, `handleStatic`, the `/admin` branch only. Where
it currently does:

```js
    const target = isDistFile ? distFile : join(DIST, 'index.html')
    try {
      const data = await readFile(target)
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', headersFor(target))
```

change the headers to add frame protection for the admin surface:

```js
    const target = isDistFile ? distFile : join(DIST, 'index.html')
    try {
      const data = await readFile(target)
      const adminHeaders = { ...headersFor(target), 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', adminHeaders)
```

Leave the published-site branch unchanged (public sites are legitimately
embedded; framing them is not a vulnerability the way framing the editor is).
Note: `frame-ancestors 'none'` here is a minimal CSP that ONLY restricts framing
— it does not set `default-src`/`script-src`, so it won't touch the editor's
runtime Tailwind compile.

**Verify:** `curl -sI http://localhost:4174/admin/ | grep -i "x-frame\|frame-ancestors"`
shows the headers; the editor still loads and compiles classes.

---

## Task 7 — S13: reject dot-segments in GitHub repo/branch (LOW, optional)

**Problem:** `REPO_RE`/`BRANCH_RE` in `server/github.mjs` allow `.` and `..`
segments, permitting api.github.com path manipulation under the configured token.
Barely exploitable (the URL parser collapses `..`), but cheap to close.

**Fix:** in `server/github.mjs`, after the regex test in `pushSiteToGitHub`
(~line 22), add an explicit dot-segment rejection:

```js
  const hasDotSeg = (s) => String(s).split('/').some((seg) => seg === '.' || seg === '..')
  if (!REPO_RE.test(repo ?? '') || !BRANCH_RE.test(branch ?? '') || !token) {
    throw expose('github publishing is not configured (repo/branch/token)')
  }
  if (hasDotSeg(repo) || hasDotSeg(branch)) {
    throw expose('invalid repo or branch name')
  }
```

**Verify:** `repo: "../x/y"` or `branch: "a/../b"` → the push fails fast with
"invalid repo or branch name"; a normal `owner/repo` + `main` still works.

---

## After the batch

1. `npm run type-check` (must stay clean — these are `.mjs` server files, but run
   it anyway; nothing here touches `src/`).
2. `node --check` each edited file:
   `node --check server/media.mjs server/index.mjs server/zip.mjs server/export.mjs server/auth.mjs server/github.mjs`
3. Restart the server (repo root): kill the process on :4174, then
   `node server/index.mjs` (or `npm run serve`).
4. Re-run the boundary probes to confirm nothing regressed:
   ```sh
   B=http://localhost:4174
   curl -s -o /dev/null -w "unauth store %{http_code}\n" "$B/api/store?keys=guano-project:main"          # 401
   curl -s -o /dev/null -w "xorigin publish %{http_code}\n" -X POST -H "Origin: http://evil" -H "Content-Type: application/json" --data '{"pages":[]}' "$B/api/published"  # 403
   curl -sI "$B/admin/" | grep -i "x-frame-options"                                                        # X-Frame-Options: DENY
   ```
5. Update `BACKLOG.md`: mark S5, S7, S8, S14, S16 as fixed (and S13 if Task 7 was
   done); note that S10 remains open for the admin CSP `script-src` half (framing
   done, content-CSP deferred pending editor-runtime testing). S4 (contributor
   reads non-secret smtp fields from the blob) is NOT addressed by this batch.

## Not in scope (leave for a separate, tested pass)
- S4 — redact non-secret smtp/integration fields from the project blob for
  contributors (needs a redaction layer on `GET /api/store`, risk of breaking
  autosave round-trips — design carefully).
- S10 admin content-CSP — a real `script-src`/`default-src` for the editor SPA;
  must be tested against the runtime `@tailwindcss/browser` compile before
  shipping or it will white-screen the editor.
