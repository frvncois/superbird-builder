# REPORT.md — Autonomous cleanup & review (REVIEW.md)

Run date: 2026-08-29 (audit) · Landed to `main`: 2026-08-30 · Baseline: `456566b`.

**Status: all five passes complete and MERGED to `main`; the follow-up fixes below are landed too.** The four review branches have been merged in order and deleted. From this point `main` is the single line of history. A Playwright smoke (`npm run test:e2e`) now runs alongside the build as the gate.

---

## 0. Landed to `main` in the 2026-08-30 session

Owner manually verified the app (clicked through `/admin`, `/admin/content`, a published route) and confirmed the `docs/` deletion was intentional. Then, one commit per step, each gated by `rm -rf dist && npm run build` + `npm run test:e2e`:

| Commit | What |
|---|---|
| `61d7acd` | Remove obsolete `docs/*.md`; repoint CLAUDE.md's stale ref to SECURITY.md |
| `7baac10 87be46c b23106b 806e7a3` | Merge the 5-pass stack (dead-code → boundaries → security → perf) |
| `3ae51ad` | **Playwright smoke** — setup→edit→publish→assert published text→auth-guard; `SB_DATA_DIR` for isolated runs |
| `c8efe7d` | **S1** — contributor project-store writes 403 on customCode/smtp change or no-baseline (fail-closed) |
| `4d30442` | **S3** — session tokens stored as sha256 at rest |
| `629063d` | **S4** — raw invite token no longer stored; regenerate re-issues |
| `237b560` | **F10/Q4** — canonical `slugify` for new page slugs |
| `d4f5e54` | **P1/Q5** — ConfirmModal on collection + entry delete |
| `7c14496` | **F11/Q6** — `timeAgoShort` moved into `lib/time` |
| `52c92c2` | **F13/Q7** — `formatBytes` for the published-size readout |
| `e1145b3` | **S7** — scheme-gate `src`/`background`/`swapSrc` (exporter + render core) |
| `d417691` | **S12** — timing-safe `PUBLISH_TOKEN` compare |

Each security fix was verified against an isolated server (real invite→accept flow where relevant); tables are in the individual commit messages. The audit-run history (below) is unchanged for reference.

---

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

## 3. Branches (all merged, deleted)

The four review branches (`chore/dead-code-and-dedup`, `chore/architecture-boundaries`, `audit/security`, `perf/measured-only`) were merged into `main` in order (`--no-ff`, build green after each) and deleted. Nothing is outstanding on a branch. The largest change to eyeball in history is the renderer-core dedup (`e27acc4`); the module splits (`7e1fac1`, `ae43f44`) are mechanical and the export split was verified byte-identical.

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

## 5. Remaining — explicitly out of scope for the 2026-08-30 session

Landed this session: S1, S3, S4, S7, S12; F10, F11, F13, P1; the Playwright smoke. **Still open** (deliberately not touched — the owner scoped these out):

- **Security MED:** S2 CSS-injection via `url()` in background/font-family; S5 no CSP on export/admin SPA; S6 exported-SVG re-sanitize / CSP.
- **Security LOW:** S8 rate-limit keying (X-Forwarded-For); S9 account-lockout DoS; S10 publish-snapshot schema validation; S11 per-user store quota; S13 member-email exposure to contributors; S14 email change without re-auth.
- **Oversized:** `CodeEditor.vue` split (QUESTIONS item 13 — staged plan recorded; now unblocked since the smoke exists).
- **Deferred cleanups (QUESTIONS 8–11):** F22 `readBody` unification; `components/site/` foldering move; `Role` type relocation; F24 style-control shape.
- **Audit LOW (AUDIT.md):** 13 unnecessary `export` keywords; F12/F14–F27 minor duplications; P2–P6 pattern nits.

Note: with the Playwright smoke now in place, the two biggest remaining items (CodeEditor split, and the MED security hardening) are materially safer to take on next.

## 6. Verification status

- **Gate is now build + e2e:** every commit this session passed `rm -rf dist && npm run build` (vue-tsc + vite) **and** `npm run test:e2e` (Playwright smoke). `main` tip is green on both.
- Security fixes additionally verified against an isolated server (`SB_DATA_DIR`) driving the real invite→accept flow; per-fix result tables live in the commit messages.
- **Every audit branch built green** at each commit during the original run (below, historical).
- **Server:** `node --check` on all server files; live smoke on a scratch port (auth/me 401, store 401 via `fail()`, published 200).
- **Export:** sha256 of every exported file byte-identical before/after the `export.mjs` split (16 files, 10 routes).
- **slugify dedup:** property-tested equivalent across 12 inputs before swapping.
- **Not verified (no environment):** browser runtime behavior — canvas/editor interaction, drag, inline edit, the published site in a real browser. The build typechecks templates, but a human should click through `/admin`, `/admin/content`, and a published route before merging the dedup branch, since the renderer-core change is the highest-traffic surface touched.
