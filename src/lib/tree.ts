import type { ElementNode } from '@/types/editor'

/** depth-first visit of every node in the element tree */
export function walkNodes(nodes: ElementNode[], visit: (node: ElementNode) => void) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children, visit)
  }
}

/** finds a node anywhere in the tree by id */
export function findNode(nodes: ElementNode[], id: string): ElementNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = findNode(node.children, id)
    if (match) return match
  }
  return null
}
