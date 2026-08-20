import { ref } from 'vue'
import { useElement } from './useElement'
import { useComponents } from './useComponents'
import { elementBlockLines } from '@/lib/syntax'
import { expandComponentInstances } from '@/lib/components'

// runtime editor state: whether the ⌘E insert palette (the canvas dock) is open
const open = ref(false)

export function openPalette() {
  open.value = true
}
export function closePalette() {
  open.value = false
}
export function togglePalette() {
  open.value = !open.value
}

export function useCommandPalette() {
  const { selectedElement, insertElementBlock } = useElement()
  const { components, findComponent } = useComponents()

  // insert at the current selection with smart position: insertElementBlock
  // coerces 'inside' → body appends / container last-child / leaf → after.
  // Selection defaults to the body, so the target is always valid.
  function insertElement(type: string) {
    const target = selectedElement.value
    if (target) insertElementBlock(elementBlockLines(type), target.id, 'inside')
  }
  function insertComponent(name: string) {
    const target = selectedElement.value
    if (!target || !findComponent(name)) return
    const block = expandComponentInstances(`:${name}:`, components.value).split('\n')
    insertElementBlock(block, target.id, 'inside')
  }

  return { open, openPalette, closePalette, togglePalette, insertElement, insertComponent }
}
