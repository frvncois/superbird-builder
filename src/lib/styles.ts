import { TAILWIND_COLORS, TAILWIND_SHADES, isPaletteColor } from './colors'
import { SPACING, borderWidthScheme, type Slot } from './tieredBox'
import { derivePrefix, parseTail, isNamedValueClass, type NamedFormat } from './valueClass'
import { STYLE_SECTIONS } from './styleCatalog'

export type Control =
  | { kind: 'select'; options: { label: string; class: string }[] }
  | { kind: 'color'; prefix: string }
  // a slider is either `prefix`+`stops` (class = `prefix-stop`) or an explicit
  // `classes` list with matching `labels` (for bare/named/signed classes)
  | {
      kind: 'slider'
      prefix?: string
      stops?: string[]
      classes?: string[]
      labels?: string[]
      /** named-scale sliders whose value field maps keywords + arbitrary values */
      custom?: { prefix: string; format: NamedFormat }
    }
  | { kind: 'input'; prefix: string; placeholder?: string }
  // `icon` is a lucide icon *name* (e.g. 'AlignCenter'); the UI resolves it to a
  // component via STYLE_ICONS (styleCatalogIcons.ts). Kept as a string so the
  // catalog stays node-safe for the MCP runtime bundle.
  | { kind: 'icons'; options: { label: string; class: string; icon: string }[] }

type Slider = Extract<Control, { kind: 'slider' }>

/** the ordered tailwind classes a slider steps through */
export function sliderClasses(c: Slider): string[] {
  return c.classes ?? c.stops!.map((s) => `${c.prefix}-${s}`)
}
/** the readout label shown for each slider stop */
export function sliderLabels(c: Slider): string[] {
  return c.labels ?? c.stops ?? c.classes ?? []
}

/** the class prefix a slider's custom-value input writes to, or null if none */
export function sliderPrefix(c: Slider): string | null {
  return c.custom?.prefix ?? c.prefix ?? (c.classes ? derivePrefix(c.classes) : null)
}

/** signed sliders (classes include a `-`-prefixed one) accept negative input */
export function sliderAllowNegative(c: Slider): boolean {
  return !!c.classes?.some((cls) => cls.startsWith('-'))
}

export interface StyleProperty {
  id: string
  label: string
  control: Control
  /** only meaningful on flex/grid parents — adding it auto-adds a display class */
  needsDisplay?: boolean
  /** overrides the class applied when the property is first added */
  default?: string
  /** when absent the property is always shown; otherwise gated on context */
  relevance?: Relevance
}

export interface StyleSection {
  id: string
  label: string
  properties: StyleProperty[]
}

// --- relevance: which properties are worth showing for the current element ---

export type Relevance =
  | { when: 'positioned' } // position ∈ relative/absolute/fixed/sticky
  | { when: 'display'; values: string[] } // the element's own display class
  | { when: 'parentDisplay'; values: string[] } // the parent element's display class
  | { when: 'transition' } // a transition (≠ none) is set
  | { when: 'mediaElement' } // element is an image/video
  | { when: 'mediaOrBackground' } // media element, or any element with a background

export interface RelevanceContext {
  /** the element's own display class token, e.g. 'flex' */
  display?: string
  /** the element's position class token, e.g. 'absolute' */
  position?: string
  /** the parent element's display class token */
  parentDisplay?: string
  /** a transition class other than transition-none is set */
  hasTransition?: boolean
  /** the selected element renders media (img/video) */
  isMedia?: boolean
  /** the element has a background media set */
  hasBackground?: boolean
}

const POSITIONED = ['relative', 'absolute', 'fixed', 'sticky']

export function isPropertyRelevant(prop: StyleProperty, ctx: RelevanceContext): boolean {
  const r = prop.relevance
  if (!r) return true
  switch (r.when) {
    case 'positioned':
      return POSITIONED.includes(ctx.position ?? '')
    case 'display':
      return r.values.includes(ctx.display ?? '')
    case 'parentDisplay':
      return r.values.includes(ctx.parentDisplay ?? '')
    case 'transition':
      return !!ctx.hasTransition
    case 'mediaElement':
      return !!ctx.isMedia
    case 'mediaOrBackground':
      return !!ctx.isMedia || !!ctx.hasBackground
  }
}


// --- class suggestions ---

/** state/breakpoint prefixes the class input understands (typed as `hover:`) */
const VARIANTS = [
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
  'group-hover',
  'first',
  'last',
  'sm',
  'md',
  'lg',
  'xl',
  'dark',
]

function buildVocabulary(): string[] {
  const out = new Set<string>()
  // everything the visual controls know is suggestible
  for (const section of STYLE_SECTIONS) {
    for (const prop of section.properties) {
      const control = prop.control
      if (control.kind === 'select') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'icons') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'slider') sliderClasses(control).forEach((c) => out.add(c))
    }
  }
  const spacing = ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'gap-x', 'gap-y']
  // the validator accepts the in-between steps too ('5', '14') — the visual
  // stepper keeps the coarse SPACING scale, but rejecting px-5 as a typed
  // class was pure friction
  const SPACING_VALID = [...SPACING, '5', '14', '28', '32']
  for (const prefix of spacing) for (const stop of SPACING_VALID) out.add(`${prefix}-${stop}`)
  // width/height sizing runs far past the spacing scale (h-56 hero bands …)
  const SIZE_STOPS = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56', '60', '64', '72', '80', '96']
  for (const prefix of ['w', 'h', 'size']) for (const stop of SIZE_STOPS) out.add(`${prefix}-${stop}`)
  // negative offsets and margins (-bottom-6, -mt-4 …) — signed transform
  // utilities already validate via the slider catalog; these did not
  for (const prefix of ['top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) {
    for (const stop of SPACING) if (stop !== '0') out.add(`-${prefix}-${stop}`)
  }
  // `auto` is valid CSS only where margins and offsets collapse to it
  for (const prefix of ['m', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) out.add(`${prefix}-auto`)
  for (const prefix of ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left']) out.add(`${prefix}-auto`)
  // border-width classes (bare `border`, `border-2`, `border-x`, `border-t`, …)
  // now that they're driven by SpacingBoxControl, not a slider property
  for (const s of ['all', 'x', 'y', 't', 'r', 'b', 'l'] as Slot[]) {
    const prefix = borderWidthScheme.slot('border', s)
    for (const step of borderWidthScheme.steps) out.add(borderWidthScheme.className(prefix, step))
  }
  for (const prefix of ['bg', 'text', 'border']) {
    for (const color of Object.keys(TAILWIND_COLORS)) {
      for (const shade of TAILWIND_SHADES) out.add(`${prefix}-${color}-${shade}`)
    }
  }
  const common = [
    'bg-white', 'bg-black', 'bg-transparent', 'text-white', 'text-black',
    'relative', 'absolute', 'fixed', 'sticky',
    'flex-wrap', 'flex-1', 'shrink-0', 'grow',
    'w-full', 'w-auto', 'w-screen', 'w-fit', 'h-full', 'h-auto', 'h-screen', 'h-fit',
    'min-h-screen', 'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-4xl', 'max-w-6xl', 'mx-auto',
    'italic', 'underline', 'uppercase', 'lowercase', 'capitalize', 'truncate',
    'leading-tight', 'leading-normal', 'leading-relaxed', 'tracking-tight', 'tracking-wide',
    'rounded', 'shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl',
    'opacity-0', 'opacity-50', 'opacity-75', 'opacity-100',
    'overflow-hidden', 'overflow-auto', 'overflow-x-auto', 'overflow-y-auto',
    'transition-all', 'transition-colors', 'duration-150', 'duration-300', 'duration-500',
    'ease-in', 'ease-out', 'ease-in-out',
    'cursor-pointer', 'select-none', 'pointer-events-none',
    'z-0', 'z-10', 'z-20', 'z-50',
    'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-6', 'grid-cols-12',
    'object-cover', 'object-contain', 'aspect-square', 'aspect-video',
    'antialiased', 'col-span-full', 'col-auto', 'row-span-full',
    'inline', 'inline-block', 'inline-flex', 'inline-grid', 'outline-none',
    'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line',
    'whitespace-pre-wrap', 'break-words', 'break-all',
    // `group` marks a hover scope — without it every documented group-hover:
    // variant was dead on arrival
    'group', 'h-px', 'w-px', 'inset-0', 'inset-x-0', 'inset-y-0',
    'grayscale', 'grayscale-0', 'blur-sm', 'blur-md', 'blur-none',
    'underline-offset-1', 'underline-offset-2', 'underline-offset-4', 'underline-offset-8',
  ]
  common.forEach((c) => out.add(c))
  // grid placement — spans and explicit start/end lines
  for (let n = 1; n <= 12; n++) {
    out.add(`col-span-${n}`)
    out.add(`col-start-${n}`)
    out.add(`col-end-${n}`)
  }
  for (let n = 1; n <= 6; n++) {
    out.add(`row-span-${n}`)
    out.add(`row-start-${n}`)
    out.add(`row-end-${n}`)
  }
  return [...out]
}

const VOCABULARY = buildVocabulary()

// project design-token classes (bg-brand …) — synced by useSettings;
// suggested ahead of the static vocabulary
let TOKEN_CLASSES: string[] = []

export function setStyleTokens(names: string[]) {
  TOKEN_CLASSES = names.flatMap((n) => [`bg-${n}`, `text-${n}`, `border-${n}`])
}

/**
 * Suggests classes for the query, honouring variant prefixes:
 * "hover:bg-r" suggests "hover:bg-red-500". While a variant itself is
 * being typed ("hov"), the prefix completion ("hover:") is offered.
 */
export function suggestClasses(query: string, limit = 8): string[] {
  const match = query.trim().match(/^((?:[a-z-]+:)*)(.*)$/)
  const prefix = match?.[1] ?? ''
  const base = (match?.[2] ?? '').toLowerCase()
  if (!base && !prefix) return []

  const results: string[] = []
  if (!prefix && base) {
    for (const variant of VARIANTS) {
      if (variant.startsWith(base)) results.push(`${variant}:`)
    }
  }
  const pool = [...TOKEN_CLASSES, ...VOCABULARY]
  // rank: exact match, then prefix matches (shortest = closest) preserving pool
  // order among equal lengths, then substring matches
  const starts = pool
    .filter((c) => c.startsWith(base))
    .sort((a, b) => (a === base ? -1 : b === base ? 1 : a.length - b.length))
  const contains = base.length > 1 ? pool.filter((c) => !c.startsWith(base) && c.includes(base)) : []
  for (const cls of [...starts, ...contains]) {
    if (results.length >= limit) break
    results.push(prefix + cls)
  }
  return results.slice(0, limit)
}

/**
 * Finds the class token in a class list that this property controls,
 * so the visual editor can read its state straight from the classes
 * string (the single source of truth).
 */
export function matchClass(prop: StyleProperty, classes: string[]): string | undefined {
  const control = prop.control
  switch (control.kind) {
    case 'select':
    case 'icons':
      return classes.find((cls) => control.options.some((o) => o.class === cls))
    case 'color':
      // arbitrary hex (`bg-[#ff0000]`), palette (`bg-slate-100`), or named
      return classes.find((cls) => {
        if (!cls.startsWith(`${control.prefix}-`)) return false
        const value = cls.slice(control.prefix.length + 1)
        return (
          value.startsWith('[#') ||
          isPaletteColor(value) ||
          ['white', 'black', 'transparent'].includes(value)
        )
      })
    case 'slider': {
      const known = sliderClasses(control)
      const exact = classes.find((cls) => known.includes(cls))
      if (exact) return exact
      // named-scale slider: match only in-format arbitrary values so text-[18px]
      // (size) is caught but text-[#fff] (color) is not
      if (control.custom) {
        const { prefix, format } = control.custom
        return classes.find((cls) => isNamedValueClass(prefix, format, known, cls))
      }
      // custom arbitrary / off-scale value typed into the field (e.g. z-[999], p-[4em])
      const prefix = sliderPrefix(control)
      if (prefix) return classes.find((cls) => parseTail(cls, prefix) !== null)
      return undefined
    }
    case 'input':
      return classes.find((cls) => cls.startsWith(`${control.prefix}-`))
  }
}

// --- class-input validation (free-form Classes field) ---

const VOCAB_SET = new Set(VOCABULARY)
const VARIANT_SET = new Set(VARIANTS)

// interaction-state variants (as opposed to responsive/theme breakpoints);
// used to visually flag state classes like `hover:bg-red-500` in the UI
const STATE_VARIANTS = new Set([
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
  'group-hover',
  'first',
  'last',
])

/** true when a class carries a state variant, e.g. `hover:…`, `focus:…` */
export function isStateClass(cls: string): boolean {
  const segments = cls.split(':')
  segments.pop() // drop the base class
  return segments.some((v) => STATE_VARIANTS.has(v))
}

/** splits `hover:md:bg-red-500` into its variant prefix and base class */
function splitVariant(cls: string): { variant: string; base: string } {
  const i = cls.lastIndexOf(':')
  return i === -1 ? { variant: '', base: cls } : { variant: cls.slice(0, i + 1), base: cls.slice(i + 1) }
}

/** true when a variant segment is known — a fixed variant, or an arbitrary
 *  min/max-width breakpoint variant like `max-[767px]` / `min-[48rem]` */
function isKnownVariant(v: string): boolean {
  return VARIANT_SET.has(v) || /^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]$/.test(v)
}

/** numeric flex shorthand Tailwind v4 accepts on its scale: `flex-2`, `flex-0.5` */
const FLEX_NUMERIC_RE = /^flex-\d+(?:\.\d+)?$/

/**
 * A class is valid if every variant segment is known and the base is either
 * an arbitrary-value class (`p-[13px]`), a numeric flex (`flex-2`), in our
 * vocabulary, or a design token.
 */
export function isValidClass(cls: string): boolean {
  const segments = cls.split(':')
  const base = segments.pop() ?? ''
  if (!base) return false
  if (segments.some((v) => !isKnownVariant(v))) return false
  if (/-\[.+\]$/.test(base)) return true // arbitrary value
  if (FLEX_NUMERIC_RE.test(base)) return true // flex-2, flex-0.5, …
  return VOCAB_SET.has(base) || TOKEN_CLASSES.includes(base)
}

/** the catalog property a bare class belongs to, if any */
function propForBase(base: string): StyleProperty | undefined {
  for (const section of STYLE_SECTIONS) {
    for (const prop of section.properties) {
      if (matchClass(prop, [base]) === base) return prop
    }
  }
  return undefined
}

/**
 * A stable identity for the CSS property a bare class controls, used to detect
 * conflicts. Prefers the catalog property; falls back to pattern-based groups
 * (e.g. every `flex-*` shorthand shares one identity) so a typed `flex-2`
 * replaces the icon-picked `flex-1`.
 */
function propKey(base: string): StyleProperty | string | undefined {
  // all flex-grow shorthands (flex-1, flex-2, flex-auto, flex-none…) share one
  // identity — checked before the catalog so the icon-picked flex-1 collides
  // with a typed flex-2
  if (FLEX_NUMERIC_RE.test(base) || ['flex-auto', 'flex-initial', 'flex-none', 'flex-1'].includes(base))
    return 'flex-grow-shorthand'
  return propForBase(base)
}

/** an existing token on the same property + variant that `cls` would collide with */
function conflictingToken(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const key = propKey(base)
  if (!key) return undefined
  return tokens.find((t) => {
    const s = splitVariant(t)
    return s.variant === variant && s.base !== base && propKey(s.base) === key
  })
}

/**
 * The prerequisite class `cls` needs (matched to its own variant) when it maps
 * to a display-gated property and no matching display is present yet — e.g.
 * `flex-row` → `flex`, `grid-cols-3` → `grid`, `hover:flex-row` → `hover:flex`.
 */
function prerequisiteFor(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const r = propForBase(base)?.relevance
  if (!r || r.when !== 'display') return undefined
  // an unprefixed display class applies at every breakpoint/state, so bare
  // `grid` already satisfies `md:grid-cols-2` — don't prepend a redundant
  // `md:grid`
  if (r.values.some((v) => tokens.includes(`${variant}${v}`) || tokens.includes(v))) return undefined
  const preferred = r.values.includes('flex') ? 'flex' : r.values[0]!
  return `${variant}${preferred}`
}

/** true when two bare classes control the same CSS property (e.g. `flex-row`
 * and `flex-col`, or `p-2` and `p-4`) — used to resolve per-breakpoint overrides */
export function sameProperty(a: string, b: string): boolean {
  if (a === b) return true
  const ka = propKey(a)
  return ka !== undefined && ka === propKey(b)
}

export type ApplyClassResult = { tokens: string[] } | { error: string }

/**
 * Validates a typed class against the current token list and returns the
 * resulting tokens (conflict replaced, prerequisite auto-added) or an error.
 * `prerequisites: false` skips the flex/grid prerequisite injection — used by
 * fields (e.g. an interaction's to-state) where a display class shouldn't be
 * added implicitly.
 */
export function applyClass(
  cls: string,
  tokens: string[],
  opts: { prerequisites?: boolean } = {},
): ApplyClassResult {
  const value = cls.trim()
  if (!value) return { error: '' }
  if (!isValidClass(value)) return { error: `"${value}" is not a known class` }
  if (tokens.includes(value)) return { error: `${value} is already added` }

  let next = [...tokens]
  const conflict = conflictingToken(value, next)
  if (conflict) next = next.filter((t) => t !== conflict)
  next.push(value)

  if (opts.prerequisites !== false) {
    const prereq = prerequisiteFor(value, next)
    if (prereq && !next.includes(prereq)) next.unshift(prereq)
  }

  return { tokens: next }
}
