import type { CommentAnchor } from '@/types/editor'

/**
 * Element-anchored comment positioning. A comment stores the node it was
 * dropped on plus a fractional offset within that node's box, so the pin
 * reflows/scales and resolves in any view that renders the node (the editor
 * canvas and the content preview both tag elements with data-node-id).
 */

/** the node + fractional offset under a screen point, within `root` */
export function anchorFromPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement,
): CommentAnchor | null {
  const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  const nodeEl = hit?.closest?.('[data-node-id]') as HTMLElement | null
  if (!nodeEl || !root.contains(nodeEl)) return null
  const rect = nodeEl.getBoundingClientRect()
  return {
    nodeId: nodeEl.dataset.nodeId!,
    rx: rect.width ? (clientX - rect.left) / rect.width : 0.5,
    ry: rect.height ? (clientY - rect.top) / rect.height : 0.5,
  }
}

/** current screen position of an anchored pin, or null if the node isn't shown */
export function anchorScreenPos(
  anchor: CommentAnchor,
  root: HTMLElement,
): { x: number; y: number } | null {
  const nodeEl = root.querySelector(`[data-node-id="${anchor.nodeId}"]`) as HTMLElement | null
  if (!nodeEl) return null
  const rect = nodeEl.getBoundingClientRect()
  return { x: rect.left + anchor.rx * rect.width, y: rect.top + anchor.ry * rect.height }
}
