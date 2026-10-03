import type { ElementNode, Page } from '@/types/editor'
import { isLeafElement } from './elements'
import { applyNodeMarkers } from './syntax'

/**
 * TRANSITIONAL: regenerate `page.code` from the page's tree.
 *
 * The tree is the source of truth for structure now, and nothing in `src/`
 * reads `page.code` any more. The agent API still does — it reads and writes
 * the indentation DSL, addresses edits by line number, and hashes the code for
 * its `version` contract — so the code is kept as a derived MIRROR of the tree
 * until the MCP moves to HTML (TREE-SOURCE-PLAN.md, Phase 3). This whole module
 * goes with that move; so does the DSL itself.
 *
 * It also re-assigns every node's `line`/`endLine`, because that is what the
 * agent API addresses by. Assigning the same number back is a no-op for Vue's
 * reactivity, so a regeneration that changes nothing dirties nothing.
 */

/** the fixed `@setup` block: the body's open line always sits at index 5 */
const SETUP_LINES = 5

/**
 * Serializes one node and its subtree, recording where each one landed.
 *
 * Unlike `serializeNode` (which writes a MASTER's structure into instance
 * blocks) this emits the `#ref` slot: a ref is a page-scope address, so it
 * belongs in a page's code and nowhere else.
 */
function emit(node: ElementNode, indent: string, lines: string[]): void {
  node.line = lines.length
  const ref = node.ref ? `#${node.ref}` : ''
  const arg = node.arg ? `[${node.arg}]` : ''
  // node.link stores '@item' for the current-entry sentinel, verbatim otherwise
  const link = node.link ? `@${node.link === '@item' ? 'item' : node.link}` : ''
  // form follows the REGISTRY, not the child count: a childless container keeps
  // its block spelling, or re-parsing would turn it into a leaf and orphan
  // anything put inside it later
  if (isLeafElement(node.type)) {
    lines.push(`${indent}:${node.type}${ref}${arg}:${link}`)
    node.endLine = node.line
    return
  }
  lines.push(`${indent}:${node.type}${ref}${arg}${link}`)
  for (const child of node.children) emit(child, `${indent}\t`, lines)
  lines.push(`${indent}${node.type}:`)
  node.endLine = lines.length - 1
}

/** the canonical document for a page's current tree, lines assigned as it goes */
export function pageToCode(page: Page, defaultLocale: string): string {
  const body = page.elements.find((n) => n.type === 'body')
  const lines = [
    '@setup',
    `\tname: ${page.name}`,
    `\tslug: ${page.path}`,
    `\tstatus: ${page.status}`,
    // the setup `locale:` was always the project's default locale; it is read
    // back by nothing but the exporter's own scaffold checks
    `\tlocale: ${defaultLocale}`,
  ]
  if (!body) return [...lines, ':body', '\t', 'body:'].join('\n')

  body.line = SETUP_LINES
  lines.push(`:body${body.arg ? `[${body.arg}]` : ''}`)
  for (const child of body.children) emit(child, '\t', lines)
  // an empty body keeps one indented line, exactly as `buildDocument` does, so
  // the two scaffolds are byte-identical
  if (!body.children.length) lines.push('\t')
  lines.push('body:')
  body.endLine = lines.length - 1

  // the display-only markers ('[+]' own data, '(+)' styled, '{+}' interactions)
  // are written for agents only — one implementation, shared with everything
  // else that maintains them
  return applyNodeMarkers(lines.join('\n'), page.elements)
}

/** Brings `page.code` back in step with the tree. Returns whether it moved. */
export function syncPageCode(page: Page, defaultLocale: string): boolean {
  const next = pageToCode(page, defaultLocale)
  if (next === page.code) return false
  page.code = next
  return true
}
