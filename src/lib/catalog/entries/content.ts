import type { CatalogEntry, CatalogNode } from '../types'
import { CARD, CARD_TOKENS, button, icon, link } from './helpers'

/**
 * Cards, feedback, marketing blocks and page furniture — everything static.
 * The interactive pieces live in ./interactive.
 *
 * Where one of these has a button, it holds an instance of the Button entry
 * rather than a copy of its markup: restyle Button once and every card, hero
 * and pricing plan follows. See ./helpers for the class rules.
 */

const NAV_LINK = 'text-sm text-muted-foreground transition-colors hover:text-foreground'
const navLink = (content: string, href: string) => link(content, href, NAV_LINK)

const CARD_TITLE = 'text-lg font-semibold tracking-tight text-card-foreground'

const cell = (content: string, classes = ''): CatalogNode => ({
  type: 'td',
  classes: `p-2 align-middle ${classes}`.trim(),
  children: [{ type: 'text', content }],
})
const headCell = (content: string, classes = ''): CatalogNode => ({
  type: 'th',
  classes: `h-10 px-2 text-left align-middle font-medium text-muted-foreground ${classes}`.trim(),
  children: [{ type: 'text', content }],
})
const row = (...cells: CatalogNode[]): CatalogNode => ({
  type: 'tr',
  classes: 'border-b border-border transition-colors hover:bg-muted',
  children: cells,
})

const feature = (text: string): CatalogNode => ({
  type: 'list-item',
  classes: 'flex items-center gap-2 text-sm text-muted-foreground',
  children: [icon('check', 'size-4 shrink-0 text-primary'), { type: 'text', content: text }],
})

const slide = (title: string): CatalogNode => ({
  type: 'div',
  classes: 'flex h-48 items-center justify-center rounded-xl bg-muted',
  children: [{ type: 'span', content: title, classes: 'text-2xl font-semibold text-muted-foreground' }],
})

export const CONTENT: CatalogEntry[] = [
  {
    key: 'card',
    name: 'Card',
    category: 'Cards',
    description: 'A titled panel with body copy, and a footer action you can switch on.',
    tokens: [...CARD_TOKENS, 'muted-foreground'],
    root: {
      type: 'div',
      classes: CARD,
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-1.5 p-6',
          children: [
            { type: 'h3', key: 'title', content: 'Card title', classes: CARD_TITLE },
            {
              type: 'paragraph',
              key: 'description',
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
              key: 'content',
              content: 'Card content goes here.',
              classes: 'text-sm text-card-foreground',
            },
          ],
        },
        {
          // there, and hidden: an instance that needs an action shows it
          type: 'div',
          key: 'footer',
          hidden: true,
          classes: 'flex items-center justify-end gap-2 border-t border-border px-6 py-4',
          children: [button('Continue')],
        },
      ],
    },
  },

  {
    key: 'alert',
    name: 'Alert',
    category: 'Feedback',
    description: 'A notice, plain or for an error.',
    tokens: ['border', 'background', 'foreground', 'muted-foreground', 'destructive'],
    variants: [{ name: 'variant', options: ['default', 'destructive'], default: 'default' }],
    root: {
      type: 'div',
      classes: 'flex w-full gap-3 rounded-lg border border-border bg-background p-4 text-foreground',
      attributes: { role: 'alert' },
      variantClasses: { 'variant:destructive': 'border-destructive text-destructive' },
      children: [
        // no colour of its own: it follows the alert's text colour
        icon('info', 'mt-0.5 size-4 shrink-0', { key: 'icon' }),
        {
          type: 'div',
          classes: 'flex min-w-0 flex-col gap-1',
          children: [
            { type: 'h4', key: 'title', content: 'Heads up', classes: 'text-sm font-medium' },
            {
              type: 'paragraph',
              key: 'description',
              content: 'Something worth knowing before you carry on.',
              classes: 'text-sm text-muted-foreground',
              variantClasses: { 'variant:destructive': 'text-destructive' },
            },
          ],
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
          key: 'quote',
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
              children: [{ type: 'image', key: 'photo', classes: 'h-full w-full object-cover' }],
            },
            {
              type: 'div',
              classes: 'flex min-w-0 flex-col',
              children: [
                {
                  type: 'span',
                  key: 'name',
                  content: 'Jane Doe',
                  classes: 'truncate text-sm font-medium text-card-foreground',
                },
                {
                  type: 'span',
                  key: 'role',
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
    tokens: [...CARD_TOKENS, 'muted-foreground', 'primary'],
    root: {
      type: 'div',
      classes: `flex flex-col gap-6 p-6 ${CARD}`,
      children: [
        {
          type: 'div',
          classes: 'flex flex-col gap-2',
          children: [
            {
              type: 'div',
              classes: 'flex items-center justify-between gap-2',
              children: [
                { type: 'span', key: 'plan', content: 'Pro', classes: 'text-sm font-medium text-muted-foreground' },
                {
                  type: 'Badge',
                  component: 'badge',
                  key: 'badge',
                  hidden: true,
                  variants: { variant: 'secondary' },
                  parts: { label: { content: 'Most popular' } },
                },
              ],
            },
            {
              type: 'div',
              classes: 'flex items-end gap-1',
              children: [
                {
                  type: 'span',
                  key: 'price',
                  content: '$29',
                  classes: 'text-4xl font-bold tracking-tight text-card-foreground',
                },
                { type: 'span', key: 'period', content: '/month', classes: 'text-sm text-muted-foreground' },
              ],
            },
          ],
        },
        {
          type: 'list',
          classes: 'flex flex-col gap-2',
          children: [feature('Unlimited projects'), feature('Priority support'), feature('Custom domains')],
        },
        {
          // the button fills the card: the width is the card's layout to give
          type: 'div',
          classes: 'flex flex-col',
          children: [button('Get started')],
        },
      ],
    },
  },
  {
    key: 'feature-block',
    name: 'FeatureBlock',
    category: 'Content',
    description: 'An icon, a heading and a line — for a feature grid.',
    tokens: ['muted', 'foreground', 'muted-foreground'],
    root: {
      type: 'div',
      classes: 'flex flex-col gap-3',
      children: [
        {
          type: 'div',
          classes: 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground',
          children: [icon('zap', 'size-5 shrink-0', { key: 'icon' })],
        },
        { type: 'h3', key: 'title', content: 'Fast by default', classes: 'text-base font-semibold text-foreground' },
        {
          type: 'paragraph',
          key: 'description',
          content: 'A sentence on why this matters to the reader.',
          classes: 'text-sm text-muted-foreground',
        },
      ],
    },
  },
  {
    key: 'table',
    name: 'Table',
    category: 'Content',
    description: 'Rows and columns, with a header.',
    tokens: ['border', 'muted', 'muted-foreground', 'foreground'],
    root: {
      type: 'div',
      classes: 'w-full overflow-x-auto',
      children: [
        {
          type: 'table',
          classes: 'w-full border-collapse text-sm text-foreground',
          children: [
            {
              type: 'thead',
              children: [
                {
                  type: 'tr',
                  classes: 'border-b border-border',
                  children: [headCell('Invoice'), headCell('Status'), headCell('Amount', 'text-right')],
                },
              ],
            },
            {
              type: 'tbody',
              children: [
                row(cell('INV-001', 'font-medium'), cell('Paid'), cell('$250.00', 'text-right')),
                row(cell('INV-002', 'font-medium'), cell('Pending'), cell('$150.00', 'text-right')),
                row(cell('INV-003', 'font-medium'), cell('Unpaid'), cell('$350.00', 'text-right')),
              ],
            },
          ],
        },
      ],
    },
  },
  {
    key: 'carousel',
    name: 'Carousel',
    category: 'Content',
    description: 'Slides you step through, with arrows and dots.',
    tokens: ['muted', 'muted-foreground'],
    root: {
      type: 'slider',
      classes: 'w-full',
      slider: { gap: 16 },
      children: [slide('One'), slide('Two'), slide('Three')],
    },
  },

  {
    key: 'pagination',
    name: 'Pagination',
    category: 'Navigation',
    description: 'Previous, next, and the pages between.',
    tokens: [],
    root: {
      type: 'nav',
      classes: 'flex items-center justify-center gap-1',
      attributes: { 'aria-label': 'Pagination' },
      children: [
        button('Previous', { variant: 'ghost', start: 'chevron-left' }),
        button('1', { variant: 'outline', size: 'icon' }),
        button('2', { variant: 'ghost', size: 'icon' }),
        button('3', { variant: 'ghost', size: 'icon' }),
        button('Next', { variant: 'ghost', end: 'chevron-right' }),
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
      classes: 'flex items-center gap-2 text-muted-foreground',
      attributes: { 'aria-label': 'Breadcrumb' },
      children: [
        navLink('Home', '/'),
        icon('chevron-right', 'size-3 shrink-0'),
        navLink('Docs', '/docs'),
        icon('chevron-right', 'size-3 shrink-0'),
        { type: 'span', key: 'current', content: 'This page', classes: 'text-sm font-medium text-foreground' },
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
            { type: 'span', key: 'brand', content: 'Acme Inc.', classes: 'text-sm font-semibold text-foreground' },
            {
              type: 'nav',
              classes: 'flex items-center gap-6',
              children: [navLink('Privacy', '/privacy'), navLink('Terms', '/terms'), navLink('Contact', '/contact')],
            },
          ],
        },
        {
          type: 'span',
          key: 'legal',
          content: '© Acme Inc. All rights reserved.',
          classes: 'text-xs text-muted-foreground',
        },
      ],
    },
  },

  {
    key: 'hero',
    name: 'Hero',
    category: 'Sections',
    description: 'A headline, a line of copy and two actions.',
    tokens: ['foreground', 'muted-foreground'],
    root: {
      type: 'section',
      classes: 'flex flex-col items-center gap-6 px-6 py-24 text-center',
      children: [
        {
          type: 'h1',
          key: 'title',
          content: 'Build your site, faster',
          classes: 'max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-5xl',
        },
        {
          type: 'paragraph',
          key: 'description',
          content: 'One sentence on what this does and who it is for.',
          classes: 'max-w-2xl text-base text-muted-foreground',
        },
        {
          type: 'div',
          classes: 'flex flex-col gap-3 sm:flex-row',
          children: [
            button('Get started', { size: 'lg', end: 'arrow-right' }),
            button('Learn more', { variant: 'outline', size: 'lg' }),
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
    tokens: ['primary', 'primary-foreground'],
    root: {
      type: 'section',
      classes: 'flex flex-col items-center gap-4 rounded-xl bg-primary px-6 py-16 text-center',
      children: [
        {
          type: 'h2',
          key: 'title',
          content: 'Ready to get started?',
          classes: 'text-3xl font-bold tracking-tight text-primary-foreground',
        },
        {
          type: 'paragraph',
          key: 'description',
          content: 'Set up your first site in a couple of minutes.',
          classes: 'max-w-xl text-sm text-primary-foreground',
        },
        // on a primary band the primary button would vanish: it wears secondary
        button('Start for free', { variant: 'secondary', size: 'lg' }),
      ],
    },
  },
]
