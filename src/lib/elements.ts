import type { ElementNode } from '@/types/editor'

export interface ElementDef {
  /** HTML tag rendered in the canvas */
  tag: string
  /** Placeholder content until the user edits the element */
  defaultContent?: string
  /** Void elements cannot have children or text */
  void?: boolean
  /** the element type ghost-suggested as this block's first child (autocomplete) */
  suggest?: string
}

import { ELEMENTS_DATA } from './shared/elements.js'

/** the element registry — data lives in the shared plain-JS module so the
 * node exporter (server/export.mjs) consumes the exact same source */
export const ELEMENTS: Record<string, ElementDef> = ELEMENTS_DATA

export function isKnownElement(type: string) {
  return type in ELEMENTS
}

/**
 * A leaf element carries text content or is void — it is ALWAYS written as
 * `:name:` and can never be opened as a block. Everything else (section,
 * div, form, list, …) is a container: `:name … name:`.
 */
export function isLeafElement(type: string): boolean {
  const def = ELEMENTS[type]
  return !!def && (def.defaultContent !== undefined || def.void === true)
}

export function createNode(type: string): ElementNode {
  return { id: crypto.randomUUID(), type, content: '', children: [] }
}

/** types an element can switch between (same structural shape per group) */
const TYPE_GROUPS: string[][] = [
  ['section', 'div', 'container', 'grid', 'header', 'footer', 'article', 'nav', 'main', 'aside'],
  ['heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ['text', 'paragraph', 'span', 'label'],
  ['button', 'link'],
  ['list', 'form'],
]

export function typeOptionsFor(type: string): string[] {
  return TYPE_GROUPS.find((group) => group.includes(type)) ?? []
}
