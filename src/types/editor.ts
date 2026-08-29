/** a reusable animation stored in the project library and shared across
 * elements — the "what happens" (classes + timing), reused by many bindings */
export interface Interaction {
  id: string
  name: string
  /** tailwind classes applied to the target while the interaction is active */
  toClasses: string
  duration: string // e.g. 'duration-300'
  easing: string // e.g. 'ease-out'
}

/** an element applying a saved interaction — the "when/where" (trigger +
 * target) is per-application, the animation is shared via interactionId */
export interface InteractionBinding {
  id: string
  /** the saved Interaction (project.interactions) this applies */
  interactionId: string
  trigger: 'hover' | 'click' | 'appear'
  /** node the effect applies to; null = the trigger element itself */
  targetId: string | null
}

/** one AND-combined row of an element's condition — see lib/shared/conditions.js */
export interface ConditionRule {
  id: string
  /** field: entry field path ('featured', 'author.name') · context: locale|page|index|first|last
   *  runtime: viewport|date|query.<param> (browser-evaluated) */
  source: 'field' | 'context' | 'runtime'
  path: string
  op: 'eq' | 'neq' | 'contains' | 'empty' | 'notEmpty' | 'gt' | 'lt'
  value: string
}

/** an element's conditional behavior: when every rule matches, the effect
 * applies — hide/show the element, or swap its content/media */
export interface ConditionSpec {
  rules: ConditionRule[]
  effect: 'hide' | 'show' | 'swap'
  swapContent?: string
  swapSrc?: string
}

export interface ElementNode {
  id: string
  type: string
  content?: string
  /** Tailwind classes applied in the canvas — single source of truth
   * for the Style panel, both its visual controls and the raw input */
  classes?: string
  /** saved interactions applied to this element (their effect may target another node) */
  interactions?: InteractionBinding[]
  /** conditional visibility / content swap (node-only state, like classes) */
  conditions?: ConditionSpec
  /** html id attribute, set in the Data panel */
  htmlId?: string
  /** media source (data URL or remote) for image/video elements */
  src?: string
  /** background media (a /media/<id> URL) layered behind the element's content;
   * image → CSS background-image, video → an absolutely-positioned <video> layer.
   * node-only visual state like classes/src */
  background?: string
  /** per-locale overrides for editable content; base content/src is the default locale */
  locales?: Record<string, { content?: string; src?: string }>
  /** navigation target for link elements — internal '/path' or absolute URL */
  link?: string
  /** token argument from the code — field binding or collection name */
  arg?: string
  /** collection-item only: the picked entry */
  entryId?: string
  children: ElementNode[]
  /** Source range in the page code (0-based line indexes, open → close) */
  line?: number
  endLine?: number
}

export interface Breakpoint {
  id: string
  name: string
  width: number
  height: number
}

export interface Page {
  id: string
  name: string
  path: string
  status: string
  /** Source in the builder syntax; elements is derived from it */
  code: string
  elements: ElementNode[]
  /** set when this page is a collection's template */
  collectionId?: string
  /** per-page SEO overrides (global defaults live in project.settings.seo) */
  seo?: { title?: string; description?: string }
  /** per-page custom JavaScript, injected (export-only) as <script> tags:
   * `head` at the top of the page, `body` before </body> */
  customCode?: { head?: string; body?: string }
}

export interface CollectionField {
  id: string
  name: string
  type: 'text' | 'image' | 'date' | 'reference' | 'multi-reference'
  /** reference/multi-reference: the collection the field points into */
  refCollectionId?: string
}

export interface CollectionEntry {
  id: string
  name: string
  /** entry's own slug segment; full path is /<collection>/<slug> */
  slug: string
  /** field name → value; reference = target entry id, multi-reference = ids.
   * References live only here (base) — they are never locale-overridden. */
  values: Record<string, string | string[]>
  /** per-locale field overrides; base values is the default locale */
  locales?: Record<string, Record<string, string>>
  createdAt: number
}

export interface Collection {
  id: string
  /** lowercase slug used in the syntax: :collection-list[post] */
  name: string
  fields: CollectionField[]
  templatePageId: string
  entries: CollectionEntry[]
}

export interface CommentReply {
  id: string
  text: string
  /** display name of the author (dummy until the API is wired) */
  author: string
  createdAt: number
}

/** anchors a comment to an element: a fractional position (0–1) within the
 * element's box, so the pin reflows/scales and resolves in any view that
 * renders the node (editor canvas + content preview) */
export interface CommentAnchor {
  nodeId: string
  rx: number
  ry: number
}

export interface Comment {
  id: string
  pageId: string
  /** element anchor (new comments) — positions the pin from the node's live rect */
  anchor?: CommentAnchor
  /** legacy canvas position — breakpoint the comment is pinned in, or null for page */
  breakpointId?: string | null
  /** legacy canvas position: relative to the breakpoint frame, or world coords */
  x?: number
  y?: number
  text: string
  /** display name of the author (dummy until the API is wired) */
  author: string
  resolved: boolean
  createdAt: number
  replies: CommentReply[]
}

export interface ComponentDef {
  id: string
  /** Capitalized, unique — used as the :Name: syntax token */
  name: string
  /** master tree; node ids are the "master ids" instances override by */
  root: ElementNode
}

export interface DesignToken {
  id: string
  /** kebab-case, becomes bg-<name>/text-<name>/border-<name> */
  name: string
  /** hex color */
  value: string
}

export interface ProjectSettings {
  /** data URL; extracted to a file at publish */
  favicon?: string
  seo: {
    siteName: string
    /** '%s' = page name */
    titleTemplate: string
    description: string
    ogImage?: string
  }
  /** bare domain (example.com) — canonical/og URLs in exports when set */
  domain: string
  /** stored config only; redacted from the public snapshot endpoint */
  smtp: { host: string; port: string; user: string; password: string; from: string }
  /** Tailwind theme tokens (colors) */
  tokens: DesignToken[]
  /** raw HTML injected into exported <head> */
  customCode: { head: string }
  fonts: { family: string; googleFontsUrl?: string }
}

export interface Project {
  id: string
  name: string
  pages: Page[]
  components: ComponentDef[]
  collections: Collection[]
  /** shared interaction library — applied to elements by id */
  interactions: Interaction[]
  /** shared across all pages — they map to global CSS media queries */
  breakpoints: Breakpoint[]
  comments: Comment[]
  /** registered locale codes; always contains defaultLocale */
  locales: string[]
  /** the locale that base content/src/values belong to */
  defaultLocale: string
  settings: ProjectSettings
}
