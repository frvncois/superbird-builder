import { ref } from 'vue'
import type { Component } from 'vue'
import { useElement, type DropPosition } from './useElement'
import { useComponents } from './useComponents'
import { expandComponentInstances } from '@/lib/components'
import { elementBlockLines } from '@/lib/syntax'
import type { ElementNode } from '@/types/editor'

/** what a palette card puts on the drag: a built-in type or a component */
export type InsertPayload =
  | { kind: 'element'; type: string; label: string; icon: Component }
  | { kind: 'component'; name: string }

/** the floating chip's content; null = no drag in flight */
const payload = ref<InsertPayload | null>(null)
const pointer = ref({ x: 0, y: 0 })
/** set for one tick after a drop so PopoverUI ignores the release click */
const suppressNextClick = ref(false)

/** the code editor owns fold/scroll geometry, so it registers its own resolver */
type CodeResolver = (clientY: number) => { id: string; position: DropPosition } | null
let codeResolver: CodeResolver | null = null

// a drag begins on pointerdown but only activates after a small move,
// so plain clicks on palette cards stay inert
const DRAG_THRESHOLD = 4

export function useInsertDrag() {
  const { dropTarget, getElement, bodyElement, insertElementBlock } = useElement()
  const { components, findComponent, masterFor } = useComponents()

  function canvasTarget(
    node: ElementNode,
    hit: HTMLElement,
    y: number,
  ): { id: string; position: DropPosition } | null {
    if (node.type === 'body') return { id: node.id, position: 'inside' }

    // component instances never accept interior drops — reshaping the
    // master from a palette drag would mutate every instance. Retarget
    // to the instance root, before/after only.
    const mapping = masterFor(node.id)
    if (mapping) {
      const root = getElement(mapping.instanceId)
      if (!root) return null
      const rootEl = hit.closest(`[data-node-id="${CSS.escape(mapping.instanceId)}"]`) ?? hit
      const rect = rootEl.getBoundingClientRect()
      return { id: root.id, position: y <= rect.top + rect.height / 2 ? 'before' : 'after' }
    }

    const rect = hit.getBoundingClientRect()
    // screen-space edge zone: ratio keeps it zoom-stable, px clamps keep
    // before/after reachable on tiny frames and sane on huge ones
    const edge = Math.min(Math.max(rect.height * 0.25, 3), 24)
    if (y < rect.top + edge) return { id: node.id, position: 'before' }
    if (y > rect.bottom - edge) return { id: node.id, position: 'after' }
    // blocks (they have a close line) take children through their middle
    const container = node.line !== undefined && (node.endLine ?? node.line) > node.line
    if (container && rect.height >= edge * 3) return { id: node.id, position: 'inside' }
    return { id: node.id, position: y <= rect.top + rect.height / 2 ? 'before' : 'after' }
  }

  function resolveAt(x: number, y: number): { id: string; position: DropPosition } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null
    if (el.closest('[data-insert-code-surface]')) return codeResolver?.(y) ?? null
    // collection-item interiors render template-page nodes whose ids
    // aren't in this page — climb until an id resolves
    let marker = el.closest<HTMLElement>('[data-node-id]')
    while (marker) {
      const node = getElement(marker.dataset.nodeId!)
      if (node) return canvasTarget(node, marker, y)
      marker = marker.parentElement?.closest<HTMLElement>('[data-node-id]') ?? null
    }
    if (el.closest('[data-frame-drop]')) {
      const body = bodyElement.value
      return body ? { id: body.id, position: 'inside' } : null
    }
    return null
  }

  function insert(p: InsertPayload, target: { id: string; position: DropPosition }) {
    if (p.kind === 'element') {
      insertElementBlock(elementBlockLines(p.type), target.id, target.position)
      return
    }
    // component removed mid-drag → nothing sane to insert
    if (!findComponent(p.name)) return
    const block = expandComponentInstances(`:${p.name}:`, components.value).split('\n')
    insertElementBlock(block, target.id, target.position)
  }

  /** swallow the click the browser fires after the drag's pointerup, so
   * the popover stays open and canvas click handlers don't run */
  function suppressReleaseClick() {
    suppressNextClick.value = true
    const swallow = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => {
      window.removeEventListener('click', swallow, { capture: true })
      suppressNextClick.value = false
    }, 0)
  }

  function startInsertDrag(p: InsertPayload, e: PointerEvent) {
    if (e.button !== 0) return
    const source = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    let active = false

    source.setPointerCapture(e.pointerId)

    const cleanup = () => {
      payload.value = null
      dropTarget.value = null
      if (source.hasPointerCapture(e.pointerId)) source.releasePointerCapture(e.pointerId)
      source.removeEventListener('pointermove', onMove)
      source.removeEventListener('pointerup', onUp)
      source.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeydown, { capture: true })
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_THRESHOLD) return
        active = true
        payload.value = p
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      pointer.value = { x: ev.clientX, y: ev.clientY }
      dropTarget.value = resolveAt(ev.clientX, ev.clientY)
    }

    const onUp = () => {
      const target = dropTarget.value
      const dropped = active
      cleanup()
      if (!dropped) return
      suppressReleaseClick()
      if (target) insert(p, target)
    }

    const onCancel = () => cleanup()

    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      cleanup()
    }

    source.addEventListener('pointermove', onMove)
    source.addEventListener('pointerup', onUp)
    source.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeydown, { capture: true })
  }

  function registerCodeResolver(fn: CodeResolver | null) {
    codeResolver = fn
  }

  return { payload, pointer, suppressNextClick, startInsertDrag, registerCodeResolver }
}
