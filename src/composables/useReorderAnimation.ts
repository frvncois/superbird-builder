import { nextTick } from 'vue'
import { useElement, type DropPosition } from './useElement'
import { reducedMotion, rectOf, slideGhost, styleGhostBase } from '@/lib/flip'

/**
 * Wraps reorderElement so the moved canvas element visibly slides from its old
 * position to its new one — otherwise a reorder just re-renders in place and,
 * among many similar elements, it's unclear what moved.
 */
export function useReorderAnimation() {
  const { reorderElement } = useElement()

  const nodeEl = (id: string): HTMLElement | null =>
    document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)

  function canvasReorder(dragId: string, targetId: string, position: DropPosition) {
    const el = nodeEl(dragId)
    if (!el || reducedMotion()) {
      reorderElement(dragId, targetId, position)
      return
    }

    const from = rectOf(el)
    const clone = el.cloneNode(true) as HTMLElement
    clone.removeAttribute('id')
    clone.removeAttribute('data-node-id')
    // the canvas is zoomed; the clone renders at natural size, so scale it to
    // match the on-screen size the original had (derived from the element, no
    // camera dependency)
    const scale = el.offsetWidth ? from.width / el.offsetWidth : 1
    styleGhostBase(clone, {
      top: from.top,
      left: from.left,
      width: el.offsetWidth,
      height: el.offsetHeight,
      transform: `scale(${scale})`,
    })

    reorderElement(dragId, targetId, position)

    nextTick(() => {
      const now = nodeEl(dragId)
      if (!now) return
      const to = rectOf(now)
      if (to.top === from.top && to.left === from.left) return // nothing moved
      // show only the sliding ghost until it lands, then reveal the settled node
      now.style.visibility = 'hidden'
      const reveal = () => {
        now.style.visibility = ''
      }
      slideGhost(clone, `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`, 360)
      clone.addEventListener('transitionend', reveal, { once: true })
      setTimeout(reveal, 440)
    })
  }

  return { canvasReorder }
}
