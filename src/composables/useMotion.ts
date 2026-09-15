import { computed, ref } from 'vue'
import {
  compileAnimation,
  composeMotionStyle,
  endStyle,
  foldReverseTime,
  hasInfinite,
  reducedMotion,
  sampleValues,
  scrubProgressRaw,
  splitByStagger,
  type CompiledAnimation,
  type MotionStyle,
  type MotionValues,
  type StaggerSplit,
} from '@/lib/motion'
import { animationBindingKey } from '@/lib/motion'
import type { Animation, AnimationBinding } from '@/types/editor'

// Editor-side playback: which animations are running, at what time, on which
// element. The MATH is the shared engine (src/lib/shared/motion.js) — exactly
// what the published site runs — so the canvas preview and the real site can't
// drift. This file only owns scheduling and the Vue reactivity.
//
// Module scope, like useInteraction's fired set: one clock and one play map for
// the whole app, so N rendered nodes read one shared computed instead of each
// owning a rAF loop.

interface PlayState {
  /** the resolved target node id (binding.targetId ?? owner) */
  targetId: string
  compiled: CompiledAnimation
  /** element-moving tracks vs the ones that cascade over children */
  split: StaggerSplit
  /** ms into the timeline */
  time: number
  /** 1 = forward, -1 = reversing */
  direction: 1 | -1
  /** scrub plays are driven by scroll, not the clock */
  scrubbed: boolean
  /** scrub only: how far outside the active 0..1 range the trigger sits (0 =
   * inside). Competing scrubs on one node are merged nearest-range-last so the
   * closest binding wins — same rule as the published runtime. */
  dist?: number
  /** paused plays hold their frame (a finished non-looping play) */
  running: boolean
  /** highest childIndex that sampled this play's staggered tracks — the DOM
   * side of the stagger tail (compiled.duration cannot include it: the child
   * count is unknown at compile time). Recorded by staggerValuesFor. */
  maxChild?: number
}

/** the longest stagger step in a split's cascading tracks */
function maxStagger(split: StaggerSplit): number {
  let max = 0
  for (const track of split.staggered.tracks) if (track.stagger > max) max = track.stagger
  return max
}

/** a play's full run length INCLUDING the stagger tail seen so far — clamping
 * at compiled.duration froze cascades mid-flight with late children part-faded */
function playEnd(play: PlayState): number {
  if (!play.split.hasStagger) return play.compiled.duration
  return play.compiled.duration + maxStagger(play.split) * (play.maxChild ?? 0)
}

const plays = ref(new Map<string, PlayState>())
/** bumped every frame so style computeds re-evaluate */
const tick = ref(0)

const compiledCache = new Map<
  string,
  { steps: string; compiled: CompiledAnimation; split: StaggerSplit }
>()

/** compile once per animation shape; the steps JSON is the cache key so a
 * library edit in the panel recompiles immediately */
function compiledFor(animation: Animation): { compiled: CompiledAnimation; split: StaggerSplit } {
  const steps = JSON.stringify(animation.steps)
  const hit = compiledCache.get(animation.id)
  if (hit && hit.steps === steps) return hit
  const compiled = compileAnimation(animation)
  const entry = { steps, compiled, split: splitByStagger(compiled) }
  compiledCache.set(animation.id, entry)
  return entry
}

/**
 * Target ids of the active plays whose timeline has staggered tracks — the
 * only parents whose children need per-frame inherited values. Returns the
 * PREVIOUS Set while membership is unchanged so the (many) per-node computeds
 * gated on it are not invalidated by mere play-time advance: only nodes whose
 * parent is actually staggering ever subscribe to the frame clock.
 */
const staggeredTargets = computed<Set<string>>((prev) => {
  const next = new Set<string>()
  for (const play of plays.value.values()) {
    if (play.split.hasStagger) next.add(play.targetId)
  }
  if (prev && prev.size === next.size) {
    let same = true
    for (const id of next) {
      if (!prev.has(id)) {
        same = false
        break
      }
    }
    if (same) return prev
  }
  return next
})

let frame: number | null = null
let last = 0

function loop(now: number) {
  const dt = last ? now - last : 16
  last = now
  let live = false
  let removed = false
  for (const [key, play] of plays.value) {
    // scrubbed plays are scroll-driven: scrubTo() bumps tick itself, so they
    // must not pin this clock alive (that kept the loop — and every motion
    // computed — running forever once any scrub binding had fired)
    if (!play.running || play.scrubbed) continue
    play.time += dt * play.direction
    const end = playEnd(play)
    if (play.direction === 1 && play.time >= end && !hasInfinite(play.compiled)) {
      play.time = end
      play.running = false
    } else if (play.direction === -1 && play.time <= 0) {
      // reversed all the way out — drop the play so the element returns to its
      // natural (unanimated) styling rather than being pinned at frame 0
      plays.value.delete(key)
      removed = true
      continue
    } else {
      live = true
    }
  }
  // membership changed → replace the Map so set-shaped computeds
  // (staggeredTargets) invalidate; per-frame time advance only needs tick
  if (removed) plays.value = new Map(plays.value)
  tick.value++
  frame = live ? requestAnimationFrame(loop) : ((last = 0), null)
}

function ensureLoop() {
  if (frame === null) {
    last = 0
    frame = requestAnimationFrame(loop)
  }
}

export function useMotion() {
  /** starts (or restarts) a binding's animation on its target */
  function play(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    opts: { scope?: string; reverse?: boolean; restart?: boolean } = {},
  ) {
    const key = animationBindingKey(binding.id, opts.scope)
    const { compiled, split } = compiledFor(animation)
    const existing = plays.value.get(key)

    if (reducedMotion()) {
      // honour the OS preference: land on the end state, never animate. The
      // time overshoots the stagger tail (child count unknown here) — sampling
      // past a track's end returns its end value, so overshoot is harmless.
      plays.value.set(key, {
        targetId,
        compiled,
        split,
        time: compiled.duration + maxStagger(split) * 256,
        direction: 1,
        scrubbed: false,
        running: false,
      })
      plays.value = new Map(plays.value)
      tick.value++
      return
    }

    const reverse = !!opts.reverse
    plays.value.set(key, {
      targetId,
      compiled,
      split,
      time: reverse ? (existing?.time ?? compiled.duration) : opts.restart === false && existing ? existing.time : 0,
      direction: reverse ? -1 : 1,
      scrubbed: false,
      running: true,
    })
    plays.value = new Map(plays.value)
    ensureLoop()
  }

  /** hover-out / click-off: run the timeline backwards from where it is */
  function reverse(binding: AnimationBinding, scope?: string) {
    const key = animationBindingKey(binding.id, scope)
    const existing = plays.value.get(key)
    if (!existing) return
    // an infinite loop that ran for a minute must not rewind for a minute
    existing.time = foldReverseTime(existing.compiled, existing.time)
    existing.direction = -1
    existing.running = true
    plays.value = new Map(plays.value)
    ensureLoop()
  }

  function stop(binding: AnimationBinding, scope?: string) {
    plays.value.delete(animationBindingKey(binding.id, scope))
    plays.value = new Map(plays.value)
    tick.value++
  }

  const isPlaying = (binding: AnimationBinding, scope?: string) =>
    plays.value.has(animationBindingKey(binding.id, scope))

  /** click toggles direction: play if idle/reversing, reverse if playing forward */
  function toggle(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    scope?: string,
  ) {
    const existing = plays.value.get(animationBindingKey(binding.id, scope))
    if (existing && existing.direction === 1) reverse(binding, scope)
    else play(binding, animation, targetId, { scope })
  }

  /** scroll-driven: map a 0..1 progress onto the timeline */
  function scrubTo(
    binding: AnimationBinding,
    animation: Animation,
    targetId: string,
    progress: number,
    scope?: string,
  ) {
    const key = animationBindingKey(binding.id, scope)
    const { compiled, split } = compiledFor(animation)
    plays.value.set(key, {
      targetId,
      compiled,
      split,
      time: Math.max(0, Math.min(1, progress)) * compiled.duration,
      direction: 1,
      scrubbed: true,
      dist: progress < 0 ? -progress : progress > 1 ? progress - 1 : 0,
      running: false,
    })
    plays.value = new Map(plays.value)
    tick.value++
  }

  /** viewport-position → progress, for a scrub binding (shared math).
   * UNCLAMPED — scrubTo clamps for the timeline and keeps the overshoot as
   * the play's range distance for nearest-wins merging. */
  function scrubProgressFor(binding: AnimationBinding, top: number, viewportHeight: number) {
    return scrubProgressRaw(top, viewportHeight, binding.scrub)
  }

  /** does this play belong to the rendering asking for it? a scoped play is
   * one component instance's / one list repeat's alone */
  function inScope(key: string, scope?: string): boolean {
    const at = key.indexOf('@')
    return (at === -1 ? undefined : key.slice(at + 1)) === scope
  }

  /** the element-moving values of every active play targeting this node,
   * later plays winning per PROPERTY — so a marquee's x and an entrance's y
   * compose into one transform instead of overwriting each other */
  function valuesForNode(nodeId: string, scope?: string): MotionValues | undefined {
    void tick.value // re-evaluate every frame while something is running
    // farthest-from-range first so the scrub nearest (or inside) its active
    // range wins shared properties — the published runtime orders its frame
    // writes the same way (see src/motion/runtime.ts updateScrub)
    const matching: PlayState[] = []
    for (const [key, play] of plays.value) {
      if (play.targetId !== nodeId || !inScope(key, scope)) continue
      matching.push(play)
    }
    matching.sort((a, b) => (b.dist ?? 0) - (a.dist ?? 0))
    let merged: MotionValues | undefined
    for (const play of matching) {
      const values = sampleValues(play.split.element, play.time)
      merged = merged ? { ...merged, ...values } : values
    }
    return merged
  }

  /** the cascading values a node inherits as the Nth child of an animated
   * parent — only the STAGGERED tracks reach children */
  function staggerValuesFor(
    parentId: string,
    childIndex: number,
    scope?: string,
  ): MotionValues | undefined {
    void tick.value
    let merged: MotionValues | undefined
    for (const [key, play] of plays.value) {
      if (play.targetId !== parentId || !play.split.hasStagger || !inScope(key, scope)) continue
      // record the deepest child sampling this cascade — playEnd() extends the
      // clock past compiled.duration by exactly this tail, so the last card
      // finishes instead of freezing part-faded
      if (childIndex > (play.maxChild ?? 0)) play.maxChild = childIndex
      const values = sampleValues(play.split.staggered, play.time, { childIndex })
      merged = merged ? { ...merged, ...values } : values
    }
    return merged
  }

  /** the merged style for a node (element part only; see staggerValuesFor) */
  function styleForNode(nodeId: string, scope?: string): MotionStyle | undefined {
    const values = valuesForNode(nodeId, scope)
    return values ? composeMotionStyle(values) : undefined
  }

  /** ▶ in the panel: play an animation on an element without a binding */
  function preview(animation: Animation, targetId: string, scope?: string) {
    const key = animationBindingKey(`preview:${animation.id}`, scope)
    const { compiled, split } = compiledFor(animation)
    plays.value.set(key, {
      targetId,
      compiled,
      split,
      time: 0,
      direction: 1,
      scrubbed: false,
      running: true,
    })
    plays.value = new Map(plays.value)
    if (reducedMotion()) {
      const play = plays.value.get(key)!
      play.time = compiled.duration
      play.running = false
      tick.value++
      return
    }
    ensureLoop()
  }

  /** clears every play — used when the panel closes or the page changes */
  function stopAll() {
    if (!plays.value.size) return
    plays.value = new Map()
    tick.value++
  }

  const anyPlaying = computed(() => plays.value.size > 0)

  return {
    play,
    reverse,
    stop,
    stopAll,
    toggle,
    scrubTo,
    scrubProgressFor,
    styleForNode,
    valuesForNode,
    staggerValuesFor,
    staggeredTargets,
    preview,
    isPlaying,
    anyPlaying,
    endStyleFor: (animation: Animation) => endStyle(compiledFor(animation).compiled),
  }
}
