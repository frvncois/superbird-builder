// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Published-site motion runtime, built to server/motion-runtime.js and shipped
// as /assets/motion.js. The MATH is imported from src/lib/shared/motion.js —
// the exact module the editor uses — so a published animation is frame-for-frame
// what the canvas previewed. This file owns only the browser side: reading the
// emitted JSON, wiring triggers, and writing styles.
//
// Emitted by server/export.mjs:
//   #anim-lib   { [animationId]: Animation }        (only animations in use)
//   #anim-bp    { [key]: breakpointId[] }           (scoped bindings only)
//   #int-bp     [{ id, w }]                         (shared with interactions)
//   data-anim   [{ k, t, a, o? }] on trigger elements
//   data-atgt   "key key" on animated elements
// Keys are unique per component instance AND per collection-list repeat, so
// every card owns its own play and its own "already appeared" state.
import {
  compileAnimation,
  sampleValues,
  composeMotionStyle,
  splitByStagger,
  initialStyle,
  foldReverseTime,
  motionBreakpointId,
  appearRootMargin,
  scrubProgressRaw,
  MOTION_CSS_PROPS,
  type CompiledAnimation,
  type MotionValues,
  type MotionStyle,
  type StaggerSplit,
} from '@/lib/motion'

interface BindingMeta {
  /** binding key (unique per instance/repeat) */
  k: string
  t: 'load' | 'appear' | 'scrub' | 'hover' | 'click'
  /** animation id */
  a: string
  /** options: appearMode / appearAt / scrub range (+ optional smoothing) */
  o?: {
    m?: 'replay' | 'reverse'
    at?: number
    s?: { start?: number; end?: number; smooth?: number }
  }
}

type Compiled = CompiledAnimation
type Split = StaggerSplit

interface Play {
  el: HTMLElement
  compiled: Compiled
  split: Split
  time: number
  direction: 1 | -1
  running: boolean
  /** full run length INCLUDING the stagger tail — compiled.duration only covers
   * the element-level tracks (the compiler can't know the child count), so a
   * cascade clamped to it froze mid-flight with late children part-faded */
  total: number
}

const json = <T,>(id: string, fallback: T): T => {
  const el = document.getElementById(id)
  if (!el) return fallback
  try {
    return JSON.parse(el.textContent || '') as T
  } catch {
    return fallback
  }
}

const lib = json<Record<string, { id: string; name: string; steps: unknown[] }>>('anim-lib', {})
if (Object.keys(lib).length) {
  const bpScope = json<Record<string, string[]>>('anim-bp', {})
  const bps = json<{ id: string; w: number }[]>('int-bp', [])

  const compiled: Record<string, Compiled> = {}
  const splits: Record<string, Split> = {}
  for (const id of Object.keys(lib)) {
    compiled[id] = compileAnimation(lib[id] as never)
    splits[id] = splitByStagger(compiled[id]!)
  }

  // ?noanim (deterministic screenshots/crawlers) and the OS reduce-motion
  // preference both mean "show the end state, never move"
  const still =
    /[?&]noanim\b/.test(location.search) ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  // rAF is throttled to nothing while the document is hidden
  const hiddenAtBoot =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'

  // documentElement.clientWidth, NOT innerWidth: horizontal overflow inflates
  // innerWidth past the CSS viewport, desyncing the gate from Tailwind's media
  // queries (same fix as the interaction runtime's computeBp)
  const viewportWidth = () => document.documentElement.clientWidth || window.innerWidth
  let currentBp = bps.length ? motionBreakpointId(bps, viewportWidth()) : ''
  const allowed = (key: string) => {
    const scope = bpScope[key]
    return !scope || scope.indexOf(currentBp) !== -1
  }

  /** every element an animation can move, by binding key */
  const targets = new Map<string, HTMLElement[]>()
  document.querySelectorAll<HTMLElement>('[data-atgt]').forEach((el) => {
    for (const key of (el.getAttribute('data-atgt') || '').split(' ').filter(Boolean)) {
      const list = targets.get(key) || []
      list.push(el)
      targets.set(key, list)
    }
  })

  /** the elements a staggered part cascades over */
  const staggerTargets = (el: HTMLElement, selector: string): HTMLElement[] =>
    selector
      ? (Array.from(el.querySelectorAll(selector)) as HTMLElement[])
      : (Array.from(el.children) as HTMLElement[])

  /** a play's full length for THIS element: the compiled duration plus the
   * stagger tail (max stagger × (children − 1)), computed here because only
   * the DOM knows how many children the cascade covers */
  const playTotal = (el: HTMLElement, c: Compiled, split: Split): number => {
    if (!split.hasStagger) return c.duration
    let maxStagger = 0
    for (const track of split.staggered.tracks) {
      if (track.stagger > maxStagger) maxStagger = track.stagger
    }
    const kids = staggerTargets(el, split.selector).length
    return c.duration + maxStagger * Math.max(0, kids - 1)
  }

  const plays = new Map<string, Play>()
  let frame: number | null = null
  let last = 0

  const applyStyle = (el: HTMLElement, style: MotionStyle) => {
    for (const prop of Object.keys(style)) {
      ;(el.style as unknown as Record<string, string>)[prop] = String(style[prop])
    }
  }

  /**
   * Writes one frame. Unstaggered tracks move the element; staggered tracks
   * cascade over its children — a single timeline can do both.
   * Values from every play on the same element are merged per PROPERTY before
   * composing, so a marquee's x and an entrance's y coexist in one transform.
   */
  function write(play: Play) {
    const elementValues = sampleValues(play.split.element, play.time)
    applyStyle(play.el, composeMotionStyle(mergeForElement(play.el, elementValues, play)))
    if (!play.split.hasStagger) return
    const kids = staggerTargets(play.el, play.split.selector)
    for (let i = 0; i < kids.length; i++) {
      applyStyle(kids[i]!, composeMotionStyle(sampleValues(play.split.staggered, play.time, { childIndex: i })))
    }
  }

  /** merges the other running plays targeting this element, so a marquee's x
   * and an entrance's y compose into ONE transform instead of overwriting */
  function mergeForElement(el: HTMLElement, own: MotionValues, self: Play): MotionValues {
    let merged: MotionValues = {}
    let found = false
    plays.forEach((other) => {
      if (other === self || other.el !== el) return
      found = true
      merged = { ...merged, ...sampleValues(other.split.element, other.time) }
    })
    return found ? { ...merged, ...own } : own
  }

  /** clears what a play wrote so the element returns to its authored styling */
  function clear(play: Play) {
    const els: HTMLElement[] = [play.el]
    if (play.split.hasStagger) els.push(...staggerTargets(play.el, play.split.selector))
    for (const el of els) {
      for (const prop of MOTION_CSS_PROPS) {
        ;(el.style as unknown as Record<string, string>)[prop] = ''
      }
    }
  }

  function loop(now: number) {
    const dt = last ? now - last : 16
    last = now
    let live = false
    plays.forEach((play, key) => {
      if (!play.running) return
      play.time += dt * play.direction
      const infinite = play.compiled.tracks.some((t) => t.repeat === Infinity)
      if (play.direction === 1 && play.time >= play.total && !infinite) {
        play.time = play.total
        play.running = false
      } else if (play.direction === -1 && play.time <= 0) {
        clear(play)
        plays.delete(key)
        return
      } else {
        live = true
      }
      write(play)
    })
    frame = live ? requestAnimationFrame(loop) : ((last = 0), null)
  }

  const ensureLoop = () => {
    if (frame === null) {
      last = 0
      frame = requestAnimationFrame(loop)
    }
  }

  const playKey = (key: string, index: number) => `${key}:${index}`

  /** `settle: true` jumps straight to the end state without animating —
   * what `still` does, but for one binding. Used when rAF will not run. */
  function start(meta: BindingMeta, reverse = false, settle = false) {
    if (!allowed(meta.k)) return
    const c = compiled[meta.a]
    const split = splits[meta.a]
    if (!c || !split) return
    const jump = still || settle
    const els = targets.get(meta.k) || []
    els.forEach((el, index) => {
      const key = playKey(meta.k, index)
      const existing = plays.get(key)
      const total = playTotal(el, c, split)
      const play: Play = {
        el,
        compiled: c,
        split,
        time: reverse ? foldReverseTime(c, existing ? existing.time : c.duration) : 0,
        direction: reverse ? -1 : 1,
        running: !jump,
        total,
      }
      plays.set(key, play)
      if (jump) {
        // sample at `total`, not compiled.duration — endStyle() at duration
        // left staggered children part-faded (their windows extend into the
        // stagger tail); write() at total lands every child on its end value
        play.time = total
        play.running = false
        write(play)
      } else {
        write(play)
      }
    })
    if (!jump) ensureLoop()
  }

  function reverseBinding(meta: BindingMeta) {
    const els = targets.get(meta.k) || []
    els.forEach((_el, index) => {
      const play = plays.get(playKey(meta.k, index))
      if (!play) return
      // an infinite loop that ran for minutes must not rewind for minutes
      play.time = foldReverseTime(play.compiled, play.time)
      play.direction = -1
      play.running = !still
    })
    if (!still) ensureLoop()
  }

  // ---------- collect bindings ----------

  const scrubs: { meta: BindingMeta; el: HTMLElement }[] = []
  const appearOnce = new Set<string>()
  const appearing: { meta: BindingMeta; el: HTMLElement }[] = []
  /** appearAt value → the observer watching at that threshold */
  const observers = new Map<number, IntersectionObserver>()

  const observerFor = (at: number) => {
    let observer = observers.get(at)
    if (!observer) {
      observer = new IntersectionObserver(onAppear, { rootMargin: appearRootMargin(at) })
      observers.set(at, observer)
    }
    return observer
  }

  function onAppear(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const list = JSON.parse(entry.target.getAttribute('data-anim') || '[]') as BindingMeta[]
      for (const meta of list) {
        if (meta.t !== 'appear') continue
        if (entry.isIntersecting) {
          const mode = meta.o && meta.o.m
          // the key is per-repeat, so "once" means once PER CARD
          if (!mode && appearOnce.has(meta.k)) continue
          appearOnce.add(meta.k)
          start(meta)
        } else if (meta.o && meta.o.m === 'reverse') {
          reverseBinding(meta)
        }
      }
    }
  }

  document.querySelectorAll<HTMLElement>('[data-anim]').forEach((el) => {
    const list = JSON.parse(el.getAttribute('data-anim') || '[]') as BindingMeta[]
    for (const meta of list) {
      if (meta.t === 'load') {
        // A hidden tab (background load, prerender, print) does not run rAF, so
        // an entrance would sit on its primed first frame — which for the usual
        // opacity 0 → 1 is simply invisible, and stays that way until the tab is
        // focused. Land on the end state instead; the same reasoning as the 3s
        // appear fallback below.
        start(meta, false, hiddenAtBoot)
      } else if (meta.t === 'appear') {
        appearing.push({ meta, el })
        observerFor((meta.o && meta.o.at) || 0).observe(el)
      } else if (meta.t === 'scrub') {
        scrubs.push({ meta, el })
      } else if (meta.t === 'hover') {
        el.addEventListener('mouseenter', () => start(meta))
        el.addEventListener('mouseleave', () => reverseBinding(meta))
      } else if (meta.t === 'click') {
        el.addEventListener('click', () => {
          const play = plays.get(playKey(meta.k, 0))
          if (play && play.direction === 1) reverseBinding(meta)
          else start(meta)
        })
      }
    }
  })

  // ---------- prime first frames (no flash) ----------
  // The exporter inlines the element-level first frame, but staggered children
  // and measured targets can only be primed here. Runs before any trigger so
  // nothing paints its final state first.
  if (!still) {
    // load bindings are NOT primed when the document is hidden: they were just
    // settled on their end state above, and priming would paint frame 0 back
    // over it (this block runs after the collect loop)
    const loadToPrime = hiddenAtBoot
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('[data-anim]')).flatMap((el) =>
          (JSON.parse(el.getAttribute('data-anim') || '[]') as BindingMeta[])
            .filter((m) => m.t === 'load')
            .map((meta) => ({ meta, el })),
        )
    for (const { meta } of appearing.concat(loadToPrime)) {
      const split = splits[meta.a]
      if (!split || !allowed(meta.k)) continue
      const first = initialStyle(split.element)
      const firstChild = split.hasStagger ? initialStyle(split.staggered) : null
      for (const el of targets.get(meta.k) || []) {
        if (Object.keys(first).length) applyStyle(el, first)
        if (firstChild && Object.keys(firstChild).length) {
          staggerTargets(el, split.selector).forEach((kid) => applyStyle(kid, firstChild))
        }
      }
    }
  }

  // ---------- scroll-driven ----------

  // `still` (?noanim / prefers-reduced-motion) means NO movement at all: scrub
  // bindings are skipped entirely, so scrubbed elements hold their natural
  // authored state (a parallax frozen mid-flight would be an arbitrary frame)
  if (scrubs.length && !still) {
    let pending = false
    let lastT = 0
    // scrub.smooth (seconds, a time constant): the play lags its scroll target
    // by an exponential catch-up, so fast scrolling reads as eased motion
    // instead of a hard 1:1 lock. The rAF loop keeps itself alive until every
    // smoothed binding has converged on its target.
    const smoothState = new Map<BindingMeta, number>()
    const updateScrub = (now?: number) => {
      pending = false
      const t = typeof now === 'number' ? now : performance.now()
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60
      lastT = t
      let unsettled = false
      const vh = window.innerHeight
      // Several scrub bindings can tween the same property on one element
      // (chained segments, or a marker-driven tween plus the element's own).
      // write() gives the LAST-written play priority per property, so order
      // the frame's writes by distance from the active 0..1 range, farthest
      // first: the binding nearest (or inside) its range lands last and wins,
      // instead of whichever binding happens to sit last in DOM order pinning
      // the element to its clamped resting value every frame.
      const frame_ = scrubs
        .filter(({ meta }) => allowed(meta.k) && compiled[meta.a] && splits[meta.a])
        .map((entry) => {
          const scrubOpts = entry.meta.o && entry.meta.o.s
          let raw = scrubProgressRaw(entry.el.getBoundingClientRect().top, vh, scrubOpts)
          const smooth =
            scrubOpts && typeof scrubOpts.smooth === 'number' && scrubOpts.smooth > 0
              ? scrubOpts.smooth
              : 0
          if (smooth) {
            const prev = smoothState.has(entry.meta) ? smoothState.get(entry.meta)! : raw
            let eased = prev + (raw - prev) * (1 - Math.exp(-dt / smooth))
            if (Math.abs(raw - eased) > 0.001) unsettled = true
            else eased = raw
            smoothState.set(entry.meta, eased)
            raw = eased
          }
          return { entry, raw, dist: raw < 0 ? -raw : raw > 1 ? raw - 1 : 0 }
        })
        .sort((a, b) => b.dist - a.dist)
      for (const { entry, raw } of frame_) {
        const { meta } = entry
        const c = compiled[meta.a]!
        const split = splits[meta.a]!
        const p = raw < 0 ? 0 : raw > 1 ? 1 : raw
        const nodes = targets.get(meta.k) || []
        nodes.forEach((node, index) => {
          const total = playTotal(node, c, split)
          const play: Play = {
            el: node,
            compiled: c,
            split,
            // progress maps over the FULL length so a staggered scrub reaches
            // its last child's end value at p = 1
            time: p * total,
            direction: 1,
            running: false,
            total,
          }
          plays.set(playKey(meta.k, index), play)
          write(play)
        })
      }
      if (unsettled && !pending) {
        pending = true
        requestAnimationFrame(updateScrub)
      }
    }
    const onScroll = () => {
      if (!pending) {
        pending = true
        requestAnimationFrame(updateScrub)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    updateScrub()
  }

  // ---------- breakpoint re-gating ----------

  if (Object.keys(bpScope).length && bps.length) {
    let timer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener('resize', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const next = motionBreakpointId(bps, viewportWidth())
        if (next === currentBp) return
        currentBp = next
        // a binding that just left its breakpoint scope must stop styling
        plays.forEach((play, key) => {
          if (!allowed(key.slice(0, key.lastIndexOf(':')))) {
            clear(play)
            plays.delete(key)
          }
        })
      }, 100)
    })
  }

  // safety net, mirroring the interaction runtime: content that animates in
  // must never stay invisible if the observer never fires (hidden tab, print,
  // a crawler that ignores IntersectionObserver)
  if (appearing.length && !still) {
    setTimeout(() => {
      // still hidden when the fallback fires? rAF is not running, so animating
      // would leave the content on its invisible first frame — settle instead
      const hiddenNow = document.visibilityState === 'hidden'
      for (const { meta } of appearing) {
        if (!appearOnce.has(meta.k)) {
          appearOnce.add(meta.k)
          start(meta, false, hiddenNow)
        }
      }
    }, 3000)
  }
}
