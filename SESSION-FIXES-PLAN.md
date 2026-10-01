# Session fixes plan — Cocoapp MCP session report

Source: the agent-written report `cocoapp-session-report.txt` from the Cocoapp prototype
session (Claude Desktop → `guano mcp` → `npm run serve` on :4174, draft target). Every
claim below was re-verified against the code on 2026-09-30; line numbers are from that
day's tree (branch `feat/complex-components`) and may drift by a few lines.

Report item numbers (4.x failures, 5.x friction, 6.x guide, 8.x recommendations) are
cited as `[R 4.6]` so the executor can go back to the report's evidence.

## Ground rules for the executor

- Gates (see CLAUDE.md "Commands"): `npm run type-check`, `npm run check:catalog` after
  any catalog change, `npm run build` + `npm run test:e2e` before each phase commit.
  Headless checks of `src/lib/*` go through a throwaway `.tmp-test.ts`.
- Committed build artifacts must be rebuilt when their source changes:
  `npm run build:slider` (slider.js), `npm run build:motion` (motion.js),
  `npm run build:mcp-runtime` (anything re-exported from `src/lib` into the MCP bundle,
  e.g. `styles.ts`, `syntax.ts`, `components.ts`, `interactionKeys.js`).
- The three renderers must stay in step: `useRenderNode.ts` (canvas + Preview),
  `server/export.mjs` (published site), and the MCP validators. Any key/scope change
  lands in all of them in the same commit.
- `GUIDE.md` and `CLAUDE.md` are updated in the same commit as the behaviour they
  describe. Phase 6 lists the guide edits; do not defer them.
- One commit per numbered item (or per tightly coupled pair). Do not touch
  `server/data/` — the draft from the session is kept as a regression fixture source
  (see Phase 1.1 test).
- Order: Phase 1 → 2 → 3 → 6 are fixes and must all land. Phase 4 (features) and
  Phase 5 (preview route, part addressing) are larger; do them after, in the order
  given, and stop to report if a design question in them turns out to need the owner.

---

## Phase 1 — Renderer / runtime / validator bugs

### 1.1 A binding inside a repeat cannot reach a target outside it  [R 4.6, 6.1, 8.C.1]  **highest priority**

**Confirmed.** `server/export.mjs:545-558`: `keyScope` is built from the TRIGGER's
render context (`mapping.instanceId` + `e<entryId>` when `ctx.scope.entry` is set), and
`stateKeyFor(i, ownerId)` applies that same scope to the state key on both the trigger
side (`data-int` `s:`) and the target side (`data-tgt`). A target that lives outside the
`:collection-list` (a shared sheet under `:body`) renders with no entry scope, so the
trigger writes `X@e<id>` and the target listens on `X`. `server/site-runtime.js:69-91`
matches keys by exact string, so the effect never fires. The canvas has the identical
logic in `useRenderNode.ts:464-469` (`motionScope`) → `applyBinding(..., motionScope)`.
The GUIDE's recipe at `GUIDE.md:644` ("ONE overlay per kind, outside the list") is
therefore unachievable today.

**Fix: scope the state key by where the TARGET lives, not where the trigger fires.**

1. Pre-pass per page in `export.mjs`: extend `buildPlainTargets` (`export.mjs:222-241`,
   which already walks the page and pulled-in collection-item templates) to also build
   `ctx.repeatOf: Map<nodeId, repeatRootId | null>` — for every node, the nearest
   enclosing `:collection-list` or bound `:slider` (an `arg`-carrying slider), or null.
2. In the attribute builder (`export.mjs:545-558`), compute the scope for a binding as:
   - `instance` part: unchanged (`mapping.instanceId`).
   - `entry` part: include `e<entryId>` ONLY if the resolved target node
     (`i.targetId ?? selfId`) is inside the SAME repeat as the current render
     (`ctx.repeatOf.get(targetId) === currentRepeatRootId`, where the current repeat root
     is carried on `ctx.scope`, add `scope.repeatRootId` where `scope.entry` is set at
     `export.mjs:748`, `:787`). A target outside any repeat, or in a different repeat,
     gets NO entry part.
   - Apply the same rule on the target side: a node inside a repeat that is targeted
     from outside it keeps the entry scope for triggers inside the repeat only; so the
     target's `data-tgt` must list BOTH keys when triggers exist on both sides. Simplest
     correct rule: the target's key set is the union of the keys each targeting binding
     computes under the rule above (iterate `targets` and compute each binding's scope
     from ITS owner's repeat, which needs `repeatOf(owner.id)`; owner id is available
     since `plainTargets` stores the binding objects — add `ownerId` to what
     `buildPlainTargets` stores).
3. `useRenderNode.ts`: mirror it. `motionScope` (`:464-469`) becomes a function of the
   target: add a `repeatOf` index to `useInteraction` (it owns `targetStateKeys` /
   `scopedTargetStateKeys`, `useInteraction.ts:188-251`) built from the page tree the
   same way, and compute the entry part per binding with the same rule. Also
   `useMasterBindings.ts` where scoped keys are produced for instances.
4. Exclusive groups (`interactionGroupKey`, instance scope only) are unaffected. Appear
   `once` bindings on list rows must keep the per-entry scope (the comment at
   `export.mjs:542-545` explains why) — they target themselves, which is inside the
   repeat, so the rule preserves them.
5. `site-runtime.js` needs no change (it only compares strings).
6. Document the rule in `GUIDE.md` near `:644` and in CLAUDE.md "Rendering".

**Tests.** Add to `e2e/export-interactions.spec.ts` (or the spec that checks exported
HTML for interactions): a page with `:collection-list[x]` whose row button binds
`action:"on"` to a sheet outside the list; assert the row button's `data-int` state key
equals a key listed in the sheet's `data-tgt`. Add a second case: row button targeting
a sibling inside the same row keeps the `@e<id>` scope (regression for "hover one
lights them all").

### 1.2 Slider `perView` breakpoint override is exclusive on the site, inclusive on the canvas  [R 4.7, 6.2, 8.C.2]

**Confirmed.** `src/lib/shared/slider.js:212` emits `max-[${bp.width}px]:[--sl-pv:n]`;
Tailwind v4 compiles `max-[768px]` to `width < 768px`. `perViewForWidth`
(`slider.js:171-177`) uses `width <= bp.width`, and the canvas renders each breakpoint
frame at exactly `bp.width`, so the frame shows the override and the site at that width
does not. The interaction runtime's own `computeBp` (`site-runtime.js:52`) is `<=`, so
inclusive is the project-wide convention; the slider CSS is the odd one out.

**Fix.** Emit `max-[${bp.width + 0.02}px]:` (a sub-pixel margin makes `<` behave as
`<=` for integer viewports; comment why). `sliderCandidateClasses` (`slider.js:250`)
must register the new strings. Rebuild with `npm run build:slider`. Extend
`e2e/export-sliders.spec.ts` to assert the compiled CSS contains the `.02px` query and,
in a page at exactly the Tablet width, `--sl-pv` resolves to the override.

### 1.3 Slider dots are hard-coded white and overlap the slides  [R 4.8, 6.11, 8.C.2]

**Confirmed.** `slider.js:229-234`: `SLIDER_DOT_CLASSES` = base + `bg-white/50`,
active = base + `bg-white`; `SLIDER_DOTS_CLASSES` (`:220-226`) positions the dots
`absolute bottom-3 …` over the track.

**Fix.** Dots use `bg-current` (inactive `opacity-40`, active `opacity-100`), so the
host's `text-*` class colours them; keep `role="tab"`/`aria-selected` as the hook. Move
the dots container out of the overlay: render it as a static flex row below the track
(`mt-3 flex justify-center gap-1.5`) instead of `absolute bottom-3`. Keep arrows as is
(they are deliberately overlays) but document it. Update `sliderCandidateClasses`,
rebuild, update the slider e2e assertions and `GUIDE.md` Sliders section (state the
colouring hook: "dots take the host's text colour").

### 1.4 Class validator rejects ordinary Tailwind  [R 4.2, 4.3, 6.14, 8.C.9]

**Confirmed.** `src/lib/styles.ts:202-207` adds signed numeric offsets and `-auto`, but
no `top-full`/`inset-x-1/2` family; `line-clamp` is absent from `styles.ts` and
`styleCatalog.ts`.

**Fix** in the accepted-set builder (`styles.ts:174-317`):
- For prefixes `top right bottom left inset inset-x inset-y`: add `-full`, `-1/2`,
  `-1/3`, `-2/3`, `-1/4`, `-3/4` and their negatives.
- Add `line-clamp-1…6` and `line-clamp-none`; give `applyClass` a property group so two
  clamps replace each other (follow how `truncate` is grouped, if it is).
- Rebuild the MCP runtime bundle. Headless test via `.tmp-test.ts`: `isValidClass` on
  the new tokens and `applyClass` replacement.

### 1.5 `load-animation-moves-layout` fires on stagger-only timelines  [R 4.4, 6.5, 8.C.4]

**Confirmed.** `packages/guano/mcp/tools.mjs:2555-2557` `transformsLayout` looks at
every track regardless of stagger; `src/lib/shared/motion.js:236-254`
(`splitByStagger`) shows staggered tracks move the CHILDREN, not the container.

**Fix.** `transformsLayout` ignores tracks with `stagger > 0` (use the compiled form or
check `t.stagger`/the step's stagger, whichever the data model carries — read
`compileAnimation` to see where stagger lives). Add a unit-style check in the
`mcp-tools-security`/components spec style (in-process) that a staggered x/y animation
on a 12+ child grid produces no warning and a non-staggered one still does. Reconcile
the GUIDE text at `GUIDE.md:1451-1452` with the Design standards sentence.

### 1.6 Library entries ship demo attributes and raw rgba  [R 4.9, 6.7, 8.C.10]

- `src/lib/catalog/entries/forms.ts:54`: Input `attributes` → `{ type: 'text' }`
  (no placeholder, no name). Check the other form entries for the same demo strings
  (`forms.ts:121` is inside a composite form and may keep its placeholder; decide per
  entry: a standalone primitive ships no copy, a composite example may).
- `src/lib/catalog/entries/interactive.ts:32`: `OVERLAY` → `absolute inset-0 bg-black/50`
  (or `bg-foreground/50` if the token exists in every entry's declared tokens; confirm
  `isValidClass` accepts the chosen one).
- Sheet (`interactive.ts:277-324`) and the `modal()` helper (`:154`) toggle
  `hidden`→`block`, which cannot animate. Rework Sheet to the two-effect recipe:
  wrapper `invisible opacity-0 transition-opacity` ↔ `visible opacity-100`, panel
  `translate-x-full transition-transform` ↔ `translate-x-0`. Every trigger carries both
  bindings. This is the recipe Phase 6 adds to the GUIDE, so the library and the guide
  agree. Run `check:catalog`; update `e2e/export-library.spec.ts` if it asserts the sheet
  markup.

---

## Phase 2 — MCP tools (packages/guano/mcp/tools.mjs unless stated)

### 2.1 `get_guide` and the initialize instructions  [R 4.1, 6.4, 8.A.11]

**Confirmed.** `tools.mjs:2751-2795`; bare call returns the whole 101 KB guide;
description says "~55 KB"; `server.mjs:61` sends the whole guide as `instructions`.

**Fix.**
- Bare `get_guide {}` returns `{toc, goldenRules}` (the section list with byte sizes,
  plus the "The golden rules" section body, ~4 KB) and a one-line hint to fetch sections.
  `section: "all"` returns the full text for clients that can take it.
- Description: compute `Math.round(GUIDE.length / 1024)` at module load and lead with
  the section workflow.
- `server.mjs:61`: `instructions` = golden rules + workflow recipe sections (~13 KB,
  slice by `## ` heading at load) ending with "call get_guide {section:'toc'} before
  building". Update CLAUDE.md "MCP server" (it says the guide is served as
  instructions verbatim).
- Tests: `mcp-tools-security.spec.ts` style in-process call asserting bare response
  size < 8 KB and that `section:"all"` still returns the hash header.

### 2.2 `add_library_components {includeNodes}` omits attributes  [R 4.9, 8.A.4]

**Confirmed.** `masterNodeRows` (`tools.mjs:1879-1899`) lacks `attributes`, `link`,
`src`, `listQuery`, `slider`; the `list_components` rows (`:3764-3809`) include them.

**Fix.** Make `list_components` use `masterNodeRows` and extend `masterNodeRows` with
the missing fields (`attributes`, `link`, `src`, `background`, `htmlId`, `listQuery`,
`slider`, `entryId`) plus an `includeBindings` flag that swaps `interactionCount` for
the full `interactions`/`animations` arrays (list_components passes true). One row
shape everywhere (also `create_component`'s response at `:3916`).

### 2.3 Translation worklist strings are not fenced  [R 6.3, 8.B.9]

**Confirmed.** `tools.mjs:5689`, `:5715`, `:5743` emit bare `base`/`override`; the
`fenceValue` helper is at `:339`; the comment at `:5786-5788` chose a batch note.

**Decision: keep the batch note AND fence per item.** Wrap `base` and `override` with
`fenceValue` (the guide's rule at `GUIDE.md:1648` then holds). `set_translations` must
accept both fenced and bare `text` on the way back in (agents echo what they read).
Measure the size increase on the e2e fixture; if it is more than ~25 %, shorten the
fence to `{u:1, text}` and document it in the Untrusted section instead.

### 2.4 `get_page` omits `diagnostics` when clean  [R 6.16, 8.A.9]

`tools.mjs:3268`. Always emit `diagnostics: []`. Check `summaryOnly` and
`elements:"none"` paths too, and that nothing in the `version` contract hashes the
response shape.

### 2.5 `update_settings` tokens are replace-only  [R 5.5, 8.A.5]

`tools.mjs:4902-4939` (tokens, replace) vs `:4829-4900` (`addLocales`/`removeLocales`,
additive, with a `forcePurge` guard). Add `addTokens: [{name,value}]` (upsert by name,
keep ids) and `removeTokens: [name]` (refuse if any page/component class references the
token — reuse the token-usage scan `designWarnings` or `ensureTokens` logic has — unless
`forcePurge: true`). Keep `tokens` as the full-replace form; description says prefer
add/remove. Response: only the changed tokens, not the whole settings echo.

### 2.6 `create_interactions` batch  [R 5.6, 8.A.6]

Mirror `create_animations` (`tools.mjs:6156-6207`): validate each item, one push, one
save, `{created, failures}`. Keep `create_interaction`.

### 2.7 `create_component` / `create_components` accept `ref`  [R 5.4, 8.A.7]

`tools.mjs:3857-3879` and `:3940-3953`: add `ref` as an alternative to `id` (resolve
via `findNode` on the page's elements by `node.ref`; refuse if both given or neither
found). Extraction response should include `nodes: masterNodeRows(...)` like the code
path does (`:3916`), so the agent gets part ids without a second call.

### 2.8 `upsert_entries` reference fields: resolve slugs, validate ids  [R 5.7, 8.A.8]

`tools.mjs:2281-2307`: reference values are stored as whatever string arrives. For
`reference` / `multi-reference`: resolve each value against the referenced collection's
entries by `id`, then by `slug`; refuse the item (per-item failure, not the batch) when
neither matches. Document "slug or id" in the schema description and the GUIDE's
Content section.

### 2.9 `list_icons {names}`  [R 8.A.13]

`tools.mjs:2719-2744`: add optional `names: string[]` → `{known, unknown}` in one call.
`query` stays.

### 2.10 `set_page_code` reparent: opt-in state carry  [R 4.10, 8.A.12]

`tools.mjs:3395-3428`: the guard is unconditional. Add `adoptReparented: true`:
only for a reparented node whose own line text is byte-identical to its old line AND
whose type matches, adopt the old node (state included). Everything else stays
guarded. Response keeps reporting `reparented` with an `adopted: true` flag per entry.
This is the "I wrapped it in a div" case; document the limit (one identical line, not
a moved block).

### 2.11 `edit_elements` quiet mode  [R 5.10, 8.A.10]

Already exists: `verbose` (`tools.mjs:5588-5589`) toggles `bound` vs `results`. No
code change; GUIDE Workflow section gets one sentence saying `bound` ids are the
handles for `unbindInteractionIds` and to keep them.

### 2.12 `set_breakpoints` tool  [R 8.C.12]

No breakpoint tool exists (grep confirmed). Add `update_settings {breakpoints: [{id?,
name, width}]}`: replace-by-id, mint ids for new ones, refuse removing a breakpoint
that any binding's `breakpoints` array or any slider `perView` references (list the
users). Widths must stay strictly descending after sort; the widest is the base (see
`slider.js:140`).

---

## Phase 3 — Publish design checks (`designWarnings`, tools.mjs:2455-2634)  [R 7.2, 8.C.3]

Add kinds, each a warning, never a refusal, with `where` and a one-paragraph fix:

- `binding-target-unreachable`: a binding whose target resolves to no node on the
  route, or to a node in a different repeat than the trigger (after 1.1, "outside any
  repeat" is fine; "in another repeat" is not). Build on the `repeatOf` index from 1.1.
- `interactive-inside-link`: a `button`, `a`, `input`, `select`, `textarea` rendered
  under a node with `link`. Use the same walk as `native-select` (`:2495`).
- `untranslated-attributes`: when `locales.length > 1`, any `placeholder` /
  `aria-label` / `alt` attribute with no locale override (after Phase 4.5 lands; until
  then warn that these attributes are not localizable).
- `heavy-repeat`: a `:collection-list`/bound `:slider` whose item subtree exceeds
  N=40 nodes AND whose list renders more than 8 entries (threshold constants at the
  top of the function, named).
- `route-size`: any route over 300 KB of HTML (measured on the export result; the
  publish handler has the stats).
- Drop nothing existing. `unused-effects` stays.

Add an in-process spec case per new kind in the components/security spec style.

---

## Phase 4 — Data-driven presentation (features; each needs the three renderers)

These are the report's 8.C.5–8.C.8 and 6.9/6.10 asks. They are real features: do them
after Phases 1–3 and 6, one commit each, and update CLAUDE.md "Collections" for each.

### 4.1 Field → data attribute  [R 8.C.5]

New node state `node.dataFields: { [attrName]: fieldName }` (e.g. `{status: "status"}`),
rendered as `data-status="waiting"` from the entry scope in all three renderers.
Tailwind v4 `data-[status=waiting]:` variants then style per value (`isValidClass`
must accept `data-[…]:` prefixes — check `styles.ts` variant handling). Per-instance
inside components via `resolveInstanceValue`; `NODE_STATE_KEYS`, `captureProps`, the
`[+]` marker and `edit_elements` (`dataFields: {}`) all learn it. Data panel: a small
"Data attributes" row under the binding control.

### 4.2 Bind `value` / `placeholder` to a field  [R 8.C.5]

Extend 4.1's mechanism to `value` and `placeholder` on `input`/`textarea`/`select`:
`node.attrFields: { value: "phone" }`. Same plumbing. This is what lets an edit form
be pre-filled.

### 4.3 `listQuery` filter against the current entry  [R 8.C.7]

`listQuery.filter` gains `{ field, equalsCurrent: true }`: compare the field's value
(reference or multi-reference) with the enclosing `EntryScope`'s entry id. Resolve in
the shared list-query code (find where `listQuery` is evaluated — `src/lib/shared/`
or `useRenderNode` + `export.mjs`), the MCP validator, and the GUIDE.

### 4.4 Empty state for a list  [R 8.C.8]

A direct child `:empty` … `empty:` block (new container element in `ELEMENTS`) inside
`:collection-list`/bound `:slider` renders only when the list has no entries, and is
excluded from the repeat. Export, canvas, Preview, validator, GUIDE.

### 4.5 Per-instance and localized attributes  [R 8.C.6, 7.4]

- Per-instance: `attributes` joins the per-instance chain (`resolveInstanceValue`) for
  `type`, `placeholder`, `aria-label`, `name`, `value`; `edit_elements` on an instance
  part accepts `attributes` for those keys only (the `:Name` wrapper rule stays).
- Localized: `node.locales[code].attributes?: {placeholder, 'aria-label', alt}`;
  `useLocale` read path, `get_translation_worklist` emits them (kind `attribute`),
  `set_translations` writes them, export reads them per route locale.

---

## Phase 5 — Agent ergonomics (larger; after Phases 1–4)

### 5.1 Preview without publishing  [R 5.2, 8.A.1]  **do this one first in Phase 5**

Six of seven publishes in the session were only to look, and each one put a half-built
draft live. Export uses root-absolute URLs (`/assets/…`), so a preview cannot be served
under a sub-path without threading a base path through every emitted URL.

**Design: a second static root on its own port.**
- `POST /api/preview` (admin/editor session OR agent token; the agent's current target
  decides the project; rate-limited like publish): loads the target blob, runs
  `exportSite(project, join(DATA_DIR, 'preview'))` (`export.mjs:1231`, already atomic
  via tmp-dir swap), responds `{url, routes, bytes}`. One preview dir; last render wins;
  the response says which target it holds.
- Server listens on `PORT + 1` (`GUANO_PREVIEW_PORT` override) serving that dir with the
  same `handleStatic` branch logic (index.html / 404 fallbacks), plus
  `X-Robots-Tag: noindex` and no `/admin` branch.
- MCP tool `preview {}` → calls it, returns the URL and tells the agent to open it with
  its browser tool. `set_target` and `get_status` report the preview URL.
- Editor: the Play surface already previews; no UI needed. Mention it in CLAUDE.md
  "Publish & export".
- e2e: a spec boots the e2e server, writes a fixture, calls `/api/preview`, fetches a
  route from the preview port, asserts the published `/` is unchanged.

### 5.2 Addressing a component instance's parts  [R 5.1, 8.A.2]

Parts have no refs, and `get_page {elements:"own"}` repeats a Sidebar's 40 parts on
every page; the agent fell back to line arithmetic for ~110 edits.

- `get_page {elements: "ref-parts"}`: rows ONLY for instances that carry a `#ref`,
  each with `parts: [{part, id, type, content?, hidden?}]` where `part` is the
  address below. Everything else omitted.
- `edit_elements` address: `{ref: "dash-reports-btn", part: "span"}` or
  `part: "icon[1]"` or `part: "Badge/span"` — element type in document order within
  the instance's expanded subtree, 0-based index in brackets (default 0), `/` to step
  into a nested instance. Resolve in `resolveEditNode` (`tools.mjs:~940-970`) using the
  same expansion `get_page` uses for `parts` (`partsOf`, `:849`). Ambiguity is not an
  error: the index disambiguates.
- `bind_interaction` / `bindInteractions.targetRef` accept the same `{ref, part}` pair
  as `targetPart`.
- GUIDE: replace the "parts are only in the set_page_code response" guidance with this.

---

## Phase 6 — GUIDE.md edits  [R 6.x, 8.B]

Do these in the same commits as the behaviour; this list is the checklist.

| Line (approx.) | Change |
|---|---|
| 644 | "ONE overlay per kind, outside the list" — keep, now true after 1.1; add the scoping rule: entry scope follows the target's repeat. |
| 1591 | perView: "from that width down, inclusive" (after 1.2). |
| Sliders | Dots take the host's text colour and sit below the track; arrows overlay the slides (1.3). |
| 1648 | Untrusted: worklist strings are fenced too (2.3). |
| 390 vs 1001 | Resolve the two linked-`:div` statements: read `export.mjs` `linkWrap` and state the one truth; add "never put a button or link inside a linked container" (Phase 3 warns). |
| 1228-1237 | Keep the hidden→flex modal; add a "Sheet that slides" recipe (two effects: wrapper invisible/opacity, panel translate; every trigger binds both). Matches 1.6. |
| 1451-1452 | Stagger: "bind to the list element; a staggered step moves the children, not the container, and does not trigger the load-animation warning" (1.5). |
| Components | New paragraph: components have no slots; the shell-on-page pattern; build on a page by ref, then `create_component {pageId, ref}` (2.7); addressing parts with `part` (5.2). |
| Content | Empty bound fields render an empty element; the `empty:` / `peer-empty:` / `has-[…:empty]:` idioms; `:collection-list` renders a real wrapper that takes the classes; reference fields accept slug or id (2.8). |
| Styling | List the offset keywords and `line-clamp-*` as accepted (1.4); say that an interaction's duration/easing does NOT add a transition: add `transition-*` to the base classes (verify in `export.mjs`/`useInteraction` first; if it does add one, say so instead). |
| Workflow | `get_guide` is section-based; bare call = toc + rules (2.1). `get_page` always returns `diagnostics` (2.4). Keep `bound` ids (2.11). Interim publishes go live; use `preview` (5.1). |
| Tool gaps | Remove entries fixed above; add what remains. |
| 343-344 | Add: "so every part is addressed by `part`, never by ref" (5.2). |

Also the `get_guide` tool description (2.1) and CLAUDE.md sections named in each item.

---

## Phase 7 — The test prompt  [R 8.D]

Not code. The next run's prompt should: say Main or draft explicitly; name the field
for each listQuery tab; say "read the guide by section, starting with toc"; say which
`get_page` reads count as validation (`elements:"own"` + `diagnostics` per page); say
whether interim publishes are allowed (after 5.1: "use preview, publish once"); list
the widths to test; allow several sheet components; state the depth per feature; and
require a verification list in the final answer. A revised prompt is kept with the
session report, not in this repo.

---

## Verification matrix

| Item | Gate |
|---|---|
| 1.1 | new e2e export-interactions cases; `test:e2e` green |
| 1.2, 1.3 | `build:slider`; export-sliders spec updated |
| 1.4 | `.tmp-test.ts` on `isValidClass`/`applyClass`; `build:mcp-runtime` |
| 1.5 | in-process spec on `designWarnings` |
| 1.6 | `check:catalog`; export-library spec |
| 2.x | in-process `mcp-tools-*` spec cases, one per tool change |
| 3 | in-process spec, one case per new kind |
| 4.x | export + canvas: an `mcp-components`-style exported-HTML assertion each, plus a Data panel smoke in the entry-editor UI spec where a control was added |
| 5.1 | new e2e spec against the preview port |
| 5.2 | in-process spec: `ref-parts` rows and a `{ref, part}` edit landing on the master's node |
| 6 | read-through: every tool behaviour changed above is described once, nowhere contradicted |
