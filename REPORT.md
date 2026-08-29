# REPORT.md — Autonomous cleanup & review (REVIEW.md)

Run date: 2026-08-29 · Baseline: `main` @ `456566b` · Model ran unattended through all 5 passes.

**Read this first:** the four working branches are **stacked, not independent** — each was created on top of the previous (`main` → `chore/dead-code-and-dedup` → `chore/architecture-boundaries` → `audit/security` → `perf/measured-only`). Review/merge them in that order, or cherry-pick. Nothing is merged. All output docs (AUDIT, QUESTIONS, BOUNDARIES, SECURITY, PERF, this file) live on the branch of the pass that produced them; the perf tip contains the whole stack.

## 1. Summary per pass

- **Pass 1 — Audit (branch: `chore/dead-code-and-dedup`, shared with pass 2; 1 doc commit).** Three parallel read-only auditors → `AUDIT.md`. Headline: the codebase is clean — **0 orphaned files, 0 unused dependencies, 0 true architecture-boundary violations.** The real surface is duplication (7 HIGH) and a handful of dead exports. knip/depcheck cross-checked; all their extra flags were verified false-positives or LOW.
- **Pass 2 — Dead code + dedup (`chore/dead-code-and-dedup`, 8 code/doc commits).** Removed 3 dead exports; centralized deep-clone (11 sites → `lib/tree.ts deepClone`), server helpers (`send`/`fail`/`writeAtomic` → `server/util.mjs`), `slugify` (docs.ts), dropdown logic (MenuUI + CodeEditor → `useDropdown`), and the big one — the three renderers' duplicated content/src/rich/alt/link/class core into `useRenderNode` (~230 net lines gone). Also fixed a repo hazard: a raw NUL byte in `useComponents.ts` that hid a real usage from grep.
- **Pass 3 — Boundaries (`chore/architecture-boundaries`, 3 commits).** `BOUNDARIES.md` maps all four boundaries as **holding**. No violations to fix. Split two oversized modules: `styles.ts` (catalog → `styleCatalog.ts`) and `export.mjs` (media extraction → `export-media.mjs`) — the latter verified byte-identical export output. `CodeEditor.vue` (1801 lines) deferred with a concrete staged split plan (QUESTIONS.md item 13).
- **Pass 4 — Security (`audit/security`, 1 doc commit).** Two parallel auditors → `SECURITY.md`. Pipeline is well-defended: no accidental XSS, all mutating endpoints role-gated, global CSRF check, strong upload validation. **One HIGH (S1): a contributor can write the project store incl. `customCode` → stored XSS on publish.** Its fix is behavior-shaping and partially documented-intentional → escalated to QUESTIONS.md item 14 with a concrete patch (global rule 11), not applied autonomously. Resolved both UNSURE items (settings redaction complete; no server secret in the client bundle).
- **Pass 5 — Performance (`perf/measured-only`, 1 doc commit).** `PERF.md`. Export scales sub-linearly (no O(n²)); published output tiny (all files < 50 kb); admin bundle already route-split with the two heavy modules lazy-imported. Editor interaction latency not measurable without a browser and not guessed at (rule zero). **No fix warranted.**

## 2. By the numbers

- **Files deleted:** 1 (`BoxTierControl.vue`, dead, was untracked). **Files created:** 3 (`server/util.mjs`, `server/export-media.mjs`, `src/lib/styleCatalog.ts`).
- **Net source LOC:** −100 (1110 added / 1210 removed) across 25 src/server files — despite adding 3 modules, because dedup removed more than the splits added.
- **Dead exports removed:** 3 (`gapScheme`, `defaultClass`, `roleBlurb`). 1 audit finding (`normalizeComponentName`) was a **false positive** — kept.
- **Duplications centralized:** 6 HIGH/MED groups (deepClone, server send/fail/writeAtomic, slugify, renderer content/src/rich/alt/link/class core, useDropdown ×2 sites).
- **Boundary violations fixed:** 0 (0 existed). **Oversized modules split:** 2 of 4 HIGH/MED (styles.ts, export.mjs); 1 deferred with plan (CodeEditor); 1 no-action (index.mjs, audit-UNSURE).
- **Security findings:** 1 HIGH (deferred to owner, patch written), 6 MED, 8 LOW — 0 fixed autonomously (Phase B scope = CRITICAL/HIGH; the one HIGH is documented-intentional-adjacent and needs e2e).
- **Perf:** export 17 ms @208 nodes → 75 ms @16k (sub-linear); site.js 4.5 kb; 0 fixes.

## 3. Branches awaiting review

| Branch | Commits | Merge recommendation |
|---|---|---|
| `chore/dead-code-and-dedup` | 9 | **Safe to merge first.** Pure dead-code removal + dedup, all behavior-preserving, build green. Review the renderer-core commit (`e27acc4`) most closely — largest change; equivalence notes are in its message. |
| `chore/architecture-boundaries` | 3 | **Safe.** Two mechanical module splits (no logic change); export split verified byte-identical. Merge after dead-code branch. |
| `audit/security` | 1 | **Docs only** (SECURITY.md + QUESTIONS.md). Merge freely; then action QUESTIONS.md item 14. |
| `perf/measured-only` | 1 | **Docs only** (PERF.md). Merge freely. |

Caveat: branches are stacked, so a straight merge of the tip brings all four. To take them piecemeal, merge in order.

## 4. QUESTIONS.md digest (deferred decisions, with recommendations)

1. **No MASTER.md** — used CLAUDE.md as architecture truth. *Write MASTER.md or repoint REVIEW.md.*
2. **No e2e suite** — used `rm -rf dist && npm run build` as the gate after every commit. *Add a Playwright smoke (login→edit→publish→view); it would de-risk items 5, 13, 14.*
3. **REVIEW.md names host components that don't exist here** (OverlayHostUi etc.). *Tailor REVIEW.md to this repo.*
4. **`usePage.ts:22` weak slug** (punctuation leaks into URLs). *Switch to `slugify` — it's a bug; changes new-page slugs only.*
5. **Collection/entry delete has no ConfirmModal** (most destructive click in the app). *Add ConfirmModal for `removeCollection`.*
6–8. **timeAgo / formatBytes / readBody** unify-but-changes-output items. *Unify keeping the current strings / limits.*
9–11. **Foldering (site/ admin-only files), `Role` type location, F24 style-control shape** — minor, recommendations inline.
13. **CodeEditor.vue split** — staged plan (folding → reorder → status/validation child), do once an e2e smoke exists.
14. **SECURITY S1 (HIGH)** — contributor→customCode stored XSS. *Recommended patch: reject contributor store writes that change `customCode`/`smtp`; verify contributor autosave still round-trips.*

Plus an observation (item 12): the five `docs/*.md` files are **deleted in the working tree** — not by any command in this run and not committed. CLAUDE.md still references `docs/security-structural-enforcement.md`. Restore with `git checkout -- docs/` or commit the deletion and update CLAUDE.md.

## 5. Skipped / remaining (priority order)

- **HIGH:** SECURITY S1 (item 14 above) — the one item the owner must decide.
- **Security MED (triage in SECURITY.md):** S2 CSS-injection via `url()`; S3 hash session tokens at rest (easy, safe — good first fix); S4 invite raw token at rest; S5 no CSP on export/admin; S6 exported-SVG CSP.
- **Security LOW:** S7 `src` scheme allowlist (harmless today, CRITICAL if an iframe/embed element is ever added — do it pre-emptively); S8–S14 (rate-limit keying, lockout DoS, snapshot validation, store quota, timing-safe token, member-email exposure, email re-auth).
- **Oversized:** CodeEditor.vue split (item 13).
- **Audit LOW (all in AUDIT.md):** 13 unnecessary `export` keywords; F12–F27 minor duplications; P2–P6 pattern nits. None touched (autonomous triage = HIGH/MED only).

## 6. Verification status

- **Every branch built green** at each commit: `rm -rf dist && npm run build` (vue-tsc typecheck + vite) — the repo's only static gate (no test runner exists). Confirmed again on the `perf/measured-only` tip: ✓ built.
- **Server:** `node --check` on all server files; live smoke on a scratch port (auth/me 401, store 401 via `fail()`, published 200).
- **Export:** sha256 of every exported file byte-identical before/after the `export.mjs` split (16 files, 10 routes).
- **slugify dedup:** property-tested equivalent across 12 inputs before swapping.
- **Not verified (no environment):** browser runtime behavior — canvas/editor interaction, drag, inline edit, the published site in a real browser. The build typechecks templates, but a human should click through `/admin`, `/admin/content`, and a published route before merging the dedup branch, since the renderer-core change is the highest-traffic surface touched.
