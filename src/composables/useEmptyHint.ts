import type { ElementNode } from '@/types/editor'

/**
 * Which empty containers the user has said are empty ON PURPOSE.
 *
 * A childless `div`/`section` renders at zero height, so on the Edit canvas
 * `ElementRenderer` draws a drop hint inside it — a min-height and a line
 * saying elements go here. A spacer or a decorative box wants none of that,
 * so the hint carries an Ignore button, whose answer is `node.allowEmpty`.
 *
 * Node state, not view state, because a spacer stays a spacer across reloads,
 * drafts and merges: the key is in `NODE_STATE_KEYS`, so an agent's HTML write
 * keeps it on every element it adopts, and `cloneSubtree` carries it through
 * copy/paste. Written like `hidden`: only a real change is written, and
 * restoring DELETES the key, so ignore-then-restore leaves the node
 * byte-identical (merge signatures compare JSON). Nothing renders it.
 */
export function useEmptyHint() {
  const isDismissed = (node: ElementNode) => node.allowEmpty === true
  const dismiss = (node: ElementNode) => {
    if (node.allowEmpty !== true) node.allowEmpty = true
  }
  const restore = (node: ElementNode) => {
    if (node.allowEmpty !== undefined) delete node.allowEmpty
  }
  return { isDismissed, dismiss, restore }
}
