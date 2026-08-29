# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server with hot reload. The admin editor (`/admin`) **requires `npm run serve` running too** — it boots by hydrating the server-backed store and checking auth over `/api`. The dev server proxies `/api` → `http://localhost:4174` (`vite.config.ts`).
- `npm run serve` — the node server (`server/index.mjs`): auth + editor store + publish/export API; also serves the built SPA and the exported static site.
- `npm run build` — type-check (`vue-tsc`) + production build, run in parallel.
- `npm run type-check` — type-check only (`vue-tsc --build`).
- `npm run preview` — serve the production build.

No linter or test runner is configured; `vue-tsc` type-checking is the only static gate. To exercise pure `src/lib/*` logic (parser, reconcile, merge, components) or composables headlessly, write a throwaway `.tmp-test.ts` at the repo root and run it with the `@` alias resolved:

```sh
npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts
```

Stack: Vue `3.5`, vue-router `5`, Vite `8`, TypeScript `6`, Tailwind `4`. Requires Node `^22.18.0 || >=24.12.0`. Path alias `@` → `src/` (`vite.config.ts`). **Pinia is not used** — it isn't a dependency, and there is no `src/stores/`. Ignore any stale reference to it; state lives in composable singletons (below).

## What this is

A browser-based visual website builder. The user writes pages in a custom indentation-based DSL; a live canvas renders them and lets them style elements, add interactions, leave comments, branch/merge, translate into locales, and build reusable components and CMS collections. There are **two admin editing surfaces** over one shared document:

- **Structural editor** — `BuildView` (`/admin`): three panes — a **code editor** (left), an infinite-canvas **preview** with breakpoint frames (center), a **settings sidebar** (right).
- **Content mode** — `ContentView` (`/admin/content`): the site as a single-frame live preview with no code/panels, for in-place text/media edits and comments. **Contributors** are locked to this view.

Tailwind v4 (via `@tailwindcss/vite`), CSS-first with no config file — theme tokens live in `src/assets/main.css`. `@tailwindcss/browser` is dynamically imported in `CanvasEditor` so classes typed at runtime (and the project's design tokens) compile on the fly.

## Routes & zones (`src/router/index.ts`)

Two zones split by path prefix (`zoneOf`): **admin** (`/admin*`) and **site** (the public catch-all `/:pathMatch(.*)*` → `SiteView`, the published site). Crossing a zone boundary forces a full page load (`window.location.assign`) so editor singletons never coexist with the published snapshot.

Admin routes: `/admin` (`editor`), `/admin/content` (`content`), `/admin/login`, `/admin/setup` (first-run), `/admin/invite/:token` (`SetPasswordView`, accept invite). A `beforeEach` guard gates admin on auth (redirecting to `/admin/setup` or `/admin/login`), and sends role `contributor` from `/admin` → `/admin/content`.

## State model: composable singletons

Shared state is module-level `ref`s declared **outside** the exported composable function, so every caller of e.g. `useProject()` sees the same instance — a hand-rolled store. This is the backbone; follow it for new global state. Two flavors: composables that derive from the `project` document, and newer server-hydrated ones (`useAuth`, `useUsers`, `useBranches`) that hold data fetched from the API.

- `useProject` — owns the single `project` ref (the whole document) and project-level ops.
- `usePage` — active page selection, page CRUD, keeps each page's `@setup` in sync with its `code`.
- `useElement` — selection/drag/highlight state + **all structural mutations** (add/remove/duplicate/paste/reorder/change-type/set-arg). Selection defaults to the page body when nothing is picked.
- `useEditorBoot` — admin-zone boot: `await hydrateStore()` then start autosave/sync. **Both** admin views boot through it, so autosave and undo run in content mode too, not just the editor.
- `usePersistence` — autosave + undo/redo + which branch is loaded (see below).
- `useInteraction`, `useComments`, `useComponents`, `useCollections`, `useBranches`, `useLocale`, `useContextMenu`, `usePanel`, `useSettings`, `useThemeTokens` — one subsystem each.

`Project` (`src/types/editor.ts`) is the whole serializable document: `pages`, `components`, `collections`, `interactions` (shared library), `breakpoints`, `comments`, `locales` + `defaultLocale`, and `settings` (`ProjectSettings`: design `tokens`, seo, favicon, domain, smtp, custom code, fonts). Runtime-only state (selection, camera, open popover, fired interactions, **active locale**, active branch id) lives in composables and is intentionally **not** part of the project or its history.

## The core invariant: code is the source of truth for structure

Each `Page` has `code` (the DSL text) and `elements` (the parsed `ElementNode` tree). **`code` is authoritative for structure**; `elements` is derived. Any structural change (typing, drag-reorder, duplicate, delete, change-type) edits `code` and re-derives the tree.

But re-deriving must NOT recreate nodes, because per-node state that isn't in the code (`classes`, `interactions`, `content`, `src`, `htmlId`, `locales`) would be lost, selection would detach, and interaction `targetId` cross-references would dangle. So `reconcile(oldCode, newCode, previous, map?)` in `src/lib/syntax.ts` re-parses while **carrying node identity across the edit**:

- It diffs old→new lines (LCS) to map surviving lines, and adopts the existing node object for each mapped line/type instead of minting a new one (`parseSyntax` takes an `adopt` callback for this).
- An in-place edit to an element's own line (which defeats a text diff) is caught by a same-physical-line fallback, guarded so a newly inserted same-type line can't steal an existing node's identity.
- Callers that know exact line movement (drag-reorder, paste, delete) pass an explicit `map` instead of relying on the diff.

**When adding any operation that changes page structure, route it through the code + `reconcile` — never mutate `elements` directly.** `useElement` is the reference for the splice-code-then-reconcile-with-explicit-map pattern.

`node.classes`, `node.content`, `node.locales` etc. that live only on the node are safe to mutate directly (Style/Interactions/Content panels do this). `node.arg` (the `[…]` token argument) is code-owned, so change it by patching the code line (`setElementArg`).

## The DSL (`src/lib/syntax.ts`, `src/lib/document.ts`, `src/lib/elements.ts`)

Indentation + one token per line. Leaf: `:h1:`. Block: `:section` … `section:`. Tokens may carry an argument in square brackets: `:h1[title]:`, `:collection-list[post]`, `:body[post]`. Element types live in the `ELEMENTS` registry (`lib/elements.ts`).

A `(+)` after the arg slot (`:h1(+):`, `:h1[title](+):`) is the **styled marker**, and a `{+}` after it (`:h1(+){+}:`) is the **interactions marker** — display-only, derived state meaning the element has classes / interactions. Neither ever reaches `node.arg`. `syncNodeMarkers` (`useElement`, driven by a markers-signature watcher in `CodeEditor`) keeps both in step with `node.classes` / `node.interactions` — deleting a `+` by hand does **not** clear anything (it's re-added), and component-instance subtrees are skipped (styles/interactions live on the master). Typing a bare `(` / `{` on an element token opens the Style / Interactions panel; closing the panel (Escape) finalizes it to `(+)` / `{+}` or removes it. Resting the caret inside an existing `[…]` / `(…)` / `{…}` span (~350ms dwell, so arrowing through doesn't fire) reopens that panel — the keyboard-only way back into a panel for an already-decorated token. The lexer accepts the mid-typing forms `(`, `(+`, `()`, `{`, `{+`, `{}` as part of the token. Similarly, typing a bare `[` after the token name opens the Data panel; closing it finalizes the arg (typed arg → closed `[arg]`, empty `[` → removed). LEAF/OPEN tolerate an unclosed `[` (`:h1[:`, `:h1[po:`) so the node keeps its identity mid-typing.

- A **page document** is a protected `@setup` block (name/slug/status/`locale:`) then a `:body … body:` wrap; `document.ts` (`buildDocument`/`extractBodyLines`/`extractSetup`) rebuilds this canonical shape on every edit so the scaffold can't be broken. `body:` is always the last line. The code editor normalizes to one-token-per-line as you type.
- **Capitalized** tokens (`:Card:`) are **component** instances. Resolution is now backed by the component registry (`isComponentType` from `lib/components.ts`) alongside `isKnownElement`, not pure name-casing.
- `parseSyntax` sets `node.arg`; `validateDocument` reports unclosed blocks, unknown components, unknown collections; `suggestCompletion` powers ghost-text autocomplete (fed the live component + collection name lists from `CodeEditor`).

The lexer intentionally accepts *incomplete* tokens (e.g. `:collection-list[` mid-typing) as a single token so the one-token-per-line normalizer doesn't split them across lines. Preserve that when touching `lexLine`.

## Rendering (`useRenderNode.ts` + renderers)

`useRenderNode.ts` is the **shared rendering core** used by three renderers: the editor's `ElementRenderer.vue` (`components/editor/canvas/`), and content mode's `ContentRenderer.vue` + the published site's `PublicRenderer.vue` (both in `components/site/`). It resolves element type → tag, component master mapping, collection/entry scope (`EntryScope` provide/inject), live interaction firing (hover/click/appear via IntersectionObserver), and class composition (`node.classes` + interaction classes). Inside a component instance, style/interactions come from the mapped master while content stays the node's own. Content precedence: bound collection field → node's own content → mapped-master content → element default. `server/export.mjs` reimplements this same logic in plain JS to emit static HTML — keep the two in sync.

## Subsystems worth knowing before editing them

- **Persistence & storage** (`usePersistence`, `lib/store.ts`, `lib/storage.ts`): storage is **server-backed**, not localStorage. `lib/store.ts` is a synchronous in-memory cache fronting the authed `/api/store` key-value endpoints, flushing writes through a per-key latest-wins queue; `hydrateStore()` must be awaited at boot; a 401 anywhere hard-redirects to `/admin/login`. localStorage survives only for the UI theme preference and a one-time legacy migration. Autosave deep-watches `project`, debounced 500ms. Undo/redo are whole-project JSON snapshots in an in-memory history (cap 50, **not persisted** — lost on reload); Cmd+Z / Cmd+Shift+Z. `resetTo()` replaces the project with fresh history (branch switch/merge/demo). Storage keys are **branch-scoped** (`superbird-project:<branchId>`).
- **Branches & merge** (`useBranches`, `lib/merge.ts`): surfaced in the UI as **Drafts** (create draft / apply to site / discard) — internal names keep `branch`. Each branch is a full project copy in its own key, plus a `superbird-base:<id>` snapshot captured at creation for 3-way merge; `mergeIntoMain(..., { keep: true })` preserves the draft and rebases its base onto the merged Main. `computeMerge(base, main, branch)` is a pure per-item merge (pages/components/collections/interactions share one id-keyed helper; breakpoints, the locale pack, and settings each merge as a unit); **every conflict defaults to Main's side** until the user resolves it. Comments are shared across branches and never merged.
- **Components** (`useComponents`, `lib/components.ts`): a component's block stays fully editable in the code (`:Card` … `Card:`). Inner nodes are real page nodes mapped **by structural position** to a shared master; Style/Interactions edits redirect to the master (shared across instances), content stays per-instance. An app-wide watcher syncs structural edits from one instance to the master and out to the others — guarded so only **closed** blocks sync (mid-typing ignored), a component can't contain itself, and an empty block never overwrites a populated master.
- **Collections** (`useCollections`): CMS content types. A collection owns `fields`, `entries`, and a **template page** (a real `project.pages` entry with `collectionId` + `:body[name]`). `[field]` args bind elements to fields; `:collection-list[name]` repeats its children per entry; `:collection-item[name]:` renders one picked entry through the template. Entry values are edited on the template canvas "in entry context" (`activeEntryId` + `EntryScope`).
- **Localization** (`useLocale`): base content lives on the node/entry itself (default locale); non-default locales store **overrides** in `node.locales[code]` / `entry.locales[code]`. Reads are fallback-aware and render untranslated fallbacks dimmed. Empty overrides are pruned so touch-then-clear leaves a node byte-identical (keeps merge signatures stable). `activeLocale` is runtime-only, not on the project.
- **Users / auth** (`useAuth`, `useUsers`, `server/auth.mjs`): roles `admin | editor | contributor`; `canBuild` = admin|editor. scrypt-hashed passwords, HttpOnly session cookie, single-use hashed invite tokens (accepted at `/admin/invite/:token`). The server hard-gates publish (contributor forbidden) and user management (admin only); **the build/structure restriction for contributors is UI-enforced only** — see `docs/security-structural-enforcement.md` for that intentional gap.
- **Design tokens** (`useThemeTokens`, `settings.tokens`): the project's `DesignToken[]` are compiled into a single `<style type="text/tailwindcss">` `@theme` block in the head (debounced 200ms because each change triggers a full `@tailwindcss/browser` recompile). Distinct from `useTheme`, which only toggles the editor's own light/dark chrome via a `.light` class (a per-browser localStorage preference, not project data).

## Publish & export (`server/`)

Publishing (`POST /api/published`, admin/editor only) writes a project snapshot then runs `server/export.mjs` — a pure-JS static-site exporter (no Vue) that mirrors `PublicRenderer`, extracts data-URL media to hashed files, compiles Tailwind via `@tailwindcss/node`, and emits per-route HTML + `site.css` + `site.js` (a ~1.5 KB interaction runtime, `server/site-runtime.js`) into `server/data/site`, served by `handleStatic`. Unpublished pages are dropped. The exporter shares element/token registries with the client via `src/lib/shared/`.

## UI conventions

Primitives in `src/components/ui/` (`ButtonUI`, `InputUI`, `SelectUI`, `RowUI`, `TooltipUI`, `ColorPickerUI`, `BadgeUI`, `IconGroupUI`, `StepperUI`, …), popovers in `components/popover/`, modals in `components/modal/` (`ModalHost` sizes `sm | default | lg | xl`; `ConfirmModal` for destructive confirms), accordions in `components/accordion/` (provide/inject open-state). **Reuse these — don't hand-roll inputs/buttons.** Cross-view components used by both Build and Content mode (`AppHeader`, `CommentsEditor`, `SettingsPanel`+`UsersSettings`, `AccountModal`, `PublishDialog`, `CreateCollectionModal`, `MediaLibraryModal`, and the render-infrastructure `EntryScope`/`CommentMarker` also used by the published site) live in `components/shared/` — put anything serving both admin surfaces there. `components/editor/` is grouped by subsystem, no loose files at its root: `canvas/` (CanvasEditor, ElementRenderer, ContextMenu, InsertDock, InsertDragChip, CreateComponentModal), `code/`, `style/` (StyleEditor + the class/spacing/size/border controls), `interactions/`, `content/` (DataEditor, RichTextInput, MediaPickerControl), `media/`, `drafts/`, `users/`, `sidebar/` (SettingsEditor). `DocumentationModal` lives in `components/docs/` with its `Doc*` children. Dropdown/popover open-close/outside-click/Escape behavior comes from the per-instance `useDropdown()` composable (not a singleton), used by `DropdownUI` and `PopoverUI`.

The right sidebar (`SettingsEditor` + `usePanel`, one panel open at a time) hosts element/project panels: **data · style · interactions · custom-code · branches** (branches is labeled "Drafts" in the UI). The data/style/interactions panels also open from the code editor via typed `[` / `(` / `{` or caret-dwell inside an existing span (see The DSL above); Escape closes the panel and finalizes the token (`SettingsEditor`'s window keydown → the session watchers in `CodeEditor`). `CommentsEditor`, project `SettingsPanel` (which contains `UsersSettings`), the locale switcher, and Publish live in `AppHeader`, not the sidebar. Semantic status color tokens: `text-success` / `text-pending` / `text-danger`. Styling state is the whitespace-separated `node.classes` string, edited as tokens through `useClassField`/`ClassInput` and the `STYLE_SECTIONS` catalog + `applyClass` in `lib/styles.ts` (validates a typed class, replaces the conflicting token on the same property, auto-injects flex/grid prerequisites). Tree helpers (`walkNodes`, `findNode`) live in `lib/tree.ts`; the shared `createNode` is in `lib/elements.ts`.

Keyboard shortcuts go through `useShortcut` (`useKeymap` for modifier-aware bindings, guarded against firing inside inputs): `useEditorShortcuts` registers the editor set (the element panels have no shortcuts — Style, Data, and Interactions open by typing `(` / `[` / `{` on an element token in the code; ⌘C/X/V/D, ⌘G wrap-in-div, delete, ⌘Z/⌘⇧Z, ⌘S, ⌘E insert dock, `?` documentation); `useContentShortcuts` is the minimal content-mode set that deliberately skips editable targets so ⌘Z stays native contenteditable undo. ⌘E opens the in-canvas insert dock (`useCommandPalette`).

Note: this repo has **no MCP server code**. A host-configured `mcp__superbird__*` toolset may be exposed at the harness level, but its implementation is not in this repository.
