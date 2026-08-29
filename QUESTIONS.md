# QUESTIONS.md — Deferred decisions for the owner

Items the autonomous run deliberately did NOT change (risky / ambiguous / behavior-changing per REVIEW.md global rules). Each has a recommendation.

## Playbook discrepancies

1. **`MASTER.md` does not exist.** REVIEW.md names it the source of truth for architecture. CLAUDE.md was used instead for all boundary decisions. *Recommendation: either write MASTER.md or amend REVIEW.md to point at CLAUDE.md.*
2. **No e2e suite / test runner exists** (CLAUDE.md confirms vue-tsc is the only static gate). "Full rebuild + e2e" was substituted with `rm -rf dist && npm run build` after every commit. *Recommendation: accept, or add a minimal Playwright smoke (login → edit → publish → view site) — that would have materially de-risked passes 2–4.*
3. REVIEW.md §Pass-1.4 names host components (OverlayHostUi, ToastHost, TooltipHost, ContextMenuHost) that don't exist in this repo; the audited equivalents are ModalHost/ConfirmModal/popovers. Likely copied from another project's playbook. *Recommendation: tailor REVIEW.md to this repo.*

## Behavior-changing fixes deferred (AUDIT.md refs)

4. **F10 — `usePage.ts:22` weak slug** (`name.toLowerCase().replace(/\s+/g,'-')`): punctuation survives into page slugs (e.g. `"Hello, World!"` → `hello,-world!`), unlike the canonical `slugify` (`lib/document.ts:36`). Fixing changes slugs of newly created pages (existing pages keep theirs). *Recommendation: switch to `slugify` — it's a bug, and slugs with `,`/`!` produce ugly/fragile URLs. One-line fix.*
5. **P1 — collection & entry deletion have no confirmation** (`AppHeader.vue` dropdown rows; `useCollections.removeCollection` also deletes the template page and all entries). Locale/media/branch deletes in the same UI all use ConfirmModal. Adding a dialog is a behavior change. *Recommendation: add ConfirmModal for `removeCollection` at minimum — it is the most destructive click in the app and is one accidental click away today.*
6. **F11 — `timeAgo` duplicated & drifted**: `lib/time.ts` ("5 minutes ago") vs `BranchesEditor.vue:65–73` ("5m ago", "yesterday"). Unifying changes visible strings. *Recommendation: keep the compact format by moving it into `lib/time.ts` as `timeAgoShort` and deleting the local copy — no visible change, one home.*
7. **F13 — `SettingsPanel.vue:332` hand-rolls `Math.round(bytes/1024) KB`** instead of `formatBytes` (`lib/media.ts:26`). Unifying changes the displayed string for >1 MB sites. *Recommendation: use `formatBytes`; the current display is wrong for large sites anyway.*
8. **F22 — `readBody` (index.mjs) vs `readBodyRaw(req, limit)` (media.mjs)**: unifying means deciding whether store/auth POST bodies should also get a size limit (currently unlimited — see SECURITY.md pass). *Recommendation: unify on the limited version with a generous default; unlimited request bodies on an authed-but-public endpoint are a DoS surface.*

## Structural decisions deferred

9. **A4 foldering nuance** — `components/site/ContentRenderer.vue` and `CommentLayer.vue` are admin-only but live in `site/`. Moving them is a pure rename with ~4 import updates. Left alone because REVIEW.md forbids renames beyond what a move requires and the current placement doesn't leak code into the public bundle. *Recommendation: move both to `components/editor/canvas/` (imported only by CanvasEditor/ContentView) in a later tidy-up.*
10. **A2 — `lib/roles.ts` type-imports `Role` from a composable** (backwards direction, type-only). *Recommendation: move the `Role` type to `src/types/editor.ts`.*
11. **F24 — style-control "replace tokens by prefix"**: the five sites' semantics differ subtly per control scheme (single prefix vs slot families); a shared `replaceByPrefix` would need per-control options — a new generic helper for marginal gain, borderline against the no-new-abstractions rule. Deferred after inspection (see Pass 2 notes in commits). *Recommendation: leave; revisit only if another control is added.*
