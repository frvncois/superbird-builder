// Data-driven content for the Documentation center. Guide tone: each section
// is a short how-to article — lead, anchorable headings, numbered steps,
// callouts, and code examples with static rendered previews.

import type { Component } from 'vue'
import {
  Zap,
  Braces,
  Paintbrush,
  Keyboard,
  Shapes,
  Component as ComponentIcon,
  Database,
  Languages,
  MousePointerClick,
  MessageCircle,
  GitBranch,
  Eye,
  Rocket,
  FileCode,
} from 'lucide-vue-next'

export type DocCalloutTone = 'tip' | 'note' | 'warning'

export interface DocStep {
  title: string
  text: string
  code?: string[]
}

/** node of the static mock rendered in a code-preview's right pane */
export interface DocPreviewNode {
  el: 'heading' | 'text' | 'button' | 'media' | 'row' | 'stack'
  text?: string
  children?: DocPreviewNode[]
}

export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'keys'; rows: { keys: string[]; does: string }[] }
  | { kind: 'defs'; rows: { term: string; text: string }[] }
  | { kind: 'code'; caption?: string; lines: string[]; component?: boolean }
  | { kind: 'codePreview'; caption?: string; lines: string[]; preview: DocPreviewNode[]; component?: boolean }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; steps: DocStep[] }
  | { kind: 'callout'; tone: DocCalloutTone; text: string }

export interface DocSection {
  id: string
  title: string
  group: string
  /** icon shown in the sidebar, hub card, and section header */
  icon: Component
  /** one-line description for the hub card and section header */
  lead: string
  blocks: DocBlock[]
}

export const DOC_GROUPS = ['Basics', 'Building', 'Content', 'Collaboration', 'Release'] as const

/** stable anchor id for a heading block inside a section */
export function docHeadingId(sectionId: string, text: string): string {
  return `${sectionId}--${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/** headings of a section, in order — feeds the outline rail and search */
export function docHeadings(section: DocSection): { id: string; text: string }[] {
  return section.blocks
    .filter((b): b is Extract<DocBlock, { kind: 'heading' }> => b.kind === 'heading')
    .map((b) => ({ id: docHeadingId(section.id, b.text), text: b.text }))
}

/** true when a section matches a search query: title, lead, headings, or shortcut names */
export function docSectionMatches(section: DocSection, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (section.title.toLowerCase().includes(q) || section.lead.toLowerCase().includes(q)) return true
  return section.blocks.some((b) => {
    if (b.kind === 'heading') return b.text.toLowerCase().includes(q)
    if (b.kind === 'keys') return b.rows.some((r) => r.does.toLowerCase().includes(q))
    return false
  })
}

/** anchor id of the first heading matching the query, if any */
export function docFindAnchor(section: DocSection, query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const hit = section.blocks.find((b) => b.kind === 'heading' && b.text.toLowerCase().includes(q))
  return hit && hit.kind === 'heading' ? docHeadingId(section.id, hit.text) : null
}

export const DOC_SECTIONS: DocSection[] = [
  // ---------------------------------------------------------------- Basics
  {
    id: 'quick-start',
    title: 'Quick start',
    group: 'Basics',
    icon: Zap,
    lead: 'What Superbird is and how to build your first page.',
    blocks: [
      {
        kind: 'p',
        text: 'Superbird is a visual website builder. You describe each page in a small, readable syntax; the canvas renders it live while you style elements, edit content, add interactions, and publish — without leaving the browser.',
      },
      { kind: 'heading', text: 'The workspace' },
      {
        kind: 'defs',
        rows: [
          { term: 'Code editor', text: 'Left pane — the page structure in the Superbird syntax, one token per line. Typing here is how structure changes.' },
          { term: 'Canvas', text: 'Center — a live, zoomable preview of the page across all your breakpoints at once.' },
          { term: 'Settings sidebar', text: 'Right — Data, Style, Interactions, Custom code, and Drafts panels for whatever is selected.' },
          { term: 'Header', text: 'Top — page switcher, locale switcher, comments, project settings, Preview, and Publish.' },
        ],
      },
      { kind: 'heading', text: 'Two ways to edit' },
      {
        kind: 'defs',
        rows: [
          { term: 'Editor', text: 'The full three-pane builder — structure, style, and logic. For admins and editors.' },
          { term: 'Content mode', text: 'The site as a single live preview for in-place text and media edits, translations, and comments. Contributors work here.' },
        ],
      },
      { kind: 'heading', text: 'Build your first page' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Add elements',
            text: 'Type in the code editor, or press ⌘E to open the insert dock and drag elements onto the page.',
            code: [':section', '\t:h1:', '\t:paragraph:', 'section:'],
          },
          {
            title: 'Select something',
            text: 'Click an element on the canvas, or click its line in the code. With nothing picked, the page body is selected.',
          },
          {
            title: 'Style, fill, animate',
            text: 'Type ( at the end of an element token (e.g. :h1() to open Style, [ to open Data for content and bindings, { to open Interactions for animations.',
          },
          {
            title: 'Preview it',
            text: 'Press Preview in the header to browse the site in Content mode, exactly as visitors will see it.',
          },
          {
            title: 'Publish',
            text: 'Press Publish to export a fast static site. Only pages marked as published are included.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'Press ? anywhere in the editor to reopen this documentation.',
      },
    ],
  },
  {
    id: 'syntax',
    title: 'Syntax',
    group: 'Basics',
    icon: Braces,
    lead: 'The small indentation-based language behind every page.',
    blocks: [
      {
        kind: 'p',
        text: 'A page is plain text: one token per line, tabs for nesting. Leaf elements close themselves; block elements open and close around their children. The editor normalizes as you type, so you can’t break the format.',
      },
      { kind: 'heading', text: 'Elements' },
      {
        kind: 'codePreview',
        caption: 'A leaf element renders itself — no closing line needed.',
        lines: [':h1:'],
        preview: [{ el: 'heading', text: 'Heading' }],
      },
      {
        kind: 'codePreview',
        caption: 'A block wraps its indented children between :name and name: lines.',
        lines: [':section', '\t:h1:', '\t:paragraph:', 'section:'],
        preview: [
          {
            el: 'stack',
            children: [
              { el: 'heading', text: 'Heading' },
              { el: 'text', text: 'Paragraph text' },
            ],
          },
        ],
      },
      { kind: 'heading', text: 'Arguments' },
      {
        kind: 'p',
        text: 'A token can carry an argument in brackets. Arguments bind elements to collection fields, name the collection a list repeats over, or mark a page as a collection template.',
      },
      {
        kind: 'defs',
        rows: [
          { term: ':h1[title]:', text: 'Binds the element to the “title” field of the current entry.' },
          { term: ':collection-list[post]', text: 'Repeats its children once per entry of the “post” collection.' },
          { term: ':collection-item[post]:', text: 'Renders one picked entry through the collection’s template.' },
          { term: ':body[post]', text: 'In @setup — marks the page as the “post” collection’s template.' },
        ],
      },
      { kind: 'heading', text: 'Links' },
      {
        kind: 'p',
        text: 'Add @ after any element token to make it a link. Type @ in the code editor for suggestions: pages, external schemes, and — inside a collection list — the current item.',
      },
      {
        kind: 'defs',
        rows: [
          { term: ':link:@item', text: 'Links to the current collection entry’s page (inside a list or template).' },
          { term: ':div@/about', text: 'Links the element to an internal page.' },
          { term: ':button:@https://…', text: 'Links to an external URL; @mailto:… and @tel:… work too.' },
        ],
      },
      { kind: 'heading', text: 'Components' },
      {
        kind: 'codePreview',
        caption: 'Capitalized tokens are components. Type :Card: on a line and it expands into the full block.',
        component: true,
        lines: [':Card', '\t:h2:', '\t:paragraph:', 'Card:'],
        preview: [
          {
            el: 'stack',
            children: [
              { el: 'heading', text: 'Card title' },
              { el: 'text', text: 'Card body text' },
            ],
          },
        ],
      },
      { kind: 'heading', text: 'The page scaffold' },
      {
        kind: 'code',
        caption: 'Every page starts with a @setup block (name, slug, status, locale) and wraps its content in :body … body:.',
        lines: ['@setup', 'name: Home', 'slug: /', 'status: published', '@setup', '', ':body', '\t…', 'body:'],
      },
      {
        kind: 'callout',
        tone: 'warning',
        text: 'The @setup block and the :body … body: wrap are protected — the editor rebuilds them on every edit, so they can’t be broken or removed.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'The code editor suggests completions as you type — press Tab to accept the ghost text.',
      },
    ],
  },
  {
    id: 'styling',
    title: 'Styling',
    group: 'Basics',
    icon: Paintbrush,
    lead: 'The class-based styling system, the Style panel, and design tokens.',
    blocks: [
      {
        kind: 'p',
        text: 'Styling is powered by Tailwind: every element carries a list of utility classes, and that list is the single source of truth for how it looks. The Style panel is a visual editor over those classes — everything it does, it does by adding and removing class tokens.',
      },
      { kind: 'heading', text: 'The Style panel' },
      {
        kind: 'p',
        text: 'Type ( on an element’s token in the code editor (e.g. :h1() and the panel opens for that element; press Escape when you’re done and the token closes as (+) — the marker that the element carries styles. The panel is an accordion of property groups — Layout, Size, Spacing, Text, Color, Background, Border, Effects, Transitions, Transform, and Interactivity — each with visual controls that write the right class for you.',
      },
      {
        kind: 'list',
        items: [
          'Controls are context-aware: position offsets appear once an element is positioned, gap and alignment once it’s flex or grid.',
          'Every control shows the class it set, so the visual editor doubles as a way to learn the class names.',
        ],
      },
      { kind: 'heading', text: 'The class input' },
      {
        kind: 'p',
        text: 'At the top of the panel, the class field shows the element’s full class list as removable chips. If you know Tailwind, type classes directly — any valid utility works.',
      },
      {
        kind: 'code',
        caption: 'An element’s classes are just a Tailwind class list.',
        lines: ['flex items-center gap-4 rounded-xl bg-background p-6'],
      },
      {
        kind: 'list',
        items: [
          'Typed classes are validated — typos are rejected instead of silently doing nothing.',
          'Adding a class that conflicts with an existing one on the same property replaces it: typing p-8 removes p-6.',
          'Prerequisites are injected automatically: adding items-center to a plain block also adds flex.',
        ],
      },
      { kind: 'heading', text: 'Design tokens' },
      {
        kind: 'p',
        text: 'Project Settings → Tokens holds your design tokens — brand colors, fonts, and other theme values. Tokens are compiled into the Tailwind theme, so each one becomes usable in classes (a “brand” color token gives you bg-brand, text-brand, border-brand, and so on). Change the token once and every element using it updates.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'Right-click an element to copy its style classes and paste them onto another element.',
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Classes compile live on the canvas — anything Tailwind v4 supports, including arbitrary values like w-[340px], works immediately.',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    group: 'Basics',
    icon: Keyboard,
    lead: 'Every keyboard shortcut in the editor and canvas.',
    blocks: [
      { kind: 'heading', text: 'Elements' },
      {
        kind: 'keys',
        rows: [
          { keys: ['⌘', 'C'], does: 'Copy the selected element' },
          { keys: ['⌘', 'X'], does: 'Cut the selected element' },
          { keys: ['⌘', 'V'], does: 'Paste after the selection' },
          { keys: ['⌘', 'D'], does: 'Duplicate the selection' },
          { keys: ['⌘', 'G'], does: 'Wrap the selection in a div' },
          { keys: ['⌫'], does: 'Delete the selection' },
        ],
      },
      { kind: 'heading', text: 'History' },
      {
        kind: 'keys',
        rows: [
          { keys: ['⌘', 'Z'], does: 'Undo' },
          { keys: ['⌘', '⇧', 'Z'], does: 'Redo' },
          { keys: ['⌘', 'S'], does: 'Save now' },
        ],
      },
      { kind: 'heading', text: 'Canvas' },
      {
        kind: 'keys',
        rows: [
          { keys: ['Space', 'Drag'], does: 'Pan the canvas' },
          { keys: ['⌘', 'Scroll'], does: 'Zoom toward the cursor' },
          { keys: ['⌘', '+'], does: 'Zoom in' },
          { keys: ['⌘', '−'], does: 'Zoom out' },
          { keys: ['⌘', '0'], does: 'Reset the view' },
          { keys: ['C', 'Click'], does: 'Place a comment' },
        ],
      },
      { kind: 'heading', text: 'Panels & code' },
      {
        kind: 'keys',
        rows: [
          { keys: ['⌘', 'E'], does: 'Open the insert dock' },
          { keys: ['Tab'], does: 'Accept the suggestion / indent' },
          { keys: ['⌘', '⇧', '↑↓'], does: 'Extend the selection to the sibling above/below' },
          { keys: ['⌘', '⇧', 'S'], does: 'Open Style for the selection' },
          { keys: ['⌘', '⇧', 'D'], does: 'Open Data for the selection' },
          { keys: ['⌘', '⇧', 'I'], does: 'Open Interactions for the selection' },
          { keys: ['Esc'], does: 'Close the panel, back to the code' },
          { keys: ['?'], does: 'Open this documentation' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------- Building
  {
    id: 'elements',
    title: 'Elements',
    group: 'Building',
    icon: Shapes,
    lead: 'Select, style, and edit the building blocks of a page.',
    blocks: [
      {
        kind: 'p',
        text: 'Everything on a page is an element — headings, text, media, sections, lists. Each element has content, style classes, and interactions of its own.',
      },
      { kind: 'heading', text: 'Selecting' },
      {
        kind: 'list',
        items: [
          'Click an element on the canvas, or click its line in the code editor — the two stay in sync.',
          'With nothing picked, the page body is selected, so page-level styles are always one click away.',
          '⌘⇧↑ / ⌘⇧↓ extends the selection to siblings for multi-element moves and edits.',
        ],
      },
      { kind: 'heading', text: 'The editing panels' },
      {
        kind: 'defs',
        rows: [
          { term: 'Data (type “[” on the element token)', text: 'Text content, media source, links, html id, and collection bindings for the element.' },
          { term: 'Style (type “(” on the element token)', text: 'Tailwind classes through visual controls — layout, spacing, type, color — or the raw class input. Styled elements show a (+) marker in the code.' },
          { term: 'Interactions (type “{” on the element token)', text: 'Apply an animation from the shared library with a trigger and a target. Elements with interactions show a {+} marker in the code.' },
        ],
      },
      {
        kind: 'p',
        text: 'To reopen a panel on an element that already carries [field], (+) or {+}, rest the caret inside the brackets for a moment — the matching panel opens.',
      },
      { kind: 'heading', text: 'Adding & arranging' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Insert',
            text: 'Press ⌘E for the insert dock and drag an element onto the canvas, or just type its token in the code.',
          },
          {
            title: 'Reorder',
            text: 'Drag elements directly on the canvas, or drag lines in the code editor’s gutter.',
          },
          {
            title: 'Right-click for more',
            text: 'The context menu has duplicate, copy/paste, delete — plus copy & paste of style classes and interactions between elements.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'Double-click any text on the canvas to edit it inline, without opening a panel.',
      },
    ],
  },
  {
    id: 'components',
    title: 'Components',
    group: 'Building',
    icon: ComponentIcon,
    lead: 'Reusable blocks you define once and use anywhere.',
    blocks: [
      {
        kind: 'p',
        text: 'A component is a reusable block written with a capitalized token. Its structure lives right in the page code and stays fully editable — there is no separate component editor.',
      },
      { kind: 'heading', text: 'Create a component' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'From a selection',
            text: 'Select one or more elements, right-click, and choose Create component. The selection is replaced by an instance.',
          },
          {
            title: 'Or from code',
            text: 'Write a capitalized block by hand — any new capitalized token becomes a component.',
            code: [':Card', '\t:h2:', '\t:paragraph:', 'Card:'],
          },
          {
            title: 'Reuse it',
            text: 'Type :Card: on its own line anywhere and it expands into a full instance.',
          },
        ],
      },
      { kind: 'heading', text: 'What’s shared, what’s local' },
      {
        kind: 'defs',
        rows: [
          { term: 'Shared', text: 'Style, interactions, and structure belong to the master — editing them on any instance updates every instance.' },
          { term: 'Per-instance', text: 'Content (text, media) stays local, so each Card can say something different.' },
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Structural edits sync when the block is complete — while you’re mid-typing inside an instance, other instances wait.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'Right-click an instance and choose Detach from component to make it a plain block again.',
      },
    ],
  },

  // --------------------------------------------------------------- Content
  {
    id: 'collections',
    title: 'Collections',
    group: 'Content',
    icon: Database,
    lead: 'CMS content types: fields, entries, and template pages.',
    blocks: [
      {
        kind: 'p',
        text: 'A collection is a content type — blog posts, projects, team members. It owns a set of fields, its entries (the rows), and a template page that defines how one entry renders.',
      },
      { kind: 'heading', text: 'Binding syntax' },
      {
        kind: 'defs',
        rows: [
          { term: ':collection-list[name]', text: 'Repeats its children once per entry — your index and grid layouts.' },
          { term: ':collection-item[name]:', text: 'Renders one picked entry through the collection’s template.' },
          { term: '[field]', text: 'On any element inside a list or template, binds it to a field: :h1[title]:.' },
          { term: ':body[name]', text: 'In a page’s @setup — marks that page as the collection’s template.' },
        ],
      },
      { kind: 'heading', text: 'Link to an entry' },
      {
        kind: 'p',
        text: 'To make each row of a list open its own entry page, give any element in the row a link and turn on “Link to entry” in the Data panel. Each rendered row then points at that entry’s page — /collection/slug — automatically.',
      },
      {
        kind: 'code',
        caption: 'In code, add @item to any element inside a collection list.',
        lines: [':collection-list[post]', '\t:div@item', '\t\t:h2[title]:', '\tdiv:', 'collection-list:'],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'The toggle appears whenever an element sits inside a collection-list or on a template page. Any element type can link — text, image, button, or a whole row.',
      },
      {
        kind: 'codePreview',
        caption: 'A list of posts: the children repeat for every entry, each bound field filled from that entry.',
        lines: [':collection-list[post]', '\t:h2[title]:', '\t:paragraph[excerpt]:', 'collection-list:'],
        preview: [
          {
            el: 'stack',
            children: [
              { el: 'heading', text: 'First post' },
              { el: 'text', text: 'Excerpt of the first post…' },
            ],
          },
          {
            el: 'stack',
            children: [
              { el: 'heading', text: 'Second post' },
              { el: 'text', text: 'Excerpt of the second post…' },
            ],
          },
        ],
      },
      { kind: 'heading', text: 'Edit entries' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Open an entry',
            text: 'Use the page selector in the header — entries are listed under their collection. Adding one starts a new row.',
          },
          {
            title: 'Edit on the template',
            text: 'The template page opens in the context of that entry; bound elements show and edit the entry’s values directly on the canvas.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'The template is a real page — style it like any other, and every entry inherits the layout.',
      },
    ],
  },
  {
    id: 'localization',
    title: 'Localization',
    group: 'Content',
    icon: Languages,
    lead: 'Translate your content into any number of locales.',
    blocks: [
      {
        kind: 'p',
        text: 'Locales are project-wide. Your base content lives in the default locale; every other locale stores only overrides on top of it, so untranslated pieces always have something to show.',
      },
      { kind: 'heading', text: 'Translate the site' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Add a locale',
            text: 'In Project Settings → General, add the locales your site should speak.',
          },
          {
            title: 'Switch to it',
            text: 'Use the Localization dropdown to make it the active locale. The canvas now shows that language.',
          },
          {
            title: 'Override text and media',
            text: 'Edit content as usual — your changes are saved as overrides for the active locale only.',
          },
        ],
      },
      { kind: 'heading', text: 'Fallbacks' },
      {
        kind: 'p',
        text: 'Anything not yet translated falls back to the default locale and renders dimmed while editing, so gaps are easy to spot. Clearing an override returns the element to the fallback.',
      },
      {
        kind: 'callout',
        tone: 'tip',
        text: 'Content mode is the fastest place to translate — switch locale in the header and click through the site.',
      },
    ],
  },
  {
    id: 'interactions',
    title: 'Interactions',
    group: 'Content',
    icon: MousePointerClick,
    lead: 'A shared library of animations with triggers and targets.',
    blocks: [
      {
        kind: 'p',
        text: 'Interactions are animations you define once and apply to any element. The animation itself is shared — editing it updates every element that uses it — while the trigger and target are chosen per element.',
      },
      { kind: 'heading', text: 'Anatomy' },
      {
        kind: 'defs',
        rows: [
          { term: 'Animation', text: 'The shared part: the classes to apply, plus duration and easing.' },
          { term: 'Trigger', text: 'Per element — hover, click, or appear (when scrolled into view).' },
          { term: 'Target', text: 'Per element — which node the classes land on: itself by default, or any other element.' },
        ],
      },
      { kind: 'heading', text: 'Apply one' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Open Interactions',
            text: 'Type { on the element’s token in the code editor (e.g. :h1{). Press Escape when you’re done — elements with interactions show a {+} marker.',
          },
          {
            title: 'Pick or create an animation',
            text: 'Choose from the library, or create a new one with its to-classes, duration, and easing.',
          },
          {
            title: 'Set trigger and target',
            text: 'Choose when it fires and what it affects. The canvas fires interactions live so you can test immediately.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'The to-classes apply to the target while the interaction is active and transition both ways — no separate “reverse” animation needed.',
      },
    ],
  },

  // ---------------------------------------------------------- Collaboration
  {
    id: 'comments',
    title: 'Comments',
    group: 'Collaboration',
    icon: MessageCircle,
    lead: 'Feedback pinned to elements, visible everywhere.',
    blocks: [
      {
        kind: 'p',
        text: 'Comments are pinned to elements, not screen positions — pins reflow with the layout and show up in both the editor and Content mode.',
      },
      { kind: 'heading', text: 'Leave a comment' },
      {
        kind: 'keys',
        rows: [{ keys: ['C', 'Click'], does: 'Place a comment on the element under the cursor' }],
      },
      { kind: 'heading', text: 'Work with threads' },
      {
        kind: 'list',
        items: [
          'Click a pin to open its thread — write, reply, resolve, or delete.',
          'The comments popover in the header lists every thread; filter by all, pending, or resolved.',
          'Toggle “Display on canvas” to hide pins while you work.',
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Comments are shared across all drafts — feedback follows the project, not the copy you’re editing.',
      },
    ],
  },
  {
    id: 'branches',
    title: 'Drafts',
    group: 'Collaboration',
    icon: GitBranch,
    lead: 'Private copies of the site you can edit and merge when ready.',
    blocks: [
      {
        kind: 'p',
        text: 'A draft is a full private copy of the site — try a redesign or prepare a campaign without touching what’s live, then merge it when it’s ready. The header pill always shows whether you’re editing the live site or a draft.',
      },
      { kind: 'heading', text: 'Work in a draft' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Create one',
            text: 'Open the Drafts panel in the right sidebar and press New draft. Give it a name and an optional note — you’re switched onto it immediately.',
          },
          {
            title: 'Edit freely',
            text: 'Everything works as usual — pages, components, settings. The live site stays untouched, and the draft’s row shows what you’ve changed.',
          },
          {
            title: 'Merge it',
            text: 'Press Merge to review your changes, settle any conflicts, and put the draft live. Afterwards you choose to keep the draft or delete it.',
          },
        ],
      },
      { kind: 'heading', text: 'How merging works' },
      {
        kind: 'p',
        text: 'Merging compares three versions — the snapshot taken when the draft was created, the live site today, and your draft — item by item: pages, components, collections, interactions, breakpoints, and settings. Only what changed moves over.',
      },
      {
        kind: 'callout',
        tone: 'warning',
        text: 'When the same item changed in the draft and on the live site, it’s a conflict — you pick a side from two cards, and the live site’s version wins unless you choose the draft’s.',
      },
    ],
  },
  {
    id: 'content-mode',
    title: 'Content mode',
    group: 'Collaboration',
    icon: Eye,
    lead: 'A live, navigable preview for in-place content edits.',
    blocks: [
      {
        kind: 'p',
        text: 'Press Preview in the header to open Content mode: the site as one live page — no code, no panels, no breakpoint frames. Made for writing, translating, and reviewing.',
      },
      { kind: 'heading', text: 'Navigate & edit' },
      {
        kind: 'list',
        items: [
          'Click links to browse the site normally.',
          'Double-click text to edit it inline; double-click an image or video to replace it.',
          'Links follow on a single click — double-click a link to edit its text instead.',
          'Hold C and click to leave a comment.',
          'Switch locale from the header to translate in place.',
          'Press Open editor to jump back to the builder on the same page.',
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Contributors always work in Content mode — the structural editor is reserved for admins and editors.',
      },
    ],
  },

  // ---------------------------------------------------------------- Release
  {
    id: 'publishing',
    title: 'Publishing',
    group: 'Release',
    icon: Rocket,
    lead: 'Ship your project as a fast static site.',
    blocks: [
      {
        kind: 'p',
        text: 'Publishing exports your project as plain static files — HTML, one stylesheet, and a tiny interaction runtime. No app, no loading spinners; just a fast site.',
      },
      { kind: 'heading', text: 'Before you publish' },
      {
        kind: 'defs',
        rows: [
          { term: 'Domain', text: 'Project Settings → Domain — used for canonical and social-sharing URLs.' },
          { term: 'SEO', text: 'Project Settings → SEO for site-wide defaults; each page can override its own title and description.' },
          { term: 'Page status', text: 'Only pages marked published are exported — drafts are skipped.' },
        ],
      },
      { kind: 'heading', text: 'Publish' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Check the dot',
            text: 'The dot next to Publish shows whether the live site is behind your latest changes.',
          },
          {
            title: 'Press Publish',
            text: 'The site is exported and goes live immediately. Publish again any time — each publish replaces the last.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Publishing requires the admin or editor role — contributors can edit content but not ship it.',
      },
    ],
  },
  {
    id: 'custom-code',
    title: 'Custom code',
    group: 'Release',
    icon: FileCode,
    lead: 'Add custom JavaScript to pages or the whole site.',
    blocks: [
      {
        kind: 'p',
        text: 'For the few things a builder shouldn’t do for you — analytics, embeds, custom behavior — attach JavaScript to a page or to the whole site.',
      },
      { kind: 'heading', text: 'Where code runs' },
      {
        kind: 'defs',
        rows: [
          { term: 'Head', text: 'Runs at the top of the page — for scripts that must load early.' },
          { term: 'Body', text: 'Runs just before </body>, after the DOM is ready.' },
          { term: 'Site-wide', text: 'Project Settings → Code injects head code into every page.' },
        ],
      },
      { kind: 'heading', text: 'Add it' },
      {
        kind: 'steps',
        steps: [
          {
            title: 'Open the panel',
            text: 'Select the Custom code panel in the right sidebar while on the page you want to script.',
          },
          {
            title: 'Write plain JavaScript',
            text: 'Your code is wrapped in a <script> tag automatically — no markup needed.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'warning',
        text: 'Custom code runs on the published site only — the editor preview never executes it.',
      },
    ],
  },
]
