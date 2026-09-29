import type { CatalogEntry, CatalogNode } from '../types'

/**
 * The entries that carry real interaction bindings.
 *
 * Two rules shape all of them:
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
 */

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring'
const MENU_ITEM =
  'rounded-md px-2 py-1.5 text-sm text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
const SURFACE = 'rounded-lg border border-border bg-card p-1 shadow-md'

/** one accordion row: a full-width trigger over a panel that starts hidden */
const accordionItem = (key: string, question: string, answer: string): CatalogNode => ({
  type: 'div',
  classes: 'flex flex-col border-b border-border',
  children: [
    {
      type: 'button',
      content: question,
      classes: `flex w-full items-center justify-between py-4 text-left text-sm font-medium text-foreground outline-none ${FOCUS}`,
      // the group makes it exclusive — and is scoped per component instance by
      // the runtime, so two accordions on a page never fight
      interactions: [
        { interaction: 'open', trigger: 'click', target: key, group: 'accordion' },
      ],
    },
    {
      type: 'div',
      key,
      content: answer,
      classes: 'hidden pb-4 text-sm text-muted-foreground',
    },
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
      content: label,
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
    key: 'dialog',
    name: 'Dialog',
    category: 'Interactive',
    description: 'A modal over a dimmed page, with an overlay that dismisses it.',
    tokens: ['primary', 'primary-foreground', 'border', 'card', 'card-foreground', 'muted-foreground', 'input', 'background', 'foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'ring'],
    interactions: [{ key: 'open', name: 'Dialog · open', toClasses: 'flex' }],
    root: {
      type: 'div',
      classes: 'flex flex-col items-start gap-4',
      children: [
        {
          type: 'button',
          content: 'Open dialog',
          classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:opacity-90 ${FOCUS}`,
          interactions: [
            { interaction: 'open', trigger: 'click', target: 'dialog', action: 'on' },
          ],
        },
        {
          type: 'div',
          key: 'dialog',
          classes: 'hidden fixed inset-0 z-50 items-center justify-center p-6',
          children: [
            {
              type: 'div',
              classes: 'absolute inset-0 bg-[rgba(0,0,0,0.5)]',
              interactions: [
                { interaction: 'open', trigger: 'click', target: 'dialog', action: 'off' },
              ],
            },
            {
              type: 'div',
              classes: `relative z-50 flex w-full max-w-md flex-col gap-4 p-6 ${SURFACE.replace('p-1', '')} rounded-xl shadow-lg`,
              children: [
                {
                  type: 'h3',
                  content: 'Are you sure?',
                  classes: 'text-lg font-semibold tracking-tight text-card-foreground',
                },
                {
                  type: 'paragraph',
                  content: 'This action cannot be undone.',
                  classes: 'text-sm text-muted-foreground',
                },
                {
                  type: 'div',
                  classes: 'flex items-center justify-end gap-2',
                  children: [
                    {
                      type: 'button',
                      content: 'Cancel',
                      classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground ${FOCUS}`,
                      // closeOn applies to the EFFECT, not this one trigger, so
                      // it reads best on the button that says "cancel"
                      interactions: [
                        {
                          interaction: 'open',
                          trigger: 'click',
                          target: 'dialog',
                          action: 'off',
                          closeOn: ['escape'],
                        },
                      ],
                    },
                    {
                      type: 'button',
                      content: 'Confirm',
                      classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors outline-none hover:opacity-90 ${FOCUS}`,
                      interactions: [
                        { interaction: 'open', trigger: 'click', target: 'dialog', action: 'off' },
                      ],
                    },
                  ],
                },
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
    tokens: ['input', 'background', 'foreground', 'accent', 'accent-foreground', 'border', 'card', 'card-foreground', 'ring'],
    interactions: [{ key: 'open', name: 'Dropdown · open', toClasses: 'flex' }],
    root: {
      type: 'div',
      classes: 'relative inline-flex',
      children: [
        {
          type: 'button',
          content: 'Options',
          classes: `inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground ${FOCUS}`,
          interactions: [
            {
              interaction: 'open',
              trigger: 'click',
              target: 'menu',
              closeOn: ['outside', 'escape'],
            },
          ],
        },
        {
          type: 'div',
          key: 'menu',
          classes: `hidden absolute left-0 top-[100%] z-50 mt-2 w-44 flex-col ${SURFACE}`,
          children: [
            { type: 'link', content: 'Profile', link: '/', classes: MENU_ITEM },
            { type: 'link', content: 'Settings', link: '/', classes: MENU_ITEM },
            { type: 'link', content: 'Sign out', link: '/', classes: MENU_ITEM },
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
    tokens: ['border', 'background', 'foreground', 'muted-foreground', 'accent', 'accent-foreground', 'input', 'ring'],
    interactions: [{ key: 'open', name: 'Navbar · open menu', toClasses: 'flex' }],
    root: {
      type: 'header',
      classes:
        'sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background px-6 py-3',
      children: [
        {
          type: 'link',
          content: 'Acme',
          link: '/',
          classes: 'text-base font-semibold text-foreground',
        },
        {
          type: 'nav',
          classes: 'hidden items-center gap-6 md:flex',
          children: [
            { type: 'link', content: 'Home', link: '/', classes: 'text-sm text-muted-foreground transition-colors hover:text-foreground' },
            { type: 'link', content: 'Features', link: '/features', classes: 'text-sm text-muted-foreground transition-colors hover:text-foreground' },
            { type: 'link', content: 'Pricing', link: '/pricing', classes: 'text-sm text-muted-foreground transition-colors hover:text-foreground' },
          ],
        },
        {
          type: 'button',
          content: 'Menu',
          classes: `inline-flex h-9 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium text-foreground outline-none md:hidden ${FOCUS}`,
          // deliberately NOT breakpoint-scoped: the binding's breakpoints gate
          // by the PROJECT's widths while `md:hidden` gates by Tailwind's, and
          // scoping to Mobile would leave the button visible but dead from
          // 391px to 767px — which is most phones
          interactions: [
            {
              interaction: 'open',
              trigger: 'click',
              target: 'mobile-menu',
              closeOn: ['outside', 'escape'],
            },
          ],
        },
        {
          type: 'nav',
          key: 'mobile-menu',
          classes:
            'hidden absolute left-0 top-[100%] z-50 w-full flex-col gap-1 border-b border-border bg-background p-4 md:hidden',
          children: [
            { type: 'link', content: 'Home', link: '/', classes: 'rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground' },
            { type: 'link', content: 'Features', link: '/features', classes: 'rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground' },
            { type: 'link', content: 'Pricing', link: '/pricing', classes: 'rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground' },
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
