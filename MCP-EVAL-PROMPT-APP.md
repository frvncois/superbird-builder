# MCP evaluation session #2 — an APP prototype

The sibling of `MCP-EVAL-PROMPT.md`, which built a marketing site (Ridgeline). This one
builds an **app shell**: dense repeated rows, shared state, a child collection, a
sidebar of links that are all one component. That is a different stress — the first run
found renderer bugs, this one should find reuse and addressing bugs.

Paste everything below the line into a fresh Claude Desktop conversation with the
`guano` MCP server connected.

**Before you start:**

1. The instance is running (`npm run serve`) and the token is admin or editor.
2. The **agent policy** (`server/data/agent-policy.json`, or `PUT /api/agent-policy`
   from a logged-in admin session) has `allowMainWrites` and `allowPublish` set to
   `true`. A fresh data dir resets both to `false`, and then the agent can only work in
   a draft and cannot publish.
3. **Take a snapshot first** (Settings → Backup → Snapshots). This session fills the
   instance with throwaway data; the snapshot is how you get your real project back.
4. Decide Main vs draft before you paste. The prompt says Main, because publish
   warnings and the live render are half of what is being measured.

---

You are connected to **Guano**, a visual website builder, through its MCP server. This
is an **evaluation session**. The goal is not the app: it is to exercise the toolset
hard enough to find where it is wrong, and then to write a report precise enough to act
on. The app is the vehicle.

Work like a careful colleague who will have to defend every line of the report. Three
rules, and they matter more than finishing:

- **Never route around a problem silently.** When a tool refuses, errors, surprises
  you, or makes you do something twice, write it down the moment it happens, with the
  call and the response. Then keep going.
- **Separate what you SAW from what you THINK caused it.** Write observations as
  observations ("`kept: 6`, but the close binding ended up on the trigger") and causes
  as hypotheses ("I think ids are ignored — not verified"). The last evaluation's most
  important finding came with a confident diagnosis that turned out to be wrong, and
  the wrong diagnosis would have led to a fix that broke working behaviour.
- **Verify before you assert.** "It works" counts only if you looked: at the exported
  HTML, at the preview in a browser, at the response you got back. If you could not
  check something, say "not verified" rather than assuming.

## 0. Before building

1. `get_guide` (no section), then read these one call each: `page-html`, `components`,
   `slots`, `variants`, `nesting`, `styling`, `design-standards`,
   `content-media-data`, `class-interactions`, `animations`, `forms`, `sliders`,
   `icons`, `drafts-publishing-comments`. Note anything unclear, contradictory, or that
   you later find to be wrong — quote the sentence.
2. `get_status`, then `set_target`. Work in **Main**.
3. `get_settings`, `list_pages`, `list_components`, `list_collections`, `list_media`.
   Record the starting state exactly, including whether `mainIsEmpty` matches what you
   actually see.

## 1. The app to build

**"Harbour"** — a small-team project tracker, the kind of internal app a studio runs on.
Bilingual (en default, fr). It is an APP, so it has a persistent shell: a sidebar, a
topbar, and screens that swap inside them.

### Data

Three collections, which between them should use **every field type**:

- `project` — detail routes ON. Fields: name, slug, `status` (**select**: active /
  paused / shipped), `budget` (**number**), `archived` (**boolean**), `owner`
  (**reference** → person), `cover` (image), `gallery` (**multi-image**), `brief` (rich
  text).
- `task` — **data-only**. Fields: title, `project` (**reference** → project), `done`
  (**boolean**), `effort` (**number**), `priority` (**select**: low / normal / urgent).
- `person` — **data-only**. Fields: name, role, avatar (image).

Seed 4 people, 6 projects across all three statuses, and 15 tasks spread over the
projects (so a project detail page has several and at least one has none).

### Components — built once, from scratch, and reused

There is no bundled library. Build at least:

- **`NavItem`** — an icon + a label, one component, used **nine times** in the sidebar
  and topbar, each instance pointing at a **different destination** and showing a
  different icon and label. Do not build nine components, and do not fall back to plain
  elements. If you cannot give each instance its own destination, stop and record
  exactly what you tried and what the tool said.
- **`Button`** with two variant axes (`variant`: default / outline / ghost; `size`: sm /
  md / lg) and an optional leading icon (a hidden part an instance shows).
- **`Field`** — a label plus a control, with a **`textarea`** variant of it, and a
  **`Select`** (`appearance-none`, a drawn chevron, a **slot** for its options). These
  are the controls a form is built from, and each placement names its own control.
- **`StatTile`**, **`Badge`**, **`Avatar`**.
- **`ProjectRow`** — the repeated row: cover, name, a status **pill coloured by the
  data** (bind an attribute to the `status` field and style it with `data-[status=…]:`
  classes), budget, owner's avatar, and a `Button`. It **holds** `Button` and `Badge`
  (nesting).
- **`Card`** with a **slot** for its body.
- **`Sheet`** — a side panel with an overlay, opened and closed by ONE effect, with its
  trigger inside the component.
- **`Tabs`** (panel 1 visible with no JS — do not use an `appear` trigger for the
  default panel) and **`Accordion`** (exclusive group, with a **chevron icon that
  rotates when the section opens**).

Check `list_components` afterwards: none of these should be a colour-twin of another.

### Screens

Build at **three breakpoints**, and check the narrow one — an app shell that only works
at desktop width is the common failure.

- **Dashboard** (home): the shell (sticky sidebar + topbar), a row of `StatTile`s, a
  filtered `collection-list` of `ProjectRow` with a `list-empty` state, and a
  **quick-view `Sheet` that lives OUTSIDE the list** and is opened by a button in every
  row. (Think about what that means for binding scope. If it does not work, that is a
  finding — check the published page, not just the canvas.)
- **Project detail** (the `project` template page): field-bound heading, cover with
  **alt text bound to a field**, the status pill, the `brief`, a gallery, and the
  project's **tasks** — a list of the `task` entries whose `project` reference IS this
  entry. Also try "other projects with the same status as this one" and record what
  happens.
- **Settings**: a **real enabled form** built from `Field` / `Select` / textarea
  instances, each named per placement, with `form-success` and `form-error` blocks and
  a `change`-triggered interaction. Publish and confirm the exported `<form>` carries
  every field name.
- **Sign in**: create it as a **draft**, build it, then publish it later in the session
  and confirm the route appears.
- A **language switcher** in the shell. Open the published French route in a browser
  and click it. Say whether it actually navigates.

### Behaviour

- Both motion engines, including one effect that wears **both halves** (a class change
  and a tween) on one trigger.
- An `appear` once-only; a hover on a repeated row (per-row, not all rows at once); a
  `scrub` on the detail page; a `scrolled` topbar.
- The accordion chevron rotation (above) — an effect whose **target is an `<svg>`**.
- Bind at least one effect by `targetRef`, and at least one by an id you read out of
  the page HTML. Use the id **exactly as the read printed it**.
- Icons from `list_icons`, plus one custom inline SVG.
- At least 3 uploaded images, used as `src`, as a `background`, and in entries.

### Localization

Add `fr`, then `get_translation_worklist` → `set_translations` until
`missingTranslatable` is 0. Then publish and confirm the counter was telling the truth:
read the French routes and find anything still in English.

### Things to try ON PURPOSE

Each of these should be refused or should fail. For each, record **what happened** and
**whether the message told you what to do instead**:

1. Put a `class` on a component instance's wrapper.
2. Bind an effect from a page button to an element inside a component instance.
3. Put a `data-field` binding on an element inside a component instance.
4. Upload a one-colour SVG to the media library.
5. Delete a component that another component holds.
6. Echo the **same `data-id` onto two elements** in one `set_page_html`.
7. Filter a list on a reference field using the target entry's **slug**.
8. Write a `select` field value that is not one of its options.
9. Address an element by the short `data-id` the read printed, in `edit_elements`,
   `edit_structure` and `bind_interaction`.
10. Re-send a page's exact HTML unchanged and check that nothing is reported as changed.

### Maintenance round

Once it all exists, do a realistic round of edits: rename a component, change a
variant's classes, move a section with `edit_structure`, detach one instance, publish a
page that was a draft, change a page's slug, delete a component with `detach: true`.
Confirm after each that the pages still render what they did before.

### Preview, publish, comments

- `preview` after each screen rather than publishing. Read the warnings it returns and
  fix what is fixable **before** publishing.
- `publish` at the end. Keep the final warning list, and for each warning say whether
  you agree with it.
- Leave **two comments** for the human: one anchored to an element where you had to
  guess, one on a page about something you could not build. Reply to one.

Use `pages: […]` batching, `items`, and `ref`/`part` addressing wherever the guide says
to. Prefer the cheap path (`edit_structure`, `edit_elements` by ref) over rewriting a
page. Keep a count of calls per task as you go — you will need it.

## 2. The report

Write it as a page on the site named `Session report`, `status: draft`, AND print it in
full in the chat. Same headings as before, plus §0:

0. **Evidence table** — every claim in §3, §4 and §8 as one row: *what I observed* ·
   *how I checked it* (response / exported HTML / browser) · *what I think caused it* ·
   *confirmed or hypothesis*. If a row cannot be filled in, the claim does not belong in
   the report.
1. **Summary** — what got built, what did not and why, publish state, final warnings.
2. **Call log** — a table: task · tools · calls · failed or repeated calls · slow
   responses.
3. **Refusals and errors** — every one. Was the message accurate? Did it name the tool
   that *can* do it? Was the refusal right, or should it have been allowed? Flag any
   message that sent you looking in the wrong place.
4. **Surprises** — anything that behaved differently from the guide or the tool
   description. Especially: writes that reported success and did not render, and
   stale-version conflicts with what caused them.
5. **Cost** — biggest reads, reads bigger than they needed to be, and every task that
   needed a **second read you think should not have been necessary**. Give byte or call
   numbers.
6. **Guide feedback** — missing, wrong, too long, or read twice. Quote the sentence.
7. **Tool API feedback** — per tool: parameters you wanted, parameters you never used,
   response fields that were noise or missing, names that misled you.
8. **App/renderer issues** — anything wrong in the preview or the published site:
   layout at each breakpoint, missing styles, effects that did not fire, the French
   routes, the language switcher, the form.
9. **Security/guardrail observations** — anything you could do that an agent should not
   be able to; anything you were blocked from that was legitimate.
10. **Top 10 changes**, ranked, one sentence each, each pointing at its evidence row.

Finally, one short section: **what you would tell the next agent** — the three things
you wish you had known before the first call.

Be blunt. "Everything worked" is only useful if it is true, and it almost never is. The
report that earns its keep is the one that names the friction.
