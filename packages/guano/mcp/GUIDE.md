# Guano — AI Agent Handbook

You are connected to a **running Guano instance**: a self-hosted visual site builder.
Humans edit it in a browser; you edit it through these tools. Both surfaces work on the
same document, so everything here describes the real system — you never need to probe,
guess, or reverse-engineer anything. If a capability is not in this handbook or the tool
list, it does not exist yet: **report it as a limitation instead of working around it.**

## The golden rules

1. **Page structure lives in code.** Each page is a small indentation-based DSL document.
   You write structure by replacing the page code (`set_page_code`).
2. **Everything else lives on elements, via tools.** Styling (Tailwind classes), text
   content, media, and interactions are *not* written into the code — they attach to
   elements through tools (`edit_elements`, `bind_interaction`, …), batched: one
   `edit_elements` call edits many elements at once.
3. **Markers are automatic — never type them.** In the code you may see `(+)` (styled),
   `[+]` (own content), `{+}` (interactions) after element tokens. These are display-only
   indicators the server maintains for the human's editor. Writing them yourself does
   nothing; removing them does nothing. Write clean tokens and let them appear.
4. **Never touch the instance's files or store directly.** If you can see the server's
   `data/` directory or the raw `/api/store` keys, do not edit them: structural edits are
   *reconciled* so elements keep their identity (styles, content, comments, interaction
   targets survive edits). A raw JSON write bypasses that and corrupts the project.
5. **The target is the human's decision — always ask, never assume.** Writes go to a
   target picked once per session with `set_target`: `main` or a draft. Unless the
   user's message already names one, ask exactly one question — *"Work on Main directly,
   or in a draft?"* — and recommend based on context: **Main** for a fresh or empty
   project (a draft is overkill there), **a draft** when the site has real content or a
   human may be editing (drafts are reviewed and merged in the editor). Never create a
   draft the user didn't ask for.

## Workflow recipe

```
get_status                    → who you are, whether a target is set, which drafts exist
set_target                    → ASK the user first: Main or a draft? (their call, not yours)
update_settings               → design tokens / fonts / SEO defaults FIRST (styling uses them)
list_pages → get_page         → read before writing; note the `version` hash
create_page / set_page_code   → write the WHOLE page structure in one call per page
edit_elements                 → classes + content + media + htmlId for MANY elements, one call
upload_media / bind_interaction / entries … → as needed
publish                       → export the target as the live static site
```

Build the **complete structure first, in one `set_page_code` call**, then style and fill
**many elements per `edit_elements` call** — a whole page is typically 2–4 writes total,
never one call per element. Every write returns a `version`; pass the latest one to the
next write on that page. The version hashes the page **code**, so a node-only edit
(classes/content) may legitimately return the SAME version — that is not a lost write.
A `stale-version` rejection means someone else edited — re-run `get_page` and retry.
Writes to **different pages** parallelize freely; writes to the same page are sequential.

**Addressing elements:** after EVERY `set_page_code`, call `get_page` and take the
returned `elements` list — never count lines by hand (closer lines like `section:` make
manual counting drift, and a misaddressed edit lands on the wrong element). Prefer the
element **`id`** as the edit address (stable across structural edits); `line` values are
**0-based** (`numberedCode` is 1-based, for humans). Add `expectType` to edits when
using lines, and check the `type` echoed in each result.

## The DSL

### Document scaffold

Every page has this exact shape — a protected `@setup` block, then a `:body` wrap.
`body:` is always the last line. Indentation is real tabs (`\t`), one element token per
line:

```
@setup
	name: Home
	slug: /
	status: published
	locale: en
:body
	:section
		:h1:
		:paragraph:
	section:
body:
```

The **only** `@setup` keys are `name`, `slug`, `status` (`published` | `draft`), and
`locale`. Any other key (e.g. `title:`, `description:`) is silently dropped — page SEO
goes through `set_page_seo` instead, and site-wide defaults (siteName, titleTemplate,
description) through `update_settings`. Pages are created with `create_page` and removed
with `delete_page` (the home page and collection template pages are protected).

### Leaf vs container — the one syntax rule

- A **leaf** carries text or is void. It is *always* written self-closed: `:h1:`
  `:paragraph:` `:image:`. A leaf never wraps children.
- A **container** *always* opens as `:section` and closes with an un-prefixed
  `section:` on its own line, children indented one tab deeper.

Using the wrong form is a validation error. There is no inline text in the code —
`:h1: Hello` is invalid; text content attaches to the node, not the code (see Content).

### Element registry

Containers (open `:name` … close `name:`):

| type | renders as | | type | renders as |
|---|---|---|---|---|
| `section` | `<section>` | | `nav` | `<nav>` |
| `div` | `<div>` | | `main` | `<main>` |
| `container` | `<div>` | | `aside` | `<aside>` |
| `grid` | `<div>` | | `list` | `<ul>` |
| `header` | `<header>` | | `form` | `<form>` |
| `footer` | `<footer>` | | `video` | `<video>` |
| `article` | `<article>` | | `dropdown`/`select` | `<select>` |

Leaves (always `:name:`):

| type | renders as | default text |
|---|---|---|
| `h1`…`h6` | `<h1>`…`<h6>` | "Lorem ipsum" |
| `heading` | `<h2>` | "Lorem ipsum" |
| `text` | `<div>` | "Lorem ipsum" |
| `paragraph` | `<p>` | "Dolor sit amet" |
| `span` | `<span>` | "Dolor sit amet" |
| `label` | `<label>` | "Label" |
| `button` | `<button>` | "Button" |
| `link` | `<a>` | "Link" |
| `list-item` | `<li>` | "List item" |
| `image` | `<img>` (void) | — |
| `input` | `<input>` (void) | — |

Special: `collection-list` (container) and `collection-item` (leaf) — see Collections.
`body` exists only as the page wrapper; never add, move, or close it yourself.

Form caveats: **forms are visual-only** — `form` exports with no action/method and
nothing submits; every `input` exports as `type="text"` (no email/tel/date); and
`dropdown`/`select` has **no option element**, so it renders as an empty `<select>` —
avoid it (use an `input` plus a hint, and list real form handling in LIMITS).

### `[arg]` — collection field bindings

The square-bracket slot binds an element to a **collection field by name**:
`:h1[title]:` renders the current entry's `title` field. Valid only inside an entry
scope (a collection template page whose body is `:body[postname]`, or inside a
`:collection-list[name]` block). One-hop reference bindings use a dot:
`:h1[author.name]:`. Outside an entry scope an `[arg]` binds nothing.
Do **not** use `[…]` to fake attributes — `[href=...]`, `[src=...]` are invalid syntax.

### `@target` — links, in code

A token may carry a link suffix, glued directly to it:

```
:link:@/about            an internal page path
:button:@#install        an anchor on the page
:link:@https://github.com/you/repo
:link:@mailto:hello@example.com
:link:@item              (inside an entry scope) link to the current entry's page
```

This is the **only** per-element value that lives in the code itself. Use it — links do
not need a separate tool.

**It works on containers too** — `:div@/pricing` … `div:` exports the whole block
wrapped in `<a class="contents">`, so an entire card becomes one clickable region
(put the `@target` on the card wrapper, not just the title). Inside a
`:collection-list`, `:div@item` makes each repeated card link to its entry's page.

### Components and collections in code

- `:Card:` / `:Card` … `Card:` — **capitalized** tokens are component instances. The
  component must already exist in the project; unknown names are validation errors.
  Styles and interactions of elements *inside* an instance live on the shared master —
  element tools will refuse them and tell you so.
- `:collection-list[posts]` … `collection-list:` — repeats its children once per entry
  of the `posts` collection.
- `:collection-item[posts]:` — renders one picked entry through the collection's
  template page.

### Validation

`set_page_code` validates before saving — invalid code returns diagnostics and saves
nothing, so a failed write is always safe to retry with fixed code. It catches: wrong
leaf/container form, unknown element/component/collection names, unclosed containers,
and any stray text (remember: no inline content, no attributes, no CSS classes in code).

## Styling

Styling is Tailwind class tokens attached per element with `edit_elements` — pass one
`edits[]` entry per element (`addClasses` / `removeClasses`, element addressed by `id`
or 0-based `line`) and style **the whole page in one call**. Removes are applied before
adds, so remove+add of the same class is a re-apply, not a removal. It behaves like the
editor's Style panel:

- **Conflicts auto-resolve**: adding `p-8` when `p-4` is present replaces it.
- **Prerequisites auto-add**: adding `grid-cols-3` auto-adds `grid`; `flex-row` adds `flex`.
- **Invalid classes are skipped and reported** in `errors`; the rest still apply.

The validator accepts:

- Classes from the editor's style catalog (layout, spacing, typography, borders,
  effects — the visual controls' vocabulary).
- The full Tailwind color palette for `bg-` / `text-` / `border-` (`bg-slate-100` …).
- Spacing steps `0 1 2 3 4 5 6 8 10 12 14 16 20 24`; negative offsets/margins on the
  same scale (`-bottom-6`, `-mt-4`). Width/height (`w-` `h-` `size-`) run a wider scale
  up to 96 (`h-56`, `h-80` pass). Whitespace control is available
  (`whitespace-pre-wrap`, `whitespace-nowrap`, `break-words`, …).
- **Any arbitrary VALUE**: `p-[13px]`, `text-[2.2rem]`, `bg-[#fffff9]`,
  `text-[clamp(2.75rem,7vw,5.25rem)]`. When a scale class is rejected, an arbitrary
  value is the escape hatch. Arbitrary **PROPERTIES** (`[white-space:pre-wrap]`) are
  NOT supported — only value slots on known utilities.
- Useful non-obvious accepted forms: `bg-[#0d0d0cbb]` (8-digit hex = translucent
  overlays; there is no `bg-token/60` opacity syntax), `font-[Instrument_Serif]`
  (arbitrary font-family — run a display face against the project body font), and
  `group` + `group-hover:` for card-level hover states (put `group` on the card,
  `group-hover:…` on the children).
- Variant prefixes: `hover:` `focus:` `focus-visible:` `active:` `disabled:`
  `group-hover:` `first:` `last:` `sm:` `md:` `lg:` `xl:` `dark:` and arbitrary
  breakpoints `min-[900px]:` / `max-[767px]:`. Other variants (`before:`, `after:`,
  peer, …) are **not** supported.
- Project **design tokens** as color classes: a token named `brand` enables `bg-brand`,
  `text-brand`, `border-brand`.

**Layout gotcha — the published `<body>` is a flex column.** A direct child with
`mx-auto` opts out of flex stretching and shrink-wraps to its content. For full-bleed
sections, put `w-full` (plus any background) on the section itself and constrain an
inner `:div` with `max-w-… mx-auto` — don't put `max-w`/`mx-auto` directly on a
top-level section/header/footer.

**Set design tokens FIRST** (`update_settings { tokens: [{name, value}] }`) and style
with `bg-<token>`/`text-<token>`/`border-<token>` instead of repeating arbitrary hex
values — tokens are the project's theming system, the single place a human retheme
happens. Token names are kebab-case, values are `#hex`, and these palette names are
reserved: `slate gray red orange amber yellow lime green emerald teal cyan sky blue
indigo violet purple fuchsia pink rose neutral stone zinc white black transparent
current inherit`.

## Content, media, data

Element text/media attaches to the node, not the code. Write it with `edit_elements`:

- **`content`** — the element's own text. **Leaf elements only** (a container never
  holds text directly; put a leaf inside it). Plain text, or inline rich markup limited
  to `<b> <strong> <i> <em> <u> <mark> <br> <ul> <ol> <li> <a href="…">` — anything
  else is stripped by the sanitizer (no `<span>`, no attributes/classes on inline tags).
  `<mark>` is the highlight element. `""` clears back to the placeholder — a truly
  EMPTY leaf is not expressible, so build decorative dots/spacers/rules from `:div`
  containers (styled, no content), never from text leaves.
- **`src`** — image/video elements only: a `/media/<id>` path (media library), an
  `https://` URL, or a `data:image/…` / `data:video/…` URL.
- **`background`** — any element: background media layered behind its content (image →
  CSS background, video → a video layer). Same URL rules as `src`; `""` clears.
- **`htmlId`** — the html `id` attribute; this is how anchor targets work
  (`htmlId: "install"` ↔ `:link:@#install`).
- **`arg`** — rebind or clear the token's `[…]` field binding without rewriting the
  page code (`arg: "title"` / `arg: ""`); on `:collection-list`/`item` it must name a
  real collection.
- Batch them: classes, content, src, background, htmlId, arg, listQuery, and
  interaction bindings can all ride in the same `edits[]` entry — one call covers the
  whole page.

**Media library**: `list_media` gives every asset's `/media/<id>` url; `upload_media`
adds one from a base64 data URL (images/video/audio/pdf/fonts — the server validates
type, size, and quota). Prefer library assets over inline `data:` srcs — inline data
bloats the project blob.

For **repeating / structured content**, use collections instead of own content: create
a collection (`create_collection`, starts with one text field `title`), shape its schema
with `update_collection` (`addFields`: text | image | date | reference |
multi-reference; `removeFields`), add entries with `upsert_entry` (`values` maps field
*names* to strings), and bind elements with `[field]` args. Entry `name`/`slug` are
identity; only `values` bind. An element with a `[field]` binding shows the bound value
in entry scope — its own `content` is ignored there. `delete_collection` removes the
collection and its template page.

**Lists can limit/filter/sort**: set `listQuery` on a `:collection-list` element via
`edit_elements` — `{limit: 3, sortField: "published", sortDir: "desc", filter:
{field: "featured", equals: "yes"}}` (or `filter: {field, notEmpty: true}`;
`sortField: "createdAt"` sorts by entry creation). Filter → sort → limit; base field
values compare numeric-aware, so ISO dates sort naturally. `null` clears. This is how
you build "latest 3" and "featured" blocks.

Collection tips: **name collections singular** (`post`, `feature`) — the template page
claims the `/<name>` route and entries render at `/<name>/<slug>`, so the plural stays
free for your index page. A binding and a link target combine on one token —
`:link[title]:@item` renders each entry's title linking to its page (perfect for docs
sidebars/blog lists). A `:collection-list` nested inside a template page works (list
all entries while rendering one). Bound field values pass through the same rich-text
sanitizer, so `<br>` inside a field renders as a real line break (the workaround for
multi-line code blocks — leading indentation still collapses).

**Localization**: pass a non-default `locale` to `edit_elements` (content/src) or
`upsert_entry` (values) to write per-locale overrides; an empty string deletes the
override, and the default locale is always the base content. Classes and htmlId are
never localized.

## Components

Shared blocks (header, footer, cards) so a nav change is ONE edit, not one per page:

- `create_component {pageId, id, name}` — an existing element's subtree becomes the
  master; the original block is wrapped as `:Name … Name:` (an instance).
- Write `:Name:` in any page's code — `set_page_code` expands it into the full block.
- **Styles/interactions on inner elements are shared**: `edit_elements` on any
  instance's elements lands on the master (the result says so) and affects every
  instance. **Text content stays per-instance** — set it on each page's instance.
- `update_component {componentId, code}` — replace the structure with a full
  `:Name … Name:` block; every instance block on every page is rewritten to match
  (same-type nodes keep their identity and styles).
- `list_components` — names, structure, instance counts.
- Components cannot nest other components.

## Interactions — toggles and mobile nav

A `click` trigger **toggles** (fire/unfire), and base classes that style the same
property as the interaction's classes are **removed while fired** — so `hidden` →
`flex` works. The hamburger recipe:

```
:button:  (the hamburger — content "Menu")     bind: {trigger: click, targetId: <menu id>}
:div      (the menu)   classes: hidden flex-col …
```

with a library interaction whose `toClasses` is `flex` (plus any panel styling).
Clicking shows the menu, clicking again hides it. This works **inside a shared
header/footer component** too — bind the button and target the panel; both must be
elements of the same component instance (the binding and its target resolve on the
master, so every page's header toggles independently).

## Project settings

`get_settings` / `update_settings` manage the project-level pieces:

- **`tokens`** — the design-token palette (see Styling). The array you pass REPLACES the
  list, so read first when editing incrementally.
- **`seo`** — site defaults: `siteName`, `titleTemplate` (`%s` = page name),
  `description`. Per-page overrides: `set_page_seo`.
- **`fonts`** — `family` (the base font-family) and `googleFontsUrl` (a
  `https://fonts.googleapis.com/…` CSS URL, emitted as a stylesheet link in exports).
- **`customCodeHead`** — raw HTML injected into every exported `<head>`. Reserved for
  font loading (`@font-face`, preload links) — do not use it to inject scripts, styling
  hacks, or content; if something seems to need that, report it as a limitation instead.

## Interactions

The project has a shared interaction library (named class-swap animations):

- `create_interaction` — name + `toClasses` (validated Tailwind), optional
  `duration` / `easing`. Returns the id.
- **Bind in batch**: put `bindInteractions: [{interactionId, trigger}]` on the
  `edit_elements` edits — one call binds a whole page's animations along with their
  base-state classes (e.g. `opacity-0 translate-y-8 transition-all`; the interaction
  supplies the end state). `bind_interaction`/`unbind_interaction` (by element `id` or
  `line`) exist for one-off tweaks; trigger is `hover` | `click` | `appear`, and you
  OMIT `targetId` for the element itself.
- Any bound interaction adds a small (~1.5 KB) runtime script to the published site.
  For simple hover styling, prefer a pure `hover:` class — zero JS.

## Drafts, publishing, comments

- Drafts are full project copies. `set_target {createDraft: "name"}` snapshots Main into
  a new draft and selects it. Humans merge drafts back to Main in the editor ("Drafts"
  panel); `publish` exports **your current target** directly as the live static site —
  so publishing a draft skips that merge review. Which mode to use is the user's choice
  (golden rule 5); when they picked a draft, let them apply and publish from the editor
  unless they tell you to publish directly.
- The published site is fully static (per-route HTML + one CSS file); unpublished
  (`status: draft`) pages are excluded. You can verify by fetching the site root.
- `list_comments` / `reply_to_comment` — comments are humans' feedback channel on pages;
  read them to find change requests, reply to report what you did.

## Current tool gaps (report, don't hack)

Known missing capabilities, so state them as limits instead of improvising: no tool
yet for **breakpoints**, the project **favicon**, domain/smtp/publishing config,
per-page `<script>` injection, media folder management or asset rename/delete (list +
upload only), renaming a collection, creating new comment threads (you can only
reply), **per-entry SEO** (a template's seo applies verbatim to every entry page — no
field interpolation), **functional forms** (visual-only: no action, text-only inputs,
empty selects), or truly empty leaf elements. `date` fields render their raw ISO
value (no formatting — use a text field for display dates). The `@link` code suffix
is the supported way to set links.
