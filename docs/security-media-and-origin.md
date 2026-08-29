# Media library trust model + server-wide Origin gate

**Status:** implemented (2026-08-22), alongside the Media Library feature.
**Context:** `server/media.mjs`, the `/api/media` + `/media/` routes, and the
cross-cutting hardening applied to `server/index.mjs`.

## Media uploads (the classic CMS breach surface)

Every control is server-side; client checks are UX only.

- **No unauthenticated `/api/media` route.** `handleMedia` checks the session
  before reading the body or touching disk. The only public routes are the two
  byte-serving GETs (`/media/<id>`, `/media/thumb/<id>`) — bytes only, no
  listing, ids are 64-bit random (`crypto.randomBytes`), and `index.json` sits
  outside the served dirs.
- **Declared Content-Type is never trusted.** Uploads are magic-byte verified
  against their claimed mime (`matchesMime`); mismatch → 415. `text/html`,
  JavaScript, and generic XML are not on the allowlist at all.
- **SVG is sanitized at intake** (`sanitizeSvg`: scripts, `foreignObject`,
  `on*` handlers, script-scheme hrefs stripped) *and* served with
  `Content-Security-Policy: default-src 'none'` + `nosniff` — two independent
  layers against stored XSS.
- **Paths are structurally traversal-proof**: storage is extensionless under
  server-generated ids validated by `/^[a-f0-9]{16}$/` before any `path.join`;
  the client filename is metadata only (sanitized before appearing in a
  `Content-Disposition` header).
- **Resource limits**: streaming size caps that kill the request at the limit
  (per-kind: 20 MB images, 200 MB av, 25 MB docs/fonts), sharp
  `limitInputPixels` (pixel bombs), `MEDIA_QUOTA` disk quota (default 2 GB),
  30 uploads/min per user.

All roles (incl. contributors) may upload/rename/delete — an agreed product
decision; `uploadedBy` is recorded, and tightening delete to `canBuild` is a
two-line change at the top of those handler branches.

## Server-wide Origin gate (CSRF defense-in-depth)

The session cookie is `HttpOnly; SameSite=Lax` (+`Secure` in prod). On top of
that, the dispatcher in `server/index.mjs` rejects **any mutating `/api/*`
request whose `Origin` header doesn't match the request `Host`** (403).

- Browsers always send `Origin` on cross-site non-GET requests → blocked even
  where SameSite wouldn't apply (old browsers, future cookie-policy drift).
- Non-browser clients (curl, the CI `PUBLISH_TOKEN` publish) send no `Origin`
  and pass.
- The vite dev proxy preserves `Host`, so same-origin dev requests match.

`handleStatic` and the media file routes additionally send
`X-Content-Type-Options: nosniff` on everything they serve.

## Still open (tracked, not regressions)

- The contributor structural-write gap in `/api/store` — see
  `security-structural-enforcement.md` (pre-existing, intentional).
- `/api/store` has no rate limit or per-key authorization beyond "any authed
  user"; the login/invite flows have their own brute-force limiter.
- The `PUBLISH_TOKEN` bearer comparison is not constant-time (low value: the
  token is operator-chosen and the endpoint is already rate-limited only by
  export cost).
