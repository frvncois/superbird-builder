# Tree-source plan — retire the DSL, give agents HTML

Decided 2026-10-02, **before launch**:
1. The `ElementNode` tree becomes the only source of truth for page structure.
2. `page.code` and the indentation DSL are deleted.
3. AI agents read and write pages as a **strict HTML subset** instead, a format every model
   already knows.

Line numbers are from `main` @ `4247496`.

## Why (the short version)

The DSL stopped earning its keep when the code editor was removed. No human types it,
yet every structural edit in the UI still does three things:
1. splices text lines;
2. re-derives the tree with `reconcile` (LCS line diff + same-line fallback + ref
   pre-pass), purely to recover node identity it never needed to lose;
3. re-syncs display-only markers.

It also forces two structure backends: pages are text, component masters are trees.

The agent-side argument was compactness, but agents pay for it in other ways:
- **A ~40 KB grammar to learn.** About 35–40 KB of the 116 KB `GUIDE.md` is DSL syntax
  or DSL addressing.
- **Line arithmetic.** Edits are addressed by computed line numbers.
- **A second round of calls for every structural write.** Structure goes in code;
  classes and content go in a separate `edit_elements` call.

With HTML, one write carries structure, classes and text together.

What the inventories found, which makes this tractable:
- **`server/export.mjs` never reads `page.code`.** It renders from `elements`.
- **`server/contributor-merge.mjs` never reads `page.code`.** It overlays content onto
  the stored tree by id.
- **`merge.ts` only sees `code` as part of a page's `JSON.stringify`.** Removing `code`
  just removes marker-churn noise.
- **Nothing in the browser parses text any more.** No caller of `enforceDocument` or
  `parseSyntax` handles user input. Every DSL use is a splice-then-reconcile, an
  in-place line patch, or a `@setup`/marker resync.
- **The component-master backend (`componentOps.ts:410-759`) is already a complete
  tree-native structure backend.** It covers insert, move, remove, duplicate, wrap,
  retype, the drop guards and the binding cleanup. Pages adopt it.

## Ground rules for the executor

- **Gates:** `npm run type-check`; `npm run check:catalog`; `npm run check:mcp`;
  `npm run build` + `npm run test:e2e` before each phase commit. Headless checks of
  `src/lib/*` go through the throwaway `.tmp-test.ts`.
- **Rebuild the MCP bundle:** `npm run build:mcp-runtime` whenever `src/lib/mcp-runtime.ts`
  or anything it re-exports changes.
- **Docs in the same commit:** `CLAUDE.md`, `GUIDE.md` and the `GUIDE_INSTRUCTIONS`
  update in the same commit as the behaviour they describe.
- **Phase 0's corpus is the referee.** The exported HTML of every fixture project must
  be byte-identical before and after Phases 1 and 4. A diff is a bug, not a
  re-baseline.
- **Run in order** (0 → 1 → 2 → 3 → 4 → 5). Each phase leaves `main` shippable.
- **The forms plan (`FORMS-PLAN.md`) starts after this lands.** It names `[+]` markers
  and `validateDocument`, and both are replaced here.

---

## The HTML format (spec — Phase 2 implements it, Phase 3 documents it)

Three principles:
- **Lenient in, canonical out.** The reader accepts what an agent naturally writes; the
  writer always emits one form.
- **Strict well-formedness.** Every element is closed or self-closed (`/>`). Known void
  tags (`img`, `input`, `br`) may omit the slash. Attributes are quoted. This is the
  JSX discipline models already follow.
- **Tag names are case-sensitive.** That's what lets `<Card>` mean a component. It's
  also why we **don't use parse5 or any HTML5 parser**: they lowercase tag names. The
  parser is a small hand-rolled tokenizer for this subset (`src/lib/html/parse.ts`),
  with errors carrying `line:col` of the agent's input.

### Elements
| Registry type | Canonical HTML | Notes |
|---|---|---|
| a type that IS an HTML tag (`section`, `div`, `h1`…`h6`, `span`, `label`, `button`, `form`, `input`, `textarea`, `select`, `option`, `fieldset`, `legend`, `table`…`td`, `header`, `footer`, `nav`, `main`, `aside`, `article`, `video`) | same tag | — |
| `paragraph` | `<p>` | |
| `link` | `<a href="…">` | `href` ↔ `node.link` |
| `list` / `list-item` | `<ul>` / `<li>` | |
| `image` | `<img src alt />` | |
| `checkbox` / `radio` | `<input type="checkbox|radio" />` | `type` picks the registry type |
| `icon` | `<svg data-icon="chevron-down" />` | Markup is never in the HTML; it's set with `edit_elements {icon}`. A custom SVG reads as `data-icon="custom"` and is preserved. |
| `text` | `<div data-type="text">…</div>` | **Input:** a `<div>` holding only text/inline markup is promoted to `text` automatically. |
| `collection-list`, `collection-item`, `list-empty`, `slider` | `<collection-list source="post">`, `<collection-item source="post">`, `<list-empty>`, `<slider source?>` | Behaviour elements keep their own names; they have no HTML equivalent. |
| component instance | `<Card>` (PascalCase) | See Components below. |
| `body` | `<body>` root | Optional on input. |

**Pure aliases are collapsed by the Phase 4 migration:** `container`/`grid` → `div`,
`heading` → `h2`, `dropdown` → `select`. Each has the same tag and the same leaf or
container shape as its target, so rendering is unchanged (the corpus proves it). Then
remove them from `ELEMENTS_DATA` and `TYPE_GROUPS`. If product wants the
"Grid"/"Container" names in the insert dock, keep them as **dock presets** (a `div` plus
classes), not types.

### Attributes ↔ node state
| HTML | Node | Notes |
|---|---|---|
| `class` | `classes` | Validated through `isValidClass`/`applyClass` on write, like `edit_elements`. |
| `id` | `htmlId` | |
| `data-ref` | `ref` | Page-unique. Refused on `<body>` and inside an instance. |
| `data-id` | node id (**8-hex prefix**, unique within the page; lengthened on collision) | **Output only** by default; **honoured on input**, where it's the strongest adoption signal. |
| `data-field` | `arg` on an ordinary element (field binding) | |
| `source` | `arg` on `collection-list`/`collection-item`/`slider`/`body` | |
| `href` | `link` | Also allowed on a non-`<a>` container (the exporter wraps it), as today. |
| `src`, `alt`, … | `src` / `attributes` | `data:` URLs are emitted as `src="data:…(elided)"` and kept unchanged on write. |
| any `ATTR_ALLOW` attribute (`shared/attributes.js:9`) | `attributes` | |
| `data-bind-<attr>="field"` | `fieldAttrs[attr]` | |
| `data-hidden` | `hidden` (editor hide) | **Not** the HTML `hidden` attribute, which stays an ordinary attribute. |
| `data-variant-<axis>="opt"` | instance `variants` | `<Card>` only. |
| `data-interactions="Open menu, Fade"` / `data-animations="…"` | — | **Read-only** info, ignored on input. Bindings stay with `bind_interaction`. |
| inner HTML of a **leaf** | `content` | Runs through `sanitizeRich`. Leaf-ness comes from the registry. |

**Not in the HTML** (these stay node state, edited by the dedicated tools; a write
preserves them on adopted nodes): interactions, animations, `locales`, `slider`
config, `listQuery`, `entryId`, `form`, `instanceAttributes`.

Page meta (`name`/`slug`/`status`) is tool parameters, not markup. `@setup` is gone:
`locale` was always `project.defaultLocale`, and the other three already live on
`Page`.

### Components
- **On read**, an instance is `<Card data-ref="promo" data-variant-size="sm">` with its
  parts as children showing **content only**. There are no classes inside an instance,
  because those are the master's. So the agent sees, in one read, the text it can
  change.
- **On write:**
  - `<Card />` self-closed: a fresh instance, or an adopted one (keeping its per-instance
    content) when `data-ref`/`data-id` matches.
  - `<Card>` with children: the structure must match the master. A mismatch is a
    diagnostic, not a silent adopt-into-master. Only the parts' content, `src` and
    `alt` are taken. Classes or extra elements inside are refused, naming the part.
  - This makes "a page of eight filled-in Cards" **one write**. Today it's a DSL write
    plus ~N part edits.
- **Masters** are read and written with the same format via `create_component {html}`
  and `update_component {html}`: the root element is the master root. Nesting
  (`<Button>` inside a Card master) follows the same instance rule.

### Adoption on write (the only place identity matching survives)
`applyHtml(tree, parsed)` (`src/lib/html/apply.ts`), in this order:
1. **`data-id`.** An exact match (same type) adopts the node.
2. **`data-ref`.** Same ref and same type adopts the node.
3. **Tree LCS** per parent on `nodeSignature` (type|arg|link), then by type. This is
   `alignMirror`'s algorithm (`components.ts:108-136`), which is already tree-based.
4. **Anything else is new** and gets fresh ids.

Adopted nodes keep every piece of state the HTML doesn't carry. Removed nodes go
through `clearBindingsTo`, which drops dangling `targetId`s.

The result reports `{kept, created, removed, refused[]}` like `set_page_code`'s
`reconciled` today. A tree-to-tree match at one boundary, keyed mostly by ids the
agent echoed back, is far simpler than `reconcile`'s text heuristics, and it runs only
for agents, never on a drag.

### `version`
`version = sha256(canonical HTML of the page in the default read mode + page meta)`.
**The version changes if and only if something `get_page` shows changes.** It replaces
`sha256(page.code)`, and it removes the "the editor's marker sync advanced your
version" class of stale writes.

---

## Status

- **Phase 0 — done** (`scripts/corpus.mjs`, `npm run check:corpus`). Inputs: the e2e
  fixture, one page per bundled library entry (42), and the local `server/data` store
  (8 pages / 31 components / 7 collections). Verified it fails on a changed byte and on
  a re-minted node id.
- **Phase 1 — done.** Nothing in `src/` reads `page.code`; it is regenerated from the
  tree by `lib/pageCode.ts`. Corpus byte-identical, identity preserved. Full e2e suite
  green (168), which it was NOT before: nine specs were already red on `main` from two
  pieces of rot in `4247496` — a `placeholder` deleted from `ClassInput` while its
  styling stayed, and three render-flush races in the test helpers (`insertFromDock`,
  `openLayers`, plus a `getByRole(name: 'Back')` that also matched 'Background').
  Those are fixed, so the UI gate for the rest of the migration is real.

- **Phase 2 — done.** `src/lib/html/` (tags, serialize, parse, apply, ids) plus
  `npm run check:html`. The three round-trip properties hold over the whole corpus —
  52 pages and 75 component masters, nothing created, nothing removed, identity total
  even with every `data-id` stripped — and 37 behaviour/refusal cases pass. The MCP
  still speaks the DSL; Phase 3 wires this in. Five bugs the corpus caught, each of
  which would have shipped silently: a component named `Input` read as the void
  `<input>` (the lenient-void check lowercased the tag), a master's own children read
  as "inside an instance" so a component read showed no classes at all, `checkbox` and
  `radio` round-tripping as plain `<input>` (the registry's implied attributes were
  never emitted), two variant picks re-ordered into a merge conflict, and an unknown
  class being DROPPED rather than kept. The property test is a committed gate rather
  than a throwaway, and an e2e spec on top of the tools lands in Phase 3.

- **Phase 3 — done.** The MCP speaks HTML: `get_page {html}`, `set_page_html`,
  `edit_structure` (insert/replace/move/remove/wrap, applied to a copy so a bad op
  refuses the whole batch), `create_component {html}` / `update_component {html}`,
  components and the library returning `html` + a `version`. Every `line` parameter is
  gone, along with `nodeAtLine`, `numbered`, `codeRange`, `lineShifts`,
  `syncMarkersForNode`, `instanceLinkDiagnostics`, `divergentNestedBlock` and
  `applyComponentCode`'s six passes. `tools.mjs` no longer mentions `page.code`.
  GUIDE.md's `the-dsl` (14.8 KB) became `page-html` (11.3 KB) and every DSL fence in
  the other sections is HTML; the guide is 116.6 → 113.3 KB, the instructions 14,084 →
  13,610 B. e2e: 62 call sites converted across 8 specs plus the new
  `mcp-page-html.spec.ts` (12 tests), 181 passing.

  Three decisions worth knowing. (1) **Diagnostics are reported, not refused** — a
  `nodeId` only exists once the write landed, so a well-formed document with an unknown
  collection saves and comes back with a loud note; only PARSE errors refuse. (2) The
  **version excludes the read-only effect names** (`{effects: false}`): an effect is node
  state the HTML reports but does not carry, so a binding change can never make a
  pending structure write unsafe — this is the "marker sync advanced your version" class
  of spurious staleness, gone. (3) A write that **drops a `class` attribute clears the
  classes**, which is the format's declarative rule and also the easiest way to wipe a
  component's styling from memory — so it now comes back as a named warning.

  Budget: **68,297 / 70,000 B**, not the 65,000 the plan hoped for. The gate passes and
  the budget was not raised, but the target assumed the two new tools would cost less
  than `set_page_code` plus the `line`/`codeRange` params saved; `edit_structure`'s
  schema is 2 KB on its own. Reaching 65,000 now means cutting real information out of
  `edit_elements` (12.4 KB) or `update_settings` (9.2 KB), which is a separate judgement
  call rather than trimming prose.

- **Phase 4 — done.** The DSL is deleted: `syntax.ts`, `document.ts`, `pageCode.ts` and
  `useCodeMirror.ts` are gone, `Page.code` and `ElementNode.line`/`endLine` are gone from
  the types, and what survived of `syntax.ts` (`NODE_STATE_KEYS`, `hasNodeState`,
  `stripNodeState`, `BUILTIN_LIST_SOURCES`) is `lib/nodeState.ts`. `src/lib/migrate.ts`
  is the v2 migration and `scripts/check-migrate.ts` / `npm run check:migrate` is its
  gate; the salvage-only parser is quarantined in `src/lib/legacy/dsl.ts`, marked for
  deletion one release after launch. The server migrates every blob at boot
  (`migrateSchema`) — Main, drafts, `guano-base:*` and the published baseline — after
  copying the store to `data/store.pre-v2/`. Corpus byte-identical through the
  migration with identity preserved; `check:migrate` green and verified to fail (4
  FAILs) when the collapse is broken; full e2e suite green.

  Two deviations from the plan, both deliberate. (1) The four alias types stay in
  `ELEMENTS_DATA` as a **render fallback** — the plan said delete them, but
  `const tag = def?.tag ?? 'div'` would quietly degrade a `heading` to a div for any
  blob the migration never saw (an old export, a hand-written import). They are out of
  `TYPE_GROUPS`, so nothing can insert one. (2) What the aliases offered was a styled
  div, so Container and Grid came back as insert **presets** — `PaletteItem.classes`,
  and `paletteKey` because several entries now share one type.

  Three things the gate caught that type-checking could not: `check:migrate` conflating
  two properties (the alias collapse must render identically, but materializing an
  unexpanded instance *is* an intended render change — the page was rendering nothing),
  the dock's row key becoming `type:label` and breaking every `[data-dock-item]` query
  in the UI specs, and `mcp-components.spec.ts` asserting on `page.code` text.

## Phase 0 — Safety net (½ day)
- **0.1 Corpus.** `scripts/corpus.mjs` exports every project in `e2e/fixtures/`, the
  bundled catalog (each entry placed on a page), and any local `server/data` store into
  `.corpus/<name>/`. A `--check` mode diffs a fresh export against the saved one. This
  is the referee for Phases 1 and 4.
- **0.2 Identity snapshot.** For the same projects, dump `{pageId: [nodeId, type,
  parentId, index]}`. Node ids must survive the migration: comment anchors
  (`commentAnchor.ts`), interaction `targetId`s and merge bases all address them.

## Phase 1 — Editor: tree-native structure, `code` becomes a write-only mirror (4–5 days)
**Goal:** after this phase nothing in `src/` reads `page.code`. It is still *written*,
regenerated from the tree, so the MCP keeps working unchanged until Phase 3.

- **1.1 One structure backend.** Generalize `componentOps`' master verbs over a **host
  root**:
  - `insertIn(root, …)`, `moveIn`, `removeFrom`, `duplicateIn`, `wrapIn`, `retypeIn`,
    `resolveSlot`, `canDropIn`.
  - Pages pass `page.elements[0]` (body); masters pass `def.root`.
  - `useStructure` (`:129-242` page, `:328-448` master) collapses to one backend
    parameterized by the host.
  - Master-only rules stay as policy callbacks: the push, promotion, `canNest`,
    `enclosingNestedInstance`.
  - Port `nudgeOne`/`moveSelectionGroup` (`useElement.ts:685-736`, line-based) to the
    master `nudge`'s sibling logic (`useStructure.ts:380-402`).
- **1.2 Delete the line ops in `useElement.ts`:**
  - `elementAtLine` (166)
  - `changeElementType` (186)
  - `setElementArg` (213)
  - `syncNodeMarkers` (239, no callers)
  - `setElementLink` (283)
  - `removeElement`/`removeElements` (297/571)
  - `copy`/`paste`/`insertElementBlock` (320-481)
  - `selectByLine` (516)
  - `reorderBlock`/`reorderElement` (618-678)
  - `wrapSelectionInDiv` (745)

  `setElementRef` (258) keeps its tree checks and drops the line patch. Selection after a
  remove becomes the previous sibling, else the parent.
- **1.3 Clipboard = subtree clone.** `copy` deep-clones with `captureProps`. `paste`
  re-mints ids and remaps internal `targetId`s, the way `duplicateInMaster`/
  `cloneForMaster` already do. Copy and paste between pages and masters now works (the
  master backend's copy/paste was a "v2 job", `useStructure.ts:444`).
- **1.4 Instances on pages.** A structural edit *inside* a page instance is applied to
  the **master** (then pushed), which is what `syncStructure` produced indirectly
  before. Delete `syncStructure` and its `pages.map(p=>p.code)` watcher
  (`useComponents.ts:147-202`), along with the "one synchronous tick" constraint on
  `onMaster` that existed only because of it.
- **1.5 Push = tree realign.** `pushMasterStructure` (`componentOps.ts:674`) realigns each
  page instance subtree to `def.root` with an `alignMirror` variant that preserves
  per-instance state (`MIRROR_KEYS` plus `content src svg background locales hidden
  variants instanceAttributes`), unchanged subtrees staying byte-identical. Delete:
  - `expandLeafInstances` (300)
  - `rewriteInstanceBlock` (721)
  - `isClosedBlock` (754)
  - `alignInstanceLines`/`lineTypeSig` (`components.ts:272-302`)
- **1.6 Component verbs, tree-only:**
  - **`renameComponent`** (`componentOps.ts:105`): the type assignments only. Drop the
    line regex.
  - **`detachOne`** (315): retype to `div`, or splice the children into the parent and
    move `ref` to the first child. This is `detachInMaster` (792), generalized.
  - **`createComponent`** (`useComponents.ts:220`): replace the source with
    `{type: Name, ref: source.ref, children: [clone]}`. Delete `hoistBlockRef`.
- **1.7 Pages and collections without `@setup`:**
  - `usePage` `duplicatePage`/`renamePage`/`updatePageMeta` (36-95) write fields only.
    This also retires the latent bug where those `buildDocument` calls dropped the body
    line's markers.
  - `useCollections` (`createCollection` 39, `duplicateCollection` 151) and
    `factories.createPage` (14) build trees with `createNode`.
  - `useLocale.setDefaultLocale` (88-97) becomes `project.defaultLocale = code` and
    nothing else.
- **1.8 Validation on the tree.** `validateTree(page, ctx)` returns `{nodeId, message}`,
  which `LayersPane` (89-108) and `check-catalog` use. It ports the surviving rules from
  `validateDocument` (`syntax.ts:790-1004`):
  - duplicate ref;
  - a ref inside an instance;
  - list/item/slider sources;
  - `list-empty` placement;
  - `@item` inside a data-only scope;
  - an unknown component;
  - a component containing itself.

  The text-only rules (indentation, unclosed blocks, leaf/container form, invalid
  token, `#ref` on body) vanish because they can't happen in a tree. `goToIssue`
  selects by `nodeId`.
- **1.9 Container-ness from the registry.** `pageIsContainer` (`useStructure.ts:100`)
  and `useInsertDrag.ts:61` become `!isLeafElement(type) && !isComponentType(type)`.
- **1.10 The transitional mirror.** One detached watcher regenerates `page.code` from the
  tree (a page-level `serializeNode` plus markers, replacing `useMarkerSync`) **for the
  MCP only**. It's deleted in Phase 4. `useEditTracking.pageSig` (18) drops `c`.
- **1.11 Gate.** The corpus is byte-identical. Identity is preserved for every node.
  The e2e UI specs (layers, nesting, components drawer, variants, slider panel) pass
  unchanged.

## Phase 2 — The HTML layer, `src/lib/html/` (3 days)
- **2.1 `serialize.ts`:** `pageToHtml(page, project, {ids, mode})` and
  `masterToHtml(def)`.
  - Canonical, two-space indented, deterministic attribute order: `data-id`, `data-ref`,
    `class`, then alphabetical.
  - Modes:
    - `full` (default);
    - `structure` (no content or classes, for big pages);
    - a `subtree` of one ref/id.
- **2.2 `parse.ts`:** the strict tokenizer.
  - Supported: elements, quoted attributes, text, the five XML entities plus numeric
    entities, comments (ignored) and `/>`.
  - Refused with `line:col`: `<script>`, `<style>`, `on*` attributes, unknown tags,
    unclosed or mismatched tags, duplicate attributes.
  - A leaf's inner markup is captured raw and handed to `sanitizeRich`.
  - Caps: 2 MB input and depth 64.
- **2.3 `apply.ts`:** the adoption algorithm above. Every write runs through
  `validateTree` and the existing validators: classes (`isValidClass`), `SAFE_SRC`,
  `sanitizeAttributes`, the ref rules and `canNest`.
- **2.4 Round-trip property test** — landed as `scripts/check-html.ts` / `npm run check:html`
  rather than a throwaway: a hand-rolled parser with no suite is the thing that rots,
  and there is no unit runner. The e2e spec in Phase 3 covers the TOOL surface on top.
  For every corpus page, three properties must hold:
  - `parse(serialize(page))` applied to the page is a **no-op**: identical JSON, nothing
    created or removed.
  - Serializing twice is a fixed point.
  - Stripping every `data-id` and re-applying still adopts 100% of nodes on unchanged
    input.
- **2.5** Re-export from `mcp-runtime.ts`. The parser never enters the editor bundle;
  the editor doesn't need it.

## Phase 3 — MCP: tools, guide, budget (4–5 days)
- **3.1 Reads:**
  - `get_page` returns `html` (+ `version`, `diagnostics`), with `mode` and `ref`/`id`
    for a subtree.
  - Remove `code`, `numberedCode`, `codeRange`, `totalLines` and every row's `line`.
  - The `elements` row modes stay for targeted reads (`refs`, `ref-parts`). They carry
    `id`/`ref`/`path`, never `line`.
- **3.2 Writes:**
  - **`set_page_html {pageId, html, version}`** replaces `set_page_code`. It's the whole
    body, through `apply.ts`, and returns `{version, kept, created, removed, refused}`.
  - **`edit_structure {pageId|componentId, version, ops[]}`** is the new batch. Ops:
    - `insert {html, parent|before|after: ref|id}`
    - `replace {target, html}`
    - `move {target, parent|before|after}`
    - `remove {target}`
    - `wrap {targets, html}`

    This is the cheap path. Most agent edits stop being full-page rewrites.
  - `edit_elements` keeps all node-state ops. **`line` addressing is removed** (here and
    in `detach_instance`, `bind_interaction` and `unbind_interaction`), along with
    `arg` → becomes plain node writes, `setRef` → plain. `syncMarkersForNode` and every
    caller are deleted.
  - `create_component {html}` / `update_component {html}` replace the `{code}` forms
    (`applyComponentCode`, `tools.mjs:2191`, is rewritten over `apply.ts`).
    `makeComponentFrom` (2470) becomes tree-only.
  - `create_page` / `create_collection` build trees. `list_components` and
    `list_library` `structure` become `html`.
- **3.3 Version** as specified. Every `stale-version` path keeps returning `message` +
  `currentVersion`. Rewrite `STALE_MESSAGE` (549) without markers.
- **3.4 Delete** `instanceLinkDiagnostics` (2412) and `libraryHints`' text parsing (2451).
  `libraryHints` now reads unknown-component diagnostics from `validateTree`. Also
  `numbered`, `nodeAtLine` and `lineShifts`. In `designWarnings`, rewrite the messages
  in HTML spelling (`<select>`, not `:select`).
- **3.5 `GUIDE.md`:**
  - Replace `the-dsl` (~15 KB) with a short **`page-html`** section: the table above,
    the component rule, and adoption via `data-id`.
  - Rewrite the DSL fences in workflow-recipe, content-media-data, components, nesting,
    class-interactions, sliders, icons and tool-gaps as HTML.
  - Golden rules 1, 3 and 7 are restated; rule 3 (markers) is **deleted**.
  - Target: the guide shrinks by 20–25 KB.
  - `GUIDE_INSTRUCTIONS` drops the line-addressing and marker paragraphs.
- **3.6 Budget.** `check:mcp` is at 67,770 / 70,000 B. Removing `set_page_code`, the
  `line` and `codeRange` params and the marker prose must pay for `set_page_html` and
  `edit_structure`. **Don't raise the budget.** Target ≤ 65,000 B.
- **3.7 e2e:**
  - `e2e/fixtures/mcpSession.ts:20` `pageCode()` → `pageHtml()`.
  - Convert about 38 `set_page_code` calls, 6 `create_component`/`update_component
    {code}` calls, the 6 line-addressed edits in `mcp-tools-security.spec.ts`
    (307–430), and about 11 code-text assertions.
  - `export-library.spec.ts:54-59` uses the tree validator.
  - New spec **`mcp-page-html.spec.ts`**:
    - the round-trip property (2.4);
    - adoption by `data-id`, by `data-ref` and by LCS;
    - a filled `<Card>` write landing on the parts;
    - classes inside an instance refused;
    - `<script>` and `on*` refused with `line:col`;
    - a stale version.

    Assertions are checked against the **exported HTML**, like `mcp-components`.

## Phase 4 — Migration and deletion (2–3 days)
- **4.1 Schema version.** `project.schemaVersion = 2`.
  - The server migrates **every blob in the store** once at boot:
    - `guano-project:*` blobs;
    - `guano-base:*` blobs, which must migrate too or the 3-way merge sees every page
      changed;
    - the published baseline.
  - It does so with `migrateProject` from the runtime bundle, writing atomically and
    keeping a `store.pre-v2/` copy.
  - `migrateStoredProject` (`storage.ts:60`) runs the same function client-side as a
    defensive no-op. `/api/project-import` migrates imported packages.
- **4.2 What the migration does:**
  1. **Do NOT re-derive the tree from `code`.** This was the original plan; Phase 1
     disproved it. Over the corpus, `reconcile(code, code, elements)` changes the tree
     on one fixture page: a node carries `link: "#pricing"` that its line never had, so
     re-deriving DROPS a link the exporter currently honours. The stored tree is what
     every renderer reads, so it is what the user saw and what the site shows. Log the
     pages whose regenerated code differs from the stored code (markers, missing
     closers, links) and move on.
  2. Materialize unexpanded `:Card:` leaf instances (the old `expandLeafInstances`
     concern).
  3. Collapse the pure aliases (container, grid, heading, dropdown).
  4. Delete `code`, `line` and `endLine`.
  5. Set `schemaVersion`.

  The migration-only DSL code moves to `src/lib/legacy/dsl.ts`, used by nothing else.
  Mark it for deletion one release after launch.
- **4.3 Delete:**
  - `page.code` from `Page` (`types/editor.ts:294`), plus `line`/`endLine` from
    `ElementNode`;
  - the Phase 1.10 mirror and `useMarkerSync.ts`;
  - `document.ts` except `slugify`;
  - from `syntax.ts`: the lexer, `reconcile`, the markers, `normalizeSyntax`, the dead
    `suggestNextLine`/`suggestCompletion`/`closeArgBracket`, and `elementBlockLines`.
    What remains is `NODE_STATE_KEYS`, `hasNodeState`/`stripNodeState` and
    `BUILTIN_LIST_SOURCES` (rename the file to `nodeState.ts`);
  - `serializeNode` and `expandComponentInstances` in `components.ts`;
  - the matching `mcp-runtime.ts` re-exports;
  - `shared/fields.js`' use of `OPEN`.
- **4.4 Fixture.** Regenerate `e2e/fixtures/project.json` through the migration (it
  shrinks by the ~4 KB of `code`). Seed `code: ''` lines in the specs that use them go.
- **4.5 Gate.** The corpus is byte-identical after migration, with the alias collapse
  included. Node identity is preserved. The full e2e suite passes.

## Phase 5 — Docs and a real session (1–2 days)
- **5.1 `CLAUDE.md`:**
  - rewrite "The core invariant" and "The DSL" as "The tree is the source of truth" and
    "The agent format (HTML)";
  - the Structure, Components, Nesting and MCP sections lose every line/reconcile/marker
    reference;
  - `README` and the tool list in `packages/guano/README.md`;
  - `BACKLOG.md` "MCP (v1 limits)".
- **5.2 `FORMS-PLAN.md`:**
  - `[+]` marker → nothing;
  - `validateDocument` → `validateTree`;
  - add `form`/`form-success`/`form-error` to the HTML table (`<form data-form>`…).
- **5.3 Dogfood.** One Claude Desktop session builds a landing page and a collection
  template from scratch through `guano mcp`. Count the calls and compare the session
  with the Cocoapp report. That report addressed about 110 edits by line arithmetic,
  and the expectation is that a filled page takes about 3 calls. Note friction in
  `BACKLOG.md`.

---

## Size, order, risks

| Phase | Days |
|---|---|
| 0 Corpus + identity snapshot | 0.5 |
| 1 Editor tree-native | 4–5 |
| 2 HTML layer | 3 |
| 3 MCP + guide + e2e | 4–5 |
| 4 Migration + deletion | 2–3 |
| 5 Docs + dogfood | 1–2 |
| **Total** | **~3 weeks** |

**Risks and their guards:**
- **Lost node identity on agent writes.** That's the reason `reconcile` existed. Guards:
  `data-id` echo, then ref, then tree LCS, plus the round-trip property test.
- **Render drift from the alias collapse or from the instance realign.** Guard: the
  corpus is byte-identical.
- **Merge bases left on the old schema.** Guard: boot migration covers `guano-base:*`.
- **MCP budget.** Guard: removals must pay for additions; it's measured in 3.6.
- **Models writing loose HTML** (unquoted attributes, `<br>` without a slash, `<Card>`
  lowercased by a habit). Guard: lenient on void tags; clear `line:col` errors for the
  rest. Lowercase `<card>` resolves to `Card` when it's unambiguous, with a note.
