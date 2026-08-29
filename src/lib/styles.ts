import type { Component } from 'vue'
import { TAILWIND_COLORS, TAILWIND_SHADES, isPaletteColor } from './colors'
import { SPACING, borderWidthScheme, type Slot } from './tieredBox'
import { derivePrefix, parseTail, isNamedValueClass, type NamedFormat } from './valueClass'

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
  | { kind: 'icons'; options: { label: string; class: string; icon: Component }[] }

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

// reusable relevance tags for the catalog below
const FLEX = ['flex', 'inline-flex']
const GRID = ['grid', 'inline-grid']
const FLEX_GRID = [...FLEX, ...GRID]
const inFlex: Relevance = { when: 'display', values: FLEX }
const inGrid: Relevance = { when: 'display', values: GRID }
const inFlexGrid: Relevance = { when: 'display', values: FLEX_GRID }
const childOfFlex: Relevance = { when: 'parentDisplay', values: FLEX }
const childOfGrid: Relevance = { when: 'parentDisplay', values: GRID }
const childOfFlexGrid: Relevance = { when: 'parentDisplay', values: FLEX_GRID }
const positioned: Relevance = { when: 'positioned' }
const whenTransition: Relevance = { when: 'transition' }
const whenMedia: Relevance = { when: 'mediaElement' }
const whenMediaOrBg: Relevance = { when: 'mediaOrBackground' }

import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  Baseline,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  ChevronsLeftRight,
  Dot,
  Expand,
  Eye,
  EyeOff,
  Grid3x3,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  MoveVertical,
  MousePointer2,
  Rabbit,
  Scroll,
  Shrink,
  Spline,
  Square,
  StretchHorizontal,
  StretchVertical,
  Strikethrough,
  Turtle,
  Underline,
  WrapText,
} from 'lucide-vue-next'

const OPACITY = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']

// terse control builders so the catalog below stays readable
const sel = (pairs: [string, string][]): Control => ({
  kind: 'select',
  options: pairs.map(([label, cls]) => ({ label, class: cls })),
})
const slide = (prefix: string, stops: string[] = SPACING): Control => ({ kind: 'slider', prefix, stops })
// explicit-class slider (bare/named classes: `border`, `rounded-xl`, `shadow-lg`).
// `custom` opts the value field into keyword + arbitrary editing (font-size…).
const slideC = (
  pairs: [string, string][],
  custom?: { prefix: string; format: NamedFormat },
): Control => ({
  kind: 'slider',
  classes: pairs.map(([, cls]) => cls),
  labels: pairs.map(([label]) => label),
  ...(custom ? { custom } : {}),
})
// signed slider centred on 0: `-prefix-n … prefix-0 … prefix-n`
const signed = (prefix: string, mags: string[]): Control => {
  const neg = [...mags].reverse().map((m) => [`-${m}`, `-${prefix}-${m}`] as [string, string])
  const pos = mags.map((m) => [m, `${prefix}-${m}`] as [string, string])
  return slideC([...neg, ['0', `${prefix}-0`], ...pos])
}
const col = (prefix: string): Control => ({ kind: 'color', prefix })
const inp = (prefix: string, placeholder?: string): Control => ({ kind: 'input', prefix, placeholder })
// icon-button group; each option carries its lucide icon
const ico = (opts: [string, string, Component][]): Control => ({
  kind: 'icons',
  options: opts.map(([label, cls, icon]) => ({ label, class: cls, icon })),
})

export const STYLE_SECTIONS: StyleSection[] = [
  {
    id: 'layout',
    label: 'Layout',
    properties: [
      {
        id: 'display',
        label: 'Display',
        control: ico([
          ['Block', 'block', Square],
          ['Inline', 'inline', Baseline],
          ['Flex', 'flex', StretchHorizontal],
          ['Grid', 'grid', Grid3x3],
          ['None', 'hidden', Ban],
        ]),
      },
      {
        id: 'direction',
        label: 'Direction',
        needsDisplay: true,
        relevance: inFlex,
        control: ico([
          ['Row', 'flex-row', ArrowRight],
          ['Column', 'flex-col', ArrowDown],
          ['Row reverse', 'flex-row-reverse', ArrowLeft],
          ['Col reverse', 'flex-col-reverse', ArrowUp],
        ]),
      },
      {
        id: 'align',
        label: 'Align items',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'items-start', AlignStartHorizontal],
          ['Center', 'items-center', AlignCenterHorizontal],
          ['End', 'items-end', AlignEndHorizontal],
          ['Stretch', 'items-stretch', StretchVertical],
          ['Baseline', 'items-baseline', Baseline],
        ]),
      },
      {
        id: 'justify',
        label: 'Justify',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'justify-start', AlignStartVertical],
          ['Center', 'justify-center', AlignCenterVertical],
          ['End', 'justify-end', AlignEndVertical],
          ['Between', 'justify-between', AlignHorizontalSpaceBetween],
          ['Around', 'justify-around', AlignHorizontalSpaceAround],
          ['Evenly', 'justify-evenly', AlignHorizontalDistributeCenter],
        ]),
      },
      {
        id: 'align-content',
        label: 'Align content',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'content-start', AlignStartHorizontal],
          ['Center', 'content-center', AlignCenterHorizontal],
          ['End', 'content-end', AlignEndHorizontal],
          ['Between', 'content-between', AlignVerticalSpaceBetween],
          ['Around', 'content-around', AlignVerticalSpaceAround],
          ['Evenly', 'content-evenly', AlignVerticalDistributeCenter],
        ]),
      },
      // Rendered by GapControl (tiered All | X·Y), not the generic row; the
      // control below only keeps the property visible + relevance-gated.
      { id: 'gap', label: 'Gap', needsDisplay: true, relevance: inFlexGrid, control: slide('gap') },
      {
        id: 'flex',
        label: 'Flex',
        relevance: childOfFlex,
        control: ico([
          ['1', 'flex-1', ChevronsLeftRight],
          ['Auto', 'flex-auto', Expand],
          ['Initial', 'flex-initial', Minimize2],
          ['None', 'flex-none', Ban],
        ]),
      },
      {
        id: 'grow',
        label: 'Grow',
        relevance: childOfFlex,
        control: ico([['Grow', 'grow', Maximize2], ['No grow', 'grow-0', Ban]]),
      },
      {
        id: 'shrink',
        label: 'Shrink',
        relevance: childOfFlex,
        control: ico([['Shrink', 'shrink', Shrink], ['No shrink', 'shrink-0', Ban]]),
      },
      { id: 'order', label: 'Order', relevance: childOfFlexGrid, control: inp('order', '1, first, last…'), default: 'order-1' },
      {
        id: 'grid-cols',
        label: 'Grid cols',
        relevance: inGrid,
        control: slideC([
          ['1', 'grid-cols-1'],
          ['2', 'grid-cols-2'],
          ['3', 'grid-cols-3'],
          ['4', 'grid-cols-4'],
          ['5', 'grid-cols-5'],
          ['6', 'grid-cols-6'],
          ['12', 'grid-cols-12'],
        ]),
      },
      {
        id: 'grid-rows',
        label: 'Grid rows',
        relevance: inGrid,
        control: slide('grid-rows', ['1', '2', '3', '4', '5', '6']),
      },
      {
        id: 'col-span',
        label: 'Col span',
        relevance: childOfGrid,
        control: slideC([
          ['1', 'col-span-1'],
          ['2', 'col-span-2'],
          ['3', 'col-span-3'],
          ['4', 'col-span-4'],
          ['5', 'col-span-5'],
          ['6', 'col-span-6'],
          ['Full', 'col-span-full'],
        ]),
      },
      {
        id: 'row-span',
        label: 'Row span',
        relevance: childOfGrid,
        control: slideC([
          ['1', 'row-span-1'],
          ['2', 'row-span-2'],
          ['3', 'row-span-3'],
          ['4', 'row-span-4'],
          ['5', 'row-span-5'],
          ['6', 'row-span-6'],
          ['Full', 'row-span-full'],
        ]),
      },
      {
        id: 'self',
        label: 'Self align',
        relevance: childOfFlexGrid,
        control: ico([
          ['Auto', 'self-auto', Dot],
          ['Start', 'self-start', AlignStartHorizontal],
          ['Center', 'self-center', AlignCenterHorizontal],
          ['End', 'self-end', AlignEndHorizontal],
          ['Stretch', 'self-stretch', StretchVertical],
        ]),
      },
      {
        id: 'justify-self',
        label: 'Justify self',
        relevance: childOfGrid,
        control: ico([
          ['Auto', 'justify-self-auto', Dot],
          ['Start', 'justify-self-start', AlignStartVertical],
          ['Center', 'justify-self-center', AlignCenterVertical],
          ['End', 'justify-self-end', AlignEndVertical],
          ['Stretch', 'justify-self-stretch', StretchHorizontal],
        ]),
      },
    ],
  },
  {
    id: 'position',
    label: 'Position',
    properties: [
      {
        id: 'position',
        label: 'Position',
        control: sel([
          ['Static', 'static'],
          ['Relative', 'relative'],
          ['Absolute', 'absolute'],
          ['Fixed', 'fixed'],
          ['Sticky', 'sticky'],
        ]),
      },
      { id: 'top', label: 'Top', control: slide('top'), relevance: positioned },
      { id: 'right', label: 'Right', control: slide('right'), relevance: positioned },
      { id: 'bottom', label: 'Bottom', control: slide('bottom'), relevance: positioned },
      { id: 'left', label: 'Left', control: slide('left'), relevance: positioned },
      {
        id: 'z-index',
        label: 'Z-index',
        control: slide('z', ['0', '10', '20', '30', '40', '50']),
        relevance: positioned,
      },
    ],
  },
  {
    id: 'size',
    label: 'Size',
    properties: [
      { id: 'width', label: 'Width', control: inp('w', 'full, 64, 1/2…') },
      { id: 'height', label: 'Height', control: inp('h', 'full, 64, screen…') },
      { id: 'min-width', label: 'Min width', control: inp('min-w', '0, full…') },
      { id: 'max-width', label: 'Max width', control: inp('max-w', 'sm, md, xl…') },
      { id: 'min-height', label: 'Min height', control: inp('min-h', '0, screen…') },
      { id: 'max-height', label: 'Max height', control: inp('max-h', 'full, screen…') },
      {
        id: 'overflow',
        label: 'Overflow',
        control: ico([
          ['Visible', 'overflow-visible', Eye],
          ['Hidden', 'overflow-hidden', EyeOff],
          ['Scroll', 'overflow-scroll', Scroll],
          ['Auto', 'overflow-auto', MoveVertical],
        ]),
      },
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    // Rendered by SpacingControl.vue (a tiered All/X·Y/Sides widget), not the
    // generic row loop; these two keep the section visible + relevant.
    properties: [
      { id: 'padding', label: 'Padding', control: slide('p') },
      { id: 'margin', label: 'Margin', control: slide('m') },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    properties: [
      { id: 'text-color', label: 'Color', control: col('text') },
      {
        id: 'font-family',
        label: 'Font',
        control: sel([['Sans', 'font-sans'], ['Serif', 'font-serif'], ['Mono', 'font-mono']]),
      },
      {
        id: 'font-size',
        label: 'Size',
        control: slideC(
          [
            ['XS', 'text-xs'],
            ['SM', 'text-sm'],
            ['Base', 'text-base'],
            ['LG', 'text-lg'],
            ['XL', 'text-xl'],
            ['2XL', 'text-2xl'],
            ['3XL', 'text-3xl'],
            ['4XL', 'text-4xl'],
            ['5XL', 'text-5xl'],
            ['6XL', 'text-6xl'],
            ['7XL', 'text-7xl'],
            ['8XL', 'text-8xl'],
            ['9XL', 'text-9xl'],
          ],
          { prefix: 'text', format: 'length' },
        ),
      },
      {
        id: 'font-weight',
        label: 'Weight',
        control: slideC(
          [
            ['Thin', 'font-thin'],
            ['Extralight', 'font-extralight'],
            ['Light', 'font-light'],
            ['Normal', 'font-normal'],
            ['Medium', 'font-medium'],
            ['Semibold', 'font-semibold'],
            ['Bold', 'font-bold'],
            ['Extrabold', 'font-extrabold'],
            ['Black', 'font-black'],
          ],
          { prefix: 'font', format: 'weight' },
        ),
      },
      {
        id: 'text-align',
        label: 'Align',
        control: ico([
          ['Left', 'text-left', AlignLeft],
          ['Center', 'text-center', AlignCenter],
          ['Right', 'text-right', AlignRight],
          ['Justify', 'text-justify', AlignJustify],
        ]),
      },
      {
        id: 'line-height',
        label: 'Line height',
        control: slideC(
          [
            ['None', 'leading-none'],
            ['Tight', 'leading-tight'],
            ['Snug', 'leading-snug'],
            ['Normal', 'leading-normal'],
            ['Relaxed', 'leading-relaxed'],
            ['Loose', 'leading-loose'],
          ],
          { prefix: 'leading', format: 'line-height' },
        ),
      },
      {
        id: 'letter-spacing',
        label: 'Letter spacing',
        control: slideC(
          [
            ['Tighter', 'tracking-tighter'],
            ['Tight', 'tracking-tight'],
            ['Normal', 'tracking-normal'],
            ['Wide', 'tracking-wide'],
            ['Wider', 'tracking-wider'],
            ['Widest', 'tracking-widest'],
          ],
          { prefix: 'tracking', format: 'tracking' },
        ),
      },
      {
        id: 'text-transform',
        label: 'Transform',
        control: ico([
          ['Uppercase', 'uppercase', CaseUpper],
          ['Lowercase', 'lowercase', CaseLower],
          ['Capitalize', 'capitalize', CaseSensitive],
          ['Normal', 'normal-case', Ban],
        ]),
      },
      {
        id: 'text-decoration',
        label: 'Decoration',
        control: ico([
          ['Underline', 'underline', Underline],
          ['Overline', 'overline', Minus],
          ['Line through', 'line-through', Strikethrough],
          ['None', 'no-underline', Ban],
        ]),
      },
      {
        id: 'word-break',
        label: 'Word break',
        control: ico([
          ['Normal', 'break-normal', AlignJustify],
          ['Words', 'break-words', WrapText],
          ['All', 'break-all', ChevronsLeftRight],
          ['Keep', 'break-keep', Ban],
        ]),
      },
      {
        id: 'list-style',
        label: 'List',
        control: ico([
          ['None', 'list-none', Ban],
          ['Disc', 'list-disc', List],
          ['Decimal', 'list-decimal', ListOrdered],
        ]),
      },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    // The media-picker row (node.background) is injected by StyleEditor before
    // these; object-fit/position steer a video layer, bg-size/repeat a bg image.
    properties: [
      { id: 'bg-color', label: 'Color', control: col('bg') },
      {
        id: 'object-fit',
        label: 'Object fit',
        relevance: whenMediaOrBg,
        control: sel([
          ['Contain', 'object-contain'],
          ['Cover', 'object-cover'],
          ['Fill', 'object-fill'],
          ['None', 'object-none'],
          ['Scale down', 'object-scale-down'],
        ]),
      },
      {
        id: 'object-position',
        label: 'Object position',
        relevance: whenMediaOrBg,
        control: sel([
          ['Center', 'object-center'],
          ['Top', 'object-top'],
          ['Bottom', 'object-bottom'],
          ['Left', 'object-left'],
          ['Right', 'object-right'],
        ]),
      },
      {
        id: 'bg-size',
        label: 'BG size',
        relevance: whenMediaOrBg,
        control: sel([['Auto', 'bg-auto'], ['Cover', 'bg-cover'], ['Contain', 'bg-contain']]),
      },
      {
        id: 'bg-repeat',
        label: 'BG repeat',
        relevance: whenMediaOrBg,
        control: sel([
          ['Repeat', 'bg-repeat'],
          ['No repeat', 'bg-no-repeat'],
          ['Repeat X', 'bg-repeat-x'],
          ['Repeat Y', 'bg-repeat-y'],
        ]),
      },
    ],
  },
  {
    id: 'border',
    label: 'Border',
    // Border width is rendered by the cross SpacingBoxControl (like padding/margin),
    // not the generic rows; Color, Radius and Style follow as ordinary controls.
    properties: [
      { id: 'border-color', label: 'Color', control: col('border') },
      {
        id: 'radius',
        label: 'Radius',
        control: slideC(
          [
            ['None', 'rounded-none'],
            ['XS', 'rounded-xs'],
            ['SM', 'rounded-sm'],
            ['MD', 'rounded-md'],
            ['LG', 'rounded-lg'],
            ['XL', 'rounded-xl'],
            ['2XL', 'rounded-2xl'],
            ['3XL', 'rounded-3xl'],
            ['Full', 'rounded-full'],
          ],
          { prefix: 'rounded', format: 'length' },
        ),
      },
      {
        id: 'border-style',
        label: 'Style',
        control: sel([
          ['Solid', 'border-solid'],
          ['Dashed', 'border-dashed'],
          ['Dotted', 'border-dotted'],
          ['Double', 'border-double'],
          ['None', 'border-none'],
        ]),
      },
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    properties: [
      { id: 'opacity', label: 'Opacity', control: slide('opacity', OPACITY), default: 'opacity-100' },
      {
        id: 'shadow',
        label: 'Shadow',
        control: slideC([
          ['None', 'shadow-none'],
          ['XS', 'shadow-xs'],
          ['SM', 'shadow-sm'],
          ['MD', 'shadow-md'],
          ['LG', 'shadow-lg'],
          ['XL', 'shadow-xl'],
          ['2XL', 'shadow-2xl'],
        ]),
      },
      {
        id: 'blur',
        label: 'Blur',
        control: slideC([
          ['None', 'blur-none'],
          ['XS', 'blur-xs'],
          ['SM', 'blur-sm'],
          ['MD', 'blur-md'],
          ['LG', 'blur-lg'],
          ['XL', 'blur-xl'],
          ['2XL', 'blur-2xl'],
          ['3XL', 'blur-3xl'],
        ]),
      },
    ],
  },
  {
    id: 'transitions',
    label: 'Transitions',
    properties: [
      {
        id: 'transition',
        label: 'Transition',
        control: sel([
          ['None', 'transition-none'],
          ['All', 'transition-all'],
          ['Default', 'transition'],
          ['Colors', 'transition-colors'],
          ['Opacity', 'transition-opacity'],
          ['Transform', 'transition-transform'],
          ['Shadow', 'transition-shadow'],
        ]),
      },
      {
        id: 'duration',
        label: 'Duration',
        relevance: whenTransition,
        control: slide('duration', ['75', '100', '150', '200', '300', '500', '700', '1000']),
      },
      {
        id: 'timing',
        label: 'Easing',
        relevance: whenTransition,
        control: ico([
          ['Linear', 'ease-linear', Minus],
          ['In', 'ease-in', Turtle],
          ['Out', 'ease-out', Rabbit],
          ['In out', 'ease-in-out', Spline],
        ]),
      },
      {
        id: 'delay',
        label: 'Delay',
        relevance: whenTransition,
        control: slide('delay', ['75', '150', '300', '500', '700', '1000']),
      },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    properties: [
      {
        id: 'scale',
        label: 'Scale',
        control: slide('scale', ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150']),
      },
      { id: 'rotate', label: 'Rotate', control: signed('rotate', ['1', '2', '3', '6', '12', '45', '90', '180']) },
      { id: 'translate-x', label: 'Translate X', control: signed('translate-x', ['1', '2', '3', '4', '6', '8']) },
      { id: 'translate-y', label: 'Translate Y', control: signed('translate-y', ['1', '2', '3', '4', '6', '8']) },
    ],
  },
  {
    id: 'interactivity',
    label: 'Interactivity',
    properties: [
      {
        id: 'cursor',
        label: 'Cursor',
        control: sel([
          ['Auto', 'cursor-auto'],
          ['Default', 'cursor-default'],
          ['Pointer', 'cursor-pointer'],
          ['Wait', 'cursor-wait'],
          ['Text', 'cursor-text'],
          ['Move', 'cursor-move'],
          ['Not allowed', 'cursor-not-allowed'],
        ]),
      },
      {
        id: 'user-select',
        label: 'User select',
        control: sel([
          ['None', 'select-none'],
          ['Text', 'select-text'],
          ['All', 'select-all'],
          ['Auto', 'select-auto'],
        ]),
      },
      {
        id: 'pointer-events',
        label: 'Pointer events',
        control: ico([
          ['None', 'pointer-events-none', Ban],
          ['Auto', 'pointer-events-auto', MousePointer2],
        ]),
      },
    ],
  },
]

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
  for (const prefix of spacing) for (const stop of SPACING) out.add(`${prefix}-${stop}`)
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
    'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-6', 'grid-cols-12', 'col-span-2', 'col-span-3',
    'object-cover', 'object-contain', 'aspect-square', 'aspect-video',
  ]
  common.forEach((c) => out.add(c))
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
  const starts = pool.filter((c) => c.startsWith(base))
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

/**
 * A class is valid if every variant segment is known and the base is either
 * an arbitrary-value class (`p-[13px]`), in our vocabulary, or a design token.
 */
export function isValidClass(cls: string): boolean {
  const segments = cls.split(':')
  const base = segments.pop() ?? ''
  if (!base) return false
  if (segments.some((v) => !VARIANT_SET.has(v))) return false
  if (/-\[.+\]$/.test(base)) return true // arbitrary value
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

/** an existing token on the same property + variant that `cls` would collide with */
function conflictingToken(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const prop = propForBase(base)
  if (!prop) return undefined
  return tokens.find((t) => {
    const s = splitVariant(t)
    return s.variant === variant && s.base !== base && propForBase(s.base) === prop
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
  if (r.values.some((v) => tokens.includes(`${variant}${v}`))) return undefined
  const preferred = r.values.includes('flex') ? 'flex' : r.values[0]!
  return `${variant}${preferred}`
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

/** The class a property starts with when the user adds it */
export function defaultClass(prop: StyleProperty): string {
  if (prop.default) return prop.default
  const control = prop.control
  switch (control.kind) {
    case 'select':
    case 'icons':
      return control.options[0]!.class
    case 'color':
      return `${control.prefix}-slate-500`
    case 'slider': {
      const classesList = sliderClasses(control)
      // explicit-class sliders (bare/named/signed) neutralise on their '0'
      // stop when present; prefix+stops sliders keep the original mid default
      if (control.classes) {
        const zero = sliderLabels(control).indexOf('0')
        return classesList[zero !== -1 ? zero : Math.min(4, classesList.length - 1)]!
      }
      return `${control.prefix}-${control.stops![4] ?? control.stops![0]}`
    }
    case 'input':
      return `${control.prefix}-auto`
  }
}
