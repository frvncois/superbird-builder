# Plan: redesign the drawer's Page settings / Item editor

**Scope decided with the user:** the settings view stays inside the 16rem pages drawer
(swap-in-place, no modal, no widening). Page settings and the entry/item editor get equal
weight. The problems to fix are layout jumpiness and general visual mess. The direction is
a **new, drawer-specific compact form language** — it may diverge from `SettingsGroup`/`RowUI`
(those stay untouched; they serve the wide project-settings modal and right-rail panels).

## Why it's ugly today (diagnosis)

1. **`RowUI` at 256px is broken by construction.** Its fixed `w-18` (4.5rem) label column +
   `px-2.5` + gaps leaves inputs ~8rem wide. Slugs, SEO titles and select controls are
   unreadable. Side-by-side label/control is the wrong shape at this width.
2. **`SettingsGroup` was designed for the wide settings modal.** Its title + full-sentence
   description + hairline per section eats vertical space five times over and reads as a
   different product than the drawer's list view (which uses tiny uppercase section labels).
3. **No spacing rhythm.** Root `p-1`, stray `px-1` on some paragraphs, `gap-3` between groups,
   `gap-2.5` inside Content, RowUI's own `px-2.5` — nothing lines up; left edges of labels,
   inputs and helper text all differ.
4. **Mode-swap jump.** The list view starts with a `p-1.5` search row; the settings view
   starts with a `border-y … py-1.5` header of a different height. Swapping between them
   shifts everything, with no transition (the drawer itself animates, the inner swap doesn't).
5. **Weight inversion.** "Details" (created/updated) gets a full section with two RowUI rows;
   the two-value Status field gets a full dropdown; meanwhile the actual content fields sit in
   the same visual weight as everything else.

## The new form language (spec)

All of this lives in the drawer only. Use the existing theme tokens (`bg-input`,
`text-muted-foreground`, `accent`, `text-danger`, `text-pending`) — no new colors.

**Grid & rhythm**
- One horizontal padding for the whole settings view: `px-2.5` (matches the list view's
  section-label indent, so list ↔ settings share a left edge). Root is `flex flex-col`,
  no root `p-1`.
- Sections separated by `gap-5`; fields inside a section by `gap-2.5`; label→control `gap-1`.
- Every control is full-width. Nothing is ever beside a label except a badge/action icon
  on the label line itself.

**Field pattern** — new tiny component `src/components/editor/sidebar/DrawerField.vue`:
```
<label>  text-[10px] font-medium text-muted-foreground truncate  (+ optional #end slot)
<slot>   the control, w-full
<hint>   optional prop, text-[10px] text-muted-foreground
```
This is exactly `EntryFieldControl`'s existing label treatment — the entry Content section
already got this right; the redesign spreads its language to the rest of the panel. Refactor
`EntryFieldControl` to use `DrawerField` for its label line (keep the DOM such that the field
label `<span>` and control stay in one wrapper div — `e2e/ui-entry-editor.spec.ts:63` locates
fields via `div` → `> div > span:text-is("name")` → `[contenteditable]`; preserve that shape
or update the spec in the same commit).

**Section pattern** — new tiny component `src/components/editor/sidebar/DrawerSection.vue`:
- Heading matches the list view's group labels exactly: `text-[9px] font-medium tracking-wide
  uppercase text-muted-foreground` with the same `pt`/`pb` rhythm the list uses.
- **No description sentences, no hairline.** Whitespace separates sections. The few
  load-bearing notes survive as per-field `hint`s (home-path-fixed, custom-code export note,
  the translating-locale fallback line) — everything else ("Title, address and publish
  state.") is deleted, not restyled.
- Optional `#action` slot on the heading line (not needed initially, but free).

**Specific controls**
- **Status**: replace the `SelectUI` dropdown with a two-segment control (two buttons in a
  `bg-input` rounded track, active segment `bg-background` + `font-medium`; Draft's segment
  can carry the existing `bg-pending` dot). Two mutually-exclusive values never need a
  popover, and this kills the dropdown's open/close reflow. Build it inline in
  `PageSettingsEditor` (or as `SegmentedUI` in `components/ui/` if it comes out clean —
  executor's call; don't force a primitive for one use).
- **Title / Slug**: keep commit-on-blur/Enter semantics untouched (page edits rebuild
  `@setup`; don't make them live). Slug keeps `font-mono`; when `isHome`, show the fixed
  path as a disabled input with hint "The home page path is fixed."
- **SEO**: title input + description textarea as two stacked `DrawerField`s.
- **Custom code**: two `DrawerField`s ("Head", "Body") with the mono textareas; the export
  note becomes the Body field's hint. Keep `page && canBuild` gating exactly as is.
- **Details**: demote from a section to a footer — two lines of `text-[10px]
  text-muted-foreground` ("Created 3d ago · name" / "Updated …") above the action buttons.
  Delete the `whenBy` RowUI rows.
- **Duplicate / Delete**: keep the two half-width buttons but drop `variant="outline"` for
  `ghost` so they read as quiet footer actions; Delete keeps `!text-danger` and the
  `isHome` disable. Keep the confirm flow untouched.

**Header & mode swap (the stability fix)**
- Make the settings header and the list's search row the *same total height* (search is
  `p-1.5` + `h-8` = 2.75rem; build the header as `h-8` inside `p-1.5`, no `border-y`).
  Header content: back chevron `ButtonUI` + `truncate text-xs font-medium` title. Title for
  entries becomes the entry's *name* (fallback "Edit item" while unnamed) — but note
  `ui-entry-editor.spec.ts:77` asserts `Edit item` is visible; either keep "Edit item" as a
  static subtitle-free header for the new-item case the spec exercises, or update the
  assertion. Prefer keeping the literal "Edit item" for a *new* (unnamed) entry so the spec
  stands.
- Animate the list ↔ settings swap as a layer push: wrap the two states in a
  `<Transition>` with transform-only slide (settings enters from the right ~8px + fade,
  list returns from the left), ~150–200ms, `ease-out`. No height/layout animation. This is
  motion answering the user's click — nothing autoplays.
- Keep everything else about the swap mechanics: `settingsTarget` ref, the `watch(item)`
  auto-back, Escape peeling (`PagesDrawer.onKeydownCapture`), the pinned locale switcher
  staying visible in both states.

## Files

| File | Change |
|---|---|
| `src/components/editor/sidebar/DrawerField.vue` | new — label + control + hint |
| `src/components/editor/sidebar/DrawerSection.vue` | new — uppercase micro-heading + gap |
| `src/components/editor/sidebar/PageSettingsEditor.vue` | rewrite template with the new language; script logic (commit fns, seo/customCode pruning computeds, watches, delete/duplicate) is sound — keep it |
| `src/components/editor/sidebar/EntryFieldControl.vue` | template-only: adopt `DrawerField` for the label line, align gaps to the rhythm; watch the e2e DOM-shape constraint above |
| `src/components/editor/sidebar/PagesDrawer.vue` | header-height parity + the push transition around the settings/list swap; nothing else (list rows, kebabs, locale switcher are out of scope) |
| `e2e/ui-entry-editor.spec.ts` | only if a selector had to change; run it either way |

Do **not** touch `SettingsGroup.vue`, `RowUI.vue`, `SettingsPanel.vue`, `PageSettingsEditor`'s
composable dependencies, or any server code.

## Guardrails (things that look refactorable but aren't)

- `EntryFieldControl`'s `entry` stays a plain prop re-derived by the parent — the comment in
  the file explains why (undo/branch-switch replaces the `project` ref). Don't store refs.
- The `watch(item, → emit('back'))` in `PageSettingsEditor` guards against the target being
  deleted under the panel. Keep it.
- SEO/customCode setters prune empty objects so untouched items stay byte-identical (merge
  signatures). Preserve the exact prune behavior.
- Custom code is `page && canBuild` only — the server 403s a contributor's write.
- The locale switcher sits outside the settings/list `v-else` on purpose (translators need it
  while editing an entry). The new transition must not move it inside.
- No native `title` attributes; tooltips via `v-tooltip` only. Modals/confirm via `useModal`.

## Verification

1. `npm run type-check`.
2. `npm run build && npm run test:e2e` — `ui-entry-editor.spec.ts` is the direct coverage;
   `smoke` and the other UI specs guard the drawer's surroundings.
3. Manual pass in `npm run dev` (needs `npm run serve`): open the drawer → page settings →
   back → entry editor → back; confirm zero horizontal shift on swap, the segmented Status,
   home-page disabled slug, translating-locale hint (switch locale via the pinned switcher
   while the item editor is open), custom-code section absent for entries, and the
   Duplicate/Delete footer. Check both editor themes (`.light` toggle) since everything uses
   theme tokens.
