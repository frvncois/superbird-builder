import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { useProject } from './useProject'
import { walkNodes } from '@/lib/tree'
import type { ElementNode, Interaction, InteractionBinding } from '@/types/editor'

/** interaction ids currently active (hovered, click-toggled on, appeared) */
const fired = ref(new Set<string>())

/** binding waiting for a canvas click to choose its target element.
 * Holds the binding object itself (not an id) so it resolves even when
 * the binding lives on a component master, which isn't in the page tree. */
const pickingFor = ref<InteractionBinding | null>(null)

// These derive from the active page and are read once per rendered node
// (classesFor). They live at MODULE scope — one shared computed each —
// so N renderer nodes don't each build their own tree-walking computed
// (that was O(n²) CPU + N Maps rebuilt on every edit). usePage()/useProject()
// only wire computeds over singleton refs, so it's safe to call here.
const { activePage } = usePage()
const { project } = useProject()

/** saved-interaction id → its animation, for resolving bindings */
const animationIndex = computed(() => {
  const index = new Map<string, Interaction>()
  for (const animation of project.value.interactions ?? []) index.set(animation.id, animation)
  return index
})

/** every binding on the page, paired with the node that triggers it */
const all = computed(() => {
  const list: { owner: ElementNode; binding: InteractionBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.interactions ?? []) list.push({ owner: node, binding })
  })
  return list
})

/** node id → bindings whose effect applies to that node */
const targetIndex = computed(() => {
  const index = new Map<string, InteractionBinding[]>()
  for (const { owner, binding } of all.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push(binding)
    index.set(key, list)
  }
  return index
})

/** whether a binding applies at the breakpoint being rendered. `undefined`
 * breakpoints = all; a null render breakpoint (unknown) never gates. */
export function bindingActiveAt(binding: InteractionBinding, breakpointId: string | null): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

/** transition setup + (when active) the to-classes contributed by a binding.
 * Contributes nothing at a breakpoint the binding isn't scoped to. */
function bindingClasses(
  binding: InteractionBinding,
  active: boolean,
  breakpointId: string | null,
): string {
  if (!bindingActiveAt(binding, breakpointId)) return ''
  const animation = animationIndex.value.get(binding.interactionId)
  if (!animation) return ''
  const base = `transition-all ${animation.duration} ${animation.easing}`
  return active ? `${base} ${animation.toClasses}` : base
}

export function useInteraction() {
  /**
   * Classes a binding contributes to its target: the transition setup is
   * always on (so both directions animate), the To-classes only while the
   * interaction is active. Resolved from the shared animation library.
   */
  function classesFor(nodeId: string, breakpointId: string | null = null): string {
    const targeting = targetIndex.value.get(nodeId)
    if (!targeting?.length) return ''
    return targeting
      .map((binding) => bindingClasses(binding, fired.value.has(binding.id), breakpointId))
      .filter(Boolean)
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
  function scopedClassesFor(
    masterId: string,
    componentRoot: ElementNode,
    scope: string,
    breakpointId: string | null = null,
  ): string {
    const parts: string[] = []
    walkNodes([componentRoot], (owner) => {
      for (const binding of owner.interactions ?? []) {
        if ((binding.targetId ?? owner.id) !== masterId) continue
        parts.push(bindingClasses(binding, fired.value.has(scopedKey(binding.id, scope)), breakpointId))
      }
    })
    return parts.filter(Boolean).join(' ')
  }

  /** assign the picked canvas element as the pending binding's target */
  function pickTarget(nodeId: string) {
    if (pickingFor.value) pickingFor.value.targetId = nodeId
    pickingFor.value = null
  }

  // --- shared interaction library (project-level) + per-element bindings ---

  const library = computed(() => project.value.interactions)

  function animationFor(interactionId: string): Interaction | undefined {
    return animationIndex.value.get(interactionId)
  }

  /** every tree that can hold bindings (all pages + component masters) */
  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...project.value.components.map((c) => [c.root]),
    ]
  }

  function createInteraction(): Interaction {
    const animation: Interaction = {
      id: crypto.randomUUID(),
      name: `Interaction ${project.value.interactions.length + 1}`,
      toClasses: '',
      duration: 'duration-300',
      easing: 'ease-out',
    }
    project.value.interactions.push(animation)
    return animation
  }

  function updateInteraction(id: string, patch: Partial<Omit<Interaction, 'id'>>) {
    const animation = project.value.interactions.find((a) => a.id === id)
    if (animation) Object.assign(animation, patch)
  }

  /** number of element bindings referencing a saved interaction */
  function usageCount(interactionId: string): number {
    let count = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        for (const b of node.interactions ?? []) if (b.interactionId === interactionId) count++
      })
    }
    return count
  }

  /** delete a saved interaction and un-apply it from every element */
  function deleteInteraction(interactionId: string) {
    project.value.interactions = project.value.interactions.filter((a) => a.id !== interactionId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.interactions?.some((b) => b.interactionId === interactionId)) return
        for (const b of node.interactions) if (b.interactionId === interactionId) unfire(b.id)
        node.interactions = node.interactions.filter((b) => b.interactionId !== interactionId)
      })
    }
  }

  /** apply a saved interaction to an element (default trigger hover, self target) */
  function applyTo(node: ElementNode, interactionId: string): InteractionBinding {
    node.interactions ??= []
    const binding: InteractionBinding = {
      id: crypto.randomUUID(),
      interactionId,
      trigger: 'hover',
      targetId: null,
    }
    node.interactions.push(binding)
    return binding
  }

  function removeBinding(node: ElementNode, bindingId: string) {
    if (!node.interactions) return
    unfire(bindingId)
    if (pickingFor.value?.id === bindingId) pickingFor.value = null
    node.interactions = node.interactions.filter((b) => b.id !== bindingId)
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
    library,
    animationFor,
    createInteraction,
    updateInteraction,
    usageCount,
    deleteInteraction,
    applyTo,
    removeBinding,
  }
}
