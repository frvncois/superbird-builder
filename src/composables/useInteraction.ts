import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { walkNodes } from '@/lib/tree'
import type { ElementNode, Interaction } from '@/types/editor'

/** interaction ids currently active (hovered, click-toggled on, appeared) */
const fired = ref(new Set<string>())

/** interaction waiting for a canvas click to choose its target element */
const pickingFor = ref<string | null>(null)

// These derive from the active page and are read once per rendered node
// (classesFor). They live at MODULE scope — one shared computed each —
// so N renderer nodes don't each build their own tree-walking computed
// (that was O(n²) CPU + N Maps rebuilt on every edit). usePage() only
// wires computeds over singleton refs, so it's safe to call here.
const { activePage } = usePage()

/** every interaction on the page, paired with the node that triggers it */
const all = computed(() => {
  const list: { owner: ElementNode; interaction: Interaction }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const interaction of node.interactions ?? []) list.push({ owner: node, interaction })
  })
  return list
})

/** node id → interactions whose effect applies to that node */
const targetIndex = computed(() => {
  const index = new Map<string, Interaction[]>()
  for (const { owner, interaction } of all.value) {
    const key = interaction.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push(interaction)
    index.set(key, list)
  }
  return index
})

export function useInteraction() {
  /**
   * Classes an interaction contributes to its target: the transition
   * setup is always on (so both directions animate), the To-classes
   * only while the interaction is active.
   */
  function classesFor(nodeId: string): string {
    const targeting = targetIndex.value.get(nodeId)
    if (!targeting?.length) return ''
    return targeting
      .map((i) =>
        fired.value.has(i.id)
          ? `transition-all ${i.duration} ${i.easing} ${i.toClasses}`
          : `transition-all ${i.duration} ${i.easing}`,
      )
      .join(' ')
  }

  function fire(id: string) {
    if (!fired.value.has(id)) fired.value = new Set(fired.value).add(id)
  }

  function unfire(id: string) {
    if (!fired.value.has(id)) return
    const next = new Set(fired.value)
    next.delete(id)
    fired.value = next
  }

  function toggle(id: string) {
    if (fired.value.has(id)) unfire(id)
    else fire(id)
  }

  function findInteraction(id: string): Interaction | null {
    return all.value.find((e) => e.interaction.id === id)?.interaction ?? null
  }

  // --- component-scoped firing: interactions on master nodes fire per
  // instance, keyed `${id}@${instanceId}`, so hovering one card never
  // animates its siblings ---

  const scopedKey = (id: string, scope: string) => `${id}@${scope}`

  function fireScoped(id: string, scope: string) {
    fire(scopedKey(id, scope))
  }

  function unfireScoped(id: string, scope: string) {
    unfire(scopedKey(id, scope))
  }

  function toggleScoped(id: string, scope: string) {
    toggle(scopedKey(id, scope))
  }

  /**
   * Interaction classes for a master node rendered inside an instance:
   * every interaction in the component targeting this master node,
   * active when fired in THIS instance's scope.
   */
  function scopedClassesFor(masterId: string, componentRoot: ElementNode, scope: string): string {
    const parts: string[] = []
    walkNodes([componentRoot], (owner) => {
      for (const interaction of owner.interactions ?? []) {
        if ((interaction.targetId ?? owner.id) !== masterId) continue
        const base = `transition-all ${interaction.duration} ${interaction.easing}`
        parts.push(
          fired.value.has(scopedKey(interaction.id, scope))
            ? `${base} ${interaction.toClasses}`
            : base,
        )
      }
    })
    return parts.join(' ')
  }

  /** assign the picked canvas element as the pending interaction's target */
  function pickTarget(nodeId: string) {
    const interaction = pickingFor.value ? findInteraction(pickingFor.value) : null
    if (interaction) interaction.targetId = nodeId
    pickingFor.value = null
  }

  return {
    fired,
    pickingFor,
    classesFor,
    fire,
    unfire,
    toggle,
    fireScoped,
    unfireScoped,
    toggleScoped,
    scopedClassesFor,
    pickTarget,
  }
}
