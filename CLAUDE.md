# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server with hot reload (the editor at `/admin` REQUIRES `npm run serve` running too — it boots from the `/api` store and auth)
- `npm run serve` — the node server (`server/index.mjs`): auth + editor storage + publish API + serves the built SPA and the exported static site
- `npm run build` — type-check (`vue-tsc`) + production build in parallel
- `npm run type-check` — type-check only (`vue-tsc --build`)
- `npm run preview` — serve the production build

No linter or test runner is configured. To exercise pure `src/lib/*` logic (parser, reconcile, merge, components) or composables headlessly, write a throwaway `.tmp-test.ts` at the repo root and run it with the `@` alias resolved:

```sh
npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts
```

Requires Node `^22.18.0 || >=24.12.0`. Path alias `@` → `src/`.

## What this is

A browser-based visual website builder. A single route (`EditorView`) mounts a three-pane editor: a **code editor** (left), an infinite-canvas **preview** (center), and a **settings sidebar** (right). The user writes pages in a custom indentation-based DSL; the canvas renders them live and lets them style elements, add interactions, leave comments, branch/merge, and build reusable components and CMS collections.

Pinia is installed and `src/stores/counter.ts` exists, but **state does not live in Pinia**. Ignore both — see the state model below. Tailwind v4 (via `@tailwindcss/vite`) with theme tokens in `src/assets/main.css`; `@tailwindcss/browser` is imported in `CanvasEditor` so classes typed at runtime compile on the fly.

## State model: composable singletons

Shared state is module-level `ref`s declared **outside** the exported composable function, so every caller of e.g. `useProject()` sees the same instance — a hand-rolled store. This pattern is the backbone; follow it for new global state.

- `useProject` — owns the single `project` ref (the entire document) and project-level breakpoints. `createProject` (`lib/factories.ts`) seeds it.
- `usePage` — active page selection, page CRUD, breakpoints (project-wide, they map to CSS media queries).
- `useElement` — selection + all structural mutations (add/remove/duplicate/paste/reorder/change-type/set-arg). **Selection defaults to the page body** when nothing is picked.
- `useInteraction`, `useComments`, `useComponents`, `useCollections`, `useBranches`, `useContextMenu`, `usePanel` — one subsystem each.
- `usePersistence` — autosave + undo/redo (see below).

`Project` (`src/types/editor.ts`) is the whole serializable document: `pages`, `components`, `collections`, `breakpoints`, `comments`. Runtime-only state (current selection, camera, which popover is open, fired interactions) lives in composables and is intentionally **not** part of the project or its history.

## The core invariant: code is the source of truth for structure

Each `Page` has `code` (the DSL text) and `elements` (the parsed `ElementNode` tree). **`code` is authoritative for structure**; `elements` is derived. Any structural change (typing, drag-reorder, duplicate, delete, change-type) edits `code` and re-derives the tree.

But re-deriving must NOT recreate nodes, because per-node state that isn't in the code (`classes`, `interactions`, `content`, `htmlId`, `src`) would be lost, selection would detach, and interaction `targetId` cross-references would dangle. So `reconcile(oldCode, newCode, previous, map?)` in `src/lib/syntax.ts` re-parses while **carrying node identity across the edit**:

- It diffs old→new lines (LCS) to map surviving lines, and adopts the existing node object for each mapped line/type instead of minting a new one.
- An in-place edit to an element's own line (which defeats a text diff) is caught by a same-physical-line fallback, guarded so a newly inserted same-type line can't steal an existing node's identity.
- Callers that know exact line movement (drag-reorder, paste, delete) pass an explicit `map` instead of relying on the diff.

**When adding any operation that changes page structure, route it through the code + `reconcile` — never mutate `elements` directly.** `useElement` is the reference for the splice-code-then-reconcile-with-explicit-map pattern.

`node.classes` etc. that live only on the node are safe to mutate directly (Style/Interactions/Content panels do this). `node.arg` (the `(…)` token argument) is code-owned, so change it by patching the code line (`setElementArg`).

## The DSL (`src/lib/syntax.ts`, `src/lib/document.ts`, `src/lib/elements.ts`)

Indentation + one token per line. Leaf: `:h1:`. Block: `:section` … `section:`. Tokens may carry an argument: `:h1(title):`, `:collection-list(post)`, `:body(post)`. Element types live in the `ELEMENTS` registry (`lib/elements.ts`).

- A **page document** is a protected `@setup` block (name/slug/status) then a `:body … body:` wrap; `document.ts` (`buildDocument`/`enforceDocument`/`extractBodyLines`) rebuilds this canonical shape on every edit so the scaffold can't be broken. The code editor normalizes to one-token-per-line as you type (`normalizeSyntax`).
- **Capitalized** tokens (`:Card:`) are **component** instances; lowercase built-ins stay lowercase (`isComponentType` = starts uppercase).
- `parseSyntax` sets `node.arg`; `validateDocument` reports unclosed blocks, unknown components, unknown collections; `suggestCompletion` powers the ghost-text autocomplete (and receives the live component + collection name lists from `CodeEditor`).

The lexer intentionally accepts *incomplete* tokens (e.g. `:collection-list(` mid-typing) as a single token so the one-token-per-line normalizer doesn't split them across lines. Preserve that when touching `lexLine`.

## Rendering (`ElementRenderer.vue`)

Recursively renders the tree to real DOM in the canvas. One component handles: normal elements, component instances (structural master mapping), and collection embeds (`collection-list`/`collection-item` via `EntryScope` provide/inject). Interactions are live (hover/click/appear actually play), styles merge `node.classes` + interaction classes, and component-instance nodes pull their shared style/interaction from the master.

## Subsystems worth knowing before editing them

- **Persistence & history** (`usePersistence`, `lib/storage.ts`): deep-watches `project`, autosaves to `localStorage` (500ms debounce), status = saved/pending/error. Undo/redo are whole-project JSON snapshots (Cmd+Z / Cmd+Shift+Z). `resetTo()` replaces the project with fresh history (used by branch switch/merge). Storage keys are **branch-scoped** (`superbird-project:<branchId>`); `readStoredProject` backfills newer fields onto older saves.
- **Branches** (`useBranches`, `lib/merge.ts`): each branch is a full project copy in its own storage key, plus a base snapshot for 3-way merge. `computeMerge` is a pure per-item (page/component/collection/breakpoints) three-way merge producing conflicts the user resolves; comments are shared across branches.
- **Components** (`useComponents`, `lib/components.ts`): a component's block stays fully editable in the code (`:Card` … `Card:`, tinted green). Inner nodes are real page nodes mapped by structural position to a shared master; Style/Interactions edits redirect to the master (shared across instances), content stays per-instance. A watcher syncs structural edits from one instance back to the master and out to the others (`syncStructure`), guarded to only trust closed blocks and never adopt an empty block over a populated master. Typing `:Card:` auto-expands to the full block (`expandComponentInstances`), with recursion guards.
- **Collections** (`useCollections`): CMS content types. A collection owns fields, a **template page** (marked by `page.collectionId` and `:body(name)`), and entries. `(field)` args bind elements to fields; `:collection-list(name)` repeats its children per entry; `:collection-item(name):` renders one picked entry through the template. Entry values are edited on the template canvas "in entry context" via `EntryScope`.

## UI conventions

Primitives in `src/components/ui/` (`ButtonUI`, `InputUI`, `SelectUI`, `RowUI`, `TooltipUI`, `ColorPickerUI`, `BadgeUI`, …), popovers in `components/popover/`, modals in `components/modal/` (`ModalHost` has `size: sm|default|lg`), accordions in `components/accordion/` (provide/inject open-state). **Reuse these — don't hand-roll inputs/buttons.** Right-sidebar panels (`StyleEditor`, `InteractionsEditor`, `ContentEditor`, `CommentsEditor`, `BranchesEditor`) are driven by `SettingsEditor` + `usePanel`. Semantic color tokens: `text-success` / `text-pending` / `text-danger`. Tree traversal helpers (`walkNodes`, `findNode`) live in `lib/tree.ts`; the shared `createNode` is in `lib/elements.ts`.
