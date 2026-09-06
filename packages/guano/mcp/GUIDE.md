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
5. **Ask before writing to Main.** Writes go to a target you pick once per session with
   `set_target`: `main` or a draft. Writing to Main can clobber a human's in-progress
   work; drafts are the safe mode. Ask the user which they want.

## Workflow recipe

```
get_status                    → who you are, whether a target is set, which drafts exist
set_target                    → ask the user: main, an existing draft, or createDraft
update_settings               → design tokens / fonts / SEO defaults FIRST (styling uses them)
list_pages → get_page         → read before writing; note the `version` hash
create_page / set_page_code   → write the WHOLE page structure in one call per page
edit_elements                 → classes + content + media + htmlId for MANY elements, one call
upload_media / bind_interaction / entries … → as needed
publish                       → export the target as the live static site
```

Build the **complete structure first, in one `set_page_code` call**, then style and fill
**many elements per `edit_elements` call** — a whole page is typically 2–4 writes total,
never one call per element. Every write returns a new `version`; pass the latest one to
the next write. A `stale-version` rejection means someone else edited — re-run
`get_page` and retry.

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
- Spacing on the editor's scale only: steps `0 1 2 3 4 6 8 10 12 16 20 24`
  (so `py-4` and `py-6` pass, `py-5` does not).
- **Any arbitrary value**: `p-[13px]`, `text-[2.2rem]`, `bg-[#fffff9]`, `max-w-[1340px]`,
  `w-[8px]`. When a scale class is rejected, an arbitrary value is always the escape hatch.
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
happens. Token names are kebab-case and may not shadow Tailwind palette names
(`red`, `slate`, …); values are `#hex`.

## Content, media, data

Element text/media attaches to the node, not the code. Write it with `edit_elements`:

- **`content`** — the element's own text. **Leaf elements only** (a container never
  holds text directly; put a leaf inside it). Plain text, or inline rich markup limited
  to `<b> <strong> <i> <em> <u> <mark> <br> <ul> <ol> <li> <a href="…">` — anything
  else is stripped by the sanitizer (no `<span>`, no attributes/classes on inline tags).
  `<mark>` is the highlight element. `""` clears back to the placeholder.
- **`src`** — image/video elements only: a `/media/<id>` path (media library), an
  `https://` URL, or a `data:image/…` / `data:video/…` URL.
- **`background`** — any element: background media layered behind its content (image →
  CSS background, video → a video layer). Same URL rules as `src`; `""` clears.
- **`htmlId`** — the html `id` attribute; this is how anchor targets work
  (`htmlId: "install"` ↔ `:link:@#install`).
- Batch them: classes, content, src, background, and htmlId can all ride in the same
  `edits[]` entry, and one call covers the whole page.

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

**Localization**: pass a non-default `locale` to `edit_elements` (content/src) or
`upsert_entry` (values) to write per-locale overrides; an empty string deletes the
override, and the default locale is always the base content. Classes and htmlId are
never localized.

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
- `bind_interaction` — attach to an element by `line` with `trigger`
  (`hover` | `click` | `appear`) and `targetId` (`null` = the element itself).
- Any bound interaction adds a small (~1.5 KB) runtime script to the published site.
  For simple hover styling, prefer a pure `hover:` class — zero JS.

## Drafts, publishing, comments

- Drafts are full project copies. `set_target {createDraft: "name"}` snapshots Main into
  a new draft and selects it. Humans merge drafts back to Main in the editor ("Drafts"
  panel); `publish` exports **your current target** directly as the live static site —
  so publishing a draft skips that merge review. Prefer: build in a draft, let the human
  apply and publish, unless they tell you to publish directly.
- The published site is fully static (per-route HTML + one CSS file); unpublished
  (`status: draft`) pages are excluded. You can verify by fetching the site root.
- `list_comments` / `reply_to_comment` — comments are humans' feedback channel on pages;
  read them to find change requests, reply to report what you did.

## Current tool gaps (report, don't hack)

Known missing capabilities, so state them as limits instead of improvising: no tool yet
to create or edit **components** (instances of existing ones work; styles inside
instances live on the master, which only a human can edit), **breakpoints**, the
project **favicon**, domain/smtp/publishing config, per-page `<script>` injection,
media folder management or asset rename/delete (list + upload only), renaming a
collection, or creating new comment threads (you can only reply). The `@link` code
suffix is the supported way to set links.
