# Codebase Cleanup Pass

The app is feature-complete (~99% done). Do a codebase-wide cleanup pass. This is a
quality pass, NOT a refactor — behavior must be byte-identical after every change.

## What to hunt for, in priority order

1. **Dead code**: unused exports, unused functions/composables, unreachable branches,
   commented-out blocks, leftover feature flags, files no longer imported anywhere.
   The git status shows deleted files (AccountModal.vue, AppHeader.vue, InviteDialog.vue,
   users/InviteDialog.vue) — hunt for stale imports/references to those and to anything
   else recently removed. Also check for CSS classes/tokens in main.css nothing uses.
2. **Dead imports**: unused import statements, imports of types that vue-tsc no longer
   needs, lucide icons imported but not rendered.
3. **Duplicated code**: same logic written twice in different files. Prime suspects:
   - the two renderers sharing useRenderNode (ElementRenderer.vue vs PreviewRenderer.vue)
     — anything duplicated between them belongs in useRenderNode
   - repeated fetch/error-handling boilerplate across composables (useAuth, useUsers,
     useBranches all talk to /api — look for a shared request helper opportunity)
   - repeated modal/popover/panel wiring that the ui/ primitives or hosts should own
   - server/*.mjs helpers reimplemented in more than one file (util.mjs is the home)
   - MCP tools.mjs vs server routes duplicating validation/sanitization
4. **Over-engineering**: abstractions with exactly one caller, config/options params
   nothing passes, generic helpers used for one concrete case, wrapper components that
   just forward props. Inline them.
5. **Inconsistency**: same pattern done three ways (e.g. how components read/write
   store keys, how errors are surfaced, prop naming). Converge on the dominant pattern.
6. **Stale docs & scratch files at the repo root**:
   - Delete all `.tmp-*` files (`.tmp-fixes-*.mjs`, `.tmp-probe*.mjs`, `.tmp-motion-test.ts`,
     `.tmp-vite.config.ts`) — they are throwaway test scripts from past sessions.
   - Delete finished/superseded docs: `FINDINGS.md`, `LAUNCH.md`, `RENAME.md`,
     `STRESS-TEST-3.md`, `PLAN-MCP-FIXES.md`, and this file (`CLEANUP-PROMPT.md`)
     as your final commit.
   - For the remaining `PLAN-*.md` files (`PLAN-MCP.md`, `PLAN-PARITY.md`,
     `PLAN-SECURITY.md`, `PLAN-MCP-SECURITY.md`, `PLAN-CONTRIB-AUTHZ.md`): read each
     one first. Delete it only if every item is done or already tracked in BACKLOG.md;
     if it still contains undone, untracked work, move those items into BACKLOG.md,
     then delete it.
   - **Keep**: `README.md`, `CLAUDE.md`, `BACKLOG.md` (deferred security items live there).
   - CLAUDE.md references some of these files by name (BACKLOG.md, PLAN-CONTRIB-AUTHZ.md,
     PLAN-MCP-SECURITY.md, PLAN-MCP.md) — update those references when you delete a file.
   - `test-results/` should be gitignored, not committed; add it to .gitignore if missing.

## Hard constraints — do NOT touch these behaviors

- **The reconcile invariant**: code is the source of truth for structure. Never
  simplify anything in src/lib/syntax.ts, useElement, or document.ts in a way that
  changes parsing, node-identity adoption, marker handling, or the lexer's tolerance
  of incomplete tokens. If a simplification there looks safe, flag it in the report
  instead of applying it.
- **The client/exporter mirror**: useRenderNode.ts and server/export.mjs intentionally
  implement the same logic twice (Vue vs pure JS). That is NOT duplication to
  deduplicate — only extract into src/lib/shared/ if BOTH sides can import it verbatim,
  and only if the shared file stays DOM-free.
- **src/lib/shared/motion.js and interactionClasses.js** are imported verbatim by
  editor, exporter, MCP, and the published runtime. Any change there must keep all
  four consumers working; server/motion-runtime.js is a committed build artifact —
  never edit it by hand (rebuild via npm run build:motion if runtime.ts changes).
- **Composable singletons**: module-level refs outside the exported function are the
  store pattern, not an accident. Don't "fix" them into local state.
- **Server security paths**: contributor-merge.mjs, agent-policy.mjs, auth.mjs,
  the SAFE_SRC/sanitizeRich sanitizers, and the store-key underscore ban are
  security-load-bearing. Read-only for this pass; report findings, don't apply.
- Don't rename public APIs, store keys, DSL tokens, or route paths.
- Don't add dependencies. Don't add an abstraction to remove a duplication unless
  the duplication is 3+ sites or clearly bug-prone.

## Method

- Work in small, reviewable commits grouped by category (one commit per cleanup type
  or per subsystem), on the current branch. Note: the working tree already has
  uncommitted changes — commit those first as a checkpoint (ask nothing, message
  "checkpoint before cleanup"), so cleanup commits are cleanly separable.
- After EVERY batch of changes run `npm run type-check`. It must stay clean — it is
  the only static gate (no linter, no test runner).
- For anything in src/lib/* or composables where you're unsure a simplification is
  behavior-preserving, write a throwaway .tmp-test.ts at repo root exercising
  before/after and run it with:
  `npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts`
- To find dead exports, don't trust grep alone for Vue SFCs — check template usage,
  dynamic component usage (component :is), and the MCP runtime bundle entry
  (src/lib/mcp-runtime.ts re-exports things that look unused from the app's side).
  Same caution for server/export.mjs consumers of src/lib/shared/.
- e2e/interactions.spec.ts exists — if a Playwright setup is runnable, use it as a
  smoke check at the end; if not, skip it, don't build one.

## Deliverable

Finish with a summary report: what was removed/merged (with rough line counts),
what you found but deliberately did NOT touch (with reasons — especially anything
in the hard-constraint zones), and any genuine design concerns worth a human
decision. Ranked by impact.
