# REVIEW.md — Autonomous cleanup & review playbook

You are running unattended for several hours. Work through the passes below **in order**, autonomously, without waiting for human input. The owner will review everything when they return.

## Global rules (apply to every pass)

- Read `CLAUDE.md` and `MASTER.md` first. `MASTER.md` is the source of truth for intended architecture.
- One git branch per pass (names given below). One commit per item or tightly related group. Commit messages reference the audit item they resolve.
- **No behavior changes.** No renames beyond what a move requires. No formatting-only diffs. No new abstraction layers, wrappers, barrel files, or "future-proof" generic helpers. Centralizing existing duplicated code: yes. Inventing new patterns: no.
- After each commit: **full rebuild with fresh dist** (this repo has had stale-bundle bugs — never trust an old build) + run the full e2e suite. If anything fails, fix or revert before moving on. Never leave a branch red.
- If a change is risky, ambiguous, or would require changing a public API, schema shape, or emitted output: **do not do it.** Log it in `QUESTIONS.md` with file paths and your recommended approach, and move on.
- If context runs long mid-pass, finish the current item cleanly, commit, and continue in a fresh session by re-reading this file and the pass's output doc. Never leave a half-applied refactor.
- Do not merge any branch. All branches stay open for human review.

---

## Pass 1 — Audit (read-only)

**Branch:** none (no source changes). The only file you may write is `AUDIT.md` at repo root.

Do NOT modify, create, or delete any source files in this pass.

Audit the entire codebase and produce `AUDIT.md` with these sections:

1. **DEAD CODE** — unused exports, unreachable branches, commented-out blocks, unused deps in package.json, orphaned files never imported. Before flagging anything, grep for dynamic imports, template refs, `<component :is>`, and string-based component registration to rule out false positives.
2. **DUPLICATION** — logic repeated in 2+ places that should be centralized (utils, composables, shared components, repeated style-section patterns). Show the duplicated snippets side by side.
3. **SEPARATION VIOLATIONS** — imports that cross architectural boundaries defined in `MASTER.md`. Special attention: compiler/emitter code importing from editor UI, engine/schema code importing Vue components, editor concerns leaking into published output.
4. **INCONSISTENT PATTERNS** — places that don't follow established repo patterns. Known example: unconditional Teleports remaining in header/layout/sidebar components that should use the conditional Teleport pattern with the singleton hosts (OverlayHostUi, ToastHost, TooltipHost, ContextMenuHost). Find all others.
5. **OVERSIZED MODULES** — components or modules doing more than one job, files over ~300 lines that should split.

For every item: exact file path(s), line ranges, one-sentence description, impact rank (HIGH / MED / LOW). End with a count summary per section.

**Autonomous triage rule (owner is away):** in later passes, act only on HIGH and MED items. Leave every LOW item untouched — they stay in `AUDIT.md` for human triage. If an item is HIGH/MED but feels risky, it goes to `QUESTIONS.md`, not into code.

---

## Pass 2 — Dead code + duplication

**Branch:** `chore/dead-code-and-dedup`. Work only from `AUDIT.md` sections 1 and 2, HIGH and MED items.

Setup: install and run `knip` and `depcheck`; cross-reference findings with `AUDIT.md`. Anything the tools flag that isn't in `AUDIT.md` must be manually verified before touching.

Rules:
- Before deleting anything "unused", grep for: dynamic imports, `<component :is>`, template refs, string keys in registries, usage in e2e specs.
- Duplications: centralize into the nearest **existing** shared location (composables/, utils/, shared components). If centralizing would require a new pattern that doesn't exist in the repo, skip it and log in `QUESTIONS.md`.

---

## Pass 3 — Separation / architecture boundaries

**Branch:** `chore/architecture-boundaries`. Work from `AUDIT.md` sections 3 and 5 (HIGH and MED), with `MASTER.md` as the source of truth.

**Phase A — map first:** produce `BOUNDARIES.md` listing every violating import (offending file → what it imports → which boundary it crosses) and the proposed fix (move code, extract shared module, invert dependency). Then proceed to Phase B in the same run.

**Phase B — fix, in this priority order:**
1. Compiler/emitter importing anything from editor UI. The compile pipeline (HtmlEmitter, CssEmitter, ContentIndexer, Artifacts) must depend only on schemas/engine. Published output must carry zero editor code.
2. Engine/schema importing Vue or UI code.
3. Oversized components: split by responsibility, keep the public API identical, one component per commit.

Moving code is preferred over re-exporting shims. If a fix requires changing a public API or schema shape: `QUESTIONS.md`, not code.

Finish by updating `BOUNDARIES.md` with before/after state.

---

## Pass 4 — Security

**Branch:** `audit/security`. Threat model: a visual builder that compiles user-authored JSON trees into published HTML; admin SPA at `/admin`, public published site at root; single-tenant, self-hosted by non-technical designers.

**Phase A — produce `SECURITY.md` covering:**

1. **XSS in the compile pipeline (highest priority).** Trace every path where user-authored content reaches emitted HTML: text nodes, rich text fields, attribute values, class names, custom attributes, embed/code blocks, image alts, link hrefs. For each: is it escaped/sanitized at emit time? Flag every raw interpolation. `javascript:` URLs in hrefs count.
2. **Admin surface** — auth on `/admin` and every API/command-bus endpoint: session handling, CSRF on mutations, rate limiting on login, password storage. Can any command-bus or publish endpoint be hit unauthenticated?
3. **Seed/import** — the `.sbbackup` import path: what can a malicious seed file inject? Schema validation on import? Path traversal in file references? Zip-slip if archived?
4. **Runtime** — form submissions on published sites: injection, size limits, content-type validation, anything user-submitted that gets rendered back.
5. **Headers & config** — CSP on published output and admin, cookie flags, CORS, anything sensitive leaking into compiled artifacts or the client bundle.

Rank findings CRITICAL / HIGH / MED / LOW with exact file paths and a proposed fix each.

**Phase B — fix CRITICAL and HIGH only**, one per commit. No framework swaps. New dependencies only if strictly necessary; a well-known sanitizer lib is acceptable **only if it does not change emitted output for already-safe content** — otherwise `QUESTIONS.md`. MED/LOW stay in `SECURITY.md` for human triage.

---

## Pass 5 — Performance (measured only)

**Branch:** `perf/measured-only`. Rule zero: **no optimization without a measurement showing a problem.** If you cannot measure it, do not touch it.

**Phase A — measure, produce `PERF.md`:**
1. Editor: profile a realistic session (large tree, ~200 nodes). Measure initial load, canvas time-to-interactive, drag latency, style-panel input → canvas update latency. Flag re-render storms, watchers firing per keystroke, deep-reactive objects that should be shallowRef, structured-clone hotspots.
2. Compile: time a full publish on the same tree. Flag anything O(n²) over the node tree.
3. Published output: Lighthouse on a compiled page. Bundle audit of the published artifact — should be near-zero JS unless a feature requires it (GSAP timelines). Flag any editor code in the output.
4. Bundle: analyze the admin SPA bundle, list the top 10 heaviest modules, flag lazy-load candidates (timeline editor, grid editor).

**Phase B — fix only items above these thresholds:** 100ms interaction latency, 20% publish time, 50kb published output. One fix per commit, re-measure after each, record before/after numbers in `PERF.md`. If a fix adds complexity below those thresholds, revert it.

If the environment cannot run a browser/profiler for a given measurement, skip that measurement, note it in `PERF.md`, and do not guess.

---

## Final step — REPORT.md (mandatory)

When all passes are done (or context/time forces a stop), write `REPORT.md` at repo root:

1. **Summary** — one paragraph per pass: what was done, branch name, commit count.
2. **By the numbers** — files deleted, LOC removed, duplications centralized, boundary violations fixed, security findings by severity (fixed vs pending), perf before/after where measured.
3. **Branches awaiting review** — each branch with a one-line merge recommendation and any caveats.
4. **QUESTIONS.md digest** — every deferred decision, with your recommendation for each.
5. **Skipped / remaining** — all LOW items, all MED/LOW security findings, anything unfinished, in priority order.
6. **Verification status** — build + e2e state of every branch at the moment of the report.

Write it so the owner can triage everything in 15 minutes. No fluff.