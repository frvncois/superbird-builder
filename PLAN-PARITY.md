# PLAN-PARITY.md — closing the CHSFD stress-test gap

## Status

| phase | state |
|---|---|
| 1.1 interaction state keys (+action/closeOn/group/once/scrolled/change) | **done** — `e2e/interactions.spec.ts` |
| 1.2 link attributes hoist onto the generated `<a>` | **done** |
| 2.1 empty + boolean attributes | **done** |
| 2.2 class catalog holes + honest rejection hint | **done** |
| 2.3 reconcile reparent guard | **done** |
| 2.4 publish-warning false positive | **done** |
| 2.5 `/media/<id>` link + rich-text rewrite at export | **done** |
| 2.6 GUIDE drift (easings, step `offset`, recipes) | **done** |
| 2.7 `load` timelines in a hidden tab | **done** |
| 3.1 file-backed payloads (`entriesPath`/`editsPath`/`codePath`/`manifestPath`) | **done** |
| 3.2 trimmed `set_page_code` responses (`elements: refs \| none`) | **done** |
| 3.3 client refs (`#ref`) in the DSL | not started |
| 3.4 palette-shadowing tokens (`allowShadow`) | **done** |
| 3.5 project type/spacing scale (`settings.theme`) | **done** |
| 3.6 data-only collections + `routeBase` | **done** |
| 3.7 batch `create_components` | **done** |
| 4.1 modals / menus / accordions / popups / header-shrink | **done** (fell out of 1.1) |
| 4.2 current-page nav state (`aria-current` + `current:`) | **done** |
| 4.3 pages as a data source (`@pages`) | **done** |
| 4.4 descendant + pseudo variants, `prose` | **done** |
| 4.5 rich-text block tags | **done** |
| 4.6a form elements | **done** |
| 4.6b form submissions | not started |
| 4.7 inline SVG / currentColor icons | not started |
| 4.8 page transitions + smooth scroll | not started |
| 4.9 marquee pause-on-hover / drag | not started |

Two findings from the report turned out to be misdiagnosed; see §2.6 (step
`offset` already worked) and §2.1 (the "not allowed" message named the wrong
cause). One pre-existing failure is unrelated to this work: `e2e/smoke.spec.ts`
looks for `getByRole('button', {name: 'Preview'})`, but the in-flight `AppHeader`
removal moved that control into `AppRail.vue` as an icon-only button whose label
is a tooltip, so it has no accessible name.


Source: the CHSFD (chfsd.org) port stress test, 2026-09-12. Goal: fix every bug in
§5, remove every item from "NOT POSSIBLE / NOT PORTED", and clear the §6 friction.
Nothing here is "by design" — each entry below is a real capability with a design.

Every line item has: **cause** (verified in the code), **change**, **files**,
**sync obligations**, **verify**.

---

## 0. Ground rules (read before touching anything)

**The four-surface rule.** Any change to rendering, interaction, motion or
sanitization must land on all four surfaces or the canvas and the published site
drift:

1. `src/composables/useRenderNode.ts` (+ `ElementRenderer.vue`, `PreviewRenderer.vue`)
2. `server/export.mjs` (+ `server/export-media.mjs`) — the only renderer of the live site
3. `server/site-runtime.js` (classes/behaviour) and `src/motion/runtime.ts` → `server/motion-runtime.js` (tweens)
4. `packages/guano/mcp/tools.mjs` + `packages/guano/mcp/GUIDE.md`

**Prefer `src/lib/shared/*`.** New logic that more than one surface needs goes
there as plain JS (DOM-free, no TS) and is imported verbatim. This already holds
for `motion.js`, `attributes.js`, `richtext.js`, `interactionClasses.js`.

**Rebuild the generated artifacts** — they are committed, so a missed rebuild
ships a silently stale site:
- `npm run build:motion` after touching `src/motion/runtime.ts` or `lib/shared/motion.js`
- `npm run build:mcp-runtime` after touching anything re-exported by `src/lib/mcp-runtime.ts`
  (`styles.ts`, `syntax.ts`, `elements.ts`, `shared/*`) — **this is how the class-catalog
  fixes reach the MCP**; without it the MCP keeps rejecting `max-w-7xl`.

**Gate.** `npm run type-check` is the only static gate. For pure-lib changes write a
throwaway `.tmp-test.ts` at the repo root and run
`npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts && rm -f .tmp-test.ts`.

**New project fields** go in `src/types/editor.ts`; `settings` merges as a single
unit in `lib/merge.ts`, so added settings keys need no merge work. New per-node
fields DO need a look at `computeMerge`'s node signature and at `set_page_code`'s
`fresh` stripping list (`tools.mjs` ~line 1575).

---

## Phase 1 — P0 bugs

### 1.1 Click toggle state is per binding (§5.1) — the blocker

**Cause.** State is keyed by *binding id*. `server/site-runtime.js` holds
`fired = new Set()` of binding keys and does `set(i.k, !fired.has(i.k))` per
`[data-int]` element; `server/export.mjs:attrsFor` builds `scopedKey(i.id)` for both
`data-int` and `data-tgt`; `src/composables/useInteraction.ts` does the same with
`fired.value.has(binding.id)`. Two bindings of the same interaction onto the same
target are therefore two independent booleans — so a close button can never undo
what an open button did, and `toClasses` gets applied twice.

**Change — separate the *state* key from the *binding* key.**

- New `stateKey = ${interactionId}:${targetNodeId}` (+ the existing `@scope`
  suffix). The binding key stays as-is and remains the key for breakpoint gating
  (`int-fxbp`), because scoping is per application, not per state.
- `InteractionBinding` gains `action?: 'toggle' | 'on' | 'off'` (default `toggle`,
  meaningful for `click`/`change`; ignored for `hover`, which stays symmetric).
- `int-fx` / `int-fxrm` become keyed by stateKey. `data-tgt` lists stateKeys.
  `data-int` entries become `{ t, k, s, a }` — trigger, binding key, state key, action.
- Runtime `set(stateKey, on)`; click handler:
  `a === 'on' ? set(s,true) : a === 'off' ? set(s,false) : set(s,!fired.has(s))`.
- One target reached by several *different* interactions still composes, because
  `data-tgt` is a list and `apply()` concatenates — unchanged.

**Files.** `src/types/editor.ts` (action) · `src/composables/useInteraction.ts`
(`fired` holds stateKeys; `classesFor`/`scopedClassesFor`/`fire`/`unfire`/`toggle`
take stateKeys; add `stateKey(binding, ownerId, scope)` helper — put it in a new
`src/lib/shared/interactionKeys.js` so the exporter imports the identical
function) · `src/composables/useRenderNode.ts` (call sites that fire) ·
`src/components/editor/interactions/*` (an Action select on the binding row) ·
`server/export.mjs` (`attrsFor`, ~lines 330–370) · `server/site-runtime.js` ·
`packages/guano/mcp/tools.mjs` (`bind_interaction` + `edit_elements.bindInteractions`
gain `action`) · `GUIDE.md`.

**Also land in the same pass** (they are the same keying + listener surface, and
each one removes a "NOT POSSIBLE" row):

- **`closeOn?: ('outside' | 'escape')[]`** on the binding. Runtime adds one
  document `pointerdown` listener and one `keydown` listener; on fire, record the
  trigger element + target element, and on an outside pointerdown (not inside
  either) or Escape, `set(stateKey, false)`. → menu close-on-outside-click, modal
  Escape.
- **`group?: string`** on the binding. Firing a stateKey `on` turns off every other
  stateKey in the same group. Group identity must include the **component instance**
  scope but **not** the collection-list entry scope, so "one accordion open at a
  time" works across repeats of one list while two instances of a component stay
  independent. Emit `int-fxgrp` as `{ stateKey: groupKey }`. → exclusive accordions.
- **`once?: 'session' | 'local'`** on the binding. On fire, write the stateKey to
  `sessionStorage`/`localStorage`; at boot, if present, treat the interaction as
  already-consumed (for a dismiss-style `off` binding: apply the off state
  immediately, which is what "popup shown once" means). → once-per-session popup.
- **New trigger `'scrolled'`** with `scrollAt?: number` (px, default 50). Runtime:
  one passive scroll listener → `set(stateKey, scrollY > at)`. → header shrink on
  scroll, back-to-top reveal.
- **New trigger `'change'`** on inputs (`change` + `input` events); fires `on` when
  the control is checked/non-empty, `off` otherwise. → conditional form fields
  ("Other amount").

**Verify.** Build a 3-element fixture page: a fixed `hidden` modal, an open button
(`click`, `on`), a close button inside it (`click`, `off`), an overlay
(`click`, `off` + `closeOn: ['escape']`). Publish; open → close via X, via overlay,
via Escape; confirm `class` never accumulates a duplicate token. Then an accordion
inside a `:collection-list` with `group: 'faq'` — opening item 3 closes item 1.
Check the canvas behaves identically (this is the part most likely to be forgotten).

### 1.2 Link attributes land on the inner element (§5.3)

**Cause.** `server/export.mjs:linkWrap` emits `<a href class="contents">` with no
attributes, while `attrsFor` pushes the node's sanitized `attributes` onto the
inner element. So `target="_blank"` sits on a `<div>` and does nothing.

**Change.** Add `LINK_ATTRS = ['target','rel','download','title','aria-label',
'aria-describedby','aria-current']` to `src/lib/shared/attributes.js` with a
`splitLinkAttributes(record)` helper. In `attrsFor`, when the node is *not* an
`<a>` but *is* wrapped (i.e. `resolveHref` returns a href), hold those back and
hand them to `linkWrap`; everything else stays on the inner element. When
`target="_blank"` is set and `rel` is absent, emit `rel="noopener noreferrer"`
automatically (do this for real `<a>` elements too).

**Files.** `src/lib/shared/attributes.js` · `server/export.mjs` ·
`src/composables/useRenderNode.ts` + the two renderers (mirror the same split in
the client link wrapper) · `GUIDE.md` (note that link attrs hoist).

**Verify.** An external social link with `target`/`rel`/`aria-label` → the attrs are
on the `<a>`, the `<div>` is clean, and the canvas renders the same.

---

## Phase 2 — P1 bugs

### 2.1 Empty and boolean attribute values (§5.2)

**Cause.** `sanitizeAttributes` in `src/lib/shared/attributes.js` does
`if (value === '') continue` — every empty value is dropped. `tools.mjs:912` then
diffs incoming keys against the cleaned object and reports the loss as
*"attributes ignored (not allowed)"*, which names the wrong reason.

**Change.**
- Keep empty strings. Add `BOOLEAN_ATTRS = new Set(['download','hidden','disabled',
  'open','required','readonly','checked','selected','multiple','autofocus'])`
  (and add the missing ones to `ATTR_ALLOW`). Coerce `true` → `''` and `false` →
  drop, so an agent can pass real booleans.
- Emission: boolean attrs with an empty value emit bare (`download`), everything
  else emits `name=""`. Do this in `server/export.mjs`'s attribute pass-through
  loop and in the client renderers (Vue binds `''` fine for non-booleans; for
  booleans bind `true`).
- `tools.mjs`: report refused *names* and dropped *values* separately, with the
  actual reason.

**Verify.** `alt: ""` on a decorative image, `download: ""` on a PDF link → both
survive a round trip through `edit_elements` → `get_page` → publish.

### 2.2 Class catalog holes (§5.4)

**Cause.** `isValidClass` in `src/lib/styles.ts` accepts arbitrary values, the v4
numeric spacing/size scale, fractions and size keywords, then falls back to an
enumerated `VOCABULARY`. The enumeration is simply missing families. `max-w-4xl`
passes only because it is hand-listed in `common`; `max-w-3xl`/`max-w-7xl` are not.
There is no `origin-*` property in `styleCatalog.ts` at all, and `scale`/`z` are
enumerated sliders, so v4's dynamic numeric forms fail.

**Change — add pattern rules, not more hand-listing.** In `styles.ts`:

| rejected | rule to add |
| --- | --- |
| `max-w-3xl`, `max-w-7xl`, `min-w-xs`… | `SIZE_TSHIRT_RE = ^(?:w\|h\|size\|min-w\|min-h\|max-w\|max-h\|basis)-(?:3xs\|2xs\|xs\|sm\|md\|lg\|xl\|[2-7]xl)$` — folds into the existing `size:<family>` conflict group via `sizeFamily`, so `max-w-7xl` replaces `max-w-full` |
| `origin-top-left` | new `transform-origin` property in `styleCatalog.ts` with the 9 keywords; arbitrary `origin-[top_left]` already passes |
| `border-white` | add `border-white`/`border-black`/`border-transparent`/`border-current` to `common` (and the same for `outline-`/`ring-` if those are ever accepted) |
| `scale-140`, `z-2`, `opacity-85`, `rotate-7` | `DYNAMIC_NUMERIC_RE = ^-?(?:scale\|scale-x\|scale-y\|rotate\|z\|opacity\|order\|grow\|shrink\|leading\|columns)-\d+(?:\.\d+)?$` |
| `rounded-4xl`, `rounded-t-2xl` | `ROUNDED_RE = ^rounded(?:-(?:t\|r\|b\|l\|tl\|tr\|br\|bl\|s\|e\|ss\|se\|es\|ee))?(?:-(?:none\|xs\|sm\|md\|lg\|xl\|[2-4]xl\|full))?$` |
| `visible`, `invisible`, `collapse` | add to `common`, and add a `visibility` entry to `propKey`'s pattern groups — a **separate** group from `display`, so `invisible` does not evict `flex` |

**Fix the wrong hint.** `applyClass`'s error blindly splits at the last dash, which
produced the invalid `origin-top-[…]`. Replace with: offer the arbitrary form only
when the base's prefix is in a known arbitrary-capable family list, and always
append up to 3 `suggestClasses(value)` results as "did you mean".

**Sync.** `npm run build:mcp-runtime` — otherwise the MCP still rejects them. Update
the class reference in `GUIDE.md` (~lines 300–340) and drop the now-false
"full palette for border-" claim if it stays false.

**Verify.** `.tmp-test.ts` asserting `isValidClass` for every class in the §5.4
table plus negative cases (`max-w-9xl`, `rounded-5xl`, `z-abc` must still fail),
and that `applyClass('invisible', ['flex'])` keeps `flex`.

### 2.3 Reconciliation adopts re-parented nodes (§5.5)

**Cause.** `reconcile` (`src/lib/syntax.ts:449`) adopts on `(line, type)` alone —
the `adopt` callback signature is `(line: number, type: string)`. The LCS line map
said "old line 218 → new line 231", the types matched, so a modal wrapper became a
popup content div, carrying `fixed inset-0 hidden` and a live click binding into a
completely different parent.

**Change.**
- Extend the adopt callback to `(line, type, parentId)` — `parseSyntax` builds with
  a stack, so the parent node (already adopted or created) is known at adopt time.
- `reconcile` precomputes `childId → parentId` over `previous`. New option
  `{ guardReparent?: boolean }`: when set, refuse to carry state onto a candidate
  whose previous parent id ≠ the new parent's previous identity. **Still adopt the
  node** (ids must stay stable for the returned element summary and for selection)
  but strip `classes`/`content`/`src`/`background`/`htmlId`/`attributes`/
  `interactions`/`animations`/`locales`, and push it onto a `stats.reparented[]`.
- The guard is **off** for the editor's diff path and **never** applies when the
  caller passes an explicit `map` (drag-reorder, paste, delete, ⌘G wrap-in-div all
  legitimately re-parent and already know the mapping).
- `set_page_code` turns it **on**, and surfaces `reparented` *first* in `notes`
  with the loudest wording, since it is the silent-corruption case. Raise the
  `inherited` preview cap from 20 to 40 and sort state-carrying moved nodes ahead
  of unchanged ones.
- Add subtree-scoped fresh: `fresh: true | { lines: [from, to] }`, so a caller
  replacing one block does not have to choose between inheriting garbage and
  re-styling the whole page.

**Files.** `src/lib/syntax.ts` · `packages/guano/mcp/tools.mjs` (`set_page_code`,
~1473–1655) · `GUIDE.md` · `npm run build:mcp-runtime`.

**Verify.** `.tmp-test.ts` replaying the §5.5 repro: old modal block → new popup
block, assert the popup content div has no `fixed`/`hidden` and no bindings, and
that `stats.reparented` names the four nodes. Then assert an in-place text edit on
one line still keeps everything (no false positives) and that ⌘G wrap-in-div in the
editor is untouched.

### 2.4 Publish warning false positive (§5.6)

**Cause.** `collectPublishWarnings` (`tools.mjs:~1049`) warns `draft-collection-template`
for every collection with a draft template, regardless of whether anything links
to its entry routes.

**Change.** Before warning, scan published pages (and component masters) for a
`:collection-list[name]`/`:collection-item[name]` subtree containing a node with
`link === '@item'`, or any node whose `link` resolves into that collection's route
base. Only warn when such a reference exists; otherwise stay silent (a data-only
collection is a legitimate shape — see 3.6).

**Verify.** The CHSFD shape: `member` + `faq` draft templates with no `@item` links
→ zero warnings; add one `@item` card to `member` → exactly one warning.

### 2.5 `/media/<id>` links not rewritten at export (§5.7)

**Cause.** `server/export-media.mjs:intern` scans `node.src`, `node.background`,
`conditions.swapSrc`, locale src overrides, favicon, ogImage, fonts and collection
image fields — but **not** `node.link`, and not hrefs/`<img src>` inside rich-text
content. `rewrite` is therefore never asked about them, so `/media/<id>` ships
verbatim and 404s on any host but this one.

**Change.**
- `intern` also walks `node.link` (and locale link overrides), plus every
  `href="…"`/`src="…"` inside `node.content` and inside rich-text entry values
  (one shared regex extractor — put it next to `sanitizeRich` in
  `src/lib/shared/richtext.js` as `mediaRefsInRich(html)`).
- `resolveHref` in `export.mjs` runs its result through `ctx.rewrite`.
- The rich-text emission path maps refs through `ctx.rewrite` (add a
  `rewriteRichMedia(html, rewrite)` companion, applied after `sanitizeRich`).

**Verify.** A PDF download link and a logo-download link in the export contain
`/assets/media/<hash>.pdf`; `grep -r '/media/' server/data/site` returns nothing.

### 2.6 Doc drift (§5.8) + the offset discovery gap (F4)

`step.offset` **already works as a delay** — `compileAnimation` computes
`start = Math.max(0, cursor + offset)` and `cursor` is `0` for step 1, and `offset`
is already in the `create_animation` schema. The report's "hold steps" workaround
was a discovery failure, not a missing feature.

**Change (docs only).** In `GUIDE.md`: add `quart-in` / `quart-out` / `quart-in-out`
to the Easings list; state explicitly that a leading `offset` on step 1 is the
delay mechanism and show a sequenced hero timeline using it; add the modal /
accordion / dismissible-popup recipes from 1.1.

### 2.7 `load` animations in a hidden tab

Not a bug, but the same class of robustness the appear fallback already has
(`site-runtime.js` reveals appear keys after 3 s). Give `load` timelines the same
treatment in `src/motion/runtime.ts`: if `document.visibilityState === 'hidden'` at
boot, jump each `load` timeline to its end state (as `?noanim` does) rather than
parking on frame 0, and play normally on a later `visibilitychange` only if it has
not already been resolved. Rebuild with `npm run build:motion`.

---

## Phase 3 — MCP / DX friction (§6)

### 3.1 File inputs for large payloads (F1)

`upload_media` already accepts `manifestPath`. Mirror it exactly: `itemsPath` on
`upsert_entries`, `editsPath` on `edit_elements`, `codePath` on `set_page_code`
(JSON for the first two, raw DSL for the third). Same path-safety rules as the
media manifest. This was the single largest context cost of the port.

### 3.2 Trim `set_page_code` responses (F2)

Add `'none'` to the `elements` enum (alongside `own`/`all`), and a `'refs'` mode
returning just `{line, id, type}`. Default stays `own`.

### 3.3 Client refs in the DSL (F3) — removes the component-expansion offset problem

Line addressing counts **expanded** component blocks, so a generator must hard-code
that `:Header:` is 62 lines. Fix by giving tokens a stable author-chosen name.

- Syntax: `:div#hero-shape` / `:h1[title]#page-title:`. Parse `#ref` into
  `node.ref` — **code-owned** like `node.arg`, so it is patched by editing the code
  line, never mutated on the node.
- `src/lib/syntax.ts`: extend `lexLine`, `LEAF`/`OPEN`/`CLOSE`, `parseSyntax`,
  `suggestCompletion`; `validateDocument` reports duplicate refs within a page.
  Markers (`(+)`/`{+}`/`[+]`) must keep working alongside a ref — fix the slot
  order once and document it.
- Reconcile: a matching `ref` is the **strongest** adoption signal — try refs
  before the line diff. This also fixes a large slice of 2.3 for free.
- `edit_elements`: accept `ref: "hero-shape"` as an address alongside `line`/`id`;
  `bindInteractions`/`bindAnimations` accept `targetRef`. Removes the id round trip.
- Export/renderers: `ref` emits nothing (it is not `htmlId`).

Biggest item in Phase 3; keep it on its own commit.

### 3.4 Reserved token names (F5)

Tokens compile to `--color-<name>` in `@theme`, so `blue` genuinely shadows the
Tailwind palette — hence `RESERVED_TOKEN_NAMES`. Don't forbid it, warn about it:
`update_settings` accepts `allowShadow: true`, saves the token, and returns a
warning naming what it shadows. The editor's token UI gets the same confirm.

### 3.5 Theme scale settings (F6)

The CHSFD source sets `html{font-size:15px}` and overrides `--text-base` /
`--leading-tighter`; Guano had no equivalent, so everything rendered ~6.7% large.

**Change.** `settings.theme?: { rootFontSize?: string; text?: Record<string,string>;
leading?: Record<string,string>; spacing?: string }`, compiled into the same
`@theme` block `useThemeTokens` already builds (plus a literal
`html{font-size:…}` rule). Same compilation must run in `export.mjs`. Expose via
`update_settings` and the Settings panel. Validate values as CSS lengths.

### 3.6 Collections without detail routes (F8)

Every collection currently creates a template page and claims `/<name>/<slug>`,
which forced the CHSFD `member`/`faq` templates to be set `draft` and live with
warnings.

**Change.** `Collection.detailRoutes?: boolean` (default `true`). When `false`:
`create_collection` does not create a template page, `export.mjs` emits no entry
routes, a `@item` link to it becomes a `validateDocument` diagnostic, and 2.4 never
warns. Add `routeBase?: string` in the same pass (`''` = root-level slugs, with a
collision check against page slugs) so WP-style `/<post-slug>` URLs are portable.

### 3.7 Batch `create_components` (F7)

Same shape as `create_animations`: validate all, one write, per-item results.

---

## Phase 4 — the "NOT POSSIBLE" list

Ordered by ratio of unlocked fidelity to risk. 4.1–4.3 are mostly free once
Phase 1 lands.

### 4.1 Already solved by Phase 1.1
Modals with separate open/close triggers · menu close-on-outside-click · Escape
close · exclusive accordion groups · popup once-per-session · header shrink on
scroll · conditional form fields.

### 4.2 Current-page nav state

**Change.** (a) The renderers and `export.mjs` add `aria-current="page"` to any
generated or real `<a>` whose resolved href equals the current route (locale-aware).
(b) Emit `@custom-variant current (&[aria-current="page"])` into the generated
stylesheet on both surfaces (`@tailwindcss/node` in the exporter,
`@tailwindcss/browser` in `CanvasEditor`) and add `current` to `VARIANTS` in
`styles.ts`. Then `current:text-brand-orange` works inside a shared Header
component — which was the actual blocker.

### 4.3 Pages as a data source

Unlocks the footer marquee honestly: `:collection-list[@pages]` iterates
`project.pages` (published, current locale), exposing `title`/`slug`/`path` as
bound fields and honouring `excludeCurrent` in `listQuery` — which is exactly
"auto menu, minus the page you're on". Implement in `useRenderNode` + `export.mjs`
+ `lib/shared/fields.js`; document in `GUIDE.md`.

### 4.4 Descendant / pseudo styling

Currently impossible, so `.article-content` typography, arrow-bullet lists and
`::selection` all had to be faked.

**Change.** In `styles.ts`:
- `isKnownVariant` accepts `before`, `after`, `marker`, `selection`, `placeholder`,
  `first-line`, `first-letter`, `file`, `even`, `odd`, `focus-within`,
  `peer-*`, `group-*`, `has-[…]`, `data-[…]`, `aria-[…]`, and **arbitrary
  variants** `[&_a]:`, `[&>*]:`, `[&_li]:` (regex-validated, length-capped, no
  `{`/`}`/`;` — they land in a stylesheet).
- Allow `content-['…']` so `before:` pseudo-elements can carry a glyph.
- Add these to `suggestClasses`' vocabulary so they are discoverable.
- Ship a hand-written `prose` utility in our own `@layer` (no typography plugin):
  paragraph spacing, `ul/ol` markers, link underline + hover, `blockquote`, `img`
  radius — all token-driven. One class on a rich-text container, and it is
  identical on canvas and export because both compile the same `@layer` source
  (put it in `src/lib/shared/prose.js` as a string).

### 4.5 Rich text structure

**Cause.** `ALLOWED` in `src/lib/shared/richtext.js` is an inline-only allowlist —
`<p>`, headings and `<blockquote>` are stripped (text kept), which is why imported
WP articles became `<br><br>` soup.

**Change.** Add `p`, `h2`, `h3`, `h4`, `blockquote`, `hr` (void). The balancer
already closes unclosed tags, so nesting stays safe; keep attribute-stripping and
`href` validation exactly as-is, and keep `sanitizeRich` idempotent (add a test).
`isRich`'s detection regex must include the new tags. `RichTextInput.vue` must be
able to produce them (Enter → `<p>`, a block-format control); 4.4's `prose`
utility makes them look right. No migration: existing `<br><br>` content stays valid.

### 4.6 Form elements + real submissions

Two separable steps; do the elements first, they are cheap.

**4.6a Elements.** Add to `src/lib/shared/elements.js`: `textarea`, `radio`
(`input type=radio`), `checkbox`, `fieldset`, `legend`. `select`/`option` already
exist — `GUIDE.md` should say so, since the port fell back to text inputs. Update
`ELEMENTS` consumers: element palette, icons, `suggest` chains, `GUIDE.md`
registry table, and the void/tag handling in `export.mjs`.

**4.6b Submissions.** New subsystem, new server module.
- Node state: `node.form?: { mode: 'store' | 'email' | 'both'; to?: string;
  subject?: string; redirect?: string; collectionId?: string }` on `:form`.
- Export emits `<form method="post" action="/api/forms/<pageId>/<nodeId>">` plus a
  honeypot field and a per-site submission token; a tiny progressive-enhancement
  handler in `site-runtime.js` posts via `fetch` and swaps in a success state
  (reusing an interaction stateKey so the authored success/error blocks show).
- `server/forms.mjs`: `POST /api/forms/:pageId/:nodeId` — unauthenticated and
  therefore the most exposed endpoint in the product, so: origin check, per-IP
  rate limit (reuse the auth limiter), body cap, honeypot, field allowlist
  derived from the **stored project's** declared inputs (never trust posted
  names), and append to `server/data/forms/<pageId>-<nodeId>.jsonl`.
- Email: do **not** add nodemailer. Send through `settings.integrations.mailing`
  with the provider key held server-side in `publish.json` via `fetch` — same
  pattern as the GitHub token. SMTP stays a later option.
- Admin: a Submissions panel (list + CSV export), admin/editor only. MCP:
  `list_form_submissions` read-only.
- Security review is mandatory for this one (`/security-review`), and add the new
  endpoint to the notes in `BACKLOG.md`.
- File upload (multipart) and Stripe Checkout (`POST /api/checkout` creating a
  session with the server-side secret key) are follow-ups in the same module —
  do not block 4.6b on them.

### 4.7 Inline SVG / currentColor icons

Ten SVG files had to be hand-generated per colour because there is no inline SVG.

**Change.** New element `icon` whose `content` holds an inline SVG, sanitized by a
shared `src/lib/shared/svg.js` (lift the existing `sanitizeSvg` out of
`server/media.mjs` so both surfaces use one implementation), rendered as raw inner
HTML with `fill`/`stroke` forced to `currentColor`. Then `text-brand-orange` colours
the icon, and hover inversion works. `edit_elements` gets an `svg` field (sanitized
server-side). Media-library SVGs get a "use inline" action.

### 4.8 Page transitions and smooth scroll

Both are global settings, both off by default, both must respect
`prefers-reduced-motion` and `?noanim`.

- **`settings.transitions?: { enter?: animationId; exit?: animationId }`** — a small
  module in `src/motion/runtime.ts`: intercept same-origin, same-tab, non-modified
  link clicks, play the exit timeline, then navigate; play the enter timeline on
  load and on `pageshow` (bfcache restore — the source site handled this, so test
  Back explicitly). Skip for downloads, `target=_blank`, hash-only links.
- **`settings.scroll?: { smooth: boolean; lerp?: number }`** — a ~60-line lerp
  scroller, no Lenis dependency, driven from the motion runtime's existing scrub
  rAF loop so parallax cannot desync. Disable on reduced-motion, on touch, and
  when any element is `position: sticky`-critical. **State the tradeoff plainly in
  the Settings UI**: hijacking scroll costs accessibility and input fidelity; it
  ships off.

### 4.9 Marquee ergonomics

`pauseOn: 'hover'` on an `AnimationBinding` (runtime pauses the timeline while the
element is hovered) covers the common case. Drag + inertia is a new `'drag'`
trigger on the animation runtime — lowest value on this list, do it last or not at
all. "Exclude current page" is solved by 4.3.

### 4.10 Analytics

Already possible via `settings.customCode.head`. Add a one-line note to `GUIDE.md`
so an agent does not record it as impossible.

---

## Suggested commit order

1. **1.1** interaction state keys + action/closeOn/group/once/scrolled/change *(plus `build:motion` if the runtime file moves)*
2. **1.2** link attribute hoisting
3. **2.1 + 2.2 + 2.6** attributes, class catalog, docs *(then `build:mcp-runtime`)*
4. **2.3** reconcile reparent guard + scoped `fresh`
5. **2.4 + 2.5 + 2.7** publish warning, media link rewrite, hidden-tab load
6. **3.1 + 3.2 + 3.4 + 3.7** MCP payload/response/token/batch ergonomics
7. **3.5 + 3.6** theme scale, data-only collections + route base
8. **3.3** `#ref` client refs *(own commit; touches the lexer)*
9. **4.2 + 4.3** current-page variant, pages as a data source
10. **4.4 + 4.5** descendant/pseudo variants + prose, rich-text blocks
11. **4.6a** form elements · **4.7** inline SVG
12. **4.6b** form submissions *(security review)*
13. **4.8** transitions + smooth scroll · **4.9** marquee

Each step must leave `npm run type-check` clean and the published site rendering.

---

## Regression harness

There is no test runner, so make the port itself the test.

1. **Unit, via `.tmp-test.ts`:** `isValidClass` table from 2.2 · `sanitizeAttributes`
   empty/boolean cases · `sanitizeRich` idempotency incl. the new block tags ·
   `reconcile` reparent fixture from 2.3 · `compileAnimation` step-1 `offset`.
2. **Behaviour fixture page** exercising modal open/close/overlay/Escape, exclusive
   accordion in a `:collection-list`, dismiss-once popup, `scrolled` header, a
   `change`-driven conditional field. Publish it and drive it in a browser; assert
   no duplicated class tokens.
3. **Export crawl:** every route 200, `grep -r '/media/' server/data/site` empty,
   external links carry `target`/`rel` on the `<a>`.
4. **Re-run the CHSFD port through the MCP** against a fresh draft after Phase 2 and
   again after Phase 4, and diff the §4 fidelity matrix. Each pass should move rows
   from APPROXIMATED/NOT POSSIBLE into REPRODUCED; anything that does not move is a
   missed sync obligation, which is the most likely failure mode of this whole plan.

## Docs to update as you go

`packages/guano/mcp/GUIDE.md` (tool surface, class reference, easings, recipes,
element registry) · `CLAUDE.md` (the interaction section's "two systems, one panel"
paragraph, the DSL section if 3.3 lands, the export section if 4.6b lands) ·
`BACKLOG.md` (new endpoint + deferred 4.9/Stripe/upload items) · `PLAN-MCP.md`
(status).
