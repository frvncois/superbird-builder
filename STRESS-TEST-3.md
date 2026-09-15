# Stress test 3 — "Field Notes" (coverage-gap + regression run)

Paste the brief below to the agent verbatim. It is deliberately shaped to force
every tool and path the first two runs skipped, plus the freshly fixed ones.

---

## The brief (paste this)

Build **"Field Notes"** — a trilingual (EN default, FR, DE) online journal +
shop-window for a fictional nature-guide duo. Work in a **draft**, not Main.
Requirements:

**Content model (reference fields — untested):**
- Collection `author` (2 entries): name, bio, portrait (image), role
  (localize:false).
- Collection `article` (6 entries): title, excerpt, body, hero (image),
  gallery (multi-image), **author (reference → author)**, **related
  (multi-reference → article)**, reading-time (localize:false), date.
- Collection `tag` (4 entries, **data-only — no template page**): name, hue.
  Then **delete_collection** on `tag` at the end and verify nothing dangles.
- After creating `article`, flip `reading-time` from localize:true to false
  with **updateFields** (not remove/re-add) and confirm values survived.

**Pages:**
- Home: hero, featured article (`:collection-item`), article grid with
  `listQuery` (sort by date desc, limit 4, offset 1 — the offset slot is
  untested), authors strip.
- Article template: body, author block rendered THROUGH the reference,
  "related" list through the multi-reference, prev/next-style "more" list
  with excludeCurrent.
- About: long-form page using every rich-text inline tag (b/i/u/a/ul/ol/li/br),
  a `:blockquote`-style styled div, anchors (`htmlId` + `@#…` links from the
  header — make them work cross-page with `@/#…`).
- A **draft-status page** (status: draft) that must NOT appear in the export.

**Media — all through upload_media (untested):** upload at least 10 images
via https URLs THROUGH upload_media (not direct URL src), including 1 SVG
used as an image, and use `/media/…` paths everywhere. Use one image as a
**background** with `bg-cover bg-center` (bg-position classes are new).

**Components (regression traps — do these EXACTLY):**
1. Build the header ON the Home page first, including: a self-targeted
   `scrolled` interaction, a mobile hamburger whose button targets a menu
   panel INSIDE the header, and the locale switcher as an EN | FR | DE link
   row using `@locale:` per link. THEN `create_components` it. Publish and
   verify in the browser that scrolled-state, hamburger, and switcher all
   still work on every route incl. /fr/ and /de/ article pages. (This is the
   exact shape that broke twice.)
2. Build a `NewsletterCard` used on Home AND About. After both instances
   exist, change ONLY the link suffixes via `update_component` and confirm
   zero orphans in the response, then insert one new element mid-block and
   confirm per-instance content overrides did not shift.
3. Restyle a master element addressing it by its **master id** directly in
   edit_elements (new capability — no get_page translation).
4. Try to bind an interaction from a PAGE element targeting INTO a component
   instance — expect and report the warning, don't work around it silently.

**Interactions/animations:**
- One interaction edited in place with **update_interaction** (new tool).
- A **breakpoint-scoped binding** (untested): hamburger binding active only
  on the mobile breakpoint; verify the desktop nav never fires it.
- A `change`-trigger conditional form field, and a dismissible banner with
  `once: "session"` — verify once-behavior on the published site, then
  that the editor still shows it.
- Scrub parallax on Home using **`scrub: {smooth: 0.4}`** (new) — verify the
  lag on the published site, and that `?noanim` renders end states.
- A pinned section using the sticky + sibling-marker recipe from the guide.
- An exclusive accordion (`group`) inside a `:collection-list` on the
  article template.

**Localization:**
- Translate EVERYTHING via `get_translation_worklist` → `set_translations`
  with **itemsPath** (new) — the FR and DE batches must go through files,
  zero items inline.
- Component master strings translated ONCE via kind:"master" (there should
  be no per-instance shadows at all after extraction — report if the
  worklist shows any `shadowsMaster` items, that's a regression).
- Then **remove DE** via update_settings and verify every DE override is
  gone (re-add it, confirm the worklist counts reset to untranslated).

**Process rules (the actual stress):**
- Fetch the guide via `get_guide {section:"toc"}` + per-section reads only —
  never the full 57 KB (new capability; report if any section is missing or
  stale).
- Use the 3-call rhythm; address edits by id; when you pre-generate a
  line-addressed batch for a page containing components, use the returned
  **`lineShifts`** instead of hand-offsetting (report if the shifts are
  wrong).
- Deliberately send ONE edit containing a bogus class among valid ops and
  confirm the response reports it under `partial`, not `failed`.
- Deliberately send one write with a stale version and confirm the
  stale-version flow, including after `update_component` (use its returned
  `versions`).
- On every bind, capture the echoed `bindingIds` and later unbind one
  WITHOUT any get_page read.
- Publish at most 4 times total. Before the final publish, run your own
  checklist against the export in the browser: every route in 3→2 locales,
  desktop + 375px, keyboard focus on the modal/accordion, and grep the
  exported HTML for any `data-tgt` key that has no matching effect entry
  (the historical failure signature).
- Finish with **apply the draft to Main** (merge) and confirm Main renders
  identically — this exercises the branch/merge path no run has touched.

Report in the same format as before: call log, bugs with export evidence,
friction, handbook corrections, what worked.

---

## Coverage matrix (why each part is in there)

| Brief element | Exercises |
|---|---|
| reference / multi-reference / data-only collection | never tested; delete_collection cleanup |
| updateFields localize flip | new tool surface (3.6 fix) |
| upload_media + SVG + /media paths | never tested (both runs used raw URLs) |
| bg-center on background media | F3 fix |
| header extraction with scrolled + hamburger + switcher | F1/2.A/2.B/2.C regression, all at once |
| update_component link-only + insertion | 3.2 / 2.D regression |
| master-id addressing | 3.3 fix |
| outside→inside binding attempt | 2.B warning path |
| update_interaction | F7 fix |
| breakpoint-scoped binding | never tested |
| once:session, change trigger | edge triggers, only partially covered |
| scrub smooth + ?noanim | new feature |
| worklist via itemsPath, no shadows, locale removal | 3.4 fix, 3.1 fix, locale purge path |
| toc-only guide reads | F6/3.5 fix |
| lineShifts, partial, bindingIds, versions | F5/F4/F8/3.9 fixes |
| draft + merge to Main | drafts/branches, never touched by an agent |
| draft-status page | export exclusion |
| 4-publish budget + own checklist | forces verification discipline over publish-spam |

## What this still does NOT cover (candidates for run 4)

- Comments (agents can only reply; needs a human-seeded thread first).
- Custom fonts via uploaded font files (vs. Google Fonts URL).
- zip / github publish methods (needs publish-config set server-side).
- Project package export/import (admin HTTP only, not MCP).
- Concurrent human + agent editing on the same page (needs you typing in the
  editor mid-run — worth doing manually once: the stale-version dance is the
  only protection).
- Contributor-role token (does the MCP degrade cleanly on 403s?).
