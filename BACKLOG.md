# BACKLOG.md — deferred items (all verified still-true as of 2026-09-05)

Carried over from the launch-readiness audit (`FINDINGS.md`, ids kept) after the
launch-prep pass fixed the CRITICAL/HIGH security items (S1, S2, S3+S15, S6, S12 —
see git log; S9 and S11 fixed later — TRUST_PROXY + per-(ip,email) limiter, see git
log). Everything here is real but deliberately deferred: none blocks launch.

## Security (MED)

- **S4 — contributors can read SMTP credentials.** `GET /api/store` returns the full
  project blob to any authenticated role, so contributors can read `settings.smtp`
  they're forbidden to modify (`server/index.mjs`). Fix: redact secret fields for
  contributors, or move SMTP config server-side like the GitHub token (the
  `publish.json` + `/api/publish-config` pattern is the template).
- **S5 — media replace/delete open to contributors** (`server/media.mjs`). A
  semi-trusted user can overwrite or remove any asset used across the site. Fix:
  gate replace/delete behind editor+ (or ownership).
- **S7 — project import has no cumulative decompressed-size ceiling.** Import reads
  up to 512 MB and inflates entries unchecked → zip-bomb memory exhaustion
  (admin-only, still a one-click DoS). Fix: cap total `uncompSize` in
  `server/zip.mjs` before inflating.
- **S8 — password change doesn't invalidate other sessions** (`server/auth.mjs`).
  A stolen 30-day session survives a reset. Fix: destroy the user's other sessions
  on password change.
- **S10 — no CSP / X-Frame-Options on either static surface.** Neither the admin
  SPA nor the published site sends `Content-Security-Policy` or `frame-ancestors`
  (only `nosniff`; served `.svg` files do get a CSP now). Both are framable and any
  future XSS has free rein. Fix: add CSP + XFO to both static handlers in
  `server/index.mjs`. Needs care: the published site legitimately runs the custom-code
  feature, so its CSP must stay permissive for user scripts — XFO/frame-ancestors is
  the uncontroversial half.

## Security (LOW)

- **S13 — GitHub repo/branch regexes allow `.`/`..` segments** (`server/github.mjs`),
  permitting api.github.com path manipulation under the configured token. Fix:
  reject `..` and edge dots.
- **S14 — `/api/users/members` exposes member + invite emails to contributors.**
  Fix: limit PII to editor+.
- **S16 — `settings.domain` interpolated into canonical/OG URLs unvalidated**
  (poisoning only, `server/export.mjs`). Fix: hostname-pattern check.

## Refactors

- **Q4 — split `CodeEditor.vue` (2,034 lines, ~7 subsystems).** All subsystems share
  the single textarea ref and the folding display↔real line mapping (`d2r`/`r2d`,
  referenced ~29×). The e2e suite is green now, so the gate this was waiting on is
  satisfied. Safe order: (1) `useCodeFolding(code, foldRanges)` — owns `d2r`/`r2d`/
  fold state, the one dependency everything else consumes; (2) `useGutterReorder` —
  drag/keyboard reorder + ghost animation (self-contained after 1, talks to
  useElement's explicit-map reconcile); (3) the status mini-dropdown + validation
  display into a small child component. Each step type-checks and ships separately.
- **D4 — some exported symbols are single-file** (drop the `export` keyword):
  `linkFromToken`, `suggestNextLine` (`src/lib/syntax.ts`), `LocalePack`
  (`src/lib/merge.ts`), `KIND_MIMES` (`src/lib/media.ts`). Re-grep before applying.
  (`lexLine` and `isValidClass` were on this list but are now re-exported by
  `src/lib/mcp-runtime.ts` for the MCP server — no longer single-file.)
- **Foldering nits:** `components/site/ContentRenderer.vue` and `CommentLayer.vue`
  are admin-only but live in `site/` (pure move + ~4 import updates);
  `lib/roles.ts` type-imports `Role` from a composable — move the type to
  `src/types/editor.ts`.

## Tooling

- **C7 — `npm run test:e2e` silently requires a prior `npm run build`** (the e2e
  server serves `dist/`); only a code comment says so. Fix: pre-step or README note.
- **C8 — `scripts/generate-demo.ts` needs `npx tsx` but `tsx` isn't a
  devDependency** and there's no npm script; output path is cwd-relative. Fix: add
  `tsx` to devDependencies and a `gen:demo` script.

## MCP (v1 limits)

The `guano mcp` server (`packages/guano/mcp/`, see `PLAN-MCP.md`) shipped Phases
0–5. Known, deliberately-deferred limits:

- **M1 — no in-server HTTP transport.** v1 is a stdio CLI (`guano mcp`) that
  talks to a running instance over the HTTP API. A streamable-HTTP `/mcp`
  endpoint on the node server is out of scope (would let remote agents connect
  without a local process).
- **M2 — no optimistic locking on the store.** Writes are latest-wins. Page and
  element tools take a `version` hash (sha256 of the page code) that guards
  line-based edits against a stale read, but collection/comment/interaction
  writes are id-keyed and unguarded — a concurrent human edit to the same item
  can still be clobbered. Drafts are the mitigation (the human picks the target).
- **M3 — no zip/github publish over MCP.** `publish` only runs the `server`
  export method; zip/github stay editor-only.
- **M4 — comments are read/written on the target blob.** They're shared across
  drafts and never merged, so a reply added to a draft isn't visible on Main
  until the human is on that target. No `create_comment` tool (reply only).
- **M5 — component masters aren't editable over MCP.** `set_element_classes` /
  `bind_interaction` refuse component-instance subtrees with an honest error;
  editing the shared master is not yet exposed.
