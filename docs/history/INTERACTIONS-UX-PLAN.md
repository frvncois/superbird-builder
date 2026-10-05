# Interactions panel — UX rethink

Status: **COMPLETE — Phase 1 and all of Phase 2 shipped 2026-10-03.** The brainstorm (2026-10-02) was reviewed
against `main` after the tree-source migration, then executed. The design below is
what is now in the product; the review section records what the migration changed
and which of the brainstorm's model claims were wrong. Phase 2's three steps are all
shipped, step 3 deliberately narrowed (see below).

Phase 1 changed no stored shape, no exporter, neither runtime and no MCP tool.
Phase 2 step 1 changes all of those on purpose; it re-baselined `check:corpus` once,
for the rebuilt motion runtime and nothing else. Step 2 adds one optional project
array and touches nothing downstream at all.

## Review — what changed since the brainstorm, and what didn't

**The migration did not touch the motion model.** Interactions and animations were
never in the DSL. Both are node state (`node.interactions[]`, `node.animations[]`) with
shared libraries on the project (`project.interactions`, `project.animations`), and the
tree-source work left them exactly as they were. Every file this plan edits is in the
same state as when the brainstorm read it (`src/components/editor/interactions/`,
`useInteraction`, `useAnimation`, `useMotion`, `useEffectDetail`).

What the migration changed **around** them, which the plan has to respect:

1. **Agents address by `ref`/`id`, never by line.** `bind_interaction`, `unbind_interaction`,
   `edit_elements {bindInteractions, bindAnimations, unbindInteractionIds, unbindAnimationIds}`
   lost every `line` parameter. Nothing in this plan depends on positions, so nothing
   breaks, but any new UI copy about "where" an effect lives should name a `#ref`, which
   is also what the Layers tree labels rows by.
2. **The HTML an agent reads carries effects as read-only names only** —
   `data-interactions="Open menu"` / `data-animations="Fade up"` (`serialize.ts`), ignored
   on write (`apply.ts`), and **excluded from the page `version`** (`{effects: false}`):
   an effect is node state the HTML reports but does not carry. A binding change never
   makes an agent's write stale. **Phase 1 keeps this invariant for free** (it stores
   nothing new). **Phase 2 must keep it on purpose**: whatever a "state" or a "mixed
   effect" becomes, it stays out of the HTML and out of the version hash, and the
   read-only attributes keep printing names an agent can pass to `list_interactions` /
   `list_animations`.
3. **A write that removes a node runs `clearBindingsTo`**, dropping dangling `targetId`s.
   The "Driven by" list (design §2) must therefore be computed live from the tree, never
   cached on the target node.
4. **Identity is kept, not re-matched**, so `targetId` cross-references survive every
   structural edit. The brainstorm's "Driven by → jump to the trigger" is safe to build
   on ids.

**Two claims in the brainstorm's "Model implications" were wrong**, and they change
Phase 2's shape:

- *"An `AnimationBinding` with `trigger: 'click'` just plays — no on/off, no reverse."*
  **Half wrong** (and fixed in Phase 2 step 1 below). Click **does** toggle direction in all three renderers: `useMotion.toggle`
  reverses a forward play and plays otherwise; the published runtime does the same
  (`src/motion/runtime.ts` ≈ l.454, `direction === 1 ? reverse : start`); hover rewinds
  on leave. What is missing is only **shared state**: an animation's play is keyed
  `bindingId@scope`, so a *second* button cannot close what the first opened, and there
  is no `action: on|off`. Phase 2's "reversible animation states" is therefore a
  **keying change** (play keyed by `animationId:targetId@scope`, like
  `interactionStateKey`) plus an `action` field, not a new reverse engine.
- *"Dismiss / group / remember … this is mostly UI."* **Right, and already true server-side
  too.** Both the editor (`useInteraction.effectOptions`) and the published runtime
  (`site-runtime.js` `closeOnFor`/`groupFor`/`onceFor`) fold `closeOn`, `group` and `once`
  per **(interaction, target)**, whichever binding declares them. So a "state" card can
  read them off the union of bindings targeting the element and write them to **one**
  canonical binding with no runtime change.

**One thing the brainstorm did not know**: `settings.motion.appearMode` already makes
`undefined` mean *inherit* on an appear binding (`effectiveAppearMode`), and the current
`BindingRow` labels the stored `undefined` as "Site default (…)". The new ⋯ menu's
replay-mode control must keep that distinction — writing the resolved value back would
pin every binding the moment it is opened.

## The flow this replaced

Kept as the record of what the diagnosis below is about. Files (all now deleted):
`InteractionsEditor` (flat list) → `EffectChooser` (Add) → `BindingRow` (per-element
card) → `InteractionDetail` / `AnimationDetail` (shared effect editors),
`EffectLibraryList`, state in `useEffectDetail`. `PanelPopoverBody` swapped
list / chooser / detail inside the right-sidebar popover, and
`SettingsEditor.panelTitle` named whichever takeover was up.

1. Panel lists "On this element" with an **Add** button.
2. Add **replaces the panel** with a chooser: Presets · Animation library ·
   Interaction library · New animation / New interaction.
3. Picking one adds a collapsed row: *Hover · Lift · [Animation] → #card*.
4. Expanding a row: **Effect** (Edit) · **When** (trigger) · **On** (target) ·
   kind-specific rows (Action, After, Replay, From/To) · **More** (Dismiss on,
   Group, Remember, Starts at, Breakpoints) · Remove.
5. **Edit** replaces the panel again with the shared effect editor (name +
   classes, or name + step timeline as a vertical form). Back returns.

## Diagnosis — why it's confusing

- **Engine before intent.** The user must pick "Animation" vs "Interaction"
  (class toggle) before saying *when* or *why*. Webflow asks "When?" then "What?".
- **"Interaction" is overloaded** — it's the panel name *and* one of the two
  engines (shown as a "Classes" badge on the row).
- **Add opens a library, not a list of choices** — saved names before intent.
- **Three levels deep, two of them panel takeovers** (list → expanded row →
  Edit). The detail view hides which element / trigger / target you're on.
- **The trigger is chosen after the effect, and the list of triggers changes with the engine:**
  click/hover on both; load/scrub only on Animation; scrolled/change only on Classes.
- **Modal/menu essentials are hidden under More** (dismiss on outside/Esc, one-open-at-a-time group).
- **Animation editor is a long numeric form** — no sense of time.

## User answers

| Question | Answer |
|---|---|
| Biggest pains | Animation vs Classes split · Panel takeovers · Setting up a modal/menu |
| Overall shape | **Trigger-first sections** (Webflow-like) |
| Where shared effects are edited | **Bottom timeline drawer** under the canvas |
| Show the engine distinction? | **Hide it entirely** — one concept: "effect" |
| Can one effect mix tweens + class changes? | **Yes, show as one** |
| Modals / menus / dropdowns | **Target states** (the target declares "Open"; others Open / Close / Toggle it) |
| What the drawer covers | **All effects** (tracks for motion, a Style row for class changes) |
| Where the library is managed | **In the drawer** (left list of all project effects) |

## The design (now shipped)

### 1. Panel — trigger-first, for the selected element

```
Interactions · #menu-btn                [+ Trigger]
───────────────────────────────────────────────
▾ On click
    Toggle  #modal → Open                      ⋯
    + action
▾ On hover
    Lift                                 ▶     ⋯
    + action
```

- **+ Trigger**: Hover · Click · Scroll into view · While scrolling · Page load
  · Scrolled past · Input change. The section is a *grouping of bindings by
  trigger*, not a stored object: the trigger lives on each binding as today, and
  an empty section (a trigger with no action yet) is panel-local UI state.
- **+ action** opens a single picker: states on other elements (*Open #modal*),
  presets, saved effects, **New effect** — **filtered to what that trigger can
  run**, never naming an engine. The filter is the two trigger enums
  (`InteractionTrigger` vs `AnimationBinding['trigger']`): `load`/`scrub` offer
  animations only, `scrolled`/`change` class effects only, `hover`/`click`/`appear`
  both.
- Click actions read as a **verb**: Toggle / Open / Close — the `action` field
  (`toggle` is stored as `undefined`, exactly as `BindingRow` does today).
- **⋯ menu** holds the long tail: target (the shared `pickingFor` picker),
  breakpoints, replay mode (appear), start fraction (appear), scrub range,
  scrolled threshold, remove.

### 2. States on the target

```
Interactions · #modal                   [+ Trigger]
───────────────────────────────────────────────
States
  Open    flex · fade in                       ⋯
    ☑ Close on outside   ☑ Close on Esc
    One open at a time in: [ faq      ]
    Driven by  #menu-btn · #close · #backdrop  ↗
▸ Triggers (none)
```

- A state = a class interaction some binding **targets at this element**
  (`targetId === node.id`, or `null` on the element's own binding). It is read off
  the existing `targetIndex` (page) and `masterInteractionsTargeting` (masters) —
  nothing new is stored. Dismiss / group / remember are shown **once, on the
  state**: read as the union over the targeting bindings (what both runtimes
  already resolve), written to one canonical binding (the first one targeting
  this element), and cleared from the others so the stored data has a single
  author.
- **Driven by** lists the owner of every binding targeting this element, each
  clickable to select it ("why did my modal open?"). Computed live, because
  `clearBindingsTo` removes bindings when a trigger is deleted.
- A state card has no trigger of its own; the element's own triggers follow below.

### 3. Bottom drawer — every effect + the library

```
┌ Effects ──────┬ Fade up · used on 4 ─────────────────────── ✕ ┐
│ ▸ Fade up   ● │ Style   [ flex  opacity-100 ]                 │
│   Lift        │ ───────────────────────────────────────────── │
│   Open modal  │ opacity    ▕████████▏                         │
│   Slide in    │ y          ▕██████████████▏                   │
│   Open modal  │ scale            ▕█████▏      stagger 40ms    │
│ + New effect  │ 0      200      400      600 ms        ▶ Play │
└───────────────┴───────────────────────────────────────────────┘
```

- Left: project library (select, rename, delete, usage count) — one merged list
  of `project.animations` and `project.interactions`, sorted by name, with no
  kind badge.
- Right: one effect — a **Style** row (class changes, `ClassFieldInput` on
  `toClasses` + duration/easing) **or** **tracks** (tweens) on a time ruler; in
  Phase 1 an effect has one or the other. Drag a bar = offset/duration; click a
  bar = from/to/easing/repeat/stagger.
- The side panel stays visible → no more takeovers, context never lost.
- The drawer is **a Build-canvas thing**: it mounts in `BuildView`'s centre slot
  under the canvas (a new bottom track inside the framed pane), never over
  `SitePreview` or the components board's cards. It must leave the two corners
  alone — `InsertDock` owns bottom-left, `ModeToggle` bottom-right — so it sits
  above both, full width, and pushes the canvas up rather than overlapping it.

### Decided (was "Other ideas" / "Open questions")

- **Phasing**: Phase 1 pure UX on today's model; Phase 2 model. Decided by this
  review: every Phase 1 surface is specified so Phase 2 only changes what the
  picker offers and what a state card can hold, never the layout.
- **Exit on Close**: default **reverse the enter** (already how hover-out and a
  second click behave); an optional separate Exit effect is Phase 2 and optional.
- **How the drawer opens**: clicking an effect name in the panel or in a state
  card opens the drawer on it; **⌘⇧E** toggles it; it is **not** docked by
  default (a 9,500-element page already pays per frame, and the drawer must not
  shrink the canvas unasked).
- **Recipes** (*Open a modal*, *Dropdown*, *Accordion*, *Tabs*, *Reveal on
  scroll*): **out of Phase 1.** The bundled library already ships them as
  components (`catalog/entries/interactive.ts`, the only entries using
  `closeOn`/`group`); a recipe that wires loose elements would compete with
  golden rule 7. Revisit after Phase 2 if the states UI still leaves a gap.
- **Components**: no UX change. The panel keeps writing through
  `useComponents.editTarget` (instance → master). A state card inside an instance
  reads the master's targeting bindings via `masterInteractionsTargeting`.
- **Contributors**: never see the panel (`SettingsEditor` filters to Drafts for
  `!canBuild`); the drawer gates on `canBuild && isBuild` too.
- **1st click / 2nd click**: dropped. Target states and the Toggle/Open/Close
  verbs cover it.
- **Next deliverable**: this document is the spec; execution starts with Phase 1.

## Model implications (corrected)

1. **Mixed effects.** A class toggle (`Interaction`) and a tween (`Animation`) are
   separate stored objects with separate binding arrays. A single drawer "effect"
   that mixes them needs either:
   - **(a)** a wrapper effect pointing at one interaction and/or one animation,
     fired by one binding; or
   - **(b)** class changes as a track type *inside* an Animation (motion runtime
     applies classes) — cleaner, but moves class toggles onto the motion runtime
     (~3 KB gzipped, emitted only on routes that animate) and changes exporter,
     `site-runtime.js`, `check:mcp`'d tool schemas and `GUIDE.md`.

   **Phase 1 ships neither**: an effect is one or the other and the UI hides which.
2. **Reversible states for animations.** Click already toggles direction. What a
   "state" needs is **shared** state: key a click play by
   `animationId:targetId@scope` (mirroring `interactionStateKey`) instead of
   `bindingId@scope`, and accept `action: 'on' | 'off'`. SHIPPED — see Phase 2
   step 1, which also explains why hover was left per-binding after all.
3. **Trigger ↔ engine filtering.** With engines hidden, each trigger silently
   offers only compatible effects (see §1) until the model unifies them. Phase 1
   does this in the picker; Phase 2 may collapse the two enums.

## Phase 1 — what shipped

New (`src/components/editor/interactions/` unless noted):

- **`src/lib/effectTriggers.ts`** — the one trigger table. `kinds` per trigger is
  the action picker's silent filter, so the engine is never named.
- **`InteractionsEditor.vue`** rewritten: a header naming the element, `+ Trigger`
  (inline, with one line of help per choice), a **States** block, and one section
  per trigger.
- **`ActionRow.vue`** (replaces `BindingRow.vue`) — one line: verb · effect ·
  target, with ▶ for a timeline, a ⋯ menu (Edit effect / Remove) and an options
  strip holding the long tail. It keeps `data-binding-row`.
- **`StateCard.vue`** — dismissal, exclusive group and remembered dismissal, read
  as the union over every binding driving the state and written to one canonical
  binding. "Driven by" chips select the triggering element.
- **`ActionPicker.vue`** (replaces `EffectChooser.vue`) — inline under `+ action`,
  leading with the states already on the page (Open / Close / Toggle in one
  click), then presets, saved effects, and New.
- **`src/components/editor/effects/`** — `EffectsDrawer.vue`, `EffectLibrary.vue`
  (one merged, name-sorted list of both libraries), `StyleEffectEditor.vue`,
  `TimelineEditor.vue` (bars from `compileAnimation`, drag to move, drag the edge
  to stretch).
- **`src/composables/useEffectsDrawer.ts`** (replaces `useEffectDetail.ts`).

Deleted: `BindingRow.vue`, `EffectChooser.vue`, `EffectLibraryList.vue`,
`InteractionDetail.vue`, `AnimationDetail.vue`, `useEffectDetail.ts`.

Edited: `useInteraction.ts` (a lazy `driversIndex` / `driversFor`),
`PanelPopoverBody.vue` and `SettingsEditor.vue` (no drill-in branches left),
`BuildView.vue` (the centre became a flex column), `useEditorShortcuts.ts` (⌘⇧E,
and `shift: false` on ⌘E), `MenuUI.vue` (an optional `label` giving the icon-only
trigger an accessible name).

**Three decisions worth keeping in mind if this is revisited.**

1. **The picker and the ⋯ menu are inline, not popovers.** `usePopover` is
   one-at-a-time and the sidebar panel IS a host popover, so opening a second
   would close the panel the picker belongs to. `MenuUI` is safe because it is an
   inline dropdown (teleported for clipping, not a host popover), but it cannot
   host inputs — which is why the long tail went into the row's options strip
   rather than into the ⋯ menu as the brainstorm sketched.
2. **The drawer reserves the panel's width** while the panel is open, or the end
   of a timeline sits under it. It is docked as a sibling of the canvas in a flex
   column, so it pushes the canvas up and never takes a bottom corner.
3. **A State card is drawn for a `click`-driven effect or an externally driven
   one**, not for every effect landing on the element — a symmetric hover on
   itself has no state to manage, and drawing one would say the same thing twice.

**One thing fixed on the way.** A style effect whose easing the preset list has no
name for — every bundled library entry uses `ease-[cubic-bezier(0.2,0,0,1)]` —
used to render as an empty select, so the next pick silently replaced a curve
nobody chose to lose. It is now offered as "Custom · …".

## Phase 2 — model

### Step 1 — shared animation state (SHIPPED)

A `click` play is now keyed `animationId:targetId[@scope]` (`animationStateKey`,
the tween counterpart of `interactionStateKey`), and `AnimationBinding.action`
aims it: `on` always plays, `off` always rewinds, omitted toggles. So an open
button, a close button and an overlay drive ONE timeline, and `off` rewinds the
entrance rather than needing a separate exit animation.

`animationPlayKey` is the single place the choice between the state key and the
per-binding key is made, imported by `useMotion`, `server/export.mjs` and the
published runtime, so the canvas and the live site cannot disagree about what a
click does.

**Hover is deliberately NOT shared**, against the brainstorm's wording. It is
symmetric, so one shared play would make hovering a second trigger restart the
timeline from zero under the first one's pointer, and leaving either would rewind
it while the other was still hovered. Independent plays are the correct reading of
a symmetric gesture. `load`, `appear` and `scrub` have no state for a second
trigger to join, so they stay per-binding too.

On the wire a click binding gains `s` (the play key) beside `k`, which stays the
per-binding key that `data-atgt` and the breakpoint gate read, plus `ac` for a
non-default action. Nothing else on the wire moved.

Touched: `shared/motion.js` (the two key helpers, `ANIMATION_ACTIONS`, and
`validateBinding` refusing an action on any other trigger), `types/editor.ts`,
`lib/motion.ts`, `useMotion` (`toggle` became `clickAction`; `reverse`/`stop`/
`isPlaying` now take the resolved target), `useRenderNode`, `server/export.mjs`,
`src/motion/runtime.ts` + the committed bundle, the MCP `bindAnimations` schema
and `GUIDE.md`. In the editor a click timeline gets the same verb control a class
change has, the States block holds timelines, and the action picker offers
Open / Close / Toggle on a timeline already on the page.

Coverage: `e2e/interactions.spec.ts` gains an export assertion (both clicks share
one play key, a hover emits none) and a browser one (one button opens an animated
panel, a different button rewinds it — before this the close click found no play
under its own key and did nothing while reporting success).
`e2e/ui-interactions-panel.spec.ts` gains the author's path to the same thing.

### Step 2 — mixed effects (SHIPPED)

Option **(a)**, as specified. An `Effect {id, name, interactionId?, animationId?}`
in `project.effects` NAMES a pair; the halves stay in `project.interactions` and
`project.animations`, and a node still carries two ordinary bindings. So
`export.mjs`, both published runtimes, the merge and every MCP tool are untouched,
and `check:corpus` stayed byte-identical. Option (b) — class changes as a track
type inside an Animation — stays rejected: it would put every class toggle behind
the motion runtime and change the published wire format.

The load-bearing decision: **a pair on an element is RECOGNISED, not recorded.**
`useEffects.pairsFor` folds two bindings into one row when they sit on the same
node, under the same trigger, at the same resolved target, holding the two halves
of one Effect. Nothing links them in storage, so nothing can drift — and an agent
that writes the two halves separately gets the folded row for free.

Three rules follow from that:

- `ActionRow` reads when/where from the first half and **writes it to every
  half**. An effect whose halves fired at different moments, or landed on
  different elements, would simply be broken. The target picker takes an array
  for the same reason (`pickingFor` now holds one binding or several).
- `addHalf` **spreads** the new half to every element already using the effect,
  with the same when and where, skipping triggers that cannot run it. Adding
  motion to an effect already on twelve elements and moving none of them is the
  silent no-op this project refuses everywhere else.
- The action picker offers an effect only when the trigger can run **every** half
  it has, and binds them together. Half of a mixed effect would render wrong while
  reporting success.

The plan said "only the drawer and the picker learn about it". The row learns too:
two identical-looking rows would have been worse than what was there before.

An effect that predates the pairing — or one a motion preset or an agent made — is
not stuck as one engine. The drawer offers it the missing half, or joins it to one
that already exists, as an explicit action: wrapping a library row merely because
it was opened would change a project for a look.

One thing the plan did not anticipate: **a new top-level project list has to be
taught to the merge.** `computeMerge` builds its result with `{...mine, …}`, so
`effects` survived from one side and was silently dropped from the other, and
`summarizeChanges` would have read a draft that only named a pair as unchanged.
Both now handle it, with `effects` omitted when neither side has any so the
byte-stability discipline holds.

New: `src/composables/useEffects.ts`, `src/components/editor/effects/EffectEditor.vue`.
Changed: the drawer (a third selection kind, `effect`), its library, the picker,
`ActionRow` (now takes an `EffectPair`), `StateCard` (a mixed state is one card;
dismissal shows only when there is a class half), `InteractionsEditor`, and
`pickingFor`. Coverage: `e2e/ui-interactions-panel.spec.ts` builds a "Sheet" with
both engines and asserts one row, one library entry, and both halves landing on
the published page under the same trigger.

### Step 3 — one trigger list (SHIPPED, narrowed)

The two engines now take the same triggers, with ONE exception. `load` works on a
class change (a state the page simply starts in, no timeline needed), and
`scrolled` and `change` work on a timeline (a header that shrinks by tweening, a
field that slides in when a radio is picked). All three are symmetric and refuse
an `action`.

**`scrub` on a class change was refused, against the plan.** A scrub is continuous
progress and a class is on or off, so there is nothing for a class change to
follow; the step as written would have shipped a control that could not mean
anything. `effectTriggers.ts`'s `kinds` is `BOTH` on every row but that one, so the
picker's filter is down to a single honest exception rather than gone.

Touched: both trigger enums and `validateBinding`/`interactionBindingError` (the
new combinations are symmetric, so an `action` on them is refused),
`AnimationBinding.scrollAt`, `useRenderNode` (the editor answers all three),
`server/site-runtime.js` (`load` turns a class state on at boot),
`src/motion/runtime.ts` + the committed bundle (one shared scroll listener holding
each binding's last state, so a scroll event never restarts a play mid-flight, and
change/input listeners), `server/export.mjs` (`at2` beside the options), the MCP
trigger enums and `GUIDE.md`. `check:corpus` was re-baselined once for the two
rebuilt runtimes; no page HTML moved and no node id changed.

Coverage: `e2e/interactions.spec.ts` asserts the wire for both new shapes and then
drives them in a browser — the load state is on from the first frame, and the
scrolled timeline plays past its threshold and rewinds above it.

### What agents can and cannot do

An effect's two halves are a PRESENTATION decision, so they stay out of the tool
list: a `pair_effect` tool was written, measured at ~1.1 KB of every agent's
context on every turn, and removed. Agents keep creating and binding the two
halves exactly as before — which produces a correct site — and the human names the
pair in the drawer, including joining two the agent made. `GUIDE.md` says so in
one paragraph, which costs the tool list nothing because the guide is fetched on
demand.

## Appendix — Figma connection (parked)

Discussed the same day and **parked as overkill**. Kept here so the research isn't lost.

- Figma's remote MCP can now **write** to files: `use_figma` (beta) runs Plugin API
  JS; `generate_figma_design` captures live browser UI (e.g. our `/api/preview`)
  as editable layers, but the docs don't mention components or auto layout.
  Writing outside your own drafts needs a Full seat. Write-to-canvas is free
  during the beta and will become usage-based. Responses are capped at 20 KB per call.
- Recreating Main in Figma via the agent would be costly: 8 pages, ~6,760 page
  nodes, 31 components, 17 tokens. That means hundreds of calls, and the result
  isn't deterministic.
- Cheaper routes if it comes back: a pure compiler (project → Figma node spec)
  feeding a **private Figma plugin**, or a `.fig` file (undocumented Kiwi format,
  community `openfig-core`) or `.sketch` file (documented, but no variants or variables).
  `setSharedPluginData` would give stable Guano↔Figma ids for sync.
- Lightweight options that need no build: agent-driven Figma → Guano via both MCPs;
  `generate_figma_design` on the preview server; tokens ↔ Figma variables only.
