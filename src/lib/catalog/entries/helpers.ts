import type { CatalogNode, CatalogPart } from '../types'

/**
 * What the entries share.
 *
 * Every class in an entry must pass `isValidClass` — a class written straight
 * into `node.classes` renders and exports fine but can't be re-typed in the
 * Style panel once removed, which is a trap to hand a user. `npm run
 * check:catalog` holds every entry to that. Known rejects to avoid: `/NN`
 * opacity forms, `top-full`, `place-items-*`, `min-h-svh`.
 *
 * Hover and focus are plain `hover:` / `focus-visible:` variants; checked and
 * open states that CSS can see (`has-[:checked]:`, `group-hover:`) are plain
 * variants too. Interactions are for what only a click can decide.
 */

export const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring'

export const CARD = 'rounded-xl border border-border bg-card text-card-foreground shadow-sm'
export const CARD_TOKENS = ['border', 'card', 'card-foreground']

export const FIELD =
  `w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none ${FOCUS}`
export const FIELD_TOKENS = ['input', 'background', 'foreground', 'ring']
// a <select> has no placeholder, so it does not carry this
export const PLACEHOLDER = 'placeholder:text-muted-foreground'

/** a floating surface: a menu, a popover, a hover card */
export const SURFACE = 'rounded-lg border border-border bg-card text-card-foreground shadow-md'

/** text, as the one child of a `button` / `link` / `label` — they are
 *  containers, and their words live in a span */
export const words = (content: string, key?: string): CatalogNode => ({
  type: 'span',
  content,
  ...(key ? { key } : {}),
})

export const icon = (name: string, classes = 'size-4 shrink-0', extra: Partial<CatalogNode> = {}): CatalogNode => ({
  type: 'icon',
  icon: name,
  classes,
  ...extra,
})

export const link = (content: string, href: string, classes: string): CatalogNode => ({
  type: 'link',
  link: href,
  classes,
  children: [words(content)],
})

/**
 * An instance of the Button entry. What is inside belongs to Button — restyle
 * it there and every host follows — so a host only says which look it wears,
 * what it reads, and which of its two icons show.
 */
export const button = (
  label: string,
  opts: {
    variant?: 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
    size?: 'sm' | 'lg' | 'icon'
    /** an icon before the label */
    start?: string
    /** an icon after the label */
    end?: string
    /** hide the label (an icon-only button) */
    iconOnly?: boolean
  } = {},
): CatalogNode => {
  const variants: Record<string, string> = {}
  if (opts.variant) variants.variant = opts.variant
  if (opts.size) variants.size = opts.size
  const parts: Record<string, CatalogPart> = { label: { content: label } }
  if (opts.iconOnly) parts.label = { content: label, hidden: true }
  if (opts.start) parts['icon-start'] = { icon: opts.start, hidden: false }
  if (opts.end) parts['icon-end'] = { icon: opts.end, hidden: false }
  return {
    type: 'Button',
    component: 'button',
    ...(Object.keys(variants).length ? { variants } : {}),
    parts,
  }
}

/**
 * A host cannot bind an interaction ON a nested instance — its bindings are
 * the component's own. So the trigger is a wrapper the host owns: it adds no
 * box (`contents`), and the click on the button inside bubbles up to it.
 */
export const trigger = (
  child: CatalogNode,
  interactions: NonNullable<CatalogNode['interactions']>,
  classes = 'contents',
): CatalogNode => ({ type: 'div', classes, interactions, children: [child] })
