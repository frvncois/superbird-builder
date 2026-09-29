import { computed, ref } from 'vue'
import { useComponentBoard } from './useComponentBoard'
import { useComponents } from './useComponents'
import { useElement } from './useElement'
import { effectiveClasses, variantKey } from '@/lib/variants'
import type { InstanceMapping } from '@/lib/instances'
import { walkNodes } from '@/lib/tree'
import type { ComponentDef, ElementNode } from '@/types/editor'

/**
 * Variants in the editor: which options a board card is SHOWING, and which
 * layer the Style panel is WRITING.
 *
 * Both are runtime-only, never on the document. A card's preview picks in
 * particular must not be: the board promotes a library preview into the
 * project the moment its JSON changes, so parking view state on the def would
 * copy a component into the project for flipping a select.
 */

/** component id → the option each axis is previewing on the board */
const previewPicks = ref<Record<string, Record<string, string>>>({})

/** the layer the Style panel writes: `'<axis>:<option>'`, or null for the
 *  base classes every option shares */
const activeLayer = ref<string | null>(null)

const { cards, boardActive } = useComponentBoard()

/** on the board a master node renders directly, with no instance to take its
 *  picks from — so which component owns it has to be looked up */
const boardOwners = computed(() => {
  const owners = new Map<string, ComponentDef>()
  if (!boardActive.value) return owners
  for (const card of cards.value) {
    if (!card.def.variants?.length) continue
    walkNodes([card.def.root], (n) => owners.set(n.id, card.def))
  }
  return owners
})

/** the picks a card previews, defaults filled in */
function picksOnBoard(def: ComponentDef): Record<string, string> {
  const chosen = previewPicks.value[def.id] ?? {}
  const picks: Record<string, string> = {}
  for (const axis of def.variants ?? []) {
    const pick = chosen[axis.name]
    picks[axis.name] = pick !== undefined && axis.options.includes(pick) ? pick : axis.default
  }
  return picks
}

function setPreviewPick(def: ComponentDef, axis: string, option: string) {
  previewPicks.value = {
    ...previewPicks.value,
    [def.id]: { ...(previewPicks.value[def.id] ?? {}), [axis]: option },
  }
}

/**
 * The component and picks that decide what `node` wears: its instance's when
 * it is inside one, its card's when it is a master node on the board, and
 * nothing for a plain page element.
 */
function variantContext(
  node: ElementNode,
  mapping: InstanceMapping | null,
): { def: ComponentDef; master: ElementNode; picks: Record<string, string> } | null {
  if (mapping) return { def: mapping.def, master: mapping.master, picks: mapping.picks }
  const def = boardOwners.value.get(node.id)
  return def ? { def, master: node, picks: picksOnBoard(def) } : null
}

/** the classes an element wears, variants applied */
function classesFor(node: ElementNode, mapping: InstanceMapping | null): string {
  const ctx = variantContext(node, mapping)
  if (!ctx) return node.classes ?? ''
  return effectiveClasses(ctx.master, ctx.def, ctx.picks)
}

export function useVariants() {
  const { selectedElement } = useElement()
  const { masterFor } = useComponents()

  /** what the current selection's component offers the Style panel */
  const selectionContext = computed(() => {
    const node = selectedElement.value
    return node ? variantContext(node, masterFor(node.id)) : null
  })

  /** the layers the Style panel can write for the selection: the option each
   *  axis is currently WEARING. To edit another option, wear it first — a
   *  layer nobody can see being edited is how a panel ends up lying. */
  const layerOptions = computed(() => {
    const ctx = selectionContext.value
    if (!ctx?.def.variants?.length) return []
    return ctx.def.variants.map((axis) => {
      const option = ctx.picks[axis.name] ?? axis.default
      return { key: variantKey(axis.name, option), axis: axis.name, option }
    })
  })

  /** the active layer, if the selection still offers it */
  const layer = computed(() =>
    layerOptions.value.some((l) => l.key === activeLayer.value) ? activeLayer.value : null,
  )

  return {
    previewPicks,
    activeLayer,
    layer,
    layerOptions,
    selectionContext,
    picksOnBoard,
    setPreviewPick,
    variantContext,
    classesFor,
  }
}

export { classesFor as variantClassesFor }
