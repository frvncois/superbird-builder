# Fix plan — code review + MCP "Harbour" evaluation (2026-10-04)

Source reports: `CODE-REVIEW-REPORT.md` (F1–F26) and `MCP-REPORT.md` (E1–E40). This plan
is what to do about them, in order. It was drafted after spot-checking the load-bearing
claims against the tree; where a report's cause was a hypothesis, the plan says
"investigate first" and gives the repro to write.

**DONE** — worked through on 2026-10-05, commits `df968ee..`; see **Session notes** at
the bottom for the deviations, the two open decisions and what was found that neither
report named. Summarised in `BACKLOG.md` → "Code review + MCP evaluation run (Harbour,
2026-10-05)". The two source reports (`CODE-REVIEW-REPORT.md`, `MCP-REPORT.md`) were
never in the repo, so they are not alongside this file.

## Ground rules for the fixing session

1. **One commit per item** (or per tight group where stated). Commit message names the
   finding (`fix(merge): F3 — a draft that deletes the last effect`).
2. **Gates.** `npm run type-check` after every code change. `npm run check:html` after
   anything in `src/lib/html/` or `src/lib/shared/`. `npm run check:mcp` after any tool
   description or `inputSchema` edit — it has **126 bytes of headroom**; trim prose, never
   raise the budget. `npm run build && npm run test:e2e` at the end of each phase.
3. **`check:corpus` currently fails for environmental reasons (F15), not code.** Until
   Phase 5 fixes it, run it as
   `GUANO_DATA_DIR=$PWD/server/data.backup-ridgeline-20261004-221152 node scripts/corpus.mjs check`.
   **Never re-baseline** except for F21, where the human does it on purpose.
4. **Renderer parity.** Any change to how a node renders lands in all three renderers:
   `useRenderNode.ts`, `PreviewRenderer.vue` (via `useRenderNode`), and `server/export.mjs`.
   Shared logic goes in `src/lib/shared/*.js`. Rebuild `packages/guano/runtime/mcp-runtime.mjs`
   (`npm run build:mcp-runtime`) whenever `src/lib` code it re-exports changes, and commit it.
5. **Keep the docs in step.** Every behaviour change updates the matching sentence in
   `CLAUDE.md` and `packages/guano/mcp/GUIDE.md`. The GUIDE edits are collected in Phase 3F.
6. **Do NOT touch F26** (the auth preamble in `server/index.mjs`). The review recommends
   leaving it and the recommendation is right: the duplication is the audit trail.
7. **Stop at the first gate failure** and leave a note in this file under "Session notes"
   rather than working around it.
8. **Decisions marked [DECISION] are the human's.** Do everything that does not depend on the answer,
   state the assumption you took for the rest, and list the open ones at the end.

---

## Phase 0 — protect the tree (do first, ~10 minutes)

### 0.1 Commit the in-flight batch
The working tree holds the uncommitted effects-drawer rework (`EffectsDrawer`, `TriggerEditor`,
`ActionOptions`, deleted `StateCard.vue` / `useEmptyHint.ts`, `nodeState.ts`, `editor.ts`,
`GUIDE.md`, `CLAUDE.md`, the runtime bundle, `ui-interactions-panel.spec.ts`). Both reports
reviewed this state. Run `type-check` + `check:html` + `check:mcp`, then commit it as its own
commit so every fix below is diffable on its own. Do **not** `git add -A` — see 0.2.

### 0.2 F2 + F24 — `.gitignore`
`.gitignore:43` has `server/data-backup-*` (hyphen); the directory on disk is
`server/data.backup-ridgeline-20261004-221152` (dot) and holds `publish.json` (GitHub token,
Stripe key, SMTP password, site-password hash), `users.json`, `api-tokens.json`,
`sessions.json`. Add `server/data.backup-*` (or `server/data[-.]*`) and `.tmp-test.ts` /
`*.tmp-test.ts`. Verify:
`git check-ignore -v server/data.backup-ridgeline-20261004-221152/users.json`.
Do **not** delete the backup dir yet — it is the only media copy the corpus baseline needs (F15).

### 0.3 Untracked reports
`CODE-REVIEW-PROMPT.md`, `CODE-REVIEW-REPORT.md`, `MCP-REPORT.md` — commit them under
`docs/reviews/2026-10-04/` (they are the provenance for every commit in this plan).

---

## Phase 1 — release blockers (the product does not work or loses data)

### 1.1 F1 — the npm tarball's server cannot start
`packages/guano/scripts/prepack.mjs:42`: the `readdir(server)` loop is non-recursive and
filters on filename, so `server/public/` (five modules `index.mjs` imports) never ships.
Fix: after the loop,
`await cp(join(REPO,'server','public'), join(PKG,'server','public'), { recursive: true })`.
Also copy `LICENSE-EXCEPTIONS.md` into the package here so F4 cannot recur.
Gate: `cd packages/guano && npm pack`, extract to a scratch dir, boot
`node server/index.mjs` with a throwaway `GUANO_DATA_DIR`, confirm it listens. Then run the
e2e suite against it via `GUANO_E2E_SERVER=<extracted>/server/index.mjs` if the harness
supports it (check `e2e/` for the env var; if it does not exist, booting it is enough).

### 1.2 F3 — a draft that deletes the last effect is silently reverted
`src/lib/merge.ts:245`: `...(effects.merged.length ? { effects: effects.merged } : {})` lets
`mine.effects` survive the `...mine` spread when the branch deleted every effect. Fix:
`effects: effects.merged,` unconditionally, then before `return`:
`if (!merged.effects?.length) delete merged.effects` (keeps an untouched project byte-identical).
**Add coverage** — the 3-way merge has no e2e spec at all. Add `e2e/store-drafts.spec.ts`
(name sorts after `smoke`): create draft, delete the only effect in the draft, apply to Main,
assert Main has no effect; plus a control case (branch adds an effect, Main untouched).
Exercise `computeMerge` headlessly in the spec via the runtime bundle or import from `src/lib`.

### 1.3 F5 — `set_translations` refuses a short `data-id`
`packages/guano/mcp/tools.mjs:6922, :6929, :6961` call `findNode(roots, item.id)` raw. Wrap
each with `fullNodeId(roots, item.id)` exactly as `resolveEditNode` (`:1153`) does. Add the
short-id case to `e2e/mcp-tool-contracts.spec.ts`. No schema text changes.

### 1.4 F4 + F11 — licence copies and README
`cp LICENSE-EXCEPTIONS.md packages/guano/ packages/create-guano/` (the package copies omit the
slider runtime). README: delete "(or start from the bundled library)" at `README.md:4`; add
`assets/slider.js` to the MIT paragraph. Leave the `npm create guano` line (BACKLOG day-of).

### 1.5 F20 — `guano build` exports an unmigrated blob
`packages/guano/bin/guano.js:52-59` hands the raw store blob to `exportSite`. Import
`migrateProject` (and `describeMigration` if exported) from `runtime/mcp-runtime.mjs`, run it
first, log the summary when anything changed. Gate: `npm run build:mcp-runtime`, then run
`guano build` against a copy of a v1 fixture (one with a `:Card:` leaf — `scripts/check-migrate.ts`
builds one; reuse its builder).

### 1.6 F21 — built runtimes ship with no licence line [DECISION]
Add `build.rollupOptions.output.banner = '/* SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md */'`
to `vite.motion.config.ts` and `vite.slider.config.ts`; `npm run build:motion && npm run build:slider`.
This legitimately changes `/assets/motion.js` and `/assets/slider.js` bytes, so the corpus
baseline moves. **Do the code change; leave the `node scripts/corpus.mjs save` to the human**
after they confirm the only diff is the banner line (`check` output should list exactly those
two files per project).

Phase gate: `npm run build && npm run test:e2e`.

---

## Phase 2 — MCP writes that report success and render nowhere

This is the bug class `e2e/mcp-components.spec.ts` exists to guard, and the Harbour run found
five more. Each fix gets an in-process spec on the `e2e/fixtures/mcpSession.ts` harness that
asserts against the **exported HTML**.

### 2.1 E3 / E38 / E5 — a host's `link` on a nested instance is stored and never rendered
Confirmed in code: `src/lib/componentOps.ts:171` `MIRROR_KEYS` is
`content src svg background locales hidden variants` — no `link`. `useRenderNode.ts:462`
reads `node.link ?? mapping.master.link` and `export.mjs:434` does the same, so the mirror layer
is skipped. CLAUDE.md already says `link` is "per-instance with a component default", so the
architecture wants it rendered, not refused.
Fix:
- Add `link` to `MIRROR_KEYS` and wherever `createMirror` / `alignMirrors` copy host-level state.
- Resolve `link` along the chain with `resolveInstanceValue` (own → mirrors → master) in BOTH
  `linkRaw` (`useRenderNode`) and `resolveHref` (`export.mjs`). Check `adoptCodeOwned`'s
  "delete an instance link only when it EQUALS the master's" still holds against the chain,
  not the master alone (same shape as `setInstancePick`).
- `list_components {includeNodes}` already echoes the mirror link; make sure the `in:` row
  shows it as the host's.
Spec: ProjectRow holds Button; host sets `link: "@item"` on the mirror; export of a list page
shows per-row `href` on the button. Second case: NavItem mirror with `/nav-b`.

### 2.2 E4 / E5 — detach and delete drop `link`
`componentOps.ts:214 bakeMasterState` copies `content`, `src`, `background`, `locales` and not
`link`; the nested `bake` at `:427` likewise. Add `link` (and audit for `svg`, `htmlId`,
`fieldAttrs`, `instanceAttributes`, `slider`, `listQuery`, `entryId` — anything
`resolveInstanceValue` resolves must be baked to its resolved value on detach). Then make
`detach_instance` / `delete_component {detach}` **report** anything it cannot keep, and fix the
delete-in-use message that prints `":Badge:"` and does not say detach also strips the inner
component out of the hosts' masters.
Spec: build the E5 shape (sidebar with 9 NavItem links → `create_components` → `delete_component
{detach}`), assert all 9 hrefs and the `data-ref`s survive. The ref loss is a separate check:
`stripExtractedInstanceState` / `hoist` must not drop refs the page still needs — investigate
whether the refs were inside the extracted block (then they are correctly removed and the tool
should SAY so) or on it.

### 2.3 E2 — `edit_structure` inside a `collection-list` template drops a `<div>` and hoists its children
Cause unknown. **Reproduce first**: a page with `<collection-list source="project">` whose
template is `<div data-ref="row-wrap"><ProjectRow/><Button/></div>`; `edit_structure insert` a
`<div>` wrapping the Button, and a `replace` of `row-wrap` with the same markup plus an inner
div. Read back with `get_page {mode:"structure"}`. Suspects, in order: (a) `applyHtml`'s
tree-LCS adopting around an instance sibling and pairing the new div's children to the old
positions; (b) a `wrapIn`/`canDropIn` rule for list templates in `treeOps.ts` returning false
and the batch not surfacing it; (c) the "a batch is applied to a COPY" path swallowing a refusal.
Whichever it is: **`saved: true` with no `refused` while a node is missing is the bug**, so the
fix includes a post-apply assertion in `edit_structure` that every inserted/replaced node id is
present in the result tree, failing the whole batch otherwise. Also make `wrap`'s
`could not build the wrapper` (`tools.mjs:2663`) say which check failed.

### 2.4 E1 — short `targetId` refused on the `componentId` path
`tools.mjs:1205 / :1282` region: the master-branch binding resolver calls
`findNode([masterDef.root], target)` without `fullNodeId`. Resolve it, and reword the refusal
(`must be another element of Sheet` was false; it also pointed at `list_components`).

### 2.5 E16 — `edit_elements {componentId}` returns no `version`
Every component write must return `version: componentVersion(project, def)` (the pattern at
`:4521`, `:5141`). Audit all writes that can touch a master: `edit_elements` (component and
page-job-with-master-id paths), `bind_interaction` / `unbind_interaction` on a master,
`set_component_variants`, `update_component {name,category}`.

### 2.6 E10 / E9 / E36 / E11 — silent data-binding no-ops → refusals or warnings
- E10: `listQuery.filter.equalsCurrent` on a non-`reference`/`multi-reference` field →
  **refuse** at `edit_elements` (field catalog is `lib/collectionFields.ts`). Also log in BACKLOG
  that `equalsCurrentField` is the feature the agent actually wanted (already there).
- E9: `<collection-list source="owner">` where `owner` is a single `reference` → the diagnostic
  exists (`Unknown collection`) but `preview`/`publish` don't warn. Make `designWarnings` include
  any `validateTree` issue on a published route. Add to GUIDE: how to render a single reference
  (a `collection-item` bound to the field, or a bound `[owner.name]` if that exists — check).
- E36: `data-field="title"` where the collection has no `title` → `validateTree` issue
  (`unknown field`), surfaced by `get_page` diagnostics and publish warnings. Same for
  `fieldAttrs` → unknown field (E35: `data-bind-alt="name"` inside a `multi-image` list — the
  scope is the image, not the entry; warn that the field is not in scope).
- E11: "N control(s) have no usable name" counted **hidden** parts. In `tools.mjs:3505-3540`
  `collectFormFields`, skip nodes `isNodeHidden` along the chain (the export doesn't emit them),
  mirroring `buildFormManifest` in `export.mjs`. Spec: Field component with a hidden textarea
  part, enabled form, publish → zero warnings.

### 2.7 E18 / E19 / E20 — reads that return nothing or everything
- E18: `get_page {ref|id}` subtree returns `elements: []`. The code at `tools.mjs:1016-1024`
  looks right, so reproduce: likely `opts.subtree` is not being passed from the handler for the
  `ref` path, or `visit` is called with `inInstance=true` for a ref'd instance wrapper and skips
  everything. Fix + spec covering `id`, `ref`, and `elements:"ref-parts"` on a subtree.
- E19: `elementIds` given a ref → `elements: []` silently. Either accept refs (resolve via
  `fullNodeId` then `ref`) or return `unknownIds: [...]`. Do the former; it costs no schema text.
- E20: `edit_structure`'s default `elements` is documented as scoped to the ops and returns the
  whole page. Scope it to the touched nodes' subtrees + their refs.

### 2.8 E24 — partial-refuse semantics
`set_page_html` with a duplicate `data-id`: `refused` entry **and** top-level `saved: true`.
Decide one rule and apply it everywhere: `saved` is `true` only if the write landed in full;
otherwise `saved: false` with `refused`. Check the GUIDE's description of `saved` and align.

Phase gate: `npm run build && npm run test:e2e`, `check:mcp`.

---

## Phase 3 — MCP correctness and ergonomics

### 3A E6 — `position` is not an interaction conflict group
`src/lib/shared/interactionClasses.js`: no `static|relative|absolute|fixed|sticky` group, so a
fired `fixed` sat beside base `sticky` and lost by stylesheet order. Add the group and **audit
the table against Tailwind's property families**: `display` (present), `position`, `visibility`,
`overflow`, `pointer-events`, `inset-*` sides, `translate/scale/rotate`, `opacity`, `z-*`,
`flex-direction`, `items/justify`, `w/h/min/max`. Shared file → all three renderers +
`site-runtime.js` pick it up; `check:html`, then the interactions e2e spec, plus a case for
`sticky → fixed`.

### 3B E7 — valid Tailwind v4 variants refused
`src/lib/styles.ts:475 isKnownVariant`: `max-[Npx]` passes but **named** `max-sm` / `max-md` /
`max-lg` / `max-xl` / `max-2xl` and the project's **breakpoint-derived** `max-<id>` do not; nor
does stacking a named max variant before an arbitrary one (`max-sm:[&>span]:sr-only`). Add
`^max-(sm|md|lg|xl|2xl)$` and whatever `breakpointMinVariant` emits for the project's own
breakpoints. Fix `unknownClassHint` (`:888-911`) so when the **variant** is the unknown part it
says so instead of suggesting a different base class ("did you mean max-sm:overflow-hidden").

### 3C E8 — the shared-overlay pattern has no path from a row component [DECISION]
The refusal (`tools.mjs:1282`) is correct under the model: a binding inside an instance lives
on the shared master, and a page node id is one page's. Two deliverables now, one decision later:
1. Reword the refusal to name the working pattern: *"wrap the instance in a page-owned `<div
   class="contents">` and bind from the wrapper"* — the agent found this itself, at a cost of
   nine calls.
2. Fix `design-standards` in GUIDE.md so "bind the row's trigger to the shared overlay" is
   stated for plain rows and gives the wrapper recipe for component rows.
3. [DECISION] Whether to support **per-instance binding overrides on the page wrapper** (a binding
   stored on the instance node, scoped by the TARGET like everything else, so a row component's
   button can open one shared sheet). It fits the "scope is decided by the target" rule but is a
   feature, not a fix. Default: BACKLOG it under Interactions.

### 3D E12 / E13 — the translation counter disagrees with the guide
`tools.mjs:6788`: `missingTranslatable = all.filter(i => !i.override && !i.looksStructural)`
counts `shadowedByAll` masters the guide says to skip. Exclude items with `shadowedByAll: true`
(or where every instance shadows it) from the counter. E13: add page `seo.title` /
`seo.description` to the worklist as `kind: "seo"` items, written by `set_translations` through
the same path `set_page_seo {locale}` uses. Worklist cost: add `outputPath` (confined by
`GUANO_MCP_FILE_ROOT` like the other path args) so a 45 KB worklist can be written to disk and
fed back as `itemsPath`.

### 3E E14 — dead internal links on slug change and at publish
`update_page {slug}`: scan every page/master for `link` equal to the old path (and locale
variants) and return `linksToOldSlug: [{pageId, id, ref}]`; offer `rewriteLinks: true` to
rewrite them. `designWarnings` at `preview`/`publish`: every internal `href` that resolves to no
exported route (reuse `resolveHref`'s route table). Spec in `e2e/mcp-publish-warnings.spec.ts`.

### 3F GUIDE.md corrections (one commit; run `check:mcp` — GUIDE text is not in the budget, but
confirm)
- `page-html`: `<svg data-icon="mail" />` reads as a write form but is refused on
  `create_component` while `set_page_html` accepts the echoed `lucide:…`/`custom` form (E21).
  **Make both writers accept `data-icon="<lucide-name>"`** (load the lucide table lazily, as the
  tools already do) and say so; that is the cheaper fix than a guide caveat.
- `page-html`: "Structural containers are not parts" — `link` IS a part (`isInstancePart`). Say
  which containers are parts and why. E37: decide whether `<button>` should be a part. It takes
  per-placement `type="submit"` via `instanceAttributes`, so **yes** — add `button` to
  `isInstancePart` with the same justification as `link`/`textarea`/`select`, and spec it.
- `content-media-data`: remove "There are no per-instance attribute overrides" (contradicts the
  `instanceAttributes` paragraph in the same section); fix "where `role` and `type` stay shared"
  (E22 shows per-placement `type` works and should — a Button serving submit and reset is the
  whole point); fix "Every value is a STRING" to exempt `multi-image` / `multi-reference`
  arrays; fix the `shadowedByAll` advice to match 3D; say SEO is in the worklist (after 3D).
- `content-media-data` is 23 KB. Split into `content`, `media`, `data` sections; keep the old
  slug resolving (the fuzzy slug match the report praised is undocumented — document it).
- `components`: `delete_component {detach}` / `detach_instance` "same look, same text" → after
  2.2, say links and every resolved per-instance value are kept, and what is reported if not.
- `design-standards`: the shared-overlay recipe (3C.2).
- Add: rendering a single `reference`; filtering by "same value as the current entry" is not
  expressible yet (point at BACKLOG); no date/number formatting yet (E28) — state it plainly;
  verifying `click`/`scrolled` needs real input events (E33).
- `delete_component` in-use message: name the hosts and say detach strips the inner component
  out of their masters (2.2).

### 3G Cost / noise (small, each its own commit, each must pass `check:mcp`)
- `list_components {fields: ["id","name","instances"]}` or a `names: true` mode (22 KB for 12).
- `update_settings` echoes the whole settings object; return only the changed keys.
- `verbose: true` prints each failure twice (`failures` and `results`); drop one.
- "Style panel has no control" warnings repeat per class; collapse to one warning listing the
  classes.
- `kept: 2` on a pure insert into an empty slot — find what was counted and make `kept` mean
  "adopted existing node".
- `edit_structure`: a `replaceChildren` op (the slot-default-child case cost two 9 KB reads).

### 3H Small confirmations
- E15: POST invalid `email`/`role` to the form endpoint returns `ok:true`. Check
  `server/public/forms.mjs`: the manifest validates the field **allowlist**, not types/options.
  [DECISION] Decide whether to validate `type=email` and `select` options server-side (recommended:
  yes for options since they are in the manifest; email format stays the browser's). Document
  the current behaviour in GUIDE either way.
- E40: a collection field named `slug` — reserve it (and `id`, `name`, `status`, `locales`,
  `values` — whatever `Entry` already uses) in `lib/collectionFields.ts`.
- E17: version unchanged on binding writes is **by design** (CLAUDE.md). No change; one
  sentence in GUIDE so the next agent does not file it.
- MCP report §9: a form collecting a `password` field raised no warning. Add a `designWarnings`
  entry at `preview`/`publish` when an enabled form has a control with `type="password"` or a
  name matching `password|passwd|pwd` (submissions are stored in plain JSONL).

Phase gate: `npm run build && npm run test:e2e`, `check:mcp`, `check:html`.

### 3I Token cost (from the Harbour agent's follow-up on its own transcript)
Every byte a tool returns rides along in every later step of the session, so response size
compounds. These are the items from that follow-up that are not already in 2.3, 2.7, 3D, 3F
or 3G. **Each new tool or description costs `check:mcp` budget (126 bytes of headroom), so a
new tool must be paid for by trimming existing descriptions, never by raising the budget.**
1. **`landed` summary on every structural write** (`edit_structure`, `set_page_html`,
   `create_component`, `update_component`): one line per op — `inserted div#row-qv under
   row-wrap`, `replaced 3 nodes in main`, `removed span 2a3f…` — plus anything dropped or
   normalised. Builds on 2.3's post-apply assertion. The goal is that no write ever needs a
   confirmation read.
2. **Short ids in rows.** `get_page` element rows, `list_components {includeNodes}`,
   `parts`, `ref-parts` and the worklist print full UUIDs while the HTML prints the 8-hex
   `data-id`. Print the short form everywhere (`fullNodeId` resolves it everywhere already;
   lengthen on collision exactly as the serializer does). Audit every `id:` field a tool
   emits. Specs that match on ids will need the short form.
3. **Worklist handle.** `get_translation_worklist` returns a process-local `handle` (the MCP
   server is one process per session, like the `target`); `set_translations {handle,
   items: [{key, <locale>: text}]}` resolves each `key` server-side, so the ids and base
   strings never pass through the transcript twice. Keep `itemsPath` as the on-disk
   alternative (3D). `countsOnly` becomes the default when no filter is given.
4. **`inspect_route {path, select, attrs?}`** — [DECISION] whether to add it. A CSS selector
   over the exported HTML (preview or published) returning matched elements' tag, text and
   requested attributes, so an agent checks `a[href]` or `[data-status]` without curl, a
   browser, or the whole page. Reuse the exporter's output directory; cap results. Weigh its
   description cost against the ~40 verification calls it replaces. Default: add it, and pay
   for it by trimming the two longest existing descriptions.
5. **GUIDE "Cost discipline"** — three to five lines in the golden rules (they are in the
   initialize `instructions`, paid every turn, so no more than that) plus a short section:
   address by ref, never read a page to find one id; pass `elements` scoped to what you
   touched; verify with `preview`/`publish` warnings and `inspect_route`, not page dumps;
   write large payloads via `*Path` once; use the worklist handle. Point the eval prompts
   (`MCP-EVAL-PROMPT*.md`) at it and add the session-side practices there (verification in a
   subagent that returns pass/fail; one ops file per screen; phase boundaries with notes on
   disk), since those are the agent's habits, not the product's.
6. **Not taken:** `elements: "none"` as the default on writes. The report's own §5 records the
   read it cost when the parts were needed; the touched-subtree default (2.7 / E20) is the
   right one.

Phase gate: `check:mcp` (the budget is the point of this phase), `npm run build && npm run
test:e2e`.

---

## Phase 4 — code-review SAFE cleanups (pure deletions, one commit per group)

Order from the review, which has already verified each is unreferenced:
1. **F13** unused imports/locals (table in the report; **do not** delete the four template refs
   `el`/`editEl`/`newLocaleInput`/`root` or `StyleEditor`'s `kind`). **F14** four dead exports
   (`TRANSITION_PRESET_OPTIONS`, `triggerWord`, `actionVerb`, `RESERVED_FIELD_NAMES`). **F12**
   `UploadUI.vue`. **F7** `motionPresets.ts` + `createFromPreset`. **F8** `pair`/`unclaimed`/
   `removeHalf` in `useEffects`. **F9** the unreachable Cancel/Done footer (`created` flag,
   `done()`, `cancel()`; keep `view`). **F10** `RESERVED_ATTRS`/`isReservedAttr` in
   `html/tags.ts`. **F25** `export` on `COMPONENT_KEYS`.
   Gate: `type-check` + `check:html`.
2. **F6** delete `NODE_STATE_KEYS`/`hasNodeState`/`stripNodeState` and their `mcp-runtime.ts`
   lines; keep `BUILTIN_LIST_SOURCES`; fix the false comment. Then `npm run build:mcp-runtime`,
   `type-check`, `check:html`, corpus (workaround).
3. **F23** stale comments (table in report) and **F16** CLAUDE.md: the `interactions/`/`effects/`
   /`canvas/`/`layers/`/`content/`/`sidebar/` listings, `captureProps` ×2 → `cloneSubtree`,
   `hoistBlockRef` → inline in `useComponents.ts:145`, `enclosingNestedInstance` →
   `enclosingInstance`, test count 221 → whatever `npx playwright test --list` says after the
   new specs. Also add the forms subsystem dir.
4. **F18** replace `mcp-components.spec.ts`'s local `session()` with the shared `mcpSession()`
   (leave `mcp-tools-security.spec.ts`'s copy — it needs `armMidHandlerWrite`).
5. **F22** `git mv INTERACTIONS-UX-PLAN.md SITE-BACKEND-PLAN.md SESSION-NOTES-2026-10-02.md
   docs/history/`. [DECISION] `TREE-SOURCE-PLAN.md` has six inbound references; default: move it too and
   update them (`grep -rn TREE-SOURCE-PLAN .` must be clean).
6. **BACKLOG hygiene.** Several entries are stale against shipped work and will mislead the
   next reader: P2 ("there is no backend" — forms shipped), M18 ("attributes are not
   localizable" — they are, see `isLocalizableAttribute`), M26 (`create_collection` cannot
   declare fields — verify), M0b/M2/M27 (re-measure after Phase 3G), the Layers "RESOLVED" items
   that still sit under open headings. Mark each SHIPPED/RESOLVED with the date or delete it;
   do not touch the provenance sections.
7. Consider `noUnusedLocals`/`noUnusedParameters` in `tsconfig.app.json` **only** if the five
   false positives can be silenced without `// @ts-ignore` (prefix with `_` is not an option for
   template refs). Otherwise skip.

---

## Phase 5 — refactors that want eyes

### 5.1 F15 — make the render referee hermetic
`scripts/corpus.mjs`: `build` snapshots the media each input references into
`.corpus/inputs/media/` (the index + files `export-media.mjs:37` reads); `check`/`save` export
with `GUANO_DATA_DIR` pointed there. Minimum fallback: refuse to run with a clear message when an
input references a media id the data dir cannot resolve. Build the media snapshot **from the
backup dir** (`server/data.backup-ridgeline-…`), since that is where the baseline's 305 files
are. Gate: `node scripts/corpus.mjs check` green against unchanged code and the existing
baseline (plus the F21 banner, which the human re-saved). After this, [DECISION] the backup dir can go.

### 5.2 F17 — `DataEditor.vue` duplicate entry writers
Replace `refValue` setter, `writeGallery`, `setGalleryAt`, `moveGalleryImage`, `toggleRef`
(`DataEditor.vue:663-742`) with `useEntryField`'s `setRef`/`writeList`/`setListAt`/`moveInList`/
`toggleRef`, passing `activeEntry.value` and `headField.value`. Delete both "keep in step" notes
and fix the stale `useEntryField.ts:11` line reference. Gate: `ui-entry-editor` spec.

### 5.3 F19 — `MENU_ITEM` ×2 and the section label ×17
`MenuItemUI.vue` in `components/ui/` (or export `MENU_ITEM` from `MenuUI.vue`); a
`SectionLabelUI` or one `@utility section-label` in `main.css`. Mechanical; several specs query
these rows, so the e2e suite is the gate.

### 5.4 From BACKLOG, surfaced again by Harbour (do if time allows)
- `update_settings {tokens}` has no version (stale list drops tokens).
- `delete_interaction` / `delete_animation` have no interlock.
- The **canvas-vs-export referee**: `check:corpus` compares export to export, so the E3 class
  (mirror link rendered by neither, but a future drift rendered by one) stays invisible. A script
  that renders the corpus through `useRenderNode` headlessly (jsdom + `createSSRApp`) and diffs
  against `export.mjs` is the missing gate. Larger; scope it, don't start it in this session.

---

## Coverage

- **Code review:** F1–F26 all appear above (F26 as "do not touch").
- **MCP report:** E1–E22, E24, E28, E33, E35–E38, E40 have an action. **E23, E25, E26, E27,
  E29–E32, E34, E39 need none** — they record things that worked (traps refused correctly, the
  no-op echo, the locale switcher, the effects verified in a browser, the agent's own layout fix,
  a correct cross-component warning). §5 cost items are in 3D/3G; §6 guide items in 3F; §7 API
  items in Phase 2 and 3; §9 in 3H. "Never used" tools need nothing.
- **BACKLOG:** only the "Still open from Ridgeline" items are drawn in (5.4), because the plan's
  scope is the two reports. The rest of BACKLOG (~60 open items under Security, Refactors,
  Product gaps, Interactions, Launch, Layers, Components library, MCP v1 limits) is NOT covered
  here beyond the hygiene pass in Phase 4.6. If you want it folded in, say so and it becomes a
  Phase 6 after triage.

## Decisions for Francois [DECISION]

| # | Question | Default taken if unanswered |
|---|---|---|
| D1 | F21: re-save the corpus baseline after the SPDX banner (`node scripts/corpus.mjs save`) once `check` shows only `/assets/motion.js` + `/assets/slider.js` differing | Code change made; baseline untouched |
| D2 | E8 / 3C.3: support per-instance binding overrides on the page wrapper? | BACKLOG it; ship the message + guide fix |
| D3 | E15 / 3H: validate `select` options (and `email` format) at `POST /_guano/forms/:id`? | Validate options from the manifest; leave email to the browser |
| D4 | F22: move `TREE-SOURCE-PLAN.md` to `docs/history/` and update 6 references? | Move it |
| D5 | F15: delete `server/data.backup-ridgeline-…` after the corpus media snapshot exists? | Keep until you confirm |
| D6 | E37: make `<button>` an instance part? | Yes |
| D7 | E21: accept `data-icon="<lucide-name>"` as a write form in both writers? | Yes |
| D8 | 3I.4: add `inspect_route`, paid for by trimming existing tool descriptions? | Add it |

---

## Final gate sequence

```sh
npm run type-check
npm run check:html
npm run check:migrate
npm run check:mcp
GUANO_DATA_DIR=$PWD/server/data.backup-ridgeline-20261004-221152 node scripts/corpus.mjs check   # or plain check:corpus after 5.1
npm run build && npm run test:e2e
cd packages/guano && npm pack && <boot the packed server>                                         # F1
```

Then update `BACKLOG.md`: add a "Harbour evaluation run (2026-10-04)" section in the shape of
the Ridgeline one — what was fixed with the E-numbers, what was deliberately not (E17, E8
feature, formatters), and what is still open.

## Session notes

Session of 2026-10-05. Every phase ran; 30 commits, `df968ee..HEAD`. Final gates all
green except the one deliberate exception (F21's baseline, D1). 299 e2e tests, up from
221.

### Blockers found in the plan itself

- **The two source reports are not in the repo and never were** (`git log --all
  --diff-filter=A` finds no `CODE-REVIEW-REPORT.md` or `MCP-REPORT.md`). Phase 0.3 could
  not be done. Where the plan said "table in the report" I reconstructed the list
  instead: F13's unused locals by turning on `noUnusedLocals`/`noUnusedParameters` for
  one run, F23's stale comments by grepping for every name the session deleted. Both
  lists are in the commits.
- **The plan docs were deleted in the working tree** (`BACKLOG.md` staged, the five
  plan/notes files unstaged) while Phase 4.5 asks for them to be MOVED to
  `docs/history/` and Phase 4.6 asks for BACKLOG edits. I restored them from HEAD and
  moved them as the plan says. If the deletion was deliberate, the move is the thing to
  undo.

### Deviations, with reasons

- **2.8 / E24 — `saved` is NOT false for a partial write.** The plan asks for "`saved`
  is `true` only if the write landed in full". `set_page_html` applies IN PLACE, so
  reporting `saved: false` for a page that really did change would be a lie in the other
  direction and would invite a duplicate re-send. One rule instead, stated in GUIDE:
  `saved` says the store was written, `partial` says not all of it landed.
  `edit_structure` stays all-or-nothing (`saved: false`) because it applies to a copy.
- **3I.4 — `inspect_route` is NOT built**, it is BACKLOGged with the analysis. The
  description cost is affordable; what is unsettled is where the HTML comes from (the
  preview URL over HTTP, or a new authed read endpoint) and the two answers differ in
  whether the in-process harness can test it at all. And `select` needs a matcher: there
  is no HTML parser available to the MCP server, so a selector engine is new code whose
  failure mode — matching nothing and reporting success — is the exact class this plan
  removed. Needs a decision, not a guess.
- **3H / E40 — the reserved field names are `name` and `slug` ONLY.** The plan's list
  (`id`, `name`, `slug`, `status`, `locales`, `values`) was too wide: a `status` field is
  ordinary and documented (it is what a `data-[status=waiting]:` class matches on), and
  reserving it broke six existing specs — which is how the real line got found. Only
  `name` and `slug` are an entry's own properties AND top-level `upsert_entries` keys.
- **4.7 — `noUnusedLocals` stays OFF.** Six false positives remain and none can be
  silenced without `@ts-ignore`: five refs destructured from a composable and bound as
  `ref="el"` (vue-tsc does not credit that as a use), plus one destructured parameter.
  The plan's own escape clause.

### Found along the way, in neither report

- **`delete_animation` had never worked.** The handler builds a `touched` array and the
  response reads `changed.size`, so every call threw a ReferenceError before returning.
  Nothing covered it. Fixed in 5.4 with a spec.
- **E15 is worse than reported.** An `<option>`'s value lives on the MASTER when the
  select sits inside a component — the shape the guide tells you to build — so the
  published manifest recorded `options: ["", ""]` and the endpoint refused the value the
  page itself offers. A visitor got a 400 for picking the first option in the list. The
  reported symptom (an invalid value accepted) was the page-level case where a select
  has no `<option>` children at all.
- **`edit_structure`'s `wrap` op was broken for the commonest case.** Wrapping anything
  whose parent is a `<div>` in a `<div>` produced no wrapper and the message "could not
  build the wrapper", for perfectly good markup — the same `applyHtml` adopt-onto
  collision as E2, which is why `ApplyOptions.asChildren` fixes both.
- **The media snapshot broke `check:html` once** (it lists `.corpus/inputs/*` and read
  the new directory as `media.json`). Moved to `.corpus/media/`, and `check-html.ts`
  filters to `.json` so the next sibling cannot repeat it.
- **A spec that leaves a form submission behind is visible to a later spec.** The new
  `store-forms` case failed only in a full-suite run, as a strict-mode violation in
  `ui-forms-panel` — submissions outlive a publish, and the panel lists every form that
  still has one, including a removed form's. It cleans up after itself now.

### Open decisions

| # | Question | What I did |
|---|---|---|
| D1 | F21: re-save the corpus baseline after the SPDX banner | **Yours.** `check` reports exactly 2 differences — `assets/slider.js` and `assets/motion.js` — and no node id moved, no HTML byte moved. TWO intended changes land in them: the SPDX banner line (F21), and `assets/motion.js` is also **1,099 bytes smaller** because F14's dead `TRANSITION_PRESET_OPTIONS` was being bundled into every published site through `@/lib/motion`. `node scripts/corpus.mjs save` is safe. |
| D2 | E8: per-instance binding overrides on the page wrapper? | Took the default: BACKLOGged under Interactions with what it would cost. The refusal and the GUIDE now name the wrapper recipe. |
| D3 | E15: validate `select` options / `email` at the endpoint? | No code needed — both were already validated. The bug was the MANIFEST they validate against. Documented in GUIDE ("what is checked is what the markup DECLARES"). |
| D4 | F22: move `TREE-SOURCE-PLAN.md`? | Took the default: moved, six references updated, `grep -rn TREE-SOURCE-PLAN` clean outside `docs/history/` and this file. |
| D5 | F15: delete `server/data.backup-ridgeline-…`? | **Yours.** `.corpus/media/` now holds the 36 assets the inputs reference, so the referee no longer needs it. Nothing else does — but it is also the only copy of that store, so I left it. It is gitignored now (F2). |
| D6 | E37: make `<button>` an instance part? | Took the default: yes, with a spec. |
| D7 | E21: accept `data-icon="<lucide-name>"` in both writers? | Took the default: yes, via an injected `resolveIcon` so the 330 KB table stays out of both bundles. |
| — | 3I.4 | NEW: `inspect_route` needs a decision before it can be built (see Deviations). |

### What is still open from this plan

Nothing in Phases 0–5 except the two decisions above (D1, D5) and `inspect_route`.
`check:corpus` fails only on F21's banner, by design, until D1.
