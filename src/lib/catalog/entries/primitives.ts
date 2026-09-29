import type { CatalogEntry } from '../types'
import { FOCUS, button, icon, words } from './helpers'

/**
 * Buttons, badges and the small display pieces.
 *
 * One component per THING, not per look: a Button is a Button, and default /
 * outline / ghost are options it wears. See ./helpers for the class rules.
 */
export const PRIMITIVES: CatalogEntry[] = [
  {
    key: 'button',
    name: 'Button',
    category: 'Buttons',
    description: 'An action, in six looks and four sizes, with an optional icon on either side.',
    tokens: [
      'ring', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
      'destructive', 'destructive-foreground', 'input', 'background', 'foreground',
      'accent', 'accent-foreground',
    ],
    variants: [
      {
        name: 'variant',
        options: ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'],
        default: 'default',
      },
      { name: 'size', options: ['md', 'sm', 'lg', 'icon'], default: 'md' },
    ],
    root: {
      type: 'button',
      key: 'button',
      classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium whitespace-nowrap text-primary-foreground transition-colors outline-none hover:opacity-90 disabled:opacity-50 ${FOCUS}`,
      // only what differs from the base — a class here REPLACES the base class
      // on the same property for an instance wearing the option
      variantClasses: {
        'variant:secondary': 'bg-secondary text-secondary-foreground',
        'variant:outline':
          'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground hover:opacity-100',
        'variant:ghost':
          'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground hover:opacity-100',
        'variant:destructive': 'bg-destructive text-destructive-foreground',
        'variant:link':
          'h-auto bg-transparent px-0 text-primary underline-offset-4 hover:underline hover:opacity-100',
        'size:sm': 'h-8 gap-1.5 rounded-md px-3 text-xs',
        'size:lg': 'h-10 px-6 text-base',
        'size:icon': 'w-9 px-0',
      },
      children: [
        // both icons are there and hidden: an instance shows the one it wants,
        // which is how one Button has an icon and the next does not
        icon('arrow-left', 'size-4 shrink-0', { key: 'icon-start', hidden: true }),
        words('Button', 'label'),
        icon('arrow-right', 'size-4 shrink-0', { key: 'icon-end', hidden: true }),
      ],
    },
  },

  {
    key: 'badge',
    name: 'Badge',
    category: 'Badges',
    description: 'A status or a count, in four looks.',
    tokens: [
      'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
      'destructive', 'destructive-foreground', 'border', 'foreground',
    ],
    variants: [
      {
        name: 'variant',
        options: ['default', 'secondary', 'outline', 'destructive'],
        default: 'default',
      },
    ],
    root: {
      type: 'span',
      key: 'label',
      content: 'Badge',
      classes:
        'inline-flex w-fit items-center rounded-full border border-transparent bg-primary px-2 py-1 text-xs font-medium text-primary-foreground',
      variantClasses: {
        'variant:secondary': 'bg-secondary text-secondary-foreground',
        'variant:outline': 'border-border bg-transparent text-foreground',
        'variant:destructive': 'bg-destructive text-destructive-foreground',
      },
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
      children: [{ type: 'image', key: 'image', classes: 'h-full w-full object-cover' }],
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
  {
    key: 'kbd',
    name: 'Kbd',
    category: 'Display',
    description: 'A key, or a shortcut.',
    tokens: ['border', 'muted', 'muted-foreground'],
    root: {
      type: 'span',
      key: 'label',
      content: '⌘K',
      classes:
        'inline-flex h-5 w-fit items-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground',
    },
  },
  {
    key: 'skeleton',
    name: 'Skeleton',
    category: 'Display',
    description: 'A placeholder that pulses while content loads.',
    tokens: ['muted'],
    root: { type: 'div', classes: 'h-4 w-full animate-pulse rounded-md bg-muted' },
  },
  {
    key: 'spinner',
    name: 'Spinner',
    category: 'Display',
    description: 'Something is happening.',
    tokens: ['muted-foreground'],
    root: icon('loader-circle', 'size-4 shrink-0 animate-spin text-muted-foreground', {
      attributes: { 'aria-label': 'Loading' },
    }),
  },
  {
    key: 'progress',
    name: 'Progress',
    category: 'Display',
    description: 'How far along. Set the bar’s width to the share done.',
    tokens: ['muted', 'primary'],
    root: {
      type: 'div',
      classes: 'h-2 w-full overflow-hidden rounded-full bg-muted',
      attributes: { role: 'progressbar' },
      children: [
        { type: 'div', key: 'bar', classes: 'h-full w-1/2 rounded-full bg-primary transition-all' },
      ],
    },
  },
  {
    key: 'empty',
    name: 'Empty',
    category: 'Display',
    description: 'What a list shows when there is nothing in it yet.',
    tokens: ['border', 'muted', 'muted-foreground', 'foreground'],
    root: {
      type: 'div',
      classes:
        'flex w-full flex-col items-center gap-4 rounded-xl border border-dashed border-border p-10 text-center',
      children: [
        {
          type: 'div',
          classes: 'flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground',
          children: [icon('inbox', 'size-5 shrink-0', { key: 'icon' })],
        },
        {
          type: 'div',
          classes: 'flex flex-col gap-1',
          children: [
            { type: 'h3', key: 'title', content: 'Nothing here yet', classes: 'text-base font-semibold text-foreground' },
            {
              type: 'paragraph',
              key: 'description',
              content: 'Create your first one to see it listed here.',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
        button('Create one', { start: 'plus' }),
      ],
    },
  },
]
