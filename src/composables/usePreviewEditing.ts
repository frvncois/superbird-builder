import { ref } from 'vue'

// Preview-mode editing coordination, shared across the recursive
// PreviewRenderer instances and the PreviewView menu.
export interface PreviewMenuState {
  x: number
  y: number
  nodeId: string
}

// the open "Edit content" context menu, or null
const menu = ref<PreviewMenuState | null>(null)
// a node id whose renderer instance should begin editing (menu-driven —
// Cmd+Click edits directly, so this is only for the context menu path)
const editRequest = ref<string | null>(null)

export function usePreviewEditing() {
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
