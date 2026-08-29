import { ref } from 'vue'

// Content-mode editing coordination, shared across the recursive
// ContentRenderer instances and the ContentView menu.
export interface ContentMenuState {
  x: number
  y: number
  nodeId: string
}

// the open "Edit content" context menu, or null
const menu = ref<ContentMenuState | null>(null)
// a node id whose renderer instance should begin editing (menu-driven —
// Cmd+Click edits directly, so this is only for the context menu path)
const editRequest = ref<string | null>(null)

export function useContentEditing() {
  function openMenu(e: MouseEvent, nodeId: string) {
    e.preventDefault()
    e.stopPropagation()
    menu.value = { x: e.clientX, y: e.clientY, nodeId }
  }
  function closeMenu() {
    menu.value = null
  }
  function requestEdit(nodeId: string) {
    editRequest.value = nodeId
    menu.value = null
  }
  /** a renderer claims a pending edit request for its node (one-shot) */
  function consumeEditRequest(nodeId: string): boolean {
    if (editRequest.value !== nodeId) return false
    editRequest.value = null
    return true
  }
  return { menu, editRequest, openMenu, closeMenu, requestEdit, consumeEditRequest }
}
