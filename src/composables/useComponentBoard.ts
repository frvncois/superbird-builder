import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useProject } from './useProject'
import { setPreviewTokens, useSettings } from './useSettings'
import { setSelectionScope } from './useElement'
import { CATALOG, CATALOG_TOKENS, materializeCatalogEntry } from '@/lib/catalog'
import type { CatalogEntry, MaterializedEntry } from '@/lib/catalog'
import { normalizeComponentName } from '@/lib/components'
import type { ComponentDef, DesignToken } from '@/types/editor'

/**
 * The components board: what the canvas shows while the Components column is
 * open. Every component is on it — the project's own, and every library entry
 * the project hasn't added yet, rendered from a PREVIEW copy.
 *
 * A preview is a fully materialized component that simply isn't in the project.
 * It is promoted (pushed into `project.components`, with the tokens and effects
 * it needs) the moment it is edited, so browsing the library costs the project
 * nothing and editing it needs no separate "add" step. The preview object
 * itself is what gets pushed, so the node being edited keeps its identity and
 * the selection survives the promotion.
 */

export const UNCATEGORIZED = 'Uncategorized'

export interface BoardCard {
  /** the component id, or `catalog:<key>` for a library entry not added yet */
  key: string
  def: ComponentDef
  category: string
  /** set while this is a preview rather than a project component */
  preview: CatalogEntry | null
}

export const catalogCardKey = (key: string) => `catalog:${key}`

// deliberately NOT reactive as a container: it is filled lazily from inside a
// computed. The defs it holds are reactive, which is what editing needs.
const previews = new Map<string, { made: MaterializedEntry; pristine: string }>()

/** the drawer asks the board to bring a card into view */
const focusRequest = ref<{ key: string; tick: number } | null>(null)

export function focusCard(key: string) {
  focusRequest.value = { key, tick: (focusRequest.value?.tick ?? 0) + 1 }
}

const signature = (def: ComponentDef) => JSON.stringify(def.root)

export function useComponentBoard() {
  const { project } = useProject()

  function previewFor(entry: CatalogEntry): MaterializedEntry {
    const cached = previews.get(entry.key)
    if (cached) return cached.made
    const made = materializeCatalogEntry(entry, project.value)
    made.def = reactive(made.def) as ComponentDef
    previews.set(entry.key, { made, pristine: signature(made.def) })
    return made
  }

  const cards = computed<BoardCard[]>(() => {
    const added = new Set(project.value.components.map((c) => c.source).filter(Boolean))
    const own: BoardCard[] = project.value.components.map((def) => ({
      key: def.id,
      def,
      category: def.category?.trim() || UNCATEGORIZED,
      preview: null,
    }))
    const library: BoardCard[] = CATALOG.filter((e) => !added.has(e.key)).map((entry) => ({
      key: catalogCardKey(entry.key),
      def: previewFor(entry).def,
      category: entry.category,
      preview: entry,
    }))
    return [...own, ...library]
  })

  /** cards by category: the library's own order first, then the user's
   *  categories alphabetically, Uncategorized last */
  const groups = computed<{ name: string; cards: BoardCard[] }[]>(() => {
    const order = [...new Set(CATALOG.map((e) => e.category))]
    const rank = (name: string) => {
      if (name === UNCATEGORIZED) return Number.MAX_SAFE_INTEGER
      const i = order.indexOf(name)
      return i === -1 ? order.length : i
    }
    const byName = new Map<string, BoardCard[]>()
    for (const card of cards.value) {
      const list = byName.get(card.category)
      if (list) list.push(card)
      else byName.set(card.category, [card])
    }
    return [...byName.entries()]
      .map(([name, list]) => ({ name, cards: list }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  })

  /** copy an edited preview into the project — same object, so the node under
   *  the user's cursor keeps its id */
  function promote(entry: CatalogEntry) {
    const cached = previews.get(entry.key)
    if (!cached) return
    previews.delete(entry.key)
    const { def, interactions } = cached.made

    // the name was checked when the preview was made; a component created
    // since could have taken it
    const taken = project.value.components.map((c) => c.name)
    if (taken.includes(def.name)) {
      def.name = normalizeComponentName(def.name, taken)
      def.root.type = def.name
    }

    const tokens: DesignToken[] = entry.tokens
      .filter((name) => CATALOG_TOKENS[name])
      .map((name) => ({ id: crypto.randomUUID(), name, value: CATALOG_TOKENS[name]! }))
    useSettings().ensureTokens(tokens)

    const have = new Set(project.value.interactions.map((i) => i.id))
    project.value.interactions.push(...interactions.filter((i) => !have.has(i.id)))
    project.value.components.push(def)
  }

  return { cards, groups, focusRequest, promote }
}

/**
 * Everything that must hold only WHILE the board is on the canvas. Call from
 * the board component's setup: it tears itself down on unmount.
 */
export function useComponentBoardSession() {
  const { cards, promote } = useComponentBoard()

  // selection resolves against the component masters instead of the page, so
  // Style / Data / Interactions edit a master node like any page node
  setSelectionScope(() => cards.value.map((c) => c.def.root))

  // library previews are styled with tokens the project may not have yet
  setPreviewTokens(
    Object.entries(CATALOG_TOKENS).map(([name, value]) => ({ id: `preview:${name}`, name, value })),
  )

  // a preview that no longer matches what was materialized has been edited
  const stop = watch(
    () =>
      cards.value
        .filter((c) => c.preview)
        .map((c) => ({ entry: c.preview!, now: signature(c.def) })),
    (list) => {
      for (const { entry, now } of list) {
        const cached = previews.get(entry.key)
        if (cached && cached.pristine !== now) promote(entry)
      }
    },
  )

  onBeforeUnmount(() => {
    stop()
    setPreviewTokens([])
    setSelectionScope(null)
  })
}
