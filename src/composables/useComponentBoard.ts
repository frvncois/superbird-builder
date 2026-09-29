import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useProject } from './useProject'
import { setPreviewTokens, useSettings } from './useSettings'
import { setSelectionScope, useElement } from './useElement'
import { findNode, walkNodes } from '@/lib/tree'
import {
  CATALOG,
  CATALOG_TOKENS,
  catalogDependencies,
  catalogEntry,
  materializeCatalogEntry,
} from '@/lib/catalog'
import type { CatalogEntry, MaterializedEntry } from '@/lib/catalog'
import { alignHostMirrors, normalizeComponentName } from '@/lib/components'
import { dependencyOrder } from '@/lib/instances'
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

/** the card the user is working in — set by focusing one, and by selecting
 *  any element inside one */
const focusedKey = ref<string | null>(null)

/** true while the board is on the canvas. What decides that structural edits
 *  target a component master rather than the page — derived from the session
 *  actually being mounted, not from the view mode, so there is no render where
 *  the two disagree. */
const boardActive = ref(false)

export function focusCard(key: string) {
  focusRequest.value = { key, tick: (focusRequest.value?.tick ?? 0) + 1 }
  focusedKey.value = key
}

const signature = (def: ComponentDef) => JSON.stringify(def.root)

export function useComponentBoard() {
  const { project } = useProject()
  const { selectedElement } = useElement()

  /** what an entry's instance of another entry resolves to on the board: the
   *  project's component, else THAT entry's own preview — the same object its
   *  card shows, so the two are one component and promote as one */
  function heldComponent(key: string): ComponentDef | null {
    const own = project.value.components.find((c) => c.source === key)
    if (own) return own
    const entry = catalogEntry(key)
    return entry ? previewFor(entry).def : null
  }

  function previewFor(entry: CatalogEntry): MaterializedEntry {
    const cached = previews.get(entry.key)
    if (cached) return cached.made
    const made = materializeCatalogEntry(entry, project.value, heldComponent)
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

    // what it holds goes in first: a component whose nested instances resolve
    // to nothing would render, and publish, as empty boxes
    for (const key of catalogDependencies(entry)) {
      const held = catalogEntry(key)
      if (!held || !previews.has(key)) continue
      const before = previews.get(key)!.made.def.name
      promote(held)
      const after = project.value.components.find((c) => c.source === key)?.name
      // its name was taken in the meantime: the instances follow
      if (after && after !== before) {
        walkNodes(def.root.children, (n) => {
          if (n.type === before) n.type = after
        })
      }
    }

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

  /** the component being edited: whichever card owns the selection, else the
   *  focused one */
  const activeCard = computed<BoardCard | null>(() => {
    const selected = selectedElement.value
    if (selected) {
      const owner = cards.value.find((c) => !!findNode([c.def.root], selected.id))
      if (owner) return owner
    }
    return cards.value.find((c) => c.key === focusedKey.value) ?? null
  })

  /**
   * A library preview is a real ComponentDef that simply isn't in the project.
   * Editing one is what adds it — and a structural edit has to add it BEFORE
   * the instance push, which skips defs the project doesn't own.
   */
  function promoteIfPreview(def: ComponentDef) {
    const card = cards.value.find((c) => c.def.id === def.id)
    if (card?.preview) promote(card.preview)
  }

  return { cards, groups, focusRequest, focusedKey, activeCard, boardActive, promote, promoteIfPreview }
}

/**
 * Everything that must hold only WHILE the board is on the canvas. Call from
 * the board component's setup: it tears itself down on unmount.
 */
export function useComponentBoardSession() {
  const { cards, promote } = useComponentBoard()
  boardActive.value = true

  // selection resolves against the component masters instead of the page, so
  // Style / Data / Interactions edit a master node like any page node
  setSelectionScope(() => cards.value.map((c) => c.def.root))

  // library previews are styled with tokens the project may not have yet
  setPreviewTokens(
    Object.entries(CATALOG_TOKENS).map(([name, value]) => ({ id: `preview:${name}`, name, value })),
  )

  // A preview holds mirrors of the components it nests, and those components
  // can change under it — restructured, or renamed. Keeping the mirrors in
  // step is housekeeping, not an edit: a preview that was pristine before is
  // pristine after, or browsing the library would add half of it.
  const { project } = useProject()
  const stopRealign = watch(
    () => JSON.stringify(project.value.components.map((c) => [c.id, c.name, c.root.children])),
    () => {
      const held = [...previews.values()].map((p) => p.made.def)
      const all = [...project.value.components, ...held]
      for (const def of dependencyOrder(held)) {
        const cached = [...previews.values()].find((p) => p.made.def === def)
        if (!cached) continue
        const wasPristine = cached.pristine === signature(def)
        // a project component this preview nests may have been renamed: it is
        // found again by the entry it came from
        if (cached.made.dependencies) {
          for (const [key, name] of Object.entries(cached.made.dependencies)) {
            const now = project.value.components.find((c) => c.source === key)?.name
            if (!now || now === name) continue
            walkNodes(def.root.children, (n) => {
              if (n.type === name) n.type = now
            })
            cached.made.dependencies[key] = now
          }
        }
        alignHostMirrors(def, all)
        if (wasPristine) cached.pristine = signature(def)
      }
    },
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
    stopRealign()
    boardActive.value = false
    focusedKey.value = null
    setPreviewTokens([])
    setSelectionScope(null)
  })
}
