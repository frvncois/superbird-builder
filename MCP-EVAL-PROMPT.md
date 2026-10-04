# MCP evaluation session — prompt for Claude Desktop

Paste everything below the line into a fresh Claude Desktop conversation with the
`guano` MCP server connected. The instance must be running (`npm run serve`) and the
token must be admin or editor. The **agent policy** (server-side only, no UI:
`server/data/agent-policy.json`, or `PUT /api/agent-policy` from a logged-in admin
session) must have `allowMainWrites` and `allowPublish` set to `true` — a fresh data
dir resets both to `false`, in which case the agent can only work in a draft and
cannot publish.

---

You are connected to **Guano**, a visual website builder, through its MCP server. This is
an **evaluation session**: the goal is not the website itself but to exercise every
capability of the toolset while building a realistic site, and then to write a precise
report of what worked, what did not, what cost more calls than it should have, and
what you would change — in the tools, the guide, or the app.

Work as a careful, honest colleague. Do not route around a problem silently: when a
tool refuses, errors, surprises you, or returns something you had to work around, note
it at the moment it happens (keep a running log) and keep going. Never fabricate a
success. If something is genuinely blocked, say so and move on to the next part.

## 0. Before building

1. `get_guide` (no section) — read the golden rules and the section list. Then read
   these sections, one call each: `page-html`, `components`, `slots`, `variants`,
   `nesting`, `styling`, `design-standards`, `content-media-data`,
   `class-interactions`, `animations`, `forms`, `sliders`, `icons`,
   `drafts-publishing-comments`. (Note anything in the guide that is unclear,
   contradictory, or that you later found to be wrong.)
2. `get_status`, then `set_target` so the human picks Main or a draft. If the client
   shows a dialog, it is the human's answer. Work in **Main** for this session.
3. `get_settings`. Record the starting state (empty or not).

## 1. The site to build

**"Ridgeline"** — a small outdoor-gear rental company in Montréal. Bilingual (en
default, fr). It needs:

- **Design tokens first** (`update_settings {tokens}`): a semantic palette
  (`background foreground primary primary-foreground secondary muted
  muted-foreground accent card border input ring destructive` + foreground pairs) and
  a font pairing (`fonts`). Then **project SEO defaults** and a **favicon** (make a
  simple one-colour SVG, keep it as a file with `asFile: true`, set it).
- **Components, built once, from scratch** — there is no bundled library. Build at least:
  - `Button` with two variant axes (`variant`: default / outline / ghost; `size`: sm /
    md / lg), an optional leading icon (a hidden part an instance can show).
  - `Badge`, `Input`, `Select` (styled, `appearance-none` + drawn chevron), `Textarea`.
  - `Card` that **holds** `Button` (nesting) and has a **slot** for its body.
  - `Navbar` (sticky, holds `Button`, a mobile menu that opens with a class
    interaction) and `Footer`.
  - `Modal` with a **slot** (overlay, panel, close button; open/close is ONE effect
    driven by the trigger, the overlay and the close button).
  - `Accordion` (exclusive group) and `Tabs` (panel 1 visible without JS; no `appear`
    trigger for the default panel).
  - `GearCard` for the collection template (image, name, price, badge, a `Button`).
  Verify in `list_components` that none of these became a colour-twin of another.
- **A CMS collection** `gear` (fields: name, slug, category select, price number,
  image, gallery multi-image, description rich text, available boolean, a reference to
  a `category` collection) with 8 entries across 3 categories, and a `category`
  collection. One collection with detail routes, one data-only.
- **Pages**:
  - **Home**: hero with a `load` animation (staggered, on children — not the
    container), a `collection-list` of featured gear using `GearCard` with a
    `listQuery` filter and a `list-empty` state, a **slider** bound to a collection
    (and one static slider), a testimonials section, a CTA with a `Modal` instance
    whose slot holds a signup form, the `Accordion` as FAQ.
  - **Gear** (the template page of `gear`): field-bound elements, a `fieldAttrs`
    binding (e.g. `data-status` → the availability field, with `data-[status=…]:`
    classes), a related-items list filtered by the current entry's category
    (`excludeCurrent`), JSON-LD structured data if the tools allow it.
  - **About**: `scroll`/`scrub` animations, a `scrolled` header effect, a `Tabs`
    instance.
  - **Contact**: a real `form` (enabled) with `form-success` / `form-error` blocks,
    an `Input`/`Select`/`Textarea` per field, a `change`-triggered interaction.
  - A **404**-style or draft page to check `status` handling.
- **Interactions & animations**: use both engines, including one effect with both
  halves (class change + tween) on the same trigger; an `appear` once-only; a hover on a
  repeated card (per-row scope); a click that targets an element OUTSIDE its list row
  (the shared-sheet case). Bind at least one by `targetRef`.
- **Icons**: Lucide icons via `list_icons` + `edit_elements {icon}`, and one custom
  inline SVG. Do NOT upload one-colour SVGs to the media library (expect a refusal if
  you try; try once on purpose and record it).
- **Media**: upload at least 3 images (by `url` from a public source, or `dataUrl`),
  use them as `src`, `background` and in entries.
- **Localization**: add `fr`, then `get_translation_worklist` and `set_translations`
  for every element, attribute, and entry — aim for zero missing.
- **Comments**: leave 2 comments for the human reviewer; reply to one.
- **Preview and publish**: `preview` at least twice during the build, then `publish`.
  Read every warning `publish` returns, fix what is fixable, publish again, and keep
  the final warning list for the report.
- **Edit-after-the-fact**: once the site exists, do a round of realistic maintenance
  edits: rename a component, change a variant's classes, move a section with
  `edit_structure`, detach one instance, re-read a page and write it back unchanged
  (`set_page_html` with the exact HTML you were given — it must report nothing
  changed), delete a component with `detach: true`.

Use `pages: […]` batching, `items`, and `ref`/`part` addressing wherever the guide says
to. Prefer the cheap path (`edit_structure`, `edit_elements` by ref) over rewriting
whole pages. Keep a count of your tool calls per task.

## 2. The report

When done, write the report **as a page on the site itself** named `Session report`
with `status: draft` (so it is not published), AND print it in full in this chat. Use
these headings, be specific, and quote the exact tool, arguments (trimmed) and response
for anything that went wrong:

1. **Summary** — what got built, what did not, publish state, final warning list.
2. **Call log** — a table: task · tools used · number of calls · calls that failed or had
   to be repeated · wall-clock impression (slow responses).
3. **Refusals and errors** — every one, with: was the message accurate? Did it tell you
   the tool that could do it? Was the refusal right, or should it have been allowed?
4. **Surprises** — anything that behaved differently from the guide or from what the
   tool description led you to expect; stale-version conflicts and why they happened;
   writes that reported success but did not render (check with `preview`/`publish`).
5. **Cost** — where you spent the most tokens or calls, which reads were bigger than
   needed, which tasks needed a second read you think should not be necessary.
6. **Guide feedback** — sections that were missing, wrong, too long, or that you had to
   read twice. Quote the sentence.
7. **Tool API feedback** — per tool: parameters you wanted, parameters you never used,
   responses with fields that were noise or that lacked what you needed, naming that
   misled you.
8. **App/renderer issues** — anything visible in the preview/published site that looked
   wrong: layout, missing styles, effects that did not fire, locale routes, forms.
9. **Security/guardrail observations** — anything you could do that you think an agent
   should not be able to, and anything you were blocked from that you think was
   legitimate.
10. **Top 10 changes** you would make, ranked by impact, each in one sentence with the
    evidence from above.

Be blunt. A report that says "everything worked" is only useful if it is true; the
useful report is the one that names the friction.
