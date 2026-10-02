# Interactions panel — UX rethink (brainstorm notes)

Status: **brainstorm, not started**. Picked up from a session on 2026-10-02.
Scope agreed: review the **flow and UX**, not the functions — but two of the
choices below turn out to need model changes (flagged in "Model implications").

## Today's flow (as read from the code)

Files: `src/components/editor/interactions/` — `InteractionsEditor` (list) →
`EffectChooser` (Add) → `BindingRow` (per-element card) →
`InteractionDetail` / `AnimationDetail` (shared effect editors), state in
`useEffectDetail`.

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

## User answers so far

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

## Proposed design

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
  · Scrolled past · Input change.
- **+ action** opens a single picker: states on other elements (*Open #modal*),
  presets, saved effects, **New effect** — **filtered to what that trigger can
  run**, never naming an engine.
- Click actions read as a **verb**: Toggle / Open / Close (replaces the
  toggle / on / off "Action" select).
- **⋯ menu** holds the long tail: target, breakpoints, replay mode, remove.

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

- A state = an effect the element *can be in*. Dismiss / group / remember are
  shown **once, on the state**. (Today they're stored per trigger binding, but
  the runtime already folds them per effect + target —
  `useInteraction.effectOptions` — so this is mostly UI.)
- **Driven by** lists the elements that open or close it, each one clickable to jump to it ("why did my modal open?").

### 3. Bottom drawer — every effect + the library

```
┌ Effects ──────┬ Fade up · used on 4 ─────────────────────── ✕ ┐
│ ▸ Fade up   ● │ Style   [ flex  opacity-100 ]                 │
│   Lift        │ ───────────────────────────────────────────── │
│   Open modal  │ opacity    ▕████████▏                         │
│   Slide in    │ y          ▕██████████████▏                   │
│ + New effect  │ scale            ▕█████▏      stagger 40ms    │
│               │ 0      200      400      600 ms        ▶ Play │
└───────────────┴───────────────────────────────────────────────┘
```

- Left: project library (select, rename, delete, usage count).
- Right: one effect — a **Style** row (class changes) + **tracks** (tweens) on
  a time ruler. Drag a bar = offset/duration; click a bar = from/to/easing/repeat.
- The side panel stays visible → no more takeovers, context never lost.

### Other ideas raised (not yet decided)

- **Recipes**: *Open a modal*, *Dropdown*, *Accordion*, *Tabs*, *Reveal on
  scroll* — wire the existing functions in one go (open/close/dismiss/group).
- Webflow-style **1st click / 2nd click** for click toggles (the "Target
  states" answer may make this unnecessary).

## Model implications (the "not functions" scope stretches here)

1. **Mixed effects.** Today a class toggle (`Interaction`) and a tween
   (`Animation`) are separate stored objects with separate bindings. A single
   drawer "effect" needs either:
   - **(a)** a wrapper effect pointing at one interaction and/or one animation,
     fired by one binding; or
   - **(b)** class changes as a track type *inside* an Animation (motion runtime
     applies classes) — cleaner, but moves class toggles onto the motion
     runtime and changes exporter + MCP output.
2. **Reversible states.** Open/close via `on/off/toggle` (state keyed by
   effect + target) exists only for **class** effects. An `AnimationBinding`
   with `trigger: 'click'` just *plays* — no on/off, no reverse. "Open = fade
   in, Close = fade out" needs animation bindings to support state + reverse.
3. **Trigger ↔ engine filtering.** With engines hidden, each trigger must
   silently offer only compatible effects (load/scrub → animation; scrolled/
   change → classes) until the model unifies them.

## Suggested phasing (not yet confirmed)

- **Phase 1 — pure UX on today's model:** trigger-first panel, states for class
  effects, drawer (one engine per effect, engine hidden), library in drawer.
- **Phase 2 — model:** mixed effects (a or b) + reversible animation states.

## Open questions to resume with

1. Phase it as above, or design the unified effect model first so the UI
   changes once?
2. Exit animation on Close: reverse the enter · separate Exit effect (Webflow)
   · both (default reverse, optional custom exit)?
3. How the drawer opens: clicking an effect in the panel (+ shortcut) · always
   docked while the Interactions panel is open · its own rail button?
4. Recipes: in scope for v1?
5. Components: states/triggers on a master vs per instance — any UX change?
6. Contributors (Play-only): do they ever see this? (Today: panel per account
   type, not per mode.)
7. Next deliverable: written UX spec (flows, copy, edge cases) · clickable HTML
   mockup of panel + drawer · more brainstorming.

---

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
