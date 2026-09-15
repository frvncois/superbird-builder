import { computed } from 'vue'
import { usePage } from './usePage'
import { useProject } from './useProject'
import { walkNodes } from '@/lib/tree'
import { validateAnimation } from '@/lib/motion'
import { MOTION_PRESETS, type MotionPresetId } from '@/lib/motionPresets'
import type { Animation, AnimationBinding, ElementNode } from '@/types/editor'

// The animation library + per-element bindings — the tween counterpart of
// useInteraction (class toggling). Same split: the timeline is shared in
// project.animations, the trigger/target is per-binding on the node.
//
// Like useInteraction, the derived indexes live at MODULE scope — one shared
// computed each — so N renderer nodes don't each build a tree-walking computed.
const { activePage } = usePage()
const { project } = useProject()

/** animation id → the saved timeline */
const animationIndex = computed(() => {
  const index = new Map<string, Animation>()
  for (const animation of project.value.animations ?? []) index.set(animation.id, animation)
  return index
})

/** every animation binding on the page, paired with the node that triggers it */
const allBindings = computed(() => {
  const list: { owner: ElementNode; binding: AnimationBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.animations ?? []) list.push({ owner: node, binding })
  })
  return list
})

/** node id → bindings whose animation moves that node */
const animTargetIndex = computed(() => {
  const index = new Map<string, AnimationBinding[]>()
  for (const { owner, binding } of allBindings.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push(binding)
    index.set(key, list)
  }
  return index
})

/** whether a binding plays at the breakpoint being rendered (see
 * useInteraction.bindingActiveAt — same contract) */
export function animBindingActiveAt(
  binding: AnimationBinding,
  breakpointId: string | null,
): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

/** bindings inside a component master whose animation moves `masterId` */
export function scopedAnimBindings(masterId: string, componentRoot: ElementNode): AnimationBinding[] {
  const list: AnimationBinding[] = []
  walkNodes([componentRoot], (owner) => {
    for (const binding of owner.animations ?? []) {
      if ((binding.targetId ?? owner.id) === masterId) list.push(binding)
    }
  })
  return list
}

export function useAnimation() {
  const library = computed(() => project.value.animations ?? [])

  const animationFor = (id: string) => animationIndex.value.get(id)

  /** every tree a binding can live in — pages and component masters */
  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...(project.value.components ?? []).map((c) => [c.root]),
    ]
  }

  function addAnimation(animation: Animation): Animation {
    project.value.animations ??= []
    project.value.animations.push(animation)
    return animation
  }

  function createAnimation(): Animation {
    return addAnimation({
      id: crypto.randomUUID(),
      name: `Animation ${library.value.length + 1}`,
      steps: [
        {
          id: crypto.randomUUID(),
          tracks: [{ prop: 'opacity', from: 0, to: 1 }],
          duration: 600,
          easing: 'ease-out',
        },
      ],
    })
  }

  function createFromPreset(presetId: MotionPresetId): Animation {
    const preset = MOTION_PRESETS.find((p) => p.id === presetId)
    if (!preset) return createAnimation()
    const built = preset.build()
    return addAnimation({ id: crypto.randomUUID(), name: built.name, steps: built.steps })
  }

  function updateAnimation(id: string, patch: Partial<Animation>) {
    const animation = animationFor(id)
    if (animation) Object.assign(animation, patch)
  }

  /** how many elements play this animation, across every page and master */
  function usageCount(animationId: string): number {
    let n = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        n += (node.animations ?? []).filter((b) => b.animationId === animationId).length
      })
    }
    return n
  }

  /** removes the library entry AND every binding referencing it */
  function deleteAnimation(animationId: string) {
    project.value.animations = library.value.filter((a) => a.id !== animationId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.animations?.length) return
        const kept = node.animations.filter((b) => b.animationId !== animationId)
        if (kept.length) node.animations = kept
        else delete node.animations // keep untouched nodes byte-identical
      })
    }
  }

  /** binds an animation to a node; appear is the sane default trigger */
  function applyTo(node: ElementNode, animationId: string): AnimationBinding {
    node.animations ??= []
    const binding: AnimationBinding = {
      id: crypto.randomUUID(),
      animationId,
      trigger: 'appear',
      targetId: null,
    }
    node.animations.push(binding)
    return binding
  }

  function removeBinding(node: ElementNode, bindingId: string) {
    const kept = (node.animations ?? []).filter((b) => b.id !== bindingId)
    if (kept.length) node.animations = kept
    else delete node.animations
  }

  /** canonicalizes to `undefined` when every breakpoint is on, so an untouched
   * binding stays byte-identical for merge signatures */
  function toggleBreakpoint(binding: AnimationBinding, breakpointId: string, allIds: string[]) {
    const on = new Set(binding.breakpoints ?? allIds)
    if (on.has(breakpointId)) {
      if (on.size <= 1) return
      on.delete(breakpointId)
    } else {
      on.add(breakpointId)
    }
    binding.breakpoints = allIds.every((id) => on.has(id)) ? undefined : allIds.filter((id) => on.has(id))
  }

  /** guards a library edit before it reaches the canvas/export */
  function animationError(animation: Animation): string | null {
    const result = validateAnimation(animation)
    return result.ok ? null : result.error
  }

  return {
    library,
    animationFor,
    animTargetIndex,
    createAnimation,
    createFromPreset,
    updateAnimation,
    deleteAnimation,
    usageCount,
    applyTo,
    removeBinding,
    toggleBreakpoint,
    animationError,
  }
}
