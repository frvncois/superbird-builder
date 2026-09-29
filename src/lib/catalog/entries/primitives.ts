import type { CatalogEntry } from '../types'

/**
 * Buttons, badges, form controls and the small display pieces.
 *
 * Every class here must pass `isValidClass` — a class written straight into
 * `node.classes` renders and exports fine but can't be re-typed in the Style
 * panel once removed, which is a trap to hand a user. Known rejects to avoid:
 * `/NN` opacity forms, `ring-offset-*`, `peer`, `top-full`, `place-items-*`,
 * `resize-none`, `min-h-svh`.
 *
 * Hover and focus are plain `hover:` / `focus-visible:` variants. Interactions
 * are for open/close semantics only — see ./interactive.
 */

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring'
const BUTTON_BASE =
  `inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors outline-none ${FOCUS}`
const FIELD_BASE =
  `w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none ${FOCUS}`
// a <select> has no placeholder, so it does not carry this (and does not need
// the muted-foreground token)
const PLACEHOLDER = 'placeholder:text-muted-foreground'
const BADGE_BASE = 'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium'

const button = (
  key: string,
  name: string,
  description: string,
  classes: string,
  tokens: string[],
  content = 'Button',
): CatalogEntry => ({
  key,
  name,
  category: 'Buttons',
  description,
  tokens: ['ring', ...tokens],
  root: { type: 'button', content, classes: `${BUTTON_BASE} ${classes}` },
})

const badge = (
  key: string,
  name: string,
  description: string,
  classes: string,
  tokens: string[],
): CatalogEntry => ({
  key,
  name,
  category: 'Badges',
  description,
  tokens,
  root: { type: 'span', content: 'Badge', classes: `${BADGE_BASE} ${classes}` },
})

export const PRIMITIVES: CatalogEntry[] = [
  button(
    'button',
    'Button',
    'The primary action.',
    'bg-primary text-primary-foreground hover:opacity-90',
    ['primary', 'primary-foreground'],
  ),
  button(
    'button-secondary',
    'ButtonSecondary',
    'A quieter action beside a primary one.',
    'bg-secondary text-secondary-foreground hover:opacity-90',
    ['secondary', 'secondary-foreground'],
  ),
  button(
    'button-outline',
    'ButtonOutline',
    'Bordered, for secondary actions on a plain background.',
    'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
    ['input', 'background', 'foreground', 'accent', 'accent-foreground'],
  ),
  button(
    'button-ghost',
    'ButtonGhost',
    'No chrome until hovered — for toolbars and menus.',
    'text-foreground hover:bg-accent hover:text-accent-foreground',
    ['foreground', 'accent', 'accent-foreground'],
  ),
  button(
    'button-destructive',
    'ButtonDestructive',
    'Delete and other irreversible actions.',
    'bg-destructive text-destructive-foreground hover:opacity-90',
    ['destructive', 'destructive-foreground'],
    'Delete',
  ),
  {
    key: 'button-link',
    name: 'ButtonLink',
    category: 'Buttons',
    description: 'An action that reads as a link.',
    tokens: ['primary', 'ring'],
    root: {
      type: 'link',
      content: 'Learn more',
      link: '/',
      classes: `inline-flex h-9 items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline ${FOCUS}`,
    },
  },

  badge('badge', 'Badge', 'A status or count.', 'bg-primary text-primary-foreground', [
    'primary',
    'primary-foreground',
  ]),
  badge(
    'badge-secondary',
    'BadgeSecondary',
    'A quieter label.',
    'bg-secondary text-secondary-foreground',
    ['secondary', 'secondary-foreground'],
  ),
  badge(
    'badge-outline',
    'BadgeOutline',
    'Bordered, no fill.',
    'border border-border text-foreground',
    ['border', 'foreground'],
  ),
  badge(
    'badge-destructive',
    'BadgeDestructive',
    'An error or warning label.',
    'bg-destructive text-destructive-foreground',
    ['destructive', 'destructive-foreground'],
  ),

  {
    key: 'input',
    name: 'Input',
    category: 'Forms',
    description: 'A single-line text field.',
    tokens: ['input', 'background', 'foreground', 'muted-foreground', 'ring'],
    root: {
      type: 'input',
      classes: `h-9 ${FIELD_BASE} ${PLACEHOLDER}`,
      attributes: { type: 'text', placeholder: 'Enter your email', name: 'email' },
    },
  },
  {
    key: 'textarea',
    name: 'Textarea',
    category: 'Forms',
    description: 'A multi-line text field.',
    tokens: ['input', 'background', 'foreground', 'muted-foreground', 'ring'],
    root: {
      type: 'textarea',
      classes: `py-2 ${FIELD_BASE} ${PLACEHOLDER}`,
      attributes: { placeholder: 'Your message', name: 'message', rows: '4' },
    },
  },
  {
    key: 'select',
    name: 'Select',
    category: 'Forms',
    description: 'A dropdown of fixed choices.',
    tokens: ['input', 'background', 'foreground', 'ring'],
    root: {
      type: 'select',
      classes: `h-9 ${FIELD_BASE}`,
      attributes: { name: 'choice' },
      children: [
        { type: 'option', content: 'First option' },
        { type: 'option', content: 'Second option' },
        { type: 'option', content: 'Third option' },
      ],
    },
  },
  {
    key: 'checkbox',
    name: 'Checkbox',
    category: 'Forms',
    description: 'A checkbox with its label.',
    tokens: ['input', 'foreground', 'ring'],
    root: {
      type: 'div',
      classes: 'flex items-center gap-2',
      children: [
        {
          type: 'checkbox',
          classes: `size-4 shrink-0 rounded-md border border-input outline-none ${FOCUS}`,
          attributes: { name: 'accept' },
        },
        {
          type: 'label',
          content: 'Accept the terms',
          classes: 'text-sm font-medium text-foreground',
        },
      ],
    },
  },
  {
    key: 'label',
    name: 'Label',
    category: 'Forms',
    description: 'A form field label.',
    tokens: ['foreground'],
    root: { type: 'label', content: 'Label', classes: 'text-sm font-medium text-foreground' },
  },
  {
    key: 'field',
    name: 'Field',
    category: 'Forms',
    // no `for`/`id` pairing: htmlId does not replicate across instances, so
    // every instance would claim the same id
    description: 'A label stacked over an input.',
    tokens: ['input', 'background', 'foreground', 'muted-foreground', 'ring'],
    root: {
      type: 'div',
      classes: 'flex w-full flex-col gap-1.5',
      children: [
        { type: 'label', content: 'Email', classes: 'text-sm font-medium text-foreground' },
        {
          type: 'input',
          classes: `h-9 ${FIELD_BASE} ${PLACEHOLDER}`,
          attributes: { type: 'email', placeholder: 'you@example.com', name: 'email' },
        },
      ],
    },
  },

  {
    key: 'avatar',
    name: 'Avatar',
    category: 'Display',
    description: 'A round profile image.',
    tokens: ['muted'],
    root: {
      type: 'div',
      classes: 'size-10 shrink-0 overflow-hidden rounded-full bg-muted',
      children: [{ type: 'image', classes: 'h-full w-full object-cover' }],
    },
  },
  {
    key: 'separator',
    name: 'Separator',
    category: 'Display',
    description: 'A hairline rule between sections.',
    tokens: ['border'],
    root: { type: 'div', classes: 'h-px w-full bg-border' },
  },
]
