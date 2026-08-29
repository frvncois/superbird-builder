# BOUNDARIES.md — Architecture boundary map (Pass 3 of REVIEW.md)

Source of truth: CLAUDE.md (MASTER.md does not exist — QUESTIONS.md item 1). Baseline: branch `chore/architecture-boundaries` stacked on `chore/dead-code-and-dedup`.

## Phase A — the map

This repo's equivalents of REVIEW.md's boundaries: the "compile pipeline" is `server/export.mjs` + `server/site-runtime.js` (pure-JS static exporter, no Vue); "schemas/engine" is `src/lib/` (pure logic) and `src/lib/shared/` (plain-JS registries used by BOTH client and server); "editor UI" is `src/components/` + `src/composables/`.

### Boundary 1 — exporter must depend only on shared registries (HIGHEST priority)
**Status: HOLDS. No fix needed.** Every `server/*` → `src/*` edge lands in `src/lib/shared/`:

| Offending file | Imports | Boundary |
|---|---|---|
| `server/export.mjs:14–19` | `src/lib/shared/{elements,tokens,fields,conditions,richtext,background}.js` | sanctioned bridge ✓ |
| `server/site-runtime.js` | nothing from src (self-contained ~1.5 KB runtime) | ✓ |
| `server/{index,auth,media}.mjs` | node builtins, `sharp`, `@tailwindcss/node`, sibling server modules only | ✓ |

Published output carries zero editor code (verified by import-graph walk in Pass 1; re-verified above after Pass 2's `server/util.mjs` addition — util.mjs imports node builtins only).

### Boundary 2 — engine/schema (src/lib) must not import Vue/UI
**Status: HOLDS with three LOW notes (left untouched, human triage):**
- `src/lib/store.ts:1` — runtime `import { ref } from 'vue'`. Documented-intentional reactive cache (CLAUDE.md); the only runtime-Vue lib file.
- `src/lib/roles.ts:1` — **type-only** import of `Role` from a composable (backwards direction; recommend moving `Role` to `src/types/` — QUESTIONS.md item 10).
- `src/lib/{styles,docs,elementIcons,elementPalette}.ts` — `import type { Component } from 'vue'` for icon registry typing; type-only, erased at build.
- `src/lib/shared/`: fully clean (no vue, no `@/`, shared→shared only).

### Boundary 3 — site zone must not drag editor code into the public bundle
**Status: HOLDS.** `SiteView` → `PublicRenderer` → render-core composables only (`useRenderNode`, `useLocale`, `useCollections`, `useInteraction`, `useComponents`, `useMedia`, `useRuntimeEnv`) — no `useElement`/`usePanel`/`useComments`/media-library. Foldering nuance (LOW, QUESTIONS.md item 9): `components/site/ContentRenderer.vue` + `CommentLayer.vue` are admin-only but live under `site/`; they never enter the public chunk.

### Boundary 4 — types must stay runtime-free
**Status: HOLDS.** `src/types/` has type-only imports.

## Phase B — fixes performed

Priorities 1 and 2 need no code change (boundaries hold). Oversized modules (AUDIT §5 HIGH/MED):

| Module | Action |
|---|---|
| `src/lib/styles.ts` (1063) — MED | **DONE**: split the `STYLE_SECTIONS` data catalog into `src/lib/styleCatalog.ts`; `styles.ts` keeps the logic (relevance, suggest/validate, applyClass). Importers updated, no re-export shim. |
| `server/export.mjs` (746→614) — MED | **DONE**: media extraction (`extractMedia` + MIME map + library resolution) moved to `server/export-media.mjs`; `walkNodes` moved to `server/util.mjs` so both halves share it without a module cycle. The render mirror stays intact in export.mjs per CLAUDE.md's keep-in-sync mandate. Verified: sha256 of every exported file from the demo project is byte-identical before/after. |
| `src/components/editor/code/CodeEditor.vue` (1801) — HIGH | **DEFERRED to QUESTIONS.md item 13.** 126 top-level bindings; the folding display↔real line mapping (`d2r`/`r2d`) is referenced 29× across caret sync, Enter handling, drag-reorder and validation-jump — every subsystem shares it plus the single textarea ref. Extraction without an e2e suite risks regressing typing/undo/reorder. A concrete split plan is in QUESTIONS.md. |
| `server/index.mjs` (514) — MED (UNSURE) | Left: typical HTTP entrypoint; the audit itself marked the split value UNSURE. |

## After state

- Boundary violations fixed: 0 needed (0 existed).
- Oversized HIGH/MED addressed: styles.ts (split), export.mjs (split), CodeEditor (deferred with plan), index.mjs (documented no-action).
