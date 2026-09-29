/**
 * The shape of a bundled library entry.
 *
 * An entry is pure data — no ids anywhere. Node identity is expressed with
 * symbolic `key`s that a sibling's binding can name as its target, and
 * `materializeCatalogEntry` mints the real UUIDs when the user adds it. The
 * catalog can't store literal ids: a binding's `targetId` is an element id, so
 * two projects adding the same entry must not end up sharing them.
 */

import type { SliderConfig, VariantAxis } from '@/types/editor'

export interface CatalogBinding {
  /** the `key` of one of the entry's own interactions */
  interaction: string
  trigger: 'hover' | 'click' | 'appear' | 'scrolled' | 'change'
  /** the `key` of the node it drives; omitted = the trigger element itself */
  target?: string
  action?: 'toggle' | 'on' | 'off'
  closeOn?: ('outside' | 'escape')[]
  /** exclusive group — scoped per component instance by the runtime */
  group?: string
  once?: 'session' | 'local'
}

/** what a host says about one part of a component it holds */
export interface CatalogPart {
  content?: string
  hidden?: boolean
  /** a bundled icon name, for a part that is an `:icon:` */
  icon?: string
}

export interface CatalogNode {
  /** an element type — or, with `component`, the name of the entry it is an
   *  instance of (kept beside the key so an entry reads without a lookup) */
  type: string
  /** symbolic handle, so a binding elsewhere in the entry can target this
   *  node, and a host can address it as one of the component's `parts` */
  key?: string
  classes?: string
  content?: string
  link?: string
  attributes?: Record<string, string>
  interactions?: CatalogBinding[]
  children?: CatalogNode[]
  /** icon only: the name of a bundled icon (see ./icons) */
  icon?: string
  /** image/video only */
  src?: string
  /** an optional part: there, but hidden until an instance shows it */
  hidden?: boolean
  /** class overrides per variant option, keyed `'<axis>:<option>'` — only what
   *  differs from `classes` */
  variantClasses?: Record<string, string>
  /** slider only */
  slider?: SliderConfig

  // --- an instance of ANOTHER entry ---
  /** the `key` of the entry this node is an instance of. Such a node has no
   *  classes, children or bindings of its own: those are the component's. */
  component?: string
  /** instance only: the option it wears per axis */
  variants?: Record<string, string>
  /** instance only: what this host says about the component's parts, by the
   *  `key` each carries in ITS entry */
  parts?: Record<string, CatalogPart>
}

export interface CatalogInteraction {
  key: string
  /**
   * Entry-specific, e.g. "Accordion · open". The library is project-wide and
   * shared by reference, so a generic "Show" reused across entries would mean
   * editing one component silently restyles another.
   */
  name: string
  toClasses: string
  /** Tailwind utilities, like the Interaction they become: 'duration-200' */
  duration?: string
  easing?: string
}

export interface CatalogEntry {
  /** stable id; stored on the component as `source` so the Library can show
   *  which entries are already in the project */
  key: string
  /** the component's default name — Capitalized, and the DSL token it becomes */
  name: string
  category: string
  /** one line under the name in the Library row */
  description: string
  /** design tokens its classes reference; missing ones are created with the
   *  defaults in ./tokens */
  tokens: string[]
  interactions?: CatalogInteraction[]
  /** the axes its instances can differ along */
  variants?: VariantAxis[]
  /**
   * The component root's single child — the same shape `createComponent`
   * produces when extracting one element from the canvas.
   */
  root: CatalogNode
}
