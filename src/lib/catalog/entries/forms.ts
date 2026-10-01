import type { CatalogEntry, CatalogNode } from '../types'
import { FIELD, FIELD_TOKENS, FOCUS, PLACEHOLDER, icon, words } from './helpers'

/**
 * Form controls.
 *
 * The ones with a state — switch, toggle, radio — are REAL inputs, so they
 * work with no JavaScript, submit with a form and answer to the keyboard. What
 * shows the state is CSS reading the input (`has-[:checked]:`), and the input
 * itself is visually hidden (`sr-only`), not removed.
 *
 * No `for` / `id` pairing anywhere: `htmlId` does not replicate across
 * instances, so every instance would claim the same id. A `label` is a
 * container, so the control simply sits inside it.
 */

const LABEL = 'text-sm font-medium text-foreground'

const radio = (label: string, value: string, checked = false): CatalogNode => ({
  type: 'label',
  classes: 'flex cursor-pointer items-center gap-2',
  children: [
    {
      type: 'radio',
      classes: `size-4 shrink-0 border border-input accent-primary outline-none ${FOCUS}`,
      attributes: { name: 'choice', value, ...(checked ? { checked: '' } : {}) },
    },
    { type: 'span', content: label, classes: LABEL },
  ],
})

const toggleItem = (iconName: string, label: string, value: string): CatalogNode => ({
  type: 'label',
  classes:
    'inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
  attributes: { 'aria-label': label },
  children: [
    { type: 'radio', classes: 'sr-only', attributes: { name: 'align', value } },
    icon(iconName),
  ],
})

export const FORMS: CatalogEntry[] = [
  {
    key: 'input',
    name: 'Input',
    category: 'Forms',
    description: 'A single-line text field.',
    tokens: [...FIELD_TOKENS, 'muted-foreground'],
    root: {
      type: 'input',
      key: 'input',
      classes: `h-9 ${FIELD} ${PLACEHOLDER}`,
      // a bare primitive ships no copy: the placeholder read "Enter your email"
      // and the name was "email", so every field copied from it said so until
      // someone noticed. The composite form entries below keep their example
      // text, where it reads as an example.
      attributes: { type: 'text' },
    },
  },
  {
    key: 'textarea',
    name: 'Textarea',
    category: 'Forms',
    description: 'A multi-line text field.',
    tokens: [...FIELD_TOKENS, 'muted-foreground'],
    root: {
      type: 'textarea',
      key: 'input',
      classes: `py-2 ${FIELD} ${PLACEHOLDER}`,
      attributes: { placeholder: 'Your message', name: 'message', rows: '4' },
    },
  },
  {
    key: 'select',
    name: 'Select',
    category: 'Forms',
    description: 'A dropdown of fixed choices.',
    tokens: [...FIELD_TOKENS, 'muted-foreground'],
    // a <select> cannot hold an icon, and left to itself it draws the
    // browser's chevron and chrome: the native look is turned off and the
    // wrapper draws the chevron over it
    root: {
      type: 'div',
      classes: 'relative w-full',
      children: [
        {
          type: 'select',
          key: 'input',
          classes: `h-9 appearance-none cursor-pointer pr-9 ${FIELD}`,
          attributes: { name: 'choice' },
          children: [
            { type: 'option', content: 'First option' },
            { type: 'option', content: 'Second option' },
            { type: 'option', content: 'Third option' },
          ],
        },
        icon('chevron-down', 'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground'),
      ],
    },
  },
  {
    key: 'label',
    name: 'Label',
    category: 'Forms',
    description: 'A form field label.',
    tokens: ['foreground'],
    root: { type: 'label', classes: LABEL, children: [words('Label', 'label')] },
  },
  {
    key: 'field',
    name: 'Field',
    category: 'Forms',
    description: 'A label over an input, with a line of help under it.',
    tokens: [...FIELD_TOKENS, 'muted-foreground'],
    root: {
      type: 'label',
      classes: 'flex w-full flex-col gap-1.5',
      children: [
        { type: 'span', key: 'label', content: 'Email', classes: LABEL },
        {
          type: 'input',
          key: 'input',
          classes: `h-9 ${FIELD} ${PLACEHOLDER}`,
          attributes: { type: 'email', placeholder: 'you@example.com', name: 'email' },
        },
        {
          type: 'span',
          key: 'help',
          content: 'We only use it to reply.',
          classes: 'text-xs text-muted-foreground',
          hidden: true,
        },
      ],
    },
  },
  {
    key: 'checkbox',
    name: 'Checkbox',
    category: 'Forms',
    description: 'A checkbox with its label.',
    tokens: ['input', 'primary', 'foreground', 'ring'],
    root: {
      type: 'label',
      classes: 'flex cursor-pointer items-center gap-2',
      children: [
        {
          type: 'checkbox',
          key: 'input',
          classes: `size-4 shrink-0 rounded-md border border-input accent-primary outline-none ${FOCUS}`,
          attributes: { name: 'accept' },
        },
        { type: 'span', key: 'label', content: 'Accept the terms', classes: LABEL },
      ],
    },
  },
  {
    key: 'radio-group',
    name: 'RadioGroup',
    category: 'Forms',
    description: 'One choice out of a few.',
    tokens: ['input', 'primary', 'foreground', 'ring'],
    root: {
      type: 'fieldset',
      classes: 'flex flex-col gap-3',
      children: [
        radio('Comfortable', 'comfortable', true),
        radio('Compact', 'compact'),
        radio('Spacious', 'spacious'),
      ],
    },
  },
  {
    key: 'switch',
    name: 'Switch',
    category: 'Forms',
    description: 'On or off, at once.',
    tokens: ['input', 'primary', 'background', 'foreground', 'ring'],
    root: {
      type: 'label',
      classes: 'group flex w-fit cursor-pointer items-center gap-2',
      children: [
        { type: 'checkbox', key: 'input', classes: 'sr-only', attributes: { name: 'enabled', role: 'switch' } },
        {
          type: 'div',
          key: 'track',
          classes:
            'relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors group-has-[:checked]:bg-primary group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring',
          children: [
            {
              type: 'div',
              key: 'thumb',
              classes:
                'absolute top-[2px] left-[2px] size-4 rounded-full bg-background shadow-sm transition-transform group-has-[:checked]:translate-x-4',
            },
          ],
        },
        { type: 'span', key: 'label', content: 'Airplane mode', classes: LABEL },
      ],
    },
  },
  {
    key: 'toggle',
    name: 'Toggle',
    category: 'Forms',
    description: 'A button that stays pressed.',
    tokens: ['muted', 'muted-foreground', 'accent', 'accent-foreground', 'ring'],
    root: {
      type: 'label',
      classes:
        'inline-flex h-9 w-fit cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
      children: [
        { type: 'checkbox', key: 'input', classes: 'sr-only', attributes: { name: 'bold' } },
        icon('bold', 'size-4 shrink-0', { key: 'icon' }),
        { type: 'span', key: 'label', content: 'Bold' },
      ],
    },
  },
  {
    key: 'toggle-group',
    name: 'ToggleGroup',
    category: 'Forms',
    description: 'A row of toggles where one is pressed at a time.',
    tokens: ['border', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'ring'],
    root: {
      type: 'fieldset',
      classes: 'flex w-fit items-center gap-1 rounded-lg border border-border p-1',
      children: [
        toggleItem('text-align-start', 'Align left', 'left'),
        toggleItem('text-align-center', 'Align center', 'center'),
        toggleItem('text-align-end', 'Align right', 'right'),
      ],
    },
  },
]
