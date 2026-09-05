# PERF.md — Performance audit (Pass 5 of REVIEW.md)

Branch: `perf/measured-only` (stacked on `audit/security`). Rule zero honored: **no optimization without a measurement showing a problem.** Phase B thresholds: 100 ms interaction latency, 20% publish-time regression, 50 kb published output. **Nothing measured crossed a threshold → no code changes in Phase B.**

## Phase A — measurements

### 1. Editor interaction latency — NOT MEASURED (no browser/profiler in this environment)
Per REVIEW.md ("If the environment cannot run a browser/profiler … skip that measurement, note it, and do not guess"), the following were **not** measured and no changes were made against them: initial load, canvas time-to-interactive, drag latency, style-panel input→canvas latency, re-render storms, per-keystroke watchers, deep-reactive-vs-shallowRef. To measure later: Chrome DevTools Performance on `/admin` with a ~200-node page (the demo is 208 nodes — see below), recording a drag and a style-panel keystroke. Note for that session: `useThemeTokens` recompiles Tailwind on a 200 ms debounce per token change (documented in CLAUDE.md) — the first thing to profile if the style panel feels laggy.

### 2. Publish / export time — MEASURED, healthy (linear, no O(n²))
`server/export.mjs` on the demo project and synthesized larger trees (demo body children cloned with fresh ids), warm run (excludes one-time Tailwind compile warmup):

| Nodes | Export time |
|---|---|
| 208 (demo) | 17 ms |
| 2,218 | 27 ms |
| 8,248 | 51 ms |
| 16,288 | 75 ms |

78× the nodes → 4.4× the time: **sub-linear** (a fixed Tailwind-compile cost dominates small projects; the per-node render/serialize work is linear). No O(n²) over the tree. Well under any reasonable budget. **No fix warranted.**

### 3. Published output size — MEASURED, tiny (far under 50 kb)
From the demo export (byte-identical to the Pass-3 baseline):

| File | Size |
|---|---|
| `assets/script.js` (interaction runtime) | 4.5 kb |
| `assets/style.css` (compiled Tailwind, minified) | 26 kb |
| `index.html` (208-node home page) | 39 kb |
| `404.html` | 0.7 kb |

`assets/script.js` ships only when a page uses interactions or runtime conditions (`export.mjs:495-499`); pages without them get zero JS. Nothing approaches the 50 kb-per-file threshold. **No editor code in the output** (verified in Pass 3). **No fix warranted.**

### 4. Admin SPA bundle — MEASURED, already well-split
Heaviest chunks (raw / gzip):

| Chunk | Raw | Gzip | Loaded |
|---|---|---|---|
| `index.global` = `@tailwindcss/browser` compiler | 279 kb | 71 kb | **lazy** — `void import('@tailwindcss/browser')` in CanvasEditor / ContentView / SiteView |
| `BuildView` (the editor) | 173 kb | 52 kb | **lazy** — router dynamic import, `/admin` only |
| `useEditorBoot` | 99 kb | 30 kb | lazy (admin boot) |
| `useThemeTokens` | 83 kb | 28 kb | lazy (pulls the browser compiler) |
| `runtime-core` (Vue) | 64 kb | — | entry |
| `index` (app entry) | 43 kb | — | entry |
| `ContentView` / `SiteView` / auth views | 1–9 kb each | — | lazy per route |

The two heavy modules — the Tailwind browser compiler and the editor view — are **already** dynamically imported and route-split; the public `SiteView` chunk is 5 kb and doesn't pull editor code. The lazy-load candidates REVIEW.md names (timeline/grid editor) don't exist as separate heavy modules here. **No obvious lazy-load win remains; no fix warranted.**

## Phase B — fixes

None. Every measurable dimension is within budget, and rule zero forbids optimizing what isn't shown to be a problem. The only unmeasured dimension (editor interaction latency) requires a browser this environment lacks; guessing at it is explicitly disallowed. Recorded above for a human profiling session.
