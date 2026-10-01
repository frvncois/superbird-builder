import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { useProject } from './useProject'
import { walkNodes } from '@/lib/tree'
import { masterInteractionsTargeting } from './useMasterBindings'
import {
  interactionGroupKey,
  interactionStateKey,
  nextInteractionState,
} from '@/lib/shared/interactionKeys.js'
import { buildScopeRoots } from '@/lib/shared/entryScope.js'
import type { AnimationBinding, ElementNode, Interaction, InteractionBinding } from '@/types/editor'

/**
 * State keys currently active. A state key is `interactionId:targetId[@scope]`
 * (see lib/shared/interactionKeys.js) — NOT a binding id. That is what lets an
 * "open" button and a "close" button drive the same effect: they share one
 * boolean. Keyed by binding, a close button flipped its own independent flag and
 * the to-classes were applied twice, so modals could never be closed.
 */
const fired = ref(new Set<string>())

/** exclusive groups: group key → the one state key currently open in it */
const firedGroups = new Map<string, string>()

/** state keys that are open AND dismissable, → the gestures that dismiss them */
const openDismissals = new Map<string, Set<string>>()

/** state key → the DOM elements that count as "inside" it (its triggers and its
 * targets), for outside-click hit-testing. Populated by the renderers. */
const dismissEls = new Map<string, Set<HTMLElement>>()

/** binding waiting for a canvas click to choose its target element.
 * Holds the binding object itself (not an id) so it resolves even when
 * the binding lives on a component master, which isn't in the page tree.
 * Shared by interaction AND animation bindings — both carry a targetId. */
const pickingFor = ref<InteractionBinding | AnimationBinding | null>(null)

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

/** node id → bindings whose effect applies to that node, each paired with the
 * node it is declared on (the owner decides the binding's entry scope) */
const targetIndex = computed(() => {
  const index = new Map<string, { binding: InteractionBinding; ownerId: string }[]>()
  for (const { owner, binding } of all.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push({ binding, ownerId: owner.id })
    index.set(key, list)
  }
  return index
})

/**
 * node id → the entry scope it renders under, for the active page and every
 * component master (shared/entryScope.js). Mirrors the exporter's index: it is
 * what keeps a row trigger and a shared overlay on ONE state key.
 */
const scopeRoots = computed(() =>
  buildScopeRoots([
    { tree: activePage.value.elements, root: null },
    ...(project.value.components ?? []).map((c) => ({ tree: [c.root], root: null })),
  ]),
)

/**
 * Per-EFFECT options, folded together from every binding that drives the same
 * target. These belong to the effect, not to the trigger that declares them: a
 * close button can carry `closeOn` and an overlay can carry the `group` while
 * the effect is the one an open button fires. Reading them off the firing
 * binding alone meant a dismissal declared on an `action: 'off'` button was
 * never armed — that button never turns the effect ON, which is when dismissal
 * has to be registered.
 *
 * Keyed by target node id (the state key's target half). Built over the active
 * page AND every component master, since bindings on masters aren't in the page
 * tree but do render.
 */
const effectOptions = computed(() => {
  const index = new Map<string, { closeOn: Set<string>; group?: string }>()
  const collect = (owner: ElementNode) => {
    for (const binding of owner.interactions ?? []) {
      if (!binding.closeOn?.length && !binding.group) continue
      const targetId = binding.targetId ?? owner.id
      const entry = index.get(targetId) ?? { closeOn: new Set<string>() }
      for (const mode of binding.closeOn ?? []) entry.closeOn.add(mode)
      if (binding.group && !entry.group) entry.group = binding.group
      index.set(targetId, entry)
    }
  }
  walkNodes(activePage.value.elements, collect)
  for (const component of project.value.components ?? []) walkNodes([component.root], collect)
  return index
})

/**
 * Resolves the scope of a binding declared on `ownerId`, for the node being
 * rendered. Per BINDING, not per node: a row trigger and the one shared overlay
 * it opens only land on the same state key when the entry part follows the
 * TARGET (src/lib/shared/entryScope.js).
 */
export type ScopeOf = (ownerId: string) => string | undefined

/** whether a binding applies at the breakpoint being rendered. `undefined`
 * breakpoints = all; a null render breakpoint (unknown) never gates. */
export function bindingActiveAt(binding: InteractionBinding, breakpointId: string | null): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

/** replace the fired set (Vue needs a new Set to see the change) */
function rawSet(key: string, on: boolean) {
  if (on === fired.value.has(key)) return
  const next = new Set(fired.value)
  if (on) next.add(key)
  else next.delete(key)
  fired.value = next
}

// --- outside-click / Escape dismissal ---
//
// One pair of capture-phase document listeners, installed the first time a
// dismissable interaction opens. Both the Build canvas and Preview run this:
// click interactions already fire in both, so dismissal has to as well or a menu
// opened on the canvas could never be closed.

let dismissListening = false

function elementsFor(key: string): HTMLElement[] {
  return [...(dismissEls.get(key) ?? [])]
}

function closeDismissable(key: string) {
  openDismissals.delete(key)
  // a dismissed interaction also vacates any exclusive group slot it held
  for (const [groupKey, stateKey] of firedGroups) {
    if (stateKey === key) firedGroups.delete(groupKey)
  }
  rawSet(key, false)
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!openDismissals.size) return
  const target = event.target as Node | null
  if (!target) return
  for (const [key, modes] of [...openDismissals]) {
    if (!modes.has('outside')) continue
    // inside the trigger or inside the thing that opened — not an outside click
    if (elementsFor(key).some((el) => el.contains(target))) continue
    closeDismissable(key)
  }
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openDismissals.size) return
  for (const [key, modes] of [...openDismissals]) {
    if (modes.has('escape')) closeDismissable(key)
  }
}

function installDismissListeners() {
  if (dismissListening || typeof document === 'undefined') return
  dismissListening = true
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeyDown, true)
}

export function useInteraction() {
  /**
   * Classes a target node receives: the transition setup is always on (so both
   * directions animate), the To-classes only while the effect is active.
   *
   * Deduped by INTERACTION, not by binding — several bindings (an open button, a
   * close button, an overlay) drive one effect on one target, so its classes are
   * contributed once. Without the dedupe the to-classes appeared N times.
   */
  function classesFor(
    nodeId: string,
    breakpointId: string | null = null,
    scopeOf: ScopeOf = () => undefined,
  ): string {
    const targeting = targetIndex.value.get(nodeId)
    if (!targeting?.length) return ''
    const seen = new Set<string>()
    const parts: string[] = []
    for (const { binding, ownerId } of targeting) {
      if (!bindingActiveAt(binding, breakpointId)) continue
      if (seen.has(binding.interactionId)) continue
      seen.add(binding.interactionId)
      const animation = animationIndex.value.get(binding.interactionId)
      if (!animation) continue
      const key = interactionStateKey(binding.interactionId, nodeId, scopeOf(ownerId))
      const base = `transition-all ${animation.duration} ${animation.easing}`
      parts.push(fired.value.has(key) ? `${base} ${animation.toClasses}` : base)
    }
    return parts.join(' ')
  }

  /**
   * Interaction classes for a master node rendered inside an instance:
   * every interaction in the component targeting this master node,
   * active when fired in THIS instance's scope.
   */
  function scopedClassesFor(
    masterId: string,
    componentRoot: ElementNode,
    scopeOf: ScopeOf,
    breakpointId: string | null = null,
  ): string {
    const seen = new Set<string>()
    const parts: string[] = []
    // the per-master index, not a walk: this runs once per rendered element
    for (const { binding, ownerId } of masterInteractionsTargeting(masterId, componentRoot)) {
      if (!bindingActiveAt(binding, breakpointId)) continue
      if (seen.has(binding.interactionId)) continue
      seen.add(binding.interactionId)
      const animation = animationIndex.value.get(binding.interactionId)
      if (!animation) continue
      const key = interactionStateKey(binding.interactionId, masterId, scopeOf(ownerId))
      const base = `transition-all ${animation.duration} ${animation.easing}`
      parts.push(fired.value.has(key) ? `${base} ${animation.toClasses}` : base)
    }
    return parts.join(' ')
  }

  /** the state keys whose effect lands on this node — registered for
   * outside-click hit-testing so a click inside an open menu isn't "outside" */
  function targetStateKeys(nodeId: string, scopeOf: ScopeOf): string[] {
    const targeting = targetIndex.value.get(nodeId)
    if (!targeting?.length) return []
    return [
      ...new Set(
        targeting.map(({ binding, ownerId }) =>
          interactionStateKey(binding.interactionId, nodeId, scopeOf(ownerId)),
        ),
      ),
    ]
  }

  /** targetStateKeys for a master node rendered inside a component instance */
  function scopedTargetStateKeys(
    masterId: string,
    componentRoot: ElementNode,
    scopeOf: ScopeOf,
  ): string[] {
    const keys = new Set<string>()
    for (const { binding, ownerId } of masterInteractionsTargeting(masterId, componentRoot)) {
      keys.add(interactionStateKey(binding.interactionId, masterId, scopeOf(ownerId)))
    }
    return [...keys]
  }

  /** the state key a binding drives, given the node that owns it */
  function bindingStateKey(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
  ): string {
    return interactionStateKey(binding.interactionId, binding.targetId ?? ownerId, scope)
  }

  /** true when a binding's effect is currently on */
  function isBindingOn(binding: InteractionBinding, ownerId: string, scope?: string): boolean {
    return fired.value.has(bindingStateKey(binding, ownerId, scope))
  }

  /**
   * Apply a binding's effect.
   *
   * `on` forces a state (hover enter/leave, scroll position, input change);
   * omitting it honours the binding's `action` — 'on' / 'off' / 'toggle'
   * (default). Handles exclusive groups and dismissal registration.
   *
   * `instanceScope` is the component-instance part of the scope only: exclusive
   * groups must hold across a collection-list's repeats (one accordion open at a
   * time) while staying independent per component instance.
   *
   * NOTE: `binding.once` is deliberately NOT honoured here. Remembering a
   * dismissal across reloads would hide the element from the author, who still
   * has to select and style it. It applies on the published site only
   * (server/site-runtime.js).
   */
  function applyBinding(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
    instanceScope?: string,
    on?: boolean,
  ) {
    const key = bindingStateKey(binding, ownerId, scope)
    const next = on ?? nextInteractionState(binding.action, fired.value.has(key))
    // options come from the EFFECT, not this one binding (see effectOptions)
    const options = effectOptions.value.get(binding.targetId ?? ownerId)

    if (options?.group) {
      const groupKey = interactionGroupKey(options.group, instanceScope)
      if (next) {
        const open = firedGroups.get(groupKey)
        if (open && open !== key) {
          openDismissals.delete(open)
          rawSet(open, false)
        }
        firedGroups.set(groupKey, key)
      } else if (firedGroups.get(groupKey) === key) {
        firedGroups.delete(groupKey)
      }
    }

    if (options?.closeOn.size) {
      if (next) {
        openDismissals.set(key, options.closeOn)
        installDismissListeners()
      } else {
        openDismissals.delete(key)
      }
    }

    rawSet(key, next)
  }

  /**
   * Register a rendered element as "inside" the given state keys, so an
   * outside-click dismissal can tell a click on the menu from a click off it.
   * Renderers call this for the keys they trigger AND the keys that target them.
   */
  function registerInteractionEl(keys: string[], el: HTMLElement) {
    for (const key of keys) {
      const set = dismissEls.get(key) ?? new Set<HTMLElement>()
      set.add(el)
      dismissEls.set(key, set)
    }
  }

  function unregisterInteractionEl(keys: string[], el: HTMLElement) {
    for (const key of keys) {
      const set = dismissEls.get(key)
      if (!set) continue
      set.delete(el)
      if (!set.size) dismissEls.delete(key)
    }
  }

  /** drop every fired state for an interaction (optionally one target only) —
   * used when a binding or a library entry goes away */
  function clearStateFor(interactionId: string, targetId?: string) {
    const prefix = targetId ? `${interactionId}:${targetId}` : `${interactionId}:`
    const stale = [...fired.value].filter((k) => k.startsWith(prefix))
    for (const key of stale) closeDismissable(key)
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
    clearStateFor(interactionId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.interactions?.some((b) => b.interactionId === interactionId)) return
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
    const binding = node.interactions.find((b) => b.id === bindingId)
    if (binding) clearStateFor(binding.interactionId, binding.targetId ?? node.id)
    if (pickingFor.value?.id === bindingId) pickingFor.value = null
    node.interactions = node.interactions.filter((b) => b.id !== bindingId)
  }

  return {
    fired,
    pickingFor,
    classesFor,
    scopedClassesFor,
    targetStateKeys,
    scopedTargetStateKeys,
    scopeRoots,
    bindingStateKey,
    isBindingOn,
    applyBinding,
    registerInteractionEl,
    unregisterInteractionEl,
    clearStateFor,
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
