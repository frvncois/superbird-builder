# Deferred: server-side structural enforcement for Contributors

**Status:** not implemented (intentional, agreed limitation).
**Context:** the Users / roles / invites feature (`admin` · `editor` · `contributor`).

## The gap

Roles gate the UI, and the server hard-gates the genuinely sensitive actions:

- **Publish** (`POST /api/published`) → `admin` | `editor` only (contributor → 403).
- **User management** (`/api/users*`, invites) → `admin` only.
- **Auth** endpoints, last-admin guard, etc.

But the **project itself is a single blob** persisted through the generic key-value
store (`GET/PUT/DELETE /api/store/...`). A Contributor legitimately needs to
**write** that store because their content edits (text, images, entry values) *are*
project writes. There is no separate "content-only" write path.

**Consequence:** a determined Contributor could craft a `PUT /api/store/<key>` with
**structural** changes (new/removed elements, class changes, settings, etc.), not
just content. The build/structure restriction is therefore **UI-enforced only** — the
editor never lets them do it, but the API can't currently tell a content change from a
structural one on a whole-project blob.

This was an explicit product decision (chosen over the heavier alternative below).

## What "true" enforcement would require

Server-side **diffing on every save**: compare the incoming project snapshot against
the stored one and reject any change outside a Contributor's allowed surface.

Rough shape:

1. On `PUT /api/store/superbird-project:<branch>` by a `contributor`, load the current
   stored project and deep-diff against the incoming one.
2. Define the **content-only allow-list** — the only fields a Contributor may change:
   - `page.elements[*].content`
   - `page.elements[*].src`
   - `page.elements[*].locales[*].{content,src}`
   - `collection.entries[*].values[*]` and `.locales[*]`
   - `comments[*]` (add/reply/resolve)
   - (explicitly **not**: element add/remove/reorder, `classes`, `interactions`,
     `htmlId`, `link`, `arg`, `page.code`, `page`/`collection`/`component` structure,
     `settings`, `breakpoints`, `customCode`, `interactions` library, branches…)
3. If any diff touches a field outside the allow-list → `403` and drop the write.

## Why it's hard / deferred

- **`page.code` is the source of truth for structure** (see `CLAUDE.md`). Content edits
  don't touch `code`, but the diff must understand that `elements` is derived from
  `code` and that a Contributor changing `content` is fine while a changed `code`/tree
  is not. The allow-list has to be expressed against the real data model, carefully.
- **Cost & fragility:** a full deep-diff on every autosave (snapshots can be several MB
  with data-URL media) is slow, and the allow-list must be kept in lockstep with the
  schema forever — every new field is a potential silent bypass or false-positive.
- **Branches / components / collections** multiply the surface (per-branch project
  copies, master vs instance nodes, template pages).
- Marginal benefit for a self-hosted, invite-only tool where all users are people the
  admin deliberately invited (trusted-but-scoped, not adversarial).

## If we revisit

- Consider a **separate content API** instead of diffing the blob: narrow endpoints
  like `PUT /api/content/node/:id` / `PUT /api/entry/:id/:field` that can only write
  content fields, and forbid Contributors from the raw project-store `PUT` entirely.
  This makes the server the enforcer by construction (no diffing, no allow-list drift)
  but requires the content-mode client to route edits through those endpoints.
- Or accept the diff approach but bound the cost (hash/section-level comparison,
  skip unchanged pages, cap snapshot size for Contributors).

**Files involved today:** `server/index.mjs` (`handleStore`, `handlePost`),
`server/auth.mjs` (roles/sessions). Client content writes go through
`src/lib/store.ts` → the store API.
