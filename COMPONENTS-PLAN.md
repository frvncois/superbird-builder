# Plan: Components column + bundled shadcn-style library

## Context

The editor has reusable components (`project.components`, `:Card … Card:` in the DSL) but no
place to see or manage them: they can only be created from the canvas context menu and
inserted from the ⌘E dock. There is no rename, delete, duplicate or grouping anywhere in the
UI. The app also ships no ready-made building blocks.

This adds a **Components** column to the left side, plus a bundled library of premade,
shadcn-style components that are *copied* into the project when added.

**Decisions made with the user**

| Topic | Decision |
|---|---|
| Placement | Own rail button + docked 16rem column. Shares ONE slot with Pages and Code — never two open |
| Drawer layout | Two sections: **Project** (your components) and **Library** (premade), each grouped by collapsible category |
| Rows | Name + icon rows (no thumbnails) |
| Premade model | Copy into project: becomes a normal `ComponentDef`, no link back to the library |
| Catalog source | Bundled in the repo |
| New projects | Start with nothing added; the full library is available in the drawer |
| Categories | Premade keeps its category; user-created land in "Uncategorized"; category is editable |
| Row actions | Insert (click + drag), Rename, Duplicate, Delete |
| Variants | One component per variant (`Button`, `ButtonOutline`, …) |
| Styling | Project design tokens; adding a premade creates the missing tokens with defaults |
| Delete in use | Detach every instance into plain elements (keeping its look), then remove the component |
| Catalog scope | Primitives, Content, Navigation & sections, Interactive |

**Baseline:** the working tree has *uncommitted* changes that turned the Pages drawer into a
docked column (`useViewMode.pagesOpen`/`togglePages`, `EditorLayout` `pages` slot). This plan
builds on that state. Commit it first so this feature lands as its own diff.

---

## Phase 1 — Shell: a three-way slot

Files: `src/composables/useViewMode.ts`, `src/layouts/EditorLayout.vue`,
`src/components/editor/sidebar/AppRail.vue`, `src/views/BuildView.vue`,
`src/components/editor/sidebar/PagesDrawer.vue`, new `src/composables/useDrawerEscape.ts`,
new `src/components/editor/sidebar/ComponentsDrawer.vue` (stub).

- **`useViewMode`**: replace the two refs with one
  `const column = ref<'pages' | 'code' | 'components' | null>(null)`.
  Keep `codeOpen` / `pagesOpen` as **computeds** (AppRail and BuildView read them), add
  `componentsOpen`. `showCode` and new `showComponents` additionally require Build mode.
  - `toggleComponents()` mirrors `toggleCode()`: `canBuild` only; from Preview it returns to
    Build with the column open.
  - `showApp()` sets `column = null`.
  - **Contributor pin**: the `canBuild` watcher must clear only `'code'` and `'components'`.
    Contributors keep Pages — do not null the column unconditionally.
- **`EditorLayout`**: add a `components` prop + slot as a third branch of the existing
  `v-if pages / v-else-if left` chain, and include it in the `columns` computed.
- **`AppRail`**: new `ButtonUI` (lucide `Component` icon, `tooltip="Components"`,
  `v-if="canBuild"`), placed after Pages. App highlight becomes
  `isBuild && !codeOpen && !pagesOpen && !componentsOpen`.
- **`useDrawerEscape(panelRef, { canPeel, peel })`**: extract PagesDrawer's `engaged` +
  capture-phase Escape logic (PagesDrawer.vue ~:213-252) and use it in both drawers. It must
  also bail while `useInsertDrag().payload` is set, so Escape cancels a drag instead of
  peeling a pane.

Gate: `npm run type-check`, then `npm run build && npm run test:e2e` (58 tests must stay green).

## Phase 2 — Model and component operations

Files: `src/types/editor.ts`, new `src/lib/componentOps.ts`, `src/lib/styles.ts`,
`src/composables/useComponents.ts`.

**Model** — add to `ComponentDef` (`src/types/editor.ts:337`):
```ts
category?: string   // undefined = "Uncategorized"
source?: string     // catalog key it was copied from; drives "Added" in the Library
```
`computeMerge` compares `JSON.stringify` (`src/lib/merge.ts:45`), which is key-order
sensitive. Every writer must use one canonical order: delete both optional keys, then
re-assign `category`, then `source`. No storage migration is needed.

**Pure operations** go in a new `src/lib/componentOps.ts` (DOM-free, headlessly testable).
Do not add them to `src/lib/components.ts` unless needed — that file is re-exported into the
committed MCP runtime bundle. `useComponents` gets thin wrappers.

- **`renameComponent(project, id, rawName)`**
  - Name via `normalizeComponentName(raw, taken)` with the component itself **excluded** from
    `taken` (otherwise `Card` → `Card2`).
  - Set `def.name` **and** `def.root.type` first, then patch pages. If `root.type` lags, the
    `syncStructure` watcher (`useComponents.ts` ~:181) sees every instance as divergent.
  - Patch **by node, not by text scan**: for each page node with the old type, patch
    `lines[n.line]` with a token-boundary match and the closer only if its trimmed text is
    `Old:`. Set `n.type`. No reparse, no reconcile — node ids, comment anchors and
    `targetId`s survive. Same pattern as `changeElementType` (`useElement.ts:110`).
  - All in one synchronous tick (one undo snapshot, no transient "Unknown component").
- **`duplicateComponent(project, id)`** — `cloneForMaster(def.root)` (fresh ids + internal
  `targetId` remap; a plain deep clone would leave bindings aimed at the original), new name
  `<Name>Copy` normalized, `root.type` = new name, keep `category`, drop `source`.
- **`setComponentCategory(project, id, category)`** — empty prunes the key.
- **`detachInstance(page, instanceNode, def)`** — replaces the body of today's
  `detachComponent` (`useComponents.ts:275`), which is active-page-only and loses data.
  - Pair instance ↔ master structurally (same pairing as `masterMap`'s `pair`), not through
    the active-page-only `masterMap`.
  - Bake onto page nodes: `classes`, `interactions` and `animations` (fresh binding ids,
    targets remapped master → instance), `attributes`, **and** `content` / `src` /
    `background` / `locales` wherever the instance node has none of its own. Today's detach
    drops those four, so detaching loses master text and media.
  - Wrapper handling depends on whether the wrapper is "bare" (use the **exporter's**
    definition, `server/export.mjs:674-678`: no classes, background or trigger interactions):
    - *Bare* → **unwrap**: remove the two wrapper lines, dedent the children, `reconcile`
      with an explicit line map; move a wrapper `#ref` / `htmlId` onto the first child. The
      exporter emits no element for a bare wrapper, so retyping to `div` would change the
      published layout.
    - *Styled* → retype to `div` in place.
  - Leaf-form instances (`:Card:`, `endLine === line`) can persist in stored code: expand
    with `expandComponentInstances` first, then detach.
  - Write the `(+)` / `{+}` / `[+]` markers on the baked lines with `withStyleMarker`,
    `withInteractionMarker`, `withDataMarker` (`src/lib/syntax.ts`) — the editor's marker
    sync only runs on the active page.
  - Process instances bottom-up per page so line numbers stay valid.
- **`deleteComponent(project, id)`** — detach every instance on **every** page, then remove
  the def. Leftover interactions and tokens stay in the project (document this).
- `useComponents.detachComponent(instanceId)` becomes a wrapper over `detachInstance` +
  reselect.

Also export a helper returning `{ count, pages }` of instances for a component (scan
`page.elements` on all pages by `n.type === def.name`, as MCP's `delete_component` does).

Gate: `npm run type-check` + a throwaway `.tmp-test.ts` (pattern in CLAUDE.md) covering
rename with a `Card` / `CardHeader` pair, duplicate with internal bindings, detach of a bare
and a styled wrapper, a leaf instance, and delete across two pages. Rebuild the bundle with
`npm run build:mcp-runtime` only if a file it re-exports changed.

## Phase 3 — Drawer: Project section

Files: `src/components/editor/sidebar/ComponentsDrawer.vue`, new
`src/components/editor/sidebar/ComponentSettingsEditor.vue`.

Copy PagesDrawer's patterns rather than inventing new ones:

- Module-level `expanded` state in a plain `<script lang="ts">` block (the column unmounts
  when toggled off).
- Search field and filtering helpers (`needle` / `searching`; a group whose own name matches
  keeps all its rows; filtering force-opens groups).
- Group header, collapsible group row, leaf row and kebab `MenuUI` markup/classes.
- The `.pane` + `drawer-push` list ↔ detail transition.
- `DrawerSection` / `DrawerField` imported as-is.

**Project section** — categories alphabetical, "Uncategorized" last. Empty state: "No
components yet. Add one from the library below."

- Row click → `useCommandPalette().insertComponent(name)` + `requestEditorFocus()`.
- Row `@pointerdown.left` → `useInsertDrag().startInsertDrag({ kind: 'component', name }, $event)`;
  the row needs `touch-none select-none cursor-grab` (as `InsertDock.vue:295`). The existing
  `InsertDragChip` in BuildView renders the drag.
- Kebab: **Settings**, **Duplicate**, **Delete**.

**`ComponentSettingsEditor`** (pushed detail pane, modelled on `PageSettingsEditor`):

- Holds a `componentId`, never the object (undo / draft switch replace the `project` ref);
  `watch` auto-emits `back` when the component stops resolving.
- Fields: **Name** (commit on blur/Enter → `renameComponent`), **Category** (text input with
  the existing categories offered as suggestions), a muted line with the instance count and
  the pages using it, and a Duplicate / Delete footer.
- **Delete** uses `useModal().confirm` and states the instance count: "Card is used 6 times
  on 3 pages. Those will become plain elements." When drafts exist, add that a draft still
  using this component will reference a missing one after it is applied. Same warning for
  rename.

Gate: `npm run type-check`.

## Phase 4 — Catalog infrastructure + Library section + primitives

Files: new `src/lib/catalog/` (`types.ts`, `tokens.ts`, `materialize.ts`, `index.ts`,
`entries/*.ts`), `src/composables/useSettings.ts`, `src/composables/useComponents.ts`,
`src/lib/styles.ts`, `ComponentsDrawer.vue`.

**Entry format** — pure data, symbolic keys instead of ids:
```ts
interface CatalogEntry {
  key: string          // 'button-outline' — stored as ComponentDef.source
  name: string         // 'ButtonOutline'  — default component name
  category: string     // 'Buttons'
  tokens: string[]     // design tokens its classes rely on
  interactions?: { key: string; name: string; toClasses: string; duration: number; easing: string }[]
  root: CatalogNode    // the single child of the component root
}
interface CatalogNode {
  type: string; key?: string
  classes?: string; content?: string; link?: string
  attributes?: Record<string, string>
  interactions?: { interaction: string; trigger: string; target?: string
                   action?: string; closeOn?: string[]; group?: string }[]
  children?: CatalogNode[]
}
```

**`materializeCatalogEntry(entry, project)`** returns `{ def, newInteractions, missingTokens }`:

- Assigns UUIDs, resolves symbolic `target` keys to the new ids.
- Builds the root as `createComponent` does: `{ id, type: name, content: '', children: [root] }`.
- Name through `normalizeComponentName` against existing component names.
- Interactions get **entry-specific names** ("Accordion · open"). Reuse a project interaction
  only when name and all fields match — never share one effect between unrelated components.

**`useComponents.addFromCatalog(key)`** applies tokens (batch push), interactions and the def
in one synchronous tick. Add `useSettings().ensureTokens(list)` — no such helper exists
(`addToken()` creates a nameless placeholder); validate with `tokenError`.

**Default tokens** (`src/lib/catalog/tokens.ts`), hex values from shadcn's neutral theme. All
17 names pass validation and collide with no built-in utility:

`background`, `foreground`, `card`, `card-foreground`, `primary`, `primary-foreground`,
`secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`,
`accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`

Only the tokens an entry declares are created, and an existing token of the same name is
reused untouched.

**Class rules for every entry**

- Every class must pass `isValidClass` — classes written straight to `node.classes` render
  fine but become un-retypeable in the Style panel.
- Add `contents` to the display vocabulary in `src/lib/styles.ts` only if an entry needs it.
- Not supported, do not use: `/NN` opacity forms (`bg-primary/90`, `bg-black/80`),
  `ring-offset-background`, `peer`, `top-full`. Use `hover:opacity-90` for hover states.
- States via `hover:` / `focus-visible:` classes; interactions only for open/close.
- Components cannot nest: inline button markup inside Card, Hero, CTA, etc.
- No `htmlId`-based wiring (`label[for]`, anchors) — it does not replicate across instances.
- There is no icon or `hr` element: Separator is a `div`, chevrons are text spans.

**Library section** — same group/row markup, below Project. Each row has an Add button; when
a project component has that `source`, the row shows a check and the button is disabled.
After adding, show a muted line for ~2.5s ("Added Card · created 4 design tokens"). There is
no toast primitive — use inline transient state like `SettingsPanel.vue:149`.

**Entries in this phase (Primitives)**

| Category | Components |
|---|---|
| Buttons | `Button`, `ButtonSecondary`, `ButtonOutline`, `ButtonGhost`, `ButtonDestructive`, `ButtonLink` |
| Badges | `Badge`, `BadgeSecondary`, `BadgeOutline`, `BadgeDestructive` |
| Forms | `Input`, `Textarea`, `Select`, `Checkbox`, `Label`, `Field` (label + input) |
| Display | `Avatar`, `Separator` |

Gate: `npm run type-check` + a headless `.tmp-test.ts` that, for every entry: registers the
default tokens by calling `setStyleTokens` **and** `setColorTokens` directly (they normally
run in a `watchEffect`), asserts every class passes `isValidClass`, materializes the entry,
serializes it with `serializeNode`, and asserts `validateDocument` returns no diagnostics.
Keep this check runnable for Phase 5.

## Phase 5 — Remaining catalog entries

Files: `src/lib/catalog/entries/*.ts`.

| Category | Components |
|---|---|
| Cards | `Card`, `CardWithFooter` |
| Feedback | `Alert`, `AlertDestructive` |
| Content | `Testimonial`, `PricingCard`, `FeatureBlock` |
| Navigation | `Navbar` (with mobile menu toggle), `Footer`, `Breadcrumb` |
| Sections | `Hero`, `CallToAction` |
| Interactive | `Accordion`, `Dialog`, `DropdownMenu`, `Tabs` |

`Table` is dropped: the element registry has no table elements. `DropdownMenu` is named that
way because `dropdown` is a built-in `<select>` element.

**Interactive recipes** (from `packages/guano/mcp/GUIDE.md`):

- **Accordion** — GUIDE.md:888-897. Base `hidden` on the answer, `toClasses: block`, click
  binding with a `group` (scoped per instance automatically).
- **Dialog** — GUIDE.md:872-886. Opener `action: 'on'`, overlay and X `action: 'off'`,
  `closeOn: ['escape']`.
- **DropdownMenu** — GUIDE.md:851-862. `closeOn: ['outside', 'escape']`.
- **Tabs** — do **not** use an `appear` trigger for the default tab (the published runtime
  forces appear states on after 3s, snapping back to tab 1). Panel 1 has no `hidden`; panels
  2..N have base `hidden`. Two interactions, Show (`block`) and Hide (`hidden`):
  - Tab k (k ≥ 2): `{Show → Pk, on, group: 'panels'}` and `{Hide → P1, on}` (no group).
  - Tab 1: `{Hide → P1, off}` and `{Show → Pk, off}` for each k ≥ 2.
  - Active-tab highlight uses the same shape with `bg-*` / `text-*` classes only.
  - Never give one target two interactions with different groups (editor and runtime key
    groups differently).
  - Ship 3 tabs. Adding a fourth needs manual wiring — accepted limit.

Gate: the Phase 4 headless check, then `npm run build` and a manual publish of a page
carrying Tabs and Dialog, checking them on the exported site at `/`.

## Phase 6 — MCP, docs, e2e

Files: `packages/guano/mcp/tools.mjs`, `packages/guano/mcp/GUIDE.md`, `CLAUDE.md`,
new `e2e/ui-components-drawer.spec.ts`.

- **MCP**: `list_components` returns `category` (`tools.mjs` ~:2993-3057); `create_component`
  accepts an optional `category`. Fix the stale "re-read with `get_component`" string
  (~:3211) — that tool does not exist.
- **GUIDE.md**: Components section (L757-821) and the tokens note (L514-517: a catalog
  premade may create tokens).
- **CLAUDE.md**: the "two columns share one slot" paragraph becomes three; add a Components
  bullet under "Subsystems" (catalog format, copy-on-add, `componentOps.ts`, detach
  unwrap-vs-retype rule, canonical key order).
- **e2e** `ui-components-drawer.spec.ts` (sorts after `smoke.spec.ts`; copy `openEditor` /
  `publish` from `e2e/ui-entry-editor.spec.ts`; use `exact: true` on the rail button):
  1. Opening Components closes Code and Pages, and the reverse.
  2. Add `Button` from the Library → it appears under Project, the Library row shows Added.
  3. Insert it, publish, assert the button markup **and** a token-derived class in the
     exported CSS. The `?demo` project already has `primary`, so assert on a token the demo
     lacks (e.g. `primary-foreground`) to exercise token creation.
  4. Rename → the published page still renders it styled.
  5. Delete while in use → the published page keeps the element and its look.

Gate: `npm run build && npm run test:e2e`.

---

## Out of scope

- Thumbnails / live previews of components.
- A real variant system (instances choosing a variant).
- A remote registry, and MCP tools to browse or add catalog entries.
- Removing orphaned tokens or interactions when a component is deleted.
- De-duplicating component names after a merge. Known hazard: Main and a draft each adding
  catalog `Button` yields two components with the same name (`findComponent` takes the
  first). Pre-existing, but the catalog makes it likelier — record it in `BACKLOG.md`.

## Verification (end to end)

1. `npm run type-check`
2. Headless catalog + operations checks (`.tmp-test.ts`, removed afterwards)
3. `npm run build && npm run test:e2e`
4. Manual, with `npm run serve` + `npm run dev`, on a **fresh project** (not `?demo`, whose
   10 tokens mask missing-token bugs):
   - Rail: Pages / Code / Components never open together; App closes all; contributor
     account sees Pages only.
   - Add `Card`, `Accordion`, `Tabs`, `Dialog`; check Settings → tokens lists the created ones.
   - Insert by click and by drag; rename; duplicate; change category; delete while in use.
   - Publish and check the interactive components on the exported site at `/`.
   - Undo after add, rename and delete restores the previous state in one step each.
