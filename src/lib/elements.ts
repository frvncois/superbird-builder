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
  /** attributes the element type IMPLIES (a :checkbox is <input type="checkbox">).
   * Emitted by every renderer, and overridable by the author's own attributes. */
  attrs?: Record<string, string>
  /** the child a brand-new element of this type is created with. A button and
   * a link are containers whose words live in a child, so an unseeded insert
   * would land an empty box — see the registry's header comment. */
  seed?: { type: string; content: string }
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

/**
 * The node a seeded container is born with, or null — so an insert lands
 * something visible instead of an empty box. One builder for both structure
 * hosts, since both insert into a tree.
 */
export function seedChildFor(type: string): ElementNode | null {
  const seed = ELEMENTS[type]?.seed
  if (!seed) return null
  return { ...createNode(seed.type), content: seed.content }
}

/** types an element can switch between (same structural shape per group) */
const TYPE_GROUPS: string[][] = [
  ['section', 'div', 'container', 'grid', 'header', 'footer', 'article', 'nav', 'main', 'aside', 'list-item'],
  ['heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ['text', 'paragraph', 'span'],
  // the seeded containers: one shape (a wrapper around its words), so they
  // retype into each other cleanly. `label` left the text group when it became
  // a container — a container can never become a leaf without losing children
  ['button', 'link', 'label'],
  ['list', 'form'],
  ['thead', 'tbody'],
  ['th', 'td'],
]

export function typeOptionsFor(type: string): string[] {
  return TYPE_GROUPS.find((group) => group.includes(type)) ?? []
}
