import { computed, ref } from 'vue'
import { useElement } from './useElement'
import type { ElementBlock } from './useElement'
import type { Interaction } from '@/types/editor'

const menu = ref<{ x: number; y: number; targetId: string } | null>(null)

// app-internal clipboard (elements aren't representable in the OS one)
const copiedBlock = ref<ElementBlock | null>(null)
const copiedClasses = ref<string | null>(null)
const copiedInteractions = ref<Interaction[] | null>(null)
// tracks whether the most recent copy/cut was an element (vs. text) so the
// code editor can decide between element-paste and native text-paste on ⌘V
const clipboardIsElement = ref(false)

export function useContextMenu() {
  const {
    selectedElement,
    getElement,
    selectElement,
    copyElementBlock,
    pasteElementBlock,
    removeElement,
  } = useElement()

  const target = computed(() => (menu.value ? getElement(menu.value.targetId) : null))
  const targetIsBody = computed(() => target.value?.type === 'body')

  // --- keyboard-driven actions operate on the current selection ---

  function copySelection() {
    const el = selectedElement.value
    if (!el || el.type === 'body') return
    const block = copyElementBlock(el.id)
    if (block) {
      copiedBlock.value = block
      clipboardIsElement.value = true
    }
  }

  function pasteOnSelection() {
    const el = selectedElement.value
    if (el && copiedBlock.value) pasteElementBlock(el.id, copiedBlock.value)
  }

  function duplicateSelection() {
    const el = selectedElement.value
    if (!el || el.type === 'body') return
    const block = copyElementBlock(el.id)
    if (block) pasteElementBlock(el.id, block)
  }

  function deleteSelection() {
    const el = selectedElement.value
    if (el && el.type !== 'body') removeElement(el.id)
  }

  function cutSelection() {
    copySelection()
    deleteSelection()
  }

  function openMenu(e: MouseEvent, targetId: string) {
    e.preventDefault()
    selectElement(targetId)
    menu.value = { x: e.clientX, y: e.clientY, targetId }
  }

  function closeMenu() {
    menu.value = null
  }

  function duplicate() {
    const id = menu.value?.targetId
    const block = id ? copyElementBlock(id) : null
    if (id && block) pasteElementBlock(id, block)
  }

  function copy() {
    const block = menu.value ? copyElementBlock(menu.value.targetId) : null
    if (block) {
      copiedBlock.value = block
      clipboardIsElement.value = true
    }
  }

  function paste() {
    if (menu.value && copiedBlock.value) pasteElementBlock(menu.value.targetId, copiedBlock.value)
  }

  function remove() {
    if (menu.value) removeElement(menu.value.targetId)
  }

  function copyClasses() {
    if (target.value) copiedClasses.value = target.value.classes ?? ''
  }

  function pasteClasses() {
    if (target.value && copiedClasses.value !== null) target.value.classes = copiedClasses.value
  }

  function copyInteractions() {
    if (target.value) {
      copiedInteractions.value = JSON.parse(JSON.stringify(target.value.interactions ?? []))
    }
  }

  function pasteInteractions() {
    if (target.value && copiedInteractions.value) {
      // fresh ids so the pasted set never collides with the source's
      target.value.interactions = copiedInteractions.value.map((i) => ({
        ...i,
        id: crypto.randomUUID(),
      }))
    }
  }

  return {
    menu,
    target,
    targetIsBody,
    copiedBlock,
    copiedClasses,
    copiedInteractions,
    clipboardIsElement,
    openMenu,
    closeMenu,
    duplicate,
    copy,
    paste,
    remove,
    copyClasses,
    pasteClasses,
    copyInteractions,
    pasteInteractions,
    copySelection,
    cutSelection,
    pasteOnSelection,
    duplicateSelection,
    deleteSelection,
  }
}
