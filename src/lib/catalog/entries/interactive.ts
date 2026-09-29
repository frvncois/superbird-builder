import type { CatalogEntry, CatalogNode } from '../types'
import { FOCUS, SURFACE, button, icon, link, trigger, words } from './helpers'

/**
 * The entries that open, close and switch.
 *
 * Two rules shape the ones that carry interaction bindings:
 *
 * · **State is keyed by (interaction, target), not by binding.** That is what
 *   lets an open button, a close button and an overlay drive one effect, and
 *   it is why every binding below that means "the same panel" names the same
 *   target.
 * · **A `group` holds ONE open key.** So a grouped binding and an ungrouped
 *   one may never share a target, and an `off` binding never carries a group.
 *
 * Effect names are entry-specific ("Accordion · open"): the interaction
 * library is project-wide and shared by reference, so a generic "Show" would
 * mean editing one component silently restyles another.
 *
 * Where the trigger is a Button, the binding sits on a wrapper the entry owns
 * (`trigger` in ./helpers): a host cannot bind on an instance it holds.
 *
 * Tooltip and HoverCard carry no binding at all. Hover is something CSS can
 * see (`group-hover:`), so they work with no JavaScript.
 */

const MENU_ITEM =
  'rounded-md px-2 py-1.5 text-sm text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
const NAVBAR_LINK = 'text-sm text-muted-foreground transition-colors hover:text-foreground'
const MOBILE_LINK =
  'rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
const OVERLAY = 'absolute inset-0 bg-[rgba(0,0,0,0.5)]'
const DIALOG_PANEL = `relative z-50 flex w-full max-w-md flex-col gap-4 rounded-xl p-6 shadow-lg border border-border bg-card text-card-foreground`

/** one accordion row: a full-width trigger over a panel that starts hidden */
const accordionItem = (key: string, question: string, answer: string): CatalogNode => ({
  type: 'div',
  classes: 'flex flex-col border-b border-border',
  children: [
    {
      type: 'button',
      classes: `flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground outline-none ${FOCUS}`,
      children: [words(question), icon('chevron-down', 'size-4 shrink-0 text-muted-foreground')],
      // the group makes it exclusive — and is scoped per component instance by
      // the runtime, so two accordions on a page never fight
      interactions: [{ interaction: 'open', trigger: 'click', target: key, group: 'accordion' }],
    },
    { type: 'div', key, content: answer, classes: 'hidden pb-4 text-sm text-muted-foreground' },
  ],
})

/**
 * Tabs, without a default-state trigger.
 *
 * Panel 1 is visible in the markup and panels 2..N start `hidden`, so the
 * component reads correctly with no JS at all. An `appear` binding would have
 * been the obvious way to set the default, and it is wrong here: the published
 * runtime forces every appear state on after 3s, which would snap the reader
 * back to tab 1 mid-read.
 *
 * So tab 1 is the "off" position of every effect, and tabs 2..N turn theirs on:
 *   tab k≥2 → Show@Pk on (grouped, so the other panels close) + Hide@P1 on
 *   tab 1   → Hide@P1 off + Show@Pk off for every k
 * with the same shape again for the active-tab highlight.
 *
 * Adding a fourth tab means wiring its bindings by hand — the accepted limit
 * of expressing this in a class-toggle model.
 */
const TAB_KEYS = ['panel-1', 'panel-2', 'panel-3']
const TAB_LABELS = ['Overview', 'Details', 'Activity']
const TAB_BODIES = [
  'The first panel is the one visible before anything is clicked.',
  'The second panel. Clicking its tab hides the others.',
  'The third panel, same again.',
]
const TAB_BASE =
  `flex-1 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors ${FOCUS}`

const tabsRoot = (): CatalogNode => {
  const tabs: CatalogNode[] = TAB_LABELS.map((label, i) => {
    const key = `tab-${i + 1}`
    const first = i === 0
    return {
      type: 'button',
      key,
      children: [words(label)],
      classes: first
        ? `${TAB_BASE} bg-background text-foreground`
        : `${TAB_BASE} text-muted-foreground`,
      interactions: first
        ? [
            // tab 1 restores the default: every effect back off
            { interaction: 'hide-first', trigger: 'click' as const, target: TAB_KEYS[0], action: 'off' as const },
            ...TAB_KEYS.slice(1).map((k) => ({
              interaction: 'show',
              trigger: 'click' as const,
              target: k,
              action: 'off' as const,
            })),
            { interaction: 'dim-first', trigger: 'click' as const, target: 'tab-1', action: 'off' as const },
            ...TAB_LABELS.slice(1).map((_, j) => ({
              interaction: 'activate',
              trigger: 'click' as const,
              target: `tab-${j + 2}`,
              action: 'off' as const,
            })),
          ]
        : [
            { interaction: 'show', trigger: 'click' as const, target: TAB_KEYS[i], action: 'on' as const, group: 'panels' },
            { interaction: 'hide-first', trigger: 'click' as const, target: TAB_KEYS[0], action: 'on' as const },
            { interaction: 'activate', trigger: 'click' as const, target: key, action: 'on' as const, group: 'tabs' },
            { interaction: 'dim-first', trigger: 'click' as const, target: 'tab-1', action: 'on' as const },
          ],
    }
  })

  const panels: CatalogNode[] = TAB_KEYS.map((key, i) => ({
    type: 'div',
    key,
    content: TAB_BODIES[i],
    classes: i === 0 ? 'py-4 text-sm text-muted-foreground' : 'hidden py-4 text-sm text-muted-foreground',
  }))

  return {
    type: 'div',
    classes: 'flex w-full flex-col',
    children: [
      { type: 'div', classes: 'flex items-center gap-1 rounded-lg bg-muted p-1', children: tabs },
      ...panels,
    ],
  }
}

/** a modal: a trigger, and a layer over the page holding an overlay and a panel */
const modal = (opts: {
  open: string
  title: string
  body: string
  /** may the overlay and Escape dismiss it? An alert dialog asks for an answer. */
  dismissible: boolean
  actions: CatalogNode[]
}): CatalogNode => ({
  type: 'div',
  classes: 'flex flex-col items-start gap-4',
  children: [
    trigger(button(opts.open), [{ interaction: 'open', trigger: 'click', target: 'layer', action: 'on' }]),
    {
      type: 'div',
      key: 'layer',
      classes: 'hidden fixed inset-0 z-50 items-center justify-center p-6',
      children: [
        {
          type: 'div',
          classes: OVERLAY,
          ...(opts.dismissible
            ? { interactions: [{ interaction: 'open', trigger: 'click' as const, target: 'layer', action: 'off' as const }] }
            : {}),
        },
        {
          type: 'div',
          classes: DIALOG_PANEL,
          attributes: { role: opts.dismissible ? 'dialog' : 'alertdialog', 'aria-modal': 'true' },
          children: [
            {
              type: 'h3',
              key: 'title',
              content: opts.title,
              classes: 'text-lg font-semibold tracking-tight text-card-foreground',
            },
            { type: 'paragraph', key: 'description', content: opts.body, classes: 'text-sm text-muted-foreground' },
            { type: 'div', classes: 'flex items-center justify-end gap-2', children: opts.actions },
          ],
        },
      ],
    },
  ],
})

/** an action inside a modal: it answers, and the modal closes */
const closes = (child: CatalogNode, escape = false): CatalogNode =>
  trigger(child, [
    {
      interaction: 'open',
      trigger: 'click',
      target: 'layer',
      action: 'off',
      // closeOn applies to the EFFECT, not this one trigger, so it reads best
      // on the button that says "cancel"
      ...(escape ? { closeOn: ['escape' as const] } : {}),
    },
  ])

export const INTERACTIVE: CatalogEntry[] = [
  {
    key: 'accordion',
    name: 'Accordion',
    category: 'Interactive',
    description: 'Question rows that open one at a time.',
    tokens: ['border', 'foreground', 'muted-foreground', 'ring'],
    interactions: [{ key: 'open', name: 'Accordion · open', toClasses: 'block' }],
    root: {
      type: 'div',
      classes: 'flex w-full flex-col',
      children: [
        accordionItem('answer-1', 'Is it accessible?', 'Yes — it is keyboard operable throughout.'),
        accordionItem('answer-2', 'Can I restyle it?', 'Every part is a normal element you can style.'),
        accordionItem('answer-3', 'Does it work on mobile?', 'It does; the rows stack at any width.'),
      ],
    },
  },
  {
    key: 'collapsible',
    name: 'Collapsible',
    category: 'Interactive',
    description: 'One section that opens and closes.',
    tokens: ['border', 'foreground', 'muted-foreground'],
    interactions: [{ key: 'open', name: 'Collapsible · open', toClasses: 'flex' }],
    root: {
      type: 'div',
      classes: 'flex w-full flex-col gap-2',
      children: [
        {
          type: 'div',
          classes: 'flex items-center justify-between gap-4',
          children: [
            { type: 'span', key: 'title', content: 'Three more items', classes: 'text-sm font-medium text-foreground' },
            trigger(button('Toggle', { variant: 'ghost', size: 'icon', start: 'chevrons-up-down', iconOnly: true }), [
              { interaction: 'open', trigger: 'click', target: 'content' },
            ]),
          ],
        },
        {
          type: 'div',
          key: 'content',
          classes: 'hidden flex-col gap-2',
          children: [
            { type: 'text', content: 'First item', classes: 'rounded-md border border-border px-4 py-2 text-sm text-muted-foreground' },
            { type: 'text', content: 'Second item', classes: 'rounded-md border border-border px-4 py-2 text-sm text-muted-foreground' },
            { type: 'text', content: 'Third item', classes: 'rounded-md border border-border px-4 py-2 text-sm text-muted-foreground' },
          ],
        },
      ],
    },
  },

  {
    key: 'dialog',
    name: 'Dialog',
    category: 'Interactive',
    description: 'A modal over a dimmed page. The overlay and Escape dismiss it.',
    tokens: ['border', 'card', 'card-foreground', 'muted-foreground'],
    interactions: [{ key: 'open', name: 'Dialog · open', toClasses: 'flex' }],
    root: modal({
      open: 'Open dialog',
      title: 'Edit profile',
      body: 'Make your changes here, then save when you are done.',
      dismissible: true,
      actions: [closes(button('Cancel', { variant: 'outline' }), true), closes(button('Save changes'))],
    }),
  },
  {
    key: 'alert-dialog',
    name: 'AlertDialog',
    category: 'Interactive',
    description: 'A modal that wants an answer: only its buttons close it.',
    tokens: ['border', 'card', 'card-foreground', 'muted-foreground'],
    interactions: [{ key: 'open', name: 'Alert dialog · open', toClasses: 'flex' }],
    root: modal({
      open: 'Delete account',
      title: 'Are you sure?',
      body: 'This action cannot be undone.',
      dismissible: false,
      actions: [closes(button('Cancel', { variant: 'outline' })), closes(button('Delete', { variant: 'destructive' }))],
    }),
  },
  {
    key: 'sheet',
    name: 'Sheet',
    category: 'Interactive',
    description: 'A panel that comes in from an edge of the screen.',
    tokens: ['border', 'background', 'foreground', 'muted-foreground'],
    variants: [{ name: 'side', options: ['right', 'left', 'top', 'bottom'], default: 'right' }],
    interactions: [{ key: 'open', name: 'Sheet · open', toClasses: 'block' }],
    root: {
      type: 'div',
      classes: 'flex flex-col items-start gap-4',
      children: [
        trigger(button('Open sheet', { variant: 'outline' }), [
          { interaction: 'open', trigger: 'click', target: 'layer', action: 'on' },
        ]),
        {
          type: 'div',
          key: 'layer',
          classes: 'hidden fixed inset-0 z-50',
          children: [
            {
              type: 'div',
              classes: OVERLAY,
              interactions: [
                { interaction: 'open', trigger: 'click', target: 'layer', action: 'off', closeOn: ['escape'] },
              ],
            },
            {
              type: 'div',
              key: 'panel',
              classes:
                'absolute inset-y-0 right-0 flex h-full w-80 flex-col gap-4 border-l border-border bg-background p-6 shadow-lg',
              // the side it comes from: only the edge it hugs and the border
              // facing the page change
              variantClasses: {
                'side:left': 'right-auto left-0 border-l-0 border-r',
                'side:top': 'inset-x-0 inset-y-auto top-0 h-auto w-full border-l-0 border-b',
                'side:bottom': 'inset-x-0 inset-y-auto bottom-0 h-auto w-full border-l-0 border-t',
              },
              attributes: { role: 'dialog', 'aria-modal': 'true' },
              children: [
                { type: 'h3', key: 'title', content: 'Sheet title', classes: 'text-lg font-semibold tracking-tight text-foreground' },
                {
                  type: 'paragraph',
                  key: 'description',
                  content: 'What this panel is for, in a line.',
                  classes: 'text-sm text-muted-foreground',
                },
                closes(button('Close', { variant: 'outline' })),
              ],
            },
          ],
        },
      ],
    },
  },

  {
    key: 'dropdown-menu',
    name: 'DropdownMenu',
    // not "Dropdown": `dropdown` is already a built-in element (a <select>)
    category: 'Interactive',
    description: 'A button that opens a menu, dismissed by clicking away or Escape.',
    tokens: ['accent', 'accent-foreground', 'border', 'card', 'card-foreground'],
    interactions: [{ key: 'open', name: 'Dropdown · open', toClasses: 'flex' }],
    root: {
      type: 'div',
      classes: 'relative inline-flex',
      children: [
        trigger(button('Options', { variant: 'outline', end: 'chevron-down' }), [
          { interaction: 'open', trigger: 'click', target: 'menu', closeOn: ['outside', 'escape'] },
        ]),
        {
          type: 'div',
          key: 'menu',
          classes: `hidden absolute left-0 top-[100%] z-50 mt-2 w-44 flex-col p-1 ${SURFACE}`,
          attributes: { role: 'menu' },
          children: [link('Profile', '/', MENU_ITEM), link('Settings', '/', MENU_ITEM), link('Sign out', '/', MENU_ITEM)],
        },
      ],
    },
  },
  {
    key: 'popover',
    name: 'Popover',
    category: 'Interactive',
    description: 'A small panel anchored to the button that opens it.',
    tokens: ['border', 'card', 'card-foreground', 'muted-foreground'],
    interactions: [{ key: 'open', name: 'Popover · open', toClasses: 'flex' }],
    root: {
      type: 'div',
      classes: 'relative inline-flex',
      children: [
        trigger(button('Open popover', { variant: 'outline' }), [
          { interaction: 'open', trigger: 'click', target: 'panel', closeOn: ['outside', 'escape'] },
        ]),
        {
          type: 'div',
          key: 'panel',
          classes: `hidden absolute left-0 top-[100%] z-50 mt-2 w-72 flex-col gap-1 p-4 ${SURFACE}`,
          children: [
            { type: 'h4', key: 'title', content: 'Dimensions', classes: 'text-sm font-medium text-card-foreground' },
            {
              type: 'paragraph',
              key: 'description',
              content: 'Set the dimensions for the layer.',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
      ],
    },
  },
  {
    key: 'tooltip',
    name: 'Tooltip',
    category: 'Interactive',
    description: 'A word of explanation, on hover or focus.',
    tokens: ['foreground', 'background'],
    root: {
      type: 'div',
      classes: 'group relative inline-flex',
      children: [
        button('Hover me', { variant: 'outline' }),
        {
          type: 'span',
          key: 'label',
          content: 'Add to library',
          classes:
            'pointer-events-none absolute bottom-[100%] left-[50%] z-50 mb-2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          attributes: { role: 'tooltip' },
        },
      ],
    },
  },
  {
    key: 'hover-card',
    name: 'HoverCard',
    category: 'Interactive',
    description: 'A preview of what a link leads to, on hover.',
    tokens: ['primary', 'border', 'card', 'card-foreground', 'muted-foreground'],
    root: {
      type: 'div',
      classes: 'group relative inline-flex',
      children: [
        link('@acme', '/', 'text-sm font-medium text-primary underline-offset-4 hover:underline'),
        {
          type: 'div',
          key: 'card',
          classes: `pointer-events-none absolute left-0 top-[100%] z-50 mt-2 flex w-64 flex-col gap-1 p-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${SURFACE}`,
          children: [
            { type: 'span', key: 'name', content: 'Acme Inc.', classes: 'text-sm font-semibold text-card-foreground' },
            {
              type: 'paragraph',
              key: 'description',
              content: 'Tools for people who build for the web.',
              classes: 'text-sm text-muted-foreground',
            },
          ],
        },
      ],
    },
  },

  {
    key: 'navbar',
    name: 'Navbar',
    category: 'Navigation',
    description: 'A sticky header whose links collapse into a menu on mobile.',
    tokens: ['border', 'background', 'foreground', 'muted-foreground', 'accent', 'accent-foreground'],
    interactions: [{ key: 'open', name: 'Navbar · open menu', toClasses: 'flex' }],
    root: {
      type: 'header',
      classes:
        'sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background px-6 py-3',
      children: [
        link('Acme', '/', 'text-base font-semibold text-foreground'),
        {
          type: 'nav',
          classes: 'hidden items-center gap-6 md:flex',
          children: [
            link('Home', '/', NAVBAR_LINK),
            link('Features', '/features', NAVBAR_LINK),
            link('Pricing', '/pricing', NAVBAR_LINK),
          ],
        },
        // deliberately NOT breakpoint-scoped: the binding's breakpoints gate by
        // the PROJECT's widths while `md:hidden` gates by Tailwind's, and
        // scoping to Mobile would leave the button visible but dead from 391px
        // to 767px — which is most phones
        trigger(
          button('Menu', { variant: 'outline', size: 'icon', start: 'menu', iconOnly: true }),
          [{ interaction: 'open', trigger: 'click', target: 'mobile-menu', closeOn: ['outside', 'escape'] }],
          'flex md:hidden',
        ),
        {
          type: 'nav',
          key: 'mobile-menu',
          classes:
            'hidden absolute left-0 top-[100%] z-50 w-full flex-col gap-1 border-b border-border bg-background p-4 md:hidden',
          children: [
            link('Home', '/', MOBILE_LINK),
            link('Features', '/features', MOBILE_LINK),
            link('Pricing', '/pricing', MOBILE_LINK),
          ],
        },
      ],
    },
  },

  {
    key: 'tabs',
    name: 'Tabs',
    category: 'Interactive',
    description: 'Three panels behind three tabs. The first is open by default.',
    tokens: ['muted', 'muted-foreground', 'background', 'foreground', 'ring'],
    interactions: [
      { key: 'show', name: 'Tabs · show panel', toClasses: 'block' },
      { key: 'hide-first', name: 'Tabs · hide first panel', toClasses: 'hidden' },
      { key: 'activate', name: 'Tabs · active tab', toClasses: 'bg-background text-foreground' },
      // both families: tab 1's base is `bg-background text-foreground`, and a
      // toClasses that only names the text colour would leave it wearing the
      // active background while another tab is selected
      {
        key: 'dim-first',
        name: 'Tabs · inactive first tab',
        toClasses: 'bg-muted text-muted-foreground',
      },
    ],
    root: tabsRoot(),
  },
]
