# PLAN-MCP.md — MCP connection for Guano

Implementation plan for exposing a Guano instance to AI agents over MCP.
Written to be executed without prior session context — read CLAUDE.md first;
this plan defers to it on every architectural invariant.

## Settled decisions (do not re-litigate)

- **Transport/home (v1):** a `guano mcp` CLI subcommand in `packages/guano`
  (stdio transport, `@modelcontextprotocol/sdk` as a dependency of the
  *package*, never of the zero-dep server). It talks to a running Guano
  instance — local or deployed — through the existing HTTP API. An in-server
  streamable-HTTP `/mcp` endpoint is explicitly phase-2 / out of scope.
- **Auth:** new per-user API tokens on the server (bearer), not `PUBLISH_TOKEN`
  reuse, not cookies.
- **Target choice is the human's:** the agent must ask its user whether to work
  on Main or in a draft. Write tools fail until a target is set via `set_target`.
- **Styling AND interactions are v1** — not deferred. Structure-only is not an
  acceptable v1.
- **Never touch the data dir directly** — all access goes through the HTTP API
  of the running server.

## Architecture facts you will need

- Store API: `GET/PUT/DELETE /api/store/<key>` (`server/index.mjs`,
  `handleStore`). Keys map to files as `key.replaceAll(':', '__') + '.json'`
  under `<data>/store/`. Project blobs: `guano-project:main` and
  `guano-project:<branchId>`; branch metadata list: `guano-branches`; 3-way
  merge base snapshots: `guano-base:<branchId>` (see `src/composables/useBranches.ts`).
- The bearer-token check pattern to imitate: `server/index.mjs` ~line 512
  (`PUBLISH_TOKEN` via `timingSafeEqualStr` on the `Authorization` header).
- Hashed-secret-at-rest pattern to imitate: invites in `server/auth.mjs`
  (256-bit random token, only its sha256 stored, single-use/revocable).
- A `Page` in the project blob carries BOTH `code` (DSL text, authoritative)
  and `elements` (derived tree holding `classes`, `interactions`, `content`,
  `src`, `htmlId`, `locales`, `conditions` — state NOT present in the code).
  Any external writer that changes `code` MUST re-derive `elements` through
  `reconcile` (`src/lib/syntax.ts:328`) or node identity/state is destroyed.
  This is the single most important invariant in this plan.
- Class editing must go through `applyClass` (`src/lib/styles.ts:383`) —
  validates against the catalog, replaces conflicting tokens, injects
  flex/grid prerequisites. Signature: `applyClass(cls, tokens, {prerequisites?})
  → { tokens? , error? }`.
- Interactions: `project.interactions` is a shared library of `Interaction`
  objects; elements hold `InteractionBinding[]`
  (`{ id, interactionId, trigger: 'hover'|'click'|'appear', targetId: string|null,
  breakpoints? }`) — see `src/types/editor.ts`. Bindings reference library
  entries; the binding's `targetId` must be a real node id or null.
- The `(+)` / `{+}` / `[+]` markers in page code are display-only derived
  state (CLAUDE.md "The DSL"). External writes may leave them stale; the
  editor's marker truth-sync re-derives them. Phase 3 must verify this
  actually happens on load and, if not, update markers when writing.
- `server/export.mjs` + `src/lib/shared/` show the precedent for sharing
  logic between the TS client and plain-JS node code.

## The TS-to-runtime problem (solve first — Phase 0)

The MCP process needs `parseSyntax`/`reconcile`/`validateDocument`
(`src/lib/syntax.ts`), `buildDocument`/`extractBodyLines` (`src/lib/document.ts`),
the `ELEMENTS` registry + `createNode` (`src/lib/elements.ts`), tree helpers
(`src/lib/tree.ts`), and `applyClass` + catalog (`src/lib/styles.ts`). These
are TypeScript; the guano package runs plain node.

**Approach: bundle, don't port.** Add `src/lib/mcp-runtime.ts` that re-exports
exactly the needed functions, and a vite lib-mode build (separate tiny config,
e.g. `vite.mcp.config.ts`, `build.lib.entry = mcp-runtime.ts`, output ESM to
`packages/guano/runtime/mcp-runtime.mjs`, no vue plugin needed — these libs are
DOM-free; verify none of them import vue or browser globals, and if one does,
refactor the import graph, not the bundler config). Wire it into
`packages/guano/scripts/prepack.mjs` and add a root script
`build:mcp-runtime`. The MCP subcommand imports the bundle; in-repo dev runs
the build first.

## Phase 1 — API tokens (server + UI)

Server (`server/auth.mjs` + `server/index.mjs`):
- `api-tokens.json` in the data dir: `{ id, tokenHash, userId, name, createdAt,
  lastUsedAt }`. Raw token format `guano_<48 hex>`, shown exactly once at
  creation. sha256 at rest, lookup by hash (imitate invites).
- Endpoints: `GET /api/tokens` (list own, no hashes), `POST /api/tokens`
  (create, returns raw token once), `DELETE /api/tokens/:id` (revoke own;
  admin may revoke any). Admin + editor only — contributors get 403.
- Auth integration: where the request user is resolved (`sessionUser`), accept
  `Authorization: Bearer guano_…` as an alternative credential; resolve to the
  owning user; role is read live from the user record so demotion/deletion
  takes effect immediately. Timing-safe comparison; deleted user → token dead.
  Keep `PUBLISH_TOKEN` untouched as the CI escape hatch.
- Rate-limit token auth failures per IP (reuse the `limiter` in auth.mjs).

UI (`src/components/shared/AccountModal.vue`): an "API tokens" section —
create with a name, list with created/last-used, revoke with
`useModal().confirm`. Show-once raw token with a copy button (imitate the
invite-link copy UX in `InviteDialog`). Reuse `ButtonUI`/`InputUI`/`RowUI`;
no native tooltips; no hand-rolled inputs.

Verify: curl a store GET with `Authorization: Bearer <token>` succeeds;
revoked/garbage token → 401; contributor token creation → 403.

## Phase 2 — `guano mcp` skeleton + page tools

`packages/guano/bin/guano.js`: add `mcp` command → imports
`packages/guano/mcp/server.mjs`. Config via env: `GUANO_URL` (default
`http://localhost:4174`), `GUANO_TOKEN` (required). Add
`@modelcontextprotocol/sdk` to `packages/guano/package.json` dependencies.
Stdio transport. On boot, `GET /api/auth/me` with the bearer to fail fast on
bad URL/token.

Session state held in the MCP process: `target` (null | 'main' | branchId).

Tools (names, exact behavior):
- `get_status` — project name, current target, drafts list (from
  `guano-branches` store key), whether target is set.
- `set_target` — input `{ target: 'main' | '<branchId>' }` or
  `{ createDraft: '<name>' }`. Creating a draft mirrors what
  `useBranches.createBranch` does client-side: copy the current Main blob to
  `guano-project:<newId>`, snapshot `guano-base:<newId>`, append to
  `guano-branches`. Read useBranches first and replicate its shapes exactly —
  a draft the UI can't open is a failed implementation.
  Tool description MUST say: "Ask the user whether to work on Main or in a
  draft before selecting."
- `list_pages` — id, name, slug, status per page of the target blob.
- `get_page` — returns the DSL code with line numbers, a `version` (sha256 of
  the page's code), and a per-element summary: line → { type, classes,
  interactionCount, hasOwnContent }.
- `set_page_code` — input `{ pageId, code, version }`. Reject on version
  mismatch (stale read). Pipeline: run `validateDocument` — on errors, return
  them WITHOUT saving (the agent gets a compiler); then
  `reconcile(oldCode, newCode, previousElements)` to carry node identity; then
  rebuild the canonical document shape (`buildDocument`) and PUT the updated
  blob. Never write `code` without re-deriving `elements`.

Every write tool errors with "no target set — call set_target first" until
`set_target` ran.

Concurrency note (document in tool descriptions): the store is latest-wins;
writes to Main while a human edits can clobber. Read-modify-write windows are
kept short; drafts are the safe mode. This is why the human chooses.

Verify with `npx @modelcontextprotocol/inspector` against a scratch instance
(`GUANO_DATA_DIR=<scratch> PORT=4199 node server/index.mjs`): full loop —
create draft, read page, write invalid code (get errors, nothing saved), write
valid code, open the draft in the real editor and confirm the page renders and
node state (classes set via UI beforehand) survived the round-trip.

## Phase 3 — styling + interactions tools

- `get_styles` — input `{ pageId, line }` → the node's current class tokens.
- `set_element_classes` — `{ pageId, line, add?: string[], remove?: string[],
  version }`. Resolve line → node via the parse; apply each `add` through
  `applyClass` sequentially (accumulating tokens), collect per-class errors;
  `remove` filters tokens. Save node.classes on the blob. Component-instance
  subtrees: return the honest error ("styles live on the component master —
  edit the master block"), do not silently redirect.
- `list_interactions` — the `project.interactions` library (id, name, summary
  of states).
- `create_interaction` — create a library entry; mirror the `Interaction` type
  in `src/types/editor.ts` exactly (read it first; do not invent fields).
- `bind_interaction` / `unbind_interaction` — manage a node's
  `InteractionBinding[]`: `{ trigger, interactionId, targetId }`; validate
  `interactionId` exists and `targetId` (when non-null) is a real node id in
  the page. Omit `breakpoints` (= all) unless specified.
- After any of these, check whether stored page `code` markers (`(+)`, `{+}`)
  self-heal on editor load (marker truth-sync). If they do not, set/clear the
  marker in the code line as part of the write — via the same reconcile path,
  never by string-patching `elements`.

Verify in the real editor: classes set over MCP appear in the Style panel and
canvas; a bound hover interaction fires in Preview; invalid class names come
back as errors, not saved garbage.

## Phase 4 — collections, comments, publish

- `list_collections` / `get_collection` — fields, entry count, template page id.
- `upsert_entry` / `delete_entry` — respect field shapes; entry locale
  overrides live in `entry.locales[code]` with the same prune-empty rule as
  nodes (CLAUDE.md Localization) — an override emptied back must delete the
  key, keeping merge signatures stable.
- `create_collection` — only if cheap after reading `useCollections`; it also
  creates the template page (`collectionId` + `:body[name]` scaffold). If the
  client-side flow is deeply UI-coupled, defer to phase 5 and say so.
- `list_comments` / `reply_to_comment` — comments live on the project blob and
  are shared across branches (never merged); reply shape must match what
  `CommentThread` renders (read `useComments` first).
- `publish` — `POST /api/published?method=server` with the bearer. Editor+
  only (server already gates roles). Return the JSON stats. Do NOT implement
  zip/github methods over MCP in v1.

## Phase 5 — docs + hardening

- README: an "MCP" section — what it is, `claude mcp add`-style config example
  (`guano mcp` + `GUANO_URL`/`GUANO_TOKEN`), the Main-vs-draft model, token
  creation walkthrough.
- CLAUDE.md: replace the stale "this repo has no MCP server code" note with a
  pointer to `packages/guano/mcp/` and the Phase-0 runtime bundle.
- BACKLOG entries for known v1 limits: no in-server HTTP transport, no
  optimistic-locking on the store (version hash guards pages only), no
  zip/github publish over MCP, `create_collection` if deferred.

## Invariants checklist (verify before calling any phase done)

1. `code` is the source of truth for structure; every structural write goes
   through `reconcile`. `elements` is never rebuilt from scratch and never
   string-patched independently of code.
2. Node-only state (`classes`, `interactions`, `content`, `locales`,
   `conditions`) is mutated on the node object in the blob, never encoded into
   the DSL text.
3. Empty locale/entry overrides are pruned (byte-identical untouched nodes).
4. Draft creation produces blobs/metadata the existing UI opens flawlessly.
5. The node server gains zero npm dependencies; the MCP SDK lives in
   `packages/guano` only.
6. Contributors cannot create tokens; token role checks are live, not baked in.
7. `npm run type-check` passes; the e2e smoke suite still passes after the
   auth changes (`npm run build` then `npm run test:e2e`).

## Build order and sizing

Phase 0 (runtime bundle) → 1 (tokens) → 2 (skeleton + pages) → 3 (styles +
interactions) → 4 (collections/comments/publish) → 5 (docs). Phases 0–2 are
each a focused session; 3 is the subtle one (read `useElement`,
`useInteraction`, and the marker-sync section of CLAUDE.md before writing any
code); 4 is mechanical; 5 is an hour. Commit per phase; each phase leaves the
repo shippable.
