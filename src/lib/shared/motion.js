// The motion engine's pure math, shared VERBATIM by three consumers:
//   - the editor canvas + preview (via src/lib/motion.ts → useMotion)
//   - the published-site runtime (src/motion/runtime.ts → assets/motion.js)
//   - the MCP server's validators (via src/lib/mcp-runtime.ts)
// Plain-JS ESM so the node exporter and the browser bundle can both consume it
// directly, and DOM-free so identical input always produces identical output on
// every surface — that equivalence is the whole point of this file living here.
// Types live in src/lib/motion.ts.
//
// The model: an Animation is an ordered list of steps; each step tweens a set
// of property tracks over a duration with an easing. compileAnimation() flattens
// that into absolute-timed tracks; sampleValues() turns a time into per-property
// values; composeMotionStyle() turns those into CSS. Nothing here touches an
// element — the caller applies the result.
//
// Values may carry a unit ("110%", "1em", -50) so a move can be relative to the
// element or the viewport, which is what makes marquees and percentage slides
// resolution-independent. The unit travels with the value into the CSS, where
// the browser resolves it natively.

/**
 * Every tweenable property: how it reaches CSS, its default unit, the units it
 * accepts, and the neutral value used when a track omits `from` and the caller
 * can't measure one. `kind` groups properties that compose into one CSS
 * declaration.
 */
const LENGTH_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh']

export const MOTION_PROPS = {
  x: { kind: 'transform', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Move X' },
  y: { kind: 'transform', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Move Y' },
  scale: { kind: 'transform', unit: '', units: [], def: 1, label: 'Scale' },
  rotate: { kind: 'transform', unit: 'deg', units: ['deg'], def: 0, label: 'Rotate' },
  opacity: { kind: 'opacity', unit: '', units: [], def: 1, label: 'Opacity' },
  blur: { kind: 'filter', unit: 'px', units: ['px', 'em', 'rem'], def: 0, label: 'Blur' },
  brightness: { kind: 'filter', unit: '', units: [], def: 1, label: 'Brightness' },
  saturate: { kind: 'filter', unit: '', units: [], def: 1, label: 'Saturate' },
  bgColor: { kind: 'color', css: 'backgroundColor', unit: '', units: [], def: '#00000000', label: 'Background' },
  textColor: { kind: 'color', css: 'color', unit: '', units: [], def: '#00000000', label: 'Text color' },
  borderColor: { kind: 'color', css: 'borderColor', unit: '', units: [], def: '#00000000', label: 'Border color' },
  width: { kind: 'size', css: 'width', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Width' },
  height: { kind: 'size', css: 'height', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Height' },
  // clip-path inset: how far each edge is pulled IN, as a percentage of the box.
  // clipBottom 100 → 0 is the classic wipe-up reveal.
  clipTop: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip top' },
  clipRight: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip right' },
  clipBottom: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip bottom' },
  clipLeft: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip left' },
}

/** stable property order so composed transform/filter strings never jitter */
const TRANSFORM_ORDER = ['x', 'y', 'rotate', 'scale']
const FILTER_ORDER = ['blur', 'brightness', 'saturate']
const CLIP_ORDER = ['clipTop', 'clipRight', 'clipBottom', 'clipLeft']
const COLOR_PROPS = ['bgColor', 'textColor', 'borderColor']
const SIZE_PROPS = ['width', 'height']

const c1 = 1.70158
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3

/** Easing functions, all f(0)=0 f(1)=1. Keys are what a step stores. */
export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'quad-in': (t) => t * t,
  'quad-out': (t) => 1 - (1 - t) * (1 - t),
  'quart-in': (t) => t * t * t * t,
  'quart-out': (t) => 1 - Math.pow(1 - t, 4),
  'quart-in-out': (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  'back-out': (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  'elastic-out': (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  'bounce-out': (t) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
}

export const EASING_KEYS = Object.keys(EASINGS)

/** the key a binding fires under; `@scope` isolates component instances and
 * collection-list repeats (the scope string may compose several parts) */
export function animationBindingKey(bindingId, scope) {
  return scope ? `${bindingId}@${scope}` : bindingId
}

/**
 * Desktop-first breakpoint resolution — the tightest breakpoint still covering
 * `width`, else the widest. Mirrors breakpointIdForWidth in src/lib/responsive.ts
 * (canonical); duplicated here so the site runtime needs no TS import.
 * @param {{id: string, w: number}[]} bps
 * @param {number} width
 * @returns {string}
 */
export function motionBreakpointId(bps, width) {
  if (!bps || !bps.length) return ''
  const asc = bps.slice().sort((a, b) => a.w - b.w)
  for (let i = 0; i < asc.length; i++) if (width <= asc[i].w) return asc[i].id
  return asc[asc.length - 1].id
}

// ---------- values and units ----------

const NUMBER_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i

/**
 * Splits a track value into a number and a unit. Numbers adopt the property's
 * default unit; strings carry their own. Returns null when unparseable.
 * @param {number|string} value
 * @param {string} prop
 * @returns {{n: number, unit: string}|null}
 */
export function parseTrackValue(value, prop) {
  const meta = MOTION_PROPS[prop]
  if (!meta) return null
  if (typeof value === 'number') {
    return isFinite(value) ? { n: value, unit: meta.unit } : null
  }
  if (typeof value !== 'string') return null
  const m = NUMBER_UNIT_RE.exec(value)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n)) return null
  const unit = m[2] || meta.unit
  // a unitless property never accepts one; others must use an allowed unit
  if (!meta.units.length) return m[2] ? null : { n, unit: '' }
  return meta.units.indexOf(unit) === -1 ? null : { n, unit }
}

const round = (n) => Math.round(n * 1000) / 1000

// ---------- color ----------

/** '#rgb' | '#rrggbb' | '#rrggbbaa' → [r,g,b,a] (a in 0..1); null if unparseable */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      1,
    ]
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ]
  }
  return null
}

/**
 * interpolates two colors, premultiplying nothing — plain channel lerp.
 * Falls back to the destination when either side is unparseable.
 * @returns {string} an rgba() string
 */
export function lerpColor(from, to, t) {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return typeof to === 'string' ? to : ''
  const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * t)
  const alpha = a[3] + (b[3] - a[3]) * t
  return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${round(alpha)})`
}

// ---------- compile ----------

const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback)

/**
 * Flattens an Animation's steps into absolute-timed tracks.
 * A step starts at the previous step's END plus its `offset` (negative
 * overlaps). `duration` is the timeline length ignoring infinite repeats, so
 * scrub mapping stays finite.
 *
 * @param {{steps?: any[]}} animation
 * @returns {{tracks: any[], duration: number}}
 */
export function compileAnimation(animation) {
  const tracks = []
  let cursor = 0
  let end = 0
  const steps = (animation && animation.steps) || []
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s]
    const duration = Math.max(0, num(step.duration, 0))
    const start = Math.max(0, cursor + num(step.offset, 0))
    const repeat = num(step.repeat, 0)
    const iterations = repeat < 0 ? Infinity : repeat + 1
    // one iteration's worth of time, used for scrub/finite length
    const span = duration * (repeat < 0 ? 1 : iterations)
    const easing = EASINGS[step.easing] ? step.easing : 'ease-out'
    const stagger = Math.max(0, num(step.stagger, 0))
    for (const track of step.tracks || []) {
      if (!MOTION_PROPS[track.prop]) continue
      tracks.push({
        prop: track.prop,
        from: track.from,
        to: track.to,
        start,
        duration,
        easing,
        stagger,
        // a selector narrows a staggered track to matching descendants
        staggerSelector: stagger > 0 ? step.staggerSelector || '' : '',
        repeat: iterations,
        yoyo: !!step.yoyo,
        stepIndex: s,
      })
    }
    cursor = start + duration
    end = Math.max(end, start + span)
  }
  return { tracks, duration: end }
}

/**
 * Splits a compiled timeline into the part that moves the ELEMENT and the part
 * that cascades over its children. Without this, one staggered step would drag
 * every other step onto the children too.
 * @param {{tracks: any[], duration: number}} compiled
 * @returns {{element: object, staggered: object, hasStagger: boolean, selector: string}}
 */
export function splitByStagger(compiled) {
  const element = []
  const staggered = []
  let selector = ''
  for (const track of compiled.tracks) {
    if (track.stagger > 0) {
      staggered.push(track)
      if (!selector && track.staggerSelector) selector = track.staggerSelector
    } else {
      element.push(track)
    }
  }
  return {
    element: { tracks: element, duration: compiled.duration },
    staggered: { tracks: staggered, duration: compiled.duration },
    hasStagger: staggered.length > 0,
    selector,
  }
}

/** true when the timeline never ends on its own */
export function hasInfinite(compiled) {
  return compiled.tracks.some((t) => t.repeat === Infinity)
}

/**
 * The time to rewind from. An infinite loop that ran for minutes must not play
 * backwards for minutes — fold it into the current cycle first.
 * @param {{tracks: any[], duration: number}} compiled
 * @param {number} t
 * @returns {number}
 */
export function foldReverseTime(compiled, t) {
  if (t <= 0) return 0
  const span = compiled.duration
  if (span <= 0) return 0
  if (hasInfinite(compiled)) return t % span
  return t > span ? span : t
}

/** local progress 0..1 of one track at absolute time `t`, or null when the
 * track hasn't started (so earlier values don't leak) */
function trackProgress(track, t, childIndex) {
  const start = track.start + track.stagger * childIndex
  if (t < start) return null
  if (track.duration <= 0) return 1
  const elapsed = t - start
  const total = track.duration * track.repeat
  // finished: settle on the final iteration's end value
  if (elapsed >= total) {
    const lastIsReverse = track.yoyo && track.repeat !== Infinity && track.repeat % 2 === 0
    return lastIsReverse ? 0 : 1
  }
  const iteration = Math.floor(elapsed / track.duration)
  const local = (elapsed % track.duration) / track.duration
  return track.yoyo && iteration % 2 === 1 ? 1 - local : local
}

/**
 * Samples a compiled animation at time `t` (ms) into per-property VALUES —
 * `{n, unit}` for numerics, `{color}` for colors. Keeping values separate from
 * CSS lets a caller merge several plays per property before composing, so a
 * marquee's x and an entrance's y can share one element.
 *
 * `current` supplies measured values for tracks that omit `from`.
 *
 * @param {{tracks: any[], duration: number}} compiled
 * @param {number} t
 * @param {{childIndex?: number, current?: Record<string, any>}} [opts]
 * @returns {Record<string, {n?: number, unit?: string, color?: string}>}
 */
export function sampleValues(compiled, t, opts) {
  const childIndex = (opts && opts.childIndex) || 0
  const current = (opts && opts.current) || {}
  const values = {}
  for (const track of compiled.tracks) {
    const p = trackProgress(track, t, childIndex)
    if (p === null) continue
    const meta = MOTION_PROPS[track.prop]
    const eased = EASINGS[track.easing](p)
    if (meta.kind === 'color') {
      const from =
        track.from !== undefined && track.from !== null
          ? track.from
          : current[track.prop] !== undefined
            ? current[track.prop]
            : meta.def
      values[track.prop] = { color: lerpColor(from, track.to, eased) }
      continue
    }
    // the destination decides the unit; `from` is read in the same unit
    const to = parseTrackValue(track.to, track.prop) || { n: meta.def, unit: meta.unit }
    let fromVal
    if (track.from !== undefined && track.from !== null) {
      fromVal = parseTrackValue(track.from, track.prop)
    } else if (current[track.prop] !== undefined) {
      fromVal = parseTrackValue(current[track.prop], track.prop)
    }
    // a measured/absent `from` in a different unit can't be interpolated —
    // fall back to the property's neutral value in the destination's unit
    const fromN = fromVal && fromVal.unit === to.unit ? fromVal.n : fromVal ? fromVal.n : meta.def
    values[track.prop] = { n: fromN + (to.n - fromN) * eased, unit: to.unit }
  }
  return values
}

/**
 * Turns sampled values into a CSS style object (camelCase keys). Composing is
 * separate from sampling so several plays can be merged per property first.
 * @param {Record<string, any>} values
 * @returns {Record<string, string|number>}
 */
export function composeMotionStyle(values) {
  const style = {}
  const txt = (prop) => {
    const v = values[prop]
    return `${round(v.n)}${v.unit || ''}`
  }

  const transforms = []
  for (const prop of TRANSFORM_ORDER) {
    if (values[prop] === undefined) continue
    if (prop === 'x') transforms.push(`translateX(${txt('x')})`)
    else if (prop === 'y') transforms.push(`translateY(${txt('y')})`)
    else if (prop === 'rotate') transforms.push(`rotate(${txt('rotate')})`)
    else transforms.push(`scale(${txt('scale')})`)
  }
  if (transforms.length) style.transform = transforms.join(' ')

  const filters = []
  for (const prop of FILTER_ORDER) {
    if (values[prop] === undefined) continue
    filters.push(`${prop}(${txt(prop)})`)
  }
  if (filters.length) style.filter = filters.join(' ')

  if (values.opacity !== undefined) style.opacity = round(values.opacity.n)
  for (const prop of COLOR_PROPS) {
    if (values[prop] !== undefined) style[MOTION_PROPS[prop].css] = values[prop].color
  }
  for (const prop of SIZE_PROPS) {
    if (values[prop] !== undefined) style[MOTION_PROPS[prop].css] = txt(prop)
  }
  // any clip edge in play means the whole inset() must be written; untouched
  // edges read 0 so the box is only cropped where the animation asks
  if (CLIP_ORDER.some((p) => values[p] !== undefined)) {
    const edges = CLIP_ORDER.map((p) => (values[p] === undefined ? '0%' : txt(p)))
    style.clipPath = `inset(${edges.join(' ')})`
  }
  return style
}

/**
 * Samples a compiled animation at time `t` into a style object.
 * @returns {Record<string, string|number>}
 */
export function sampleAnimation(compiled, t, opts) {
  return composeMotionStyle(sampleValues(compiled, t, opts))
}

/** the style at the animation's end — what reduced-motion and ?noanim apply */
export function endStyle(compiled, opts) {
  return sampleAnimation(compiled, compiled.duration, opts)
}

/**
 * The state BEFORE anything plays: each property's earliest explicit `from`.
 * Tracks that omit `from` (measured at play time) contribute nothing, since
 * their starting value is whatever the element already renders.
 *
 * The exporter bakes this into the HTML so an appear/load element never paints
 * its final state before the runtime boots.
 *
 * @param {{tracks: any[], duration: number}} compiled
 * @returns {Record<string, string|number>}
 */
export function initialStyle(compiled) {
  const earliest = {}
  const values = {}
  for (const track of compiled.tracks) {
    if (track.from === undefined || track.from === null) continue
    if (earliest[track.prop] !== undefined && earliest[track.prop] <= track.start) continue
    earliest[track.prop] = track.start
    const meta = MOTION_PROPS[track.prop]
    if (meta.kind === 'color') {
      values[track.prop] = { color: lerpColor(track.from, track.from, 0) }
    } else {
      const v = parseTrackValue(track.from, track.prop)
      if (v) values[track.prop] = v
    }
  }
  return composeMotionStyle(values)
}

/** the CSS properties this engine can write — what a caller must clear */
export const MOTION_CSS_PROPS = [
  'transform',
  'filter',
  'opacity',
  'backgroundColor',
  'color',
  'borderColor',
  'width',
  'height',
  'clipPath',
]

// ---------- validation (shared by the editor and the MCP) ----------

const TRIGGERS = ['load', 'appear', 'scrub', 'hover', 'click']
const APPEAR_MODES = ['replay', 'reverse']
// conservative: enough for tag/class/id/descendant/attribute selectors, no
// commas-with-parens tricks, and capped so a pathological selector can't ship
const SELECTOR_RE = /^[\w\s.#>~*:+\-[\]="',()]{1,120}$/

const fail = (error) => ({ ok: false, error })

/**
 * @param {any} animation
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateAnimation(animation) {
  if (!animation || typeof animation !== 'object') return fail('animation must be an object')
  if (typeof animation.name !== 'string' || !animation.name.trim()) {
    return fail('animation needs a name')
  }
  if (!Array.isArray(animation.steps) || !animation.steps.length) {
    return fail('animation needs at least one step')
  }
  for (let i = 0; i < animation.steps.length; i++) {
    const step = animation.steps[i]
    const at = `step ${i + 1}`
    if (!step || typeof step !== 'object') return fail(`${at} must be an object`)
    if (!Array.isArray(step.tracks) || !step.tracks.length) {
      return fail(`${at} needs at least one property`)
    }
    if (typeof step.duration !== 'number' || !isFinite(step.duration) || step.duration < 0) {
      return fail(`${at} duration must be a non-negative number of milliseconds`)
    }
    if (typeof step.easing !== 'string' || !EASINGS[step.easing]) {
      return fail(`${at} easing must be one of: ${EASING_KEYS.join(', ')}`)
    }
    if (step.repeat !== undefined && (typeof step.repeat !== 'number' || step.repeat < -1)) {
      return fail(`${at} repeat must be a number (-1 for infinite)`)
    }
    if (step.stagger !== undefined && (typeof step.stagger !== 'number' || step.stagger < 0)) {
      return fail(`${at} stagger must be a non-negative number of milliseconds`)
    }
    if (step.staggerSelector !== undefined) {
      if (typeof step.staggerSelector !== 'string' || !SELECTOR_RE.test(step.staggerSelector)) {
        return fail(`${at} staggerSelector must be a simple CSS selector (max 120 chars)`)
      }
      if (!step.stagger) return fail(`${at} has a staggerSelector but no stagger`)
    }
    for (const track of step.tracks) {
      if (!track || !MOTION_PROPS[track.prop]) {
        return fail(
          `${at} has an unknown property "${track && track.prop}" — use one of: ${Object.keys(MOTION_PROPS).join(', ')}`,
        )
      }
      const meta = MOTION_PROPS[track.prop]
      if (track.to === undefined || track.to === null || track.to === '') {
        return fail(`${at} property "${track.prop}" needs a "to" value`)
      }
      if (meta.kind === 'color') {
        if (!parseColor(track.to)) return fail(`${at} property "${track.prop}" needs a hex color`)
        if (track.from !== undefined && !parseColor(track.from)) {
          return fail(`${at} property "${track.prop}" "from" must be a hex color`)
        }
        continue
      }
      const units = meta.units.length ? ` (units: ${meta.units.join(', ')})` : ' (no unit)'
      const to = parseTrackValue(track.to, track.prop)
      if (!to) return fail(`${at} property "${track.prop}" has an invalid "to" value${units}`)
      if (track.from !== undefined && track.from !== null) {
        const from = parseTrackValue(track.from, track.prop)
        if (!from) return fail(`${at} property "${track.prop}" has an invalid "from" value${units}`)
        // mixing units inside one tween can't be interpolated numerically
        if (typeof track.from === 'string' && typeof track.to === 'string' && from.unit !== to.unit) {
          return fail(
            `${at} property "${track.prop}" mixes units ("${from.unit}" → "${to.unit}") — use the same unit on both sides`,
          )
        }
      }
    }
  }
  return { ok: true }
}

/**
 * @param {any} binding
 * @param {{animationIds?: string[]}} [ctx]
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateBinding(binding, ctx) {
  if (!binding || typeof binding !== 'object') return fail('binding must be an object')
  if (typeof binding.animationId !== 'string' || !binding.animationId) {
    return fail('binding needs an animationId')
  }
  const known = ctx && ctx.animationIds
  if (known && known.indexOf(binding.animationId) === -1) {
    return fail(`no animation "${binding.animationId}" in the library`)
  }
  if (TRIGGERS.indexOf(binding.trigger) === -1) {
    return fail(`trigger must be one of: ${TRIGGERS.join(', ')}`)
  }
  if (binding.appearMode !== undefined && APPEAR_MODES.indexOf(binding.appearMode) === -1) {
    return fail(`appearMode must be one of: ${APPEAR_MODES.join(', ')}`)
  }
  if (binding.appearAt !== undefined) {
    if (typeof binding.appearAt !== 'number' || binding.appearAt < 0 || binding.appearAt > 1) {
      return fail('appearAt must be a number between 0 and 1 (viewport fraction)')
    }
  }
  if (binding.scrub !== undefined) {
    if (typeof binding.scrub !== 'object' || binding.scrub === null) {
      return fail('scrub must be an object with start/end')
    }
    for (const k of ['start', 'end']) {
      const v = binding.scrub[k]
      if (v !== undefined && (typeof v !== 'number' || !isFinite(v))) {
        return fail(`scrub.${k} must be a number`)
      }
    }
    // optional scroll smoothing: seconds the play lags its scroll target
    // (exponential catch-up). Capped so a typo can't park the site mid-tween.
    const smooth = binding.scrub.smooth
    if (smooth !== undefined && (typeof smooth !== 'number' || !isFinite(smooth) || smooth < 0 || smooth > 3)) {
      return fail('scrub.smooth must be a number of seconds between 0 and 3')
    }
  }
  return { ok: true }
}

/** scrub defaults, in one place so the editor and runtime agree */
export const SCRUB_DEFAULTS = { start: 1, end: 0.25 }

/** appear fires as soon as any pixel enters unless the binding asks for more */
export const APPEAR_AT_DEFAULT = 0

/**
 * The IntersectionObserver rootMargin that makes `appear` wait until the
 * element's top has travelled `appearAt` down the viewport (0.8 ≈ "top 80%").
 * @param {number|undefined} appearAt
 * @returns {string}
 */
export function appearRootMargin(appearAt) {
  const at = typeof appearAt === 'number' ? Math.max(0, Math.min(1, appearAt)) : APPEAR_AT_DEFAULT
  if (!at) return '0px'
  return `0px 0px -${round((1 - at) * 100)}% 0px`
}

/**
 * Progress 0..1 for a scrub binding given the element's viewport position.
 * `top` is getBoundingClientRect().top, `vh` the viewport height. Progress is
 * 0 while the element's top sits at `start * vh` and 1 at `end * vh`.
 */
export function scrubProgress(top, vh, scrub) {
  const p = scrubProgressRaw(top, vh, scrub)
  return p < 0 ? 0 : p > 1 ? 1 : p
}

/**
 * Same mapping WITHOUT the 0..1 clamp. When several scrub bindings tween the
 * same property on one element, the runtime uses the unclamped value to rank
 * them — the binding nearest its active range wins the frame — so chained
 * segments compose instead of the last binding overwriting every frame with
 * its clamped resting value.
 */
export function scrubProgressRaw(top, vh, scrub) {
  const start = (scrub && typeof scrub.start === 'number' ? scrub.start : SCRUB_DEFAULTS.start) * vh
  const end = (scrub && typeof scrub.end === 'number' ? scrub.end : SCRUB_DEFAULTS.end) * vh
  if (start === end) return top <= end ? 1 : 0
  return (start - top) / (start - end)
}
