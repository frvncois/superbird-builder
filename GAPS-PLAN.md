# Gaps plan — V10–V13 from the Vezaro client build (2026-10-05)

Source: `docs/history/GUANO-FEEDBACK.md` (the run's log) and `BACKLOG.md` → "First client
build (Vezaro, 2026-10-05)", where V10–V13 are written up as open product gaps. V1–V9 are
fixed (commits `1cddc75..b0a518d`). This plan is what to build for the four that remain,
in order, with the file anchors already checked against the tree. Where a step depends on
something not yet verified, it says "check first" and names what to look at.

Each of the four has ONE load-bearing rule. They are set in bold where they apply; an
implementation that drops the rule is worse than no implementation.

- **V13 images**: `width`/`height` must never distort an image — verify the published
  stylesheet carries `img { height: auto }` before shipping the attributes.
- **V10 channels**: a channel target is UNSCOPED by definition. Never attach an instance
  or entry scope to its key, and refuse a channel listener inside a repeat.
- **V12 modal**: the scroll lock needs a handshake with the motion runtime, which hijacks
  the wheel. `overflow: hidden` alone does not stop the page under the panel.
- **V11 count**: never bake a `count` track's `from` into the exported HTML. The authored
  text IS the final value; the runtime writes the first frame, and `still` mode never
  touches the text.

## Ground rules for the executing session

1. **One commit per item** (V13a, V10, V12, V11, V13b), message naming it
   (`feat(export): V13a — intrinsic image dimensions and lazy loading`). End every commit
   with the attribution line the session's system reminder gives.
2. **Gates.** `npm run type-check` after every code change. `npm run check:html` after
   anything in `src/lib/html/` or `src/lib/shared/`. `npm run check:mcp` after any tool
   description or `inputSchema` edit — the budget is **80,000 B** (raised from 70,000 for this plan, ~10 KB of
   headroom); keep descriptions to WHAT and WHEN, explanation goes in GUIDE.md. `npm run build && npm run test:e2e` at the end of each phase (full suite,
   314 tests; it takes ~3 minutes).
3. **The corpus referee.** `npm run check:corpus` is green now. V13a and V13b each change
   the rendered HTML of every image on purpose; after each, READ the diff (`check:corpus`
   prints it) and confirm it is ONLY the attributes/files named in that phase — then, and
   only then, `node scripts/corpus.mjs save`. Any other difference is a bug. V10, V11 and
   V12 must leave the corpus byte-identical (no corpus project uses them).
4. **Renderer parity.** Any change to how a node renders lands in all three renderers:
   `useRenderNode.ts` (both Vue surfaces) and `server/export.mjs`. Shared logic goes in
   `src/lib/shared/*.js`. Rebuild and COMMIT `packages/guano/runtime/mcp-runtime.mjs`
   (`npm run build:mcp-runtime`) whenever `src/lib` code it re-exports changes — the MCP
   tools read the bundle, not the source, and a stale bundle is "unknown element" at the
   tool while the source is right (it bit during V9). Rebuild and commit
   `server/motion-runtime.js` (`npm run build:motion`) after any change under
   `src/motion/` or `src/lib/shared/motion.js`.
5. **Keep the docs in step.** Each phase ends with its `CLAUDE.md` sentence and its
   `packages/guano/mcp/GUIDE.md` section. When all four are done, mark V10–V13 "— FIXED"
   in `BACKLOG.md` with the commit refs and move this file to `docs/history/`.
6. **Decisions marked [DECISION] are the human's.** Take the default stated, say so in the
   commit message, and list the open ones in "Session notes" at the bottom of this file.
7. **Stop at the first gate failure** and leave a note under "Session notes" rather than
   working around it. A corpus difference you did not expect is a gate failure.
8. **Scratch files** go in `.tmp-test.ts` / `.tmp-test.mjs` at the repo root (gitignored)
   and are deleted before the commit. Run TS scratch with
   `npx -y tsx --tsconfig tsconfig.app.json .tmp-test.ts`.

---

## Phase 1 — V13a: intrinsic dimensions and lazy loading (~1 hour)

What exists: `sharp` is a dependency; `server/media.mjs:288` `makeThumb` already records
`width`/`height` on every raster asset in the media index; `server/export-media.mjs:131`
already loads that index into `assetsById` and derives `altFor` / `kindFor` from it
(`:163-173`). The exporter emits `<img>` at `server/export.mjs:600`.

### 1.1 Check first — the stylesheet keeps images proportional
`width`/`height` attributes on an `<img class="w-full">` DISTORT the image unless the
cascade sets `height: auto`. Tailwind's preflight does (`img, video { max-width: 100%;
height: auto }`), but confirm the exported stylesheet carries it: export the e2e fixture
(`node scripts/corpus.mjs check` leaves `.corpus/check/fixture/site/assets/style.css`) and
grep for the rule. If it is absent, add `img, video { height: auto }` to the `@layer base`
block the exporter already emits (search `@layer base` in `export.mjs`). Do not proceed
without one of the two.

### 1.2 `export-media.mjs` — `sizeFor`
Beside `altFor`/`kindFor`, add `sizeFor(value) → {width, height} | null`, from
`assetsById.get(id)` when BOTH are finite numbers (assets uploaded before thumbnails
existed, and ones where `makeThumb` failed, have neither — emit nothing for those). For a
`data:` image in `store()` (`:45`), read dimensions with `sharp(buffer).metadata()` in a
try/catch and keep them in a `Map<ref, {width,height}>` so `sizeFor` answers for those too
— sharp is already imported one directory over, and the e2e harness runs `exportSite`
in-process, so it is available on both paths. Return it from `extractMedia`.

### 1.3 `export.mjs:600` — the `<img>` branch
In order, after `src`/`alt`:
- `width="…" height="…"` when `sizeFor(src)` answers. Neither name is in the attribute
  allowlist (`shared/attributes.js` `ATTR_ALLOW`), so an author can never have set them;
  no conflict handling needed.
- `decoding="async"` always.
- `loading`: an authored value wins (`loading` IS allowlisted — check `attrs` for it
  first). Otherwise count rendered `<img>` per route on `ctx` (`ctx.imgCount`, reset where
  `ctx` is built per route in `renderPage` `:1245`): the FIRST image on a route gets
  `fetchpriority="high"` and no `loading`; every later one gets `loading="lazy"`.
  One image eager, not three — a hero is one image, and `fetchpriority="high"` on several
  is worse than on none.
- These are exporter-only, deliberately: the attributes are performance hints with no
  visual effect, and the canvas loads every image anyway. Say so in a comment at the
  branch; it is the one documented exception to ground rule 4.
- Field-bound images (`:556`, `binding?.field.type === 'image'`) resolve a `/media/<id>`
  src too, so `sizeFor` covers them with no extra work — verify with the spec below.

### 1.4 Spec — `e2e/export-images.spec.ts` (in-process, mcpSession harness)
Use `s.exportWith(project, [])` with a hand-built project whose body holds three `image`
nodes: two with a `data:image/png;base64,…` src (generate a 2×1 and a 1×2 PNG with sharp in
the spec, or embed two tiny constants) and one `/media/missing` ref. Assert: the first
`<img>` has `fetchpriority="high"` and no `loading`; the second has `loading="lazy"`; both
carry `width`/`height` matching the PNGs; every `<img>` has `decoding="async"`; an authored
`attributes: {loading: "eager"}` on the second survives; the missing ref is dropped as
before. Check `SAFE_SRC` (`shared/urls.js`) accepts `data:image/…` on a node's `src` — it
does for the migration path; if the HTML writer refuses it, build the node in the project
object directly rather than through `set_page_html`.

### 1.5 Corpus
`check:corpus` will now differ on every `<img>` in all three projects. Read the diff: only
`width`/`height`/`decoding`/`loading`/`fetchpriority` on `<img>` tags, nothing else, no
node id moved. Then `node scripts/corpus.mjs save`. Say in the commit message that the
baseline moved and why.

### 1.6 Docs
`CLAUDE.md` → Publish & export paragraph: one sentence on the three attributes and the
one-eager rule. `GUIDE.md` → media section: an agent no longer needs to set `loading`
by hand; `loading="eager"` is the override.

---

## Phase 2 — V10: channels, a site-wide effect target (~2 days)

Why it is smaller than it looks: `server/site-runtime.js:68-82` matches STATE KEYS as
strings. A trigger carries its key in `data-int` (`export.mjs:668`, the `s` field); a
target lists the keys it listens on in `data-tgt` (`:704`). Nothing requires the two to
be in one tree. What blocks a shared modal is only that the key embeds a node id plus the
instance and entry scope (`stateKeyFor`, `:647`), so a master node's binding keys per
instance and a page node's keys to a page id. A **channel** is a target that is a NAME,
and its key carries no scope.

### 2.1 The model
- A trigger binds to a channel by setting `targetId: "@start"` — the `@` sentinel is the
  format's precedent (`@item`, `@locale:`). Both `InteractionBinding.targetId` and
  `AnimationBinding.targetId` (`src/types/editor.ts:34`, `:155`) accept it; the TS type
  stays `string | null` with a doc comment.
- An element LISTENS on a channel with `node.channel: "start"` — node state like
  `hidden`, shared like classes (on a master, every instance listens; see 2.6 for why
  that is fine and when it is not).
- Name charset `^[a-z][a-z0-9-]*$`, max 40 chars. One listener per channel per ROUTE.
- **Scope: none.** `interactionStateKey(interactionId, '@start')` with no `@scope`,
  for a page owner and a master owner alike. Likewise `animationStateKey` /
  `animationPlayKey` for a `click` tween. Exclusive groups on a channel-targeting binding
  use the UNSCOPED group key (`interactionGroupKey(group)` with no instance part), so a
  group can span a page trigger and a master trigger.
- **Animations: `click` only.** A `click` play is keyed per (animation, target) — that is
  the one tween key that can be shared. `appear`/`scrub`/`load`/`hover`/`scrolled`/
  `change` are keyed per binding, and a scrub aimed at a shared overlay means nothing
  anyway. Refuse them on a channel target by name, everywhere a binding is written.

### 2.2 Shared code — `src/lib/shared/channels.js` (new) + `interactionKeys.js`
- `interactionKeys.js`: `isChannelTarget(id)` (`/^@[a-z]/` and not `@item`/`@locale:`),
  `channelName(id)`, `CHANNEL_NAME_RE`. Export from `src/lib/mcp-runtime.ts`.
- `channels.js`: `buildChannelIndex(project)` → `Map<name, {interactions: {binding,
  ownerId, inMaster}[], animations: {...}[]}>`. Walk EVERY page's trees (reuse the shape
  of `routeTrees` in `export.mjs:275` — the collection template bodies are pages, so a
  plain walk over `project.pages` covers them) AND every component master
  (`project.components[].root`). `buildPlainTargets` (`export.mjs:254`) walks page trees
  only, which is exactly why a master's binding cannot be a target today. Also
  `channelListeners(project)` → `Map<name, nodeId[]>` over the same walk, for validation
  and the publish warnings.

### 2.3 Scope computation — three sites, one rule
Wherever a state key is built, skip the scope for a channel target:
- `server/export.mjs:647` `stateKeyFor`: `isChannelTarget(targetId) ?
  interactionStateKey(i.interactionId, targetId) : …` (same for the `scopedKey` of `s`;
  leave `k` scoped — it only gates breakpoints). Same for the animation `s` key at `:720`.
- `src/composables/useInteraction.ts` (the fire path around `:276-323`) and
  `useMasterBindings.ts:62-70` (`masterInteractionsTargeting` / `masterAnimationsTargeting`).
- `src/composables/useMotion.ts:167/207` `animationPlayKey(binding, targetId, scope)` —
  pass `undefined` scope for a channel target.
Grep for every `interactionStateKey(` and `animationPlayKey(` call and account for each.

### 2.4 Target emission — the listener side
- `export.mjs` `attrsFor`: when the rendered node (`mapping ? mapping.master : node`)
  carries `channel`, append the channel's interaction state keys to `targetKeys` (so
  `data-tgt` carries them) and fill `ctx.fx[key]` / `ctx.fxrm[key]` / breakpoint gating
  exactly as `:681-703` do for plain targets — a channel target whose trigger is a master
  on another route still needs `fx[key]` populated, so take the keys from the index
  (`ctx.channels = buildChannelIndex(project)`, built once in `exportSite`), not from
  what has rendered so far. Click tweens: append `animationStateKey(animationId,
  '@name')` to `data-atgt` the same way; check `src/motion/runtime.ts` for how `data-atgt`
  is matched for a click play (`s` vs `k`) and emit the one it reads.
- `useRenderNode.ts:580` (`animTargetIndex`) and `useInteraction.ts:81` (`targetIndex`):
  add the channel index so the canvas and Play recompute classes for a channel listener.
  Build it in a computed over `project`, like the existing indexes.

### 2.5 Validation and refusals
- `src/lib/validateTree.ts:94`: `channel` on a node inside an open entry scope
  (`SCOPE_TYPES`, `:92` — a `collection-list`, a bound `slider`, a `collection-item`
  template body) → `"a channel listener inside a repeat would open once per row — move it
  outside the list"`. Two listeners on one channel in one page → error on the second.
  Bad name → error. On an instance WRAPPER (renders no element) → error.
- `packages/guano/mcp/tools.mjs:1408` `resolveBindTarget`: accept `@name` when
  `channelListeners(project)` has it (any page, any master), for a page owner AND a master
  owner — the master case is the whole point; refuse "no element listens on channel
  `start` — set channel: "start" on the overlay with edit_elements" otherwise. Refuse a
  non-`click` animation trigger on a channel by name.
- `edit_elements {channel}` (new key beside `hidden` at `:1855`): `""` clears; validate
  the name; refuse on an instance wrapper and inside a repeat with the validateTree
  messages. `bind_interaction {channel: "start"}` is sugar for `targetId: "@start"`.
- Publish warnings (`:3890` `binding-target-unreachable`): a channel bound but declared
  on no published route → warn naming the channel and the trigger's location; a channel
  declared twice on one route → `channel-declared-twice`. Both are warnings — a listener
  on a draft page is legitimate while the site is being built.

### 2.6 Where a channel listener may live
On a page node: the usual case (the modal placed once per page). On a MASTER node: fine,
and desirable — the modal IS a component. Every instance then listens, so a component
placed twice on a route opens twice; that is what `channel-declared-twice` catches. Say
this plainly in GUIDE: "a channel is site-wide by definition. Two instances of a component
that opens a channel both open the same thing; two instances of the component that
LISTENS are a mistake the publish names."

### 2.7 The HTML layer
`data-channel="start"` is a carried attribute like `data-hidden`/`data-slot`, not a
read-only annotation: `serialize.ts` prints it (`:119` beside the effect names, but
INSIDE the version hash, since a write can change it); `apply.ts` reads it in `applyState`
with the name check and the instance-wrapper refusal, and `fillPart` treats it as the
component's (a mirror cannot override it) — refuse with "the channel is the component's;
change it with update_component". Reserve `data-channel` in `RESERVED_DATA_ATTRS`
(`shared/attributes.js`) so it can never arrive as a custom attribute. `check:html`: add a
built-to-order case in `scripts/check-html.ts` (round-trip keeps it; a bad name refused;
on a wrapper refused). The corpus has no channels, so the round-trip half stays as is.

### 2.8 The editor
- Data panel (`src/components/editor/content/DataEditor.vue`): a "Channel" text input in
  the element section, writing through a `setElementChannel` in `useElement` that applies
  the validateTree rules and returns whether it wrote (the `setElementRef` precedent).
- Target picker (`src/components/editor/interactions/ActionOptions.vue:72-92`): beside
  "Pick an element", a "Channel" choice listing `channelListeners(project)` names; picking
  one sets `targetId = "@name"` on every half. Show a channel target as `@name` where the
  element name shows today (`:76`).
- The Layers row label (`layerLabel`) may show `@name` after the ref; optional.

### 2.9 Reset on open — the recipe, not a feature
The report's "it reopens on the last step shown": with channels, each step panel inside
the flow component declares a channel (`step-1`, `step-2`, …) and the step buttons bind to
those channels in ONE exclusive group; the open button then also binds `action: "on"` to
`@step-1` in the same group, so opening resets. Because channel groups are unscoped, the
trigger outside the component and the buttons inside share the group. Write this recipe
in GUIDE under the modal pattern; do not build a `resetOnOpen` flag.

### 2.10 Specs
- `e2e/export-channel.spec.ts` (in-process): create `Header` (a button binding a `click`
  interaction to `@start`), `StartModal` (root declares `channel: "start"`, `hidden` base
  class, the interaction's `toClasses` = `flex`), a page `<Header /><StartModal />` and a
  second page the same. Assert on the EXPORT: the button's `data-int` `s` equals a key in
  the modal's `data-tgt` on both routes; the key has no `@`-scope suffix; `int-fx` holds
  the key. A footer component binding the same interaction to `@start` shares the key.
  A `click` tween to `@start` emits a matching `data-atgt`; an `appear` tween to `@start`
  is refused by name. `channel: "start"` on a node inside a `collection-list` is refused;
  on an instance wrapper refused; declared twice on one page → diagnostic; bound with no
  listener → `binding-target-unreachable` names the channel.
- `e2e/interactions.spec.ts` (browser, published site): one case — click the header
  button, the modal (a sibling tree) shows; the footer button closes it (`action: off`);
  Escape closes it when `closeOn: ["escape"]`.
- `scripts/check-html.ts`: the round-trip and refusal cases from 2.7.

### 2.11 Docs
`CLAUDE.md` → "Binding scope is decided by the TARGET" paragraph gains the channel
exception; the Reserved `data-*` list gains `data-channel`. `GUIDE.md`: a "Site-wide
overlays" subsection under class-interactions with the Header/Modal example, the
site-wide rule from 2.6, the reset recipe from 2.9, and "`click` tweens only". Update the
existing refusal text at `tools.mjs:1346` ("an effect from outside the instance can never
reach it") to point at channels as the way.

---

## Phase 3 — V12: a modal flag on an interaction (~1 day)

Why a flag and not a native `<dialog>`: native would give scroll lock, focus containment
and Escape for free, but it renders nothing until opened, its user-agent centering fights
the `fixed inset-0 flex items-center` classes every existing overlay is built from, the
Build canvas would have to force it open, and the exclusive-group / `closeOn` model would
exist twice. Every existing project is an overlay built from classes; the flag adds the
missing behaviours to that model.

### 3.1 The model
`Interaction.modal?: boolean` (`src/types/editor.ts:3`). While the effect is ON, its
target is a modal: page scroll locked, focus moved in and trapped, `role="dialog"` and
`aria-modal="true"` set, and on OFF everything restored including focus to the element
that opened it. Recommend `closeOn: ["escape", "outside"]` alongside it in GUIDE; do not
imply it.

### 3.2 Export — `int-modal`
`export.mjs` `attrsFor`: when `ctx.anim.get(i.interactionId)?.modal`, record the state
key in `ctx.fxModal`; emit `jsonTag('int-modal', Object.keys(ctx.fxModal))` beside
`int-fx` (`:1346`). The runtime reads it like `int-fxbp` (`site-runtime.js:34`).

### 3.3 The runtime — `server/site-runtime.js`
Hook at `set(key, on)` (`:176`), after the group and dismissal bookkeeping:
- ON: find the target element(s) whose `data-tgt` holds `key` (the `targets` list built at
  `:68`). Remember `document.activeElement` per key. Add the key to an `openModals` Set;
  when it becomes non-empty set `data-guano-modal` on `document.documentElement`, save
  its inline `overflow`/`paddingRight`, set `overflow: hidden` and `paddingRight` to the
  scrollbar width (`innerWidth - documentElement.clientWidth`) so the layout does not
  jump. Set `role="dialog"` and `aria-modal="true"` on the target if absent (remember
  which you set). Focus the first focusable descendant, else the target with
  `tabindex="-1"` added. Install ONE capture-phase `keydown` listener for Tab that cycles
  within the topmost open modal's target.
- OFF: reverse all of it; restore focus to the remembered opener if it is still in the
  document; remove the attribute and the inline styles when the Set empties.
- Reduced motion and `?noanim` do not change any of this.

### 3.4 The handshake — `src/motion/runtime.ts:675`
The inertia scroller hijacks the wheel and writes `window.scrollTo` (`:653`), so
`overflow: hidden` alone leaves the page moving under the panel. In the wheel handler,
before `insideNestedScroller`: `if (document.documentElement.hasAttribute('data-guano-modal'))
return` — let the browser handle it; the lock stops the page and the panel's own scroller
scrolls natively. `npm run build:motion`, commit `server/motion-runtime.js`. The attribute
is also the CSS hook (`html[data-guano-modal] …`); say so in GUIDE.

### 3.5 Preview surface [DECISION — default: focus + aria only]
In Play (`SitePreview` / `useInteraction`), mirror `role`/`aria-modal` and the focus move
when a modal effect fires, so the author sees the focus ring land. Skip the scroll lock:
the preview pane is not `window`, and locking the admin shell's scroll would be wrong.
Note the asymmetry in CLAUDE.md.

### 3.6 Editor and tools
- `StyleEffectEditor.vue` (`:37-45` area): a "Modal" toggle beside duration/easing,
  writing `effect.modal`.
- `tools.mjs` `create_interactions` (`:8261`) and `update_interaction` (`:8335`):
  `modal: {type: 'boolean', description: 'locks scroll, traps focus, sets aria-modal while on'}`.
  Run `check:mcp` as always.
- `list_interactions` output carries `modal` when set.

### 3.7 Spec — `e2e/interactions.spec.ts` (browser)
A fixture page with a trigger and a `fixed inset-0 hidden` overlay, the interaction
`modal: true`, `closeOn: ["escape"]`, enough body height to scroll. Open it: `html` has
`data-guano-modal`; wheel/`window.scrollBy` leaves `scrollY` unchanged; focus is inside
the overlay; Tab from the last focusable lands on the first; `role="dialog"` and
`aria-modal="true"` present. Escape: attribute gone, `scrollY` restorable, focus back on
the trigger, `aria-modal` removed. Also assert the published `motion.js` wheel handler
stands down: with inertia scroll enabled in settings, the same `scrollY` check holds.

### 3.8 Docs
`CLAUDE.md` → Motion paragraph: the flag, the `set()` hook, the `data-guano-modal`
handshake and why. `GUIDE.md` → class-interactions: "A dialog" with the flag, the
recommended `closeOn`, and the reset recipe cross-reference to V10.

---

## Phase 4 — V11: a `count` track (~1 day)

### 4.1 The model — `src/lib/shared/motion.js`
- `MOTION_PROPS.count = { kind: 'text', unit: '', units: [], def: 0, label: 'Count' }`
  (`:30`). `parseTrackValue` (`:163`) takes plain numbers for it.
- A track may carry `format: { decimals?: number, group?: boolean, prefix?: string,
  suffix?: string }`; `validateAnimation` (`:503`) checks it and refuses `count` in a
  STAGGERED step (the children have no number to count) and `count` beside `yoyo`
  (a number that counts back down is not what anyone means — [DECISION — default: refuse]).
- `composeMotionStyle` (`:392`) SKIPS `kind: 'text'`. Add `sampleText(values, locale)` →
  `string | undefined`: `Intl.NumberFormat(locale, {minimumFractionDigits,
  maximumFractionDigits, useGrouping})` on `values.count.n`, with prefix/suffix. `locale`
  comes from the route (`document.documentElement.lang` at runtime; the route locale in
  the exporter — which never calls it, see 4.2).
- **`initialStyle` (`:456`) and `endStyle` (`:441`) ignore `kind: 'text'`.** This is the
  rule. The exporter bakes `initialStyle` into the HTML (`export.mjs:762`) so an entrance
  never flashes its final state; for a number that would bake `0` as the text a visitor
  without JavaScript, and every visitor with reduced motion, reads forever. The authored
  text is the real value. The runtime writes the first frame.

### 4.2 The three appliers
- `src/motion/runtime.ts:165-181` (`applyStyle` path): after the style, if the sampled
  values hold `count`, `el.textContent = sampleText(values, document.documentElement.lang)`.
  In `still` mode (`:112`) never touch `textContent` — the end state IS the authored text.
- `src/composables/useMotion.ts:312-342`: beside the style result, return `text` when
  `count` is in play; `useRenderNode.ts:335` `displayContent` prefers `motionText` when
  defined. Same `still` rule for the canvas's reduced-motion handling if it has one.
- `server/export.mjs`: nothing to add — `initialStyle` already excludes it. Add a
  regression assertion that the authored text is in the HTML and no `0` replaced it.

### 4.3 Where a count may bind
A leaf that carries text (`isLeafElement`) and is NOT field-bound (`node.arg`): a bound
value comes from the collection and the write would fight the render. Refuse elsewhere by
name, at both bind sites: `tools.mjs` `bindAnimations` (and `bind_interaction`'s tween
path) and the editor's bind in `useAnimation`. Check whether `validateBinding(binding,
ctx)` (`motion.js:576`) receives the node — if its `ctx` has the type and arg, put the
rule there so both callers share it; if not, add them to `ctx`.

### 4.4 Editor
`TimelineEditor.vue:38` derives `PROP_OPTIONS` from `MOTION_PROPS`, so "Count" appears
on its own. Add the format fields (decimals, prefix, suffix) shown only when the track's
prop is `count` — three small inputs on the track row.

### 4.5 Tools
`create_animations` (`tools.mjs:8400` — `properties: Object.keys(MOTION_PROPS)` picks
`count` up) and `update_animation`: `format` on a track in the schema, one line. The guide
sentence does the explaining; `check:mcp`.

### 4.6 Spec — `e2e/site-motion.spec.ts` (browser)
A `span` with content `18,000+`, animation `count 0 → 18000` on `appear`, `format:
{group: true, suffix: '+'}`. The exported HTML contains `18,000+` and no `0` where the
span is; after the page loads and the span appears, the text passes through an
intermediate value and ends at `18,000+`; with `?noanim` the text is `18,000+` at once
and the runtime never wrote it (spy on `textContent` via a MutationObserver installed
before the runtime, or assert no `data-anim`-driven mutation). A `count` bound to a `div`
container and to a field-bound span is refused by name through `edit_elements`.

### 4.7 Docs
`CLAUDE.md` → Motion paragraph: `count` is the one track that writes text; the never-bake
rule and why. `GUIDE.md` → animations: the property, `format`, the leaf-only rule, and
"write the FINAL number as the element's text".

---

## Phase 5 — V13b: responsive variants (~1 day)

### 5.1 `export-media.mjs` — variants with a cache
After `store(ref, buffer, ext)` for a raster that is `jpeg`/`png`/`webp` (never `gif` —
animation — nor `svg`): widths `[480, 768, 1200, 1600]` filtered to `< intrinsic width`,
each written as `assets/media/${hash}-${w}.webp` (sharp `.resize({width: w,
withoutEnlargement: true}).webp({quality: 80})`). **Cache** by `${hash}-${w}.webp` under
`join(DATA_DIR, 'media', 'variants')` so a republish (and the preview export, which runs
the same code at `server/index.mjs:1168`) reads instead of resizing; the content hash
already names the original (`:46`), so the cache key is free. Record `variants: Map<ref,
{w, rel}[]>` and expose `srcsetFor(value) → "…/a-480.webp 480w, …"` from `extractMedia`.
Under the corpus referee `GUANO_DATA_DIR` is `.corpus`, so the cache lands in
`.corpus/media/variants` — gitignored, fine.

### 5.2 `export.mjs:600`
Emit `srcset` when `srcsetFor` answers, and `sizes`: an authored `sizes` wins (add `sizes`
to `ATTR_ALLOW` in `shared/attributes.js` — it is a plain string attribute with no
security surface), default `100vw`. Keep `src` the original file. [DECISION — default:
preview also generates variants, relying on the cache; the alternative is a
`{variants: false}` export option for preview, which makes preview and publish differ.]

### 5.3 Spec
Extend `e2e/export-images.spec.ts`: a 2000px-wide PNG generated with sharp in the spec →
`srcset` with the four widths and the files present in the export dir; a 600px image →
only `480w`; a GIF → no `srcset`; an authored `sizes` survives; default `sizes="100vw"`.
Second export in the same test: the variant files are byte-identical (the cache).

### 5.4 Corpus
Every raster in the three projects gains `srcset`/`sizes` and the export gains variant
files. Read the diff; only that; then `node scripts/corpus.mjs save`.

### 5.5 Docs
`CLAUDE.md` → Publish & export: variants, the cache location, the GIF/SVG exclusion.
`GUIDE.md` → media: `sizes` is the one thing an agent may want to set, with the grid
example (`sizes="(min-width: 768px) 33vw, 100vw"`).

---

## Coverage summary

| phase | spec |
|---|---|
| 1 V13a | `e2e/export-images.spec.ts` (new) |
| 2 V10 | `e2e/export-channel.spec.ts` (new), `e2e/interactions.spec.ts` (+1), `scripts/check-html.ts` (+cases) |
| 3 V12 | `e2e/interactions.spec.ts` (+1) |
| 4 V11 | `e2e/site-motion.spec.ts` (+1), `e2e/mcp-publish-warnings.spec.ts` or `mcp-tool-contracts` for the two refusals |
| 5 V13b | `e2e/export-images.spec.ts` (+3) |

## Decisions for Francois [DECISION]

1. **V12 Preview surface** (3.5) — default: Play mirrors focus and aria, not the scroll
   lock.
2. **V11 `count` + `yoyo`** (4.1) — default: refused.
3. **V13b preview variants** (5.2) — default: preview generates them too, cached.
4. **V10 listener on a master** (2.6) — default: allowed, with `channel-declared-twice` as
   the guard. The alternative, page nodes only, keeps the modal from being a component,
   which was the headline ask.

## Final gate sequence

```
npm run type-check
npm run check:html
npm run check:migrate
npm run check:mcp          # ≤ 80,000 B
npm run check:corpus       # byte-identical against the baseline saved in 1.5 / 5.4
npm run build && npm run test:e2e
```
Then: BACKLOG V10–V13 "— FIXED" with commit refs, `git mv GAPS-PLAN.md docs/history/`,
CLAUDE.md's e2e sentence updated with the new counts.

## Session notes

(filled in by the executing session: deviations, open decisions, what was found that
this plan did not name)
