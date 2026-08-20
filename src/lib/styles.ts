import { TAILWIND_COLORS, TAILWIND_SHADES, isPaletteColor } from './colors'

export type Control =
  | { kind: 'select'; options: { label: string; class: string }[] }
  | { kind: 'color'; prefix: string }
  | { kind: 'slider'; prefix: string; stops: string[] }
  | { kind: 'input'; prefix: string; placeholder?: string }

export interface StyleProperty {
  id: string
  label: string
  control: Control
  /** only meaningful on flex/grid parents — adding it auto-adds a display class */
  needsDisplay?: boolean
  /** overrides the class applied when the property is first added */
  default?: string
}

export interface StyleSection {
  id: string
  label: string
  properties: StyleProperty[]
}

const SPACING = ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']
const OPACITY = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']

// terse control builders so the catalog below stays readable
const sel = (pairs: [string, string][]): Control => ({
  kind: 'select',
  options: pairs.map(([label, cls]) => ({ label, class: cls })),
})
const slide = (prefix: string, stops: string[] = SPACING): Control => ({ kind: 'slider', prefix, stops })
const col = (prefix: string): Control => ({ kind: 'color', prefix })
const inp = (prefix: string, placeholder?: string): Control => ({ kind: 'input', prefix, placeholder })

export const STYLE_SECTIONS: StyleSection[] = [
  {
    id: 'layout',
    label: 'Layout',
    properties: [
      {
        id: 'display',
        label: 'Display',
        control: sel([
          ['Block', 'block'],
          ['Inline block', 'inline-block'],
          ['Inline', 'inline'],
          ['Flex', 'flex'],
          ['Inline flex', 'inline-flex'],
          ['Grid', 'grid'],
          ['Inline grid', 'inline-grid'],
          ['Hidden', 'hidden'],
        ]),
      },
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
      { id: 'top', label: 'Top', control: slide('top') },
      { id: 'right', label: 'Right', control: slide('right') },
      { id: 'bottom', label: 'Bottom', control: slide('bottom') },
      { id: 'left', label: 'Left', control: slide('left') },
      {
        id: 'z-index',
        label: 'Z-index',
        control: sel([
          ['0', 'z-0'],
          ['10', 'z-10'],
          ['20', 'z-20'],
          ['30', 'z-30'],
          ['40', 'z-40'],
          ['50', 'z-50'],
          ['Auto', 'z-auto'],
        ]),
      },
      {
        id: 'overflow',
        label: 'Overflow',
        control: sel([
          ['Visible', 'overflow-visible'],
          ['Hidden', 'overflow-hidden'],
          ['Scroll', 'overflow-scroll'],
          ['Auto', 'overflow-auto'],
        ]),
      },
      {
        id: 'overflow-x',
        label: 'Overflow X',
        control: sel([
          ['Visible', 'overflow-x-visible'],
          ['Hidden', 'overflow-x-hidden'],
          ['Scroll', 'overflow-x-scroll'],
          ['Auto', 'overflow-x-auto'],
        ]),
      },
      {
        id: 'overflow-y',
        label: 'Overflow Y',
        control: sel([
          ['Visible', 'overflow-y-visible'],
          ['Hidden', 'overflow-y-hidden'],
          ['Scroll', 'overflow-y-scroll'],
          ['Auto', 'overflow-y-auto'],
        ]),
      },
    ],
  },
  {
    id: 'flex',
    label: 'Flex & Grid',
    properties: [
      {
        id: 'direction',
        label: 'Direction',
        needsDisplay: true,
        control: sel([
          ['Row', 'flex-row'],
          ['Column', 'flex-col'],
          ['Row reverse', 'flex-row-reverse'],
          ['Col reverse', 'flex-col-reverse'],
        ]),
      },
      {
        id: 'wrap',
        label: 'Wrap',
        needsDisplay: true,
        control: sel([
          ['Wrap', 'flex-wrap'],
          ['No wrap', 'flex-nowrap'],
          ['Wrap reverse', 'flex-wrap-reverse'],
        ]),
      },
      {
        id: 'align',
        label: 'Align items',
        needsDisplay: true,
        control: sel([
          ['Start', 'items-start'],
          ['Center', 'items-center'],
          ['End', 'items-end'],
          ['Stretch', 'items-stretch'],
          ['Baseline', 'items-baseline'],
        ]),
      },
      {
        id: 'justify',
        label: 'Justify',
        needsDisplay: true,
        control: sel([
          ['Start', 'justify-start'],
          ['Center', 'justify-center'],
          ['End', 'justify-end'],
          ['Between', 'justify-between'],
          ['Around', 'justify-around'],
          ['Evenly', 'justify-evenly'],
        ]),
      },
      {
        id: 'align-content',
        label: 'Align content',
        needsDisplay: true,
        control: sel([
          ['Start', 'content-start'],
          ['Center', 'content-center'],
          ['End', 'content-end'],
          ['Between', 'content-between'],
          ['Around', 'content-around'],
          ['Evenly', 'content-evenly'],
        ]),
      },
      { id: 'gap', label: 'Gap', needsDisplay: true, control: slide('gap') },
      { id: 'gap-x', label: 'Gap X', needsDisplay: true, control: slide('gap-x') },
      { id: 'gap-y', label: 'Gap Y', needsDisplay: true, control: slide('gap-y') },
      {
        id: 'flex',
        label: 'Flex',
        control: sel([
          ['1', 'flex-1'],
          ['Auto', 'flex-auto'],
          ['Initial', 'flex-initial'],
          ['None', 'flex-none'],
        ]),
      },
      { id: 'grow', label: 'Grow', control: sel([['Grow', 'grow'], ['No grow', 'grow-0']]) },
      { id: 'shrink', label: 'Shrink', control: sel([['Shrink', 'shrink'], ['No shrink', 'shrink-0']]) },
      { id: 'order', label: 'Order', control: inp('order', '1, first, last…'), default: 'order-1' },
      {
        id: 'grid-cols',
        label: 'Grid cols',
        control: sel([
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
        control: sel([
          ['1', 'grid-rows-1'],
          ['2', 'grid-rows-2'],
          ['3', 'grid-rows-3'],
          ['4', 'grid-rows-4'],
          ['5', 'grid-rows-5'],
          ['6', 'grid-rows-6'],
        ]),
      },
      {
        id: 'col-span',
        label: 'Col span',
        control: sel([
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
        control: sel([
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
        control: sel([
          ['Auto', 'self-auto'],
          ['Start', 'self-start'],
          ['Center', 'self-center'],
          ['End', 'self-end'],
          ['Stretch', 'self-stretch'],
        ]),
      },
      {
        id: 'justify-self',
        label: 'Justify self',
        control: sel([
          ['Auto', 'justify-self-auto'],
          ['Start', 'justify-self-start'],
          ['Center', 'justify-self-center'],
          ['End', 'justify-self-end'],
          ['Stretch', 'justify-self-stretch'],
        ]),
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
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    properties: [
      { id: 'padding', label: 'Padding', control: slide('p') },
      { id: 'padding-x', label: 'Padding X', control: slide('px') },
      { id: 'padding-y', label: 'Padding Y', control: slide('py') },
      { id: 'padding-top', label: 'Padding top', control: slide('pt') },
      { id: 'padding-right', label: 'Padding right', control: slide('pr') },
      { id: 'padding-bottom', label: 'Padding bottom', control: slide('pb') },
      { id: 'padding-left', label: 'Padding left', control: slide('pl') },
      { id: 'margin', label: 'Margin', control: slide('m') },
      { id: 'margin-x', label: 'Margin X', control: slide('mx') },
      { id: 'margin-y', label: 'Margin Y', control: slide('my') },
      { id: 'margin-top', label: 'Margin top', control: slide('mt') },
      { id: 'margin-right', label: 'Margin right', control: slide('mr') },
      { id: 'margin-bottom', label: 'Margin bottom', control: slide('mb') },
      { id: 'margin-left', label: 'Margin left', control: slide('ml') },
      { id: 'space-x', label: 'Space X', control: slide('space-x') },
      { id: 'space-y', label: 'Space Y', control: slide('space-y') },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    properties: [
      {
        id: 'font-family',
        label: 'Font',
        control: sel([['Sans', 'font-sans'], ['Serif', 'font-serif'], ['Mono', 'font-mono']]),
      },
      {
        id: 'font-size',
        label: 'Size',
        control: sel([
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
        ]),
      },
      {
        id: 'font-weight',
        label: 'Weight',
        control: sel([
          ['Thin', 'font-thin'],
          ['Extralight', 'font-extralight'],
          ['Light', 'font-light'],
          ['Normal', 'font-normal'],
          ['Medium', 'font-medium'],
          ['Semibold', 'font-semibold'],
          ['Bold', 'font-bold'],
          ['Extrabold', 'font-extrabold'],
          ['Black', 'font-black'],
        ]),
      },
      { id: 'font-style', label: 'Italic', control: sel([['Italic', 'italic'], ['Not italic', 'not-italic']]) },
      {
        id: 'text-align',
        label: 'Align',
        control: sel([
          ['Left', 'text-left'],
          ['Center', 'text-center'],
          ['Right', 'text-right'],
          ['Justify', 'text-justify'],
        ]),
      },
      {
        id: 'line-height',
        label: 'Line height',
        control: sel([
          ['None', 'leading-none'],
          ['Tight', 'leading-tight'],
          ['Snug', 'leading-snug'],
          ['Normal', 'leading-normal'],
          ['Relaxed', 'leading-relaxed'],
          ['Loose', 'leading-loose'],
        ]),
      },
      {
        id: 'letter-spacing',
        label: 'Letter spacing',
        control: sel([
          ['Tighter', 'tracking-tighter'],
          ['Tight', 'tracking-tight'],
          ['Normal', 'tracking-normal'],
          ['Wide', 'tracking-wide'],
          ['Wider', 'tracking-wider'],
          ['Widest', 'tracking-widest'],
        ]),
      },
      {
        id: 'text-transform',
        label: 'Transform',
        control: sel([
          ['Uppercase', 'uppercase'],
          ['Lowercase', 'lowercase'],
          ['Capitalize', 'capitalize'],
          ['Normal', 'normal-case'],
        ]),
      },
      {
        id: 'text-decoration',
        label: 'Decoration',
        control: sel([
          ['Underline', 'underline'],
          ['Overline', 'overline'],
          ['Line through', 'line-through'],
          ['None', 'no-underline'],
        ]),
      },
      {
        id: 'whitespace',
        label: 'Whitespace',
        control: sel([
          ['Normal', 'whitespace-normal'],
          ['Nowrap', 'whitespace-nowrap'],
          ['Pre', 'whitespace-pre'],
          ['Pre line', 'whitespace-pre-line'],
          ['Pre wrap', 'whitespace-pre-wrap'],
        ]),
      },
      {
        id: 'text-overflow',
        label: 'Overflow',
        control: sel([['Truncate', 'truncate'], ['Ellipsis', 'text-ellipsis'], ['Clip', 'text-clip']]),
      },
      {
        id: 'word-break',
        label: 'Word break',
        control: sel([
          ['Normal', 'break-normal'],
          ['Words', 'break-words'],
          ['All', 'break-all'],
          ['Keep', 'break-keep'],
        ]),
      },
      {
        id: 'list-style',
        label: 'List',
        control: sel([['None', 'list-none'], ['Disc', 'list-disc'], ['Decimal', 'list-decimal']]),
      },
    ],
  },
  {
    id: 'color',
    label: 'Color',
    properties: [
      { id: 'background', label: 'Background', control: col('bg') },
      { id: 'text-color', label: 'Text', control: col('text') },
      { id: 'border-color', label: 'Border', control: col('border') },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    properties: [
      {
        id: 'object-fit',
        label: 'Object fit',
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
        control: sel([['Auto', 'bg-auto'], ['Cover', 'bg-cover'], ['Contain', 'bg-contain']]),
      },
      {
        id: 'bg-repeat',
        label: 'BG repeat',
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
    properties: [
      {
        id: 'border-width',
        label: 'Width',
        control: sel([
          ['0', 'border-0'],
          ['1px', 'border'],
          ['2px', 'border-2'],
          ['4px', 'border-4'],
          ['8px', 'border-8'],
        ]),
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
      {
        id: 'border-top',
        label: 'Top width',
        control: sel([['0', 'border-t-0'], ['1px', 'border-t'], ['2px', 'border-t-2'], ['4px', 'border-t-4']]),
      },
      {
        id: 'border-right',
        label: 'Right width',
        control: sel([['0', 'border-r-0'], ['1px', 'border-r'], ['2px', 'border-r-2'], ['4px', 'border-r-4']]),
      },
      {
        id: 'border-bottom',
        label: 'Bottom width',
        control: sel([['0', 'border-b-0'], ['1px', 'border-b'], ['2px', 'border-b-2'], ['4px', 'border-b-4']]),
      },
      {
        id: 'border-left',
        label: 'Left width',
        control: sel([['0', 'border-l-0'], ['1px', 'border-l'], ['2px', 'border-l-2'], ['4px', 'border-l-4']]),
      },
      {
        id: 'radius',
        label: 'Radius',
        control: sel([
          ['None', 'rounded-none'],
          ['XS', 'rounded-xs'],
          ['SM', 'rounded-sm'],
          ['MD', 'rounded-md'],
          ['LG', 'rounded-lg'],
          ['XL', 'rounded-xl'],
          ['2XL', 'rounded-2xl'],
          ['3XL', 'rounded-3xl'],
          ['Full', 'rounded-full'],
        ]),
      },
      {
        id: 'ring',
        label: 'Ring',
        control: sel([['0', 'ring-0'], ['1px', 'ring-1'], ['2px', 'ring-2'], ['4px', 'ring-4']]),
      },
      { id: 'ring-color', label: 'Ring color', control: col('ring') },
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
        control: sel([
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
        control: sel([
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
        control: sel([
          ['75', 'duration-75'],
          ['100', 'duration-100'],
          ['150', 'duration-150'],
          ['200', 'duration-200'],
          ['300', 'duration-300'],
          ['500', 'duration-500'],
          ['700', 'duration-700'],
          ['1000', 'duration-1000'],
        ]),
      },
      {
        id: 'timing',
        label: 'Easing',
        control: sel([
          ['Linear', 'ease-linear'],
          ['In', 'ease-in'],
          ['Out', 'ease-out'],
          ['In out', 'ease-in-out'],
        ]),
      },
      {
        id: 'delay',
        label: 'Delay',
        control: sel([
          ['75', 'delay-75'],
          ['150', 'delay-150'],
          ['300', 'delay-300'],
          ['500', 'delay-500'],
          ['700', 'delay-700'],
          ['1000', 'delay-1000'],
        ]),
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
        control: sel([
          ['0', 'scale-0'],
          ['50', 'scale-50'],
          ['75', 'scale-75'],
          ['90', 'scale-90'],
          ['95', 'scale-95'],
          ['100', 'scale-100'],
          ['105', 'scale-105'],
          ['110', 'scale-110'],
          ['125', 'scale-125'],
          ['150', 'scale-150'],
        ]),
      },
      { id: 'rotate', label: 'Rotate', control: inp('rotate', '45, 90, -12…'), default: 'rotate-0' },
      { id: 'translate-x', label: 'Translate X', control: inp('translate-x', '4, 1/2, full…'), default: 'translate-x-0' },
      { id: 'translate-y', label: 'Translate Y', control: inp('translate-y', '4, 1/2, full…'), default: 'translate-y-0' },
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
        control: sel([['None', 'pointer-events-none'], ['Auto', 'pointer-events-auto']]),
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
      if (control.kind === 'slider') control.stops.forEach((s) => out.add(`${control.prefix}-${s}`))
    }
  }
  const spacing = ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'gap-x', 'gap-y', 'space-x', 'space-y']
  for (const prefix of spacing) for (const stop of SPACING) out.add(`${prefix}-${stop}`)
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
    case 'slider':
      return classes.find(
        (cls) =>
          cls.startsWith(`${control.prefix}-`) &&
          control.stops.includes(cls.slice(control.prefix.length + 1)),
      )
    case 'input':
      return classes.find((cls) => cls.startsWith(`${control.prefix}-`))
  }
}

/** The class a property starts with when the user adds it */
export function defaultClass(prop: StyleProperty): string {
  if (prop.default) return prop.default
  const control = prop.control
  switch (control.kind) {
    case 'select':
      return control.options[0]!.class
    case 'color':
      return `${control.prefix}-slate-500`
    case 'slider':
      return `${control.prefix}-${control.stops[4] ?? control.stops[0]}`
    case 'input':
      return `${control.prefix}-auto`
  }
}
