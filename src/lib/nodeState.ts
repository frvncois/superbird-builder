import type { ElementNode } from '@/types/editor'

/**
 * What a node carries beyond its structure.
 *
 * This is what is left of `syntax.ts` after the indentation DSL was deleted
 * (TREE-SOURCE-PLAN.md, Phase 4). The list used to mean "the state the code
 * cannot express, which `reconcile` therefore had to carry across a reparse";
 * it now means "the state a write preserves on every element it adopts", which
 * is the same list for the same reason — it is everything the agent format does
 * not put in the markup.
 *
 * One definition, shared by the HTML writer's `fresh` path and by anything else
 * that wants a clean slate. It had drifted when it was spelled out twice.
 */
export const NODE_STATE_KEYS = [
  'classes',
  'content',
  'src',
  'svg',
  'hidden',
  // an instance's variant picks, which live on its own wrapper
  'variants',
  'background',
  'htmlId',
  'attributes',
  'interactions',
  'animations',
  'locales',
  'listQuery',
  'entryId',
  'fieldAttrs',
  'instanceAttributes',
  'slider',
  'form',
] as const

/** true when a node carries state that would be lost (or wrongly inherited) */
export function hasNodeState(node: ElementNode): boolean {
  return NODE_STATE_KEYS.some((key) => {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (value == null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
}

/** drop everything a node carried, leaving its structure */
export function stripNodeState(node: ElementNode) {
  for (const key of NODE_STATE_KEYS) delete (node as unknown as Record<string, unknown>)[key]
}

/**
 * List sources that are not collections: `@pages` iterates the site's own
 * published pages. The `@` prefix is reserved, so it can never collide with a
 * collection someone named "pages".
 */
export const BUILTIN_LIST_SOURCES = ['@pages']
