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
/** what a trigger does to its target's state */
export type InteractionAction = 'toggle' | 'on' | 'off'

/** hover / scrolled / change are symmetric (they drive both directions and
 * ignore `action`); click is discrete and honours `action`; appear fires once */
export type InteractionTrigger = 'hover' | 'click' | 'appear' | 'scrolled' | 'change'

export interface InteractionBinding {
  id: string
  /** the saved Interaction (project.interactions) this applies */
  interactionId: string
  trigger: InteractionTrigger
  /** node the effect applies to; null = the trigger element itself */
  targetId: string | null
  /** breakpoint ids this application is active on; `undefined` = all (the
   * default). Stored in project breakpoint order; omitted when all are on so
   * untouched bindings stay byte-identical for merge signatures. */
  breakpoints?: string[]
  /** click only: force the effect on / off instead of toggling. Together with
   * state being keyed by (interaction, target) — see lib/shared/interactionKeys.js
   * — this is what makes an open button + a close button + an overlay work.
   * `undefined` = 'toggle'. */
  action?: InteractionAction
  /** gestures that force the effect OFF while it is on: a pointerdown outside
   * both the trigger and the target, and/or the Escape key. */
  closeOn?: ('outside' | 'escape')[]
  /** exclusive group: turning this effect on turns off every other effect in the
   * same group. Scoped per component instance but SHARED across a
   * collection-list's repeats, so "one accordion open at a time" works. */
  group?: string
  /** remember the effect's state so a dismissal sticks. Published site only —
   * the editor always shows the element so it stays authorable. */
  once?: 'session' | 'local'
  /** 'scrolled' only: px of page scroll past which the effect is on (default 50) */
  scrollAt?: number
}

/** a property the motion engine can tween. Units and neutral values live in
 * MOTION_PROPS (src/lib/shared/motion.js) — the single source of truth. */
export type AnimProp =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotate'
  | 'opacity'
  | 'blur'
  | 'brightness'
  | 'saturate'
  | 'bgColor'
  | 'textColor'
  | 'borderColor'
  | 'width'
  | 'height'
  | 'clipTop'
  | 'clipRight'
  | 'clipBottom'
  | 'clipLeft'

/** one property's journey inside a step. `from` omitted = start from the
 * element's current computed value (measured at play time).
 * Values are a number (the property's default unit) or a string carrying one
 * — '110%', '1em', '50vw' — so a move can be relative to the element or the
 * viewport. Both sides of a tween must use the same unit. */
export interface AnimationTrack {
  prop: AnimProp
  from?: number | string
  to: number | string
}

/** one segment of a timeline: a set of tracks sharing duration/easing */
export interface AnimationStep {
  id: string
  tracks: AnimationTrack[]
  /** milliseconds */
  duration: number
  /** key into EASINGS ('linear', 'ease-out', 'back-out'…) */
  easing: string
  /** ms from the previous step's END; negative overlaps. Omitted = 0. */
  offset?: number
  /** per-child delay (ms) when the target has children. Omitted = none.
   * Only the STAGGERED tracks move the children — unstaggered tracks in the
   * same step still move the element itself. */
  stagger?: number
  /** narrows a staggered step to matching descendants instead of direct
   * children (e.g. 'img'). Requires `stagger`. Published site + Preview only. */
  staggerSelector?: string
  /** extra iterations; -1 = forever. Omitted = play once. */
  repeat?: number
  /** reverse every other iteration. Omitted = false. */
  yoyo?: boolean
}

/** a reusable timeline in the project library — the "what happens",
 * shared across elements exactly like Interaction */
export interface Animation {
  id: string
  name: string
  steps: AnimationStep[]
}

/** an element playing a saved Animation — the "when/where" */
export interface AnimationBinding {
  id: string
  /** the saved Animation (project.animations) this plays */
  animationId: string
  trigger: 'load' | 'appear' | 'scrub' | 'hover' | 'click'
  /** node the animation moves; null = the trigger element itself */
  targetId: string | null
  /** appear only. Omitted = inherit settings.motion.appearMode (default 'once'). */
  appearMode?: 'once' | 'replay' | 'reverse'
  /** appear only: the viewport fraction the element's top must cross before
   * firing (0.8 ≈ ScrollTrigger's 'top 80%'). Omitted = fire on first pixel. */
  appearAt?: number
  /** scrub only: viewport fractions the element's top travels between,
   * progress 0 → 1. Omitted = { start: 1, end: 0.25 }. */
  /** smooth: seconds the play lags scroll (exponential catch-up, published runtime) */
  scrub?: { start?: number; end?: number; smooth?: number }
  /** breakpoint ids this binding is active on; omitted = all (see
   * InteractionBinding — same byte-stability discipline) */
  breakpoints?: string[]
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
  /** saved animations played by this element (may target another node) */
  animations?: AnimationBinding[]
  /** custom HTML attributes (allowlisted; node-only state, like classes).
   * see lib/shared/attributes.sanitizeAttributes */
  attributes?: Record<string, string>
  /** html id attribute, set in the Data panel */
  htmlId?: string
  /** media source (data URL or remote) for image/video elements */
  src?: string
  /** icon only: the inline `<svg>` markup it renders — a bundled Lucide icon or
   * a custom SVG, ALWAYS the output of shared/svg.sanitizeInlineSvg. Node-only
   * state like `src`, and per-instance inside a component the same way. */
  svg?: string
  /** not rendered and not exported. Node-only state, and per-instance inside a
   * component: an instance hides a part for itself, or — with an explicit
   * `false` — shows one its component hides by default. Omitted = inherit. */
  hidden?: boolean
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
  /** client ref from the code ('#name') — a stable address for this element.
   * CODE-OWNED like `arg`: re-read on every parse, never carried by reconcile
   * as node state, never in NODE_STATE_KEYS or the marker signature. It emits
   * NOTHING in the HTML — `htmlId` is the separate, node-owned DOM id. */
  ref?: string
  /** collection-item only: the picked entry */
  entryId?: string
  /** collection-list only: filter → sort → limit applied to the entries it
   * repeats (node-only state, like classes; see shared/fields.applyListQuery) */
  listQuery?: {
    limit?: number
    /** skip the first N entries after sort, before limit (decouples slot
     * placement — hero/lead/stack — from the CMS schema) */
    offset?: number
    sortField?: string
    sortDir?: 'asc' | 'desc'
    filter?: { field: string; equals?: string; notEmpty?: boolean }
    /** hand-picked entry ids to include; absent = all entries */
    pick?: string[]
    /** in entry scope (a collection template), drop the entry being viewed —
     * the "related posts / more from" pattern */
    excludeCurrent?: boolean
  }
  /** slider only: carousel configuration (node-only state, like listQuery).
   * Absent = every default; see shared/slider.js */
  slider?: SliderConfig
  children: ElementNode[]
  /** Source range in the page code (0-based line indexes, open → close) */
  line?: number
  endLine?: number
}

/** :slider configuration. Every field is optional — an absent config renders a
 * working carousel on SLIDER_DEFAULTS, and the Data panel prunes back to
 * absent so an untouched slider stays byte-identical for merge signatures. */
export interface SliderConfig {
  /** prev/next chrome, default true */
  arrows?: boolean
  /** pagination dots, default true */
  dots?: boolean
  /** slides visible at once, keyed 'base' (the widest breakpoint, applying
   * everywhere) plus breakpoint ids for narrower overrides — the desktop-first
   * model the class cascade uses. Values 1–8; entries equal to what they'd
   * inherit are pruned. */
  perView?: Record<string, number>
  /** space between slides in px, default 0 */
  gap?: number
  /** auto-advance, default false. Never runs under prefers-reduced-motion */
  autoplay?: boolean
  /** autoplay interval in ms, default 4000 */
  delay?: number
  /** wrap around at the ends, default false */
  loop?: boolean
  /** mouse drag (touch swipe is native scrolling either way), default true */
  drag?: boolean
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
  /** authorship/timestamps — stamped on create and on every content edit.
   * Optional so projects saved before tracking existed still load. */
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface CollectionField {
  id: string
  name: string
  type: 'text' | 'image' | 'date' | 'reference' | 'multi-reference' | 'multi-image'
  /** reference/multi-reference: the collection the field points into */
  refCollectionId?: string
  /** text fields only: false marks the field non-translatable (label names,
   * catalog numbers, proper nouns) so the translation worklist skips it.
   * Absent/true = translatable. */
  localize?: boolean
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
  /** draft/published — an entry can now be held back independently of its
   * template page. Absent = 'published' (back-compat with older entries). */
  status?: string
  /** per-entry SEO overrides; falls back to the template page's SEO, then
   * the site defaults. Values may contain {field} tokens. */
  seo?: { title?: string; description?: string }
  createdAt: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface Collection {
  id: string
  /** lowercase slug used in the syntax: :collection-list[post] */
  name: string
  fields: CollectionField[]
  templatePageId: string
  entries: CollectionEntry[]
  /** false = a DATA-ONLY collection: rendered inside other pages, with no page
   * of its own. No template page is created, no entry routes are exported, and
   * an `@item` link to it is a diagnostic. Absent/true = a page per entry. */
  detailRoutes?: boolean
  /** path prefix for entry routes; defaults to the collection `name`. `''`
   * puts entries at the site root (`/<slug>`) — the WordPress-style layout a
   * real port often has to reproduce. */
  routeBase?: string
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
  /** drawer grouping; omitted = "Uncategorized" */
  category?: string
  /** the library entry this was copied from — drives the "Added" state in the
   * components drawer. A copy is a plain component from here on: nothing
   * follows the catalog. */
  source?: string
}

export interface DesignToken {
  id: string
  /** kebab-case, becomes bg-<name>/text-<name>/border-<name> */
  name: string
  /** hex color */
  value: string
}

export type PublishMethod = 'server' | 'zip' | 'github'

export interface ProjectSettings {
  /** data URL; extracted to a file at publish */
  favicon?: string
  /** how the header Publish button ships the site. github config here is
   * NON-secret — the token lives server-side only (server/data/publish.json) */
  publishing: { method: PublishMethod; github: { repo: string; branch: string } }
  seo: {
    siteName: string
    /** '%s' = page name */
    titleTemplate: string
    description: string
    ogImage?: string
  }
  /** bare domain (example.com) — canonical/og URLs in exports when set */
  domain: string
  /** stored config only; redacted from the public snapshot endpoint.
   * `password` is legacy — new saves keep it server-side (see integrations) */
  smtp: { host: string; port: string; user: string; password: string; from: string }
  /** NON-secret halves of third-party integrations. Every secret (Stripe
   * secret key, mailing API key, SMTP password) lives server-side only, in
   * server/data/publish.json via /api/integrations-config */
  integrations: {
    stripe: { publishableKey: string }
    mailing: { provider: string }
  }
  /** Tailwind theme tokens (colors) */
  tokens: DesignToken[]
  /** the project's own type / spacing scale, compiled into the same @theme
   * block as the colour tokens. A design system usually sets its own root size
   * and type ramp; without this a project could only approximate its own scale.
   * `rootFontSize` becomes an `html { font-size }` rule in the export (exact);
   * in the editor it is applied to the site scope so it can't rescale the
   * editor's own chrome. Values are validated as CSS lengths (isThemeValue). */
  theme?: {
    rootFontSize?: string
    /** the whole spacing scale: v4 derives it as calc(--spacing * n) */
    spacing?: string
    /** step name → value, e.g. `{ base: '.875rem', '2xl': '2rem' }` */
    text?: Record<string, string>
    leading?: Record<string, string>
    tracking?: Record<string, string>
    radius?: Record<string, string>
  }
  /** site-wide motion, all of it optional and off by default. Applies to the
   * Preview surface and the published site — never the Build canvas, which
   * pans instead of scrolling and is an editing surface, not a rendering of
   * the site. Every part of it yields to `prefers-reduced-motion` and ?noanim.
   * Resolution + validation live in lib/shared/motion.js so the exporter, the
   * editor and the MCP agree on what a given object means. */
  motion?: {
    /** what an appear-triggered animation does on re-entry and exit, for
     * bindings that don't set their own appearMode. Omitted = 'once'. */
    appearMode?: 'once' | 'replay' | 'reverse'
    /** outgoing/incoming animations played on the page body around a
     * same-origin navigation */
    transitions?: {
      enabled: boolean
      /** a TRANSITION_PRESETS id, or 'custom' to use the two ids below.
       * Omitted = 'fade'. */
      preset?: string
      /** enter duration in ms; exit runs at TRANSITION_DEFAULTS.exitRatio */
      duration?: number
      /** key into EASINGS */
      easing?: string
      /** 'custom' preset only: timelines from project.animations */
      exitAnimationId?: string
      enterAnimationId?: string
    }
    /** inertia ("lerped") scrolling. Off on touch and reduced-motion; scrolls
     * the real scroll position rather than transforming a wrapper, so the
     * `scrolled` interaction trigger and position:fixed keep working. */
    scroll?: { enabled: boolean; lerp?: number }
  }
  /** raw HTML injected into exported <head> */
  customCode: { head: string }
  fonts: {
    family: string
    monoFamily?: string
    serifFamily?: string
    googleFontsUrl?: string
    /** webfonts hosted in this project's media library, emitted as @font-face
     * on every surface (editor, preview, export) — see lib/shared/fonts.js */
    custom?: CustomFont[]
  }
}

/** one @font-face: a family name pointing at a font file in the media library */
export interface CustomFont {
  id: string
  /** the font-family name to reference in styles, e.g. "OffSans" */
  family: string
  /** '/media/<id>' (library asset) or an https:// URL */
  src: string
  /** the format() hint — derived from the asset's mime when picked */
  format?: string
  /** '400', 'bold', or a variable range like '100 900'; default normal */
  weight?: string
  style?: 'normal' | 'italic'
}

export interface Project {
  id: string
  name: string
  pages: Page[]
  components: ComponentDef[]
  collections: Collection[]
  /** shared interaction library — applied to elements by id */
  interactions: Interaction[]
  /** shared animation library — played by elements by id */
  animations: Animation[]
  /** shared across all pages — they map to global CSS media queries */
  breakpoints: Breakpoint[]
  comments: Comment[]
  /** registered locale codes; always contains defaultLocale */
  locales: string[]
  /** the locale that base content/src/values belong to */
  defaultLocale: string
  settings: ProjectSettings
}
