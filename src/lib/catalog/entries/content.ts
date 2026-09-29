import type { CatalogEntry, CatalogNode } from '../types'

/**
 * Cards, feedback, marketing blocks and page furniture — everything static.
 * The interactive pieces live in ./interactive.
 *
 * Components cannot nest components, so an entry that wants a button inside it
 * spells the button's markup out rather than referencing the Button entry.
 * Same class rules as ./primitives — including `button` and `link` being
 * containers whose words live in a `:span:` child.
 */

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring'
const CARD = 'rounded-xl border border-border bg-card text-card-foreground shadow-sm'
const CARD_TOKENS = ['border', 'card', 'card-foreground']
const PRIMARY_BUTTON =
  `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:opacity-90 ${FOCUS}`
const NAV_LINK = 'text-sm text-muted-foreground transition-colors hover:text-foreground'

const navLink = (content: string, link: string): CatalogNode => ({
  type: 'link',
  link,
  classes: NAV_LINK,
  children: [{ type: 'span', content }],
})

export const CONTENT: CatalogEntry[] = [
  {
    key: 'card',
    name: 'Card',
    category: 'Cards',
    description: 'A titled panel with body copy.',
    tokens: [...CARD_TOKENS, 'muted-foreground'],
    root: {
      type: 'div',
      classes: CARD,
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-1.5 p-6',
          children: [
            {
              type: 'h3',
              content: 'Card title',
              classes: 'text-lg font-semibold tracking-tight text-card-foreground',
            },
            {
              type: 'paragraph',
              content: 'A short line about what this card holds.',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
        {
          type: 'div',
          classes: 'px-6 pb-6',
          children: [
            {
              type: 'paragraph',
              content: 'Card content goes here.',
              classes: 'text-sm text-card-foreground',
            },
          ],
        },
      ],
    },
  },
  {
    key: 'card-footer',
    name: 'CardWithFooter',
    category: 'Cards',
    description: 'A card that ends in an action.',
    tokens: [...CARD_TOKENS, 'muted-foreground', 'primary', 'primary-foreground', 'ring'],
    root: {
      type: 'div',
      classes: CARD,
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-1.5 p-6',
          children: [
            {
              type: 'h3',
              content: 'Card title',
              classes: 'text-lg font-semibold tracking-tight text-card-foreground',
            },
            {
              type: 'paragraph',
              content: 'A short line about what this card holds.',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
        {
          type: 'div',
          classes: 'flex items-center justify-end gap-2 border-t border-border px-6 py-4',
          children: [
            {
              type: 'button',
              classes: PRIMARY_BUTTON,
              children: [{ type: 'span', content: 'Continue' }],
            },
          ],
        },
      ],
    },
  },

  {
    key: 'alert',
    name: 'Alert',
    category: 'Feedback',
    description: 'A bordered notice.',
    tokens: ['border', 'background', 'foreground', 'muted-foreground'],
    root: {
      type: 'div',
      classes: 'flex flex-col gap-1 rounded-lg border border-border bg-background p-4',
      children: [
        { type: 'h4', content: 'Heads up', classes: 'text-sm font-medium text-foreground' },
        {
          type: 'paragraph',
          content: 'Something worth knowing before you carry on.',
          classes: 'text-sm text-muted-foreground',
        },
      ],
    },
  },
  {
    key: 'alert-destructive',
    name: 'AlertDestructive',
    category: 'Feedback',
    description: 'An error notice.',
    tokens: ['destructive', 'background'],
    root: {
      type: 'div',
      classes: 'flex flex-col gap-1 rounded-lg border border-destructive bg-background p-4',
      children: [
        {
          type: 'h4',
          content: 'Something went wrong',
          classes: 'text-sm font-medium text-destructive',
        },
        {
          type: 'paragraph',
          content: 'Your changes could not be saved. Try again.',
          classes: 'text-sm text-destructive',
        },
      ],
    },
  },

  {
    key: 'testimonial',
    name: 'Testimonial',
    category: 'Content',
    description: 'A quote with an attributed author.',
    tokens: [...CARD_TOKENS, 'muted', 'muted-foreground'],
    root: {
      type: 'div',
      classes: `flex flex-col gap-4 p-6 ${CARD}`,
      children: [
        {
          type: 'paragraph',
          content: 'This is the single best tool we have adopted all year.',
          classes: 'text-base text-card-foreground',
        },
        {
          type: 'div',
          classes: 'flex items-center gap-3',
          children: [
            {
              type: 'div',
              classes: 'size-10 shrink-0 overflow-hidden rounded-full bg-muted',
              children: [{ type: 'image', classes: 'h-full w-full object-cover' }],
            },
            {
              type: 'div',
              classes: 'flex min-w-0 flex-col',
              children: [
                {
                  type: 'span',
                  content: 'Jane Doe',
                  classes: 'truncate text-sm font-medium text-card-foreground',
                },
                {
                  type: 'span',
                  content: 'Head of Design, Acme',
                  classes: 'truncate text-xs text-muted-foreground',
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    key: 'pricing-card',
    name: 'PricingCard',
    category: 'Content',
    description: 'A plan, its price and what it includes.',
    tokens: [...CARD_TOKENS, 'muted-foreground', 'primary', 'primary-foreground', 'ring'],
    root: {
      type: 'div',
      classes: `flex flex-col gap-6 p-6 ${CARD}`,
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-2',
          children: [
            { type: 'span', content: 'Pro', classes: 'text-sm font-medium text-muted-foreground' },
            {
              type: 'div',
              classes: 'flex items-end gap-1',
              children: [
                {
                  type: 'span',
                  content: '$29',
                  classes: 'text-4xl font-bold tracking-tight text-card-foreground',
                },
                { type: 'span', content: '/month', classes: 'text-sm text-muted-foreground' },
              ],
            },
          ],
        },
        {
          type: 'list',
          classes: 'flex flex-col gap-2',
          children: [
            {
              type: 'list-item',
              content: 'Unlimited projects',
              classes: 'text-sm text-muted-foreground',
            },
            {
              type: 'list-item',
              content: 'Priority support',
              classes: 'text-sm text-muted-foreground',
            },
            {
              type: 'list-item',
              content: 'Custom domains',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
        {
          type: 'button',
          classes: `w-full ${PRIMARY_BUTTON}`,
          children: [{ type: 'span', content: 'Get started' }],
        },
      ],
    },
  },
  {
    key: 'feature-block',
    name: 'FeatureBlock',
    category: 'Content',
    description: 'An icon slot, a heading and a line — for a feature grid.',
    tokens: ['muted', 'foreground', 'muted-foreground'],
    root: {
      type: 'div',
      classes: 'flex flex-col gap-3',
      children: [
        { type: 'div', classes: 'size-10 shrink-0 rounded-lg bg-muted' },
        {
          type: 'h3',
          content: 'Fast by default',
          classes: 'text-base font-semibold text-foreground',
        },
        {
          type: 'paragraph',
          content: 'A sentence on why this matters to the reader.',
          classes: 'text-sm text-muted-foreground',
        },
      ],
    },
  },

  {
    key: 'footer',
    name: 'Footer',
    category: 'Navigation',
    description: 'A site footer with links and a copyright line.',
    tokens: ['border', 'background', 'foreground', 'muted-foreground'],
    root: {
      type: 'footer',
      classes: 'flex flex-col gap-6 border-t border-border bg-background px-6 py-12',
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
          children: [
            { type: 'span', content: 'Acme Inc.', classes: 'text-sm font-semibold text-foreground' },
            {
              type: 'nav',
              classes: 'flex items-center gap-6',
              children: [
                navLink('Privacy', '/privacy'),
                navLink('Terms', '/terms'),
                navLink('Contact', '/contact'),
              ],
            },
          ],
        },
        {
          type: 'span',
          content: '© Acme Inc. All rights reserved.',
          classes: 'text-xs text-muted-foreground',
        },
      ],
    },
  },
  {
    key: 'breadcrumb',
    name: 'Breadcrumb',
    category: 'Navigation',
    description: 'The trail back up to the home page.',
    tokens: ['foreground', 'muted-foreground'],
    root: {
      type: 'nav',
      classes: 'flex items-center gap-2',
      children: [
        navLink('Home', '/'),
        { type: 'span', content: '/', classes: 'text-sm text-muted-foreground' },
        navLink('Docs', '/docs'),
        { type: 'span', content: '/', classes: 'text-sm text-muted-foreground' },
        { type: 'span', content: 'This page', classes: 'text-sm font-medium text-foreground' },
      ],
    },
  },

  {
    key: 'hero',
    name: 'Hero',
    category: 'Sections',
    description: 'A headline, a line of copy and two actions.',
    tokens: ['foreground', 'muted-foreground', 'primary', 'primary-foreground', 'input', 'background', 'accent', 'accent-foreground', 'ring'],
    root: {
      type: 'section',
      classes: 'flex flex-col items-center gap-6 px-6 py-24 text-center',
      children: [
        {
          type: 'h1',
          content: 'Build your site, faster',
          classes: 'max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-5xl',
        },
        {
          type: 'paragraph',
          content: 'One sentence on what this does and who it is for.',
          classes: 'max-w-2xl text-base text-muted-foreground',
        },
        {
          type: 'div',
          classes: 'flex flex-col gap-3 sm:flex-row',
          children: [
            {
              type: 'button',
              classes: PRIMARY_BUTTON,
              children: [{ type: 'span', content: 'Get started' }],
            },
            {
              type: 'button',
              classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground ${FOCUS}`,
              children: [{ type: 'span', content: 'Learn more' }],
            },
          ],
        },
      ],
    },
  },
  {
    key: 'cta',
    name: 'CallToAction',
    category: 'Sections',
    description: 'A closing band that asks for the click.',
    tokens: ['primary', 'primary-foreground', 'background', 'foreground', 'ring'],
    root: {
      type: 'section',
      classes: 'flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-16 text-center',
      children: [
        {
          type: 'h2',
          content: 'Ready to get started?',
          classes: 'text-3xl font-bold tracking-tight text-primary-foreground',
        },
        {
          type: 'paragraph',
          content: 'Set up your first site in a couple of minutes.',
          classes: 'max-w-xl text-sm text-primary-foreground',
        },
        {
          type: 'button',
          classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-background px-4 text-sm font-medium text-foreground transition-colors outline-none hover:opacity-90 ${FOCUS}`,
          children: [{ type: 'span', content: 'Start for free' }],
        },
      ],
    },
  },
]
