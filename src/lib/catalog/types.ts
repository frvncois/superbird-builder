/**
 * The shape of a bundled library entry.
 *
 * An entry is pure data — no ids anywhere. Node identity is expressed with
 * symbolic `key`s that a sibling's binding can name as its target, and
 * `materializeCatalogEntry` mints the real UUIDs when the user adds it. The
 * catalog can't store literal ids: a binding's `targetId` is an element id, so
 * two projects adding the same entry must not end up sharing them.
 */

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

export interface CatalogNode {
  type: string
  /** symbolic handle, so a binding elsewhere in the entry can target this node */
  key?: string
  classes?: string
  content?: string
  link?: string
  attributes?: Record<string, string>
  interactions?: CatalogBinding[]
  children?: CatalogNode[]
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
  /**
   * The component root's single child — the same shape `createComponent`
   * produces when extracting one element from the canvas.
   */
  root: CatalogNode
}
